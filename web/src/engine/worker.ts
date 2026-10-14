/// <reference lib="webworker" />
/**
 * The engine's worker: Anki's Rust backend (compiled to WebAssembly) and the
 * collection, in OPFS. The page talks to it through ./client.ts.
 *
 * Calls run one at a time, in order. A sync holds the collection until it
 * finishes, so calls made meanwhile wait, except the few that only read
 * progress or ask to stop.
 */

import init, {
  Engine,
  initStorage,
  listDir,
  readFile,
  removeFile,
  statFile,
  writeFile,
} from './pkg/anki_wasm.js'
import type { Request, Response } from './protocol'

declare const self: DedicatedWorkerGlobalScope

let engine: Engine | null = null

/** May run while a sync holds the collection. */
const ALONGSIDE_SYNC = new Set([
  'latestProgress',
  'setWantsAbort',
  'abortSync',
  'abortMediaSync',
  'mediaSyncStatus',
  'i18nResources',
])

function need(): Engine {
  if (!engine) throw new Error('engine not started')
  return engine
}

async function handle(req: Request): Promise<unknown> {
  switch (req.op) {
    case 'start': {
      await init()
      const store = await initStorage(req.storageDir, req.storage)
      engine = new Engine(req.init)
      return store
    }
    case 'call':
      return need().command(req.service, req.method, req.input)
    case 'db':
      return need().dbCommand(req.input)
    case 'sync': {
      const e = need()
      switch (req.kind) {
        case 'syncLogin':
          return await e.syncLogin(req.input)
        case 'syncStatus':
          return await e.syncStatus(req.input)
        case 'syncCollection':
          return await e.syncCollection(req.input)
        case 'fullUploadOrDownload':
          return await e.fullUploadOrDownload(req.input)
      }
      throw new Error('unknown sync call')
    }
    case 'file':
      switch (req.kind) {
        case 'read':
          return readFile(req.path) ?? null
        case 'write':
          writeFile(req.path, req.data!)
          return null
        case 'remove':
          removeFile(req.path)
          return null
        case 'stat':
          return statFile(req.path) ?? null
        case 'list':
          return listDir(req.path)
      }
  }
}

let queue: Promise<unknown> = Promise.resolve()

function bypassesQueue(req: Request): boolean {
  return req.op === 'call' && ALONGSIDE_SYNC.has(req.name)
}

function reply(res: Response) {
  const transfer: Transferable[] = []
  if (res.ok && res.result instanceof Uint8Array) transfer.push(res.result.buffer)
  self.postMessage(res, transfer)
}

async function run(req: Request) {
  try {
    const result = await handle(req)
    reply({ id: req.id, ok: true, result })
  } catch (err) {
    // backend errors arrive as encoded BackendError bytes
    const error =
      err instanceof Uint8Array ? err : err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    reply({ id: req.id, ok: false, error })
  }
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const req = ev.data
  if (bypassesQueue(req)) {
    void run(req)
  } else {
    queue = queue.then(() => run(req))
  }
}
