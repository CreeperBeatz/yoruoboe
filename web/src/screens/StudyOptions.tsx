/** A deck's overview before studying (AnkiDroid's StudyOptionsFragment). */

import { useCallback, useEffect, useState } from 'react'
import { api, type DeckOverview } from '../api'
import { goBack, navigate } from '../router'
import { useSync } from '../sync'
import { AppBar, attempt, choose, IconButton, toast, useMenu, type MenuItem } from '../ui/components'
import { customStudy } from './CustomStudy'
import './studyoptions.css'

export default function StudyOptions({ deckId }: { deckId: number }) {
  const [d, setD] = useState<DeckOverview | null>(null)
  const [error, setError] = useState('')
  const { generation } = useSync()

  const load = useCallback(async () => {
    try {
      setD(await api.get<DeckOverview>(`/api/decks/${deckId}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [deckId])

  useEffect(() => {
    void load()
  }, [load, generation])

  const unbury = async () => {
    if (!d) return
    let mode: string | null = 'all'
    if (d.buried.sched && d.buried.user) {
      mode = await choose('Unbury', [
        { label: 'Manually buried cards', value: 'user' },
        { label: 'Buried siblings', value: 'sched' },
        { label: 'All buried cards', value: 'all' },
      ])
    }
    if (mode && (await attempt(() => api.post(`/api/decks/${deckId}/unbury`, { mode })))) {
      toast('Unburied')
      void load()
    }
  }

  const study = async () => {
    if (!d) return
    if (d.finished && !d.filtered) {
      const made = await customStudy(deckId)
      if (made) navigate(`/deck/${made}`, { replace: true })
      return
    }
    localStorage.setItem('anki-last-deck', String(deckId))
    navigate('/review')
  }

  const [openMenu, menu] = useMenu((): MenuItem[] => [
    { label: 'Undo', icon: 'undo', hidden: !d?.undo.undo, onClick: async () => {
      const r = await attempt(() => api.post<{ name: string }>('/api/undo'))
      if (r) toast(`Undone: ${r.name}`)
      void load()
    } },
    { label: d?.filtered ? 'Filtered deck options' : 'Deck options', icon: 'settings', onClick: () => navigate(d?.filtered ? `/filtered/${deckId}` : `/page/deck-options/${deckId}`) },
    { label: 'Custom study', icon: 'school', hidden: !!d?.filtered, onClick: () => void customStudy(deckId).then((made) => made && navigate(`/deck/${made}`, { replace: true })) },
    { label: 'Rebuild', icon: 'sync', hidden: !d?.filtered, onClick: async () => {
      const r = await attempt(() => api.post<{ count: number }>(`/api/decks/${deckId}/rebuild`))
      if (r) toast(`${r.count} cards`)
      void load()
    } },
    { label: 'Empty', icon: 'close', hidden: !d?.filtered, onClick: async () => {
      if (await attempt(() => api.post(`/api/decks/${deckId}/empty`))) toast('Emptied')
      void load()
    } },
    { label: 'Unbury', icon: 'bury', hidden: !(d?.buried.sched || d?.buried.user), onClick: unbury },
    { label: 'Browse cards', icon: 'search', onClick: () => navigate(`/browse?deck=${deckId}`) },
    { label: 'Statistics', icon: 'stats', onClick: () => navigate('/page/graphs') },
  ])

  const parts = d?.name.split('::') ?? []
  const title = parts.length > 2 ? `${parts[0]} … ${parts[parts.length - 1]}` : parts.join(' › ')

  return (
    <div className="screen">
      <AppBar title={title} nav="back" onNav={() => goBack('/')}>
        <IconButton icon="more" label="More" onClick={openMenu} />
      </AppBar>
      <div className="screen-body study-options">
        {!d && !error && <div className="spinner" />}
        {error && <div className="center-message">{error}</div>}
        {d && (
          <>
            <h2 className="so-title">{parts[parts.length - 1]}</h2>
            {d.finished ? (
              <div className="so-congrats">
                <p className="so-big">Congratulations! You have finished this deck for now.</p>
                {d.secsUntilNextLearn > 0 && d.secsUntilNextLearn < 86400 && (
                  <p>The next learning card will be ready in {Math.ceil(d.secsUntilNextLearn / 60)} minutes.</p>
                )}
                {(d.buried.sched || d.buried.user) && (
                  <p>
                    Some related or buried cards were delayed until a later session.{' '}
                    <a href="#" onClick={(e) => (e.preventDefault(), void unbury())}>
                      Unbury them now
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <table className="so-counts">
                <tbody>
                  <tr>
                    <td>New:</td>
                    <td className="count new">{d.counts.new}</td>
                  </tr>
                  <tr>
                    <td>Learning:</td>
                    <td className="count learn">{d.counts.learn}</td>
                  </tr>
                  <tr>
                    <td>To review:</td>
                    <td className="count review">{d.counts.review}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {d.total > 0 && (
              <button className="btn so-study" onClick={study}>
                {d.finished && !d.filtered ? 'Custom study' : 'Study'}
              </button>
            )}
            <div className="so-total">Total cards: {d.total}</div>
            {d.filtered ? (
              <div className="so-desc">
                This is a special deck for studying outside of the normal schedule. Cards will be automatically returned to their original decks after you review them. Deleting this deck from the deck list will return all remaining cards to their original deck.
              </div>
            ) : (
              d.description && <div className="so-desc" dangerouslySetInnerHTML={{ __html: sanitize(d.description) }} />
            )}
          </>
        )}
      </div>
      {menu}
    </div>
  )
}

/** As AnkiDroid: no scripts or styles from the description, newlines kept. */
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/\n/g, '<br>'), 'text/html')
  doc.querySelectorAll('script, style, iframe, object, embed').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on') || /^javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src')
      if (src && !/^(https?:|data:|\/)/.test(src)) el.setAttribute('src', `/media/${src}`)
    }
  })
  return doc.body.innerHTML
}
