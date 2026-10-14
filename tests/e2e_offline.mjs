// The app with no connection: everything works from the device, then syncs.
//
//   BASE=http://127.0.0.1:8780 ENGINE=chromium node tests/e2e_offline.mjs
//
// Needs a production build (the service worker caches the app): build, then
// `python deploy/serve.py --port 8780 --sync-target http://127.0.0.1:27701`.
// Chromium: Playwright drives service workers there.
import { base, setup } from './lib.mjs'

const t = await setup('scratch/shots-offline')
const { page, ctx, shot, check, api } = t

await t.login()
await page.evaluate(() => navigator.serviceWorker.ready)
// controlled by the worker from the next load
await page.reload()
await page.waitForSelector('.deck-row')
check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the app')
// Anki's pages are fetched in the background after install
await page.waitForTimeout(8000)
const before = await api('/api/decks')
console.log('before:', before.studiedToday, before.cardCount, 'cards')

// ---- no connection, a cold start ----
await ctx.setOffline(true)
await page.goto(base)
await page.waitForSelector('.deck-row', { timeout: 30000 })
await shot('offline-decks')
check((await page.locator('.deck-row').count()) >= 2, 'deck list opens offline')

// study
const spanish = page.locator('.deck-row', { hasText: 'Spanish' })
if (!(await spanish.isVisible())) await page.locator('.deck-row', { hasText: 'Languages' }).locator('.deck-expander').click()
await page.locator('.deck-row', { hasText: 'Spanish' }).locator('.deck-name').click()
await page.waitForURL('**/review')
await page.waitForSelector('.show-answer:not([disabled])', { timeout: 15000 })
const frame = page.frameLocator('iframe.card-frame')
check(((await frame.locator('#qa').textContent()) ?? '').trim().length > 0, 'card shown offline')
for (let i = 0; i < 3; i++) {
  const next = await page.locator('.show-answer:not([disabled])').waitFor({ timeout: 8000 }).then(() => true, () => false)
  if (!next) {
    await shot(`offline-no-card-${i}`)
    break
  }
  await page.locator('.show-answer').click()
  await page.waitForSelector('.ease-btn')
  if (i === 0) {
    const labels = await page.locator('.ease-btn .ivl').allTextContents()
    check(labels.every((l) => l.trim()), `intervals shown offline ${JSON.stringify(labels)}`)
    await shot('offline-answer')
  }
  await page.waitForTimeout(400)
  await page.locator('.ease-btn.ease3').click()
  await page.locator('.ease-btn').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  // past AnkiDroid's double-tap guard, which ignores a tap right after an answer
  await page.waitForTimeout(400)
}
await shot('offline-after-3')

// media card offline
await page.goto(base)
await page.waitForSelector('.deck-row')
await page.locator('.deck-row', { hasText: 'Geography' }).locator('.deck-name').click()
await page.waitForSelector('.show-answer:not([disabled])')
let sawImage = false
for (let i = 0; i < 6 && !sawImage; i++) {
  await page.waitForTimeout(800)
  sawImage = await frame.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false)
  if (!sawImage) {
    await page.locator('.show-answer:not([disabled])').click()
    await page.waitForSelector('.ease-btn')
    await page.waitForTimeout(400)
    await page.locator('.ease-btn.ease4').click()
    await page.locator('.ease-btn').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(400)
  }
}
check(sawImage, 'image shown offline')

// add a note offline, in Anki's editor
const stamp = `offline ${Date.now()}`
await page.goto(`${base}/note/add`)
await page.waitForTimeout(4000)
await shot('offline-editor')
const editor = page.frameLocator('iframe.anki-page-frame')
const fields = editor.locator('[contenteditable="true"]')
check((await fields.count()) >= 2, 'editor opens offline')
await fields.nth(0).click()
await page.keyboard.type(stamp)
await fields.nth(1).click()
await page.keyboard.type('added without a connection')
await editor.getByRole('button', { name: 'Add', exact: true }).click()
await page.waitForTimeout(1500)
const found = await api('/api/browse/search', { search: `"${stamp}"` })
check(found.ids.length === 1, 'note added offline')

const after = await api('/api/decks')
check(after.studiedToday !== before.studiedToday, `studied offline (${after.studiedToday})`)

// ---- back online: it all syncs ----
await ctx.setOffline(false)
const res = await api('/api/sync', {})
check(!res.conflict && !res.state.lastError, `synced (${res.state.lastError || 'ok'})`)
console.log('STAMP', stamp)

await t.finish()
