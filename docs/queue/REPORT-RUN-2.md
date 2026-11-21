state: started
started: 2026-11-21T13:47Z
heartbeat: 2026-11-21T15:44Z
outputs: (pending) rows on `claude/report-arms`; `report-plan.md` §Results 2 on `claude/report-plan`
## Resume
Done: claimed; host built (cargo release `series-server --features telemetry`, `pack-series`, `report-receiver`; nginx 1.31.8 from
nginx.org's tarball; Firefox 160.0.1 from Mozilla's release tarball; iproute2 present); `cdp.check.mjs` (Chromium 153.0.8010.12)
and `bidi.check.mjs` (Firefox 160.0.1) all levers ok; `run.test.mjs` ok; a one-round D6 `--tun` smoke (BEACON-Y, SESSION-1;
not counted; `docs/queue/REPORT-RUN-2-smoke.jsonl`). The amendment `report-plan.md` §7.9 on `claude/report-plan` `d0bbbb10`.
Running since 13:55Z (D5a 107/162 at 15:43Z, rows pushed at 50614a67): `REPORT-RUN-2-run.sh` (Chromium D5a D5b L Lbusy C, R, D6 --tun, then Firefox mutants and cells), rows in
`claude/report-arms:lab/report-arms/rows/r2-*.jsonl`, pushed every 15 min by `REPORT-RUN-2-push.sh`. A cell is complete when its
file holds its `{"cell"}` line (R: `{"done":"R"}`; Firefox mutants: `{"mutants":"done"}`).
To resume (a fresh container): worktree W of `claude/report-arms`; `CARGO_TARGET_DIR=$W/target cargo build --release -p series-server
--features telemetry -p pack-series -p report-receiver`; nginx 1.31.8 (`./configure --prefix=...; make install`, libpcre2-dev,
zlib1g-dev); Firefox 160.0.1 linux-x86_64 tarball; then `W=... NGINX_BIN=... FIREFOX_PATH=... LOG=<scratch> setsid nohup
docs/queue/REPORT-RUN-2-run.sh &` and the same for `REPORT-RUN-2-push.sh`. The script skips complete cells and keeps a partial one
(renamed, counted in no bar). After each cell: its results in `report-plan.md` §Results 2 (`claude/report-plan`).
## Result
(pending)
