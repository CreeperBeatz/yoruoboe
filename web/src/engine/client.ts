/**
 * The page's side of the engine: starts the worker and sends it calls.
 * Typed backend methods are in ./generated/backend.ts (Anki's own wrappers),
 * which reach the worker through ./post.ts.
 */

import { BackendError as BackendErrorPb, BackendError_Kind, BackendInit } from './generated/anki/backend_pb'
import { METHODS } from './generated/methods'
import type { Request, RequestBody, Response, StorageMode, SyncKind } from './protocol'

export { BackendError_Kind as ErrorKind }

/** An error from Anki's backend, with its kind and (localized) message. */
export class BackendError extends Error {
  kind: BackendError_Kind
  context: string

  constructor(pb: BackendErrorPb) {
    super(pb.message)
    this.name = 'BackendError'
    this.kind = pb.kind
    this.context = pb.context
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()
let started: Promise<StorageMode> | null = null

function send<T>(req: RequestBody, transfer: Transferable[] = []): Promise<T> {
  if (!worker) throw new Error('engine not started')
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ ...req, id } as Request, transfer)
  })
}

const crashListeners = new Set<() => void>()

/**
 * Called when the engine crashed (a Rust panic: WebAssembly traps, and the engine's state
 * can't be trusted after). The worker is gone; the next startEngine() makes a new one.
 * What was committed is safe: SQLite rolls back the transaction that was under way.
 */
export function onEngineCrash(fn: () => void) {
  crashListeners.add(fn)
}

function crashed(message: string) {
  console.error('engine crashed:', message)
  worker?.terminate()
  worker = null
  started = null
  for (const p of pending.values()) p.reject(new Error(`The engine stopped (${message}); it restarts on the next action.`))
  pending.clear()
  crashListeners.forEach((fn) => fn())
}

function onMessage(ev: MessageEvent<Response>) {
  const res = ev.data
  const p = pending.get(res.id)
  if (!p) return
  pending.delete(res.id)
  if (res.ok) {
    p.resolve(res.result)
  } else if (res.error instanceof Uint8Array) {
    p.reject(new BackendError(BackendErrorPb.fromBinary(res.error)))
  } else if (res.error.startsWith('RuntimeError')) {
    p.reject(new Error(res.error))
    crashed(res.error)
  } else {
    p.reject(new Error(res.error))
  }
}

/**
 * Start the engine once. `storageDir` names this profile's storage (an OPFS
 * folder or IndexedDB database); `langs` are preferred languages for Anki's
 * messages. Resolves with the store in use.
 */
export function startEngine(storageDir: string, langs: string[], storage: StorageMode = 'auto'): Promise<StorageMode> {
  if (started) return started
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'anki-engine' })
  worker.onmessage = onMessage
  worker.onerror = (ev) => crashed(ev.message || 'worker error')
  const init = new BackendInit({ preferredLangs: langs, server: false }).toBinary()
  started = send<StorageMode>({ op: 'start', storageDir, storage, init }).catch((err) => {
    started = null
    throw err
  })
  return started
}

/** Call a backend method by name with encoded input; resolves with encoded output. */
export function callRaw(name: string, input: Uint8Array): Promise<Uint8Array> {
  if (name in SYNC_CALLS) return send<Uint8Array>({ op: 'sync', kind: name as SyncKind, input })
  const ids = METHODS[name]
  if (!ids) return Promise.reject(new Error(`unknown backend method ${name}`))
  return send<Uint8Array>({ op: 'call', name, service: ids[0], method: ids[1], input })
}

const SYNC_CALLS: Record<SyncKind, true> = {
  syncLogin: true,
  syncStatus: true,
  syncCollection: true,
  fullUploadOrDownload: true,
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** pylib's db.execute/all/first: JSON over the backend's DB proxy. */
export async function dbCommand<T = unknown>(command: object): Promise<T> {
  const out = await send<Uint8Array>({ op: 'db', input: encoder.encode(JSON.stringify(command)) })
  return JSON.parse(decoder.decode(out)) as T
}

// ---- files ----

export function readFile(path: string): Promise<Uint8Array | null> {
  return send({ op: 'file', kind: 'read', path })
}

export function writeFile(path: string, data: Uint8Array): Promise<void> {
  return send({ op: 'file', kind: 'write', path, data })
}

export function removeFile(path: string): Promise<void> {
  return send({ op: 'file', kind: 'remove', path })
}

/** [size, modified ms], or null. */
export function statFile(path: string): Promise<[number, number] | null> {
  return send({ op: 'file', kind: 'stat', path })
}

export function listDir(path: string): Promise<string[]> {
  return send({ op: 'file', kind: 'list', path })
}
