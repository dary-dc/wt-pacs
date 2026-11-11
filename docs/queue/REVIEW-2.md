state: done
started: 2026-11-11T16:25Z
heartbeat: 2026-11-11T16:34Z
outputs: claude/demo-review-2 af917401 (from claude/demo-fixes-1 daee0d1d): docs/reviews/review-2.md, docs/lines/optimal-quality.md; no PR (findings only)
## Resume
Done. Nothing to resume. Commits e084d574 (§1), 3f0e2266 (§2), 30839f60 (§3), af8c646c and 757dfcd4 (§4, §5), af917401 (§3.1, summary, line file).
## Result
* FIX-1 (#363): each of its 10 fixes was reverted on its own at daee0d1d, and each failed the test that names its
  finding (C5 through lossy_test's subprocess only; S1 is a comment).
* SOURCE-FINGERPRINT (#364): checkPair, and the ingest in Python and in Rust, each reverted, fail their tests
  (lossy_test, end_to_end_test, same_test, with the coders built). Four mutants were killed. One mutant survives
  lossy_test alone and is killed by end_to_end_test.
* DEMO-UX (#365): changes 1-4 reverted or mutated, each fails its node test; the decoders' restore is byte-identical.
* claude/demo-clean: all 9 removed items are byte-identical at the commits named; no reference left; check_links 0.
* Docs vs rows: the 20 series' byte fractions, E2E-3's counts and the phone bytes all hold.
* Findings, none of correctness: D1 (the line file's Lossless 3-6 s omits the jitter cells' 16-17 s), F1 (pocgap.py
  still writes framesSha256, unnamed in #364), U1 (refuseWebCodecs, a lab lever in av1.js reachable by ?opts=),
  U2 (the tap is checked only in emulation), C1 (no demo-check.mjs on demo-clean's removals).
* Not run: any browser check, the full gate, any demo series. Fixtures: the tests' synthetic sets only; no
  dbts_a1/b1/c1 run (one dataset, no ultrasound cine); one 4-core cloud host, no GPU.
* Claimed at 16:25, 5 minutes before the row's not-before (FIX-1 was done).
* Owner: U1, whether the lever stays until the levers refactor (EXPERIMENTS-OFF 13); C1, run demo-check.mjs on any
  demo-clean yes before FREEZE-E2E.
