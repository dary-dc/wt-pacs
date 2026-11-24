state: done
started: 2026-11-24T08:06Z
heartbeat: 2026-11-24T08:14Z
by: rNNn6qkA
outputs: findings in PR 413's body §NOISE-INGEST-REVIEW; claude/noise-ingest 83f73e2bc (docs/lines/codecs.md §Open 3, one dated line); no new PR
## Resume
Done. Next for PR 413: a sync row (UNIFIED-SYNC-1125 or later) merges it by amendment 28 rule 1 after the gate on the merged tree; docs/lines/codecs.md conflicts with claude/unified (line doc: keep both).
## Result
* No blocker open: PR 413 is eligible for a sync row (gate on the merged tree still owed).
* P1–P5 recomputed from the raw rows by an independent script: every cell and every miss as PR 413 reports them.
* cargo test --release -p noise-ingest --lib 2/2; golden.py (NumPy 2.4.6, SciPy 1.17.1) prints the 12 pinned bits.
* Mutants 1–3 and three more (edge share, <= at the cut, Laplacian sign) fail the golden test; mutant 4 survives.
* m1: the protocol's mutant-4 clause (add a killing frame) was not met while §Measured says "no amendment";
  theory: both _lerp forms are exact for frames with more than 36 410 kept samples at 12 bits or fewer, so no
  fixture frame can kill it (10^6 random cases, 0 differ). m2: P3 mixes a median and a mean; with means
  20.9 · 13.1 · 15.2 %, same verdicts. Nits n1–n4 (host clock 2.10 against 2.30 GHz; golden frames 0–3 pin 0;
  order tool's name; codecs.md merge conflict).
* Fixtures: dbts_a1, b1, c1 (EA1141, 3 of 19), rows as committed, not re-fetched; no ultrasound; gate not run here.
