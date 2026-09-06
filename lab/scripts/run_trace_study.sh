#!/usr/bin/env bash
# S2 — what disk pattern do our real client ask schedules actually produce?
#
# Phase 1 characterises the pattern for every (schedule x layout x mode x device rung)
# combination; phase 2 replays a representative subset through the four read-path arms.
#
# Phase 1 needs no fixture and no arms — it is pure geometry, and it is what says which
# square of the decision surface a case lands in before any arm is measured.
#
#   lab/scripts/run_trace_study.sh [outdir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-${TRACE_OUT:-/tmp/trace_study}}"
STUDY="${STUDY:-$ROOT/lab/fixtures/frames_250k_live/frames_250k_live.sbnd}"
GEN="$ROOT/lab/scripts/gen_access_trace.py"
FRAMES="${FRAMES:-320}"
FRAME_BYTES="${FRAME_BYTES:-250000}"

mkdir -p "$OUT/traces"
[[ -f "$STUDY" ]] || { echo "missing study $STUDY — lab/scripts/gen_live_cell_fixture.sh" >&2; exit 1; }
FSZ=$(stat -c%s "$STUDY")

echo "# trace study · study=$STUDY (${FSZ} B) frames=$FRAMES frame_bytes=$FRAME_BYTES"

for sched in live_cell_scroll stripe320; do
  for layout in frame-major rung-major; do
    for mode in single progressive; do
      for rung in 1 3 5; do
        name="${sched}_${layout}_${mode}_r${rung}"
        python3 "$GEN" \
          --schedule "$ROOT/lab/traces/${sched}.json" \
          --layout "$layout" --mode "$mode" --device-rung "$rung" \
          --frames "$FRAMES" --frame-bytes "$FRAME_BYTES" \
          --base 0 --file-bytes "$FSZ" \
          --out "$OUT/traces/${name}.tsv"
      done
    done
  done
done

echo "traces written to $OUT/traces" >&2

# ---------------------------------------------------------------------------
# Phase 2 — replay a representative subset through the arms.
#
# Four cases chosen to span the characterisation, not to flatter any arm:
#   fm_r5  whole frames, frame-major      100% adjacent   (US stack)
#   fm_r3  rung prefix, frame-major         0% adjacent   (rung delivery today)
#   rm_r1  one rung, rung-major           100% adjacent   (layout grouping works)
#   rm_r3  rung prefix, rung-major          0% adjacent   (grouping backfires)
# ---------------------------------------------------------------------------
BIN="$ROOT/target/release/read_campaign"
[[ -x "$BIN" ]] || { echo "build first: cargo build -p disk-access-bench --release" >&2; exit 1; }

TSV="$OUT/v15_traces.tsv"
: > "$TSV"
first=1
for case in \
  "fm_r5:live_cell_scroll_frame-major_single_r5" \
  "fm_r3:live_cell_scroll_frame-major_single_r3" \
  "rm_r1:live_cell_scroll_rung-major_single_r1" \
  "rm_r3:live_cell_scroll_rung-major_single_r3" ; do
  tag="${case%%:*}"; file="${case#*:}"
  hdr=(); [[ $first -eq 1 ]] || hdr=(--no-header); first=0
  "$BIN" --study "$STUDY" --trace "$OUT/traces/${file}.tsv" \
    --arms pool,uring,hybrid,pooled_pread \
    --depths "${TRACE_DEPTHS:-1,8}" --readers 1 --temps cold \
    --monitors 0 --repeats "${TRACE_REPEATS:-6}" \
    --label "v15_${tag}" "${hdr[@]}" >> "$TSV"
done
echo "phase 2 results: $TSV" >&2
