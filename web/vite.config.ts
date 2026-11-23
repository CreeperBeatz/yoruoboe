import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/** Anki's own pages and assets, unpacked from the aqt wheel by scripts/fetch_anki_web.py. */
const ANKI_WEB = resolve(import.meta.dirname, '../vendor/anki-web')

// Anki's pages, at these paths as desktop serves them; the app shows them in a frame.
const ANKI_PAGES = [
  'graphs', 'congrats', 'card-info', 'change-notetype', 'deck-options', 'import-anki-package',
  'import-csv', 'import-page', 'image-occlusion', 'editor',
]
// Pages that show note content keep SvelteKit's script policy, so script in a field
// can't run with the page's access to the collection (as desktop does).
const UNTRUSTED_PAGES = new Set(['editor', 'image-occlusion'])
const ANKI_PAGE_RE = new RegExp(`^/(${ANKI_PAGES.join('|')})(/|$)`)

const CSP_META = /<meta http-equiv="content-security-policy" content="script-src 'self' 'sha256-[A-Za-z0-9+/=]+'">/

/** The SvelteKit shell for a page: with the host script first, its policy kept or not. */
function ankiPageHtml(untrusted: boolean): string {
  let html = readFileSync(join(ANKI_WEB, 'sveltekit', 'index.html'), 'utf8')
  if (!untrusted) html = html.replace(CSP_META, '')
  // First in <head>, so bridgeCommand and the fetch bridge exist before the page's code.
  return html.replace('<head>', '<head>\n\t\t<script src="/anki-host.js"></script>')
}

/** /_anki/<rest> as desktop maps it: top-level css/js live in css/ and js/. */
function legacyPath(rest: string): string {
  if (!rest.includes('/')) {
    const ext = extname(rest)
    const stem = rest.slice(0, rest.length - ext.length)
    if (ext === '.css') return `css/${rest}`
    if (ext === '.js') return ['jquery', 'jquery-ui', 'plot'].includes(stem) ? `js/vendor/${rest}` : `js/${rest}`
  }
  return rest
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function serviceWorkerSource(version: string, shell: string[], ankiAssets: string[] = []): string {
  return readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8')
    .replace("'__VERSION__'", JSON.stringify(version))
    .replace('__SHELL__', JSON.stringify(shell, null, 2))
    .replace("'__ANKI_ASSETS__'", JSON.stringify(ankiAssets))
    .replace("'__ANKI_PAGES__'", JSON.stringify(ANKI_PAGES))
    .replace("'__UNTRUSTED_PAGES__'", JSON.stringify([...UNTRUSTED_PAGES]))
}

/**
 * Anki's pages and their assets: served from vendor/ in development, copied into the
 * build; and the service worker, which routes the pages' URLs and media (sw.template.js).
 */
function ankiWeb(): Plugin {
  return {
    name: 'anki-web',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        const path = decodeURIComponent((req.url ?? '/').split('?')[0])
        let file: string | null = null
        if (path === '/sw.js') {
          res.setHeader('Content-Type', 'text/javascript')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(serviceWorkerSource('dev', []))
          return
        }
        const anki = /^(?:\/editor)?\/_anki\/(.+)$/.exec(path)
        if (anki) file = join(ANKI_WEB, legacyPath(anki[1]))
        else if (path.startsWith('/_app/')) file = join(ANKI_WEB, 'sveltekit', path)
        else if (path === '/anki-page.html' || path === '/anki-page-untrusted.html') {
          res.setHeader('Content-Type', 'text/html')
          res.end(ankiPageHtml(path.includes('untrusted')))
          return
        } else if (ANKI_PAGE_RE.test(path) && !/\.[a-z0-9]+$/i.test(path)) {
          const page = ANKI_PAGE_RE.exec(path)![1]
          res.setHeader('Content-Type', 'text/html')
          res.end(ankiPageHtml(UNTRUSTED_PAGES.has(page)))
          return
        }
        if (!file) return next()
        const full = resolve(file)
        if (!full.startsWith(ANKI_WEB + sep) || !existsSync(full) || statSync(full).isDirectory()) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', MIME[extname(full)] ?? 'application/octet-stream')
        res.end(readFileSync(full))
      })
    },
    // last, after Vite has dropped CSS-only chunks: the worker lists what is really there
    generateBundle: { order: 'post', handler(_, bundle) {
      if (!existsSync(ANKI_WEB)) this.error(`${ANKI_WEB} is missing: run scripts/fetch_anki_web.py`)
      const ankiAssets: string[] = []
      for (const full of walk(ANKI_WEB)) {
        const rel = relative(ANKI_WEB, full).split(sep).join('/')
        if (rel === 'sveltekit/index.html') continue
        const fileName = rel.startsWith('sveltekit/') ? rel.slice('sveltekit/'.length) : `_anki/${rel}`
        this.emitFile({ type: 'asset', fileName, source: readFileSync(full) })
        ankiAssets.push(`/${fileName}`)
      }
      this.emitFile({ type: 'asset', fileName: 'anki-page.html', source: ankiPageHtml(false) })
      // Cloudflare Pages: Anki's pages on first load, before the service worker routes them
      // (deploy/serve.py does the same on the Pi). Pages serves x.html at /x and redirects
      // /x.html there, which would lose the page's own path: so the target is /x.
      // The first rule that matches wins: the editor's assets before /editor/*.
      const redirects = [
        '/editor/_anki/* /_anki/:splat 200',
        ...ANKI_PAGES.flatMap((p) => {
          const file = UNTRUSTED_PAGES.has(p) ? '/anki-page-untrusted' : '/anki-page'
          return [`/${p} ${file} 200`, `/${p}/* ${file} 200`]
        }),
      ]
      this.emitFile({ type: 'asset', fileName: '_redirects', source: `${redirects.join('\n')}\n` })
      // Cloudflare Pages: the sync forwarder (deploy/cloudflare/_worker.js), run for /aw/*
      // only, so that the built folder alone is the whole site.
      this.emitFile({
        type: 'asset',
        fileName: '_worker.js',
        source: readFileSync(resolve(import.meta.dirname, '../deploy/cloudflare/_worker.js')),
      })
      this.emitFile({ type: 'asset', fileName: '_routes.json', source: `${JSON.stringify({ version: 1, include: ['/aw/*'], exclude: [] })}\n` })
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          '  X-Content-Type-Options: nosniff',
          "  Content-Security-Policy: frame-ancestors 'self'",
          '/assets/*',
          '  Cache-Control: public, max-age=31536000, immutable',
          '',
        ].join('\n'),
      })
      this.emitFile({ type: 'asset', fileName: 'anki-page-untrusted.html', source: ankiPageHtml(true) })

      // The app shell, cached by the service worker at install so the app opens offline.
      const shell = new Set<string>([
        '/', '/manifest.webmanifest', '/favicon.svg', '/favicon-32.png', '/icon-192.png', '/apple-touch-icon.png', '/anki-host.js',
        '/anki-page.html', '/anki-page-untrusted.html',
      ])
      for (const [name, out] of Object.entries(bundle)) {
        if (name === '_worker.js') continue // Cloudflare's, never served
        if (out.type === 'chunk' || /\.(css|js|mjs|wasm|woff2)$/.test(name)) shell.add(`/${name}`)
      }
      const files = [...shell].sort()
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, files, ankiAssets.sort()) })
    } },
  }
}

// Sync requests go to the app's own address under /aw/<host>/, and the host serving the
// app passes them on to <host>.ankiweb.net (see deploy/). In development they go to a
// local sync server instead, unless ANKI_SYNC_TARGET says otherwise.
const syncTarget = process.env.ANKI_SYNC_TARGET ?? 'http://127.0.0.1:27701'

export default defineConfig({
  plugins: [react(), ankiWeb()],
  // the Anki release the engine is built from (ANKI_VERSION)
  define: { __ANKI_VERSION__: JSON.stringify(readFileSync(resolve(import.meta.dirname, '../ANKI_VERSION'), 'utf8').trim()) },
  worker: { format: 'es' },
  server: {
    host: true,
    proxy: {
      '^/aw/[a-z0-9]+/': {
        target: syncTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/aw\/[a-z0-9]+/, ''),
      },
    },
  },
})
