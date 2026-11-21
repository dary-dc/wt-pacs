state: started
started: 2026-11-21T15:17Z
heartbeat: 2026-11-21T15:29Z
outputs: claude/oq-integrity-build (rows)
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
