#!/usr/bin/env bash
# T3's cell: the stream-shape arms on one shaped link, interleaved, on the rig inside one
# network namespace. `docs/lanes/T3-stream-shape.md` is the work order and the decision rule.
#
#   unshare --user --map-root-user --net -- lab/scripts/stream_shape_cells.sh <out-dir> <server-bin> <harness-bin>
#
# RATE_MBIT (10) RTT_MS (60) LOSS_PCT (0) LOSS_MODEL (iid|gemodel) REPS (6) DEPTH (2)
# FX (frames_250k) TRACE (x3_short_scroll) ARMS ("shared pool:2 per-frame") shape the cell.
# The reader's step interval is DERIVED, not the trace's, and from the rate the link ACHIEVES
# rather than its label: the warm-up doubles as a saturation probe and the interval is a frame's
# time at that measured rate times HEADROOM (1.4). The label is wrong wherever loss is: at 2 %
# a 10 Mbit link carried 3 Mbit, so a nominal-rate interval over-demanded by 2x and every wait
# became a censoring artefact — `docs/measurements/r2/t3-250k-l2`. One interval for every arm,
# taken from the first (the reference), or the arms are not comparable.
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
mkdir -p "$out"
HEADROOM=${HEADROOM:-1.4}; PROBE_MS=${PROBE_MS:-10000}; PROBE_REPS=${PROBE_REPS:-3}
frame_bytes=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['meanFrameBytes'])" \
  "$(dirname "$FX")/metadata.json")

if ! command -v tc >/dev/null; then
  # No shaping available: run anyway so the machinery can be exercised, but leave a marker the
  # pooler refuses, so an unshaped run can never be mistaken for a cell.
  echo "!! no tc — running UNSHAPED. This cell decides nothing and the pooler will void it." >&2
  touch "$out/UNSHAPED"
else
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
fi
trap 'command -v tc >/dev/null && tc qdisc del dev lo root 2>/dev/null; kill ${pids[@]-} 2>/dev/null || true' EXIT

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

# `PROBE_REPS` discarded passes per arm in `saturate` mode, which holds DEPTH asks in flight and
# reports the frame rate the link sustains. The median sets the interval, and the spread says
# how much to trust it — a 4 s dwell at 1 frame/s quantises to 25 %. It does three jobs: it
# warms the page cache — the first read
# of a frame comes off disk and every later one off the cache, and pooling the two regimes
# reads as a stream-shape effect — and it measures what the link ACHIEVES, which is what the
# reader's demand must be set against, and at high loss that rate is itself a result: the arms
# differ 3.5x in sustained throughput at 2 % loss, far more than they differ in latency.
median_rate() { python3 -c "
import glob, json, statistics, sys
rs = sorted(json.load(open(f))['fill_rate'] for f in glob.glob(sys.argv[1]))
print(f'{statistics.median(rs):.3f} {\" \".join(f\"{r:.2f}\" for r in rs)}')" "$1"; }

for i in "${!ARMS[@]}"; do
  for k in $(seq 1 "$PROBE_REPS"); do
    "$harness" --url "https://127.0.0.1:${ports[$i]}/" --mode saturate \
      --depth "$DEPTH" --frame-count "$frames" --stream-mode "${ARMS[$i]}" --arm warmup \
      --bind 127.0.0.1 --timeout-ms 120000 --json --read-bps 0 \
      --fill-dwell-ms "$PROBE_MS" > "$out/probe.${ARMS[$i]//:/_}.$k.json"
  done
  echo "  probe ${ARMS[$i]} $(median_rate "$out/probe.${ARMS[$i]//:/_}.*.json") frames/s (median, then each)" >&2
done

STEP_MS=${STEP_MS:-$(python3 -c "
import glob, json, math, statistics
rs = [json.load(open(f))['fill_rate'] for f in glob.glob('$out/probe.${ARMS[0]//:/_}.*.json')]
r = statistics.median(rs)
if r <= 0:
    raise SystemExit('probe measured no frames — the cell cannot set a step interval')
print(max(1, math.ceil(1000 / r * $HEADROOM)))")}
echo "frame=${frame_bytes}B step=${STEP_MS}ms (${HEADROOM}x the rate ${ARMS[0]} sustained)" >&2

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
echo "wrote $(ls "$out"/*.r*.json 2>/dev/null | wc -l) repeats and $(ls "$out"/probe.*.json 2>/dev/null | wc -l) probes to $out" >&2
