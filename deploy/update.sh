#!/usr/bin/env bash
# Pull the latest main, build (if Node is here) and restart. Safe to run by hand;
# deploy/publish.sh runs it after pushing and uploading a build.
set -euo pipefail
APP_DIR="${ANKIAPP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$APP_DIR"

echo "== fetch =="
git fetch --quiet origin main
git reset --hard origin/main          # .env, vendor/ and web/dist are untracked and stay

echo "== build =="
if command -v npm >/dev/null; then
  python3 scripts/fetch_anki_web.py
  (cd web && npm ci --no-audit --no-fund && npm run build)
else
  # no Node here: web/dist was built elsewhere and uploaded (deploy/publish.sh)
  test -f web/dist/index.html || { echo "no web/dist: run deploy/publish.sh from a PC" >&2; exit 1; }
  echo "  using the uploaded web/dist"
fi

echo "== restart =="
if systemctl cat anki-web >/dev/null 2>&1; then
  sudo -n systemctl restart anki-web
else
  echo "  the service isn't installed yet: run  bash deploy/pi-setup.sh  here once"
  exit 0
fi
sleep 2
systemctl is-active anki-web
curl -fsS -o /dev/null -w "app: HTTP %{http_code}\n" http://127.0.0.1:8767/
echo "deployed $(git rev-parse --short HEAD) at $(date -Is)"
