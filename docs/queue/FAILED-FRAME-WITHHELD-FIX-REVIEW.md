state: done
started: 2026-11-24T05:18Z
heartbeat: 2026-11-24T05:37Z
outputs: PR 438 body §Re-review; claude/failed-frame-withheld 18b739b17 (docs/lines/client.md); docs/queue-2026-11-24.md (FIX-2 rows appended, 0f13ce1fd)
## Resume
Done. Next row: FAILED-FRAME-WITHHELD-FIX-2 (a session that wrote none of PR 438, its review, its fix or this re-review), then FAILED-FRAME-WITHHELD-FIX-2-REVIEW.
## Result
Reviewed 41dfb1cc6 against c319d4035. Each new test fails on 45f2c98c0^'s code (5 checks over downloader, consumer, controller); the four commits touch only their named files; m2 closed, m1 closed as named untested.
B1 open in part (blocker): a command's own re-dial in downloader.js live() (ask, fill, want after a closure) that fails posts failed with lost:false (measured, a scratch run on the test's fake transport), so Controller.refused withholds those frames at once, including window misses never asked; against docs/client/design.md §Decided ("or its own re-dial failed").
m1: resume()'s wanted loop untested (my mutant R6 survives); m2: the page view's stepped-away guard untested (R1 survives); mutants R2-R5 killed. n1: N wants after a failed resume; n2: the first loss's failed emit.
Gate: scripts/gate.sh --quick at 41dfb1cc6 green (631 s), skips named in PR 438; absence checks by hand, pass.
Fixtures and limits: node unit tests and one scratch script; no browser run of a lost or withheld frame; B1's consequences past the downloader message read in code.
Amendment 17 round two: FAILED-FRAME-WITHHELD-FIX-2 and -FIX-2-REVIEW appended; PR 438 does not merge before them.
