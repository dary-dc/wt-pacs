state: done
started: 2026-11-11T19:48Z
heartbeat: 2026-11-11T19:52Z
outputs: claude/merge-plan a3762217 (docs/reviews/merge-plan.md, docs/lines/coordination.md), no PR (docs only)
## Resume
Done. Nothing left for this row. Re-read §2's checks before each word; §5's script re-runs the ancestry.
## Result
* Order: word 1 #367 (claude/demo-fixes-2 d46811c6 into claude/core 2e6fa5b2; gate+deploy green on d46811c6), word 2
  #250 (claude/core into main 017a3ca6; its last CI, on 2e6fa5b2 of 10-30, has deploy red, superseded once word 1 moves it).
* main and claude/core are both ancestors of the tip, so neither word resolves anything; main ends with the tip's tree.
  main is not yet an ancestor of claude/core (#319, #322, #333): word 1 fixes that.
* Checks per word written (tip = FREEZE-E2E's demo commit, CI green on that head, absence steps in the log, main and
  core unchanged and inside the tip); PRE-DEMO after: git diff --quiet $DEMO origin/main, CI on main, README §Demo.
* At d46811c6: 304 remote branches, 239 open PRs. Carried in full: 76 branches, 63 PRs (listed); not: 221, 176 (listed
  with commits not carried and why). clean-product is carried only once FREEZE-E2E merges it.
* Keep base branches of uncarried PRs: av1-unified-mainbase (63 PRs), core (14), demo-fixes-2 (3), and 8 others (§4.1).
* Limits: one read of origin at 19:48-19:55 UTC; FREEZE-E2E not yet run, CLEAN-PRODUCT still started, so the tip moves
  once more; no gate run (docs only; check_links and check_personal_paths pass).
* Owner: the two words after FREEZE-E2E, each after §2's checks; then the closes and deletes of §4.1 after re-running
  §5 against main. #250's body still describes 10-30's core; whether to point it at #367's body is the owner's.
