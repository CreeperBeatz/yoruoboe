/**
 * Adding and editing notes, in Anki's own editor page (the SvelteKit editor of desktop
 * 26.09): fields with rich text, HTML and MathJax editors, cloze, sticky fields, tags,
 * the deck and note type choosers, media, recording, image occlusion and duplicates.
 *
 * The page asks its host for what only an app can do (file picker, microphone, dialogs);
 * pageHost.tsx answers. This screen loads the note into it and closes it.
 */

import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { decode, num } from '../pb'
import { effectiveTheme, isDarkTheme, usePrefs } from '../prefs'
import { goBack, navigate } from '../router'
import { AppBar, attempt, confirm, IconButton, toast, useMenu, type MenuItem } from '../ui/components'
import { editNoteTags } from '../ui/dialogs'
import { usePageHost, type PageEvent } from './pageHost'
import './ankipage.css'

interface NoteMeta {
  id: number
  notetypeId: number
  cardIds: number[]
}

// Fit the desktop editor to a phone: larger touch targets, no desktop-only parts.
const EDITOR_CSS = `
html { font-family: -apple-system, BlinkMacSystemFont, Roboto, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
.desktop-only { display: none !important; }
html, body { overscroll-behavior: none; }
body { padding-bottom: env(safe-area-inset-bottom); }
.editor-toolbar .btn, .editor-toolbar button { min-height: 34px; min-width: 34px; }
.field-container { margin-bottom: 6px; }
`

export default function NoteEditor({ mode, noteId, query }: { mode: 'add' | 'edit'; noteId?: number; query: URLSearchParams }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const prefs = usePrefs()
  const night = isDarkTheme(effectiveTheme(prefs, window.matchMedia('(prefers-color-scheme: dark)').matches))
  const [meta, setMeta] = useState<NoteMeta | null>(null)
  const [ready, setReady] = useState(false)
  const [added, setAdded] = useState(0)
  const closing = useRef(false)
  const cardId = query.get('card')
  const editorMode = mode === 'add' ? 'add' : cardId ? 'current' : 'browser'

  useEffect(() => {
    if (mode === 'edit' && noteId) {
      void attempt(() => api.get<NoteMeta>(`/api/notes/${noteId}`)).then((m) => m && setMeta(m))
    }
  }, [mode, noteId])

  const close = () => {
    if (closing.current) return
    closing.current = true
    goBack('/')
  }

  const loadArgs = async () => {
    if (mode === 'add') {
      let notetypeId: string | null = query.get('notetype')
      if (query.get('io')) {
        const io = await api.get<{ id: number }>('/api/notetypes/image-occlusion')
        notetypeId = String(io.id)
      }
      const deck = query.get('deck')
      if (deck) await api.get(`/api/decks/${deck}`) // makes it current, as AnkiDroid's "Add" from a deck does
      return {
        nid: null,
        notetypeId,
        deckId: deck,
        focusTo: 0,
        originalNoteId: query.get('copy'),
        reviewerCardId: null,
        initial: true,
      }
    }
    return {
      nid: String(noteId),
      notetypeId: meta ? String(meta.notetypeId) : null,
      deckId: null,
      focusTo: 0,
      originalNoteId: null,
      reviewerCardId: cardId,
      initial: true,
    }
  }

  const onEvent = async (e: PageEvent) => {
    if (e.type === 'bridge') {
      if (e.cmd === 'editorReady') {
        setReady(true)
        host.css(EDITOR_CSS)
        const args = await loadArgs()
        await host.invoke('loadNote', [args], { afterLoaded: true }).catch((err) => toast(String(err)))
      } else if (e.cmd === 'cards') {
        void openCards()
      } else if (e.cmd === 'preview') {
        void preview()
      }
      return
    }
    if (!e.ok) return
    switch (e.method) {
      case 'addNote':
        setAdded((n) => n + 1)
        break
      case 'closeAddCards': {
        // generic.Bool: whether there is input that would be lost
        const unsaved = num(decode(e.body), 1) === 1
        if (!unsaved || (await confirm('Discard current input?', { ok: 'Discard', danger: true }))) close()
        else closing.current = false
        break
      }
      case 'closeEditCurrent':
        close()
        break
      case 'openCardsDialog':
        void openCards()
        break
      case 'openFieldsDialog': {
        const info = await info_()
        if (info) navigate(`/notetypes/${info.mid}/fields`)
        break
      }
    }
  }

  const host = usePageHost(frame, onEvent)

  const info_ = () =>
    host.invoke<{ id: string | null; mid: string; fields: string[] }>('getNoteInfo').catch(() => null)

  const openCards = async () => {
    const info = await info_()
    if (!info) return
    await host.invoke('saveNow', [true]).catch(() => {})
    const nid = info.id && info.id !== '0' ? `&note=${info.id}` : ''
    navigate(`/notetypes/${info.mid}/templates?from=editor${nid}`)
  }

  const preview = async () => {
    const info = await info_()
    if (info?.id && info.id !== '0') {
      await host.invoke('saveNow', [true]).catch(() => {})
      navigate(`/preview?note=${info.id}`)
    }
  }

  const back = async () => {
    if (!ready) return close()
    if (mode === 'add') {
      // The page saves, then posts closeAddCards(unsaved?) and the event above decides.
      try {
        await host.invoke('closeAddCards')
        // If the page answered without posting (older pages), close anyway.
        setTimeout(() => !closing.current && close(), 1500)
      } catch {
        close()
      }
    } else {
      await host.invoke('saveNow', [false]).catch(() => {})
      close()
    }
  }

  const [openMenu, menu] = useMenu((): MenuItem[] => [
    { label: 'Cards…', icon: 'cards', onClick: openCards },
    {
      label: 'Fields…',
      icon: 'list',
      onClick: async () => {
        const info = await info_()
        if (info) navigate(`/notetypes/${info.mid}/fields`)
      },
    },
    { label: 'Preview', icon: 'eye', hidden: mode === 'add', onClick: preview },
    {
      label: 'Tags',
      icon: 'tag',
      hidden: mode === 'add',
      onClick: async () => {
        if (noteId && (await editNoteTags(noteId))) {
          await host.invoke('reloadNote').catch(() => {})
        }
      },
    },
    {
      label: 'Change note type',
      icon: 'swap',
      hidden: mode === 'add' || !meta,
      onClick: async () => {
        await host.invoke('saveNow', [false]).catch(() => {})
        await api.post('/api/notes/change-notetype-start', { noteIds: [noteId] })
        navigate(`/page/change-notetype/${meta!.notetypeId}`)
      },
    },
    {
      label: 'Card info',
      icon: 'info',
      hidden: mode === 'add' || !meta?.cardIds.length,
      onClick: () => navigate(`/page/card-info/${cardId ?? meta!.cardIds[0]}`),
    },
    {
      label: 'Copy note',
      icon: 'copy',
      hidden: mode === 'add',
      onClick: async () => {
        await host.invoke('saveNow', [false]).catch(() => {})
        navigate(`/note/add?copy=${noteId}`)
      },
    },
    {
      label: 'Delete note',
      icon: 'delete',
      hidden: mode === 'add',
      onClick: async () => {
        if (!(await confirm('Delete this note and all its cards?', { ok: 'Delete', danger: true }))) return
        if (await attempt(() => api.post('/api/notes/delete', { noteIds: [noteId] }))) {
          toast('Note deleted')
          close()
        }
      },
    },
  ])

  if (mode === 'edit' && !meta) return <div className="screen"><AppBar title="Edit note" nav="back" onNav={close} /><div className="progress-bar" /></div>

  return (
    <div className="screen anki-page">
      <AppBar title={mode === 'add' ? 'Add' : 'Edit note'} subtitle={added ? `${added} added` : undefined} nav="back" onNav={back}>
        <IconButton icon="more" label="More" onClick={openMenu} />
      </AppBar>
      {!ready && <div className="progress-bar" />}
      <iframe
        ref={frame}
        className="anki-page-frame"
        title="Editor"
        src={`/editor/?mode=${editorMode}${night ? '#night' : ''}`}
      />
      {menu}
    </div>
  )
}
