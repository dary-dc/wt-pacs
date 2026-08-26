#!/usr/bin/env bash
# Layer-2 harness + cold-page bench. No commits.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.local/measurements"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
READ_BPS="${READ_BPS:-2000000}"
DEPTH="${DEPTH:-4}"

mkdir -p "$OUT"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

if [[ ! -f "$CERT" ]]; then
  "$ROOT/server/scripts/gen_dev_cert.sh"
fi

cargo build -p exact-server -p window-harness -p cold-page-bench --release >/dev/null
HARNESS="$CARGO_TARGET_DIR/release/window-harness"
SERVER="$CARGO_TARGET_DIR/release/exact-server"
COLD="$CARGO_TARGET_DIR/release/cold-page-bench"

REPORT="$OUT/RESULTS.md"
{
  echo "# Lab measurements"
  echo ""
  echo "Generated: $(date -Iseconds)"
  echo ""
  echo "## Headless harness (exact-server, depth=$DEPTH)"
  echo ""
} > "$REPORT"

run_trace() {
  local trace_path=$1
  local read_bps=$2
  echo "=== trace=$(basename "$trace_path") ==="
  "$SERVER" \
    --port 4433 --study "$STUDY" \
    --cert-pem "$CERT" --key-pem "$KEY" &
  local spid=$!
  sleep 1.5
  set +e
  local out
  out=$("$HARNESS" \
    --url "https://127.0.0.1:4433/" \
    --trace "$trace_path" \
    --read-bps "$read_bps" \
    --depth "$DEPTH" \
    --frame-count 20 \
    --json 2>&1)
  local rc=$?
  set -e
  kill "$spid" 2>/dev/null || true
  wait "$spid" 2>/dev/null || true
  sleep 0.5

  echo "### $(basename "$trace_path") (read_bps=$read_bps, depth=$DEPTH)" >> "$REPORT"
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

for trace in fly_and_settle_window fly_and_settle reversal_storm dense_scrub; do
  tp="$ROOT/lab/traces/${trace}.json"
  [[ -f "$tp" ]] || continue
  echo "" >> "$REPORT"
  echo "## Trace: $trace" >> "$REPORT"
  echo "" >> "$REPORT"
  run_trace "$tp" "$READ_BPS"
done

echo "## Cold-page bench" >> "$REPORT"
echo "" >> "$REPORT"
echo '```' >> "$REPORT"
"$COLD" --study "$STUDY" >> "$REPORT" 2>&1 || cargo run -p cold-page-bench --release -- --study "$STUDY" >> "$REPORT" 2>&1 || true
echo '```' >> "$REPORT"

echo "Wrote $REPORT"
