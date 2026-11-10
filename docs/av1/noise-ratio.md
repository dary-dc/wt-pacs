# The noise ratio as a criterion for visually lossless

Row NOISE-RATIO-THEORY, 2026-11-10. Theory and a pre-registered protocol only: nothing was encoded, decoded or timed.
Each claim is one of three kinds. A **quoted** claim gives a primary source verbatim, with its DOI or URL, all read
2026-11-10, and most of them from the abstract alone. A ***derived*** claim is this file's own arithmetic, with the
script in `lab/av1/metrics/noise_ratio_theory.py`. An ***unverified*** claim is one whose source text was not read.

## Terms

* **Noise ratio, r.** The ratio e_N ÷ σ. Both terms are measured in the noise band (`lab/av1/metrics/README.md` §4.4):
  σ is the exact frame's noise and e_N is the coding error's RMS, each taken through the 3 × 3 Laplacian ÷ 6
  ([`../glossary.md`](../glossary.md)).
* **OQ view.** The optimal-quality view: the lossy stream at the Q that the noise rule picks per series
  ([`noise-point.md`](noise-point.md) §4). This is the design of 2026-11-09 (`docs/lines/codecs.md`).
* **Exact frame.** The source frame, which HTJ2K returns bit for bit.
* **Signal.** A lesion, or a model of one, that a reader or a model observer has to detect.
* **d′.** Detectability: the difference between the observer's mean statistic with the signal and without it,
  divided by the statistic's standard deviation.
* **NPS, W(f).** The noise power spectrum, the variance per unit of spatial frequency f. W_n is the NPS of the image
  noise and W_e that of the coding error.

## Verdict

To be completed with §1–§5.

## 1 · Why error below the image's noise could be invisible

**1.1 Noise sets the threshold for anything added to it.** In vision science, the threshold for a pattern seen in
noise is factored into two parts: the observer's efficiency, and the observer's own equivalent noise added to the
display's noise.

> "it is often useful to measure the human observer's threshold with and without a noise background added to the
> display, to disentangle the observer's ability from the observer's intrinsic noise. And when we know how much
> noise there is, it is often useful to calculate ideal performance of the task at hand, as a benchmark for human
> performance."
> — Pelli DG, Farell B. Why use noise? *J Opt Soc Am A* 16:647–653 (1999), doi:10.1364/JOSAA.16.000647

The same paper's equation is threshold energy ∝ (N + N_eq), with N the display's noise spectral density and N_eq the
observer's. It is *unverified*: that text is not in the abstract. Taken as the paper's model, it means the image's
own noise raises the threshold for every signal in its band. It also means a pattern far below that noise level is
far below threshold. This is the hope behind the noise ratio. It holds only where both of these are true:

* the coding error behaves like the noise; and
* the observer has to detect the error *against* the noise, not against a copy of the same noise.

§1.4 shows that the flicker test breaks the second condition.

**1.2 Masking by a pattern, and by noise.** Masking is strongest when the masker shares the signal's band:

> "For high contrast maskers at all frequencies, signal thresholds were related to masking contrast by power
> functions with exponents near 0.6. For a range of low masking contrasts, signal thresholds were reduced by the
> masker."
> — Legge GE, Foley JM. Contrast masking in human vision. *J Opt Soc Am* 70:1458–1471 (1980),
> doi:10.1364/JOSA.70.001458

Masking is tuned to band. Legge and Foley's tuning functions have "half-maximum frequencies that lie 3/4 octave below
and 1 octave above the signal frequency" (same abstract). So noise in one band does little to mask error in a band
an octave or more away (*derived* from that tuning). Two consequences:

* The low-contrast "facilitation" (a dip in threshold) means a faint masker can make a faint error *easier* to see.
  Below-threshold noise is therefore no guarantee.
* Masking in medical backgrounds goes beyond the noise. Burgess and colleagues measured detection in two-component
  noise, a white part plus a low-pass "background":

> "Contrast threshold elevation was not linearly related to the rms background contrast. Our results gave power-law
> exponents near 0.6, similar to that found for deterministic masking."
> — Burgess AE, Li X, Abbey CK. Visual signal detectability with two noise components: anomalous masking effects.
> *J Opt Soc Am A* 14:2420–2442 (1997), doi:10.1364/JOSAA.14.002420

**1.3 Contrast sensitivity in the band the criterion uses.** The visual system analyses an image in separate
frequency bands, and its sensitivity varies with frequency and with orientation:

> "These findings can be explained by the existence within the nervous system of linearly operating independent
> mechanisms selectively sensitive to limited ranges of spatial frequencies."
> — Campbell FW, Robson JG. Application of Fourier analysis to the visibility of gratings. *J Physiol* 197:551–566
> (1968), doi:10.1113/jphysiol.1968.sp008574

> "Visual resolving power is known to be poorer for objects oriented obliquely as compared with horizontal and
> vertical orientations."
> — Campbell FW, Kulikowski JJ, Levinson J. The effect of orientation on the visual resolution of gratings.
> *J Physiol* 187:427–436 (1966), doi:10.1113/jphysiol.1966.sp008100

The nearest primary study of codec error is Watson and colleagues on wavelet quantization noise:

> "Thresholds increase rapidly with wavelet spatial frequency. Thresholds also increase from Y to Cr to Cb, and with
> orientation from lowpass to horizontal/vertical to diagonal. [...] This allows calculation of a "perceptually
> lossless" quantization matrix for which all errors are in theory below the visual threshold."
> — Watson AB, Yang GY, Solomon JA, Villasenor J. Visibility of wavelet quantization noise. *IEEE Trans Image
> Process* 6:1164–1175 (1997), doi:10.1109/83.605413

These thresholds were measured on a uniform field, not on a noisy one. They depend on display resolution in pixels
per degree. §3 shows that the 3 × 3 Laplacian's band is the diagonal, highest-frequency corner, which is the band
where Watson's thresholds are highest. So for a reader, error kept in that band is the least visible kind of error,
with or without noise to mask it. That is a separate reason for invisibility from masking.

**1.4 Detecting a change in a noisy image is not detecting a signal in noise.** Two tasks have to be kept apart:

* **Static, one image at a time.** The reader sees either the exact frame or the OQ view, and must judge from the
  texture alone whether it was coded. The question becomes whether the reader can tell a noise of variance σ² from
  one of variance σ²(1 + κr²), where κ is the error's correlation with the noise (§2.3). That is variance
  discrimination. The literature finds it relatively inefficient, and less efficient than discrimination of the
  higher moments:

  > "Observers discriminated more efficiently between textures that had differences in kurtosis, than between
  > textures that had differences in either variance or skew."
  > — Kingdom FAA, Hayes A, Field DJ. Sensitivity to contrast histogram differences in synthetic wavelet-textures.
  > *Vision Res* 41:585–598 (2001), doi:10.1016/S0042-6989(00)00284-4

  > "A dipper function (both facilitation and masking) is predicted on purely statistical grounds by a noisy
  > variance-discrimination mechanism. [...] We speculate that a threshold nonlinearity like this prevents the visual
  > system from including its intrinsic noise in texture representations and suggest that similar thresholds prevent
  > the visibility of other artifacts that sensory coding would otherwise introduce, such as blur."
  > — Morgan M, Chubb C, Solomon JA. A 'dipper' function for texture discrimination based on orientation variance.
  > *J Vis* 8(11):9 (2008), doi:10.1167/8.11.9

  This literature concerns orientation and contrast histograms of synthetic textures, not radiographic noise. It
  supports a weak claim only: a change in noise variance of order r² ≤ 1 is not obviously visible. It gives no
  threshold for r (*derived*: none of these papers measures one in the units used here). Kingdom's result points the
  other way for sparse, peaky error such as ringing at edges, whose histogram is kurtotic. Such error is better seen
  than Gaussian error of the same variance (§4.1).

* **Alternation without a blank** (the study's §6 flicker test, after Kim et al. 2011). The exact frame and the OQ
  view share one noise realization. What changes between the two presentations is e itself, and nothing else. The
  noise is the same in both, so it gives no masking by uncertainty. It masks only as a pedestal, Legge and Foley's
  pattern masking with exponent near 0.6. The error, at e_N ≈ σ, flickers on top of a noise of the same size and
  tends to be seen as the texture "boiling" (*derived* from §1.2 and the task's structure, not measured). So **the
  noise ratio predicts invisibility far more strongly for the static task than for the flicker task.** If the
  flicker test is the bar, r ≤ 1 is not a strong prediction of passing it. It also follows that a criterion can be
  visually lossless in reading and still fail a flicker test, and the owner should decide which one defines the term.

**1.5 What this section supports.** On the vision science alone, r ≤ 1 is a sound reason to expect *static*
invisibility, under three conditions:

* the error is noise-like (Gaussian, unstructured);
* it shares the noise's band; and
* the viewing makes that band near or beyond the eye's high-frequency falloff.

It is no reason to expect invisibility under flicker, and none for structured error. No source read here gives a
numeric r at which a perturbation added to a medical image becomes visible: that number is *unverified* in the
literature, and has to be measured.

## 2 · Task-based quality: what the error does to lesion detectability

**2.1 The observers.** Medical imaging defines image quality by how well a task can be done with the image:

> "Image quality can be defined objectively in terms of the performance of some "observer" (either a human or a
> mathematical model) for some task of practical interest. [...] The mathematical observers considered include the
> ideal Bayesian, the nonprewhitening matched filter, a model based on linear-discriminant analysis and referred to
> as the Hotelling observer, and the Hotelling and Bayesian observers modified to account for the
> spatial-frequency-selective channels in the human visual system. [...] Only the Hotelling model with channels is
> mathematically tractable in all cases considered here and capable of accounting for all of these data."
> — Barrett HH, Yao J, Rolland JP, Myers KJ. Model observers for assessment of image quality. *Proc Natl Acad Sci
> USA* 90:9758–9765 (1993), doi:10.1073/pnas.90.21.9758

> "An alternative to the ideal observer is the ideal linear observer, which can still be unmanageable. Our
> alternative is the ideal linear observer constrained to a small set of channels: the channelized-Hotelling
> observer."
> — Gallas BD, Barrett HH. Validating the use of channels to estimate the ideal linear observer. *J Opt Soc Am A*
> 20:1725–1738 (2003), doi:10.1364/JOSAA.20.001725

> "the NPW model can also fit their data if a spatial frequency filter of a shape similar to the human
> contrast-sensitivity function is added to the NPW observer model. The best fit is achieved by use of an eye-filter
> model E(f) = f1.3 exp(-cf2), with c selected to yield a peak at 4 cycles/deg."
> — Burgess AE. Statistically defined backgrounds: performance of a modified nonprewhitening observer model.
> *J Opt Soc Am A* 11:1237–1242 (1994), doi:10.1364/JOSAA.11.001237 (the exponents are f^1.3 and cf², flattened by
> the abstract's text)

Take a signal-known-exactly (SKE) task with a signal s in stationary Gaussian noise of spectrum W(f), and let S(f) be
the signal's transform. The standard forms of d′ are then (*derived*: the Fourier forms follow from d′² = sᵀK⁻¹s and
from the NPW template being s itself; their printed form in Barrett and Myers, *Foundations of Image Science*
(Wiley, 2004), is *unverified*, as the book was not read):

| observer | d′² |
| --- | --- |
| Hotelling, which is ideal for Gaussian noise | ∫ \|S\|² ÷ W df |
| NPW | (∫ \|S\|² df)² ÷ ∫ \|S\|² W df |
| NPWE | (∫ \|S\|² E² df)² ÷ ∫ \|S\|² E⁴ W df |
| CHO, with channel matrix T | (Tᵀs)ᵀ (TᵀKT)⁻¹ (Tᵀs) |

Human data in mammographic backgrounds fall between these models. Burgess and colleagues, with lesions inserted
digitally into real mammograms, found that "Human efficiency relative to these models was as high as 90%" for
prewhitening models. They concluded: "in spite of the fact that mammographic backgrounds have nonstationary
statistics, models based on statistical decision theory can still be applied successfully to estimate human
performance" (Burgess AE, Jacobson FL, Judy PF. Human observer detection experiments with mammograms and power-law
noise. *Med Phys* 28:419–437 (2001), doi:10.1118/1.1355308). For DBT, the closest primary source found warns that
the standard models misrank signals in *search*:

> "We evaluated current standard models observers (Hotelling; Channelized Hotelling; non-prewhitening matched filter
> with eye filter, NPWE; and non-prewhitening matched filter model, NPW) and showed that they incorrectly predict the
> relative detectability of the two signals in 3D search."
> — Lago MA, Abbey CK, Eckstein MP. Foveated model observers to predict human performance in 3D images. *Proc SPIE*
> 10136:101360P (2017), doi:10.1117/12.2252952

So a model-observer test of the noise ratio (§5) speaks for location-known detection. It does not speak for search,
which is what screening is.

**2.2 Independent white error (*derived*).** Let the error be independent of both noise and signal, with spectrum
W_e. Then every observer above sees a noise of W_n + W_e.

* **The white-on-white case.** Take W_n = σ² and W_e = r²σ² at every f, so that e_N ÷ σ = r in every band, the
  Laplacian's included. Then **d′ falls by the factor 1 ÷ √(1 + r²)** for Hotelling, NPW and NPWE alike. At r = 0.3
  the factor is 0.958, at 0.5 it is 0.894, at 0.7 it is 0.819, and at 1.0 it is 0.707.
* **What r = 1 means.** For a quantum-limited system the ideal d′² is proportional to dose. So independent white error
  at r = 1 costs the ideal observer what **halving the dose** would. That is not small: in this reading, "the error
  stays within the noise" bounds the loss to a 29 % fall in d′, but it does not make the loss negligible.
* **A spectral bound, and why e_N alone does not give it.** If W_e(f) ≤ r² W_n(f) at every f where S(f) ≠ 0, each
  integrand above falls by at most 1 ÷ (1 + r²). So d′_coded ÷ d′_exact ≥ 1 ÷ √(1 + r²), for Hotelling, NPW and NPWE.
  e_N ≤ σ is a statement about *one band*, and the band holds essentially none of a lesion's energy (§2.5). It bounds
  W_e there and nowhere else. Error at frequencies where the Laplacian has no gain passes the test at any size (§3).

**2.3 The encoder removes noise: anticorrelated error (*derived*).** A quantizer does not add independent noise once
its step is near σ. Write the error in a band as e = −a·n + u, with u independent of the noise n. The coded band
then carries noise of variance

σ_coded² = σ² + e_N² + 2 cov(e, n) = σ² (1 + κ r²), where κ = 1 + 2 cov(e, n) ÷ e_N².

Independent error has κ = +1 and adds noise. Pure removal (u = 0, a = r ≤ 1) gives κ = 1 − 2 ÷ r and σ_coded =
σ(1 − r): at r = 1, κ = −1 and the band is emptied. A uniform mid-tread quantizer on Gaussian noise of σ 1 gives:

| x = Δ ÷ σ | 0.5 | 1 | 2 | 3 | 3.5 | 4 | 4.93 | 6 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: |
| r | 0.144 | 0.289 | 0.575 | 0.805 | 0.880 | 0.930 | 0.978 | 0.995 |
| κ | +1.00 | +1.00 | +0.91 | +0.31 | −0.02 | −0.32 | −0.70 | −0.91 |

The model's r follows the rows' measured curve: 0.29, 0.54 and 0.99 at x 1, 2 and 4–5
([`noise-point.md`](noise-point.md) §3). The model is not AV1: it has no rate-distortion optimisation, no trellis and
no deadzone rounding. The rows' plateau of 1.04–1.08 above the anchor shows that AV1 removes noise and adds some error
besides. So **at the anchor x\* ≈ 4.93 the OQ view is in the removal regime.** In this model the finest band's noise
variance falls to about σ²(1 − 0.70 · 0.96) ≈ 0.33 σ². It does not rise by √2, as `lab/av1/metrics/README.md` §5 (a)
and [`noise-point.md`](noise-point.md) §1 read it. That reading holds only for κ = +1, which is Q ≤ 4 on 12-bit DBT
(x ≤ 2). Both places are corrected in place to point here. This file's κ is *derived* from a model. §5 P1 measures
it on the fixtures from σ of the decoded frame.

**What removal does to the observers.** The ideal observer loses no information from the removal of a band that
holds only noise. It loses whatever part of the signal's SNR² was removed with that band. NPW and human observers can
*gain*, because they do not prewhiten and the removed noise was hurting them. Abbey and Barrett saw both effects, on
simulated reconstructions:

> "In the regularization study, performance exhibits a mild peak at intermediate levels of regularization before
> degrading at higher levels."
> — Abbey CK, Barrett HH. Human- and model-observer performance in ramp-spectrum noise: effects of regularization
> and object variability. *J Opt Soc Am A* 18:473–488 (2001), doi:10.1364/JOSAA.18.000473

Model-observer studies of codecs show the same thing. Encoder settings move detectability at a fixed ratio, in both
directions:

> "Compared to the default JPEG 2000 encoder settings, the NPWE-optimized encoder settings improved the detection
> performance of humans and the other three model observers for an SKEV task."
> — Zhang Y, Pham BT, Eckstein MP. Automated optimization of JPEG 2000 encoder options based on model observer
> performance for detecting variable signals in X-ray coronary angiograms. *IEEE Trans Med Imaging* 23:459–474
> (2004), doi:10.1109/TMI.2004.824153

**2.4 Removal also erases faint signals (*derived*).** A quantizer zeroes a coefficient whose value, signal plus
noise, falls inside its zero bin. It does not know which part was signal. Take white noise, so that every orthonormal
transform coefficient sees the same x. A signal spread over K coefficients, each of amplitude a·σ, has an exact-frame
ideal d′ of a√K. At x 4.93 the zero bin is |c| < 2.465σ:

| a | K | exact d′ | P(a coefficient is zeroed) |
| --: | --: | --: | --: |
| 1.0 | 9 | 3.00 | 0.93 |
| 0.7 | 25 | 3.50 | 0.96 |
| 1.5 | 4 | 3.00 | 0.83 |

A lesion that the ideal observer finds easily in the exact frame is mostly deleted, together with the noise, wherever
its energy is spread thin over coefficients. Two cases follow:
* **A mass** concentrates its energy in a block's few lowest coefficients. In a 32 × 32 block, a mean offset of c·σ
  gives a DC coefficient of 32·c·σ, which survives.
* **A small, faint calcification** spreads its energy over many coefficients. Take one of peak A and Gaussian σ 1 px:
  its energy is ≈ 2π A², and in an 8 × 8 block each coefficient carries ≈ 0.31 A. At A = 2σ its white-noise d′ is
  ≈ 5. To survive the zero bin it would need A ≳ 8σ.

This is the theory's central worry: **the regime where r reaches 1 is the regime in which a quantizer erases signals
of per-coefficient amplitude below about 2.5σ.** That includes signals an ideal observer detects with d′ 3–5. Real
AV1 differs from the model: rate-distortion optimisation weighs distortion per block, DC and AC steps differ, and DBT
noise is not white. How much of this survives in AV1 is *unverified* and is what §5 measures. The one primary
compression study of mammography with model observers found here agrees in direction: "a reduction in detection with
increased compression for microcalcifications at 30:1 compression", with "almost no variation" for simulated masses.
That source is Suryanarayanan S, Karellas A, Vedantham S, Ved H, D'Orsi CJ, Evaluation of detection in compressed
digital mammograms using numerical observers, *Proc SPIE* 5034:513–521 (2003), doi:10.1117/12.480363. It was read
from its catalogue page (<https://experts.arizona.edu/en/publications/evaluation-of-detection-in-compressed-digital-mammograms-using-nu/>),
and only the first excerpt is verbatim. JPEG 2000 on 2D mammograms is not AV1 on DBT.

**2.5 How much lesion signal the band holds (*derived*).** The share of a Gaussian signal's white-noise SNR² that lies
in the Laplacian's band, weighted by the band's gain:

| signal σ | 0.5 px | 1 px | 2 px | 5 px | 25 px |
| --- | --: | --: | --: | --: | --: |
| share in the band | 0.22 | 0.007 | < 10⁻⁴ | < 10⁻⁴ | < 10⁻⁴ |

The band holds nearly nothing of any lesion wider than a pixel. Removing that band alone would cost an ideal observer
almost nothing. What costs d′ is that the quantizer acts at every frequency (§2.4), while r looks at one band only.

**2.6 Does "coding error ≤ noise" bound the loss? (*derived*).** Only under assumptions the OQ view does not meet:

1. **If the error is independent and white on white noise,** r ≤ 1 bounds the fall in d′ to 1 ÷ √2 for every linear
   observer. The bound is real, but it is the loss of halving the dose, not a negligible one.
2. **If the error's spectrum stays under r² times the noise's at every frequency the signal occupies,** the same bound
   holds whatever the spectra. e_N measures one band and cannot establish this.
3. **At the anchor the error is anticorrelated (κ ≈ −0.7).** Here r says how much noise was removed, and it is silent
   about the signal removed with it. The loss in d′ is not bounded by r. The model says it is small for masses and can
   be large for faint, small signals.

So r ≤ 1 is a **necessary-looking but not sufficient** criterion for task performance. It is sound as a guard against
added independent error at low Q. At the Q the rule picks, it is a measure of noise removal. Whether that removal
costs detectability is an empirical question, which §5 sets out.

## 3 · Is the finest band the right place to compare?

**3.1 What the band is (*derived*).** The kernel N = [1 −2 1; −2 4 −2; 1 −2 1] is the outer product of
(1, −2, 1) with itself. Its gain is H(u, v) = (2 − 2 cos u)(2 − 2 cos v) ÷ 6, with u and v in radians per pixel, and
its mean power gain on white noise is 1. Three properties follow:

* **It is zero along both axes.** Anything constant along rows or along columns passes with gain 0.
* **It sits in the diagonal corner.** 85 % of its power lies where both |f_x| and |f_y| exceed 0.25 cycles/pixel.
  Only 0.07 % lies below 0.25 cycles/pixel radially.
* **So "the noise band" is the band of the highest diagonal frequencies.** In what it passes, error that is not white
  shrinks against its full-band RMS e:

| error | white | blurred by 0.5 px | by 1 px | by 2 px | constant 4 × 4 blocks | constant 8 × 8 blocks | stripes |
| --- | --: | --: | --: | --: | --: | --: | --: |
| e_N ÷ e | 1 | 0.47 | 0.084 | 0.007 | 0.17 | 0.084 | 0 |

**An error of 8 × 8 constant blocks passes r ≤ 1 at a full-band RMS of up to 12σ.** A low-pass error of 1 px passes
at the same size.

**3.2 Why the band is right for measuring σ.** Breast anatomy has a steep power-law spectrum. Burgess and colleagues
built their backgrounds to match it: "filtered noise backgrounds with the same average power spectrum, P(f)=B/f3"
(Burgess 2001, doi:10.1118/1.1355308). In the corner, anatomy has the least power and noise the most. It is nearly
the only band in which one frame gives σ without a second realisation. Measured that way, the estimator is checked
to 3 % on synthetic frames ([`noise-point.md`](noise-point.md) §6), and §6 of that file says why it is preferred.
This is the best reason for the band. It is a reason about *measuring the noise*, not about where error matters.

**3.3 Why the band is weak for visibility (*derived*, under stated display assumptions).** At 1 : 1 on a display of
pixel pitch p, viewed from distance D, one degree spans D · tan 1° ÷ p pixels. The values p = 0.165 mm (a 5 MP
mammography display) and D = 600 mm are this file's assumptions, *unverified* against any standard. They give 63
pixels a degree. Then:

* the band's centre, near 0.5–0.7 cycles/pixel, is 32–45 cycles/degree;
* the NPWE eye filter's peak at 4 cycles/degree (Burgess 1994, above) is 0.063 cycles/pixel.

So at 1 : 1 the band lies past the eye's high-frequency falloff, and on the diagonal, where sensitivity is lowest
(Campbell et al. 1966; Watson et al. 1997, §1.3). Error held there would be hard to see whether or not noise masks
it. **Magnification changes this.** At 4× zoom the band maps to 8–11 cycles/degree, inside the range the eye resolves
well. Error and noise scale together under zoom, so r does not change. That is the window argument of
[`window-q.md`](window-q.md) §1 again, with zoom in place of window. The ratio is zoom-independent; what a reader can
see of it is not.

**3.4 Why the band is wrong for tasks.** §2.5: the band holds less than 1 % of the SNR² of any lesion wider than
σ 1 px. For linear observers, the right place to compare error with noise is the signal's own band, weighted by
how much the observer uses each frequency. To first order in W_e ≪ W_n, the Hotelling loss is (*derived*)

Δd′² ÷ d′² ≈ − ∫ |S|² W_e ÷ W_n² df ÷ ∫ |S|² ÷ W_n df.

This is a signal-weighted average of W_e ÷ W_n. The noise ratio is that same quantity with |S|² replaced by the
Laplacian's |H|², and |H|² has its weight where |S|² has none.

**3.5 DBT noise is not white.** The reconstruction shapes it:

> "The shape of the NPS was affected by the reconstruction filters. [...] Aliasing increases the noise at high
> frequencies, which causes degradation in DQE."
> — Zhao B, Zhao W. Three-dimensional linear system analysis for breast tomosynthesis. *Med Phys* 35:5219–5232
> (2008), doi:10.1118/1.2996014

The study measured the consequence on this estimator. Noise blurred by 0.5 px reads 66 % of its σ, and on
`dbt12_ea1141` Immerkær reads 11.4 where the Haar MAD reads 14.8 (`lab/av1/metrics/README.md` §4.4). Two things
follow. σ is the noise in the corner, not the noise where lesions are. And with W_n not flat, a ratio that holds in the
corner says nothing about W_e ÷ W_n one octave down (*derived*).

**3.6 A better place, and its cost.** The band-by-band form of the criterion is r_b = e_b ÷ σ_b in each band b of a
pyramid. e_b is easy, since the exact frame is known. σ_b is not, below the corner, because anatomy dominates a
single frame there. One candidate estimator uses the stack: the second difference across slices,
n̂ = I_k − (I_{k−1} + I_{k+1}) ÷ 2. It cancels anatomy that varies linearly in depth, and its noise variance is
σ²(1.5 − 2ρ₁ + ρ₂ ÷ 2), where ρ₁ and ρ₂ are the noise correlations at one and two slices (*derived*). ρ₁ is
0.11–0.27 on the fixtures (`docs/av1/frame-groups.md`). Whether 1 mm slices make anatomy close enough to linear in
depth is *unverified*. §5 P5 measures it as an exploratory arm. Until then the per-band ratio is a proposal, not
a criterion.

**3.7 Answer.** The finest band is the right place to *measure the noise* and the wrong place to *judge the error*:

* for tasks, it holds almost no lesion signal (§3.4);
* for vision, it is the least visible band at 1 : 1 (§3.3);
* it is blind to blocky, axis-aligned and low-pass error (§3.1).

r ≤ 1 there is meaningful as a statement that the error is noise-like in size *and* lives where noise lives. It
becomes a criterion only together with a guard against error elsewhere. §4 lists what such error looks like, and §5
measures the task loss directly.

## 4 · Known failure modes

Each entry gives the mechanism, what the fixtures already show, and the guard it needs. All the mechanisms are
*derived* from §1–§3 unless a measurement is cited.

**4.1 Structured or blocky error.** Error that is block-constant, axis-aligned or low-pass escapes the band
(§3.1). A reader sees it better than noise of equal variance:

* it is coherent over a region, and the visual system's band-limited mechanisms integrate a coherent pattern
  (Campbell and Robson 1968);
* it is not Gaussian, and a kurtotic difference is discriminated more efficiently than a change of variance
  (Kingdom et al. 2001).

AV1's in-loop filters (deblocking, CDEF, loop restoration) reduce block edges. What they leave is *unverified* here.
**Guard:** the full-band ratio e ÷ σ, which the study reports beside e_N ÷ σ, and a low-band ratio (§3.6).
Neither is a criterion yet.

**4.2 Error at edges.** The σ estimator leaves out the steepest 10 % of samples by gradient. e_N does not leave them
out: `noise_band` takes every in-window sample. Even so, an edge region's error is averaged with the rest of the
frame. Error there is partly masked by the edge's own contrast, with Legge and Foley's exponent near 0.6. But the
edge of a lesion or a calcification *is* the signal, and §2.4 says faint edges are what the quantizer deletes.
**Guard:** the tile reading of [`noise-point.md`](noise-point.md) P4, extended to edge tiles, with the inserted
lesions of §5.

**4.3 Low-noise regions.** Quantum noise rises with signal, so the quietest regions get error above their own noise
even when the frame mean holds. Measured: at the rule's Q on `dbts_b1` and `dbts_c1` G 1, 0.7–1.1 % of 64 × 64 tiles
exceed 1.03. Those tiles lie mostly in the lowest-signal third and at the breast's edge, where tile σ is 4.88 against
6.09 (B) and 11.06 against 17.98 (C) from the lowest to the highest tercile ([`noise-point.md`](noise-point.md) P4).
**Guard:** σ_min over tiles rather than frames, or AV1 segment delta-q. The owner has not decided this, and neither
is proposed here.

**4.4 Low-noise series.** As σ approaches the rounding floor √(1/12) ≈ 0.29, the denominator stops measuring
acquisition noise. r then has no meaning, because there is no noise to mask anything. The rule already declines
these: `usb_cine` (σ 0.27–0.41) and `mr9_ispy2` (0.56–0.93), [`noise-point.md`](noise-point.md) §5.1. A series that is
heavily denoised at reconstruction lands in the same place without being lossy-sourced. **Guard:** the existing
σ floor. For such a series, no noise-based criterion exists.

**4.5 Lossy-sourced input.** On such input σ measures the earlier codec's leftovers, not acquisition noise, so the
ratio compares two codecs' errors. `usb_cine_rgb` reads σ 0.78–1.10 and passes the floor. **Guard:** the three-way
test of [`noise-point.md`](noise-point.md) §5.5 and P6. Each of its tests missed one of the three cine series, so
the guard is incomplete.

**4.6 Correlation in depth, slabs and scrolling.** At G > 1, inter prediction can carry one error pattern across
slices, while the noise's neighbour correlation is only 0.11–0.27. A reader who scrolls, or a slab view that
averages m slices, integrates the error coherently and the noise incoherently. In the limit of an error identical in
depth and independent noise, r grows by √m: 1.73 for 3 slices, 2.24 for 5, 3.16 for 10 (*derived*). The criterion is
read per frame, and it does not see this. **Guard:** r on m-slice means at G > 1, measured in §5 P4.

**4.7 Flicker and comparison.** §1.4: the alternation test removes noise masking by uncertainty. The criterion is
weakest exactly where the study's planned reader test is strongest.

**4.8 Noise removal mistaken for fidelity.** At the anchor, r ≈ 1 means that the band was emptied (§2.3). The OQ
view then looks *smoother* than the exact frame. A reader may prefer it or reject it, and an observer that does not
prewhiten may do better with it. None of these is "lossless". **Guard:** report σ of the decoded frame beside r. The
anticorrelation κ is the number that tells "error added" from "noise removed".

**4.9 Outside the fixtures.** The fixtures do not cover any of the following, so nothing here applies to them:

* σ_min above 14.8 (12-bit) or 5.6 (10-bit);
* other DBT systems;
* breast ultrasound cine and ABUS;
* any modality but DBT.

TRUS and MR already fall off the DBT curve ([`noise-point.md`](noise-point.md) §3).

## 5 · Protocol, pre-registered

A later session runs this protocol unchanged. Nothing in it has been run. It tests the criterion "r ≤ 1 on every
frame" against model observers. It does not test visibility.

**5.0 Fixtures, split before any run.** The 19 DBT volumes of [`window-q.md`](window-q.md) §Fixtures, from EA1141, are
fetched by `lab/av1/fetch_data.sh` against their SHA-256 pins.

* **Calibration set** (pilot and lesion amplitude only): `dbts_a1`, `dbts_b1`, `dbts_c1`.
* **Test set** (the verdict): `dbts_a2`–`a5`, `dbts_b2`–`b5`, `dbts_c2`–`c5`, `dbt10_ea1141`, `dbt10_d`,
  `dbt12_ea1141`, `dbt12_c`. That is 16 volumes.

**The fixtures' limits:**
* There are three systems, with σ_min 10.5–14.8 at 12 bits and 3.4–5.6 at 10 bits.
* The fixtures hold reconstructed 1 mm slices only. There are no projections, so lesions go into the image domain.
* Whether the volumes contain real findings is *unverified*. A real finding at a signal-absent site adds variance to
  both arms alike.
* The pixel spacing is not recorded in [`FIXTURES.md`](../FIXTURES.md). Step 1 reads Pixel Spacing (0028,0030),
  or the enhanced object's Pixel Measures, from each source header and records it. A series without it is dropped
  and named.
* There is no breast ultrasound cine or ABUS, and no other modality. Nothing here speaks for them.

**5.1 Stimuli.**
1. **Frames.** Per series, the 16 contiguous slices centred on the middle slice. At G 16 they make one group.
2. **Sites.** Positions are drawn with seed 20261110 + the series' index in the list above. Each site's whole ROI lies
   in-window under the first header window and at least one ROI width from the border. Centres are at least two ROI
   widths apart. ROIs are 64 × 64 px for calcifications and 128 × 128 px for masses. Alternate sites are signal-present
   and signal-absent. The target is 200 sites of each kind, per lesion type and series. Fewer are allowed, down to
   100, and the count achieved is reported.
3. **Lesions.** Each is added in stored units *before* encoding, then rounded and clipped to 0 … peak.
   * **Mass:** an in-plane Gaussian of FWHM 5 mm, with a Gaussian depth profile of σ_z 2 slices. Centres lie on
     slices 5 and 11 of the 16.
   * **Calcification:** an in-plane Gaussian of σ 0.1 mm on its slice, at half amplitude on the two neighbours.
     Centres lie on slices 3–14.

   Masses and calcifications go in separate volumes: V_m and V_c. V_0 is the unaltered volume. The depth profiles are
   this protocol's choice, *unverified* against DBT's real out-of-plane spread.
4. **Amplitude.** One amplitude per series and lesion type, found by bisection on exact frames at a separate
   calibration seed, so that the CHO's d′ on exact frames is 2.0 ± 0.1. It is then frozen. Only exact frames enter
   this step, so no coded result leaks into it.

Image-domain insertion of digitised lesions into real backgrounds is the method of Burgess et al. 2001 ("hybrid images
with digital images of tumors added to digitized normal backgrounds", doi:10.1118/1.1355308). Its limits are stated:
the noise is not modulated by the lesion, and there are no DBT out-of-plane artefacts.

**5.2 Arms.**
* **Q:** 1, 2, 4, 8, 12 and 16, plus the rule's integer Q ([`noise-point.md`](noise-point.md) P3) where it is not a
  rung.
* **G:** G 1 on all 19 volumes; G 16 on the calibration three.
* **Encoder and decoder:** `cell.py`'s `aomenc_args` unchanged, and dav1d decodes.
* **Order:** cells are run in an order shuffled with seed 20261110, interleaved across series and Q (`CLAUDE.md`
  §Measurement). Four cells are in flight, one thread each.
* **Cost (*derived*, not timed):** about 460 encodes of 16 frames, of order a few CPU hours on the study's host,
  from its 3.4–6.0 CPU s/Mpx over ten rungs (study §8). Nothing here is a timing, so no host limit binds.

**5.3 Measured per cell.**
* **(a) r per frame**, by `cell.measure`, on V_0.
* **(b) κ per frame.** σ_dec = `quality.sigma` of the decoded V_0 frame, and κ = (σ_dec² − σ²) ÷ e_N².
* **(c) Other error ratios.** e ÷ σ (full band). r on means of 3 and 5 slices at G 16, against the same means at
  G 1 (§4.6).
* **(d) Exploratory.** r_b on a 4-level Laplacian pyramid. σ_b comes from §3.6's depth second-difference, corrected
  by the measured ρ₁ and ρ₂.
* **(e) Observers, SKE, location known.** The template uses the inserted profile before rounding.
  * **CHO** with 10 Laguerre–Gauss channels; channel 0's FWHM equals the lesion's in-plane FWHM. It is trained and
    tested by 2-fold cross-validation over sites. Primary: trained on the arm's own images. Secondary: trained on
    exact frames and applied to coded ones.
  * **NPWE** with E(f) = f^1.3 exp(−c f²), peaking at 4 cycles/degree, at 63 px/degree (1 : 1, §3.3) and at
    4× zoom.
  * **NPW.**

  Each observer's statistic gives d′ = (μ_p − μ_a) ÷ √((v_p + v_a) ÷ 2), with AUC (Mann–Whitney) beside it.
  Signal-present ROIs come from V_m or V_c, and signal-absent ROIs from V_0 at the absent sites, both coded at the
  same Q.
* **(f) Ratio.** R = d′_Q ÷ d′_exact, with a 95 % percentile CI from 2 000 paired bootstrap resamples over sites
  (seed 20261110).

**5.4 Predictions (*derived* from §2–§4, fixed now).**
* **P1, regime.** κ ≥ +0.8 at x ≤ 2, and κ ≤ 0 at the rule's Q, on every G 1 series. Refuted if κ > 0 at the rule's
  Q on any series. That would mean the error is added, not removed, and §2.2's bound would apply instead.
* **P2, masses.** At the rule's Q, the CHO's R holds (§5.5) on every test series.
* **P3, calcifications.** At the rule's Q, the CHO's R *fails* on at least one system. If R holds on all of them,
  §2.4's removal worry is refuted for AV1 at these settings.
* **P4.** For calcifications at the rule's Q, R_NPWE at 1 : 1 ≥ R_CHO.
* **P5, depth.** At G 16, r on 5-slice means exceeds r per frame by more than it does at G 1.
* **P6, exploratory and unscored.** Whether r_b in the coarser bands stays ≤ 1 at the rule's Q.

**5.5 Decision rule, its margin taken from the data.**
* **The margin, per series, m_s = 1 − σ_p10 ÷ σ_p90.** The deciles are of σ over the series' own frames, computed from
  exact frames before any encode. The reasoning: an ideal observer's d′ scales as 1 ÷ σ, so the series' quiet and
  noisy slices already differ in d′ by that factor (*derived*). A coding loss smaller than that is within what the
  acquisition itself gives. From the measured σ ranges (max ÷ min 1.01–1.08 on B, 1.17–1.33 on A and 1.21–1.24 on C;
  [`noise-point.md`](noise-point.md) §5.3), m_s should come out near 0.01–0.07 on B and 0.1–0.2 on A and C (*derived*;
  the deciles are narrower than the extremes).
* **Per cell** (series, lesion, observer, Q):
  * **holds** if the CI's lower limit is ≥ 1 − m_s;
  * **fails** if its upper limit is < 1 − m_s;
  * **undetermined** otherwise.

  If the CI's half-width exceeds m_s, the site count is doubled once, where the volume allows. If it still exceeds
  m_s, the cell stays undetermined. System B's small margin makes this likely there, and the result says so; it does
  not loosen m_s.
* **Verdict for each lesion type, from the CHO, primary training, G 1, at the rule's Q, on the 16 test series:**
  * **supported** if the criterion holds on ≥ 15 series and fails on none. The one series allowed for is the
    expected count outside 16 two-sided 95 % intervals, 0.8, rounded up.
  * **refuted** if it fails on ≥ 2 series.
  * **undetermined** otherwise.
* **The data's own threshold.** Per series, Q_task is the highest Q at which the cell holds. Report the r and x at
  Q_task, and the lowest r at a failing Q over all series. That lowest r is the noise-ratio bar that model observers
  support, and it replaces 1 if the verdict says so. Q_task > rule Q everywhere means r ≤ 1 is conservative for the
  task. Q_task < rule Q anywhere means it is unsafe there.

**5.6 Checks, each mutated.**
* **M1, insertion after coding.** The lesion is added to the *decoded* V_0 instead. R must then rise wherever proper
  insertion shows a loss. This shows the pipeline sees the codec acting on the signal.
* **M2, labels shuffled.** d′ must fall within ±0.2 of 0.
* **M3, exact through the pipeline.** R must be 1 exactly.
* **M4, synthetic white case.** A flat 12-bit background with white Gaussian noise of σ 10, and independent white
  error at r 0.5 and 1. R_CHO must fall within its CI of 0.894 and 0.707 (§2.2). The mutation, error correlated with
  the noise, must miss.
* **M5, synthetic removal case.** The same background, quantized by the §2.3 model in an 8 × 8 orthonormal DCT at
  x 4.93. κ must fall within 0.05 of −0.70. The mutation, a step of x 1, must give κ ≈ +1.

**5.7 What a reader study would still have to confirm.** Model observers do not settle visual losslessness:

* **Search.** Standard observers misrank signals in 3D search (Lago et al. 2017). Screening is search; this protocol
  is location-known.
* **Flicker against static reading.** §1.4. The owner has to choose which one "visually lossless" means, and test that
  one: the study's §6 alternation test, or a static two-alternative test.
* **Real lesions and real artefacts.** That needs projection-domain insertion or cases with findings, neither of
  which the fixtures hold.
* **Display and viewing.** A GSDF-calibrated display, the series' own windows, and zoom as readers use it.
* **Readers and cases.** Breast imagers, with a multi-reader multi-case design, so that reader and case variance
  both enter the CI.
* **Licensing.** A lossy DBT view as the interpreted image is a regulatory question
  ([`noise-point.md`](noise-point.md) §1, MQSA). No measurement here answers it.
