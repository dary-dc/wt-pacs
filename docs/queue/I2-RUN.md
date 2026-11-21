state: started
started: 2026-11-21T15:17Z
heartbeat: 2026-11-21T15:26Z
outputs: claude/oq-integrity-build (rows)
## Resume
Protocol: claude/unified:docs/lines/proposals.md §I2 (rule, cells, mutants, cost). Inputs: the study's rows
claude/unified:lab/av1/metrics/rows/shard-*.jsonl (per frame mse, max_abs, err_noise_band; forms 12bit/10bit).
The ingest's values exist only after an encode (no metadata with codingError is committed), so rule (1)'s 12
stored-form cells are ingested here with --integrity; the brief's "nothing encoded" is read as: no cost cell
(rule 2 needs 6 whole demo-series runs, hours of AV1 encoding), recorded as not run with its commands.
Done: (1) tools built; (2) data fetched (sha checked); script eba10ba1b; smoke dbts_a1 q24 g16: rms and max equal the study's on every frame, ratio +30 % (the mask). Running: the 12 cells, rows pushed per cell to lab/oq-integrity/rows/i2.jsonl (scratch run12.sh; rerun a cell missing from the rows file). Next: mutants M1 M3 on dbts_a1:24:16 in a second worktree, M2 and the cut on a synthetic set (lab/oq-integrity/i2_synthetic.py); results in payload-format §Integrity and the line doc.
Steps: (1) pip install meson==1.9.1; BUILD=ingest/.build ingest/tools.sh on claude/oq-integrity-build;
(2) OUT=lab/av1/data lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1; (3) per cell
lab/av1/.venv/bin/python lab/av1/tools/ingest_coded.py ingest/.build lab/av1/data/SET OUT/ID --lossy Q G
--exact-series SET --integrity --jobs 4; (4) compare codingError against the study rows (lab/oq-integrity/i2_compare.py,
rows lab/oq-integrity/rows/i2-*.jsonl); (5) mutants on dbts_a1 q24 g16; (6) synthetic cut check.
## Result
