/**
 * The backend calls Anki's own pages make (`POST /_anki/<method>`, protobuf in and out),
 * answered in the browser. Port of server/anki_pages.py: most go straight to the engine,
 * limited to the list desktop exposes to its pages (aqt/mediasrv.py); the rest are
 * the few the Qt host answers itself.
 *
 * The calls only a user interface can answer (file pickers, recording, dialogs) are
 * answered by the screen showing the page: see screens/pageHost.tsx.
 */

import { callRaw } from '../engine/client'
import { Json, String as PbString } from '../engine/generated/anki/generic_pb'
import {
  ConvertPastedImageRequest,
  ConvertPastedImageResponse,
  SchedulingStatesWithContext,
  SetSchedulingStatesRequest,
  SetSettingJsonRequest,
} from '../engine/generated/anki/frontend_pb'
import { ChangeNotetypeRequest } from '../engine/generated/anki/notetypes_pb'
import { be, clearCaches, fromJsonBytes, getConfigRaw, toJsonBytes } from './col'
import { bigs } from './http'
import { takeChangeNotetypeNoteIds } from './routes/notetypes'
import { resetReview, reviewSession } from './routes/review'

/** Engine methods the pages may call: upstream's exposed_backend_list. */
const EXPOSED = new Set([
  'latestProgress', 'getCustomColours',
  'getDeckNames', 'getDeck',
  'i18nResources',
  'getCsvMetadata', 'getImportAnkiPackagePresets', 'importCsv',
  'importAnkiPackage', 'importJsonFile', 'importJsonString',
  'getFieldNames', 'getNote', 'newNote', 'noteFieldsCheck', 'defaultsForAdding',
  'defaultDeckForNotetype', 'addNote', 'updateNotes', 'updateNotetype',
  'getNotetype', 'getNotetypeNames', 'getChangeNotetypeInfo', 'getClozeFieldOrds',
  'cardStats', 'getReviewLogs', 'graphs', 'getGraphPreferences', 'setGraphPreferences',
  'completeTag',
  'getImageForOcclusion', 'addImageOcclusionNote', 'getImageOcclusionNote',
  'updateImageOcclusionNote', 'getImageOcclusionFields',
  'computeFsrsParams', 'computeOptimalRetention', 'setWantsAbort',
  'evaluateParamsLegacy', 'getOptimalRetentionParameters', 'simulateFsrsReview',
  'simulateFsrsWorkload',
  'getIgnoredBeforeCount', 'getRetentionWorkload',
  'encodeIriPaths', 'decodeIriPaths', 'htmlToTextLine',
  'setConfigJson', 'getConfigBool',
  'addMediaFile', 'addMediaFromUrl', 'addMediaFromPath', 'getAbsoluteMediaPath',
  'extractMediaFiles',
  'getCard',
  'congratsInfo', 'getDeckConfigsForUpdate', 'updateDeckConfigs',
])

/** Calls that change note types or deck options: cached copies are stale after them. */
const INVALIDATES = new Set(['updateNotetype', 'updateDeckConfigs', 'importAnkiPackage', 'importCsv', 'importJsonFile', 'importJsonString'])

type Host = (data: Uint8Array) => Promise<Uint8Array> | Uint8Array

const EMPTY = new Uint8Array()

/** What desktop keeps in its profile (per device, not synced). */
const PROFILE_KEY = 'anki-profile-config'
function profile(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

const jsonOut = (v: unknown) => new Json({ json: toJsonBytes(v === undefined ? null : v) }).toBinary()

const HOST: Record<string, Host> = {
  getConfigJson: async (data) => jsonOut(await getConfigRaw(PbString.fromBinary(data).val)),
  getProfileConfigJson: (data) => jsonOut(profile()[PbString.fromBinary(data).val] ?? null),
  setProfileConfigJson: (data) => {
    const req = SetSettingJsonRequest.fromBinary(data)
    const p = profile()
    p[req.key] = fromJsonBytes(req.valueJson)
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
    return EMPTY
  },
  getMetaJson: () => jsonOut(null),
  setMetaJson: () => EMPTY,
  getSchedulingStatesWithContext: () => {
    const s = reviewSession()
    if (!s) return new SchedulingStatesWithContext().toBinary()
    return new SchedulingStatesWithContext({ states: s.states, context: s.context }).toBinary()
  },
  setSchedulingStates: (data) => {
    const req = SetSchedulingStatesRequest.fromBinary(data)
    const s = reviewSession()
    // The key is per review session: a stale page can't change the next card's states.
    if (s && req.key === s.key && req.states) s.states = req.states
    return EMPTY
  },
  // Desktop re-encodes with Qt; the browser already hands over PNG or JPEG, kept as is.
  convertPastedImage: (data) => new ConvertPastedImageResponse({ data: ConvertPastedImageRequest.fromBinary(data).data }).toBinary(),
  // The page leaves out which notes to change; the app said so when opening it.
  changeNotetype: async (data) => {
    const req = ChangeNotetypeRequest.fromBinary(data)
    const nids = takeChangeNotetypeNoteIds()
    if (!nids?.length) throw new Error('No notes were chosen for changing the note type.')
    req.noteIds = bigs(nids)
    await be.changeNotetype(req)
    clearCaches()
    resetReview()
    return EMPTY
  },
  // Signals to the host; the screen showing the page hears them (pageHost.tsx).
  deckOptionsReady: () => EMPTY,
  deckOptionsRequireClose: () => EMPTY,
  importDone: () => EMPTY,
  importDialogRequireClose: () => EMPTY,
  closeAddCards: () => EMPTY,
  closeEditCurrent: () => EMPTY,
  saveCustomColours: () => EMPTY,
  openFieldsDialog: () => EMPTY,
  openCardsDialog: () => EMPTY,
  showInMediaFolder: () => EMPTY,
}

/** Answer a page's backend call; throws for methods pages may not call. */
export async function pageCall(method: string, data: Uint8Array): Promise<Uint8Array> {
  const host = HOST[method]
  if (host) return host(data)
  if (!EXPOSED.has(method)) throw new Error(`${method} not found`)
  const out = await callRaw(method, data)
  if (INVALIDATES.has(method)) {
    clearCaches()
    resetReview()
  }
  return out
}

export function isPageMethod(method: string) {
  return method in HOST || EXPOSED.has(method)
}
