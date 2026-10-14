import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { api } from './api'
import * as be from './engine/generated/backend'
import { mediaBytes, mimeType } from './local/media'
import './theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// For the browser tests (tests/lib.mjs), and the console.
;(window as unknown as { __anki: unknown }).__anki = { api, be }

if ('serviceWorker' in navigator) {
  // The service worker serves media to Anki's pages, asking the app for it (sw.template.js).
  navigator.serviceWorker.addEventListener('message', async (e: MessageEvent) => {
    if (e.data?.type !== 'anki-media' || !e.ports[0]) return
    const name = String(e.data.name)
    const data = await mediaBytes(name).catch(() => null)
    e.ports[0].postMessage({ data, type: mimeType(name) }, data ? [data.buffer as ArrayBuffer] : [])
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
