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

### Shard 1, measured (2026-11-04)

1. **Run:** shard 1 as §Shards assigns it — `dbts_c3`, `dbt12_c`, `dbts_a1`, `dbts_c2`, `ustrus_1`, `mr_ispy1`,
   `mr9_ispy2`, every rung Q 1 … 56 at G 1, 8, 16, every form, both controls, §7's checks: 510 cells, none cut.
2. **Shows**, stored form, G 16, the four DBT volumes: knees at Q 8 on PSNR, MS-SSIM and the ≥ 1-level share, Q 8–12
   on e_N ÷ σ, Q 16 on JOD; anchor (a) by noise to Q 8 (`dbts_a1`: Q 4), by displayed levels at no rung; anchor (b)
   to Q 16 in the band and Q 40 at full resolution (`dbts_a1` G 16: Q 32). At Q 8: ratio 20.8–34.1, PSNR median
   49.8–51.2 dB, JOD 9.68–9.84. `ustrus_1`: (a) by noise to Q 2–4, (b) to Q 24 · 32, JOD 9.95 at Q 16.
3. **Rests on** these seven series only (two system C volumes, one system A, one content 2 DBT, one TRUS sweep, two
   breast MR controls), libaom 3.15.1 at cpu6 and dav1d 1.5.4, and §4's estimators as checked below.
4. **Left:** nothing of shard 1's table is unrun; reading these beside the other systems is the collector's.
5. **Host:** 4 cores, 15 GB, four cells in flight; 3 h 14.5 min of wall clock (18:36:25–21:50:57 UTC) against the
   plan's 3.32 h. Nothing past this host is claimed.

*Terms* as §Terms; also **stored form** — the 12-bit stream for a 12-bit series, the series' own depth otherwise;
**wall ÷ CPU** — an encode's wall-clock seconds over its CPU seconds, near 1 when the four cells in flight never wait
for a core.

**Host.** 4 cores (Intel Xeon @ 2.10 GHz), 15 GB, no swap. Encode wall ÷ CPU over the 510 cells: median 1.016, 5th
percentile 1.010, 95th 1.034 — one thread a cell on four cores, the host's limit; nothing faster or wider is claimed.
CPU seconds: encodes 24 220, dav1d decodes 704, ColorVideoVDP 3 223 (210 cells). libaom 3.15.1 and dav1d 1.5.4 built
by `tools.sh`. On this host `dav1d` loads the system's libdav1d 1.4.1 unless `LD_LIBRARY_PATH` names the built one,
so the shard ran with `LD_LIBRARY_PATH=lab/.av1-build/dav1d/lib` (`dav1d --version`: 1.5.4-0-g54706fc).

**Exact frames against their source.** Every set fetched by `fetch_data.sh` against its pinned SHA-256 (exit 0);
both controls decoded every frame back exact on all seven sets (`ingest_coded.py`: "every one exact", HTJ2K and
lossless AV1); §7's "an exact frame reads exact" and "frames aligned" checks held. **`--q-hist`:** every frame of every
cell coded at its Q (no other Q in any histogram); each histogram counts one entry more than the series has frames
(71 on 70), on all 510 cells — reported, not explained.

**Forms.** `mr_ispy1` (b = 11, stored in 16 bits) ran three forms (11-bit stream, top 10 bits, window) as `cell.py`
deals them; §3 lists one form for non-12-bit series. All 90 of its cells are reported; its stored form is the 11-bit
stream. As in the pilot, the window form's cells clip the window's tails and are in no anchor.

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

**`collect.py lab/av1/metrics/rows/shard-1.jsonl --partial`**, shard 1's series only (`--partial` because the
other shards' series are not in this file):

##### Every cell

| series, form | G | Q | ratio | PSNR med / p5 / min dB | max \|Δ\| | SSIM med / min | MS-SSIM med / min | e ÷ σ med (noise band med / max) | window 1: ≥1 level med / max, ≥2 max, ≥4 max, max | scroll med / max | JOD |
| --- | --: | --: | --: | --- | --: | --- | --- | --- | --- | --- | --: |
| `dbt12_c` 12bit | 1 | 1 | 4.8 | 72.74 / 72.51 / 72.51 | 26 | 1.0000 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 18.6 / 19.1 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.02 | 10.0 |
| `dbt12_c` 12bit | 1 | 2 | 6.2 | 66.81 / 66.59 / 66.58 | 31 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.19) | 36.9 / 37.7 %, 1.8 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbt12_c` 12bit | 1 | 4 | 10.4 | 58.82 / 58.59 / 58.59 | 68 | 0.9988 / 0.9987 | 0.9998 / 0.9998 | 0.44 (0.45 / 0.48) | 65.4 / 66.5 %, 24.2 %, 1.9 %, 10 | 0.10 / 0.11 | 9.98 |
| `dbt12_c` 12bit | 1 | 8 | 28.5 | 50.87 / 50.73 / 50.71 | 291 | 0.9924 / 0.9919 | 0.9989 / 0.9988 | 1.11 (0.94 / 0.96) | 83.6 / 85.4 %, 60.0 %, 26.3 %, 27 | 0.25 / 0.29 | 9.84 |
| `dbt12_c` 12bit | 1 | 12 | 80.3 | 47.59 / 47.46 / 47.45 | 382 | 0.9837 / 0.9830 | 0.9972 / 0.9969 | 1.62 (1.06 / 1.09) | 87.7 / 89.5 %, 70.7 %, 41.9 %, 47 | 0.44 / 0.52 | 9.49 |
| `dbt12_c` 12bit | 1 | 16 | 164.0 | 46.34 / 46.16 / 46.15 | 401 | 0.9789 / 0.9774 | 0.9955 / 0.9949 | 1.86 (1.07 / 1.10) | 89.1 / 90.7 %, 73.9 %, 46.9 %, 69 | 0.62 / 0.72 | 9.0 |
| `dbt12_c` 12bit | 1 | 24 | 355.1 | 45.24 / 45.05 / 45.02 | 496 | 0.9743 / 0.9725 | 0.9929 / 0.9920 | 2.10 (1.07 / 1.10) | 90.4 / 91.8 %, 76.5 %, 51.2 %, 94 | 0.89 / 1.06 | 8.07 |
| `dbt12_c` 12bit | 1 | 32 | 705.7 | 44.14 / 43.97 / 43.95 | 1055 | 0.9714 / 0.9695 | 0.9898 / 0.9883 | 2.35 (1.07 / 1.10) | 91.5 / 92.8 %, 79.1 %, 55.3 %, 109 | 1.23 / 1.46 | 6.87 |
| `dbt12_c` 12bit | 1 | 40 | 1265.9 | 42.76 / 42.56 / 42.54 | 1416 | 0.9670 / 0.9634 | 0.9855 / 0.9835 | 2.70 (1.07 / 1.10) | 92.6 / 93.6 %, 81.2 %, 58.9 %, 134 | 1.63 / 1.89 | 5.69 |
| `dbt12_c` 12bit | 1 | 56 | 3476.0 | 38.68 / 38.27 / 38.21 | 2363 | 0.9398 / 0.9111 | 0.9698 / 0.9656 | 4.08 (1.08 / 1.11) | 94.7 / 95.0 %, 85.4 %, 68.1 %, 228 | 2.98 / 3.28 | 3.5 |
| `dbt12_c` 12bit | 16 | 1 | 4.8 | 72.77 / 72.54 / 72.51 | 41 | 1.0000 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 18.5 / 19.1 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.02 | 10.0 |
| `dbt12_c` 12bit | 16 | 2 | 6.4 | 66.38 / 66.07 / 66.07 | 72 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.21) | 38.3 / 39.2 %, 2.4 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbt12_c` 12bit | 16 | 4 | 10.4 | 58.78 / 58.54 / 58.53 | 125 | 0.9988 / 0.9987 | 0.9998 / 0.9998 | 0.45 (0.45 / 0.48) | 65.5 / 66.7 %, 24.2 %, 1.9 %, 9 | 0.10 / 0.12 | 9.98 |
| `dbt12_c` 12bit | 16 | 8 | 28.6 | 50.98 / 50.84 / 50.73 | 218 | 0.9926 / 0.9920 | 0.9990 / 0.9988 | 1.10 (0.94 / 0.96) | 83.4 / 85.2 %, 59.8 %, 26.0 %, 26 | 0.25 / 0.30 | 9.84 |
| `dbt12_c` 12bit | 16 | 12 | 90.1 | 47.71 / 47.56 / 47.46 | 408 | 0.9842 / 0.9830 | 0.9973 / 0.9969 | 1.59 (1.06 / 1.09) | 87.6 / 89.4 %, 70.4 %, 41.6 %, 44 | 0.44 / 0.52 | 9.5 |
| `dbt12_c` 12bit | 16 | 16 | 246.5 | 46.32 / 46.16 / 46.13 | 409 | 0.9788 / 0.9774 | 0.9955 / 0.9949 | 1.86 (1.07 / 1.10) | 89.1 / 90.8 %, 73.8 %, 46.9 %, 54 | 0.62 / 0.74 | 8.97 |
| `dbt12_c` 12bit | 16 | 24 | 793.8 | 45.06 / 44.82 / 44.73 | 519 | 0.9741 / 0.9723 | 0.9924 / 0.9910 | 2.15 (1.07 / 1.10) | 90.5 / 92.0 %, 77.1 %, 52.0 %, 68 | 0.97 / 1.18 | 7.83 |
| `dbt12_c` 12bit | 16 | 32 | 2062.6 | 43.87 / 43.65 / 43.62 | 668 | 0.9722 / 0.9701 | 0.9889 / 0.9872 | 2.43 (1.07 / 1.10) | 91.8 / 93.0 %, 79.6 %, 56.2 %, 85 | 1.33 / 1.59 | 6.69 |
| `dbt12_c` 12bit | 16 | 40 | 4461.6 | 42.35 / 41.96 / 41.91 | 1140 | 0.9674 / 0.9657 | 0.9839 / 0.9820 | 2.85 (1.07 / 1.10) | 93.0 / 93.9 %, 82.1 %, 60.9 %, 149 | 1.82 / 2.09 | 5.52 |
| `dbt12_c` 12bit | 16 | 56 | 15856.9 | 38.08 / 37.18 / 37.02 | 2284 | 0.9354 / 0.9224 | 0.9657 / 0.9609 | 4.52 (1.07 / 1.10) | 95.1 / 95.6 %, 86.9 %, 71.3 %, 217 | 3.42 / 3.95 | 3.25 |
| `dbt12_c` 12bit | 8 | 1 | 4.8 | 72.77 / 72.54 / 72.51 | 43 | 1.0000 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 18.5 / 19.1 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.02 | 10.0 |
| `dbt12_c` 12bit | 8 | 2 | 6.4 | 66.42 / 66.08 / 66.07 | 72 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.21) | 38.2 / 39.2 %, 2.4 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbt12_c` 12bit | 8 | 4 | 10.4 | 58.78 / 58.54 / 58.53 | 125 | 0.9988 / 0.9987 | 0.9998 / 0.9998 | 0.45 (0.45 / 0.48) | 65.6 / 66.7 %, 24.2 %, 1.9 %, 10 | 0.10 / 0.12 | 9.98 |
| `dbt12_c` 12bit | 8 | 8 | 28.6 | 50.98 / 50.80 / 50.73 | 282 | 0.9926 / 0.9920 | 0.9990 / 0.9988 | 1.10 (0.94 / 0.96) | 83.5 / 85.2 %, 59.8 %, 26.0 %, 26 | 0.25 / 0.30 | 9.84 |
| `dbt12_c` 12bit | 8 | 12 | 89.6 | 47.68 / 47.53 / 47.45 | 359 | 0.9842 / 0.9830 | 0.9972 / 0.9969 | 1.59 (1.06 / 1.09) | 87.6 / 89.4 %, 70.4 %, 41.6 %, 42 | 0.44 / 0.52 | 9.5 |
| `dbt12_c` 12bit | 8 | 16 | 240.0 | 46.32 / 46.16 / 46.13 | 393 | 0.9788 / 0.9774 | 0.9955 / 0.9949 | 1.86 (1.07 / 1.10) | 89.1 / 90.8 %, 73.8 %, 46.9 %, 59 | 0.62 / 0.74 | 8.97 |
| `dbt12_c` 12bit | 8 | 24 | 757.2 | 45.07 / 44.80 / 44.73 | 533 | 0.9741 / 0.9723 | 0.9924 / 0.9910 | 2.14 (1.07 / 1.10) | 90.5 / 92.0 %, 77.1 %, 52.0 %, 94 | 0.97 / 1.18 | 7.87 |
| `dbt12_c` 12bit | 8 | 32 | 1892.0 | 43.92 / 43.65 / 43.61 | 659 | 0.9717 / 0.9695 | 0.9890 / 0.9872 | 2.42 (1.07 / 1.10) | 91.7 / 93.0 %, 79.6 %, 56.2 %, 104 | 1.33 / 1.59 | 6.72 |
| `dbt12_c` 12bit | 8 | 40 | 3992.8 | 42.50 / 42.00 / 41.86 | 1140 | 0.9665 / 0.9634 | 0.9843 / 0.9818 | 2.83 (1.07 / 1.10) | 92.8 / 93.9 %, 82.0 %, 60.3 %, 128 | 1.78 / 2.10 | 5.46 |
| `dbt12_c` 12bit | 8 | 56 | 13426.0 | 38.35 / 37.36 / 37.17 | 2284 | 0.9354 / 0.9166 | 0.9675 / 0.9614 | 4.28 (1.07 / 1.10) | 95.0 / 95.3 %, 86.4 %, 71.0 %, 224 | 3.20 / 3.90 | 3.33 |
| `dbt12_c` top10 | 1 | 1 | 5.7 | 65.95 / 65.73 / 65.73 | 45 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.20 (0.19 / 0.21) | 38.9 / 39.9 %, 3.5 %, 0.0 %, 4 | 0.06 / 0.07 | — |
| `dbt12_c` top10 | 1 | 2 | 7.5 | 62.48 / 62.26 / 62.26 | 50 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 52.7 / 53.6 %, 10.4 %, 0.1 %, 6 | 0.08 / 0.09 | — |
| `dbt12_c` top10 | 1 | 4 | 11.9 | 57.05 / 56.84 / 56.83 | 93 | 0.9982 / 0.9981 | 0.9998 / 0.9997 | 0.55 (0.54 / 0.57) | 70.6 / 71.9 %, 32.3 %, 4.5 %, 12 | 0.13 / 0.15 | — |
| `dbt12_c` top10 | 1 | 8 | 30.3 | 50.54 / 50.40 / 50.39 | 291 | 0.9918 / 0.9914 | 0.9988 / 0.9987 | 1.15 (0.96 / 0.98) | 84.1 / 85.9 %, 61.4 %, 28.0 %, 29 | 0.27 / 0.32 | — |
| `dbt12_c` top10 | 1 | 12 | 75.8 | 47.69 / 47.55 / 47.53 | 365 | 0.9843 / 0.9835 | 0.9973 / 0.9970 | 1.60 (1.06 / 1.08) | 87.6 / 89.4 %, 70.4 %, 41.4 %, 42 | 0.44 / 0.52 | — |
| `dbt12_c` top10 | 1 | 16 | 145.7 | 46.50 / 46.34 / 46.31 | 395 | 0.9799 / 0.9786 | 0.9958 / 0.9953 | 1.83 (1.07 / 1.10) | 89.0 / 90.6 %, 73.5 %, 46.4 %, 60 | 0.59 / 0.70 | — |
| `dbt12_c` top10 | 1 | 24 | 312.3 | 45.44 / 45.25 / 45.23 | 547 | 0.9759 / 0.9743 | 0.9935 / 0.9926 | 2.06 (1.07 / 1.10) | 90.2 / 91.6 %, 76.1 %, 50.5 %, 88 | 0.85 / 1.00 | — |
| `dbt12_c` top10 | 1 | 32 | 609.9 | 44.45 / 44.26 / 44.24 | 860 | 0.9734 / 0.9713 | 0.9907 / 0.9894 | 2.29 (1.07 / 1.11) | 91.3 / 92.6 %, 78.5 %, 54.3 %, 104 | 1.14 / 1.36 | — |
| `dbt12_c` top10 | 1 | 40 | 1062.4 | 43.31 / 43.14 / 43.13 | 1416 | 0.9690 / 0.9662 | 0.9871 / 0.9852 | 2.57 (1.08 / 1.11) | 92.2 / 93.4 %, 80.6 %, 57.8 %, 123 | 1.48 / 1.75 | — |
| `dbt12_c` top10 | 1 | 56 | 2870.8 | 39.91 / 39.52 / 39.43 | 2302 | 0.9492 / 0.9355 | 0.9741 / 0.9711 | 3.64 (1.08 / 1.11) | 94.2 / 94.6 %, 84.1 %, 65.6 %, 202 | 2.59 / 2.80 | — |
| `dbt12_c` top10 | 16 | 1 | 5.9 | 65.62 / 65.35 / 65.33 | 69 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.20 / 0.21) | 40.2 / 41.1 %, 4.0 %, 0.0 %, 5 | 0.06 / 0.08 | — |
| `dbt12_c` top10 | 16 | 2 | 7.5 | 62.45 / 62.19 / 62.18 | 85 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 52.9 / 53.8 %, 10.6 %, 0.1 %, 7 | 0.08 / 0.10 | — |
| `dbt12_c` top10 | 16 | 4 | 11.9 | 56.99 / 56.76 / 56.74 | 167 | 0.9982 / 0.9980 | 0.9998 / 0.9997 | 0.55 (0.54 / 0.58) | 70.8 / 72.2 %, 32.5 %, 4.7 %, 12 | 0.13 / 0.15 | — |
| `dbt12_c` top10 | 16 | 8 | 30.6 | 50.64 / 50.49 / 50.40 | 248 | 0.9920 / 0.9915 | 0.9988 / 0.9987 | 1.14 (0.95 / 0.98) | 84.0 / 85.8 %, 61.1 %, 27.8 %, 29 | 0.27 / 0.32 | — |
| `dbt12_c` top10 | 16 | 12 | 84.0 | 47.79 / 47.65 / 47.56 | 365 | 0.9847 / 0.9836 | 0.9973 / 0.9970 | 1.58 (1.06 / 1.09) | 87.6 / 89.3 %, 70.2 %, 41.1 %, 45 | 0.44 / 0.52 | — |
| `dbt12_c` top10 | 16 | 16 | 211.7 | 46.49 / 46.30 / 46.29 | 367 | 0.9799 / 0.9786 | 0.9957 / 0.9952 | 1.83 (1.07 / 1.10) | 89.0 / 90.6 %, 73.5 %, 46.4 %, 54 | 0.61 / 0.73 | — |
| `dbt12_c` top10 | 16 | 24 | 624.9 | 45.35 / 45.14 / 45.06 | 508 | 0.9759 / 0.9741 | 0.9933 / 0.9921 | 2.08 (1.07 / 1.10) | 90.2 / 91.7 %, 76.3 %, 50.9 %, 65 | 0.88 / 1.08 | — |
| `dbt12_c` top10 | 16 | 32 | 1602.7 | 44.33 / 44.10 / 44.06 | 572 | 0.9735 / 0.9715 | 0.9903 / 0.9887 | 2.32 (1.08 / 1.11) | 91.4 / 92.7 %, 78.8 %, 54.8 %, 73 | 1.20 / 1.43 | — |
| `dbt12_c` top10 | 16 | 40 | 3326.0 | 43.15 / 42.88 / 42.80 | 769 | 0.9702 / 0.9684 | 0.9865 / 0.9846 | 2.62 (1.08 / 1.11) | 92.4 / 93.5 %, 81.0 %, 58.6 %, 114 | 1.55 / 1.83 | — |
| `dbt12_c` top10 | 16 | 56 | 11981.7 | 39.57 / 38.95 / 38.88 | 1907 | 0.9510 / 0.9464 | 0.9729 / 0.9691 | 3.82 (1.08 / 1.11) | 94.5 / 94.9 %, 85.0 %, 67.3 %, 212 | 2.77 / 3.05 | — |
| `dbt12_c` top10 | 8 | 1 | 5.9 | 65.66 / 65.35 / 65.33 | 69 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.20 / 0.21) | 40.2 / 41.1 %, 4.0 %, 0.0 %, 5 | 0.06 / 0.08 | — |
| `dbt12_c` top10 | 8 | 2 | 7.5 | 62.45 / 62.20 / 62.19 | 90 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 52.9 / 53.8 %, 10.6 %, 0.1 %, 7 | 0.08 / 0.10 | — |
| `dbt12_c` top10 | 8 | 4 | 11.9 | 56.99 / 56.76 / 56.75 | 132 | 0.9982 / 0.9980 | 0.9998 / 0.9997 | 0.55 (0.54 / 0.58) | 70.8 / 72.2 %, 32.5 %, 4.7 %, 13 | 0.13 / 0.15 | — |
| `dbt12_c` top10 | 8 | 8 | 30.5 | 50.64 / 50.45 / 50.40 | 241 | 0.9920 / 0.9915 | 0.9988 / 0.9987 | 1.14 (0.95 / 0.98) | 84.0 / 85.8 %, 61.1 %, 27.8 %, 32 | 0.27 / 0.32 | — |
| `dbt12_c` top10 | 8 | 12 | 83.5 | 47.77 / 47.61 / 47.55 | 365 | 0.9847 / 0.9836 | 0.9973 / 0.9970 | 1.58 (1.06 / 1.09) | 87.6 / 89.3 %, 70.2 %, 41.1 %, 42 | 0.44 / 0.52 | — |
| `dbt12_c` top10 | 8 | 16 | 207.0 | 46.49 / 46.31 / 46.29 | 394 | 0.9799 / 0.9786 | 0.9957 / 0.9952 | 1.83 (1.07 / 1.10) | 89.0 / 90.6 %, 73.5 %, 46.4 %, 57 | 0.61 / 0.73 | — |
| `dbt12_c` top10 | 8 | 24 | 599.5 | 45.36 / 45.12 / 45.06 | 508 | 0.9759 / 0.9741 | 0.9933 / 0.9921 | 2.08 (1.07 / 1.10) | 90.2 / 91.7 %, 76.3 %, 50.9 %, 76 | 0.87 / 1.08 | — |
| `dbt12_c` top10 | 8 | 32 | 1476.9 | 44.34 / 44.10 / 44.06 | 580 | 0.9735 / 0.9714 | 0.9904 / 0.9887 | 2.31 (1.08 / 1.11) | 91.4 / 92.7 %, 78.8 %, 54.8 %, 99 | 1.19 / 1.43 | — |
| `dbt12_c` top10 | 8 | 40 | 2993.3 | 43.17 / 42.90 / 42.84 | 781 | 0.9689 / 0.9676 | 0.9866 / 0.9846 | 2.61 (1.08 / 1.11) | 92.3 / 93.5 %, 81.0 %, 58.5 %, 112 | 1.54 / 1.83 | — |
| `dbt12_c` top10 | 8 | 56 | 10215.7 | 39.72 / 39.06 / 39.01 | 1987 | 0.9498 / 0.9358 | 0.9725 / 0.9694 | 3.76 (1.08 / 1.11) | 94.4 / 94.7 %, 84.6 %, 67.2 %, 199 | 2.73 / 3.04 | — |
| `dbt12_c` window | 1 | 1 | 3.9 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 22.2 / 24.4 %, 16.8 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 1 | 2 | 4.8 | 7.61 / 6.85 / 6.76 | 2491 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 27.4 / 29.4 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 1 | 4 | 6.1 | 7.61 / 6.85 / 6.76 | 2493 | 0.5197 / 0.4218 | 0.8687 / 0.8384 | 6.26 (0.40 / 0.43) | 38.4 / 40.2 %, 17.3 %, 14.2 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 1 | 8 | 8.5 | 7.61 / 6.85 / 6.76 | 2497 | 0.5194 / 0.4215 | 0.8687 / 0.8384 | 6.27 (0.45 / 0.48) | 59.6 / 61.1 %, 23.3 %, 14.4 %, 31 | 4.67 / 5.88 | — |
| `dbt12_c` window | 1 | 12 | 11.1 | 7.61 / 6.85 / 6.76 | 2499 | 0.5189 / 0.4210 | 0.8686 / 0.8383 | 6.28 (0.53 / 0.56) | 72.3 / 73.3 %, 36.0 %, 15.5 %, 32 | 4.67 / 5.89 | — |
| `dbt12_c` window | 1 | 16 | 14.0 | 7.61 / 6.85 / 6.76 | 2506 | 0.5181 / 0.4203 | 0.8685 / 0.8382 | 6.29 (0.63 / 0.66) | 79.2 / 79.9 %, 47.3 %, 18.9 %, 43 | 4.68 / 5.89 | — |
| `dbt12_c` window | 1 | 24 | 21.3 | 7.61 / 6.85 / 6.76 | 2508 | 0.5159 / 0.4183 | 0.8682 / 0.8380 | 6.33 (0.81 / 0.84) | 85.9 / 86.4 %, 61.8 %, 29.4 %, 42 | 4.68 / 5.89 | — |
| `dbt12_c` window | 1 | 32 | 49.6 | 7.61 / 6.84 / 6.76 | 2514 | 0.5101 / 0.4128 | 0.8672 / 0.8372 | 6.40 (1.03 / 1.05) | 90.7 / 91.1 %, 74.0 %, 45.8 %, 73 | 4.69 / 5.91 | — |
| `dbt12_c` window | 1 | 40 | 161.9 | 7.60 / 6.84 / 6.76 | 2526 | 0.5027 / 0.4057 | 0.8653 / 0.8355 | 6.51 (1.07 / 1.10) | 92.8 / 93.1 %, 79.6 %, 55.7 %, 90 | 4.72 / 5.94 | — |
| `dbt12_c` window | 1 | 56 | 1089.6 | 7.60 / 6.84 / 6.76 | 2565 | 0.4965 / 0.4008 | 0.8598 / 0.8308 | 6.70 (1.07 / 1.10) | 94.4 / 94.7 %, 84.2 %, 64.3 %, 147 | 4.87 / 6.10 | — |
| `dbt12_c` window | 16 | 1 | 4.0 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 22.5 / 24.8 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 16 | 2 | 4.8 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 27.5 / 29.7 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 16 | 4 | 6.1 | 7.61 / 6.85 / 6.76 | 2493 | 0.5197 / 0.4218 | 0.8687 / 0.8385 | 6.26 (0.40 / 0.43) | 38.7 / 40.7 %, 17.3 %, 14.2 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 16 | 8 | 8.5 | 7.61 / 6.85 / 6.76 | 2495 | 0.5194 / 0.4215 | 0.8687 / 0.8384 | 6.27 (0.45 / 0.48) | 59.9 / 61.4 %, 23.5 %, 14.4 %, 31 | 4.67 / 5.88 | — |
| `dbt12_c` window | 16 | 12 | 11.1 | 7.61 / 6.85 / 6.76 | 2499 | 0.5188 / 0.4210 | 0.8686 / 0.8383 | 6.28 (0.53 / 0.56) | 72.6 / 73.6 %, 36.4 %, 15.6 %, 31 | 4.67 / 5.89 | — |
| `dbt12_c` window | 16 | 16 | 14.0 | 7.61 / 6.85 / 6.76 | 2500 | 0.5181 / 0.4203 | 0.8685 / 0.8383 | 6.29 (0.63 / 0.66) | 79.3 / 80.0 %, 47.5 %, 19.1 %, 41 | 4.68 / 5.89 | — |
| `dbt12_c` window | 16 | 24 | 21.3 | 7.61 / 6.85 / 6.76 | 2512 | 0.5160 / 0.4184 | 0.8682 / 0.8380 | 6.32 (0.81 / 0.84) | 85.8 / 86.3 %, 61.6 %, 29.3 %, 38 | 4.68 / 5.89 | — |
| `dbt12_c` window | 16 | 32 | 50.1 | 7.61 / 6.84 / 6.76 | 2514 | 0.5105 / 0.4131 | 0.8673 / 0.8372 | 6.40 (1.02 / 1.05) | 90.5 / 91.0 %, 73.9 %, 45.7 %, 63 | 4.69 / 5.90 | — |
| `dbt12_c` window | 16 | 40 | 213.4 | 7.60 / 6.84 / 6.76 | 2511 | 0.5027 / 0.4059 | 0.8653 / 0.8355 | 6.51 (1.07 / 1.10) | 92.8 / 93.1 %, 79.7 %, 55.8 %, 53 | 4.73 / 5.94 | — |
| `dbt12_c` window | 16 | 56 | 2885.2 | 7.60 / 6.84 / 6.76 | 2555 | 0.4965 / 0.4007 | 0.8598 / 0.8307 | 6.69 (1.07 / 1.10) | 94.5 / 94.7 %, 84.3 %, 64.6 %, 111 | 4.86 / 6.10 | — |
| `dbt12_c` window | 8 | 1 | 4.0 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 22.5 / 24.8 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 8 | 2 | 4.8 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 27.5 / 29.7 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 8 | 4 | 6.1 | 7.61 / 6.85 / 6.76 | 2493 | 0.5197 / 0.4218 | 0.8687 / 0.8385 | 6.26 (0.40 / 0.43) | 38.7 / 40.8 %, 17.3 %, 14.2 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 8 | 8 | 8.5 | 7.61 / 6.85 / 6.76 | 2497 | 0.5194 / 0.4215 | 0.8687 / 0.8384 | 6.27 (0.45 / 0.48) | 60.0 / 61.5 %, 23.5 %, 14.4 %, 31 | 4.67 / 5.88 | — |
| `dbt12_c` window | 8 | 12 | 11.1 | 7.61 / 6.85 / 6.76 | 2498 | 0.5188 / 0.4210 | 0.8686 / 0.8383 | 6.28 (0.53 / 0.56) | 72.6 / 73.5 %, 36.4 %, 15.6 %, 32 | 4.67 / 5.89 | — |
| `dbt12_c` window | 8 | 16 | 14.0 | 7.61 / 6.85 / 6.76 | 2504 | 0.5181 / 0.4203 | 0.8685 / 0.8383 | 6.29 (0.63 / 0.66) | 79.3 / 80.0 %, 47.6 %, 19.1 %, 35 | 4.68 / 5.89 | — |
| `dbt12_c` window | 8 | 24 | 21.3 | 7.61 / 6.85 / 6.76 | 2509 | 0.5160 / 0.4184 | 0.8682 / 0.8380 | 6.32 (0.81 / 0.84) | 85.8 / 86.3 %, 61.6 %, 29.4 %, 34 | 4.68 / 5.89 | — |
| `dbt12_c` window | 8 | 32 | 50.1 | 7.61 / 6.84 / 6.76 | 2508 | 0.5105 / 0.4131 | 0.8673 / 0.8372 | 6.40 (1.02 / 1.05) | 90.6 / 91.0 %, 73.9 %, 45.7 %, 43 | 4.69 / 5.90 | — |
| `dbt12_c` window | 8 | 40 | 211.1 | 7.60 / 6.84 / 6.76 | 2518 | 0.5027 / 0.4059 | 0.8653 / 0.8355 | 6.51 (1.07 / 1.10) | 92.8 / 93.1 %, 79.7 %, 55.8 %, 64 | 4.73 / 5.94 | — |
| `dbt12_c` window | 8 | 56 | 2691.3 | 7.60 / 6.84 / 6.76 | 2555 | 0.4965 / 0.4007 | 0.8598 / 0.8307 | 6.69 (1.07 / 1.10) | 94.5 / 94.7 %, 84.3 %, 64.6 %, 103 | 4.86 / 6.10 | — |
| `dbts_a1` 12bit | 1 | 1 | 4.0 | 71.62 / 71.56 / 71.56 | 27 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.12 / 0.12) | 24.3 / 25.0 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a1` 12bit | 1 | 2 | 5.3 | 65.68 / 65.62 / 65.62 | 25 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.23 (0.23 / 0.25) | 46.0 / 47.2 %, 4.7 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a1` 12bit | 1 | 4 | 9.4 | 57.63 / 57.57 / 57.55 | 86 | 0.9983 / 0.9983 | 0.9998 / 0.9998 | 0.57 (0.58 / 0.61) | 73.4 / 74.4 %, 35.6 %, 5.3 %, 12 | 0.12 / 0.15 | 9.96 |
| `dbts_a1` 12bit | 1 | 8 | 34.1 | 50.01 / 49.94 / 49.93 | 242 | 0.9901 / 0.9899 | 0.9985 / 0.9984 | 1.39 (1.00 / 1.01) | 88.1 / 88.7 %, 68.0 %, 36.2 %, 33 | 0.32 / 0.39 | 9.67 |
| `dbts_a1` 12bit | 1 | 12 | 110.1 | 47.45 / 47.41 / 47.39 | 295 | 0.9828 / 0.9821 | 0.9965 / 0.9962 | 1.85 (1.03 / 1.04) | 90.9 / 91.3 %, 75.2 %, 48.1 %, 53 | 0.56 / 0.67 | 9.03 |
| `dbts_a1` 12bit | 1 | 16 | 230.5 | 46.53 / 46.46 / 46.45 | 389 | 0.9795 / 0.9786 | 0.9950 / 0.9944 | 2.04 (1.03 / 1.04) | 91.7 / 92.1 %, 77.4 %, 52.1 %, 82 | 0.75 / 0.92 | 8.36 |
| `dbts_a1` 12bit | 1 | 24 | 442.1 | 45.75 / 45.68 / 45.67 | 551 | 0.9771 / 0.9763 | 0.9930 / 0.9923 | 2.23 (1.03 / 1.05) | 92.4 / 92.7 %, 79.0 %, 55.0 %, 88 | 0.99 / 1.19 | 7.57 |
| `dbts_a1` 12bit | 1 | 32 | 831.9 | 44.74 / 44.61 / 44.59 | 717 | 0.9752 / 0.9742 | 0.9901 / 0.9891 | 2.50 (1.03 / 1.05) | 93.2 / 93.4 %, 81.0 %, 58.5 %, 124 | 1.32 / 1.50 | 6.44 |
| `dbts_a1` 12bit | 1 | 40 | 1460.7 | 43.44 / 43.04 / 43.01 | 1149 | 0.9716 / 0.9691 | 0.9855 / 0.9847 | 2.90 (1.03 / 1.05) | 93.9 / 94.2 %, 82.9 %, 62.4 %, 173 | 1.80 / 1.91 | 5.09 |
| `dbts_a1` 12bit | 1 | 56 | 3928.0 | 39.38 / 38.73 / 38.68 | 1631 | 0.9483 / 0.9324 | 0.9694 / 0.9601 | 4.38 (1.03 / 1.05) | 95.8 / 96.1 %, 88.5 %, 74.2 %, 204 | 3.21 / 3.65 | 1.94 |
| `dbts_a1` 12bit | 16 | 1 | 4.0 | 71.65 / 71.59 / 71.56 | 50 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 24.2 / 25.0 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a1` 12bit | 16 | 2 | 5.4 | 65.20 / 65.10 / 65.09 | 75 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.24 (0.24 / 0.27) | 47.5 / 48.8 %, 5.9 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a1` 12bit | 16 | 4 | 9.4 | 57.59 / 57.54 / 57.54 | 163 | 0.9983 / 0.9983 | 0.9998 / 0.9998 | 0.58 (0.58 / 0.61) | 73.5 / 74.4 %, 35.6 %, 5.3 %, 12 | 0.12 / 0.15 | 9.96 |
| `dbts_a1` 12bit | 16 | 8 | 34.1 | 50.16 / 50.07 / 49.95 | 255 | 0.9905 / 0.9899 | 0.9986 / 0.9984 | 1.36 (0.99 / 1.01) | 87.9 / 88.5 %, 67.6 %, 35.8 %, 32 | 0.32 / 0.38 | 9.68 |
| `dbts_a1` 12bit | 16 | 12 | 142.6 | 47.48 / 47.42 / 47.41 | 274 | 0.9828 / 0.9821 | 0.9966 / 0.9962 | 1.84 (1.03 / 1.04) | 90.9 / 91.3 %, 75.2 %, 48.1 %, 47 | 0.55 / 0.67 | 9.02 |
| `dbts_a1` 12bit | 16 | 16 | 398.5 | 46.53 / 46.44 / 46.42 | 380 | 0.9798 / 0.9788 | 0.9950 / 0.9942 | 2.04 (1.03 / 1.05) | 91.7 / 92.2 %, 77.5 %, 52.3 %, 74 | 0.76 / 0.95 | 8.31 |
| `dbts_a1` 12bit | 16 | 24 | 1057.5 | 45.60 / 45.45 / 45.40 | 454 | 0.9773 / 0.9764 | 0.9925 / 0.9915 | 2.28 (1.03 / 1.05) | 92.6 / 92.9 %, 79.5 %, 55.9 %, 84 | 1.06 / 1.28 | 7.29 |
| `dbts_a1` 12bit | 16 | 32 | 2597.4 | 44.46 / 44.15 / 44.12 | 556 | 0.9750 / 0.9741 | 0.9892 / 0.9880 | 2.59 (1.03 / 1.05) | 93.4 / 93.7 %, 81.7 %, 59.9 %, 129 | 1.45 / 1.65 | 6.06 |
| `dbts_a1` 12bit | 16 | 40 | 5721.6 | 43.02 / 42.17 / 42.09 | 1000 | 0.9721 / 0.9685 | 0.9839 / 0.9809 | 3.07 (1.03 / 1.05) | 94.3 / 94.6 %, 84.2 %, 65.0 %, 163 | 1.95 / 2.21 | 4.47 |
| `dbts_a1` 12bit | 16 | 56 | 20423.6 | 38.77 / 37.52 / 37.44 | 1542 | 0.9516 / 0.9450 | 0.9665 / 0.9503 | 4.73 (1.03 / 1.05) | 96.0 / 96.7 %, 90.2 %, 77.9 %, 203 | 3.45 / 4.38 | 1.4 |
| `dbts_a1` 12bit | 8 | 1 | 4.0 | 71.65 / 71.58 / 71.56 | 47 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 24.2 / 25.0 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a1` 12bit | 8 | 2 | 5.4 | 65.26 / 65.10 / 65.09 | 69 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.24 (0.24 / 0.27) | 47.5 / 48.8 %, 5.9 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a1` 12bit | 8 | 4 | 9.4 | 57.60 / 57.54 / 57.54 | 163 | 0.9983 / 0.9983 | 0.9998 / 0.9998 | 0.58 (0.58 / 0.61) | 73.5 / 74.4 %, 35.6 %, 5.3 %, 12 | 0.12 / 0.15 | 9.96 |
| `dbts_a1` 12bit | 8 | 8 | 34.1 | 50.17 / 50.00 / 49.95 | 246 | 0.9905 / 0.9899 | 0.9986 / 0.9984 | 1.36 (0.99 / 1.01) | 88.0 / 88.5 %, 67.6 %, 35.8 %, 33 | 0.32 / 0.38 | 9.67 |
| `dbts_a1` 12bit | 8 | 12 | 140.5 | 47.48 / 47.41 / 47.41 | 272 | 0.9829 / 0.9821 | 0.9966 / 0.9962 | 1.84 (1.03 / 1.04) | 90.8 / 91.3 %, 75.2 %, 48.1 %, 50 | 0.55 / 0.67 | 9.01 |
| `dbts_a1` 12bit | 8 | 16 | 386.3 | 46.52 / 46.44 / 46.41 | 380 | 0.9797 / 0.9786 | 0.9949 / 0.9942 | 2.05 (1.03 / 1.05) | 91.8 / 92.2 %, 77.5 %, 52.3 %, 61 | 0.76 / 0.95 | 8.31 |
| `dbts_a1` 12bit | 8 | 24 | 1002.1 | 45.63 / 45.43 / 45.40 | 384 | 0.9772 / 0.9761 | 0.9925 / 0.9915 | 2.28 (1.03 / 1.05) | 92.6 / 92.9 %, 79.5 %, 55.9 %, 84 | 1.06 / 1.28 | 7.4 |
| `dbts_a1` 12bit | 8 | 32 | 2393.0 | 44.54 / 44.20 / 44.15 | 556 | 0.9750 / 0.9743 | 0.9892 / 0.9880 | 2.59 (1.03 / 1.05) | 93.3 / 93.8 %, 81.8 %, 60.1 %, 129 | 1.44 / 1.68 | 6.22 |
| `dbts_a1` 12bit | 8 | 40 | 5209.4 | 43.07 / 42.26 / 42.22 | 1000 | 0.9720 / 0.9697 | 0.9843 / 0.9815 | 3.03 (1.03 / 1.05) | 94.2 / 94.5 %, 84.0 %, 64.6 %, 156 | 1.91 / 2.19 | 4.75 |
| `dbts_a1` 12bit | 8 | 56 | 16832.0 | 39.03 / 37.88 / 37.73 | 1619 | 0.9519 / 0.9450 | 0.9671 / 0.9546 | 4.65 (1.03 / 1.05) | 96.0 / 96.5 %, 89.7 %, 76.7 %, 193 | 3.42 / 4.30 | 1.78 |
| `dbts_a1` top10 | 1 | 1 | 4.9 | 64.84 / 64.78 / 64.78 | 43 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.25 / 0.26) | 47.0 / 48.0 %, 7.7 %, 0.0 %, 5 | 0.07 / 0.09 | — |
| `dbts_a1` top10 | 1 | 2 | 6.5 | 61.34 / 61.28 / 61.28 | 33 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.37 (0.38 / 0.40) | 61.6 / 62.7 %, 18.7 %, 0.6 %, 8 | 0.10 / 0.12 | — |
| `dbts_a1` top10 | 1 | 4 | 11.0 | 55.85 / 55.80 / 55.80 | 113 | 0.9975 / 0.9974 | 0.9997 / 0.9996 | 0.71 (0.69 / 0.71) | 77.8 / 78.6 %, 44.2 %, 10.1 %, 16 | 0.16 / 0.19 | — |
| `dbts_a1` top10 | 1 | 8 | 36.8 | 49.73 / 49.66 / 49.65 | 242 | 0.9895 / 0.9894 | 0.9984 / 0.9983 | 1.43 (1.00 / 1.02) | 88.5 / 89.0 %, 69.0 %, 37.6 %, 37 | 0.34 / 0.42 | — |
| `dbts_a1` top10 | 1 | 12 | 103.4 | 47.52 / 47.49 / 47.48 | 294 | 0.9831 / 0.9826 | 0.9966 / 0.9963 | 1.84 (1.03 / 1.05) | 90.8 / 91.2 %, 75.0 %, 47.7 %, 44 | 0.54 / 0.66 | — |
| `dbts_a1` top10 | 1 | 16 | 207.1 | 46.63 / 46.57 / 46.57 | 377 | 0.9802 / 0.9793 | 0.9952 / 0.9946 | 2.02 (1.03 / 1.05) | 91.6 / 92.0 %, 77.2 %, 51.7 %, 58 | 0.73 / 0.89 | — |
| `dbts_a1` top10 | 1 | 24 | 395.8 | 45.91 / 45.83 / 45.82 | 417 | 0.9781 / 0.9773 | 0.9934 / 0.9927 | 2.20 (1.03 / 1.05) | 92.3 / 92.6 %, 78.8 %, 54.5 %, 87 | 0.94 / 1.14 | — |
| `dbts_a1` top10 | 1 | 32 | 727.5 | 45.00 / 44.92 / 44.88 | 640 | 0.9762 / 0.9754 | 0.9909 / 0.9900 | 2.43 (1.04 / 1.06) | 93.1 / 93.2 %, 80.5 %, 57.8 %, 94 | 1.23 / 1.42 | — |
| `dbts_a1` top10 | 1 | 40 | 1240.9 | 43.95 / 43.60 / 43.56 | 913 | 0.9730 / 0.9717 | 0.9872 / 0.9865 | 2.77 (1.04 / 1.05) | 93.6 / 93.9 %, 82.3 %, 61.2 %, 149 | 1.64 / 1.76 | — |
| `dbts_a1` top10 | 1 | 56 | 3307.7 | 40.66 / 39.95 / 39.90 | 1641 | 0.9584 / 0.9515 | 0.9746 / 0.9673 | 3.91 (1.04 / 1.05) | 95.4 / 95.6 %, 87.2 %, 71.7 %, 213 | 2.80 / 3.12 | — |
| `dbts_a1` top10 | 16 | 1 | 5.0 | 64.47 / 64.37 / 64.36 | 62 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.26 (0.25 / 0.27) | 48.4 / 49.5 %, 8.6 %, 0.0 %, 5 | 0.08 / 0.10 | — |
| `dbts_a1` top10 | 16 | 2 | 6.5 | 61.28 / 61.21 / 61.21 | 75 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.38 (0.38 / 0.40) | 61.7 / 62.9 %, 18.9 %, 0.6 %, 8 | 0.10 / 0.12 | — |
| `dbts_a1` top10 | 16 | 4 | 10.9 | 55.81 / 55.76 / 55.75 | 129 | 0.9975 / 0.9974 | 0.9997 / 0.9996 | 0.71 (0.69 / 0.71) | 78.0 / 78.7 %, 44.3 %, 10.2 %, 16 | 0.16 / 0.20 | — |
| `dbts_a1` top10 | 16 | 8 | 36.9 | 49.86 / 49.78 / 49.68 | 200 | 0.9899 / 0.9894 | 0.9984 / 0.9983 | 1.41 (1.00 / 1.02) | 88.3 / 88.9 %, 68.6 %, 37.2 %, 32 | 0.34 / 0.42 | — |
| `dbts_a1` top10 | 16 | 12 | 135.1 | 47.50 / 47.44 / 47.43 | 298 | 0.9832 / 0.9825 | 0.9966 / 0.9962 | 1.84 (1.03 / 1.05) | 90.8 / 91.3 %, 75.1 %, 47.9 %, 46 | 0.56 / 0.69 | — |
| `dbts_a1` top10 | 16 | 16 | 337.8 | 46.66 / 46.57 / 46.54 | 377 | 0.9803 / 0.9794 | 0.9952 / 0.9945 | 2.02 (1.03 / 1.05) | 91.6 / 92.0 %, 77.3 %, 51.8 %, 57 | 0.73 / 0.91 | — |
| `dbts_a1` top10 | 16 | 24 | 860.1 | 45.81 / 45.70 / 45.68 | 369 | 0.9780 / 0.9772 | 0.9932 / 0.9923 | 2.22 (1.04 / 1.05) | 92.4 / 92.7 %, 79.1 %, 55.0 %, 85 | 0.98 / 1.20 | — |
| `dbts_a1` top10 | 16 | 32 | 2039.5 | 44.90 / 44.70 / 44.66 | 507 | 0.9762 / 0.9755 | 0.9905 / 0.9894 | 2.48 (1.04 / 1.05) | 93.2 / 93.4 %, 80.9 %, 58.4 %, 126 | 1.29 / 1.48 | — |
| `dbts_a1` top10 | 16 | 40 | 4275.8 | 43.71 / 43.20 / 43.15 | 674 | 0.9730 / 0.9707 | 0.9865 / 0.9853 | 2.82 (1.04 / 1.06) | 93.8 / 94.1 %, 82.9 %, 62.3 %, 154 | 1.73 / 1.90 | — |
| `dbts_a1` top10 | 16 | 56 | 15190.9 | 40.26 / 39.25 / 39.22 | 1466 | 0.9602 / 0.9515 | 0.9721 / 0.9636 | 4.11 (1.04 / 1.05) | 95.6 / 95.9 %, 88.0 %, 73.2 %, 176 | 2.92 / 3.45 | — |
| `dbts_a1` top10 | 8 | 1 | 5.0 | 64.52 / 64.37 / 64.37 | 66 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.26 (0.25 / 0.27) | 48.4 / 49.5 %, 8.6 %, 0.0 %, 7 | 0.08 / 0.10 | — |
| `dbts_a1` top10 | 8 | 2 | 6.5 | 61.30 / 61.21 / 61.21 | 112 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.38 (0.38 / 0.40) | 61.7 / 62.9 %, 18.9 %, 0.6 %, 8 | 0.10 / 0.12 | — |
| `dbts_a1` top10 | 8 | 4 | 10.9 | 55.82 / 55.76 / 55.75 | 131 | 0.9975 / 0.9974 | 0.9997 / 0.9996 | 0.71 (0.69 / 0.71) | 77.9 / 78.7 %, 44.3 %, 10.2 %, 21 | 0.16 / 0.20 | — |
| `dbts_a1` top10 | 8 | 8 | 36.9 | 49.86 / 49.72 / 49.66 | 230 | 0.9899 / 0.9894 | 0.9984 / 0.9983 | 1.41 (1.00 / 1.02) | 88.3 / 88.9 %, 68.6 %, 37.2 %, 32 | 0.34 / 0.42 | — |
| `dbts_a1` top10 | 8 | 12 | 133.2 | 47.51 / 47.44 / 47.43 | 285 | 0.9832 / 0.9825 | 0.9966 / 0.9962 | 1.84 (1.03 / 1.05) | 90.8 / 91.3 %, 75.1 %, 47.9 %, 46 | 0.56 / 0.69 | — |
| `dbts_a1` top10 | 8 | 16 | 329.7 | 46.65 / 46.57 / 46.54 | 377 | 0.9803 / 0.9794 | 0.9952 / 0.9945 | 2.02 (1.03 / 1.05) | 91.7 / 92.0 %, 77.3 %, 51.8 %, 61 | 0.73 / 0.91 | — |
| `dbts_a1` top10 | 8 | 24 | 816.3 | 45.83 / 45.71 / 45.69 | 369 | 0.9780 / 0.9772 | 0.9932 / 0.9924 | 2.22 (1.04 / 1.05) | 92.4 / 92.7 %, 79.1 %, 55.0 %, 91 | 0.98 / 1.20 | — |
| `dbts_a1` top10 | 8 | 32 | 1880.9 | 44.91 / 44.72 / 44.68 | 464 | 0.9762 / 0.9755 | 0.9905 / 0.9895 | 2.47 (1.04 / 1.05) | 93.1 / 93.4 %, 80.9 %, 58.4 %, 126 | 1.27 / 1.49 | — |
| `dbts_a1` top10 | 8 | 40 | 3876.4 | 43.75 / 43.25 / 43.17 | 741 | 0.9730 / 0.9708 | 0.9866 / 0.9851 | 2.82 (1.04 / 1.06) | 93.8 / 94.1 %, 82.8 %, 62.2 %, 137 | 1.72 / 1.90 | — |
| `dbts_a1` top10 | 8 | 56 | 13115.2 | 40.27 / 39.38 / 39.34 | 1466 | 0.9600 / 0.9515 | 0.9723 / 0.9647 | 4.09 (1.04 / 1.05) | 95.5 / 95.8 %, 87.9 %, 72.9 %, 175 | 2.90 / 3.36 | — |
| `dbts_a1` window | 1 | 1 | 2.9 | 13.21 / 12.04 / 11.91 | 1601 | 0.6843 / 0.5760 | 0.9236 / 0.9004 | 3.57 (0.34 / 0.39) | 17.7 / 21.5 %, 13.1 %, 10.4 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 1 | 2 | 3.6 | 13.21 / 12.04 / 11.91 | 1602 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.35 / 0.39) | 23.4 / 27.0 %, 13.2 %, 10.5 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 1 | 4 | 4.5 | 13.21 / 12.04 / 11.91 | 1604 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.36 / 0.40) | 35.1 / 38.6 %, 13.5 %, 10.6 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 1 | 8 | 6.4 | 13.21 / 12.04 / 11.91 | 1610 | 0.6840 / 0.5756 | 0.9236 / 0.9003 | 3.58 (0.43 / 0.46) | 58.3 / 60.9 %, 21.0 %, 10.9 %, 31 | 2.05 / 2.40 | — |
| `dbts_a1` window | 1 | 12 | 8.4 | 13.21 / 12.04 / 11.91 | 1611 | 0.6834 / 0.5751 | 0.9235 / 0.9003 | 3.60 (0.54 / 0.56) | 71.7 / 73.5 %, 35.5 %, 12.4 %, 33 | 2.05 / 2.40 | — |
| `dbts_a1` window | 1 | 16 | 10.7 | 13.21 / 12.04 / 11.91 | 1613 | 0.6826 / 0.5744 | 0.9234 / 0.9002 | 3.63 (0.66 / 0.68) | 78.8 / 80.2 %, 47.6 %, 16.8 %, 33 | 2.05 / 2.40 | — |
| `dbts_a1` window | 1 | 24 | 16.8 | 13.21 / 12.04 / 11.91 | 1619 | 0.6804 / 0.5724 | 0.9231 / 0.8999 | 3.69 (0.86 / 0.87) | 85.9 / 86.8 %, 62.8 %, 29.4 %, 33 | 2.06 / 2.41 | — |
| `dbts_a1` window | 1 | 32 | 41.9 | 13.21 / 12.04 / 11.91 | 1621 | 0.6750 / 0.5670 | 0.9220 / 0.8990 | 3.86 (1.01 / 1.02) | 90.8 / 91.3 %, 74.7 %, 46.4 %, 53 | 2.09 / 2.43 | — |
| `dbts_a1` window | 1 | 40 | 144.7 | 13.21 / 12.04 / 11.91 | 1628 | 0.6687 / 0.5610 | 0.9199 / 0.8973 | 4.06 (1.03 / 1.05) | 92.8 / 93.2 %, 80.0 %, 56.0 %, 58 | 2.16 / 2.48 | — |
| `dbts_a1` window | 1 | 56 | 906.4 | 13.20 / 12.03 / 11.90 | 1660 | 0.6641 / 0.5576 | 0.9146 / 0.8934 | 4.35 (1.03 / 1.05) | 94.2 / 94.7 %, 84.2 %, 64.3 %, 106 | 2.47 / 2.74 | — |
| `dbts_a1` window | 16 | 1 | 3.0 | 13.21 / 12.04 / 11.91 | 1601 | 0.6843 / 0.5760 | 0.9236 / 0.9004 | 3.57 (0.34 / 0.39) | 18.1 / 22.0 %, 13.1 %, 10.4 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 16 | 2 | 3.6 | 13.21 / 12.04 / 11.91 | 1602 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.35 / 0.39) | 23.7 / 27.3 %, 13.2 %, 10.5 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 16 | 4 | 4.5 | 13.21 / 12.04 / 11.91 | 1603 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.36 / 0.40) | 35.5 / 39.1 %, 13.6 %, 10.6 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 16 | 8 | 6.4 | 13.21 / 12.04 / 11.91 | 1606 | 0.6840 / 0.5756 | 0.9236 / 0.9004 | 3.58 (0.43 / 0.46) | 58.6 / 61.2 %, 21.3 %, 10.8 %, 31 | 2.05 / 2.40 | — |
| `dbts_a1` window | 16 | 12 | 8.3 | 13.21 / 12.04 / 11.91 | 1607 | 0.6834 / 0.5751 | 0.9235 / 0.9003 | 3.60 (0.54 / 0.56) | 71.9 / 73.8 %, 35.8 %, 12.4 %, 32 | 2.05 / 2.40 | — |
| `dbts_a1` window | 16 | 16 | 10.6 | 13.21 / 12.04 / 11.91 | 1610 | 0.6826 / 0.5744 | 0.9234 / 0.9002 | 3.63 (0.66 / 0.68) | 79.0 / 80.3 %, 47.8 %, 16.9 %, 32 | 2.05 / 2.40 | — |
| `dbts_a1` window | 16 | 24 | 16.6 | 13.21 / 12.04 / 11.91 | 1618 | 0.6805 / 0.5724 | 0.9231 / 0.8999 | 3.69 (0.85 / 0.87) | 85.9 / 86.8 %, 62.6 %, 29.2 %, 33 | 2.06 / 2.41 | — |
| `dbts_a1` window | 16 | 32 | 41.6 | 13.21 / 12.04 / 11.91 | 1623 | 0.6754 / 0.5674 | 0.9221 / 0.8991 | 3.85 (1.00 / 1.02) | 90.6 / 91.3 %, 74.6 %, 46.4 %, 34 | 2.09 / 2.43 | — |
| `dbts_a1` window | 16 | 40 | 196.0 | 13.21 / 12.04 / 11.91 | 1628 | 0.6689 / 0.5610 | 0.9198 / 0.8972 | 4.06 (1.03 / 1.05) | 92.8 / 93.2 %, 80.0 %, 56.0 %, 50 | 2.16 / 2.49 | — |
| `dbts_a1` window | 16 | 56 | 2295.5 | 13.21 / 12.03 / 11.91 | 1646 | 0.6638 / 0.5575 | 0.9146 / 0.8933 | 4.34 (1.03 / 1.05) | 94.2 / 94.7 %, 84.3 %, 64.4 %, 126 | 2.47 / 2.75 | — |
| `dbts_a1` window | 8 | 1 | 3.0 | 13.21 / 12.04 / 11.91 | 1601 | 0.6843 / 0.5760 | 0.9236 / 0.9004 | 3.57 (0.34 / 0.39) | 18.1 / 21.9 %, 13.1 %, 10.4 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 8 | 2 | 3.6 | 13.21 / 12.04 / 11.91 | 1602 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.35 / 0.39) | 23.7 / 27.3 %, 13.2 %, 10.5 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 8 | 4 | 4.5 | 13.21 / 12.04 / 11.91 | 1603 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.36 / 0.40) | 35.5 / 39.0 %, 13.5 %, 10.6 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 8 | 8 | 6.4 | 13.21 / 12.04 / 11.91 | 1605 | 0.6840 / 0.5756 | 0.9236 / 0.9004 | 3.58 (0.43 / 0.46) | 58.6 / 61.2 %, 21.3 %, 10.8 %, 31 | 2.05 / 2.40 | — |
| `dbts_a1` window | 8 | 12 | 8.3 | 13.21 / 12.04 / 11.91 | 1608 | 0.6834 / 0.5751 | 0.9235 / 0.9003 | 3.60 (0.54 / 0.56) | 72.0 / 73.7 %, 35.8 %, 12.4 %, 32 | 2.05 / 2.40 | — |
| `dbts_a1` window | 8 | 16 | 10.6 | 13.21 / 12.04 / 11.91 | 1610 | 0.6826 / 0.5744 | 0.9234 / 0.9002 | 3.63 (0.66 / 0.68) | 78.9 / 80.3 %, 47.9 %, 16.9 %, 32 | 2.05 / 2.40 | — |
| `dbts_a1` window | 8 | 24 | 16.6 | 13.21 / 12.04 / 11.91 | 1617 | 0.6805 / 0.5724 | 0.9231 / 0.8999 | 3.69 (0.85 / 0.87) | 85.9 / 86.8 %, 62.6 %, 29.2 %, 33 | 2.06 / 2.41 | — |
| `dbts_a1` window | 8 | 32 | 41.7 | 13.21 / 12.04 / 11.91 | 1623 | 0.6754 / 0.5674 | 0.9220 / 0.8991 | 3.85 (1.00 / 1.02) | 90.6 / 91.3 %, 74.6 %, 46.4 %, 33 | 2.09 / 2.43 | — |
| `dbts_a1` window | 8 | 40 | 193.2 | 13.21 / 12.04 / 11.91 | 1627 | 0.6689 / 0.5610 | 0.9198 / 0.8972 | 4.06 (1.03 / 1.05) | 92.8 / 93.2 %, 80.0 %, 55.9 %, 58 | 2.16 / 2.48 | — |
| `dbts_a1` window | 8 | 56 | 2154.7 | 13.21 / 12.03 / 11.91 | 1692 | 0.6639 / 0.5575 | 0.9146 / 0.8933 | 4.34 (1.03 / 1.05) | 94.3 / 94.7 %, 84.3 %, 64.5 %, 126 | 2.47 / 2.74 | — |
| `dbts_c2` 12bit | 1 | 1 | 3.6 | 71.60 / 71.39 / 71.37 | 29 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.09) | 26.2 / 27.0 %, 0.3 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbts_c2` 12bit | 1 | 2 | 4.6 | 65.68 / 65.47 / 65.45 | 33 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.17 (0.17 / 0.18) | 47.8 / 49.1 %, 6.8 %, 0.0 %, 5 | 0.04 / 0.05 | 10.0 |
| `dbts_c2` 12bit | 1 | 4 | 7.8 | 57.70 / 57.49 / 57.45 | 79 | 0.9984 / 0.9983 | 0.9998 / 0.9998 | 0.43 (0.44 / 0.46) | 73.2 / 74.9 %, 38.2 %, 7.4 %, 14 | 0.11 / 0.12 | 9.96 |
| `dbts_c2` 12bit | 1 | 8 | 20.7 | 49.72 / 49.57 / 49.54 | 251 | 0.9898 / 0.9891 | 0.9986 / 0.9984 | 1.08 (0.94 / 0.95) | 87.1 / 88.7 %, 69.0 %, 39.9 %, 37 | 0.28 / 0.31 | 9.7 |
| `dbts_c2` 12bit | 1 | 12 | 60.6 | 46.25 / 46.17 / 46.15 | 343 | 0.9777 / 0.9766 | 0.9962 / 0.9958 | 1.61 (1.08 / 1.09) | 90.3 / 91.8 %, 77.0 %, 53.3 %, 62 | 0.49 / 0.55 | 9.1 |
| `dbts_c2` 12bit | 1 | 16 | 130.3 | 44.98 / 44.84 / 44.83 | 383 | 0.9708 / 0.9690 | 0.9939 / 0.9931 | 1.86 (1.09 / 1.10) | 91.3 / 92.8 %, 79.7 %, 58.1 %, 76 | 0.69 / 0.77 | 8.35 |
| `dbts_c2` 12bit | 1 | 24 | 297.6 | 43.89 / 43.82 / 43.81 | 777 | 0.9642 / 0.9626 | 0.9904 / 0.9893 | 2.08 (1.09 / 1.10) | 92.4 / 93.5 %, 81.7 %, 61.6 %, 85 | 1.00 / 1.12 | 7.22 |
| `dbts_c2` 12bit | 1 | 32 | 616.1 | 42.96 / 42.81 / 42.79 | 931 | 0.9615 / 0.9596 | 0.9861 / 0.9850 | 2.32 (1.09 / 1.10) | 93.4 / 94.2 %, 83.4 %, 64.5 %, 133 | 1.37 / 1.51 | 5.94 |
| `dbts_c2` 12bit | 1 | 40 | 1162.5 | 41.81 / 41.44 / 41.41 | 1436 | 0.9575 / 0.9530 | 0.9800 / 0.9783 | 2.64 (1.09 / 1.10) | 94.4 / 94.8 %, 85.1 %, 67.9 %, 140 | 1.82 / 1.91 | 4.57 |
| `dbts_c2` 12bit | 1 | 56 | 3628.0 | 37.87 / 37.50 / 37.41 | 2301 | 0.9407 / 0.9128 | 0.9562 / 0.9494 | 3.88 (1.09 / 1.10) | 96.3 / 96.7 %, 90.1 %, 77.5 %, 203 | 3.34 / 3.48 | 1.76 |
| `dbts_c2` 12bit | 16 | 1 | 3.6 | 71.62 / 71.42 / 71.37 | 56 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.09) | 26.2 / 27.0 %, 0.3 %, 0.0 %, 8 | 0.02 / 0.03 | 10.0 |
| `dbts_c2` 12bit | 16 | 2 | 4.8 | 65.21 / 64.97 / 64.96 | 68 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.20) | 49.2 / 50.4 %, 8.1 %, 0.0 %, 9 | 0.05 / 0.05 | 10.0 |
| `dbts_c2` 12bit | 16 | 4 | 7.8 | 57.65 / 57.45 / 57.42 | 148 | 0.9984 / 0.9983 | 0.9998 / 0.9998 | 0.43 (0.44 / 0.46) | 73.3 / 75.0 %, 38.3 %, 7.6 %, 17 | 0.11 / 0.12 | 9.96 |
| `dbts_c2` 12bit | 16 | 8 | 20.8 | 49.83 / 49.67 / 49.56 | 314 | 0.9903 / 0.9891 | 0.9986 / 0.9984 | 1.07 (0.93 / 0.94) | 87.0 / 88.7 %, 69.0 %, 39.8 %, 38 | 0.28 / 0.32 | 9.7 |
| `dbts_c2` 12bit | 16 | 12 | 66.0 | 46.41 / 46.27 / 46.17 | 286 | 0.9786 / 0.9767 | 0.9963 / 0.9958 | 1.58 (1.08 / 1.09) | 90.2 / 91.8 %, 77.0 %, 53.3 %, 57 | 0.49 / 0.56 | 9.13 |
| `dbts_c2` 12bit | 16 | 16 | 188.8 | 45.01 / 44.88 / 44.82 | 394 | 0.9712 / 0.9690 | 0.9939 / 0.9930 | 1.85 (1.09 / 1.10) | 91.4 / 92.8 %, 79.7 %, 58.1 %, 73 | 0.69 / 0.79 | 8.33 |
| `dbts_c2` 12bit | 16 | 24 | 682.8 | 43.73 / 43.59 / 43.54 | 563 | 0.9652 / 0.9624 | 0.9897 / 0.9882 | 2.13 (1.09 / 1.10) | 92.4 / 93.8 %, 82.2 %, 62.5 %, 106 | 1.09 / 1.25 | 7.0 |
| `dbts_c2` 12bit | 16 | 32 | 1950.2 | 42.67 / 42.42 / 42.40 | 645 | 0.9613 / 0.9603 | 0.9846 / 0.9830 | 2.41 (1.09 / 1.10) | 93.6 / 94.4 %, 83.9 %, 65.5 %, 140 | 1.51 / 1.65 | 5.65 |
| `dbts_c2` 12bit | 16 | 40 | 4689.4 | 41.36 / 40.81 / 40.74 | 960 | 0.9576 / 0.9547 | 0.9777 / 0.9745 | 2.80 (1.09 / 1.10) | 94.8 / 95.1 %, 86.1 %, 69.8 %, 147 | 2.05 / 2.18 | 4.25 |
| `dbts_c2` 12bit | 16 | 56 | 19497.5 | 37.36 / 36.61 / 36.52 | 2138 | 0.9379 / 0.9238 | 0.9541 / 0.9428 | 4.09 (1.09 / 1.10) | 96.3 / 96.8 %, 90.7 %, 79.5 %, 176 | 3.59 / 4.12 | 1.31 |
| `dbts_c2` 12bit | 8 | 1 | 3.6 | 71.62 / 71.42 / 71.37 | 53 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.09) | 26.2 / 27.0 %, 0.3 %, 0.0 %, 8 | 0.02 / 0.03 | 10.0 |
| `dbts_c2` 12bit | 8 | 2 | 4.8 | 65.25 / 64.97 / 64.96 | 68 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.20) | 49.1 / 50.4 %, 8.1 %, 0.0 %, 9 | 0.05 / 0.05 | 10.0 |
| `dbts_c2` 12bit | 8 | 4 | 7.8 | 57.64 / 57.45 / 57.42 | 148 | 0.9984 / 0.9983 | 0.9998 / 0.9998 | 0.43 (0.44 / 0.46) | 73.3 / 75.0 %, 38.3 %, 7.6 %, 17 | 0.11 / 0.12 | 9.96 |
| `dbts_c2` 12bit | 8 | 8 | 20.8 | 49.83 / 49.67 / 49.56 | 314 | 0.9902 / 0.9891 | 0.9986 / 0.9984 | 1.07 (0.93 / 0.94) | 87.1 / 88.7 %, 69.0 %, 39.8 %, 38 | 0.29 / 0.32 | 9.7 |
| `dbts_c2` 12bit | 8 | 12 | 65.8 | 46.41 / 46.23 / 46.17 | 286 | 0.9786 / 0.9767 | 0.9963 / 0.9958 | 1.58 (1.08 / 1.09) | 90.3 / 91.8 %, 77.0 %, 53.3 %, 56 | 0.49 / 0.56 | 9.1 |
| `dbts_c2` 12bit | 8 | 16 | 185.4 | 44.99 / 44.88 / 44.82 | 394 | 0.9712 / 0.9690 | 0.9939 / 0.9930 | 1.85 (1.09 / 1.10) | 91.4 / 92.8 %, 79.7 %, 58.1 %, 74 | 0.69 / 0.79 | 8.31 |
| `dbts_c2` 12bit | 8 | 24 | 656.3 | 43.78 / 43.57 / 43.54 | 659 | 0.9651 / 0.9624 | 0.9897 / 0.9882 | 2.13 (1.09 / 1.10) | 92.4 / 93.8 %, 82.2 %, 62.5 %, 97 | 1.09 / 1.25 | 7.05 |
| `dbts_c2` 12bit | 8 | 32 | 1784.3 | 42.72 / 42.47 / 42.38 | 680 | 0.9613 / 0.9603 | 0.9849 / 0.9831 | 2.39 (1.09 / 1.10) | 93.5 / 94.4 %, 83.9 %, 65.5 %, 140 | 1.49 / 1.65 | 5.76 |
| `dbts_c2` 12bit | 8 | 40 | 4210.2 | 41.44 / 40.89 / 40.76 | 960 | 0.9578 / 0.9547 | 0.9779 / 0.9746 | 2.77 (1.09 / 1.10) | 94.8 / 95.3 %, 86.1 %, 69.7 %, 147 | 2.01 / 2.15 | 4.32 |
| `dbts_c2` 12bit | 8 | 56 | 16178.5 | 37.72 / 36.82 / 36.63 | 2291 | 0.9434 / 0.9259 | 0.9549 / 0.9437 | 4.00 (1.09 / 1.10) | 96.3 / 96.8 %, 90.7 %, 78.9 %, 205 | 3.43 / 4.02 | 1.62 |
| `dbts_c2` top10 | 1 | 1 | 4.3 | 64.80 / 64.60 / 64.59 | 33 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.20) | 48.7 / 49.5 %, 10.4 %, 0.1 %, 6 | 0.07 / 0.07 | — |
| `dbts_c2` top10 | 1 | 2 | 5.6 | 61.35 / 61.14 / 61.12 | 44 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.28 (0.28 / 0.30) | 62.6 / 63.7 %, 22.2 %, 1.3 %, 9 | 0.09 / 0.10 | — |
| `dbts_c2` top10 | 1 | 4 | 8.8 | 55.92 / 55.73 / 55.70 | 128 | 0.9976 / 0.9974 | 0.9997 / 0.9997 | 0.53 (0.52 / 0.55) | 77.7 / 79.0 %, 46.4 %, 13.0 %, 16 | 0.14 / 0.16 | — |
| `dbts_c2` top10 | 1 | 8 | 22.0 | 49.38 / 49.24 / 49.22 | 263 | 0.9892 / 0.9885 | 0.9985 / 0.9983 | 1.12 (0.96 / 0.96) | 87.8 / 89.1 %, 70.0 %, 41.5 %, 38 | 0.30 / 0.34 | — |
| `dbts_c2` top10 | 1 | 12 | 56.6 | 46.37 / 46.30 / 46.28 | 307 | 0.9785 / 0.9777 | 0.9963 / 0.9960 | 1.59 (1.08 / 1.09) | 90.5 / 91.7 %, 76.8 %, 52.9 %, 57 | 0.49 / 0.54 | — |
| `dbts_c2` top10 | 1 | 16 | 113.8 | 45.16 / 45.03 / 45.01 | 383 | 0.9721 / 0.9704 | 0.9943 / 0.9936 | 1.82 (1.09 / 1.10) | 91.4 / 92.7 %, 79.4 %, 57.5 %, 70 | 0.66 / 0.74 | — |
| `dbts_c2` top10 | 1 | 24 | 260.0 | 44.09 / 44.01 / 43.99 | 660 | 0.9666 / 0.9650 | 0.9911 / 0.9900 | 2.05 (1.09 / 1.10) | 92.3 / 93.5 %, 81.5 %, 61.2 %, 84 | 0.95 / 1.06 | — |
| `dbts_c2` top10 | 1 | 32 | 531.1 | 43.20 / 43.07 / 43.05 | 927 | 0.9631 / 0.9615 | 0.9872 / 0.9861 | 2.27 (1.10 / 1.10) | 93.3 / 94.1 %, 83.1 %, 64.0 %, 133 | 1.28 / 1.42 | — |
| `dbts_c2` top10 | 1 | 40 | 965.2 | 42.24 / 41.98 / 41.95 | 1440 | 0.9589 / 0.9570 | 0.9821 / 0.9806 | 2.53 (1.10 / 1.10) | 94.3 / 94.7 %, 84.6 %, 66.8 %, 129 | 1.67 / 1.79 | — |
| `dbts_c2` top10 | 1 | 56 | 2851.9 | 39.14 / 38.65 / 38.61 | 2152 | 0.9422 / 0.9318 | 0.9638 / 0.9583 | 3.45 (1.10 / 1.10) | 95.8 / 96.2 %, 88.7 %, 75.1 %, 183 | 2.85 / 2.97 | — |
| `dbts_c2` top10 | 16 | 1 | 4.4 | 64.44 / 64.21 / 64.21 | 64 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.19 / 0.20) | 50.0 / 50.9 %, 11.5 %, 0.1 %, 9 | 0.07 / 0.08 | — |
| `dbts_c2` top10 | 16 | 2 | 5.6 | 61.26 / 61.06 / 61.04 | 82 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.29 (0.28 / 0.30) | 62.9 / 63.9 %, 22.4 %, 1.4 %, 11 | 0.09 / 0.10 | — |
| `dbts_c2` top10 | 16 | 4 | 8.8 | 55.84 / 55.65 / 55.63 | 247 | 0.9976 / 0.9974 | 0.9997 / 0.9996 | 0.53 (0.53 / 0.55) | 77.9 / 79.1 %, 46.6 %, 13.2 %, 20 | 0.15 / 0.16 | — |
| `dbts_c2` top10 | 16 | 8 | 22.2 | 49.46 / 49.33 / 49.22 | 217 | 0.9895 / 0.9885 | 0.9985 / 0.9983 | 1.11 (0.95 / 0.96) | 87.9 / 89.1 %, 70.0 %, 41.4 %, 36 | 0.31 / 0.34 | — |
| `dbts_c2` top10 | 16 | 12 | 61.3 | 46.49 / 46.37 / 46.31 | 291 | 0.9792 / 0.9777 | 0.9964 / 0.9960 | 1.57 (1.08 / 1.09) | 90.5 / 91.7 %, 76.8 %, 52.9 %, 56 | 0.50 / 0.56 | — |
| `dbts_c2` top10 | 16 | 16 | 159.7 | 45.15 / 45.02 / 45.00 | 352 | 0.9723 / 0.9704 | 0.9942 / 0.9935 | 1.82 (1.09 / 1.10) | 91.4 / 92.7 %, 79.4 %, 57.6 %, 70 | 0.68 / 0.77 | — |
| `dbts_c2` top10 | 16 | 24 | 521.0 | 44.02 / 43.91 / 43.83 | 516 | 0.9665 / 0.9647 | 0.9908 / 0.9893 | 2.06 (1.09 / 1.10) | 92.4 / 93.6 %, 81.7 %, 61.7 %, 89 | 0.98 / 1.14 | — |
| `dbts_c2` top10 | 16 | 32 | 1468.6 | 43.05 / 42.90 / 42.86 | 546 | 0.9628 / 0.9618 | 0.9866 / 0.9854 | 2.31 (1.10 / 1.11) | 93.4 / 94.2 %, 83.3 %, 64.3 %, 123 | 1.35 / 1.49 | — |
| `dbts_c2` top10 | 16 | 40 | 3341.0 | 42.04 / 41.67 / 41.61 | 771 | 0.9590 / 0.9574 | 0.9810 / 0.9791 | 2.60 (1.10 / 1.11) | 94.5 / 94.8 %, 85.1 %, 67.8 %, 151 | 1.76 / 1.86 | — |
| `dbts_c2` top10 | 16 | 56 | 13760.6 | 38.68 / 38.08 / 37.97 | 2150 | 0.9438 / 0.9408 | 0.9612 / 0.9553 | 3.59 (1.10 / 1.10) | 96.1 / 96.5 %, 89.4 %, 76.5 %, 185 | 2.99 / 3.29 | — |
| `dbts_c2` top10 | 8 | 1 | 4.4 | 64.48 / 64.21 / 64.21 | 68 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.19 / 0.20) | 50.0 / 50.9 %, 11.5 %, 0.1 %, 8 | 0.07 / 0.08 | — |
| `dbts_c2` top10 | 8 | 2 | 5.6 | 61.27 / 61.06 / 61.04 | 80 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.29 (0.28 / 0.30) | 62.9 / 63.9 %, 22.4 %, 1.4 %, 11 | 0.09 / 0.10 | — |
| `dbts_c2` top10 | 8 | 4 | 8.8 | 55.86 / 55.65 / 55.63 | 161 | 0.9976 / 0.9974 | 0.9997 / 0.9996 | 0.53 (0.53 / 0.55) | 77.8 / 79.1 %, 46.6 %, 13.2 %, 20 | 0.15 / 0.16 | — |
| `dbts_c2` top10 | 8 | 8 | 22.2 | 49.47 / 49.32 / 49.22 | 203 | 0.9895 / 0.9885 | 0.9985 / 0.9983 | 1.11 (0.95 / 0.96) | 87.9 / 89.1 %, 70.0 %, 41.4 %, 37 | 0.31 / 0.34 | — |
| `dbts_c2` top10 | 8 | 12 | 61.0 | 46.49 / 46.35 / 46.31 | 287 | 0.9791 / 0.9777 | 0.9964 / 0.9960 | 1.57 (1.08 / 1.09) | 90.5 / 91.7 %, 76.8 %, 52.9 %, 56 | 0.50 / 0.56 | — |
| `dbts_c2` top10 | 8 | 16 | 156.9 | 45.16 / 45.02 / 45.00 | 353 | 0.9723 / 0.9704 | 0.9942 / 0.9935 | 1.82 (1.09 / 1.10) | 91.4 / 92.7 %, 79.4 %, 57.6 %, 68 | 0.68 / 0.77 | — |
| `dbts_c2` top10 | 8 | 24 | 504.5 | 44.03 / 43.90 / 43.83 | 660 | 0.9664 / 0.9647 | 0.9908 / 0.9893 | 2.06 (1.09 / 1.10) | 92.4 / 93.6 %, 81.7 %, 61.7 %, 79 | 0.98 / 1.14 | — |
| `dbts_c2` top10 | 8 | 32 | 1360.3 | 43.07 / 42.90 / 42.88 | 660 | 0.9629 / 0.9618 | 0.9866 / 0.9854 | 2.30 (1.10 / 1.11) | 93.4 / 94.2 %, 83.3 %, 64.3 %, 126 | 1.35 / 1.49 | — |
| `dbts_c2` top10 | 8 | 40 | 3014.7 | 42.02 / 41.70 / 41.66 | 771 | 0.9591 / 0.9574 | 0.9812 / 0.9789 | 2.58 (1.10 / 1.11) | 94.3 / 94.9 %, 85.0 %, 67.8 %, 151 | 1.75 / 1.87 | — |
| `dbts_c2` top10 | 8 | 56 | 11675.4 | 38.81 / 38.20 / 38.15 | 2150 | 0.9451 / 0.9375 | 0.9614 / 0.9551 | 3.54 (1.10 / 1.10) | 96.0 / 96.2 %, 89.1 %, 76.1 %, 207 | 2.94 / 3.26 | — |
| `dbts_c2` window | 1 | 1 | 2.7 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 23.3 / 25.4 %, 17.5 %, 14.8 %, 30 | 2.48 / 2.61 | — |
| `dbts_c2` window | 1 | 2 | 3.2 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 28.5 / 30.5 %, 17.6 %, 15.0 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 1 | 4 | 4.1 | 10.09 / 9.28 / 9.19 | 2383 | 0.7005 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.35 / 0.37) | 39.8 / 41.7 %, 18.0 %, 15.1 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 1 | 8 | 5.5 | 10.09 / 9.28 / 9.19 | 2387 | 0.7003 / 0.6367 | 0.9066 / 0.8904 | 3.09 (0.38 / 0.40) | 61.1 / 62.3 %, 25.4 %, 15.4 %, 31 | 2.48 / 2.62 | — |
| `dbts_c2` window | 1 | 12 | 6.9 | 10.09 / 9.28 / 9.19 | 2387 | 0.6999 / 0.6362 | 0.9065 / 0.8904 | 3.10 (0.43 / 0.45) | 73.4 / 74.2 %, 39.0 %, 16.9 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 1 | 16 | 8.4 | 10.09 / 9.28 / 9.19 | 2389 | 0.6993 / 0.6357 | 0.9064 / 0.8903 | 3.11 (0.50 / 0.52) | 79.9 / 80.3 %, 50.0 %, 21.0 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 1 | 24 | 11.5 | 10.09 / 9.28 / 9.19 | 2394 | 0.6976 / 0.6341 | 0.9062 / 0.8901 | 3.15 (0.64 / 0.67) | 86.1 / 86.6 %, 64.0 %, 32.9 %, 33 | 2.49 / 2.63 | — |
| `dbts_c2` window | 1 | 32 | 21.2 | 10.09 / 9.28 / 9.19 | 2401 | 0.6927 / 0.6290 | 0.9054 / 0.8893 | 3.25 (0.91 / 0.92) | 90.9 / 91.6 %, 76.3 %, 51.0 %, 60 | 2.51 / 2.65 | — |
| `dbts_c2` window | 1 | 40 | 58.9 | 10.09 / 9.27 / 9.18 | 2417 | 0.6826 / 0.6188 | 0.9035 / 0.8875 | 3.44 (1.08 / 1.08) | 93.4 / 94.1 %, 82.8 %, 63.3 %, 54 | 2.55 / 2.68 | — |
| `dbts_c2` window | 1 | 56 | 590.4 | 10.08 / 9.27 / 9.18 | 2425 | 0.6688 / 0.6069 | 0.8957 / 0.8808 | 3.79 (1.09 / 1.10) | 95.4 / 95.7 %, 87.4 %, 72.3 %, 149 | 2.79 / 2.92 | — |
| `dbts_c2` window | 16 | 1 | 2.7 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 23.8 / 25.9 %, 17.5 %, 14.9 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 16 | 2 | 3.2 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 28.8 / 30.8 %, 17.6 %, 14.9 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 16 | 4 | 4.1 | 10.09 / 9.28 / 9.19 | 2382 | 0.7005 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.35 / 0.37) | 40.3 / 42.3 %, 18.0 %, 15.0 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 16 | 8 | 5.5 | 10.09 / 9.28 / 9.19 | 2388 | 0.7003 / 0.6366 | 0.9066 / 0.8904 | 3.09 (0.38 / 0.40) | 61.6 / 62.9 %, 25.9 %, 15.4 %, 32 | 2.48 / 2.62 | — |
| `dbts_c2` window | 16 | 12 | 6.9 | 10.09 / 9.28 / 9.19 | 2385 | 0.6998 / 0.6362 | 0.9065 / 0.8904 | 3.10 (0.43 / 0.45) | 73.7 / 74.5 %, 39.6 %, 17.0 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 16 | 16 | 8.4 | 10.09 / 9.28 / 9.19 | 2388 | 0.6993 / 0.6357 | 0.9064 / 0.8903 | 3.12 (0.50 / 0.52) | 80.1 / 80.5 %, 50.5 %, 21.3 %, 31 | 2.49 / 2.63 | — |
| `dbts_c2` window | 16 | 24 | 11.5 | 10.09 / 9.28 / 9.19 | 2397 | 0.6976 / 0.6341 | 0.9062 / 0.8901 | 3.15 (0.64 / 0.67) | 86.3 / 86.6 %, 64.1 %, 33.0 %, 33 | 2.49 / 2.64 | — |
| `dbts_c2` window | 16 | 32 | 21.1 | 10.09 / 9.28 / 9.19 | 2402 | 0.6928 / 0.6292 | 0.9054 / 0.8893 | 3.25 (0.90 / 0.91) | 91.0 / 91.6 %, 76.1 %, 50.7 %, 36 | 2.51 / 2.65 | — |
| `dbts_c2` window | 16 | 40 | 61.9 | 10.09 / 9.27 / 9.19 | 2402 | 0.6832 / 0.6193 | 0.9035 / 0.8876 | 3.43 (1.08 / 1.08) | 93.5 / 94.1 %, 82.7 %, 62.9 %, 54 | 2.55 / 2.68 | — |
| `dbts_c2` window | 16 | 56 | 1355.6 | 10.08 / 9.27 / 9.18 | 2451 | 0.6686 / 0.6069 | 0.8955 / 0.8809 | 3.79 (1.09 / 1.10) | 95.5 / 95.8 %, 87.8 %, 72.5 %, 117 | 2.80 / 2.91 | — |
| `dbts_c2` window | 8 | 1 | 2.7 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 23.8 / 25.9 %, 17.5 %, 14.9 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 8 | 2 | 3.2 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 28.8 / 30.9 %, 17.6 %, 14.9 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 8 | 4 | 4.1 | 10.09 / 9.28 / 9.19 | 2382 | 0.7005 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.35 / 0.37) | 40.3 / 42.3 %, 18.0 %, 15.0 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 8 | 8 | 5.5 | 10.09 / 9.28 / 9.19 | 2384 | 0.7003 / 0.6366 | 0.9066 / 0.8904 | 3.09 (0.38 / 0.40) | 61.6 / 62.9 %, 25.8 %, 15.3 %, 31 | 2.48 / 2.62 | — |
| `dbts_c2` window | 8 | 12 | 6.9 | 10.09 / 9.28 / 9.19 | 2387 | 0.6999 / 0.6362 | 0.9065 / 0.8904 | 3.10 (0.43 / 0.45) | 73.7 / 74.5 %, 39.5 %, 17.0 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 8 | 16 | 8.4 | 10.09 / 9.28 / 9.19 | 2391 | 0.6993 / 0.6357 | 0.9064 / 0.8903 | 3.12 (0.50 / 0.52) | 80.1 / 80.5 %, 50.5 %, 21.3 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 8 | 24 | 11.5 | 10.09 / 9.28 / 9.19 | 2394 | 0.6976 / 0.6341 | 0.9062 / 0.8901 | 3.15 (0.64 / 0.67) | 86.2 / 86.6 %, 64.0 %, 33.0 %, 33 | 2.49 / 2.64 | — |
| `dbts_c2` window | 8 | 32 | 21.1 | 10.09 / 9.28 / 9.19 | 2393 | 0.6929 / 0.6292 | 0.9054 / 0.8893 | 3.25 (0.90 / 0.92) | 90.8 / 91.6 %, 76.2 %, 50.9 %, 42 | 2.51 / 2.65 | — |
| `dbts_c2` window | 8 | 40 | 61.8 | 10.09 / 9.27 / 9.19 | 2405 | 0.6832 / 0.6193 | 0.9035 / 0.8876 | 3.44 (1.08 / 1.08) | 93.4 / 94.1 %, 82.7 %, 63.2 %, 54 | 2.55 / 2.68 | — |
| `dbts_c2` window | 8 | 56 | 1290.3 | 10.08 / 9.27 / 9.18 | 2425 | 0.6686 / 0.6069 | 0.8955 / 0.8809 | 3.79 (1.09 / 1.10) | 95.4 / 95.7 %, 87.6 %, 72.5 %, 98 | 2.79 / 2.91 | — |
| `dbts_c3` 12bit | 1 | 1 | 5.1 | 72.98 / 72.82 / 72.82 | 31 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 19.5 / 19.9 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.03 | 10.0 |
| `dbts_c3` 12bit | 1 | 2 | 6.5 | 67.06 / 66.90 / 66.90 | 30 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.17 (0.18 / 0.19) | 38.2 / 39.0 %, 2.1 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbts_c3` 12bit | 1 | 4 | 10.9 | 59.08 / 58.92 / 58.91 | 112 | 0.9989 / 0.9988 | 0.9999 / 0.9998 | 0.44 (0.45 / 0.48) | 66.9 / 67.8 %, 24.9 %, 2.2 %, 10 | 0.10 / 0.12 | 9.98 |
| `dbts_c3` 12bit | 1 | 8 | 29.7 | 51.06 / 50.93 / 50.92 | 350 | 0.9926 / 0.9921 | 0.9990 / 0.9989 | 1.11 (0.93 / 0.95) | 85.2 / 85.9 %, 62.1 %, 28.8 %, 28 | 0.26 / 0.31 | 9.81 |
| `dbts_c3` 12bit | 1 | 12 | 86.4 | 47.67 / 47.59 / 47.59 | 437 | 0.9838 / 0.9832 | 0.9972 / 0.9969 | 1.63 (1.05 / 1.06) | 89.3 / 89.9 %, 72.6 %, 44.9 %, 52 | 0.46 / 0.54 | 9.39 |
| `dbts_c3` 12bit | 1 | 16 | 194.4 | 46.38 / 46.24 / 46.22 | 576 | 0.9788 / 0.9770 | 0.9955 / 0.9948 | 1.88 (1.06 / 1.07) | 90.6 / 91.3 %, 75.6 %, 50.1 %, 54 | 0.64 / 0.77 | 8.84 |
| `dbts_c3` 12bit | 1 | 24 | 451.9 | 45.37 / 45.24 / 45.22 | 451 | 0.9744 / 0.9721 | 0.9931 / 0.9920 | 2.10 (1.06 / 1.07) | 91.5 / 92.1 %, 77.6 %, 53.5 %, 74 | 0.90 / 1.11 | 7.84 |
| `dbts_c3` 12bit | 1 | 32 | 910.9 | 44.44 / 44.31 / 44.28 | 892 | 0.9714 / 0.9698 | 0.9903 / 0.9891 | 2.32 (1.06 / 1.07) | 92.4 / 92.8 %, 79.8 %, 57.2 %, 122 | 1.22 / 1.45 | 6.59 |
| `dbts_c3` 12bit | 1 | 40 | 1636.4 | 43.31 / 42.95 / 42.85 | 1134 | 0.9666 / 0.9615 | 0.9865 / 0.9853 | 2.62 (1.06 / 1.07) | 93.3 / 93.8 %, 81.9 %, 60.9 %, 130 | 1.62 / 1.80 | 5.36 |
| `dbts_c3` 12bit | 1 | 56 | 4517.2 | 39.32 / 38.87 / 38.83 | 2371 | 0.9398 / 0.9043 | 0.9722 / 0.9668 | 3.85 (1.06 / 1.07) | 95.0 / 95.3 %, 86.1 %, 69.1 %, 224 | 2.85 / 3.23 | 2.77 |
| `dbts_c3` 12bit | 16 | 1 | 5.1 | 73.00 / 72.84 / 72.83 | 55 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 19.4 / 19.8 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.03 | 10.0 |
| `dbts_c3` 12bit | 16 | 2 | 6.8 | 66.64 / 66.39 / 66.39 | 73 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.19 / 0.20) | 39.7 / 40.7 %, 2.8 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbts_c3` 12bit | 16 | 4 | 10.9 | 59.02 / 58.84 / 58.84 | 131 | 0.9988 / 0.9988 | 0.9998 / 0.9998 | 0.44 (0.45 / 0.48) | 67.1 / 68.0 %, 25.7 %, 2.3 %, 11 | 0.10 / 0.12 | 9.98 |
| `dbts_c3` 12bit | 16 | 8 | 29.5 | 51.17 / 51.05 / 50.93 | 237 | 0.9929 / 0.9922 | 0.9990 / 0.9989 | 1.09 (0.93 / 0.95) | 85.1 / 85.8 %, 61.8 %, 28.4 %, 29 | 0.26 / 0.31 | 9.81 |
| `dbts_c3` 12bit | 16 | 12 | 94.1 | 47.81 / 47.72 / 47.61 | 384 | 0.9844 / 0.9834 | 0.9973 / 0.9970 | 1.60 (1.05 / 1.06) | 89.2 / 89.9 %, 72.2 %, 44.2 %, 45 | 0.45 / 0.55 | 9.42 |
| `dbts_c3` 12bit | 16 | 16 | 285.6 | 46.40 / 46.25 / 46.22 | 414 | 0.9791 / 0.9771 | 0.9955 / 0.9948 | 1.88 (1.06 / 1.07) | 90.6 / 91.3 %, 75.6 %, 50.0 %, 63 | 0.63 / 0.79 | 8.84 |
| `dbts_c3` 12bit | 16 | 24 | 1064.3 | 45.25 / 44.97 / 44.92 | 540 | 0.9751 / 0.9722 | 0.9926 / 0.9910 | 2.15 (1.06 / 1.07) | 91.7 / 92.3 %, 78.1 %, 54.4 %, 78 | 0.97 / 1.23 | 7.58 |
| `dbts_c3` 12bit | 16 | 32 | 2819.7 | 44.18 / 43.97 / 43.94 | 645 | 0.9713 / 0.9707 | 0.9894 / 0.9881 | 2.39 (1.06 / 1.07) | 92.5 / 93.0 %, 80.4 %, 58.3 %, 107 | 1.31 / 1.58 | 6.38 |
| `dbts_c3` 12bit | 16 | 40 | 6214.6 | 42.96 / 42.37 / 42.25 | 929 | 0.9686 / 0.9627 | 0.9851 / 0.9835 | 2.77 (1.06 / 1.07) | 93.5 / 93.9 %, 82.5 %, 62.3 %, 137 | 1.75 / 1.99 | 5.05 |
| `dbts_c3` 12bit | 16 | 56 | 21536.0 | 38.96 / 37.82 / 37.72 | 2249 | 0.9401 / 0.9256 | 0.9706 / 0.9632 | 4.13 (1.06 / 1.07) | 95.3 / 95.7 %, 87.2 %, 71.6 %, 215 | 3.17 / 3.89 | 2.53 |
| `dbts_c3` 12bit | 8 | 1 | 5.1 | 73.00 / 72.84 / 72.83 | 52 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 19.4 / 19.8 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.03 | 10.0 |
| `dbts_c3` 12bit | 8 | 2 | 6.7 | 66.71 / 66.40 / 66.39 | 86 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.19 / 0.20) | 39.6 / 40.7 %, 2.8 %, 0.0 %, 5 | 0.04 / 0.05 | 10.0 |
| `dbts_c3` 12bit | 8 | 4 | 10.9 | 59.02 / 58.85 / 58.84 | 127 | 0.9988 / 0.9988 | 0.9998 / 0.9998 | 0.44 (0.45 / 0.48) | 67.1 / 68.0 %, 25.7 %, 2.3 %, 11 | 0.10 / 0.12 | 9.98 |
| `dbts_c3` 12bit | 8 | 8 | 29.6 | 51.16 / 51.00 / 50.93 | 276 | 0.9928 / 0.9922 | 0.9990 / 0.9989 | 1.09 (0.93 / 0.95) | 85.1 / 85.8 %, 61.8 %, 28.4 %, 29 | 0.26 / 0.31 | 9.81 |
| `dbts_c3` 12bit | 8 | 12 | 93.7 | 47.80 / 47.65 / 47.60 | 384 | 0.9843 / 0.9834 | 0.9973 / 0.9970 | 1.60 (1.05 / 1.06) | 89.2 / 89.9 %, 72.2 %, 44.2 %, 45 | 0.45 / 0.55 | 9.42 |
| `dbts_c3` 12bit | 8 | 16 | 278.6 | 46.40 / 46.25 / 46.22 | 405 | 0.9791 / 0.9771 | 0.9955 / 0.9948 | 1.88 (1.06 / 1.07) | 90.6 / 91.3 %, 75.6 %, 50.0 %, 57 | 0.63 / 0.79 | 8.84 |
| `dbts_c3` 12bit | 8 | 24 | 1012.6 | 45.26 / 44.98 / 44.91 | 540 | 0.9748 / 0.9722 | 0.9926 / 0.9910 | 2.15 (1.06 / 1.07) | 91.7 / 92.3 %, 78.1 %, 54.4 %, 95 | 0.97 / 1.24 | 7.56 |
| `dbts_c3` 12bit | 8 | 32 | 2584.2 | 44.29 / 44.00 / 43.94 | 645 | 0.9713 / 0.9706 | 0.9896 / 0.9882 | 2.38 (1.06 / 1.07) | 92.5 / 93.0 %, 80.3 %, 58.1 %, 107 | 1.30 / 1.57 | 6.37 |
| `dbts_c3` 12bit | 8 | 40 | 5542.5 | 43.01 / 42.45 / 42.29 | 929 | 0.9672 / 0.9627 | 0.9854 / 0.9835 | 2.74 (1.06 / 1.07) | 93.5 / 94.0 %, 82.3 %, 62.0 %, 136 | 1.72 / 1.98 | 5.06 |
| `dbts_c3` 12bit | 8 | 56 | 17983.2 | 39.16 / 38.14 / 37.93 | 2311 | 0.9404 / 0.9256 | 0.9718 / 0.9634 | 4.00 (1.06 / 1.07) | 95.1 / 95.7 %, 87.0 %, 71.4 %, 215 | 2.98 / 3.80 | 2.54 |
| `dbts_c3` top10 | 1 | 1 | 6.1 | 66.20 / 66.03 / 66.03 | 47 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.21) | 40.0 / 40.8 %, 3.6 %, 0.0 %, 5 | 0.06 / 0.07 | — |
| `dbts_c3` top10 | 1 | 2 | 7.9 | 62.73 / 62.57 / 62.57 | 40 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 54.2 / 55.2 %, 10.9 %, 0.1 %, 7 | 0.08 / 0.10 | — |
| `dbts_c3` top10 | 1 | 4 | 12.4 | 57.29 / 57.15 / 57.14 | 133 | 0.9983 / 0.9982 | 0.9998 / 0.9998 | 0.54 (0.54 / 0.57) | 72.3 / 73.1 %, 33.5 %, 4.9 %, 15 | 0.13 / 0.16 | — |
| `dbts_c3` top10 | 1 | 8 | 31.6 | 50.71 / 50.60 / 50.59 | 350 | 0.9921 / 0.9917 | 0.9989 / 0.9988 | 1.15 (0.95 / 0.96) | 85.8 / 86.4 %, 63.4 %, 30.6 %, 29 | 0.28 / 0.33 | — |
| `dbts_c3` top10 | 1 | 12 | 80.9 | 47.82 / 47.74 / 47.69 | 437 | 0.9846 / 0.9840 | 0.9974 / 0.9971 | 1.60 (1.05 / 1.06) | 89.2 / 89.8 %, 72.3 %, 44.4 %, 47 | 0.45 / 0.54 | — |
| `dbts_c3` top10 | 1 | 16 | 168.4 | 46.56 / 46.43 / 46.42 | 532 | 0.9798 / 0.9787 | 0.9958 / 0.9953 | 1.85 (1.06 / 1.07) | 90.5 / 91.1 %, 75.3 %, 49.5 %, 55 | 0.61 / 0.74 | — |
| `dbts_c3` top10 | 1 | 24 | 394.3 | 45.54 / 45.41 / 45.40 | 425 | 0.9761 / 0.9745 | 0.9936 / 0.9927 | 2.06 (1.06 / 1.07) | 91.4 / 92.0 %, 77.4 %, 53.1 %, 64 | 0.86 / 1.05 | — |
| `dbts_c3` top10 | 1 | 32 | 784.1 | 44.67 / 44.59 / 44.57 | 731 | 0.9739 / 0.9713 | 0.9912 / 0.9901 | 2.27 (1.06 / 1.08) | 92.3 / 92.7 %, 79.3 %, 56.4 %, 116 | 1.15 / 1.37 | — |
| `dbts_c3` top10 | 1 | 40 | 1369.3 | 43.75 / 43.49 / 43.41 | 963 | 0.9690 / 0.9678 | 0.9878 / 0.9868 | 2.51 (1.07 / 1.08) | 93.0 / 93.6 %, 81.4 %, 59.9 %, 123 | 1.48 / 1.67 | — |
| `dbts_c3` top10 | 1 | 56 | 3643.1 | 40.68 / 40.07 / 40.04 | 2246 | 0.9455 / 0.9313 | 0.9762 / 0.9729 | 3.40 (1.07 / 1.08) | 94.6 / 94.8 %, 84.5 %, 66.2 %, 212 | 2.41 / 2.76 | — |
| `dbts_c3` top10 | 16 | 1 | 6.3 | 65.87 / 65.64 / 65.63 | 81 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.20 (0.19 / 0.21) | 41.2 / 42.3 %, 4.1 %, 0.0 %, 5 | 0.07 / 0.08 | — |
| `dbts_c3` top10 | 16 | 2 | 7.9 | 62.68 / 62.50 / 62.49 | 108 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 54.4 / 55.4 %, 11.1 %, 0.2 %, 7 | 0.08 / 0.10 | — |
| `dbts_c3` top10 | 16 | 4 | 12.4 | 57.23 / 57.05 / 57.04 | 173 | 0.9983 / 0.9981 | 0.9998 / 0.9997 | 0.54 (0.54 / 0.57) | 72.5 / 73.3 %, 34.3 %, 5.3 %, 13 | 0.13 / 0.16 | — |
| `dbts_c3` top10 | 16 | 8 | 31.6 | 50.81 / 50.70 / 50.62 | 300 | 0.9923 / 0.9918 | 0.9989 / 0.9988 | 1.14 (0.94 / 0.96) | 85.7 / 86.3 %, 63.2 %, 30.1 %, 29 | 0.28 / 0.34 | — |
| `dbts_c3` top10 | 16 | 12 | 87.7 | 47.90 / 47.79 / 47.77 | 339 | 0.9850 / 0.9841 | 0.9974 / 0.9971 | 1.59 (1.05 / 1.06) | 89.2 / 89.8 %, 72.1 %, 44.0 %, 44 | 0.45 / 0.55 | — |
| `dbts_c3` top10 | 16 | 16 | 237.2 | 46.56 / 46.41 / 46.40 | 413 | 0.9800 / 0.9787 | 0.9958 / 0.9952 | 1.85 (1.06 / 1.07) | 90.5 / 91.1 %, 75.3 %, 49.5 %, 53 | 0.61 / 0.76 | — |
| `dbts_c3` top10 | 16 | 24 | 815.7 | 45.49 / 45.29 / 45.23 | 476 | 0.9760 / 0.9744 | 0.9935 / 0.9922 | 2.08 (1.06 / 1.07) | 91.5 / 92.2 %, 77.5 %, 53.4 %, 78 | 0.89 / 1.13 | — |
| `dbts_c3` top10 | 16 | 32 | 2172.4 | 44.57 / 44.43 / 44.41 | 528 | 0.9739 / 0.9727 | 0.9908 / 0.9897 | 2.29 (1.07 / 1.08) | 92.3 / 92.8 %, 79.5 %, 56.8 %, 115 | 1.18 / 1.41 | — |
| `dbts_c3` top10 | 16 | 40 | 4612.6 | 43.55 / 43.22 / 43.13 | 950 | 0.9689 / 0.9683 | 0.9872 / 0.9860 | 2.57 (1.07 / 1.08) | 93.2 / 93.6 %, 81.5 %, 60.3 %, 145 | 1.53 / 1.77 | — |
| `dbts_c3` top10 | 16 | 56 | 16036.9 | 40.55 / 39.60 / 39.44 | 2246 | 0.9509 / 0.9313 | 0.9754 / 0.9704 | 3.56 (1.07 / 1.08) | 94.7 / 95.0 %, 85.1 %, 67.6 %, 182 | 2.59 / 3.05 | — |
| `dbts_c3` top10 | 8 | 1 | 6.3 | 65.93 / 65.64 / 65.63 | 74 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.20 (0.20 / 0.21) | 41.1 / 42.3 %, 4.1 %, 0.0 %, 5 | 0.06 / 0.08 | — |
| `dbts_c3` top10 | 8 | 2 | 7.9 | 62.68 / 62.50 / 62.49 | 108 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 54.4 / 55.4 %, 11.1 %, 0.2 %, 7 | 0.08 / 0.10 | — |
| `dbts_c3` top10 | 8 | 4 | 12.4 | 57.22 / 57.06 / 57.05 | 173 | 0.9983 / 0.9981 | 0.9998 / 0.9997 | 0.54 (0.54 / 0.57) | 72.5 / 73.3 %, 34.3 %, 5.3 %, 12 | 0.13 / 0.16 | — |
| `dbts_c3` top10 | 8 | 8 | 31.6 | 50.81 / 50.67 / 50.61 | 276 | 0.9923 / 0.9917 | 0.9989 / 0.9988 | 1.14 (0.94 / 0.96) | 85.7 / 86.3 %, 63.2 %, 30.1 %, 29 | 0.28 / 0.34 | — |
| `dbts_c3` top10 | 8 | 12 | 87.3 | 47.90 / 47.79 / 47.76 | 276 | 0.9849 / 0.9841 | 0.9974 / 0.9971 | 1.59 (1.05 / 1.06) | 89.2 / 89.8 %, 72.1 %, 44.0 %, 44 | 0.45 / 0.55 | — |
| `dbts_c3` top10 | 8 | 16 | 232.7 | 46.56 / 46.41 / 46.40 | 413 | 0.9800 / 0.9787 | 0.9958 / 0.9952 | 1.85 (1.06 / 1.07) | 90.5 / 91.1 %, 75.3 %, 49.5 %, 52 | 0.61 / 0.76 | — |
| `dbts_c3` top10 | 8 | 24 | 781.3 | 45.49 / 45.28 / 45.23 | 476 | 0.9760 / 0.9744 | 0.9935 / 0.9922 | 2.08 (1.06 / 1.07) | 91.5 / 92.2 %, 77.5 %, 53.4 %, 64 | 0.89 / 1.13 | — |
| `dbts_c3` top10 | 8 | 32 | 2008.8 | 44.59 / 44.44 / 44.42 | 528 | 0.9739 / 0.9713 | 0.9909 / 0.9897 | 2.29 (1.07 / 1.08) | 92.3 / 92.8 %, 79.5 %, 56.8 %, 113 | 1.19 / 1.41 | — |
| `dbts_c3` top10 | 8 | 40 | 4150.0 | 43.64 / 43.25 / 43.18 | 950 | 0.9691 / 0.9683 | 0.9873 / 0.9862 | 2.57 (1.07 / 1.08) | 93.1 / 93.6 %, 81.5 %, 60.3 %, 135 | 1.54 / 1.75 | — |
| `dbts_c3` top10 | 8 | 56 | 13587.8 | 40.60 / 39.69 / 39.54 | 2246 | 0.9480 / 0.9313 | 0.9754 / 0.9704 | 3.50 (1.07 / 1.08) | 94.6 / 95.0 %, 85.1 %, 67.6 %, 182 | 2.53 / 3.04 | — |
| `dbts_c3` window | 1 | 1 | 4.0 | 7.58 / 6.85 / 6.77 | 2434 | 0.4970 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 21.8 / 25.1 %, 16.9 %, 13.1 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 1 | 2 | 4.9 | 7.58 / 6.85 / 6.77 | 2434 | 0.4969 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 27.1 / 30.2 %, 17.2 %, 13.3 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 1 | 4 | 6.2 | 7.58 / 6.85 / 6.77 | 2436 | 0.4969 / 0.3981 | 0.8812 / 0.8492 | 3.31 (0.40 / 0.44) | 38.0 / 40.9 %, 17.6 %, 13.6 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 1 | 8 | 8.7 | 7.58 / 6.85 / 6.77 | 2442 | 0.4966 / 0.3979 | 0.8811 / 0.8492 | 3.32 (0.45 / 0.48) | 59.0 / 61.0 %, 23.7 %, 13.9 %, 31 | 2.04 / 3.15 | — |
| `dbts_c3` window | 1 | 12 | 11.3 | 7.58 / 6.85 / 6.77 | 2446 | 0.4961 / 0.3974 | 0.8811 / 0.8491 | 3.34 (0.53 / 0.56) | 71.8 / 73.3 %, 36.3 %, 15.3 %, 32 | 2.04 / 3.15 | — |
| `dbts_c3` window | 1 | 16 | 14.2 | 7.58 / 6.85 / 6.77 | 2444 | 0.4953 / 0.3968 | 0.8809 / 0.8491 | 3.36 (0.62 / 0.65) | 78.7 / 79.8 %, 47.3 %, 18.7 %, 33 | 2.05 / 3.15 | — |
| `dbts_c3` window | 1 | 24 | 21.5 | 7.58 / 6.85 / 6.77 | 2450 | 0.4933 / 0.3949 | 0.8806 / 0.8488 | 3.42 (0.79 / 0.83) | 85.6 / 86.3 %, 61.7 %, 29.2 %, 50 | 2.05 / 3.16 | — |
| `dbts_c3` window | 1 | 32 | 49.0 | 7.58 / 6.85 / 6.77 | 2473 | 0.4878 / 0.3896 | 0.8796 / 0.8481 | 3.58 (1.01 / 1.02) | 90.6 / 91.0 %, 73.9 %, 45.5 %, 49 | 2.08 / 3.18 | — |
| `dbts_c3` window | 1 | 40 | 165.0 | 7.58 / 6.84 / 6.77 | 2466 | 0.4804 / 0.3823 | 0.8775 / 0.8464 | 3.78 (1.06 / 1.07) | 92.7 / 93.1 %, 79.6 %, 55.6 %, 72 | 2.15 / 3.22 | — |
| `dbts_c3` window | 1 | 56 | 1265.4 | 7.57 / 6.84 / 6.77 | 2521 | 0.4746 / 0.3777 | 0.8721 / 0.8421 | 4.07 (1.06 / 1.07) | 94.2 / 94.5 %, 83.7 %, 63.5 %, 131 | 2.46 / 3.43 | — |
| `dbts_c3` window | 16 | 1 | 4.1 | 7.58 / 6.85 / 6.77 | 2434 | 0.4970 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 22.2 / 25.5 %, 17.0 %, 13.2 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 16 | 2 | 4.9 | 7.58 / 6.85 / 6.77 | 2434 | 0.4969 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 27.3 / 30.4 %, 17.2 %, 13.3 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 16 | 4 | 6.2 | 7.58 / 6.85 / 6.77 | 2437 | 0.4969 / 0.3981 | 0.8812 / 0.8492 | 3.31 (0.40 / 0.44) | 38.3 / 41.1 %, 17.5 %, 13.5 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 16 | 8 | 8.6 | 7.58 / 6.85 / 6.77 | 2439 | 0.4966 / 0.3979 | 0.8812 / 0.8492 | 3.32 (0.45 / 0.48) | 59.2 / 61.4 %, 23.8 %, 13.9 %, 31 | 2.04 / 3.15 | — |
| `dbts_c3` window | 16 | 12 | 11.2 | 7.58 / 6.85 / 6.77 | 2447 | 0.4961 / 0.3974 | 0.8811 / 0.8491 | 3.34 (0.53 / 0.56) | 72.0 / 73.5 %, 36.6 %, 15.3 %, 32 | 2.04 / 3.15 | — |
| `dbts_c3` window | 16 | 16 | 14.1 | 7.58 / 6.85 / 6.77 | 2444 | 0.4953 / 0.3968 | 0.8809 / 0.8491 | 3.37 (0.62 / 0.65) | 78.8 / 79.9 %, 47.5 %, 18.8 %, 32 | 2.05 / 3.15 | — |
| `dbts_c3` window | 16 | 24 | 21.4 | 7.58 / 6.85 / 6.77 | 2460 | 0.4933 / 0.3949 | 0.8806 / 0.8488 | 3.43 (0.79 / 0.83) | 85.6 / 86.3 %, 61.7 %, 29.2 %, 32 | 2.06 / 3.16 | — |
| `dbts_c3` window | 16 | 32 | 49.1 | 7.58 / 6.85 / 6.77 | 2458 | 0.4882 / 0.3898 | 0.8796 / 0.8481 | 3.57 (1.00 / 1.02) | 90.5 / 91.0 %, 73.8 %, 45.5 %, 36 | 2.08 / 3.18 | — |
| `dbts_c3` window | 16 | 40 | 202.1 | 7.58 / 6.84 / 6.77 | 2465 | 0.4808 / 0.3826 | 0.8775 / 0.8464 | 3.77 (1.06 / 1.07) | 92.7 / 93.1 %, 79.7 %, 55.7 %, 53 | 2.15 / 3.22 | — |
| `dbts_c3` window | 16 | 56 | 3392.7 | 7.57 / 6.84 / 6.77 | 2534 | 0.4745 / 0.3777 | 0.8719 / 0.8422 | 4.07 (1.06 / 1.07) | 94.2 / 94.5 %, 83.8 %, 63.8 %, 94 | 2.46 / 3.43 | — |
| `dbts_c3` window | 8 | 1 | 4.1 | 7.58 / 6.85 / 6.77 | 2434 | 0.4970 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 22.2 / 25.5 %, 17.0 %, 13.2 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 8 | 2 | 4.9 | 7.58 / 6.85 / 6.77 | 2434 | 0.4969 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 27.3 / 30.4 %, 17.2 %, 13.3 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 8 | 4 | 6.2 | 7.58 / 6.85 / 6.77 | 2436 | 0.4969 / 0.3981 | 0.8812 / 0.8492 | 3.31 (0.40 / 0.44) | 38.3 / 41.1 %, 17.5 %, 13.5 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 8 | 8 | 8.6 | 7.58 / 6.85 / 6.77 | 2441 | 0.4966 / 0.3979 | 0.8812 / 0.8492 | 3.32 (0.45 / 0.48) | 59.2 / 61.4 %, 23.8 %, 13.9 %, 31 | 2.04 / 3.15 | — |
| `dbts_c3` window | 8 | 12 | 11.2 | 7.58 / 6.85 / 6.77 | 2447 | 0.4961 / 0.3974 | 0.8811 / 0.8491 | 3.34 (0.53 / 0.56) | 72.0 / 73.5 %, 36.6 %, 15.3 %, 32 | 2.04 / 3.15 | — |
| `dbts_c3` window | 8 | 16 | 14.1 | 7.58 / 6.85 / 6.77 | 2447 | 0.4953 / 0.3968 | 0.8809 / 0.8491 | 3.36 (0.62 / 0.65) | 78.7 / 79.9 %, 47.5 %, 18.8 %, 32 | 2.05 / 3.15 | — |
| `dbts_c3` window | 8 | 24 | 21.4 | 7.58 / 6.85 / 6.77 | 2460 | 0.4933 / 0.3949 | 0.8806 / 0.8488 | 3.42 (0.79 / 0.83) | 85.6 / 86.3 %, 61.7 %, 29.2 %, 36 | 2.06 / 3.16 | — |
| `dbts_c3` window | 8 | 32 | 49.1 | 7.58 / 6.85 / 6.77 | 2457 | 0.4882 / 0.3898 | 0.8796 / 0.8481 | 3.57 (1.00 / 1.02) | 90.5 / 91.0 %, 73.8 %, 45.5 %, 49 | 2.08 / 3.18 | — |
| `dbts_c3` window | 8 | 40 | 201.0 | 7.58 / 6.84 / 6.77 | 2468 | 0.4808 / 0.3826 | 0.8775 / 0.8464 | 3.77 (1.06 / 1.07) | 92.7 / 93.1 %, 79.7 %, 55.7 %, 72 | 2.15 / 3.22 | — |
| `dbts_c3` window | 8 | 56 | 3173.4 | 7.57 / 6.84 / 6.77 | 2509 | 0.4745 / 0.3777 | 0.8719 / 0.8422 | 4.07 (1.06 / 1.07) | 94.2 / 94.5 %, 83.8 %, 63.7 %, 97 | 2.46 / 3.43 | — |
| `mr9_ispy2` 9bit | 1 | 1 | 6.4 | 58.39 / 58.26 / 58.26 | 3 | 0.9983 / 0.9981 | 0.9998 / 0.9998 | 0.78 (0.74 / 1.00) | 35.9 / 37.0 %, 26.8 %, 0.3 %, 6 | 0.08 / 0.24 | 9.99 |
| `mr9_ispy2` 9bit | 1 | 2 | 12.1 | 54.91 / 54.73 / 54.72 | 5 | 0.9960 / 0.9955 | 0.9995 / 0.9994 | 1.15 (0.92 / 1.18) | 54.1 / 56.2 %, 41.8 %, 5.5 %, 9 | 0.14 / 0.43 | 9.97 |
| `mr9_ispy2` 9bit | 1 | 4 | 25.9 | 51.11 / 50.67 / 50.63 | 15 | 0.9909 / 0.9905 | 0.9987 / 0.9986 | 1.79 (1.14 / 1.31) | 66.1 / 69.5 %, 56.0 %, 19.8 %, 27 | 0.23 / 0.64 | 9.85 |
| `mr9_ispy2` 9bit | 1 | 8 | 67.8 | 47.30 / 46.50 / 46.41 | 31 | 0.9798 / 0.9781 | 0.9963 / 0.9959 | 2.76 (1.37 / 1.45) | 73.4 / 76.0 %, 64.2 %, 33.2 %, 56 | 0.41 / 1.04 | 9.39 |
| `mr9_ispy2` 9bit | 1 | 12 | 119.6 | 45.39 / 44.35 / 44.26 | 40 | 0.9700 / 0.9666 | 0.9938 / 0.9926 | 3.44 (1.47 / 1.56) | 76.4 / 79.6 %, 68.6 %, 38.8 %, 72 | 0.59 / 1.40 | 8.86 |
| `mr9_ispy2` 9bit | 1 | 16 | 180.1 | 44.07 / 42.81 / 42.69 | 63 | 0.9601 / 0.9544 | 0.9914 / 0.9891 | 3.99 (1.54 / 1.66) | 78.7 / 81.4 %, 72.3 %, 42.5 %, 113 | 0.76 / 1.77 | 8.33 |
| `mr9_ispy2` 9bit | 1 | 24 | 312.6 | 42.64 / 41.06 / 40.91 | 85 | 0.9514 / 0.9406 | 0.9866 / 0.9826 | 4.77 (1.58 / 1.77) | 78.6 / 81.6 %, 71.0 %, 44.5 %, 151 | 0.97 / 2.08 | 7.53 |
| `mr9_ispy2` 9bit | 1 | 32 | 641.5 | 40.64 / 38.91 / 38.53 | 140 | 0.9332 / 0.9127 | 0.9768 / 0.9670 | 5.89 (1.59 / 1.93) | 81.5 / 83.3 %, 72.9 %, 47.9 %, 167 | 1.38 / 2.73 | 6.39 |
| `mr9_ispy2` 9bit | 1 | 40 | 1270.7 | 38.79 / 37.03 / 36.87 | 230 | 0.8999 / 0.8818 | 0.9598 / 0.9470 | 7.15 (1.61 / 1.91) | 85.5 / 87.5 %, 80.6 %, 58.4 %, 197 | 1.96 / 4.04 | 4.9 |
| `mr9_ispy2` 9bit | 1 | 56 | 2604.7 | 36.45 / 34.57 / 34.51 | 296 | 0.8546 / 0.8199 | 0.9279 / 0.9061 | 9.42 (1.60 / 1.91) | 88.2 / 93.2 %, 90.7 %, 77.1 %, 204 | 3.05 / 5.63 | 3.1 |
| `mr9_ispy2` 9bit | 16 | 1 | 6.7 | 58.11 / 57.73 / 57.61 | 12 | 0.9982 / 0.9978 | 0.9998 / 0.9997 | 0.78 (0.71 / 0.97) | 36.5 / 40.4 %, 29.1 %, 0.7 %, 21 | 0.09 / 0.25 | 9.98 |
| `mr9_ispy2` 9bit | 16 | 2 | 11.9 | 54.66 / 54.46 / 54.42 | 12 | 0.9959 / 0.9952 | 0.9995 / 0.9994 | 1.19 (0.94 / 1.20) | 56.3 / 57.9 %, 43.3 %, 5.9 %, 22 | 0.14 / 0.43 | 9.95 |
| `mr9_ispy2` 9bit | 16 | 4 | 26.1 | 50.94 / 50.55 / 50.54 | 16 | 0.9906 / 0.9902 | 0.9986 / 0.9986 | 1.83 (1.14 / 1.32) | 66.8 / 69.9 %, 56.2 %, 20.2 %, 29 | 0.23 / 0.66 | 9.84 |
| `mr9_ispy2` 9bit | 16 | 8 | 72.5 | 47.18 / 46.40 / 46.39 | 42 | 0.9792 / 0.9776 | 0.9962 / 0.9958 | 2.81 (1.37 / 1.43) | 73.3 / 76.2 %, 64.4 %, 33.3 %, 75 | 0.42 / 1.10 | 9.36 |
| `mr9_ispy2` 9bit | 16 | 12 | 135.0 | 45.31 / 44.31 / 44.21 | 48 | 0.9701 / 0.9658 | 0.9936 / 0.9924 | 3.48 (1.48 / 1.60) | 76.1 / 79.2 %, 67.5 %, 37.8 %, 86 | 0.61 / 1.43 | 8.8 |
| `mr9_ispy2` 9bit | 16 | 16 | 212.3 | 44.04 / 42.87 / 42.67 | 70 | 0.9619 / 0.9550 | 0.9909 / 0.9891 | 3.99 (1.55 / 1.66) | 76.8 / 81.4 %, 70.7 %, 41.4 %, 124 | 0.74 / 1.77 | 8.3 |
| `mr9_ispy2` 9bit | 16 | 24 | 416.0 | 42.41 / 40.85 / 40.67 | 109 | 0.9487 / 0.9372 | 0.9855 / 0.9815 | 4.87 (1.59 / 1.81) | 78.8 / 81.9 %, 71.0 %, 45.4 %, 150 | 1.03 / 2.14 | 7.42 |
| `mr9_ispy2` 9bit | 16 | 32 | 999.3 | 40.51 / 38.75 / 38.64 | 127 | 0.9318 / 0.9133 | 0.9748 / 0.9664 | 5.95 (1.60 / 1.90) | 79.7 / 82.8 %, 72.1 %, 48.2 %, 165 | 1.44 / 2.77 | 6.2 |
| `mr9_ispy2` 9bit | 16 | 40 | 2296.6 | 38.75 / 36.97 / 36.92 | 231 | 0.9082 / 0.8809 | 0.9594 / 0.9460 | 7.14 (1.61 / 1.92) | 84.3 / 86.9 %, 79.8 %, 56.3 %, 197 | 2.01 / 4.04 | 4.88 |
| `mr9_ispy2` 9bit | 16 | 56 | 5318.1 | 36.16 / 34.59 / 34.21 | 305 | 0.8679 / 0.8286 | 0.9282 / 0.9050 | 9.74 (1.60 / 1.91) | 86.0 / 91.2 %, 85.7 %, 69.5 %, 206 | 3.23 / 6.08 | 3.07 |
| `mr9_ispy2` 9bit | 8 | 1 | 6.6 | 58.23 / 57.63 / 57.56 | 10 | 0.9983 / 0.9978 | 0.9998 / 0.9997 | 0.78 (0.72 / 0.97) | 36.3 / 41.1 %, 29.1 %, 0.7 %, 18 | 0.09 / 0.25 | 9.98 |
| `mr9_ispy2` 9bit | 8 | 2 | 11.9 | 54.74 / 54.50 / 54.49 | 10 | 0.9960 / 0.9954 | 0.9995 / 0.9994 | 1.18 (0.94 / 1.20) | 55.5 / 57.8 %, 43.3 %, 5.8 %, 18 | 0.14 / 0.43 | 9.96 |
| `mr9_ispy2` 9bit | 8 | 4 | 26.0 | 51.02 / 50.55 / 50.55 | 16 | 0.9907 / 0.9903 | 0.9986 / 0.9986 | 1.81 (1.15 / 1.32) | 66.5 / 70.0 %, 56.2 %, 20.0 %, 28 | 0.23 / 0.66 | 9.84 |
| `mr9_ispy2` 9bit | 8 | 8 | 71.9 | 47.14 / 46.43 / 46.39 | 30 | 0.9792 / 0.9778 | 0.9962 / 0.9958 | 2.78 (1.37 / 1.45) | 73.2 / 76.5 %, 64.3 %, 33.3 %, 54 | 0.42 / 1.10 | 9.39 |
| `mr9_ispy2` 9bit | 8 | 12 | 133.1 | 45.36 / 44.28 / 44.21 | 50 | 0.9700 / 0.9656 | 0.9936 / 0.9924 | 3.47 (1.49 / 1.60) | 75.9 / 79.2 %, 67.4 %, 37.8 %, 90 | 0.61 / 1.43 | 8.81 |
| `mr9_ispy2` 9bit | 8 | 16 | 208.3 | 44.13 / 42.88 / 42.76 | 66 | 0.9619 / 0.9554 | 0.9912 / 0.9893 | 4.00 (1.54 / 1.67) | 77.2 / 81.4 %, 70.7 %, 41.4 %, 118 | 0.76 / 1.77 | 8.34 |
| `mr9_ispy2` 9bit | 8 | 24 | 403.6 | 42.40 / 40.85 / 40.67 | 102 | 0.9480 / 0.9372 | 0.9852 / 0.9815 | 4.87 (1.59 / 1.81) | 78.7 / 81.9 %, 71.0 %, 45.4 %, 149 | 1.03 / 2.14 | 7.41 |
| `mr9_ispy2` 9bit | 8 | 32 | 953.2 | 40.68 / 38.78 / 38.64 | 127 | 0.9322 / 0.9131 | 0.9756 / 0.9664 | 5.96 (1.59 / 1.90) | 80.7 / 83.0 %, 72.1 %, 48.2 %, 166 | 1.39 / 2.77 | 6.23 |
| `mr9_ispy2` 9bit | 8 | 40 | 2143.8 | 38.87 / 36.95 / 36.92 | 236 | 0.9097 / 0.8809 | 0.9602 / 0.9460 | 7.12 (1.61 / 1.92) | 83.9 / 86.9 %, 79.8 %, 56.3 %, 197 | 2.03 / 4.04 | 4.85 |
| `mr9_ispy2` 9bit | 8 | 56 | 4853.5 | 36.38 / 34.55 / 34.21 | 308 | 0.8641 / 0.8286 | 0.9263 / 0.9050 | 9.56 (1.60 / 1.91) | 86.0 / 91.2 %, 85.7 %, 69.5 %, 192 | 3.14 / 5.63 | 3.03 |
| `mr_ispy1` 11bit | 1 | 1 | 5.4 | 64.24 / 64.17 / 64.15 | 10 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.37 (0.32 / 0.34) | 60.0 / 60.9 %, 16.5 %, 0.2 %, 9 | 0.03 / 0.05 | 10.0 |
| `mr_ispy1` 11bit | 1 | 2 | 7.6 | 58.98 / 58.83 / 58.80 | 20 | 0.9988 / 0.9986 | 0.9998 / 0.9998 | 0.69 (0.47 / 0.48) | 77.1 / 77.8 %, 44.0 %, 7.9 %, 17 | 0.06 / 0.09 | 9.97 |
| `mr_ispy1` 11bit | 1 | 4 | 16.7 | 51.90 / 51.69 / 51.65 | 39 | 0.9936 / 0.9928 | 0.9989 / 0.9987 | 1.57 (0.78 / 0.80) | 89.2 / 89.7 %, 72.1 %, 42.8 %, 32 | 0.15 / 0.22 | 9.8 |
| `mr_ispy1` 11bit | 1 | 8 | 62.8 | 45.00 / 44.83 / 44.81 | 75 | 0.9682 / 0.9643 | 0.9931 / 0.9923 | 3.44 (1.03 / 1.05) | 94.9 / 95.3 %, 86.7 %, 71.2 %, 61 | 0.40 / 0.58 | 8.66 |
| `mr_ispy1` 11bit | 1 | 12 | 170.7 | 42.80 / 42.42 / 42.37 | 131 | 0.9501 / 0.9481 | 0.9875 / 0.9870 | 4.31 (1.05 / 1.06) | 95.9 / 96.3 %, 89.6 %, 76.5 %, 98 | 0.61 / 0.80 | 7.36 |
| `mr_ispy1` 11bit | 1 | 16 | 285.9 | 41.91 / 41.11 / 41.07 | 167 | 0.9406 / 0.9370 | 0.9840 / 0.9830 | 4.75 (1.06 / 1.08) | 96.1 / 96.6 %, 90.1 %, 78.4 %, 137 | 0.73 / 0.88 | 6.68 |
| `mr_ispy1` 11bit | 1 | 24 | 527.0 | 40.69 / 39.25 / 39.22 | 320 | 0.9283 / 0.9165 | 0.9789 / 0.9749 | 5.36 (1.06 / 1.10) | 96.4 / 96.8 %, 91.2 %, 80.3 %, 189 | 0.97 / 1.11 | 5.69 |
| `mr_ispy1` 11bit | 1 | 32 | 1094.0 | 39.64 / 37.45 / 37.35 | 433 | 0.9188 / 0.8931 | 0.9713 / 0.9601 | 5.81 (1.06 / 1.10) | 96.6 / 97.2 %, 92.2 %, 82.3 %, 209 | 1.02 / 1.23 | 4.64 |
| `mr_ispy1` 11bit | 1 | 40 | 2331.2 | 38.04 / 35.42 / 35.29 | 742 | 0.8996 / 0.8639 | 0.9600 / 0.9355 | 6.53 (1.06 / 1.10) | 97.1 / 97.6 %, 93.2 %, 83.9 %, 249 | 1.30 / 1.56 | 3.1 |
| `mr_ispy1` 11bit | 1 | 56 | 7619.3 | 35.17 / 31.67 / 31.57 | 1009 | 0.8690 / 0.8185 | 0.9386 / 0.8628 | 8.63 (1.05 / 1.09) | 97.9 / 98.4 %, 95.1 %, 87.8 %, 249 | 2.11 / 2.70 | 1.35 |
| `mr_ispy1` 11bit | 16 | 1 | 5.3 | 64.24 / 64.18 / 64.15 | 10 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.37 (0.32 / 0.34) | 59.9 / 60.7 %, 16.4 %, 0.2 %, 8 | 0.03 / 0.05 | 10.0 |
| `mr_ispy1` 11bit | 16 | 2 | 7.3 | 59.02 / 58.86 / 58.76 | 22 | 0.9988 / 0.9986 | 0.9998 / 0.9998 | 0.68 (0.47 / 0.48) | 77.0 / 77.9 %, 44.0 %, 8.1 %, 18 | 0.06 / 0.09 | 9.98 |
| `mr_ispy1` 11bit | 16 | 4 | 15.9 | 51.94 / 51.72 / 51.70 | 39 | 0.9936 / 0.9928 | 0.9989 / 0.9987 | 1.55 (0.77 / 0.80) | 89.3 / 89.7 %, 72.2 %, 42.7 %, 32 | 0.15 / 0.21 | 9.81 |
| `mr_ispy1` 11bit | 16 | 8 | 63.1 | 44.94 / 44.76 / 44.72 | 83 | 0.9678 / 0.9635 | 0.9930 / 0.9918 | 3.44 (1.04 / 1.06) | 94.9 / 95.2 %, 86.7 %, 71.2 %, 66 | 0.41 / 0.60 | 8.66 |
| `mr_ispy1` 11bit | 16 | 12 | 173.2 | 42.78 / 42.41 / 42.34 | 115 | 0.9504 / 0.9481 | 0.9874 / 0.9869 | 4.32 (1.05 / 1.07) | 95.9 / 96.1 %, 89.1 %, 76.3 %, 94 | 0.61 / 0.79 | 7.39 |
| `mr_ispy1` 11bit | 16 | 16 | 298.1 | 41.93 / 41.10 / 41.06 | 223 | 0.9410 / 0.9379 | 0.9839 / 0.9831 | 4.74 (1.06 / 1.08) | 96.1 / 96.4 %, 89.9 %, 77.9 %, 180 | 0.72 / 0.87 | 6.71 |
| `mr_ispy1` 11bit | 16 | 24 | 599.5 | 40.70 / 39.32 / 39.27 | 320 | 0.9287 / 0.9183 | 0.9775 / 0.9737 | 5.31 (1.06 / 1.10) | 96.3 / 96.8 %, 90.8 %, 79.7 %, 221 | 0.88 / 1.05 | 5.68 |
| `mr_ispy1` 11bit | 16 | 32 | 1387.6 | 39.52 / 37.19 / 37.11 | 524 | 0.9191 / 0.8922 | 0.9702 / 0.9566 | 5.88 (1.06 / 1.10) | 96.6 / 97.1 %, 92.0 %, 81.9 %, 237 | 1.02 / 1.28 | 4.49 |
| `mr_ispy1` 11bit | 16 | 40 | 3328.8 | 37.97 / 35.08 / 34.93 | 754 | 0.9015 / 0.8637 | 0.9580 / 0.9301 | 6.58 (1.06 / 1.10) | 97.0 / 97.4 %, 92.9 %, 83.9 %, 253 | 1.28 / 1.59 | 3.03 |
| `mr_ispy1` 11bit | 16 | 56 | 13710.0 | 35.43 / 31.47 / 31.13 | 1084 | 0.8786 / 0.8175 | 0.9374 / 0.8514 | 8.48 (1.06 / 1.11) | 97.8 / 98.2 %, 95.0 %, 87.5 %, 249 | 2.06 / 2.78 | 1.15 |
| `mr_ispy1` 11bit | 8 | 1 | 5.3 | 64.26 / 64.18 / 64.15 | 10 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.37 (0.32 / 0.34) | 60.0 / 60.8 %, 16.4 %, 0.2 %, 8 | 0.03 / 0.05 | 10.0 |
| `mr_ispy1` 11bit | 8 | 2 | 7.3 | 59.04 / 58.87 / 58.76 | 20 | 0.9988 / 0.9986 | 0.9998 / 0.9998 | 0.68 (0.47 / 0.48) | 77.0 / 77.9 %, 44.0 %, 8.1 %, 17 | 0.06 / 0.09 | 9.97 |
| `mr_ispy1` 11bit | 8 | 4 | 15.9 | 51.96 / 51.72 / 51.68 | 46 | 0.9936 / 0.9928 | 0.9989 / 0.9987 | 1.55 (0.77 / 0.80) | 89.2 / 89.8 %, 72.2 %, 42.8 %, 38 | 0.15 / 0.22 | 9.82 |
| `mr_ispy1` 11bit | 8 | 8 | 63.2 | 44.94 / 44.74 / 44.67 | 86 | 0.9674 / 0.9632 | 0.9929 / 0.9918 | 3.44 (1.04 / 1.06) | 95.0 / 95.2 %, 86.7 %, 71.2 %, 70 | 0.41 / 0.60 | 8.62 |
| `mr_ispy1` 11bit | 8 | 12 | 173.0 | 42.79 / 42.42 / 42.38 | 125 | 0.9503 / 0.9480 | 0.9874 / 0.9868 | 4.32 (1.05 / 1.06) | 95.9 / 96.1 %, 89.1 %, 76.4 %, 96 | 0.62 / 0.81 | 7.35 |
| `mr_ispy1` 11bit | 8 | 16 | 295.7 | 41.91 / 41.10 / 41.07 | 226 | 0.9409 / 0.9376 | 0.9838 / 0.9830 | 4.74 (1.06 / 1.08) | 96.1 / 96.5 %, 90.1 %, 78.2 %, 185 | 0.73 / 0.87 | 6.65 |
| `mr_ispy1` 11bit | 8 | 24 | 590.0 | 40.69 / 39.34 / 39.29 | 332 | 0.9297 / 0.9185 | 0.9779 / 0.9740 | 5.29 (1.06 / 1.10) | 96.3 / 96.8 %, 91.0 %, 79.7 %, 218 | 0.88 / 1.10 | 5.63 |
| `mr_ispy1` 11bit | 8 | 32 | 1347.8 | 39.55 / 37.18 / 37.04 | 618 | 0.9196 / 0.8913 | 0.9705 / 0.9554 | 5.86 (1.06 / 1.10) | 96.6 / 97.1 %, 92.0 %, 81.8 %, 237 | 1.02 / 1.25 | 4.52 |
| `mr_ispy1` 11bit | 8 | 40 | 3187.2 | 38.01 / 35.16 / 35.04 | 753 | 0.9010 / 0.8641 | 0.9583 / 0.9302 | 6.52 (1.06 / 1.10) | 97.1 / 97.6 %, 93.1 %, 84.1 %, 237 | 1.28 / 1.59 | 2.95 |
| `mr_ispy1` 11bit | 8 | 56 | 12723.3 | 35.28 / 31.41 / 31.28 | 1084 | 0.8756 / 0.8211 | 0.9392 / 0.8535 | 8.20 (1.06 / 1.10) | 97.9 / 98.2 %, 94.7 %, 86.9 %, 249 | 2.01 / 2.68 | 1.19 |
| `mr_ispy1` top10 | 1 | 1 | 4.6 | 63.13 / 63.10 / 63.07 | 8 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.42 (0.37 / 0.39) | 61.7 / 62.0 %, 21.8 %, 0.3 %, 7 | 0.06 / 0.09 | — |
| `mr_ispy1` top10 | 1 | 2 | 7.2 | 60.13 / 60.06 / 60.04 | 19 | 0.9990 / 0.9989 | 0.9999 / 0.9998 | 0.60 (0.45 / 0.47) | 73.3 / 73.7 %, 37.5 %, 4.7 %, 16 | 0.08 / 0.11 | — |
| `mr_ispy1` top10 | 1 | 4 | 11.1 | 55.55 / 55.42 / 55.41 | 28 | 0.9972 / 0.9970 | 0.9995 / 0.9995 | 1.02 (0.61 / 0.62) | 84.0 / 84.5 %, 59.2 %, 23.0 %, 23 | 0.11 / 0.16 | — |
| `mr_ispy1` top10 | 1 | 8 | 22.1 | 49.71 / 49.54 / 49.46 | 46 | 0.9893 / 0.9880 | 0.9980 / 0.9978 | 1.99 (0.89 / 0.91) | 91.7 / 92.0 %, 78.0 %, 53.5 %, 38 | 0.21 / 0.30 | — |
| `mr_ispy1` top10 | 1 | 12 | 42.0 | 46.35 / 46.18 / 46.13 | 66 | 0.9767 / 0.9739 | 0.9953 / 0.9948 | 2.95 (1.01 / 1.04) | 94.3 / 94.6 %, 84.6 %, 66.7 %, 49 | 0.33 / 0.47 | — |
| `mr_ispy1` top10 | 1 | 16 | 80.8 | 44.33 / 44.27 / 44.22 | 82 | 0.9629 / 0.9596 | 0.9916 / 0.9908 | 3.68 (1.04 / 1.06) | 95.5 / 95.8 %, 87.6 %, 72.7 %, 67 | 0.46 / 0.65 | — |
| `mr_ispy1` top10 | 1 | 24 | 177.4 | 42.76 / 42.33 / 42.32 | 146 | 0.9499 / 0.9480 | 0.9874 / 0.9870 | 4.33 (1.05 / 1.07) | 96.2 / 96.4 %, 89.5 %, 76.7 %, 120 | 0.62 / 0.79 | — |
| `mr_ispy1` top10 | 1 | 32 | 377.3 | 41.55 / 40.39 / 40.36 | 204 | 0.9369 / 0.9304 | 0.9820 / 0.9799 | 4.92 (1.06 / 1.08) | 96.4 / 96.7 %, 90.5 %, 79.1 %, 167 | 0.77 / 0.89 | — |
| `mr_ispy1` top10 | 1 | 40 | 741.1 | 40.42 / 38.62 / 38.59 | 366 | 0.9261 / 0.9096 | 0.9759 / 0.9699 | 5.46 (1.06 / 1.10) | 96.6 / 97.0 %, 91.5 %, 80.6 %, 221 | 0.91 / 1.08 | — |
| `mr_ispy1` top10 | 1 | 56 | 3085.6 | 37.72 / 34.87 / 34.68 | 837 | 0.8945 / 0.8582 | 0.9559 / 0.9255 | 6.58 (1.06 / 1.11) | 97.2 / 97.7 %, 93.1 %, 84.2 %, 249 | 1.32 / 1.63 | — |
| `mr_ispy1` top10 | 16 | 1 | 4.6 | 63.12 / 63.07 / 63.05 | 8 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.43 (0.37 / 0.39) | 61.8 / 62.0 %, 22.0 %, 0.3 %, 7 | 0.06 / 0.09 | — |
| `mr_ispy1` top10 | 16 | 2 | 6.6 | 60.24 / 60.13 / 60.09 | 23 | 0.9991 / 0.9990 | 0.9999 / 0.9998 | 0.59 (0.45 / 0.46) | 72.9 / 73.6 %, 37.5 %, 4.5 %, 19 | 0.08 / 0.11 | — |
| `mr_ispy1` top10 | 16 | 4 | 10.8 | 55.60 / 55.46 / 55.43 | 31 | 0.9973 / 0.9970 | 0.9996 / 0.9995 | 1.01 (0.61 / 0.62) | 84.0 / 84.5 %, 59.1 %, 23.0 %, 26 | 0.11 / 0.16 | — |
| `mr_ispy1` top10 | 16 | 8 | 21.8 | 49.67 / 49.48 / 49.46 | 52 | 0.9892 / 0.9880 | 0.9980 / 0.9978 | 2.01 (0.89 / 0.91) | 91.8 / 92.0 %, 78.0 %, 53.5 %, 43 | 0.21 / 0.30 | — |
| `mr_ispy1` top10 | 16 | 12 | 42.2 | 46.22 / 46.06 / 46.02 | 68 | 0.9759 / 0.9732 | 0.9951 / 0.9946 | 2.99 (1.02 / 1.04) | 94.4 / 94.6 %, 85.0 %, 67.0 %, 56 | 0.34 / 0.48 | — |
| `mr_ispy1` top10 | 16 | 16 | 82.5 | 44.26 / 44.18 / 44.15 | 85 | 0.9625 / 0.9591 | 0.9914 / 0.9905 | 3.70 (1.05 / 1.06) | 95.5 / 95.8 %, 87.4 %, 72.9 %, 70 | 0.47 / 0.67 | — |
| `mr_ispy1` top10 | 16 | 24 | 185.7 | 42.70 / 42.27 / 42.25 | 159 | 0.9493 / 0.9473 | 0.9870 / 0.9864 | 4.37 (1.06 / 1.07) | 96.3 / 96.4 %, 89.3 %, 76.6 %, 130 | 0.64 / 0.81 | — |
| `mr_ispy1` top10 | 16 | 32 | 408.6 | 41.44 / 40.34 / 40.31 | 237 | 0.9361 / 0.9301 | 0.9814 / 0.9796 | 5.00 (1.06 / 1.09) | 96.3 / 96.6 %, 90.3 %, 79.0 %, 178 | 0.79 / 0.93 | — |
| `mr_ispy1` top10 | 16 | 40 | 847.6 | 40.29 / 38.52 / 38.43 | 409 | 0.9252 / 0.9079 | 0.9748 / 0.9687 | 5.54 (1.06 / 1.10) | 96.8 / 97.0 %, 91.5 %, 80.4 %, 207 | 0.92 / 1.11 | — |
| `mr_ispy1` top10 | 16 | 56 | 4141.2 | 37.66 / 34.68 / 34.58 | 734 | 0.8930 / 0.8574 | 0.9552 / 0.9238 | 6.77 (1.06 / 1.12) | 97.4 / 97.7 %, 92.8 %, 84.1 %, 249 | 1.34 / 1.69 | — |
| `mr_ispy1` top10 | 8 | 1 | 4.6 | 63.12 / 63.08 / 63.07 | 9 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.43 (0.37 / 0.39) | 61.8 / 62.0 %, 22.0 %, 0.3 %, 8 | 0.06 / 0.09 | — |
| `mr_ispy1` top10 | 8 | 2 | 6.6 | 60.24 / 60.10 / 60.05 | 23 | 0.9991 / 0.9989 | 0.9999 / 0.9998 | 0.59 (0.45 / 0.47) | 72.9 / 73.6 %, 37.5 %, 4.5 %, 19 | 0.08 / 0.11 | — |
| `mr_ispy1` top10 | 8 | 4 | 10.8 | 55.59 / 55.46 / 55.43 | 30 | 0.9973 / 0.9970 | 0.9996 / 0.9995 | 1.01 (0.61 / 0.62) | 84.0 / 84.5 %, 59.1 %, 23.0 %, 24 | 0.11 / 0.16 | — |
| `mr_ispy1` top10 | 8 | 8 | 21.8 | 49.68 / 49.52 / 49.43 | 54 | 0.9892 / 0.9879 | 0.9980 / 0.9978 | 2.01 (0.89 / 0.91) | 91.8 / 92.0 %, 78.0 %, 53.5 %, 44 | 0.21 / 0.30 | — |
| `mr_ispy1` top10 | 8 | 12 | 42.1 | 46.23 / 46.07 / 46.03 | 63 | 0.9758 / 0.9732 | 0.9951 / 0.9946 | 2.98 (1.02 / 1.05) | 94.4 / 94.6 %, 84.8 %, 67.0 %, 51 | 0.34 / 0.48 | — |
| `mr_ispy1` top10 | 8 | 16 | 82.3 | 44.27 / 44.19 / 44.16 | 85 | 0.9623 / 0.9588 | 0.9913 / 0.9905 | 3.70 (1.05 / 1.06) | 95.5 / 95.8 %, 87.4 %, 72.8 %, 70 | 0.47 / 0.66 | — |
| `mr_ispy1` top10 | 8 | 24 | 185.0 | 42.70 / 42.27 / 42.26 | 143 | 0.9492 / 0.9472 | 0.9870 / 0.9861 | 4.38 (1.06 / 1.07) | 96.2 / 96.4 %, 89.3 %, 76.8 %, 117 | 0.64 / 0.83 | — |
| `mr_ispy1` top10 | 8 | 32 | 403.4 | 41.49 / 40.36 / 40.32 | 231 | 0.9363 / 0.9300 | 0.9814 / 0.9795 | 4.98 (1.06 / 1.08) | 96.3 / 96.7 %, 90.3 %, 78.9 %, 183 | 0.79 / 0.91 | — |
| `mr_ispy1` top10 | 8 | 40 | 836.5 | 40.37 / 38.51 / 38.46 | 417 | 0.9254 / 0.9084 | 0.9750 / 0.9686 | 5.54 (1.07 / 1.10) | 96.7 / 97.1 %, 91.5 %, 80.9 %, 191 | 0.91 / 1.11 | — |
| `mr_ispy1` top10 | 8 | 56 | 3973.4 | 37.68 / 34.74 / 34.60 | 812 | 0.8928 / 0.8552 | 0.9550 / 0.9244 | 6.73 (1.06 / 1.12) | 97.4 / 97.8 %, 92.9 %, 84.4 %, 249 | 1.36 / 1.69 | — |
| `mr_ispy1` window | 1 | 1 | 2.4 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9918 / 0.9425 | 0.02 (0.19 / 0.44) | 0.4 / 0.5 %, 0.0 %, 0.0 %, 1 | 0.00 / 0.00 | — |
| `mr_ispy1` window | 1 | 2 | 3.0 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9917 / 0.9425 | 0.09 (0.21 / 0.45) | 8.2 / 8.5 %, 0.0 %, 0.0 %, 2 | 0.01 / 0.01 | — |
| `mr_ispy1` window | 1 | 4 | 4.1 | 41.53 / 29.54 / 28.61 | 1453 | 0.9931 / 0.9694 | 0.9917 / 0.9425 | 0.20 (0.27 / 0.48) | 33.9 / 35.2 %, 1.3 %, 0.0 %, 4 | 0.02 / 0.02 | — |
| `mr_ispy1` window | 1 | 8 | 6.0 | 41.51 / 29.54 / 28.61 | 1453 | 0.9928 / 0.9692 | 0.9917 / 0.9424 | 0.39 (0.38 / 0.54) | 60.4 / 61.0 %, 17.7 %, 0.3 %, 12 | 0.03 / 0.05 | — |
| `mr_ispy1` window | 1 | 12 | 7.7 | 41.47 / 29.54 / 28.61 | 1453 | 0.9923 / 0.9687 | 0.9916 / 0.9423 | 0.57 (0.46 / 0.59) | 72.1 / 72.7 %, 35.2 %, 3.8 %, 16 | 0.05 / 0.07 | — |
| `mr_ispy1` window | 1 | 16 | 9.3 | 41.43 / 29.54 / 28.60 | 1453 | 0.9917 / 0.9681 | 0.9915 / 0.9422 | 0.75 (0.54 / 0.65) | 78.4 / 78.9 %, 47.4 %, 10.9 %, 24 | 0.07 / 0.10 | — |
| `mr_ispy1` window | 1 | 24 | 12.3 | 41.32 / 29.53 / 28.60 | 1453 | 0.9899 / 0.9665 | 0.9911 / 0.9418 | 1.10 (0.66 / 0.74) | 84.9 / 85.3 %, 62.1 %, 26.8 %, 29 | 0.10 / 0.15 | — |
| `mr_ispy1` window | 1 | 32 | 19.6 | 41.00 / 29.50 / 28.58 | 1453 | 0.9846 / 0.9617 | 0.9900 / 0.9408 | 1.78 (0.85 / 0.89) | 90.4 / 90.7 %, 75.3 %, 48.5 %, 40 | 0.18 / 0.25 | — |
| `mr_ispy1` window | 1 | 40 | 39.5 | 40.33 / 29.45 / 28.53 | 1473 | 0.9718 / 0.9501 | 0.9872 / 0.9380 | 2.81 (1.01 / 1.02) | 93.8 / 94.0 %, 83.7 %, 65.0 %, 56 | 0.31 / 0.43 | — |
| `mr_ispy1` window | 1 | 56 | 369.6 | 38.66 / 29.22 / 28.33 | 1469 | 0.9328 / 0.9081 | 0.9748 / 0.9248 | 4.74 (1.06 / 1.08) | 96.1 / 96.4 %, 90.1 %, 78.2 %, 146 | 0.71 / 0.85 | — |
| `mr_ispy1` window | 16 | 1 | 2.4 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9918 / 0.9425 | 0.02 (0.19 / 0.44) | 0.4 / 0.7 %, 0.0 %, 0.0 %, 2 | 0.00 / 0.00 | — |
| `mr_ispy1` window | 16 | 2 | 3.0 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9917 / 0.9425 | 0.09 (0.21 / 0.45) | 8.1 / 8.6 %, 0.0 %, 0.0 %, 3 | 0.01 / 0.01 | — |
| `mr_ispy1` window | 16 | 4 | 3.9 | 41.53 / 29.54 / 28.61 | 1453 | 0.9931 / 0.9694 | 0.9917 / 0.9425 | 0.19 (0.27 / 0.48) | 32.4 / 35.0 %, 1.3 %, 0.0 %, 4 | 0.02 / 0.02 | — |
| `mr_ispy1` window | 16 | 8 | 5.7 | 41.51 / 29.54 / 28.61 | 1453 | 0.9928 / 0.9692 | 0.9917 / 0.9424 | 0.37 (0.37 / 0.54) | 59.5 / 60.9 %, 17.6 %, 0.3 %, 10 | 0.03 / 0.04 | — |
| `mr_ispy1` window | 16 | 12 | 7.4 | 41.48 / 29.54 / 28.61 | 1453 | 0.9924 / 0.9687 | 0.9916 / 0.9423 | 0.56 (0.46 / 0.60) | 71.7 / 72.6 %, 35.2 %, 3.8 %, 23 | 0.05 / 0.07 | — |
| `mr_ispy1` window | 16 | 16 | 8.9 | 41.43 / 29.54 / 28.60 | 1453 | 0.9917 / 0.9682 | 0.9915 / 0.9422 | 0.75 (0.53 / 0.65) | 78.2 / 78.9 %, 47.4 %, 10.9 %, 29 | 0.07 / 0.10 | — |
| `mr_ispy1` window | 16 | 24 | 11.9 | 41.32 / 29.53 / 28.59 | 1453 | 0.9900 / 0.9666 | 0.9912 / 0.9419 | 1.09 (0.65 / 0.75) | 84.6 / 85.1 %, 61.6 %, 26.6 %, 40 | 0.10 / 0.14 | — |
| `mr_ispy1` window | 16 | 32 | 18.9 | 41.01 / 29.50 / 28.57 | 1453 | 0.9847 / 0.9619 | 0.9901 / 0.9410 | 1.77 (0.85 / 0.90) | 90.2 / 90.6 %, 75.2 %, 48.5 %, 45 | 0.17 / 0.25 | — |
| `mr_ispy1` window | 16 | 40 | 38.4 | 40.31 / 29.45 / 28.53 | 1456 | 0.9714 / 0.9501 | 0.9872 / 0.9383 | 2.83 (1.02 / 1.03) | 93.7 / 94.0 %, 83.8 %, 65.7 %, 64 | 0.31 / 0.44 | — |
| `mr_ispy1` window | 16 | 56 | 370.0 | 38.64 / 29.22 / 28.34 | 1453 | 0.9325 / 0.9078 | 0.9745 / 0.9244 | 4.75 (1.06 / 1.09) | 96.2 / 96.4 %, 90.1 %, 78.3 %, 146 | 0.72 / 0.87 | — |
| `mr_ispy1` window | 8 | 1 | 2.4 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9918 / 0.9425 | 0.02 (0.19 / 0.44) | 0.4 / 0.7 %, 0.0 %, 0.0 %, 2 | 0.00 / 0.00 | — |
| `mr_ispy1` window | 8 | 2 | 3.0 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9917 / 0.9425 | 0.09 (0.21 / 0.45) | 8.1 / 8.6 %, 0.0 %, 0.0 %, 3 | 0.01 / 0.01 | — |
| `mr_ispy1` window | 8 | 4 | 4.0 | 41.53 / 29.54 / 28.61 | 1453 | 0.9931 / 0.9694 | 0.9917 / 0.9425 | 0.19 (0.27 / 0.48) | 32.4 / 35.0 %, 1.3 %, 0.0 %, 4 | 0.02 / 0.02 | — |
| `mr_ispy1` window | 8 | 8 | 5.7 | 41.51 / 29.54 / 28.61 | 1453 | 0.9928 / 0.9692 | 0.9917 / 0.9424 | 0.38 (0.37 / 0.54) | 59.5 / 60.9 %, 17.6 %, 0.3 %, 10 | 0.03 / 0.05 | — |
| `mr_ispy1` window | 8 | 12 | 7.4 | 41.48 / 29.54 / 28.60 | 1453 | 0.9924 / 0.9687 | 0.9916 / 0.9423 | 0.57 (0.46 / 0.59) | 71.7 / 72.6 %, 35.2 %, 3.8 %, 23 | 0.05 / 0.07 | — |
| `mr_ispy1` window | 8 | 16 | 8.9 | 41.43 / 29.54 / 28.60 | 1453 | 0.9917 / 0.9681 | 0.9915 / 0.9422 | 0.75 (0.53 / 0.65) | 78.2 / 78.9 %, 47.4 %, 10.9 %, 28 | 0.07 / 0.10 | — |
| `mr_ispy1` window | 8 | 24 | 11.9 | 41.32 / 29.53 / 28.59 | 1453 | 0.9900 / 0.9666 | 0.9912 / 0.9419 | 1.09 (0.66 / 0.74) | 84.7 / 85.2 %, 61.6 %, 26.6 %, 40 | 0.10 / 0.15 | — |
| `mr_ispy1` window | 8 | 32 | 18.9 | 41.01 / 29.50 / 28.57 | 1453 | 0.9848 / 0.9619 | 0.9901 / 0.9410 | 1.77 (0.85 / 0.90) | 90.2 / 90.6 %, 75.2 %, 48.5 %, 45 | 0.17 / 0.25 | — |
| `mr_ispy1` window | 8 | 40 | 38.5 | 40.31 / 29.45 / 28.53 | 1456 | 0.9712 / 0.9499 | 0.9872 / 0.9382 | 2.83 (1.01 / 1.04) | 93.7 / 94.0 %, 83.8 %, 65.7 %, 63 | 0.31 / 0.44 | — |
| `mr_ispy1` window | 8 | 56 | 368.6 | 38.65 / 29.22 / 28.33 | 1453 | 0.9319 / 0.9074 | 0.9745 / 0.9245 | 4.76 (1.06 / 1.09) | 96.2 / 96.4 %, 90.1 %, 78.1 %, 136 | 0.72 / 0.88 | — |
| `ustrus_1` 8bit | 1 | 1 | 3.3 | 57.35 / 56.96 / 56.93 | 3 | 0.9988 / 0.9984 | 0.9999 / 0.9998 | 0.24 (0.24 / 0.49) | 15.7 / 17.0 %, 0.0 %, 0.0 %, 3 | 0.06 / 0.08 | 10.0 |
| `ustrus_1` 8bit | 1 | 2 | 3.9 | 54.38 / 54.26 / 54.19 | 5 | 0.9977 / 0.9966 | 0.9997 / 0.9995 | 0.34 (0.34 / 0.69) | 30.0 / 30.7 %, 0.4 %, 0.0 %, 5 | 0.08 / 0.12 | 10.0 |
| `ustrus_1` 8bit | 1 | 4 | 5.2 | 51.01 / 50.92 / 50.89 | 22 | 0.9949 / 0.9925 | 0.9993 / 0.9989 | 0.50 (0.49 / 0.99) | 50.9 / 51.7 %, 5.7 %, 0.0 %, 22 | 0.11 / 0.17 | 10.0 |
| `ustrus_1` 8bit | 1 | 8 | 8.0 | 47.02 / 46.71 / 46.65 | 38 | 0.9868 / 0.9829 | 0.9982 / 0.9973 | 0.80 (0.76 / 1.30) | 68.3 / 69.5 %, 24.6 %, 1.0 %, 38 | 0.18 / 0.28 | 9.99 |
| `ustrus_1` 8bit | 1 | 12 | 11.1 | 44.77 / 43.96 / 43.89 | 38 | 0.9777 / 0.9746 | 0.9966 / 0.9951 | 1.06 (0.96 / 1.42) | 75.4 / 77.5 %, 39.5 %, 5.7 %, 38 | 0.26 / 0.40 | 9.98 |
| `ustrus_1` 8bit | 1 | 16 | 14.5 | 43.29 / 41.98 / 41.89 | 38 | 0.9696 / 0.9667 | 0.9949 / 0.9929 | 1.28 (1.11 / 1.48) | 79.4 / 82.1 %, 49.9 %, 12.7 %, 38 | 0.33 / 0.50 | 9.96 |
| `ustrus_1` 8bit | 1 | 24 | 22.4 | 41.21 / 39.27 / 39.11 | 38 | 0.9549 / 0.9473 | 0.9911 / 0.9881 | 1.66 (1.33 / 1.59) | 83.2 / 86.6 %, 61.4 %, 25.2 %, 38 | 0.46 / 0.72 | 9.89 |
| `ustrus_1` 8bit | 1 | 32 | 42.7 | 38.86 / 36.16 / 36.00 | 73 | 0.9337 / 0.9101 | 0.9826 / 0.9781 | 2.20 (1.47 / 1.81) | 86.5 / 90.2 %, 71.1 %, 39.6 %, 73 | 0.72 / 1.14 | 9.69 |
| `ustrus_1` 8bit | 1 | 40 | 81.8 | 37.04 / 33.54 / 33.40 | 94 | 0.9087 / 0.8601 | 0.9701 / 0.9660 | 2.75 (1.62 / 2.01) | 88.5 / 92.4 %, 77.2 %, 51.2 %, 94 | 1.10 / 1.77 | 9.28 |
| `ustrus_1` 8bit | 1 | 56 | 308.3 | 33.05 / 29.16 / 28.78 | 181 | 0.8291 / 0.7155 | 0.9299 / 0.8878 | 4.14 (1.71 / 4.94) | 91.4 / 95.1 %, 85.3 %, 66.3 %, 181 | 2.24 / 3.71 | 7.54 |
| `ustrus_1` 8bit | 16 | 1 | 3.8 | 56.78 / 56.21 / 56.09 | 6 | 0.9986 / 0.9982 | 0.9998 / 0.9997 | 0.26 (0.26 / 0.51) | 18.4 / 20.5 %, 0.1 %, 0.0 %, 6 | 0.06 / 0.10 | 10.0 |
| `ustrus_1` 8bit | 16 | 2 | 4.5 | 54.12 / 53.79 / 53.76 | 11 | 0.9975 / 0.9965 | 0.9997 / 0.9995 | 0.35 (0.35 / 0.71) | 32.2 / 34.3 %, 0.5 %, 0.0 %, 11 | 0.08 / 0.13 | 10.0 |
| `ustrus_1` 8bit | 16 | 4 | 6.2 | 50.72 / 50.62 / 50.57 | 13 | 0.9946 / 0.9921 | 0.9993 / 0.9989 | 0.52 (0.51 / 1.02) | 52.9 / 53.5 %, 6.4 %, 0.0 %, 13 | 0.11 / 0.18 | 10.0 |
| `ustrus_1` 8bit | 16 | 8 | 10.4 | 46.92 / 46.53 / 46.47 | 28 | 0.9867 / 0.9827 | 0.9981 / 0.9972 | 0.81 (0.76 / 1.32) | 68.8 / 70.2 %, 25.5 %, 1.3 %, 28 | 0.19 / 0.29 | 9.99 |
| `ustrus_1` 8bit | 16 | 12 | 15.2 | 44.72 / 43.77 / 43.66 | 32 | 0.9778 / 0.9745 | 0.9966 / 0.9950 | 1.07 (0.97 / 1.44) | 75.8 / 78.0 %, 40.8 %, 6.5 %, 32 | 0.26 / 0.41 | 9.97 |
| `ustrus_1` 8bit | 16 | 16 | 20.5 | 43.31 / 41.84 / 41.72 | 35 | 0.9697 / 0.9666 | 0.9948 / 0.9927 | 1.29 (1.11 / 1.49) | 79.5 / 82.4 %, 50.6 %, 13.3 %, 35 | 0.33 / 0.51 | 9.95 |
| `ustrus_1` 8bit | 16 | 24 | 33.5 | 41.13 / 39.17 / 38.99 | 50 | 0.9548 / 0.9470 | 0.9908 / 0.9877 | 1.66 (1.33 / 1.59) | 83.3 / 86.7 %, 61.8 %, 26.0 %, 50 | 0.48 / 0.76 | 9.87 |
| `ustrus_1` 8bit | 16 | 32 | 69.5 | 38.76 / 36.10 / 35.92 | 133 | 0.9331 / 0.9103 | 0.9819 / 0.9763 | 2.23 (1.48 / 1.80) | 86.8 / 90.3 %, 71.6 %, 40.5 %, 133 | 0.75 / 1.25 | 9.63 |
| `ustrus_1` 8bit | 16 | 40 | 148.4 | 36.89 / 33.52 / 33.26 | 175 | 0.9076 / 0.8594 | 0.9685 / 0.9642 | 2.79 (1.62 / 2.05) | 88.8 / 92.5 %, 77.7 %, 51.7 %, 175 | 1.14 / 1.95 | 9.12 |
| `ustrus_1` 8bit | 16 | 56 | 710.5 | 32.90 / 28.95 / 28.57 | 195 | 0.8353 / 0.7157 | 0.9288 / 0.8865 | 4.30 (1.71 / 5.12) | 91.8 / 95.0 %, 85.1 %, 66.3 %, 195 | 2.33 / 3.88 | 7.26 |
| `ustrus_1` 8bit | 8 | 1 | 3.7 | 56.83 / 56.21 / 56.11 | 8 | 0.9986 / 0.9982 | 0.9998 / 0.9997 | 0.26 (0.26 / 0.51) | 18.2 / 20.4 %, 0.1 %, 0.0 %, 8 | 0.06 / 0.10 | 10.0 |
| `ustrus_1` 8bit | 8 | 2 | 4.5 | 54.16 / 53.79 / 53.74 | 11 | 0.9975 / 0.9965 | 0.9997 / 0.9995 | 0.35 (0.35 / 0.71) | 32.0 / 34.4 %, 0.6 %, 0.0 %, 11 | 0.08 / 0.13 | 10.0 |
| `ustrus_1` 8bit | 8 | 4 | 6.1 | 50.74 / 50.62 / 50.58 | 13 | 0.9946 / 0.9920 | 0.9993 / 0.9989 | 0.51 (0.51 / 1.02) | 52.8 / 53.4 %, 6.4 %, 0.0 %, 13 | 0.11 / 0.18 | 10.0 |
| `ustrus_1` 8bit | 8 | 8 | 10.2 | 46.93 / 46.53 / 46.46 | 28 | 0.9867 / 0.9827 | 0.9981 / 0.9972 | 0.82 (0.77 / 1.32) | 68.7 / 70.0 %, 25.6 %, 1.3 %, 28 | 0.19 / 0.29 | 9.99 |
| `ustrus_1` 8bit | 8 | 12 | 14.8 | 44.70 / 43.77 / 43.70 | 32 | 0.9778 / 0.9743 | 0.9966 / 0.9950 | 1.07 (0.97 / 1.43) | 75.7 / 78.0 %, 40.5 %, 6.4 %, 32 | 0.26 / 0.41 | 9.98 |
| `ustrus_1` 8bit | 8 | 16 | 20.0 | 43.26 / 41.85 / 41.74 | 32 | 0.9698 / 0.9664 | 0.9948 / 0.9928 | 1.29 (1.12 / 1.49) | 79.5 / 82.4 %, 50.6 %, 13.3 %, 32 | 0.33 / 0.51 | 9.95 |
| `ustrus_1` 8bit | 8 | 24 | 32.5 | 41.13 / 39.16 / 38.99 | 37 | 0.9546 / 0.9471 | 0.9908 / 0.9866 | 1.66 (1.34 / 1.59) | 83.4 / 86.8 %, 61.8 %, 26.0 %, 37 | 0.48 / 0.78 | 9.88 |
| `ustrus_1` 8bit | 8 | 32 | 67.1 | 38.77 / 36.08 / 35.92 | 91 | 0.9334 / 0.9103 | 0.9819 / 0.9766 | 2.22 (1.48 / 1.80) | 86.7 / 90.3 %, 71.6 %, 40.5 %, 91 | 0.75 / 1.25 | 9.65 |
| `ustrus_1` 8bit | 8 | 40 | 141.8 | 36.91 / 33.48 / 33.24 | 181 | 0.9082 / 0.8594 | 0.9685 / 0.9645 | 2.79 (1.62 / 2.07) | 88.8 / 92.5 %, 77.8 %, 51.7 %, 181 | 1.13 / 1.95 | 9.18 |
| `ustrus_1` 8bit | 8 | 56 | 657.0 | 32.88 / 28.96 / 28.67 | 195 | 0.8322 / 0.7157 | 0.9287 / 0.8865 | 4.23 (1.71 / 5.00) | 91.6 / 95.1 %, 85.1 %, 66.6 %, 195 | 2.33 / 3.88 | 7.31 |

##### Knees: the rung farthest from each curve's chord (metric against ln bytes, both scaled 0 … 1)

| series, form | G | PSNR | MS-SSIM (dB of 1 − MS-SSIM) | noise-band e ÷ σ | ≥ 1 level | JOD |
| --- | --: | --: | --: | --: | --: | --: |
| `dbt12_c` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_c` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_c` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_c` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbt12_c` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbt12_c` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbt12_c` window | 1 | 32 | 32 | 32 | 24 | None |
| `dbt12_c` window | 16 | 32 | 32 | 32 | 24 | None |
| `dbt12_c` window | 8 | 32 | 32 | 32 | 24 | None |
| `dbts_a1` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a1` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a1` 12bit | 8 | 8 | 8 | 8 | 8 | 24 |
| `dbts_a1` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_a1` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_a1` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_a1` window | 1 | 40 | 32 | 32 | 24 | None |
| `dbts_a1` window | 16 | 40 | 32 | 32 | 24 | None |
| `dbts_a1` window | 8 | 40 | 32 | 32 | 24 | None |
| `dbts_c2` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c2` 12bit | 16 | 8 | 8 | 12 | 8 | 16 |
| `dbts_c2` 12bit | 8 | 8 | 8 | 12 | 8 | 16 |
| `dbts_c2` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_c2` top10 | 16 | 8 | 8 | 12 | 8 | None |
| `dbts_c2` top10 | 8 | 8 | 8 | 12 | 8 | None |
| `dbts_c2` window | 1 | 32 | 40 | 40 | 24 | None |
| `dbts_c2` window | 16 | 32 | 40 | 40 | 24 | None |
| `dbts_c2` window | 8 | 32 | 40 | 40 | 24 | None |
| `dbts_c3` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c3` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c3` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c3` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_c3` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_c3` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_c3` window | 1 | 32 | 32 | 32 | 24 | None |
| `dbts_c3` window | 16 | 32 | 32 | 32 | 24 | None |
| `dbts_c3` window | 8 | 32 | 32 | 32 | 24 | None |
| `mr9_ispy2` 9bit | 1 | 8 | 8 | 16 | 4 | 12 |
| `mr9_ispy2` 9bit | 16 | 8 | 8 | 16 | 4 | 12 |
| `mr9_ispy2` 9bit | 8 | 8 | 8 | 12 | 4 | 12 |
| `mr_ispy1` 11bit | 1 | 8 | 8 | 8 | 4 | 8 |
| `mr_ispy1` 11bit | 16 | 8 | 8 | 8 | 4 | 8 |
| `mr_ispy1` 11bit | 8 | 8 | 8 | 8 | 4 | 8 |
| `mr_ispy1` top10 | 1 | 12 | 12 | 12 | 8 | None |
| `mr_ispy1` top10 | 16 | 12 | 12 | 12 | 8 | None |
| `mr_ispy1` top10 | 8 | 12 | 12 | 12 | 8 | None |
| `mr_ispy1` window | 1 | 24 | 24 | 40 | 24 | None |
| `mr_ispy1` window | 16 | 24 | 24 | 40 | 24 | None |
| `mr_ispy1` window | 8 | 24 | 24 | 40 | 24 | None |
| `ustrus_1` 8bit | 1 | 16 | 16 | 24 | 12 | 32 |
| `ustrus_1` 8bit | 16 | 16 | 24 | 24 | 12 | 32 |
| `ustrus_1` 8bit | 8 | 16 | 24 | 24 | 12 | 32 |

##### Anchors: the highest Q from Q 1 up at which every frame holds

| series, form | G | noise-band e ≤ σ | e ≤ σ | every window ≤ 1 level | scroll, band < step | scroll, full < step |
| --- | --: | --: | --: | --: | --: | --: |
| `dbt12_c` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` window | 1 | 24 | None | None | None | None |
| `dbt12_c` window | 16 | 24 | None | None | None | None |
| `dbt12_c` window | 8 | 24 | None | None | None | None |
| `dbts_a1` 12bit | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` 12bit | 16 | 4 | 4 | None | 16 | 32 |
| `dbts_a1` 12bit | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` top10 | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` top10 | 16 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` top10 | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` window | 1 | 24 | None | None | None | None |
| `dbts_a1` window | 16 | 24 | None | None | None | None |
| `dbts_a1` window | 8 | 24 | None | None | None | None |
| `dbts_c2` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` window | 1 | 32 | None | None | None | None |
| `dbts_c2` window | 16 | 32 | None | None | None | None |
| `dbts_c2` window | 8 | 32 | None | None | None | None |
| `dbts_c3` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` window | 1 | 24 | None | None | None | None |
| `dbts_c3` window | 16 | 24 | None | None | None | None |
| `dbts_c3` window | 8 | 24 | None | None | None | None |
| `mr9_ispy2` 9bit | 1 | None | None | None | 4 | 16 |
| `mr9_ispy2` 9bit | 16 | 1 | None | None | 4 | 16 |
| `mr9_ispy2` 9bit | 8 | 1 | None | None | 4 | 16 |
| `mr_ispy1` 11bit | 1 | 4 | 2 | None | 16 | 40 |
| `mr_ispy1` 11bit | 16 | 4 | 2 | None | 16 | 32 |
| `mr_ispy1` 11bit | 8 | 4 | 2 | None | 16 | 40 |
| `mr_ispy1` top10 | 1 | 8 | 2 | None | 32 | 40 |
| `mr_ispy1` top10 | 16 | 8 | 2 | None | 32 | 40 |
| `mr_ispy1` top10 | 8 | 8 | 2 | None | 32 | 40 |
| `mr_ispy1` window | 1 | 32 | 16 | 1 | 56 | None |
| `mr_ispy1` window | 16 | 32 | 16 | None | 56 | None |
| `mr_ispy1` window | 8 | 32 | 16 | None | 56 | None |
| `ustrus_1` 8bit | 1 | 4 | 2 | None | 24 | 32 |
| `ustrus_1` 8bit | 16 | 2 | 2 | None | 24 | 32 |
| `ustrus_1` 8bit | 8 | 2 | 2 | None | 24 | 32 |

##### Controls

| series | HTJ2K B | lossless AV1 G 1 B | ratio HTJ2K | ratio AV1 |
| --- | --: | --: | --: | --: |
| `dbt12_c` | 64907190 | 61529449 | 3.11 | 3.28 |
| `dbts_a1` | 67812443 | 63912689 | 2.53 | 2.68 |
| `dbts_c2` | 60299025 | 57508945 | 2.35 | 2.46 |
| `dbts_c3` | 94483885 | 89298883 | 3.30 | 3.49 |
| `mr9_ispy2` | 1365691 | 1265527 | 3.82 | 4.13 |
| `mr_ispy1` | 10821976 | 10783183 | 2.81 | 2.82 |
| `ustrus_1` | 21200492 | 19196290 | 2.70 | 2.98 |

**Not run:** nothing of shard 1's assignment.

### Shard 4, measured (2026-11-04)

1. **Run:** shard 4 of §Shards in full: `dbts_c1`, `dbts_b1`, `dbts_b3`, `dbts_b5`, `ustrus_2`, `usb_cine_rgb`, every
   rung Q 1 … 56 at G 1, 8 and 16, every form (three on the 12-bit `dbts_c1`, one elsewhere): 240 cells, 6 series rows,
   12 control rows, and §7's checks on `ustrus_2`. No cell was cut.
2. **What it shows**, stored form, every G: PSNR's knee at Q 8 on `dbts_c1`, Q 12 on system B (Q 8 on `dbts_b5` at
   G 1), Q 12 on `ustrus_2` (Q 16 at G 8); anchor (a) by noise (e_N ≤ σ on every frame) to Q 8 on `dbts_c1` and `dbts_b5`, Q 8–12 on
   `dbts_b1`, Q 12 on `dbts_b3`, Q 4 on `ustrus_2`; by displayed levels at no rung on any series; anchor (b) in the band
   to Q 16 on `dbts_c1`, `dbts_b3`, `dbts_b5`, Q 24 on `dbts_b1` and `ustrus_2`. Full tables below.
3. **It rests on** these six sets only (one system-C and three system-B DBT volumes, one TRUS sweep, one lossy-sourced
   breast US cine, reported apart and in no verdict), libaom 3.15.1 at cpu6, dav1d 1.5.4, and the checks below, every
   one of which held and whose every mutation was seen.
4. **Host:** 4 cores (Intel Xeon @ 2.10 GHz), 15 GB, no swap; four cells in flight, one encode thread each, so the
   host is saturated on CPU by design and nothing past it is claimed. Encode wall ÷ CPU, from the rows: median 1.016
   (1.003–1.066). Wall clock 18:52–22:00 UTC, 3.1 h, against the plan's 3.33 h.
5. **Left:** ColorVideoVDP has no score on `usb_cine_rgb` (`cell.py` runs it on one-channel series only); every
   other stored-form cell has one. Everything §2 leaves open stays open; the collector combines the shards.

*Terms are §Terms'. **q-hist**: aomenc's `--q-hist` count of frames per quantizer.*

**Host and tools.** libaom 3.15.1, dav1d 1.5.4 and OpenJPH 0.31.0 built by `tools.sh`. Here too the built `dav1d`
loads the system's libdav1d 1.4.1 unless `LD_LIBRARY_PATH` names the built one; a first start ran the checks and three
control rows under 1.4.1, was stopped before any cell, and was discarded whole. The shard then ran from the start with
`LD_LIBRARY_PATH=lab/.av1-build/dav1d/lib` (`dav1d --version`: 1.5.4-0-g54706fc). The six sets were fetched by
`fetch_data.sh`, every raw frame checked against its pinned SHA-256; both controls of every set decoded every frame
exact (`ingest_coded.py`'s check). Memory was read once, during `dbts_b1` (the largest frames): 13 GB available.

**Fit.** `dbts_c1`'s 90 cells took 48 min against its 13 622 CPU s estimate (3 405 s at four cores, controls
included); projected from it the shard fit 4.5 h at G 1, 8 and 16, and it did.

**Read from every cell.** q-hist: every frame of all 240 cells at the cell's Q and no other; the count is the frame
count + 1 on every cell (reported as read). Temporal unit sizes are in the rows.

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

**`collect.py lab/av1/metrics/rows/shard-4.jsonl --partial`**, shard 4's series only:

##### Every cell

| series, form | G | Q | ratio | PSNR med / p5 / min dB | max \|Δ\| | SSIM med / min | MS-SSIM med / min | e ÷ σ med (noise band med / max) | window 1: ≥1 level med / max, ≥2 max, ≥4 max, max | scroll med / max | JOD |
| --- | --: | --: | --: | --- | --: | --- | --- | --- | --- | --- | --: |
| `dbts_b1` 10bit | 1 | 1 | 6.3 | 68.85 / 68.77 / 68.76 | 11 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.12 / 0.12) | 19.2 / 19.3 %, 0.0 %, 0.0 %, 2 | 0.03 / 0.04 | 10.0 |
| `dbts_b1` 10bit | 1 | 2 | 7.9 | 64.91 / 64.81 / 64.79 | 19 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.19) | 35.6 / 35.8 %, 0.4 %, 0.0 %, 3 | 0.05 / 0.06 | 10.0 |
| `dbts_b1` 10bit | 1 | 4 | 11.2 | 59.27 / 59.12 / 59.11 | 36 | 0.9990 / 0.9990 | 0.9999 / 0.9999 | 0.34 (0.36 / 0.38) | 60.8 / 61.1 %, 12.5 %, 0.0 %, 6 | 0.10 / 0.11 | 10.0 |
| `dbts_b1` 10bit | 1 | 8 | 22.7 | 51.94 / 51.86 / 51.85 | 131 | 0.9945 / 0.9944 | 0.9993 / 0.9993 | 0.80 (0.80 / 0.82) | 82.1 / 82.2 %, 49.9 %, 11.4 %, 29 | 0.22 / 0.25 | 9.96 |
| `dbts_b1` 10bit | 1 | 12 | 49.0 | 48.33 / 48.24 / 48.21 | 223 | 0.9873 / 0.9869 | 0.9982 / 0.9981 | 1.22 (0.99 / 1.00) | 88.0 / 88.2 %, 65.6 %, 29.9 %, 51 | 0.37 / 0.42 | 9.86 |
| `dbts_b1` 10bit | 1 | 16 | 94.3 | 46.59 / 46.51 / 46.48 | 269 | 0.9811 / 0.9804 | 0.9969 / 0.9966 | 1.49 (1.03 / 1.03) | 90.1 / 90.2 %, 71.3 %, 39.1 %, 59 | 0.52 / 0.60 | 9.71 |
| `dbts_b1` 10bit | 1 | 24 | 201.5 | 45.25 / 45.14 / 45.10 | 292 | 0.9752 / 0.9744 | 0.9948 / 0.9941 | 1.73 (1.03 / 1.04) | 91.4 / 91.6 %, 75.0 %, 45.9 %, 73 | 0.76 / 0.89 | 9.29 |
| `dbts_b1` 10bit | 1 | 32 | 437.2 | 44.01 / 43.88 / 43.82 | 349 | 0.9693 / 0.9681 | 0.9911 / 0.9898 | 1.99 (1.04 / 1.05) | 92.4 / 92.6 %, 78.1 %, 51.6 %, 83 | 1.16 / 1.35 | 8.34 |
| `dbts_b1` 10bit | 1 | 40 | 876.0 | 42.72 / 42.51 / 42.49 | 391 | 0.9608 / 0.9600 | 0.9863 / 0.9855 | 2.27 (1.09 / 1.11) | 93.3 / 93.3 %, 80.2 %, 55.9 %, 128 | 1.57 / 1.83 | 6.95 |
| `dbts_b1` 10bit | 1 | 56 | 3524.6 | 39.52 / 39.35 / 39.31 | 547 | 0.9277 / 0.9198 | 0.9701 / 0.9689 | 3.12 (1.21 / 1.23) | 94.9 / 95.0 %, 85.2 %, 66.4 %, 154 | 2.70 / 3.03 | 4.29 |
| `dbts_b1` 10bit | 16 | 1 | 6.5 | 68.48 / 68.37 / 68.36 | 25 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.12 (0.12 / 0.12) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 9 | 0.04 / 0.04 | 10.0 |
| `dbts_b1` 10bit | 16 | 2 | 8.0 | 64.85 / 64.74 / 64.73 | 27 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.19) | 35.8 / 35.9 %, 0.4 %, 0.0 %, 12 | 0.05 / 0.06 | 10.0 |
| `dbts_b1` 10bit | 16 | 4 | 11.4 | 59.10 / 58.99 / 58.99 | 50 | 0.9990 / 0.9989 | 0.9999 / 0.9999 | 0.35 (0.36 / 0.38) | 61.4 / 61.5 %, 13.0 %, 0.0 %, 18 | 0.10 / 0.12 | 9.99 |
| `dbts_b1` 10bit | 16 | 8 | 23.0 | 52.05 / 51.97 / 51.88 | 86 | 0.9947 / 0.9945 | 0.9993 / 0.9993 | 0.79 (0.79 / 0.81) | 81.9 / 82.1 %, 49.8 %, 11.3 %, 34 | 0.22 / 0.26 | 9.96 |
| `dbts_b1` 10bit | 16 | 12 | 52.3 | 48.47 / 48.35 / 48.24 | 223 | 0.9877 / 0.9871 | 0.9983 / 0.9981 | 1.20 (0.99 / 1.00) | 87.8 / 88.2 %, 65.5 %, 29.9 %, 56 | 0.36 / 0.42 | 9.86 |
| `dbts_b1` 10bit | 16 | 16 | 115.4 | 46.70 / 46.57 / 46.51 | 229 | 0.9817 / 0.9807 | 0.9969 / 0.9966 | 1.47 (1.03 / 1.03) | 89.9 / 90.2 %, 71.2 %, 39.1 %, 73 | 0.52 / 0.61 | 9.7 |
| `dbts_b1` 10bit | 16 | 24 | 327.5 | 45.21 / 45.12 / 45.08 | 311 | 0.9753 / 0.9743 | 0.9947 / 0.9939 | 1.74 (1.04 / 1.04) | 91.4 / 91.6 %, 75.2 %, 46.2 %, 77 | 0.78 / 0.93 | 9.24 |
| `dbts_b1` 10bit | 16 | 32 | 992.2 | 43.96 / 43.84 / 43.81 | 378 | 0.9696 / 0.9683 | 0.9910 / 0.9893 | 2.00 (1.04 / 1.05) | 92.5 / 92.7 %, 78.4 %, 52.3 %, 86 | 1.18 / 1.43 | 8.28 |
| `dbts_b1` 10bit | 16 | 40 | 2685.3 | 42.63 / 42.40 / 42.38 | 457 | 0.9608 / 0.9600 | 0.9858 / 0.9847 | 2.30 (1.08 / 1.10) | 93.4 / 93.5 %, 80.6 %, 56.8 %, 120 | 1.63 / 1.94 | 6.8 |
| `dbts_b1` 10bit | 16 | 56 | 14360.7 | 39.30 / 38.96 / 38.95 | 531 | 0.9280 / 0.9217 | 0.9681 / 0.9664 | 3.22 (1.21 / 1.23) | 95.1 / 95.3 %, 85.9 %, 68.0 %, 146 | 2.90 / 3.21 | 4.08 |
| `dbts_b1` 10bit | 8 | 1 | 6.5 | 68.49 / 68.38 / 68.36 | 25 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.12 (0.12 / 0.12) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 8 | 0.04 / 0.04 | 10.0 |
| `dbts_b1` 10bit | 8 | 2 | 7.9 | 64.86 / 64.75 / 64.74 | 27 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.19) | 35.8 / 36.0 %, 0.4 %, 0.0 %, 12 | 0.05 / 0.06 | 10.0 |
| `dbts_b1` 10bit | 8 | 4 | 11.3 | 59.11 / 59.00 / 58.99 | 50 | 0.9990 / 0.9989 | 0.9999 / 0.9999 | 0.35 (0.36 / 0.38) | 61.4 / 61.5 %, 13.0 %, 0.0 %, 16 | 0.10 / 0.12 | 9.99 |
| `dbts_b1` 10bit | 8 | 8 | 22.9 | 52.05 / 51.93 / 51.86 | 131 | 0.9947 / 0.9944 | 0.9993 / 0.9993 | 0.79 (0.78 / 0.81) | 81.9 / 82.2 %, 49.8 %, 11.4 %, 31 | 0.22 / 0.26 | 9.96 |
| `dbts_b1` 10bit | 8 | 12 | 52.2 | 48.48 / 48.31 / 48.24 | 223 | 0.9877 / 0.9871 | 0.9983 / 0.9981 | 1.20 (0.99 / 1.00) | 87.8 / 88.2 %, 65.5 %, 29.9 %, 57 | 0.36 / 0.42 | 9.86 |
| `dbts_b1` 10bit | 8 | 16 | 114.1 | 46.70 / 46.58 / 46.51 | 251 | 0.9817 / 0.9807 | 0.9969 / 0.9966 | 1.47 (1.03 / 1.03) | 89.9 / 90.2 %, 71.2 %, 39.1 %, 76 | 0.52 / 0.61 | 9.7 |
| `dbts_b1` 10bit | 8 | 24 | 318.2 | 45.22 / 45.11 / 45.05 | 352 | 0.9752 / 0.9744 | 0.9946 / 0.9939 | 1.74 (1.04 / 1.04) | 91.4 / 91.6 %, 75.2 %, 46.2 %, 81 | 0.79 / 0.93 | 9.24 |
| `dbts_b1` 10bit | 8 | 32 | 929.7 | 43.95 / 43.83 / 43.79 | 399 | 0.9698 / 0.9682 | 0.9910 / 0.9893 | 2.00 (1.04 / 1.05) | 92.5 / 92.7 %, 78.4 %, 52.3 %, 97 | 1.18 / 1.43 | 8.29 |
| `dbts_b1` 10bit | 8 | 40 | 2410.3 | 42.62 / 42.40 / 42.35 | 457 | 0.9609 / 0.9602 | 0.9859 / 0.9847 | 2.30 (1.08 / 1.10) | 93.3 / 93.5 %, 80.6 %, 56.8 %, 140 | 1.63 / 1.94 | 6.83 |
| `dbts_b1` 10bit | 8 | 56 | 12465.0 | 39.38 / 39.04 / 38.95 | 504 | 0.9297 / 0.9222 | 0.9691 / 0.9667 | 3.21 (1.21 / 1.23) | 95.0 / 95.2 %, 85.8 %, 67.7 %, 146 | 2.86 / 3.25 | 4.16 |
| `dbts_b3` 10bit | 1 | 1 | 4.1 | 67.10 / 67.02 / 67.02 | 19 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.11) | 19.2 / 19.2 %, 0.0 %, 0.0 %, 2 | 0.05 / 0.06 | 10.0 |
| `dbts_b3` 10bit | 1 | 2 | 5.1 | 63.16 / 63.07 / 63.06 | 21 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.18 (0.18 / 0.18) | 35.6 / 35.7 %, 0.4 %, 0.0 %, 3 | 0.08 / 0.09 | 10.0 |
| `dbts_b3` 10bit | 1 | 4 | 7.2 | 57.47 / 57.36 / 57.35 | 35 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.34 (0.35 / 0.36) | 61.0 / 61.1 %, 12.6 %, 0.0 %, 6 | 0.15 / 0.17 | 9.99 |
| `dbts_b3` 10bit | 1 | 8 | 13.7 | 50.28 / 50.20 / 50.20 | 85 | 0.9922 / 0.9921 | 0.9990 / 0.9989 | 0.78 (0.76 / 0.76) | 81.9 / 82.0 %, 49.4 %, 11.0 %, 31 | 0.34 / 0.39 | 9.96 |
| `dbts_b3` 10bit | 1 | 12 | 26.9 | 46.51 / 46.45 / 46.44 | 237 | 0.9814 / 0.9809 | 0.9973 / 0.9971 | 1.20 (0.96 / 0.96) | 88.1 / 88.2 %, 65.6 %, 29.8 %, 57 | 0.55 / 0.65 | 9.86 |
| `dbts_b3` 10bit | 1 | 16 | 49.6 | 44.54 / 44.47 / 44.47 | 337 | 0.9707 / 0.9697 | 0.9952 / 0.9947 | 1.51 (1.02 / 1.02) | 90.5 / 90.5 %, 72.1 %, 40.5 %, 92 | 0.76 / 0.90 | 9.69 |
| `dbts_b3` 10bit | 1 | 24 | 123.4 | 42.82 / 42.75 / 42.74 | 369 | 0.9575 / 0.9555 | 0.9913 / 0.9901 | 1.84 (1.04 / 1.04) | 92.1 / 92.2 %, 76.8 %, 49.2 %, 113 | 1.15 / 1.36 | 9.18 |
| `dbts_b3` 10bit | 1 | 32 | 286.7 | 41.67 / 41.60 / 41.58 | 435 | 0.9489 / 0.9471 | 0.9864 / 0.9849 | 2.09 (1.04 / 1.05) | 92.9 / 93.0 %, 79.2 %, 53.9 %, 135 | 1.70 / 2.01 | 8.19 |
| `dbts_b3` 10bit | 1 | 40 | 515.3 | 40.64 / 40.49 / 40.47 | 491 | 0.9404 / 0.9395 | 0.9807 / 0.9793 | 2.34 (1.09 / 1.10) | 93.6 / 93.6 %, 81.1 %, 57.7 %, 164 | 2.27 / 2.71 | 7.1 |
| `dbts_b3` 10bit | 1 | 56 | 2005.0 | 37.44 / 37.06 / 37.05 | 799 | 0.9152 / 0.9101 | 0.9582 / 0.9543 | 3.26 (1.23 / 1.25) | 95.1 / 95.2 %, 85.8 %, 67.5 %, 254 | 4.22 / 4.75 | 4.26 |
| `dbts_b3` 10bit | 16 | 1 | 4.3 | 66.76 / 66.67 / 66.66 | 23 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.12 (0.12 / 0.12) | 20.3 / 20.3 %, 0.0 %, 0.0 %, 9 | 0.06 / 0.07 | 10.0 |
| `dbts_b3` 10bit | 16 | 2 | 5.3 | 63.14 / 63.05 / 63.05 | 34 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.18 (0.18 / 0.18) | 35.7 / 35.8 %, 0.4 %, 0.0 %, 15 | 0.08 / 0.10 | 10.0 |
| `dbts_b3` 10bit | 16 | 4 | 7.5 | 57.37 / 57.28 / 57.27 | 42 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.34 (0.35 / 0.35) | 61.4 / 61.5 %, 12.9 %, 0.0 %, 21 | 0.15 / 0.18 | 9.99 |
| `dbts_b3` 10bit | 16 | 8 | 14.7 | 50.40 / 50.33 / 50.22 | 78 | 0.9925 / 0.9921 | 0.9990 / 0.9989 | 0.77 (0.74 / 0.76) | 81.7 / 81.9 %, 49.3 %, 11.0 %, 37 | 0.34 / 0.40 | 9.95 |
| `dbts_b3` 10bit | 16 | 12 | 30.5 | 46.67 / 46.59 / 46.44 | 165 | 0.9821 / 0.9811 | 0.9974 / 0.9972 | 1.18 (0.96 / 0.96) | 87.9 / 88.1 %, 65.5 %, 29.8 %, 50 | 0.55 / 0.65 | 9.86 |
| `dbts_b3` 10bit | 16 | 16 | 63.0 | 44.62 / 44.56 / 44.49 | 241 | 0.9714 / 0.9702 | 0.9952 / 0.9947 | 1.50 (1.02 / 1.02) | 90.4 / 90.5 %, 72.1 %, 40.5 %, 70 | 0.78 / 0.93 | 9.65 |
| `dbts_b3` 10bit | 16 | 24 | 223.0 | 42.71 / 42.64 / 42.59 | 328 | 0.9571 / 0.9548 | 0.9907 / 0.9895 | 1.86 (1.04 / 1.04) | 92.2 / 92.3 %, 77.3 %, 50.3 %, 95 | 1.23 / 1.52 | 9.01 |
| `dbts_b3` 10bit | 16 | 32 | 733.3 | 41.54 / 41.49 / 41.46 | 433 | 0.9486 / 0.9473 | 0.9858 / 0.9844 | 2.12 (1.04 / 1.05) | 93.0 / 93.1 %, 79.5 %, 54.6 %, 101 | 1.78 / 2.15 | 8.06 |
| `dbts_b3` 10bit | 16 | 40 | 1614.0 | 40.38 / 40.27 / 40.24 | 528 | 0.9402 / 0.9391 | 0.9796 / 0.9778 | 2.40 (1.08 / 1.10) | 93.7 / 93.8 %, 81.6 %, 58.8 %, 205 | 2.43 / 2.84 | 6.92 |
| `dbts_b3` 10bit | 16 | 56 | 9331.5 | 36.99 / 36.73 / 36.68 | 858 | 0.9132 / 0.9103 | 0.9547 / 0.9500 | 3.44 (1.23 / 1.25) | 95.2 / 95.4 %, 86.3 %, 68.8 %, 250 | 4.61 / 5.00 | 4.17 |
| `dbts_b3` 10bit | 8 | 1 | 4.3 | 66.78 / 66.68 / 66.66 | 23 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.12 (0.12 / 0.12) | 20.3 / 20.3 %, 0.0 %, 0.0 %, 9 | 0.06 / 0.07 | 10.0 |
| `dbts_b3` 10bit | 8 | 2 | 5.3 | 63.15 / 63.06 / 63.05 | 34 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.18 (0.18 / 0.18) | 35.7 / 35.8 %, 0.4 %, 0.0 %, 11 | 0.08 / 0.10 | 10.0 |
| `dbts_b3` 10bit | 8 | 4 | 7.5 | 57.38 / 57.28 / 57.27 | 42 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.34 (0.35 / 0.36) | 61.4 / 61.5 %, 12.9 %, 0.0 %, 17 | 0.15 / 0.18 | 9.99 |
| `dbts_b3` 10bit | 8 | 8 | 14.6 | 50.38 / 50.27 / 50.22 | 78 | 0.9925 / 0.9921 | 0.9990 / 0.9989 | 0.77 (0.74 / 0.76) | 81.7 / 81.9 %, 49.4 %, 11.0 %, 29 | 0.34 / 0.40 | 9.95 |
| `dbts_b3` 10bit | 8 | 12 | 30.3 | 46.66 / 46.50 / 46.44 | 138 | 0.9821 / 0.9810 | 0.9974 / 0.9972 | 1.18 (0.96 / 0.96) | 87.9 / 88.2 %, 65.5 %, 29.8 %, 69 | 0.55 / 0.65 | 9.86 |
| `dbts_b3` 10bit | 8 | 16 | 62.3 | 44.61 / 44.52 / 44.48 | 237 | 0.9713 / 0.9698 | 0.9952 / 0.9947 | 1.50 (1.02 / 1.02) | 90.4 / 90.5 %, 72.1 %, 40.5 %, 63 | 0.78 / 0.93 | 9.65 |
| `dbts_b3` 10bit | 8 | 24 | 216.3 | 42.71 / 42.63 / 42.59 | 287 | 0.9570 / 0.9543 | 0.9907 / 0.9893 | 1.86 (1.04 / 1.04) | 92.2 / 92.3 %, 77.3 %, 50.3 %, 107 | 1.24 / 1.52 | 9.01 |
| `dbts_b3` 10bit | 8 | 32 | 681.4 | 41.56 / 41.49 / 41.46 | 420 | 0.9486 / 0.9471 | 0.9859 / 0.9846 | 2.12 (1.04 / 1.05) | 93.0 / 93.1 %, 79.5 %, 54.6 %, 135 | 1.78 / 2.15 | 8.08 |
| `dbts_b3` 10bit | 8 | 40 | 1452.5 | 40.46 / 40.29 / 40.26 | 615 | 0.9402 / 0.9391 | 0.9799 / 0.9778 | 2.38 (1.08 / 1.10) | 93.6 / 93.8 %, 81.5 %, 58.7 %, 226 | 2.39 / 2.84 | 6.96 |
| `dbts_b3` 10bit | 8 | 56 | 7882.3 | 37.18 / 36.78 / 36.72 | 858 | 0.9139 / 0.9104 | 0.9566 / 0.9508 | 3.34 (1.23 / 1.25) | 95.1 / 95.4 %, 86.2 %, 68.6 %, 250 | 4.50 / 5.00 | 4.21 |
| `dbts_b5` 10bit | 1 | 1 | 6.6 | 68.65 / 68.60 / 68.56 | 5 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.17 (0.17 / 0.18) | 19.2 / 19.2 %, 0.0 %, 0.0 %, 2 | 0.05 / 0.05 | 10.0 |
| `dbts_b5` 10bit | 1 | 2 | 8.5 | 64.24 / 64.16 / 64.14 | 8 | 0.9996 / 0.9996 | 1.0000 / 0.9999 | 0.27 (0.28 / 0.28) | 36.0 / 36.1 %, 0.5 %, 0.0 %, 4 | 0.08 / 0.09 | 10.0 |
| `dbts_b5` 10bit | 1 | 4 | 12.9 | 58.40 / 58.33 / 58.32 | 22 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.54 (0.56 / 0.57) | 62.0 / 62.1 %, 13.7 %, 0.1 %, 8 | 0.14 / 0.17 | 9.99 |
| `dbts_b5` 10bit | 1 | 8 | 29.4 | 51.90 / 51.84 / 51.82 | 36 | 0.9938 / 0.9937 | 0.9992 / 0.9991 | 1.14 (0.92 / 0.93) | 81.0 / 81.1 %, 47.4 %, 9.6 %, 16 | 0.33 / 0.38 | 9.95 |
| `dbts_b5` 10bit | 1 | 12 | 55.1 | 49.04 / 49.00 / 48.99 | 59 | 0.9878 / 0.9872 | 0.9981 / 0.9978 | 1.60 (1.00 / 1.01) | 86.2 / 86.3 %, 60.6 %, 23.2 %, 29 | 0.52 / 0.60 | 9.86 |
| `dbts_b5` 10bit | 1 | 16 | 92.1 | 47.46 / 47.42 / 47.41 | 98 | 0.9830 / 0.9826 | 0.9969 / 0.9965 | 1.94 (1.03 / 1.03) | 88.4 / 88.6 %, 66.6 %, 31.8 %, 49 | 0.71 / 0.82 | 9.71 |
| `dbts_b5` 10bit | 1 | 24 | 194.1 | 45.80 / 45.75 / 45.74 | 129 | 0.9767 / 0.9758 | 0.9947 / 0.9940 | 2.37 (1.04 / 1.05) | 90.3 / 90.5 %, 72.0 %, 40.6 %, 64 | 1.05 / 1.21 | 9.31 |
| `dbts_b5` 10bit | 1 | 32 | 475.1 | 44.29 / 44.15 / 44.13 | 202 | 0.9697 / 0.9685 | 0.9910 / 0.9899 | 2.83 (1.05 / 1.06) | 91.7 / 91.7 %, 75.6 %, 47.2 %, 74 | 1.60 / 1.84 | 8.4 |
| `dbts_b5` 10bit | 1 | 40 | 953.6 | 43.04 / 42.77 / 42.70 | 333 | 0.9630 / 0.9590 | 0.9864 / 0.9856 | 3.25 (1.05 / 1.07) | 92.6 / 92.8 %, 78.7 %, 53.2 %, 102 | 2.22 / 2.56 | 7.21 |
| `dbts_b5` 10bit | 1 | 56 | 3287.6 | 39.72 / 39.11 / 39.06 | 635 | 0.9286 / 0.8902 | 0.9682 / 0.9630 | 4.60 (1.10 / 1.15) | 94.7 / 95.0 %, 85.0 %, 66.1 %, 148 | 4.08 / 4.67 | 4.41 |
| `dbts_b5` 10bit | 16 | 1 | 6.7 | 67.81 / 67.45 / 67.07 | 17 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.18) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 2 | 0.05 / 0.06 | 10.0 |
| `dbts_b5` 10bit | 16 | 2 | 8.4 | 64.22 / 64.00 / 63.80 | 19 | 0.9996 / 0.9995 | 1.0000 / 0.9999 | 0.27 (0.28 / 0.28) | 36.0 / 36.2 %, 0.5 %, 0.0 %, 4 | 0.08 / 0.09 | 10.0 |
| `dbts_b5` 10bit | 16 | 4 | 12.7 | 58.35 / 58.21 / 58.16 | 30 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.55 / 0.56) | 61.8 / 62.1 %, 13.7 %, 0.0 %, 11 | 0.15 / 0.17 | 9.99 |
| `dbts_b5` 10bit | 16 | 8 | 30.1 | 52.09 / 51.96 / 51.84 | 43 | 0.9940 / 0.9937 | 0.9992 / 0.9991 | 1.12 (0.91 / 0.92) | 80.6 / 81.1 %, 47.4 %, 9.6 %, 18 | 0.33 / 0.38 | 9.96 |
| `dbts_b5` 10bit | 16 | 12 | 63.3 | 49.16 / 49.11 / 49.02 | 70 | 0.9882 / 0.9876 | 0.9981 / 0.9979 | 1.58 (1.00 / 1.01) | 86.0 / 86.3 %, 60.5 %, 23.2 %, 26 | 0.53 / 0.61 | 9.86 |
| `dbts_b5` 10bit | 16 | 16 | 117.7 | 47.57 / 47.50 / 47.43 | 109 | 0.9835 / 0.9828 | 0.9969 / 0.9966 | 1.91 (1.03 / 1.03) | 88.3 / 88.6 %, 66.6 %, 31.8 %, 38 | 0.71 / 0.84 | 9.71 |
| `dbts_b5` 10bit | 16 | 24 | 320.4 | 45.77 / 45.70 / 45.68 | 267 | 0.9768 / 0.9755 | 0.9946 / 0.9937 | 2.37 (1.05 / 1.05) | 90.4 / 90.6 %, 72.4 %, 41.5 %, 77 | 1.09 / 1.30 | 9.24 |
| `dbts_b5` 10bit | 16 | 32 | 1169.5 | 44.10 / 43.94 / 43.90 | 525 | 0.9695 / 0.9677 | 0.9905 / 0.9894 | 2.89 (1.06 / 1.07) | 91.8 / 91.9 %, 76.1 %, 48.3 %, 137 | 1.71 / 2.00 | 8.2 |
| `dbts_b5` 10bit | 16 | 40 | 3054.8 | 42.74 / 42.47 / 42.42 | 520 | 0.9632 / 0.9607 | 0.9855 / 0.9844 | 3.33 (1.08 / 1.10) | 92.8 / 93.1 %, 79.5 %, 54.8 %, 137 | 2.36 / 2.72 | 6.98 |
| `dbts_b5` 10bit | 16 | 56 | 18426.6 | 39.39 / 38.78 / 38.66 | 553 | 0.9356 / 0.9103 | 0.9670 / 0.9620 | 4.71 (1.18 / 1.21) | 94.7 / 95.3 %, 85.9 %, 68.0 %, 192 | 4.16 / 4.89 | 4.2 |
| `dbts_b5` 10bit | 8 | 1 | 6.7 | 67.82 / 67.52 / 67.42 | 17 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.18) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 2 | 0.05 / 0.06 | 10.0 |
| `dbts_b5` 10bit | 8 | 2 | 8.4 | 64.22 / 64.05 / 63.95 | 20 | 0.9996 / 0.9996 | 1.0000 / 0.9999 | 0.27 (0.28 / 0.28) | 36.0 / 36.1 %, 0.5 %, 0.0 %, 4 | 0.08 / 0.09 | 10.0 |
| `dbts_b5` 10bit | 8 | 4 | 12.7 | 58.38 / 58.22 / 58.15 | 31 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.55 / 0.56) | 61.8 / 62.1 %, 13.7 %, 0.1 %, 13 | 0.15 / 0.17 | 9.99 |
| `dbts_b5` 10bit | 8 | 8 | 30.2 | 52.04 / 51.87 / 51.84 | 49 | 0.9940 / 0.9937 | 0.9992 / 0.9991 | 1.12 (0.91 / 0.92) | 80.7 / 81.1 %, 47.4 %, 9.6 %, 25 | 0.33 / 0.38 | 9.96 |
| `dbts_b5` 10bit | 8 | 12 | 63.0 | 49.15 / 49.05 / 49.01 | 70 | 0.9882 / 0.9874 | 0.9981 / 0.9979 | 1.58 (1.00 / 1.01) | 86.0 / 86.3 %, 60.5 %, 23.2 %, 28 | 0.53 / 0.61 | 9.86 |
| `dbts_b5` 10bit | 8 | 16 | 116.5 | 47.56 / 47.45 / 47.42 | 122 | 0.9834 / 0.9827 | 0.9969 / 0.9966 | 1.91 (1.03 / 1.03) | 88.3 / 88.6 %, 66.6 %, 31.8 %, 34 | 0.72 / 0.84 | 9.7 |
| `dbts_b5` 10bit | 8 | 24 | 311.0 | 45.77 / 45.71 / 45.68 | 254 | 0.9767 / 0.9755 | 0.9946 / 0.9937 | 2.37 (1.05 / 1.05) | 90.4 / 90.6 %, 72.4 %, 41.5 %, 57 | 1.09 / 1.30 | 9.24 |
| `dbts_b5` 10bit | 8 | 32 | 1100.7 | 44.12 / 43.94 / 43.90 | 422 | 0.9696 / 0.9679 | 0.9905 / 0.9894 | 2.88 (1.05 / 1.06) | 91.8 / 91.9 %, 76.1 %, 48.3 %, 109 | 1.71 / 2.00 | 8.21 |
| `dbts_b5` 10bit | 8 | 40 | 2762.4 | 42.77 / 42.46 / 42.45 | 396 | 0.9630 / 0.9607 | 0.9857 / 0.9844 | 3.33 (1.08 / 1.10) | 92.8 / 93.1 %, 79.4 %, 54.6 %, 110 | 2.35 / 2.72 | 7.0 |
| `dbts_b5` 10bit | 8 | 56 | 14850.9 | 39.46 / 38.89 / 38.80 | 553 | 0.9352 / 0.8943 | 0.9668 / 0.9619 | 4.69 (1.16 / 1.21) | 94.7 / 95.2 %, 85.7 %, 67.6 %, 204 | 4.12 / 4.89 | 4.3 |
| `dbts_c1` 12bit | 1 | 1 | 5.6 | 73.31 / 73.08 / 73.08 | 37 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 16.0 / 16.6 %, 0.0 %, 0.0 %, 2 | 0.03 / 0.03 | 10.0 |
| `dbts_c1` 12bit | 1 | 2 | 7.3 | 67.36 / 67.15 / 67.14 | 37 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.20 (0.20 / 0.22) | 32.2 / 33.2 %, 1.0 %, 0.0 %, 4 | 0.05 / 0.06 | 10.0 |
| `dbts_c1` 12bit | 1 | 4 | 12.6 | 59.32 / 59.11 / 59.10 | 85 | 0.9989 / 0.9988 | 0.9999 / 0.9998 | 0.50 (0.50 / 0.53) | 60.9 / 62.2 %, 18.3 %, 1.1 %, 9 | 0.12 / 0.14 | 9.98 |
| `dbts_c1` 12bit | 1 | 8 | 37.5 | 51.52 / 51.40 / 51.39 | 280 | 0.9931 / 0.9928 | 0.9990 / 0.9989 | 1.22 (0.98 / 0.99) | 81.2 / 82.8 %, 54.3 %, 20.9 %, 25 | 0.32 / 0.36 | 9.84 |
| `dbts_c1` 12bit | 1 | 12 | 110.3 | 48.48 / 48.32 / 48.30 | 316 | 0.9865 / 0.9858 | 0.9975 / 0.9973 | 1.73 (1.07 / 1.08) | 85.7 / 87.3 %, 65.0 %, 34.3 %, 38 | 0.55 / 0.64 | 9.48 |
| `dbts_c1` 12bit | 1 | 16 | 236.2 | 47.30 / 47.12 / 47.10 | 523 | 0.9826 / 0.9812 | 0.9961 / 0.9956 | 1.98 (1.07 / 1.08) | 87.3 / 88.6 %, 68.2 %, 39.0 %, 46 | 0.77 / 0.88 | 8.97 |
| `dbts_c1` 12bit | 1 | 24 | 506.6 | 46.34 / 46.16 / 46.14 | 593 | 0.9785 / 0.9772 | 0.9942 / 0.9935 | 2.19 (1.08 / 1.09) | 88.5 / 89.7 %, 70.7 %, 42.4 %, 117 | 1.06 / 1.23 | 8.11 |
| `dbts_c1` 12bit | 1 | 32 | 972.5 | 45.42 / 45.21 / 45.17 | 825 | 0.9776 / 0.9753 | 0.9923 / 0.9910 | 2.42 (1.08 / 1.09) | 89.7 / 90.8 %, 73.5 %, 46.2 %, 122 | 1.39 / 1.64 | 7.2 |
| `dbts_c1` 12bit | 1 | 40 | 1691.1 | 44.15 / 43.76 / 43.70 | 1215 | 0.9737 / 0.9704 | 0.9893 / 0.9881 | 2.75 (1.08 / 1.09) | 90.8 / 91.7 %, 75.9 %, 49.8 %, 119 | 1.82 / 2.04 | 6.27 |
| `dbts_c1` 12bit | 1 | 56 | 4371.3 | 40.19 / 39.64 / 39.50 | 2331 | 0.9504 / 0.8945 | 0.9788 / 0.9705 | 4.13 (1.09 / 1.10) | 93.2 / 93.5 %, 80.9 %, 58.9 %, 213 | 3.31 / 3.65 | 4.04 |
| `dbts_c1` 12bit | 16 | 1 | 5.6 | 73.33 / 73.10 / 73.08 | 54 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 16.0 / 16.5 %, 0.0 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c1` 12bit | 16 | 2 | 7.6 | 66.93 / 66.63 / 66.63 | 104 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.21 (0.21 / 0.23) | 33.5 / 34.6 %, 1.4 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_c1` 12bit | 16 | 4 | 12.6 | 59.28 / 59.09 / 59.08 | 148 | 0.9989 / 0.9988 | 0.9999 / 0.9998 | 0.50 (0.50 / 0.53) | 61.0 / 62.4 %, 18.7 %, 1.1 %, 10 | 0.12 / 0.14 | 9.98 |
| `dbts_c1` 12bit | 16 | 8 | 38.0 | 51.66 / 51.53 / 51.39 | 228 | 0.9935 / 0.9928 | 0.9990 / 0.9989 | 1.20 (0.97 / 0.99) | 81.0 / 82.6 %, 53.8 %, 20.5 %, 24 | 0.32 / 0.36 | 9.84 |
| `dbts_c1` 12bit | 16 | 12 | 128.3 | 48.59 / 48.45 / 48.34 | 267 | 0.9870 / 0.9858 | 0.9976 / 0.9973 | 1.71 (1.07 / 1.08) | 85.7 / 87.2 %, 64.7 %, 34.0 %, 37 | 0.55 / 0.64 | 9.49 |
| `dbts_c1` 12bit | 16 | 16 | 374.7 | 47.29 / 47.13 / 47.07 | 523 | 0.9829 / 0.9816 | 0.9961 / 0.9955 | 1.98 (1.07 / 1.08) | 87.3 / 88.5 %, 68.1 %, 38.9 %, 58 | 0.77 / 0.91 | 8.96 |
| `dbts_c1` 12bit | 16 | 24 | 1262.7 | 46.15 / 45.93 / 45.91 | 593 | 0.9792 / 0.9772 | 0.9938 / 0.9929 | 2.25 (1.08 / 1.09) | 88.8 / 89.9 %, 71.3 %, 43.2 %, 82 | 1.14 / 1.37 | 7.94 |
| `dbts_c1` 12bit | 16 | 32 | 3118.4 | 45.10 / 44.86 / 44.81 | 637 | 0.9783 / 0.9762 | 0.9916 / 0.9902 | 2.50 (1.08 / 1.09) | 90.0 / 90.9 %, 73.9 %, 47.0 %, 119 | 1.51 / 1.78 | 7.02 |
| `dbts_c1` 12bit | 16 | 40 | 6560.7 | 43.75 / 43.16 / 43.03 | 1049 | 0.9748 / 0.9703 | 0.9883 / 0.9864 | 2.90 (1.08 / 1.09) | 91.3 / 92.0 %, 76.9 %, 51.6 %, 122 | 2.01 / 2.29 | 6.02 |
| `dbts_c1` 12bit | 16 | 56 | 21780.6 | 39.58 / 38.58 / 38.46 | 2060 | 0.9507 / 0.9372 | 0.9760 / 0.9705 | 4.43 (1.08 / 1.09) | 93.7 / 94.0 %, 82.4 %, 61.7 %, 185 | 3.63 / 4.31 | 3.81 |
| `dbts_c1` 12bit | 8 | 1 | 5.6 | 73.33 / 73.11 / 73.08 | 37 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 15.9 / 16.5 %, 0.0 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c1` 12bit | 8 | 2 | 7.6 | 66.97 / 66.64 / 66.63 | 105 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.21 (0.21 / 0.23) | 33.5 / 34.6 %, 1.4 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_c1` 12bit | 8 | 4 | 12.6 | 59.28 / 59.09 / 59.09 | 148 | 0.9989 / 0.9988 | 0.9999 / 0.9998 | 0.50 (0.50 / 0.53) | 61.0 / 62.4 %, 18.7 %, 1.1 %, 9 | 0.12 / 0.14 | 9.98 |
| `dbts_c1` 12bit | 8 | 8 | 37.9 | 51.66 / 51.48 / 51.39 | 201 | 0.9935 / 0.9928 | 0.9990 / 0.9989 | 1.20 (0.97 / 0.99) | 81.0 / 82.6 %, 53.8 %, 20.5 %, 25 | 0.32 / 0.36 | 9.84 |
| `dbts_c1` 12bit | 8 | 12 | 127.3 | 48.55 / 48.39 / 48.34 | 288 | 0.9868 / 0.9858 | 0.9975 / 0.9973 | 1.71 (1.07 / 1.08) | 85.7 / 87.2 %, 64.7 %, 34.0 %, 37 | 0.55 / 0.64 | 9.49 |
| `dbts_c1` 12bit | 8 | 16 | 363.0 | 47.30 / 47.12 / 47.07 | 523 | 0.9829 / 0.9816 | 0.9961 / 0.9955 | 1.98 (1.07 / 1.08) | 87.3 / 88.5 %, 68.1 %, 38.9 %, 58 | 0.77 / 0.91 | 8.97 |
| `dbts_c1` 12bit | 8 | 24 | 1184.8 | 46.16 / 45.94 / 45.91 | 593 | 0.9793 / 0.9772 | 0.9938 / 0.9929 | 2.24 (1.08 / 1.09) | 88.8 / 89.9 %, 71.3 %, 43.2 %, 82 | 1.14 / 1.37 | 7.96 |
| `dbts_c1` 12bit | 8 | 32 | 2820.8 | 45.17 / 44.91 / 44.82 | 683 | 0.9782 / 0.9762 | 0.9917 / 0.9902 | 2.50 (1.08 / 1.09) | 90.0 / 90.9 %, 73.9 %, 46.9 %, 119 | 1.50 / 1.78 | 7.02 |
| `dbts_c1` 12bit | 8 | 40 | 5743.5 | 43.93 / 43.28 / 43.04 | 1080 | 0.9745 / 0.9704 | 0.9886 / 0.9864 | 2.88 (1.08 / 1.09) | 91.1 / 91.9 %, 76.4 %, 51.0 %, 128 | 1.98 / 2.30 | 6.05 |
| `dbts_c1` 12bit | 8 | 56 | 17834.3 | 39.86 / 38.81 / 38.50 | 2060 | 0.9526 / 0.9372 | 0.9781 / 0.9709 | 4.25 (1.08 / 1.09) | 93.4 / 94.0 %, 82.3 %, 61.6 %, 194 | 3.47 / 4.33 | 3.8 |
| `dbts_c1` top10 | 1 | 1 | 6.8 | 66.51 / 66.29 / 66.29 | 32 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.22 (0.21 / 0.23) | 33.4 / 34.4 %, 1.6 %, 0.0 %, 4 | 0.07 / 0.08 | — |
| `dbts_c1` top10 | 1 | 2 | 9.0 | 63.02 / 62.81 / 62.80 | 55 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.32 (0.32 / 0.35) | 47.2 / 48.5 %, 6.6 %, 0.0 %, 6 | 0.10 / 0.11 | — |
| `dbts_c1` top10 | 1 | 4 | 14.5 | 57.55 / 57.37 / 57.34 | 111 | 0.9983 / 0.9983 | 0.9998 / 0.9998 | 0.61 (0.60 / 0.63) | 66.7 / 67.9 %, 25.8 %, 2.8 %, 11 | 0.16 / 0.18 | — |
| `dbts_c1` top10 | 1 | 8 | 40.0 | 51.23 / 51.10 / 51.10 | 280 | 0.9928 / 0.9926 | 0.9989 / 0.9989 | 1.26 (0.99 / 1.00) | 81.7 / 83.3 %, 55.5 %, 22.2 %, 25 | 0.34 / 0.39 | — |
| `dbts_c1` top10 | 1 | 12 | 103.2 | 48.60 / 48.45 / 48.38 | 328 | 0.9870 / 0.9864 | 0.9976 / 0.9974 | 1.71 (1.07 / 1.08) | 85.6 / 87.1 %, 64.7 %, 33.9 %, 41 | 0.54 / 0.62 | — |
| `dbts_c1` top10 | 1 | 16 | 207.1 | 47.47 / 47.31 / 47.30 | 462 | 0.9836 / 0.9827 | 0.9963 / 0.9960 | 1.95 (1.08 / 1.09) | 87.1 / 88.4 %, 67.8 %, 38.4 %, 45 | 0.73 / 0.85 | — |
| `dbts_c1` top10 | 1 | 24 | 446.4 | 46.54 / 46.36 / 46.35 | 500 | 0.9811 / 0.9799 | 0.9947 / 0.9940 | 2.16 (1.08 / 1.09) | 88.3 / 89.4 %, 70.4 %, 41.8 %, 117 | 1.00 / 1.17 | — |
| `dbts_c1` top10 | 1 | 32 | 843.6 | 45.72 / 45.50 / 45.48 | 806 | 0.9793 / 0.9775 | 0.9929 / 0.9917 | 2.35 (1.08 / 1.09) | 89.4 / 90.4 %, 72.7 %, 45.3 %, 122 | 1.30 / 1.54 | — |
| `dbts_c1` top10 | 1 | 40 | 1424.6 | 44.65 / 44.36 / 44.27 | 967 | 0.9743 / 0.9720 | 0.9904 / 0.9890 | 2.62 (1.08 / 1.10) | 90.4 / 91.4 %, 75.1 %, 48.7 %, 118 | 1.66 / 1.91 | — |
| `dbts_c1` top10 | 1 | 56 | 3635.4 | 41.46 / 40.89 / 40.79 | 2129 | 0.9458 / 0.9340 | 0.9810 / 0.9771 | 3.63 (1.09 / 1.10) | 92.5 / 92.8 %, 78.8 %, 55.1 %, 207 | 2.82 / 3.05 | — |
| `dbts_c1` top10 | 16 | 1 | 7.0 | 66.17 / 65.89 / 65.89 | 76 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.23 (0.22 / 0.24) | 34.6 / 35.7 %, 1.9 %, 0.0 %, 4 | 0.08 / 0.09 | — |
| `dbts_c1` top10 | 16 | 2 | 9.0 | 62.98 / 62.74 / 62.73 | 102 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.33 (0.32 / 0.35) | 47.4 / 48.7 %, 6.8 %, 0.0 %, 6 | 0.10 / 0.12 | — |
| `dbts_c1` top10 | 16 | 4 | 14.5 | 57.52 / 57.32 / 57.30 | 181 | 0.9983 / 0.9982 | 0.9998 / 0.9998 | 0.61 (0.60 / 0.63) | 66.8 / 68.1 %, 26.2 %, 2.9 %, 11 | 0.16 / 0.19 | — |
| `dbts_c1` top10 | 16 | 8 | 40.7 | 51.33 / 51.20 / 51.10 | 214 | 0.9930 / 0.9926 | 0.9989 / 0.9989 | 1.25 (0.99 / 1.00) | 81.6 / 83.1 %, 55.1 %, 21.9 %, 25 | 0.34 / 0.39 | — |
| `dbts_c1` top10 | 16 | 12 | 119.5 | 48.65 / 48.52 / 48.51 | 272 | 0.9872 / 0.9866 | 0.9976 / 0.9974 | 1.70 (1.07 / 1.08) | 85.6 / 87.1 %, 64.7 %, 33.7 %, 44 | 0.55 / 0.64 | — |
| `dbts_c1` top10 | 16 | 16 | 312.5 | 47.47 / 47.31 / 47.25 | 456 | 0.9838 / 0.9827 | 0.9963 / 0.9959 | 1.94 (1.08 / 1.09) | 87.1 / 88.4 %, 67.8 %, 38.3 %, 47 | 0.74 / 0.87 | — |
| `dbts_c1` top10 | 16 | 24 | 986.4 | 46.44 / 46.22 / 46.15 | 464 | 0.9811 / 0.9796 | 0.9945 / 0.9935 | 2.18 (1.08 / 1.09) | 88.4 / 89.5 %, 70.6 %, 42.4 %, 87 | 1.04 / 1.26 | — |
| `dbts_c1` top10 | 16 | 32 | 2446.0 | 45.54 / 45.30 / 45.25 | 583 | 0.9796 / 0.9782 | 0.9926 / 0.9915 | 2.40 (1.09 / 1.10) | 89.6 / 90.6 %, 73.1 %, 45.6 %, 117 | 1.37 / 1.61 | — |
| `dbts_c1` top10 | 16 | 40 | 4946.2 | 44.40 / 44.05 / 43.95 | 830 | 0.9750 / 0.9723 | 0.9898 / 0.9885 | 2.70 (1.09 / 1.10) | 90.7 / 91.5 %, 75.6 %, 49.5 %, 119 | 1.76 / 2.01 | — |
| `dbts_c1` top10 | 16 | 56 | 16231.0 | 40.98 / 40.19 / 40.16 | 2052 | 0.9458 / 0.9397 | 0.9796 / 0.9767 | 3.81 (1.08 / 1.10) | 92.8 / 93.1 %, 80.2 %, 57.7 %, 216 | 3.03 / 3.42 | — |
| `dbts_c1` top10 | 8 | 1 | 7.0 | 66.21 / 65.90 / 65.89 | 63 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.23 (0.22 / 0.24) | 34.6 / 35.7 %, 1.9 %, 0.0 %, 4 | 0.08 / 0.09 | — |
| `dbts_c1` top10 | 8 | 2 | 9.0 | 62.98 / 62.75 / 62.74 | 107 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.33 (0.32 / 0.35) | 47.4 / 48.7 %, 6.8 %, 0.0 %, 6 | 0.10 / 0.12 | — |
| `dbts_c1` top10 | 8 | 4 | 14.5 | 57.52 / 57.32 / 57.31 | 166 | 0.9983 / 0.9982 | 0.9998 / 0.9998 | 0.61 (0.60 / 0.63) | 66.7 / 68.1 %, 26.2 %, 2.9 %, 11 | 0.16 / 0.19 | — |
| `dbts_c1` top10 | 8 | 8 | 40.7 | 51.33 / 51.17 / 51.10 | 262 | 0.9930 / 0.9926 | 0.9989 / 0.9989 | 1.25 (0.99 / 1.00) | 81.6 / 83.1 %, 55.1 %, 21.9 %, 25 | 0.34 / 0.39 | — |
| `dbts_c1` top10 | 8 | 12 | 118.5 | 48.65 / 48.52 / 48.50 | 272 | 0.9872 / 0.9865 | 0.9976 / 0.9974 | 1.70 (1.07 / 1.08) | 85.6 / 87.1 %, 64.7 %, 33.7 %, 40 | 0.55 / 0.64 | — |
| `dbts_c1` top10 | 8 | 16 | 304.9 | 47.47 / 47.31 / 47.25 | 456 | 0.9837 / 0.9827 | 0.9963 / 0.9959 | 1.94 (1.08 / 1.09) | 87.1 / 88.4 %, 67.8 %, 38.3 %, 47 | 0.74 / 0.87 | — |
| `dbts_c1` top10 | 8 | 24 | 937.4 | 46.44 / 46.21 / 46.15 | 464 | 0.9811 / 0.9796 | 0.9945 / 0.9935 | 2.18 (1.08 / 1.09) | 88.5 / 89.5 %, 70.6 %, 42.4 %, 87 | 1.04 / 1.26 | — |
| `dbts_c1` top10 | 8 | 32 | 2234.6 | 45.55 / 45.33 / 45.31 | 607 | 0.9796 / 0.9781 | 0.9927 / 0.9914 | 2.40 (1.09 / 1.09) | 89.6 / 90.6 %, 73.1 %, 45.6 %, 117 | 1.37 / 1.61 | — |
| `dbts_c1` top10 | 8 | 40 | 4376.4 | 44.44 / 44.11 / 44.00 | 831 | 0.9745 / 0.9723 | 0.9898 / 0.9885 | 2.70 (1.09 / 1.10) | 90.7 / 91.4 %, 75.3 %, 49.2 %, 119 | 1.76 / 2.01 | — |
| `dbts_c1` top10 | 8 | 56 | 13756.7 | 41.28 / 40.34 / 40.15 | 2052 | 0.9464 / 0.9397 | 0.9808 / 0.9761 | 3.72 (1.09 / 1.10) | 92.7 / 93.1 %, 80.0 %, 57.1 %, 216 | 2.96 / 3.42 | — |
| `dbts_c1` window | 1 | 1 | 5.0 | 8.01 / 7.37 / 7.30 | 2234 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 26.6 / 28.5 %, 20.3 %, 15.4 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 1 | 2 | 6.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 31.3 / 33.1 %, 20.4 %, 15.5 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 1 | 4 | 7.9 | 8.01 / 7.37 / 7.30 | 2237 | 0.4605 / 0.3677 | 0.8628 / 0.8342 | 5.47 (0.44 / 0.48) | 41.7 / 43.4 %, 20.9 %, 15.7 %, 30 | 4.10 / 4.89 | — |
| `dbts_c1` window | 1 | 8 | 11.4 | 8.01 / 7.37 / 7.30 | 2247 | 0.4602 / 0.3674 | 0.8628 / 0.8342 | 5.48 (0.51 / 0.55) | 61.6 / 62.8 %, 27.1 %, 16.0 %, 31 | 4.10 / 4.89 | — |
| `dbts_c1` window | 1 | 12 | 15.5 | 8.01 / 7.37 / 7.30 | 2258 | 0.4595 / 0.3668 | 0.8627 / 0.8341 | 5.49 (0.62 / 0.65) | 73.4 / 74.3 %, 38.7 %, 17.3 %, 32 | 4.10 / 4.89 | — |
| `dbts_c1` window | 1 | 16 | 20.4 | 8.01 / 7.37 / 7.30 | 2265 | 0.4586 / 0.3661 | 0.8626 / 0.8340 | 5.51 (0.74 / 0.76) | 79.7 / 80.3 %, 48.8 %, 20.7 %, 32 | 4.11 / 4.89 | — |
| `dbts_c1` window | 1 | 24 | 34.0 | 8.01 / 7.37 / 7.30 | 2256 | 0.4563 / 0.3639 | 0.8622 / 0.8337 | 5.57 (0.92 / 0.94) | 85.9 / 86.2 %, 61.6 %, 30.2 %, 43 | 4.11 / 4.90 | — |
| `dbts_c1` window | 1 | 32 | 90.9 | 8.01 / 7.37 / 7.30 | 2263 | 0.4513 / 0.3589 | 0.8613 / 0.8329 | 5.69 (1.06 / 1.07) | 90.0 / 90.1 %, 71.5 %, 42.6 %, 46 | 4.14 / 4.92 | — |
| `dbts_c1` window | 1 | 40 | 324.4 | 8.01 / 7.37 / 7.30 | 2269 | 0.4462 / 0.3543 | 0.8597 / 0.8315 | 5.82 (1.08 / 1.09) | 91.7 / 91.8 %, 76.1 %, 49.8 %, 49 | 4.19 / 4.96 | — |
| `dbts_c1` window | 1 | 56 | 1900.9 | 8.01 / 7.36 / 7.29 | 2378 | 0.4433 / 0.3519 | 0.8562 / 0.8284 | 6.03 (1.08 / 1.09) | 93.2 / 93.3 %, 80.2 %, 56.9 %, 146 | 4.43 / 5.15 | — |
| `dbts_c1` window | 16 | 1 | 5.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 27.0 / 28.9 %, 20.3 %, 15.4 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 16 | 2 | 6.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 31.5 / 33.3 %, 20.4 %, 15.5 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 16 | 4 | 7.8 | 8.01 / 7.37 / 7.30 | 2238 | 0.4605 / 0.3677 | 0.8628 / 0.8342 | 5.47 (0.44 / 0.48) | 42.2 / 43.7 %, 20.9 %, 15.7 %, 30 | 4.10 / 4.89 | — |
| `dbts_c1` window | 16 | 8 | 11.4 | 8.01 / 7.37 / 7.30 | 2243 | 0.4602 / 0.3674 | 0.8628 / 0.8342 | 5.48 (0.51 / 0.55) | 61.9 / 63.0 %, 27.3 %, 16.0 %, 31 | 4.10 / 4.89 | — |
| `dbts_c1` window | 16 | 12 | 15.4 | 8.01 / 7.37 / 7.30 | 2247 | 0.4595 / 0.3668 | 0.8627 / 0.8341 | 5.49 (0.62 / 0.65) | 73.6 / 74.4 %, 39.0 %, 17.4 %, 31 | 4.10 / 4.89 | — |
| `dbts_c1` window | 16 | 16 | 20.2 | 8.01 / 7.37 / 7.30 | 2251 | 0.4587 / 0.3660 | 0.8626 / 0.8340 | 5.51 (0.74 / 0.76) | 79.8 / 80.3 %, 49.0 %, 20.9 %, 32 | 4.11 / 4.89 | — |
| `dbts_c1` window | 16 | 24 | 33.9 | 8.01 / 7.37 / 7.30 | 2259 | 0.4564 / 0.3639 | 0.8622 / 0.8337 | 5.57 (0.92 / 0.94) | 85.8 / 86.1 %, 61.5 %, 30.1 %, 34 | 4.11 / 4.90 | — |
| `dbts_c1` window | 16 | 32 | 94.4 | 8.01 / 7.37 / 7.30 | 2258 | 0.4516 / 0.3591 | 0.8613 / 0.8329 | 5.68 (1.06 / 1.07) | 89.9 / 90.1 %, 71.4 %, 42.6 %, 36 | 4.14 / 4.92 | — |
| `dbts_c1` window | 16 | 40 | 508.7 | 8.01 / 7.37 / 7.30 | 2270 | 0.4463 / 0.3543 | 0.8597 / 0.8314 | 5.83 (1.08 / 1.09) | 91.7 / 91.9 %, 76.3 %, 50.1 %, 55 | 4.20 / 4.96 | — |
| `dbts_c1` window | 16 | 56 | 5481.1 | 8.01 / 7.36 / 7.29 | 2378 | 0.4433 / 0.3519 | 0.8562 / 0.8283 | 6.05 (1.08 / 1.09) | 93.2 / 93.5 %, 80.7 %, 57.5 %, 126 | 4.45 / 5.15 | — |
| `dbts_c1` window | 8 | 1 | 5.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 27.0 / 28.9 %, 20.3 %, 15.4 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 8 | 2 | 6.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 31.5 / 33.3 %, 20.4 %, 15.5 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 8 | 4 | 7.8 | 8.01 / 7.37 / 7.30 | 2239 | 0.4605 / 0.3677 | 0.8628 / 0.8342 | 5.47 (0.44 / 0.48) | 42.1 / 43.7 %, 21.0 %, 15.7 %, 30 | 4.10 / 4.89 | — |
| `dbts_c1` window | 8 | 8 | 11.4 | 8.01 / 7.37 / 7.30 | 2244 | 0.4602 / 0.3674 | 0.8628 / 0.8342 | 5.48 (0.51 / 0.55) | 61.9 / 63.0 %, 27.2 %, 16.0 %, 31 | 4.10 / 4.89 | — |
| `dbts_c1` window | 8 | 12 | 15.4 | 8.01 / 7.37 / 7.30 | 2247 | 0.4595 / 0.3668 | 0.8627 / 0.8341 | 5.49 (0.62 / 0.65) | 73.6 / 74.4 %, 38.9 %, 17.4 %, 32 | 4.10 / 4.89 | — |
| `dbts_c1` window | 8 | 16 | 20.2 | 8.01 / 7.37 / 7.30 | 2250 | 0.4587 / 0.3660 | 0.8626 / 0.8340 | 5.51 (0.74 / 0.76) | 79.8 / 80.4 %, 49.0 %, 20.8 %, 32 | 4.11 / 4.89 | — |
| `dbts_c1` window | 8 | 24 | 33.9 | 8.01 / 7.37 / 7.30 | 2253 | 0.4564 / 0.3639 | 0.8622 / 0.8337 | 5.57 (0.91 / 0.94) | 85.8 / 86.2 %, 61.5 %, 30.1 %, 34 | 4.11 / 4.90 | — |
| `dbts_c1` window | 8 | 32 | 94.5 | 8.01 / 7.37 / 7.30 | 2258 | 0.4516 / 0.3591 | 0.8613 / 0.8329 | 5.68 (1.06 / 1.07) | 89.9 / 90.0 %, 71.4 %, 42.6 %, 36 | 4.14 / 4.92 | — |
| `dbts_c1` window | 8 | 40 | 495.0 | 8.01 / 7.37 / 7.30 | 2268 | 0.4463 / 0.3543 | 0.8597 / 0.8314 | 5.83 (1.08 / 1.09) | 91.7 / 91.9 %, 76.3 %, 50.1 %, 51 | 4.20 / 4.96 | — |
| `dbts_c1` window | 8 | 56 | 5047.0 | 8.01 / 7.36 / 7.29 | 2378 | 0.4433 / 0.3519 | 0.8562 / 0.8283 | 6.05 (1.08 / 1.09) | 93.2 / 93.4 %, 80.6 %, 57.5 %, 126 | 4.45 / 5.15 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 1 | 10.4 | 48.06 / 47.93 / 47.90 | 50 | 0.9976 / 0.9973 | 0.9995 / 0.9994 | 1.28 (0.66 / 0.74) | 59.2 / 60.5 %, 10.0 %, 0.4 %, 50 | 0.18 / 0.26 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 2 | 12.8 | 47.53 / 47.40 / 47.37 | 50 | 0.9972 / 0.9967 | 0.9995 / 0.9993 | 1.37 (0.75 / 0.81) | 62.5 / 63.4 %, 14.1 %, 0.5 %, 50 | 0.19 / 0.28 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 4 | 17.2 | 46.66 / 46.54 / 46.52 | 52 | 0.9962 / 0.9955 | 0.9993 / 0.9991 | 1.51 (0.86 / 0.90) | 66.9 / 67.6 %, 20.7 %, 0.8 %, 52 | 0.21 / 0.29 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 8 | 24.0 | 45.06 / 44.95 / 44.87 | 55 | 0.9937 / 0.9926 | 0.9990 / 0.9986 | 1.81 (0.97 / 1.01) | 73.3 / 73.9 %, 32.0 %, 2.8 %, 55 | 0.25 / 0.34 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 12 | 29.7 | 43.65 / 43.52 / 43.49 | 56 | 0.9906 / 0.9891 | 0.9985 / 0.9980 | 2.14 (1.07 / 1.11) | 77.7 / 78.3 %, 40.7 %, 6.4 %, 56 | 0.29 / 0.39 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 16 | 35.2 | 42.58 / 42.38 / 42.34 | 58 | 0.9875 / 0.9857 | 0.9979 / 0.9973 | 2.41 (1.11 / 1.15) | 80.4 / 81.2 %, 47.2 %, 10.6 %, 58 | 0.33 / 0.45 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 24 | 49.0 | 40.44 / 40.30 / 40.21 | 69 | 0.9778 / 0.9727 | 0.9963 / 0.9951 | 3.10 (1.24 / 1.27) | 84.9 / 85.5 %, 58.1 %, 20.8 %, 69 | 0.42 / 0.58 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 32 | 79.3 | 37.72 / 37.50 / 37.35 | 94 | 0.9585 / 0.9510 | 0.9923 / 0.9900 | 4.21 (1.36 / 1.49) | 89.2 / 89.5 %, 69.3 %, 36.8 %, 94 | 0.60 / 0.84 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 40 | 130.9 | 35.13 / 34.55 / 34.46 | 113 | 0.9273 / 0.9135 | 0.9845 / 0.9800 | 5.65 (1.43 / 1.61) | 92.0 / 92.6 %, 77.7 %, 51.8 %, 113 | 0.87 / 1.21 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 56 | 417.5 | 29.75 / 29.10 / 28.98 | 173 | 0.8151 / 0.7884 | 0.9425 / 0.9314 | 10.39 (1.69 / 2.01) | 95.4 / 95.9 %, 87.3 %, 71.6 %, 173 | 1.92 / 2.75 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 1 | 12.3 | 47.95 / 47.81 / 47.78 | 50 | 0.9974 / 0.9971 | 0.9995 / 0.9993 | 1.30 (0.67 / 0.75) | 59.8 / 61.1 %, 10.8 %, 0.4 %, 50 | 0.18 / 0.25 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 2 | 15.9 | 47.46 / 47.34 / 47.30 | 51 | 0.9971 / 0.9966 | 0.9994 / 0.9993 | 1.38 (0.76 / 0.83) | 62.9 / 63.8 %, 14.7 %, 0.5 %, 51 | 0.19 / 0.28 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 4 | 23.4 | 46.47 / 46.34 / 46.31 | 52 | 0.9959 / 0.9951 | 0.9993 / 0.9990 | 1.55 (0.91 / 0.95) | 67.7 / 68.4 %, 22.5 %, 1.0 %, 52 | 0.21 / 0.30 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 8 | 36.0 | 44.85 / 44.64 / 44.60 | 55 | 0.9933 / 0.9922 | 0.9989 / 0.9986 | 1.85 (1.02 / 1.06) | 74.1 / 74.9 %, 33.9 %, 3.3 %, 55 | 0.25 / 0.34 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 12 | 44.5 | 43.68 / 43.55 / 43.52 | 61 | 0.9909 / 0.9893 | 0.9985 / 0.9980 | 2.14 (1.08 / 1.13) | 77.6 / 78.2 %, 40.6 %, 6.2 %, 61 | 0.29 / 0.39 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 16 | 53.5 | 42.76 / 42.56 / 42.39 | 64 | 0.9886 / 0.9868 | 0.9980 / 0.9974 | 2.36 (1.12 / 1.22) | 80.0 / 81.2 %, 47.2 %, 10.5 %, 64 | 0.33 / 0.44 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 24 | 75.2 | 40.77 / 40.42 / 40.24 | 73 | 0.9806 / 0.9766 | 0.9966 / 0.9956 | 2.99 (1.24 / 1.42) | 84.2 / 85.4 %, 57.7 %, 20.3 %, 73 | 0.42 / 0.59 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 32 | 145.2 | 37.77 / 37.40 / 37.30 | 109 | 0.9598 / 0.9547 | 0.9923 / 0.9903 | 4.20 (1.40 / 1.56) | 89.0 / 89.6 %, 69.5 %, 37.0 %, 109 | 0.59 / 0.84 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 40 | 295.7 | 35.10 / 34.54 / 34.34 | 119 | 0.9274 / 0.9164 | 0.9841 / 0.9801 | 5.69 (1.47 / 1.66) | 92.0 / 92.6 %, 77.6 %, 52.0 %, 119 | 0.86 / 1.23 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 56 | 1495.4 | 29.77 / 29.19 / 28.98 | 170 | 0.8102 / 0.7911 | 0.9410 / 0.9317 | 10.41 (1.71 / 2.04) | 95.4 / 95.8 %, 87.1 %, 71.2 %, 170 | 1.91 / 2.77 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 1 | 12.1 | 47.96 / 47.82 / 47.80 | 50 | 0.9974 / 0.9971 | 0.9995 / 0.9993 | 1.30 (0.67 / 0.75) | 59.8 / 61.1 %, 10.8 %, 0.4 %, 50 | 0.18 / 0.25 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 2 | 15.7 | 47.46 / 47.34 / 47.29 | 51 | 0.9971 / 0.9966 | 0.9995 / 0.9993 | 1.38 (0.76 / 0.82) | 62.9 / 63.8 %, 14.7 %, 0.5 %, 51 | 0.19 / 0.28 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 4 | 23.0 | 46.49 / 46.35 / 46.31 | 52 | 0.9960 / 0.9951 | 0.9993 / 0.9990 | 1.54 (0.90 / 0.95) | 67.6 / 68.4 %, 22.4 %, 1.0 %, 52 | 0.21 / 0.30 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 8 | 35.1 | 44.90 / 44.68 / 44.60 | 53 | 0.9934 / 0.9922 | 0.9989 / 0.9985 | 1.84 (1.01 / 1.05) | 73.8 / 74.9 %, 33.8 %, 3.3 %, 53 | 0.25 / 0.34 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 12 | 43.3 | 43.72 / 43.57 / 43.52 | 58 | 0.9910 / 0.9895 | 0.9985 / 0.9980 | 2.13 (1.07 / 1.13) | 77.5 / 78.2 %, 40.6 %, 6.2 %, 58 | 0.29 / 0.39 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 16 | 52.0 | 42.82 / 42.55 / 42.39 | 69 | 0.9886 / 0.9864 | 0.9980 / 0.9975 | 2.36 (1.11 / 1.21) | 79.9 / 81.2 %, 47.2 %, 10.5 %, 69 | 0.33 / 0.44 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 24 | 72.9 | 40.81 / 40.40 / 40.27 | 73 | 0.9805 / 0.9766 | 0.9966 / 0.9956 | 2.98 (1.23 / 1.39) | 84.2 / 85.4 %, 57.7 %, 20.3 %, 73 | 0.42 / 0.59 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 32 | 138.5 | 37.78 / 37.40 / 37.28 | 109 | 0.9596 / 0.9525 | 0.9924 / 0.9902 | 4.19 (1.39 / 1.55) | 89.0 / 89.6 %, 69.7 %, 37.2 %, 109 | 0.60 / 0.84 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 40 | 273.9 | 35.11 / 34.54 / 34.34 | 121 | 0.9280 / 0.9161 | 0.9843 / 0.9803 | 5.68 (1.46 / 1.63) | 92.0 / 92.6 %, 77.6 %, 52.0 %, 121 | 0.87 / 1.23 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 56 | 1292.1 | 29.77 / 29.15 / 28.98 | 178 | 0.8117 / 0.7908 | 0.9410 / 0.9314 | 10.39 (1.70 / 1.97) | 95.4 / 95.8 %, 87.2 %, 71.3 %, 178 | 1.93 / 2.80 | — |
| `ustrus_2` 8bit | 1 | 1 | 3.2 | 57.32 / 57.03 / 56.89 | 4 | 0.9989 / 0.9986 | 0.9999 / 0.9998 | 0.24 (0.24 / 0.36) | 15.8 / 17.0 %, 0.0 %, 0.0 %, 4 | 0.05 / 0.07 | 10.0 |
| `ustrus_2` 8bit | 1 | 2 | 3.7 | 54.37 / 54.27 / 54.24 | 5 | 0.9977 / 0.9970 | 0.9997 / 0.9996 | 0.34 (0.33 / 0.51) | 30.1 / 30.8 %, 0.4 %, 0.0 %, 4 | 0.07 / 0.10 | 10.0 |
| `ustrus_2` 8bit | 1 | 4 | 4.9 | 50.96 / 50.87 / 50.82 | 27 | 0.9948 / 0.9933 | 0.9993 / 0.9991 | 0.50 (0.50 / 0.74) | 51.5 / 52.2 %, 5.8 %, 0.0 %, 27 | 0.11 / 0.15 | 10.0 |
| `ustrus_2` 8bit | 1 | 8 | 7.5 | 46.74 / 46.60 / 46.54 | 27 | 0.9860 / 0.9831 | 0.9981 / 0.9975 | 0.81 (0.77 / 1.08) | 69.4 / 70.1 %, 25.4 %, 1.1 %, 27 | 0.17 / 0.25 | 9.99 |
| `ustrus_2` 8bit | 1 | 12 | 10.7 | 44.35 / 43.81 / 43.70 | 29 | 0.9758 / 0.9730 | 0.9964 / 0.9954 | 1.08 (0.98 / 1.26) | 76.4 / 78.0 %, 40.8 %, 6.2 %, 29 | 0.25 / 0.34 | 9.97 |
| `ustrus_2` 8bit | 1 | 16 | 14.2 | 42.87 / 41.87 / 41.79 | 46 | 0.9668 / 0.9632 | 0.9945 / 0.9932 | 1.30 (1.13 / 1.35) | 80.1 / 82.3 %, 50.4 %, 13.0 %, 46 | 0.32 / 0.44 | 9.95 |
| `ustrus_2` 8bit | 1 | 24 | 22.7 | 40.80 / 39.34 / 39.21 | 57 | 0.9505 / 0.9411 | 0.9903 / 0.9882 | 1.66 (1.32 / 1.50) | 83.7 / 86.6 %, 61.2 %, 24.9 %, 57 | 0.44 / 0.64 | 9.88 |
| `ustrus_2` 8bit | 1 | 32 | 45.1 | 38.50 / 36.43 / 36.19 | 75 | 0.9259 / 0.9006 | 0.9806 / 0.9770 | 2.19 (1.46 / 1.70) | 87.1 / 89.9 %, 70.8 %, 38.9 %, 75 | 0.72 / 1.02 | 9.63 |
| `ustrus_2` 8bit | 1 | 40 | 89.8 | 36.61 / 34.11 / 33.83 | 164 | 0.8980 / 0.8527 | 0.9655 / 0.9614 | 2.72 (1.53 / 1.94) | 89.3 / 92.1 %, 76.5 %, 49.8 %, 164 | 1.07 / 1.56 | 9.11 |
| `ustrus_2` 8bit | 1 | 56 | 304.6 | 32.96 / 30.18 / 29.82 | 158 | 0.8335 / 0.7374 | 0.9289 / 0.8956 | 3.99 (1.57 / 3.53) | 91.9 / 94.4 %, 83.1 %, 62.5 %, 151 | 2.15 / 3.23 | 7.52 |
| `ustrus_2` 8bit | 16 | 1 | 3.7 | 56.60 / 56.18 / 56.05 | 7 | 0.9986 / 0.9983 | 0.9998 / 0.9998 | 0.27 (0.26 / 0.38) | 19.0 / 20.6 %, 0.1 %, 0.0 %, 7 | 0.06 / 0.09 | 10.0 |
| `ustrus_2` 8bit | 16 | 2 | 4.3 | 54.03 / 53.76 / 53.70 | 11 | 0.9974 / 0.9969 | 0.9997 / 0.9996 | 0.35 (0.35 / 0.52) | 32.7 / 34.1 %, 0.5 %, 0.0 %, 11 | 0.08 / 0.11 | 10.0 |
| `ustrus_2` 8bit | 16 | 4 | 5.9 | 50.66 / 50.57 / 50.53 | 11 | 0.9945 / 0.9929 | 0.9993 / 0.9990 | 0.51 (0.51 / 0.77) | 53.3 / 54.1 %, 6.6 %, 0.0 %, 11 | 0.11 / 0.16 | 10.0 |
| `ustrus_2` 8bit | 16 | 8 | 9.8 | 46.65 / 46.42 / 46.35 | 23 | 0.9860 / 0.9829 | 0.9981 / 0.9974 | 0.82 (0.78 / 1.08) | 69.7 / 70.7 %, 26.3 %, 1.3 %, 23 | 0.18 / 0.27 | 9.99 |
| `ustrus_2` 8bit | 16 | 12 | 14.4 | 44.31 / 43.67 / 43.57 | 30 | 0.9759 / 0.9732 | 0.9964 / 0.9954 | 1.09 (0.99 / 1.26) | 76.6 / 78.5 %, 41.5 %, 6.6 %, 30 | 0.25 / 0.37 | 9.97 |
| `ustrus_2` 8bit | 16 | 16 | 20.0 | 42.86 / 41.80 / 41.75 | 31 | 0.9669 / 0.9634 | 0.9945 / 0.9931 | 1.31 (1.13 / 1.34) | 80.2 / 82.4 %, 50.9 %, 13.4 %, 31 | 0.32 / 0.47 | 9.95 |
| `ustrus_2` 8bit | 16 | 24 | 34.0 | 40.81 / 39.27 / 39.09 | 57 | 0.9503 / 0.9410 | 0.9901 / 0.9877 | 1.67 (1.31 / 1.49) | 83.9 / 86.6 %, 61.9 %, 25.9 %, 57 | 0.46 / 0.71 | 9.86 |
| `ustrus_2` 8bit | 16 | 32 | 74.2 | 38.47 / 36.37 / 36.11 | 80 | 0.9253 / 0.9019 | 0.9801 / 0.9757 | 2.20 (1.47 / 1.70) | 87.2 / 90.0 %, 70.8 %, 39.4 %, 80 | 0.74 / 1.11 | 9.58 |
| `ustrus_2` 8bit | 16 | 40 | 168.0 | 36.57 / 34.00 / 33.73 | 216 | 0.8979 / 0.8530 | 0.9643 / 0.9591 | 2.76 (1.54 / 2.00) | 89.3 / 92.1 %, 76.7 %, 50.1 %, 216 | 1.11 / 1.72 | 8.99 |
| `ustrus_2` 8bit | 16 | 56 | 769.5 | 32.79 / 30.03 / 29.64 | 236 | 0.8354 / 0.7429 | 0.9255 / 0.8935 | 4.11 (1.57 / 3.53) | 92.0 / 94.5 %, 83.7 %, 63.3 %, 236 | 2.24 / 3.39 | 7.32 |
| `ustrus_2` 8bit | 8 | 1 | 3.6 | 56.63 / 56.17 / 56.03 | 9 | 0.9986 / 0.9982 | 0.9998 / 0.9998 | 0.26 (0.26 / 0.38) | 18.9 / 20.7 %, 0.1 %, 0.0 %, 9 | 0.06 / 0.09 | 10.0 |
| `ustrus_2` 8bit | 8 | 2 | 4.3 | 54.06 / 53.74 / 53.69 | 10 | 0.9974 / 0.9969 | 0.9997 / 0.9996 | 0.35 (0.35 / 0.52) | 32.6 / 34.1 %, 0.5 %, 0.0 %, 10 | 0.08 / 0.11 | 10.0 |
| `ustrus_2` 8bit | 8 | 4 | 5.8 | 50.68 / 50.58 / 50.54 | 11 | 0.9945 / 0.9929 | 0.9993 / 0.9990 | 0.51 (0.51 / 0.77) | 53.2 / 54.3 %, 6.5 %, 0.0 %, 11 | 0.11 / 0.16 | 10.0 |
| `ustrus_2` 8bit | 8 | 8 | 9.6 | 46.66 / 46.43 / 46.35 | 21 | 0.9860 / 0.9828 | 0.9981 / 0.9974 | 0.82 (0.77 / 1.09) | 69.6 / 70.6 %, 26.4 %, 1.3 %, 21 | 0.18 / 0.27 | 9.99 |
| `ustrus_2` 8bit | 8 | 12 | 14.1 | 44.32 / 43.68 / 43.60 | 33 | 0.9759 / 0.9730 | 0.9964 / 0.9954 | 1.09 (0.99 / 1.26) | 76.6 / 78.3 %, 41.3 %, 6.6 %, 33 | 0.25 / 0.37 | 9.97 |
| `ustrus_2` 8bit | 8 | 16 | 19.5 | 42.84 / 41.82 / 41.73 | 45 | 0.9669 / 0.9631 | 0.9945 / 0.9931 | 1.31 (1.13 / 1.35) | 80.2 / 82.4 %, 50.8 %, 13.4 %, 45 | 0.32 / 0.47 | 9.95 |
| `ustrus_2` 8bit | 8 | 24 | 33.0 | 40.81 / 39.27 / 39.09 | 65 | 0.9501 / 0.9408 | 0.9901 / 0.9874 | 1.67 (1.31 / 1.50) | 83.9 / 86.7 %, 61.9 %, 25.9 %, 65 | 0.46 / 0.71 | 9.87 |
| `ustrus_2` 8bit | 8 | 32 | 71.7 | 38.43 / 36.36 / 36.09 | 82 | 0.9252 / 0.9019 | 0.9801 / 0.9753 | 2.21 (1.47 / 1.69) | 87.2 / 90.0 %, 70.9 %, 39.5 %, 82 | 0.74 / 1.11 | 9.59 |
| `ustrus_2` 8bit | 8 | 40 | 159.8 | 36.56 / 34.05 / 33.65 | 223 | 0.8976 / 0.8528 | 0.9643 / 0.9591 | 2.75 (1.54 / 2.02) | 89.4 / 92.1 %, 76.5 %, 50.4 %, 223 | 1.11 / 1.72 | 9.04 |
| `ustrus_2` 8bit | 8 | 56 | 696.1 | 32.84 / 30.06 / 29.53 | 237 | 0.8348 / 0.7426 | 0.9268 / 0.8933 | 4.09 (1.57 / 3.53) | 91.9 / 94.5 %, 83.5 %, 63.4 %, 237 | 2.22 / 3.39 | 7.34 |

##### Knees: the rung farthest from each curve's chord (metric against ln bytes, both scaled 0 … 1)

| series, form | G | PSNR | MS-SSIM (dB of 1 − MS-SSIM) | noise-band e ÷ σ | ≥ 1 level | JOD |
| --- | --: | --: | --: | --: | --: | --: |
| `dbts_b1` 10bit | 1 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b1` 10bit | 16 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b1` 10bit | 8 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b3` 10bit | 1 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b3` 10bit | 16 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b3` 10bit | 8 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b5` 10bit | 1 | 8 | 12 | 8 | 8 | 24 |
| `dbts_b5` 10bit | 16 | 12 | 12 | 8 | 8 | 24 |
| `dbts_b5` 10bit | 8 | 12 | 12 | 8 | 8 | 24 |
| `dbts_c1` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c1` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c1` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c1` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_c1` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_c1` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_c1` window | 1 | 40 | 32 | 32 | 24 | None |
| `dbts_c1` window | 16 | 40 | 32 | 32 | 24 | None |
| `dbts_c1` window | 8 | 40 | 32 | 32 | 24 | None |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 8 | 8 | 24 | 24 | None |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 4 | 8 | 32 | 24 | None |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 8 | 8 | 32 | 24 | None |
| `ustrus_2` 8bit | 1 | 12 | 16 | 24 | 12 | 32 |
| `ustrus_2` 8bit | 16 | 12 | 16 | 24 | 12 | 32 |
| `ustrus_2` 8bit | 8 | 16 | 16 | 24 | 12 | 32 |

##### Anchors: the highest Q from Q 1 up at which every frame holds

| series, form | G | noise-band e ≤ σ | e ≤ σ | every window ≤ 1 level | scroll, band < step | scroll, full < step |
| --- | --: | --: | --: | --: | --: | --: |
| `dbts_b1` 10bit | 1 | 12 | 8 | None | 24 | 56 |
| `dbts_b1` 10bit | 16 | 8 | 8 | None | 24 | 40 |
| `dbts_b1` 10bit | 8 | 8 | 8 | None | 24 | 40 |
| `dbts_b3` 10bit | 1 | 12 | 8 | None | 16 | 40 |
| `dbts_b3` 10bit | 16 | 12 | 8 | None | 16 | 40 |
| `dbts_b3` 10bit | 8 | 12 | 8 | None | 16 | 40 |
| `dbts_b5` 10bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_b5` 10bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_b5` 10bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c1` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c1` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c1` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c1` top10 | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_c1` top10 | 16 | 4 | 4 | None | 16 | 40 |
| `dbts_c1` top10 | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_c1` window | 1 | 24 | None | None | None | None |
| `dbts_c1` window | 16 | 24 | None | None | None | None |
| `dbts_c1` window | 8 | 24 | None | None | None | None |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 4 | None | None | 32 | 32 |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 4 | None | None | 32 | 32 |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 4 | None | None | 32 | 32 |
| `ustrus_2` 8bit | 1 | 4 | 4 | None | 24 | 32 |
| `ustrus_2` 8bit | 16 | 4 | 4 | None | 24 | 32 |
| `ustrus_2` 8bit | 8 | 4 | 4 | None | 24 | 32 |

##### Controls

| series | HTJ2K B | lossless AV1 G 1 B | ratio HTJ2K | ratio AV1 |
| --- | --: | --: | --: | --: |
| `dbts_b1` | 107407602 | 100465485 | 4.96 | 5.30 |
| `dbts_b3` | 119235171 | 111591951 | 3.24 | 3.46 |
| `dbts_b5` | 91380288 | 70831014 | 4.19 | 5.41 |
| `dbts_c1` | 70664924 | 66584219 | 3.59 | 3.81 |
| `usb_cine_rgb` | 11821475 | 10835106 | 4.26 | 4.65 |
| `ustrus_2` | 21866379 | 19907243 | 2.62 | 2.87 |


### Shard 2, measured (2026-11-04)

1. **Run:** shard 2 of §Shards in full: `dbts_a2`, `dbts_c5`, `dbts_b2`, `dbts_c4`, `dbt12_ea1141`, `dbt10_ea1141`,
   `usb_cine`, every rung Q 1 … 56 at G 1, 8 and 16, every form (three on the 12-bit series, one elsewhere): 450 cells,
   7 series rows, 14 control rows, and §7's checks on `usb_cine`. No cell was cut.
2. **What it shows**, stored form, every G: PSNR's knee at Q 8 on `dbts_a2`, `dbts_c5`, `dbts_c4`, `dbt12_ea1141` and
   `dbts_b2` (Q 12 at G 16), Q 12 on `dbt10_ea1141`; JOD's knee at Q 16 on the four 12-bit series, Q 24 on the two 10-bit
   ones; anchor (a) by noise (e_N ≤ σ on every frame) to Q 4 on `dbts_a2`, Q 8 on `dbts_c5`, `dbts_c4`, `dbts_b2`,
   `dbt12_ea1141`, Q 12 on `dbt10_ea1141`; by displayed levels at no rung on any series; anchor (b) in the band to Q 16
   on the four 12-bit series, Q 12 on `dbts_b2`, Q 24 on `dbt10_ea1141`. Full tables below.
3. **It rests on** these seven sets only (one system-A volume, `dbts_a2`; two system-C, `dbts_c4`, `dbts_c5`; one
   system-B, `dbts_b2`; two content-2 DBT sets; one lossy-sourced breast US cine, `usb_cine`, reported apart and in
   no verdict), libaom 3.15.1 at cpu6, dav1d 1.5.4, and the checks below, every one of which held and whose every
   mutation was seen.
4. **Host:** 4 cores (Intel Xeon @ 2.10 GHz), 15 GB, no swap; four cells in flight, one encode thread each, so the
   host is saturated on CPU by design and nothing past it is claimed. Encode wall ÷ CPU, from the rows: median 1.012
   (1.002–1.078, 450 cells). Wall clock 20:46–23:49 UTC with two stops (below); the cells' own wall clock sums to
   10.8 h, 2.71 h at four in flight, against the plan's 3.35 h for the whole shard.
5. **Left:** nothing of shard 2's plan. `usb_cine` has no noise anchor (its median σ is 0.358, below every rung's
   e_N). Everything §2 leaves open stays open; the collector combines the shards.

*Terms are §Terms'. **q-hist**: aomenc's `--q-hist` count of frames per quantizer.*

**Host and tools.** libaom 3.15.1, dav1d 1.5.4 and OpenJPH 0.31.0 built by `tools.sh`. The built `dav1d` loads the
system's libdav1d 1.4.1 unless `LD_LIBRARY_PATH` names the built one (as shard 4 found); a first start, 18:45–20:45
UTC, ran the checks, the controls and two series' cells under 1.4.1 and was discarded whole. The shard then ran from
the start with `LD_LIBRARY_PATH=lab/.av1-build/dav1d/lib` (`dav1d --version`: 1.5.4-0-g54706fc). It stopped twice —
once at 22:46 (the session's two-hour limit on a background command), once when the container restarted (between
22:53 and 23:30) — and was resumed with `shard.sh 2` each time; the cells in flight at a stop were coded again whole
and no row is duplicated (450 cells, one per (series, form, Q, G)). The seven sets were fetched by `fetch_data.sh`,
every raw frame checked against its pinned SHA-256; both controls of every set decoded every frame exact
(`ingest_coded.py`'s check, 14 of 14). Memory was not read during the run; no cell failed.

**Fit.** `dbts_a2`'s 90 cells, with every set's controls and series rows before them, took 1.12 h of wall clock against
its 14 515 CPU s estimate (1.01 h at four cores, the other sets' controls not included); its cells summed 11 729 CPU s
of encode and measurement. Projected from it the shard fit 4.5 h at G 1, 8 and 16, and no G was cut.

**Read from every cell.** q-hist: every frame of all 450 cells at the cell's Q and no other; the count is the frame
count + 1 on every cell (reported as read). ColorVideoVDP scored all 210 stored-form cells. Temporal unit sizes are in
the rows.

**Checks** (`rows/shard-2.checks.json`, on `usb_cine`, the series `shard.sh` picks as the shard's last grey set — not
`dbt12_ea1141`, which §7 names for the pilot; the synthetic checks do not depend on the series):

| check | as run | mutated | sees it |
| --- | --- | --- | --- |
| σ on integer frames of known σ, smooth and edge scenes | 0.241 … 16.115 for σ 0.25 … 16, within 3.6 % (σ 0.25 smooth reads 0.241); scene alone 0.00 | rounding term dropped: σ 0.5 reads 0.575 | yes |
| the same | — | median in place of mean: σ 1 reads 0.784 | yes |
| the same | — | no edge exclusion: σ 1 on the edge scene reads 1.45 | yes |
| SSIM = scikit-image's, to 1e-9 | 0.99911359 both | L = 255: 0.879 | yes |
| MS-SSIM, scale 5 alone = SSIM of the 16× reduced pair; identical frames | 0.9999042 both; 1.0 | no downsampling: 0.9666 | yes |
| PSNR of a ±1 checkerboard at 12 bits | 72.245 dB, max \|Δ\| 1 | peak 255: 48.13 | yes |
| displayed levels over the window's samples only | 40 of 40, 1 level | clipped codes counted: 120 | yes |
| the band | 5 full, 4 band | no reduction: 5, 5 | yes |
| ratio on bits stored | 1.0 | 16-bit container: 1.33 | yes |
| GSDF | L(1) 0.04998, L(1023) 3 993.33, inverse 0.09 JND | c's sign flipped: L(1023) 1.6e-5 | yes |
| deterministic encode | byte-identical | `--cpu-used=5`: differs | yes |
| frames aligned: Q 1 error < neighbour step | 0.31–0.34 against 1.12–1.55 | source k + 1: 1.17–1.57 on the first three frames, 0.31 on the fourth (as the row reads) | yes |
| an exact frame reads exact | 0, 0, 0, 0 | one sample +1: 0, 1, 0, 0 | yes |
| knee and anchor | 8, 4 | rung nearest the chord: 2 | yes |
| ColorVideoVDP | 10.00 against itself, 9.88 with ±2 codes | (the second case) | yes |
| reported, no verdict: σ 8 noise blurred 0.5 · 1 px | 5.27 · 0.67 | — | — |

**`collect.py lab/av1/metrics/rows/shard-2.jsonl --partial`**, shard 2's series only:

##### Every cell

| series, form | G | Q | ratio | PSNR med / p5 / min dB | max \|Δ\| | SSIM med / min | MS-SSIM med / min | e ÷ σ med (noise band med / max) | window 1: ≥1 level med / max, ≥2 max, ≥4 max, max | scroll med / max | JOD |
| --- | --: | --: | --: | --- | --: | --- | --- | --- | --- | --- | --: |
| `dbt10_ea1141` 10bit | 1 | 1 | 3.2 | 66.01 / 65.97 / 65.97 | 9 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.15 (0.15 / 0.15) | 19.2 / 19.3 %, 0.0 %, 0.0 %, 2 | 0.04 / 0.04 | 10.0 |
| `dbt10_ea1141` 10bit | 1 | 2 | 4.1 | 62.04 / 62.00 / 61.99 | 9 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.24 (0.25 / 0.25) | 35.8 / 35.9 %, 0.4 %, 0.0 %, 3 | 0.06 / 0.06 | 10.0 |
| `dbt10_ea1141` 10bit | 1 | 4 | 5.9 | 56.35 / 56.31 / 56.31 | 18 | 0.9982 / 0.9981 | 0.9998 / 0.9998 | 0.46 (0.48 / 0.49) | 61.1 / 61.2 %, 12.6 %, 0.0 %, 5 | 0.11 / 0.11 | 10.0 |
| `dbt10_ea1141` 10bit | 1 | 8 | 11.9 | 49.42 / 49.39 / 49.39 | 80 | 0.9913 / 0.9907 | 0.9989 / 0.9987 | 1.03 (0.86 / 0.87) | 81.4 / 81.5 %, 48.2 %, 10.1 %, 13 | 0.25 / 0.26 | 9.96 |
| `dbt10_ea1141` 10bit | 1 | 12 | 20.4 | 46.21 / 46.18 / 46.17 | 168 | 0.9819 / 0.9804 | 0.9973 / 0.9969 | 1.49 (0.97 / 0.98) | 86.9 / 87.0 %, 62.3 %, 25.4 %, 39 | 0.40 / 0.42 | 9.89 |
| `dbt10_ea1141` 10bit | 1 | 16 | 31.7 | 44.25 / 44.22 / 44.22 | 343 | 0.9716 / 0.9693 | 0.9951 / 0.9944 | 1.86 (1.01 / 1.02) | 89.4 / 89.5 %, 69.3 %, 35.9 %, 43 | 0.56 / 0.58 | 9.76 |
| `dbt10_ea1141` 10bit | 1 | 24 | 62.5 | 42.15 / 42.11 / 42.10 | 389 | 0.9549 / 0.9514 | 0.9906 / 0.9892 | 2.36 (1.04 / 1.05) | 91.6 / 91.7 %, 75.4 %, 46.6 %, 85 | 0.84 / 0.87 | 9.39 |
| `dbt10_ea1141` 10bit | 1 | 32 | 143.7 | 40.31 / 40.22 / 40.20 | 417 | 0.9357 / 0.9325 | 0.9826 / 0.9802 | 2.91 (1.06 / 1.07) | 93.1 / 93.2 %, 79.6 %, 54.9 %, 94 | 1.35 / 1.39 | 8.48 |
| `dbt10_ea1141` 10bit | 1 | 40 | 270.5 | 38.90 / 38.68 / 38.67 | 444 | 0.9234 / 0.9211 | 0.9730 / 0.9715 | 3.37 (1.12 / 1.21) | 94.0 / 94.1 %, 82.3 %, 60.3 %, 98 | 1.93 / 2.00 | 7.46 |
| `dbt10_ea1141` 10bit | 1 | 56 | 887.8 | 35.39 / 35.01 / 34.94 | 522 | 0.8900 / 0.8760 | 0.9392 / 0.9331 | 4.95 (1.19 / 1.45) | 95.7 / 95.8 %, 87.5 %, 71.3 %, 163 | 3.70 / 3.89 | 5.07 |
| `dbt10_ea1141` 10bit | 16 | 1 | 3.2 | 65.92 / 65.88 / 65.87 | 16 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.15 (0.16 / 0.16) | 19.4 / 19.5 %, 0.0 %, 0.0 %, 8 | 0.04 / 0.04 | 10.0 |
| `dbt10_ea1141` 10bit | 16 | 2 | 4.1 | 62.08 / 62.03 / 62.02 | 22 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.24 (0.24 / 0.25) | 35.6 / 35.9 %, 0.4 %, 0.0 %, 9 | 0.06 / 0.06 | 10.0 |
| `dbt10_ea1141` 10bit | 16 | 4 | 6.1 | 56.23 / 56.13 / 56.11 | 30 | 0.9982 / 0.9980 | 0.9998 / 0.9997 | 0.47 (0.48 / 0.49) | 61.5 / 61.8 %, 13.3 %, 0.0 %, 15 | 0.11 / 0.12 | 10.0 |
| `dbt10_ea1141` 10bit | 16 | 8 | 12.6 | 49.56 / 49.48 / 49.40 | 59 | 0.9917 / 0.9909 | 0.9989 / 0.9987 | 1.01 (0.86 / 0.86) | 81.1 / 81.4 %, 48.1 %, 10.1 %, 28 | 0.25 / 0.26 | 9.96 |
| `dbt10_ea1141` 10bit | 16 | 12 | 22.9 | 46.30 / 46.24 / 46.19 | 105 | 0.9823 / 0.9810 | 0.9973 / 0.9969 | 1.47 (0.98 / 0.98) | 86.8 / 87.0 %, 62.3 %, 25.4 %, 52 | 0.41 / 0.42 | 9.89 |
| `dbt10_ea1141` 10bit | 16 | 16 | 38.9 | 44.38 / 44.31 / 44.23 | 131 | 0.9727 / 0.9705 | 0.9952 / 0.9946 | 1.83 (1.02 / 1.02) | 89.3 / 89.5 %, 69.1 %, 35.7 %, 66 | 0.56 / 0.59 | 9.75 |
| `dbt10_ea1141` 10bit | 16 | 24 | 96.8 | 42.10 / 42.04 / 41.98 | 261 | 0.9551 / 0.9516 | 0.9903 / 0.9889 | 2.38 (1.04 / 1.05) | 91.6 / 91.8 %, 75.8 %, 47.2 %, 64 | 0.87 / 0.93 | 9.31 |
| `dbt10_ea1141` 10bit | 16 | 32 | 315.7 | 40.14 / 40.04 / 40.02 | 337 | 0.9353 / 0.9330 | 0.9816 / 0.9799 | 2.96 (1.07 / 1.08) | 93.2 / 93.3 %, 80.1 %, 55.7 %, 82 | 1.42 / 1.50 | 8.32 |
| `dbt10_ea1141` 10bit | 16 | 40 | 787.1 | 38.56 / 38.42 / 38.29 | 436 | 0.9226 / 0.9199 | 0.9718 / 0.9684 | 3.50 (1.13 / 1.23) | 94.2 / 94.3 %, 83.0 %, 61.8 %, 104 | 2.05 / 2.21 | 7.19 |
| `dbt10_ea1141` 10bit | 16 | 56 | 4263.0 | 34.88 / 34.62 / 34.61 | 504 | 0.8882 / 0.8857 | 0.9342 / 0.9255 | 5.30 (1.18 / 1.44) | 95.9 / 96.0 %, 88.1 %, 72.7 %, 143 | 4.02 / 4.26 | 4.6 |
| `dbt10_ea1141` 10bit | 8 | 1 | 3.2 | 65.93 / 65.88 / 65.87 | 17 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.15 (0.16 / 0.16) | 19.4 / 19.5 %, 0.0 %, 0.0 %, 8 | 0.04 / 0.04 | 10.0 |
| `dbt10_ea1141` 10bit | 8 | 2 | 4.1 | 62.09 / 62.02 / 62.01 | 19 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.24 (0.24 / 0.25) | 35.6 / 35.9 %, 0.4 %, 0.0 %, 9 | 0.06 / 0.06 | 10.0 |
| `dbt10_ea1141` 10bit | 8 | 4 | 6.1 | 56.23 / 56.13 / 56.12 | 30 | 0.9982 / 0.9980 | 0.9998 / 0.9997 | 0.47 (0.48 / 0.49) | 61.5 / 61.8 %, 13.3 %, 0.0 %, 15 | 0.11 / 0.12 | 10.0 |
| `dbt10_ea1141` 10bit | 8 | 8 | 12.6 | 49.56 / 49.41 / 49.40 | 59 | 0.9916 / 0.9909 | 0.9989 / 0.9987 | 1.01 (0.86 / 0.86) | 81.1 / 81.4 %, 48.1 %, 10.1 %, 27 | 0.25 / 0.26 | 9.96 |
| `dbt10_ea1141` 10bit | 8 | 12 | 22.8 | 46.29 / 46.20 / 46.17 | 92 | 0.9823 / 0.9810 | 0.9973 / 0.9969 | 1.47 (0.98 / 0.98) | 86.8 / 87.0 %, 62.3 %, 25.4 %, 36 | 0.41 / 0.42 | 9.88 |
| `dbt10_ea1141` 10bit | 8 | 16 | 38.7 | 44.38 / 44.24 / 44.22 | 132 | 0.9727 / 0.9705 | 0.9952 / 0.9946 | 1.83 (1.02 / 1.02) | 89.3 / 89.5 %, 69.1 %, 35.7 %, 66 | 0.56 / 0.59 | 9.75 |
| `dbt10_ea1141` 10bit | 8 | 24 | 95.2 | 42.10 / 42.02 / 41.98 | 261 | 0.9551 / 0.9516 | 0.9903 / 0.9889 | 2.38 (1.04 / 1.05) | 91.7 / 91.8 %, 75.8 %, 47.2 %, 73 | 0.87 / 0.93 | 9.33 |
| `dbt10_ea1141` 10bit | 8 | 32 | 303.7 | 40.15 / 40.05 / 40.03 | 337 | 0.9351 / 0.9330 | 0.9814 / 0.9799 | 2.96 (1.06 / 1.08) | 93.2 / 93.3 %, 80.1 %, 55.7 %, 76 | 1.42 / 1.50 | 8.36 |
| `dbt10_ea1141` 10bit | 8 | 40 | 742.0 | 38.56 / 38.42 / 38.29 | 436 | 0.9225 / 0.9199 | 0.9716 / 0.9684 | 3.49 (1.13 / 1.23) | 94.1 / 94.3 %, 83.0 %, 61.8 %, 104 | 2.04 / 2.21 | 7.28 |
| `dbt10_ea1141` 10bit | 8 | 56 | 3699.2 | 34.97 / 34.61 / 34.51 | 504 | 0.8886 / 0.8857 | 0.9369 / 0.9243 | 5.13 (1.18 / 1.44) | 95.8 / 96.1 %, 88.3 %, 73.3 %, 143 | 3.90 / 4.28 | 4.87 |
| `dbt12_ea1141` 12bit | 1 | 1 | 3.9 | 71.81 / 71.76 / 71.75 | 14 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 29.0 / 29.2 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbt12_ea1141` 12bit | 1 | 2 | 5.1 | 65.87 / 65.83 / 65.83 | 19 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.23 / 0.24) | 51.7 / 52.1 %, 8.8 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbt12_ea1141` 12bit | 1 | 4 | 8.7 | 58.02 / 57.97 / 57.97 | 50 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.55 (0.55 / 0.56) | 76.3 / 76.7 %, 41.7 %, 9.1 %, 14 | 0.11 / 0.13 | 9.96 |
| `dbt12_ea1141` 12bit | 1 | 8 | 25.9 | 50.17 / 50.11 / 50.11 | 165 | 0.9908 / 0.9907 | 0.9986 / 0.9986 | 1.36 (0.97 / 0.99) | 89.5 / 90.0 %, 71.9 %, 43.3 %, 37 | 0.30 / 0.37 | 9.69 |
| `dbt12_ea1141` 12bit | 1 | 12 | 68.5 | 47.14 / 47.06 / 47.05 | 197 | 0.9816 / 0.9812 | 0.9964 / 0.9962 | 1.93 (1.03 / 1.05) | 92.4 / 92.8 %, 79.7 %, 56.6 %, 54 | 0.53 / 0.64 | 9.06 |
| `dbt12_ea1141` 12bit | 1 | 16 | 148.1 | 45.72 / 45.65 / 45.64 | 277 | 0.9752 / 0.9747 | 0.9941 / 0.9935 | 2.26 (1.04 / 1.05) | 93.5 / 93.7 %, 82.3 %, 61.6 %, 81 | 0.74 / 0.93 | 8.26 |
| `dbt12_ea1141` 12bit | 1 | 24 | 352.1 | 44.56 / 44.47 / 44.46 | 404 | 0.9699 / 0.9692 | 0.9909 / 0.9903 | 2.56 (1.04 / 1.05) | 94.2 / 94.4 %, 83.9 %, 65.1 %, 98 | 1.07 / 1.24 | 6.91 |
| `dbt12_ea1141` 12bit | 1 | 32 | 658.3 | 43.58 / 43.22 / 43.21 | 540 | 0.9667 / 0.9651 | 0.9872 / 0.9864 | 2.84 (1.04 / 1.05) | 94.7 / 94.9 %, 85.5 %, 68.2 %, 144 | 1.44 / 1.54 | 5.74 |
| `dbt12_ea1141` 12bit | 1 | 40 | 1111.5 | 42.27 / 41.68 / 41.64 | 995 | 0.9621 / 0.9566 | 0.9817 / 0.9802 | 3.26 (1.04 / 1.05) | 95.4 / 95.6 %, 87.3 %, 71.9 %, 127 | 1.90 / 2.01 | 4.42 |
| `dbt12_ea1141` 12bit | 1 | 56 | 2497.8 | 38.37 / 37.89 / 37.76 | 1374 | 0.9359 / 0.9204 | 0.9634 / 0.9591 | 4.72 (1.05 / 1.06) | 96.7 / 96.9 %, 91.0 %, 79.7 %, 200 | 3.28 / 3.76 | 2.16 |
| `dbt12_ea1141` 12bit | 16 | 1 | 3.9 | 71.80 / 71.76 / 71.74 | 25 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 29.0 / 29.3 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbt12_ea1141` 12bit | 16 | 2 | 5.1 | 65.88 / 65.84 / 65.84 | 50 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.23 / 0.24) | 51.6 / 52.1 %, 8.8 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbt12_ea1141` 12bit | 16 | 4 | 8.7 | 58.05 / 57.99 / 57.89 | 95 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.55 (0.55 / 0.56) | 76.3 / 76.7 %, 41.7 %, 9.2 %, 13 | 0.11 / 0.13 | 9.96 |
| `dbt12_ea1141` 12bit | 16 | 8 | 26.0 | 50.26 / 50.18 / 50.13 | 163 | 0.9910 / 0.9908 | 0.9987 / 0.9986 | 1.35 (0.97 / 0.98) | 89.4 / 89.9 %, 72.0 %, 43.3 %, 33 | 0.30 / 0.37 | 9.68 |
| `dbt12_ea1141` 12bit | 16 | 12 | 76.7 | 47.19 / 47.08 / 47.06 | 250 | 0.9819 / 0.9814 | 0.9965 / 0.9962 | 1.92 (1.03 / 1.05) | 92.3 / 92.7 %, 79.4 %, 56.2 %, 49 | 0.53 / 0.64 | 9.08 |
| `dbt12_ea1141` 12bit | 16 | 16 | 214.3 | 45.69 / 45.59 / 45.56 | 376 | 0.9751 / 0.9747 | 0.9939 / 0.9935 | 2.26 (1.04 / 1.05) | 93.4 / 93.7 %, 82.3 %, 61.9 %, 67 | 0.75 / 0.94 | 8.16 |
| `dbt12_ea1141` 12bit | 16 | 24 | 775.4 | 44.31 / 44.19 / 44.17 | 469 | 0.9696 / 0.9690 | 0.9897 / 0.9890 | 2.64 (1.04 / 1.05) | 94.3 / 94.5 %, 84.4 %, 66.0 %, 98 | 1.19 / 1.37 | 6.53 |
| `dbt12_ea1141` 12bit | 16 | 32 | 1844.1 | 43.22 / 42.87 / 42.85 | 488 | 0.9662 / 0.9645 | 0.9855 / 0.9847 | 2.96 (1.04 / 1.05) | 94.9 / 95.2 %, 86.2 %, 69.5 %, 101 | 1.58 / 1.74 | 5.44 |
| `dbt12_ea1141` 12bit | 16 | 40 | 4129.9 | 41.78 / 41.23 / 40.90 | 694 | 0.9623 / 0.9577 | 0.9796 / 0.9773 | 3.41 (1.04 / 1.05) | 95.6 / 95.9 %, 88.0 %, 73.4 %, 110 | 2.06 / 2.25 | 4.11 |
| `dbt12_ea1141` 12bit | 16 | 56 | 13671.4 | 37.76 / 36.60 / 36.46 | 1364 | 0.9391 / 0.9331 | 0.9607 / 0.9518 | 5.11 (1.04 / 1.06) | 96.9 / 97.2 %, 91.9 %, 81.7 %, 192 | 3.69 / 4.52 | 1.51 |
| `dbt12_ea1141` 12bit | 8 | 1 | 3.9 | 71.80 / 71.77 / 71.76 | 27 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 29.0 / 29.3 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbt12_ea1141` 12bit | 8 | 2 | 5.1 | 65.88 / 65.83 / 65.83 | 61 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.23 / 0.24) | 51.7 / 52.1 %, 8.8 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbt12_ea1141` 12bit | 8 | 4 | 8.7 | 58.05 / 58.00 / 57.98 | 86 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.55 (0.55 / 0.56) | 76.2 / 76.8 %, 41.7 %, 9.1 %, 13 | 0.11 / 0.13 | 9.96 |
| `dbt12_ea1141` 12bit | 8 | 8 | 26.0 | 50.25 / 50.18 / 50.13 | 163 | 0.9910 / 0.9908 | 0.9987 / 0.9986 | 1.35 (0.97 / 0.98) | 89.4 / 89.9 %, 71.9 %, 43.2 %, 36 | 0.30 / 0.37 | 9.69 |
| `dbt12_ea1141` 12bit | 8 | 12 | 76.3 | 47.18 / 47.10 / 47.06 | 242 | 0.9819 / 0.9814 | 0.9965 / 0.9962 | 1.91 (1.03 / 1.05) | 92.4 / 92.7 %, 79.5 %, 56.5 %, 53 | 0.53 / 0.64 | 9.07 |
| `dbt12_ea1141` 12bit | 8 | 16 | 207.1 | 45.70 / 45.60 / 45.59 | 376 | 0.9752 / 0.9748 | 0.9940 / 0.9935 | 2.27 (1.04 / 1.05) | 93.5 / 93.8 %, 82.3 %, 61.8 %, 60 | 0.75 / 0.94 | 8.2 |
| `dbt12_ea1141` 12bit | 8 | 24 | 718.8 | 44.33 / 44.20 / 44.14 | 469 | 0.9696 / 0.9688 | 0.9897 / 0.9892 | 2.63 (1.04 / 1.05) | 94.3 / 94.6 %, 84.6 %, 66.0 %, 95 | 1.18 / 1.39 | 6.56 |
| `dbt12_ea1141` 12bit | 8 | 32 | 1684.7 | 43.24 / 42.90 / 42.85 | 488 | 0.9664 / 0.9645 | 0.9860 / 0.9847 | 2.94 (1.04 / 1.05) | 94.9 / 95.2 %, 86.1 %, 69.3 %, 102 | 1.56 / 1.72 | 5.45 |
| `dbt12_ea1141` 12bit | 8 | 40 | 3677.2 | 41.91 / 41.25 / 41.12 | 694 | 0.9618 / 0.9577 | 0.9808 / 0.9773 | 3.41 (1.04 / 1.05) | 95.6 / 95.9 %, 88.0 %, 73.5 %, 125 | 2.05 / 2.28 | 4.06 |
| `dbt12_ea1141` 12bit | 8 | 56 | 10719.9 | 38.15 / 37.19 / 37.08 | 1364 | 0.9352 / 0.9279 | 0.9627 / 0.9545 | 5.03 (1.04 / 1.06) | 96.9 / 97.1 %, 91.6 %, 81.0 %, 229 | 3.66 / 4.34 | 1.78 |
| `dbt12_ea1141` top10 | 1 | 1 | 4.7 | 65.04 / 64.99 / 64.99 | 19 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.24 / 0.25) | 50.7 / 51.2 %, 12.2 %, 0.1 %, 6 | 0.07 / 0.08 | — |
| `dbt12_ea1141` top10 | 1 | 2 | 6.3 | 61.56 / 61.52 / 61.51 | 29 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.37 (0.37 / 0.38) | 65.4 / 65.9 %, 25.0 %, 1.8 %, 8 | 0.09 / 0.11 | — |
| `dbt12_ea1141` top10 | 1 | 4 | 10.0 | 56.23 / 56.19 / 56.18 | 71 | 0.9978 / 0.9977 | 0.9997 / 0.9997 | 0.68 (0.65 / 0.67) | 80.2 / 80.7 %, 49.6 %, 15.3 %, 16 | 0.15 / 0.18 | — |
| `dbt12_ea1141` top10 | 1 | 8 | 27.6 | 49.87 / 49.81 / 49.81 | 164 | 0.9902 / 0.9901 | 0.9985 / 0.9984 | 1.41 (0.99 / 1.00) | 89.8 / 90.3 %, 72.9 %, 44.7 %, 37 | 0.33 / 0.39 | — |
| `dbt12_ea1141` top10 | 1 | 12 | 65.0 | 47.22 / 47.13 / 47.11 | 173 | 0.9821 / 0.9818 | 0.9965 / 0.9963 | 1.91 (1.04 / 1.05) | 92.3 / 92.7 %, 79.4 %, 56.2 %, 50 | 0.52 / 0.63 | — |
| `dbt12_ea1141` top10 | 1 | 16 | 127.6 | 45.93 / 45.86 / 45.85 | 260 | 0.9765 / 0.9760 | 0.9945 / 0.9941 | 2.21 (1.04 / 1.06) | 93.3 / 93.6 %, 81.9 %, 61.0 %, 58 | 0.71 / 0.87 | — |
| `dbt12_ea1141` top10 | 1 | 24 | 305.4 | 44.76 / 44.68 / 44.66 | 360 | 0.9712 / 0.9707 | 0.9914 / 0.9910 | 2.51 (1.04 / 1.06) | 94.1 / 94.3 %, 83.7 %, 64.5 %, 95 | 1.02 / 1.19 | — |
| `dbt12_ea1141` top10 | 1 | 32 | 571.2 | 43.85 / 43.62 / 43.61 | 446 | 0.9679 / 0.9671 | 0.9881 / 0.9875 | 2.76 (1.05 / 1.06) | 94.6 / 94.8 %, 85.1 %, 67.5 %, 99 | 1.35 / 1.45 | — |
| `dbt12_ea1141` top10 | 1 | 40 | 943.2 | 42.73 / 42.27 / 42.23 | 745 | 0.9637 / 0.9602 | 0.9837 / 0.9825 | 3.11 (1.05 / 1.06) | 95.2 / 95.3 %, 86.7 %, 70.6 %, 102 | 1.72 / 1.83 | — |
| `dbt12_ea1141` top10 | 1 | 56 | 2110.6 | 39.61 / 38.98 / 38.91 | 1380 | 0.9468 / 0.9379 | 0.9685 / 0.9653 | 4.26 (1.05 / 1.06) | 96.4 / 96.5 %, 90.0 %, 77.9 %, 187 | 2.85 / 3.23 | — |
| `dbt12_ea1141` top10 | 16 | 1 | 4.7 | 65.04 / 65.00 / 64.99 | 53 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.24 / 0.25) | 50.7 / 51.2 %, 12.1 %, 0.1 %, 6 | 0.07 / 0.08 | — |
| `dbt12_ea1141` top10 | 16 | 2 | 6.2 | 61.59 / 61.53 / 61.52 | 56 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.37 (0.36 / 0.38) | 65.4 / 65.9 %, 25.0 %, 1.8 %, 9 | 0.09 / 0.11 | — |
| `dbt12_ea1141` top10 | 16 | 4 | 10.0 | 56.24 / 56.12 / 56.10 | 106 | 0.9978 / 0.9977 | 0.9997 / 0.9997 | 0.68 (0.65 / 0.67) | 80.1 / 80.7 %, 49.8 %, 15.8 %, 17 | 0.15 / 0.18 | — |
| `dbt12_ea1141` top10 | 16 | 8 | 27.7 | 49.94 / 49.86 / 49.81 | 186 | 0.9904 / 0.9902 | 0.9985 / 0.9984 | 1.40 (0.99 / 1.00) | 89.8 / 90.2 %, 72.7 %, 44.5 %, 37 | 0.33 / 0.39 | — |
| `dbt12_ea1141` top10 | 16 | 12 | 71.8 | 47.28 / 47.15 / 47.11 | 221 | 0.9823 / 0.9820 | 0.9965 / 0.9963 | 1.90 (1.04 / 1.05) | 92.3 / 92.7 %, 79.4 %, 56.1 %, 50 | 0.53 / 0.64 | — |
| `dbt12_ea1141` top10 | 16 | 16 | 180.4 | 45.86 / 45.78 / 45.77 | 317 | 0.9764 / 0.9757 | 0.9944 / 0.9938 | 2.22 (1.04 / 1.06) | 93.3 / 93.7 %, 82.0 %, 61.1 %, 59 | 0.74 / 0.90 | — |
| `dbt12_ea1141` top10 | 16 | 24 | 598.7 | 44.65 / 44.52 / 44.47 | 477 | 0.9711 / 0.9704 | 0.9909 / 0.9904 | 2.56 (1.05 / 1.06) | 94.2 / 94.4 %, 84.0 %, 65.0 %, 96 | 1.06 / 1.27 | — |
| `dbt12_ea1141` top10 | 16 | 32 | 1444.6 | 43.68 / 43.42 / 43.39 | 473 | 0.9676 / 0.9663 | 0.9875 / 0.9867 | 2.82 (1.05 / 1.06) | 94.7 / 94.9 %, 85.5 %, 68.1 %, 101 | 1.41 / 1.54 | — |
| `dbt12_ea1141` top10 | 16 | 40 | 3033.9 | 42.45 / 42.01 / 41.98 | 749 | 0.9628 / 0.9592 | 0.9825 / 0.9812 | 3.19 (1.05 / 1.06) | 95.3 / 95.5 %, 87.2 %, 71.6 %, 102 | 1.80 / 1.99 | — |
| `dbt12_ea1141` top10 | 16 | 56 | 10616.4 | 39.19 / 38.54 / 38.42 | 1372 | 0.9457 / 0.9375 | 0.9661 / 0.9626 | 4.47 (1.04 / 1.06) | 96.6 / 96.8 %, 90.6 %, 78.8 %, 163 | 3.16 / 3.47 | — |
| `dbt12_ea1141` top10 | 8 | 1 | 4.7 | 65.04 / 65.00 / 65.00 | 45 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.24 / 0.25) | 50.6 / 51.1 %, 12.1 %, 0.1 %, 6 | 0.07 / 0.08 | — |
| `dbt12_ea1141` top10 | 8 | 2 | 6.2 | 61.59 / 61.53 / 61.52 | 87 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.37 (0.36 / 0.38) | 65.4 / 65.9 %, 25.0 %, 1.8 %, 9 | 0.09 / 0.11 | — |
| `dbt12_ea1141` top10 | 8 | 4 | 10.0 | 56.23 / 56.12 / 56.04 | 115 | 0.9978 / 0.9977 | 0.9997 / 0.9997 | 0.68 (0.65 / 0.67) | 80.2 / 80.7 %, 49.8 %, 15.8 %, 16 | 0.15 / 0.18 | — |
| `dbt12_ea1141` top10 | 8 | 8 | 27.7 | 49.94 / 49.85 / 49.81 | 181 | 0.9904 / 0.9901 | 0.9985 / 0.9984 | 1.40 (0.98 / 1.00) | 89.8 / 90.2 %, 72.7 %, 44.4 %, 37 | 0.33 / 0.39 | — |
| `dbt12_ea1141` top10 | 8 | 12 | 71.1 | 47.28 / 47.14 / 47.11 | 252 | 0.9824 / 0.9820 | 0.9965 / 0.9963 | 1.90 (1.04 / 1.05) | 92.3 / 92.6 %, 79.2 %, 56.0 %, 49 | 0.53 / 0.64 | — |
| `dbt12_ea1141` top10 | 8 | 16 | 175.3 | 45.87 / 45.80 / 45.80 | 307 | 0.9764 / 0.9757 | 0.9944 / 0.9938 | 2.22 (1.04 / 1.06) | 93.3 / 93.7 %, 82.0 %, 61.2 %, 61 | 0.73 / 0.90 | — |
| `dbt12_ea1141` top10 | 8 | 24 | 574.6 | 44.68 / 44.52 / 44.47 | 477 | 0.9711 / 0.9702 | 0.9909 / 0.9903 | 2.54 (1.05 / 1.06) | 94.2 / 94.4 %, 84.0 %, 65.1 %, 95 | 1.07 / 1.27 | — |
| `dbt12_ea1141` top10 | 8 | 32 | 1332.7 | 43.67 / 43.43 / 43.41 | 473 | 0.9680 / 0.9663 | 0.9876 / 0.9865 | 2.81 (1.05 / 1.06) | 94.7 / 94.9 %, 85.5 %, 68.2 %, 100 | 1.41 / 1.55 | — |
| `dbt12_ea1141` top10 | 8 | 40 | 2749.6 | 42.52 / 42.01 / 41.82 | 749 | 0.9638 / 0.9598 | 0.9828 / 0.9815 | 3.19 (1.05 / 1.06) | 95.3 / 95.5 %, 87.1 %, 71.3 %, 101 | 1.82 / 1.99 | — |
| `dbt12_ea1141` top10 | 8 | 56 | 8662.9 | 39.31 / 38.70 / 38.41 | 1372 | 0.9461 / 0.9375 | 0.9672 / 0.9637 | 4.46 (1.04 / 1.06) | 96.5 / 96.7 %, 90.4 %, 78.5 %, 177 | 3.03 / 3.47 | — |
| `dbt12_ea1141` window | 1 | 1 | 2.8 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.39 / 0.41) | 20.1 / 21.7 %, 13.9 %, 11.9 %, 30 | 2.15 / 2.51 | — |
| `dbt12_ea1141` window | 1 | 2 | 3.4 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.40 / 0.41) | 25.6 / 27.0 %, 14.0 %, 12.0 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 1 | 4 | 4.3 | 13.62 / 13.20 / 13.12 | 1455 | 0.6503 / 0.6083 | 0.9041 / 0.8951 | 4.08 (0.40 / 0.42) | 37.3 / 38.6 %, 14.4 %, 12.1 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 1 | 8 | 5.9 | 13.62 / 13.20 / 13.12 | 1458 | 0.6501 / 0.6081 | 0.9041 / 0.8951 | 4.08 (0.45 / 0.46) | 61.0 / 61.7 %, 22.7 %, 12.3 %, 31 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 1 | 12 | 7.5 | 13.62 / 13.20 / 13.12 | 1462 | 0.6496 / 0.6077 | 0.9040 / 0.8950 | 4.10 (0.52 / 0.54) | 73.9 / 74.4 %, 37.5 %, 14.0 %, 31 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 1 | 16 | 9.2 | 13.62 / 13.20 / 13.12 | 1465 | 0.6491 / 0.6072 | 0.9039 / 0.8949 | 4.12 (0.61 / 0.62) | 80.4 / 81.0 %, 49.5 %, 18.8 %, 32 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 1 | 24 | 13.1 | 13.62 / 13.20 / 13.12 | 1468 | 0.6476 / 0.6056 | 0.9037 / 0.8947 | 4.16 (0.77 / 0.78) | 87.0 / 87.3 %, 64.4 %, 31.8 %, 33 | 2.18 / 2.53 | — |
| `dbt12_ea1141` window | 1 | 32 | 25.4 | 13.62 / 13.20 / 13.12 | 1474 | 0.6433 / 0.6012 | 0.9030 / 0.8940 | 4.27 (0.96 / 0.97) | 91.8 / 92.0 %, 76.9 %, 50.5 %, 49 | 2.20 / 2.55 | — |
| `dbt12_ea1141` window | 1 | 40 | 65.9 | 13.61 / 13.20 / 13.12 | 1476 | 0.6356 / 0.5936 | 0.9011 / 0.8923 | 4.47 (1.03 / 1.05) | 94.2 / 94.4 %, 83.6 %, 63.1 %, 52 | 2.26 / 2.59 | — |
| `dbt12_ea1141` window | 1 | 56 | 633.7 | 13.61 / 13.19 / 13.11 | 1503 | 0.6245 / 0.5842 | 0.8939 / 0.8871 | 4.88 (1.04 / 1.05) | 95.9 / 96.1 %, 88.4 %, 73.4 %, 96 | 2.55 / 2.85 | — |
| `dbt12_ea1141` window | 16 | 1 | 2.8 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.39 / 0.41) | 20.1 / 21.6 %, 13.9 %, 11.8 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 16 | 2 | 3.4 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.40 / 0.41) | 25.5 / 27.0 %, 14.0 %, 11.9 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 16 | 4 | 4.3 | 13.62 / 13.20 / 13.12 | 1455 | 0.6503 / 0.6083 | 0.9041 / 0.8951 | 4.07 (0.40 / 0.42) | 37.4 / 38.6 %, 14.3 %, 12.0 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 16 | 8 | 5.9 | 13.62 / 13.20 / 13.12 | 1455 | 0.6501 / 0.6081 | 0.9041 / 0.8951 | 4.08 (0.44 / 0.46) | 60.5 / 61.7 %, 22.5 %, 12.3 %, 31 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 16 | 12 | 7.4 | 13.62 / 13.20 / 13.12 | 1457 | 0.6496 / 0.6077 | 0.9040 / 0.8950 | 4.10 (0.51 / 0.53) | 73.5 / 74.4 %, 37.5 %, 14.0 %, 31 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 16 | 16 | 9.1 | 13.62 / 13.20 / 13.12 | 1463 | 0.6491 / 0.6072 | 0.9039 / 0.8949 | 4.12 (0.60 / 0.62) | 80.5 / 81.1 %, 49.9 %, 19.0 %, 33 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 16 | 24 | 13.1 | 13.62 / 13.20 / 13.12 | 1467 | 0.6476 / 0.6056 | 0.9037 / 0.8947 | 4.16 (0.77 / 0.78) | 87.0 / 87.3 %, 64.5 %, 31.8 %, 34 | 2.18 / 2.53 | — |
| `dbt12_ea1141` window | 16 | 32 | 25.3 | 13.62 / 13.20 / 13.12 | 1472 | 0.6433 / 0.6013 | 0.9030 / 0.8940 | 4.27 (0.96 / 0.97) | 91.7 / 92.0 %, 76.7 %, 50.5 %, 37 | 2.20 / 2.55 | — |
| `dbt12_ea1141` window | 16 | 40 | 69.3 | 13.62 / 13.20 / 13.12 | 1482 | 0.6356 / 0.5940 | 0.9012 / 0.8924 | 4.46 (1.03 / 1.05) | 94.2 / 94.3 %, 83.5 %, 63.1 %, 46 | 2.26 / 2.59 | — |
| `dbt12_ea1141` window | 16 | 56 | 1508.4 | 13.61 / 13.19 / 13.11 | 1500 | 0.6244 / 0.5840 | 0.8935 / 0.8869 | 4.91 (1.04 / 1.05) | 96.0 / 96.1 %, 88.6 %, 73.7 %, 100 | 2.59 / 2.85 | — |
| `dbt12_ea1141` window | 8 | 1 | 2.8 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.39 / 0.41) | 20.1 / 21.6 %, 13.9 %, 11.8 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 8 | 2 | 3.4 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.39 / 0.41) | 25.4 / 27.0 %, 14.0 %, 11.9 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 8 | 4 | 4.3 | 13.62 / 13.20 / 13.12 | 1455 | 0.6503 / 0.6083 | 0.9041 / 0.8951 | 4.07 (0.40 / 0.42) | 37.3 / 38.6 %, 14.3 %, 12.0 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 8 | 8 | 5.9 | 13.62 / 13.20 / 13.12 | 1455 | 0.6501 / 0.6081 | 0.9041 / 0.8951 | 4.08 (0.44 / 0.46) | 60.5 / 61.7 %, 22.5 %, 12.3 %, 31 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 8 | 12 | 7.4 | 13.62 / 13.20 / 13.12 | 1457 | 0.6496 / 0.6077 | 0.9040 / 0.8950 | 4.10 (0.52 / 0.54) | 73.5 / 74.4 %, 37.5 %, 14.0 %, 31 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 8 | 16 | 9.1 | 13.62 / 13.20 / 13.12 | 1461 | 0.6491 / 0.6071 | 0.9040 / 0.8949 | 4.12 (0.61 / 0.62) | 80.6 / 81.1 %, 49.9 %, 19.0 %, 32 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 8 | 24 | 13.1 | 13.62 / 13.20 / 13.12 | 1467 | 0.6476 / 0.6056 | 0.9037 / 0.8947 | 4.16 (0.77 / 0.78) | 87.0 / 87.3 %, 64.5 %, 31.8 %, 33 | 2.18 / 2.53 | — |
| `dbt12_ea1141` window | 8 | 32 | 25.4 | 13.62 / 13.20 / 13.12 | 1472 | 0.6433 / 0.6014 | 0.9029 / 0.8940 | 4.27 (0.96 / 0.97) | 91.7 / 92.0 %, 76.7 %, 50.5 %, 37 | 2.20 / 2.55 | — |
| `dbt12_ea1141` window | 8 | 40 | 69.2 | 13.62 / 13.20 / 13.12 | 1482 | 0.6356 / 0.5939 | 0.9012 / 0.8924 | 4.46 (1.03 / 1.05) | 94.2 / 94.3 %, 83.5 %, 63.1 %, 45 | 2.26 / 2.59 | — |
| `dbt12_ea1141` window | 8 | 56 | 1399.4 | 13.61 / 13.19 / 13.11 | 1503 | 0.6244 / 0.5840 | 0.8936 / 0.8870 | 4.91 (1.04 / 1.05) | 96.0 / 96.1 %, 88.6 %, 73.7 %, 98 | 2.59 / 2.85 | — |
| `dbts_a2` 12bit | 1 | 1 | 4.4 | 72.08 / 71.77 / 71.77 | 37 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 21.1 / 22.2 %, 0.1 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbts_a2` 12bit | 1 | 2 | 5.7 | 66.13 / 65.83 / 65.83 | 41 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.21 (0.22 / 0.24) | 40.7 / 42.7 %, 3.3 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a2` 12bit | 1 | 4 | 9.9 | 58.08 / 57.79 / 57.79 | 80 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.54 / 0.59) | 68.9 / 70.7 %, 30.0 %, 3.6 %, 12 | 0.12 / 0.14 | 9.97 |
| `dbts_a2` 12bit | 1 | 8 | 31.2 | 50.40 / 50.22 / 50.21 | 264 | 0.9910 / 0.9905 | 0.9987 / 0.9986 | 1.31 (0.99 / 1.01) | 85.4 / 87.3 %, 64.9 %, 33.3 %, 35 | 0.31 / 0.37 | 9.76 |
| `dbts_a2` 12bit | 1 | 12 | 94.5 | 47.49 / 47.30 / 47.28 | 322 | 0.9829 / 0.9818 | 0.9967 / 0.9963 | 1.83 (1.05 / 1.07) | 88.9 / 90.6 %, 73.6 %, 47.0 %, 50 | 0.54 / 0.64 | 9.25 |
| `dbts_a2` 12bit | 1 | 16 | 203.6 | 46.39 / 46.14 / 46.12 | 392 | 0.9786 / 0.9768 | 0.9949 / 0.9943 | 2.07 (1.05 / 1.07) | 90.1 / 91.5 %, 75.9 %, 51.0 %, 58 | 0.74 / 0.89 | 8.57 |
| `dbts_a2` 12bit | 1 | 24 | 427.2 | 45.47 / 45.22 / 45.20 | 534 | 0.9744 / 0.9726 | 0.9925 / 0.9916 | 2.28 (1.05 / 1.07) | 91.0 / 92.2 %, 77.7 %, 53.9 %, 88 | 1.01 / 1.22 | 7.56 |
| `dbts_a2` 12bit | 1 | 32 | 860.2 | 44.50 / 44.26 / 44.25 | 999 | 0.9737 / 0.9712 | 0.9897 / 0.9882 | 2.53 (1.05 / 1.07) | 92.0 / 93.0 %, 79.7 %, 57.1 %, 122 | 1.36 / 1.63 | 6.23 |
| `dbts_a2` 12bit | 1 | 40 | 1593.6 | 43.26 / 42.90 / 42.87 | 1298 | 0.9706 / 0.9667 | 0.9861 / 0.9833 | 2.84 (1.05 / 1.07) | 92.9 / 93.7 %, 81.6 %, 60.3 %, 181 | 1.73 / 2.14 | 5.16 |
| `dbts_a2` 12bit | 1 | 56 | 4298.0 | 39.50 / 38.99 / 38.90 | 2201 | 0.9531 / 0.9332 | 0.9741 / 0.9691 | 4.15 (1.06 / 1.08) | 94.7 / 95.0 %, 85.0 %, 66.5 %, 202 | 3.09 / 3.57 | 3.24 |
| `dbts_a2` 12bit | 16 | 1 | 4.3 | 72.09 / 71.80 / 71.78 | 56 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 21.1 / 22.1 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a2` 12bit | 16 | 2 | 5.8 | 65.69 / 65.32 / 65.31 | 105 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.23 (0.23 / 0.26) | 42.2 / 44.3 %, 4.1 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a2` 12bit | 16 | 4 | 9.9 | 58.02 / 57.78 / 57.77 | 155 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.54 / 0.59) | 68.9 / 70.9 %, 30.4 %, 3.7 %, 12 | 0.12 / 0.14 | 9.97 |
| `dbts_a2` 12bit | 16 | 8 | 31.4 | 50.51 / 50.36 / 50.21 | 206 | 0.9914 / 0.9906 | 0.9987 / 0.9986 | 1.29 (0.98 / 1.01) | 85.3 / 87.1 %, 64.6 %, 32.8 %, 31 | 0.31 / 0.37 | 9.76 |
| `dbts_a2` 12bit | 16 | 12 | 112.1 | 47.57 / 47.38 / 47.29 | 322 | 0.9833 / 0.9818 | 0.9967 / 0.9963 | 1.81 (1.05 / 1.07) | 88.9 / 90.4 %, 73.3 %, 46.6 %, 53 | 0.54 / 0.65 | 9.26 |
| `dbts_a2` 12bit | 16 | 16 | 333.5 | 46.39 / 46.13 / 46.09 | 356 | 0.9790 / 0.9771 | 0.9949 / 0.9941 | 2.07 (1.05 / 1.07) | 90.1 / 91.5 %, 75.9 %, 51.0 %, 63 | 0.75 / 0.93 | 8.54 |
| `dbts_a2` 12bit | 16 | 24 | 1088.8 | 45.28 / 44.96 / 44.90 | 603 | 0.9753 / 0.9725 | 0.9920 / 0.9906 | 2.34 (1.05 / 1.07) | 91.2 / 92.4 %, 78.2 %, 54.7 %, 88 | 1.09 / 1.37 | 7.28 |
| `dbts_a2` 12bit | 16 | 32 | 2949.1 | 44.25 / 43.95 / 43.91 | 689 | 0.9739 / 0.9716 | 0.9888 / 0.9869 | 2.62 (1.05 / 1.07) | 92.3 / 93.2 %, 80.4 %, 58.2 %, 143 | 1.48 / 1.79 | 6.04 |
| `dbts_a2` 12bit | 16 | 40 | 6739.5 | 42.84 / 42.40 / 42.31 | 891 | 0.9703 / 0.9676 | 0.9847 / 0.9820 | 3.02 (1.05 / 1.07) | 93.3 / 94.0 %, 82.5 %, 62.1 %, 181 | 1.94 / 2.33 | 4.93 |
| `dbts_a2` 12bit | 16 | 56 | 22296.1 | 39.23 / 37.94 / 37.75 | 2101 | 0.9516 / 0.9478 | 0.9725 / 0.9657 | 4.39 (1.05 / 1.08) | 95.0 / 95.4 %, 86.2 %, 69.1 %, 219 | 3.40 / 4.13 | 3.03 |
| `dbts_a2` 12bit | 8 | 1 | 4.3 | 72.09 / 71.79 / 71.78 | 56 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 21.1 / 22.1 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a2` 12bit | 8 | 2 | 5.8 | 65.81 / 65.32 / 65.30 | 105 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.23 / 0.26) | 42.0 / 44.3 %, 4.1 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a2` 12bit | 8 | 4 | 9.9 | 58.05 / 57.78 / 57.77 | 145 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.54 / 0.59) | 68.9 / 70.9 %, 30.4 %, 3.7 %, 12 | 0.12 / 0.14 | 9.97 |
| `dbts_a2` 12bit | 8 | 8 | 31.4 | 50.52 / 50.30 / 50.21 | 264 | 0.9914 / 0.9906 | 0.9987 / 0.9986 | 1.29 (0.99 / 1.01) | 85.3 / 87.1 %, 64.6 %, 32.8 %, 31 | 0.31 / 0.37 | 9.76 |
| `dbts_a2` 12bit | 8 | 12 | 111.2 | 47.57 / 47.36 / 47.29 | 322 | 0.9833 / 0.9818 | 0.9967 / 0.9963 | 1.81 (1.05 / 1.07) | 88.9 / 90.4 %, 73.3 %, 46.6 %, 48 | 0.54 / 0.65 | 9.27 |
| `dbts_a2` 12bit | 8 | 16 | 324.8 | 46.39 / 46.13 / 46.09 | 356 | 0.9789 / 0.9771 | 0.9948 / 0.9941 | 2.07 (1.05 / 1.07) | 90.1 / 91.5 %, 75.9 %, 51.0 %, 64 | 0.74 / 0.93 | 8.55 |
| `dbts_a2` 12bit | 8 | 24 | 1024.8 | 45.34 / 44.96 / 44.90 | 512 | 0.9753 / 0.9725 | 0.9921 / 0.9906 | 2.32 (1.05 / 1.07) | 91.2 / 92.4 %, 78.2 %, 54.7 %, 87 | 1.08 / 1.37 | 7.34 |
| `dbts_a2` 12bit | 8 | 32 | 2658.1 | 44.30 / 43.98 / 43.92 | 686 | 0.9737 / 0.9716 | 0.9889 / 0.9869 | 2.60 (1.05 / 1.07) | 92.2 / 93.2 %, 80.4 %, 58.2 %, 144 | 1.44 / 1.79 | 6.08 |
| `dbts_a2` 12bit | 8 | 40 | 5858.5 | 42.99 / 42.45 / 42.34 | 987 | 0.9711 / 0.9676 | 0.9852 / 0.9820 | 2.95 (1.05 / 1.07) | 93.2 / 94.0 %, 82.5 %, 62.1 %, 182 | 1.86 / 2.33 | 5.04 |
| `dbts_a2` 12bit | 8 | 56 | 18113.4 | 39.46 / 38.36 / 38.10 | 2101 | 0.9515 / 0.9448 | 0.9731 / 0.9666 | 4.30 (1.05 / 1.08) | 94.8 / 95.2 %, 85.8 %, 68.3 %, 215 | 3.21 / 4.04 | 3.23 |
| `dbts_a2` top10 | 1 | 1 | 5.3 | 65.30 / 65.00 / 64.99 | 29 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.24 (0.23 / 0.26) | 41.8 / 44.3 %, 5.8 %, 0.0 %, 5 | 0.07 / 0.08 | — |
| `dbts_a2` top10 | 1 | 2 | 7.0 | 61.79 / 61.50 / 61.49 | 53 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.35 (0.35 / 0.39) | 56.1 / 58.5 %, 14.8 %, 0.4 %, 8 | 0.10 / 0.11 | — |
| `dbts_a2` top10 | 1 | 4 | 11.5 | 56.33 / 56.05 / 56.03 | 175 | 0.9978 / 0.9976 | 0.9997 / 0.9997 | 0.66 (0.64 / 0.69) | 73.7 / 75.5 %, 38.6 %, 7.4 %, 14 | 0.15 / 0.18 | — |
| `dbts_a2` top10 | 1 | 8 | 33.3 | 50.10 / 49.93 / 49.92 | 262 | 0.9906 / 0.9901 | 0.9985 / 0.9984 | 1.36 (1.00 / 1.02) | 85.8 / 87.7 %, 66.1 %, 34.9 %, 31 | 0.33 / 0.39 | — |
| `dbts_a2` top10 | 1 | 12 | 88.9 | 47.62 / 47.41 / 47.39 | 331 | 0.9835 / 0.9825 | 0.9968 / 0.9965 | 1.80 (1.05 / 1.07) | 88.8 / 90.4 %, 73.2 %, 46.4 %, 48 | 0.52 / 0.63 | — |
| `dbts_a2` top10 | 1 | 16 | 179.6 | 46.53 / 46.30 / 46.28 | 455 | 0.9794 / 0.9779 | 0.9952 / 0.9946 | 2.04 (1.05 / 1.08) | 90.0 / 91.3 %, 75.7 %, 50.5 %, 56 | 0.71 / 0.85 | — |
| `dbts_a2` top10 | 1 | 24 | 377.3 | 45.68 / 45.40 / 45.38 | 515 | 0.9768 / 0.9747 | 0.9931 / 0.9921 | 2.24 (1.05 / 1.08) | 90.8 / 92.1 %, 77.5 %, 53.6 %, 87 | 0.96 / 1.17 | — |
| `dbts_a2` top10 | 1 | 32 | 737.3 | 44.80 / 44.54 / 44.52 | 992 | 0.9748 / 0.9723 | 0.9905 / 0.9891 | 2.46 (1.06 / 1.08) | 91.8 / 92.8 %, 79.2 %, 56.5 %, 91 | 1.27 / 1.53 | — |
| `dbts_a2` top10 | 1 | 40 | 1312.7 | 43.75 / 43.45 / 43.41 | 1319 | 0.9710 / 0.9682 | 0.9873 / 0.9851 | 2.72 (1.06 / 1.08) | 92.7 / 93.4 %, 81.0 %, 59.3 %, 125 | 1.60 / 1.95 | — |
| `dbts_a2` top10 | 1 | 56 | 3499.8 | 40.75 / 40.23 / 40.11 | 2076 | 0.9532 / 0.9424 | 0.9771 / 0.9740 | 3.65 (1.06 / 1.08) | 94.2 / 94.5 %, 83.9 %, 64.5 %, 194 | 2.60 / 3.02 | — |
| `dbts_a2` top10 | 16 | 1 | 5.4 | 64.96 / 64.60 / 64.59 | 91 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.24 / 0.26) | 43.2 / 45.7 %, 6.6 %, 0.0 %, 5 | 0.08 / 0.09 | — |
| `dbts_a2` top10 | 16 | 2 | 6.9 | 61.70 / 61.42 / 61.41 | 99 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.36 (0.35 / 0.39) | 56.4 / 58.8 %, 15.1 %, 0.4 %, 8 | 0.10 / 0.12 | — |
| `dbts_a2` top10 | 16 | 4 | 11.5 | 56.27 / 56.02 / 56.01 | 159 | 0.9977 / 0.9976 | 0.9997 / 0.9997 | 0.67 (0.65 / 0.69) | 73.8 / 75.8 %, 39.1 %, 7.7 %, 15 | 0.16 / 0.19 | — |
| `dbts_a2` top10 | 16 | 8 | 33.7 | 50.19 / 50.04 / 49.93 | 203 | 0.9908 / 0.9901 | 0.9986 / 0.9984 | 1.34 (1.00 / 1.02) | 85.7 / 87.6 %, 65.7 %, 34.4 %, 33 | 0.33 / 0.40 | — |
| `dbts_a2` top10 | 16 | 12 | 104.4 | 47.62 / 47.43 / 47.39 | 331 | 0.9836 / 0.9825 | 0.9968 / 0.9964 | 1.80 (1.05 / 1.07) | 88.8 / 90.5 %, 73.2 %, 46.4 %, 49 | 0.54 / 0.66 | — |
| `dbts_a2` top10 | 16 | 16 | 275.4 | 46.54 / 46.29 / 46.28 | 404 | 0.9796 / 0.9780 | 0.9952 / 0.9946 | 2.03 (1.05 / 1.08) | 89.9 / 91.4 %, 75.6 %, 50.5 %, 63 | 0.72 / 0.87 | — |
| `dbts_a2` top10 | 16 | 24 | 845.7 | 45.55 / 45.27 / 45.18 | 400 | 0.9766 / 0.9746 | 0.9928 / 0.9915 | 2.27 (1.06 / 1.08) | 90.9 / 92.1 %, 77.6 %, 53.8 %, 92 | 1.00 / 1.26 | — |
| `dbts_a2` top10 | 16 | 32 | 2228.4 | 44.61 / 44.37 / 44.35 | 474 | 0.9746 / 0.9726 | 0.9900 / 0.9886 | 2.51 (1.07 / 1.09) | 91.9 / 92.9 %, 79.5 %, 56.8 %, 112 | 1.33 / 1.61 | — |
| `dbts_a2` top10 | 16 | 40 | 4886.1 | 43.46 / 43.23 / 43.09 | 847 | 0.9698 / 0.9683 | 0.9865 / 0.9841 | 2.81 (1.06 / 1.09) | 92.8 / 93.6 %, 81.4 %, 60.0 %, 179 | 1.70 / 2.07 | — |
| `dbts_a2` top10 | 16 | 56 | 17017.0 | 40.53 / 39.64 / 39.47 | 1869 | 0.9547 / 0.9502 | 0.9759 / 0.9721 | 3.87 (1.06 / 1.08) | 94.4 / 94.7 %, 84.3 %, 65.3 %, 208 | 2.84 / 3.30 | — |
| `dbts_a2` top10 | 8 | 1 | 5.4 | 65.00 / 64.60 / 64.60 | 66 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.24 (0.24 / 0.26) | 43.1 / 45.7 %, 6.6 %, 0.0 %, 5 | 0.08 / 0.09 | — |
| `dbts_a2` top10 | 8 | 2 | 6.9 | 61.72 / 61.42 / 61.42 | 110 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.36 (0.35 / 0.39) | 56.3 / 58.8 %, 15.1 %, 0.4 %, 8 | 0.10 / 0.12 | — |
| `dbts_a2` top10 | 8 | 4 | 11.5 | 56.29 / 56.02 / 56.02 | 155 | 0.9978 / 0.9976 | 0.9997 / 0.9997 | 0.66 (0.64 / 0.69) | 73.7 / 75.8 %, 39.1 %, 7.7 %, 15 | 0.16 / 0.19 | — |
| `dbts_a2` top10 | 8 | 8 | 33.7 | 50.20 / 50.00 / 49.93 | 262 | 0.9908 / 0.9901 | 0.9986 / 0.9984 | 1.34 (1.00 / 1.02) | 85.7 / 87.6 %, 65.7 %, 34.4 %, 32 | 0.33 / 0.40 | — |
| `dbts_a2` top10 | 8 | 12 | 103.6 | 47.63 / 47.43 / 47.39 | 331 | 0.9836 / 0.9825 | 0.9968 / 0.9964 | 1.80 (1.05 / 1.07) | 88.9 / 90.5 %, 73.2 %, 46.4 %, 48 | 0.54 / 0.66 | — |
| `dbts_a2` top10 | 8 | 16 | 269.3 | 46.54 / 46.29 / 46.28 | 355 | 0.9796 / 0.9780 | 0.9952 / 0.9946 | 2.03 (1.05 / 1.08) | 89.9 / 91.4 %, 75.6 %, 50.5 %, 62 | 0.72 / 0.87 | — |
| `dbts_a2` top10 | 8 | 24 | 805.7 | 45.60 / 45.25 / 45.18 | 508 | 0.9767 / 0.9746 | 0.9928 / 0.9915 | 2.26 (1.06 / 1.08) | 90.9 / 92.1 %, 77.6 %, 53.8 %, 85 | 0.99 / 1.26 | — |
| `dbts_a2` top10 | 8 | 32 | 2034.1 | 44.68 / 44.38 / 44.35 | 608 | 0.9747 / 0.9724 | 0.9901 / 0.9886 | 2.50 (1.06 / 1.09) | 91.9 / 92.9 %, 79.5 %, 56.8 %, 96 | 1.31 / 1.61 | — |
| `dbts_a2` top10 | 8 | 40 | 4316.2 | 43.57 / 43.22 / 43.19 | 839 | 0.9698 / 0.9683 | 0.9867 / 0.9841 | 2.77 (1.06 / 1.09) | 92.8 / 93.6 %, 81.4 %, 60.0 %, 176 | 1.66 / 2.07 | — |
| `dbts_a2` top10 | 8 | 56 | 14121.7 | 40.68 / 39.85 / 39.63 | 1888 | 0.9542 / 0.9502 | 0.9765 / 0.9725 | 3.76 (1.06 / 1.08) | 94.3 / 94.6 %, 84.2 %, 65.1 %, 205 | 2.67 / 3.30 | — |
| `dbts_a2` window | 1 | 1 | 3.5 | 9.43 / 8.01 / 7.87 | 2244 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.42 / 0.46) | 27.2 / 29.0 %, 20.7 %, 15.7 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 1 | 2 | 4.3 | 9.43 / 8.01 / 7.87 | 2244 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.43 / 0.46) | 32.2 / 33.8 %, 21.0 %, 16.0 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 1 | 4 | 5.4 | 9.43 / 8.01 / 7.87 | 2246 | 0.6127 / 0.4516 | 0.8982 / 0.8600 | 4.52 (0.44 / 0.47) | 42.0 / 43.5 %, 21.5 %, 16.5 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 1 | 8 | 7.6 | 9.43 / 8.01 / 7.87 | 2252 | 0.6124 / 0.4514 | 0.8982 / 0.8600 | 4.52 (0.48 / 0.52) | 61.7 / 62.8 %, 27.2 %, 16.9 %, 31 | 3.16 / 3.75 | — |
| `dbts_a2` window | 1 | 12 | 9.9 | 9.43 / 8.01 / 7.87 | 2257 | 0.6119 / 0.4510 | 0.8981 / 0.8599 | 4.54 (0.56 / 0.60) | 73.7 / 74.5 %, 39.0 %, 18.2 %, 33 | 3.16 / 3.75 | — |
| `dbts_a2` window | 1 | 16 | 12.5 | 9.43 / 8.01 / 7.87 | 2256 | 0.6112 / 0.4504 | 0.8980 / 0.8599 | 4.55 (0.65 / 0.70) | 80.1 / 80.7 %, 49.4 %, 21.3 %, 34 | 3.16 / 3.75 | — |
| `dbts_a2` window | 1 | 24 | 19.0 | 9.43 / 8.01 / 7.87 | 2272 | 0.6092 / 0.4489 | 0.8977 / 0.8597 | 4.60 (0.83 / 0.87) | 86.5 / 86.9 %, 63.1 %, 31.4 %, 38 | 3.18 / 3.77 | — |
| `dbts_a2` window | 1 | 32 | 43.0 | 9.43 / 8.01 / 7.87 | 2275 | 0.6043 / 0.4442 | 0.8968 / 0.8590 | 4.71 (1.01 / 1.03) | 91.2 / 91.3 %, 74.8 %, 46.9 %, 48 | 3.19 / 3.78 | — |
| `dbts_a2` window | 1 | 40 | 142.2 | 9.43 / 8.00 / 7.87 | 2276 | 0.5974 / 0.4378 | 0.8950 / 0.8575 | 4.90 (1.05 / 1.07) | 93.1 / 93.4 %, 80.7 %, 57.4 %, 56 | 3.24 / 3.82 | — |
| `dbts_a2` window | 1 | 56 | 1183.9 | 9.42 / 8.00 / 7.87 | 2298 | 0.5918 / 0.4335 | 0.8900 / 0.8537 | 5.17 (1.05 / 1.07) | 94.5 / 94.8 %, 84.4 %, 64.8 %, 137 | 3.46 / 4.04 | — |
| `dbts_a2` window | 16 | 1 | 3.5 | 9.43 / 8.01 / 7.87 | 2245 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.42 / 0.46) | 27.5 / 29.4 %, 20.8 %, 15.8 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 16 | 2 | 4.2 | 9.43 / 8.01 / 7.87 | 2246 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.43 / 0.46) | 32.3 / 34.0 %, 20.9 %, 16.0 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 16 | 4 | 5.4 | 9.43 / 8.01 / 7.87 | 2246 | 0.6127 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.44 / 0.47) | 42.3 / 43.8 %, 21.3 %, 16.4 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 16 | 8 | 7.6 | 9.43 / 8.01 / 7.87 | 2249 | 0.6124 / 0.4513 | 0.8982 / 0.8600 | 4.52 (0.48 / 0.52) | 62.0 / 63.1 %, 27.1 %, 16.8 %, 31 | 3.16 / 3.75 | — |
| `dbts_a2` window | 16 | 12 | 9.9 | 9.43 / 8.01 / 7.87 | 2252 | 0.6119 / 0.4510 | 0.8981 / 0.8599 | 4.54 (0.56 / 0.60) | 74.0 / 74.7 %, 39.3 %, 18.1 %, 32 | 3.16 / 3.75 | — |
| `dbts_a2` window | 16 | 16 | 12.5 | 9.43 / 8.01 / 7.87 | 2256 | 0.6112 / 0.4504 | 0.8980 / 0.8599 | 4.55 (0.65 / 0.70) | 80.2 / 80.8 %, 49.7 %, 21.5 %, 33 | 3.16 / 3.75 | — |
| `dbts_a2` window | 16 | 24 | 18.9 | 9.43 / 8.01 / 7.87 | 2262 | 0.6092 / 0.4488 | 0.8977 / 0.8597 | 4.59 (0.83 / 0.86) | 86.4 / 86.9 %, 63.1 %, 31.4 %, 35 | 3.17 / 3.76 | — |
| `dbts_a2` window | 16 | 32 | 42.8 | 9.43 / 8.01 / 7.87 | 2275 | 0.6046 / 0.4445 | 0.8968 / 0.8590 | 4.71 (1.00 / 1.03) | 91.0 / 91.3 %, 74.6 %, 46.9 %, 45 | 3.19 / 3.78 | — |
| `dbts_a2` window | 16 | 40 | 168.1 | 9.43 / 8.00 / 7.87 | 2282 | 0.5978 / 0.4380 | 0.8951 / 0.8575 | 4.89 (1.05 / 1.07) | 93.1 / 93.4 %, 80.6 %, 57.2 %, 56 | 3.24 / 3.82 | — |
| `dbts_a2` window | 16 | 56 | 2967.3 | 9.42 / 8.00 / 7.87 | 2298 | 0.5915 / 0.4334 | 0.8899 / 0.8536 | 5.18 (1.05 / 1.07) | 94.5 / 94.8 %, 84.5 %, 64.9 %, 117 | 3.47 / 4.05 | — |
| `dbts_a2` window | 8 | 1 | 3.5 | 9.43 / 8.01 / 7.87 | 2244 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.42 / 0.46) | 27.6 / 29.4 %, 20.7 %, 15.8 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 8 | 2 | 4.2 | 9.43 / 8.01 / 7.87 | 2245 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.43 / 0.46) | 32.3 / 34.0 %, 20.9 %, 16.0 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 8 | 4 | 5.4 | 9.43 / 8.01 / 7.87 | 2247 | 0.6127 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.44 / 0.47) | 42.2 / 43.7 %, 21.3 %, 16.4 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 8 | 8 | 7.6 | 9.43 / 8.01 / 7.87 | 2254 | 0.6124 / 0.4513 | 0.8982 / 0.8600 | 4.52 (0.48 / 0.52) | 62.0 / 63.0 %, 27.1 %, 16.8 %, 31 | 3.16 / 3.75 | — |
| `dbts_a2` window | 8 | 12 | 9.9 | 9.43 / 8.01 / 7.87 | 2252 | 0.6119 / 0.4510 | 0.8981 / 0.8599 | 4.54 (0.56 / 0.61) | 73.9 / 74.8 %, 39.4 %, 18.2 %, 31 | 3.16 / 3.75 | — |
| `dbts_a2` window | 8 | 16 | 12.5 | 9.43 / 8.01 / 7.87 | 2253 | 0.6112 / 0.4504 | 0.8980 / 0.8599 | 4.55 (0.65 / 0.70) | 80.2 / 80.8 %, 49.7 %, 21.5 %, 33 | 3.16 / 3.76 | — |
| `dbts_a2` window | 8 | 24 | 18.9 | 9.43 / 8.01 / 7.87 | 2262 | 0.6093 / 0.4488 | 0.8976 / 0.8597 | 4.59 (0.83 / 0.86) | 86.4 / 86.8 %, 63.1 %, 31.5 %, 33 | 3.17 / 3.76 | — |
| `dbts_a2` window | 8 | 32 | 42.9 | 9.43 / 8.01 / 7.87 | 2275 | 0.6046 / 0.4445 | 0.8968 / 0.8590 | 4.71 (1.01 / 1.03) | 91.1 / 91.3 %, 74.8 %, 46.9 %, 45 | 3.19 / 3.78 | — |
| `dbts_a2` window | 8 | 40 | 167.4 | 9.43 / 8.00 / 7.87 | 2266 | 0.5978 / 0.4380 | 0.8951 / 0.8575 | 4.89 (1.05 / 1.07) | 93.1 / 93.4 %, 80.6 %, 57.2 %, 50 | 3.24 / 3.82 | — |
| `dbts_a2` window | 8 | 56 | 2816.6 | 9.42 / 8.00 / 7.87 | 2315 | 0.5916 / 0.4334 | 0.8900 / 0.8536 | 5.17 (1.05 / 1.07) | 94.5 / 94.8 %, 84.5 %, 65.0 %, 136 | 3.47 / 4.05 | — |
| `dbts_b2` 10bit | 1 | 1 | 3.7 | 66.05 / 66.00 / 65.99 | 9 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.19) | 19.1 / 19.2 %, 0.0 %, 0.0 %, 2 | 0.06 / 0.07 | 10.0 |
| `dbts_b2` 10bit | 1 | 2 | 4.8 | 62.02 / 61.96 / 61.95 | 18 | 0.9994 / 0.9994 | 0.9999 / 0.9999 | 0.30 (0.30 / 0.30) | 35.9 / 36.1 %, 0.4 %, 0.0 %, 4 | 0.09 / 0.11 | 10.0 |
| `dbts_b2` 10bit | 1 | 4 | 7.6 | 56.12 / 56.05 / 56.05 | 31 | 0.9977 / 0.9977 | 0.9997 / 0.9997 | 0.58 (0.61 / 0.61) | 62.0 / 62.0 %, 13.7 %, 0.1 %, 8 | 0.18 / 0.20 | 9.99 |
| `dbts_b2` 10bit | 1 | 8 | 19.1 | 49.73 / 49.69 / 49.68 | 110 | 0.9901 / 0.9901 | 0.9985 / 0.9985 | 1.22 (0.96 / 0.96) | 80.7 / 80.8 %, 46.7 %, 9.1 %, 18 | 0.40 / 0.45 | 9.95 |
| `dbts_b2` 10bit | 1 | 12 | 39.3 | 46.95 / 46.91 / 46.91 | 206 | 0.9816 / 0.9812 | 0.9965 / 0.9964 | 1.67 (1.01 / 1.02) | 85.7 / 85.8 %, 59.3 %, 21.7 %, 41 | 0.64 / 0.74 | 9.83 |
| `dbts_b2` 10bit | 1 | 16 | 70.0 | 45.47 / 45.43 / 45.42 | 260 | 0.9746 / 0.9741 | 0.9944 / 0.9941 | 1.98 (1.03 / 1.03) | 87.8 / 87.9 %, 64.9 %, 29.4 %, 56 | 0.87 / 1.00 | 9.65 |
| `dbts_b2` 10bit | 1 | 24 | 153.9 | 44.03 / 43.99 / 43.98 | 260 | 0.9666 / 0.9657 | 0.9907 / 0.9900 | 2.34 (1.03 / 1.04) | 89.5 / 89.7 %, 69.7 %, 36.7 %, 70 | 1.27 / 1.47 | 9.12 |
| `dbts_b2` 10bit | 1 | 32 | 352.4 | 42.82 / 42.73 / 42.72 | 334 | 0.9604 / 0.9590 | 0.9858 / 0.9848 | 2.67 (1.04 / 1.05) | 90.7 / 90.8 %, 72.9 %, 42.3 %, 74 | 1.80 / 2.09 | 8.11 |
| `dbts_b2` 10bit | 1 | 40 | 683.1 | 41.66 / 41.52 / 41.50 | 404 | 0.9541 / 0.9532 | 0.9803 / 0.9791 | 2.98 (1.09 / 1.11) | 91.5 / 91.7 %, 75.4 %, 46.7 %, 115 | 2.34 / 2.74 | 7.1 |
| `dbts_b2` 10bit | 1 | 56 | 2613.7 | 38.69 / 38.38 / 38.35 | 536 | 0.9343 / 0.9305 | 0.9611 / 0.9585 | 4.06 (1.13 / 1.18) | 93.5 / 93.8 %, 81.4 %, 58.5 %, 178 | 4.09 / 4.44 | 4.4 |
| `dbts_b2` 10bit | 16 | 1 | 3.9 | 65.66 / 65.59 / 65.59 | 22 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.19) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 2 | 0.07 / 0.07 | 10.0 |
| `dbts_b2` 10bit | 16 | 2 | 4.9 | 61.98 / 61.92 / 61.92 | 24 | 0.9994 / 0.9994 | 0.9999 / 0.9999 | 0.30 (0.30 / 0.30) | 36.1 / 36.2 %, 0.5 %, 0.0 %, 3 | 0.10 / 0.11 | 10.0 |
| `dbts_b2` 10bit | 16 | 4 | 7.7 | 56.12 / 56.07 / 56.05 | 44 | 0.9977 / 0.9977 | 0.9997 / 0.9997 | 0.58 (0.60 / 0.61) | 61.9 / 62.1 %, 13.7 %, 0.1 %, 13 | 0.18 / 0.21 | 9.99 |
| `dbts_b2` 10bit | 16 | 8 | 20.3 | 49.86 / 49.78 / 49.70 | 77 | 0.9905 / 0.9901 | 0.9986 / 0.9985 | 1.20 (0.95 / 0.96) | 80.4 / 80.8 %, 46.6 %, 9.1 %, 22 | 0.40 / 0.46 | 9.95 |
| `dbts_b2` 10bit | 16 | 12 | 47.2 | 47.02 / 46.97 / 46.92 | 259 | 0.9820 / 0.9813 | 0.9966 / 0.9964 | 1.66 (1.01 / 1.02) | 85.6 / 85.8 %, 59.2 %, 21.7 %, 31 | 0.65 / 0.77 | 9.82 |
| `dbts_b2` 10bit | 16 | 16 | 98.7 | 45.50 / 45.45 / 45.43 | 244 | 0.9749 / 0.9742 | 0.9943 / 0.9940 | 1.97 (1.03 / 1.03) | 87.8 / 87.9 %, 65.1 %, 29.4 %, 47 | 0.90 / 1.05 | 9.61 |
| `dbts_b2` 10bit | 16 | 24 | 302.9 | 43.92 / 43.87 / 43.83 | 307 | 0.9663 / 0.9652 | 0.9902 / 0.9894 | 2.36 (1.03 / 1.04) | 89.6 / 89.9 %, 70.2 %, 37.6 %, 55 | 1.34 / 1.60 | 8.98 |
| `dbts_b2` 10bit | 16 | 32 | 994.9 | 42.64 / 42.55 / 42.53 | 389 | 0.9599 / 0.9592 | 0.9849 / 0.9839 | 2.73 (1.04 / 1.06) | 90.9 / 91.0 %, 73.4 %, 43.2 %, 74 | 1.89 / 2.21 | 7.98 |
| `dbts_b2` 10bit | 16 | 40 | 2464.9 | 41.47 / 41.26 / 41.24 | 442 | 0.9539 / 0.9533 | 0.9790 / 0.9780 | 3.07 (1.08 / 1.11) | 91.8 / 91.9 %, 76.1 %, 48.1 %, 124 | 2.49 / 2.85 | 6.98 |
| `dbts_b2` 10bit | 16 | 56 | 13587.3 | 38.42 / 38.02 / 37.95 | 584 | 0.9325 / 0.9307 | 0.9588 / 0.9544 | 4.22 (1.13 / 1.18) | 93.7 / 94.0 %, 82.1 %, 59.9 %, 176 | 4.25 / 4.62 | 4.28 |
| `dbts_b2` 10bit | 8 | 1 | 3.9 | 65.67 / 65.60 / 65.59 | 22 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.19) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 3 | 0.06 / 0.07 | 10.0 |
| `dbts_b2` 10bit | 8 | 2 | 4.9 | 61.99 / 61.93 / 61.92 | 24 | 0.9994 / 0.9994 | 0.9999 / 0.9999 | 0.30 (0.30 / 0.30) | 36.1 / 36.2 %, 0.5 %, 0.0 %, 3 | 0.09 / 0.11 | 10.0 |
| `dbts_b2` 10bit | 8 | 4 | 7.7 | 56.13 / 56.07 / 56.05 | 44 | 0.9977 / 0.9977 | 0.9997 / 0.9997 | 0.58 (0.60 / 0.61) | 61.9 / 62.1 %, 13.7 %, 0.1 %, 13 | 0.18 / 0.21 | 9.99 |
| `dbts_b2` 10bit | 8 | 8 | 20.2 | 49.86 / 49.73 / 49.69 | 88 | 0.9905 / 0.9901 | 0.9986 / 0.9985 | 1.20 (0.95 / 0.96) | 80.4 / 80.8 %, 46.6 %, 9.1 %, 23 | 0.40 / 0.46 | 9.95 |
| `dbts_b2` 10bit | 8 | 12 | 46.8 | 47.02 / 46.95 / 46.92 | 125 | 0.9819 / 0.9813 | 0.9965 / 0.9964 | 1.66 (1.01 / 1.02) | 85.6 / 85.8 %, 59.2 %, 21.7 %, 30 | 0.65 / 0.77 | 9.82 |
| `dbts_b2` 10bit | 8 | 16 | 97.2 | 45.49 / 45.44 / 45.43 | 244 | 0.9748 / 0.9742 | 0.9944 / 0.9940 | 1.98 (1.03 / 1.03) | 87.8 / 87.9 %, 65.1 %, 29.4 %, 56 | 0.90 / 1.05 | 9.61 |
| `dbts_b2` 10bit | 8 | 24 | 292.6 | 43.92 / 43.86 / 43.83 | 307 | 0.9663 / 0.9652 | 0.9902 / 0.9894 | 2.36 (1.03 / 1.04) | 89.6 / 89.9 %, 70.2 %, 37.6 %, 70 | 1.34 / 1.60 | 8.97 |
| `dbts_b2` 10bit | 8 | 32 | 924.9 | 42.65 / 42.57 / 42.56 | 374 | 0.9601 / 0.9592 | 0.9851 / 0.9840 | 2.72 (1.04 / 1.05) | 90.8 / 91.0 %, 73.4 %, 43.1 %, 78 | 1.89 / 2.21 | 7.98 |
| `dbts_b2` 10bit | 8 | 40 | 2195.4 | 41.50 / 41.31 / 41.28 | 442 | 0.9540 / 0.9533 | 0.9794 / 0.9781 | 3.06 (1.08 / 1.11) | 91.7 / 91.9 %, 76.1 %, 48.1 %, 136 | 2.46 / 2.85 | 6.95 |
| `dbts_b2` 10bit | 8 | 56 | 11227.0 | 38.47 / 38.08 / 38.01 | 535 | 0.9342 / 0.9310 | 0.9594 / 0.9553 | 4.19 (1.13 / 1.18) | 93.6 / 93.9 %, 82.0 %, 59.7 %, 187 | 4.24 / 4.58 | 4.3 |
| `dbts_c4` 12bit | 1 | 1 | 5.4 | 73.36 / 73.27 / 73.25 | 21 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.08 (0.08 / 0.09) | 28.6 / 29.7 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.02 | 10.0 |
| `dbts_c4` 12bit | 1 | 2 | 6.9 | 67.46 / 67.36 / 67.35 | 26 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.16 (0.16 / 0.17) | 50.9 / 53.0 %, 8.7 %, 0.0 %, 6 | 0.04 / 0.05 | 10.0 |
| `dbts_c4` 12bit | 1 | 4 | 11.1 | 59.60 / 59.47 / 59.45 | 52 | 0.9990 / 0.9990 | 0.9999 / 0.9999 | 0.40 (0.41 / 0.43) | 75.5 / 77.5 %, 42.7 %, 9.2 %, 13 | 0.09 / 0.11 | 9.97 |
| `dbts_c4` 12bit | 1 | 8 | 28.4 | 51.37 / 51.29 / 51.24 | 267 | 0.9933 / 0.9930 | 0.9991 / 0.9990 | 1.03 (0.89 / 0.91) | 89.3 / 90.8 %, 74.4 %, 47.2 %, 36 | 0.24 / 0.30 | 9.7 |
| `dbts_c4` 12bit | 1 | 12 | 74.6 | 47.83 / 47.69 / 47.68 | 353 | 0.9847 / 0.9840 | 0.9975 / 0.9973 | 1.55 (1.04 / 1.06) | 92.4 / 93.6 %, 82.2 %, 62.0 %, 65 | 0.43 / 0.54 | 9.11 |
| `dbts_c4` 12bit | 1 | 16 | 159.7 | 46.30 / 46.24 / 46.21 | 493 | 0.9788 / 0.9777 | 0.9957 / 0.9953 | 1.83 (1.05 / 1.08) | 93.4 / 94.6 %, 84.6 %, 66.7 %, 74 | 0.60 / 0.76 | 8.35 |
| `dbts_c4` 12bit | 1 | 24 | 369.1 | 45.15 / 45.04 / 45.02 | 471 | 0.9734 / 0.9722 | 0.9932 / 0.9925 | 2.08 (1.06 / 1.08) | 94.2 / 95.2 %, 86.4 %, 70.0 %, 90 | 0.89 / 1.13 | 7.04 |
| `dbts_c4` 12bit | 1 | 32 | 712.0 | 44.15 / 43.99 / 43.96 | 857 | 0.9705 / 0.9685 | 0.9904 / 0.9895 | 2.31 (1.06 / 1.08) | 94.9 / 95.8 %, 87.9 %, 73.1 %, 109 | 1.20 / 1.48 | 5.68 |
| `dbts_c4` 12bit | 1 | 40 | 1192.8 | 42.93 / 42.54 / 42.48 | 1165 | 0.9653 / 0.9620 | 0.9868 / 0.9857 | 2.60 (1.06 / 1.08) | 95.6 / 96.3 %, 89.3 %, 75.8 %, 162 | 1.59 / 1.85 | 4.6 |
| `dbts_c4` 12bit | 1 | 56 | 2672.3 | 38.78 / 38.22 / 38.19 | 2380 | 0.9267 / 0.8807 | 0.9736 / 0.9688 | 3.69 (1.06 / 1.09) | 96.9 / 97.1 %, 91.7 %, 81.0 %, 232 | 2.91 / 3.44 | 2.39 |
| `dbts_c4` 12bit | 16 | 1 | 5.3 | 73.35 / 73.25 / 73.23 | 40 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.08 (0.08 / 0.09) | 28.5 / 29.7 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.02 | 10.0 |
| `dbts_c4` 12bit | 16 | 2 | 6.9 | 67.47 / 67.35 / 67.32 | 55 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.16 (0.16 / 0.17) | 50.8 / 52.9 %, 8.7 %, 0.0 %, 8 | 0.04 / 0.05 | 10.0 |
| `dbts_c4` 12bit | 16 | 4 | 11.1 | 59.63 / 59.51 / 59.48 | 142 | 0.9990 / 0.9990 | 0.9999 / 0.9999 | 0.40 (0.40 / 0.43) | 75.4 / 77.4 %, 42.6 %, 9.2 %, 13 | 0.09 / 0.11 | 9.97 |
| `dbts_c4` 12bit | 16 | 8 | 28.8 | 51.39 / 51.30 / 51.29 | 239 | 0.9934 / 0.9930 | 0.9991 / 0.9990 | 1.03 (0.89 / 0.91) | 89.2 / 90.8 %, 74.4 %, 47.1 %, 38 | 0.24 / 0.31 | 9.7 |
| `dbts_c4` 12bit | 16 | 12 | 81.5 | 47.90 / 47.79 / 47.74 | 333 | 0.9850 / 0.9843 | 0.9976 / 0.9973 | 1.54 (1.04 / 1.06) | 92.3 / 93.6 %, 82.2 %, 61.8 %, 66 | 0.41 / 0.54 | 9.13 |
| `dbts_c4` 12bit | 16 | 16 | 225.5 | 46.29 / 46.21 / 46.17 | 381 | 0.9789 / 0.9782 | 0.9957 / 0.9953 | 1.84 (1.05 / 1.08) | 93.4 / 94.6 %, 84.7 %, 66.9 %, 82 | 0.60 / 0.76 | 8.28 |
| `dbts_c4` 12bit | 16 | 24 | 835.2 | 44.90 / 44.74 / 44.72 | 459 | 0.9735 / 0.9724 | 0.9924 / 0.9915 | 2.14 (1.06 / 1.08) | 94.3 / 95.4 %, 86.7 %, 70.9 %, 95 | 0.99 / 1.28 | 6.71 |
| `dbts_c4` 12bit | 16 | 32 | 2089.0 | 43.94 / 43.68 / 43.64 | 708 | 0.9703 / 0.9691 | 0.9897 / 0.9885 | 2.37 (1.06 / 1.08) | 95.0 / 95.9 %, 88.2 %, 73.8 %, 116 | 1.32 / 1.60 | 5.55 |
| `dbts_c4` 12bit | 16 | 40 | 4355.0 | 42.49 / 41.97 / 41.88 | 1134 | 0.9648 / 0.9623 | 0.9858 / 0.9834 | 2.67 (1.06 / 1.08) | 95.8 / 96.5 %, 89.7 %, 76.9 %, 168 | 1.77 / 2.09 | 4.5 |
| `dbts_c4` 12bit | 16 | 56 | 13929.5 | 38.16 / 37.17 / 36.94 | 2055 | 0.9253 / 0.9138 | 0.9706 / 0.9611 | 4.14 (1.06 / 1.09) | 97.1 / 97.5 %, 92.6 %, 83.1 %, 227 | 3.28 / 4.19 | 2.2 |
| `dbts_c4` 12bit | 8 | 1 | 5.3 | 73.35 / 73.25 / 73.23 | 44 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.08 (0.08 / 0.09) | 28.6 / 29.7 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.02 | 10.0 |
| `dbts_c4` 12bit | 8 | 2 | 6.9 | 67.47 / 67.35 / 67.33 | 79 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.16 (0.16 / 0.17) | 50.8 / 52.9 %, 8.7 %, 0.0 %, 7 | 0.04 / 0.05 | 10.0 |
| `dbts_c4` 12bit | 8 | 4 | 11.1 | 59.62 / 59.51 / 59.47 | 161 | 0.9990 / 0.9990 | 0.9999 / 0.9999 | 0.40 (0.40 / 0.43) | 75.4 / 77.5 %, 42.6 %, 9.2 %, 17 | 0.09 / 0.11 | 9.97 |
| `dbts_c4` 12bit | 8 | 8 | 28.8 | 51.39 / 51.30 / 51.28 | 220 | 0.9934 / 0.9930 | 0.9991 / 0.9990 | 1.03 (0.89 / 0.91) | 89.2 / 90.8 %, 74.4 %, 47.1 %, 38 | 0.24 / 0.31 | 9.7 |
| `dbts_c4` 12bit | 8 | 12 | 80.9 | 47.90 / 47.78 / 47.74 | 333 | 0.9850 / 0.9843 | 0.9976 / 0.9973 | 1.54 (1.04 / 1.06) | 92.3 / 93.6 %, 82.2 %, 61.8 %, 66 | 0.42 / 0.54 | 9.13 |
| `dbts_c4` 12bit | 8 | 16 | 219.3 | 46.30 / 46.21 / 46.18 | 368 | 0.9789 / 0.9782 | 0.9957 / 0.9953 | 1.83 (1.05 / 1.08) | 93.4 / 94.6 %, 84.7 %, 66.9 %, 82 | 0.60 / 0.76 | 8.3 |
| `dbts_c4` 12bit | 8 | 24 | 788.7 | 44.92 / 44.75 / 44.68 | 478 | 0.9735 / 0.9718 | 0.9925 / 0.9915 | 2.13 (1.06 / 1.08) | 94.3 / 95.4 %, 86.7 %, 70.8 %, 95 | 0.99 / 1.28 | 6.69 |
| `dbts_c4` 12bit | 8 | 32 | 1901.4 | 44.00 / 43.73 / 43.65 | 708 | 0.9704 / 0.9691 | 0.9898 / 0.9886 | 2.35 (1.06 / 1.08) | 95.0 / 95.9 %, 88.2 %, 73.7 %, 131 | 1.29 / 1.60 | 5.59 |
| `dbts_c4` 12bit | 8 | 40 | 3795.9 | 42.56 / 42.03 / 41.92 | 1134 | 0.9646 / 0.9623 | 0.9859 / 0.9836 | 2.66 (1.06 / 1.08) | 95.8 / 96.5 %, 89.7 %, 76.8 %, 152 | 1.75 / 2.07 | 4.47 |
| `dbts_c4` 12bit | 8 | 56 | 11109.2 | 38.42 / 37.37 / 37.32 | 2267 | 0.9277 / 0.9138 | 0.9722 / 0.9638 | 3.91 (1.06 / 1.08) | 97.0 / 97.4 %, 92.4 %, 82.9 %, 229 | 3.06 / 4.04 | 2.4 |
| `dbts_c4` top10 | 1 | 1 | 6.4 | 66.62 / 66.53 / 66.52 | 36 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.17 / 0.19) | 50.1 / 51.8 %, 12.2 %, 0.1 %, 6 | 0.06 / 0.07 | — |
| `dbts_c4` top10 | 1 | 2 | 8.3 | 63.12 / 63.03 / 63.02 | 47 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.27 (0.27 / 0.28) | 64.6 / 66.7 %, 25.7 %, 1.8 %, 9 | 0.08 / 0.09 | — |
| `dbts_c4` top10 | 1 | 4 | 12.6 | 57.82 / 57.70 / 57.69 | 103 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.49 (0.49 / 0.52) | 79.4 / 81.2 %, 50.9 %, 15.5 %, 16 | 0.12 / 0.15 | — |
| `dbts_c4` top10 | 1 | 8 | 30.1 | 51.03 / 50.94 / 50.94 | 262 | 0.9928 / 0.9926 | 0.9990 / 0.9989 | 1.07 (0.91 / 0.93) | 89.7 / 91.2 %, 75.4 %, 48.8 %, 40 | 0.26 / 0.33 | — |
| `dbts_c4` top10 | 1 | 12 | 70.2 | 47.96 / 47.86 / 47.85 | 353 | 0.9855 / 0.9850 | 0.9976 / 0.9974 | 1.53 (1.04 / 1.06) | 92.3 / 93.6 %, 82.0 %, 61.5 %, 63 | 0.42 / 0.53 | — |
| `dbts_c4` top10 | 1 | 16 | 139.8 | 46.51 / 46.44 / 46.43 | 502 | 0.9800 / 0.9792 | 0.9961 / 0.9957 | 1.80 (1.05 / 1.08) | 93.2 / 94.5 %, 84.4 %, 66.1 %, 79 | 0.57 / 0.73 | — |
| `dbts_c4` top10 | 1 | 24 | 320.6 | 45.35 / 45.26 / 45.25 | 521 | 0.9752 / 0.9741 | 0.9938 / 0.9930 | 2.04 (1.06 / 1.08) | 94.0 / 95.1 %, 86.1 %, 69.5 %, 99 | 0.83 / 1.07 | — |
| `dbts_c4` top10 | 1 | 32 | 618.7 | 44.44 / 44.30 / 44.27 | 758 | 0.9723 / 0.9712 | 0.9912 / 0.9905 | 2.25 (1.06 / 1.09) | 94.7 / 95.7 %, 87.5 %, 72.3 %, 106 | 1.13 / 1.39 | — |
| `dbts_c4` top10 | 1 | 40 | 1016.6 | 43.43 / 43.12 / 43.11 | 1065 | 0.9673 / 0.9648 | 0.9881 / 0.9872 | 2.48 (1.06 / 1.09) | 95.3 / 96.2 %, 88.9 %, 75.0 %, 134 | 1.45 / 1.73 | — |
| `dbts_c4` top10 | 1 | 56 | 2276.3 | 40.09 / 39.49 / 39.42 | 2282 | 0.9400 / 0.9310 | 0.9776 / 0.9729 | 3.33 (1.06 / 1.09) | 96.6 / 97.0 %, 91.0 %, 79.4 %, 222 | 2.50 / 2.93 | — |
| `dbts_c4` top10 | 16 | 1 | 6.4 | 66.62 / 66.51 / 66.50 | 58 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.17 / 0.19) | 50.1 / 51.8 %, 12.2 %, 0.1 %, 7 | 0.06 / 0.07 | — |
| `dbts_c4` top10 | 16 | 2 | 8.3 | 63.17 / 63.05 / 63.05 | 100 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.26 (0.26 / 0.28) | 64.5 / 66.7 %, 25.6 %, 1.8 %, 10 | 0.07 / 0.09 | — |
| `dbts_c4` top10 | 16 | 4 | 12.6 | 57.81 / 57.60 / 57.44 | 160 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.49 / 0.52) | 79.4 / 81.1 %, 50.9 %, 15.8 %, 20 | 0.12 / 0.15 | — |
| `dbts_c4` top10 | 16 | 8 | 30.6 | 51.05 / 50.96 / 50.95 | 262 | 0.9929 / 0.9927 | 0.9990 / 0.9989 | 1.07 (0.90 / 0.93) | 89.6 / 91.2 %, 75.4 %, 48.8 %, 39 | 0.26 / 0.33 | — |
| `dbts_c4` top10 | 16 | 12 | 76.1 | 47.99 / 47.91 / 47.89 | 329 | 0.9856 / 0.9852 | 0.9976 / 0.9974 | 1.52 (1.04 / 1.06) | 92.3 / 93.6 %, 82.0 %, 61.5 %, 62 | 0.42 / 0.53 | — |
| `dbts_c4` top10 | 16 | 16 | 184.2 | 46.52 / 46.45 / 46.41 | 418 | 0.9802 / 0.9795 | 0.9960 / 0.9957 | 1.80 (1.06 / 1.08) | 93.3 / 94.5 %, 84.4 %, 66.1 %, 71 | 0.58 / 0.74 | — |
| `dbts_c4` top10 | 16 | 24 | 644.3 | 45.25 / 45.10 / 45.08 | 521 | 0.9752 / 0.9739 | 0.9934 / 0.9925 | 2.07 (1.06 / 1.08) | 94.1 / 95.2 %, 86.3 %, 70.0 %, 92 | 0.88 / 1.14 | — |
| `dbts_c4` top10 | 16 | 32 | 1659.0 | 44.33 / 44.16 / 44.10 | 633 | 0.9724 / 0.9718 | 0.9909 / 0.9899 | 2.27 (1.06 / 1.09) | 94.8 / 95.7 %, 87.7 %, 72.7 %, 107 | 1.17 / 1.45 | — |
| `dbts_c4` top10 | 16 | 40 | 3328.9 | 43.23 / 42.86 / 42.79 | 882 | 0.9680 / 0.9662 | 0.9876 / 0.9864 | 2.51 (1.06 / 1.09) | 95.4 / 96.2 %, 88.9 %, 75.2 %, 151 | 1.53 / 1.82 | — |
| `dbts_c4` top10 | 16 | 56 | 10834.6 | 39.63 / 38.94 / 38.77 | 1892 | 0.9421 / 0.9379 | 0.9761 / 0.9709 | 3.50 (1.06 / 1.09) | 96.7 / 97.0 %, 91.3 %, 80.1 %, 208 | 2.66 / 3.22 | — |
| `dbts_c4` top10 | 8 | 1 | 6.4 | 66.62 / 66.51 / 66.50 | 61 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.17 / 0.19) | 50.1 / 51.8 %, 12.2 %, 0.1 %, 8 | 0.06 / 0.07 | — |
| `dbts_c4` top10 | 8 | 2 | 8.3 | 63.17 / 63.05 / 63.04 | 78 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.26 (0.26 / 0.28) | 64.6 / 66.7 %, 25.6 %, 1.8 %, 10 | 0.08 / 0.09 | — |
| `dbts_c4` top10 | 8 | 4 | 12.6 | 57.82 / 57.55 / 57.46 | 120 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.49 / 0.52) | 79.5 / 81.2 %, 50.8 %, 16.0 %, 16 | 0.12 / 0.15 | — |
| `dbts_c4` top10 | 8 | 8 | 30.5 | 51.05 / 50.96 / 50.95 | 262 | 0.9929 / 0.9927 | 0.9990 / 0.9989 | 1.07 (0.90 / 0.93) | 89.6 / 91.2 %, 75.4 %, 48.8 %, 37 | 0.26 / 0.33 | — |
| `dbts_c4` top10 | 8 | 12 | 75.6 | 47.99 / 47.90 / 47.88 | 329 | 0.9856 / 0.9852 | 0.9976 / 0.9974 | 1.52 (1.04 / 1.06) | 92.3 / 93.6 %, 82.0 %, 61.5 %, 62 | 0.42 / 0.53 | — |
| `dbts_c4` top10 | 8 | 16 | 180.8 | 46.52 / 46.45 / 46.44 | 349 | 0.9802 / 0.9795 | 0.9960 / 0.9957 | 1.79 (1.06 / 1.08) | 93.3 / 94.5 %, 84.4 %, 66.1 %, 72 | 0.58 / 0.74 | — |
| `dbts_c4` top10 | 8 | 24 | 616.4 | 45.25 / 45.10 / 45.09 | 521 | 0.9752 / 0.9739 | 0.9934 / 0.9925 | 2.06 (1.06 / 1.08) | 94.1 / 95.2 %, 86.3 %, 70.0 %, 92 | 0.88 / 1.14 | — |
| `dbts_c4` top10 | 8 | 32 | 1516.7 | 44.34 / 44.16 / 44.11 | 597 | 0.9724 / 0.9718 | 0.9909 / 0.9900 | 2.27 (1.06 / 1.09) | 94.8 / 95.7 %, 87.7 %, 72.6 %, 109 | 1.17 / 1.45 | — |
| `dbts_c4` top10 | 8 | 40 | 2944.6 | 43.24 / 42.90 / 42.87 | 882 | 0.9677 / 0.9659 | 0.9877 / 0.9864 | 2.51 (1.06 / 1.09) | 95.4 / 96.2 %, 88.9 %, 75.2 %, 151 | 1.51 / 1.83 | — |
| `dbts_c4` top10 | 8 | 56 | 8728.2 | 39.86 / 39.05 / 38.96 | 2282 | 0.9438 / 0.9379 | 0.9763 / 0.9711 | 3.47 (1.06 / 1.09) | 96.7 / 97.0 %, 91.2 %, 79.8 %, 209 | 2.62 / 3.17 | — |
| `dbts_c4` window | 1 | 1 | 3.9 | 6.80 / 6.29 / 6.22 | 2534 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 20.2 / 22.9 %, 15.3 %, 13.2 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 1 | 2 | 4.7 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 25.5 / 28.0 %, 15.5 %, 13.3 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 1 | 4 | 5.9 | 6.80 / 6.29 / 6.22 | 2537 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.40) | 37.2 / 39.2 %, 15.8 %, 13.4 %, 30 | 2.54 / 3.78 | — |
| `dbts_c4` window | 1 | 8 | 8.0 | 6.80 / 6.29 / 6.22 | 2541 | 0.4432 / 0.3679 | 0.8571 / 0.8293 | 3.52 (0.39 / 0.42) | 60.7 / 62.1 %, 23.7 %, 13.7 %, 31 | 2.54 / 3.79 | — |
| `dbts_c4` window | 1 | 12 | 9.9 | 6.80 / 6.29 / 6.22 | 2544 | 0.4429 / 0.3677 | 0.8571 / 0.8293 | 3.53 (0.44 / 0.47) | 73.4 / 74.5 %, 37.9 %, 15.3 %, 32 | 2.54 / 3.79 | — |
| `dbts_c4` window | 1 | 16 | 11.8 | 6.80 / 6.29 / 6.22 | 2549 | 0.4426 / 0.3674 | 0.8570 / 0.8293 | 3.54 (0.50 / 0.53) | 80.2 / 80.8 %, 49.5 %, 19.6 %, 34 | 2.55 / 3.79 | — |
| `dbts_c4` window | 1 | 24 | 16.0 | 6.80 / 6.29 / 6.22 | 2556 | 0.4416 / 0.3665 | 0.8569 / 0.8291 | 3.57 (0.62 / 0.65) | 86.8 / 87.3 %, 64.2 %, 32.0 %, 53 | 2.55 / 3.80 | — |
| `dbts_c4` window | 1 | 32 | 28.0 | 6.80 / 6.29 / 6.22 | 2561 | 0.4384 / 0.3634 | 0.8564 / 0.8288 | 3.64 (0.85 / 0.88) | 92.0 / 92.2 %, 77.4 %, 51.5 %, 94 | 2.56 / 3.80 | — |
| `dbts_c4` window | 1 | 40 | 69.9 | 6.80 / 6.29 / 6.21 | 2572 | 0.4317 / 0.3566 | 0.8553 / 0.8277 | 3.80 (1.03 / 1.05) | 94.6 / 94.7 %, 84.5 %, 65.2 %, 102 | 2.59 / 3.82 | — |
| `dbts_c4` window | 1 | 56 | 737.9 | 6.80 / 6.28 / 6.21 | 2619 | 0.4203 / 0.3463 | 0.8504 / 0.8233 | 4.14 (1.06 / 1.08) | 96.3 / 96.4 %, 89.3 %, 75.3 %, 140 | 2.80 / 3.96 | — |
| `dbts_c4` window | 16 | 1 | 3.9 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 20.2 / 22.9 %, 15.3 %, 13.2 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 16 | 2 | 4.7 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 25.5 / 28.0 %, 15.5 %, 13.3 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 16 | 4 | 5.9 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.40) | 37.2 / 39.3 %, 15.8 %, 13.4 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 16 | 8 | 7.9 | 6.80 / 6.29 / 6.22 | 2539 | 0.4432 / 0.3679 | 0.8571 / 0.8293 | 3.52 (0.39 / 0.42) | 60.0 / 62.1 %, 23.6 %, 13.7 %, 31 | 2.54 / 3.79 | — |
| `dbts_c4` window | 16 | 12 | 9.7 | 6.80 / 6.29 / 6.22 | 2541 | 0.4430 / 0.3677 | 0.8571 / 0.8293 | 3.53 (0.43 / 0.46) | 73.0 / 74.3 %, 37.9 %, 15.3 %, 32 | 2.54 / 3.79 | — |
| `dbts_c4` window | 16 | 16 | 11.6 | 6.80 / 6.29 / 6.22 | 2543 | 0.4426 / 0.3674 | 0.8570 / 0.8293 | 3.54 (0.49 / 0.52) | 79.8 / 80.7 %, 49.2 %, 19.5 %, 33 | 2.54 / 3.79 | — |
| `dbts_c4` window | 16 | 24 | 15.8 | 6.80 / 6.29 / 6.22 | 2550 | 0.4415 / 0.3665 | 0.8569 / 0.8291 | 3.57 (0.62 / 0.65) | 86.7 / 87.2 %, 64.1 %, 31.9 %, 35 | 2.55 / 3.79 | — |
| `dbts_c4` window | 16 | 32 | 27.9 | 6.80 / 6.29 / 6.22 | 2558 | 0.4384 / 0.3635 | 0.8565 / 0.8288 | 3.64 (0.84 / 0.88) | 92.0 / 92.2 %, 77.3 %, 51.4 %, 83 | 2.56 / 3.81 | — |
| `dbts_c4` window | 16 | 40 | 72.6 | 6.80 / 6.29 / 6.21 | 2561 | 0.4318 / 0.3569 | 0.8553 / 0.8278 | 3.79 (1.03 / 1.05) | 94.6 / 94.7 %, 84.4 %, 65.0 %, 83 | 2.59 / 3.83 | — |
| `dbts_c4` window | 16 | 56 | 1687.0 | 6.80 / 6.28 / 6.21 | 2594 | 0.4203 / 0.3463 | 0.8504 / 0.8232 | 4.15 (1.06 / 1.08) | 96.3 / 96.4 %, 89.4 %, 75.6 %, 116 | 2.81 / 3.96 | — |
| `dbts_c4` window | 8 | 1 | 3.9 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 20.2 / 22.9 %, 15.3 %, 13.2 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 8 | 2 | 4.7 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 25.5 / 28.0 %, 15.5 %, 13.3 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 8 | 4 | 5.9 | 6.80 / 6.29 / 6.22 | 2536 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.40) | 37.1 / 39.3 %, 15.8 %, 13.4 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 8 | 8 | 7.9 | 6.80 / 6.29 / 6.22 | 2539 | 0.4432 / 0.3679 | 0.8571 / 0.8293 | 3.52 (0.39 / 0.42) | 60.1 / 62.1 %, 23.6 %, 13.7 %, 31 | 2.54 / 3.79 | — |
| `dbts_c4` window | 8 | 12 | 9.7 | 6.80 / 6.29 / 6.22 | 2544 | 0.4430 / 0.3677 | 0.8571 / 0.8293 | 3.53 (0.43 / 0.46) | 72.9 / 74.3 %, 37.9 %, 15.3 %, 32 | 2.54 / 3.79 | — |
| `dbts_c4` window | 8 | 16 | 11.6 | 6.80 / 6.29 / 6.22 | 2543 | 0.4426 / 0.3674 | 0.8570 / 0.8293 | 3.54 (0.49 / 0.52) | 79.8 / 80.7 %, 49.2 %, 19.5 %, 34 | 2.54 / 3.79 | — |
| `dbts_c4` window | 8 | 24 | 15.8 | 6.80 / 6.29 / 6.22 | 2550 | 0.4415 / 0.3665 | 0.8569 / 0.8291 | 3.57 (0.62 / 0.65) | 86.8 / 87.2 %, 64.3 %, 32.1 %, 34 | 2.55 / 3.80 | — |
| `dbts_c4` window | 8 | 32 | 27.9 | 6.80 / 6.29 / 6.22 | 2554 | 0.4384 / 0.3635 | 0.8565 / 0.8288 | 3.64 (0.85 / 0.88) | 91.9 / 92.2 %, 77.3 %, 51.4 %, 83 | 2.56 / 3.81 | — |
| `dbts_c4` window | 8 | 40 | 72.5 | 6.80 / 6.29 / 6.21 | 2561 | 0.4318 / 0.3569 | 0.8553 / 0.8278 | 3.79 (1.03 / 1.05) | 94.6 / 94.7 %, 84.4 %, 65.0 %, 83 | 2.59 / 3.83 | — |
| `dbts_c4` window | 8 | 56 | 1586.5 | 6.80 / 6.28 / 6.21 | 2585 | 0.4203 / 0.3463 | 0.8504 / 0.8232 | 4.15 (1.06 / 1.08) | 96.3 / 96.4 %, 89.4 %, 75.6 %, 118 | 2.82 / 3.96 | — |
| `dbts_c5` 12bit | 1 | 1 | 4.2 | 71.98 / 71.84 / 71.83 | 30 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 21.3 / 22.1 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c5` 12bit | 1 | 2 | 5.4 | 66.05 / 65.90 / 65.90 | 35 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.19 (0.20 / 0.21) | 40.8 / 42.4 %, 3.6 %, 0.0 %, 6 | 0.05 / 0.06 | 10.0 |
| `dbts_c5` 12bit | 1 | 4 | 9.3 | 57.97 / 57.87 / 57.86 | 79 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.50 / 0.53) | 69.0 / 70.6 %, 29.5 %, 3.9 %, 12 | 0.13 / 0.14 | 9.97 |
| `dbts_c5` 12bit | 1 | 8 | 27.7 | 50.14 / 50.07 / 50.07 | 299 | 0.9905 / 0.9903 | 0.9986 / 0.9986 | 1.21 (0.97 / 0.99) | 85.7 / 87.3 %, 64.8 %, 32.9 %, 32 | 0.33 / 0.37 | 9.75 |
| `dbts_c5` 12bit | 1 | 12 | 85.3 | 47.05 / 46.99 / 46.97 | 397 | 0.9811 / 0.9805 | 0.9964 / 0.9962 | 1.73 (1.05 / 1.07) | 89.3 / 90.6 %, 73.5 %, 46.8 %, 53 | 0.59 / 0.66 | 9.23 |
| `dbts_c5` 12bit | 1 | 16 | 192.6 | 45.92 / 45.78 / 45.76 | 380 | 0.9762 / 0.9748 | 0.9945 / 0.9940 | 1.96 (1.06 / 1.08) | 90.5 / 91.6 %, 76.1 %, 51.1 %, 65 | 0.81 / 0.91 | 8.53 |
| `dbts_c5` 12bit | 1 | 24 | 428.9 | 45.02 / 44.88 / 44.87 | 572 | 0.9718 / 0.9703 | 0.9920 / 0.9913 | 2.16 (1.06 / 1.08) | 91.3 / 92.3 %, 77.9 %, 54.1 %, 109 | 1.11 / 1.26 | 7.46 |
| `dbts_c5` 12bit | 1 | 32 | 861.8 | 44.13 / 44.00 / 43.97 | 771 | 0.9708 / 0.9692 | 0.9892 / 0.9879 | 2.36 (1.06 / 1.08) | 92.3 / 93.0 %, 79.9 %, 57.2 %, 115 | 1.46 / 1.68 | 6.25 |
| `dbts_c5` 12bit | 1 | 40 | 1584.2 | 42.94 / 42.70 / 42.62 | 1328 | 0.9676 / 0.9646 | 0.9855 / 0.9834 | 2.65 (1.06 / 1.08) | 93.1 / 93.8 %, 81.7 %, 60.5 %, 154 | 1.90 / 2.18 | 5.02 |
| `dbts_c5` 12bit | 1 | 56 | 4222.4 | 39.42 / 38.96 / 38.87 | 2186 | 0.9523 / 0.9324 | 0.9748 / 0.9709 | 3.81 (1.06 / 1.09) | 94.7 / 95.0 %, 85.0 %, 66.5 %, 215 | 3.22 / 3.55 | 3.08 |
| `dbts_c5` 12bit | 16 | 1 | 4.1 | 72.01 / 71.86 / 71.84 | 44 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 21.3 / 22.1 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c5` 12bit | 16 | 2 | 5.6 | 65.59 / 65.38 / 65.38 | 80 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.21 / 0.23) | 42.3 / 43.9 %, 4.4 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_c5` 12bit | 16 | 4 | 9.2 | 57.94 / 57.83 / 57.82 | 113 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.50 / 0.53) | 69.1 / 70.8 %, 30.0 %, 4.0 %, 12 | 0.13 / 0.15 | 9.97 |
| `dbts_c5` 12bit | 16 | 8 | 27.7 | 50.29 / 50.20 / 50.08 | 292 | 0.9910 / 0.9903 | 0.9987 / 0.9986 | 1.19 (0.96 / 0.99) | 85.6 / 87.1 %, 64.4 %, 32.4 %, 33 | 0.34 / 0.38 | 9.75 |
| `dbts_c5` 12bit | 16 | 12 | 97.4 | 47.18 / 47.08 / 47.00 | 286 | 0.9818 / 0.9806 | 0.9965 / 0.9963 | 1.70 (1.05 / 1.07) | 89.3 / 90.6 %, 73.6 %, 46.6 %, 50 | 0.58 / 0.67 | 9.23 |
| `dbts_c5` 12bit | 16 | 16 | 305.2 | 45.94 / 45.79 / 45.77 | 356 | 0.9766 / 0.9749 | 0.9945 / 0.9940 | 1.96 (1.06 / 1.08) | 90.5 / 91.5 %, 76.1 %, 51.0 %, 76 | 0.81 / 0.93 | 8.49 |
| `dbts_c5` 12bit | 16 | 24 | 1101.8 | 44.87 / 44.66 / 44.61 | 503 | 0.9730 / 0.9703 | 0.9914 / 0.9902 | 2.20 (1.06 / 1.08) | 91.5 / 92.5 %, 78.3 %, 54.7 %, 135 | 1.18 / 1.43 | 7.26 |
| `dbts_c5` 12bit | 16 | 32 | 2956.7 | 43.89 / 43.73 / 43.59 | 803 | 0.9708 / 0.9694 | 0.9883 / 0.9866 | 2.43 (1.06 / 1.08) | 92.5 / 93.3 %, 80.6 %, 58.4 %, 159 | 1.55 / 1.85 | 6.09 |
| `dbts_c5` 12bit | 16 | 40 | 6680.3 | 42.57 / 42.20 / 42.09 | 1174 | 0.9679 / 0.9661 | 0.9840 / 0.9818 | 2.81 (1.06 / 1.08) | 93.3 / 93.9 %, 82.3 %, 61.5 %, 160 | 2.05 / 2.34 | 4.89 |
| `dbts_c5` 12bit | 16 | 56 | 21536.0 | 39.15 / 37.81 / 37.75 | 2085 | 0.9529 / 0.9495 | 0.9725 / 0.9669 | 4.03 (1.06 / 1.08) | 95.0 / 95.3 %, 86.2 %, 69.4 %, 221 | 3.49 / 4.26 | 3.0 |
| `dbts_c5` 12bit | 8 | 1 | 4.1 | 72.01 / 71.86 / 71.84 | 68 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 21.2 / 22.0 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c5` 12bit | 8 | 2 | 5.6 | 65.67 / 65.39 / 65.38 | 97 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.21 / 0.23) | 42.3 / 43.8 %, 4.4 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_c5` 12bit | 8 | 4 | 9.2 | 57.94 / 57.83 / 57.82 | 166 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.50 / 0.53) | 69.1 / 70.6 %, 29.7 %, 4.0 %, 12 | 0.13 / 0.15 | 9.97 |
| `dbts_c5` 12bit | 8 | 8 | 27.7 | 50.28 / 50.12 / 50.08 | 292 | 0.9909 / 0.9903 | 0.9987 / 0.9986 | 1.20 (0.97 / 0.99) | 85.6 / 87.3 %, 64.8 %, 32.9 %, 35 | 0.34 / 0.38 | 9.75 |
| `dbts_c5` 12bit | 8 | 12 | 96.7 | 47.17 / 47.04 / 47.00 | 303 | 0.9817 / 0.9806 | 0.9965 / 0.9963 | 1.71 (1.05 / 1.07) | 89.3 / 90.6 %, 73.5 %, 46.8 %, 53 | 0.59 / 0.67 | 9.22 |
| `dbts_c5` 12bit | 8 | 16 | 295.7 | 45.92 / 45.78 / 45.76 | 351 | 0.9765 / 0.9749 | 0.9945 / 0.9940 | 1.96 (1.06 / 1.08) | 90.5 / 91.6 %, 76.1 %, 51.1 %, 78 | 0.81 / 0.93 | 8.49 |
| `dbts_c5` 12bit | 8 | 24 | 1025.0 | 44.89 / 44.64 / 44.61 | 524 | 0.9727 / 0.9701 | 0.9915 / 0.9902 | 2.20 (1.06 / 1.08) | 91.5 / 92.4 %, 78.3 %, 54.7 %, 114 | 1.18 / 1.43 | 7.26 |
| `dbts_c5` 12bit | 8 | 32 | 2635.9 | 44.02 / 43.71 / 43.66 | 803 | 0.9709 / 0.9694 | 0.9885 / 0.9866 | 2.43 (1.06 / 1.08) | 92.4 / 93.3 %, 80.5 %, 58.4 %, 150 | 1.55 / 1.85 | 6.09 |
| `dbts_c5` 12bit | 8 | 40 | 5720.9 | 42.76 / 42.28 / 42.15 | 1174 | 0.9679 / 0.9661 | 0.9847 / 0.9823 | 2.75 (1.06 / 1.08) | 93.2 / 93.9 %, 82.3 %, 61.4 %, 160 | 1.99 / 2.33 | 4.88 |
| `dbts_c5` 12bit | 8 | 56 | 16781.5 | 39.28 / 38.26 / 37.85 | 2092 | 0.9539 / 0.9448 | 0.9743 / 0.9688 | 3.90 (1.06 / 1.08) | 94.8 / 95.3 %, 86.1 %, 68.8 %, 221 | 3.26 / 4.09 | 3.0 |
| `dbts_c5` top10 | 1 | 1 | 5.0 | 65.18 / 65.05 / 65.05 | 33 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.21 (0.21 / 0.23) | 42.3 / 43.8 %, 5.8 %, 0.0 %, 5 | 0.08 / 0.09 | — |
| `dbts_c5` top10 | 1 | 2 | 6.6 | 61.71 / 61.57 / 61.56 | 59 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.32 (0.32 / 0.35) | 56.4 / 58.1 %, 14.4 %, 0.5 %, 8 | 0.10 / 0.12 | — |
| `dbts_c5` top10 | 1 | 4 | 10.6 | 56.22 / 56.10 / 56.10 | 158 | 0.9977 / 0.9976 | 0.9997 / 0.9997 | 0.60 (0.59 / 0.63) | 73.9 / 75.2 %, 38.0 %, 7.6 %, 15 | 0.17 / 0.19 | — |
| `dbts_c5` top10 | 1 | 8 | 29.6 | 49.84 / 49.77 / 49.76 | 311 | 0.9900 / 0.9898 | 0.9985 / 0.9984 | 1.26 (0.98 / 1.00) | 86.2 / 87.6 %, 66.0 %, 34.5 %, 33 | 0.36 / 0.40 | — |
| `dbts_c5` top10 | 1 | 12 | 79.3 | 47.19 / 47.14 / 47.10 | 411 | 0.9819 / 0.9813 | 0.9966 / 0.9964 | 1.70 (1.05 / 1.07) | 89.2 / 90.5 %, 73.3 %, 46.3 %, 49 | 0.57 / 0.64 | — |
| `dbts_c5` top10 | 1 | 16 | 166.6 | 46.08 / 45.95 / 45.94 | 355 | 0.9771 / 0.9760 | 0.9948 / 0.9944 | 1.93 (1.06 / 1.08) | 90.3 / 91.5 %, 75.9 %, 50.7 %, 67 | 0.78 / 0.88 | — |
| `dbts_c5` top10 | 1 | 24 | 376.0 | 45.20 / 45.05 / 45.03 | 453 | 0.9739 / 0.9724 | 0.9925 / 0.9918 | 2.12 (1.06 / 1.08) | 91.2 / 92.1 %, 77.7 %, 53.8 %, 102 | 1.05 / 1.21 | — |
| `dbts_c5` top10 | 1 | 32 | 739.1 | 44.38 / 44.26 / 44.23 | 724 | 0.9717 / 0.9700 | 0.9899 / 0.9889 | 2.31 (1.06 / 1.09) | 92.0 / 92.8 %, 79.4 %, 56.4 %, 118 | 1.38 / 1.58 | — |
| `dbts_c5` top10 | 1 | 40 | 1308.5 | 43.41 / 43.24 / 43.19 | 1325 | 0.9674 / 0.9655 | 0.9867 / 0.9850 | 2.54 (1.06 / 1.08) | 92.8 / 93.5 %, 81.2 %, 59.5 %, 126 | 1.74 / 1.98 | — |
| `dbts_c5` top10 | 1 | 56 | 3443.6 | 40.64 / 40.18 / 40.11 | 2113 | 0.9518 / 0.9458 | 0.9773 / 0.9751 | 3.38 (1.07 / 1.09) | 94.2 / 94.5 %, 83.8 %, 64.0 %, 199 | 2.78 / 3.03 | — |
| `dbts_c5` top10 | 16 | 1 | 5.1 | 64.85 / 64.65 / 64.65 | 82 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.22 / 0.23) | 43.6 / 45.1 %, 6.4 %, 0.0 %, 5 | 0.08 / 0.10 | — |
| `dbts_c5` top10 | 16 | 2 | 6.6 | 61.65 / 61.50 / 61.49 | 110 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.32 (0.32 / 0.35) | 56.6 / 58.3 %, 14.7 %, 0.5 %, 8 | 0.11 / 0.12 | — |
| `dbts_c5` top10 | 16 | 4 | 10.6 | 56.17 / 56.05 / 56.04 | 170 | 0.9977 / 0.9976 | 0.9997 / 0.9997 | 0.61 (0.59 / 0.63) | 74.0 / 75.6 %, 38.7 %, 7.8 %, 15 | 0.17 / 0.19 | — |
| `dbts_c5` top10 | 16 | 8 | 29.8 | 49.95 / 49.88 / 49.77 | 311 | 0.9903 / 0.9898 | 0.9985 / 0.9984 | 1.24 (0.98 / 1.00) | 86.0 / 87.5 %, 65.6 %, 34.0 %, 36 | 0.36 / 0.41 | — |
| `dbts_c5` top10 | 16 | 12 | 90.0 | 47.24 / 47.15 / 47.14 | 299 | 0.9822 / 0.9815 | 0.9966 / 0.9963 | 1.69 (1.06 / 1.08) | 89.3 / 90.5 %, 73.4 %, 46.4 %, 48 | 0.58 / 0.67 | — |
| `dbts_c5` top10 | 16 | 16 | 251.2 | 46.08 / 45.95 / 45.93 | 390 | 0.9773 / 0.9761 | 0.9948 / 0.9943 | 1.93 (1.06 / 1.08) | 90.3 / 91.4 %, 75.9 %, 50.7 %, 67 | 0.79 / 0.90 | — |
| `dbts_c5` top10 | 16 | 24 | 847.3 | 45.12 / 44.92 / 44.86 | 474 | 0.9738 / 0.9722 | 0.9923 / 0.9911 | 2.14 (1.06 / 1.08) | 91.3 / 92.3 %, 77.9 %, 54.0 %, 115 | 1.09 / 1.31 | — |
| `dbts_c5` top10 | 16 | 32 | 2239.7 | 44.28 / 44.10 / 44.07 | 531 | 0.9718 / 0.9704 | 0.9895 / 0.9883 | 2.35 (1.07 / 1.09) | 92.1 / 92.9 %, 79.7 %, 57.0 %, 117 | 1.43 / 1.66 | — |
| `dbts_c5` top10 | 16 | 40 | 4866.0 | 43.23 / 43.01 / 42.95 | 795 | 0.9675 / 0.9663 | 0.9859 / 0.9841 | 2.61 (1.07 / 1.09) | 92.9 / 93.6 %, 81.4 %, 59.9 %, 139 | 1.81 / 2.10 | — |
| `dbts_c5` top10 | 16 | 56 | 16373.6 | 40.42 / 39.48 / 39.33 | 2078 | 0.9512 / 0.9480 | 0.9761 / 0.9719 | 3.54 (1.06 / 1.08) | 94.4 / 94.7 %, 84.3 %, 65.3 %, 201 | 2.93 / 3.39 | — |
| `dbts_c5` top10 | 8 | 1 | 5.1 | 64.92 / 64.66 / 64.65 | 82 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.22 / 0.23) | 43.6 / 45.0 %, 6.4 %, 0.0 %, 5 | 0.08 / 0.10 | — |
| `dbts_c5` top10 | 8 | 2 | 6.6 | 61.65 / 61.50 / 61.50 | 123 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.32 (0.32 / 0.35) | 56.6 / 58.2 %, 14.6 %, 0.5 %, 9 | 0.11 / 0.12 | — |
| `dbts_c5` top10 | 8 | 4 | 10.6 | 56.17 / 56.05 / 56.04 | 170 | 0.9977 / 0.9976 | 0.9997 / 0.9997 | 0.61 (0.59 / 0.63) | 74.0 / 75.4 %, 38.5 %, 7.7 %, 15 | 0.17 / 0.19 | — |
| `dbts_c5` top10 | 8 | 8 | 29.7 | 49.95 / 49.81 / 49.77 | 311 | 0.9903 / 0.9898 | 0.9985 / 0.9984 | 1.24 (0.98 / 1.00) | 86.1 / 87.6 %, 66.0 %, 34.5 %, 35 | 0.36 / 0.41 | — |
| `dbts_c5` top10 | 8 | 12 | 89.4 | 47.24 / 47.14 / 47.14 | 312 | 0.9821 / 0.9813 | 0.9966 / 0.9963 | 1.69 (1.06 / 1.08) | 89.2 / 90.5 %, 73.3 %, 46.3 %, 48 | 0.58 / 0.67 | — |
| `dbts_c5` top10 | 8 | 16 | 244.5 | 46.07 / 45.95 / 45.92 | 390 | 0.9773 / 0.9761 | 0.9948 / 0.9943 | 1.93 (1.06 / 1.08) | 90.4 / 91.5 %, 75.9 %, 50.7 %, 67 | 0.79 / 0.90 | — |
| `dbts_c5` top10 | 8 | 24 | 797.5 | 45.13 / 44.90 / 44.85 | 474 | 0.9738 / 0.9722 | 0.9923 / 0.9911 | 2.14 (1.06 / 1.08) | 91.3 / 92.2 %, 77.8 %, 53.8 %, 97 | 1.09 / 1.31 | — |
| `dbts_c5` top10 | 8 | 32 | 2016.8 | 44.30 / 44.12 / 44.04 | 531 | 0.9718 / 0.9700 | 0.9896 / 0.9881 | 2.34 (1.07 / 1.09) | 92.1 / 92.9 %, 79.7 %, 56.9 %, 118 | 1.42 / 1.66 | — |
| `dbts_c5` top10 | 8 | 40 | 4241.4 | 43.32 / 43.02 / 42.96 | 955 | 0.9675 / 0.9665 | 0.9863 / 0.9840 | 2.59 (1.07 / 1.09) | 92.9 / 93.6 %, 81.4 %, 60.0 %, 148 | 1.80 / 2.10 | — |
| `dbts_c5` top10 | 8 | 56 | 13374.1 | 40.57 / 39.60 / 39.51 | 2078 | 0.9508 / 0.9479 | 0.9766 / 0.9733 | 3.46 (1.06 / 1.08) | 94.3 / 94.6 %, 84.3 %, 65.3 %, 228 | 2.86 / 3.37 | — |
| `dbts_c5` window | 1 | 1 | 3.4 | 9.26 / 8.06 / 7.93 | 2333 | 0.6263 / 0.4987 | 0.8986 / 0.8690 | 4.03 (0.44 / 0.48) | 29.5 / 30.9 %, 22.3 %, 16.3 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 1 | 2 | 4.1 | 9.26 / 8.06 / 7.93 | 2333 | 0.6262 / 0.4987 | 0.8986 / 0.8690 | 4.04 (0.44 / 0.48) | 34.2 / 35.5 %, 22.5 %, 16.4 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 1 | 4 | 5.2 | 9.26 / 8.06 / 7.93 | 2334 | 0.6262 / 0.4987 | 0.8986 / 0.8689 | 4.04 (0.45 / 0.49) | 44.0 / 45.2 %, 23.1 %, 16.9 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 1 | 8 | 7.3 | 9.26 / 8.06 / 7.93 | 2338 | 0.6259 / 0.4984 | 0.8985 / 0.8689 | 4.05 (0.48 / 0.52) | 63.0 / 64.0 %, 29.1 %, 17.6 %, 31 | 3.10 / 3.72 | — |
| `dbts_c5` window | 1 | 12 | 9.4 | 9.26 / 8.06 / 7.93 | 2339 | 0.6253 / 0.4980 | 0.8984 / 0.8688 | 4.06 (0.55 / 0.58) | 74.6 / 75.3 %, 40.6 %, 19.0 %, 31 | 3.10 / 3.72 | — |
| `dbts_c5` window | 1 | 16 | 11.7 | 9.26 / 8.06 / 7.93 | 2341 | 0.6247 / 0.4974 | 0.8983 / 0.8688 | 4.07 (0.62 / 0.66) | 80.8 / 81.2 %, 50.7 %, 22.2 %, 33 | 3.10 / 3.72 | — |
| `dbts_c5` window | 1 | 24 | 17.3 | 9.26 / 8.06 / 7.93 | 2345 | 0.6228 / 0.4957 | 0.8980 / 0.8685 | 4.12 (0.77 / 0.81) | 87.0 / 87.2 %, 63.9 %, 32.0 %, 38 | 3.11 / 3.72 | — |
| `dbts_c5` window | 1 | 32 | 37.3 | 9.26 / 8.06 / 7.93 | 2356 | 0.6177 / 0.4908 | 0.8971 / 0.8678 | 4.22 (0.99 / 1.01) | 91.5 / 91.5 %, 75.2 %, 47.5 %, 52 | 3.13 / 3.74 | — |
| `dbts_c5` window | 1 | 40 | 120.9 | 9.26 / 8.06 / 7.93 | 2362 | 0.6100 / 0.4832 | 0.8951 / 0.8661 | 4.38 (1.06 / 1.08) | 93.5 / 93.6 %, 80.9 %, 57.7 %, 56 | 3.18 / 3.78 | — |
| `dbts_c5` window | 1 | 56 | 1162.1 | 9.25 / 8.05 / 7.93 | 2384 | 0.6032 / 0.4776 | 0.8894 / 0.8618 | 4.63 (1.06 / 1.08) | 94.8 / 94.9 %, 84.6 %, 65.1 %, 146 | 3.42 / 4.04 | — |
| `dbts_c5` window | 16 | 1 | 3.4 | 9.26 / 8.06 / 7.93 | 2334 | 0.6263 / 0.4987 | 0.8986 / 0.8690 | 4.03 (0.44 / 0.48) | 30.0 / 31.4 %, 22.3 %, 16.3 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 2 | 4.1 | 9.26 / 8.06 / 7.93 | 2333 | 0.6262 / 0.4987 | 0.8986 / 0.8690 | 4.04 (0.44 / 0.48) | 34.4 / 35.8 %, 22.5 %, 16.5 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 4 | 5.2 | 9.26 / 8.06 / 7.93 | 2333 | 0.6262 / 0.4987 | 0.8986 / 0.8689 | 4.04 (0.45 / 0.48) | 44.3 / 45.5 %, 23.0 %, 16.8 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 8 | 7.2 | 9.26 / 8.06 / 7.93 | 2336 | 0.6259 / 0.4984 | 0.8985 / 0.8689 | 4.04 (0.48 / 0.52) | 63.4 / 64.4 %, 28.8 %, 17.5 %, 31 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 12 | 9.3 | 9.26 / 8.06 / 7.93 | 2339 | 0.6254 / 0.4980 | 0.8984 / 0.8688 | 4.06 (0.55 / 0.58) | 74.9 / 75.5 %, 40.9 %, 18.9 %, 32 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 16 | 11.6 | 9.26 / 8.06 / 7.93 | 2343 | 0.6247 / 0.4974 | 0.8983 / 0.8688 | 4.07 (0.62 / 0.66) | 80.9 / 81.4 %, 50.8 %, 22.1 %, 32 | 3.10 / 3.72 | — |
| `dbts_c5` window | 16 | 24 | 17.3 | 9.26 / 8.06 / 7.93 | 2348 | 0.6227 / 0.4957 | 0.8980 / 0.8685 | 4.12 (0.77 / 0.81) | 87.0 / 87.2 %, 64.0 %, 32.2 %, 33 | 3.11 / 3.72 | — |
| `dbts_c5` window | 16 | 32 | 37.1 | 9.26 / 8.06 / 7.93 | 2350 | 0.6180 / 0.4910 | 0.8971 / 0.8678 | 4.22 (0.99 / 1.01) | 91.4 / 91.5 %, 75.2 %, 47.4 %, 39 | 3.13 / 3.74 | — |
| `dbts_c5` window | 16 | 40 | 135.2 | 9.26 / 8.06 / 7.93 | 2360 | 0.6106 / 0.4835 | 0.8952 / 0.8662 | 4.37 (1.06 / 1.08) | 93.4 / 93.5 %, 80.9 %, 57.7 %, 55 | 3.17 / 3.79 | — |
| `dbts_c5` window | 16 | 56 | 2898.5 | 9.25 / 8.05 / 7.93 | 2412 | 0.6030 / 0.4775 | 0.8892 / 0.8617 | 4.65 (1.06 / 1.08) | 94.8 / 94.9 %, 84.7 %, 65.3 %, 128 | 3.42 / 4.05 | — |
| `dbts_c5` window | 8 | 1 | 3.4 | 9.26 / 8.06 / 7.93 | 2334 | 0.6263 / 0.4987 | 0.8986 / 0.8690 | 4.03 (0.44 / 0.48) | 30.0 / 31.4 %, 22.3 %, 16.3 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 2 | 4.1 | 9.26 / 8.06 / 7.93 | 2333 | 0.6262 / 0.4987 | 0.8986 / 0.8690 | 4.04 (0.44 / 0.48) | 34.5 / 35.8 %, 22.5 %, 16.4 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 4 | 5.2 | 9.26 / 8.06 / 7.93 | 2334 | 0.6262 / 0.4987 | 0.8986 / 0.8689 | 4.04 (0.45 / 0.48) | 44.3 / 45.5 %, 23.1 %, 16.8 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 8 | 7.2 | 9.26 / 8.06 / 7.93 | 2337 | 0.6259 / 0.4984 | 0.8985 / 0.8689 | 4.04 (0.48 / 0.52) | 63.3 / 64.2 %, 29.0 %, 17.5 %, 31 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 12 | 9.3 | 9.26 / 8.06 / 7.93 | 2339 | 0.6254 / 0.4980 | 0.8984 / 0.8688 | 4.06 (0.55 / 0.58) | 74.8 / 75.5 %, 40.8 %, 18.9 %, 32 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 16 | 11.6 | 9.26 / 8.06 / 7.93 | 2341 | 0.6247 / 0.4974 | 0.8983 / 0.8688 | 4.07 (0.62 / 0.66) | 80.8 / 81.4 %, 50.8 %, 22.2 %, 32 | 3.10 / 3.72 | — |
| `dbts_c5` window | 8 | 24 | 17.3 | 9.26 / 8.06 / 7.93 | 2347 | 0.6228 / 0.4957 | 0.8980 / 0.8685 | 4.12 (0.77 / 0.81) | 87.0 / 87.3 %, 63.9 %, 32.2 %, 33 | 3.11 / 3.72 | — |
| `dbts_c5` window | 8 | 32 | 37.2 | 9.26 / 8.06 / 7.93 | 2348 | 0.6179 / 0.4908 | 0.8971 / 0.8678 | 4.22 (0.99 / 1.01) | 91.4 / 91.5 %, 75.2 %, 47.5 %, 39 | 3.13 / 3.74 | — |
| `dbts_c5` window | 8 | 40 | 134.8 | 9.26 / 8.06 / 7.93 | 2360 | 0.6105 / 0.4832 | 0.8952 / 0.8661 | 4.37 (1.06 / 1.08) | 93.4 / 93.5 %, 80.9 %, 57.7 %, 49 | 3.17 / 3.79 | — |
| `dbts_c5` window | 8 | 56 | 2727.1 | 9.25 / 8.05 / 7.93 | 2388 | 0.6030 / 0.4776 | 0.8893 / 0.8618 | 4.64 (1.06 / 1.08) | 94.8 / 94.9 %, 84.7 %, 65.3 %, 128 | 3.42 / 4.05 | — |
| `usb_cine` (provisional) 8bit | 1 | 1 | 5.6 | 57.57 / 57.41 / 57.38 | 2 | 0.9991 / 0.9990 | 0.9999 / 0.9999 | 0.93 (0.90 / 1.04) | 11.3 / 11.8 %, 0.0 %, 0.0 %, 2 | 0.19 / 0.37 | 10.0 |
| `usb_cine` (provisional) 8bit | 1 | 2 | 7.0 | 55.28 / 55.10 / 55.06 | 4 | 0.9985 / 0.9983 | 0.9998 / 0.9998 | 1.16 (1.12 / 1.25) | 18.5 / 19.3 %, 0.3 %, 0.0 %, 4 | 0.24 / 0.43 | 10.0 |
| `usb_cine` (provisional) 8bit | 1 | 4 | 9.1 | 53.11 / 52.52 / 52.48 | 6 | 0.9975 / 0.9970 | 0.9997 / 0.9996 | 1.53 (1.34 / 1.45) | 25.7 / 28.3 %, 2.7 %, 0.0 %, 6 | 0.33 / 0.61 | 10.0 |
| `usb_cine` (provisional) 8bit | 1 | 8 | 11.6 | 50.78 / 49.68 / 49.52 | 11 | 0.9960 / 0.9943 | 0.9994 / 0.9992 | 2.02 (1.54 / 1.70) | 32.5 / 36.6 %, 9.2 %, 0.2 %, 11 | 0.50 / 0.88 | 9.99 |
| `usb_cine` (provisional) 8bit | 1 | 12 | 13.6 | 48.72 / 47.67 / 47.54 | 11 | 0.9939 / 0.9915 | 0.9989 / 0.9986 | 2.60 (1.79 / 1.94) | 37.8 / 41.0 %, 14.9 %, 0.9 %, 11 | 0.69 / 1.21 | 9.98 |
| `usb_cine` (provisional) 8bit | 1 | 16 | 15.6 | 46.99 / 45.98 / 45.79 | 17 | 0.9911 / 0.9874 | 0.9983 / 0.9977 | 3.14 (2.05 / 2.22) | 40.8 / 44.0 %, 20.3 %, 2.5 %, 17 | 0.87 / 1.56 | 9.97 |
| `usb_cine` (provisional) 8bit | 1 | 24 | 22.8 | 43.24 / 43.12 / 43.10 | 20 | 0.9792 / 0.9779 | 0.9957 / 0.9955 | 4.86 (2.63 / 3.13) | 47.9 / 48.3 %, 28.5 %, 7.3 %, 20 | 1.37 / 2.68 | 9.9 |
| `usb_cine` (provisional) 8bit | 1 | 32 | 35.7 | 40.20 / 40.01 / 39.96 | 28 | 0.9603 / 0.9588 | 0.9905 / 0.9899 | 6.93 (3.26 / 4.24) | 51.8 / 52.6 %, 36.5 %, 15.7 %, 28 | 2.23 / 4.34 | 9.72 |
| `usb_cine` (provisional) 8bit | 1 | 40 | 56.6 | 37.40 / 37.17 / 37.15 | 87 | 0.9336 / 0.9296 | 0.9803 / 0.9793 | 9.56 (4.28 / 5.56) | 57.7 / 58.9 %, 42.5 %, 23.8 %, 87 | 3.46 / 6.87 | 9.29 |
| `usb_cine` (provisional) 8bit | 1 | 56 | 156.2 | 31.56 / 31.39 / 31.31 | 172 | 0.8598 / 0.8487 | 0.9317 / 0.9274 | 18.65 (8.57 / 11.01) | 66.8 / 70.0 %, 53.5 %, 37.2 %, 172 | 8.20 / 16.25 | 7.18 |
| `usb_cine` (provisional) 8bit | 16 | 1 | 13.2 | 58.36 / 57.52 / 57.39 | 5 | 0.9993 / 0.9991 | 0.9999 / 0.9999 | 0.88 (0.87 / 1.04) | 9.4 / 11.8 %, 0.0 %, 0.0 %, 5 | 0.18 / 0.37 | 10.0 |
| `usb_cine` (provisional) 8bit | 16 | 2 | 18.3 | 55.12 / 54.71 / 54.66 | 9 | 0.9984 / 0.9982 | 0.9998 / 0.9998 | 1.20 (1.16 / 1.31) | 18.9 / 20.8 %, 0.5 %, 0.0 %, 9 | 0.25 / 0.46 | 10.0 |
| `usb_cine` (provisional) 8bit | 16 | 4 | 29.7 | 52.65 / 51.85 / 51.78 | 9 | 0.9973 / 0.9965 | 0.9996 / 0.9995 | 1.61 (1.42 / 1.60) | 27.1 / 30.9 %, 3.8 %, 0.0 %, 9 | 0.36 / 0.68 | 10.0 |
| `usb_cine` (provisional) 8bit | 16 | 8 | 41.6 | 50.03 / 49.06 / 48.93 | 18 | 0.9955 / 0.9938 | 0.9993 / 0.9991 | 2.27 (1.73 / 1.87) | 34.4 / 38.1 %, 10.8 %, 0.3 %, 18 | 0.56 / 1.08 | 9.99 |
| `usb_cine` (provisional) 8bit | 16 | 12 | 50.5 | 47.44 / 46.73 / 46.62 | 18 | 0.9919 / 0.9905 | 0.9986 / 0.9983 | 3.01 (2.05 / 2.37) | 40.9 / 42.6 %, 17.5 %, 1.7 %, 18 | 0.78 / 1.65 | 9.97 |
| `usb_cine` (provisional) 8bit | 16 | 16 | 65.7 | 45.35 / 44.84 / 44.73 | 20 | 0.9870 / 0.9855 | 0.9975 / 0.9972 | 3.80 (2.33 / 2.78) | 44.7 / 45.8 %, 23.4 %, 3.9 %, 20 | 1.05 / 2.07 | 9.95 |
| `usb_cine` (provisional) 8bit | 16 | 24 | 124.0 | 42.62 / 42.18 / 41.92 | 33 | 0.9766 / 0.9749 | 0.9950 / 0.9943 | 5.27 (2.85 / 3.55) | 48.7 / 49.4 %, 31.2 %, 9.7 %, 33 | 1.61 / 3.06 | 9.86 |
| `usb_cine` (provisional) 8bit | 16 | 32 | 264.4 | 39.81 / 39.23 / 39.16 | 38 | 0.9579 / 0.9560 | 0.9893 / 0.9884 | 7.33 (3.46 / 4.74) | 52.6 / 53.8 %, 37.8 %, 17.2 %, 38 | 2.55 / 4.75 | 9.61 |
| `usb_cine` (provisional) 8bit | 16 | 40 | 526.2 | 37.08 / 36.69 / 36.62 | 74 | 0.9309 / 0.9237 | 0.9783 / 0.9764 | 9.92 (4.44 / 5.70) | 56.6 / 58.1 %, 42.9 %, 24.9 %, 74 | 3.94 / 7.73 | 9.1 |
| `usb_cine` (provisional) 8bit | 16 | 56 | 1734.8 | 31.50 / 31.16 / 31.12 | 172 | 0.8582 / 0.8470 | 0.9294 / 0.9244 | 18.92 (8.46 / 11.01) | 66.6 / 68.2 %, 52.9 %, 37.2 %, 172 | 8.58 / 17.02 | 7.03 |
| `usb_cine` (provisional) 8bit | 8 | 1 | 12.0 | 58.40 / 57.52 / 57.42 | 6 | 0.9993 / 0.9990 | 0.9999 / 0.9999 | 0.88 (0.87 / 1.02) | 9.3 / 11.7 %, 0.1 %, 0.0 %, 6 | 0.18 / 0.36 | 10.0 |
| `usb_cine` (provisional) 8bit | 8 | 2 | 16.8 | 55.17 / 54.79 / 54.76 | 9 | 0.9984 / 0.9982 | 0.9998 / 0.9998 | 1.19 (1.14 / 1.31) | 18.8 / 20.4 %, 0.5 %, 0.0 %, 9 | 0.25 / 0.46 | 10.0 |
| `usb_cine` (provisional) 8bit | 8 | 4 | 26.4 | 52.84 / 52.03 / 51.95 | 9 | 0.9974 / 0.9967 | 0.9996 / 0.9996 | 1.57 (1.38 / 1.57) | 26.6 / 30.3 %, 3.5 %, 0.0 %, 9 | 0.36 / 0.65 | 10.0 |
| `usb_cine` (provisional) 8bit | 8 | 8 | 36.1 | 50.25 / 49.41 / 49.22 | 17 | 0.9957 / 0.9941 | 0.9993 / 0.9991 | 2.19 (1.64 / 1.86) | 33.7 / 37.6 %, 10.1 %, 0.3 %, 17 | 0.55 / 1.10 | 9.99 |
| `usb_cine` (provisional) 8bit | 8 | 12 | 43.5 | 47.66 / 47.19 / 46.79 | 18 | 0.9924 / 0.9908 | 0.9987 / 0.9983 | 2.91 (1.94 / 2.30) | 40.4 / 42.2 %, 16.8 %, 1.5 %, 18 | 0.77 / 1.56 | 9.97 |
| `usb_cine` (provisional) 8bit | 8 | 16 | 55.3 | 45.57 / 44.95 / 44.77 | 21 | 0.9877 / 0.9855 | 0.9976 / 0.9972 | 3.69 (2.23 / 2.63) | 44.3 / 45.7 %, 23.3 %, 4.0 %, 21 | 1.05 / 2.07 | 9.94 |
| `usb_cine` (provisional) 8bit | 8 | 24 | 98.6 | 42.69 / 42.21 / 42.11 | 27 | 0.9769 / 0.9750 | 0.9949 / 0.9943 | 5.23 (2.73 / 3.43) | 48.6 / 49.4 %, 31.2 %, 9.5 %, 27 | 1.57 / 3.06 | 9.85 |
| `usb_cine` (provisional) 8bit | 8 | 32 | 193.2 | 39.84 / 39.44 / 39.31 | 36 | 0.9582 / 0.9555 | 0.9893 / 0.9885 | 7.25 (3.32 / 4.63) | 52.3 / 52.9 %, 37.8 %, 17.2 %, 36 | 2.49 / 4.74 | 9.63 |
| `usb_cine` (provisional) 8bit | 8 | 40 | 354.2 | 37.15 / 36.79 / 36.74 | 77 | 0.9315 / 0.9250 | 0.9788 / 0.9767 | 9.89 (4.39 / 5.56) | 56.4 / 58.4 %, 42.8 %, 24.7 %, 77 | 3.75 / 7.38 | 9.15 |
| `usb_cine` (provisional) 8bit | 8 | 56 | 1056.8 | 31.52 / 31.29 / 31.24 | 173 | 0.8590 / 0.8487 | 0.9303 / 0.9265 | 18.85 (8.53 / 11.01) | 66.4 / 68.6 %, 53.5 %, 37.2 %, 173 | 8.52 / 16.75 | 7.05 |

##### Knees: the rung farthest from each curve's chord (metric against ln bytes, both scaled 0 … 1)

| series, form | G | PSNR | MS-SSIM (dB of 1 − MS-SSIM) | noise-band e ÷ σ | ≥ 1 level | JOD |
| --- | --: | --: | --: | --: | --: | --: |
| `dbt10_ea1141` 10bit | 1 | 12 | 12 | 12 | 8 | 24 |
| `dbt10_ea1141` 10bit | 16 | 12 | 12 | 12 | 8 | 24 |
| `dbt10_ea1141` 10bit | 8 | 12 | 12 | 12 | 8 | 24 |
| `dbt12_ea1141` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_ea1141` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_ea1141` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_ea1141` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbt12_ea1141` top10 | 16 | 8 | 12 | 8 | 8 | None |
| `dbt12_ea1141` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbt12_ea1141` window | 1 | 32 | 32 | 32 | 24 | None |
| `dbt12_ea1141` window | 16 | 32 | 32 | 32 | 24 | None |
| `dbt12_ea1141` window | 8 | 32 | 32 | 32 | 24 | None |
| `dbts_a2` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a2` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a2` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a2` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_a2` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_a2` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_a2` window | 1 | 32 | 32 | 32 | 24 | None |
| `dbts_a2` window | 16 | 32 | 32 | 32 | 24 | None |
| `dbts_a2` window | 8 | 32 | 32 | 32 | 24 | None |
| `dbts_b2` 10bit | 1 | 8 | 12 | 8 | 8 | 24 |
| `dbts_b2` 10bit | 16 | 12 | 12 | 8 | 8 | 24 |
| `dbts_b2` 10bit | 8 | 8 | 12 | 8 | 8 | 24 |
| `dbts_c4` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c4` 12bit | 16 | 8 | 8 | 12 | 8 | 16 |
| `dbts_c4` 12bit | 8 | 8 | 8 | 12 | 8 | 16 |
| `dbts_c4` top10 | 1 | 8 | 8 | 12 | 8 | None |
| `dbts_c4` top10 | 16 | 8 | 12 | 12 | 8 | None |
| `dbts_c4` top10 | 8 | 8 | 12 | 12 | 8 | None |
| `dbts_c4` window | 1 | 32 | 40 | 40 | 24 | None |
| `dbts_c4` window | 16 | 32 | 32 | 40 | 24 | None |
| `dbts_c4` window | 8 | 32 | 32 | 40 | 24 | None |
| `dbts_c5` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c5` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c5` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c5` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_c5` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_c5` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_c5` window | 1 | 40 | 32 | 32 | 24 | None |
| `dbts_c5` window | 16 | 40 | 32 | 32 | 24 | None |
| `dbts_c5` window | 8 | 40 | 32 | 32 | 24 | None |
| `usb_cine` (provisional) 8bit | 1 | 24 | 24 | 40 | 24 | 32 |
| `usb_cine` (provisional) 8bit | 16 | 16 | 16 | 40 | 16 | 32 |
| `usb_cine` (provisional) 8bit | 8 | 16 | 16 | 32 | 16 | 32 |

##### Anchors: the highest Q from Q 1 up at which every frame holds

| series, form | G | noise-band e ≤ σ | e ≤ σ | every window ≤ 1 level | scroll, band < step | scroll, full < step |
| --- | --: | --: | --: | --: | --: | --: |
| `dbt10_ea1141` 10bit | 1 | 12 | 4 | None | 24 | 32 |
| `dbt10_ea1141` 10bit | 16 | 12 | 4 | None | 24 | 32 |
| `dbt10_ea1141` 10bit | 8 | 12 | 4 | None | 24 | 32 |
| `dbt12_ea1141` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbt12_ea1141` 12bit | 16 | 8 | 4 | None | 16 | 32 |
| `dbt12_ea1141` 12bit | 8 | 8 | 4 | None | 16 | 32 |
| `dbt12_ea1141` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbt12_ea1141` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbt12_ea1141` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbt12_ea1141` window | 1 | 32 | None | None | None | None |
| `dbt12_ea1141` window | 16 | 32 | None | None | None | None |
| `dbt12_ea1141` window | 8 | 32 | None | None | None | None |
| `dbts_a2` 12bit | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` 12bit | 16 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` 12bit | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` top10 | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` top10 | 16 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` top10 | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` window | 1 | 24 | None | None | None | None |
| `dbts_a2` window | 16 | 24 | None | None | None | None |
| `dbts_a2` window | 8 | 24 | None | None | None | None |
| `dbts_b2` 10bit | 1 | 8 | 4 | None | 12 | 32 |
| `dbts_b2` 10bit | 16 | 8 | 4 | None | 12 | 32 |
| `dbts_b2` 10bit | 8 | 8 | 4 | None | 12 | 32 |
| `dbts_c4` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` window | 1 | 32 | None | None | None | None |
| `dbts_c4` window | 16 | 32 | None | None | None | None |
| `dbts_c4` window | 8 | 32 | None | None | None | None |
| `dbts_c5` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` top10 | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_c5` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` window | 1 | 24 | None | None | None | None |
| `dbts_c5` window | 16 | 24 | None | None | None | None |
| `dbts_c5` window | 8 | 24 | None | None | None | None |
| `usb_cine` (provisional) 8bit | 1 | None | None | None | 8 | 8 |
| `usb_cine` (provisional) 8bit | 16 | None | None | None | 4 | 4 |
| `usb_cine` (provisional) 8bit | 8 | None | None | None | 4 | 4 |

##### Controls

| series | HTJ2K B | lossless AV1 G 1 B | ratio HTJ2K | ratio AV1 |
| --- | --: | --: | --: | --: |
| `dbt10_ea1141` | 13637860 | 12971423 | 2.58 | 2.71 |
| `dbt12_ea1141` | 14476791 | 13721987 | 2.51 | 2.65 |
| `dbts_a2` | 97667570 | 92267970 | 2.77 | 2.93 |
| `dbts_b2` | 143768865 | 136228987 | 2.87 | 3.03 |
| `dbts_c4` | 41429376 | 39203703 | 3.52 | 3.72 |
| `dbts_c5` | 82238373 | 77702592 | 2.67 | 2.83 |
| `usb_cine` | 4992262 | 4504277 | 3.36 | 3.72 |

## Quality metrics, measured (2026-11-05)

1. **Run:** the collector step of §Collector over the rows of shards 1, 2 and 4 (1 200 cells, 20 series); shard 3
   pushed its checks, controls and series rows but no cell by 08:00 UTC, so its seven series are missing (below).
2. **Shows**, DBT, stored form: the coding error reaches the frame's own noise after Q 8 on systems B and C (A: Q 4),
   at 0.10–0.22 of HTJ2K's bytes (A: 0.27–0.28), and the pixel metrics bend at Q 8–12; no rung, not even Q 1, keeps
   every displayed grey level within 1; the scrolling anchor holds to Q 16 (B: 12–24), at 0.006–0.073 of HTJ2K's.
3. **Rests on** the 20 series named below only (2 of system A's five volumes, 4 of B's, all 5 of C's, 3 content-2
   DBT sets, the 2 TRUS sweeps, 2 breast MR controls, 2 lossy-sourced cine sets apart), libaom 3.15.1 at cpu6,
   dav1d 1.5.4, and the checks each shard ran and mutated (their sections).
4. **Left:** shard 3's series (`dbts_a3`, `dbts_a4`, `dbts_a5`, `dbts_b4`, `dbt10_d`, `us_liver`, `rf_fluoro`); breast
   ultrasound cine and ABUS (no dataset); whether any rung is visually lossless to a reader (§6, not run).
5. **Host:** each shard on 4 cores and 15 GB, four cells in flight, one thread each (their sections); this step is
   arithmetic on their rows. Nothing past those hosts is claimed.

*Terms*, as §Terms and defined again here. **Q** — libaom's quantizer, 0–63, held fixed per cell. **G** — frames coded
together, a keyframe every G frames; G 1 codes each frame alone. **Systems A, B, C** — the three DBT scanners of the
EA1141 dataset: A and C 12-bit, B 10-bit. **σ** — a frame's own noise in the finest band (§4.4); **e_N** — the coding
error in the same band. **Stored form** — the 12-bit stream for a 12-bit series, the series' own depth otherwise.
**HTJ2K** — the served lossless profile, coded as this series' control; *bytes ÷ HTJ2K* is the lossy cell's bytes over
that control's. **JOD** — ColorVideoVDP's unit, 10 = no visible difference. **Knee** — the rung farthest from the
chord of a metric against ln bytes (§5 c). **The anchors** (§5), each the highest Q from Q 1 up at which every frame
holds: **(a) by noise**, e_N ≤ σ; **(a) by displayed levels**, every window's largest move ≤ 1 grey level; **(b)
scrolling**, the coding error smaller than the step between neighbouring slices, in the 4 × 4 band and at full
resolution. **Median** over a family is the lower middle rung when the count is even, so it is always a rung.

### For the owner

Stored form, per family, at G 1 and G 16: the Q at which each anchor is reached and the bytes there as a fraction of
HTJ2K's, median (range) over the family's series. "None" means no rung holds, not even Q 1. Every entry is a row of
the per-family table below, which `systems.py` reads from the shards' rows.

| family (series run) | G | inside the noise (e_N ≤ σ) | ≤ 1 displayed level | below the neighbour-slice step, band | the same, full resolution |
| --- | --: | --- | --- | --- | --- |
| DBT system A (2 of 5) | 1 | Q 4 · 0.27 | none | Q 16 · 0.012 | Q 40 · 0.002 |
| | 16 | Q 4 · 0.28 | none | Q 16 · 0.007 | Q 32–40 · 0.001 |
| DBT system B (4 of 5) | 1 | Q 8 (8–12) · 0.13 (0.10–0.15) | none | Q 16 (12–24) · 0.055 (0.025–0.073) | Q 40 (32–56) · 0.005 |
| | 16 | Q 8 (8–12) · 0.14 (0.11–0.22) | none | Q 16 (12–24) · 0.044 (0.015–0.061) | Q 40 (32–40) · 0.002 |
| DBT system C (5 of 5) | 1 | Q 8 · 0.11 (0.10–0.12) | none | Q 16 · 0.017 (0.014–0.022) | Q 40 · 0.002 |
| | 16 | Q 8 · 0.11 (0.10–0.12) | none | Q 16 · 0.012 (0.009–0.016) | Q 40 · 0.001 |
| other sound sets: content-2 DBT (3 of 4) | 1 | Q 8 (8–12) · 0.11 (0.10–0.13) | none | Q 16 (16–24) · 0.019 (0.017–0.041) | Q 40 (32–40) · 0.002 (0.002–0.018) |
| | 16 | Q 8 (8–12) · 0.11 (0.10–0.11) | none | Q 16 (16–24) · 0.013 (0.012–0.027) | Q 32 (32–40) · 0.001 (0.001–0.008) |
| other sound sets: TRUS sweeps (2 of 2) | 1 | Q 4 · 0.53 (0.52–0.54) | none | Q 24 · 0.12 | Q 32 · 0.06 |
| | 16 | Q 2–4 · 0.44–0.60 | none | Q 24 · 0.08 | Q 32 · 0.04 |
| other sound sets: breast MR controls (2 of 3 controls) | 1 | `mr_ispy1` Q 4 · 0.17; `mr9_ispy2` none | none | Q 4–16 · 0.01–0.15 | Q 16–40 · 0.001–0.02 |
| | 16 | Q 1–4 · 0.18–0.57 | none | Q 4–16 · 0.01–0.15 | Q 16–32 · 0.002–0.02 |
| provisional cine, lossy-sourced (2 of 3), in no verdict | 1 | `usb_cine_rgb` Q 4 · 0.25; `usb_cine` none | none | Q 8–32 · 0.05–0.29 | Q 8–32 · 0.05–0.29 |
| | 16 | `usb_cine_rgb` Q 4 · 0.18; `usb_cine` none | none | Q 4–32 · 0.03–0.11 | Q 4–32 · 0.03–0.11 |

How to read it, and what it does not say:

* **Inside the noise** on DBT is where the error first fills the fine band's noise: e_N ÷ σ saturates near 1.04
  above it (§8), because the quantizer has removed that noise. So Q 8 is the last rung that keeps part of the
  noise, not a rung whose error is below it, and at e_N = σ the band's noise rises by √2 (*derived*, §5 a). The
  pixel metrics' knees fall on that same rung (below), and JOD there is 9.67–9.96 on DBT.
* **No rung keeps every displayed level within 1** on any series: on DBT, Q 1 already moves 16–29 % of the first
  window's pixels by at least one level (median frame) and its largest move is 2–9 levels (every cell). The two
  forms of anchor (a) disagree everywhere, and neither is called visually lossless: §6's flicker test would decide.
* **Below the neighbour-slice step** is the scrolling reading: on DBT the band test holds to Q 16 at 1–6 % of HTJ2K's
  bytes, the full-resolution test to Q 32–40. JOD at Q 16 is 8.3–8.6 on A, 8.3–9.0 on C, 9.6–9.7 on B — the
  visibility model sees system A and C's Q 16 as a difference a viewer would notice, B's much less.
* **G 16 against G 1** moves no DBT anchor by more than one rung and cuts the bytes there by up to 40 % at Q 16
  (system A 0.012 → 0.007); at the noise anchor the two are within 0.015 of each other except on `dbts_b1`, whose
  anchor moves a rung (Q 12 · 0.10 at G 1, Q 8 · 0.22 at G 16).
* **Where the data shows no knee:** `usb_cine_rgb` has no JOD (the visibility model runs on grey stored forms only),
  so no JOD knee; `usb_cine` and `mr9_ispy2` at G 1 have no noise anchor (their σ is below every rung's e_N: median σ
  0.358 on `usb_cine`, shard 2's section). Every other curve has a knee.
* **Claimed for these fixtures only.** The repo has few cine-like breast series: no breast ultrasound cine except the
  two lossy-sourced sets, and no ABUS. TRUS is the nearest swept volume and is never an ABUS verdict.

### Per series and per family

`systems.py lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl`, run from `lab/av1/metrics`: each series' stored form, its
anchors and knees as `collect.py` computes them, then per family. Each anchor's entry is the Q and the bytes there ÷
the series' HTJ2K control. "Controls" are the two breast MR series; "provisional" are the lossy-sourced cine sets,
in no verdict.

##### Per series, stored form: anchors and knees (Q, and bytes ÷ HTJ2K there)

| series | form | G | e_N ≤ σ | ≤ 1 level | band < step | full < step | knee PSNR · MS-SSIM · e_N ÷ σ · ≥ 1 level · JOD |
| --- | --- | --: | --- | --- | --- | --- | --- |
| `dbts_a1` | 12bit | 1 | 4 · 0.268 | no rung | 16 · 0.011 | 40 · 0.002 | 8 · 8 · 8 · 8 · 16 |
| `dbts_a1` | 12bit | 16 | 4 · 0.270 | no rung | 16 · 0.006 | 32 · 0.001 | 8 · 8 · 8 · 8 · 16 |
| `dbts_a2` | 12bit | 1 | 4 · 0.279 | no rung | 16 · 0.014 | 40 · 0.002 | 8 · 8 · 8 · 8 · 16 |
| `dbts_a2` | 12bit | 16 | 4 · 0.279 | no rung | 16 · 0.008 | 40 · 0.000 | 8 · 8 · 8 · 8 · 16 |
| `dbts_b1` | 10bit | 1 | 12 · 0.101 | no rung | 24 · 0.025 | 56 · 0.001 | 12 · 12 · 12 · 8 · 24 |
| `dbts_b1` | 10bit | 16 | 8 · 0.216 | no rung | 24 · 0.015 | 40 · 0.002 | 12 · 12 · 12 · 8 · 24 |
| `dbts_b2` | 10bit | 1 | 8 · 0.150 | no rung | 12 · 0.073 | 32 · 0.008 | 8 · 12 · 8 · 8 · 24 |
| `dbts_b2` | 10bit | 16 | 8 · 0.141 | no rung | 12 · 0.061 | 32 · 0.003 | 12 · 12 · 8 · 8 · 24 |
| `dbts_b3` | 10bit | 1 | 12 · 0.120 | no rung | 16 · 0.065 | 40 · 0.006 | 12 · 12 · 12 · 8 · 24 |
| `dbts_b3` | 10bit | 16 | 12 · 0.106 | no rung | 16 · 0.051 | 40 · 0.002 | 12 · 12 · 12 · 8 · 24 |
| `dbts_b5` | 10bit | 1 | 8 · 0.143 | no rung | 16 · 0.045 | 40 · 0.004 | 8 · 12 · 8 · 8 · 24 |
| `dbts_b5` | 10bit | 16 | 8 · 0.139 | no rung | 16 · 0.036 | 40 · 0.001 | 12 · 12 · 8 · 8 · 24 |
| `dbts_c1` | 12bit | 1 | 8 · 0.096 | no rung | 16 · 0.015 | 40 · 0.002 | 8 · 8 · 8 · 8 · 16 |
| `dbts_c1` | 12bit | 16 | 8 · 0.095 | no rung | 16 · 0.010 | 40 · 0.001 | 8 · 8 · 8 · 8 · 16 |
| `dbts_c2` | 12bit | 1 | 8 · 0.113 | no rung | 16 · 0.018 | 40 · 0.002 | 8 · 8 · 8 · 8 · 16 |
| `dbts_c2` | 12bit | 16 | 8 · 0.113 | no rung | 16 · 0.012 | 40 · 0.001 | 8 · 8 · 12 · 8 · 16 |
| `dbts_c3` | 12bit | 1 | 8 · 0.111 | no rung | 16 · 0.017 | 40 · 0.002 | 8 · 8 · 8 · 8 · 16 |
| `dbts_c3` | 12bit | 16 | 8 · 0.112 | no rung | 16 · 0.012 | 40 · 0.001 | 8 · 8 · 8 · 8 · 16 |
| `dbts_c4` | 12bit | 1 | 8 · 0.124 | no rung | 16 · 0.022 | 40 · 0.003 | 8 · 8 · 8 · 8 · 16 |
| `dbts_c4` | 12bit | 16 | 8 · 0.122 | no rung | 16 · 0.016 | 40 · 0.001 | 8 · 8 · 12 · 8 · 16 |
| `dbts_c5` | 12bit | 1 | 8 · 0.096 | no rung | 16 · 0.014 | 40 · 0.002 | 8 · 8 · 8 · 8 · 16 |
| `dbts_c5` | 12bit | 16 | 8 · 0.096 | no rung | 16 · 0.009 | 40 · 0.000 | 8 · 8 · 8 · 8 · 16 |
| `dbt10_ea1141` | 10bit | 1 | 12 · 0.126 | no rung | 24 · 0.041 | 32 · 0.018 | 12 · 12 · 12 · 8 · 24 |
| `dbt10_ea1141` | 10bit | 16 | 12 · 0.113 | no rung | 24 · 0.027 | 32 · 0.008 | 12 · 12 · 12 · 8 · 24 |
| `dbt12_c` | 12bit | 1 | 8 · 0.109 | no rung | 16 · 0.019 | 40 · 0.002 | 8 · 8 · 8 · 8 · 16 |
| `dbt12_c` | 12bit | 16 | 8 · 0.109 | no rung | 16 · 0.013 | 40 · 0.001 | 8 · 8 · 8 · 8 · 16 |
| `dbt12_ea1141` | 12bit | 1 | 8 · 0.097 | no rung | 16 · 0.017 | 40 · 0.002 | 8 · 8 · 8 · 8 · 16 |
| `dbt12_ea1141` | 12bit | 16 | 8 · 0.096 | no rung | 16 · 0.012 | 32 · 0.001 | 8 · 8 · 8 · 8 · 16 |
| `ustrus_1` | 8bit | 1 | 4 · 0.523 | no rung | 24 · 0.121 | 32 · 0.063 | 16 · 16 · 24 · 12 · 32 |
| `ustrus_1` | 8bit | 16 | 2 · 0.599 | no rung | 24 · 0.080 | 32 · 0.039 | 16 · 24 · 24 · 12 · 32 |
| `ustrus_2` | 8bit | 1 | 4 · 0.538 | no rung | 24 · 0.115 | 32 · 0.058 | 12 · 16 · 24 · 12 · 32 |
| `ustrus_2` | 8bit | 16 | 4 · 0.444 | no rung | 24 · 0.077 | 32 · 0.035 | 12 · 16 · 24 · 12 · 32 |
| `mr9_ispy2` | 9bit | 1 | no rung | no rung | 4 · 0.147 | 16 · 0.021 | 8 · 8 · 16 · 4 · 12 |
| `mr9_ispy2` | 9bit | 16 | 1 · 0.573 | no rung | 4 · 0.147 | 16 · 0.018 | 8 · 8 · 16 · 4 · 12 |
| `mr_ispy1` | 11bit | 1 | 4 · 0.169 | no rung | 16 · 0.010 | 40 · 0.001 | 8 · 8 · 8 · 4 · 8 |
| `mr_ispy1` | 11bit | 16 | 4 · 0.177 | no rung | 16 · 0.009 | 32 · 0.002 | 8 · 8 · 8 · 4 · 8 |
| `usb_cine` | 8bit | 1 | no rung | no rung | 8 · 0.291 | 8 · 0.291 | 24 · 24 · 40 · 24 · 32 |
| `usb_cine` | 8bit | 16 | no rung | no rung | 4 · 0.113 | 4 · 0.113 | 16 · 16 · 40 · 16 · 32 |
| `usb_cine_rgb` | rgb420 | 1 | 4 · 0.248 | no rung | 32 · 0.054 | 32 · 0.054 | 8 · 8 · 24 · 24 · None |
| `usb_cine_rgb` | rgb420 | 16 | 4 · 0.182 | no rung | 32 · 0.029 | 32 · 0.029 | 4 · 8 · 32 · 24 · None |

##### Per family: the highest Q holding, median (range), and bytes ÷ HTJ2K there, median (range)

| family | series | G | e_N ≤ σ: Q · bytes | ≤ 1 level: Q | band < step: Q · bytes | full < step: Q · bytes | knees, median Q: PSNR · MS-SSIM · e_N ÷ σ · ≥ 1 level · JOD | knee PSNR: bytes |
| --- | --: | --: | --- | --- | --- | --- | --- | --- |
| system A | 2 | 1 | 4 (4) · 0.274 (0.268–0.279) | no rung | 16 (16) · 0.012 (0.011–0.014) | 40 (40) · 0.002 (0.002–0.002) | 8 · 8 · 8 · 8 · 16 | 0.081 (0.074–0.089) |
| system A | 2 | 16 | 4 (4) · 0.275 (0.270–0.279) | no rung | 16 (16) · 0.007 (0.006–0.008) | 32 (32–40) · 0.001 (0.000–0.001) | 8 · 8 · 8 · 8 · 16 | 0.081 (0.074–0.088) |
| system B | 4 | 1 | 8 (8–12) · 0.132 (0.101–0.150) | no rung | 16 (12–24) · 0.055 (0.025–0.073) | 40 (32–56) · 0.005 (0.001–0.008) | 8 · 12 · 8 · 8 · 24 | 0.132 (0.101–0.150) |
| system B | 4 | 16 | 8 (8–12) · 0.140 (0.106–0.216) | no rung | 16 (12–24) · 0.044 (0.015–0.061) | 40 (32–40) · 0.002 (0.001–0.003) | 12 · 12 · 8 · 8 · 24 | 0.080 (0.061–0.106) |
| system C | 5 | 1 | 8 (8) · 0.111 (0.096–0.124) | no rung | 16 (16) · 0.017 (0.014–0.022) | 40 (40) · 0.002 (0.002–0.003) | 8 · 8 · 8 · 8 · 16 | 0.111 (0.096–0.124) |
| system C | 5 | 16 | 8 (8) · 0.112 (0.095–0.122) | no rung | 16 (16) · 0.012 (0.009–0.016) | 40 (40) · 0.001 (0.000–0.001) | 8 · 8 · 8 · 8 · 16 | 0.112 (0.095–0.122) |
| content 2 DBT | 3 | 1 | 8 (8–12) · 0.109 (0.097–0.126) | no rung | 16 (16–24) · 0.019 (0.017–0.041) | 40 (32–40) · 0.002 (0.002–0.018) | 8 · 8 · 8 · 8 · 16 | 0.109 (0.097–0.126) |
| content 2 DBT | 3 | 16 | 8 (8–12) · 0.109 (0.096–0.113) | no rung | 16 (16–24) · 0.013 (0.012–0.027) | 32 (32–40) · 0.001 (0.001–0.008) | 8 · 8 · 8 · 8 · 16 | 0.109 (0.096–0.113) |
| TRUS | 2 | 1 | 4 (4) · 0.531 (0.523–0.538) | no rung | 24 (24) · 0.118 (0.115–0.121) | 32 (32) · 0.061 (0.058–0.063) | 12 · 16 · 24 · 12 · 32 | 0.215 (0.186–0.244) |
| TRUS | 2 | 16 | 2 (2–4) · 0.522 (0.444–0.599) | no rung | 24 (24) · 0.079 (0.077–0.080) | 32 (32) · 0.037 (0.035–0.039) | 12 · 16 · 24 · 12 · 32 | 0.157 (0.132–0.182) |
| controls | 2 | 1 | 4 (4; no rung on 1) · 0.169 | no rung | 4 (4–16) · 0.079 (0.010–0.147) | 16 (16–40) · 0.011 (0.001–0.021) | 8 · 8 · 8 · 4 · 8 | 0.051 (0.045–0.056) |
| controls | 2 | 16 | 1 (1–4) · 0.375 (0.177–0.573) | no rung | 4 (4–16) · 0.078 (0.009–0.147) | 16 (16–32) · 0.010 (0.002–0.018) | 8 · 8 · 8 · 4 · 8 | 0.049 (0.045–0.053) |
| provisional | 2 | 1 | 4 (4; no rung on 1) · 0.248 | no rung | 8 (8–32) · 0.172 (0.054–0.291) | 8 (8–32) · 0.172 (0.054–0.291) | 8 · 8 · 24 · 24 · 32 | 0.162 (0.147–0.177) |
| provisional | 2 | 16 | 4 (4; no rung on 1) · 0.182 | no rung | 4 (4–32) · 0.071 (0.029–0.113) | 4 (4–32) · 0.071 (0.029–0.113) | 4 · 8 · 32 · 16 · 32 | 0.116 (0.051–0.182) |

##### More than one rung from the family's median

| series | G | reading | Q | family median Q |
| --- | --: | --- | --: | --: |

**The curves:** [`rows/curves.tsv`](rows/curves.tsv), one line per (series, form, G, Q), bytes against each metric,
and [`rows/curves/`](rows/curves/), one SVG per family and metric (ln bytes on x; median PSNR, MS-SSIM in dB of
1 − MS-SSIM, e_N ÷ σ, the share moved ≥ 1 level, JOD on y; each series' stored form, G 1 solid, G 16 dashed): system
[A](rows/curves/system-A-psnr_med.svg), [B](rows/curves/system-B-psnr_med.svg),
[C](rows/curves/system-C-psnr_med.svg), [the other sets](rows/curves/other-sets-psnr_med.svg) (PSNR shown; the
other metrics sit beside each).

**What agrees.** On DBT the knees of PSNR, MS-SSIM, e_N ÷ σ and the ≥ 1-level share fall within a rung of anchor
(a) by noise: both at Q 8 on C and content 2's 12-bit sets, both at Q 8–12 on B; on A the knees sit at Q 8 and the
noise anchor one rung below, at Q 4. JOD bends later: Q 16 on A and C, Q 24 on B and the 10-bit content-2 set. The
pilot's reading (§8) — knees at Q 8, noise anchor to Q 8, no rung within one displayed level, scrolling anchor to
Q 16 in the band — holds on system C and content 2's 12-bit sets; A's noise anchor is a rung lower, and B's knees
and anchors up to a rung higher.

**What does not.** Anchor (a) by noise and anchor (a) by displayed levels disagree on every series: the first holds
to Q 4–12, the second at no rung. No series sits more than one rung from its family's median on any anchor or knee
(the table above is empty), read only where a family has three series or more (B, C, content 2); system A (two
series), TRUS (two) and the MR controls (two) are too few to name one.

<details><summary><code>collect.py lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl --partial --tsv … --svg …</code>: every cell, the knees, the anchors and the controls of the 20 series (every form, every G)</summary>

##### Every cell

| series, form | G | Q | ratio | PSNR med / p5 / min dB | max \|Δ\| | SSIM med / min | MS-SSIM med / min | e ÷ σ med (noise band med / max) | window 1: ≥1 level med / max, ≥2 max, ≥4 max, max | scroll med / max | JOD |
| --- | --: | --: | --: | --- | --: | --- | --- | --- | --- | --- | --: |
| `dbt10_ea1141` 10bit | 1 | 1 | 3.2 | 66.01 / 65.97 / 65.97 | 9 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.15 (0.15 / 0.15) | 19.2 / 19.3 %, 0.0 %, 0.0 %, 2 | 0.04 / 0.04 | 10.0 |
| `dbt10_ea1141` 10bit | 1 | 2 | 4.1 | 62.04 / 62.00 / 61.99 | 9 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.24 (0.25 / 0.25) | 35.8 / 35.9 %, 0.4 %, 0.0 %, 3 | 0.06 / 0.06 | 10.0 |
| `dbt10_ea1141` 10bit | 1 | 4 | 5.9 | 56.35 / 56.31 / 56.31 | 18 | 0.9982 / 0.9981 | 0.9998 / 0.9998 | 0.46 (0.48 / 0.49) | 61.1 / 61.2 %, 12.6 %, 0.0 %, 5 | 0.11 / 0.11 | 10.0 |
| `dbt10_ea1141` 10bit | 1 | 8 | 11.9 | 49.42 / 49.39 / 49.39 | 80 | 0.9913 / 0.9907 | 0.9989 / 0.9987 | 1.03 (0.86 / 0.87) | 81.4 / 81.5 %, 48.2 %, 10.1 %, 13 | 0.25 / 0.26 | 9.96 |
| `dbt10_ea1141` 10bit | 1 | 12 | 20.4 | 46.21 / 46.18 / 46.17 | 168 | 0.9819 / 0.9804 | 0.9973 / 0.9969 | 1.49 (0.97 / 0.98) | 86.9 / 87.0 %, 62.3 %, 25.4 %, 39 | 0.40 / 0.42 | 9.89 |
| `dbt10_ea1141` 10bit | 1 | 16 | 31.7 | 44.25 / 44.22 / 44.22 | 343 | 0.9716 / 0.9693 | 0.9951 / 0.9944 | 1.86 (1.01 / 1.02) | 89.4 / 89.5 %, 69.3 %, 35.9 %, 43 | 0.56 / 0.58 | 9.76 |
| `dbt10_ea1141` 10bit | 1 | 24 | 62.5 | 42.15 / 42.11 / 42.10 | 389 | 0.9549 / 0.9514 | 0.9906 / 0.9892 | 2.36 (1.04 / 1.05) | 91.6 / 91.7 %, 75.4 %, 46.6 %, 85 | 0.84 / 0.87 | 9.39 |
| `dbt10_ea1141` 10bit | 1 | 32 | 143.7 | 40.31 / 40.22 / 40.20 | 417 | 0.9357 / 0.9325 | 0.9826 / 0.9802 | 2.91 (1.06 / 1.07) | 93.1 / 93.2 %, 79.6 %, 54.9 %, 94 | 1.35 / 1.39 | 8.48 |
| `dbt10_ea1141` 10bit | 1 | 40 | 270.5 | 38.90 / 38.68 / 38.67 | 444 | 0.9234 / 0.9211 | 0.9730 / 0.9715 | 3.37 (1.12 / 1.21) | 94.0 / 94.1 %, 82.3 %, 60.3 %, 98 | 1.93 / 2.00 | 7.46 |
| `dbt10_ea1141` 10bit | 1 | 56 | 887.8 | 35.39 / 35.01 / 34.94 | 522 | 0.8900 / 0.8760 | 0.9392 / 0.9331 | 4.95 (1.19 / 1.45) | 95.7 / 95.8 %, 87.5 %, 71.3 %, 163 | 3.70 / 3.89 | 5.07 |
| `dbt10_ea1141` 10bit | 16 | 1 | 3.2 | 65.92 / 65.88 / 65.87 | 16 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.15 (0.16 / 0.16) | 19.4 / 19.5 %, 0.0 %, 0.0 %, 8 | 0.04 / 0.04 | 10.0 |
| `dbt10_ea1141` 10bit | 16 | 2 | 4.1 | 62.08 / 62.03 / 62.02 | 22 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.24 (0.24 / 0.25) | 35.6 / 35.9 %, 0.4 %, 0.0 %, 9 | 0.06 / 0.06 | 10.0 |
| `dbt10_ea1141` 10bit | 16 | 4 | 6.1 | 56.23 / 56.13 / 56.11 | 30 | 0.9982 / 0.9980 | 0.9998 / 0.9997 | 0.47 (0.48 / 0.49) | 61.5 / 61.8 %, 13.3 %, 0.0 %, 15 | 0.11 / 0.12 | 10.0 |
| `dbt10_ea1141` 10bit | 16 | 8 | 12.6 | 49.56 / 49.48 / 49.40 | 59 | 0.9917 / 0.9909 | 0.9989 / 0.9987 | 1.01 (0.86 / 0.86) | 81.1 / 81.4 %, 48.1 %, 10.1 %, 28 | 0.25 / 0.26 | 9.96 |
| `dbt10_ea1141` 10bit | 16 | 12 | 22.9 | 46.30 / 46.24 / 46.19 | 105 | 0.9823 / 0.9810 | 0.9973 / 0.9969 | 1.47 (0.98 / 0.98) | 86.8 / 87.0 %, 62.3 %, 25.4 %, 52 | 0.41 / 0.42 | 9.89 |
| `dbt10_ea1141` 10bit | 16 | 16 | 38.9 | 44.38 / 44.31 / 44.23 | 131 | 0.9727 / 0.9705 | 0.9952 / 0.9946 | 1.83 (1.02 / 1.02) | 89.3 / 89.5 %, 69.1 %, 35.7 %, 66 | 0.56 / 0.59 | 9.75 |
| `dbt10_ea1141` 10bit | 16 | 24 | 96.8 | 42.10 / 42.04 / 41.98 | 261 | 0.9551 / 0.9516 | 0.9903 / 0.9889 | 2.38 (1.04 / 1.05) | 91.6 / 91.8 %, 75.8 %, 47.2 %, 64 | 0.87 / 0.93 | 9.31 |
| `dbt10_ea1141` 10bit | 16 | 32 | 315.7 | 40.14 / 40.04 / 40.02 | 337 | 0.9353 / 0.9330 | 0.9816 / 0.9799 | 2.96 (1.07 / 1.08) | 93.2 / 93.3 %, 80.1 %, 55.7 %, 82 | 1.42 / 1.50 | 8.32 |
| `dbt10_ea1141` 10bit | 16 | 40 | 787.1 | 38.56 / 38.42 / 38.29 | 436 | 0.9226 / 0.9199 | 0.9718 / 0.9684 | 3.50 (1.13 / 1.23) | 94.2 / 94.3 %, 83.0 %, 61.8 %, 104 | 2.05 / 2.21 | 7.19 |
| `dbt10_ea1141` 10bit | 16 | 56 | 4263.0 | 34.88 / 34.62 / 34.61 | 504 | 0.8882 / 0.8857 | 0.9342 / 0.9255 | 5.30 (1.18 / 1.44) | 95.9 / 96.0 %, 88.1 %, 72.7 %, 143 | 4.02 / 4.26 | 4.6 |
| `dbt10_ea1141` 10bit | 8 | 1 | 3.2 | 65.93 / 65.88 / 65.87 | 17 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.15 (0.16 / 0.16) | 19.4 / 19.5 %, 0.0 %, 0.0 %, 8 | 0.04 / 0.04 | 10.0 |
| `dbt10_ea1141` 10bit | 8 | 2 | 4.1 | 62.09 / 62.02 / 62.01 | 19 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.24 (0.24 / 0.25) | 35.6 / 35.9 %, 0.4 %, 0.0 %, 9 | 0.06 / 0.06 | 10.0 |
| `dbt10_ea1141` 10bit | 8 | 4 | 6.1 | 56.23 / 56.13 / 56.12 | 30 | 0.9982 / 0.9980 | 0.9998 / 0.9997 | 0.47 (0.48 / 0.49) | 61.5 / 61.8 %, 13.3 %, 0.0 %, 15 | 0.11 / 0.12 | 10.0 |
| `dbt10_ea1141` 10bit | 8 | 8 | 12.6 | 49.56 / 49.41 / 49.40 | 59 | 0.9916 / 0.9909 | 0.9989 / 0.9987 | 1.01 (0.86 / 0.86) | 81.1 / 81.4 %, 48.1 %, 10.1 %, 27 | 0.25 / 0.26 | 9.96 |
| `dbt10_ea1141` 10bit | 8 | 12 | 22.8 | 46.29 / 46.20 / 46.17 | 92 | 0.9823 / 0.9810 | 0.9973 / 0.9969 | 1.47 (0.98 / 0.98) | 86.8 / 87.0 %, 62.3 %, 25.4 %, 36 | 0.41 / 0.42 | 9.88 |
| `dbt10_ea1141` 10bit | 8 | 16 | 38.7 | 44.38 / 44.24 / 44.22 | 132 | 0.9727 / 0.9705 | 0.9952 / 0.9946 | 1.83 (1.02 / 1.02) | 89.3 / 89.5 %, 69.1 %, 35.7 %, 66 | 0.56 / 0.59 | 9.75 |
| `dbt10_ea1141` 10bit | 8 | 24 | 95.2 | 42.10 / 42.02 / 41.98 | 261 | 0.9551 / 0.9516 | 0.9903 / 0.9889 | 2.38 (1.04 / 1.05) | 91.7 / 91.8 %, 75.8 %, 47.2 %, 73 | 0.87 / 0.93 | 9.33 |
| `dbt10_ea1141` 10bit | 8 | 32 | 303.7 | 40.15 / 40.05 / 40.03 | 337 | 0.9351 / 0.9330 | 0.9814 / 0.9799 | 2.96 (1.06 / 1.08) | 93.2 / 93.3 %, 80.1 %, 55.7 %, 76 | 1.42 / 1.50 | 8.36 |
| `dbt10_ea1141` 10bit | 8 | 40 | 742.0 | 38.56 / 38.42 / 38.29 | 436 | 0.9225 / 0.9199 | 0.9716 / 0.9684 | 3.49 (1.13 / 1.23) | 94.1 / 94.3 %, 83.0 %, 61.8 %, 104 | 2.04 / 2.21 | 7.28 |
| `dbt10_ea1141` 10bit | 8 | 56 | 3699.2 | 34.97 / 34.61 / 34.51 | 504 | 0.8886 / 0.8857 | 0.9369 / 0.9243 | 5.13 (1.18 / 1.44) | 95.8 / 96.1 %, 88.3 %, 73.3 %, 143 | 3.90 / 4.28 | 4.87 |
| `dbt12_c` 12bit | 1 | 1 | 4.8 | 72.74 / 72.51 / 72.51 | 26 | 1.0000 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 18.6 / 19.1 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.02 | 10.0 |
| `dbt12_c` 12bit | 1 | 2 | 6.2 | 66.81 / 66.59 / 66.58 | 31 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.19) | 36.9 / 37.7 %, 1.8 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbt12_c` 12bit | 1 | 4 | 10.4 | 58.82 / 58.59 / 58.59 | 68 | 0.9988 / 0.9987 | 0.9998 / 0.9998 | 0.44 (0.45 / 0.48) | 65.4 / 66.5 %, 24.2 %, 1.9 %, 10 | 0.10 / 0.11 | 9.98 |
| `dbt12_c` 12bit | 1 | 8 | 28.5 | 50.87 / 50.73 / 50.71 | 291 | 0.9924 / 0.9919 | 0.9989 / 0.9988 | 1.11 (0.94 / 0.96) | 83.6 / 85.4 %, 60.0 %, 26.3 %, 27 | 0.25 / 0.29 | 9.84 |
| `dbt12_c` 12bit | 1 | 12 | 80.3 | 47.59 / 47.46 / 47.45 | 382 | 0.9837 / 0.9830 | 0.9972 / 0.9969 | 1.62 (1.06 / 1.09) | 87.7 / 89.5 %, 70.7 %, 41.9 %, 47 | 0.44 / 0.52 | 9.49 |
| `dbt12_c` 12bit | 1 | 16 | 164.0 | 46.34 / 46.16 / 46.15 | 401 | 0.9789 / 0.9774 | 0.9955 / 0.9949 | 1.86 (1.07 / 1.10) | 89.1 / 90.7 %, 73.9 %, 46.9 %, 69 | 0.62 / 0.72 | 9.0 |
| `dbt12_c` 12bit | 1 | 24 | 355.1 | 45.24 / 45.05 / 45.02 | 496 | 0.9743 / 0.9725 | 0.9929 / 0.9920 | 2.10 (1.07 / 1.10) | 90.4 / 91.8 %, 76.5 %, 51.2 %, 94 | 0.89 / 1.06 | 8.07 |
| `dbt12_c` 12bit | 1 | 32 | 705.7 | 44.14 / 43.97 / 43.95 | 1055 | 0.9714 / 0.9695 | 0.9898 / 0.9883 | 2.35 (1.07 / 1.10) | 91.5 / 92.8 %, 79.1 %, 55.3 %, 109 | 1.23 / 1.46 | 6.87 |
| `dbt12_c` 12bit | 1 | 40 | 1265.9 | 42.76 / 42.56 / 42.54 | 1416 | 0.9670 / 0.9634 | 0.9855 / 0.9835 | 2.70 (1.07 / 1.10) | 92.6 / 93.6 %, 81.2 %, 58.9 %, 134 | 1.63 / 1.89 | 5.69 |
| `dbt12_c` 12bit | 1 | 56 | 3476.0 | 38.68 / 38.27 / 38.21 | 2363 | 0.9398 / 0.9111 | 0.9698 / 0.9656 | 4.08 (1.08 / 1.11) | 94.7 / 95.0 %, 85.4 %, 68.1 %, 228 | 2.98 / 3.28 | 3.5 |
| `dbt12_c` 12bit | 16 | 1 | 4.8 | 72.77 / 72.54 / 72.51 | 41 | 1.0000 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 18.5 / 19.1 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.02 | 10.0 |
| `dbt12_c` 12bit | 16 | 2 | 6.4 | 66.38 / 66.07 / 66.07 | 72 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.21) | 38.3 / 39.2 %, 2.4 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbt12_c` 12bit | 16 | 4 | 10.4 | 58.78 / 58.54 / 58.53 | 125 | 0.9988 / 0.9987 | 0.9998 / 0.9998 | 0.45 (0.45 / 0.48) | 65.5 / 66.7 %, 24.2 %, 1.9 %, 9 | 0.10 / 0.12 | 9.98 |
| `dbt12_c` 12bit | 16 | 8 | 28.6 | 50.98 / 50.84 / 50.73 | 218 | 0.9926 / 0.9920 | 0.9990 / 0.9988 | 1.10 (0.94 / 0.96) | 83.4 / 85.2 %, 59.8 %, 26.0 %, 26 | 0.25 / 0.30 | 9.84 |
| `dbt12_c` 12bit | 16 | 12 | 90.1 | 47.71 / 47.56 / 47.46 | 408 | 0.9842 / 0.9830 | 0.9973 / 0.9969 | 1.59 (1.06 / 1.09) | 87.6 / 89.4 %, 70.4 %, 41.6 %, 44 | 0.44 / 0.52 | 9.5 |
| `dbt12_c` 12bit | 16 | 16 | 246.5 | 46.32 / 46.16 / 46.13 | 409 | 0.9788 / 0.9774 | 0.9955 / 0.9949 | 1.86 (1.07 / 1.10) | 89.1 / 90.8 %, 73.8 %, 46.9 %, 54 | 0.62 / 0.74 | 8.97 |
| `dbt12_c` 12bit | 16 | 24 | 793.8 | 45.06 / 44.82 / 44.73 | 519 | 0.9741 / 0.9723 | 0.9924 / 0.9910 | 2.15 (1.07 / 1.10) | 90.5 / 92.0 %, 77.1 %, 52.0 %, 68 | 0.97 / 1.18 | 7.83 |
| `dbt12_c` 12bit | 16 | 32 | 2062.6 | 43.87 / 43.65 / 43.62 | 668 | 0.9722 / 0.9701 | 0.9889 / 0.9872 | 2.43 (1.07 / 1.10) | 91.8 / 93.0 %, 79.6 %, 56.2 %, 85 | 1.33 / 1.59 | 6.69 |
| `dbt12_c` 12bit | 16 | 40 | 4461.6 | 42.35 / 41.96 / 41.91 | 1140 | 0.9674 / 0.9657 | 0.9839 / 0.9820 | 2.85 (1.07 / 1.10) | 93.0 / 93.9 %, 82.1 %, 60.9 %, 149 | 1.82 / 2.09 | 5.52 |
| `dbt12_c` 12bit | 16 | 56 | 15856.9 | 38.08 / 37.18 / 37.02 | 2284 | 0.9354 / 0.9224 | 0.9657 / 0.9609 | 4.52 (1.07 / 1.10) | 95.1 / 95.6 %, 86.9 %, 71.3 %, 217 | 3.42 / 3.95 | 3.25 |
| `dbt12_c` 12bit | 8 | 1 | 4.8 | 72.77 / 72.54 / 72.51 | 43 | 1.0000 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 18.5 / 19.1 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.02 | 10.0 |
| `dbt12_c` 12bit | 8 | 2 | 6.4 | 66.42 / 66.08 / 66.07 | 72 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.21) | 38.2 / 39.2 %, 2.4 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbt12_c` 12bit | 8 | 4 | 10.4 | 58.78 / 58.54 / 58.53 | 125 | 0.9988 / 0.9987 | 0.9998 / 0.9998 | 0.45 (0.45 / 0.48) | 65.6 / 66.7 %, 24.2 %, 1.9 %, 10 | 0.10 / 0.12 | 9.98 |
| `dbt12_c` 12bit | 8 | 8 | 28.6 | 50.98 / 50.80 / 50.73 | 282 | 0.9926 / 0.9920 | 0.9990 / 0.9988 | 1.10 (0.94 / 0.96) | 83.5 / 85.2 %, 59.8 %, 26.0 %, 26 | 0.25 / 0.30 | 9.84 |
| `dbt12_c` 12bit | 8 | 12 | 89.6 | 47.68 / 47.53 / 47.45 | 359 | 0.9842 / 0.9830 | 0.9972 / 0.9969 | 1.59 (1.06 / 1.09) | 87.6 / 89.4 %, 70.4 %, 41.6 %, 42 | 0.44 / 0.52 | 9.5 |
| `dbt12_c` 12bit | 8 | 16 | 240.0 | 46.32 / 46.16 / 46.13 | 393 | 0.9788 / 0.9774 | 0.9955 / 0.9949 | 1.86 (1.07 / 1.10) | 89.1 / 90.8 %, 73.8 %, 46.9 %, 59 | 0.62 / 0.74 | 8.97 |
| `dbt12_c` 12bit | 8 | 24 | 757.2 | 45.07 / 44.80 / 44.73 | 533 | 0.9741 / 0.9723 | 0.9924 / 0.9910 | 2.14 (1.07 / 1.10) | 90.5 / 92.0 %, 77.1 %, 52.0 %, 94 | 0.97 / 1.18 | 7.87 |
| `dbt12_c` 12bit | 8 | 32 | 1892.0 | 43.92 / 43.65 / 43.61 | 659 | 0.9717 / 0.9695 | 0.9890 / 0.9872 | 2.42 (1.07 / 1.10) | 91.7 / 93.0 %, 79.6 %, 56.2 %, 104 | 1.33 / 1.59 | 6.72 |
| `dbt12_c` 12bit | 8 | 40 | 3992.8 | 42.50 / 42.00 / 41.86 | 1140 | 0.9665 / 0.9634 | 0.9843 / 0.9818 | 2.83 (1.07 / 1.10) | 92.8 / 93.9 %, 82.0 %, 60.3 %, 128 | 1.78 / 2.10 | 5.46 |
| `dbt12_c` 12bit | 8 | 56 | 13426.0 | 38.35 / 37.36 / 37.17 | 2284 | 0.9354 / 0.9166 | 0.9675 / 0.9614 | 4.28 (1.07 / 1.10) | 95.0 / 95.3 %, 86.4 %, 71.0 %, 224 | 3.20 / 3.90 | 3.33 |
| `dbt12_c` top10 | 1 | 1 | 5.7 | 65.95 / 65.73 / 65.73 | 45 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.20 (0.19 / 0.21) | 38.9 / 39.9 %, 3.5 %, 0.0 %, 4 | 0.06 / 0.07 | — |
| `dbt12_c` top10 | 1 | 2 | 7.5 | 62.48 / 62.26 / 62.26 | 50 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 52.7 / 53.6 %, 10.4 %, 0.1 %, 6 | 0.08 / 0.09 | — |
| `dbt12_c` top10 | 1 | 4 | 11.9 | 57.05 / 56.84 / 56.83 | 93 | 0.9982 / 0.9981 | 0.9998 / 0.9997 | 0.55 (0.54 / 0.57) | 70.6 / 71.9 %, 32.3 %, 4.5 %, 12 | 0.13 / 0.15 | — |
| `dbt12_c` top10 | 1 | 8 | 30.3 | 50.54 / 50.40 / 50.39 | 291 | 0.9918 / 0.9914 | 0.9988 / 0.9987 | 1.15 (0.96 / 0.98) | 84.1 / 85.9 %, 61.4 %, 28.0 %, 29 | 0.27 / 0.32 | — |
| `dbt12_c` top10 | 1 | 12 | 75.8 | 47.69 / 47.55 / 47.53 | 365 | 0.9843 / 0.9835 | 0.9973 / 0.9970 | 1.60 (1.06 / 1.08) | 87.6 / 89.4 %, 70.4 %, 41.4 %, 42 | 0.44 / 0.52 | — |
| `dbt12_c` top10 | 1 | 16 | 145.7 | 46.50 / 46.34 / 46.31 | 395 | 0.9799 / 0.9786 | 0.9958 / 0.9953 | 1.83 (1.07 / 1.10) | 89.0 / 90.6 %, 73.5 %, 46.4 %, 60 | 0.59 / 0.70 | — |
| `dbt12_c` top10 | 1 | 24 | 312.3 | 45.44 / 45.25 / 45.23 | 547 | 0.9759 / 0.9743 | 0.9935 / 0.9926 | 2.06 (1.07 / 1.10) | 90.2 / 91.6 %, 76.1 %, 50.5 %, 88 | 0.85 / 1.00 | — |
| `dbt12_c` top10 | 1 | 32 | 609.9 | 44.45 / 44.26 / 44.24 | 860 | 0.9734 / 0.9713 | 0.9907 / 0.9894 | 2.29 (1.07 / 1.11) | 91.3 / 92.6 %, 78.5 %, 54.3 %, 104 | 1.14 / 1.36 | — |
| `dbt12_c` top10 | 1 | 40 | 1062.4 | 43.31 / 43.14 / 43.13 | 1416 | 0.9690 / 0.9662 | 0.9871 / 0.9852 | 2.57 (1.08 / 1.11) | 92.2 / 93.4 %, 80.6 %, 57.8 %, 123 | 1.48 / 1.75 | — |
| `dbt12_c` top10 | 1 | 56 | 2870.8 | 39.91 / 39.52 / 39.43 | 2302 | 0.9492 / 0.9355 | 0.9741 / 0.9711 | 3.64 (1.08 / 1.11) | 94.2 / 94.6 %, 84.1 %, 65.6 %, 202 | 2.59 / 2.80 | — |
| `dbt12_c` top10 | 16 | 1 | 5.9 | 65.62 / 65.35 / 65.33 | 69 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.20 / 0.21) | 40.2 / 41.1 %, 4.0 %, 0.0 %, 5 | 0.06 / 0.08 | — |
| `dbt12_c` top10 | 16 | 2 | 7.5 | 62.45 / 62.19 / 62.18 | 85 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 52.9 / 53.8 %, 10.6 %, 0.1 %, 7 | 0.08 / 0.10 | — |
| `dbt12_c` top10 | 16 | 4 | 11.9 | 56.99 / 56.76 / 56.74 | 167 | 0.9982 / 0.9980 | 0.9998 / 0.9997 | 0.55 (0.54 / 0.58) | 70.8 / 72.2 %, 32.5 %, 4.7 %, 12 | 0.13 / 0.15 | — |
| `dbt12_c` top10 | 16 | 8 | 30.6 | 50.64 / 50.49 / 50.40 | 248 | 0.9920 / 0.9915 | 0.9988 / 0.9987 | 1.14 (0.95 / 0.98) | 84.0 / 85.8 %, 61.1 %, 27.8 %, 29 | 0.27 / 0.32 | — |
| `dbt12_c` top10 | 16 | 12 | 84.0 | 47.79 / 47.65 / 47.56 | 365 | 0.9847 / 0.9836 | 0.9973 / 0.9970 | 1.58 (1.06 / 1.09) | 87.6 / 89.3 %, 70.2 %, 41.1 %, 45 | 0.44 / 0.52 | — |
| `dbt12_c` top10 | 16 | 16 | 211.7 | 46.49 / 46.30 / 46.29 | 367 | 0.9799 / 0.9786 | 0.9957 / 0.9952 | 1.83 (1.07 / 1.10) | 89.0 / 90.6 %, 73.5 %, 46.4 %, 54 | 0.61 / 0.73 | — |
| `dbt12_c` top10 | 16 | 24 | 624.9 | 45.35 / 45.14 / 45.06 | 508 | 0.9759 / 0.9741 | 0.9933 / 0.9921 | 2.08 (1.07 / 1.10) | 90.2 / 91.7 %, 76.3 %, 50.9 %, 65 | 0.88 / 1.08 | — |
| `dbt12_c` top10 | 16 | 32 | 1602.7 | 44.33 / 44.10 / 44.06 | 572 | 0.9735 / 0.9715 | 0.9903 / 0.9887 | 2.32 (1.08 / 1.11) | 91.4 / 92.7 %, 78.8 %, 54.8 %, 73 | 1.20 / 1.43 | — |
| `dbt12_c` top10 | 16 | 40 | 3326.0 | 43.15 / 42.88 / 42.80 | 769 | 0.9702 / 0.9684 | 0.9865 / 0.9846 | 2.62 (1.08 / 1.11) | 92.4 / 93.5 %, 81.0 %, 58.6 %, 114 | 1.55 / 1.83 | — |
| `dbt12_c` top10 | 16 | 56 | 11981.7 | 39.57 / 38.95 / 38.88 | 1907 | 0.9510 / 0.9464 | 0.9729 / 0.9691 | 3.82 (1.08 / 1.11) | 94.5 / 94.9 %, 85.0 %, 67.3 %, 212 | 2.77 / 3.05 | — |
| `dbt12_c` top10 | 8 | 1 | 5.9 | 65.66 / 65.35 / 65.33 | 69 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.20 / 0.21) | 40.2 / 41.1 %, 4.0 %, 0.0 %, 5 | 0.06 / 0.08 | — |
| `dbt12_c` top10 | 8 | 2 | 7.5 | 62.45 / 62.20 / 62.19 | 90 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 52.9 / 53.8 %, 10.6 %, 0.1 %, 7 | 0.08 / 0.10 | — |
| `dbt12_c` top10 | 8 | 4 | 11.9 | 56.99 / 56.76 / 56.75 | 132 | 0.9982 / 0.9980 | 0.9998 / 0.9997 | 0.55 (0.54 / 0.58) | 70.8 / 72.2 %, 32.5 %, 4.7 %, 13 | 0.13 / 0.15 | — |
| `dbt12_c` top10 | 8 | 8 | 30.5 | 50.64 / 50.45 / 50.40 | 241 | 0.9920 / 0.9915 | 0.9988 / 0.9987 | 1.14 (0.95 / 0.98) | 84.0 / 85.8 %, 61.1 %, 27.8 %, 32 | 0.27 / 0.32 | — |
| `dbt12_c` top10 | 8 | 12 | 83.5 | 47.77 / 47.61 / 47.55 | 365 | 0.9847 / 0.9836 | 0.9973 / 0.9970 | 1.58 (1.06 / 1.09) | 87.6 / 89.3 %, 70.2 %, 41.1 %, 42 | 0.44 / 0.52 | — |
| `dbt12_c` top10 | 8 | 16 | 207.0 | 46.49 / 46.31 / 46.29 | 394 | 0.9799 / 0.9786 | 0.9957 / 0.9952 | 1.83 (1.07 / 1.10) | 89.0 / 90.6 %, 73.5 %, 46.4 %, 57 | 0.61 / 0.73 | — |
| `dbt12_c` top10 | 8 | 24 | 599.5 | 45.36 / 45.12 / 45.06 | 508 | 0.9759 / 0.9741 | 0.9933 / 0.9921 | 2.08 (1.07 / 1.10) | 90.2 / 91.7 %, 76.3 %, 50.9 %, 76 | 0.87 / 1.08 | — |
| `dbt12_c` top10 | 8 | 32 | 1476.9 | 44.34 / 44.10 / 44.06 | 580 | 0.9735 / 0.9714 | 0.9904 / 0.9887 | 2.31 (1.08 / 1.11) | 91.4 / 92.7 %, 78.8 %, 54.8 %, 99 | 1.19 / 1.43 | — |
| `dbt12_c` top10 | 8 | 40 | 2993.3 | 43.17 / 42.90 / 42.84 | 781 | 0.9689 / 0.9676 | 0.9866 / 0.9846 | 2.61 (1.08 / 1.11) | 92.3 / 93.5 %, 81.0 %, 58.5 %, 112 | 1.54 / 1.83 | — |
| `dbt12_c` top10 | 8 | 56 | 10215.7 | 39.72 / 39.06 / 39.01 | 1987 | 0.9498 / 0.9358 | 0.9725 / 0.9694 | 3.76 (1.08 / 1.11) | 94.4 / 94.7 %, 84.6 %, 67.2 %, 199 | 2.73 / 3.04 | — |
| `dbt12_c` window | 1 | 1 | 3.9 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 22.2 / 24.4 %, 16.8 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 1 | 2 | 4.8 | 7.61 / 6.85 / 6.76 | 2491 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 27.4 / 29.4 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 1 | 4 | 6.1 | 7.61 / 6.85 / 6.76 | 2493 | 0.5197 / 0.4218 | 0.8687 / 0.8384 | 6.26 (0.40 / 0.43) | 38.4 / 40.2 %, 17.3 %, 14.2 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 1 | 8 | 8.5 | 7.61 / 6.85 / 6.76 | 2497 | 0.5194 / 0.4215 | 0.8687 / 0.8384 | 6.27 (0.45 / 0.48) | 59.6 / 61.1 %, 23.3 %, 14.4 %, 31 | 4.67 / 5.88 | — |
| `dbt12_c` window | 1 | 12 | 11.1 | 7.61 / 6.85 / 6.76 | 2499 | 0.5189 / 0.4210 | 0.8686 / 0.8383 | 6.28 (0.53 / 0.56) | 72.3 / 73.3 %, 36.0 %, 15.5 %, 32 | 4.67 / 5.89 | — |
| `dbt12_c` window | 1 | 16 | 14.0 | 7.61 / 6.85 / 6.76 | 2506 | 0.5181 / 0.4203 | 0.8685 / 0.8382 | 6.29 (0.63 / 0.66) | 79.2 / 79.9 %, 47.3 %, 18.9 %, 43 | 4.68 / 5.89 | — |
| `dbt12_c` window | 1 | 24 | 21.3 | 7.61 / 6.85 / 6.76 | 2508 | 0.5159 / 0.4183 | 0.8682 / 0.8380 | 6.33 (0.81 / 0.84) | 85.9 / 86.4 %, 61.8 %, 29.4 %, 42 | 4.68 / 5.89 | — |
| `dbt12_c` window | 1 | 32 | 49.6 | 7.61 / 6.84 / 6.76 | 2514 | 0.5101 / 0.4128 | 0.8672 / 0.8372 | 6.40 (1.03 / 1.05) | 90.7 / 91.1 %, 74.0 %, 45.8 %, 73 | 4.69 / 5.91 | — |
| `dbt12_c` window | 1 | 40 | 161.9 | 7.60 / 6.84 / 6.76 | 2526 | 0.5027 / 0.4057 | 0.8653 / 0.8355 | 6.51 (1.07 / 1.10) | 92.8 / 93.1 %, 79.6 %, 55.7 %, 90 | 4.72 / 5.94 | — |
| `dbt12_c` window | 1 | 56 | 1089.6 | 7.60 / 6.84 / 6.76 | 2565 | 0.4965 / 0.4008 | 0.8598 / 0.8308 | 6.70 (1.07 / 1.10) | 94.4 / 94.7 %, 84.2 %, 64.3 %, 147 | 4.87 / 6.10 | — |
| `dbt12_c` window | 16 | 1 | 4.0 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 22.5 / 24.8 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 16 | 2 | 4.8 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 27.5 / 29.7 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 16 | 4 | 6.1 | 7.61 / 6.85 / 6.76 | 2493 | 0.5197 / 0.4218 | 0.8687 / 0.8385 | 6.26 (0.40 / 0.43) | 38.7 / 40.7 %, 17.3 %, 14.2 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 16 | 8 | 8.5 | 7.61 / 6.85 / 6.76 | 2495 | 0.5194 / 0.4215 | 0.8687 / 0.8384 | 6.27 (0.45 / 0.48) | 59.9 / 61.4 %, 23.5 %, 14.4 %, 31 | 4.67 / 5.88 | — |
| `dbt12_c` window | 16 | 12 | 11.1 | 7.61 / 6.85 / 6.76 | 2499 | 0.5188 / 0.4210 | 0.8686 / 0.8383 | 6.28 (0.53 / 0.56) | 72.6 / 73.6 %, 36.4 %, 15.6 %, 31 | 4.67 / 5.89 | — |
| `dbt12_c` window | 16 | 16 | 14.0 | 7.61 / 6.85 / 6.76 | 2500 | 0.5181 / 0.4203 | 0.8685 / 0.8383 | 6.29 (0.63 / 0.66) | 79.3 / 80.0 %, 47.5 %, 19.1 %, 41 | 4.68 / 5.89 | — |
| `dbt12_c` window | 16 | 24 | 21.3 | 7.61 / 6.85 / 6.76 | 2512 | 0.5160 / 0.4184 | 0.8682 / 0.8380 | 6.32 (0.81 / 0.84) | 85.8 / 86.3 %, 61.6 %, 29.3 %, 38 | 4.68 / 5.89 | — |
| `dbt12_c` window | 16 | 32 | 50.1 | 7.61 / 6.84 / 6.76 | 2514 | 0.5105 / 0.4131 | 0.8673 / 0.8372 | 6.40 (1.02 / 1.05) | 90.5 / 91.0 %, 73.9 %, 45.7 %, 63 | 4.69 / 5.90 | — |
| `dbt12_c` window | 16 | 40 | 213.4 | 7.60 / 6.84 / 6.76 | 2511 | 0.5027 / 0.4059 | 0.8653 / 0.8355 | 6.51 (1.07 / 1.10) | 92.8 / 93.1 %, 79.7 %, 55.8 %, 53 | 4.73 / 5.94 | — |
| `dbt12_c` window | 16 | 56 | 2885.2 | 7.60 / 6.84 / 6.76 | 2555 | 0.4965 / 0.4007 | 0.8598 / 0.8307 | 6.69 (1.07 / 1.10) | 94.5 / 94.7 %, 84.3 %, 64.6 %, 111 | 4.86 / 6.10 | — |
| `dbt12_c` window | 8 | 1 | 4.0 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 22.5 / 24.8 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 8 | 2 | 4.8 | 7.61 / 6.85 / 6.76 | 2490 | 0.5198 / 0.4218 | 0.8688 / 0.8385 | 6.26 (0.39 / 0.42) | 27.5 / 29.7 %, 16.9 %, 14.0 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 8 | 4 | 6.1 | 7.61 / 6.85 / 6.76 | 2493 | 0.5197 / 0.4218 | 0.8687 / 0.8385 | 6.26 (0.40 / 0.43) | 38.7 / 40.8 %, 17.3 %, 14.2 %, 30 | 4.67 / 5.88 | — |
| `dbt12_c` window | 8 | 8 | 8.5 | 7.61 / 6.85 / 6.76 | 2497 | 0.5194 / 0.4215 | 0.8687 / 0.8384 | 6.27 (0.45 / 0.48) | 60.0 / 61.5 %, 23.5 %, 14.4 %, 31 | 4.67 / 5.88 | — |
| `dbt12_c` window | 8 | 12 | 11.1 | 7.61 / 6.85 / 6.76 | 2498 | 0.5188 / 0.4210 | 0.8686 / 0.8383 | 6.28 (0.53 / 0.56) | 72.6 / 73.5 %, 36.4 %, 15.6 %, 32 | 4.67 / 5.89 | — |
| `dbt12_c` window | 8 | 16 | 14.0 | 7.61 / 6.85 / 6.76 | 2504 | 0.5181 / 0.4203 | 0.8685 / 0.8383 | 6.29 (0.63 / 0.66) | 79.3 / 80.0 %, 47.6 %, 19.1 %, 35 | 4.68 / 5.89 | — |
| `dbt12_c` window | 8 | 24 | 21.3 | 7.61 / 6.85 / 6.76 | 2509 | 0.5160 / 0.4184 | 0.8682 / 0.8380 | 6.32 (0.81 / 0.84) | 85.8 / 86.3 %, 61.6 %, 29.4 %, 34 | 4.68 / 5.89 | — |
| `dbt12_c` window | 8 | 32 | 50.1 | 7.61 / 6.84 / 6.76 | 2508 | 0.5105 / 0.4131 | 0.8673 / 0.8372 | 6.40 (1.02 / 1.05) | 90.6 / 91.0 %, 73.9 %, 45.7 %, 43 | 4.69 / 5.90 | — |
| `dbt12_c` window | 8 | 40 | 211.1 | 7.60 / 6.84 / 6.76 | 2518 | 0.5027 / 0.4059 | 0.8653 / 0.8355 | 6.51 (1.07 / 1.10) | 92.8 / 93.1 %, 79.7 %, 55.8 %, 64 | 4.73 / 5.94 | — |
| `dbt12_c` window | 8 | 56 | 2691.3 | 7.60 / 6.84 / 6.76 | 2555 | 0.4965 / 0.4007 | 0.8598 / 0.8307 | 6.69 (1.07 / 1.10) | 94.5 / 94.7 %, 84.3 %, 64.6 %, 103 | 4.86 / 6.10 | — |
| `dbt12_ea1141` 12bit | 1 | 1 | 3.9 | 71.81 / 71.76 / 71.75 | 14 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 29.0 / 29.2 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbt12_ea1141` 12bit | 1 | 2 | 5.1 | 65.87 / 65.83 / 65.83 | 19 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.23 / 0.24) | 51.7 / 52.1 %, 8.8 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbt12_ea1141` 12bit | 1 | 4 | 8.7 | 58.02 / 57.97 / 57.97 | 50 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.55 (0.55 / 0.56) | 76.3 / 76.7 %, 41.7 %, 9.1 %, 14 | 0.11 / 0.13 | 9.96 |
| `dbt12_ea1141` 12bit | 1 | 8 | 25.9 | 50.17 / 50.11 / 50.11 | 165 | 0.9908 / 0.9907 | 0.9986 / 0.9986 | 1.36 (0.97 / 0.99) | 89.5 / 90.0 %, 71.9 %, 43.3 %, 37 | 0.30 / 0.37 | 9.69 |
| `dbt12_ea1141` 12bit | 1 | 12 | 68.5 | 47.14 / 47.06 / 47.05 | 197 | 0.9816 / 0.9812 | 0.9964 / 0.9962 | 1.93 (1.03 / 1.05) | 92.4 / 92.8 %, 79.7 %, 56.6 %, 54 | 0.53 / 0.64 | 9.06 |
| `dbt12_ea1141` 12bit | 1 | 16 | 148.1 | 45.72 / 45.65 / 45.64 | 277 | 0.9752 / 0.9747 | 0.9941 / 0.9935 | 2.26 (1.04 / 1.05) | 93.5 / 93.7 %, 82.3 %, 61.6 %, 81 | 0.74 / 0.93 | 8.26 |
| `dbt12_ea1141` 12bit | 1 | 24 | 352.1 | 44.56 / 44.47 / 44.46 | 404 | 0.9699 / 0.9692 | 0.9909 / 0.9903 | 2.56 (1.04 / 1.05) | 94.2 / 94.4 %, 83.9 %, 65.1 %, 98 | 1.07 / 1.24 | 6.91 |
| `dbt12_ea1141` 12bit | 1 | 32 | 658.3 | 43.58 / 43.22 / 43.21 | 540 | 0.9667 / 0.9651 | 0.9872 / 0.9864 | 2.84 (1.04 / 1.05) | 94.7 / 94.9 %, 85.5 %, 68.2 %, 144 | 1.44 / 1.54 | 5.74 |
| `dbt12_ea1141` 12bit | 1 | 40 | 1111.5 | 42.27 / 41.68 / 41.64 | 995 | 0.9621 / 0.9566 | 0.9817 / 0.9802 | 3.26 (1.04 / 1.05) | 95.4 / 95.6 %, 87.3 %, 71.9 %, 127 | 1.90 / 2.01 | 4.42 |
| `dbt12_ea1141` 12bit | 1 | 56 | 2497.8 | 38.37 / 37.89 / 37.76 | 1374 | 0.9359 / 0.9204 | 0.9634 / 0.9591 | 4.72 (1.05 / 1.06) | 96.7 / 96.9 %, 91.0 %, 79.7 %, 200 | 3.28 / 3.76 | 2.16 |
| `dbt12_ea1141` 12bit | 16 | 1 | 3.9 | 71.80 / 71.76 / 71.74 | 25 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 29.0 / 29.3 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbt12_ea1141` 12bit | 16 | 2 | 5.1 | 65.88 / 65.84 / 65.84 | 50 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.23 / 0.24) | 51.6 / 52.1 %, 8.8 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbt12_ea1141` 12bit | 16 | 4 | 8.7 | 58.05 / 57.99 / 57.89 | 95 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.55 (0.55 / 0.56) | 76.3 / 76.7 %, 41.7 %, 9.2 %, 13 | 0.11 / 0.13 | 9.96 |
| `dbt12_ea1141` 12bit | 16 | 8 | 26.0 | 50.26 / 50.18 / 50.13 | 163 | 0.9910 / 0.9908 | 0.9987 / 0.9986 | 1.35 (0.97 / 0.98) | 89.4 / 89.9 %, 72.0 %, 43.3 %, 33 | 0.30 / 0.37 | 9.68 |
| `dbt12_ea1141` 12bit | 16 | 12 | 76.7 | 47.19 / 47.08 / 47.06 | 250 | 0.9819 / 0.9814 | 0.9965 / 0.9962 | 1.92 (1.03 / 1.05) | 92.3 / 92.7 %, 79.4 %, 56.2 %, 49 | 0.53 / 0.64 | 9.08 |
| `dbt12_ea1141` 12bit | 16 | 16 | 214.3 | 45.69 / 45.59 / 45.56 | 376 | 0.9751 / 0.9747 | 0.9939 / 0.9935 | 2.26 (1.04 / 1.05) | 93.4 / 93.7 %, 82.3 %, 61.9 %, 67 | 0.75 / 0.94 | 8.16 |
| `dbt12_ea1141` 12bit | 16 | 24 | 775.4 | 44.31 / 44.19 / 44.17 | 469 | 0.9696 / 0.9690 | 0.9897 / 0.9890 | 2.64 (1.04 / 1.05) | 94.3 / 94.5 %, 84.4 %, 66.0 %, 98 | 1.19 / 1.37 | 6.53 |
| `dbt12_ea1141` 12bit | 16 | 32 | 1844.1 | 43.22 / 42.87 / 42.85 | 488 | 0.9662 / 0.9645 | 0.9855 / 0.9847 | 2.96 (1.04 / 1.05) | 94.9 / 95.2 %, 86.2 %, 69.5 %, 101 | 1.58 / 1.74 | 5.44 |
| `dbt12_ea1141` 12bit | 16 | 40 | 4129.9 | 41.78 / 41.23 / 40.90 | 694 | 0.9623 / 0.9577 | 0.9796 / 0.9773 | 3.41 (1.04 / 1.05) | 95.6 / 95.9 %, 88.0 %, 73.4 %, 110 | 2.06 / 2.25 | 4.11 |
| `dbt12_ea1141` 12bit | 16 | 56 | 13671.4 | 37.76 / 36.60 / 36.46 | 1364 | 0.9391 / 0.9331 | 0.9607 / 0.9518 | 5.11 (1.04 / 1.06) | 96.9 / 97.2 %, 91.9 %, 81.7 %, 192 | 3.69 / 4.52 | 1.51 |
| `dbt12_ea1141` 12bit | 8 | 1 | 3.9 | 71.80 / 71.77 / 71.76 | 27 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 29.0 / 29.3 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbt12_ea1141` 12bit | 8 | 2 | 5.1 | 65.88 / 65.83 / 65.83 | 61 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.23 / 0.24) | 51.7 / 52.1 %, 8.8 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbt12_ea1141` 12bit | 8 | 4 | 8.7 | 58.05 / 58.00 / 57.98 | 86 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.55 (0.55 / 0.56) | 76.2 / 76.8 %, 41.7 %, 9.1 %, 13 | 0.11 / 0.13 | 9.96 |
| `dbt12_ea1141` 12bit | 8 | 8 | 26.0 | 50.25 / 50.18 / 50.13 | 163 | 0.9910 / 0.9908 | 0.9987 / 0.9986 | 1.35 (0.97 / 0.98) | 89.4 / 89.9 %, 71.9 %, 43.2 %, 36 | 0.30 / 0.37 | 9.69 |
| `dbt12_ea1141` 12bit | 8 | 12 | 76.3 | 47.18 / 47.10 / 47.06 | 242 | 0.9819 / 0.9814 | 0.9965 / 0.9962 | 1.91 (1.03 / 1.05) | 92.4 / 92.7 %, 79.5 %, 56.5 %, 53 | 0.53 / 0.64 | 9.07 |
| `dbt12_ea1141` 12bit | 8 | 16 | 207.1 | 45.70 / 45.60 / 45.59 | 376 | 0.9752 / 0.9748 | 0.9940 / 0.9935 | 2.27 (1.04 / 1.05) | 93.5 / 93.8 %, 82.3 %, 61.8 %, 60 | 0.75 / 0.94 | 8.2 |
| `dbt12_ea1141` 12bit | 8 | 24 | 718.8 | 44.33 / 44.20 / 44.14 | 469 | 0.9696 / 0.9688 | 0.9897 / 0.9892 | 2.63 (1.04 / 1.05) | 94.3 / 94.6 %, 84.6 %, 66.0 %, 95 | 1.18 / 1.39 | 6.56 |
| `dbt12_ea1141` 12bit | 8 | 32 | 1684.7 | 43.24 / 42.90 / 42.85 | 488 | 0.9664 / 0.9645 | 0.9860 / 0.9847 | 2.94 (1.04 / 1.05) | 94.9 / 95.2 %, 86.1 %, 69.3 %, 102 | 1.56 / 1.72 | 5.45 |
| `dbt12_ea1141` 12bit | 8 | 40 | 3677.2 | 41.91 / 41.25 / 41.12 | 694 | 0.9618 / 0.9577 | 0.9808 / 0.9773 | 3.41 (1.04 / 1.05) | 95.6 / 95.9 %, 88.0 %, 73.5 %, 125 | 2.05 / 2.28 | 4.06 |
| `dbt12_ea1141` 12bit | 8 | 56 | 10719.9 | 38.15 / 37.19 / 37.08 | 1364 | 0.9352 / 0.9279 | 0.9627 / 0.9545 | 5.03 (1.04 / 1.06) | 96.9 / 97.1 %, 91.6 %, 81.0 %, 229 | 3.66 / 4.34 | 1.78 |
| `dbt12_ea1141` top10 | 1 | 1 | 4.7 | 65.04 / 64.99 / 64.99 | 19 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.24 / 0.25) | 50.7 / 51.2 %, 12.2 %, 0.1 %, 6 | 0.07 / 0.08 | — |
| `dbt12_ea1141` top10 | 1 | 2 | 6.3 | 61.56 / 61.52 / 61.51 | 29 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.37 (0.37 / 0.38) | 65.4 / 65.9 %, 25.0 %, 1.8 %, 8 | 0.09 / 0.11 | — |
| `dbt12_ea1141` top10 | 1 | 4 | 10.0 | 56.23 / 56.19 / 56.18 | 71 | 0.9978 / 0.9977 | 0.9997 / 0.9997 | 0.68 (0.65 / 0.67) | 80.2 / 80.7 %, 49.6 %, 15.3 %, 16 | 0.15 / 0.18 | — |
| `dbt12_ea1141` top10 | 1 | 8 | 27.6 | 49.87 / 49.81 / 49.81 | 164 | 0.9902 / 0.9901 | 0.9985 / 0.9984 | 1.41 (0.99 / 1.00) | 89.8 / 90.3 %, 72.9 %, 44.7 %, 37 | 0.33 / 0.39 | — |
| `dbt12_ea1141` top10 | 1 | 12 | 65.0 | 47.22 / 47.13 / 47.11 | 173 | 0.9821 / 0.9818 | 0.9965 / 0.9963 | 1.91 (1.04 / 1.05) | 92.3 / 92.7 %, 79.4 %, 56.2 %, 50 | 0.52 / 0.63 | — |
| `dbt12_ea1141` top10 | 1 | 16 | 127.6 | 45.93 / 45.86 / 45.85 | 260 | 0.9765 / 0.9760 | 0.9945 / 0.9941 | 2.21 (1.04 / 1.06) | 93.3 / 93.6 %, 81.9 %, 61.0 %, 58 | 0.71 / 0.87 | — |
| `dbt12_ea1141` top10 | 1 | 24 | 305.4 | 44.76 / 44.68 / 44.66 | 360 | 0.9712 / 0.9707 | 0.9914 / 0.9910 | 2.51 (1.04 / 1.06) | 94.1 / 94.3 %, 83.7 %, 64.5 %, 95 | 1.02 / 1.19 | — |
| `dbt12_ea1141` top10 | 1 | 32 | 571.2 | 43.85 / 43.62 / 43.61 | 446 | 0.9679 / 0.9671 | 0.9881 / 0.9875 | 2.76 (1.05 / 1.06) | 94.6 / 94.8 %, 85.1 %, 67.5 %, 99 | 1.35 / 1.45 | — |
| `dbt12_ea1141` top10 | 1 | 40 | 943.2 | 42.73 / 42.27 / 42.23 | 745 | 0.9637 / 0.9602 | 0.9837 / 0.9825 | 3.11 (1.05 / 1.06) | 95.2 / 95.3 %, 86.7 %, 70.6 %, 102 | 1.72 / 1.83 | — |
| `dbt12_ea1141` top10 | 1 | 56 | 2110.6 | 39.61 / 38.98 / 38.91 | 1380 | 0.9468 / 0.9379 | 0.9685 / 0.9653 | 4.26 (1.05 / 1.06) | 96.4 / 96.5 %, 90.0 %, 77.9 %, 187 | 2.85 / 3.23 | — |
| `dbt12_ea1141` top10 | 16 | 1 | 4.7 | 65.04 / 65.00 / 64.99 | 53 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.24 / 0.25) | 50.7 / 51.2 %, 12.1 %, 0.1 %, 6 | 0.07 / 0.08 | — |
| `dbt12_ea1141` top10 | 16 | 2 | 6.2 | 61.59 / 61.53 / 61.52 | 56 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.37 (0.36 / 0.38) | 65.4 / 65.9 %, 25.0 %, 1.8 %, 9 | 0.09 / 0.11 | — |
| `dbt12_ea1141` top10 | 16 | 4 | 10.0 | 56.24 / 56.12 / 56.10 | 106 | 0.9978 / 0.9977 | 0.9997 / 0.9997 | 0.68 (0.65 / 0.67) | 80.1 / 80.7 %, 49.8 %, 15.8 %, 17 | 0.15 / 0.18 | — |
| `dbt12_ea1141` top10 | 16 | 8 | 27.7 | 49.94 / 49.86 / 49.81 | 186 | 0.9904 / 0.9902 | 0.9985 / 0.9984 | 1.40 (0.99 / 1.00) | 89.8 / 90.2 %, 72.7 %, 44.5 %, 37 | 0.33 / 0.39 | — |
| `dbt12_ea1141` top10 | 16 | 12 | 71.8 | 47.28 / 47.15 / 47.11 | 221 | 0.9823 / 0.9820 | 0.9965 / 0.9963 | 1.90 (1.04 / 1.05) | 92.3 / 92.7 %, 79.4 %, 56.1 %, 50 | 0.53 / 0.64 | — |
| `dbt12_ea1141` top10 | 16 | 16 | 180.4 | 45.86 / 45.78 / 45.77 | 317 | 0.9764 / 0.9757 | 0.9944 / 0.9938 | 2.22 (1.04 / 1.06) | 93.3 / 93.7 %, 82.0 %, 61.1 %, 59 | 0.74 / 0.90 | — |
| `dbt12_ea1141` top10 | 16 | 24 | 598.7 | 44.65 / 44.52 / 44.47 | 477 | 0.9711 / 0.9704 | 0.9909 / 0.9904 | 2.56 (1.05 / 1.06) | 94.2 / 94.4 %, 84.0 %, 65.0 %, 96 | 1.06 / 1.27 | — |
| `dbt12_ea1141` top10 | 16 | 32 | 1444.6 | 43.68 / 43.42 / 43.39 | 473 | 0.9676 / 0.9663 | 0.9875 / 0.9867 | 2.82 (1.05 / 1.06) | 94.7 / 94.9 %, 85.5 %, 68.1 %, 101 | 1.41 / 1.54 | — |
| `dbt12_ea1141` top10 | 16 | 40 | 3033.9 | 42.45 / 42.01 / 41.98 | 749 | 0.9628 / 0.9592 | 0.9825 / 0.9812 | 3.19 (1.05 / 1.06) | 95.3 / 95.5 %, 87.2 %, 71.6 %, 102 | 1.80 / 1.99 | — |
| `dbt12_ea1141` top10 | 16 | 56 | 10616.4 | 39.19 / 38.54 / 38.42 | 1372 | 0.9457 / 0.9375 | 0.9661 / 0.9626 | 4.47 (1.04 / 1.06) | 96.6 / 96.8 %, 90.6 %, 78.8 %, 163 | 3.16 / 3.47 | — |
| `dbt12_ea1141` top10 | 8 | 1 | 4.7 | 65.04 / 65.00 / 65.00 | 45 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.24 / 0.25) | 50.6 / 51.1 %, 12.1 %, 0.1 %, 6 | 0.07 / 0.08 | — |
| `dbt12_ea1141` top10 | 8 | 2 | 6.2 | 61.59 / 61.53 / 61.52 | 87 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.37 (0.36 / 0.38) | 65.4 / 65.9 %, 25.0 %, 1.8 %, 9 | 0.09 / 0.11 | — |
| `dbt12_ea1141` top10 | 8 | 4 | 10.0 | 56.23 / 56.12 / 56.04 | 115 | 0.9978 / 0.9977 | 0.9997 / 0.9997 | 0.68 (0.65 / 0.67) | 80.2 / 80.7 %, 49.8 %, 15.8 %, 16 | 0.15 / 0.18 | — |
| `dbt12_ea1141` top10 | 8 | 8 | 27.7 | 49.94 / 49.85 / 49.81 | 181 | 0.9904 / 0.9901 | 0.9985 / 0.9984 | 1.40 (0.98 / 1.00) | 89.8 / 90.2 %, 72.7 %, 44.4 %, 37 | 0.33 / 0.39 | — |
| `dbt12_ea1141` top10 | 8 | 12 | 71.1 | 47.28 / 47.14 / 47.11 | 252 | 0.9824 / 0.9820 | 0.9965 / 0.9963 | 1.90 (1.04 / 1.05) | 92.3 / 92.6 %, 79.2 %, 56.0 %, 49 | 0.53 / 0.64 | — |
| `dbt12_ea1141` top10 | 8 | 16 | 175.3 | 45.87 / 45.80 / 45.80 | 307 | 0.9764 / 0.9757 | 0.9944 / 0.9938 | 2.22 (1.04 / 1.06) | 93.3 / 93.7 %, 82.0 %, 61.2 %, 61 | 0.73 / 0.90 | — |
| `dbt12_ea1141` top10 | 8 | 24 | 574.6 | 44.68 / 44.52 / 44.47 | 477 | 0.9711 / 0.9702 | 0.9909 / 0.9903 | 2.54 (1.05 / 1.06) | 94.2 / 94.4 %, 84.0 %, 65.1 %, 95 | 1.07 / 1.27 | — |
| `dbt12_ea1141` top10 | 8 | 32 | 1332.7 | 43.67 / 43.43 / 43.41 | 473 | 0.9680 / 0.9663 | 0.9876 / 0.9865 | 2.81 (1.05 / 1.06) | 94.7 / 94.9 %, 85.5 %, 68.2 %, 100 | 1.41 / 1.55 | — |
| `dbt12_ea1141` top10 | 8 | 40 | 2749.6 | 42.52 / 42.01 / 41.82 | 749 | 0.9638 / 0.9598 | 0.9828 / 0.9815 | 3.19 (1.05 / 1.06) | 95.3 / 95.5 %, 87.1 %, 71.3 %, 101 | 1.82 / 1.99 | — |
| `dbt12_ea1141` top10 | 8 | 56 | 8662.9 | 39.31 / 38.70 / 38.41 | 1372 | 0.9461 / 0.9375 | 0.9672 / 0.9637 | 4.46 (1.04 / 1.06) | 96.5 / 96.7 %, 90.4 %, 78.5 %, 177 | 3.03 / 3.47 | — |
| `dbt12_ea1141` window | 1 | 1 | 2.8 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.39 / 0.41) | 20.1 / 21.7 %, 13.9 %, 11.9 %, 30 | 2.15 / 2.51 | — |
| `dbt12_ea1141` window | 1 | 2 | 3.4 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.40 / 0.41) | 25.6 / 27.0 %, 14.0 %, 12.0 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 1 | 4 | 4.3 | 13.62 / 13.20 / 13.12 | 1455 | 0.6503 / 0.6083 | 0.9041 / 0.8951 | 4.08 (0.40 / 0.42) | 37.3 / 38.6 %, 14.4 %, 12.1 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 1 | 8 | 5.9 | 13.62 / 13.20 / 13.12 | 1458 | 0.6501 / 0.6081 | 0.9041 / 0.8951 | 4.08 (0.45 / 0.46) | 61.0 / 61.7 %, 22.7 %, 12.3 %, 31 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 1 | 12 | 7.5 | 13.62 / 13.20 / 13.12 | 1462 | 0.6496 / 0.6077 | 0.9040 / 0.8950 | 4.10 (0.52 / 0.54) | 73.9 / 74.4 %, 37.5 %, 14.0 %, 31 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 1 | 16 | 9.2 | 13.62 / 13.20 / 13.12 | 1465 | 0.6491 / 0.6072 | 0.9039 / 0.8949 | 4.12 (0.61 / 0.62) | 80.4 / 81.0 %, 49.5 %, 18.8 %, 32 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 1 | 24 | 13.1 | 13.62 / 13.20 / 13.12 | 1468 | 0.6476 / 0.6056 | 0.9037 / 0.8947 | 4.16 (0.77 / 0.78) | 87.0 / 87.3 %, 64.4 %, 31.8 %, 33 | 2.18 / 2.53 | — |
| `dbt12_ea1141` window | 1 | 32 | 25.4 | 13.62 / 13.20 / 13.12 | 1474 | 0.6433 / 0.6012 | 0.9030 / 0.8940 | 4.27 (0.96 / 0.97) | 91.8 / 92.0 %, 76.9 %, 50.5 %, 49 | 2.20 / 2.55 | — |
| `dbt12_ea1141` window | 1 | 40 | 65.9 | 13.61 / 13.20 / 13.12 | 1476 | 0.6356 / 0.5936 | 0.9011 / 0.8923 | 4.47 (1.03 / 1.05) | 94.2 / 94.4 %, 83.6 %, 63.1 %, 52 | 2.26 / 2.59 | — |
| `dbt12_ea1141` window | 1 | 56 | 633.7 | 13.61 / 13.19 / 13.11 | 1503 | 0.6245 / 0.5842 | 0.8939 / 0.8871 | 4.88 (1.04 / 1.05) | 95.9 / 96.1 %, 88.4 %, 73.4 %, 96 | 2.55 / 2.85 | — |
| `dbt12_ea1141` window | 16 | 1 | 2.8 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.39 / 0.41) | 20.1 / 21.6 %, 13.9 %, 11.8 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 16 | 2 | 3.4 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.40 / 0.41) | 25.5 / 27.0 %, 14.0 %, 11.9 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 16 | 4 | 4.3 | 13.62 / 13.20 / 13.12 | 1455 | 0.6503 / 0.6083 | 0.9041 / 0.8951 | 4.07 (0.40 / 0.42) | 37.4 / 38.6 %, 14.3 %, 12.0 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 16 | 8 | 5.9 | 13.62 / 13.20 / 13.12 | 1455 | 0.6501 / 0.6081 | 0.9041 / 0.8951 | 4.08 (0.44 / 0.46) | 60.5 / 61.7 %, 22.5 %, 12.3 %, 31 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 16 | 12 | 7.4 | 13.62 / 13.20 / 13.12 | 1457 | 0.6496 / 0.6077 | 0.9040 / 0.8950 | 4.10 (0.51 / 0.53) | 73.5 / 74.4 %, 37.5 %, 14.0 %, 31 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 16 | 16 | 9.1 | 13.62 / 13.20 / 13.12 | 1463 | 0.6491 / 0.6072 | 0.9039 / 0.8949 | 4.12 (0.60 / 0.62) | 80.5 / 81.1 %, 49.9 %, 19.0 %, 33 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 16 | 24 | 13.1 | 13.62 / 13.20 / 13.12 | 1467 | 0.6476 / 0.6056 | 0.9037 / 0.8947 | 4.16 (0.77 / 0.78) | 87.0 / 87.3 %, 64.5 %, 31.8 %, 34 | 2.18 / 2.53 | — |
| `dbt12_ea1141` window | 16 | 32 | 25.3 | 13.62 / 13.20 / 13.12 | 1472 | 0.6433 / 0.6013 | 0.9030 / 0.8940 | 4.27 (0.96 / 0.97) | 91.7 / 92.0 %, 76.7 %, 50.5 %, 37 | 2.20 / 2.55 | — |
| `dbt12_ea1141` window | 16 | 40 | 69.3 | 13.62 / 13.20 / 13.12 | 1482 | 0.6356 / 0.5940 | 0.9012 / 0.8924 | 4.46 (1.03 / 1.05) | 94.2 / 94.3 %, 83.5 %, 63.1 %, 46 | 2.26 / 2.59 | — |
| `dbt12_ea1141` window | 16 | 56 | 1508.4 | 13.61 / 13.19 / 13.11 | 1500 | 0.6244 / 0.5840 | 0.8935 / 0.8869 | 4.91 (1.04 / 1.05) | 96.0 / 96.1 %, 88.6 %, 73.7 %, 100 | 2.59 / 2.85 | — |
| `dbt12_ea1141` window | 8 | 1 | 2.8 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.39 / 0.41) | 20.1 / 21.6 %, 13.9 %, 11.8 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 8 | 2 | 3.4 | 13.62 / 13.20 / 13.12 | 1454 | 0.6503 / 0.6084 | 0.9042 / 0.8951 | 4.07 (0.39 / 0.41) | 25.4 / 27.0 %, 14.0 %, 11.9 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 8 | 4 | 4.3 | 13.62 / 13.20 / 13.12 | 1455 | 0.6503 / 0.6083 | 0.9041 / 0.8951 | 4.07 (0.40 / 0.42) | 37.3 / 38.6 %, 14.3 %, 12.0 %, 30 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 8 | 8 | 5.9 | 13.62 / 13.20 / 13.12 | 1455 | 0.6501 / 0.6081 | 0.9041 / 0.8951 | 4.08 (0.44 / 0.46) | 60.5 / 61.7 %, 22.5 %, 12.3 %, 31 | 2.16 / 2.51 | — |
| `dbt12_ea1141` window | 8 | 12 | 7.4 | 13.62 / 13.20 / 13.12 | 1457 | 0.6496 / 0.6077 | 0.9040 / 0.8950 | 4.10 (0.52 / 0.54) | 73.5 / 74.4 %, 37.5 %, 14.0 %, 31 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 8 | 16 | 9.1 | 13.62 / 13.20 / 13.12 | 1461 | 0.6491 / 0.6071 | 0.9040 / 0.8949 | 4.12 (0.61 / 0.62) | 80.6 / 81.1 %, 49.9 %, 19.0 %, 32 | 2.17 / 2.52 | — |
| `dbt12_ea1141` window | 8 | 24 | 13.1 | 13.62 / 13.20 / 13.12 | 1467 | 0.6476 / 0.6056 | 0.9037 / 0.8947 | 4.16 (0.77 / 0.78) | 87.0 / 87.3 %, 64.5 %, 31.8 %, 33 | 2.18 / 2.53 | — |
| `dbt12_ea1141` window | 8 | 32 | 25.4 | 13.62 / 13.20 / 13.12 | 1472 | 0.6433 / 0.6014 | 0.9029 / 0.8940 | 4.27 (0.96 / 0.97) | 91.7 / 92.0 %, 76.7 %, 50.5 %, 37 | 2.20 / 2.55 | — |
| `dbt12_ea1141` window | 8 | 40 | 69.2 | 13.62 / 13.20 / 13.12 | 1482 | 0.6356 / 0.5939 | 0.9012 / 0.8924 | 4.46 (1.03 / 1.05) | 94.2 / 94.3 %, 83.5 %, 63.1 %, 45 | 2.26 / 2.59 | — |
| `dbt12_ea1141` window | 8 | 56 | 1399.4 | 13.61 / 13.19 / 13.11 | 1503 | 0.6244 / 0.5840 | 0.8936 / 0.8870 | 4.91 (1.04 / 1.05) | 96.0 / 96.1 %, 88.6 %, 73.7 %, 98 | 2.59 / 2.85 | — |
| `dbts_a1` 12bit | 1 | 1 | 4.0 | 71.62 / 71.56 / 71.56 | 27 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.12 / 0.12) | 24.3 / 25.0 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a1` 12bit | 1 | 2 | 5.3 | 65.68 / 65.62 / 65.62 | 25 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.23 (0.23 / 0.25) | 46.0 / 47.2 %, 4.7 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a1` 12bit | 1 | 4 | 9.4 | 57.63 / 57.57 / 57.55 | 86 | 0.9983 / 0.9983 | 0.9998 / 0.9998 | 0.57 (0.58 / 0.61) | 73.4 / 74.4 %, 35.6 %, 5.3 %, 12 | 0.12 / 0.15 | 9.96 |
| `dbts_a1` 12bit | 1 | 8 | 34.1 | 50.01 / 49.94 / 49.93 | 242 | 0.9901 / 0.9899 | 0.9985 / 0.9984 | 1.39 (1.00 / 1.01) | 88.1 / 88.7 %, 68.0 %, 36.2 %, 33 | 0.32 / 0.39 | 9.67 |
| `dbts_a1` 12bit | 1 | 12 | 110.1 | 47.45 / 47.41 / 47.39 | 295 | 0.9828 / 0.9821 | 0.9965 / 0.9962 | 1.85 (1.03 / 1.04) | 90.9 / 91.3 %, 75.2 %, 48.1 %, 53 | 0.56 / 0.67 | 9.03 |
| `dbts_a1` 12bit | 1 | 16 | 230.5 | 46.53 / 46.46 / 46.45 | 389 | 0.9795 / 0.9786 | 0.9950 / 0.9944 | 2.04 (1.03 / 1.04) | 91.7 / 92.1 %, 77.4 %, 52.1 %, 82 | 0.75 / 0.92 | 8.36 |
| `dbts_a1` 12bit | 1 | 24 | 442.1 | 45.75 / 45.68 / 45.67 | 551 | 0.9771 / 0.9763 | 0.9930 / 0.9923 | 2.23 (1.03 / 1.05) | 92.4 / 92.7 %, 79.0 %, 55.0 %, 88 | 0.99 / 1.19 | 7.57 |
| `dbts_a1` 12bit | 1 | 32 | 831.9 | 44.74 / 44.61 / 44.59 | 717 | 0.9752 / 0.9742 | 0.9901 / 0.9891 | 2.50 (1.03 / 1.05) | 93.2 / 93.4 %, 81.0 %, 58.5 %, 124 | 1.32 / 1.50 | 6.44 |
| `dbts_a1` 12bit | 1 | 40 | 1460.7 | 43.44 / 43.04 / 43.01 | 1149 | 0.9716 / 0.9691 | 0.9855 / 0.9847 | 2.90 (1.03 / 1.05) | 93.9 / 94.2 %, 82.9 %, 62.4 %, 173 | 1.80 / 1.91 | 5.09 |
| `dbts_a1` 12bit | 1 | 56 | 3928.0 | 39.38 / 38.73 / 38.68 | 1631 | 0.9483 / 0.9324 | 0.9694 / 0.9601 | 4.38 (1.03 / 1.05) | 95.8 / 96.1 %, 88.5 %, 74.2 %, 204 | 3.21 / 3.65 | 1.94 |
| `dbts_a1` 12bit | 16 | 1 | 4.0 | 71.65 / 71.59 / 71.56 | 50 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 24.2 / 25.0 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a1` 12bit | 16 | 2 | 5.4 | 65.20 / 65.10 / 65.09 | 75 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.24 (0.24 / 0.27) | 47.5 / 48.8 %, 5.9 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a1` 12bit | 16 | 4 | 9.4 | 57.59 / 57.54 / 57.54 | 163 | 0.9983 / 0.9983 | 0.9998 / 0.9998 | 0.58 (0.58 / 0.61) | 73.5 / 74.4 %, 35.6 %, 5.3 %, 12 | 0.12 / 0.15 | 9.96 |
| `dbts_a1` 12bit | 16 | 8 | 34.1 | 50.16 / 50.07 / 49.95 | 255 | 0.9905 / 0.9899 | 0.9986 / 0.9984 | 1.36 (0.99 / 1.01) | 87.9 / 88.5 %, 67.6 %, 35.8 %, 32 | 0.32 / 0.38 | 9.68 |
| `dbts_a1` 12bit | 16 | 12 | 142.6 | 47.48 / 47.42 / 47.41 | 274 | 0.9828 / 0.9821 | 0.9966 / 0.9962 | 1.84 (1.03 / 1.04) | 90.9 / 91.3 %, 75.2 %, 48.1 %, 47 | 0.55 / 0.67 | 9.02 |
| `dbts_a1` 12bit | 16 | 16 | 398.5 | 46.53 / 46.44 / 46.42 | 380 | 0.9798 / 0.9788 | 0.9950 / 0.9942 | 2.04 (1.03 / 1.05) | 91.7 / 92.2 %, 77.5 %, 52.3 %, 74 | 0.76 / 0.95 | 8.31 |
| `dbts_a1` 12bit | 16 | 24 | 1057.5 | 45.60 / 45.45 / 45.40 | 454 | 0.9773 / 0.9764 | 0.9925 / 0.9915 | 2.28 (1.03 / 1.05) | 92.6 / 92.9 %, 79.5 %, 55.9 %, 84 | 1.06 / 1.28 | 7.29 |
| `dbts_a1` 12bit | 16 | 32 | 2597.4 | 44.46 / 44.15 / 44.12 | 556 | 0.9750 / 0.9741 | 0.9892 / 0.9880 | 2.59 (1.03 / 1.05) | 93.4 / 93.7 %, 81.7 %, 59.9 %, 129 | 1.45 / 1.65 | 6.06 |
| `dbts_a1` 12bit | 16 | 40 | 5721.6 | 43.02 / 42.17 / 42.09 | 1000 | 0.9721 / 0.9685 | 0.9839 / 0.9809 | 3.07 (1.03 / 1.05) | 94.3 / 94.6 %, 84.2 %, 65.0 %, 163 | 1.95 / 2.21 | 4.47 |
| `dbts_a1` 12bit | 16 | 56 | 20423.6 | 38.77 / 37.52 / 37.44 | 1542 | 0.9516 / 0.9450 | 0.9665 / 0.9503 | 4.73 (1.03 / 1.05) | 96.0 / 96.7 %, 90.2 %, 77.9 %, 203 | 3.45 / 4.38 | 1.4 |
| `dbts_a1` 12bit | 8 | 1 | 4.0 | 71.65 / 71.58 / 71.56 | 47 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 24.2 / 25.0 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a1` 12bit | 8 | 2 | 5.4 | 65.26 / 65.10 / 65.09 | 69 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.24 (0.24 / 0.27) | 47.5 / 48.8 %, 5.9 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a1` 12bit | 8 | 4 | 9.4 | 57.60 / 57.54 / 57.54 | 163 | 0.9983 / 0.9983 | 0.9998 / 0.9998 | 0.58 (0.58 / 0.61) | 73.5 / 74.4 %, 35.6 %, 5.3 %, 12 | 0.12 / 0.15 | 9.96 |
| `dbts_a1` 12bit | 8 | 8 | 34.1 | 50.17 / 50.00 / 49.95 | 246 | 0.9905 / 0.9899 | 0.9986 / 0.9984 | 1.36 (0.99 / 1.01) | 88.0 / 88.5 %, 67.6 %, 35.8 %, 33 | 0.32 / 0.38 | 9.67 |
| `dbts_a1` 12bit | 8 | 12 | 140.5 | 47.48 / 47.41 / 47.41 | 272 | 0.9829 / 0.9821 | 0.9966 / 0.9962 | 1.84 (1.03 / 1.04) | 90.8 / 91.3 %, 75.2 %, 48.1 %, 50 | 0.55 / 0.67 | 9.01 |
| `dbts_a1` 12bit | 8 | 16 | 386.3 | 46.52 / 46.44 / 46.41 | 380 | 0.9797 / 0.9786 | 0.9949 / 0.9942 | 2.05 (1.03 / 1.05) | 91.8 / 92.2 %, 77.5 %, 52.3 %, 61 | 0.76 / 0.95 | 8.31 |
| `dbts_a1` 12bit | 8 | 24 | 1002.1 | 45.63 / 45.43 / 45.40 | 384 | 0.9772 / 0.9761 | 0.9925 / 0.9915 | 2.28 (1.03 / 1.05) | 92.6 / 92.9 %, 79.5 %, 55.9 %, 84 | 1.06 / 1.28 | 7.4 |
| `dbts_a1` 12bit | 8 | 32 | 2393.0 | 44.54 / 44.20 / 44.15 | 556 | 0.9750 / 0.9743 | 0.9892 / 0.9880 | 2.59 (1.03 / 1.05) | 93.3 / 93.8 %, 81.8 %, 60.1 %, 129 | 1.44 / 1.68 | 6.22 |
| `dbts_a1` 12bit | 8 | 40 | 5209.4 | 43.07 / 42.26 / 42.22 | 1000 | 0.9720 / 0.9697 | 0.9843 / 0.9815 | 3.03 (1.03 / 1.05) | 94.2 / 94.5 %, 84.0 %, 64.6 %, 156 | 1.91 / 2.19 | 4.75 |
| `dbts_a1` 12bit | 8 | 56 | 16832.0 | 39.03 / 37.88 / 37.73 | 1619 | 0.9519 / 0.9450 | 0.9671 / 0.9546 | 4.65 (1.03 / 1.05) | 96.0 / 96.5 %, 89.7 %, 76.7 %, 193 | 3.42 / 4.30 | 1.78 |
| `dbts_a1` top10 | 1 | 1 | 4.9 | 64.84 / 64.78 / 64.78 | 43 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.25 / 0.26) | 47.0 / 48.0 %, 7.7 %, 0.0 %, 5 | 0.07 / 0.09 | — |
| `dbts_a1` top10 | 1 | 2 | 6.5 | 61.34 / 61.28 / 61.28 | 33 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.37 (0.38 / 0.40) | 61.6 / 62.7 %, 18.7 %, 0.6 %, 8 | 0.10 / 0.12 | — |
| `dbts_a1` top10 | 1 | 4 | 11.0 | 55.85 / 55.80 / 55.80 | 113 | 0.9975 / 0.9974 | 0.9997 / 0.9996 | 0.71 (0.69 / 0.71) | 77.8 / 78.6 %, 44.2 %, 10.1 %, 16 | 0.16 / 0.19 | — |
| `dbts_a1` top10 | 1 | 8 | 36.8 | 49.73 / 49.66 / 49.65 | 242 | 0.9895 / 0.9894 | 0.9984 / 0.9983 | 1.43 (1.00 / 1.02) | 88.5 / 89.0 %, 69.0 %, 37.6 %, 37 | 0.34 / 0.42 | — |
| `dbts_a1` top10 | 1 | 12 | 103.4 | 47.52 / 47.49 / 47.48 | 294 | 0.9831 / 0.9826 | 0.9966 / 0.9963 | 1.84 (1.03 / 1.05) | 90.8 / 91.2 %, 75.0 %, 47.7 %, 44 | 0.54 / 0.66 | — |
| `dbts_a1` top10 | 1 | 16 | 207.1 | 46.63 / 46.57 / 46.57 | 377 | 0.9802 / 0.9793 | 0.9952 / 0.9946 | 2.02 (1.03 / 1.05) | 91.6 / 92.0 %, 77.2 %, 51.7 %, 58 | 0.73 / 0.89 | — |
| `dbts_a1` top10 | 1 | 24 | 395.8 | 45.91 / 45.83 / 45.82 | 417 | 0.9781 / 0.9773 | 0.9934 / 0.9927 | 2.20 (1.03 / 1.05) | 92.3 / 92.6 %, 78.8 %, 54.5 %, 87 | 0.94 / 1.14 | — |
| `dbts_a1` top10 | 1 | 32 | 727.5 | 45.00 / 44.92 / 44.88 | 640 | 0.9762 / 0.9754 | 0.9909 / 0.9900 | 2.43 (1.04 / 1.06) | 93.1 / 93.2 %, 80.5 %, 57.8 %, 94 | 1.23 / 1.42 | — |
| `dbts_a1` top10 | 1 | 40 | 1240.9 | 43.95 / 43.60 / 43.56 | 913 | 0.9730 / 0.9717 | 0.9872 / 0.9865 | 2.77 (1.04 / 1.05) | 93.6 / 93.9 %, 82.3 %, 61.2 %, 149 | 1.64 / 1.76 | — |
| `dbts_a1` top10 | 1 | 56 | 3307.7 | 40.66 / 39.95 / 39.90 | 1641 | 0.9584 / 0.9515 | 0.9746 / 0.9673 | 3.91 (1.04 / 1.05) | 95.4 / 95.6 %, 87.2 %, 71.7 %, 213 | 2.80 / 3.12 | — |
| `dbts_a1` top10 | 16 | 1 | 5.0 | 64.47 / 64.37 / 64.36 | 62 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.26 (0.25 / 0.27) | 48.4 / 49.5 %, 8.6 %, 0.0 %, 5 | 0.08 / 0.10 | — |
| `dbts_a1` top10 | 16 | 2 | 6.5 | 61.28 / 61.21 / 61.21 | 75 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.38 (0.38 / 0.40) | 61.7 / 62.9 %, 18.9 %, 0.6 %, 8 | 0.10 / 0.12 | — |
| `dbts_a1` top10 | 16 | 4 | 10.9 | 55.81 / 55.76 / 55.75 | 129 | 0.9975 / 0.9974 | 0.9997 / 0.9996 | 0.71 (0.69 / 0.71) | 78.0 / 78.7 %, 44.3 %, 10.2 %, 16 | 0.16 / 0.20 | — |
| `dbts_a1` top10 | 16 | 8 | 36.9 | 49.86 / 49.78 / 49.68 | 200 | 0.9899 / 0.9894 | 0.9984 / 0.9983 | 1.41 (1.00 / 1.02) | 88.3 / 88.9 %, 68.6 %, 37.2 %, 32 | 0.34 / 0.42 | — |
| `dbts_a1` top10 | 16 | 12 | 135.1 | 47.50 / 47.44 / 47.43 | 298 | 0.9832 / 0.9825 | 0.9966 / 0.9962 | 1.84 (1.03 / 1.05) | 90.8 / 91.3 %, 75.1 %, 47.9 %, 46 | 0.56 / 0.69 | — |
| `dbts_a1` top10 | 16 | 16 | 337.8 | 46.66 / 46.57 / 46.54 | 377 | 0.9803 / 0.9794 | 0.9952 / 0.9945 | 2.02 (1.03 / 1.05) | 91.6 / 92.0 %, 77.3 %, 51.8 %, 57 | 0.73 / 0.91 | — |
| `dbts_a1` top10 | 16 | 24 | 860.1 | 45.81 / 45.70 / 45.68 | 369 | 0.9780 / 0.9772 | 0.9932 / 0.9923 | 2.22 (1.04 / 1.05) | 92.4 / 92.7 %, 79.1 %, 55.0 %, 85 | 0.98 / 1.20 | — |
| `dbts_a1` top10 | 16 | 32 | 2039.5 | 44.90 / 44.70 / 44.66 | 507 | 0.9762 / 0.9755 | 0.9905 / 0.9894 | 2.48 (1.04 / 1.05) | 93.2 / 93.4 %, 80.9 %, 58.4 %, 126 | 1.29 / 1.48 | — |
| `dbts_a1` top10 | 16 | 40 | 4275.8 | 43.71 / 43.20 / 43.15 | 674 | 0.9730 / 0.9707 | 0.9865 / 0.9853 | 2.82 (1.04 / 1.06) | 93.8 / 94.1 %, 82.9 %, 62.3 %, 154 | 1.73 / 1.90 | — |
| `dbts_a1` top10 | 16 | 56 | 15190.9 | 40.26 / 39.25 / 39.22 | 1466 | 0.9602 / 0.9515 | 0.9721 / 0.9636 | 4.11 (1.04 / 1.05) | 95.6 / 95.9 %, 88.0 %, 73.2 %, 176 | 2.92 / 3.45 | — |
| `dbts_a1` top10 | 8 | 1 | 5.0 | 64.52 / 64.37 / 64.37 | 66 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.26 (0.25 / 0.27) | 48.4 / 49.5 %, 8.6 %, 0.0 %, 7 | 0.08 / 0.10 | — |
| `dbts_a1` top10 | 8 | 2 | 6.5 | 61.30 / 61.21 / 61.21 | 112 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.38 (0.38 / 0.40) | 61.7 / 62.9 %, 18.9 %, 0.6 %, 8 | 0.10 / 0.12 | — |
| `dbts_a1` top10 | 8 | 4 | 10.9 | 55.82 / 55.76 / 55.75 | 131 | 0.9975 / 0.9974 | 0.9997 / 0.9996 | 0.71 (0.69 / 0.71) | 77.9 / 78.7 %, 44.3 %, 10.2 %, 21 | 0.16 / 0.20 | — |
| `dbts_a1` top10 | 8 | 8 | 36.9 | 49.86 / 49.72 / 49.66 | 230 | 0.9899 / 0.9894 | 0.9984 / 0.9983 | 1.41 (1.00 / 1.02) | 88.3 / 88.9 %, 68.6 %, 37.2 %, 32 | 0.34 / 0.42 | — |
| `dbts_a1` top10 | 8 | 12 | 133.2 | 47.51 / 47.44 / 47.43 | 285 | 0.9832 / 0.9825 | 0.9966 / 0.9962 | 1.84 (1.03 / 1.05) | 90.8 / 91.3 %, 75.1 %, 47.9 %, 46 | 0.56 / 0.69 | — |
| `dbts_a1` top10 | 8 | 16 | 329.7 | 46.65 / 46.57 / 46.54 | 377 | 0.9803 / 0.9794 | 0.9952 / 0.9945 | 2.02 (1.03 / 1.05) | 91.7 / 92.0 %, 77.3 %, 51.8 %, 61 | 0.73 / 0.91 | — |
| `dbts_a1` top10 | 8 | 24 | 816.3 | 45.83 / 45.71 / 45.69 | 369 | 0.9780 / 0.9772 | 0.9932 / 0.9924 | 2.22 (1.04 / 1.05) | 92.4 / 92.7 %, 79.1 %, 55.0 %, 91 | 0.98 / 1.20 | — |
| `dbts_a1` top10 | 8 | 32 | 1880.9 | 44.91 / 44.72 / 44.68 | 464 | 0.9762 / 0.9755 | 0.9905 / 0.9895 | 2.47 (1.04 / 1.05) | 93.1 / 93.4 %, 80.9 %, 58.4 %, 126 | 1.27 / 1.49 | — |
| `dbts_a1` top10 | 8 | 40 | 3876.4 | 43.75 / 43.25 / 43.17 | 741 | 0.9730 / 0.9708 | 0.9866 / 0.9851 | 2.82 (1.04 / 1.06) | 93.8 / 94.1 %, 82.8 %, 62.2 %, 137 | 1.72 / 1.90 | — |
| `dbts_a1` top10 | 8 | 56 | 13115.2 | 40.27 / 39.38 / 39.34 | 1466 | 0.9600 / 0.9515 | 0.9723 / 0.9647 | 4.09 (1.04 / 1.05) | 95.5 / 95.8 %, 87.9 %, 72.9 %, 175 | 2.90 / 3.36 | — |
| `dbts_a1` window | 1 | 1 | 2.9 | 13.21 / 12.04 / 11.91 | 1601 | 0.6843 / 0.5760 | 0.9236 / 0.9004 | 3.57 (0.34 / 0.39) | 17.7 / 21.5 %, 13.1 %, 10.4 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 1 | 2 | 3.6 | 13.21 / 12.04 / 11.91 | 1602 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.35 / 0.39) | 23.4 / 27.0 %, 13.2 %, 10.5 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 1 | 4 | 4.5 | 13.21 / 12.04 / 11.91 | 1604 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.36 / 0.40) | 35.1 / 38.6 %, 13.5 %, 10.6 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 1 | 8 | 6.4 | 13.21 / 12.04 / 11.91 | 1610 | 0.6840 / 0.5756 | 0.9236 / 0.9003 | 3.58 (0.43 / 0.46) | 58.3 / 60.9 %, 21.0 %, 10.9 %, 31 | 2.05 / 2.40 | — |
| `dbts_a1` window | 1 | 12 | 8.4 | 13.21 / 12.04 / 11.91 | 1611 | 0.6834 / 0.5751 | 0.9235 / 0.9003 | 3.60 (0.54 / 0.56) | 71.7 / 73.5 %, 35.5 %, 12.4 %, 33 | 2.05 / 2.40 | — |
| `dbts_a1` window | 1 | 16 | 10.7 | 13.21 / 12.04 / 11.91 | 1613 | 0.6826 / 0.5744 | 0.9234 / 0.9002 | 3.63 (0.66 / 0.68) | 78.8 / 80.2 %, 47.6 %, 16.8 %, 33 | 2.05 / 2.40 | — |
| `dbts_a1` window | 1 | 24 | 16.8 | 13.21 / 12.04 / 11.91 | 1619 | 0.6804 / 0.5724 | 0.9231 / 0.8999 | 3.69 (0.86 / 0.87) | 85.9 / 86.8 %, 62.8 %, 29.4 %, 33 | 2.06 / 2.41 | — |
| `dbts_a1` window | 1 | 32 | 41.9 | 13.21 / 12.04 / 11.91 | 1621 | 0.6750 / 0.5670 | 0.9220 / 0.8990 | 3.86 (1.01 / 1.02) | 90.8 / 91.3 %, 74.7 %, 46.4 %, 53 | 2.09 / 2.43 | — |
| `dbts_a1` window | 1 | 40 | 144.7 | 13.21 / 12.04 / 11.91 | 1628 | 0.6687 / 0.5610 | 0.9199 / 0.8973 | 4.06 (1.03 / 1.05) | 92.8 / 93.2 %, 80.0 %, 56.0 %, 58 | 2.16 / 2.48 | — |
| `dbts_a1` window | 1 | 56 | 906.4 | 13.20 / 12.03 / 11.90 | 1660 | 0.6641 / 0.5576 | 0.9146 / 0.8934 | 4.35 (1.03 / 1.05) | 94.2 / 94.7 %, 84.2 %, 64.3 %, 106 | 2.47 / 2.74 | — |
| `dbts_a1` window | 16 | 1 | 3.0 | 13.21 / 12.04 / 11.91 | 1601 | 0.6843 / 0.5760 | 0.9236 / 0.9004 | 3.57 (0.34 / 0.39) | 18.1 / 22.0 %, 13.1 %, 10.4 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 16 | 2 | 3.6 | 13.21 / 12.04 / 11.91 | 1602 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.35 / 0.39) | 23.7 / 27.3 %, 13.2 %, 10.5 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 16 | 4 | 4.5 | 13.21 / 12.04 / 11.91 | 1603 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.36 / 0.40) | 35.5 / 39.1 %, 13.6 %, 10.6 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 16 | 8 | 6.4 | 13.21 / 12.04 / 11.91 | 1606 | 0.6840 / 0.5756 | 0.9236 / 0.9004 | 3.58 (0.43 / 0.46) | 58.6 / 61.2 %, 21.3 %, 10.8 %, 31 | 2.05 / 2.40 | — |
| `dbts_a1` window | 16 | 12 | 8.3 | 13.21 / 12.04 / 11.91 | 1607 | 0.6834 / 0.5751 | 0.9235 / 0.9003 | 3.60 (0.54 / 0.56) | 71.9 / 73.8 %, 35.8 %, 12.4 %, 32 | 2.05 / 2.40 | — |
| `dbts_a1` window | 16 | 16 | 10.6 | 13.21 / 12.04 / 11.91 | 1610 | 0.6826 / 0.5744 | 0.9234 / 0.9002 | 3.63 (0.66 / 0.68) | 79.0 / 80.3 %, 47.8 %, 16.9 %, 32 | 2.05 / 2.40 | — |
| `dbts_a1` window | 16 | 24 | 16.6 | 13.21 / 12.04 / 11.91 | 1618 | 0.6805 / 0.5724 | 0.9231 / 0.8999 | 3.69 (0.85 / 0.87) | 85.9 / 86.8 %, 62.6 %, 29.2 %, 33 | 2.06 / 2.41 | — |
| `dbts_a1` window | 16 | 32 | 41.6 | 13.21 / 12.04 / 11.91 | 1623 | 0.6754 / 0.5674 | 0.9221 / 0.8991 | 3.85 (1.00 / 1.02) | 90.6 / 91.3 %, 74.6 %, 46.4 %, 34 | 2.09 / 2.43 | — |
| `dbts_a1` window | 16 | 40 | 196.0 | 13.21 / 12.04 / 11.91 | 1628 | 0.6689 / 0.5610 | 0.9198 / 0.8972 | 4.06 (1.03 / 1.05) | 92.8 / 93.2 %, 80.0 %, 56.0 %, 50 | 2.16 / 2.49 | — |
| `dbts_a1` window | 16 | 56 | 2295.5 | 13.21 / 12.03 / 11.91 | 1646 | 0.6638 / 0.5575 | 0.9146 / 0.8933 | 4.34 (1.03 / 1.05) | 94.2 / 94.7 %, 84.3 %, 64.4 %, 126 | 2.47 / 2.75 | — |
| `dbts_a1` window | 8 | 1 | 3.0 | 13.21 / 12.04 / 11.91 | 1601 | 0.6843 / 0.5760 | 0.9236 / 0.9004 | 3.57 (0.34 / 0.39) | 18.1 / 21.9 %, 13.1 %, 10.4 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 8 | 2 | 3.6 | 13.21 / 12.04 / 11.91 | 1602 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.35 / 0.39) | 23.7 / 27.3 %, 13.2 %, 10.5 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 8 | 4 | 4.5 | 13.21 / 12.04 / 11.91 | 1603 | 0.6843 / 0.5759 | 0.9236 / 0.9004 | 3.57 (0.36 / 0.40) | 35.5 / 39.0 %, 13.5 %, 10.6 %, 30 | 2.04 / 2.40 | — |
| `dbts_a1` window | 8 | 8 | 6.4 | 13.21 / 12.04 / 11.91 | 1605 | 0.6840 / 0.5756 | 0.9236 / 0.9004 | 3.58 (0.43 / 0.46) | 58.6 / 61.2 %, 21.3 %, 10.8 %, 31 | 2.05 / 2.40 | — |
| `dbts_a1` window | 8 | 12 | 8.3 | 13.21 / 12.04 / 11.91 | 1608 | 0.6834 / 0.5751 | 0.9235 / 0.9003 | 3.60 (0.54 / 0.56) | 72.0 / 73.7 %, 35.8 %, 12.4 %, 32 | 2.05 / 2.40 | — |
| `dbts_a1` window | 8 | 16 | 10.6 | 13.21 / 12.04 / 11.91 | 1610 | 0.6826 / 0.5744 | 0.9234 / 0.9002 | 3.63 (0.66 / 0.68) | 78.9 / 80.3 %, 47.9 %, 16.9 %, 32 | 2.05 / 2.40 | — |
| `dbts_a1` window | 8 | 24 | 16.6 | 13.21 / 12.04 / 11.91 | 1617 | 0.6805 / 0.5724 | 0.9231 / 0.8999 | 3.69 (0.85 / 0.87) | 85.9 / 86.8 %, 62.6 %, 29.2 %, 33 | 2.06 / 2.41 | — |
| `dbts_a1` window | 8 | 32 | 41.7 | 13.21 / 12.04 / 11.91 | 1623 | 0.6754 / 0.5674 | 0.9220 / 0.8991 | 3.85 (1.00 / 1.02) | 90.6 / 91.3 %, 74.6 %, 46.4 %, 33 | 2.09 / 2.43 | — |
| `dbts_a1` window | 8 | 40 | 193.2 | 13.21 / 12.04 / 11.91 | 1627 | 0.6689 / 0.5610 | 0.9198 / 0.8972 | 4.06 (1.03 / 1.05) | 92.8 / 93.2 %, 80.0 %, 55.9 %, 58 | 2.16 / 2.48 | — |
| `dbts_a1` window | 8 | 56 | 2154.7 | 13.21 / 12.03 / 11.91 | 1692 | 0.6639 / 0.5575 | 0.9146 / 0.8933 | 4.34 (1.03 / 1.05) | 94.3 / 94.7 %, 84.3 %, 64.5 %, 126 | 2.47 / 2.74 | — |
| `dbts_a2` 12bit | 1 | 1 | 4.4 | 72.08 / 71.77 / 71.77 | 37 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 21.1 / 22.2 %, 0.1 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbts_a2` 12bit | 1 | 2 | 5.7 | 66.13 / 65.83 / 65.83 | 41 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.21 (0.22 / 0.24) | 40.7 / 42.7 %, 3.3 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a2` 12bit | 1 | 4 | 9.9 | 58.08 / 57.79 / 57.79 | 80 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.54 / 0.59) | 68.9 / 70.7 %, 30.0 %, 3.6 %, 12 | 0.12 / 0.14 | 9.97 |
| `dbts_a2` 12bit | 1 | 8 | 31.2 | 50.40 / 50.22 / 50.21 | 264 | 0.9910 / 0.9905 | 0.9987 / 0.9986 | 1.31 (0.99 / 1.01) | 85.4 / 87.3 %, 64.9 %, 33.3 %, 35 | 0.31 / 0.37 | 9.76 |
| `dbts_a2` 12bit | 1 | 12 | 94.5 | 47.49 / 47.30 / 47.28 | 322 | 0.9829 / 0.9818 | 0.9967 / 0.9963 | 1.83 (1.05 / 1.07) | 88.9 / 90.6 %, 73.6 %, 47.0 %, 50 | 0.54 / 0.64 | 9.25 |
| `dbts_a2` 12bit | 1 | 16 | 203.6 | 46.39 / 46.14 / 46.12 | 392 | 0.9786 / 0.9768 | 0.9949 / 0.9943 | 2.07 (1.05 / 1.07) | 90.1 / 91.5 %, 75.9 %, 51.0 %, 58 | 0.74 / 0.89 | 8.57 |
| `dbts_a2` 12bit | 1 | 24 | 427.2 | 45.47 / 45.22 / 45.20 | 534 | 0.9744 / 0.9726 | 0.9925 / 0.9916 | 2.28 (1.05 / 1.07) | 91.0 / 92.2 %, 77.7 %, 53.9 %, 88 | 1.01 / 1.22 | 7.56 |
| `dbts_a2` 12bit | 1 | 32 | 860.2 | 44.50 / 44.26 / 44.25 | 999 | 0.9737 / 0.9712 | 0.9897 / 0.9882 | 2.53 (1.05 / 1.07) | 92.0 / 93.0 %, 79.7 %, 57.1 %, 122 | 1.36 / 1.63 | 6.23 |
| `dbts_a2` 12bit | 1 | 40 | 1593.6 | 43.26 / 42.90 / 42.87 | 1298 | 0.9706 / 0.9667 | 0.9861 / 0.9833 | 2.84 (1.05 / 1.07) | 92.9 / 93.7 %, 81.6 %, 60.3 %, 181 | 1.73 / 2.14 | 5.16 |
| `dbts_a2` 12bit | 1 | 56 | 4298.0 | 39.50 / 38.99 / 38.90 | 2201 | 0.9531 / 0.9332 | 0.9741 / 0.9691 | 4.15 (1.06 / 1.08) | 94.7 / 95.0 %, 85.0 %, 66.5 %, 202 | 3.09 / 3.57 | 3.24 |
| `dbts_a2` 12bit | 16 | 1 | 4.3 | 72.09 / 71.80 / 71.78 | 56 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 21.1 / 22.1 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a2` 12bit | 16 | 2 | 5.8 | 65.69 / 65.32 / 65.31 | 105 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.23 (0.23 / 0.26) | 42.2 / 44.3 %, 4.1 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a2` 12bit | 16 | 4 | 9.9 | 58.02 / 57.78 / 57.77 | 155 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.54 / 0.59) | 68.9 / 70.9 %, 30.4 %, 3.7 %, 12 | 0.12 / 0.14 | 9.97 |
| `dbts_a2` 12bit | 16 | 8 | 31.4 | 50.51 / 50.36 / 50.21 | 206 | 0.9914 / 0.9906 | 0.9987 / 0.9986 | 1.29 (0.98 / 1.01) | 85.3 / 87.1 %, 64.6 %, 32.8 %, 31 | 0.31 / 0.37 | 9.76 |
| `dbts_a2` 12bit | 16 | 12 | 112.1 | 47.57 / 47.38 / 47.29 | 322 | 0.9833 / 0.9818 | 0.9967 / 0.9963 | 1.81 (1.05 / 1.07) | 88.9 / 90.4 %, 73.3 %, 46.6 %, 53 | 0.54 / 0.65 | 9.26 |
| `dbts_a2` 12bit | 16 | 16 | 333.5 | 46.39 / 46.13 / 46.09 | 356 | 0.9790 / 0.9771 | 0.9949 / 0.9941 | 2.07 (1.05 / 1.07) | 90.1 / 91.5 %, 75.9 %, 51.0 %, 63 | 0.75 / 0.93 | 8.54 |
| `dbts_a2` 12bit | 16 | 24 | 1088.8 | 45.28 / 44.96 / 44.90 | 603 | 0.9753 / 0.9725 | 0.9920 / 0.9906 | 2.34 (1.05 / 1.07) | 91.2 / 92.4 %, 78.2 %, 54.7 %, 88 | 1.09 / 1.37 | 7.28 |
| `dbts_a2` 12bit | 16 | 32 | 2949.1 | 44.25 / 43.95 / 43.91 | 689 | 0.9739 / 0.9716 | 0.9888 / 0.9869 | 2.62 (1.05 / 1.07) | 92.3 / 93.2 %, 80.4 %, 58.2 %, 143 | 1.48 / 1.79 | 6.04 |
| `dbts_a2` 12bit | 16 | 40 | 6739.5 | 42.84 / 42.40 / 42.31 | 891 | 0.9703 / 0.9676 | 0.9847 / 0.9820 | 3.02 (1.05 / 1.07) | 93.3 / 94.0 %, 82.5 %, 62.1 %, 181 | 1.94 / 2.33 | 4.93 |
| `dbts_a2` 12bit | 16 | 56 | 22296.1 | 39.23 / 37.94 / 37.75 | 2101 | 0.9516 / 0.9478 | 0.9725 / 0.9657 | 4.39 (1.05 / 1.08) | 95.0 / 95.4 %, 86.2 %, 69.1 %, 219 | 3.40 / 4.13 | 3.03 |
| `dbts_a2` 12bit | 8 | 1 | 4.3 | 72.09 / 71.79 / 71.78 | 56 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.12) | 21.1 / 22.1 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_a2` 12bit | 8 | 2 | 5.8 | 65.81 / 65.32 / 65.30 | 105 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.23 / 0.26) | 42.0 / 44.3 %, 4.1 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_a2` 12bit | 8 | 4 | 9.9 | 58.05 / 57.78 / 57.77 | 145 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.54 / 0.59) | 68.9 / 70.9 %, 30.4 %, 3.7 %, 12 | 0.12 / 0.14 | 9.97 |
| `dbts_a2` 12bit | 8 | 8 | 31.4 | 50.52 / 50.30 / 50.21 | 264 | 0.9914 / 0.9906 | 0.9987 / 0.9986 | 1.29 (0.99 / 1.01) | 85.3 / 87.1 %, 64.6 %, 32.8 %, 31 | 0.31 / 0.37 | 9.76 |
| `dbts_a2` 12bit | 8 | 12 | 111.2 | 47.57 / 47.36 / 47.29 | 322 | 0.9833 / 0.9818 | 0.9967 / 0.9963 | 1.81 (1.05 / 1.07) | 88.9 / 90.4 %, 73.3 %, 46.6 %, 48 | 0.54 / 0.65 | 9.27 |
| `dbts_a2` 12bit | 8 | 16 | 324.8 | 46.39 / 46.13 / 46.09 | 356 | 0.9789 / 0.9771 | 0.9948 / 0.9941 | 2.07 (1.05 / 1.07) | 90.1 / 91.5 %, 75.9 %, 51.0 %, 64 | 0.74 / 0.93 | 8.55 |
| `dbts_a2` 12bit | 8 | 24 | 1024.8 | 45.34 / 44.96 / 44.90 | 512 | 0.9753 / 0.9725 | 0.9921 / 0.9906 | 2.32 (1.05 / 1.07) | 91.2 / 92.4 %, 78.2 %, 54.7 %, 87 | 1.08 / 1.37 | 7.34 |
| `dbts_a2` 12bit | 8 | 32 | 2658.1 | 44.30 / 43.98 / 43.92 | 686 | 0.9737 / 0.9716 | 0.9889 / 0.9869 | 2.60 (1.05 / 1.07) | 92.2 / 93.2 %, 80.4 %, 58.2 %, 144 | 1.44 / 1.79 | 6.08 |
| `dbts_a2` 12bit | 8 | 40 | 5858.5 | 42.99 / 42.45 / 42.34 | 987 | 0.9711 / 0.9676 | 0.9852 / 0.9820 | 2.95 (1.05 / 1.07) | 93.2 / 94.0 %, 82.5 %, 62.1 %, 182 | 1.86 / 2.33 | 5.04 |
| `dbts_a2` 12bit | 8 | 56 | 18113.4 | 39.46 / 38.36 / 38.10 | 2101 | 0.9515 / 0.9448 | 0.9731 / 0.9666 | 4.30 (1.05 / 1.08) | 94.8 / 95.2 %, 85.8 %, 68.3 %, 215 | 3.21 / 4.04 | 3.23 |
| `dbts_a2` top10 | 1 | 1 | 5.3 | 65.30 / 65.00 / 64.99 | 29 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.24 (0.23 / 0.26) | 41.8 / 44.3 %, 5.8 %, 0.0 %, 5 | 0.07 / 0.08 | — |
| `dbts_a2` top10 | 1 | 2 | 7.0 | 61.79 / 61.50 / 61.49 | 53 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.35 (0.35 / 0.39) | 56.1 / 58.5 %, 14.8 %, 0.4 %, 8 | 0.10 / 0.11 | — |
| `dbts_a2` top10 | 1 | 4 | 11.5 | 56.33 / 56.05 / 56.03 | 175 | 0.9978 / 0.9976 | 0.9997 / 0.9997 | 0.66 (0.64 / 0.69) | 73.7 / 75.5 %, 38.6 %, 7.4 %, 14 | 0.15 / 0.18 | — |
| `dbts_a2` top10 | 1 | 8 | 33.3 | 50.10 / 49.93 / 49.92 | 262 | 0.9906 / 0.9901 | 0.9985 / 0.9984 | 1.36 (1.00 / 1.02) | 85.8 / 87.7 %, 66.1 %, 34.9 %, 31 | 0.33 / 0.39 | — |
| `dbts_a2` top10 | 1 | 12 | 88.9 | 47.62 / 47.41 / 47.39 | 331 | 0.9835 / 0.9825 | 0.9968 / 0.9965 | 1.80 (1.05 / 1.07) | 88.8 / 90.4 %, 73.2 %, 46.4 %, 48 | 0.52 / 0.63 | — |
| `dbts_a2` top10 | 1 | 16 | 179.6 | 46.53 / 46.30 / 46.28 | 455 | 0.9794 / 0.9779 | 0.9952 / 0.9946 | 2.04 (1.05 / 1.08) | 90.0 / 91.3 %, 75.7 %, 50.5 %, 56 | 0.71 / 0.85 | — |
| `dbts_a2` top10 | 1 | 24 | 377.3 | 45.68 / 45.40 / 45.38 | 515 | 0.9768 / 0.9747 | 0.9931 / 0.9921 | 2.24 (1.05 / 1.08) | 90.8 / 92.1 %, 77.5 %, 53.6 %, 87 | 0.96 / 1.17 | — |
| `dbts_a2` top10 | 1 | 32 | 737.3 | 44.80 / 44.54 / 44.52 | 992 | 0.9748 / 0.9723 | 0.9905 / 0.9891 | 2.46 (1.06 / 1.08) | 91.8 / 92.8 %, 79.2 %, 56.5 %, 91 | 1.27 / 1.53 | — |
| `dbts_a2` top10 | 1 | 40 | 1312.7 | 43.75 / 43.45 / 43.41 | 1319 | 0.9710 / 0.9682 | 0.9873 / 0.9851 | 2.72 (1.06 / 1.08) | 92.7 / 93.4 %, 81.0 %, 59.3 %, 125 | 1.60 / 1.95 | — |
| `dbts_a2` top10 | 1 | 56 | 3499.8 | 40.75 / 40.23 / 40.11 | 2076 | 0.9532 / 0.9424 | 0.9771 / 0.9740 | 3.65 (1.06 / 1.08) | 94.2 / 94.5 %, 83.9 %, 64.5 %, 194 | 2.60 / 3.02 | — |
| `dbts_a2` top10 | 16 | 1 | 5.4 | 64.96 / 64.60 / 64.59 | 91 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.25 (0.24 / 0.26) | 43.2 / 45.7 %, 6.6 %, 0.0 %, 5 | 0.08 / 0.09 | — |
| `dbts_a2` top10 | 16 | 2 | 6.9 | 61.70 / 61.42 / 61.41 | 99 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.36 (0.35 / 0.39) | 56.4 / 58.8 %, 15.1 %, 0.4 %, 8 | 0.10 / 0.12 | — |
| `dbts_a2` top10 | 16 | 4 | 11.5 | 56.27 / 56.02 / 56.01 | 159 | 0.9977 / 0.9976 | 0.9997 / 0.9997 | 0.67 (0.65 / 0.69) | 73.8 / 75.8 %, 39.1 %, 7.7 %, 15 | 0.16 / 0.19 | — |
| `dbts_a2` top10 | 16 | 8 | 33.7 | 50.19 / 50.04 / 49.93 | 203 | 0.9908 / 0.9901 | 0.9986 / 0.9984 | 1.34 (1.00 / 1.02) | 85.7 / 87.6 %, 65.7 %, 34.4 %, 33 | 0.33 / 0.40 | — |
| `dbts_a2` top10 | 16 | 12 | 104.4 | 47.62 / 47.43 / 47.39 | 331 | 0.9836 / 0.9825 | 0.9968 / 0.9964 | 1.80 (1.05 / 1.07) | 88.8 / 90.5 %, 73.2 %, 46.4 %, 49 | 0.54 / 0.66 | — |
| `dbts_a2` top10 | 16 | 16 | 275.4 | 46.54 / 46.29 / 46.28 | 404 | 0.9796 / 0.9780 | 0.9952 / 0.9946 | 2.03 (1.05 / 1.08) | 89.9 / 91.4 %, 75.6 %, 50.5 %, 63 | 0.72 / 0.87 | — |
| `dbts_a2` top10 | 16 | 24 | 845.7 | 45.55 / 45.27 / 45.18 | 400 | 0.9766 / 0.9746 | 0.9928 / 0.9915 | 2.27 (1.06 / 1.08) | 90.9 / 92.1 %, 77.6 %, 53.8 %, 92 | 1.00 / 1.26 | — |
| `dbts_a2` top10 | 16 | 32 | 2228.4 | 44.61 / 44.37 / 44.35 | 474 | 0.9746 / 0.9726 | 0.9900 / 0.9886 | 2.51 (1.07 / 1.09) | 91.9 / 92.9 %, 79.5 %, 56.8 %, 112 | 1.33 / 1.61 | — |
| `dbts_a2` top10 | 16 | 40 | 4886.1 | 43.46 / 43.23 / 43.09 | 847 | 0.9698 / 0.9683 | 0.9865 / 0.9841 | 2.81 (1.06 / 1.09) | 92.8 / 93.6 %, 81.4 %, 60.0 %, 179 | 1.70 / 2.07 | — |
| `dbts_a2` top10 | 16 | 56 | 17017.0 | 40.53 / 39.64 / 39.47 | 1869 | 0.9547 / 0.9502 | 0.9759 / 0.9721 | 3.87 (1.06 / 1.08) | 94.4 / 94.7 %, 84.3 %, 65.3 %, 208 | 2.84 / 3.30 | — |
| `dbts_a2` top10 | 8 | 1 | 5.4 | 65.00 / 64.60 / 64.60 | 66 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.24 (0.24 / 0.26) | 43.1 / 45.7 %, 6.6 %, 0.0 %, 5 | 0.08 / 0.09 | — |
| `dbts_a2` top10 | 8 | 2 | 6.9 | 61.72 / 61.42 / 61.42 | 110 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.36 (0.35 / 0.39) | 56.3 / 58.8 %, 15.1 %, 0.4 %, 8 | 0.10 / 0.12 | — |
| `dbts_a2` top10 | 8 | 4 | 11.5 | 56.29 / 56.02 / 56.02 | 155 | 0.9978 / 0.9976 | 0.9997 / 0.9997 | 0.66 (0.64 / 0.69) | 73.7 / 75.8 %, 39.1 %, 7.7 %, 15 | 0.16 / 0.19 | — |
| `dbts_a2` top10 | 8 | 8 | 33.7 | 50.20 / 50.00 / 49.93 | 262 | 0.9908 / 0.9901 | 0.9986 / 0.9984 | 1.34 (1.00 / 1.02) | 85.7 / 87.6 %, 65.7 %, 34.4 %, 32 | 0.33 / 0.40 | — |
| `dbts_a2` top10 | 8 | 12 | 103.6 | 47.63 / 47.43 / 47.39 | 331 | 0.9836 / 0.9825 | 0.9968 / 0.9964 | 1.80 (1.05 / 1.07) | 88.9 / 90.5 %, 73.2 %, 46.4 %, 48 | 0.54 / 0.66 | — |
| `dbts_a2` top10 | 8 | 16 | 269.3 | 46.54 / 46.29 / 46.28 | 355 | 0.9796 / 0.9780 | 0.9952 / 0.9946 | 2.03 (1.05 / 1.08) | 89.9 / 91.4 %, 75.6 %, 50.5 %, 62 | 0.72 / 0.87 | — |
| `dbts_a2` top10 | 8 | 24 | 805.7 | 45.60 / 45.25 / 45.18 | 508 | 0.9767 / 0.9746 | 0.9928 / 0.9915 | 2.26 (1.06 / 1.08) | 90.9 / 92.1 %, 77.6 %, 53.8 %, 85 | 0.99 / 1.26 | — |
| `dbts_a2` top10 | 8 | 32 | 2034.1 | 44.68 / 44.38 / 44.35 | 608 | 0.9747 / 0.9724 | 0.9901 / 0.9886 | 2.50 (1.06 / 1.09) | 91.9 / 92.9 %, 79.5 %, 56.8 %, 96 | 1.31 / 1.61 | — |
| `dbts_a2` top10 | 8 | 40 | 4316.2 | 43.57 / 43.22 / 43.19 | 839 | 0.9698 / 0.9683 | 0.9867 / 0.9841 | 2.77 (1.06 / 1.09) | 92.8 / 93.6 %, 81.4 %, 60.0 %, 176 | 1.66 / 2.07 | — |
| `dbts_a2` top10 | 8 | 56 | 14121.7 | 40.68 / 39.85 / 39.63 | 1888 | 0.9542 / 0.9502 | 0.9765 / 0.9725 | 3.76 (1.06 / 1.08) | 94.3 / 94.6 %, 84.2 %, 65.1 %, 205 | 2.67 / 3.30 | — |
| `dbts_a2` window | 1 | 1 | 3.5 | 9.43 / 8.01 / 7.87 | 2244 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.42 / 0.46) | 27.2 / 29.0 %, 20.7 %, 15.7 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 1 | 2 | 4.3 | 9.43 / 8.01 / 7.87 | 2244 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.43 / 0.46) | 32.2 / 33.8 %, 21.0 %, 16.0 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 1 | 4 | 5.4 | 9.43 / 8.01 / 7.87 | 2246 | 0.6127 / 0.4516 | 0.8982 / 0.8600 | 4.52 (0.44 / 0.47) | 42.0 / 43.5 %, 21.5 %, 16.5 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 1 | 8 | 7.6 | 9.43 / 8.01 / 7.87 | 2252 | 0.6124 / 0.4514 | 0.8982 / 0.8600 | 4.52 (0.48 / 0.52) | 61.7 / 62.8 %, 27.2 %, 16.9 %, 31 | 3.16 / 3.75 | — |
| `dbts_a2` window | 1 | 12 | 9.9 | 9.43 / 8.01 / 7.87 | 2257 | 0.6119 / 0.4510 | 0.8981 / 0.8599 | 4.54 (0.56 / 0.60) | 73.7 / 74.5 %, 39.0 %, 18.2 %, 33 | 3.16 / 3.75 | — |
| `dbts_a2` window | 1 | 16 | 12.5 | 9.43 / 8.01 / 7.87 | 2256 | 0.6112 / 0.4504 | 0.8980 / 0.8599 | 4.55 (0.65 / 0.70) | 80.1 / 80.7 %, 49.4 %, 21.3 %, 34 | 3.16 / 3.75 | — |
| `dbts_a2` window | 1 | 24 | 19.0 | 9.43 / 8.01 / 7.87 | 2272 | 0.6092 / 0.4489 | 0.8977 / 0.8597 | 4.60 (0.83 / 0.87) | 86.5 / 86.9 %, 63.1 %, 31.4 %, 38 | 3.18 / 3.77 | — |
| `dbts_a2` window | 1 | 32 | 43.0 | 9.43 / 8.01 / 7.87 | 2275 | 0.6043 / 0.4442 | 0.8968 / 0.8590 | 4.71 (1.01 / 1.03) | 91.2 / 91.3 %, 74.8 %, 46.9 %, 48 | 3.19 / 3.78 | — |
| `dbts_a2` window | 1 | 40 | 142.2 | 9.43 / 8.00 / 7.87 | 2276 | 0.5974 / 0.4378 | 0.8950 / 0.8575 | 4.90 (1.05 / 1.07) | 93.1 / 93.4 %, 80.7 %, 57.4 %, 56 | 3.24 / 3.82 | — |
| `dbts_a2` window | 1 | 56 | 1183.9 | 9.42 / 8.00 / 7.87 | 2298 | 0.5918 / 0.4335 | 0.8900 / 0.8537 | 5.17 (1.05 / 1.07) | 94.5 / 94.8 %, 84.4 %, 64.8 %, 137 | 3.46 / 4.04 | — |
| `dbts_a2` window | 16 | 1 | 3.5 | 9.43 / 8.01 / 7.87 | 2245 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.42 / 0.46) | 27.5 / 29.4 %, 20.8 %, 15.8 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 16 | 2 | 4.2 | 9.43 / 8.01 / 7.87 | 2246 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.43 / 0.46) | 32.3 / 34.0 %, 20.9 %, 16.0 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 16 | 4 | 5.4 | 9.43 / 8.01 / 7.87 | 2246 | 0.6127 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.44 / 0.47) | 42.3 / 43.8 %, 21.3 %, 16.4 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 16 | 8 | 7.6 | 9.43 / 8.01 / 7.87 | 2249 | 0.6124 / 0.4513 | 0.8982 / 0.8600 | 4.52 (0.48 / 0.52) | 62.0 / 63.1 %, 27.1 %, 16.8 %, 31 | 3.16 / 3.75 | — |
| `dbts_a2` window | 16 | 12 | 9.9 | 9.43 / 8.01 / 7.87 | 2252 | 0.6119 / 0.4510 | 0.8981 / 0.8599 | 4.54 (0.56 / 0.60) | 74.0 / 74.7 %, 39.3 %, 18.1 %, 32 | 3.16 / 3.75 | — |
| `dbts_a2` window | 16 | 16 | 12.5 | 9.43 / 8.01 / 7.87 | 2256 | 0.6112 / 0.4504 | 0.8980 / 0.8599 | 4.55 (0.65 / 0.70) | 80.2 / 80.8 %, 49.7 %, 21.5 %, 33 | 3.16 / 3.75 | — |
| `dbts_a2` window | 16 | 24 | 18.9 | 9.43 / 8.01 / 7.87 | 2262 | 0.6092 / 0.4488 | 0.8977 / 0.8597 | 4.59 (0.83 / 0.86) | 86.4 / 86.9 %, 63.1 %, 31.4 %, 35 | 3.17 / 3.76 | — |
| `dbts_a2` window | 16 | 32 | 42.8 | 9.43 / 8.01 / 7.87 | 2275 | 0.6046 / 0.4445 | 0.8968 / 0.8590 | 4.71 (1.00 / 1.03) | 91.0 / 91.3 %, 74.6 %, 46.9 %, 45 | 3.19 / 3.78 | — |
| `dbts_a2` window | 16 | 40 | 168.1 | 9.43 / 8.00 / 7.87 | 2282 | 0.5978 / 0.4380 | 0.8951 / 0.8575 | 4.89 (1.05 / 1.07) | 93.1 / 93.4 %, 80.6 %, 57.2 %, 56 | 3.24 / 3.82 | — |
| `dbts_a2` window | 16 | 56 | 2967.3 | 9.42 / 8.00 / 7.87 | 2298 | 0.5915 / 0.4334 | 0.8899 / 0.8536 | 5.18 (1.05 / 1.07) | 94.5 / 94.8 %, 84.5 %, 64.9 %, 117 | 3.47 / 4.05 | — |
| `dbts_a2` window | 8 | 1 | 3.5 | 9.43 / 8.01 / 7.87 | 2244 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.42 / 0.46) | 27.6 / 29.4 %, 20.7 %, 15.8 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 8 | 2 | 4.2 | 9.43 / 8.01 / 7.87 | 2245 | 0.6128 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.43 / 0.46) | 32.3 / 34.0 %, 20.9 %, 16.0 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 8 | 4 | 5.4 | 9.43 / 8.01 / 7.87 | 2247 | 0.6127 / 0.4516 | 0.8982 / 0.8600 | 4.51 (0.44 / 0.47) | 42.2 / 43.7 %, 21.3 %, 16.4 %, 30 | 3.15 / 3.74 | — |
| `dbts_a2` window | 8 | 8 | 7.6 | 9.43 / 8.01 / 7.87 | 2254 | 0.6124 / 0.4513 | 0.8982 / 0.8600 | 4.52 (0.48 / 0.52) | 62.0 / 63.0 %, 27.1 %, 16.8 %, 31 | 3.16 / 3.75 | — |
| `dbts_a2` window | 8 | 12 | 9.9 | 9.43 / 8.01 / 7.87 | 2252 | 0.6119 / 0.4510 | 0.8981 / 0.8599 | 4.54 (0.56 / 0.61) | 73.9 / 74.8 %, 39.4 %, 18.2 %, 31 | 3.16 / 3.75 | — |
| `dbts_a2` window | 8 | 16 | 12.5 | 9.43 / 8.01 / 7.87 | 2253 | 0.6112 / 0.4504 | 0.8980 / 0.8599 | 4.55 (0.65 / 0.70) | 80.2 / 80.8 %, 49.7 %, 21.5 %, 33 | 3.16 / 3.76 | — |
| `dbts_a2` window | 8 | 24 | 18.9 | 9.43 / 8.01 / 7.87 | 2262 | 0.6093 / 0.4488 | 0.8976 / 0.8597 | 4.59 (0.83 / 0.86) | 86.4 / 86.8 %, 63.1 %, 31.5 %, 33 | 3.17 / 3.76 | — |
| `dbts_a2` window | 8 | 32 | 42.9 | 9.43 / 8.01 / 7.87 | 2275 | 0.6046 / 0.4445 | 0.8968 / 0.8590 | 4.71 (1.01 / 1.03) | 91.1 / 91.3 %, 74.8 %, 46.9 %, 45 | 3.19 / 3.78 | — |
| `dbts_a2` window | 8 | 40 | 167.4 | 9.43 / 8.00 / 7.87 | 2266 | 0.5978 / 0.4380 | 0.8951 / 0.8575 | 4.89 (1.05 / 1.07) | 93.1 / 93.4 %, 80.6 %, 57.2 %, 50 | 3.24 / 3.82 | — |
| `dbts_a2` window | 8 | 56 | 2816.6 | 9.42 / 8.00 / 7.87 | 2315 | 0.5916 / 0.4334 | 0.8900 / 0.8536 | 5.17 (1.05 / 1.07) | 94.5 / 94.8 %, 84.5 %, 65.0 %, 136 | 3.47 / 4.05 | — |
| `dbts_b1` 10bit | 1 | 1 | 6.3 | 68.85 / 68.77 / 68.76 | 11 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.11 (0.12 / 0.12) | 19.2 / 19.3 %, 0.0 %, 0.0 %, 2 | 0.03 / 0.04 | 10.0 |
| `dbts_b1` 10bit | 1 | 2 | 7.9 | 64.91 / 64.81 / 64.79 | 19 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.19) | 35.6 / 35.8 %, 0.4 %, 0.0 %, 3 | 0.05 / 0.06 | 10.0 |
| `dbts_b1` 10bit | 1 | 4 | 11.2 | 59.27 / 59.12 / 59.11 | 36 | 0.9990 / 0.9990 | 0.9999 / 0.9999 | 0.34 (0.36 / 0.38) | 60.8 / 61.1 %, 12.5 %, 0.0 %, 6 | 0.10 / 0.11 | 10.0 |
| `dbts_b1` 10bit | 1 | 8 | 22.7 | 51.94 / 51.86 / 51.85 | 131 | 0.9945 / 0.9944 | 0.9993 / 0.9993 | 0.80 (0.80 / 0.82) | 82.1 / 82.2 %, 49.9 %, 11.4 %, 29 | 0.22 / 0.25 | 9.96 |
| `dbts_b1` 10bit | 1 | 12 | 49.0 | 48.33 / 48.24 / 48.21 | 223 | 0.9873 / 0.9869 | 0.9982 / 0.9981 | 1.22 (0.99 / 1.00) | 88.0 / 88.2 %, 65.6 %, 29.9 %, 51 | 0.37 / 0.42 | 9.86 |
| `dbts_b1` 10bit | 1 | 16 | 94.3 | 46.59 / 46.51 / 46.48 | 269 | 0.9811 / 0.9804 | 0.9969 / 0.9966 | 1.49 (1.03 / 1.03) | 90.1 / 90.2 %, 71.3 %, 39.1 %, 59 | 0.52 / 0.60 | 9.71 |
| `dbts_b1` 10bit | 1 | 24 | 201.5 | 45.25 / 45.14 / 45.10 | 292 | 0.9752 / 0.9744 | 0.9948 / 0.9941 | 1.73 (1.03 / 1.04) | 91.4 / 91.6 %, 75.0 %, 45.9 %, 73 | 0.76 / 0.89 | 9.29 |
| `dbts_b1` 10bit | 1 | 32 | 437.2 | 44.01 / 43.88 / 43.82 | 349 | 0.9693 / 0.9681 | 0.9911 / 0.9898 | 1.99 (1.04 / 1.05) | 92.4 / 92.6 %, 78.1 %, 51.6 %, 83 | 1.16 / 1.35 | 8.34 |
| `dbts_b1` 10bit | 1 | 40 | 876.0 | 42.72 / 42.51 / 42.49 | 391 | 0.9608 / 0.9600 | 0.9863 / 0.9855 | 2.27 (1.09 / 1.11) | 93.3 / 93.3 %, 80.2 %, 55.9 %, 128 | 1.57 / 1.83 | 6.95 |
| `dbts_b1` 10bit | 1 | 56 | 3524.6 | 39.52 / 39.35 / 39.31 | 547 | 0.9277 / 0.9198 | 0.9701 / 0.9689 | 3.12 (1.21 / 1.23) | 94.9 / 95.0 %, 85.2 %, 66.4 %, 154 | 2.70 / 3.03 | 4.29 |
| `dbts_b1` 10bit | 16 | 1 | 6.5 | 68.48 / 68.37 / 68.36 | 25 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.12 (0.12 / 0.12) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 9 | 0.04 / 0.04 | 10.0 |
| `dbts_b1` 10bit | 16 | 2 | 8.0 | 64.85 / 64.74 / 64.73 | 27 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.19) | 35.8 / 35.9 %, 0.4 %, 0.0 %, 12 | 0.05 / 0.06 | 10.0 |
| `dbts_b1` 10bit | 16 | 4 | 11.4 | 59.10 / 58.99 / 58.99 | 50 | 0.9990 / 0.9989 | 0.9999 / 0.9999 | 0.35 (0.36 / 0.38) | 61.4 / 61.5 %, 13.0 %, 0.0 %, 18 | 0.10 / 0.12 | 9.99 |
| `dbts_b1` 10bit | 16 | 8 | 23.0 | 52.05 / 51.97 / 51.88 | 86 | 0.9947 / 0.9945 | 0.9993 / 0.9993 | 0.79 (0.79 / 0.81) | 81.9 / 82.1 %, 49.8 %, 11.3 %, 34 | 0.22 / 0.26 | 9.96 |
| `dbts_b1` 10bit | 16 | 12 | 52.3 | 48.47 / 48.35 / 48.24 | 223 | 0.9877 / 0.9871 | 0.9983 / 0.9981 | 1.20 (0.99 / 1.00) | 87.8 / 88.2 %, 65.5 %, 29.9 %, 56 | 0.36 / 0.42 | 9.86 |
| `dbts_b1` 10bit | 16 | 16 | 115.4 | 46.70 / 46.57 / 46.51 | 229 | 0.9817 / 0.9807 | 0.9969 / 0.9966 | 1.47 (1.03 / 1.03) | 89.9 / 90.2 %, 71.2 %, 39.1 %, 73 | 0.52 / 0.61 | 9.7 |
| `dbts_b1` 10bit | 16 | 24 | 327.5 | 45.21 / 45.12 / 45.08 | 311 | 0.9753 / 0.9743 | 0.9947 / 0.9939 | 1.74 (1.04 / 1.04) | 91.4 / 91.6 %, 75.2 %, 46.2 %, 77 | 0.78 / 0.93 | 9.24 |
| `dbts_b1` 10bit | 16 | 32 | 992.2 | 43.96 / 43.84 / 43.81 | 378 | 0.9696 / 0.9683 | 0.9910 / 0.9893 | 2.00 (1.04 / 1.05) | 92.5 / 92.7 %, 78.4 %, 52.3 %, 86 | 1.18 / 1.43 | 8.28 |
| `dbts_b1` 10bit | 16 | 40 | 2685.3 | 42.63 / 42.40 / 42.38 | 457 | 0.9608 / 0.9600 | 0.9858 / 0.9847 | 2.30 (1.08 / 1.10) | 93.4 / 93.5 %, 80.6 %, 56.8 %, 120 | 1.63 / 1.94 | 6.8 |
| `dbts_b1` 10bit | 16 | 56 | 14360.7 | 39.30 / 38.96 / 38.95 | 531 | 0.9280 / 0.9217 | 0.9681 / 0.9664 | 3.22 (1.21 / 1.23) | 95.1 / 95.3 %, 85.9 %, 68.0 %, 146 | 2.90 / 3.21 | 4.08 |
| `dbts_b1` 10bit | 8 | 1 | 6.5 | 68.49 / 68.38 / 68.36 | 25 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.12 (0.12 / 0.12) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 8 | 0.04 / 0.04 | 10.0 |
| `dbts_b1` 10bit | 8 | 2 | 7.9 | 64.86 / 64.75 / 64.74 | 27 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.19) | 35.8 / 36.0 %, 0.4 %, 0.0 %, 12 | 0.05 / 0.06 | 10.0 |
| `dbts_b1` 10bit | 8 | 4 | 11.3 | 59.11 / 59.00 / 58.99 | 50 | 0.9990 / 0.9989 | 0.9999 / 0.9999 | 0.35 (0.36 / 0.38) | 61.4 / 61.5 %, 13.0 %, 0.0 %, 16 | 0.10 / 0.12 | 9.99 |
| `dbts_b1` 10bit | 8 | 8 | 22.9 | 52.05 / 51.93 / 51.86 | 131 | 0.9947 / 0.9944 | 0.9993 / 0.9993 | 0.79 (0.78 / 0.81) | 81.9 / 82.2 %, 49.8 %, 11.4 %, 31 | 0.22 / 0.26 | 9.96 |
| `dbts_b1` 10bit | 8 | 12 | 52.2 | 48.48 / 48.31 / 48.24 | 223 | 0.9877 / 0.9871 | 0.9983 / 0.9981 | 1.20 (0.99 / 1.00) | 87.8 / 88.2 %, 65.5 %, 29.9 %, 57 | 0.36 / 0.42 | 9.86 |
| `dbts_b1` 10bit | 8 | 16 | 114.1 | 46.70 / 46.58 / 46.51 | 251 | 0.9817 / 0.9807 | 0.9969 / 0.9966 | 1.47 (1.03 / 1.03) | 89.9 / 90.2 %, 71.2 %, 39.1 %, 76 | 0.52 / 0.61 | 9.7 |
| `dbts_b1` 10bit | 8 | 24 | 318.2 | 45.22 / 45.11 / 45.05 | 352 | 0.9752 / 0.9744 | 0.9946 / 0.9939 | 1.74 (1.04 / 1.04) | 91.4 / 91.6 %, 75.2 %, 46.2 %, 81 | 0.79 / 0.93 | 9.24 |
| `dbts_b1` 10bit | 8 | 32 | 929.7 | 43.95 / 43.83 / 43.79 | 399 | 0.9698 / 0.9682 | 0.9910 / 0.9893 | 2.00 (1.04 / 1.05) | 92.5 / 92.7 %, 78.4 %, 52.3 %, 97 | 1.18 / 1.43 | 8.29 |
| `dbts_b1` 10bit | 8 | 40 | 2410.3 | 42.62 / 42.40 / 42.35 | 457 | 0.9609 / 0.9602 | 0.9859 / 0.9847 | 2.30 (1.08 / 1.10) | 93.3 / 93.5 %, 80.6 %, 56.8 %, 140 | 1.63 / 1.94 | 6.83 |
| `dbts_b1` 10bit | 8 | 56 | 12465.0 | 39.38 / 39.04 / 38.95 | 504 | 0.9297 / 0.9222 | 0.9691 / 0.9667 | 3.21 (1.21 / 1.23) | 95.0 / 95.2 %, 85.8 %, 67.7 %, 146 | 2.86 / 3.25 | 4.16 |
| `dbts_b2` 10bit | 1 | 1 | 3.7 | 66.05 / 66.00 / 65.99 | 9 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.19) | 19.1 / 19.2 %, 0.0 %, 0.0 %, 2 | 0.06 / 0.07 | 10.0 |
| `dbts_b2` 10bit | 1 | 2 | 4.8 | 62.02 / 61.96 / 61.95 | 18 | 0.9994 / 0.9994 | 0.9999 / 0.9999 | 0.30 (0.30 / 0.30) | 35.9 / 36.1 %, 0.4 %, 0.0 %, 4 | 0.09 / 0.11 | 10.0 |
| `dbts_b2` 10bit | 1 | 4 | 7.6 | 56.12 / 56.05 / 56.05 | 31 | 0.9977 / 0.9977 | 0.9997 / 0.9997 | 0.58 (0.61 / 0.61) | 62.0 / 62.0 %, 13.7 %, 0.1 %, 8 | 0.18 / 0.20 | 9.99 |
| `dbts_b2` 10bit | 1 | 8 | 19.1 | 49.73 / 49.69 / 49.68 | 110 | 0.9901 / 0.9901 | 0.9985 / 0.9985 | 1.22 (0.96 / 0.96) | 80.7 / 80.8 %, 46.7 %, 9.1 %, 18 | 0.40 / 0.45 | 9.95 |
| `dbts_b2` 10bit | 1 | 12 | 39.3 | 46.95 / 46.91 / 46.91 | 206 | 0.9816 / 0.9812 | 0.9965 / 0.9964 | 1.67 (1.01 / 1.02) | 85.7 / 85.8 %, 59.3 %, 21.7 %, 41 | 0.64 / 0.74 | 9.83 |
| `dbts_b2` 10bit | 1 | 16 | 70.0 | 45.47 / 45.43 / 45.42 | 260 | 0.9746 / 0.9741 | 0.9944 / 0.9941 | 1.98 (1.03 / 1.03) | 87.8 / 87.9 %, 64.9 %, 29.4 %, 56 | 0.87 / 1.00 | 9.65 |
| `dbts_b2` 10bit | 1 | 24 | 153.9 | 44.03 / 43.99 / 43.98 | 260 | 0.9666 / 0.9657 | 0.9907 / 0.9900 | 2.34 (1.03 / 1.04) | 89.5 / 89.7 %, 69.7 %, 36.7 %, 70 | 1.27 / 1.47 | 9.12 |
| `dbts_b2` 10bit | 1 | 32 | 352.4 | 42.82 / 42.73 / 42.72 | 334 | 0.9604 / 0.9590 | 0.9858 / 0.9848 | 2.67 (1.04 / 1.05) | 90.7 / 90.8 %, 72.9 %, 42.3 %, 74 | 1.80 / 2.09 | 8.11 |
| `dbts_b2` 10bit | 1 | 40 | 683.1 | 41.66 / 41.52 / 41.50 | 404 | 0.9541 / 0.9532 | 0.9803 / 0.9791 | 2.98 (1.09 / 1.11) | 91.5 / 91.7 %, 75.4 %, 46.7 %, 115 | 2.34 / 2.74 | 7.1 |
| `dbts_b2` 10bit | 1 | 56 | 2613.7 | 38.69 / 38.38 / 38.35 | 536 | 0.9343 / 0.9305 | 0.9611 / 0.9585 | 4.06 (1.13 / 1.18) | 93.5 / 93.8 %, 81.4 %, 58.5 %, 178 | 4.09 / 4.44 | 4.4 |
| `dbts_b2` 10bit | 16 | 1 | 3.9 | 65.66 / 65.59 / 65.59 | 22 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.19) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 2 | 0.07 / 0.07 | 10.0 |
| `dbts_b2` 10bit | 16 | 2 | 4.9 | 61.98 / 61.92 / 61.92 | 24 | 0.9994 / 0.9994 | 0.9999 / 0.9999 | 0.30 (0.30 / 0.30) | 36.1 / 36.2 %, 0.5 %, 0.0 %, 3 | 0.10 / 0.11 | 10.0 |
| `dbts_b2` 10bit | 16 | 4 | 7.7 | 56.12 / 56.07 / 56.05 | 44 | 0.9977 / 0.9977 | 0.9997 / 0.9997 | 0.58 (0.60 / 0.61) | 61.9 / 62.1 %, 13.7 %, 0.1 %, 13 | 0.18 / 0.21 | 9.99 |
| `dbts_b2` 10bit | 16 | 8 | 20.3 | 49.86 / 49.78 / 49.70 | 77 | 0.9905 / 0.9901 | 0.9986 / 0.9985 | 1.20 (0.95 / 0.96) | 80.4 / 80.8 %, 46.6 %, 9.1 %, 22 | 0.40 / 0.46 | 9.95 |
| `dbts_b2` 10bit | 16 | 12 | 47.2 | 47.02 / 46.97 / 46.92 | 259 | 0.9820 / 0.9813 | 0.9966 / 0.9964 | 1.66 (1.01 / 1.02) | 85.6 / 85.8 %, 59.2 %, 21.7 %, 31 | 0.65 / 0.77 | 9.82 |
| `dbts_b2` 10bit | 16 | 16 | 98.7 | 45.50 / 45.45 / 45.43 | 244 | 0.9749 / 0.9742 | 0.9943 / 0.9940 | 1.97 (1.03 / 1.03) | 87.8 / 87.9 %, 65.1 %, 29.4 %, 47 | 0.90 / 1.05 | 9.61 |
| `dbts_b2` 10bit | 16 | 24 | 302.9 | 43.92 / 43.87 / 43.83 | 307 | 0.9663 / 0.9652 | 0.9902 / 0.9894 | 2.36 (1.03 / 1.04) | 89.6 / 89.9 %, 70.2 %, 37.6 %, 55 | 1.34 / 1.60 | 8.98 |
| `dbts_b2` 10bit | 16 | 32 | 994.9 | 42.64 / 42.55 / 42.53 | 389 | 0.9599 / 0.9592 | 0.9849 / 0.9839 | 2.73 (1.04 / 1.06) | 90.9 / 91.0 %, 73.4 %, 43.2 %, 74 | 1.89 / 2.21 | 7.98 |
| `dbts_b2` 10bit | 16 | 40 | 2464.9 | 41.47 / 41.26 / 41.24 | 442 | 0.9539 / 0.9533 | 0.9790 / 0.9780 | 3.07 (1.08 / 1.11) | 91.8 / 91.9 %, 76.1 %, 48.1 %, 124 | 2.49 / 2.85 | 6.98 |
| `dbts_b2` 10bit | 16 | 56 | 13587.3 | 38.42 / 38.02 / 37.95 | 584 | 0.9325 / 0.9307 | 0.9588 / 0.9544 | 4.22 (1.13 / 1.18) | 93.7 / 94.0 %, 82.1 %, 59.9 %, 176 | 4.25 / 4.62 | 4.28 |
| `dbts_b2` 10bit | 8 | 1 | 3.9 | 65.67 / 65.60 / 65.59 | 22 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.19) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 3 | 0.06 / 0.07 | 10.0 |
| `dbts_b2` 10bit | 8 | 2 | 4.9 | 61.99 / 61.93 / 61.92 | 24 | 0.9994 / 0.9994 | 0.9999 / 0.9999 | 0.30 (0.30 / 0.30) | 36.1 / 36.2 %, 0.5 %, 0.0 %, 3 | 0.09 / 0.11 | 10.0 |
| `dbts_b2` 10bit | 8 | 4 | 7.7 | 56.13 / 56.07 / 56.05 | 44 | 0.9977 / 0.9977 | 0.9997 / 0.9997 | 0.58 (0.60 / 0.61) | 61.9 / 62.1 %, 13.7 %, 0.1 %, 13 | 0.18 / 0.21 | 9.99 |
| `dbts_b2` 10bit | 8 | 8 | 20.2 | 49.86 / 49.73 / 49.69 | 88 | 0.9905 / 0.9901 | 0.9986 / 0.9985 | 1.20 (0.95 / 0.96) | 80.4 / 80.8 %, 46.6 %, 9.1 %, 23 | 0.40 / 0.46 | 9.95 |
| `dbts_b2` 10bit | 8 | 12 | 46.8 | 47.02 / 46.95 / 46.92 | 125 | 0.9819 / 0.9813 | 0.9965 / 0.9964 | 1.66 (1.01 / 1.02) | 85.6 / 85.8 %, 59.2 %, 21.7 %, 30 | 0.65 / 0.77 | 9.82 |
| `dbts_b2` 10bit | 8 | 16 | 97.2 | 45.49 / 45.44 / 45.43 | 244 | 0.9748 / 0.9742 | 0.9944 / 0.9940 | 1.98 (1.03 / 1.03) | 87.8 / 87.9 %, 65.1 %, 29.4 %, 56 | 0.90 / 1.05 | 9.61 |
| `dbts_b2` 10bit | 8 | 24 | 292.6 | 43.92 / 43.86 / 43.83 | 307 | 0.9663 / 0.9652 | 0.9902 / 0.9894 | 2.36 (1.03 / 1.04) | 89.6 / 89.9 %, 70.2 %, 37.6 %, 70 | 1.34 / 1.60 | 8.97 |
| `dbts_b2` 10bit | 8 | 32 | 924.9 | 42.65 / 42.57 / 42.56 | 374 | 0.9601 / 0.9592 | 0.9851 / 0.9840 | 2.72 (1.04 / 1.05) | 90.8 / 91.0 %, 73.4 %, 43.1 %, 78 | 1.89 / 2.21 | 7.98 |
| `dbts_b2` 10bit | 8 | 40 | 2195.4 | 41.50 / 41.31 / 41.28 | 442 | 0.9540 / 0.9533 | 0.9794 / 0.9781 | 3.06 (1.08 / 1.11) | 91.7 / 91.9 %, 76.1 %, 48.1 %, 136 | 2.46 / 2.85 | 6.95 |
| `dbts_b2` 10bit | 8 | 56 | 11227.0 | 38.47 / 38.08 / 38.01 | 535 | 0.9342 / 0.9310 | 0.9594 / 0.9553 | 4.19 (1.13 / 1.18) | 93.6 / 93.9 %, 82.0 %, 59.7 %, 187 | 4.24 / 4.58 | 4.3 |
| `dbts_b3` 10bit | 1 | 1 | 4.1 | 67.10 / 67.02 / 67.02 | 19 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.11 (0.11 / 0.11) | 19.2 / 19.2 %, 0.0 %, 0.0 %, 2 | 0.05 / 0.06 | 10.0 |
| `dbts_b3` 10bit | 1 | 2 | 5.1 | 63.16 / 63.07 / 63.06 | 21 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.18 (0.18 / 0.18) | 35.6 / 35.7 %, 0.4 %, 0.0 %, 3 | 0.08 / 0.09 | 10.0 |
| `dbts_b3` 10bit | 1 | 4 | 7.2 | 57.47 / 57.36 / 57.35 | 35 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.34 (0.35 / 0.36) | 61.0 / 61.1 %, 12.6 %, 0.0 %, 6 | 0.15 / 0.17 | 9.99 |
| `dbts_b3` 10bit | 1 | 8 | 13.7 | 50.28 / 50.20 / 50.20 | 85 | 0.9922 / 0.9921 | 0.9990 / 0.9989 | 0.78 (0.76 / 0.76) | 81.9 / 82.0 %, 49.4 %, 11.0 %, 31 | 0.34 / 0.39 | 9.96 |
| `dbts_b3` 10bit | 1 | 12 | 26.9 | 46.51 / 46.45 / 46.44 | 237 | 0.9814 / 0.9809 | 0.9973 / 0.9971 | 1.20 (0.96 / 0.96) | 88.1 / 88.2 %, 65.6 %, 29.8 %, 57 | 0.55 / 0.65 | 9.86 |
| `dbts_b3` 10bit | 1 | 16 | 49.6 | 44.54 / 44.47 / 44.47 | 337 | 0.9707 / 0.9697 | 0.9952 / 0.9947 | 1.51 (1.02 / 1.02) | 90.5 / 90.5 %, 72.1 %, 40.5 %, 92 | 0.76 / 0.90 | 9.69 |
| `dbts_b3` 10bit | 1 | 24 | 123.4 | 42.82 / 42.75 / 42.74 | 369 | 0.9575 / 0.9555 | 0.9913 / 0.9901 | 1.84 (1.04 / 1.04) | 92.1 / 92.2 %, 76.8 %, 49.2 %, 113 | 1.15 / 1.36 | 9.18 |
| `dbts_b3` 10bit | 1 | 32 | 286.7 | 41.67 / 41.60 / 41.58 | 435 | 0.9489 / 0.9471 | 0.9864 / 0.9849 | 2.09 (1.04 / 1.05) | 92.9 / 93.0 %, 79.2 %, 53.9 %, 135 | 1.70 / 2.01 | 8.19 |
| `dbts_b3` 10bit | 1 | 40 | 515.3 | 40.64 / 40.49 / 40.47 | 491 | 0.9404 / 0.9395 | 0.9807 / 0.9793 | 2.34 (1.09 / 1.10) | 93.6 / 93.6 %, 81.1 %, 57.7 %, 164 | 2.27 / 2.71 | 7.1 |
| `dbts_b3` 10bit | 1 | 56 | 2005.0 | 37.44 / 37.06 / 37.05 | 799 | 0.9152 / 0.9101 | 0.9582 / 0.9543 | 3.26 (1.23 / 1.25) | 95.1 / 95.2 %, 85.8 %, 67.5 %, 254 | 4.22 / 4.75 | 4.26 |
| `dbts_b3` 10bit | 16 | 1 | 4.3 | 66.76 / 66.67 / 66.66 | 23 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.12 (0.12 / 0.12) | 20.3 / 20.3 %, 0.0 %, 0.0 %, 9 | 0.06 / 0.07 | 10.0 |
| `dbts_b3` 10bit | 16 | 2 | 5.3 | 63.14 / 63.05 / 63.05 | 34 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.18 (0.18 / 0.18) | 35.7 / 35.8 %, 0.4 %, 0.0 %, 15 | 0.08 / 0.10 | 10.0 |
| `dbts_b3` 10bit | 16 | 4 | 7.5 | 57.37 / 57.28 / 57.27 | 42 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.34 (0.35 / 0.35) | 61.4 / 61.5 %, 12.9 %, 0.0 %, 21 | 0.15 / 0.18 | 9.99 |
| `dbts_b3` 10bit | 16 | 8 | 14.7 | 50.40 / 50.33 / 50.22 | 78 | 0.9925 / 0.9921 | 0.9990 / 0.9989 | 0.77 (0.74 / 0.76) | 81.7 / 81.9 %, 49.3 %, 11.0 %, 37 | 0.34 / 0.40 | 9.95 |
| `dbts_b3` 10bit | 16 | 12 | 30.5 | 46.67 / 46.59 / 46.44 | 165 | 0.9821 / 0.9811 | 0.9974 / 0.9972 | 1.18 (0.96 / 0.96) | 87.9 / 88.1 %, 65.5 %, 29.8 %, 50 | 0.55 / 0.65 | 9.86 |
| `dbts_b3` 10bit | 16 | 16 | 63.0 | 44.62 / 44.56 / 44.49 | 241 | 0.9714 / 0.9702 | 0.9952 / 0.9947 | 1.50 (1.02 / 1.02) | 90.4 / 90.5 %, 72.1 %, 40.5 %, 70 | 0.78 / 0.93 | 9.65 |
| `dbts_b3` 10bit | 16 | 24 | 223.0 | 42.71 / 42.64 / 42.59 | 328 | 0.9571 / 0.9548 | 0.9907 / 0.9895 | 1.86 (1.04 / 1.04) | 92.2 / 92.3 %, 77.3 %, 50.3 %, 95 | 1.23 / 1.52 | 9.01 |
| `dbts_b3` 10bit | 16 | 32 | 733.3 | 41.54 / 41.49 / 41.46 | 433 | 0.9486 / 0.9473 | 0.9858 / 0.9844 | 2.12 (1.04 / 1.05) | 93.0 / 93.1 %, 79.5 %, 54.6 %, 101 | 1.78 / 2.15 | 8.06 |
| `dbts_b3` 10bit | 16 | 40 | 1614.0 | 40.38 / 40.27 / 40.24 | 528 | 0.9402 / 0.9391 | 0.9796 / 0.9778 | 2.40 (1.08 / 1.10) | 93.7 / 93.8 %, 81.6 %, 58.8 %, 205 | 2.43 / 2.84 | 6.92 |
| `dbts_b3` 10bit | 16 | 56 | 9331.5 | 36.99 / 36.73 / 36.68 | 858 | 0.9132 / 0.9103 | 0.9547 / 0.9500 | 3.44 (1.23 / 1.25) | 95.2 / 95.4 %, 86.3 %, 68.8 %, 250 | 4.61 / 5.00 | 4.17 |
| `dbts_b3` 10bit | 8 | 1 | 4.3 | 66.78 / 66.68 / 66.66 | 23 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.12 (0.12 / 0.12) | 20.3 / 20.3 %, 0.0 %, 0.0 %, 9 | 0.06 / 0.07 | 10.0 |
| `dbts_b3` 10bit | 8 | 2 | 5.3 | 63.15 / 63.06 / 63.05 | 34 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.18 (0.18 / 0.18) | 35.7 / 35.8 %, 0.4 %, 0.0 %, 11 | 0.08 / 0.10 | 10.0 |
| `dbts_b3` 10bit | 8 | 4 | 7.5 | 57.38 / 57.28 / 57.27 | 42 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.34 (0.35 / 0.36) | 61.4 / 61.5 %, 12.9 %, 0.0 %, 17 | 0.15 / 0.18 | 9.99 |
| `dbts_b3` 10bit | 8 | 8 | 14.6 | 50.38 / 50.27 / 50.22 | 78 | 0.9925 / 0.9921 | 0.9990 / 0.9989 | 0.77 (0.74 / 0.76) | 81.7 / 81.9 %, 49.4 %, 11.0 %, 29 | 0.34 / 0.40 | 9.95 |
| `dbts_b3` 10bit | 8 | 12 | 30.3 | 46.66 / 46.50 / 46.44 | 138 | 0.9821 / 0.9810 | 0.9974 / 0.9972 | 1.18 (0.96 / 0.96) | 87.9 / 88.2 %, 65.5 %, 29.8 %, 69 | 0.55 / 0.65 | 9.86 |
| `dbts_b3` 10bit | 8 | 16 | 62.3 | 44.61 / 44.52 / 44.48 | 237 | 0.9713 / 0.9698 | 0.9952 / 0.9947 | 1.50 (1.02 / 1.02) | 90.4 / 90.5 %, 72.1 %, 40.5 %, 63 | 0.78 / 0.93 | 9.65 |
| `dbts_b3` 10bit | 8 | 24 | 216.3 | 42.71 / 42.63 / 42.59 | 287 | 0.9570 / 0.9543 | 0.9907 / 0.9893 | 1.86 (1.04 / 1.04) | 92.2 / 92.3 %, 77.3 %, 50.3 %, 107 | 1.24 / 1.52 | 9.01 |
| `dbts_b3` 10bit | 8 | 32 | 681.4 | 41.56 / 41.49 / 41.46 | 420 | 0.9486 / 0.9471 | 0.9859 / 0.9846 | 2.12 (1.04 / 1.05) | 93.0 / 93.1 %, 79.5 %, 54.6 %, 135 | 1.78 / 2.15 | 8.08 |
| `dbts_b3` 10bit | 8 | 40 | 1452.5 | 40.46 / 40.29 / 40.26 | 615 | 0.9402 / 0.9391 | 0.9799 / 0.9778 | 2.38 (1.08 / 1.10) | 93.6 / 93.8 %, 81.5 %, 58.7 %, 226 | 2.39 / 2.84 | 6.96 |
| `dbts_b3` 10bit | 8 | 56 | 7882.3 | 37.18 / 36.78 / 36.72 | 858 | 0.9139 / 0.9104 | 0.9566 / 0.9508 | 3.34 (1.23 / 1.25) | 95.1 / 95.4 %, 86.2 %, 68.6 %, 250 | 4.50 / 5.00 | 4.21 |
| `dbts_b5` 10bit | 1 | 1 | 6.6 | 68.65 / 68.60 / 68.56 | 5 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.17 (0.17 / 0.18) | 19.2 / 19.2 %, 0.0 %, 0.0 %, 2 | 0.05 / 0.05 | 10.0 |
| `dbts_b5` 10bit | 1 | 2 | 8.5 | 64.24 / 64.16 / 64.14 | 8 | 0.9996 / 0.9996 | 1.0000 / 0.9999 | 0.27 (0.28 / 0.28) | 36.0 / 36.1 %, 0.5 %, 0.0 %, 4 | 0.08 / 0.09 | 10.0 |
| `dbts_b5` 10bit | 1 | 4 | 12.9 | 58.40 / 58.33 / 58.32 | 22 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.54 (0.56 / 0.57) | 62.0 / 62.1 %, 13.7 %, 0.1 %, 8 | 0.14 / 0.17 | 9.99 |
| `dbts_b5` 10bit | 1 | 8 | 29.4 | 51.90 / 51.84 / 51.82 | 36 | 0.9938 / 0.9937 | 0.9992 / 0.9991 | 1.14 (0.92 / 0.93) | 81.0 / 81.1 %, 47.4 %, 9.6 %, 16 | 0.33 / 0.38 | 9.95 |
| `dbts_b5` 10bit | 1 | 12 | 55.1 | 49.04 / 49.00 / 48.99 | 59 | 0.9878 / 0.9872 | 0.9981 / 0.9978 | 1.60 (1.00 / 1.01) | 86.2 / 86.3 %, 60.6 %, 23.2 %, 29 | 0.52 / 0.60 | 9.86 |
| `dbts_b5` 10bit | 1 | 16 | 92.1 | 47.46 / 47.42 / 47.41 | 98 | 0.9830 / 0.9826 | 0.9969 / 0.9965 | 1.94 (1.03 / 1.03) | 88.4 / 88.6 %, 66.6 %, 31.8 %, 49 | 0.71 / 0.82 | 9.71 |
| `dbts_b5` 10bit | 1 | 24 | 194.1 | 45.80 / 45.75 / 45.74 | 129 | 0.9767 / 0.9758 | 0.9947 / 0.9940 | 2.37 (1.04 / 1.05) | 90.3 / 90.5 %, 72.0 %, 40.6 %, 64 | 1.05 / 1.21 | 9.31 |
| `dbts_b5` 10bit | 1 | 32 | 475.1 | 44.29 / 44.15 / 44.13 | 202 | 0.9697 / 0.9685 | 0.9910 / 0.9899 | 2.83 (1.05 / 1.06) | 91.7 / 91.7 %, 75.6 %, 47.2 %, 74 | 1.60 / 1.84 | 8.4 |
| `dbts_b5` 10bit | 1 | 40 | 953.6 | 43.04 / 42.77 / 42.70 | 333 | 0.9630 / 0.9590 | 0.9864 / 0.9856 | 3.25 (1.05 / 1.07) | 92.6 / 92.8 %, 78.7 %, 53.2 %, 102 | 2.22 / 2.56 | 7.21 |
| `dbts_b5` 10bit | 1 | 56 | 3287.6 | 39.72 / 39.11 / 39.06 | 635 | 0.9286 / 0.8902 | 0.9682 / 0.9630 | 4.60 (1.10 / 1.15) | 94.7 / 95.0 %, 85.0 %, 66.1 %, 148 | 4.08 / 4.67 | 4.41 |
| `dbts_b5` 10bit | 16 | 1 | 6.7 | 67.81 / 67.45 / 67.07 | 17 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.18) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 2 | 0.05 / 0.06 | 10.0 |
| `dbts_b5` 10bit | 16 | 2 | 8.4 | 64.22 / 64.00 / 63.80 | 19 | 0.9996 / 0.9995 | 1.0000 / 0.9999 | 0.27 (0.28 / 0.28) | 36.0 / 36.2 %, 0.5 %, 0.0 %, 4 | 0.08 / 0.09 | 10.0 |
| `dbts_b5` 10bit | 16 | 4 | 12.7 | 58.35 / 58.21 / 58.16 | 30 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.55 / 0.56) | 61.8 / 62.1 %, 13.7 %, 0.0 %, 11 | 0.15 / 0.17 | 9.99 |
| `dbts_b5` 10bit | 16 | 8 | 30.1 | 52.09 / 51.96 / 51.84 | 43 | 0.9940 / 0.9937 | 0.9992 / 0.9991 | 1.12 (0.91 / 0.92) | 80.6 / 81.1 %, 47.4 %, 9.6 %, 18 | 0.33 / 0.38 | 9.96 |
| `dbts_b5` 10bit | 16 | 12 | 63.3 | 49.16 / 49.11 / 49.02 | 70 | 0.9882 / 0.9876 | 0.9981 / 0.9979 | 1.58 (1.00 / 1.01) | 86.0 / 86.3 %, 60.5 %, 23.2 %, 26 | 0.53 / 0.61 | 9.86 |
| `dbts_b5` 10bit | 16 | 16 | 117.7 | 47.57 / 47.50 / 47.43 | 109 | 0.9835 / 0.9828 | 0.9969 / 0.9966 | 1.91 (1.03 / 1.03) | 88.3 / 88.6 %, 66.6 %, 31.8 %, 38 | 0.71 / 0.84 | 9.71 |
| `dbts_b5` 10bit | 16 | 24 | 320.4 | 45.77 / 45.70 / 45.68 | 267 | 0.9768 / 0.9755 | 0.9946 / 0.9937 | 2.37 (1.05 / 1.05) | 90.4 / 90.6 %, 72.4 %, 41.5 %, 77 | 1.09 / 1.30 | 9.24 |
| `dbts_b5` 10bit | 16 | 32 | 1169.5 | 44.10 / 43.94 / 43.90 | 525 | 0.9695 / 0.9677 | 0.9905 / 0.9894 | 2.89 (1.06 / 1.07) | 91.8 / 91.9 %, 76.1 %, 48.3 %, 137 | 1.71 / 2.00 | 8.2 |
| `dbts_b5` 10bit | 16 | 40 | 3054.8 | 42.74 / 42.47 / 42.42 | 520 | 0.9632 / 0.9607 | 0.9855 / 0.9844 | 3.33 (1.08 / 1.10) | 92.8 / 93.1 %, 79.5 %, 54.8 %, 137 | 2.36 / 2.72 | 6.98 |
| `dbts_b5` 10bit | 16 | 56 | 18426.6 | 39.39 / 38.78 / 38.66 | 553 | 0.9356 / 0.9103 | 0.9670 / 0.9620 | 4.71 (1.18 / 1.21) | 94.7 / 95.3 %, 85.9 %, 68.0 %, 192 | 4.16 / 4.89 | 4.2 |
| `dbts_b5` 10bit | 8 | 1 | 6.7 | 67.82 / 67.52 / 67.42 | 17 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.18) | 20.4 / 20.5 %, 0.0 %, 0.0 %, 2 | 0.05 / 0.06 | 10.0 |
| `dbts_b5` 10bit | 8 | 2 | 8.4 | 64.22 / 64.05 / 63.95 | 20 | 0.9996 / 0.9996 | 1.0000 / 0.9999 | 0.27 (0.28 / 0.28) | 36.0 / 36.1 %, 0.5 %, 0.0 %, 4 | 0.08 / 0.09 | 10.0 |
| `dbts_b5` 10bit | 8 | 4 | 12.7 | 58.38 / 58.22 / 58.15 | 31 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.54 (0.55 / 0.56) | 61.8 / 62.1 %, 13.7 %, 0.1 %, 13 | 0.15 / 0.17 | 9.99 |
| `dbts_b5` 10bit | 8 | 8 | 30.2 | 52.04 / 51.87 / 51.84 | 49 | 0.9940 / 0.9937 | 0.9992 / 0.9991 | 1.12 (0.91 / 0.92) | 80.7 / 81.1 %, 47.4 %, 9.6 %, 25 | 0.33 / 0.38 | 9.96 |
| `dbts_b5` 10bit | 8 | 12 | 63.0 | 49.15 / 49.05 / 49.01 | 70 | 0.9882 / 0.9874 | 0.9981 / 0.9979 | 1.58 (1.00 / 1.01) | 86.0 / 86.3 %, 60.5 %, 23.2 %, 28 | 0.53 / 0.61 | 9.86 |
| `dbts_b5` 10bit | 8 | 16 | 116.5 | 47.56 / 47.45 / 47.42 | 122 | 0.9834 / 0.9827 | 0.9969 / 0.9966 | 1.91 (1.03 / 1.03) | 88.3 / 88.6 %, 66.6 %, 31.8 %, 34 | 0.72 / 0.84 | 9.7 |
| `dbts_b5` 10bit | 8 | 24 | 311.0 | 45.77 / 45.71 / 45.68 | 254 | 0.9767 / 0.9755 | 0.9946 / 0.9937 | 2.37 (1.05 / 1.05) | 90.4 / 90.6 %, 72.4 %, 41.5 %, 57 | 1.09 / 1.30 | 9.24 |
| `dbts_b5` 10bit | 8 | 32 | 1100.7 | 44.12 / 43.94 / 43.90 | 422 | 0.9696 / 0.9679 | 0.9905 / 0.9894 | 2.88 (1.05 / 1.06) | 91.8 / 91.9 %, 76.1 %, 48.3 %, 109 | 1.71 / 2.00 | 8.21 |
| `dbts_b5` 10bit | 8 | 40 | 2762.4 | 42.77 / 42.46 / 42.45 | 396 | 0.9630 / 0.9607 | 0.9857 / 0.9844 | 3.33 (1.08 / 1.10) | 92.8 / 93.1 %, 79.4 %, 54.6 %, 110 | 2.35 / 2.72 | 7.0 |
| `dbts_b5` 10bit | 8 | 56 | 14850.9 | 39.46 / 38.89 / 38.80 | 553 | 0.9352 / 0.8943 | 0.9668 / 0.9619 | 4.69 (1.16 / 1.21) | 94.7 / 95.2 %, 85.7 %, 67.6 %, 204 | 4.12 / 4.89 | 4.3 |
| `dbts_c1` 12bit | 1 | 1 | 5.6 | 73.31 / 73.08 / 73.08 | 37 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 16.0 / 16.6 %, 0.0 %, 0.0 %, 2 | 0.03 / 0.03 | 10.0 |
| `dbts_c1` 12bit | 1 | 2 | 7.3 | 67.36 / 67.15 / 67.14 | 37 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.20 (0.20 / 0.22) | 32.2 / 33.2 %, 1.0 %, 0.0 %, 4 | 0.05 / 0.06 | 10.0 |
| `dbts_c1` 12bit | 1 | 4 | 12.6 | 59.32 / 59.11 / 59.10 | 85 | 0.9989 / 0.9988 | 0.9999 / 0.9998 | 0.50 (0.50 / 0.53) | 60.9 / 62.2 %, 18.3 %, 1.1 %, 9 | 0.12 / 0.14 | 9.98 |
| `dbts_c1` 12bit | 1 | 8 | 37.5 | 51.52 / 51.40 / 51.39 | 280 | 0.9931 / 0.9928 | 0.9990 / 0.9989 | 1.22 (0.98 / 0.99) | 81.2 / 82.8 %, 54.3 %, 20.9 %, 25 | 0.32 / 0.36 | 9.84 |
| `dbts_c1` 12bit | 1 | 12 | 110.3 | 48.48 / 48.32 / 48.30 | 316 | 0.9865 / 0.9858 | 0.9975 / 0.9973 | 1.73 (1.07 / 1.08) | 85.7 / 87.3 %, 65.0 %, 34.3 %, 38 | 0.55 / 0.64 | 9.48 |
| `dbts_c1` 12bit | 1 | 16 | 236.2 | 47.30 / 47.12 / 47.10 | 523 | 0.9826 / 0.9812 | 0.9961 / 0.9956 | 1.98 (1.07 / 1.08) | 87.3 / 88.6 %, 68.2 %, 39.0 %, 46 | 0.77 / 0.88 | 8.97 |
| `dbts_c1` 12bit | 1 | 24 | 506.6 | 46.34 / 46.16 / 46.14 | 593 | 0.9785 / 0.9772 | 0.9942 / 0.9935 | 2.19 (1.08 / 1.09) | 88.5 / 89.7 %, 70.7 %, 42.4 %, 117 | 1.06 / 1.23 | 8.11 |
| `dbts_c1` 12bit | 1 | 32 | 972.5 | 45.42 / 45.21 / 45.17 | 825 | 0.9776 / 0.9753 | 0.9923 / 0.9910 | 2.42 (1.08 / 1.09) | 89.7 / 90.8 %, 73.5 %, 46.2 %, 122 | 1.39 / 1.64 | 7.2 |
| `dbts_c1` 12bit | 1 | 40 | 1691.1 | 44.15 / 43.76 / 43.70 | 1215 | 0.9737 / 0.9704 | 0.9893 / 0.9881 | 2.75 (1.08 / 1.09) | 90.8 / 91.7 %, 75.9 %, 49.8 %, 119 | 1.82 / 2.04 | 6.27 |
| `dbts_c1` 12bit | 1 | 56 | 4371.3 | 40.19 / 39.64 / 39.50 | 2331 | 0.9504 / 0.8945 | 0.9788 / 0.9705 | 4.13 (1.09 / 1.10) | 93.2 / 93.5 %, 80.9 %, 58.9 %, 213 | 3.31 / 3.65 | 4.04 |
| `dbts_c1` 12bit | 16 | 1 | 5.6 | 73.33 / 73.10 / 73.08 | 54 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 16.0 / 16.5 %, 0.0 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c1` 12bit | 16 | 2 | 7.6 | 66.93 / 66.63 / 66.63 | 104 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.21 (0.21 / 0.23) | 33.5 / 34.6 %, 1.4 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_c1` 12bit | 16 | 4 | 12.6 | 59.28 / 59.09 / 59.08 | 148 | 0.9989 / 0.9988 | 0.9999 / 0.9998 | 0.50 (0.50 / 0.53) | 61.0 / 62.4 %, 18.7 %, 1.1 %, 10 | 0.12 / 0.14 | 9.98 |
| `dbts_c1` 12bit | 16 | 8 | 38.0 | 51.66 / 51.53 / 51.39 | 228 | 0.9935 / 0.9928 | 0.9990 / 0.9989 | 1.20 (0.97 / 0.99) | 81.0 / 82.6 %, 53.8 %, 20.5 %, 24 | 0.32 / 0.36 | 9.84 |
| `dbts_c1` 12bit | 16 | 12 | 128.3 | 48.59 / 48.45 / 48.34 | 267 | 0.9870 / 0.9858 | 0.9976 / 0.9973 | 1.71 (1.07 / 1.08) | 85.7 / 87.2 %, 64.7 %, 34.0 %, 37 | 0.55 / 0.64 | 9.49 |
| `dbts_c1` 12bit | 16 | 16 | 374.7 | 47.29 / 47.13 / 47.07 | 523 | 0.9829 / 0.9816 | 0.9961 / 0.9955 | 1.98 (1.07 / 1.08) | 87.3 / 88.5 %, 68.1 %, 38.9 %, 58 | 0.77 / 0.91 | 8.96 |
| `dbts_c1` 12bit | 16 | 24 | 1262.7 | 46.15 / 45.93 / 45.91 | 593 | 0.9792 / 0.9772 | 0.9938 / 0.9929 | 2.25 (1.08 / 1.09) | 88.8 / 89.9 %, 71.3 %, 43.2 %, 82 | 1.14 / 1.37 | 7.94 |
| `dbts_c1` 12bit | 16 | 32 | 3118.4 | 45.10 / 44.86 / 44.81 | 637 | 0.9783 / 0.9762 | 0.9916 / 0.9902 | 2.50 (1.08 / 1.09) | 90.0 / 90.9 %, 73.9 %, 47.0 %, 119 | 1.51 / 1.78 | 7.02 |
| `dbts_c1` 12bit | 16 | 40 | 6560.7 | 43.75 / 43.16 / 43.03 | 1049 | 0.9748 / 0.9703 | 0.9883 / 0.9864 | 2.90 (1.08 / 1.09) | 91.3 / 92.0 %, 76.9 %, 51.6 %, 122 | 2.01 / 2.29 | 6.02 |
| `dbts_c1` 12bit | 16 | 56 | 21780.6 | 39.58 / 38.58 / 38.46 | 2060 | 0.9507 / 0.9372 | 0.9760 / 0.9705 | 4.43 (1.08 / 1.09) | 93.7 / 94.0 %, 82.4 %, 61.7 %, 185 | 3.63 / 4.31 | 3.81 |
| `dbts_c1` 12bit | 8 | 1 | 5.6 | 73.33 / 73.11 / 73.08 | 37 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 15.9 / 16.5 %, 0.0 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c1` 12bit | 8 | 2 | 7.6 | 66.97 / 66.64 / 66.63 | 105 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.21 (0.21 / 0.23) | 33.5 / 34.6 %, 1.4 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_c1` 12bit | 8 | 4 | 12.6 | 59.28 / 59.09 / 59.09 | 148 | 0.9989 / 0.9988 | 0.9999 / 0.9998 | 0.50 (0.50 / 0.53) | 61.0 / 62.4 %, 18.7 %, 1.1 %, 9 | 0.12 / 0.14 | 9.98 |
| `dbts_c1` 12bit | 8 | 8 | 37.9 | 51.66 / 51.48 / 51.39 | 201 | 0.9935 / 0.9928 | 0.9990 / 0.9989 | 1.20 (0.97 / 0.99) | 81.0 / 82.6 %, 53.8 %, 20.5 %, 25 | 0.32 / 0.36 | 9.84 |
| `dbts_c1` 12bit | 8 | 12 | 127.3 | 48.55 / 48.39 / 48.34 | 288 | 0.9868 / 0.9858 | 0.9975 / 0.9973 | 1.71 (1.07 / 1.08) | 85.7 / 87.2 %, 64.7 %, 34.0 %, 37 | 0.55 / 0.64 | 9.49 |
| `dbts_c1` 12bit | 8 | 16 | 363.0 | 47.30 / 47.12 / 47.07 | 523 | 0.9829 / 0.9816 | 0.9961 / 0.9955 | 1.98 (1.07 / 1.08) | 87.3 / 88.5 %, 68.1 %, 38.9 %, 58 | 0.77 / 0.91 | 8.97 |
| `dbts_c1` 12bit | 8 | 24 | 1184.8 | 46.16 / 45.94 / 45.91 | 593 | 0.9793 / 0.9772 | 0.9938 / 0.9929 | 2.24 (1.08 / 1.09) | 88.8 / 89.9 %, 71.3 %, 43.2 %, 82 | 1.14 / 1.37 | 7.96 |
| `dbts_c1` 12bit | 8 | 32 | 2820.8 | 45.17 / 44.91 / 44.82 | 683 | 0.9782 / 0.9762 | 0.9917 / 0.9902 | 2.50 (1.08 / 1.09) | 90.0 / 90.9 %, 73.9 %, 46.9 %, 119 | 1.50 / 1.78 | 7.02 |
| `dbts_c1` 12bit | 8 | 40 | 5743.5 | 43.93 / 43.28 / 43.04 | 1080 | 0.9745 / 0.9704 | 0.9886 / 0.9864 | 2.88 (1.08 / 1.09) | 91.1 / 91.9 %, 76.4 %, 51.0 %, 128 | 1.98 / 2.30 | 6.05 |
| `dbts_c1` 12bit | 8 | 56 | 17834.3 | 39.86 / 38.81 / 38.50 | 2060 | 0.9526 / 0.9372 | 0.9781 / 0.9709 | 4.25 (1.08 / 1.09) | 93.4 / 94.0 %, 82.3 %, 61.6 %, 194 | 3.47 / 4.33 | 3.8 |
| `dbts_c1` top10 | 1 | 1 | 6.8 | 66.51 / 66.29 / 66.29 | 32 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.22 (0.21 / 0.23) | 33.4 / 34.4 %, 1.6 %, 0.0 %, 4 | 0.07 / 0.08 | — |
| `dbts_c1` top10 | 1 | 2 | 9.0 | 63.02 / 62.81 / 62.80 | 55 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.32 (0.32 / 0.35) | 47.2 / 48.5 %, 6.6 %, 0.0 %, 6 | 0.10 / 0.11 | — |
| `dbts_c1` top10 | 1 | 4 | 14.5 | 57.55 / 57.37 / 57.34 | 111 | 0.9983 / 0.9983 | 0.9998 / 0.9998 | 0.61 (0.60 / 0.63) | 66.7 / 67.9 %, 25.8 %, 2.8 %, 11 | 0.16 / 0.18 | — |
| `dbts_c1` top10 | 1 | 8 | 40.0 | 51.23 / 51.10 / 51.10 | 280 | 0.9928 / 0.9926 | 0.9989 / 0.9989 | 1.26 (0.99 / 1.00) | 81.7 / 83.3 %, 55.5 %, 22.2 %, 25 | 0.34 / 0.39 | — |
| `dbts_c1` top10 | 1 | 12 | 103.2 | 48.60 / 48.45 / 48.38 | 328 | 0.9870 / 0.9864 | 0.9976 / 0.9974 | 1.71 (1.07 / 1.08) | 85.6 / 87.1 %, 64.7 %, 33.9 %, 41 | 0.54 / 0.62 | — |
| `dbts_c1` top10 | 1 | 16 | 207.1 | 47.47 / 47.31 / 47.30 | 462 | 0.9836 / 0.9827 | 0.9963 / 0.9960 | 1.95 (1.08 / 1.09) | 87.1 / 88.4 %, 67.8 %, 38.4 %, 45 | 0.73 / 0.85 | — |
| `dbts_c1` top10 | 1 | 24 | 446.4 | 46.54 / 46.36 / 46.35 | 500 | 0.9811 / 0.9799 | 0.9947 / 0.9940 | 2.16 (1.08 / 1.09) | 88.3 / 89.4 %, 70.4 %, 41.8 %, 117 | 1.00 / 1.17 | — |
| `dbts_c1` top10 | 1 | 32 | 843.6 | 45.72 / 45.50 / 45.48 | 806 | 0.9793 / 0.9775 | 0.9929 / 0.9917 | 2.35 (1.08 / 1.09) | 89.4 / 90.4 %, 72.7 %, 45.3 %, 122 | 1.30 / 1.54 | — |
| `dbts_c1` top10 | 1 | 40 | 1424.6 | 44.65 / 44.36 / 44.27 | 967 | 0.9743 / 0.9720 | 0.9904 / 0.9890 | 2.62 (1.08 / 1.10) | 90.4 / 91.4 %, 75.1 %, 48.7 %, 118 | 1.66 / 1.91 | — |
| `dbts_c1` top10 | 1 | 56 | 3635.4 | 41.46 / 40.89 / 40.79 | 2129 | 0.9458 / 0.9340 | 0.9810 / 0.9771 | 3.63 (1.09 / 1.10) | 92.5 / 92.8 %, 78.8 %, 55.1 %, 207 | 2.82 / 3.05 | — |
| `dbts_c1` top10 | 16 | 1 | 7.0 | 66.17 / 65.89 / 65.89 | 76 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.23 (0.22 / 0.24) | 34.6 / 35.7 %, 1.9 %, 0.0 %, 4 | 0.08 / 0.09 | — |
| `dbts_c1` top10 | 16 | 2 | 9.0 | 62.98 / 62.74 / 62.73 | 102 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.33 (0.32 / 0.35) | 47.4 / 48.7 %, 6.8 %, 0.0 %, 6 | 0.10 / 0.12 | — |
| `dbts_c1` top10 | 16 | 4 | 14.5 | 57.52 / 57.32 / 57.30 | 181 | 0.9983 / 0.9982 | 0.9998 / 0.9998 | 0.61 (0.60 / 0.63) | 66.8 / 68.1 %, 26.2 %, 2.9 %, 11 | 0.16 / 0.19 | — |
| `dbts_c1` top10 | 16 | 8 | 40.7 | 51.33 / 51.20 / 51.10 | 214 | 0.9930 / 0.9926 | 0.9989 / 0.9989 | 1.25 (0.99 / 1.00) | 81.6 / 83.1 %, 55.1 %, 21.9 %, 25 | 0.34 / 0.39 | — |
| `dbts_c1` top10 | 16 | 12 | 119.5 | 48.65 / 48.52 / 48.51 | 272 | 0.9872 / 0.9866 | 0.9976 / 0.9974 | 1.70 (1.07 / 1.08) | 85.6 / 87.1 %, 64.7 %, 33.7 %, 44 | 0.55 / 0.64 | — |
| `dbts_c1` top10 | 16 | 16 | 312.5 | 47.47 / 47.31 / 47.25 | 456 | 0.9838 / 0.9827 | 0.9963 / 0.9959 | 1.94 (1.08 / 1.09) | 87.1 / 88.4 %, 67.8 %, 38.3 %, 47 | 0.74 / 0.87 | — |
| `dbts_c1` top10 | 16 | 24 | 986.4 | 46.44 / 46.22 / 46.15 | 464 | 0.9811 / 0.9796 | 0.9945 / 0.9935 | 2.18 (1.08 / 1.09) | 88.4 / 89.5 %, 70.6 %, 42.4 %, 87 | 1.04 / 1.26 | — |
| `dbts_c1` top10 | 16 | 32 | 2446.0 | 45.54 / 45.30 / 45.25 | 583 | 0.9796 / 0.9782 | 0.9926 / 0.9915 | 2.40 (1.09 / 1.10) | 89.6 / 90.6 %, 73.1 %, 45.6 %, 117 | 1.37 / 1.61 | — |
| `dbts_c1` top10 | 16 | 40 | 4946.2 | 44.40 / 44.05 / 43.95 | 830 | 0.9750 / 0.9723 | 0.9898 / 0.9885 | 2.70 (1.09 / 1.10) | 90.7 / 91.5 %, 75.6 %, 49.5 %, 119 | 1.76 / 2.01 | — |
| `dbts_c1` top10 | 16 | 56 | 16231.0 | 40.98 / 40.19 / 40.16 | 2052 | 0.9458 / 0.9397 | 0.9796 / 0.9767 | 3.81 (1.08 / 1.10) | 92.8 / 93.1 %, 80.2 %, 57.7 %, 216 | 3.03 / 3.42 | — |
| `dbts_c1` top10 | 8 | 1 | 7.0 | 66.21 / 65.90 / 65.89 | 63 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.23 (0.22 / 0.24) | 34.6 / 35.7 %, 1.9 %, 0.0 %, 4 | 0.08 / 0.09 | — |
| `dbts_c1` top10 | 8 | 2 | 9.0 | 62.98 / 62.75 / 62.74 | 107 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.33 (0.32 / 0.35) | 47.4 / 48.7 %, 6.8 %, 0.0 %, 6 | 0.10 / 0.12 | — |
| `dbts_c1` top10 | 8 | 4 | 14.5 | 57.52 / 57.32 / 57.31 | 166 | 0.9983 / 0.9982 | 0.9998 / 0.9998 | 0.61 (0.60 / 0.63) | 66.7 / 68.1 %, 26.2 %, 2.9 %, 11 | 0.16 / 0.19 | — |
| `dbts_c1` top10 | 8 | 8 | 40.7 | 51.33 / 51.17 / 51.10 | 262 | 0.9930 / 0.9926 | 0.9989 / 0.9989 | 1.25 (0.99 / 1.00) | 81.6 / 83.1 %, 55.1 %, 21.9 %, 25 | 0.34 / 0.39 | — |
| `dbts_c1` top10 | 8 | 12 | 118.5 | 48.65 / 48.52 / 48.50 | 272 | 0.9872 / 0.9865 | 0.9976 / 0.9974 | 1.70 (1.07 / 1.08) | 85.6 / 87.1 %, 64.7 %, 33.7 %, 40 | 0.55 / 0.64 | — |
| `dbts_c1` top10 | 8 | 16 | 304.9 | 47.47 / 47.31 / 47.25 | 456 | 0.9837 / 0.9827 | 0.9963 / 0.9959 | 1.94 (1.08 / 1.09) | 87.1 / 88.4 %, 67.8 %, 38.3 %, 47 | 0.74 / 0.87 | — |
| `dbts_c1` top10 | 8 | 24 | 937.4 | 46.44 / 46.21 / 46.15 | 464 | 0.9811 / 0.9796 | 0.9945 / 0.9935 | 2.18 (1.08 / 1.09) | 88.5 / 89.5 %, 70.6 %, 42.4 %, 87 | 1.04 / 1.26 | — |
| `dbts_c1` top10 | 8 | 32 | 2234.6 | 45.55 / 45.33 / 45.31 | 607 | 0.9796 / 0.9781 | 0.9927 / 0.9914 | 2.40 (1.09 / 1.09) | 89.6 / 90.6 %, 73.1 %, 45.6 %, 117 | 1.37 / 1.61 | — |
| `dbts_c1` top10 | 8 | 40 | 4376.4 | 44.44 / 44.11 / 44.00 | 831 | 0.9745 / 0.9723 | 0.9898 / 0.9885 | 2.70 (1.09 / 1.10) | 90.7 / 91.4 %, 75.3 %, 49.2 %, 119 | 1.76 / 2.01 | — |
| `dbts_c1` top10 | 8 | 56 | 13756.7 | 41.28 / 40.34 / 40.15 | 2052 | 0.9464 / 0.9397 | 0.9808 / 0.9761 | 3.72 (1.09 / 1.10) | 92.7 / 93.1 %, 80.0 %, 57.1 %, 216 | 2.96 / 3.42 | — |
| `dbts_c1` window | 1 | 1 | 5.0 | 8.01 / 7.37 / 7.30 | 2234 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 26.6 / 28.5 %, 20.3 %, 15.4 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 1 | 2 | 6.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 31.3 / 33.1 %, 20.4 %, 15.5 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 1 | 4 | 7.9 | 8.01 / 7.37 / 7.30 | 2237 | 0.4605 / 0.3677 | 0.8628 / 0.8342 | 5.47 (0.44 / 0.48) | 41.7 / 43.4 %, 20.9 %, 15.7 %, 30 | 4.10 / 4.89 | — |
| `dbts_c1` window | 1 | 8 | 11.4 | 8.01 / 7.37 / 7.30 | 2247 | 0.4602 / 0.3674 | 0.8628 / 0.8342 | 5.48 (0.51 / 0.55) | 61.6 / 62.8 %, 27.1 %, 16.0 %, 31 | 4.10 / 4.89 | — |
| `dbts_c1` window | 1 | 12 | 15.5 | 8.01 / 7.37 / 7.30 | 2258 | 0.4595 / 0.3668 | 0.8627 / 0.8341 | 5.49 (0.62 / 0.65) | 73.4 / 74.3 %, 38.7 %, 17.3 %, 32 | 4.10 / 4.89 | — |
| `dbts_c1` window | 1 | 16 | 20.4 | 8.01 / 7.37 / 7.30 | 2265 | 0.4586 / 0.3661 | 0.8626 / 0.8340 | 5.51 (0.74 / 0.76) | 79.7 / 80.3 %, 48.8 %, 20.7 %, 32 | 4.11 / 4.89 | — |
| `dbts_c1` window | 1 | 24 | 34.0 | 8.01 / 7.37 / 7.30 | 2256 | 0.4563 / 0.3639 | 0.8622 / 0.8337 | 5.57 (0.92 / 0.94) | 85.9 / 86.2 %, 61.6 %, 30.2 %, 43 | 4.11 / 4.90 | — |
| `dbts_c1` window | 1 | 32 | 90.9 | 8.01 / 7.37 / 7.30 | 2263 | 0.4513 / 0.3589 | 0.8613 / 0.8329 | 5.69 (1.06 / 1.07) | 90.0 / 90.1 %, 71.5 %, 42.6 %, 46 | 4.14 / 4.92 | — |
| `dbts_c1` window | 1 | 40 | 324.4 | 8.01 / 7.37 / 7.30 | 2269 | 0.4462 / 0.3543 | 0.8597 / 0.8315 | 5.82 (1.08 / 1.09) | 91.7 / 91.8 %, 76.1 %, 49.8 %, 49 | 4.19 / 4.96 | — |
| `dbts_c1` window | 1 | 56 | 1900.9 | 8.01 / 7.36 / 7.29 | 2378 | 0.4433 / 0.3519 | 0.8562 / 0.8284 | 6.03 (1.08 / 1.09) | 93.2 / 93.3 %, 80.2 %, 56.9 %, 146 | 4.43 / 5.15 | — |
| `dbts_c1` window | 16 | 1 | 5.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 27.0 / 28.9 %, 20.3 %, 15.4 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 16 | 2 | 6.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 31.5 / 33.3 %, 20.4 %, 15.5 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 16 | 4 | 7.8 | 8.01 / 7.37 / 7.30 | 2238 | 0.4605 / 0.3677 | 0.8628 / 0.8342 | 5.47 (0.44 / 0.48) | 42.2 / 43.7 %, 20.9 %, 15.7 %, 30 | 4.10 / 4.89 | — |
| `dbts_c1` window | 16 | 8 | 11.4 | 8.01 / 7.37 / 7.30 | 2243 | 0.4602 / 0.3674 | 0.8628 / 0.8342 | 5.48 (0.51 / 0.55) | 61.9 / 63.0 %, 27.3 %, 16.0 %, 31 | 4.10 / 4.89 | — |
| `dbts_c1` window | 16 | 12 | 15.4 | 8.01 / 7.37 / 7.30 | 2247 | 0.4595 / 0.3668 | 0.8627 / 0.8341 | 5.49 (0.62 / 0.65) | 73.6 / 74.4 %, 39.0 %, 17.4 %, 31 | 4.10 / 4.89 | — |
| `dbts_c1` window | 16 | 16 | 20.2 | 8.01 / 7.37 / 7.30 | 2251 | 0.4587 / 0.3660 | 0.8626 / 0.8340 | 5.51 (0.74 / 0.76) | 79.8 / 80.3 %, 49.0 %, 20.9 %, 32 | 4.11 / 4.89 | — |
| `dbts_c1` window | 16 | 24 | 33.9 | 8.01 / 7.37 / 7.30 | 2259 | 0.4564 / 0.3639 | 0.8622 / 0.8337 | 5.57 (0.92 / 0.94) | 85.8 / 86.1 %, 61.5 %, 30.1 %, 34 | 4.11 / 4.90 | — |
| `dbts_c1` window | 16 | 32 | 94.4 | 8.01 / 7.37 / 7.30 | 2258 | 0.4516 / 0.3591 | 0.8613 / 0.8329 | 5.68 (1.06 / 1.07) | 89.9 / 90.1 %, 71.4 %, 42.6 %, 36 | 4.14 / 4.92 | — |
| `dbts_c1` window | 16 | 40 | 508.7 | 8.01 / 7.37 / 7.30 | 2270 | 0.4463 / 0.3543 | 0.8597 / 0.8314 | 5.83 (1.08 / 1.09) | 91.7 / 91.9 %, 76.3 %, 50.1 %, 55 | 4.20 / 4.96 | — |
| `dbts_c1` window | 16 | 56 | 5481.1 | 8.01 / 7.36 / 7.29 | 2378 | 0.4433 / 0.3519 | 0.8562 / 0.8283 | 6.05 (1.08 / 1.09) | 93.2 / 93.5 %, 80.7 %, 57.5 %, 126 | 4.45 / 5.15 | — |
| `dbts_c1` window | 8 | 1 | 5.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 27.0 / 28.9 %, 20.3 %, 15.4 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 8 | 2 | 6.1 | 8.01 / 7.37 / 7.30 | 2235 | 0.4606 / 0.3677 | 0.8628 / 0.8343 | 5.47 (0.43 / 0.47) | 31.5 / 33.3 %, 20.4 %, 15.5 %, 30 | 4.10 / 4.88 | — |
| `dbts_c1` window | 8 | 4 | 7.8 | 8.01 / 7.37 / 7.30 | 2239 | 0.4605 / 0.3677 | 0.8628 / 0.8342 | 5.47 (0.44 / 0.48) | 42.1 / 43.7 %, 21.0 %, 15.7 %, 30 | 4.10 / 4.89 | — |
| `dbts_c1` window | 8 | 8 | 11.4 | 8.01 / 7.37 / 7.30 | 2244 | 0.4602 / 0.3674 | 0.8628 / 0.8342 | 5.48 (0.51 / 0.55) | 61.9 / 63.0 %, 27.2 %, 16.0 %, 31 | 4.10 / 4.89 | — |
| `dbts_c1` window | 8 | 12 | 15.4 | 8.01 / 7.37 / 7.30 | 2247 | 0.4595 / 0.3668 | 0.8627 / 0.8341 | 5.49 (0.62 / 0.65) | 73.6 / 74.4 %, 38.9 %, 17.4 %, 32 | 4.10 / 4.89 | — |
| `dbts_c1` window | 8 | 16 | 20.2 | 8.01 / 7.37 / 7.30 | 2250 | 0.4587 / 0.3660 | 0.8626 / 0.8340 | 5.51 (0.74 / 0.76) | 79.8 / 80.4 %, 49.0 %, 20.8 %, 32 | 4.11 / 4.89 | — |
| `dbts_c1` window | 8 | 24 | 33.9 | 8.01 / 7.37 / 7.30 | 2253 | 0.4564 / 0.3639 | 0.8622 / 0.8337 | 5.57 (0.91 / 0.94) | 85.8 / 86.2 %, 61.5 %, 30.1 %, 34 | 4.11 / 4.90 | — |
| `dbts_c1` window | 8 | 32 | 94.5 | 8.01 / 7.37 / 7.30 | 2258 | 0.4516 / 0.3591 | 0.8613 / 0.8329 | 5.68 (1.06 / 1.07) | 89.9 / 90.0 %, 71.4 %, 42.6 %, 36 | 4.14 / 4.92 | — |
| `dbts_c1` window | 8 | 40 | 495.0 | 8.01 / 7.37 / 7.30 | 2268 | 0.4463 / 0.3543 | 0.8597 / 0.8314 | 5.83 (1.08 / 1.09) | 91.7 / 91.9 %, 76.3 %, 50.1 %, 51 | 4.20 / 4.96 | — |
| `dbts_c1` window | 8 | 56 | 5047.0 | 8.01 / 7.36 / 7.29 | 2378 | 0.4433 / 0.3519 | 0.8562 / 0.8283 | 6.05 (1.08 / 1.09) | 93.2 / 93.4 %, 80.6 %, 57.5 %, 126 | 4.45 / 5.15 | — |
| `dbts_c2` 12bit | 1 | 1 | 3.6 | 71.60 / 71.39 / 71.37 | 29 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.09) | 26.2 / 27.0 %, 0.3 %, 0.0 %, 3 | 0.02 / 0.03 | 10.0 |
| `dbts_c2` 12bit | 1 | 2 | 4.6 | 65.68 / 65.47 / 65.45 | 33 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.17 (0.17 / 0.18) | 47.8 / 49.1 %, 6.8 %, 0.0 %, 5 | 0.04 / 0.05 | 10.0 |
| `dbts_c2` 12bit | 1 | 4 | 7.8 | 57.70 / 57.49 / 57.45 | 79 | 0.9984 / 0.9983 | 0.9998 / 0.9998 | 0.43 (0.44 / 0.46) | 73.2 / 74.9 %, 38.2 %, 7.4 %, 14 | 0.11 / 0.12 | 9.96 |
| `dbts_c2` 12bit | 1 | 8 | 20.7 | 49.72 / 49.57 / 49.54 | 251 | 0.9898 / 0.9891 | 0.9986 / 0.9984 | 1.08 (0.94 / 0.95) | 87.1 / 88.7 %, 69.0 %, 39.9 %, 37 | 0.28 / 0.31 | 9.7 |
| `dbts_c2` 12bit | 1 | 12 | 60.6 | 46.25 / 46.17 / 46.15 | 343 | 0.9777 / 0.9766 | 0.9962 / 0.9958 | 1.61 (1.08 / 1.09) | 90.3 / 91.8 %, 77.0 %, 53.3 %, 62 | 0.49 / 0.55 | 9.1 |
| `dbts_c2` 12bit | 1 | 16 | 130.3 | 44.98 / 44.84 / 44.83 | 383 | 0.9708 / 0.9690 | 0.9939 / 0.9931 | 1.86 (1.09 / 1.10) | 91.3 / 92.8 %, 79.7 %, 58.1 %, 76 | 0.69 / 0.77 | 8.35 |
| `dbts_c2` 12bit | 1 | 24 | 297.6 | 43.89 / 43.82 / 43.81 | 777 | 0.9642 / 0.9626 | 0.9904 / 0.9893 | 2.08 (1.09 / 1.10) | 92.4 / 93.5 %, 81.7 %, 61.6 %, 85 | 1.00 / 1.12 | 7.22 |
| `dbts_c2` 12bit | 1 | 32 | 616.1 | 42.96 / 42.81 / 42.79 | 931 | 0.9615 / 0.9596 | 0.9861 / 0.9850 | 2.32 (1.09 / 1.10) | 93.4 / 94.2 %, 83.4 %, 64.5 %, 133 | 1.37 / 1.51 | 5.94 |
| `dbts_c2` 12bit | 1 | 40 | 1162.5 | 41.81 / 41.44 / 41.41 | 1436 | 0.9575 / 0.9530 | 0.9800 / 0.9783 | 2.64 (1.09 / 1.10) | 94.4 / 94.8 %, 85.1 %, 67.9 %, 140 | 1.82 / 1.91 | 4.57 |
| `dbts_c2` 12bit | 1 | 56 | 3628.0 | 37.87 / 37.50 / 37.41 | 2301 | 0.9407 / 0.9128 | 0.9562 / 0.9494 | 3.88 (1.09 / 1.10) | 96.3 / 96.7 %, 90.1 %, 77.5 %, 203 | 3.34 / 3.48 | 1.76 |
| `dbts_c2` 12bit | 16 | 1 | 3.6 | 71.62 / 71.42 / 71.37 | 56 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.09) | 26.2 / 27.0 %, 0.3 %, 0.0 %, 8 | 0.02 / 0.03 | 10.0 |
| `dbts_c2` 12bit | 16 | 2 | 4.8 | 65.21 / 64.97 / 64.96 | 68 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.20) | 49.2 / 50.4 %, 8.1 %, 0.0 %, 9 | 0.05 / 0.05 | 10.0 |
| `dbts_c2` 12bit | 16 | 4 | 7.8 | 57.65 / 57.45 / 57.42 | 148 | 0.9984 / 0.9983 | 0.9998 / 0.9998 | 0.43 (0.44 / 0.46) | 73.3 / 75.0 %, 38.3 %, 7.6 %, 17 | 0.11 / 0.12 | 9.96 |
| `dbts_c2` 12bit | 16 | 8 | 20.8 | 49.83 / 49.67 / 49.56 | 314 | 0.9903 / 0.9891 | 0.9986 / 0.9984 | 1.07 (0.93 / 0.94) | 87.0 / 88.7 %, 69.0 %, 39.8 %, 38 | 0.28 / 0.32 | 9.7 |
| `dbts_c2` 12bit | 16 | 12 | 66.0 | 46.41 / 46.27 / 46.17 | 286 | 0.9786 / 0.9767 | 0.9963 / 0.9958 | 1.58 (1.08 / 1.09) | 90.2 / 91.8 %, 77.0 %, 53.3 %, 57 | 0.49 / 0.56 | 9.13 |
| `dbts_c2` 12bit | 16 | 16 | 188.8 | 45.01 / 44.88 / 44.82 | 394 | 0.9712 / 0.9690 | 0.9939 / 0.9930 | 1.85 (1.09 / 1.10) | 91.4 / 92.8 %, 79.7 %, 58.1 %, 73 | 0.69 / 0.79 | 8.33 |
| `dbts_c2` 12bit | 16 | 24 | 682.8 | 43.73 / 43.59 / 43.54 | 563 | 0.9652 / 0.9624 | 0.9897 / 0.9882 | 2.13 (1.09 / 1.10) | 92.4 / 93.8 %, 82.2 %, 62.5 %, 106 | 1.09 / 1.25 | 7.0 |
| `dbts_c2` 12bit | 16 | 32 | 1950.2 | 42.67 / 42.42 / 42.40 | 645 | 0.9613 / 0.9603 | 0.9846 / 0.9830 | 2.41 (1.09 / 1.10) | 93.6 / 94.4 %, 83.9 %, 65.5 %, 140 | 1.51 / 1.65 | 5.65 |
| `dbts_c2` 12bit | 16 | 40 | 4689.4 | 41.36 / 40.81 / 40.74 | 960 | 0.9576 / 0.9547 | 0.9777 / 0.9745 | 2.80 (1.09 / 1.10) | 94.8 / 95.1 %, 86.1 %, 69.8 %, 147 | 2.05 / 2.18 | 4.25 |
| `dbts_c2` 12bit | 16 | 56 | 19497.5 | 37.36 / 36.61 / 36.52 | 2138 | 0.9379 / 0.9238 | 0.9541 / 0.9428 | 4.09 (1.09 / 1.10) | 96.3 / 96.8 %, 90.7 %, 79.5 %, 176 | 3.59 / 4.12 | 1.31 |
| `dbts_c2` 12bit | 8 | 1 | 3.6 | 71.62 / 71.42 / 71.37 | 53 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.09) | 26.2 / 27.0 %, 0.3 %, 0.0 %, 8 | 0.02 / 0.03 | 10.0 |
| `dbts_c2` 12bit | 8 | 2 | 4.8 | 65.25 / 64.97 / 64.96 | 68 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.18 (0.18 / 0.20) | 49.1 / 50.4 %, 8.1 %, 0.0 %, 9 | 0.05 / 0.05 | 10.0 |
| `dbts_c2` 12bit | 8 | 4 | 7.8 | 57.64 / 57.45 / 57.42 | 148 | 0.9984 / 0.9983 | 0.9998 / 0.9998 | 0.43 (0.44 / 0.46) | 73.3 / 75.0 %, 38.3 %, 7.6 %, 17 | 0.11 / 0.12 | 9.96 |
| `dbts_c2` 12bit | 8 | 8 | 20.8 | 49.83 / 49.67 / 49.56 | 314 | 0.9902 / 0.9891 | 0.9986 / 0.9984 | 1.07 (0.93 / 0.94) | 87.1 / 88.7 %, 69.0 %, 39.8 %, 38 | 0.29 / 0.32 | 9.7 |
| `dbts_c2` 12bit | 8 | 12 | 65.8 | 46.41 / 46.23 / 46.17 | 286 | 0.9786 / 0.9767 | 0.9963 / 0.9958 | 1.58 (1.08 / 1.09) | 90.3 / 91.8 %, 77.0 %, 53.3 %, 56 | 0.49 / 0.56 | 9.1 |
| `dbts_c2` 12bit | 8 | 16 | 185.4 | 44.99 / 44.88 / 44.82 | 394 | 0.9712 / 0.9690 | 0.9939 / 0.9930 | 1.85 (1.09 / 1.10) | 91.4 / 92.8 %, 79.7 %, 58.1 %, 74 | 0.69 / 0.79 | 8.31 |
| `dbts_c2` 12bit | 8 | 24 | 656.3 | 43.78 / 43.57 / 43.54 | 659 | 0.9651 / 0.9624 | 0.9897 / 0.9882 | 2.13 (1.09 / 1.10) | 92.4 / 93.8 %, 82.2 %, 62.5 %, 97 | 1.09 / 1.25 | 7.05 |
| `dbts_c2` 12bit | 8 | 32 | 1784.3 | 42.72 / 42.47 / 42.38 | 680 | 0.9613 / 0.9603 | 0.9849 / 0.9831 | 2.39 (1.09 / 1.10) | 93.5 / 94.4 %, 83.9 %, 65.5 %, 140 | 1.49 / 1.65 | 5.76 |
| `dbts_c2` 12bit | 8 | 40 | 4210.2 | 41.44 / 40.89 / 40.76 | 960 | 0.9578 / 0.9547 | 0.9779 / 0.9746 | 2.77 (1.09 / 1.10) | 94.8 / 95.3 %, 86.1 %, 69.7 %, 147 | 2.01 / 2.15 | 4.32 |
| `dbts_c2` 12bit | 8 | 56 | 16178.5 | 37.72 / 36.82 / 36.63 | 2291 | 0.9434 / 0.9259 | 0.9549 / 0.9437 | 4.00 (1.09 / 1.10) | 96.3 / 96.8 %, 90.7 %, 78.9 %, 205 | 3.43 / 4.02 | 1.62 |
| `dbts_c2` top10 | 1 | 1 | 4.3 | 64.80 / 64.60 / 64.59 | 33 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.20) | 48.7 / 49.5 %, 10.4 %, 0.1 %, 6 | 0.07 / 0.07 | — |
| `dbts_c2` top10 | 1 | 2 | 5.6 | 61.35 / 61.14 / 61.12 | 44 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.28 (0.28 / 0.30) | 62.6 / 63.7 %, 22.2 %, 1.3 %, 9 | 0.09 / 0.10 | — |
| `dbts_c2` top10 | 1 | 4 | 8.8 | 55.92 / 55.73 / 55.70 | 128 | 0.9976 / 0.9974 | 0.9997 / 0.9997 | 0.53 (0.52 / 0.55) | 77.7 / 79.0 %, 46.4 %, 13.0 %, 16 | 0.14 / 0.16 | — |
| `dbts_c2` top10 | 1 | 8 | 22.0 | 49.38 / 49.24 / 49.22 | 263 | 0.9892 / 0.9885 | 0.9985 / 0.9983 | 1.12 (0.96 / 0.96) | 87.8 / 89.1 %, 70.0 %, 41.5 %, 38 | 0.30 / 0.34 | — |
| `dbts_c2` top10 | 1 | 12 | 56.6 | 46.37 / 46.30 / 46.28 | 307 | 0.9785 / 0.9777 | 0.9963 / 0.9960 | 1.59 (1.08 / 1.09) | 90.5 / 91.7 %, 76.8 %, 52.9 %, 57 | 0.49 / 0.54 | — |
| `dbts_c2` top10 | 1 | 16 | 113.8 | 45.16 / 45.03 / 45.01 | 383 | 0.9721 / 0.9704 | 0.9943 / 0.9936 | 1.82 (1.09 / 1.10) | 91.4 / 92.7 %, 79.4 %, 57.5 %, 70 | 0.66 / 0.74 | — |
| `dbts_c2` top10 | 1 | 24 | 260.0 | 44.09 / 44.01 / 43.99 | 660 | 0.9666 / 0.9650 | 0.9911 / 0.9900 | 2.05 (1.09 / 1.10) | 92.3 / 93.5 %, 81.5 %, 61.2 %, 84 | 0.95 / 1.06 | — |
| `dbts_c2` top10 | 1 | 32 | 531.1 | 43.20 / 43.07 / 43.05 | 927 | 0.9631 / 0.9615 | 0.9872 / 0.9861 | 2.27 (1.10 / 1.10) | 93.3 / 94.1 %, 83.1 %, 64.0 %, 133 | 1.28 / 1.42 | — |
| `dbts_c2` top10 | 1 | 40 | 965.2 | 42.24 / 41.98 / 41.95 | 1440 | 0.9589 / 0.9570 | 0.9821 / 0.9806 | 2.53 (1.10 / 1.10) | 94.3 / 94.7 %, 84.6 %, 66.8 %, 129 | 1.67 / 1.79 | — |
| `dbts_c2` top10 | 1 | 56 | 2851.9 | 39.14 / 38.65 / 38.61 | 2152 | 0.9422 / 0.9318 | 0.9638 / 0.9583 | 3.45 (1.10 / 1.10) | 95.8 / 96.2 %, 88.7 %, 75.1 %, 183 | 2.85 / 2.97 | — |
| `dbts_c2` top10 | 16 | 1 | 4.4 | 64.44 / 64.21 / 64.21 | 64 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.19 / 0.20) | 50.0 / 50.9 %, 11.5 %, 0.1 %, 9 | 0.07 / 0.08 | — |
| `dbts_c2` top10 | 16 | 2 | 5.6 | 61.26 / 61.06 / 61.04 | 82 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.29 (0.28 / 0.30) | 62.9 / 63.9 %, 22.4 %, 1.4 %, 11 | 0.09 / 0.10 | — |
| `dbts_c2` top10 | 16 | 4 | 8.8 | 55.84 / 55.65 / 55.63 | 247 | 0.9976 / 0.9974 | 0.9997 / 0.9996 | 0.53 (0.53 / 0.55) | 77.9 / 79.1 %, 46.6 %, 13.2 %, 20 | 0.15 / 0.16 | — |
| `dbts_c2` top10 | 16 | 8 | 22.2 | 49.46 / 49.33 / 49.22 | 217 | 0.9895 / 0.9885 | 0.9985 / 0.9983 | 1.11 (0.95 / 0.96) | 87.9 / 89.1 %, 70.0 %, 41.4 %, 36 | 0.31 / 0.34 | — |
| `dbts_c2` top10 | 16 | 12 | 61.3 | 46.49 / 46.37 / 46.31 | 291 | 0.9792 / 0.9777 | 0.9964 / 0.9960 | 1.57 (1.08 / 1.09) | 90.5 / 91.7 %, 76.8 %, 52.9 %, 56 | 0.50 / 0.56 | — |
| `dbts_c2` top10 | 16 | 16 | 159.7 | 45.15 / 45.02 / 45.00 | 352 | 0.9723 / 0.9704 | 0.9942 / 0.9935 | 1.82 (1.09 / 1.10) | 91.4 / 92.7 %, 79.4 %, 57.6 %, 70 | 0.68 / 0.77 | — |
| `dbts_c2` top10 | 16 | 24 | 521.0 | 44.02 / 43.91 / 43.83 | 516 | 0.9665 / 0.9647 | 0.9908 / 0.9893 | 2.06 (1.09 / 1.10) | 92.4 / 93.6 %, 81.7 %, 61.7 %, 89 | 0.98 / 1.14 | — |
| `dbts_c2` top10 | 16 | 32 | 1468.6 | 43.05 / 42.90 / 42.86 | 546 | 0.9628 / 0.9618 | 0.9866 / 0.9854 | 2.31 (1.10 / 1.11) | 93.4 / 94.2 %, 83.3 %, 64.3 %, 123 | 1.35 / 1.49 | — |
| `dbts_c2` top10 | 16 | 40 | 3341.0 | 42.04 / 41.67 / 41.61 | 771 | 0.9590 / 0.9574 | 0.9810 / 0.9791 | 2.60 (1.10 / 1.11) | 94.5 / 94.8 %, 85.1 %, 67.8 %, 151 | 1.76 / 1.86 | — |
| `dbts_c2` top10 | 16 | 56 | 13760.6 | 38.68 / 38.08 / 37.97 | 2150 | 0.9438 / 0.9408 | 0.9612 / 0.9553 | 3.59 (1.10 / 1.10) | 96.1 / 96.5 %, 89.4 %, 76.5 %, 185 | 2.99 / 3.29 | — |
| `dbts_c2` top10 | 8 | 1 | 4.4 | 64.48 / 64.21 / 64.21 | 68 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.19 / 0.20) | 50.0 / 50.9 %, 11.5 %, 0.1 %, 8 | 0.07 / 0.08 | — |
| `dbts_c2` top10 | 8 | 2 | 5.6 | 61.27 / 61.06 / 61.04 | 80 | 0.9993 / 0.9993 | 0.9999 / 0.9999 | 0.29 (0.28 / 0.30) | 62.9 / 63.9 %, 22.4 %, 1.4 %, 11 | 0.09 / 0.10 | — |
| `dbts_c2` top10 | 8 | 4 | 8.8 | 55.86 / 55.65 / 55.63 | 161 | 0.9976 / 0.9974 | 0.9997 / 0.9996 | 0.53 (0.53 / 0.55) | 77.8 / 79.1 %, 46.6 %, 13.2 %, 20 | 0.15 / 0.16 | — |
| `dbts_c2` top10 | 8 | 8 | 22.2 | 49.47 / 49.32 / 49.22 | 203 | 0.9895 / 0.9885 | 0.9985 / 0.9983 | 1.11 (0.95 / 0.96) | 87.9 / 89.1 %, 70.0 %, 41.4 %, 37 | 0.31 / 0.34 | — |
| `dbts_c2` top10 | 8 | 12 | 61.0 | 46.49 / 46.35 / 46.31 | 287 | 0.9791 / 0.9777 | 0.9964 / 0.9960 | 1.57 (1.08 / 1.09) | 90.5 / 91.7 %, 76.8 %, 52.9 %, 56 | 0.50 / 0.56 | — |
| `dbts_c2` top10 | 8 | 16 | 156.9 | 45.16 / 45.02 / 45.00 | 353 | 0.9723 / 0.9704 | 0.9942 / 0.9935 | 1.82 (1.09 / 1.10) | 91.4 / 92.7 %, 79.4 %, 57.6 %, 68 | 0.68 / 0.77 | — |
| `dbts_c2` top10 | 8 | 24 | 504.5 | 44.03 / 43.90 / 43.83 | 660 | 0.9664 / 0.9647 | 0.9908 / 0.9893 | 2.06 (1.09 / 1.10) | 92.4 / 93.6 %, 81.7 %, 61.7 %, 79 | 0.98 / 1.14 | — |
| `dbts_c2` top10 | 8 | 32 | 1360.3 | 43.07 / 42.90 / 42.88 | 660 | 0.9629 / 0.9618 | 0.9866 / 0.9854 | 2.30 (1.10 / 1.11) | 93.4 / 94.2 %, 83.3 %, 64.3 %, 126 | 1.35 / 1.49 | — |
| `dbts_c2` top10 | 8 | 40 | 3014.7 | 42.02 / 41.70 / 41.66 | 771 | 0.9591 / 0.9574 | 0.9812 / 0.9789 | 2.58 (1.10 / 1.11) | 94.3 / 94.9 %, 85.0 %, 67.8 %, 151 | 1.75 / 1.87 | — |
| `dbts_c2` top10 | 8 | 56 | 11675.4 | 38.81 / 38.20 / 38.15 | 2150 | 0.9451 / 0.9375 | 0.9614 / 0.9551 | 3.54 (1.10 / 1.10) | 96.0 / 96.2 %, 89.1 %, 76.1 %, 207 | 2.94 / 3.26 | — |
| `dbts_c2` window | 1 | 1 | 2.7 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 23.3 / 25.4 %, 17.5 %, 14.8 %, 30 | 2.48 / 2.61 | — |
| `dbts_c2` window | 1 | 2 | 3.2 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 28.5 / 30.5 %, 17.6 %, 15.0 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 1 | 4 | 4.1 | 10.09 / 9.28 / 9.19 | 2383 | 0.7005 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.35 / 0.37) | 39.8 / 41.7 %, 18.0 %, 15.1 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 1 | 8 | 5.5 | 10.09 / 9.28 / 9.19 | 2387 | 0.7003 / 0.6367 | 0.9066 / 0.8904 | 3.09 (0.38 / 0.40) | 61.1 / 62.3 %, 25.4 %, 15.4 %, 31 | 2.48 / 2.62 | — |
| `dbts_c2` window | 1 | 12 | 6.9 | 10.09 / 9.28 / 9.19 | 2387 | 0.6999 / 0.6362 | 0.9065 / 0.8904 | 3.10 (0.43 / 0.45) | 73.4 / 74.2 %, 39.0 %, 16.9 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 1 | 16 | 8.4 | 10.09 / 9.28 / 9.19 | 2389 | 0.6993 / 0.6357 | 0.9064 / 0.8903 | 3.11 (0.50 / 0.52) | 79.9 / 80.3 %, 50.0 %, 21.0 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 1 | 24 | 11.5 | 10.09 / 9.28 / 9.19 | 2394 | 0.6976 / 0.6341 | 0.9062 / 0.8901 | 3.15 (0.64 / 0.67) | 86.1 / 86.6 %, 64.0 %, 32.9 %, 33 | 2.49 / 2.63 | — |
| `dbts_c2` window | 1 | 32 | 21.2 | 10.09 / 9.28 / 9.19 | 2401 | 0.6927 / 0.6290 | 0.9054 / 0.8893 | 3.25 (0.91 / 0.92) | 90.9 / 91.6 %, 76.3 %, 51.0 %, 60 | 2.51 / 2.65 | — |
| `dbts_c2` window | 1 | 40 | 58.9 | 10.09 / 9.27 / 9.18 | 2417 | 0.6826 / 0.6188 | 0.9035 / 0.8875 | 3.44 (1.08 / 1.08) | 93.4 / 94.1 %, 82.8 %, 63.3 %, 54 | 2.55 / 2.68 | — |
| `dbts_c2` window | 1 | 56 | 590.4 | 10.08 / 9.27 / 9.18 | 2425 | 0.6688 / 0.6069 | 0.8957 / 0.8808 | 3.79 (1.09 / 1.10) | 95.4 / 95.7 %, 87.4 %, 72.3 %, 149 | 2.79 / 2.92 | — |
| `dbts_c2` window | 16 | 1 | 2.7 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 23.8 / 25.9 %, 17.5 %, 14.9 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 16 | 2 | 3.2 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 28.8 / 30.8 %, 17.6 %, 14.9 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 16 | 4 | 4.1 | 10.09 / 9.28 / 9.19 | 2382 | 0.7005 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.35 / 0.37) | 40.3 / 42.3 %, 18.0 %, 15.0 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 16 | 8 | 5.5 | 10.09 / 9.28 / 9.19 | 2388 | 0.7003 / 0.6366 | 0.9066 / 0.8904 | 3.09 (0.38 / 0.40) | 61.6 / 62.9 %, 25.9 %, 15.4 %, 32 | 2.48 / 2.62 | — |
| `dbts_c2` window | 16 | 12 | 6.9 | 10.09 / 9.28 / 9.19 | 2385 | 0.6998 / 0.6362 | 0.9065 / 0.8904 | 3.10 (0.43 / 0.45) | 73.7 / 74.5 %, 39.6 %, 17.0 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 16 | 16 | 8.4 | 10.09 / 9.28 / 9.19 | 2388 | 0.6993 / 0.6357 | 0.9064 / 0.8903 | 3.12 (0.50 / 0.52) | 80.1 / 80.5 %, 50.5 %, 21.3 %, 31 | 2.49 / 2.63 | — |
| `dbts_c2` window | 16 | 24 | 11.5 | 10.09 / 9.28 / 9.19 | 2397 | 0.6976 / 0.6341 | 0.9062 / 0.8901 | 3.15 (0.64 / 0.67) | 86.3 / 86.6 %, 64.1 %, 33.0 %, 33 | 2.49 / 2.64 | — |
| `dbts_c2` window | 16 | 32 | 21.1 | 10.09 / 9.28 / 9.19 | 2402 | 0.6928 / 0.6292 | 0.9054 / 0.8893 | 3.25 (0.90 / 0.91) | 91.0 / 91.6 %, 76.1 %, 50.7 %, 36 | 2.51 / 2.65 | — |
| `dbts_c2` window | 16 | 40 | 61.9 | 10.09 / 9.27 / 9.19 | 2402 | 0.6832 / 0.6193 | 0.9035 / 0.8876 | 3.43 (1.08 / 1.08) | 93.5 / 94.1 %, 82.7 %, 62.9 %, 54 | 2.55 / 2.68 | — |
| `dbts_c2` window | 16 | 56 | 1355.6 | 10.08 / 9.27 / 9.18 | 2451 | 0.6686 / 0.6069 | 0.8955 / 0.8809 | 3.79 (1.09 / 1.10) | 95.5 / 95.8 %, 87.8 %, 72.5 %, 117 | 2.80 / 2.91 | — |
| `dbts_c2` window | 8 | 1 | 2.7 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 23.8 / 25.9 %, 17.5 %, 14.9 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 8 | 2 | 3.2 | 10.09 / 9.28 / 9.19 | 2380 | 0.7006 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.34 / 0.36) | 28.8 / 30.9 %, 17.6 %, 14.9 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 8 | 4 | 4.1 | 10.09 / 9.28 / 9.19 | 2382 | 0.7005 / 0.6369 | 0.9067 / 0.8905 | 3.08 (0.35 / 0.37) | 40.3 / 42.3 %, 18.0 %, 15.0 %, 30 | 2.48 / 2.62 | — |
| `dbts_c2` window | 8 | 8 | 5.5 | 10.09 / 9.28 / 9.19 | 2384 | 0.7003 / 0.6366 | 0.9066 / 0.8904 | 3.09 (0.38 / 0.40) | 61.6 / 62.9 %, 25.8 %, 15.3 %, 31 | 2.48 / 2.62 | — |
| `dbts_c2` window | 8 | 12 | 6.9 | 10.09 / 9.28 / 9.19 | 2387 | 0.6999 / 0.6362 | 0.9065 / 0.8904 | 3.10 (0.43 / 0.45) | 73.7 / 74.5 %, 39.5 %, 17.0 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 8 | 16 | 8.4 | 10.09 / 9.28 / 9.19 | 2391 | 0.6993 / 0.6357 | 0.9064 / 0.8903 | 3.12 (0.50 / 0.52) | 80.1 / 80.5 %, 50.5 %, 21.3 %, 32 | 2.49 / 2.63 | — |
| `dbts_c2` window | 8 | 24 | 11.5 | 10.09 / 9.28 / 9.19 | 2394 | 0.6976 / 0.6341 | 0.9062 / 0.8901 | 3.15 (0.64 / 0.67) | 86.2 / 86.6 %, 64.0 %, 33.0 %, 33 | 2.49 / 2.64 | — |
| `dbts_c2` window | 8 | 32 | 21.1 | 10.09 / 9.28 / 9.19 | 2393 | 0.6929 / 0.6292 | 0.9054 / 0.8893 | 3.25 (0.90 / 0.92) | 90.8 / 91.6 %, 76.2 %, 50.9 %, 42 | 2.51 / 2.65 | — |
| `dbts_c2` window | 8 | 40 | 61.8 | 10.09 / 9.27 / 9.19 | 2405 | 0.6832 / 0.6193 | 0.9035 / 0.8876 | 3.44 (1.08 / 1.08) | 93.4 / 94.1 %, 82.7 %, 63.2 %, 54 | 2.55 / 2.68 | — |
| `dbts_c2` window | 8 | 56 | 1290.3 | 10.08 / 9.27 / 9.18 | 2425 | 0.6686 / 0.6069 | 0.8955 / 0.8809 | 3.79 (1.09 / 1.10) | 95.4 / 95.7 %, 87.6 %, 72.5 %, 98 | 2.79 / 2.91 | — |
| `dbts_c3` 12bit | 1 | 1 | 5.1 | 72.98 / 72.82 / 72.82 | 31 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 19.5 / 19.9 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.03 | 10.0 |
| `dbts_c3` 12bit | 1 | 2 | 6.5 | 67.06 / 66.90 / 66.90 | 30 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.17 (0.18 / 0.19) | 38.2 / 39.0 %, 2.1 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbts_c3` 12bit | 1 | 4 | 10.9 | 59.08 / 58.92 / 58.91 | 112 | 0.9989 / 0.9988 | 0.9999 / 0.9998 | 0.44 (0.45 / 0.48) | 66.9 / 67.8 %, 24.9 %, 2.2 %, 10 | 0.10 / 0.12 | 9.98 |
| `dbts_c3` 12bit | 1 | 8 | 29.7 | 51.06 / 50.93 / 50.92 | 350 | 0.9926 / 0.9921 | 0.9990 / 0.9989 | 1.11 (0.93 / 0.95) | 85.2 / 85.9 %, 62.1 %, 28.8 %, 28 | 0.26 / 0.31 | 9.81 |
| `dbts_c3` 12bit | 1 | 12 | 86.4 | 47.67 / 47.59 / 47.59 | 437 | 0.9838 / 0.9832 | 0.9972 / 0.9969 | 1.63 (1.05 / 1.06) | 89.3 / 89.9 %, 72.6 %, 44.9 %, 52 | 0.46 / 0.54 | 9.39 |
| `dbts_c3` 12bit | 1 | 16 | 194.4 | 46.38 / 46.24 / 46.22 | 576 | 0.9788 / 0.9770 | 0.9955 / 0.9948 | 1.88 (1.06 / 1.07) | 90.6 / 91.3 %, 75.6 %, 50.1 %, 54 | 0.64 / 0.77 | 8.84 |
| `dbts_c3` 12bit | 1 | 24 | 451.9 | 45.37 / 45.24 / 45.22 | 451 | 0.9744 / 0.9721 | 0.9931 / 0.9920 | 2.10 (1.06 / 1.07) | 91.5 / 92.1 %, 77.6 %, 53.5 %, 74 | 0.90 / 1.11 | 7.84 |
| `dbts_c3` 12bit | 1 | 32 | 910.9 | 44.44 / 44.31 / 44.28 | 892 | 0.9714 / 0.9698 | 0.9903 / 0.9891 | 2.32 (1.06 / 1.07) | 92.4 / 92.8 %, 79.8 %, 57.2 %, 122 | 1.22 / 1.45 | 6.59 |
| `dbts_c3` 12bit | 1 | 40 | 1636.4 | 43.31 / 42.95 / 42.85 | 1134 | 0.9666 / 0.9615 | 0.9865 / 0.9853 | 2.62 (1.06 / 1.07) | 93.3 / 93.8 %, 81.9 %, 60.9 %, 130 | 1.62 / 1.80 | 5.36 |
| `dbts_c3` 12bit | 1 | 56 | 4517.2 | 39.32 / 38.87 / 38.83 | 2371 | 0.9398 / 0.9043 | 0.9722 / 0.9668 | 3.85 (1.06 / 1.07) | 95.0 / 95.3 %, 86.1 %, 69.1 %, 224 | 2.85 / 3.23 | 2.77 |
| `dbts_c3` 12bit | 16 | 1 | 5.1 | 73.00 / 72.84 / 72.83 | 55 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 19.4 / 19.8 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.03 | 10.0 |
| `dbts_c3` 12bit | 16 | 2 | 6.8 | 66.64 / 66.39 / 66.39 | 73 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.19 / 0.20) | 39.7 / 40.7 %, 2.8 %, 0.0 %, 4 | 0.04 / 0.05 | 10.0 |
| `dbts_c3` 12bit | 16 | 4 | 10.9 | 59.02 / 58.84 / 58.84 | 131 | 0.9988 / 0.9988 | 0.9998 / 0.9998 | 0.44 (0.45 / 0.48) | 67.1 / 68.0 %, 25.7 %, 2.3 %, 11 | 0.10 / 0.12 | 9.98 |
| `dbts_c3` 12bit | 16 | 8 | 29.5 | 51.17 / 51.05 / 50.93 | 237 | 0.9929 / 0.9922 | 0.9990 / 0.9989 | 1.09 (0.93 / 0.95) | 85.1 / 85.8 %, 61.8 %, 28.4 %, 29 | 0.26 / 0.31 | 9.81 |
| `dbts_c3` 12bit | 16 | 12 | 94.1 | 47.81 / 47.72 / 47.61 | 384 | 0.9844 / 0.9834 | 0.9973 / 0.9970 | 1.60 (1.05 / 1.06) | 89.2 / 89.9 %, 72.2 %, 44.2 %, 45 | 0.45 / 0.55 | 9.42 |
| `dbts_c3` 12bit | 16 | 16 | 285.6 | 46.40 / 46.25 / 46.22 | 414 | 0.9791 / 0.9771 | 0.9955 / 0.9948 | 1.88 (1.06 / 1.07) | 90.6 / 91.3 %, 75.6 %, 50.0 %, 63 | 0.63 / 0.79 | 8.84 |
| `dbts_c3` 12bit | 16 | 24 | 1064.3 | 45.25 / 44.97 / 44.92 | 540 | 0.9751 / 0.9722 | 0.9926 / 0.9910 | 2.15 (1.06 / 1.07) | 91.7 / 92.3 %, 78.1 %, 54.4 %, 78 | 0.97 / 1.23 | 7.58 |
| `dbts_c3` 12bit | 16 | 32 | 2819.7 | 44.18 / 43.97 / 43.94 | 645 | 0.9713 / 0.9707 | 0.9894 / 0.9881 | 2.39 (1.06 / 1.07) | 92.5 / 93.0 %, 80.4 %, 58.3 %, 107 | 1.31 / 1.58 | 6.38 |
| `dbts_c3` 12bit | 16 | 40 | 6214.6 | 42.96 / 42.37 / 42.25 | 929 | 0.9686 / 0.9627 | 0.9851 / 0.9835 | 2.77 (1.06 / 1.07) | 93.5 / 93.9 %, 82.5 %, 62.3 %, 137 | 1.75 / 1.99 | 5.05 |
| `dbts_c3` 12bit | 16 | 56 | 21536.0 | 38.96 / 37.82 / 37.72 | 2249 | 0.9401 / 0.9256 | 0.9706 / 0.9632 | 4.13 (1.06 / 1.07) | 95.3 / 95.7 %, 87.2 %, 71.6 %, 215 | 3.17 / 3.89 | 2.53 |
| `dbts_c3` 12bit | 8 | 1 | 5.1 | 73.00 / 72.84 / 72.83 | 52 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.09 (0.09 / 0.10) | 19.4 / 19.8 %, 0.0 %, 0.0 %, 2 | 0.02 / 0.03 | 10.0 |
| `dbts_c3` 12bit | 8 | 2 | 6.7 | 66.71 / 66.40 / 66.39 | 86 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.19 / 0.20) | 39.6 / 40.7 %, 2.8 %, 0.0 %, 5 | 0.04 / 0.05 | 10.0 |
| `dbts_c3` 12bit | 8 | 4 | 10.9 | 59.02 / 58.85 / 58.84 | 127 | 0.9988 / 0.9988 | 0.9998 / 0.9998 | 0.44 (0.45 / 0.48) | 67.1 / 68.0 %, 25.7 %, 2.3 %, 11 | 0.10 / 0.12 | 9.98 |
| `dbts_c3` 12bit | 8 | 8 | 29.6 | 51.16 / 51.00 / 50.93 | 276 | 0.9928 / 0.9922 | 0.9990 / 0.9989 | 1.09 (0.93 / 0.95) | 85.1 / 85.8 %, 61.8 %, 28.4 %, 29 | 0.26 / 0.31 | 9.81 |
| `dbts_c3` 12bit | 8 | 12 | 93.7 | 47.80 / 47.65 / 47.60 | 384 | 0.9843 / 0.9834 | 0.9973 / 0.9970 | 1.60 (1.05 / 1.06) | 89.2 / 89.9 %, 72.2 %, 44.2 %, 45 | 0.45 / 0.55 | 9.42 |
| `dbts_c3` 12bit | 8 | 16 | 278.6 | 46.40 / 46.25 / 46.22 | 405 | 0.9791 / 0.9771 | 0.9955 / 0.9948 | 1.88 (1.06 / 1.07) | 90.6 / 91.3 %, 75.6 %, 50.0 %, 57 | 0.63 / 0.79 | 8.84 |
| `dbts_c3` 12bit | 8 | 24 | 1012.6 | 45.26 / 44.98 / 44.91 | 540 | 0.9748 / 0.9722 | 0.9926 / 0.9910 | 2.15 (1.06 / 1.07) | 91.7 / 92.3 %, 78.1 %, 54.4 %, 95 | 0.97 / 1.24 | 7.56 |
| `dbts_c3` 12bit | 8 | 32 | 2584.2 | 44.29 / 44.00 / 43.94 | 645 | 0.9713 / 0.9706 | 0.9896 / 0.9882 | 2.38 (1.06 / 1.07) | 92.5 / 93.0 %, 80.3 %, 58.1 %, 107 | 1.30 / 1.57 | 6.37 |
| `dbts_c3` 12bit | 8 | 40 | 5542.5 | 43.01 / 42.45 / 42.29 | 929 | 0.9672 / 0.9627 | 0.9854 / 0.9835 | 2.74 (1.06 / 1.07) | 93.5 / 94.0 %, 82.3 %, 62.0 %, 136 | 1.72 / 1.98 | 5.06 |
| `dbts_c3` 12bit | 8 | 56 | 17983.2 | 39.16 / 38.14 / 37.93 | 2311 | 0.9404 / 0.9256 | 0.9718 / 0.9634 | 4.00 (1.06 / 1.07) | 95.1 / 95.7 %, 87.0 %, 71.4 %, 215 | 2.98 / 3.80 | 2.54 |
| `dbts_c3` top10 | 1 | 1 | 6.1 | 66.20 / 66.03 / 66.03 | 47 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.19 (0.19 / 0.21) | 40.0 / 40.8 %, 3.6 %, 0.0 %, 5 | 0.06 / 0.07 | — |
| `dbts_c3` top10 | 1 | 2 | 7.9 | 62.73 / 62.57 / 62.57 | 40 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 54.2 / 55.2 %, 10.9 %, 0.1 %, 7 | 0.08 / 0.10 | — |
| `dbts_c3` top10 | 1 | 4 | 12.4 | 57.29 / 57.15 / 57.14 | 133 | 0.9983 / 0.9982 | 0.9998 / 0.9998 | 0.54 (0.54 / 0.57) | 72.3 / 73.1 %, 33.5 %, 4.9 %, 15 | 0.13 / 0.16 | — |
| `dbts_c3` top10 | 1 | 8 | 31.6 | 50.71 / 50.60 / 50.59 | 350 | 0.9921 / 0.9917 | 0.9989 / 0.9988 | 1.15 (0.95 / 0.96) | 85.8 / 86.4 %, 63.4 %, 30.6 %, 29 | 0.28 / 0.33 | — |
| `dbts_c3` top10 | 1 | 12 | 80.9 | 47.82 / 47.74 / 47.69 | 437 | 0.9846 / 0.9840 | 0.9974 / 0.9971 | 1.60 (1.05 / 1.06) | 89.2 / 89.8 %, 72.3 %, 44.4 %, 47 | 0.45 / 0.54 | — |
| `dbts_c3` top10 | 1 | 16 | 168.4 | 46.56 / 46.43 / 46.42 | 532 | 0.9798 / 0.9787 | 0.9958 / 0.9953 | 1.85 (1.06 / 1.07) | 90.5 / 91.1 %, 75.3 %, 49.5 %, 55 | 0.61 / 0.74 | — |
| `dbts_c3` top10 | 1 | 24 | 394.3 | 45.54 / 45.41 / 45.40 | 425 | 0.9761 / 0.9745 | 0.9936 / 0.9927 | 2.06 (1.06 / 1.07) | 91.4 / 92.0 %, 77.4 %, 53.1 %, 64 | 0.86 / 1.05 | — |
| `dbts_c3` top10 | 1 | 32 | 784.1 | 44.67 / 44.59 / 44.57 | 731 | 0.9739 / 0.9713 | 0.9912 / 0.9901 | 2.27 (1.06 / 1.08) | 92.3 / 92.7 %, 79.3 %, 56.4 %, 116 | 1.15 / 1.37 | — |
| `dbts_c3` top10 | 1 | 40 | 1369.3 | 43.75 / 43.49 / 43.41 | 963 | 0.9690 / 0.9678 | 0.9878 / 0.9868 | 2.51 (1.07 / 1.08) | 93.0 / 93.6 %, 81.4 %, 59.9 %, 123 | 1.48 / 1.67 | — |
| `dbts_c3` top10 | 1 | 56 | 3643.1 | 40.68 / 40.07 / 40.04 | 2246 | 0.9455 / 0.9313 | 0.9762 / 0.9729 | 3.40 (1.07 / 1.08) | 94.6 / 94.8 %, 84.5 %, 66.2 %, 212 | 2.41 / 2.76 | — |
| `dbts_c3` top10 | 16 | 1 | 6.3 | 65.87 / 65.64 / 65.63 | 81 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.20 (0.19 / 0.21) | 41.2 / 42.3 %, 4.1 %, 0.0 %, 5 | 0.07 / 0.08 | — |
| `dbts_c3` top10 | 16 | 2 | 7.9 | 62.68 / 62.50 / 62.49 | 108 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 54.4 / 55.4 %, 11.1 %, 0.2 %, 7 | 0.08 / 0.10 | — |
| `dbts_c3` top10 | 16 | 4 | 12.4 | 57.23 / 57.05 / 57.04 | 173 | 0.9983 / 0.9981 | 0.9998 / 0.9997 | 0.54 (0.54 / 0.57) | 72.5 / 73.3 %, 34.3 %, 5.3 %, 13 | 0.13 / 0.16 | — |
| `dbts_c3` top10 | 16 | 8 | 31.6 | 50.81 / 50.70 / 50.62 | 300 | 0.9923 / 0.9918 | 0.9989 / 0.9988 | 1.14 (0.94 / 0.96) | 85.7 / 86.3 %, 63.2 %, 30.1 %, 29 | 0.28 / 0.34 | — |
| `dbts_c3` top10 | 16 | 12 | 87.7 | 47.90 / 47.79 / 47.77 | 339 | 0.9850 / 0.9841 | 0.9974 / 0.9971 | 1.59 (1.05 / 1.06) | 89.2 / 89.8 %, 72.1 %, 44.0 %, 44 | 0.45 / 0.55 | — |
| `dbts_c3` top10 | 16 | 16 | 237.2 | 46.56 / 46.41 / 46.40 | 413 | 0.9800 / 0.9787 | 0.9958 / 0.9952 | 1.85 (1.06 / 1.07) | 90.5 / 91.1 %, 75.3 %, 49.5 %, 53 | 0.61 / 0.76 | — |
| `dbts_c3` top10 | 16 | 24 | 815.7 | 45.49 / 45.29 / 45.23 | 476 | 0.9760 / 0.9744 | 0.9935 / 0.9922 | 2.08 (1.06 / 1.07) | 91.5 / 92.2 %, 77.5 %, 53.4 %, 78 | 0.89 / 1.13 | — |
| `dbts_c3` top10 | 16 | 32 | 2172.4 | 44.57 / 44.43 / 44.41 | 528 | 0.9739 / 0.9727 | 0.9908 / 0.9897 | 2.29 (1.07 / 1.08) | 92.3 / 92.8 %, 79.5 %, 56.8 %, 115 | 1.18 / 1.41 | — |
| `dbts_c3` top10 | 16 | 40 | 4612.6 | 43.55 / 43.22 / 43.13 | 950 | 0.9689 / 0.9683 | 0.9872 / 0.9860 | 2.57 (1.07 / 1.08) | 93.2 / 93.6 %, 81.5 %, 60.3 %, 145 | 1.53 / 1.77 | — |
| `dbts_c3` top10 | 16 | 56 | 16036.9 | 40.55 / 39.60 / 39.44 | 2246 | 0.9509 / 0.9313 | 0.9754 / 0.9704 | 3.56 (1.07 / 1.08) | 94.7 / 95.0 %, 85.1 %, 67.6 %, 182 | 2.59 / 3.05 | — |
| `dbts_c3` top10 | 8 | 1 | 6.3 | 65.93 / 65.64 / 65.63 | 74 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.20 (0.20 / 0.21) | 41.1 / 42.3 %, 4.1 %, 0.0 %, 5 | 0.06 / 0.08 | — |
| `dbts_c3` top10 | 8 | 2 | 7.9 | 62.68 / 62.50 / 62.49 | 108 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.29 (0.29 / 0.31) | 54.4 / 55.4 %, 11.1 %, 0.2 %, 7 | 0.08 / 0.10 | — |
| `dbts_c3` top10 | 8 | 4 | 12.4 | 57.22 / 57.06 / 57.05 | 173 | 0.9983 / 0.9981 | 0.9998 / 0.9997 | 0.54 (0.54 / 0.57) | 72.5 / 73.3 %, 34.3 %, 5.3 %, 12 | 0.13 / 0.16 | — |
| `dbts_c3` top10 | 8 | 8 | 31.6 | 50.81 / 50.67 / 50.61 | 276 | 0.9923 / 0.9917 | 0.9989 / 0.9988 | 1.14 (0.94 / 0.96) | 85.7 / 86.3 %, 63.2 %, 30.1 %, 29 | 0.28 / 0.34 | — |
| `dbts_c3` top10 | 8 | 12 | 87.3 | 47.90 / 47.79 / 47.76 | 276 | 0.9849 / 0.9841 | 0.9974 / 0.9971 | 1.59 (1.05 / 1.06) | 89.2 / 89.8 %, 72.1 %, 44.0 %, 44 | 0.45 / 0.55 | — |
| `dbts_c3` top10 | 8 | 16 | 232.7 | 46.56 / 46.41 / 46.40 | 413 | 0.9800 / 0.9787 | 0.9958 / 0.9952 | 1.85 (1.06 / 1.07) | 90.5 / 91.1 %, 75.3 %, 49.5 %, 52 | 0.61 / 0.76 | — |
| `dbts_c3` top10 | 8 | 24 | 781.3 | 45.49 / 45.28 / 45.23 | 476 | 0.9760 / 0.9744 | 0.9935 / 0.9922 | 2.08 (1.06 / 1.07) | 91.5 / 92.2 %, 77.5 %, 53.4 %, 64 | 0.89 / 1.13 | — |
| `dbts_c3` top10 | 8 | 32 | 2008.8 | 44.59 / 44.44 / 44.42 | 528 | 0.9739 / 0.9713 | 0.9909 / 0.9897 | 2.29 (1.07 / 1.08) | 92.3 / 92.8 %, 79.5 %, 56.8 %, 113 | 1.19 / 1.41 | — |
| `dbts_c3` top10 | 8 | 40 | 4150.0 | 43.64 / 43.25 / 43.18 | 950 | 0.9691 / 0.9683 | 0.9873 / 0.9862 | 2.57 (1.07 / 1.08) | 93.1 / 93.6 %, 81.5 %, 60.3 %, 135 | 1.54 / 1.75 | — |
| `dbts_c3` top10 | 8 | 56 | 13587.8 | 40.60 / 39.69 / 39.54 | 2246 | 0.9480 / 0.9313 | 0.9754 / 0.9704 | 3.50 (1.07 / 1.08) | 94.6 / 95.0 %, 85.1 %, 67.6 %, 182 | 2.53 / 3.04 | — |
| `dbts_c3` window | 1 | 1 | 4.0 | 7.58 / 6.85 / 6.77 | 2434 | 0.4970 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 21.8 / 25.1 %, 16.9 %, 13.1 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 1 | 2 | 4.9 | 7.58 / 6.85 / 6.77 | 2434 | 0.4969 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 27.1 / 30.2 %, 17.2 %, 13.3 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 1 | 4 | 6.2 | 7.58 / 6.85 / 6.77 | 2436 | 0.4969 / 0.3981 | 0.8812 / 0.8492 | 3.31 (0.40 / 0.44) | 38.0 / 40.9 %, 17.6 %, 13.6 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 1 | 8 | 8.7 | 7.58 / 6.85 / 6.77 | 2442 | 0.4966 / 0.3979 | 0.8811 / 0.8492 | 3.32 (0.45 / 0.48) | 59.0 / 61.0 %, 23.7 %, 13.9 %, 31 | 2.04 / 3.15 | — |
| `dbts_c3` window | 1 | 12 | 11.3 | 7.58 / 6.85 / 6.77 | 2446 | 0.4961 / 0.3974 | 0.8811 / 0.8491 | 3.34 (0.53 / 0.56) | 71.8 / 73.3 %, 36.3 %, 15.3 %, 32 | 2.04 / 3.15 | — |
| `dbts_c3` window | 1 | 16 | 14.2 | 7.58 / 6.85 / 6.77 | 2444 | 0.4953 / 0.3968 | 0.8809 / 0.8491 | 3.36 (0.62 / 0.65) | 78.7 / 79.8 %, 47.3 %, 18.7 %, 33 | 2.05 / 3.15 | — |
| `dbts_c3` window | 1 | 24 | 21.5 | 7.58 / 6.85 / 6.77 | 2450 | 0.4933 / 0.3949 | 0.8806 / 0.8488 | 3.42 (0.79 / 0.83) | 85.6 / 86.3 %, 61.7 %, 29.2 %, 50 | 2.05 / 3.16 | — |
| `dbts_c3` window | 1 | 32 | 49.0 | 7.58 / 6.85 / 6.77 | 2473 | 0.4878 / 0.3896 | 0.8796 / 0.8481 | 3.58 (1.01 / 1.02) | 90.6 / 91.0 %, 73.9 %, 45.5 %, 49 | 2.08 / 3.18 | — |
| `dbts_c3` window | 1 | 40 | 165.0 | 7.58 / 6.84 / 6.77 | 2466 | 0.4804 / 0.3823 | 0.8775 / 0.8464 | 3.78 (1.06 / 1.07) | 92.7 / 93.1 %, 79.6 %, 55.6 %, 72 | 2.15 / 3.22 | — |
| `dbts_c3` window | 1 | 56 | 1265.4 | 7.57 / 6.84 / 6.77 | 2521 | 0.4746 / 0.3777 | 0.8721 / 0.8421 | 4.07 (1.06 / 1.07) | 94.2 / 94.5 %, 83.7 %, 63.5 %, 131 | 2.46 / 3.43 | — |
| `dbts_c3` window | 16 | 1 | 4.1 | 7.58 / 6.85 / 6.77 | 2434 | 0.4970 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 22.2 / 25.5 %, 17.0 %, 13.2 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 16 | 2 | 4.9 | 7.58 / 6.85 / 6.77 | 2434 | 0.4969 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 27.3 / 30.4 %, 17.2 %, 13.3 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 16 | 4 | 6.2 | 7.58 / 6.85 / 6.77 | 2437 | 0.4969 / 0.3981 | 0.8812 / 0.8492 | 3.31 (0.40 / 0.44) | 38.3 / 41.1 %, 17.5 %, 13.5 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 16 | 8 | 8.6 | 7.58 / 6.85 / 6.77 | 2439 | 0.4966 / 0.3979 | 0.8812 / 0.8492 | 3.32 (0.45 / 0.48) | 59.2 / 61.4 %, 23.8 %, 13.9 %, 31 | 2.04 / 3.15 | — |
| `dbts_c3` window | 16 | 12 | 11.2 | 7.58 / 6.85 / 6.77 | 2447 | 0.4961 / 0.3974 | 0.8811 / 0.8491 | 3.34 (0.53 / 0.56) | 72.0 / 73.5 %, 36.6 %, 15.3 %, 32 | 2.04 / 3.15 | — |
| `dbts_c3` window | 16 | 16 | 14.1 | 7.58 / 6.85 / 6.77 | 2444 | 0.4953 / 0.3968 | 0.8809 / 0.8491 | 3.37 (0.62 / 0.65) | 78.8 / 79.9 %, 47.5 %, 18.8 %, 32 | 2.05 / 3.15 | — |
| `dbts_c3` window | 16 | 24 | 21.4 | 7.58 / 6.85 / 6.77 | 2460 | 0.4933 / 0.3949 | 0.8806 / 0.8488 | 3.43 (0.79 / 0.83) | 85.6 / 86.3 %, 61.7 %, 29.2 %, 32 | 2.06 / 3.16 | — |
| `dbts_c3` window | 16 | 32 | 49.1 | 7.58 / 6.85 / 6.77 | 2458 | 0.4882 / 0.3898 | 0.8796 / 0.8481 | 3.57 (1.00 / 1.02) | 90.5 / 91.0 %, 73.8 %, 45.5 %, 36 | 2.08 / 3.18 | — |
| `dbts_c3` window | 16 | 40 | 202.1 | 7.58 / 6.84 / 6.77 | 2465 | 0.4808 / 0.3826 | 0.8775 / 0.8464 | 3.77 (1.06 / 1.07) | 92.7 / 93.1 %, 79.7 %, 55.7 %, 53 | 2.15 / 3.22 | — |
| `dbts_c3` window | 16 | 56 | 3392.7 | 7.57 / 6.84 / 6.77 | 2534 | 0.4745 / 0.3777 | 0.8719 / 0.8422 | 4.07 (1.06 / 1.07) | 94.2 / 94.5 %, 83.8 %, 63.8 %, 94 | 2.46 / 3.43 | — |
| `dbts_c3` window | 8 | 1 | 4.1 | 7.58 / 6.85 / 6.77 | 2434 | 0.4970 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 22.2 / 25.5 %, 17.0 %, 13.2 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 8 | 2 | 4.9 | 7.58 / 6.85 / 6.77 | 2434 | 0.4969 / 0.3982 | 0.8812 / 0.8493 | 3.31 (0.39 / 0.43) | 27.3 / 30.4 %, 17.2 %, 13.3 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 8 | 4 | 6.2 | 7.58 / 6.85 / 6.77 | 2436 | 0.4969 / 0.3981 | 0.8812 / 0.8492 | 3.31 (0.40 / 0.44) | 38.3 / 41.1 %, 17.5 %, 13.5 %, 30 | 2.03 / 3.14 | — |
| `dbts_c3` window | 8 | 8 | 8.6 | 7.58 / 6.85 / 6.77 | 2441 | 0.4966 / 0.3979 | 0.8812 / 0.8492 | 3.32 (0.45 / 0.48) | 59.2 / 61.4 %, 23.8 %, 13.9 %, 31 | 2.04 / 3.15 | — |
| `dbts_c3` window | 8 | 12 | 11.2 | 7.58 / 6.85 / 6.77 | 2447 | 0.4961 / 0.3974 | 0.8811 / 0.8491 | 3.34 (0.53 / 0.56) | 72.0 / 73.5 %, 36.6 %, 15.3 %, 32 | 2.04 / 3.15 | — |
| `dbts_c3` window | 8 | 16 | 14.1 | 7.58 / 6.85 / 6.77 | 2447 | 0.4953 / 0.3968 | 0.8809 / 0.8491 | 3.36 (0.62 / 0.65) | 78.7 / 79.9 %, 47.5 %, 18.8 %, 32 | 2.05 / 3.15 | — |
| `dbts_c3` window | 8 | 24 | 21.4 | 7.58 / 6.85 / 6.77 | 2460 | 0.4933 / 0.3949 | 0.8806 / 0.8488 | 3.42 (0.79 / 0.83) | 85.6 / 86.3 %, 61.7 %, 29.2 %, 36 | 2.06 / 3.16 | — |
| `dbts_c3` window | 8 | 32 | 49.1 | 7.58 / 6.85 / 6.77 | 2457 | 0.4882 / 0.3898 | 0.8796 / 0.8481 | 3.57 (1.00 / 1.02) | 90.5 / 91.0 %, 73.8 %, 45.5 %, 49 | 2.08 / 3.18 | — |
| `dbts_c3` window | 8 | 40 | 201.0 | 7.58 / 6.84 / 6.77 | 2468 | 0.4808 / 0.3826 | 0.8775 / 0.8464 | 3.77 (1.06 / 1.07) | 92.7 / 93.1 %, 79.7 %, 55.7 %, 72 | 2.15 / 3.22 | — |
| `dbts_c3` window | 8 | 56 | 3173.4 | 7.57 / 6.84 / 6.77 | 2509 | 0.4745 / 0.3777 | 0.8719 / 0.8422 | 4.07 (1.06 / 1.07) | 94.2 / 94.5 %, 83.8 %, 63.7 %, 97 | 2.46 / 3.43 | — |
| `dbts_c4` 12bit | 1 | 1 | 5.4 | 73.36 / 73.27 / 73.25 | 21 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.08 (0.08 / 0.09) | 28.6 / 29.7 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.02 | 10.0 |
| `dbts_c4` 12bit | 1 | 2 | 6.9 | 67.46 / 67.36 / 67.35 | 26 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.16 (0.16 / 0.17) | 50.9 / 53.0 %, 8.7 %, 0.0 %, 6 | 0.04 / 0.05 | 10.0 |
| `dbts_c4` 12bit | 1 | 4 | 11.1 | 59.60 / 59.47 / 59.45 | 52 | 0.9990 / 0.9990 | 0.9999 / 0.9999 | 0.40 (0.41 / 0.43) | 75.5 / 77.5 %, 42.7 %, 9.2 %, 13 | 0.09 / 0.11 | 9.97 |
| `dbts_c4` 12bit | 1 | 8 | 28.4 | 51.37 / 51.29 / 51.24 | 267 | 0.9933 / 0.9930 | 0.9991 / 0.9990 | 1.03 (0.89 / 0.91) | 89.3 / 90.8 %, 74.4 %, 47.2 %, 36 | 0.24 / 0.30 | 9.7 |
| `dbts_c4` 12bit | 1 | 12 | 74.6 | 47.83 / 47.69 / 47.68 | 353 | 0.9847 / 0.9840 | 0.9975 / 0.9973 | 1.55 (1.04 / 1.06) | 92.4 / 93.6 %, 82.2 %, 62.0 %, 65 | 0.43 / 0.54 | 9.11 |
| `dbts_c4` 12bit | 1 | 16 | 159.7 | 46.30 / 46.24 / 46.21 | 493 | 0.9788 / 0.9777 | 0.9957 / 0.9953 | 1.83 (1.05 / 1.08) | 93.4 / 94.6 %, 84.6 %, 66.7 %, 74 | 0.60 / 0.76 | 8.35 |
| `dbts_c4` 12bit | 1 | 24 | 369.1 | 45.15 / 45.04 / 45.02 | 471 | 0.9734 / 0.9722 | 0.9932 / 0.9925 | 2.08 (1.06 / 1.08) | 94.2 / 95.2 %, 86.4 %, 70.0 %, 90 | 0.89 / 1.13 | 7.04 |
| `dbts_c4` 12bit | 1 | 32 | 712.0 | 44.15 / 43.99 / 43.96 | 857 | 0.9705 / 0.9685 | 0.9904 / 0.9895 | 2.31 (1.06 / 1.08) | 94.9 / 95.8 %, 87.9 %, 73.1 %, 109 | 1.20 / 1.48 | 5.68 |
| `dbts_c4` 12bit | 1 | 40 | 1192.8 | 42.93 / 42.54 / 42.48 | 1165 | 0.9653 / 0.9620 | 0.9868 / 0.9857 | 2.60 (1.06 / 1.08) | 95.6 / 96.3 %, 89.3 %, 75.8 %, 162 | 1.59 / 1.85 | 4.6 |
| `dbts_c4` 12bit | 1 | 56 | 2672.3 | 38.78 / 38.22 / 38.19 | 2380 | 0.9267 / 0.8807 | 0.9736 / 0.9688 | 3.69 (1.06 / 1.09) | 96.9 / 97.1 %, 91.7 %, 81.0 %, 232 | 2.91 / 3.44 | 2.39 |
| `dbts_c4` 12bit | 16 | 1 | 5.3 | 73.35 / 73.25 / 73.23 | 40 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.08 (0.08 / 0.09) | 28.5 / 29.7 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.02 | 10.0 |
| `dbts_c4` 12bit | 16 | 2 | 6.9 | 67.47 / 67.35 / 67.32 | 55 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.16 (0.16 / 0.17) | 50.8 / 52.9 %, 8.7 %, 0.0 %, 8 | 0.04 / 0.05 | 10.0 |
| `dbts_c4` 12bit | 16 | 4 | 11.1 | 59.63 / 59.51 / 59.48 | 142 | 0.9990 / 0.9990 | 0.9999 / 0.9999 | 0.40 (0.40 / 0.43) | 75.4 / 77.4 %, 42.6 %, 9.2 %, 13 | 0.09 / 0.11 | 9.97 |
| `dbts_c4` 12bit | 16 | 8 | 28.8 | 51.39 / 51.30 / 51.29 | 239 | 0.9934 / 0.9930 | 0.9991 / 0.9990 | 1.03 (0.89 / 0.91) | 89.2 / 90.8 %, 74.4 %, 47.1 %, 38 | 0.24 / 0.31 | 9.7 |
| `dbts_c4` 12bit | 16 | 12 | 81.5 | 47.90 / 47.79 / 47.74 | 333 | 0.9850 / 0.9843 | 0.9976 / 0.9973 | 1.54 (1.04 / 1.06) | 92.3 / 93.6 %, 82.2 %, 61.8 %, 66 | 0.41 / 0.54 | 9.13 |
| `dbts_c4` 12bit | 16 | 16 | 225.5 | 46.29 / 46.21 / 46.17 | 381 | 0.9789 / 0.9782 | 0.9957 / 0.9953 | 1.84 (1.05 / 1.08) | 93.4 / 94.6 %, 84.7 %, 66.9 %, 82 | 0.60 / 0.76 | 8.28 |
| `dbts_c4` 12bit | 16 | 24 | 835.2 | 44.90 / 44.74 / 44.72 | 459 | 0.9735 / 0.9724 | 0.9924 / 0.9915 | 2.14 (1.06 / 1.08) | 94.3 / 95.4 %, 86.7 %, 70.9 %, 95 | 0.99 / 1.28 | 6.71 |
| `dbts_c4` 12bit | 16 | 32 | 2089.0 | 43.94 / 43.68 / 43.64 | 708 | 0.9703 / 0.9691 | 0.9897 / 0.9885 | 2.37 (1.06 / 1.08) | 95.0 / 95.9 %, 88.2 %, 73.8 %, 116 | 1.32 / 1.60 | 5.55 |
| `dbts_c4` 12bit | 16 | 40 | 4355.0 | 42.49 / 41.97 / 41.88 | 1134 | 0.9648 / 0.9623 | 0.9858 / 0.9834 | 2.67 (1.06 / 1.08) | 95.8 / 96.5 %, 89.7 %, 76.9 %, 168 | 1.77 / 2.09 | 4.5 |
| `dbts_c4` 12bit | 16 | 56 | 13929.5 | 38.16 / 37.17 / 36.94 | 2055 | 0.9253 / 0.9138 | 0.9706 / 0.9611 | 4.14 (1.06 / 1.09) | 97.1 / 97.5 %, 92.6 %, 83.1 %, 227 | 3.28 / 4.19 | 2.2 |
| `dbts_c4` 12bit | 8 | 1 | 5.3 | 73.35 / 73.25 / 73.23 | 44 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 0.08 (0.08 / 0.09) | 28.6 / 29.7 %, 0.5 %, 0.0 %, 3 | 0.02 / 0.02 | 10.0 |
| `dbts_c4` 12bit | 8 | 2 | 6.9 | 67.47 / 67.35 / 67.33 | 79 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.16 (0.16 / 0.17) | 50.8 / 52.9 %, 8.7 %, 0.0 %, 7 | 0.04 / 0.05 | 10.0 |
| `dbts_c4` 12bit | 8 | 4 | 11.1 | 59.62 / 59.51 / 59.47 | 161 | 0.9990 / 0.9990 | 0.9999 / 0.9999 | 0.40 (0.40 / 0.43) | 75.4 / 77.5 %, 42.6 %, 9.2 %, 17 | 0.09 / 0.11 | 9.97 |
| `dbts_c4` 12bit | 8 | 8 | 28.8 | 51.39 / 51.30 / 51.28 | 220 | 0.9934 / 0.9930 | 0.9991 / 0.9990 | 1.03 (0.89 / 0.91) | 89.2 / 90.8 %, 74.4 %, 47.1 %, 38 | 0.24 / 0.31 | 9.7 |
| `dbts_c4` 12bit | 8 | 12 | 80.9 | 47.90 / 47.78 / 47.74 | 333 | 0.9850 / 0.9843 | 0.9976 / 0.9973 | 1.54 (1.04 / 1.06) | 92.3 / 93.6 %, 82.2 %, 61.8 %, 66 | 0.42 / 0.54 | 9.13 |
| `dbts_c4` 12bit | 8 | 16 | 219.3 | 46.30 / 46.21 / 46.18 | 368 | 0.9789 / 0.9782 | 0.9957 / 0.9953 | 1.83 (1.05 / 1.08) | 93.4 / 94.6 %, 84.7 %, 66.9 %, 82 | 0.60 / 0.76 | 8.3 |
| `dbts_c4` 12bit | 8 | 24 | 788.7 | 44.92 / 44.75 / 44.68 | 478 | 0.9735 / 0.9718 | 0.9925 / 0.9915 | 2.13 (1.06 / 1.08) | 94.3 / 95.4 %, 86.7 %, 70.8 %, 95 | 0.99 / 1.28 | 6.69 |
| `dbts_c4` 12bit | 8 | 32 | 1901.4 | 44.00 / 43.73 / 43.65 | 708 | 0.9704 / 0.9691 | 0.9898 / 0.9886 | 2.35 (1.06 / 1.08) | 95.0 / 95.9 %, 88.2 %, 73.7 %, 131 | 1.29 / 1.60 | 5.59 |
| `dbts_c4` 12bit | 8 | 40 | 3795.9 | 42.56 / 42.03 / 41.92 | 1134 | 0.9646 / 0.9623 | 0.9859 / 0.9836 | 2.66 (1.06 / 1.08) | 95.8 / 96.5 %, 89.7 %, 76.8 %, 152 | 1.75 / 2.07 | 4.47 |
| `dbts_c4` 12bit | 8 | 56 | 11109.2 | 38.42 / 37.37 / 37.32 | 2267 | 0.9277 / 0.9138 | 0.9722 / 0.9638 | 3.91 (1.06 / 1.08) | 97.0 / 97.4 %, 92.4 %, 82.9 %, 229 | 3.06 / 4.04 | 2.4 |
| `dbts_c4` top10 | 1 | 1 | 6.4 | 66.62 / 66.53 / 66.52 | 36 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.17 / 0.19) | 50.1 / 51.8 %, 12.2 %, 0.1 %, 6 | 0.06 / 0.07 | — |
| `dbts_c4` top10 | 1 | 2 | 8.3 | 63.12 / 63.03 / 63.02 | 47 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.27 (0.27 / 0.28) | 64.6 / 66.7 %, 25.7 %, 1.8 %, 9 | 0.08 / 0.09 | — |
| `dbts_c4` top10 | 1 | 4 | 12.6 | 57.82 / 57.70 / 57.69 | 103 | 0.9985 / 0.9985 | 0.9998 / 0.9998 | 0.49 (0.49 / 0.52) | 79.4 / 81.2 %, 50.9 %, 15.5 %, 16 | 0.12 / 0.15 | — |
| `dbts_c4` top10 | 1 | 8 | 30.1 | 51.03 / 50.94 / 50.94 | 262 | 0.9928 / 0.9926 | 0.9990 / 0.9989 | 1.07 (0.91 / 0.93) | 89.7 / 91.2 %, 75.4 %, 48.8 %, 40 | 0.26 / 0.33 | — |
| `dbts_c4` top10 | 1 | 12 | 70.2 | 47.96 / 47.86 / 47.85 | 353 | 0.9855 / 0.9850 | 0.9976 / 0.9974 | 1.53 (1.04 / 1.06) | 92.3 / 93.6 %, 82.0 %, 61.5 %, 63 | 0.42 / 0.53 | — |
| `dbts_c4` top10 | 1 | 16 | 139.8 | 46.51 / 46.44 / 46.43 | 502 | 0.9800 / 0.9792 | 0.9961 / 0.9957 | 1.80 (1.05 / 1.08) | 93.2 / 94.5 %, 84.4 %, 66.1 %, 79 | 0.57 / 0.73 | — |
| `dbts_c4` top10 | 1 | 24 | 320.6 | 45.35 / 45.26 / 45.25 | 521 | 0.9752 / 0.9741 | 0.9938 / 0.9930 | 2.04 (1.06 / 1.08) | 94.0 / 95.1 %, 86.1 %, 69.5 %, 99 | 0.83 / 1.07 | — |
| `dbts_c4` top10 | 1 | 32 | 618.7 | 44.44 / 44.30 / 44.27 | 758 | 0.9723 / 0.9712 | 0.9912 / 0.9905 | 2.25 (1.06 / 1.09) | 94.7 / 95.7 %, 87.5 %, 72.3 %, 106 | 1.13 / 1.39 | — |
| `dbts_c4` top10 | 1 | 40 | 1016.6 | 43.43 / 43.12 / 43.11 | 1065 | 0.9673 / 0.9648 | 0.9881 / 0.9872 | 2.48 (1.06 / 1.09) | 95.3 / 96.2 %, 88.9 %, 75.0 %, 134 | 1.45 / 1.73 | — |
| `dbts_c4` top10 | 1 | 56 | 2276.3 | 40.09 / 39.49 / 39.42 | 2282 | 0.9400 / 0.9310 | 0.9776 / 0.9729 | 3.33 (1.06 / 1.09) | 96.6 / 97.0 %, 91.0 %, 79.4 %, 222 | 2.50 / 2.93 | — |
| `dbts_c4` top10 | 16 | 1 | 6.4 | 66.62 / 66.51 / 66.50 | 58 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.17 / 0.19) | 50.1 / 51.8 %, 12.2 %, 0.1 %, 7 | 0.06 / 0.07 | — |
| `dbts_c4` top10 | 16 | 2 | 8.3 | 63.17 / 63.05 / 63.05 | 100 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.26 (0.26 / 0.28) | 64.5 / 66.7 %, 25.6 %, 1.8 %, 10 | 0.07 / 0.09 | — |
| `dbts_c4` top10 | 16 | 4 | 12.6 | 57.81 / 57.60 / 57.44 | 160 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.49 / 0.52) | 79.4 / 81.1 %, 50.9 %, 15.8 %, 20 | 0.12 / 0.15 | — |
| `dbts_c4` top10 | 16 | 8 | 30.6 | 51.05 / 50.96 / 50.95 | 262 | 0.9929 / 0.9927 | 0.9990 / 0.9989 | 1.07 (0.90 / 0.93) | 89.6 / 91.2 %, 75.4 %, 48.8 %, 39 | 0.26 / 0.33 | — |
| `dbts_c4` top10 | 16 | 12 | 76.1 | 47.99 / 47.91 / 47.89 | 329 | 0.9856 / 0.9852 | 0.9976 / 0.9974 | 1.52 (1.04 / 1.06) | 92.3 / 93.6 %, 82.0 %, 61.5 %, 62 | 0.42 / 0.53 | — |
| `dbts_c4` top10 | 16 | 16 | 184.2 | 46.52 / 46.45 / 46.41 | 418 | 0.9802 / 0.9795 | 0.9960 / 0.9957 | 1.80 (1.06 / 1.08) | 93.3 / 94.5 %, 84.4 %, 66.1 %, 71 | 0.58 / 0.74 | — |
| `dbts_c4` top10 | 16 | 24 | 644.3 | 45.25 / 45.10 / 45.08 | 521 | 0.9752 / 0.9739 | 0.9934 / 0.9925 | 2.07 (1.06 / 1.08) | 94.1 / 95.2 %, 86.3 %, 70.0 %, 92 | 0.88 / 1.14 | — |
| `dbts_c4` top10 | 16 | 32 | 1659.0 | 44.33 / 44.16 / 44.10 | 633 | 0.9724 / 0.9718 | 0.9909 / 0.9899 | 2.27 (1.06 / 1.09) | 94.8 / 95.7 %, 87.7 %, 72.7 %, 107 | 1.17 / 1.45 | — |
| `dbts_c4` top10 | 16 | 40 | 3328.9 | 43.23 / 42.86 / 42.79 | 882 | 0.9680 / 0.9662 | 0.9876 / 0.9864 | 2.51 (1.06 / 1.09) | 95.4 / 96.2 %, 88.9 %, 75.2 %, 151 | 1.53 / 1.82 | — |
| `dbts_c4` top10 | 16 | 56 | 10834.6 | 39.63 / 38.94 / 38.77 | 1892 | 0.9421 / 0.9379 | 0.9761 / 0.9709 | 3.50 (1.06 / 1.09) | 96.7 / 97.0 %, 91.3 %, 80.1 %, 208 | 2.66 / 3.22 | — |
| `dbts_c4` top10 | 8 | 1 | 6.4 | 66.62 / 66.51 / 66.50 | 61 | 0.9998 / 0.9998 | 1.0000 / 1.0000 | 0.18 (0.17 / 0.19) | 50.1 / 51.8 %, 12.2 %, 0.1 %, 8 | 0.06 / 0.07 | — |
| `dbts_c4` top10 | 8 | 2 | 8.3 | 63.17 / 63.05 / 63.04 | 78 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.26 (0.26 / 0.28) | 64.6 / 66.7 %, 25.6 %, 1.8 %, 10 | 0.08 / 0.09 | — |
| `dbts_c4` top10 | 8 | 4 | 12.6 | 57.82 / 57.55 / 57.46 | 120 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.49 / 0.52) | 79.5 / 81.2 %, 50.8 %, 16.0 %, 16 | 0.12 / 0.15 | — |
| `dbts_c4` top10 | 8 | 8 | 30.5 | 51.05 / 50.96 / 50.95 | 262 | 0.9929 / 0.9927 | 0.9990 / 0.9989 | 1.07 (0.90 / 0.93) | 89.6 / 91.2 %, 75.4 %, 48.8 %, 37 | 0.26 / 0.33 | — |
| `dbts_c4` top10 | 8 | 12 | 75.6 | 47.99 / 47.90 / 47.88 | 329 | 0.9856 / 0.9852 | 0.9976 / 0.9974 | 1.52 (1.04 / 1.06) | 92.3 / 93.6 %, 82.0 %, 61.5 %, 62 | 0.42 / 0.53 | — |
| `dbts_c4` top10 | 8 | 16 | 180.8 | 46.52 / 46.45 / 46.44 | 349 | 0.9802 / 0.9795 | 0.9960 / 0.9957 | 1.79 (1.06 / 1.08) | 93.3 / 94.5 %, 84.4 %, 66.1 %, 72 | 0.58 / 0.74 | — |
| `dbts_c4` top10 | 8 | 24 | 616.4 | 45.25 / 45.10 / 45.09 | 521 | 0.9752 / 0.9739 | 0.9934 / 0.9925 | 2.06 (1.06 / 1.08) | 94.1 / 95.2 %, 86.3 %, 70.0 %, 92 | 0.88 / 1.14 | — |
| `dbts_c4` top10 | 8 | 32 | 1516.7 | 44.34 / 44.16 / 44.11 | 597 | 0.9724 / 0.9718 | 0.9909 / 0.9900 | 2.27 (1.06 / 1.09) | 94.8 / 95.7 %, 87.7 %, 72.6 %, 109 | 1.17 / 1.45 | — |
| `dbts_c4` top10 | 8 | 40 | 2944.6 | 43.24 / 42.90 / 42.87 | 882 | 0.9677 / 0.9659 | 0.9877 / 0.9864 | 2.51 (1.06 / 1.09) | 95.4 / 96.2 %, 88.9 %, 75.2 %, 151 | 1.51 / 1.83 | — |
| `dbts_c4` top10 | 8 | 56 | 8728.2 | 39.86 / 39.05 / 38.96 | 2282 | 0.9438 / 0.9379 | 0.9763 / 0.9711 | 3.47 (1.06 / 1.09) | 96.7 / 97.0 %, 91.2 %, 79.8 %, 209 | 2.62 / 3.17 | — |
| `dbts_c4` window | 1 | 1 | 3.9 | 6.80 / 6.29 / 6.22 | 2534 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 20.2 / 22.9 %, 15.3 %, 13.2 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 1 | 2 | 4.7 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 25.5 / 28.0 %, 15.5 %, 13.3 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 1 | 4 | 5.9 | 6.80 / 6.29 / 6.22 | 2537 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.40) | 37.2 / 39.2 %, 15.8 %, 13.4 %, 30 | 2.54 / 3.78 | — |
| `dbts_c4` window | 1 | 8 | 8.0 | 6.80 / 6.29 / 6.22 | 2541 | 0.4432 / 0.3679 | 0.8571 / 0.8293 | 3.52 (0.39 / 0.42) | 60.7 / 62.1 %, 23.7 %, 13.7 %, 31 | 2.54 / 3.79 | — |
| `dbts_c4` window | 1 | 12 | 9.9 | 6.80 / 6.29 / 6.22 | 2544 | 0.4429 / 0.3677 | 0.8571 / 0.8293 | 3.53 (0.44 / 0.47) | 73.4 / 74.5 %, 37.9 %, 15.3 %, 32 | 2.54 / 3.79 | — |
| `dbts_c4` window | 1 | 16 | 11.8 | 6.80 / 6.29 / 6.22 | 2549 | 0.4426 / 0.3674 | 0.8570 / 0.8293 | 3.54 (0.50 / 0.53) | 80.2 / 80.8 %, 49.5 %, 19.6 %, 34 | 2.55 / 3.79 | — |
| `dbts_c4` window | 1 | 24 | 16.0 | 6.80 / 6.29 / 6.22 | 2556 | 0.4416 / 0.3665 | 0.8569 / 0.8291 | 3.57 (0.62 / 0.65) | 86.8 / 87.3 %, 64.2 %, 32.0 %, 53 | 2.55 / 3.80 | — |
| `dbts_c4` window | 1 | 32 | 28.0 | 6.80 / 6.29 / 6.22 | 2561 | 0.4384 / 0.3634 | 0.8564 / 0.8288 | 3.64 (0.85 / 0.88) | 92.0 / 92.2 %, 77.4 %, 51.5 %, 94 | 2.56 / 3.80 | — |
| `dbts_c4` window | 1 | 40 | 69.9 | 6.80 / 6.29 / 6.21 | 2572 | 0.4317 / 0.3566 | 0.8553 / 0.8277 | 3.80 (1.03 / 1.05) | 94.6 / 94.7 %, 84.5 %, 65.2 %, 102 | 2.59 / 3.82 | — |
| `dbts_c4` window | 1 | 56 | 737.9 | 6.80 / 6.28 / 6.21 | 2619 | 0.4203 / 0.3463 | 0.8504 / 0.8233 | 4.14 (1.06 / 1.08) | 96.3 / 96.4 %, 89.3 %, 75.3 %, 140 | 2.80 / 3.96 | — |
| `dbts_c4` window | 16 | 1 | 3.9 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 20.2 / 22.9 %, 15.3 %, 13.2 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 16 | 2 | 4.7 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 25.5 / 28.0 %, 15.5 %, 13.3 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 16 | 4 | 5.9 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.40) | 37.2 / 39.3 %, 15.8 %, 13.4 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 16 | 8 | 7.9 | 6.80 / 6.29 / 6.22 | 2539 | 0.4432 / 0.3679 | 0.8571 / 0.8293 | 3.52 (0.39 / 0.42) | 60.0 / 62.1 %, 23.6 %, 13.7 %, 31 | 2.54 / 3.79 | — |
| `dbts_c4` window | 16 | 12 | 9.7 | 6.80 / 6.29 / 6.22 | 2541 | 0.4430 / 0.3677 | 0.8571 / 0.8293 | 3.53 (0.43 / 0.46) | 73.0 / 74.3 %, 37.9 %, 15.3 %, 32 | 2.54 / 3.79 | — |
| `dbts_c4` window | 16 | 16 | 11.6 | 6.80 / 6.29 / 6.22 | 2543 | 0.4426 / 0.3674 | 0.8570 / 0.8293 | 3.54 (0.49 / 0.52) | 79.8 / 80.7 %, 49.2 %, 19.5 %, 33 | 2.54 / 3.79 | — |
| `dbts_c4` window | 16 | 24 | 15.8 | 6.80 / 6.29 / 6.22 | 2550 | 0.4415 / 0.3665 | 0.8569 / 0.8291 | 3.57 (0.62 / 0.65) | 86.7 / 87.2 %, 64.1 %, 31.9 %, 35 | 2.55 / 3.79 | — |
| `dbts_c4` window | 16 | 32 | 27.9 | 6.80 / 6.29 / 6.22 | 2558 | 0.4384 / 0.3635 | 0.8565 / 0.8288 | 3.64 (0.84 / 0.88) | 92.0 / 92.2 %, 77.3 %, 51.4 %, 83 | 2.56 / 3.81 | — |
| `dbts_c4` window | 16 | 40 | 72.6 | 6.80 / 6.29 / 6.21 | 2561 | 0.4318 / 0.3569 | 0.8553 / 0.8278 | 3.79 (1.03 / 1.05) | 94.6 / 94.7 %, 84.4 %, 65.0 %, 83 | 2.59 / 3.83 | — |
| `dbts_c4` window | 16 | 56 | 1687.0 | 6.80 / 6.28 / 6.21 | 2594 | 0.4203 / 0.3463 | 0.8504 / 0.8232 | 4.15 (1.06 / 1.08) | 96.3 / 96.4 %, 89.4 %, 75.6 %, 116 | 2.81 / 3.96 | — |
| `dbts_c4` window | 8 | 1 | 3.9 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 20.2 / 22.9 %, 15.3 %, 13.2 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 8 | 2 | 4.7 | 6.80 / 6.29 / 6.22 | 2535 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.39) | 25.5 / 28.0 %, 15.5 %, 13.3 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 8 | 4 | 5.9 | 6.80 / 6.29 / 6.22 | 2536 | 0.4434 / 0.3680 | 0.8572 / 0.8294 | 3.51 (0.36 / 0.40) | 37.1 / 39.3 %, 15.8 %, 13.4 %, 30 | 2.53 / 3.78 | — |
| `dbts_c4` window | 8 | 8 | 7.9 | 6.80 / 6.29 / 6.22 | 2539 | 0.4432 / 0.3679 | 0.8571 / 0.8293 | 3.52 (0.39 / 0.42) | 60.1 / 62.1 %, 23.6 %, 13.7 %, 31 | 2.54 / 3.79 | — |
| `dbts_c4` window | 8 | 12 | 9.7 | 6.80 / 6.29 / 6.22 | 2544 | 0.4430 / 0.3677 | 0.8571 / 0.8293 | 3.53 (0.43 / 0.46) | 72.9 / 74.3 %, 37.9 %, 15.3 %, 32 | 2.54 / 3.79 | — |
| `dbts_c4` window | 8 | 16 | 11.6 | 6.80 / 6.29 / 6.22 | 2543 | 0.4426 / 0.3674 | 0.8570 / 0.8293 | 3.54 (0.49 / 0.52) | 79.8 / 80.7 %, 49.2 %, 19.5 %, 34 | 2.54 / 3.79 | — |
| `dbts_c4` window | 8 | 24 | 15.8 | 6.80 / 6.29 / 6.22 | 2550 | 0.4415 / 0.3665 | 0.8569 / 0.8291 | 3.57 (0.62 / 0.65) | 86.8 / 87.2 %, 64.3 %, 32.1 %, 34 | 2.55 / 3.80 | — |
| `dbts_c4` window | 8 | 32 | 27.9 | 6.80 / 6.29 / 6.22 | 2554 | 0.4384 / 0.3635 | 0.8565 / 0.8288 | 3.64 (0.85 / 0.88) | 91.9 / 92.2 %, 77.3 %, 51.4 %, 83 | 2.56 / 3.81 | — |
| `dbts_c4` window | 8 | 40 | 72.5 | 6.80 / 6.29 / 6.21 | 2561 | 0.4318 / 0.3569 | 0.8553 / 0.8278 | 3.79 (1.03 / 1.05) | 94.6 / 94.7 %, 84.4 %, 65.0 %, 83 | 2.59 / 3.83 | — |
| `dbts_c4` window | 8 | 56 | 1586.5 | 6.80 / 6.28 / 6.21 | 2585 | 0.4203 / 0.3463 | 0.8504 / 0.8232 | 4.15 (1.06 / 1.08) | 96.3 / 96.4 %, 89.4 %, 75.6 %, 118 | 2.82 / 3.96 | — |
| `dbts_c5` 12bit | 1 | 1 | 4.2 | 71.98 / 71.84 / 71.83 | 30 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 21.3 / 22.1 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c5` 12bit | 1 | 2 | 5.4 | 66.05 / 65.90 / 65.90 | 35 | 0.9998 / 0.9997 | 1.0000 / 1.0000 | 0.19 (0.20 / 0.21) | 40.8 / 42.4 %, 3.6 %, 0.0 %, 6 | 0.05 / 0.06 | 10.0 |
| `dbts_c5` 12bit | 1 | 4 | 9.3 | 57.97 / 57.87 / 57.86 | 79 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.50 / 0.53) | 69.0 / 70.6 %, 29.5 %, 3.9 %, 12 | 0.13 / 0.14 | 9.97 |
| `dbts_c5` 12bit | 1 | 8 | 27.7 | 50.14 / 50.07 / 50.07 | 299 | 0.9905 / 0.9903 | 0.9986 / 0.9986 | 1.21 (0.97 / 0.99) | 85.7 / 87.3 %, 64.8 %, 32.9 %, 32 | 0.33 / 0.37 | 9.75 |
| `dbts_c5` 12bit | 1 | 12 | 85.3 | 47.05 / 46.99 / 46.97 | 397 | 0.9811 / 0.9805 | 0.9964 / 0.9962 | 1.73 (1.05 / 1.07) | 89.3 / 90.6 %, 73.5 %, 46.8 %, 53 | 0.59 / 0.66 | 9.23 |
| `dbts_c5` 12bit | 1 | 16 | 192.6 | 45.92 / 45.78 / 45.76 | 380 | 0.9762 / 0.9748 | 0.9945 / 0.9940 | 1.96 (1.06 / 1.08) | 90.5 / 91.6 %, 76.1 %, 51.1 %, 65 | 0.81 / 0.91 | 8.53 |
| `dbts_c5` 12bit | 1 | 24 | 428.9 | 45.02 / 44.88 / 44.87 | 572 | 0.9718 / 0.9703 | 0.9920 / 0.9913 | 2.16 (1.06 / 1.08) | 91.3 / 92.3 %, 77.9 %, 54.1 %, 109 | 1.11 / 1.26 | 7.46 |
| `dbts_c5` 12bit | 1 | 32 | 861.8 | 44.13 / 44.00 / 43.97 | 771 | 0.9708 / 0.9692 | 0.9892 / 0.9879 | 2.36 (1.06 / 1.08) | 92.3 / 93.0 %, 79.9 %, 57.2 %, 115 | 1.46 / 1.68 | 6.25 |
| `dbts_c5` 12bit | 1 | 40 | 1584.2 | 42.94 / 42.70 / 42.62 | 1328 | 0.9676 / 0.9646 | 0.9855 / 0.9834 | 2.65 (1.06 / 1.08) | 93.1 / 93.8 %, 81.7 %, 60.5 %, 154 | 1.90 / 2.18 | 5.02 |
| `dbts_c5` 12bit | 1 | 56 | 4222.4 | 39.42 / 38.96 / 38.87 | 2186 | 0.9523 / 0.9324 | 0.9748 / 0.9709 | 3.81 (1.06 / 1.09) | 94.7 / 95.0 %, 85.0 %, 66.5 %, 215 | 3.22 / 3.55 | 3.08 |
| `dbts_c5` 12bit | 16 | 1 | 4.1 | 72.01 / 71.86 / 71.84 | 44 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 21.3 / 22.1 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c5` 12bit | 16 | 2 | 5.6 | 65.59 / 65.38 / 65.38 | 80 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.21 / 0.23) | 42.3 / 43.9 %, 4.4 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_c5` 12bit | 16 | 4 | 9.2 | 57.94 / 57.83 / 57.82 | 113 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.50 / 0.53) | 69.1 / 70.8 %, 30.0 %, 4.0 %, 12 | 0.13 / 0.15 | 9.97 |
| `dbts_c5` 12bit | 16 | 8 | 27.7 | 50.29 / 50.20 / 50.08 | 292 | 0.9910 / 0.9903 | 0.9987 / 0.9986 | 1.19 (0.96 / 0.99) | 85.6 / 87.1 %, 64.4 %, 32.4 %, 33 | 0.34 / 0.38 | 9.75 |
| `dbts_c5` 12bit | 16 | 12 | 97.4 | 47.18 / 47.08 / 47.00 | 286 | 0.9818 / 0.9806 | 0.9965 / 0.9963 | 1.70 (1.05 / 1.07) | 89.3 / 90.6 %, 73.6 %, 46.6 %, 50 | 0.58 / 0.67 | 9.23 |
| `dbts_c5` 12bit | 16 | 16 | 305.2 | 45.94 / 45.79 / 45.77 | 356 | 0.9766 / 0.9749 | 0.9945 / 0.9940 | 1.96 (1.06 / 1.08) | 90.5 / 91.5 %, 76.1 %, 51.0 %, 76 | 0.81 / 0.93 | 8.49 |
| `dbts_c5` 12bit | 16 | 24 | 1101.8 | 44.87 / 44.66 / 44.61 | 503 | 0.9730 / 0.9703 | 0.9914 / 0.9902 | 2.20 (1.06 / 1.08) | 91.5 / 92.5 %, 78.3 %, 54.7 %, 135 | 1.18 / 1.43 | 7.26 |
| `dbts_c5` 12bit | 16 | 32 | 2956.7 | 43.89 / 43.73 / 43.59 | 803 | 0.9708 / 0.9694 | 0.9883 / 0.9866 | 2.43 (1.06 / 1.08) | 92.5 / 93.3 %, 80.6 %, 58.4 %, 159 | 1.55 / 1.85 | 6.09 |
| `dbts_c5` 12bit | 16 | 40 | 6680.3 | 42.57 / 42.20 / 42.09 | 1174 | 0.9679 / 0.9661 | 0.9840 / 0.9818 | 2.81 (1.06 / 1.08) | 93.3 / 93.9 %, 82.3 %, 61.5 %, 160 | 2.05 / 2.34 | 4.89 |
| `dbts_c5` 12bit | 16 | 56 | 21536.0 | 39.15 / 37.81 / 37.75 | 2085 | 0.9529 / 0.9495 | 0.9725 / 0.9669 | 4.03 (1.06 / 1.08) | 95.0 / 95.3 %, 86.2 %, 69.4 %, 221 | 3.49 / 4.26 | 3.0 |
| `dbts_c5` 12bit | 8 | 1 | 4.1 | 72.01 / 71.86 / 71.84 | 68 | 0.9999 / 0.9999 | 1.0000 / 1.0000 | 0.10 (0.10 / 0.11) | 21.2 / 22.0 %, 0.1 %, 0.0 %, 3 | 0.03 / 0.03 | 10.0 |
| `dbts_c5` 12bit | 8 | 2 | 5.6 | 65.67 / 65.39 / 65.38 | 97 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.20 (0.21 / 0.23) | 42.3 / 43.8 %, 4.4 %, 0.0 %, 5 | 0.05 / 0.06 | 10.0 |
| `dbts_c5` 12bit | 8 | 4 | 9.2 | 57.94 / 57.83 / 57.82 | 166 | 0.9985 / 0.9984 | 0.9998 / 0.9998 | 0.49 (0.50 / 0.53) | 69.1 / 70.6 %, 29.7 %, 4.0 %, 12 | 0.13 / 0.15 | 9.97 |
| `dbts_c5` 12bit | 8 | 8 | 27.7 | 50.28 / 50.12 / 50.08 | 292 | 0.9909 / 0.9903 | 0.9987 / 0.9986 | 1.20 (0.97 / 0.99) | 85.6 / 87.3 %, 64.8 %, 32.9 %, 35 | 0.34 / 0.38 | 9.75 |
| `dbts_c5` 12bit | 8 | 12 | 96.7 | 47.17 / 47.04 / 47.00 | 303 | 0.9817 / 0.9806 | 0.9965 / 0.9963 | 1.71 (1.05 / 1.07) | 89.3 / 90.6 %, 73.5 %, 46.8 %, 53 | 0.59 / 0.67 | 9.22 |
| `dbts_c5` 12bit | 8 | 16 | 295.7 | 45.92 / 45.78 / 45.76 | 351 | 0.9765 / 0.9749 | 0.9945 / 0.9940 | 1.96 (1.06 / 1.08) | 90.5 / 91.6 %, 76.1 %, 51.1 %, 78 | 0.81 / 0.93 | 8.49 |
| `dbts_c5` 12bit | 8 | 24 | 1025.0 | 44.89 / 44.64 / 44.61 | 524 | 0.9727 / 0.9701 | 0.9915 / 0.9902 | 2.20 (1.06 / 1.08) | 91.5 / 92.4 %, 78.3 %, 54.7 %, 114 | 1.18 / 1.43 | 7.26 |
| `dbts_c5` 12bit | 8 | 32 | 2635.9 | 44.02 / 43.71 / 43.66 | 803 | 0.9709 / 0.9694 | 0.9885 / 0.9866 | 2.43 (1.06 / 1.08) | 92.4 / 93.3 %, 80.5 %, 58.4 %, 150 | 1.55 / 1.85 | 6.09 |
| `dbts_c5` 12bit | 8 | 40 | 5720.9 | 42.76 / 42.28 / 42.15 | 1174 | 0.9679 / 0.9661 | 0.9847 / 0.9823 | 2.75 (1.06 / 1.08) | 93.2 / 93.9 %, 82.3 %, 61.4 %, 160 | 1.99 / 2.33 | 4.88 |
| `dbts_c5` 12bit | 8 | 56 | 16781.5 | 39.28 / 38.26 / 37.85 | 2092 | 0.9539 / 0.9448 | 0.9743 / 0.9688 | 3.90 (1.06 / 1.08) | 94.8 / 95.3 %, 86.1 %, 68.8 %, 221 | 3.26 / 4.09 | 3.0 |
| `dbts_c5` top10 | 1 | 1 | 5.0 | 65.18 / 65.05 / 65.05 | 33 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.21 (0.21 / 0.23) | 42.3 / 43.8 %, 5.8 %, 0.0 %, 5 | 0.08 / 0.09 | — |
| `dbts_c5` top10 | 1 | 2 | 6.6 | 61.71 / 61.57 / 61.56 | 59 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.32 (0.32 / 0.35) | 56.4 / 58.1 %, 14.4 %, 0.5 %, 8 | 0.10 / 0.12 | — |
| `dbts_c5` top10 | 1 | 4 | 10.6 | 56.22 / 56.10 / 56.10 | 158 | 0.9977 / 0.9976 | 0.9997 / 0.9997 | 0.60 (0.59 / 0.63) | 73.9 / 75.2 %, 38.0 %, 7.6 %, 15 | 0.17 / 0.19 | — |
| `dbts_c5` top10 | 1 | 8 | 29.6 | 49.84 / 49.77 / 49.76 | 311 | 0.9900 / 0.9898 | 0.9985 / 0.9984 | 1.26 (0.98 / 1.00) | 86.2 / 87.6 %, 66.0 %, 34.5 %, 33 | 0.36 / 0.40 | — |
| `dbts_c5` top10 | 1 | 12 | 79.3 | 47.19 / 47.14 / 47.10 | 411 | 0.9819 / 0.9813 | 0.9966 / 0.9964 | 1.70 (1.05 / 1.07) | 89.2 / 90.5 %, 73.3 %, 46.3 %, 49 | 0.57 / 0.64 | — |
| `dbts_c5` top10 | 1 | 16 | 166.6 | 46.08 / 45.95 / 45.94 | 355 | 0.9771 / 0.9760 | 0.9948 / 0.9944 | 1.93 (1.06 / 1.08) | 90.3 / 91.5 %, 75.9 %, 50.7 %, 67 | 0.78 / 0.88 | — |
| `dbts_c5` top10 | 1 | 24 | 376.0 | 45.20 / 45.05 / 45.03 | 453 | 0.9739 / 0.9724 | 0.9925 / 0.9918 | 2.12 (1.06 / 1.08) | 91.2 / 92.1 %, 77.7 %, 53.8 %, 102 | 1.05 / 1.21 | — |
| `dbts_c5` top10 | 1 | 32 | 739.1 | 44.38 / 44.26 / 44.23 | 724 | 0.9717 / 0.9700 | 0.9899 / 0.9889 | 2.31 (1.06 / 1.09) | 92.0 / 92.8 %, 79.4 %, 56.4 %, 118 | 1.38 / 1.58 | — |
| `dbts_c5` top10 | 1 | 40 | 1308.5 | 43.41 / 43.24 / 43.19 | 1325 | 0.9674 / 0.9655 | 0.9867 / 0.9850 | 2.54 (1.06 / 1.08) | 92.8 / 93.5 %, 81.2 %, 59.5 %, 126 | 1.74 / 1.98 | — |
| `dbts_c5` top10 | 1 | 56 | 3443.6 | 40.64 / 40.18 / 40.11 | 2113 | 0.9518 / 0.9458 | 0.9773 / 0.9751 | 3.38 (1.07 / 1.09) | 94.2 / 94.5 %, 83.8 %, 64.0 %, 199 | 2.78 / 3.03 | — |
| `dbts_c5` top10 | 16 | 1 | 5.1 | 64.85 / 64.65 / 64.65 | 82 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.22 / 0.23) | 43.6 / 45.1 %, 6.4 %, 0.0 %, 5 | 0.08 / 0.10 | — |
| `dbts_c5` top10 | 16 | 2 | 6.6 | 61.65 / 61.50 / 61.49 | 110 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.32 (0.32 / 0.35) | 56.6 / 58.3 %, 14.7 %, 0.5 %, 8 | 0.11 / 0.12 | — |
| `dbts_c5` top10 | 16 | 4 | 10.6 | 56.17 / 56.05 / 56.04 | 170 | 0.9977 / 0.9976 | 0.9997 / 0.9997 | 0.61 (0.59 / 0.63) | 74.0 / 75.6 %, 38.7 %, 7.8 %, 15 | 0.17 / 0.19 | — |
| `dbts_c5` top10 | 16 | 8 | 29.8 | 49.95 / 49.88 / 49.77 | 311 | 0.9903 / 0.9898 | 0.9985 / 0.9984 | 1.24 (0.98 / 1.00) | 86.0 / 87.5 %, 65.6 %, 34.0 %, 36 | 0.36 / 0.41 | — |
| `dbts_c5` top10 | 16 | 12 | 90.0 | 47.24 / 47.15 / 47.14 | 299 | 0.9822 / 0.9815 | 0.9966 / 0.9963 | 1.69 (1.06 / 1.08) | 89.3 / 90.5 %, 73.4 %, 46.4 %, 48 | 0.58 / 0.67 | — |
| `dbts_c5` top10 | 16 | 16 | 251.2 | 46.08 / 45.95 / 45.93 | 390 | 0.9773 / 0.9761 | 0.9948 / 0.9943 | 1.93 (1.06 / 1.08) | 90.3 / 91.4 %, 75.9 %, 50.7 %, 67 | 0.79 / 0.90 | — |
| `dbts_c5` top10 | 16 | 24 | 847.3 | 45.12 / 44.92 / 44.86 | 474 | 0.9738 / 0.9722 | 0.9923 / 0.9911 | 2.14 (1.06 / 1.08) | 91.3 / 92.3 %, 77.9 %, 54.0 %, 115 | 1.09 / 1.31 | — |
| `dbts_c5` top10 | 16 | 32 | 2239.7 | 44.28 / 44.10 / 44.07 | 531 | 0.9718 / 0.9704 | 0.9895 / 0.9883 | 2.35 (1.07 / 1.09) | 92.1 / 92.9 %, 79.7 %, 57.0 %, 117 | 1.43 / 1.66 | — |
| `dbts_c5` top10 | 16 | 40 | 4866.0 | 43.23 / 43.01 / 42.95 | 795 | 0.9675 / 0.9663 | 0.9859 / 0.9841 | 2.61 (1.07 / 1.09) | 92.9 / 93.6 %, 81.4 %, 59.9 %, 139 | 1.81 / 2.10 | — |
| `dbts_c5` top10 | 16 | 56 | 16373.6 | 40.42 / 39.48 / 39.33 | 2078 | 0.9512 / 0.9480 | 0.9761 / 0.9719 | 3.54 (1.06 / 1.08) | 94.4 / 94.7 %, 84.3 %, 65.3 %, 201 | 2.93 / 3.39 | — |
| `dbts_c5` top10 | 8 | 1 | 5.1 | 64.92 / 64.66 / 64.65 | 82 | 0.9997 / 0.9997 | 1.0000 / 1.0000 | 0.22 (0.22 / 0.23) | 43.6 / 45.0 %, 6.4 %, 0.0 %, 5 | 0.08 / 0.10 | — |
| `dbts_c5` top10 | 8 | 2 | 6.6 | 61.65 / 61.50 / 61.50 | 123 | 0.9994 / 0.9993 | 0.9999 / 0.9999 | 0.32 (0.32 / 0.35) | 56.6 / 58.2 %, 14.6 %, 0.5 %, 9 | 0.11 / 0.12 | — |
| `dbts_c5` top10 | 8 | 4 | 10.6 | 56.17 / 56.05 / 56.04 | 170 | 0.9977 / 0.9976 | 0.9997 / 0.9997 | 0.61 (0.59 / 0.63) | 74.0 / 75.4 %, 38.5 %, 7.7 %, 15 | 0.17 / 0.19 | — |
| `dbts_c5` top10 | 8 | 8 | 29.7 | 49.95 / 49.81 / 49.77 | 311 | 0.9903 / 0.9898 | 0.9985 / 0.9984 | 1.24 (0.98 / 1.00) | 86.1 / 87.6 %, 66.0 %, 34.5 %, 35 | 0.36 / 0.41 | — |
| `dbts_c5` top10 | 8 | 12 | 89.4 | 47.24 / 47.14 / 47.14 | 312 | 0.9821 / 0.9813 | 0.9966 / 0.9963 | 1.69 (1.06 / 1.08) | 89.2 / 90.5 %, 73.3 %, 46.3 %, 48 | 0.58 / 0.67 | — |
| `dbts_c5` top10 | 8 | 16 | 244.5 | 46.07 / 45.95 / 45.92 | 390 | 0.9773 / 0.9761 | 0.9948 / 0.9943 | 1.93 (1.06 / 1.08) | 90.4 / 91.5 %, 75.9 %, 50.7 %, 67 | 0.79 / 0.90 | — |
| `dbts_c5` top10 | 8 | 24 | 797.5 | 45.13 / 44.90 / 44.85 | 474 | 0.9738 / 0.9722 | 0.9923 / 0.9911 | 2.14 (1.06 / 1.08) | 91.3 / 92.2 %, 77.8 %, 53.8 %, 97 | 1.09 / 1.31 | — |
| `dbts_c5` top10 | 8 | 32 | 2016.8 | 44.30 / 44.12 / 44.04 | 531 | 0.9718 / 0.9700 | 0.9896 / 0.9881 | 2.34 (1.07 / 1.09) | 92.1 / 92.9 %, 79.7 %, 56.9 %, 118 | 1.42 / 1.66 | — |
| `dbts_c5` top10 | 8 | 40 | 4241.4 | 43.32 / 43.02 / 42.96 | 955 | 0.9675 / 0.9665 | 0.9863 / 0.9840 | 2.59 (1.07 / 1.09) | 92.9 / 93.6 %, 81.4 %, 60.0 %, 148 | 1.80 / 2.10 | — |
| `dbts_c5` top10 | 8 | 56 | 13374.1 | 40.57 / 39.60 / 39.51 | 2078 | 0.9508 / 0.9479 | 0.9766 / 0.9733 | 3.46 (1.06 / 1.08) | 94.3 / 94.6 %, 84.3 %, 65.3 %, 228 | 2.86 / 3.37 | — |
| `dbts_c5` window | 1 | 1 | 3.4 | 9.26 / 8.06 / 7.93 | 2333 | 0.6263 / 0.4987 | 0.8986 / 0.8690 | 4.03 (0.44 / 0.48) | 29.5 / 30.9 %, 22.3 %, 16.3 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 1 | 2 | 4.1 | 9.26 / 8.06 / 7.93 | 2333 | 0.6262 / 0.4987 | 0.8986 / 0.8690 | 4.04 (0.44 / 0.48) | 34.2 / 35.5 %, 22.5 %, 16.4 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 1 | 4 | 5.2 | 9.26 / 8.06 / 7.93 | 2334 | 0.6262 / 0.4987 | 0.8986 / 0.8689 | 4.04 (0.45 / 0.49) | 44.0 / 45.2 %, 23.1 %, 16.9 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 1 | 8 | 7.3 | 9.26 / 8.06 / 7.93 | 2338 | 0.6259 / 0.4984 | 0.8985 / 0.8689 | 4.05 (0.48 / 0.52) | 63.0 / 64.0 %, 29.1 %, 17.6 %, 31 | 3.10 / 3.72 | — |
| `dbts_c5` window | 1 | 12 | 9.4 | 9.26 / 8.06 / 7.93 | 2339 | 0.6253 / 0.4980 | 0.8984 / 0.8688 | 4.06 (0.55 / 0.58) | 74.6 / 75.3 %, 40.6 %, 19.0 %, 31 | 3.10 / 3.72 | — |
| `dbts_c5` window | 1 | 16 | 11.7 | 9.26 / 8.06 / 7.93 | 2341 | 0.6247 / 0.4974 | 0.8983 / 0.8688 | 4.07 (0.62 / 0.66) | 80.8 / 81.2 %, 50.7 %, 22.2 %, 33 | 3.10 / 3.72 | — |
| `dbts_c5` window | 1 | 24 | 17.3 | 9.26 / 8.06 / 7.93 | 2345 | 0.6228 / 0.4957 | 0.8980 / 0.8685 | 4.12 (0.77 / 0.81) | 87.0 / 87.2 %, 63.9 %, 32.0 %, 38 | 3.11 / 3.72 | — |
| `dbts_c5` window | 1 | 32 | 37.3 | 9.26 / 8.06 / 7.93 | 2356 | 0.6177 / 0.4908 | 0.8971 / 0.8678 | 4.22 (0.99 / 1.01) | 91.5 / 91.5 %, 75.2 %, 47.5 %, 52 | 3.13 / 3.74 | — |
| `dbts_c5` window | 1 | 40 | 120.9 | 9.26 / 8.06 / 7.93 | 2362 | 0.6100 / 0.4832 | 0.8951 / 0.8661 | 4.38 (1.06 / 1.08) | 93.5 / 93.6 %, 80.9 %, 57.7 %, 56 | 3.18 / 3.78 | — |
| `dbts_c5` window | 1 | 56 | 1162.1 | 9.25 / 8.05 / 7.93 | 2384 | 0.6032 / 0.4776 | 0.8894 / 0.8618 | 4.63 (1.06 / 1.08) | 94.8 / 94.9 %, 84.6 %, 65.1 %, 146 | 3.42 / 4.04 | — |
| `dbts_c5` window | 16 | 1 | 3.4 | 9.26 / 8.06 / 7.93 | 2334 | 0.6263 / 0.4987 | 0.8986 / 0.8690 | 4.03 (0.44 / 0.48) | 30.0 / 31.4 %, 22.3 %, 16.3 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 2 | 4.1 | 9.26 / 8.06 / 7.93 | 2333 | 0.6262 / 0.4987 | 0.8986 / 0.8690 | 4.04 (0.44 / 0.48) | 34.4 / 35.8 %, 22.5 %, 16.5 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 4 | 5.2 | 9.26 / 8.06 / 7.93 | 2333 | 0.6262 / 0.4987 | 0.8986 / 0.8689 | 4.04 (0.45 / 0.48) | 44.3 / 45.5 %, 23.0 %, 16.8 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 8 | 7.2 | 9.26 / 8.06 / 7.93 | 2336 | 0.6259 / 0.4984 | 0.8985 / 0.8689 | 4.04 (0.48 / 0.52) | 63.4 / 64.4 %, 28.8 %, 17.5 %, 31 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 12 | 9.3 | 9.26 / 8.06 / 7.93 | 2339 | 0.6254 / 0.4980 | 0.8984 / 0.8688 | 4.06 (0.55 / 0.58) | 74.9 / 75.5 %, 40.9 %, 18.9 %, 32 | 3.10 / 3.71 | — |
| `dbts_c5` window | 16 | 16 | 11.6 | 9.26 / 8.06 / 7.93 | 2343 | 0.6247 / 0.4974 | 0.8983 / 0.8688 | 4.07 (0.62 / 0.66) | 80.9 / 81.4 %, 50.8 %, 22.1 %, 32 | 3.10 / 3.72 | — |
| `dbts_c5` window | 16 | 24 | 17.3 | 9.26 / 8.06 / 7.93 | 2348 | 0.6227 / 0.4957 | 0.8980 / 0.8685 | 4.12 (0.77 / 0.81) | 87.0 / 87.2 %, 64.0 %, 32.2 %, 33 | 3.11 / 3.72 | — |
| `dbts_c5` window | 16 | 32 | 37.1 | 9.26 / 8.06 / 7.93 | 2350 | 0.6180 / 0.4910 | 0.8971 / 0.8678 | 4.22 (0.99 / 1.01) | 91.4 / 91.5 %, 75.2 %, 47.4 %, 39 | 3.13 / 3.74 | — |
| `dbts_c5` window | 16 | 40 | 135.2 | 9.26 / 8.06 / 7.93 | 2360 | 0.6106 / 0.4835 | 0.8952 / 0.8662 | 4.37 (1.06 / 1.08) | 93.4 / 93.5 %, 80.9 %, 57.7 %, 55 | 3.17 / 3.79 | — |
| `dbts_c5` window | 16 | 56 | 2898.5 | 9.25 / 8.05 / 7.93 | 2412 | 0.6030 / 0.4775 | 0.8892 / 0.8617 | 4.65 (1.06 / 1.08) | 94.8 / 94.9 %, 84.7 %, 65.3 %, 128 | 3.42 / 4.05 | — |
| `dbts_c5` window | 8 | 1 | 3.4 | 9.26 / 8.06 / 7.93 | 2334 | 0.6263 / 0.4987 | 0.8986 / 0.8690 | 4.03 (0.44 / 0.48) | 30.0 / 31.4 %, 22.3 %, 16.3 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 2 | 4.1 | 9.26 / 8.06 / 7.93 | 2333 | 0.6262 / 0.4987 | 0.8986 / 0.8690 | 4.04 (0.44 / 0.48) | 34.5 / 35.8 %, 22.5 %, 16.4 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 4 | 5.2 | 9.26 / 8.06 / 7.93 | 2334 | 0.6262 / 0.4987 | 0.8986 / 0.8689 | 4.04 (0.45 / 0.48) | 44.3 / 45.5 %, 23.1 %, 16.8 %, 30 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 8 | 7.2 | 9.26 / 8.06 / 7.93 | 2337 | 0.6259 / 0.4984 | 0.8985 / 0.8689 | 4.04 (0.48 / 0.52) | 63.3 / 64.2 %, 29.0 %, 17.5 %, 31 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 12 | 9.3 | 9.26 / 8.06 / 7.93 | 2339 | 0.6254 / 0.4980 | 0.8984 / 0.8688 | 4.06 (0.55 / 0.58) | 74.8 / 75.5 %, 40.8 %, 18.9 %, 32 | 3.10 / 3.71 | — |
| `dbts_c5` window | 8 | 16 | 11.6 | 9.26 / 8.06 / 7.93 | 2341 | 0.6247 / 0.4974 | 0.8983 / 0.8688 | 4.07 (0.62 / 0.66) | 80.8 / 81.4 %, 50.8 %, 22.2 %, 32 | 3.10 / 3.72 | — |
| `dbts_c5` window | 8 | 24 | 17.3 | 9.26 / 8.06 / 7.93 | 2347 | 0.6228 / 0.4957 | 0.8980 / 0.8685 | 4.12 (0.77 / 0.81) | 87.0 / 87.3 %, 63.9 %, 32.2 %, 33 | 3.11 / 3.72 | — |
| `dbts_c5` window | 8 | 32 | 37.2 | 9.26 / 8.06 / 7.93 | 2348 | 0.6179 / 0.4908 | 0.8971 / 0.8678 | 4.22 (0.99 / 1.01) | 91.4 / 91.5 %, 75.2 %, 47.5 %, 39 | 3.13 / 3.74 | — |
| `dbts_c5` window | 8 | 40 | 134.8 | 9.26 / 8.06 / 7.93 | 2360 | 0.6105 / 0.4832 | 0.8952 / 0.8661 | 4.37 (1.06 / 1.08) | 93.4 / 93.5 %, 80.9 %, 57.7 %, 49 | 3.17 / 3.79 | — |
| `dbts_c5` window | 8 | 56 | 2727.1 | 9.25 / 8.05 / 7.93 | 2388 | 0.6030 / 0.4776 | 0.8893 / 0.8618 | 4.64 (1.06 / 1.08) | 94.8 / 94.9 %, 84.7 %, 65.3 %, 128 | 3.42 / 4.05 | — |
| `mr9_ispy2` 9bit | 1 | 1 | 6.4 | 58.39 / 58.26 / 58.26 | 3 | 0.9983 / 0.9981 | 0.9998 / 0.9998 | 0.78 (0.74 / 1.00) | 35.9 / 37.0 %, 26.8 %, 0.3 %, 6 | 0.08 / 0.24 | 9.99 |
| `mr9_ispy2` 9bit | 1 | 2 | 12.1 | 54.91 / 54.73 / 54.72 | 5 | 0.9960 / 0.9955 | 0.9995 / 0.9994 | 1.15 (0.92 / 1.18) | 54.1 / 56.2 %, 41.8 %, 5.5 %, 9 | 0.14 / 0.43 | 9.97 |
| `mr9_ispy2` 9bit | 1 | 4 | 25.9 | 51.11 / 50.67 / 50.63 | 15 | 0.9909 / 0.9905 | 0.9987 / 0.9986 | 1.79 (1.14 / 1.31) | 66.1 / 69.5 %, 56.0 %, 19.8 %, 27 | 0.23 / 0.64 | 9.85 |
| `mr9_ispy2` 9bit | 1 | 8 | 67.8 | 47.30 / 46.50 / 46.41 | 31 | 0.9798 / 0.9781 | 0.9963 / 0.9959 | 2.76 (1.37 / 1.45) | 73.4 / 76.0 %, 64.2 %, 33.2 %, 56 | 0.41 / 1.04 | 9.39 |
| `mr9_ispy2` 9bit | 1 | 12 | 119.6 | 45.39 / 44.35 / 44.26 | 40 | 0.9700 / 0.9666 | 0.9938 / 0.9926 | 3.44 (1.47 / 1.56) | 76.4 / 79.6 %, 68.6 %, 38.8 %, 72 | 0.59 / 1.40 | 8.86 |
| `mr9_ispy2` 9bit | 1 | 16 | 180.1 | 44.07 / 42.81 / 42.69 | 63 | 0.9601 / 0.9544 | 0.9914 / 0.9891 | 3.99 (1.54 / 1.66) | 78.7 / 81.4 %, 72.3 %, 42.5 %, 113 | 0.76 / 1.77 | 8.33 |
| `mr9_ispy2` 9bit | 1 | 24 | 312.6 | 42.64 / 41.06 / 40.91 | 85 | 0.9514 / 0.9406 | 0.9866 / 0.9826 | 4.77 (1.58 / 1.77) | 78.6 / 81.6 %, 71.0 %, 44.5 %, 151 | 0.97 / 2.08 | 7.53 |
| `mr9_ispy2` 9bit | 1 | 32 | 641.5 | 40.64 / 38.91 / 38.53 | 140 | 0.9332 / 0.9127 | 0.9768 / 0.9670 | 5.89 (1.59 / 1.93) | 81.5 / 83.3 %, 72.9 %, 47.9 %, 167 | 1.38 / 2.73 | 6.39 |
| `mr9_ispy2` 9bit | 1 | 40 | 1270.7 | 38.79 / 37.03 / 36.87 | 230 | 0.8999 / 0.8818 | 0.9598 / 0.9470 | 7.15 (1.61 / 1.91) | 85.5 / 87.5 %, 80.6 %, 58.4 %, 197 | 1.96 / 4.04 | 4.9 |
| `mr9_ispy2` 9bit | 1 | 56 | 2604.7 | 36.45 / 34.57 / 34.51 | 296 | 0.8546 / 0.8199 | 0.9279 / 0.9061 | 9.42 (1.60 / 1.91) | 88.2 / 93.2 %, 90.7 %, 77.1 %, 204 | 3.05 / 5.63 | 3.1 |
| `mr9_ispy2` 9bit | 16 | 1 | 6.7 | 58.11 / 57.73 / 57.61 | 12 | 0.9982 / 0.9978 | 0.9998 / 0.9997 | 0.78 (0.71 / 0.97) | 36.5 / 40.4 %, 29.1 %, 0.7 %, 21 | 0.09 / 0.25 | 9.98 |
| `mr9_ispy2` 9bit | 16 | 2 | 11.9 | 54.66 / 54.46 / 54.42 | 12 | 0.9959 / 0.9952 | 0.9995 / 0.9994 | 1.19 (0.94 / 1.20) | 56.3 / 57.9 %, 43.3 %, 5.9 %, 22 | 0.14 / 0.43 | 9.95 |
| `mr9_ispy2` 9bit | 16 | 4 | 26.1 | 50.94 / 50.55 / 50.54 | 16 | 0.9906 / 0.9902 | 0.9986 / 0.9986 | 1.83 (1.14 / 1.32) | 66.8 / 69.9 %, 56.2 %, 20.2 %, 29 | 0.23 / 0.66 | 9.84 |
| `mr9_ispy2` 9bit | 16 | 8 | 72.5 | 47.18 / 46.40 / 46.39 | 42 | 0.9792 / 0.9776 | 0.9962 / 0.9958 | 2.81 (1.37 / 1.43) | 73.3 / 76.2 %, 64.4 %, 33.3 %, 75 | 0.42 / 1.10 | 9.36 |
| `mr9_ispy2` 9bit | 16 | 12 | 135.0 | 45.31 / 44.31 / 44.21 | 48 | 0.9701 / 0.9658 | 0.9936 / 0.9924 | 3.48 (1.48 / 1.60) | 76.1 / 79.2 %, 67.5 %, 37.8 %, 86 | 0.61 / 1.43 | 8.8 |
| `mr9_ispy2` 9bit | 16 | 16 | 212.3 | 44.04 / 42.87 / 42.67 | 70 | 0.9619 / 0.9550 | 0.9909 / 0.9891 | 3.99 (1.55 / 1.66) | 76.8 / 81.4 %, 70.7 %, 41.4 %, 124 | 0.74 / 1.77 | 8.3 |
| `mr9_ispy2` 9bit | 16 | 24 | 416.0 | 42.41 / 40.85 / 40.67 | 109 | 0.9487 / 0.9372 | 0.9855 / 0.9815 | 4.87 (1.59 / 1.81) | 78.8 / 81.9 %, 71.0 %, 45.4 %, 150 | 1.03 / 2.14 | 7.42 |
| `mr9_ispy2` 9bit | 16 | 32 | 999.3 | 40.51 / 38.75 / 38.64 | 127 | 0.9318 / 0.9133 | 0.9748 / 0.9664 | 5.95 (1.60 / 1.90) | 79.7 / 82.8 %, 72.1 %, 48.2 %, 165 | 1.44 / 2.77 | 6.2 |
| `mr9_ispy2` 9bit | 16 | 40 | 2296.6 | 38.75 / 36.97 / 36.92 | 231 | 0.9082 / 0.8809 | 0.9594 / 0.9460 | 7.14 (1.61 / 1.92) | 84.3 / 86.9 %, 79.8 %, 56.3 %, 197 | 2.01 / 4.04 | 4.88 |
| `mr9_ispy2` 9bit | 16 | 56 | 5318.1 | 36.16 / 34.59 / 34.21 | 305 | 0.8679 / 0.8286 | 0.9282 / 0.9050 | 9.74 (1.60 / 1.91) | 86.0 / 91.2 %, 85.7 %, 69.5 %, 206 | 3.23 / 6.08 | 3.07 |
| `mr9_ispy2` 9bit | 8 | 1 | 6.6 | 58.23 / 57.63 / 57.56 | 10 | 0.9983 / 0.9978 | 0.9998 / 0.9997 | 0.78 (0.72 / 0.97) | 36.3 / 41.1 %, 29.1 %, 0.7 %, 18 | 0.09 / 0.25 | 9.98 |
| `mr9_ispy2` 9bit | 8 | 2 | 11.9 | 54.74 / 54.50 / 54.49 | 10 | 0.9960 / 0.9954 | 0.9995 / 0.9994 | 1.18 (0.94 / 1.20) | 55.5 / 57.8 %, 43.3 %, 5.8 %, 18 | 0.14 / 0.43 | 9.96 |
| `mr9_ispy2` 9bit | 8 | 4 | 26.0 | 51.02 / 50.55 / 50.55 | 16 | 0.9907 / 0.9903 | 0.9986 / 0.9986 | 1.81 (1.15 / 1.32) | 66.5 / 70.0 %, 56.2 %, 20.0 %, 28 | 0.23 / 0.66 | 9.84 |
| `mr9_ispy2` 9bit | 8 | 8 | 71.9 | 47.14 / 46.43 / 46.39 | 30 | 0.9792 / 0.9778 | 0.9962 / 0.9958 | 2.78 (1.37 / 1.45) | 73.2 / 76.5 %, 64.3 %, 33.3 %, 54 | 0.42 / 1.10 | 9.39 |
| `mr9_ispy2` 9bit | 8 | 12 | 133.1 | 45.36 / 44.28 / 44.21 | 50 | 0.9700 / 0.9656 | 0.9936 / 0.9924 | 3.47 (1.49 / 1.60) | 75.9 / 79.2 %, 67.4 %, 37.8 %, 90 | 0.61 / 1.43 | 8.81 |
| `mr9_ispy2` 9bit | 8 | 16 | 208.3 | 44.13 / 42.88 / 42.76 | 66 | 0.9619 / 0.9554 | 0.9912 / 0.9893 | 4.00 (1.54 / 1.67) | 77.2 / 81.4 %, 70.7 %, 41.4 %, 118 | 0.76 / 1.77 | 8.34 |
| `mr9_ispy2` 9bit | 8 | 24 | 403.6 | 42.40 / 40.85 / 40.67 | 102 | 0.9480 / 0.9372 | 0.9852 / 0.9815 | 4.87 (1.59 / 1.81) | 78.7 / 81.9 %, 71.0 %, 45.4 %, 149 | 1.03 / 2.14 | 7.41 |
| `mr9_ispy2` 9bit | 8 | 32 | 953.2 | 40.68 / 38.78 / 38.64 | 127 | 0.9322 / 0.9131 | 0.9756 / 0.9664 | 5.96 (1.59 / 1.90) | 80.7 / 83.0 %, 72.1 %, 48.2 %, 166 | 1.39 / 2.77 | 6.23 |
| `mr9_ispy2` 9bit | 8 | 40 | 2143.8 | 38.87 / 36.95 / 36.92 | 236 | 0.9097 / 0.8809 | 0.9602 / 0.9460 | 7.12 (1.61 / 1.92) | 83.9 / 86.9 %, 79.8 %, 56.3 %, 197 | 2.03 / 4.04 | 4.85 |
| `mr9_ispy2` 9bit | 8 | 56 | 4853.5 | 36.38 / 34.55 / 34.21 | 308 | 0.8641 / 0.8286 | 0.9263 / 0.9050 | 9.56 (1.60 / 1.91) | 86.0 / 91.2 %, 85.7 %, 69.5 %, 192 | 3.14 / 5.63 | 3.03 |
| `mr_ispy1` 11bit | 1 | 1 | 5.4 | 64.24 / 64.17 / 64.15 | 10 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.37 (0.32 / 0.34) | 60.0 / 60.9 %, 16.5 %, 0.2 %, 9 | 0.03 / 0.05 | 10.0 |
| `mr_ispy1` 11bit | 1 | 2 | 7.6 | 58.98 / 58.83 / 58.80 | 20 | 0.9988 / 0.9986 | 0.9998 / 0.9998 | 0.69 (0.47 / 0.48) | 77.1 / 77.8 %, 44.0 %, 7.9 %, 17 | 0.06 / 0.09 | 9.97 |
| `mr_ispy1` 11bit | 1 | 4 | 16.7 | 51.90 / 51.69 / 51.65 | 39 | 0.9936 / 0.9928 | 0.9989 / 0.9987 | 1.57 (0.78 / 0.80) | 89.2 / 89.7 %, 72.1 %, 42.8 %, 32 | 0.15 / 0.22 | 9.8 |
| `mr_ispy1` 11bit | 1 | 8 | 62.8 | 45.00 / 44.83 / 44.81 | 75 | 0.9682 / 0.9643 | 0.9931 / 0.9923 | 3.44 (1.03 / 1.05) | 94.9 / 95.3 %, 86.7 %, 71.2 %, 61 | 0.40 / 0.58 | 8.66 |
| `mr_ispy1` 11bit | 1 | 12 | 170.7 | 42.80 / 42.42 / 42.37 | 131 | 0.9501 / 0.9481 | 0.9875 / 0.9870 | 4.31 (1.05 / 1.06) | 95.9 / 96.3 %, 89.6 %, 76.5 %, 98 | 0.61 / 0.80 | 7.36 |
| `mr_ispy1` 11bit | 1 | 16 | 285.9 | 41.91 / 41.11 / 41.07 | 167 | 0.9406 / 0.9370 | 0.9840 / 0.9830 | 4.75 (1.06 / 1.08) | 96.1 / 96.6 %, 90.1 %, 78.4 %, 137 | 0.73 / 0.88 | 6.68 |
| `mr_ispy1` 11bit | 1 | 24 | 527.0 | 40.69 / 39.25 / 39.22 | 320 | 0.9283 / 0.9165 | 0.9789 / 0.9749 | 5.36 (1.06 / 1.10) | 96.4 / 96.8 %, 91.2 %, 80.3 %, 189 | 0.97 / 1.11 | 5.69 |
| `mr_ispy1` 11bit | 1 | 32 | 1094.0 | 39.64 / 37.45 / 37.35 | 433 | 0.9188 / 0.8931 | 0.9713 / 0.9601 | 5.81 (1.06 / 1.10) | 96.6 / 97.2 %, 92.2 %, 82.3 %, 209 | 1.02 / 1.23 | 4.64 |
| `mr_ispy1` 11bit | 1 | 40 | 2331.2 | 38.04 / 35.42 / 35.29 | 742 | 0.8996 / 0.8639 | 0.9600 / 0.9355 | 6.53 (1.06 / 1.10) | 97.1 / 97.6 %, 93.2 %, 83.9 %, 249 | 1.30 / 1.56 | 3.1 |
| `mr_ispy1` 11bit | 1 | 56 | 7619.3 | 35.17 / 31.67 / 31.57 | 1009 | 0.8690 / 0.8185 | 0.9386 / 0.8628 | 8.63 (1.05 / 1.09) | 97.9 / 98.4 %, 95.1 %, 87.8 %, 249 | 2.11 / 2.70 | 1.35 |
| `mr_ispy1` 11bit | 16 | 1 | 5.3 | 64.24 / 64.18 / 64.15 | 10 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.37 (0.32 / 0.34) | 59.9 / 60.7 %, 16.4 %, 0.2 %, 8 | 0.03 / 0.05 | 10.0 |
| `mr_ispy1` 11bit | 16 | 2 | 7.3 | 59.02 / 58.86 / 58.76 | 22 | 0.9988 / 0.9986 | 0.9998 / 0.9998 | 0.68 (0.47 / 0.48) | 77.0 / 77.9 %, 44.0 %, 8.1 %, 18 | 0.06 / 0.09 | 9.98 |
| `mr_ispy1` 11bit | 16 | 4 | 15.9 | 51.94 / 51.72 / 51.70 | 39 | 0.9936 / 0.9928 | 0.9989 / 0.9987 | 1.55 (0.77 / 0.80) | 89.3 / 89.7 %, 72.2 %, 42.7 %, 32 | 0.15 / 0.21 | 9.81 |
| `mr_ispy1` 11bit | 16 | 8 | 63.1 | 44.94 / 44.76 / 44.72 | 83 | 0.9678 / 0.9635 | 0.9930 / 0.9918 | 3.44 (1.04 / 1.06) | 94.9 / 95.2 %, 86.7 %, 71.2 %, 66 | 0.41 / 0.60 | 8.66 |
| `mr_ispy1` 11bit | 16 | 12 | 173.2 | 42.78 / 42.41 / 42.34 | 115 | 0.9504 / 0.9481 | 0.9874 / 0.9869 | 4.32 (1.05 / 1.07) | 95.9 / 96.1 %, 89.1 %, 76.3 %, 94 | 0.61 / 0.79 | 7.39 |
| `mr_ispy1` 11bit | 16 | 16 | 298.1 | 41.93 / 41.10 / 41.06 | 223 | 0.9410 / 0.9379 | 0.9839 / 0.9831 | 4.74 (1.06 / 1.08) | 96.1 / 96.4 %, 89.9 %, 77.9 %, 180 | 0.72 / 0.87 | 6.71 |
| `mr_ispy1` 11bit | 16 | 24 | 599.5 | 40.70 / 39.32 / 39.27 | 320 | 0.9287 / 0.9183 | 0.9775 / 0.9737 | 5.31 (1.06 / 1.10) | 96.3 / 96.8 %, 90.8 %, 79.7 %, 221 | 0.88 / 1.05 | 5.68 |
| `mr_ispy1` 11bit | 16 | 32 | 1387.6 | 39.52 / 37.19 / 37.11 | 524 | 0.9191 / 0.8922 | 0.9702 / 0.9566 | 5.88 (1.06 / 1.10) | 96.6 / 97.1 %, 92.0 %, 81.9 %, 237 | 1.02 / 1.28 | 4.49 |
| `mr_ispy1` 11bit | 16 | 40 | 3328.8 | 37.97 / 35.08 / 34.93 | 754 | 0.9015 / 0.8637 | 0.9580 / 0.9301 | 6.58 (1.06 / 1.10) | 97.0 / 97.4 %, 92.9 %, 83.9 %, 253 | 1.28 / 1.59 | 3.03 |
| `mr_ispy1` 11bit | 16 | 56 | 13710.0 | 35.43 / 31.47 / 31.13 | 1084 | 0.8786 / 0.8175 | 0.9374 / 0.8514 | 8.48 (1.06 / 1.11) | 97.8 / 98.2 %, 95.0 %, 87.5 %, 249 | 2.06 / 2.78 | 1.15 |
| `mr_ispy1` 11bit | 8 | 1 | 5.3 | 64.26 / 64.18 / 64.15 | 10 | 0.9996 / 0.9996 | 0.9999 / 0.9999 | 0.37 (0.32 / 0.34) | 60.0 / 60.8 %, 16.4 %, 0.2 %, 8 | 0.03 / 0.05 | 10.0 |
| `mr_ispy1` 11bit | 8 | 2 | 7.3 | 59.04 / 58.87 / 58.76 | 20 | 0.9988 / 0.9986 | 0.9998 / 0.9998 | 0.68 (0.47 / 0.48) | 77.0 / 77.9 %, 44.0 %, 8.1 %, 17 | 0.06 / 0.09 | 9.97 |
| `mr_ispy1` 11bit | 8 | 4 | 15.9 | 51.96 / 51.72 / 51.68 | 46 | 0.9936 / 0.9928 | 0.9989 / 0.9987 | 1.55 (0.77 / 0.80) | 89.2 / 89.8 %, 72.2 %, 42.8 %, 38 | 0.15 / 0.22 | 9.82 |
| `mr_ispy1` 11bit | 8 | 8 | 63.2 | 44.94 / 44.74 / 44.67 | 86 | 0.9674 / 0.9632 | 0.9929 / 0.9918 | 3.44 (1.04 / 1.06) | 95.0 / 95.2 %, 86.7 %, 71.2 %, 70 | 0.41 / 0.60 | 8.62 |
| `mr_ispy1` 11bit | 8 | 12 | 173.0 | 42.79 / 42.42 / 42.38 | 125 | 0.9503 / 0.9480 | 0.9874 / 0.9868 | 4.32 (1.05 / 1.06) | 95.9 / 96.1 %, 89.1 %, 76.4 %, 96 | 0.62 / 0.81 | 7.35 |
| `mr_ispy1` 11bit | 8 | 16 | 295.7 | 41.91 / 41.10 / 41.07 | 226 | 0.9409 / 0.9376 | 0.9838 / 0.9830 | 4.74 (1.06 / 1.08) | 96.1 / 96.5 %, 90.1 %, 78.2 %, 185 | 0.73 / 0.87 | 6.65 |
| `mr_ispy1` 11bit | 8 | 24 | 590.0 | 40.69 / 39.34 / 39.29 | 332 | 0.9297 / 0.9185 | 0.9779 / 0.9740 | 5.29 (1.06 / 1.10) | 96.3 / 96.8 %, 91.0 %, 79.7 %, 218 | 0.88 / 1.10 | 5.63 |
| `mr_ispy1` 11bit | 8 | 32 | 1347.8 | 39.55 / 37.18 / 37.04 | 618 | 0.9196 / 0.8913 | 0.9705 / 0.9554 | 5.86 (1.06 / 1.10) | 96.6 / 97.1 %, 92.0 %, 81.8 %, 237 | 1.02 / 1.25 | 4.52 |
| `mr_ispy1` 11bit | 8 | 40 | 3187.2 | 38.01 / 35.16 / 35.04 | 753 | 0.9010 / 0.8641 | 0.9583 / 0.9302 | 6.52 (1.06 / 1.10) | 97.1 / 97.6 %, 93.1 %, 84.1 %, 237 | 1.28 / 1.59 | 2.95 |
| `mr_ispy1` 11bit | 8 | 56 | 12723.3 | 35.28 / 31.41 / 31.28 | 1084 | 0.8756 / 0.8211 | 0.9392 / 0.8535 | 8.20 (1.06 / 1.10) | 97.9 / 98.2 %, 94.7 %, 86.9 %, 249 | 2.01 / 2.68 | 1.19 |
| `mr_ispy1` top10 | 1 | 1 | 4.6 | 63.13 / 63.10 / 63.07 | 8 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.42 (0.37 / 0.39) | 61.7 / 62.0 %, 21.8 %, 0.3 %, 7 | 0.06 / 0.09 | — |
| `mr_ispy1` top10 | 1 | 2 | 7.2 | 60.13 / 60.06 / 60.04 | 19 | 0.9990 / 0.9989 | 0.9999 / 0.9998 | 0.60 (0.45 / 0.47) | 73.3 / 73.7 %, 37.5 %, 4.7 %, 16 | 0.08 / 0.11 | — |
| `mr_ispy1` top10 | 1 | 4 | 11.1 | 55.55 / 55.42 / 55.41 | 28 | 0.9972 / 0.9970 | 0.9995 / 0.9995 | 1.02 (0.61 / 0.62) | 84.0 / 84.5 %, 59.2 %, 23.0 %, 23 | 0.11 / 0.16 | — |
| `mr_ispy1` top10 | 1 | 8 | 22.1 | 49.71 / 49.54 / 49.46 | 46 | 0.9893 / 0.9880 | 0.9980 / 0.9978 | 1.99 (0.89 / 0.91) | 91.7 / 92.0 %, 78.0 %, 53.5 %, 38 | 0.21 / 0.30 | — |
| `mr_ispy1` top10 | 1 | 12 | 42.0 | 46.35 / 46.18 / 46.13 | 66 | 0.9767 / 0.9739 | 0.9953 / 0.9948 | 2.95 (1.01 / 1.04) | 94.3 / 94.6 %, 84.6 %, 66.7 %, 49 | 0.33 / 0.47 | — |
| `mr_ispy1` top10 | 1 | 16 | 80.8 | 44.33 / 44.27 / 44.22 | 82 | 0.9629 / 0.9596 | 0.9916 / 0.9908 | 3.68 (1.04 / 1.06) | 95.5 / 95.8 %, 87.6 %, 72.7 %, 67 | 0.46 / 0.65 | — |
| `mr_ispy1` top10 | 1 | 24 | 177.4 | 42.76 / 42.33 / 42.32 | 146 | 0.9499 / 0.9480 | 0.9874 / 0.9870 | 4.33 (1.05 / 1.07) | 96.2 / 96.4 %, 89.5 %, 76.7 %, 120 | 0.62 / 0.79 | — |
| `mr_ispy1` top10 | 1 | 32 | 377.3 | 41.55 / 40.39 / 40.36 | 204 | 0.9369 / 0.9304 | 0.9820 / 0.9799 | 4.92 (1.06 / 1.08) | 96.4 / 96.7 %, 90.5 %, 79.1 %, 167 | 0.77 / 0.89 | — |
| `mr_ispy1` top10 | 1 | 40 | 741.1 | 40.42 / 38.62 / 38.59 | 366 | 0.9261 / 0.9096 | 0.9759 / 0.9699 | 5.46 (1.06 / 1.10) | 96.6 / 97.0 %, 91.5 %, 80.6 %, 221 | 0.91 / 1.08 | — |
| `mr_ispy1` top10 | 1 | 56 | 3085.6 | 37.72 / 34.87 / 34.68 | 837 | 0.8945 / 0.8582 | 0.9559 / 0.9255 | 6.58 (1.06 / 1.11) | 97.2 / 97.7 %, 93.1 %, 84.2 %, 249 | 1.32 / 1.63 | — |
| `mr_ispy1` top10 | 16 | 1 | 4.6 | 63.12 / 63.07 / 63.05 | 8 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.43 (0.37 / 0.39) | 61.8 / 62.0 %, 22.0 %, 0.3 %, 7 | 0.06 / 0.09 | — |
| `mr_ispy1` top10 | 16 | 2 | 6.6 | 60.24 / 60.13 / 60.09 | 23 | 0.9991 / 0.9990 | 0.9999 / 0.9998 | 0.59 (0.45 / 0.46) | 72.9 / 73.6 %, 37.5 %, 4.5 %, 19 | 0.08 / 0.11 | — |
| `mr_ispy1` top10 | 16 | 4 | 10.8 | 55.60 / 55.46 / 55.43 | 31 | 0.9973 / 0.9970 | 0.9996 / 0.9995 | 1.01 (0.61 / 0.62) | 84.0 / 84.5 %, 59.1 %, 23.0 %, 26 | 0.11 / 0.16 | — |
| `mr_ispy1` top10 | 16 | 8 | 21.8 | 49.67 / 49.48 / 49.46 | 52 | 0.9892 / 0.9880 | 0.9980 / 0.9978 | 2.01 (0.89 / 0.91) | 91.8 / 92.0 %, 78.0 %, 53.5 %, 43 | 0.21 / 0.30 | — |
| `mr_ispy1` top10 | 16 | 12 | 42.2 | 46.22 / 46.06 / 46.02 | 68 | 0.9759 / 0.9732 | 0.9951 / 0.9946 | 2.99 (1.02 / 1.04) | 94.4 / 94.6 %, 85.0 %, 67.0 %, 56 | 0.34 / 0.48 | — |
| `mr_ispy1` top10 | 16 | 16 | 82.5 | 44.26 / 44.18 / 44.15 | 85 | 0.9625 / 0.9591 | 0.9914 / 0.9905 | 3.70 (1.05 / 1.06) | 95.5 / 95.8 %, 87.4 %, 72.9 %, 70 | 0.47 / 0.67 | — |
| `mr_ispy1` top10 | 16 | 24 | 185.7 | 42.70 / 42.27 / 42.25 | 159 | 0.9493 / 0.9473 | 0.9870 / 0.9864 | 4.37 (1.06 / 1.07) | 96.3 / 96.4 %, 89.3 %, 76.6 %, 130 | 0.64 / 0.81 | — |
| `mr_ispy1` top10 | 16 | 32 | 408.6 | 41.44 / 40.34 / 40.31 | 237 | 0.9361 / 0.9301 | 0.9814 / 0.9796 | 5.00 (1.06 / 1.09) | 96.3 / 96.6 %, 90.3 %, 79.0 %, 178 | 0.79 / 0.93 | — |
| `mr_ispy1` top10 | 16 | 40 | 847.6 | 40.29 / 38.52 / 38.43 | 409 | 0.9252 / 0.9079 | 0.9748 / 0.9687 | 5.54 (1.06 / 1.10) | 96.8 / 97.0 %, 91.5 %, 80.4 %, 207 | 0.92 / 1.11 | — |
| `mr_ispy1` top10 | 16 | 56 | 4141.2 | 37.66 / 34.68 / 34.58 | 734 | 0.8930 / 0.8574 | 0.9552 / 0.9238 | 6.77 (1.06 / 1.12) | 97.4 / 97.7 %, 92.8 %, 84.1 %, 249 | 1.34 / 1.69 | — |
| `mr_ispy1` top10 | 8 | 1 | 4.6 | 63.12 / 63.08 / 63.07 | 9 | 0.9995 / 0.9995 | 0.9999 / 0.9999 | 0.43 (0.37 / 0.39) | 61.8 / 62.0 %, 22.0 %, 0.3 %, 8 | 0.06 / 0.09 | — |
| `mr_ispy1` top10 | 8 | 2 | 6.6 | 60.24 / 60.10 / 60.05 | 23 | 0.9991 / 0.9989 | 0.9999 / 0.9998 | 0.59 (0.45 / 0.47) | 72.9 / 73.6 %, 37.5 %, 4.5 %, 19 | 0.08 / 0.11 | — |
| `mr_ispy1` top10 | 8 | 4 | 10.8 | 55.59 / 55.46 / 55.43 | 30 | 0.9973 / 0.9970 | 0.9996 / 0.9995 | 1.01 (0.61 / 0.62) | 84.0 / 84.5 %, 59.1 %, 23.0 %, 24 | 0.11 / 0.16 | — |
| `mr_ispy1` top10 | 8 | 8 | 21.8 | 49.68 / 49.52 / 49.43 | 54 | 0.9892 / 0.9879 | 0.9980 / 0.9978 | 2.01 (0.89 / 0.91) | 91.8 / 92.0 %, 78.0 %, 53.5 %, 44 | 0.21 / 0.30 | — |
| `mr_ispy1` top10 | 8 | 12 | 42.1 | 46.23 / 46.07 / 46.03 | 63 | 0.9758 / 0.9732 | 0.9951 / 0.9946 | 2.98 (1.02 / 1.05) | 94.4 / 94.6 %, 84.8 %, 67.0 %, 51 | 0.34 / 0.48 | — |
| `mr_ispy1` top10 | 8 | 16 | 82.3 | 44.27 / 44.19 / 44.16 | 85 | 0.9623 / 0.9588 | 0.9913 / 0.9905 | 3.70 (1.05 / 1.06) | 95.5 / 95.8 %, 87.4 %, 72.8 %, 70 | 0.47 / 0.66 | — |
| `mr_ispy1` top10 | 8 | 24 | 185.0 | 42.70 / 42.27 / 42.26 | 143 | 0.9492 / 0.9472 | 0.9870 / 0.9861 | 4.38 (1.06 / 1.07) | 96.2 / 96.4 %, 89.3 %, 76.8 %, 117 | 0.64 / 0.83 | — |
| `mr_ispy1` top10 | 8 | 32 | 403.4 | 41.49 / 40.36 / 40.32 | 231 | 0.9363 / 0.9300 | 0.9814 / 0.9795 | 4.98 (1.06 / 1.08) | 96.3 / 96.7 %, 90.3 %, 78.9 %, 183 | 0.79 / 0.91 | — |
| `mr_ispy1` top10 | 8 | 40 | 836.5 | 40.37 / 38.51 / 38.46 | 417 | 0.9254 / 0.9084 | 0.9750 / 0.9686 | 5.54 (1.07 / 1.10) | 96.7 / 97.1 %, 91.5 %, 80.9 %, 191 | 0.91 / 1.11 | — |
| `mr_ispy1` top10 | 8 | 56 | 3973.4 | 37.68 / 34.74 / 34.60 | 812 | 0.8928 / 0.8552 | 0.9550 / 0.9244 | 6.73 (1.06 / 1.12) | 97.4 / 97.8 %, 92.9 %, 84.4 %, 249 | 1.36 / 1.69 | — |
| `mr_ispy1` window | 1 | 1 | 2.4 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9918 / 0.9425 | 0.02 (0.19 / 0.44) | 0.4 / 0.5 %, 0.0 %, 0.0 %, 1 | 0.00 / 0.00 | — |
| `mr_ispy1` window | 1 | 2 | 3.0 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9917 / 0.9425 | 0.09 (0.21 / 0.45) | 8.2 / 8.5 %, 0.0 %, 0.0 %, 2 | 0.01 / 0.01 | — |
| `mr_ispy1` window | 1 | 4 | 4.1 | 41.53 / 29.54 / 28.61 | 1453 | 0.9931 / 0.9694 | 0.9917 / 0.9425 | 0.20 (0.27 / 0.48) | 33.9 / 35.2 %, 1.3 %, 0.0 %, 4 | 0.02 / 0.02 | — |
| `mr_ispy1` window | 1 | 8 | 6.0 | 41.51 / 29.54 / 28.61 | 1453 | 0.9928 / 0.9692 | 0.9917 / 0.9424 | 0.39 (0.38 / 0.54) | 60.4 / 61.0 %, 17.7 %, 0.3 %, 12 | 0.03 / 0.05 | — |
| `mr_ispy1` window | 1 | 12 | 7.7 | 41.47 / 29.54 / 28.61 | 1453 | 0.9923 / 0.9687 | 0.9916 / 0.9423 | 0.57 (0.46 / 0.59) | 72.1 / 72.7 %, 35.2 %, 3.8 %, 16 | 0.05 / 0.07 | — |
| `mr_ispy1` window | 1 | 16 | 9.3 | 41.43 / 29.54 / 28.60 | 1453 | 0.9917 / 0.9681 | 0.9915 / 0.9422 | 0.75 (0.54 / 0.65) | 78.4 / 78.9 %, 47.4 %, 10.9 %, 24 | 0.07 / 0.10 | — |
| `mr_ispy1` window | 1 | 24 | 12.3 | 41.32 / 29.53 / 28.60 | 1453 | 0.9899 / 0.9665 | 0.9911 / 0.9418 | 1.10 (0.66 / 0.74) | 84.9 / 85.3 %, 62.1 %, 26.8 %, 29 | 0.10 / 0.15 | — |
| `mr_ispy1` window | 1 | 32 | 19.6 | 41.00 / 29.50 / 28.58 | 1453 | 0.9846 / 0.9617 | 0.9900 / 0.9408 | 1.78 (0.85 / 0.89) | 90.4 / 90.7 %, 75.3 %, 48.5 %, 40 | 0.18 / 0.25 | — |
| `mr_ispy1` window | 1 | 40 | 39.5 | 40.33 / 29.45 / 28.53 | 1473 | 0.9718 / 0.9501 | 0.9872 / 0.9380 | 2.81 (1.01 / 1.02) | 93.8 / 94.0 %, 83.7 %, 65.0 %, 56 | 0.31 / 0.43 | — |
| `mr_ispy1` window | 1 | 56 | 369.6 | 38.66 / 29.22 / 28.33 | 1469 | 0.9328 / 0.9081 | 0.9748 / 0.9248 | 4.74 (1.06 / 1.08) | 96.1 / 96.4 %, 90.1 %, 78.2 %, 146 | 0.71 / 0.85 | — |
| `mr_ispy1` window | 16 | 1 | 2.4 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9918 / 0.9425 | 0.02 (0.19 / 0.44) | 0.4 / 0.7 %, 0.0 %, 0.0 %, 2 | 0.00 / 0.00 | — |
| `mr_ispy1` window | 16 | 2 | 3.0 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9917 / 0.9425 | 0.09 (0.21 / 0.45) | 8.1 / 8.6 %, 0.0 %, 0.0 %, 3 | 0.01 / 0.01 | — |
| `mr_ispy1` window | 16 | 4 | 3.9 | 41.53 / 29.54 / 28.61 | 1453 | 0.9931 / 0.9694 | 0.9917 / 0.9425 | 0.19 (0.27 / 0.48) | 32.4 / 35.0 %, 1.3 %, 0.0 %, 4 | 0.02 / 0.02 | — |
| `mr_ispy1` window | 16 | 8 | 5.7 | 41.51 / 29.54 / 28.61 | 1453 | 0.9928 / 0.9692 | 0.9917 / 0.9424 | 0.37 (0.37 / 0.54) | 59.5 / 60.9 %, 17.6 %, 0.3 %, 10 | 0.03 / 0.04 | — |
| `mr_ispy1` window | 16 | 12 | 7.4 | 41.48 / 29.54 / 28.61 | 1453 | 0.9924 / 0.9687 | 0.9916 / 0.9423 | 0.56 (0.46 / 0.60) | 71.7 / 72.6 %, 35.2 %, 3.8 %, 23 | 0.05 / 0.07 | — |
| `mr_ispy1` window | 16 | 16 | 8.9 | 41.43 / 29.54 / 28.60 | 1453 | 0.9917 / 0.9682 | 0.9915 / 0.9422 | 0.75 (0.53 / 0.65) | 78.2 / 78.9 %, 47.4 %, 10.9 %, 29 | 0.07 / 0.10 | — |
| `mr_ispy1` window | 16 | 24 | 11.9 | 41.32 / 29.53 / 28.59 | 1453 | 0.9900 / 0.9666 | 0.9912 / 0.9419 | 1.09 (0.65 / 0.75) | 84.6 / 85.1 %, 61.6 %, 26.6 %, 40 | 0.10 / 0.14 | — |
| `mr_ispy1` window | 16 | 32 | 18.9 | 41.01 / 29.50 / 28.57 | 1453 | 0.9847 / 0.9619 | 0.9901 / 0.9410 | 1.77 (0.85 / 0.90) | 90.2 / 90.6 %, 75.2 %, 48.5 %, 45 | 0.17 / 0.25 | — |
| `mr_ispy1` window | 16 | 40 | 38.4 | 40.31 / 29.45 / 28.53 | 1456 | 0.9714 / 0.9501 | 0.9872 / 0.9383 | 2.83 (1.02 / 1.03) | 93.7 / 94.0 %, 83.8 %, 65.7 %, 64 | 0.31 / 0.44 | — |
| `mr_ispy1` window | 16 | 56 | 370.0 | 38.64 / 29.22 / 28.34 | 1453 | 0.9325 / 0.9078 | 0.9745 / 0.9244 | 4.75 (1.06 / 1.09) | 96.2 / 96.4 %, 90.1 %, 78.3 %, 146 | 0.72 / 0.87 | — |
| `mr_ispy1` window | 8 | 1 | 2.4 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9918 / 0.9425 | 0.02 (0.19 / 0.44) | 0.4 / 0.7 %, 0.0 %, 0.0 %, 2 | 0.00 / 0.00 | — |
| `mr_ispy1` window | 8 | 2 | 3.0 | 41.53 / 29.54 / 28.61 | 1453 | 0.9932 / 0.9695 | 0.9917 / 0.9425 | 0.09 (0.21 / 0.45) | 8.1 / 8.6 %, 0.0 %, 0.0 %, 3 | 0.01 / 0.01 | — |
| `mr_ispy1` window | 8 | 4 | 4.0 | 41.53 / 29.54 / 28.61 | 1453 | 0.9931 / 0.9694 | 0.9917 / 0.9425 | 0.19 (0.27 / 0.48) | 32.4 / 35.0 %, 1.3 %, 0.0 %, 4 | 0.02 / 0.02 | — |
| `mr_ispy1` window | 8 | 8 | 5.7 | 41.51 / 29.54 / 28.61 | 1453 | 0.9928 / 0.9692 | 0.9917 / 0.9424 | 0.38 (0.37 / 0.54) | 59.5 / 60.9 %, 17.6 %, 0.3 %, 10 | 0.03 / 0.05 | — |
| `mr_ispy1` window | 8 | 12 | 7.4 | 41.48 / 29.54 / 28.60 | 1453 | 0.9924 / 0.9687 | 0.9916 / 0.9423 | 0.57 (0.46 / 0.59) | 71.7 / 72.6 %, 35.2 %, 3.8 %, 23 | 0.05 / 0.07 | — |
| `mr_ispy1` window | 8 | 16 | 8.9 | 41.43 / 29.54 / 28.60 | 1453 | 0.9917 / 0.9681 | 0.9915 / 0.9422 | 0.75 (0.53 / 0.65) | 78.2 / 78.9 %, 47.4 %, 10.9 %, 28 | 0.07 / 0.10 | — |
| `mr_ispy1` window | 8 | 24 | 11.9 | 41.32 / 29.53 / 28.59 | 1453 | 0.9900 / 0.9666 | 0.9912 / 0.9419 | 1.09 (0.66 / 0.74) | 84.7 / 85.2 %, 61.6 %, 26.6 %, 40 | 0.10 / 0.15 | — |
| `mr_ispy1` window | 8 | 32 | 18.9 | 41.01 / 29.50 / 28.57 | 1453 | 0.9848 / 0.9619 | 0.9901 / 0.9410 | 1.77 (0.85 / 0.90) | 90.2 / 90.6 %, 75.2 %, 48.5 %, 45 | 0.17 / 0.25 | — |
| `mr_ispy1` window | 8 | 40 | 38.5 | 40.31 / 29.45 / 28.53 | 1456 | 0.9712 / 0.9499 | 0.9872 / 0.9382 | 2.83 (1.01 / 1.04) | 93.7 / 94.0 %, 83.8 %, 65.7 %, 63 | 0.31 / 0.44 | — |
| `mr_ispy1` window | 8 | 56 | 368.6 | 38.65 / 29.22 / 28.33 | 1453 | 0.9319 / 0.9074 | 0.9745 / 0.9245 | 4.76 (1.06 / 1.09) | 96.2 / 96.4 %, 90.1 %, 78.1 %, 136 | 0.72 / 0.88 | — |
| `usb_cine` (provisional) 8bit | 1 | 1 | 5.6 | 57.57 / 57.41 / 57.38 | 2 | 0.9991 / 0.9990 | 0.9999 / 0.9999 | 0.93 (0.90 / 1.04) | 11.3 / 11.8 %, 0.0 %, 0.0 %, 2 | 0.19 / 0.37 | 10.0 |
| `usb_cine` (provisional) 8bit | 1 | 2 | 7.0 | 55.28 / 55.10 / 55.06 | 4 | 0.9985 / 0.9983 | 0.9998 / 0.9998 | 1.16 (1.12 / 1.25) | 18.5 / 19.3 %, 0.3 %, 0.0 %, 4 | 0.24 / 0.43 | 10.0 |
| `usb_cine` (provisional) 8bit | 1 | 4 | 9.1 | 53.11 / 52.52 / 52.48 | 6 | 0.9975 / 0.9970 | 0.9997 / 0.9996 | 1.53 (1.34 / 1.45) | 25.7 / 28.3 %, 2.7 %, 0.0 %, 6 | 0.33 / 0.61 | 10.0 |
| `usb_cine` (provisional) 8bit | 1 | 8 | 11.6 | 50.78 / 49.68 / 49.52 | 11 | 0.9960 / 0.9943 | 0.9994 / 0.9992 | 2.02 (1.54 / 1.70) | 32.5 / 36.6 %, 9.2 %, 0.2 %, 11 | 0.50 / 0.88 | 9.99 |
| `usb_cine` (provisional) 8bit | 1 | 12 | 13.6 | 48.72 / 47.67 / 47.54 | 11 | 0.9939 / 0.9915 | 0.9989 / 0.9986 | 2.60 (1.79 / 1.94) | 37.8 / 41.0 %, 14.9 %, 0.9 %, 11 | 0.69 / 1.21 | 9.98 |
| `usb_cine` (provisional) 8bit | 1 | 16 | 15.6 | 46.99 / 45.98 / 45.79 | 17 | 0.9911 / 0.9874 | 0.9983 / 0.9977 | 3.14 (2.05 / 2.22) | 40.8 / 44.0 %, 20.3 %, 2.5 %, 17 | 0.87 / 1.56 | 9.97 |
| `usb_cine` (provisional) 8bit | 1 | 24 | 22.8 | 43.24 / 43.12 / 43.10 | 20 | 0.9792 / 0.9779 | 0.9957 / 0.9955 | 4.86 (2.63 / 3.13) | 47.9 / 48.3 %, 28.5 %, 7.3 %, 20 | 1.37 / 2.68 | 9.9 |
| `usb_cine` (provisional) 8bit | 1 | 32 | 35.7 | 40.20 / 40.01 / 39.96 | 28 | 0.9603 / 0.9588 | 0.9905 / 0.9899 | 6.93 (3.26 / 4.24) | 51.8 / 52.6 %, 36.5 %, 15.7 %, 28 | 2.23 / 4.34 | 9.72 |
| `usb_cine` (provisional) 8bit | 1 | 40 | 56.6 | 37.40 / 37.17 / 37.15 | 87 | 0.9336 / 0.9296 | 0.9803 / 0.9793 | 9.56 (4.28 / 5.56) | 57.7 / 58.9 %, 42.5 %, 23.8 %, 87 | 3.46 / 6.87 | 9.29 |
| `usb_cine` (provisional) 8bit | 1 | 56 | 156.2 | 31.56 / 31.39 / 31.31 | 172 | 0.8598 / 0.8487 | 0.9317 / 0.9274 | 18.65 (8.57 / 11.01) | 66.8 / 70.0 %, 53.5 %, 37.2 %, 172 | 8.20 / 16.25 | 7.18 |
| `usb_cine` (provisional) 8bit | 16 | 1 | 13.2 | 58.36 / 57.52 / 57.39 | 5 | 0.9993 / 0.9991 | 0.9999 / 0.9999 | 0.88 (0.87 / 1.04) | 9.4 / 11.8 %, 0.0 %, 0.0 %, 5 | 0.18 / 0.37 | 10.0 |
| `usb_cine` (provisional) 8bit | 16 | 2 | 18.3 | 55.12 / 54.71 / 54.66 | 9 | 0.9984 / 0.9982 | 0.9998 / 0.9998 | 1.20 (1.16 / 1.31) | 18.9 / 20.8 %, 0.5 %, 0.0 %, 9 | 0.25 / 0.46 | 10.0 |
| `usb_cine` (provisional) 8bit | 16 | 4 | 29.7 | 52.65 / 51.85 / 51.78 | 9 | 0.9973 / 0.9965 | 0.9996 / 0.9995 | 1.61 (1.42 / 1.60) | 27.1 / 30.9 %, 3.8 %, 0.0 %, 9 | 0.36 / 0.68 | 10.0 |
| `usb_cine` (provisional) 8bit | 16 | 8 | 41.6 | 50.03 / 49.06 / 48.93 | 18 | 0.9955 / 0.9938 | 0.9993 / 0.9991 | 2.27 (1.73 / 1.87) | 34.4 / 38.1 %, 10.8 %, 0.3 %, 18 | 0.56 / 1.08 | 9.99 |
| `usb_cine` (provisional) 8bit | 16 | 12 | 50.5 | 47.44 / 46.73 / 46.62 | 18 | 0.9919 / 0.9905 | 0.9986 / 0.9983 | 3.01 (2.05 / 2.37) | 40.9 / 42.6 %, 17.5 %, 1.7 %, 18 | 0.78 / 1.65 | 9.97 |
| `usb_cine` (provisional) 8bit | 16 | 16 | 65.7 | 45.35 / 44.84 / 44.73 | 20 | 0.9870 / 0.9855 | 0.9975 / 0.9972 | 3.80 (2.33 / 2.78) | 44.7 / 45.8 %, 23.4 %, 3.9 %, 20 | 1.05 / 2.07 | 9.95 |
| `usb_cine` (provisional) 8bit | 16 | 24 | 124.0 | 42.62 / 42.18 / 41.92 | 33 | 0.9766 / 0.9749 | 0.9950 / 0.9943 | 5.27 (2.85 / 3.55) | 48.7 / 49.4 %, 31.2 %, 9.7 %, 33 | 1.61 / 3.06 | 9.86 |
| `usb_cine` (provisional) 8bit | 16 | 32 | 264.4 | 39.81 / 39.23 / 39.16 | 38 | 0.9579 / 0.9560 | 0.9893 / 0.9884 | 7.33 (3.46 / 4.74) | 52.6 / 53.8 %, 37.8 %, 17.2 %, 38 | 2.55 / 4.75 | 9.61 |
| `usb_cine` (provisional) 8bit | 16 | 40 | 526.2 | 37.08 / 36.69 / 36.62 | 74 | 0.9309 / 0.9237 | 0.9783 / 0.9764 | 9.92 (4.44 / 5.70) | 56.6 / 58.1 %, 42.9 %, 24.9 %, 74 | 3.94 / 7.73 | 9.1 |
| `usb_cine` (provisional) 8bit | 16 | 56 | 1734.8 | 31.50 / 31.16 / 31.12 | 172 | 0.8582 / 0.8470 | 0.9294 / 0.9244 | 18.92 (8.46 / 11.01) | 66.6 / 68.2 %, 52.9 %, 37.2 %, 172 | 8.58 / 17.02 | 7.03 |
| `usb_cine` (provisional) 8bit | 8 | 1 | 12.0 | 58.40 / 57.52 / 57.42 | 6 | 0.9993 / 0.9990 | 0.9999 / 0.9999 | 0.88 (0.87 / 1.02) | 9.3 / 11.7 %, 0.1 %, 0.0 %, 6 | 0.18 / 0.36 | 10.0 |
| `usb_cine` (provisional) 8bit | 8 | 2 | 16.8 | 55.17 / 54.79 / 54.76 | 9 | 0.9984 / 0.9982 | 0.9998 / 0.9998 | 1.19 (1.14 / 1.31) | 18.8 / 20.4 %, 0.5 %, 0.0 %, 9 | 0.25 / 0.46 | 10.0 |
| `usb_cine` (provisional) 8bit | 8 | 4 | 26.4 | 52.84 / 52.03 / 51.95 | 9 | 0.9974 / 0.9967 | 0.9996 / 0.9996 | 1.57 (1.38 / 1.57) | 26.6 / 30.3 %, 3.5 %, 0.0 %, 9 | 0.36 / 0.65 | 10.0 |
| `usb_cine` (provisional) 8bit | 8 | 8 | 36.1 | 50.25 / 49.41 / 49.22 | 17 | 0.9957 / 0.9941 | 0.9993 / 0.9991 | 2.19 (1.64 / 1.86) | 33.7 / 37.6 %, 10.1 %, 0.3 %, 17 | 0.55 / 1.10 | 9.99 |
| `usb_cine` (provisional) 8bit | 8 | 12 | 43.5 | 47.66 / 47.19 / 46.79 | 18 | 0.9924 / 0.9908 | 0.9987 / 0.9983 | 2.91 (1.94 / 2.30) | 40.4 / 42.2 %, 16.8 %, 1.5 %, 18 | 0.77 / 1.56 | 9.97 |
| `usb_cine` (provisional) 8bit | 8 | 16 | 55.3 | 45.57 / 44.95 / 44.77 | 21 | 0.9877 / 0.9855 | 0.9976 / 0.9972 | 3.69 (2.23 / 2.63) | 44.3 / 45.7 %, 23.3 %, 4.0 %, 21 | 1.05 / 2.07 | 9.94 |
| `usb_cine` (provisional) 8bit | 8 | 24 | 98.6 | 42.69 / 42.21 / 42.11 | 27 | 0.9769 / 0.9750 | 0.9949 / 0.9943 | 5.23 (2.73 / 3.43) | 48.6 / 49.4 %, 31.2 %, 9.5 %, 27 | 1.57 / 3.06 | 9.85 |
| `usb_cine` (provisional) 8bit | 8 | 32 | 193.2 | 39.84 / 39.44 / 39.31 | 36 | 0.9582 / 0.9555 | 0.9893 / 0.9885 | 7.25 (3.32 / 4.63) | 52.3 / 52.9 %, 37.8 %, 17.2 %, 36 | 2.49 / 4.74 | 9.63 |
| `usb_cine` (provisional) 8bit | 8 | 40 | 354.2 | 37.15 / 36.79 / 36.74 | 77 | 0.9315 / 0.9250 | 0.9788 / 0.9767 | 9.89 (4.39 / 5.56) | 56.4 / 58.4 %, 42.8 %, 24.7 %, 77 | 3.75 / 7.38 | 9.15 |
| `usb_cine` (provisional) 8bit | 8 | 56 | 1056.8 | 31.52 / 31.29 / 31.24 | 173 | 0.8590 / 0.8487 | 0.9303 / 0.9265 | 18.85 (8.53 / 11.01) | 66.4 / 68.6 %, 53.5 %, 37.2 %, 173 | 8.52 / 16.75 | 7.05 |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 1 | 10.4 | 48.06 / 47.93 / 47.90 | 50 | 0.9976 / 0.9973 | 0.9995 / 0.9994 | 1.28 (0.66 / 0.74) | 59.2 / 60.5 %, 10.0 %, 0.4 %, 50 | 0.18 / 0.26 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 2 | 12.8 | 47.53 / 47.40 / 47.37 | 50 | 0.9972 / 0.9967 | 0.9995 / 0.9993 | 1.37 (0.75 / 0.81) | 62.5 / 63.4 %, 14.1 %, 0.5 %, 50 | 0.19 / 0.28 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 4 | 17.2 | 46.66 / 46.54 / 46.52 | 52 | 0.9962 / 0.9955 | 0.9993 / 0.9991 | 1.51 (0.86 / 0.90) | 66.9 / 67.6 %, 20.7 %, 0.8 %, 52 | 0.21 / 0.29 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 8 | 24.0 | 45.06 / 44.95 / 44.87 | 55 | 0.9937 / 0.9926 | 0.9990 / 0.9986 | 1.81 (0.97 / 1.01) | 73.3 / 73.9 %, 32.0 %, 2.8 %, 55 | 0.25 / 0.34 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 12 | 29.7 | 43.65 / 43.52 / 43.49 | 56 | 0.9906 / 0.9891 | 0.9985 / 0.9980 | 2.14 (1.07 / 1.11) | 77.7 / 78.3 %, 40.7 %, 6.4 %, 56 | 0.29 / 0.39 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 16 | 35.2 | 42.58 / 42.38 / 42.34 | 58 | 0.9875 / 0.9857 | 0.9979 / 0.9973 | 2.41 (1.11 / 1.15) | 80.4 / 81.2 %, 47.2 %, 10.6 %, 58 | 0.33 / 0.45 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 24 | 49.0 | 40.44 / 40.30 / 40.21 | 69 | 0.9778 / 0.9727 | 0.9963 / 0.9951 | 3.10 (1.24 / 1.27) | 84.9 / 85.5 %, 58.1 %, 20.8 %, 69 | 0.42 / 0.58 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 32 | 79.3 | 37.72 / 37.50 / 37.35 | 94 | 0.9585 / 0.9510 | 0.9923 / 0.9900 | 4.21 (1.36 / 1.49) | 89.2 / 89.5 %, 69.3 %, 36.8 %, 94 | 0.60 / 0.84 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 40 | 130.9 | 35.13 / 34.55 / 34.46 | 113 | 0.9273 / 0.9135 | 0.9845 / 0.9800 | 5.65 (1.43 / 1.61) | 92.0 / 92.6 %, 77.7 %, 51.8 %, 113 | 0.87 / 1.21 | — |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 56 | 417.5 | 29.75 / 29.10 / 28.98 | 173 | 0.8151 / 0.7884 | 0.9425 / 0.9314 | 10.39 (1.69 / 2.01) | 95.4 / 95.9 %, 87.3 %, 71.6 %, 173 | 1.92 / 2.75 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 1 | 12.3 | 47.95 / 47.81 / 47.78 | 50 | 0.9974 / 0.9971 | 0.9995 / 0.9993 | 1.30 (0.67 / 0.75) | 59.8 / 61.1 %, 10.8 %, 0.4 %, 50 | 0.18 / 0.25 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 2 | 15.9 | 47.46 / 47.34 / 47.30 | 51 | 0.9971 / 0.9966 | 0.9994 / 0.9993 | 1.38 (0.76 / 0.83) | 62.9 / 63.8 %, 14.7 %, 0.5 %, 51 | 0.19 / 0.28 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 4 | 23.4 | 46.47 / 46.34 / 46.31 | 52 | 0.9959 / 0.9951 | 0.9993 / 0.9990 | 1.55 (0.91 / 0.95) | 67.7 / 68.4 %, 22.5 %, 1.0 %, 52 | 0.21 / 0.30 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 8 | 36.0 | 44.85 / 44.64 / 44.60 | 55 | 0.9933 / 0.9922 | 0.9989 / 0.9986 | 1.85 (1.02 / 1.06) | 74.1 / 74.9 %, 33.9 %, 3.3 %, 55 | 0.25 / 0.34 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 12 | 44.5 | 43.68 / 43.55 / 43.52 | 61 | 0.9909 / 0.9893 | 0.9985 / 0.9980 | 2.14 (1.08 / 1.13) | 77.6 / 78.2 %, 40.6 %, 6.2 %, 61 | 0.29 / 0.39 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 16 | 53.5 | 42.76 / 42.56 / 42.39 | 64 | 0.9886 / 0.9868 | 0.9980 / 0.9974 | 2.36 (1.12 / 1.22) | 80.0 / 81.2 %, 47.2 %, 10.5 %, 64 | 0.33 / 0.44 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 24 | 75.2 | 40.77 / 40.42 / 40.24 | 73 | 0.9806 / 0.9766 | 0.9966 / 0.9956 | 2.99 (1.24 / 1.42) | 84.2 / 85.4 %, 57.7 %, 20.3 %, 73 | 0.42 / 0.59 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 32 | 145.2 | 37.77 / 37.40 / 37.30 | 109 | 0.9598 / 0.9547 | 0.9923 / 0.9903 | 4.20 (1.40 / 1.56) | 89.0 / 89.6 %, 69.5 %, 37.0 %, 109 | 0.59 / 0.84 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 40 | 295.7 | 35.10 / 34.54 / 34.34 | 119 | 0.9274 / 0.9164 | 0.9841 / 0.9801 | 5.69 (1.47 / 1.66) | 92.0 / 92.6 %, 77.6 %, 52.0 %, 119 | 0.86 / 1.23 | — |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 56 | 1495.4 | 29.77 / 29.19 / 28.98 | 170 | 0.8102 / 0.7911 | 0.9410 / 0.9317 | 10.41 (1.71 / 2.04) | 95.4 / 95.8 %, 87.1 %, 71.2 %, 170 | 1.91 / 2.77 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 1 | 12.1 | 47.96 / 47.82 / 47.80 | 50 | 0.9974 / 0.9971 | 0.9995 / 0.9993 | 1.30 (0.67 / 0.75) | 59.8 / 61.1 %, 10.8 %, 0.4 %, 50 | 0.18 / 0.25 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 2 | 15.7 | 47.46 / 47.34 / 47.29 | 51 | 0.9971 / 0.9966 | 0.9995 / 0.9993 | 1.38 (0.76 / 0.82) | 62.9 / 63.8 %, 14.7 %, 0.5 %, 51 | 0.19 / 0.28 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 4 | 23.0 | 46.49 / 46.35 / 46.31 | 52 | 0.9960 / 0.9951 | 0.9993 / 0.9990 | 1.54 (0.90 / 0.95) | 67.6 / 68.4 %, 22.4 %, 1.0 %, 52 | 0.21 / 0.30 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 8 | 35.1 | 44.90 / 44.68 / 44.60 | 53 | 0.9934 / 0.9922 | 0.9989 / 0.9985 | 1.84 (1.01 / 1.05) | 73.8 / 74.9 %, 33.8 %, 3.3 %, 53 | 0.25 / 0.34 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 12 | 43.3 | 43.72 / 43.57 / 43.52 | 58 | 0.9910 / 0.9895 | 0.9985 / 0.9980 | 2.13 (1.07 / 1.13) | 77.5 / 78.2 %, 40.6 %, 6.2 %, 58 | 0.29 / 0.39 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 16 | 52.0 | 42.82 / 42.55 / 42.39 | 69 | 0.9886 / 0.9864 | 0.9980 / 0.9975 | 2.36 (1.11 / 1.21) | 79.9 / 81.2 %, 47.2 %, 10.5 %, 69 | 0.33 / 0.44 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 24 | 72.9 | 40.81 / 40.40 / 40.27 | 73 | 0.9805 / 0.9766 | 0.9966 / 0.9956 | 2.98 (1.23 / 1.39) | 84.2 / 85.4 %, 57.7 %, 20.3 %, 73 | 0.42 / 0.59 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 32 | 138.5 | 37.78 / 37.40 / 37.28 | 109 | 0.9596 / 0.9525 | 0.9924 / 0.9902 | 4.19 (1.39 / 1.55) | 89.0 / 89.6 %, 69.7 %, 37.2 %, 109 | 0.60 / 0.84 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 40 | 273.9 | 35.11 / 34.54 / 34.34 | 121 | 0.9280 / 0.9161 | 0.9843 / 0.9803 | 5.68 (1.46 / 1.63) | 92.0 / 92.6 %, 77.6 %, 52.0 %, 121 | 0.87 / 1.23 | — |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 56 | 1292.1 | 29.77 / 29.15 / 28.98 | 178 | 0.8117 / 0.7908 | 0.9410 / 0.9314 | 10.39 (1.70 / 1.97) | 95.4 / 95.8 %, 87.2 %, 71.3 %, 178 | 1.93 / 2.80 | — |
| `ustrus_1` 8bit | 1 | 1 | 3.3 | 57.35 / 56.96 / 56.93 | 3 | 0.9988 / 0.9984 | 0.9999 / 0.9998 | 0.24 (0.24 / 0.49) | 15.7 / 17.0 %, 0.0 %, 0.0 %, 3 | 0.06 / 0.08 | 10.0 |
| `ustrus_1` 8bit | 1 | 2 | 3.9 | 54.38 / 54.26 / 54.19 | 5 | 0.9977 / 0.9966 | 0.9997 / 0.9995 | 0.34 (0.34 / 0.69) | 30.0 / 30.7 %, 0.4 %, 0.0 %, 5 | 0.08 / 0.12 | 10.0 |
| `ustrus_1` 8bit | 1 | 4 | 5.2 | 51.01 / 50.92 / 50.89 | 22 | 0.9949 / 0.9925 | 0.9993 / 0.9989 | 0.50 (0.49 / 0.99) | 50.9 / 51.7 %, 5.7 %, 0.0 %, 22 | 0.11 / 0.17 | 10.0 |
| `ustrus_1` 8bit | 1 | 8 | 8.0 | 47.02 / 46.71 / 46.65 | 38 | 0.9868 / 0.9829 | 0.9982 / 0.9973 | 0.80 (0.76 / 1.30) | 68.3 / 69.5 %, 24.6 %, 1.0 %, 38 | 0.18 / 0.28 | 9.99 |
| `ustrus_1` 8bit | 1 | 12 | 11.1 | 44.77 / 43.96 / 43.89 | 38 | 0.9777 / 0.9746 | 0.9966 / 0.9951 | 1.06 (0.96 / 1.42) | 75.4 / 77.5 %, 39.5 %, 5.7 %, 38 | 0.26 / 0.40 | 9.98 |
| `ustrus_1` 8bit | 1 | 16 | 14.5 | 43.29 / 41.98 / 41.89 | 38 | 0.9696 / 0.9667 | 0.9949 / 0.9929 | 1.28 (1.11 / 1.48) | 79.4 / 82.1 %, 49.9 %, 12.7 %, 38 | 0.33 / 0.50 | 9.96 |
| `ustrus_1` 8bit | 1 | 24 | 22.4 | 41.21 / 39.27 / 39.11 | 38 | 0.9549 / 0.9473 | 0.9911 / 0.9881 | 1.66 (1.33 / 1.59) | 83.2 / 86.6 %, 61.4 %, 25.2 %, 38 | 0.46 / 0.72 | 9.89 |
| `ustrus_1` 8bit | 1 | 32 | 42.7 | 38.86 / 36.16 / 36.00 | 73 | 0.9337 / 0.9101 | 0.9826 / 0.9781 | 2.20 (1.47 / 1.81) | 86.5 / 90.2 %, 71.1 %, 39.6 %, 73 | 0.72 / 1.14 | 9.69 |
| `ustrus_1` 8bit | 1 | 40 | 81.8 | 37.04 / 33.54 / 33.40 | 94 | 0.9087 / 0.8601 | 0.9701 / 0.9660 | 2.75 (1.62 / 2.01) | 88.5 / 92.4 %, 77.2 %, 51.2 %, 94 | 1.10 / 1.77 | 9.28 |
| `ustrus_1` 8bit | 1 | 56 | 308.3 | 33.05 / 29.16 / 28.78 | 181 | 0.8291 / 0.7155 | 0.9299 / 0.8878 | 4.14 (1.71 / 4.94) | 91.4 / 95.1 %, 85.3 %, 66.3 %, 181 | 2.24 / 3.71 | 7.54 |
| `ustrus_1` 8bit | 16 | 1 | 3.8 | 56.78 / 56.21 / 56.09 | 6 | 0.9986 / 0.9982 | 0.9998 / 0.9997 | 0.26 (0.26 / 0.51) | 18.4 / 20.5 %, 0.1 %, 0.0 %, 6 | 0.06 / 0.10 | 10.0 |
| `ustrus_1` 8bit | 16 | 2 | 4.5 | 54.12 / 53.79 / 53.76 | 11 | 0.9975 / 0.9965 | 0.9997 / 0.9995 | 0.35 (0.35 / 0.71) | 32.2 / 34.3 %, 0.5 %, 0.0 %, 11 | 0.08 / 0.13 | 10.0 |
| `ustrus_1` 8bit | 16 | 4 | 6.2 | 50.72 / 50.62 / 50.57 | 13 | 0.9946 / 0.9921 | 0.9993 / 0.9989 | 0.52 (0.51 / 1.02) | 52.9 / 53.5 %, 6.4 %, 0.0 %, 13 | 0.11 / 0.18 | 10.0 |
| `ustrus_1` 8bit | 16 | 8 | 10.4 | 46.92 / 46.53 / 46.47 | 28 | 0.9867 / 0.9827 | 0.9981 / 0.9972 | 0.81 (0.76 / 1.32) | 68.8 / 70.2 %, 25.5 %, 1.3 %, 28 | 0.19 / 0.29 | 9.99 |
| `ustrus_1` 8bit | 16 | 12 | 15.2 | 44.72 / 43.77 / 43.66 | 32 | 0.9778 / 0.9745 | 0.9966 / 0.9950 | 1.07 (0.97 / 1.44) | 75.8 / 78.0 %, 40.8 %, 6.5 %, 32 | 0.26 / 0.41 | 9.97 |
| `ustrus_1` 8bit | 16 | 16 | 20.5 | 43.31 / 41.84 / 41.72 | 35 | 0.9697 / 0.9666 | 0.9948 / 0.9927 | 1.29 (1.11 / 1.49) | 79.5 / 82.4 %, 50.6 %, 13.3 %, 35 | 0.33 / 0.51 | 9.95 |
| `ustrus_1` 8bit | 16 | 24 | 33.5 | 41.13 / 39.17 / 38.99 | 50 | 0.9548 / 0.9470 | 0.9908 / 0.9877 | 1.66 (1.33 / 1.59) | 83.3 / 86.7 %, 61.8 %, 26.0 %, 50 | 0.48 / 0.76 | 9.87 |
| `ustrus_1` 8bit | 16 | 32 | 69.5 | 38.76 / 36.10 / 35.92 | 133 | 0.9331 / 0.9103 | 0.9819 / 0.9763 | 2.23 (1.48 / 1.80) | 86.8 / 90.3 %, 71.6 %, 40.5 %, 133 | 0.75 / 1.25 | 9.63 |
| `ustrus_1` 8bit | 16 | 40 | 148.4 | 36.89 / 33.52 / 33.26 | 175 | 0.9076 / 0.8594 | 0.9685 / 0.9642 | 2.79 (1.62 / 2.05) | 88.8 / 92.5 %, 77.7 %, 51.7 %, 175 | 1.14 / 1.95 | 9.12 |
| `ustrus_1` 8bit | 16 | 56 | 710.5 | 32.90 / 28.95 / 28.57 | 195 | 0.8353 / 0.7157 | 0.9288 / 0.8865 | 4.30 (1.71 / 5.12) | 91.8 / 95.0 %, 85.1 %, 66.3 %, 195 | 2.33 / 3.88 | 7.26 |
| `ustrus_1` 8bit | 8 | 1 | 3.7 | 56.83 / 56.21 / 56.11 | 8 | 0.9986 / 0.9982 | 0.9998 / 0.9997 | 0.26 (0.26 / 0.51) | 18.2 / 20.4 %, 0.1 %, 0.0 %, 8 | 0.06 / 0.10 | 10.0 |
| `ustrus_1` 8bit | 8 | 2 | 4.5 | 54.16 / 53.79 / 53.74 | 11 | 0.9975 / 0.9965 | 0.9997 / 0.9995 | 0.35 (0.35 / 0.71) | 32.0 / 34.4 %, 0.6 %, 0.0 %, 11 | 0.08 / 0.13 | 10.0 |
| `ustrus_1` 8bit | 8 | 4 | 6.1 | 50.74 / 50.62 / 50.58 | 13 | 0.9946 / 0.9920 | 0.9993 / 0.9989 | 0.51 (0.51 / 1.02) | 52.8 / 53.4 %, 6.4 %, 0.0 %, 13 | 0.11 / 0.18 | 10.0 |
| `ustrus_1` 8bit | 8 | 8 | 10.2 | 46.93 / 46.53 / 46.46 | 28 | 0.9867 / 0.9827 | 0.9981 / 0.9972 | 0.82 (0.77 / 1.32) | 68.7 / 70.0 %, 25.6 %, 1.3 %, 28 | 0.19 / 0.29 | 9.99 |
| `ustrus_1` 8bit | 8 | 12 | 14.8 | 44.70 / 43.77 / 43.70 | 32 | 0.9778 / 0.9743 | 0.9966 / 0.9950 | 1.07 (0.97 / 1.43) | 75.7 / 78.0 %, 40.5 %, 6.4 %, 32 | 0.26 / 0.41 | 9.98 |
| `ustrus_1` 8bit | 8 | 16 | 20.0 | 43.26 / 41.85 / 41.74 | 32 | 0.9698 / 0.9664 | 0.9948 / 0.9928 | 1.29 (1.12 / 1.49) | 79.5 / 82.4 %, 50.6 %, 13.3 %, 32 | 0.33 / 0.51 | 9.95 |
| `ustrus_1` 8bit | 8 | 24 | 32.5 | 41.13 / 39.16 / 38.99 | 37 | 0.9546 / 0.9471 | 0.9908 / 0.9866 | 1.66 (1.34 / 1.59) | 83.4 / 86.8 %, 61.8 %, 26.0 %, 37 | 0.48 / 0.78 | 9.88 |
| `ustrus_1` 8bit | 8 | 32 | 67.1 | 38.77 / 36.08 / 35.92 | 91 | 0.9334 / 0.9103 | 0.9819 / 0.9766 | 2.22 (1.48 / 1.80) | 86.7 / 90.3 %, 71.6 %, 40.5 %, 91 | 0.75 / 1.25 | 9.65 |
| `ustrus_1` 8bit | 8 | 40 | 141.8 | 36.91 / 33.48 / 33.24 | 181 | 0.9082 / 0.8594 | 0.9685 / 0.9645 | 2.79 (1.62 / 2.07) | 88.8 / 92.5 %, 77.8 %, 51.7 %, 181 | 1.13 / 1.95 | 9.18 |
| `ustrus_1` 8bit | 8 | 56 | 657.0 | 32.88 / 28.96 / 28.67 | 195 | 0.8322 / 0.7157 | 0.9287 / 0.8865 | 4.23 (1.71 / 5.00) | 91.6 / 95.1 %, 85.1 %, 66.6 %, 195 | 2.33 / 3.88 | 7.31 |
| `ustrus_2` 8bit | 1 | 1 | 3.2 | 57.32 / 57.03 / 56.89 | 4 | 0.9989 / 0.9986 | 0.9999 / 0.9998 | 0.24 (0.24 / 0.36) | 15.8 / 17.0 %, 0.0 %, 0.0 %, 4 | 0.05 / 0.07 | 10.0 |
| `ustrus_2` 8bit | 1 | 2 | 3.7 | 54.37 / 54.27 / 54.24 | 5 | 0.9977 / 0.9970 | 0.9997 / 0.9996 | 0.34 (0.33 / 0.51) | 30.1 / 30.8 %, 0.4 %, 0.0 %, 4 | 0.07 / 0.10 | 10.0 |
| `ustrus_2` 8bit | 1 | 4 | 4.9 | 50.96 / 50.87 / 50.82 | 27 | 0.9948 / 0.9933 | 0.9993 / 0.9991 | 0.50 (0.50 / 0.74) | 51.5 / 52.2 %, 5.8 %, 0.0 %, 27 | 0.11 / 0.15 | 10.0 |
| `ustrus_2` 8bit | 1 | 8 | 7.5 | 46.74 / 46.60 / 46.54 | 27 | 0.9860 / 0.9831 | 0.9981 / 0.9975 | 0.81 (0.77 / 1.08) | 69.4 / 70.1 %, 25.4 %, 1.1 %, 27 | 0.17 / 0.25 | 9.99 |
| `ustrus_2` 8bit | 1 | 12 | 10.7 | 44.35 / 43.81 / 43.70 | 29 | 0.9758 / 0.9730 | 0.9964 / 0.9954 | 1.08 (0.98 / 1.26) | 76.4 / 78.0 %, 40.8 %, 6.2 %, 29 | 0.25 / 0.34 | 9.97 |
| `ustrus_2` 8bit | 1 | 16 | 14.2 | 42.87 / 41.87 / 41.79 | 46 | 0.9668 / 0.9632 | 0.9945 / 0.9932 | 1.30 (1.13 / 1.35) | 80.1 / 82.3 %, 50.4 %, 13.0 %, 46 | 0.32 / 0.44 | 9.95 |
| `ustrus_2` 8bit | 1 | 24 | 22.7 | 40.80 / 39.34 / 39.21 | 57 | 0.9505 / 0.9411 | 0.9903 / 0.9882 | 1.66 (1.32 / 1.50) | 83.7 / 86.6 %, 61.2 %, 24.9 %, 57 | 0.44 / 0.64 | 9.88 |
| `ustrus_2` 8bit | 1 | 32 | 45.1 | 38.50 / 36.43 / 36.19 | 75 | 0.9259 / 0.9006 | 0.9806 / 0.9770 | 2.19 (1.46 / 1.70) | 87.1 / 89.9 %, 70.8 %, 38.9 %, 75 | 0.72 / 1.02 | 9.63 |
| `ustrus_2` 8bit | 1 | 40 | 89.8 | 36.61 / 34.11 / 33.83 | 164 | 0.8980 / 0.8527 | 0.9655 / 0.9614 | 2.72 (1.53 / 1.94) | 89.3 / 92.1 %, 76.5 %, 49.8 %, 164 | 1.07 / 1.56 | 9.11 |
| `ustrus_2` 8bit | 1 | 56 | 304.6 | 32.96 / 30.18 / 29.82 | 158 | 0.8335 / 0.7374 | 0.9289 / 0.8956 | 3.99 (1.57 / 3.53) | 91.9 / 94.4 %, 83.1 %, 62.5 %, 151 | 2.15 / 3.23 | 7.52 |
| `ustrus_2` 8bit | 16 | 1 | 3.7 | 56.60 / 56.18 / 56.05 | 7 | 0.9986 / 0.9983 | 0.9998 / 0.9998 | 0.27 (0.26 / 0.38) | 19.0 / 20.6 %, 0.1 %, 0.0 %, 7 | 0.06 / 0.09 | 10.0 |
| `ustrus_2` 8bit | 16 | 2 | 4.3 | 54.03 / 53.76 / 53.70 | 11 | 0.9974 / 0.9969 | 0.9997 / 0.9996 | 0.35 (0.35 / 0.52) | 32.7 / 34.1 %, 0.5 %, 0.0 %, 11 | 0.08 / 0.11 | 10.0 |
| `ustrus_2` 8bit | 16 | 4 | 5.9 | 50.66 / 50.57 / 50.53 | 11 | 0.9945 / 0.9929 | 0.9993 / 0.9990 | 0.51 (0.51 / 0.77) | 53.3 / 54.1 %, 6.6 %, 0.0 %, 11 | 0.11 / 0.16 | 10.0 |
| `ustrus_2` 8bit | 16 | 8 | 9.8 | 46.65 / 46.42 / 46.35 | 23 | 0.9860 / 0.9829 | 0.9981 / 0.9974 | 0.82 (0.78 / 1.08) | 69.7 / 70.7 %, 26.3 %, 1.3 %, 23 | 0.18 / 0.27 | 9.99 |
| `ustrus_2` 8bit | 16 | 12 | 14.4 | 44.31 / 43.67 / 43.57 | 30 | 0.9759 / 0.9732 | 0.9964 / 0.9954 | 1.09 (0.99 / 1.26) | 76.6 / 78.5 %, 41.5 %, 6.6 %, 30 | 0.25 / 0.37 | 9.97 |
| `ustrus_2` 8bit | 16 | 16 | 20.0 | 42.86 / 41.80 / 41.75 | 31 | 0.9669 / 0.9634 | 0.9945 / 0.9931 | 1.31 (1.13 / 1.34) | 80.2 / 82.4 %, 50.9 %, 13.4 %, 31 | 0.32 / 0.47 | 9.95 |
| `ustrus_2` 8bit | 16 | 24 | 34.0 | 40.81 / 39.27 / 39.09 | 57 | 0.9503 / 0.9410 | 0.9901 / 0.9877 | 1.67 (1.31 / 1.49) | 83.9 / 86.6 %, 61.9 %, 25.9 %, 57 | 0.46 / 0.71 | 9.86 |
| `ustrus_2` 8bit | 16 | 32 | 74.2 | 38.47 / 36.37 / 36.11 | 80 | 0.9253 / 0.9019 | 0.9801 / 0.9757 | 2.20 (1.47 / 1.70) | 87.2 / 90.0 %, 70.8 %, 39.4 %, 80 | 0.74 / 1.11 | 9.58 |
| `ustrus_2` 8bit | 16 | 40 | 168.0 | 36.57 / 34.00 / 33.73 | 216 | 0.8979 / 0.8530 | 0.9643 / 0.9591 | 2.76 (1.54 / 2.00) | 89.3 / 92.1 %, 76.7 %, 50.1 %, 216 | 1.11 / 1.72 | 8.99 |
| `ustrus_2` 8bit | 16 | 56 | 769.5 | 32.79 / 30.03 / 29.64 | 236 | 0.8354 / 0.7429 | 0.9255 / 0.8935 | 4.11 (1.57 / 3.53) | 92.0 / 94.5 %, 83.7 %, 63.3 %, 236 | 2.24 / 3.39 | 7.32 |
| `ustrus_2` 8bit | 8 | 1 | 3.6 | 56.63 / 56.17 / 56.03 | 9 | 0.9986 / 0.9982 | 0.9998 / 0.9998 | 0.26 (0.26 / 0.38) | 18.9 / 20.7 %, 0.1 %, 0.0 %, 9 | 0.06 / 0.09 | 10.0 |
| `ustrus_2` 8bit | 8 | 2 | 4.3 | 54.06 / 53.74 / 53.69 | 10 | 0.9974 / 0.9969 | 0.9997 / 0.9996 | 0.35 (0.35 / 0.52) | 32.6 / 34.1 %, 0.5 %, 0.0 %, 10 | 0.08 / 0.11 | 10.0 |
| `ustrus_2` 8bit | 8 | 4 | 5.8 | 50.68 / 50.58 / 50.54 | 11 | 0.9945 / 0.9929 | 0.9993 / 0.9990 | 0.51 (0.51 / 0.77) | 53.2 / 54.3 %, 6.5 %, 0.0 %, 11 | 0.11 / 0.16 | 10.0 |
| `ustrus_2` 8bit | 8 | 8 | 9.6 | 46.66 / 46.43 / 46.35 | 21 | 0.9860 / 0.9828 | 0.9981 / 0.9974 | 0.82 (0.77 / 1.09) | 69.6 / 70.6 %, 26.4 %, 1.3 %, 21 | 0.18 / 0.27 | 9.99 |
| `ustrus_2` 8bit | 8 | 12 | 14.1 | 44.32 / 43.68 / 43.60 | 33 | 0.9759 / 0.9730 | 0.9964 / 0.9954 | 1.09 (0.99 / 1.26) | 76.6 / 78.3 %, 41.3 %, 6.6 %, 33 | 0.25 / 0.37 | 9.97 |
| `ustrus_2` 8bit | 8 | 16 | 19.5 | 42.84 / 41.82 / 41.73 | 45 | 0.9669 / 0.9631 | 0.9945 / 0.9931 | 1.31 (1.13 / 1.35) | 80.2 / 82.4 %, 50.8 %, 13.4 %, 45 | 0.32 / 0.47 | 9.95 |
| `ustrus_2` 8bit | 8 | 24 | 33.0 | 40.81 / 39.27 / 39.09 | 65 | 0.9501 / 0.9408 | 0.9901 / 0.9874 | 1.67 (1.31 / 1.50) | 83.9 / 86.7 %, 61.9 %, 25.9 %, 65 | 0.46 / 0.71 | 9.87 |
| `ustrus_2` 8bit | 8 | 32 | 71.7 | 38.43 / 36.36 / 36.09 | 82 | 0.9252 / 0.9019 | 0.9801 / 0.9753 | 2.21 (1.47 / 1.69) | 87.2 / 90.0 %, 70.9 %, 39.5 %, 82 | 0.74 / 1.11 | 9.59 |
| `ustrus_2` 8bit | 8 | 40 | 159.8 | 36.56 / 34.05 / 33.65 | 223 | 0.8976 / 0.8528 | 0.9643 / 0.9591 | 2.75 (1.54 / 2.02) | 89.4 / 92.1 %, 76.5 %, 50.4 %, 223 | 1.11 / 1.72 | 9.04 |
| `ustrus_2` 8bit | 8 | 56 | 696.1 | 32.84 / 30.06 / 29.53 | 237 | 0.8348 / 0.7426 | 0.9268 / 0.8933 | 4.09 (1.57 / 3.53) | 91.9 / 94.5 %, 83.5 %, 63.4 %, 237 | 2.22 / 3.39 | 7.34 |

##### Knees: the rung farthest from each curve's chord (metric against ln bytes, both scaled 0 … 1)

| series, form | G | PSNR | MS-SSIM (dB of 1 − MS-SSIM) | noise-band e ÷ σ | ≥ 1 level | JOD |
| --- | --: | --: | --: | --: | --: | --: |
| `dbt10_ea1141` 10bit | 1 | 12 | 12 | 12 | 8 | 24 |
| `dbt10_ea1141` 10bit | 16 | 12 | 12 | 12 | 8 | 24 |
| `dbt10_ea1141` 10bit | 8 | 12 | 12 | 12 | 8 | 24 |
| `dbt12_c` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_c` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_c` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_c` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbt12_c` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbt12_c` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbt12_c` window | 1 | 32 | 32 | 32 | 24 | None |
| `dbt12_c` window | 16 | 32 | 32 | 32 | 24 | None |
| `dbt12_c` window | 8 | 32 | 32 | 32 | 24 | None |
| `dbt12_ea1141` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_ea1141` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_ea1141` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbt12_ea1141` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbt12_ea1141` top10 | 16 | 8 | 12 | 8 | 8 | None |
| `dbt12_ea1141` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbt12_ea1141` window | 1 | 32 | 32 | 32 | 24 | None |
| `dbt12_ea1141` window | 16 | 32 | 32 | 32 | 24 | None |
| `dbt12_ea1141` window | 8 | 32 | 32 | 32 | 24 | None |
| `dbts_a1` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a1` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a1` 12bit | 8 | 8 | 8 | 8 | 8 | 24 |
| `dbts_a1` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_a1` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_a1` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_a1` window | 1 | 40 | 32 | 32 | 24 | None |
| `dbts_a1` window | 16 | 40 | 32 | 32 | 24 | None |
| `dbts_a1` window | 8 | 40 | 32 | 32 | 24 | None |
| `dbts_a2` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a2` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a2` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbts_a2` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_a2` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_a2` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_a2` window | 1 | 32 | 32 | 32 | 24 | None |
| `dbts_a2` window | 16 | 32 | 32 | 32 | 24 | None |
| `dbts_a2` window | 8 | 32 | 32 | 32 | 24 | None |
| `dbts_b1` 10bit | 1 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b1` 10bit | 16 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b1` 10bit | 8 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b2` 10bit | 1 | 8 | 12 | 8 | 8 | 24 |
| `dbts_b2` 10bit | 16 | 12 | 12 | 8 | 8 | 24 |
| `dbts_b2` 10bit | 8 | 8 | 12 | 8 | 8 | 24 |
| `dbts_b3` 10bit | 1 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b3` 10bit | 16 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b3` 10bit | 8 | 12 | 12 | 12 | 8 | 24 |
| `dbts_b5` 10bit | 1 | 8 | 12 | 8 | 8 | 24 |
| `dbts_b5` 10bit | 16 | 12 | 12 | 8 | 8 | 24 |
| `dbts_b5` 10bit | 8 | 12 | 12 | 8 | 8 | 24 |
| `dbts_c1` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c1` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c1` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c1` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_c1` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_c1` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_c1` window | 1 | 40 | 32 | 32 | 24 | None |
| `dbts_c1` window | 16 | 40 | 32 | 32 | 24 | None |
| `dbts_c1` window | 8 | 40 | 32 | 32 | 24 | None |
| `dbts_c2` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c2` 12bit | 16 | 8 | 8 | 12 | 8 | 16 |
| `dbts_c2` 12bit | 8 | 8 | 8 | 12 | 8 | 16 |
| `dbts_c2` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_c2` top10 | 16 | 8 | 8 | 12 | 8 | None |
| `dbts_c2` top10 | 8 | 8 | 8 | 12 | 8 | None |
| `dbts_c2` window | 1 | 32 | 40 | 40 | 24 | None |
| `dbts_c2` window | 16 | 32 | 40 | 40 | 24 | None |
| `dbts_c2` window | 8 | 32 | 40 | 40 | 24 | None |
| `dbts_c3` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c3` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c3` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c3` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_c3` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_c3` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_c3` window | 1 | 32 | 32 | 32 | 24 | None |
| `dbts_c3` window | 16 | 32 | 32 | 32 | 24 | None |
| `dbts_c3` window | 8 | 32 | 32 | 32 | 24 | None |
| `dbts_c4` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c4` 12bit | 16 | 8 | 8 | 12 | 8 | 16 |
| `dbts_c4` 12bit | 8 | 8 | 8 | 12 | 8 | 16 |
| `dbts_c4` top10 | 1 | 8 | 8 | 12 | 8 | None |
| `dbts_c4` top10 | 16 | 8 | 12 | 12 | 8 | None |
| `dbts_c4` top10 | 8 | 8 | 12 | 12 | 8 | None |
| `dbts_c4` window | 1 | 32 | 40 | 40 | 24 | None |
| `dbts_c4` window | 16 | 32 | 32 | 40 | 24 | None |
| `dbts_c4` window | 8 | 32 | 32 | 40 | 24 | None |
| `dbts_c5` 12bit | 1 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c5` 12bit | 16 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c5` 12bit | 8 | 8 | 8 | 8 | 8 | 16 |
| `dbts_c5` top10 | 1 | 8 | 8 | 8 | 8 | None |
| `dbts_c5` top10 | 16 | 8 | 8 | 8 | 8 | None |
| `dbts_c5` top10 | 8 | 8 | 8 | 8 | 8 | None |
| `dbts_c5` window | 1 | 40 | 32 | 32 | 24 | None |
| `dbts_c5` window | 16 | 40 | 32 | 32 | 24 | None |
| `dbts_c5` window | 8 | 40 | 32 | 32 | 24 | None |
| `mr9_ispy2` 9bit | 1 | 8 | 8 | 16 | 4 | 12 |
| `mr9_ispy2` 9bit | 16 | 8 | 8 | 16 | 4 | 12 |
| `mr9_ispy2` 9bit | 8 | 8 | 8 | 12 | 4 | 12 |
| `mr_ispy1` 11bit | 1 | 8 | 8 | 8 | 4 | 8 |
| `mr_ispy1` 11bit | 16 | 8 | 8 | 8 | 4 | 8 |
| `mr_ispy1` 11bit | 8 | 8 | 8 | 8 | 4 | 8 |
| `mr_ispy1` top10 | 1 | 12 | 12 | 12 | 8 | None |
| `mr_ispy1` top10 | 16 | 12 | 12 | 12 | 8 | None |
| `mr_ispy1` top10 | 8 | 12 | 12 | 12 | 8 | None |
| `mr_ispy1` window | 1 | 24 | 24 | 40 | 24 | None |
| `mr_ispy1` window | 16 | 24 | 24 | 40 | 24 | None |
| `mr_ispy1` window | 8 | 24 | 24 | 40 | 24 | None |
| `usb_cine` (provisional) 8bit | 1 | 24 | 24 | 40 | 24 | 32 |
| `usb_cine` (provisional) 8bit | 16 | 16 | 16 | 40 | 16 | 32 |
| `usb_cine` (provisional) 8bit | 8 | 16 | 16 | 32 | 16 | 32 |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 8 | 8 | 24 | 24 | None |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 4 | 8 | 32 | 24 | None |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 8 | 8 | 32 | 24 | None |
| `ustrus_1` 8bit | 1 | 16 | 16 | 24 | 12 | 32 |
| `ustrus_1` 8bit | 16 | 16 | 24 | 24 | 12 | 32 |
| `ustrus_1` 8bit | 8 | 16 | 24 | 24 | 12 | 32 |
| `ustrus_2` 8bit | 1 | 12 | 16 | 24 | 12 | 32 |
| `ustrus_2` 8bit | 16 | 12 | 16 | 24 | 12 | 32 |
| `ustrus_2` 8bit | 8 | 16 | 16 | 24 | 12 | 32 |

##### Anchors: the highest Q from Q 1 up at which every frame holds

| series, form | G | noise-band e ≤ σ | e ≤ σ | every window ≤ 1 level | scroll, band < step | scroll, full < step |
| --- | --: | --: | --: | --: | --: | --: |
| `dbt10_ea1141` 10bit | 1 | 12 | 4 | None | 24 | 32 |
| `dbt10_ea1141` 10bit | 16 | 12 | 4 | None | 24 | 32 |
| `dbt10_ea1141` 10bit | 8 | 12 | 4 | None | 24 | 32 |
| `dbt12_c` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbt12_c` window | 1 | 24 | None | None | None | None |
| `dbt12_c` window | 16 | 24 | None | None | None | None |
| `dbt12_c` window | 8 | 24 | None | None | None | None |
| `dbt12_ea1141` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbt12_ea1141` 12bit | 16 | 8 | 4 | None | 16 | 32 |
| `dbt12_ea1141` 12bit | 8 | 8 | 4 | None | 16 | 32 |
| `dbt12_ea1141` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbt12_ea1141` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbt12_ea1141` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbt12_ea1141` window | 1 | 32 | None | None | None | None |
| `dbt12_ea1141` window | 16 | 32 | None | None | None | None |
| `dbt12_ea1141` window | 8 | 32 | None | None | None | None |
| `dbts_a1` 12bit | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` 12bit | 16 | 4 | 4 | None | 16 | 32 |
| `dbts_a1` 12bit | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` top10 | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` top10 | 16 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` top10 | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_a1` window | 1 | 24 | None | None | None | None |
| `dbts_a1` window | 16 | 24 | None | None | None | None |
| `dbts_a1` window | 8 | 24 | None | None | None | None |
| `dbts_a2` 12bit | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` 12bit | 16 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` 12bit | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` top10 | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` top10 | 16 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` top10 | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_a2` window | 1 | 24 | None | None | None | None |
| `dbts_a2` window | 16 | 24 | None | None | None | None |
| `dbts_a2` window | 8 | 24 | None | None | None | None |
| `dbts_b1` 10bit | 1 | 12 | 8 | None | 24 | 56 |
| `dbts_b1` 10bit | 16 | 8 | 8 | None | 24 | 40 |
| `dbts_b1` 10bit | 8 | 8 | 8 | None | 24 | 40 |
| `dbts_b2` 10bit | 1 | 8 | 4 | None | 12 | 32 |
| `dbts_b2` 10bit | 16 | 8 | 4 | None | 12 | 32 |
| `dbts_b2` 10bit | 8 | 8 | 4 | None | 12 | 32 |
| `dbts_b3` 10bit | 1 | 12 | 8 | None | 16 | 40 |
| `dbts_b3` 10bit | 16 | 12 | 8 | None | 16 | 40 |
| `dbts_b3` 10bit | 8 | 12 | 8 | None | 16 | 40 |
| `dbts_b5` 10bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_b5` 10bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_b5` 10bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c1` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c1` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c1` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c1` top10 | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_c1` top10 | 16 | 4 | 4 | None | 16 | 40 |
| `dbts_c1` top10 | 8 | 4 | 4 | None | 16 | 40 |
| `dbts_c1` window | 1 | 24 | None | None | None | None |
| `dbts_c1` window | 16 | 24 | None | None | None | None |
| `dbts_c1` window | 8 | 24 | None | None | None | None |
| `dbts_c2` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c2` window | 1 | 32 | None | None | None | None |
| `dbts_c2` window | 16 | 32 | None | None | None | None |
| `dbts_c2` window | 8 | 32 | None | None | None | None |
| `dbts_c3` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c3` window | 1 | 24 | None | None | None | None |
| `dbts_c3` window | 16 | 24 | None | None | None | None |
| `dbts_c3` window | 8 | 24 | None | None | None | None |
| `dbts_c4` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` top10 | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c4` window | 1 | 32 | None | None | None | None |
| `dbts_c4` window | 16 | 32 | None | None | None | None |
| `dbts_c4` window | 8 | 32 | None | None | None | None |
| `dbts_c5` 12bit | 1 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` 12bit | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` 12bit | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` top10 | 1 | 4 | 4 | None | 16 | 40 |
| `dbts_c5` top10 | 16 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` top10 | 8 | 8 | 4 | None | 16 | 40 |
| `dbts_c5` window | 1 | 24 | None | None | None | None |
| `dbts_c5` window | 16 | 24 | None | None | None | None |
| `dbts_c5` window | 8 | 24 | None | None | None | None |
| `mr9_ispy2` 9bit | 1 | None | None | None | 4 | 16 |
| `mr9_ispy2` 9bit | 16 | 1 | None | None | 4 | 16 |
| `mr9_ispy2` 9bit | 8 | 1 | None | None | 4 | 16 |
| `mr_ispy1` 11bit | 1 | 4 | 2 | None | 16 | 40 |
| `mr_ispy1` 11bit | 16 | 4 | 2 | None | 16 | 32 |
| `mr_ispy1` 11bit | 8 | 4 | 2 | None | 16 | 40 |
| `mr_ispy1` top10 | 1 | 8 | 2 | None | 32 | 40 |
| `mr_ispy1` top10 | 16 | 8 | 2 | None | 32 | 40 |
| `mr_ispy1` top10 | 8 | 8 | 2 | None | 32 | 40 |
| `mr_ispy1` window | 1 | 32 | 16 | 1 | 56 | None |
| `mr_ispy1` window | 16 | 32 | 16 | None | 56 | None |
| `mr_ispy1` window | 8 | 32 | 16 | None | 56 | None |
| `usb_cine` (provisional) 8bit | 1 | None | None | None | 8 | 8 |
| `usb_cine` (provisional) 8bit | 16 | None | None | None | 4 | 4 |
| `usb_cine` (provisional) 8bit | 8 | None | None | None | 4 | 4 |
| `usb_cine_rgb` (provisional) rgb420 | 1 | 4 | None | None | 32 | 32 |
| `usb_cine_rgb` (provisional) rgb420 | 16 | 4 | None | None | 32 | 32 |
| `usb_cine_rgb` (provisional) rgb420 | 8 | 4 | None | None | 32 | 32 |
| `ustrus_1` 8bit | 1 | 4 | 2 | None | 24 | 32 |
| `ustrus_1` 8bit | 16 | 2 | 2 | None | 24 | 32 |
| `ustrus_1` 8bit | 8 | 2 | 2 | None | 24 | 32 |
| `ustrus_2` 8bit | 1 | 4 | 4 | None | 24 | 32 |
| `ustrus_2` 8bit | 16 | 4 | 4 | None | 24 | 32 |
| `ustrus_2` 8bit | 8 | 4 | 4 | None | 24 | 32 |

##### Controls

| series | HTJ2K B | lossless AV1 G 1 B | ratio HTJ2K | ratio AV1 |
| --- | --: | --: | --: | --: |
| `dbt10_d` | 42131909 | 40012744 | 2.52 | 2.65 |
| `dbt10_ea1141` | 13637860 | 12971423 | 2.58 | 2.71 |
| `dbt12_c` | 64907190 | 61529449 | 3.11 | 3.28 |
| `dbt12_ea1141` | 14476791 | 13721987 | 2.51 | 2.65 |
| `dbts_a1` | 67812443 | 63912689 | 2.53 | 2.68 |
| `dbts_a2` | 97667570 | 92267970 | 2.77 | 2.93 |
| `dbts_a3` | 39712458 | 37529604 | 2.36 | 2.50 |
| `dbts_a4` | 117046467 | 110666117 | 2.22 | 2.35 |
| `dbts_a5` | 73139226 | 69544442 | 2.76 | 2.90 |
| `dbts_b1` | 107407602 | 100465485 | 4.96 | 5.30 |
| `dbts_b2` | 143768865 | 136228987 | 2.87 | 3.03 |
| `dbts_b3` | 119235171 | 111591951 | 3.24 | 3.46 |
| `dbts_b4` | 125719597 | 93459880 | 4.10 | 5.51 |
| `dbts_b5` | 91380288 | 70831014 | 4.19 | 5.41 |
| `dbts_c1` | 70664924 | 66584219 | 3.59 | 3.81 |
| `dbts_c2` | 60299025 | 57508945 | 2.35 | 2.46 |
| `dbts_c3` | 94483885 | 89298883 | 3.30 | 3.49 |
| `dbts_c4` | 41429376 | 39203703 | 3.52 | 3.72 |
| `dbts_c5` | 82238373 | 77702592 | 2.67 | 2.83 |
| `mr9_ispy2` | 1365691 | 1265527 | 3.82 | 4.13 |
| `mr_ispy1` | 10821976 | 10783183 | 2.81 | 2.82 |
| `rf_fluoro` | 9267247 | 8775514 | 1.72 | 1.81 |
| `us_liver` | 18019334 | 17433494 | 3.73 | 3.85 |
| `usb_cine` | 4992262 | 4504277 | 3.36 | 3.72 |
| `usb_cine_rgb` | 11821475 | 10835106 | 4.26 | 4.65 |
| `ustrus_1` | 21200492 | 19196290 | 2.70 | 2.98 |
| `ustrus_2` | 21866379 | 19907243 | 2.62 | 2.87 |

</details>

**Missing.** `collect.py` without `--partial` refuses: shard 3 pushed `rows/shard-3.checks.json` (18:42 UTC) and its 14
control and 7 series rows (19:03 UTC), then nothing by 08:00 UTC the next day; no shard-3 section. So every lossy cell
of `dbts_a3`, `dbts_a4`, `dbts_a5` (system A), `dbts_b4` (system B), `dbt10_d` (content 2), `us_liver` (provisional)
and `rf_fluoro` (control) is missing; their HTJ2K and lossless AV1 bytes are in the controls table above. System A
rests on two volumes of five, which is why its row in the owner's table is the weakest. Also not run, as §2 and §Shards
say: `dbts_a_max`, `dbts_b_max`, `dbts_c_max`, G = whole, and §6's flicker test.
