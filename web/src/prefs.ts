/**
 * Per-device preferences, as AnkiDroid keeps in its SharedPreferences: kept in
 * localStorage, not synced. Collection settings (Anki's own) live in the collection.
 */

import { useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'plain' | 'dark' | 'black'

export type GestureAction =
  | 'none' | 'showAnswer' | 'flipOrAnswer1' | 'flipOrAnswer2' | 'flipOrAnswer3' | 'flipOrAnswer4'
  | 'answer1' | 'answer2' | 'answer3' | 'answer4' | 'undo' | 'redo' | 'edit' | 'mark' | 'bury' | 'buryNote'
  | 'suspend' | 'suspendNote' | 'delete' | 'replay' | 'replayVoice' | 'recordVoice' | 'toggleWhiteboard'
  | 'cardInfo' | 'deckOptions' | 'exit' | 'flagRed' | 'flagOrange' | 'flagGreen' | 'flagBlue' | 'flagPink'
  | 'flagTurquoise' | 'flagPurple' | 'unflag' | 'pageUp' | 'pageDown' | 'playMedia' | 'tagsDialog'
  | 'toggleAutoAdvance' | 'browse' | 'statistics' | 'resetCard' | 'setDueDate' | 'showHint' | 'showAllHints'
  | 'abort'

export type Gesture =
  | 'swipeUp' | 'swipeDown' | 'swipeLeft' | 'swipeRight' | 'doubleTap' | 'longPress'
  | 'tapTopLeft' | 'tapTop' | 'tapTopRight' | 'tapLeft' | 'tapCenter' | 'tapRight'
  | 'tapBottomLeft' | 'tapBottom' | 'tapBottomRight'

export interface Prefs {
  theme: Theme
  dayTheme: 'light' | 'plain'
  nightTheme: 'dark' | 'black'
  // reviewing
  cardZoom: number
  imageZoom: number
  answerButtonSize: number
  showAnswerButtons: boolean
  showIntervalsOnButtons: boolean
  showTopBar: boolean
  showETA: boolean
  showCounts: boolean
  showTimer: boolean
  centerVertically: boolean
  fullscreen: boolean
  keepScreenOn: boolean
  doubleTapTimeInterval: number
  // gestures
  gesturesEnabled: boolean
  gestures: Record<Gesture, GestureAction>
  swipeSensitivity: number
  // sync
  autoSync: boolean
  syncOnOpen: boolean
  // audio
  autoPlayAudio: boolean
  replayQuestion: boolean
  tts: boolean
  // whiteboard
  whiteboardStrokeWidth: number
  whiteboardPenColor: string
  // browser
  browserCardsMode: boolean
  browserTruncate: boolean
  // misc
  deckSearchVisible: boolean
  newDayStartsAt?: number
  language: string
  typeAnswerNativeKeyboard: boolean
  hideHardAndEasy: boolean
}

/** What each action is called, in Settings and on a card being swiped. */
export const GESTURE_ACTIONS: { value: GestureAction; label: string }[] = [
  { value: 'none', label: 'No action' },
  { value: 'showAnswer', label: 'Show answer' },
  { value: 'flipOrAnswer1', label: 'Show answer / Again' },
  { value: 'flipOrAnswer2', label: 'Show answer / Hard' },
  { value: 'flipOrAnswer3', label: 'Show answer / Good' },
  { value: 'flipOrAnswer4', label: 'Show answer / Easy' },
  { value: 'answer1', label: 'Answer Again' },
  { value: 'answer2', label: 'Answer Hard' },
  { value: 'answer3', label: 'Answer Good' },
  { value: 'answer4', label: 'Answer Easy' },
  { value: 'undo', label: 'Undo' },
  { value: 'redo', label: 'Redo' },
  { value: 'edit', label: 'Edit note' },
  { value: 'mark', label: 'Mark note' },
  { value: 'bury', label: 'Bury card' },
  { value: 'buryNote', label: 'Bury note' },
  { value: 'suspend', label: 'Suspend card' },
  { value: 'suspendNote', label: 'Suspend note' },
  { value: 'delete', label: 'Delete note' },
  { value: 'replay', label: 'Replay audio' },
  { value: 'toggleWhiteboard', label: 'Toggle whiteboard' },
  { value: 'cardInfo', label: 'Card info' },
  { value: 'deckOptions', label: 'Deck options' },
  { value: 'tagsDialog', label: 'Edit tags' },
  { value: 'setDueDate', label: 'Set due date' },
  { value: 'resetCard', label: 'Reset card' },
  { value: 'pageUp', label: 'Page up' },
  { value: 'pageDown', label: 'Page down' },
  { value: 'showHint', label: 'Show hint' },
  { value: 'showAllHints', label: 'Show all hints' },
  { value: 'toggleAutoAdvance', label: 'Toggle auto advance' },
  { value: 'flagRed', label: 'Toggle red flag' },
  { value: 'flagOrange', label: 'Toggle orange flag' },
  { value: 'flagGreen', label: 'Toggle green flag' },
  { value: 'flagBlue', label: 'Toggle blue flag' },
  { value: 'unflag', label: 'Remove flag' },
  { value: 'browse', label: 'Browse' },
  { value: 'statistics', label: 'Statistics' },
  { value: 'exit', label: 'Exit' },
]

/** AnkiDroid's swipes, before the iOS look's (to move anyone still on them over). */
const ANKIDROID_SWIPES = { swipeUp: 'edit', swipeDown: 'none', swipeLeft: 'none', swipeRight: 'none' } as const

export const DEFAULT_GESTURES: Record<Gesture, GestureAction> = {
  // AnkiDroid's defaults (cardviewer/ViewerCommand.kt, Gesture.kt), but for the swipes:
  // the card goes left for Again, right for Good, up for Easy, down for Hard, and any
  // swipe on the question shows the answer.
  swipeUp: 'flipOrAnswer4',
  swipeDown: 'flipOrAnswer2',
  swipeLeft: 'flipOrAnswer1',
  swipeRight: 'flipOrAnswer3',
  doubleTap: 'none',
  longPress: 'none',
  tapTopLeft: 'none',
  tapTop: 'none',
  tapTopRight: 'none',
  tapLeft: 'none',
  tapCenter: 'none',
  tapRight: 'none',
  tapBottomLeft: 'none',
  tapBottom: 'none',
  tapBottomRight: 'none',
}

export const DEFAULTS: Prefs = {
  theme: 'system',
  dayTheme: 'light',
  nightTheme: 'dark',
  cardZoom: 100,
  imageZoom: 100,
  answerButtonSize: 100,
  showAnswerButtons: true,
  showIntervalsOnButtons: true,
  showTopBar: true,
  showETA: true,
  showCounts: true,
  showTimer: false,
  centerVertically: false,
  fullscreen: false,
  keepScreenOn: false,
  doubleTapTimeInterval: 200,
  gesturesEnabled: true,
  gestures: DEFAULT_GESTURES,
  swipeSensitivity: 100,
  autoSync: true,
  syncOnOpen: true,
  autoPlayAudio: true,
  replayQuestion: true,
  tts: false,
  whiteboardStrokeWidth: 6,
  whiteboardPenColor: '',
  browserCardsMode: true,
  browserTruncate: false,
  deckSearchVisible: false,
  language: '',
  typeAnswerNativeKeyboard: true,
  hideHardAndEasy: false,
}

const KEY = 'anki-pwa-prefs'
const listeners = new Set<() => void>()

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    // Saved with AnkiDroid's swipes, never changed: the iOS look's swipes, switched on.
    const g = raw.gestures
    if (g && Object.entries(ANKIDROID_SWIPES).every(([k, v]) => g[k] === v) && !raw.swipesMoved) {
      for (const k of Object.keys(ANKIDROID_SWIPES) as Gesture[]) g[k] = DEFAULT_GESTURES[k]
      raw.gesturesEnabled = true
      raw.swipesMoved = true
    }
    return { ...DEFAULTS, ...raw, gestures: { ...DEFAULT_GESTURES, ...(g || {}) } }
  } catch {
    return DEFAULTS
  }
}

let prefs = load()

export function getPrefs(): Prefs {
  return prefs
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch }
  localStorage.setItem(KEY, JSON.stringify(prefs))
  listeners.forEach((fn) => fn())
}

export function resetPrefs() {
  localStorage.removeItem(KEY)
  prefs = load()
  listeners.forEach((fn) => fn())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => prefs,
  )
}

/** The theme actually in force, following the system's dark mode when set to. */
export function effectiveTheme(p: Prefs, systemDark: boolean): Exclude<Theme, 'system'> {
  if (p.theme !== 'system') return p.theme
  return systemDark ? p.nightTheme : p.dayTheme
}

export function isDarkTheme(t: Theme): boolean {
  return t === 'dark' || t === 'black'
}
