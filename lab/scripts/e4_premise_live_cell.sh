#!/usr/bin/env bash
# E4 premise gate in the primary live cell (§0b): 250 KB @ 10 Mbps, ratio ~1.8.
# Wrapper only — does not modify e4_premise_check.sh (E1 agent may be editing scripts).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export STUDY="${STUDY:-$ROOT/lab/fixtures/frames_250k_live/frames_250k_live.sbnd}"
export TRACE="${TRACE:-$ROOT/lab/traces/live_cell_scroll.json}"
export READ_BPS="${READ_BPS:-10000000}"
export FRAME_BYTES="${FRAME_BYTES:-250000}"
export FRAME_COUNT="${FRAME_COUNT:-320}"
export RTTS_MS="${RTTS_MS:-0,20,60,150}"
export OUT_DIR="${OUT_DIR:-$ROOT/.local/measurements}"
export SUMMARY="${SUMMARY:-$OUT_DIR/E4_PREMISE_LIVE_CELL_SUMMARY.md}"

# demand/supply ratio for the report header
python3 -c "
bps=int('$READ_BPS'); fb=int('$FRAME_BYTES'); tf=fb*8/bps
supply=1/tf; demand=9; ratio=demand/supply
print(f'live cell: demand/supply={ratio:.2f} (reader 9 f/s, link {supply:.1f} f/s)', flush=True)
"

exec "$ROOT/lab/scripts/e4_premise_check.sh"
