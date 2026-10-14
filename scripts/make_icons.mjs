// The app's icons: Anki's mark (a tilted card with its rounded star in front) in
// BetterRTK's colours, with BetterRTK's 漢 on the card.
//
//   node scripts/make_icons.mjs
//
// Writes web/public: favicon.svg, favicon-32.png, apple-touch-icon.png (180, full
// bleed: iOS rounds the corners itself), icon-192.png, icon-512.png and
// icon-maskable-512.png (content in the middle 80%, for Android's masks).
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const require = createRequire(new URL('../web/package.json', import.meta.url))
const { chromium } = require('playwright')
const OUT = new URL('../web/public/', import.meta.url)

// 漢, Noto Sans JP Bold (SIL Open Font License), as BetterRTK's icon draws it (64-unit box).
const KAN =
  'M24.3 15.04H51.28V19.15H24.3ZM23.92 39.57H51.66V43.5H23.92ZM30.48 25.78V28.58H44.68V25.78ZM26.04 22.27H49.38V32.08H26.04ZM25.49 33.95H50.01V37.75H25.49ZM34.96 24.26H39.91V35.47Q39.91 37.37 39.55 39.27Q39.19 41.18 38.28 42.97Q37.37 44.77 35.74 46.4Q34.11 48.03 31.66 49.42Q29.21 50.82 25.74 51.87Q25.45 51.37 24.92 50.65Q24.39 49.93 23.8 49.21Q23.21 48.49 22.66 48.07Q25.91 47.26 28.13 46.16Q30.35 45.07 31.73 43.8Q33.1 42.53 33.8 41.15Q34.49 39.78 34.73 38.32Q34.96 36.86 34.96 35.42ZM40.54 41.01Q42.02 43.59 44.98 45.3Q47.94 47.01 52 47.69Q51.49 48.15 50.88 48.89Q50.27 49.63 49.76 50.41Q49.25 51.2 48.87 51.83Q44.43 50.73 41.3 48.26Q38.17 45.78 36.36 42.11ZM30.01 12.13H34.66V21.6H30.01ZM40.08 12.13H44.81V21.6H40.08ZM14.2 16.1 17.03 12.3Q18.26 12.76 19.67 13.46Q21.09 14.16 22.34 14.92Q23.59 15.68 24.39 16.4L21.43 20.58Q20.67 19.82 19.46 19.02Q18.26 18.22 16.86 17.41Q15.47 16.61 14.2 16.1ZM12 27.52 14.75 23.67Q16.02 24.14 17.41 24.77Q18.81 25.4 20.05 26.14Q21.3 26.88 22.11 27.56L19.19 31.79Q18.47 31.07 17.24 30.29Q16.02 29.51 14.64 28.79Q13.27 28.07 12 27.52ZM13.06 48.36Q14.03 46.71 15.21 44.49Q16.4 42.27 17.62 39.76Q18.85 37.24 19.86 34.75L23.88 37.79Q22.95 40.08 21.89 42.42Q20.84 44.77 19.78 47.03Q18.72 49.29 17.62 51.37Z'

/** A five-pointed star around (0,0): outer radius r, inner radius ri. */
function star(r, ri) {
  const pts = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 ? ri : r
    pts.push(`${(Math.cos(a) * rad).toFixed(1)},${(Math.sin(a) * rad).toFixed(1)}`)
  }
  return pts.join(' ')
}

/** The mark, drawn in a 512 box. */
function mark() {
  return `
  <g transform="translate(276 236) rotate(9)">
    <rect x="-128" y="-158" width="256" height="316" rx="30" fill="#000" opacity="0.35" transform="translate(6 10)"/>
    <rect x="-128" y="-158" width="256" height="316" rx="30" fill="#f6f2ea"/>
    <path d="${KAN}" fill="#12100e" transform="translate(-102 -122) scale(3.2)"/>
  </g>
  <g transform="translate(176 352) rotate(-8)">
    <polygon points="${star(118, 58)}" fill="#12100e" stroke="#12100e" stroke-width="44" stroke-linejoin="round"/>
    <polygon points="${star(104, 50)}" fill="url(#star)" stroke="url(#star)" stroke-width="30" stroke-linejoin="round"/>
    <polygon points="${star(70, 33)}" fill="#ffffff" opacity="0.18" transform="translate(-10 -12)"/>
  </g>`
}

const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#2b2723"/>
      <stop offset="1" stop-color="#12100e"/>
    </linearGradient>
    <linearGradient id="star" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#8fdcff"/>
      <stop offset="1" stop-color="#1e88e5"/>
    </linearGradient>
  </defs>`

/** square: full bleed; rounded: a tile with corners; maskable: the mark in the safe zone. */
function svg(kind) {
  const corner = kind === 'rounded' ? 112 : 0
  const scale = kind === 'maskable' ? 0.78 : 1
  const shift = (512 * (1 - scale)) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Anki's mark (card and star) with 漢 from Noto Sans JP Bold (SIL OFL), as BetterRTK's icon -->${DEFS}
  <rect width="512" height="512" rx="${corner}" fill="url(#bg)"/>
  <g transform="translate(${shift} ${shift}) scale(${scale})">${mark()}
  </g>
</svg>
`
}

writeFileSync(new URL('favicon.svg', OUT), svg('rounded'))

const browser = await chromium.launch()
const page = await browser.newPage()
async function png(kind, size, name) {
  await page.setViewportSize({ width: size, height: size })
  const body = svg(kind).replace('<svg ', `<svg width="${size}" height="${size}" `)
  await page.setContent(`<html><body style="margin:0;background:transparent">${body}</body></html>`)
  await page.locator('svg').screenshot({ path: new URL(name, OUT).pathname.replace(/^\/([A-Z]:)/, '$1'), omitBackground: true })
  console.log('wrote', name)
}
await png('rounded', 32, 'favicon-32.png')
await png('square', 180, 'apple-touch-icon.png')
await png('square', 192, 'icon-192.png')
await png('square', 512, 'icon-512.png')
await png('maskable', 512, 'icon-maskable-512.png')
await browser.close()
