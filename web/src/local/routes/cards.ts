/** What can be done to cards and notes, from the study screen and the browser. Port of server/routes/cards.py. */

import { BuryOrSuspendCardsRequest_Mode as Mode, ScheduleCardsAsNewRequest_Context as Context } from '../../engine/generated/anki/scheduler_pb'
import { be, configString, ConfigKey_String, getCard, getConfig, getNote, hasTag, noteCardIds, setConfig, undoInfo, userFlag } from '../col'
import { big, bigs, get, HttpError, num, post } from '../http'
import { bodyClass, hidePlayButtons, prepare, renderCard, stripTypeAnswer } from '../render'
import { resetReview } from './review'

async function changed(resetsReview = false, extra: Record<string, unknown> = {}) {
  // The card the study screen had may be gone from the queue: it fetches anew.
  if (resetsReview) resetReview()
  return { undo: await undoInfo(), ...extra }
}

const ids = (xs: unknown) => bigs((xs as number[]) ?? [])

// ---- flags, marks ---------------------------------------------------------------------------

post('/api/cards/flag', async ({ body }) => {
  const flag = Number(body.flag)
  if (!(flag >= 0 && flag <= 7)) throw new HttpError(400, 'flag must be 0-7')
  await be.setFlag({ cardIds: ids(body.cardIds), flag })
  return changed()
})

post('/api/notes/mark', async ({ body }) => {
  let marked: boolean | null = body.marked ?? null
  const noteIds: number[] = body.noteIds ?? []
  if (marked === null) {
    const all = await Promise.all(noteIds.map(async (n) => hasTag((await getNote(n)).tags, 'marked')))
    marked = !all.every(Boolean)
  }
  if (marked) await be.addNoteTags({ noteIds: bigs(noteIds), tags: 'marked' })
  else await be.removeNoteTags({ noteIds: bigs(noteIds), tags: 'marked' })
  return changed(false, { marked })
})

const FLAG_DEFAULTS = ['Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple']

/** The seven flags with their user-chosen names (desktop: Browser > Flag > Rename). */
get('/api/flags', async () => {
  const custom = (await getConfig<Record<string, string>>('flagLabels', {})) ?? {}
  return FLAG_DEFAULTS.map((d, i) => ({ flag: i + 1, name: custom[String(i + 1)] || d }))
})

post('/api/flags/rename', async ({ body }) => {
  const labels = { ...((await getConfig<Record<string, string>>('flagLabels', {})) ?? {}) }
  const name = String(body.name ?? '').trim()
  if (name) labels[String(body.flag)] = name
  else delete labels[String(body.flag)]
  await setConfig('flagLabels', labels)
  return { ok: true }
})

// ---- bury, suspend, delete -------------------------------------------------------------------

post('/api/cards/bury', async ({ body }) => {
  const out = await be.buryOrSuspendCards({ cardIds: ids(body.cardIds), noteIds: [], mode: Mode.BURY_USER })
  return changed(true, { count: out.count })
})

post('/api/notes/bury', async ({ body }) => {
  const out = await be.buryOrSuspendCards({ cardIds: [], noteIds: ids(body.noteIds), mode: Mode.BURY_USER })
  return changed(true, { count: out.count })
})

post('/api/cards/suspend', async ({ body }) => {
  const cardIds: number[] = body.cardIds ?? []
  let suspend: boolean | null = body.suspend ?? null
  if (suspend === null) {
    const queues = await Promise.all(cardIds.map(async (c) => (await getCard(c)).queue))
    suspend = !queues.every((q) => q === -1)
  }
  let count: number
  if (suspend) {
    count = (await be.buryOrSuspendCards({ cardIds: bigs(cardIds), noteIds: [], mode: Mode.SUSPEND })).count
  } else {
    await be.restoreBuriedAndSuspendedCards({ cids: bigs(cardIds) })
    count = cardIds.length
  }
  return changed(true, { suspended: suspend, count })
})

post('/api/notes/suspend', async ({ body }) => {
  const out = await be.buryOrSuspendCards({ cardIds: [], noteIds: ids(body.noteIds), mode: Mode.SUSPEND })
  return changed(true, { count: out.count })
})

post('/api/cards/unbury', async ({ body }) => {
  await be.restoreBuriedAndSuspendedCards({ cids: ids(body.cardIds) })
  return changed()
})

post('/api/notes/delete', async ({ body }) => {
  const out = await be.removeNotes({ noteIds: ids(body.noteIds), cardIds: [] })
  return changed(true, { count: out.count })
})

post('/api/cards/delete-notes', async ({ body }) => {
  const nids = new Set<number>()
  for (const c of (body.cardIds as number[]) ?? []) nids.add(num((await getCard(c)).noteId))
  const out = await be.removeNotes({ noteIds: bigs([...nids]), cardIds: [] })
  return changed(true, { count: out.count })
})

// ---- scheduling ---------------------------------------------------------------------------------

post('/api/cards/set-due', async ({ body }) => {
  try {
    await be.setDueDate({ cardIds: ids(body.cardIds), days: String(body.days), configKey: { key: ConfigKey_String.SET_DUE_REVIEWER } })
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err))
  }
  return changed(true)
})

get('/api/cards/set-due-default', async () => ({ days: await configString(ConfigKey_String.SET_DUE_REVIEWER) }))

post('/api/cards/forget', async ({ body }) => {
  await be.scheduleCardsAsNew({
    cardIds: ids(body.cardIds),
    log: true,
    restorePosition: body.restorePosition ?? true,
    resetCounts: body.resetCounts ?? false,
    context: Context.REVIEWER,
  })
  return changed(true)
})

get('/api/cards/forget-defaults', async () => {
  const d = await be.scheduleCardsAsNewDefaults({ context: Context.BROWSER })
  return { restorePosition: d.restorePosition, resetCounts: d.resetCounts }
})

post('/api/cards/reposition', async ({ body }) => {
  const out = await be.sortCards({
    cardIds: ids(body.cardIds),
    startingFrom: Number(body.start ?? 0),
    stepSize: Number(body.step ?? 1),
    randomize: Boolean(body.randomize),
    shiftExisting: Boolean(body.shift),
  })
  return changed(true, { count: out.count })
})

get('/api/cards/reposition-defaults', async () => {
  const d = await be.repositionDefaults({})
  return { randomize: d.random, shift: d.shift }
})

post('/api/cards/set-deck', async ({ body }) => {
  await be.setDeck({ cardIds: ids(body.cardIds), deckId: big(body.deckId) })
  return changed(true)
})

// ---- tags -----------------------------------------------------------------------------------------

get('/api/tags', async () => {
  const tags = (await be.allTags({})).vals
  return [...tags].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
})

post('/api/notes/tags', async ({ body }) => {
  if (String(body.add ?? '').trim()) await be.addNoteTags({ noteIds: ids(body.noteIds), tags: body.add })
  if (String(body.remove ?? '').trim()) await be.removeNoteTags({ noteIds: ids(body.noteIds), tags: body.remove })
  return changed()
})

post('/api/notes/set-tags', async ({ body }) => {
  const note = await getNote(Number(body.noteId))
  note.tags = ((body.tags as string[]) ?? []).filter((t) => t.trim())
  await be.updateNotes({ notes: [note], skipUndoEntry: false })
  return changed()
})

get('/api/notes/:nid/tags', async ({ params }) => [...(await getNote(Number(params.nid))).tags])

post('/api/tags/clear-unused', async () => ({ count: (await be.clearUnusedTags({})).count }))

post('/api/tags/rename', async ({ body }) => ({
  count: (await be.renameTags({ currentPrefix: String(body.old), newPrefix: String(body.new) })).count,
}))

post('/api/tags/remove', async ({ body }) => ({ count: (await be.removeTags({ val: String(body.tags) })).count }))

// ---- find and replace -----------------------------------------------------------------------------

post('/api/notes/find-replace', async ({ body }) => {
  let out
  try {
    if (body.field === 'tags') {
      out = await be.findAndReplaceTag({
        noteIds: ids(body.noteIds),
        search: body.search,
        replacement: body.replacement,
        regex: Boolean(body.regex),
        matchCase: Boolean(body.matchCase),
      })
    } else {
      out = await be.findAndReplace({
        nids: ids(body.noteIds),
        search: body.search,
        replacement: body.replacement,
        regex: Boolean(body.regex),
        matchCase: Boolean(body.matchCase),
        fieldName: body.field ?? '',
      })
    }
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err))
  }
  return changed(false, { count: out.count })
})

post('/api/notes/field-names', async ({ body }) => [...(await be.fieldNamesForNotes({ nids: ids(body.noteIds) })).fields])

// ---- one card -------------------------------------------------------------------------------------

get('/api/cards/:cid', async ({ params }) => {
  const card = await getCard(Number(params.cid))
  const note = await getNote(num(card.noteId))
  return {
    id: num(card.id),
    noteId: num(card.noteId),
    deckId: num(card.deckId),
    flag: userFlag(card),
    marked: hasTag(note.tags, 'marked'),
    suspended: card.queue === -1,
    buried: card.queue === -2 || card.queue === -3,
    siblings: (await noteCardIds(num(card.noteId))).length,
    notetypeId: num(note.notetypeId),
  }
})

/** The card's scheduling fields, for AnkiDroid's JS API (ankiGetCardReps etc.). */
get('/api/cards/:cid/raw', async ({ params }) => {
  const c = await getCard(Number(params.cid))
  return {
    reps: c.reps,
    ivl: c.interval,
    factor: c.easeFactor,
    mod: num(c.mtimeSecs),
    type: c.ctype,
    did: num(c.deckId),
    left: c.remainingSteps,
    odid: num(c.originalDeckId),
    odue: c.originalDue,
    queue: c.queue,
    lapses: c.lapses,
    due: c.due,
    nid: num(c.noteId),
    id: num(c.id),
  }
})

/** Both sides of a card, as the previewer shows them. */
get('/api/cards/:cid/render', async ({ params, query }) => {
  const card = await getCard(Number(params.cid))
  const browser = query.get('browser') === 'true'
  const hide = await hidePlayButtons()
  const r = await renderCard(num(card.id), browser)
  const note = await getNote(num(card.noteId))
  return {
    id: num(card.id),
    noteId: num(card.noteId),
    question: stripTypeAnswer(await prepare(r.question, hide)),
    answer: stripTypeAnswer(await prepare(r.answer, hide)),
    questionAv: r.questionAv,
    answerAv: r.answerAv,
    bodyClass: bodyClass(card),
    flag: userFlag(card),
    marked: hasTag(note.tags, 'marked'),
  }
})
