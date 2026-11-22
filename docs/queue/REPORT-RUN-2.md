state: done (Chromium complete; Firefox counted cells not run, a rig defect)
started: 2026-11-21T13:47Z
heartbeat: 2026-11-22T20:43Z
outputs: `claude/report-arms` rows `lab/report-arms/rows/r2-*` (last 4ef4e12a); `claude/report-plan` §7.9 d0bbbb10, §Results 2 to 17599aed, `docs/lines/client.md` bc6bf057; no PR (PR 395 carries the rig)
## Resume
Done 2026-11-22T20:43Z. Next: REPORT-VERDICT-2 (not before 11-23 08:00), by a session that ran none of it. Host notes for any later run, kept below.
Resumed 2026-11-22T06:17Z by a new session (stalled: heartbeat 05:12Z; no rows pushed since 02:41Z, no C file on claude/report-arms). Rebuilding the host in a fresh container, then the run script from C.
Done: claimed; host built (cargo release `series-server --features telemetry`, `pack-series`, `report-receiver`; nginx 1.31.8 from
nginx.org's tarball; Firefox 160.0.1 from Mozilla's release tarball; iproute2 present); `cdp.check.mjs` (Chromium 153.0.8010.12)
and `bidi.check.mjs` (Firefox 160.0.1) all levers ok; `run.test.mjs` ok; a one-round D6 `--tun` smoke (BEACON-Y, SESSION-1;
not counted; `docs/queue/REPORT-RUN-2-smoke.jsonl`). The amendment `report-plan.md` §7.9 on `claude/report-plan` `d0bbbb10`.
Running since 13:55Z (D5a complete 16:38Z, D5b 19:23Z, L 23:16Z, Lbusy 03:15Z (VOID by its A/A, 1.095), C 06:16Z, §Results 2 on claude/report-plan. R's first attempt (06:18–07:16Z) kept as rows/r2-R.nginx-unwritable.jsonl: nginx's unprivileged worker could not traverse the 700 scratch path, so NGINX wrote no line (RECEIVER's rows fine; judged nowhere). R rerun whole from 07:17Z out of a second worktree RW=/home/user/ra2, complete 08:31Z; D6 --tun complete 13:09Z (Chromium done); Firefox mutants complete 13:52Z (all caught); Firefox D1's first pass hung at row 70 (15:12Z, around the second container restart: one load's BiDi driver never returned; the driver has no per-load timeout), kept as rows/r2-firefox-D1.partial-11221636.jsonl; D1's second pass died at ~100 rows (18:32Z) when the disk filled: bidi.mjs leaves a ~108 MB Firefox profile in /tmp per load and never removes it (210 found, 21 GB); kept as rows/r2-firefox-D1.partial-11221855.jsonl. REPORT-RUN-2-push.sh now removes every profile no running Firefox holds, each minute. D1 rerun whole from 18:55Z, then D2 D9 D4 D5b D8 D5a D3 D7 L Lbusy C D6): `REPORT-RUN-2-run.sh` (Chromium D5a D5b L Lbusy C, R, D6 --tun, then Firefox mutants and cells), rows in
`claude/report-arms:lab/report-arms/rows/r2-*.jsonl`, pushed every 15 min by `REPORT-RUN-2-push.sh`. A cell is complete when its
file holds its `{"cell"}` line (R: `{"done":"R"}`; Firefox mutants: `{"mutants":"done"}`).
To resume (a fresh container): worktree W of `claude/report-arms`; `CARGO_TARGET_DIR=$W/target cargo build --release -p series-server
--features telemetry -p pack-series -p report-receiver`; nginx 1.31.8 (`./configure --prefix=...; make install`, libpcre2-dev,
zlib1g-dev); Firefox 160.0.1 linux-x86_64 tarball; then `W=... NGINX_BIN=... FIREFOX_PATH=... RW=<a worktree under a path nginx's worker can traverse, e.g. /home/user/ra2> LOG=<scratch> setsid nohup
docs/queue/REPORT-RUN-2-run.sh &` and the same for `REPORT-RUN-2-push.sh`. The script skips complete cells and keeps a partial one
(renamed, counted in no bar). After a container restart the run survives but the push loop keeps a dead proxy port (rows unpushed 02:41–09:35Z on 11-22, then pushed at 6153881f): kill and restart REPORT-RUN-2-push.sh. After each cell: its results in `report-plan.md` §Results 2 (`claude/report-plan`).
## Result
* Chromium 153, every new cell run, Williams-balanced, 18 rounds x 9 units, no counted row errored, host CPU <= 25 %: D5a, D5b
  timed from the fault (every arm 18/18 safety; the report handed on before every kill: the race is < 50 ms here, rule 3 a tie);
  D6 under --tun (18/18 safety; four predicted losses arrived: a 30 s blackout inside a 60 s browser life); L idle (bar met,
  gaps < 1.2 ms, below the clocks' resolution); Lbusy VOID (A/A 1.095; as measured page carriers ~51 ms p99, worker ones 2-9 ms);
  C (no long task added; the per-round fill bar met by no arm, nor by off' itself, 3/18); Y (largest record 1 657 B).
* R (6 rounds, nginx 1.31.8): NGINX passes at 100/s (1.3-1.5 % of a core), RECEIVER behind nginx misses (5.3-6.3 %); a first
  attempt kept, judged nowhere (the 700 scratch path kept nginx's worker from its log); the server's row not built.
* Firefox 160.0.1: the mutants all caught; counted cells not run: bidi.mjs hangs the driver about once in 70-100 loads (no
  per-load timeout, pending calls never rejected), 2-3 % of loads never fill, and each load leaks a ~108 MB profile (filled the
  disk once). Three D1 partials kept, counted in no bar. For a build row; not patched.
* Fixtures: a 4-vCPU cloud container, no GPU; headless Chromium 153.0.8010.12, Firefox 160.0.1; the grey-16 frame x32, not
  dbts_c1; the fault bench's forced mismatch; loopback or a userspace relay, not a radio; no phone, no WebKitGTK.
* Gate not run (rows and docs only); check_links.py adds no unresolved path (5 pre-existing on report-plan.md), comment budget ok.
* Owner: nothing forced. For REPORT-VERDICT-2: C's per-round bar and Lbusy's ratio A/A may be unmeetable on this host as written;
  a Firefox driver fix row before any Firefox verdict.
