state: done
started: 2026-11-24T13:18Z
heartbeat: 2026-11-24T13:24Z
by: kUpCGruD
outputs: claude/delivery 8f3f5f7bd (docs/client/evidence/delivery-comparison.md §Amendment 2 review; docs/lines/client.md); PR 406 (no new PR); FIT-ARM-PROTOCOL-FIX and -FIX-REVIEW appended to docs/queue-2026-11-24.md
## Resume
Done. Next rows: FIT-ARM-PROTOCOL-FIX (a session that wrote neither the amendment nor this review), then its re-review;
FIT-ARM-BUILD now waits on FIT-ARM-PROTOCOL-FIX-REVIEW with no blocker open.
## Result
Docs only: scripts/check_links.py green (0 unresolved); the gate not run; nothing measured.
Recomputed and confirmed: A2.7's table to the digit; G_A, G_B, the switch thresholds, x; the split's t re-derived; A2.4's
retrodiction (LTE A x1.01-1.06, LOSS x0.56/0.87/0.93) from the 23rd's counted B loads; every quoted source.
Two blockers:
* B1: FIT's window read-back stop compares the viewer's canvas, which is the windowed picture resampled (gl.LINEAR) into
  the viewport, with the window of the truth sample for sample: a correct build stops on its first FIT load.
* B2: LOSS dbts_c1's view fill (0.73 MB) lies under the curve's first point (1.09 MB) like dbts_a1's, yet is predicted
  to hold; A' and C1 there retrodict x0.67 and x0.70, below the band; A2.4 quotes arm A only.
Minors m1-m8 (SPLIT ÷ A printed as t ÷ d_V: x0.78-0.82 by its own formula; bytes x1.26 not x1.28; the level-0 zoom
judged as one paint; K3' at 4 loads; cell lengths at predicted, not measured, pace; two brief departures unnamed; a
level picture "checked" only in the lab), n1.
Fixtures: three DBT volumes of one dataset (no US), the 2026-11-23 rows of one 4-core container, TUN relay <= 90 Mbit/s.
