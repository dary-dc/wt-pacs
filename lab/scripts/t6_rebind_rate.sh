#!/usr/bin/env bash
# How often does a NAT rebind kill the session, and how does it die?
# `docs/lanes/T6-session-survival.md` step 1. `t6_rebind_probe.sh` answers whether the cliff
# exists; this answers at what rate, because the hash is redrawn on every rebind.
#
#   lab/scripts/t6_rebind_rate.sh <workers> <reps>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

WORKERS="${1:-4}"
REPS="${2:-12}"
STUDY="${STUDY:-lab/fixtures/queue_large/queue_large.sbnd}"
PORT="${PORT:-4433}"
WARM="${WARM:-10}"
TIMEOUT_MS="${TIMEOUT_MS:-8000}"
SERVER="${SERVER:-target/debug/exact-server}"
PROBE="${PROBE:-target/debug/rebind-probe}"

out="${OUT:-$(mktemp -d)}"
mkdir -p "$out"

"$SERVER" --port "$PORT" --study "$STUDY" --workers "$WORKERS" >"$out/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 100); do
  grep -q '^wt_url=' "$out/server.log" && break
  sleep 0.1
done
grep -q '^wt_url=' "$out/server.log" || { echo "server did not start"; cat "$out/server.log"; exit 1; }

for rep in $(seq 1 "$REPS"); do
  lp=$((15000 + rep * 2))
  cp=$((15001 + rep * 2))
  python3 lab/scripts/nat_rebind_relay.py "$lp" "$PORT" 0 "$cp" >"$out/relay.$rep.log" 2>&1 &
  relay_pid=$!
  for _ in $(seq 1 50); do
    grep -q '^READY' "$out/relay.$rep.log" && break
    sleep 0.1
  done
  "$PROBE" --url "https://127.0.0.1:$lp/" --control-port "$cp" \
    --warm "$WARM" --timeout-ms "$TIMEOUT_MS" \
    >"$out/probe.$rep.json" 2>"$out/probe.$rep.err" || true
  kill "$relay_pid" 2>/dev/null || true
  wait "$relay_pid" 2>/dev/null || true
  printf 'rep %-2s %s | %s\n' "$rep" \
    "$(grep -o 'REBOUND [0-9]* -> [0-9]*' "$out/relay.$rep.log" | head -1)" \
    "$(cat "$out/probe.$rep.json" 2>/dev/null || tail -1 "$out/probe.$rep.err")"
done

echo "--- tally (workers=$WORKERS, reps=$REPS) ---"
cat "$out"/probe.*.json 2>/dev/null | python3 -c 'import sys,json,collections
c=collections.Counter()
for line in sys.stdin:
    line=line.strip()
    if line:
        c[json.loads(line)["verdict"]]+=1
for k,v in c.most_common():
    print(f"  {k}: {v}")'
echo "out=$out"
