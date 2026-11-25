state: done
started: 2026-11-25T11:07Z
heartbeat: 2026-11-25T11:14Z
by: d7sLTNPR
outputs: claude/work-ledger cb50b5abd (docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/findings.md §Re-review 2; reach.mjs, reach-repeat.mjs); PR 446 reviewed at 94d447835
## Resume
Done. Next: WINDOW-WHOLE-GROUPS-MEASURE-3 (steps.mjs's cells on 94d447835 against the tip, by a session that built none of PR 446). docs/lines/client.md on claude/window-whole-groups not updated: this session's push to PR 446's branch was refused; the line's next writer adds "re-reviewed 2026-11-25, no blocker open (findings.md §Re-review 2)".
## Result
* §Timed cells B1 closed in the count: the new test fails with 0e273ee92's controller.js ("frame 7 ... 3 steps"), passes on 94d447835; window.test 4/4 (58 s), controller 47/47.
* The test is not vacuous: all five group ends checked, each exactly 7 steps ahead (a probe).
* toward.mjs reproduces §FIX-2's derived table on both commits, every cell.
* Invariant checked (reach.mjs, measured over every reachable state, 6 shapes, steps and jumps): the current frame is always first in the want; the want is stable when recomputed.
* Own mutants: MF (a rock keeps the direction) caught by the sawtooth test; MA (guard dropped, equivalent), MB (wrap only), MC (fillSize, progress only), ME (bonus G − 1, lead 7 either way) survive, each argued.
* Nits: r2-n1 redundant toward !== 0 guard; r2-n2 two-step direction lapse at a cine wrap (harmless); r2-n3 "wanted on entering a group" holds forward only, backward one frame in (lead G − 1).
* check_links 0 unresolved, comment budget ok; gate not rerun (FIX-2's full gate at 94d447835 stands; no code changed here).
* Fixtures and limits: synthetic 1×1 series of 20–69, G 8 and 16, stand-in transport and decoders; wantFrom alone for the derived and reach checks; no time, no link bytes, no browser, no DBT or ultrasound fixture opened.
* Verdict: no blocker open; MEASURE-3 may run. No owner decision.
