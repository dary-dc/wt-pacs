state: done
started: 2026-11-20T13:17Z
heartbeat: 2026-11-20T13:36Z
outputs: claude/oq-integrity-build (c876d6830 docs/reviews/oq-integrity.md §Fixes review; 8e6624848 line doc), draft PR 368 body §OQ-INTEGRITY-FIXES-REVIEW
## Resume
Done. I2-RUN (not before 11-21 12:00) may start: no blocker open.
## Result
* No blocker. Each fix's test fails without its change, re-run here: controller.js reverted -> controller.test 40/41 and demo-check fails (page, worker); screen.js reverted -> screen.test fails; decoder.js M1-M4 each killed (old test lets M2 live); sigma(reconstruction) killed; both label texts mutated -> demo-check fails in both views.
* asCoded is set only by decoder.js verdict after a digest match: the label never claims a check that did not run.
* The diff from dc989114e touches only the fixes' eleven files.
* F1 (minor, regression of fix 1): a window drag on a refused frame throws (shown.window undefined in viewer.js pointermove); reproduced in both views; one-line fix proposed; does not block I2-RUN.
* Fixtures and limits: dbts_a1 and dbts_a1-q8-g8-cut (--integrity), one DBT volume of one dataset; one 4-core cloud host, headless Chromium on SwiftShader, loopback, committed page decoders (no docker); no phone, no hardware AV1 decoder. Gate not run (findings-only row); comment budget and check_links green.
* Owner decisions: unchanged (PR 368's: take it; choice 2, block or paint red).
