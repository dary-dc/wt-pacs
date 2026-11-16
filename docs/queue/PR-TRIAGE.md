state: done
started: 2026-11-16T05:41Z
heartbeat: 2026-11-16T05:46Z
outputs: claude/work-ledger:docs/queue/PR-TRIAGE-report.md; raw table and script in docs/queue/PR-TRIAGE/; claude/unified 21c8eec4 (docs/lines/coordination.md Open 8)
## Resume
Done. Nothing closed or commented on GitHub (closing is the owner's).
## Result
269 open PRs (not 264) against claude/unified 9749ac85, by ancestry of each PR head, then the plan, M1-M9 and row status files:
* Carried 241: 237 to close ("landed in claude/unified, PR 402"); 398, 399, 401 with M8's swap; 402 is the review vehicle.
* Only PR 37 is an ancestor solely through an -s ours merge (12 such merges grafted away): listed superseded.
* Later pass owed, docs only, rows done: 384, 392, 359, 396, 397. No row merges them yet.
* Needs a fix first: 368 (six findings), 394 (CACHE-FIX-REVIEW N1), 395 (REPORT-BUILD-FIX, first round), 400 (RUNNER-AUTO blocker 2).
* Proposals: 370 (the report study decides), 378, 372, 309, 265 (M6), 96 (M3), 193 214 215 255 297 300 (M5, viewer).
* Superseded 7: 37, 39, 40, 303, 205, 217, 257.
Limits: ancestry joins history, not every hunk (M2/M4 code resolved to the tip by decision); one read of origin at 05:45 UTC.
Owner: close the 237 and the 7; append a LATER-PASS row; third fix rounds for 394 and 400; M6, M3, M5 per the report's table.
