state: done
started: 2026-11-13T16:15Z
heartbeat: 2026-11-13T16:55Z
outputs: claude/proposals 008728a2, 5b4c3341 (docs/lines/proposals.md §Consolidated, §R5 Measured); PR #358 (draft, claude/proposals → main; title and body updated, no new PR: it is this branch's PR into main)
## Resume
Done. Nothing unpushed, nothing running.
## Result
* §Consolidated: one table of 26 entries: P1–P6, R4, I1–I3, S1–S8, FS (PR 366), FD1–3 (PR 383), HTJ2K H1–H3 (PR 324),
  host networking, PRs 376/378 fixes, telemetry (PR 370). Each entry has its evidence, verdict, deciding measurement and next step.
* Holds or meets in its cells: P1 (random loss; R2's jump during the fill 0.08–0.09×), P3 plumbing, P6 (c) (rules 1, 2).
  Not ready: P2 tiles (max |Δ| on one series, under one code step). Withdrawn: P4, R4, P5, HTJ2K S★.
* §R5 Measured written up from r5-summary.txt (MEASURE-2 pushed rows, no section). Correction: P6's rule (3) is not
  met by its letter in 6 of 9 rounds (failing frames differ by 1–5 between arms, and (a) varies alike across rounds);
  MEASURE-2's "same missing frames in every arm" is corrected in place.
* Next wave (not in docs/queue-2026-11-14.md): P6-RULE3, HTJ2K-A1, BBR-IW-READ, TILES-STEP.
* Fixtures: three DBT volumes of one dataset; 4-core cloud host, no GPU; relay/netem, not a radio; phone entries one
  phone, one home link, one evening. Nothing rerun; check_links 0 unresolved; gate not run (docs only).
* Owner: whether to add the next wave to the 11-14 queue; build P6 (c); FD1/FD2 as build rows; PR 378's retry scope.
