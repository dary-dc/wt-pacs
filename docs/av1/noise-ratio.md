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
