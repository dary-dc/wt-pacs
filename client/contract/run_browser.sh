#!/usr/bin/env bash
# The rigs that need a browser but no server, in headless Chromium: `downloader` (the clauses through
# the downloader, its transport faked inside its worker) and `dispatch` (its ordering and per-decoder
# bound against a stalling fake decoder); `-wasm` runs one through the WASM client. Needs playwright,
# Chromium, the decoder vendor and the WASM client's build.
#   usage: run_browser.sh [rig ...]   (default: dispatch downloader downloader-wasm dispatch-wasm)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source client/contract/browser_env.sh
RIGS=("$@")
[[ ${#RIGS[@]} -gt 0 ]] || RIGS=(dispatch downloader downloader-wasm dispatch-wasm)

require_browser
require_vendor
require_transport_wasm
for run in "${RIGS[@]}"; do
  rig=${run%-wasm}
  if [[ ! -f "client/contract/dist/$rig-rig.js" ]]; then
    echo "run client/transport/ts/build.sh first: client/contract/dist/$rig-rig.js is missing" >&2
    exit 1
  fi
done

T="$(mktemp -d)"
STATIC=""
trap 'kill "$STATIC" 2>/dev/null || true; rm -rf "$T"' EXIT
start_static "$T/static.log"

# Each rig in its own page, two at a time, the longest first: docs/CLIENTS.md §The contract suite.
failed=0
running=0
for run in "${RIGS[@]}"; do
  if ((running == 2)); then
    wait -n || failed=1
    running=$((running - 1))
  fi
  client=ts
  [[ $run == *-wasm ]] && client=wasm
  node client/contract/drive_page.cjs "http://127.0.0.1:$PORT/client/contract/page.html?rig=${run%-wasm}&client=$client" \
    >"$T/$run.log" 2>"$T/$run.err" &
  running=$((running + 1))
done
for ((; running > 0; running--)); do wait -n || failed=1; done
for run in "${RIGS[@]}"; do
  echo "-- $run"
  cat "$T/$run.err"
  tail -2 "$T/$run.log"
done
exit "$failed"
