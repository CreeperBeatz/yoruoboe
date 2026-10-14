"""Recreate engine/anki: Anki's source at the release in ANKI_VERSION, its translation
submodules at the commits that release pins, and this project's changes
(engine/anki-wasm.patch) on top.

    python engine/setup_source.py           # fetch and patch
    python engine/setup_source.py --diff    # write engine/anki-wasm.patch from engine/anki
    (--dest DIR works on another folder than engine/anki)

engine/anki is a git repository whose first commit is the untouched release, so the
patch is always `git diff` against it. Upgrading Anki: change ANKI_VERSION, run this,
fix what no longer applies, rebuild (engine/build.sh), and regenerate the patch.
"""

from __future__ import annotations

import io
import json
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "engine" / "anki"
PATCH = ROOT / "engine" / "anki-wasm.patch"
REPO = "ankitects/anki"
SUBMODULES = {
    "ftl/core-repo": "ankitects/anki-core-i18n",
    "ftl/qt-repo": "ankitects/anki-desktop-ftl",
}


def version() -> str:
    return (ROOT / "ANKI_VERSION").read_text().strip()


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "anki-pwa-setup"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def extract(url: str, dest: Path) -> None:
    """A GitHub tarball into dest, without its top folder."""
    with urllib.request.urlopen(url) as r:
        data = r.read()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for m in tar.getmembers():
            parts = m.name.split("/", 1)
            if len(parts) < 2 or not parts[1] or m.issym() or m.islnk():
                continue
            m.name = parts[1]
            tar.extract(m, dest, filter="data")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(SRC), *args], check=True, capture_output=True, encoding="utf-8"
    ).stdout


def setup() -> None:
    tag = version()
    if SRC.exists():
        sys.exit(f"{SRC} exists; remove it first (or use --diff to save your changes)")
    SRC.mkdir(parents=True)
    print(f"Anki {tag} source")
    extract(f"https://github.com/{REPO}/archive/refs/tags/{tag}.tar.gz", SRC)
    for path, repo in SUBMODULES.items():
        sha = fetch_json(f"https://api.github.com/repos/{REPO}/contents/{path}?ref={tag}")["sha"]
        print(f"  {path} at {sha[:8]}")
        (SRC / path).mkdir(parents=True, exist_ok=True)
        extract(f"https://github.com/{repo}/archive/{sha}.tar.gz", SRC / path)
    git("init", "-q")
    git("add", "-A")
    git("-c", "user.name=upstream", "-c", "user.email=upstream@localhost", "commit", "-qm", f"Anki {tag}")
    if PATCH.exists():
        subprocess.run(["git", "-C", str(SRC), "apply", "--whitespace=nowarn", str(PATCH)], check=True)
        print(f"applied {PATCH.name}")
    print("now: bash engine/build.sh && python engine/gen_ts.py")


def diff() -> None:
    git("add", "-A")
    patch = git("diff", "--cached", "--binary", "HEAD")
    git("reset", "-q")
    PATCH.write_text(patch, encoding="utf8", newline="\n")
    print(f"wrote {PATCH} ({len(patch.splitlines())} lines)")


if __name__ == "__main__":
    if "--dest" in sys.argv:
        SRC = Path(sys.argv[sys.argv.index("--dest") + 1]).resolve()
    if "--diff" in sys.argv:
        diff()
    else:
        setup()
