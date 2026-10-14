"""Make a collection with one of everything the app shows, and upload it to a sync server.

    python tests/seed_collection.py http://127.0.0.1:27701/ alice secret

Replaces that account's collection on the server (a full upload).
"""

from __future__ import annotations

import struct
import sys
import tempfile
import zlib
from pathlib import Path

from anki.collection import Collection


def png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def wav_beep(secs: float = 0.4, freq: int = 660) -> bytes:
    import math

    rate = 8000
    n = int(rate * secs)
    data = bytes(int(128 + 100 * math.sin(2 * math.pi * freq * i / rate)) for i in range(n))
    return (
        b"RIFF" + struct.pack("<I", 36 + n) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate, 1, 8)
        + b"data" + struct.pack("<I", n) + data
    )


def main(endpoint: str, user: str, password: str) -> None:
    tmp = Path(tempfile.mkdtemp())
    col = Collection(str(tmp / "collection.anki2"))
    spanish = col.decks.id("Languages::Spanish")
    japanese = col.decks.id("Languages::Japanese")
    geo = col.decks.id("Geography")

    basic = col.models.by_name("Basic")
    rev = col.models.by_name("Basic (and reversed card)")
    typing = col.models.by_name("Basic (type in the answer)")
    cloze = col.models.by_name("Cloze")

    def add(model, deck, tags=(), **fields):
        n = col.new_note(model)
        for k, v in fields.items():
            n[k] = v
        n.tags = list(tags)
        col.add_note(n, deck)
        return n

    for es, en in [("hola", "hello"), ("adiós", "goodbye"), ("gato", "cat"), ("perro", "dog"), ("casa", "house")]:
        add(rev, spanish, ["vocab"], Front=es, Back=en)
    add(typing, spanish, ["typing"], Front="Translate: <b>thank you</b>", Back="gracias")
    for jp, en in [("猫", "cat"), ("犬", "dog"), ("水", "water")]:
        add(basic, japanese, ["kanji"], Front=f'<span style="font-size:48px">{jp}</span>', Back=en)
    add(cloze, geo, ["capitals"], Text="The capital of {{c1::France}} is {{c2::Paris}}.", **{"Back Extra": "Since 508 AD"})
    add(cloze, geo, ["math"], Text=r"Euler: \(e^{i\pi} + {{c1::1}} = 0\)")

    col.media.write_data("blue.png", png(120, 60, (30, 120, 220)))
    col.media.write_data("beep.wav", wav_beep())
    add(basic, geo, ["media"], Front='What colour? <img src="blue.png">', Back="Blue [sound:beep.wav]")
    m = col.models.by_name("Basic")
    # A TTS card type on a copy of Basic.
    tts = col.models.copy(m, add=False)
    tts["name"] = "Basic TTS"
    tts["tmpls"][0]["qfmt"] = "{{Front}} {{tts es_ES:Front}}"
    col.models.add_dict(tts)
    add(col.models.by_name("Basic TTS"), spanish, ["tts"], Front="buenos días", Back="good morning")

    auth = col.sync_login(user, password, endpoint)
    col.close_for_full_sync()
    col.full_upload_or_download(auth=auth, server_usn=None, upload=True)
    col.reopen(after_full_sync=True)
    col.sync_media(auth)
    import time

    while col.media_sync_status().active:
        time.sleep(0.2)
    print("uploaded", col.note_count(), "notes,", col.card_count(), "cards")
    col.close()


if __name__ == "__main__":
    main(*sys.argv[1:4])
