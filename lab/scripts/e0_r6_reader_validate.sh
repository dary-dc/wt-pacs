#!/usr/bin/env bash
# E0-R6 — does the open-loop reader actually produce the condition under test?
#
# A failure here voids campaign R6 before it runs. The question is not "are the numbers
# good" but "can this rig still generate head-of-line blocking at all". Three campaigns'
# worth of guards all watched the measurement and none watched the mechanism.
#
# Passes only if, in the same cell, `--reader-mode open` shows reader lag and stranded
# bytes where `--reader-mode closed` shows neither.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV="$ROOT/target/lab-arms/exact-server-seg10"
HARNESS="$ROOT/target/release/window-harness"
NETSIM="$ROOT/target/release/netsim"
FIXTURE=frames_500x64k
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
TRACE="${TRACE:-$ROOT/lab/traces/radiologist_review_500.json}"
SPORT=14461; NPORT=15061
DEPTH=${DEPTH:-8}; CACHE=${CACHE:-64}
DELAY=${DELAY:-300}; RATE=${RATE:-8}; LOSS=${LOSS:-1.0}

run_one() {
  local mode=$1 sm=$2 flags=$3
  # shellcheck disable=SC2086
  "$SRV" --port "$SPORT" --study "$STUDY" --bind 127.0.0.1 \
    --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    $flags > /tmp/e0r6_srv.log 2>&1 &
  local s=$!
  for _ in $(seq 1 60); do grep -q '^wt_url=' /tmp/e0r6_srv.log && break; sleep 0.1; done
  "$NETSIM" --listen 127.0.0.1:"$NPORT" --upstream 127.0.0.1:"$SPORT" \
    --delay-ms "$DELAY" --rate-mbps "$RATE" --loss-pct "$LOSS" --queue-pkts 500 \
    --seed 4242 --stats true > /tmp/e0r6_ns.log 2>&1 &
  local ns=$!; sleep 0.4
  timeout 240 "$HARNESS" --url "https://127.0.0.1:$NPORT/" --mode trace --trace "$TRACE" \
    --read-bps 0 --depth "$DEPTH" --frame-count 500 --stream-mode "$sm" --bind 127.0.0.1 \
    --cache-frames "$CACHE" --reader-mode "$mode" --arm "e0r6_${mode}_${sm}" --json \
    > "/tmp/e0r6_${mode}_${sm}.json" 2>/tmp/e0r6_cli.log || echo "  (harness exit $?)"
  kill "$ns" "$s" 2>/dev/null || true; wait "$ns" "$s" 2>/dev/null || true
  python3 - "/tmp/e0r6_${mode}_${sm}.json" "$mode" "$sm" <<'PY'
import json,sys
try: m=json.load(open(sys.argv[1]))
except Exception as e: print(f"  {sys.argv[2]:6s} {sys.argv[3]:9s} NO JSON: {e}"); raise SystemExit
nz=[x for x in m.get("wait_ms",[]) if x>0]
print(f"  {sys.argv[2]:6s} {sys.argv[3]:9s} "
      f"lag={m['reader_lag_ms']:9.0f}ms strand={m['stranded_frames']:5d}f/{m['stranded_bytes']/1e6:6.2f}MB "
      f"cens={m['censored_waits']:4d}({m['censored_frac']*100:5.1f}%) cdrop={m['center_asks_dropped']:4d} "
      f"p95={m['p95_wait_ms']:8.1f} nz_n={len(nz):4d} peak={m['peak_outstanding']:3d} "
      f"frames={m['frames_on_wire']}")
PY
}

echo "cell: RTT $((DELAY*2)) ms, ${RATE} Mbps, ${LOSS}% loss, depth $DEPTH, cache $CACHE"
echo "shared stream:"
run_one closed shared "--stream-mode shared"
run_one open   shared "--stream-mode shared"
echo "per-frame streams:"
run_one closed per-frame "--stream-mode per-frame"
run_one open   per-frame "--stream-mode per-frame"
