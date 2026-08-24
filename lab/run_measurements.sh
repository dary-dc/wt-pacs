#!/usr/bin/env bash
# Run layer-1 sim + layer-2 harness (cancel A/B) + cold-page bench. No commits.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.local/measurements"
STUDY="$ROOT/fixtures/us_cine_smoke/us_cine_smoke.sbnd"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
READ_BPS="${READ_BPS:-2000000}"

mkdir -p "$OUT"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

if [[ ! -f "$CERT" ]]; then
  "$ROOT/server/scripts/gen_dev_cert.sh"
fi

# Pre-build once to avoid cargo lock contention between server + harness.
cargo build -p exact-server -p queue-sim -p queue-harness -p cold-page-bench --release >/dev/null
HARNESS="$CARGO_TARGET_DIR/release/queue-harness"
SERVER="$CARGO_TARGET_DIR/release/exact-server"
SIM="$CARGO_TARGET_DIR/release/queue-sim"
COLD="$CARGO_TARGET_DIR/release/cold-page-bench"

REPORT="$OUT/RESULTS.md"
{
  echo "# Queue harness measurements"
  echo ""
  echo "Generated: $(date -Iseconds)"
  echo ""
  echo "## Layer 1 — queue-sim (predicted)"
  echo ""
  echo '```'
} > "$REPORT"

cargo run -p queue-sim --release -- --link-bps 2000000,5000000,10000000 >> "$REPORT" 2>&1 || "$SIM" --link-bps 2000000,5000000,10000000 >> "$REPORT" 2>&1 || true
echo '```' >> "$REPORT"

run_arm() {
  local cancel=$1
  local label=$2
  local trace_path=$3
  local read_bps=$4
  echo "=== trace=$(basename "$trace_path") label=$label ==="
  "$SERVER" \
      --port 4433 --study "$STUDY" \
      --cert-pem "$CERT" --key-pem "$KEY" &
  local spid=$!
  sleep 1.5
  set +e
  local out
  local sc_flag=""
  [[ "$cancel" == "1" ]] && sc_flag="--server-cancel"
  out=$("$HARNESS" \
    --url "https://127.0.0.1:4433/" \
    --trace "$trace_path" \
    --read-bps "$read_bps" \
    $sc_flag \
    --json 2>&1)
  local rc=$?
  set -e
  kill "$spid" 2>/dev/null || true
  wait "$spid" 2>/dev/null || true
  sleep 0.5

  echo "### Arm $label (server_cancel_label=$cancel, read_bps=$read_bps)" >> "$REPORT"
  echo "" >> "$REPORT"
  if [[ $rc -eq 0 ]]; then
    echo '```json' >> "$REPORT"
    echo "$out" >> "$REPORT"
    echo '```' >> "$REPORT"
  else
    echo "FAILED: $out" >> "$REPORT"
  fi
  echo "" >> "$REPORT"
}

echo "" >> "$REPORT"
echo "## Layer 2 — headless harness" >> "$REPORT"
echo "" >> "$REPORT"

for trace in fly_and_settle reversal_storm dense_scrub; do
  tp="$ROOT/lab/traces/${trace}.json"
  echo "" >> "$REPORT"
  echo "## Trace: $trace" >> "$REPORT"
  echo "" >> "$REPORT"
  run_arm 0 "A baseline" "$tp" "$READ_BPS"
  run_arm 1 "B cancel" "$tp" "$READ_BPS"
done

echo "## Cold-page bench" >> "$REPORT"
echo "" >> "$REPORT"
echo '```' >> "$REPORT"
"$COLD" --study "$STUDY" >> "$REPORT" 2>&1 || cargo run -p cold-page-bench --release -- --study "$STUDY" >> "$REPORT" 2>&1 || true
echo '```' >> "$REPORT"

echo "" >> "$REPORT"
echo "## Q1 falsifier (stated in advance)" >> "$REPORT"
echo "" >> "$REPORT"
echo "> If recovered_ms < ~100 on fly_and_settle at cared-about link rates, cancel does not pay." >> "$REPORT"
echo "" >> "$REPORT"
echo "## Q2" >> "$REPORT"
echo "" >> "$REPORT"
echo "Run \`lab/scripts/netem_q2.sh\` separately with NET_ADMIN if needed." >> "$REPORT"

echo "Wrote $REPORT"
