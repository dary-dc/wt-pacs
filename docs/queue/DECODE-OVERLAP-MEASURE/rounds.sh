#!/usr/bin/env bash
# One round at a time, the rows pushed after each: README.md here.
set -euo pipefail
cd "$(dirname "$0")"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
for ((r = $1; r < $2; r++)); do
  node run.mjs --tip /home/user/tip --branch /home/user/branch --series /home/user/series --rounds 1 --first-round "$r" --out rows.jsonl | grep '^round' || echo "round $r: run.mjs exit $?"
  git add rows.jsonl && git commit -qm "DECODE-OVERLAP-MEASURE: round $r rows" && { git pull -q --rebase && git push -q origin claude/work-ledger || { sleep 5; git pull -q --rebase && git push -q origin claude/work-ledger; }; }
done
