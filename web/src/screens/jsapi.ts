/**
 * The app's answers to AnkiDroid's JavaScript API (AnkiDroidJsAPI.kt), called by card
 * templates through the card frame. Answers are {"success": bool, "value": ...}.
 *
 * As AnkiDroid, calls that search the collection need the "dangerous" permission, which
 * is off: they fail.
 */

import { api } from '../api'
import { getPrefs } from '../prefs'
import { toast } from '../ui/components'

export interface JsApiContext {
  card: { id: number; noteId: number; flag: number; marked: boolean; deckName: string } | null
  counts: { new: number; learn: number; review: number } | null
  side: 'question' | 'answer'
  labels: string[]
  night: boolean
  showAnswer(): void
  answer(ease: number): void
  act(action: string): Promise<void>
  setFlag(flag: number): Promise<void>
  reload(): void
  openMenu(): void
}

const ok = (value: unknown) => JSON.stringify({ success: true, value })
const fail = (value: unknown = null) => JSON.stringify({ success: false, value })

const FLAGS: Record<string, number> = { none: 0, red: 1, orange: 2, green: 3, blue: 4, pink: 5, turquoise: 6, purple: 7 }

let ttsLang = ''
let ttsPitch = 1
let ttsRate = 1

function parse(data: unknown): Record<string, unknown> {
  if (typeof data !== 'string') return {}
  try {
    return JSON.parse(data)
  } catch {
    return {}
  }
}

export async function handleJsApi(endpoint: string, data: unknown, ctx: JsApiContext): Promise<string> {
  const c = ctx.card
  const raw = async () => (c ? api.get<Record<string, number>>(`/api/cards/${c.id}/raw`) : null)
  switch (endpoint) {
    case 'init':
      return ok(true)
    case 'newCardCount':
      return ok(ctx.counts?.new ?? 0)
    case 'lrnCardCount':
      return ok(ctx.counts?.learn ?? 0)
    case 'revCardCount':
      return ok(ctx.counts?.review ?? 0)
    case 'eta':
      return ok(0)
    case 'cardMark':
      return ok(!!c?.marked)
    case 'cardFlag':
      return ok(c?.flag ?? 0)
    case 'nextTime1':
    case 'nextTime2':
    case 'nextTime3':
    case 'nextTime4':
      return ok(ctx.side === 'answer' ? (ctx.labels[Number(endpoint.slice(-1)) - 1] ?? '') : '')
    case 'cardReps':
    case 'cardInterval':
    case 'cardFactor':
    case 'cardMod':
    case 'cardType':
    case 'cardDid':
    case 'cardLeft':
    case 'cardODid':
    case 'cardODue':
    case 'cardQueue':
    case 'cardLapses':
    case 'cardDue': {
      const r = await raw()
      if (!r) return fail()
      const key = {
        cardReps: 'reps', cardInterval: 'ivl', cardFactor: 'factor', cardMod: 'mod', cardType: 'type', cardDid: 'did',
        cardLeft: 'left', cardODid: 'odid', cardODue: 'odue', cardQueue: 'queue', cardLapses: 'lapses', cardDue: 'due',
      }[endpoint]!
      return ok(r[key])
    }
    case 'cardId':
      return ok(c?.id ?? 0)
    case 'cardNid':
      return ok(c?.noteId ?? 0)
    case 'deckName':
      return ok(c?.deckName ?? '')
    case 'isInFullscreen':
      return ok(getPrefs().fullscreen)
    case 'isTopbarShown':
      return ok(getPrefs().showTopBar)
    case 'isInNightMode':
      return ok(ctx.night)
    case 'isDisplayingAnswer':
      return ok(ctx.side === 'answer')
    case 'isActiveNetworkMetered':
      return ok(false)
    case 'ttsFieldModifierIsAvailable':
      return ok('speechSynthesis' in window)
    case 'ttsIsSpeaking':
      return ok('speechSynthesis' in window && speechSynthesis.speaking)
    case 'ttsStop':
      if ('speechSynthesis' in window) speechSynthesis.cancel()
      return ok(true)
    case 'ttsSetLanguage':
      ttsLang = String(data ?? '')
      return ok(true)
    case 'ttsSetPitch':
      ttsPitch = Number(data) || 1
      return ok(true)
    case 'ttsSetSpeechRate':
      ttsRate = Number(data) || 1
      return ok(true)
    case 'ttsSpeak': {
      const { text, queueMode } = parse(data) as { text?: string; queueMode?: number }
      if (!('speechSynthesis' in window) || !text) return fail()
      if (!queueMode) speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      if (ttsLang) u.lang = ttsLang.replace('_', '-')
      u.pitch = ttsPitch
      u.rate = ttsRate
      speechSynthesis.speak(u)
      return ok(true)
    }
    case 'showToast': {
      const { text } = parse(data) as { text?: string }
      toast(String(text ?? ''))
      return ok(true)
    }
    case 'showAnswer':
      ctx.showAnswer()
      return ok(true)
    case 'answerEase1':
    case 'answerEase2':
    case 'answerEase3':
    case 'answerEase4':
      ctx.answer(Number(endpoint.slice(-1)))
      return ok(true)
    case 'buryCard':
      await ctx.act('buryCard')
      return ok(true)
    case 'buryNote':
      await ctx.act('buryNote')
      return ok(true)
    case 'suspendCard':
      await ctx.act('suspendCard')
      return ok(true)
    case 'suspendNote':
      await ctx.act('suspendNote')
      return ok(true)
    case 'markCard':
      await ctx.act('mark')
      return ok(true)
    case 'toggleFlag': {
      const v = String(data ?? '').toLowerCase()
      const flag = FLAGS[v] ?? Number(v)
      if (!(flag >= 0 && flag <= 7)) return fail()
      await ctx.setFlag(flag)
      return ok(true)
    }
    case 'resetProgress':
      if (!c) return fail()
      await api.post('/api/cards/forget', { cardIds: [c.id], restorePosition: true, resetCounts: false })
      ctx.reload()
      return ok(true)
    case 'setCardDue': {
      if (!c) return fail()
      const days = Number(data)
      if (!Number.isFinite(days) || days < 0 || days > 9999) return fail()
      await api.post('/api/cards/set-due', { cardIds: [c.id], days: String(days) })
      ctx.reload()
      return ok(true)
    }
    case 'getNoteTags':
      if (!c) return fail()
      return ok(JSON.stringify(await api.get<string[]>(`/api/notes/${c.noteId}/tags`)))
    case 'setNoteTags': {
      if (!c) return fail()
      const { tags } = parse(data) as { tags?: string[] }
      await api.post('/api/notes/set-tags', { noteId: c.noteId, tags: tags ?? [] })
      return ok(true)
    }
    case 'addTagToCard':
    case 'addTagToNote': {
      if (!c) return fail()
      const tag = endpoint === 'addTagToCard' ? String(data ?? '') : String((parse(data) as { tag?: string }).tag ?? '')
      await api.post('/api/notes/tags', { noteIds: [c.noteId], add: tag })
      return ok(true)
    }
    case 'showNavigationDrawer':
    case 'showOptionsMenu':
      ctx.openMenu()
      return ok(true)
    case 'enableHorizontalScrollbar':
    case 'enableVerticalScrollbar':
    case 'setFullscreenButtonsAndMenu':
    case 'setFullscreenButtonsOnly':
    case 'setFullscreenAllGone':
      return ok(true)
    default:
      // searchCard (needs the dangerous permission), speech to text: not available.
      return fail()
  }
}
