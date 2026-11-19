state: done (four blockers open; amendment 17 rows PROGRAM-PLAN-FIX and -FIX-REVIEW appended to the client queue)
started: 2026-11-19T02:17Z
heartbeat: 2026-11-19T02:23Z
outputs: `claude/work-ledger` at `3a8e16be`: `docs/queue-2026-11-14.md` §Program review; the two FIX rows in
`docs/queue-client-2026-11-14.md`; `docs/lines/coordination.md` §Open 9 (no PR: the ledger only)

## Resume

Done. Next: PROGRAM-PLAN-FIX (client queue), by a session that wrote neither the program nor this review.

## Result

* Read only, against `19e211d3`: nothing run, the gate not run (ledger files); `scripts/check_links.py` adds no
  unresolved path (451 before and after, all pre-existing on the ledger).
* Passes: Fable one a day (eight days), no own review, every inventory row in a page or held, every input file
  and named branch present, every date before the close.
* B1: no worker takes the program's rows (the client queue's procedure is "this file's rows only").
* B2: DOCS-SYNC's selection admits `claude/work-ledger` and the "do not merge" decision-pages branch.
* B3: HTJ2K-A1-RUN's arm D+T1 is not built (`stage3/run.mjs:28` knows D, D′, D+T3, D+L★, S★).
* B4: DECISION-PAGES-REVIEW and PROGRAM-CLOSE start before their inputs.
* Seven minors (inventory gaps: audit item 9, item 8's second half, codecs §Open 9 and six others; two wrong
  pointers; three pages sharing their input's latest; the WebGPU painter's page; DOCS-SYNC blocked by the worker's
  own rules).
* Owner: B1's fix lets the scheduled client-queue worker take the program's rows; a separate routine would do too.
