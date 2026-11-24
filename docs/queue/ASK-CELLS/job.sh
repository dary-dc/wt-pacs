#!/usr/bin/env bash
# ASK-CELLS: rounds of the main cells and P1b interleaved by round; rows pushed after each; heartbeat every 20 min.
cd /home/user/ask; export NODE_PATH=$(npm root -g)
R="node lab/av1/delivery/total-time/run.mjs --frames lab/.av1-work/ask --sets dbts_b1 --throttles 1 --rounds 1"
D=lab/viewer/rows/ask
push() { git add $D && git commit -qm "ASK-CELLS: $1" && for k in 1 2 3 4; do git pull -q --rebase origin claude/ask-cells; git push -q origin claude/ask-cells && break; sleep $((k*5)); done; }
beat() { while true; do
  ( cd /home/user/ledger && git pull -q --rebase && T=$(date -u +%Y-%m-%dT%H:%MZ) && sed -i "s/^heartbeat: .*/heartbeat: $T/" docs/queue/ASK-CELLS.md &&
    sed -i "s/^Running: .*/Running: $(cat /tmp/claude-0/ask-progress 2>/dev/null) (at $T)/" docs/queue/ASK-CELLS.md &&
    git commit -qam "ASK-CELLS: heartbeat" && git push -q origin claude/work-ledger ) >/dev/null 2>&1
  sleep 1200; done; }
beat & BEAT=$!
FIRST=${FIRST:-0}; LAST=${LAST:-12}
for ((r = FIRST; r < LAST; r++)); do
  if ((r < 10)); then echo "main round $r" > /tmp/claude-0/ask-progress
    $R --first-round $r --leg-cells P1-20,P1-40,P1c-12,P2 --variants behind,ahead34,centred,struck,centredaa --out $D/main.jsonl 2>&1 | grep '^round'
    push "round $r of P1-20, P1-40, P1c-12, P2"; fi
  echo "P1b round $r" > /tmp/claude-0/ask-progress
  $R --first-round $r --leg-cells P1b-40 --variants behind,centred,rule,centredaa --out $D/p1b.jsonl 2>&1 | grep '^round'
  push "round $r of P1b"
done
if [[ "${P80:-0}" == 1 ]]; then for ((r = 0; r < 10; r++)); do echo "P1c-80 round $r" > /tmp/claude-0/ask-progress
  $R --first-round $r --leg-cells P1c-80 --variants behind,ahead34,centred,struck,centredaa --out $D/p1c80.jsonl 2>&1 | grep '^round'
  push "round $r of P1c-80"; done; fi
echo "rounds done" > /tmp/claude-0/ask-progress
kill $BEAT; echo JOB-DONE
