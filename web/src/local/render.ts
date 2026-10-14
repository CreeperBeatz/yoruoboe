/**
 * Card rendering as desktop's reviewer does it (pylib's TemplateRenderContext, then
 * aqt/reviewer.py and aqt/sound.py): the engine renders the templates; what is left is
 * putting the front side into {{FrontSide}}, the sound and TTS list, play buttons, and
 * the type-in answer box and its comparison.
 */

import type { Card } from '../engine/generated/anki/cards_pb'
import type { AVTag, RenderCardResponse, RenderedTemplateNode } from '../engine/generated/anki/card_rendering_pb'
import { be, configBool, ConfigKey_Bool, currentDeckOf, deckConfigForDeck, getNote, notetypeLegacy } from './col'
import { big } from './http'

export type AvTag =
  | { kind: 'sound'; filename: string }
  | { kind: 'tts'; text: string; lang: string; voices: string[]; speed: number; otherArgs: string[] }

export interface Rendered {
  /** With the note type's CSS, as card.question() gives it. */
  question: string
  answer: string
  questionAv: AvTag[]
  answerAv: AvTag[]
}

export const TYPE_ANS = /\[\[type:(.+?)\]\]/
const TYPE_ANS_ALL = /\[\[type:(.+?)\]\]/g
const AV_REF = /\[anki:(play:(.):(\d+))\]/g

const PLAY_BUTTON = (ref: string) => `<a class="replay-button soundLink" href=# onclick="pycmd('${ref}'); return false;" draggable="false">
    <svg class="playImage" viewBox="0 0 64 64" version="1.1">
        <circle cx="32" cy="32" r="29" />
        <path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z" />
    </svg>
</a>`

function avTags(tags: AVTag[]): AvTag[] {
  return tags.map((t) =>
    t.value.case === 'soundOrVideo'
      ? { kind: 'sound', filename: t.value.value.split(/[\\/]/).pop() ?? t.value.value }
      : {
          kind: 'tts',
          text: t.value.value?.fieldText ?? '',
          lang: t.value.value?.lang ?? '',
          voices: [...(t.value.value?.voices ?? [])],
          speed: t.value.value?.speed ?? 1,
          otherArgs: [...(t.value.value?.otherArgs ?? [])],
        },
  )
}

/** apply_custom_filters without add-ons: join the nodes, with the front side in {{FrontSide}}. */
function joinNodes(nodes: RenderedTemplateNode[], frontSide: string | null): string {
  let out = ''
  for (const n of nodes) {
    if (n.value.case === 'text') out += n.value.value
    else if (n.value.case === 'replacement') {
      const r = n.value.value
      out += r.fieldName === 'FrontSide' && frontSide !== null ? frontSide : r.currentText
    }
  }
  return out
}

export async function finishRender(out: RenderCardResponse): Promise<Rendered> {
  const q = await be.extractAvTags({ text: joinNodes(out.questionNodes, null), questionSide: true })
  const a = await be.extractAvTags({ text: joinNodes(out.answerNodes, q.text), questionSide: false })
  return {
    question: `<style>${out.css}</style>${q.text}`,
    answer: `<style>${out.css}</style>${a.text}`,
    questionAv: avTags(q.avTags),
    answerAv: avTags(a.avTags),
  }
}

/** card.render_output(): both sides of a card in the collection. */
export async function renderCard(cardId: number, browser = false): Promise<Rendered> {
  return finishRender(await be.renderExistingCard({ cardId: big(cardId), browser, partialRender: true }))
}

/** aqt.main.prepare_card_text_for_display: escape media names, add play buttons. */
export async function prepare(text: string, hidePlayButtons: boolean): Promise<string> {
  const escaped = (await be.encodeIriPaths({ val: text })).val
  if (hidePlayButtons) return escaped.replace(AV_REF, '')
  return escaped.replace(AV_REF, (_m, ref) => PLAY_BUTTON(ref))
}

export const hidePlayButtons = () => configBool(ConfigKey_Bool.HIDE_AUDIO_PLAY_BUTTONS)

export const stripTypeAnswer = (html: string) => html.replace(TYPE_ANS_ALL, '')

export const bodyClass = (card: Card) => `card card${card.templateIdx + 1}`

// ---- type in the answer ---------------------------------------------------------------------

export interface TypeAnswer {
  correct: string | null
  font: string
  size: number
  combining: boolean
  found: boolean
}

export async function typeAnswerQuestion(card: Card, html: string): Promise<[string, TypeAnswer]> {
  const ta: TypeAnswer = { correct: null, font: 'Arial', size: 20, combining: true, found: false }
  const m = TYPE_ANS.exec(html)
  if (!m) return [html, ta]
  ta.found = true
  let fld = m[1]
  let clozeIdx: number | null = null
  if (fld.startsWith('cloze:')) {
    clozeIdx = card.templateIdx + 1
    fld = fld.split(':')[1]
  }
  if (fld.startsWith('nc:')) {
    ta.combining = false
    fld = fld.split(':')[1]
  }
  const note = await getNote(Number(card.noteId))
  const nt = await notetypeLegacy(Number(note.notetypeId))
  const fields = [...(nt?.flds ?? [])].sort((a, b) => a.ord - b.ord)
  const idx = fields.findIndex((f) => f.name === fld)
  if (idx >= 0) {
    ta.correct = note.fields[idx] ?? ''
    if (clozeIdx) ta.correct = (await be.extractClozeForTyping({ text: ta.correct, ordinal: clozeIdx })).val || null
    ta.font = fields[idx].font
    ta.size = fields[idx].size
  }
  if (!ta.correct) {
    if (ta.correct === null) {
      const warn = clozeIdx ? 'Please run Tools>Empty Cards' : `Type answer: unknown field ${fld}`
      return [html.replace(TYPE_ANS_ALL, () => warn), ta]
    }
    return [html.replace(TYPE_ANS_ALL, ''), ta]
  }
  const box = `\n<center>\n<input type=text id=typeans onkeypress="_typeAnsPress();"\n   style="font-family: '${ta.font}'; font-size: ${ta.size}px;">\n</center>\n`
  return [html.replace(TYPE_ANS_ALL, () => box), ta]
}

export async function typeAnswerAnswer(html: string, ta: TypeAnswer, typed: string): Promise<string> {
  if (!ta.correct) return html.replace(TYPE_ANS_ALL, '')
  const orig = html
  const stripped = html.replaceAll('<hr id=answer>', '')
  const hadHr = stripped.length !== html.length
  const output = (await be.compareAnswer({ expected: ta.correct, provided: typed, combining: ta.combining })).val
  if (hadHr && !TYPE_ANS.test(stripped)) return orig
  const s = `\n<div style="font-family: '${ta.font}'; font-size: ${ta.size}px">${output}</div>`
  return stripped.replace(TYPE_ANS_ALL, () => (hadHr ? `<hr id=answer>${s}` : s))
}

// ---- the deck's options the study screen needs ----------------------------------------------

export async function deckConfForCard(card: Card) {
  const conf = await deckConfigForDeck(currentDeckOf(card))
  return {
    autoplay: Boolean(conf.autoplay ?? true),
    replayQuestion: Boolean(conf.replayq ?? true),
    showTimer: Boolean(conf.timer ?? 0),
    maxTakenSecs: Number(conf.maxTaken ?? 60),
    stopTimerOnAnswer: Boolean(conf.stopTimerOnAnswer ?? true),
    secondsToShowQuestion: Number(conf.secondsToShowQuestion || 0),
    secondsToShowAnswer: Number(conf.secondsToShowAnswer || 0),
    questionAction: Number(conf.questionAction || 0),
    answerAction: Number(conf.answerAction || 0),
    waitForAudio: Boolean(conf.waitForAudio ?? true),
  }
}
