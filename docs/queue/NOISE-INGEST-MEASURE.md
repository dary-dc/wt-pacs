state: started
started: 2026-11-21T15:47Z
heartbeat: 2026-11-21T15:52Z
outputs: claude/noise-ingest (rows; the crate under lab/noise-ingest), PR 413
## Resume
Done: fixtures fetched and digest-checked (lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1), mirrored, masks
written; crate lab/noise-ingest pushed (2293f180); a first pass of M1 equals the rows on 175/175 frames.
Next: the golden test and its four mutants, then five rounds of M1–M5 (lab/noise-ingest/run.py), rows pushed
under lab/noise-ingest/rows/ after each round.
## Result
