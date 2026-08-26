#!/usr/bin/env bash
# Frames + bytes on wire per trace (exact-server + harness). Writes WIRE_BY_PROFILE.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/.local/measurements/WIRE_BY_PROFILE.md"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
READ_BPS="${READ_BPS:-10000000}"
DEPTH="${DEPTH:-4}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

mkdir -p "$(dirname "$OUT")"
cargo build -p window-harness -p exact-server --release >/dev/null

HARNESS="$CARGO_TARGET_DIR/release/window-harness"
SERVER="$CARGO_TARGET_DIR/release/exact-server"
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"

{
  echo "# Frames and bytes on the wire"
  echo ""
  echo "Generated: $(date -Iseconds)"
  echo ""
  echo "Harness: study=\`$STUDY\`, read pace=${READ_BPS} bps, depth=$DEPTH."
  echo ""
  echo '```json'
} > "$OUT"

run_h() {
  local trace=$1
  "$SERVER" --port 4433 --study "$STUDY" \
    --cert-pem "$CERT" --key-pem "$KEY" >/dev/null 2>&1 &
  local sp=$!
  sleep 1.2
  "$HARNESS" --url "https://127.0.0.1:4433/" --trace "$trace" \
    --read-bps "$READ_BPS" --depth "$DEPTH" --frame-count 20 --json 2>/dev/null || true
  kill "$sp" 2>/dev/null; wait "$sp" 2>/dev/null || true
  sleep 0.4
}

for t in fly_and_settle_window fly_and_settle reversal_storm dense_scrub; do
  tp="$ROOT/lab/traces/${t}.json"
  [[ -f "$tp" ]] || continue
  run_h "$tp" >> "$OUT"
done

echo '```' >> "$OUT"
echo "Wrote $OUT" >&2
