/** A note type's fields (AnkiDroid's NoteTypeFieldEditor), plus desktop's field options. */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { goBack } from '../router'
import { AppBar, attempt, confirm, Dialog, IconButton, Menu, prompt, showDialog, toast } from '../ui/components'
import { Icon } from '../ui/icons'
import { confirmSchemaChange } from './schema'
import './forms.css'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Field = Record<string, any> & { name: string; ord: number | null }
type Notetype = Record<string, any> & { id: number; name: string; flds: Field[]; sortf: number }

export default function FieldsEditor({ notetypeId }: { notetypeId: number }) {
  const [nt, setNt] = useState<Notetype | null>(null)
  const [menu, setMenu] = useState<{ index: number; at: { x: number; y: number } } | null>(null)

  const load = useCallback(async () => {
    const r = await api.get<{ notetype: Notetype }>(`/api/notetypes/${notetypeId}`)
    setNt(r.notetype)
  }, [notetypeId])
  useEffect(() => {
    void load()
  }, [load])

  /** Apply a change to a copy and save it right away, as AnkiDroid does. */
  const save = async (change: (n: Notetype) => void, schema = true): Promise<boolean> => {
    if (!nt) return false
    if (schema && !(await confirmSchemaChange())) return false
    const copy: Notetype = JSON.parse(JSON.stringify(nt))
    change(copy)
    const ok = await attempt(() => api.post(`/api/notetypes/${notetypeId}/save`, { notetype: copy }))
    await load()
    return !!ok
  }

  const unique = (name: string, except?: number) =>
    !nt!.flds.some((f, i) => i !== except && f.name.toLowerCase() === name.toLowerCase())

  const add = async () => {
    const name = (await prompt('Add field', { label: 'Field name', ok: 'Add' }))?.trim()
    if (!name) return
    if (!unique(name)) return toast('That field name is already used')
    const field = await api.get<Field>(`/api/notetypes/${notetypeId}/new-field?name=${encodeURIComponent(name)}`)
    if (await save((n) => n.flds.push(field))) toast('Field added')
  }

  const rename = async (i: number) => {
    const name = (await prompt('Rename field', { initial: nt!.flds[i].name, ok: 'Rename' }))?.trim()
    if (!name || name === nt!.flds[i].name) return
    if (!unique(name, i)) return toast('That field name is already used')
    // Templates referring to the field are updated by the backend when saving.
    await save((n) => (n.flds[i].name = name), false)
  }

  const reposition = async (i: number) => {
    const pos = Number(await prompt('Reposition field', { label: `New position (1–${nt!.flds.length})`, initial: String(i + 1), inputMode: 'numeric' }))
    if (!pos || pos < 1 || pos > nt!.flds.length || pos === i + 1) return
    await save((n) => {
      const sortName = n.flds[n.sortf]?.name
      const [f] = n.flds.splice(i, 1)
      n.flds.splice(pos - 1, 0, f)
      n.sortf = Math.max(0, n.flds.findIndex((x) => x.name === sortName))
    })
  }

  const remove = async (i: number) => {
    if (nt!.flds.length < 2) return toast('A note type needs at least one field')
    if (!(await confirm(`Delete field “${nt!.flds[i].name}”? Its content will be lost from every note of this type.`, { ok: 'Delete', danger: true }))) return
    await save((n) => {
      const sortName = n.flds[n.sortf]?.name
      n.flds.splice(i, 1)
      n.sortf = Math.max(0, n.flds.findIndex((x) => x.name === sortName))
    })
  }

  const options = (i: number) =>
    showDialog((close) => <FieldOptions field={nt!.flds[i]} close={close} save={(f) => save((n) => (n.flds[i] = f), false)} />)

  return (
    <div className="screen">
      <AppBar title="Fields" subtitle={nt?.name} nav="back" onNav={() => goBack('/notetypes')}>
        <IconButton icon="add" label="Add field" onClick={add} />
      </AppBar>
      <div className="screen-body">
        {!nt && <div className="spinner" />}
        {nt?.flds.map((f, i) => (
          <div key={`${f.ord}-${f.name}`} className="list-row" onClick={(e) => setMenu({ index: i, at: { x: e.clientX, y: e.clientY } })}>
            <div className="main">
              <div className="title">{f.name}</div>
              <div className="sub">
                {i === nt.sortf ? 'Sort field · ' : ''}
                {f.font} {f.size}
                {f.sticky ? ' · sticky' : ''}
                {f.rtl ? ' · RTL' : ''}
                {f.plainText ? ' · plain text' : ''}
              </div>
            </div>
            <Icon name="more" />
          </div>
        ))}
      </div>
      {menu && nt && (
        <Menu
          anchor={menu.at}
          items={[
            { label: 'Rename', icon: 'edit', onClick: () => rename(menu.index) },
            { label: 'Reposition', icon: 'sort', onClick: () => reposition(menu.index) },
            { label: 'Sort by this field in the browser', icon: 'sort', disabled: nt.sortf === menu.index, onClick: () => save((n) => (n.sortf = menu.index)) },
            { label: 'Options…', icon: 'settings', onClick: () => options(menu.index) },
            { label: 'Delete', icon: 'delete', onClick: () => remove(menu.index) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function FieldOptions({ field, close, save }: { field: Field; close: () => void; save: (f: Field) => Promise<boolean> }) {
  const [f, setF] = useState<Field>({ ...field })
  const bool = (key: string, label: string) => (
    <label className="check-row">
      <input type="checkbox" checked={!!f[key]} onChange={(e) => setF({ ...f, [key]: e.target.checked })} />
      {label}
    </label>
  )
  return (
    <Dialog
      title={`Options: ${field.name}`}
      onClose={close}
      actions={
        <>
          <button className="text-btn" onClick={close}>
            Cancel
          </button>
          <button className="text-btn" onClick={async () => (await save(f)) && close()}>
            Save
          </button>
        </>
      }
    >
      <div className="form-row">
        <label className="field">
          <span>Editing font</span>
          <input value={f.font} onChange={(e) => setF({ ...f, font: e.target.value })} />
        </label>
        <label className="field" style={{ flex: '0 0 90px' }}>
          <span>Size</span>
          <input inputMode="numeric" value={f.size} onChange={(e) => setF({ ...f, size: Number(e.target.value) || 20 })} />
        </label>
      </div>
      <label className="field">
        <span>Description (shown in the editor when empty)</span>
        <input value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
      {bool('sticky', 'Remember last input when adding')}
      {bool('rtl', 'Right-to-left text')}
      {bool('plainText', 'Use HTML editor by default')}
      {bool('collapsed', 'Collapse by default')}
      {bool('excludeFromSearch', 'Exclude from unqualified searches')}
      {bool('preventDeletion', 'Prevent deletion')}
    </Dialog>
  )
}
