/**
 * Plays a card's sounds and text-to-speech, as desktop's av_player does: in order,
 * stopping whatever played before. Sounds come from the collection's media; TTS uses
 * the browser's speech synthesis.
 *
 * iOS only lets a page start audio from a user gesture until one has played, so the
 * first tap in the app unlocks the shared <audio> element (see unlockAudio).
 */

import { mediaBlobUrl } from './local/media'

export type AvTag =
  | { kind: 'sound'; filename: string }
  | { kind: 'tts'; text: string; lang: string; voices: string[]; speed: number; otherArgs: string[] }

let audio: HTMLAudioElement | null = null
let queue: AvTag[] = []
let playing = false
let generation = 0
let onIdle: (() => void) | null = null

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
  }
  return audio
}

// 0.1 s of silence, 8 kHz mono 8-bit: enough for iOS to count audio as started.
const SILENT_WAV = (() => {
  const samples = 800
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const text = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44)
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return `data:audio/wav;base64,${btoa(s)}`
})()

let unlocked = false
/** Called from the first user gesture: iOS then allows audio started later by code. */
export function unlockAudio() {
  if (unlocked) return
  unlocked = true
  const a = element()
  a.src = SILENT_WAV
  a.play().catch(() => {})
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance('')
    u.volume = 0
    speechSynthesis.speak(u)
  }
}

export function stopAudio() {
  generation++
  queue = []
  playing = false
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}

/** Play these tags in order, replacing anything playing. Resolves when all have played. */
export function playAv(tags: AvTag[]): Promise<void> {
  stopAudio()
  if (!tags.length) return Promise.resolve()
  queue = [...tags]
  const gen = generation
  return new Promise((resolve) => {
    onIdle = resolve
    void next(gen)
  })
}

/** Queue more tags after what is playing (desktop: av_player.extend). */
export function isPlaying(): boolean {
  return playing
}

async function next(gen: number) {
  if (gen !== generation) return
  const tag = queue.shift()
  if (!tag) {
    playing = false
    const done = onIdle
    onIdle = null
    done?.()
    return
  }
  playing = true
  try {
    if (tag.kind === 'sound') await playSound(tag.filename)
    else await speak(tag)
  } catch {
    // a missing file or a refused autoplay: go on with the rest
  }
  void next(gen)
}

async function playSound(filename: string): Promise<void> {
  // From the collection on the device, as a blob: iOS asks audio in byte ranges,
  // which a blob answers.
  const blob = await mediaBlobUrl(filename).catch(() => null)
  if (!blob) return
  return new Promise((resolve) => {
    const a = element()
    const done = () => {
      a.onended = a.onerror = null
      URL.revokeObjectURL(blob)
      resolve()
    }
    a.onended = done
    a.onerror = done
    a.src = blob
    a.play().catch(done)
  })
}

function pickVoice(lang: string, wanted: string[]): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices()
  for (const name of wanted) {
    const v = voices.find((v) => v.name === name || v.voiceURI === name)
    if (v) return v
  }
  const norm = lang.replace('_', '-').toLowerCase()
  return (
    voices.find((v) => v.lang.toLowerCase() === norm) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(norm.split('-')[0]))
  )
}

function speak(tag: Extract<AvTag, { kind: 'tts' }>): Promise<void> {
  if (!('speechSynthesis' in window)) return Promise.resolve()
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(tag.text)
    u.lang = tag.lang.replace('_', '-')
    const voice = pickVoice(tag.lang, tag.voices)
    if (voice) u.voice = voice
    if (tag.speed) u.rate = tag.speed
    u.onend = () => resolve()
    u.onerror = () => resolve()
    speechSynthesis.speak(u)
  })
}

/** Speak arbitrary text (AnkiDroid's TTS for cards without audio). */
export function speakText(text: string, lang: string): Promise<void> {
  return speak({ kind: 'tts', text, lang, voices: [], speed: 1, otherArgs: [] })
}
