"""Sign in, sign out, and sync."""

from __future__ import annotations

import shutil

from anki.sync_pb2 import SyncAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import config
from ..auth import COOKIE, current_user, current_username, sessions
from ..colman import NotSignedIn, SyncConflict, UserCollection, collections

router = APIRouter(prefix="/api")


class Login(BaseModel):
    username: str
    password: str


def _sync_state(uc: UserCollection) -> dict:
    s = uc.sync
    return {
        "running": s.running,
        "lastOk": s.last_ok,
        "lastError": s.last_error,
        "conflict": s.conflict,
        "pending": uc.needs_push(),
        "media": uc.media_status(),
    }


_attempts: dict[str, list[float]] = {}


def _rate_limit(request: Request) -> None:
    """At most 10 sign-in attempts per address in 10 minutes."""
    import time

    ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "?")
    now = time.time()
    recent = [t for t in _attempts.get(ip, []) if now - t < 600]
    if len(recent) >= 10:
        raise HTTPException(429, "Too many sign-in attempts. Try again in a few minutes.")
    recent.append(now)
    _attempts[ip] = recent


@router.post("/login")
def login(body: Login, request: Request, response: Response) -> dict:
    _rate_limit(request)
    try:
        uc = collections.get(body.username.strip())
    except ValueError:
        raise HTTPException(400, "That username can't be used here.")
    with uc.use() as col:
        try:
            auth = col.sync_login(body.username.strip(), body.password, config.SYNC_ENDPOINT)
        except Exception as exc:
            msg = str(exc)
            if "403" in msg or "auth" in msg.lower() or "password" in msg.lower():
                raise HTTPException(401, "Wrong username or password.")
            raise HTTPException(500, f"The sync server could not be reached: {msg}")
        uc.save_auth(SyncAuth(hkey=auth.hkey, endpoint=auth.endpoint or config.SYNC_ENDPOINT))
    token = sessions.create(uc.username)
    response.set_cookie(
        COOKIE, token, max_age=config.SESSION_DAYS * 86400, httponly=True,
        samesite="lax", secure=config.COOKIE_SECURE,
    )
    # First sign-in on this server: fetch the collection now, so the deck list is not empty.
    try:
        result = uc.run_sync()
    except SyncConflict:
        result = {"conflict": True}
    except Exception as exc:
        result = {"error": str(exc)}
    return {"username": uc.username, "sync": result}


@router.post("/logout")
def logout(request: Request, response: Response, username: str = Depends(current_username)) -> dict:
    token = request.cookies.get(COOKIE)
    if token:
        sessions.drop(token)
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.post("/logout/everywhere")
def logout_everywhere(response: Response, uc: UserCollection = Depends(current_user)) -> dict:
    """Sign out on every device and delete this server's copy of the collection.

    The sync server keeps the collection; signing in again downloads it.
    """
    if uc.needs_push():
        try:
            uc.run_sync()
        except Exception as exc:
            raise HTTPException(409, f"Unsynced changes could not be sent first: {exc}")
    uc.close()
    sessions.drop_user(uc.username)
    shutil.rmtree(uc.dir, ignore_errors=True)
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/me")
def me(uc: UserCollection = Depends(current_user)) -> dict:
    return {"username": uc.username, "sync": _sync_state(uc)}


class SyncRequest(BaseModel):
    # "upload" or "download", only to settle a conflict the user has been asked about
    full: str | None = None


@router.post("/sync")
def sync(body: SyncRequest, uc: UserCollection = Depends(current_user)) -> dict:
    if body.full not in (None, "upload", "download"):
        raise HTTPException(400, "full must be upload or download")
    try:
        result = uc.run_sync(full=body.full)
    except SyncConflict:
        return {"conflict": True, "state": _sync_state(uc)}
    except NotSignedIn:
        raise HTTPException(401, "not signed in")
    except Exception as exc:
        raise HTTPException(500, f"Sync failed: {exc}")
    return {**result, "state": _sync_state(uc)}


@router.post("/sync/beacon")
def sync_beacon(uc: UserCollection = Depends(current_user)) -> dict:
    """The app was put away: sync soon, in the background, as AnkiDroid does on exit."""
    import threading

    def run() -> None:
        try:
            if uc.needs_push():
                uc.run_sync()
        except Exception:
            pass

    threading.Thread(target=run, daemon=True).start()
    return {"ok": True}


@router.get("/sync")
def sync_status(uc: UserCollection = Depends(current_user)) -> dict:
    return _sync_state(uc)
