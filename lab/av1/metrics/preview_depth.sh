#!/usr/bin/env bash
# Row PREVIEWDEPTH (preview-depth.md §9): the checks, then every series of §3 in the order below; it writes only
# rows/preview-depth.* and skips every row already written.
#
#   [BUILD=...] [DATA=...] [WORK=...] [VMAF=...] lab/av1/metrics/preview_depth.sh [--q 2,8,16,32]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$HERE/../.venv/bin/python"
BUILD="${BUILD:-$HERE/../../.av1-build}"
DATA="${DATA:-$HERE/../data}"
WORK="${WORK:-$HERE/../../.av1-work/preview-depth}"
VMAF="${VMAF:-$BUILD/vmaf/libvmaf/build/tools/vmaf}"
OUT="$HERE/rows/preview-depth"
SETS=(dbt12_ea1141 dbt10_ea1141 rf_fluoro mr_ispy1
      dbts_a3 dbts_b5 dbts_c2 dbts_a1 dbts_b3 dbts_c4 dbts_a5 dbts_b2 dbts_c5
      dbts_a4 dbts_b4 dbts_c1 dbts_a2 dbts_b1 dbts_c3 dbt12_c dbt10_d)
[[ -x "$VMAF" ]] || { echo "no vmaf at $VMAF: the banding columns are not run" >&2; VMAF=; }
mkdir -p "$WORK" "$HERE/rows"
[[ -f "$OUT.checks.json" ]] || "$PY" "$HERE/preview_depth_checks.py" "$OUT.checks.json" ${VMAF:+--vmaf "$VMAF"} \
    --work "$WORK/checks"
"$PY" "$HERE/preview_depth.py" "$BUILD" "$WORK" "$OUT.jsonl" "${SETS[@]/#/$DATA/}" ${VMAF:+--vmaf "$VMAF"} --jobs 4 "$@"
