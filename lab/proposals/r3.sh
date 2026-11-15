#!/usr/bin/env bash
# R3's plumbing cell (docs/lines/proposals.md §R3, amendment 1): 7 rounds; each round dbts_a1 and dbts_c1, the variants
# off, on100 and off again (A/A) on each, rotated one place a round; P3's link and promotion model.
#
#   TIP=... DIR=... ARM=<lab/proposals/r3_arm.sh's ROOT> lab/proposals/r3.sh OUT [FIRST_ROUND]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
SERIES=(dbts_a1-q8-g8-cut dbts_c1-q8-g16-cut)
LINK="--delay-ms 30 --rate-kbit 20000 --queue-pkts 1000 --idle-promote 5:300"
VARIANTS=(off on100 off-aa)
for round in $(seq "${2:-1}" 7); do
  for id in "${SERIES[@]}"; do
    for k in 0 1 2; do
      v=${VARIANTS[$(((k + round - 1) % 3))]}
      host=$TIP lead=0
      [[ $v != on* ]] || host=$ARM lead=${v#on}
      row=$(NODE_PATH=$(npm root -g) node "$HERE/link_cells.mjs" "$TIP" "$DIR" "$id" --link "$LINK" --exact-only \
        --host "$host" --lead-ms "$lead")
      echo "{\"protocol\":\"R3\",\"round\":$round,\"variant\":\"$v\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$row}" >>"$OUT"
    done
  done
done
