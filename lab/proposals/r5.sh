#!/usr/bin/env bash
# R5's pre-registered order (docs/lines/proposals.md §R5, amendment 1): ROUTE `taken` or `refused`, 9 rounds; each
# round every series, link and static host once, the four arms (today, lazy, probe and today again as the A/A arm)
# rotated one place a round. ROUTE `failed`: today, lazy and probe on each series' forced mid-group failure, clean
# link, dev host, 3 rounds. ROOTS holds r5_arm.sh's roots: lazy, probe, and today-ID, lazy-ID, probe-ID for `failed`.
#
#   TIP=... DIR=... ROOTS=... [LAST=9] lab/proposals/r5.sh ROUTE OUT [FIRST_ROUND]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROUTE=$1 OUT=$2
SERIES=(dbts_a1-q8-g8-cut dbts_b1-q8-g8 dbts_c1-q8-g16-cut)
BASE="--delay-ms 30 --rate-kbit 20000 --queue-pkts 1000"
cell() {  # ROUND ARM ROOT ID LINK STATIC [driver options]
  local round=$1 arm=$2 root=$3 id=$4 link=$5 static=$6 row
  shift 6
  row=$(NODE_PATH=$(npm root -g) node "$HERE/r5_cells.mjs" "$TIP" "$DIR" "$id" --root "$root" --static "$static" \
    --link "$BASE $link" "$@")
  echo "{\"protocol\":\"R5\",\"route\":\"$ROUTE\",\"round\":$round,\"arm\":\"$arm\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$row}" >>"$OUT"
}
if [[ $ROUTE == failed ]]; then
  for round in $(seq "${3:-1}" 3); do
    arms=(today lazy probe); arms=("${arms[@]:$(((round - 1) % 3))}" "${arms[@]:0:$(((round - 1) % 3))}")
    for id in "${SERIES[@]}"; do
      for arm in "${arms[@]}"; do cell "$round" "$arm" "$ROOTS/$arm-$id" "$id" "" dev --frames; done
    done
  done
  exit 0
fi
flag=(); [[ $ROUTE == refused ]] && flag=(--refuse)
for round in $(seq "${3:-1}" "${LAST:-9}"); do
  arms=(today lazy probe aa); k=$(((round - 1) % 4)); arms=("${arms[@]:$k}" "${arms[@]:0:$k}")
  for static in dev nginx; do
    for link in "" "--loss 1"; do
      for id in "${SERIES[@]}"; do
        for arm in "${arms[@]}"; do
          root=$TIP; [[ $arm == lazy || $arm == probe ]] && root=$ROOTS/$arm
          cell "$round" "$arm" "$root" "$id" "$link" "$static" "${flag[@]}"
        done
      done
    done
  done
done
