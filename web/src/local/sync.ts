/**
 * Syncing the collection on this device with the sync server, as AnkiDroid does.
 *
 * The browser can only reach a sync server at the app's own address: AnkiWeb doesn't
 * allow requests from web pages elsewhere. So the app talks to `/aw/<host>/` here, and
 * the host serving the app passes it on to `<host>.ankiweb.net` (see deploy/). AnkiWeb
 * moves an account to its own server (sync13.ankiweb.net, say) by answering with a new
 * endpoint; that becomes `/aw/sync13/`.
 *
 * Another sync server can be set instead (Settings > Sync); it must be reachable from
 * the browser at the address given.
 */

import { SyncCollectionResponse_ChangesRequired as Required } from '../engine/generated/anki/sync_pb'
import { be, clearCaches, dbCommand } from './col'

export interface Account {
  username: string
  hkey: string
  /** Where sync requests go, as the browser sees it. */
  endpoint: string
}

const ACCOUNT_KEY = 'anki-account'
const SERVER_KEY = 'anki-sync-server'

export function account(): Account | null {
  try {
    const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') as Account | null
    return a?.hkey ? a : null
  } catch {
    return null
  }
}

function saveAccount(a: Account | null) {
  if (a) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a))
  else localStorage.removeItem(ACCOUNT_KEY)
}

/** AnkiWeb, through this site's forwarder. */
export function ankiWebEndpoint(host = 'sync'): string {
  return `${location.origin}/aw/${host}/`
}

/** The sync server chosen in settings, or '' for AnkiWeb. */
export function customServer(): string {
  return localStorage.getItem(SERVER_KEY) ?? ''
}

export function setCustomServer(url: string) {
  const v = url.trim()
  if (v) localStorage.setItem(SERVER_KEY, v.endsWith('/') ? v : `${v}/`)
  else localStorage.removeItem(SERVER_KEY)
}

function loginEndpoint(): string {
  return customServer() || ankiWebEndpoint()
}

/** An endpoint the server sent, as the browser can reach it. */
export function reachable(endpoint: string): string {
  try {
    const u = new URL(endpoint)
    const m = /^(sync\d*)\.ankiweb\.net$/i.exec(u.hostname)
    if (m) return ankiWebEndpoint(m[1].toLowerCase())
  } catch {
    // not a URL: leave it
  }
  return endpoint
}

const auth = (a: Account) => ({ hkey: a.hkey, endpoint: a.endpoint })

export class SyncConflict extends Error {
  constructor() {
    super('The collections can only be synced one way')
  }
}

export class NotSignedIn extends Error {
  constructor() {
    super('not signed in')
  }
}

// ---- state ----------------------------------------------------------------------------------

export const state = {
  running: false,
  lastOk: 0,
  lastError: '',
  conflict: false,
  serverMessage: '',
  /** Collection modification time at the last successful sync. */
  syncedMod: Number(localStorage.getItem('anki-synced-mod') ?? 0),
}

export async function collectionMod(): Promise<number> {
  const rows = await dbCommand<unknown[][]>({ kind: 'query', sql: 'select mod from col', args: [], first_row_only: true })
  return Number(rows[0]?.[0] ?? 0)
}

export async function needsPush(): Promise<boolean> {
  return account() !== null && (await collectionMod()) !== state.syncedMod
}

async function markSynced() {
  state.syncedMod = await collectionMod()
  localStorage.setItem('anki-synced-mod', String(state.syncedMod))
}

export async function mediaStatus() {
  try {
    const s = await be.mediaSyncStatus({})
    return {
      active: s.active,
      checked: s.progress?.checked ?? '',
      added: s.progress?.added ?? '',
      removed: s.progress?.removed ?? '',
    }
  } catch (err) {
    // the last media sync failed
    return { active: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Called after a full sync replaced the collection, and on sign-out. */
const resetListeners = new Set<() => void>()
export function onCollectionReplaced(fn: () => void) {
  resetListeners.add(fn)
}

// ---- signing in -----------------------------------------------------------------------------

export async function login(username: string, password: string): Promise<Account> {
  const endpoint = loginEndpoint()
  const out = await be.syncLogin({ username: username.trim(), password, endpoint })
  const a: Account = { username: username.trim(), hkey: out.hkey, endpoint: reachable(out.endpoint || endpoint) }
  saveAccount(a)
  // A new account: whatever was synced before says nothing about this one.
  state.syncedMod = 0
  state.conflict = false
  return a
}

export function logout() {
  saveAccount(null)
  state.conflict = false
  state.lastError = ''
}

// ---- syncing --------------------------------------------------------------------------------

let inFlight: Promise<{ full: string | null }> | null = null

/**
 * Sync with the server. `full` is "upload" or "download" to settle a conflict the user
 * was asked about. Throws SyncConflict when only a one-way sync is possible and the
 * user must pick the direction.
 */
export function runSync(full?: 'upload' | 'download'): Promise<{ full: string | null }> {
  if (inFlight) return inFlight
  inFlight = doSync(full).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function doSync(full?: 'upload' | 'download'): Promise<{ full: string | null }> {
  const a = account()
  if (!a) throw new NotSignedIn()
  state.running = true
  try {
    let serverUsn: number | undefined
    let direction: 'upload' | 'download' | null = full ?? null
    if (!direction) {
      const out = await be.syncCollection({ auth: auth(a), syncMedia: true })
      if (out.newEndpoint) {
        a.endpoint = reachable(out.newEndpoint)
        saveAccount(a)
      }
      state.serverMessage = out.serverMessage
      serverUsn = out.serverMediaUsn
      if (out.required === Required.FULL_SYNC) {
        state.conflict = true
        throw new SyncConflict()
      }
      if (out.required === Required.FULL_UPLOAD) direction = 'upload'
      else if (out.required === Required.FULL_DOWNLOAD) direction = 'download'
    }
    if (direction) {
      await be.fullUploadOrDownload({ auth: auth(a), upload: direction === 'upload', serverUsn })
      clearCaches()
      resetListeners.forEach((fn) => fn())
      // Without the server's media number the engine skips media; sync it now.
      if (serverUsn === undefined) await be.syncMedia(auth(a))
    }
    state.conflict = false
    state.lastOk = Date.now() / 1000
    state.lastError = ''
    await markSynced()
    return { full: direction }
  } catch (err) {
    if (!(err instanceof SyncConflict)) state.lastError = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    state.running = false
  }
}

export function isSyncing() {
  return inFlight !== null
}
