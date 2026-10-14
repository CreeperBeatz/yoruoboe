/**
 * The card browser (AnkiDroid's CardBrowser): Anki's search, its columns and colours,
 * cards or notes, and what can be done to a selection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { useSync } from '../sync'
import { AppBar, attempt, choose, confirm, IconButton, Menu, prompt, toast, useLongPress, useMenu, type MenuItem } from '../ui/components'
import { chooseDeck, editTags, FLAG_COLORS, forgetCards, getFlagNames, repositionCards, resetFlagNames, setDueDate } from '../ui/dialogs'
import { Icon } from '../ui/icons'
import { exportDialog } from './ImportExport'
import './browser.css'

interface Column {
  key: string
  label: string
  sortable: boolean
  tooltip: string
}

interface Config {
  notesMode: boolean
  columns: Column[]
  active: string[]
  sortColumn: string
  sortReverse: boolean
  defaultSearch: string
  savedSearches: Record<string, string>
}

interface Row {
  id: number
  cells: string[]
  color: string | null
  missing?: boolean
}

const PAGE = 80

export default function Browser({ onMenu, query }: { onMenu: () => void; query: URLSearchParams }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [search, setSearch] = useState<string | null>(null)
  const [editing, setEditing] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [ids, setIds] = useState<number[]>([])
  const [rows, setRows] = useState<Map<number, Row>>(new Map())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rowMenu, setRowMenu] = useState<{ id: number; at: { x: number; y: number } } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const loadingRows = useRef(new Set<number>())
  const { generation } = useSync()
  const selecting = selected.size > 0

  const loadConfig = useCallback(async () => {
    const c = await api.get<Config>('/api/browse/config')
    setConfig(c)
    return c
  }, [])

  // The first search: what we were opened with, a deck, or the default.
  useEffect(() => {
    void loadConfig().then(async (c) => {
      const s = query.get('search')
      const deck = query.get('deck')
      if (s) setSearch(s)
      else if (deck) {
        const d = await api.get<{ name: string }>(`/api/decks/${deck}`)
        setSearch(`deck:"${d.name.replace(/"/g, '\\"')}"`)
      } else setSearch(c.defaultSearch)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSearch = useCallback(async (s: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await api.post<{ ids: number[] }>('/api/browse/search', { search: s })
      setIds(res.ids)
      setRows(new Map())
      loadingRows.current.clear()
      setSelected(new Set())
      list.current?.scrollTo({ top: 0 })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setIds([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (search !== null) void runSearch(search)
  }, [search, runSearch, generation])

  const refresh = useCallback(async () => {
    if (search !== null) {
      const keep = selected
      await runSearch(search)
      setSelected(keep)
    }
  }, [search, runSearch, selected])

  // Rows are fetched a page at a time as they scroll into view.
  const fetchRows = useCallback(
    async (wanted: number[]) => {
      const need = wanted.filter((id) => !rows.has(id) && !loadingRows.current.has(id))
      if (!need.length) return
      need.forEach((id) => loadingRows.current.add(id))
      try {
        const got = await api.post<Row[]>('/api/browse/rows', { ids: need })
        setRows((prev) => {
          const next = new Map(prev)
          got.forEach((r) => next.set(r.id, r))
          return next
        })
      } finally {
        need.forEach((id) => loadingRows.current.delete(id))
      }
    },
    [rows],
  )

  const [visible, setVisible] = useState(PAGE)
  useEffect(() => setVisible(PAGE), [ids])
  useEffect(() => {
    void fetchRows(ids.slice(0, visible))
  }, [ids, visible, fetchRows])

  const onScroll = () => {
    const el = list.current
    if (el && el.scrollTop + el.clientHeight > el.scrollHeight - 600 && visible < ids.length) setVisible((v) => v + PAGE)
  }

  // ---- selection and actions ------------------------------------------------------------

  const selection = async () => {
    const res = await api.post<{ cardIds: number[]; noteIds: number[] }>('/api/browse/to-cards', {
      ids: [...selected],
      notesMode: config!.notesMode,
    })
    return res
  }

  const after = async (msg?: string) => {
    if (msg) toast(msg, { label: 'Undo', run: async () => (await attempt(() => api.post('/api/undo')), refresh()) })
    await refresh()
  }

  const actions = {
    flag: async (flag: number) => {
      const { cardIds } = await selection()
      if (await attempt(() => api.post('/api/cards/flag', { cardIds, flag }))) await after()
    },
    mark: async () => {
      const { noteIds } = await selection()
      if (await attempt(() => api.post('/api/notes/mark', { noteIds }))) await after()
    },
    suspend: async () => {
      const { cardIds } = await selection()
      const r = await attempt(() => api.post<{ suspended: boolean }>('/api/cards/suspend', { cardIds }))
      if (r) await after(r.suspended ? 'Suspended' : 'Unsuspended')
    },
    bury: async () => {
      const { cardIds } = await selection()
      if (await attempt(() => api.post('/api/cards/bury', { cardIds }))) await after('Buried')
    },
    del: async () => {
      const { noteIds } = await selection()
      if (!(await confirm(`Delete ${noteIds.length} notes and all their cards?`, { ok: 'Delete', danger: true }))) return
      const r = await attempt(() => api.post<{ count: number }>('/api/notes/delete', { noteIds }))
      if (r) {
        setSelected(new Set())
        await after(`${r.count} notes deleted`)
      }
    },
    tags: async () => {
      const { noteIds } = await selection()
      const all = await Promise.all(noteIds.slice(0, 200).map((n) => api.get<string[]>(`/api/notes/${n}/tags`)))
      const everywhere = all.length ? all.reduce((a, b) => a.filter((t) => b.includes(t))) : []
      const some = [...new Set(all.flat())].filter((t) => !everywhere.includes(t))
      const res = await editTags({ title: 'Edit tags', initial: everywhere, indeterminate: some })
      if (!res) return
      const add = res.checked.filter((t) => !everywhere.includes(t)).join(' ')
      const remove = res.unchecked.join(' ')
      if (await attempt(() => api.post('/api/notes/tags', { noteIds, add, remove }))) await after()
    },
    changeDeck: async () => {
      const d = await chooseDeck('Change deck')
      if (!d) return
      const { cardIds } = await selection()
      if (await attempt(() => api.post('/api/cards/set-deck', { cardIds, deckId: d.id }))) await after(`Moved to ${d.name}`)
    },
    setDue: async () => {
      const { cardIds } = await selection()
      if (await setDueDate(cardIds)) await after()
    },
    reposition: async () => {
      const { cardIds } = await selection()
      if (await repositionCards(cardIds)) await after()
    },
    reset: async () => {
      const { cardIds } = await selection()
      if (await forgetCards(cardIds)) await after()
    },
    preview: async () => {
      const { cardIds } = await selection()
      sessionStorage.setItem('preview-cards', JSON.stringify(cardIds))
      navigate('/preview?list=1')
    },
    changeNotetype: async () => {
      const { noteIds } = await selection()
      const r = await attempt(() => api.post<{ notetypeId: number }>('/api/notes/change-notetype-start', { noteIds }))
      if (r) navigate(`/page/change-notetype/${r.notetypeId}`)
    },
    findReplace: async () => {
      const { noteIds } = await selection()
      const fields = await api.post<string[]>('/api/notes/field-names', { noteIds })
      const find = await prompt('Find', { ok: 'Next' })
      if (!find) return
      const replacement = await prompt('Replace with', { ok: 'Next' })
      if (replacement === null) return
      const field = await choose<string | null>('In', [
        { label: 'All fields', value: '' },
        { label: 'Tags', value: 'tags' },
        ...fields.map((f) => ({ label: f, value: f })),
      ])
      if (field === null) return
      const regex = await confirm('Treat the input as a regular expression?', { ok: 'Regex', cancel: 'Plain text' })
      const r = await attempt(() =>
        api.post<{ count: number }>('/api/notes/find-replace', { noteIds, search: find, replacement, regex, field: field || null }),
      )
      if (r) await after(`${r.count} notes updated`)
    },
    export: async () => {
      const { cardIds, noteIds } = await selection()
      exportDialog({ cardIds, noteIds })
    },
    cardInfo: async () => {
      const { cardIds } = await selection()
      if (cardIds[0]) navigate(`/page/card-info/${cardIds[0]}`)
    },
    filteredDeck: () => navigate(`/filtered/0?search=${encodeURIComponent(search ?? '')}`),
  }

  const [flagNames, setFlagNames] = useState<{ flag: number; name: string }[]>([])
  useEffect(() => {
    void getFlagNames().then(setFlagNames)
  }, [])

  const flagItems = (apply: (f: number) => void): MenuItem[] => [
    { label: 'No flag', onClick: () => apply(0) },
    ...flagNames.map((f) => ({ label: f.name, icon: 'flag' as const, color: FLAG_COLORS[f.flag], onClick: () => apply(f.flag) })),
  ]

  const selectionMenu = (): MenuItem[] => [
    { label: 'Select all', icon: 'selectAll', onClick: () => setSelected(new Set(ids)) },
    { label: 'Select none', icon: 'close', onClick: () => setSelected(new Set()) },
    'separator',
    { label: 'Flag', icon: 'flag', submenu: flagItems(actions.flag) },
    { label: 'Toggle mark', icon: 'star', onClick: actions.mark },
    { label: 'Toggle suspend', icon: 'suspend', onClick: actions.suspend },
    { label: 'Bury', icon: 'bury', onClick: actions.bury },
    { label: 'Edit tags', icon: 'tag', onClick: actions.tags },
    { label: 'Change deck', icon: 'swap', onClick: actions.changeDeck },
    { label: 'Set due date', icon: 'event', onClick: actions.setDue },
    { label: 'Reposition', icon: 'sort', onClick: actions.reposition },
    { label: 'Reset', icon: 'reset', onClick: actions.reset },
    { label: 'Preview', icon: 'eye', onClick: actions.preview },
    { label: 'Change note type', icon: 'cards', onClick: actions.changeNotetype },
    { label: 'Find and replace', icon: 'search', onClick: actions.findReplace },
    { label: 'Card info', icon: 'info', disabled: selected.size !== 1, onClick: actions.cardInfo },
    { label: 'Export', icon: 'share', onClick: actions.export },
    { label: 'Delete note', icon: 'delete', onClick: actions.del },
  ]

  const setMode = async (notesMode: boolean) => {
    await attempt(() => api.post('/api/browse/mode', { notesMode }))
    await loadConfig()
    if (search !== null) await runSearch(search)
  }

  const chooseColumns = async () => {
    if (!config) return
    const key = await choose(
      'Columns (tap to add or remove)',
      config.columns.map((c) => ({ label: c.label, value: c.key, checked: config.active.includes(c.key) })),
    )
    if (!key) return
    const active = config.active.includes(key) ? config.active.filter((k) => k !== key) : [...config.active, key]
    if (await attempt(() => api.post('/api/browse/columns', { columns: active }))) {
      await loadConfig()
      setRows(new Map())
    }
  }

  const sortBy = async (key: string) => {
    if (!config) return
    const col = config.columns.find((c) => c.key === key)
    if (!col?.sortable) return toast('This column can’t be sorted')
    const reverse = config.sortColumn === key ? !config.sortReverse : false
    await attempt(() => api.post('/api/browse/sort', { column: key, reverse }))
    await loadConfig()
    if (search !== null) await runSearch(search)
  }

  const chooseSort = async () => {
    if (!config) return
    const key = await choose(
      'Sort by',
      config.columns.filter((c) => c.sortable).map((c) => ({
        label: c.label + (config.sortColumn === c.key ? (config.sortReverse ? ' ↓' : ' ↑') : ''),
        value: c.key,
        checked: config.sortColumn === c.key,
      })),
    )
    if (key) await sortBy(key)
  }

  const savedSearches = async () => {
    if (!config) return
    const names = Object.keys(config.savedSearches)
    const pick = await choose<string>('Saved searches', [
      { label: '＋ Save current search', value: '\u0000save' },
      ...names.map((n) => ({ label: `${n} — ${config.savedSearches[n]}`, value: n })),
      ...(names.length ? [{ label: '🗑 Delete a saved search…', value: '\u0000delete' }] : []),
    ])
    if (!pick) return
    if (pick === '\u0000save') {
      const name = await prompt('Save search', { label: 'Name', ok: 'Save' })
      if (name?.trim()) {
        await attempt(() => api.post('/api/browse/saved', { name: name.trim(), search }))
        await loadConfig()
      }
    } else if (pick === '\u0000delete') {
      const name = await choose('Delete saved search', names.map((n) => ({ label: n, value: n })))
      if (name) {
        await attempt(() => api.post('/api/browse/saved', { name }))
        await loadConfig()
      }
    } else setSearch(config.savedSearches[pick])
  }

  const filterBy = async () => {
    const what = await choose('Filter', [
      { label: 'Marked', value: 'tag:marked' },
      { label: 'Suspended', value: 'is:suspended' },
      { label: 'Buried', value: 'is:buried' },
      { label: 'New', value: 'is:new' },
      { label: 'Learning', value: 'is:learn' },
      { label: 'Review', value: 'is:review' },
      { label: 'Due', value: 'is:due' },
      { label: 'Added today', value: 'added:1' },
      { label: 'Studied today', value: 'rated:1' },
      { label: 'Flagged…', value: '\u0000flag' },
      { label: 'Tag…', value: '\u0000tag' },
      { label: 'Deck…', value: '\u0000deck' },
    ])
    if (!what) return
    if (what === '\u0000flag') {
      const f = await choose('Flag', flagNames.map((x) => ({ label: x.name, value: x.flag })))
      if (f) setSearch(`flag:${f}`)
    } else if (what === '\u0000tag') {
      const tags = await api.get<string[]>('/api/tags')
      const t = await choose('Tag', tags.map((x) => ({ label: x, value: x })))
      if (t) setSearch(`tag:"${t}"`)
    } else if (what === '\u0000deck') {
      const d = await chooseDeck('Deck', { allowFiltered: true })
      if (d) setSearch(`deck:"${d.name}"`)
    } else setSearch(what)
  }

  const renameFlag = async () => {
    const f = await choose('Rename flag', flagNames.map((x) => ({ label: x.name, value: x.flag })))
    if (!f) return
    const name = await prompt('Flag name', { initial: flagNames.find((x) => x.flag === f)?.name, ok: 'Rename' })
    if (name === null) return
    await attempt(() => api.post('/api/flags/rename', { flag: f, name }))
    resetFlagNames()
    setFlagNames(await getFlagNames())
  }

  const [openOverflow, overflowMenu] = useMenu((): MenuItem[] => [
    { label: config?.notesMode ? 'Show cards' : 'Show notes', icon: 'swap', onClick: () => setMode(!config?.notesMode) },
    { label: 'Filter…', icon: 'filter', onClick: filterBy },
    { label: 'Saved searches', icon: 'starBorder', onClick: savedSearches },
    { label: 'Sort by…', icon: 'sort', onClick: chooseSort },
    { label: 'Columns…', icon: 'list', onClick: chooseColumns },
    { label: 'Select all', icon: 'selectAll', onClick: () => setSelected(new Set(ids)) },
    { label: 'Create filtered deck', icon: 'filter', onClick: actions.filteredDeck },
    { label: 'Rename flags', icon: 'flag', onClick: renameFlag },
    { label: 'Preview all', icon: 'eye', onClick: () => {
      sessionStorage.setItem('preview-cards', JSON.stringify(config?.notesMode ? [] : ids))
      if (!config?.notesMode) navigate('/preview?list=1')
    } },
  ])
  const [openSelMenu, selMenu] = useMenu(selectionMenu)

  const openRow = async (id: number) => {
    if (config?.notesMode) navigate(`/note/${id}`)
    else {
      const c = await attempt(() => api.get<{ noteId: number }>(`/api/cards/${id}`))
      if (c) navigate(`/note/${c.noteId}`)
    }
  }

  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const activeCols = useMemo(
    () => (config ? config.active.map((k) => config.columns.find((c) => c.key === k) ?? { key: k, label: k, sortable: false, tooltip: '' }) : []),
    [config],
  )

  return (
    <div className="screen">
      {selecting ? (
        <AppBar title={`${selected.size} selected`} nav="close" onNav={() => setSelected(new Set())}>
          <IconButton icon="flag" label="Flag" onClick={(e) => setRowMenu({ id: -1, at: { x: e.clientX, y: e.clientY } })} />
          <IconButton icon="delete" label="Delete" onClick={actions.del} />
          <IconButton icon="more" label="More" onClick={openSelMenu} />
        </AppBar>
      ) : searchOpen ? (
        <AppBar
          title={
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setSearch(editing.trim() || config?.defaultSearch || '')
                setSearchOpen(false)
              }}
            >
              <input
                className="deck-search"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                placeholder="Search"
                value={editing}
                onChange={(e) => setEditing(e.target.value)}
              />
            </form>
          }
          nav="back"
          onNav={() => setSearchOpen(false)}
        >
          <IconButton icon="search" label="Search" onClick={() => {
            setSearch(editing.trim() || config?.defaultSearch || '')
            setSearchOpen(false)
          }} />
        </AppBar>
      ) : (
        <AppBar title="Browse" subtitle={search ?? ''} nav="menu" onNav={onMenu}>
          <IconButton icon="search" label="Search" onClick={() => {
            setEditing(search ?? '')
            setSearchOpen(true)
          }} />
          <IconButton icon="add" label="Add" onClick={() => navigate('/note/add')} />
          <IconButton icon="more" label="More" onClick={openOverflow} />
        </AppBar>
      )}
      {loading && <div className="progress-bar" />}
      <div className="browser-summary">
        {config && (
          <span>
            {ids.length} {config.notesMode ? 'notes' : 'cards'}
          </span>
        )}
      </div>
      {config && (
        <div className="browser-header">
          {activeCols.map((c) => (
            <button key={c.key} className="browser-th" onClick={() => sortBy(c.key)}>
              {c.label}
              {config.sortColumn === c.key && <span className="sort-arrow">{config.sortReverse ? '▼' : '▲'}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="screen-body browser-list" ref={list} onScroll={onScroll}>
        {error && <div className="center-message">{error}</div>}
        {!loading && !error && ids.length === 0 && search !== null && <div className="center-message">No cards found</div>}
        {ids.slice(0, visible).map((id) => (
          <BrowserRow
            key={id}
            row={rows.get(id)}
            cols={activeCols.length}
            selected={selected.has(id)}
            onTap={() => (selecting ? toggle(id) : void openRow(id))}
            onLongPress={(at) => (selecting ? toggle(id) : setRowMenu({ id, at }))}
          />
        ))}
      </div>
      {overflowMenu}
      {selMenu}
      {rowMenu && rowMenu.id === -1 && <Menu anchor={rowMenu.at} items={flagItems(actions.flag)} onClose={() => setRowMenu(null)} />}
      {rowMenu && rowMenu.id !== -1 && (
        <Menu
          anchor={rowMenu.at}
          items={[
            { label: 'Select', icon: 'check', onClick: () => setSelected(new Set([rowMenu.id])) },
            { label: 'Edit note', icon: 'edit', onClick: () => openRow(rowMenu.id) },
            {
              label: 'Preview',
              icon: 'eye',
              hidden: config?.notesMode,
              onClick: () => {
                sessionStorage.setItem('preview-cards', JSON.stringify(ids))
                navigate(`/preview?list=1&start=${rowMenu.id}`)
              },
            },
            { label: 'Card info', icon: 'info', hidden: config?.notesMode, onClick: () => navigate(`/page/card-info/${rowMenu.id}`) },
          ]}
          onClose={() => setRowMenu(null)}
        />
      )}
    </div>
  )
}

function BrowserRow({
  row,
  cols,
  selected,
  onTap,
  onLongPress,
}: {
  row: Row | undefined
  cols: number
  selected: boolean
  onTap: () => void
  onLongPress: (at: { x: number; y: number }) => void
}) {
  const press = useLongPress(onLongPress)
  return (
    <div
      className={`browser-row${row?.color ? ` c-${row.color}` : ''}${selected ? ' selected' : ''}`}
      {...press.handlers}
      onClick={() => !press.consumed() && onTap()}
    >
      {selected && <Icon name="check" className="row-check" />}
      {row
        ? row.cells.map((c, i) => <div key={i} className="browser-td">{c}</div>)
        : Array.from({ length: cols }, (_, i) => <div key={i} className="browser-td placeholder" />)}
    </div>
  )
}
