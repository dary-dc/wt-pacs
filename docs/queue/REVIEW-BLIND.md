state: done
started: 2026-11-11 01:33
heartbeat: 2026-11-11 01:37
outputs: claude/demo-review-blind c9ffd76d (from claude/demo-fixes-0 618e13c8; no PR: findings only)
## Resume
Done. 7d1749d0 docs/reviews/demo-blind.md; c9ffd76d docs/lines/optimal-quality.md (State now, the review's line).
## Result
* Review of claude/core...claude/demo-fixes-0, code first (viewer, view, decode, transport, paint, ingest, dev-server).
  Not fully blind: the procedure had this session read DEMO-INTEGRATE's and REDTEAM-DEMO's status files first.
* Correctness, none paints a wrong frame as Lossless: C1 every optimal-quality frame shows the grey `unchecked` mark
  beside "Optimal quality" (viewer.js:83); C2 a failed lossless check stays on the status line after a passing retry;
  C3 the overlay gives the exact frame the lossy series' Q/G/depth (also REDTEAM-DEMO); C4 pairOf admits a lossy
  depth > 10 without a cut, routed to WebCodecs without a probe; C5 ingest_coded.py accepts `--codec lossy` (TypeError).
* Standards: lab levers in product modules (av1.js's ~450-character docstring line), the demo's series made by a lab
  tool, `exact` naming both the digest verdict and the paired HTJ2K series, no node seam for C1–C3.
* Defaults: dav1d (623 KB WASM) preloaded on every AV1 page though WebCodecs is first (head.js:32), not measured.
* Run: controller.test.mjs 32/32, pair.test.mjs ok, av1.test.mjs pass, comment budget ok; no browser, no gate (docs only).
* Fixtures: none run; the demo's dbts_a1, dbts_b1, dbts_c1 are from one dataset; no ultrasound cine; 4-core host, no GPU.
* Owner decisions: whether the stored-form series stays admitted and in the demo list (C4, D2); whether dav1d is preloaded (D1).
