/** The card previewer (AnkiDroid's PreviewerFragment): step through cards, both sides. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { playAv, stopAudio, unlockAudio, type AvTag } from '../audio'
import { goBack, navigate } from '../router'
import { AppBar, attempt, IconButton, useMenu, type MenuItem } from '../ui/components'
import { FLAG_COLORS, getFlagNames } from '../ui/dialogs'
import { CardView, type CardViewHandle, type FrameEvent } from './CardView'
import './reviewer.css'

interface Rendered {
  id: number
  noteId: number
  question: string
  answer: string
  questionAv: AvTag[]
  answerAv: AvTag[]
  bodyClass: string
  flag: number
  marked: boolean
}

export default function Previewer({ query }: { query: URLSearchParams }) {
  const [ids, setIds] = useState<number[]>([])
  const [index, setIndex] = useState(0)
  const [card, setCard] = useState<Rendered | null>(null)
  const [showingAnswer, setShowingAnswer] = useState(false)
  const [backOnly, setBackOnly] = useState(false)
  const [ready, setReady] = useState(false)
  const view = useRef<CardViewHandle>(null)

  useEffect(() => {
    void (async () => {
      let list: number[] = []
      const note = query.get('note')
      if (note) list = (await api.get<{ cardIds: number[] }>(`/api/notes/${note}`)).cardIds
      else list = JSON.parse(sessionStorage.getItem('preview-cards') || '[]')
      setIds(list)
      const start = Number(query.get('start'))
      setIndex(Math.max(0, list.indexOf(start)))
    })()
  }, [query])

  const load = useCallback(async () => {
    const id = ids[index]
    if (!id) return
    const r = await attempt(() => api.get<Rendered>(`/api/cards/${id}/render?browser=true`))
    if (r) {
      setCard(r)
      setShowingAnswer(backOnly)
    }
  }, [ids, index, backOnly])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!ready || !card) return
    stopAudio()
    if (showingAnswer) {
      view.current?.showQuestion(card.answer, card.answer, card.bodyClass, card.flag, card.marked)
      void playAv(card.answerAv)
    } else {
      view.current?.showQuestion(card.question, card.answer, card.bodyClass, card.flag, card.marked)
      void playAv(card.questionAv)
    }
  }, [ready, card, showingAnswer])

  const next = () => {
    if (!showingAnswer) return setShowingAnswer(true)
    if (index < ids.length - 1) setIndex(index + 1)
  }
  const prev = () => {
    if (showingAnswer && !backOnly) return setShowingAnswer(false)
    if (index > 0) setIndex(index - 1)
  }

  const replay = async () => card && playAv(showingAnswer ? card.answerAv : card.questionAv)

  const setFlag = async (flag: number) => {
    if (!card) return
    const f = card.flag === flag ? 0 : flag
    if (await attempt(() => api.post('/api/cards/flag', { cardIds: [card.id], flag: f }))) setCard({ ...card, flag: f })
  }
  const mark = async () => {
    if (!card) return
    const r = await attempt(() => api.post<{ marked: boolean }>('/api/notes/mark', { noteIds: [card.noteId] }))
    if (r) setCard({ ...card, marked: r.marked })
  }

  const [flagNames, setFlagNames] = useState<{ flag: number; name: string }[]>([])
  useEffect(() => void getFlagNames().then(setFlagNames), [])

  const [openMenu, menu] = useMenu((): MenuItem[] => [
    { label: 'Back side only', checked: backOnly, onClick: () => setBackOnly(!backOnly) },
    { label: card?.marked ? 'Unmark note' : 'Mark note', icon: 'star', onClick: mark },
    { label: 'Flag', icon: 'flag', submenu: [{ label: 'No flag', onClick: () => setFlag(0) }, ...flagNames.map((f) => ({ label: f.name, icon: 'flag' as const, color: FLAG_COLORS[f.flag], onClick: () => setFlag(f.flag) }))] },
    { label: 'Edit note', icon: 'edit', onClick: () => card && navigate(`/note/${card.noteId}`) },
    { label: 'Card info', icon: 'info', onClick: () => card && navigate(`/page/card-info/${card.id}`) },
  ])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const k = e.key
      if (k === 'ArrowRight' || k === ' ' || k === 'Enter') next()
      else if (k === 'ArrowLeft') prev()
      else if (k === 'r') void replay()
      else if (k === '*') void mark()
      else if (k === 'e' && card) navigate(`/note/${card.noteId}`)
      else if (k === 'b') setBackOnly((b) => !b)
      else if ((e.ctrlKey || e.metaKey) && /^[1-7]$/.test(k)) void setFlag(Number(k))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const onFrame = (e: FrameEvent) => {
    if (e.type === 'bridge' && e.cmd.startsWith('play:')) {
      const [, side, n] = e.cmd.split(':')
      const tag = (side === 'q' ? card?.questionAv : card?.answerAv)?.[Number(n)]
      if (tag) void playAv([tag])
    } else if (e.type === 'key') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, ctrlKey: e.ctrl, shiftKey: e.shift, altKey: e.alt }))
    }
  }

  return (
    <div className="screen reviewer" onPointerDown={unlockAudio}>
      <AppBar title="Preview" subtitle={ids.length ? `${index + 1} / ${ids.length}` : undefined} nav="back" onNav={() => goBack('/browse')}>
        <IconButton icon="volume" label="Replay" onClick={() => void replay()} />
        <IconButton icon="more" label="More" onClick={openMenu} />
      </AppBar>
      <div className="card-area">
        <CardView ref={view} className="card-frame" onEvent={onFrame} onReady={() => setReady(true)} />
      </div>
      {ids.length > 1 && (
        <input
          type="range"
          min={0}
          max={ids.length - 1}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />
      )}
      <div className="answer-area">
        <button className="show-answer" style={{ background: 'var(--hard)' }} onClick={prev} disabled={index === 0 && (!showingAnswer || backOnly)}>
          ‹ Back
        </button>
        <button className="show-answer" onClick={next} disabled={index >= ids.length - 1 && showingAnswer}>
          {showingAnswer ? 'Next ›' : 'Show answer'}
        </button>
      </div>
      {menu}
    </div>
  )
}
