/** Manage note types (AnkiDroid's ManageNotetypes). */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { goBack, navigate } from '../router'
import { AppBar, attempt, choose, confirm, IconButton, Menu, prompt, toast, useLongPress } from '../ui/components'
import { Icon } from '../ui/icons'
import { confirmSchemaChange } from './schema'
import './forms.css'

interface Nt {
  id: number
  name: string
  useCount: number
  cloze: boolean
  io: boolean
  fields: string[]
  templates: string[]
}

export default function Notetypes() {
  const [list, setList] = useState<Nt[] | null>(null)
  const [menu, setMenu] = useState<{ nt: Nt; at: { x: number; y: number } } | null>(null)
  const load = useCallback(async () => setList(await api.get<Nt[]>('/api/notetypes')), [])
  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    const stock = await api.get<{ key: string; name: string }[]>('/api/notetypes/stock')
    const key = await choose('Add note type', stock.map((s) => ({ label: s.name, value: s.key })))
    if (!key) return
    const base = stock.find((s) => s.key === key)!.name.replace(/^(Add|Clone): /, '')
    const name = await prompt('Name', { initial: `${base}${key.startsWith('clone') ? ' copy' : ''}`, ok: 'Add' })
    if (!name?.trim()) return
    if (await attempt(() => api.post('/api/notetypes', { key, name }))) {
      toast('Note type added')
      void load()
    }
  }

  const rename = async (nt: Nt) => {
    const name = await prompt('Rename note type', { initial: nt.name, ok: 'Rename' })
    if (name?.trim() && name !== nt.name && (await attempt(() => api.post(`/api/notetypes/${nt.id}/rename`, { name })))) void load()
  }

  const remove = async (nt: Nt) => {
    if (!(await confirm(`Delete “${nt.name}” and its ${nt.useCount} notes?`, { ok: 'Delete', danger: true }))) return
    if (!(await confirmSchemaChange())) return
    if (await attempt(() => api.del(`/api/notetypes/${nt.id}`))) {
      toast('Note type deleted')
      void load()
    }
  }

  return (
    <div className="screen">
      <AppBar title="Note types" nav="back" onNav={() => goBack('/')}>
        <IconButton icon="add" label="Add" onClick={add} />
      </AppBar>
      <div className="screen-body">
        {!list && <div className="spinner" />}
        {list?.map((nt) => (
          <NtRow key={nt.id} nt={nt} onMenu={(at) => setMenu({ nt, at })} />
        ))}
      </div>
      {menu && (
        <Menu
          anchor={menu.at}
          items={[
            { label: 'Fields', icon: 'list', onClick: () => navigate(`/notetypes/${menu.nt.id}/fields`) },
            { label: 'Cards', icon: 'cards', onClick: () => navigate(`/notetypes/${menu.nt.id}/templates`) },
            { label: 'Rename', icon: 'edit', onClick: () => rename(menu.nt) },
            { label: 'Browse notes', icon: 'search', onClick: () => navigate(`/browse?search=${encodeURIComponent(`note:"${menu.nt.name}"`)}`) },
            { label: 'Delete', icon: 'delete', onClick: () => remove(menu.nt) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function NtRow({ nt, onMenu }: { nt: Nt; onMenu: (at: { x: number; y: number }) => void }) {
  const press = useLongPress(onMenu)
  return (
    <div className="list-row" {...press.handlers} onClick={(e) => !press.consumed() && onMenu({ x: e.clientX, y: e.clientY })}>
      <div className="main">
        <div className="title">{nt.name}</div>
        <div className="sub">
          {nt.useCount} notes · {nt.fields.length} fields · {nt.cloze ? 'cloze' : `${nt.templates.length} card types`}
        </div>
      </div>
      <Icon name="more" />
    </div>
  )
}
