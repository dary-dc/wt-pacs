#!/usr/bin/env bash
# E0-STALL — does `--mode stall` really stop reading? A failure here voids the campaign.
# The two arms, the derived known answer and all five rules:
# docs/transport/measurements/mem/stall-client.md, appendix.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV="${SRV_BIN:-$ROOT/target/release/exact-server}"
HARNESS="$ROOT/target/release/window-harness"
FIXTURE="${FIXTURE:-frames_500x64k}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
SPORT=${SPORT:-14651}
ASKS=${ASKS:-200}
SM=${SM:-shared}
# 64 000 payload + 4 B length prefix + 4 B frame index. Derived, not observed.
FRAME_WIRE=64008
EXPECT=$((ASKS * FRAME_WIRE))

run_one() {
  local label=$1 after=$2 hold=$3
  "$SRV" --port "$SPORT" --study "$STUDY" --bind 127.0.0.1 --stream-mode "$SM" \
    --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    > /tmp/e0stall_srv.log 2>&1 &
  local s=$!
  for _ in $(seq 1 80); do grep -q '^wt_url=' /tmp/e0stall_srv.log && break; sleep 0.1; done
  # NO `timeout` wrapper, or `$!` is the wrapper's pid and /proc reports the wrapper.
  "$HARNESS" --url "https://127.0.0.1:$SPORT/" --mode stall --stream-mode "$SM" \
    --bind 127.0.0.1 --frame-count 500 --stall-after-ms "$after" --stall-asks "$ASKS" \
    --stall-hold-ms "$hold" --arm "e0stall_$label" --json > "/tmp/e0stall_$label.json" 2>/dev/null &
  local h=$!
  echo 0 > "/tmp/e0stall_$label.peak"
  ( peak=0
    while kill -0 "$h" 2>/dev/null; do
      a=$(awk '/^RssAnon:/{print $2}' /proc/"$h"/status 2>/dev/null || echo 0)
      [ "${a:-0}" -gt "$peak" ] && peak=$a
      echo "$peak" > "/tmp/e0stall_$label.peak"
      sleep 0.25
    done ) &
  local mon=$!
  wait "$h" 2>/dev/null
  kill "$mon" 2>/dev/null; wait "$mon" 2>/dev/null
  kill "$s" 2>/dev/null; wait "$s" 2>/dev/null
}

echo "E0-STALL — stream_mode=$SM asks=$ASKS  expected full read = $EXPECT bytes"
echo
run_one reading 60000 6000
run_one parked  0     14000

python3 "$ROOT/lab/transport/scripts/e0_stall_checks.py" "$EXPECT" "$FRAME_WIRE"
