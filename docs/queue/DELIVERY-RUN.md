state: done
started: 2026-11-22T22:17Z
heartbeat: 2026-11-23T05:56Z
outputs: claude/delivery 02e7c907 (lab/delivery/rows/, rows/judged/; docs/client/evidence/delivery-comparison.md §11 A1-A5 and §Results; docs/client/design.md §Open; docs/lines/client.md); PR 406, no new PR
## Resume
Done. Next on this question: DELIVERY-VERDICT-REVIEW (a session that ran none of it).
## Result
K1-K3, five pilots, then one counted period a cell (CLEAN, PUB, LTE, LOSS, CR; 750 loads), predictions e7d61c6d pushed first.
Amendments before any counted row: A1 K2 read with the relay's guard waived (every bench load voided, the bench times decodes);
A2 LTE/LOSS start = 3 RTT + 20 ms, G from the second prefix (K3's line gave negative starts); A3 inputs >25 % off §4.3 (the
view's d1 ~2.1x); A4 the pilot (guard stands for the cells); A5 a container restart cut CLEAN at 89 loads (kept, in no bar; rerun whole).
Of 105 (cell, volume, arm, clock): 56 hold, 40 miss, 9 cannot hold (<8 counted). Holds: the decode-bound view on CLEAN/PUB
(x0.91-1.05), wire-bound HTJ2K and views on CLEAN/PUB/CR (x0.96-1.00), C1's exact frame on CR (x1.08-1.11).
Misses: C1's exact frame at short RTT (x1.25-1.38); every lossy-form fill below (x0.32-0.70, A2's direction), and B/C2 span
mostly below too (A2 said in band); A2's CR note (small fills below) missed: they held. One goodput per lossy link does not
predict a fill. VOID 61 of 750 (52 the guard), none over 25 %; no load failed; no UNBALANCED. A/A tie on 6 of 15 (cell, volume).
Fixtures: dbts_a1/b1/c1 at Q 8 G 8, one 4-core container, software decode, Chromium 153, TUN relay <= 90 Mbit, no radio.
Gate not run (docs and rows only); check_links 0 unresolved, comment budget ok.
Owner: none (nothing adopted; the page's carry is DELIVERY-VERDICT-REVIEW's and DELIVERY-PAGE's).
