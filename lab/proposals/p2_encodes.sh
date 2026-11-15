#!/usr/bin/env bash
# P2's 18 encodes (docs/lines/proposals.md §P2, amendment 1), and each bundle's bytes as a ratio of one tile's.
#   TIP=... P2_OUT=... lab/proposals/p2_encodes.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SERIES=("dbts_a1 dbts_a1-q8-g1-cut 8 1 --depth-cut" "dbts_a1 dbts_a1-q8-g8-cut 8 8 --depth-cut" "dbts_b1 dbts_b1-q8-g1 8 1"
  "dbts_b1 dbts_b1-q8-g8 8 8" "dbts_c1 dbts_c1-q8-g1-cut 8 1 --depth-cut" "dbts_c1 dbts_c1-q8-g8-cut 8 8 --depth-cut")
for s in "${SERIES[@]}"; do
  for arm in one 2x2 2x1; do
    read -r set id q g cut <<<"$s"
    [[ -f $P2_OUT/$arm/$id.sbnd ]] || "$TIP/lab/av1/.venv/bin/python" "$HERE/p2_encode.py" "$TIP" "$arm" $s
  done
  cmp -s "$P2_OUT/one/$id.sbnd" "$TIP/demo-series/$id.sbnd" || { echo "$id: one tile differs from demo-series"; exit 1; }
done
for s in "${SERIES[@]}"; do
  read -r set id _ <<<"$s"
  one=$(stat -c %s "$P2_OUT/one/$id.sbnd")
  for arm in one 2x2 2x1; do
    b=$(stat -c %s "$P2_OUT/$arm/$id.sbnd")
    awk -v id="$id" -v a="$arm" -v b="$b" -v o="$one" 'BEGIN { printf "{\"protocol\":\"P2\",\"cell\":\"bytes\",\"id\":\"%s\",\"arm\":\"%s\",\"bytes\":%d,\"ratio\":%.4f}\n", id, a, b, b / o }'
  done
done
