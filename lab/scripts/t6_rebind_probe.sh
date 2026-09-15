#!/usr/bin/env bash
# T6 step 1: does a session survive a 4-tuple change, and does `--workers` decide it?
#
#   lab/scripts/t6_rebind_probe.sh <workers> [reps]
#
# `wtransport`'s client endpoint exposes no `rebind()` and no handle on the quinn endpoint
# beneath it, so the plan's `Endpoint::rebind()` is not reachable. `nat_rebind_relay.py` sits
# between client and server and changes its own upstream source port mid-session instead —
# a NAT rebind, which is the field case the lane names. `docs/lanes/T6-session-survival.md`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
workers=$1; reps=${2:-3}
FX=${FX:-$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd}
for r in $(seq 1 "$reps"); do
  sport=$(python3 -c 'import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  rport=$(python3 -c 'import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  log=$(mktemp)
  NO_COLOR=1 RUST_LOG=exact_server=info "$ROOT/target/release/exact-server" --port "$sport" \
    --study "$FX" --bind 127.0.0.1 --workers "$workers" \
    --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" >"$log" 2>&1 &
  srv=$!
  timeout 30 bash -c "until grep -q '^frames=' '$log'; do :; done"
  python3 "$ROOT/lab/scripts/nat_rebind_relay.py" "$rport" "$sport" "${REBIND_AFTER_S:-6}" >/dev/null 2>&1 &
  relay=$!
  out=$(timeout 60 "$ROOT/target/release/window-harness" --url "https://127.0.0.1:$rport/" \
    --trace "$ROOT/lab/traces/x3_short_scroll.json" --mode trace --depth 2 --frame-count 80 \
    --arm "t6-w$workers" --reader-mode open --bind 127.0.0.1 --timeout-ms 40000 \
    --read-bps 0 --step-interval-ms 300 --json 2>/dev/null)
  kill "$relay" 2>/dev/null; wait "$relay" 2>/dev/null
  ended=$(grep -c "session reads" "$log")
  kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null; rm -f "$log"
  python3 -c "
import json, sys
d = json.loads(sys.argv[1] or '{}')
print(f\"workers=$workers r$r frames={d.get('frames_on_wire','-')} asks={d.get('asks_sent','-')} \"
      f\"censored={d.get('censored_frac', -1):.2f} server_saw_session_end=$ended\")" "$out"
done
