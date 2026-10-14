// Second walk: media in the sandboxed frame, type-in answers, editing, dark theme,
// filtered decks, note types, sync of a change made by another client.
//
//   [BASE=…] [ENGINE=webkit|chromium] node tests/e2e_more.mjs   (see tests/lib.mjs)
import { base, setup } from './lib.mjs'

const t = await setup('scratch/shots2')
const { page, shot, check, api } = t

await t.login()

// ---- media: image through the media key, in the previewer ----
const media = await api('/api/browse/search', { search: 'tag:media' })
const mediaCard = await api(`/api/cards/${media.ids[0]}`)
await page.goto(`${base}/preview?note=${mediaCard.noteId}`)
await page.waitForTimeout(2500)
await shot('preview-image')
const frame = page.frameLocator('iframe.card-frame')
const imgOk = await frame.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false)
check(imgOk, 'image loads inside the sandboxed card frame')
await page.getByRole('button', { name: 'Show answer' }).click()
await page.waitForTimeout(1200)
await shot('preview-answer-audio')
check((await frame.locator('.replay-button').count()) > 0, 'audio play button on the answer')

// ---- the sandbox: card script can't reach the API ----
const sandboxed = await frame.locator('body').evaluate(async () => {
  try {
    const r = await fetch('/api/decks')
    return `reached ${r.status}`
  } catch (e) {
    return 'blocked'
  }
})
check(sandboxed !== 'reached 200', `card script cannot read the API (${sandboxed})`)

// ---- type-in answer ----
const typing = await api('/api/browse/search', { search: 'tag:typing' })
await api(`/api/decks/${(await api(`/api/cards/${typing.ids[0]}`)).deckId}`)
// a filtered deck left from an earlier run still holds the cards
for (const d of (await api('/api/decks')).decks) if (d.name === 'Typing test') await api(`/api/decks/${d.id}`, undefined, 'DELETE')
await api('/api/decks/filtered', {
  id: 0,
  name: 'Typing test',
  reschedule: true,
  terms: [{ search: 'tag:typing', limit: 10, order: 0 }],
})
await page.goto(`${base}/review`)
await page.waitForSelector('.show-answer:not([disabled])', { timeout: 15000 })
await page.waitForTimeout(800)
await frame.locator('#typeans').fill('gracias')
await shot('type-answer-question')
await page.locator('.show-answer').click()
await page.waitForSelector('.ease-btn')
await page.waitForTimeout(800)
await shot('type-answer-compared')
check((await frame.locator('.typeGood').count()) > 0, 'typed answer compared (typeGood)')
await page.locator('.ease-btn.ease3').click()
await page.waitForTimeout(1500)
await shot('filtered-finished')

// ---- edit an existing note in Anki's editor ----
const hola = await api('/api/browse/search', { search: 'hola' })
const holaCard = await api(`/api/cards/${hola.ids[0]}`)
await page.goto(`${base}/note/${holaCard.noteId}`)
await page.waitForTimeout(4000)
await shot('editor-edit')
const editor = page.frameLocator('iframe.anki-page-frame')
const firstField = editor.locator('[contenteditable="true"]').first()
check(((await firstField.textContent()) ?? '').includes('hola'), 'editor loaded the note')
await firstField.click()
await page.keyboard.press('End')
await page.keyboard.type('!')
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'back' }).click()
await page.waitForTimeout(1000)
const after = await api(`/api/browse/rows`, { ids: [hola.ids[0]] })
check(JSON.stringify(after).includes('hola!'), `edit saved (${after[0]?.cells?.[0]})`)

// ---- dark theme ----
await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('anki-pwa-prefs') || '{}')
  localStorage.setItem('anki-pwa-prefs', JSON.stringify({ ...p, theme: 'dark' }))
})
await page.goto(`${base}/`)
await page.waitForSelector('.deck-row')
await shot('dark-decks')
await page.goto(`${base}/page/graphs`)
await page.waitForTimeout(3000)
await shot('dark-graphs')
await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('anki-pwa-prefs') || '{}')
  localStorage.setItem('anki-pwa-prefs', JSON.stringify({ ...p, theme: 'light' }))
})

// ---- note types ----
await page.goto(`${base}/notetypes`)
await page.waitForSelector('.list-row')
await shot('notetypes')
const nts = await api('/api/notetypes')
const basic = nts.find((n) => n.name === 'Basic')
await page.goto(`${base}/notetypes/${basic.id}/templates`)
await page.waitForSelector('.template-code')
await page.getByRole('button', { name: 'Preview' }).click()
await page.waitForTimeout(2000)
await shot('template-editor')
await page.goto(`${base}/notetypes/${basic.id}/fields`)
await page.waitForSelector('.list-row')
await shot('fields')

// ---- card info, change of deck via the browser API ----
await page.goto(`${base}/page/card-info/${hola.ids[0]}`)
await page.waitForTimeout(2500)
await shot('card-info')

// ---- import page with a real .apkg (exported from this collection) ----
const exp = await api('/api/export', { kind: 'apkg', deckId: holaCard.deckId })
check(!!exp.url, `export apkg (${exp.name})`)
const fileRes = await page.evaluate(async (url) => (await fetch(url)).status, exp.url)
check(fileRes === 200, 'download the export')

await t.finish()
