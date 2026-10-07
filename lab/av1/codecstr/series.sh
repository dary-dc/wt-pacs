#!/usr/bin/env bash
# The first frames of every series under DATA as items, in each layout the client could be served: plain and
# optimized, and over 12 bits a 10-bit top (k = b − 10) beside the default — what check.mjs and the
# browsers read. Queue row 67; README.md
#
#   lab/av1/codecstr/series.sh BUILD DATA OUT [FRAMES]     FRAMES default 2
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
P="$HERE/../.venv/bin/python"
BUILD=$1 DATA=$2 OUT=$3 FRAMES=${4:-2}
for set in "$DATA"/*/; do
  name="$(basename "$set")"
  [[ -f "$set/metadata.json" ]] || continue
  bits="$("$P" -c 'import json,sys; m=json.load(open(sys.argv[1])); print(0 if m["channels"] == 3 else (m["max"] - min(m["min"], 0)).bit_length())' "$set/metadata.json")"
  args=()
  (( bits > 14 )) && args=(--split $((bits - 12)))
  for rep in plain optimized; do
    "$P" "$HERE/../item/ingest.py" "$BUILD" "$set" "$OUT/$name/$rep" --representation "$rep" --frames "$FRAMES" \
      --preset allintra:7 "${args[@]}" | tail -1
  done
  if (( bits > 12 )); then
    "$P" "$HERE/../item/ingest.py" "$BUILD" "$set" "$OUT/$name/top10" --split $((bits - 10)) --frames "$FRAMES" \
      --preset allintra:7 | tail -1
  fi
done
