"""Integration tests: the app against a real Anki sync server, with a second client
standing in for desktop Anki / AnkiDroid.

    .venv/Scripts/python -m pytest tests/test_server.py -q

Starts its own sync server (python -m anki.syncserver) on a free port, in a temp dir.
"""

from __future__ import annotations

import importlib
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
from anki.collection import Collection
from fastapi.testclient import TestClient

USER, PASSWORD = "tester", "pw"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def sync_server(tmp_path_factory):
    base = tmp_path_factory.mktemp("sync")
    port = _free_port()
    env = dict(os.environ, SYNC_USER1=f"{USER}:{PASSWORD}", SYNC_BASE=str(base), SYNC_HOST="127.0.0.1", SYNC_PORT=str(port))
    proc = subprocess.Popen([sys.executable, "-m", "anki.syncserver"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    endpoint = f"http://127.0.0.1:{port}/"
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    yield endpoint
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def desktop(sync_server, tmp_path_factory):
    """Another client of the same account, with a few notes, uploaded first."""
    path = tmp_path_factory.mktemp("desktop") / "collection.anki2"
    col = Collection(str(path))
    deck = col.decks.id("Desktop deck")
    for front in ("one", "two", "three"):
        n = col.new_note(col.models.by_name("Basic"))
        n["Front"], n["Back"] = front, front.upper()
        col.add_note(n, deck)
    auth = col.sync_login(USER, PASSWORD, sync_server)
    col.close_for_full_sync()
    col.full_upload_or_download(auth=auth, server_usn=None, upload=True)
    col.reopen(after_full_sync=True)
    yield col, auth
    col.close()


@pytest.fixture(scope="module")
def client(sync_server, desktop, tmp_path_factory):
    data = tmp_path_factory.mktemp("appdata")
    os.environ["ANKIAPP_DATA"] = str(data)
    os.environ["ANKIAPP_SYNC_ENDPOINT"] = sync_server
    import server.config
    import server.colman
    import server.auth

    for m in (server.config, server.colman, server.auth):
        importlib.reload(m)
    import server.app

    importlib.reload(server.app)
    with TestClient(server.app.app) as c:
        yield c


def desktop_sync(col: Collection, auth) -> None:
    out = col.sync_collection(auth, False)
    assert out.required in (0, 1), f"desktop needed a full sync ({out.required})"


def test_login_rejects_wrong_password(client):
    r = client.post("/api/login", json={"username": USER, "password": "nope"})
    assert r.status_code == 401


def test_login_downloads_the_collection(client):
    r = client.post("/api/login", json={"username": USER, "password": PASSWORD})
    assert r.status_code == 200, r.text
    assert r.json()["sync"] == {"full": "download"}
    decks = client.get("/api/decks").json()
    names = [d["name"] for d in decks["decks"]]
    assert "Desktop deck" in names
    assert decks["cardCount"] == 3


def test_review_and_answer(client):
    decks = client.get("/api/decks").json()["decks"]
    did = next(d["id"] for d in decks if d["name"] == "Desktop deck")
    client.get(f"/api/decks/{did}")
    nxt = client.get("/api/review/next").json()
    assert not nxt["finished"]
    card = nxt["card"]
    assert card["question"]
    side = client.post("/api/review/answer-side", json={"cardId": card["id"]}).json()
    assert len(side["labels"]) == 4
    r = client.post("/api/review/answer", json={"cardId": card["id"], "ease": 3, "millis": 4000})
    assert r.status_code == 200
    assert r.json()["next"]["counts"]["new"] == 2
    # Answering the same card again is refused: it isn't the one on screen any more.
    assert client.post("/api/review/answer", json={"cardId": card["id"], "ease": 3}).status_code == 409


def test_undo_restores_the_card(client):
    before = client.get("/api/review/next").json()["counts"]
    r = client.post("/api/undo")
    assert r.status_code == 200
    assert "Answer" in r.json()["name"]
    after = client.get("/api/review/next").json()["counts"]
    assert after["new"] == before["new"] + 1


def test_changes_flow_both_ways(client, desktop):
    col, auth = desktop
    # The app adds a deck and syncs...
    assert client.post("/api/decks", json={"name": "From the web"}).status_code == 200
    r = client.post("/api/sync", json={})
    assert r.status_code == 200, r.text
    assert not r.json().get("conflict")
    # ...desktop sees it after its own sync.
    desktop_sync(col, auth)
    assert col.decks.id_for_name("From the web")
    # Desktop adds a note; the app gets it.
    n = col.new_note(col.models.by_name("Basic"))
    n["Front"], n["Back"] = "from desktop", "x"
    col.add_note(n, col.decks.id_for_name("Desktop deck"))
    desktop_sync(col, auth)
    assert client.post("/api/sync", json={}).status_code == 200
    assert client.get("/api/decks").json()["cardCount"] == 4


def test_schema_change_on_both_sides_is_a_conflict(client, desktop):
    col, auth = desktop
    # A field added on desktop (schema change)...
    nt = col.models.by_name("Basic")
    col.models.add_field(nt, col.models.new_field("Extra"))
    col.models.update_dict(nt)
    # ...and one on the web.
    nts = client.get("/api/notetypes").json()
    basic = next(n for n in nts if n["name"] == "Basic")
    full = client.get(f"/api/notetypes/{basic['id']}").json()["notetype"]
    field = client.get(f"/api/notetypes/{basic['id']}/new-field", params={"name": "Web"}).json()
    full["flds"].append(field)
    assert client.post(f"/api/notetypes/{basic['id']}/save", json={"notetype": full}).status_code == 200
    out = col.sync_collection(auth, False)
    # Desktop, as the second to change, is told a full sync is needed; it uploads.
    assert out.required in (2, 4)
    col.close_for_full_sync()
    col.full_upload_or_download(auth=auth, server_usn=None, upload=True)
    col.reopen(after_full_sync=True)
    # The app now has to choose.
    r = client.post("/api/sync", json={}).json()
    assert r.get("conflict") is True
    r = client.post("/api/sync", json={"full": "download"})
    assert r.status_code == 200, r.text
    fields = next(n for n in client.get("/api/notetypes").json() if n["name"] == "Basic")["fields"]
    assert "Extra" in fields and "Web" not in fields


def test_anki_page_rpc(client):
    # i18n is what every Anki page asks for first; a bad content type is refused.
    assert client.post("/_anki/i18nResources", content=b"", headers={"Content-Type": "text/plain"}).status_code == 403
    r = client.post("/_anki/i18nResources", content=b"", headers={"Content-Type": "application/binary"})
    assert r.status_code == 200 and len(r.content) > 100


def test_media_needs_the_key(client):
    token = client.get("/api/media-token").json()["token"]
    assert client.get("/m/wrong-token/x.png").status_code == 404
    assert client.get(f"/m/{token}/missing.png").status_code == 404
    assert client.get(f"/m/{token}/../collection.anki2").status_code in (403, 404)


def test_offline_pack_and_replay(client, desktop):
    pack = client.get("/api/offline/pack").json()
    assert pack["queues"], "a deck with due cards is packed"
    did, ids = next(iter(pack["queues"].items()))
    first, second = (pack["cards"][str(i)] for i in ids[:2])
    assert len(first["labels"]) == 4 and len(first["requeueSecs"]) == 4
    before = client.get("/api/decks").json()["studiedToday"]
    now = int(time.time() * 1000)
    ops = [
        # Again, then Good on the same card: the second applies although the first changed it.
        {"type": "answer", "cardId": first["id"], "ease": 1, "answeredAt": now, "millis": 3000, "cardMod": first["mod"]},
        {"type": "answer", "cardId": first["id"], "ease": 3, "answeredAt": now + 60000, "millis": 2000, "cardMod": first["mod"]},
        # A card changed elsewhere since the pack: its offline answer is out of date.
        {"type": "answer", "cardId": second["id"], "ease": 3, "answeredAt": now, "millis": 2000, "cardMod": second["mod"] - 1},
        {"type": "flag", "cardId": first["id"], "flag": 2},
    ]
    r = client.post("/api/offline/replay", json={"ops": ops}).json()
    assert r["applied"] == 3 and r["skipped"] == 1, r
    assert client.get(f"/api/cards/{first['id']}").json()["flag"] == 2
    assert client.get("/api/decks").json()["studiedToday"] != before


def test_logout_ends_the_session(client):
    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/decks").status_code == 401
