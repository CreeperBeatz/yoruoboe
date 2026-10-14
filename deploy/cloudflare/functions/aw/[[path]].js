// Cloudflare Pages Function: the app's sync requests, passed on to AnkiWeb.
//
// The same as deploy/serve.py does on the Pi. The browser can't call AnkiWeb itself (no
// CORS), so the app posts to its own address, /aw/<host>/<path>, and this passes the
// request on to https://<host>.ankiweb.net/<path> unchanged. Nothing is stored.
//
// Deploy with the built app (see README, "Cloudflare Pages"):
//   cd deploy/cloudflare && npx wrangler pages deploy ../../web/dist --project-name anki

const HOST = /^sync\d{0,3}$/
const REQUEST_HEADERS = ['anki-sync', 'content-type', 'content-length']
const RESPONSE_HEADERS = ['content-type', 'content-length', 'anki-original-size']

export async function onRequestPost({ request, params }) {
  const [host, ...rest] = Array.isArray(params.path) ? params.path : [params.path]
  if (!HOST.test(host ?? '')) return new Response('not found', { status: 404 })
  const url = new URL(request.url)
  const target = `https://${host}.ankiweb.net/${rest.join('/')}${url.search}`

  const headers = new Headers()
  for (const k of REQUEST_HEADERS) {
    const v = request.headers.get(k)
    if (v) headers.set(k, v)
  }
  const resp = await fetch(target, { method: 'POST', headers, body: request.body, redirect: 'manual' })

  const out = new Headers({ 'Cache-Control': 'no-store' })
  for (const k of RESPONSE_HEADERS) {
    const v = resp.headers.get(k)
    if (v) out.set(k, v)
  }
  const location = resp.headers.get('location')
  if (location) {
    // a move to another AnkiWeb host, as the app reaches it
    const m = /^https:\/\/(sync\d{0,3})\.ankiweb\.net(\/.*)$/.exec(location)
    out.set('location', m ? `/aw/${m[1]}${m[2]}` : location)
  }
  return new Response(resp.body, { status: resp.status, headers: out })
}

export function onRequest() {
  return new Response('method not allowed', { status: 405 })
}
