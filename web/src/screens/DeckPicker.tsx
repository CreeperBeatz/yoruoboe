/**
 * The deck list (AnkiDroid's DeckPicker): nested decks with their due counts, the sync
 * button, the + menu (in the bar, so the tab bar under the list never changes), and each
 * deck's long-press menu.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type DeckList, type DeckNode, type Me } from '../api'
import { navigate } from '../router'
import { sync, useSync } from '../sync'
import { afterExit } from '../ui/motion'
import { AppBar, attempt, IconButton, Menu, overlayOpen, prompt, toast, useLongPress, useMenu, type MenuItem } from '../ui/components'
import { Icon } from '../ui/icons'
import { InstallNote } from '../install/InstallGuide'
import { collectionTools } from './tools'
import { deckActions } from './deckActions'
import { exportDialog } from './ImportExport'
import './deckpicker.css'

/** The list comes in row by row the first time it is shown, not on every return to it. */
let listShown = false

/** A deck's subdecks, all the way down. */
function descendants(deck: DeckNode): number[] {
  return deck.children.flatMap((c) => [c.id, ...descendants(c)])
}

export default function DeckPicker({ onMenu }: { onMenu: () => void; me: Me }) {
  const [data, setData] = useState<DeckList | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ deck: DeckNode; at: { x: number; y: number } } | null>(null)
  // Rows moving because a deck was expanded or collapsed.
  const [moving, setMoving] = useState<{ ids: Set<number>; dir: 'in' | 'out' } | null>(null)
  const [intro] = useState(() => !listShown)
  const { syncing, state, generation } = useSync()

  const load = useCallback(async () => {
    try {
      setData(await api.get<DeckList>('/api/decks'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, generation])

  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [load])

  const undo = async () => {
    const res = await attempt(() => api.post<{ name: string }>('/api/undo'))
    if (res) toast(`Undone: ${res.name}`)
    void load()
  }

  const [openAdd, addMenu] = useMenu(() => addItems(load))
  const [openOverflow, overflowMenu] = useMenu((): MenuItem[] => [
    { label: data?.undo.undo ? `Undo ${data.undo.undo}` : 'Undo', icon: 'undo', disabled: !data?.undo.undo, onClick: undo },
    ...collectionTools(load),
  ])

  const rows = useMemo(() => {
    if (!data) return []
    const out: DeckNode[] = []
    const q = search?.trim().toLowerCase()
    const walk = (nodes: DeckNode[]) => {
      for (const n of nodes) {
        if (q) {
          if (n.name.toLowerCase().includes(q) || fullName(data.decks, n.id)?.toLowerCase().includes(q)) out.push(n)
          walk(n.children)
        } else {
          out.push(n)
          if (!n.collapsed) walk(n.children)
        }
      }
    }
    walk(data.decks)
    return out
  }, [data, search])

  const toggle = async (deck: DeckNode) => {
    const ids = new Set(descendants(deck))
    if (!deck.collapsed) {
      // Collapsing: the subdecks fold away first.
      setMoving({ ids, dir: 'out' })
      await new Promise<void>((r) => afterExit(r, 140))
    }
    await attempt(() => api.post(`/api/decks/${deck.id}/collapse`, { collapsed: !deck.collapsed }))
    setMoving(deck.collapsed ? { ids, dir: 'in' } : null)
    await load()
  }

  useEffect(() => {
    if (data) listShown = true
  }, [data])

  const open = (deck: DeckNode, toOverview = false) => {
    const due = deck.new + deck.learn + deck.review
    localStorage.setItem('anki-last-deck', String(deck.id))
    if (!toOverview && due > 0) {
      // Selecting the deck makes it current; the reviewer then studies the current deck.
      void api.get(`/api/decks/${deck.id}`).then(() => navigate('/review'))
    } else navigate(`/deck/${deck.id}`)
  }

  // AnkiDroid's deck picker shortcuts (DeckPicker.onKeyUp), for a keyboard on a tablet.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (overlayOpen()) return
      const k = e.key
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.shiftKey && k.toLowerCase() === 'i') navigate('/import-export')
      else if (ctrl && e.shiftKey && k.toLowerCase() === 'n') navigate('/notetypes')
      else if (ctrl && k.toLowerCase() === 'e') exportDialog({})
      else if (ctrl) return
      else if (k === 'a') navigate('/note/add')
      else if (k === 'b') navigate('/browse')
      else if (k === 'y') void sync().then(load)
      else if (k === '/') setSearch('')
      else if (k === 's') navigate('/review')
      else if (k === 't') navigate('/page/graphs')
      else if (k === 'p') navigate('/settings')
      else if (k === 'f') navigate('/filtered/0')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [load])

  const pending = state?.pending || false
  const conflict = state?.conflict || false

  return (
    <div className="screen">
      {search === null ? (
        <AppBar title="Anki" nav="menu" onNav={onMenu}>
          <IconButton icon="add" label="Add" onClick={openAdd} />
          <IconButton icon="search" label="Search decks" onClick={() => setSearch('')} />
          {data?.undo.undo && <IconButton icon="undo" label={`Undo ${data.undo.undo}`} onClick={undo} />}
          <IconButton
            icon="sync"
            label="Sync"
            spin={syncing}
            dot={!syncing && (pending || conflict)}
            onClick={() => void sync().then(load)}
          />
          <IconButton icon="more" label="More" onClick={openOverflow} />
        </AppBar>
      ) : (
        <AppBar title={<DeckSearch value={search} onChange={setSearch} />} nav="back" onNav={() => setSearch(null)} />
      )}
      {syncing && <div className="progress-bar" />}
      <div className="screen-body deck-list">
        <PullToSync onSync={() => sync().then(load)} />
        {search === null && <InstallNote />}
        {error && !data && <div className="center-message">{error}</div>}
        {!data && !error && <div className="spinner" />}
        {data && data.cardCount === 0 && rows.length <= 1 && !search && <EmptyCollection />}
        {rows.map((deck, i) => (
          <DeckRow
            key={deck.id}
            motion={
              moving?.ids.has(deck.id)
                ? { cls: `row-${moving.dir}`, delay: moving.dir === 'in' ? 20 * [...moving.ids].indexOf(deck.id) : 0 }
                : intro && !search
                  ? { cls: 'row-in', delay: Math.min(i, 12) * 30 }
                  : undefined
            }
            deck={deck}
            current={deck.id === data?.current}
            searching={!!search}
            fullName={search ? fullName(data!.decks, deck.id) : undefined}
            onToggle={() => toggle(deck)}
            onOpen={(overview) => open(deck, overview)}
            onMenu={(at) => setMenu({ deck, at })}
          />
        ))}
        {data && <div className="studied-today">{data.studiedToday}</div>}
        {state?.lastError && !syncing && (
          <div className="sync-error">
            <Icon name="cloudOff" /> {state.lastError}
          </div>
        )}
        <div style={{ height: 96 }} />
      </div>
      {addMenu}
      {overflowMenu}
      {menu && (
        <Menu anchor={menu.at} items={deckActions(menu.deck, load)} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

function fullName(decks: DeckNode[], id: number, prefix = ''): string | undefined {
  for (const d of decks) {
    const name = prefix ? `${prefix}::${d.name}` : d.name
    if (d.id === id) return name
    const found = fullName(d.children, id, name)
    if (found) return found
  }
  return undefined
}

function DeckSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="deck-search"
      autoFocus
      placeholder="Search decks"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function Count({ n, kind }: { n: number; kind: 'new' | 'learn' | 'review' }) {
  return <span className={`count ${kind}${n === 0 ? ' zero' : ''}`}>{n}</span>
}

function DeckRow({
  deck,
  motion,
  current,
  searching,
  fullName,
  onToggle,
  onOpen,
  onMenu,
}: {
  deck: DeckNode
  motion?: { cls: string; delay: number }
  current: boolean
  searching: boolean
  fullName?: string
  onToggle: () => void
  onOpen: (overview: boolean) => void
  onMenu: (at: { x: number; y: number }) => void
}) {
  const press = useLongPress(onMenu)
  const hasChildren = deck.children.length > 0
  return (
    <div
      className={`deck-row${current ? ' current' : ''}${motion ? ` ${motion.cls}` : ''}`}
      style={{ paddingLeft: searching ? 8 : 8 + (deck.level - 1) * 14, animationDelay: motion?.delay ? `${motion.delay}ms` : undefined }}
      {...press.handlers}
    >
      <button
        className="deck-expander"
        aria-label={deck.collapsed ? 'Expand' : 'Collapse'}
        style={{ visibility: hasChildren && !searching ? 'visible' : 'hidden' }}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        <Icon name="expandMore" className={deck.collapsed ? 'collapsed' : undefined} />
      </button>
      <button
        className={`deck-name${deck.filtered ? ' filtered' : ''}`}
        onClick={() => !press.consumed() && onOpen(false)}
      >
        {fullName ?? deck.name}
      </button>
      <button className="deck-counts" onClick={() => !press.consumed() && onOpen(true)}>
        <Count n={deck.new} kind="new" />
        <Count n={deck.learn} kind="learn" />
        <Count n={deck.review} kind="review" />
      </button>
    </div>
  )
}

function EmptyCollection() {
  return (
    <div className="center-message">
      <p style={{ fontSize: 18, color: 'var(--text)' }}>Your collection is empty</p>
      <p>Add cards with the + button, import a deck, or sync if you have cards on another device.</p>
    </div>
  )
}

/** What + offers: AnkiDroid's speed dial, as a menu. */
function addItems(reload: () => void): MenuItem[] {
  const createDeck = async () => {
    const name = await prompt('Create deck', { label: 'Deck name', ok: 'Create' })
    if (!name?.trim()) return
    const res = await attempt(() => api.post<{ id: number }>('/api/decks', { name }))
    if (res) {
      toast(`Deck created`)
      reload()
    }
  }
  return [
    { label: 'Add', icon: 'add', onClick: () => navigate('/note/add') },
    { label: 'Image occlusion', icon: 'image', onClick: () => navigate('/note/add?io=1') },
    'separator',
    { label: 'Create deck', icon: 'folder', onClick: createDeck },
    { label: 'Create filtered deck', icon: 'filter', onClick: () => navigate('/filtered/0') },
    'separator',
    { label: 'Get shared decks', icon: 'download', onClick: () => window.open('https://ankiweb.net/shared/decks', '_blank', 'noopener') },
  ]
}

/** Pull down at the top of the list to sync, as in AnkiDroid. */
function PullToSync({ onSync }: { onSync: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const list = ref.current?.parentElement
    if (!list) return
    let startY: number | null = null
    let dist = 0
    const down = (e: TouchEvent) => {
      startY = list.scrollTop <= 0 ? e.touches[0].clientY : null
      dist = 0
      setDragging(startY !== null)
    }
    const move = (e: TouchEvent) => {
      if (startY === null) return
      dist = Math.max(0, e.touches[0].clientY - startY)
      setPull(Math.min(dist, 120))
    }
    const up = () => {
      if (startY !== null && dist > 90) onSync()
      startY = null
      setDragging(false)
      setPull(0)
    }
    list.addEventListener('touchstart', down, { passive: true })
    list.addEventListener('touchmove', move, { passive: true })
    list.addEventListener('touchend', up)
    return () => {
      list.removeEventListener('touchstart', down)
      list.removeEventListener('touchmove', move)
      list.removeEventListener('touchend', up)
    }
  }, [onSync])
  return (
    <div ref={ref} className={`pull-to-sync${dragging ? '' : ' settling'}`} style={{ height: pull * 0.6, opacity: Math.min(1, pull / 90) }}>
      <span className={`pull-disc${pull > 90 ? ' armed' : ''}`} style={{ transform: `rotate(${pull * 3}deg) scale(${Math.min(1, pull / 60)})` }}>
        <Icon name="sync" />
      </span>
    </div>
  )
}
