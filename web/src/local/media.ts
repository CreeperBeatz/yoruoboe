/**
 * The collection's media, from the engine's file store, for what shows it: the card
 * frame (which is sandboxed, so its media goes in as data URLs), audio (blob URLs), and
 * Anki's own pages (served to them by the service worker, see sw.template.js).
 */

import { readFile } from '../engine/client'
import { MEDIA_DIR, ready } from './col'

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm', spx: 'audio/ogg',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  css: 'text/css', js: 'text/javascript', json: 'application/json', txt: 'text/plain', html: 'text/html',
}

export function mimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return TYPES[ext] ?? 'application/octet-stream'
}

/** A media file's bytes, or null if the collection doesn't have it. */
export async function mediaBytes(name: string): Promise<Uint8Array | null> {
  if (!name || name.includes('/') || name.includes('\\') || name === '..') return null
  await ready()
  return readFile(`${MEDIA_DIR}/${name}`)
}

/** A blob URL for a media file (the caller revokes it), or null. */
export async function mediaBlobUrl(name: string): Promise<string | null> {
  const data = await mediaBytes(name)
  return data ? URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType(name) })) : null
}

// Data URLs are kept for a while: the next card often shows the same images.
const dataUrls = new Map<string, string>()
const DATA_URL_CACHE_BYTES = 24 * 1024 * 1024
let cachedBytes = 0

function toDataUrl(data: Uint8Array, type: string): string {
  let s = ''
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(s)}`
}

async function dataUrl(name: string): Promise<string | null> {
  const hit = dataUrls.get(name)
  if (hit) {
    dataUrls.delete(name)
    dataUrls.set(name, hit)
    return hit
  }
  const data = await mediaBytes(name)
  if (!data) return null
  const url = toDataUrl(data, mimeType(name))
  dataUrls.set(name, url)
  cachedBytes += url.length
  for (const [k, v] of dataUrls) {
    if (cachedBytes <= DATA_URL_CACHE_BYTES) break
    dataUrls.delete(k)
    cachedBytes -= v.length
  }
  return url
}

/** Forget cached media (after a sync may have changed files). */
export function forgetMedia() {
  dataUrls.clear()
  cachedBytes = 0
}

const SRC_ATTR = /(\s(?:src|poster)\s*=\s*)(["'])([^"']+)\2/gi
const SRC_BARE = /(\s(?:src|poster)\s*=\s*)([^\s"'>]+)/gi
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi

function mediaName(ref: string): string | null {
  if (/^(data:|blob:|https?:|\/\/|#|\/)/i.test(ref)) return null
  try {
    return decodeURIComponent(ref.split(/[?#]/)[0])
  } catch {
    return null
  }
}

/** Put a card's media into its HTML as data URLs: the sandboxed frame can't load it otherwise. */
export async function inlineMedia(html: string): Promise<string> {
  const refs = new Set<string>()
  for (const m of html.matchAll(SRC_ATTR)) refs.add(m[3])
  for (const m of html.matchAll(SRC_BARE)) refs.add(m[2])
  for (const m of html.matchAll(CSS_URL)) refs.add(m[2])
  const urls = new Map<string, string>()
  await Promise.all(
    [...refs].map(async (ref) => {
      const name = mediaName(ref)
      if (!name) return
      const url = await dataUrl(name).catch(() => null)
      if (url) urls.set(ref, url)
    }),
  )
  if (!urls.size) return html
  return html
    .replace(SRC_ATTR, (all, pre, q, ref) => (urls.has(ref) ? `${pre}${q}${urls.get(ref)}${q}` : all))
    .replace(SRC_BARE, (all, pre, ref) => (urls.has(ref) ? `${pre}"${urls.get(ref)}"` : all))
    .replace(CSS_URL, (all, q, ref) => (urls.has(ref) ? `url(${q}${urls.get(ref)}${q})` : all))
}
