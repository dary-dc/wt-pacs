state: done
started: 2026-11-23T06:27Z
heartbeat: 2026-11-23T06:35Z
outputs: claude/delivery b8cd8c71 (docs/client/evidence/delivery-comparison.md §Verdict review; lab/delivery/rows/judged/recount.py 0150b17f; docs/lines/client.md); PR 406, no new PR
## Resume
Done. Next on this question: DELIVERY-PAGE (no fix rows: no blocker).
## Result
Every count recomputed from the 750 counted rows by recount.py, apart from judge.mjs: VOID 61 (guard 52, timers 4,
pilot 3x 4, exact decoders 2), 56 hold / 40 miss / 9 cannot hold, regime misses, A/A input and aa_rule verdicts
all match; predictions file unchanged since before the first counted row. No blocker.
Held: decode-bound view fills on CLEAN/PUB (21 hold, 3 cannot), wire-bound fills and spans on CLEAN/PUB/CR, C1 on CR.
m1 C2's span took the latency band (predict.mjs band()); under §8's fill band LOSS dbts_b1's span misses.
m2 C1's excess over prediction grows with frame bytes and RTT (+43..117 ms short RTT), not a fixed cost; ask->last
byte (§5) not recorded. m3 PUB dbts_c1's C1 holds, the prose says it misses. m4 predicted direction per volume.
m5 51 of 52 guard VOIDs on view arms with the relay already pinned; voided fills not faster; --no-guard reading given.
Derived crossover G* (exact series alone faster above it), clean links only, extrapolated past 90 Mbit/s: dbts_b1
entry 77-170, middle 117-375, premium 320-466 Mbit/s; phone cell 2 beside it (~242 and ~584, B faster on both).
Fixtures: dbts_a1/b1/c1 at Q 8 G 8, one 4-core container, software decode, Chromium 153, TUN relay <= 90 Mbit, no
radio, no US; device classes from DEVICE-THEORY's ranges, one phone. Gate not run (docs and a lab reading aid);
check_links 0 unresolved, comment budget ok.
Owner: none.
