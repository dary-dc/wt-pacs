# preview depth — does a reduced-depth lossy preview show what a full-depth one shows, under every window

## Preview depth protocol, pre-registered

*Row PREVIEWDEPTH, written 2026-11-04 before any measuring run. Theory and protocol only; the two small series coded
here are the pilot of §8, which sizes the run and checks the harness, and are not a result. One separate session runs
§9 on one 4-core host, changes nothing above §9, and reports every cell, including those that miss.*

1. **Asked:** whether a lossy preview carried as the source's top bits — the top 10 of a 12-bit series, so WebCodecs
   can decode it, or the top 8 of a 10-bit one — shows, under every window a reader may set (narrow ones swept across
   the whole value range, not only the header presets), what a full-depth lossy preview of the same bytes shows, or
   whether it bands or loses detail.
2. **Answer, as a protocol and a prediction:** it keeps the range and the detail the full-depth preview keeps — its
   rounding error is under a tenth of the coding error from the rung where the preview starts to remove noise, and
   below that rung the source's own noise hides the rounding — but it paints at most ⌊W ÷ 4⌋ + 1 grey levels in a
   window W units wide, and once the coding has removed the noise (σ_out below 2 units, predicted from Q 12) that
   coarser grid can show as stairs of 4 × 255 ÷ W display levels: 2 levels under system B's own header window, 4 to
   32 under the narrow windows. Whether those stairs read as banding is what CAMBI decides in §9.
3. **The numbers that decide it:** per series × window × Q, at equal Q and at equal bytes: distinct display levels;
   the share of shown samples whose level moves by ≥ 1, ≥ 2, ≥ 4 against the exact frame, and the largest move; SSIM
   inside the window; CAMBI (libvmaf's banding index), and the bytes the reduced preview needs for the full one's
   reading. The pilot (§8, two small series) already reads the level bound exactly, and the same in-window SSIM for
   0.93–1.02 × the full preview's bytes on the 12-bit volume and 1.01–1.18 × on the 10-bit one.
4. **It rests on** the 15 DBT volumes of systems A, B and C, four further DBT volumes, one fluoroscopy and one breast
   MR series (§3, these 21 and no other); libaom 3.15.1 at cpu6 and dav1d 1.5.4 as the metrics work runs them, at
   G 16; the AV1 specification's requirement that every conformant decoder's output is identical, which lets dav1d's
   output stand for both dav1d-WASM's and WebCodecs'; and libvmaf 3.0.0's CAMBI, whose visibility model is a TV's,
   not a GSDF review display's.
5. **Left open:** G 1 and 8 (only G 16 fits); the three largest DBT volumes; whether Chromium's WebCodecs decodes an
   8-bit monochrome AV1 stream at all (*unverified*; the decode run fed it 10-bit only); whether a reader sees the
   stairs, which only a reader test can say (the metrics protocol's §6 describes one); breast ultrasound and ABUS,
   which are 8-bit and have no depth to cut.

### Terms

* **Q** — the lossy quantizer, libaom's 0–63 scale (`--cq-level`, held by `--min-q = --max-q`), as
  [`../profiles`](../profiles/README.md) §Names defines it. **Ladder** here: Q 2, 4, 8, 12, 16, 24, 32, 56.
* **G** — frames coded together, a keyframe every G frames. This row runs G = 16 only.
* **Systems A, B, C** — the three DBT scanners of the EA1141 dataset: A and C 12-bit, B 10-bit.
* **b** — the series' stored depth; **source unit** — one step of a b-bit sample.
* **Full-depth preview** — the lossy stream coded at b (a 12-bit stream, profile 2, which dav1d-WASM decodes; a 10-bit
  stream, which WebCodecs decodes); the harness's form `12bit`, `10bit` (and `11bit` for the 11-bit MR control,
  coded as 12).
* **Reduced-depth preview** — the lossy stream of the source's top bits: p = min((v + 2) ≫ 2, 2^(b−2) − 1), coded at
  b − 2 bits and shown as p ≪ 2 (`top10` for b = 12, `top8` for b = 10; `top10` of the 11-bit control drops one bit).
  **Δ** — its rounding step, 4 source units in both cases.
* **Depth cut alone** — the source rounded to the reduced depth and back, with no coding: what the cut costs by itself.
* **Window** — the value range [c − W ÷ 2, c + W ÷ 2] mapped to the display's 256 grey levels as the product paints it
  ([`../profiles/voi.py`](../profiles/voi.py)); **W** its width in source units. **Shown samples** — those whose
  exact code under the window is strictly inside 0 … 255. **Display level** — that 8-bit code.
* **σ** — sensor noise: a frame's own noise in the finest band, by the metrics protocol's estimator
  ([`README.md`](README.md) §4.4), in source units. **σ_out** — the same estimator on the decoded preview's middle
  frame, measured in its coded units and scaled to source units. σ on integer data is read as a number only from
  about 4 source units up; below that it is context, not a decision input.
* **One rung** — at a given Q, the smaller change of a measure between the full-depth preview at that Q and at its
  neighbouring rungs of the ladder. The yardstick of §6.
* **CAMBI** — libvmaf's Contrast Aware Multiscale Banding Index (§5.4).

### 1 · What is asked, and what binds it

The owner, 2026-11-04: a lossy preview carried as the top bits "keeps the whole value range but in coarser steps",
and "the user might need the entire window depth in preview quality, even if the most useful is the top … we might
not be able to cut the window for a preview". The quality-metrics protocol on this base ([`README.md`](README.md)
§4.5) reads displayed grey levels only under each series' header window presets, so it cannot answer for a reader who
narrows the window to dark, mid or bright tissue or the skin line. What frames the answer:

* **Why the top bits.** WebCodecs in Chromium refuses 12-bit AV1 (measured, row WCAP, as
  [`../profiles`](../profiles/README.md) §4 records), though the specification lists 12-bit formats ([D2]:
  `enum VideoPixelFormat { // 4:2:0 Y, U, V "I420" , "I420P10" , "I420P12" , …`). A 12-bit preview through WebCodecs
  must therefore be ≤ 10 bits; a 12-bit full-depth preview needs dav1d-WASM.
* **One decoder stands for all.** The AV1 specification [D1], §7.2: "When film_grain_params_present is equal to 0,
  decoders shall produce output frames that are identical in all respects and have the same output order as those
  produced by the decoding process specified herein." Every stream here is coded with the metrics work's knobs, under
  which `film_grain_params_present` read 0 on every stream ([`README.md`](README.md) §7). So dav1d 1.5.4's output on
  this host *is* what dav1d-WASM and a conformant WebCodecs decoder show; this row decodes with dav1d only. That
  Chromium's WebCodecs accepts an 8-bit *monochrome* AV1 stream is *unverified*: the decode run fed it the 10-bit top.
* **No threshold exists to adopt.** As the metrics protocol found (its §1), no source gives a visually lossless bar
  for these data. Every decision rule below is derived from the series' own data, or cited, and says which.
* **MQSA binds DBT interpretation in the US** (the metrics protocol's §1): a lossy preview is a scrolling or
  non-interpreting view there, never the interpreted frame. This row measures, it does not license.

### 2 · Theory, with numbers (*derived* unless it says measured)

**2a. The cut by itself.** With p = (v + 2) ≫ 2 shown as 4p, the error lossy − source is 0, −1, +2, +1 for v mod 4 =
0, 1, 2, 3: mean +0.5, mean square 1.5, variance 1.25, largest 2 (below the clamp). Under a window of width W one
source unit is 255 ÷ W levels, so the cut alone moves a shown sample's level with probability 0.75 for W ≤ 256, 0.50
at W = 512 and 0.25 at W = 1024 (counting, for each error value, the share of positions where it crosses a level
boundary). Its +0.5 mean is a brightness offset of 0.5 × 255 ÷ W levels: 4 levels at W = 32, 0.25 at W = 512. (A
client could absorb it by moving the window centre 0.5 units for the reduced preview; nothing here changes that.)

**2b. The level bound.** Values the reduced preview can paint inside a window are multiples of 4, so it paints at most
**⌊W ÷ 4⌋ + 1 distinct levels** in a window W wide, against W + 1 for the full-depth preview (both capped at the 254
inner levels). It holds at every Q: it is a property of the grid, not of the coding.

| W (source units) | 32 | 64 | 128 | 256 | 512 | 1024 |
| --- | --: | --: | --: | --: | --: | --: |
| levels, reduced at most | 9 | 17 | 33 | 65 | 129 | 254 |
| levels, full-depth at most | 33 | 65 | 129 | 254 | 254 | 254 |
| one Δ = 4 units, in display levels | 31.9 | 15.9 | 8.0 | 4.0 | 2.0 | 1.0 |
| the same, in JND on the §2c display | 75 | 38 | 19 | 9.4 | 4.7 | 2.4 |

**The header presets sit inside this table.** System B's window is 512 wide (10-bit units): the reduced preview paints
at most 129 levels where the full-depth one paints up to 254, at every Q. Systems A and C's presets are 550–1093 wide
(SIGMOID, the metrics rows' series records), 137–273 rounding steps.

**2c. What a level is worth.** On the display the metrics protocol models (GSDF [D4], 1.2–420 cd/m², 256 codes at equal
JND steps), the codes span JND indices 79.3 to 680.0: **2.36 JND a display level** (`vdp.py`'s Equation 7-1 and 7-2,
computed here). A stair of one Δ is 2.4 JND at W = 1024 and 9.4 at W = 256 — above one JND everywhere, so *if* a stair
is uncovered by noise it is a visible contour in principle. Whether it is uncovered is 2d.

**2d. Noise dithers the cut** (*derived*: the Fourier series of the rounding error). For x plus Gaussian noise of σ,
rounded to a step Δ, the mean output departs from x by Σ_k (Δ ÷ πk)(−1)^(k+1) e^(−2π²k²σ²/Δ²) sin(2πkx ÷ Δ); its first
term, **(Δ ÷ π) e^(−2π²σ²/Δ²)**, is the stair left in the local mean. With Δ = 4:

| σ (source units) | 0.5 | 1 | 2 | 4 |
| --- | --: | --: | --: | --: |
| stair left in the local mean, units | 0.94 | 0.37 | 0.009 | 1.1e−8 |

So the cut makes no stair where σ ≥ Δ ÷ 2 = 2 units, and a stair of about Δ ÷ 4 where σ ≈ Δ ÷ 4. Checked on synthetic
ramps (§7): 0.044 units at σ 2 (sampling error included), 0.995 at σ 0.5 against 0.94 predicted.

**2e. Where the noise is.** The metrics shards' series rows (this base, `rows/shard-*.jsonl`) read σ, median per
volume: **A 11.2–14.2, C 12.9–15.8, B 3.4–5.6**, the 10-bit content-2 volumes 3.9–4.1. So σ ÷ Δ is 2.8–4.0 on A and C
and 0.85–1.4 on B: **before coding, the source's own noise dithers the cut on every DBT volume** (2d: residual stair
≤ 1e−6 units). The cut adds variance 1.25 to σ²: the noise rises by 0.25–0.50 % on A and C and by 2.0–5.3 % on B.

**2f. After coding, the noise that dithers is the preview's own.** The reduced preview's decoder rounds its own
reconstruction to the 4-unit grid, so what matters is σ_out, the noise left in the decoded frame. The metrics pilot
found the coding error in the fine band saturating at the frame's noise from Q 8 (its §8: the quantizer has removed
that noise). So **σ_out should fall below 2 units from about Q 12 on every system**, and from there the reduced preview
draws smooth tissue as 4-unit stairs where the full-depth one draws 1-unit ones. σ_out below 4 is not read as a
number (Terms), so the prediction is checked by the banding measure, not by σ_out.

**2g. Detail and error: the cut is small against the coding.** At the rung where the noise is gone the coding error
is already about 1.35 σ in RMS (metrics pilot, Q 8): ≈ 15 units on A and C, ≈ 5 on B. The cut's RMS of 1.22 adds in
quadrature: +0.3 % on A and C, +3 % on B. So the moved-level shares and in-window SSIM — which weigh error, not
stairs — should read the two previews alike from Q 8 up, and **CAMBI is the measure that can tell them apart there.**
Below Q 8 the coding error is smaller and the cut's share larger: on B (σ ÷ Δ ≈ 1) the reduced preview should read
worse at equal Q at Q 2–4.

**2h. Equal Q is not equal bytes.** The AV1 dequantizer has one table a depth ([D1] §Dequantization functions: "The
function dc_q( b ) is specified as Dc_Qlookup[ (BitDepth-8) >> 1 ][ Clip3( 0, 255, b ) ]"), each about 4× the one
below, so one Q is about one step in source units at either depth (*derived*, as [`../profiles`](../profiles/README.md)
§4 P9 assumed). Where the full-depth preview still codes noise (low Q) it pays for the two low bits and is larger;
where the noise is gone they should be within ±10 % (P9's band). Hence both comparisons, and the bytes ratio at equal
quality (§6).

#### Predictions (written before the pilot; §8 says which the pilot already reads)

| # | prediction | refuted by |
| --- | --- | --- |
| **P1** | **Level bound** (2b): the reduced preview paints ≤ ⌊W ÷ 4⌋ + 1 levels in every window, every Q; on system B's header window ≤ 129 | any window above the bound (a harness error) |
| **P2** | **The cut alone** (2a): shown samples moved ≥ 1 level: 0.75 for W ≤ 256, 0.50 at 512, 0.25 at 1024 (± 0.03), largest move ⌈2 × 255 ÷ W⌉ + 1 | a series outside ± 0.03 on a width whose windows show ≥ 1 % of the body |
| **P3** | **No banding where noise is left** (2d, 2f): at every Q whose σ_out ≥ 4 units, CAMBI (default settings) of the reduced preview within one rung of the full-depth one in every window | a window outside one rung at such a Q, on ≥ 3 series |
| **P4** | **Stairs once the noise is gone** (2b, 2f): from the first Q whose σ_out < 2 units, CAMBI at `max_log_contrast` 5 (steps up to 8 levels, §5.4) of the reduced preview above the full-depth one's by more than one rung in windows W ≤ 512; in W = 1024 within one rung | no such window on a series; or a W = 1024 window outside one rung |
| **P5** | **Error and structure alike** (2g): from Q 8 up, at equal bytes, the moved shares (≥ 1, ≥ 2, ≥ 4) and in-window SSIM within one rung in ≥ 90 % of windows per series (A, B, C) | a series under 90 % |
| **P6** | **Bytes at equal quality** (2h): for the same in-window SSIM, the reduced preview needs 0.9–1.1 × the full one's bytes on A and C; 1.0–1.2 × on B, the most at Q 2–4 | a system median outside its band |
| **P7** | **B fares worst** (2b, 2e): on every measure that separates the arms, B's share of windows "reduced worse" ≥ A's and C's | B below A or C on a measure that separates them |

**What would refute the theory as a whole:** banding (P4) at Q where σ_out ≥ 4 units (the dither model is wrong for
coded noise); or detail loss (P5) on A and C at equal bytes (the cut is not small against the coding).

### 3 · Fixtures

Every sound series of [`docs/FIXTURES.md`](../../../docs/FIXTURES.md) §AV1 data whose depth exceeds what WebCodecs takes
or sits at its limit, unsigned and grey, that fits one 4.5 h host; frames as `lab/av1/fetch_data.sh` writes them, every
frame of every series.

| group | sets | b | full · reduced | what a result here may claim |
| --- | --- | --: | --- | --- |
| DBT, system A | `dbts_a1` … `dbts_a5` | 12 | 12-bit · top 10 | these five volumes |
| DBT, system B | `dbts_b1` … `dbts_b5` | 10 | 10-bit · top 8 | these five volumes |
| DBT, system C | `dbts_c1` … `dbts_c5` | 12 | 12-bit · top 10 | these five volumes |
| content 2, DBT | `dbt12_ea1141`, `dbt12_c` · `dbt10_ea1141`, `dbt10_d` | 12 · 10 | as their depth | these four |
| content 2, other | `rf_fluoro` (fluoroscopy) · `mr_ispy1` (breast MR, b = 11) | 12 · 11 | 12-bit · top 10 (one bit cut on the MR) | controls; no breast-preview verdict |

**Not run.** `dbts_a_max`, `dbts_b_max`, `dbts_c_max` (2.9–5.4 Gpx a rung; they would not fit). **No depth to cut:**
`mr9_ispy2` (9-bit, fits a 10-bit stream whole), the TRUS sweeps and every ultrasound set (8-bit). The repo has few
cine-like breast series and repeated searches found no more (FIXTURES.md §The frame-group data search); every result
is claimed for the named fixtures only.

### 4 · Arms, per series

| arm | what |
| --- | --- |
| **full-depth preview** | the source at b through `aomenc` 3.15.1 with exactly the metrics work's knobs (`../profiles/bytes.py` `aomenc_args`: `--good --cpu-used=6 --threads=1 --end-usage=q --cq-level=Q --min-q=Q --max-q=Q --deltaq-mode=0 --aq-mode=0 --denoise-noise-level=0 --lag-in-frames=0 --auto-alt-ref=0 --tune=psnr`, monochrome), G 16, each Q of the ladder; decoded by dav1d 1.5.4 |
| **reduced-depth preview** | the same, on p at b − 2 bits (`top10`: `--profile=0 --bit-depth=10`; `top8`: `--bit-depth=8`) |
| **depth cut alone** | no coding: the source through the reduced form and back, once per series |

The encodings are the metrics work's, unchanged: knobs, forms (`12bit`, `10bit`, `top10` as `../profiles/bytes.py`
defines them) and decode, at **`5f12d5ee`** on `claude/av1-quality-metrics`; only `top8` is new, in
[`preview_depth.py`](preview_depth.py) `arms`. Every measure is taken back at b, so the arms share one scale.

**Interleaving.** Each series' 16 cells (2 arms × 8 Q) run in a Williams order over (arm, Q), the round being the
series' index (`lab/scripts/order.py`), four in flight. The readings do not depend on order (the encode is
deterministic, checked and mutated by the metrics protocol's §7); only times do, and they size, they are not compared.

### 5 · What is measured

**5.1 The windows.** Per series, from every 4th frame (every 7th sample), the *body*: the samples left after a
background value (one holding ≥ 5 % of samples at either end of the range; 0 on the DBT crops) is dropped. Its 0.5th
to 99.5th percentiles bound the sweep. Windows:

* the header's presets, as the metrics protocol reads them (function, rescale);
* **the sweep**: LINEAR windows of width W = 32, 64, 128, 256, 512, 1024 source units, centred every W ÷ 2 from the
  body's 0.5th percentile to past its 99.5th — every value of the body lies inside at least two windows of each width,
  from the skin line (the body's dark or bright edge) through dark, mid and bright tissue;
* **probes**: per width, the windows centred at the body's 2nd, 25th, 50th, 75th and 98th percentile, and the presets.

The same widths serve 10- and 12-bit series: the question is W against Δ, which is 4 units on both (2b). The pilot
sets carry 275 (12-bit) and 92 (10-bit) windows.

**5.2 Per window, over every frame** (exact, from one joint histogram of (source value, lossy − source) per cell, so
any window's counts cost a lookup): the shown samples n; the shares moved ≥ 1, ≥ 2, ≥ 4 levels; the largest move; and
the distinct levels the exact and the lossy frames paint over the shown samples, the series pooled. Sweep windows that
show < 0.1 % of the body are left out of the tables.

**5.3 SSIM inside the window**, on the probe windows: SSIM of the 8-bit codes (L = 255, the metrics protocol's
`quality.ssim_terms`: Gaussian σ 1.5, population covariance, as scikit-image's documentation says matches Wang et
al., [`README.md`](README.md) §4.2), averaged over the positions whose exact code the window shows. On the middle 4
frames, the 1 024 × 1 024 square centred on the middle frame's non-background samples (smaller frames whole).

**5.4 Banding: CAMBI** [D3], libvmaf 3.0.0, built from its tag (commit `17a67b238ce0539bdeafdc95961abac64fa16ea8`).
Its documentation: "CAMBI (Contrast Aware Multiscale Banding Index) is Netflix's detector for banding (aka contouring)
artifacts"; "CAMBI also offers a full-reference mode which computes its score as `MAX(0, distorted_score -
reference_score)`"; "The CAMBI score starts at 0, meaning no banding is detected. … As a rule of thumb, a CAMBI score
around 5 is where banding starts to become slightly annoying (also note that banding is highly dependent on the viewing
environment - the brigher the display, and the dimmer the ambient light, the more visible banding is)". Run, every
choice stated:

* **Input**: the probe windows' 8-bit codes, exact as reference and preview as distorted, on the middle 2 of the 4
  SSIM frames, every probe window stacked as one 8-bit 4:2:0 clip with neutral chroma; `full_ref=true`, so each frame
  gives the full-reference score and the preview's own (no-reference) score.
* **Two settings.** `max_log_contrast` 2, the default ("Default 2 is equivalent to 4 luma levels at 10-bit and 1 luma
  level at 8-bit. The default is recommended for banding artifacts coming from video compression"), and 5, its
  maximum ("min: 0, max: 5"), which by the same arithmetic counts steps up to 2⁵ ÷ 4 = 8 levels at 8 bits (*derived*).
  The default cannot see the 2–32-level stairs a narrow window makes of a 4-unit step (2b); 5 sees them up to 8
  levels, i.e. W ≥ 128. Stairs of 16 and 32 levels (W 64, 32) are beyond either and read by the level count only.
* **Its viewing model is a TV's.** CAMBI's visibility threshold is stated "for BT.1886" (`tvi_threshold`), not for a
  GSDF review display; its `window_size` default "corresponds to ~1 degree at 4K resolution and 1.5H". Both are kept at
  their defaults; CAMBI is read as a comparison between the arms, and its "around 5" only as the documentation's rule of
  thumb, on its own model (*unverified* for a breast-imaging display).

**5.5 Per frame**: MSE and the largest |Δ| at b; **σ_out** on the middle frame (§Terms); the temporal units' bytes.

### 6 · Decision rules

Per (series, window, Q), each measure of §5 is compared, reduced against full-depth:

* **at equal Q** — the two cells at the same Q;
* **at equal bytes** — the full-depth preview's measure interpolated linearly in ln bytes between the two rungs whose
  bytes bracket the reduced cell's (none outside them);
* **bytes at equal quality** — the reduced cell's bytes over the full-depth preview's bytes at which its measure reads
  the reduced cell's value, interpolated the same way.

**"Same"** means the difference is within **one rung** of the full-depth preview at that Q (§Terms): no larger than
what moving the full-depth preview one rung along its own ladder does (*derived* from the series' own data; it is as
fine as the ladder, which is stated with every verdict). Otherwise "reduced worse" or "reduced better", by the
measure's direction. The level count has a one-rung change of 0 on the full-depth preview (its count is set by the grid,
not by Q), so any level lost reads "reduced worse"; P1 says by how much.

**Banding** is called for a window when the reduced preview's own CAMBI at default settings reaches 5 where the
full-depth one, at equal Q or at equal bytes, is under 5 — the documentation's rule of thumb, cited (5.4), on its own
viewing model. At `max_log_contrast` 5 no bar is cited; it is read against one rung.

**The answer**, per series and then per system, per window width (and the presets) and Q: *shows what the full-depth
preview shows* where every measure but the level count reads "same" at equal bytes and no banding is called; *bands*
where banding is called or CAMBI at contrast 5 reads "reduced worse"; *loses detail* where SSIM in the window reads
"reduced worse" at equal bytes. The level count is reported beside every verdict against P1's bound.

### 7 · Checks, and their mutations

[`preview_depth_checks.py`](preview_depth_checks.py), run first by §9 and written to `rows/preview-depth.checks.json`;
as run here (`pilot/preview-depth.checks.json`), every one sees its mutation:

| check | as run | mutated | sees it |
| --- | --- | --- | --- |
| window counts from the joint histogram = a per-sample count, 4 windows, 120 000 samples | equal | lossy + 1 unit: differs | yes |
| `top8`'s error lossy − source ∈ {−1, 0, +1, +2}, mean square 1.5 (the 10-bit series' own form) | {−1, 0, 1, 2}, 1.5 | no rounding offset: {−3 … 0}, 3.5 | yes |
| level bound: W = 64 on a noisy ramp, cut ≤ 17, source ≥ 60 | 17, 62 | no cut: 62 | yes |
| dither (2d): σ = 2 leaves a stair < 0.1 unit in the local mean; σ = 0.5 leaves the predicted 0.94 within 25 % | 0.044; 0.995 | (the second case is the mutation) | yes |
| SSIM in window: identical 1, float32 = float64 to 1e-4, shown positions only | 1.0; 0.99769 both | every position counted: 0.508 | yes |
| σ_out of a reduced frame, coded units × 4, reads a source σ of 8 within 10 % | 7.99 | no × 4: 2.00 | yes |
| equal bytes: exact at a rung, linear in ln bytes between | 1.0; 2.0 | linear in bytes: 1.67 | yes |
| CAMBI full-reference: 0 on identical frames; > 0 at contrast 5 for a ramp in 4-level stairs | **not run here** (libvmaf not built on this host) | the stairs | run by §9 |

The metrics protocol's own checks (deterministic encode, frame alignment, an exact frame reads exact) cover the
encode and decode this row reuses unchanged; they are not repeated.

### 8 · Pilot, and what it sizes

`dbt12_ea1141` (29 frames of 614 × 1359, 12-bit, 24.2 Mpx) and `dbt10_ea1141` (24 frames of 678 × 1727, 10-bit,
28.1 Mpx), the whole ladder, both arms, G 16: 32 cells in **3 min 11 s of wall clock** with four in flight, on this
host (4 cores, Xeon, 15 GB), without CAMBI. Rows in [`pilot/preview-depth.jsonl`](pilot/preview-depth.jsonl), **to size
the run and to show the readings exist — not as a result**: two small cropped series.

**Costs** (what §9's estimate uses): encode, the ladder summed, both arms, **6.5–6.8 CPU s a megapixel** of the
series (the metrics shards' medians on larger volumes run 4.0; the pilot's is used, the larger); everything else
**11–13 s a cell** on these sizes, of which SSIM on the probes is about 8 s at a 1 024-wide square; CAMBI not timed
(§9).

**What the pilot reads** (each line a prediction of §2 against two series; the measuring run decides):

| | `dbt12_ea1141` (top 10 of 12) | `dbt10_ea1141` (top 8 of 10) |
| --- | --- | --- |
| σ, middle frame | 11.5 | 4.1 |
| σ_out, full · reduced, Q 2 / 8 / 12 / 16 | 11.3 · 11.2 / 4.1 · 4.0 / 1.2 · 1.5 / 0.4 · 0.6 | 4.1 · 4.2 / 2.5 · 2.2 / 1.5 · 1.5 / 0.9 · 1.0 |
| P1: levels, reduced, sweep W 32 … 1024 (median) | 9, 17, 33, 65, 129, 256 — the bound | 10, 18, 34, 66, 126–129, 186–190 — the bound (+1 where a clipped end shows) |
| P1: levels, first preset, full · reduced | 254 · 208 | 254 · **129** |
| P2: the cut alone, moved ≥ 1, W ≤ 256 · 512 · 1024 | 0.75–0.77 · 0.50 · 0.25 | 0.74–0.75 · 0.49 · 0.17 |
| bytes, reduced ÷ full at equal Q, Q 2 / 8 / 16 / 56 | 0.82 / 0.94 / 1.19 / 1.29 | 0.69 / 0.79 / 0.94 / 1.23 |
| PSNR, full · reduced, Q 2 / 8 / 16 | 65.9 · 61.6 / 50.3 · 49.9 / 45.7 · 45.9 dB | 62.1 · 53.7 / 49.6 · 47.5 / 44.4 · 44.0 dB |
| P6: bytes at equal in-window SSIM, reduced ÷ full, median by width | 0.93–1.02 (Q 2–32); 0.82–0.95 at Q 56 | 1.11–1.18 (Q 2), 1.04–1.08 (Q 8–12), 1.00–1.07 (Q 16–56) |
| P5: share of windows "same" at equal bytes, moved shares and SSIM, Q ≥ 8 | 95–100 % | 99–100 %; at Q 2–4, 75–100 % (≥ 4 levels: 75 %) |

Read as §6 would on these two series: the level bound holds exactly (P1), including **129 of 254 levels under
system B's own preset** at every Q; the cut alone reads as 2a predicts on the 12-bit volume and at W ≤ 512 on the
10-bit one (P2; at W = 1024 the 10-bit volume's window is wider than its whole range, so fewer samples cross a level);
σ_out falls under 2 units at Q 12 on both, as 2f predicts; the in-window SSIM costs the reduced preview no extra bytes
on the 12-bit volume and up to 18 % on the 10-bit one at Q 2 (P6 at its top edge). At equal Q the reduced 12-bit
preview reads *higher* PSNR from Q 12 up — and is 6–30 % larger there — which is why every verdict is also given at
equal bytes. **P4, the one that decides banding, is not read by the pilot**: CAMBI was not run.

**Saturation.** Four cells in flight, one encoder thread each, on 4 cores and 15 GB. Nothing past this host is claimed;
costs are quoted as CPU seconds only.

## 9 · Running it

One session, one 4-core, 15 GB cloud host, **≤ 4.5 h of wall clock**, on `claude/av1-preview-depth`.

**Estimate.** The 21 series hold 3 461 Mpx (system B 1 783, A 665, C 715, the rest 298). Encode 6.6 CPU s a Mpx →
22 800; decode and the window counts at 0.3 CPU s a Mpx a cell (the metrics shards' measurement cost, which includes a
whole-frame SSIM this row does not take) × 16 cells → 16 600; SSIM on the probes 8 s × 336 cells → 2 700; CAMBI on 2
frames × 33 probe windows × two settings, full-reference, at the documentation's 52 frames/s on 576 × 324 (≈ 10 Mpx/s,
*unverified* here) → about 27 s a cell, 9 100. **≈ 51 000 CPU s, 3.6 h at four cores**, 0.9 h of headroom.

```bash
git fetch origin && git checkout claude/av1-preview-depth && git pull --rebase
pip install meson                                    # ingest/tools.sh and libvmaf need it
BUILD=$PWD/lab/.av1-build lab/av1/tools/tools.sh aom # libaom 3.15.1, dav1d 1.5.4 (as the metrics shards built them)
git clone --depth 1 -b v3.0.0 https://github.com/Netflix/vmaf.git lab/.av1-build/vmaf
git -C lab/.av1-build/vmaf rev-parse HEAD            # must print 17a67b238ce0539bdeafdc95961abac64fa16ea8
(cd lab/.av1-build/vmaf/libvmaf && meson setup build --buildtype release && ninja -C build)
lab/av1/fetch_data.sh dbt12_ea1141 dbt10_ea1141 rf_fluoro mr_ispy1 dbts_a{1..5} dbts_b{1..5} dbts_c{1..5} dbt12_c dbt10_d
lab/av1/.venv/bin/pip install --require-hashes -r lab/av1/profiles/requirements.txt
LD_LIBRARY_PATH=$PWD/lab/.av1-build/dav1d/lib lab/av1/metrics/preview_depth.sh
```

* **dav1d**: as both metrics shards found, the built `dav1d` loads the system's libdav1d unless `LD_LIBRARY_PATH` names
  the built one; `dav1d --version` must print 1.5.4 before any cell.
* **What it writes:** `rows/preview-depth.checks.json` (§7, CAMBI included), then `rows/preview-depth.jsonl`: one
  `series` row per set (its windows, σ, the cut alone), one `cell` row per (arm, Q). Nothing else. If libvmaf will not
  build, the runner says so and runs without CAMBI; the section says so, and P3, P4 and the banding call are *not run*.
* **CAMBI's keys**: the report reads `cambi_full_reference` and `cambi` from each frame of libvmaf's JSON; the check's
  output records the keys libvmaf 3.0.0 actually writes. If they differ, fix `preview_depth_report.py` only (not the
  rows), and say so.
* **Order:** the pilot's two series first (their rows must reproduce the pilot's bytes, byte for byte: a determinism
  check across hosts), the two controls, then A, B, C round-robin by size, then `dbt12_c`, `dbt10_d`
  (`preview_depth.sh`). A cut run so keeps whole series of every system.
* **If it would not fit:** after the first A, B and C volumes, project the wall clock from the rows; if over 4.5 h, run
  the rest with `preview_depth.sh --q 2,8,16,32` and say so. A cut cell is listed, not dropped quietly.
* **Push early:** commit `rows/preview-depth.*` after the checks and then about hourly (`git pull --rebase` first; only
  these files and this file's measured section are the session's).
* **Disk:** the fetched sets (≈ 7 GB raw) and four cells' decoded output in flight (up to ≈ 2 GB each on system B).
* **Its section:** at the end of this file, `## Preview depth, measured (YYYY-MM-DD)`: five plain lines; the host
  (cores, memory, wall ÷ CPU of its encodes); the checks table; then
  `preview_depth_report.py lab/av1/metrics/rows/preview-depth.jsonl --tsv lab/av1/metrics/rows/preview-depth.tsv`'s
  tables, read against P1–P7 one by one; per system and width the verdict of §6; and anything not run.

## Sources

Read 2026-11-04.

* [D1] AOM, *AV1 Bitstream & Decoding Process Specification*, the editors' HTML edition,
  <https://aomediacodec.github.io/av1-spec/>: §7.2 General decoding process (quoted in §1); §Dequantization functions
  (quoted in 2h, as [`../profiles`](../profiles/README.md) [L1] reads it).
* [D2] W3C, *WebCodecs*, Working Draft, <https://www.w3.org/TR/webcodecs/>, `VideoPixelFormat`, as
  [`../profiles`](../profiles/README.md) §4 quotes it (read there 2026-11-02).
* [D3] Netflix, libvmaf, `resource/doc/cambi.md` at tag v3.0.0,
  <https://github.com/Netflix/vmaf/blob/v3.0.0/resource/doc/cambi.md> (every CAMBI quote here); the paper it cites,
  P. Tandon et al., *CAMBI: Contrast-aware Multiscale Banding Index*, PCS 2021, not re-read (*unverified* beyond the
  documentation's own account, which says the code no longer matches it exactly).
* [D4] DICOM PS3.14, chapter 7 (Grayscale Standard Display Function), as the metrics protocol [M6] reads it.
* The metrics protocol, [`README.md`](README.md) on `claude/av1-quality-metrics` at `5f12d5ee`: its §4.2, §4.4, §4.5,
  §7, §8 and its shards' series rows (σ in 2e).
