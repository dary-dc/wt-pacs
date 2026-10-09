#!/usr/bin/env bash
# One rig in a stock headless Firefox, its clauses filtered: no playwright, the log taken by POST.
#   usage: FIREFOX_PATH=... client/contract/run_firefox.sh RIG [CLAUSE,...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source client/contract/browser_env.sh
[[ -x "${FIREFOX_PATH:-}" ]] || { echo "set FIREFOX_PATH to a Firefox binary" >&2; exit 2; }
require_vendor
T="$(mktemp -d)"
STATIC=""
trap 'kill "$STATIC" 2>/dev/null || true; rm -rf "$T"' EXIT
start_static "$T/static.log"
node client/contract/drive_firefox.mjs "http://127.0.0.1:$PORT/client/contract/page.html?rig=$1${2:+&only=$2}"
