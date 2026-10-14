/** A deck's long-press menu (AnkiDroid's DeckPickerContextMenu). */

import { api, type DeckNode } from '../api'
import { navigate } from '../router'
import { attempt, confirm, prompt, toast, type MenuItem } from '../ui/components'
import { customStudy } from './CustomStudy'
import { exportDialog } from './ImportExport'

export function deckActions(deck: DeckNode, reload: () => void): MenuItem[] {
  const done = (msg?: string) => {
    if (msg) toast(msg)
    reload()
  }
  return [
    {
      label: 'Add',
      icon: 'add',
      onClick: () => navigate(`/note/add?deck=${deck.id}`),
    },
    {
      label: 'Browse cards',
      icon: 'search',
      onClick: () => navigate(`/browse?deck=${deck.id}`),
    },
    {
      label: 'Rename deck',
      icon: 'edit',
      onClick: async () => {
        const full = await api.get<{ name: string }>(`/api/decks/${deck.id}`)
        const name = await prompt('Rename deck', { initial: full.name, ok: 'Rename' })
        if (name && name !== full.name) {
          if (await attempt(() => api.post(`/api/decks/${deck.id}/rename`, { name }))) done()
        }
      },
    },
    {
      label: 'Deck options',
      icon: 'settings',
      hidden: deck.filtered,
      onClick: () => navigate(`/page/deck-options/${deck.id}`),
    },
    {
      label: 'Options',
      icon: 'settings',
      hidden: !deck.filtered,
      onClick: () => navigate(`/filtered/${deck.id}`),
    },
    {
      label: 'Custom study',
      icon: 'school',
      hidden: deck.filtered,
      onClick: () => void customStudy(deck.id).then((made) => made && navigate(`/deck/${made}`)),
    },
    {
      label: 'Rebuild',
      icon: 'sync',
      hidden: !deck.filtered,
      onClick: async () => {
        const res = await attempt(() => api.post<{ count: number }>(`/api/decks/${deck.id}/rebuild`))
        if (res) done(`${res.count} cards`)
      },
    },
    {
      label: 'Empty',
      icon: 'close',
      hidden: !deck.filtered,
      onClick: async () => {
        if (await attempt(() => api.post(`/api/decks/${deck.id}/empty`))) done('Emptied')
      },
    },
    {
      label: 'Unbury',
      icon: 'bury',
      onClick: async () => {
        if (await attempt(() => api.post(`/api/decks/${deck.id}/unbury`, { mode: 'all' }))) done('Unburied')
      },
    },
    {
      label: 'Edit description',
      icon: 'info',
      onClick: async () => {
        const full = await api.get<{ description: string; markdownDescription: boolean }>(`/api/decks/${deck.id}`)
        const text = await prompt('Description', { initial: full.description, multiline: true, ok: 'Save' })
        if (text !== null) {
          await attempt(() => api.post(`/api/decks/${deck.id}/description`, { description: text, markdown: full.markdownDescription }))
        }
      },
    },
    {
      label: 'Statistics',
      icon: 'stats',
      onClick: async () => {
        await api.get(`/api/decks/${deck.id}`)
        navigate('/page/graphs?search=deck:current')
      },
    },
    {
      label: 'Export deck',
      icon: 'upload',
      onClick: () => exportDialog({ deckId: deck.id }),
    },
    'separator',
    {
      label: 'Delete deck',
      icon: 'delete',
      onClick: async () => {
        const ok = await confirm(
          deck.total > 0
            ? `Delete deck “${deck.name}” and its ${deck.total} cards? You can undo this.`
            : `Delete deck “${deck.name}”?`,
          { ok: 'Delete', danger: true },
        )
        if (!ok) return
        const res = await attempt(() => api.del<{ removedCards: number }>(`/api/decks/${deck.id}`))
        if (res) {
          toast(`Deck deleted (${res.removedCards} cards)`, {
            label: 'Undo',
            run: async () => {
              await attempt(() => api.post('/api/undo'))
              reload()
            },
          })
          reload()
        }
      },
    },
  ]
}
