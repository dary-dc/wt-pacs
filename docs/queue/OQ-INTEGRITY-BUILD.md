state: done
started: 2026-11-11T16:28Z
heartbeat: 2026-11-11T17:38Z
outputs: claude/oq-integrity-build 08bf659e (from claude/source-fingerprint c02b5f32), draft PR #368 into claude/demo-fixes-2 (a proposal, not for the demo)
## Resume
Done. For OQ-INTEGRITY-REVIEW: the mutant list is in PR #368's body; rows in lab/oq-integrity/rows/.
## Result
I1–I3 built behind one switch, off by default: ingest_coded.py --integrity (demo-series.sh INTEGRITY=1) writes
lossy.reconstruction (XXH3-64 per frame of dav1d's picture) and lossy.codingError (rms, max, noiseBandRatio).
Client: decoder checks it (asCoded, never exact); a mismatched inter frame's group re-decoded on dav1d after
WebCodecs; not matched on either route → refused; label "Optimal quality ✓"; overlay gives the check + error.
Each change test-first; mutants killed 41 of 45 (2 equivalent, 1 not observable with the stand-ins). Gate OK, 838 s
(skipped: lavapipe, Xvfb, Firefox, nginx).
I1 protocol: correctness on all 18 series, both routes; every Chromium mutant caught, the WebCodecs-only flip mended;
cost over 504 interleaved fills: +3.7 % fill at 1x, +1.9 % at 4x (max +7.8 %). Rule → adopt with every frame checked.
Limits: one 4-core cloud host, no GPU; no hardware AV1 decoder; 4x throttle barely reaches the decoder workers; three
DBT volumes of one dataset; phone row owed.
Found: noiseBandRatio 1.25–2.35 on every demo series (σ over all samples, not in-window as the study): I2's protocol decides.
Owner decisions: whether and when to take #368; the open choices in its body (unchecked label, block vs paint, mask).
