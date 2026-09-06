#!/usr/bin/env bash
# E0-R6 calibration — find the reader speed at which a stream-shape comparison is
# admissible in a given cell.
#
# The operating point is not a free parameter to be chosen after seeing arm results.
# It is calibrated ONCE per cell on a single reference arm (shared stream, the incumbent)
# and then FROZEN across every arm. Tuning it per-arm would let the rig be shaped to fit
# whichever answer had started to look right — which is how three previous campaigns went
# wrong.
#
# Admissible band, fixed here before any arm runs:
#   center_asks_dropped == 0     the frame being measured was always actually asked for
#   stranded_frames     >  0     something arrived that the reader no longer wanted
#   censored_frac       <= 0.25  the arm did not simply collapse
#
# Calibrating on ONE seed is not enough, and R6's X3S run proved it: scale 6 was clean at
# seed 4242 and then voided 4 of 9 campaign rows, because a harder loss realisation pushed
# the transport far enough behind that the outstanding ceiling bound. Validate the chosen
# scale against the campaign's OWN seeds (RUN*7919+13) with SEEDS=, not just the default.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV="$ROOT/target/lab-arms/exact-server-seg10"
HARNESS="$ROOT/target/release/window-harness"
NETSIM="$ROOT/target/release/netsim"
FIXTURE="${FIXTURE:-frames_500x64k}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
TRACE="${TRACE:-$ROOT/lab/traces/radiologist_review_500.json}"
SPORT=14471; NPORT=15071
DEPTH=${DEPTH:-8}; CACHE=${CACHE:-64}
DELAY=${DELAY:-25}; RATE=${RATE:-20}; LOSS=${LOSS:-0.1}
SCALES=${SCALES:-"1 2 4 8 16"}
SEEDS=${SEEDS:-}

echo "cell: RTT $((DELAY*2)) ms, ${RATE} Mbps, ${LOSS}% loss, depth $DEPTH, cache $CACHE"
printf '%8s %10s %8s %9s %8s %10s %8s %8s\n' scale lag_ms strand cens% cdrop p95 nz_n frames
for SC in $SCALES; do
  "$SRV" --port "$SPORT" --study "$STUDY" --bind 127.0.0.1 \
    --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    --stream-mode shared > /tmp/e0c_srv.log 2>&1 &
  S=$!
  for _ in $(seq 1 60); do grep -q '^wt_url=' /tmp/e0c_srv.log && break; sleep 0.1; done
  "$NETSIM" --listen 127.0.0.1:"$NPORT" --upstream 127.0.0.1:"$SPORT" \
    --delay-ms "$DELAY" --rate-mbps "$RATE" --loss-pct "$LOSS" --queue-pkts 500 \
    --seed "${SEED:-4242}" --stats true > /tmp/e0c_ns.log 2>&1 &
  NS=$!; sleep 0.4
  timeout "${RUN_TIMEOUT:-300}" "$HARNESS" --url "https://127.0.0.1:$NPORT/" --mode trace --trace "$TRACE" \
    --read-bps 0 --depth "$DEPTH" --frame-count 500 --stream-mode shared --bind 127.0.0.1 \
    --cache-frames "$CACHE" --reader-mode open --step-scale "$SC" --arm "cal_$SC" --json \
    > /tmp/e0c.json 2>/dev/null || true
  kill "$NS" "$S" 2>/dev/null || true; wait "$NS" "$S" 2>/dev/null || true
  python3 - "$SC" <<'PY'
import json,sys
try: m=json.load(open("/tmp/e0c.json"))
except Exception: print(f"{sys.argv[1]:>8} {'NO JSON':>10}"); raise SystemExit
nz=[x for x in m.get("wait_ms",[]) if x>0]
ok = (m['center_asks_dropped']==0 and m['stranded_frames']>0 and m['censored_frac']<=0.25)
print(f"{sys.argv[1]:>8} {m['reader_lag_ms']:10.0f} {m['stranded_frames']:8d} "
      f"{m['censored_frac']*100:8.1f}% {m['center_asks_dropped']:8d} {m['p95_wait_ms']:10.1f} "
      f"{len(nz):8d} {m['frames_on_wire']:8d}  {'ADMISSIBLE' if ok else ''}")
PY
done
