# metrics — what quality each lossy AV1 profile delivers, measured from data

## Quality metrics protocol, pre-registered

*Row METRICS, written 2026-11-04 before any shard ran. Theory and protocol only; the one series coded here is the
pilot of §8, which sizes the shards and is not a result. Four separate sessions run §Shards, one shard each, change
nothing above §Shards, and report every cell including those that miss.*

1. **Asked:** what picture quality each lossy AV1 rung (Q, G) actually gives, so that a scrolling view and a visually
   lossless view can be chosen from data rather than from an invented bar.
2. **Answer, as a protocol:** per series × Q × G, frame by frame, the coding error against the frame's own noise, the
   displayed grey levels it moves under the series' own windows, its size against the step between neighbouring
   slices, PSNR, SSIM, MS-SSIM, the compression ratio and a visibility model's score; the anchors and knees are read
   off those curves, not set in advance.
3. **The numbers that decide it** come from the four shards (§Shards, 3.3 h each); the pilot on one small DBT volume
   (§8) shows the readings exist and agree: every pixel metric bends at Q 8, the last rung before the coding error
   reaches the frame's noise in the noise band; no rung, not even Q 1, keeps every displayed level within 1; and the
   preview's error stays under the step between neighbouring slices up to Q 16.
4. **It rests on** the 15 DBT volumes of system A, B and C, the seven sound sets of content 2, the two TRUS sweeps,
   and three lossy-sourced cine sets reported apart; on libaom 3.15.1 at cpu6 and dav1d 1.5.4; on a noise estimator
   tested here on integer frames of known σ from 0.25 to 16; and on one display model for the visibility score.
5. **Left open:** breast ultrasound cine and ABUS (no dataset yet); the three largest DBT volumes and G = whole
   (they do not fit 4 × 4.5 h); whether any rung is visually lossless to a reader, which §6's flicker test can
   confirm and no metric can.

### Terms

* **Q** — the lossy quantizer, libaom's 0–63 scale (`--cq-level`, held by `--min-q = --max-q`): 2 is near-lossless, 56
  heavy ([`../profiles`](../profiles/README.md) §Names). **Ladder**: Q 1, 2, 4, 8, 12, 16, 24, 32, 40, 56.
* **G** — frames coded together, a keyframe every G frames; G = 1 codes each frame alone.
* **Form** — how a 12-bit series reaches the encoder ([`../profiles`](../profiles/README.md) §4): the **12-bit
  stream**, the **top 10 bits** (p = min((v + 2) ≫ 2, 1023)), or the **window** (the first header window mapped to
  0 … 1023). Every other series has one form, its stored depth.
* **Systems A, B, C** — the three DBT scanners of the EA1141 dataset: A and C 12-bit, B 10-bit.
* **b, peak** — the series' depth after its offset, and 2^b − 1. Every lossy frame is brought back to b first.
* **Residual** — exact − lossy, per sample; **e** — its RMS over the in-window samples of a frame.
* **In-window** — samples whose code under the series' first header window is strictly between 0 and 255.
* **σ** — a frame's own noise, §4.4. **Noise band** — what the 3 × 3 Laplacian difference of §4.4 passes; **e_N** —
  the residual's RMS in that band (the Laplacian output ÷ 6, which keeps white noise's σ).
* **Displayed level** — the 8-bit code a sample gets through a window as the product paints it
  ([`../profiles/voi.py`](../profiles/voi.py), PS3.3 C.11.2.1.2.1); a series without a window shows its samples.
* **Step** — the RMS difference between a frame and its neighbouring slice, in-window; **band** — a difference seen
  as 4 × 4 means (§4.5).
* **JOD** — ColorVideoVDP's quality unit, 10 = no visible difference (§4.6).

### 1 · What is asked, and what binds it

The owner, 2026-11-04: use PSNR, SSIM and others to find what a scrolling view and a visually lossless or high-quality
view need, "not a synthetic hard rule or bar … it should be based on real data". What frames the answer:

* **No threshold exists to adopt.** No source read gives a visually lossless threshold for AV1 or any video codec on
  10–12-bit DBT, or for scrolling (`docs/av1/visually-lossless.md` on
  `claude/av1-visually-lossless` at 95357d834, §2–3). The guidelines' numbers are compression ratios tested on 2D JPEG and JPEG
  2000. So every decision rule below is derived from the series' own data (its noise, its neighbouring slice, its
  windows) or from a cited source, and says which.
* **MQSA binds FFDM and DBT interpretation in the US** (same file, §1: "Mammographic images with lossy compression must
  not be reviewed for primary image interpretations."). A lossy DBT stream can be a scrolling or a non-interpreting
  view there, never the interpreted frame; this protocol measures, it does not license.
* **Lossy layers move displayed levels widely**: in the scalable preview, "30–66 % of pixels move by at least one
  display level in every layer" (`lab/av1/delivery/scalable/tool/svc-results.md` on `claude/av1-svc-preview` at ee572f708, headline
  3). Whether that is visible, and against what, is the question.
* **The bytes run** ([`../profiles`](../profiles/README.md) §Profiles bytes, measured) coded Q 2, 8, 16, 32, 56 at
  G 1, 8, 16, whole: G = 16 gains +29 to +61 % at each series' crossover rung and +75 to +86 % at Q 56; the bend in
  bytes against PSNR sits at Q 16 on system B and Q 32 on A and C. Its σ comes in 0.741 steps on integer data and fits
  to 10 % only from about σ 4 up, which leaves system B at its edge and every ultrasound set (σ 0.74–1.48, `usb_cine`
  0.00) without a usable noise anchor. §4.4 replaces it.

### 2 · Fixtures

Every sound set of [`docs/FIXTURES.md`](../../../docs/FIXTURES.md) §AV1 data that is cine-like at ≤ 12 bits and fits
the four shards; frames as `lab/av1/fetch_data.sh` writes them, every frame of every series.

| group | sets | depth | what a result here may claim |
| --- | --- | --- | --- |
| DBT, system A | `dbts_a1` … `dbts_a5` | 12 | these five volumes |
| DBT, system B | `dbts_b1` … `dbts_b5` | 10 | these five volumes |
| DBT, system C | `dbts_c1` … `dbts_c5` | 12 | these five volumes |
| content 2, DBT | `dbt10_ea1141`, `dbt10_d` (10-bit, cropped), `dbt12_ea1141`, `dbt12_c` (12-bit) | 10, 12 | these four |
| content 2, other stacks | `rf_fluoro` (fluoroscopy, 12), `mr_ispy1` (breast MR, b = 11), `mr9_ispy2` (breast MR, b = 9) | 9–12 | controls; no profile decision |
| swept ultrasound | `ustrus_1`, `ustrus_2` (TRUS prostate sweeps) | 8 | the nearest swept volume to ABUS; never an ABUS verdict |
| **lossy-sourced, provisional** | `usb_cine`, `usb_cine_rgb` (breast US cine), `us_liver` (liver US cine, RGB) | 8 | reported apart, in no verdict: their source was a lossy video, whose quantizer already removed the noise |

**Not run.** `dbts_a_max`, `dbts_b_max`, `dbts_c_max` (2.9–5.4 Gpx a rung, §Shards: they do not fit). **Pending a
dataset:** breast ultrasound cine and ABUS. Their absence leaves open every question this protocol asks of the
modality most likely to be shown lossy by default (no MQSA limit is known for ultrasound, visually-lossless.md §1):
its own noise level, whether its speckle hides coding error as DBT's quantum noise might, and its scrolling anchor at
cine frame rates. The provisional cine sets cannot stand in: their noise was removed by the source's own codec.
The repo has few cine-like breast series and repeated searches found no more (FIXTURES.md §The frame-group data
search); every result is claimed for the named fixtures only.

### 3 · Arms, per series

| arm | what | measured |
| --- | --- | --- |
| **HTJ2K lossless** (control) | `ingest_coded.py --codec htj2k`, the served profile | bytes, ratio; exact by the ingest's check |
| **lossless AV1, G = 1** (control) | `ingest_coded.py --codec av1 --preset good:6`, as the bytes run ran it | bytes, ratio; exact by the ingest's check |
| **lossy AV1** | every rung of the ladder × G 1, 8, 16 × every form, `aomenc` 3.15.1 with exactly the bytes run's knobs (`../profiles/bytes.py` `aomenc_args`: `--good --cpu-used=6 --threads=1 --end-usage=q --cq-level=Q --min-q=Q --max-q=Q --deltaq-mode=0 --aq-mode=0 --denoise-noise-level=0 --lag-in-frames=0 --auto-alt-ref=0 --tune=psnr`), decoded by dav1d 1.5.4 | every measure of §4, every frame |

12-bit series run all three forms (12-bit stream, top 10 bits, window); every measure is taken at the source's depth b,
so the forms share one scale. The visibility model (§4.6) runs on the stored form only. **G = whole** is not run: the
bytes run found whole-series gain within its P4 band of G = 16's (≤ 1.15 ×, held on every cell), and it does not fit.

**Interleaving.** Within a shard each series' cells run in a Williams order over (form, Q, G), the round being the
series' index (`lab/scripts/order.py`), four in flight. The quality readings do not depend on order: the encode is
deterministic (§7, checked and mutated). Only the encode times do, and they are reported as medians, not compared.

### 4 · What is measured, frame by frame

Per (series, form, Q, G), for every frame: its temporal unit's bytes and each measure below. The collector (§Collector)
reports each as the median frame, the 5th and 1st percentiles (for PSNR, SSIM, MS-SSIM: the bad end) or the 95th and
99th (for errors), and the worst frame.

**4.1 Error.** MSE over the frame and over in-window samples; PSNR = 10 log10(peak² ÷ MSE) at peak 2^b − 1; max |Δ|.

**4.2 Structure.** SSIM at L = peak, Gaussian window σ 1.5, population covariance — scikit-image's
`structural_similarity` as its documentation says matches Wang et al. ("To match the implementation of Wang et al.
[1], set gaussian_weights to True, sigma to 1.5, use_sample_covariance to False, and specify the data_range
argument", [M1]); reimplemented in `quality.py` so that MS-SSIM shares it, and equal to scikit-image's to 1e-9
(§7). **MS-SSIM** as Wang, Simoncelli and Bovik define it [M2]: "the system iteratively applies a low-pass filter and
downsamples the filtered image by a factor of 2"; "The luminance comparison (1) is computed only at Scale M"; the
exponents "β1 = γ1 = 0.0448, β2 = γ2 = 0.2856, β3 = γ3 = 0.3001, β4 = γ4 = 0.2363, and α5 = β5 = γ5 = 0.1333". The
paper does not name its low-pass filter; `quality.py` uses a 2 × 2 mean, this protocol's choice, stated (§7 checks
that the scales are reduced, not which filter is right). Both at L = peak, so a 12-bit frame keeps its 12-bit constants.

**4.3 Compression ratio**, as the guidelines define it: "the ratio of the number of bits in an original image to that
in a compressed version of that image" (ACR), computed "on the bits stored setting" (ESR), both as quoted in
visually-lossless.md §2: Bits Stored × samples ÷ coded bits, per series and per frame. So a 12-bit series counts 12
bits a sample, not its 16-bit container. Read beside CAR's and DRG's ratios only as *tested on 2D JPEG and JPEG 2000*.

**4.4 Coding error against the frame's own noise.** σ per frame, from the source alone:

* **Estimator.** Immerkær's fast noise variance estimate [M3]: the frame convolved with the 3 × 3 Laplacian difference
  N = [1 −2 1; −2 4 −2; 1 −2 1], σ = √(π/2) · mean|I ∗ N| ÷ 6, over in-window samples. Its primary text was not
  readable here (the publisher refused; its mask and formula as written are *unverified* against the paper), so its
  fitness is shown by the synthetic check below, not assumed. Two additions, each tested and mutated:
  * **edges left out**: the steepest 10 % of in-window samples by Sobel gradient magnitude are dropped, after Tai and
    Yang's adaptive edge exclusion [M4] (read as an abstract only: *unverified* beyond it; the 10 % is this protocol's,
    and the check shows it is enough for a 300-unit edge);
  * **rounding taken out**: σ² − 1/12, since rounding to integers adds an error uniform on ±½ of variance 1/12,
    independent of the signal once σ is not far below one step (*derived*; the check shows it holds to σ 0.25).
  * Mean, not median: the bytes run's median of half-integer details is what quantized σ into 0.741 steps.
* **Synthetic check** (`checks.py`, integer frames, a smooth scene and one with a 300-unit disc edge, white Gaussian
  noise of known σ): σ 0.25, 0.5, 1, 2, 3, 4, 8, 16 read 0.24, 0.50, 1.00, 1.99, 3.00, 3.99–4.01, 8.00, 16.08–16.12;
  the scene alone 0.00 — **within 3 % from σ 0.25 up, on both scenes**. Each addition removed breaks it: without the
  rounding term σ 0.5 reads 0.575 (+15 %); with the median σ 1 reads 0.784; without edge exclusion σ 1 on the edge
  scene reads 1.45. Full table: §7.
* **Its limit, measured:** the Laplacian sees the finest band only. Noise blurred by a Gaussian of 0.5 px and rescaled
  to σ 8 reads 5.27; blurred by 1 px, 0.67. DBT's reconstructed noise is spatially correlated, and on `dbt12_ea1141`
  this estimator reads 11.4 where the bytes run's Haar MAD read 14.8 — two high-pass estimators, two bands. So σ here
  is **the frame's noise in the noise band**, and the coding error is compared with it in the same band: **e_N ÷ σ**,
  the residual through the same Laplacian ÷ 6. e ÷ σ (full-band RMS over σ) is reported beside it for continuity with
  the bytes run's crossover, and is not read as an anchor.

**4.5 Displayed grey levels.** For every window pair the series' header carries (each alternative, e.g. `NORMAL`,
`HARDER`, `SOFTER`; LINEAR, LINEAR_EXACT or SIGMOID as its VOI LUT Function says), source and lossy frame through the
window to 8-bit codes as the product paints them (`../profiles/voi.py`, checked against `voi.test.mjs`'s cases by the
bytes run). Over the samples the window shows (source code strictly inside 0 … 255): the share whose code moves by
≥ 1, ≥ 2, ≥ 4 levels, and the largest move. The same count between each exact frame and its neighbouring exact slice
is the scrolling reference (4.6). Series without a window (the ultrasound) are shown as stored.

**4.6 Against the step between neighbouring slices** (scrolling). For frame k, the step is the smaller of its RMS
differences to slices k − 1 and k + 1 (*derived*: scrolling either way, the reader sees at least that much change),
in-window. Two bands: full resolution, and as 4 × 4 means — MS-SSIM's third scale, the one its weights favour (0.3001,
[M2]), where noise has averaged down 4× and the structure that moves through the stack remains. The ratio
**error ÷ step** below 1 says the preview's error is smaller than the stack's own motion from one slice to the next.

**4.7 Visibility model.** **ColorVideoVDP** 0.5.7 [M5], "a full-reference visual quality metric that predicts the
perceptual difference between pairs of images or videos", which "reports image/video quality in the JOD
(Just-Objectionable-Difference) units. The highest quality (no difference) is reported as 10"; "the difference of
JODs can be interpreted as the preference prediction across the population". It runs offline on CPU ("It can also run
on a CPU, but the processing times will be much longer, especially for video"). Set up as follows, every choice stated:

* **Input**: the first window's codes, as luminance of a display calibrated to the DICOM Grayscale Standard Display
  Function [M6] — 256 codes at equal JND steps between L_min and L_max, L(j) from PS3.14 Equation 7-1 and its inverse
  7-2 ("j the index (1 to 1023) of the Luminance levels L j of the JNDs"; coefficients as printed there, checked: L(1)
  = 0.0500, L(1023) = 3 993.3 cd/m², the inverse within 0.09 JND); fed as absolute linear luminance.
* **Display**: L_max 420 cd/m², L_min 1.2 (a 350 : 1 ratio) — the ACR–AAPM–SIIM figures for mammography
  interpretation as secondary sources give them (*unverified* against the standard's text); cvvdp's
  `standard_hdr_linear_dark` geometry ("30-inch 4K HDR monitor … viewed in a dark room (0 lux), seen from 2 x display
  height"), one image pixel to one display pixel.
* **Content**: the stored form, the middle 8 frames, the 1 024 × 1 024 square centred on the middle frame's in-window
  samples, as video at **15 slices/s** (the scrolling rate of the scalable-preview metrics, svc-results.md headline
  2). A whole system-B frame does not fit: 8 frames of 2560 × 3328 passed 6.9 GB resident in one process before it
  was stopped, so four in flight would not fit this host's 15 GB.
* **HDR-VDP-3 is not used.** Its 3.0.7 release is MATLAB code (its project page; a review there says Octave runs it,
  *unverified*); neither is on this host. ColorVideoVDP, from the same group, has a temporal model, which scrolling
  needs, and runs here.
* JOD is reported; no JOD is taken as a bar.

### 5 · Anchors, read from the data

No rung is declared visually lossless or good enough for scrolling. For each (series, form, G), the collector reports
where each anchor falls on the ladder — the highest Q from Q 1 up at which every frame holds — and the bytes there:

* **(a) Visually lossless, by the frame's own noise:** e_N ≤ σ on every frame — the coding error in the noise band is
  no larger than the noise the exact frame already carries in that band (*derived* from the owner's "inside the
  frame's own noise"; at e_N = σ the band's total noise rises by √2, which is reported, not judged). And **displayed
  levels**: every window's largest move ≤ 1 level on every frame. Where the two disagree, both are reported.
* **(b) Scrolling:** error ÷ step < 1 on every frame, in the band and at full resolution — the preview's error is
  smaller than the difference between neighbouring slices, so what moves on screen is the stack, not the coding.
  Per series, because the step is the series' own.
* **(c) Knees:** on each curve of a metric against ln bytes (median PSNR; MS-SSIM as −10 log10(1 − MS-SSIM); median
  e_N ÷ σ; median share moved ≥ 1 level, first window; JOD), both axes scaled to 0 … 1, the interior rung farthest
  from the chord joining the curve's ends (*derived*). The bytes run's bend (largest change of slope of ln bytes
  against PSNR) was tried on the pilot first and rejected: where a metric saturates (JOD at 10 for Q 1 and 2) its slope
  diverges and the bend lands on the saturated end; the chord distance does not depend on which way a metric runs.

The shards report these per series; the collector names the knees and anchors per system and says where the anchors
and the knees agree and where they do not.

### 6 · A blind flicker test to confirm the point (described, not run)

What the data picks must be confirmed by readers; the method the literature uses is alternation without a blank
(Kim B et al. 2011: "AWOB is most sensitive to image differences among of them"), per image, as visually-lossless.md
§2–3 gives it. A short form for a later session or site:

* **Stimuli:** per DBT system, two volumes; at each, the Q the data picks for (a) and for (b) and one rung either side,
  plus exact-against-exact catch trials (one in four).
* **Display and windows:** a calibrated review display (GSDF, the luminance of §4.7, measured), each series' own window
  presets, at 1:1 pixels.
* **Task, still:** one slice, exact and lossy alternating without a blank at 1 Hz until the reader answers "differ" or
  "same"; slices drawn from the median and the worst frame of §4.
* **Task, scrolling:** the same eight slices scrolled at 15 slices/s, exact stack and lossy stack in random order, two
  intervals; "which one is the original?" (two-alternative forced choice).
* **Readers and n:** breast-imaging radiologists or physicists; per condition, n trials such that 50 % (chance) and
  75 % (one JOD's preference, §4.7) are told apart with α 0.05 and power 0.8: n = ⌈((1.645 · 0.5 + 0.84 · √(0.75 ·
  0.25)) ÷ 0.25)²⌉ = 23 (*derived*, one-sided binomial, normal approximation).
* **Reading:** a rung is "not distinguished" when the share correct is not above chance at that power; the catch trials
  bound the false-alarm rate. Nothing in this protocol changes when the test runs.

### 7 · Checks, and their mutations

Run on `dbt12_ea1141` (its middle 4 frames for the coded checks) by `checks.py`, ColorVideoVDP from the hash-pinned
`requirements-vdp.txt` venv; every shard runs the same file first
on its smallest series and writes `rows/shard-<k>.checks.json`.

| check | as run | mutated | sees it |
| --- | --- | --- | --- |
| σ on integer frames of known σ 0.5–16, smooth and edge scenes, within 10 %; scene alone < 0.5 | within 3 % everywhere; 0.00 | rounding term dropped: σ 0.5 reads 0.575 | yes |
| the same | — | median in place of mean: σ 1 reads 0.784 | yes |
| the same | — | no edge exclusion: σ 1 on the edge scene reads 1.45 | yes |
| SSIM = scikit-image's, to 1e-9 | 0.99911359 both | L = 255: 0.879 | yes |
| MS-SSIM = 1 on identical frames; with all weight on scale 5, = SSIM of the 16× reduced pair | 1.0; 0.9999042 both | no downsampling: 0.9666 | yes |
| PSNR of a ±1 checkerboard at 12 bits = 72.245 dB, max \|Δ\| 1 | 72.245 | peak 255: 48.13 | yes |
| displayed levels counted over the window's samples only | 40 of 40, 1 level | clipped codes counted: 120 samples | yes |
| the band: a ±3 checkerboard plus 4 reads 5 full, 4 in the band | 5, 4 | no reduction: 5, 5 | yes |
| ratio on bits stored: 12 × 100 ÷ (8 × 150) = 1 | 1.0 | 16-bit container: 1.33 | yes |
| GSDF: L(1) = 0.05, L(1023) = 3 993.4 to 0.3 %, inverse within 0.5 JND | 0.04998, 3 993.33, 0.09 | coefficient c's sign flipped: L(1023) 1.6e-5 | yes |
| the encode is deterministic: one cell coded twice is byte-identical | identical | `--cpu-used=5`: differs | yes |
| frames aligned: every Q 1 frame's error < every neighbour step | 1.06 against 34.3–37.7 | compared with source frame k + 1: 34.3–37.7 | yes |
| an exact frame reads exact (MSE 0, no level moved) | 0, 0, 0, 0 | one sample +1: max \|Δ\| 1 on that frame | yes |
| the knee: a curve rising to Q 8 and flat after bends at Q 8; an anchor run that fails at Q 8 stops at Q 4 though Q 16 passes | 8, 4 | the rung nearest the chord: 2 | yes |
| ColorVideoVDP: 10 JOD on a stack against itself, less with ±2 codes of noise | 10.00, 9.88 | (the second case is the mutation) | yes |
| reported, no verdict: σ 8 noise blurred by 0.5 and 1 px | 5.27, 0.67 | — | — |

**Also read from every cell:** `--q-hist` (every frame at Q; the bytes run found its own mutation unable to see a
moved quantizer, so this is reported, not trusted) and the temporal unit sizes. `film_grain_params_present` is not
re-read: the knobs are the bytes run's, under which it read 0 on every stream.

### 8 · Pilot, and what it sizes

`dbt12_ea1141` (29 frames of 614 × 1359, 12 bits, 24.2 Mpx), the whole ladder × G 1, 8, 16 × its three forms: 90
cells, the visibility model on its 30 stored-form cells, run 2026-11-04 on this host (4 cores, Xeon, 15 GB) with four
cells in flight: **9 min 5 s of wall clock**, encode wall ÷ CPU 1.018 (median). Its rows are kept in
[`pilot/dbt12_ea1141.jsonl`](pilot/dbt12_ea1141.jsonl) and the checks in [`pilot/checks.json`](pilot/checks.json),
**to size the shards and to show the readings exist — not as a result**: one small series, cropped by its source.

**Costs, CPU s a megapixel of the series** (what `plan.py` uses):

| part | pilot | bytes run | used |
| --- | --- | --- | --- |
| encode, the ladder summed, G 1 · 8 · 16 | 12-bit 5.99 · 3.76 · 3.52; top 10 5.69 · 3.61 · 3.40; window 7.88 · 6.03 · 5.79 | medians at Q 2, 8, 16, 32, 56 | the bytes run's medians, the pilot's ratios at Q 1, 4, 12, 24, 40, × 1.15 |
| decode (dav1d) + measure + y4m, per cell | 0.27 | — | 0.27 |
| ColorVideoVDP, per megapixel of its 8-frame square | 1.5 | — | 2.0 |
| controls: lossless AV1 G 1 good:6 · HTJ2K | 4.1 · under 0.05 | — | 4.1 |

The window form costs about 1.6× the others at G 8 and 16: it spreads a 614–692-unit window over 1 023 codes, so its
noise is coded larger.

**What the pilot reads**, 12-bit stream (the stored form), G = 16 (G 1 and 8 within a rung of it everywhere):

| Q | ratio | PSNR med, dB | MS-SSIM med | e ÷ σ · e_N ÷ σ med | ≥ 1 level med · ≥ 2 worst · largest | error ÷ step, band worst | JOD |
| --: | --: | --: | --: | --- | --- | --: | --: |
| 1 | 3.9 | 71.80 | 1.0000 | 0.11 · 0.11 | 29.0 % · 0.5 % · 3 | 0.03 | 10.00 |
| 2 | 5.1 | 65.88 | 1.0000 | 0.22 · 0.23 | 51.6 % · 8.8 % · 5 | 0.06 | 10.00 |
| 4 | 8.7 | 58.05 | 0.9998 | 0.55 · 0.55 | 76.3 % · 41.7 % · 13 | 0.13 | 9.96 |
| 8 | 26.0 | 50.26 | 0.9987 | 1.35 · 0.97 | 89.4 % · 72.0 % · 33 | 0.37 | 9.68 |
| 12 | 76.7 | 47.19 | 0.9965 | 1.92 · 1.03 | 92.3 % · 79.4 % · 49 | 0.64 | 9.08 |
| 16 | 214.3 | 45.69 | 0.9939 | 2.26 · 1.04 | 93.4 % · 82.3 % · 67 | 0.94 | 8.16 |
| 24 | 775.4 | 44.31 | 0.9897 | 2.64 · 1.04 | 94.3 % · 84.4 % · 98 | 1.37 | 6.53 |
| 32 | 1 844 | 43.22 | 0.9855 | 2.96 · 1.04 | 94.9 % · 86.2 % · 101 | 1.74 | 5.44 |
| 56 | 13 671 | 37.76 | 0.9607 | 5.11 · 1.04 | 96.9 % · 91.9 % · 192 | 4.52 | 1.51 |

Neighbouring exact slices themselves differ by ≥ 1 level on 95 % of in-window pixels. Read as the protocol would:
**knees** at Q 8 on PSNR, MS-SSIM, e_N ÷ σ and the ≥ 1-level share, Q 16 on JOD; **anchor (a) by noise** holds to Q 8,
**by displayed levels** at no rung (Q 1 already moves 0.5 % of pixels by 2 levels, the largest by 3); **anchor (b)**
holds to Q 16 in the band and to Q 32 (G 1: Q 40) at full resolution. Two readings the shards should expect:

* **e_N ÷ σ saturates near 1.04.** Once the quantizer removes the frame's fine-band noise, the residual in that band
  *is* that noise (*derived*: §1b of the bytes run's theory, Δ ≫ σ), so e_N ≤ σ marks the last rung that still keeps
  part of the noise — here Q 8, which is also every pixel metric's knee. It is read so, not as "error below noise".
* **The window form** reads 13.6 dB PSNR at every Q: it clips the first window's SIGMOID tails, which the in-window
  test still counts (the bytes run's P9 found the same). Its cells are reported and in no anchor.

The 12-bit stream and the top 10 bits sit within one rung of each other on every anchor and knee here.

**Saturation.** Four cells in flight, one thread each, on 4 cores and 15 GB; ColorVideoVDP one thread inside its cell.
Nothing past this host is claimed; encode cost is quoted as CPU seconds a megapixel only.

## Shards

Exactly four, each one session on its own 4-core, 15 GB cloud host, each **≤ 4.5 h of wall clock**. `plan.py` deals the
series largest first to the least-loaded shard from the costs of §8 and writes `plan.json`, which `shard.sh` reads; the
table is its output. Every shard runs the whole ladder (Q 1, 2, 4, 8, 12, 16, 24, 32, 40, 56) at G 1, 8 and 16, every
form, the visibility model on the stored form, and both controls.

| shard | series | Q | G | CPU s (est.) | wall h on 4 cores (est.) |
| --- | --- | --- | --- | --: | --: |
| 1 | `dbts_c3`, `dbt12_c`, `dbts_a1`, `dbts_c2`, `ustrus_1`, `mr_ispy1`, `mr9_ispy2` | 1, 2, 4, 8, 12, 16, 24, 32, 40, 56 | 1, 8, 16 | 47796 | 3.32 |
| 2 | `dbts_a2`, `dbts_c5`, `dbts_b2`, `dbts_c4`, `dbt12_ea1141`, `dbt10_ea1141`, `usb_cine` | 1, 2, 4, 8, 12, 16, 24, 32, 40, 56 | 1, 8, 16 | 48175 | 3.35 |
| 3 | `dbts_a4`, `dbts_b4`, `dbts_a5`, `dbts_a3`, `dbt10_d`, `us_liver`, `rf_fluoro` | 1, 2, 4, 8, 12, 16, 24, 32, 40, 56 | 1, 8, 16 | 47724 | 3.31 |
| 4 | `dbts_c1`, `dbts_b1`, `dbts_b3`, `dbts_b5`, `ustrus_2`, `usb_cine_rgb` | 1, 2, 4, 8, 12, 16, 24, 32, 40, 56 | 1, 8, 16 | 47933 | 3.33 |

Each estimate is §8's costs over the shard's series: encodes at the bytes run's medians (pilot rungs elsewhere) × 1.15,
measurement 0.27, the visibility model 2.0 a megapixel of its frames, controls 4.4 (lossless AV1 4.1, the series row
0.3); its wall clock is CPU ÷ 4. The pilot's own series came in at about 2 200 CPU s (2 097 in its cells, its controls timed apart) against an
estimate of 2 181.

**Everything of §2 fits**, at G 1, 8 and 16, with about 1.2 h of headroom a shard (3.31–3.35 h of 4.5). **Left over,
not run:** `dbts_a_max`, `dbts_b_max`, `dbts_c_max` — 22 400, 21 300 and 35 200 CPU s by the same costs, each larger
than any shard's headroom (about 16 900 CPU s), and 270 500 CPU s in all against 4 × 64 800; G = whole (§3).

### Running one

A shard session reads §1–§8 and this section, changes nothing above §Shards, and works on `claude/av1-quality-metrics`:

```bash
git fetch origin && git checkout claude/av1-quality-metrics && git pull --rebase
pip install meson                                    # ingest/tools.sh needs it; the host may lack it
BUILD=$PWD/lab/.av1-build lab/av1/tools/tools.sh aom # libaom 3.15.1, dav1d 1.5.4, OpenJPH 0.31.0 (and libaom 3.8.2)
S=$(python3 -c "import json; print(' '.join(json.load(open('lab/av1/metrics/plan.json'))['shards']['K']['sets']))")
lab/av1/fetch_data.sh $S                             # its sets only, checked against their pins
lab/av1/.venv/bin/pip install --require-hashes -r lab/av1/profiles/requirements.txt
python3.11 -m venv lab/av1/metrics/.venv && lab/av1/metrics/.venv/bin/pip install --require-hashes \
    -r lab/av1/metrics/requirements-vdp.txt          # ColorVideoVDP on CPU torch, its own venv
lab/av1/metrics/shard.sh K                           # K = 1 … 4
```

* **What it writes:** `rows/shard-K.checks.json` (§7's checks, as run and mutated, on the shard's smallest grey
  series), then `rows/shard-K.jsonl`: one `series` row per set, two `control` rows, one `cell` row per (form, Q, G).
  Nothing else in the repository.
* **Stopping and resuming:** `shard.sh` skips every row already written; a cell in flight when the session stopped is
  coded again whole.
* **Push early:** commit `rows/shard-K.*` after the checks and then about hourly (`git pull --rebase` first; others push
  to this branch, and only these files and the shard's own section are its).
* **Disk:** the fetched sets (up to ~3.5 GB raw a shard) and four cells' y4m in flight (up to ~2 GB each on system B).
* **If it would not fit:** after the first series, project the shard's wall clock from its rows; if over 4.5 h, run the
  remaining series with `cell.py … --g 1,16` and say so. A cut cell is listed, not dropped quietly.
* **Its section:** at the end of this file, `### Shard K, measured (date)`: five plain lines; the host (cores, memory,
  wall ÷ CPU of its encodes, from the rows); the checks table from `rows/shard-K.checks.json`; then
  `collect.py lab/av1/metrics/rows/shard-K.jsonl --partial`'s tables for its series, which it reads only as its
  own; anything not run. On a rebase conflict at the end of the file, keep every shard's section.

## Collector

Once all four shards have pushed `rows/shard-<k>.jsonl` and their sections, one session (any; the last shard's if it
has time) runs:

```bash
P=lab/av1/.venv/bin/python
$P lab/av1/metrics/collect.py lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl --tsv lab/av1/metrics/rows/curves.tsv \
    --svg lab/av1/metrics/rows/curves
```

`collect.py` refuses a missing series, control or cell against `plan.json` (`--partial` reports what is there and says
so). It prints, and the session pastes under one dated heading **`## Quality metrics, measured (YYYY-MM-DD)`** at the
end of this file, after the four shards' sections, with the five plain lines of this file's opening:

1. **Every cell**: per (series, form, G, Q) the ratio, PSNR median / p5 / worst frame, max |Δ|, SSIM and MS-SSIM median
   / worst, e ÷ σ and e_N ÷ σ, the first window's moves ≥ 1 / ≥ 2 / ≥ 4 levels and the largest, error ÷ step (band, full),
   JOD; every other window's columns are in the rows and the TSV.
2. **The curves**: `rows/curves.tsv`, one line per (series, form, G, Q) — bytes against each metric — and `rows/curves/`,
   one SVG per system and metric (ln bytes on x; median PSNR, MS-SSIM in dB, e_N ÷ σ, share ≥ 1 level, JOD on y; each
   series' stored form, G 1 solid and G 16 dashed), linked from the section.
3. **The knees** (§5 c) per series and their median per system, with the bytes there.
4. **The anchors** (§5 a, b) per series, then per system: the median and the range of the highest Q holding, the
   bytes and the ratio there, and whether (a) by noise and (a) by displayed levels agree.
5. **What disagrees**: any series whose anchors or knees sit more than one rung from its system's median, named.
6. **The provisional sets** (`usb_cine`, `usb_cine_rgb`, `us_liver`) in their own table, in no verdict; the controls
   (MR, fluoroscopy) and TRUS apart from DBT.

Nothing is called visually lossless: the section says which rung each anchor picks and that §6's test would confirm it.

## Sources

Read 2026-11-04 unless stated.

* [M1] scikit-image 0.25.x, `skimage.metrics.structural_similarity`, as quoted in [`../profiles`](../profiles/README.md)
  [L6] (read there 2026-11-02).
* [M2] Z. Wang, E. P. Simoncelli, A. C. Bovik, *Multi-scale structural similarity for image quality assessment*, Proc.
  37th IEEE Asilomar Conference on Signals, Systems and Computers, 2003,
  <https://ece.uwaterloo.ca/~z70wang/publications/msssim.pdf> (§2–3, read from the PDF's text).
* [M3] J. Immerkær, *Fast Noise Variance Estimation*, Computer Vision and Image Understanding 64(2):300–302, 1996,
  doi:10.1006/cviu.1996.0060 — title, venue and the method's name as MVTec's HALCON reference cites it ("J. Immerkaer:
  “Fast Noise Variance Estimation“, Computer Vision and Image Understanding, Vol. 64, No. 2, pp. 300-302, 1996",
  <https://www.mvtec.com/doc/halcon/2411/en/estimate_noise.html>); the paper itself refused (HTTP 403): *unverified*.
* [M4] S.-C. Tai, S.-M. Yang, *A fast method for image noise estimation using Laplacian operator and adaptive edge
  detection*, ISCCSP 2008, doi:10.1109/ISCCSP.2008.4537384 — seen only as a search listing: *unverified*.
* [M5] ColorVideoVDP, <https://github.com/gfxdisp/ColorVideoVDP> (README; `cvvdp` 0.5.7, MIT); R. K. Mantiuk et al.,
  *ColorVideoVDP: A visual difference predictor for image, video and display distortions*, SIGGRAPH 2024,
  doi:10.1145/3658144. HDR-VDP: <https://sourceforge.net/projects/hdrvdp/> (3.0.7).
* [M6] DICOM PS3.14, chapter 7 (Grayscale Standard Display Function),
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part14/chapter_7.html>.
* Kim B et al. 2011, ACR, ESR, MQSA and the other guideline quotes: as `docs/av1/visually-lossless.md`
  on `claude/av1-visually-lossless` at 95357d834 gives them (read there 2026-11-02).

### Shard 1, measured (2026-11-04, partial)

*In progress: the checks are in, the cells are running. This section is replaced as each series lands.*

**Host.** 4 cores (Intel Xeon @ 2.10 GHz), 15 GB, no swap; four cells in flight as `shard.sh` runs them. libaom
3.15.1 and dav1d 1.5.4 built by `tools.sh`. On this host `dav1d` loads the system's libdav1d 1.4.1 unless
`LD_LIBRARY_PATH` names the built one, so the shard ran with `LD_LIBRARY_PATH=lab/.av1-build/dav1d/lib`
(`dav1d --version`: 1.5.4-0-g54706fc).

**Checks** (`rows/shard-1.checks.json`, on `mr9_ispy2`, the shard's smallest grey series; the synthetic checks do
not depend on the series):

| check | as run | mutated | sees it |
| --- | --- | --- | --- |
| σ on integer frames of known σ, smooth and edge scenes | 0.241 … 16.115 for σ 0.25 … 16; scene alone 0.00 | rounding term dropped: σ 0.5 reads 0.575 | yes |
| the same | — | median in place of mean: σ 1 reads 0.784 | yes |
| the same | — | no edge exclusion: σ 1 on the edge scene reads 1.45 | yes |
| SSIM = scikit-image's, to 1e-9 | 0.99911359 both | L = 255: 0.879 | yes |
| MS-SSIM, scale 5 alone = SSIM of the 16× reduced pair | 1.0; 0.9999042 both | no downsampling: 0.9666 | yes |
| PSNR of a ±1 checkerboard at 12 bits | 72.245 dB, max \|Δ\| 1 | peak 255: 48.13 | yes |
| displayed levels over the window's samples only | 40 of 40, 1 level | clipped codes counted: 120 | yes |
| the band | 5 full, 4 band | no reduction: 5, 5 | yes |
| ratio on bits stored | 1.0 | 16-bit container: 1.33 | yes |
| GSDF | L(1) 0.04998, L(1023) 3 993.33, inverse 0.09 JND | c's sign flipped: L(1023) 1.6e-5 | yes |
| deterministic encode | byte-identical | `--cpu-used=5`: differs | yes |
| frames aligned: Q 1 error < neighbour step | 0.62–0.66 against 9.58–10.13 | source k + 1: 9.57–10.13 | yes |
| an exact frame reads exact | 0, 0, 0, 0 | one sample +1: 0, 1, 0, 0 | yes |
| knee and anchor | 8, 4 | rung nearest the chord: 2 | yes |
| ColorVideoVDP | 10.00 against itself, 9.88 with ±2 codes | (the second case) | yes |
| reported, no verdict: σ 8 noise blurred 0.5 · 1 px | 5.27 · 0.67 | — | — |

### Shard 4, measured (2026-11-04, partial)

*In progress: the checks are in, the controls and cells are running. This section is replaced as each series lands.*

**Host.** 4 cores (Intel Xeon @ 2.10 GHz), 15 GB, no swap; four cells in flight as `shard.sh` runs them. libaom
3.15.1, dav1d 1.5.4 and OpenJPH 0.31.0 built by `tools.sh`. Here too the built `dav1d` loads the system's libdav1d
1.4.1 unless `LD_LIBRARY_PATH` names the built one; a first start ran the checks and three control rows under 1.4.1,
was stopped before any cell, and was discarded whole. The shard then ran from the start with
`LD_LIBRARY_PATH=lab/.av1-build/dav1d/lib` (`dav1d --version`: 1.5.4-0-g54706fc). The six sets were fetched by
`fetch_data.sh`, every raw frame checked against its pinned SHA-256.

**Checks** (`rows/shard-4.checks.json`, on `ustrus_2`, the shard's smallest grey series; the synthetic checks do not
depend on the series):

| check | as run | mutated | sees it |
| --- | --- | --- | --- |
| σ on integer frames of known σ, smooth and edge scenes | 0.241 … 16.115 for σ 0.25 … 16; scene alone 0.00 | rounding term dropped: σ 0.5 reads 0.575 | yes |
| the same | — | median in place of mean: σ 1 reads 0.784 | yes |
| the same | — | no edge exclusion: σ 1 on the edge scene reads 1.45 | yes |
| SSIM = scikit-image's, to 1e-9 | 0.99911359 both | L = 255: 0.879 | yes |
| MS-SSIM, scale 5 alone = SSIM of the 16× reduced pair | 1.0; 0.9999042 both | no downsampling: 0.9666 | yes |
| PSNR of a ±1 checkerboard at 12 bits | 72.245 dB, max \|Δ\| 1 | peak 255: 48.13 | yes |
| displayed levels over the window's samples only | 40 of 40, 1 level | clipped codes counted: 120 | yes |
| the band | 5 full, 4 band | no reduction: 5, 5 | yes |
| ratio on bits stored | 1.0 | 16-bit container: 1.33 | yes |
| GSDF | L(1) 0.04998, L(1023) 3 993.33, inverse 0.09 JND | c's sign flipped: L(1023) 1.6e-5 | yes |
| deterministic encode | byte-identical | `--cpu-used=5`: differs | yes |
| frames aligned: Q 1 error < neighbour step | 0.34–0.38 against 4.73–14.17 | source k + 1: 4.73–14.18 | yes |
| an exact frame reads exact | 0, 0, 0, 0 | one sample +1: 0, 1, 0, 0 | yes |
| knee and anchor | 8, 4 | rung nearest the chord: 2 | yes |
| ColorVideoVDP | 10.00 against itself, 9.88 with ±2 codes | (the second case) | yes |
| reported, no verdict: σ 8 noise blurred 0.5 · 1 px | 5.27 · 0.67 | — | — |
