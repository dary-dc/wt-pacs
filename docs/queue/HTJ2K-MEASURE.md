state: started
started: 2026-11-11 18:59 UTC
heartbeat: 2026-11-11 19:40 UTC
outputs: `claude/htj2k-tiles` cfcc1601 (rows, docs; draft PR #324 into main)
## Resume
Done: cfcc1601 `lab/htj2k-tiles/improve/offline.py` (stages 0 and 1 offline, every frame; four mutants each killed
on one frame of each volume); rows `lab/htj2k-tiles/improve/rows/stage0-<vol>.jsonl` landing (a1 done; b1, c1
running). Setup in this container: data in /home/user/htj2k-data (`OUT=... lab/av1/fetch_data.sh dbts_a1 dbts_b1
dbts_c1`), `pip install meson` then `ingest/tools.sh`, OpenJPEG v2.5.4 native via cmake (`-DBUILD_SHARED_LIBS=OFF
-DBUILD_CODEC=ON`). Next: summarise J1, J2, R1 and the zoom bytes from the rows; then stage 2 (headless Chromium;
the delivered decoder `client/decode/wasm/build/build.sh` and the lab level binding
`claude/htj2k-progressive:lab/htj2k-progressive/wasm/`) and a strip-on-3-workers decode bench (J3, J9).
## Result
(pending)
