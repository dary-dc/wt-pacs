state: done
started: 2026-11-21T15:17Z
heartbeat: 2026-11-21T16:57Z
outputs: claude/oq-integrity-build a59aa4310 (lab/oq-integrity/i2_compare.py, i2_synthetic.py, i2_cost.py; rows/i2*.jsonl, rows/i2-cost/; docs/av1/payload-format.md §Integrity, docs/lines/optimal-quality.md), PR 368 (draft, unchanged body)
## Resume
Protocol: claude/unified:docs/lines/proposals.md §I2. The brief's "nothing encoded" read as: the quality side is
not encoded again (the study's committed rows, claude/unified:lab/av1/metrics/rows/shard-*.jsonl, stand for it);
the ingest's own runs are I2's subject, so they run as written.
Done (claude/oq-integrity-build): eba10ba1b lab/oq-integrity/i2_compare.py; edbd1b633 i2_synthetic.py and
rows/i2-synthetic.jsonl (cut cell and M1, M2); rows/i2.jsonl per cell as they land (12 cells: a1, c1 12-bit, b1
10-bit; Q 8, 24; G 1, 16). So far rms and max equal the study's on every frame, the noise-band ratio +27-30 %, laid
to the mask by the diagnosis (the study's code unmasked gives the ingest's value).
Next: M1, M3 on dbts_a1:24:16 (rows/i2-mutants.jsonl); the cost cell, demo-series.sh with and without
INTEGRITY=1, rounds 0 off/on, 1 on/off, 2 off/on, stdout to rows/i2-cost/round<r>-<arm>.txt (scratch after.sh;
a missing file is rerun with the same command); lab/oq-integrity/i2_cost.py the derived per-frame cost; then
docs/av1/payload-format.md §Integrity (the "Found, not fixed" bullet corrected in place), docs/lines/optimal-quality.md.
Setup for a resume: pip install meson==1.9.1; BUILD=$PWD/ingest/.build ingest/tools.sh;
OUT=$PWD/lab/av1/data lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1; a venv with numpy 2.4.6, scipy, xxhash, pydicom;
the study tree: git archive origin/claude/unified lab/av1/metrics lab/av1/profiles lab/av1/data.json ingest/from-dicom.
## Result
* Rule (1), values (measured, 12 cells: dbts_a1, dbts_c1 12-bit, dbts_b1 10-bit; Q 8, 24; G 1, 16): RMS e and max |Δ| equal the study's committed rows on every frame (the reconstructions are the same); the noise-band ratio fails, ingest over study by +27-30 % (a1), +69-71 % (c1), +121-122 % (b1), bar 1 %.
* Why (measured): the study's code without its in-window mask gives the ingest's ratio within 4e-5; with it, the study's row exactly. The mask is the whole difference (in-window 62, 42, 31 % of samples). The ingest's formula with the mask: within 0.6-1.3 % (border handling).
* The cut (synthetic ramp, σ 1, 4, 16): RMS, max, ratio and σ as theory predicts.
* Mutants: frame i's error at i+1 caught (every frame); e against the code c caught; σ without the rounding term survives at σ > ~2 (effect ~1/(24σ²)), caught only at synthetic σ 1.
* Rule (2), cost (measured, demo-series.sh, 3 interleaved rounds): 461-462 s off, 683-740 s on, +48 to +60 %, bar 10 %. Checks alone 0.09-0.20 CPU s a megapixel (assumed ≤ 0.27).
* By its rule I2 is not adopted as written. The brief's "nothing encoded" was read as: the study not encoded again; the ingest coded the 12 cells and the 6 demo-series runs.
* Fixtures and limits: three DBT volumes of one dataset; stored form only for the values (the cut on a synthetic set); one 4-core cloud host, no GPU; cost on demo-series.sh at --cpu-used=6. Gate: stopped at its prerequisites (the transport WASM not built), not run past them; docs-and-lab change; check_links and the comment budget green; check_lab_absent.sh is not on this branch.
* Owner decisions (PR 368): whether the noise-band ratio takes the study's in-window mask (one header window's codes) or stays whole-frame and is labelled not comparable; whether a +50 % ingest time for the checks is acceptable, or the ratio is computed off the ingest's path.
