state: started
started: 2026-11-24T19:35Z
heartbeat: 2026-11-25T16:45Z
by: xigw9LEm
outputs: claude/report-arms 958644318 (Firefox driver), 60578e891 (µs clock), f23fb35e6 (KEEPALIVE-Y°, D5a-busy); rows lab/report-arms/rows/r3-*.jsonl; results to claude/page-runs docs/reviews/page-runs.md §Reports

## Resume

Done: claimed 36cdc74b1. Builds on claude/report-arms, each with its mutant killed: step 0 (958644318: a closed BiDi
socket rejects pending calls; a Firefox load cut at 120 s, `VOID: driver`; profile removed on exit; FIREFOX_PATH
required), the µs clock (60578e891: RECEIVER and the sink stamp epoch ms with a µs fraction), KEEPALIVE-Y° and
D5a-busy (f23fb35e6). **Departure found in smoke, before any counted row:** D5a-busy as §2(b) specifies it (the kill
timed through `rig.sinceFault()`, then `rig.safety` read, then `Page.crash`) can never kill inside the long task: every
call through the busy page thread waits for the task (learned 25-44 ms; a dedicated worker's CDP session waits too).
Built instead: the decoder worker POSTs `{load, at}` to the sink's `/fault`, the driver sends `Page.crash` at the
drawn delay (measured mid-task: Page.crash lands in ~20 ms). Smoke (not counted): learned 2-12 ms after the fault, so a
delay under it is `late`; recorded per row.
D5a-busy complete 22:18Z, its reading in page-runs.md §2 Results (claude/page-runs 4e8f5d9e8): the race exists
(BEACON-* 9/18 each, KEEPALIVE-* 18/18). Lbusy running from 22:18Z, then C. A container restart (~01:20Z) killed the run at Lbusy round 14: rounds 0-13 kept,
round 14's two rows kept apart (rows/r3-chromium-Lbusy.cut-round14.jsonl), the cell resumed from round 14 at 01:27Z
(run.mjs --from-round, claude/report-arms 0092cf5e6); after a restart, run the three scripts again as below.
Lbusy complete 02:19Z, read in §2 Results (claude/page-runs edeeb39f6): A/A 1.040 pass, every band hit. C complete 06:03Z (a second restart after round 26; resumed from 27), read in §2 Results (claude/page-runs 2bb4b8734): VOID
by its A/A (1.053). Firefox D5a ended at round 2 (06:29Z): an unhandled rejection of a dropped BiDi call at
the socket's close (my step-0 fix); fixed e9b0e0a9b with its test. D1 running from 06:29Z (old code loaded), then L, D6;
D1 and L were cut the same way (a call after the close, unobserved; fixed 712a3fc67), D6 failed for want of
`ip` (iproute2 installed). From 09:14Z run.sh passes (at most 3) resume each cut cell at its round boundary.
In a fresh container, run run.sh until every r3-*.jsonl holds its {"cell"} line.
Running since 19:34Z: docs/queue/REPORT-RERUNS/run.sh (chromium D5a-busy, Lbusy, C; firefox D5a, D1, L; D6 --tun),
push.sh pushing rows every 10 min. Next: when each cell's {"cell"} line lands, its reading in page-runs.md §Reports
on claude/page-runs, against §2's predictions.
To resume in a fresh container: W=worktree of claude/report-arms; `CARGO_TARGET_DIR=$W/target cargo build --release
-p series-server --features telemetry -p pack-series -p report-receiver`; nginx 1.31.8 from nginx.org's tarball
(`./configure --prefix=...; make install`); Firefox 160.0.1 linux-x86_64 tarball from ftp.mozilla.org; then
`W=... NGINX_BIN=.../sbin/nginx FIREFOX_PATH=.../firefox LOG=<dir> setsid nohup docs/queue/REPORT-RERUNS/run.sh &` and the
same for push.sh. run.sh skips complete cells and keeps a partial one renamed.

## Result
