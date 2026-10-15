/**
 * A card, shown in the sandboxed card frame (public/card-frame.html) with Anki's own
 * reviewer.js. Used by the study screen, the previewer and the template editor.
 *
 * The frame has no access to the app: it posts what happens in it (taps, keys, play
 * buttons) and asks for the few backend calls desktop allows a card; the app answers.
 * Its media goes in with the card, as data URLs (local/media.ts).
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { inlineMedia } from '../local/media'
import { pageCall } from '../local/pages'
import { effectiveTheme, isDarkTheme, usePrefs } from '../prefs'
import { fromBase64, toBase64 } from '../pb'
import './cardview.css'

export type FrameEvent =
  | { type: 'bridge'; cmd: string }
  | { type: 'tap'; zone: string }
  | { type: 'swipe'; dir: 'Up' | 'Down' | 'Left' | 'Right' }
  | { type: 'double-tap' }
  | { type: 'long-press' }
  | { type: 'key'; key: string; code: string; ctrl: boolean; shift: boolean; alt: boolean }
  | { type: 'shown'; side: 'question' | 'answer' }
  | { type: 'jsapi'; id: number; endpoint: string; data: unknown }
  | { type: 'reload' }
  | { type: 'drag'; dx: number; dy: number }
  | { type: 'drop'; dx: number; dy: number; vx: number; vy: number }

export interface CardViewHandle {
  showQuestion(q: string, a: string, bodyClass: string, flag: number, marked: boolean): void
  showAnswer(a: string, bodyClass: string): void
  /** The card was answered: move it away until the next one comes. */
  leave(): void
  setFlag(flag: number): void
  setMark(marked: boolean): void
  typedAnswer(): Promise<string>
  /** Runs the deck's custom scheduling code; resolves when it has finished. */
  mutateStates(key: string, js: string): Promise<void>
  scroll(by: number): void
  userAction(n: number): void
  hint(all: boolean): void
  focus(): void
  /** Answer a call to AnkiDroid's JS API (see card-frame.js). */
  replyJsApi(id: number, text: string): void
}

// The frame's files, inlined into one document: a sandboxed frame loaded by URL is not
// served by the service worker, so it wouldn't open offline.
const FRAME_FILES = ['/card-frame.html', '/card-frame.js', '/_anki/css/webview.css', '/_anki/css/reviewer.css', '/_anki/js/reviewer.js']
let frameTemplate: Promise<string> | null = null

function inlineScript(js: string) {
  // A "</script" inside the code would end the inline script early; "<\/script" is the
  // same text to JavaScript.
  return `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`
}

function getFrameTemplate(): Promise<string> {
  frameTemplate ??= Promise.all(FRAME_FILES.map((f) => fetch(f).then((r) => (r.ok ? r.text() : Promise.reject(new Error(f))))))
    .then(([html, frameJs, webviewCss, reviewerCss, reviewerJs]) =>
      html
        .replace('<script src="/card-frame.js"></script>', `<script>window.__cardFrame = __CONFIG__</script>${inlineScript(frameJs)}`)
        .replace('<link rel="stylesheet" href="/_anki/css/webview.css" />', () => `<style>${webviewCss}</style>`)
        .replace('<link rel="stylesheet" href="/_anki/css/reviewer.css" />', () => `<style>${reviewerCss}</style>`)
        .replace('<script src="/_anki/js/reviewer.js"></script>', () => inlineScript(reviewerJs)),
    )
    .catch((e) => {
      frameTemplate = null
      throw e
    })
  return frameTemplate
}

// Backend calls a card may make, as desktop allows its reviewer (mediasrv.py).
const CARD_RPCS = new Set(['getSchedulingStatesWithContext', 'setSchedulingStates', 'i18nResources', 'congratsInfo'])

export const CardView = forwardRef<
  CardViewHandle,
  {
    onEvent: (e: FrameEvent) => void
    onReady?: () => void
    gestures?: boolean
    doubleTap?: boolean
    /** Swipes move the whole card (drag and drop events), which the app animates. */
    dragCard?: boolean
    className?: string
  }
>(function CardView({ onEvent, onReady, gestures = false, doubleTap = false, dragCard = false, className }, ref) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [doc, setDoc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const ready = useRef(false)
  const queued = useRef<unknown[]>([])
  const typedWaiters = useRef(new Map<number, (v: string) => void>())
  const mutateWaiter = useRef<(() => void) | null>(null)
  const seq = useRef(0)
  const prefs = usePrefs()
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = effectiveTheme(prefs, systemDark)
  const night = isDarkTheme(theme)
  const eventRef = useRef(onEvent)
  eventRef.current = onEvent
  const readyRef = useRef(onReady)
  readyRef.current = onReady

  useEffect(() => {
    let live = true
    void getFrameTemplate()
      .then((template) => {
        const config = JSON.stringify({ origin: location.origin, night }).replaceAll('<', '\\u003c')
        if (live) setDoc(template.replace('__CONFIG__', () => config))
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
    // The frame is built once; night mode changes come with the config message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = (msg: unknown) => {
    const win = frame.current?.contentWindow
    if (!win || !ready.current) {
      queued.current.push(msg)
      return
    }
    // The frame's origin is opaque, so '*'; it holds nothing but the card.
    win.postMessage(msg, '*')
  }

  const config = {
    type: 'config',
    night,
    theme,
    gestures,
    doubleTap,
    dragCard,
    doubleTapMs: prefs.doubleTapTimeInterval,
    swipeSensitivity: prefs.swipeSensitivity,
    zoom: prefs.cardZoom,
    imageZoom: prefs.imageZoom,
    centerVertically: prefs.centerVertically,
  }
  const configKey = JSON.stringify(config)
  useEffect(() => {
    send(config)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey])

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow || !e.data) return
      const msg = e.data
      switch (msg.type) {
        case 'ready':
          ready.current = true
          frame.current.contentWindow!.postMessage(JSON.parse(configKey), '*')
          for (const m of queued.current.splice(0)) frame.current.contentWindow!.postMessage(m, '*')
          readyRef.current?.()
          break
        case 'typed':
          typedWaiters.current.get(msg.id)?.(msg.value)
          typedWaiters.current.delete(msg.id)
          break
        case 'rpc': {
          const reply = (body?: string, error?: string) =>
            frame.current?.contentWindow?.postMessage({ type: 'rpc-result', id: msg.id, body, error }, '*')
          if (!CARD_RPCS.has(msg.method)) {
            reply(undefined, 'not allowed')
            break
          }
          try {
            reply(toBase64(await pageCall(msg.method, fromBase64(msg.body))))
          } catch (err) {
            reply(undefined, String(err))
          }
          break
        }
        case 'bridge':
          if (msg.cmd === 'statesMutated') {
            mutateWaiter.current?.()
            mutateWaiter.current = null
            break
          }
          if (msg.cmd === 'updateToolbar' || msg.cmd === 'repaintNeeded') break
          eventRef.current(msg)
          break
        case 'jsapi':
        case 'reload':
        case 'tap':
        case 'swipe':
        case 'double-tap':
        case 'long-press':
        case 'key':
        case 'shown':
        case 'drag':
        case 'drop':
          eventRef.current(msg)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [configKey])

  // Sides go in order, each once its media is inlined.
  const sides = useRef<Promise<void>>(Promise.resolve())
  const sendSide = (build: () => Promise<unknown>) => {
    sides.current = sides.current.then(async () => send(await build())).catch(() => {})
  }

  useImperativeHandle(ref, () => ({
    showQuestion: (q, a, bodyClass, flag, marked) =>
      sendSide(async () => ({ type: 'question', q: await inlineMedia(q), a: await inlineMedia(a), bodyClass, flag, marked })),
    showAnswer: (a, bodyClass) => sendSide(async () => ({ type: 'answer', a: await inlineMedia(a), bodyClass })),
    leave: () => sendSide(async () => ({ type: 'leave' })),
    setFlag: (flag) => send({ type: 'flag', flag }),
    setMark: (marked) => send({ type: 'mark', marked }),
    typedAnswer: () =>
      new Promise<string>((resolve) => {
        const id = ++seq.current
        typedWaiters.current.set(id, resolve)
        send({ type: 'get-typed', id })
        setTimeout(() => {
          if (typedWaiters.current.delete(id)) resolve('')
        }, 1500)
      }),
    mutateStates: (key, js) =>
      new Promise<void>((resolve) => {
        mutateWaiter.current = resolve
        send({ type: 'mutate-states', key, js })
        // Desktop answers anyway if the code never finishes.
        setTimeout(() => {
          if (mutateWaiter.current === resolve) {
            mutateWaiter.current = null
            resolve()
          }
        }, 3000)
      }),
    scroll: (by) => send({ type: 'scroll', by }),
    userAction: (n) => send({ type: 'user-action', n }),
    hint: (all) => send({ type: 'hint', all }),
    focus: () => frame.current?.focus(),
    replyJsApi: (id, text) => send({ type: 'jsapi-result', id, text }),
  }))

  if (failed) return <div className={className} style={{ padding: 24 }}>The card viewer could not be loaded.</div>
  if (!doc) return <div className={className} />
  return (
    <iframe
      ref={frame}
      className={className}
      title="Card"
      // No allow-same-origin: card scripts must not reach the app (see card-frame.js).
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      allow="autoplay"
    />
  )
})
