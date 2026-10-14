#!/usr/bin/env bash
# Build here and deploy to a machine without Node (the Pi), over SSH.
#
#   bash deploy/publish.sh [user@host]          (default: $ANKI_PI or dani@192.168.1.30)
#
# Pushes main to a bare repository on the machine (~/anki-pwa.git, made the first
# time), uploads the built app into ~/anki-pwa/web/dist, and runs deploy/update.sh
# there, which checks out what was pushed and restarts the service. The first time,
# finish with `bash deploy/pi-setup.sh` on the machine (it asks for the sudo password).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:-${ANKI_PI:-dani@192.168.1.30}}"
KEY="${ANKI_PI_KEY:-$HOME/.ssh/id_ed25519_pi}"
SSH=(ssh -o BatchMode=yes)
[ -f "$KEY" ] && SSH+=(-i "$KEY")
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "commit first: the machine gets what is committed on main" >&2
  exit 1
fi

echo "== build =="
python3 scripts/fetch_anki_web.py 2>/dev/null || python scripts/fetch_anki_web.py
(cd web && npm run build >/dev/null)

echo "== push =="
"${SSH[@]}" "$HOST" 'test -d ~/anki-pwa.git || git init -q --bare -b main ~/anki-pwa.git
  test -d ~/anki-pwa || git clone -q ~/anki-pwa.git ~/anki-pwa'
git push -q "ssh://$HOST/~/anki-pwa.git" main 2>/dev/null ||
  GIT_SSH_COMMAND="${SSH[*]}" git push -q "ssh://$HOST/~/anki-pwa.git" main

echo "== upload =="
tar -C web/dist -czf - . | "${SSH[@]}" "$HOST" \
  'rm -rf ~/anki-pwa/web/dist.new && mkdir -p ~/anki-pwa/web/dist.new &&
   tar -C ~/anki-pwa/web/dist.new -xzf - &&
   rm -rf ~/anki-pwa/web/dist.old && { mv ~/anki-pwa/web/dist ~/anki-pwa/web/dist.old 2>/dev/null || true; } &&
   mv ~/anki-pwa/web/dist.new ~/anki-pwa/web/dist'

echo "== update =="
"${SSH[@]}" "$HOST" 'cd ~/anki-pwa && git fetch -q origin main && git checkout -q -B main origin/main && bash deploy/update.sh'
