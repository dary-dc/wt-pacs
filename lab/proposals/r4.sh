#!/usr/bin/env bash
# R4's order (docs/lines/proposals.md §R4, amendment 1): 7 rounds; each round cells 0 and iid1, every series and frame,
# both servers on BBR, the exact server's window default and 38 400 B alternating, the first alternating between
# rounds; in iid1 the default again (A/A), the three rotated. The relay's flows tallied over the quiet and over `l`.
#
#   TIP=... DIR=... lab/proposals/r4.sh OUT [FIRST_ROUND]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
SERIES=(dbts_a1-q8-g8-cut dbts_b1-q8-g8 dbts_c1-q8-g16-cut)
LINK="--delay-ms 30 --rate-kbit 20000 --queue-pkts 1000"
declare -A CELL=([0]="$LINK" [iid1]="$LINK --loss 1")
for round in $(seq "${2:-1}" 7); do
  for cell in 0 iid1; do
    arms=(default iw38400); ((round % 2)) || arms=(iw38400 default)
    if [[ $cell == iid1 ]]; then all=(default iw38400 default-aa); k=$((round % 3)); arms=("${all[@]:k}" "${all[@]:0:k}"); fi
    for id in "${SERIES[@]}"; do
      for frame in first middle last; do
        for arm in "${arms[@]}"; do
          ex="--congestion bbr"; [[ $arm != iw38400 ]] || ex="$ex --initial-window-bytes 38400"
          row=$(NODE_PATH=$(npm root -g) node "$HERE/link_cells.mjs" "$TIP" "$DIR" "$id" --link "${CELL[$cell]}" \
            --lossy-args "--congestion bbr" --exact-args "$ex" --frame "$frame" --windows)
          echo "{\"protocol\":\"R4\",\"round\":$round,\"cell\":\"$cell\",\"arm\":\"$arm\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$row}" >>"$OUT"
        done
      done
    done
  done
done
