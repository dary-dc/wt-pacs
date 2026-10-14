# bb3

Row 104 (BB3MEASURE) of [`docs/av1/queue.md`](../../docs/av1/queue.md): [`docs/transport/bb3-protocol.md`](../../docs/transport/bb3-protocol.md)
run as written, its raw output kept whole here, one file a cell, as each script wrote it. The reading is in
[`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §1, under BB3.

| file | cell | written by |
| --- | --- | --- |
| `cell1-prof.tsv` | 1, PROF's LTE-good + CoDel | `lab/scripts/profile_cells.sh` |
| `cell2-askl-ge1.jsonl`, `cell2-askl-ge4.jsonl`, `cell2-askl-summary.txt` | 2, ASKL's 1 % and 4 % | `lab/scripts/askl_cells.sh`, its summary `lab/stream-shape/askl.py` |
| `cell3-w4b.tsv`, `cell3-w4b-summary.txt` | 3, W4b's `flat`, 500 ms | `lab/scripts/deep_queue_cells.sh` |
| `cell4-losscc.jsonl` | 4, row 75's cells through the product, one row a visit (rounds 0–5) | `lab/av1/delivery/total-time/run.mjs`; its rule, `rule4.py` |
| `host.log` | every cell: UTC time, 1-minute load, steal % over the 10 s before | a 10 s sampler of `/proc/stat` beside the runs |
