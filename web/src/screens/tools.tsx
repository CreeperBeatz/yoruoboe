/** The deck list's overflow menu: checks, empty cards, backups, note types, import/export. */

import { useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { alertDialog, attempt, confirm, Dialog, showDialog, toast, type MenuItem } from '../ui/components'
import { exportDialog } from './ImportExport'
import './forms.css'

export function collectionTools(reload: () => void): MenuItem[] {
  return [
    {
      label: 'Check',
      icon: 'build',
      submenu: [
        { label: 'Check database', onClick: () => void checkDatabase(reload) },
        { label: 'Check media', onClick: () => void checkMedia() },
        { label: 'Empty cards', onClick: () => void emptyCards(reload) },
      ],
    },
    { label: 'Create backup', icon: 'download', onClick: () => void createBackup() },
    { label: 'Restore from backup', icon: 'reset', onClick: () => void restoreBackup(reload) },
    { label: 'Manage note types', icon: 'cards', onClick: () => navigate('/notetypes') },
    { label: 'Import', icon: 'upload', onClick: () => navigate('/import-export') },
    { label: 'Export collection', icon: 'share', onClick: () => exportDialog({}) },
  ]
}

async function checkDatabase(reload: () => void) {
  if (!(await confirm('Check the collection for problems and fix them? This may take a while.', { title: 'Check database', ok: 'Check' }))) return
  toast('Checking…')
  const res = await attempt(() => api.post<{ report: string; ok: boolean }>('/api/check-database'))
  if (res) await alertDialog(<div className="report">{res.report}</div>, res.ok ? 'Database rebuilt and optimized' : 'Problems found')
  reload()
}

interface MediaReport {
  report: string
  unused: string[]
  missing: string[]
  missingNotes: number[]
  haveTrash: boolean
}

async function checkMedia() {
  toast('Checking media…')
  const res = await attempt(() => api.post<MediaReport>('/api/check-media'))
  if (!res) return
  showDialog((close) => <MediaCheck report={res} close={close} />)
}

function MediaCheck({ report, close }: { report: MediaReport; close: () => void }) {
  const [r, setR] = useState(report)
  const deleteUnused = async () => {
    if (!(await confirm(`Move ${r.unused.length} unused files to the media trash?`, { ok: 'Delete', danger: true }))) return
    if (await attempt(() => api.post('/api/media/trash-unused', { names: r.unused }))) {
      toast('Unused media moved to trash')
      setR({ ...r, unused: [], haveTrash: true })
    }
  }
  const tagMissing = async () => {
    if (await attempt(() => api.post('/api/notes/tags', { noteIds: r.missingNotes, add: 'missing-media' }))) toast(`Tagged ${r.missingNotes.length} notes`)
  }
  return (
    <Dialog
      title="Check media"
      wide
      onClose={close}
      actions={
        <>
          {r.haveTrash && (
            <>
              <button className="text-btn" onClick={async () => (await attempt(() => api.post('/api/media/restore-trash'))) && (toast('Trash restored'), setR({ ...r, haveTrash: false }))}>
                Restore trash
              </button>
              <button className="text-btn" onClick={async () => (await attempt(() => api.post('/api/media/empty-trash'))) && (toast('Trash emptied'), setR({ ...r, haveTrash: false }))}>
                Empty trash
              </button>
            </>
          )}
          {r.missingNotes.length > 0 && (
            <button className="text-btn" onClick={tagMissing}>
              Tag missing
            </button>
          )}
          {r.unused.length > 0 && (
            <button className="text-btn danger" onClick={deleteUnused}>
              Delete unused
            </button>
          )}
          <button className="text-btn" onClick={close}>
            Close
          </button>
        </>
      }
    >
      <div className="report">{r.report}</div>
    </Dialog>
  )
}

async function emptyCards(reload: () => void) {
  const res = await attempt(() => api.get<{ report: string; notes: { willDeleteNote: boolean }[] }>('/api/empty-cards'))
  if (!res) return
  if (!res.notes.length) return void alertDialog('No empty cards.', 'Empty cards')
  showDialog((close) => <EmptyCards report={res.report} close={close} reload={reload} />)
}

function EmptyCards({ report, close, reload }: { report: string; close: () => void; reload: () => void }) {
  const [keepNotes, setKeep] = useState(true)
  return (
    <Dialog
      title="Empty cards"
      wide
      onClose={close}
      actions={
        <>
          <button className="text-btn" onClick={close}>
            Cancel
          </button>
          <button
            className="text-btn danger"
            onClick={async () => {
              close()
              const r = await attempt(() => api.post<{ count: number }>('/api/empty-cards', { keepNotes }))
              if (r) {
                toast(`${r.count} cards deleted`, { label: 'Undo', run: async () => (await attempt(() => api.post('/api/undo')), reload()) })
                reload()
              }
            }}
          >
            Delete
          </button>
        </>
      }
    >
      <label className="check-row">
        <input type="checkbox" checked={keepNotes} onChange={(e) => setKeep(e.target.checked)} />
        Keep notes with no valid cards
      </label>
      <div className="report" dangerouslySetInnerHTML={{ __html: report }} />
    </Dialog>
  )
}

async function createBackup() {
  const r = await attempt(() => api.post<{ created: boolean }>('/api/backups'))
  if (r) toast(r.created ? 'Backup created' : 'Backup unchanged')
}

async function restoreBackup(reload: () => void) {
  const list = await attempt(() => api.get<{ name: string; time: number; size: number }[]>('/api/backups'))
  if (!list) return
  if (!list.length) return void alertDialog('There are no backups yet.', 'Restore from backup')
  showDialog((close) => (
    <Dialog
      title="Restore from backup"
      onClose={close}
      actions={
        <button className="text-btn" onClick={close}>
          Cancel
        </button>
      }
    >
      <p style={{ marginTop: 0 }}>Restoring replaces the collection; the next sync then replaces the server’s copy too.</p>
      <div style={{ margin: '0 -24px' }}>
        {list.map((b) => (
          <button
            key={b.name}
            className="menu-item"
            style={{ paddingLeft: 24 }}
            onClick={async () => {
              if (!(await confirm(`Replace the collection with the backup from ${new Date(b.time * 1000).toLocaleString()}?`, { ok: 'Restore', danger: true }))) return
              close()
              if (await attempt(() => api.post('/api/backups/restore', { name: b.name }))) {
                toast('Backup restored')
                reload()
              }
            }}
          >
            {new Date(b.time * 1000).toLocaleString()} · {(b.size / 1024 / 1024).toFixed(1)} MB
          </button>
        ))}
      </div>
    </Dialog>
  ))
}
