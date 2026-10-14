/**
 * A smoke test of the engine on its own (engine-smoke.html, dev server only):
 * open a collection in OPFS, sync it with the sync server, add a note, sync
 * again, sync media, and check what survives a reload.
 *
 *   /engine-smoke.html?user=…&pass=…&profile=a[&reset=1]
 */

import * as backend from './generated/backend'
import { BackendError, readFile, listDir, startEngine } from './client'
import { SyncCollectionResponse_ChangesRequired as Required } from './generated/anki/sync_pb'

const params = new URLSearchParams(location.search)
const out = document.getElementById('log')!
const results: Record<string, unknown> = {}

function log(...parts: unknown[]) {
  const line = parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p, (_, v) => (typeof v === 'bigint' ? Number(v) : v))))
    .join(' ')
  out.textContent += line + '\n'
  console.log(line)
}

async function main() {
  const profile = params.get('profile') ?? 'a'
  const dir = `/profiles/${profile}`
  if (params.get('reset')) {
    const root = await navigator.storage.getDirectory().catch(() => null)
    await root?.removeEntry(`anki-${profile}`, { recursive: true }).catch(() => {})
    await new Promise((r) => {
      const req = indexedDB.deleteDatabase(`anki-${profile}`)
      req.onsuccess = req.onerror = req.onblocked = r
    })
    log('reset storage')
  }
  const t0 = performance.now()
  const store = await startEngine(`anki-${profile}`, ['en'], (params.get('storage') as never) ?? 'auto')
  results.store = store
  log('engine started in', Math.round(performance.now() - t0), 'ms, storage:', store)

  await backend.openCollection({
    collectionPath: `${dir}/collection.anki2`,
    mediaFolderPath: `${dir}/collection.media`,
    mediaDbPath: `${dir}/collection.media.db`,
  })
  const before = await backend.searchCards({ search: '', order: { value: { case: 'none', value: {} } } as never })
  results.cardsAtOpen = before.ids.length
  log('collection open, cards:', before.ids.length)

  const endpoint = `${location.origin}/aw/sync/`
  const auth = await backend.syncLogin({
    username: params.get('user') ?? '',
    password: params.get('pass') ?? '',
    endpoint,
  })
  log('logged in, hkey', auth.hkey.slice(0, 6) + '…')

  let res = await backend.syncCollection({ auth, syncMedia: false })
  log('sync:', Required[res.required], 'server media usn', res.serverMediaUsn)
  results.firstSync = Required[res.required]
  if (res.required === Required.FULL_DOWNLOAD || res.required === Required.FULL_SYNC) {
    const t1 = performance.now()
    await backend.fullUploadOrDownload({ auth, upload: false, serverUsn: res.serverMediaUsn })
    log('full download in', Math.round(performance.now() - t1), 'ms')
  } else if (res.required === Required.FULL_UPLOAD) {
    await backend.fullUploadOrDownload({ auth, upload: true, serverUsn: res.serverMediaUsn })
    log('full upload')
  }
  const after = await backend.searchCards({ search: '', order: { value: { case: 'none', value: {} } } as never })
  results.cardsAfterSync = after.ids.length
  log('cards after sync:', after.ids.length)

  const decks = await backend.getDeckNames({ skipEmptyDefault: false, includeFiltered: true })
  log('decks:', decks.entries.map((d) => d.name))

  // add a note and sync it up
  const notetypes = await backend.getNotetypeNames({})
  const basic = notetypes.entries.find((e) => e.name === 'Basic') ?? notetypes.entries[0]
  const note = await backend.newNote({ ntid: basic.id })
  note.fields = [`smoke ${new Date().toISOString()}`, 'from the browser engine']
  const added = await backend.addNote({ note, deckId: 1n })
  log('added note', added.noteId)
  res = await backend.syncCollection({ auth, syncMedia: true })
  log('sync after add:', Required[res.required])
  results.syncAfterAdd = Required[res.required]

  // media sync runs in the background
  const t2 = performance.now()
  for (;;) {
    const status = await backend.mediaSyncStatus({})
    if (!status.active) break
    await new Promise((r) => setTimeout(r, 300))
  }
  const media = await listDir(`${dir}/collection.media`).catch(() => [])
  log('media sync done in', Math.round(performance.now() - t2), 'ms; files:', media)
  results.media = media
  if (media.length) {
    const data = await readFile(`${dir}/collection.media/${media[0]}`)
    log('first media file bytes:', data?.length)
  }

  // render a card, as the reviewer will
  const first = after.ids[0]
  if (first) {
    const rendered = await backend.renderExistingCard({ cardId: first, browser: false, partialRender: false })
    log('rendered card', first, 'question nodes:', rendered.questionNodes.length)
  }

  // scheduling
  const queued = await backend.getQueuedCards({ fetchLimit: 1, intradayLearningOnly: false })
  log('queued cards:', queued.cards.length, 'new/learn/review', queued.newCount, queued.learningCount, queued.reviewCount)

  results.ok = true
  log('DONE')
}

main().catch((err) => {
  results.ok = false
  results.error = err instanceof BackendError ? `${err.kind}: ${err.message}` : String(err?.stack ?? err)
  log('FAILED', results.error)
}).finally(() => {
  ;(window as unknown as { smoke: unknown }).smoke = results
})
