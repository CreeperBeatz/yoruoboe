/**
 * Notes and note types: a note's details, managing note types, their fields and card
 * templates (AnkiDroid's ManageNotetypes, ModelFieldEditor and CardTemplateEditor).
 * Port of server/routes/notetypes.py.
 */

import { StockNotetype_Kind, StockNotetype_OriginalStockKind } from '../../engine/generated/anki/notetypes_pb'
import {
  be,
  dbCommand,
  fromJsonBytes,
  getNote,
  notetypeLegacy,
  noteCardIds,
  toJsonBytes,
  updateNotetypeLegacy,
  type NotetypeDict,
} from '../col'
import { big, del, get, HttpError, num, post } from '../http'
import { finishRender, hidePlayButtons, prepare, stripTypeAnswer } from '../render'

const IO_KIND = StockNotetype_OriginalStockKind.IMAGE_OCCLUSION

const STOCK = [
  StockNotetype_Kind.BASIC,
  StockNotetype_Kind.BASIC_AND_REVERSED,
  StockNotetype_Kind.BASIC_OPTIONAL_REVERSED,
  StockNotetype_Kind.BASIC_TYPING,
  StockNotetype_Kind.CLOZE,
  StockNotetype_Kind.IMAGE_OCCLUSION,
]

async function stock(kind: StockNotetype_Kind): Promise<NotetypeDict> {
  return fromJsonBytes<NotetypeDict>((await be.getStockNotetypeLegacy({ kind })).json)
}

async function scalar(sql: string, args: unknown[]): Promise<number> {
  const rows = await dbCommand<unknown[][]>({ kind: 'query', sql, args, first_row_only: true })
  return Number(rows[0]?.[0] ?? 0)
}

async function names() {
  return (await be.getNotetypeNames({})).entries
}

/** models.ensure_name_unique */
async function ensureNameUnique(nt: NotetypeDict) {
  const existing = (await names()).find((e) => e.name === nt.name)
  if (existing && num(existing.id) !== Number(nt.id)) {
    nt.name += `-${Math.random().toString(16).slice(2, 7)}`
  }
}

// ---- notes ----------------------------------------------------------------------------------

get('/api/notes/:nid', async ({ params }) => {
  let note
  try {
    note = await getNote(Number(params.nid))
  } catch {
    throw new HttpError(404, 'No such note.')
  }
  return { id: num(note.id), notetypeId: num(note.notetypeId), cardIds: await noteCardIds(num(note.id)), tags: [...note.tags] }
})

/** The notes the Change Note Type page is for (it doesn't say). */
export let changeNotetypeNoteIds: number[] | null = null

post('/api/notes/change-notetype-start', async ({ body }) => {
  const nids: number[] = body.noteIds ?? []
  const mids = new Set<number>()
  for (const n of nids) mids.add(num((await getNote(n)).notetypeId))
  if (mids.size !== 1) throw new HttpError(400, 'Please select notes from only one note type.')
  changeNotetypeNoteIds = [...nids]
  return { notetypeId: [...mids][0] }
})

export function takeChangeNotetypeNoteIds(): number[] | null {
  const n = changeNotetypeNoteIds
  changeNotetypeNoteIds = null
  return n
}

// ---- note types -------------------------------------------------------------------------------

get('/api/notetypes', async () => {
  const out = []
  for (const n of (await be.getNotetypeNamesAndCounts({})).entries) {
    const nt = await notetypeLegacy(num(n.id))
    if (!nt) continue
    out.push({
      id: num(n.id),
      name: n.name,
      useCount: n.useCount,
      cloze: nt.type === 1,
      io: nt.originalStockKind === IO_KIND,
      fields: nt.flds.map((f) => f.name),
      templates: nt.tmpls.map((t) => t.name),
    })
  }
  return out
})

get('/api/notetypes/stock', async () => {
  const stockNames = []
  for (let i = 0; i < STOCK.length; i++) stockNames.push({ key: `stock:${i}`, name: `Add: ${(await stock(STOCK[i])).name}` })
  const clones = (await names()).map((n) => ({ key: `clone:${num(n.id)}`, name: `Clone: ${n.name}` }))
  return [...stockNames, ...clones]
})

post('/api/notetypes', async ({ body }) => {
  const [kind, ref] = String(body.key ?? '').split(':')
  let nt: NotetypeDict
  if (kind === 'stock') {
    nt = await stock(STOCK[Number(ref)])
  } else if (kind === 'clone') {
    const orig = await notetypeLegacy(Number(ref))
    if (!orig) throw new HttpError(404, 'No such note type.')
    nt = structuredClone(orig)
    nt.name = `${nt.name} copy`
    nt.originalId = null
  } else {
    throw new HttpError(400, 'unknown kind')
  }
  nt.name = String(body.name ?? '').trim() || nt.name
  nt.id = 0
  await ensureNameUnique(nt)
  const out = await be.addNotetypeLegacy({ json: toJsonBytes(nt) })
  return { id: num(out.id) }
})

/** The image occlusion note type, created if the collection has none yet. */
get('/api/notetypes/image-occlusion', async () => {
  const find = async () => {
    for (const n of await names()) {
      const nt = await notetypeLegacy(num(n.id))
      if (nt?.originalStockKind === IO_KIND) return num(n.id)
    }
    return null
  }
  let id = await find()
  if (id === null) {
    await be.addImageOcclusionNotetype({})
    id = await find()
  }
  if (id === null) throw new HttpError(500, 'Could not create the image occlusion note type.')
  return { id }
})

post('/api/notetypes/:ntid/rename', async ({ params, body }) => {
  const nt = await notetypeLegacy(Number(params.ntid))
  if (!nt) throw new HttpError(404, 'No such note type.')
  const copy = structuredClone(nt)
  copy.name = String(body.name ?? '').trim()
  await ensureNameUnique(copy)
  await updateNotetypeLegacy(copy)
  return { ok: true }
})

del('/api/notetypes/:ntid', async ({ params }) => {
  if ((await names()).length <= 1) throw new HttpError(400, "The last note type can't be deleted.")
  await be.removeNotetype({ ntid: big(params.ntid) })
  return { ok: true }
})

/** The whole note type, as the legacy dict desktop's dialogs edit. */
get('/api/notetypes/:ntid', async ({ params }) => {
  const ntid = Number(params.ntid)
  const nt = await notetypeLegacy(ntid)
  if (!nt) throw new HttpError(404, 'No such note type.')
  const templateUseCounts = []
  for (let i = 0; i < nt.tmpls.length; i++) {
    templateUseCounts.push(
      await scalar('select count() from cards, notes where cards.nid = notes.id and notes.mid = ? and cards.ord = ?', [ntid, i]),
    )
  }
  return {
    notetype: nt,
    useCount: await scalar('select count() from notes where mid = ?', [ntid]),
    templateUseCounts,
  }
})

/**
 * Save an edited note type: fields, templates, styling. Field and template changes
 * alter the schema; the next sync then has to be a full one, as on desktop and
 * AnkiDroid, which ask first (the app does).
 */
post('/api/notetypes/:ntid/save', async ({ params, body }) => {
  const nt = body.notetype as NotetypeDict
  if (Number(nt?.id) !== Number(params.ntid)) throw new HttpError(400, 'id mismatch')
  try {
    await ensureNameUnique(nt)
    await updateNotetypeLegacy(nt)
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err))
  }
  return { ok: true }
})

get('/api/notetypes/:ntid/new-field', async ({ query }) => {
  const field = (await stock(StockNotetype_Kind.BASIC)).flds[0]
  return { ...field, name: query.get('name') ?? '', ord: null }
})

get('/api/notetypes/:ntid/new-template', async ({ query }) => {
  const t = (await stock(StockNotetype_Kind.BASIC)).tmpls[0]
  return { ...t, name: query.get('name') ?? '', qfmt: '', afmt: '', ord: null }
})

/** Whether a schema change would force a one-way sync (it won't if one is pending). */
get('/api/schema-change-needs-full-sync', async () => {
  // col.schema_changed(): the schema was modified since the last sync
  const scm = await scalar('select scm from col', [])
  const ls = await scalar('select ls from col', [])
  return { needed: !(scm > ls) }
})

// ---- card template preview ----------------------------------------------------------------------

/** Render an unsaved note type's template: with a note, or with the field names. */
post('/api/notetypes/preview', async ({ body }) => {
  const nt = body.notetype as NotetypeDict
  const ord = Number(body.ord ?? 0)
  let note = body.noteId ? await getNote(Number(body.noteId)).catch(() => null) : null
  if (note && num(note.notetypeId) !== Number(nt.id)) note = null
  if (!note) {
    note = await be.newNote({ ntid: big(nt.id) })
    note.fields = nt.flds.map((f, i) => (nt.type === 1 && i === 0 ? `{{c1::${f.name}}}` : `(${f.name})`))
  }
  const isCloze = nt.type === 1
  const template = { ...nt.tmpls[isCloze ? 0 : ord], ord }
  const out = await be.renderUncommittedCardLegacy({
    note,
    cardOrd: ord,
    template: toJsonBytes(template),
    fillEmpty: body.fillEmpty ?? true,
    partialRender: true,
  })
  // the card layout's styling isn't saved yet
  out.css = nt.css
  const r = await finishRender(out)
  const hide = await hidePlayButtons()
  return {
    question: stripTypeAnswer(await prepare(r.question, hide)),
    answer: stripTypeAnswer(await prepare(r.answer, hide)),
    bodyClass: `card card${ord + 1}`,
    questionAv: r.questionAv,
    answerAv: r.answerAv,
  }
})
