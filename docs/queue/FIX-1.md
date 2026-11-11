state: done
started: 2026-11-11 03:21
heartbeat: 2026-11-11 03:48
outputs: claude/demo-fixes-1 9e2ef4ef, draft PR #363 into claude/core
## Resume
Done. Merges 579206f0; fixes c6d13a48, 15c0235f, 671bdd6f, c9bfa15b, fdbf8f89, d122dec1, 7d93e030, 1a038e04,
54ecfe31, 515a36ad, c11a2536, c9dc75ae; gate lines 053321b2; docs/lines/optimal-quality.md 9e2ef4ef. PR #363 maps each.
## Result
* Merged demo-view-worker, demo-tests-mobile, demo-redteam, demo-review-blind (--no-ff) into claude/demo-fixes-1.
* Red team 1-5 pass and run in the gate: cut frame not at 10 bits refused; checkPair requires the same framesSha256,
  photometric, rescale, perFrame, a 16-hex digest per frame; dot ids refused. Red team 6 = blind C3, fixed.
* Blind C1-C3 via client/viewer/screen.js + screen.test.mjs (node seam); C5 (--codec lossy refused); S1 trimmed.
* Answered, not changed: C4, D1, D2 (owner), S2-S4, D3; TEST-MOBILE had no correctness failure to fix.
* Mutants: pair digest 3, read-as keys 3, screen 6: all killed.
* Full gate OK in 520 s on 9e2ef4ef (skipped: lavapipe painter/window, GL-display viewer arm and Firefox, nginx).
  Gate needs INGEST_BUILD and PYTHON as absolute paths, and client/transport/wasm/build.sh first.
* Fixtures: no demo series run here (E2E-3's); dbts_a1/b1/c1 from one dataset; no ultrasound cine; 4-core, no GPU.
* Owner decisions: framesSha256 now required on both series (fdbf8f89 reverses a deliberate acceptance; revert if
  unwanted); C4/D2 the stored-form series in the demo list; D1 dav1d preloaded on every AV1 page.
