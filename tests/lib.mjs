// Shared setup for the browser walkthroughs: an iPhone-sized browser with its own
// profile (WebKit needs one for storage), screenshots, checks, sign-in, and the app's API.
//
// Settings come from the environment:
//   BASE        the app (default http://127.0.0.1:5180, the dev server)
//   ENGINE      chromium | webkit (default webkit, Safari's engine)
//   ANKI_USER   sync server account (default dani; password from scratch/dani-password.txt)
//   ANKI_PASS
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(new URL('../web/package.json', import.meta.url))
export const pw = require('playwright')

export const base = process.env.BASE ?? 'http://127.0.0.1:5180'
export const engine = process.env.ENGINE ?? 'webkit'
export const user = process.env.ANKI_USER ?? 'dani'
export const pass = process.env.ANKI_PASS ?? readFileSync(new URL('../scratch/dani-password.txt', import.meta.url), 'utf8').trim()

export async function setup(outDir) {
  const out = `${outDir}-${engine}`
  mkdirSync(out, { recursive: true })
  const { defaultBrowserType: _, ...iphone } = pw.devices['iPhone 13']
  const ctx = await pw[engine].launchPersistentContext(mkdtempSync(join(tmpdir(), 'anki-e2e-')), iphone)
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const problems = []
  let step = 0
  // Known and harmless: Anki's editor trips over WebKit's selection when a field is
  // focused (upstream, safePlaceCaretAfterContent); WebKit doesn't know a viewport key.
  const KNOWN = /t\.anchor|interactive-widget|favicon/
  page.on('pageerror', (e) => !KNOWN.test(e.message) && problems.push(`pageerror after step ${step}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !KNOWN.test(m.text())) problems.push(`console after step ${step}: ${m.text()}`)
  })
  ctx.on('requestfailed', (r) => console.log('request failed:', r.url().slice(0, 150), r.failure()?.errorText))
  page.on('response', (r) => r.status() >= 400 && !/favicon|\/media\//.test(r.url()) && problems.push(`http ${r.status()} ${r.url()}`))
  const t = {
    ctx,
    page,
    problems,
    async shot(name) {
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${out}/${String(++step).padStart(2, '0')}-${name}.png` })
      console.log('shot', name)
    },
    check(cond, msg) {
      if (!cond) problems.push(`FAILED: ${msg}`)
      console.log(cond ? 'ok:' : 'FAILED:', msg)
    },
    /** The app's API, as the screens call it (answered on the device). */
    api(path, body, method) {
      return page.evaluate(
        ([path, body, method]) => {
          const api = window.__anki.api
          if (method === 'DELETE') return api.del(path)
          return body === undefined ? api.get(path) : api.post(path, body)
        },
        [path, body, method],
      )
    },
    async login() {
      await page.goto(base)
      await page.getByLabel('Email').fill(user)
      await page.getByLabel('Password').fill(pass)
      await page.getByRole('button', { name: 'Log in' }).click()
      await page.waitForSelector('.deck-row', { timeout: 90000 })
    },
    async finish() {
      console.log('\n---- problems ----')
      console.log(problems.length ? problems.join('\n') : 'none')
      await ctx.close()
      process.exit(problems.some((p) => p.startsWith('FAILED') || p.startsWith('pageerror')) ? 1 : 0)
    },
  }
  return t
}
