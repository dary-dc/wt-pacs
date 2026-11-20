#!/usr/bin/env bash
# docs/adr/frame-path.md §7, *The busy page, asks on the mean*: A, its A/A copy and B′ with the start's fix on §7's busy
# page; rounds FIRST … LAST−1, each round's kinds in a rotated order; rows committed and pushed after each kind.
#
#   [KINDS="asks cine"] [THROTTLES=1,4] [CINE_THROTTLES=1] [ENGINES=chromium,firefox] [SETS=...] xvfb-run -a lab/viewer/busy_run.sh FIRST LAST [BRANCH]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}" FIREFOX_PATH="${FIREFOX_PATH:-$(ls -d /opt/pw-browsers/firefox-*/firefox/firefox 2>/dev/null | tail -1)}"
OUT=lab/viewer/rows
common=(--frames lab/.av1-work/view-fix --links r50000 --engines "${ENGINES:-chromium,firefox}" --origin navigation --rounds 1
  --sets "${SETS:-ct_nlst,us_liver,dbt12_ea1141}" --busy --variants page,pageaa,workerfix)
read -ra kinds <<<"${KINDS:-asks cine}"
for ((r = $1; r < $2; r++)); do
  for ((k = 0; k < ${#kinds[@]}; k++)); do
    kind=${kinds[(k + r) % ${#kinds[@]}]}
    case $kind in
      asks) args=(--throttles "${THROTTLES:-1,4}" --fill 0 --asks-after 10) ;;
      cine) args=(--throttles "${CINE_THROTTLES:-1}" --cine 10) ;;
    esac
    node lab/av1/delivery/total-time/run.mjs "${common[@]}" "${args[@]}" --first-round "$r" --out "$OUT/busy-$kind.jsonl" 2>&1 | grep '^round' || true
    if [[ -n "${3:-}" ]]; then
      git add "$OUT/busy-$kind.jsonl" && git commit -qm "frame-path §7: the busy page, round $r, $kind rows" -- "$OUT/busy-$kind.jsonl" && { git push -q origin "$3" || git push -q origin "$3"; }
    fi
  done
done
