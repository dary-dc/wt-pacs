state: done
started: 2026-11-23T02:07Z
heartbeat: 2026-11-23T02:12Z
outputs: claude/reviews-2026-11-28 dfea0706d (docs/decisions/unified-to-main.md; the index line of docs/decisions/README.md; docs/lines/coordination.md); PR 405, no new PR
## Resume
Done. No rows appended: the page names the rows PHASE2-PLAN should queue (§8).
## Result
Read from pushed results and GitHub; one test merge run, nothing else; the gate not run; check_links 13 unresolved as
before, none in the changed files; comment budget ok. Fixtures: one tree, origin/claude/unified 4a2b4277f, and 20
branches merged onto it in sequence (no build, no gate on the merged tree).
* Track order measured: 415, 416, 428, 432, 412, 411, 423 clean in sequence; 424, 425, 427, 433, 410 conflict only in
  docs/lines/*.md; outside the track 419 conflicts with 418 in client/viewer/demo-check.mjs.
* 433 waits on its review, 410 on ENGINES-PATH-FIX; M6: 376 and 390 already carried, 368 and 378 to port (368
  provisional on the owner's 02:00 word about unchecked hardware view frames), 370, 309, 265, 372 left open.
* Seven conditions at the tip: 1, 2, 3, 5 not met, 4 partly, 6 met for the track, 7 not checked. merge-readiness.md's
  "any address" hole no longer stands (read): lab levers refused off the dev host, CSP default-src 'self'; script-src
  keeps 'unsafe-eval'.
* lab-list's "behind an archive tag" contradicts coordination §Decisions (recovered from history, no tag): the page
  recommends no tag.
* For PHASE2-PLAN: ports of 368 and 378, DEFAULTS-TABLE, US-END-TO-END, GATE-ON-UNIFIED, LAB-REMOVE, the audit item 8
  list, the twelve commits dd681539d left (PR 433's body), 424's lock check, --advise-tile-names removed, the ingest's
  OpenJPH bump.
Owner: six yes-or-no calls, unified-to-main.md §2; first, whether rule 1 also merges the removals and 424.
