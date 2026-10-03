#!/usr/bin/env bash
# The rigs that need a browser but no server, in headless Chromium: `downloader` (the clauses through
# the downloader, its transport faked inside its worker) and `dispatch` (its ordering and per-decoder
# bound against a stalling fake decoder). Skips loudly when Chromium or playwright is missing, the way
# run.mjs skips the WASM arm when pkg/ is absent.
#   usage: run_browser.sh [rig ...]   (default: downloader dispatch)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
RIGS=("$@")
[[ ${#RIGS[@]} -gt 0 ]] || RIGS=(downloader dispatch)

if ! node -e 'require("playwright")' 2>/dev/null; then
  export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}"
  if ! node -e 'require("playwright")' 2>/dev/null; then
    echo "SKIPPED rigs: ${RIGS[*]} — playwright is not installed (npm install -g playwright)"
    exit 0
  fi
fi

CHROME="$(node -e 'console.log(process.env.CHROME_PATH || require("playwright").chromium.executablePath())' 2>/dev/null || true)"
if [[ ! -x "$CHROME" ]]; then
  echo "SKIPPED rigs: ${RIGS[*]} — no headless Chromium (set CHROME_PATH or: npx playwright install chromium)"
  exit 0
fi
export CHROME_PATH="$CHROME"

for rig in "${RIGS[@]}"; do
  if [[ ! -f "client/conformance/dist/$rig-rig.js" ]]; then
    echo "run client/transport-ts/build.sh first: client/conformance/dist/$rig-rig.js is missing" >&2
    exit 1
  fi
done

trap 'kill "$SERVER" 2>/dev/null || true' EXIT
for _ in 1 2 3; do
  PORT=$((20000 + RANDOM % 20000))
  python3 server/dev-server.py --port "$PORT" &
  SERVER=$!
  sleep 0.3
  kill -0 "$SERVER" 2>/dev/null && break
done
for _ in $(seq 50); do
  curl -sf "http://127.0.0.1:$PORT/client/conformance/page.html" >/dev/null 2>&1 && break
  sleep 0.1
done

failed=0
for rig in "${RIGS[@]}"; do
  echo "-- $rig"
  node client/conformance/drive_page.cjs "http://127.0.0.1:$PORT/client/conformance/page.html?rig=$rig" | tail -2 || failed=1
done
exit "$failed"
