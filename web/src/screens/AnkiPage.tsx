/**
 * One of Anki's own pages in a frame, with the app bar around it: deck options,
 * statistics, card info, change note type, image occlusion, the importers and the
 * congratulations screen. AnkiDroid shows the same pages the same way (pages/*.kt).
 */

import { useRef, useState } from 'react'
import { api } from '../api'
import { decode, num } from '../pb'
import { effectiveTheme, isDarkTheme, usePrefs } from '../prefs'
import { goBack, navigate } from '../router'
import { AppBar, attempt, choose, IconButton, toast } from '../ui/components'
import { customStudy } from './CustomStudy'
import { usePageHost, type PageEvent } from './pageHost'
import './ankipage.css'

const TITLES: Record<string, string> = {
  'deck-options': 'Deck options',
  graphs: 'Statistics',
  'card-info': 'Card info',
  'change-notetype': 'Change note type',
  'import-csv': 'Import',
  'import-anki-package': 'Import',
  'import-page': 'Import',
  'image-occlusion': 'Image occlusion',
  congrats: 'Congratulations',
}

// AnkiDroid hides desktop-only controls in the importers (BackendImporting.kt), and
// makes the pages fit a phone.
const PAGE_CSS = `
html { font-family: -apple-system, BlinkMacSystemFont, Roboto, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
.desktop-only { display: none !important; }
html, body { overscroll-behavior: none; }
`

export default function AnkiPage({ route, query }: { route: string; query: URLSearchParams }) {
  const name = route.split('/')[0]
  const frame = useRef<HTMLIFrameElement>(null)
  const prefs = usePrefs()
  const night = isDarkTheme(effectiveTheme(prefs, window.matchMedia('(prefers-color-scheme: dark)').matches))
  const [loaded, setLoaded] = useState(false)
  const closing = useRef(false)

  const close = () => {
    if (closing.current) return
    closing.current = true
    goBack('/')
  }

  const onEvent = async (e: PageEvent) => {
    if (e.type === 'call') {
      if (!e.ok) return
      switch (e.method) {
        case 'updateDeckConfigs': {
          // UpdateDeckConfigsRequest.mode = 4; "Save and optimize all" reloads the page itself.
          if (num(decode(e.body), 4) !== 2) {
            toast('Deck options saved')
            close()
          }
          break
        }
        case 'deckOptionsRequireClose':
        case 'importDialogRequireClose':
          close()
          break
        case 'changeNotetype':
          toast('Note type changed')
          close()
          break
        case 'addImageOcclusionNote':
        case 'updateImageOcclusionNote':
          // As AnkiDroid: give the page's own toast a moment, then close.
          setTimeout(close, 1000)
          break
      }
      return
    }
    const cmd = e.cmd
    if (cmd.startsWith('browserSearch:')) {
      // graphs: a bar was clicked, "browserSearch: <search> <query>"
      navigate(`/browse?search=${encodeURIComponent(cmd.slice('browserSearch:'.length).trim())}`)
    } else if (cmd === 'unbury') {
      const did = await api.get<{ current: number }>('/api/decks').then((d) => d.current)
      const info = await api.get<{ buried: { sched: boolean; user: boolean } }>(`/api/decks/${did}`)
      let mode: string | null = 'all'
      if (info.buried.sched && info.buried.user) {
        mode = await choose('Unbury', [
          { label: 'Manually buried cards', value: 'user' },
          { label: 'Buried siblings', value: 'sched' },
          { label: 'All buried cards', value: 'all' },
        ])
      }
      if (mode && (await attempt(() => api.post(`/api/decks/${did}/unbury`, { mode })))) {
        toast('Unburied')
        frame.current?.contentWindow?.location.reload()
      }
    } else if (cmd === 'customStudy') {
      const did = await api.get<{ current: number }>('/api/decks').then((d) => d.current)
      const made = await customStudy(did)
      if (made) navigate(`/deck/${made}`, { replace: true })
    }
  }

  const host = usePageHost(frame, onEvent)

  const back = async () => {
    if (name === 'deck-options' && loaded) {
      // The page asks about unsaved changes, then posts deckOptionsRequireClose.
      try {
        await host.invoke('anki.deckOptionsPendingChanges')
        return
      } catch {
        // page not ready: just close
      }
    }
    if (name.startsWith('import')) void api.post('/api/abort').catch(() => {})
    close()
  }

  const save = () => {
    if (name === 'image-occlusion') void host.invoke('anki.imageOcclusion.save').catch((err) => toast(String(err)))
  }

  let src: string
  const filePath = query.get('path')
  if (filePath) {
    // The importers take a server-side path as the rest of the URL, leading slash and
    // all, as desktop's quote(path) gives it: /import-csv//home/me/x.csv
    src = `/${name}/${encodeURI(filePath.replace(/\\/g, '/')).replace(/\?/g, '%3F').replace(/#/g, '%23')}`
  } else {
    const search = query.toString()
    src = `/${route}${search ? `?${search}` : ''}`
  }
  if (night) src += '#night'

  return (
    <div className="screen anki-page">
      <AppBar title={TITLES[name] ?? ''} nav="back" onNav={back}>
        {name === 'image-occlusion' && <IconButton icon="check" label="Save" onClick={save} />}
        {name === 'card-info' && <IconButton icon="search" label="Browse" onClick={() => navigate(`/browse?search=cid:${route.split('/')[1]}`)} />}
      </AppBar>
      {!loaded && <div className="progress-bar" />}
      <iframe
        ref={frame}
        className="anki-page-frame"
        title={TITLES[name] ?? name}
        src={src}
        onLoad={() => {
          setLoaded(true)
          host.css(PAGE_CSS)
        }}
      />
    </div>
  )
}
