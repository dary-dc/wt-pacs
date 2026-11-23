state: done
started: 2026-11-23T01:07Z
heartbeat: 2026-11-23T01:11Z
outputs: claude/reviews-2026-11-28 164864df8 (docs/decisions/final-state.md, its §Fix; the index line of docs/decisions/README.md; docs/lines/coordination.md); PR 405, no new PR
## Resume
Done. Next: FINAL-STATE-FIX-REVIEW (a session that wrote none of the page, its review or this fix), in the page's §Re-review.
## Result
Docs only; nothing run; the gate not run. check_links: the same 13 unresolved before and after (none in the changed
files); comment budget ok. Fixtures: none used.
* B1: *evaluation release* is a row of §3: no official definition found (searched 2026-11-23); vendor practice
  (S17, a fully functional time-limited evaluation version) and the regulations' clinical *evaluation* (S18, MDR and
  IVDR Art. 2(44)) quoted; DICOM's A-RELEASE (S15, PS3.8 §7.2) judged harmless. T1, T2 yes; T3, T4 no; T5 weak.
  §2 (theory): keep it as the release's name, *bench-verified* as its state; the status line says "for technical
  evaluation". §7 names what a replacement renames (phase 2's heading, claude/eval-release, its PR title).
* B2: the yes prints the status line only once UNIFIED-PAGE finds §5's seven conditions met; until then it states
  each unmet condition.
* m1 condition 5 allows the CI workflow's listed skip; m2 docs/reviews/understand/defaults.md named as the table's
  starting point; m3 *bench* judged under T5 (§6); m4 S10 by fetch date; m5 TRL placement labelled theory; m6
  condition 1 points at PR 432.
Owner: the yes or no on both names waits for FINAL-STATE-FIX-REVIEW.
