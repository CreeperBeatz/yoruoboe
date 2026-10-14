/**
 * The app's JSON API. It used to be a server's; now the handlers in ./local answer on
 * this device, from the collection Anki's engine keeps in the browser. Screens call it
 * as they did, by method and path.
 */

import { handle, HttpError, ready } from './local'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()

/** Called when the sync server says the sign-in is gone, so the app can ask again. */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}

/** As over the network: requests and responses are plain JSON, copied. */
const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    await ready()
  } catch (err) {
    throw new ApiError(503, err instanceof Error ? err.message : String(err))
  }
  try {
    return copy((await handle(method, path, copy(body ?? {}))) as T)
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401 && path !== '/api/login') unauthorizedListeners.forEach((fn) => fn())
      throw new ApiError(err.status, err.message)
    }
    throw new ApiError(500, err instanceof Error ? err.message : String(err))
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

// ---- shared types ------------------------------------------------------------------

export interface SyncState {
  running: boolean
  lastOk: number
  lastError: string
  conflict: boolean
  pending: boolean
  serverMessage?: string
  media: { active: boolean; checked?: string; added?: string; removed?: string; error?: string }
}

export interface Me {
  /** '' when not signed in to a sync server. */
  username: string
  /** The sync server, '' for AnkiWeb. */
  server: string
  sync: SyncState
}

export interface UndoInfo {
  undo: string
  redo: string
}

export interface DeckNode {
  id: number
  name: string
  level: number
  collapsed: boolean
  filtered: boolean
  new: number
  learn: number
  review: number
  total: number
  children: DeckNode[]
}

export interface DeckList {
  decks: DeckNode[]
  current: number
  studiedToday: string
  undo: UndoInfo
  cardCount: number
}

export interface DeckOverview {
  id: number
  name: string
  filtered: boolean
  description: string
  markdownDescription: boolean
  counts: { new: number; learn: number; review: number }
  total: number
  buried: { sched: boolean; user: boolean }
  finished: boolean
  secsUntilNextLearn: number
  undo: UndoInfo
}
