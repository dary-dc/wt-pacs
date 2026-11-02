#!/usr/bin/env bash
# PROFILEBYTES as run (README.md §Profiles bytes, measured): lossless references, then the lossy rungs, then σ.
#
#   BUILD=... WORK=... lab/av1/profiles/run.sh RUNGS SET_DIR ...
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$HERE/../.venv/bin/python"
BUILD="${BUILD:-$HERE/../../.av1-build}"
WORK="${WORK:-$HERE/../../.profiles-work}"
RUNGS=$1; shift
mkdir -p "$WORK"
lossless() {
  local codec=$1 preset=$2 set=$3 out="$WORK/lossless/$(basename "$set")-$1"
  grep -q "\"$(basename "$set")\", \"$codec\"" "$WORK/lossless.jsonl" 2>/dev/null && return
  "$PY" "$HERE/../tools/ingest_coded.py" "$BUILD" "$set" "$out" --codec "$codec" --preset "$preset" --jobs 4 >&2
  "$PY" -c "import json,sys,pathlib; p=sorted(pathlib.Path(sys.argv[1]).glob('*.$codec'));
print(json.dumps([sys.argv[2], sys.argv[3], [f.stat().st_size for f in p]]))" "$out" "$(basename "$set")" "$codec" \
    >> "$WORK/lossless.jsonl"
  rm -rf "$out"
}
for s in "$@"; do lossless htj2k - "$s"; done
"$PY" "$HERE/bytes.py" "$BUILD" "$WORK" "$WORK/cells.jsonl" "$@" --rungs "$RUNGS" --jobs 4
"$PY" "$HERE/noise.py" "$WORK" "$WORK/noise.jsonl" "$@"
for s in "$@"; do lossless av1 good:6 "$s"; done
