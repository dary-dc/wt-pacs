#!/usr/bin/env bash
# P1's pre-registered order (docs/lines/proposals.md §P1, its amendment): 5 rounds; each round every cell and series
# once, Cubic and BBR alternating, the first arm alternating between rounds. One JSON row per run onto OUT.
#
#   TIP=... DIR=... lab/proposals/p1.sh OUT [FIRST_ROUND]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
SERIES=(dbts_a1-q8-g8-cut dbts_b1-q8-g8 dbts_c1-q8-g16-cut)
LINK="--delay-ms 30 --rate-kbit 20000 --queue-pkts 1000"
declare -A CELL=([0]="$LINK" [iid1]="$LINK --loss 1" [ge]="$LINK --loss-model ge --ge-p 0.07 --ge-r 14")
for round in $(seq "${2:-1}" 5); do
  arms=(cubic-restart bbr); ((round % 2)) || arms=(bbr cubic-restart)
  for cell in 0 iid1 ge; do
    for id in "${SERIES[@]}"; do
      for cc in "${arms[@]}"; do
        row=$(NODE_PATH=$(npm root -g) node "$HERE/link_cells.mjs" "$TIP" "$DIR" "$id" --link "${CELL[$cell]}" \
          --lossy-args "--congestion $cc" --exact-args "--congestion $cc")
        echo "{\"protocol\":\"P1\",\"round\":$round,\"cell\":\"$cell\",\"arm\":\"$cc\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$row}" >>"$OUT"
      done
    done
  done
done
