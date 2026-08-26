#!/usr/bin/env bash
# Q2 smoke: induced loss on lo via netem, then one harness run. Needs NET_ADMIN (often root).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IFACE="${IFACE:-lo}"
LOSS="${LOSS:-1%}"
READ_BPS="${READ_BPS:-5000000}"

# Q2 threshold stated before run (edit deliberately, not after).
Q2_THRESHOLD_MS="${Q2_THRESHOLD_MS:-500}"

echo "Q2 pre-declared threshold: recovered_ms must beat ${Q2_THRESHOLD_MS} ms under loss to matter"
echo "Applying netem loss=$LOSS on $IFACE (requires privileges)..."

cleanup() {
  sudo tc qdisc del dev "$IFACE" root 2>/dev/null || true
}
trap cleanup EXIT

sudo tc qdisc add dev "$IFACE" root netem loss "$LOSS"

STUDY="$ROOT/fixtures/us_cine_smoke/us_cine_smoke.sbnd"
cargo run -p exact-server --release -- \
  --port 4433 --study "$STUDY" &
spid=$!
sleep 1.5

out=$(cargo run -p window-harness --release -- \
  --url "https://127.0.0.1:4433/" \
  --trace "$ROOT/lab/traces/fly_and_settle.json" \
  --read-bps "$READ_BPS" --server-cancel --json)

kill "$spid" 2>/dev/null || true
wait "$spid" 2>/dev/null || true

echo "$out"
recovered=$(echo "$out" | python3 -c "import json,sys; print(json.load(sys.stdin)['recovered_ms'])")
echo "recovered_ms=$recovered threshold=$Q2_THRESHOLD_MS loss=$LOSS"
