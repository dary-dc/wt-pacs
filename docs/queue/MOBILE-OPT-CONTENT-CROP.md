state: done
started: 2026-11-15 14:28 UTC
heartbeat: 2026-11-15 14:44 UTC
outputs: claude/mobile-decode e43ddf6c (pre-registration), aa98e175 (lab/av1/content-crop/measure.py, tests), rows (lab/av1/content-crop/rows/), 60620183 and 126ced77 (docs/decode/mobile/content-crop.md), 09c45f2d (docs/lines/client.md); draft PR 397

## Resume

Done. Nothing left for this row; MOBILE-DECODE-COMPARE reads docs/decode/mobile/content-crop.md (§8 its columns).
The brief and the Amendments did not change while it ran (amendment 21).

## Result

* One cloud cell, pre-registered by this session before it ran (the row's brief; a departure from the standing rule
  that another session writes the protocol, stated in §7).
* Cell A, 19 DBT volumes: bg = 0 on all; a lossless rectangle under 0.90 of the frame on 3 of 19, all system B
  (dbts_b1 0.50, dbts_b3 0.73, dbts_b2 0.83); systems A and C already store the breast's box (0.96-1.00).
* Background is 26-66 % of samples, but in the corners inside the breast's own box, which no rectangle removes.
* Cell B (3 volumes, 16 frames, interleaved, one host): bytes unchanged (AV1 0.9996-1.0018, HTJ2K 0.9973-0.9995);
  decode on dbts_b1 0.85 (AV1) and 0.76 (HTJ2K), on dbts_b3 0.94, on dbts_b2 within noise.
* Predictions: P-A2, A3, A4 hit; P-A1 miss; bytes 4 of 6; decode 0 of 6, all on the side of less saving.
* Per-sample costs (hash, copy, upload, memory) halve on dbts_b1 only; no volume changes AV1 level.
* The exact-background rule loses nothing on screen; DICOM PS3.3 (Pixel Padding Value, Displayed Area, Burned In
  Annotation) and the ACR technical standard §III.D.1.e item 8 quoted.
* Fixtures and limits: 19 DBT volumes of three systems of one dataset; cell B on three of one system; libaom 3.15.1
  cpu6, dav1d 1.5.4, OpenJPH 0.31.0; one 4-core cloud host, no GPU, no phone; no absolute time claimed.
* Tests: five mutants killed. Gate: comment budget, links, lab absence green; scripts/gate.sh not run (docs and lab).
* Owner: whether an ingest change worth 15-24 % of decode on the largest detector only is wanted; and whether the
  view's label should say anything when the rectangle is used (ACR item 8; the leaning says no, nothing is cropped).
