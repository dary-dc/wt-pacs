#!/usr/bin/env bash
# What datagram size a real Chromium lets the server send: one harness run through the UDP
# relay, sizes in both directions. docs/improvements/2026-09-10.md.
#
#   lab/scripts/mtu_vs_browser.sh LABEL STUDY_NAME [exact-server args...]
#
# env: BIN=target/release/exact-server N=400 D=4 CELL=ondemand MODE=shared OUT=.local/mtu-vs-browser
# Needs the dev cert, lab/fixtures/STUDY_NAME, client/transport-ts/dist, and Playwright
# (`npm i -g playwright`, PLAYWRIGHT_BROWSERS_PATH set).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LABEL=$1; STUDY=$2; shift 2
BIN="${BIN:-$ROOT/target/release/exact-server}"
N="${N:-400}"; D="${D:-4}"; CELL="${CELL:-ondemand}"; MODE="${MODE:-shared}"
UP_PORT="${UP_PORT:-14600}"; TAP_PORT=4433; HTTP_PORT="${HTTP_PORT:-8765}"
DIR="${OUT:-$ROOT/.local/mtu-vs-browser}/$LABEL"; rm -rf "$DIR"; mkdir -p "$DIR"

# dev-server.py resolves a study under fixtures/; point it at the lab fixture for the run.
made_link=0
if [[ ! -e "fixtures/$STUDY" ]]; then ln -s "../lab/fixtures/$STUDY" "fixtures/$STUDY"; made_link=1; fi
frames=$(python3 -c "import json;print(json.load(open('lab/fixtures/$STUDY/metadata.json'))['frameCount'])")

RUST_LOG=exact_server=info "$BIN" --port "$UP_PORT" --study "lab/fixtures/$STUDY/$STUDY.sbnd" \
  --stream-mode "$MODE" --bind 127.0.0.1 "$@" >"$DIR/server.out" 2>"$DIR/server.err" &
SPID=$!
python3 lab/scripts/udp_tap.py "$TAP_PORT" "$UP_PORT" "$DIR/tap.json" &
TPID=$!
python3 server/dev-server.py --port "$HTTP_PORT" --study "$STUDY" >"$DIR/http.log" 2>&1 &
HPID=$!
cleanup() {
  kill "$SPID" "$HPID" 2>/dev/null || true; kill -INT "$TPID" 2>/dev/null || true
  wait 2>/dev/null || true
  (( made_link )) && rm -f "fixtures/$STUDY"
}
trap cleanup EXIT
for _ in $(seq 1 100); do grep -q '^wt_url=' "$DIR/server.out" 2>/dev/null && break; sleep 0.05; done
sleep 0.5

URL="http://127.0.0.1:$HTTP_PORT/harness/ts.html?cell=$CELL&d=$D&n=$N&frames=$frames&stream_mode=$MODE&autorun=1"
NODE_PATH="$(npm root -g)" node lab/scripts/chrome_harness.cjs "$URL" 180000 >"$DIR/chrome.log" 2>"$DIR/chrome.err" \
  || echo "chrome failed: $(cat "$DIR/chrome.err")" >&2
sleep 0.5
kill -INT "$TPID"; wait "$TPID" 2>/dev/null || true
kill "$SPID" 2>/dev/null || true; wait "$SPID" 2>/dev/null || true

echo "== $LABEL: transport=$(sed -n 's/^transport=//p' "$DIR/server.out")"
sed 's/\x1b\[[0-9;]*m//g' "$DIR/server.out" | grep -a 'session path' | sed 's/.*INFO //' || true
grep '^run_end' "$DIR/chrome.log" | cut -c1-160 || true
python3 - "$DIR/tap.json" <<'PY'
import json, sys
t = json.load(open(sys.argv[1]))
for d in ("c2s", "s2c"):
    x = t[d]
    print(f"{d}: datagrams={x['datagrams']} bytes={x['bytes']} max={x['max']} mean={x['mean']} top={x['top_sizes'][:5]}")
PY
