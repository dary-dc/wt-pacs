state: done
started: 2026-11-11T21:25Z
heartbeat: 2026-11-11T21:34Z
outputs: claude/clean-product 56bfc38f (docs/reviews/clean-product.md: fc3dd468, 56bfc38f; line file c3874913); no PR (#371 already merged by FREEZE-E2E)
## Resume
Done; nothing left. The review commits sit on claude/clean-product after its merge into claude/demo-fixes-2 (157b7109):
docs only, not in the demo commit; whoever next merges claude/clean-product (or cherry-picks the doc) carries them.
## Result
* No blocker: no fix made. Range d46811c6..c7c799e9, already in the demo commit 157b7109.
* Product unchanged: 7 client node test files pass on old and new trees; cargo test -p series-server on new, default
  127+6+1 and lab-levers 132+6+1. CI deploy job (check.mjs --url) green on #367's tip b196f009.
* Each change reverted is caught: decode flags -> av1.test.mjs 6 of 723 fail; viewer move -> crafted.mjs "?check not
  refused" and the web-image check; server flags -> check_telemetry_absent.sh names the 3 flags. Frame clock: removal
  and restore, trees equal; item 12 stays.
* Absence checks: old tree FAIL (web image ships 2 check modules; 3 lab flags in default binary), new tree OK.
  Pitfall: a CARGO_TARGET_DIR shared between worktrees passed the old tree wrongly; one target dir per tree.
* coordination.md §Decisions 11-04 rule corrected once, in place.
* For the owner: F1 the device kit's asksfirst arm (lab/devices/arms.json, D2) is refused by a default image built
  after this merge -> a lab-levers image or drop the arm; F2 ?check with a refused transport gives no result (300 s
  wait); F3 check.mjs --url Chromium only; F4 coordination.md §Unification 1 and §Open 4 still name archive tags;
  F5 dd2c3902's message reads as a revert but is the removal.
* Fixtures: one 4-core cloud host, no GPU, headless Chromium (SwiftShader); no full gate, demo-check, nginx or Firefox
  run here (CLEAN-PRODUCT and FREEZE-E2E ran gate and demo-check); nothing timed.
