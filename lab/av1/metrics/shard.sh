#!/usr/bin/env bash
# One shard of row METRICS (README.md §Shards): the checks on its smallest series, the lossless controls, then every
# cell of its series; everything it writes lands in rows/shard-K.*.
#
#   [BUILD=...] [DATA=...] [WORK=...] [VDP_PY=...] lab/av1/metrics/shard.sh K     (README.md §Shards, Running one)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$HERE/../.venv/bin/python"
BUILD="${BUILD:-$HERE/../../.av1-build}"
DATA="${DATA:-$HERE/../data}"
WORK="${WORK:-$HERE/../../.av1-work/metrics}"
VDP_PY="${VDP_PY:-$HERE/.venv/bin/python}"
K=$1
OUT="$HERE/rows/shard-$K"
mkdir -p "$WORK" "$HERE/rows"
read -r -a SETS <<< "$("$PY" -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))['shards'][sys.argv[2]]['sets']))" "$HERE/plan.json" "$K")"
LADDER=$("$PY" -c "import json,sys; print(','.join(map(str, json.load(open(sys.argv[1]))['ladder'])))" "$HERE/plan.json")
G_LIST=$("$PY" -c "import json,sys; print(','.join(map(str, json.load(open(sys.argv[1]))['groups'])))" "$HERE/plan.json")

GREY=$(printf '%s\n' "${SETS[@]}" | grep -v -e usb_cine_rgb -e us_liver | tail -1)
[[ -f "$OUT.checks.json" ]] || "$PY" "$HERE/checks.py" "$BUILD" "$WORK/checks" "$DATA/$GREY" "$OUT.checks.json" --vdp "$VDP_PY"

control() {
  local codec=$1 preset=$2 set=$3 dir="$WORK/control/$set-$1"
  grep -q "\"kind\": \"control\", \"set\": \"$set\", \"codec\": \"$codec\"" "$OUT.jsonl" 2>/dev/null && return
  local t0; t0=$(date +%s.%N)
  "$PY" "$HERE/../tools/ingest_coded.py" "$BUILD" "$DATA/$set" "$dir" --codec "$codec" --preset "$preset" --jobs 4 >&2
  "$PY" -c "import json,sys,pathlib,time; p=sorted(pathlib.Path(sys.argv[1]).glob('*.' + sys.argv[3]));
print(json.dumps(dict(kind='control', set=sys.argv[2], codec=sys.argv[3], bytes=[f.stat().st_size for f in p], wall=time.time() - float(sys.argv[4]))))" \
    "$dir" "$set" "$codec" "$t0" >> "$OUT.jsonl"
  rm -rf "$dir"
}
for s in "${SETS[@]}"; do control htj2k - "$s"; control av1 good:6 "$s"; done
"$PY" "$HERE/cell.py" "$BUILD" "$WORK" "$OUT.jsonl" "${SETS[@]/#/$DATA/}" --q "$LADDER" --g "$G_LIST" --vdp "$VDP_PY" --jobs 4
