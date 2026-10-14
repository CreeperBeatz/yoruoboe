/**
 * Sync from the app's side: the button's state, conflicts, and when to sync on our own.
 *
 * The collection is on this device (see local/); syncing sends and fetches changes, as
 * AnkiDroid does. The app syncs when the user taps sync, when it is opened and when it
 * is left (AnkiDroid's "automatic synchronization"), and while open it sends changes
 * once the user has been idle a little and fetches others' now and then.
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

export function sync({ quiet = false, full }: { quiet?: boolean; full?: 'upload' | 'download' } = {}): Promise<void> {
  if (inFlight) return inFlight
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

/** Changes are sent once the user has left them alone this long. */
const IDLE_PUSH_MS = 45_000
/** Others' changes are fetched this often while the app is open. */
const PULL_MS = 10 * 60_000

let lastActivity = Date.now()
let lastSync = 0

/** Start automatic syncing; returns a function that stops it. */
export function startAutoSync(): () => void {
  const touch = () => (lastActivity = Date.now())
  const events = ['pointerdown', 'keydown'] as const
  events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
  const timer = window.setInterval(async () => {
    if (inFlight || document.visibilityState !== 'visible' || !navigator.onLine) return
    const s = state.state
    if (s?.conflict) return
    const idle = Date.now() - lastActivity > IDLE_PUSH_MS
    const pending = await api
      .get<SyncState>('/api/sync')
      .then((st) => {
        set({ state: st })
        return st.pending
      })
      .catch(() => false)
    if ((pending && idle) || Date.now() - lastSync > PULL_MS) {
      lastSync = Date.now()
      await sync({ quiet: true })
    }
  }, 15_000)
  return () => {
    events.forEach((e) => window.removeEventListener(e, touch))
    window.clearInterval(timer)
  }
}

export function noteSynced() {
  lastSync = Date.now()
}
