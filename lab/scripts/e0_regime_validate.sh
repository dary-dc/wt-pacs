#!/usr/bin/env bash
# E0-REGIME — does the loss-regime classifier get a known answer right?
#
# The classifier's output selects a congestion controller, and the two answers are
# opposite: congestive -> Cubic (BBR measured 63 % worse), exogenous -> BBR (Cubic measured
# 48 % worse). A classifier that is confidently wrong is worse than none at all, so it does
# not get used until it reproduces an answer we already know.
#
# `netsim` can construct each regime BY CONSTRUCTION, which is what makes this a real test
# rather than a demonstration:
#
#   EXO   1 % injected loss, offered load well under the link rate.
#         The bottleneck queue never fills, so `down_queue` stays 0 and EVERY lost packet
#         was injected on an empty path. Ground truth: exogenous.
#
#   CONG  0 % injected loss, offered load far above the link rate.
#         Nothing is injected, so every lost packet is the queue overflowing.
#         Ground truth: congestive.
#
# netsim's own `down_queue` counter is the independent witness: it must be 0 in EXO and
# large in CONG, or the cell did not build the regime it claims and the row proves nothing
# about the classifier.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Must be built with --features telemetry, or the sampler is compiled out entirely.
SRV="${SRV:-$ROOT/target/release/exact-server}"
HARNESS="$ROOT/target/release/window-harness"
NETSIM="$ROOT/target/release/netsim"
FIXTURE="${FIXTURE:-frames_500x64k}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
TRACE="$ROOT/lab/traces/radiologist_review_500.json"
SPORT=14501; NPORT=15101
OUTDIR="${OUTDIR:-$ROOT/.local/measurements/regime}"
mkdir -p "$OUTDIR"

# cell -> delay ms, rate Mbps, injected loss %, depth, step-scale, expected verdict
cell() {
  case "$1" in
    # Depth 4 at 64 KB is 256 KB in flight against a 500-packet (~725 KB) queue, so the
    # queue cannot overflow and the only loss is the 1 % injected.
    EXO)  echo "25 20 1.0 4 8 exogenous" ;;
    # Depth 32 at 64 KB is 2 MB in flight against the same queue, ~3x its capacity, and
    # nothing is injected. Every drop is overflow.
    CONG) echo "25 8 0.0 32 1 congestive" ;;
    *) echo "unknown cell $1" >&2; exit 1 ;;
  esac
}

run_cell() {
  local name=$1
  read -r DELAY RATE LOSS DEPTH SCALE EXPECT <<< "$(cell "$name")"
  local jsonl="$OUTDIR/${name}.jsonl"
  rm -f "$jsonl"

  echo "=== cell $name — RTT $((DELAY*2)) ms, ${RATE} Mbps, ${LOSS}% injected, depth $DEPTH"
  echo "    ground truth: $EXPECT"

  WTPACS_PATH_TELEMETRY=1 WTPACS_PATH_TELEMETRY_MS=250 WTPACS_PATH_TELEMETRY_PATH="$jsonl" \
    "$SRV" --port "$SPORT" --study "$STUDY" --bind 127.0.0.1 --stream-mode shared \
    --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    > /tmp/regime_srv.log 2>&1 &
  local S=$!
  for _ in $(seq 1 60); do grep -q '^wt_url=' /tmp/regime_srv.log && break; sleep 0.1; done
  kill -0 "$S" 2>/dev/null || { echo "server died: $(tail -3 /tmp/regime_srv.log)"; exit 1; }

  "$NETSIM" --listen 127.0.0.1:"$NPORT" --upstream 127.0.0.1:"$SPORT" \
    --delay-ms "$DELAY" --rate-mbps "$RATE" --loss-pct "$LOSS" --queue-pkts 500 \
    --seed 4242 --stats true > /tmp/regime_ns.log 2>&1 &
  local NS=$!; sleep 0.4

  timeout 240 "$HARNESS" --url "https://127.0.0.1:$NPORT/" --mode trace --trace "$TRACE" \
    --read-bps 0 --depth "$DEPTH" --frame-count 500 --stream-mode shared --bind 127.0.0.1 \
    --cache-frames 64 --reader-mode open --step-scale "$SCALE" --arm regime --json \
    > /dev/null 2>&1 || true

  kill "$NS" "$S" 2>/dev/null || true; wait "$NS" "$S" 2>/dev/null || true

  # The independent witness. If this disagrees with the cell's intent, the cell did not
  # build the regime it claims and nothing downstream is admissible.
  local QDROP
  QDROP=$(grep -o 'down_queue=[0-9]*' /tmp/regime_ns.log 2>/dev/null | tail -1 | cut -d= -f2)
  QDROP=${QDROP:-0}
  echo "    netsim queue drops: $QDROP"
  case "$name" in
    EXO)  [ "$QDROP" -eq 0 ] || echo "    *** CELL INVALID: EXO must have 0 queue drops ***" ;;
    CONG) [ "$QDROP" -gt 0 ] || echo "    *** CELL INVALID: CONG must overflow the queue ***" ;;
  esac
  echo "    samples: $(wc -l < "$jsonl" 2>/dev/null || echo 0)"
  echo
  python3 "$ROOT/lab/scripts/classify_loss_regime.py" "$jsonl" 2>&1 | sed 's/^/    /'
  echo
}

run_cell EXO
run_cell CONG
echo "PASS requires: EXO classified exogenous, CONG classified congestive, and each cell's"
echo "queue-drop witness agreeing with its intent. Anything else means the classifier is not"
echo "usable for the controller decision."
