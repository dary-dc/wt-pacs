# Frame groups in lossless AV1: why they should or should not pay

Queue row GOPTHEORY, written 2026-10-08 before any new data. What it predicts is tested by the measurement in
[`gop-protocol.md`](gop-protocol.md), and that file is the only one the measuring session is given. Everything below
comes from the sources at the end. Arithmetic of our own is marked *derived*, and a claim no source confirms is
marked *unverified*.

## 1 · What lossless AV1 keeps and what it loses

* **Lossless is a quantiser index of 0 with no delta-q** (`LosslessArray`, `CodedLossless`, `AllLossless`; [S1]
  §5.9.2, §6.8.2). Such a frame uses only a 4×4 Walsh–Hadamard transform ([S1] §5.9.21, §5.11.15, §7.13.3), and its
  deblocking, CDEF and loop restoration are off (§5.9.11, §5.9.19, §5.9.20).
* **No inter tool is gated on lossless.** Compound references, warped and global motion, OBMC, inter-intra, wedge
  masks, distance weights and reference scaling all stay available ([S1] §5.9.2, §5.9.24, §5.11.27, §7.11.3).
  Lossless changes only how the residual is coded. Intra and inter blocks code that residual the same way, so
  **lossless inter against lossless intra is purely a contest of predictors.**
* **libaom 3.15.1 still temporally filters its alt-ref in lossless mode.** Only key-frame filtering checks for
  lossless ([S2] `encode_strategy.c:746-757`). The filtered alt-ref is coded and never shown; the real frame follows
  as an overlay (`encode_strategy.c:78-99`). Lossless costs one hidden frame per group, and no rule of the
  encoder makes the hidden frame pay for itself. The lab found inter inexact at 10 and 12 bits with alt-ref on and
  exact with it off ([`README.md`](README.md) §Measured here), so every exact inter coding here so far had alt-ref off.
* **SVT-AV1 v4.2.0 switches temporal filtering off under lossless** ([S3] `enc_handle.c:3256`). It has no intra-only
  restriction, and 8 and 10 bits are intended ([S3] CHANGELOG v3.1.1). The lab found it exact only on grey 8 and on
  intra grey 10 (row TOOL), so where it is inexact the measurement reports it and does not use it.

## 2 · The mechanism: noise that the previous frame can predict

A lossless coder spends about the entropy of its prediction residual: for a residual close to Gaussian with
variance σ_r², about ½·log2(2πe·σ_r²) bits a sample ([S4] ch. 8). Write each frame as structure (anatomy, which
both predictors can follow) plus noise of variance σ² (quantum, electronic, reconstruction). In a medical frame
above 8 bits, the noise holds most of the bits: the low bits are noise in every source the lab has measured
([`split-prior-art.md`](split-prior-art.md); row ENCX).

* **Intra** predicts a sample from its spatial neighbours. On spatially white noise, no spatial predictor brings
  the noise term below σ².
* **Inter** predicts from a motion-compensated sample of the previous frame. Let ρ be the correlation of the noise
  between the two frames at the best offset. The noise term of the residual is then 2σ²(1 − ρ) (*derived*; this is the
  prediction gain 1/(2(1 − ρ)) of first-order differencing [S5]).
* **So inter beats intra on the noise only where ρ > ½.** At ρ = 0 an inter residual carries twice intra's noise
  (+0.5 bit a sample), and averaging two independent references still carries 1.5σ² (+0.29 bit) (*derived*).
* **A denoised reference cannot beat intra on independent noise.** A perfectly clean reference leaves σ², the same
  as intra. This is the most libaom's filtered alt-ref could reach, before the cost of its hidden frame.
* **Inter's other source of gain is structure that intra predicts badly**: texture, fine edges, and the speckle of
  ultrasound. Speckle is deterministic for a fixed tissue and probe position [S9], so it behaves as structure, not
  as noise.

Two consequences are checkable without an encoder:

1. **On noise-dominated content, the gain of inter is bounded by ρ.** It can be measured from the frames: the
   correlation of each frame's intra prediction residual with the next frame's, block by block at the best integer
   offset. Where the median block ρ is under ½, the noise term cannot pay, and any gain must come from structure.
2. **The low stream of a split** (the k low bits, row SPLITRULE's k = 2 or 3) is noise with ρ ≈ 0. **Inter on the
   low stream should cost bytes, never save them.** Row ENCX measured this: inter was 0–3.6 % larger.

## 3 · Each target type

### DBT reconstructed slices

* **The geometry.** A volume is reconstructed from the same 9–25 projections, taken over 11–50° depending on the
  system ([S6] Table 1). Slices are about 1 mm apart, against about 0.1 mm pixels in-plane ([S6], [S7]). A feature
  in one plane reappears in its neighbours, shifted and repeated ([S7], artifacts).
* **The noise.** The 3-D noise power spectrum is band-limited in z by the reconstruction's slice-thickness filter and
  shaped by the angular range [S8]. So adjacent slices share some noise, and a narrow arc shares more than a wide one.
  No source gives a value of ρ (*unverified*).
* **Why one motion vector cannot follow it** (*derived*). One plane's contribution of each projection moves by
  Δz·tan θ between slices, which at 1 mm is 0 to 4.7 px over ±25°. So the noise is a sum of fields, each shifted by a
  different amount, and no single offset aligns them all. Prediction: ρ is moderate (0.2–0.5) at the best offset,
  and higher on narrow-arc systems.
* **Prior evidence.** 3-D JPEG 2000 across all slices gained 3 % over single frames on 25 DBT objects from one system,
  most of it already with a 10-slice slab [S10], from slides that were not peer-reviewed. In the lab, rows CONTENT
  and BREAST measured groups on four volumes at −3.7 to +5.4 % of intra, with libaom only and alt-ref off
  ([`README.md`](README.md) §A1, Scope).
* **The general literature** finds lossless inter-slice gains large on CT, dynamic 4-D data and fMRI ([S11], [S12],
  [S13]), small on MRI [S14], and up to 15 % over single-frame coders with dedicated 3-D predictors [S15]. Each
  depends on how much of the next slice the previous one predicts.

### Breast ultrasound cine (native B-mode)

* **Why inter should pay.** Speckle decorrelates with probe and tissue motion, fastest out of the scan plane: the
  decorrelation curve is regular enough that frame spacing is computed from it, to within 10–15 % [S9]. In-plane
  motion moves the speckle without destroying it, so motion vectors follow it. At a hand's slow motion and 20–60
  frames a second, the elevational step between frames is a small fraction of the beam's width (*derived*: step =
  speed ÷ frame rate). So ρ of the speckle "structure" should be high, and inter should pay by much more than on
  DBT. Persistence (frame averaging in the scanner) raises ρ further.
* **Limits.** Electronic noise is independent from frame to frame. Real tissue rarely gives fully developed speckle
  [S16]. No peer-reviewed lossless figure was found for ultrasound cine (*unverified*).
* **The lab's only clip says nothing.** It was MPEG-4 and repeated blocks exactly, so its −47 % is the clip's
  ([`README.md`](README.md) §A1, Scope).

### Automated breast ultrasound (ABUS)

A constant-speed sweep, so the elevational step is fixed by the scanner. The same mechanism as the cine applies with
a larger, regular step, so ρ is lower than in a hand-held cine at rest (*derived*).

### Contrast angiography runs

Every frame is a new exposure, so its quantum noise is independent of the last: ρ ≈ 0 on the noise. Vessels move
with the heart and the contrast flows, so structure changes too. Inter can pay only where the dose leaves the noise
small next to the structure. The lab's fluoroscopy (2 frames a second, 12-bit) gained 0.04 % (row SIZE), but it is
not a target series and not an angiography run.

## 4 · Predictions

Each is stated for the protocol's measurements. *G* is the group length (keyframe every G), *gain* is
1 − bytes(best G) ÷ bytes(G = 1) on the same frames, encoder and preset, every frame exact. *ρ* is the protocol's
§2 statistic.

| # | content | prediction | would be refuted by |
| --- | --- | --- | --- |
| P1 | DBT slices, every system | median block ρ (top stream) between 0.2 and 0.5, never above 0.6 | any system's median ρ > 0.6 or < 0.1 |
| P2 | DBT slices, every system | the best G ≤ 16 gains **under 5 %** over intra on the product's representation, libaom alt-ref off, cpu0 and `good` 6 | a gain ≥ 5 % on any series |
| P3 | DBT slices | gain ranks with ρ across series (Spearman ≥ 0.6 when there are ≥ 4 series); a narrower scan arc, where recorded, gives the higher ρ | the opposite order, or no relation with ≥ 6 series |
| P4 | DBT slices | G = 2 or 4 collects ≥ 80 % of the best gain; longer groups add < 0.5 points | a best gain at G ≥ 8 that is ≥ 0.5 points over G = 4 |
| P5 | DBT, low stream | inter on the low stream is ≥ intra's bytes at every G | inter smaller than intra on the low stream by > 0.5 % |
| P6 | DBT, libaom alt-ref on (where exact) | no better than alt-ref off by > 1 point | alt-ref on > 1 point better |
| P7 | DBT, SVT-AV1 where exact | the same sign of gain as libaom, within 2 points | opposite sign, or > 2 points apart |
| P8 | native breast US cine, probe slow or still | gain ≥ 20 % at G = 8; median ρ (speckle) > 0.7 | a gain < 10 % on a native cine |
| P9 | ABUS | gain between 5 and 25 % | outside that range |
| P10 | contrast angiography run | gain < 5 %; ρ < 0.2 | gain ≥ 10 % |

P8–P10 wait on sound data ([`queue.md`](queue.md) §Blocked). P1–P7 can be tested on the CC BY DBT volumes.

## 4a · Review against the data (row GOPREVIEW, 2026-10-08)

Row GOPMEASURE ran the protocol on 15 sound, whole DBT volumes, five from each of three systems
(`lab/av1/gopmeasure/README.md` on `claude/av1-unified`, `4306310`). ρ was measured on every adjacent slice pair; the
codings ran on each volume's middle 16 slices (G ≤ 16, the rule's range); cpu0, SVT-AV1 and the plain representation
ran on one volume a system.

| # | outcome | the numbers |
| --- | --- | --- |
| P1 | **not refuted, missed its band on two systems** | median ρ A 0.112, B 0.215, C 0.117: inside 0.2–0.5 on B only, above the 0.1 refutation line on all |
| P2 | **held** | best gain +1.51 % (`good` 6), +0.13 % (cpu0); every G > 1 larger than intra on 14 of 15 |
| P3 | **did not hold, near untestable** | Spearman(gain, ρ) +0.46, best-G gain +0.11 at 15 series: no relation; but 14 gains are ≤ 0, so there is no spread to rank. Scan arc recorded on system B alone (14.4–15.2°) |
| P4 | **not refuted, its 80 % clause failed** | G ≥ 8 adds ≤ 0.39 points over G = 4 (0.45 at cpu0); on the two series with any gain, G ≤ 4 holds 75 % and 54 % of it, gains of 0.1–1.5 % |
| P5 | **held** | low stream ρ 0.058–0.061 against 0.059 for independent noise; inter never under intra by > 0.5 % (best +0.13 %) |
| P6 | **refuted on system B; untestable on A and C** | alt-ref on beats off by 1.2–6.8 points on 9 of 10 exact cells (best +3.19 % over intra); on A's and C's 10-bit tops it is not lossless |
| P7 | **refuted on `b1`, the one series SVT-AV1 is exact on** | SVT preset 0 +2.43 % against libaom cpu0 −0.03 %; preset 8 +0.87 % against `good` 6 −0.16 % |
| P8–P10 | **not testable** | no sound native breast ultrasound cine, ABUS or angiography run (`queue.md` §Blocked) |

**The mechanism held where it decides.** Every series' ρ is far under ½, the line §2 draws, and no coding gains on
the noise: the low stream behaves as independent noise (P5), and libaom's alt-ref-off groups lose or tie (P2).
**What it underweighted is the structure term.** A temporally filtered hidden frame (P6) and SVT-AV1's predictors
(P7) find up to 3.2 % on system B's 8-bit streams. §2 bounds a denoised reference at intra's noise, not intra's
structure, so this does not contradict the mechanism, but the predictions stated as "no better" and "same sign"
claimed more than the mechanism gives. ρ itself is lower than §3's geometry argument expected on two systems
(0.11–0.12): the reconstruction shares less noise between 1 mm slices than assumed.

**Conclusive for DBT, by the pre-stated rule (§5.2 of the protocol).** Three systems, five series each, all under the
20 % line with libaom, and SVT-AV1 where exact (+2.43 %) does not cross it; every G > 1 also misses the decode bound
at 4× by 4.6–24.6×. Two limits, both inside the rule: the codings saw 16 slices of each volume, and the encoder
variants that gain (alt-ref on, SVT-AV1) are lossless only on system B's 8-bit tops. **Not conclusive for breast
ultrasound cine, ABUS or angiography**: there is no sound data, so they stay G = 1 by default (rule 3) and the theory's
largest claim, P8, is untested.

## 5 · Sources

* [S1] AV1 Bitstream & Decoding Process Specification, `github.com/AOMediaCodec/av1-spec` @ `5e04f3f`.
* [S2] libaom v3.15.1 (`44d0a57`): `av1/encoder/encode_strategy.c`, `temporal_filter.c`, `encoder.h:1127`.
* [S3] SVT-AV1 v4.2.0 (`9292ec8`): `Source/Lib/Globals/enc_handle.c`, `Source/Lib/Codec/md_config_process.c:1016-1045`, CHANGELOG.
* [S4] Cover & Thomas, *Elements of Information Theory*, 2nd ed., Wiley 2006, ch. 8 (locator *unverified*).
* [S5] Jayant & Noll, *Digital Coding of Waveforms*, Prentice-Hall 1984, ch. 6, prediction gain (locator *unverified*).
* [S6] Sechopoulos, "A review of breast tomosynthesis. Part I", Med Phys 40(1):014301, 2013, doi:10.1118/1.4770279, Table 1.
* [S7] Sechopoulos, "… Part II", Med Phys 40(1):014302, 2013, doi:10.1118/1.4770281, §Reconstructed slice thickness, §Artifacts.
* [S8] Zhao & Zhao, Med Phys 35(12):5219-5232, 2008, doi:10.1118/1.2996014 (3-D NPS of DBT).
* [S9] Tuthill et al., Radiology 209(2):575-582, 1998, doi:10.1148/radiology.209.2.9807593.
* [S10] D. Clunie, RSNA 2012, *Mammo tomosynthesis compression* (slides, pp. 11-15), `dclunie.com/papers/RSNA_2012_LL-INS_WE6B_Clunie_MammoTomoCompression.pdf`.
* [S11] Sanchez et al., IEEE TITB 12(4):442-446, 2008, doi:10.1109/TITB.2007.911307.
* [S12] Sanchez et al., IEEE TITB 13(4):645-655, 2009, doi:10.1109/TITB.2009.2021159.
* [S13] Miaou et al., IEEE TITB 13(5):818-821, 2009, doi:10.1109/TITB.2009.2022971.
* [S14] Philips et al., Comput Med Imaging Graph 25(2):173-185, 2001, doi:10.1016/s0895-6111(00)00046-x.
* [S15] Lucas et al., IEEE TMI 36(11):2250-2260, 2017, doi:10.1109/TMI.2017.2714640.
* [S16] Gee et al., Med Image Anal 10(2):137-149, 2006, doi:10.1016/j.media.2005.08.001.
