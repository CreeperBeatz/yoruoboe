/** Dialogs the study screen, the browser and the editor share (AnkiDroid's dialogs/). */

import { useEffect, useMemo, useState } from 'react'
import { api, type DeckList, type DeckNode } from '../api'
import { attempt, Dialog, prompt, showDialog, toast } from './components'

// ---- tags ------------------------------------------------------------------------------

/** AnkiDroid's TagsDialog: every tag with a checkbox, a filter that can also add one. */
function TagsEditor({
  title,
  initial,
  indeterminate,
  onDone,
  close,
}: {
  title: string
  initial: string[]
  indeterminate?: string[]
  onDone: (checked: string[], unchecked: string[]) => void
  close: () => void
}) {
  const [all, setAll] = useState<string[]>([])
  const [checked, setChecked] = useState(() => new Set(initial))
  const [partial, setPartial] = useState(() => new Set(indeterminate ?? []))
  const [filter, setFilter] = useState('')
  useEffect(() => {
    void api.get<string[]>('/api/tags').then((t) => setAll([...new Set([...t, ...initial])]))
  }, [initial])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = all.filter((t) => !q || t.toLowerCase().includes(q))
    return list.sort((a, b) => Number(checked.has(b)) - Number(checked.has(a)) || a.localeCompare(b))
  }, [all, filter, checked])
  const toggle = (t: string) => {
    const next = new Set(checked)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    setChecked(next)
    if (partial.has(t)) {
      const p = new Set(partial)
      p.delete(t)
      setPartial(p)
    }
  }
  const addFromFilter = () => {
    const t = filter.trim().replace(/\s+/g, '_')
    if (!t) return
    if (!all.includes(t)) setAll([t, ...all])
    setChecked(new Set([...checked, t]))
    setFilter('')
  }
  return (
    <Dialog
      title={title}
      onClose={close}
      actions={
        <>
          <button className="text-btn" onClick={close}>
            Cancel
          </button>
          <button
            className="text-btn"
            onClick={() => {
              close()
              const unchecked = [...initial, ...(indeterminate ?? [])].filter((t) => !checked.has(t) && !partial.has(t))
              onDone([...checked], unchecked)
            }}
          >
            OK
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          addFromFilter()
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          className="input"
          placeholder="Filter or add a tag"
          value={filter}
          autoCapitalize="none"
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter.trim() && !all.includes(filter.trim()) && (
          <button className="text-btn" type="submit">
            Add
          </button>
        )}
      </form>
      <div style={{ maxHeight: '50vh', overflowY: 'auto', margin: '8px -8px 0' }}>
        {shown.map((t) => (
          <label key={t} className="check-row" style={{ padding: '0 8px' }}>
            <input
              type="checkbox"
              checked={checked.has(t)}
              ref={(el) => {
                if (el) el.indeterminate = partial.has(t) && !checked.has(t)
              }}
              onChange={() => toggle(t)}
            />
            <span style={{ overflowWrap: 'anywhere' }}>{t}</span>
          </label>
        ))}
        {!shown.length && <div className="center-message" style={{ padding: 16 }}>No tags</div>}
      </div>
    </Dialog>
  )
}

export function editTags(opts: {
  title?: string
  initial: string[]
  indeterminate?: string[]
}): Promise<{ checked: string[]; unchecked: string[] } | null> {
  return new Promise((resolve) => {
    let settled = false
    showDialog((close) => (
      <TagsEditor
        title={opts.title ?? 'Tags'}
        initial={opts.initial}
        indeterminate={opts.indeterminate}
        close={() => {
          close()
          if (!settled) resolve(null)
        }}
        onDone={(checked, unchecked) => {
          settled = true
          resolve({ checked, unchecked })
        }}
      />
    ))
  })
}

/** Edit one note's tags. */
export async function editNoteTags(noteId: number): Promise<boolean> {
  const tags = await api.get<string[]>(`/api/notes/${noteId}/tags`)
  const res = await editTags({ initial: tags })
  if (!res) return false
  return !!(await attempt(() => api.post('/api/notes/set-tags', { noteId, tags: res.checked })))
}

// ---- deck chooser -------------------------------------------------------------------------

interface FlatDeck {
  id: number
  name: string
  filtered: boolean
}

function flatten(nodes: DeckNode[], prefix = '', out: FlatDeck[] = []): FlatDeck[] {
  for (const n of nodes) {
    const name = prefix ? `${prefix}::${n.name}` : n.name
    out.push({ id: n.id, name, filtered: n.filtered })
    flatten(n.children, name, out)
  }
  return out
}

function DeckChooser({
  title,
  current,
  allowFiltered,
  close,
  done,
}: {
  title: string
  current?: number
  allowFiltered: boolean
  close: () => void
  done: (d: FlatDeck) => void
}) {
  const [decks, setDecks] = useState<FlatDeck[]>([])
  const [filter, setFilter] = useState('')
  const load = () => api.get<DeckList>('/api/decks').then((d) => setDecks(flatten(d.decks)))
  useEffect(() => {
    void load()
  }, [])
  const q = filter.trim().toLowerCase()
  const shown = decks.filter((d) => (allowFiltered || !d.filtered) && (!q || d.name.toLowerCase().includes(q)))
  const create = async () => {
    const name = await prompt('Create deck', { initial: filter.trim(), ok: 'Create' })
    if (!name?.trim()) return
    const res = await attempt(() => api.post<{ id: number }>('/api/decks', { name: name.trim() }))
    if (res) {
      close()
      done({ id: res.id, name: name.trim(), filtered: false })
    }
  }
  return (
    <Dialog
      title={title}
      onClose={close}
      actions={
        <>
          <button className="text-btn" onClick={create}>
            Add deck
          </button>
          <button className="text-btn" onClick={close}>
            Cancel
          </button>
        </>
      }
    >
      <input className="input" placeholder="Search decks" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div style={{ maxHeight: '55vh', overflowY: 'auto', margin: '8px -24px 0' }}>
        {shown.map((d) => (
          <button
            key={d.id}
            className="menu-item"
            style={{ paddingLeft: 24, fontWeight: d.id === current ? 600 : undefined, color: d.filtered ? 'var(--dyn-deck)' : undefined }}
            onClick={() => {
              close()
              done(d)
            }}
          >
            {d.name}
          </button>
        ))}
      </div>
    </Dialog>
  )
}

export function chooseDeck(
  title = 'Choose deck',
  { current, allowFiltered = false }: { current?: number; allowFiltered?: boolean } = {},
): Promise<FlatDeck | null> {
  return new Promise((resolve) => {
    let settled = false
    showDialog((close) => (
      <DeckChooser
        title={title}
        current={current}
        allowFiltered={allowFiltered}
        close={() => {
          close()
          if (!settled) resolve(null)
        }}
        done={(d) => {
          settled = true
          resolve(d)
        }}
      />
    ))
  })
}

// ---- scheduling dialogs -----------------------------------------------------------------

/** Set due date (desktop's and AnkiDroid's): "0" today, "1!" tomorrow with interval 1, "3-7". */
export async function setDueDate(cardIds: number[]): Promise<boolean> {
  const { days: last } = await api.get<{ days: string }>('/api/cards/set-due-default')
  const days = await prompt('Set due date', {
    label: '0 = today, 1! = tomorrow and change interval to 1, 3-7 = random choice of 3-7 days',
    initial: last || '0',
    ok: 'Set',
  })
  if (days === null || !days.trim()) return false
  return !!(await attempt(() => api.post('/api/cards/set-due', { cardIds, days: days.trim() })))
}

function ForgetDialog({ count, close, done }: { count: number; close: () => void; done: (v: { restorePosition: boolean; resetCounts: boolean }) => void }) {
  const [restorePosition, setRestore] = useState(true)
  const [resetCounts, setReset] = useState(false)
  useEffect(() => {
    void api.get<{ restorePosition: boolean; resetCounts: boolean }>('/api/cards/forget-defaults').then((d) => {
      setRestore(d.restorePosition)
      setReset(d.resetCounts)
    })
  }, [])
  return (
    <Dialog
      title={count > 1 ? `Reset ${count} cards` : 'Reset card'}
      onClose={close}
      actions={
        <>
          <button className="text-btn" onClick={close}>
            Cancel
          </button>
          <button
            className="text-btn"
            onClick={() => {
              close()
              done({ restorePosition, resetCounts })
            }}
          >
            Reset
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>The cards become new cards again.</p>
      <label className="check-row">
        <input type="checkbox" checked={restorePosition} onChange={(e) => setRestore(e.target.checked)} />
        Restore original position where possible
      </label>
      <label className="check-row">
        <input type="checkbox" checked={resetCounts} onChange={(e) => setReset(e.target.checked)} />
        Reset repetition and lapse counts
      </label>
    </Dialog>
  )
}

export function forgetCards(cardIds: number[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    showDialog((close) => (
      <ForgetDialog
        count={cardIds.length}
        close={() => {
          close()
          if (!settled) resolve(false)
        }}
        done={async (opts) => {
          settled = true
          const ok = await attempt(() => api.post('/api/cards/forget', { cardIds, ...opts }))
          if (ok) toast('Card reset')
          resolve(!!ok)
        }}
      />
    ))
  })
}

function RepositionDialog({ close, done }: { close: () => void; done: (v: { start: number; step: number; randomize: boolean; shift: boolean }) => void }) {
  const [start, setStart] = useState('0')
  const [step, setStep] = useState('1')
  const [randomize, setRandomize] = useState(false)
  const [shift, setShift] = useState(false)
  useEffect(() => {
    void api.get<{ randomize: boolean; shift: boolean }>('/api/cards/reposition-defaults').then((d) => {
      setRandomize(d.randomize)
      setShift(d.shift)
    })
  }, [])
  return (
    <Dialog
      title="Reposition new cards"
      onClose={close}
      actions={
        <>
          <button className="text-btn" onClick={close}>
            Cancel
          </button>
          <button
            className="text-btn"
            onClick={() => {
              close()
              done({ start: Number(start) || 0, step: Math.max(1, Number(step) || 1), randomize, shift })
            }}
          >
            Reposition
          </button>
        </>
      }
    >
      <label className="field">
        <span>Start position</span>
        <input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="field">
        <span>Step</span>
        <input inputMode="numeric" value={step} onChange={(e) => setStep(e.target.value)} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} />
        Randomize order
      </label>
      <label className="check-row">
        <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />
        Shift position of existing cards
      </label>
    </Dialog>
  )
}

export function repositionCards(cardIds: number[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    showDialog((close) => (
      <RepositionDialog
        close={() => {
          close()
          if (!settled) resolve(false)
        }}
        done={async (opts) => {
          settled = true
          const res = await attempt(() => api.post<{ count: number }>('/api/cards/reposition', { cardIds, ...opts }))
          if (res) toast(`${res.count} cards repositioned`)
          resolve(!!res)
        }}
      />
    ))
  })
}

// ---- flags ----------------------------------------------------------------------------

export const FLAG_COLORS = ['', '#ff4747', '#ffb647', '#6ff06f', '#5289ff', '#ff99f1', '#85ffef', '#c398ec']

let flagNames: Promise<{ flag: number; name: string }[]> | null = null
export function getFlagNames() {
  flagNames ??= api.get<{ flag: number; name: string }[]>('/api/flags')
  return flagNames
}
export function resetFlagNames() {
  flagNames = null
}
