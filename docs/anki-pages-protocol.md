# Report: hosting Anki 26.09.3 web UIs from FastAPI + pylib (no Qt)

> **How this app does it now.** This report was written for the first, server-based
> version (`legacy/`). The protocol is the same; what answers it moved into the browser:
>
> - `POST /_anki/<method>` from a page is caught by `web/public/anki-host.js` and sent to
>   the app around the frame, which answers from the engine (`web/src/local/pages.ts`:
>   the same exposed list and host handlers as desktop's mediasrv).
> - The pages' URLs (`/deck-options/…`, `/editor/…`) are served their shell by the
>   service worker (`web/sw.template.js`; `deploy/serve.py` and `_redirects` on first
>   load), `/editor/_anki/…` maps to `/_anki/…`, and media for the pages
>   (`/editor/foo.jpg`, `/media/…`) is read from the engine by the app on the worker's
>   request. Server-side file paths (importers, `openFilePicker`) are paths in the
>   engine's file store (`/tmp/…`).
> - The card frame gets its media inlined as data URLs; it is sandboxed and not served
>   by the service worker, so reviewer.js's MathJax still loads from the network.


All paths are relative to `C:\Users\dani\Documents\AnkiIos\reference\anki` (abbreviated **ANKI**), `...\reference\ankidroid` (**AD**) or `...\vendor\anki-web` (**WEB**). Line numbers come from the files as they are checked out.

## 0. Transport and serving rules (from qt/aqt/mediasrv.py and ts)

### RPC transport
Every SvelteKit call goes through `ts/lib/generated/post.ts:12-58`:
- Request: `POST /_anki/<camelCaseMethod>` with headers `Content-Type: application/binary` and `Anki-Op-Changes: <0|1|2|3>`. The body is the protobuf input.
- Success: the response body is the protobuf output. An empty body is fine for `Empty`; Qt returns 204 when there is no data (mediasrv.py:1295-1299).
- Error: a non-2xx response whose text body is shown with `alert()` unless `alertOnError:false`. The text `"500: Interrupted"` is the one error that is not alerted.
- **Anki-Op-Changes** is generated in rslib/proto/typescript.rs:133-158:
  - `1` if the output *is* `OpChanges`.
  - `2` if output field 1 is `OpChanges` (OpChangesWithCount, OpChangesWithId, ImportResponse…).
  - `3` if the nesting is two levels deep. Example: `addNote` → AddNoteResponse.changes(OpChangesWithCount).changes(OpChanges).
  - Qt parses the output as OpChanges / OpChangesOnly / NestedOpChanges and broadcasts it (mediasrv.py:1241-1269). Use this header to publish "something changed" events to your other pages.
- Qt's Python side for raw methods is just `col._backend.<snake_name>_raw(request_body)` (mediasrv.py:1247-1248). Every RPC in the Rust backend has a `_raw` variant.
- **FrontendService methods are not in the Rust backend.** The host must implement them: `BackendFrontendService {}` is empty (proto/anki/frontend.proto:17-69).
- Qt also checks that POST Content-Type equals `application/binary` (mediasrv.py:1320-1322).

### Qt's POST allow-list
- Custom handlers (mediasrv.py:1131-1164): congratsInfo, getDeckConfigsForUpdate, updateDeckConfigs, getSchedulingStatesWithContext, setSchedulingStates, changeNotetype, importDone, importDialogRequireClose, searchInBrowser, deckOptionsRequireClose, deckOptionsReady, getProfileConfigJson, setProfileConfigJson, getMetaJson, setMetaJson, getConfigJson, convertPastedImage, openFilePicker, openMedia, showInMediaFolder, recordAudio, playFile, readClipboard, writeClipboard, closeAddCards, closeEditCurrent, openLink, askUser, showMessageBox, openFieldsDialog, openCardsDialog, saveCustomColours.
- Raw backend passthrough (mediasrv.py:1167-1238): latest_progress, get_custom_colours, get_deck_names, get_deck, i18n_resources, get_csv_metadata, get_import_anki_package_presets, import_csv, import_anki_package, import_json_file, import_json_string, get_field_names, get_note, new_note, note_fields_check, defaults_for_adding, default_deck_for_notetype, add_note, update_notes, update_notetype, get_notetype, get_notetype_names, get_change_notetype_info, get_cloze_field_ords, card_stats, get_review_logs, graphs, get_graph_preferences, set_graph_preferences, complete_tag, get_image_for_occlusion, add_image_occlusion_note, get_image_occlusion_note, update_image_occlusion_note, get_image_occlusion_fields, compute_fsrs_params, compute_optimal_retention, set_wants_abort, evaluate_params_legacy, get_optimal_retention_parameters, simulate_fsrs_review, simulate_fsrs_workload, get_ignored_before_count, get_retention_workload, encode_iri_paths, decode_iri_paths, html_to_text_line, set_config_json, get_config_bool, add_media_file, add_media_from_path, add_media_from_url, get_absolute_media_path, extract_media_files, get_card.
- Endpoint names are `stringcase.camelcase(name)` (mediasrv.py:1273-1278).

### Settings handlers: exact semantics
- `getProfileConfigJson`, `getMetaJson`, `getConfigJson`:
  - Input: `generic.String{val=key}` (field 1).
  - Output: `generic.Json{json=<utf8 JSON bytes>}`.
  - **A missing key must return the JSON text `null`** (mediasrv.py:801-806, 834-838). An empty body breaks `JSON.parse` (ts/lib/tslib/profile.ts:46-50).
- `setProfileConfigJson`, `setMetaJson`:
  - Input: `SetSettingJsonRequest{key=1, value_json=2}`.
  - Output: empty.
- `setConfigJson` is the raw backend method `set_config_json`, called with `{key, valueJson, undoable:true}` (profile.ts:82-87).

### URL routing (mediasrv.py:524-646, 441-489)
- `/_anki/<path>` → `WEB/<path>`. For example `/_anki/js/reviewer.js`, `/_anki/css/reviewer.css`, `/_anki/js/vendor/mathjax/tex-chtml-full.js`, `/_anki/js/mathjax.js`, `/_anki/imgs/...`.
  - Legacy top-level remap: `/_anki/foo.css` → `css/foo.css`; `/_anki/foo.js` → `js/foo.js` (jquery, jquery-ui and plot go to `js/vendor/`).
- `/_app/<x>` → `WEB/sveltekit/_app/<x>`. Paths containing `immutable` get `Cache-Control: max-age=31536000`.
- `/<route>[/...]` → `WEB/sveltekit/index.html` (SPA fallback). Valid routes: `graphs, congrats, card-info, change-notetype, deck-options, import-anki-package, import-csv, import-page, image-occlusion, preferences, editor` (mediasrv.py:524-540).
- Anything else → a file from `col.media.dir()` (mediasrv.py:634-646). Card HTML relies on this through `<base href="http://127.0.0.1:PORT/">` (aqt/main.py:1890-1891), so `<img src="foo.jpg">` → `GET /foo.jpg`.
  - Qt serves media with a strict CSP (`UNTRUSTED_MEDIA_CSP`, mediasrv.py:75-100).
  - Cache: css max-age 10, js 0, other 3600 (mediasrv.py:396-405).

### CSP
- The SvelteKit index.html (`WEB/sveltekit/index.html`) contains `<meta http-equiv="content-security-policy" content="script-src 'self' 'sha256-qxt8…'">`.
- **Trusted routes:** Qt strips that meta and sends the header `frame-ancestors 'none'` instead (mediasrv.py:463-466).
- **`editor` and `image-occlusion`:** Qt keeps the meta and adds `script-src <origin>/_anki/ <origin>/_app/ <origin>/_addons/ <hash>; form-action 'none'; frame-ancestors 'none'` (mediasrv.py:148-158, 455-462).
- Consequences for you:
  - Inject your host script as an **external same-origin** `<script src="/_host/bridge.js">` placed before the SvelteKit inline script. Inline scripts are blocked unless the meta is stripped.
  - Strip the meta at least for `congrats`. Its links are `javascript:bridgeCommand('unbury')`, which CSP blocks; AnkiDroid disables CSP for congrats for this reason (AD …/pages/SvelteKitPage.kt:16-17; regex strip in PageWebViewClient.kt).

### Night mode
- SvelteKit pages: append `#night` to the URL. `checkNightMode()` then sets `<html class="night-mode" data-bs-theme="dark">` (ts/lib/tslib/nightmode.ts; ts/routes/+layout.ts:12-15).
- Qt `load_sveltekit_page` builds `{server}{path}{?cb=…}{#night}` (qt/aqt/webview.py:948-965).

### bridgeCommand
- `ts/lib/tslib/bridgecommand.ts:21-23` calls `window.bridgeCommand(cmd, cb)`. If it is undefined, it throws a TypeError.
- Qt injects it via QWebChannel at DocumentReady (webview.py:102-135): `bridgeCommand = pycmd = function(arg, cb){ channel.objects.py.cmd(arg, resultCB) }`. The callback receives a JSON-parsed return value.
- **You must define `window.bridgeCommand` and `window.pycmd` on every page, before any app code runs.** The e2e tests stub it the same way (ts/tests/e2e/fixtures.ts:24-37).

### Host → page change notifications
- Qt evaluates `if(globalThis.anki && globalThis.anki.onOperationDidExecute) globalThis.anki.onOperationDidExecute(<OpChanges as camelCase JSON>)` (webview.py:1025-1034).
- The receiving side is `ts/lib/tslib/operations.ts:9-20` (`registerOperationHandler`); the editor uses it (NoteEditor.svelte:1280-1287).

### Concurrency
- rsbridge releases the GIL for every backend call (`py.detach`, pylib/rsbridge/lib.rs:49-57).
- Run backend calls in a threadpool. Do **not** wrap `latest_progress` or `set_wants_abort` in a global lock. Pages poll `latestProgress` every 100 ms while a long call (import, FSRS optimize) is running (ts/lib/tslib/progress.ts:5-25).

---

## A. Route URLs, path/query params and Qt openers

| Route (URL) | Params | +page.ts / load | Qt opener |
|---|---|---|---|
| `/deck-options/<deckId>` | `deckId` (number) | `getDeckConfigsForUpdate({did})` → `DeckOptionsState` (ts/routes/deck-options/[deckId]/+page.ts:8-16) | qt/aqt/deckoptions.py:47 `load_sveltekit_page(f"deck-options/{deck['id']}")`. Only for non-filtered decks with the v3 scheduler (deckoptions.py:125-134). |
| `/graphs` | none; there are no URL params. `initialSearch="deck:current"`, `initialDays=365` (ts/routes/graphs/+page.svelte:41-46) | `graphs`, `getGraphPreferences`, `setGraphPreferences` | qt/aqt/stats.py:141 `load_sveltekit_page("graphs", cache_bust=True)` |
| `/card-info/<cardId>` (`?revlog=0` hides the revlog) | `cardId`; a non-number such as "None" gives `info=null`, which shows a placeholder | `cardStats({cid})` (card-info/[cardId]/+page.ts:15-20; +page.svelte:14) | qt/aqt/browser/card_info.py:62 `card-info/{card_id}` |
| `/card-info/<cardId>/<previousId>` (`?revlog=0`, `?curve=0`) | two ids | two `cardStats` calls (…/[previousId]/+page.ts:16-23) | not used by Qt |
| `/change-notetype/<oldNtid>[/<newNtid>]` | rest param `notetypeIds`, split on "/"; new defaults to old (change-notetype/[...notetypeIds]/+page.ts:8-22) | `getNotetypeNames`, `getChangeNotetypeInfo({oldNotetypeId,newNotetypeId})` | qt/aqt/changenotetype.py:54 `change-notetype/{notetype_id}`. **The note IDs are not in the URL**; the host keeps them (changenotetype.py:41, 82). |
| `/import-csv/<path>` | rest param `path` = server-side file path | `getNotetypeNames`, `getDeckNames({skipEmptyDefault:false, includeFiltered:false})`, `getCsvMetadata({path},{alertOnError:false})` (import-csv/[...path]/+page.ts:8-24) | qt/aqt/import_export/import_dialog.py:68 `f"{ts_page}/{quote(path)}"` |
| `/import-anki-package/<path>` | rest `path` | `getImportAnkiPackagePresets({})`; import is `importAnkiPackage({packagePath:path, options})` (ImportAnkiPackagePage.svelte:64-68) | same as above (`AnkiPackageArgs`, import_dialog.py:41-44) |
| `/import-page/<path>` | rest `path` | `importJsonFile({val:path})` (import-page/[...path]/+page.svelte:13-15) | `ImportArgs` / `JsonFileArgs` |
| `/image-occlusion/<imagePathOrNoteId>` | if the value starts with a digit it is `{kind:"edit", noteId}`; otherwise `{kind:"add", imagePath, notetypeId:0n}` (image-occlusion/[...imagePathOrNoteId]/+page.ts:15-33) | no load calls; MaskEditor calls `getImageForOcclusion({path})` or `getImageOcclusionNote({noteId})` (mask-editor.ts:41, 62) | **not opened standalone by Qt 26.09.** IO is embedded in the editor. AnkiDroid opens `image-occlusion/{Uri.encode(path)}` or `image-occlusion/{noteId}` (AD ImageOcclusion.kt). |
| `/congrats` | none | `congratsInfo({})`, refreshed every 60 s (CongratsPage.svelte:62-72) | qt/aqt/overview.py:208-209 |
| `/editor/?mode=add\|browser\|current` | query `mode` (default "add") (editor/+page.svelte:14) | nothing; the host drives it through `loadNote()` (see B) | qt/aqt/editor.py:117-119 `editor/?mode={editor_key}` with key `add`, `browser` or `current` (profiles.py:635-642) |
| `/preferences` | none | `getConfigJson("experimentalFeatures")` | preferences.py:80 |

Rest-param paths:
- SvelteKit's `[...path]` captures everything after the first slash, **including a leading slash**. For a POSIX absolute path use `/import-csv//tmp/x.csv` (Qt produces this via `quote(path)`). On Windows it is `/import-csv/C%3A/...`.
- The path must be a file on the **server** (the backend opens it). Upload to a temp dir first, then navigate with that path.

The editor is experimental in Qt: the new editor is used only when `ExperimentFlag.SVELTE_EDITOR` is on or Shift is held (aqt/main.py:1303-1326).

---

## B. Per-route host protocol (beyond plain RPC)

### deck-options
- **Globals set by the page:**
  - `globalThis.anki.deckOptionsPendingChanges()`: commits edits; if there are no changes, or the user confirms discarding, it calls `deckOptionsRequireClose({})` ([deckId]/+page.svelte:17-27).
  - `globalThis.$deckOptions` (a promise of the page component).
  - `anki.setParameterUnlockClickTimeoutMs` and `anki.defaultParameterUnlockClickTimeoutMs` (ParamsInput.svelte:13-15).
- **On mount** the page calls `deckOptionsReady({})` (+page.svelte:29-35).
- **Close flow:** when the user closes, the host evaluates `anki.deckOptionsPendingChanges()` (deckoptions.py:62-67). The page answers with POST `deckOptionsRequireClose`, and the host then closes for real (mediasrv.py:779-788).
- **Save:** `updateDeckConfigs(UpdateDeckConfigsRequest)` (lib.ts:282-286). The page does **not** close itself. Qt runs the op and on success closes the dialog **unless** `mode == UPDATE_DECK_CONFIGS_MODE_COMPUTE_ALL_PARAMS` (mediasrv.py:659-711).
  - For "Save & optimize all", the page itself calls `window.location.reload()` right after `state.save(...)` without awaiting it (FsrsOptions.svelte:352-353).
  - AnkiDroid wraps `fetch` so the reload waits for the save response (AD DeckOptions.kt `SaveAndOptimizeReload`, lines ~290-385).
  - Server side: make the next `getDeckConfigsForUpdate` wait for an in-flight `updateDeckConfigs`.
- **Optimize / simulate** use `computeFsrsParams`, `simulateFsrs*`, `setWantsAbort`, and poll `latestProgress`.
- **No bridgeCommand calls.**
- **AnkiDroid extras** (AD DeckOptions.kt):
  - JS listeners for Bootstrap `shown.bs.modal` / `hidden.bs.modal`, used for back-button handling.
  - Close an open modal: `document.getElementsByClassName("modal show")[0].getElementsByClassName("btn-close")[0].click()`.
  - Easy-days range-slider touch fix: disable `pointer-events` on `.easy-days-settings input[type=range]` and re-implement click.
  - Unlock-timeout override via `Object.defineProperty` on `anki.setParameterUnlockClickTimeoutMs`.

### graphs
- `bridgeCommand("browserSearch: <search> <query>")` when a graph bar is clicked (GraphsPage.svelte:25-27). Qt opens the Browser (stats.py:132-138).
- The search starts as `deck:current`, so call `col.decks.select(did)` / `set_current` before loading.
- Alternatively, like AnkiDroid, set the text box: `#statisticsSearchText` value = `deck:"Name"`, then dispatch `input` and `change` events (AD Statistics.kt `changeDeck`; RangeBox.svelte:90).

### card-info
- Page globals: `anki.updateCard(cardIdString)` or, on the two-card route, `anki.updateCardInfos(id)`. They call `invalidate()` or `goto()` (card-info/[cardId]/+page.svelte:16-26).
- Qt calls `anki.updateCard('<id>')` when the card changes (card_info.py:126-132).
- No bridge commands.

### change-notetype
- Save posts `changeNotetype(ChangeNotetypeRequest)` **without** note_ids (lib.ts:178-188).
- The host must:
  1. Parse the request.
  2. Append the stored note IDs: `input.note_ids.extend(ids)`.
  3. Confirm the schema change.
  4. Run `col.models.change_notetype_of_notes(input)` (or `_backend.change_notetype`).
  5. Close the dialog.
- Reference: mediasrv.py:767-776 and changenotetype.py:68-85.

### congrats
- Links `javascript:bridgeCommand('unbury')` and `bridgeCommand('customStudy')` appear only when `info.bridgeCommandsSupported` is true. It is always true from rslib (rslib/src/scheduler/congrats.rs:38) (CongratsPage.svelte:55-60, 90-102).
- `unbury`: if both sched-buried and user-buried exist, ask which; otherwise unbury ALL. Use `col.sched.unbury_deck(did, mode)` (AD CongratsPage.kt `onUnbury`).
- `congratsInfo` in Qt also moves the UI back to overview if the deck is no longer finished (mediasrv.py:649-652).

### import-csv / import-anki-package / import-page
- Import runs through `BackendProgressIndicator`, which polls `latestProgress` (BackendProgressIndicator.svelte; progress.ts).
- After the import the page calls `importDone({})` (ImportPage.svelte:30-35). Qt uses it only to make the dialog non-modal (mediasrv.py:728-739).
- The error page calls `importDialogRequireClose({})` (lib/components/ErrorPage.svelte:12). The host closes.
- Cancel: the host calls `col.set_wants_abort()` (import_dialog.py:77-79; AD CsvImporter.kt back callback).
- The import log may call `searchInBrowser(SearchNode)`.
- AnkiDroid injects CSS `.desktop-only { display: none !important; }` to hide desktop-only buttons (AD BackendImporting.kt:45-55).

### image-occlusion (standalone)
- The route sets `globalThis.anki.imageOcclusion = { mode, save }`, where `save()` → `addOrUpdateNote(globalThis.anki.imageOcclusion.mode, hideAllGuessOne)` ([...]/+page.ts:11-28).
- **There is no visible Add button in the route.** The host must call `anki.imageOcclusion.save()` (AD ImageOcclusion.kt toolbar `action_save`).
- Add: `addImageOcclusionNote({notetypeId, imagePath, occlusions, header, backExtra, tags})` (add-or-update-note.svelte.ts:25-65).
  - `notetypeId 0` makes the backend create/use the first IO notetype (rslib/src/image_occlusion/imagedata.rs:50-59).
  - **The note goes into `col.decks.current()`** (imagedata.rs:67), so select the target deck first.
  - AnkiDroid overwrites `globalThis.anki.imageOcclusion.mode` after load to set the real `notetypeId` (AD ImageOcclusion.kt `onPageFinished`).
- Edit: `updateImageOcclusionNote({noteId, …})`.
- Detect success by watching those two POSTs. AnkiDroid closes after a 1 s delay so the toast is visible (AD PostRequestHandler.kt `handleUiPostRequest`).
- Other calls: `getCustomColours`, `saveCustomColours` (a no-op is fine; AD PostRequestHandler.kt:122-123), `completeTag`.
- Globals: `globalThis.canvas`, `globalThis.maskEditor`, `globalThis.resetIOImage`.

### NEW SvelteKit editor (`/editor/?mode=…`): full host protocol

#### Bootstrap
- editor/+page.svelte:14-22 calls `globalExport(base)` and, on mount, `setupEditor(mode)` → `setupI18n(editorModules)` → mount `NoteEditor`, then `bridgeCommand("editorReady")`. The mode must be `add`, `browser` or `current` (base.ts:93-102).
- `require("anki/ui").loaded` resolves once the NoteEditor is mounted (tslib/ui.ts; NoteEditor.svelte:1411-1413).
- NoteEditor's onMount assigns these globals (NoteEditor.svelte:1322-1360): `loadNote, reloadNote, reloadNoteIfEmpty, saveSession, setFields, setCollapsed, setClozeFields, setPlainTexts, setDescriptions, setFonts, getNoteInfo, focusField, setTags, setTagsCollapsed, setBackgrounds, setClozeHint, saveNow, closeAddCards, focusIfField, getNoteId, setNoteId, setNotetypeMeta, wrap, setMathjaxEnabled, setShrinkImages, setCloseHTMLTags, triggerChanges, setIsImageOcclusion, setupMaskEditor, setupMaskEditorWithOptions, setupMaskEditorForNewNote, setupMaskEditorForExistingNote, setImageField, resetIOImageLoaded, saveOcclusions, setSticky, pasteHTML, setFormat, toggleEditorButton`.

#### Host → page: loading a note
- On `editorReady`, Qt evaluates: `require("anki/ui").loaded.then(() => { loadNote(<json>) })` (editor.py:416-447).
- Args (`LoadNoteArgs`, NoteEditor.svelte:31-41):
  `{nid, notetypeId, deckId, focusTo, originalNoteId, reviewerCardId, initial:true, copyFromNote?, stickyFieldsFrom?}`.
  - Numbers or strings are both accepted; they are converted with `BigInt()` (NoteEditor.svelte:1001-1016).
  - Pass ids as strings to avoid any precision loss.
- **add** (`NewAddCards.load_new_note`, addcards.py:76-83 → editor.py:435-443): `{nid:null, notetypeId:null|mid, deckId:null|did, focusTo:0, originalNoteId:null, reviewerCardId:<current review card id or null>, initial:true}`.
  - With `initial`, the page calls `defaultsForAdding({homeDeckOfCurrentReviewCard})`, selects the in-page deck and notetype choosers, then calls `newNote({ntid})` (NoteEditor.svelte:1026-1086).
  - Add-a-copy: `originalNoteId` → `getNote` and `defaultDeckForNotetype`, then fields and tags are copied (addcards.py:46-55; NoteEditor.svelte:1027-1034, 1100-1103).
  - `reopen` → `reloadNoteIfEmpty(deckId, notetypeId)` (addcards.py:65-71; editor.py:452-457).
- **current** (edit the card being reviewed; editcurrent.py:23-31): `{nid:note.id, notetypeId:note.mid, focusTo:0, reviewerCardId:card.id, initial:true, deckId:null, originalNoteId:null}`. The page calls `getNote({nid})`.
- **browser**: same as current but without a reviewer card. A Preview button appears (NoteEditor.svelte:1449-1457).
- Inside `loadNoteInner`, `getNotetype`, `getFieldNames`, `getClozeFieldOrds`, `encodeIriPaths` (per field), `getProfileConfig("lastTextColor"|"lastHighlightColor")`, `getMeta("<mode>TagsCollapsed")`, `getColConfig("renderMathjax"|"shrinkEditorImages"|"closeHTMLTags")`, `noteFieldsCheck` and, for IO notetypes, `getImageOcclusionFields` are called (NoteEditor.svelte:1064-1230).
- `getCard({cid})` is called when `reviewerCardId` is set (NoteEditor.svelte:1019-1022).

#### Saving: done by the page through RPC, not through bridge
- **Field edits:** a per-field 600 ms debounce. Each save does:
  1. `bridgeCommand("key:<i>")`
  2. `note.fields[i] = decodeIriPaths(content)` (data-editor-shrink and NUL bytes stripped; `<br>` → "")
  3. if mode ≠ add, `updateNotes({notes:[note], skipUndoEntry:false},{alertOnError:false})` (Anki-Op-Changes: 1)
  4. `noteFieldsCheck` to update the duplicate/cloze display.
  Reference: NoteEditor.svelte:385-437.
- **Focus events:**
  - focusin → `bridgeCommand("focus:<i>")`
  - focusout → `bridgeCommand("blur:<i>")`, then the same save path.
  Reference: NoteEditor.svelte:1501-1527.
- **Tags:** `note.tags = …; updateCurrentNote()` (non-legacy). Legacy mode uses `bridgeCommand("saveTags:<json>")` instead (NoteEditor.svelte:371-380).
- **`saveNow()`** (host may call it with `saveNow(keepFocus)`): closes the MathJax editor, commits tag edits, flushes all field timers, then `bridgeCommand("saved")` (NoteEditor.svelte:446-453). Qt uses this for `call_after_note_saved` (editor.py:459-476).
- Saves also happen on `visibilitychange` → hidden (NoteEditor.svelte:525-530, 1369).
- **Add:**
  - Trigger: the in-page Add button (Ctrl+Enter) → `addCurrentNote(deckChooser.getSelected().id)` (ActionButtons.svelte; NoteEditor.svelte:495-497, 591-623).
  - Validation: `noteFieldsCheck`. An empty first field or wrong cloze shows `showMessageBox`. A missing cloze asks `askUser`.
  - Call: `addNote({note, deckId})` (Anki-Op-Changes: **3**). The page shows a toast, adds a history entry, then `loadNote({stickyFieldsFrom: note})`.
  - **There is no bridge command for "note added".** Detect it server-side from a successful `/_anki/addNote` (AddNoteResponse: `changes=1` OpChangesWithCount, `note_id=2`) and broadcast.
- **Close:**
  - add mode: the Close button, or the host evaluating `closeAddCards()` (addcards.py:107-109) → `saveNow` → POST `closeAddCards(generic.Bool{val=shouldPrompt})`. The host then shows a "discard current input?" prompt if `val`, otherwise closes (NoteEditor.svelte:458-480; mediasrv.py:1002-1013; addcards.py:111-127).
  - current mode: Close button (Ctrl+Enter) → `saveNow` → POST `closeEditCurrent({})`. The host closes (NoteEditor.svelte:482-485; mediasrv.py:1016-1024).
  - browser mode: no close button.
- **History:** a history entry click → `searchInBrowser(SearchNode{nid})` (HistoryModal.svelte:10-22). Duplicate link → `searchInBrowser({filter:{case:"dupe", value:{notetypeId, firstField}}})` (DuplicateLink.svelte:262-277).
- **Sticky fields** (add mode): F9 / Shift+F9 → `getNotetype` + `updateNotetype` with `field.config.sticky` (StickyBadge.svelte:190-201; NoteEditor.svelte:233-253).
- **Options menu:** `setColConfig("shrinkEditorImages"|"renderMathjax"|"closeHTMLTags")` (OptionsButton.svelte:26-44). Colours → `setProfileConfig("lastTextColor"|"lastHighlightColor")` and `saveCustomColours`.
- **Fields... / Cards...:** `saveNow` then POST `openFieldsDialog({})` / `openCardsDialog({})` (NotetypeButtons.svelte:358-397). The Ctrl+L shortcut still emits `bridgeCommand("cards")`, so handle both. There is no SvelteKit UI for these; you need your own or a no-op.
- **Help:** `openLink({val:url})` (HelpButton.svelte:11-16).
- **Change reaction:** if the host calls `anki.onOperationDidExecute({notetype|deck:true})`, add mode reloads (copying the current note). In current/browser modes, `{noteText:true}` triggers `reloadNote()` (NoteEditor.svelte:1280-1287).

#### Bridge commands emitted in non-legacy mode
| Command | Meaning |
|---|---|
| `editorReady` | page is ready for `loadNote` |
| `key:<i>` | field i changed |
| `focus:<i>` / `blur:<i>` | focus moved |
| `saved` | `saveNow()` finished |
| `editorState:<new>:<old>` | `-1` Initial, `0` Fields, `1` IO picker, `2` IO masks, `3` IO fields (types.ts:124-130; NoteEditor.svelte:978-984) |
| `ioImageLoaded:<json path or nid>` | IO image loaded (NoteEditor.svelte:950-955) |
| `paste`, `cut`, `copy` | context-menu items (context-menu.svelte.ts:66-84); the host performs the clipboard action |
| `cards` | Ctrl+L shortcut |
| `preview` | browser mode Preview button (PreviewButton.svelte:27) |
| add-on button `data-command` strings | only if you add add-on buttons |

Qt handles these in editor.py:341-380.

#### Media: paste / drop / attach / record (all host RPCs)
- **Paste and drop** are handled in the page from `event.clipboardData` / `dataTransfer` (data-transfer.ts:398-425):
  - Images: `convertPastedImage({data, ext})`, then `addMediaFile({desiredName:"paste-<sha1>.<png|jpg>", data})` (data-transfer.ts:218-229, 288-295).
    - The extension is png if `PASTE_IMAGES_AS_PNG`, otherwise jpg (281-286).
    - **`convertPastedImage` is a Qt QImage handler** (mediasrv.py:845-858): re-encode `data` to `ext`, quality 50 for png and 80 otherwise. Implement it with Pillow, or simply return the input bytes.
  - Audio files: `addMediaFile`.
  - URLs: `addMediaFromUrl({url})` → `{filename?, error?}` (143-150).
  - Inline `data:` images: `addMediaFile`.
  - Extended paste depends on `getConfigBool(PASTE_STRIPS_FORMATTING)` (66-74).
  - The inserted HTML is `<img src="encodeURI(name)">` or `[sound:name]`. Audio insertion also calls `playFile({val:filename})` (168-178).
- **Attach (F3):**
  1. `openFilePicker({title, key:"media", filterDescription, extensions:[…]})` → `generic.String{val=<absolute server path>}`
  2. `addMediaFromPath({path})` → filename
  3. insert the link; if audio, `playFile`.
  Reference: TemplateButtons.svelte:40-69; data-transfer.ts:445-461.
  - In Qt this is a native dialog awaited asynchronously (mediasrv.py:884-907). An empty `val` means cancelled.
- **Record (F5):** `recordAudio({})` → `generic.String{val=<absolute path of recorded file>}` → `addMediaFromPath`, then `playFile` (TemplateButtons.svelte:77-92; mediasrv.py:935-949).
- **IO from file or clipboard:**
  - `openFilePicker` (images) → `addMediaFromPath` → `getImageForOcclusion({path})`.
  - Clipboard: `readClipboard({types:[image/*…, text/uri-list]})` → `ReadClipboardResponse{map<string,bytes> data}`, then `addMediaFile` and `getAbsoluteMediaPath` (data-transfer.ts:478-490; NoteEditor.svelte:795-907).
- **Context menu:** "Copy image" → `writeClipboard({data:{mime:bytes}})`; open image → `openMedia({val})`; show in folder → `showInMediaFolder({val})` (context-menu.svelte.ts:93-111).
- **Prompts:**
  - `askUser(AskUserRequest{text=1, help=2, title=4, default_no=5})` → `generic.Bool{val=1}`
  - `showMessageBox(ShowMessageBoxRequest{text=1, type=2 (0 INFO / 1 WARNING / 2 CRITICAL), help=3, title=4, text_format=5})` → Empty
  - Reference: frontend.proto:121-140.

**Recommended browser implementation:** inject a `fetch` wrapper that answers the UI-only RPCs client-side: openFilePicker, recordAudio, playFile, askUser, showMessageBox, readClipboard, writeClipboard, openLink, openMedia, showInMediaFolder, closeAddCards, closeEditCurrent, openFieldsDialog, openCardsDialog, searchInBrowser.
- This is what the official e2e tests do with `page.route("**/_anki/openFilePicker", fulfill(protoStringBody(path)))` (ts/tests/e2e/media-buttons.spec.ts:35-125).
- For openFilePicker and recordAudio: show `<input type=file>` or MediaRecorder, upload to a temp dir on the server, and return the server path encoded as `generic.String`.
- Hand-encoding:
  - `generic.String` = `0x0A <varint len> <utf8>`
  - `generic.Bool true` = `0x08 0x01`; false = empty body.
  - `Empty` = empty body.
- The alternative is long-polling POST handlers that wait for the browser, as Qt's `AsyncRequestHandler` does (mediasrv.py:864-877).

**Relative URLs inside the editor:**
- The page lives at `/editor/`. Relative media `<img src="foo.jpg">` and the shadow-root stylesheet `"./_anki/css/editable.css"` (RichTextStyles.svelte:56) resolve to `/editor/foo.jpg` and `/editor/_anki/css/editable.css`.
- Qt's router sends every `editor/*` path to index.html (mediasrv.py:551-555, 444-446).
- Recommendation for your server: for `GET /editor/<x>` with a non-empty `x`:
  - `x` starts with `_anki/` → serve bundled `WEB/<x minus _anki/>`
  - `x` exists in the media dir → serve the media file
  - otherwise → index.html.

---

## C. Reviewer (reviewer.js = ts/reviewer, bundled at WEB/js/reviewer.js)

### Page skeleton built by Qt
`Reviewer._initWeb` (qt/aqt/reviewer.py:342-362) uses `stdHtml(revHtml(), css=["css/reviewer.css"], js=["js/reviewer.js"])`, then evaluates `_blockDefaultDragDropBehavior();`. `stdHtml` (webview.py:694-776) produces:

```html
<!doctype html>
<html class="{night-mode|''}" dir="{ltr|rtl}" data-bs-theme="{dark|light}">
<head><title>…</title>
<base href="http://127.0.0.1:PORT/">                       <!-- main.py:1890 -->
<link rel="stylesheet" href="/_anki/css/webview.css">       <!-- CSS vars incl. --flag-N, --canvas -->
<style>{standard_css(): body{zoom;background-color:var(--canvas)} html{font-family…} :root{--canvas:…} …}</style>  <!-- webview.py:640-692 -->
<link rel="stylesheet" href="/_anki/css/reviewer.css">
</head>
<body class="{theme_manager.body_class()}">                 <!-- isWin|isMac|isLin [nightMode night_mode] fancy -->
<script src="/_anki/js/webview.js"></script>
<script src="/_anki/js/reviewer.js"></script>               <!-- jQuery is bundled inside reviewer.js; stdHtml adds no jquery when js= is given -->
<div id="_mark" hidden>&#x2605;</div>
<div id="_flag" hidden>&#x2691;</div>
<div id="qa" dir="auto"></div>
{col.conf.get("reviewExtra","")}
</body></html>
```

- Body classes per card come from `theme.py:187-191`: `"card card{ord+1} " + body_class(reviewer=True)`. `reduce-motion` is omitted for the reviewer (theme.py:163-185).
- AnkiDroid's equivalent (AD previewer/PreviewerHelpers.kt:30-78) adds `root-vars.css`, `reviewer.css`, `ankidroid.css`, then `jquery.min.js`, `reviewer.js` and `ankidroid-cardviewer.js`. The last one sets `bridgeCommand = function(){}` and `globalThis.ankiPlatform = "ankidroid"` (AD assets/scripts/ankidroid-cardviewer.js). AnkiDroid adds the body class `mathjax-rendered`.
- **Define `bridgeCommand` and `pycmd` before reviewer.js runs.** `_updateQA` calls `bridgeCommand("updateToolbar")` after setting innerHTML (index.ts:181). If that throws, the promise chain `_updatingQueue` becomes rejected and **every later `_showQuestion` / `_showAnswer` is silently skipped** (index.ts:81-85).

### Globals exported by reviewer.js
Exported through index_wrapper.ts:5-9, which copies every export of ts/reviewer/index.ts onto `window`:
- `$`, `jQuery` (index.ts:8).
- `anki.mutateNextCardStates`, `anki.imageOcclusion` (IO review API), `anki.setupImageCloze` (index.ts:14-17).
- `_queueAction(fn)`.
- `_updateQA(html, _, onupdate, onshown)` (146-198): lazy-loads MathJax if needed; preloads CSS, fonts and images; sets `#qa` innerHTML and re-executes `<script>` tags; runs hooks; `bridgeCommand("updateToolbar")`; `MathJax.typesetPromise([qa])`; opacity fade.
- `_showQuestion(q, a, bodyclass)` (200-225): scrolls to top, sets `document.body.className = bodyclass`, focuses `#typeans`, preloads the answer's images and MathJax.
- `_showAnswer(a, bodyclass?)` (232-251): Qt passes only `a`; the previewer passes bodyclass. Scrolls to `#answer`, then `bridgeCommand("repaintNeeded")`.
- `_drawFlag(n)`: shows `#_flag` with `color: var(--flag-n)`; 0 hides it (253-257).
- `_drawMark(bool)` (259-261).
- `getTypedAnswer()` → `#typeans.value ?? null` (60-62).
- `_typeAnsPress()`: Enter → `bridgeCommand("ans")` (263-268).
- `_emulateMobile(bool)`, `_blockDefaultDragDropBehavior()` (270-282).
- `onUpdateHook`, `onShownHook`, `ankiPlatform = "desktop"`.
- `require("anki/reviewer")` package (307-315).

### Qt call sequence
- **Question** (reviewer.py:370-405):
  1. `q = card.question()`
  2. play `card.question_av_tags()` if `card.autoplay()`
  3. `q = typeAnsFilter(mw.prepare_card_text_for_display(q))`
  4. run the state-mutation hook
  5. `a = col.media.escape_media_filenames(card.answer())`
  6. eval `_showQuestion(json(q), json(a), 'card cardN …')`
  7. `_drawFlag(card.user_flag())`; `_drawMark(note.has_tag("marked"))` (448-452)
  8. bottom bar `showQuestion(middleHtml, maxTimeSecs)`.
- **Answer** (460-484): `a = card.answer()`; autoplay `answer_av_tags()`; `a = typeAnsFilter(prepare(a))`; eval `_showAnswer(json(a))`; bottom bar `showAnswer(buttonsHtml, stopTimerOnAnswer)`.
  - Ease buttons wait until `_states_mutated` is true (859-867).
- **`prepare_card_text_for_display`** (aqt/main.py:633-643): `col.media.escape_media_filenames(text)`, then either `anki.sound.strip_av_refs` (if `Config.Bool.HIDE_AUDIO_PLAY_BUTTONS`) or `aqt.sound.av_refs_to_play_icons`.
- **Bridge commands handled by `_linkHandler`** (673-693): `ans`, `ease1..4`, `edit`, `more`, `play:q:N` / `play:a:N`, `updateToolbar`, `repaintNeeded`, `statesMutated`.

### AV tags in rendered output
- The backend replaces `[sound:x]` and `[anki:tts lang=… voices=… speed=…]text[/anki:tts]` (and `{{tts …:Field}}`) with `[anki:play:q:N]` / `[anki:play:a:N]` (rslib/src/card_rendering/writer.rs:138).
- The Python list `card.question_av_tags()` / `card.answer_av_tags()` contains `SoundOrVideoTag(filename=basename)` or `TTSTag(field_text, lang, voices, speed, other_args)` (pylib/anki/template.py:98-111; pylib/anki/sound.py:22-66).
- The answer side contains the FrontSide's `q` refs plus its own `a` refs, because `front_side=qout.text` (template.py:235-241).
- Play-button HTML (qt/aqt/sound.py:906-921; regex `AV_REF_RE = r"\[anki:(play:(.):(\d+))\]"` in pylib/anki/sound.py:69):

```html
<a class="replay-button soundLink" href=# onclick="pycmd('play:q:0'); return false;" draggable="false">
  <svg class="playImage" viewBox="0 0 64 64" version="1.1"><circle cx="32" cy="32" r="29" />
  <path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z" /></svg></a>
```

- `play:q:N` plays `question_av_tags()[N]` (sound.py:924-932). In a browser: play `/<filename>` with `<audio>`, and use `speechSynthesis` for TTS.
- Replay rule (reviewer.py:74-81): on the answer side, prepend the question tags if `card.replay_question_audio_on_answer_side()`.
- Browsers block autoplay without a user gesture; Qt toggles `setPlaybackRequiresGesture`.
- LaTeX: `<img class=latex src=latex-….png>` files are generated by the pylib hook (`anki.latex` via `hooks.card_did_render`) during `render()`. That hook needs `latex`/`dvipng` installed on the server.

### Type-in answers
- The backend leaves `[[type:Field]]`, `[[type:cloze:Field]]` or `[[type:nc:Field]]` in the text (rslib/src/template_filters.rs:166-176).
- **Question filter** (reviewer.py:706-751):
  - Find the field (cloze → `clozeIdx = card.ord + 1`; `nc:` → `combining = False`).
  - `typeCorrect = note[field]`; for cloze, `col.extract_cloze_for_typing(text, idx)`.
  - Record the field `font` and `size`.
  - Unknown field → a warning text (`studying_type_answer_unknown_field` / `studying_please_run_toolsempty_cards`). Empty field → remove the tag.
  - Otherwise replace with:
    `<center><input type=text id=typeans onkeypress="_typeAnsPress();" style="font-family: '{font}'; font-size: {size}px;"></center>`
- **On "show answer":** Qt evaluates `getTypedAnswer()` and stores the value or "" (800-805).
- **Answer filter** (753-795):
  - Strip `<hr id=answer>` and remember whether it was present.
  - `output = col.compare_answer(expected=typeCorrect, provided=typed, combining)`. This returns `<code id=typeans>…</code>` with `typeGood`, `typeBad` and `typeMissed` spans (rslib/src/typeanswer.rs:31-46).
  - Replace the tag with `<div style="font-family: '{font}'; font-size: {size}px">{output}</div>`, prefixed with `<hr id=answer>` if one was stripped.
  - If there was an hr but no type tag remains, return the original text.
  - When `typeCorrect` is empty, just remove the tags.

### MathJax
- `WEB/js/mathjax.js` sets `window.MathJax`:

```js
{tex:{displayMath:[["\\[","\\]"]],processEscapes:false,processEnvironments:false,processRefs:false,
 packages:{"[+]":["noerrors","mathtools"],"[-]":["textmacros"]}},
 loader:{load:["[tex]/noerrors","[tex]/mathtools"],paths:{mathjax:"/_anki/js/vendor/mathjax"}},
 startup:{typeset:false}}
```

  (ts/mathjax/index.ts)
- reviewer.js lazy-loads `/_anki/js/mathjax.js`, then `/_anki/js/vendor/mathjax/tex-chtml-full.js`, only when the HTML matches `/\\\[(.*?)\\\]|\\\((.*?)\\\)/su` (index.ts:27-50). It then runs `MathJax.typesetClear(); MathJax.typesetPromise([qa])` (183-193).
- **These absolute `/_anki/...` paths must exist on your server.**

### Custom scheduling (deck options "cardStateCustomizer")
- **JS source:** `col.get_config("cardStateCustomizer")`, read when review starts (reviewer.py:182).
- **Per card:**
  - Fetch `out = col.sched.get_queued_cards()`.
  - `top = out.cards[0]`; `states = top.states`; **`states.current.custom_data = top.card.custom_data`**; `context = top.context` (V3CardInfo.from_queue, reviewer.py:96-103).
  - Generate a random `key` once per session (162).
- **Each question** (286-297, 1240-1244): Qt evaluates

  ```js
  anki.mutateNextCardStates('{key}', async (states, customData, ctx) => {
      {js}
      }).finally(() => bridgeCommand('statesMutated'));
  ```

  The JS is on its own line on purpose, so a trailing `//` comment cannot swallow the closing code.
- **What `mutateNextCardStates` does** (ts/reviewer/answering.ts:54-82):
  1. POST `/_anki/getSchedulingStatesWithContext` (input Empty) → `SchedulingStatesWithContext{states=1, context=2}`.
  2. Convert to JSON with `toJson({emitDefaultValues:true})`; parse `customData` from `states.current.customData`.
  3. Run the user code, which mutates `states` and `customData.{again,hard,good,easy}`.
  4. POST `/_anki/setSchedulingStates(SetSchedulingStatesRequest{key=1, states=2})`, with customData re-packed into `again/hard/good/easy.customData`.
- **Host endpoints** (mediasrv.py:714-725; reviewer.py:274-284):
  - `getSchedulingStatesWithContext` → `SchedulingStatesWithContext(states=cur.states, context=cur.context).SerializeToString()`.
  - `setSchedulingStates`: parse; **ignore the request if `req.key != key`**; otherwise `cur.states = req.states`.
  - AnkiDroid does the same and also merges `current.custom_data` (AD ui/windows/reviewer/ReviewerViewModel.kt:440-520). It signals completion with `fetch("ankidroid/statesMutated",{method:"POST"})`.
- **Answer only after `statesMutated`**, or if the eval fails. Qt sets `_states_mutated = True` when the eval result is None.
- Build the answer with the possibly mutated `cur.states` (reviewer.py:544-563).
- Qt allows reviewer pages only these four endpoints: `getSchedulingStatesWithContext`, `setSchedulingStates`, `i18nResources` and `congratsInfo` (mediasrv.py:1328-1340), because card templates are untrusted JS. Same-origin browser pages cannot be isolated that way; consider serving card content from a separate origin or sandboxed iframe.

### Bottom bar (optional reuse)
- Files: `css/toolbar-bottom.css`, `css/reviewer-bottom.css`, `js/vendor/jquery.min.js`, `js/reviewer-bottom.js`.
- reviewer-bottom.js provides `showQuestion(middleHtml, maxTime)`, `showAnswer(html, stopTimer)` and `selectedAnswerButton()`. It needs `#middle` and `#time`.
- HTML templates: reviewer.py:810-944.
  - Answer button: `<button data-ease=i onclick='pycmd("ease%d")'>label<span class="nobold">{describe_next_states()[i-1]}</span>`.
  - The labels are shown only if `col.conf["estTimes"]`.
  - Counts are shown if `col.conf["dueCounts"]`, using `QueuedCards` new/learning/review counts with the current queue underlined.

---

## D. How AnkiDroid hosts the same pages (AD/AnkiDroid/src/main/java/com/ichi2/anki/pages)

### Server
- `AnkiServer.kt`: NanoHTTPD on 127.0.0.1, random port, **POST only**.
- GETs are served by `PageWebViewClient.shouldInterceptRequest`:
  - `/_app/*` → `assets/backend/sveltekit/app/*`
  - known routes → `index.html`
  - CSP meta removed only where `disableCsp` (congrats).
  - Immutable assets get the max-age header.
- Prefixes: `/_anki/` (backend), `/ankidroid/` (app-specific, e.g. `statesMutated`, `focusin`) and `/jsapi/`.

### Dispatch (PostRequestHandler.kt)
- `collectionMethods`: raw backend passthroughs. Includes `importDone` → identity and `saveCustomColours` → identity (no-op on mobile).
- `uiMethods`: `searchInBrowser`, `updateDeckConfigs` (with progress; then `finish()` or reload for COMPUTE_ALL_PARAMS), `latestProgress` and `i18nResources` (backend directly, no collection lock), `importCsv`, `importAnkiPackage` (undoable), `importDialogRequireClose` (`finish()`), `addImageOcclusionNote` / `updateImageOcclusionNote` (then close after 1 s), `deckOptionsReady`, `deckOptionsRequireClose`.

### Bridge
- `PageFragment.setupBridgeCommand`: after page load it evaluates `bridgeCommand = function(request){ bridgeCommandInterface.bridgeCommandImpl(request); };`.
- Used for congrats `unbury` / `customStudy` (CongratsPage.kt `bridgeCommands`).

### Page loading
- URL = `baseUrl + pagePath + ("#night" if dark)`.
- On `onPageStarted` it forces `document.body.style.backgroundColor` (PageWebViewClient.kt).
- `alert()` / `confirm()` are mapped to native dialogs (PageChromeClient.kt). In a browser these work natively.

### Per-page JS worth copying
- DeckOptions: modal back handling, easy-days slider fix, unlock-timeout override, fetch wrapper for save-then-reload. Close flow is `anki.deckOptionsPendingChanges()` → `deckOptionsRequireClose`; if the evaluate result is `"null"` (page not loaded), close directly.
- Statistics: deck switch through `#statisticsSearchText`.
- CSV and apkg importers: inject `.desktop-only{display:none!important}`; Back while `latestProgress` is being polled → `setWantsAbort`.
- ImageOcclusion: set `globalThis.anki.imageOcclusion.mode` (BigInt ids) after load; Save → `anki.imageOcclusion.save()`; select the deck first, since the note goes to the current deck.

### Card viewer and reviewer
- Uses Anki's `reviewer.js` with `_showQuestion(q, a, 'card cardN … mathjax-rendered')` and `_showAnswer(a, bodyclass)` (AD previewer/CardViewerViewModel.kt:107-144).
- Same `escape_media_filenames` + `[anki:play]` replacement. AnkiDroid uses `playsound:q:N` links and `<video>` for video (AD multimedia/SoundUtils.kt:38-90).
- Type-answer via `col.compareAnswer` (AD previewer/TypeAnswer.kt:49).
- State mutation: ReviewerViewModel.kt:479-520.
- The legacy `assets/card_template.html` (own `#content` div plus card.js) is the old viewer; you do not need it.

---

## E. pylib reviewer and rendering API (exact signatures)

### Collection (`pylib/anki/collection.py`)
`Collection(path: str, backend: RustBackend|None=None, server: bool=False)` (146-169). Methods:
- `get_card(id) -> Card` (488)
- `get_note(id) -> Note` (503)
- `update_notes(notes, skip_undo_entry=False) -> OpChanges` (506)
- `add_note(note, deck_id) -> OpChangesWithCount` (538)
- `latest_progress() -> Progress` (199)
- `set_wants_abort()` (1136)
- `undo_status() -> UndoStatus{undo:str, redo:str, last_step}` (1051)
- `undo() -> OpChangesAfterUndo` (1077); raises `anki.errors.UndoEmpty`
- `redo() -> OpChangesAfterUndo` (1084)
- `compare_answer(expected: str, provided: str, combining: bool=True) -> str` (1193)
- `extract_cloze_for_typing(text: str, ordinal: int) -> str` (1200)
- `set_user_flag_for_cards(flag: int, cids) -> OpChangesWithCount` (1131)
- `get_config(key, default=None)` (917); `get_config_bool(Config.Bool.X)` (942)
- `card_stats_data(card_id)` (1031)
- `i18n_resources(modules) -> bytes`
- `close(downgrade=False)` (271); `close_for_full_sync()` (283); `reopen(after_full_sync=False)` (292)

### Scheduler v3 (`pylib/anki/scheduler/v3.py`)
- `get_queued_cards(*, fetch_limit: int = 1, intraday_learning_only: bool = False) -> QueuedCards` (48-57). `QueuedCards{cards:[QueuedCard{card, queue(NEW=0|LEARNING=1|REVIEW=2), states, context}], new_count, learning_count, review_count}` (proto/anki/scheduler.proto:134-151).
- `describe_next_states(next_states: SchedulingStates) -> Sequence[str]` (59).
- `build_answer(*, card: Card, states: SchedulingStates, rating: CardAnswer.Rating.V) -> CardAnswer` (66-92). Uses `answered_at_millis=int_time(1000)` and `milliseconds_taken=card.time_taken(capped=False)`, so **`card.start_timer()` must have been called**. Keep the Card object for the session, or rebuild the CardAnswer with a client-measured time.
- `answer_card(input: CardAnswer) -> OpChanges` (94).
- `state_is_leech(new_state) -> bool` (100).
- `counts()`, `_is_finished()`, `answerButtons(card) -> 4` (legacy.py:129).
- Ratings: `CardAnswer.AGAIN=0`, `HARD=1`, `GOOD=2`, `EASY=3`.
- Base scheduler (`scheduler/base.py`): `congratulations_info()` (87), `unbury_deck(deck_id, mode=UnburyDeck.ALL)` (146), `suspend_cards(ids)` (153), `bury_cards(ids, manual=True)` (163), `bury_notes`, `suspend_notes`, `schedule_cards_as_new(card_ids, *, restore_position=False, reset_counts=False, context=None)` (182), `set_due_date(card_ids, days: str, config_key=None)` (205).

### Card (`pylib/anki/cards.py`)
- `Card(col, id=None, backend_card=None)` (54-71). Build the reviewer card with `Card(col, backend_card=top.card)`.
- `question(reload=False, browser=False) -> str` = `"<style>{css}</style>" + question_text` (149, template.py:289-293).
- `answer() -> str` (152).
- `question_av_tags()` / `answer_av_tags() -> list[AVTag]` (155-159).
- `render_output(reload=False, browser=False) -> TemplateRenderOutput{question_text, answer_text, question_av_tags, answer_av_tags, css}` (161-170).
- `note(reload=False)`, `note_type()`, `template()`.
- `start_timer()` (191); `time_taken(capped=True)` (215); `time_limit()`; `should_show_timer()`.
- `autoplay()` (210); `replay_question_audio_on_answer_side()` (206).
- `user_flag()` (232); `current_deck_id()` (194).

### Rendering internals (`pylib/anki/template.py`)
- `TemplateRenderContext.from_existing_card(card, browser).render()` (121-124, 224-256).
- Calls `col._backend.render_existing_card(card_id=…, browser=…, partial_render=True)` → `RenderCardResponse{question_nodes, answer_nodes, css, latex_svg, is_empty}` (273-275; card_rendering.proto:94-131).
- Then `apply_custom_filters`, then `col._backend.extract_av_tags(text=…, question_side=…)` → `ExtractAvTagsResponse{text, av_tags}`.

### Media (`pylib/anki/media.py`)
- `col.media.dir() -> str` (60)
- `write_data(desired_fname, data) -> str` (97)
- `add_file(path) -> str` (90)
- `escape_media_filenames(string, unescape=False) -> str` (170, wraps encode/decode_iri_paths)
- `have(fname)`
- `strip_av_tags(text)`
- `anki.sound.strip_av_refs(text)`

### Tags, notes, decks
- `col.tags.bulk_add(note_ids, "marked")` / `bulk_remove(...)` (tags.py:63-68).
- `col.remove_notes(note_ids)`.
- `col.decks.select(did)` / `set_current(did) -> OpChanges` / `current()` (decks.py:412-426).
- `col.decks.config_dict_for_deck_id(did)`: keys `autoplay`, `replayq`, `timer`, `maxTaken`, `stopTimerOnAnswer`, `secondsToShowQuestion` / `Answer`, `questionAction` / `answerAction`, `waitForAudio`.

### Undo in review
After `col.undo()`, if `changes.study_queues` is set, re-fetch `get_queued_cards()` (reviewer.py:221-235). Other refresh rules: `note_text` → re-render the current card; `card` → reload the flag.

---

## F. Sync from pylib with a custom server

### Signatures (pylib/anki/collection.py:1142-1175)

```python
col.sync_login(username: str, password: str, endpoint: str | None) -> SyncAuth   # SyncAuth{hkey=1, endpoint=2 (optional), io_timeout_secs=3}
col.sync_collection(auth: SyncAuth, sync_media: bool) -> SyncOutput              # = sync_pb2.SyncCollectionResponse
col.sync_status(auth: SyncAuth) -> SyncStatus                                     # = SyncStatusResponse{required: NO_CHANGES=0|NORMAL_SYNC=1|FULL_SYNC=2, new_endpoint?}
col.full_upload_or_download(*, auth: SyncAuth | None, server_usn: int | None, upload: bool) -> None
col.sync_media(auth: SyncAuth) -> None          # starts media sync in background
col.media_sync_status() -> MediaSyncStatus      # {active: bool, progress: {checked, added, removed}}; raises if the media sync failed
col.abort_sync(); col.abort_media_sync()
```

- Aliases are in pylib/anki/sync.py: `SyncAuth`, `SyncOutput = SyncCollectionResponse`, `SyncStatus = SyncStatusResponse`.
- `SyncOutput` (proto/anki/sync.proto:56-72): `host_number=1`, `server_message=2`, `required=3`, `new_endpoint=4`, `server_media_usn=5`.
- `required` values: `NO_CHANGES=0`, `NORMAL_SYNC=1`, `FULL_SYNC=2` (conflict, user chooses), `FULL_DOWNLOAD=3` (local empty), `FULL_UPLOAD=4` (remote empty).

### Behaviour
- **Login:** `sync_login` returns `SyncAuth(hkey, endpoint=<your endpoint>, io_timeout_secs=None)` (rslib/src/backend/sync.rs:287-310). Store the hkey.
  - Build later auths like Qt: `SyncAuth(hkey=…, endpoint=current_or_custom_url, io_timeout_secs=…)` (profiles.py:681-697).
  - The endpoint must be the base URL **with a trailing slash**, e.g. `http://host:8080/`. It is `Url.join("./")`-normalized (sync.rs:76-95). If it is None the client uses `https://sync.ankiweb.net/`.
  - Requests go to `<base>sync/<method>` and `<base>msync/<method>` (rslib/src/sync/collection/protocol.rs:55-57; media/protocol.rs:38-40).
- **`new_endpoint`:** set when the server answers `/sync/meta` with a 308 redirect (rslib/src/sync/collection/meta.rs:94-116). The client persists it as the current URL and prefers it over the custom URL (qt/aqt/sync.py `on_future_done`; profiles.py:696-719). Changing the custom URL clears the current URL.
- **Normal sync:** if `sync_media=True` and no full sync is required, the backend starts media sync in the background with `server_media_usn` (backend/sync.rs:386-390).
  - Afterwards: `col._load_scheduler()`; record `host_number` / `new_endpoint`; show `server_message`.
  - Poll `col.latest_progress().normal_sync` (stage / added / removed) every 150 ms during the sync (qt/aqt/sync.py).
- **Full sync** (qt/aqt/sync.py `full_download` / `full_upload`):
  1. `col.close_for_full_sync()`
  2. `col.full_upload_or_download(auth=…, server_usn=out.server_media_usn if media_enabled else None, upload=bool)`; progress via `latest_progress().full_sync{transferred,total}`
  3. finally `col.reopen(after_full_sync=True)`. The backend has already rebuilt the collection itself (backend/sync.rs:401-457); `reopen` only reloads the scheduler.
  - With `server_usn` set, media sync starts automatically afterwards.
  - Qt also takes a backup before a full download.
- **Media:** poll `col.media_sync_status()` until `active` is false (qt/aqt/mediasync.py:50-75).
- **Errors:** `anki.errors.SyncError` with `.kind` (`SyncErrorKind.AUTH` → clear the hkey) and `Interrupted` (errors.py:48-71).

### Official sync server
- `python -m anki.syncserver` → `RustBackend.syncserver()` (pylib/anki/syncserver.py; _backend.py:93-95). It blocks and shuts down on Ctrl-C, so **run it as a separate process**. It defaults `RUST_LOG=anki=info`.
- Routes: `/sync/*`, `/msync/*` and `GET /health` (rslib/src/sync/http_server/mod.rs:242-253).
- Environment variables (mod.rs:63-143, 223, 270; request/mod.rs:180-191; docs-site/manual/sync-server.mdx):
  - `SYNC_USER1=user:pass` (required); `SYNC_USER2`, `SYNC_USER3`… for more users.
  - The hkey is `hex(sha1("user:pass"))` (mod.rs:146-149).
  - `PASSWORDS_HASHED` (any value): the passwords are then PHC-format PBKDF2 hashes. Plaintext passwords are hashed with a fixed salt.
  - `SYNC_BASE`: data folder, default `~/.syncserver`, with one sub-folder per username.
  - `SYNC_HOST`: default `0.0.0.0`. `SYNC_PORT`: default `8080`.
  - `SYNC_IP_HEADER`: an `axum_client_ip::ClientIpSource`, default `ConnectInfo`; use the matching value when behind a proxy.
  - `MAX_SYNC_PAYLOAD_MEGS`: default 100. Uncompressed limit = 3×.
- Reverse proxy on a sub-path: the client URL **needs a trailing slash**.

---

## Implementation checklist

1. **Static routing:** `/_anki/*` → `WEB/*`; `/_app/*` → `WEB/sveltekit/_app/*`; route prefixes → patched `index.html` (strip the CSP meta or keep it, and insert `<script src="/_host/bridge.js">` before the inline start script); everything else → `col.media.dir()`. Add the `/editor/<x>` media and `_anki` fallback described in B.
2. **POST `/_anki/{method}`:**
   - Camel→snake and `col._backend.{snake}_raw(body)` for the raw list.
   - Custom handlers for the FrontendService methods: profile/meta/config JSON (return `null` for missing keys), `getSchedulingStatesWithContext`, `setSchedulingStates`, `congratsInfo`, `changeNotetype` (inject note_ids), `updateDeckConfigs`, `deckOptions*`, `import*`, `closeAddCards`, `closeEditCurrent`, `convertPastedImage`, `openFilePicker`, `recordAudio`, `playFile`, `askUser`, `showMessageBox`, clipboard, `openLink`, `openMedia`, `searchInBrowser`, `open*Dialog`, `saveCustomColours`.
   - Run in a threadpool; return 500 with a text body on error.
   - Read `Anki-Op-Changes` to broadcast changes. Push them to open pages with `anki.onOperationDidExecute(json)`.
3. **bridge.js:** define `window.bridgeCommand = window.pycmd = (cmd, cb) => …` (postMessage to the parent shell, or POST to your server). Optionally add a `fetch` wrapper for the UI-only RPCs.
4. **Editor:**
   - On `editorReady`, call `loadNote({...})` per mode.
   - Watch for `saved`, `closeAddCards`, `closeEditCurrent` and `/_anki/addNote`.
   - Provide upload-backed `openFilePicker` and `recordAudio` that return server paths.
5. **Reviewer:**
   - Build the stdHtml skeleton.
   - Per card: `_showQuestion(json(q), json(a), "card cardN …")`, `_drawFlag`, `_drawMark`; run the mutation snippet; wait for `statesMutated`; get the typed answer via `getTypedAnswer()`.
   - `_showAnswer(json(a))`.
   - `build_answer` + `answer_card` using the stored (possibly mutated) states.
