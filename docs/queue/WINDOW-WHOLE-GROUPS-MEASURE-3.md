state: started
started: 2026-11-25T11:47Z
heartbeat: 2026-11-25T11:48Z
by: tbvS32jH
outputs: claude/work-ledger docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/ (rows)
## Resume
Trees: /home/user/tip = origin/claude/unified 8459a0a7b (UNIFIED-SYNC-1125's tip at 11:50; its client equals 9170cdf39's but PRs 447, 448
merged before it); /home/user/pr = 8459a0a7b + --no-ff merge of claude/window-whole-groups 94d447835, local only, never pushed
(docs/lines/client.md taken from the tip; the code diff is PR 446's seven files).
Building in /home/user/tip (log /home/user/m3/build.sh): meson, wasm-pack 0.15.0, fetch_openjph/xxh3, client/transport/{wasm,ts}/build.sh,
gen_dev_cert.sh, cargo release series-server pack-series, lab/av1/fetch_data.sh dbts_b1, ingest/tools.sh. Then ingest_coded.py for dbts_b1
(--codec htj2k) and dbts_b1-q8-g8 (--lossy 8 8 --exact-series dbts_b1) into /home/user/demo-series as scripts/demo-series.sh; copy the tip's
untracked client builds into /home/user/pr. Then the run (README.md §The timed cells), rows to steps-3.jsonl, pushed as they land:
  cd docs/queue/WINDOW-WHOLE-GROUPS-MEASURE && TIP=/home/user/tip PR=/home/user/pr DIR=/home/user/demo-series FORMS=CLEAN,LTE \
    RATES=1,4 ROUNDS=4 OUT=steps-3.jsonl NODE_PATH=$(npm root -g) taskset -c 0-2 node steps.mjs
A resume after a lost container: rebuild as above, then FIRST=<next round> ROUNDS=<left>.
## Result
