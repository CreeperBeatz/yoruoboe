import { lazy, Suspense, useEffect, useState } from 'react'
import { api, onUnauthorized, type Me } from './api'
import { effectiveTheme, usePrefs } from './prefs'
import { match, navigate, useLocation } from './router'
import { noteSynced, refreshSyncState, setSyncState, startAutoSync, sync } from './sync'
import { DialogHost, SnackbarHost } from './ui/components'
import { Drawer } from './ui/Drawer'
import { InstallGuide } from './install/InstallGuide'
import DeckPicker from './screens/DeckPicker'
import Login from './screens/Login'

const StudyOptions = lazy(() => import('./screens/StudyOptions'))
const Reviewer = lazy(() => import('./screens/Reviewer'))
const AnkiPage = lazy(() => import('./screens/AnkiPage'))
const Browser = lazy(() => import('./screens/Browser'))
const NoteEditor = lazy(() => import('./screens/NoteEditor'))
const Settings = lazy(() => import('./screens/Settings'))
const Notetypes = lazy(() => import('./screens/Notetypes'))
const FilteredDeck = lazy(() => import('./screens/FilteredDeck'))
const Previewer = lazy(() => import('./screens/Previewer'))
const CardTemplateEditor = lazy(() => import('./screens/CardTemplateEditor'))
const FieldsEditor = lazy(() => import('./screens/FieldsEditor'))
const ImportExport = lazy(() => import('./screens/ImportExport'))

function useSystemDark() {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

export default function App() {
  const prefs = usePrefs()
  const systemDark = useSystemDark()
  const theme = effectiveTheme(prefs, systemDark)
  const [me, setMe] = useState<Me | undefined>(undefined)
  const [failed, setFailed] = useState('')
  const [localOnly, setLocalOnly] = useState(() => localStorage.getItem('anki-local-only') === '1')
  const [drawer, setDrawer] = useState(false)
  const loc = useLocation()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const bar = getComputedStyle(document.documentElement).getPropertyValue('--app-bar').trim()
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar || '#03A9F4')
  }, [theme])

  const loadMe = () =>
    api
      .get<Me>('/api/me')
      .then((m) => {
        setFailed('')
        setMe(m)
        setSyncState(m.sync)
      })
      .catch((e) => setFailed(e instanceof Error ? e.message : String(e)))

  useEffect(() => {
    void loadMe()
    const off = onUnauthorized(() => void loadMe())
    return () => {
      off()
    }
  }, [])

  // AnkiDroid's automatic sync: on opening the app, when it is put away, and (here)
  // in the background while it is open.
  const signedIn = Boolean(me?.username)
  useEffect(() => {
    if (!signedIn || !prefs.autoSync) return
    if (prefs.syncOnOpen) void sync({ quiet: true }).then(noteSynced)
    const stop = startAutoSync()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void api.post('/api/sync/beacon').catch(() => {})
      } else {
        void refreshSyncState()
        void sync({ quiet: true }).then(noteSynced)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, prefs.autoSync])

  if (failed && !me)
    return (
      <div className="screen">
        <div className="center-message" style={{ marginTop: '25vh' }}>
          <p style={{ fontSize: 18, color: 'var(--text)' }}>The collection could not be opened</p>
          <p>{failed}</p>
          <button className="btn" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    )
  if (me === undefined) return <div className="spinner" />
  // First start, or asked for: AnkiDroid's "Log in to AnkiWeb" screen.
  if ((!me.username && !localOnly) || match('/login', loc.path))
    return (
      <>
        <Login
          server={me.server}
          onDone={(m) => {
            setMe(m)
            setSyncState(m.sync)
            navigate('/', { replace: true })
          }}
          onSkip={() => {
            localStorage.setItem('anki-local-only', '1')
            setLocalOnly(true)
            navigate('/', { replace: true })
          }}
        />
        <DialogHost />
        <SnackbarHost />
        <InstallGuide />
      </>
    )

  const openDrawer = () => setDrawer(true)
  const path = loc.path
  let params: Record<string, string> | null
  let screen: React.ReactNode
  if ((params = match('/deck/:id', path))) screen = <StudyOptions deckId={Number(params.id)} />
  else if (match('/review', path)) screen = <Reviewer />
  else if ((params = match('/page/*', path))) screen = <AnkiPage route={params['*']} query={loc.query} />
  else if (match('/browse', path)) screen = <Browser onMenu={openDrawer} query={loc.query} />
  else if (match('/note/add', path)) screen = <NoteEditor mode="add" query={loc.query} />
  else if ((params = match('/note/:id', path))) screen = <NoteEditor mode="edit" noteId={Number(params.id)} query={loc.query} />
  else if ((params = match('/preview', path))) screen = <Previewer query={loc.query} />
  else if ((params = match('/settings/*', path))) screen = <Settings section={params['*']} me={me} />
  else if (match('/settings', path)) screen = <Settings section="" me={me} onMenu={openDrawer} />
  else if (match('/notetypes', path)) screen = <Notetypes />
  else if ((params = match('/notetypes/:id/fields', path))) screen = <FieldsEditor notetypeId={Number(params.id)} />
  else if ((params = match('/notetypes/:id/templates', path))) screen = <CardTemplateEditor notetypeId={Number(params.id)} query={loc.query} />
  else if ((params = match('/filtered/:id', path))) screen = <FilteredDeck deckId={Number(params.id)} query={loc.query} />
  else if (match('/import-export', path)) screen = <ImportExport query={loc.query} />
  else screen = <DeckPicker onMenu={openDrawer} me={me} />

  return (
    <>
      <Suspense fallback={<div className="spinner" />}>{screen}</Suspense>
      {drawer && <Drawer me={me} onClose={() => setDrawer(false)} />}
      <DialogHost />
      <SnackbarHost />
      <InstallGuide />
    </>
  )
}
