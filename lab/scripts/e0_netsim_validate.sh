#!/usr/bin/env bash
# E0 — validate the lab instruments before any arm is run.
#
# Three checks, each of which would silently void the campaign if it failed:
#   1. netsim delay is real and accurate      (measured RTT tracks configured RTT)
#   2. netsim loss is real and at the set rate (counters, and the wire notices)
#   3. QUINN_INITIAL_WINDOW is live, not a no-op (monotonic response to the knob)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV="${SRV:-$ROOT/target/lab-arms/exact-server-seg10}"
HARNESS="$ROOT/target/release/window-harness"
NETSIM="$ROOT/target/release/netsim"
STUDY="$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd"
SPORT=14433; NPORT=15000

start_server() { # $@ = extra flags
  "$SRV" --port $SPORT --study "$STUDY" --stream-mode shared --bind 127.0.0.1 \
    --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    "$@" > /tmp/e0_server.log 2>&1 &
  SRV_PID=$!
  for _ in $(seq 1 50); do grep -q '^wt_url=' /tmp/e0_server.log && return 0; sleep 0.1; done
  tail -3 /tmp/e0_server.log >&2; return 1
}
start_netsim() { # $1 delay_ms $2 loss_pct $3 rate_mbps
  "$NETSIM" --listen 127.0.0.1:$NPORT --upstream 127.0.0.1:$SPORT \
    --delay-ms "$1" --loss-pct "$2" --rate-mbps "$3" > /tmp/e0_netsim.log 2>&1 &
  NS_PID=$!; sleep 0.4
}
stop() { kill ${NS_PID:-0} ${SRV_PID:-0} 2>/dev/null || true; wait ${NS_PID:-0} ${SRV_PID:-0} 2>/dev/null || true; }
trap stop EXIT

# depth 1 = strictly serial ask -> wait -> receive, so mean_wait_ms contains one RTT.
probe() { # $1 url -> mean_wait_ms
  "$HARNESS" --url "$1" --mode trace --trace "$ROOT/lab/traces/x3_short_scroll.json" \
    --read-bps 0 --depth 1 --frame-count 80 --stream-mode shared --bind 127.0.0.1 \
    --arm e0 --json 2>/dev/null | python3 -c "import json,sys;print('%.1f'%json.load(sys.stdin)['mean_wait_ms'])"
}

echo "=== 1 · delay accuracy (depth 1, 32 KB frames) ==="
printf '%-14s %-14s %s\n' "configured_rtt" "measured_wait" "delta_vs_direct"
start_server; BASE=$(probe "https://127.0.0.1:$SPORT/"); stop
printf '%-14s %-14s %s\n' "direct(0)" "$BASE" "-"
for D in 15 30 75; do
  start_server; start_netsim "$D" 0 0
  W=$(probe "https://127.0.0.1:$NPORT/")
  stop
  python3 -c "print('%-14s %-14s %+.1f  (expect %+d)' % ('netsim($((D*2)))', '$W', $W-$BASE, $((D*2))))"
done

echo
echo "=== 2 · loss is applied ==="
start_server; start_netsim 15 2.0 0
probe "https://127.0.0.1:$NPORT/" > /dev/null
stop
echo "netsim configured loss_pct=2.0 — see counters in /tmp/e0_netsim.log (stderr on exit)"

echo
echo "=== 3 · QUINN_INITIAL_WINDOW is live (RTT 300ms, one 32KB frame per ask) ==="
printf '%-22s %s\n' "initial_window" "mean_wait_ms"
for IW in 2400 12000 240000; do
  QUINN_INITIAL_WINDOW=$IW start_server
  start_netsim 150 0 0
  W=$(probe "https://127.0.0.1:$NPORT/")
  stop
  printf '%-22s %s\n' "$IW" "$W"
done
