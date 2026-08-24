#!/usr/bin/env bash
# Frames + bytes on wire per trace profile and harness arm. Writes WIRE_BY_PROFILE.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/.local/measurements/WIRE_BY_PROFILE.md"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
READ_BPS="${READ_BPS:-10000000}"
CERT="$ROOT/server/dev-cert/cert.pem"
KEY="$ROOT/server/dev-cert/key.pem"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

mkdir -p "$(dirname "$OUT")"
cargo build -p queue-sim -p queue-harness -p exact-server --release >/dev/null

SIM="$CARGO_TARGET_DIR/release/queue-sim"
HARNESS="$CARGO_TARGET_DIR/release/queue-harness"
SERVER="$CARGO_TARGET_DIR/release/exact-server"

[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"

{
  echo "# Frames and bytes on the wire"
  echo ""
  echo "Generated: $(date -Iseconds)"
  echo ""
  echo "**bytes_on_wire** = envelope payloads read (4-byte index + codestream). One uni stream per frame."
  echo ""
  echo "Harness: study=\`$STUDY\`, read pace=${READ_BPS} bps (~$((READ_BPS/1000000)) Mbps)."
  echo ""
  echo "---"
  echo ""
  echo "## Layer 1 simulation (fly_and_settle, mean ~51 KB/frame)"
  echo ""
  echo "Until the wanted frame is delivered. **Arm A** = cancel off, **Arm B** = cancel on."
  echo ""
  echo '```tsv'
} > "$OUT"

"$SIM" --study "$STUDY" --mbps 1,5,10,18,19,50,100 --wire 2>/dev/null | tail -n +2 >> "$OUT"

echo '```' >> "$OUT"
echo "" >> "$OUT"
echo "## Layer 2 harness (real WebTransport)" >> "$OUT"
echo "" >> "$OUT"
echo '```json' >> "$OUT"

run_h() {
  local cancel=$1 label=$2 trace=$3
  "$SERVER" --port 4433 --study "$STUDY" \
    --cert-pem "$CERT" --key-pem "$KEY" >/dev/null 2>&1 &
  local sp=$!
  sleep 1.2
  local extra=()
  [[ "$cancel" == "1" ]] && extra+=(--server-cancel)
  "$HARNESS" --url "https://127.0.0.1:4433/" --trace "$trace" \
    --read-bps "$READ_BPS" "${extra[@]}" --json 2>/dev/null | \
    python3 -c "import json,sys; d=json.load(sys.stdin); d['arm']='$label'; print(json.dumps(d))"
  kill "$sp" 2>/dev/null; wait "$sp" 2>/dev/null || true
  sleep 0.4
}

for trace in fly_and_settle reversal_storm dense_scrub; do
  tp="$ROOT/lab/traces/${trace}.json"
  run_h 0 "A_baseline" "$tp"
  run_h 1 "B_cancel" "$tp"
done >> "$OUT"

echo '```' >> "$OUT"
echo "" >> "$OUT"
echo "## How to read it" >> "$OUT"
echo "" >> "$OUT"
echo "- **frames_before_settle**: media streams completed while the reader was still in the fly phase." >> "$OUT"
echo "- **frames_after_settle**: streams after cancel/settle (includes 1 wanted + any wasted)." >> "$OUT"
echo "- Arm B should show **fewer frames/bytes after settle** when cancel pays." >> "$OUT"
echo "" >> "$OUT"
echo "Wrote $OUT"
cat "$OUT"
