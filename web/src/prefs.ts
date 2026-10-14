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

export const DEFAULT_GESTURES: Record<Gesture, GestureAction> = {
  // AnkiDroid's defaults (cardviewer/ViewerCommand.kt, Gesture.kt)
  swipeUp: 'edit',
  swipeDown: 'none',
  swipeLeft: 'none',
  swipeRight: 'none',
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
  gesturesEnabled: false,
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
    return { ...DEFAULTS, ...raw, gestures: { ...DEFAULT_GESTURES, ...(raw.gestures || {}) } }
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
