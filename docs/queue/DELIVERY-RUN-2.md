state: done
started: 2026-11-25T08:27Z
heartbeat: 2026-11-25T17:55Z
by: 3ZzgE9v4
outputs: claude/delivery d0c86cbe6..115d92d97 (lab/delivery/rows/run2/, rows/run2/judged/, inputs.json, predictions.json d126fac79a8b2145; docs/client/evidence/delivery-comparison.md §Amendment 2, the run's R1-R4 and §Results 2; docs/lines/client.md); PR 406, no new PR
## Resume
Done. Next: DELIVERY-VERDICT-2 (a session that ran none of it).
## Result
K1–K3′ on this host, then five pilots (2 VOID of 180, no escalation), then 12 rounds a cell (CLEAN, PUB, LTE, LOSS, CR; 1 080 counted loads), predictions d126fac79a8b2145 pushed first with §Amendment 2, the run's R1–R4 (K2 guard-waived; inputs within 25 % but FIT's level decode ×0.56 of the whole, not A2.7's ×0.29; the lossy line negative again, A2.4's curves used).
Of 125 judged: 85 hold, 36 miss (16 in band under 10/12, 12 below, 8 above), 4 cannot hold; 10 level-0 zooms reported. No stop, no UNBALANCED; VOID 51 (guard 44, 3× pilot 7); A/A ties PUB dbts_c1 and CR; strict reading carried.
Holds: the decode-bound view on CLEAN/PUB (×0.90–1.06); B and wire-bound views on clean forms (×0.95–1.00); C1's exact frame at short round trips now (×1.17–1.28) and on CR; LTE views through the curve (in band, 5 of 9 hold).
A2.4's C1 theory missed: ask → last byte holds; the excess (47–112 ms against h1+17 of 30–60) is after the last byte, so the window's growth is cleared.
FIT dbts_b1: ×0.47 (CLEAN), ×0.55 (PUB) of A; holds on CLEAN and CR, misses above on PUB (×1.19); zoom misses above on LTE and LOSS. FIT on level-0 volumes = B (control holds).
SPLIT: x as predicted; its fill misses above on PUB and CR, ×0.91–1.25 of A: the predicted gain did not show.
LOSS: dbts_a1/c1 views miss low as predicted (under the curve's first point); dbts_b1 misses low against a hold prediction (the model's miss: the wire is not a function of bytes alone there).
The switch picked the view in every load.
Fixtures and limits: dbts_a1, dbts_b1, dbts_c1 (one dataset), the view at Q 8 G 8, only dbts_b1 with a level on the assumed 1080×2100 viewport; no ultrasound; one 4-core container (Xeon 2.30 GHz), no GPU, software decode, Chromium 158 headless; TUN relay ≤ 90 Mbit/s, no radio.
Gate not run (rows, docs and one lab reading aid); check_links 0 unresolved, comment budget ok.
Owner: none (nothing adopted; the verdict is DELIVERY-VERDICT-2's).
