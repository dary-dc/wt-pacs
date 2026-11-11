#!/usr/bin/env bash
# R2's order (docs/lines/proposals.md §R2, amendment 1): 7 rounds; each round every cell and series once, Cubic and
# BBR alternating, the first arm alternating between rounds; in the 1 % cell an A/A arm (Cubic again), the three
# rotated. Rounds 1, 4 and 7 open with each series' loopback jump under &fill=0 (demo-check.mjs), the saturation bar.
#
#   TIP=... DIR=... lab/proposals/r2.sh OUT [FIRST_ROUND]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
SERIES=(dbts_a1-q8-g8-cut dbts_b1-q8-g8 dbts_c1-q8-g16-cut)
LINK="--delay-ms 30 --rate-kbit 20000 --queue-pkts 1000"
declare -A CELL=([0]="$LINK" [iid1]="$LINK --loss 1" [ge]="$LINK --loss-model ge --ge-p 0.07 --ge-r 14")
export NODE_PATH=$(npm root -g)
emit() { echo "{\"protocol\":\"R2\",\"round\":$1,\"cell\":\"$2\",\"arm\":\"$3\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$4}" >>"$OUT"; }
for round in $(seq "${2:-1}" 7); do
  if ((round % 3 == 1)); then
    for id in "${SERIES[@]}"; do
      out=$(cd "$TIP" && node client/viewer/demo-check.mjs "$DIR" "$id" --json 2>&1 || true)
      emit "$round" loopback demo-check "$( (grep -m1 '^{' <<<"$out" || echo '{}') | jq -c '{id, jumpMs: (.passes // [] | map(select(.query == "&fill=0"))[0].jumpMs)}')"
    done
  fi
  for cell in 0 iid1 ge; do
    arms=(cubic-restart bbr); ((round % 2)) || arms=(bbr cubic-restart)
    if [[ $cell == iid1 ]]; then all=(cubic-restart bbr cubic-aa); k=$((round % 3)); arms=("${all[@]:k}" "${all[@]:0:k}"); fi
    for id in "${SERIES[@]}"; do
      for arm in "${arms[@]}"; do
        cc=${arm%-aa}; [[ $cc == cubic ]] && cc=cubic-restart
        row=$(node "$HERE/link_cells.mjs" "$TIP" "$DIR" "$id" --link "${CELL[$cell]}" --jump-after-ms 500 \
          --lossy-args "--congestion $cc" --exact-args "--congestion $cc")
        emit "$round" "$cell" "$arm" "$row"
      done
    done
  done
done
