# decspeed

What cuts lossless AV1's decode with every frame still exact: encoder settings, dav1d-WASM threads
against decoders, and where the time goes. Queue row 27 (DECSPEED) of
[`docs/av1/queue.md`](../../../docs/av1/queue.md); the reading is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §A1, *Cutting the decode*.

```bash
lab/av1/tools.sh && ARMS="simd simd-mt simd-prof" lab/av1/dav1d-wasm/build.sh
lab/decode-bench/fetch_decoder.sh && client/transport-ts/build.sh     # as lab/av1/fill
lab/av1/fetch_data.sh rf_fluoro mr_ispy1 us_liver
JOBS=4 lab/av1/.venv/bin/python lab/av1/decspeed/make_variants.py lab/.av1-build lab/.av1-work/decspeed \
  lab/av1/data/rf_fluoro lab/av1/data/mr_ispy1 lab/av1/data/us_liver               # ~30 min
node lab/av1/decspeed/profile.mjs --frames lab/.av1-work/decspeed --ext av1 --repeat 2
NODE_PATH=$(npm root -g) node lab/av1/decspeed/screen.mjs --frames lab/.av1-work/decspeed \
  --arms htj2k,av1,av1-cpu6,…,av1-t4@3 --rounds 6 --out screen.json                # ~1 h
NODE_PATH=$(npm root -g) node lab/av1/fill/run.mjs --frames lab/.av1-work/decspeed --cores 3 \
  --arms htj2k,av1,av1-t4@2/3,… --rates 50000 --out fill.jsonl
```

**Frames.** The three series of row FILL, every frame: fluoroscopy (18 × 768², 12-bit), MR
(58 × 512², 12-bit) and ultrasound (70 × 760×421, RGB 8). HTJ2K is the served profile. Each AV1
variant is libaom 3.15.1 lossless intra, one temporal unit a frame, `cpu-used` 0 unless named;
`make_variants.py` decodes every unit alone with native dav1d against the checksum written when the
series was fetched, and stops on the first that is not exact. **All 9 variants were exact on all
146 frames.**

| variant | settings | fluoroscopy | MR | ultrasound |
| --- | --- | --- | --- | --- |
| `av1` | the default (row FILL's) | 1.024 | 1.034 | 1.117 |
| `cpu6` | `--cpu-used=6` | 1.039 | 1.058 | 1.747 |
| `ai9` | `--allintra --cpu-used=9` | 1.074 | 1.097 | 1.830 |
| `sb64` | `--sb-size=64` | 1.023 | 1.033 | 1.116 |
| `lean` | every optional intra tool off (filter, edge, smooth, Paeth, CfL, palette, IntraBC, angles) | 1.089 | 1.100 | 1.840 |
| `t2` | 2 tile columns | 1.025 | 1.035 | 1.116 |
| `t4` | 4 tile columns | 1.025 | 1.038 | 1.121 |
| `t2x2` | 2 × 2 tiles | 1.026 | 1.037 | 1.119 |
| `t4sb64` | 4 tile columns, 64² superblocks | 1.025 | 1.037 | 1.120 |

Bytes over HTJ2K's, whole series. Tiles cost 0.1–0.4 %.

**Profile** (`profile.mjs`: the product's `decode-av1.js` on the `simd-prof` build in Node 22,
V8's sampling profiler at 100 µs, self time by function and stage, every frame exact; `--mutate
sample` made it 0 exact on every series). One thread, 2 decodes of every frame:

| series | ms a frame | entropy decoding | intra prediction | inverse transform | copy-out (JS) |
| --- | --- | --- | --- | --- | --- |
| fluoroscopy | 93 | 84 % | 9.4 % | 2.3 % | 3.2 % |
| MR | 32.5 | 81 % | 11.7 % | 2.5 % | 4.1 % |
| ultrasound | 63 | 66 % | 18.3 % | 3.8 % | 10.8 % |

`dav1d_msac_decode_symbol_adapt_c` alone is 34–41 %, `decode_coefs` 16–19 %, the equiprobable bool
9–17 %: a lossless frame is almost all coefficient tokens through the arithmetic decoder, which is
serial within a tile and has no SIMD form. The 4-tile variant profiles the same on one thread
(92, 32, 62 ms). So only tiles decoded in parallel can cut it; no tool switched off can.

**Screen** (`screen.mjs`: ms a frame, one frame at a time through the product's decoder worker in
headless Chromium 141, the browser on three cores, at 4× three cores each a quarter as fast; a fresh
browser per (round × throttle), Williams-ordered, series and arms rotated inside it; 6 rounds, the
median of each round's median; **every arm exact on every frame of every round**; `--mutate sample`
turned every arm to 0 exact). `@T` is the `simd-mt` build with T threads; × is paired by round
against `av1`:

| arm | fluoroscopy 1× · 4× | MR 1× · 4× | ultrasound 1× · 4× |
| --- | --- | --- | --- |
| `htj2k`, ms | 10.3 · 39.8 | 5.04 · 18.6 | 8.51 · 32.4 |
| `av1`, ms | 75.7 · 314 | 28.0 · 113 | 51.2 · 214 |
| `cpu6` | ×0.97 · 0.99 | ×0.94 · 0.97 | ×1.26 · 1.30 |
| `ai9` | ×0.94 · 0.94 | ×0.99 · 0.97 | ×1.27 · 1.28 |
| `lean` | ×0.90 · 0.93 | ×0.93 · 0.94 | ×1.19 · 1.20 |
| `sb64` | ×1.01 · 1.00 | ×1.00 · 0.98 | ×1.00 · 1.01 |
| `t4`, one thread | ×1.00 · 1.00 | ×0.99 · 1.02 | ×0.99 · 0.99 |
| `av1@2`, no tiles | ×1.01 · 0.98 | ×1.04 · 0.96 | ×1.02 · 0.97 |
| `t2@2` | ×0.55 · 0.56 | ×0.56 · 0.52 | ×0.68 · 0.61 |
| `t4@2` | ×0.53 · 0.53 | ×0.55 · 0.51 | ×0.60 · 0.55 |
| `t2x2@2` | ×0.55 · 0.50 | ×0.56 · 0.49 | ×0.65 · 0.61 |
| `t4@3` | ×0.43 · 0.41 | ×0.42 · 0.39 | ×0.50 · 0.45 |
| `t2x2@3` | ×0.44 · 0.41 | ×0.46 · 0.39 | ×0.47 · 0.44 |
| `t4sb64@3` | ×0.39 · 0.37 | ×0.41 · 0.39 | ×0.44 · 0.39 |

So: no encoder setting helps by more than 10 % (`lean`, at +6–72 % bytes), and on the ultrasound
the faster presets decode slower — more bytes to entropy-decode. dav1d's threads do nothing
without tiles (a lossless frame has no loop filters for them to run) and with tiles split the
frame's entropy decoding: 2 threads ×0.50–0.68, 3 threads ×0.37–0.50. Frame by frame the best,
`t4sb64@3`, is still 2.6–2.9× HTJ2K's time.

**Fill** (`lab/av1/fill/run.mjs --cores 3`: row FILL's harness, the downloader against the real
server behind the relay at 50 Mbit/s and 40 ms, headless Chromium 141; `--cores 3` makes 4× three
slowed cores for the whole browser, not a quarter-core per thread, so its 4× AV1 times are longer
than row FILL's; 12 rounds, Williams-ordered, 17 of 504 visits `VOID` and dropped, n = 9–12 a cell;
**every frame of every visit exact**, 24 528 of 24 528; `--mutate sample` turned three arms to
0/18). `EXT@T/D` is T threads × D decoders on frames `NNN.EXT`. Seconds to every frame on the page,
medians:

| arm | fluoroscopy 1× · 4× | MR 1× · 4× | ultrasound 1× · 4× |
| --- | --- | --- | --- |
| `htj2k` (3 decoders) | 1.73 · 1.75 | 1.98 · 1.99 | 3.15 · 3.18 |
| `av1` (3 decoders, today) | 1.83 · 3.20 | 2.05 · 3.69 | 3.54 · 7.37 |
| `av1/6` | 1.83 · 3.31 | 2.06 · 3.76 | 3.54 · 7.43 |
| `av1-t4sb64@3/1` | 1.79 · 3.21 | 2.05 · 3.60 | 3.52 · 7.62 |
| `av1-t4sb64@2/2` | 1.79 · 3.25 | 2.05 · 3.75 | 3.52 · 7.50 |
| `av1-t4sb64@2/3` | 1.80 · 3.32 | 2.05 · 4.09 | 3.52 · 7.71 |
| `av1-t4sb64@3/3` | 1.78 · 3.32 | 2.04 · 4.25 | 3.51 · 7.80 |

At 1× every AV1 arm follows its bytes; threads trim the decoding left after the last byte by
20–40 ms. At 4× AV1 is the clock in every arm, slower than HTJ2K in every paired fill (1.81–2.45×).
The arms differ by −3 to +4 % on two series. Oversubscribing the three cores (2 × 3, 3 × 3 threads)
costs 11–15 % on the MR. The decoder's total CPU work sets the fill's time, and only fewer coded
symbols would cut it.

**Pins.** As [`../fill`](../fill/README.md); `simd-mt.wasm` 635 278 B (`-pthread`,
`PTHREAD_POOL_SIZE=4`), `simd-prof.wasm` 646 295 B. Nothing built or generated is committed.
