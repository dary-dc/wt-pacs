state: done
started: 2026-11-21T15:47Z
heartbeat: 2026-11-21T16:29Z
outputs: claude/noise-ingest at 060f71f2 (lab/noise-ingest, its rows; docs/av1/noise-point.md §Measured; codecs §Open 3), draft PR 413
## Resume
Done. Next for this question: INGEST-OQ-TESTS-REVIEW, then INGEST-PAGE.
## Result
* Run unchanged, no amendment; fixtures dbts_a1, b1, c1 (EA1141 DBT, systems A–C; 3 of 19 volumes); one 4-core
  cloud Xeon @ 2.10 GHz, one thread, five rounds of 14 units (Williams, not a full period); no saturation claimed.
* P1 held: the Rust port equals the rows' σ on 875/875 frames (175 × 5 rounds), σ_min frames as T2.
* P2 missed low: 0.0033 · 0.0022 · 0.0025 CPU s/Mpx (band 0.004–0.012); ≤ 0.02, so σ goes in code() every frame.
  M5 (Python) ×1.23 · 1.25 · 1.19 of P2's: missed on a1 and b1, same σ.
* P3: σ is 20.0 · 11.9 · 14.6 % of the exact path (M3 32.6 · 140.8 · 40.7 ms a frame); b1 below its band.
* P4 held: all-samples σ_min lower on all three; rule Q 4→4 · 8→2 · 4→2, so σ_min waits for phase 2's window.
* P5 held: 1.0001 · 1.0010.
* Mutants: 2 and 3 fail golden and P1; 1 fails golden only; 4 survives both (equivalent on integer gradients
  as far as searched, not proven; no frame can kill it).
* Gate OK (783 s), four skips named in PR 413; noise-ingest tests run by hand (not a default member).
* Owner: σ_min at the ingest needs phase 2's parser to carry the nested window (PCS note, question 1).
