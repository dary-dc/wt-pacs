# bb3

Row 104 (BB3MEASURE) of [`docs/av1/queue.md`](../../docs/av1/queue.md): [`docs/transport/bb3-protocol.md`](../../docs/transport/bb3-protocol.md)
run as written, its raw output kept whole here, one file a cell, as each script wrote it. The reading is in
[`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §1, under BB3.

| file | cell | written by |
| --- | --- | --- |
| `cell1-prof.tsv` | 1, PROF's LTE-good + CoDel | `lab/scripts/profile_cells.sh` |
| `host.log` | every cell: UTC time, 1-minute load, steal % over the 10 s before | a 10 s sampler of `/proc/stat` beside the runs |
