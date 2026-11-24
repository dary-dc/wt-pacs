state: started
started: 2026-11-24T18:27Z
heartbeat: 2026-11-24T21:04Z
by: G2bMnvtP
outputs: claude/session-cost (rows; session-cost.md §Results); the rig on claude/session-cost-rig
## Resume
Rig: claude/session-cost-rig c16863cb2 (tree = b059388b6's client/view, client/transport; T1). Amendment pushed before
any counted row: claude/session-cost d073a7a57, session-cost.md §9 "2026-11-24, SESSION-COST-RUN" (server pair a
session; the guard recorded, VOIDs nothing; FIT W 15; mutants flagged; smoke).
CLEAN done (97 rows, 96 counted, session-CLEAN.jsonl). CR: rows 0-30 in session-CR.jsonl (the first job hit its
2 h limit); 31-48 running as `--skip 31` into session-CR-rest.jsonl, then usb_cine B x3 (job2.sh).
If this session ends: on claude/session-cost-rig, rebuild (README Prerequisites; ingest/tools.sh;
cargo build --release -p series-server -p pack-series; lab/delivery/series.sh S plus usb_cine as §9 says), then rerun
only the missing rounds of the cell (--rounds N runs rounds 0..N-1; skip the steps already in the rows file by
starting a new --out and joining), then `node lab/delivery/session-summary.mjs <rows>` and write §Results on
claude/session-cost.
## Result
