state: started
started: 2026-11-24T15:47Z
heartbeat: 2026-11-24T16:01Z
by: Eh9ts3Aw
outputs: claude/delivery 893f04aad, e3659625e, c16f7e28d (lab only; PR 406)
## Resume
Done (claude/delivery): 893f04aad model side (plan, inputs K3′, predict: reproduces A2.7 and A2.3 to the digit); e3659625e judge (10 of 12, zoom, askLastByte, escaped, FIT prefix refusal, calibration never counted); c16f7e28d FIT series (fit_truth.py, fit.mjs, series.sh): dbts_b1 level 1, prefixes 26.9–27.3 %, 0.2712 of the series.
Next, the page side, lab only: lab/delivery/fit-decoder.js (RESLEVEL decoder.js with the level check against fit.levelDigests, the rest joined and checked by the frame digest); levers.js `fit` (decoderWorker + decoder.fit from the metadata), head.js's asked list (fit, split, zoomAfter); the zoom and the window read-back after the fill (lab/delivery/fit-page.js, called from round-page.js); paint-worker.js `picture` read (fbo, sample order, r-m1); C1's ask → last byte from exactSource's frame timing; run.mjs: FIT series ids, the 1080×2100 DPR 1 viewport, cpus/softirqs/ctxsw, --k3-prime, mutants. Then SPLIT and the switch's reading.
Build state in a fresh container: pip install meson==1.9.1; ingest/tools.sh; cargo build --release -p series-server -p pack-series; client/decode/wasm/fetch_openjph.sh; OUT=lab/av1/data lab/av1/fetch_data.sh dbts_b1 dbts_a1 dbts_c1; lab/delivery/series.sh S.
## Result
