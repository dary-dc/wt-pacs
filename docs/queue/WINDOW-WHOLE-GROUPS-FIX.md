state: started
started: 2026-11-25T06:47Z
heartbeat: 2026-11-25T06:59Z
by: 9QsWqffZ
outputs: claude/window-whole-groups (PR 446): test 892a60ae6; fix pending
## Resume
Pushed: 892a60ae6, the rocking test (every adjacent pair, both directions, W 15/24 over 50 and W 54 over 69, G 8), failing on e8a52cfe4 at 11|12 (48 frames).
Next: commit the fix in client/view/controller.js (a wanted group ranks one frame nearer; the controller keeps the last want's groups); mutants M7, M8, M11 fail the test; M9/M10 (tie and own-first terms) survive, so cut.
Then: docs (what-a-view-asks-for.md *M, the budget*, docs/lines/client.md), scripts/gate.sh, PR 446 body section (findings.md copied in), status done.
Commands: cd <worktree of claude/window-whole-groups>; node client/view/window.test.mjs; node client/view/controller.test.mjs; scripts/gate.sh
## Result
