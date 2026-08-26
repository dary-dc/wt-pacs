#!/usr/bin/env bash
# E0 — does netem tell the truth? window-saturation-experiment.md §3d
#
# Run BEFORE the emulated grid. Compares cloud (real path) vs local netem (matched RTT/bps).
#
# Does not modify E1/E3 tooling. Uses live-cell trace + fixture by default.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/.local/measurements}"
TRACE="${TRACE:-$ROOT/lab/traces/live_cell_scroll.json}"
STUDY="${STUDY:-$ROOT/lab/fixtures/frames_250k_live/frames_250k_live.sbnd}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY="${KEY:-$ROOT/server/dev-cert/key.pem}"
FRAME_COUNT="${FRAME_COUNT:-320}"
DEPTH="${DEPTH:-2}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

# Cloud harness target (required for step 1).
CLOUD_URL="${CLOUD_URL:-}"
LOCAL_PORT="${LOCAL_PORT:-4433}"
LOCAL_URL="${LOCAL_URL:-https://127.0.0.1:${LOCAL_PORT}/}"

# After step 1, set these from measured values (or pass explicitly).
MEASURED_RTT_MS="${MEASURED_RTT_MS:-}"
MEASURED_READ_BPS="${MEASURED_READ_BPS:-}"
TOLERANCE="${TOLERANCE:-0.15}"  # 15%

mkdir -p "$OUT_DIR"
[[ -f "$TRACE" ]] || { echo "missing trace $TRACE — run gen_live_cell_trace.py" >&2; exit 1; }
[[ -f "$STUDY" ]] || { echo "missing study $STUDY — run gen_live_cell_fixture.sh" >&2; exit 1; }

SERVER="$CARGO_TARGET_DIR/release/exact-server"
HARNESS="$CARGO_TARGET_DIR/release/window-harness"
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  cargo build -p exact-server -p window-harness --release >/dev/null
else
  [[ -x "$SERVER" && -x "$HARNESS" ]] || {
    echo "SKIP_BUILD=1 but missing $SERVER or $HARNESS" >&2
    exit 1
  }
fi

run_harness() {
  local url=$1 arm=$2 rtt_ms=$3 read_bps=$4
  local netem_note=""
  local extra=(--rtt-ms "$rtt_ms")
  if [[ "${USE_NETEM:-0}" == "1" ]]; then
    extra=()
    netem_note="netem"
  fi
  "$HARNESS" --url "$url" --trace "$TRACE" --read-bps "$read_bps" \
    --depth "$DEPTH" --frame-count "$FRAME_COUNT" --fill-dwell-ms 0 \
    --mode trace --arm "$arm" "${extra[@]}" --json
}

echo "=== E0 step 1: cloud (real path, unshaped) ===" >&2
if [[ -z "$CLOUD_URL" ]]; then
  echo "Set CLOUD_URL=https://host:port/ and re-run. Skipping step 1." >&2
  exit 2
fi
cloud_json=$(run_harness "$CLOUD_URL" "e0_cloud" 0 100000000)
printf '%s\n' "$cloud_json" > "$OUT_DIR/E0_CLOUD.json"
echo "$cloud_json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('cloud mean_wait_ms=', d['mean_wait_ms'], 'p95=', d['p95_wait_ms'])
"

if [[ -z "$MEASURED_RTT_MS" || -z "$MEASURED_READ_BPS" ]]; then
  echo "Set MEASURED_RTT_MS and MEASURED_READ_BPS from step 1 (ping + achieved throughput)." >&2
  exit 2
fi

echo "=== E0 step 2: local netem/sim at RTT=${MEASURED_RTT_MS}ms bps=${MEASURED_READ_BPS} ===" >&2
"$SERVER" --port "$LOCAL_PORT" --study "$STUDY" \
  --cert-pem "$CERT" --key-pem "$KEY" >/dev/null 2>&1 &
spid=$!
sleep 1.0
local_json=$(run_harness "$LOCAL_URL" "e0_local_emulated" "$MEASURED_RTT_MS" "$MEASURED_READ_BPS")
kill "$spid" 2>/dev/null || true
wait "$spid" 2>/dev/null || true
printf '%s\n' "$local_json" > "$OUT_DIR/E0_LOCAL.json"

python3 - "$OUT_DIR/E0_SUMMARY.md" "$cloud_json" "$local_json" "$MEASURED_RTT_MS" "$MEASURED_READ_BPS" "$TOLERANCE" <<'PY'
import json, sys
from pathlib import Path
out, cloud_s, local_s, rtt, bps, tol = sys.argv[1:7]
tol = float(tol)
cloud = json.loads(cloud_s)
local = json.loads(local_s)

def rel_gap(a, b):
    if a == 0:
        return float("inf") if b else 0.0
    return abs(b - a) / a

mean_gap = rel_gap(cloud["mean_wait_ms"], local["mean_wait_ms"])
p95_gap = rel_gap(cloud["p95_wait_ms"], local["p95_wait_ms"])
ok = mean_gap <= tol and p95_gap <= tol
verdict = "PROCEED — netem grid trustworthy" if ok else "STOP — emulated path diverges"

Path(out).write_text(f"""# E0 netem validation

| | cloud (real) | local (emulated) | rel gap |
| --- | --- | --- | --- |
| mean_wait_ms | {cloud['mean_wait_ms']:.2f} | {local['mean_wait_ms']:.2f} | {mean_gap:.1%} |
| p95_wait_ms | {cloud['p95_wait_ms']:.2f} | {local['p95_wait_ms']:.2f} | {p95_gap:.1%} |

Emulation: RTT={rtt} ms, read_bps={bps}, tolerance={tol:.0%}

**{verdict}**
""")
print(verdict)
PY

echo "Wrote $OUT_DIR/E0_SUMMARY.md" >&2
