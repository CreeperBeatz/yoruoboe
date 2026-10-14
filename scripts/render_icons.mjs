// Renders web/public/favicon.svg to the PNG icons the manifest and iOS want.
//   node scripts/render_icons.mjs
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { chromium } = require('playwright')
const pub = fileURLToPath(new URL('../web/public/', import.meta.url))
const svg = readFileSync(pub + 'favicon.svg', 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, size, rounded] of [['icon-192.png', 192, true], ['icon-512.png', 512, true], ['apple-touch-icon.png', 180, false]]) {
  // iOS rounds the corners itself: give it the square.
  const body = rounded ? svg : svg.replace('rx="112"', 'rx="0"')
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${body.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await page.screenshot({ path: pub + name, omitBackground: true })
}
await browser.close()
console.log('icons written')
