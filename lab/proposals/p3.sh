#!/usr/bin/env bash
# P3's pre-registered order (docs/lines/proposals.md §P3, its amendment): 7 rounds; each round the three series, the
# five variants on each, rotated one place each round.
#
#   TIP=... DIR=... ARM=<lab/proposals/p3_arm.sh's ROOT> lab/proposals/p3.sh OUT [FIRST_ROUND]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
SERIES=(dbts_a1-q8-g8-cut dbts_b1-q8-g8 dbts_c1-q8-g16-cut)
LINK="--delay-ms 30 --rate-kbit 20000 --queue-pkts 1000"
VARIANTS=(unpromoted off on0 on50 on100)
for round in $(seq "${2:-1}" 7); do
  for id in "${SERIES[@]}"; do
    for k in 0 1 2 3 4; do
      v=${VARIANTS[$(((k + round - 1) % 5))]}
      host=$TIP link=$LINK lead=0
      [[ $v == unpromoted ]] || link="$LINK --idle-promote 5:300"
      [[ $v != on* ]] || host=$ARM lead=${v#on}
      row=$(NODE_PATH=$(npm root -g) node "$HERE/link_cells.mjs" "$TIP" "$DIR" "$id" --link "$link" --exact-only \
        --host "$host" --lead-ms "$lead")
      echo "{\"protocol\":\"P3\",\"round\":$round,\"variant\":\"$v\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$row}" >>"$OUT"
    done
  done
done
