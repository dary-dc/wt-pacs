state: done
started: 2026-11-25T10:47Z
heartbeat: 2026-11-25T10:51Z
by: MxzjAKWN
outputs: claude/session-cost caa3cb219 (session-cost.md §Results in place, §Verdict fix 2; docs/lines/codecs.md; PR 441); docs/queue/SESSION-COST-RUN.md's Result corrected
## Resume
Done: caa3cb219 on claude/session-cost; SESSION-COST-RUN.md's Result on this branch. Nothing left.
Next row: SESSION-COST-VERDICT-FIX-2-REVIEW (a session that wrote none of session-cost.md's sections, this fix included).
## Result
Recomputed by my own script from claude/session-cost-rig 8dcc345f5's four counted row files (149 rows, 147 counted)
  and claude/transport-arms lab/transport-arms/rows/CLEAN.jsonl's eight counted H2-frame rows.
R-B1 fixed: CR dbts_a1 A x1.748 of CLEAN, missed on the reading used (x1.05-1.7), held per form; the other five reproduce.
r-m1 fixed: the view's rate 5.3-7.1 ms a wire MB (dbts_a1 A 7.14), x8.5, in both bullets and §Verdict fix.
r-n1 fixed (12.5 ms a MB); r-n2 fixed (-33.4 us; RSS floor 5.06 MB, also in SESSION-COST-RUN.md's Result).
r-n3 fixed and it moves one verdict: §5's 0.84 is ms a payload MB (107.4 = 111.6 wire / 1.039), and the rows' median
  is 100 ms not 90 (ticks 10,10,10,10,10,9,10,10): HTTP/2 0.81-0.90 ms a wire MB. CR dbts_a1 A's x13.9-15.5 straddles
  the x14.6 saved: "not shown", not "not met". Every CLEAN verdict stands (dbts_a1 A clears; dbts_c1 A a tie; dbts_b1 FIT not).
  §5's pre-registered text left; whether its 90 ms was meant is for the re-review.
Fixtures and limits: recomputation only (dbts_a1, dbts_b1, dbts_c1 of one dataset; usb_cine lossy-sourced, a function
  check; one 4-core cloud host, headless Chromium 158, software decode; userspace relay CLEAN and CR); nothing rerun;
  HTTP/2's rate is theory from claude/transport-arms' CLEAN rows at 10 ms tick resolution. Docs only: check_links 0 unresolved; gate not run.
No owner decision.
