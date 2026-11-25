state: done
started: 2026-11-25T06:47Z
heartbeat: 2026-11-25T07:29Z
by: 9QsWqffZ
outputs: claude/window-whole-groups 0e273ee92 (test 892a60ae6, fix f8fd65184, docs 26b4b6a98 and 0e273ee92), PR 446 (body: the measure's findings copied, §WINDOW-WHOLE-GROUPS-FIX)
## Resume
Done. Next is WINDOW-WHOLE-GROUPS-FIX-REVIEW (a session that wrote none of PR 446, its measure or this fix), then WINDOW-WHOLE-GROUPS-MEASURE-2.
## Result
* B1 closed: a group the last want named ranks one frame nearer (controller.js nearestGroups, the controller keeps the last want's groups); a one-frame step back and forth changes no group (theory: one step moves two distances apart by at most 2).
* Test first (892a60ae6): every adjacent pair rocked from either side, W 15/24 over 50 and W 54 over 69 (dbts_c1's six groups), G 8; fails on e8a52cfe4 at 11|12 (48 frames), passes after.
* Measured by hand: G 16 at W 40/48 and five more shapes, no frame twice; the passes kept (34/40, 26/32, 48/48; G 1 35/35). Mutants M7, M8, M11 fail the test; M9, M10 survived, so those terms were cut.
* m1 closed: the test carries dbts_c1's shape; PR 446's limits line corrected.
* Residual (measured, by hand): a two-frame rock (x|x+2) still refetches, 22 pairs at W 15/24; a wider margin trades the pass's lead (one frame later per margin frame); not built, named for the review and MEASURE-2.
* Gate: full gate OK in 782 s at 0e273ee92 (decoders' rebuild and absence checks included; skips named in PR 446); the rocking test takes 56 s of it.
* Fixtures and limits: synthetic 1x1 frames (50, 64, 69; G 8 and 16), stand-in transport and decoders; frames only, no time, link or browser beyond the gate; no DBT volume or US clip opened; IMPROVE-1-REVIEW not run.
* No owner decision.
