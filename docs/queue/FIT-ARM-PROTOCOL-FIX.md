state: done
started: 2026-11-24T14:06Z
heartbeat: 2026-11-24T14:12Z
by: CU2V4rWa
outputs: claude/delivery 3ca4c84ae, aab27813e, 88896196a (docs/client/evidence/delivery-comparison.md §Amendment 2 in place, §Amendment 2 fix; docs/lines/client.md); PR 406 (no new PR); reading aids docs/queue/FIT-ARM-PROTOCOL-FIX/
## Resume
Done. Next: FIT-ARM-PROTOCOL-FIX-REVIEW (a session that wrote none of §Amendment 2, its review or this fix), findings in
§Amendment 2 re-review; FIT-ARM-BUILD waits on it with no blocker open.
## Result
Docs only: scripts/check_links.py green (0 unresolved); the gate not run; nothing measured.
B1: the window read-back reads the window pass's RGBA8 texture at the picture's own size (paint-worker.js windowPass),
not the gl.LINEAR-placed canvas; compared with voi.js's windowTable + tableShape offset on the truth's samples, byte for
byte; a mutant reading the placed canvas must stop.
B2: per lossy (form, volume), view fill vs the curve's first point: LOSS dbts_a1 (0.67 vs 1.26 MB) and dbts_c1 (0.75 vs
1.09) under, predicted to miss low on A, A', C1; the rest over, predicted to hold (LTE dbts_a1 at risk, 1.36 vs 1.26).
Retrodiction recomputed apart from the review (curve_retro.py) and equal to it: LOSS c1 A x0.93, A' x0.67, C1 x0.70.
m1: SPLIT given A's makespan factor k (x1.14/1.04/1.07); fill ratio CLEAN x0.90/0.81/0.87, PUB x0.90/0.82/0.87.
m2-m8, n1 fixed (x1.26; 8.47 MB; zoom judged on dbts_b1 only; K3' 8 loads; measured pace ~65/67/180/69/79 min;
two departures named, relay escalation argued and kept; level picture checked in the lab only; frame 0's source).
Fixtures: three DBT volumes of one dataset (no US), the 2026-11-23 rows of one 4-core container, TUN relay <= 90 Mbit/s;
retrodiction a sanity check on 6-10 counted loads a cell, not a test.
