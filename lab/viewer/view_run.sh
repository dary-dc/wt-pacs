#!/usr/bin/env bash
# docs/adr/frame-path.md §7 on the core: rounds FIRST … LAST−1, each round's four visit kinds in a rotated order,
# both engines and both throttles inside each (run.mjs interleaves the cells and the arms); rows committed and pushed
# after each kind, so a run cut short keeps what it measured.
#
#   [KINDS="asks quiet"] [THROTTLES=1] [NAME=start] xvfb-run -a lab/viewer/view_run.sh FIRST LAST [BRANCH]
#   KINDS: a top-up's kinds alone; NAME: the rows' file, NAME-KIND.jsonl (the start timing's: docs/adr/frame-path.md §7)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}" FIREFOX_PATH="${FIREFOX_PATH:-$(ls -d /opt/pw-browsers/firefox-*/firefox/firefox | tail -1)}"
OUT=lab/viewer/rows
mkdir -p "$OUT"
common=(--frames lab/.av1-work/view --links r50000 --throttles ${THROTTLES:-1,4} --engines chromium,firefox --origin navigation --rounds 1)
three=ct_nlst,us_liver,dbt12_ea1141
read -ra kinds <<<"${KINDS:-quiet cine busy asks}"
for ((r = $1; r < $2; r++)); do
  for ((k = 0; k < ${#kinds[@]}; k++)); do
    kind=${kinds[(k + r) % ${#kinds[@]}]}
    case $kind in
      quiet) args=(--sets "$three,ffdm_a-0") ;;
      cine) args=(--sets "$three" --busy --cine 10) ;;
      busy) args=(--sets ffdm_a-0 --busy) ;;
      asks) args=(--sets "$three" --busy --fill 0 --asks-after 10) ;;
    esac
    node lab/av1/delivery/total-time/run.mjs "${common[@]}" "${args[@]}" --first-round "$r" --out "$OUT/${NAME:-view}-$kind.jsonl" 2>&1 | grep '^round' || true
    if [[ -n "${3:-}" ]]; then
      git add "$OUT" && git commit -qm "frame-path §7: round $r, ${NAME:-view} $kind rows" && { git push -q origin "$3" || git push -q origin "$3"; }
    fi
  done
done
