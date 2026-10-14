/**
 * Signing in to the sync server (AnkiWeb, or one chosen in settings), and syncing.
 * Port of server/routes/account.py; the collection is on this device now, so signing
 * out keeps it, as in AnkiDroid.
 */

import { BackendError, ErrorKind, listDir, removeFile } from '../../engine/client'
import { ANKI_VERSION, closeCollection, COL_PATH, MEDIA_DB, MEDIA_DIR, openCollection } from '../col'
import { get, HttpError, post } from '../http'
import {
  account,
  customServer,
  login,
  logout,
  mediaStatus,
  needsPush,
  NotSignedIn,
  onCollectionReplaced,
  runSync,
  setCustomServer,
  state,
  SyncConflict,
} from '../sync'
import { resetReview } from './review'

onCollectionReplaced(resetReview)

export async function syncState() {
  return {
    running: state.running,
    lastOk: state.lastOk,
    lastError: state.lastError,
    conflict: state.conflict,
    pending: await needsPush().catch(() => false),
    serverMessage: state.serverMessage,
    media: await mediaStatus(),
  }
}

post('/api/login', async ({ body }) => {
  const username = String(body.username ?? '').trim()
  if (!username) throw new HttpError(400, 'Enter your username (the email address of your AnkiWeb account).')
  try {
    await login(username, String(body.password ?? ''))
  } catch (err) {
    if (err instanceof BackendError && err.kind === ErrorKind.SYNC_AUTH_ERROR) {
      throw new HttpError(401, err.message || 'Wrong username or password.')
    }
    throw new HttpError(502, `The sync server could not be reached: ${err instanceof Error ? err.message : err}`)
  }
  // First sign-in: fetch the collection now, so the deck list is not empty.
  let result: Record<string, unknown>
  try {
    result = await runSync()
  } catch (err) {
    result = err instanceof SyncConflict ? { conflict: true } : { error: err instanceof Error ? err.message : String(err) }
  }
  return { username, sync: result }
})

post('/api/logout', () => {
  logout()
  return { ok: true }
})

/** Sign out and remove the collection from this device (it stays on the sync server). */
post('/api/logout/everywhere', async () => {
  if (await needsPush()) {
    try {
      await runSync()
    } catch (err) {
      throw new HttpError(409, `Unsynced changes could not be sent first: ${err instanceof Error ? err.message : err}`)
    }
  }
  await closeCollection()
  for (const f of [COL_PATH, `${COL_PATH}-wal`, MEDIA_DB]) await removeFile(f).catch(() => {})
  for (const name of await listDir(MEDIA_DIR).catch(() => [])) await removeFile(`${MEDIA_DIR}/${name}`).catch(() => {})
  logout()
  localStorage.removeItem('anki-synced-mod')
  state.syncedMod = 0
  await openCollection()
  resetReview()
  return { ok: true }
})

get('/api/me', async () => {
  const a = account()
  return { username: a?.username ?? '', server: customServer(), sync: await syncState() }
})

post('/api/sync', async ({ body }) => {
  const full = body?.full ?? null
  if (full !== null && full !== 'upload' && full !== 'download') throw new HttpError(400, 'full must be upload or download')
  try {
    const result = await runSync(full ?? undefined)
    return { ...result, state: await syncState() }
  } catch (err) {
    if (err instanceof SyncConflict) return { conflict: true, state: await syncState() }
    if (err instanceof NotSignedIn) throw new HttpError(401, 'not signed in')
    throw new HttpError(500, `Sync failed: ${err instanceof Error ? err.message : err}`)
  }
})

get('/api/sync', () => syncState())

/** The app was put away: send what changed, as AnkiDroid syncs on exit. */
post('/api/sync/beacon', async () => {
  const started = await needsPush()
  if (started) void runSync().catch(() => {})
  return { started }
})

/** The sync server: '' for AnkiWeb. */
post('/api/sync/server', ({ body }) => {
  setCustomServer(String(body.url ?? ''))
  logout()
  return { server: customServer() }
})

get('/api/version', () => ({ anki: ANKI_VERSION }))
