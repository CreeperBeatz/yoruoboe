"""The web app: the JSON API for the React front end, Anki's own pages, media, and the
built front end itself."""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from . import anki_pages, config
from .colman import background_sync_loop, collections
from .routes import account, browse, cards, decks, media, notetypes, offline, review, tools

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = threading.Event()
    worker = threading.Thread(target=background_sync_loop, args=(stop,), daemon=True, name="autosync")
    worker.start()
    try:
        yield
    finally:
        stop.set()
        collections.close_all()


app = FastAPI(title="Anki PWA", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def same_origin_writes(request: Request, call_next):
    """Refuse writes another site's page makes with the user's cookie.

    The cookie is SameSite=Lax already; this also covers browsers that treat a
    sibling subdomain as same-site.
    """
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin != "null":
            host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
            if urlsplit(origin).netloc != host:
                return JSONResponse({"detail": "cross-origin request refused"}, status_code=403)
    return await call_next(request)

app.include_router(account.router)
app.include_router(decks.router)
app.include_router(media.router)
app.include_router(review.router)
app.include_router(cards.router)
app.include_router(notetypes.router)
app.include_router(browse.router)
app.include_router(offline.router)
app.include_router(tools.router)
app.include_router(anki_pages.router)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/version")
def version() -> dict:
    from anki.buildinfo import version as anki_version

    return {"anki": anki_version}


# Served from server/static: the scripts run inside Anki's pages and the card frame.
STATIC_FILES = {
    "anki-host.js": "application/javascript",
    "card-frame.js": "application/javascript",
    "card-frame": "text/html",
}


@app.get("/{path:path}")
def frontend(path: str) -> Response:
    """The built React app; any other path is the app's own routing, so gets index.html."""
    if path.startswith(("api/", "_anki/", "media/", "m/")):
        raise HTTPException(404)
    if path in STATIC_FILES:
        name = "card-frame.html" if path == "card-frame" else path
        headers = {"Cache-Control": "no-cache"}
        if path.startswith("card-frame"):
            # Loaded by the sandboxed (opaque-origin) frame.
            headers["Access-Control-Allow-Origin"] = "*"
        return FileResponse(config.ROOT / "server" / "static" / name, media_type=STATIC_FILES[path], headers=headers)
    dist = config.WEB_DIST.resolve()
    if path:
        candidate = (dist / path).resolve()
        if dist in candidate.parents and candidate.is_file():
            headers = {}
            if path.startswith("assets/"):
                headers["Cache-Control"] = "public, max-age=31536000, immutable"
            elif path == "sw.js":
                headers["Cache-Control"] = "no-cache"
            return FileResponse(candidate, headers=headers)
    index = dist / "index.html"
    if not index.is_file():
        return Response("Front end not built: cd web && npm run build", status_code=503)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
