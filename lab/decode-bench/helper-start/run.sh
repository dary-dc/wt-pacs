#!/usr/bin/env bash
# HELPERSTART's campaign: each round runs the four blocks below in a rotated order. README.md
#
#   lab/decode-bench/helper-start/run.sh ROUNDS OUTDIR [FIRST=0]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ROUNDS=$1 OUT=$(mkdir -p "$2" && cd "$2" && pwd) FIRST=${3:-0}
W="$ROOT/lab/.av1-work/helperstart"
export NODE_PATH="$(npm root -g)"
cd "$ROOT"
ARMS=built,lab:cb2,lab:cb2late
block() {
  case $1 in
    0) ARMS=$ARMS SCENARIOS=ready,ask,warm FIRST=$r OUT="$OUT/loop-g512-$r.jsonl" node lab/decode-bench/builds.mjs 1 ;;
    1) ARMS=$ARMS SCENARIOS=ask,warm FIRST=$r SERIES="$W/decode_dbtproj_ge" OUT="$OUT/loop-proj-$r.jsonl" node lab/decode-bench/builds.mjs 1 ;;
    2) node lab/av1/delivery/total-time/run.mjs --rounds 1 --first-round "$r" --frames "${W#"$ROOT"/}" --sets g512,dbtproj_ge \
         --links r50000,lte-good --throttles 1,4 --out "$OUT/fill.jsonl" ;;
    3) node lab/av1/delivery/total-time/run.mjs --rounds 1 --first-round "$r" --frames "${W#"$ROOT"/}" --sets g512 \
         --links lte-good --throttles 4 --fill 1 --out "$OUT/ask-lte.jsonl" ;;
  esac
}
for ((r = FIRST; r < FIRST + ROUNDS; r++)); do
  for k in 0 1 2 3; do block $(((k + r) % 4)) 2>&1 | grep -E '^round|Error|error' || true; done
  echo "round $r done $(date -u +%FT%TZ)"
done
