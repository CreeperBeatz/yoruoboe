import { api } from '../api'
import { confirm } from '../ui/components'

/**
 * Changing fields, templates or note types alters the collection's schema: the next sync
 * must then replace one side entirely. Desktop and AnkiDroid ask first; so do we, unless
 * a full sync is already due.
 */
export async function confirmSchemaChange(): Promise<boolean> {
  const { needed } = await api.get<{ needed: boolean }>('/api/schema-change-needs-full-sync')
  if (!needed) return true
  return confirm(
    'This change requires a one-way sync: the next sync will upload this collection and replace the copy on the server. Changes made on other devices since their last sync will be lost.',
    { title: 'One-way sync', ok: 'Continue' },
  )
}
