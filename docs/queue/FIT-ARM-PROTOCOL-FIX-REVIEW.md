state: done
started: 2026-11-24T14:46Z
heartbeat: 2026-11-24T14:49Z
by: WjKty5Kz
outputs: claude/delivery 4819f8ffb (docs/client/evidence/delivery-comparison.md §Amendment 2 re-review; docs/lines/client.md); PR 406 (no new PR)
## Resume
Done. Next: FIT-ARM-BUILD (no blocker open), which reads r-m1 and r-m2 of §Amendment 2 re-review first.
## Result
Docs only: scripts/check_links.py 0 unresolved; the gate not run; nothing measured.
Every finding of §Amendment 2 review closed; no blocker open.
B1: paint-worker.js windowPass writes the RGBA8 picture at the frame's size, one texel a sample (texelFetch at
gl_FragCoord, table[s + offset] / 255 from voi.js): the read-back compared byte for byte holds with no tolerance.
B2: A2.4's table reproduced to the digit by curve_retro.py; five of six under-point cells miss low on the 23rd's rows.
m1: split.mjs reproduces k, x and SPLIT/A (CLEAN x0.90/0.81/0.87, PUB x0.90/0.82/0.87). m6: the 23rd's pace recomputed
from rows' at (64.6/66.7/179.9/69.4/78.9 min for 216 loads). m2-m5, m7, m8, n1 checked.
Minors for FIT-ARM-BUILD, no fix row: r-m1 the FBO read is in sample order (readback()'s flip must not be reused);
r-m2 an under-point cell landing in band is "direction not shown", to be said.
Fixtures: three DBT volumes of one dataset (no US), the 2026-11-23 rows of one 4-core container, TUN relay <= 90 Mbit/s;
the retrodiction a sanity check on 6-10 counted loads a cell, not a test.
