#!/usr/bin/env bash
# The rigs that need a browser but no server, in headless Chromium: `downloader` (the clauses through
# the downloader, its transport faked inside its worker) and `dispatch` (its ordering and per-decoder
# bound against a stalling fake decoder). Needs playwright, Chromium and the decoder vendor.
#   usage: run_browser.sh [rig ...]   (default: downloader dispatch)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source client/conformance/browser_env.sh
RIGS=("$@")
[[ ${#RIGS[@]} -gt 0 ]] || RIGS=(downloader dispatch)

require_browser
require_vendor
for rig in "${RIGS[@]}"; do
  if [[ ! -f "client/conformance/dist/$rig-rig.js" ]]; then
    echo "run client/transport-ts/build.sh first: client/conformance/dist/$rig-rig.js is missing" >&2
    exit 1
  fi
done

T="$(mktemp -d)"
STATIC=""
trap 'kill "$STATIC" 2>/dev/null || true; rm -rf "$T"' EXIT
start_static "$T/static.log"

failed=0
for rig in "${RIGS[@]}"; do
  echo "-- $rig"
  node client/conformance/drive_page.cjs "http://127.0.0.1:$PORT/client/conformance/page.html?rig=$rig" | tail -2 || failed=1
done
exit "$failed"
