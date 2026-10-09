# resid

A lossy AV1 preview **plus** a lossless residual, so that the exact frame is the preview and the
difference to the source, not the preview and then the whole exact frame again. Queue row 17 (RESID)
of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the verdict is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §Preview.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
lab/av1/fetch_data.sh
lab/av1/.venv/bin/python lab/av1/delivery/residual/encode.py lab/.av1-build lab/.av1-work/resid \
  lab/av1/data/{rf_fluoro,us_liver,mr_ispy1,ct_lidc,xa_dynact16,dbt12_ea1141,dbt10_ea1141}  # ~45 min
lab/av1/.venv/bin/python lab/av1/delivery/residual/summary.py lab/.av1-work/resid/manifest.json
NODE_PATH=$(npm root -g) node lab/av1/delivery/residual/time.mjs --rounds 15 --throttles 1,4 \
  --out lab/.av1-work/resid-rows.json                                           # ~48 min
NODE_PATH=$(npm root -g) node lab/av1/delivery/residual/time.mjs --rounds 1 --throttles 1 --mutate hash
```

## The preview and the residual

Every series of rows DATA and CONTENT: CT, MR, the ultrasound cine (RGB 8), fluoroscopy, cone-beam,
and the two tomosynthesis volumes.

* **The preview** is row PREVIEW's: `aomenc` 3.15.1, `--end-usage=q --cq-level=CRF --cpu-used=6`,
  CRF 8, 20, 32, 44, G = 8 (`--kf-min-dist=--kf-max-dist=8`), one temporal unit a frame. Grey is
  4:0:0 at 10 bits: with s = (coded bits − 10, at least 0), coded as `(v + 2^(s−1)) >> s` and shown
  as `p << s`, v after the series' offset. Colour is full-range BT.601 4:2:0, 8-bit.
* **The prediction must be integer arithmetic**, because the residual is exact only against the
  prediction the client computes: grey is `p << s`; colour repeats chroma 2×2 and converts back in
  16-bit fixed point (`preview_rgb` in `encode.py`, `add` in `worker.js`, the same constants). Row
  PREVIEW's floating-point conversion would not be reproducible bit for bit across languages.
* **Residual** = source − prediction, signed, per sample (and per channel). One offset per series
  (minus its minimum) makes it unsigned; its range sets the bits (7–12 here). Coded losslessly
  per frame with HTJ2K (the served profile, as PGM or PPM) and with AV1 intra (`--lossless=1
  --cpu-used=6 --kf-max-dist=0`, 4:0:0 for grey, G, B, R 4:4:4 identity for colour, at the next
  depth AV1 has).
* **Quality** is against the source samples: PSNR over the coded range (2^coded bits − 1; 11 bits
  for MR, 13 for CT and cone-beam), mean over frames, and max \|Δ\| over the series.

## Bytes

Over the exact HTJ2K series' (CT 16 363 741 B, MR 10 821 976, ultrasound 18 019 334, fluoroscopy
9 267 247, cone-beam 14 811 880, tomosynthesis 14 476 791 and 13 637 860): the preview alone; preview
then the exact HTJ2K frames (row PREVIEW's arm); preview + residual in HTJ2K; preview + residual in AV1.

| set | CRF | PSNR · max \|Δ\| | residual bits | preview | + HTJ2K | **+ residual HTJ2K** | + residual AV1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 8 | 54.7 · 447 | 10 | 0.026 | 1.026 | **0.950** | 0.950 |
| | 20 | 49.7 · 760 | 11 | 0.010 | 1.010 | 0.962 | 0.979 |
| | 32 | 46.8 · 1080 | 12 | 0.005 | 1.005 | 0.969 | 0.995 |
| | 44 | 43.8 · 1616 | 12 | 0.003 | 1.003 | 0.982 | 1.013 |
| `mr_ispy1` | 8 | 47.9 · 64 | 7 | 0.101 | 1.101 | **0.995** | 0.984 |
| | 20 | 42.5 · 197 | 9 | 0.014 | 1.014 | 1.000 | 1.040 |
| | 32 | 41.2 · 316 | 10 | 0.005 | 1.005 | 1.003 | 1.051 |
| | 44 | 39.7 · 674 | 11 | 0.002 | 1.002 | 1.004 | 1.056 |
| `us_liver` | 8 | 41.6 · 87 | 8 | 0.222 | 1.222 | **0.947** | 1.125 |
| | 20 | 37.7 · 101 | 8 | 0.129 | 1.129 | 0.979 | 1.314 |
| | 32 | 34.2 · 109 | 8 | 0.070 | 1.070 | 1.007 | 1.460 |
| | 44 | 30.2 · 114 | 8 | 0.024 | 1.024 | 1.021 | 1.610 |
| `rf_fluoro` | 8 | 47.5 · 197 | 9 | 0.060 | 1.060 | 1.005 | 1.013 |
| | 20 | 43.9 · 433 | 10 | 0.008 | 1.008 | **0.990** | 1.039 |
| | 32 | 42.7 · 1220 | 12 | 0.004 | 1.004 | 0.992 | 1.022 |
| | 44 | 40.9 · 1374 | 12 | 0.002 | 1.002 | 0.994 | 1.041 |
| `xa_dynact16` | 8 | 47.9 · 363 | 10 | 0.090 | 1.090 | **0.994** | 1.103 |
| | 20 | 41.2 · 904 | 11 | 0.014 | 1.014 | 0.998 | 1.203 |
| | 32 | 39.4 · 928 | 11 | 0.004 | 1.004 | 1.004 | 1.222 |
| | 44 | 38.4 · 1462 | 12 | 0.001 | 1.001 | 1.014 | 1.238 |
| `dbt12_ea1141` | 8 | 48.2 · 199 | 9 | 0.049 | 1.049 | 1.005 | 1.031 |
| | 20 | 44.8 · 339 | 10 | 0.004 | 1.004 | **1.002** | 1.071 |
| | 32 | 44.1 · 467 | 10 | 0.002 | 1.002 | 1.007 | 1.077 |
| | 44 | 43.1 · 683 | 11 | 0.001 | 1.001 | 1.015 | 1.086 |
| `dbt10_ea1141` | 8 | 47.9 · 56 | 7 | 0.145 | 1.145 | 0.994 | **0.930** |
| | 20 | 41.6 · 281 | 10 | 0.019 | 1.019 | **0.991** | 0.962 |
| | 32 | 40.3 · 414 | 10 | 0.008 | 1.008 | 0.995 | 0.976 |
| | 44 | 39.0 · 438 | 10 | 0.003 | 1.003 | 1.000 | 0.988 |

* **The preview is not extra.** Preview + HTJ2K residual is 0.947–1.021 of HTJ2K alone over all 28
  cells, and at each series' best CRF (bold) 0.947–1.002: the preview's net cost runs from −5.3 %
  (ultrasound, CRF 8) to +0.2 % (12-bit tomosynthesis), where row PREVIEW's order costs +0.1 % to
  +22 %. A better preview is a smaller residual: the best CRF is 8 or 20, never the smallest
  preview.
* **Why it can be smaller than HTJ2K alone is not measured.** The preview is inter coded (G = 8), so
  its share carries what neighbouring frames have in common, which an intra HTJ2K frame cannot; that
  is a reading, not a test.
* **The residual in AV1 is worse than in HTJ2K** except on the 10-bit tomosynthesis (0.930 at
  CRF 8) and MR at CRF 8 (0.984); on the ultrasound's colour residual it is 1.13–1.61.

## Decode time

ms a frame, the first 16 frames (two groups) made exact in order in one worker, the clock from the
first unit handed in to the last frame's samples written; median over 15 interleaved rounds
[range], headless Chromium 141, this container (4 cores), at each series' bold HTJ2K-residual CRF.
WebCodecs runs its own decoder threads (each capped at 1/rate of a CPU at 4×) and is flushed at the
end of every group; dav1d-WASM and OpenJPH use one thread.

| set | HTJ2K alone | WebCodecs + rHTJ2K | dav1d-WASM + rHTJ2K | WebCodecs + rAV1 | dav1d-WASM + rAV1 |
| --- | --- | --- | --- | --- | --- |
| 1× `ct_lidc` | 4.19 [3.94–5.55] | 5.52 [5.14–6.85] | 8.78 [8.25–10.68] | 24.7 [23.0–27.7] | 27.5 [26.8–30.5] |
| 1× `mr_ispy1` | 4.48 [4.15–5.55] | 6.95 [6.70–10.60] | 12.7 [11.8–13.7] | 26.9 [25.6–29.3] | 32.5 [31.4–35.0] |
| 1× `us_liver` | 9.45 [8.68–11.57] | 17.8 [16.3–21.5] | 26.3 [24.9–29.8] | 52.6 [49.4–56.5] | 58.9 [56.6–64.0] |
| 1× `rf_fluoro` | 7.85 [7.55–12.13] | 11.5 [10.9–14.2] | 23.5 [22.9–26.5] | 76.0 [73.9–82.6] | 88.7 [83.9–93.1] |
| 1× `xa_dynact16` | 4.33 [4.03–5.19] | 7.55 [6.83–10.15] | 12.1 [11.5–13.4] | 34.7 [33.3–38.5] | 40.6 [38.2–45.2] |
| 1× `dbt12_ea1141` | 9.45 [8.93–12.25] | 14.3 [13.5–17.0] | 23.0 [21.8–25.0] | 82.2 [76.1–88.1] | 91.1 [88.4–95.5] |
| 1× `dbt10_ea1141` | 12.7 [12.2–14.5] | 20.8 [19.6–26.6] | 35.7 [32.9–59.2] | 86.3 [80.8–93.2] | 98.8 [94.1–111.3] |
| 4× `ct_lidc` | 17.6 [16.1–23.8] | 21.8 [18.6–26.3] | 40.5 [35.6–46.1] | 102 [94–111] | 121 [113–136] |
| 4× `mr_ispy1` | 18.7 [17.2–22.0] | 24.3 [22.2–31.6] | 55.3 [52.6–63.7] | 108 [103–113] | 140 [131–152] |
| 4× `us_liver` | 43.0 [38.5–51.1] | 76.5 [67.0–90.0] | 119 [112–129] | 212 [204–253] | 253 [238–280] |
| 4× `rf_fluoro` | 35.5 [31.2–41.5] | 47.1 [43.2–52.5] | 110 [100–138] | 323 [310–363] | 376 [364–425] |
| 4× `xa_dynact16` | 17.8 [15.9–22.7] | 27.3 [23.1–31.8] | 55.5 [49.1–64.4] | 147 [138–163] | 179 [169–188] |
| 4× `dbt12_ea1141` | 42.8 [38.6–47.5] | 59.8 [56.8–70.3] | 103 [93–114] | 339 [324–368] | 389 [371–423] |
| 4× `dbt10_ea1141` | 55.6 [53.6–82.8] | 85.5 [82.1–95.3] | 159 [143–178] | 363 [345–385] | 434 [411–456] |

* **The exact frame costs more decoding than HTJ2K alone on every series.** Per series, the median
  of the paired rounds' ratios: preview + HTJ2K residual through WebCodecs is **1.31–1.89× HTJ2K**
  at 1× and 1.23–1.74× at 4× (slower in 104/105 and 103/105 paired rounds); through dav1d-WASM
  2.08–3.00× and 2.29–3.14× (105/105 each). With the residual in AV1, 4.9–11.0× (dav1d-WASM's
  lossless decoding, row SPEED).
* The residual's decode was not timed apart; over HTJ2K alone the arms add the preview's decode and
  the add — the first of which a preview shown first pays anyway. Against row PREVIEW's order (preview, then the
  whole exact frame) RESID decodes the same two things; it saves the bytes, not the time.

## Checked

* **Bit-identical lossy output.** Every preview frame decoded in Chromium, through dav1d-WASM and
  through WebCodecs, matched native dav1d 1.5.4's decode of the same stream: 13 440/13 440 (8-bit
  4:2:0 on the ultrasound, 10-bit 4:0:0 on six grey series, 15 rounds, two throttles, both decoders).
* **Every exact frame** — preview + residual + the add in the browser, and HTJ2K alone — hashed
  against the checksum written when the series was fetched: 16 800/16 800. Natively, `encode.py`
  adds every residual of every cell to native dav1d's preview and checks it the same way
  (363 frames × 4 CRFs × 2 residual codecs).
* **Mutated** (on fluoroscopy unless named): `--mutate hash` (one hex digit of every reference)
  turned 5/5 arms to 0 exact and every preview check to 0; the add's offset off by one turned every residual arm to 0/16 with the
  previews still 16/16; dropping the rounding term from R in the browser's colour conversion turned
  the four ultrasound residual arms to 0/16 (moving its constant by 1/65 536 changed no sample on this
  content, and survived); the HTJ2K and the AV1 residual written one too high each stopped
  `encode.py` at frame 0.

**Pins.** libaom 3.15.1 and dav1d 1.5.4 as `tools.sh` pins them; dav1d 1.5.4 under emscripten
3.1.74 (`simd.wasm`, 623 042 B); `@cornerstonejs/codec-openjph` 2.4.11 and OpenJPH 0.31.0 as
row SPEED pins them; playwright 1.56.1's Chromium 141; Node 22; numpy 2.4.6
(`lab/av1/requirements.txt`). Nothing built or generated is committed.
