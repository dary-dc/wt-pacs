#!/usr/bin/env bash
# T3's cell: the stream-shape arms on one shaped link, interleaved, on the rig inside one
# network namespace. `docs/lanes/T3-stream-shape.md` is the work order and the decision rule.
#
#   unshare --user --map-root-user --net -- lab/scripts/stream_shape_cells.sh <out-dir> <server-bin> <harness-bin>
#
# RATE_MBIT (10) RTT_MS (60) LOSS_PCT (0) LOSS_MODEL (iid|gemodel) REPS (6) DEPTH (2)
# FX (frames_250k) TRACE (x3_short_scroll) ARMS ("shared pool:2 per-frame") shape the cell.
# The reader's step interval is DERIVED, not the trace's: a frame's wire time at RATE_MBIT
# times HEADROOM (1.4). A reader that demands faster than the link can ever deliver builds an
# unbounded backlog and every wait becomes a censoring artefact — `docs/measurements/r2/t3-250k-l0`.
# One JSON per arm per repeat; `stream_shape_pool.py` reads them. Arm order reverses every
# repeat, so a drift over the run cannot land on one arm.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
out=$1; server=$2; harness=$3
RATE_MBIT=${RATE_MBIT:-10}; RTT_MS=${RTT_MS:-60}; LOSS_PCT=${LOSS_PCT:-0}
LOSS_MODEL=${LOSS_MODEL:-iid}; REPS=${REPS:-6}; DEPTH=${DEPTH:-2}
FX=${FX:-$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd}
TRACE=${TRACE:-$ROOT/lab/traces/x3_short_scroll.json}
read -r -a ARMS <<< "${ARMS:-shared pool:2 per-frame}"
HEADROOM=${HEADROOM:-1.4}
frame_bytes=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['meanFrameBytes'])" \
  "$(dirname "$FX")/metadata.json")
STEP_MS=${STEP_MS:-$(python3 -c "
import math;print(max(1, math.ceil($frame_bytes * 8 / ($RATE_MBIT * 1000) * $HEADROOM)))")}
echo "frame=${frame_bytes}B wire=$(python3 -c "print(f'{$frame_bytes*8/($RATE_MBIT*1000):.0f}')")ms step=${STEP_MS}ms" >&2
mkdir -p "$out"

ip link set lo up
one_way=$(python3 -c "print(max(0.001, $RTT_MS / 2))")
loss=()
case "$LOSS_MODEL" in
  iid) [[ "$LOSS_PCT" != 0 ]] && loss=(loss "${LOSS_PCT}%") ;;
  gemodel) loss=(loss gemodel "${GE_P:-0.07}%" "${GE_R:-14}%") ;;
  *) echo "LOSS_MODEL iid|gemodel" >&2; exit 2 ;;
esac
tc qdisc replace dev lo root netem delay "${one_way}ms" rate "${RATE_MBIT}mbit" "${loss[@]}"
tc qdisc show dev lo >&2
trap 'tc qdisc del dev lo root 2>/dev/null || true; kill ${pids[@]-} 2>/dev/null || true' EXIT

pids=(); ports=()
for arm in "${ARMS[@]}"; do
  port=$(python3 -c 'import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  log="$out/server.${arm//:/_}.log"
  NO_COLOR=1 RUST_LOG=exact_server=warn "$server" --port "$port" --study "$FX" --bind 127.0.0.1 \
    --stream-mode "$arm" --cert-pem "$ROOT/server/dev-cert/cert.pem" \
    --key-pem "$ROOT/server/dev-cert/key.pem" >"$log" 2>&1 &
  pids+=($!); ports+=("$port")
  timeout 30 bash -c "until grep -q '^frames=' '$log' 2>/dev/null; do :; done"
done
frames=$(sed -n 's/^frames=//p' "$out/server.${ARMS[0]//:/_}.log" | head -1)

# One discarded pass per arm: the first read of a frame comes off disk and every later one
# off the page cache, and pooling the two regimes reads as a stream-shape effect.
for i in "${!ARMS[@]}"; do
  "$harness" --url "https://127.0.0.1:${ports[$i]}/" --trace "$TRACE" --mode trace \
    --depth "$DEPTH" --frame-count "$frames" --stream-mode "${ARMS[$i]}" --arm warmup \
    --reader-mode open --bind 127.0.0.1 --timeout-ms 120000 --json \
    --read-bps 0 --step-interval-ms "$STEP_MS" > /dev/null
  echo "  warmup ${ARMS[$i]} done" >&2
done

for r in $(seq 1 "$REPS"); do
  order=("${!ARMS[@]}"); (( r % 2 == 0 )) && order=($(printf '%s\n' "${order[@]}" | tac))
  for i in "${order[@]}"; do
    "$harness" --url "https://127.0.0.1:${ports[$i]}/" --trace "$TRACE" --mode trace \
      --depth "$DEPTH" --frame-count "$frames" --stream-mode "${ARMS[$i]}" --arm "${ARMS[$i]}" \
      --reader-mode open --bind 127.0.0.1 --timeout-ms 120000 --json \
      --read-bps 0 --step-interval-ms "$STEP_MS" \
      > "$out/${ARMS[$i]//:/_}.r${r}.json"
    echo "  r$r ${ARMS[$i]} done" >&2
  done
done
echo "wrote $(ls "$out"/*.json | wc -l) runs to $out" >&2
