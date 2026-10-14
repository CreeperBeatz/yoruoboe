/** The deck list, a deck's study overview, and what can be done to decks. Port of server/routes/decks.py. */

import type { DeckTreeNode } from '../../engine/generated/anki/decks_pb'
import { Deck_Filtered_SearchTerm, SetDeckCollapsedRequest_Scope } from '../../engine/generated/anki/decks_pb'
import { CustomStudyRequest_Cram_CramKind, UnburyDeckRequest_Mode } from '../../engine/generated/anki/scheduler_pb'
import {
  be,
  currentDeckId,
  dbCommand,
  deckIdForName,
  deckLegacy,
  selectDeck,
  undoInfo,
  updateDeckLegacy,
} from '../col'
import { big, del, get, HttpError, num, post } from '../http'

function node(n: DeckTreeNode): unknown {
  return {
    id: num(n.deckId),
    name: n.name,
    level: n.level,
    collapsed: n.collapsed,
    filtered: n.filtered,
    new: n.newCount,
    learn: n.learnCount,
    review: n.reviewCount,
    total: n.totalIncludingChildren,
    children: n.children.map(node),
  }
}

export async function deckTree(): Promise<DeckTreeNode> {
  return be.deckTree({ now: BigInt(Math.floor(Date.now() / 1000)) })
}

export function findInTree(n: DeckTreeNode, did: number): DeckTreeNode | null {
  if (num(n.deckId) === did) return n
  for (const c of n.children) {
    const hit = findInTree(c, did)
    if (hit) return hit
  }
  return null
}

get('/api/decks', async () => {
  const tree = await deckTree()
  const rows = await dbCommand<unknown[][]>({ kind: 'query', sql: 'select count() from cards', args: [], first_row_only: true })
  return {
    decks: tree.children.map(node),
    current: await currentDeckId(),
    studiedToday: (await be.studiedToday({})).val,
    undo: await undoInfo(),
    cardCount: Number(rows[0]?.[0] ?? 0),
  }
})

post('/api/decks', async ({ body }) => {
  const name = String(body.name ?? '').trim()
  if (!name) throw new HttpError(400, 'A deck needs a name.')
  if (await deckIdForName(name)) throw new HttpError(409, 'A deck with that name already exists.')
  const deck = await be.newDeck({})
  deck.name = name
  const out = await be.addDeck(deck)
  return { id: num(out.id) }
})

/** What the study screen shows before the first card (AnkiDroid's StudyOptionsFragment). */
get('/api/decks/:did', async ({ params }) => {
  const did = Number(params.did)
  const deck = await deckLegacy(did)
  if (!deck) throw new HttpError(404, 'No such deck.')
  await selectDeck(did)
  const tree = findInTree(await deckTree(), did)
  const congrats = await be.congratsInfo({})
  const q = await be.getQueuedCards({ fetchLimit: 1, intradayLearningOnly: false })
  const [n, l, r] = [q.newCount, q.learningCount, q.reviewCount]
  return {
    id: did,
    name: deck.name,
    filtered: Boolean(deck.dyn),
    description: deck.desc ?? '',
    markdownDescription: Boolean(deck.md ?? false),
    counts: { new: n, learn: l, review: r },
    total: tree ? tree.totalIncludingChildren : 0,
    buried: { sched: congrats.haveSchedBuried, user: congrats.haveUserBuried },
    finished: n + l + r === 0,
    secsUntilNextLearn: congrats.secsUntilNextLearn,
    undo: await undoInfo(),
  }
})

post('/api/decks/:did/rename', async ({ params, body }) => {
  const did = Number(params.did)
  const name = String(body.name ?? '').trim()
  if (!name) throw new HttpError(400, 'A deck needs a name.')
  const existing = await deckIdForName(name)
  if (existing && existing !== did) throw new HttpError(409, 'A deck with that name already exists.')
  await be.renameDeck({ deckId: big(did), newName: name })
  return { ok: true }
})

post('/api/decks/:did/reparent', async ({ params, body }) => {
  await be.reparentDecks({ deckIds: [big(params.did)], newParent: big(body.parent ?? 0) })
  return { ok: true }
})

del('/api/decks/:did', async ({ params }) => {
  const out = await be.removeDecks({ dids: [big(params.did)] })
  return { removedCards: out.count, undo: await undoInfo() }
})

post('/api/decks/:did/collapse', async ({ params, body }) => {
  await be.setDeckCollapsed({
    deckId: big(params.did),
    collapsed: Boolean(body.collapsed),
    scope: SetDeckCollapsedRequest_Scope.REVIEWER,
  })
  return { ok: true }
})

post('/api/decks/:did/unbury', async ({ params, body }) => {
  const mode = (
    { all: UnburyDeckRequest_Mode.ALL, sched: UnburyDeckRequest_Mode.SCHED_ONLY, user: UnburyDeckRequest_Mode.USER_ONLY } as Record<
      string,
      UnburyDeckRequest_Mode
    >
  )[body.mode ?? 'all']
  if (mode === undefined) throw new HttpError(400, 'mode must be all, sched or user')
  await be.unburyDeck({ deckId: big(params.did), mode })
  return { ok: true }
})

post('/api/decks/:did/description', async ({ params, body }) => {
  const deck = await deckLegacy(Number(params.did))
  if (!deck) throw new HttpError(404, 'No such deck.')
  deck.desc = String(body.description ?? '')
  deck.md = Boolean(body.markdown)
  await updateDeckLegacy(deck)
  return { ok: true }
})

// ---- filtered decks -----------------------------------------------------------------------

post('/api/decks/:did/rebuild', async ({ params }) => {
  const out = await be.rebuildFilteredDeck({ did: big(params.did) })
  return { count: out.count }
})

post('/api/decks/:did/empty', async ({ params }) => {
  await be.emptyFilteredDeck({ did: big(params.did) })
  return { ok: true }
})

/** A filtered deck's settings; did 0 gives the defaults for a new one. */
get('/api/decks/filtered/:did', async ({ params, query }) => {
  const did = Number(params.did)
  const f = await be.getOrCreateFilteredDeck({ did: big(did) })
  const c = f.config!
  const terms = c.searchTerms.map((t) => ({ search: t.search, limit: t.limit, order: t.order }))
  const search = query.get('search')
  if (did === 0 && search !== null && terms.length) terms[0].search = search
  return {
    id: num(f.id),
    name: f.name,
    reschedule: c.reschedule,
    terms,
    delays: [...c.delays],
    previewAgainSecs: c.previewAgainSecs,
    previewHardSecs: c.previewHardSecs,
    previewGoodSecs: c.previewGoodSecs,
    allowEmpty: f.allowEmpty,
    orderLabels: (await be.filteredDeckOrderLabels({})).vals,
  }
})

post('/api/decks/filtered', async ({ body }) => {
  const f = await be.getOrCreateFilteredDeck({ did: big(body.id ?? 0) })
  f.name = String(body.name ?? '')
  const c = f.config!
  c.reschedule = Boolean(body.reschedule)
  c.searchTerms = []
  for (const t of body.terms ?? []) {
    if (String(t.search).trim() || !c.searchTerms.length) {
      c.searchTerms.push(new Deck_Filtered_SearchTerm({ search: String(t.search), limit: Number(t.limit), order: Number(t.order) }))
    }
  }
  c.delays = (body.delays ?? []).map(Number)
  c.previewAgainSecs = Number(body.previewAgainSecs ?? 60)
  c.previewHardSecs = Number(body.previewHardSecs ?? 600)
  c.previewGoodSecs = Number(body.previewGoodSecs ?? 0)
  let out
  try {
    out = await be.addOrUpdateFilteredDeck(f)
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err))
  }
  await selectDeck(num(out.id))
  return { id: num(out.id) }
})

// ---- custom study -------------------------------------------------------------------------

get('/api/decks/:did/custom-study', async ({ params }) => {
  const d = await be.customStudyDefaults({ deckId: big(params.did) })
  return {
    tags: d.tags.map((t) => ({ name: t.name, include: t.include, exclude: t.exclude })),
    extendNew: d.extendNew,
    extendReview: d.extendReview,
    availableNew: d.availableNew,
    availableReview: d.availableReview,
    availableNewInChildren: d.availableNewInChildren,
    availableReviewInChildren: d.availableReviewInChildren,
  }
})

post('/api/decks/:did/custom-study', async ({ params, body }) => {
  const value = Number(body.value ?? 0)
  const kinds: Record<string, CustomStudyRequest_Cram_CramKind> = {
    new: CustomStudyRequest_Cram_CramKind.NEW,
    due: CustomStudyRequest_Cram_CramKind.DUE,
    review: CustomStudyRequest_Cram_CramKind.REVIEW,
    all: CustomStudyRequest_Cram_CramKind.ALL,
  }
  type Value =
    | { case: 'newLimitDelta'; value: number }
    | { case: 'reviewLimitDelta'; value: number }
    | { case: 'forgotDays'; value: number }
    | { case: 'reviewAheadDays'; value: number }
    | { case: 'previewDays'; value: number }
    | {
        case: 'cram'
        value: { kind: CustomStudyRequest_Cram_CramKind; cardLimit: number; tagsToInclude: string[]; tagsToExclude: string[] }
      }
  let v: Value
  switch (body.kind) {
    case 'newLimit':
      v = { case: 'newLimitDelta', value }
      break
    case 'reviewLimit':
      v = { case: 'reviewLimitDelta', value }
      break
    case 'forgot':
      v = { case: 'forgotDays', value }
      break
    case 'ahead':
      v = { case: 'reviewAheadDays', value }
      break
    case 'preview':
      v = { case: 'previewDays', value }
      break
    case 'cram':
      v = {
        case: 'cram',
        value: {
          kind: kinds[body.cramKind ?? 'new'],
          cardLimit: Number(body.cramLimit ?? 100),
          tagsToInclude: body.tagsToInclude ?? [],
          tagsToExclude: body.tagsToExclude ?? [],
        },
      }
      break
    default:
      throw new HttpError(400, 'unknown custom study kind')
  }
  try {
    await be.customStudy({ deckId: big(params.did), value: v as never })
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err))
  }
  return { current: await currentDeckId() }
})
