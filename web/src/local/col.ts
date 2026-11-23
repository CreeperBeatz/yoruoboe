/**
 * The collection on this device, and what pylib's Collection offered the server: config,
 * decks, note types, cards, rendering. Each helper is the same backend call pylib makes
 * (see engine/anki/pylib/anki/), so behaviour matches desktop Anki.
 */

import { BackendError, ErrorKind, onEngineCrash, startEngine } from '../engine/client'
import * as be from '../engine/generated/backend'
import type { Card } from '../engine/generated/anki/cards_pb'
import { ConfigKey_Bool, ConfigKey_String } from '../engine/generated/anki/config_pb'
import type { StorageMode } from '../engine/protocol'
import { big } from './http'

export { be }

/** The Anki release the engine is built from (engine/anki); sync needs desktop and AnkiDroid to match. */
export const ANKI_VERSION = __ANKI_VERSION__

// ---- the collection's files ------------------------------------------------------------

/** One profile per device, as AnkiDroid has. */
const DIR = '/profile'
export const COL_PATH = `${DIR}/collection.anki2`
export const MEDIA_DIR = `${DIR}/collection.media`
export const MEDIA_DB = `${DIR}/collection.media.db`
export const TMP_DIR = '/tmp'

let opened: Promise<StorageMode> | null = null
let isOpen = false
export let storage: StorageMode | null = null

/**
 * One copy of the app at a time: two would fight over the same storage. The lock is
 * held for as long as the page lives.
 */
async function claimStorage(): Promise<void> {
  if (!navigator.locks) return
  const got = await new Promise<boolean>((resolve) => {
    void navigator.locks.request('anki-collection', { ifAvailable: true }, (lock) => {
      resolve(lock !== null)
      return lock ? new Promise<void>(() => {}) : undefined
    })
  })
  if (!got) throw new Error('YoruOboe is open in another window or tab. Close it, then try again.')
}

/** Ask the browser not to clear the collection when space runs low (granted to home-screen apps). */
async function askToPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    // not supported: nothing to do
  }
}

let claimed: Promise<void> | null = null

/** Start the engine and open the collection, once. */
export function ready(): Promise<StorageMode> {
  if (!opened) {
    opened = (async () => {
      claimed ??= claimStorage().catch((err) => {
        claimed = null
        throw err
      })
      await claimed
      void askToPersist()
      const langs = navigator.languages?.length ? [...navigator.languages] : [navigator.language || 'en']
      // 'auto' unless set (for testing the IndexedDB store where OPFS works)
      const mode = (localStorage.getItem('anki-storage') as StorageMode | null) ?? 'auto'
      storage = await startEngine('anki', langs, mode)
      await openCollection()
      return storage
    })().catch((err) => {
      opened = null
      throw err
    })
  }
  return opened
}

const crashListeners = new Set<() => void>()
export const onCrash = (fn: () => void) => crashListeners.add(fn)

// A crashed engine is started again, and the collection reopened, on the next call.
onEngineCrash(() => {
  opened = null
  isOpen = false
  clearCaches()
  crashListeners.forEach((fn) => fn())
})

export async function openCollection() {
  if (isOpen) return
  await be.openCollection({ collectionPath: COL_PATH, mediaFolderPath: MEDIA_DIR, mediaDbPath: MEDIA_DB })
  isOpen = true
  clearCaches()
}

export async function closeCollection(downgrade = false) {
  if (!isOpen) return
  isOpen = false
  await be.closeCollection({ downgradeToSchema11: downgrade })
}

// ---- caches (pylib keeps note types; the engine is a message away) ----------------------

const notetypeCache = new Map<number, NotetypeDict>()
const deckConfCache = new Map<number, DeckConfigDict>()

export function clearCaches() {
  notetypeCache.clear()
  deckConfCache.clear()
}

// ---- config -------------------------------------------------------------------------------

const enc = new TextEncoder()
const dec = new TextDecoder()

export function fromJsonBytes<T>(b: Uint8Array): T {
  return JSON.parse(dec.decode(b)) as T
}

export function toJsonBytes(v: unknown): Uint8Array<ArrayBuffer> {
  return enc.encode(JSON.stringify(v)) as Uint8Array<ArrayBuffer>
}

function isNotFound(err: unknown) {
  return err instanceof BackendError && err.kind === ErrorKind.NOT_FOUND_ERROR
}

/** col.get_config(key, default) */
export async function getConfig<T>(key: string, def: T): Promise<T> {
  try {
    return fromJsonBytes<T>((await be.getConfigJson({ val: key })).json)
  } catch (err) {
    if (isNotFound(err)) return def
    throw err
  }
}

/** The raw JSON, or null; for Anki's pages, which JSON.parse it. */
export async function getConfigRaw(key: string): Promise<unknown> {
  return getConfig<unknown>(key, null)
}

export async function setConfig(key: string, value: unknown, undoable = false) {
  await be.setConfigJson({ key, valueJson: toJsonBytes(value), undoable })
}

export async function configBool(key: ConfigKey_Bool): Promise<boolean> {
  return (await be.getConfigBool({ key })).val
}

export async function setConfigBool(key: ConfigKey_Bool, value: boolean) {
  await be.setConfigBool({ key, value, undoable: false })
}

export async function configString(key: ConfigKey_String): Promise<string> {
  return (await be.getConfigString({ key })).val
}

export { ConfigKey_Bool, ConfigKey_String }

export async function undoInfo() {
  const s = await be.getUndoStatus({})
  return { undo: s.undo, redo: s.redo }
}

// ---- decks --------------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeckDict = Record<string, any> & { id: number; name: string; dyn: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeckConfigDict = Record<string, any>

export async function deckLegacy(did: number): Promise<DeckDict | null> {
  try {
    return fromJsonBytes<DeckDict>((await be.getDeckLegacy({ did: big(did) })).json)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function updateDeckLegacy(deck: DeckDict) {
  await be.updateDeckLegacy({ json: toJsonBytes(deck) })
}

export async function deckName(did: number): Promise<string> {
  const d = await deckLegacy(did)
  return d ? d.name : '[no deck]'
}

export async function deckIdForName(name: string): Promise<number | null> {
  try {
    return Number((await be.getDeckIdByName({ val: name })).did)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function currentDeckId(): Promise<number> {
  return Number((await be.getCurrentDeck({})).id)
}

export async function selectDeck(did: number) {
  await be.setCurrentDeck({ did: big(did) })
}

/** decks.config_dict_for_deck_id: the deck's options, or a filtered deck's own. */
export async function deckConfigForDeck(did: number): Promise<DeckConfigDict> {
  const deck = await deckLegacy(did)
  if (!deck) throw new Error(`no deck ${did}`)
  if ('conf' in deck) {
    const dcid = Number(deck.conf)
    let conf = deckConfCache.get(dcid)
    if (!conf) {
      try {
        conf = fromJsonBytes<DeckConfigDict>((await be.getDeckConfigLegacy({ dcid: big(dcid) })).json)
      } catch (err) {
        if (!isNotFound(err)) throw err
        conf = fromJsonBytes<DeckConfigDict>((await be.getDeckConfigLegacy({ dcid: 1n })).json)
      }
      deckConfCache.set(dcid, conf)
    }
    return { ...conf, dyn: false }
  }
  return deck
}

export function forgetDeckConfigs() {
  deckConfCache.clear()
}

// ---- note types ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotetypeDict = Record<string, any> & {
  id: number
  name: string
  type: number
  flds: { name: string; ord: number; font: string; size: number; [k: string]: unknown }[]
  tmpls: { name: string; ord: number; qfmt: string; afmt: string; [k: string]: unknown }[]
  css: string
}

export async function notetypeLegacy(ntid: number): Promise<NotetypeDict | null> {
  const hit = notetypeCache.get(ntid)
  if (hit) return hit
  try {
    const nt = fromJsonBytes<NotetypeDict>((await be.getNotetypeLegacy({ ntid: big(ntid) })).json)
    notetypeCache.set(ntid, nt)
    return nt
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** models.update_dict */
export async function updateNotetypeLegacy(nt: NotetypeDict, skipChecks = false) {
  notetypeCache.delete(Number(nt.id))
  await be.updateNotetypeLegacy({ json: toJsonBytes(nt), skipChecks })
}

export function forgetNotetypes() {
  notetypeCache.clear()
}

// ---- cards and notes ----------------------------------------------------------------------

export async function getCard(cid: number): Promise<Card> {
  return be.getCard({ cid: big(cid) })
}

export async function getNote(nid: number) {
  return be.getNote({ nid: big(nid) })
}

export const userFlag = (c: Card) => c.flags & 0b111
export const currentDeckOf = (c: Card) => Number(c.originalDeckId || c.deckId)

export async function noteCardIds(nid: number): Promise<number[]> {
  return (await be.cardsOfNote({ nid: big(nid) })).cids.map(Number)
}

export function hasTag(tags: string[], tag: string) {
  const t = tag.toLowerCase()
  return tags.some((x) => x.toLowerCase() === t)
}

// ---- db -----------------------------------------------------------------------------------

export { dbCommand } from '../engine/client'
