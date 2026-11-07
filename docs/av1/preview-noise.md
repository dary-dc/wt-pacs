# Preview noise: what sets the full-size preview's Q, and what its decode costs

*Row PREVIEWNOISE, 2026-11-07. Theory and the rule are written and pushed before any arithmetic of this row; the
arithmetic then reads committed rows only and encodes nothing. Before writing the theory this session had read the
summary prose of the three source documents (named in §Inputs), not computed anything from their rows. Arithmetic of
ours is* derived*; what no row or source holds is* unverified*.*

**The preview here** is only the tiny full-size one: a separate AV1 stream of the same frames at a high Q, at full
resolution (the owner set reduced-resolution previews aside; none is studied here).

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

**Why it should hold.** An AV1 decoder does two kinds of work per frame (AV1 spec §7, decoding process, *derived*
from its structure: symbol decoding, then reconstruction and the in-loop filters):

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
cell per claim from the raw rows. Saturation: both timed sources ran one decode in flight, one thread, one of four
cores (their sections); nothing is claimed past 1×. Latency only: every time is per-frame decode latency; no
throughput is quoted.
