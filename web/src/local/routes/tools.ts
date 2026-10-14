/**
 * Collection-wide tools: undo/redo, the checks, empty cards, preferences, backups,
 * import and export, and adding media. Port of server/routes/tools.py and media.py.
 *
 * Files the server kept on disk live in the engine's file store now: uploads for the
 * importers in /tmp, backups in /profile/backups. An export is handed to the browser
 * as a download.
 */

import { listDir, readFile, removeFile, statFile, writeFile } from '../../engine/client'
import type { Preferences } from '../../engine/generated/anki/config_pb'
import {
  be,
  clearCaches,
  closeCollection,
  COL_PATH,
  dbCommand,
  deckName,
  MEDIA_DB,
  MEDIA_DIR,
  openCollection,
  TMP_DIR,
  undoInfo,
} from '../col'
import { bigs, get, HttpError, post } from '../http'
import { resetReview } from './review'

// ---- undo / redo ------------------------------------------------------------------------------

post('/api/undo', async () => {
  const status = await be.getUndoStatus({})
  if (!status.undo) throw new HttpError(409, 'Nothing to undo.')
  const out = await be.undo({})
  if (out.changes?.notetype) clearCaches()
  resetReview()
  return { name: status.undo, ...(await undoInfo()) }
})

post('/api/redo', async () => {
  const status = await be.getUndoStatus({})
  if (!status.redo) throw new HttpError(409, 'Nothing to redo.')
  const out = await be.redo({})
  if (out.changes?.notetype) clearCaches()
  resetReview()
  return { name: status.redo, ...(await undoInfo()) }
})

get('/api/undo', () => undoInfo())

/** Ask a long operation (import, optimizing) to stop. */
post('/api/abort', async () => {
  await be.setWantsAbort({})
  return { ok: true }
})

// ---- checks -----------------------------------------------------------------------------------

post('/api/check-database', async () => {
  let problems: string[]
  let ok: boolean
  try {
    problems = [...(await be.checkDatabase({})).problems]
    ok = problems.length === 0
    problems.push('Database rebuilt and optimized.')
  } catch (err) {
    problems = [err instanceof Error ? err.message : String(err)]
    ok = false
  }
  clearCaches()
  resetReview()
  return { report: problems.join('\n'), ok }
})

post('/api/check-media', async () => {
  const out = await be.checkMedia({})
  return {
    report: out.report,
    unused: [...out.unused],
    missing: [...out.missing],
    missingNotes: out.missingMediaNotes.map(Number),
    haveTrash: out.haveTrash,
  }
})

post('/api/media/trash-unused', async ({ body }) => {
  await be.trashMediaFiles({ fnames: body.names ?? [] })
  return { count: (body.names ?? []).length }
})

post('/api/media/empty-trash', async () => {
  await be.emptyTrash({})
  return { ok: true }
})

post('/api/media/restore-trash', async () => {
  await be.restoreTrash({})
  return { ok: true }
})

get('/api/empty-cards', async () => {
  const report = await be.getEmptyCards({})
  return {
    report: report.report,
    notes: report.notes.map((n) => ({ noteId: Number(n.noteId), cardIds: n.cardIds.map(Number), willDeleteNote: n.willDeleteNote })),
  }
})

/** keepNotes: notes that would lose every card keep their first. */
post('/api/empty-cards', async ({ body }) => {
  const report = await be.getEmptyCards({})
  const cids: number[] = []
  for (const n of report.notes) {
    let ids = n.cardIds.map(Number)
    if (n.willDeleteNote && (body.keepNotes ?? true)) ids = ids.slice(1)
    cids.push(...ids)
  }
  await be.removeCards({ cardIds: bigs(cids) })
  resetReview()
  return { count: cids.length }
})

// ---- preferences (collection settings, synced) --------------------------------------------------

get('/api/preferences', async () => {
  const p = await be.getPreferences({})
  return {
    scheduling: {
      rollover: p.scheduling?.rollover,
      learnAheadSecs: p.scheduling?.learnAheadSecs,
      newReviewMix: p.scheduling?.newReviewMix,
      dayLearnFirst: p.scheduling?.dayLearnFirst,
    },
    reviewing: {
      hideAudioPlayButtons: p.reviewing?.hideAudioPlayButtons,
      interruptAudioWhenAnswering: p.reviewing?.interruptAudioWhenAnswering,
      showRemainingDueCounts: p.reviewing?.showRemainingDueCounts,
      showIntervalsOnButtons: p.reviewing?.showIntervalsOnButtons,
      timeLimitSecs: p.reviewing?.timeLimitSecs,
      loadBalancerEnabled: p.reviewing?.loadBalancerEnabled,
      fsrsShortTermWithStepsEnabled: p.reviewing?.fsrsShortTermWithStepsEnabled,
    },
    editing: {
      addingDefaultsToCurrentDeck: p.editing?.addingDefaultsToCurrentDeck,
      pasteImagesAsPng: p.editing?.pasteImagesAsPng,
      pasteStripsFormatting: p.editing?.pasteStripsFormatting,
      defaultSearchText: p.editing?.defaultSearchText,
      ignoreAccentsInSearch: p.editing?.ignoreAccentsInSearch,
      renderLatex: p.editing?.renderLatex,
    },
    backups: {
      daily: p.backups?.daily,
      weekly: p.backups?.weekly,
      monthly: p.backups?.monthly,
      minimumIntervalMins: p.backups?.minimumIntervalMins,
    },
  }
})

post('/api/preferences', async ({ body }) => {
  const p = await be.getPreferences({})
  for (const [section, values] of Object.entries(body ?? {})) {
    const target = (p as unknown as Record<string, Record<string, unknown> | undefined>)[section]
    if (!target || typeof values !== 'object' || values === null) throw new HttpError(400, `unknown section ${section}`)
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (!(key in target)) throw new HttpError(400, `unknown setting ${section}.${key}`)
      target[key] = value
    }
  }
  await be.setPreferences(p as Preferences)
  return { ok: true }
})

// ---- backups --------------------------------------------------------------------------------------

export const BACKUP_DIR = '/profile/backups'
const KEEP_BACKUPS = 8

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

/**
 * A .colpkg of the collection, as desktop's backups are; the engine's own backups need
 * a thread the browser doesn't have. The newest few are kept.
 */
export async function makeBackup(): Promise<string> {
  const name = `backup-${stamp()}.colpkg`
  await writeFile(`${BACKUP_DIR}/.keep`, new Uint8Array())
  await exportColpkg(`${BACKUP_DIR}/${name}`, true)
  const all = (await listDir(BACKUP_DIR)).filter((n) => n.endsWith('.colpkg')).sort().reverse()
  for (const old of all.slice(KEEP_BACKUPS)) await removeFile(`${BACKUP_DIR}/${old}`)
  return name
}

async function exportColpkg(path: string, includeMedia: boolean, legacy = false) {
  try {
    await be.exportCollectionPackage({ outPath: path, includeMedia, legacy })
  } finally {
    // the export closes the collection
    await reopenAfterClose()
  }
}

async function reopenAfterClose() {
  await closeCollection().catch(() => {})
  await openCollection()
  resetReview()
}

post('/api/backups', async () => {
  await makeBackup()
  return { created: true }
})

get('/api/backups', async () => {
  const names = (await listDir(BACKUP_DIR).catch(() => [] as string[])).filter((n) => n.endsWith('.colpkg'))
  const out = []
  for (const name of names) {
    const st = await statFile(`${BACKUP_DIR}/${name}`)
    out.push({ name, time: (st?.[1] ?? 0) / 1000, size: st?.[0] ?? 0 })
  }
  return out.sort((a, b) => b.time - a.time)
})

/** Replace the collection with a .colpkg, then make the next sync upload it. */
async function replaceCollection(path: string) {
  await closeCollection()
  try {
    await be.importCollectionPackage({ colPath: COL_PATH, backupPath: path, mediaFolder: MEDIA_DIR, mediaDb: MEDIA_DB })
  } finally {
    await openCollection()
    resetReview()
  }
  // A restored collection must replace the server's, not merge with it.
  await dbCommand({ kind: 'query', sql: 'update col set scm=?', args: [Date.now()], first_row_only: false })
}

post('/api/backups/restore', async ({ body }) => {
  const name = String(body.name ?? '').split('/').pop()!
  if (!(await statFile(`${BACKUP_DIR}/${name}`))) throw new HttpError(404, 'No such backup.')
  await replaceCollection(`${BACKUP_DIR}/${name}`)
  return { ok: true }
})

// ---- import -----------------------------------------------------------------------------------------

/** Store a picked file for an importer (or the editor's addMediaFromPath); returns its path. */
export async function storeUpload(file: File): Promise<string> {
  const name = (file.name || 'file').split(/[\\/]/).pop()!
  const path = `${TMP_DIR}/${Date.now()}-${name}`
  await writeFile(path, new Uint8Array(await file.arrayBuffer()))
  return path
}

export async function importUpload(file: File) {
  const name = (file.name || 'import').split(/[\\/]/).pop()!
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (!['apkg', 'colpkg', 'csv', 'tsv', 'txt'].includes(ext)) {
    throw new HttpError(400, 'Choose an .apkg, .colpkg, .csv, .tsv or .txt file.')
  }
  const path = await storeUpload(file)
  const kind = ext === 'apkg' ? 'apkg' : ext === 'colpkg' ? 'colpkg' : 'csv'
  return { path, kind, name }
}

post('/api/import/colpkg', async ({ body }) => {
  const path = String(body.path ?? '')
  if (!path.startsWith(`${TMP_DIR}/`) || !(await statFile(path))) throw new HttpError(400, 'Upload the file first.')
  await makeBackup()
  await replaceCollection(path)
  await removeFile(path)
  return { ok: true }
})

// ---- export -----------------------------------------------------------------------------------------

function safeName(name: string) {
  return name.replace(/::/g, '_').replace(/[^\w\- ]+/g, '_').trim() || 'deck'
}

function limit(body: { cardIds?: number[]; noteIds?: number[]; deckId?: number }) {
  if (body.cardIds?.length) return { limit: { case: 'cardIds' as const, value: { cids: bigs(body.cardIds) } } }
  if (body.noteIds?.length) return { limit: { case: 'noteIds' as const, value: { noteIds: bigs(body.noteIds) } } }
  if (body.deckId) return { limit: { case: 'deckId' as const, value: BigInt(body.deckId) } }
  return { limit: { case: 'wholeCollection' as const, value: {} } }
}

const EXPORT_DIR = '/exports'

post('/api/export', async ({ body }) => {
  const t = stamp()
  let name: string
  if (body.kind === 'colpkg') {
    name = `collection-${t}.colpkg`
    await exportColpkg(`${EXPORT_DIR}/${name}`, body.includeMedia ?? true, Boolean(body.legacy))
  } else if (body.kind === 'apkg') {
    const deck = body.deckId ? await deckName(Number(body.deckId)) : 'cards'
    name = `${safeName(deck)}-${t}.apkg`
    await be.exportAnkiPackage({
      outPath: `${EXPORT_DIR}/${name}`,
      options: {
        withScheduling: body.includeScheduling ?? true,
        withDeckConfigs: body.includeDeckConfigs ?? true,
        withMedia: body.includeMedia ?? true,
        legacy: Boolean(body.legacy),
      },
      limit: limit(body) as never,
    })
  } else if (body.kind === 'notes-csv') {
    name = `notes-${t}.txt`
    await be.exportNoteCsv({
      outPath: `${EXPORT_DIR}/${name}`,
      withHtml: body.withHtml ?? true,
      withTags: body.withTags ?? true,
      withDeck: body.withDeck ?? true,
      withNotetype: body.withNotetype ?? true,
      withGuid: Boolean(body.withGuid),
      limit: limit(body) as never,
    })
  } else if (body.kind === 'cards-csv') {
    name = `cards-${t}.txt`
    await be.exportCardCsv({ outPath: `${EXPORT_DIR}/${name}`, withHtml: body.withHtml ?? true, limit: limit(body) as never })
  } else {
    throw new HttpError(400, 'unknown export kind')
  }
  const data = await readFile(`${EXPORT_DIR}/${name}`)
  await removeFile(`${EXPORT_DIR}/${name}`)
  if (!data) throw new HttpError(500, 'The export could not be read.')
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }))
  return { url, name }
})

// ---- media -------------------------------------------------------------------------------------------

/** Add a file to the collection's media; returns the name it was stored under. */
export async function addMediaFile(file: File): Promise<string> {
  const name = (file.name || 'file').split(/[\\/]/).pop()!
  return (await be.addMediaFile({ desiredName: name, data: new Uint8Array(await file.arrayBuffer()) })).val
}

/** A media file's bytes, or null. */
export function mediaFile(name: string): Promise<Uint8Array | null> {
  return readFile(`${MEDIA_DIR}/${name}`)
}
