# preview

A lossy AV1 first picture of a cine, then the exact HTJ2K frames: its bytes, its quality against the
source, its decode time, and what that makes of the time to a playable cine on a slow link. Queue
row 12 (PREVIEW) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the verdict is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §Preview.

```bash
lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
lab/av1/fetch_data.sh rf_fluoro us_liver
lab/av1/.venv/bin/python lab/av1/delivery/preview/encode.py lab/.av1-build lab/.av1-work/preview \
  lab/av1/data/rf_fluoro lab/av1/data/us_liver                                  # ~12 min
node lab/av1/delivery/preview/prefix.mjs lab/.av1-work/preview lab/av1/data              # seconds
NODE_PATH=$(npm root -g) node lab/av1/delivery/preview/time.mjs --rounds 15 --throttles 1,4 \
  --out lab/.av1-work/preview-rows.json                                         # ~55 min
NODE_PATH=$(npm root -g) node lab/av1/delivery/preview/time.mjs --rounds 1 --throttles 1 --mutate hash
python3 lab/av1/delivery/preview/model.py lab/.av1-work/preview lab/.av1-work/preview-rows.json
```

## The previews

Row DATA's two cines: fluoroscopy (`rf_fluoro`, 18 × 768², 12-bit grey) and the ultrasound
(`us_liver`, 70 × 760×421, RGB 8). No angiography run: row CONTENT, which looks for one, was not done
when this ran.

* **Colour** is converted to full-range BT.601 Y′CbCr and 4:2:0 (chroma averaged 2×2), coded 8-bit
  profile 0; the client's reconstruction repeats chroma 2×2 and converts back (`preview_rgb`). The
  conversion alone, before any coding, is 43.8 dB with \|Δ\| ≤ 84 on the ultrasound — the ceiling
  of every colour preview here.
* **Grey** above 10 bits is coded as 4:0:0 at 10 bits, `(v + 2) >> 2`, shown as `v << 2`: both
  dav1d-WASM and WebCodecs decode 10-bit (WebCodecs refuses 12, row WCAP). The rounding alone is
  70.5 dB, \|Δ\| ≤ 2.
* `aomenc` 3.15.1, `--end-usage=q --cq-level=CRF --cpu-used=6`, CRF 8, 20, 32, 44; G = 1
  (`--kf-max-dist=0`), 8 and the whole series (`--kf-min-dist=--kf-max-dist=G`), alt-ref left on —
  a lossy stream has no exactness for it to break. One temporal unit a frame.
* **Quality** is against the source samples, not the coded input: PSNR over the stored range
  (4095 or 255) per frame, mean and minimum, and max \|Δ\| over the cine.
* **HTJ2K's own preview** is each served frame's smallest prefix that decodes at level 1 (half size)
  exactly as the whole frame decodes there, found by binary search on the package's
  `decodeSubResolution` (`docs/decode/README.md` §A prefix draws a smaller image), shown repeated
  2×2 back to full size. Nearest-neighbour is the plainest display; a display that interpolates
  would score higher, and even an ideal 2×2 mean scores 28.6 dB on fluoroscopy frame 0, so the
  level-1 numbers are about the content's pixel-scale detail as much as the codec.

## Bytes and quality

Bytes over the exact HTJ2K series' (fluoroscopy 9 267 247 B, ultrasound 18 019 334 B); PSNR mean
(minimum frame); max \|Δ\|:

| set | preview | G | CRF 8 | CRF 20 | CRF 32 | CRF 44 |
| --- | --- | --- | --- | --- | --- | --- |
| `rf_fluoro` | AV1 4:0:0 10-bit | 1 | 0.080 · 48.5 (47.8) · 97 | 0.012 · 44.5 (42.2) · 262 | 0.0056 · 43.1 (41.2) · 617 | 0.0027 · 40.8 (39.6) · 932 |
| | | 8 | 0.060 · 47.5 (46.8) · 197 | **0.0078 · 43.9 (41.8) · 433** | 0.0036 · 42.7 (40.9) · 1220 | 0.0018 · 40.9 (39.6) · 1374 |
| | | 18 (all) | 0.057 · 47.4 (46.5) · 144 | 0.0072 · 44.0 (41.7) · 503 | 0.0032 · 42.7 (40.9) · 887 | 0.0015 · 40.9 (39.4) · 1497 |
| `us_liver` | AV1 4:2:0 8-bit | 1 | 0.247 · 42.2 (40.8) · 92 | 0.166 · 38.9 (37.8) · 101 | 0.103 · 35.4 (34.8) · 103 | 0.040 · 30.4 (29.8) · 125 |
| | | 8 | 0.222 · 41.6 (41.0) · 87 | 0.129 · 37.6 (36.8) · 101 | **0.070 · 34.2 (33.3) · 109** | 0.024 · 30.2 (29.1) · 114 |
| | | 70 (all) | 0.219 · 41.6 (41.0) · 88 | 0.127 · 37.8 (36.9) · 97 | 0.066 · 34.3 (33.2) · 99 | 0.021 · 30.2 (29.0) · 103 |

HTJ2K's level-1 prefix (half size): fluoroscopy 0.260 · 27.6 (27.5) · 2800, ultrasound 0.319 · 26.6
(25.4) · 230; level 2 (quarter size): 0.067 · 25.5 dB and 0.092 · 22.5 dB.
On fluoroscopy, AV1 at CRF 20 is **1.2 % of the exact bytes at 44 dB**; HTJ2K's half-size prefix is
26 % at 28 dB. On the ultrasound the gap is smaller — CRF 32 is 7 % at 34 dB against the prefix's 32 %
at 27 dB. G = 8 takes 59–90 % of G = 1's bytes and 1–16 % more than the whole series in one group; it
keeps a group per decoder (below). The cells in bold are the ones `docs/av1/README.md` §Preview quotes. Which
quality is acceptable to show first is not this row's to say: max \|Δ\| at 44 dB on fluoroscopy is
433 of 4095.

## Decode time

ms a frame, a whole cine decoded in order in one worker, the clock from the first unit handed in to
the last frame's planes copied out; median over 15 interleaved rounds [range], headless Chromium 141,
this container (4 cores). WebCodecs runs its own decoder threads, each capped at 1/rate of a CPU at
4×, so it may use more than one core; dav1d-WASM and OpenJPH use one.

| set | variant | 1× | 4× |
| --- | --- | --- | --- |
| `rf_fluoro` | OpenJPH, exact | 6.37 [5.17–6.81] | 25.3 [21.3–28.4] |
| | OpenJPH, level-1 prefix | 2.33 [1.81–3.14] | 7.80 [6.91–8.65] |
| | dav1d-WASM, G = 8 CRF 20 | 12.9 [10.2–15.7] | 55.5 [46.7–69.1] |
| | WebCodecs, G = 8 CRF 20 | 2.64 [2.25–3.39] | 10.2 [8.6–11.2] |
| | dav1d-WASM, every cell | 12.2–20.5 | 54.9–83.7 |
| | WebCodecs, every cell | 2.30–4.31 | 9.0–13.5 |
| `us_liver` | OpenJPH, exact | 7.13 [6.17–8.35] | 30.4 [28.1–35.8] |
| | OpenJPH, level-1 prefix | 2.34 [1.80–2.56] | 9.09 [8.53–10.46] |
| | dav1d-WASM, G = 8 CRF 32 | 11.1 [9.0–12.6] | 48.3 [43.8–52.5] |
| | WebCodecs, G = 8 CRF 32 | 2.31 [2.00–3.29] | 5.96 [5.30–6.81] |
| | dav1d-WASM, every cell | 7.6–13.7 | 33.1–61.2 |
| | WebCodecs, every cell | 1.32–5.12 | 3.7–16.1 |

**A lossy AV1 payload decodes slower in dav1d-WASM than the exact HTJ2K frame does in OpenJPH**
(1.1–3.3×), and 3–11× slower than HTJ2K's level-1 prefix. WebCodecs is 2.4–13× faster than
dav1d-WASM on the same streams and faster than OpenJPH's exact decode on every cell; against the
level-1 prefix it ranges from 0.4× to 2.2× its time.

## Time to a playable cine, and to every frame exact

**Arithmetic, not a transfer measured**: the bytes above at 5, 20 and 50 Mbit/s, frames in display
order, and the decode times above on today's three decoders (`client/transport/downloader.js`), a
decoder taking the next frame — or the next group, for G > 1 — when free and decoding it once its
bytes are in (`model.py`). *Playable*: every preview frame decoded. *Exact*: every exact frame
decoded. Three variants: exact HTJ2K alone; the AV1 preview's bytes, then HTJ2K's; every frame's level-1
prefix, then the rest of each (each frame decoded twice). Contention between three decoders on four
cores is not in it, and nothing serves a preview today, so none of this ran through the server.

Seconds, playable / exact, for the bold cells (WebCodecs; dav1d-WASM where it differs by more than
0.05 s):

| set | variant | 5 Mbit/s, 1× | 20 Mbit/s, 1× | 50 Mbit/s, 1× | 50 Mbit/s, 4× |
| --- | --- | --- | --- | --- | --- |
| `rf_fluoro` | HTJ2K alone | 14.83 / 14.83 | 3.71 / 3.71 | 1.49 / 1.49 | 1.51 / 1.51 |
| | HTJ2K level-1 prefix first | 3.85 / 14.83 | 0.96 / 3.71 | 0.39 / 1.49 | 0.39 / 1.51 |
| | AV1 G = 8 CRF 20 first | 0.12 (dav1d 0.20) / 14.95 | 0.05 (0.13) / 3.74 | 0.03 (0.11) / 1.50 | 0.09 (0.45) / 1.52 |
| `us_liver` | HTJ2K alone | 28.84 / 28.84 | 7.21 / 7.21 | 2.89 / 2.89 | 2.91 / 2.91 |
| | HTJ2K level-1 prefix first | 9.21 / 28.84 | 2.30 / 7.21 | 0.92 / 2.89 | 0.93 / 2.91 |
| | AV1 G = 8 CRF 32 first | 2.02 (2.07) / 30.84 | 0.52 (0.57) / 7.72 | 0.21 (0.32) / 3.09 | 0.24 (1.21) / 3.11 |

* **On a 5 Mbit/s link the preview is playable 74–124× sooner on fluoroscopy and 14× sooner on the
  ultrasound than the exact cine** (dav1d-WASM–WebCodecs), and 19–32× and 4.4–4.6× sooner than
  HTJ2K's own half-size prefix, at 16 and 8 dB more PSNR.
* **The exact cine comes later by the preview's bytes and nothing else**: +0.8 % on fluoroscopy,
  +7 % on the ultrasound — the preview's share of the exact bytes, at every link rate.
* **On a fast link with a slow CPU, dav1d-WASM gives back most of it**: at 50 Mbit/s and 4×, the
  ultrasound preview through dav1d-WASM is playable at 1.21 s — later than HTJ2K's prefix
  (0.93 s); through WebCodecs at 0.24 s.
* **A whole-series group serialises the preview on one decoder**: at 4× on the ultrasound, G = 70
  CRF 32 through dav1d-WASM is 3.52 s at 50 Mbit/s against G = 8's 1.21 s, for 5 % fewer bytes.

The full grid (every cell, both decoders, both throttles) is what `model.py` prints.

## Checked

* Every decoded frame — 68 640 over 15 rounds, 52 variants, two throttles — hashed against its
  reference: an exact HTJ2K frame against the checksum written when the series was fetched; a
  level-1 prefix against the package's decode of the whole codestream at that level; an AV1 preview
  frame, through dav1d-WASM and through WebCodecs, against native dav1d 1.5.4's decode of the same
  stream (a lossy stream has no source to match; its quality is measured against the source).
  All matched.
* Mutated: `--mutate hash` (one hex digit of every reference) turned 52/52 variants to 0 exact; an
  HTJ2K sample off by one stopped `encode.py` at frame 0; a corrupted truth stopped `prefix.mjs`
  at that frame; a prefix one byte longer than the minimum tripped the one-byte-short check.

**Pins.** libaom 3.15.1 and dav1d 1.5.4 as `tools.sh` pins them; dav1d 1.5.4 under emscripten
3.1.74 (`simd.wasm`, 623 042 B); `@cornerstonejs/codec-openjph` 2.4.11 and OpenJPH 0.31.0 as
row SPEED pins them; playwright 1.56.1's Chromium 141; Node 22.22.0; numpy 2.4.6
(`lab/av1/requirements.txt`). Nothing built or generated is committed.
