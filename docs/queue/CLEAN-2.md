state: done
started: 2026-11-12T07:05Z
heartbeat: 2026-11-12T10:20Z
outputs: claude/clean-2 18f96938, draft PR #375 into claude/demo-fixes-2 (for after the core merge)
## Resume
Done. Taken by the session started for DIRECTION-COORD, which was already done. Nothing left for this row.
## Result
* S6 7b7ab20f: `build.sh --product` bundles session.js alone (product_test.sh). S3 0981aef0: scripts/demo-pair.sh,
  used by README §Demo's three blocks and demo-check.mjs (demo-pair_test.sh). S7: no lever removed (each is named by a
  check or rig); 603da24d a lab ?opts= can't turn the frame check off.
* DEFAULTS-FIND 2 (8b8aa3a3, ?check=cine) and 3 (5414aa1a, trace/settle/after gated); CLEAN-FIND §4 (215156f9), §7 (911a4781).
* Each behaviour change had a failing test first; mutants caught: 8 (named in PR #375).
* Gate OK 723 s (skipped: native painter/window, cross-codec + Firefox, nginx). demo-check 20 x {page, worker}: 40/40.
* Not checked again: README's phone blocks now go through the starter (they were checked before as three terminals).
* Fixtures: dbts_a1/b1/c1, one dataset; no ultrasound cine; one 4-core cloud host, no GPU, SwiftShader; nothing timed.
* For QUEUE-2W: a review row CLEAN-2-REVIEW (revert each change and watch its test fail; demo-check both views).
* Owner: whether UNIFY-CLIENT carries #375; CLEAN-FIND §5/§6 and S2/S4/S5 remain the owner's or their lines'.
