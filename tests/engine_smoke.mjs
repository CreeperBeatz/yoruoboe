// Runs web/engine-smoke.html (the engine on its own) in a browser and prints the log.
//
//   node tests/engine_smoke.mjs [chromium|webkit] [baseUrl] [user] [pass]
//
// Runs twice on one profile: the second run checks the collection survived a reload.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const pw = require('playwright')

const engine = process.argv[2] ?? 'chromium'
const base = process.argv[3] ?? 'http://127.0.0.1:5180'
const user = process.argv[4] ?? 'dani'
const pass = process.argv[5] ?? readFileSync(new URL('../scratch/dani-password.txt', import.meta.url), 'utf8').trim()

// a persistent profile: WebKit only has OPFS/IndexedDB storage behind one
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const ctx = await pw[engine].launchPersistentContext(mkdtempSync(join(tmpdir(), 'anki-smoke-')), {})
const browser = ctx
const page = await ctx.newPage()
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

async function run(reset) {
  const url = `${base}/engine-smoke.html?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}&profile=smoke${reset ? '&reset=1' : ''}${process.env.STORAGE ? '&storage=' + process.env.STORAGE : ''}`
  await page.goto(url)
  await page.waitForFunction(() => window.smoke, null, { timeout: 180000 })
  return page.evaluate(() => window.smoke)
}

const first = await run(true)
console.log('\nfirst run:', JSON.stringify(first))
const second = await run(false)
console.log('\nsecond run:', JSON.stringify(second))
const ok = first.ok && second.ok && second.cardsAtOpen === second.cardsAfterSync && second.cardsAtOpen > 0
console.log(ok ? '\nPASS' : '\nFAIL')
await browser.close()
process.exit(ok ? 0 : 1)
