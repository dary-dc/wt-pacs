# An 8-bit depth cut for the optimal-quality view

Row DEPTH8-THEORY, 2026-11-14. **Theory plus a pre-registered protocol; nothing was coded or timed.** §2–§4 are
arithmetic over rows the quality study already measured: the per-frame σ and the coded cells of the 19 DBT volumes in
`claude/av1-noise-ratio:lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl`. They are labelled *derived* (from definitions)
or *derived from the rows*. Facts about browsers are *sourced* and quoted. Facts measured before this row are
*measured* and name their row. noise-point.md, noise-ratio.md and the quality study's harness
(`claude/av1-noise-ratio:lab/av1/metrics`) are on that branch. §7 is the protocol DEPTH8-MEASURE runs. It informs
the codec question and decides nothing.

The arithmetic is `lab/av1/depth8/theory.py`. Its output, every number below, is `lab/av1/depth8/predictions.json`:

```
git show origin/claude/av1-noise-ratio:lab/av1/metrics/rows/shard-N.jsonl > ROWS/shard-N.jsonl   # N = 1…4
curl -s 'https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/common/quant_common.c?format=TEXT' | base64 -d > quant_common.c
python3 lab/av1/depth8/theory.py ROWS quant_common.c > lab/av1/depth8/predictions.json
```

## Verdict (theory)

* **The cut alone stays under the noise.** Cutting to 8 bits adds a rounding error of RMS 4.61 source units at
  12 bits and 1.12 at 10 bits. That is 0.31–0.44 of σ_min on the 12-bit volumes and 0.20–0.33 on the 10-bit ones.
  Every frame of every volume stays under e_N ≤ σ before any coding (§2).
* **It uses up part of the coding error's budget.** At 8 bits, the highest Q that keeps every frame at
  e_N ≤ σ is predicted at **Q 2–5 to Q 5–8 on 12-bit volumes** and **Q 4–10 to Q 7–13 on 10-bit volumes**.
  Today's form reaches Q 7–9 and Q 9–14 (§3.3). The two figures in each range come from two models of how the
  rounding and coding errors stack: independent errors, or a quantizer that removes the rounding together with the
  noise. The top-10 cells (a k = 2 cut that has been measured) cannot tell the models apart. A k = 4 cut can, and
  §7 measures it.
* **Its bytes depend on which model holds.** If the removal model holds, the 8-bit view costs 0.82–1.09 times
  today's view's bytes. If the independent model holds, it costs **1.37–2.44 times** as much, and 1.53–2.44 times on
  12-bit (§3.4). The bytes model itself reads 1–9 % low at k = 2 (§3.4).
* **At the readers' windows** the cut's step is 3.7–7.4 display levels on 12-bit and 2.0 on 10-bit at the header
  windows. Its rounding RMS is 1.1–2.1 and 0.56 levels. The noise σ_min is 2.8–6.9 levels and dithers the steps
  (§3.5). The noise criterion does not depend on the window. The display-level criterion fails here as it already
  fails at Q 8.
* **What 8 bits buys in the browser** (sourced, §4–§5):
  * **Desktop Chromium, one path:** an 8-bit 4:2:0 grey stream decodes in hardware, and its samples come back as
    `NV12` and reach the frame check. It is the only browser hardware path that keeps the check
    (`docs/decode/hardware.md` §18.1 at `b631179a` on `claude/hw-decode`).
  * **Android Chrome:** nothing is gained, because every MediaCodec frame comes back as RGB.
  * **Firefox:** WebCodecs becomes exact (software) on full-range 4:2:0 grey, measured on lossless 8-bit series.
  * **Safari:** a WebCodecs path exists only behind a preference that is off by default.
* **Not decided here:** whether an 8-bit view is acceptable. That is the owner's question, and visual losslessness
  is the readers'. On the codecs line, the owner's 2026-11-10 decision "no reduced-depth (8-bit) preview" stands.
  This file is the investigation the owner asked for on 2026-11-14.

## 1 · The question, and what binds it

The owner, 2026-11-14 (`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendment 14): "we could even consider
using only images up to 8 bits of depth in order to be able to use the hardware capabilities of the browser. But …
we won't give up until we have no other choice. So first is to investigate and test".

* **The bar** is the noise rule's anchor (a): e_N ≤ σ on every frame. Here σ is a frame's own noise in the 3 × 3
  Laplacian's band and e_N is the coding error in that band (`claude/av1-noise-ratio:lab/av1/metrics/README.md`
  §Terms, §4.4). The rule was tested on held-out volumes and is refuted above 1.03 (`claude/av1-noise-ratio:docs/av1/noise-point.md`
  §8, P1). Both bars are reported: 1.00 and 1.03. Which one counts is the owner's (codecs.md §Open 1).
* **The fixtures** are 19 DBT volumes: the quality study's 14 and the noise point's 5 held out.
  * The 12 at 12 bits are `dbts_a1`–`a5`, `dbts_c1`–`c5`, `dbt12_c` and `dbt12_ea1141`.
  * The 7 at 10 bits are `dbts_b1`–`b5`, `dbt10_d` and `dbt10_ea1141`.
  * σ_min is 10.5–14.8 at 12 bits and 3.4–5.6 at 10 bits.
  * There is no breast ultrasound cine and no ABUS. TRUS and MR are out of scope: the noise rule does not hold for
    them (noise-point.md §Verdict).
* **Today's form**, which every comparison here is against: the 10-bit depth cut for D 12 (`payload-format.md`
  §Depth cut), and the stored depth for D 10.

## 2 · The 8-bit cut, defined (*derived*)

The 10-bit cut's rule, with 8 bits in place of 10. A sample v of a D-bit series becomes the code

```
c = min((v + 2^(k−1)) >> k, 255)        k = D − 8
```

Code c stands for c · 2^k. **The rounding error** of integers rounded to multiples of 2^k is uniform over 2^k values.
Its RMS is √((4^k − 1)/12): 4.61 at k = 4 (D 12) and 1.12 at k = 2 (D 10). Its largest value is 2^(k−1), except at
the clamp, as for the 10-bit cut. The error is white and independent of the signal once the noise is not far below
one step. The quality study derived this and checked it from σ 0.25 steps up (`claude/av1-noise-ratio:lab/av1/metrics/README.md`
§4.4, *rounding taken out*). Here σ_min ÷ 2^k is at least 0.66 at D 12 and 0.84 at D 10. The Laplacian ÷ 6 keeps white
noise's σ (README §Terms), so the cut adds exactly that RMS to e_N.

| | D 12 | D 10 |
| --- | --- | --- |
| rounding RMS, source units | 4.61 | 1.12 |
| ÷ σ_min, by volume | 0.31 (`dbts_c4`) – 0.44 (`dbts_a1`) | 0.20 (`dbts_b3`, `b4`) – 0.33 (`dbts_b2`) |
| today's form's rounding | 1.12 (the 10-bit cut), 0.08–0.11 of σ_min | none |

**The finest lossy step is coarse.** libaom's 8-bit AC table starts "4, 8, 9, 10, 11, 12" (*sourced*,
`av1/common/quant_common.c` `ac_qlookup_QTX` at v3.15.1). With qindex 4Q and the factor 8 (noise-point.md §2), the
step at Q 1 is 1.375 codes. At D 12 that is 22 source units, between the 12-bit stream's steps at Q 2 (9.4) and Q 4
(22.9). So the 8-bit stream's ladder starts where the 12-bit stream's is already a third of the way to Q 8 (57).

## 3 · Quality from the noise numbers (*derived from the rows*)

### 3.1 The curve

The quality study's curve h(x) is e_N ÷ σ against x = Δ ÷ σ. Here it is rebuilt from the stored-form cells only:
the 14 volumes that have them, every frame, log-spaced bins, medians.

| x | 0.85 | 1.07 | 1.67 | 2.60 | 3.25 | 4.07 | 5.08 | 6.36 | ≥ 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h, G 1 | 0.24 | 0.30 | 0.47 | 0.76 | 0.89 | 0.95 | 0.99 | 1.04 | 1.04–1.07 (one sparse bin at x 92: 1.22) |

**Checked against the held-out arms.** The held-out volumes' measured arms (noise-point.md §Held-out arms) took no
part in building h. With k = 0, the model's worst frame per arm at G 1 is within −0.02 to +0.02 of the measured
value on `dbts_a3`, `a4`, `a5` and `b4`, and 0.05 above it on `dbt10_d`. Its highest Q under 1.00 is one rung high
on `dbts_a3`, `a5` and `b4`, and agrees on `a4`. On `dbt10_d` it is two or more rungs low: the model reads 10 and
the measured value is at least 12. The model is therefore good to about a rung, in both directions.

### 3.2 How the two errors stack

The codes carry noise σ_c = √(σ² + r²) in source units, where r is the rounding RMS. The encoder codes the codes at
x = Δ₈ · 2^k ÷ σ_c, and its error against the codes is h(x) · σ_c. The error against the source is that error plus
the cut's. Two models bound how they add:

* **Independent:** e² = r² + (h · σ_c)². This is right while the quantizer adds noise of its own, at low x.
* **Removal:** the quantizer removes a share h of the codes' noise, both the source's noise and the rounding, so
  e² = ((1 − h) · r)² + (h · σ)². This is right as the quantizer zeroes the fine band (noise-ratio.md §2.3:
  "at the anchor the quantizer removes noise").

**Checked against the top-10 cells**, the study's measured k = 2 cut (`top10`, v ≫ 2 at 10 bits, 12-bit volumes,
574 frames per Q). Both models predict the measured median within 0.02 at every Q from 1 to 24, at G 1 and G 16.
At Q 8 the measured median is 0.976, against 0.974 for the independent model and 0.968 for removal. At Q 4 it is
0.569, against 0.554 and 0.547. With r ÷ σ ≈ 0.08 the two models differ by under 0.01, so these cells cannot tell
them apart. At k = 4, with r ÷ σ of 0.31–0.44, the models differ by three to four rungs (§3.3). That difference is the
measurement's first question (§7, P2).

### 3.3 The highest Q per volume

The highest Q at which every frame's predicted e_N ÷ σ is at most the bar. The model uses the median curve, so a
frame's spread around h (about ±0.03, §3.1) is not in it.

| volume | D | σ_min – max | cut ÷ σ_min | 8-bit Q, bar 1.00: indep. · removal | today | bar 1.03: indep. · removal | today |
| --- | --: | --- | --: | --- | --: | --- | --: |
| `dbt12_c` | 12 | 13.36–16.40 | 0.35 | 4 · 7 | 8 | 4 · 8 | 9 |
| `dbt12_ea1141` | 12 | 10.99–11.99 | 0.42 | 2 · 6 | 7 | 2 · 7 | 8 |
| `dbts_a1` | 12 | 10.48–12.31 | 0.44 | 2 · 5 | 7 | 2 · 6 | 7 |
| `dbts_a2` | 12 | 10.77–14.34 | 0.43 | 2 · 6 | 7 | 2 · 7 | 8 |
| `dbts_a3` | 12 | 12.76–14.17 | 0.36 | 3 · 7 | 8 | 4 · 8 | 9 |
| `dbts_a4` | 12 | 13.16–15.38 | 0.35 | 3 · 7 | 8 | 4 · 8 | 9 |
| `dbts_a5` | 12 | 10.91–12.82 | 0.42 | 2 · 6 | 7 | 2 · 7 | 8 |
| `dbts_c1` | 12 | 12.04–14.84 | 0.38 | 3 · 6 | 8 | 3 · 7 | 9 |
| `dbts_c2` | 12 | 14.02–15.58 | 0.33 | 4 · 8 | 9 | 5 · 9 | 10 |
| `dbts_c3` | 12 | 13.50–16.47 | 0.34 | 4 · 7 | 8 | 4 · 9 | 10 |
| `dbts_c4` | 12 | 14.84–17.93 | 0.31 | 5 · 8 | 9 | 5 · 9 | 10 |
| `dbts_c5` | 12 | 12.15–15.12 | 0.38 | 3 · 6 | 8 | 3 · 8 | 9 |
| `dbt10_d` | 10 | 3.89–3.92 | 0.29 | 5 · 8 | 10 | 6 · 10 | 11 |
| `dbt10_ea1141` | 10 | 4.12–4.14 | 0.27 | 6 · 9 | 10 | 7 · 11 | 12 |
| `dbts_b1` | 10 | 5.26–5.67 | 0.21 | 9 · 12 | 13 | 11 · 14 | 15 |
| `dbts_b2` | 10 | 3.36–3.40 | 0.33 | 4 · 7 | 9 | 4 · 8 | 10 |
| `dbts_b3` | 10 | 5.55–5.63 | 0.20 | 10 · 13 | 14 | 12 · 15 | 16 |
| `dbts_b4` | 10 | 5.56–5.72 | 0.20 | 10 · 13 | 14 | 12 · 15 | 16 |
| `dbts_b5` | 10 | 3.63–3.67 | 0.31 | 4 · 8 | 9 | 5 · 9 | 10 |

G 1 is shown. G 16 is the same at bar 1.00, except two cells: today's form gains one rung on `dbts_c3` (9), and the
removal model gains one on `dbt10_d` (9).
"Today" is the same model applied to today's form, so a bias the model has falls on both sides alike.

### 3.4 Bytes

On the noise point's argument (§2 there), bytes depend on x. Each volume's own stored-form cells give its
bytes ÷ HTJ2K against x. The 8-bit view is read off that curve at its own x, at the Q of §3.3. Volumes held out
have no cells and get no bytes prediction.

| volume | today, bytes ÷ HTJ2K | 8-bit, independent Q | 8-bit, removal Q | 8-bit ÷ today |
| --- | --: | --: | --: | --- |
| `dbt12_c` | 0.095 | 0.146 | 0.079 | 0.83–1.53 |
| `dbt12_ea1141` | 0.107 | 0.228 | 0.095 | 0.89–2.12 |
| `dbts_a1` | 0.084 | 0.204 | 0.089 | 1.07–2.44 |
| `dbts_a2` | 0.099 | 0.217 | 0.086 | 0.87–2.18 |
| `dbts_c1` | 0.083 | 0.167 | 0.091 | 1.09–2.01 |
| `dbts_c2` | 0.073 | 0.150 | 0.064 | 0.87–2.04 |
| `dbts_c3` | 0.097 | 0.148 | 0.079 | 0.82–1.53 |
| `dbts_c4` | 0.084 | 0.137 | 0.073 | 0.87–1.63 |
| `dbts_c5` | 0.084 | 0.168 | 0.091 | 1.09–2.01 |
| `dbt10_ea1141` | 0.161 | 0.220 | 0.152 | 0.95–1.37 |
| `dbts_b1` | 0.084 | 0.129 | 0.082 | 0.98–1.53 |
| `dbts_b2` | 0.121 | 0.221 | 0.132 | 1.08–1.82 |
| `dbts_b3` | 0.087 | 0.131 | 0.086 | 1.00–1.51 |
| `dbts_b5` | 0.119 | 0.200 | 0.109 | 0.92–1.68 |

**The bytes model, checked on the top-10 cells:** it predicts 0.91–0.99 of the measured bytes at Q ≤ 8 and 0.76–0.90
at Q 12–24, so it reads low. That holds at k = 2 only. Its error at k = 4 is not known. The 4:2:0 form's constant
chroma is not in these numbers. Lossless, it costs +0.20–0.23 %, ≈ 100–140 B a frame (*measured*, row GREY420,
`payload-format.md` §8-bit grey as 4:2:0). On the lossy view it is not measured (§7, P5).

### 3.5 At the windows readers use

On `LINEAR_EXACT`, a window of width w maps x to "y = ((x - c) / w + 0.5) * (ymax- ymin) + ymin" (*sourced*, DICOM
PS3.3 2026d C.11.2.1.3.2). One of 256 display levels is therefore w ÷ 255 source units. SIGMOID has the same slope
at its centre (*derived* from Equation C.11-1, which the standard prints as an image). At the header windows
(`windows` in the series rows):

| | header widths | cut step, levels | cut RMS, levels | σ_min, levels | today's step, levels |
| --- | --- | --- | --- | --- | --- |
| 12-bit volumes | 550–1093 | 3.7–7.4 | 1.08–2.14 | 2.8–6.9 | 0.93–1.85 (the 10-bit cut) |
| 10-bit volumes | 512 | 2.0 | 0.56 | 1.7–2.8 | — |

* **The noise criterion does not depend on the window.** A window scales the rounding, the coding error and σ
  alike (`claude/av1-window-q:docs/av1/window-q.md`), so §3.3 holds at every width.
* **No contouring is predicted.** The full-band noise is at least σ_min, which is 0.66 or more of a step, so it
  dithers the steps (§2). A region smoother than the volume's σ_min would show the steps: none of the 19 volumes has
  one by σ, and the protocol looks for it (§7, P6).
* **The display-level criterion fails, as it already does.** "No Q keeps every displayed level within 1" holds on
  the study's rows at Q 8 (codecs.md §State now). At 8 bits the cut alone moves a level whenever w < 255 · 2^k:
  below 4080 at D 12 and below 1020 at D 10, which is every header window. Narrower windows scale the levels up by
  the same factor.

## 4 · The form hardware takes: 8-bit 4:2:0 grey (*sourced*)

The client already reads 4:2:0 grey with constant mid-grey chroma (`ingest.py --grey8 420`, the `g8f` probe). It was
not adopted on Chromium's software cost alone (`payload-format.md` §8-bit grey as 4:2:0). Its re-judgement for
hardware is HW-DECODE-DEEP-REVIEW's (`docs/decode/hardware.md` §18.4 at `b631179a` on `claude/hw-decode`): "the
browser's only checkable hardware form, 8-bit, desktop Chromium, unmeasured on hardware". The steps, each quoted
there with its pinned source:

* **The format exists in the spec.** WebCodecs lists `NV12`: "Each sample in this format is 8 bits" (W3C WebCodecs,
  Working Draft 9 November 2026, §VideoPixelFormat, fetched for this row). It has no 10-bit two-plane format: "`P010`:
  not in WebCodecs, not in Chromium's list" (hardware.md §12).
* **Desktop Chromium reads it back.** "desktop Chromium, 8-bit 4:2:0 (GREY420) | `copyTo()` with no `format` on an
  `NV12` frame: a plane copy … | **yes**, after a GPU read-back; 8 bits only" (hardware.md §18.1). 4:0:0 is refused
  first: "Only YUV 4:2:0 and YUV 4:4:4 are supported" (§12, Chromium 157 `media/gpu/av1_decoder.cc:335–338`).
* **WebGPU paints it without a copy.** "zero copy only for `NV12`, as `R8Unorm` and `RG8Unorm` planes" (§13,
  `external_texture_helper.cc:279–308` at 157). For an 8-bit view that is full precision. Today's 10-bit view is
  drawn there at 8 bits: "High bit depth formats should also use F16, but do not yet." (§13, `:401`).
* **Android Chrome gains nothing.** "we need to use the pixel format as ABGR here(which corresponds to 32bpp RGBA)"
  (§12, Chromium 157 `video_frame_factory_impl.cc:150–157`). The frame comes back `BGRX`, converted by the device,
  and is unchecked at any depth (§18.1). Whether the Galaxy S23 decodes AV1 in hardware at all "is not settled by its
  vendor's own brief" (§15).
* **Native** gets the planes at 8 or 10 bits (§15, §18.4). An 8-bit view buys native nothing it lacks at 10.

So 8 bits buys a checked hardware view on **desktop Chromium only**, in the 4:2:0 form, and only once a desktop GPU
shows it exact and faster than software. That has never been measured: it is owed to the owner's machine
(codecs.md §Open 4).

## 5 · Firefox and Safari at 8 bits (*sourced*, *measured* where marked)

* **Firefox.** Its WebCodecs hands the page RGB: "every frame reaches the page as 8-bit `BGRX`". It refuses 4:0:0,
  and "At 8 bits only GBR and full-range 4:2:0 grey survive the RGB conversion (M, row XENGINE)" (hardware.md §4.2;
  `payload-format.md` §8-bit grey as 4:2:0). An 8-bit 4:2:0 view is exact through Firefox's WebCodecs. Today's
  10-bit view reaches Firefox through dav1d-WASM, because 8-bit `BGRX` cannot carry it. On the two lossless 8-bit
  series, moving from dav1d-WASM to WebCodecs took a frame's decode to 0.63–0.66× at 4× and 1.03–1.04× at 1×
  (*measured*, row GREY420). On the lossy DBT view it is not measured. Whether a hardware decoder sits behind Firefox's
  WebCodecs changes nothing: its frames are remote and come back `BGRX` (§4.2, Gecko `c72617c0`). Whether
  such a conversion stays exact on a GPU is not known (§7 leaves it to a device).
* **Safari.** WebCodecs AV1 is "behind `WebCodecsAV1Enabled`, off by default on Cocoa, and is libwebrtc's dav1d in
  software, refusing anything but 8-bit 4:2:0", unchanged at WebKit `b4291f79`: "`status: preview`" (hardware.md
  §4.3). 8-bit 4:2:0 is therefore the only form Safari's WebCodecs would take, in software, and only for a reader who
  turned the preference on. Hardware AV1 is `<video>` only, with "no planes" (§18.1), so it is never a checked path.
  By default Safari decodes the view through dav1d-WASM at either depth.

## 6 · What an 8-bit view would change (not built; for the owner's call)

* **Contract.** `lossy.depth` 8 with `bitsStored` D marks the cut, as the 10-bit cut does (`payload-format.md`
  §Depth cut). The payload is `bits` 8, `depth` 8, split 0. The 4:2:0 form needs no field, because the stream's
  sequence header says it.
* **Paint.** The window table's entry c is the window function at c · 2^(D−8), the 10-bit cut's rule with 8 in place
  of 10. The table test (`client/paint/voi.test.mjs`) gains D 10 and 12 at 8.
* **Decisions it reopens.** "D ≤ 10 at its own depth, the depth cut only for D > 10" and "no reduced-depth (8-bit)
  preview" (codecs.md §Decisions, 2026-11-10). The 10-bit volumes would be cut too.
* **Decoder choice.** `prefer-hardware` would mean something only for this form on desktop (§4). Today's
  `prefer-software` and its reason are hardware.md §18.3's.

## 7 · Protocol for DEPTH8-MEASURE (pre-registered 2026-11-14)

A session that wrote none of this file runs it as written. If the host forces a change, an amendment goes here
before any run.

**Setup.**
* Pin and record the commit of the quality study's harness, `claude/av1-noise-ratio:lab/av1/metrics` (or what
  carries it), and of this file.
* libaom 3.15.1 `aomenc` with the study's lossy settings (`payload-format.md` §Optimal quality's line), and
  `--profile=0 --bit-depth=8 --input-bit-depth=8`.
* The volumes from `lab/av1/fetch_data.sh`, checked by their `framesSha256`.
* A 4-core cloud host, one encoder thread a process, at most 4 processes.

**Forms to add** to `cell.py`'s `forms`, each with a failing test first (the mutants below):
* `cut8` is the codes of §2, 8-bit 4:0:0 (`--monochrome`).
* `cut8-420` is the same codes as 4:2:0 with every chroma sample 128, without `--monochrome`.
* `cut10` is today's 10-bit cut, rounded as `payload-format.md` §Depth cut writes it, unlike `top10`'s truncation.
  It is used for D 12 only.
* Every measure is taken at the source depth on c · 2^k, as the study does for `top10`.

**Arms.** Arms are interleaved in a fixed order: per volume, the Qs ascending, each Q's forms in the order `cut8`,
today's form, `cut8-420`.

* **Stage A, G 1.** Six volumes: `dbts_a1`, `dbts_b1`, `dbts_c1` (the timed fixtures), `dbt12_ea1141` (the study's
  pilot, cut ÷ σ_min 0.42), `dbts_b2` (the largest at 10 bits) and `dbts_c4` (the smallest at 12).
  * `cut8` at every Q from §3.3's independent Q to its removal Q + 1.
  * `cut8-420` at the independent and the removal Q.
  * Today's form (`cut10`, or the stored 10-bit form) at its §3.3 Q and Q + 1.
  * A **cut-only** row per volume: the codes uncoded, measured as a cell.
  * About 60 cells. The study's cells took 3–5 min each on such a host (`cell_wall` in the rows), so about 4–5 h.
    Write the Resume before the run, and push the rows per cell.
* **Stage B, G 16.** The same six volumes, with `cut8` at Stage A's highest passing Q and the next Q, and today's
  form at its own. 18 cells.
* **Stage C, if the window allows.** The other 13 volumes, with `cut8` and today's form at Stage A's rule applied to
  them. The 5 held-out volumes, which have no study cells, come first.

**Predictions** (each cell against its prediction, misses included):

* **P1 · the cut alone.** The cut-only row's e_N ÷ σ is r ÷ σ per frame within 3 %: §2's 0.31–0.44 and 0.20–0.33.
  Its mean error is under 0.5 source units.
* **P2 · the stacking.** At each Q, the worst frame's e_N ÷ σ lies between the removal and the independent
  predictions, ±0.03 (the curve's spread). The report names the closer model per volume and says whether it is the
  same on all six. A cell outside the band refutes both models for that volume.
* **P3 · the highest Q.** The highest Q with every frame ≤ 1.00 lies in §3.3's interval, for both bars.
* **P4 · bytes.** `cut8` ÷ today's form, each at its own highest Q under 1.00, lies in §3.4's interval widened 10 %
  downward for the bytes model's bias.
* **P5 · the 4:2:0 cost.** `cut8-420` against `cut8` at equal Q: e_N ÷ σ within 0.01 on every frame and bytes
  +0.1–2 %. The chroma decodes to 128 everywhere (the client's neutral-chroma check, `av1-webcodecs.js`).
* **P6 · displayed levels**, reported with no verdict: the first window's share of pixels moved ≥ 1 and ≥ 2 levels,
  `cut8` against today's form at the same e_N ÷ σ. The largest move is reported with its region's σ.

**The rule.** A volume's 8-bit view *meets the noise rule* at a bar when some Q keeps every frame's e_N ÷ σ at or
under that bar. Its cost is its bytes ÷ today's form's bytes, each at its highest such Q, from the same run. The run
reports both per volume and per stage. It decides no adoption.

**Mutants**, each run once and seen to fail:
* (m1) truncation in place of rounding: P1's mean-error check fails, at 7.5 against 0.5.
* (m2) k one too small: P1 fails at half the RMS.
* (m3) chroma 127 in `cut8-420`: the neutral-chroma check fails.
* (m4) measuring c in place of c · 2^k: P1 fails by orders of magnitude.
* (m5) the 10-bit AC table on an 8-bit stream in §3.3's predictions: they move by three or more rungs.

**Saturation.** Every measure but wall time is deterministic at one encoder thread, so the host's load changes no
result. No time is claimed. Each cell records its wall time, and the report says whether 4 processes saturated the
host's 4 cores (`/proc/stat`).

**Not in this protocol:**
* the hardware decode of `cut8-420` (exactness through `NV12`, its time against software), owed to a desktop GPU
  (§4) and to HW-DECODE-DEEP's device probe on the phone (hardware.md §17);
* Firefox's WebCodecs on the lossy view;
* readers.

### Amendment, before any run (DEPTH8-MEASURE, 2026-11-14)

Written by the measuring session, which wrote none of the above, before any cell ran. What the host and the harness
forced:

* **A1 · Where the forms live.** `claude/depth8` does not carry the harness. `lab/av1/depth8/measure.py` loads it from
  a checkout of `claude/av1-noise-ratio` at `0a9d33ca` and adds `cut8` and `cut8-420` to its `forms`; no harness file
  is copied or changed. Every row records the harness commit.
* **A2 · `cut10` is `top10`.** At `0a9d33ca`, `top10` is `min((v + 2^(k−1)) >> k, 1023)` (`lab/av1/profiles/bytes.py`
  `forms`, unchanged since `f4ff5da0`): the depth cut of `payload-format.md`, rounded. "`top10`'s truncation" above
  (and "v ≫ 2" in §3.2) is wrong. `top10` stands as `cut10`, its identity with the depth cut shown by a test over
  every 12-bit value; the top-10 cells of §3.2 are cells of the rounded cut.
* **A3 · Bracketing.** P3 needs a failing Q above the highest passing one. `cut8` and today's form gain the next Q
  until their highest tested Q fails 1.03, and the Q below while their lowest fails 1.00 (never under Q 1). The
  starting Qs are §7's, `cut8`'s top taken from the wider of the two bars' removal Q.
* **A4 · `cut8-420`'s arguments.** The harness's non-monochrome branch tags RGB series' colour (`bt601`); `cut8-420`
  replaces it with `--profile=0 --bit-depth=8 --input-bit-depth=8`, as this protocol's setup writes.
* **A5 · The decoder's library.** `dav1d` 1.5.4 at its pinned commit is built, but this host's system `libdav1d`
  1.4.1 loads first; every run sets `LD_LIBRARY_PATH` to the build's.
* **A6 · P1's mean.** Rounding half up over uniform residues has a mean error of exactly +0.5 (errors
  −(2^(k−1) − 1) … 2^(k−1)), so "under 0.5" sits on its own expectation. The prediction is kept as written and read
  against 0.5; noted here so a miss by a hundredth is not read as a fault of the cut.

## 8 · Fixtures and limits

The results here rest on the following:
* 19 DBT volumes of three systems: σ_min 10.5–14.8 at 12 bits, 3.4–5.6 at 10 bits.
* One encoder: libaom 3.15.1, at the study's settings.
* σ from one estimator (Immerkær's, in the Laplacian's band), with the study's in-window rule.
* One curve: the median over 14 volumes.
* Two bounding models, checked only at k = 2.
* A bytes model checked only at k = 2.

The following are out of scope:
* no ultrasound cine, ABUS, TRUS or MR;
* no reader;
* no hardware decoder;
* no browser run.

**What would change it:** P2 placing k = 4 outside both models; a desktop GPU showing `NV12` not exact, or not faster
than software; readers finding the cut's steps visible at their windows.

## 9 · Results (DEPTH8-MEASURE, 2026-11-15, *measured*)

§7 run as amended, by a session that wrote none of §1–§8: Stages A (G 1, 78 cells and 6 cut-only rows) and B (G 16,
18 cells); **Stage C not run**. Rows: `lab/av1/depth8/rows/stage-{a,b}.jsonl`, harness `claude/av1-noise-ratio` at
`0a9d33ca` in every row; every cell against its prediction in `lab/av1/depth8/rows/report.md`
(`report.py`, which reruns from the rows). `predictions.json` was reproduced byte for byte before the run.

* **P1 · the cut alone: 5 of 6 hit.** e_N is r within 0.2–1.4 % on five volumes. On `dbts_b2`, the 10-bit volume
  with the least noise (σ_min ÷ 2^k = 0.84), e_N reads 1.056 against r = 1.118, 5.8 % under: a **miss**, on the
  low side. The mean error is 0.18–0.36, under 0.5 on all six (A6).
* **P2 · the stacking: 38 of 38 cut8 cells inside the band.** Every worst frame lies between the removal and the
  independent predictions. Neither model holds alone: the removal model is the closer on `dbt12_ea1141` (7 of 7) and
  `dbts_b2` (6 of 6), mostly on `dbts_a1` (5 of 6); the independent model on `dbts_b1` (6 of 7) and `dbts_c4`
  (4 of 6); `dbts_c1` splits 3–3. The model that fits is the volume's, not the depth's.
* **P3 · the highest Q: 12 of 12 hit**, at the low end of each interval. At bar 1.00, `cut8` reaches Q 3 (`dbts_a1`),
  9 (`b1`), 4 (`c1`), 4 (`dbt12_ea1141`), 5 (`b2`), 6 (`c4`); at 1.03, Q 4, 11, 5, 4, 7, 7. Today's form reaches
  Q 7, 12, 7, 8, 10, 9 at 1.00, within a rung of §3.3 on all six, as §3.1 said of the model.
* **P4 · bytes: 5 of 6 hit.** `cut8` ÷ today's form, each at its highest Q under 1.00: **1.31–1.86**
  (`a1` 1.86, `b1` 1.32, `c1` 1.33, `dbt12_ea1141` 1.69, `b2` 1.85, `c4` 1.31). `dbts_b2` misses, 1.85 against
  0.98–1.82. The removal end of §3.4 (0.82–1.09) did not occur on any volume: **the 8-bit view costs a third to
  nearly twice today's bytes**.
* **P5 · the 4:2:0 cost: 2 of 12 hit**, every miss on the cheap side. e_N ÷ σ differs from `cut8`'s by 0.0012–0.0047
  (≤ 0.01: holds), every decoded chroma sample is 128 (holds), but the bytes cost **+0.01–0.12 %**, under the
  predicted +0.1–2 % on 10 cells.
* **P6 · displayed levels (no verdict).** At the first window, each form at its highest Q under 1.00 (worst e_N ÷ σ
  0.95–1.00 on both): `cut8` moves 78–90 % of pixels ≥ 1 level and 45–73 % ≥ 2, today's form 80–91 % and 48–75 %;
  the largest move is 17–42 levels against 22–51. The harness records no region σ; the frame's σ is reported beside
  the largest move (`report.md`).
* **Stage B · G 16.** `cut8` meets 1.00 at the same Q as at G 1 on five volumes. `dbt12_ea1141` fails at its G 1 Q
  (1.0007 at Q 4) and no lower Q was in the stage; `dbts_b1`'s today's form fails at its G 1 Q (1.0004 at Q 12).
  G 16's worst frame is −0.003 to +0.021 from G 1's at the same Q. Bytes at G 16, where both pass: 1.31–2.02 × today's.
* **Mutants.** m1–m4 each fail `measure_test.py` (and m3's counter, mutated to 127, fails the chroma test). m5 (the
  10-bit AC table on the 8-bit stream) moves every volume's removal Q down 3–9 rungs, a hit; the independent Q moves
  1–7, under 3 on 8 of 19 volumes because Q 1 is the floor, a **miss** of its wording, not of its detection
  (`rows/m5.txt`).
* **The rule.** All six volumes' 8-bit views *meet the noise rule* at both bars at G 1, at the Qs above; their cost is
  P4's 1.31–1.86 × today's bytes.
* **Saturation.** Four processes kept the host's 4 cores busy (median busy share 1.00 a minute, `/proc/stat` in
  `rows/stage-*.cpu.txt`). No time is claimed; cells took 12–338 s wall each.

Fixtures and limits: six DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`, `dbt12_ea1141`, `dbts_b2`, `dbts_c4`) of three
systems, the 13 others not run; libaom 3.15.1 at cpu6 and one thread, dav1d 1.5.4; one σ estimator in one band;
G 1 and G 16; one 4-core cloud host with no GPU; no browser, hardware decoder or reader. What it settles: on these
volumes the 8-bit view meets the noise rule at Q 3–9 and costs 1.31–1.86 times today's bytes; that it buys a
checked hardware path on desktop Chromium is still unmeasured (§4).
