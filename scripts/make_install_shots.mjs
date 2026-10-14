// The README's iPhone install steps: BetterRTK's screenshots of the same Safari screens
// (../BetterRTK/web/src/install), with its name, icon, address and tab bar covered and
// this app's put in their place.
//
//   node scripts/make_install_shots.mjs
//
// Writes docs/install/step1-5.png.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'

const require = createRequire(new URL('../web/package.json', import.meta.url))
const { chromium } = require('playwright')
const SRC = new URL('../../BetterRTK/web/src/install/', import.meta.url)
const OUT = new URL('../docs/install/', import.meta.url)
mkdirSync(OUT, { recursive: true })

const ICON = `data:image/png;base64,${readFileSync(new URL('../web/public/icon-512.png', import.meta.url)).toString('base64')}`
const HOST = 'anki.betterkanjidictionary.org'

// Per screenshot: areas to cover (filled with the colour at `sample`), then what to draw.
const EDITS = {
  step1: [
    { cover: [0, 0, 600, 112], sample: [6, 60] },
    { cover: [196, 148, 206, 46], sample: [300, 146] },
    { text: HOST, at: [200, 180], size: 19, color: '#ffffff', maxWidth: 200 },
  ],
  step2: [],
  step3: [
    { cover: [46, 20, 520, 80], sample: [30, 140] },
    { icon: [50, 24, 100, 100], radius: 22 },
    { text: 'Anki', at: [172, 52], size: 23, color: '#ffffff', weight: 600 },
    { text: HOST, at: [172, 82], size: 19, color: '#9a9a9a' },
  ],
  step4: [],
  step5: [
    { cover: [18, 162, 100, 102], sample: [10, 215] },
    { cover: [130, 158, 410, 48], sample: [530, 182] },
    { cover: [130, 232, 400, 42], sample: [560, 252] },
    { icon: [24, 170, 88, 88], radius: 20 },
    { text: 'Anki', at: [138, 185], size: 22, color: '#ffffff' },
    { text: `https://${HOST}/`, at: [138, 257], size: 21, color: '#8a8a8a', maxWidth: 400 },
  ],
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
      return canvas.toDataURL('image/png')
    },
    { src, edits, icon: ICON },
  )
  const out = new URL(`${name}.png`, OUT)
  await import('node:fs').then((fs) => fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64')))
  console.log('wrote', name)
}
await browser.close()
