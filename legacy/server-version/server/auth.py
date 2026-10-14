"""Sign-in with sync server credentials, and the session cookie that follows.

There is no account database: signing in logs in to the sync server, and the key it
returns is kept server-side with the user's collection. The password is never stored.
A session is a random token in a cookie, mapped to a username in sessions.json.
"""

from __future__ import annotations

import json
import secrets
import threading
import time

from fastapi import Depends, HTTPException, Request

from . import config
from .colman import UserCollection, collections

COOKIE = "anki_session"


class Sessions:
    def __init__(self) -> None:
        self.path = config.DATA_DIR / "sessions.json"
        self._lock = threading.Lock()
        self._data: dict[str, dict] | None = None

    def _load(self) -> dict[str, dict]:
        if self._data is None:
            try:
                self._data = json.loads(self.path.read_text())
            except FileNotFoundError:
                self._data = {}
        return self._data

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data))
        tmp.replace(self.path)

    def create(self, username: str) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            data = self._load()
            data[token] = {"user": username, "created": time.time()}
            self._save()
        return token

    def lookup(self, token: str) -> str | None:
        with self._lock:
            entry = self._load().get(token)
        if not entry:
            return None
        if time.time() - entry["created"] > config.SESSION_DAYS * 86400:
            self.drop(token)
            return None
        return entry["user"]

    def drop(self, token: str) -> None:
        with self._lock:
            if self._load().pop(token, None) is not None:
                self._save()

    def drop_user(self, username: str) -> None:
        with self._lock:
            data = self._load()
            for token in [t for t, e in data.items() if e["user"] == username]:
                del data[token]
            self._save()


sessions = Sessions()


def current_username(request: Request) -> str:
    token = request.cookies.get(COOKIE)
    username = sessions.lookup(token) if token else None
    if username is None:
        raise HTTPException(401, "not signed in")
    return username


def current_user(username: str = Depends(current_username)) -> UserCollection:
    uc = collections.get(username)
    if uc.load_auth() is None:
        # Signed out on another device (or the sync key was removed): the session is dead.
        raise HTTPException(401, "not signed in")
    return uc
