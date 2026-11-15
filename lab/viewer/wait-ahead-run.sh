#!/usr/bin/env bash
# docs/adr/frame-path.md §3, *Experiment 2*: its rounds, each visit not kept re-run at the round's end, rows pushed per round.
#   FIREFOX_PATH=... xvfb-run -a lab/viewer/wait-ahead-run.sh FIRST LAST
set -uo pipefail
cd "$(dirname "$0")/../.."
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
FILL=lab/viewer/rows-wait-ahead.jsonl
DEMAND=lab/viewer/rows-wait-ahead-on-demand.jsonl
RUN=(node lab/av1/delivery/total-time/run.mjs --rounds 1 --throttles 1 --frames lab/.av1-work/exp2 --trace sawtooth --headed)

# The visits of round $1 in $2 with no kept row, as wait-ahead-summary.mjs keeps them: "engine set link variant" a line.
missing() {
  node -e '
    const [round, file, fill] = process.argv.slice(1);
    const rows = require("fs").readFileSync(file, "utf8").trim().split("\n").map(JSON.parse).filter((r) => r.round === Number(round));
    const key = (r) => [r.engine, r.set, r.link, r.variant].join(" ");
    const kept = new Set(rows.filter((r) => !r.void && r.trace && !r.failures && (fill === "0" || r.frames === r.owed)).map(key));
    for (const k of new Set(rows.map(key))) if (!kept.has(k)) console.log(k);' "$1" "$2" "$3"
}

for r in $(seq "$1" "$2"); do
  "${RUN[@]}" --first-round "$r" --engines chromium,firefox --links r5000rtt46,r5000rtt92,r20000rtt46,r20000rtt92 \
    --sets ct_lidc,dbt10_ea1141 --out "$FILL"
  "${RUN[@]}" --first-round "$r" --engines chromium,firefox --links r20000rtt92 --sets ct_lidc --fill 0 --out "$DEMAND"
  for pass in 1 2 3; do
    while read -r e s l v; do
      "${RUN[@]}" --first-round "$r" --engines "$e" --sets "$s" --links "$l" --variants "$v" --out "$FILL"
    done < <(missing "$r" "$FILL" 1)
    while read -r e s l v; do
      "${RUN[@]}" --first-round "$r" --engines "$e" --sets "$s" --links "$l" --variants "$v" --fill 0 --out "$DEMAND"
    done < <(missing "$r" "$DEMAND" 0)
  done
  git add "$FILL" "$DEMAND"
  git commit -q -m "Experiment 2 rows: round $r

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BSzJmzC7b7xGPRoHnMwQBL"
  for d in 2 4 8 16 0; do git push -q -u origin claude/core-exp2 && break; [[ $d = 0 ]] || sleep "$d"; done
done
