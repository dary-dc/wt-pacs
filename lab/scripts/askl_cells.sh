#!/usr/bin/env bash
# Row 108 (ASKL): depth-1 asks over QUIC and over kernel TCP (the WebSocket fallback), each with the
# same controller, through the packet-layer relay, at 0 / 0.5 / 1 / 2 / 4 % Gilbert-Elliott loss, 80 ms, a step trace.
# Summarised by lab/stream-shape/askl.py; results in docs/transport/transport-conclusions.md §5, ASKL.
#
#   lab/scripts/askl_cells.sh OUT_DIR [ROUNDS] [ARMS] [CELLS]   (re-runs itself inside `unshare -rn`)
set -euo pipefail
if [[ -z ${ASKL_INSIDE:-} ]]; then
  exec unshare -rn env ASKL_INSIDE=1 "$0" "$@"
fi
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ip link set lo up
OUT=$(realpath "$1"); ROUNDS=${2:-9}; ARMS=${3:-"cc:cubic ws:cubic cc:bbr ws:bbr"}
mkdir -p "$OUT"
export NODE_PATH=$(npm root -g)
python3 lab/scripts/gen_step_trace.py 24000:1000 12000:1000 > "$OUT/steps.trace"
for cell in ${4:-loss0 ge0.5 ge1 ge2 ge4}; do
  node lab/stream-shape/run.mjs --tax --tun --trace "$OUT/steps.trace" --rate 20000 --queue 100 --rtt 80 \
    --frame-bytes 256000 --asks 30 --rounds "$ROUNDS" --cell "$cell" --arms "$ARMS" \
    --out "$OUT/$cell.jsonl" > "$OUT/$cell.log" 2>&1
done
python3 lab/stream-shape/askl.py "$OUT"/*.jsonl
