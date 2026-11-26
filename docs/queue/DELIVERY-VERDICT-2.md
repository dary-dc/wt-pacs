state: done
started: 2026-11-26T08:17Z
heartbeat: 2026-11-26T08:23Z
by: 9h95Zxpo
outputs: claude/delivery 115d92d97..340968a91 (docs/client/evidence/delivery-comparison.md §Verdict review 2; lab/delivery/rows/run2/judged/recount2.py and recount2.txt; docs/lines/client.md); PR 406, no new PR; rows DELIVERY-VERDICT-2-FIX and -FIX-REVIEW appended to docs/queue-2026-11-24.md, PAGES-AFTER-RUNS now waits on the re-review
## Resume
Done. Next: DELIVERY-VERDICT-2-FIX (a session that wrote none of the protocol, the run or this review), then its re-review.
## Result
Every count of §Results 2 recomputed apart from judge.mjs and confirmed: VOID 51 of 1 080 (guard 44, 3× pilot 7), 85 hold, 36 miss, 4 cannot hold, 6 regime misses; predictions reproduce byte for byte (d126fac79a8b2145), unchanged since before the first counted row; 180 window read-backs equal.
B1: the carry lets LTE's views through "5 of 9 hold", but four of those are regime misses and the fifth was predicted near (§8): no LTE view fill carries; the curve's wire held for the views' bytes (×0.91–1.13).
B2: LOSS dbts_a1/c1 missed low for the one-group decode term (8 frames decoded after the last byte at K2's d1, against 31–38 ms lone, overlapping the arrival), not the curve, whose wire held (×1.06–1.24); LOSS dbts_b1 the curve's 4.31 s (not 6.1 s) against 1.98 s measured.
m1 LTE dbts_c1's C1 a miss, not cannot hold; m2 C1's rest after the last byte is the same on every form (47–56, 106–112 ms).
Is a view needed: yes on CR, LTE and LOSS (B ÷ A ×2.6–16.7 here; to phones by a derived bound on lossy forms, not by the model) and on clean links below a class's G★; no on clean links above G★ (extrapolated past 90 Mbit/s; one premium phone agrees) nor where FIT fills first (dbts_b1, ×0.47–0.55 on CLEAN, PUB). PROGRAM-CLOSE order 3's "no view needed" not found: its five held rows stay held.
Fixtures and limits: dbts_a1, dbts_b1, dbts_c1 (one dataset), view Q 8 G 8, no ultrasound; one 4-core container, software decode, Chromium 158 headless; TUN relay ≤ 90 Mbit/s, scaled forms, no radio; G★ on DEVICE-THEORY's ranges and one phone.
Gate not run (docs and a reading aid); check_links 0 unresolved, comment budget ok.
Owner: whether the five rows held on "is a view needed" stay held (PROGRAM-CLOSE order 3); nothing adopted.
