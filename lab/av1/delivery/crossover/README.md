# crossover

Where AV1 fills a target series first, from numbers already measured: a two-stage pipeline model of a fill (the wire,
then three decoders) fed rows 95 and 96's bytes and decode times, checked against their 48 total-time cells, and the
link speed where each codec ties per series, engine and CPU speed. Queue row 105 (CROSSOVER) of
[`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading is in [`docs/av1/README.md`](../../../../docs/av1/README.md)
§Where AV1 fills first, a model, and its test is [`docs/av1/crossover-protocol.md`](../../../../docs/av1/crossover-protocol.md).

```bash
python3 lab/av1/delivery/crossover/model.py     # no dependencies, no data: every input is in the script, with its source
```

One parameter is fitted on AV1, WebCodecs' concurrency, on one cell; each series' round-trip constant is fitted on its
HTJ2K 5 Mbit/s cell. Firefox's AV1 decode is an assumption (dav1d-WASM at 1.6–2.2× WebCodecs' time), not a
measurement on these series.
