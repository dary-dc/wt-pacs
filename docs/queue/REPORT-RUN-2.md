state: started
started: 2026-11-21T13:47Z
heartbeat: 2026-11-22T06:20Z
outputs: rows on `claude/report-arms` (r2-*); `report-plan.md` §7.9 d0bbbb10, §Results 2 05c72032 on `claude/report-plan`
## Resume
Resumed 2026-11-22T06:18Z by a new session (stalled: heartbeat 05:12Z; no rows pushed since 02:41Z: `r2-chromium-Lbusy.jsonl` holds 139 lines, no `{"cell"}` line; no C file). Host rebuilt in a fresh container (same versions; cdp.check, bidi.check, run.test ok). Running since 2026-11-22T06:20Z: `go.sh` = `CHROMIUM=C REPORT-RUN-2-run.sh` (C, R, D6 --tun, Firefox as listed), then `CHROMIUM=Lbusy` alone. **Departure:** Lbusy, reported VOID at 03:15Z from rows never pushed, is rerun last, not before C: it decides nothing, and §7.9's order puts the deciding cells first; until it reruns, its §Results 2 numbers cannot be recomputed from pushed rows (rounds after 02:41Z lost with the old container).
Done: claimed; host built (cargo release `series-server --features telemetry`, `pack-series`, `report-receiver`; nginx 1.31.8 from
nginx.org's tarball; Firefox 160.0.1 from Mozilla's release tarball; iproute2 present); `cdp.check.mjs` (Chromium 153.0.8010.12)
and `bidi.check.mjs` (Firefox 160.0.1) all levers ok; `run.test.mjs` ok; a one-round D6 `--tun` smoke (BEACON-Y, SESSION-1;
not counted; `docs/queue/REPORT-RUN-2-smoke.jsonl`). The amendment `report-plan.md` §7.9 on `claude/report-plan` `d0bbbb10`.
Running since 13:55Z (D5a complete 16:38Z, D5b 19:23Z, L 23:16Z, Lbusy 03:15Z (VOID by its A/A, 1.095), C 06:16Z, §Results 2 on claude/report-plan; R running, then D6 --tun): `REPORT-RUN-2-run.sh` (Chromium D5a D5b L Lbusy C, R, D6 --tun, then Firefox mutants and cells), rows in
`claude/report-arms:lab/report-arms/rows/r2-*.jsonl`, pushed every 15 min by `REPORT-RUN-2-push.sh`. A cell is complete when its
file holds its `{"cell"}` line (R: `{"done":"R"}`; Firefox mutants: `{"mutants":"done"}`).
To resume (a fresh container): worktree W of `claude/report-arms`; `CARGO_TARGET_DIR=$W/target cargo build --release -p series-server
--features telemetry -p pack-series -p report-receiver`; nginx 1.31.8 (`./configure --prefix=...; make install`, libpcre2-dev,
zlib1g-dev); Firefox 160.0.1 linux-x86_64 tarball; then `W=... NGINX_BIN=... FIREFOX_PATH=... LOG=<scratch> setsid nohup
docs/queue/REPORT-RUN-2-run.sh &` and the same for `REPORT-RUN-2-push.sh`. The script skips complete cells and keeps a partial one
(renamed, counted in no bar). After each cell: its results in `report-plan.md` §Results 2 (`claude/report-plan`).
## Result
(pending)
