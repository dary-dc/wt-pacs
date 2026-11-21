# What the optimal-quality view may claim with no reader study, and on what criterion

Row VL-CRITERION, 2026-11-21. Theory and sources only: **nothing was encoded, decoded, timed or re-read from the
rows**. Every number is labelled **source** (a quoted document), **measured** (quoted from a committed result, with
its file), **derived** (arithmetic on quoted numbers, written out so it can be recomputed) or **theory** (a model of
this file). §5 pre-registers the re-reads of committed rows that would refute each criterion; row VL-READS runs them.

**Fixtures behind every measured number quoted here:** 19 DBT volumes of one dataset (EA1141; systems A and C 12-bit,
B 10-bit, four volumes of a second content), three of them timed (`dbts_a1`, `dbts_b1`, `dbts_c1`); stored form, lag 0,
libaom 3.15.1 at speed 6; one 4-core cloud host. No second vendor or dataset, no breast ultrasound cine or ABUS, no
phone, no calibrated display, no reader.

**Seen before the predictions were written** (while reading the rows' schema, so the reviewer can discount them):
the first frame of `dbts_a1` G 1 Q 12 in `lab/av1/audit/rows/b.jsonl` (`mse_in` 433.1, `err_band` 6.96,
`err_noise_band` 10.94, `sigma_out` 0.32–0.48), of `dbts_a3` G 1 Q 4 in `lab/av1/metrics/rows/noise-point/arms.jsonl`
(39.07, 1.466, 6.339), of `dbts_c3` Q 1 in `shard-1.jsonl`; the first values of `sigma`, `step` and `step_band` of two
series rows; the first two lines of `window.tsv` and the first of `curves.tsv`. R3 and R4 of §5 are the predictions
those could have informed.

## Answer

1. **The noise rule's threshold sits where its own statistic is flat and where its own logic stops holding.** The
   noise ratio rises to 1 and stays there once the noise is deleted, so "the worst frame at 1.00" is read on a
   plateau: that is why the anchor is unresolved on 15 of 19 volumes (*measured*, `audit-protocols.md` §B), and no
   better estimator fixes it. And "error within the noise" bounds a loss only while the error is *added* to the
   noise (step under about 2σ). At the rule's step (about 4.8σ) the error *is* the noise, removed, with whatever
   faint signal lay under the same threshold (§1.1).
2. **A claim is three statements, not one number** (§2): what was removed is only noise (no structure in the
   difference); what was added is small; how much of the noise texture is left. Each has its own measurable. One
   ratio cannot carry all three, and "visually lossless" names none of them.
3. **Two regimes have a guarantee that can be derived; the rule's Q is in neither** (*theory*, §3.2). With the step
   under about 2σ a faint finding keeps at least 0.87 of its detectability in a quantizer model (0.96 under 1σ); at
   4.8σ it keeps 0.35, and 0.20–0.30 when the model is fitted to the measured noise kept. AV1 may do better than the
   model; nothing measured says so yet.
4. **Readers are not the only route, and for the claim that matters they are not a route at all.** In the United
   States a lossy mammogram or DBT image "must not be reviewed for primary image interpretations" whatever a study
   shows (*source*, §1.4). What every source leaves the product free to say is a description: lossy, by what method,
   at about what ratio, with what measured error; and to give the exact frame.
5. **The recommendation this file hands to VL-PAGE (a leaning; the owner's to take):** claim nothing about
   visibility or diagnosis. The label states the facts (*Optimal quality · lossy, about N : 1*) and the exact frame
   arrives without being asked when a reader dwells or narrows the window, or behind the view on links that allow it
   (delivery arm C2). Then the criterion no longer has to carry a diagnostic promise; it only picks the Q of an
   interim picture, and §3 prices each choice. If the owner wants the view to promise more than that, the only
   promise with a derivable bound is the **task-bounded step** (option D), at a predicted 0.22–0.55 of HTJ2K's bytes
   against Q 8's 0.07–0.22.

**What it would reopen** (program §Decided approaches): an exact frame fetched without a request extends "the exact
HTJ2K frame on an explicit Lossless request"; a view no longer "meant to be visually lossless" changes the wording of
the design chosen 2026-11-09 and the glossary's *optimal quality*. Nothing here builds on either.

## Terms

From [`../glossary.md`](../glossary.md): *optimal quality*, *exact frame*, *coding error*, *noise ratio*, *quality
label*. From [`noise-point.md`](noise-point.md) and [`noise-ratio.md`](noise-ratio.md): σ (a frame's noise in the
3 × 3 Laplacian's band, Immerkær's estimator), e_N (the coding error's RMS in that band), r = e_N ÷ σ, Δ (AV1's AC
step in sample units), x = Δ ÷ σ, x\* (the x at which r first passes 1; 4.76 at G 1, 4.64 pooled, *measured*,
`audit-protocols.md` §B0), the **noise rule** (the highest Q with x < x\* at the quietest frame) and its **bar**
(1.00 or 1.03). From [`audit-protocols.md`](audit-protocols.md) §A: ν, the decoded frame's σ over the source's (the
noise kept). d′ is detectability as `noise-ratio.md` §Terms defines it. For this file only:

* **e**, the coding error's RMS over all in-window samples (`mse_in` in the rows); **e₄**, its RMS after 4 × 4 means
  (`err_band`).
* **k**, the share of the fine-band noise's amplitude the coding removed, and **r_q**, the added error over σ, in the
  model of `audit-protocols.md` §A: r² = k² + r_q², ν² = (1 − k)² + r_q², so k = (1 + r² − ν²) ÷ 2.
* **Detectability kept, T.** For one transform coefficient holding a signal of a·σ in noise of σ, the d′ of a linear
  observer on the quantized coefficient over its d′ on the unquantized one.
* **Dwell.** A reader stopped on one frame; how long counts as stopped is not defined here.

## 1 · The four premises

### 1.1 "One number, the worst frame's coding error over its noise, is the invariant"

**What the rows already say** (*measured*, `audit-protocols.md` §B and §A, 352 cells, the 19 volumes): the estimator
resolves the worst frame to δ = 0.1–5.5 % by volume; the anchor is a band [Q_lo, Q_hi], one Q wide on 4 of 19 volumes
and up to ≥ 8 on 10-bit ones; at the rule's Q the view keeps ν = 0.286–0.495 of the fine-band noise's amplitude, so
it removes half to seven tenths of it.

**Why the anchor cannot be resolved** (*theory*). A quantizer of step x·σ on Gaussian noise gives
(`noise-ratio.md` §2.3, a uniform mid-tread quantizer; recomputed here):

| x | 1 | 2 | 3 | 4 | 4.8 | 6 |
| --- | --: | --: | --: | --: | --: | --: |
| r | 0.289 | 0.575 | 0.805 | 0.930 | 0.974 | 0.995 |
| ν | 1.04 | 1.14 | 1.10 | 0.85 | 0.62 | 0.31 |

Between x 4 and x 6, r moves by 0.065 and ν by 0.54. The rule places its threshold on r at 1, the value r approaches
when all the noise is gone, so near the threshold a 2 % reading error (the median δ) spans about 0.6 of x in the
model (0.02 ÷ (0.065 ÷ 2)), which is one to two integer Q (near Q 8 one integer Q moves Δ by 13–16 %, *measured*,
`noise-point.md` §5.3). The measured bands are that wide or wider. **A threshold belongs where its statistic is
steep**; ν is steep exactly where r is flat. R1 tests this on the rows.

**Why the logic stops holding there** (*theory*). "Error within the noise" is a bound on harm only for error that is
independent of the noise: then every linear observer's d′ falls by 1 ÷ √(1 + r²) at most (`noise-ratio.md` §2.2).
That describes x ≤ 2, where κ ≈ +1. At x 4.8 the model's κ is −0.66: the error is anticorrelated with the noise
because it is the noise. With the measured ranges, k = (1 + r² − ν²) ÷ 2 is 0.74–0.94 and r_q is 0.28–0.45 (*derived*
from r 0.85–0.98 and ν 0.286–0.495 paired at their extremes; the pairing per frame is R2's): of the fine-band
"error" at the rule's Q, 75–92 % of the power is removed noise. So at the rule's Q the ratio measures **how much was
removed**, and the question that matters, what else went with it, is outside what r can see.

**What went with it** (*theory*; the table is this file's, by numerical integration of the quantizer over a unit
Gaussian; the reviewer can recompute it from the definition of T). A coefficient holding a faint signal a·σ is zeroed
with the noise unless the noise carries it over the threshold. Detectability kept, T:

| x (zero bin ± x ÷ 2 unless said) | a ≤ 0.5 | a = 1 | a = 2 | a = 3 |
| --- | --: | --: | --: | --: |
| 1 | 0.96 | 0.96 | 0.96 | 0.96 |
| 1.5 | 0.92 | 0.92 | 0.92 | 0.92 |
| 2 | 0.86 | 0.87 | 0.88 | 0.87 |
| 3 | 0.71 | 0.72 | 0.82 | 0.91 |
| 4 | 0.51 | 0.52 | 0.65 | 0.93 |
| 4.8 | 0.35 | 0.38 | 0.50 | 0.74 |
| 4.8, zero bin widened until ν = 0.50 · 0.40 · 0.30 (± 2.55 · 2.70 · 2.89) | 0.30 · 0.25 · 0.20 | 0.33 · 0.28 · 0.23 | 0.44 · 0.39 · 0.34 | 0.66 · 0.59 · 0.51 |

Up to x 2 the table equals the independent-error bound (1 ÷ √(1 + r²) = 0.960, 0.867): the two regimes are one
formula until the zero bin starts to swallow the noise. Past it, a finding spread thinly over coefficients loses
most of its detectability; a finding concentrated in one large coefficient (a ≥ 4) loses none, and can gain. A
finding of exact-frame d′ = a·√m spread over m coefficients therefore survives the rule's step when its d′ exceeds
about (x ÷ 2)·√m: 2.5 for m = 1, 4.9 for m = 4, 9.9 for m = 16, 19.7 for m = 64 (*derived*). Against Rose's
criterion (a detail is seen at an SNR of about 5; *unverified*, the primary text was not read), a detail the
acquisition just shows survives only when at most four coefficients hold it. A mass does; a calcification one or two
samples wide inside a 4 × 4 or larger transform does not, in this model.

**The model is not AV1.** AV1 chooses its transform's size and kind per block, predicts each block, and filters the
result; an encoder that codes a speck with a small or identity transform keeps it. Whether libaom does at speed 6 is
*unverified* and unmeasured. The measured ν (0.29–0.50) is below the plain model's 0.62 at x 4.8, so AV1 removes
more noise than the plain quantizer, which is why the last row widens the zero bin. `noise-ratio.md` §5 (a model
observer on inserted lesions) is the measurement; it is held (program §Trimmed, NOISE-RATIO-RUN).

**So:** the one number is two different statistics joined at x ≈ 2–3. Below, it is a criterion with a bound. Above,
it is a gauge of removal with its threshold on a plateau. The invariant is not r.

### 1.2 "A criterion fitted on 19 volumes of one dataset carries to other detectors, doses and reconstructions"

Separate the criterion's **form** from its **constants**.

* **The form carries wherever the noise limits the finding and is white in the estimator's band** (*theory*). r, ν
  and T are ratios to σ, so they do not change with a detector's gain, an offset, the stored depth or a linear
  window. Under a change of dose on one system, σ changes and the rule moves Q with it; in units of σ the step, the
  zero bin and a finding's amplitude a all keep their relation only if the finding's contrast is fixed in stored
  units while σ scales, which is the quantum-limited case (*source* for the physics is owed to §Sources' item N1;
  until read, *unverified*). So over **dose, on one detector and one reconstruction**, the form carries by physics.
  R6 tests the nearest thing the rows hold: frames of one volume differ in σ by 1.17–1.33× on A and C (*measured*,
  `noise-point.md` §5.3).
* **The constants do not carry beyond systems whose noise has the same spectrum** (*measured* and *source*). x\*, the
  plateau and ν(x) depend on how the noise's power is spread over frequency, which the detector's blur and the
  reconstruction's filter set: "The shape of the NPS was affected by the reconstruction filters" (Zhao and Zhao 2008,
  quoted in `noise-ratio.md` §3.5). Inside this one dataset, ν at equal x already differs across systems by 0.11–0.13
  near the rule's x (A3 refuted), the plateau is 1.02–1.03 on 10-bit volumes and 1.04–1.08 on 12-bit ones, and the two
  σ estimators differ by 1.08–1.44×, not a constant. Outside it, TRUS is one rung off and MR crosses near x 15
  (`noise-point.md` §3).
* **Where the form itself fails** (*theory*): a reconstruction that denoises (iterative or learned), a synthesized
  2D image, a lossy-sourced series, any series whose fine band holds structure and not noise. There σ is small or
  is not acquisition noise, and a noise-relative criterion has nothing to stand on (`noise-ratio.md` §4.4, §4.5).
  What share of DBT in service is reconstructed that way was not found in a source: *unknown*.

**Population, stated:** the form, over dose and gain, for filtered-backprojection-like DBT whose fine band is noise;
the constants, for systems A, B and C of this dataset only. A criterion that needs **no fitted constant** carries
further: the structure test of §3.3 compares a frame's difference with that frame's own noise, and the task test of
§3.2 is defined on any image. Neither has been run.

### 1.3 "The window does not matter"

True of the ratio, false of the claim, for three reasons.

1. **The window chooses the samples** (*measured*). σ rises with signal on all three timed volumes (r 0.58–0.90 by
   tile); the step does not. At the rule's Q, tiles in the quietest third exceed 1.03 ten times as often as in the
   brightest (2.1 against 0.2 % on `dbts_b1`, 1.4 against 0.2 % on `dbts_c1`; `noise-point.md` §P4). A narrow window
   set on the quiet band shows a worse ratio than the frame's number. R5 quantifies it.
2. **Two mechanisms hide error, and each works at one end only** (*derived*). A window of width W shows 256 levels,
   so an error of RMS e moves a sample by one level with probability about 0.8·e·255 ÷ W when that is small
   (√(2 ÷ π) times the error in levels; it reproduces the one row seen, 0.060 against 0.064). Wide windows hide error
   by rounding; that needs W ≫ 200·e, which no header preset reaches at Q 8 (81–87 % of shown samples move,
   *measured*, `window-q.md`). Narrow windows magnify error and noise alike, so only masking by the noise is left,
   and it is left in the quietest band (point 1) under the most sensitive test.
3. **Readers pick the narrowest window** (*source*): "Observers also quickly found that liver settings were most
   sensitive to compression-related changes and, thus, reviewed most images with that setting" (Erickson 2010, as
   quoted in `vl-metrics.md` §3). A claim made without readers has to hold at the narrowest window the viewer
   allows; none of the committed measures is taken there (`vl-metrics.md` §4, item 1).

Not analysed anywhere so far: the fixtures' header windows are SIGMOID, not LINEAR (the `windows` field of the
series rows), so a level's width in stored units varies across the window. The ratio is still the same locally.

### 1.4 "Readers are the only route"

**What regulators and professional bodies state** (*source*; each quote was read at its source by the row named, with
its revision, and is repeated verbatim from that file; "re-read" says whether this row fetched it again, §Sources).

| body, document, revision | the sentence | binds |
| --- | --- | --- |
| FDA, *Display Devices for Diagnostic Radiology*, 28 September 2022, §VIII | "Mammographic images with lossy compression must not be reviewed for primary image interpretations." | labelling of a device sold for mammography review, US |
| FDA, MQSA final rule, 88 FR 15126, 10 March 2023, Response 100 | "images that have undergone lossy compression, which does not maintain all of the data related to the mammogram image files, would generally not be considered to be ''original'' mammograms for the purposes of § 900.12(c)(4)"; "we do not believe there is consensus on what loss of information is acceptable" | retention and transfer, US |
| ACR–AAPM–SIIM, *Technical Standard for Electronic Practice of Medical Imaging*, revised 2022, §B | "Irreversible compression may be used to reduce transmission time or storage space only if the quality of the result is sufficient to reliably perform the clinical task."; "The U.S. Food and Drug Administration (FDA) requires that when an image is displayed it be labeled with a message stating if irreversible compression has been applied and with approximately what compression ratio (and/or quality factor)" | advisory |
| DICOM PS3.5 2026d §8.2.4 | "The context where the usage of lossy compression of medical images is clinically acceptable is beyond the scope of the DICOM Standard." | nothing |
| Germany, StrlSchV §127 (as amended 23 October 2024) | "Daten können komprimiert werden, wenn sichergestellt ist, dass die diagnostische Aussagekraft erhalten bleibt." | storage of X-ray data, no number |
| ESR position paper, *Insights Imaging* 2(2), 2011 | "irreversible compression may be used without producing perceptually visible differences ("visually lossless"), and/or without producing differences that affect diagnostic performance ("diagnostically lossless")"; "There is evidence that despite obvious visual degradation from irreversible compression, high performance equivalent to that on uncompressed images can be achieved" | advisory |
| RANZCR, *Guideline for the Use of Image Compression in Diagnostic Imaging*, v2, 13 August 2020 | "the radiologist may make judicious use of appropriate levels of lossy image compression to speed the initial arrival of the images … the practice should make the original images available for subsequent download as required" | advisory |

All from [`visually-lossless.md`](visually-lossless.md) §1 (read 2026-11-02) and [`vl-metrics.md`](vl-metrics.md) §1
(read 2026-11-09). No guideline states a limit as a metric; where one gives a number it is a compression ratio tested
on 2D JPEG and JPEG 2000 (CAR 15–25 : 1 for mammography; DRG 15 : 1; the RCR's 20 : 1 withdrawn in 2018). No source
covers DBT or AV1.

**What follows** (*derived*):

* **There are three claims, and readers are the route to one.** *Visually lossless* is defined by a reader test
  (alternation without a blank is the most sensitive presentation: Kim B 2011, Erickson 2010, ISO/IEC 29170-2, in
  `vl-metrics.md` §1); no measurement stands in for it. *Diagnostically acceptable* is, in every text above, a
  judgement of the task ("sufficient to reliably perform the clinical task", "die diagnostische Aussagekraft"), which
  a reader study or a task-based measurement informs and a physician or an operator makes. *For primary
  interpretation of mammography or DBT in the United States* is closed by rule: no study the product could run opens
  it.
* **Visually lossless and diagnostically lossless are different properties** (the ESR's two sentences). A view that
  removes half the noise texture changes under alternation whether or not any finding is harmed; a view can pass
  alternation and still lack a bound on a faint finding. Promising the first to mean the second is the confusion in
  the design's words "visually lossless … also for diagnosis".
* **A noise-removing view cannot be expected to pass alternation at the rule's Q** (*theory*, `noise-ratio.md` §1.4:
  the two frames share one noise realization, so what alternates is the removed noise itself, 50–70 % of its
  amplitude). The visually lossless promise is then priced by the added-error regime, not by the rule: an RMS error
  under one display level at every preset takes Q 1–2 on 12-bit DBT (0.64–0.65 of HTJ2K's bytes) and Q 4 on 10-bit
  (0.37–0.53) (*measured*, `window-q.md`, as [`which-quality-is-visually-lossless.md`](../client/evidence/which-quality-is-visually-lossless.md)
  quotes it), and even that is a proxy no reader confirmed.
* **What the product is free to claim with no study at all:** facts. That irreversible compression was applied, the
  method, about what ratio, the measured coding error; and that the exact frame is one request away, or on its way.
  The ACR text makes the first two an obligation of the display, and today's quality label (*Optimal quality*)
  states neither. RANZCR describes exactly this product's shape and asks only that the originals be available.

## 2 · What a claim decomposes into

In any band, write the decoded frame as signal·(1 − a_s) + noise·(1 − k) + q: the coding removes a share a_s of the
signal and k of the noise, and adds q. A reader can be harmed in three ways, and each has its own measurable:

| statement | harm if false | measurable | from the committed rows |
| --- | --- | --- | --- |
| **Only noise was removed** (a_s ≈ 0) | a finding is fainter or gone | a task test (§3.2), or no structure in exact − decoded (§3.3) | no: needs inserted lesions, or the decoded samples |
| **Little was added** (q small) | texture or structure that is not in the breast | r_q; the error's spectrum against white | r_q in the fine band (R2); whiteness in three bands (R3) |
| **This much noise is left** (k, or ν) | the picture looks unlike the acquisition; nothing diagnostic by itself | ν | yes (measured, `audit-protocols.md` §A) |

The noise rule tests none of the three: r = √(k² + r_q²) mixes the second and third and is silent on the first.
"The view differs from the exact frame only by noise the detector added" would be the strongest claim a measurement
can make without a reader: it says the view is the same object under less noise. It is a physical claim, neither
*visually lossless* (the texture differs) nor *diagnostic* (a regulator's word), and it needs the first statement
shown, which the rows cannot do.

## 3 · Criteria and promises

Bytes are of HTJ2K's, G 1, stored form. "Q 8" figures are *measured* (`../lines/codecs.md` §State now); others say.

| | criterion | the label may then say | bytes | requests | state |
| --- | --- | --- | --- | --- | --- |
| A | none; the exact frame arrives unasked | *Optimal quality · lossy, about N : 1*, then *✓ Lossless* | the view at any Q (0.07–0.22 at Q 8), plus one exact frame per dwell, or the whole exact series behind the view (1.07–1.28× in all, *derived*, audit F7) | one ask per dwell, or none (C2) | buildable; the trigger is the owner's |
| B | the noise rule, as today (r ≤ bar on the worst frame) | "the coding error is within the frame's noise in the finest band" (a measured fact, no more) | 0.10–0.28 (*derived*, audit F7) | on request | built; its threshold unresolved (§1.1) |
| C | the error is added, and small: x ≤ 1, so r ≤ 0.29 | "the coding costs under 4 % of any finding's detectability (model), equal to 8 % of the dose" | 0.64–0.65 on 12-bit, Q 2 (*measured*); 10-bit *unknown*, R8 | on request | derivable now |
| D | **task-bounded step**: x ≤ 2 at the quietest frame, so T ≥ 0.86 | "no finding loses more than 14 % of its detectability to the quantizer (model; not measured on AV1; no reader)" | 0.22–0.55 (*theory*, R8's prediction; 0.27–0.28 where measured, Q 4 on `dbts_a1`, `a2`) | on request | derivable now; AV1's own T unmeasured |
| E | **only noise removed**: exact − decoded holds no structure | "differs from the exact frame only by noise" | whatever Q passes: *unknown* | on request | needs decoded samples (§6) |
| F | **noise kept**: ν ≥ a floor (a half: Q_ν) | "keeps at least half of the noise texture" | 1.16–1.92× option B's (*measured*, A4) | on request | readable now; resolvable where B is not (R1) |
| G | a model observer's d′ for the smallest finding at the reading window, kept within the series' own spread | "a model observer finds a calcification of 0.1 mm as well as on the exact frame, within m" | at Q_task: *unknown* | on request | protocol exists (`noise-ratio.md` §5), held |

### 3.1 Claiming nothing (A)

The view is what is on screen until the exact frame is; the promise is about **time**, not quality. Two triggers,
either or both: a **dwell**, and a **narrow window** (the threshold table exists: at Q 8 a rule of two display levels
fires on every DBT preset, of four on 35 of 36 12-bit presets, `which-quality-is-visually-lossless.md`). Or no
trigger: delivery arm C2 sends the whole exact series behind the view, and the page `delivery-per-link` decides on
which links that is affordable. Cost (*derived*): one exact frame is 4.5–14 view frames at Q 8 (1 ÷ 0.22 to
1 ÷ 0.07); a reader who dwells on a fraction f of the slices fetches view × (1 + f ÷ 0.07…0.22) in all, so 1.45–2.4×
the view at f = 0.1.

What it frees: the view's Q is no longer set by a quality promise. It may stay at Q 8, move to D's step, or go
coarser as a navigation picture (Q 12–16, 0.04–0.10 on 10-bit, *measured*, `../lines/codecs.md` §Open 0.1); the
criterion for a navigation picture (nothing a reader steers by is lost) is not worked out here. What it costs: a
reader may still act on the view before the exact frame lands; the label's state and the time to *✓ Lossless* are
then the safety argument, and that time is a phone's to measure. It is the one option consistent with the US rule
for a reader who interprets, and the shape RANZCR describes.

### 3.2 A bound on the task (C, D, G)

C and D use §1.1's table as the criterion: choose the step so that the quantizer keeps T of every finding's
detectability, whatever its size, because under x ≈ 2 the table does not depend on a. D's 0.86 is the loss of a 26 %
lower dose (T²); C's 0.96, of 8 % (*derived*). The margin `noise-ratio.md` §5.5 takes from the data (a series' own
spread of σ, 0.01–0.07 on B, 0.1–0.2 on A and C) would put the bound at x ≈ 1 on B and x ≈ 2 on A and C. On 12-bit
DBT x ≤ 2 is Q 4 where σ_min ≥ 11.5 (Δ 22.9), else Q 3; on 10-bit it is Q 4 to about Q 6 (Δ 6.88 at Q 4 against
2·σ_min of 6.8–11.2) (*derived* from `noise-point.md` §2 and §4's tables).

D is a bound on the model's quantizer, carried to AV1 on the assumption that below x ≈ 2 AV1's error is added and
white, which the low-Q rows support (e_N within 10 % of Δ ÷ √12, *measured*, `noise-point.md` §2) and R3 tests. It
needs no fitted constant except σ, so it carries as §1.2's form does. G is the measurement that would replace the
model with AV1's own number and could show the rule's Q safe after all (`noise-ratio.md` §5.4, P3); it encodes, so
it waits for the owner.

### 3.3 Only noise removed (E)

If exact − decoded is a sample of the frame's noise and nothing else, the view is the acquisition with less noise.
The denoising literature tests exactly this on a method's removed part (*source* owed, §Sources N3; *unverified*
until read). Three tests, none fitted to a dataset: the difference is uncorrelated with the decoded frame's edges;
its spectrum has the shape of the noise's own (from the slice-to-slice second difference, `noise-ratio.md` §3.6);
its tile variances follow the tile σ. Each fails on a blocky, low-pass or edge-bound difference, the cases r is
blind to (`noise-ratio.md` §3.1). All three need the decoded samples: the rows keep three RMS values of the
difference a frame (e, e₄, e_N), enough for a necessary condition (R3, R4) and no more.

## 4 · The owner's open decisions, mapped (`../lines/codecs.md` §Open 0)

| decision | under A | under B | under D |
| --- | --- | --- | --- |
| 0.1 one bar of 1.03? | moot: no bar carries a claim | no bar resolves it; quote [Q_lo, Q_hi] with ν (§1.1) | moot: the threshold is x ≤ 2, on the steep part |
| 0.2 keep Q 8 hard-coded, labelled a candidate? | yes, as an interim picture, labelled lossy with its ratio | "candidate" of a criterion that cannot confirm it | no: Q per series from σ_min |
| 0.3 quote bytes at the rule's Q? | quote Q 8's as Q 8's, with the exact frames a reader fetches | yes, as a band | quote D's (R8) |
| 0.4 may the view be temporally denoised? | yes, it is interim; say so in the label's facts | needs a new rule (it spends the noise the anchor keeps) | no: a filter removes noise outside the quantizer, and T no longer describes it |
| 0.9 stop saying "also for diagnosis"? | **yes** | **yes** | **yes**: every option; §1.4 |

## 5 · Reads (pre-registered; VL-READS runs them on the committed rows, encoding nothing)

Rows, all on `claude/unified`: **B** = `lab/av1/audit/rows/b.jsonl` (`series`, `split` and `cell` rows; per frame
`mse_in`, `err_band`, `err_noise_band`; per cell `sigma_out`, `units`, `q`, `g`); **S** =
`lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl` (the ladder Q 1, 2, 4, 8, 12, 16 …; `control` rows hold HTJ2K's bytes);
**T** = `lab/av1/metrics/rows/noise-point/tiles.jsonl.gz` (six cells; per tile: frame, row, column, σ, e_N, mean
signal); **AC** = `lab/av1/metrics/rows/noise-point/ac-table.json`; **C** = `lab/av1/metrics/rows/curves.tsv`.
G 1 unless said. "The rule's Q" is the integer pick under the pooled x\* in `lab/av1/audit/rows/b-summary.json`.
x of a frame is Δ(Q, depth) ÷ its σ, Δ from AC ÷ 8. A read that cannot be computed as written is reported so, not
adapted.

| | tests | computation | prediction | refuted if |
| --- | --- | --- | --- | --- |
| R1 | §1.1: r's threshold is on a plateau, ν's is not (option F against B) | B. Per volume, δ from `b-summary.json`. Q_ν band: the integer Q at which the median frame's ν passes 0.5·(1 + δ) and 0.5·(1 − δ) | the ν band is one integer Q wide or less on ≥ 17 of 19 volumes (the r band: 4 of 19) | on < 15 |
| R2 | §1.1: at the rule's Q the fine-band error is removed noise | B. Per volume at the rule's Q, per frame: r, ν, k = (1 + r² − ν²) ÷ 2, r_q = √(r² − k²); the median frame | k ≥ 0.70 and 0.20 ≤ r_q ≤ 0.55 on all 19 | any volume outside either |
| R3 | options C, D (the error is white where x ≤ 2) and §2's second statement at the rule's Q | S and B. Per cell, the median frame's w_N = e_N ÷ e and w₄ = 4·e₄ ÷ e (both 1 for white error) | (a) in every cell whose quietest frame has x ≤ 2: 0.93 ≤ w_N ≤ 1.07 and 0.85 ≤ w₄ ≤ 1.10; (b) w_N falls with Q on every volume from x 2 up; (c) at the rule's Q, 0.65 ≤ w_N ≤ 0.95 on ≥ 15 of 19 | (a) any cell outside: D's premise fails there; (b) a rise over 0.02 between rungs; (c) on < 15: if above 0.95 the error is white and one band did suffice; if below 0.65 it is far from it |
| R4 | option B off its band: is the error within the noise at the 4 × 4 scale | S and B. L = √2·e₄ ÷ `step_band` of the same frame pair, the median over frames; a lower bound on e₄ over the noise at that scale if neighbouring slices' noise is uncorrelated there (anatomy only raises `step_band`); also at ρ = 0.27, L·√0.73 | at the rule's Q, 0.15 ≤ L ≤ 0.75 on all 19: the read does not refute B, and cannot confirm it | L ≥ 1 on any volume: there the error exceeds the noise at that scale whatever the anatomy |
| R5 | §1.3: the window chooses the samples | T. Per cell, tiles by decile of mean signal; R = (RMS of tile e_N ÷ RMS of tile σ) in the lowest decile over the same over all tiles | the four cells a rung under x\* (`dbts_a1` G 1 and 16, `dbts_b1` G 16, `dbts_c1` G 16): 1.05 ≤ R ≤ 1.30; the two at x\* (`dbts_b1` G 1 Q 12, `dbts_c1` G 1 Q 8): 1.00 ≤ R ≤ 1.08, and the lowest decile's own ratio 1.00–1.10 (the plateau) | R < 1.05 on any of the four: the window does not matter to the ratio on that volume; outside the bands on the two |
| R6 | §1.2: the form carries over dose on one system | B. Per volume, all (frame, Q) points; bins of x 0.25 wide between 3 and 6 holding ≥ 2 values of Q; the spread (max − min) of r, and of ν, within a bin | r: ≤ 0.03 in every bin on ≥ 17 of 19 volumes; ν: ≤ 0.06 on ≥ 15 | on fewer: within one volume the statistic is not a function of x alone |
| R7 | §1.1's table as a description of AV1 | B and AC. Per cell with 3 ≤ x ≤ 5.5 (median frame): the zero bin t that gives the measured ν in the model (levels at multiples of x beyond ± t), then the model's r at that t | the model's r is within 0.05 of the measured r in ≥ 80 % of those cells | in < 60 %: the table's last row is not a description of AV1 |
| R8 | options C and D's bytes | B, S and AC. Per volume, the highest Q read with x ≤ 2 at the quietest frame (and x ≤ 1): the sum of `units` over HTJ2K's bytes | x ≤ 2: 0.22–0.55 on all 19; x ≤ 1: 0.50–0.80 | any volume outside |
| R9 | the label's fact, against the only numbers guidelines give | C. Per volume, `ratio` at Q 8 and at the rule's Q | at Q 8: over 25 : 1 on every 12-bit volume, under 15 : 1 on every 10-bit one | either fails on ≥ 2 volumes |

**What each outcome decides.** R1 holding makes F the resolvable form of "keep the noise" and retires the bar
question (0.1). R2 holding fixes the wording of B's fact ("removes k of the fine-band noise and adds r_q"). R3 (a)
failing withdraws C and D as derived bounds for those cells. R4 or R5 refuting narrows B's sentence to the band and
the frame it was read on. R6 failing confines even the form to the volumes read. R7 failing leaves §1.1's worry
without a number until G runs. R8 and R9 are the costs VL-PAGE quotes. None of them can show the view visually
lossless or task-safe.

## 6 · What the rows cannot decide (for the next queue; each names its cost)

* **E, only noise removed:** the three tests of §3.3 on decoded samples. The streams are not committed; coding them
  again is an encode (deterministic: the rows keep each unit's hash). About the 57 check rungs of `audit-protocols.md`
  §B, or the rule's Q alone on 19 volumes.
* **G, the model observer:** `noise-ratio.md` §5 as written, about 460 encodes of 16 frames. Its P3 is the direct test
  of §1.1's table; this file adds one arm worth its cost: the same lesions at D's step (x ≤ 2).
* **The narrowest window and the quiet band:** the displayed-level moves at the narrowest window the viewer allows,
  in the lowest signal decile (`vl-metrics.md` §4 items 1, 4).
* **Alternation:** `noise-ratio.md` §5.7 and the quality study's §6; a reader study, no agent's. It can confirm C at
  most; §1.4 says why the rule's Q should not be expected to pass.
* **A second vendor, a denoising reconstruction:** one volume of each through σ, ν and R3 (audit F8).
* **A:** the time from a dwell to *✓ Lossless* on a phone, and what counts as a dwell.

## Sources

Regulatory and guideline texts are quoted as [`visually-lossless.md`](visually-lossless.md) (read 2026-11-02) and
[`vl-metrics.md`](vl-metrics.md) (read 2026-11-09) quote them, each with its URL and revision in those files'
§Sources: FDA *Display Devices for Diagnostic Radiology*, 2022-09-28, §VIII (<https://www.fda.gov/media/95527>);
88 FR 15126, 2023-03-10, Response 100 (govinfo.gov); ACR–AAPM–SIIM *Technical Standard for Electronic Practice of
Medical Imaging*, rev. 2022, §B (<https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=136>); DICOM PS3.5
2026d §8.2.4 (<https://dicom.nema.org/medical/dicom/current/output/html/part05.html>); StrlSchV §127
(gesetze-im-internet.de); ESR, doi:10.1007/s13244-011-0071-x (PMC3259360); RANZCR v2, 2020-08-13 (ranzcr.com);
Erickson, Krupinski, Andriole, *J Digit Imaging* 23(5):639–643, 2010, doi:10.1007/s10278-009-9221-9 (PMC2950269);
Kim B et al., *Med Phys* 38(2):836–844, 2011, doi:10.1118/1.3538925 (abstract). Zhao and Zhao, *Med Phys*
35:5219–5232, 2008, doi:10.1118/1.2996014, as [`noise-ratio.md`](noise-ratio.md) §3.5 quotes it. libaom v3.15.1
`av1/common/quant_common.c`, as [`noise-point.md`](noise-point.md) §2 quotes it.

**Re-read by this row:** see §Sources, re-read, below.

**Owed, and marked *unverified* where used:** N1, a primary source that mammographic quantum noise is Poisson and
that DBT slice noise is coloured by the reconstruction beyond Zhao and Zhao's sentence; N2, Rose's criterion in a
primary text; N3, the denoising literature's test of a method's removed part (Buades, Coll and Morel 2005).
