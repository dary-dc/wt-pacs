#!/usr/bin/env bash
# docs/adr/frame-path.md §7, *The pixel read under a busy page*: §7's cine cell, five arms (each view by the fence and by
# the read, and the A/A pair), rounds FIRST … LAST−1; rows committed and pushed after each round.
#
#   [THROTTLES=1] [SETS=ct_nlst,us_liver,dbt12_ea1141] xvfb-run -a lab/viewer/settle_run.sh FIRST LAST [BRANCH]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}" FIREFOX_PATH="${FIREFOX_PATH:-$(ls -d /opt/pw-browsers/firefox-*/firefox/firefox | tail -1)}"
OUT=lab/viewer/rows/settle-cine.jsonl
for ((r = $1; r < $2; r++)); do
  node lab/av1/delivery/total-time/run.mjs --frames lab/.av1-work/view --links r50000 --throttles "${THROTTLES:-1}" \
    --engines chromium,firefox --origin navigation --rounds 1 --first-round "$r" --sets "${SETS:-ct_nlst,us_liver,dbt12_ea1141}" \
    --busy --cine 10 --variants page,pageaa,worker,page-read,worker-read --out "$OUT" 2>&1 | grep '^round' || true
  if [[ -n "${3:-}" ]]; then
    git add "$OUT" && git commit -qm "frame-path §7: the settle's cine, round $r" -- "$OUT" && { git push -q origin "$3" || git push -q origin "$3"; }
  fi
done
