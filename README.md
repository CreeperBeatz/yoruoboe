# YoruOboe

AnkiDroid, as an app you install from Safari. Your collection lives on the phone and
syncs with AnkiWeb (or your own sync server), like AnkiDroid and AnkiMobile. There is
no app server: the host only serves the app's files and passes sync requests on.

To set up your own: [Deploying](#deploying) (Cloudflare Pages: free, upload a zip), then
[Installing on iPhone](#installing-on-iphone-ios).

YoruOboe is not made by or connected with Ankitects (Anki) or the AnkiDroid project.

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

## Deploying

Run your own copy: the host passes your AnkiWeb sign-in key on to AnkiWeb, so it should
be one you control. Two ways: **Cloudflare Pages**, free and with no machine of your own
(the simple one), or your own Linux machine (a Raspberry Pi included). Either way the
site must be served over HTTPS: the app's storage and its service worker exist only on
secure origins. Pick one per hostname.

What gets built is plain files (`web/dist`) plus the sync forwarder. The engine comes
prebuilt (`web/src/engine/pkg`), so building needs Node 20+ and Python 3, not Rust.

### On Cloudflare Pages (no machine)

You upload the app, already built, to Cloudflare, which hosts it for free. No GitHub
account, no command line. You need a Cloudflare account (sign up at
[dash.cloudflare.com](https://dash.cloudflare.com/sign-up); no domain or card needed).

**As is: what you see is what you get.** A release is a finished version. Once
uploaded, your copy stays exactly as it is: it doesn't update itself, nothing is
promised about future versions, and there is no support. If a newer release comes out
and you want it, you upload that one the same way (below, after step 7).

#### 1. Download the app

From [Releases](https://github.com/CreeperBeatz/yoruoboe/releases/latest), download
`yoruoboe-<version>.zip` (under **Assets**). Don't unzip it.

#### 2. Open Workers & Pages

Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com). Type `pages` in the
search box and choose **Workers & Pages** (or pick it in the menu on the left). Then
select **Create application**.

<img src="docs/install/cloudflare/01-workers-pages.webp" width="640" alt="The dashboard's search, Workers & Pages ringed">

#### 3. Take the Pages way

Cloudflare offers to make a Worker. Don't pick any of those: at the bottom, under *Need
to use the legacy Pages workflow?*, select **Continue to Pages**.

<img src="docs/install/cloudflare/02-continue-to-pages.webp" width="480" alt="Create an app, with Continue to Pages ringed at the bottom">

#### 4. Choose drag and drop

Next to **Drag and drop your files**, select **Get started**.

<img src="docs/install/cloudflare/03-drag-and-drop.webp" width="520" alt="Get started with Pages, Drag and drop your files ringed">

#### 5. Name the project

Type a project name, for example `yoruoboe`. It becomes the address,
`https://<name>.pages.dev`; a green check means the name is free. Select **Create
project**.

<img src="docs/install/cloudflare/04-project-name.webp" width="720" alt="Project name yoruoboe, Create project ringed">

#### 6. Upload the zip

Drop the zip from step 1 onto the upload box that appears, and wait for *All files
were successfully uploaded*. The yellow note *Specifying a _routes.json is an
experimental feature* is expected: that file is what sends sync to the right place.
Select **Deploy site**.

<img src="docs/install/cloudflare/05-deploy-site.webp" width="720" alt="260 files uploaded, the _routes.json note, Deploy site ringed">

#### 7. Open it

Cloudflare says **Success!** with the address. Open that address on the iPhone and add
it to the Home Screen ([Installing on iPhone](#installing-on-iphone-ios)). For the first
minute or two a new address may not answer yet.

<img src="docs/install/cloudflare/06-success.webp" width="600" alt="Success! Your project is deployed, with its pages.dev address">

#### Your own domain, or a newer release (optional)

- **Your own domain:** in **Workers & Pages**, select the project > **Custom domains** >
  **Set up a domain**, type the hostname (for example `yoruoboe.example.org`), and
  **Continue**. With the domain's DNS on Cloudflare the record is added for you;
  otherwise add the CNAME it shows at your DNS provider. The app's data belongs to its
  address: at a new domain the phone starts empty (and syncs down again).
- **A newer release:** select the project > **Create a new deployment** > **Production**,
  and drop the new zip. Phones pick it up the next time the app is opened twice.

#### If something doesn't work

- **Sync fails while the app otherwise works:** on a custom domain, keep **Rocket
  Loader** and **Bot Fight Mode** off in that domain's dashboard. Sync requests are
  scripted POSTs that can't answer a challenge.
- Cloudflare's free plan limits a request to 100 MB, which caps a full upload of a
  collection; media syncs in small batches and is not affected.

#### How it works, and building it yourself

The zip is the contents of `web/dist`: the app's files, plus `_worker.js`
(`deploy/cloudflare/_worker.js`), which passes sync requests on to AnkiWeb, and
`_routes.json`, which sends only those (`/aw/*`) to it. `_redirects` and `_headers` do
for Anki's pages what `serve.py` does on a server.

To build it from the source instead, with Node 20+ and Python 3:

    python3 scripts/fetch_anki_web.py
    cd web && npm ci && npm run build

and upload `web/dist` (the folder, or a zip of what is in it) as above. With Cloudflare's
command line, `npx wrangler pages deploy web/dist --project-name yoruoboe` does the
same.

### On a Linux server or a Raspberry Pi

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
app's hostname, and expect the same 100 MB request limit as on Pages (above).

## Installing on iPhone (iOS)

YoruOboe is a web app: there is no App Store download. You add it to the Home Screen
from the browser, and from there it opens full screen like any app, keeps its data, and
works offline. It needs iOS 16.4 or later (iPad too).

You need your copy's address: `https://<name>.pages.dev` from
[Deploying](#on-cloudflare-pages-no-machine), or your own domain. The screenshots show
`your-app.pages.dev` in its place. Opened in a browser on the phone, the app also shows
these steps itself (the first time, then from the note on the deck list and from
Settings).

### Safari

1. Open your app's address in Safari, and tap **☰** in the address bar, on the left.
   (No ☰ button? Tap **•••** at the bottom right. No ••• button either? Tap **Share**
   and go to step 3.)

   <img src="web/src/install/step1.webp" width="420" alt="Safari's address bar, with the ☰ button ringed">

2. Tap **Share**.

   <img src="web/src/install/step2.webp" width="320" alt="Safari's menu, Share ringed">

3. Tap **View More**.

   <img src="web/src/install/step3.webp" width="360" alt="The share sheet for YoruOboe, View More ringed">

4. Tap **Add to Home Screen**.

   <img src="web/src/install/step4.webp" width="360" alt="Add to Home Screen in the list">

5. Keep **Open as Web App** on, and tap **Add**.

   <img src="web/src/install/step5.webp" width="360" alt="Add to Home Screen for YoruOboe, Open as Web App on, Add ringed">

### Chrome

1. Open your app's address in Chrome and tap **Share**, in the address bar.

   <img src="web/src/install/chrome1.webp" width="420" alt="Chrome's address bar, with the Share button">

2. Tap **View More**.

   <img src="web/src/install/chrome2.webp" width="360" alt="The share sheet, View More">

3. Tap **Add to Home Screen**.

   <img src="web/src/install/chrome3.webp" width="360" alt="Add to Home Screen in the list">

4. Keep **Open as Web App** on, and tap **Add**.

   <img src="web/src/install/chrome4.webp" width="360" alt="Add to Home Screen, Open as Web App on">

### Then

Open **YoruOboe** from the Home Screen and log in with your AnkiWeb email and password, or
tap **Use without an account**. The first sync downloads your collection and its media;
after that the app works offline and syncs when it can.

The app on the Home Screen keeps its own data, apart from the browser's: whatever you did
in the browser tab before installing stays there.

Other browsers have Share in their own place (Firefox: in the ☰ menu), then the same
screens. Brave, and apps that open links inside themselves (Instagram, Messenger…),
cannot add to the Home Screen: open the address in Safari. The app says so when it is
in one of them.

A Home Screen icon keeps the picture it had when it was added: after the icon changes,
delete it and add it again (the collection stays).

Screenshots: Safari's are BetterRTK's install guide's, Chrome's were taken with this app
(`docs/install/source`); `node scripts/make_install_shots.mjs` cuts and rings them and
puts this app's name, icon and a placeholder address in.

## Keep Anki versions together

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

## What's not here (yet)

- **Math in cards offline**: MathJax loads from the network inside the card's sandbox.
- **Engine size**: 19 MB (5.5 MB compressed), mostly every language's translations;
  downloaded once.
- **Add-ons**, as on AnkiDroid.
- **Reminders and widgets.** iOS allows web push for installed apps; not done yet.
- **Shared decks** open AnkiWeb's site; download the `.apkg` and import it.
- **LaTeX** images aren't generated (MathJax works); ones made on desktop sync in.
- **Background sync** doesn't exist for web apps on iOS: the app syncs while open.
- Anki's editor logs a harmless caret error in Safari when a field is focused
  (upstream, `safePlaceCaretAfterContent`).

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

## License

AGPL-3.0 (`LICENSE`), as Anki's code it is built on. Anki is © Ankitects Pty Ltd and
contributors; AnkiDroid, whose layout this follows, is GPL-3.0. If you run a copy for
other people, the AGPL asks you to offer them its source: a link to this repository
does it (or to your changed source, if you changed it).
