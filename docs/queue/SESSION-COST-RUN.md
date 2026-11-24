state: started
started: 2026-11-24T18:27Z
heartbeat: 2026-11-24T20:03Z
by: G2bMnvtP
outputs: claude/session-cost (rows; session-cost.md §Results); the rig on claude/session-cost-rig
## Resume
Rig: claude/session-cost-rig c16863cb2 (tree = b059388b6's client/view, client/transport; T1). Amendment pushed before
any counted row: claude/session-cost d073a7a57, session-cost.md §9 "2026-11-24, SESSION-COST-RUN" (server pair a
session; the guard recorded, VOIDs nothing; FIT W 15; mutants flagged; smoke).
Running since 19:10 (job.sh in this session's scratchpad): usb_cine B x3 CLEAN; CLEAN --warmup --rounds 8 (96);
CR --warmup --rounds 4 (48); rows to claude/session-cost-rig lab/delivery/rows/session-{CLEAN-usb_cine,CLEAN,CR}.jsonl,
pushed every 10 min. If this session ends: on claude/session-cost-rig, rebuild (README Prerequisites; ingest/tools.sh;
cargo build --release -p series-server -p pack-series; lab/delivery/series.sh S plus usb_cine as §9 says), then rerun
only the missing rounds of the cell (--rounds N runs rounds 0..N-1; skip the steps already in the rows file by
starting a new --out and joining), then `node lab/delivery/session-summary.mjs <rows>` and write §Results on
claude/session-cost.
## Result
