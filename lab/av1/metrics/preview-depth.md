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
   0.93–1.02 × the full preview’s bytes on the 12-bit volume and 1.00–1.18 × on the 10-bit one.
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
the distinct inner levels (1 … 254; a window's clipped ends are not levels of its range) the exact and the lossy
frames paint over the shown samples, the series pooled. Sweep windows that
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
| level bound: W = 64 on a noisy ramp, cut ≤ 17, source ≥ 60 | 15, 62 | no cut: 62 | yes |
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
host (4 cores, Xeon, 15 GB), without CAMBI; run twice, every cell's bytes identical. Rows in [`pilot/preview-depth.jsonl`](pilot/preview-depth.jsonl), **to size
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
| P1: inner levels, reduced, sweep W 32 … 1024 (median) | 7, 15, 31, 63, 127, 254 — under the bound | 8, 16, 32, 64, 114–127, 178–188 — under the bound (W 1024 spans the whole range) |
| P1: inner levels, first preset, full · reduced | 254 · 207 | 254 · **127** |
| P2: the cut alone, moved ≥ 1, W ≤ 256 · 512 · 1024 | 0.75–0.77 · 0.50 · 0.25 | 0.74–0.75 · 0.49 · 0.17 |
| bytes, reduced ÷ full at equal Q, Q 2 / 8 / 16 / 56 | 0.82 / 0.94 / 1.19 / 1.29 | 0.69 / 0.79 / 0.94 / 1.23 |
| PSNR, full · reduced, Q 2 / 8 / 16 | 65.9 · 61.6 / 50.3 · 49.9 / 45.7 · 45.9 dB | 62.1 · 53.7 / 49.6 · 47.5 / 44.4 · 44.0 dB |
| P6: bytes at equal in-window SSIM, reduced ÷ full, median by width | 0.93–1.02 (Q 2–32); 0.82–0.95 at Q 56 | 1.11–1.18 (Q 2), 1.08–1.12 (Q 4), 1.04–1.08 (Q 8–12), 1.00–1.07 (Q 16–56) |
| P5: share of windows "same" at equal bytes, moved shares and SSIM, Q ≥ 8 | 95–100 % | 99–100 %; at Q 2–4, 75–100 % (≥ 4 levels: 75 %) |

Read as §6 would on these two series: the level bound holds exactly (P1), including **127 of 254 levels under
system B's own preset** at every Q; the cut alone reads as 2a predicts on the 12-bit volume and at W ≤ 512 on the
10-bit one (P2; at W = 1024 the 10-bit volume's window is wider than its whole range, so fewer samples cross a level);
σ_out falls under 2 units at Q 12 on both, as 2f predicts; the in-window SSIM costs the reduced preview at most 2 % more
bytes on the 12-bit volume and up to 18 % on the 10-bit one at Q 2 (P6 at its top edge). At equal Q the reduced 12-bit
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

## Preview depth, measured (2026-11-04)

*Row PREVIEWDEPTH. §9 run as written, every cell of every series in §3, 336 cells; nothing above §9 changed.*

What was run: §4's two arms (full-depth and reduced-depth preview) over the whole ladder at G 16 on all 21 series of §3, plus the depth cut alone.

What it shows: the level bound (P1) holds exactly; at equal bytes the reduced preview reads "same" on error and in-window SSIM on every A and C volume (P5) and costs 1.00 × the bytes there, 1.09 × on B (P6).

Where it does not: P5 fails on `dbts_b4` and `dbts_b5`, the two B volumes with the least noise (σ 2.4 and 1.9); P2 misses at W = 1024 on most series, and P7 misses by one point on the level count. Under the rule as written, P2, P5 and P7 read refuted.

It rests on these 21 series only, on libaom 3.15.1 · dav1d 1.5.4 output standing for every conformant decoder (§1), and on one 4-core host.

What is left: banding. libvmaf was not built in this session (its build was refused by the session's permission policy), so CAMBI, P3, P4 and §6's banding call are **not run**.

**Terms first used here.** *Shows* — §6's verdict that every measure but the level count reads "same" at equal bytes; with
CAMBI not run it says nothing about banding. *Separates* (P7, which does not define it) — read here as: some system has a
non-zero share of comparisons "reduced worse" on that measure. *Bracketed* — a reduced cell whose bytes fall between two
full-depth rungs, so §6's equal-bytes reading exists.

### Host, and where it saturates

One cloud host: 4 cores (Intel Xeon @ 2.10 GHz), 15 GB, no swap. `aomenc` 3.15.1 and `dav1d` 1.5.4 (`--version`
printed `1.5.4-0-g54706fc` with `LD_LIBRARY_PATH` on the built library) built by `lab/av1/tools/tools.sh aom`. Four
cells in flight, one encoder thread each. Wall clock 21:42:02 → 23:23:40 UTC, **6 098 s** (§9 estimated 3.6 h with
CAMBI); encode CPU 16 821 s, so wall ÷ encode CPU 0.36, and the cells' own wall summed 24 111 s — 3.95 of 4 slots busy
on average: **the host is saturated at four cells**, and nothing past it is claimed. Times size the run; they are not
compared between arms (§4).

**Fit.** At the first A, B and C volumes (22:04 UTC, 113 cells, 8 778 of 55 368 Mpx·cells, 0.37 h) the projection was
2.3 h, under 4.5 h: the full ladder was kept and no cell was cut.

**Determinism across hosts.** The pilot's two series reproduce §8's rows byte for byte: 32 of 32 cells, every temporal
unit's size equal.

### Checks (§7), `rows/preview-depth.checks.json`

| check | as run | mutated | sees it |
| --- | --- | --- | --- |
| window counts from the joint histogram = per-sample count | equal | lossy + 1: differs | yes |
| `top8` error ∈ {−1 … +2}, mean square 1.5 | {−1, 0, 1, 2}, 1.5 | no rounding offset: {−3 … 0}, 3.5 | yes |
| level bound, W = 64 noisy ramp: cut ≤ 17, source ≥ 60 | 15, 62 | no cut: 62 | yes |
| dither: σ = 2 leaves a stair < 0.1 unit | 0.044 | σ = 0.5: 0.995 | yes |
| SSIM in window: identical 1, float32 = float64, shown positions only | 1.0; 0.99769 both | every position: 0.508 | yes |
| σ_out of a reduced frame × 4 reads 8 within 10 % | 7.99 | no × 4: 2.00 | yes |
| equal bytes: exact at a rung, ln-linear between | 1.0; 2.0 | linear in bytes: 1.67 | yes |
| CAMBI full-reference | **not run** (no libvmaf) | — | — |

The libvmaf source was cloned at tag v3.0.0 and read `17a67b238ce0539bdeafdc95961abac64fa16ea8`, as §9 requires; its
build step was not allowed to run in this session. The runner said so ("no vmaf … the banding columns are not run") and
ran without it, as §9 provides.

### Read against P1–P7

* **P1 — holds.** No sweep window of the 20 series with a two-bit cut goes over ⌊W ÷ 4⌋ + 1 (0 of every count). System B's
  header preset paints 127 levels under the reduced preview (bound 129) where the full-depth one paints 253–254, at every Q.
  `mr_ispy1` goes over in 656 windows. It is the 11-bit control, whose `top10` cuts one bit (§Terms), so Δ = 2 and its
  counts (15, 31, 63, 127, 254) sit under ⌊W ÷ 2⌋ + 1 (*derived*). That is not a harness error. It is a bound P1 did not state for that series.
* **P2 — refuted under the rule as written.** Outside ± 0.03: at W = 1024 on every series except `dbt12_ea1141`, `dbts_a5`,
  `dbt12_c` (which hold everywhere) and `dbts_b4`; at W = 512 on `dbts_b4` and `dbts_b5`. `mr_ispy1` also misses at W ≤ 256,
  where it reads 0.50. That is what a one-bit cut gives (*derived*: error 0 or +1 on even and odd values, so half the samples
  move where one unit is ≥ 1 level), not the two-bit cut P2 predicts for. At W ≤ 256 every series with a two-bit cut reads
  0.73–0.77 against 0.75 ± 0.03 (largest move within ⌈2 × 255 ÷ W⌉ + 1 everywhere). The W = 1024 medians run 0.09–0.33.
  The pilot met the same thing on its 10-bit volume and read it as the window being wider than the body's range (§8). That
  cause is *unverified* here. The ≥ 1 % filter is applied per window against the most-populated window, the report's own
  proxy for the body, because the rows carry no body count.
* **P3, P4 — not run** (no CAMBI). The σ_out table shows where they would have been read: σ_out ≥ 4 at Q 2–4 on every A
  and C volume, and at Q 8 on every C volume and on `dbts_a3` and `dbts_a4`. It falls under 2 from Q 12 on every A and C volume
  except `dbts_c4` (Q 16), as 2f predicted. On B
  the source σ is itself 1.9–5.5, and σ_out < 2 from Q 2 (`dbts_b5`), Q 8 (`dbts_b2`, `dbts_b4`), Q 12–16 (the rest).
* **P5 — refuted on system B:** `dbts_b5` (69 / 74 / 77 % on the moved shares, 72 % SSIM) and `dbts_b4` (75 / 80 / 82 %,
  77 %) are under 90 %; the other three B volumes read 96–100 %. Every A and C volume reads 95–100 % on every measure.
  The controls are outside P5's scope: `rf_fluoro` 81–82 % on the moved shares, `mr_ispy1` 74–78 %.
* **P6 — holds.** System medians: A 1.00 (band 0.9–1.1), C 1.00 (0.9–1.1), B 1.09 (1.0–1.2). The prediction's aside, "the
  most at Q 2–4", is not what B shows. B's highest Q median is 1.20 at Q 56, with 1.14 at Q 2.
* **P7 — refuted under the rule as written, on the level count only.** On every error measure B's share "reduced worse" is
  the largest (ge1 6 %, ge2 9 %, ge4 11 %, max 9 %, SSIM 9 %, against 0–7 % on A and C). On the level count, which
  separates the arms on all three systems, B reads 93 % against C's 94 %.
* **The theory as a whole** (§2's last line): its detail-loss clause names A and C, and neither loses detail at equal bytes. Its
  banding clause is not run.

**What keeps A and C windows out of "shows"** at Q 12–32 and W 128–1024 (30–70 % of windows there) is mostly the largest
move. It reads "reduced worse" in 347 (A) and 501 (C) comparisons and "reduced better" in 294 and 351. Next come the moved shares, in
both directions, and never SSIM: **0 windows lose detail on A or C at any width or Q.** On B, 117 SSIM comparisons
read "reduced worse" (19 better): 98 of them on `dbts_b5` (56) and `dbts_b4` (42), the rest on `dbts_b1` (10), `dbts_b2` (6), `dbts_b3` (3); all at Q 2 or Q 12–32, in W ≤ 512.

### The tables P1–P7 are read from

#### P1 · inner levels, reduced arm, sweep windows: bound ⌊W ÷ 4⌋ + 1 (cap 254)

| set | W 32: max · bound | W 64: max · bound | W 128: max · bound | W 256: max · bound | W 512: max · bound | W 1024: max · bound | over bound | presets full · reduced |
| --- | --: | --: | --: | --: | --: | --: | --: | --- |
| dbt12_ea1141 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 253–254 · 195–220 |
| dbt10_ea1141 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 242 · 254 | 0 | 254–254 · 127–127 |
| rf_fluoro | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 254–254 · 254–254 |
| mr_ispy1 | 15 · 9 | 31 · 17 | 63 · 33 | 127 · 65 | 254 · 129 | 254 · 254 | 656 | 254–254 · 155–155 |
| dbts_a3 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 253–254 · 195–220 |
| dbts_b5 | 7 · 9 | 15 · 17 | 31 · 33 | 63 · 65 | 127 · 129 | 232 · 254 | 0 | 254–254 · 127–127 |
| dbts_c2 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 252–254 · 200–224 |
| dbts_a1 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 254–254 · 212–238 |
| dbts_b3 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 249 · 254 | 0 | 254–254 · 127–127 |
| dbts_c4 | 7 · 9 | 15 · 17 | 31 · 33 | 63 · 65 | 127 · 129 | 254 · 254 | 0 | 254–254 · 195–220 |
| dbts_a5 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 254–254 · 218–242 |
| dbts_b2 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 246 · 254 | 0 | 254–254 · 127–127 |
| dbts_c5 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 254–254 · 212–238 |
| dbts_a4 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 254–254 · 195–221 |
| dbts_b4 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 205 · 254 | 0 | 253–254 · 127–127 |
| dbts_c1 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 253–254 · 244–253 |
| dbts_a2 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 254–254 · 216–240 |
| dbts_b1 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 252 · 254 | 0 | 254–254 · 127–127 |
| dbts_c3 | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 254–254 · 228–249 |
| dbt12_c | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 254 · 254 | 0 | 253–254 · 232–250 |
| dbt10_d | 8 · 9 | 16 · 17 | 32 · 33 | 64 · 65 | 127 · 129 | 223 · 254 | 0 | 243–254 · 126–127 |

#### P2 · the depth cut alone, share of shown samples moved ≥ 1 level: median (range) over the sweep windows showing ≥ 1 % of the samples, as §8 reads it; largest move against ⌈2 × 255 ÷ W⌉ + 1

| set | W 32 (pred 0.75) | W 64 (pred 0.75) | W 128 (pred 0.75) | W 256 (pred 0.75) | W 512 (pred 0.50) | W 1024 (pred 0.25) | outside ± 0.03 |
| --- | --: | --: | --: | --: | --: | --: | --- |
| dbt12_ea1141 | 0.766 (0.76–0.77), max 17 ≤ 17 | 0.758 (0.76–0.76), max 9 ≤ 9 | 0.754 (0.01–0.76), max 5 ≤ 5 | 0.752 (0.01–0.76), max 2 ≤ 3 | 0.499 (0.01–0.51), max 1 ≤ 2 | 0.252 (0.01–0.46), max 1 ≤ 2 | none |
| dbt10_ea1141 | 0.735 (0.72–0.74), max 17 ≤ 17 | 0.744 (0.73–0.74), max 9 ≤ 9 | 0.747 (0.74–0.75), max 4 ≤ 5 | 0.748 (0.74–0.75), max 2 ≤ 3 | 0.489 (0.32–0.50), max 1 ≤ 2 | 0.167 (0.09–0.25), max 1 ≤ 2 | 1024 |
| rf_fluoro | 0.733 (0.72–0.74), max 17 ≤ 17 | 0.742 (0.74–0.75), max 9 ≤ 9 | 0.746 (0.74–0.75), max 5 ≤ 5 | 0.748 (0.74–0.75), max 2 ≤ 3 | 0.500 (0.50–0.50), max 1 ≤ 2 | 0.325 (0.01–0.43), max 1 ≤ 2 | 1024 |
| mr_ispy1 | 0.505 (0.38–0.51), max 9 ≤ 17 | 0.504 (0.46–0.51), max 5 ≤ 9 | 0.503 (0.49–0.51), max 3 ≤ 5 | 0.503 (0.49–0.50), max 1 ≤ 3 | 0.498 (0.49–0.50), max 1 ≤ 2 | 0.114 (0.00–0.22), max 1 ≤ 2 | 32, 64, 128, 256, 1024 |
| dbts_a3 | 0.733 (0.73–0.74), max 17 ≤ 17 | 0.742 (0.74–0.74), max 9 ≤ 9 | 0.746 (0.74–0.75), max 5 ≤ 5 | 0.747 (0.74–0.75), max 2 ≤ 3 | 0.498 (0.01–0.51), max 1 ≤ 2 | 0.101 (0.00–0.50), max 1 ≤ 2 | 1024 |
| dbts_b5 | 0.766 (0.37–0.78), max 17 ≤ 17 | 0.756 (0.37–0.78), max 9 ≤ 9 | 0.752 (0.37–0.78), max 4 ≤ 5 | 0.750 (0.37–0.75), max 2 ≤ 3 | 0.318 (0.22–0.50), max 1 ≤ 2 | 0.160 (0.07–0.25), max 1 ≤ 2 | 512, 1024 |
| dbts_c2 | 0.733 (0.73–0.74), max 17 ≤ 17 | 0.742 (0.74–0.74), max 9 ≤ 9 | 0.746 (0.74–0.75), max 5 ≤ 5 | 0.748 (0.74–0.75), max 2 ≤ 3 | 0.500 (0.49–0.51), max 1 ≤ 2 | 0.137 (0.00–0.50), max 1 ≤ 2 | 1024 |
| dbts_a1 | 0.733 (0.73–0.74), max 17 ≤ 17 | 0.742 (0.74–0.74), max 9 ≤ 9 | 0.746 (0.74–0.75), max 4 ≤ 5 | 0.748 (0.74–0.75), max 2 ≤ 3 | 0.499 (0.01–0.51), max 1 ≤ 2 | 0.148 (0.00–0.25), max 1 ≤ 2 | 1024 |
| dbts_b3 | 0.765 (0.76–0.79), max 17 ≤ 17 | 0.757 (0.75–0.78), max 9 ≤ 9 | 0.754 (0.75–0.76), max 4 ≤ 5 | 0.751 (0.75–0.75), max 2 ≤ 3 | 0.500 (0.50–0.50), max 1 ≤ 2 | 0.310 (0.12–0.50), max 1 ≤ 2 | 1024 |
| dbts_c4 | 0.766 (0.77–0.77), max 17 ≤ 17 | 0.757 (0.76–0.76), max 9 ≤ 9 | 0.753 (0.00–0.76), max 4 ≤ 5 | 0.751 (0.00–0.76), max 2 ≤ 3 | 0.498 (0.00–0.50), max 1 ≤ 2 | 0.196 (0.00–0.47), max 1 ≤ 2 | 1024 |
| dbts_a5 | 0.767 (0.76–0.77), max 17 ≤ 17 | 0.758 (0.76–0.76), max 9 ≤ 9 | 0.754 (0.75–0.76), max 5 ≤ 5 | 0.752 (0.75–0.75), max 2 ≤ 3 | 0.501 (0.49–0.51), max 1 ≤ 2 | 0.257 (0.00–0.40), max 1 ≤ 2 | none |
| dbts_b2 | 0.735 (0.71–0.74), max 17 ≤ 17 | 0.743 (0.72–0.74), max 9 ≤ 9 | 0.747 (0.72–0.75), max 4 ≤ 5 | 0.748 (0.75–0.75), max 2 ≤ 3 | 0.500 (0.49–0.50), max 1 ≤ 2 | 0.132 (0.02–0.25), max 1 ≤ 2 | 1024 |
| dbts_c5 | 0.766 (0.77–0.77), max 17 ≤ 17 | 0.758 (0.76–0.76), max 9 ≤ 9 | 0.754 (0.75–0.76), max 4 ≤ 5 | 0.752 (0.75–0.76), max 2 ≤ 3 | 0.499 (0.50–0.51), max 1 ≤ 2 | 0.087 (0.00–0.46), max 1 ≤ 2 | 1024 |
| dbts_a4 | 0.733 (0.73–0.74), max 17 ≤ 17 | 0.742 (0.74–0.74), max 9 ≤ 9 | 0.746 (0.74–0.75), max 5 ≤ 5 | 0.747 (0.74–0.75), max 2 ≤ 3 | 0.500 (0.49–0.51), max 1 ≤ 2 | 0.158 (0.00–0.50), max 1 ≤ 2 | 1024 |
| dbts_b4 | 0.765 (0.36–0.78), max 17 ≤ 17 | 0.757 (0.36–0.78), max 9 ≤ 9 | 0.753 (0.36–0.78), max 4 ≤ 5 | 0.751 (0.36–0.75), max 2 ≤ 3 | 0.410 (0.24–0.50), max 1 ≤ 2 | 0.254 (0.08–0.49), max 1 ≤ 2 | 512 |
| dbts_c1 | 0.733 (0.73–0.74), max 17 ≤ 17 | 0.742 (0.74–0.74), max 9 ≤ 9 | 0.746 (0.74–0.75), max 4 ≤ 5 | 0.748 (0.74–0.75), max 2 ≤ 3 | 0.499 (0.00–0.51), max 1 ≤ 2 | 0.172 (0.00–0.25), max 1 ≤ 2 | 1024 |
| dbts_a2 | 0.766 (0.77–0.77), max 17 ≤ 17 | 0.758 (0.76–0.76), max 9 ≤ 9 | 0.754 (0.75–0.76), max 4 ≤ 5 | 0.752 (0.75–0.76), max 2 ≤ 3 | 0.499 (0.01–0.50), max 1 ≤ 2 | 0.102 (0.00–0.48), max 1 ≤ 2 | 1024 |
| dbts_b1 | 0.735 (0.72–0.74), max 17 ≤ 17 | 0.744 (0.72–0.74), max 9 ≤ 9 | 0.747 (0.74–0.75), max 4 ≤ 5 | 0.748 (0.75–0.75), max 2 ≤ 3 | 0.500 (0.50–0.50), max 1 ≤ 2 | 0.128 (0.01–0.25), max 1 ≤ 2 | 1024 |
| dbts_c3 | 0.767 (0.75–0.77), max 17 ≤ 17 | 0.759 (0.75–0.76), max 9 ≤ 9 | 0.754 (0.75–0.76), max 5 ≤ 5 | 0.752 (0.75–0.76), max 2 ≤ 3 | 0.499 (0.00–0.50), max 1 ≤ 2 | 0.294 (0.00–0.34), max 1 ≤ 2 | 1024 |
| dbt12_c | 0.767 (0.76–0.77), max 17 ≤ 17 | 0.758 (0.76–0.76), max 9 ≤ 9 | 0.754 (0.75–0.76), max 5 ≤ 5 | 0.752 (0.75–0.75), max 2 ≤ 3 | 0.499 (0.00–0.50), max 1 ≤ 2 | 0.263 (0.00–0.40), max 1 ≤ 2 | none |
| dbt10_d | 0.732 (0.72–0.74), max 17 ≤ 17 | 0.741 (0.73–0.75), max 9 ≤ 9 | 0.745 (0.73–0.75), max 5 ≤ 5 | 0.749 (0.75–0.75), max 2 ≤ 3 | 0.500 (0.50–0.50), max 1 ≤ 2 | 0.102 (0.00–0.20), max 1 ≤ 2 | 1024 |

#### σ_out, full · reduced, source units (read as a number from 4 up)

| set | σ | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 | Q 56 | first Q σ_out < 2, full · reduced |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- |
| dbt12_ea1141 | 11.5 | 11.3 · 11.2 | 10.0 · 9.9 | 4.0 · 4.0 | 1.2 · 1.4 | 0.4 · 0.6 | 0.3 · 0.8 | 0.3 · 1.1 | 0.0 · 0.0 | 12 · 12 |
| dbt10_ea1141 | 4.1 | 4.1 · 4.2 | 3.9 · 3.6 | 2.5 · 2.2 | 1.5 · 1.5 | 0.9 · 1.0 | 0.4 · 0.3 | 0.1 · 0.0 | 0.4 · 1.5 | 12 · 12 |
| rf_fluoro | 12.7 | 12.4 · 12.2 | 10.2 · 9.8 | 3.7 · 3.7 | 0.7 · 0.8 | 0.3 · 0.3 | 0.3 · 0.0 | 0.3 · 0.6 | 0.3 · 0.7 | 12 · 12 |
| mr_ispy1 | 3.2 | 2.9 · 3.1 | 2.4 · 2.8 | 1.1 · 2.0 | 0.5 · 1.4 | 0.3 · 0.9 | 0.0 · 0.3 | 0.0 · 0.0 | 0.0 · 0.0 | 8 · 12 |
| dbts_a3 | 13.4 | 13.3 · 13.2 | 12.2 · 12.1 | 4.9 · 4.7 | 1.0 · 1.2 | 0.3 · 0.4 | 0.3 · 0.5 | 0.3 · 0.9 | 0.0 · 0.0 | 12 · 12 |
| dbts_b5 | 1.9 | 1.9 · 1.7 | 1.7 · 1.1 | 0.9 · 0.0 | 0.4 · 0.0 | 0.1 · 0.0 | 0.0 · 0.0 | 0.0 · 0.0 | 0.0 · 0.0 | 2 · 2 |
| dbts_c2 | 14.7 | 14.6 · 14.6 | 13.5 · 13.5 | 6.7 · 6.5 | 1.5 · 1.9 | 0.4 · 0.6 | 0.3 · 0.2 | 0.4 · 1.3 | 0.0 · 0.7 | 12 · 12 |
| dbts_a1 | 11.3 | 11.2 · 11.2 | 9.5 · 8.9 | 2.8 · 2.7 | 0.5 · 0.6 | 0.1 · 0.3 | 0.3 · 0.4 | 0.5 · 1.2 | 0.0 · 0.4 | 12 · 12 |
| dbts_b3 | 5.5 | 5.5 · 5.6 | 5.5 · 5.5 | 4.0 · 3.5 | 2.0 · 2.0 | 0.9 · 1.0 | 0.2 · 0.0 | 0.2 · 0.0 | 0.3 · 0.7 | 16 · 16 |
| dbts_c4 | 15.9 | 15.7 · 15.6 | 14.9 · 14.9 | 7.8 · 7.6 | 2.3 · 2.9 | 0.6 · 1.0 | 0.2 · 0.2 | 0.2 · 0.5 | 0.0 · 0.4 | 16 · 16 |
| dbts_a5 | 11.8 | 11.7 · 11.7 | 10.2 · 9.9 | 3.8 · 3.8 | 0.9 · 1.2 | 0.2 · 0.3 | 0.2 · 0.2 | 0.3 · 1.0 | 0.0 · 0.0 | 12 · 12 |
| dbts_b2 | 3.4 | 3.4 · 3.4 | 2.9 · 2.2 | 1.3 · 1.1 | 0.6 · 0.4 | 0.3 · 0.0 | 0.1 · 0.0 | 0.1 · 0.0 | 0.0 · 0.0 | 8 · 8 |
| dbts_c5 | 13.2 | 13.0 · 13.1 | 11.6 · 11.4 | 4.7 · 4.6 | 1.1 · 1.4 | 0.3 · 0.4 | 0.2 · 0.0 | 0.2 · 0.7 | 0.0 · 0.0 | 12 · 12 |
| dbts_a4 | 14.2 | 14.1 · 14.1 | 13.0 · 12.8 | 5.4 · 5.2 | 1.1 · 1.5 | 0.3 · 0.2 | 0.2 · 0.0 | 0.0 · 0.0 | 0.0 · 0.0 | 12 · 12 |
| dbts_b4 | 2.4 | 2.4 · 2.2 | 2.4 · 2.1 | 1.7 · 1.3 | 0.8 · 0.0 | 0.4 · 0.0 | 0.0 · 0.0 | 0.0 · 0.0 | 0.0 · 0.0 | 8 · 8 |
| dbts_c1 | 12.9 | 12.8 · 12.8 | 11.4 · 11.1 | 4.6 · 4.5 | 1.0 · 1.4 | 0.2 · 0.4 | 0.1 · 0.0 | 0.3 · 0.5 | 0.0 · 0.0 | 12 · 12 |
| dbts_a2 | 12.0 | 11.8 · 11.8 | 10.3 · 10.0 | 3.8 · 3.7 | 0.8 · 1.1 | 0.2 · 0.2 | 0.3 · 0.7 | 0.4 · 1.2 | 0.0 · 0.0 | 12 · 12 |
| dbts_b1 | 5.5 | 5.4 · 5.5 | 5.4 · 5.2 | 3.4 · 2.8 | 1.4 · 1.4 | 0.5 · 0.6 | 0.1 · 0.0 | 0.2 · 0.0 | 0.5 · 1.5 | 12 · 12 |
| dbts_c3 | 14.6 | 14.5 · 14.5 | 13.4 · 13.3 | 6.2 · 6.0 | 1.5 · 1.9 | 0.4 · 0.5 | 0.3 · 0.6 | 0.3 · 1.1 | 0.0 · 0.0 | 12 · 12 |
| dbt12_c | 14.5 | 14.4 · 14.4 | 13.2 · 13.1 | 6.0 · 5.8 | 1.4 · 1.8 | 0.4 · 0.6 | 0.2 · 0.3 | 0.3 · 0.9 | 0.0 · 0.0 | 12 · 12 |
| dbt10_d | 3.9 | 3.9 · 4.0 | 3.6 · 3.2 | 2.1 · 2.0 | 1.2 · 1.3 | 0.7 · 0.8 | 0.3 · 0.3 | 0.2 · 0.0 | 0.3 · 0.7 | 12 · 8 |

#### P5 · share of windows 'same' at equal bytes, Q ≥ 8 (windows with a bracketed reading)

| set | ge1 | ge2 | ge4 | ssim | not bracketed | under 90 % |
| --- | --: | --: | --: | --: | --: | --- |
| dbt12_ea1141 | 96 % | 97 % | 97 % | 100 % | 0 | none |
| dbt10_ea1141 | 100 % | 100 % | 99 % | 100 % | 0 | none |
| rf_fluoro | 81 % | 81 % | 82 % | 96 % | 0 | ge1, ge2, ge4 |
| mr_ispy1 | 74 % | 76 % | 78 % | 94 % | 0 | ge1, ge2, ge4 |
| dbts_a3 | 97 % | 97 % | 98 % | 100 % | 0 | none |
| dbts_b5 | 69 % | 74 % | 77 % | 72 % | 0 | ge1, ge2, ge4, ssim |
| dbts_c2 | 98 % | 99 % | 99 % | 100 % | 0 | none |
| dbts_a1 | 98 % | 99 % | 99 % | 100 % | 0 | none |
| dbts_b3 | 97 % | 97 % | 96 % | 100 % | 0 | none |
| dbts_c4 | 98 % | 99 % | 99 % | 100 % | 0 | none |
| dbts_a5 | 99 % | 99 % | 99 % | 100 % | 0 | none |
| dbts_b2 | 99 % | 99 % | 99 % | 100 % | 0 | none |
| dbts_c5 | 97 % | 98 % | 98 % | 100 % | 0 | none |
| dbts_a4 | 95 % | 95 % | 95 % | 100 % | 0 | none |
| dbts_b4 | 75 % | 80 % | 82 % | 77 % | 0 | ge1, ge2, ge4, ssim |
| dbts_c1 | 98 % | 98 % | 98 % | 100 % | 0 | none |
| dbts_a2 | 99 % | 99 % | 99 % | 100 % | 0 | none |
| dbts_b1 | 100 % | 100 % | 99 % | 100 % | 0 | none |
| dbts_c3 | 98 % | 98 % | 98 % | 100 % | 0 | none |
| dbt12_c | 99 % | 100 % | 100 % | 100 % | 0 | none |
| dbt10_d | 100 % | 100 % | 99 % | 100 % | 0 | none |

#### P6 · bytes at equal in-window SSIM, reduced ÷ full: median over probe windows

| group | band | all Q | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 | Q 56 | n |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| A | 0.9–1.1 | 1.00 | 0.98 | 0.96 | 1.01 | 1.04 | 1.02 | 1.01 | 0.99 | 0.98 | 1320 |
| B | 1.0–1.2 | 1.09 | 1.14 | 1.06 | 1.06 | 1.08 | 1.10 | 1.08 | 1.11 | 1.20 | 1166 |
| C | 0.9–1.1 | 1.00 | 0.98 | 0.96 | 1.01 | 1.02 | 1.04 | 1.04 | 0.99 | 0.94 | 1296 |
| content 2, 12-bit | – | 0.99 | 0.98 | 0.96 | 1.00 | 1.02 | 1.01 | 1.01 | 0.97 | 0.91 | 512 |
| content 2, 10-bit | – | 1.07 | 1.17 | 1.11 | 1.06 | 1.07 | 1.05 | 1.03 | 1.05 | 1.07 | 495 |
| rf_fluoro | – | 1.00 | 0.97 | 1.03 | 1.05 | 1.04 | 1.01 | 0.99 | 0.96 | 0.90 | 235 |
| mr_ispy1 | – | 0.98 | – | 0.83 | 0.90 | 0.94 | 1.04 | 1.00 | 0.99 | 1.36 | 217 |

#### P7 · share of (window, Q) comparisons 'reduced worse' at equal bytes, by system

| measure | A | B | C | separates | B ≥ A and C |
| --- | --: | --: | --: | --- | --- |
| ge1 | 0 % | 6 % | 1 % | yes | yes |
| ge2 | 0 % | 9 % | 1 % | yes | yes |
| ge4 | 0 % | 11 % | 1 % | yes | yes |
| max | 6 % | 9 % | 7 % | yes | yes |
| levels | 93 % | 93 % | 94 % | yes | **no** |
| ssim | 0 % | 9 % | 0 % | yes | yes |

### Per system, width and Q: §6's verdict

Each table cell: the share of windows that *show* · how many *lose detail* · windows read. Banding is not run, so a
"shows" here is not cleared of banding. The level count is reported beside every verdict, in P1 above.
`rows/preview-depth.report.md` is `preview_depth_report.py`'s full output (7 061 lines), and `rows/preview-depth.tsv`
holds every comparison. These tables and those of P1–P7 come from
[`preview_depth_verdict.py`](preview_depth_verdict.py) `rows/preview-depth.jsonl --pilot pilot/preview-depth.jsonl`.


**A** — shows · loses detail · windows (n/a: no bracketed reading)

| width | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 | Q 56 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | 99 % · 0 · 254 | 99 % · 0 · 254 | 100 % · 0 · 254 | 97 % · 0 · 254 | 94 % · 0 · 254 | 88 % · 0 · 254 | 91 % · 0 · 254 | 98 % · 0 · 254 |
| 64 | 99 % · 0 · 163 | 94 % · 0 · 163 | 100 % · 0 · 163 | 98 % · 0 · 163 | 100 % · 0 · 163 | 99 % · 0 · 163 | 99 % · 0 · 163 | 99 % · 0 · 163 |
| 128 | 96 % · 0 · 122 | 91 % · 0 · 122 | 90 % · 0 · 122 | 57 % · 0 · 122 | 30 % · 0 · 122 | 63 % · 0 · 122 | 96 % · 0 · 122 | 100 % · 0 · 122 |
| 256 | 95 % · 0 · 110 | 86 % · 0 · 110 | 84 % · 0 · 110 | 63 % · 0 · 110 | 66 % · 0 · 110 | 52 % · 0 · 110 | 42 % · 0 · 110 | 100 % · 0 · 110 |
| 512 | 90 % · 0 · 72 | 83 % · 0 · 72 | 92 % · 0 · 72 | 57 % · 0 · 72 | 71 % · 0 · 72 | 67 % · 0 · 72 | 74 % · 0 · 72 | 97 % · 0 · 72 |
| 1024 | 92 % · 0 · 52 | 85 % · 0 · 52 | 92 % · 0 · 52 | 62 % · 0 · 52 | 75 % · 0 · 52 | 81 % · 0 · 52 | 85 % · 0 · 52 | 96 % · 0 · 52 |
| presets | 100 % · 0 · 15 | 100 % · 0 · 15 | 100 % · 0 · 15 | 93 % · 0 · 15 | 87 % · 0 · 15 | 80 % · 0 · 15 | 100 % · 0 · 15 | 100 % · 0 · 15 |

**B** — shows · loses detail · windows (n/a: no bracketed reading)

| width | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 | Q 56 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | 69 % · 7 · 132 | 85 % · 0 · 132 | 90 % · 0 · 132 | 84 % · 0 · 132 | 87 % · 0 · 132 | 82 % · 5 · 132 | 86 % · 2 · 132 | 99 % · 0 · 132 |
| 64 | 67 % · 8 · 84 | 68 % · 0 · 84 | 80 % · 0 · 84 | 73 % · 2 · 84 | 62 % · 5 · 84 | 39 % · 5 · 84 | 46 % · 5 · 84 | 99 % · 0 · 84 |
| 128 | 65 % · 7 · 60 | 62 % · 0 · 60 | 82 % · 0 · 60 | 63 % · 5 · 60 | 67 % · 5 · 60 | 55 % · 5 · 60 | 48 % · 5 · 60 | 97 % · 0 · 60 |
| 256 | 0 % · 8 · 49 | 0 % · 0 · 49 | 78 % · 0 · 49 | 47 % · 5 · 49 | 55 % · 5 · 49 | 41 % · 5 · 49 | 51 % · 5 · 49 | 96 % · 0 · 49 |
| 512 | 10 % · 6 · 41 | 7 % · 0 · 41 | 73 % · 0 · 41 | 56 % · 5 · 41 | 44 % · 5 · 41 | 59 % · 5 · 41 | 71 % · 2 · 41 | 98 % · 0 · 41 |
| 1024 | 5 % · 0 · 37 | 0 % · 0 · 37 | 30 % · 0 · 37 | 49 % · 0 · 37 | 54 % · 0 · 37 | 68 % · 0 · 37 | 78 % · 0 · 37 | 97 % · 0 · 37 |
| presets | 20 % · 0 · 5 | 0 % · 0 · 5 | 100 % · 0 · 5 | 60 % · 0 · 5 | 60 % · 0 · 5 | 40 % · 0 · 5 | 60 % · 0 · 5 | 100 % · 0 · 5 |

**C** — shows · loses detail · windows (n/a: no bracketed reading)

| width | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 | Q 56 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | 99 % · 0 · 300 | 100 % · 0 · 300 | 99 % · 0 · 300 | 96 % · 0 · 300 | 97 % · 0 · 300 | 89 % · 0 · 300 | 92 % · 0 · 300 | 99 % · 0 · 300 |
| 64 | 98 % · 0 · 192 | 95 % · 0 · 192 | 97 % · 0 · 192 | 93 % · 0 · 192 | 99 % · 0 · 192 | 99 % · 0 · 192 | 100 % · 0 · 192 | 100 % · 0 · 192 |
| 128 | 97 % · 0 · 142 | 89 % · 0 · 142 | 87 % · 0 · 142 | 42 % · 0 · 142 | 31 % · 0 · 142 | 80 % · 0 · 142 | 94 % · 0 · 142 | 99 % · 0 · 142 |
| 256 | 96 % · 0 · 142 | 90 % · 0 · 142 | 71 % · 0 · 142 | 68 % · 0 · 142 | 58 % · 0 · 142 | 50 % · 0 · 142 | 35 % · 0 · 142 | 99 % · 0 · 142 |
| 512 | 95 % · 0 · 88 | 91 % · 0 · 88 | 80 % · 0 · 88 | 66 % · 0 · 88 | 61 % · 0 · 88 | 60 % · 0 · 88 | 61 % · 0 · 88 | 98 % · 0 · 88 |
| 1024 | 97 % · 0 · 60 | 88 % · 0 · 60 | 73 % · 0 · 60 | 62 % · 0 · 60 | 77 % · 0 · 60 | 72 % · 0 · 60 | 77 % · 0 · 60 | 95 % · 0 · 60 |
| presets | 100 % · 0 · 15 | 93 % · 0 · 15 | 100 % · 0 · 15 | 100 % · 0 · 15 | 93 % · 0 · 15 | 93 % · 0 · 15 | 87 % · 0 · 15 | 100 % · 0 · 15 |

**content 2, 12-bit** — shows · loses detail · windows (n/a: no bracketed reading)

| width | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 | Q 56 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | 98 % · 0 · 131 | 98 % · 0 · 131 | 100 % · 0 · 131 | 100 % · 0 · 131 | 99 % · 0 · 131 | 93 % · 0 · 131 | 94 % · 0 · 131 | 98 % · 0 · 131 |
| 64 | 97 % · 0 · 102 | 91 % · 0 · 102 | 97 % · 0 · 102 | 83 % · 0 · 102 | 98 % · 0 · 102 | 98 % · 0 · 102 | 100 % · 0 · 102 | 100 % · 0 · 102 |
| 128 | 97 % · 0 · 73 | 90 % · 0 · 73 | 88 % · 0 · 73 | 49 % · 0 · 73 | 34 % · 0 · 73 | 64 % · 0 · 73 | 92 % · 0 · 73 | 100 % · 0 · 73 |
| 256 | 98 % · 0 · 52 | 90 % · 0 · 52 | 88 % · 0 · 52 | 77 % · 0 · 52 | 63 % · 0 · 52 | 63 % · 0 · 52 | 44 % · 0 · 52 | 100 % · 0 · 52 |
| 512 | 100 % · 0 · 33 | 97 % · 0 · 33 | 85 % · 0 · 33 | 85 % · 0 · 33 | 64 % · 0 · 33 | 73 % · 0 · 33 | 88 % · 0 · 33 | 100 % · 0 · 33 |
| 1024 | 100 % · 0 · 23 | 96 % · 0 · 23 | 83 % · 0 · 23 | 74 % · 0 · 23 | 57 % · 0 · 23 | 57 % · 0 · 23 | 87 % · 0 · 23 | 100 % · 0 · 23 |
| presets | 100 % · 0 · 6 | 100 % · 0 · 6 | 100 % · 0 · 6 | 100 % · 0 · 6 | 100 % · 0 · 6 | 50 % · 0 · 6 | 100 % · 0 · 6 | 100 % · 0 · 6 |

**content 2, 10-bit** — shows · loses detail · windows (n/a: no bracketed reading)

| width | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 | Q 56 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | 77 % · 1 · 53 | 72 % · 0 · 53 | 87 % · 0 · 53 | 91 % · 0 · 53 | 96 % · 0 · 53 | 96 % · 0 · 53 | 100 % · 0 · 53 | 100 % · 0 · 53 |
| 64 | 68 % · 4 · 34 | 74 % · 0 · 34 | 76 % · 0 · 34 | 71 % · 0 · 34 | 74 % · 0 · 34 | 53 % · 0 · 34 | 50 % · 0 · 34 | 100 % · 0 · 34 |
| 128 | 65 % · 3 · 23 | 74 % · 0 · 23 | 83 % · 0 · 23 | 57 % · 0 · 23 | 78 % · 0 · 23 | 61 % · 0 · 23 | 43 % · 0 · 23 | 100 % · 0 · 23 |
| 256 | 0 % · 2 · 18 | 0 % · 0 · 18 | 94 % · 0 · 18 | 61 % · 0 · 18 | 72 % · 0 · 18 | 78 % · 0 · 18 | 83 % · 0 · 18 | 100 % · 0 · 18 |
| 512 | 0 % · 2 · 15 | 0 % · 0 · 15 | 80 % · 0 · 15 | 67 % · 0 · 15 | 53 % · 0 · 15 | 87 % · 0 · 15 | 100 % · 0 · 15 | 93 % · 0 · 15 |
| 1024 | 14 % · 0 · 14 | 0 % · 0 · 14 | 29 % · 0 · 14 | 57 % · 0 · 14 | 50 % · 0 · 14 | 86 % · 0 · 14 | 100 % · 0 · 14 | 86 % · 0 · 14 |
| presets | 0 % · 0 · 2 | 0 % · 0 · 2 | 100 % · 0 · 2 | 0 % · 0 · 2 | 0 % · 0 · 2 | 50 % · 0 · 2 | 100 % · 0 · 2 | 100 % · 0 · 2 |

**rf_fluoro** — shows · loses detail · windows (n/a: no bracketed reading)

| width | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 | Q 56 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | 100 % · 0 · 196 | 98 % · 0 · 196 | 94 % · 0 · 196 | 73 % · 0 · 196 | 53 % · 0 · 196 | 46 % · 0 · 196 | 65 % · 0 · 196 | 96 % · 0 · 196 |
| 64 | 100 % · 0 · 101 | 99 % · 1 · 101 | 82 % · 0 · 101 | 41 % · 0 · 101 | 73 % · 0 · 101 | 66 % · 1 · 101 | 80 % · 0 · 101 | 99 % · 1 · 101 |
| 128 | 100 % · 0 · 54 | 98 % · 1 · 54 | 96 % · 1 · 54 | 67 % · 0 · 54 | 30 % · 0 · 54 | 30 % · 0 · 54 | 67 % · 0 · 54 | 98 % · 1 · 54 |
| 256 | 100 % · 0 · 30 | 97 % · 1 · 30 | 93 % · 0 · 30 | 97 % · 0 · 30 | 63 % · 0 · 30 | 47 % · 0 · 30 | 40 % · 0 · 30 | 100 % · 0 · 30 |
| 512 | 100 % · 0 · 18 | 100 % · 0 · 18 | 94 % · 0 · 18 | 94 % · 0 · 18 | 61 % · 0 · 18 | 83 % · 0 · 18 | 56 % · 0 · 18 | 100 % · 0 · 18 |
| 1024 | 100 % · 0 · 12 | 100 % · 0 · 12 | 92 % · 0 · 12 | 92 % · 0 · 12 | 33 % · 0 · 12 | 67 % · 0 · 12 | 75 % · 0 · 12 | 100 % · 0 · 12 |
| presets | 100 % · 0 · 1 | 0 % · 0 · 1 | 100 % · 0 · 1 | 100 % · 0 · 1 | 100 % · 0 · 1 | 100 % · 0 · 1 | 100 % · 0 · 1 | 100 % · 0 · 1 |

**mr_ispy1** — shows · loses detail · windows (n/a: no bracketed reading)

| width | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 | Q 56 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 32 | n/a · 0 · 0 (36 n/a) | 83 % · 0 · 36 | 0 % · 1 · 36 | 0 % · 1 · 36 | 83 % · 2 · 36 | 94 % · 0 · 36 | 100 % · 0 · 36 | 86 % · 0 · 36 |
| 64 | n/a · 0 · 0 (22 n/a) | 100 % · 0 · 22 | 59 % · 0 · 22 | 0 % · 1 · 22 | 5 % · 3 · 22 | 82 % · 0 · 22 | 95 % · 0 · 22 | 95 % · 0 · 22 |
| 128 | n/a · 0 · 0 (14 n/a) | 100 % · 0 · 14 | 57 % · 0 · 14 | 0 % · 0 · 14 | 7 % · 3 · 14 | 14 % · 0 · 14 | 14 % · 0 · 14 | 100 % · 0 · 14 |
| 256 | n/a · 0 · 0 (10 n/a) | 100 % · 0 · 10 | 40 % · 0 · 10 | 0 % · 0 · 10 | 90 % · 0 · 10 | 60 % · 0 · 10 | 10 % · 0 · 10 | 90 % · 0 · 10 |
| 512 | n/a · 0 · 0 (8 n/a) | 100 % · 0 · 8 | 38 % · 0 · 8 | 0 % · 0 · 8 | 50 % · 0 · 8 | 62 % · 0 · 8 | 50 % · 0 · 8 | 75 % · 0 · 8 |
| 1024 | n/a · 0 · 0 (7 n/a) | 100 % · 0 · 7 | 29 % · 0 · 7 | 0 % · 0 · 7 | 100 % · 0 · 7 | 100 % · 0 · 7 | 100 % · 0 · 7 | 100 % · 0 · 7 |
| presets | n/a · 0 · 0 (1 n/a) | 100 % · 0 · 1 | 0 % · 0 · 1 | 0 % · 0 · 1 | 0 % · 0 · 1 | 0 % · 0 · 1 | 0 % · 0 · 1 | 100 % · 0 · 1 |
