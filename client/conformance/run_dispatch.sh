#!/usr/bin/env bash
# D2c: the ordering and per-decoder dispatch bound, in headless Chromium against a stalling
# fake decoder — no server. Skips loudly when Chromium or playwright is missing, as the WASM
# arm does when pkg/ is absent.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! node -e 'require("playwright")' 2>/dev/null; then
  export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}"
  if ! node -e 'require("playwright")' 2>/dev/null; then
    echo "SKIPPED arm: dispatch — playwright is not installed (npm install -g playwright)"
    exit 0
  fi
fi

CHROME="$(node -e 'console.log(process.env.CHROME_PATH || require("playwright").chromium.executablePath())' 2>/dev/null || true)"
if [[ ! -x "$CHROME" ]]; then
  echo "SKIPPED arm: dispatch — no headless Chromium (set CHROME_PATH or: npx playwright install chromium)"
  exit 0
fi
export CHROME_PATH="$CHROME"

if [[ ! -f client/conformance/dist/dispatch-rig.js ]]; then
  echo "run client/transport-ts/build.sh first: client/conformance/dist/ is missing" >&2
  exit 1
fi

trap 'kill "$SERVER" 2>/dev/null || true' EXIT
for _ in 1 2 3; do
  PORT=$((20000 + RANDOM % 20000))
  python3 server/dev-server.py --port "$PORT" &
  SERVER=$!
  sleep 0.3
  kill -0 "$SERVER" 2>/dev/null && break
done
for _ in $(seq 50); do
  curl -sf "http://127.0.0.1:$PORT/client/conformance/dispatch.html" >/dev/null 2>&1 && break
  sleep 0.1
done

node client/conformance/drive_downloader.cjs "http://127.0.0.1:$PORT/client/conformance/dispatch.html"
