// Loaded first into Anki's own pages (deck options, editor, statistics, ...) when the app
// shows them in a frame. On desktop a Qt dialog around each page answers what the page
// asks of its host, and a web server its backend calls; here the app around the frame
// does both (web/src/screens/pageHost.tsx), through postMessage.
//
//  page -> app   {source:'anki-page', type:'bridge', cmd}           bridgeCommand(cmd)
//                {source:'anki-page', type:'rpc', id, method, body}  a backend call (/_anki/<method>)
//  app -> page   {source:'anki-host', type:'rpc-result', id, body?, error?}
//                {source:'anki-host', type:'invoke', id?, fn, args, afterLoaded}  call a page global
//  page -> app   {source:'anki-page', type:'invoke-result', id, value (JSON), error?}
;(() => {
  const ORIGIN = location.origin
  const toParent = (msg) => {
    if (window.parent !== window) window.parent.postMessage({ source: 'anki-page', ...msg }, ORIGIN)
  }

  const toBase64 = (bytes) => {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  }
  const fromBase64 = (b64) => {
    const s = atob(b64)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  }
  const bodyBytes = (body) => {
    if (!body) return new Uint8Array()
    if (body instanceof Uint8Array) return body
    if (body instanceof ArrayBuffer) return new Uint8Array(body)
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    if (typeof body === 'string') return new TextEncoder().encode(body)
    return new Uint8Array()
  }

  // Every backend call goes to the app: Anki's engine runs there (desktop's pages post
  // to its web server instead).
  let rpcSeq = 0
  const pending = new Map()

  const fetch0 = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    const m = /^\/_anki\/(\w+)$/.exec(url.pathname)
    const method = m && m[1]
    const post = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase() === 'POST'
    if (!method || !post) return fetch0(input, init)
    const id = ++rpcSeq
    let body = init && init.body
    if (body === undefined && typeof input !== 'string') body = new Uint8Array(await input.arrayBuffer())
    try {
      const result = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        toParent({ type: 'rpc', id, method, body: toBase64(bodyBytes(body)) })
      })
      return new Response(result.length ? result : null, {
        status: result.length ? 200 : 204,
        headers: { 'Content-Type': 'application/binary' },
      })
    } catch (err) {
      // as the desktop server answers a failed call
      return new Response(String(err && err.message ? err.message : err), { status: 500, headers: { 'Content-Type': 'text/plain' } })
    }
  }

  // The Qt bridge. Pages call it for events (editorReady, key:0, saved, ...) and the
  // congrats page for its links; reviewer.js calls it after every update.
  window.bridgeCommand = window.pycmd = (cmd, cb) => {
    toParent({ type: 'bridge', cmd: String(cmd) })
    if (cb) setTimeout(() => cb(null), 0)
    return false
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== ORIGIN || !e.data || e.data.source !== 'anki-host') return
    const msg = e.data
    if (msg.type === 'rpc-result') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg.body ? fromBase64(msg.body) : new Uint8Array())
    } else if (msg.type === 'invoke') {
      const reply = (value, error) => {
        if (msg.id == null) return
        let json = null
        try {
          json = JSON.stringify(value === undefined ? null : value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
        } catch {}
        toParent({ type: 'invoke-result', id: msg.id, value: json, error })
      }
      const run = async () => {
        try {
          const path = msg.fn.split('.')
          const owner = path.slice(0, -1).reduce((o, k) => (o == null ? o : o[k]), globalThis)
          const target = owner == null ? undefined : owner[path[path.length - 1]]
          if (typeof target !== 'function') return reply(undefined, `no function ${msg.fn}`)
          reply(await target.apply(owner, msg.args || []))
        } catch (err) {
          reply(undefined, String(err))
        }
      }
      if (msg.afterLoaded && typeof require === 'function') {
        try {
          require('anki/ui').loaded.then(run)
          return
        } catch {}
      }
      run()
    } else if (msg.type === 'css') {
      const style = document.createElement('style')
      style.textContent = msg.css
      ;(document.head || document.documentElement).appendChild(style)
    }
  })

  // Night mode follows the app: it opens pages with #night, as desktop does.
})()
