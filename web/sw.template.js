/*
 * The app's service worker. The collection lives on the device (Anki's engine, in the
 * app), so the app must open without a connection: everything it is made of is cached
 * here. It also stands in for the web server desktop Anki runs for its pages:
 *
 *   /deck-options/…, /editor/…   Anki's pages: their shell (anki-page*.html)
 *   /editor/_anki/…               the editor's relative asset URLs, from /_anki/
 *   /media/<name>, /editor/<name> media, which only the app can read: asked of it
 *
 * Built from web/sw.template.js by the plugin in vite.config.ts, which fills in the
 * build's version and files. Each build is a new worker, so a deploy replaces the
 * cached app in one step.
 *
 * What is cached:
 *   the shell          index.html, the app's scripts and styles, the engine, at install
 *   /assets/*          hashed, so cache-first
 *   /_app/immutable/*  Anki's pages' hashed scripts, cache-first
 *   /_anki/*           Anki's page assets and the card frame's, stale-while-revalidate
 */

const VERSION = '__VERSION__'
const SHELL = __SHELL__
// Anki's pages and their assets: fetched in the background after install, so the
// editor, deck options and statistics open offline too.
const ANKI_ASSETS = '__ANKI_ASSETS__'
const ANKI_PAGES = '__ANKI_PAGES__'
const UNTRUSTED_PAGES = new Set('__UNTRUSTED_PAGES__')
const SHELL_CACHE = `shell-${VERSION}`
const RUNTIME_CACHE = `runtime-${VERSION}`
const ANKI_CACHE = 'anki-pages'
const DEV = VERSION === 'dev'

// The card frame: the app inlines these into the frame's srcdoc, so they must be here
// before the first time the app is opened offline.
const FRAME_FILES = ['/card-frame', '/card-frame.html', '/card-frame.js', '/_anki/css/webview.css', '/_anki/css/reviewer.css', '/_anki/js/reviewer.js']

// Media is user content: shown by a card it may be anything, opened on its own it must
// not run as a page of this site (same policy as desktop's mediasrv).
const UNTRUSTED_MEDIA_CSP =
  "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; sandbox allow-same-origin"

// A hashed file is the same file whoever asks, so Vary is beside the point.
const ANY = { ignoreVary: true }

const PAGE_RE = new RegExp(`^/(${ANKI_PAGES.join('|')})(/|$)`)

self.addEventListener('install', (event) => {
  if (DEV) {
    self.skipWaiting()
    return
  }
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.all(
          [...SHELL, ...FRAME_FILES.filter((f) => f !== '/card-frame')].map(async (path) => {
            const res = await fetch(path)
            if (!res.ok) throw new Error(`${path}: ${res.status}`)
            await cache.put(path, plain(res))
          }),
        ),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, ANKI_CACHE])
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
  if (!DEV) void warmAnkiCache()
})

/** Fetch what is missing of Anki's pages, a few at a time; best effort. */
async function warmAnkiCache() {
  const cache = await caches.open(ANKI_CACHE)
  const missing = []
  for (const url of ANKI_ASSETS) if (!(await cache.match(url, ANY))) missing.push(url)
  let i = 0
  const worker = async () => {
    while (i < missing.length) {
      const url = missing[i++]
      try {
        const res = await fetch(url)
        if (res.ok) await cache.put(url, res)
      } catch {
        return
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const path = url.pathname

  // Sync traffic, never cached.
  if (path.startsWith('/aw/')) return

  const page = PAGE_RE.exec(path)
  if (page && req.mode === 'navigate') {
    event.respondWith(ankiPage(page[1]))
    return
  }
  if (path.startsWith('/editor/_anki/')) {
    event.respondWith(cachedOrNetwork(path.slice('/editor'.length), ANKI_CACHE))
    return
  }
  const media = /^\/(?:media|editor)\/([^/]+)$/.exec(path)
  if (media) {
    event.respondWith(fromApp(decodeURIComponent(media[1])))
    return
  }
  if (DEV) return
  if (path.startsWith('/_app/immutable/') || path.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, path.startsWith('/assets/') ? RUNTIME_CACHE : ANKI_CACHE))
    return
  }
  if (path.startsWith('/_anki/') || path.startsWith('/_app/') || path.startsWith('/card-frame') || path === '/anki-host.js') {
    event.respondWith(staleWhileRevalidate(req, ANKI_CACHE))
    return
  }
  if (req.mode === 'navigate') {
    event.respondWith(appShell(req))
    return
  }
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE))
})

/** Anki's page shell; the page routes itself from the URL. */
async function ankiPage(name) {
  const file = UNTRUSTED_PAGES.has(name) ? '/anki-page-untrusted.html' : '/anki-page.html'
  return cachedOrNetwork(file, SHELL_CACHE)
}

/** Every app path is the same single-page app: the cached index, else the network. */
async function appShell(req) {
  const cached = await caches.match('/', ANY)
  if (cached) {
    // refresh in the background for next time
    fetch('/')
      .then(async (res) => {
        if (res.ok) (await caches.open(SHELL_CACHE)).put('/', res)
      })
      .catch(() => {})
    return cached
  }
  return fetch(req)
}

/**
 * A media file, from the app: the collection is in the app's engine, which only the
 * app's window can reach. Pages open only inside the app, so it is there to ask.
 */
async function fromApp(name) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const app = windows.find((c) => c.frameType === 'top-level' && !PAGE_RE.test(new URL(c.url).pathname))
  if (!app) return new Response('The app is not open', { status: 503 })
  const channel = new MessageChannel()
  const reply = new Promise((resolve) => {
    channel.port1.onmessage = (e) => resolve(e.data)
    setTimeout(() => resolve(null), 20000)
  })
  app.postMessage({ type: 'anki-media', name }, [channel.port2])
  const res = await reply
  if (!res || !res.data) return new Response('Not found', { status: 404 })
  return new Response(res.data, {
    headers: { 'Content-Type': res.type, 'Content-Security-Policy': UNTRUSTED_MEDIA_CSP, 'Cache-Control': 'no-store' },
  })
}

async function cachedOrNetwork(path, name) {
  const hit = await caches.match(path, ANY)
  if (hit) return hit
  const res = plain(await fetch(path))
  if (res.ok && !DEV) (await caches.open(name)).put(path, res.clone())
  return res
}

/**
 * The response without the mark of a redirect it followed. Cloudflare Pages redirects
 * /x.html to /x, and a browser refuses a redirected response as the answer to a page
 * load (Anki's pages, in their frame).
 */
function plain(res) {
  if (!res.redirected) return res
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
}

async function cacheFirst(req, name) {
  const hit = await caches.match(req, ANY)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) (await caches.open(name)).put(req, res.clone())
  return res
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name)
  const hit = await caches.match(req, ANY)
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => undefined)
  if (hit) return hit
  const res = await fresh
  return res || Response.error()
}
