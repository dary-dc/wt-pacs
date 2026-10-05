# embed

Intra codecs whose one codestream is a preview first and lossless at its end: JPEG 2000 Part 1
with quality layers and progressive lossless JPEG XL, against the served single-layer HTJ2K. Queue
row 22 (EMBED) of [`docs/av1/queue.md`](../../../docs/av1/queue.md), for contrast with the AV1
preview of row 12 ([`../preview`](../preview/README.md)); the verdict is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §A5.

```bash
lab/av1/embed/build.sh                          # OpenJPEG and libjxl, native and WASM (~10 min)
lab/decode-bench/fetch_decoder.sh               # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # builds ojph_compress once
lab/av1/fetch_data.sh
lab/av1/.venv/bin/python lab/av1/embed/encode.py lab/.av1-build lab/.av1-work/embed \
  lab/av1/data/{ct_lidc,mr_ispy1,us_liver,rf_fluoro,xa_dynact16,dbt12_ea1141,dbt10_ea1141}  # ~10 min
node lab/av1/embed/layers.mjs                                     # ~6 min
node lab/av1/embed/layers.mjs --mutate prefix                     # must fail
python3 lab/av1/embed/report.py lab/.av1-work/embed
NODE_PATH=$(npm root -g) node lab/av1/embed/time.mjs --rounds 15 --throttles 1,4 \
  --out lab/.av1-work/embed-rows.json                             # ~50 min
NODE_PATH=$(npm root -g) node lab/av1/embed/time.mjs --rounds 1 --throttles 1 --mutate hash   # must fail
```

## The codings

Every coder takes the PGM/PPM HTJ2K is coded from (a signed series shifted by 2^(B−1), RGB as
stored), one file a frame; every codestream is decoded natively by its own tool and again by the
WASM decoder timed below, and both must match the checksum written when the series was fetched.

* **HTJ2K**, the served profile: `ojph_compress -num_decomps 5 -block_size {64,64} -prog_order RPCL
  -reversible true`.
* **JPEG 2000 Part 1**, OpenJPEG 2.5.4: `opj_compress -n 6 -b 64,64 -p LRCP` — reversible 5/3, the
  reversible colour transform on RGB — single-layer, and **layered** with `-r 400,100,25,1`: three
  lossy layers at those compression factors against the samples at their precision, then lossless.
  LRCP puts each layer's packets before the next's, so a layer is a prefix of the codestream.
* **JPEG XL**, libjxl 0.12.0: `cjxl -d 0 -e 7` (plain) and the same with `-p` (progressive:
  `responsive=1`, squeeze; `progressive_dc=1`, `progressive_ac`). libjxl 0.12.0 is exact from a 12-bit
  PGM, which SIZE's distro 0.7.0 was not.

**A layer's prefix** is the smallest prefix whose decode at that layer count equals the whole
codestream's decode at that layer count, found by binary search with the WASM decoder; decoding
that prefix with every layer it holds gives the same samples, checked on every frame. **JPEG XL's
first picture** is the smallest prefix libjxl flushes a picture from. libjxl pauses at no
progression step in a lossless frame (`dec_frame.h` `SetPauseAtProgressive`: VarDCT only), so a
prefix plus `JxlDecoderFlushImage` is the only way to a preview. Plain JPEG XL is not progressive.
Its prefix flushes the groups decoded so far and leaves the rest blank, at ≤ 32 dB on every set.

**Quality** is PSNR against the source, mean over the series' frames (minimum frame), peak 2^B − 1
for the B bits the series' range needs (13 for CT and cone-beam, 11 for MR); max \|Δ\| over the series.

## Bytes and quality

All frames of row DATA's and row CONTENT's seven sets. Whole codestreams as a share of the HTJ2K
series' bytes; each preview as bytes share · PSNR mean (minimum) · max \|Δ\|:

| set | J2K 1 layer | J2K layered | JPEG XL | JPEG XL progressive | J2K layer 1 (÷400) | J2K layer 2 (÷100) | J2K layer 3 (÷25) | JPEG XL progressive, first picture |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 0.939 | 0.941 | 0.828 | 0.907 | 0.0080 · 37.9 (36.8) · 2081 | 0.0320 · 45.9 (44.4) · 1546 | 0.1278 · 58.6 (57.6) · 118 | 0.4772 · 47.1 (46.0) · 1095 |
| `mr_ispy1` | 0.928 | 0.929 | 0.909 | 0.945 | 0.0070 · 40.4 (37.0) · 472 | 0.0276 · 42.6 (40.7) · 178 | 0.1115 · 46.9 (45.7) · 69 | 0.4449 · 45.3 (42.7) · 402 |
| `us_liver` | 0.930 | 0.932 | 0.858 | 0.917 | 0.0092 · 25.3 (24.2) · 255 | 0.0371 · 28.4 (27.1) · 157 | 0.1488 · 35.1 (33.5) · 59 | 0.1861 · 30.3 (29.0) · 126 |
| `rf_fluoro` | 0.950 | 0.951 | 0.946 | 0.937 | 0.0043 · 40.5 (39.0) · 1068 | 0.0170 · 44.1 (41.9) · 291 | 0.0685 · 47.0 (44.1) · 165 | 0.1118 · 27.8 (27.7) · 2697 |
| `xa_dynact16` | 0.961 | 0.962 | 0.912 | 0.950 | 0.0056 · 37.1 (36.7) · 1609 | 0.0219 · 39.6 (39.2) · 994 | 0.0902 · 44.8 (44.5) · 661 | 0.4593 · 42.1 (41.8) · 1621 |
| `dbt12_ea1141` | 0.954 | 0.955 | 0.933 | 0.940 | 0.0062 · 43.3 (42.2) · 482 | 0.0249 · 45.5 (45.1) · 275 | 0.0999 · 48.7 (48.5) · 125 | 0.0601 · 44.8 (43.9) · 571 |
| `dbt10_ea1141` | 0.942 | 0.943 | 0.866 | 0.922 | 0.0064 · 36.6 (36.0) · 368 | 0.0257 · 40.1 (39.8) · 172 | 0.1027 · 43.7 (43.6) · 71 | 0.0650 · 39.4 (38.5) · 363 |

* **The layers cost 0.09–0.19 %** (layered against single-layer J2K), and **J2K Part 1 is 4–7 %
  smaller than HTJ2K** on every set: the layered codestream, previews included, is 0.93–0.96 of the
  served bytes.
* **J2K's first layer is 0.4–0.9 % of the served bytes at 37–43 dB** on the grey sets (25 dB on the
  RGB ultrasound); the third, 7–15 %, at 44–59 dB (35 dB).
* **Progressive JPEG XL's first picture comes late**: 6–11 % of the bytes on tomosynthesis and
  fluoroscopy, 19 % on the ultrasound and 44–48 % on CT, MR and cone-beam, at 28–47 dB. At J2K's
  first two layers' bytes it draws nothing on any frame; at the third's, only on tomosynthesis. Its
  whole is 0.91–0.95 of HTJ2K; plain JPEG XL is 0.83–0.95, smaller than progressive on six sets.
* **Against row 12's AV1 preview** (fluoroscopy and the ultrasound, the same frames): AV1 reaches
  44 dB on fluoroscopy at 0.78 % of the bytes and J2K at 1.7 % (layer 2); 34–35 dB on the ultrasound
  at 7.0 % and 14.9 % (layer 3). J2K needs about twice AV1's bytes for the same PSNR. Its bytes are
  inside the exact frame, which ends 5–7 % under HTJ2K, while AV1's come on top of it: +0.8 % and +7 %.

## Decode time

ms a frame, a set's first 18 frames decoded in order in one worker, the clock from the first
codestream handed in to the last frame's samples copied out; median over 15 interleaved rounds
[range], and the median of the rounds' paired ratios to OpenJPH's exact decode. Headless Chromium 141,
this container (4 cores), one decoder at a time, every decoder single-threaded WASM with SIMD:
OpenJPH from the shipped package, OpenJPEG and libjxl built by `build.sh` (249 KB and 625 KB `.wasm`,
82 KB and 220 KB gzipped). 22 680/22 680 frames matched their references — the series' checksums
for a whole codestream, `layers.mjs`'s decode for a preview. Mutated, every check failed: the hash, all 42 arms;
a prefix one byte short, all 1 089 layer and 726 first-picture prefixes; an exactness check off by
one sample, every frame in `encode.py` and `layers.mjs`.

| set | arm | 1× ms | 4× ms | 1× ÷ HTJ2K | 4× ÷ HTJ2K |
| --- | --- | --- | --- | --- | --- |
| `ct_lidc` | htj2k | 4.4 [4.1–6.9] | 17.8 [16.0–26.7] | 1.00 | 1.00 |
| `ct_lidc` | j2k layer 1 | 5.0 [4.2–7.0] | 20.9 [17.4–28.1] | 1.06 | 1.14 |
| `ct_lidc` | j2k all | 38.5 [36.5–48.2] | 160.4 [153.3–188.6] | 8.74 | 9.16 |
| `ct_lidc` | jxl-prog first picture | 12.0 [11.3–14.9] | 50.0 [45.8–58.7] | 2.73 | 2.81 |
| `ct_lidc` | jxl-prog all | 18.6 [17.8–22.0] | 77.8 [72.1–90.0] | 4.28 | 4.43 |
| `ct_lidc` | jxl all | 29.6 [27.9–33.8] | 124.7 [112.3–141.7] | 6.80 | 7.04 |
| `mr_ispy1` | htj2k | 4.5 [4.3–7.9] | 19.6 [17.2–24.8] | 1.00 | 1.00 |
| `mr_ispy1` | j2k layer 1 | 4.7 [4.4–7.0] | 21.3 [16.5–30.3] | 1.02 | 1.01 |
| `mr_ispy1` | j2k all | 39.2 [37.2–41.5] | 162.7 [150.0–189.6] | 8.51 | 8.30 |
| `mr_ispy1` | jxl-prog first picture | 11.2 [10.5–12.2] | 46.2 [43.5–55.8] | 2.45 | 2.41 |
| `mr_ispy1` | jxl-prog all | 18.7 [17.6–21.1] | 78.0 [71.6–87.5] | 4.19 | 3.97 |
| `mr_ispy1` | jxl all | 31.7 [29.3–38.1] | 134.4 [127.4–152.0] | 6.76 | 6.92 |
| `us_liver` | htj2k | 9.6 [8.6–11.6] | 44.3 [38.8–51.7] | 1.00 | 1.00 |
| `us_liver` | j2k layer 1 | 11.3 [10.1–14.0] | 49.1 [45.2–76.7] | 1.15 | 1.09 |
| `us_liver` | j2k all | 63.7 [58.7–69.0] | 268.6 [254.0–286.5] | 6.38 | 6.08 |
| `us_liver` | jxl-prog first picture | 15.8 [15.0–18.5] | 69.5 [63.4–86.7] | 1.67 | 1.55 |
| `us_liver` | jxl-prog all | 44.5 [42.4–49.4] | 199.5 [180.1–219.8] | 4.64 | 4.55 |
| `us_liver` | jxl all | 82.8 [79.3–90.6] | 367.8 [348.8–385.8] | 8.74 | 8.13 |
| `rf_fluoro` | htj2k | 7.7 [7.2–10.2] | 34.9 [32.3–60.7] | 1.00 | 1.00 |
| `rf_fluoro` | j2k layer 1 | 10.7 [9.7–12.1] | 43.7 [41.1–53.1] | 1.38 | 1.23 |
| `rf_fluoro` | j2k all | 93.3 [91.1–101.6] | 415.2 [388.4–427.3] | 12.12 | 11.79 |
| `rf_fluoro` | jxl-prog first picture | 12.6 [10.9–15.3] | 51.6 [48.4–58.7] | 1.58 | 1.52 |
| `rf_fluoro` | jxl-prog all | 49.2 [46.1–54.9] | 208.3 [196.4–225.8] | 6.21 | 6.05 |
| `rf_fluoro` | jxl all | 80.5 [76.9–102.8] | 351.0 [324.3–372.2] | 10.35 | 9.99 |
| `xa_dynact16` | htj2k | 4.5 [4.1–6.6] | 19.7 [16.8–24.7] | 1.00 | 1.00 |
| `xa_dynact16` | j2k layer 1 | 4.6 [4.3–6.3] | 18.8 [17.9–33.3] | 1.05 | 1.04 |
| `xa_dynact16` | j2k all | 45.1 [43.2–54.2] | 200.2 [187.3–242.4] | 9.65 | 10.40 |
| `xa_dynact16` | jxl-prog first picture | 13.5 [12.8–15.6] | 55.1 [50.5–64.9] | 2.91 | 2.80 |
| `xa_dynact16` | jxl-prog all | 20.6 [19.7–24.7] | 88.2 [81.2–93.4] | 4.56 | 4.57 |
| `xa_dynact16` | jxl all | 31.1 [28.8–34.8] | 141.1 [128.9–158.9] | 6.88 | 7.09 |
| `dbt12_ea1141` | htj2k | 9.1 [8.4–12.4] | 43.6 [35.8–58.0] | 1.00 | 1.00 |
| `dbt12_ea1141` | j2k layer 1 | 11.4 [10.4–15.0] | 54.3 [46.2–73.1] | 1.25 | 1.29 |
| `dbt12_ea1141` | j2k all | 97.0 [92.2–109.8] | 427.3 [402.8–463.6] | 10.87 | 9.67 |
| `dbt12_ea1141` | jxl-prog first picture | 13.3 [12.6–18.3] | 60.5 [52.4–71.1] | 1.50 | 1.45 |
| `dbt12_ea1141` | jxl-prog all | 53.2 [51.5–62.1] | 238.0 [223.7–262.7] | 5.97 | 5.77 |
| `dbt12_ea1141` | jxl all | 95.5 [90.6–111.1] | 415.1 [389.7–467.1] | 10.32 | 10.22 |
| `dbt10_ea1141` | htj2k | 12.6 [11.6–15.0] | 56.9 [53.0–79.7] | 1.00 | 1.00 |
| `dbt10_ea1141` | j2k layer 1 | 15.0 [13.2–20.4] | 74.3 [64.5–93.2] | 1.19 | 1.33 |
| `dbt10_ea1141` | j2k all | 118.5 [110.1–124.1] | 511.7 [487.5–538.6] | 9.42 | 8.83 |
| `dbt10_ea1141` | jxl-prog first picture | 17.9 [15.9–20.9] | 78.4 [71.8–88.0] | 1.45 | 1.33 |
| `dbt10_ea1141` | jxl-prog all | 59.8 [57.1–61.7] | 268.7 [244.7–286.8] | 4.71 | 4.76 |
| `dbt10_ea1141` | jxl all | 123.3 [118.0–129.4] | 548.6 [528.4–604.4] | 9.86 | 9.92 |


* **J2K's first layer decodes in 1.0–1.4× OpenJPH's time for the whole exact frame** (slower in
  169 of 210 paired rounds). **The exact frame then takes 6–12× OpenJPH's time**, slower in 210 of
  210 rounds: EBCOT, the Part 1 block coder HTJ2K replaces, decodes like dav1d-WASM (5–10×, SPEED).
* **Progressive JPEG XL's first picture decodes in 1.3–2.9×** OpenJPH's exact time, and the whole
  codestream in 4.0–6.2×, faster than plain JPEG XL (6.8–10.4×) on every set.
* Each preview is a separate decode, so the exact frame costs its whole decode again after it. A
  decoder that resumed from the layer it holds would save that, but neither is driven that way here.

Nothing here ran through the server or the downloader; serving a prefix as a preview needs the
store and the wire to hand out part of a frame, which is structural (`docs/av1/README.md` §A5).
