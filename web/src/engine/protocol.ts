/** Messages between the page (client.ts) and the engine's worker (worker.ts). */

/** Where databases live: OPFS (preferred), IndexedDB, or whichever works. */
export type StorageMode = 'opfs' | 'idb' | 'auto'

export type SyncKind = 'syncLogin' | 'syncStatus' | 'syncCollection' | 'fullUploadOrDownload'

export type RequestBody =
  | { op: 'start'; storageDir: string; storage: StorageMode; init: Uint8Array }
  | { op: 'call'; name: string; service: number; method: number; input: Uint8Array }
  | { op: 'db'; input: Uint8Array }
  | { op: 'sync'; kind: SyncKind; input: Uint8Array }
  | {
      op: 'file'
      kind: 'read' | 'write' | 'remove' | 'stat' | 'list'
      path: string
      data?: Uint8Array
    }

export type Request = RequestBody & { id: number }

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: Uint8Array | string }
