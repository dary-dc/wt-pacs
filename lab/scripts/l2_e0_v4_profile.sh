#!/usr/bin/env bash
# Packet-level E0 for L2 v4. `tc qdisc show` alone is not enough (the 2026-09-07
# campaign grepped knobs, then `stats` deleted the qdisc).
#
# Pass only if, after applying profile 60 / limit 1000:
#   1. tc shows rate 10Mbit, delay 30ms, limit 1000
#   2. a bulk harness run has achieved_mbps ≤ 12 (the 10 Mbit cap is on the path)
#   3. a 10 % loss run increments netem_drops
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
source "$ROOT/lab/scripts/cloud_common.sh"
export RIG_LOCK_HOLDER="${RIG_LOCK_HOLDER:-L2-v4}"
source "$ROOT/lab/scripts/rig_lock.sh"

OUT="${OUT:-$ROOT/.local/l2/e0-v4}"
mkdir -p "$OUT/traces"
PROFILE="${PROFILE:-60}"
LIMIT="${NETEM_LIMIT:-1000}"
PORT="${CLOUD_PORT:-4435}"
CLOUD_URL="${CLOUD_URL:-https://${CLOUD_HOST}:${PORT}/}"
export CLOUD_URL
HARNESS_IPV4="${HARNESS_IPV4:---ipv4}"
STUDY="$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"
BIN_SERVER="${BIN_SERVER:-$ROOT/target/release/exact-server}"
JUMP="$ROOT/lab/traces/l2_jump.json"

cleanup() { cloud_set_netem off 0 2>/dev/null || true; rig_lock_release || true; }
trap cleanup EXIT

[[ -x "$HARNESS" ]] || { echo "missing $HARNESS" >&2; exit 1; }
[[ -x "$BIN_SERVER" ]] || { echo "missing $BIN_SERVER" >&2; exit 1; }

python3 -c "import json,sys; t=json.load(open(sys.argv[1])); t['step_interval_ms']=40; json.dump(t, open(sys.argv[2],'w'))" \
  "$JUMP" "$OUT/traces/jump40.json"

netem_line() { "${SSH[@]}" "sudo -n tc qdisc show" | grep netem || true; }
netem_drops() {
  cloud_netem_stats | sed -n 's/.*dropped \([0-9]*\).*/\1/p'
}

echo "=== L2 e0 v4 packet $(date -Iseconds) ==="
rig_lock_acquire
cloud_sync_netem_script

echo "==> deploy exact-server on $PORT" >&2
"${SSH[@]}" "bash -s" "$PORT" <<'REMOTE'
set -euo pipefail
PORT=$1
# free only this port — do not pkill exact-server-q on 4437
pid=$(ss -ltnp 2>/dev/null | sed -n "s/.*:${PORT} .*pid=\\([0-9]*\\).*/\\1/p" | head -1)
[[ -n "${pid:-}" ]] && kill "$pid" 2>/dev/null || true
sleep 1
mkdir -p /home/ubuntu/wt-pacs/{bin,cert,fixtures}
REMOTE
"${SCP[@]}" "$BIN_SERVER" "$REMOTE:/home/ubuntu/wt-pacs/bin/exact-server.new"
"${SCP[@]}" "$CERT" "$KEY_PEM" "$REMOTE:/home/ubuntu/wt-pacs/cert/"
"${SCP[@]}" "$STUDY" "$REMOTE:/home/ubuntu/wt-pacs/fixtures/frames_32k.sbnd"
"${SSH[@]}" "bash -s" "$PORT" <<'REMOTE'
set -euo pipefail
PORT=$1
mv -f /home/ubuntu/wt-pacs/bin/exact-server.new /home/ubuntu/wt-pacs/bin/exact-server
chmod +x /home/ubuntu/wt-pacs/bin/exact-server
setsid env RUST_LOG=info nohup /home/ubuntu/wt-pacs/bin/exact-server --port "$PORT" \
  --study /home/ubuntu/wt-pacs/fixtures/frames_32k.sbnd \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode shared > /tmp/wt-pacs-exact.log 2>&1 < /dev/null &
disown; sleep 2; pgrep -x exact-server || { cat /tmp/wt-pacs-exact.log; exit 1; }
REMOTE

cloud_set_netem "$PROFILE" 0 "$LIMIT"
show=$(netem_line)
echo "$show"
echo "$show" | grep -q "delay 30ms" && echo "$show" | grep -qi "10Mbit" && echo "$show" | grep -q "limit 1000" \
  || { echo "FAIL: tc knobs" >&2; exit 1; }

echo "==> bulk jump under 10 Mbit (must be ≤ 12 Mbps)" >&2
json=$("$HARNESS" --url "$CLOUD_URL" $HARNESS_IPV4 --trace "$OUT/traces/jump40.json" \
  --read-bps 0 --depth 0 --prefetch 79 --frame-count 80 --fill-dwell-ms 0 \
  --mode trace --arm e0_bulk --stream-mode shared --timeout-ms 180000 --json) \
  || { echo "FAIL: bulk harness" >&2; exit 1; }
printf '%s\n' "$json" > "$OUT/e0_bulk.json"
mbps=$(python3 -c "import json,sys; print(json.load(sys.stdin)['achieved_mbps'])" <<<"$json")
python3 -c "import sys; m=float(sys.argv[1]); print(f'achieved_mbps={m:.2f}'); sys.exit(0 if m<=12 else 1)" "$mbps" \
  || { echo "FAIL: shaper not on path (bulk $mbps Mbps)" >&2; exit 1; }

cloud_set_netem "$PROFILE" 10 "$LIMIT"
d0=$(netem_drops); d0=${d0:-0}
echo "==> 10% loss run (drops must rise from $d0)" >&2
"$HARNESS" --url "$CLOUD_URL" $HARNESS_IPV4 --trace "$OUT/traces/jump40.json" \
  --read-bps 0 --depth 0 --prefetch 0 --frame-count 80 --fill-dwell-ms 0 \
  --mode trace --arm e0_loss --stream-mode shared --timeout-ms 180000 --json \
  > "$OUT/e0_loss.json" || true
d1=$(netem_drops); d1=${d1:-0}
echo "drops $d0 -> $d1"
python3 -c "import sys; a,b=int(sys.argv[1]),int(sys.argv[2]); sys.exit(0 if b>a else 1)" "$d0" "$d1" \
  || { echo "FAIL: netem_drops did not increment under 10% loss (stats still wiping?)" >&2; exit 1; }

# prove stats did not delete the qdisc
netem_line | grep -q netem || { echo "FAIL: stats deleted netem" >&2; exit 1; }

cloud_set_netem off 0
rig_lock_release
trap - EXIT
echo "=== e0 v4 packet PASS: 10 Mbit binds bulk, stats is read-only, 10% loss increments drops ==="
