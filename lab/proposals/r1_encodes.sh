#!/usr/bin/env bash
# R1's 14 encodes (docs/lines/proposals.md §R1, amendment 1) on the integrity build; the one-tile arm checked equal to
# the demo tip's bundles; then each arm's jump-cell directory, the metadata the demo tip reads, the exact series linked.
#   INTEG=... TIP=... QUALITY=... R1_OUT=... lab/proposals/r1_encodes.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SERIES=("dbts_a1 dbts_a1-q8-g1-cut 8 1 --depth-cut" "dbts_a1 dbts_a1-q8-g8-cut 8 8 --depth-cut" "dbts_b1 dbts_b1-q8-g1 8 1"
  "dbts_b1 dbts_b1-q8-g8 8 8" "dbts_c1 dbts_c1-q8-g1-cut 8 1 --depth-cut" "dbts_c1 dbts_c1-q8-g8-cut 8 8 --depth-cut"
  "dbts_c1 dbts_c1-q8-g16-cut 8 16 --depth-cut")
for s in "${SERIES[@]}"; do
  read -r set id _ <<<"$s"
  for arm in one 2x2; do
    [[ -f $R1_OUT/$arm/$id.sbnd ]] || "$INTEG/lab/av1/.venv/bin/python" "$HERE/r1_encode.py" "$INTEG" "$arm" $s
    # A bundle carries its metadata: the jump cell's is packed with the demo tip's form, the integrity keys removed.
    mkdir -p "$R1_OUT/jump-$arm"
    python3 -c 'import json, sys; m = json.load(open(sys.argv[1])); [m["lossy"].pop(k) for k in ("reconstruction", "codingError")]
open(sys.argv[2], "w").write(json.dumps(m, indent=1) + "\n")' "$R1_OUT/$arm/$id.metadata.json" "$R1_OUT/jump-$arm/$id.metadata.json"
    "$TIP/target/release/pack-series" --metadata "$R1_OUT/jump-$arm/$id.metadata.json" --frames "$R1_OUT/$arm/$id" \
      --output "$R1_OUT/jump-$arm/$id.sbnd" >/dev/null
  done
  cmp -s "$R1_OUT/jump-one/$id.sbnd" "$TIP/demo-series/$id.sbnd" || { echo "$id: one tile differs from the demo tip's"; exit 1; }
done
for arm in one 2x2; do
  ln -sf "$TIP"/demo-series/dbts_?1.{sbnd,metadata.json} "$R1_OUT/jump-$arm/"
  ln -sf "$TIP"/demo-series/dbts_?1.{sbnd,metadata.json} "$R1_OUT/$arm/"
done
for s in "${SERIES[@]}"; do
  read -r _ id _ <<<"$s"
  one=$(stat -c %s "$R1_OUT/jump-one/$id.sbnd")
  b=$(stat -c %s "$R1_OUT/jump-2x2/$id.sbnd")
  echo "{\"protocol\":\"R1\",\"cell\":\"bytes\",\"id\":\"$id\",\"one\":$one,\"2x2\":$b,\"ratio\":$(awk -v b="$b" -v o="$one" 'BEGIN{printf "%.4f", b/o}')}"
done
