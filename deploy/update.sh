#!/usr/bin/env bash
# Pull the latest main, build and restart. Safe to run by hand.
set -euo pipefail
APP_DIR="${ANKIAPP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$APP_DIR"

echo "== fetch =="
git fetch --quiet origin main
git reset --hard origin/main          # .env, vendor/ and web/dist are untracked and stay

echo "== build =="
python3 scripts/fetch_anki_web.py
(cd web && npm ci --no-audit --no-fund && npm run build)

echo "== restart =="
sudo systemctl restart anki-web
sleep 2
systemctl is-active anki-web
curl -fsS -o /dev/null -w "app: HTTP %{http_code}\n" http://127.0.0.1:8767/
echo "deployed $(git rev-parse --short HEAD) at $(date -Is)"
