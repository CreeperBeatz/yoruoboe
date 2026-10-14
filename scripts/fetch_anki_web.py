"""Unpack Anki's compiled web pages from the aqt wheel into vendor/anki-web.

The pages (deck options, statistics, editor, reviewer scripts, ...) must match the
engine exactly, since they talk to it in protobuf; so the aqt wheel of the release in
ANKI_VERSION is fetched from PyPI. aqt itself is never installed (it needs Qt).

    python3 scripts/fetch_anki_web.py

Standard library only: it runs wherever the app is built, the Pi included.
"""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "vendor" / "anki-web"
PREFIX = "_aqt/data/web/"


def anki_version() -> str:
    """The release the engine is built from, as PyPI numbers it (26.09.3 -> 26.9.3)."""
    version = (ROOT / "ANKI_VERSION").read_text().strip()
    return ".".join(str(int(p)) for p in version.split("."))


def main() -> None:
    version = anki_version()
    stamp = DEST / ".version"
    if stamp.is_file() and stamp.read_text().strip() == version:
        print(f"anki-web {version} already in place")
        return
    with urllib.request.urlopen(f"https://pypi.org/pypi/aqt/{version}/json") as r:
        release = json.load(r)
    wheel = next(u for u in release["urls"] if u["filename"].endswith(".whl"))
    with urllib.request.urlopen(wheel["url"]) as r:
        data = r.read()
    if hashlib.sha256(data).hexdigest() != wheel["digests"]["sha256"]:
        raise SystemExit(f"{wheel['filename']}: checksum mismatch")
    if DEST.exists():
        shutil.rmtree(DEST)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            if name.startswith(PREFIX) and not name.endswith("/"):
                target = DEST / name[len(PREFIX):]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(name))
    stamp.write_text(version)
    print(f"unpacked anki-web {version} to {DEST}")


if __name__ == "__main__":
    main()
