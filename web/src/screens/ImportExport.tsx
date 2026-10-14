/** Import (.apkg, .colpkg, .csv/.tsv/.txt) and the export dialog (AnkiDroid's 10.2, 10.3). */

import { useState } from 'react'
import { ready } from '../local/col'
import { importUpload } from '../local/routes/tools'
import { api } from '../api'
import { goBack, navigate } from '../router'
import { AppBar, attempt, confirm, Dialog, showDialog, toast } from '../ui/components'
import { chooseDeck } from '../ui/dialogs'
import './forms.css'

export default function ImportExport({ query }: { query: URLSearchParams }) {
  const [busy, setBusy] = useState(false)

  const pick = (accept: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const f = input.files?.[0]
      if (f) void upload(f)
    }
    input.click()
  }

  const upload = async (file: File) => {
    setBusy(true)
    try {
      await ready()
      const { path, kind } = await importUpload(file)
      // Anki's import pages are opened on the file's path in the engine's file store.
      if (kind === 'apkg') navigate(`/page/import-anki-package?path=${encodeURIComponent(path)}`, { replace: true })
      else if (kind === 'csv') navigate(`/page/import-csv?path=${encodeURIComponent(path)}`, { replace: true })
      else if (kind === 'colpkg') {
        if (!(await confirm('Importing a collection package replaces the whole collection, and the next sync replaces the server’s copy. A backup is made first.', { title: 'Replace collection?', ok: 'Replace', danger: true }))) return
        if (await attempt(() => api.post('/api/import/colpkg', { path }))) {
          toast('Collection imported')
          goBack('/')
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <AppBar title="Import" nav="back" onNav={() => goBack('/')} />
      {busy && <div className="progress-bar" />}
      <div className="screen-body">
        <div className="list-row" onClick={() => pick('.apkg')}>
          <div className="main">
            <div className="title">Anki package (.apkg)</div>
            <div className="sub">A shared deck or a deck exported from Anki</div>
          </div>
        </div>
        <div className="list-row" onClick={() => pick('.colpkg')}>
          <div className="main">
            <div className="title">Collection package (.colpkg)</div>
            <div className="sub">Replaces the whole collection</div>
          </div>
        </div>
        <div className="list-row" onClick={() => pick('.csv,.tsv,.txt')}>
          <div className="main">
            <div className="title">Text or CSV (.csv, .tsv, .txt)</div>
            <div className="sub">Notes as delimited text</div>
          </div>
        </div>
        <div className="list-row" onClick={() => exportDialog({})}>
          <div className="main">
            <div className="title">Export…</div>
            <div className="sub">The collection, a deck, or notes as text</div>
          </div>
        </div>
        <span hidden>{query.toString()}</span>
      </div>
    </div>
  )
}

// ---- export ----------------------------------------------------------------------------

type Kind = 'colpkg' | 'apkg' | 'notes-csv' | 'cards-csv'

function ExportDialog({ deckId: initialDeck, cardIds, noteIds, close }: { deckId?: number; cardIds?: number[]; noteIds?: number[]; close: () => void }) {
  const selection = !!(cardIds?.length || noteIds?.length)
  const [kind, setKind] = useState<Kind>(initialDeck || selection ? 'apkg' : 'colpkg')
  const [deck, setDeck] = useState<{ id: number; name: string } | null>(initialDeck ? { id: initialDeck, name: '' } : null)
  const [useSelection, setUseSelection] = useState(selection)
  const [o, setO] = useState({
    includeScheduling: true,
    includeMedia: true,
    includeDeckConfigs: true,
    legacy: false,
    withHtml: true,
    withTags: true,
    withDeck: true,
    withNotetype: true,
    withGuid: false,
  })
  const [busy, setBusy] = useState(false)
  const check = (key: keyof typeof o, label: string) => (
    <label className="check-row">
      <input type="checkbox" checked={o[key]} onChange={(e) => setO({ ...o, [key]: e.target.checked })} />
      {label}
    </label>
  )
  const run = async () => {
    setBusy(true)
    const body = {
      kind,
      ...o,
      deckId: kind !== 'colpkg' && !useSelection ? deck?.id : undefined,
      cardIds: kind !== 'colpkg' && useSelection ? cardIds : undefined,
      noteIds: kind !== 'colpkg' && useSelection ? noteIds : undefined,
    }
    const res = await attempt(() => api.post<{ url: string; name: string }>('/api/export', body))
    setBusy(false)
    if (!res) return
    close()
    // Download through the browser: Safari offers Save to Files / Share.
    const a = document.createElement('a')
    a.href = res.url
    a.download = res.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast(`Exported ${res.name}`)
  }
  return (
    <Dialog
      title="Export"
      onClose={close}
      actions={
        <>
          <button className="text-btn" onClick={close}>
            Cancel
          </button>
          <button className="text-btn" disabled={busy} onClick={run}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Export format</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="colpkg">Anki collection package (.colpkg)</option>
          <option value="apkg">Anki deck package (.apkg)</option>
          <option value="notes-csv">Notes in plain text (.txt)</option>
          <option value="cards-csv">Cards in plain text (.txt)</option>
        </select>
      </label>
      {kind !== 'colpkg' && (
        <>
          {selection && (
            <label className="check-row">
              <input type="checkbox" checked={useSelection} onChange={(e) => setUseSelection(e.target.checked)} />
              Selected notes only
            </label>
          )}
          {!useSelection && (
            <button
              className="input"
              style={{ textAlign: 'left', marginBottom: 8 }}
              onClick={async () => {
                const d = await chooseDeck('Deck to export', { allowFiltered: true })
                if (d) setDeck(d)
              }}
            >
              {deck ? deck.name || 'This deck' : 'All decks'}
            </button>
          )}
        </>
      )}
      {kind === 'colpkg' && (
        <>
          {check('includeMedia', 'Include media')}
          {check('legacy', 'Support older Anki versions (slower, larger)')}
        </>
      )}
      {kind === 'apkg' && (
        <>
          {check('includeScheduling', 'Include scheduling information')}
          {check('includeDeckConfigs', 'Include deck presets')}
          {check('includeMedia', 'Include media')}
          {check('legacy', 'Support older Anki versions')}
        </>
      )}
      {kind === 'notes-csv' && (
        <>
          {check('withHtml', 'Include HTML and media references')}
          {check('withTags', 'Include tags')}
          {check('withDeck', 'Include deck name')}
          {check('withNotetype', 'Include note type name')}
          {check('withGuid', 'Include unique identifier')}
        </>
      )}
      {kind === 'cards-csv' && check('withHtml', 'Include HTML and media references')}
    </Dialog>
  )
}

export function exportDialog(opts: { deckId?: number; cardIds?: number[]; noteIds?: number[] }) {
  showDialog((close) => <ExportDialog {...opts} close={close} />)
}
