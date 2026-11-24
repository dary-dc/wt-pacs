state: done
started: 2026-11-24T09:07Z
heartbeat: 2026-11-24T09:26Z
by: QtSC4kky
outputs: PR 438 body §Re-review 2; claude/failed-frame-withheld 56338a602 (docs/lines/client.md)
## Resume
Done. PR 438 has no blocker open; a sync row merges it only after its branch takes origin/claude/unified's side of the three conflicted files and the gate passes on the merged tree.
## Result
Reviewed eed7ebe0f against 18b739b17: five files, the four commits named, nothing else touched; the three test files pass (controller 44/44).
R-B1 closed: DialError marks a command's own failed re-dial lost; mutants K0 (fix reverted), K1 (ask only), K2 (want only), K4 (lost:false posted) killed. m1 (R6) and m2 (R1) closed: both killed.
D3 survives, equivalent as argued (askFor, addToFill, setWant, wholeGroups neither throw nor await).
r2-m1 (minor): again()'s failed re-dial after a decoder loss still withholds at once; K5 survives, no test. r2-m2 (minor): a fill's own failed re-dial untested; K3 survives.
Merge: PR 438 is dirty against claude/unified b059388b6 (git merge-tree): conflicts in client/view/controller.js, client/viewer/viewer.js, docs/lines/client.md (PR 435's budget, the at()->now() rename). A scratch resolution passes every client unit test (not committed, no gate on it).
Gate: scripts/gate.sh --quick at eed7ebe0f, GATE OK in 659 s; skips named in PR 438; the three absence checks by hand pass.
Fixtures and limits: node unit tests on fake transports and the controller rig, mutants by hand; no browser run of a lost or withheld frame.
Verdict: no blocker open. For BRIEF-WEEKEND's list: no row of this file brings claude/failed-frame-withheld up to claude/unified, so UNIFIED-SYNC-1125 will skip PR 438 as a code conflict unless one is added.
