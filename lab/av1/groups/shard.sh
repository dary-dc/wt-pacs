#!/usr/bin/env bash
# One shard of the groups protocol (docs/av1/groups.md §Shards): shard 1's pilot and checks first, then every cell of
# the shard's series, then the decode timing with nothing else running; everything lands in rows/groups-K.*.
#
#   [BUILD=...] [DATA=...] [WORK=...] [VDP_PY=...] [HOURS=4.4] lab/av1/groups/shard.sh K
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$HERE/../.venv/bin/python"
BUILD="${BUILD:-$HERE/../../.av1-build}"
DATA="${DATA:-$HERE/../data}"
WORK="${WORK:-$HERE/../../.av1-work/groups}"
VDP_PY="${VDP_PY:-$HERE/../metrics/.venv/bin/python}"
K=$1
export LD_LIBRARY_PATH="$BUILD/dav1d/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"  # the pinned libdav1d, not the system one
ROWS="$HERE/rows"
SETS=$("$PY" -c "import sys; sys.path.insert(0, sys.argv[1]); import plan; print(' '.join(s for s in plan.SHARDS[sys.argv[2]] if s != plan.PILOT))" "$HERE" "$K")
mkdir -p "$WORK" "$ROWS"
if [[ $K == 1 ]]; then
  "$PY" "$HERE/cell.py" "$BUILD" "$WORK/pilot" "$ROWS/groups-pilot.jsonl" "$DATA/dbt12_ea1141" --vdp "$VDP_PY"
  [[ -f "$ROWS/groups-1.checks.json" ]] || "$PY" "$HERE/checks.py" "$BUILD" "$WORK/pilot" "$ROWS/groups-pilot.jsonl" \
    "$DATA/dbt12_ea1141" "$ROWS/groups-1.checks.json"
  "$PY" "$HERE/plan.py" "$ROWS/groups-pilot.jsonl"
fi
# shellcheck disable=SC2086
"$PY" "$HERE/cell.py" "$BUILD" "$WORK" "$ROWS/groups-$K.jsonl" $(printf "$DATA/%s " $SETS) --vdp "$VDP_PY" --index "$K"
# shellcheck disable=SC2086
"$PY" "$HERE/streams.py" "$BUILD" "$WORK" "$ROWS/groups-$K.jsonl" $SETS
source "$HERE/../../.av1-work/decode-env.sh"
node "$HERE/decode.mjs" --work "$WORK" --sets "$(tr ' ' , <<< "$SETS")" --hours "${HOURS:-4.4}" --out "$ROWS/groups-$K.decode.json"
