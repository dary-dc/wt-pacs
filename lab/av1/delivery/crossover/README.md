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

## Measured

Row CROSSMEASURE (106) ran the protocol on 2026-10-09; the reading is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §Where AV1 fills first, measured.

```bash
lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh   # tools.sh's dav1d wants meson: the build's venv has it
client/decode/wasm/fetch_openjph.sh && client/transport/ts/build.sh
PATH=lab/av1/.venv/bin:$PATH FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160 && ingest/coded-frames/build.sh
lab/av1/fetch_data.sh dbts_a5 dbts_b2 dbts_b4 ffdms_c1 syn2ds_a3 syn2ds_b3
W=lab/.av1-work
for s in dbts_a5 dbts_b2 dbts_b4; do python3 lab/av1/delivery/crossover/every_nth.py lab/av1/data/$s $W/cross-data/$s 8; done
for s in ffdms_c1 syn2ds_a3 syn2ds_b3; do ln -s $PWD/lab/av1/data/$s $W/cross-data/$s; done
lab/av1/.venv/bin/python lab/av1/delivery/split-rule/make_frames.py lab/.av1-build $W/cross $W/cross-data/* --preset allintra:7 --k 2
export FIREFOX_PATH=...   # Firefox 157.0.1 as row TOTAL4 pins it (lab/av1/delivery/total-time/README.md)
for r in $(seq 0 11); do
  NODE_PATH=$(npm root -g) node lab/av1/delivery/crossover/measure.mjs --frames $W/cross --out lab/av1/delivery/crossover/rows.jsonl --rounds 1 --first-round $r
done                                                               # ~27 min a round
python3 lab/av1/delivery/crossover/verdict.py lab/av1/delivery/crossover/rows.jsonl [--all]
```

`rows.jsonl` is the run, one visit a line, as `run.mjs` writes it. `measure.mjs` runs one series at a time, its four
engine × CPU groups in a Williams order, each group one `run.mjs` call over that group's links and `lte-good` (cells,
then variants, in its own Williams order); the series rotate by round, and a round starts only once `/proc/stat`'s
steal reads ≤ 2 % over 10 s. Every 8th slice is slices 0, 8, 16, … with the volume's own range, so each payload is
the one the whole volume's ingest writes; the k = 2 bytes over HTJ2K's on them are 0.954, 0.956, 0.760 (row 95's
whole volumes 0.953, 0.956, 0.760), and 0.992, 0.966, 0.940 on the three exams. `verdict.py` pairs both arms of a cell
by round; flipping its side test turned 24 of 24 held cells (round 0) to 0. `--mutate sample` and `--mutate truth`
each took both variants to 0 exact on `dbts_a5` (Chromium 1×, 100 Mbit/s) and `--mutate truth` on `ffdms_c1` in Firefox.
Pins as row TOTAL4's: libaom 3.15.1, dav1d 1.5.4 under emscripten 3.1.74 (`simd.wasm` 623 146 B), OpenJPH 0.31.0,
`@cornerstonejs/codec-openjph` 2.4.11, Chromium 141.0.7390.37, Firefox 157.0.1 (BuildID 20261005135250, the conda
package's SHA-256 `f1b53de2…4d7127f35`, micromamba 2.9.0 `8761c382…f13040dd`), meson 1.5.2 for native dav1d.
