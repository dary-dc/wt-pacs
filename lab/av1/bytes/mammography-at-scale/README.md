# ffdmscale — mammograms at scale on sound data

Queue row 96 (FFDMSCALE) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md): full-field mammograms for
presentation, their 14-bit FOR PROCESSING raw companions, and synthesized 2D, five four-view exams per system
(`ffdms_*`, `mgraw_*`, `syn2ds_*`, [`docs/FIXTURES.md`](../../../../docs/FIXTURES.md) §AV1 data, every one `sound`),
through row SPLITTIME's harness ([`../../delivery/split-rule`](../../delivery/split-rule/README.md)) unchanged. The reading is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §The split per depth.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh
PATH=lab/av1/.venv/bin:$PATH FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160 && ingest/coded-frames/build.sh
client/decode/wasm/fetch_openjph.sh && client/transport/ts/build.sh
lab/av1/fetch_data.sh ffdms_a1 … ffdms_c5 mgraw_a1 … mgraw_c5 syn2ds_a1 … syn2ds_b4 syn2d_c   # ~2.2 GB
P=lab/av1/.venv/bin/python W=lab/.av1-work
$P lab/av1/delivery/split-rule/make_frames.py lab/.av1-build $W/ffdmscale lab/av1/data/{ffdms,mgraw,syn2ds}_* \
  lab/av1/data/syn2d_c --preset allintra:7                                   # ~25 min, 4 cores
```

Systems are row DBTSCALE's: A and C are one vendor's two detectors, B the other vendor's. Arms are named by k, the
low bits split off: at 12 bits k = 0 is d12 and k = 2 is w10, at 14 bits k = 2 is d12 and k = 4 is w10, at 10 bits
k = 0 is both.

## Bytes (2026-10-08)

Every image, `allintra` 7, each item decoded back natively and matched with the fetch's checksum before it is written
(`ingest.py`), HTJ2K in the served profile decoded back and checked: 477/477 items and 159/159 HTJ2K frames exact.
HTJ2K's bits a sample on the exam, then each arm's bytes over HTJ2K's; **bold** is each exam's smallest arm.

| set | b | images | HTJ2K, bit/sample | k = 0 | k = 2 | k = 3 | k = 4 |
| --- | --: | --- | --: | --: | --: | --: | --: |
| `ffdms_a1` | 12 | 4 × 1914×2294 | 2.83 | 1.047 | **0.994** | 1.046 | |
| `ffdms_a2` | 12 | 4 × 1914×2294 | 4.74 | 1.007 | **1.000** | 1.065 | |
| `ffdms_a3` | 12 | 4 × 1914×2294 | 3.01 | 1.049 | **0.983** | 1.010 | |
| `ffdms_a4` | 12 | 4 × 1914×2294 | 4.63 | 1.031 | **1.017** | 1.093 | |
| `ffdms_a5` | 12 | 4 × 1914×2294 | 2.90 | 1.104 | 0.961 | **0.956** | |
| `ffdms_b1` | 12 | 4 × 3328×4096 | 4.75 | 1.161 | 1.032 | **0.998** | |
| `ffdms_b2` | 12 | 4 × 2560×3328 | 2.86 | 1.179 | 1.042 | **0.990** | |
| `ffdms_b3` | 12 | 4 × 2560×3328 | 1.55 | 1.164 | 1.030 | **0.995** | |
| `ffdms_b4` | 12 | 4 × 3328×4096 | 4.31 | 1.174 | 1.043 | **0.999** | |
| `ffdms_b5` | 12 | 4 × 3328×4096 | 0.97 | 1.177 | 1.031 | **1.003** | |
| `ffdms_c1` | 12 | 4 × 1914×2294 | 4.97 | 1.009 | **0.992** | 1.042 | |
| `ffdms_c2` | 12 | 4 × 2394×3062 | 4.11 | 1.072 | **0.952** | 0.955 | |
| `ffdms_c3` | 12 | 4 × 2394×3062 | 1.97 | 1.066 | **0.954** | 0.959 | |
| `ffdms_c4` | 12 | 4 × 2394×3062 | 4.23 | 1.079 | **0.951** | 0.952 | |
| `ffdms_c5` | 12 | 4 × 1914×2294 | 3.29 | 1.070 | **0.945** | 0.946 | |
| `mgraw_a1` | 14 | 4 × 1914×2294 | 5.55 | | **0.968** | 1.017 | 1.074 |
| `mgraw_a2` | 14 | 4 × 1914×2294 | 6.74 | | **0.951** | 0.960 | 1.031 |
| `mgraw_a3` | 14 | 4 × 1914×2294 | 3.43 | | **0.964** | 0.976 | 1.057 |
| `mgraw_a4` | 14 | 4 × 1914×2294 | 6.98 | | **0.958** | 0.963 | 1.029 |
| `mgraw_a5` | 14 | 4 × 1914×2294 | 2.23 | | **0.968** | 0.987 | 1.087 |
| `mgraw_b1` | 14 | 4 × 3328×4096 | 6.98 | | **0.953** | 0.957 | 1.025 |
| `mgraw_b2` | 14 | 4 × 2560×3328 | 7.44 | | 0.963 | **0.960** | 1.016 |
| `mgraw_b3` | 14 | 4 × 3328×4096 | 7.29 | | 0.963 | **0.957** | 1.019 |
| `mgraw_b4` | 14 | 4 × 3328×4096 | 7.25 | | 0.958 | **0.957** | 1.017 |
| `mgraw_b5` | 14 | 4 × 2560×3328 | 6.18 | | **0.935** | 0.957 | 1.045 |
| `mgraw_c1` | 14 | 4 × 1914×2294 | 7.75 | | 0.975 | **0.962** | 1.009 |
| `mgraw_c2` | 14 | 4 × 1914×2294 | 4.06 | | **0.952** | 0.955 | 1.015 |
| `mgraw_c3` | 14 | 4 × 2394×3062 | 3.49 | | **0.946** | 0.962 | 1.056 |
| `mgraw_c4` | 14 | 4 × 1914×2294 | 7.26 | | 0.959 | **0.958** | 1.015 |
| `mgraw_c5` | 14 | 4 × 2394×3062 | 5.16 | | 0.972 | **0.958** | 0.998 |
| `syn2ds_a1` | 12 | 4 × 2394×2850 | 3.93 | 1.011 | **0.956** | 0.980 | |
| `syn2ds_a2` | 12 | 4 × 2394×2850 | 2.11 | 1.032 | **0.960** | 0.980 | |
| `syn2ds_a3` | 12 | 4 × 2394×3062 | 3.43 | 1.014 | **0.966** | 0.996 | |
| `syn2ds_a4` | 12 | 4 × 2394×3062 | 3.45 | 1.034 | **0.971** | 0.993 | |
| `syn2ds_a5` | 12 | 4 × 2394×2850 | 3.63 | 1.010 | **0.967** | 1.001 | |
| `syn2ds_b1` | 10 | 4 × 2560×3328 | 2.02 | 1.021 | **0.941** | 0.947 | |
| `syn2ds_b2` | 10 | 4 × 2560×3328 | 2.02 | 1.035 | **0.944** | 0.947 | |
| `syn2ds_b3` | 10 | 4 × 3328×4096 | 1.07 | 1.040 | **0.940** | 0.947 | |
| `syn2ds_b4` | 10 | 4 × 1996×2457 | 1.22 | 1.017 | **0.948** | 0.959 | |
| `syn2d_c` | 10 | 3 × 1996×2457 | 2.63 | 1.019 | **0.951** | 0.963 | |

* **For presentation, AV1 gains little and on one system nothing.** System C 0.945–0.992 (k = 2), A 0.961–1.017
  (k = 2 smallest on four of five, over HTJ2K on one), B **0.990–1.003 at its best arm (k = 3)**, k = 2 there
  1.030–1.043: row BREAST's two exams of B (`ffdm_a` 1.003, `ffdm_d` 1.025 shipped) were not outliers. Coded whole
  (k = 0) every exam is over HTJ2K, 1.007–1.179.
* **Raw, 14 bits: k = 2 or k = 3, 0.935–0.975 of HTJ2K on all fifteen**, within 0.02 of each other but on `mgraw_a1`
  (k = 3 1.017); w10 (k = 4) 0.998–1.087.
* **Synthesized 2D: k = 2 on every exam**, 0.956–0.971 at 12 bits, 0.940–0.951 at 10.

**Not run:** cpu0. Row BREAST's cpu0 encode of one 13.6 M-sample frame took 4.2 GB and 512 s; three arms of 156 images
would hold this 4-core host some 17 hours, and the shipped preset is what ingest writes.

## Decode (2026-10-08)

Row SPLITTIME's `decode.mjs` unchanged on one exam per kind and system, the median by HTJ2K bytes (`ffdms_a3`,
`ffdms_b2`, `ffdms_c1`, `mgraw_a1`, `mgraw_b1`, `mgraw_c4`, `syn2ds_a3`, `syn2ds_b3`), all four images, every arm,
hard-linked into `$W/ffdmscale-dec` with a `manifest.json` of their checksums; headless Chromium 141, 6 rounds, 1× and
4× interleaved, the host otherwise idle: **1 536/1 536 frames exact**. HTJ2K is ms a frame, median of round medians,
1× · 4×; each arm the median of round-paired ratios to it. An arm whose streams are all ≤ 10 bits is WebCodecs'
(`wc`), the rest dav1d-WASM's.

| set | b | HTJ2K, ms | k = 0 | k = 2 | k = 3 | k = 4 |
| --- | --: | --- | --- | --- | --- | --- |
| `ffdms_a3` | 12 | 47.5 · 207 | 5.96 · 5.82 | wc 3.79 · 3.35 | wc **3.28 · 3.11** | |
| `ffdms_b2` | 12 | 95.5 · 381 | 6.69 · 6.88 | wc 4.32 · 4.22 | wc **3.60 · 3.46** | |
| `ffdms_c1` | 12 | 70.7 · 278 | 6.09 · 6.83 | wc **3.43 · 3.59** | wc 3.68 · 3.74 | |
| `mgraw_a1` | 14 | 79.4 · 348 | | 7.28 · 6.88 | 7.55 · 7.43 | wc **3.85 · 3.56** |
| `mgraw_b1` | 14 | 248 · 1 083 | | 8.04 · 7.90 | 8.20 · 8.19 | wc **2.02 · 1.88** |
| `mgraw_c4` | 14 | 80.8 · 346 | | 7.84 · 7.79 | 8.31 · 8.13 | wc **3.48 · 3.18** |
| `syn2ds_a3` | 12 | 94.8 · 401 | 5.49 · 5.40 | wc 3.38 · 3.10 | wc **3.31 · 3.11** | |
| `syn2ds_b3` | 10 | 122 · 521 | wc 2.30 · 2.20 | wc 1.80 · 1.68 | wc **1.74 · 1.66** | |

**No AV1 arm decodes as fast as HTJ2K on any exam in any round** (0/6 faster, every cell). At 12 bits the fastest is
3.1–3.7× HTJ2K's time a frame, at 10 bits 1.7×; at 14 bits w10 (k = 4, WebCodecs) is 1.9–3.9× and the 12-bit top
through dav1d-WASM (k = 2, 3) 6.9–8.3× — 2.0 and 8.6 s a 13.6 M-sample raw frame at 4×.

## Total time (2026-10-08)

Row TOTAL's `run.mjs` unchanged on the same eight exams, all four images (6.6–47.5 MB of HTJ2K an exam;
`$W/ffdmscale-total`), HTJ2K against the two AV1 arms that bytes and decode leave in question — k = 2 and k = 3 at
12 bits, k = 2 and w10 (k = 4) at 14, k = 0 and k = 2 at 10 — the fixed links (5, 20, 50 Mbit/s, 40 ms), 1× and
4×, 4 rounds interleaved: **2 304/2 304 frames exact over 576 visits**. 80 visits are `VOID` (the relay's p99 over
1 ms); counted or dropped, every ratio moves by 0.02 or less, so the table counts every visit (n = 4) and says so.
HTJ2K is seconds to every image on the page, median, 1× · 4×; each arm the median of round-paired ratios to it.

| set | arm | 5 Mbit | 20 Mbit | 50 Mbit |
| --- | --- | --- | --- | --- |
| `ffdms_a3`, 12-bit | HTJ2K, s | 10.9 · 11.1 | 2.89 · 3.07 | 1.33 · 1.53 |
| | k = 2 | 1.00 · 1.03 | 1.03 · 1.16 | 1.08 · 1.68 |
| | k = 3 | 1.02 · 1.05 | 1.06 · 1.15 | 1.10 · 1.61 |
| `ffdms_b2`, 12-bit | HTJ2K, s | 20.0 · 20.3 | 5.19 · 5.50 | 2.30 · 2.63 |
| | k = 2 | 1.06 · 1.11 | 1.10 · 1.30 | 1.19 · 1.70 |
| | k = 3 | 1.01 · 1.05 | 1.04 · 1.19 | 1.11 · 1.45 |
| `ffdms_c1`, 12-bit | HTJ2K, s | 17.9 · 18.1 | 4.66 · 4.86 | 2.05 · 2.25 |
| | k = 2 | 1.00 · 1.04 | 1.04 · 1.15 | 1.08 · 1.45 |
| | k = 3 | 1.05 · 1.08 | 1.09 · 1.20 | 1.13 · 1.56 |
| `syn2ds_a3`, 12-bit | HTJ2K, s | 20.6 · 21.0 | 5.36 · 5.69 | 2.35 · 2.63 |
| | k = 2 | 0.98 · 1.01 | 1.01 · 1.14 | 1.06 · 1.47 |
| | k = 3 | 1.01 · 1.04 | 1.04 · 1.15 | 1.09 · 1.58 |
| `syn2ds_b3`, 10-bit | HTJ2K, s | 12.1 · 12.5 | 3.25 · 3.65 | 1.52 · 1.93 |
| | k = 0 | 1.06 · 1.10 | 1.09 · 1.28 | 1.22 · 1.83 |
| | k = 2 | 0.95 · 0.98 | 0.99 · 1.07 | 1.04 · 1.28 |
| `mgraw_a1`, 14-bit | HTJ2K, s | 20.0 · 20.3 | 5.19 · 5.45 | 2.27 · 2.52 |
| | k = 2 | 0.99 · 1.06 | 1.06 · 1.36 | 1.23 · 2.28 |
| | k = 4 | 1.08 · 1.11 | 1.12 · 1.23 | 1.18 · 1.47 |
| `mgraw_b1`, 14-bit | HTJ2K, s | 77.8 · 78.7 | 19.8 · 20.6 | 8.26 · 9.09 |
| | k = 2 | 0.98 · 1.04 | 1.04 · 1.32 | 1.14 · 2.14 |
| | k = 4 | 1.03 · 1.03 | 1.04 · 1.08 | 1.06 · 1.13 |
| `mgraw_c4`, 14-bit | HTJ2K, s | 26.1 · 26.4 | 6.74 · 6.99 | 2.90 · 3.21 |
| | k = 2 | 0.98 · 1.06 | 1.04 · 1.31 | 1.17 · 2.17 |
| | k = 4 | 1.02 · 1.05 | 1.04 · 1.12 | 1.08 · 1.28 |

**HTJ2K fills these exams as fast or faster on every cell but 5 Mbit/s at 1×**, where AV1's best arm is 0.95–1.00
(the 10-bit synthesized exam 0.95, the 12-bit one 0.98, raw 0.98–0.99, for presentation 1.00–1.01). At 20 Mbit/s
the best arm is 0.99–1.06 at 1× and 1.07–1.23 at 4×; at 50 Mbit/s 1.04–1.18 and 1.13–1.61. A mammogram is a few
large frames, so the decode after the last byte is likely a larger share of the fill than on a DBT volume's many
small slices (not measured apart): the 12-bit top through dav1d-WASM takes a raw exam to 2.1–2.3× HTJ2K's time at 4× on 50 Mbit/s, w10 to
1.13–1.47. The 4× cells on 50 Mbit/s are the host's saturation (the decode on three cores is the fill's clock);
nothing past it is claimed. `--mutate sample` and `--mutate truth` on the decode harness, on one exam of each depth,
each turned every arm to 0 exact.

## Verdict

* **The codec for these images is HTJ2K.** For presentation AV1 is 0.945–1.017 of HTJ2K's bytes on two systems and
  0.990–1.003 on the third; no fill ends sooner but at 5 Mbit/s at 1×, by 0–5 %; the decode is 3.1–3.7× HTJ2K's a
  frame.
* **The split per depth, where AV1 is used: k = 2 at 10 and 12 bits**, the smallest arm on every synthesized exam and
  on nine of ten FFDM exams of systems A and C; system B's FFDM wants k = 3 (0.990–1.003), which still does not beat
  HTJ2K. **At 14 bits k = 2 by bytes** (0.935–0.975; k = 3 within 0.02 on 14 of 15) **and at 1×; w10 at 4× on
  20 Mbit/s and more** (1.08–1.47 of HTJ2K against k = 2's 1.31–2.28); raw images are not what a viewer receives,
  so this decides nothing a viewer shows.
* Containers, not phones; one exam a kind and system timed, all 39 sized.
