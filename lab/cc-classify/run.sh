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
LAB=series-server/lab-classify
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
# The controller is a lab feature, so each rig's server is built with it: the overflow's also with the loss trace it reads.
release() {  # FEATURES DIR
  cargo build -q --release -p series-server -p pack-series -p window-harness --features "$1"
  mkdir -p "$2" && cp "${CARGO_TARGET_DIR:-target}"/release/{series-server,pack-series,window-harness} "$2"
}
release "$LAB" "$OUT/bin"
release "$LAB,series-server/telemetry" "$OUT/bin-trace"

overflow() {
  BIN="$OUT/bin-trace" python3 lab/loss-class/run.py --cells of-q500,of-q20 --ccs "${CCS// /,}" --depth 32 --first-round "$1" --rounds 1 \
    --out "$OUT/overflow.jsonl"
}
neighbour() {
  FEATURES=$LAB CCS="$CCS" QDISCS=fifo FIRST="$1" lab/scripts/fq_neighbour_cells.sh "$OUT/neighbour.tsv" $(($1 + 1)) | grep -v '^ *$' | tail -4
}
grid() {
  local g=(--bin "$OUT/bin" --frames lab/.av1-work/ccmeasure --fill 4 --asks-after 4 --throttles 1,4 --rounds 1 --first-round "$1"
    --out "$OUT/grid.jsonl")
  node lab/av1/delivery/total-time/run.mjs "${g[@]}" --links r5000,r20000,r50000 --impairs clean,j20,l1,l2 \
    >> "$OUT/grid.log" 2>&1
  node lab/av1/delivery/total-time/run.mjs "${g[@]}" --links lte-good --impairs clean,j20 >> "$OUT/grid.log" 2>&1
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
