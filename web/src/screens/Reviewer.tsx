/**
 * The study screen (AnkiDroid's Reviewer): the card, Show Answer and the four answer
 * buttons with their intervals, the counts, and every action on the card.
 *
 * The server keeps the card on screen and its scheduling states (server/routes/review.py);
 * this screen shows it in the card frame, plays its audio, and sends the answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type UndoInfo } from '../api'
import { playAv, stopAudio, unlockAudio, type AvTag } from '../audio'
import { getPrefs, usePrefs, type GestureAction } from '../prefs'
import { goBack, navigate } from '../router'
import { AppBar, attempt, confirm, IconButton, Menu, toast, useMenu, type MenuItem } from '../ui/components'
import { editNoteTags, FLAG_COLORS, forgetCards, getFlagNames, setDueDate } from '../ui/dialogs'
import { Icon } from '../ui/icons'
import { CardView, type CardViewHandle, type FrameEvent } from './CardView'
import { handleJsApi } from './jsapi'
import { Whiteboard, type WhiteboardHandle } from './Whiteboard'
import './reviewer.css'

interface DeckConf {
  autoplay: boolean
  replayQuestion: boolean
  showTimer: boolean
  maxTakenSecs: number
  stopTimerOnAnswer: boolean
  secondsToShowQuestion: number
  secondsToShowAnswer: number
  questionAction: number
  answerAction: number
  waitForAudio: boolean
}

interface ReviewCard {
  id: number
  noteId: number
  mod: number
  ord: number
  deckId: number
  deckName: string
  queue: 'new' | 'learn' | 'review'
  flag: number
  marked: boolean
  hasSiblings: boolean
  bodyClass: string
  question: string
  answerPreload: string
  questionAv: AvTag[]
  hasTypeAnswer: boolean
  timeLimitSecs: number
}

interface Next {
  finished: boolean
  key?: string
  card?: ReviewCard
  counts?: { new: number; learn: number; review: number }
  deckConf?: DeckConf
  showRemaining?: boolean
  showIntervals?: boolean
  customScheduling?: string
  undo: UndoInfo
  deckId?: number
  congrats?: { secsUntilNextLearn: number; learnRemaining: number }
}

interface AnswerSide {
  answer: string
  answerAv: AvTag[]
  questionAv: AvTag[]
  labels: string[]
}

const EASE_NAMES = ['Again', 'Hard', 'Good', 'Easy']

export default function Reviewer() {
  const prefs = usePrefs()
  const view = useRef<CardViewHandle>(null)
  const board = useRef<WhiteboardHandle>(null)
  const [state, setState] = useState<Next | null>(null)
  const [side, setSide] = useState<'question' | 'answer'>('question')
  const [answer, setAnswer] = useState<AnswerSide | null>(null)
  const [busy, setBusy] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [lastEase, setLastEase] = useState<number | null>(null)
  const [whiteboard, setWhiteboard] = useState(false)
  const [autoAdvance, setAutoAdvance] = useState(false)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const shownAt = useRef(Date.now())
  const mutation = useRef<Promise<void> | null>(null)
  const session = useRef({ start: Date.now(), cards: 0, timeboxShown: 0 })
  const previousCard = useRef<number | null>(null)
  const autoTimer = useRef<number | undefined>(undefined)
  const answerPressed = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state
  const sideRef = useRef(side)
  sideRef.current = side
  const answerRef = useRef(answer)
  answerRef.current = answer

  const card = state?.card
  const conf = state?.deckConf

  // ---- loading cards ----------------------------------------------------------------------

  const show = useCallback((next: Next) => {
    window.clearTimeout(autoTimer.current)
    stopAudio()
    if (next.finished) {
      setState(next)
      const secs = next.congrats?.secsUntilNextLearn ?? 0
      const learnLater = secs > 0 && secs < 86400
      toast(
        learnLater
          ? `Congratulations! The next learning card is due in ${formatDuration(secs)}.`
          : 'Congratulations! You have finished this deck for now.',
      )
      navigate(`/deck/${next.deckId}`, { replace: true })
      return
    }
    setState(next)
    setSide('question')
    setAnswer(null)
    shownAt.current = Date.now()
    mutation.current = null
    board.current?.clear()
  }, [])

  const load = useCallback(async () => {
    try {
      show(await api.get<Next>('/api/review/next'))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    }
  }, [show])

  useEffect(() => {
    void load()
    return () => {
      stopAudio()
      window.clearTimeout(autoTimer.current)
    }
  }, [load])

  // Keep the screen on while studying, if asked.
  useEffect(() => {
    if (!prefs.keepScreenOn || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const take = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {})
    void take()
    const vis = () => document.visibilityState === 'visible' && void take()
    document.addEventListener('visibilitychange', vis)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      void lock?.release()
    }
  }, [prefs.keepScreenOn])

  // Show each new card in the frame, play its audio, run custom scheduling.
  useEffect(() => {
    if (!frameReady || !card || !state) return
    view.current?.showQuestion(card.question, card.answerPreload, card.bodyClass, card.flag, card.marked)
    if (state.customScheduling && state.key) {
      mutation.current = view.current!.mutateStates(state.key, state.customScheduling)
    }
    const played = conf?.autoplay && getPrefs().autoPlayAudio ? playQ(card.questionAv) : Promise.resolve()
    scheduleAuto('question', played)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameReady, card?.id, state?.key, state])

  const playQ = async (tags: AvTag[]) => playAv(tags)

  // ---- auto advance (deck options > Auto Advance) -----------------------------------------

  const scheduleAuto = (which: 'question' | 'answer', played: Promise<void>) => {
    window.clearTimeout(autoTimer.current)
    const c = stateRef.current?.deckConf
    if (!autoAdvanceRef.current || !c) return
    const secs = which === 'question' ? c.secondsToShowQuestion : c.secondsToShowAnswer
    if (!secs) return
    const start = () => {
      autoTimer.current = window.setTimeout(() => {
        if (which === 'question') {
          if (c.questionAction === 0) void showAnswer()
          else toast('Time to show the answer')
        } else {
          const action = c.answerAction
          if (action === 0) void act('buryCard')
          else if (action === 1) void answerCard(1)
          else if (action === 2) void answerCard(3)
          else if (action === 3) void answerCard(2)
          else toast('Time to answer')
        }
      }, secs * 1000)
    }
    if (c.waitForAudio) void played.then(start)
    else start()
  }
  const autoAdvanceRef = useRef(autoAdvance)
  autoAdvanceRef.current = autoAdvance

  // ---- show answer, answer ----------------------------------------------------------------

  const showAnswer = useCallback(async () => {
    const s = stateRef.current
    if (!s?.card || sideRef.current !== 'question' || busy) return
    const min = getPrefs().doubleTapTimeInterval
    if (Date.now() - answerPressed.current < min) return
    answerPressed.current = Date.now()
    window.clearTimeout(autoTimer.current)
    const typed = s.card.hasTypeAnswer ? await view.current!.typedAnswer() : ''
    let res: AnswerSide
    try {
      res = await api.post<AnswerSide>('/api/review/answer-side', { cardId: s.card.id, typed })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
      return void load()
    }
    setAnswer(res)
    setSide('answer')
    view.current?.showAnswer(res.answer, s.card.bodyClass)
    const played = s.deckConf?.autoplay && getPrefs().autoPlayAudio ? playQ(res.answerAv) : Promise.resolve()
    scheduleAuto('answer', played)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, load])

  const answerCard = useCallback(
    async (ease: number) => {
      const s = stateRef.current
      if (!s?.card || sideRef.current !== 'answer' || busy) return
      if (Date.now() - answerPressed.current < getPrefs().doubleTapTimeInterval) return
      answerPressed.current = Date.now()
      setBusy(true)
      window.clearTimeout(autoTimer.current)
      stopAudio()
      try {
        // The deck's custom scheduling must have had its say first.
        if (mutation.current) await mutation.current
        const res = await api.post<{ leech: boolean; leechSuspended: boolean; next: Next; error?: string }>('/api/review/answer', {
          cardId: s.card.id,
          ease,
          millis: Date.now() - shownAt.current,
        })
        previousCard.current = s.card.id
        session.current.cards++
        setLastEase(ease)
        window.setTimeout(() => setLastEase(null), 1000)
        if (res.leech) toast(res.leechSuspended ? 'Card was a leech. It has been suspended.' : 'Card was a leech.')
        if (res.error) toast(res.error)
        show(res.next)
        checkTimebox()
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e))
        void load()
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, show, load],
  )

  const checkTimebox = async () => {
    // Collection setting "Timebox time limit" (minutes, in the collection preferences).
    const limit = timeboxSecs.current
    if (!limit) return
    const elapsed = (Date.now() - session.current.start) / 1000
    if (elapsed < limit * (session.current.timeboxShown + 1)) return
    session.current.timeboxShown++
    const goOn = await confirm(`${session.current.cards} cards studied in ${Math.round(elapsed / 60)} minutes.`, {
      title: 'Time limit reached',
      ok: 'Continue',
      cancel: 'Finish',
    })
    if (!goOn) goBack('/')
  }
  const timeboxSecs = useRef(0)
  useEffect(() => {
    void api
      .get<{ reviewing: { timeLimitSecs: number } }>('/api/preferences')
      .then((p) => (timeboxSecs.current = p.reviewing.timeLimitSecs))
      .catch(() => {})
  }, [])

  // ---- actions ----------------------------------------------------------------------------

  const replay = useCallback(async () => {
    const s = stateRef.current
    if (!s?.card) return
    if (sideRef.current === 'question') await playQ(s.card.questionAv)
    else {
      const a = answerRef.current
      if (!a) return
      const tags = s.deckConf?.replayQuestion ? [...a.questionAv, ...a.answerAv] : a.answerAv
      await playQ(tags)
    }
  }, [])

  const playRef = async (ref: string) => {
    // play:q:N / play:a:N from a play button in the card
    const [, which, n] = ref.split(':')
    const s = stateRef.current
    if (!s?.card) return
    const list = which === 'q' ? (answerRef.current?.questionAv ?? s.card.questionAv) : answerRef.current?.answerAv
    const tag = list?.[Number(n)]
    if (tag) await playQ([tag])
  }

  const undoAction = async () => {
    if (whiteboard && board.current?.undo()) return
    const res = await attempt(() => api.post<{ name: string }>('/api/undo'))
    if (res) {
      toast(`Undone: ${res.name}`)
      await load()
    }
  }

  const redoAction = async () => {
    const res = await attempt(() => api.post<{ name: string }>('/api/redo'))
    if (res) {
      toast(`Redone: ${res.name}`)
      await load()
    }
  }

  const setFlag = async (flag: number) => {
    const s = stateRef.current
    if (!s?.card) return
    const next = s.card.flag === flag ? 0 : flag
    if (await attempt(() => api.post('/api/cards/flag', { cardIds: [s.card!.id], flag: next }))) {
      setState({ ...s, card: { ...s.card, flag: next } })
      view.current?.setFlag(next)
    }
  }

  const act = async (what: string) => {
    const s = stateRef.current
    if (!s?.card) return
    const c = s.card
    switch (what) {
      case 'mark': {
        const res = await attempt(() => api.post<{ marked: boolean }>('/api/notes/mark', { noteIds: [c.noteId] }))
        if (res) {
          setState({ ...s, card: { ...c, marked: res.marked } })
          view.current?.setMark(res.marked)
        }
        break
      }
      case 'buryCard':
        if (await attempt(() => api.post('/api/cards/bury', { cardIds: [c.id] }))) {
          toast('Card buried', { label: 'Undo', run: undoAction })
          await load()
        }
        break
      case 'buryNote':
        if (await attempt(() => api.post('/api/notes/bury', { noteIds: [c.noteId] }))) {
          toast('Note buried', { label: 'Undo', run: undoAction })
          await load()
        }
        break
      case 'suspendCard':
        if (await attempt(() => api.post('/api/cards/suspend', { cardIds: [c.id], suspend: true }))) {
          toast('Card suspended', { label: 'Undo', run: undoAction })
          await load()
        }
        break
      case 'suspendNote':
        if (await attempt(() => api.post('/api/notes/suspend', { noteIds: [c.noteId] }))) {
          toast('Note suspended', { label: 'Undo', run: undoAction })
          await load()
        }
        break
      case 'delete':
        if (await confirm('Delete this note and all its cards?', { ok: 'Delete', danger: true })) {
          if (await attempt(() => api.post('/api/notes/delete', { noteIds: [c.noteId] }))) {
            toast('Note deleted', { label: 'Undo', run: undoAction })
            await load()
          }
        }
        break
      case 'edit':
        navigate(`/note/${c.noteId}?card=${c.id}`)
        break
      case 'add':
        navigate(`/note/add?deck=${c.deckId}`)
        break
      case 'tags':
        if (await editNoteTags(c.noteId)) await load()
        break
      case 'setDue':
        if (await setDueDate([c.id])) await load()
        break
      case 'reset':
        if (await forgetCards([c.id])) await load()
        break
      case 'cardInfo':
        navigate(`/page/card-info/${c.id}`)
        break
      case 'previousCardInfo':
        if (previousCard.current) navigate(`/page/card-info/${previousCard.current}`)
        else toast('No previous card')
        break
      case 'deckOptions':
        navigate(`/page/deck-options/${c.deckId}`)
        break
      case 'browse':
        navigate(`/browse?search=${encodeURIComponent(`cid:${c.id}`)}`)
        break
      case 'statistics':
        navigate('/page/graphs')
        break
    }
  }

  const runAction = useCallback(
    (a: GestureAction | string) => {
      unlockAudio()
      const s = sideRef.current
      switch (a) {
        case 'none':
          return
        case 'showAnswer':
          return void showAnswer()
        case 'flipOrAnswer1':
        case 'flipOrAnswer2':
        case 'flipOrAnswer3':
        case 'flipOrAnswer4':
          return void (s === 'question' ? showAnswer() : answerCard(Number(a.slice(-1))))
        case 'answer1':
        case 'answer2':
        case 'answer3':
        case 'answer4':
          return void answerCard(Number(a.slice(-1)))
        case 'undo':
          return void undoAction()
        case 'redo':
          return void redoAction()
        case 'replay':
        case 'playMedia':
          return void replay()
        case 'toggleWhiteboard':
          return setWhiteboard((w) => !w)
        case 'toggleAutoAdvance':
          return setAutoAdvance((v) => {
            toast(v ? 'Auto advance disabled' : 'Auto advance enabled')
            return !v
          })
        case 'exit':
        case 'abort':
          return goBack('/')
        case 'pageUp':
          return view.current?.scroll(-0.8)
        case 'pageDown':
          return view.current?.scroll(0.8)
        case 'showHint':
          return view.current?.hint(false)
        case 'showAllHints':
          return view.current?.hint(true)
        case 'flagRed':
          return void setFlag(1)
        case 'flagOrange':
          return void setFlag(2)
        case 'flagGreen':
          return void setFlag(3)
        case 'flagBlue':
          return void setFlag(4)
        case 'flagPink':
          return void setFlag(5)
        case 'flagTurquoise':
          return void setFlag(6)
        case 'flagPurple':
          return void setFlag(7)
        case 'unflag':
          return void setFlag(0)
        case 'bury':
          return void act('buryCard')
        case 'suspend':
          return void act('suspendCard')
        case 'tagsDialog':
          return void act('tags')
        case 'resetCard':
          return void act('reset')
        case 'setDueDate':
          return void act('setDue')
        default:
          return void act(a)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showAnswer, answerCard, replay],
  )

  // ---- keyboard (AnkiDroid's default bindings) --------------------------------------------

  const onKey = useCallback(
    (k: { key: string; ctrl: boolean; shift: boolean; alt: boolean }) => {
      const s = sideRef.current
      if (k.ctrl && !k.alt && /^[1-7]$/.test(k.key)) return void setFlag(Number(k.key))
      if (k.ctrl && k.alt && k.key.toLowerCase() === 'i') return void act('previousCardInfo')
      if (k.ctrl && k.alt && k.key.toLowerCase() === 'n') return void act('reset')
      if (k.ctrl && k.key.toLowerCase() === 'z') return void (k.shift ? redoAction() : undoAction())
      if (k.ctrl) return
      if (k.key === ' ' || k.key === 'Enter') return void (s === 'question' ? showAnswer() : answerCard(3))
      if (s === 'answer' && /^[1-4]$/.test(k.key)) return void answerCard(Number(k.key))
      switch (k.key) {
        case 'e':
          return void act('edit')
        case 'a':
          return void act('add')
        case 'A':
          return runAction('toggleAutoAdvance')
        case '*':
          return void act('mark')
        case '-':
          return void act('buryCard')
        case '=':
          return void act('buryNote')
        case '@':
          return void act('suspendCard')
        case '!':
          return void act('suspendNote')
        case 'r':
        case 'F5':
          return void replay()
        case 'h':
          return view.current?.hint(false)
        case 'g':
          return view.current?.hint(true)
        case 'b':
          return void act('browse')
        case 't':
          return void act('statistics')
        case 'Escape':
          return goBack('/')
        case 'PageUp':
          return view.current?.scroll(-0.8)
        case 'PageDown':
          return view.current?.scroll(0.8)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showAnswer, answerCard, replay, runAction],
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (document.querySelector('.dialog, .menu')) return
      onKey({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey })
      if ([' ', 'Enter'].includes(e.key)) e.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onKey])

  // ---- events from the card frame -------------------------------------------------------

  const onFrame = useCallback(
    (e: FrameEvent) => {
      const p = getPrefs()
      switch (e.type) {
        case 'bridge':
          if (e.cmd === 'ans') return void showAnswer()
          if (/^ease[1-4]$/.test(e.cmd)) return void answerCard(Number(e.cmd.slice(4)))
          if (e.cmd.startsWith('play:')) return void playRef(e.cmd)
          if (e.cmd === 'edit') return void act('edit')
          return
        case 'key':
          return onKey(e)
        case 'reload':
          return void load()
        case 'jsapi': {
          const s = stateRef.current
          const theme = document.documentElement.dataset.theme
          void handleJsApi(e.endpoint, e.data, {
            card: s?.card ?? null,
            counts: s?.counts ?? null,
            side: sideRef.current,
            labels: answerRef.current?.labels ?? [],
            night: theme === 'dark' || theme === 'black',
            showAnswer: () => void showAnswer(),
            answer: (ease) => void answerCard(ease),
            act,
            setFlag,
            reload: () => void load(),
            openMenu: () => setMenuAt({ x: window.innerWidth - 16, y: 56 }),
          })
            .catch(() => JSON.stringify({ success: false, value: null }))
            .then((text) => view.current?.replyJsApi(e.id, text))
          return
        }
        case 'tap': {
          if (!p.gesturesEnabled) return
          const name = `tap${e.zone}` as keyof typeof p.gestures
          return runAction(p.gestures[name] ?? 'none')
        }
        case 'swipe':
          if (!p.gesturesEnabled) return
          return runAction(p.gestures[`swipe${e.dir}`])
        case 'double-tap':
          if (!p.gesturesEnabled) return
          return runAction(p.gestures.doubleTap)
        case 'long-press':
          if (!p.gesturesEnabled) return
          return runAction(p.gestures.longPress)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showAnswer, answerCard, onKey, runAction, load],
  )

  // ---- menus --------------------------------------------------------------------------------

  const [flagNames, setFlagNames] = useState<{ flag: number; name: string }[]>([])
  useEffect(() => {
    void getFlagNames().then(setFlagNames)
  }, [])

  const flagItems = (): MenuItem[] => [
    { label: 'No flag', checked: card?.flag === 0, onClick: () => setFlag(0) },
    ...flagNames.map((f) => ({
      label: f.name,
      icon: 'flag' as const,
      color: FLAG_COLORS[f.flag],
      checked: card?.flag === f.flag,
      onClick: () => setFlag(f.flag),
    })),
  ]

  const overflowItems = (): MenuItem[] => [
    { label: 'Redo', icon: 'redo', disabled: !state?.undo.redo, onClick: redoAction },
    { label: card?.marked ? 'Unmark note' : 'Mark note', icon: card?.marked ? 'star' : 'starBorder', onClick: () => act('mark') },
    { label: 'Flag', icon: 'flag', submenu: flagItems() },
    { label: 'Edit note', icon: 'edit', onClick: () => act('edit') },
    { label: 'Add note', icon: 'add', onClick: () => act('add') },
    { label: 'Edit tags', icon: 'tag', onClick: () => act('tags') },
    card?.hasSiblings
      ? {
          label: 'Bury',
          icon: 'bury',
          submenu: [
            { label: 'Bury card', onClick: () => act('buryCard') },
            { label: 'Bury note', onClick: () => act('buryNote') },
          ],
        }
      : { label: 'Bury card', icon: 'bury', onClick: () => act('buryCard') },
    card?.hasSiblings
      ? {
          label: 'Suspend',
          icon: 'suspend',
          submenu: [
            { label: 'Suspend card', onClick: () => act('suspendCard') },
            { label: 'Suspend note', onClick: () => act('suspendNote') },
          ],
        }
      : { label: 'Suspend card', icon: 'suspend', onClick: () => act('suspendCard') },
    {
      label: 'Schedule',
      icon: 'event',
      submenu: [
        { label: 'Set due date', onClick: () => act('setDue') },
        { label: 'Reset card', onClick: () => act('reset') },
      ],
    },
    { label: 'Delete note', icon: 'delete', onClick: () => act('delete') },
    { label: 'Replay audio', icon: 'volume', onClick: replay },
    { label: whiteboard ? 'Hide whiteboard' : 'Show whiteboard', icon: 'brush', onClick: () => setWhiteboard((w) => !w) },
    {
      label: autoAdvance ? 'Stop auto advance' : 'Auto advance',
      icon: 'timer',
      hidden: !(conf && (conf.secondsToShowQuestion || conf.secondsToShowAnswer)),
      onClick: () => runAction('toggleAutoAdvance'),
    },
    { label: 'Card info', icon: 'info', onClick: () => act('cardInfo') },
    { label: 'Previous card info', icon: 'info', disabled: !previousCard.current, onClick: () => act('previousCardInfo') },
    { label: 'Deck options', icon: 'settings', onClick: () => act('deckOptions') },
    { label: 'Browse', icon: 'search', onClick: () => act('browse') },
    { label: 'Statistics', icon: 'stats', onClick: () => act('statistics') },
  ]

  const [openOverflow, overflowMenu] = useMenu(overflowItems)
  const [openFlags, flagMenu] = useMenu(flagItems)

  // ---- render -------------------------------------------------------------------------------

  const counts = state?.counts
  const showAnswerButtons = prefs.showAnswerButtons
  const labels = answer?.labels ?? []
  const buttons = prefs.hideHardAndEasy ? [1, 3] : [1, 2, 3, 4]

  return (
    <div className="screen reviewer" onPointerDown={unlockAudio}>
      {!prefs.fullscreen && (
        <AppBar title={card?.deckName.split('::').pop() ?? ''} nav="back" onNav={() => goBack('/')}>
          <IconButton icon="undo" label={state?.undo.undo ? `Undo ${state.undo.undo}` : 'Undo'} disabled={!state?.undo.undo && !whiteboard} onClick={undoAction} />
          <IconButton
            icon="flag"
            label="Flag"
            onClick={openFlags}
            style={card?.flag ? { color: FLAG_COLORS[card.flag] } : undefined}
          />
          <IconButton icon="edit" label="Edit note" onClick={() => act('edit')} />
          <IconButton icon="more" label="More" onClick={openOverflow} />
        </AppBar>
      )}
      {prefs.showTopBar && counts && (
        <div className="review-topbar">
          {state?.showRemaining !== false && (
            <div className="review-counts">
              <span className={`count new${card?.queue === 'new' ? ' current' : ''}`}>{counts.new}</span>
              <span className={`count learn${card?.queue === 'learn' ? ' current' : ''}`}>{counts.learn}</span>
              <span className={`count review${card?.queue === 'review' ? ' current' : ''}`}>{counts.review}</span>
            </div>
          )}
          <div className="answer-indicator">
            {lastEase && <span className={`dot ease${lastEase}`} title={EASE_NAMES[lastEase - 1]} />}
          </div>
          {card?.marked && <Icon name="star" className="topbar-mark" />}
          {!!card?.flag && <Icon name="flag" className="topbar-flag" style={{ fill: FLAG_COLORS[card.flag] }} />}
          {autoAdvance && <Icon name="timer" className="topbar-auto" />}
          {conf?.showTimer && card && <Timer key={card.id} limit={conf.maxTakenSecs} stopped={side === 'answer' && conf.stopTimerOnAnswer} />}
        </div>
      )}
      <div className="card-area">
        <CardView
          ref={view}
          className="card-frame"
          onEvent={onFrame}
          onReady={() => setFrameReady(true)}
          gestures={prefs.gesturesEnabled}
          doubleTap={prefs.gesturesEnabled && prefs.gestures.doubleTap !== 'none'}
        />
        {whiteboard && <Whiteboard ref={board} onClose={() => setWhiteboard(false)} />}
        {!state && <div className="spinner card-spinner" />}
      </div>
      {showAnswerButtons && (
        <div className="answer-area" style={{ fontSize: `${prefs.answerButtonSize}%` }}>
          {side === 'question' ? (
            <button className="show-answer" onClick={() => void showAnswer()} disabled={!card || busy}>
              Show Answer
            </button>
          ) : (
            buttons.map((ease) => (
              <button key={ease} className={`ease-btn ease${ease}`} onClick={() => void answerCard(ease)} disabled={busy}>
                {state?.showIntervals !== false && prefs.showIntervalsOnButtons && <span className="ivl">{labels[ease - 1]}</span>}
                <span className="name">{EASE_NAMES[ease - 1]}</span>
              </button>
            ))
          )}
        </div>
      )}
      {prefs.fullscreen && (
        <button className="fullscreen-menu" aria-label="Menu" onClick={(e) => setMenuAt({ x: e.clientX, y: e.clientY })}>
          <Icon name="more" />
        </button>
      )}
      {menuAt && <Menu anchor={menuAt} items={[{ label: 'Undo', icon: 'undo', onClick: undoAction }, ...overflowItems(), { label: 'Exit', icon: 'back', onClick: () => goBack('/') }]} onClose={() => setMenuAt(null)} />}
      {overflowMenu}
      {flagMenu}
    </div>
  )
}

function Timer({ limit, stopped }: { limit: number; stopped: boolean }) {
  const [start] = useState(Date.now())
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (stopped) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [stopped])
  const secs = Math.min(Math.floor((now - start) / 1000), limit || Infinity)
  const over = limit > 0 && secs >= limit
  return (
    <span className="answer-timer" style={over ? { color: 'var(--learn)' } : undefined}>
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
    </span>
  )
}

export function formatDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)} seconds`
  if (secs < 3600) return `${Math.round(secs / 60)} minutes`
  if (secs < 86400) return `${Math.round(secs / 360) / 10} hours`
  return `${Math.round(secs / 8640) / 10} days`
}
