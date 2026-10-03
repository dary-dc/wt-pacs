# lab/av1/svcq — one scalable payload: a lossy base and a lossless top

Queue row 18 (SVCQ) of [`docs/av1/queue.md`](../../../docs/av1/queue.md). One AV1 payload whose
base layer is a lossy picture (half size, or full size at a coarser quantizer) and whose top layer
is lossless and predicted from it: bytes, the base's quality, the top's exactness, and decode time
of the base alone and of both. The verdict is in [`docs/av1/README.md`](../../../docs/av1/README.md)
§A5.

```bash
lab/av1/svc/build.sh && lab/av1/svcq/build_wasm.sh        # encoder (patched), dav1d-WASM simd-op
lab/av1/fetch_data.sh rf_fluoro mr_ispy1 us_liver
python3 lab/av1/svcq/svcq.py lab/.av1-build lab/.av1-work/svcq OUT.tsv lab/av1/data/us_liver \
  lab/av1/data/rf_fluoro lab/av1/data/mr_ispy1                                     # ~25 min
NODE_PATH=$(npm root -g) node lab/av1/svcq/time.mjs --rounds 15 --throttles 1,4   # ~2 h
NODE_PATH=$(npm root -g) node lab/av1/svcq/time.mjs --rounds 1 --throttles 1 --mutate sample
```

## How

**Encoder.** libaom 3.15.1's `svc_encoder_rtc` (row SVC, [`../svc`](../svc/README.md)), its
command line patched with `--layer-q=Qbase,0` (one quantizer per layer; the library unchanged).
Layering mode 5: two spatial layers, one temporal; the top references the base (inter-layer) and
its own previous frame, the base its own previous frame. Half size is the example's 1/2 scaling,
full size `-r 1/1,1/1`. Base quantizer 20, 40, 55 (0..63); speed 7; a keyframe only at the start.
"single" is the same encoder at one layer, quantizer 0 — single-layer lossless AV1.

**Checked.** The top: every frame against the checksum written when the series was fetched (dav1d
CLI, `--alllayers 0`, the two-layer stream). The base, lossy, is measured: mean PSNR over frames
(peak 2^B − 1 at the coded depth B) and max |Δ| against the input — for a half-size base, against
the input's 2×2 mean, so it holds the encoder's downscaling filter as well as its coding loss (the
ultrasound's 421 rows, padded to 422, came out as 212 rows, not 211; compared over 211).

**Decode time.** `bench.mjs` in Node and in headless Chromium 141, at 1× and 4×
(`lab/scripts/cpu_throttle.mjs`): each arm decodes a set's first 18 temporal units in order on a
fresh decoder, after an untimed pass on another, and the time is the run's mean ms a frame —
WebCodecs needs a key chunk after every flush, so a group cannot be timed frame by frame on it, and
every arm is timed the same way. Base quantizer 40. Each (environment × throttle) cell is a fresh
process each round, cells in a Williams order (`lab/order.mjs`), sets and arms rotating inside;
15 rounds; median [min–max]. dav1d-WASM is row WASM's `simd` with
[`dav1d_wrap_op.c`](dav1d_wrap_op.c), which opens the decoder with an operating point and
`all_layers` 0 (`build_wasm.sh`, 623 138 B; lab only).

## Which picture a decoder returns

| decoder | units fed | returns |
| --- | --- | --- |
| dav1d-WASM as the product opened it (`all_layers` 1, dav1d's default) | both layers | base and top mixed, then an error (−28): **not usable** (*corrected by row SVCDEC:* the wrapper kept one picture a unit; it now returns the base, then the top, exact — [`adr-unit.md`](../../../docs/av1/adr-unit.md) §6) |
| dav1d-WASM, operating point 0, `all_layers` 0 | both layers | the top, exact |
| dav1d-WASM, operating point 1 | both layers, or the base's alone | the base |
| WebCodecs (Chromium 141), 8-bit | both layers | the top, exact |
| WebCodecs | the base's alone | the base |

WebCodecs has no way to choose an operating point: it returns the highest layer of what it is fed,
so the base alone means sending (or cutting out) the base's units. `decode-av1.js` as shipped would
need `all_layers` 0 before it could take a scalable payload.

## Bytes

Bytes over HTJ2K's (row SIZE's served profile on the same series); the base also in % of HTJ2K's
bytes; the total over single-layer lossless AV1 from the same encoder:

| set | coding | base, % of HTJ2K | base PSNR, max \|Δ\| | total / HTJ2K | total / single |
| --- | --- | --- | --- | --- | --- |
| `us_liver`, RGB 8 | single | — | — | 1.581 | 1 |
| | half, q 20 / 40 / 55 | 10.4 / 2.4 / 0.23 % | 28.0 / 27.2 / 25.8 dB*, 155–185 | 1.640 / 1.594 / 1.585 | 1.037 / 1.008 / 1.002 |
| | full, q 20 / 40 / 55 | 38.8 / 11.4 / 1.6 % | 41.0 / 32.4 / 27.0 dB, 44–164 | 1.499 / 1.556 / 1.590 | 0.948 / 0.984 / 1.005 |
| `rf_fluoro`, 12-bit | single | — | — | 1.067 | 1 |
| | half | 0.48 / 0.15 / 0.08 % | 45.0 / 40.8 / 35.5 dB*, 527–1990 | 1.059 / 1.065 / 1.067 | 0.992 / 0.998 / 1.000 |
| | full | 1.52 / 0.41 / 0.20 % | 44.6 / 41.7 / 37.6 dB, 429–2060 | 1.043 / 1.062 / 1.066 | 0.977 / 0.995 / 0.999 |
| `mr_ispy1`, 11 bits at 12 | single | — | — | 1.102 | 1 |
| | half | 0.30 / 0.07 / 0.03 % | 48.2 / 44.8 / 42.1 dB*, 345–937 | 1.092 / 1.099 / 1.099 | 0.991 / 0.997 / 0.998 |
| | full | 0.94 / 0.19 / 0.07 % | 47.8 / 45.0 / 42.3 dB, 201–825 | 1.081 / 1.096 / 1.099 | 0.981 / 0.995 / 0.998 |

\* against the input's 2×2 mean. Every top frame of every coding exact: 70, 18 and 58 frames ×
6 codings, and the synthetic grey 10 and RGB 8 sets (16 frames each) too. On those, the total over
single-layer is 0.90–1.00 for grey 10 and **1.29–3.94 for the posterised RGB 8** (screen-like
content, where the lossy base is a poor predictor of an exact frame); the real ultrasound is not
like it.

**Scalability costs nothing in bytes on the real series**: the top codes the frame for what the
base did not, so the total is 0.95–1.04 of single-layer lossless AV1, and below it whenever the
base is good. What it cannot change is that lossless AV1 is itself 1.07–1.58 of HTJ2K here (row
SIZE, at the real-time encoder's speed).

## Decode time

ms a frame, median [min–max], n = 15; Chromium (Node within 11 % on every dav1d cell over 15 ms and
up to 20 % on the smaller bases, in the same order); every top and single frame exact, 270/270 a cell:

| set | arm | 1× | 4× |
| --- | --- | --- | --- |
| `us_liver` | single, dav1d-WASM | 67.7 [63.1–80.0] | 304 [289–333] |
| | half: base / both | 8.6 [7.7–11.3] / 75.9 [69.9–85.6] | 38.2 [34.0–44.0] / 341 [314–369] |
| | full: base / both | 31.4 [29.0–35.3] / 85.7 [83.1–107.9] | 142 [131–155] / 395 [358–464] |
| | single, WebCodecs | 37.9 [34.8–41.1] | 158 [148–179] |
| | half: base / both, WebCodecs | 2.1 [1.8–3.1] / 40.4 [37.1–48.8] | 6.1 [4.9–7.1] / 157 [143–193] |
| `rf_fluoro` | single | 88.0 [82.9–92.5] | 398 [374–425] |
| | half: base / both | 4.2 [3.8–5.1] / 94.1 [86.1–108.2] | 19.1 [17.6–26.6] / 419 [391–457] |
| | full: base / both | 14.6 [14.0–17.7] / 103.4 [96.4–113.0] | 68.1 [63.8–85.3] / 461 [421–502] |
| `mr_ispy1` | single | 32.1 [29.6–35.6] | 145 [133–165] |
| | half: base / both | 0.78 [0.68–1.57] / 34.0 [30.6–37.2] | 3.8 [2.9–6.5] / 150 [144–164] |
| | full: base / both | 2.6 [2.1–6.3] / 35.8 [31.8–44.0] | 13.1 [10.2–15.9] / 161 [143–190] |

The exact frame through both layers costs 3–12 % more than single-layer lossless with a half-size
base, 11–30 % with a full-size one (1× and 4×); the half-size base alone decodes in 2–13 % of single's time
(dav1d-WASM) and WebCodecs' in 2.1 ms on the ultrasound. Container numbers, not a phone's; WebCodecs
on the 8-bit series only (it refuses 12-bit, row WCAP).

## The checks were mutated

* top coded lossy (`--layer-q=40,8`), grey 10: 0/16 top frames exact;
* one truth checksum corrupted: 15/16;
* the base PSNR on the input itself: 99 (identical); on the input + 1: 60.2 dB = 20·log10(1023),
  max |Δ| 1;
* `--mutate sample` (one bit of every decoded frame) in the timing bench: all 20 checked cells to
  0/18.

## Verdict

One scalable payload with a lossy base and a lossless top **is exact and costs −5 to +4 % in bytes
over single-layer lossless AV1** — the scalability itself is nearly free — and 3–30 % in decode time
for the exact frame. Its base is cheap: a half-size base is 0.03–2.4 % of HTJ2K's bytes at q 40–55
and decodes in a few ms. But the payload inherits lossless AV1's size: 1.04–1.64 of HTJ2K's bytes
against row PREVIEW's separate lossy preview plus exact HTJ2K at 1.008 (fluoroscopy) and 1.07
(ultrasound). Against row RESID's lossy preview plus an HTJ2K residual, 0.947–1.002 of HTJ2K's bytes and 1.31–1.89×
its decode through WebCodecs, it loses on both: its exact frame is a lossless AV1 decode, 5–10× HTJ2K's
(row SPEED), plus 3–30 %. The product decoder
cannot take such a payload until it opens dav1d with `all_layers` 0; WebCodecs takes it but cannot
be asked for the base.
