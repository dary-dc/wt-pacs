state: done
started: 2026-11-15 14:28 UTC
heartbeat: 2026-11-15 15:28 UTC
outputs: claude/mobile-decode f6f0416d (pre-registration), 5f49c015 (lab/av1/htj2k-lossy/ and its rows), 2b55f38c
(docs/decode/mobile/htj2k-lossy.md, docs/lines/client.md); PR 397 (draft, existing)
## Resume
Done. Brief and amendments re-read at each push: unchanged. Gate: scripts/check_lab_absent.sh and comment_budget.sh
green; the full scripts/gate.sh not run (docs and lab scripts only, no product file touched).
## Result
Fixtures: 19 DBT volumes (EA1141), every frame; decode on one 4-core cloud host, node 22 and headless Chromium 153
(both V8), one thread, 3 volumes x 16 frames; no phone, Firefox or Safari; coding error measured, never read.
* Bytes (Cell B): at the noise rule's 1.00 bar 0.85-1.47x the AV1 view's (median 1.05, interpolated), with 1.05-1.17x
  its in-window error; at the view's Q 8 G 8 error 1.28-1.45x (median 1.36); 0.083-0.160 of the exact frame.
* Decode (Cell D, two runs): lossy 1.12-1.21x the lossless frame (P6 missed: slower, not faster), 0.41-0.50x the AV1
  view through dav1d-WASM; phone predicted 93-154 ms a dbts_b1 frame (T) against AV1's measured 133-135.
* Exactness (Cell E): node = Chromium on 48/48 lossy frames; native x86 ojph_expand differs by 1 on 190-777 samples
  a frame on all 48 (x86 rounds ties to even, WASM away from zero). The view's digest must be computed with the
  shipped WASM build; an OpenJPH bump re-checks every view digest.
* Predictions: P1, P2, P4, P7, P8, P9 hit; P3 hit interpolated, missed tested-only on 4 volumes; P5 missed on 5; P6 missed.
* The noise rule's bar reads wavelet and AV1 errors alike while the in-window error differs: picking a Δ is the codecs line's.
Owner: none asked here; for MOBILE-DECODE-COMPARE, three phone cells in the file's §10.
