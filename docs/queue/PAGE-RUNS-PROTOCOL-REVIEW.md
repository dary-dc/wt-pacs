state: done
started: 2026-11-24T13:47Z
heartbeat: 2026-11-24T13:52Z
by: zujMkyvD
outputs: claude/page-runs 9c752355f (docs/reviews/page-runs.md §Review; docs/lines/coordination.md); no PR (findings-only row)
## Resume
Done. PAGE-RUNS-PROTOCOL-FIX and -FIX-REVIEW appended to docs/queue-2026-11-24.md; TRANSPORT-FLAGS-RUN and
REPORT-RERUNS wait on the re-review, ENGINE-CELLS, ASK-CELLS and CACHE-CELLS on the fix.
## Result
Two blockers, seven minors; nothing run but git reads and one binomial sum; gate not run (docs; check_links 0 new).
B1 §1 says its rows answer #39 and #96, but #39's lever (per-frame-asks-first + 6 MiB window, row 211) and #96's
  (--fill-resumes-after-asks) are not arms; per-frame-asks-first is already in the rig's lab-levers build: add WT-AF.
B2 §2(b): D5a on a busy page is not built (the rig kills at a fixed 50 ms, busy only for Lbusy), and with Lbusy's
  measured shape and a 0-50 ms kill ~13.5/18 are delivered (derived), not 4-14: the band misreads 31 % of outcomes.
m1 per-frame streams are ranked by ask order (link.rs), row 180 measured per-frame tying shared; m2 the AD cell runs
  both forms; m3 TW's theory predicts a tie, its band reaches the deciding x0.80; m4 M5's 7 rounds of 6 arms not a
  whole period, band/refutation gap, per-round bar; m5 P1b 10 rounds of 4 arms; m6 cache's 20 MiB unlabelled; m7 3a
  has no order or VOID rule. Coverage complete; IDB's exclusion from §5 holds (cache item 2's reason).
Fixtures: 19 DBT volumes (three timed), lossy-sourced US only; 4-core cloud, no GPU; a relay, not a radio.
