state: done
started: 2026-11-19T10:17Z
heartbeat: 2026-11-19T10:24Z
outputs: claude/delivery ddbb2435 (docs/client/evidence/delivery-comparison.md; design.md §Open; docs/lines/client.md), draft PR 406 into claude/unified
## Resume
Done. Nothing is pending. Next row on this question: DELIVERY-BUILD (not before 11-20 12:00, by a session that did not write the protocol).
## Result
The cloud protocol for the delivery comparison is pre-registered. It tests the fill model, not the order of the arms.
Arms: A, A′ (A/A), B, C1 (press=lossless, 1 s after the fill), C2 (exactFill=1); decoders=2; Williams over 5 arms, 10 rounds a cell.
Forms from stacks.md §5: CLEAN, PUB, CR, LTE (16 frames), LOSS (8 frames). ENT is left out because of its 18× jitter-model miss, and the
scaled 5G and median home forms add only a round trip.
Model: fill = max(W(B)+d1, W(b1)+D), with W = S + 8b/G and D the makespan of decoder units on 2 decoders. C1 = RTT + slow start from 12 000 B
on the idle exact session + one HTJ2K decode + one paint.
The run measures its inputs on its own host before any row (K1 bytes, K2 bench decode, K3 WT-TS wire at two prefixes).
lab/delivery/predictions.json is pushed before any counted row, and its XXH3 goes in every row.
Derived today: on this host B is wire-bound in every cell (crossover ~600 Mbit/s), and A is decode-bound only on CLEAN and PUB, so the decode
side of the model is tested on the view alone.
Bands (assumptions): fills ×0.85–1.15 on clean forms and ×0.75–1.33 on lossy ones; C1 ×0.75–1.33 and ×0.6–1.67. Holds = median in the band
and 8 of 10 rounds in it; a regime miss in more than 2 of 10 rounds counts as a miss.
check_links 0 unresolved and comment budget ok. The gate was not run (docs only).
Fixtures: 3 DBT volumes of one dataset, Q 8 G 8, one 4-core container, headless Chromium, TUN relay ≤ 90 Mbit. Nothing measured.
