#!/usr/bin/env bash
# Build Anki's engine for the browser into web/src/engine/pkg.
#   bash engine/build.sh [--dev]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
PROFILE=wasm
[[ "${1:-}" == "--dev" ]] && PROFILE=dev
OUT="$ROOT/web/src/engine/pkg"
cd "$ROOT/engine/anki"
cargo build -p anki_wasm --target wasm32-unknown-unknown --profile "$PROFILE"
DIR=$([[ $PROFILE == dev ]] && echo debug || echo "$PROFILE")
WASM="target/wasm32-unknown-unknown/$DIR/anki_wasm.wasm"
wasm-bindgen --target web --out-dir "$OUT" "$WASM"
ls -la "$OUT"
