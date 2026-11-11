state: done
started: 2026-11-11 01:35
heartbeat: 2026-11-11 03:05
outputs: claude/av1-corrections 0bb65c3f, draft PR #357 into main
## Resume
Done. Commits 2e4efdfc (corrections, codecs line in place), 0bb65c3f (protocols, pointers). Line file:
docs/lines/codecs.md on the branch (Last verified 2026-11-11, Open 00).
## Result
* main's docs/lines/codecs.md corrected in place: bytes at the rule's Q 0.10–0.28 (not Q 8's 0.07–0.22); view's
  WebCodecs decode at Q 8 ~1.55–1.81 HTJ2K frames (not "1.05–2.04"); the bar (1.00 / 1.03) stated; "a higher Q does
  not" withdrawn; "G saves almost nothing" marked an equal-Q reading; σ named by estimator.
* docs/av1/corrections.md: for 12 study branches, each passage quoted as it stands (branch:file:line@commit) with the
  text to put in its place, incl. noise point's top Verdict (held-out test done, bar 1.03, x* 4.8 ± 0.15).
  Not applied on those branches (this row pushes only its own).
* docs/av1/audit-protocols.md, theory only: A noise kept (ν at the rule's Q, 19 DBT volumes); B one bar at the
  estimator's resolution (split-half + injected noise → δ, anchor as [Q_lo, Q_hi] at integer Q, G 16 at equal worst
  frame; shares A's 341 cells, ~3–4 h on 4 cores); C decode on the product's HTJ2K unit, 6 arms, 1×/4×/4× cores 1, 2
  (~2–3 h). F3 (alt-ref) is groups §Settings amendment S2, pointed to, not repeated.
* Derived in A's theory from groups shard 1 (dbts_b1): at the noise anchor ν 0.218 → ~98 % of the fine-band noise
  removed; the "error" there is the deleted noise.
* Fixtures: 19 EA1141 DBT volumes (3 timed), no breast US cine/ABUS, 4-core hosts without GPU.
* Gate: check_links 0 unresolved, comment_budget passes; full gate not run (prerequisites unbuilt; docs only).
* Owner decisions: apply each branch's entry of corrections.md (one docs session per branch?); the bar 1.00 vs 1.03
  stays the owner's (harvest Open 0 decision 1), B gives δ to decide it on.
