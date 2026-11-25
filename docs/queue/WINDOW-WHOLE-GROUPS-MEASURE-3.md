state: started
started: 2026-11-25T11:47Z
heartbeat: 2026-11-25T13:05Z
by: tbvS32jH
outputs: claude/work-ledger docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/ (rows)
## Resume
Built (12:00): /home/user/tip = origin/claude/unified 8459a0a7b; /home/user/pr = 8459a0a7b + local --no-ff merge of 94d447835 (never pushed;
docs/lines/client.md from the tip), the tip's untracked client builds copied in; window.test.mjs 4/4 on pr. Series in /home/user/demo-series
(dbts_b1 --codec htj2k, dbts_b1-q8-g8 --lossy 8 8 --exact-series dbts_b1, ingest_coded.py as scripts/demo-series.sh; ingest/tools.sh needs
BUILD absolute). cpu_throttle --check: 1x 148/139 ms, 4x 703/565. Smoke (CLEAN 1x, one round, not kept): tip-a "forward 32: no paint in 60 s"
(m2 again), the branch 34 and 40 frames.
Prediction written before any row: README.md §The timed cells again (1187f17b9).
Running since 12:02: rows land in docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/steps-3.jsonl, pushed every 10 min:
  cd docs/queue/WINDOW-WHOLE-GROUPS-MEASURE && TIP=/home/user/tip PR=/home/user/pr DIR=/home/user/demo-series FORMS=CLEAN,LTE \
    RATES=1,4 ROUNDS=4 OUT=steps-3.jsonl NODE_PATH=$(npm root -g) taskset -c 0-2 node steps.mjs
A resume after a lost container: rebuild as above, then FIRST=<next round> ROUNDS=<left>. Next: python3 steps_summary.py steps-3.jsonl >
steps-3-summary.txt; findings.md §Timed cells again; PR 446 body if allowed; docs/lines/client.md on claude/window-whole-groups.
## Result
