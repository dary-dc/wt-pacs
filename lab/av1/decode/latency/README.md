# wclat

WebCodecs' AV1 decoder with `optimizeForLatency` and no flush: does each unit give its frame, is it
exact, and what does the flush per unit cost. Queue row 30 (WCLAT) of
[`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading is in
[`docs/decode/README.md`](../../../../docs/decode/README.md) §AV1, *WebCodecs without a flush*.

```bash
lab/av1/tools/tools.sh && lab/av1/fetch_data.sh rf_fluoro us_liver
JOBS=4 lab/av1/.venv/bin/python lab/av1/decode/latency/make_streams.py lab/.av1-build lab/.av1-work/wclat lab/av1/data  # ~25 min
NODE_PATH=$(npm root -g) node lab/av1/decode/latency/run.mjs --arms flush,latency,hold --rounds 1 --throttles 1 --wait-ms 500
NODE_PATH=$(npm root -g) node lab/av1/decode/latency/run.mjs --arms flush,latency --rounds 1 --throttles 1 --mutate \
  --streams mono_10_g8,444_8_intra,rf_fluoro_intra_t4,us_liver_g8_t2
NODE_PATH=$(npm root -g) node lab/av1/decode/latency/run.mjs --arms flush,latency,keyflush --rounds 10 \
  --streams rf_fluoro_intra_t1,rf_fluoro_intra_t2,rf_fluoro_intra_t4,rf_fluoro_g8_t1,rf_fluoro_g8_t4,us_liver_intra_t1,us_liver_intra_t2,us_liver_intra_t4,us_liver_g8_t1,us_liver_g8_t4
```

**Streams.** libaom 3.15.1 lossless, `cpu-used` 0, G = 8 with `--auto-alt-ref=0`. The matrix is every
depth and layout WebCodecs returns exactly (row WCAP): 8 and 10 bits × 4:0:0, 4:2:0, 4:2:2 and 4:4:4
identity, synthetic 256×192 (`gen_frame_pnm.py`), 16 frames, intra and G = 8. The real streams are
the ultrasound cine (70 × 760×421, RGB 8) and the fluoroscopy's top 10 bits (18 × 768², v ≫ 2,
grey), at 1, 2 and 4 tile columns, intra and G = 8. The truth is a SHA-256 per frame per plane of
the encoder's input. The real frames are checked against their fetch checksums first. Native dav1d
decodes every stream against that truth before it is used. **All 28 streams were exact.**

**Arms.** Each unit goes in as one chunk, `key` on keyframes, and its frame is awaited up to a
deadline, timed from `decode()` to the output callback:

* `flush`, as the product was: a flush after every unit.
* `latency`: `optimizeForLatency: true` and no flush.
* `keyflush`: the same, but flushed before each keyframe.
* `hold`: neither.

All are at `prefer-software`, Chromium 141, the browser on three cores, and 4× is those cores each a
quarter as fast. A fresh browser runs per (round × throttle) in a Williams order, with streams and
arms rotated inside it.

**Exact, frame by frame** (1×, one round, 500 ms a unit): with `optimizeForLatency` **every unit
gave its frame before the next was sent, exact, on all 28 streams**: 784/784 frames, every
depth and layout, intra and G = 8, 1 to 4 tiles. With neither option, no unit gave its frame
(0/784), and all came out exact at the final flush. That is the arm that shows the check can fail.
Flushed per unit, a G = 8 stream gives its keyframe and then refuses the next unit ("a key frame is
required after configure() or flush()"): 1 frame of each group. `--mutate` (one sample of every
frame) turned every arm on four streams to 0 exact.

**Time, ms a frame** (10 rounds, median of each round's median; × is paired by round against
`flush`; every frame exact in every arm and round). Bytes are over the one-tile intra stream:

| stream | flush 1× · 4× | no flush (`latency`) | flushed before keys | bytes |
| --- | --- | --- | --- | --- |
| fluoroscopy top10, intra, 1 tile | 33.1 · 135 | ×0.93 · 0.93 | ×1.01 · 1.00 | 6 089 459 B |
| 2 tiles | 19.9 · 80.8 | ×0.84 · 0.88 | ×0.91 · 1.05 | −0.18 % |
| 4 tiles | 14.8 · 69.6 | ×0.80 · 0.72 | ×0.97 · 1.05 | −0.56 % |
| ultrasound, intra, 1 tile | 32.8 · 118 | ×0.86 · 0.97 | ×0.93 · 1.02 | 20 125 102 B |
| 2 tiles | 20.8 · 84.0 | ×0.87 · 0.87 | ×0.94 · 1.09 | −0.10 % |
| 4 tiles | 15.6 · 65.8 | ×0.85 · 0.80 | ×0.97 · 1.15 | +0.39 % |
| fluoroscopy top10, G = 8, 1 tile | — | 32.4 · 131 ms | 32.7 · 137 ms | −0.13 % |
| 4 tiles | — | 12.4 · 52.1 ms | 13.0 · 56.9 ms | −0.71 % |
| ultrasound, G = 8, 1 tile | — | 34.6 · 146 ms | 34.9 · 150 ms | +34 % |
| 4 tiles | — | 15.3 · 60.8 ms | 15.4 · 63.0 ms | +33 % |

The G = 8 rows are ms. The flushed arm gives no group, so they stand against the intra rows above.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37 (`CHROME_PATH` overrides); libaom
3.15.1 and dav1d 1.5.4 as `lab/av1/tools/tools.sh` pins them. Nothing built or generated is committed.
