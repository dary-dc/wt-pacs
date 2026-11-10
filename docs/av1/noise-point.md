# The VL view's quantizer, set from each series' noise

Row NOISEPOINT, written 2026-11-07. This is theory plus a protocol, and nothing new was coded or timed. §3 is
arithmetic on rows the quality study already measured (`lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl`, the 20 series it
covers), so every number in it is labelled *derived from the rows*. §8 is the protocol a later session runs.

## Verdict

**Claim.** Set the VL view's Q from one number per series, σ_min: the lowest noise of any of its frames, measured
with the quality study's Immerkær estimator. The candidate Q is the **highest Q at which AV1's AC quantizer step, in
sample units, is less than x\* · σ_min**, where x\* = **4.93 at G 1 and 4.64 at G 8 and 16**. The rule makes a
*candidate* Q. It does not make that Q visually lossless: only a reader can say so (the study's §6 flicker test, not
run).

**Proof chain.**
1. The anchor the rule reproduces is the study's anchor (a) by noise: e_N ≤ σ on every frame
   (`lab/av1/metrics/README.md` §5).
2. *Derived* (§2). When the fine band holds white noise, the coding error in that band over the noise, e_N ÷ σ,
   depends only on the step over the noise, x = Δ ÷ σ. Here Δ = ac_q(qindex(Q), stream depth) ÷ 8, and libaom's
   source gives both the factor 8 and the tables.
3. *Derived from the rows* (§3). At low Q, e_N matches Δ ÷ √12 to within 10 % at 8, 10 and 12 bits. Over every
   frame of the 14 DBT series, e_N ÷ σ lies on one curve of x for systems A, B and C and content 2. It first goes
   above 1 at x 4.93 (G 1) and 4.64 (G 16), and it is still at or below 1 on some frames up to x 6.69.
4. *Derived from the rows* (§3). In sample, the rule never picks a Q above the measured anchor. It matches the anchor
   on 20 of 23 (series, form) cells at G 1 and on 17 of 23 at G 16, and picks one rung lower on the rest. With one
   family left out at a time, it overshoots by one rung on 1 cell at each G. The worst frame there is e_N ÷ σ 1.005
   and 1.000, inside the estimator's own 3 % error.

**Valid for:** the DBT fixtures only. These are the 14 DBT series of the 20 the study covers: `dbts_a1`, `a2`, `b1`,
`b2`, `b3`, `b5`, `c1` … `c5`, `dbt10_ea1141`, `dbt12_ea1141`, `dbt12_c`. Within them, σ_min ranges over 10.5–14.8
on 12 bits and 3.4–5.6 on 10 bits. The rule does not hold for TRUS: the DBT x\* picks one rung too high on
`ustrus_2`. It does not hold for MR, whose curve crosses 1 near x 15. It gives no Q at all on lossy-sourced input.
There is no breast ultrasound cine or ABUS among the fixtures.

**What would change it:**
* a held-out DBT series whose rule Q has a worst frame above e_N ÷ σ 1.03 (§8, P1);
* a reader study that finds the noise anchor visible;
* breast ultrasound data, which needs its own x\*.

**Owed:**
* the held-out test (§8) on shard 3's five uncoded DBT series;
* a timing of the estimator on `dbts_a1`, `dbts_b1` and `dbts_c1`;
* Q values between the ladder rungs;
* a tile-level reading of how noise varies by region;
* an x\* for each modality the fixtures lack;
* the §6 flicker test.

## Terms

Defined here for this file, in the brief's words.

* **VL view.** The visually lossless AV1 view, used for scrolling, cine and diagnosis.
* **Residual.** Exact − decoded view (+ offset), coded HTJ2K lossless.
* **G.** Frames per keyframe.
* **Q.** libaom's quantizer (`--cq-level`, 0–63).
* **PCS.** The separate service that receives, parses and encodes studies before this PACS serves them.
* **σ, e_N, in-window.** As `lab/av1/metrics/README.md` §Terms defines them. σ is a frame's noise in the 3 × 3
  Laplacian's band, and e_N is the coding error in that same band.
* **σ_min.** The lowest σ over a series' frames.
* **Δ.** `av1_ac_quant_QTX(qindex, 0, depth) ÷ 8`: the AC step in sample units at the stream's depth.
* **x.** Δ ÷ σ, both in stream units.
* **B.** The stream's depth (8, 10 or 12). It can differ from the series' depth b: 9 bits go into a 10-bit stream
  and 11 bits into a 12-bit stream, unshifted (`lab/av1/profiles/bytes.py` `forms`).

## 1 · The question, and what binds it

Two designs lead. One is the VL view plus a whole HTJ2K frame. The other is the VL view plus an HTJ2K residual. Each
has one choice that depends on the noise: the VL view's Q. The quality study found the coding error reaches each
series' own noise at Q 8 on systems B and C, and at Q 4 on A (`lab/av1/metrics/README.md` §Quality metrics,
measured). It also found two series with no noise anchor at any rung: `usb_cine` and `mr9_ispy2` at G 1. This file
asks four things:

* how to turn a series' measured noise into that Q;
* what breaks the rule;
* what the PCS must measure to use it, and at what cost;
* how a later session confirms it.

**What binds the answer:**
* **No threshold exists to adopt.** The study found none in the literature for AV1 on 10–12-bit DBT. So x\* below is
  read from the rows, never set by hand.
* **The anchor is a fine-band reading, not visibility.** At e_N = σ the band's noise rises by √2 (study §5 a,
  *derived*; *corrected 2026-11-10*: only if the error is independent of the noise; at the anchor the quantizer removes
  noise and the band's noise falls, [`noise-ratio.md`](noise-ratio.md) §2.3). Above the anchor, e_N ÷ σ levels off near 1.04, because the noise has been removed (study §8). So the
  anchor marks the last Q that keeps part of the noise. That is what the rule targets, and nothing more.
* **MQSA.** A lossy DBT stream is never the interpreted frame in the US (study §1, quoting
  `docs/av1/visually-lossless.md` §1). The VL view's diagnostic use is a licensing question, and this file does not
  answer it.

## 2 · Why one number per series should suffice (*derived*)

AV1 dequantizes with one step per qindex and depth. libaom 3.15.1 states the scale of those tables
(`av1/common/quant_common.c`,
<https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/common/quant_common.c>):

> "Regardless of the bit-depth of the input, the transform stages scale the coefficient values up by a factor of 8
> (3 bits) over the scale of the pixel values. […] All quantizers are built using this invariant of x8, 3-bit
> scaling, thus the Q3 suffix."

It also states that large transforms are an exception at quantization but not after it: "the dequantized/decoded
coefficients, even for large TX blocks, are always effectively Q3". The mapping from `--cq-level` to qindex is a table
in `av1/encoder/av1_quantize.c` (same tag, <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/av1_quantize.c>):
"static const int quantizer_to_qindex[] = { 0, 4, 8, 12, 16, 20, …, 240, 244, 249, 255, };". So qindex = 4Q for
Q ≤ 61. This holds under the study's knobs (`--min-q = --max-q = Q`, `--deltaq-mode=0`, `--aq-mode=0`), with every
`--q-hist` entry at Q.

The step in sample units is therefore Δ = ac_q(4Q, B) ÷ 8. Take white noise of variance σ² in the fine band. It
spreads evenly over an orthonormal transform's coefficients (profiles README §1b), so every coefficient sees the same
Δ ÷ σ. This gives three cases:
* If Δ ≪ σ, the noise coefficients are quantized uniformly, so e_N ≈ Δ ÷ √12.
* If Δ ≫ σ, they are zeroed, so e_N → σ.
* In between, e_N ÷ σ = h(Δ ÷ σ): one curve, the same for every series, whatever the depth or content.

Depth enters only through the table, and 10 against 12 bits needs no case of its own. The curve breaks down where
the fine band carries structure or noise that is not white: speckle, MR reconstruction, a source codec's artefacts.

**The low-Q end, checked against the rows.** The table compares Δ ÷ √12 with the median frame's e_N at G 1, stored
form. The series are the 12-bit DBT (`dbts_a1`, `a2`, `c1`–`c5`, `dbt12_c`, `dbt12_ea1141`), the 10-bit DBT
(`dbts_b1`, `b2`, `b3`, `b5`, `dbt10_ea1141`) and the 8-bit TRUS (`ustrus_1`, `ustrus_2`). Ranges run over those
series.

| B | Q | ac_q(4Q) | Δ | Δ ÷ √12 | e_N, rows |
| --: | --: | --: | --: | --: | --- |
| 12 | 1 · 2 · 4 | 35 · 75 · 183 | 4.38 · 9.38 · 22.9 | 1.26 · 2.71 · 6.60 | 1.28–1.30 · 2.56–2.60 · 6.29–6.53 |
| 10 | 1 · 2 · 4 | 16 · 27 · 55 | 2.00 · 3.38 · 6.88 | 0.58 · 0.97 · 1.98 | 0.63–0.64 · 1.00–1.02 · 1.96–2.05 |
| 8 | 1 · 2 · 4 | 11 · 15 · 23 | 1.38 · 1.88 · 2.88 | 0.40 · 0.54 · 0.83 | 0.40 · 0.55–0.56 · 0.81–0.82 |

At low Q the coding error depends on depth and Q and on nothing else, to within 10 %. The worst case is 10-bit Q 1,
at +10 %.

## 3 · The rows, re-read (*derived from the rows*)

Each point below is one frame of one cell. Its x is Δ ÷ that frame's σ, and its y is e_N ÷ σ. The cells are G 1, in
the stored form and, for 12-bit series, the top-10 form. In the top-10 form, σ and e_N are divided by 4 and B = 10.
Each entry is the median and the 5th–95th percentile.

| x | system A | system B | system C | content-2 DBT | TRUS | MR controls |
| --- | --- | --- | --- | --- | --- | --- |
| 0.9–1.0 | 0.30 (0.29–0.31) | 0.28 (0.28–0.30) | 0.29 (0.28–0.31) | 0.30 (0.28–0.31) | 0.28 (0.26–0.29) | — |
| 1.6–2 | 0.54 (0.47–0.57) | 0.56 (0.56–0.57) | 0.51 (0.46–0.56) | 0.49 (0.46–0.55) | 0.49 (0.44–0.56) | — |
| 3–4 | 0.96 | — | 0.92 (0.87–0.95) | 0.93 (0.86–0.95) | 0.86 (0.75–0.97) | 0.45 (0.44–0.94) |
| 4–5 | 0.99 (0.97–1.00) | 0.96 (0.92–1.00) | 0.97 (0.94–1.00) | 0.96 (0.95–0.98) | 1.02 (0.94–1.11) | 0.46 (0.45–1.01) |
| 5–6 | 1.00 (0.99–1.02) | 1.02 (1.02–1.03) | 1.03 (1.00–1.04) | 0.98 (0.97–1.05) | 1.15 (1.05–1.25) | 1.12 |
| 6–10 | 1.04 (1.02–1.06) | 1.03 (1.00–1.04) | 1.06 (1.04–1.09) | 1.06 (1.01–1.09) | 1.32 (1.19–1.42) | 0.77 (0.60–1.16) |
| > 10 | 1.05 (1.02–1.07) | 1.05 (1.03–1.22) | 1.07 (1.05–1.10) | 1.07 (1.02–1.10) | 1.54 (1.41–1.89) | 1.06 (0.91–1.63) |

**DBT collapses onto one curve.** The four DBT families agree within their spreads at every x. This holds across
12-bit (A, C, `dbt12_*`) and 10-bit (B, `dbt10_ea1141`) data, and across a neighbour-slice noise correlation ρ of
0.11–0.13 (A, C) and 0.18–0.27 (B) (`docs/av1/frame-groups.md`, median ρ at the best offset). TRUS follows the
same curve up to x 3, then rises earlier and keeps rising past 1. MR follows another curve altogether.

**Where it crosses 1, over every DBT frame:**

| G | lowest x with e_N > σ (x\*) | from | highest x with e_N ≤ σ (x_hi) |
| --: | --: | --- | --: |
| 1 | 4.929 | `dbts_c1`, top-10 form, Q 8 | 6.689 |
| 8, 16 | 4.636 | `dbts_b1`, Q 12 | 6.693 |

Inter coding lowers x\* by 6 %. A G 16 group predicts from frames the quantizer has already denoised. That fits
profiles §1b's Δ ≫ σ case, but it is *unverified* as the cause.

**The rule against the measured anchors.** The rule is: pick the highest ladder rung with Δ ÷ σ_min < x\*. The
series is the 14 DBT series above, in the stored form and, for 12-bit series, the top-10 form.

| G | cells | rule = anchor | a rung lower | a rung higher |
| --: | --: | --: | --: | --: |
| 1 | 23 | 20 | 3: `dbt10_ea1141` (8 for 12), `dbt12_ea1141` 12-bit and top-10 (4 for 8) | 0 |
| 8 | 23 | 17 | 6: those three, plus `dbts_c1` 12-bit and `dbts_c5` 12-bit and top-10 (4 for 8) | 0 |
| 16 | 23 | 17 | the same 6 | 0 |

In sample, the rule never overshoots. That is guaranteed, because x\* is the smallest failing x. The real test is
a family left out:

| G | family left out | x\* from the other three | that family's cells overshot |
| --: | --- | --: | --- |
| 1 | A · B · content 2 | 4.929 | none |
| 1 | C | 4.998 | `dbts_c1` top-10 at Q 8 (worst frame e_N ÷ σ 1.005) |
| 16 | A · C · content 2 | 4.636 | none |
| 16 | B | 4.957 | `dbts_b1` at Q 12 (worst frame 1.000) |

Both overshoots sit within the estimator's 3 % error on integer frames of known σ (study §4.4). So the rule
reproduces the anchor across families. It does not reproduce the anchor across modalities.

**What the coarse ladder costs.** When the rule falls a rung short, the bytes jump. On `dbt12_ea1141`, G 1, Q 4
takes 0.288 of HTJ2K's bytes where the anchor, Q 8, takes 0.097. On `dbt10_ea1141` the figures are 0.216 at Q 8
against 0.126 at Q 12. Every miss lies in the band x\* ≤ x < x_hi, where a frame can go either way. That is the case
for the confirm step in §4 and for Q values between rungs (§8 P3).

## 4 · The rule

The PCS runs it once per series, before it encodes the VL view.

1. **Is the series in scope?** If its source was lossy (§5.5), or its modality has no calibrated x\*, there is no
   noise-set Q. Flag the series and stop.
2. **σ_min**, in stream units. It is the lowest `quality.sigma` over the series' frames, in-window by its first
   header window. For a top-10 form, divide by 2^(b − 10).
3. **Candidate Q:** the highest Q in 0 … 61 with ac_q(4Q, B) ÷ 8 < x\*_G · σ_min. Here x\*_G is 4.9293 at G 1 and
   4.6359 at G > 1, for DBT. Both are the exact minima (4.92935, 4.63596) truncated to four decimals; rounding up to
   4.636 would let `dbts_b1`'s own failing cell through. If not even Q 1 qualifies, there is no noise anchor (§5.1).
4. **Confirm at the edge.** If the next Q up has x < x_hi (6.69), the series is in the band where a frame can go
   either way. The PCS encodes that Q as well, and keeps it if e_N ≤ σ on every frame. For the residual design this
   check is nearly free: the PCS already holds exact − decoded, and e_N is that difference through the same
   Laplacian (`quality.noise_band`).
5. **Record** in the series' metadata: σ_min, the frame it comes from, x at the chosen Q, and whether step 4 ran.

The rule on the ladder needs the σ_min at which each rung becomes reachable (*derived* from the libaom tables and
x\*; G 1, then G > 1). Steps 1–3 need nothing more.

| B | Q 1 | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 | Q 32 |
| --: | --- | --- | --- | --- | --- | --- | --- | --- |
| 12 | 0.89 · 0.94 | 1.90 · 2.02 | 4.64 · 4.93 | 11.6 · 12.3 | 19.1 · 20.3 | 26.6 · 28.3 | 41.3 · 43.9 | 71.0 · 75.4 |
| 10 | 0.41 · 0.43 | 0.68 · 0.73 | 1.39 · 1.48 | 3.09 · 3.29 | 4.95 · 5.26 | 6.77 · 7.20 | 10.4 · 11.0 | 17.8 · 18.9 |
| 8 | 0.28 · 0.30 | 0.38 · 0.40 | 0.58 · 0.62 | 0.99 · 1.05 | 1.39 · 1.48 | 1.80 · 1.91 | 2.64 · 2.80 | 4.46 · 4.75 |

The 8-bit row holds only for white noise, and no 8-bit DBT is among the fixtures. On TRUS the rows say it is one rung
too high.

## 5 · Edge cases

**5.1 No measurable noise.** `usb_cine` has σ 0.27–0.41 and `mr9_ispy2` has σ 0.56–0.93. For both, x at Q 1 is
above x\*, so the rule returns no Q. That matches the anchor: neither has one at G 1. A σ near √(1/12) = 0.29 is
rounding, not acquisition noise. The estimator's checks reach σ 0.25 and no lower (study §4.4), and the estimator
subtracts that rounding share itself. So a series whose σ_min is below the Q 1 entry of §4's table has no noise to
hide error in. The rule declines to set a Q. Choosing one for such a series is the owner's call, and this file does
not invent one: the lowest rung, HTJ2K alone, or a Q from the study's scrolling anchor (b). The PCS reports the flag.

**5.2 Very high noise.** Higher σ_min allows higher Q: on 12 bits, σ_min 26.6 reaches Q 16. Two cautions:
* e_N looks only at the finest band. Above the anchor, the error grows in the coarser bands, where structure lives,
  and e_N cannot see it. On every DBT fixture, the noise anchor sits at or below the PSNR knee (study §Per series:
  A 4 against 8; B 8–12 against 8–12; C 8 against 8). So the fixtures never ask the rule to go past the knee.
* No fixture has σ_min above 14.8 on 12 bits or 5.6 on 10 bits. The rule is not claimed beyond those values.

§8 P5 runs a noise-raised arm to test the encoder side. It cannot stand in for real high-noise acquisitions.

**5.3 Noise that varies by slice.** Across the DBT series, the highest σ over the lowest σ is:
* 1.01–1.08 on B (for example, `dbts_b2` 3.36–3.40);
* 1.17–1.33 on A (`dbts_a2` 10.8–14.3);
* 1.21–1.24 on C.

On TRUS the ratio is 2.7–4.8 (`ustrus_1` 0.79–3.78). σ_min is the right input because the anchor is per frame. The
cost is that most frames are coded finer than their own noise needs. Near Q 8, one integer step of Q moves Δ by
13–16 %. On DBT, therefore, a per-frame σ would gain up to two integer steps on the noisiest frames, and never a
ladder rung (*derived*). A per-frame Q is a structural change to the encode, and the data gives no reason to
make it.

**5.4 Noise that varies by region.** σ is one number per frame, taken over in-window samples. Quantum noise grows
with signal, so a region quieter than the frame mean gets error above its own noise even when e_N ≤ σ overall. The
rows cannot show how large that effect is, because no tile-level σ or e_N was kept. §8 P4 measures it. AV1's
segment-level delta-q could follow it, but the study's knobs turn delta-q off, and nothing here proposes turning it
on.

**5.5 Lossy-sourced input.** A lossy source's quantizer has already removed the acquisition noise. What is left is
its own artefacts, and the curve no longer applies. `usb_cine`'s y reaches 2.62 (median, x > 10). The rule must not
run on such input. DICOM records the history:

> "Lossy Image Compression (0028,2110) … Specifies whether an Image has undergone lossy compression (at a point in its
> lifetime). Enumerated Values: 00 Image has not been subjected to lossy compression. 01 Image has been subjected to
> lossy compression. Once this Attribute has been set to a Value of "01" it shall not be reset."
> — DICOM PS3.3 C.7.6.1, <https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.html>

The attribute is Type 3 there (optional), so its absence proves nothing. The PCS checks three things:
* the attribute;
* a lossy transfer syntax on receipt;
* σ_min below the Q 1 entry, which catches `usb_cine` but would miss `usb_cine_rgb`, whose σ 0.78–1.10 is the
  source codec's leftovers.

Whether the three cine fixtures carry the attribute is *unverified*; §8 P6 reads it.

**5.6 10 against 12 bits, and the depths in between.** These need no case of their own (§2): Δ comes from the
stream's table, and σ is measured in stream units. A 9-bit series in a 10-bit stream, or an 11-bit series in a
12-bit stream, uses the stream's table with σ unshifted. A top-10 form uses the 10-bit table with σ ÷ 4. The rule
agrees with the anchor on the top-10 forms in sample (§3).

## 6 · Which σ estimator, and why

The two studies estimated σ differently:
* the bytes run used a wavelet MAD (`lab/av1/profiles/noise.py`: the finest diagonal Haar detail, median |d| ÷
  0.6745, per frame);
* the quality study used Immerkær's Laplacian (`lab/av1/metrics/quality.py` `sigma`: mean |I ∗ N|, edges left out,
  rounding taken off).

**The rule uses Immerkær's, for three reasons:**
1. **It matches the anchor's band.** x\* was calibrated against e_N, the error through the same Laplacian. The MAD
   reads a different band. Its ratio to Immerkær's σ is not a constant, so it cannot be divided out: on DBT it runs from
   1.08 (`dbts_b1`, `dbt12_c`) to 1.44 (`dbt10_ea1141`), and it is 1.97 on `mr_ispy1` (*derived from the rows*: `noise.jsonl` against the
   series rows).
2. **It holds on integer data.** On integer frames the MAD comes only in steps of 0.5 ÷ 0.6745 = 0.741, and it is
   within 10 % only from σ 4 up (profiles README, its σ check). That leaves system B at the edge and reads
   `usb_cine` as 0.00. Immerkær's estimator reads within 3 % from σ 0.25 up, on smooth and edge scenes alike
   (study §4.4, checked and mutated).
3. **It resolves the low end.** §5.1's rule needs to tell σ 0.3 from σ 0.9. The MAD's 0.741 steps cannot.

**Its limits, inherited:**
* It sees the finest band only. Noise blurred by a 0.5 px Gaussian reads 66 % of its σ (study §4.4). So σ here is
  not the total noise, and the rule never claims it is.
* Its primary text is *unverified*: the publisher refused (study [M3]).

## 7 · What the PCS measures at ingest, and its cost

**What it measures:**
* σ per frame, by `quality.sigma` on the stored values, in-window by the first header window (all samples if the
  series has none). σ_min is the minimum.
* B and the form, from Bits Stored and the chosen form.
* The lossy history, as §5.5 describes.
* The modality, to pick its x\*.
* e_N per frame at the candidate Q, when §4 step 4 runs.

**Cost (*derived*, not timed).**
* The study's shard plan charges 0.3 CPU s a megapixel for a whole series row. In its words: "controls 4.4
  (lossless AV1 4.1, the series row 0.3)" (`lab/av1/metrics/README.md` §Shards). That row computes σ, the neighbour
  steps and every window's display moves. σ alone costs less, but the plan does not say how much less, and nothing
  has timed σ apart from the rest: *unverified*.
* Using 0.3 CPU s/Mpx as the ceiling, one core spends at most:

  | series | Mpx | CPU s |
  | --- | --: | --: |
  | `dbts_a1` | 114 | 34 |
  | `dbts_c1` | 169 | 51 |
  | `dbts_b1` | 426 | 128 |

* Against that, the lossy encode costs 3.4–6.0 CPU s/Mpx summed over the ten rungs, in the stored and top-10 forms (study §8): roughly half a rung's
  encode, on average.
* Step 4 adds one encode, and only on series in the band where a frame can go either way.
* For the residual design, the e_N check reuses the residual. For the whole-frame design, it needs a decode of the
  VL view. Decode, measurement and y4m together came to 0.27 CPU s/Mpx in the study's pilot.

§8 P2 times σ.

## 8 · Protocol, pre-registered

Run unchanged. On the study's host, if it is the same class: 4 cores, 15 GB, four cells in flight, one thread each.
Claim nothing past that host.

Use the study's tools as they stand: libaom 3.15.1 at cpu6 with `aomenc_args` unchanged, dav1d 1.5.4, `cell.py`
`series_row` and `measure`, and `checks.py`, run first. Take Δ from `av1_ac_quant_QTX` at libaom v3.15.1.

**Before running, check that libaom's AC tables are the AV1 specification's `Ac_Qlookup`**
(<https://aomediacodec.github.io/av1-spec/>, §Dequantization functions), entry by entry. Mutate the check by moving
one entry, and confirm the check fails.

**Fixtures:**
* **Held out.** Shard 3's five DBT series: `dbts_a3`, `a4`, `a5`, `dbts_b4`, `dbt10_d`. Their series rows, and so
  their σ, are already in `rows/shard-3.jsonl`, but no cell was coded. Their predictions are below, written before
  any encode.
* **Timed.** `dbts_a1`, `dbts_b1`, `dbts_c1` (EA1141). Systems A and C are 12-bit, with noise σ 13–18 and ρ
  0.11–0.13. System B is 10-bit, with σ 4.4–6.7 (`b4` and `b5` 1.9–2.4, as the brief gives them; *unverified*
  against these rows, which read `b4` 5.6 and `b5` 3.6–3.7 on Immerkær's estimator) and ρ 0.18–0.27.
* **Excluded.** No breast ultrasound cine or ABUS exists among the fixtures, so the protocol says nothing of them.

**Pre-registered predictions,** stored form, from σ_min in the shard-3 rows.

| series | B | σ_min | ladder Q, G 1 · G 16 | edge band (step 4 runs at) | Q in 0 … 61, G 1 · G 16 |
| --- | --: | --: | --- | --- | --- |
| `dbts_a3` | 12 | 12.76 | 8 · 8 | no (Q 12 at x 7.38) | 8 · 8 |
| `dbts_a4` | 12 | 13.16 | 8 · 8 | no (Q 12 at x 7.15) | 8 · 8 |
| `dbts_a5` | 12 | 10.91 | 4 · 4 | yes, Q 8 at x 5.23 | 7 · 7 |
| `dbts_b4` | 10 | 5.56 | 12 · 12 | yes, Q 16 at x 6.00 | 13 · 12 |
| `dbt10_d` | 10 | 3.89 | 8 · 8 | yes, Q 12 at x 6.26 | 9 · 9 |

**The arms.** On each held-out series, at G 1 and G 16, in the stored form, encode four Q values:
* the ladder rung below the rule's;
* the rule's rung;
* the two ladder rungs above it;
* the in-between Q from the last column, and that Q + 1.

Report each frame's e_N ÷ σ, the bytes ÷ HTJ2K, and the measured anchor (study §5 a). That is 12 encodes a series,
about 8 000 CPU s with their measurement across the 867 Mpx of the five series (*derived* from the study's §8 costs,
about 0.6 h on 4 cores).

**Decision rules.** 1.03 is the estimator's own error on integer frames of known σ (study §4.4), so a frame within
it cannot be told from 1.

* **P1 · The rule holds across series.** It holds if the worst frame at the rule's ladder Q is at or below 1.03 on
  every held-out cell. It is refuted by any cell above 1.03. Then x\* is recomputed with the held-out frames
  included, by §3's definition, and the rule is re-read in sample. No new bar is set.
* **P2 · Cost, measured.** On `dbts_a1`, `dbts_b1` and `dbts_c1`, time `quality.sigma` over all frames, and over
  every fourth frame. Interleave the two in a Williams order, five rounds (`lab/scripts/order.py`), CPU s, medians.
  Every fourth frame is adopted if it gives the same candidate Q (§4 step 3) on all 23 in-sample cells and all 5
  held-out ones. The decision rests on the rule's output, not on a σ tolerance.
* **P3 · Q between rungs.** h(x) is continuous (§2), so the in-between Q should hold too. It holds under P1's rule
  on every held-out cell, and the bytes it saves against the ladder Q are reported. It is refuted as P1 is. If it is
  refuted, the PCS keeps ladder rungs.
* **P4 · Region, reported.** On `dbts_a1`, `dbts_b1` and `dbts_c1`, at their rule Q, take e_N and σ over 64 × 64
  tiles that lie wholly in-window. Report the share of tiles above 1.03, the tiles' σ against their mean signal, and
  where the tiles above 1.03 sit. This arm is reported, not decided: whether a regional excess calls for a regional
  Q is a design question for the owner, and the rule makes no claim on it.
* **P5 · Encoder side at high noise.** On `dbts_c1`'s middle 8 frames, add white Gaussian noise so that σ_min
  becomes 2× and 4× its own value. Round, clip and re-measure σ. Then run the rule and the ladder around its Q. P5
  holds under P1's rule. It tests §2's curve beyond the fixtures' σ and nothing else: it is not real high-noise
  acquisition.
* **P6 · Lossy-history fields.** For `usb_cine`, `usb_cine_rgb` and `us_liver`, read (0028,2110), (0028,2112),
  (0028,2114) and the transfer syntax from the fetched headers. Report which of §5.5's three tests flags each. No
  verdict.
* **Mutations, one per new reading:**
  * Δ taken from the 8-bit table on a 12-bit stream: P1's predictions move by two or more rungs, and the run must
    see that.
  * σ_min replaced by the median σ: `dbts_a2`'s in-sample cell must overshoot.
  * The tile mask shifted by one tile: P4's share must change.

**When to report.** Commit P1–P6 together, with every cell, including any that miss. Do not change anything above
this section.

## Sources

Read 2026-11-07.

* libaom v3.15.1, `av1/common/quant_common.c` (the Q3 scaling comment; `ac_qlookup_QTX`, `_10_`, `_12_`) and
  `av1/encoder/av1_quantize.c` (`quantizer_to_qindex`):
  <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/common/quant_common.c>,
  <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/av1_quantize.c>.
* DICOM PS3.3 §C.7.6.1 and its §C.7.6.1.1.5:
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.html>.
* The AV1 specification, §Dequantization functions: <https://aomediacodec.github.io/av1-spec/>. It is cited for
  §8's table check and was not re-read here.
* The quality study, `lab/av1/metrics/README.md` (§4.4, §5, §8, §Shards, §Quality metrics, measured), with its
  sources [M3] and [M4] as it gives them. Its rows are `lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl`.
* The bytes run, `lab/av1/profiles/README.md` (§1b, its σ check) and `lab/av1/profiles/results/noise.jsonl`.

The §3 arithmetic, for a re-run. For every cell, every frame, in the stored and top-10 forms: x = ac_q(4Q, B) ÷ 8 ÷
σ_frame and y = `err_noise_band` ÷ σ_frame, with both divided by 4 and B = 10 for the top-10 form. x\* is the smallest
x with y > 1 over the DBT series at that G, and x_hi is the largest x with y ≤ 1.

## Noise-point protocol, measured

Row NOISERUN, run 2026-11-09 on `claude/av1-noise-point`, from commit `972269c4` (§8 as pre-registered; nothing above
this section changed). **Fixtures:** DBT from EA1141: systems A and C 12-bit, B 10-bit, and content-2 `dbt10_d`
10-bit. No breast ultrasound cine or ABUS exists in the fixtures, so nothing here speaks for them.

### Verdict

**Claim.** On the five held-out DBT series of shard 3 (`dbts_a3`, `a4`, `a5`, `dbts_b4`, `dbt10_d`), the rule picked
the predicted Q on all 10 (series, G) cells, and the worst frame at that Q is 0.888–0.969 ÷ σ: **P1 holds, 10 of 10**.
The in-between Q holds too (worst 0.888–0.981, **P3 holds, 10 of 10**) and saves 14–57 % of the bytes on 3 of the 5
series. σ on every fourth frame is **not adopted** (P2): it moves `dbts_b1` at G 16 from Q 8 to Q 12. The host-side
cost of σ on every frame is 0.05–0.09 CPU s/Mpx.

**Proof chain.**
1. libaom v3.15.1's AC tables equal the AV1 specification's `Ac_Qlookup`, all 768 entries; the check fails when one
   entry moves. qindex = 4Q for Q 0–61.
2. The five predictions, recomputed from the shard-3 series rows before any encode, equal §8's table.
3. 53 cells encoded with `aomenc_args` unchanged, every frame measured by `cell.measure`; every cell's `--q-hist` is
   its Q alone. Worst frame at the rule's Q: 0.969, 0.958, 0.578, 0.956, 0.888 (G 1) and 0.969, 0.957, 0.578, 0.956,
   0.887 (G 16).
4. Against the measured anchor (e_N ≤ σ on every frame, ladder rungs from the lowest arm up): rule = anchor on 7 of
   10 cells, one rung lower on 3 (`dbts_a5` G 16, `dbt10_d` G 1 and 16), higher on none.
5. The three mutations each show: the 8-bit table moves the predictions to Q 24–40; the median σ makes `dbts_a2`
   G 1 overshoot (Q 8 against its anchor 4); the shifted tile mask changes P4's share on 5 of 6 cells.

**What it does not show.** The held-out frames lower the in-sample G 1 minimum: one frame of `dbts_a3` at Q 9 reads
e_N ÷ σ 1.0001 at x 4.802, under x\* 4.929. No rule Q came near it (Q 9 was the arm above the in-between Q), and it
is inside 1.03, so P1 is not refuted and x\* is not re-read. It does mean **x\* is not a strict bound on new series**:
the bar the rule meets is 1.03, not 1.

**What would change it:** a DBT series, from these or other systems, whose rule Q has a frame above 1.03; a reader
study that sees the noise anchor (§6 flicker test, not run); a system whose noise is not white in the fine band.

**Owed:** the §6 flicker test; an x\* for any modality but DBT; DBT from systems other than these; σ_min beyond
14.8 (12-bit) and 5.6 (10-bit) on real acquisitions (P5 is synthetic); a decision on the tile excess (P4).

**For the product.** The VL view will take its Q per series from this rule, at ingest, in the PCS. **For DBT from
systems A, B and C, the rule as written is ready as a candidate Q,** with three conditions the run adds: σ over every
frame, not a subset (P2); step 4's edge confirm kept, because the rule's margin is to 1.03, not to 1; and the integer
Q (P3) is safe on these five series and saves bytes. It is **not ready for any other modality.** Before one uses it,
calibrate on that modality's own coded frames: x\* at G 1 and G > 1 by §3's definition, x_hi, the σ floor below
which there is no noise anchor (§5.1), and a lossy-history test that does not rely on (0028,2110) alone (P6: the
breast cine fixtures have no DICOM header at all, and σ misses `usb_cine_rgb`); then a held-out check like this one.
TRUS (one rung too high, §3) and MR (crosses near x 15) already show the DBT x\* does not carry over.

### Method card

* **Input.** The fetched sets of `lab/av1/data.json`, each checked against its pinned SHA-256 by
  `lab/av1/fetch_data.sh`: held out `dbts_a3`, `dbts_a4`, `dbts_a5`, `dbts_b4`, `dbt10_d`; timed and tiled
  `dbts_a1`, `dbts_b1`, `dbts_c1`; P6 `usb_cine`, `usb_cine_rgb`, `us_liver`. σ per frame and HTJ2K bytes from
  `rows/shard-{1,2,3,4}.jsonl` as committed; the in-sample cells from shards 1, 2 and 4. Commit pin `972269c4`.
* **Encode.** libaom 3.15.1 (`ingest/tools.sh`, tarball SHA-256 pinned), `aomenc -o OUT --limit=N --q-hist=64
  --disable-warning-prompt` + `aomenc_args(form, Q, G, N)` of `lab/av1/profiles/bytes.py` unchanged: `--ivf --good
  --cpu-used=6 --threads=1 --passes=1 --tune=psnr --end-usage=q --cq-level=Q --min-q=Q --max-q=Q --deltaq-mode=0
  --aq-mode=0 --denoise-noise-level=0 --lag-in-frames=0 --auto-alt-ref=0`, `--kf-max-dist=0` at G 1 or
  `--kf-min-dist=16 --kf-max-dist=16`, `--monochrome --profile={2 at 12 bits, 0 at 10} --bit-depth=B
  --input-bit-depth=B`. Stored form only.
* **Decode.** dav1d 1.5.4 (commit `54706fc`, meson release, bit depths 8 and 16), `dav1d -q --threads=1`.
* **Clocks.** Encode and decode CPU: `getrusage` of the child, user + system. P2: `time.process_time()` of one
  Python process around σ for the whole series, frame reads included, nothing else running.
* **Bytes.** The sum of the IVF frame payloads (`ingest.ivf_units`), over the HTJ2K control's summed bytes for the same
  series (`rows/shard-3.jsonl`). P4 and P5 count the IVF file.
* **Metrics.** e_N = `quality.noise_band` of decoded − source over the first window's in-window samples; σ = the
  series row's `quality.sigma` of that frame; worst = the maximum over frames of e_N ÷ σ. x = ac_q(4Q, B) ÷ 8 ÷ σ_min.
  The anchor is `collect.highest` over the encoded ladder rungs with every frame ≤ 1.
* **Host.** One 4-core Intel Xeon at 2.30 GHz, 15 GB, four cells in flight, one thread each; encode wall ÷ CPU 1.009
  over the 53 cells (5 117 CPU s of encode, 72 of decode, 9 254 Mpx coded). Nothing is claimed past four cells in
  flight on this host.
* **Code.** `lab/av1/metrics/noise_point.py` (steps `tables`, `predict`, `arms`, `sigma`, `tiles`, `noise`, `headers`,
  `report`). `checks.py` ran first, on `dbt10_d`, without the visibility model: every check held and each mutation was
  seen (`rows/noise-point/checks.json`; `sigma_correlated` reports, as in the shards).

### The AC table, and the predictions

libaom's `ac_qlookup_QTX`, `_10_QTX` and `_12_QTX` against the specification's `Ac_Qlookup[3][256]` (read
2026-11-09): 0 of 768 entries differ. Mutated (12-bit, qindex 32, +1): the check reports entry 32 and fails. Rows:
`ac-table.json`. The predictions recomputed by `noise_point.py predict` equal §8's table on all five series and every
column; the edge band runs on `dbts_a5`, `dbts_b4`, `dbt10_d` (x 5.23, 6.00, 6.26 at the next rung) and not on
`dbts_a3` and `a4` (7.38, 7.15). Rows: `predict.json`.

### Held-out arms, every cell

Stored form; x at σ_min; worst and median frame. Where the in-between Q equals the rule's rung, the row carries both
names; `dbts_a5`'s Q 8 is both the rung above and the in-between Q + 1. Rows: `arms.jsonl`.

| series | G | Q | arm | x at σ_min | e_N ÷ σ worst · median | frames > 1.03 | bytes ÷ HTJ2K |
| --- | --: | --: | --- | --: | --- | --: | --: |
| `dbts_a3` | 1 | 4 | rung below | 1.79 | 0.497 · 0.474 | 0 of 43 | 0.300 |
| `dbts_a3` | 1 | 8 | rule, in-between | 4.47 | 0.969 · 0.961 | 0 of 43 | 0.097 |
| `dbts_a3` | 1 | 9 | in-between + 1 | 5.19 | 1.009 · 0.999 | 0 of 43 | 0.071 |
| `dbts_a3` | 1 | 12 | rung above | 7.38 | 1.041 · 1.030 | 21 of 43 | 0.029 |
| `dbts_a3` | 1 | 16 | two above | 10.28 | 1.044 · 1.033 | 33 of 43 | 0.013 |
| `dbts_a3` | 16 | 4 | rung below | 1.79 | 0.497 · 0.470 | 0 of 43 | 0.299 |
| `dbts_a3` | 16 | 8 | rule, in-between | 4.47 | 0.969 · 0.958 | 0 of 43 | 0.097 |
| `dbts_a3` | 16 | 9 | in-between + 1 | 5.19 | 1.009 · 0.996 | 0 of 43 | 0.070 |
| `dbts_a3` | 16 | 12 | rung above | 7.38 | 1.041 · 1.031 | 25 of 43 | 0.025 |
| `dbts_a3` | 16 | 16 | two above | 10.28 | 1.044 · 1.032 | 32 of 43 | 0.008 |
| `dbts_a4` | 1 | 4 | rung below | 1.74 | 0.497 · 0.463 | 0 of 69 | 0.300 |
| `dbts_a4` | 1 | 8 | rule, in-between | 4.33 | 0.958 · 0.948 | 0 of 69 | 0.101 |
| `dbts_a4` | 1 | 9 | in-between + 1 | 5.03 | 0.995 · 0.987 | 0 of 69 | 0.074 |
| `dbts_a4` | 1 | 12 | rung above | 7.15 | 1.031 · 1.023 | 3 of 69 | 0.029 |
| `dbts_a4` | 1 | 16 | two above | 9.96 | 1.035 · 1.026 | 13 of 69 | 0.011 |
| `dbts_a4` | 16 | 4 | rung below | 1.74 | 0.497 · 0.464 | 0 of 69 | 0.299 |
| `dbts_a4` | 16 | 8 | rule, in-between | 4.33 | 0.957 · 0.944 | 0 of 69 | 0.102 |
| `dbts_a4` | 16 | 9 | in-between + 1 | 5.03 | 0.995 · 0.985 | 0 of 69 | 0.074 |
| `dbts_a4` | 16 | 12 | rung above | 7.15 | 1.033 · 1.024 | 6 of 69 | 0.026 |
| `dbts_a4` | 16 | 16 | two above | 9.96 | 1.035 · 1.026 | 13 of 69 | 0.007 |
| `dbts_a5` | 1 | 2 | rung below | 0.86 | 0.239 · 0.221 | 0 of 71 | 0.489 |
| `dbts_a5` | 1 | 4 | rule | 2.10 | 0.578 · 0.547 | 0 of 71 | 0.279 |
| `dbts_a5` | 1 | 7 | in-between | 4.40 | 0.948 · 0.936 | 0 of 71 | 0.120 |
| `dbts_a5` | 1 | 8 | rung above, in-between + 1 | 5.23 | 1.001 · 0.993 | 0 of 71 | 0.090 |
| `dbts_a5` | 1 | 12 | two above | 8.63 | 1.071 · 1.057 | 71 of 71 | 0.031 |
| `dbts_a5` | 16 | 2 | rung below | 0.86 | 0.254 · 0.233 | 0 of 71 | 0.472 |
| `dbts_a5` | 16 | 4 | rule | 2.10 | 0.578 · 0.545 | 0 of 71 | 0.277 |
| `dbts_a5` | 16 | 7 | in-between | 4.40 | 0.947 · 0.931 | 0 of 71 | 0.119 |
| `dbts_a5` | 16 | 8 | rung above, in-between + 1 | 5.23 | 1.000 · 0.991 | 0 of 71 | 0.088 |
| `dbts_a5` | 16 | 12 | two above | 8.63 | 1.071 · 1.057 | 71 of 71 | 0.026 |
| `dbts_b4` | 1 | 8 | rung below | 2.74 | 0.751 · 0.748 | 0 of 84 | 0.185 |
| `dbts_b4` | 1 | 12 | rule | 4.38 | 0.956 · 0.952 | 0 of 84 | 0.096 |
| `dbts_b4` | 1 | 13 | in-between | 4.78 | 0.981 · 0.977 | 0 of 84 | 0.082 |
| `dbts_b4` | 1 | 14 | in-between + 1 | 5.19 | 1.002 · 0.997 | 0 of 84 | 0.071 |
| `dbts_b4` | 1 | 16 | rung above | 6.00 | 1.028 · 1.024 | 0 of 84 | 0.053 |
| `dbts_b4` | 1 | 24 | two above | 9.19 | 1.061 · 1.056 | 84 of 84 | 0.021 |
| `dbts_b4` | 16 | 8 | rung below | 2.74 | 0.751 · 0.729 | 0 of 84 | 0.182 |
| `dbts_b4` | 16 | 12 | rule, in-between | 4.38 | 0.956 · 0.948 | 0 of 84 | 0.088 |
| `dbts_b4` | 16 | 13 | in-between + 1 | 4.78 | 0.981 · 0.975 | 0 of 84 | 0.074 |
| `dbts_b4` | 16 | 16 | rung above | 6.00 | 1.029 · 1.024 | 0 of 84 | 0.046 |
| `dbts_b4` | 16 | 24 | two above | 9.19 | 1.062 · 1.057 | 84 of 84 | 0.014 |
| `dbt10_d` | 1 | 4 | rung below | 1.77 | 0.527 · 0.525 | 0 of 48 | 0.414 |
| `dbt10_d` | 1 | 8 | rule | 3.92 | 0.888 · 0.885 | 0 of 48 | 0.198 |
| `dbt10_d` | 1 | 9 | in-between | 4.50 | 0.922 · 0.919 | 0 of 48 | 0.169 |
| `dbt10_d` | 1 | 10 | in-between + 1 | 5.07 | 0.949 · 0.946 | 0 of 48 | 0.146 |
| `dbt10_d` | 1 | 12 | rung above | 6.26 | 0.993 · 0.988 | 0 of 48 | 0.110 |
| `dbt10_d` | 1 | 16 | two above | 8.57 | 1.028 · 1.023 | 0 of 48 | 0.069 |
| `dbt10_d` | 16 | 4 | rung below | 1.77 | 0.526 · 0.513 | 0 of 48 | 0.408 |
| `dbt10_d` | 16 | 8 | rule | 3.92 | 0.887 · 0.881 | 0 of 48 | 0.188 |
| `dbt10_d` | 16 | 9 | in-between | 4.50 | 0.921 · 0.918 | 0 of 48 | 0.158 |
| `dbt10_d` | 16 | 10 | in-between + 1 | 5.07 | 0.955 · 0.948 | 0 of 48 | 0.134 |
| `dbt10_d` | 16 | 12 | rung above | 6.26 | 0.991 · 0.987 | 0 of 48 | 0.099 |
| `dbt10_d` | 16 | 16 | two above | 8.57 | 1.030 · 1.025 | 0 of 48 | 0.055 |

| series | G | rule Q · worst | P1 | in-between Q · worst | P3 | bytes saved, in-between against rule Q | anchor on the ladder, rule against it |
| --- | --: | --- | --- | --- | --- | --: | --- |
| `dbts_a3` | 1 | 8 · 0.969 | holds | 8 · 0.969 | holds | 0 % | 8, equal |
| `dbts_a3` | 16 | 8 · 0.969 | holds | 8 · 0.969 | holds | 0 % | 8, equal |
| `dbts_a4` | 1 | 8 · 0.958 | holds | 8 · 0.958 | holds | 0 % | 8, equal |
| `dbts_a4` | 16 | 8 · 0.957 | holds | 8 · 0.957 | holds | 0 % | 8, equal |
| `dbts_a5` | 1 | 4 · 0.578 | holds | 7 · 0.948 | holds | 56.9 % | 4 (Q 8 reads 1.001), equal |
| `dbts_a5` | 16 | 4 · 0.578 | holds | 7 · 0.947 | holds | 57.1 % | 8 (Q 8 reads 1.000), one rung lower |
| `dbts_b4` | 1 | 12 · 0.956 | holds | 13 · 0.981 | holds | 14.2 % | 12, equal |
| `dbts_b4` | 16 | 12 · 0.956 | holds | 12 · 0.956 | holds | 0 % | 12, equal |
| `dbt10_d` | 1 | 8 · 0.888 | holds | 9 · 0.922 | holds | 14.3 % | 12, one rung lower |
| `dbt10_d` | 16 | 8 · 0.887 | holds | 9 · 0.921 | holds | 15.9 % | 12, one rung lower |

The anchor reads from the lowest arm up; the rungs below it were not encoded. **x\* with the held-out frames
included**, by §3's definition: G 1 drops from 4.929 to **4.802** (`dbts_a3`, Q 9, frame 32, σ 13.8, e_N ÷ σ
1.0001); G 8 and 16 stay at 4.636 (`dbts_b1`, Q 12). P1 holds, so per §8 this is reported and the rule is not
re-read.

### P2 · σ's cost, and every fourth frame

Williams order over the six (series, frames) units, five rounds, one process alone on the host. σ matched the
series rows to 1e-9 on every frame of every run.

| series | Mpx | every frame: CPU s, median of 5 (range) | every fourth frame | CPU s / Mpx, every frame |
| --- | --: | --- | --- | --: |
| `dbts_a1` | 114 | 5.6 (5.0–6.1) | 1.4 (1.4–1.5) | 0.049 |
| `dbts_b1` | 426 | 37.0 (34.2–38.6) | 9.7 (8.7–10.8) | 0.087 |
| `dbts_c1` | 169 | 8.2 (7.5–8.7) | 2.1 (1.9–2.3) | 0.049 |

**Decision: not adopted.** Over 28 cells × G 1 and 16 (56 picks), every fourth frame (frames 0, 4, 8, …) changes one:
`dbts_b1` at G 16, Q 8 → Q 12 on the ladder (11 → 12 in 0 … 61), because its σ_min frame (30 of 50, σ 5.258) is
skipped (5.308). Q 12 is above that cell's measured anchor, 8. σ on every frame costs 0.05–0.09 CPU s/Mpx here,
under §7's 0.3 ceiling: 6–37 s a series on one core.

### P4 · Region, reported

64 × 64 tiles wholly in-window, every frame, at each series' rule Q; σ and e_N per tile by the same functions as
per frame, on the tile alone. "Edge" tiles have a missing neighbour (the window's border or the breast's).

| series | G | Q | tiles | share > 1.03 | mask shifted one tile | tile σ, median by signal tercile low · mid · high | r(σ, signal) | share > 1.03 by signal tercile | edge · interior |
| --- | --: | --: | --: | --: | --: | --- | --: | --- | --- |
| `dbts_a1` | 1 | 4 | 16 867 | 0.0 % | 1.0 % | 10.29 · 11.51 · 12.73 | 0.78 | 0.0 · 0.0 · 0.0 % | 0.0 · 0.0 % |
| `dbts_a1` | 16 | 4 | 16 867 | 0.0 % | 1.1 % | 10.29 · 11.51 · 12.73 | 0.78 | 0.0 · 0.0 · 0.0 % | 0.0 · 0.0 % |
| `dbts_b1` | 1 | 12 | 33 200 | 1.1 % | 0.7 % | 4.88 · 5.27 · 6.09 | 0.58 | 2.1 · 1.1 · 0.2 % | 3.6 · 0.6 % |
| `dbts_b1` | 16 | 8 | 33 200 | 0.0 % | 0.0 % | 4.88 · 5.27 · 6.09 | 0.58 | 0.0 · 0.0 · 0.0 % | 0.0 · 0.0 % |
| `dbts_c1` | 1 | 8 | 15 996 | 0.7 % | 0.9 % | 11.06 · 13.25 · 17.98 | 0.90 | 1.4 · 0.5 · 0.2 % | 2.5 · 0.1 % |
| `dbts_c1` | 16 | 4 | 15 996 | 0.0 % | 0.7 % | 11.06 · 13.25 · 17.98 | 0.90 | 0.0 · 0.0 · 0.0 % | 0.0 · 0.0 % |

Noise rises with signal on all three (r 0.58–0.90). Where the rule Q sits near x\* (`dbts_b1` and `dbts_c1` at G 1),
0.7–1.1 % of tiles exceed 1.03, mostly in the quietest third and at the edge, as §5.4 expected; at the rung below
(the other four cells) none do. **The tile-mask mutation is seen on 5 of 6 cells and missed on `dbts_b1` G 16**, where
both shares are 0. Whether this calls for a regional Q is the owner's design question. Rows: `tiles.jsonl.gz`.

### P5 · Encoder side at raised noise

`dbts_c1`'s middle 8 frames with white Gaussian noise added (seeded per frame), rounded and clipped to 12 bits, σ
re-measured. G 16 here is one keyframe and seven inter frames. Rows: `noise.jsonl`.

| σ_min × | σ added | σ_min measured | rule Q | Q | x | worst · median, G 1 | worst · median, G 16 | bytes G 1 · G 16 |
| --: | --: | --: | --: | --: | --: | --- | --- | --- |
| 1 | 0 | 12.69 | 8 | 4 | 1.80 | 0.509 · 0.502 | 0.509 · 0.502 | 2 387 505 · 2 391 260 |
| 1 | 0 | 12.69 | 8 | 8 | 4.49 | 0.981 · 0.980 | 0.980 · 0.974 | 800 941 · 797 126 |
| 1 | 0 | 12.69 | 8 | 12 | 7.42 | 1.074 · 1.073 | 1.074 · 1.073 | 274 689 · 242 445 |
| 1 | 0 | 12.69 | 8 | 16 | 10.33 | 1.082 · 1.080 | 1.082 · 1.081 | 130 677 · 87 855 |
| 2 | 21.98 | 25.65 | 12 | 8 | 2.22 | 0.677 · 0.674 | 0.674 · 0.661 | 1 458 787 · 1 475 972 |
| 2 | 21.98 | 25.65 | 12 | 12 | 3.67 | 0.993 · 0.992 | 0.993 · 0.990 | 416 352 · 418 759 |
| 2 | 21.98 | 25.65 | 12 | 16 | 5.11 | 1.010 · 1.009 | 1.010 · 1.009 | 155 154 · 122 070 |
| 2 | 21.98 | 25.65 | 12 | 24 | 7.93 | 1.010 · 1.010 | 1.011 · 1.010 | 63 383 · 30 797 |
| 4 | 49.14 | 50.95 | 24 | 16 | 2.57 | 0.859 · 0.856 | 0.858 · 0.846 | 671 780 · 695 142 |
| 4 | 49.14 | 50.95 | 24 | 24 | 3.99 | 1.002 · 1.001 | 1.002 · 1.001 | 82 890 · 33 564 |
| 4 | 49.14 | 50.95 | 24 | 32 | 6.86 | 1.002 · 1.001 | 1.002 · 1.001 | 35 547 · 13 875 |
| 4 | 49.14 | 50.95 | 24 | 40 | 11.95 | 1.002 · 1.001 | 1.002 · 1.001 | 20 304 · 6 557 |

**P5 holds under P1's rule** (worst at the rule Q 0.981, 0.993, 1.002). Two readings it adds. At 4× the rule Q's
worst frame is 1.002: above 1, inside 1.03, and the strict anchor would be Q 16. And with white noise added, e_N ÷ σ
levels off at 1.00–1.01 instead of the 1.04–1.08 of the real frames, so above x\* this arm cannot tell rungs apart: it
tests the curve's rise, not its plateau. It is not a real high-noise acquisition.

### P6 · Lossy-history fields

| series | (0028,2110) · (0028,2112) · (0028,2114) | transfer syntax | σ_min under the Q 1 entry (8-bit, 0.28) | flagged by |
| --- | --- | --- | --- | --- |
| `usb_cine` | no DICOM: an AVI of MPEG-4 Part 2, yuv420p | none | 0.273: yes | σ, and the source being video |
| `usb_cine_rgb` | no DICOM: an AVI of MPEG-4 Part 2, yuv420p | none | 0.782: no | only the source being video |
| `us_liver` | 01 · 12.4 · absent | Implicit VR Little Endian (uncompressed) | 2.649: no | the attribute only |

No series is caught by all three of §5.5's tests, and each test misses one of the three. Rows: `headers.json`.

### Mutations

| mutation | expected | seen |
| --- | --- | --- |
| AC table, one entry moved | the table check fails | fails at 12-bit qindex 32 |
| Δ from the 8-bit table on a 12-bit (or 10-bit) stream | predictions move ≥ 2 rungs | `dbts_a3`, `a4`, `a5` 8 · 8 · 4 → 40; `dbts_b4` 12 → 32; `dbt10_d` 8 → 24 |
| σ_min replaced by the median σ | `dbts_a2`'s in-sample cell overshoots | G 1, 12-bit: Q 8 against anchor 4 (also `dbts_b1` G 8 and 16, `dbts_c1` top-10 G 1, `dbts_c5` top-10 G 1) |
| tile mask shifted one tile | P4's share changes | changes on 5 of 6 cells; not on `dbts_b1` G 16 (0 % both) |
