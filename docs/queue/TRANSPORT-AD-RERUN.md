state: started
started: 2026-11-19T08:16Z
heartbeat: 2026-11-19T08:52Z
outputs: claude/transport-arms rows/AD-rerun.jsonl (174538ad, partial, pushed every 15 min); stacks.md §6.6 pending
## Resume
Host built 08:2xZ (TRANSPORT-BUILD-FIX's setup line, ingest/tools.sh, series-server --features lab-get) at
claude/transport-arms 3c47ab63. Series: dbts_b1 HTJ2K at /home/user/series (50 frames, 107 407 602 B, every one exact
at ingest), as TRANSPORT-RUN's. Smoke (1 round, not counted, not pushed): 16 visits exact; the fill shape's ask now
jumps (ad-pub H3-fill 0.52, H2-fill 0.67 of WT-TS; one round only). ~7 min a round.
Counted run started 2026-11-19T08:31Z, detached: `setsid nohup bash counted.sh` = `node lab/transport-arms/run.mjs --cell AD
--series /home/user/series --server target/release/series-server --limit-ms 600000 --pilot-medians
lab/transport-arms/rows/pilot-medians.json --out lab/transport-arms/rows/AD-rerun.jsonl` (16 rounds, ad-pub then
ad-lte, eight arms, Williams order); a pusher commits rows/AD-rerun* to claude/transport-arms every 15 min.
Resume in a fresh container: the setup and series above; if rows/AD-rerun.jsonl is partial, keep it renamed
(AD-rerun.partial-<HHMM>.jsonl, in no bar) and rerun the cell whole. After it: `python3 lab/transport-arms/summary.py
lab/transport-arms/rows AD-rerun` (or the run's own printout) and aa_rule.py --bar 0.05 per form; stacks.md §6.6 on
claude/transport-design; docs/lines/codecs.md §Open 7.
## Result
(none yet)
