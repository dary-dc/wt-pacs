state: done
started: 2026-11-11T17:50Z
heartbeat: 2026-11-11T19:45Z
outputs: claude/demo-fixes-2 d46811c6 (code as at 7d45b31f), draft PR #367 into claude/core (body rewritten as the merge record)
## Resume
Done. Merges ee04ef57 (demo-ux #365), 935c5374 (source-fingerprint #364), 2d2af731 (demo-clean items 1-9); docs
7d45b31f (REVIEW-2 F1, D1), 17312cf8 (owner's yes recorded), d46811c6 (line file). Nothing left for this row. The freeze
holds from here: only blockers change claude/demo-fixes-2. Next: CLEAN-PRODUCT, then FREEZE-E2E.
## Result
* Merged --no-ff: claude/demo-ux (#365, with #360, #362, #359, #356), claude/source-fingerprint (#364), claude/demo-clean
  (EXPERIMENTS-OFF items 1-9, no archive tags). Conflicts only in the line file, both sides kept.
* REVIEW-2: D1 and F1 corrected in place (7d45b31f); U1 left to CLEAN-PRODUCT / item 13, U2 to the phone run; C1 run.
* MAIN-REVIEW's S1 already fixed on this branch. E2E-3: no failure. REDTEAM-PROPOSALS: nothing "adopt"; P1/P2 not taken.
* Full gate GATE OK in 650 s at 7d45b31f (skipped: lavapipe painter/window, cross-codec arm + Firefox); nginx check
  run apart on nginx 1.29-alpine, host network: equivalent on 13 paths, 22 hidden.
* demo-series.sh again from the merged tip: 21 series, 527 s; three sourceFingerprints, seven series each; no framesSha256.
* demo-check.mjs: README's 20 runs x {page, worker}, interleaved by series: 40 of 40 passed.
* Fixtures: dbts_a1/b1/c1, one dataset; no ultrasound cine; one 4-core cloud host, no GPU, headless Chromium
  (Playwright 1.63, SwiftShader), loopback; one run per cell; correctness only, nothing timed; no phone.
* CI on #367 not yet read for d46811c6.
* Owner: after FREEZE-E2E, the two merge words in #367 (this tip into claude/core, then PR 250 into main, merge commits).
