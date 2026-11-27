state: done
started: 2026-11-27T08:06Z
heartbeat: 2026-11-27T08:09Z
by: FimimUMf
outputs: draft PR 450 (claude/eval-release -> main, head 1fdb51eb7, body at be9f4eca8); docs/lines/release.md 1fdb51eb7
## Resume
2026-11-27T08:09Z: done. PR 450 opened, line doc pushed. Nothing to continue.
2026-11-27T08:08Z: inputs read (final-state §2 §5, eval-release.md §Review, PR 449, CI run 45951852991 on be9f4eca8: GATE OK 882 s, job failed on the unlisted skip "the pair's invariants"). Next: open the draft PR with the body (scratchpad eval-pr-body.md).
2026-11-27T08:06Z: claimed. Next: read final-state.md §2 §5, README §Purpose, the eval-release review, LAB-REMOVAL's PR, the gate's last run; write the body; open the draft PR with mcp__github__create_pull_request (head claude/eval-release, base main).
## Result
* Draft PR 450, `claude/eval-release` -> `main`, "evaluation release candidate: the owner's review". Nothing merged.
* `final-state.md` §5 at `be9f4eca8`: 1 met (README §Purpose); 2 met as a function check (CI: usb_cine 64,
  usb_cine_rgb 64, dbts_a1 56 exact in the page and view worker; lossy-sourced US); 3 met only in the reworded form
  (`docs/defaults.md`); 4 not met (411, 412, 424 and PR 449 open); 5 not met; 6 met for phase 2's merges; 7 not checked.
* Gate's last run: CI 45951852991 on `be9f4eca8`, GATE OK in 882 s, but the job FAILED on the unlisted skip "the
  pair's invariants: no writer to hold them against"; the same on `claude/unified` `b86f69ee3`. Deploy job passed.
* Carried: phase 2's 33 PRs (UNIFIED-SYNC-1124/-1125/-1126), listed in the body; not carried: 438, 420, 411, 412, 424,
  406, 408, 404, 405, 409. Open into it: PR 449 (LAB-REMOVAL). EVAL-RELEASE-REVIEW's m4 (PR 426's minors) taken by no commit.
* Line doc: `docs/lines/release.md` on `claude/eval-release` `1fdb51eb7`.
* Fixtures and limits: no measurement; the gate's fixtures on one hosted runner, headless Chromium (SwiftShader);
  conditions 6 and 7 read from merge messages and pages, not re-derived.
* For the owner (BRIEF-WEEKEND's table): condition 5's skip (allow it with its reason, or give the step a writer);
  `unified-to-main` items 1 and 4; condition 3's rewording; PR 450 itself.
