/**
 * On an iPhone or iPad, in a browser: how to put the app on the Home Screen, step by
 * step, for the browser in use -- Safari or Chrome with its own screens, or any other in
 * general terms. It opens by itself on the first visit, and from the deck list's note
 * and Settings after that. (As BetterRTK's guide does.)
 *
 * The screenshots are made by scripts/make_install_shots.mjs.
 */

import { useState, useSyncExternalStore } from 'react'
import { install, isIOS, onPhone, runningInstalled, useInstall } from './install'
import step1 from './step1.webp'
import step2 from './step2.webp'
import step3 from './step3.webp'
import step4 from './step4.webp'
import step5 from './step5.webp'
import chrome1 from './chrome1.webp'
import chrome2 from './chrome2.webp'
import chrome3 from './chrome3.webp'
import chrome4 from './chrome4.webp'
import './install.css'

const T = {
  title: 'YoruOboe is designed to work from your Home Screen',
  why: 'In the browser, you might see some bugs or glitches, and the browser may clear your collection to save space.',
  own: 'The app on the Home Screen keeps its own collection, apart from this browser’s: log in or import there.',
  s1: 'Tap ☰ in the address bar, on the left.',
  s1b: 'No ☰ button? Tap ••• at the bottom right. No ••• button? Tap Share, then go to step 3.',
  s2: 'Tap Share.',
  s3: 'Tap View More.',
  s4: 'Tap Add to Home Screen.',
  s5: 'Keep Open as Web App on. Tap Add.',
  c1: 'Tap Share, in the address bar.',
  o1: 'Tap Share in your browser.',
  o1b: 'No Share, or no Add to Home Screen after it? Open this page in Safari.',
  o2: 'Tap Add to Home Screen.',
  o3: 'Tap Add.',
  f1: 'Open the menu (☰), then tap Share.',
  brave: 'Brave cannot put apps on the Home Screen. Open this page in Safari to install it.',
  inApp: 'This page is open inside another app, which cannot install it. Open it in Safari: look for Open in Safari or Open in browser in the app’s menu.',
  handoff: 'Or copy the link and paste it into Safari.',
  copy: 'Copy link',
  copied: 'Copied',
  done: 'Then open YoruOboe from your Home Screen.',
  later: 'Not now',
  noteLead: 'YoruOboe works better as an app.',
  noteHow: 'Show me how',
  noteInstall: 'Install the app',
  noteClose: 'Close',
}

type Key = keyof typeof T
type Step = { text: Key; note?: Key; img?: string; h?: number }

/**
 * The browser the steps are for: they differ in where Share is. On an iPhone every
 * browser is Safari's engine under its own buttons, and most can put the app on the
 * Home Screen (iOS 16.4 on). Two cannot: Brave chose not to, and the browsers inside
 * other apps -- Messenger, Instagram -- have no Share at all. Those are sent to Safari.
 */
type Browser = 'safari' | 'chrome' | 'firefox' | 'other' | 'brave' | 'inApp'
function browser(): Browser {
  const ua = navigator.userAgent
  // Brave says it is Safari, word for word; only this gives it away.
  if ('brave' in navigator) return 'brave'
  // The apps that say so. Viber, Telegram and Gmail do not, and pass for Safari.
  if (/FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|musical_ly|TikTok|Line\//.test(ua)) return 'inApp'
  if (/CriOS\//.test(ua)) return 'chrome'
  if (/FxiOS\//.test(ua)) return 'firefox'
  // Every iOS browser says Safari; the others add a name of their own.
  if (/Safari\//.test(ua) && !/(EdgiOS|OPiOS|OPT|DuckDuckGo|GSA|YaBrowser)\//.test(ua)) return 'safari'
  return 'other'
}

const STEPS: Record<Exclude<Browser, 'brave' | 'inApp'>, Step[]> = {
  safari: [
    { text: 's1', note: 's1b', img: step1, h: 209 },
    { text: 's2', img: step2, h: 554 },
    { text: 's3', img: step3, h: 603 },
    { text: 's4', img: step4, h: 426 },
    { text: 's5', img: step5, h: 476 },
  ],
  // After Share, Chrome's steps are Safari's: the same system screens.
  chrome: [
    { text: 'c1', img: chrome1, h: 153 },
    { text: 's3', img: chrome2, h: 595 },
    { text: 's4', img: chrome3, h: 487 },
    { text: 's5', img: chrome4, h: 484 },
  ],
  firefox: [{ text: 'f1', note: 'o1b' }, { text: 'o2' }, { text: 'o3' }],
  other: [{ text: 'o1', note: 'o1b' }, { text: 'o2' }, { text: 'o3' }],
}

/** Where the browser cannot install: the way to Safari, and the link to take there. */
function ToSafari({ why }: { why: 'brave' | 'inApp' }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard
      .writeText(`${location.origin}/`)
      .then(() => setCopied(true))
      .catch(() => {})
  }
  return (
    <div className="install-handoff">
      <p>{T[why]}</p>
      <p className="install-hint-text">{T.handoff}</p>
      <button className="btn" onClick={copy}>
        {T[copied ? 'copied' : 'copy']}
      </button>
    </div>
  )
}

const SEEN_KEY = 'anki-install-guide-seen'

/** A browser on an iPhone or iPad, not the app from the Home Screen. */
export const installable = () => isIOS && !runningInstalled()

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== null
  } catch {
    return true
  }
}

// Open or shut, for the deck list's note and Settings to open it from anywhere.
let open = installable() && !seen()
const listeners = new Set<() => void>()
function setOpen(next: boolean) {
  open = next
  listeners.forEach((l) => l())
}
export const openInstallGuide = () => setOpen(true)

/** The guide itself, mounted once by the app. */
export function InstallGuide() {
  const shown = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => open,
  )
  if (!shown) return null
  const b = browser()
  const steps = b === 'brave' || b === 'inApp' ? null : STEPS[b]
  function close() {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // storage blocked: it opens again next visit
    }
    setOpen(false)
  }
  return (
    <>
      <div className="scrim install-scrim" onClick={close} />
      <div className="dialog install-panel" role="dialog" aria-modal="true" aria-label="Install the app">
        <button className="install-x" onClick={close} aria-label="Close">
          ×
        </button>
        <div className="dialog-body">
          <h2 className="install-title">{T.title}</h2>
          <p className="install-why">{T.why}</p>
          {steps ? (
            <>
              <ol className="install-steps">
                {steps.map((s, i) => (
                  <li key={s.text}>
                    <p>
                      <span className="install-n">{i + 1}</span>
                      {T[s.text]}
                    </p>
                    {s.note && <p className="install-hint-text install-note">{T[s.note]}</p>}
                    {s.img && <img src={s.img} width={600} height={s.h} alt="" loading={i < 2 ? 'eager' : 'lazy'} />}
                  </li>
                ))}
              </ol>
              <p className="install-done">{T.done}</p>
              <p className="install-hint-text">{T.own}</p>
            </>
          ) : (
            <ToSafari why={b as 'brave' | 'inApp'} />
          )}
        </div>
        <div className="dialog-actions">
          <button className="text-btn" onClick={close}>
            {T.later}
          </button>
        </div>
      </div>
    </>
  )
}

// Closed, the note stays closed for the rest of the visit, and is back on the next.
let noteClosed = false

/**
 * On the deck list, in a phone's browser: that the app does more installed. On an
 * iPhone it opens the guide; on Android, once the browser offers to install the app,
 * the browser's own install dialog. It comes back on every visit, and goes once the
 * app is installed.
 */
export function InstallNote() {
  const how = useInstall()
  const [closed, setClosed] = useState(noteClosed)
  if (closed || !(how === 'ios' || (how === 'prompt' && onPhone))) return null
  function close() {
    noteClosed = true
    setClosed(true)
  }
  return (
    <aside className="install-note-bar" onClick={(e) => e.stopPropagation()}>
      <p>
        <strong>{T.noteLead}</strong>
        <br />
        <button className="install-note-show" onClick={() => (how === 'ios' ? openInstallGuide() : void install())}>
          {T[how === 'ios' ? 'noteHow' : 'noteInstall']}
        </button>
      </p>
      <button className="install-note-close" onClick={close} aria-label={T.noteClose}>
        ×
      </button>
    </aside>
  )
}
