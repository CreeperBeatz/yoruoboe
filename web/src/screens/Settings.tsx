/**
 * Settings (AnkiDroid's preference screens). Two kinds live side by side:
 *  - this device's preferences (theme, gestures, zoom...), kept in the browser;
 *  - the collection's (day rollover, timebox, backups...), stored in the collection and
 *    synced, as desktop's and AnkiDroid's are.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type Me } from '../api'
import { DEFAULT_GESTURES, resetPrefs, setPrefs, usePrefs, type Gesture, type GestureAction, type Prefs } from '../prefs'
import { goBack, navigate } from '../router'
import { sync, useSync } from '../sync'
import { storage } from '../local/col'
import { AppBar, attempt, choose, confirm, prompt, toast } from '../ui/components'
import { Icon, type IconName } from '../ui/icons'
import './settings.css'

const SECTIONS: { key: string; title: string; icon: IconName; summary: string }[] = [
  { key: 'general', title: 'General', icon: 'settings', summary: 'Adding, sync on open' },
  { key: 'reviewing', title: 'Reviewing', icon: 'school', summary: 'Day rollover, learn ahead, timebox' },
  { key: 'sync', title: 'Sync', icon: 'sync', summary: 'Account, automatic sync, full sync' },
  { key: 'storage', title: 'Storage', icon: 'download', summary: 'The collection on this device' },
  { key: 'appearance', title: 'Appearance', icon: 'palette', summary: 'Theme, study screen' },
  { key: 'controls', title: 'Controls', icon: 'fullscreen', summary: 'Gestures, keyboard shortcuts' },
  { key: 'accessibility', title: 'Accessibility', icon: 'eye', summary: 'Card zoom, button size' },
  { key: 'backups', title: 'Backups', icon: 'download', summary: 'How many backups to keep' },
  { key: 'advanced', title: 'Advanced', icon: 'build', summary: 'Text-to-speech, editor' },
  { key: 'about', title: 'About', icon: 'info', summary: 'Version and licences' },
]

export default function Settings({ section, me, onMenu }: { section: string; me: Me; onMenu?: () => void }) {
  const info = SECTIONS.find((s) => s.key === section)
  if (!info)
    return (
      <div className="screen">
        <AppBar title="Settings" nav={onMenu ? 'menu' : 'back'} onNav={onMenu ?? (() => goBack('/'))} />
        <div className="screen-body">
          {SECTIONS.map((s) => (
            <div key={s.key} className="settings-row" onClick={() => navigate(`/settings/${s.key}`)}>
              <Icon name={s.icon} />
              <div className="main">
                <div className="title">{s.title}</div>
                <div className="sub">{s.summary}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  return (
    <div className="screen">
      <AppBar title={info.title} nav="back" onNav={() => goBack('/settings')} />
      <div className="screen-body settings">
        {section === 'general' && <General />}
        {section === 'reviewing' && <Reviewing />}
        {section === 'sync' && <SyncSettings me={me} />}
        {section === 'storage' && <Storage />}
        {section === 'appearance' && <Appearance />}
        {section === 'controls' && <Controls />}
        {section === 'accessibility' && <Accessibility />}
        {section === 'backups' && <Backups />}
        {section === 'advanced' && <Advanced />}
        {section === 'about' && <About />}
      </div>
    </div>
  )
}

// ---- building blocks -------------------------------------------------------------------

function Category({ title }: { title: string }) {
  return <div className="settings-category">{title}</div>
}

function Row({ title, summary, onClick, right }: { title: string; summary?: ReactNode; onClick?: () => void; right?: ReactNode }) {
  return (
    <div className={`settings-row${onClick ? '' : ' static'}`} onClick={onClick}>
      <div className="main">
        <div className="title">{title}</div>
        {summary !== undefined && <div className="sub">{summary}</div>}
      </div>
      {right}
    </div>
  )
}

function Switch({ title, summary, value, onChange }: { title: string; summary?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row
      title={title}
      summary={summary}
      onClick={() => onChange(!value)}
      right={<span className={`switch${value ? ' on' : ''}`} role="switch" aria-checked={value} />}
    />
  )
}

function Slider({ title, value, min, max, step = 1, unit = '', onChange }: { title: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="settings-row static column">
      <div className="title">
        {title}: <b>{value}{unit}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

function Pick<T extends string | number>({ title, value, options, onChange }: { title: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Row
      title={title}
      summary={options.find((o) => o.value === value)?.label}
      onClick={async () => {
        const v = await choose(title, options.map((o) => ({ label: o.label, value: o.value, checked: o.value === value })))
        if (v !== null) onChange(v)
      }}
    />
  )
}

function NumberRow({ title, value, unit, onChange, min = 0, max = 99999 }: { title: string; value: number; unit?: string; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <Row
      title={title}
      summary={`${value}${unit ? ` ${unit}` : ''}`}
      onClick={async () => {
        const v = await prompt(title, { initial: String(value), inputMode: 'numeric' })
        if (v === null) return
        const n = Number(v)
        if (!Number.isFinite(n) || n < min || n > max) return toast(`Enter a number from ${min} to ${max}`)
        onChange(n)
      }}
    />
  )
}

const dev = <K extends keyof Prefs>(key: K) => (v: Prefs[K]) => setPrefs({ [key]: v } as Partial<Prefs>)

// The collection's own preferences (Anki's Preferences proto), loaded and saved together.
/* eslint-disable @typescript-eslint/no-explicit-any */
function useCollectionPrefs() {
  const [p, setP] = useState<any | null>(null)
  const load = useCallback(async () => setP(await api.get('/api/preferences')), [])
  useEffect(() => {
    void load()
  }, [load])
  const set = async (section: string, key: string, value: unknown) => {
    setP((old: any) => ({ ...old, [section]: { ...old[section], [key]: value } }))
    await attempt(() => api.post('/api/preferences', { [section]: { [key]: value } }))
  }
  return [p, set] as const
}

// ---- sections ----------------------------------------------------------------------------

function General() {
  const [p, set] = useCollectionPrefs()
  const prefs = usePrefs()
  return (
    <>
      <Category title="Adding" />
      {p && (
        <Pick
          title="Deck for new cards"
          value={p.editing.addingDefaultsToCurrentDeck ? 0 : 1}
          options={[
            { value: 0, label: 'Use current deck' },
            { value: 1, label: 'Decide by note type' },
          ]}
          onChange={(v) => set('editing', 'addingDefaultsToCurrentDeck', v === 0)}
        />
      )}
      {p && <Switch title="Paste clipboard images as PNG" value={p.editing.pasteImagesAsPng} onChange={(v) => set('editing', 'pasteImagesAsPng', v)} />}
      {p && <Switch title="Paste without shift key strips formatting" value={p.editing.pasteStripsFormatting} onChange={(v) => set('editing', 'pasteStripsFormatting', v)} />}
      {p && <Switch title="Ignore accents in search" value={p.editing.ignoreAccentsInSearch} onChange={(v) => set('editing', 'ignoreAccentsInSearch', v)} />}
      {p && (
        <Row
          title="Default search text"
          summary={p.editing.defaultSearchText || 'deck:current'}
          onClick={async () => {
            const v = await prompt('Default search text', { initial: p.editing.defaultSearchText })
            if (v !== null) await set('editing', 'defaultSearchText', v)
          }}
        />
      )}
      <Category title="Studying" />
      <Switch title="Keep the screen on while studying" value={prefs.keepScreenOn} onChange={dev('keepScreenOn')} />
      <Category title="Language" />
      <Row title="Language" summary="Follows the browser" />
    </>
  )
}

function Reviewing() {
  const [p, set] = useCollectionPrefs()
  if (!p) return <div className="spinner" />
  return (
    <>
      <Category title="Scheduling" />
      <NumberRow title="Start of next day" unit="hours past midnight" value={p.scheduling.rollover} min={0} max={23} onChange={(v) => set('scheduling', 'rollover', v)} />
      <NumberRow title="Learn ahead limit" unit="minutes" value={Math.round(p.scheduling.learnAheadSecs / 60)} max={999} onChange={(v) => set('scheduling', 'learnAheadSecs', v * 60)} />
      <NumberRow title="Timebox time limit" unit="minutes" value={Math.round(p.reviewing.timeLimitSecs / 60)} max={999} onChange={(v) => set('reviewing', 'timeLimitSecs', v * 60)} />
      <Switch title="Show remaining card count" value={p.reviewing.showRemainingDueCounts} onChange={(v) => set('reviewing', 'showRemainingDueCounts', v)} />
      <Switch title="Show next review time above answer buttons" value={p.reviewing.showIntervalsOnButtons} onChange={(v) => set('reviewing', 'showIntervalsOnButtons', v)} />
      <Switch title="Hide play buttons on cards with audio" value={p.reviewing.hideAudioPlayButtons} onChange={(v) => set('reviewing', 'hideAudioPlayButtons', v)} />
      <Switch title="Interrupt current audio when answering" value={p.reviewing.interruptAudioWhenAnswering} onChange={(v) => set('reviewing', 'interruptAudioWhenAnswering', v)} />
      <Switch title="Load balancer" summary="Spread reviews evenly across days" value={p.reviewing.loadBalancerEnabled} onChange={(v) => set('reviewing', 'loadBalancerEnabled', v)} />
      <Switch title="FSRS: short-term scheduling with learning steps" value={p.reviewing.fsrsShortTermWithStepsEnabled} onChange={(v) => set('reviewing', 'fsrsShortTermWithStepsEnabled', v)} />
      <Pick
        title="New/review order"
        value={p.scheduling.newReviewMix}
        options={[
          { value: 0, label: 'Mix with reviews' },
          { value: 1, label: 'Show after reviews' },
          { value: 2, label: 'Show before reviews' },
        ]}
        onChange={(v) => set('scheduling', 'newReviewMix', v)}
      />
      <Switch title="Show learning cards with larger steps before reviews" value={p.scheduling.dayLearnFirst} onChange={(v) => set('scheduling', 'dayLearnFirst', v)} />
    </>
  )
}

function SyncSettings({ me }: { me: Me }) {
  const prefs = usePrefs()
  const { state, syncing } = useSync()
  const server = me.server || 'AnkiWeb'
  const logout = async () => {
    if (!(await confirm('Log out? The collection stays on this device; sync again by logging in.', { ok: 'Log out' }))) return
    await attempt(() => api.post('/api/logout'))
    location.href = '/'
  }
  const forget = async () => {
    if (
      !(await confirm(
        `Remove the collection from this device and log out? Unsynced changes are synced first. ${server} keeps your collection; logging in again downloads it.`,
        { ok: 'Remove', danger: true },
      ))
    )
      return
    if (await attempt(() => api.post('/api/logout/everywhere'))) location.href = '/'
  }
  const forceFull = async () => {
    const dir = await choose<'upload' | 'download'>('Force a one-way sync', [
      { label: 'Upload this collection to the server', value: 'upload' },
      { label: 'Download the server’s collection', value: 'download' },
    ])
    if (!dir) return
    if (await confirm(dir === 'upload' ? 'Replace the server’s collection with this one?' : 'Replace this collection with the server’s?', { ok: 'Replace', danger: true })) {
      await sync({ full: dir })
    }
  }
  const changeServer = async () => {
    const url = await prompt('Sync server (empty for AnkiWeb). A self-hosted server must be reachable from this browser. Changing it logs you out.', {
      label: 'Address',
      initial: me.server,
      type: 'url',
    })
    if (url === null) return
    if (await attempt(() => api.post('/api/sync/server', { url }))) location.href = '/'
  }
  return (
    <>
      <Category title="Account" />
      {me.username ? (
        <>
          <Row title="Logged in as" summary={`${me.username} · ${server}`} />
          <Row title="Log out" onClick={logout} />
          <Row title="Remove the collection from this device" summary="Syncs first, then logs out" onClick={forget} />
        </>
      ) : (
        <Row title="Log in" summary={`Sync with ${server}`} onClick={() => navigate('/login')} />
      )}
      <Row title="Sync server" summary={me.server || 'AnkiWeb'} onClick={changeServer} />
      <Category title="Sync" />
      <Row
        title="Sync now"
        summary={syncing ? 'Syncing…' : state?.lastOk ? `Last synced ${new Date(state.lastOk * 1000).toLocaleString()}` : 'Not synced yet'}
        onClick={() => void sync()}
      />
      {state?.lastError && <Row title="Last error" summary={state.lastError} />}
      {state?.media && (
        <Row title="Media" summary={state.media.error ? state.media.error : state.media.active ? `Syncing media… ${state.media.checked ?? ''}` : 'Up to date'} />
      )}
      <Switch title="Automatic synchronization" summary="Sync when the app is opened and when it is left" value={prefs.autoSync} onChange={dev('autoSync')} />
      <Switch title="Sync when opening the app" value={prefs.syncOnOpen} onChange={dev('syncOnOpen')} />
      <Category title="Advanced" />
      <Row title="Force full sync" summary="Replace one side completely" onClick={forceFull} />
    </>
  )
}

function Storage() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const refresh = useCallback(() => {
    void navigator.storage?.persisted?.().then(setPersisted)
    void navigator.storage?.estimate?.().then((e) => setUsage({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
  }, [])
  useEffect(refresh, [refresh])
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB`
  const persist = async () => {
    const ok = await navigator.storage?.persist?.()
    toast(ok ? 'The browser will keep the collection' : 'The browser did not agree; add the app to the home screen first')
    refresh()
  }
  return (
    <>
      <p className="settings-note">
        Your collection and its media are kept on this device, by Anki’s own engine running in the app, and synced with the sync server
        as AnkiDroid does. Everything works without a connection; syncing needs one.
      </p>
      <Category title="This device" />
      <Row
        title="Stored in"
        summary={storage === 'opfs' ? 'The browser’s private file system' : storage === 'idb' ? 'IndexedDB (slower; this browser has no private file system)' : '…'}
      />
      {usage && <Row title="Space used" summary={`${mb(usage.usage)} of ${mb(usage.quota)} available`} />}
      <Row
        title="Keep data on this device"
        summary={
          persisted === null
            ? 'Not supported by this browser'
            : persisted
              ? 'On: the browser won’t clear the collection to save space'
              : 'Off: the browser may clear it when space runs low. Tap to ask it not to.'
        }
        onClick={persisted === false ? persist : undefined}
      />
    </>
  )
}

function Appearance() {
  const p = usePrefs()
  return (
    <>
      <Category title="Themes" />
      <Pick
        title="App theme"
        value={p.theme}
        options={[
          { value: 'system', label: 'Follow system' },
          { value: 'light', label: 'Light' },
          { value: 'plain', label: 'Plain' },
          { value: 'dark', label: 'Dark' },
          { value: 'black', label: 'Black' },
        ]}
        onChange={dev('theme')}
      />
      <Pick title="Day theme" value={p.dayTheme} options={[{ value: 'light', label: 'Light' }, { value: 'plain', label: 'Plain' }]} onChange={dev('dayTheme')} />
      <Pick title="Night theme" value={p.nightTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'black', label: 'Black' }]} onChange={dev('nightTheme')} />
      <Category title="Study screen" />
      <Switch title="Show top bar" value={p.showTopBar} onChange={dev('showTopBar')} />
      <Switch title="Fullscreen mode" summary="Hide the app bar while studying" value={p.fullscreen} onChange={dev('fullscreen')} />
      <Switch title="Show answer buttons" value={p.showAnswerButtons} onChange={dev('showAnswerButtons')} />
      <Switch title="Show button time" value={p.showIntervalsOnButtons} onChange={dev('showIntervalsOnButtons')} />
      <Switch title="Hide Hard and Easy buttons" value={p.hideHardAndEasy} onChange={dev('hideHardAndEasy')} />
      <Switch title="Center align" summary="Center the card content vertically" value={p.centerVertically} onChange={dev('centerVertically')} />
      <Switch title="Play audio automatically" value={p.autoPlayAudio} onChange={dev('autoPlayAudio')} />
    </>
  )
}

const ACTIONS: { value: GestureAction; label: string }[] = [
  { value: 'none', label: 'No action' },
  { value: 'showAnswer', label: 'Show answer' },
  { value: 'flipOrAnswer1', label: 'Show answer / Again' },
  { value: 'flipOrAnswer2', label: 'Show answer / Hard' },
  { value: 'flipOrAnswer3', label: 'Show answer / Good' },
  { value: 'flipOrAnswer4', label: 'Show answer / Easy' },
  { value: 'answer1', label: 'Answer Again' },
  { value: 'answer2', label: 'Answer Hard' },
  { value: 'answer3', label: 'Answer Good' },
  { value: 'answer4', label: 'Answer Easy' },
  { value: 'undo', label: 'Undo' },
  { value: 'redo', label: 'Redo' },
  { value: 'edit', label: 'Edit note' },
  { value: 'mark', label: 'Mark note' },
  { value: 'bury', label: 'Bury card' },
  { value: 'buryNote', label: 'Bury note' },
  { value: 'suspend', label: 'Suspend card' },
  { value: 'suspendNote', label: 'Suspend note' },
  { value: 'delete', label: 'Delete note' },
  { value: 'replay', label: 'Replay audio' },
  { value: 'toggleWhiteboard', label: 'Toggle whiteboard' },
  { value: 'cardInfo', label: 'Card info' },
  { value: 'deckOptions', label: 'Deck options' },
  { value: 'tagsDialog', label: 'Edit tags' },
  { value: 'setDueDate', label: 'Set due date' },
  { value: 'resetCard', label: 'Reset card' },
  { value: 'pageUp', label: 'Page up' },
  { value: 'pageDown', label: 'Page down' },
  { value: 'showHint', label: 'Show hint' },
  { value: 'showAllHints', label: 'Show all hints' },
  { value: 'toggleAutoAdvance', label: 'Toggle auto advance' },
  { value: 'flagRed', label: 'Toggle red flag' },
  { value: 'flagOrange', label: 'Toggle orange flag' },
  { value: 'flagGreen', label: 'Toggle green flag' },
  { value: 'flagBlue', label: 'Toggle blue flag' },
  { value: 'unflag', label: 'Remove flag' },
  { value: 'browse', label: 'Browse' },
  { value: 'statistics', label: 'Statistics' },
  { value: 'exit', label: 'Exit' },
]

const GESTURES: { key: Gesture; label: string }[] = [
  { key: 'swipeUp', label: 'Swipe up' },
  { key: 'swipeDown', label: 'Swipe down' },
  { key: 'swipeLeft', label: 'Swipe left' },
  { key: 'swipeRight', label: 'Swipe right' },
  { key: 'doubleTap', label: 'Double touch' },
  { key: 'longPress', label: 'Long press' },
  { key: 'tapTop', label: 'Touch top' },
  { key: 'tapLeft', label: 'Touch left' },
  { key: 'tapCenter', label: 'Touch center' },
  { key: 'tapRight', label: 'Touch right' },
  { key: 'tapBottom', label: 'Touch bottom' },
  { key: 'tapTopLeft', label: 'Touch top left' },
  { key: 'tapTopRight', label: 'Touch top right' },
  { key: 'tapBottomLeft', label: 'Touch bottom left' },
  { key: 'tapBottomRight', label: 'Touch bottom right' },
]

const SHORTCUTS: [string, string][] = [
  ['Space / Enter', 'Show answer, then Good'],
  ['1 – 4', 'Again, Hard, Good, Easy'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'],
  ['E', 'Edit note'],
  ['A', 'Add note'],
  ['*', 'Mark note'],
  ['- / =', 'Bury card / note'],
  ['@ / !', 'Suspend card / note'],
  ['Ctrl+1 … Ctrl+7', 'Toggle flags'],
  ['R / F5', 'Replay audio'],
  ['Shift+A', 'Toggle auto advance'],
  ['H / G', 'Show next hint / all hints'],
  ['B / T', 'Browse / Statistics'],
  ['Ctrl+Alt+I', 'Previous card info'],
  ['Ctrl+Alt+N', 'Reset card'],
]

function Controls() {
  const p = usePrefs()
  const corner = (k: Gesture) => k.startsWith('tapTopL') || k.startsWith('tapTopR') || k.startsWith('tapBottomL') || k.startsWith('tapBottomR')
  return (
    <>
      <Category title="Gestures" />
      <Switch title="Enable gestures" summary="Swipes and taps on the card" value={p.gesturesEnabled} onChange={dev('gesturesEnabled')} />
      {p.gesturesEnabled && (
        <>
          <Slider title="Swipe sensitivity" value={p.swipeSensitivity} min={20} max={180} step={10} unit="%" onChange={dev('swipeSensitivity')} />
          {GESTURES.map((g) => (
            <Pick
              key={g.key}
              title={g.label + (corner(g.key) ? ' (corner)' : '')}
              value={p.gestures[g.key]}
              options={ACTIONS}
              onChange={(v) => setPrefs({ gestures: { ...p.gestures, [g.key]: v } })}
            />
          ))}
          <Row title="Reset gestures" onClick={() => setPrefs({ gestures: DEFAULT_GESTURES })} />
        </>
      )}
      <Category title="Keyboard shortcuts (study screen)" />
      {SHORTCUTS.map(([k, v]) => (
        <Row key={k} title={v} summary={k} />
      ))}
    </>
  )
}

function Accessibility() {
  const p = usePrefs()
  return (
    <>
      <Slider title="Card zoom" value={p.cardZoom} min={10} max={300} step={5} unit="%" onChange={dev('cardZoom')} />
      <Slider title="Image zoom" value={p.imageZoom} min={50} max={300} step={5} unit="%" onChange={dev('imageZoom')} />
      <Slider title="Answer button size" value={p.answerButtonSize} min={50} max={200} step={5} unit="%" onChange={dev('answerButtonSize')} />
      <Slider title="Ignore a second answer tap within" value={p.doubleTapTimeInterval} min={0} max={1000} step={50} unit=" ms" onChange={dev('doubleTapTimeInterval')} />
    </>
  )
}

function Backups() {
  const [p, set] = useCollectionPrefs()
  if (!p) return <div className="spinner" />
  return (
    <>
      <p className="settings-note">Backups are kept on the server with the collection. Media is not backed up.</p>
      <NumberRow title="Minutes between automatic backups" value={p.backups.minimumIntervalMins} min={5} onChange={(v) => set('backups', 'minimumIntervalMins', v)} />
      <NumberRow title="Daily backups to keep" value={p.backups.daily} onChange={(v) => set('backups', 'daily', v)} />
      <NumberRow title="Weekly backups to keep" value={p.backups.weekly} onChange={(v) => set('backups', 'weekly', v)} />
      <NumberRow title="Monthly backups to keep" value={p.backups.monthly} onChange={(v) => set('backups', 'monthly', v)} />
    </>
  )
}

function Advanced() {
  const p = usePrefs()
  return (
    <>
      <Switch title="Text to speech" summary="Read cards aloud when they have no audio" value={p.tts} onChange={dev('tts')} />
      <Row
        title="Reset this device’s settings"
        onClick={async () => {
          if (await confirm('Reset every setting stored on this device?', { ok: 'Reset', danger: true })) resetPrefs()
        }}
      />
    </>
  )
}

function About() {
  const [version, setVersion] = useState<string>('')
  useEffect(() => {
    void api.get<{ anki: string }>('/api/version').then((v) => setVersion(v.anki)).catch(() => {})
  }, [])
  return (
    <>
      <div className="about">
        <img src="/icon-192.png" alt="" />
        <h2>Anki for the web</h2>
        <p>An AnkiDroid-style app for any browser, built on Anki {version}.</p>
        <p>
          Scheduling, the editor, deck options and statistics are Anki’s own (AGPL-3.0, Ankitects Pty Ltd and contributors). Layout and features follow AnkiDroid (GPL-3.0).
        </p>
      </div>
      <Row title="Anki manual" onClick={() => window.open('https://docs.ankiweb.net/', '_blank', 'noopener')} />
      <Row title="AnkiDroid manual" onClick={() => window.open('https://docs.ankidroid.org/', '_blank', 'noopener')} />
    </>
  )
}
