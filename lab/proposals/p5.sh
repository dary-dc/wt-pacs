#!/usr/bin/env bash
# P5's pre-registered order (docs/lines/proposals.md §P5, its amendment): 9 rounds; each round both cells and the three
# series once, today's page and the dial-after copy alternating, the first arm alternating between rounds.
#
#   TIP=... DIR=... ARM=<lab/proposals/p5_arm.sh's ROOT> lab/proposals/p5.sh OUT [FIRST_ROUND]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
SERIES=(dbts_a1-q8-g8-cut dbts_b1-q8-g8 dbts_c1-q8-g16-cut)
LINK="--delay-ms 30 --rate-kbit 20000 --queue-pkts 1000"
for round in $(seq "${2:-1}" 9); do
  arms=(today after); ((round % 2)) || arms=(after today)
  for cores in 4 2; do
    pin=(); [[ $cores == 4 ]] || pin=(taskset -c 0,1)
    for id in "${SERIES[@]}"; do
      for arm in "${arms[@]}"; do
        host=$TIP; [[ $arm == today ]] || host=$ARM
        row=$(NODE_PATH=$(npm root -g) "${pin[@]}" node "$HERE/link_cells.mjs" "$TIP" "$DIR" "$id" --link "$LINK" \
          --host "$host" --cpu-throttle 4)
        echo "{\"protocol\":\"P5\",\"round\":$round,\"cores\":$cores,\"arm\":\"$arm\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$row}" >>"$OUT"
      done
    done
  done
done
