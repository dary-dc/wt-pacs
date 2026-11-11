state: done
started: 2026-11-11T20:22Z
heartbeat: 2026-11-11T21:14Z
outputs: claude/demo-fixes-2 157b7109 (merge of claude/clean-product c7c799e9: the demo commit), b196f009 (docs/reviews/freeze-e2e.md, line file); PR #367 body's merge record updated; raw rows docs/queue/FREEZE-E2E-rows/
## Resume
Done; nothing left for this row. Owed outside it: CI on #367's tip (run 766 for 157b7109 sat queued 55 min; the push
of b196f009 starts a new run). PRE-DEMO checks the demo commit 157b7109 and that only docs moved after it.
## Result
* claude/clean-product (#371) merged --no-ff as 157b7109, clean (status done, gate green): the demo commit.
* demo-series.sh on it: 21 series, 542 s; fractions as FIX-2's; three sourceFingerprints x 7 series.
* README §Demo's check loop (18 series + 2 --refuse-webcodecs) x {page, worker}, interleaved by series: 40 of 40 passed.
* Full scripts/gate.sh on 157b7109: GATE OK in 588 s. Skipped: native painter/window, cross-codec + Firefox, nginx web-host
  check (not run apart after CLEAN-PRODUCT's web-image change).
* No failure, so no blocker and no fix. Record + rehearsal list: claude/demo-fixes-2:docs/reviews/freeze-e2e.md.
* CI on #367 at the tip: not yet run (queue backlog); CLEAN-PRODUCT's deploy job (check.mjs --url) is unverified in CI.
* Fixtures: dbts_a1/b1/c1, one dataset; no ultrasound cine; one 4-core cloud host, no GPU, headless Chromium on
  SwiftShader, loopback; one run per cell; correctness only, nothing timed; no phone.
* Owner: the two merge words (#367 into claude/core once its CI is green, then PR 250 into main, merge commits);
  CLEAN-PRODUCT's open items (item 11 yes = git revert 24b80bcd; item 16 workspace split).
