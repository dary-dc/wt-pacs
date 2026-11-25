state: started
started: 2026-11-25T08:07Z
heartbeat: 2026-11-25T09:12Z
by: S8Un381p
outputs: (pending) rows in claude/work-ledger docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/
## Resume
Built in ../tip (origin/claude/unified 9170cdf39): wasm-pack 0.15.0, both client builds, dev cert, decoders (match manifest),
series-server, ingest/tools.sh; ../pr = 9170cdf39 + PR 446 0e273ee92 merged locally (not pushed), the tip's untracked client
builds copied in. Series in /home/user/demo-series (dbts_b1, dbts_b1-q8-g8, ingest_coded.py as scripts/demo-series.sh).
Smoke (one round, CLEAN 1x) ran; the pass's byte count amended (62bde541c). cpu_throttle --check: 1x 144/134 ms, 4x 684/684.
Running now: rows land in docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/steps.jsonl (pushed as they land):
  cd docs/queue/WINDOW-WHOLE-GROUPS-MEASURE && TIP=/home/user/tip PR=/home/user/pr DIR=/home/user/demo-series FORMS=CLEAN,LTE \
    RATES=1,4 ROUNDS=4 OUT=steps.jsonl NODE_PATH=$(npm root -g) taskset -c 0-2 node steps.mjs
A resume after a lost container: rebuild as above, then FIRST=<next round> ROUNDS=<left>. Next: summary (per form, rate,
pass: bytes and the sum of waited steps' times, tip over pr, A/A), findings in findings.md §Timed cells, PR 446's body if
allowed, docs/lines/client.md on claude/window-whole-groups.
## Result
