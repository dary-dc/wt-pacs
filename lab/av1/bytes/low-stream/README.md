# lab/av1/bytes/low-stream — where lossless bytes and decode can still be cut

Queue row 36 (ENCX) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md). Row 28 (LLSIZE) put AV1 alone
under HTJ2K's bytes by representing the samples for it: the low bits apart on grey, JPEG 2000's
reversible colour transform on RGB. This asks whether that gain is AV1's or the representation's, and
what is left to cut in bytes and in decode: the low stream's coder, the split's k, temporal noise and
libaom's remaining tools. The verdict is in [`docs/av1/README.md`](../../../../docs/av1/README.md) §A1.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh
client/decode/wasm/fetch_openjph.sh                                 # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160    # builds ojph_compress once
lab/av1/fetch_data.sh
W=lab/.av1-work; P=lab/av1/.venv/bin/python; SETS=$(ls -d lab/av1/data/*/ | grep -v dicom)
$P lab/av1/bytes/low-stream/noise.py $W/encx-noise.json $SETS                              # seconds
$P lab/av1/bytes/low-stream/encx.py lab/.av1-build $W/encx $W/encx-bytes.json $SETS         # ~40 min, 4 cores
STAGE=tools $P lab/av1/bytes/low-stream/encx.py lab/.av1-build $W/encx $W/encx-tools.json $SETS
$P lab/av1/bytes/low-stream/report.py $W/encx-bytes.json $W/encx-noise.json $W/encx-tools.json
$P lab/av1/bytes/low-stream/make_frames.py $W/encx $W/encx-frames $SETS
NODE_PATH=$(npm root -g) node lab/av1/bytes/low-stream/encx.mjs --rounds 10 --throttles 1,4 --out $W/encx-time.json   # ~25 min
FRAMES=2 $P lab/av1/bytes/low-stream/encx.py lab/.av1-build $W/encx-smoke $W/s.json lab/av1/data/mr_ispy1 lab/av1/data/us_liver
FRAMES=2 $P lab/av1/bytes/low-stream/mutate.py lab/.av1-build $W/encx-smoke lab/av1/data/mr_ispy1 lab/av1/data/us_liver
```

## How

**Frames.** Row 28's: every series' first 8 frames, fewer where a frame is large (6 of the 10-bit
tomosynthesis, 3 and 2 of the projections). HTJ2K is the served profile (OpenJPH 0.31.0) on the same
frames, the denominator of every ratio.

**Planes.** v is a sample plus the series' offset; on RGB it is the reversible colour transform's
Y, Cb + 256, Cr + 256 (9 bits). `direct` is v, `topk` is v ≫ k and `lowk` is v & (2^k − 1), for
k = 1, 2, 3 wherever the top is 6–12 bits.

**Coders**, each a plane's stream, one unit a frame:

| coder | what | decoded in the browser by |
| --- | --- | --- |
| `av1:VARIANT` | libaom 3.15.1 `--lossless=1 --cpu-used=0 --kf-max-dist=0`, row 28's per-set best variant (`--sb-size=64` on CT and the projections, `--tune-content=screen --sb-size=64` on the rest), `+inter`: one keyframe and the rest predicted, `--auto-alt-ref=0` | dav1d-WASM `simd` 1.5.4 (623 146 B), or WebCodecs where the stream is ≤ 10 bits |
| `j2k` | OpenJPH 0.31.0 as the served profile, colour transform off | OpenJPH (`@cornerstonejs/codec-openjph` 2.4.11) |
| `raw` | the k bits packed, MSB first | a JS unpack |
| `deflate` | `raw`, then deflate at level 9 (Python 3.11's `zlib`, zlib 1.3, raw stream) | `DecompressionStream("deflate-raw")`, then the unpack |
| `deflate-u` | one sample a byte, then deflate | as `deflate` |

**Checked.** Every stream is decoded natively (dav1d 1.5.4, `ojph_expand`, Python's inflate) and
matched with its plane, frame by frame; an intra AV1 stream's last unit is decoded alone too. Every
coding is then decoded again from its stored units, merged and matched with the checksum written when
the series was fetched: **240/240 codings exact** in the bytes stage. In the browser every merged frame
is hashed against that checksum again.

**Decode time.** `encx.mjs` in headless Chromium 141 (playwright 1.56.1), Node 22.22.0. Each arm is a
decoder worker of its own behind `decoder.js`'s protocol, `worker.js` for the part frames and
`client/decode/decoder.js` itself for HTJ2K; a frame's time is the worker's `decodeStart` to
`decodeEnd`: its bytes in, the merged samples and the range out. WebCodecs and the inflate run beside
the WASM decoder. One warm-up frame a worker, then every frame one at a time. Every throttle cell a
fresh browser, the cells in a Williams order each round (`lab/order.mjs`), sets and arms rotating
inside; 4× is `lab/scripts/cpu_throttle.mjs` on the browser's process tree; 10 rounds; median of the
round medians [range], and the median of round-paired ratios. **7 100/7 100 frames exact.** A
container's times, not a phone's; one browser at a time on 4 cores, nothing else running.

**Encode** was not timed: four encodes at once, as row 28's.

## Fairness first: HTJ2K on the same representations

Bytes over HTJ2K served:

| set | frames | HTJ2K served | HTJ2K direct | HTJ2K top2 + low2 | HTJ2K top2 + low2 deflated | AV1 low2 (row 28) | AV1 low2 ÷ HTJ2K top2 + low2 deflated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 8 | 1.36 MB | 1.000 | 1.103 | 0.985 | 0.902 | 0.916 |
| `xa_dynact16` | 8 | 1.86 MB | 1.000 | 1.077 | 0.990 | 0.987 | 0.997 |
| `mr_ispy1` | 8 | 1.46 MB | 1.001 | 1.124 | 0.991 | 0.977 | 0.986 |
| `rf_fluoro` | 8 | 4.12 MB | 1.000 | 1.096 | 0.984 | 0.942 | 0.957 |
| `dbt12_ea1141` | 8 | 4.01 MB | 1.000 | 1.093 | 0.988 | 0.941 | 0.952 |
| `dbt10_ea1141` | 6 | 3.40 MB | 1.000 | 1.117 | 0.988 | 0.942 | 0.953 |
| `dbtproj_ge` | 2 | 8.14 MB | 1.000 | 1.090 | 0.984 | 0.953 | 0.969 |
| `dbtproj_holo` | 3 | 5.84 MB | 1.000 | 1.117 | 0.984 | 0.923 | 0.938 |
| `us_liver` | 8 | 2.10 MB | 1.000 | 1.204 | 1.106 | 0.962 (RCT, whole) | — |

`HTJ2K direct` is v (or the RCT's planes) through OpenJPH: it reproduces the served bytes within
0.1 %. **HTJ2K gains 0.9–1.6 % from the split, and only with its low bits deflated**; coded as two
HTJ2K codestreams the split costs it 8–20 %. AV1 gains 1.3–9.8 % from the same representation, so
**row 28's gain is AV1's**: on the same split AV1 is 0.916–0.997 of HTJ2K. On RGB the colour transform
is HTJ2K's own already. The split costs HTJ2K's decode 1.12–1.69× at 1× and 1.02–1.64× at 4× (the
inflate and the merge in JS; table below), for those 1–2 % of bytes.

## The low stream

AV1 top, the low k bits by each coder, the whole coding over HTJ2K:

| set | low1 AV1 | +raw | +deflate | +deflate-u | low2 AV1 | +raw | +deflate | +deflate-u | low3 AV1 | +raw | +deflate | +deflate-u |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 0.911 | 0.947 | 0.913 | 0.949 | **0.902** | 0.977 | 0.903 | 0.958 | 0.969 | 1.022 | 0.909 | 0.985 |
| `xa_dynact16` | 1.052 | 1.079 | 1.054 | 1.080 | 0.987 | 1.043 | 0.988 | 1.027 | 0.949 | 1.033 | **0.948** | 1.003 |
| `mr_ispy1` | 0.981 | 0.984 | 0.983 | 1.020 | **0.977** | 0.983 | 0.978 | 1.033 | 0.993 | 1.003 | 0.992 | 1.067 |
| `rf_fluoro` | 0.966 | 0.965 | 0.965 | 0.994 | 0.942 | 0.941 | 0.941 | 0.983 | 0.940 | 0.938 | **0.937** | 0.996 |
| `dbt12_ea1141` | 0.967 | 1.034 | 0.973 | 1.007 | 0.941 | 1.077 | 0.946 | 0.997 | **0.936** | 1.139 | 0.939 | 1.011 |
| `dbt10_ea1141` | 0.946 | 1.031 | 0.951 | 0.994 | **0.942** | 1.113 | 0.945 | 1.009 | 0.960 | 1.217 | 0.961 | 1.049 |
| `dbtproj_ge` | — | — | — | — | 0.953 | 0.984 | 0.951 | 0.990 | 1.000 | 0.993 | **0.944** | 0.998 |
| `dbtproj_holo` | — | — | — | — | 0.923 | 0.923 | **0.921** | 0.969 | 1.003 | 0.936 | 0.933 | 0.999 |
| `us_liver` (RCT) | 0.982 | 1.199 | 0.994 | 1.052 | 1.022 | 1.477 | 1.056 | 1.133 | 1.075 | 1.788 | 1.177 | 1.239 |

The low two bits cost AV1 1.34–2.01 bits a sample and deflate 1.35–1.99 (raw is 2): **the low stream
is near noise, and deflate codes it within −0.2 to +0.5 points of HTJ2K's bytes of AV1 on every grey
series.** One sample a byte deflates 3–7 points worse; raw costs up to 27 points where the low bits
are not noise (the tomosynthesis volumes' flat background). On the ultrasound no split beats the RCT whole
(0.962): its low bits are not noise (σ ≈ 4, below).

**Corrected, row 28.** Row 28 found three low bits worse than two on every series (`low3` 0.969–1.003),
but it tried libaom's defaults only there; `--tune-content=screen` it tried on low2 alone. With it the
3-bit low stream is 11 % smaller on the cone-beam set (low3 with defaults 1.000 of HTJ2K, with
`--tune-content=screen` 0.949; the low stream alone 11 % smaller), and k = 3 is the best split on four series.

## The split per series

σ is the noise's scale over the samples whose 2×2 neighbourhood is not flat: 1.4826 × the median
|residual| of LOCO-I's median predictor (`noise.py`). The oracle takes, per frame, the k and the low
coder with the fewest bytes:

| set | σ | oracle k a frame | oracle | k = 2, AV1 low (row 28) | k̂ = ⌊log2 σ⌋ | its bytes | k̂ = ⌊log2 σ⌋ − 1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 11.9 | 2 × 8 | 0.902 | 0.902 | 3 | 0.909 | 2 |
| `xa_dynact16` | 66.7–68.2 | 3 × 8 | **0.948** | 0.987 | 3 | 0.948 | 3 (clamped) |
| `mr_ispy1` | 10.4 | 2 × 8 | 0.977 | 0.977 | 3 | 0.992 | 2 |
| `rf_fluoro` | 17.8–32.6 | 3 × 8 | **0.937** | 0.942 | 3 | 0.937 | 3 |
| `dbt12_ea1141` | 23.7 | 3 × 8 | **0.936** | 0.941 | 3 | 0.936 | 3 |
| `dbt10_ea1141` | 10.4 | 2 × 6 | 0.942 | 0.942 | 3 | 0.960 | 2 |
| `dbtproj_ge` | 29.7 | 3 × 2 | **0.944** | 0.953 | 3 | 0.944 | 3 |
| `dbtproj_holo` | 11.9–13.3 | 2 × 3 | 0.921 | 0.923 | 3 | 0.933 | 2 |
| `us_liver` (RCT) | 3.5–4.4 | 1 × 8 | 0.982 (the RCT whole: 0.962) | 1.022 | 1–2 | 0.991 | 1 |

The oracle's k never changes inside a series, so per series is enough. It gains 0.5–3.9 % over k = 2 on
the four series with σ ≥ 17 and 0–0.2 % on the others. **k̂ = ⌊log2 σ⌋, the low bits under the noise's
scale, is right on those four and wrong on the other four (+0.7–1.8 %)**; ⌊log2 σ⌋ − 1 matches the
oracle on all nine, but it was fitted to these nine — one parameter, no held-out series — so it is a
candidate, not a measured rule. The bit planes' own entropy given their neighbours is 0.99–1.00 bits on
every plane up to the fourth of every grey series, and does not tell k at all.

## Temporal noise

The set's frames as one group (one keyframe, the rest predicted), bytes over HTJ2K:

| set | AV1 low2, intra | top inter, low intra | top intra, low inter | both inter | direct inter |
| --- | --- | --- | --- | --- | --- |
| `ct_lidc` | **0.902** | 0.932 | 0.906 | 0.936 | — |
| `xa_dynact16` | 0.987 | **0.980** | 0.991 | 0.984 | — |
| `mr_ispy1` | **0.977** | 0.990 | 0.998 | 1.011 | 1.044 |
| `rf_fluoro` | 0.942 | 0.942 | 0.942 | 0.942 | 1.020 |
| `dbt12_ea1141` | **0.941** | 0.952 | 0.977 | 0.989 | 1.079 |
| `dbt10_ea1141` | **0.942** | 0.949 | 0.953 | 0.961 | 0.985 |
| `us_liver` (RCT top2 + low2) | 1.022 | 0.961 | 0.973 | 0.911 | **0.880** |

**None of the noise is predictable across frames**: the low stream inter is 0–3.6 % larger than intra
on every grey series. The top inter gains 0.7 % on the cone-beam set alone. On the ultrasound (lossy-sourced, outside the
target series) inter pays, as row 28 found, on the RCT whole; split, it pays less. The ultrasound's RCT inter here is 0.880, row
28's 0.850: this run carries `--tune-content=screen --sb-size=64`, row 28's inter did not (row 28's
`inter-screen`, 0.854, puts the cost on the superblock size, not measured alone).

## libaom's remaining lossless tools

Each tool off on both streams, and `--tune-content=screen` (palette and intra block copy allowed) on
the low stream alone, against row 28's coding on the same frames; bytes over it (`STAGE=tools`,
118/118 codings exact):

| set | row 28 over HTJ2K | screen on the low only | … without intra block copy | … without palette | screen on neither | no filter-intra | no intra-edge | no smooth | no paeth | no palette | no intra block copy | no angle delta | no directional | no CfL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 0.902 | 1.000 | 1.000 | 1.069 | 1.000 | 1.004 | 1.000 | 1.002 | 1.000 | 1.092 | 1.000 | 1.005 | 1.012 | — |
| `xa_dynact16` | 0.987 | 1.010 | 1.010 | 1.056 | 1.010 | 1.003 | 1.000 | 1.002 | 1.000 | 1.052 | 1.001 | 1.003 | 1.013 | — |
| `mr_ispy1` | 0.977 | 1.000 | 1.000 | 1.073 | 1.000 | 1.003 | 1.000 | 1.003 | 1.000 | 1.073 | 1.000 | 1.001 | 1.003 | — |
| `rf_fluoro` | 0.942 | 1.000 | 1.000 | 1.063 | 1.000 | 1.001 | 1.000 | 1.002 | 1.000 | 1.062 | 1.000 | 1.001 | 1.005 | — |
| `dbt12_ea1141` | 0.941 | 1.000 | 1.000 | 1.060 | 1.000 | 1.003 | 1.000 | 1.002 | 1.000 | 1.060 | 1.000 | 1.004 | 1.008 | — |
| `dbt10_ea1141` | 0.942 | 1.006 | 1.006 | 1.080 | 1.006 | 1.003 | 1.000 | 1.003 | 1.000 | 1.076 | 1.001 | 1.001 | 1.003 | — |
| `dbtproj_ge` | 0.953 | 1.000 | 1.000 | 1.058 | 1.000 | 1.002 | 1.000 | 0.998 | 1.000 | 1.051 | 1.000 | 1.001 | 1.001 | — |
| `dbtproj_holo` | 0.923 | 1.000 | 1.000 | 1.075 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.074 | 1.000 | 1.001 | 1.003 | — |
| `us_liver` (RCT top2 + low2) | 1.022 | 1.003 | 1.004 | 1.046 | 1.003 | 1.002 | 1.000 | 1.005 | 1.000 | 1.045 | 1.001 | 1.001 | 1.006 | 1.001 |

**Palette is the one tool that matters, and it works on the low stream**: off there alone the coding
grows 4.6–8.0 %, off on both 4.5–9.2 %, and libaom already allows it on the low stream without
`--tune-content=screen` wherever row 28 did not ask for it. Intra block copy, Paeth and the intra edge
filter move nothing (≤ 0.1 %); each other tool off costs 0–1.3 %, but smooth intra on one set of
projections (−0.2 %). `--tune-content=screen` on the top stream is worth 0.6–1.0 % on the cone-beam
set and the 10-bit tomosynthesis and nothing elsewhere. Nothing is left in libaom's tools.

## Decode a frame

Chromium, ms a frame, median of 10 round medians; in brackets the round-paired ratio to row 28's
coding (`av1-low2`, AV1 top and low through dav1d-WASM), and to HTJ2K:

| set | throttle | HTJ2K | row 28 (low2, dav1d) | low2 deflated, dav1d | low3 deflated, dav1d | low3 deflated, WebCodecs | low2 deflated, WebCodecs | HTJ2K top2 + low2 deflated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 1× | 6.62 | 32.8 (4.95×) | 25.3 (0.78; 3.79×) | 25.9 (0.78; 3.72×) | 16.9 (0.51; 2.45×) | — | 11.3 (1.69×) |
| | 4× | 24.2 | 140 (6.00×) | 101 (0.72; 4.40×) | 98.1 (0.71; 4.01×) | 55.2 (0.40; 2.44×) | — | 36.9 (1.64×) |
| `xa_dynact16` | 1× | 6.78 | 46.1 (6.62×) | 38.0 (0.83; 5.79×) | 33.0 (0.71; 5.06×) | 22.3 (0.49; 3.30×) | — | 11.6 (1.68×) |
| | 4× | 25.1 | 196 (7.87×) | 147 (0.76; 5.99×) | 134 (0.70; 5.28×) | 80.1 (0.39; 3.02×) | — | 35.6 (1.43×) |
| `mr_ispy1` | 1× | 7.06 | 37.3 (5.46×) | 27.2 (0.74; 4.01×) | 26.0 (0.71; 3.73×) | 16.2 (0.43; 2.31×) | 19.4 (0.53; 2.76×) | 11.7 (1.67×) |
| | 4× | 25.9 | 164 (6.27×) | 114 (0.70; 4.67×) | 105 (0.62; 4.08×) | 53.0 (0.34; 2.10×) | 66.1 (0.39; 2.57×) | 36.8 (1.46×) |
| `rf_fluoro` | 1× | 13.8 | 90.4 (6.59×) | 68.2 (0.73; 4.99×) | 57.9 (0.64; 4.22×) | 39.6 (0.44; 2.85×) | 46.0 (0.50; 3.34×) | 22.1 (1.55×) |
| | 4× | 50.9 | 380 (7.54×) | 277 (0.72; 5.28×) | 238 (0.61; 4.50×) | 157 (0.41; 3.03×) | 175 (0.46; 3.42×) | 74.3 (1.47×) |
| `dbt12_ea1141` | 1× | 17.3 | 94.3 (5.29×) | 71.5 (0.77; 4.02×) | 62.2 (0.67; 3.56×) | 47.5 (0.50; 2.71×) | 51.3 (0.56; 2.92×) | 27.9 (1.59×) |
| | 4× | 68.6 | 411 (6.03×) | 303 (0.73; 4.36×) | 256 (0.64; 3.76×) | 182 (0.45; 2.71×) | 199 (0.48; 2.82×) | 104 (1.54×) |
| `dbt10_ea1141` | 1× | 24.9 | 120 (4.84×) | 87.5 (0.73; 3.52×) | 81.7 (0.68; 3.26×) | 58.7 (0.49; 2.28×) | 59.6 (0.51; 2.45×) | 39.1 (1.60×) |
| | 4× | 108 | 517 (4.96×) | 383 (0.74; 3.41×) | 348 (0.67; 3.28×) | 222 (0.43; 2.08×) | 240 (0.44; 2.27×) | 157 (1.52×) |
| `dbtproj_ge` | 1× | 124 | 749 (6.05×) | 522 (0.70; 4.13×) | 475 (0.62; 3.85×) | — | — | 141 (1.12×) |
| | 4× | 554 | 3 273 (5.91×) | 2 250 (0.70; 4.11×) | 1 965 (0.60; 3.47×) | — | — | 577 (1.02×) |
| `dbtproj_holo` | 1× | 70.0 | 346 (4.94×) | 220 (0.64; 3.09×) | 201 (0.59; 2.86×) | — | — | 86.2 (1.24×) |
| | 4× | 310 | 1 513 (4.71×) | 951 (0.63; 3.02×) | 891 (0.60; 2.87×) | — | — | 350 (1.13×) |

The ultrasound, RCT whole: HTJ2K 12.6 ms at 1× and 47.0 at 4×; dav1d-WASM 53.4 and 236 (4.39×, 4.90×);
WebCodecs 40.3 and 148 (3.15×, 3.11×).

Every ratio lies on the same side of 1 in 10/10 rounds, but HTJ2K's split against HTJ2K whole on the
projections and at 4× on the cone-beam set (faster in 1–2 of 10). A dash: the top stream is over 10 bits, which WebCodecs
refuses (row 3), or the arm was not built for that set.

* **The deflated low stream decodes at 0.64–0.83× of row 28's coding** (1×; 0.63–0.76× at 4×): an
  inflate and an unpack replace the low stream's dav1d-WASM decode.
* **k = 3 is cheaper still, 0.59–0.78× (0.60–0.71× at 4×)**, wherever it is taken: a top one bit
  narrower, and more of the frame left to deflate.
* **WebCodecs for the top, the low deflated, is 0.34–0.56× of row 28's decode**, and 2.1–3.4× HTJ2K's.
  At k = 3 it takes CT and the cone-beam set (13 bits) too, whose top is then 10 bits.
* HTJ2K's split is 1.02–1.69× HTJ2K whole.

## The checks were mutated

* bytes (`mutate.py`, FRAMES = 2, MR and the ultrasound): as built 2/2; the merge's top shifted one bit
  too far 0/2; the unpack's samples in the wrong order 0/2 (the stream's own check too); one truth
  checksum corrupted 1/2; the RCT's inverse rounding the other way 0/2 — 9/9 caught;
* the browser (`encx.mjs`, one round at 1×): `--mutate sample` and `--mutate truth` turned all 53 cells
  to 0; the worker's top shifted one bit too far turned every one of the 41 split cells to 0 and left
  HTJ2K and the RCT whole exact; the worker's RCT inverse rounding the other way turned both ultrasound
  cells to 0/8.

## Verdict

**HTJ2K on the same representation first: it gains 0.9–1.6 % from the split, and only with its low
bits deflated** (0.984–0.991 of HTJ2K whole, for 1.02–1.69× its decode); split into two HTJ2K
codestreams it loses 8–20 %. Row 28's 1.3–9.8 % is AV1's: on the same split AV1 is 0.916–0.997 of
HTJ2K.

Encoding changes over row 28's coding, ranked (bytes over HTJ2K; decode ratio to row 28's coding,
dav1d-WASM in Chromium, 1× and 4×):

1. **The low bits deflated, not coded by AV1** (`DecompressionStream("deflate-raw")`): bytes −0.2 to
   +0.5 points on every grey series; decode **0.64–0.83× at 1×, 0.63–0.76× at 4×**. Not on RGB, where
   no split beats the colour transform whole.
2. **k = 3 on the four series with σ ≥ 17** (cone-beam, fluoroscopy, 12-bit tomosynthesis, one set
   of projections), the low bits deflated: **0.5–3.9 % fewer bytes** (cone-beam 0.987 → 0.948) and
   decode **0.59–0.78× at 1×, 0.60–0.71× at 4×**; k = 2 stays best on the other four. ⌊log2 σ⌋ − 1
   picks the oracle's k on all nine, fitted to them; ⌊log2 σ⌋ alone is wrong on four (+0.7–1.8 %).
   Row 28's "three low bits are worse than two" held at libaom's defaults only (corrected there).
3. **The top through WebCodecs wherever it is ≤ 10 bits, the low deflated**: the same bytes, decode
   **0.34–0.56× of row 28's**, 2.1–3.4× HTJ2K's. k = 3 brings CT and the cone-beam set under 10 bits.
4. Nothing from inter coding of the noise (the low stream inter is 0–3.6 % larger; the top inter
   gains 0.7 % on one series) or from libaom's remaining tools (palette is on already; the rest ±1 %).

*What it means for total time on row 23's links — arithmetic, not measured* (row 34 TOTAL2 measures
it). Where the wire is the clock, totals follow bytes: k = 3 takes the cone-beam set 4 % lower, the
others under 1 %. Where the CPU is the clock (4× on 50 Mbit and on LTE), row 23 found dav1d-WASM AV1
1.4–2.2× HTJ2K's fill and top10+low through WebCodecs 1.02–1.13×; WebCodecs top with the low
deflated decodes at 2.1–3.4× HTJ2K, about what row 13's top10+low did, at 0.937–0.939 of HTJ2K's
bytes on the fluoroscopy and 12-bit tomosynthesis against top10+low's 0.990–0.999 (row 23's whole series; 8 frames here) — so it should hold
row 23's WebCodecs ranking at 5–6 % fewer bytes. Containers, not phones; nothing past four cores is
claimed.
