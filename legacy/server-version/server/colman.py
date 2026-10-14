"""One open Anki collection per signed-in user, and its sync with the sync server.

The web app is an Anki client like AnkiDroid: it keeps its own copy of each user's
collection and syncs it with the self-hosted sync server, which desktop Anki and
AnkiDroid sync with too. A collection is opened on first use and kept open, because
undo, the review queue and the scheduler's state live in the open collection.

Every use of a collection goes through `UserCollection.use()`, which holds that user's
lock: the Rust backend is safe to call from any thread, but pylib's caches and a sync
that closes the collection under a request are not.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from anki.collection import Collection
from anki.sync_pb2 import SyncAuth, SyncCollectionResponse

from . import config

log = logging.getLogger(__name__)

Required = SyncCollectionResponse.ChangesRequired

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.@+-]{1,64}$")


class SyncConflict(Exception):
    """Both sides changed in a way only a full sync can settle; the user picks a side."""


class NotSignedIn(Exception):
    pass


@dataclass
class SyncState:
    running: bool = False
    last_ok: float = 0.0
    last_error: str = ""
    # The server asked for a full sync and only the user can say which way.
    conflict: bool = False
    # Collection modification time at the last successful sync.
    synced_mod: int = 0
    media: str = ""


@dataclass
class UserCollection:
    username: str
    dir: Path
    lock: threading.RLock = field(default_factory=threading.RLock)
    col: Collection | None = None
    last_used: float = field(default_factory=time.time)
    sync: SyncState = field(default_factory=SyncState)
    # Review session state that must survive between requests (see routes/review.py).
    session: dict = field(default_factory=dict)

    @property
    def col_path(self) -> Path:
        return self.dir / "collection.anki2"

    @property
    def auth_path(self) -> Path:
        return self.dir / "auth.json"

    # ---- sync key -------------------------------------------------------

    def load_auth(self) -> SyncAuth | None:
        try:
            data = json.loads(self.auth_path.read_text())
        except FileNotFoundError:
            return None
        return SyncAuth(hkey=data["hkey"], endpoint=data.get("endpoint") or config.SYNC_ENDPOINT)

    def save_auth(self, auth: SyncAuth) -> None:
        self.auth_path.write_text(json.dumps({"hkey": auth.hkey, "endpoint": auth.endpoint}))

    # ---- collection -----------------------------------------------------

    def _open(self) -> Collection:
        if self.col is None:
            self.dir.mkdir(parents=True, exist_ok=True)
            self.col = Collection(str(self.col_path))
            log.info("opened collection for %s", self.username)
        return self.col

    @contextmanager
    def use(self) -> Iterator[Collection]:
        with self.lock:
            self.last_used = time.time()
            yield self._open()

    def close(self) -> None:
        with self.lock:
            if self.col is not None:
                self.col.close()
                self.col = None
                log.info("closed collection for %s", self.username)

    # ---- sync -----------------------------------------------------------

    def run_sync(self, *, full: str | None = None) -> dict:
        """Sync with the server. `full` is "upload" or "download" to settle a conflict.

        Returns the state the client shows. Raises SyncConflict when the server wants a
        full sync in a direction only the user can choose.
        """
        auth = self.load_auth()
        if auth is None:
            raise NotSignedIn()
        with self.lock:
            col = self._open()
            self.sync.running = True
            try:
                if full is None:
                    out = col.sync_collection(auth, True)
                    if out.new_endpoint:
                        auth = SyncAuth(hkey=auth.hkey, endpoint=out.new_endpoint)
                        self.save_auth(auth)
                    required = out.required
                    server_usn = out.server_media_usn
                    if required == Required.FULL_SYNC:
                        self.sync.conflict = True
                        raise SyncConflict()
                    if required == Required.FULL_UPLOAD:
                        full = "upload"
                    elif required == Required.FULL_DOWNLOAD:
                        full = "download"
                else:
                    server_usn = None
                if full is not None:
                    col.close_for_full_sync()
                    try:
                        col.full_upload_or_download(
                            auth=auth, server_usn=server_usn, upload=full == "upload"
                        )
                    finally:
                        col.reopen(after_full_sync=True)
                    # A full sync replaces the collection: anything remembered about it is stale.
                    self.session.clear()
                    # Media is not part of a full sync; start it now.
                    col.sync_media(auth)
                self.sync.conflict = False
                self.sync.last_ok = time.time()
                self.sync.last_error = ""
                self.sync.synced_mod = col.mod
                return {"full": full}
            except SyncConflict:
                raise
            except Exception as exc:
                self.sync.last_error = str(exc)
                raise
            finally:
                self.sync.running = False

    def media_status(self) -> dict:
        with self.lock:
            if self.col is None:
                return {"active": False}
            try:
                status = self.col.media_sync_status()
            except Exception as exc:  # the last media sync failed
                return {"active": False, "error": str(exc)}
            p = status.progress
            return {
                "active": status.active,
                "checked": p.checked,
                "added": p.added,
                "removed": p.removed,
            }

    def needs_push(self) -> bool:
        with self.lock:
            return self.col is not None and self.col.mod != self.sync.synced_mod


class Collections:
    """Every user's UserCollection, created on first use."""

    def __init__(self, base: Path) -> None:
        self.base = base
        self._users: dict[str, UserCollection] = {}
        self._lock = threading.Lock()

    def get(self, username: str) -> UserCollection:
        if not USERNAME_RE.match(username):
            raise ValueError("invalid username")
        with self._lock:
            uc = self._users.get(username)
            if uc is None:
                uc = UserCollection(username, self.base / "users" / username)
                self._users[username] = uc
            return uc

    def all(self) -> list[UserCollection]:
        with self._lock:
            return list(self._users.values())

    def close_all(self) -> None:
        for uc in self.all():
            try:
                uc.close()
            except Exception:
                log.exception("closing %s", uc.username)


collections = Collections(config.DATA_DIR)


def maybe_backup(uc: UserCollection) -> None:
    """Automatic backups, as desktop and AnkiDroid make them: the backend decides whether
    enough time has passed (Preferences > Backups) and thins out old ones."""
    if not uc.lock.acquire(blocking=False):
        return
    try:
        if uc.col is not None:
            folder = uc.dir / "backups"
            folder.mkdir(exist_ok=True)
            uc.col.create_backup(backup_folder=str(folder), force=False, wait_for_completion=False)
    except Exception:
        log.exception("backup for %s", uc.username)
    finally:
        uc.lock.release()


def background_sync_loop(stop: threading.Event) -> None:
    """Push idle local changes, pull periodically, close collections nobody is using."""
    while not stop.wait(15):
        now = time.time()
        for uc in collections.all():
            if uc.load_auth() is None or uc.sync.conflict or uc.sync.running:
                continue
            idle = now - uc.last_used
            try:
                if uc.col is not None and idle > config.IDLE_CLOSE_SECONDS:
                    if uc.needs_push():
                        uc.run_sync()
                    if not uc.media_status().get("active"):
                        uc.close()
                    continue
                if uc.col is None:
                    continue
                maybe_backup(uc)
                due_push = uc.needs_push() and idle > config.AUTOSYNC_IDLE_SECONDS
                due_pull = now - uc.sync.last_ok > config.AUTOSYNC_PULL_SECONDS and idle < config.IDLE_CLOSE_SECONDS
                if due_push or due_pull:
                    # Never block a user's request behind a background sync.
                    if uc.lock.acquire(blocking=False):
                        try:
                            uc.run_sync()
                        finally:
                            uc.lock.release()
            except SyncConflict:
                log.info("sync conflict for %s, waiting for the user", uc.username)
            except Exception:
                log.exception("background sync for %s", uc.username)
