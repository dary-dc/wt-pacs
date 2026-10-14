#!/usr/bin/env bash
# CLASSIFY's rounds: per round the deep-overflow cells, the neighbour's FIFO cells and the browser grid, in an
# order that rotates by round; rows appended under OUT. README.md.
#
#   lab/cc-classify/run.sh OUT FIRST LAST
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OUT=$(realpath "$1") FIRST=$2 LAST=$3
CCS="cubic-restart cubic-classify bbr"
mkdir -p "$OUT"
export NODE_PATH; NODE_PATH=$(npm root -g)

steal_quiet() {  # /proc/stat's steal ≤ 2 % over 10 s, waited for up to 5 min
  local n; for n in $(seq 30); do
    a=($(head -1 /proc/stat)); sleep 10; b=($(head -1 /proc/stat))
    local tot=0 i; for i in 1 2 3 4 5 6 7 8; do tot=$((tot + b[i] - a[i])); done
    (( (b[8] - a[8]) * 50 <= tot )) && return; echo "steal $(( (b[8] - a[8]) * 100 / tot )) %, waiting"
  done
  echo "steal never quiet: running anyway"
}
overflow() {
  python3 lab/loss-class/run.py --cells of-q500,of-q20 --ccs "${CCS// /,}" --depth 32 --first-round "$1" --rounds 1 \
    --out "$OUT/overflow.jsonl"
}
neighbour() {
  CCS="$CCS" QDISCS=fifo FIRST="$1" lab/scripts/fq_neighbour_cells.sh "$OUT/neighbour.tsv" $(($1 + 1)) | grep -v '^ *$' | tail -4
}
grid() {
  local g=(--frames lab/.av1-work/ccmeasure --fill 4 --asks-after 4 --throttles 1,4 --rounds 1 --first-round "$1"
    --out "$OUT/grid.jsonl")
  node lab/av1/delivery/total-time/run.mjs "${g[@]}" --links r5000,r20000,r50000 --impairs clean,j20,l1,l2 | grep -c '^round'
  node lab/av1/delivery/total-time/run.mjs "${g[@]}" --links lte-good --impairs clean,j20 | grep -c '^round'
}

RIGS=(overflow neighbour grid)
for ((r = FIRST; r <= LAST; r++)); do
  for k in 0 1 2; do
    rig=${RIGS[$(((r + k) % 3))]}
    steal_quiet
    echo "round $r $rig $(date -u +%H:%M)"
    "$rig" "$r"
  done
done
