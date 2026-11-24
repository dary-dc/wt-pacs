state: started
started: 2026-11-24T18:47Z
heartbeat: 2026-11-24T20:58Z
by: bqyisHDi
outputs: claude/transport-flags (the rig's additions, from origin/claude/transport-arms; raw rows); claude/page-runs (rows copied; docs/reviews/page-runs.md §Transport)
## Resume
Done (claude/transport-flags): 4aa86d5de the rig's additions (lab only); b3cc67981, 00299fb0c the 2-round pilot of
WT-TS, WT-TW, WT-PF, WT-AF on AD and CR (not counted) and rows/pilot-medians.json extended by the three arms. Mutant
ignored-arg run (1 round AD): WT-AF VOID "the server's start-up output lacks ...", killed. Series: dbts_b1 as HTJ2K,
50 frames, 107407602 B, every one exact (ingest_coded.py --codec htj2k; pack-series), at /tmp/claude-0/b1-htj2k.
Running (2026-11-24T19:08Z): /tmp/claude-0/s/chain.sh: the two measured mutants (no-arm-flag, af-as-pf; 2 rounds AD), then
  node lab/transport-arms/run.mjs --cell AD --rounds 14 --arms "WT-TS,WT-TS',WT-TW,WT-PF,WT-AF,H3-fill,H3-frame" \
    --series DIR --server target/release/series-server --pilot-medians lab/transport-arms/rows/pilot-medians.json \
    --limit-ms 600000 --out lab/transport-arms/rows/flags-AD.jsonl     (then the same with --cell CR, flags-CR.jsonl)
  rows pushed every 10 minutes to claude/transport-flags. ~85 min AD, ~75 min CR.
On resume: a partial flags-AD.jsonl cannot be continued mid-cell by run.mjs (no --start-round); re-run the cell's
remaining rounds is not supported, so rerun the whole cell to a new --out (flags-AD-2.jsonl), keep the partial, say so.
Then: python3 lab/transport-arms/summary.py lab/transport-arms/rows flags-AD flags-CR; copy rows to claude/page-runs;
page-runs.md §Transport: every cell against §1's bands, misses included; docs/lines line doc; status done.
## Result
