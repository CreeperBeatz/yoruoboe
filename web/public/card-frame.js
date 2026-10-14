// Runs in the frame that shows cards, before Anki's reviewer.js.
//
// The frame is sandboxed without allow-same-origin: card templates may carry any
// JavaScript (shared decks do), and here it can neither read the app's cookie nor call
// its API. Desktop gives the reviewer the same isolation by allowing it only four
// backend calls; here the frame asks the app around it (web/src/screens/CardView.tsx),
// which allows the same few.
//
//  app -> frame  {type:'config', night, bodyExtraClass, css, gestures, doubleTapMs, zoom, imageZoom, centerVertically}
//                {type:'question', q, a, bodyClass, flag, marked}
//                {type:'answer', a, bodyClass}
//                {type:'flag', flag} {type:'mark', marked}
//                {type:'mutate-states', key, js}
//                {type:'get-typed', id}  {type:'scroll', by}  {type:'rpc-result', id, body?, error?}
//                {type:'user-action', n}  {type:'hint', all}
//  frame -> app  {type:'ready'} {type:'bridge', cmd} {type:'tap', zone} {type:'swipe', dir}
//                {type:'double-tap'} {type:'long-press'} {type:'key', ...} {type:'typed', id, value}
//                {type:'rpc', id, method, body} {type:'shown'}
;(() => {
  // The app builds this frame as a srcdoc (so it opens offline) and says where it is;
  // loaded by URL, the same comes in the hash.
  const given = window.__cardFrame || {}
  const params = new URLSearchParams(location.hash.slice(1))
  const origin = given.origin ?? ''
  // The app puts the card's media in as data URLs; anything else resolves here.
  document.querySelector('base').setAttribute('href', `${origin}/media/`)
  if ((given.night ?? params.get('night') === '1') === true) document.documentElement.classList.add('night-mode')

  const post = (msg) => window.parent.postMessage(msg, '*')

  // A sandboxed frame has no storage, and reading localStorage throws. Many templates
  // keep state in sessionStorage between a card's front and back: give them an in-memory
  // one, which lasts as long as the frame (the study session), much like the real thing.
  class MemoryStorage {
    #m = new Map()
    get length() {
      return this.#m.size
    }
    key(i) {
      return [...this.#m.keys()][i] ?? null
    }
    getItem(k) {
      return this.#m.has(String(k)) ? this.#m.get(String(k)) : null
    }
    setItem(k, v) {
      this.#m.set(String(k), String(v))
    }
    removeItem(k) {
      this.#m.delete(String(k))
    }
    clear() {
      this.#m.clear()
    }
  }
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      void window[name]
    } catch {
      const store = new MemoryStorage()
      try {
        Object.defineProperty(window, name, { value: store, configurable: true })
      } catch {}
    }
  }

  // reviewer.js calls the Qt bridge after every update, and card templates call it for
  // their play buttons and user actions.
  window.bridgeCommand = window.pycmd = (cmd) => {
    post({ type: 'bridge', cmd: String(cmd) })
    return false
  }
  // AnkiDroid's marker, which some templates test for.
  window.ankiPlatform = 'web'

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

  // The backend calls reviewer.js makes (custom scheduling, translations) go through
  // the app, which allows only these.
  const ALLOWED = new Set(['getSchedulingStatesWithContext', 'setSchedulingStates', 'i18nResources', 'congratsInfo'])
  let rpcSeq = 0
  const pending = new Map()
  const fetch0 = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    const m = /^\/_anki\/(\w+)$/.exec(url.pathname)
    if (m && (init?.method || 'GET').toUpperCase() === 'POST') {
      if (!ALLOWED.has(m[1])) return new Response('not allowed from a card', { status: 403 })
      const body = init && init.body ? new Uint8Array(init.body.buffer ?? init.body) : new Uint8Array()
      const id = ++rpcSeq
      const result = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        post({ type: 'rpc', id, method: m[1], body: toBase64(body) })
      })
      return new Response(result.length ? result : null, { status: result.length ? 200 : 204 })
    }
    return fetch0(input, init)
  }

  let config = { gestures: false, doubleTapMs: 200, zoom: 100, imageZoom: 100, centerVertically: false }

  function applyConfig() {
    document.documentElement.classList.toggle('night-mode', !!config.night)
    const css = []
    if (config.zoom && config.zoom !== 100) css.push(`#qa { zoom: ${config.zoom}%; }`)
    if (config.imageZoom && config.imageZoom !== 100) css.push(`#qa img { zoom: ${config.imageZoom}%; }`)
    if (config.centerVertically)
      css.push('html, body { height: 100%; } body { display: flex; flex-direction: column; justify-content: center; } #qa { width: 100%; }')
    if (config.css) css.push(config.css)
    document.getElementById('app').textContent = css.join('\n')
  }

  function bodyClass(cls) {
    // Desktop's classes for night mode, and AnkiDroid's for its themes.
    let extra = config.night ? ' nightMode night_mode' : ''
    if (config.theme === 'dark') extra += ' ankidroid_dark_mode'
    if (config.theme === 'plain') extra += ' ankidroid_plain_mode'
    return `${cls}${extra}${config.bodyExtraClass ? ' ' + config.bodyExtraClass : ''}`
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data) return
    const msg = e.data
    switch (msg.type) {
      case 'config':
        config = { ...config, ...msg }
        applyConfig()
        break
      case 'question':
        Promise.resolve(_showQuestion(msg.q, msg.a, bodyClass(msg.bodyClass))).then(() => post({ type: 'shown', side: 'question' }))
        _drawFlag(msg.flag || 0)
        _drawMark(!!msg.marked)
        hintsShown = 0
        break
      case 'answer':
        Promise.resolve(_showAnswer(msg.a, bodyClass(msg.bodyClass))).then(() => post({ type: 'shown', side: 'answer' }))
        break
      case 'flag':
        _drawFlag(msg.flag || 0)
        break
      case 'mark':
        _drawMark(!!msg.marked)
        break
      case 'mutate-states': {
        // As desktop's reviewer evaluates it: the deck's custom scheduling code, on a
        // line of its own so a trailing // comment can't swallow what follows.
        let done = false
        const finish = () => {
          if (!done) post({ type: 'bridge', cmd: 'statesMutated' })
          done = true
        }
        try {
          const run = new Function(
            'key',
            `return anki.mutateNextCardStates(key, async (states, customData, ctx) => {\n${msg.js}\n})`,
          )
          Promise.resolve(run(msg.key)).finally(finish)
        } catch (err) {
          console.error('custom scheduling failed', err)
          finish()
        }
        break
      }
      case 'get-typed':
        post({ type: 'typed', id: msg.id, value: getTypedAnswer() ?? '' })
        break
      case 'scroll':
        window.scrollBy({ top: msg.by * window.innerHeight, behavior: 'smooth' })
        break
      case 'rpc-result': {
        const p = pending.get(msg.id)
        if (!p) break
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.body ? fromBase64(msg.body) : new Uint8Array())
        break
      }
      case 'user-action': {
        // AnkiDroid's user actions: a template defines userJs1..9 (or userAction(n)).
        const fn = window[`userJs${msg.n}`]
        if (typeof fn === 'function') fn()
        else if (typeof window.userAction === 'function') window.userAction(msg.n)
        break
      }
      case 'hint':
        showHint(!!msg.all)
        break
    }
  })

  // {{hint:Field}} links: H shows the next, G all of them (AnkiDroid's SHOW_HINT).
  let hintsShown = 0
  function showHint(all) {
    const links = [...document.querySelectorAll('a.hint')].filter((a) => a.style.display !== 'none')
    for (const a of all ? links : links.slice(0, 1)) a.click()
    hintsShown++
  }

  // ---- gestures (AnkiDroid's ankidroid-reviewer.js) ----------------------------------

  function interactive(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      const tag = el.tagName
      if (/^(A|BUTTON|INPUT|TEXTAREA|SELECT|LABEL|DETAILS|SUMMARY|VIDEO|AUDIO|OPTION)$/.test(tag)) return true
      if (el.hasAttribute('onclick') || el.isContentEditable || el.getAttribute('role') === 'button') return true
      const style = getComputedStyle(el)
      if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth) return true
    }
    return false
  }

  function zone(x, y) {
    // Nine zones; the app maps them down to five when corner taps are off.
    const w = window.innerWidth
    const h = window.innerHeight
    const col = x < w / 3 ? 0 : x < (2 * w) / 3 ? 1 : 2
    const row = y < h / 3 ? 0 : y < (2 * h) / 3 ? 1 : 2
    return ['TopLeft', 'Top', 'TopRight', 'Left', 'Center', 'Right', 'BottomLeft', 'Bottom', 'BottomRight'][row * 3 + col]
  }

  let start = null
  let lastTap = null
  let tapTimer = null
  let longTimer = null

  document.addEventListener(
    'touchstart',
    (e) => {
      if (!config.gestures || e.touches.length !== 1 || interactive(e.target)) {
        start = null
        return
      }
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY, time: Date.now(), scrollY: window.scrollY, fired: false }
      clearTimeout(longTimer)
      longTimer = setTimeout(() => {
        if (start && !getSelection().toString()) {
          start.fired = true
          post({ type: 'long-press' })
        }
      }, 600)
    },
    { passive: true },
  )

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!start) return
      const t = e.touches[0]
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) clearTimeout(longTimer)
    },
    { passive: true },
  )

  document.addEventListener('touchend', (e) => {
    clearTimeout(longTimer)
    if (!start || start.fired) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    const scrolled = Math.abs(window.scrollY - start.scrollY) > 5
    const s = start
    start = null
    if (getSelection().toString()) return
    const sensitivity = (config.swipeSensitivity || 100) / 100
    const min = 100 / sensitivity
    if (Math.max(Math.abs(dx), Math.abs(dy)) > min && Date.now() - s.time < 800) {
      // A vertical swipe that scrolled the card was a scroll, not a gesture.
      if (Math.abs(dx) > Math.abs(dy)) post({ type: 'swipe', dir: dx > 0 ? 'Right' : 'Left' })
      else if (!scrolled) post({ type: 'swipe', dir: dy > 0 ? 'Down' : 'Up' })
      return
    }
    if (Math.hypot(dx, dy) > 10 || scrolled) return
    const z = zone(t.clientX, t.clientY)
    if (config.doubleTap) {
      if (lastTap && Date.now() - lastTap < config.doubleTapMs + 150) {
        clearTimeout(tapTimer)
        lastTap = null
        post({ type: 'double-tap' })
        return
      }
      lastTap = Date.now()
      tapTimer = setTimeout(() => post({ type: 'tap', zone: z }), config.doubleTapMs + 150)
    } else {
      post({ type: 'tap', zone: z })
    }
  })

  // Mouse users get taps too (desktop browsers, iPad with a trackpad).
  document.addEventListener('click', (e) => {
    if (!config.gestures || e.pointerType === 'touch' || interactive(e.target) || getSelection().toString()) return
    if (e.detail === 0) return
    post({ type: 'tap', zone: zone(e.clientX, e.clientY) })
  })

  document.addEventListener('keydown', (e) => {
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      if (t.id === 'typeans' && e.key === 'Enter') return // _typeAnsPress handles it
      return
    }
    post({ type: 'key', key: e.key, code: e.code, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey })
    if ([' ', 'Enter'].includes(e.key)) e.preventDefault()
  })

  // ---- AnkiDroid's JavaScript API for card templates (assets/scripts/js-api.js) ---------
  //
  // Same methods and answers ({success, value}) as AnkiDroid, so templates written for
  // AnkiDroid work here. Each call goes to the app, which answers from the card on screen.

  let jsSeq = 0
  const jsPending = new Map()
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data || e.data.type !== 'jsapi-result') return
    const p = jsPending.get(e.data.id)
    if (!p) return
    jsPending.delete(e.data.id)
    p(e.data.text)
  })
  const jsApi = (endpoint, data) =>
    new Promise((resolve) => {
      const id = ++jsSeq
      jsPending.set(id, (text) => {
        if (endpoint.includes('nextTime') || endpoint.includes('deckName')) resolve(text)
        else {
          try {
            resolve(JSON.parse(text))
          } catch {
            resolve(text)
          }
        }
      })
      post({ type: 'jsapi', id, endpoint, data })
    })

  const JS_API = {
    ankiGetNewCardCount: 'newCardCount', ankiGetLrnCardCount: 'lrnCardCount', ankiGetRevCardCount: 'revCardCount',
    ankiGetETA: 'eta', ankiGetCardMark: 'cardMark', ankiGetCardFlag: 'cardFlag',
    ankiGetNextTime1: 'nextTime1', ankiGetNextTime2: 'nextTime2', ankiGetNextTime3: 'nextTime3', ankiGetNextTime4: 'nextTime4',
    ankiGetCardReps: 'cardReps', ankiGetCardInterval: 'cardInterval', ankiGetCardFactor: 'cardFactor', ankiGetCardMod: 'cardMod',
    ankiGetCardId: 'cardId', ankiGetCardNid: 'cardNid', ankiGetCardType: 'cardType', ankiGetCardDid: 'cardDid',
    ankiGetCardLeft: 'cardLeft', ankiGetCardODid: 'cardODid', ankiGetCardODue: 'cardODue', ankiGetCardQueue: 'cardQueue',
    ankiGetCardLapses: 'cardLapses', ankiGetCardDue: 'cardDue', ankiIsInFullscreen: 'isInFullscreen',
    ankiSetFullscreenButtonsAndMenu: 'setFullscreenButtonsAndMenu', ankiSetFullscreenButtonsOnly: 'setFullscreenButtonsOnly',
    ankiSetFullscreenAllGone: 'setFullscreenAllGone', ankiIsTopbarShown: 'isTopbarShown', ankiIsInNightMode: 'isInNightMode',
    ankiIsDisplayingAnswer: 'isDisplayingAnswer', ankiGetDeckName: 'deckName', ankiIsActiveNetworkMetered: 'isActiveNetworkMetered',
    ankiTtsFieldModifierIsAvailable: 'ttsFieldModifierIsAvailable', ankiTtsIsSpeaking: 'ttsIsSpeaking', ankiTtsStop: 'ttsStop',
    ankiBuryCard: 'buryCard', ankiBuryNote: 'buryNote', ankiSuspendCard: 'suspendCard', ankiSuspendNote: 'suspendNote',
    ankiAddTagToCard: 'addTagToCard', ankiResetProgress: 'resetProgress', ankiMarkCard: 'markCard', ankiToggleFlag: 'toggleFlag',
    ankiSearchCard: 'searchCard', ankiSearchCardWithCallback: 'searchCardWithCallback', ankiTtsSpeak: 'ttsSpeak',
    ankiTtsSetLanguage: 'ttsSetLanguage', ankiTtsSetPitch: 'ttsSetPitch', ankiTtsSetSpeechRate: 'ttsSetSpeechRate',
    ankiEnableHorizontalScrollbar: 'enableHorizontalScrollbar', ankiEnableVerticalScrollbar: 'enableVerticalScrollbar',
    ankiSetCardDue: 'setCardDue', ankiShowNavigationDrawer: 'showNavigationDrawer', ankiShowOptionsMenu: 'showOptionsMenu',
    ankiShowToast: 'showToast', ankiShowAnswer: 'showAnswer', ankiAnswerEase1: 'answerEase1', ankiAnswerEase2: 'answerEase2',
    ankiAnswerEase3: 'answerEase3', ankiAnswerEase4: 'answerEase4', ankiSttSetLanguage: 'sttSetLanguage', ankiSttStart: 'sttStart',
    ankiSttStop: 'sttStop', ankiAddTagToNote: 'addTagToNote', ankiSetNoteTags: 'setNoteTags', ankiGetNoteTags: 'getNoteTags',
  }

  class AnkiDroidJS {
    constructor({ developer, version } = {}) {
      this.developer = developer
      this.version = version
      this.handleRequest('init')
    }
    static init(contract) {
      return new AnkiDroidJS(contract)
    }
    handleRequest(endpoint, data) {
      return jsApi(endpoint, data)
    }
  }
  for (const [method, endpoint] of Object.entries(JS_API)) {
    AnkiDroidJS.prototype[method] = function (...args) {
      let data = args[0]
      if (method === 'ankiAddTagToNote') data = JSON.stringify({ noteId: args[0], tag: args[1] })
      else if (method === 'ankiSetNoteTags') data = JSON.stringify({ tags: (args[0] || []).map((t) => String(t).trim().replace(/[ 　]/g, '_')) })
      else if (method === 'ankiTtsSpeak') data = JSON.stringify({ text: args[0], queueMode: args[1] ?? 0 })
      else if (method === 'ankiShowToast') data = JSON.stringify({ text: args[0], shortLength: args[1] ?? true })
      return this.handleRequest(endpoint, data)
    }
  }
  window.AnkiDroidJS = AnkiDroidJS

  // The globals AnkiDroid's card.js and ankidroid-reviewer.js give templates.
  window.showAnswer = () => window.bridgeCommand('ans')
  for (let i = 1; i <= 4; i++) window[`buttonAnswerEase${i}`] = () => window.bridgeCommand(`ease${i}`)
  window.reloadPage = () => post({ type: 'reload' })
  window.taFocus = () => document.getElementById('typeans')?.focus()
  window.showHint = () => showHint(false)
  window.showAllHints = () => showHint(true)
  window.userAction = (n) => {
    const fn = window[`userJs${n}`]
    if (typeof fn === 'function') fn()
  }
  window.ankidroid = Object.assign(window.ankidroid || {}, {
    showHint: window.showHint,
    showAllHints: window.showAllHints,
    userAction: window.userAction,
  })

  window.cardFrameReady = () => post({ type: 'ready' })
})()
