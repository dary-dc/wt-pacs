#!/usr/bin/env bash
# P2's order (docs/lines/proposals.md §P2, amendment 1): per round the decode cell then the page cell, each on 4 cores
# and under taskset -c 0,1, the two alternating per round; the series in turn, the three arms on each, rotated per round.
#
#   TIP=... P2_OUT=... lab/proposals/p2.sh OUT FIRST_ROUND LAST_ROUND     P2_OUT/ARM holds each arm's series and the exact ones
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
SERIES=(dbts_a1-q8-g1-cut dbts_a1-q8-g8-cut dbts_b1-q8-g1 dbts_b1-q8-g8 dbts_c1-q8-g1-cut dbts_c1-q8-g8-cut)
ARMS=(one 2x2 2x1)
export NODE_PATH=$(npm root -g)
emit() { echo "{\"protocol\":\"P2\",\"round\":$1,\"cell\":\"$2\",\"cores\":$3,\"id\":\"$4\",\"arm\":\"$5\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$6}" >>"$OUT"; }
for round in $(seq "$2" "$3"); do
  k=$((round % 3)); arms=("${ARMS[@]:k}" "${ARMS[@]:0:k}")
  sets=(4 2); ((round % 2)) || sets=(2 4)
  for cell in decode page; do
    for cores in "${sets[@]}"; do
      pin=(); [[ $cores == 4 ]] || pin=(taskset -c 0,1)
      for id in "${SERIES[@]}"; do
        [[ $cell == decode || $id == *-g8* ]] || continue
        for arm in "${arms[@]}"; do
          d=$P2_OUT/$arm
          if [[ $cell == decode ]]; then
            row=$("${pin[@]}" node "$HERE/p2_decode.mjs" "$TIP" "$d/$id" "$d/$id.metadata.json")
          else
            out=$(cd "$TIP" && "${pin[@]}" node client/viewer/demo-check.mjs "$d" "$id" --json 2>&1 || true)
            row=$( (grep -m1 '^{' <<<"$out" || echo '{}') | jq -c --arg c "$(grep -v '^{' <<<"$out")" '. + {checks: $c}')
          fi
          emit "$round" "$cell" "$cores" "$id" "$arm" "$row"
        done
      done
    done
  done
done
