state: started
started: 2026-11-20T08:00Z
heartbeat: 2026-11-20T10:26Z
outputs: `claude/htj2k-a1` (rows to land in `lab/htj2k-tiles/improve/rows/a1-*.jsonl`; PR 408)
## Resume
Shard 1 (rounds 0–2) done 09:25Z, 144 rows pushed; shard 2 (rounds 3–5, `a1-run-2.jsonl`) running since 09:25Z. Shard 1 had restarted 08:19Z (the 08:03Z start lacked the lab level binding: D+T3 got no bytes, 3 visits set aside in `/home/user/rows/a1-aborted.jsonl`), running, rows to `/home/user/rows/a1-run-1.jsonl`, copied into
`claude/htj2k-a1:lab/htj2k-tiles/improve/rows/a1-run-1.jsonl` and pushed every 15 min by `/home/user/pusher.sh a1-run-1`.
Pushed: `3ce57fa2` the readings of the registration (`docs/htj2k-tiles.md` §A1, measured), then `stage3/a1.py`.
**To resume in a fresh container:** set up as HTJ2K-MEASURE's Resume (fetch_data, `ingest/tools.sh`, worktree
157b7109 at `/home/user/demo` with this branch's `ingest/.build/{aom-3.15.1,dav1d,openjph,dav1d-src,openjph-src}` copied
in, `lab/av1/.venv` linked, `demo-series.sh` at QS=(8) GS=(16), `stage3_prep.py`, WASM `build.sh` with the base image from
`mirror.gcr.io`, `cargo build --release -p series-server -p pack-series`, `lab/htj2k-tiles/improve` copied in,
`lab/.demo-series` and `lab/.av1-work/htj2k-improve` linked, the level binding built in the `wt-pacs-decoder-build` image (`inside.sh` first for its emsdk, then `build_levels.sh` with `levels.patch` from `origin/claude/htj2k-progressive` handed in, no git there; `levels.wasm` sha256 `09756bcf…` as `rows/stage3-pins.json`), an empty `lab/.traces/TMobile-LTE-short.down`), stop dockerd;
keep only complete rounds (48 rows) of the pushed shard file, then from `/home/user/demo`:
`NODE_PATH=$(npm root -g) node lab/htj2k-tiles/improve/stage3/run.mjs --series lab/.demo-series --bands
lab/.av1-work/htj2k-improve --arms D,D′,D+T1,D+T3 --cells r5000,r20000 --sets dbts_a1/phone,dbts_b1/phone,dbts_c1/phone
--rounds 3-K --first-round K --out ROWS` for the shard's missing rounds (shard 2: `--first-round 3 --rounds 3` into
`a1-run-2.jsonl`). Then `python3 lab/htj2k-tiles/improve/stage3/a1.py rows/a1-run-*.jsonl`, the readings in
`docs/htj2k-tiles.md` §A1, measured, `docs/lines/codecs.md` Open 7, PR 408's body, this Result.
## Result
