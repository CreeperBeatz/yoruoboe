"""The signed-in user's collection media: for the editor and Anki's pages by cookie, and
for the sandboxed card frame by a per-user key in the URL (it sends no cookies)."""

from __future__ import annotations

import mimetypes
import os
import secrets
import threading

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse

from .. import config
from ..auth import current_user
from ..colman import UserCollection, collections

router = APIRouter()

# Media is user content: shown by a card it may be anything, opened on its own it must
# not run as a page of this site (same policy as desktop's mediasrv).
UNTRUSTED_MEDIA_CSP = (
    "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; "
    "font-src 'self'; media-src 'self'; sandbox allow-same-origin"
)


def _media_file(uc: UserCollection, name: str) -> str:
    base = os.path.realpath(os.path.join(uc.dir, "collection.media"))
    full = os.path.realpath(os.path.join(base, os.path.normpath(name)))
    if not full.startswith(base + os.sep):
        raise HTTPException(403)
    if not os.path.isfile(full):
        raise HTTPException(404)
    return full


def _serve(full: str, extra: dict[str, str] | None = None) -> FileResponse:
    mime = mimetypes.guess_type(full)[0] or "application/octet-stream"
    headers = {"Content-Security-Policy": UNTRUSTED_MEDIA_CSP, "Cache-Control": "private, max-age=3600"}
    if extra:
        headers.update(extra)
    return FileResponse(full, media_type=mime, headers=headers)


@router.get("/media/{name:path}")
def media(name: str, uc: UserCollection = Depends(current_user)) -> Response:
    return _serve(_media_file(uc, name))


# ---- media key for the card frame ----------------------------------------------------

_tokens: dict[str, str] = {}
_tokens_lock = threading.Lock()


def media_token(uc: UserCollection) -> str:
    path = uc.dir / "media_token"
    try:
        token = path.read_text().strip()
    except FileNotFoundError:
        token = ""
    if not token:
        uc.dir.mkdir(parents=True, exist_ok=True)
        token = secrets.token_urlsafe(24)
        path.write_text(token)
    with _tokens_lock:
        _tokens[token] = uc.username
    return token


def _user_for_token(token: str) -> UserCollection | None:
    with _tokens_lock:
        username = _tokens.get(token)
    if username is None:
        # After a restart: find it on disk.
        users = config.DATA_DIR / "users"
        if users.is_dir():
            for d in users.iterdir():
                f = d / "media_token"
                if f.is_file() and secrets.compare_digest(f.read_text().strip(), token):
                    username = d.name
                    with _tokens_lock:
                        _tokens[token] = username
                    break
    return collections.get(username) if username else None


@router.get("/api/media-token")
def get_media_token(uc: UserCollection = Depends(current_user)) -> dict:
    return {"token": media_token(uc)}


@router.get("/m/{token}/{name:path}")
def media_by_token(token: str, name: str) -> Response:
    uc = _user_for_token(token)
    if uc is None:
        raise HTTPException(404)
    # The frame is an opaque origin: fonts and fetches from it need CORS.
    return _serve(_media_file(uc, name), {"Access-Control-Allow-Origin": "*"})


# ---- uploads from the app (file pickers, recordings) --------------------------------


@router.post("/api/media/upload")
async def upload_media(file: UploadFile = File(...), uc: UserCollection = Depends(current_user)) -> dict:
    """Store a picked or recorded file where the pages can add it from (addMediaFromPath)."""
    d = uc.dir / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    name = os.path.basename(file.filename or "file")
    target = d / f"{secrets.token_hex(4)}-{name}"
    data = await file.read()
    target.write_bytes(data)
    return {"path": str(target), "name": name}


@router.post("/api/media/add")
async def add_media(file: UploadFile = File(...), uc: UserCollection = Depends(current_user)) -> dict:
    """Add a file to the collection's media; returns the name it was stored under."""
    data = await file.read()
    with uc.use() as col:
        name = col.media.write_data(os.path.basename(file.filename or "file"), data)
    return {"name": name}
