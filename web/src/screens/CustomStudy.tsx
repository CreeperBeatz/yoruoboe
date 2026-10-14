/** AnkiDroid's custom study dialog (dialogs/customstudy), on the backend's custom study. */

import { useEffect, useState } from 'react'
import { api } from '../api'
import { attempt, Dialog, showDialog, toast } from '../ui/components'

interface Defaults {
  tags: { name: string; include: boolean; exclude: boolean }[]
  extendNew: number
  extendReview: number
  availableNew: number
  availableReview: number
  availableNewInChildren: number
  availableReviewInChildren: number
}

type Kind = 'newLimit' | 'reviewLimit' | 'forgot' | 'ahead' | 'preview' | 'cram'

const KINDS: { kind: Kind; label: string; field: string; initial: (d: Defaults) => number }[] = [
  { kind: 'newLimit', label: 'Increase today’s new card limit', field: 'Increase today’s new card limit by', initial: (d) => d.extendNew },
  { kind: 'reviewLimit', label: 'Increase today’s review card limit', field: 'Increase today’s review limit by', initial: (d) => d.extendReview },
  { kind: 'forgot', label: 'Review forgotten cards', field: 'Review cards forgotten in the last x days', initial: () => 1 },
  { kind: 'ahead', label: 'Review ahead', field: 'Review ahead by x days', initial: () => 1 },
  { kind: 'preview', label: 'Preview new cards', field: 'Preview new cards added in the last x days', initial: () => 1 },
  { kind: 'cram', label: 'Study by card state or tag', field: 'Select x cards from the deck', initial: () => 100 },
]

function CustomStudyDialog({ deckId, close, done }: { deckId: number; close: () => void; done: (current: number | null) => void }) {
  const [d, setD] = useState<Defaults | null>(null)
  const [kind, setKind] = useState<Kind | null>(null)
  const [value, setValue] = useState('')
  const [cramKind, setCramKind] = useState('new')
  const [tags, setTags] = useState<Record<string, 'include' | 'exclude' | undefined>>({})

  useEffect(() => {
    void api.get<Defaults>(`/api/decks/${deckId}/custom-study`).then((r) => {
      setD(r)
      const t: Record<string, 'include' | 'exclude' | undefined> = {}
      r.tags.forEach((tag) => (t[tag.name] = tag.include ? 'include' : tag.exclude ? 'exclude' : undefined))
      setTags(t)
    })
  }, [deckId])

  const pick = (k: Kind) => {
    setKind(k)
    setValue(String(KINDS.find((x) => x.kind === k)!.initial(d!)))
  }

  const submit = async () => {
    if (!kind) return
    const n = Number(value)
    if (!Number.isFinite(n)) return toast('Enter a number')
    const body: Record<string, unknown> = { kind, value: n }
    if (kind === 'cram') {
      body.cramKind = cramKind
      body.cramLimit = n
      body.tagsToInclude = Object.entries(tags).filter(([, v]) => v === 'include').map(([k]) => k)
      body.tagsToExclude = Object.entries(tags).filter(([, v]) => v === 'exclude').map(([k]) => k)
    }
    const res = await attempt(() => api.post<{ current: number }>(`/api/decks/${deckId}/custom-study`, body))
    if (res) {
      close()
      done(kind === 'newLimit' || kind === 'reviewLimit' ? deckId : res.current)
    }
  }

  const info = KINDS.find((x) => x.kind === kind)
  return (
    <Dialog
      title="Custom study"
      onClose={() => (close(), done(null))}
      actions={
        <>
          <button className="text-btn" onClick={() => (kind ? setKind(null) : (close(), done(null)))}>
            {kind ? 'Back' : 'Cancel'}
          </button>
          {kind && (
            <button className="text-btn" onClick={submit}>
              OK
            </button>
          )}
        </>
      }
    >
      {!d && <div className="spinner" />}
      {d && !kind && (
        <div style={{ margin: '0 -24px' }}>
          {KINDS.filter((k) => !(k.kind === 'newLimit' && d.availableNew === 0 && d.availableNewInChildren === 0) && !(k.kind === 'reviewLimit' && d.availableReview === 0 && d.availableReviewInChildren === 0)).map((k) => (
            <button key={k.kind} className="menu-item" style={{ paddingLeft: 24 }} onClick={() => pick(k.kind)}>
              {k.label}
            </button>
          ))}
        </div>
      )}
      {d && kind && info && (
        <>
          {kind === 'newLimit' && <p style={{ marginTop: 0 }}>New cards available: {d.availableNew}{d.availableNewInChildren ? ` (+${d.availableNewInChildren} in subdecks)` : ''}</p>}
          {kind === 'reviewLimit' && <p style={{ marginTop: 0 }}>Review cards available: {d.availableReview}{d.availableReviewInChildren ? ` (+${d.availableReviewInChildren} in subdecks)` : ''}</p>}
          <label className="field">
            <span>{info.field}</span>
            <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
          {kind === 'cram' && (
            <>
              {[
                ['new', 'New cards only'],
                ['due', 'Due cards only'],
                ['review', 'All review cards in random order'],
                ['all', 'All cards in random order (don’t reschedule)'],
              ].map(([v, label]) => (
                <label key={v} className="radio-row">
                  <input type="radio" name="cram" checked={cramKind === v} onChange={() => setCramKind(v)} />
                  {label}
                </label>
              ))}
              {d.tags.length > 0 && (
                <>
                  <p style={{ marginBottom: 4 }}>Require one or more of these tags (tap: include, tap again: exclude):</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                    {d.tags.map((t) => {
                      const s = tags[t.name]
                      return (
                        <button
                          key={t.name}
                          className="chip"
                          style={{
                            border: '1px solid var(--divider)',
                            borderRadius: 16,
                            padding: '4px 10px',
                            background: s === 'include' ? 'var(--good-bg)' : s === 'exclude' ? 'var(--again-bg)' : 'none',
                            textDecoration: s === 'exclude' ? 'line-through' : undefined,
                          }}
                          onClick={() => setTags({ ...tags, [t.name]: s === undefined ? 'include' : s === 'include' ? 'exclude' : undefined })}
                        >
                          {t.name}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  )
}

/** Resolves with the deck to show next (the new "Custom Study Session" deck), or null. */
export function customStudy(deckId: number): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false
    showDialog((close) => (
      <CustomStudyDialog
        deckId={deckId}
        close={close}
        done={(v) => {
          if (!settled) {
            settled = true
            resolve(v)
          }
        }}
      />
    ))
  })
}
