# Preview noise: what sets the full-size preview's Q, and what its decode costs

*Row PREVIEWNOISE, 2026-11-07. Theory and the rule are written and pushed before any arithmetic of this row; the
arithmetic then reads committed rows only and encodes nothing. Before writing the theory this session had read the
summary prose of the three source documents (named in §Inputs), not computed anything from their rows. Arithmetic of
ours is* derived*; what no row or source holds is* unverified*.*

**The preview here** is only the tiny full-size one: a separate AV1 stream of the same frames at a high Q, at full
resolution (the owner set reduced-resolution previews aside; none is studied here).

## Verdict

*2026-11-07; arithmetic on committed rows only, no encode. Fixtures: the 20 METRICS series named in §Inputs for
Claim 1; the three timed DBT volumes `dbts_a1`, `dbts_b1`, `dbts_c1` (EA1141; A and C 12-bit, σ 13–18, ρ 0.11–0.13; B
10-bit, σ 4.4–6.7, ρ 0.18–0.27) for Claim 2. No breast ultrasound cine or ABUS exists in the fixtures.*

**Claim 1 — the preview's Q at 40–56 is set by the content, not the noise: refuted as pre-registered, on one clause;
in substance not decidable from these rows.**

1. The finest-band noise is gone at Q 40: e_N ÷ σ is 1.031–1.128 on all 14 DBT series, at G 1 and at G 16 (§2.1).
2. At Q 56 it is 1.033–1.228, and `dbts_b1` (1.212) and `dbts_b3` (1.228) pass P1's upper edge of 1.20. So the rule
   says refuted. The excess is error in that band beyond the noise, which means fine structure is lost too. That is
   the direction the claim itself expects, so the clause's upper edge tested the wrong thing. This is stated here, and
   the label is not changed after the fact.
3. In absolute bits the noise costs nothing at high Q. Within system C and within B, the slope of bpp on log₂ σ₁₀ at
   Q 40 · 56 is 0.038 · 0.019 (C) and 0.041 · 0.007 (B) of its value at Q 4: held. Pooled over the 14 DBT series, the
   Q 4 slope is −0.05, so there is no reference and the pooled clause is not decidable.
4. In proportion, the high-Q bytes still follow σ. The elasticity of bytes on σ is +1.11 · +0.49 pooled at Q 40 · 56,
   against −0.10 at Q 4 (*post hoc*, §2.3). These rows cannot tell whether that is noise surviving in coarser bands or
   content that varies with σ. DBT's noise is spatially correlated, and σ sees the finest band only (METRICS §4.4).
5. Bytes ÷ HTJ2K rises with σ (ρ +0.74), where P3 predicted it would fall: refuted. Across systems its denominator
   follows depth (B is 10-bit) more than σ.

**Claim 2 — AV1 decode cost follows the pixel count more than the bytes: held, in the form these rows can test (time
does not follow bytes at a fixed pixel count). "Follows the pixel count" itself is not decidable.**

1. SNR rows, G 1, the same frames in the same block and round. The VL stream at Q 8 has 8.7–11.3× the bytes of the
   Q 24 preview and decodes in 0.93–1.07× its time (β −0.034 to +0.030). At Q 4 it has 17.6–34.7× the bytes for
   1.21–1.85× the time (β 0.07–0.17). Every interval is narrow (§3.1).
2. Profiles rows, in their own browser and decoder build. At G 1 the coarser rung decodes *slower*: Q 32 keyframes take
   1.38× (`dbts_a1`) and 2.07× (`dbts_c1`) the time of Q 16's, and Q 56 takes 1.56× Q 32's on `dbts_b1`. So
   time does not follow bytes, but the work per pixel is not fixed either: it rises with Q. P7's linear model is
   refuted (§3.2).
3. Each volume has one pixel count, so proportionality to pixels is not tested.

**What would change it.** Claim 1: a noise measure in the coarser bands, or a content measure, that separates
item 4's two readings; and shard 3's seven series, which would give system A within-system rows and B a fifth volume.
Claim 2: a Q 40–56 preview timed as SNR timed Q 24. The profiles rows suggest that at G 1 it decodes no faster than
Q 24, and perhaps slower.

**Owed.** The two measures above. A Q 40–56 rung in the SNR pin (it is missing, and this row did not encode it). The
cause of the slower high-Q keyframes, likely the loop filters (*unverified*). Every reader verdict.

## Terms

* **VL view** — the visually lossless AV1 view, for scrolling, cine and diagnosis; here METRICS' noise anchor, Q 4–8
  on DBT (`lab/av1/metrics/README.md` §Quality metrics, measured, on `claude/av1-quality-metrics`). A measured anchor,
  not a reader's verdict.
* **Preview** — an optional smaller picture before the VL view; here the same frames at a high Q, full size.
* **Residual** — exact − decoded view (+ offset), coded HTJ2K lossless. Not used by this row.
* **G** — frames per keyframe; G 1 codes each frame alone. **Q** — libaom's quantizer, 0–63, held fixed per stream
  (`--min-q = --max-q = --cq-level`, `aomenc_args` in `lab/av1/profiles/bytes.py`).
* **Systems A, B, C** — the three DBT scanners of EA1141: A and C 12-bit, B 10-bit.
* **σ** — a frame's own noise in the finest band (METRICS §4.4, Immerkær's Laplacian with edges left out and
  rounding taken out); **e_N** — the coding error in that same band. **σ₁₀** — σ on a 10-bit scale: σ · 1023 ÷ peak,
  so σ ÷ 4.003 on a 12-bit series (*derived*; it puts the series on the scale on which one Q means one step, see §1a).
* **bpp** — coded bits per pixel of the stream: 8 × Σ unit bytes ÷ (frames × width × height).
* **Bytes ÷ HTJ2K** — the lossy cell's bytes over the series' HTJ2K lossless control, METRICS' column.
* **HTJ2K-frame unit** — a decode time ÷ the median HTJ2K frame decode of its own block's control (SNR's unit).

## Inputs, pinned

| what | where | commit |
| --- | --- | --- |
| METRICS rows: per (series, form, Q, G) every frame's bytes, σ, e_N, PSNR, SSIM, MS-SSIM, displayed levels, JOD | `lab/av1/metrics/rows/shard-{1,2,4}.jsonl` on `origin/claude/av1-quality-metrics` | `db633cc9` |
| SNR rows: per (volume, G, rung, arm, round, op) every frame's decode ms; the pin's unit sizes | `lab/av1/delivery/snr/results/shard-{1,2}.jsonl`, `pin.json` on `origin/claude/av1-snr-preview` | `eb7e19c4` |
| profiles decode rows: per block, (series, rung, unit) per-round medians | `lab/av1/profiles/rows/decode-shard-{1…6}.json`, `decode-pooled.txt` on `origin/claude/av1-quality-profiles` | `1232918d` |
| profiles bytes rows: per (series, form, Q, G) unit sizes | `lab/av1/profiles/results/cells.jsonl`, same branch | `1232918d` |

**Series with METRICS cells: 20.** Shard 3 pushed its series and control rows but no cell (`dbts_a3`, `dbts_a4`,
`dbts_a5`, `dbts_b4`, `dbt10_d`, `rf_fluoro`, `us_liver`), so 27 is not reached. The 20: DBT system A `dbts_a1`,
`dbts_a2`; B `dbts_b1`, `dbts_b2`, `dbts_b3`, `dbts_b5`; C `dbts_c1` … `dbts_c5`; content-2 DBT `dbt10_ea1141`,
`dbt12_ea1141`, `dbt12_c`; TRUS sweeps `ustrus_1`, `ustrus_2`; breast MR controls `mr_ispy1`, `mr9_ispy2`; and the
lossy-sourced cine `usb_cine`, `usb_cine_rgb`, in no verdict (METRICS §2: "their source was a lossy video, whose
quantizer already removed the noise"). **No breast ultrasound cine or ABUS exists in the fixtures**, so nothing here
speaks for them. METRICS' ladder holds **Q 40 and Q 56** inside 40–56; Q 32 is read beside them, Q 4 and Q 8 as the
low-Q reference.

## 1 · Theory

### 1a · Claim 1 — at Q 40–56 the preview's Q is set by the content, not by the noise

The owner's claim: at a high Q the quantizer has already removed the series' noise, so what decides how high Q may go
for a preview is the anatomy and its edges, not how noisy the series is.

**Why it should hold.** A residual coefficient survives quantization only when it exceeds about half the quantizer
step. White noise of σ spreads over every transform coefficient at about σ each (an orthonormal transform keeps σ,
*derived*). So once the step Δ(Q) at a block is several σ, the noise coefficients round to zero, the block is coded as
a prediction plus the few large coefficients that edges and anatomy produce, and the bits spent no longer depend on σ.
At a low Q, Δ < σ: the noise is coded, and each doubling of σ costs about one more bit per noise coefficient (the
Gaussian rate at fixed distortion, ½ log₂(σ² ÷ D) per sample, rises 1 bit per doubling of σ; *derived*). Libaom's step
grows with Q, and its 12-bit tables are its 10-bit tables × about 4 (*unverified* against `av1/common/quant_common.c`
at v3.15.1, not read here), which is why σ is compared on the 10-bit scale, σ₁₀.

**What it predicts, and what it does not.**

* **P1 — the noise band is emptied.** If the decoded picture holds none of the source's finest-band noise, the coding
  error in that band *is* the noise, so e_N ÷ σ ≈ 1 (a little above, for lost fine structure). METRICS saw e_N ÷ σ
  "saturate near 1.04" above Q 8 (its §For the owner). Predicted at Q 40 and Q 56, median frame, every sound series
  with a usable σ: **0.95 ≤ e_N ÷ σ ≤ 1.20**.
* **P2 — bytes stop following σ.** Across series, the slope of bpp against log₂ σ₁₀ is about **+1 bit per doubling at
  Q 4** (the noise coded) and **under a quarter of that at Q 40 and Q 56**. Measured pooled over the 14 DBT series, and
  within system C (5 volumes) and system B (4), because the systems differ in σ, depth, frame size and anatomy at once
  and a pooled slope mixes them.
* **P3 — bytes ÷ HTJ2K at Q 40–56 falls with σ.** Not because the content changes: HTJ2K lossless codes the noise, so
  its bytes rise with σ (about 1 bit a pixel per doubling, the same argument), and a numerator that ignores σ over a
  denominator that grows with it falls. So the column the task names carries σ through its denominator; read alone it
  would look like noise setting the preview, and it does not test the claim. Predicted: Spearman ρ(σ₁₀, bytes ÷ HTJ2K)
  < 0 at Q 40 and Q 56 over the DBT series.
* **P4 — the pixel metrics.** Where the noise is removed, the error carries it: in-window e² ≈ σ_full² + s², s the
  content lost. So PSNR at Q 40–56 is predicted to *fall* with σ (more noise removed is more error counted), and is no
  measure of the content lost; MS-SSIM, which weights the third scale where noise has averaged down
  (METRICS §4.6), is predicted to follow σ much less: |ρ(σ₁₀, PSNR)| > |ρ(σ₁₀, −10 log₁₀(1 − MS-SSIM))| at Q 40 and 56.
  These rows hold σ only in the finest band, not σ_full, so s cannot be separated; P4 is reported, and the verdict
  does not rest on it.
* **What these rows cannot show.** They hold no measure of the content itself (edge density, anatomy). "Set by the
  content" can be reached only by elimination: if σ does not move the bytes at Q 40–56 and the series still differ,
  something else does. The verdict says *by elimination* where it says it.

**Rule, Claim 1.** **Held** if P1 holds on every sound DBT series and P2's slope at Q 40 and at Q 56 is under 0.25 of
Q 4's pooled and within C and within B (same sign or zero). **Refuted** if P1 fails on any sound DBT series, or P2's
slope at Q 40 or Q 56 is ≥ 0.5 of Q 4's pooled or within C or B. **Not decidable** otherwise, saying which. TRUS and
breast MR are reported beside it (their σ is near one 8-bit or 9–11-bit step, METRICS §1, so their σ₁₀ sits where P1's
argument is weakest); the lossy-sourced cine is shown and judged nowhere.

### 1b · Claim 2 — AV1 decode cost follows the pixel count more than the bytes

**Why it should hold.** An AV1 decoder does two kinds of work per frame: symbol decoding, then reconstruction and
the in-loop filters (*derived*; not checked here against the text of the AV1 specification,
<https://aomediacodec.github.io/av1-spec/>, so *unverified* as a reading of it):

* **per symbol** — the arithmetic decoder reads every coded bit once: cost ∝ bytes, b · B;
* **per pixel** — prediction (intra or motion-compensated), inverse transform of every transform block, deblocking,
  CDEF, loop restoration, film grain if any, and the output copy and back-conversion: cost ∝ pixels, a · P, with a
  depending on the tools the encoder turned on, and somewhat on Q (larger, skipped blocks at a high Q filter less).

So at equal pixels **t = a · P + b · B** (*derived*). The claim says the first term dominates. It cannot hold at every
Q: at Q 0 the bytes are HTJ2K's or more and row SPEED measured lossless AV1 at 5.4–8.1× OpenJPH. The question is
where the crossover a · P = b · B falls, and whether the full-size preview sits well on the pixel side.

**Predicted** (from SNR's §3d prediction, which RESIDAPART's medians gave: CRF 20 1.31–1.38, CRF 8 2.03–2.31, CRF 2
3.5–4.2 HTJ2K frames, *derived* there): between the preview Q 24 and the VL view at Q 8, bytes grow 10–15×, time
1.3–1.8×.

* **P5 — the elasticity.** β = ln(t_VL ÷ t_preview) ÷ ln(B_VL ÷ B_preview), per volume, per-frame decode, G 1 (every
  unit a keyframe on both sides, so no difference in the kind of frame), the `two` arm of the SNR rows (the preview
  stream and the VL stream timed in the same block and round, the same frames). Predicted **β 0.10–0.25** at Q 24 → Q 8.
* **P6 — the pixel share.** From the two points, a · P = t_p − b · B_p with b = (t_VL − t_p) ÷ (B_VL − B_p); the pixel
  share a · P ÷ t at each rung. Predicted **≥ 0.8 at the preview (Q 24)**, **0.4–0.7 at Q 8**, lower at Q 4.
* **P7 — the same in the profiles rows**, in their own browser and decoder build only (Chromium 141, the client's SIMD
  dav1d-WASM; never pooled with SNR's Chromium 153 and the lab's operating-point build): S1 in order ÷ H across Q 8,
  16, 32 on `dbts_a1` and `dbts_c1` (12-bit streams), Q 16, 32, 56 on `dbts_b1` (10-bit), bytes from the bytes run's
  unit sizes of the same streams. Predicted: β under 0.35 between the two coarser rungs of each volume, larger toward
  the finest; t linear in B within each volume (three points, the middle within 10 % of the chord).
* **At G > 1** the kind of frame changes with Q (profiles D2: at Q 8 a predicted frame costs more than a keyframe, at
  the coarsest rungs much less), so G 8 and 16 are reported and not read for the verdict.

**Rule, Claim 2.** On the SNR rows at G 1, Q 24 against Q 8 and against Q 4: **held** if β ≤ 0.25 on every volume at
Q 24 → Q 8 (bytes several-fold, time barely moving, the task's own test) and the pixel share at Q 24 is ≥ 0.75;
**refuted** if β ≥ 0.5 on any volume at Q 24 → Q 8, or the pixel share at Q 24 is under 0.5; **not decidable**
otherwise. Q 4 is reported as where the claim is expected to weaken, and P7 corroborates or contradicts in its own
rows. Each ratio is per round inside one block (one host, one browser), its median over rounds with the
distribution-free 95 % interval of the median (order statistics, as SNR's rule), so no millisecond leaves its block.

**What these rows cannot show.** Every series in them is one pixel count per volume: the SNR and profiles rows never
code one volume at two sizes. "Follows the pixel count" is therefore read as "does not follow the bytes, at fixed
pixels"; proportionality to pixels across sizes is *not decidable* here, and the three volumes differ in size
(2.04 · 8.52 · 2.45 Mpx a frame) and in content at once, so a cross-volume ms-per-Mpx comparison is reported only as a
check, inside one block.

### 1c · Measurement rules as they apply

Interleaving: every ratio above pairs arms that ran interleaved in one block and round (SNR's Williams order; the
profiles' Williams rows); no before/after. No new test or code is added that would need a mutation: the arithmetic is a
script in the scratch space whose every number is reproduced in the tables, and the hand check (§2) re-derives one
cell per claim from the raw rows. *Corrected after the theory was pushed:* the scripts were committed after all, in
[`lab/av1/preview_noise/`](../../lab/av1/preview_noise/) with their outputs, and each was broken once on purpose (§4). Saturation: both timed sources ran one decode in flight, one thread, one of four
cores (their sections); nothing is claimed past 1×. Latency only: every time is per-frame decode latency; no
throughput is quoted.

## 2 · Claim 1, measured (2026-11-07)

**Method card.**

* **Input:** METRICS' rows `lab/av1/metrics/rows/shard-{1,2,4}.jsonl` at `db633cc9` (`origin/claude/av1-quality-metrics`),
  the 20 series of §Inputs, every frame. Each series is read in its **stored form**: the 12-bit stream for a 12-bit
  series, the series' own depth otherwise. The fixtures come from `lab/av1/fetch_data.sh`.
* **Encode:** `aomenc` libaom 3.15.1, METRICS §3's command: `--good --cpu-used=6 --threads=1 --end-usage=q
  --cq-level=Q --min-q=Q --max-q=Q --deltaq-mode=0 --aq-mode=0 --denoise-noise-level=0 --lag-in-frames=0
  --auto-alt-ref=0 --tune=psnr`, `--kf-max-dist=0` at G 1 and `--kf-min-dist=G --kf-max-dist=G` otherwise
  (`aomenc_args` in `lab/av1/profiles/bytes.py`). The control is HTJ2K lossless (`ingest_coded.py --codec htj2k`).
* **Decoder:** native dav1d 1.5.4, `--threads=1` (METRICS' `cell.py`). No clock is read by this claim.
* **Bytes:** Σ of the IVF temporal-unit sizes (`units`); the HTJ2K control is Σ of its frames. bpp = 8 × bytes ÷
  (frames × width × height).
* **Metrics:** per frame as METRICS computed them. **e_N ÷ σ** is each frame's `err_noise_band` over that frame's σ;
  then the median frame. **PSNR** is the median frame at peak 2^b − 1. **MS-SSIM dB** is −10 log₁₀(1 − MS-SSIM) at the
  median frame. **σ₁₀** is the median frame's σ × 1023 ÷ (2^b − 1). **Slope** is the OLS slope over series of bpp on
  log₂ σ₁₀. **ρ** is Spearman's rank correlation over series. Script:
  [`claim1.py`](../../lab/av1/preview_noise/claim1.py); every row it prints is in
  [`results/claim1-g1.md`](../../lab/av1/preview_noise/results/claim1-g1.md) and `claim1-g16.md`.
* **Host:** METRICS' four-core, 15 GB shard hosts made the rows. This step is arithmetic in this session's container.

### 2.1 · P1: the noise band at Q 40 and 56

e_N ÷ σ, median frame, stored form, at G 1 and G 16. The band is 0.95–1.20.

| family (series) | Q 40, G 1 | Q 56, G 1 | Q 40, G 16 | Q 56, G 16 |
| --- | --- | --- | --- | --- |
| DBT A (`dbts_a1`, `dbts_a2`) | 1.031–1.052 | 1.033–1.056 | 1.031–1.052 | 1.031–1.054 |
| DBT B (`dbts_b1`, `b2`, `b3`, `b5`) | 1.054–1.092 | 1.096–**1.228** (`b1` 1.212, `b3` 1.228) | 1.081–1.084 | 1.133–**1.228** (`b1` 1.212, `b3` 1.228) |
| DBT C (`dbts_c1` … `c5`) | 1.058–1.092 | 1.062–1.094 | 1.058–1.092 | 1.060–1.093 |
| content-2 DBT (`dbt10_ea1141`, `dbt12_ea1141`, `dbt12_c`) | 1.041–1.123 | 1.046–1.188 | 1.039–1.128 | 1.041–1.183 |
| TRUS (`ustrus_1`, `ustrus_2`) | 1.535–1.619 | 1.568–1.710 | 1.539–1.624 | 1.569–1.714 |
| breast MR (`mr_ispy1`, `mr9_ispy2`) | 1.056 · 1.610 | 1.055 · 1.604 | 1.057 · 1.607 | 1.060 · 1.605 |
| lossy-sourced cine, in no verdict (`usb_cine`, `usb_cine_rgb`) | 4.281 · 1.428 | 8.565 · 1.694 | 4.444 · 1.470 | 8.460 · 1.708 |

**P1 holds at Q 40 on all 14 DBT series** at both G. **At Q 56 it fails on `dbts_b1` and `dbts_b3`**: the rule's
refuting clause. Above 1 the error in the band exceeds the noise: the decoded picture has lost the noise and some fine
structure with it. The noise is not kept, so the failure does not contradict "already removed".
It does say that on system B at Q 56 the coding error in the finest band is a fifth larger than the noise. TRUS and
`mr9_ispy2` sit at 1.46–1.71 from Q 32 up. Their σ is near one step of their depth (σ₁₀ 6.6 on an 8-bit scale is 1.65
8-bit codes; `mr9_ispy2` 0.79 9-bit codes), so their fine band holds as much structure as noise.

### 2.2 · P2, P3, P4: bytes and metrics against σ

G 1, stored form. The slope is bits a pixel per doubling of σ₁₀. "÷ Q 4's" divides it by the same group's Q 4 slope.
At G 16 every sign and every held or failed clause is the same (`claim1-g16.md`).

| group | Q | slope bpp | ÷ Q 4's | ρ(σ₁₀, bpp) | ρ(σ₁₀, bytes ÷ HTJ2K) | ρ(σ₁₀, PSNR) | ρ(σ₁₀, MS-SSIM dB) |
| --- | --: | --: | --: | --: | --: | --: | --: |
| DBT, 14 | 4 | −0.051 | 1 | +0.03 | +0.91 | +0.03 | +0.28 |
| DBT, 14 | 40 | +0.011 | −0.22 | +0.58 | +0.74 | −0.58 | −0.16 |
| DBT, 14 | 56 | +0.002 | −0.04 | +0.32 | +0.74 | −0.34 | −0.38 |
| system C, 5 | 4 | +0.263 | 1 | +0.30 | +1.00 | +0.10 | +0.10 |
| system C, 5 | 40 | +0.010 | **0.038** | +0.80 | +0.40 | −0.80 | −0.30 |
| system C, 5 | 56 | +0.005 | **0.019** | +0.70 | +0.30 | −0.90 | −0.70 |
| system B, 4 | 4 | +0.097 | 1 | +0.40 | +0.80 | +0.40 | +0.40 |
| system B, 4 | 40 | +0.004 | **0.041** | +0.40 | +1.00 | −0.40 | +0.20 |
| system B, 4 | 56 | +0.001 | **0.007** | +0.20 | +1.00 | −0.40 | −0.20 |
| sound, 18 (with TRUS, MR) | 4 | +0.335 | 1 | +0.48 | +0.96 | −0.05 | +0.20 |
| sound, 18 | 40 | +0.031 | 0.094 | +0.74 | +0.75 | −0.34 | −0.01 |
| sound, 18 | 56 | +0.008 | 0.024 | +0.50 | +0.69 | −0.25 | −0.18 |

* **P2, within systems: held.** At Q 40 and 56 the bits a doubling of σ costs are 0.7–4.1 % of their Q 4 value, in C
  and in B. **Pooled over 14 DBT: not decidable.** The Q 4 slope is −0.05: across systems σ₁₀ goes with depth, frame
  size and tissue share at once, and no reference slope is left. The predicted size, +1 bit a doubling at Q 4, is
  **refuted**: 0.26 (C), 0.10 (B), −0.05 pooled. Two reasons are in the rows. At Q 4 part of the fine-band noise is
  already gone (e_N ÷ σ 0.35–0.61). And background pixels dilute bpp: the tissue share is 0.34–0.71 of a frame (§2.3).
* **P3: refuted.** Bytes ÷ HTJ2K rises with σ, ρ +0.74 at Q 40 and 56. Across systems the HTJ2K denominator does not
  grow with σ₁₀: system B has the highest σ₁₀ and the fewest lossless bits, because it is 10-bit. Within C, where depth
  is fixed, ρ falls to +0.40 · +0.30.
* **P4: held at Q 40, not at Q 56.** |ρ(σ, PSNR)| > |ρ(σ, MS-SSIM dB)| at Q 40 (0.58 against 0.16), not at Q 56 (0.34
  against 0.38), pooled over DBT. P4 carries no verdict (§1a).

### 2.3 · Post hoc, not in the verdict: per tissue pixel, and in proportion

Two readings the rule did not name, added because §2.2 left the pooled clause without a reference.

**Per tissue pixel.** Bits ÷ the samples METRICS counts in the first window (its `codes[0].n`, median frame at
Q 40). The Q 4 slope then comes out as the theory said: +0.79 pooled over DBT, +1.19 in C, +0.86 in B. The Q 40 · 56
slopes are 3.6 · 0.7 % of it pooled, 2.1 · 1.1 % in C and 1.8 · 0.3 % in B. In absolute bits, then, the noise costs
almost nothing at high Q on every grouping.

**In proportion.** The elasticity d ln bpp ÷ d ln σ₁₀ (OLS over series), per frame pixel:

| group | Q 4 | Q 8 | Q 32 | Q 40 | Q 56 |
| --- | --: | --: | --: | --: | --: |
| DBT, 14, G 1 | −0.10 | +0.69 | +1.21 | +1.11 | +0.49 |
| system C, 5, G 1 | +0.34 | +1.16 | +1.49 | +1.66 | +2.03 |
| system B, 4, G 1 | +0.14 | +0.59 | +0.28 | +0.36 | +0.20 |
| DBT, 14, G 16 | −0.16 | +0.63 | +1.67 | +1.53 | +0.77 |

The high-Q bytes are tiny: 0.0027–0.0113 bpp at Q 56 on DBT, against 0.77–1.70 at Q 4. Even so, the noisier series
spend proportionally more of them, and pooled and in C more steeply than at Q 4. The within-C slopes are fragile.
σ₁₀ spans only 3.23–3.95 there, and `dbts_c4` sits at the top of it: it is the narrowest frame (662 px), with the
highest Q 56 bpp (0.0045 against 0.0027–0.0033). Without it, C's elasticity is +1.71 · +1.66 · +0.62 at Q 4 · 40 · 56,
so Q 40 is no steeper than Q 4.
These rows cannot say whether the extra bytes are noise surviving in a coarser band or anatomy. σ here sees only the
finest band, and DBT's noise is spatially correlated (METRICS §4.4: noise blurred by 1 px reads 0.67 of its σ). This
is item 4 of §Verdict, and it is why the claim is **not decidable in substance**.

## 3 · Claim 2, measured (2026-11-07)

### 3.1 · SNR rows

**Method card.**

* **Input:** `lab/av1/delivery/snr/results/shard-{1,2}.jsonl` and `pin.json` at `eb7e19c4`. Rounds 0–19; `dbts_b1` · G 1
  has 19, because shard 2's two `VOID` blocks are dropped as SNR's `rule.py` drops them; mutation rows are left out.
  Fixtures: `dbts_a1`, `dbts_b1`, `dbts_c1`.
* **Encode:** `aomenc` libaom 3.15.1 with `aomenc_args` (above) at Q 24 (the preview) and Q 4 or Q 8 (the VL view).
  The input is the top 10 bits on A and C (p = min((v + 2) ≫ 2, 1023)), B as stored; G 1, 8, 16
  (`snr_content.py`, SNR §5a).
* **Decoder:** dav1d 1.5.4 (`54706fc6`), the client's `simd` dav1d-WASM build under the lab's operating-point wrapper
  (`lab/av1/delivery/scalable/two-layer/dav1d_wrap_op.c`), op 0, one thread. Headless Chromium 153.0.8010.12 at 1×.
* **Clock:** `performance.now()` before and after `dec.decode(u)`, one unit at a time. All the stream's units run in
  order on one fresh decoder (`pass()` in `snr.js`). It ends when the picture's samples are in one array. The VL
  pass's residual is timed apart and left out here.
* **Bytes:** the pin's unit sizes; the median unit of each stream.
* **Metrics:** per round, the median frame's ms of arm `two`'s VL pass over its preview pass. They are the same block
  and round, the same frames and one browser. The median over rounds comes with its distribution-free 95 % interval
  (order statistics: the 6th and 15th of 20). **β** = ln(time ratio) ÷ ln(bytes ratio). **HTJ2K frames** is the median
  over rounds of the pass's median frame ÷ the block's `ctrl` median HTJ2K frame. The **pixel share** is 1 − b · B ÷ t,
  with b from the two-point line; it is meaningless where b < 0. Script:
  [`claim2.py`](../../lab/av1/preview_noise/claim2.py), output
  [`results/claim2-snr.md`](../../lab/av1/preview_noise/results/claim2-snr.md).
* **Host:** both shards ran on an Intel Xeon @ 2.10 GHz, 4 cores, 15–15.7 GB (SNR §Shards). One decode was in flight,
  one thread, one core of four. The host does not saturate; nothing is claimed past 1×.

| volume | G | VL Q | n | bytes, VL ÷ preview | time, VL ÷ preview [95 %] | β [95 %] | preview · VL, HTJ2K frames | pixel share, preview · VL |
| --- | --: | --: | --: | --: | --- | --- | --- | --- |
| `dbts_a1` | 1 | 8 | 20 | 10.5 | 1.072 [1.016–1.116] | 0.030 [0.007–0.047] | 1.79 · 1.94 | 0.99 · 0.93 |
| `dbts_b1` | 1 | 8 | 19 | 8.7 | 0.930 [0.867–0.956] | −0.034 [−0.066 to −0.021] | 1.70 · 1.55 | b < 0 |
| `dbts_c1` | 1 | 8 | 20 | 11.3 | 1.054 [1.022–1.097] | 0.022 [0.009–0.038] | 1.74 · 1.85 | 0.99 · 0.94 |
| `dbts_a1` | 1 | 4 | 20 | 34.7 | 1.847 [1.805–1.893] | 0.173 [0.166–0.180] | 1.52 · 2.78 | 0.97 · 0.53 |
| `dbts_b1` | 1 | 4 | 19 | 17.6 | 1.210 [1.177–1.315] | 0.066 [0.057–0.096] | 1.76 · 2.12 | 0.99 · 0.82 |
| `dbts_c1` | 1 | 4 | 20 | 31.3 | 1.535 [1.462–1.591] | 0.124 [0.110–0.135] | 1.43 · 2.21 | 0.98 · 0.64 |
| `dbts_a1` · `b1` · `c1` | 8 | 8 | 20 | 24.8 · 14.9 · 26.2 | 1.394 · 1.262 · 1.508 | 0.103 · 0.086 · 0.126 | | |
| `dbts_a1` · `b1` · `c1` | 16 | 8 | 20 | 25.6 · 15.0 · 26.8 | 1.350 · 1.323 · 1.566 | 0.093 · 0.103 · 0.136 | | |
| `dbts_a1` · `b1` · `c1` | 8 | 4 | 20 | 83.4 · 30.2 · 73.9 | 1.960 · 1.607 · 1.953 | 0.152 · 0.139 · 0.156 | | |
| `dbts_a1` · `b1` · `c1` | 16 | 4 | 20 | 86.0 · 30.3 · 75.8 | 1.899 · 1.638 · 1.953 | 0.144 · 0.145 · 0.155 | | |

**Against the rule: held.** At G 1, Q 24 → Q 8, β is −0.034 to +0.030 on every volume (≤ 0.25, with every interval
under 0.05). The pixel share at Q 24 is 0.98–1.01 (≥ 0.75). **P5** predicted β 0.10–0.25; it is **refuted low** at
Q 8: time moved less than predicted. **P6** at Q 8 predicted a share of 0.4–0.7 and measured 0.93–0.94: **refuted**,
for the same reason. On `dbts_b1` the Q 8 keyframe decodes 7 % faster than the Q 24 one, with 8.7× the bytes, so the
two-point line has a negative slope and the share is meaningless there. G 8 and 16 are reported, not read: the VL
pass's predicted frames cost differently from the preview's (§1b). There, too, β is ≤ 0.16 everywhere.

The preview's first picture is reported beside this, not read. Its median is 1.7–2.2 HTJ2K frames (SNR §SNR preview,
measured). The VL view's first picture (carrier `one`) is 1.6–2.2 at Q 8, with 13.7–9.5× the bytes (84.5–468 kB
against 6.16–49.5 kB).

### 3.2 · Profiles rows, in their own browser and decoder build

**Method card.**

* **Input:** `lab/av1/profiles/rows/decode-shard-{1…6}.json` at `1232918d` (`origin/claude/av1-quality-profiles`).
  These are six blocks, one host each, with 15 · 24 · 22 · 13 · 11 · 23 rounds. Units: S1, S8, S16 through
  dav1d-WASM in order at 1×, the middle 16 slices (`dbts_a1` 20–35, `dbts_b1` 17–32, `dbts_c1` 26–41). Rows that
  failed a check or carry an error are dropped (none did).
* **Encode:** `aomenc` 3.15.1 with `aomenc_args`, the **12-bit stream** on A and C (`--profile=2 --bit-depth=12`) and
  B's 10-bit stream; Q 8, 16, 32 (A, C) and Q 16, 32, 56 (B).
* **Decoder:** the client's `built("dav1d")` SIMD dav1d-WASM, one thread, `max_frame_delay` 1. Headless Chromium
  141.0.7390.37 at 1×. **It is not pooled with §3.1**: another browser, another wrapper, another input depth on A
  and C.
* **Clock:** per frame, the codestream handed in to the samples written, back-conversion included (profiles §7).
* **Bytes:** each frame's bytes in the rows; the median frame of each stream.
* **Metrics:** per block and round, ln(median frame ms at the finer rung ÷ at the coarser rung) for the same series and
  G. Each block takes the median over its rounds. The pool is exp of the mean of the 6 block medians, with a 95 % *t*
  interval at 5 df (profiles §7's pooling). **β** as in §3.1. Script:
  [`claim2_profiles.py`](../../lab/av1/preview_noise/claim2_profiles.py), output
  [`results/claim2-profiles.md`](../../lab/av1/preview_noise/results/claim2-profiles.md).
* **Host:** Intel Xeon at 2.1–2.8 GHz, 4 cores, 16 GB per block. One decode was in flight, one thread; the host does
  not saturate at 1×.

| volume | G | rung → finer | bytes ratio | time ratio [95 %, 6 blocks] | β |
| --- | --: | --- | --: | --- | --: |
| `dbts_a1` | 1 | Q 32 → 16 | 3.20 | 0.726 [0.693–0.761] | −0.275 |
| `dbts_a1` | 1 | Q 16 → 8 | 6.10 | 1.482 [1.441–1.524] | 0.217 |
| `dbts_b1` | 1 | Q 56 → 32 | 7.33 | 0.642 [0.624–0.661] | −0.222 |
| `dbts_b1` | 1 | Q 32 → 16 | 4.43 | 0.881 [0.851–0.912] | −0.085 |
| `dbts_c1` | 1 | Q 32 → 16 | 3.88 | 0.483 [0.462–0.504] | −0.537 |
| `dbts_c1` | 1 | Q 16 → 8 | 6.13 | 1.342 [1.303–1.381] | 0.162 |
| `dbts_a1` · `b1` · `c1` | 8 | coarsest → middle | 5.59 · 17.82 · 8.05 | 1.186 · 1.591 · 1.348 | 0.099 · 0.161 · 0.143 |
| `dbts_a1` · `b1` · `c1` | 8 | middle → finest | 10.37 · 7.78 · 9.33 | 1.161 · 1.252 · 1.126 | 0.064 · 0.110 · 0.053 |
| `dbts_a1` · `b1` · `c1` | 16 | coarsest → middle | 5.84 · 17.72 · 7.98 | 1.245 · 1.595 · 1.332 | 0.124 · 0.163 · 0.138 |
| `dbts_a1` · `b1` · `c1` | 16 | middle → finest | 10.36 · 7.75 · 9.56 | 1.159 · 1.250 · 1.128 | 0.063 · 0.109 · 0.053 |

**P7: β under 0.35 held, linearity refuted.** At G 1 the time is not monotone in the bytes. The coarsest rung decodes
slowest: Q 32 keyframes cost 1.38× (`dbts_a1`) and 2.07× (`dbts_c1`) Q 16's, and Q 56 keyframes cost 1.56× Q 32's on
`dbts_b1`. Then the finest rung costs more again (Q 8: 1.34–1.48× Q 16). So the model t = a · P + b · B with a fixed
is wrong: the per-pixel work a itself rises with Q. The likeliest cause is the in-loop filters, whose strength the
encoder raises with the quantizer (*unverified*: these rows do not hold the per-frame filter levels). At G 8 and 16
the order is monotone and β is 0.05–0.16.

**What it means for a Q 40–56 preview** (*derived*, not measured: SNR's pin has no Q 40–56 stream, and this row
encoded none). At G 1 the bytes give the preview no decode advantage over Q 16–32, and system B's Q 56 keyframe costs
more than its Q 32 one. A Q 40–56 preview should decode in about the time of the Q 24 preview, 1.7–2.2 HTJ2K frames,
or more. It is cheap in bytes, not in decode.

## 4 · Checks

* **By hand**, by scripts that import neither `claim1.py` nor `claim2.py`. `dbts_c1`, Q 40, G 1, 12-bit stream,
  straight from `shard-4.jsonl`: bpp 0.007096, e_N ÷ σ 1.0786, σ₁₀ 3.2272. The table has 0.0071, 1.079, 3.227.
  `dbts_a1`, G 1, Q 8, arm `two`, straight from `shard-{1,2}.jsonl` and `pin.json`: n 20, median 1.0723, 6th and
  15th 1.0157 and 1.1161, bytes 10.50. The table has 1.072 [1.016–1.116], 10.5.
* **Broken on purpose.** `claim1.py` without the 10-bit scaling (σ in its own depth's units) turns the pooled DBT
  slopes negative at every Q (Q 40 −0.0056, ρ(σ, bpp) −0.62). So the scaling carries the pooled reading, which is one
  more reason the pooled clause is not read. `claim2.py` with the VL pass of round k paired with the preview of round
  k + 1 keeps the medians within 0.02 but widens every interval: `dbts_c1` Q 4 from 0.129 to 0.211, `dbts_a1` Q 4
  from 0.088 to 0.218. So the round pairing is what makes the intervals narrow.
* **Interleaving.** Every time ratio compares two arms or two rungs from one block and round, run in Williams orders.
  No sequential before/after was measured.
* **Saturation.** In both timed sources one decode was in flight on one thread, using one core of four. Nothing is
  claimed past 1×, for concurrent decodes, WebCodecs, another host or a phone.
* **Gate.** `scripts/gate.sh --quick --no-browser` stopped at its prerequisites: this container has no built
  `client/transport/wasm/pkg`. So it did not run. The change is docs, three arithmetic scripts and their outputs;
  `scripts/comment_budget.sh` passes.
