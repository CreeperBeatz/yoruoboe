/**
 * The app's side of public/anki-host.js: what a Qt dialog does for an Anki page on
 * desktop, done for a page in a frame. Every backend call the page makes comes here:
 * the engine answers most (local/pages.ts); the app answers those only a user interface
 * can (file pickers, the microphone, dialogs, the clipboard). The page's events go to
 * the screen that shows it.
 */

import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { playAv } from '../audio'
import { mediaBlobUrl } from '../local/media'
import { pageCall } from '../local/pages'
import { searchNodeToString } from '../local/routes/browse'
import { addMediaFile, storeUpload } from '../local/routes/tools'
import { decode, encodeBool, encodeString, fromBase64, num, str, strs, sub, toBase64 } from '../pb'
import { navigate } from '../router'
import { alertDialog, confirm, Dialog, showDialog } from '../ui/components'

export type PageEvent =
  | { type: 'bridge'; cmd: string }
  | { type: 'call'; method: string; ok: boolean; status: number; body: Uint8Array; out: Uint8Array }

export interface PageHost {
  /** Call a global function in the page (desktop: webview.eval). */
  invoke<T = unknown>(fn: string, args?: unknown[], opts?: { afterLoaded?: boolean }): Promise<T>
  css(css: string): void
}

export function usePageHost(
  frame: React.RefObject<HTMLIFrameElement | null>,
  onEvent: (e: PageEvent) => void,
): PageHost {
  const handler = useRef(onEvent)
  handler.current = onEvent
  const waiters = useRef(new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>())
  const seq = useRef(0)

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow
      if (!win || e.source !== win || e.origin !== location.origin || e.data?.source !== 'anki-page') return
      const msg = e.data
      if (msg.type === 'rpc') {
        let body = ''
        let error: string | undefined
        const input = fromBase64(msg.body)
        let out: Uint8Array = new Uint8Array()
        try {
          out = APP_METHODS.has(msg.method) ? await answerRpc(msg.method, input) : await pageCall(msg.method, input)
          body = toBase64(out)
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
        }
        win.postMessage({ source: 'anki-host', type: 'rpc-result', id: msg.id, body, error }, location.origin)
        if (WATCHED.has(msg.method)) {
          handler.current({ type: 'call', method: msg.method, ok: !error, status: error ? 500 : 200, body: input, out })
        }
      } else if (msg.type === 'invoke-result') {
        const w = waiters.current.get(msg.id)
        if (!w) return
        waiters.current.delete(msg.id)
        if (msg.error) w.reject(new Error(msg.error))
        else w.resolve(msg.value == null ? null : JSON.parse(msg.value))
      } else if (msg.type === 'bridge') {
        handler.current({ type: 'bridge', cmd: msg.cmd })
      } else if (msg.type === 'call') {
        handler.current({
          type: 'call',
          method: msg.method,
          ok: msg.ok,
          status: msg.status,
          body: fromBase64(msg.body || ''),
          out: fromBase64(msg.out || ''),
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [frame])

  return {
    invoke: (fn, args = [], { afterLoaded = false } = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq.current
        waiters.current.set(id, { resolve: resolve as (v: unknown) => void, reject })
        frame.current?.contentWindow?.postMessage({ source: 'anki-host', type: 'invoke', id, fn, args, afterLoaded }, location.origin)
        setTimeout(() => {
          if (waiters.current.delete(id)) reject(new Error(`${fn} did not answer`))
        }, afterLoaded ? 20000 : 8000)
      }),
    css: (css) => frame.current?.contentWindow?.postMessage({ source: 'anki-host', type: 'css', css }, location.origin),
  }
}

// ---- the calls only the app can answer --------------------------------------------------

const APP_METHODS = new Set([
  'openFilePicker', 'recordAudio', 'playFile', 'askUser', 'showMessageBox',
  'readClipboard', 'writeClipboard', 'openLink', 'openMedia', 'searchInBrowser',
])

// Calls the screen wants to hear about after they return: closing the page, refreshing
// what it shows behind the page.
const WATCHED = new Set([
  'updateDeckConfigs', 'deckOptionsReady', 'deckOptionsRequireClose', 'importDone',
  'importDialogRequireClose', 'closeAddCards', 'closeEditCurrent', 'changeNotetype',
  'addImageOcclusionNote', 'updateImageOcclusionNote', 'addNote', 'updateNotes',
  'importCsv', 'importAnkiPackage', 'importJsonFile', 'importJsonString',
  'openFieldsDialog', 'openCardsDialog', 'updateNotetype',
])

async function answerRpc(method: string, body: Uint8Array): Promise<Uint8Array> {
  const f = decode(body)
  switch (method) {
    case 'openFilePicker': {
      // openFilePickerRequest{title=1, key=2, filter_description=3, extensions=4}
      const file = await pickFile(strs(f, 4))
      if (!file) return encodeString('')
      return encodeString(await uploadForPath(file))
    }
    case 'recordAudio': {
      const blob = await recordAudio()
      if (!blob) return encodeString('')
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      return encodeString(await uploadForPath(new File([blob], `rec-${Date.now()}.${ext}`, { type: blob.type })))
    }
    case 'playFile':
      void playAv([{ kind: 'sound', filename: str(f, 1) }])
      return new Uint8Array()
    case 'askUser': {
      // AskUserRequest{text=1, help=2, title=4, default_no=5}
      const ok = await confirm(<div dangerouslySetInnerHTML={{ __html: str(f, 1) }} />, {
        title: str(f, 4) || undefined,
        ok: 'Yes',
        cancel: 'No',
      })
      return encodeBool(ok)
    }
    case 'showMessageBox': {
      // ShowMessageBoxRequest{text=1, type=2, help=3, title=4, text_format=5}
      const text = str(f, 1)
      await alertDialog(num(f, 5) === 1 ? <div dangerouslySetInnerHTML={{ __html: text }} /> : text, str(f, 4) || undefined)
      return encodeBool(true)
    }
    case 'openLink':
      window.open(str(f, 1), '_blank', 'noopener')
      return new Uint8Array()
    case 'openMedia': {
      const url = await mediaBlobUrl(str(f, 1))
      if (url) window.open(url, '_blank', 'noopener')
      return new Uint8Array()
    }
    case 'readClipboard':
      return readClipboard(strs(f, 1))
    case 'writeClipboard':
      await writeClipboard(f)
      return new Uint8Array()
    case 'searchInBrowser': {
      const search = await searchNodeToString(body)
      navigate(`/browse?search=${encodeURIComponent(search)}`)
      return new Uint8Array()
    }
  }
  throw new Error(`${method} is not available here`)
}

function pickFile(extensions: string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (extensions.length) input.accept = extensions.map((e) => `.${e}`).join(',')
    let settled = false
    input.onchange = () => {
      settled = true
      resolve(input.files?.[0] ?? null)
    }
    // No event says the picker was cancelled; returning to the page does.
    window.addEventListener(
      'focus',
      () =>
        setTimeout(() => {
          if (!settled) resolve(null)
        }, 1000),
      { once: true },
    )
    input.click()
  })
}

/** Keep a picked file where the page can add it from (addMediaFromPath). */
const uploadForPath = storeUpload

/** Add a file to the collection's media; returns its media name. */
export const addMedia = addMediaFile

async function readClipboard(types: string[]): Promise<Uint8Array> {
  // ReadClipboardResponse{map<string, bytes> data = 1}: entries {key=1, value=2}
  const entries: number[] = []
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      for (const type of item.types) {
        if (!types.includes(type) && !types.some((t) => t.endsWith('/*') && type.startsWith(t.slice(0, -1)))) continue
        const data = new Uint8Array(await (await item.getType(type)).arrayBuffer())
        const key = new TextEncoder().encode(type)
        const entry = [0x0a, ...varint(key.length), ...key, 0x12, ...varint(data.length), ...data]
        entries.push(0x0a, ...varint(entry.length), ...entry)
      }
    }
  } catch {
    // no permission or nothing there
  }
  return new Uint8Array(entries)
}

async function writeClipboard(f: ReturnType<typeof decode>) {
  const items: Record<string, Blob> = {}
  for (const raw of f.get(1) ?? []) {
    if (!(raw instanceof Uint8Array)) continue
    const e = decode(raw)
    const type = str(e, 1)
    const value = sub(e, 2) ? (e.get(2)![0] as Uint8Array) : new Uint8Array()
    items[type] = new Blob([value as BlobPart], { type })
  }
  try {
    await navigator.clipboard.write([new ClipboardItem(items)])
  } catch {
    // not allowed here
  }
}

function varint(n: number): number[] {
  const out: number[] = []
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}

// ---- recording (desktop: the Record Audio dialog) ------------------------------------------

function RecordDialog({ close, done }: { close: () => void; done: (b: Blob | null) => void }) {
  const [state, setState] = useState<'starting' | 'recording' | 'stopped' | 'error'>('starting')
  const [error, setError] = useState('')
  const [secs, setSecs] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)

  useEffect(() => {
    let timer: number | undefined
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        stream.current = s
        const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t))
        const r = new MediaRecorder(s, type ? { mimeType: type } : undefined)
        const chunks: Blob[] = []
        r.ondataavailable = (e) => chunks.push(e.data)
        r.onstop = () => {
          setBlob(new Blob(chunks, { type: r.mimeType }))
          setState('stopped')
          s.getTracks().forEach((t) => t.stop())
        }
        r.start()
        recorder.current = r
        setState('recording')
        const t0 = Date.now()
        timer = window.setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 250)
      })
      .catch((e) => {
        setError(String(e?.message ?? e))
        setState('error')
      })
    return () => {
      window.clearInterval(timer)
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop()
  return (
    <Dialog
      title="Record audio"
      onClose={() => {
        stop()
        close()
        done(null)
      }}
      actions={
        <>
          <button
            className="text-btn"
            onClick={() => {
              stop()
              close()
              done(null)
            }}
          >
            Cancel
          </button>
          {state === 'recording' && (
            <button className="text-btn" onClick={stop}>
              Stop
            </button>
          )}
          {state === 'stopped' && (
            <>
              <button className="text-btn" onClick={() => blob && new Audio(URL.createObjectURL(blob)).play()}>
                Play
              </button>
              <button
                className="text-btn"
                onClick={() => {
                  close()
                  done(blob)
                }}
              >
                Save
              </button>
            </>
          )}
        </>
      }
    >
      {state === 'starting' && <p>Waiting for the microphone…</p>}
      {state === 'recording' && (
        <p style={{ fontSize: 22, textAlign: 'center' }}>
          <span style={{ color: 'var(--learn)' }}>●</span> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </p>
      )}
      {state === 'stopped' && <p>Recorded {secs} seconds.</p>}
      {state === 'error' && <p>The microphone could not be used: {error}</p>}
    </Dialog>
  )
}

export function recordAudio(): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false
    showDialog((close) => (
      <RecordDialog
        close={close}
        done={(b) => {
          if (!settled) {
            settled = true
            resolve(b)
          }
        }}
      />
    ))
  })
}

/** Run an Anki RPC from the app itself (e.g. to read something a page would). */
export function ankiRpc(method: string, body: Uint8Array = new Uint8Array()): Promise<Uint8Array> {
  return pageCall(method, body)
}

export { api }
