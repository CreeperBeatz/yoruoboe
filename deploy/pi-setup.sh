#!/usr/bin/env bash
# One-shot setup on the Pi, next to the other sites. Run as your user, not with sudo.
#
#   bash deploy/pi-setup.sh
#
# The app runs on the phone (Anki's engine, in the browser); the Pi only serves its
# files and passes sync requests on to AnkiWeb (deploy/serve.py), on 127.0.0.1:8767.
# In the Cloudflare tunnel, point one hostname at it:
#
#   anki.<domain>  ->  http://127.0.0.1:8767     open it in Safari, Share > Add to Home Screen
#
# Needs python3 (any 3.10+) and Node 20+ to build. No Rust: the engine is built on a PC
# and committed (web/src/engine/pkg; see README, "Rebuilding the engine").
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"
cd "$APP_DIR"

echo "== build =="
python3 scripts/fetch_anki_web.py
(cd web && npm ci --no-audit --no-fund && npm run build)

echo "== config =="
if [ ! -f .env ]; then
  cat > .env <<'ENV'
# Pass sync requests to a self-hosted sync server instead of AnkiWeb:
# SYNC_TARGET=http://127.0.0.1:27701
ENV
  echo "  wrote .env"
fi

echo "== systemd =="
sed "s#__APP_DIR__#$APP_DIR#g; s#__USER__#$USER_NAME#g" deploy/anki-web.service |
  sudo tee /etc/systemd/system/anki-web.service >/dev/null
echo "$USER_NAME ALL=(root) NOPASSWD: /usr/bin/systemctl restart anki-web" |
  sudo tee /etc/sudoers.d/anki-pwa >/dev/null
sudo chmod 440 /etc/sudoers.d/anki-pwa
sudo visudo -cf /etc/sudoers.d/anki-pwa
sudo systemctl daemon-reload
sudo systemctl enable --now anki-web
sudo systemctl restart anki-web

sleep 2
systemctl is-active anki-web
curl -fsS -o /dev/null -w "app: HTTP %{http_code}\n" http://127.0.0.1:8767/
