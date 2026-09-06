#!/usr/bin/env bash
# Before/after CPU profile of both browser arms on three harness cells, same host, builds swapped
# in per run. An artifacts dir holds one subdir per variant with: shell.js, session.js (the TS
# product bundle) and pkg/ (the WASM package, built with `wasm-pack --profiling` so names survive).
#
# usage: client_ab_profile.sh ARTIFACTS_DIR [OUT_DIR]      (variants: ARTIFACTS_DIR/{before,after})
# env: SERVER (default target/release/exact-server), HTTP_PORT=8765, WT_PORT=4433, REPEATS=2
# Summarise with: python3 lab/scripts/client_ab_summarize.py OUT_DIR
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
ART=$1; OUT=${2:-$ROOT/.local/client-ab-profiles}; mkdir -p "$OUT"
SERVER=${SERVER:-$ROOT/target/release/exact-server}; HTTP_PORT=${HTTP_PORT:-8765}; WT_PORT=${WT_PORT:-4433}; REPEATS=${REPEATS:-2}
PROFILE=$ROOT/lab/scripts/client_profile.mjs
swap() { cp "$ART/$1/shell.js" client/harness/shell.js; cp "$ART/$1/session.js" client/transport-ts/dist/session.js; rm -rf client/transport-wasm/pkg; cp -r "$ART/$1/pkg" client/transport-wasm/pkg; }
restore() { git checkout -q -- client/harness/shell.js 2>/dev/null || true; bash client/transport-ts/build.sh >/dev/null; (cd client/transport-wasm && bash build.sh >/dev/null 2>&1) || true; }
python3 server/dev-server.py --port "$HTTP_PORT" --study us_cine_smoke > "$OUT/http.log" 2>&1 & HPID=$!; sleep 0.5
cell() { local tag=$1 fixture=$2 frames=$3 mode=$4 query=$5
  "$SERVER" --port "$WT_PORT" --study "lab/fixtures/$fixture/$fixture.sbnd" --stream-mode "$mode" --bind 127.0.0.1 > "$OUT/server.log" 2>&1 & local SPID=$!; sleep 0.8
  for rep in $(seq 1 "$REPEATS"); do for v in before after; do swap "$v"; for arm in ts wasm; do
    timeout 200 node "$PROFILE" "http://127.0.0.1:$HTTP_PORT" "$arm" "$query&frames=$frames" "$OUT/$tag-$v-r$rep-$arm.json" 150 2>&1 | head -1 | sed "s/^/$tag $v r$rep /"
  done; done; done
  kill "$SPID"; wait "$SPID" 2>/dev/null; }
cell fill250k frames_250k_live 320 shared "cell=fill&stream_mode=shared"
cell ondemand32k frames_32k 80 shared "cell=ondemand&stream_mode=shared&d=4&n=2000"
cell fill250k-perframe frames_250k_live 320 per-frame "cell=fill&stream_mode=per-frame"
kill "$HPID"; wait "$HPID" 2>/dev/null
restore
echo "profiles in $OUT"
