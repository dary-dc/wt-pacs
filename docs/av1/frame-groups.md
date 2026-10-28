# Frame groups in lossless AV1: the decision

**Should AV1 code a series' frames in groups, each frame after a group's first predicted from the frame before it
(G > 1), or code every frame alone (G = 1)?** For lossless, bit-exact delivery the answer is **G = 1 on every
content type.** On DBT reconstructed slices that is a conclusion, reached by a rule fixed before the data. On breast
ultrasound cine, ABUS and angiography it is a default: no data fit to test them is open.

This file owns the question: the decision (§1), the conditions it holds under (§2), how it was reached (§3), why
(§4), what would reopen it (§5), what else G touches (§5a–§5d) and the sources (§6). The theory, predictions and review written before and just
after the measurement are kept as they were recorded (§T1–§T4a). The protocol the measurement ran is
[`gop-protocol.md`](gop-protocol.md), unchanged since it was registered. Every number carries its row of
[`queue.md`](queue.md). Sections 1–5 were written 2026-10-24 from committed rows: nothing was coded again, and where a
figure was recomputed from a committed table, it says so. Arithmetic of our own is marked *derived*; a claim no
source confirms is marked *unverified*.

*G* is the group length: a keyframe every G frames, the frames between inter-coded ([`../glossary.md`](../glossary.md),
*group*). *Gain* is 1 − bytes(G) ÷ bytes(G = 1) on the same frames, encoder and preset: positive is smaller.

## 1 · The decision

| content | decision | evidence | what would reopen it |
| --- | --- | --- | --- |
| DBT reconstructed slices | **G = 1, adopted: conclusive by the pre-stated rule** | row 100: 15 sound volumes, five from each of three reconstruction systems; best gain +1.51 % (libaom `good` 6) and +0.13 % (cpu0) against the 20 % the rule needs; every G > 1 4.6–24.6× over the decode bound at 4×. Before the protocol, rows 10 and 46 agree (four volumes, −5.4 to +3.7 %) | a sound series of a system not yet measured gaining ≥ 20 %, or an encoder exact on 10-bit tops whose groups gain ≥ 20 % and decode inside the bound (§5) |
| DBT projections | **G = 1 by default, not tested by the rule** | row 21: two series, one per system, best +0.29 % on one and −0.2 to −1.0 % on the other; before the protocol; FOR PROCESSING views, outside the scope row 98 set | the owner puts projections in scope; then the protocol on ≥ 2 systems × ≥ 2 series |
| breast ultrasound cine | **G = 1 by default, untested**: no native, losslessly stored, commercially licensed cine is open (rows 94, 137, 149) | the one open cine is an MPEG-4 Part 2 clip (row 46: 0.53–0.56 of intra's bytes), which enters no verdict (row 94; §4, point 9) | ≥ 2 independent sources × ≥ 2 native B-mode cine series, the probe slow or still (§5) |
| ABUS | **G = 1 by default, untested**: no ABUS volume is open in DICOM; the one set, in NRRD, is for its challenge only (rows 21, 137, 149) | none | ≥ 2 independent sources × ≥ 2 native ABUS volumes |
| angiography and fluoroscopy runs | **G = 1 by default, untested**: the one open set of native runs states no licence (row 149); the rest are exports or cut runs (row 137) | off-target only: a 2 frames/s barium fluoroscopy run, G = 2 0.04 % under intra at cpu0, every other G larger (row 6) | ≥ 2 independent sources × ≥ 2 native contrast runs, or a licence for row 149's set (one source) |
| MR and CT stacks | **not applicable**: outside the AV1 target series ([`series.md`](series.md); row 98); G = 1 | MR: every G > 1 1.4–2.7 % larger than intra at cpu0 (row 6); CT: no AV1 group coding (13 bits, row 7); HTJ2K-side, a reversible step across slice pairs ×0.960 on CT (row 213) | the owner adds them to the target series |
| FFDM, synthesized 2D, ultrasound stills | **not applicable**: one frame an image, nothing to predict from ([S21]; [`series.md`](series.md) §1a) | — | — |

## 2 · Conditions

* **Lossless and bit-exact, checked.** AV1 lossless is a quantiser index of 0 with no delta-q ([S1] §5.9.2). Every
  frame of every coding was decoded natively (dav1d 1.5.4), each group on its own, and matched against the checksum
  written at fetch; an inexact coding is reported and not used (protocol §4).
* **libaom 3.15.1** (`44d0a57`, as `lab/av1/tools/tools.sh` pins it): one thread, a keyframe at exactly every G
  (`--kf-min-dist=G --kf-max-dist=G`), presets `--cpu-used=0` (the slowest) and `good` 6 (the shipped one).
  **Alt-ref off** (`--auto-alt-ref=0`) at every G, because with it on libaom's inter is not lossless at 10 and 12
  bits: on synthetic frames (row 1) and on every 10-bit DBT top (row 100: 2–5 of 16 frames exact, `aomdec` and dav1d
  agreeing, so the stream is wrong, not the decoder). Alt-ref on was coded at G ∈ {8, 16} and counted only where every
  frame was exact, which is system B's 8-bit top and low.
* **SVT-AV1 v4.2.0** (`9292ec8`): `--lossless 1 --lp 1 --keyint G --irefresh-type 2 --scd 0`, presets 0 and 8, grey
  as 4:2:0 at mid-grey chroma (it has no 4:0:0). Its inter is exact on `dbts_b1` alone (an 8-bit top and low) and not
  lossless on the 10-bit tops (row 100).
* **G.** {1, 2, 3, 4, 6, 8, 12, 16} at `good` 6 on all 15 volumes; {1, 2, 4, 8, 16} at cpu0 and for SVT-AV1 on one
  volume a system. The rule asks for the best G ≤ 16; the protocol's G ∈ {24, 32, whole} were not run and are claimed
  nowhere.
* **Slices.** ρ on every adjacent pair of every volume (43–87 slices). The codings on each volume's **middle 16
  slices**: cpu0 takes up to an hour per 16-slice group of a 2.5 Mpx low stream on the 4-core host, so whole volumes
  at every G and preset would have taken days (row 100).
* **Representations.** *Optimized*, the product's ([`payload-format.md`](payload-format.md)): each sample split into
  a top stream v ≫ k and a low stream v & (2^k − 1), k = 2 at these depths, so a 10-bit top on the 12-bit systems A
  and C and an 8-bit top on the 10-bit system B; both streams coded at G and their sum compared. The client decodes
  the low stream intra; with only the top at G the best gain is +1.70 % (row 100). *Plain*, the samples coded as they
  are, on one volume a system as the control.
* **The decode bound.** The cost of an ask that lands mid-group is the serial decode of the group's frames up to it,
  on average (G + 1)/2 frames. It must be no slower than one HTJ2K frame's decode plus the wire time, at 20 Mbit/s,
  of the bytes the group saves: through WebCodecs at a 4× CPU throttle, headless Chromium 141, the product's decoder
  worker, n = 10 interleaved rounds (row 100).
* **The host.** A 4-core, 15 GB container, one decode at a time; not a phone, and nothing is claimed for concurrent
  asks.

## 3 · How it was evaluated

### The method

Four steps, each its own queue row, so that the answer could not shape the question:

1. **Theory first** (row 99 GOPTHEORY, 2026-10-08): from the AV1 specification, the encoders' source and the
   imaging-physics literature, why inter should or should not pay on each target type, with ten predictions P1–P10 and
   what would refute each (§T4).
2. **The protocol and the decision rule registered before any data** ([`gop-protocol.md`](gop-protocol.md), `e9d247a`).
3. **The measurement, by a separate session given only the protocol** (row 100 GOPMEASURE), not the theory: it
   reported numbers without being told which result was expected.
4. **The review** (row 101 GOPREVIEW): each prediction against the numbers, and the rule applied (§T4a).

### The rule, and why its thresholds

For each content type, **G > 1 is adopted only if on every sound series the best G ≤ 16 is all three of** (a) at
least 20 % fewer bytes than G = 1 at the shipped preset, every frame exact; (b) at most 0.80 of HTJ2K's bytes; (c) a
mid-group ask inside the decode bound (§2). The answer is **conclusive** when ≥ 2 systems (DBT) or ≥ 2 independent
sources (the other types), each with ≥ 2 series, land on the same side of the 20 % line with libaom, and SVT-AV1
where exact does not cross it. A type with no sound data gets no decision and stays at G = 1 (protocol §5).

* **Why a fifth.** A group is not free. An ask costs up to G serial decodes instead of one, the fill runs in parallel
  only across groups, a failed frame fails the rest of its group, and the client carries the group's machinery
  ([`adr-unit.md`](adr-unit.md) §3, *Invariants this breaks*). The bar was proposed in `adr-unit.md` §4 before any
  number existed and kept for the protocol. It also stands clear of what a preset alone moves: between cpu0 and `good` 6 the
  same frames' gain moves by up to 2.7 points (row 100) and 6.9 (row 46). No document records why a fifth rather than another
  fraction; the bar is the owner's.
* **Why against HTJ2K too.** HTJ2K is what ingest serves. A group that beats AV1's own intra but not HTJ2K changes
  nothing a reader receives.
* **Why the decode clause.** The ask is the latency a reader feels. A group may not make it slower than today's HTJ2K
  ask, once the bytes it saves are credited.
* **Why two systems, two series and SVT-AV1.** So that neither one reconstruction system's noise nor one encoder's
  predictors decides for a whole type.

### ρ, measured before any encoder ran

ρ is how much of one frame's unpredictable part the next frame shares (protocol §2, `lab/av1/bytes/frame-groups/rho.py`).
Each frame's residual from the LOCO-I median predictor [S22] stands for what an intra predictor leaves, which is mostly
noise. For each pair of adjacent slices and each 64×64 block at least 8 px from the edge, ρ is the Pearson
correlation of frame t's residual with frame t + 1's, at the best integer offset within ±8 px (289 offsets) and at
offset 0; per series, the 10th, 50th and 90th percentiles over blocks and pairs. A block whose residual is constant
(the air around the breast) is left out. **The floor is 0.059**: independent noise gives that at the best of 289
offsets, because the largest of many near-zero correlations is biased upward, so a best-offset ρ near 0.06 is no
correlation. The check is mutated (`rho_test.py`): frames of independent noise give ρ ≈ 0, one frame repeated gives 1.

### The data

* **15 DBT volumes** from the EA1141 collection (CC BY 4.0), reached through the NCI Imaging Data Commons v24: five
  exams, five patients the lab had not used, from each of the collection's three reconstruction systems (A and C two
  detectors of one vendor, B the other vendor's); each series' 1 mm slice volume whole and uncropped, 43–87 slices,
  994 in all, chosen as the first five by SeriesInstanceUID (row 95, [`../FIXTURES.md`](../FIXTURES.md) §AV1 data).
  Pinned by key and SHA-256, never committed. System B records a scan arc of 14.35–15.19°; A and C record none; no
  series records a projection count (row 100).
* **Provenance: sound** (row 94): explicit little-endian, Lossy Image Compression (0028,2110) `00`, never lossy-coded;
  `fetch_data.py` refuses a source its class does not admit ([`../FIXTURES.md`](../FIXTURES.md) §Provenance).
* **Why a lossy-sourced clip enters no verdict.** A clip recorded through a lossy inter codec arrives with its
  frame-to-frame differences already decided by that codec: blocks it skipped are exact copies of the previous frame,
  and its quantiser has removed noise. In the lab's breast cine only 30–47 % of samples change between frames, by 0.5
  on average (row 46). A lossless inter coder then measures the recorder's predictability, not the scanner's (§4,
  point 9).

### Exactness and mutations

234 cells, 3 315 of 3 744 frames exact: **libaom with alt-ref off 159 of 159 cells**, both presets and both
representations; HTJ2K 15 of 15. Not used: libaom alt-ref on and SVT-AV1 inter on every 10-bit top. Each check was
broken on purpose and caught the break: one sample of one frame flipped, and a group's frames reordered
(`mutate.py`, on a 10-bit and an 8-bit top); in the timing, a flipped sample fails every frame. 5 760 of 5 760 timed
frames exact (row 100).

### Every row's contribution

| row | contributed | caveat |
| --- | --- | --- |
| 1 TOOL | libaom's lossless inter inexact at 10 and 12 bits with alt-ref on, exact with it off; SVT-AV1 exact only on grey 8 and intra grey 10 | synthetic frames |
| 6 SIZE | the first inter measurement: the lowest-byte G is 1 on MR and RGB ultrasound, G = 2 by 0.04 % on fluoroscopy | all three outside the target series (row 98); the ultrasound lossy-sourced (row 94) |
| 10 CONTENT | two DBT volumes coded whole at cpu0: gain −1.2 % (12-bit) and +0.6 % (10-bit); no open angiography run | before the protocol; the plain representation; one volume a system, one cropped |
| 16 GOP | the group built as the client's unit: an ask asks its whole group, a group to one decoder, no wire, store or server change | synthetic frames, nothing timed |
| 21 TAXO | DBT projections, two series: +0.29 % on one, −0.2 to −1.0 % on the other; no breast cine, ABUS or multi-frame angiography reachable | before the protocol; one series a system; out of scope (row 98) |
| 28 LLSIZE | inter pays on the colour-transformed liver cine (0.850 of HTJ2K at G = 8), level or worse on grey | that cine is lossy-sourced (row 94) |
| 35 DATA2 | nothing: the data hosts were refused by the egress policy | — |
| 45 DATA3 | the remaining depths and single-frame types exact | no sequence content found |
| 46 BREAST | four DBT slice series at G = 8 and 16: −5.4 to +3.7 % at cpu0, −5.0 to +0.2 % at `good` 6; grey breast cine 0.53–0.56 of intra | the cine an MPEG-4 clip; DBT before the protocol, two G only |
| 94 DATAGUARD | provenance classes; lossy and video sources refused at fetch; the ultrasound claims made provisional | — |
| 95 DBTSCALE | the 15 sound whole volumes row 100 measured | intra only |
| 98 GOPSCOPE | the group evidence scoped to the target series: four DBT volumes, libaom alone, alt-ref off | — |
| 99 GOPTHEORY | the theory, the predictions, the protocol and the rule | — |
| 100 GOPMEASURE | the measurement: DBT G = 1, conclusive; found that dav1d-WASM fails every split group at G > 1 | middle 16 slices, G ≤ 16; alt-ref on and SVT-AV1 exact on system B only |
| 101 GOPREVIEW | the review: conclusive for DBT, open for the rest | — |
| 137 NETPROBE | every data host reached; none holds data that meets the bar | the nearest angiography set (PNG) is of `unknown` history |
| 149 NATIVECINE | the wider search: one open set of native angiography runs, without a licence; no breast cine or ABUS in DICOM anywhere searched | search only |
| 213 INTERSLICE | HTJ2K-side: a reversible step across slice pairs ×0.960 on CT, ×0.965 on the cone-beam volume, ×0.978 and ×0.994 on DBT | not AV1; a trade-off by its own rule, the owner's to build |

## 4 · Why inter does not pay here: the mechanism

```
 intra   frame t     s + n_t      predict s from neighbours in frame t
                                  residual noise ≥ σ²   (n_t is unpredictable)

 inter   frame t−1   s + n_t−1  ──copy──►  predict frame t
         frame t     s + n_t      residual noise = n_t − n_t−1
                                  variance 2σ²(1 − ρ):  2σ² at ρ = 0, under σ² only when ρ > ½

 s: the anatomy, which both predictors follow    n: the noise, variance σ² in each frame
 ρ: the correlation of n between the two frames  DBT measured: ρ 0.11–0.22, independent-noise floor 0.06
```

1. **In lossless AV1, intra and inter differ only in the predictor.** A lossless block, intra or inter, codes its
   residual with the 4×4 Walsh–Hadamard transform ([S1] §5.11.34, `txSz = Lossless ? TX_4X4 : …`; §7.13.3), and
   deblocking, CDEF and loop restoration are off (§5.9.11, §5.9.19, §5.9.20). No inter tool is conditioned on
   lossless: the syntax tests `Lossless` nowhere in the inter mode info, the motion modes or global motion (§5.11.18–
   5.11.27, §5.9.24). And each block of an inter frame chooses intra or inter for itself (§5.11.20, `is_inter`).
2. **A lossless coder pays for its residual's entropy.** For an integer residual close to Gaussian with variance σ_r²,
   about ½·log2(2πe·σ_r²) bits a sample ([S4] ch. 8: the Gaussian's differential entropy, and its quantisation at a
   step of 1). Doubling the residual's variance costs half a bit a sample (*derived*).
3. **The noise is independent from one exposure to the next.** X-ray quanta arrive as a Poisson process, whose counts
   in disjoint intervals are independent [S17]; electronic read-out noise is drawn afresh each read-out (*unverified*:
   no source read states it for these detectors). In every series the lab measured, the low bits are noise
   ([`split-prior-art.md`](split-prior-art.md)), and the low stream's ρ sits at the floor on all 15 volumes (row 100).
4. **Predicting from a frame whose noise is independent adds that frame's noise.** An inter copy's residual noise is
   n_t − n_t−1, and the variance of a difference is the sum of the variances less twice the covariance: 2σ²(1 − ρ)
   (*derived*; first-order differencing's prediction gain [S5]). At ρ = 0 that is twice the noise in the frame:
   nothing can predict n_t, so the reference contributes only its own noise. σ² is the floor for every predictor;
   inter goes under it on the noise only when ρ > ½. Two refinements (*derived*): averaging references, as sub-pixel
   and two-reference prediction do, adds less than σ² (two independent references averaged, 1.5σ²: +0.29 bit) but
   never nothing; and intra's own predictor mixes in its neighbours' noise, so neither reaches the floor in practice.
5. **Adjacent DBT slices share little noise.** Each slice is reconstructed from the same 9–25 projections [S6], so
   the same quanta reach every slice, but a projection's contribution shifts from slice to slice by Δz·tan θ, a
   different amount at each angle, and the reconstruction's slice-thickness filter limits how far noise spreads in z,
   its shape set by the angular range and the filters [S8]. No source gives a value (*unverified* before row 100).
   Measured, median ρ at the best offset: 0.11–0.13 on systems A and C, 0.18–0.27 on B; at offset 0, 0.02–0.06 and
   0.12–0.25 (row 100). An inter copy's noise term at ρ 0.11–0.22 is 1.56–1.78σ², +0.32 to +0.42 bit a sample over
   the floor (*derived*): nowhere near the ½ that inter needs.
6. **Why the measured losses are small, not half a bit a sample.** Each block of an inter frame may still be coded
   intra (point 1), so the encoder falls back where inter loses, and a group costs the signalling and the encoder's
   imperfect choices: on 12 of the 15 volumes every G > 1 is 0.2–2.9 % larger than intra at `good` 6 (row 100). The
   two large losses, `dbts_b4` and `dbts_b5` (−12.3 % and −12.6 % at G = 16), are in the low stream; the same two
   volumes are unusual at intra too (0.747 and 0.781 of HTJ2K), and neither is explained (rows 95, 100).
7. **What the small gains are: structure, not noise.** On system B's 8-bit streams, where they are exact, two
   variants gain: libaom with alt-ref on, at best +3.19 % over intra, and SVT-AV1 preset 0, +2.43 % (row 100).
   * libaom 3.15.1 temporally filters its alt-ref frame even in lossless: only key-frame filtering tests for lossless
     ([S2] `encode_strategy.c:746-757`). It codes the filtered frame, never shown, and then the real frame as an
     overlay predicted from it (`encode_strategy.c:78-99`). A denoised reference adds almost no noise of its own, so
     inter from it can at best tie intra on noise, and it follows structure better than intra's neighbours do. The
     gain is all in the top stream (+2.5 to +6.5 %); on the low stream, which is noise, the same coding is 2.6–20.6 %
     larger (row 100).
   * SVT-AV1 v4.2.0 switches temporal filtering off under lossless ([S3] `enc_handle.c:3256`), so its gain cannot come
     from a denoised reference: it is its predictors following structure. It is also measured against its own intra,
     which takes 1.009 of HTJ2K's bytes to libaom's 0.939; SVT-AV1's best group is still 5 % larger than libaom's
     intra (row 100).

   The structure term is real, worth up to about 3 %, and an order of magnitude under the rule's 20 %.
8. **Why breast ultrasound cine was predicted to gain.** B-mode speckle is the interference of echoes from many
   scatterers inside the beam [S19]: random over tissue, but fixed for a fixed tissue and probe position, so it
   behaves as structure that the next frame repeats. It decorrelates as the probe moves out of the scan plane,
   regularly enough that frame spacing is computed from it to within 10–15 % [S9]; real tissue's coherent scattering
   bends that curve [S16]. At slow hand motion and tens of frames a second the step is a small fraction of the beam's
   width, so ρ of the speckle should be high and inter should pay (P8: ≥ 20 % at G = 8). Electronic noise still enters
   each frame independently (*unverified*). Untested: no native cine is open (§5).
9. **Why a clip recorded with a lossy inter codec looks predictable.** A lossy inter codec may send nothing for a
   block and copy it from the previous frame (MPEG-4 Part 2's `not_coded` macroblock [S20]), and its quantiser removes
   the noise that would differ between frames. A lossless coder then finds the recorder's copies: 30–47 % of samples
   change between the lab's cine frames (row 46), where a scanner would bring new noise and speckle to every frame.
   Its 0.53–0.56 of intra says nothing about native cine.
10. **Angiography.** Every frame is a new exposure, so its quantum noise is independent of the last [S17]. A
    flat-panel detector's lag carries 2–10 % of a frame's signal into the next [S18], which correlates frames weakly
    (*derived*: a lag fraction a correlates the noise by about a, so ρ ≲ 0.1). A system's recursive noise filter, where
    one is applied before storage, would raise ρ; no source read gives its strength on stored runs (*unverified*).
    Vessels move and contrast flows, so structure changes too. P10 predicts a gain under 5 %. Untested.
11. **A transform across frames is not a prediction** (*derived*). A reversible average-and-difference across a pair
    of slices puts the noise into a difference band, 2σ²(1 − ρ), and an average band, σ²(1 + ρ)/2: together
    ½·log2(1 − ρ²) bit a pair of samples against the floor, no loss at ρ = 0 and a small gain above it. That is why
    row 213's step gains a little where a plain difference loses ([`../codecs/README.md`](../codecs/README.md)
    §Beside the codec). It is not an AV1 group.

## 5 · Limits, and what would reopen it

* **The untested types, and the data that would test them.** For each of breast ultrasound cine, ABUS and
  angiography: ≥ 2 independent sources of ≥ 2 series each, native frames stored uncompressed or losslessly (no MPEG,
  no lossy JPEG, (0028,2110) absent or `00`), whole and in acquisition order, under a licence that allows commercial
  use (CC BY or alike, not CC BY-NC): B-mode cine with the probe slow or still (P8), ABUS volumes (P9), contrast
  angiography runs (P10) (row 100; [`queue.md`](queue.md) §Blocked). None was found by 2026-10-11 (rows 137, 149).
  The nearest: a set of native angiography runs with no licence (one source, two vendors), angiography runs exported
  as PNG of unknown history, an ABUS challenge set in NRRD for challenge use only, and the prostate 3-D transrectal
  volumes in IDC as the nearest swept-volume analogue ([`../FIXTURES.md`](../FIXTURES.md) §Provenance). Asking for a
  licence, requesting a site's data or scanning phantoms is the owner's call ([`queue.md`](queue.md) §Blocked).
* **The 16-slice window.** The codings saw each volume's middle 16 slices, and G ≤ 16. Longer groups are not expected
  to change the verdict, since G ≥ 8 adds at most 0.39 points over G = 4 at `good` 6 and 0.45 at cpu0 (row 100), but
  they were not run.
* **Encoder variants exact on one system's 8-bit tops only.** libaom with alt-ref on and SVT-AV1 inter are not
  lossless on a 10-bit top. A release exact there is the first thing to re-run; their structure gains (≤ 3.2 %) are
  still far under 20 %.
* **cpu0, SVT-AV1 and the plain representation ran on one volume a system** (`dbts_a1`, `dbts_b1`, `dbts_c1`).
* **One host's decode.** The decode clause failed by 4.6–24.6×; a faster decoder would still leave the bytes clause
  failed.
* **The client.** dav1d-WASM fails every split group at G > 1: the low unit, decoded as a keyframe on the top's
  instance, flushes the top's references (row 100; reported, not fixed). Adopting G > 1 anywhere would need that
  fixed first.
* **The scan arc** is recorded on system B only, so whether a narrower arc shares more noise (P3) is untested across
  systems.

For DBT, what would reopen it is a sound series, of a system not yet measured, whose median ρ is over ½, or any
coding that gains ≥ 20 % on a sound series.

## 5a · What else G touches, and where it is written

*2026-10-27, theory only: nothing coded, decoded or timed. Inference is marked* derived *or* inferred*; a claim no
source read confirms,* unverified.

| dimension | covered where / added here | what it means for G |
| --- | --- | --- |
| random access: an ask mid-group, scrolling back, a jump | covered: §2 *The decode bound* and §3; [`adr-unit.md`](adr-unit.md) §3 (an ask asks from its keyframe; *What the cache holds*: frames k … N are all delivered) and its invariants 2–3; [`README.md`](README.md) §Frame groups; [`../decode/README.md`](../decode/README.md) §An ask behind the decoders (a jumping ask only to a decoder holding no group) | an ask costs (G + 1)/2 serial decodes on average, 4.6–24.6× over the bound at 4× (row 100); a step back after an ask is in hand, a step forward continues; a jump into another group starts at its keyframe |
| sequential cine playback | added, §5b | G > 1 saves bytes only on the first pass and costs that pass its decoders' parallelism |
| reference structures: low-delay, hierarchical, alt-ref and hidden frames, show-existing-frame | hidden alt-ref and overlay: §4 point 7, [`adr-unit.md`](adr-unit.md) §3 (a temporal unit carries up to 3 frames); added, §5c | hierarchical coding makes every ask dearer than low-delay at the same G |
| key, intra-only and switch frames; what a decoder needs to start | intra-only not a start, switch frames not exact: [`README.md`](README.md) §Options read from the sources; added, §5c | only a shown key frame with its sequence header starts a group an exact client can ask |
| one all-key stream against one-frame streams | the containers and their indexes: [`../disk-layout/containers.md`](../disk-layout/containers.md) (row 159); added, §5d | at G = 1 they are the same bytes; the per-frame flush is the one setup cost, and it is open at G = 1 already |
| encoders exact on inter at 10 and 12 bits | covered: §2; [`README.md`](README.md) §Exactness and the decoders (rows 1, TOOL) and §Encoding (`--rt`, `svc_encoder_rtc`) | libaom only, with `--auto-alt-ref=0` or `--rt`; SVT-AV1 v4.2.0 inter exact at 8 bits only; rav1e 0.7.1 has no lossless mode |
| decoders for groups: WebCodecs, dav1d, dav1d-WASM on split groups, hardware | covered: [`../decode/README.md`](../decode/README.md) §WebCodecs without a flush (row WCLAT) and §WebCodecs, what it decodes exactly (12 bits refused at any G); §5 *The client*; [`../decode/hardware.md`](../decode/hardware.md) §3–§5 (4:0:0 and 12-bit limits), §9 (G = 8 cells proposed) | a group goes through WebCodecs at 8 and 10 bits; a 12-bit top only through dav1d-WASM, which fails every split group today |
| decoder memory for references | [S1] §3 (`NUM_REF_FRAMES` 8); dav1d holds a reference by count ([S26]); dav1d-WASM never returns heap (row 38) | up to eight distinct pictures a decoder where G = 1 holds one: about 5 MB each on a 2.5 Mpx 10-bit DBT top, so up to 35–40 MB more (*derived*; two bytes a sample above 8 bits *unverified*) |
| loss and corruption inside a group | a failure fails the rest of its group: [`adr-unit.md`](adr-unit.md) §3 invariant 4; a truncated frame fails: [`../CLIENTS.md`](../CLIENTS.md#a-truncated-frame-is-a-failure) | a retransmitted frame holds back, and a broken one breaks, up to G − 1 frames; error-resilient mode only lets a frame parse alone ([S1] §6.8.2), its prediction still reads the broken reference (*derived*) |
| the per-frame exactness check inside a group | no second path for a frame inside a group: [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §8 | the digest still decides frame by frame; each later mismatch starts a second decode that fails for want of references, so at G > 1 a mismatch should fail the rest of its group by name (*inferred*; nothing to build at G = 1) |
| energy on phones | [`../devices.md`](../devices.md) D5; nothing measured on a phone | a frame costs the same decode at any G (row 100's mean ask over (G + 1)/2 frames is 0.97–1.03 of G = 1's frame at 4×, *derived*), so a fill in order is predicted a tie and a cold ask costs (G − 1)/2 extra decodes |
| late frames in a container | PR #179 and PR #185 | re-encoding a group dominates a late frame's cost; not redone here |

## 5b · Sequential cine playback

G > 1 is usually argued for a stream decoded once, in order, at its display rate, over a link that must carry that
rate: every frame is decoded anyway, so inter saves bits and costs nothing. Here (*derived*):

* **Only the first pass decodes.** A viewer keeps what it decoded ([`../decode/README.md`](../decode/README.md)
  §Retained-frame residency), so a loop or a sweep, DICOM's playback sequencing ([`README.md`](README.md) §The order
  frames are asked in), replays pixels at any G.
* **The first pass loses its parallelism, not its per-frame cost.** Decoders run in parallel only across groups
  ([`adr-unit.md`](adr-unit.md) §3, *The decoder pool*), so with D decoders and F frames the first pass decodes at
  min(D, ⌈F/G⌉) decoders' rate where decode is the clock, one decoder's at G ≥ F. A frame inside a group costs what a
  key frame costs (§5a, *energy*).
* **It gains the group's bytes only where the wire is the clock**: at most 1.5 % on DBT (§1).

**Prediction** (native cine, untested, §5): where P8's ≥ 20 % holds, G > 1 shortens a wire-bound first pass by about
its gain and lengthens a decode-bound one up to D× at G ≥ F. Total time to the whole loop at G ∈ {1, 8, F}, on
wire-bound and decode-bound cells, would decide. Whether one decoder keeps up with a native cine's frame rate is
unmeasured.

## 5c · Reference structures, and where a decoder can start

* **What was measured is low-delay**: libaom with alt-ref off, one temporal unit a frame, each group decoded in index
  order. That decode order is display order is *inferred* (an ask's cost grows with (G + 1)/2, row 100), not read in
  libaom's source.
* **Hierarchical coding** (alt-ref on, pyramids) codes a future frame first, hidden (`show_frame` 0), and shows it
  later through an overlay or `show_existing_frame` ([S1] §6.8.2). Every temporal unit still shows one frame, so the
  store's entry per frame and in-order dispatch hold ([`adr-unit.md`](adr-unit.md) §3). What changes (*derived*):
  a hidden frame rides in an earlier unit than the frame it shows, so some entries carry two or three frames' coding,
  and an ask at N decodes N − k + 1 shown frames plus every hidden frame coded before N. At the same G an
  ask never costs less than low-delay's. In lossless libaom filters the alt-ref (§4 point 7), so its frame is shown by
  a coded overlay, not by `show_existing_frame` (*inferred* from `encode_strategy.c:78-99`).
* **`show_existing_frame`** outputs a stored frame with nothing coded: a unit of a frame header, a few bytes
  ([S1] §6.8.2). Chromium's WebCodecs stalls on a delimiter-only unit ([`../decode/README.md`](../decode/README.md)
  §WebCodecs without a flush). **Prediction:** it returns the frame for a `show_existing_frame` unit, which the spec
  counts as shown ([S1] §7.5); one such unit through the dispatch variant decides.
* **Where a decoder can start** ([S1] §7.6.2–7.6.3): at a *key frame random access point* (`KEY_FRAME`, `show_frame`
  1, a sequence header in the same unit), which every payload is today, or at a *delayed* one (a hidden key frame,
  shown later by `show_existing_frame`). Nowhere else:
  * an **intra-only** frame keeps at least one reference slot (`refresh_frame_flags` ≠ 0xFF, [S1] §6.8.2), so the
    frames after it may predict across it;
  * a **switch frame** refreshes every slot ([S1] §5.9.2) but is inter-coded: it needs a stream's references, and on
    another stream's it is not exact ([`README.md`](README.md) §Options read from the sources).

  WebCodecs takes only the first as a key chunk ([S25] §4), so a delayed point could not open its decoder
  (*derived*). For G: a group starts at a shown key frame with its sequence header, and intra-only and switch frames
  add no point an exact client can start at.

## 5d · One all-key stream against one-frame streams

* **At G = 1 they are the same bytes.** Each payload is one temporal unit with a sequence header and a shown key frame
  ([`payload-format.md`](payload-format.md)), a whole AV1 bitstream. A series' units, a stream at a time (top, low),
  concatenate into one coded video sequence of key frames wherever their sequence headers are bit-identical, which
  [S1] §7.5 requires within a sequence (*derived*; not checked on a series' payloads).
* **In MP4, every sample a sync sample** must be a random access point: a shown key frame after a sequence header in
  the same sample ([S23] §2.4). So a track of sync samples carries the per-sample sequence header the payloads carry,
  and `av1C`'s `configOBUs` may hold it once more ([S23] §2.3.4). Every sample sync, `stss` is omitted and the sample
  tables give each sample's offset, through its chunk, and length ([`../disk-layout/containers.md`](../disk-layout/containers.md) §3.1). At G > 1 the
  sync flags would mark the groups; the client's k = G·⌊N/G⌋ ([`adr-unit.md`](adr-unit.md) §3) needs no table. A split
  payload is two tracks no player combines (containers.md §6). At G = 1 the one-stream form is a remux, not a re-encode
  (*derived*).
* **Decoder setup: the flush.** WebCodecs is configured once per codec string ([`payload-format.md`](payload-format.md)
  §Decoder choice, per payload) and demands a key chunk only after `configure`, `flush` or `reset` ([S24] §4.5,
  `[[key chunk required]]`); a shown key frame refreshes all eight reference slots ([S1] §5.9.2), so a key chunk inside
  a stream needs no flush by the codec. The client flushes at every group's end, so at G = 1 before every frame, to
  guard against a unit labelled key that is not one, and skipping a flush was 7–20 % faster a frame at 1× and 3–28 % at
  4× (row WCLAT, [`../decode/README.md`](../decode/README.md) §WebCodecs without a flush). *Inferred:* at G = 1 a
  parse of the unit's first frame header against the three conditions of [S25] §4 can be that guard instead, and
  the client already parses each key unit's sequence header for its codec string; dav1d-WASM's `dav1d_flush` a frame
  ([`adr-unit.md`](adr-unit.md) §2) plays the same role, its cost unmeasured. **Prediction:** a G = 1 series decoded
  through WebCodecs with no flush between key units, the key checked by parse, is exact and about 0.72–0.97 of today's
  time a frame at 4×, less the parse; row WCLAT's harness, interleaved, decides. That is the one setup cost a single stream would save,
  and G = 1 can save it.

## The record before the data

The frame-group theory (queue row GOPTHEORY), written 2026-10-08 before any new data, and its review against the data
(§T4a, row GOPREVIEW). What it predicts is tested by the measurement in [`gop-protocol.md`](gop-protocol.md), and
that file is the only one the measuring session was given. Everything below comes from the sources in §6. It is kept
as recorded; a later correction is marked in place with its date.

### T1 · What lossless AV1 keeps and what it loses

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
  exact with it off ([`README.md`](README.md) §Exactness and the decoders), so every exact inter coding here so far had alt-ref off.
* **SVT-AV1 v4.2.0 switches temporal filtering off under lossless** ([S3] `enc_handle.c:3256`). It has no intra-only
  restriction, and 8 and 10 bits are intended ([S3] CHANGELOG v3.1.1). The lab found it exact only on grey 8 and on
  intra grey 10 (the encoders' exactness check, queue row TOOL), so where it is inexact the measurement reports it and does not use it.

### T2 · The mechanism: noise that the previous frame can predict

A lossless coder spends about the entropy of its prediction residual: for a residual close to Gaussian with
variance σ_r², about ½·log2(2πe·σ_r²) bits a sample ([S4] ch. 8). Write each frame as structure (anatomy, which
both predictors can follow) plus noise of variance σ² (quantum, electronic, reconstruction). In a medical frame
above 8 bits, the noise holds most of the bits: the low bits are noise in every source the lab has measured
([`split-prior-art.md`](split-prior-art.md); the low-stream measurement, queue row ENCX).

* **Intra** predicts a sample from its spatial neighbours. On spatially white noise, no spatial predictor brings
  the noise term below σ².
* **Inter** predicts from a motion-compensated sample of the previous frame. Let ρ be the correlation of the noise
  between the two frames at the best offset. The noise term of the residual is then 2σ²(1 − ρ) (*derived*; this is the
  prediction gain 1/(2(1 − ρ)) of first-order differencing [S5]).
* **So inter beats intra on the noise only where ρ > ½.** At ρ = 0 an inter residual carries twice intra's noise
  (+0.5 bit a sample), and averaging two independent references still carries 1.5σ² (+0.29 bit) (*derived*).
  *Refined 2026-10-24 (§4, point 4): "twice intra's" takes intra at its floor σ²; intra's own predictor also mixes in
  its neighbours' noise, and an inter frame may code any block intra, so a group's measured cost is far below half a bit (§4, point 6).*
* **A denoised reference cannot beat intra on independent noise.** A perfectly clean reference leaves σ², the same
  as intra. This is the most libaom's filtered alt-ref could reach, before the cost of its hidden frame.
* **Inter's other source of gain is structure that intra predicts badly**: texture, fine edges, and the speckle of
  ultrasound. Speckle is deterministic for a fixed tissue and probe position [S9], so it behaves as structure, not
  as noise.

Two consequences are checkable without an encoder:

1. **On noise-dominated content, the gain of inter is bounded by ρ.** It can be measured from the frames: the
   correlation of each frame's intra prediction residual with the next frame's, block by block at the best integer
   offset. Where the median block ρ is under ½, the noise term cannot pay, and any gain must come from structure.
2. **The low stream of a split** (the k low bits, the adopted per-depth split rule's k = 2 or 3, queue row SPLITRULE) is noise with ρ ≈ 0. **Inter on the
   low stream should cost bytes, never save them.** The low-stream measurement measured this: inter was 0–3.6 % larger.

### T3 · Each target type

#### DBT reconstructed slices

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
  most of it already with a 10-slice slab [S10], from slides that were not peer-reviewed. In the lab, the tomosynthesis and breast-family
  measurements (queue rows CONTENT, BREAST) measured groups on four volumes at −3.7 to +5.4 % of intra, with libaom only and alt-ref off
  ([`README.md`](README.md) §Frame groups, Scope).
* **The general literature** finds lossless inter-slice gains large on CT, dynamic 4-D data and fMRI ([S11], [S12],
  [S13]), small on MRI [S14], and up to 15 % over single-frame coders with dedicated 3-D predictors [S15]. Each
  depends on how much of the next slice the previous one predicts.

#### Breast ultrasound cine (native B-mode)

* **Why inter should pay.** Speckle decorrelates with probe and tissue motion, fastest out of the scan plane: the
  decorrelation curve is regular enough that frame spacing is computed from it, to within 10–15 % [S9]. In-plane
  motion moves the speckle without destroying it, so motion vectors follow it. At a hand's slow motion and 20–60
  frames a second, the elevational step between frames is a small fraction of the beam's width (*derived*: step =
  speed ÷ frame rate). So ρ of the speckle "structure" should be high, and inter should pay by much more than on
  DBT. Persistence (frame averaging in the scanner) raises ρ further.
* **Limits.** Electronic noise is independent from frame to frame. Real tissue rarely gives fully developed speckle
  [S16]. No peer-reviewed lossless figure was found for ultrasound cine (*unverified*).
* **The lab's only clip says nothing.** It was MPEG-4 and repeated blocks exactly, so its −47 % is the clip's
  ([`README.md`](README.md) §Frame groups, Scope).

#### Automated breast ultrasound (ABUS)

A constant-speed sweep, so the elevational step is fixed by the scanner. The same mechanism as the cine applies with
a larger, regular step, so ρ is lower than in a hand-held cine at rest (*derived*).

#### Contrast angiography runs

Every frame is a new exposure, so its quantum noise is independent of the last: ρ ≈ 0 on the noise. Vessels move
with the heart and the contrast flows, so structure changes too. Inter can pay only where the dose leaves the noise
small next to the structure. The lab's fluoroscopy (2 frames a second, 12-bit) gained 0.04 % (the lossless-bytes measurement, queue row SIZE), but it is
not a target series and not an angiography run.

### T4 · Predictions

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

P8–P10 wait on sound data ([`README.md`](README.md) §Open questions). P1–P7 can be tested on the CC BY DBT volumes.

### T4a · Review against the data

*Queue row GOPREVIEW, 2026-10-08.*

The frame-group measurement (queue row GOPMEASURE) ran the protocol on 15 sound, whole DBT volumes, five from each of three systems
([`lab/av1/bytes/frame-groups`](../../lab/av1/bytes/frame-groups/README.md), `cbbdf06`). ρ was measured on every adjacent slice pair; the
codings ran on each volume's middle 16 slices (G ≤ 16, the rule's range); cpu0, SVT-AV1 and the plain representation
ran on one volume a system.

| # | outcome | the numbers |
| --- | --- | --- |
| P1 | **not refuted, missed its band on two systems** | median ρ A 0.112, B 0.215, C 0.117: inside 0.2–0.5 on B only, above the 0.1 refutation line on all |
| P2 | **held** | best gain +1.51 % (`good` 6), +0.13 % (cpu0); every G > 1 larger than intra on 14 of 15 |
| P3 | **did not hold, near untestable** | Spearman(gain, ρ) +0.46 (*recomputed 2026-10-24 from the measurement's table: +0.43, ties at average rank; the outcome stands*), best-G gain +0.11 at 15 series: no relation; but 14 gains are ≤ 0, so there is no spread to rank. Scan arc recorded on system B alone (14.4–15.2°) |
| P4 | **not refuted, its 80 % clause failed** | G ≥ 8 adds ≤ 0.39 points over G = 4 (0.45 at cpu0); on the two series with any gain, G ≤ 4 holds 75 % and 54 % of it, gains of 0.1–1.5 % |
| P5 | **held** | low stream ρ 0.058–0.061 against 0.059 for independent noise; inter never under intra by > 0.5 % (best +0.13 %) |
| P6 | **refuted on system B; untestable on A and C** | alt-ref on beats off by 1.2–6.8 points on 9 of 10 exact cells (best +3.19 % over intra); on A's and C's 10-bit tops it is not lossless |
| P7 | **refuted on `b1`, the one series SVT-AV1 is exact on** | SVT preset 0 +2.43 % against libaom cpu0 −0.03 %; preset 8 +0.87 % against `good` 6 −0.16 % |
| P8–P10 | **not testable** | no sound native breast ultrasound cine, ABUS or angiography run ([`README.md`](README.md) §Open questions) |

**The mechanism held where it decides.** Every series' ρ is far under ½, the line §T2 draws, and no coding gains on
the noise: the low stream behaves as independent noise (P5), and libaom's alt-ref-off groups lose or tie (P2).
**What it underweighted is the structure term.** A temporally filtered hidden frame (P6) and SVT-AV1's predictors
(P7) find up to 3.2 % on system B's 8-bit streams. §T2 bounds a denoised reference at intra's noise, not intra's
structure, so this does not contradict the mechanism, but the predictions stated as "no better" and "same sign"
claimed more than the mechanism gives. ρ itself is lower than §T3's geometry argument expected on two systems
(0.11–0.12): the reconstruction shares less noise between 1 mm slices than assumed.

**Conclusive for DBT, by the pre-stated rule (§5.2 of the protocol).** Three systems, five series each, all under the
20 % line with libaom, and SVT-AV1 where exact (+2.43 %) does not cross it; every G > 1 also misses the decode bound
at 4× by 4.6–24.6×. Two limits, both inside the rule: the codings saw 16 slices of each volume, and the encoder
variants that gain (alt-ref on, SVT-AV1) are lossless only on system B's 8-bit tops. **Not conclusive for breast
ultrasound cine, ABUS or angiography**: there is no sound data, so they stay G = 1 by default (rule 3) and the theory's
largest claim, P8, is untested.

## 6 · Sources


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
* [S17] H. H. Barrett and K. J. Myers, *Foundations of Image Science*, Wiley 2004, ch. 11, Poisson statistics (locator *unverified*).
* [S18] Siewerdsen & Jaffray, "A ghost story: spatio-temporal response characteristics of an indirect-detection flat-panel imager", Med Phys 26(8):1624-1641, 1999, doi:10.1118/1.598657 (first-frame lag 2-10 %, from the abstract).
* [S19] Wagner, Smith, Sandrik & Lopez, "Statistics of speckle in ultrasound B-scans", IEEE Trans Sonics Ultrason 30(3):156-163, 1983, doi:10.1109/T-SU.1983.31404 (metadata read, text not; locator *unverified*).
* [S20] ISO/IEC 14496-2, *Coding of audio-visual objects, Part 2: Visual*, the `not_coded` macroblock flag. Not reached: the text is sold, and `iso.org` refused the request; locator *unverified*.
* [S21] DICOM PS3.3 2026d, A.27.3, the Digital Mammography X-Ray Image IOD's modules (`dicom.nema.org`, read 2026-10-24).
* [S22] Weinberger, Seroussi & Sapiro, "The LOCO-I lossless image compression algorithm", IEEE Trans Image Process 9(8):1309-1324, 2000, doi:10.1109/83.855427.
* [S23] AV1 Codec ISO Media File Format Binding v1.3.0, `aomediacodec.github.io/av1-isobmff/v1.3.0.html` (`ff70a1add286`), §2.3.4, §2.4.
* [S24] W3C WebCodecs, Working Draft 26 October 2026 (`2960ce936587`), §4.5, `decode()` and `[[key chunk required]]`.
* [S25] W3C AV1 WebCodecs Registration, Group Note Draft 13 October 2026 (`58b18e65c972`), §2, §4.
* [S26] dav1d 1.5.4, `src/decode.c` (`3ff801271cb7`), `:3671-3677`, references refreshed by reference count.

Re-read 2026-10-24: [S1]'s section numbers, counted from its headings at `5e04f3f`, and the `Lossless` tests cited in
§4; [S2] `encode_strategy.c:78-99, 746-757` at `v3.15.1`; [S3] `enc_handle.c:3256` and the v3.1.1 entry of its
CHANGELOG at `v4.2.0`; the abstracts of [S8], [S9], [S16] and [S18], and the metadata of every DOI above. The others
were not re-read.

Read 2026-10-27 for §5a–§5d: [S1] §3, §5.9.2, §6.8.2, §7.5 and §7.6.2–7.6.3 at `5e04f3f`; [S23]–[S26] at the sections
cited. The hash is the SHA-256 prefix of the copy read.
