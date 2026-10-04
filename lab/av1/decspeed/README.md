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
