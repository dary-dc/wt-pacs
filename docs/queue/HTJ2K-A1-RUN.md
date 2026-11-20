state: started
started: 2026-11-20T08:00Z
heartbeat: 2026-11-20T08:00Z
outputs: `claude/htj2k-a1` (rows to land in `lab/htj2k-tiles/improve/rows/a1-*.jsonl`; PR 408)
## Resume
Claimed. Setup done so far in this container: the three DBT volumes fetched, `ingest/tools.sh` on `claude/htj2k-a1`,
the demo worktree `/home/user/demo` (157b7109) with its WASM decoders (`build.sh`, base image from `mirror.gcr.io`
at the pinned digest; manifest matched) and `cargo build --release -p series-server -p pack-series`. Next: the D series
(`demo-series.sh` at Q 8 G 16) and the strip series (`stage3_prep.py`), checked against `rows/stage3-d-series.json`
and `rows/stage3-series.json`; then A1 as pre-registered (`docs/htj2k-tiles.md` §Verdict): arms D, D′, D+T1, D+T3;
cells r5000, r20000; 1× and 4×; sets dbts_a1/phone, dbts_b1/phone, dbts_c1/phone; 6 rounds in two shards of 3.
## Result
