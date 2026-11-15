#!/usr/bin/env bash
# R1's jump cell (docs/lines/proposals.md §R1, amendment 1): demo-check.mjs on the demo tip, dbts_c1-q8-g16-cut, arms
# one, 2x2 and A/A (one again), rotated per round; per round the 4-core block, then taskset -c 0,1; each block's
# navigator.hardwareConcurrency read by a separate browser under the same pin.
#   TIP=... R1_OUT=... lab/proposals/r1.sh OUT FIRST_ROUND LAST_ROUND
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
ID=dbts_c1-q8-g16-cut
ARMS=(one 2x2 aa)
export NODE_PATH=$(npm root -g)
for round in $(seq "$2" "$3"); do
  k=$((round % 3)); arms=("${ARMS[@]:k}" "${ARMS[@]:0:k}")
  for cores in 4 2; do
    pin=(); [[ $cores == 4 ]] || pin=(taskset -c 0,1)
    hc=$("${pin[@]}" node -e 'require("playwright").chromium.launch().then(async b => { const p = await b.newPage(); console.log(await p.evaluate(() => navigator.hardwareConcurrency)); await b.close(); })')
    for arm in "${arms[@]}"; do
      d=$R1_OUT/jump-${arm/aa/one}
      out=$(cd "$TIP" && "${pin[@]}" node client/viewer/demo-check.mjs "$d" "$ID" --json 2>&1 || true)
      row=$( (grep -m1 '^{' <<<"$out" || echo '{}') | jq -c --arg c "$(grep -v '^{' <<<"$out")" '. + {checks: $c}')
      echo "{\"protocol\":\"R1\",\"cell\":\"jump\",\"round\":$round,\"cores\":$cores,\"hardwareConcurrency\":$hc,\"id\":\"$ID\",\"arm\":\"$arm\",\"at\":\"$(date -u +%FT%TZ)\",\"run\":$row}" >>"$OUT"
    done
  done
done
