# YoruOboe for developers

How YoruOboe is built, how to run and test it, and the other ways to deploy it. For
setting up a copy and installing it on an iPhone, see the [README](../README.md).

## What it is

It is Anki itself rather than a re-implementation:

- **Anki's engine runs in the browser.** Its Rust core (rslib) is compiled to
  WebAssembly: scheduling, rendering, search, import/export, the database and sync are
  the same code desktop Anki runs. The changes needed for the browser are a patch on
  the release (`engine/anki-wasm.patch`, release in `ANKI_VERSION`).
- **Deck options, statistics, card info, the note editor, image occlusion, change note
  type and the importers** are Anki's own web pages, unpacked from the matching `aqt`
  wheel and shown in a frame. AnkiDroid shows the same pages.
- **Cards** are rendered by Anki's `reviewer.js`, as on desktop.
- **The rest** is AnkiDroid's layout and behaviour, rebuilt in React: deck list, study
  screen, browser, note types, settings, dialogs. `docs/ankidroid-parity.md` is the
  checklist it was built from, read out of AnkiDroid's source.
- **It looks like iOS 27** (`web/src/ios/ios.css`, over AnkiDroid's layout): Liquid
  Glass bars and buttons floating over the content, which get a backing once a list
  scrolls under them; a tab bar in place of AnkiDroid's drawer (`web/src/ui/TabBar.tsx`);
  large titles, inset grouped lists, iOS alerts and menus, the system font and colours,
  and line icons after SF Symbols. The card is a slab of glass you can
  throw, as on Tinder (`web/src/ios/cardSwipe.ts`): it follows the finger, shows what
  letting go will do (left Again, right Good, up Easy, down Hard; on the question, any
  way shows the answer), and flies off that way, the next card rising in its place. The
  answers are also one glass bar under the card. Screens slide over
  each other as on iOS; the phone's
  Reduce Motion and Reduce Transparency settings are followed.

## How it fits together

```
iPhone (PWA)
  app (React) ──/api/… in-page──> local API (web/src/local)          the server's old routes
                                     │  protobuf, postMessage
                                     v
                                  Web Worker: Anki's engine (WebAssembly)
                                     │  SQLite + files in OPFS (IndexedDB if unavailable)
                                     │
                                     └─ sync: POST /aw/sync/…  ──https──> host ──> sync.ankiweb.net
host (Pi or Cloudflare Pages): the app's files, and /aw/<host>/… passed on to <host>.ankiweb.net
```

- **Why anything in between at all:** a web page may only call another site if that
  site allows it (CORS), and AnkiWeb doesn't. So the app sends sync requests to its own
  address, and the host passes them on unchanged (`deploy/serve.py` on the Pi, or a
  Cloudflare Pages Function). It stores nothing, but as the end of the HTTPS connection
  it can see what passes, including your AnkiWeb sign-in key: run it yourself.
- **AnkiWeb's terms** say its sync service is for the official Anki clients. The engine
  is Anki's own code and syncs as desktop Anki does, but it isn't an official client.
- **Another sync server:** Settings > Sync > Sync server. It must be reachable from the
  browser: at the app's address (`serve.py --sync-target`), or one that allows CORS.
- **Signing in** is AnkiDroid's: AnkiWeb email and password, sent to AnkiWeb (through
  the host); only the sync key is kept, on the phone. The app also works without an
  account, with a collection on the device only.
- **Everything works offline**: study, add and edit notes, Anki's pages, the browser.
  Syncing needs a connection; the app syncs on the sync button and pull-to-refresh,
  and on its own about as often as AnkiDroid: on opening, on leaving with changes, and
  on coming back 10 minutes or more after the last sync (`web/src/sync.ts`). It tells
  the sync server it is Anki's engine on `web`.
- **Cards run in a sandbox**: an iframe without same-origin, so a card's script can't
  reach the collection. Its media goes in as data URLs (`web/src/local/media.ts`).
- **AnkiDroid's JavaScript API** (`AnkiDroidJS`, `showAnswer()`, `buttonAnswerEase1()`,
  user actions, hints) works for templates written for AnkiDroid.

### Inside the browser

| Piece | Where |
|---|---|
| Engine build (wasm-bindgen exports: backend calls, async sync, files) | `engine/anki/rslib/wasm` (from the patch) |
| Files for the engine: OPFS pool for databases, a SQLite table for the rest | `rslib/io/src/vfs.rs` in the patch |
| The worker and its client | `web/src/engine/` |
| Anki's typed backend methods, generated from its build | `web/src/engine/generated/` |
| The app's API, answered locally (ports of the old server routes) | `web/src/local/` |
| Calls from Anki's pages (`/_anki/<method>`), as desktop's web server answers them | `web/src/local/pages.ts` |
| Service worker: the app offline, Anki's pages' URLs, media for them | `web/sw.template.js` |

Storage: OPFS sync access handles (Safari 16.4+) through `sqlite-wasm-rs`'s pool; where
those don't exist, IndexedDB, with the databases held in memory. Settings > Storage shows
which, the space used, and asks the browser to keep the data (granted to home-screen
apps). One copy of the app runs at a time (a second tab says so).

## Running it locally

    cd web && npm install
    python scripts/fetch_anki_web.py                 # Anki's pages, from the aqt wheel
    npm run dev                                      # http://localhost:5173

The dev server passes sync requests to a local sync server (`ANKI_SYNC_TARGET` to
change). For one, and test data:

    py -3.12 -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
    SYNC_USER1=alice:secret SYNC_BASE=scratch/sync SYNC_PORT=27701 .venv/Scripts/python -m anki.syncserver
    .venv/Scripts/python tests/seed_collection.py http://127.0.0.1:27701/ alice secret

A production build, as the Pi serves it:

    cd web && npm run build && cd ..
    python deploy/serve.py --port 8780 --sync-target http://127.0.0.1:27701   # or no target: AnkiWeb

Browser tests (iPhone-sized, screenshots in `scratch/`; `ENGINE=webkit` is Safari's engine):

    BASE=http://127.0.0.1:8780 ENGINE=webkit ANKI_USER=alice ANKI_PASS=secret node tests/e2e.mjs
    … node tests/e2e_more.mjs
    BASE=http://127.0.0.1:8780 ENGINE=chromium … node tests/e2e_offline.mjs   # service workers: Chromium
    node tests/engine_smoke.mjs webkit                                       # the engine alone (dev server)

## Building the Cloudflare zip

The zip is the contents of `web/dist`: the app's files, plus `_worker.js`
(`deploy/cloudflare/_worker.js`), which passes sync requests on to AnkiWeb, and
`_routes.json`, which sends only those (`/aw/*`) to it. `_redirects` and `_headers` do
for Anki's pages what `serve.py` does on a server.

To build it from the source instead, with Node 20+ and Python 3:

    python3 scripts/fetch_anki_web.py
    cd web && npm ci && npm run build

and upload `web/dist` (the folder, or a zip of what is in it) as the README's guide does. With Cloudflare's
command line, `npx wrangler pages deploy web/dist --project-name yoruoboe` does the
same.

The release zip is `web/dist` zipped with its files at the top of the zip. Every
picture in the README's Cloudflare guide is in `docs/install/cloudflare`.

## Deploying on a Linux server or a Raspberry Pi

Any Linux with systemd: Raspberry Pi OS, Debian, Ubuntu… Nothing native runs on it,
but the build needs Node 20+: on a Pi, a 64-bit OS is the simple way to get it.

1. Install what the build and the service need:

       sudo apt install -y git python3 curl
       curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

2. Get the code and set it up. This builds the app, writes `.env`, and installs one
   systemd service, `anki-web`, listening on `127.0.0.1:8767` (`deploy/serve.py`:
   the files, and `/aw/*` passed on to AnkiWeb):

       git clone <this repository> ~/anki-pwa && cd ~/anki-pwa
       bash deploy/pi-setup.sh

   To sync with your own sync server instead of AnkiWeb, set
   `SYNC_TARGET=http://127.0.0.1:27701` in `.env` and `sudo systemctl restart anki-web`.

3. Put it on the internet over HTTPS, one of:

   - **Cloudflare Tunnel**, if the machine already runs `cloudflared`. In the Cloudflare
     dashboard: Zero Trust > Networks > Tunnels > the tunnel > Public Hostname > Add:
     subdomain `yoruoboe`, your domain, service `HTTP` `127.0.0.1:8767`. Cloudflare
     adds the DNS record.
   - **A reverse proxy on the machine**, with its own certificate. With Caddy, which gets
     one by itself:

         yoruoboe.example.org {
             reverse_proxy 127.0.0.1:8767
         }

4. Later updates: `bash deploy/update.sh` (pull, build, restart).

**Without Node on the machine**: build on a PC and publish over SSH. From the
PC, with what you want deployed committed:

    bash deploy/publish.sh user@raspberrypi.local      # build, push, upload, restart

It pushes `main` to a bare repository on the machine (`~/anki-pwa.git`, cloned to
`~/anki-pwa`) and uploads `web/dist`. The first time, then run
`bash deploy/pi-setup.sh` on the machine (it asks for the sudo password) to install
the service; after that `publish.sh` alone deploys.

Behind a Cloudflare Tunnel, keep **Rocket Loader** and **Bot Fight Mode** off for the
app's hostname. Cloudflare's free plan limits a request to 100 MB, as on Pages.

## Install guide screenshots

Safari's are BetterRTK's install guide's, Chrome's were taken with this app
(`docs/install/source`); `node scripts/make_install_shots.mjs` cuts and rings them and
puts this app's name, icon and a placeholder address in.

## Anki versions

The sync protocol changes between releases: the engine, desktop Anki and AnkiDroid
should be the same release (`ANKI_VERSION`).

### Rebuilding the engine (upgrading Anki)

Needs Rust (the toolchain Anki pins, with the `wasm32-unknown-unknown` target), clang
(for SQLite and zstd), and `wasm-bindgen-cli` at the version in Cargo.lock; see
`engine/env.sh` for where they are looked for.

    # edit ANKI_VERSION, then
    python engine/setup_source.py        # Anki's source + submodules + the patch, in engine/anki
    bash engine/build.sh                 # the engine, into web/src/engine/pkg
    python engine/gen_ts.py              # its TypeScript interface
    python scripts/fetch_anki_web.py     # the matching pages
    python engine/setup_source.py --diff # after fixing what didn't apply: the new patch

What the patch changes in rslib, in short: no sync server, threads or tokio runtime in
the browser build; sync over `fetch`, as async entry points; a file system for the
browser (`anki_io::fs`, `vfs.rs`) in place of std::fs; time from the JS clock;
journals kept in memory on the IndexedDB store.

## Layout

| Path | What |
|---|---|
| `engine/` | the engine: patch, setup and build scripts |
| `web/src/engine/` | the worker, its client, Anki's generated backend interface, the built engine |
| `web/src/local/` | the app's API, answered on the device |
| `web/src/screens/` | the screens, named as AnkiDroid's are |
| `web/public/` | the card frame, and the script put into Anki's pages |
| `deploy/` | `serve.py`, the Pi's service and scripts; Cloudflare's sync forwarder (`cloudflare/_worker.js`) |
| `scripts/` | Anki's pages from the aqt wheel; the icons and the install guide's screenshots (`make_*.mjs`) |
| `docs/` | the AnkiDroid parity checklist, how Anki's pages talk to their host, the Chrome install screenshots as taken, the Cloudflare guide's screenshots |
| `legacy/` | the first, server-based version, for reference |
| `vendor/`, `reference/` | downloaded: Anki's pages; AnkiDroid's and Anki's source, for reference |
