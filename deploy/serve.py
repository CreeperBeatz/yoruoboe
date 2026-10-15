"""Serve the built app, and pass its sync requests on to AnkiWeb.

    python3 deploy/serve.py [--port 8767] [--dist web/dist] [--sync-target URL]

The app runs entirely in the browser: Anki's engine, the collection, everything. This
serves its files, and one more thing the browser can't do itself: AnkiWeb doesn't let
web pages on other sites call it (no CORS), so the app sends sync requests to its own
address, `/aw/<host>/<path>`, and they are passed on unchanged to
`https://<host>.ankiweb.net/<path>`. Nothing is stored here. `<host>` is `sync`, or
`syncN` for the server AnkiWeb moves an account to.

--sync-target sends them to another sync server instead (for testing against a local
one: --sync-target http://127.0.0.1:27701).

Standard library only, so it runs on the Pi's own Python.
"""

from __future__ import annotations

import argparse
import gzip
import http.client
import mimetypes
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

AW_PATH = re.compile(r"^/aw/(sync\d{0,3})(/.*)$")

# Anki's pages are routed by the app's service worker; served directly (the first load,
# before it is installed), they get their shell here.
ANKI_PAGES = re.compile(
    r"^/(graphs|congrats|card-info|change-notetype|deck-options|import-anki-package|"
    r"import-csv|import-page|image-occlusion|editor)(/|$)"
)
UNTRUSTED_PAGES = {"editor", "image-occlusion"}

# Request headers passed on to the sync server. Nothing that identifies the page or
# the browser beyond what the protocol needs.
FORWARD_REQUEST = {"anki-sync", "content-type", "content-length"}
# Response headers passed back.
FORWARD_RESPONSE = {"content-type", "content-length", "anki-original-size"}
# AnkiWeb answers 308 with an account's own server, for the client to retry there. The
# browser would follow a Location itself (to the wrong place), so the location goes in
# this header instead; the app's engine reads it.
REDIRECT_HEADER = "anki-sync-redirect"

TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".webmanifest": "application/manifest+json",
    ".css": "text/css",
    ".svg": "image/svg+xml",
}

CHUNK = 256 * 1024

# Compressed once and kept: the engine is 19 MB, 5 MB gzipped. (Behind Cloudflare the
# edge compresses too.)
COMPRESSIBLE = {".js", ".mjs", ".css", ".html", ".wasm", ".svg", ".json", ".webmanifest", ".map"}
_gz_cache: dict[tuple[str, float], bytes] = {}


def gzipped(file: Path) -> bytes:
    key = (str(file), file.stat().st_mtime)
    data = _gz_cache.get(key)
    if data is None:
        data = gzip.compress(file.read_bytes(), compresslevel=6)
        _gz_cache[key] = data
    return data


class Handler(BaseHTTPRequestHandler):
    server_version = "anki-pwa"
    dist: Path
    target: str | None  # a sync server for every /aw/ request, or None for AnkiWeb

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        sys.stderr.write("%s %s\n" % (self.command, fmt % args))

    # ---- sync forwarding ----------------------------------------------------------

    def do_POST(self) -> None:
        m = AW_PATH.match(self.path)
        if not m:
            self.send_error(404)
            return
        host, rest = m.groups()
        if self.target:
            url = urlsplit(self.target)
            secure = url.scheme == "https"
            netloc = url.netloc
            path = url.path.rstrip("/") + rest
        else:
            secure, netloc, path = True, f"{host}.ankiweb.net", rest
        length = int(self.headers.get("content-length") or 0)
        conn_cls = http.client.HTTPSConnection if secure else http.client.HTTPConnection
        conn = conn_cls(netloc, timeout=300)
        try:
            conn.putrequest("POST", path, skip_accept_encoding=True)
            for k, v in self.headers.items():
                if k.lower() in FORWARD_REQUEST:
                    conn.putheader(k, v)
            conn.endheaders()
            left = length
            while left > 0:
                chunk = self.rfile.read(min(CHUNK, left))
                if not chunk:
                    break
                conn.send(chunk)
                left -= len(chunk)
            resp = conn.getresponse()
            self.send_response(resp.status, resp.reason)
            for k, v in resp.getheaders():
                if k.lower() in FORWARD_RESPONSE:
                    self.send_header(k, v)
                elif k.lower() == "location":
                    self.send_header(REDIRECT_HEADER, v)
            self.send_header("Cache-Control", "no-store")
            if resp.getheader("content-length") is None:
                self.send_header("Connection", "close")
                self.close_connection = True
            self.end_headers()
            while chunk := resp.read(CHUNK):
                self.wfile.write(chunk)
        except OSError as exc:
            self.send_error(502, f"sync server unreachable: {exc}")
        finally:
            conn.close()

    # ---- the app's files --------------------------------------------------------------

    def do_GET(self) -> None:
        self._serve(head=False)

    def do_HEAD(self) -> None:
        self._serve(head=True)

    def _serve(self, head: bool) -> None:
        path = unquote(urlsplit(self.path).path)
        m = ANKI_PAGES.match(path)
        if m and not re.search(r"\.[a-z0-9]+$", path, re.I):
            path = "/anki-page-untrusted.html" if m.group(1) in UNTRUSTED_PAGES else "/anki-page.html"
        elif path.startswith("/editor/_anki/"):
            path = path[len("/editor"):]
        file = (self.dist / path.lstrip("/")).resolve()
        if self.dist not in file.parents and file != self.dist:
            self.send_error(403)
            return
        if file.is_dir():
            file = file / "index.html"
        if not file.is_file():
            if "." in path.rsplit("/", 1)[-1]:
                self.send_error(404)
                return
            # the app's own routes: the single-page app
            file = self.dist / "index.html"
        ctype = TYPES.get(file.suffix) or mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        rel = file.relative_to(self.dist).as_posix()
        if rel.startswith("assets/") or rel.startswith("_app/immutable/"):
            cache = "public, max-age=31536000, immutable"
        else:
            cache = "no-cache"
        body: bytes | None = None
        if file.suffix in COMPRESSIBLE and "gzip" in (self.headers.get("accept-encoding") or ""):
            body = gzipped(file)
        size = len(body) if body is not None else file.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        if body is not None:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        if file.suffix == ".html":
            # The app shows Anki's pages in frames of its own, never elsewhere.
            self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
        self.end_headers()
        if head:
            return
        if body is not None:
            self.wfile.write(body)
            return
        with file.open("rb") as f:
            while chunk := f.read(CHUNK):
                self.wfile.write(chunk)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8767)))
    ap.add_argument("--dist", default=str(root / "web" / "dist"))
    ap.add_argument("--sync-target", default=os.environ.get("SYNC_TARGET") or None)
    args = ap.parse_args()
    Handler.dist = Path(args.dist).resolve()
    Handler.target = args.sync_target
    if not (Handler.dist / "index.html").is_file():
        sys.exit(f"{Handler.dist} has no index.html: build the app first (see README)")
    # Anki's pages load dozens of scripts at once, and a tunnel (ngrok) opens a
    # connection for each: the default queue of 5 refuses the rest.
    ThreadingHTTPServer.request_queue_size = 128
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    where = args.sync_target or "AnkiWeb"
    print(f"serving {Handler.dist} on http://{args.host}:{args.port}/, sync -> {where}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
