"""Settings, all from the environment so the Pi's .env and a dev shell set the same things."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value).resolve() if value else default


# Each user's collection, media and sync key live under DATA_DIR/users/<name>/.
DATA_DIR = _path("ANKIAPP_DATA", ROOT / "data")

# The self-hosted sync server this app logs in to and syncs with. Its accounts are this
# app's accounts: whoever can sync there can sign in here.
SYNC_ENDPOINT = os.environ.get("ANKIAPP_SYNC_ENDPOINT", "http://127.0.0.1:27701/")

# The built React app, and Anki's own compiled web pages (deck options, statistics,
# editor, ...) unpacked from the aqt wheel by scripts/fetch_anki_web.py.
WEB_DIST = _path("ANKIAPP_WEB_DIST", ROOT / "web" / "dist")
ANKI_WEB = _path("ANKIAPP_ANKI_WEB", ROOT / "vendor" / "anki-web")

# Behind Cloudflare the site is https, so the session cookie can be Secure; plain
# http on a LAN during development would then never send it.
COOKIE_SECURE = os.environ.get("ANKIAPP_COOKIE_SECURE", "0") == "1"
SESSION_DAYS = int(os.environ.get("ANKIAPP_SESSION_DAYS", "365"))

# Background sync: push local changes once the collection has been left alone this long,
# and pull from the server at least this often while a user is active.
AUTOSYNC_IDLE_SECONDS = int(os.environ.get("ANKIAPP_AUTOSYNC_IDLE", "45"))
AUTOSYNC_PULL_SECONDS = int(os.environ.get("ANKIAPP_AUTOSYNC_PULL", "300"))
# A collection nobody has touched for this long is closed, freeing its memory.
IDLE_CLOSE_SECONDS = int(os.environ.get("ANKIAPP_IDLE_CLOSE", "1800"))
