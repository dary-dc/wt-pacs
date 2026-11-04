# resid

A lossy AV1 preview **plus** a lossless residual, so that the exact frame is the preview and the
difference to the source, not the preview and then the whole exact frame again. Queue row 17 (RESID)
of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the verdict is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §Preview.

```bash
lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
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
then the exact HTJ2K frames (row PREVIEW's variant); preview + residual in HTJ2K; preview + residual in AV1.

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
* The residual's decode was not timed apart; over HTJ2K alone the variants add the preview's decode and
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
  turned 5/5 variants to 0 exact and every preview check to 0; the add's offset off by one turned every residual variant to 0/16 with the
  previews still 16/16; dropping the rounding term from R in the browser's colour conversion turned
  the four ultrasound residual variants to 0/16 (moving its constant by 1/65 536 changed no sample on this
  content, and survived); the HTJ2K and the AV1 residual written one too high each stopped
  `encode.py` at frame 0.

**Pins.** libaom 3.15.1 and dav1d 1.5.4 as `tools.sh` pins them; dav1d 1.5.4 under emscripten
3.1.74 (`simd.wasm`, 623 042 B); `@cornerstonejs/codec-openjph` 2.4.11 and OpenJPH 0.31.0 as
row SPEED pins them; playwright 1.56.1's Chromium 141; Node 22; numpy 2.4.6
(`lab/av1/requirements.txt`). Nothing built or generated is committed.

## Residual apart protocol, pre-registered (row RESIDAPART, 2026-11-02)

Written before any data; the session that runs it changes nothing below and reports every cell, including those that
miss. The question ([`docs/codecs/README.md`](../../../../docs/codecs/README.md) §Beside lossless AV1, row RESIDAPART):
**with the preview** (that table's "base") **already decoded and on screen, does the HTJ2K residual's decode plus the add
cost more than HTJ2K's whole frame?** §Decode time above timed preview + residual + add together (1.31–1.89×) and never
the residual apart. The use in view: a cine view scrolls a lossy AV1 stream and fetches the exact frame when a tool opens
on one; the residual and a whole HTJ2K frame are the two ways to deliver it, so the bytes are reported beside the time.

**Arms**, each in a worker of its own, the client's OpenJPH build in every HTJ2K arm:

| arm | clock covers | not on the clock |
| --- | --- | --- |
| **H** HTJ2K whole frame | each frame's codestream decoded and its samples written | — |
| **R** residual decode alone | each frame's residual decoded | the preview, decoded before the clock starts; the add, done after it stops |
| **RA** residual decode + add | each frame's residual decoded and added to its preview, samples written | the preview, decoded before the clock starts |
| **P** preview decode (reference) | the preview's units decoded, through WebCodecs and through dav1d-WASM | — |

ms a frame over the timed frames, latency alone (no throughput). The add's own cost is RA − R, *derived*.

**Content**, in this order, the second only once the first is reported: the DBT volumes `dbts_a1`, `dbts_b1`,
`dbts_c1` (`lab/av1/fetch_data.sh`; systems A and C 12-bit, B 10-bit, [`../../bytes/frame-groups/README.md`](../../bytes/frame-groups/README.md)
§Measured); then row 17's seven series. Timed frames: each series' first 16, as above.

**Encodings.** Row 17's unchanged (`encode.py`: libaom 3.15.1, `--end-usage=q --cpu-used=6`, G = 8, grey 4:0:0 at
10 bits with s = max(0, bits − 10)), at these preview qualities, every one reported with its measured PSNR and max |Δ|
as §The preview and the residual defines them:

* **row 17's**: the CRF in {8, 20, 32, 44} whose preview + HTJ2K residual is fewest bytes (`--crf auto`);
* **higher**: CRF 8 and CRF 2, at the same 10-bit preview (a CRF already chosen above is not repeated);
* **higher, at full depth**, `dbts_a1` and `dbts_c1` only: CRF 8 with s = 0 (a 12-bit preview), whose preview only
  dav1d-WASM decodes (WebCodecs refuses 12 bits, [`docs/decode/README.md`](../../../../docs/decode/README.md) §AV1).

No quality is called visually lossless here; that threshold is the owner's. `encode.py` takes its CRFs and s as
arguments for this; nothing else in it changes.

**Bytes.** Per series and quality, over the 16 timed frames and over the whole series: the residual's HTJ2K bytes ÷
HTJ2K's whole frames, and the preview's bytes beside them.

**Decoders.** HTJ2K: OpenJPH-WASM as the client ships it (`client/decode/wasm/built/openjph`, loaded through
`wasm-glue.js` `built("openjph")`, checked against `wasm/build/manifest.sha256`, one thread) — not the
`@cornerstonejs/codec-openjph` package row 17 timed, so H is re-timed here, not taken from the table above. Preview:
WebCodecs with the client's configuration (`prefer-software`, `client/decode/av1-webcodecs.js`) where it takes the
depth, dav1d-WASM (the client's `built("dav1d")`) otherwise; P runs both where both take it.

**Order and rounds.** Headless Chromium as above, this container, 4 cores; 1× and 4× through
`lab/scripts/cpu_throttle.mjs` (`throttleTree`), each (throttle, round) a fresh browser. Inside a round the arms of every
(series, quality) run in a Williams order (`lab/order.mjs`), and the summary prints the paired leads by predecessor
with its `UNBALANCED` flag ([`docs/rig-limits.md`](../../../../docs/rig-limits.md) §6). A cell whose order effect
exceeds 10 % is not read. Rounds by power, to resolve 5 %: a 5-round pilot per throttle on `dbts_a1`, discarded, gives
σ, the standard deviation of ln(RA ÷ H) over paired rounds; then n = max(15, ⌈((1.96 + 0.84) · σ ÷ ln 1.05)²⌉), two-sided
5 %, power 80 % (*derived*: the normal approximation for a paired mean), rounded up to a whole Williams period, at most
60. If n would exceed 60, the run stops at 60 and says 5 % was not resolved.

**Saturation.** At 4× every thread is capped at a quarter of a CPU; WebCodecs runs its own decoder threads, so P through
WebCodecs at 4× is not a one-core figure. Nothing is claimed past 4×, or for a host other than this one.

**Checked**, every round:

* every exact frame (H and RA, and R after its add) hashed against the checksum written when the series was fetched;
* every preview frame hashed against native dav1d 1.5.4's decode of the same stream, in R, RA and P;
* every residual decoded in R hashed against the residual `encode.py` wrote.

A miss anywhere voids that (series, quality, throttle) cell; it is reported, not re-run quietly.

**Mutations**, run once before the campaign and reported: the add's offset off by one must turn RA to 0/16 exact
while R's residual checks, H and every preview check stay 16/16; `--mutate hash` must turn every exact-frame and
preview check to 0.

**Decision rule.** Per series, quality and throttle: the median over rounds of the paired ratio RA ÷ H, its range, and
the rounds RA was slower out of n.

* **More** if the median ≥ 1.05 and RA slower in ≥ 90 % of rounds; **less** if ≤ 0.95 and faster in ≥ 90 %;
  **the same** if inside 0.95–1.05; otherwise **unresolved**, said so.
* **Read on the three DBT sets at row 17's quality, 1× and 4×.** All six "the same" or "less": with the preview on
  screen, the exact frame by residual costs no more decode than a whole HTJ2K frame, the preview costs the exact fill
  only its own decode, and the choice between them is bytes and the owner's ruling on a lossy first picture. Any one
  "more": the residual is a byte saving bought with decode, and the bytes table says how much it buys.
* **Prediction: 0.9–1.1×** (*derived*: the residual is 0.947–1.002 of HTJ2K's bytes at row 17's quality; that
  OpenJPH's decode time tracks its bytes is *unverified*, and the add is one integer add a sample, assumed small against
  entropy decoding, *unverified*). Any DBT cell outside 0.9–1.1 falsifies it, and is reported as such.

**Unverified: a hardware decoder's preview.** The residual is exact only against the preview the encoder reconstructed,
bit for bit. The AV1 specification fixes that for every conforming decoder when film grain is off — [AV1 Bitstream &
Decoding Process Specification](https://aomediacodec.github.io/av1-spec/), §7.2 General decoding process: "When
film_grain_params_present is equal to 0, decoders shall produce output frames that are identical in all respects and have
the same output order as those produced by the decoding process specified herein." That `encode.py`'s previews have
film_grain_params_present = 0 is *unverified* (libaom adds grain only when asked, and it is not asked); the run reads it
from each stream's sequence header. The 13 440/13 440 above are software decoders only (no GPU here; Chromium's
WebCodecs then runs dav1d, [`docs/av1/README.md`](../../../../docs/av1/README.md) §Which decoder for which frame).
**Whether a hardware AV1 decoder returns the preview bit-identical is not measured:** the clause binds the decoder's output
frames, not a browser's read-back of a GPU frame through `copyTo`, and a browser may not use hardware when asked —
[WebCodecs](https://www.w3.org/TR/webcodecs/), §HardwareAcceleration, `prefer-hardware`: "Indicates that the User Agent
SHOULD prefer hardware acceleration. User Agents may ignore this value for any reason." **What would check it:** on a
device with an AV1 hardware decoder, the same previews through WebCodecs with `prefer-hardware`, the hardware path
confirmed in the browser's media log, every frame's `copyTo` planes hashed against native dav1d's; then RA's exact-frame
check on that device. Until then the residual on a hardware-decoded preview is exact only where the frame check passes,
and a failed frame falls back to the whole HTJ2K frame (*derived*).

## Residual apart, measured: the DBT volumes (2026-11-03)

The protocol above, run on its first content. The seven series of row 17 follow in their own section once this one is
reported, as the protocol orders. Harness: `apart.mjs` (driver), `apart.js` (one arm, one worker), `apart.html`,
`apart_truth.py` (references and bytes); rows and printed summaries in [`rows/`](rows/).

```bash
lab/av1/delivery/residual/encode.py lab/.av1-build lab/.av1-work/apart/a1 lab/av1/data/dbts_a1 --crfs 8,20,32,44,2  # b1, c1 alike
lab/av1/delivery/residual/encode.py lab/.av1-build lab/.av1-work/apart/a1-s0 lab/av1/data/dbts_a1 --crfs 8 --shift 0 # c1 alike
lab/av1/.venv/bin/python lab/av1/delivery/residual/apart_truth.py lab/.av1-build lab/.av1-work/apart/a1   # every OUT
D=lab/.av1-work/apart; NODE_PATH=$(npm root -g) node lab/av1/delivery/residual/apart.mjs \
  --frames $D/a1,$D/a1-s0,$D/b1,$D/c1,$D/c1-s0 --sets dbts_a1,dbts_b1,dbts_c1 --rounds 60 --out rows/dbt.json  # ~11.7 h
```

**Host.** This container: 4 cores of an Intel Xeon @ 2.80 GHz, 15 GB, nothing else running during the timed runs;
headless Chrome for Testing 153.0.8010.12 (playwright 1.63.0), not row 17's 141. H, R and RA are one thread each, in a
worker of their own, so at 1× they use one of the four cores and the host does not saturate; at 4× every thread is
capped at a quarter of a CPU (`cpu_throttle.mjs --check` on this VM: page thread 623 → 2 692 ms, worker 674 → 2 733 ms).
P through WebCodecs runs its own decoder threads and is not a one-core figure at either throttle. Nothing here holds
past 4× or for another host.

**What was run as written, and where the run had to choose.**

* **The decoders are the client's.** OpenJPH and dav1d are `built("openjph")` and `built("dav1d")` through `wasm-glue.js`,
  which refuses a file whose SHA-256 differs from `wasm/build/manifest.sha256`. Docker Hub refused the pinned base
  image (HTTP 429), so `inside.sh` ran on the host from the same pinned, checksummed inputs; all ten built files match
  the manifest. The WebCodecs preview is configured as the client does it (`prefer-software`, `optimizeForLatency`, the
  codec string from the stream's own sequence header).
* **Clocks.** H, R and RA sum each frame's interval: H decodes and writes the stored samples; R decodes the residual
  and adds after its clock stops; RA decodes and adds on the clock. P is one span over the 16 units, a group at a time,
  flushed at each group's end. Every arm decodes once before its clock starts, row 17's warm-up.
* **Order.** Inside a round the cells run in a Williams order, and so do the arms of each cell. A cell has five arms
  (H, R, RA, P WebCodecs, P dav1d), or four at 12 bits, where only dav1d decodes the preview. The **order effect** of a
  cell is the largest |median ÷ overall median − 1| of RA ÷ H over the groups of rounds that share RA's predecessor
  (*derived*: the protocol names the 10 % limit, not the statistic). No cell printed `UNBALANCED`.
* **Rounds.** The first campaign (n = 40 from a pilot on the first VM) was lost at round 26 of 40 to a container restart.
  Its rows were written only at the end, and pairs across a restart are not comparable ([`docs/rig-limits.md`](../../../../docs/rig-limits.md)
  §6). So the mutations and the pilot were re-run on the new VM, and the driver now writes its rows after every round.
  That pilot, on `dbts_a1` at row 17's quality (CRF 20), gave σ = 0.181 at 1× (n = 109) and 0.057 at 4× (n = 11). By the
  protocol's own rule the run stopped at **60 rounds, and 5 % was not resolved**. σ was taken at row 17's quality, the
  cell the rule reads; `dbts_a1`'s other three cells asked for 102–313 at 1× and 7–44 at 4×
  ([`rows/pilot-summary.txt`](rows/pilot-summary.txt)).
* **`encode.py`** takes `--crfs` and `--shift` and nothing else changed. A shift that leaves more than 10 bits makes a
  12-bit 4:0:0 preview (profile 2); a shifted cell is named `crf8-s0`.

**Encodings and bytes.** Row 17's quality is CRF 20 on all three: preview + HTJ2K residual over the series is 1.0008
(`dbts_a1`), 0.9933 (`dbts_b1`) and 0.9973 (`dbts_c1`) of HTJ2K's whole frames, the fewest of {8, 20, 32, 44}. The 16
timed frames hold 20 172 292, 34 277 351 and 17 552 575 B of HTJ2K (series 67 812 443, 107 407 602 and 70 664 924 B; 56,
50 and 69 frames). Every preview keyframe of every cell reads film_grain_params_present = 0 in its sequence header
(2/2 per cell's 16 frames), so for these streams the condition the protocol quotes from AV1 §7.2 holds.

| set | cell | quality | preview bits | PSNR · max \|Δ\| | residual bits | residual ÷ HTJ2K, 16 · series | preview ÷ HTJ2K, 16 · series |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | CRF 20 | row 17 | 10 | 45.94 · 589 | 10 | 0.9978 · 0.9976 | 0.0029 · 0.0032 |
| | CRF 8 | higher | 10 | 48.35 · 248 | 9 | 0.9726 · 0.9724 | 0.0291 · 0.0300 |
| | CRF 2 | higher | 10 | 61.90 · 113 | 8 | 0.6642 · 0.6599 | 0.3839 · 0.3888 |
| | CRF 8, s = 0 | full depth | 12 | 48.47 · 256 | 9 | 0.9694 · 0.9694 | 0.0311 · 0.0319 |
| `dbts_b1` | CRF 20 | row 17 | 10 | 44.77 · 376 | 10 | 0.9809 · 0.9816 | 0.0115 · 0.0118 |
| | CRF 8 | higher | 10 | 50.15 · 107 | 8 | 0.8750 · 0.8747 | 0.1366 · 0.1399 |
| | CRF 2 | higher | 10 | 65.53 · 31 | 6 | 0.4423 · 0.4431 | 0.6203 · 0.6233 |
| `dbts_c1` | CRF 20 | row 17 | 10 | 46.56 · 644 | 10 | 0.9936 · 0.9934 | 0.0036 · 0.0040 |
| | CRF 8 | higher | 10 | 49.71 · 301 | 10 | 0.9589 · 0.9583 | 0.0436 · 0.0459 |
| | CRF 2 | higher | 10 | 63.59 · 107 | 8 | 0.6489 · 0.6429 | 0.3942 · 0.3999 |
| | CRF 8, s = 0 | full depth | 12 | 49.87 · 280 | 9 | 0.9545 · 0.9537 | 0.0464 · 0.0490 |

(`dbts_b1` is 10-bit, so its s is already 0 and it has no full-depth cell; PSNR over 2^bits − 1 as §The preview and the
residual defines it.)

**Decode time**, ms a frame over the 16 timed frames, median over 60 rounds. The rule's columns: RA ÷ H paired by round,
median [range], and the rounds RA was slower out of 60. RA − R is the add, *derived*.

| throttle · set | cell | H | R | RA | RA − R | P WebCodecs | P dav1d | **RA ÷ H** | RA slower | order effect | rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1× `dbts_a1` | **CRF 20** | 25.0 | 18.8 | 24.9 | 5.40 | 13.2 | 33.6 | **1.003** [0.668–1.762] | 31/60 | 7.6 % | the same |
| | CRF 8 | 25.8 | 18.8 | 25.1 | 5.86 | 23.7 | 57.2 | 1.003 [0.542–1.988] | 30/60 | 9.0 % | the same |
| | CRF 2 | 25.4 | 18.5 | 24.7 | 5.84 | 60.4 | 106 | 0.968 [0.655–1.381] | 26/60 | 5.4 % | the same |
| | CRF 8, s = 0 | 26.1 | 19.0 | 24.8 | 5.70 | — | 56.6 | 0.963 [0.543–1.639] | 22/60 | 5.4 % | the same |
| 1× `dbts_b1` | **CRF 20** | 71.0 | 46.1 | 72.8 | 24.6 | 42.1 | 98.1 | **1.002** [0.760–1.617] | 30/60 | 1.9 % | the same |
| | CRF 8 | 73.3 | 47.7 | 74.6 | 24.5 | 88.3 | 169 | 0.962 [0.734–1.441] | 25/60 | 8.3 % | the same |
| | CRF 2 | 73.7 | 44.8 | 69.4 | 25.8 | 152 | 258 | 0.951 [0.680–2.511] | 19/60 | 4.5 % | the same |
| 1× `dbts_c1` | **CRF 20** | 26.5 | 18.7 | 26.3 | 7.84 | 15.5 | 34.7 | **0.992** [0.574–1.642] | 29/60 | 8.5 % | the same |
| | CRF 8 | 26.3 | 18.7 | 25.4 | 6.63 | 25.4 | 53.3 | 0.982 [0.607–1.611] | 25/60 | 8.5 % | the same |
| | CRF 2 | 25.5 | 17.8 | 25.2 | 7.00 | 54.9 | 96.6 | 0.979 [0.605–1.374] | 26/60 | **19.5 %** | not read |
| | CRF 8, s = 0 | 25.9 | 18.0 | 26.6 | 7.79 | — | 53.7 | 1.020 [0.706–1.266] | 33/60 | 9.6 % | the same |
| 4× `dbts_a1` | **CRF 20** | 116 | 89.0 | 118 | 27.8 | 41.1 | 154 | **1.004** [0.767–1.290] | 30/60 | 3.1 % | the same |
| | CRF 8 | 114 | 87.5 | 117 | 27.9 | 48.5 | 267 | 0.996 [0.723–1.613] | 28/60 | 7.7 % | the same |
| | CRF 2 | 117 | 84.5 | 110 | 27.0 | 255 | 482 | 0.952 [0.774–1.285] | 22/60 | 4.7 % | the same |
| | CRF 8, s = 0 | 114 | 87.0 | 114 | 27.5 | — | 270 | 1.008 [0.829–1.223] | 33/60 | 0.8 % | the same |
| 4× `dbts_b1` | **CRF 20** | 337 | 219 | 331 | 116 | 141 | 465 | **0.981** [0.811–1.952] | 24/60 | 5.1 % | the same |
| | CRF 8 | 336 | 214 | 328 | 113 | 220 | 763 | 0.978 [0.745–1.596] | 19/60 | 1.7 % | the same |
| | CRF 2 | 329 | 204 | 323 | 114 | 633 | 1 147 | 0.953 [0.818–1.759] | 18/60 | 5.7 % | the same |
| 4× `dbts_c1` | **CRF 20** | 120 | 85.9 | 118 | 31.4 | 46.4 | 161 | **0.973** [0.756–1.353] | 25/60 | 4.2 % | the same |
| | CRF 8 | 121 | 84.6 | 117 | 33.2 | 56.9 | 254 | 0.978 [0.685–1.324] | 26/60 | 6.3 % | the same |
| | CRF 2 | 119 | 81.9 | 115 | 33.4 | 225 | 438 | 0.979 [0.736–1.147] | 23/60 | 6.7 % | the same |
| | CRF 8, s = 0 | 121 | 84.3 | 117 | 34.5 | — | 249 | 0.974 [0.721–1.128] | 21/60 | 3.8 % | the same |

**The rule, as written.** At row 17's quality (bold), 1× and 4×, all six DBT cells read **the same** (medians
0.973–1.004). The rule's reading for that case: *with the preview on screen, the exact frame by residual costs no more
decode than a whole HTJ2K frame, the preview costs the exact fill only its own decode, and the choice between them is
bytes and the owner's ruling on a lossy first picture.* The run attaches two limits of its own:

* **5 % was not resolved.** The pilot asked for 109 rounds at 1× and the protocol stops at 60. Paired ratios ran
  0.57–1.95 within one cell, so a median inside 0.95–1.05 is "the same" by the rule, not a measured bound of ±5 %.
* **The prediction (0.9–1.1×) stands.** All 22 cells' medians fall within 0.951–1.020; none falsifies it.

Beside the rule, as numbers and not as findings of it: R alone is 0.61–0.76 of H, paired, in every cell. The add (RA − R)
is 5.4–7.8 ms a frame at 1× on `dbts_a1` and `dbts_c1` (2.0 and 2.5 Mpx a frame: 1142 × 1785, 976 × 2513) and
24.5–25.8 ms on `dbts_b1` (8.5 Mpx: 2560 × 3328). The protocol left "the add is small against entropy decoding"
*unverified*; here it is 0.22–0.35 of RA (*derived* from the medians), so not small.

**Checked, every round.** All 60 rounds × 2 throttles, every arm of every cell: exact frames 960/960 (H, R after its add,
RA), previews bit-identical to native dav1d 960/960 (R, RA, both P), residuals as `encode.py` wrote them 960/960 (R).
Not one cell is void.

**Mutated, once before the campaign** (this VM, 1 round, 1×, all 11 cells; [`rows/mutate-offset.txt`](rows/mutate-offset.txt),
[`rows/mutate-hash.txt`](rows/mutate-hash.txt)). The add's offset off by one turned RA to 0/16 exact in every cell, and R's
frames after its add with it, while R's residual checks, H and every preview check stayed 16/16. `--mutate hash` turned
every exact-frame, preview and residual check to 0/16. Both held on the first VM too.

## Residual apart, measured: row 17's seven series (2026-11-04)

The protocol's second content, run once the DBT section above was reported (PR comment, 2026-11-04), with the same
harness, the same 60 rounds and the same host class. Every cell is reported. The rule's DBT reading does not apply
here: the protocol reads its decision on the DBT sets, so these are per-cell verdicts only.

```bash
lab/av1/delivery/residual/encode.py lab/.av1-build lab/.av1-work/apart/seven \
  lab/av1/data/{rf_fluoro,us_liver,mr_ispy1,ct_lidc,xa_dynact16,dbt12_ea1141,dbt10_ea1141} --crfs 8,20,32,44,2
lab/av1/.venv/bin/python lab/av1/delivery/residual/apart_truth.py lab/.av1-build lab/.av1-work/apart/seven
NODE_PATH=$(npm root -g) node lab/av1/delivery/residual/apart.mjs --frames lab/.av1-work/apart/seven \
  --sets rf_fluoro,us_liver,mr_ispy1,ct_lidc,xa_dynact16,dbt12_ea1141,dbt10_ea1141 --rounds 60 --out rows/seven.json
```

**Three VMs.** The container restarted twice under this run, at rounds 14 and 47; the driver resumed after the last
complete round each time. Rounds 0–13 ran on the DBT run's VM, 14–46 on a second, 47–59 on a third (`cpu_throttle.mjs
--check` at 1×: page thread 623, 535 and 545 ms). Every ratio is paired inside one round, so inside one browser on one
VM; the ms columns pool three VMs. The verdicts per VM segment, and with round 47 dropped, are below. **Round 47 is not
clean:** at its start this session ran a throttle check (~40 s, one thread) beside it, an error of the run.

**Encodings and bytes.** Row 17's quality is its bold CRF in every series (the same choice, recomputed). Preview bits
are 10 for grey and 8 for the ultrasound's colour. Every preview keyframe reads film_grain_params_present = 0.
The 16 timed frames hold `rf_fluoro` 8 222 975, `us_liver` 4 150 240, `mr_ispy1` 2 951 799, `ct_lidc` 2 715 273,
`xa_dynact16` 3 715 924, `dbt12_ea1141` 8 066 309 and `dbt10_ea1141` 9 106 227 B of HTJ2K (the first 16 of 18, 70, 58,
100, 64, 29 and 24 frames).

| set | cell | quality | PSNR · max \|Δ\| | residual bits | residual ÷ HTJ2K, 16 · series | preview ÷ HTJ2K, 16 · series |
| --- | --- | --- | --- | --- | --- | --- |
| `rf_fluoro` | CRF 20 | row 17 | 43.92 · 433 | 10 | 0.9822 · 0.9821 | 0.0075 · 0.0078 |
| | CRF 8 | higher | 47.51 · 197 | 9 | 0.9467 · 0.9456 | 0.0580 · 0.0596 |
| | CRF 2 | higher | 60.01 · 33 | 6 | 0.6656 · 0.6647 | 0.3899 · 0.3910 |
| `us_liver` | CRF 8 | row 17 | 41.60 · 87 | 8 | 0.7186 · 0.7243 | 0.2197 · 0.2222 |
| | CRF 2 | higher | 43.28 · 86 | 8 | 0.6227 · 0.6228 | 0.3335 · 0.3433 |
| `mr_ispy1` | CRF 8 | row 17 | 47.88 · 64 | 7 | 0.9087 · 0.8946 | 0.0927 · 0.1008 |
| | CRF 2 | higher | 60.35 · 21 | 6 | 0.6006 · 0.5925 | 0.4314 · 0.4308 |
| `ct_lidc` | CRF 8 | row 17 | 54.70 · 447 | 10 | 0.9373 · 0.9241 | 0.0143 · 0.0259 |
| | CRF 2 | higher | 62.20 · 107 | 8 | 0.8680 · 0.8517 | 0.1244 · 0.1243 |
| `xa_dynact16` | CRF 8 | row 17 | 47.85 · 363 | 10 | 0.9028 · 0.9039 | 0.0917 · 0.0900 |
| | CRF 2 | higher | 61.15 · 104 | 8 | 0.6462 · 0.6483 | 0.3557 · 0.3535 |
| `dbt12_ea1141` | CRF 20 | row 17 | 44.77 · 339 | 10 | 0.9965 · 0.9976 | 0.0040 · 0.0044 |
| | CRF 8 | higher | 48.23 · 199 | 9 | 0.9563 · 0.9556 | 0.0477 · 0.0491 |
| | CRF 2 | higher | 61.98 · 89 | 8 | 0.6467 · 0.6447 | 0.4027 · 0.4050 |
| `dbt10_ea1141` | CRF 20 | row 17 | 41.59 · 281 | 10 | 0.9710 · 0.9714 | 0.0193 · 0.0191 |
| | CRF 8 | higher | 47.94 · 56 | 7 | 0.8492 · 0.8489 | 0.1447 · 0.1454 |
| | CRF 2 | higher | 62.53 · 19 | 6 | 0.4482 · 0.4483 | 0.6208 · 0.6217 |

Where row 17's CRF is 8, "higher" is CRF 2 alone, the protocol's no-repeat clause. No full-depth cell: that was for
`dbts_a1` and `dbts_c1` only.

**Decode time**, as in the DBT table: ms a frame, median of 60 rounds; RA ÷ H paired.

| throttle · set | cell | H | R | RA | RA − R | P WebCodecs | P dav1d | **RA ÷ H** | RA slower | order effect | rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1× `rf_fluoro` | **CRF 20** | 8.35 | 6.40 | 8.22 | 1.75 | 4.52 | 15.8 | **1.001** [0.583–1.480] | 30/60 | 2.8 % | the same |
| | CRF 8 | 8.21 | 6.57 | 8.18 | 1.86 | 8.95 | 18.8 | 1.016 [0.533–1.673] | 34/60 | 5.6 % | the same |
| | CRF 2 | 8.15 | 6.37 | 7.96 | 1.49 | 22.1 | 35.5 | 0.961 [0.435–1.711] | 23/60 | 3.6 % | the same |
| 1× `us_liver` | **CRF 8** | 9.67 | 8.58 | 12.6 | 3.70 | 8.40 | 14.5 | **1.283** [0.783–2.278] | 54/60 | 3.4 % | **more** |
| | CRF 2 | 9.95 | 8.77 | 12.5 | 3.71 | 11.5 | 17.6 | 1.263 [0.774–2.178] | 52/60 | 8.9 % | unresolved |
| 1× `mr_ispy1` | **CRF 8** | 4.90 | 3.26 | 4.10 | 0.81 | 4.65 | 8.66 | **0.848** [0.476–1.467] | 10/60 | 3.0 % | unresolved |
| | CRF 2 | 5.00 | 3.17 | 4.06 | 0.93 | 9.68 | 16.6 | 0.828 [0.479–1.393] | 13/60 | 5.8 % | unresolved |
| 1× `ct_lidc` | **CRF 8** | 4.66 | 3.23 | 4.30 | 0.94 | 2.48 | 5.05 | **0.901** [0.585–1.870] | 12/60 | 4.4 % | unresolved |
| | CRF 2 | 4.74 | 3.14 | 4.02 | 0.88 | 4.67 | 7.85 | 0.849 [0.451–1.541] | 15/60 | 8.4 % | unresolved |
| 1× `xa_dynact16` | **CRF 8** | 4.85 | 3.25 | 4.19 | 0.89 | 4.92 | 8.34 | **0.885** [0.528–1.835] | 15/60 | 5.0 % | unresolved |
| | CRF 2 | 4.74 | 3.13 | 3.94 | 0.83 | 10.7 | 15.5 | 0.843 [0.512–1.384] | 11/60 | 7.8 % | unresolved |
| 1× `dbt12_ea1141` | **CRF 20** | 9.82 | 7.48 | 9.85 | 2.30 | 5.65 | 12.7 | **0.990** [0.627–2.345] | 27/60 | 3.8 % | the same |
| | CRF 8 | 9.77 | 7.45 | 10.1 | 2.27 | 10.5 | 22.5 | 1.011 [0.620–1.526] | 33/60 | 8.0 % | the same |
| | CRF 2 | 9.71 | 7.27 | 10.0 | 2.71 | 26.2 | 42.1 | 1.021 [0.648–1.777] | 31/60 | 6.3 % | the same |
| 1× `dbt10_ea1141` | **CRF 20** | 13.3 | 9.96 | 13.2 | 3.20 | 9.65 | 20.0 | **0.979** [0.678–1.354] | 24/60 | 5.1 % | the same |
| | CRF 8 | 13.2 | 9.68 | 13.5 | 3.45 | 20.3 | 38.2 | 1.024 [0.524–1.575] | 35/60 | 4.6 % | the same |
| | CRF 2 | 13.2 | 9.48 | 12.8 | 3.36 | 41.1 | 67.1 | 0.964 [0.596–1.779] | 23/60 | 6.3 % | the same |
| 4× `rf_fluoro` | **CRF 20** | 35.9 | 28.2 | 37.2 | 8.57 | 12.1 | 73.1 | **1.023** [0.639–1.661] | 33/60 | 7.2 % | the same |
| | CRF 8 | 38.5 | 28.1 | 36.5 | 6.56 | 16.5 | 90.1 | 0.993 [0.526–1.589] | 29/60 | 7.3 % | the same |
| | CRF 2 | 36.1 | 27.2 | 34.8 | 7.31 | 85.9 | 169 | 0.947 [0.591–1.639] | 24/60 | 7.7 % | unresolved |
| 4× `us_liver` | **CRF 8** | 45.2 | 41.8 | 57.1 | 15.3 | 28.9 | 68.5 | **1.267** [0.833–1.667] | 54/60 | 7.5 % | **more** |
| | CRF 2 | 45.1 | 42.0 | 58.2 | 15.7 | 44.3 | 82.6 | 1.285 [0.818–1.802] | 58/60 | 8.1 % | more |
| 4× `mr_ispy1` | **CRF 8** | 20.9 | 13.5 | 17.0 | 3.40 | 9.89 | 39.3 | **0.831** [0.489–1.361] | 9/60 | 5.6 % | unresolved |
| | CRF 2 | 20.2 | 12.9 | 15.9 | 3.61 | 30.8 | 75.3 | 0.799 [0.463–1.651] | 3/60 | 4.3 % | less |
| 4× `ct_lidc` | **CRF 8** | 19.1 | 13.6 | 17.2 | 3.08 | 6.06 | 24.0 | **0.892** [0.541–1.292] | 11/60 | 7.3 % | unresolved |
| | CRF 2 | 19.4 | 12.4 | 17.3 | 3.85 | 12.5 | 37.9 | 0.888 [0.541–1.446] | 14/60 | 9.8 % | unresolved |
| 4× `xa_dynact16` | **CRF 8** | 19.1 | 12.8 | 17.3 | 3.94 | 11.8 | 40.4 | **0.891** [0.589–1.867] | 16/60 | 4.9 % | unresolved |
| | CRF 2 | 20.0 | 12.8 | 16.0 | 2.88 | 39.2 | 74.7 | 0.816 [0.444–1.321] | 10/60 | **12.0 %** | not read |
| 4× `dbt12_ea1141` | **CRF 20** | 43.5 | 32.9 | 42.0 | 9.60 | 17.1 | 57.9 | **0.995** [0.703–1.411] | 25/60 | 7.6 % | the same |
| | CRF 8 | 46.0 | 32.8 | 42.8 | 9.59 | 23.0 | 105 | 0.990 [0.655–1.500] | 29/60 | 9.5 % | the same |
| | CRF 2 | 44.1 | 31.5 | 42.3 | 9.59 | 106 | 198 | 0.953 [0.632–1.347] | 22/60 | 7.7 % | the same |
| 4× `dbt10_ea1141` | **CRF 20** | 59.0 | 44.5 | 60.4 | 13.9 | 25.6 | 98.2 | **1.021** [0.663–1.831] | 35/60 | 2.1 % | the same |
| | CRF 8 | 60.4 | 43.8 | 59.0 | 15.5 | 44.0 | 185 | 0.992 [0.640–1.548] | 28/60 | 5.4 % | the same |
| | CRF 2 | 59.7 | 42.5 | 60.1 | 15.7 | 172 | 320 | 1.006 [0.703–1.617] | 32/60 | **11.1 %** | not read |

**The rule per cell, as written, at row 17's quality (bold).**

* **The same** on fluoroscopy and both EA1141 tomosynthesis series, 1× and 4×.
* **More** on the ultrasound at 1× and 4× (1.283 and 1.267, RA slower 54/60 each). That is at the rule's 90 % edge:
  with round 47 dropped both read 53/59 and fall to **unresolved**. The ultrasound is the one colour series. Its
  residual decodes at 0.89–0.92 of H, against 0.63–0.78 on grey, and its add (3 channels with the fixed-point colour
  conversion) is 3.7 ms a frame at 1×. Why the colour cell costs more is a reading of those columns, not a test.
* **Unresolved** on MR, CT and cone-beam, 1× and 4×. Medians run 0.831–0.901, RA faster in 44–51 of 60, short of the
  90 % that "less" needs.
* Off row 17's quality, `mr_ispy1` CRF 2 at 4× reads **less** (0.799, faster 57/60). Two cells are not read for order
  effect: `xa_dynact16` CRF 2 and `dbt10_ea1141` CRF 2, at 4×.
* **5 % not resolved here either**: the same 60 rounds, which the DBT pilot had already shown too few.

**Per VM segment**, the row-17 cells' RA ÷ H (median, RA slower k/n). Single segments move by up to 0.12 (fluoroscopy
4×: 1.125 on the third VM), and their rule readings differ where n is small.

| throttle · set | rounds 0–13 | 14–46 | 47–59 | all but 47 |
| --- | --- | --- | --- | --- |
| 1× `rf_fluoro` | 1.014 · 9/14 | 0.917 · 14/33 | 1.017 · 7/13 | 0.999 · 29/59 |
| 1× `us_liver` | 1.235 · 11/14 | 1.304 · 30/33 | 1.282 · 13/13 | 1.283 · 53/59 |
| 1× `mr_ispy1` | 0.896 · 6/14 | 0.840 · 3/33 | 0.847 · 1/13 | 0.849 · 10/59 |
| 1× `ct_lidc` | 0.920 · 3/14 | 0.904 · 8/33 | 0.874 · 1/13 | 0.904 · 12/59 |
| 1× `xa_dynact16` | 0.889 · 4/14 | 0.869 · 7/33 | 0.884 · 4/13 | 0.885 · 15/59 |
| 1× `dbt12_ea1141` | 0.976 · 5/14 | 1.013 · 17/33 | 0.982 · 5/13 | 0.988 · 26/59 |
| 1× `dbt10_ea1141` | 0.964 · 5/14 | 0.962 · 13/33 | 0.983 · 6/13 | 0.981 · 24/59 |
| 4× `rf_fluoro` | 1.000 · 7/14 | 0.994 · 16/33 | 1.125 · 10/13 | 1.023 · 32/59 |
| 4× `us_liver` | 1.340 · 14/14 | 1.238 · 28/33 | 1.205 · 12/13 | 1.262 · 53/59 |
| 4× `mr_ispy1` | 0.797 · 0/14 | 0.853 · 7/33 | 0.858 · 2/13 | 0.826 · 9/59 |
| 4× `ct_lidc` | 0.909 · 4/14 | 0.909 · 6/33 | 0.844 · 1/13 | 0.904 · 11/59 |
| 4× `xa_dynact16` | 0.950 · 3/14 | 0.876 · 9/33 | 0.829 · 4/13 | 0.900 · 16/59 |
| 4× `dbt12_ea1141` | 0.927 · 4/14 | 0.994 · 12/33 | 1.019 · 9/13 | 0.995 · 24/59 |
| 4× `dbt10_ea1141` | 1.030 · 9/14 | 1.020 · 20/33 | 0.994 · 6/13 | 1.020 · 34/59 |

**Checked, every round:** exact frames, previews against native dav1d and residuals against `encode.py`, 960/960 in
every arm of all 34 (cell, throttle) pairs; none void, none `UNBALANCED`. The mutations are the DBT section's, run
once before the campaign as the protocol orders.

## Lossy pixel work protocol, pre-registered (row PIXELWORK, 2026-11-04)

* **Asked:** in each lossy design, where does a frame's time go once the decoder has returned its pixels, and which way of removing that work applies, at what saving and what structural cost?
* **Answer (theory, nothing timed in a browser yet):** the pixel work is largest beside its own decode in the lossy picture alone, ~1× the decode, about a third of the residual design's exact frame, and a few % of a whole HTJ2K frame's. The add with its range in one pass (built behind `onePass`) is the best change that is not structural. The SIMD kernel S and the shader G save more, but S adds a build artifact and G changes the frame contract.
* **Numbers that decide it:** the add is 0.22–0.35 of the residual design's exact frame (measured above). A JS pass costs 3.6–4.1 ns a sample, against 1.6–2.4 ns for the copy a frame makes out of WebCodecs (both measured in the lossless work). In Node, the one-pass add is 0.70–0.76 of the two-pass and S is 0.22–0.50 of the one-pass (*exploratory*).
* **Rests on:** `dbts_a1`, `dbts_b1` and `dbts_c1`, with `mr_ispy1` as the small-frame control. Nothing here is claimed for any other series.
* **Left:** the browser run below (≤ 4.5 h on a 4-core host), and the GPU arms, which are owed to a machine with a GPU.

**Terms.** *G* is the number of frames coded together (a group; the previews here use G = 8). *Q* is the lossy quantizer;
libaom sets it here through CRF, its quality setting. *Systems A, B and C* are the three DBT scanners of the EA1141 dataset: A and C
store 12 bits, B stores 10 (`dbts_a1`, `dbts_b1`, `dbts_c1` are one volume of each). The *preview* is the lossy AV1 picture
(10-bit 4:0:0, coded as `(v + 2^(s−1)) >> s` with s = max(0, bits − 10), so s = 2 on A and C, 0 on B and 1 on 11-bit MR).
The *residual* is exact − preview, after one offset per series makes it unsigned. The *three lossy designs* are:
**1**, the preview alone (shown at the stored scale, `(p << s) − offset`); **2**, preview + HTJ2K residual (exact =
`(p << s) + r − bias`); **3**, preview, then the whole HTJ2K frame. The levers take the merge-free work's names
([`docs/decode/README.md`](../../../../docs/decode/README.md) §The split's rebuild without JavaScript, in theory):
**S** is a WebAssembly SIMD kernel doing the pass. **Lever G** is the pass done in the paint shader. It is a different
thing from the group length G, and is always written "lever G". **R** is the `copyTo` buffer reused across frames
(the product's `reuseCopyBuffer`). A *pass* is one JavaScript loop over every sample. *N* is a frame's samples: 2.04 M on `a1`
(1142 × 1785), 8.52 M on `b1` (2560 × 3328), 2.45 M on `c1` (976 × 2513), 0.26 M on `mr_ispy1` (512²).

### Where the time after decode goes, predicted

Per-sample costs, all measured in the lossless work and carried over here (*derived*):

* **A JS pass** writing a fresh output: 3.6–4.1 ns a sample ([`../../decode/breakdown`](../../decode/breakdown/README.md)
  §Why the JS passes cost 17–30 %, on `origin/claude/av1-unified-mainbase`).
* **A read-only range pass**: 1.9 ns a sample (497 µs over 512² for `set()` plus the pass, §The range pass in
  `docs/decode/README.md`, an upper bound).
* **`copyTo`, buffer allocated each frame**: ~0.7 ns a byte. That is W's `copyTo` share over the bytes it copies:
  5.7 % of 113 ms over 9.2 MB on `a1`, 7.6 % of 233 ms over 25.6 MB on `b1`, 6.9 % of 112 ms over 11 MB on `c1`
  (breakdown, §Stages, W).
* **The digest (XXH3)**: ~0.26 ns a byte (W's 0.9 % of 113 ms over 4.1 MB, and 1.9 % of 233 over 17 MB).
* **The preview's `copyTo`**: 3 bytes a sample. WebCodecs returns 4:0:0 as I420P10, with mid-grey chroma it must copy,
  since "If layout is not undefined and its length does not equal numPlanes, throw a TypeError"
  ([WebCodecs](https://www.w3.org/TR/webcodecs/), §Compute Layout and Allocation Size, read 2026-11-04).

| design | pixel work after decode, per frame | `a1` | `b1` | `c1` | `mr_ispy1` | against |
| --- | --- | --: | --: | --: | --: | --- |
| 1, preview alone | `copyTo` 3N bytes + one pass, shift, offset and range (+ digest 2N, only if a preview digest is kept) | 10–13 ms | 42–52 | 12–15 | 1.3–1.6 | the preview's decode: P WebCodecs, 13.2, 42.1, 15.5 and 4.65 ms at 1× (tables above), which include the harness's own copy |
| 2, + HTJ2K residual | the add, then a range pass (two-pass), + digest 2N | 9.8–13 ms | 41–45 | 12–14 | 1.4–1.6 | the residual's decode R: 18.8, 46.1, 18.7, 3.26 ms |
| 3, + whole HTJ2K | `set()` 2N into the frame's buffer + digest 2N; the range is taken in OpenJPH's pack | ~1.5 ms | ~6 | ~1.8 | ~0.2 | H: 25.0, 71.0, 26.5, 4.90 ms; the codec call is 95–97 % of H (breakdown) |

So **after decode, design 1 is predicted at 40–65 % pixel work, design 2 at 30–40 % (add, range and digest of the
exact frame), and design 3 at 4–8 %**. All three are *derived*. Design 3's preview costs what design 1's does. On `b1`,
s = 0, so its preview pass does no shift, only offset and range.

### What applies, ranked

The specifications behind the table, each read 2026-11-04 unless marked:

* `copyTo` may write into shared memory, more than once on one frame: `Promise<sequence<PlaneLayout>> copyTo(
  AllowSharedBufferSource destination, optional VideoFrameCopyToOptions options = {});` and "Promises that are returned
  by several calls to copyTo() are not guaranteed to resolve in the order they were returned" ([WebCodecs](https://www.w3.org/TR/webcodecs/), §VideoFrame).
* The window shader can shift and add exactly only in `highp`: "Highp signed integers are represented as
  twos-complement 32-bit signed integers. Highp unsigned integers are represented as unsigned 32-bit integers"
  ([GLSL ES 3.00](https://github.com/KhronosGroup/OpenGL-Registry/blob/main/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
  §4.5.1, as quoted in `docs/decode/README.md`, read 2026-11-02).
* A frame can go to a texture with no CPU copy: "NOTE: VideoFrame is a CanvasImageSource" (WebCodecs §VideoFrame
  Interface), and WebGL2's `texImage2D` takes a `TexImageSource`
  ([`webgl2.idl`](https://github.com/KhronosGroup/WebGL/blob/main/specs/latest/2.0/webgl2.idl)). The internal format and
  precision the browser picks for a 10-bit frame are *unverified*.
* "Vector instructions (also known as SIMD instructions, single instruction multiple data) provide basic operations
  over values of vector type" ([WebAssembly 3.0](https://webassembly.github.io/spec/core/syntax/instructions.html),
  as quoted in `docs/decode/README.md`, read 2026-11-02).

| # | lever | designs | saving, predicted | structural cost | exactness check | phone memory |
| --: | --- | --- | --- | --- | --- | --- |
| 1 | **The add in one pass** (`add.js` `exact(…, onePass)`, built): the range taken in the add | 2 | the range pass: ×0.83–0.92 of design 2's exact frame (residual decode + add + digest) | none. Same output, range and buffer | unchanged: the frame's digest covers the output | none |
| 2 | **R** for the preview (`reuseCopyBuffer`, built in the product) | 1, and 3's preview | the buffer's allocation and first touch, 0.38–0.59 ns a byte (merge-free's R ÷ W2 over its 4.5N-byte buffers): ×0.65–0.90 of design 1's pixel work | none | unchanged | one 3N-byte buffer a stream, resident: 6.1, 25.6, 7.4 and 0.8 MB |
| 3 | **M**, chroma check from the header (`mono_chrome`) | 1 | `neutral()`'s 1.6–1.7 ns a chroma sample | none; already the default under `onePass` | unchanged | none |
| 4 | **S**, the pass as a SIMD kernel (`add.c` through `add-simd.js`, built for the lab) | 1 and 2 | design 2: ×0.78–0.90 of the one-pass exact frame. Design 1: ×0.5–0.8 of R's pixel work, since `copyTo` writes straight into the kernel's memory | **yes**: a new WebAssembly artifact pinned in `manifest.sha256`. The frame contract is unchanged | unchanged: a kernel bug is a digest miss | resident kernel memory: 5N bytes for design 1 and 6N for design 2 (43 and 51 MB on `b1`), which grows and never shrinks |
| 5 | **P, the add in OpenJPH's pack**: the preview copied into OpenJPH's heap, and added where `pack` already narrows and ranges each sample | 2 | the whole JS add, less a 2N-byte copy in: ×0.70–0.85 of the one-pass exact frame | **yes**: the pinned OpenJPH build and its interface change, and every HTJ2K frame runs through it | unchanged | +2N in OpenJPH's heap (17 MB on `b1`), which does not shrink ([`docs/decode/README.md`](../../../../docs/decode/README.md) §Heap) |
| 6 | **Lever G, design 1**: the preview's 10-bit plane as an `R16UI` texture, shift and offset in the `highp` window pass, the range from ingest metadata | 1 | the whole pass: design 1's pixel work falls to `copyTo` alone (×0.35–0.55) | **yes**: the frame contract (a picture at 2^−s scale) and a per-frame range at ingest | a lossy picture has no exact claim; a per-preview digest would be ingest metadata | GPU texture 2N |
| 7 | **Lever G, design 2**: the shown preview and the residual as textures, added in the shader | 2 | the add, range and output buffer: ×0.65–0.80 of the one-pass exact frame | **yes**, as merge-free's lever G: two planes, per-stream digests, range from ingest, painter, OPFS store, check page | weaker. The digest covers the residual, not the sum. The sum is checked only by readback | the residual is uploaded: 2N at > 8 bits |
| 8 | **G0, the `VideoFrame` uploaded as is** (`texImage2D` with a `VideoFrame`) | 1 | `copyTo` and the pass both gone | **yes**, and the window needs ≥ 12 bits of a 10-bit frame scaled by 2^s. That a browser keeps those bits through its YUV upload is *unverified* | none | — |
| 9 | **F**, the digest fused into the add | 2 | ≤ the digest's re-read, 0.5 ns a sample (≤ 2 %) | no, but the codec returns the digest | unchanged | none |
| 10 | **The exact frame written over the preview's buffer** | 2 | the output's allocation and first touch | **yes**: a buffer handed on would be written again, a contract change | unchanged | −2N a frame |

Design 3's own pixel work is a `set()` and the digest, and the range is already in the pack. What is left there is F,
and the zero-copy hand-off that §The decoder worker's hand-off already declined as a contract change. **The best
non-structural candidate is #1**, because #2 and #3 already exist in the product. It is built behind `onePass`
(off by default).

**How the savings are derived.** #1: the range pass at 1.6–1.9 ns a sample, set against R + the add (RESIDAPART's RA − R)
+ range + digest. On `a1` that is 3.3–3.9 ms of 28.6; on `b1` 13.6–16.2 of 88; on `c1` 3.9–4.7 of 31.7; on
`mr_ispy1` 0.42–0.50 of 4.7. #2: 3N bytes × 0.38–0.59 ns over design 1's 10–52 ms. #4, #5 and #7 remove the add's
2.7–3.2 ns a sample (RESIDAPART's RA − R ÷ N). S keeps ~1.2–1.8 ns of memory traffic, P ~0.5, and lever G only the
upload. **Exploratory, Node 22.23**, synthetic frames at the four sizes, 15 rounds interleaved within one process, GC
forced before each call, 3 processes, ms a call: shown in JS 5.4–9.6 / 23.9–27.4 / 6.5–9.1 / 0.70–0.85 (`a1` / `b1` / `c1` / `mr`);
shown by S 1.6–2.3 / 9.7–10.9 / 1.8–2.6 / 0.17–0.19; the two-pass add 9.7–16.3 / 40.7–44.6 / 10.9–16.5 / 1.5–2.1;
the one-pass add 6.8–11.8 / 28.4–29.9 / 7.4–11.4 / 1.1–1.5; S's add 2.2–3.2 / 13.3–14.8 / 2.4–3.5 / 0.25–0.27.
Without the forced GC the same calls ran 2–4× slower in one process of two. The freshly allocated
`SharedArrayBuffer` is most of a call's variance there, and how Chromium charges it is *unverified*. None of these is a browser number.

**Built, and checked.** [`add.js`](add.js) has `shown()` (design 1's pass) and `exact()` (design 2's add, two passes, or
one under `onePass`). Each writes a fresh `SharedArrayBuffer` and returns its range. [`add.c`](add.c) and
[`add-simd.js`](add-simd.js) are S, built by [`add-build.sh`](add-build.sh) with the host's clang 18.1.3 (`--target=wasm32
-O3 -msimd128`, no libc). That is not the product's emscripten, so it is a lab arm and not a product build.
`node --test add.test.mjs` shows that both forms of `exact()` give back the source from a preview within ±3 of it and
its residual. It covers an offset and stride on the plane, 8- and 16-bit residuals, an odd width, s = 0–3 and a signed
13-bit series. It also covers that `shown()` is `(p << s) − offset`, that every call gets a buffer of its own, and the
refusals. `ADD_WASM=… node --test add-simd.test.mjs` shows S equals `add.js` sample for sample and in range. That holds
over tails, growing frames, 8- and 16-bit residuals, and a preview already in kernel memory.
**Mutated, each failing:** in `add.js`, the shift one short (each form, and `shown`), the stride ignored (each
function), the bias off by one, the one-pass min started at 0, the two-pass range taken over the residual, one buffer
reused across calls, and the length refusal dropped (10 of 10). In `add-simd.js`, the residual not copied, the plane's
offset dropped, memory never grown, the in-place test always true, and an 8-bit residual through the 16-bit kernel
(5 of 5). The kernel built with its shift one short (`add-build.sh`'s `broken/`) fails 3 of 4 (the refusals pass, as
they should).

### The protocol

Written 2026-11-04 for a separate session, which changes nothing below and reports every cell, including misses.
The question it decides: **does design 2's add take its range in the same pass (#1)**? It also gives the owner the
numbers for R on the preview and S in both designs, and stage times for "where it goes". The levers' structural reviews
stay with the owner.

**Fixtures and encodings.** `dbts_a1`, `dbts_b1` and `dbts_c1` at row 17's quality, CRF 20, as RESIDAPART encoded them.
`mr_ispy1` at its row-17 CRF, 8, is the small-frame control, where a per-frame fixed cost is the largest share. The
first 16 frames of each are timed, after one warm-up group. The commands, as §Residual apart, measured:

```bash
lab/av1/tools/tools.sh && client/decode/wasm/fetch_openjph.sh && lab/av1/fetch_data.sh
W=lab/.av1-work/pixel
for s in dbts_a1 dbts_b1 dbts_c1; do lab/av1/delivery/residual/encode.py lab/.av1-build $W/$s lab/av1/data/$s --crfs 20; done
lab/av1/delivery/residual/encode.py lab/.av1-build $W/mr_ispy1 lab/av1/data/mr_ispy1 --crfs 8
for s in dbts_a1 dbts_b1 dbts_c1 mr_ispy1; do lab/av1/.venv/bin/python lab/av1/delivery/residual/apart_truth.py lab/.av1-build $W/$s; done
lab/av1/delivery/residual/add-build.sh $W/simd                      # S, and its shift-one-short copy
ADD_WASM=$W/simd/add.wasm node --test lab/av1/delivery/residual/add.test.mjs lab/av1/delivery/residual/add-simd.test.mjs
```

The client's OpenJPH and XXH3 (`built("openjph")`, `hasher()`) must match `wasm/build/manifest.sha256`, as in RESIDAPART.

**Harness, written by the measuring session** as `pixel.mjs` (driver), `pixel.js` (worker), `pixel.html` and
`pixel-report.mjs`, beside `apart.*`, whose fetching, checking and order code it may copy. There is one worker per set,
and it runs every arm on the same frames. Each frame's preview group (8 units) is decoded once through WebCodecs, with
the client's configuration (`prefer-software`, `optimizeForLatency`, the codec string from the stream's header) and a
flush at the group's end. The 8 `VideoFrame`s stay open until every arm has run on them, then close. If a group gives
fewer than 8 frames within 2 s, the run is void and the report says so. Each frame then runs these arms, in a Williams
order (`lab/order.mjs`, index round × 16 + frame), each span its own:

| arm | design | span (`performance.now()`) |
| --- | --- | --- |
| **L** | 1 | `copyTo` into a fresh `ArrayBuffer(allocationSize())` → `shown()` returns |
| **LR** | 1 | as L, into one `ArrayBuffer` kept for the worker's life (R) |
| **LS** | 1 | `copyTo` into `add-simd.js`'s `target()` → its `shown()` returns, the frame copied out |
| **A2** | 2 | the residual codestream into OpenJPH → `exact(shownPlane, residual, f, false)` returns |
| **A1** | 2 | as A2, `onePass` true |
| **A1′** | 2 | A1 again, the A/A |
| **AS** | 2 | as A2, through `add-simd.js`'s `exact()` |
| **H** | 3 | `htj2k.js`'s `decodeFrame` on the whole frame: decode, pack and range, `set()` into its buffer |

The add's preview is L's shown buffer for that frame (shift 0, bias = the residual's offset). That buffer is the only
copy of the preview a lossy design keeps once it is shown (*derived*). Outside every span, each arm's output is hashed
with XXH3 (`hasher()`), timed as its own **digest** stage. The WebCodecs decode is also stamped (chunk handed in →
output callback, and the group's flush), as is OpenJPH's own call inside A2, A1, AS and H. These stamps are for "where
it goes" and decide nothing. A round's value for an arm is the median of its 16 frames.

**Order and throttles.** Each (throttle, round) gets a fresh headless Chromium, the version recorded in every row. The
four sets run in a Williams order inside it. 1× and 4× (`lab/scripts/cpu_throttle.mjs` `throttleTree`) alternate: after
every fourth 1× round comes a 4× round, until the 4× count is met. So a run cut short still has both throttles. One
worker runs at a time and one `VideoDecoder` exists at a time. `lab/av1/decode/merge-free/busy.sh` records the CPUs. The
order effect per cell is RESIDAPART's statistic, and a cell over 10 % is not read (§Residual apart, measured: the DBT
volumes).

**Rounds, from a cited spread.** σ of a round-paired log ratio is taken as merge-free's: 0.105 at 1× and 0.053 at 4×
(`docs/decode/README.md` §Merge-free protocol). Its arms were whole frames, so this σ is an upper planning value for
pixel spans. The effect is the median of rounds, standard error 1.2533 σ ÷ √n. For 80 % power for a 95 % interval to
exclude 1 at a true 0.97, n = 1.571 × (2.8016 σ ÷ ln(1 ÷ 0.97))² = 147 at 1× and 38 at 4× (*derived*, the same
arithmetic as there). Rounded up to the order's period (8 arms): **152 rounds at 1× and 40 at 4×**. The count is
fixed here and not revised from the run.

**Time budget** (*derived* from the tables above): a 1× round is ~25 s (17 frames × ~1 s of arms over the four sets, and
~6 s of launch and instantiation), so 152 rounds take ~65 min. A 4× round is ~80 s, so 40 take ~55 min. Tools, encodes
and truth take ~60–75 min, as RESIDAPART's did. That is ~3.2 h, inside 4.5. **If the run is cut**, the rule is applied
to the rounds it has, and each interval is marked short of n.

**Effect and interval.** Per cell and arm pair, each round's ln(arm ÷ reference) is paired inside one browser. The
effect is the median over rounds, as a ratio. The 95 % interval is the k-th and (n − k + 1)-th ordered values, k the
largest with P(Binomial(n, ½) ≤ k − 1) ≤ 0.025 (`rank`/`effect` in `lab/av1/decode/passes/report.mjs` on
`origin/claude/av1-unified-mainbase`; copy them). Pairs reported: A1 ÷ A2 (the decision), A1′ ÷ A1 (A/A), LR ÷ L,
LS ÷ LR, AS ÷ A1. Stage shares are reported as medians with their range over rounds.

**Exact.**

* Every A2, A1, A1′, AS and H frame's SHA-256 must match the checksum written when the series was fetched.
* Every frame's Y plane, taken densely from L's `copyTo`, must match native dav1d 1.5.4's preview (`apart_truth.py`).
* LR's and LS's shown buffers must equal L's byte for byte. All digests of one frame must be equal across the A arms
  and H.
* A miss voids that (set, throttle) cell. It is reported and not re-run quietly.
* Before the campaign, one round at 1× must show each of these:
  * `--mutate hash` gives 0 exact everywhere.
  * `--mutate offset` (bias + 1 in every A arm) gives the A arms 0/16 exact while H and the previews stay 16/16.
  * The kernel's `broken/add.wasm` gives AS 0/16 exact and LS 0/16 equal to L.
  * `--mutate reuse` (LR copies only on its first frame) gives LR 1/16 equal to L.

**Decision rule**, every frame exact. The lines are those the product's `onePass` and R were held to
(`docs/decode/README.md` §JS passes protocol and §Merge-free protocol). They are cited, not chosen here.

* **The A/A**: A1′ ÷ A1's interval contains 1. The run is void if 2 or more of the 8 cells miss (P ≈ 0.057 by chance,
  derived there).
* **#1 is the add a lossy design's product build takes** when A1 ÷ A2's interval lies entirely below 1.00, with a median
  ≤ 0.97, in each of the six DBT cells, and its upper end is ≤ 1.02 on `mr_ispy1` at both throttles. Otherwise
  two-pass stays, and the report names the cell.
* **R on the preview, for the owner**: the same line on LR ÷ L, beside its resident 3N bytes a stream.
* **S, for the owner**: proposed for building only if LS ÷ LR and AS ÷ A1 each lie entirely below 0.90 in every DBT
  cell, merge-free's measured form of "much more cheaply".
* **Predictions, each falsified by a DBT cell outside it:**
  * A1 ÷ A2: 0.83–0.92.
  * LR ÷ L: 0.65–0.90.
  * LS ÷ LR: 0.5–0.8.
  * AS ÷ A1: 0.78–0.90.
  * Pixel work after decode: design 1 40–65 % of its frame, design 2 30–40 %, design 3 4–8 % (stage stamps). Design
    1's share is (L + digest) ÷ (decode + L + digest). Design 2's is (A1 − its OpenJPH call + digest) ÷ (A1 + digest).
    Design 3's is (H − its OpenJPH call + digest) ÷ (H + digest).

**Host.** A 4-core cloud host. The report gives its CPU and L3 size (`lscpu`). On a 260 MiB L3 every input here stays
cache-resident, which a phone's cache does not, so nothing is claimed for a phone. It says where the host saturates
from `busy.sh` (the busiest second, and the share of seconds at ≥ 95 % of 4 CPUs). It claims nothing past one worker,
nor for fills, concurrency or another host. Each cell is quoted in ms a frame, latency only.

**Owed to a machine with a GPU: lever G.** SwiftShader is software, so lever G is not run on the cloud host. The
harness refuses the G arms when `UNMASKED_RENDERER_WEBGL` matches `/SwiftShader/i`, and records the renderer in every
row. On a machine with a hardware GPU:

* **G1** (design 1): L's `copyTo` plane uploaded as `R16UI` (`UNPACK_ROW_LENGTH` = stride), with `(p << s) − offset`
  in a `highp` window pass. The range is a per-frame table computed at coding time.
* **G2** (design 2): the shown preview's texture from G1 and the residual (`R16UI`, or `R8UI` at ≤ 8 bits), added in
  the shader.
* Every arm's span ends at a `fenceSync` after its window pass, waited with `clientWaitSync`. L and A1 then upload their
  buffers as the product's painter does.
* G2 is exact when a readback of an `R32UI` target matches the frame's SHA-256, outside the span. That
  `readPixels` reads one with `RGBA_INTEGER` is *unverified*, as in merge-free.
* The rounds and rule are the ones above, with G1 ÷ L and G2 ÷ A1 against 0.90.

```bash
NODE_PATH=$(npm root -g) node lab/av1/delivery/residual/pixel.mjs --frames lab/.av1-work/pixel \
  --sets dbts_a1,dbts_b1,dbts_c1,mr_ispy1 --arms L,G1,A1,G2 --gpu --throttles 1,4 --rounds 152,40 \
  --chromium-args=--enable-gpu,--ignore-gpu-blocklist,--use-angle=vulkan --out lab/av1/delivery/residual/rows/pixel-gpu.json
```

The cloud host's command is the same without `--gpu` and `--chromium-args`, with `--arms L,LR,LS,A2,A1,A1′,AS,H` and
`--out rows/pixel.json`. G0 (#8) gets no arm until a browser's upload precision for a 10-bit frame is read from its
source.
