#!/usr/bin/env bash
# P4's pre-registered order (docs/lines/proposals.md §P4, its amendment): 7 rounds; each round every cell, series and
# frame once, the two exact-server arms alternating, the first arm alternating between rounds. One JSON row per run.
#
#   TIP=... DIR=... lab/proposals/p4.sh OUT [FIRST_ROUND]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
SERIES=(dbts_a1-q8-g8-cut dbts_b1-q8-g8 dbts_c1-q8-g16-cut)
LINK="--delay-ms 30 --rate-kbit 20000"
declare -A CELL=([0]="$LINK --queue-pkts 1000" [iid1]="$LINK --queue-pkts 1000 --loss 1"
  [ge]="$LINK --queue-pkts 1000 --loss-model ge --ge-p 0.07 --ge-r 14" [q20]="$LINK --queue-pkts 20")
for round in $(seq "${2:-1}" 7); do
  arms=(default iw38400); ((round % 2)) || arms=(iw38400 default)
  for cell in 0 iid1 ge q20; do
    for id in "${SERIES[@]}"; do
      for frame in first middle last; do
        for arm in "${arms[@]}"; do
          ex=""; [[ $arm == default ]] || ex="--initial-window-bytes 38400"
          row=$(NODE_PATH=$(npm root -g) node "$HERE/link_cells.mjs" "$TIP" "$DIR" "$id" --link "${CELL[$cell]}" \
            --exact-args "$ex" --frame "$frame")
          echo "{\"protocol\":\"P4\",\"round\":$round,\"cell\":\"$cell\",\"arm\":\"$arm\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$row}" >>"$OUT"
        done
      done
    done
  done
done
