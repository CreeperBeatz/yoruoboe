/**
 * Sync from the app's side: the button's state, conflicts, and when to sync on our own.
 *
 * The collection is on this device (see local/); syncing sends and fetches changes, as
 * AnkiDroid does. The app syncs when the user taps sync, and on its own (AnkiDroid's
 * "automatic synchronization") only when it is opened, when it is left with changes,
 * and when it is come back to a while after the last sync: about as often as AnkiDroid,
 * so the sync server sees an ordinary client.
 */

import { useSyncExternalStore } from 'react'
import { api, ApiError, type SyncState } from './api'
import { navigate } from './router'
import { choose, toast } from './ui/components'

interface State {
  syncing: boolean
  state: SyncState | null
  /** Bumped after every sync, so screens reload what they show. */
  generation: number
}

let state: State = { syncing: false, state: null, generation: 0 }
const listeners = new Set<() => void>()

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

export function useSync(): State {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

export function setSyncState(s: SyncState) {
  set({ state: s })
}

let inFlight: Promise<void> | null = null
/** When the last sync began, the user's or our own. */
let lastSync = 0

export function sync({ quiet = false, full }: { quiet?: boolean; full?: 'upload' | 'download' } = {}): Promise<void> {
  if (inFlight) return inFlight
  lastSync = Date.now()
  inFlight = (async () => {
    set({ syncing: true })
    try {
      const res = await api.post<{ full?: string | null; conflict?: boolean; state: SyncState }>('/api/sync', full ? { full } : {})
      set({ state: res.state })
      if (res.conflict) {
        await resolveConflict()
        return
      }
      if (res.state.serverMessage) toast(res.state.serverMessage)
      else if (!quiet) toast(res.full ? `Full sync done (${res.full})` : 'Sync complete')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        if (!quiet) navigate('/login')
      } else if (!quiet) toast(e instanceof Error ? e.message : String(e))
      void refreshSyncState()
    } finally {
      set({ syncing: false, generation: state.generation + 1 })
      inFlight = null
    }
  })()
  return inFlight
}

async function resolveConflict() {
  // AnkiDroid's full-sync dialog: the two collections can't be merged, the user picks one.
  const choice = await choose<'upload' | 'download'>(
    'The collections on this device and on the server cannot be merged. Keep which one?',
    [
      { label: 'Download from server (replace this device’s collection)', value: 'download' },
      { label: 'Upload to server (replace the server’s collection)', value: 'upload' },
    ],
  )
  if (choice) {
    inFlight = null
    await sync({ full: choice })
  }
}

export async function refreshSyncState() {
  try {
    set({ state: await api.get<SyncState>('/api/sync') })
  } catch {
    // keep the last known state
  }
}

// ---- syncing on our own -------------------------------------------------------------------

/** Coming back to the app syncs only when the last sync is older than this (AnkiDroid's
 * AUTOMATIC_SYNC_MINIMAL_INTERVAL). */
const RESUME_MS = 10 * 60_000
/** Leaving it sends changes, but not again within this (app switching back and forth). */
const LEAVE_MS = 60_000

/**
 * Automatic sync while the app is open: changes are sent when it is left, and others'
 * fetched when it is come back to. (Opening it is App's: "Sync when opening the app".)
 * Returns a function that stops it.
 */
export function startAutoSync(): () => void {
  let lastPush = 0
  const onVisibility = () => {
    if (!navigator.onLine) return
    if (document.visibilityState === 'hidden') {
      if (Date.now() - lastPush < LEAVE_MS) return
      // It syncs only if there is something to send.
      void api
        .post<{ started: boolean }>('/api/sync/beacon')
        .then((r) => {
          if (r.started) lastPush = lastSync = Date.now()
        })
        .catch(() => {})
    } else {
      void refreshSyncState()
      if (Date.now() - lastSync > RESUME_MS) void sync({ quiet: true })
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => document.removeEventListener('visibilitychange', onVisibility)
}
