// End-to-end walk through the app on an iPhone-sized WebKit, with screenshots.
//
//   [BASE=…] [ENGINE=webkit|chromium] node tests/e2e.mjs   (see tests/lib.mjs)
//
// Expects the seeded collection (tests/seed_collection.py) on the sync server.
import { base, setup } from './lib.mjs'

const t = await setup('scratch/shots')
const { page, shot, check, api } = t

// ---- sign in ----
await page.goto(base)
await shot('login')
await t.login()
await shot('decks')
check((await page.locator('.deck-row').count()) >= 2, 'deck list shows decks')

// expand Languages
const languages = page.locator('.deck-row', { hasText: 'Languages' })
if (!(await page.locator('.deck-row', { hasText: 'Spanish' }).isVisible())) {
  await languages.locator('.deck-expander').click()
  await page.waitForTimeout(400)
}
await shot('decks-expanded')

// ---- study Spanish ----
await page.locator('.deck-row', { hasText: 'Spanish' }).locator('.deck-name').click()
await page.waitForURL('**/review')
await page.waitForSelector('.show-answer:not([disabled])', { timeout: 15000 })
await page.waitForTimeout(800)
await shot('question')
const frame = page.frameLocator('iframe.card-frame')
check(((await frame.locator('#qa').textContent()) ?? '').trim().length > 0, 'card question rendered in frame')
await page.locator('.show-answer').click()
await page.waitForSelector('.ease-btn', { timeout: 10000 })
await page.waitForTimeout(600)
await shot('answer')
const labels = await page.locator('.ease-btn .ivl').allTextContents()
check(labels.length === 4 && labels.every((l) => l.trim()), `interval labels ${JSON.stringify(labels)}`)
await page.locator('.ease-btn.ease3').click()
await page.waitForTimeout(1200)
await shot('next-question')

// overflow menu
await page.getByRole('button', { name: 'More' }).click()
await shot('reviewer-menu')
await page.keyboard.press('Escape')


// undo
await page.getByRole('button', { name: /^Undo/ }).first().click()
await page.waitForTimeout(800)
await shot('after-undo')

// ---- back to decks, deck options ----
await page.goto(`${base}/`)
await page.waitForSelector('.deck-row')
await page.locator('.deck-row', { hasText: 'Geography' }).locator('.deck-name').click({ button: 'right' })
await shot('deck-menu')
await page.getByRole('menuitem', { name: 'Deck options' }).click()
await page.waitForTimeout(3000)
await shot('deck-options')
check(await page.frameLocator('iframe.anki-page-frame').getByRole('heading', { name: 'Daily Limits' }).first().isVisible(), 'deck options page loaded')

// ---- statistics ----
await page.goto(`${base}/page/graphs`)
await page.waitForTimeout(3000)
await shot('graphs')

// ---- add note (Anki's editor) ----
await page.goto(`${base}/note/add`)
await page.waitForTimeout(4000)
await shot('editor-add')
const editor = page.frameLocator('iframe.anki-page-frame')
const fields = editor.locator('[contenteditable="true"]')
check((await fields.count()) >= 2, `editor shows fields (${await fields.count()})`)

// ---- browser ----
await page.goto(`${base}/browse?search=deck:*`)
await page.waitForSelector('.browser-row', { timeout: 15000 })
await page.waitForTimeout(800)
await shot('browser')
check((await page.locator('.browser-row').count()) >= 10, 'browser lists cards')

// ---- settings ----
await page.goto(`${base}/settings`)
await shot('settings')
await page.goto(`${base}/settings/reviewing`)
await page.waitForTimeout(800)
await shot('settings-reviewing')

// ---- study cloze + media deck ----
await page.goto(`${base}/`)
await page.waitForSelector('.deck-row')
await page.locator('.deck-row', { hasText: 'Geography' }).locator('.deck-name').click()
await page.waitForSelector('.show-answer:not([disabled])', { timeout: 15000 })
await page.waitForTimeout(1500)
await shot('geo-question')

await t.finish()
