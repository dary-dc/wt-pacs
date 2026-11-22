state: done
started: 2026-11-22T12:47Z
heartbeat: 2026-11-22T12:56Z
outputs: claude/vl-criterion 35891360 (lab/av1/metrics/vl_reads.py, rows/vl-reads.json), 4accfdb3 (docs/av1/vl-criterion.md §5.1, docs/lines/codecs.md §Open 15); PR 420 body §VL-READS
## Resume
Done. Next: VL-PAGE (needs VL-READS done), by a session that ran none of the question's rows.
## Result
R1-R9 of vl-criterion.md §5 run as written on the committed rows; nothing encoded or decoded. Measured.
* Hold: R2 (k 0.78-0.93, r_q 0.28-0.45 at the rule's Q), R3 (white error wherever x <= 2, 175 cells; w_N 0.77-0.87 at the rule's Q on 19 of 19): C and D stand as derived bounds.
* Missed, not refuted: R1 (nu resolves the anchor to one Q on 15 of 19, predicted 17; r: 4), R4 (L 0.781 on dbts_b3, b4 > 0.75; none >= 1), R7 (68 % of 145 cells; model fits from x 4, over-predicts r below).
* Refuted: R5 (dbts_c1 G 1 Q 8 R 1.089 > 1.08; the window matters on every cell read), R6 (r, nu not a function of x alone within a volume), R8 (dbts_b2 0.594 > 0.55 at x <= 2; x <= 1 holds, 0.48-0.77), R9 (Q 8 ratio 20.7-37.5 on 12-bit, 11.9-29.4 on 10-bit; does not split by depth).
* Mutant (qindex 2Q for 4Q) killed; model reproduces §1.1's tables; check_links 0 unresolved, comment budget ok; gate not run (a lab reader no gate step exercises, and docs). The branch now has lab/ paths (no longer docs-only).
Fixtures: 19 DBT volumes of one dataset (EA1141), stored form, libaom 3.15.1 speed 6, one cloud host; no second vendor, phone, display or reader.
* Owner: nothing.
