# AnkiDroid Feature Parity Checklist (for the PWA clone)

I built this from the shallow clone at `C:\Users\dani\Documents\AnkiIos\reference\ankidroid` by reading menus, layouts, preference XML, ViewModels and the screen classes.

**Path shorthands** (all relative to the repo root):
- `J/` = `AnkiDroid/src/main/java/com/ichi2/anki/`
- `R/` = `AnkiDroid/src/main/res/` (menus in `R/menu`, layouts in `R/layout`, preferences in `R/xml`)
- `S/` = `common/android/src/main/res/values/` (English strings, mostly in `10-preferences.xml`)
- `ASSETS/` = `AnkiDroid/src/main/assets/`
- Preference key names are defined in `R/values/preferences.xml`. Enum arrays and values are in `R/values/constants.xml`.

**Relevance tags**
- **[W]** needed for web parity.
- **[W~]** keep the feature but adapt it for the web (Web Audio, MediaRecorder, File System Access / downloads, Wake Lock, Web Share Target, etc.).
- **[X]** Android-only or not applicable.

**Two study screens exist.**
- The legacy reviewer (`J/Reviewer.kt` + `J/AbstractFlashcardViewer.kt`) is still the default.
- The "new study screen" (`J/ui/windows/reviewer/*`) is switched on by the pref `newReviewerOptions`. It uses `ViewerAction` instead of `ViewerCommand`.

The checklist covers both. The new screen is cleaner to copy.

---

## 0. App shell / navigation

- **[W] Navigation drawer** (`R/menu/navigation_drawer.xml`, `J/NavigationDrawerActivity.kt`)
  - Items: Decks, Card browser, Statistics, Settings, Help, Support AnkiDroid.
- **[W~] Bottom navigation** (dev option `devBottomNav`; `R/menu/bottom_nav_menu.xml`, `J/BottomNavController.kt`, `J/MoreFragment.kt`)
  - Tabs: Home, Browse, Stats, More.
  - Alt+1, Alt+2, Alt+3, Alt+4 switch tabs (`DeckPicker.dispatchKeyEvent`).
- **[W] "More" screen** (`R/layout/fragment_more.xml`)
  - Settings.
  - Help: Using AnkiDroid, Get help, Community, Privacy.
  - Support: Donate, Translate, Develop, Rate, Other, Send feedback.
- **[W] Help dialogs** (`J/dialogs/help/HelpDialog.kt`): link lists, with URLs in `R/values/constants.xml`.
  - AnkiDroid manual, Anki manual, FAQ, mailing list, report bug, send crash report.
  - Anki forums, Reddit, Discord, Facebook, Twitter.
  - Privacy policy (AnkiDroid and AnkiWeb), AnkiWeb terms.
- **[W] Global undo** with Ctrl+Z (`J/AnkiActivity.kt:708`, `J/Undo.kt`). The undo label comes from the backend (`undoLabel()`, e.g. "Undo Answer Card").
- **[W] Tablet / large screen split layouts**
  - Deck list + study options pane, with a resizable divider (`J/ui/ResizablePaneManager.kt`).
  - Browser + editor side by side (dev option `cardBrowserFragmented`).
  - Note editor + live previewer pane.

---

## 1. Deck Picker (home)

**Files:** `J/DeckPicker.kt`, `J/deckpicker/DeckPickerViewModel.kt`, `J/deckpicker/DisplayDeckNode.kt`, `J/deckpicker/DeckFilters.kt`, `J/deckpicker/DeckDeletion.kt`, `J/deckpicker/BackgroundImage.kt`, `J/widgets/DeckAdapter.kt`, `J/DeckPickerFloatingActionMenu.kt`, `R/layout/include_deck_picker.xml`, `R/layout/item_deck.xml`, `R/layout/include_floating_add_button.xml`, `R/menu/deck_picker.xml`

### 1.1 Deck list rendering (`J/widgets/DeckAdapter.kt`)
- [W] Tree of decks, indented by depth (`nestedIndent * depth`).
  - The row shows only the last component of the deck name (`lastDeckNameComponent`).
- [W] Expand/collapse chevron, shown only when the deck has children.
  - The collapsed state is saved per deck in the collection (`toggleDeckExpand`).
  - If no deck has subdecks, the expander column is hidden for every row.
- [W] Three counts per row: New, Learn, Review.
  - Light-theme colours: new indigo_700, learn red_700, review green_800.
  - A zero count is drawn in a faint colour (`#1f000000`).
  - Dark theme colours are in `R/values/theme_dark.xml`.
- [W] Filtered (dynamic) deck names use a distinct colour (`dynDeckColor` `#2222bb` in light theme).
- [W] The current/selected deck has a highlighted background (`currentDeckBackground`).
- [W] Tap on deck name:
  - If cards are due: open the Reviewer. On tablets, show the study options panel instead.
  - If the deck is empty: snackbar "Empty deck" with an Add action.
  - If finished for now: open the Congrats screen (`DeckPicker.handleDeckSelection`).
- [W] Tap on the counts area opens the Study Options screen (`DeckSelectionType.SHOW_STUDY_OPTIONS`).
- [W] Long-press or right-click on a row opens the deck context menu (§1.3).
- [W] "Studied today" summary line under the list (`review_summary_text_view`, from `sched.studiedToday()`).
- [W] Empty collection placeholder: "no cards" title + description (`no_decks_placeholder`).
- [W] Pull-to-refresh triggers sync (`setupPullToSync`).
- [W~] Optional custom background image behind the list; rows become semi-transparent (`BackgroundImage.kt`, prefs `deckPickerBackground` / `removeWallPaper`).
- [W] Deck search/filter in the toolbar (`deck_picker_action_filter`).
  - Only visible when the collection has **10 or more decks** (`refreshMenuState`).
  - Filters the tree live (`DeckFilters.kt`).
- [W] Day rollover refresh of counts (`J/DayRolloverHandler.kt`).

### 1.2 FAB speed-dial (`J/DeckPickerFloatingActionMenu.kt`)
- [W] Main "+" button:
  - First tap opens the menu.
  - Tap again (menu open), or double-tap, opens **Add note**.
- [W] Sub-buttons:
  - **Get shared decks** → AnkiWeb shared decks browser.
  - **Create filtered deck** → filtered deck options.
  - **Create deck** → `CreateDeckDialog`.
- [W] ESC closes the menu. Tapping the dimmed background closes it. Back closes it.
- Note: Image Occlusion is reached from the Note editor (IO note type) or a share intent, not from the FAB.

### 1.3 Deck context menu (long-press) (`J/dialogs/DeckPickerContextMenu.kt`, `J/contextmenu/DeckPickerMenuContentProvider.kt`)
Items in order, with conditions:
1. **Add** (add note into this deck; also sets it as current).
2. **Browse cards** (opens the browser filtered to this deck).
3. **Rebuild**: filtered decks only.
4. **Empty**: filtered decks only.
5. **Rename deck** (`CreateDeckDialog`, type `RENAME_DECK`).
6. **Create subdeck**: normal decks only (`SUB_DECK`).
7. **Deck options**: normal decks open the deck-options page; filtered decks open the filtered deck options.
8. **Custom study**: normal decks only (§7.2).
9. **Export deck** (opens the export dialog preselected to this deck).
10. **Unbury**: only if `sched.haveBuried()`.
11. **Create shortcut** [X] (Android launcher shortcut).
12. **Edit deck description**: normal decks only.
    - `J/dialogs/EditDeckDescriptionDialog.kt` with a "Format as Markdown" checkbox.
13. **Schedule reminders**: only if the new reminders option is on (§10).
14. **Delete deck**
    - `DeckPickerConfirmDeleteDeckDialog` shows the card count.
    - The deletion is undoable: snackbar "N cards deleted" with Undo.
    - The adjacent deck is selected afterwards (`DeckDeletion.kt`).

### 1.4 Toolbar / overflow menu (`R/menu/deck_picker.xml`, `DeckPicker.onOptionsItemSelected`)
- [W] **Search decks** (see §1.1).
- [W] **Sync** button (`J/SyncActionProvider.kt`). Icon/badge states (`updateSyncIconFromState`):
  - Normal: no badge.
  - PendingChanges: warning-colour dot badge (only if pref `showSyncStatusBadge`).
  - OneWay (full sync required): red "!" badge, tooltip "One-way sync".
  - NotLoggedIn: red "!" badge, tooltip "No account".
  - A media-sync progress bar shows under the icon. Tapping during media sync shows media sync progress.
- [W] **Undo** with a dynamic label ("Undo <action>"). Visible only when undo is available.
- [W] **Checks** submenu:
  - **Check database**: confirm dialog, then backend `checkDatabase`, then a result report (`J/DatabaseCheck.kt`).
  - **Check media**: `J/mediacheck/MediaCheckFragment.kt` (§10.6).
  - **Empty cards**: `J/dialogs/EmptyCardsDialogFragment.kt` (§10.7).
- [W] **Create backup**: toast "Backup created" or "unchanged".
- [W] **Restore from backup**: `DatabaseErrorDialog` `DIALOG_CONFIRM_RESTORE_BACKUP`, then a list of backups.
- [W] **Manage note types** (`J/notetype/ManageNotetypes.kt`).
- [W] **Import** (`J/dialogs/ImportFileSelectionFragment.kt`): APKG, COLPKG, CSV/TSV/TXT.
- [W] **Export** collection (`J/export/ExportDialogFragment.kt`).
- [W] With the study-options pane on tablets: Rename deck and Delete deck for the focused deck.

### 1.5 Deck picker keyboard shortcuts (`DeckPicker.onKeyUp`, list at `DeckPicker.kt:2444`)
| Key | Action |
|---|---|
| A | Add note |
| B | Open browser |
| Ctrl+B | Restore backup dialog |
| Ctrl+Shift+B | Create backup |
| Y | Sync |
| / | Search decks |
| S | Study selected deck |
| T | Statistics |
| C | Check database |
| D | Create deck |
| F | Create filtered deck |
| DEL (tablet pane) | Delete deck (confirm) |
| Shift+DEL (tablet pane) | Delete deck without confirmation |
| R (tablet pane) | Rename deck |
| P | Settings |
| M | Check media |
| Ctrl+E | Export collection |
| Ctrl+Shift+I | Import |
| Ctrl+Shift+N | Manage note types |

### 1.6 Startup / lifecycle behaviours (`DeckPicker.kt`)
- [W] Automatic sync on start and on exit (`automaticSync`). Conditions:
  - pref `automaticSyncMode` is on;
  - online, and not blocked by the metered policy;
  - logged in;
  - at least **10 minutes** since the last sync (`AUTOMATIC_SYNC_MINIMAL_INTERVAL`);
  - the backend `syncStatus` reports changes. If there are no collection changes, only media is synced.
- [W] Exit runs a background sync before closing (`exitAndSyncBackCallback`).
- [W~] Optional "double-tap back to exit" (pref `exitViaDoubleTapBack`).
- [W] Sync automatically on resume after logging in (`INTENT_SYNC_FROM_LOGIN`).
- [W] "What's new" changelog after an upgrade (`ChangelogDestination`, `J/Info.kt`, `ASSETS/changelog.html`).
- [W~] Backup prompt dialog (`J/dialogs/BackupPromptDialog.kt`).
  - Nags the user to sync or export roughly every 2 weeks.
  - After 2 dismissals the user can disable it permanently.
- [X] Storage permission, scoped storage, analytics opt-in and scheduler v1→v2 upgrade prompts.
- [W~] Error dialogs: collection load failure, DB locked, disk full, incompatible DB version (`J/dialogs/DatabaseErrorDialog.kt`, enum `DatabaseErrorDialogType`).

### 1.7 Study Options / deck overview (`J/StudyOptionsFragment.kt`, `J/StudyOptionsViewModel.kt`, `R/layout/fragment_study_options.xml`, `R/menu/study_options_fragment.xml`)
- [W] Deck name, shown as a truncated path: first, second … last component.
- [W] Deck description rendered as HTML.
  - script/style tags are stripped; newlines become `<br>`; media images are inlined.
  - Filtered decks show a fixed "dynamic deck" description.
- [W] Today's counts: New, Learning, To Review.
  - Each count has a "+N buried" sublabel.
  - A "counts differ" label is shown when buried cards exist.
- [W] Totals: "Total new cards" and "Total cards".
- [W] **Study** button.
  - On the congrats state for a normal deck it becomes a **Custom study** button.
  - Hidden when the deck is empty.
- [W] Menu items:
  - **Deck options**, or **Study options** for filtered decks.
  - **Custom study**: normal decks.
  - **Rebuild** / **Empty**: filtered decks.
  - **Unbury**: when buried cards exist.
  - **Schedule reminders**: new reminders option.
  - **Undo** (`R/menu/activity_study_options.xml`).

### 1.8 Congratulations screen
- Default behaviour: a snackbar/toast.
  - "Congratulations! You have finished this deck for now", or "Next learning card due in X" (`CongratsPage.getDeckFinishedMessage`, from `sched.congratulationsInfo()`).
  - "No cards due" if the deck has no cards.
- [W] Full Congrats page (`J/pages/CongratsPage.kt`; enabled by dev option `new_congrats_screen`, and also used when a deck is finished from the deck picker):
  - Upstream Svelte route `congrats`.
  - Bridge commands: `unbury`, `customStudy`.
  - Unbury chooser: Manually buried / Buried siblings / All buried (`UnburyDeckRequest.Mode`).
  - Toolbar: **Deck options**.
  - Auto-returns to study when cards become available (e.g. after a rebuild).

---

## 2. Reviewer (study screen)

**Files:** `J/Reviewer.kt`, `J/AbstractFlashcardViewer.kt`, `J/reviewer/*`, `J/cardviewer/*`, `R/menu/reviewer.xml`, `R/layout/activity_reviewer*.xml`, `R/layout/include_reviewer_*.xml`.
**New study screen:** `J/ui/windows/reviewer/ReviewerFragment.kt`, `ReviewerViewModel.kt`, `ReviewerMenu.kt`, `J/preferences/reviewer/ViewerAction.kt`, `J/preferences/reviewer/ReviewerMenuSettingsFragment.kt`.

### 2.1 Layout elements
- [W] **Top bar** (`R/layout/include_reviewer_topbar.xml`, pref `showTopbar`, default on):
  - New / Learn / Review counts. The queue of the current card is **underlined** (`Reviewer.updateScreenCounts`).
  - Counts are hidden if the collection config "show remaining due counts" is off.
  - "Chosen answer" indicator: 1–4 coloured dots for ~1 s after answering (`J/reviewer/PreviousAnswerIndicator.kt`).
  - Flag colour icon and Mark (star) icon for the current card.
  - **Answer timer** (`J/reviewer/AnswerTimer.kt`): shown if the deck option "show timer" is on. Stops and turns red (`maxTimerColor`) at the deck's max answer time. Pauses when the app is backgrounded.
  - Optional ETA (pref `showETA`) and deck title in the toolbar (pref `showDeckTitle`).
- [W] **Card WebView** (§2.8).
- [W] **Answer area** (`R/layout/include_reviewer_answer_buttons.xml`):
  - Question side: a **Show answer** button.
  - Optional minimum press time before it registers (`showCardAnswerButtonTime`, 0–2000 ms).
  - Answer side: **Again / Hard / Good / Easy**.
    - Each button shows its next interval above it when pref `showEstimates` (deck/collection setting) is on.
    - Colours: again red, hard orange, good green, easy blue (`againBackgroundColor` etc. in `R/values/theme_light.xml`).
  - Optional 2-row large buttons (`showLargeAnswerButtons`).
  - Button size 10–200 % (`answerButtonSize`).
  - Position top / bottom / none (`answerButtonPosition`).
  - New screen: hide Hard and Easy (`hideHardAndEasy`); hide answer buttons entirely (`showAnswerButtons`).
  - The second tap within `doubleTapTimeout` (default 200 ms) is ignored (accidental double-tap protection).
- [W] **Type-in answer field**. Native EditText (`answer_field`) or an HTML input inside the card when pref `useInputTag` is on.
- [W~] **Mic toolbar** for voice recording and playback (`include_reviewer_mic_tool_bar.xml`). In the new screen this is "Check pronunciation": `J/ui/windows/reviewer/audiorecord/*`.
- [W] **Whiteboard overlay** (§2.7).
- [W] **Timebox reached dialog**: "N cards studied in M minutes" with Continue / Finish (`Reviewer.dealWithTimeBox`; collection setting "Timebox time limit").
- [W] **Leech notice** snackbar: "Card was a leech. It has been suspended." (`ReviewerViewModel.onLeech`).
- [W] **Answer feedback** animation in the new screen: an icon for the chosen rating (`AnswerFeedbackView.kt`, pref `showAnswerFeedback`, default on).
- [W~] Fullscreen modes, legacy (`fullscreenMode`): off / hide system bars / hide system bars + answer buttons.
  - New screen: `hideSystemBars` (none / status / navigation / all) and `ignoreDisplayCutout`.
  - New screen: frame style Card / Box (`reviewerFrameStyle`) and toolbar position top / bottom / none (`reviewerToolbarPosition`).
- [W~] Keep screen on (`keepScreenOn`). On the web, use the Wake Lock API.

### 2.2 Menu / app-bar actions
Legacy `R/menu/reviewer.xml` handled in `Reviewer.onOptionsItemSelected`; new screen `ViewerAction` + `ReviewerMenu.kt`.
- [W] Undo and Redo, with dynamic labels from the backend.
  - When the whiteboard has strokes, Undo becomes "Undo last stroke".
- [W] Flag submenu: None, Red, Orange, Green, Blue, Pink, Turquoise, Purple.
  - Flag names are user-renamable (`J/dialogs/FlagRenameDialog.kt`, `Flag.queryDisplayNames`).
  - The menu icon shows the current flag colour.
- [W] Edit note (opens the Note Editor).
- [W] Add note.
- [W] Card info, and **Previous card info**: upstream `card-info/<cid>` page.
- [W] Edit tags (Tags dialog, §3.4).
- [W] Bury submenu: Bury card / Bury note. If the note has no siblings, only "Bury card" is shown.
- [W] Suspend submenu: Suspend card / Suspend note. Same sibling rule.
- [W] Delete note (with undo).
- [W] Mark / Unmark note: toggles the `marked` tag; the icon is a filled or outline star.
- [W] Schedule submenu: **Set due date** (§4.5 dialog) and **Reset card** (forget dialog).
- [W] Replay audio.
- [W~] Toggle voice playback / mic toolbar ("Record voice").
- [W~] Select TTS voice: only when the TTS pref is on (`J/dialogs/TtsVoicesDialogFragment.kt`).
- [W] Deck options.
  - Hidden for filtered decks in the legacy screen.
  - The new screen offers a chooser between the current deck, the card's home deck and the original deck (`getDeckOptionsTargets`).
- [W] Toggle auto-advance: visible only if the deck has auto-advance configured or it is active.
- [W] Whiteboard toggles: Enable/Disable whiteboard, Show/Hide whiteboard, Toggle eraser, Toggle stylus mode, Change pen colour, Clear, Save whiteboard (as an image).
- [W] User actions 1–9: run `userAction(n)` / `ankidroid.userAction(n)` JS defined by the card template.
- New screen only: [W] **Browse** (opens the browser at the current card) and [W] **Statistics**.

**Toolbar placement customisation**
- Legacy "App bar buttons" (`R/xml/preferences_custom_buttons.xml`). Each action is set to one of: Always show = 2, Show if room = 1, Menu only = 0, Disabled = 3. Defaults:

| Default | Actions |
|---|---|
| Always (2) | undo, flag, toggle eraser, show/hide whiteboard |
| If room (1) | redo, edit, replay, mark, stylus, pen colour, clear whiteboard |
| Menu only (0) | set due date, tags, select TTS, deck options, mic toolbar, auto advance, bury, suspend, delete, enable whiteboard, save whiteboard |
| Disabled (3) | add note, card info, previous card info, user actions 1–9 |

- New screen menu settings (`ReviewerMenuSettingsFragment`, `MenuDisplayType` = ALWAYS / MENU_ONLY / DISABLED, drag to reorder). Defaults:

| Default | Actions |
|---|---|
| ALWAYS | Undo |
| MENU_ONLY | Redo, Flag, Mark, Edit, Bury, Suspend, Delete, Toggle whiteboard |
| DISABLED | Browse, Statistics, Deck options, Card info, Previous card info, Add note, Tags, Set due date, Reset progress, Toggle auto-advance, Record voice, Replay media, User actions 1–9 |

### 2.3 Commands and default key bindings
`J/cardviewer/ViewerCommand.kt` (legacy) and `J/preferences/reviewer/ViewerAction.kt` (new). Each binding can be restricted to the Question side, the Answer side, or Both. Bindings are stored in pref `binding_<NAME>`.

| Command | Default keys |
|---|---|
| SHOW_ANSWER | (new screen) Space, Enter, Numpad Enter, on the question side |
| ANSWER_AGAIN | 1, Numpad1, gamepad Y (answer side) |
| ANSWER_HARD | 2, Numpad2, gamepad X (answer side) |
| ANSWER_GOOD | 3, Numpad3, Space, Enter, Numpad Enter, DPAD center, gamepad B (answer side) |
| ANSWER_EASY | 4, Numpad4, gamepad A (answer side) |
| UNDO | Ctrl+Z |
| REDO | Ctrl+Shift+Z |
| EDIT | E |
| ADD_NOTE | A |
| MARK | `*` |
| BURY_CARD | `-` |
| BURY_NOTE | `=` |
| SUSPEND_CARD | `@` |
| SUSPEND_NOTE | `!` |
| PLAY_MEDIA (replay) | R, F5 (legacy); R (new) |
| REPLAY_VOICE | V |
| RECORD_VOICE | Shift+V |
| SAVE_VOICE (legacy) | Shift+S |
| TOGGLE_FLAG_RED…PURPLE | Ctrl+1 … Ctrl+7 (and Ctrl+Numpad). Toggles: the same flag again unsets it. |
| TOGGLE_AUTO_ADVANCE | Shift+A |
| SHOW_HINT | H (reveals the next `{{hint:}}`) |
| SHOW_ALL_HINTS | G |
| PREVIOUS_CARD_INFO | Ctrl+Alt+I |
| RESET_PROGRESS (new) | Ctrl+Alt+N |
| BROWSE (new) | B |
| STATISTICS (new) | T |
| No default binding | DELETE, EXIT, UNSET_FLAG, PAGE_UP, PAGE_DOWN, TAG, CARD_INFO, TOGGLE_WHITEBOARD, TOGGLE_ERASER, CLEAR_WHITEBOARD, CHANGE_WHITEBOARD_PEN_COLOR, RESCHEDULE_NOTE (set due date), USER_ACTION_1..9 |

- New-screen whiteboard bindings (no defaults; `J/preferences/reviewer/WhiteboardAction.kt`): `binding_whiteboard_TOGGLE_ERASER`, `CLEAR`, `UNDO`, `REDO`.
- Binding types (`J/reviewer/Binding.kt`, `Gesture.kt`, `Axis.kt`, `Gamepad.kt`): key + modifiers, unicode char, touch gesture, joystick/gamepad axis [X].

### 2.4 Gestures (`J/cardviewer/Gesture.kt`, `GestureProcessor.kt`, `J/reviewer/GestureMapper.kt`, `J/ui/windows/reviewer/GestureParser.kt`)
- [W] Gesture list:
  - Swipe up / down / left / right.
  - Double tap.
  - Tap zones. Default 4-point mode: top / left / center / right / bottom. With pref `gestureCornerTouch`, a 9-point grid adds the corners.
  - Two-, three- and four-finger tap.
  - [X] Shake.
- [W] **There are no default gesture bindings in the current code.**
  - Legacy gestures are opt-in via the master switch `gestures` (default off).
  - The new screen uses whatever bindings exist.
  - Old preferences such as `gestureSwipeUp` are only migrated (`J/servicelayer/PreferenceUpgradeService.kt`, `UpgradeGesturesToControls`).
- [W] Swipe sensitivity 20–180 % (`swipeSensitivity`, default 100).
- [W] Gestures are ignored on interactive elements, during text selection and on scrollable areas (`ASSETS/scripts/ankidroid-reviewer.js`).
- [X] Volume keys are bindable.

### 2.5 Type-in answer (`J/cardviewer/TypeAnswer.kt`, `TypeAnswerModifiers.kt`, `ASSETS/scripts/type-answer.js`, `ASSETS/flashcard.css`)
- [W] `{{type:Field}}`, `{{type:cloze:Field}}`, and modifiers `nc:` (ignore combining characters) and `nosuggest:`.
- [W] Uses the field's font and size. Enter in the field shows the answer.
- [W] The answer side shows the comparison via backend `compareAnswer`, with CSS classes `.typeGood`, `.typeBad`, `.typeMissed`.
- [W] Auto-focus the field (pref `autoFocusTypeInAnswer`, default on). Choice of in-card HTML input vs native field (`useInputTag`).

### 2.6 Audio, video and TTS (`J/cardviewer/CardMediaPlayer.kt`, `SoundTagPlayer.kt`, `CardSoundConfig.kt`, `VideoPlayer.kt`, `TTS.kt`, `J/AndroidTtsPlayer.kt`, `J/ReadText.kt`)
- [W] Autoplay unless the deck option "Don't play audio automatically" is set.
- [W] The deck option "Skip question when replaying answer" is honoured.
- [W] `[sound:]` play buttons in the card. Hide them with pref `showAudioPlayButtons` (default on).
- [W] `playsound:` link handling and `<video>` playback.
- [W] `{{tts lang:Field}}` tags. Voice selection via `{{tts-voices:}}` (`tts-voices:` URL).
- [W~] Legacy pref `tts`: read question and answer when no audio exists, with a per-deck language picker (`J/ReadText.kt`). "Reset languages" lives in Advanced settings.
- [W] Auto-advance waits for audio if the deck option says so.

### 2.7 Whiteboard
Legacy: `J/Whiteboard.kt`, `R/layout/include_reviewer_whiteboard_editor.xml`. New: `J/ui/windows/reviewer/whiteboard/*`.
- [W] Enable/disable is per deck (stored in MetaDB) and the overlay can be shown or hidden.
- [W] Pen colours: white, black, red, green, blue, yellow + custom colour picker.
- [W] Stroke-width dialog (`J/dialogs/WhiteBoardWidthDialog.kt`).
- [W] Undo stroke, clear, eraser, stylus-only mode, save as PNG.
- [W] Two-finger scroll and second-finger tap pass through to the card.
- [W] New whiteboard additions:
  - Multiple saved brushes (separate light/dark sets, default stroke width 10, black/white).
  - Add/remove brush.
  - Eraser mode Ink vs Stroke, eraser width (default 30).
  - Undo/redo.
  - Toolbar alignment left / right / bottom, hide toolbar.
  - Settings persisted in `WhiteboardRepository.kt`.

### 2.8 Card HTML/CSS rendering
`ASSETS/card_template.html`, `ASSETS/flashcard.css`, `J/cardviewer/CardAppearance.kt`, `CardTemplate.kt`, `J/reviewer/ReviewerCustomFonts.kt`, `ASSETS/scripts/card.js`
- [W] Wrapper: `<html class="mobile android linux js">`, then `<body class="card cardN [vertically_centered] [night_mode nightMode] [ankidroid_dark_mode|ankidroid_plain_mode]">`, then `<div id="content" dir="auto">`.
- [W] Loads upstream `reviewer_extras.css` + `reviewer_extras_bundle.js` (hints, image occlusion, MathJax) plus jQuery, `card.js`, `type-answer.js`, `js-api.js`.
- [W] Night mode: black background / white text, and `.nightMode .latex { filter: invert }`. The dark theme uses `#303030`.
- [W] Card zoom 10–300 % via `body { zoom }` (`cardZoom`). Image zoom 50–300 % via `img { zoom }` (`imageZoom`). The system font scale is applied as `html { zoom }`.
- [W] Center content vertically (`centerVertically`).
- [W~] Custom fonts from the AnkiDroid `fonts/` folder get injected `@font-face`.
- [W] `card.js` resizes images to 90 % of the viewport.
- [W] Link handling: external links open in the browser.
  - `intent:` / `android-app:` links are only allowed with pref `allowCardExternalLaunch`.
- [W] Page up / page down scroll the card. [X] "Double scrolling gap" for e-readers.
- [X] HTML/JS debugging is a dev option.

### 2.9 AnkiDroid JavaScript API (`ASSETS/scripts/js-api.js` v0.0.3, `J/AnkiDroidJsAPI.kt`, `J/AnkiDroidJsAPIConstants.kt`)
Usage: `const api = new AnkiDroidJS({developer, version})`, then `await api.<method>(data)`. Calls go to `POST /jsapi/<endpoint>`.
- **Counts / info**
  - ankiGetNewCardCount, ankiGetLrnCardCount, ankiGetRevCardCount, ankiGetETA
  - ankiGetNextTime1–4
  - ankiGetDeckName, ankiIsDisplayingAnswer, ankiIsInNightMode, ankiIsInFullscreen, ankiIsTopbarShown, ankiIsActiveNetworkMetered
- **Card fields**
  - ankiGetCardMark, ankiGetCardFlag
  - ankiGetCardReps, ankiGetCardInterval, ankiGetCardFactor, ankiGetCardMod
  - ankiGetCardId, ankiGetCardNid, ankiGetCardType, ankiGetCardDid, ankiGetCardLeft
  - ankiGetCardODid, ankiGetCardODue, ankiGetCardQueue, ankiGetCardLapses, ankiGetCardDue
- **Actions**
  - ankiShowAnswer, ankiAnswerEase1–4
  - ankiMarkCard, ankiToggleFlag
  - ankiBuryCard, ankiBuryNote, ankiSuspendCard, ankiSuspendNote
  - ankiResetProgress, ankiSetCardDue
  - ankiAddTagToCard, ankiAddTagToNote (deprecated), ankiSetNoteTags, ankiGetNoteTags
    - Note-tag changes require the "dangerous JS API" permission.
  - ankiSearchCard, ankiSearchCardWithCallback (require the dangerous "query collection" permission)
- **UI**
  - ankiShowToast, ankiShowNavigationDrawer, ankiShowOptionsMenu
  - ankiEnableHorizontalScrollbar, ankiEnableVerticalScrollbar
  - ankiSetFullscreenButtonsAndMenu, ankiSetFullscreenButtonsOnly, ankiSetFullscreenAllGone
- **TTS**: ankiTtsSpeak, ankiTtsSetLanguage, ankiTtsSetPitch, ankiTtsSetSpeechRate, ankiTtsIsSpeaking, ankiTtsStop, ankiTtsFieldModifierIsAvailable
- **STT**: ankiSttSetLanguage, ankiSttStart, ankiSttStop
- **Legacy global functions** (`card.js`, `ankidroid-reviewer.js`): `showAnswer()`, `buttonAnswerEase1..4()`, `reloadPage()`, `taFocus()`, `userAction(n)`, `ankidroid.showHint()`, `ankidroid.showAllHints()`.
  - URL signals: `signal:show_answer`, `signal:answer_easeN`, `signal:typefocus`, `typechangetext:`, `typeentertext:`, `missing-user-action:`, `state-mutation-error:`.
- **Custom scheduling hooks**: `getSchedulingStatesWithContext` / `setSchedulingStates` (deck-options custom scheduling JS).

### 2.10 Auto-advance (`J/ui/windows/reviewer/autoadvance/*`, `J/reviewer/AutomaticAnswer.kt`)
- [W] Driven by deck options:
  - seconds to show the question, then: show answer or show reminder;
  - seconds to show the answer, then: bury card / answer again / answer good / answer hard / show reminder;
  - wait for audio.
- [W] Toggle with Shift+A or the menu. It stops on user interaction.

### 2.11 Other reviewer behaviours
- [W] Back / EXIT returns to the deck list.
- [W] Undo restores the previous card.
- [W] Edits made from the reviewer refresh the current card.
- [W] Card info and Previous card info open the upstream page.
- [X] Shake gesture, volume keys, hardware/gamepad axes, Android screen-cutout handling.

### 2.12 Card Previewer (browser preview)
`J/previewer/PreviewerFragment.kt`, `PreviewerViewModel.kt`, `PreviewerAction.kt`, `R/menu/previewer.xml`
- [W] Next / previous card, a slider to jump between cards, and an "N / total" indicator.
- [W] Toggle "back side only".
- [W] Flag, Mark, Edit, Replay audio.
- [W] Default keys:

| Key | Action |
|---|---|
| ← / → | Back / Next |
| `*` | Mark |
| R | Replay |
| E | Edit |
| B | Back side only |
| Ctrl+1..7 | Flags |

  Bindings are stored in pref keys `previewer_*` (`R/xml/preferences_previewer_controls.xml`).
- [W] Template previewer (note editor, card template editor): `J/previewer/TemplatePreviewerFragment.kt`, `TemplatePreviewerPage.kt`, with a tab per card template and front/back.

---

## 3. Note Editor

**Files:** `J/NoteEditorFragment.kt`, `J/NoteEditorActivity.kt`, `J/noteeditor/*`, `J/FieldEditLine.kt`, `J/FieldEditText.kt`, `J/multimedia/*`, `R/layout/fragment_note_editor.xml`, `R/menu/note_editor.xml`

### 3.1 Header and fields
- [W] **Note type** spinner.
  - In Add mode, changing it re-creates the fields.
  - In Edit mode it opens the **Change note type** dialog (§5.6).
- [W] **Deck** selector (`DeckSelectionDialog`: search, create deck/subdeck, no filtered decks).
  - Default deck comes from General pref "Deck for new cards" (`useCurrent`): 0 = use current deck, 1 = decide by note type.
  - If the current deck is filtered, Default (id 1) is used.
  - Editing an existing card and changing the deck moves the affected cards.
- [W] One editor per field (`FieldEditLine`):
  - field label;
  - **sticky toggle** (push-pin; Add mode only; keeps the value for the next note);
  - **media button** (attachment bottom sheet);
  - expand/collapse button;
  - per-field keyboard language hint (`Field.languageHint`).
- [W] **Duplicate check**: the first field gets a "duplicate" style when `note.fieldsCheck` returns DUPLICATE (`setDuplicateFieldStyles`).
- [W] Other validation on save:
  - empty first field;
  - cloze note type without a cloze shows a "no cloze" dialog (`noClozeDialog`);
  - the error message comes from `checkNoteFieldsResponse`.
- [W] **Tags** button opens the Tags dialog (§3.4).
- [W] **Cards** button ("Cards: Card 1, Card 2") opens the Card Template Editor (§6.3).
- [W] Unsaved-changes confirmation on back (`J/dialogs/DiscardChangesDialog.kt`).
- [W] After adding: snackbar "Added N cards". The editor stays open for the next note, with sticky fields kept.
- [W~] Text-selection context menu adds **Cloze deletion** for cloze types (`J/CustomActionModeCallback.kt`). Paste as plain text is supported.
- [W] Pref `pastePNG` (default on): paste clipboard images as PNG.
- [W] Pref `noteEditorNewlineReplace` (default on): `<br>` is shown as newline while editing.
- [X] Integration with the Aedict app.

### 3.2 Formatting toolbar (`J/noteeditor/Toolbar.kt`, `R/layout/view_note_editor_toolbar.xml`)
- [W] Built-in buttons:
  - Bold `<b>`, Italic `<i>`, Underline `<u>`.
  - Horizontal rule `<hr>`.
  - Heading (h1–h5 chooser).
  - Font size: `<span style="font-size:xx-small … xx-large">` (7 sizes).
  - MathJax inline `\( \)`. Long-press opens a chooser: block `\[ \]`, chemistry `\( \ce{} \)` (`J/noteeditor/MathJaxFormat.kt`).
- [W] Cloze buttons when the note type is cloze:
  - new cloze number (Ctrl+Shift+C);
  - same cloze number (Ctrl+Shift+Alt+C).
- [W] **Custom toolbar buttons** (`J/noteeditor/CustomToolbarButton.kt`).
  - Created with the "+" button; each has a label, prefix HTML and suffix HTML.
  - Long-press to edit or remove.
  - The Nth button is bound to Ctrl+N (1–9, 0 = 10th).
  - Stored in a shared-pref string set.
- [W] Menu toggles: **Show toolbar**, **Scroll toolbar**.

### 3.3 Menu (`R/menu/note_editor.xml`)
- [W] Save.
- [W] Preview: opens the template previewer with the unsaved fields. Disabled when the side-pane previewer is visible.
- [W] Add note: shown while editing; opens a fresh Add.
- [W] Copy note: Add mode is prefilled with the current fields; enabled only if a field is non-empty.
- [W] Font size: editor text size.
- [W] Capitalize: auto-capitalise the first letter (default on).
- [W] Show/hide previewer pane (tablet).
- [W] Keyboard shortcuts:

| Key | Action |
|---|---|
| Ctrl+Enter | Save |
| Ctrl+D | Select deck |
| Ctrl+L | Card templates |
| Ctrl+N | Note type (in edit mode: change note type) |
| Ctrl+Shift+T | Tags |
| Ctrl+Shift+C | Cloze |
| Ctrl+P | Preview |
| Ctrl+Shift+1..0 | Focus field 1..10 |

### 3.4 Tags dialog (`J/dialogs/tags/TagsDialog.kt`, `TagsList.kt`, `TagsArrayAdapter.kt`, `R/menu/tags_dialog_menu.xml`)
- [W] Modes: EDIT_TAGS (one or more notes), FILTER_BY_TAG (browser), CUSTOM_STUDY.
- [W] Hierarchical tags (`::`) shown as an expandable tree.
- [W] Checkbox per tag. A tri-state "indeterminate" state appears when only some of the selected notes have the tag.
- [W] Filter/search box, **Add tag** (new tag text), **Check all**.
- [W] Tag autocomplete. The upstream `completeTag` method is also exposed to the pages.

### 3.5 Media / multimedia (`J/multimedia/MultimediaBottomSheet.kt`, `MultimediaImageFragment.kt`, `AudioRecordingFragment.kt`, `AudioVideoFragment.kt`, `J/DrawingFragment.kt`, `R/menu/image_cropper_menu.xml`)
Bottom-sheet actions:
- [W] **Image from gallery/file**: preview, file size, crop / rotate / flip horizontally / flip vertically, Done.
- [W~] **Take photo** (camera): on the web, use `<input capture>` or getUserMedia.
- [W] **Drawing**: a canvas, saved as PNG.
- [W~] **Record audio**: start/stop, waveform, play, delete, done. Use MediaRecorder on the web.
- [W] **Audio clip** (file) and **Video clip** (file).
- [W] Media files are added to the media folder and inserted as `<img src>` or `[sound:]` at the cursor.
- [W] Large-file warning (`showLargeMediaFileWarning`).
- [X] Advanced pref `mediaImportAllowAllFiles` (lets the picker accept unrecognised MIME types such as .opus).

### 3.6 Image Occlusion inside the note editor
- [W] When the IO note type is selected, the field editors are replaced by:
  - image source buttons: Gallery / Camera / Paste from clipboard;
  - **Edit occlusions** when editing.
- [W] Opens the upstream IO page (§5.5). Save/preview menu items are hidden (the page has its own).

### 3.7 Instant note editor (`J/instantnoteeditor/*`) [W~]
- Opened by sharing text into the app.
- A floating dialog makes a cloze note quickly:
  - tap words to toggle cloze chips;
  - "increment cloze number" mode;
  - choose deck;
  - "open full editor" button.
- Requires a cloze note type; otherwise a "no cloze types" dialog is shown.

---

## 4. Card Browser

**Files:** `J/CardBrowser.kt`, `J/browser/CardBrowserFragment.kt`, `J/browser/CardBrowserViewModel.kt`, `J/browser/*`, `R/menu/card_browser.xml`, `R/menu/card_browser_multiselect.xml`

### 4.1 Search
- [W] Toolbar search box using full Anki search syntax (backend). Default search when the browser opens is configurable.
- [W] Deck selector: "All decks" or a specific deck (`onDeckSelected`, remembered via `LastDeckIdRepository`).
- [W] **Search history** (`J/browser/SearchHistory.kt`).
- [W] **Saved searches**
  - Save the current search (Ctrl+S) with a name (`J/dialogs/SaveBrowserSearchDialogFragment.kt`).
  - List and delete them (Ctrl+Alt+S) (`J/dialogs/SavedBrowserSearchesDialogFragment.kt`).
- [W] Quick filters in the overflow menu:
  - Show marked (Ctrl+M), Show suspended (Alt+S);
  - Search by tag (tag dialog, Ctrl+T);
  - Filter by flag (submenu of 7 flags + no flag).
- [W~] New search UI (dev option `cardBrowserSearchView`, `J/browser/search/*`):
  - filter chips: Decks, Tags, Card state (new / learning / review / suspended / buried…), Flags;
  - advanced search tab with insertable examples (e.g. `tag:tex*`, `prop:ivl>=10`) and a field picker;
  - sort-order bottom sheet.
- [W] Browser options (`J/dialogs/BrowserOptionsDialog.kt`, Ctrl+Alt+T):
  - Cards vs Notes mode.
  - Truncate content.
  - Ignore accents in search.
  - Manage columns.
  - Rename flags.

### 4.2 Columns and sorting (`J/browser/CardBrowserColumn.kt`, `BrowserColumnSelectionFragment.kt`, `ColumnSelectionDialogFragment.kt`)
- [W] Available columns:
  - Sort field, Question, Answer, Deck, Tags, Card (template / card count);
  - Due, Ease, Interval, Lapses, Reviews;
  - Changed (card mod), Created, Edited (note mod), Note type;
  - FSRS Difficulty, Stability, Retrievability;
  - Original position.
- [W] The column set is separate for Cards mode and Notes mode. Defaults are Anki's `BrowserDefaults`.
- [W] Add, remove and reorder columns.
- [W] Tap a column heading to change that column.
- [W] Sorting: tap a heading to sort by it / toggle reverse; "Change display order" dialog (Ctrl+O).
- [W] Rows are tinted for suspended / buried / marked / flagged cards (`suspendedColor`, `buriedColor`, flag colours).
- [W~] Pref `card_browser_show_media_filenames` shows `[sound:]` filenames in the question/answer columns.
- [W] Pref `relativeCardBrowserFontSize` (10–200 %).

### 4.3 Row interaction
- [W] Tap opens the note editor (or loads it in the side pane on tablets).
- [W] Long-press or right-click enters multi-select. Long-press again selects the range between the last selected row and this one.
- [W] Select all (Ctrl+A); select none (Esc); toggle all/none.

### 4.4 Actions
Toolbar menu (no selection):
- Add note (Ctrl+E).
- Search, Save search, Saved searches, Display order, Show marked, Show suspended, Search by tag, Filter by flag.
- Undo, Preview (all), Select all.
- Options.
- **Create filtered deck** from the current search.
- **Find & replace** (Ctrl+Alt+F).

Multi-select menu:
- [W] Edit note: exactly 1 selected; also E.
- [W] Card info: exactly 1 selected; Ctrl+Shift+I.
- [W] Flag (submenu).
- [W] Toggle mark (Ctrl+K).
- [W] Toggle suspend (Ctrl+J).
- [W] Toggle bury (Ctrl+Shift+J).
- [W] Change note type (Ctrl+Shift+M); §5.6.
- [W] Change deck (Ctrl+D): deck selection dialog.
- [W] Reposition (Ctrl+Shift+S) (`J/browser/RepositionCardFragment.kt`):
  - start position (default 0), step (default 1);
  - Randomize order; Shift positions of existing cards;
  - shows the current queue limits; new cards only.
- [W] Set due date (Ctrl+Alt+R) (`R/layout/dialog_set_due_date.xml`):
  - tabs for a single day / a range of days (e.g. `0`, `1!`, `3-7`);
  - "Change interval to match" checkbox;
  - shows the current interval.
- [W] Edit tags (Ctrl+Shift+A): tags dialog with tri-state.
- [W] Grade now (Ctrl+Shift+G) (`J/dialogs/GradeNowDialog.kt`): answer the selected cards with Again/Hard/Good/Easy.
- [W] Reset / Forget (Ctrl+Alt+N) (`R/layout/dialog_forget_cards.xml`): checkboxes "Restore original position" and "Reset repetition and lapse counts".
- [W] Preview (Ctrl+Shift+P).
- [W] Export selected (Ctrl+Shift+E): export dialog with "selected notes/cards".
- [W] Find & replace (`J/browser/FindAndReplaceDialogFragment.kt`):
  - find, replace with;
  - In: all fields / tags / a specific field;
  - "Selected notes only", "Ignore case", "Treat input as regex".
- [W] Delete notes (DEL): undo snackbar.
- [W] Undo (Ctrl+Z).
- [W] Flags via Ctrl+1..7.
- [X] System "Card browser" text-selection context menu (PROCESS_TEXT). A web share target could replace it.

---

## 5. Svelte (upstream) pages and their native wrappers

Native wrappers are `J/pages/*`, served by the local `AnkiServer.kt` at `/_anki/<method>` (allowed method list in `J/pages/PostRequestHandler.kt`). A PWA can mostly load these pages straight from the Anki web assets.

| Page route | Wrapper | Extra native features |
|---|---|---|
| `graphs` (Statistics) | `J/pages/Statistics.kt` | Deck selector in the toolbar; **Save as PDF** (print) |
| `deck-options/<did>` | `J/pages/DeckOptions.kt` | Back closes open modals; confirm discard; "save and optimize FSRS" reload; `deckOptionsReady/RequireClose` bridge; filtered decks redirect to the native filtered options |
| `card-info/<cid>` | `J/pages/CardInfoFragment.kt` | Also used for "Previous card info" |
| `congrats` | `J/pages/CongratsPage.kt` | Unbury chooser, custom study, deck options |
| `import-csv<path>` | `J/pages/CsvImporter.kt` | Opened after picking a csv/tsv/txt |
| `import-anki-package<path>` | `J/pages/AnkiPackageImporterFragment.kt` | apkg import options page (merge/update options); undoable |
| `image-occlusion/<path or nid>` | `J/pages/ImageOcclusion.kt` + `ImageOcclusionViewModel.kt`, `R/menu/image_occlusion.xml` | Save in the menu; `addImageOcclusionNote` / `updateImageOcclusionNote` |
| Change notetype | native `J/dialogs/ChangeNoteTypeDialog.kt` + `ChangeNoteTypeViewModel.kt` | Destination type spinner; two tabs mapping **fields** and **templates**; requires a one-way sync (schema change) confirmation (`J/sync/SchemaChanges.kt`). The `getChangeNotetypeInfo` / `changeNotetype` backend methods are also exposed |

Backend methods the pages need: `i18nResources`, `getGraphPreferences`, `setGraphPreferences`, `graphs`, `getNotetypeNames`, `getDeckNames`, `getCsvMetadata`, `importCsv`, `importAnkiPackage`, `getImportAnkiPackagePresets`, `completeTag`, `getFieldNames`, `cardStats`, `getDeckConfigsForUpdate`, `updateDeckConfigs`, `computeOptimalRetention`, `computeFsrsParams`, `evaluateParamsLegacy`, `simulateFsrsReview`, `simulateFsrsWorkload`, `getRetentionWorkload`, `getIgnoredBeforeCount`, `getImageForOcclusion`, `getImageOcclusionNote`, `getImageOcclusionFields`, `addImageOcclusionNote`, `updateImageOcclusionNote`, `congratsInfo`, `setWantsAbort`, `latestProgress`, `getSchedulingStatesWithContext`, `setSchedulingStates`, `importJsonString`, `importJsonFile`, `getCustomColours`, `saveCustomColours`, `searchInBrowser`.

---

## 6. Note type management

### 6.1 Manage note types (`J/notetype/ManageNotetypes.kt`, `ManageNoteTypesViewModel.kt`, `NoteTypesAdapter.kt`, `AddNewNotesType.kt`, `R/layout/item_manage_note_type.xml`, `R/menu/note_types_more_actions.xml`)
- [W] List of note types with name and note count. Search filter in the toolbar.
- [W] Tap a row to open the **Fields editor**. The **Cards** button opens the Card Template Editor.
- [W] "More" menu: **Rename**, **Delete** (confirmation; schema change → one-way sync).
- [W] Long-press enters multi-select with checkboxes, for **bulk delete**.
- [W] **Add** note type dialog (`R/layout/dialog_new_note_type.xml`):
  - choose from "Add: <stock type>" (Basic, Basic and reversed, Basic optional reversed, Basic type-in, Cloze, Image Occlusion) or "Clone: <existing type>";
  - name field, prefilled with a randomised unique name.

### 6.2 Field editor (`J/NoteTypeFieldEditor.kt`, `J/dialogs/NoteTypeFieldEditorContextMenu.kt`, `R/layout/activity_note_type_field_editor.xml`)
- [W] List of fields. A FAB adds a field (unique-name validation).
- [W] Per-field context menu:
  - **Reposition** (enter a new 1-based position);
  - **Sort by this field** (sets the sort field);
  - **Rename**;
  - **Delete** (confirmation);
  - **Language hint** (keyboard locale picker, `J/dialogs/LocaleSelectionDialog.kt`).
- [W] Schema-changing operations show a one-way-sync confirmation.

### 6.3 Card template editor (`J/CardTemplateEditor.kt`, `CardTemplateEditorViewModel.kt`, `CardTemplateNotetype.kt`, `R/menu/card_template_editor.xml`, `R/menu/card_template_editor_navigation_bar_menu.xml`)
- [W] One tab per card type (template). Bottom navigation: **Front template / Back template / Styling (CSS)**.
- [W] Code editor for each.
- [W] Menu:

| Action | Shortcut | Notes |
|---|---|---|
| Save | Ctrl+S | |
| Preview | Ctrl+P | Template previewer with sample/real note |
| Add card type | Ctrl+N (listed as Ctrl+A) | Clones the current template |
| Reposition card type | | `J/notetype/RepositionCardTemplateDialog.kt` |
| Rename card type | Ctrl+R | `RenameCardTypeDialog.kt` |
| Delete card type | Ctrl+D | Warns about the card count; cannot delete the last one |
| Deck override | Ctrl+O | Choose a deck, or remove the override |
| Insert field | Ctrl+I | `J/dialogs/InsertFieldDialog.kt`: note fields plus special fields `{{FrontSide}}`, `{{Card}}`, `{{CardFlag}}`, `{{Deck}}`, `{{Subdeck}}`, `{{Tags}}`, `{{Type}}`, `{{CardID}}`, shown with sample output (`J/model/SpecialField.kt`) |
| Browser appearance | Ctrl+B | `J/CardTemplateBrowserAppearanceEditor.kt`: question/answer format for the browser; Restore default; Save |
| Copy as Markdown | Ctrl+M | Copies the template |
| Restore to default | | Stock note types only |

- [W] Ctrl+1 / Ctrl+2 / Ctrl+3 switch between front / back / styling.
- [W] Discard-changes confirmation. Changes go through a schema change → one-way sync confirmation.

---

## 7. Filtered decks and custom study

### 7.1 Filtered deck options (`J/filtered/FilteredDeckOptionsFragment.kt`, `FilteredDeckOptionsViewModel.kt`, `R/layout/fragment_filtered_deck_options.xml`, `R/menu/filtered_options.xml`)
- [W] Deck name.
- [W] Filter 1: search string, limit, "Cards selected by". The order labels come from the backend:
  - oldest seen first, random, increasing intervals, decreasing intervals;
  - most lapses, order added, order due, latest added first, relative overdueness.
- [W] Enable second filter: search, limit, order.
- [W] **Reschedule cards based on my answers** checkbox. When unchecked, preview delays (seconds) for Again / Hard / Good.
- [W] **Create even if empty** checkbox.
- [W] **Show excluded / unmovable cards** button: opens the browser with that search.
- [W] **Build / Rebuild** button. Help link in the menu.
- [W] Opened from the FAB "Create filtered deck" (default search prefilled), the browser's "Create filtered deck", and deck options on a filtered deck.

### 7.2 Custom study (`J/dialogs/customstudy/CustomStudyDialog.kt`, `CustomStudyViewModel.kt`, `TagLimitFragment.kt`, `R/layout/fragment_custom_study.xml`, `R/layout/fragment_tag_limit.xml`)
- [W] Options; unavailable ones are hidden based on `CustomStudyDefaults`:
  1. Increase today's new card limit by N. Shows available new cards, including subdecks.
  2. Increase today's review card limit by N.
  3. Review forgotten cards (last N days).
  4. Review ahead (N days).
  5. Preview new cards (added in the last N days).
  6. Study by card state or tag:
     - state: New cards only / Due cards only / All review cards in random order / All cards in random order (don't reschedule);
     - card count;
     - then the tag limit screen: "Require one or more of these tags" + include list + exclude list.
- [W] Extending limits adjusts today's counts. The other options create or rebuild a "Custom Study Session" filtered deck.

---

## 8. Preferences

Settings root is `R/xml/preference_headers.xml`. It has a searchable settings index (`SearchPreference`) [W]. Fragments are `J/preferences/*`. Keys are below; defaults are in parentheses.

### 8.1 General (`R/xml/preferences_general.xml`, `GeneralSettingsFragment.kt`)
- [W] `language`: app UI language (default: system).
- [X] `reportErrorMode` (2 = ask): crash reporting always / never / ask.
- [X] `analytics_opt_in_v2` (false).
- [W~] `gestureFullScreenNavigationDrawer` (false): swipe right anywhere opens the drawer.
- [W] Editing category: `pastePNG` (true) pastes clipboard images as PNG.
- [W] Studying category: `useCurrent` "Deck for new cards" (0 = use current deck, 1 = decide by note type). Stored in the collection config (`addingDefaultsMode`).
- [W~] `exitViaDoubleTapBack` (false).
- [X] System-wide: `anki_card_enable_external_context_menu` (true), `card_browser_enable_external_context_menu` (false). These are Android text-selection menus.

### 8.2 New study screen (`R/xml/preferences_reviewer.xml`, `ReviewerOptionsFragment.kt`)
- [W] `newReviewerOptions` (false): enable the new study screen.
- [W] Screen: `reviewerFrameStyle` (0 = Card, 1 = Box).
- [X] `hideSystemBars` (0 none / 1 status / 2 nav / 3 all), `ignoreDisplayCutout` (false).
- [W] Review: `showAnswerFeedback` (true), `showProgress` (remaining counts, true), `showAudioPlayButtons` (true).
- [W] Toolbar: `reviewerMenuSettings` (actions editor), `reviewerToolbarPosition` (0 top / 1 bottom / 2 none).
- [W] Answer buttons: `showAnswerButtons` (true), `showEstimates`, `hideHardAndEasy` (false).

### 8.3 Reviewing (`R/xml/preferences_reviewing.xml`). Mostly collection-level settings, so [W] and stored server-side:
- [W] `dayOffset` "Start of next day", 0–23 h. Collection config, not persisted locally.
- [W] `learnCutoff` "Learn ahead limit", minutes 0–999.
- [W] `timeLimit` "Timebox time limit", minutes 0–999.
- [W~] `keepScreenOn` (false).

### 8.4 Sync (`R/xml/preferences_sync.xml`, `SyncSettingsFragment.kt`)
- [W] `syncAccount`: AnkiWeb account (login / logged-in screen).
- [W] `syncFetchMedia` "Fetch media on sync" (always | only_unmetered | never; default always).
- [W] `automaticSyncMode` (false): sync on app start/exit if the last sync was more than 10 min ago.
- [W] `showSyncStatusBadge` (true).
- [W~] `allowMetered` (false): warn when syncing on a metered connection.
- [W] Advanced: `syncIoTimeoutSecs` network timeout (60; range 30–99999).
- [W] Advanced: `one_way_sync` forces a full sync on the next sync, with confirmation.
- [W] Advanced: Custom sync server (`R/xml/preferences_custom_sync_server.xml`):
  - `syncBaseUrl` with on/off switch `syncBaseUrl_switch`;
  - `customSyncCertificate` (PEM text) [W~].

### 8.5 Notifications (legacy) (`R/xml/preferences_notifications.xml`)
- [W~] `minimumCardsDueForNotification`: 2000000 = never, 1000000 = pending messages only (default), or more than 10/25/50/75/100/150/200/500 due. A web app can use push notifications.
- [X] `widgetVibrate`, `widgetBlink`.

### 8.6 Review reminders (new; `J/reviewreminders/ScheduleRemindersFragment.kt`, `AddEditReminderDialog.kt`, `R/layout/dialog_add_edit_reminder.xml`; enabled by dev option `newReviewReminders`)
- [W~] List of reminders, app-wide or per deck.
- [W~] Each reminder has: time, deck scope, advanced "card trigger threshold" (only notify if at least N cards are due), and "only notify if no reviews today".
- [W~] Troubleshooting screen; link to notification settings.

### 8.7 Appearance (`R/xml/preferences_appearance.xml`)
- [W] `appTheme`: follow system (0) / day (1) / night (2).
- [W] `dayTheme`: Light (1, default) / Plain (2) / E-ink (3).
- [W] `nightTheme`: Black (3, default) / Dark (4).
- [W~] Background: `deckPickerBackground` (pick image), `removeWallPaper`.
- [W] Study screen (legacy):
  - `custom_buttons_link` (App bar buttons, see §2.2);
  - `fullscreenMode` (0 off / 1 hide system bars / 2 hide system bars + answer buttons);
  - `centerVertically` (false);
  - `showEstimates` (show next review time on buttons);
  - `answerButtonPosition` (top / bottom / none; default bottom);
  - `showTopbar` (true);
  - `showProgress` (remaining count; depends on the top bar);
  - `showETA` (false);
  - `showAudioPlayButtons` (true);
  - `showDeckTitle` (false).
- [W] Browser: `card_browser_show_media_filenames` (false).

### 8.8 Controls (`R/xml/preferences_controls.xml`, `ControlsSettingsFragment.kt`, `ControlsTabPreference.kt`, `R/xml/preferences_reviewer_controls.xml`, `R/xml/preferences_previewer_controls.xml`)
- [W] `gestures` (false): enable gestures.
- [W] `gestureCornerTouch` (false): 9-point tap zones.
- [W] `swipeSensitivity` (100, range 20–180).
- [W] `showKeyboardShortcuts`: list of shortcuts.
- [W] Tabs "Reviewer" / "Previewer". Each command has a binding editor (`R/layout/dialog_control_preference.xml`: add key / gesture / axis, choose question/answer/both side).
- Reviewer command groups (all `binding_*` keys):
  - Answer buttons: show answer, again, hard, good, easy.
  - Flags.
  - Card: bury, suspend, set due date, card info, previous card info.
  - Note: bury, suspend, delete, mark, edit, tags, add note.
  - Navigation: page up/down, browse, statistics, exit.
  - Media: replay, record voice, replay voice, save voice.
  - Whiteboard.
  - Misc: undo, redo, auto-advance, hint, all hints.
  - User actions 1–9.

### 8.9 Accessibility (`R/xml/preferences_accessibility.xml`)
- [W] `cardZoom` (100 %, range 10–300).
- [W] `imageZoom` (100 %, range 50–300).
- [W] `answerButtonSize` (100 %, range 10–200; legacy). Hidden key `answerBtnSize` (100–200) for the new screen.
- [W] `showLargeAnswerButtons` (false): 2 rows.
- [W] `relativeCardBrowserFontSize` (100 %, range 10–200).
- [W] `showCardAnswerButtonTime` (0 ms, range 0–2000): minimum press time for Show answer.
- [W] `doubleTapTimeout` (200 ms, range 0–1000): ignore a second answer tap.
- [W] `safeDisplay` "Remove animations" (false). On the web, map to `prefers-reduced-motion`.

### 8.10 Switch profile (`J/preferences/profiles/*`, `J/multiprofile/*`; enabled by dev option `enableSwitchProfile`)
- [W~] Add, rename, delete and switch profiles. Each profile has its own collection and prefs; switching restarts the app.

### 8.11 Backups (`R/xml/preferences_backup_limits.xml`, `BackupLimitsSettingsFragment.kt`). Collection config, [W] server-side:
- `minutes_between_automatic_backups` (minimum 5).
- `daily_backups_to_keep`, `weekly_backups_to_keep`, `monthly_backups_to_keep`.
- Help text: media is not backed up.

### 8.12 Advanced (`R/xml/preferences_advanced.xml`)
- [X] `deckPath` (AnkiDroid directory).
- [W~] `resetLanguages`: reset per-deck TTS language choices.
- [X] `double_scrolling` (e-reader).
- Workarounds:
  - [X] `softwareRender`;
  - [W] `useInputTag` (false): type answer inside the card HTML;
  - [X] `disableExtendedTextUi`;
  - [W] `noteEditorNewlineReplace` (true);
  - [W] `autoFocusTypeInAnswer` (true);
  - [X] `mediaImportAllowAllFiles`;
  - [W~] `allowTemplateAudioRecording` (false);
  - [X] `useFixedPort`.
- Plugins:
  - [X] `providerEnabled` (true, the ContentProvider API for 3rd-party apps);
  - [X] `thirdpartyapps_link`.
- [W~] `tts` (false): read cards aloud when they have no audio.
- Security:
  - [W] `allow_dangerous_js_api` (false);
  - [W~] `allowCardExternalLaunch` (false).

### 8.13 Developer options (`R/xml/preferences_developer_options.xml`; hidden, unlocked from About) [X], except feature flags:
- `html_javascript_debugging`, trigger crash, analytics dev mode, lock DB, corrupt FSRS params, set legacy DB path.
- `new_congrats_screen`, open TTS voices, create N fake notes, create fake media.
- Work-in-progress flags: `cardBrowserFragmented`, `cardBrowserSearchView`, `newReviewReminders`, `enableSwitchProfile`, `devBottomNav`.

### 8.14 About (`J/preferences/AboutFragment.kt`)
- [W] Version, contributors, licences (GPL/AGPL), source link, donate, **copy debug info**.
- Tapping repeatedly enables developer options.

---

## 9. Sync

**Files:** `J/Sync.kt`, `J/account/*`, `J/dialogs/SyncErrorDialog.kt`, `J/sync/MeteredSyncPolicy.kt`, `J/sync/SchemaChanges.kt`, `J/worker/SyncWorker`, `J/worker/SyncMediaWorker`.

- [W] **Login screen** (`J/account/LoginFragment.kt`, `R/layout/fragment_my_account.xml`):
  - email + password, Log in;
  - Reset password link (ankiweb.net/account/resetpw);
  - Sign up (register_url) with a "not affiliated" note;
  - Privacy policy; "Lost email" instructions.
  - On success it stores `hkey` + `username` and syncs immediately.
- [W] **Logged-in screen** (`LoggedInFragment.kt`): "Logged in as <user>", **Log out**, **Remove account** (opens the AnkiWeb remove-account page, `J/pages/RemoveAccountFragment.kt`), Privacy policy.
- [W] **Sync flow** (`handleNormalSync`):
  1. normal sync;
  2. if the server requires FULL_DOWNLOAD or FULL_UPLOAD, do it automatically with progress;
  3. if FULL_SYNC (conflict), show the **conflict dialog**: "Keep local (upload)" / "Keep AnkiWeb (download)" / Cancel, each with its own confirmation (`DIALOG_SYNC_CONFLICT_RESOLUTION`, `_CONFIRM_KEEP_LOCAL`, `_CONFIRM_KEEP_REMOTE`).
- [W] **Media sync** runs after collection sync as a background job, controlled by `syncFetchMedia`.
  - Progress shows on the sync icon. Tapping the icon during media sync shows progress, and it can be cancelled.
- [W] Error dialogs (`SyncErrorDialog.Type`):
  - not logged in (offers login);
  - connection error;
  - sanity-check error (with keep local / keep remote);
  - media sync error;
  - corrupt collection;
  - basic check error;
  - clock off;
  - collection too large.
- [W] **One-way sync / schema change**: operations such as deleting a note type or field, changing note type or changing templates ask "This requires a one-way sync" before running (`userAcceptsSchemaChange`).
- [W] Auto sync on start/exit (10-min throttle), sync from pull-to-refresh, the Y shortcut, and the toolbar.
- [W~] Metered-connection warning (`MeteredSyncPermission.kt`). Network timeout pref.
- [W] Custom sync server URL (+ certificate) (§8.4). The endpoint the server returns is stored (`currentSyncUri`).
- [X] Android `com.ichi2.anki.DO_SYNC` intent (external sync trigger) and sync notifications.

---

## 10. Other features

### 10.1 Shared decks (`J/shareddeck/SharedDecksActivity.kt`, `SharedDecksDownloadFragment.kt`, `R/menu/download_shared_decks_menu.xml`)
- [W~] Embedded browser on `https://ankiweb.net/shared/decks/` with a Home button.
- [W~] Intercepts the .apkg download, shows download progress (speed, cancel), then opens the import flow.
- [W~] Some downloads need a login (HTTP 429): snackbar to log in or sign up.
- A PWA can use the server to fetch the deck or link out.

### 10.2 Import (`J/Import.kt`, `J/BackendImporting.kt`, `J/dialogs/ImportFileSelectionFragment.kt`, `J/dialogs/ImportDialog.kt`)
- [W] Picker choice: Anki package (.apkg), Collection package (.colpkg), Text/CSV (csv/tsv/txt).
- [W] .apkg opens the upstream `import-anki-package` options page.
- [W] .colpkg asks "Replace collection?" (`DIALOG_IMPORT_REPLACE_CONFIRM`), then a full replace with media.
- [W] CSV opens the upstream `import-csv` page.
- [W~] Files can also arrive from outside the app (`AndroidManifest.xml`; web equivalents are a Web Share Target / File Handling API):
  - opening .apkg/.colpkg/.csv/.tsv/.txt from other apps;
  - sharing images, which go to Image Occlusion or a new note;
  - sharing text, which goes to the Note editor or instant cloze editor (`J/IntentHandler.kt`, `J/IntentHandler2.kt`).

### 10.3 Export (`J/export/ExportDialogFragment.kt`, `J/BackendExporting.kt`, `J/dialogs/ExportReadyDialog.kt`, `R/layout/dialog_export_options.xml`)
- [W] Types:
  - **Collection (.colpkg)**: include media; legacy (Anki < 2.1.50) support.
  - **Deck package (.apkg)**: deck selector or "selected cards"; include scheduling information, deck presets, media; legacy support.
  - **Notes in plain text**: include HTML, tags, deck name, notetype name, unique identifier.
  - **Cards in plain text**: include HTML.
- [W] When the export finishes: Share or Save to file.

### 10.4 Backups (`J/BackupManager.kt`, `J/BackendBackups.kt`)
- [W] Automatic periodic backups (backend), configured in §8.11.
- [W] Manual "Create backup".
- [W] Restore from a list of backups (with confirmation; replaces the collection).
- [W~] Backup prompt dialog (§1.6). [X] Low-disk-space dialogs.

### 10.5 Check database (`J/DatabaseCheck.kt`)
- [W] Confirm dialog, then backend `checkDatabase` with progress, then a dialog listing the problems found and fixed.
- [W] Repair / new collection options exist in the error flows (`DatabaseErrorDialog`).

### 10.6 Check media (`J/mediacheck/MediaCheckFragment.kt`, `MediaCheckViewModel.kt`, `R/menu/media_check_menu.xml`)
- [W] Report (missing files, unused files, …) rendered as text.
- [W] Buttons: **Tag missing** (adds tag `missing-media`), **Delete unused** (with confirmation).
- [W] Menu: **Restore trash**, **Empty trash** (shown when trash is not empty).

### 10.7 Empty cards (`J/dialogs/EmptyCardsDialogFragment.kt`, `EmptyCardsViewModel.kt`)
- [W] Report of empty cards. Checkbox "Keep notes with no valid cards".
- [W] Delete. A snackbar shows "N cards deleted" with Undo.

### 10.8 Undo / redo
- [W] Backend undo/redo queue everywhere: deck picker, reviewer, browser, study options.
- [W] Snackbar Undo after deleting a deck, a note or empty cards.

### 10.9 Widgets and notifications [X] (could become web push)
- `J/../widget/AnkiDroidWidgetSmall.kt`: due count + ETA.
- `DeckPickerWidget`: selected decks with counts.
- `CardAnalysisWidget`: one deck.
- `widgets/AddNoteWidget.kt`: quick add.
- Due-cards notifications (`J/NotificationScheduling.kt`, `widgets/WidgetNotificationScheduler.kt`).
- Review reminders (§8.6).

### 10.10 Deep links / intents (`J/IntentHandler.kt` `LaunchType`)
- [W] `anki://x-callback-url/browser?search=<query>` opens the Card Browser with that search. Map to a URL route.
- [W] Review a deck directly (`ReviewDeckDestination`, `J/HomeScreenNavigation.kt`, launcher shortcuts). Map to `/review/:deckId`.
- Other launch types: FILE_IMPORT, TEXT_IMPORT, IMAGE_IMPORT, SHARED_TEXT, SYNC, REVIEW, OPEN_BROWSER, COPY_DEBUG_INFO.
- [X] `org.openintents.action.CREATE_FLASHCARD` and PROCESS_TEXT context menus ("Anki card", "Card browser").

### 10.11 Onboarding (`J/IntroductionActivity.kt`, `R/layout/fragment_introduction.xml`, `J/introduction/SetupCollectionFragment.kt`)
- [W] Logo + taglines ("Study less / Remember more") + short explanation.
- [W] Buttons: **Get started** (new empty collection) and **Sync from AnkiWeb** (login, then full download).
- [X] Storage, notification, internet and microphone permission screens (`J/ui/windows/permissions/*`).

### 10.12 Themes (`R/values/theme_light.xml`, `theme_plain.xml`, `theme_eink.xml`, `theme_dark.xml`, `theme_black.xml`)
- [W] Light, Plain, E-ink (day themes); Dark, Black (night themes); follow system.
- [W] Card classes add `night_mode` / `ankidroid_dark_mode` / `ankidroid_plain_mode`.
- [W] Flag colours (`R/values/colors.xml`):

| Flag | Colour |
|---|---|
| Red | `#FF4747` |
| Orange | `#FFB647` |
| Green | `#6FF06F` |
| Blue | `#5289FF` |
| Pink | `#FF99F1` |
| Turquoise | `#85FFEF` |
| Purple | `#C398EC` |

### 10.13 Flags
- [W] 7 flags, renamable (`J/dialogs/FlagRenameDialog.kt`, `R/layout/dialog_rename_flag.xml`). Names are stored in the collection config, so they sync.

### 10.14 Multi-profile
- [W~] See §8.10 (`J/multiprofile/ProfileManager.kt`). Profiles are isolated: separate collection, separate prefs and WebView data.

### 10.15 Misc
- [W] "Card info" from the browser and the reviewer.
- [W] Statistics shortcut T; opened from the drawer with the current deck preselected.
- [W] Locale / keyboard language hint per field (`J/LanguageUtils.kt`, `LocaleSelectionDialog.kt`).
- [W~] TTS voice browser (`J/dialogs/TtsVoicesDialogFragment.kt`, `{{tts-voices:}}`).
- [X] Crash reporting (ACRA), analytics, manage-space screen, ContentProvider API (`api/` module), Han-unification detection when saving CJK text.

---

### Notes for the PWA team
1. Most scheduling logic and every Svelte page come straight from the backend. Parity work is mostly native chrome: the deck tree, the reviewer shell and bindings, the note editor, the browser, and the dialogs listed above.
2. Mirror the backend method allowlist in `J/pages/PostRequestHandler.kt` on your server's `/_anki/*` POST endpoint. That gives you working Statistics, Deck Options, Card Info, CSV/APKG import, Image Occlusion and Congrats pages.
3. For the reviewer, copy the new study screen model (`ViewerAction` + `MenuDisplayType` + `binding_*` prefs). It is the cleaner abstraction. Keep the JS API endpoints at `/jsapi/<name>` so existing AnkiDroid-targeted card templates work unchanged.
