# decode

The decoder worker before and after queue row 49 (DECODE) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md), HTJ2K
and AV1, through the product's own `client/decode/decoder.js`. The reading is in
[`docs/decode/README.md`](../../../../docs/decode/README.md) §The decoder worker's hand-off.

```bash
lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh && ingest/coded-frames/build.sh   # libaom, dav1d, dav1d-WASM, ingest's check
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
lab/av1/fetch_data.sh ffdm_a syn2d_a dbtproj_ge dbt12_ea1141 dbt10_ea1141 usb_cine usb_cine_rgb rf_fluoro
lab/av1/decode/worker/before.sh 59c9d3e                               # client/downloader before the row
S="ffdm_a syn2d_a dbtproj_ge dbt12_ea1141 dbt10_ea1141 usb_cine usb_cine_rgb rf_fluoro"
P=lab/av1/.venv/bin/python
$P lab/av1/decode/worker/make_frames.py lab/.av1-build lab/.av1-work/decode/frames $(for s in $S; do echo lab/av1/data/$s@allintra:7; done) --frames 4
$P lab/av1/decode/worker/make_frames.py lab/.av1-build lab/.av1-work/decode/fill $(for s in $S; do echo lab/av1/data/$s@allintra:7; done) --frames 64
NODE_PATH=$(npm root -g) node lab/av1/decode/worker/run.mjs --rounds 8 --throttles 1,4                  # ~15 min
NODE_PATH=$(npm root -g) node lab/av1/decode/worker/run.mjs --rounds 1 --throttles 1 --mutate sample   # and truth
for r in $(seq 0 5); do                                                                          # ~25 min a round
  NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --rounds 1 --first-round $r --links r20000,r50000 \
    --frames lab/.av1-work/decode/fill --out fill.jsonl
done
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --summary --out fill.jsonl --ref htj2k-before   # and --ref av1-before
```

**Frames.** The breast series this container holds, one of each kind — a mammogram (`ffdm_a`, 12-bit), a synthesized
2D (`syn2d_a`, 10-bit), tomosynthesis projections (`dbtproj_ge`, 14-bit), two reconstructed volumes (`dbt12_ea1141`,
`dbt10_ea1141`), the breast ultrasound cine in grey and RGB (`usb_cine`, `usb_cine_rgb`) — and the fluoroscopy
(`rf_fluoro`) as the non-breast control. HTJ2K is the served profile; AV1 is the optimized payload
(`ingest/coded-frames/ingest.py`) at libaom's `allintra` 7, every payload checked natively against the series' checksums before
it is kept. `frames/` holds each series' first 4 frames, `fill/` its first 64.

**Variants.** `htj2k-T` is the shipped OpenJPH package and `payload-T` the payload's own decoder choice (WebCodecs where every
stream is ≤ 10 bits, dav1d-WASM `simd` otherwise); T is `before`, `client/downloader` (removed by row 82, which split it) at the commit `before.sh` copies,
or `after`, the tree's own. In `variants.json`, which row TOTAL's fill and row FOOTPRINT's memory take, the same four are
`htj2k-before`, `htj2k`, `av1-before` and `av1`.

**Order.** Each throttle is a fresh browser in a Williams order every round (`lab/order.mjs`); sets and variants rotate
inside it. One worker a variant, one frame at a time after a warm-up frame; a frame's time is the worker's own
`decodeStart`–`decodeEnd`. 4× is `lab/scripts/cpu_throttle.mjs` on the browser's tree.

**Checked.** Every frame hashed against its source's checksum; `--mutate sample` (one bit of every frame) and
`--mutate truth` (a digit of every checksum) each turned all 32 (set × variant) cells to 0 exact.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37; `@cornerstonejs/codec-openjph` 2.4.11 (tarball
SHA-256 `b47e4f67…ad105e15e`); dav1d 1.5.4 under emscripten 3.1.74 (`simd.wasm`, 623 146 B, SHA-256
`b5e5684f…8581784e`); libaom 3.15.1 and OpenJPH 0.31.0 as `tools.sh` and `gen_htj2k_fixtures.sh` pin them. Nothing
built or generated is committed.
