# The first version: a server-side collection

Before the app ran Anki's engine in the browser, a FastAPI server on the Pi kept each
user's collection (with the official `anki` Python package) and synced it with a
self-hosted sync server; the app was a front end to it, with an offline pack for studying
without a connection. Replaced on 2026-10-14 by the in-browser engine (see the top-level
README). Kept for reference; nothing uses it, and it can be deleted.

- `server/`: the FastAPI app (`server/routes/*` are what `web/src/local/routes/*` port)
- `tests/test_server.py`: its tests (`pytest`, starts its own sync server)
- `deploy/anki-sync.service`: the self-hosted sync server unit
