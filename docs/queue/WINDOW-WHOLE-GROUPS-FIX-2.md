state: done
started: 2026-11-25T10:27Z
heartbeat: 2026-11-25T11:03Z
by: SENUUsXL
outputs: claude/window-whole-groups 94d447835 (PR 446: test d0b7adeb8, fix 4bfc75247, docs 94d447835; body §WINDOW-WHOLE-GROUPS-FIX-2); claude/work-ledger docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/findings.md §FIX-2, toward.mjs
## Resume
Done. Next: WINDOW-WHOLE-GROUPS-FIX-2-REVIEW (a session that wrote none of PR 446, its measures, fixes or reviews), then
WINDOW-WHOLE-GROUPS-MEASURE-3 (steps.mjs's cells on 94d447835 against the tip).
## Result
* §Timed cells B1: the neighbour group is the one the reader moves toward (a step's sign once two steps agree, else 0; a rock sets none), ranked a whole group nearer. r-m2's margin cannot hold: with two groups it shortens the backward lead (derived).
* Test d0b7adeb8 (backward pass, W 15, G 8: each group's last frame on the wire >= G - 1 steps ahead) fails on 0e273ee92 (lead 3), passes on 4bfc75247; rocking test kept; window.test 4/4, controller 47/47. Mutants M14-M18 each caught (M17 by the sawtooth test).
* Derived (toward.mjs, wantFrom alone): W 15 G 8 forward lead 4 -> 8, backward 3 -> 7; G 16 W 40 8 -> 16, 7 -> 15; three groups or more unchanged (W 24 backward 7 -> 8).
* Cost (derived): a reader turning back p <= 3 frames into a group finds the group behind let go, asked p steps ahead (before: held); p >= 5 better. Memory unchanged. Time: MEASURE-3's.
* Gate: full, GATE OK in 937 s on 94d447835 (skips: pair invariants, native painter and window, cross-codec arm and Firefox, nginx); check_links 0 unresolved, comment budget ok.
* PR 446 is dirty against claude/unified in docs/lines/client.md only (git merge-tree): a sync row's line-doc resolution.
* Fixtures and limits: synthetic 1x1 series of 50 and 69, G 8 and 16, stand-in transport and decoders, each miss delivered before the next step; frames and steps, no time, no bytes on a link, no browser beyond the gate; no DBT volume or ultrasound clip opened; two-frame rocks not re-counted.
* No owner decision.
