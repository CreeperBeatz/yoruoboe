/**
 * The card browser: search, its columns and sort order, cards or notes, saved searches.
 * Port of server/routes/browse.py. Rows come from the engine as desktop's browser table
 * gets them (browser_row_for_id), so every column, colour and sort is Anki's own.
 */

import { BrowserColumns_Sorting, BrowserRow_Color, SearchNode } from '../../engine/generated/anki/search_pb'
import { be, configBool, configString, ConfigKey_Bool, ConfigKey_String, getCard, getConfig, setConfig, setConfigBool } from '../col'
import { big, get, HttpError, num, nums, post } from '../http'

const COLORS: Record<number, string | null> = {
  [BrowserRow_Color.DEFAULT]: null,
  [BrowserRow_Color.MARKED]: 'marked',
  [BrowserRow_Color.SUSPENDED]: 'suspended',
  [BrowserRow_Color.BURIED]: 'buried',
  [BrowserRow_Color.FLAG_RED]: 'flag1',
  [BrowserRow_Color.FLAG_ORANGE]: 'flag2',
  [BrowserRow_Color.FLAG_GREEN]: 'flag3',
  [BrowserRow_Color.FLAG_BLUE]: 'flag4',
  [BrowserRow_Color.FLAG_PINK]: 'flag5',
  [BrowserRow_Color.FLAG_TURQUOISE]: 'flag6',
  [BrowserRow_Color.FLAG_PURPLE]: 'flag7',
}

const CARD_COLUMNS = ['noteFld', 'template', 'cardDue', 'deck']
const NOTE_COLUMNS = ['noteFld', 'note', 'template', 'noteTags']

const notesMode = () => configBool(ConfigKey_Bool.BROWSER_TABLE_SHOW_NOTES_MODE)

/** load_browser_{card,note}_columns: the active columns, also telling the engine. */
async function activeColumns(notes: boolean): Promise<string[]> {
  const columns = await getConfig<string[]>(notes ? 'activeNoteCols' : 'activeCols', notes ? NOTE_COLUMNS : CARD_COLUMNS)
  await be.setActiveBrowserColumns({ vals: columns })
  return columns
}

async function columns() {
  return (await be.allBrowserColumns({})).columns
}

get('/api/browse/config', async () => {
  const notes = await notesMode()
  return {
    notesMode: notes,
    columns: (await columns()).map((c) => ({
      key: c.key,
      label: notes ? c.notesModeLabel : c.cardsModeLabel,
      sortable: (notes ? c.sortingNotes : c.sortingCards) !== BrowserColumns_Sorting.NONE,
      tooltip: notes ? c.notesModeTooltip : c.cardsModeTooltip,
    })),
    active: await activeColumns(notes),
    sortColumn: await getConfig(notes ? 'noteSortType' : 'sortType', 'noteFld'),
    sortReverse: await getConfig(notes ? 'browserNoteSortBackwards' : 'sortBackwards', false),
    defaultSearch: (await configString(ConfigKey_String.DEFAULT_SEARCH_TEXT)) || 'deck:current',
    savedSearches: (await getConfig<Record<string, string>>('savedFilters', {})) ?? {},
  }
})

post('/api/browse/mode', async ({ body }) => {
  await setConfigBool(ConfigKey_Bool.BROWSER_TABLE_SHOW_NOTES_MODE, Boolean(body.notesMode))
  return { ok: true }
})

post('/api/browse/columns', async ({ body }) => {
  const cols: string[] = body.columns ?? []
  if (!cols.length) throw new HttpError(400, 'Keep at least one column.')
  await setConfig((await notesMode()) ? 'activeNoteCols' : 'activeCols', cols)
  await be.setActiveBrowserColumns({ vals: cols })
  return { ok: true }
})

post('/api/browse/sort', async ({ body }) => {
  if (await notesMode()) {
    await setConfig('noteSortType', body.column)
    await setConfig('browserNoteSortBackwards', Boolean(body.reverse))
  } else {
    await setConfig('sortType', body.column)
    await setConfig('sortBackwards', Boolean(body.reverse))
  }
  return { ok: true }
})

/** Ids of the matching cards (or notes, in notes mode), in the browser's sort order. */
post('/api/browse/search', async ({ body }) => {
  const notes = await notesMode()
  const key = await getConfig(notes ? 'noteSortType' : 'sortType', 'noteFld')
  const reverse = Boolean(await getConfig(notes ? 'browserNoteSortBackwards' : 'sortBackwards', false))
  const column = (await columns()).find((c) => c.key === key)
  const sortable = column && (notes ? column.sortingNotes : column.sortingCards) !== BrowserColumns_Sorting.NONE
  const order = sortable
    ? { value: { case: 'builtin' as const, value: { column: column.key, reverse } } }
    : { value: { case: 'none' as const, value: {} } }
  try {
    const req = { search: String(body.search ?? ''), order }
    const out = notes ? await be.searchNotes(req) : await be.searchCards(req)
    return { ids: nums(out.ids), notesMode: notes }
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err))
  }
})

post('/api/browse/rows', async ({ body }) => {
  await activeColumns(await notesMode())
  const out = []
  for (const id of ((body.ids as number[]) ?? []).slice(0, 500)) {
    try {
      const row = await be.browserRowForId({ val: big(id) })
      out.push({ id, cells: row.cells.map((c) => c.text), color: COLORS[row.color] ?? null })
    } catch {
      out.push({ id, cells: [], color: null, missing: true })
    }
  }
  return out
})

/** Card ids and note ids for a selection, whichever mode it was made in. */
post('/api/browse/to-cards', async ({ body }) => {
  const ids: number[] = body.ids ?? []
  if (body.notesMode) {
    const cids: number[] = []
    for (const nid of ids) cids.push(...nums((await be.cardsOfNote({ nid: big(nid) })).cids))
    return { cardIds: cids, noteIds: ids }
  }
  const nids: number[] = []
  for (const c of ids) {
    const nid = num((await getCard(c)).noteId)
    if (!nids.includes(nid)) nids.push(nid)
  }
  return { cardIds: ids, noteIds: nids }
})

/** A SearchNode from one of Anki's pages, as the search text the browser shows. */
export async function searchNodeToString(bytes: Uint8Array): Promise<string> {
  return (await be.buildSearchString(SearchNode.fromBinary(bytes))).val
}

post('/api/browse/saved', async ({ body }) => {
  const saved = { ...((await getConfig<Record<string, string>>('savedFilters', {})) ?? {}) }
  if (body.search == null) delete saved[body.name]
  else saved[body.name] = body.search
  await setConfig('savedFilters', saved)
  return { savedSearches: saved }
})

