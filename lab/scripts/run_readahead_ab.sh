#!/usr/bin/env bash
# Is the trace result a property of the workload, or of this host's read-ahead tuning?
#
# The lab host reports `read_ahead_kb = 8192` — an **8 MiB** window, 64x Linux's 128 KiB
# default. A window that large swallows whole access patterns: a 4.5 MB rung region is
# covered by one window, so its miss rate collapses to near zero regardless of the order the
# reads arrive in. That was found by a shuffle control, which produced the same 0.7% miss as
# the sequential order — impossible if read-ahead were merely following a stream.
#
# Any conclusion of the form "this layout makes reads nearly free" is therefore suspect until
# it is shown at a normal window. This sets the window explicitly and runs the same cells at
# both, so the host's tuning becomes a measured variable instead of a hidden one.
#
#   sudo lab/scripts/run_readahead_ab.sh <trace-dir> [outdir]
#
# Requires root (writes /sys/block/<dev>/queue/read_ahead_kb) and restores the original value
# on exit, including on failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TRACES="${1:?usage: run_readahead_ab.sh <trace-dir> [outdir]}"
OUT="${2:-$TRACES/..}"
STUDY="${STUDY:-$ROOT/lab/fixtures/frames_250k_live/frames_250k_live.sbnd}"
BIN="$ROOT/target/release/read_campaign"
REPEATS="${REPEATS:-12}"
DEPTHS="${DEPTHS:-1,8}"

[[ -x "$BIN" ]] || { echo "build first: cargo build -p disk-access-bench --release" >&2; exit 1; }

# The queue knob for the device the study lives on.
DEV="$(df --output=source "$STUDY" | tail -1)"          # e.g. /dev/vda
KNOB="/sys/block/$(basename "$DEV")/queue/read_ahead_kb"
[[ -w "$KNOB" ]] || { echo "cannot write $KNOB (need root)" >&2; exit 1; }

ORIG="$(cat "$KNOB")"
restore() { echo "$ORIG" > "$KNOB" 2>/dev/null || true; echo "restored read_ahead_kb=$ORIG" >&2; }
trap restore EXIT

TSV="$OUT/v17_readahead_ab.tsv"
: > "$TSV"
first=1
for ra in ${RA_LIST:-128 8192}; do
  echo "$ra" > "$KNOB"
  echo "==> read_ahead_kb=$(cat "$KNOB")" >&2
  for case in \
    "fm_r5:live_cell_scroll_frame-major_single_r5" \
    "fm_r3:live_cell_scroll_frame-major_single_r3" \
    "rm_r1:live_cell_scroll_rung-major_single_r1" \
    "rm_r3:live_cell_scroll_rung-major_single_r3" ; do
    tag="${case%%:*}"; file="${case#*:}"
    hdr=(); [[ $first -eq 1 ]] || hdr=(--no-header); first=0
    "$BIN" --study "$STUDY" --trace "$TRACES/${file}.tsv" \
      --arms pool,uring,hybrid --depths "$DEPTHS" --readers 1 --temps cold \
      --monitors 0 --repeats "$REPEATS" \
      --label "v17_ra${ra}_${tag}" "${hdr[@]}" >> "$TSV"
    echo "  done ra=$ra $tag" >&2
  done
done
echo "results: $TSV" >&2
