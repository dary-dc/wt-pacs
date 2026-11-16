state: started
started: 2026-11-16T08:25Z
heartbeat: 2026-11-16T08:50Z
outputs: claude/report-arms (rows), claude/report-plan (report-plan.md §Results)
## Resume
Done: claimed; report-plan.md §7.8 amendment (claude/report-plan 7538b6fc): Chromium's D only, loopback, grey-16 x32,
endings D1, D2, D7, D9, D4, D5b, D8, D3, D5a, 18 rounds each, --wait 60, receiver RECEIVER behind nginx 1.31.8.
Next: the mutants on D1, then the endings in that order. Rows to claude/report-arms lab/report-arms/rows/.
Setup: worktree of claude/report-arms; CARGO_TARGET_DIR=$PWD/target cargo build --release -p series-server
--features telemetry -p pack-series -p report-receiver; nginx 1.31.8 from nginx.org's tarball (./configure; make
install), NGINX_BIN=<its sbin/nginx>. Per ending: node lab/report-arms/run.mjs --receiver receiver --units
"off,beacon:H,beacon:Y,keepalive:H,keepalive:Y,session:1,session:Y,session:H,off'" --endings <E> --rounds 18 --wait 60
--out lab/report-arms/rows/chromium-<E>.jsonl. A partial ending is kept, marked, rerun whole.
## Result
