#!/usr/bin/env bash
# The rigs that need a browser but no server, in headless Chromium: `downloader` (the clauses through
# the downloader, its transport faked inside its worker) and `dispatch` (its ordering and per-decoder
# bound against a stalling fake decoder). Needs playwright, Chromium and the decoder vendor.
#   usage: run_browser.sh [rig ...]   (default: downloader dispatch)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source client/contract/browser_env.sh
RIGS=("$@")
[[ ${#RIGS[@]} -gt 0 ]] || RIGS=(downloader dispatch)

require_browser
require_vendor
for rig in "${RIGS[@]}"; do
  if [[ ! -f "client/contract/dist/$rig-rig.js" ]]; then
    echo "run client/transport/ts/build.sh first: client/contract/dist/$rig-rig.js is missing" >&2
    exit 1
  fi
done

T="$(mktemp -d)"
STATIC=""
trap 'kill "$STATIC" 2>/dev/null || true; rm -rf "$T"' EXIT
start_static "$T/static.log"

# Each rig in its own page, side by side: both wait on timers far more than on the CPU.
pids=()
for rig in "${RIGS[@]}"; do
  node client/contract/drive_page.cjs "http://127.0.0.1:$PORT/client/contract/page.html?rig=$rig" >"$T/$rig.log" 2>"$T/$rig.err" &
  pids+=($!)
done
failed=0
for i in "${!RIGS[@]}"; do
  wait "${pids[$i]}" || failed=1
  echo "-- ${RIGS[$i]}"
  cat "$T/${RIGS[$i]}.err"
  tail -2 "$T/${RIGS[$i]}.log"
done
exit "$failed"
