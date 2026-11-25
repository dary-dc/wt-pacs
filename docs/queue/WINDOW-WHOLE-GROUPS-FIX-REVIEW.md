state: done
started: 2026-11-25T07:47Z
heartbeat: 2026-11-25T07:55Z
by: uHPua84B
outputs: claude/work-ledger 70066d01b: docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/findings.md §Re-review, entries.mjs; reviewed claude/window-whole-groups 0e273ee92 (PR 446)
## Resume
Done. Next: WINDOW-WHOLE-GROUPS-MEASURE-2 (a session that built none of PR 446).
## Result
* B1 closed: the rocking test fails with e8a52cfe4's controller.js (11|12 at W = 15, 48 frames) and passes on 0e273ee92; controller.test.mjs 47/47; mutants M7, M8, M11 and a new M13 (half-frame rank) each fail it. The rank-margin argument checked (theory), with the tie's case (r-n1).
* m1 closed: dbts_c1's shape (W = 54 over 69) in the test.
* r-m1 (minor): the cost is backward only: forward entries unchanged, backward one frame later (W = 15: lead 4 → 3); derived from wantFrom (entries.mjs). The PR body and what-a-view-asks-for.md say "on a pass"; two-line doc fix, not built.
* r-m2 (minor, trade-off): a two-frame rock still refetches, 10 of 96 starts at W = 15, 8 of 96 at W = 24, worst 48 frames in six steps (measured, the test's harness); a wider margin costs only the backward lead. For MEASURE-2 (time the backward edge too) and BRIEF-WEEKEND.
* Gate not rerun (no code changed; the fix's full gate GATE OK 782 s at 0e273ee92 stands); comment budget ok, check_links 0 unresolved.
* Fixtures and limits: synthetic 1x1 frames (50, 69; G 8, 16), stand-in transport and decoders, frames counted, no time, link, browser, DBT volume or US clip; IMPROVE-1-REVIEW not run.
* No owner decision.
