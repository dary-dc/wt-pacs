state: done
started: 2026-11-24T12:07Z
heartbeat: 2026-11-24T12:13Z
by: kBZoiq7P
outputs: claude/reviews-2026-11-28 a37c9e960 (docs/decisions/lab-list.md §Re-read; README index line; docs/lines/coordination.md)
## Resume
Done. Nothing left.
## Result
Each of lab-list.md's 47 directories re-read against every owed run (pages, phase 2 rows and protocols, the held
list), read not run, on origin/claude/unified b059388b6 and claude/eval-release e0dd6d4fb; gate_trace.py rerun:
the gate still reads none of the 47.
* Kept, an owed run names it (6): paint-floor (client-calls item 5's GPU run), htj2k-tiles (FIT against S*;
  TILES-STEP), faultbench (page-runs §6.4; report-arms loads its decoder), proposals (page-runs §6.3, R5's harness),
  decode-bench (RESLEVEL's prefix.mjs, which FIT-ARM-BUILD uses, imports it), native-window (native's GPU-desktop run, held).
* Kept as harness, kept code runs it (5): downloader-cost, loss-class, stream-shape, session-survival, traces.
* Removed (36, 18 059 code lines): listed in §Re-read, with the four code comments LAB-REMOVAL repoints and the
  claude/htj2k-progressive branch the tiles' level binding reads.
Limits: a static trace; a path built from parts at run time would be missed; run branches read at 11:30 UTC.
Owner: the archive tag (lab-list §For the owner) against LAB-REMOVAL's brief (no tag) is decided by the yes to
unified-to-main item 4.
