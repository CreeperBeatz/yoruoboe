// The install guide's screenshots (web/src/install/InstallGuide.tsx, and the README):
//  - Safari, step1-5: BetterRTK's screenshots of the same screens
//    (../BetterRTK/web/src/install, its pictures of 2026-11-04), with its name, icon,
//    address and tab bar covered, and this app's name and icon put in their place;
//  - Chrome, chrome1-4: this app's own, taken on an iPhone (docs/install/source), cut to
//    the part that matters and ringed where to tap, as BetterRTK's are.
// The address is a placeholder: each copy of the app has its own.
//
//   node scripts/make_install_shots.mjs
//
// Writes web/src/install/step1-5.webp and chrome1-4.webp, 600 pixels wide. When the
// pictures it starts from change, the areas below need measuring again.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const require = createRequire(new URL('../web/package.json', import.meta.url))
const { chromium } = require('playwright')
const SRC = new URL('../../BetterRTK/web/src/install/', import.meta.url)
const OUT = new URL('../web/src/install/', import.meta.url)
const CHROME = new URL('../docs/install/source/', import.meta.url)
mkdirSync(OUT, { recursive: true })

const ICON = `data:image/png;base64,${readFileSync(new URL('../web/public/icon-512.png', import.meta.url)).toString('base64')}`
const HOST = 'your-app.pages.dev'
const NAME = 'YoruOboe'
const RING = '#d4442e'

// Per screenshot: areas to cover (filled with the colour at `sample`), then what to draw.
const EDITS = {
  step1: [
    { cover: [0, 0, 600, 112], sample: [5, 60] },
    { cover: [205, 145, 200, 32], sample: [300, 180] },
    { text: HOST, at: [222, 161], size: 19, color: '#ffffff', weight: 500, maxWidth: 180 },
  ],
  step2: [],
  step3: [
    { cover: [34, 32, 114, 114], sample: [30, 90] },
    { cover: [165, 38, 300, 32], sample: [520, 55] },
    { cover: [165, 72, 300, 30], sample: [500, 85] },
    { icon: [40, 38, 102, 102], radius: 23 },
    { text: NAME, at: [169, 54], size: 23, color: '#ffffff', weight: 600 },
    { text: HOST, at: [169, 87], size: 21, color: '#8f8f8f' },
  ],
  step4: [],
  step5: [
    { cover: [20, 151, 97, 99], sample: [15, 200] },
    { cover: [136, 143, 140, 38], sample: [300, 150] },
    { cover: [136, 222, 380, 32], sample: [560, 240] },
    { icon: [24, 155, 88, 88], radius: 20 },
    { text: NAME, at: [140, 163], size: 23, color: '#ffffff' },
    { text: `https://${HOST}/`, at: [140, 238], size: 22, color: '#7c7c7c' },
  ],
}

// Chrome's: the part of the 1179-pixel-wide screenshot to keep ([x, y, w, h]) and the
// rings, in the screenshot's pixels; then, in the cut's pixels, the name and address
// they were taken with, drawn over (before the rings).
const CHROME_CROPS = {
  chrome1: {
    crop: [0, 150, 1179, 300],
    rings: [{ circle: [944, 246, 56] }],
    edits: [
      { cover: [125, 30, 337, 36], sample: [110, 45] },
      { text: HOST, at: [130, 49], size: 22, color: '#ffffff' },
    ],
  },
  chrome2: {
    crop: [16, 278, 1147, 1138],
    rings: [{ rect: [880, 1004, 200, 330, 26] }],
    edits: [
      { cover: [160, 56, 120, 38], sample: [300, 75] },
      { cover: [165, 92, 320, 32], sample: [540, 110] },
      { text: NAME, at: [165, 75], size: 23, color: '#ffffff', weight: 600 },
      { text: HOST, at: [169, 107], size: 22, color: '#9a9a9a' },
    ],
  },
  chrome3: { crop: [0, 1600, 1179, 956], rings: [{ rect: [50, 2128, 1082, 148, 28] }] },
  chrome4: {
    crop: [0, 210, 1179, 952],
    rings: [
      { rect: [932, 250, 206, 140, 36] },
      { rect: [936, 892, 202, 106, 30] },
    ],
    edits: [
      { cover: [132, 146, 120, 44], sample: [300, 168] },
      { cover: [136, 226, 428, 32], sample: [300, 215] },
      { text: NAME, at: [138, 168], size: 23, color: '#ffffff' },
      { text: `https://${HOST}/`, at: [140, 242], size: 22, color: '#7c7c7c' },
    ],
  },
}

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, edits] of Object.entries(EDITS)) {
  const src = `data:image/webp;base64,${readFileSync(new URL(`${name}.webp`, SRC)).toString('base64')}`
  const png = await page.evaluate(
    async ({ src, edits, icon }) => {
      const load = (url) =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = url
        })
      const img = await load(src)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const iconImg = await load(icon)
      for (const e of edits) {
        if (e.cover) {
          const [r, g, b] = ctx.getImageData(e.sample[0], e.sample[1], 1, 1).data
          ctx.fillStyle = `rgb(${r},${g},${b})`
          ctx.fillRect(...e.cover)
        } else if (e.icon) {
          const [x, y, w, h] = e.icon
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(x, y, w, h, e.radius)
          ctx.clip()
          ctx.drawImage(iconImg, x, y, w, h)
          ctx.restore()
        } else if (e.text) {
          ctx.fillStyle = e.color
          ctx.font = `${e.weight ?? 400} ${e.size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`
          ctx.textBaseline = 'middle'
          ctx.fillText(e.text, e.at[0], e.at[1], e.maxWidth)
        }
      }
      return canvas.toDataURL('image/webp', 0.8)
    },
    { src, edits, icon: ICON },
  )
  write(name, png)
}
for (const [name, { crop, rings, edits = [] }] of Object.entries(CHROME_CROPS)) {
  const src = `data:image/png;base64,${readFileSync(new URL(`${name}.png`, CHROME)).toString('base64')}`
  const webp = await page.evaluate(
    async ({ src, crop, rings, edits, color }) => {
      const img = await new Promise((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = src
      })
      const [cx, cy, cw, ch] = crop
      const scale = 600 / cw
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = Math.round(ch * scale)
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height)
      for (const e of edits) {
        if (e.cover) {
          const [r, g, b] = ctx.getImageData(e.sample[0], e.sample[1], 1, 1).data
          ctx.fillStyle = `rgb(${r},${g},${b})`
          ctx.fillRect(...e.cover)
        } else if (e.text) {
          ctx.fillStyle = e.color
          ctx.font = `${e.weight ?? 400} ${e.size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`
          ctx.textBaseline = 'middle'
          ctx.fillText(e.text, e.at[0], e.at[1])
        }
      }
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      for (const r of rings) {
        ctx.beginPath()
        if (r.circle) {
          const [x, y, radius] = r.circle
          ctx.arc((x - cx) * scale, (y - cy) * scale, radius * scale, 0, 2 * Math.PI)
        } else {
          const [x, y, w, h, radius] = r.rect
          ctx.roundRect((x - cx) * scale, (y - cy) * scale, w * scale, h * scale, radius * scale)
        }
        ctx.stroke()
      }
      return canvas.toDataURL('image/webp', 0.8)
    },
    { src, crop, rings, edits, color: RING },
  )
  write(name, webp)
}
await browser.close()

function write(name, dataUrl) {
  writeFileSync(new URL(`${name}.webp`, OUT), Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('wrote', name)
}
