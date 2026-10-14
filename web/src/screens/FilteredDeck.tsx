/** Filtered deck options (AnkiDroid's FilteredDeckOptionsFragment); id 0 creates one. */

import { useEffect, useState } from 'react'
import { api } from '../api'
import { goBack, navigate } from '../router'
import { AppBar, attempt, IconButton, toast } from '../ui/components'
import './forms.css'

interface Term {
  search: string
  limit: number
  order: number
}

interface Filtered {
  id: number
  name: string
  reschedule: boolean
  terms: Term[]
  delays: number[]
  previewAgainSecs: number
  previewHardSecs: number
  previewGoodSecs: number
  allowEmpty: boolean
  orderLabels: string[]
}

export default function FilteredDeck({ deckId, query }: { deckId: number; query: URLSearchParams }) {
  const [f, setF] = useState<Filtered | null>(null)
  const [second, setSecond] = useState(false)
  const [allowEmpty, setAllowEmpty] = useState(false)

  useEffect(() => {
    const search = query.get('search')
    void attempt(() => api.get<Filtered>(`/api/decks/filtered/${deckId}${search ? `?search=${encodeURIComponent(search)}` : ''}`)).then((r) => {
      if (!r) return
      if (r.terms.length < 2) r.terms.push({ search: '', limit: 20, order: 5 })
      setF(r)
      setSecond(!!r.terms[1].search)
      setAllowEmpty(r.allowEmpty)
    })
  }, [deckId, query])

  if (!f) return <div className="screen"><AppBar title="Filtered deck" nav="back" onNav={() => goBack('/')} /><div className="spinner" /></div>

  const setTerm = (i: number, patch: Partial<Term>) => setF({ ...f, terms: f.terms.map((t, j) => (j === i ? { ...t, ...patch } : t)) })

  const build = async () => {
    const terms = second ? f.terms : f.terms.slice(0, 1)
    const res = await attempt(() => api.post<{ id: number }>('/api/decks/filtered', { ...f, terms, allowEmpty }))
    if (res) {
      toast(deckId ? 'Rebuilt' : 'Filtered deck created')
      navigate(`/deck/${res.id}`, { replace: true })
    }
  }

  const term = (i: number) => (
    <div className="form-group">
      <label className="field">
        <span>Search</span>
        <input value={f.terms[i].search} onChange={(e) => setTerm(i, { search: e.target.value })} autoCapitalize="none" spellCheck={false} />
      </label>
      <div className="form-row">
        <label className="field" style={{ flex: '0 0 100px' }}>
          <span>Limit to</span>
          <input inputMode="numeric" value={f.terms[i].limit} onChange={(e) => setTerm(i, { limit: Number(e.target.value) || 0 })} />
        </label>
        <label className="field">
          <span>Cards selected by</span>
          <select value={f.terms[i].order} onChange={(e) => setTerm(i, { order: Number(e.target.value) })}>
            {f.orderLabels.map((l, n) => (
              <option key={n} value={n}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )

  return (
    <div className="screen">
      <AppBar title={deckId ? 'Filtered deck options' : 'Create filtered deck'} nav="back" onNav={() => goBack('/')}>
        <IconButton icon="help" label="Help" onClick={() => window.open('https://docs.ankiweb.net/filtered-decks.html', '_blank', 'noopener')} />
        <IconButton icon="check" label={deckId ? 'Rebuild' : 'Build'} onClick={build} />
      </AppBar>
      <div className="screen-body form-page">
        <label className="field">
          <span>Name</span>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <h3>Filter</h3>
        {term(0)}
        <label className="check-row">
          <input type="checkbox" checked={second} onChange={(e) => setSecond(e.target.checked)} />
          Enable second filter
        </label>
        {second && term(1)}
        <h3>Options</h3>
        <label className="check-row">
          <input type="checkbox" checked={f.reschedule} onChange={(e) => setF({ ...f, reschedule: e.target.checked })} />
          Reschedule cards based on my answers in this deck
        </label>
        {!f.reschedule && (
          <div className="form-row">
            <label className="field">
              <span>Again delay (s)</span>
              <input inputMode="numeric" value={f.previewAgainSecs} onChange={(e) => setF({ ...f, previewAgainSecs: Number(e.target.value) || 0 })} />
            </label>
            <label className="field">
              <span>Hard delay (s)</span>
              <input inputMode="numeric" value={f.previewHardSecs} onChange={(e) => setF({ ...f, previewHardSecs: Number(e.target.value) || 0 })} />
            </label>
            <label className="field">
              <span>Good delay (s)</span>
              <input inputMode="numeric" value={f.previewGoodSecs} onChange={(e) => setF({ ...f, previewGoodSecs: Number(e.target.value) || 0 })} />
            </label>
          </div>
        )}
        <label className="check-row">
          <input type="checkbox" checked={allowEmpty} onChange={(e) => setAllowEmpty(e.target.checked)} />
          Create even if empty
        </label>
        <button className="text-btn" onClick={() => navigate(`/browse?search=${encodeURIComponent(`(${f.terms[0].search}) (is:suspended OR is:buried OR deck:filtered)`)}`)}>
          Show excluded cards
        </button>
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={build}>
            {deckId ? 'Rebuild' : 'Build'}
          </button>
        </div>
      </div>
    </div>
  )
}
