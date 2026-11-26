state: done
started: 2026-11-26T09:07Z
heartbeat: 2026-11-26T09:09Z
by: erkuV3MF
outputs: claude/delivery 340968a91..54248cc51 (docs/client/evidence/delivery-comparison.md §Results 2 in place; docs/lines/client.md); PR 406, no new PR; docs/queue/DELIVERY-RUN-2.md's Result on claude/work-ledger
## Resume
Done. Next: DELIVERY-VERDICT-2-FIX-REVIEW (a session that wrote none of the protocol, the run, §Verdict review 2 or this fix), findings in §Verdict review 2 §Re-review.
## Result
Corrected in place in §Results 2, each marked "corrected 2026-11-26, §Verdict review 2"; nothing else in the file changed (one hunk).
B1: the lossy bullet and the carry paragraph carry no LTE view fill (four of the five holds are regime misses, the fifth, A dbts_b1, predicted near); LTE shows the curve's wire term for the views' bytes, dial → last byte ×0.91–1.13 (recount2.txt WIRE). "Where the link binds": A on CR and LOSS; on LTE the view sits at this host's crossover, neither side said.
B2: LOSS dbts_a1/c1's misses low put on the one-group decode term (§4.1's W(B) + 8 d1 at K2's 54.4/57.2 ms against 34–38 ms a frame decoded on arrival), the curve's wire held (A, A′, C1 ×1.06–1.24; SPLIT ×0.91–0.98, which the review's "every view arm" did not separate); LOSS dbts_b1: the curve's 4.31 s, not 6.1 s (6.10 s = 4.31 + 1.79 s decode), wire 1.98 s (A; the old 2.09 s was A's fill), decode 114–118 ms against d1's 223.5.
m1: LTE dbts_c1's C1 a miss in band (9/10), not "cannot hold". m2: nothing to fix, as the review says.
DELIVERY-RUN-2.md's Result and docs/lines/client.md to match.
Fixtures and limits: as §Results 2 — dbts_a1, dbts_b1, dbts_c1 (one dataset), view Q 8 G 8, no ultrasound; one 4-core container, software decode, Chromium 158 headless; TUN relay ≤ 90 Mbit/s, scaled forms, no radio. Numbers read from recount2.txt and the review, nothing re-run.
Docs only: check_links 0 unresolved, comment budget ok; gate not run (docs only).
Owner: none.
