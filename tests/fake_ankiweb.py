"""A stand-in for AnkiWeb's account move, for testing the app's handling of it.

    python tests/fake_ankiweb.py [--port 27702] [--upstream http://127.0.0.1:27701]

Passes every request on to a local sync server, except that the first `/sync/meta`
of each sync is answered as AnkiWeb answers an account living on another server:
308, Location https://sync26.ankiweb.net/. Point the forwarder at it
(`deploy/serve.py --sync-target http://127.0.0.1:27702`): the app must retry at
/aw/sync26/ and sync normally.
"""

from __future__ import annotations

import argparse
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PASS = {"anki-sync", "content-type", "content-length"}


class Handler(BaseHTTPRequestHandler):
    upstream: str
    redirect_next_meta = True

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        if self.path == "/sync/meta" and Handler.redirect_next_meta:
            Handler.redirect_next_meta = False
            self.send_response(308)
            self.send_header("Location", "https://sync26.ankiweb.net/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/sync/meta":
            Handler.redirect_next_meta = True  # the next sync is redirected again
        u = urlsplit(self.upstream)
        conn = http.client.HTTPConnection(u.netloc, timeout=120)
        conn.request("POST", self.path, body, {k: v for k, v in self.headers.items() if k.lower() in PASS})
        resp = conn.getresponse()
        data = resp.read()
        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() in ("content-type", "anki-original-size", "location"):
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=27702)
    ap.add_argument("--upstream", default="http://127.0.0.1:27701")
    args = ap.parse_args()
    Handler.upstream = args.upstream
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
