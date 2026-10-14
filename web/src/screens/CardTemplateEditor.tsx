/**
 * Card types of a note type (AnkiDroid's CardTemplateEditor): front, back and styling of
 * each, with a live preview, insert field, add/rename/reposition/delete, deck override
 * and browser appearance.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { goBack } from '../router'
import { AppBar, attempt, choose, confirm, Dialog, IconButton, prompt, showDialog, toast, useMenu, type MenuItem } from '../ui/components'
import { chooseDeck } from '../ui/dialogs'
import { CardView, type CardViewHandle } from './CardView'
import { confirmSchemaChange } from './schema'
import './templates.css'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Template = Record<string, any> & { name: string; qfmt: string; afmt: string; ord: number | null; bqfmt: string; bafmt: string; did: number | null }
type Notetype = Record<string, any> & { id: number; name: string; type: number; css: string; tmpls: Template[]; flds: { name: string }[] }

type Side = 'qfmt' | 'afmt' | 'css'

const SPECIAL = ['FrontSide', 'Card', 'CardFlag', 'Deck', 'Subdeck', 'Tags', 'Type', 'CardID']

export default function CardTemplateEditor({ notetypeId, query }: { notetypeId: number; query: URLSearchParams }) {
  const [original, setOriginal] = useState<string>('')
  const [nt, setNt] = useState<Notetype | null>(null)
  const [counts, setCounts] = useState<number[]>([])
  const [ord, setOrd] = useState(0)
  const [side, setSide] = useState<Side>('qfmt')
  const [showPreview, setShowPreview] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const [schemaChanged, setSchemaChanged] = useState(false)
  const view = useRef<CardViewHandle>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const noteId = query.get('note')

  const load = useCallback(async () => {
    const r = await api.get<{ notetype: Notetype; templateUseCounts: number[] }>(`/api/notetypes/${notetypeId}`)
    setNt(r.notetype)
    setOriginal(JSON.stringify(r.notetype))
    setCounts(r.templateUseCounts)
    setSchemaChanged(false)
  }, [notetypeId])
  useEffect(() => {
    void load()
  }, [load])

  const dirty = nt !== null && JSON.stringify(nt) !== original
  const tmpl = nt?.tmpls[ord]

  // Live preview, rendered by the backend from the unsaved note type.
  useEffect(() => {
    if (!showPreview || !previewReady || !nt) return
    const t = setTimeout(async () => {
      const r = await api
        .post<{ question: string; answer: string; bodyClass: string }>('/api/notetypes/preview', {
          notetype: nt,
          ord: nt.type === 1 ? 0 : ord,
          noteId: noteId ? Number(noteId) : null,
        })
        .catch((e) => ({ question: `<pre>${String(e.message)}</pre>`, answer: '', bodyClass: 'card' }))
      const html = side === 'afmt' ? r.answer : r.question
      view.current?.showQuestion(html, r.answer, r.bodyClass, 0, false)
    }, 300)
    return () => clearTimeout(t)
  }, [nt, ord, side, showPreview, previewReady, noteId])

  // Hooks first: the menu's items are set below once the note type is loaded.
  const menuItems = useRef<() => MenuItem[]>(() => [])
  const [openMenu, menu] = useMenu(() => menuItems.current())

  if (!nt || !tmpl) return <div className="screen"><AppBar title="Card types" nav="back" onNav={() => goBack('/notetypes')} /><div className="spinner" /></div>

  const update = (patch: (n: Notetype) => void, schema = false) => {
    const copy: Notetype = JSON.parse(JSON.stringify(nt))
    patch(copy)
    setNt(copy)
    if (schema) setSchemaChanged(true)
  }

  const setText = (value: string) =>
    update((n) => {
      if (side === 'css') n.css = value
      else n.tmpls[ord][side] = value
    })

  const save = async () => {
    if (schemaChanged && !(await confirmSchemaChange())) return
    if (await attempt(() => api.post(`/api/notetypes/${notetypeId}/save`, { notetype: nt }))) {
      toast('Saved')
      await load()
    }
  }

  const back = async () => {
    if (dirty) {
      const choice = await choose('Save changes?', [
        { label: 'Save', value: 'save' },
        { label: 'Discard', value: 'discard' },
      ])
      if (choice === 'save') await save()
      else if (choice !== 'discard') return
    }
    goBack('/notetypes')
  }

  const insertField = async () => {
    const name = await choose('Insert field', [
      ...nt.flds.map((f) => ({ label: f.name, value: f.name })),
      ...SPECIAL.map((s) => ({ label: `{{${s}}}`, value: s })),
    ])
    if (!name) return
    const el = area.current
    const text = `{{${name}}}`
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const value = el.value.slice(0, start) + text + el.value.slice(end)
    setText(value)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const addTemplate = async () => {
    if (nt.type === 1) return toast('Cloze note types have one card type')
    const name = (await prompt('Add card type', { initial: `Card ${nt.tmpls.length + 1}`, ok: 'Add' }))?.trim()
    if (!name) return
    const t = await api.get<Template>(`/api/notetypes/${notetypeId}/new-template?name=${encodeURIComponent(name)}`)
    // As AnkiDroid: the new card type starts as a copy of the current one.
    t.qfmt = tmpl.qfmt
    t.afmt = tmpl.afmt
    update((n) => n.tmpls.push(t), true)
    setOrd(nt.tmpls.length)
  }

  const removeTemplate = async () => {
    if (nt.tmpls.length < 2) return toast('The last card type can’t be deleted')
    const n = counts[ord] ?? 0
    if (!(await confirm(`Delete the “${tmpl.name}” card type${n ? ` and its ${n} cards` : ''}?`, { ok: 'Delete', danger: true }))) return
    update((x) => x.tmpls.splice(ord, 1), true)
    setOrd(0)
  }

  const renameTemplate = async () => {
    const name = (await prompt('Rename card type', { initial: tmpl.name, ok: 'Rename' }))?.trim()
    if (name) update((n) => (n.tmpls[ord].name = name))
  }

  const repositionTemplate = async () => {
    const pos = Number(await prompt('Reposition card type', { label: `New position (1–${nt.tmpls.length})`, initial: String(ord + 1), inputMode: 'numeric' }))
    if (!pos || pos < 1 || pos > nt.tmpls.length || pos === ord + 1) return
    update((n) => {
      const [t] = n.tmpls.splice(ord, 1)
      n.tmpls.splice(pos - 1, 0, t)
    }, true)
    setOrd(pos - 1)
  }

  const deckOverride = async () => {
    const choice = await choose('Deck override', [
      { label: 'Choose a deck…', value: 'choose' },
      { label: 'No override', value: 'none' },
    ])
    if (choice === 'none') update((n) => (n.tmpls[ord].did = null))
    else if (choice === 'choose') {
      const d = await chooseDeck('Deck override')
      if (d) update((n) => (n.tmpls[ord].did = d.id))
    }
  }

  const browserAppearance = () =>
    showDialog((close) => (
      <BrowserAppearance
        tmpl={tmpl}
        close={close}
        save={(bqfmt, bafmt) =>
          update((n) => {
            n.tmpls[ord].bqfmt = bqfmt
            n.tmpls[ord].bafmt = bafmt
          })
        }
      />
    ))

  menuItems.current = (): MenuItem[] => [
    { label: 'Insert field', icon: 'add', onClick: insertField },
    { label: showPreview ? 'Hide preview' : 'Preview', icon: 'eye', onClick: () => setShowPreview(!showPreview) },
    { label: 'Add card type', icon: 'cards', hidden: nt.type === 1, onClick: addTemplate },
    { label: 'Rename card type', icon: 'edit', onClick: renameTemplate },
    { label: 'Reposition card type', icon: 'sort', hidden: nt.tmpls.length < 2, onClick: repositionTemplate },
    { label: 'Delete card type', icon: 'delete', hidden: nt.tmpls.length < 2, onClick: removeTemplate },
    { label: 'Deck override', icon: 'folder', onClick: deckOverride },
    { label: 'Browser appearance', icon: 'list', onClick: browserAppearance },
    {
      label: 'Copy as Markdown',
      icon: 'copy',
      onClick: () =>
        void navigator.clipboard
          ?.writeText(`**Front template**\n\`\`\`html\n${tmpl.qfmt}\n\`\`\`\n**Back template**\n\`\`\`html\n${tmpl.afmt}\n\`\`\`\n**Styling**\n\`\`\`css\n${nt.css}\n\`\`\``)
          .then(() => toast('Copied')),
    },
  ]

  const text = side === 'css' ? nt.css : tmpl[side]

  return (
    <div className="screen template-editor">
      <AppBar title={tmpl.name} subtitle={nt.name} nav="back" onNav={back}>
        <IconButton icon="eye" label="Preview" onClick={() => setShowPreview(!showPreview)} />
        <IconButton icon="check" label="Save" disabled={!dirty} onClick={save} />
        <IconButton icon="more" label="More" onClick={openMenu} />
      </AppBar>
      {nt.tmpls.length > 1 && (
        <div className="tabs">
          {nt.tmpls.map((t, i) => (
            <button key={i} className={`tab${i === ord ? ' active' : ''}`} onClick={() => setOrd(i)}>
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className={`template-body${showPreview ? ' with-preview' : ''}`}>
        <textarea
          ref={area}
          className="template-code"
          value={text}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (!(e.ctrlKey || e.metaKey)) return
            const k = e.key.toLowerCase()
            if (k === 's') save()
            else if (k === 'p') setShowPreview(!showPreview)
            else if (k === 'i') insertField()
            else if (k === '1') setSide('qfmt')
            else if (k === '2') setSide('afmt')
            else if (k === '3') setSide('css')
            else return
            e.preventDefault()
          }}
        />
        {showPreview && (
          <div className="template-preview">
            <CardView ref={view} className="card-frame" onEvent={() => {}} onReady={() => setPreviewReady(true)} />
          </div>
        )}
      </div>
      <nav className="bottom-tabs">
        {(
          [
            ['qfmt', 'Front template'],
            ['afmt', 'Back template'],
            ['css', 'Styling'],
          ] as [Side, string][]
        ).map(([s, label]) => (
          <button key={s} className={side === s ? 'active' : ''} onClick={() => setSide(s)}>
            {label}
          </button>
        ))}
      </nav>
      {menu}
    </div>
  )
}

function BrowserAppearance({ tmpl, close, save }: { tmpl: Template; close: () => void; save: (q: string, a: string) => void }) {
  const [q, setQ] = useState(tmpl.bqfmt ?? '')
  const [a, setA] = useState(tmpl.bafmt ?? '')
  return (
    <Dialog
      title="Browser appearance"
      onClose={close}
      actions={
        <>
          <button className="text-btn" onClick={() => (setQ(''), setA(''))}>
            Restore default
          </button>
          <button className="text-btn" onClick={close}>
            Cancel
          </button>
          <button className="text-btn" onClick={() => (save(q, a), close())}>
            OK
          </button>
        </>
      }
    >
      <label className="field">
        <span>Question format (empty: use the front template)</span>
        <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
      </label>
      <label className="field">
        <span>Answer format (empty: use the back template)</span>
        <textarea rows={3} value={a} onChange={(e) => setA(e.target.value)} spellCheck={false} />
      </label>
    </Dialog>
  )
}
