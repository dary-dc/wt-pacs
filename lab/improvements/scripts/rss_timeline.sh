#!/usr/bin/env bash
# Server VmRSS over time while one harness saturates it in per-frame mode.
# usage: rss_timeline.sh LABEL SERVER_TELEMETRY_BIN OUT.jsonl  (env: DWELL_MS=20000 MODE=per-frame FIXTURE=frames_32k PORT=4466)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
label=$1; bin=$2; out=$3
DWELL_MS=${DWELL_MS:-20000}; MODE=${MODE:-per-frame}; FIXTURE=${FIXTURE:-frames_32k}; PORT=${PORT:-4466}
dir="${WORK:-$ROOT/.local/rss-timeline}/$label-$MODE"; rm -rf "$dir"; mkdir -p "$dir"
study=$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd
frames=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$FIXTURE/metadata.json'))['frameCount'])")
WTPACS_TELEMETRY=1 WTPACS_TELEMETRY_PATH=$dir/telemetry-server.json WTPACS_TELEMETRY_SUMMARY_MS=1000 \
  "$bin" --port $PORT --study "$study" --cert-pem $ROOT/server/dev-cert/cert.pem --key-pem $ROOT/server/dev-cert/key.pem \
  --stream-mode $MODE --bind 127.0.0.1 > $dir/server.out 2> $dir/server.err &
spid=$!
for _ in $(seq 1 50); do grep -q '^telemetry=' $dir/server.out 2>/dev/null && break; sleep 0.1; done
"$HARNESS" --url https://127.0.0.1:$PORT/ --mode saturate --depth 4 --read-bps 0 \
  --fill-dwell-ms $DWELL_MS --frame-count $frames --stream-mode $MODE --arm rss --ipv4 --json > $dir/harness.json 2> $dir/harness.err &
hpid=$!
t0=$(date +%s.%N)
while kill -0 $hpid 2>/dev/null; do
  rss=$(awk '/VmRSS/{print $2}' /proc/$spid/status)
  served=$(python3 -c "import json,sys
try: print(json.load(open('$dir/telemetry-server.json'))['summary']['send_us']['count'])
except Exception: print(0)")
  t=$(python3 -c "print(round($(date +%s.%N)-$t0,1))")
  echo "{\"label\":\"$label\",\"mode\":\"$MODE\",\"t_s\":$t,\"vmrss_kb\":$rss,\"served_frames\":$served}" >> "$out"
  sleep 1
done
wait $hpid || true
final_rss=$(awk '/VmRSS/{print $2}' /proc/$spid/status); hwm=$(awk '/VmHWM/{print $2}' /proc/$spid/status)
kill -TERM $spid; wait $spid 2>/dev/null || true
served=$(python3 -c "import json;print(json.load(open('$dir/telemetry-server.json'))['summary']['send_us']['count'])")
echo "{\"label\":\"$label\",\"mode\":\"$MODE\",\"t_s\":\"end\",\"vmrss_kb\":$final_rss,\"vmhwm_kb\":$hwm,\"served_frames\":$served}" >> "$out"
tail -1 "$out"
