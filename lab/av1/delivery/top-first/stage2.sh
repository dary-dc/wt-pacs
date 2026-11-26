#!/usr/bin/env bash
# Stage 2 of docs/av1/top-first.md §4: whole fills at r20000 and r50000 and head fills at r5000, 1× and 4×, five arms,
# rounds FIRST … LAST, each round its whole fills then its head fills, each run.mjs process cleaning its own /tmp.
#
#   lab/av1/delivery/top-first/stage2.sh FIRST LAST [ROWS]
set -euo pipefail
cd "$(dirname "$0")/../../../.."
ROWS=${3:-lab/av1/delivery/top-first/rows.jsonl}
ARMS=htj2k,k2,k2-aa,tf-frame,tf-series
fill() {
  NODE_PATH=$(npm root -g) node lab/av1/delivery/top-first/run.mjs --frames lab/.av1-work/top-first --sets "$1" --links "$2" \
    --throttles 1,4 --variants $ARMS --per-frame --rounds 1 --first-round "$3" --out "$ROWS" 2>&1 | grep "^round" || true
}
for r in $(seq "$1" "$2"); do
  fill dbts_a1,dbts_b1,dbts_c1 r20000,r50000 "$r"
  fill dbts_a1-head,dbts_b1-head,dbts_c1-head r5000 "$r"
  echo "ROUND $r DONE $(date -u +%H:%M)"
done
