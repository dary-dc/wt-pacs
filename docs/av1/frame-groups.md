# Frame groups in lossless AV1: the decision

**Should AV1 code a series' frames in groups, each frame after a group's first predicted from the frame before it
(G > 1), or code every frame alone (G = 1)?** For lossless, bit-exact delivery the answer is **G = 1 on every
content type.** On DBT reconstructed slices it rests on the numbers: the best gain is +1.51 % on 1 of 15 volumes and
every other volume is larger at every G > 1, while a group costs what §3 lists. On breast ultrasound cine and ABUS it
is a default: no data fit to test them is open.

This file owns the question: the decision (§1), the conditions it holds under (§2), how it was reached (§3), why
(§4), what would reopen it (§5), what else G touches (§5a–§5e) and the sources (§6). The theory, predictions and review written before and just
after the measurement are kept as they were recorded (§T1–§T4a). The protocol the measurement ran is
[`gop-protocol.md`](gop-protocol.md), unchanged since it was registered. Every number carries its row of
[`queue.md`](queue.md). Sections 1–5 were written 2026-10-24 from committed rows: nothing was coded again, and where a
figure was recomputed from a committed table, it says so. Arithmetic of our own is marked *derived*; a claim no
source confirms is marked *unverified*.

*G* is the group length: a keyframe every G frames, the frames between inter-coded ([`../glossary.md`](../glossary.md),
*group*). *Gain* is 1 − bytes(G) ÷ bytes(G = 1) on the same frames, encoder and preset: positive is smaller.

## 1 · The decision

**In scope**: cine-like series as the owner adopted it on 2026-10-30, frames ordered along one axis, breast imaging
first, at most 12 bits a sample ([`series.md`](series.md) §4c). Inside it, how much neighbouring frames share, noise
and speckle included, decides whether groups are worth testing.

| content | decision | evidence | what would reopen it |
| --- | --- | --- | --- |
| DBT reconstructed slices | **G = 1, adopted** | row 100: 15 sound volumes, five from each of three reconstruction systems; best gain +1.51 % on 1 of 15 (`dbts_b3`, libaom `good` 6, G = 16), every other volume larger at every G > 1; cpu0 at most +0.13 %; at 4× a mid-group ask took 4.6–24.6× one HTJ2K decode plus the wire time its saved bytes buy (§3). Before the protocol, rows 10 and 46 agree (four volumes, −5.4 to +3.7 %) | a sound series of a system not yet measured, or an encoder exact on 10-bit tops, whose groups gain enough to outweigh what they cost (§3, §5) |
| DBT projections, if displayed | **G = 1 by default, untested by the protocol** | row 21: two series, one per system, best +0.29 % on one and −0.2 to −1.0 % on the other; before the protocol; FOR PROCESSING views | the protocol on ≥ 2 systems × ≥ 2 series of displayed projections |
| breast ultrasound cine | **G = 1 by default, untested**: no native, losslessly stored, commercially licensed cine is open (rows 94, 137, 149) | the one open cine is an MPEG-4 Part 2 clip (row 46: 0.53–0.56 of intra's bytes), which enters no verdict (row 94; §4, point 9) | ≥ 2 independent sources × ≥ 2 native B-mode cine series, the probe slow or still (§5) |
| ABUS | **G = 1 by default, untested**: no ABUS volume is open in DICOM; the one set, in NRRD, is for its challenge only (rows 21, 137, 149) | none | ≥ 2 independent sources × ≥ 2 native ABUS volumes |
| breast DCE-MRI, per phase or per slice position | **not assessed** | none coded at G > 1; its two axes, [`series.md`](series.md) §4b | the owner asks for it |

**Outside the scope**, kept as context only:

| content | decision | evidence | what would reopen it |
| --- | --- | --- | --- |
| angiography and fluoroscopy runs | **G = 1 by default, untested**: the one open set of native runs states no licence (row 149); the rest are exports or cut runs (row 137) | off-target only: a 2 frames/s barium fluoroscopy run, G = 2 0.04 % under intra at cpu0, every other G larger (row 6) | ≥ 2 independent sources × ≥ 2 native contrast runs, or a licence for row 149's set (one source) |
| echocardiography | **not applicable**; G = 1 | none | the owner widens the scope |
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
  frame was exact, which is system B's 8-bit top and low. Known upstream and open, and why alt-ref matters:
  [`README.md`](README.md) §Exactness and the decoders.
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
  worker, n = 10 interleaved rounds (row 100). 4× is a cgroup cap on every thread of the browser's process tree,
  since Chromium's own throttle refuses workers ([`../decode/README.md`](../decode/README.md) §A slow CPU, emulated).
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

### What a group costs, and the rule registered before the data

The verdict is the numbers of §1 against these costs. A group is not free: an ask decodes up to G frames instead of
one, the fill runs in parallel only across groups, and a failed frame fails the rest of its group
([`adr-unit.md`](adr-unit.md) §3, *Invariants this breaks*). The decode trade-off is wire time saved against decode
added; its inputs are the bytes a group saves, the link's rate, and the serial decode of (G + 1)/2 frames on average
against one HTJ2K frame. On DBT at 20 Mbit/s and 4× a mid-group ask took 4.6–24.6× one HTJ2K decode plus the wire
time its saved bytes buy (row 100).

*What was pre-registered*, kept as history ([`gop-protocol.md`](gop-protocol.md), `e9d247a`). Its value was fixing
the reading before the data; its thresholds are not findings. *Corrected 2026-10-30:* the owner calls the 20 % "an
arbitrary number that we were considering to represent an impactful gains of AV1 GOP>1 above AV1 with only
keyframes. not a number that means anything for the discussion"; the same holds for the 0.80. For each content
type, **G > 1 is adopted only if on every sound series the best G ≤ 16 is all three of** (a) at
least 20 % fewer bytes than G = 1 at the shipped preset, every frame exact; (b) at most 0.80 of HTJ2K's bytes; (c) a
mid-group ask inside the decode bound (§2). The answer is **conclusive** when ≥ 2 systems (DBT) or ≥ 2 independent
sources (the other types), each with ≥ 2 series, land on the same side of the 20 % line with libaom, and SVT-AV1
where exact does not cross it. A type with no sound data gets no decision and stays at G = 1 (protocol §5).

* **Why a fifth.** The bar was proposed in `adr-unit.md` §4 before any number existed and kept for the protocol.
  Between cpu0 and `good` 6 the same frames' gain moves by up to 2.7 points (row 100) and 6.9 (row 46).
  *Corrected 2026-10-30:* this read "no document records why a fifth"; the owner has said it was arbitrary (above).
* **Why against HTJ2K too.** HTJ2K is what ingest serves. A group that beats AV1's own intra but not HTJ2K changes
  nothing a reader receives.
* **Why the decode clause.** The ask is the latency a reader feels; it is the trade-off above, registered as a
  pass/fail bound.
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
     overlay predicted from it (`encode_strategy.c:78-99`). libaom's documentation says it denoises "only on key
     frame and ARF frames" and codes overlays for filtered alt-refs [S29]; that lossless changes neither rests on
     the source alone. The filter does not make the output inexact; skip mode does (*derived*, [`README.md`](README.md)
     §Exactness and the decoders). A denoised reference adds almost no noise of its own, so
     inter from it can at best tie intra on noise, and it follows structure better than intra's neighbours do. The
     gain is all in the top stream (+2.5 to +6.5 %); on the low stream, which is noise, the same coding is 2.6–20.6 %
     larger (row 100).
   * SVT-AV1 v4.2.0 switches temporal filtering off under lossless ([S3] `enc_handle.c:3256`), so its gain cannot come
     from a denoised reference: it is its predictors following structure. It is also measured against its own intra,
     which takes 1.009 of HTJ2K's bytes to libaom's 0.939; SVT-AV1's best group is still 5 % larger than libaom's
     intra (row 100).

   The structure term is real, worth up to about 3 %, against what a group costs (§3).
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
  lossless on a 10-bit top. A release exact there is the first thing to re-run; their structure gains are ≤ 3.2 %.
* **cpu0, SVT-AV1 and the plain representation ran on one volume a system** (`dbts_a1`, `dbts_b1`, `dbts_c1`).
* **One host's decode.** At 4× an ask took 4.6–24.6× what it would break even at; a faster decoder would leave the
  bytes as they are, +1.51 % at best.
* **The client.** dav1d-WASM fails every split group at G > 1: the low unit, decoded as a keyframe on the top's
  instance, flushes the top's references (row 100; reported, not fixed). Adopting G > 1 anywhere would need that
  fixed first.
* **The scan arc** is recorded on system B only, so whether a narrower arc shares more noise (P3) is untested across
  systems.

For DBT, what would reopen it is a sound series, of a system not yet measured, whose median ρ is over ½, or a coding
on a sound series whose gain outweighs a group's costs (§3).

## 5a · What else G touches, and where it is written

*2026-10-27, theory only: nothing coded, decoded or timed. Inference is marked* derived *or* inferred*; a claim no
source read confirms,* unverified.

| dimension | covered where / added here | what it means for G |
| --- | --- | --- |
| random access: an ask mid-group, scrolling back, a jump | covered: §2 *The decode bound* and §3; [`adr-unit.md`](adr-unit.md) §3 (an ask asks from its keyframe; *What the cache holds*: frames k … N are all delivered) and its invariants 2–3; [`README.md`](README.md) §Frame groups; [`../decode/README.md`](../decode/README.md) §An ask behind the decoders (a jumping ask only to a decoder holding no group) | an ask costs (G + 1)/2 serial decodes on average, 4.6–24.6× over the bound at 4× (row 100); a step back after an ask is in hand, a step forward continues; a jump into another group starts at its keyframe |
| sequential cine playback | added, §5b | G > 1 saves bytes only on the first pass and costs that pass its decoders' parallelism |
| reference structures: low-delay, hierarchical, alt-ref and hidden frames, show-existing-frame | hidden alt-ref and overlay: §4 point 7, [`adr-unit.md`](adr-unit.md) §3 (a temporal unit carries up to 3 frames); added, §5c | hierarchical coding makes every ask dearer than low-delay at the same G when every unit up to N is decoded; §5e counts what a frame needs |
| key, intra-only and switch frames; what a decoder needs to start | intra-only not a start, switch frames not exact: [`README.md`](README.md) §Options read from the sources; added, §5c | only a shown key frame with its sequence header starts a group an exact client can ask |
| one all-key stream against one-frame streams | the containers and their indexes: [`../disk-layout/containers.md`](../disk-layout/containers.md) (row 159); added, §5d | at G = 1 they are the same bytes; the per-frame flush is the one setup cost, and it is open at G = 1 already |
| encoders exact on inter at 10 and 12 bits | covered: §2; [`README.md`](README.md) §Exactness and the decoders (rows 1, TOOL) and §Encoding (`--rt`, `svc_encoder_rtc`) | libaom only, with `--auto-alt-ref=0` or `--rt`; SVT-AV1 v4.2.0 inter exact at 8 bits only; rav1e 0.7.1 has no lossless mode |
| decoders for groups: WebCodecs, dav1d, dav1d-WASM on split groups, hardware | covered: [`../decode/README.md`](../decode/README.md) §WebCodecs without a flush (row WCLAT) and §WebCodecs, what it decodes exactly (12 bits refused at any G); §5 *The client*; [`../decode/hardware.md`](../decode/hardware.md) §3–§5 (4:0:0 and 12-bit limits), §9 (G = 8 cells proposed) | a group goes through WebCodecs at 8 and 10 bits; a 12-bit top only through dav1d-WASM, which fails every split group today |
| decoder memory for references | [S1] §3 (`NUM_REF_FRAMES` 8); dav1d holds a reference by count ([S26]); dav1d-WASM never returns heap (row 38) | up to eight distinct pictures a decoder where G = 1 holds one: about 5 MB each on a 2.5 Mpx 10-bit DBT top, so up to 35–40 MB more (*derived*; two bytes a sample above 8 bits *unverified*) |
| loss and corruption inside a group | a failure fails the rest of its group: [`adr-unit.md`](adr-unit.md) §3 invariant 4; a truncated frame fails: [`../CLIENTS.md`](../CLIENTS.md#a-truncated-frame-is-a-failure) | a retransmitted frame holds back, and a broken one breaks, up to G − 1 frames; error-resilient mode only lets a frame parse alone ([S1] §6.8.2), its prediction still reads the broken reference (*derived*) |
| the per-frame exactness check inside a group | no second path for a frame inside a group: [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §8 | the digest still decides frame by frame; each later mismatch starts a second decode that fails for want of references, so at G > 1 a mismatch should fail the rest of its group by name (*inferred*; nothing to build at G = 1) |
| energy on phones | [`../devices.md`](../devices.md) D5; nothing measured on a phone | a frame costs the same decode at any G (row 100's mean ask over (G + 1)/2 frames is 0.97–1.03 of G = 1's frame at 4×, *derived*), so a fill in order is predicted a tie and a cold ask costs (G − 1)/2 extra decodes |
| late frames in a container | PR #179 and PR #185; the owner, 2026-10-30: appended only, "we expect this case not to ever occur. We can assume it for now." | #179's mid-series re-encode of a group (about 9 s of CPU at G = 30) is for a frame inserted mid-series, outside the assumptions; appending a group that starts with a key frame and its sequence header re-encodes nothing (*derived*, §5c) |

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

**Prediction** (native cine, untested, §5): where a native cine gains, G > 1 shortens a wire-bound first pass by about
its gain and lengthens a decode-bound one up to D× at G ≥ F. Total time to the whole loop at G ∈ {1, 8, F}, on
wire-bound and decode-bound cells, would decide. Whether one decoder keeps up with a native cine's frame rate is
unmeasured.

## 5c · Reference structures, and where a decoder can start

* **What was measured is low-delay**: libaom with alt-ref off, one temporal unit a frame, each group decoded in index
  order. That decode order is display order was *inferred* from row 100 (an ask's cost grows with (G + 1)/2); libaom's
  encoder guide confirms it: with no alt-ref the frames "form an IPPP GF group structure" ([S29]).
* **Hierarchical coding** (alt-ref on, pyramids) codes a future frame first, hidden (`show_frame` 0), and shows it
  later through an overlay or `show_existing_frame` ([S1] §6.8.2 has the hidden frame and `show_existing_frame`;
  "overlay" is libaom's word, not the spec's [S29]; *corrected 2026-10-30*: this cited [S1] for the overlay).
  Every temporal unit still shows one frame, so the store's entry per frame and in-order dispatch hold ([`adr-unit.md`](adr-unit.md) §3). What changes (*derived*):
  a hidden frame rides in an earlier unit than the frame it shows, so some entries carry two or three frames' coding,
  and an ask at N, decoding every unit up to N as the client does, decodes N − k + 1 shown frames plus every hidden
  frame coded before N: never less than low-delay's at the same G. *Corrected 2026-10-30:* a decoder that decodes only
  what N needs can cost less on a pyramid (§5e). In lossless libaom filters the alt-ref (§4 point 7), so its frame is
  shown by a coded overlay, not by `show_existing_frame`: libaom documents that for a filtered alt-ref [S29]; that
  lossless filters it rests on [S2] alone.
* **`show_existing_frame`** outputs a stored frame with nothing coded: a unit of a frame header, a few bytes
  ([S1] §6.8.2). Chromium's WebCodecs stalls on a delimiter-only unit ([`../decode/README.md`](../decode/README.md)
  §WebCodecs without a flush). **Prediction:** it returns the frame for a `show_existing_frame` unit, which the spec
  counts as shown ([S1] §7.5); one such unit through the dispatch variant decides.
* **Where a decoder can start** ([S1] §7.6.2–7.6.3): at a *key frame random access point* (`KEY_FRAME`, `show_frame`
  1, a sequence header in the same unit), which every payload is today, or at a *delayed* one (a hidden key frame,
  shown later by `show_existing_frame`). These are the minimum every decoder supports; the spec lets a decoder
  support more ([S1] §7.6.1; *corrected 2026-10-30*, this read "nowhere else"). Not among them:
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
  a stream needs no flush by the codec. The client flushes at every group's end, so at G = 1 after every frame, to
  guard against a unit labelled key that is not one, and skipping a flush was 7–20 % faster a frame at 1× and 3–28 % at
  4× (row WCLAT, [`../decode/README.md`](../decode/README.md) §WebCodecs without a flush). The flush guards only
  because it sets `[[key chunk required]]`, after which a decoder "SHOULD" inspect the chunk ([S24] §4.5); without
  it nothing checks, so a parse in the client can take its place (*derived*). The parse walks the OBUs to the first
  frame header, each a 1–2-byte header and a size of at most 8 bytes ([S1] §5.3.2, §4.10.5; always present, §5.2),
  requires a sequence header OBU before it, and reads the frame header's first 4 bits: `show_existing_frame` 0,
  `frame_type` `KEY_FRAME`, `show_frame` 1 ([S1] §5.9.2, §7.6.2; [S25] §4), and *corrected 2026-10-30:* no OBU
  extension, else an operating point may drop that header ([S1] §5.3.1; [`../decode/README.md`](../decode/README.md)
  §WebCodecs without a flush). Where the sequence header's `reduced_still_picture_header` (its fifth bit) is 1, those are implied ([S1] §5.5.1, §5.9.2). `refresh_frame_flags`
  is not read: a shown key frame does not code it and refreshes all eight slots ([S1] §5.9.2). That is one byte of
  each of two OBUs and the headers before them, a few tens of bytes whatever the frame's size (*derived*), and the
  client already walks these OBUs for its codec string (`client/decode/av1-payload.js:60`); dav1d-WASM's `dav1d_flush` a frame
  ([`adr-unit.md`](adr-unit.md) §2) plays the same role, its cost unmeasured. **Prediction:** a G = 1 series decoded
  through WebCodecs with no flush between key units, the key checked by parse, is exact and about 0.72–0.97 of today's
  time a frame at 4×, less the parse; row WCLAT's harness, interleaved, decides. That is the one setup cost a single stream would save,
  and G = 1 can save it. *Corrected 2026-10-30:* the prediction also assumes each unit's frame comes out without a
  flush, which the sources do not give: a decoder may hold outputs until more input or a flush, and
  `optimizeForLatency` is a "SHOULD" hint ([S24] §1, §7.6). The flush buys a released frame and a checked key; the
  parse replaces only the second, so the prediction holds for Chromium 141 as measured, not by specification.
  **Verdict, 2026-10-30 (*derived*):** at G = 1 the key parse, the OBU-size walk, the timestamp match, the stall timer
  and the per-frame digest cover what the flush guards, and the flush adds no guarantee they lack. The remaining
  risks are a series without digests, the digest's collision bound and unbounded liveness. Dropping it is a candidate
  to build and measure under the protocol pre-registered in [`../decode/README.md`](../decode/README.md) §Safety
  without the flush, from the specifications; *corrected 2026-10-31:* built behind decoder config `keyParse`, off by
  default, and not yet measured (*ibid.*).

## 5e · What a frame needs before it can be decoded

*2026-10-30, theory only: nothing coded, decoded or timed. Quotes are verbatim; arithmetic of our own is* derived.

**What an inter frame reads.** A block predicts from `FrameStore[ ref_frame_idx[ refFrame − LAST_FRAME ] ]`
([S1] §7.11.3.1 step 9, §7.11.3.4), and a slot holds a frame's decoded, filtered samples: "FrameStore[ i ][ 0 ][ y ][ x ]
is set equal to LrFrame[ 0 ][ y ][ x ]" (§7.20). The same update saves the frame's CDFs, motion vectors, segmentation
and loop-filter deltas into the slot, so a frame also inherits state, not only pixels (§7.20). Each inter frame names
seven of the eight slots (`REFS_PER_FRAME` 7, `NUM_REF_FRAMES` 8, [S1] §3), and "RefValid[ ref_frame_idx[ i ] ] is equal
to 1" is required of all seven, used or not (§6.8.2). The slot names also enter parsing: `skip_mode_params` reads
`RefOrderHint[ ref_frame_idx[ i ] ]` (§5.9.22). After decoding, bit i of `refresh_frame_flags` stores the frame in slot i
(§7.20); a shown key frame and a switch frame store into all eight (§5.9.2). So the illustration's last point holds, and
more than pixels travel: a frame needs the decode of every frame that last wrote a slot it names, recursively
(*derived*).

**What lets a decoder skip a frame.**

* `refresh_frame_flags` = 0: no slot keeps the frame, so no later frame can read it (*derived* from §7.20). The
  encoder "can decide which reference frame in the decoded frame buffer to replace … also allows one to bypass
  updating" it ([S27] §III-A). A frame stored in a slot that no later frame reads is not marked as such; only later
  headers tell (*derived*).
* A hidden frame (`show_frame` 0) is decoded like any other: it "may be output later if a later uncompressed header
  uses show_existing_frame equal to 1" (§6.8.2). Han et al. name its cost: "an additional frame for decoders to
  process" ([S27] §III-B).
* `show_existing_frame` decodes nothing: it outputs slot `frame_to_show_map_idx` (§6.8.2, §7.21); showing a stored key
  frame this way refreshes every slot (§5.9.2), the *key frame dependent recovery point* (§7.6.2).
* Temporal layers are the one mechanism that marks skippable frames in advance: a layer T may "only reference
  previously coded video data of temporal_id T' … where T' <= T" (§6.2.3), and an OBU outside the chosen operating
  point is dropped with "no effect on the decoding process" (§6.2.1).

Outside an operating point the spec defines no bitstream with frames removed after its start; dropping units is
defined only before a random access point (§7.6.3). Whether dav1d and WebCodecs decode a key frame followed by a unit
whose predecessors were removed is *unverified*.

**Where a decoder can start** is in §5c: a key frame random access point or a delayed one (§7.6.2–7.6.3), each
with a sequence header in its unit; an intra-only frame is not one, since its `refresh_frame_flags` "is not equal to
0xff" (§6.8.2). The citations of §5c and §5d to [S1] and [S25] were re-read at the same hashes: sections and wording
agree; two of §5c's claims were corrected in place.

**Per structure.** *n* is the frame's index in its group (0 the key frame, uniform over 0 … G − 1); decodes count
the key frame and frame *n*, in a decoder that decodes only what *n* needs (*derived*, every row).

| structure, as the sources name it | decodes to reach *n*: worst, average | efficiency trade-off | source |
| --- | --- | --- | --- |
| all key frames (G = 1) | 1, 1 | a key frame "resets the decoding process when it is shown" ([S1] §2); nothing predicted, and on DBT inter gains ≤ 1.5 % (§1) | [S1] §2, §7.6.2 |
| **low delay**, "IPPP" in libaom; what the lab measured (the illustration's *chain*) | G, (G + 1)/2, if each frame names its predecessor's slot; which other six slots libaom names was not read | none read for lossless; row 100's +1.51 % best on DBT | [S29] `av1_encoder.dox:908-909`: "If ALTREF frame is not allowed for the GF group: the frames are set as LF_UPDATE. This basically forms an IPPP GF group structure." |
| every frame from the key frame alone (the illustration's *hub*): **no structure of that name found in official sources**; nearest, the spec's *golden frame* | 2, 2 − 1/G, if all seven names point at the key frame's slot, which no frame overwrites (allowed: "no requirement that the values in ref_frame_idx should be distinct", §6.8.2) | that prediction across a longer distance saves fewer bytes: *not found in official sources* | [S1] §2: golden frame "is used as a reference for multiple inter frames"; [S29] `aomcx.h:1879-1899` sets `reference`, `ref_idx` and `refresh` per frame |
| **hierarchical**, "pyramid" with alt-ref (ARF) in libaom; "hierarchical B pictures" in [S28]; the *random access* configuration of the VVC test model | L + 2, about L + 1 (81/16 ≈ 5.1 at L = 4), for G − 1 = 2^L and each frame naming only its ancestors in the tree, as the VVC test model's configuration does (temporal levels 0–5 over 32 frames); a filtered ARF shown by a coded overlay (§5c) adds one. The illustration's log2(G) + 1 is the average, not the worst | "coding gains of more than 1 dB … at the expense of an increased coding delay" over IBBP ([S28], abstract, lossy); libaom stores every frame but an overlay in a slot ([S2] `encode_strategy.c:705-721`), so ancestor-only references are not assured; libaom's alt-ref is not exact on 10-bit tops (§5) | [S27] §III-B: "An ARF that is later being directly displayed can be effectively used to code a future frame in a pyramid coding structure"; [S30] |
| **temporal layers** (SVC), libaom's three-layer pattern | ⌊(G − 1)/4⌋ + 3, G/8 + 1.5 at G a multiple of 4: the base layer is a chain every fourth frame, and each frame of layer 2 is stored nowhere | row 25: temporal layers −3 to +4 % in bytes, lossless, exact | [S1] §6.2.3; [S2] `examples/svc_encoder_rtc.cc:825-853`: "First top layer: no updates, only reference LAST (TL0)." |
| long-term reference | — | — | the term is *not found* in [S1]; a slot holds a frame until a `refresh_frame_flags` bit overwrites it (§7.20) |

The per-frame control `AV1E_SET_SVC_REF_FRAME_CONFIG` is documented with no mode or lossless restriction, its
examples "for RTC encoding" ([S29] `aomcx.h:1894`); that it holds in lossless is *not found in official sources*.
Rows 15 and 25 coded lossless through `svc_encoder_rtc`, which sets it (`svc_encoder_rtc.cc:2171`), exact in every cell.
The HEVC and VVC common test conditions documents were not reached (their server refused the connection); the VVC
test model's configuration files are read instead, as source of last resort.

**For a later measurement, to be pre-registered separately.** *T* is the whole series decoded once in order, *A* one
frame asked mid-group from a cold decoder; F frames, G a group.

* **H1.** In order, each structure decodes each coded frame once, so *T* is F frames' decodes plus one per hidden frame.
  *Prediction:* *T* ties across G = 1, low delay, the hub and temporal layers (§5a, a frame costs the same at any G),
  and the pyramid adds about F/G overlay decodes in libaom lossless (§5c; [S27] §III-B).
* **H2.** *A* is the closure's count times a frame's decode. *Prediction:* at G = 16, from the table, about 8.5 (low
  delay), 1.9 (hub), 3.5 (temporal layers), 4–5 plus an overlay (pyramid) and 1 (G = 1) frames' decodes, if the
  decoder decodes the closure only; decoding every unit up to N, as the client does, each costs its position, the
  pyramid more (§5c).
* **H3.** Decoding the closure only needs every header up to N parsed and the decoder to accept the units between
  removed. *Prediction:* parsing is under 1 % of *A* (*unverified*); acceptance is open (above) and decides whether H2's
  closure counts are reachable at all.
* **H4.** Bytes. *Prediction:* no structure gains more than a few percent on DBT (§4's mechanism; row 100's ≤ 1.5 %),
  so the structure is chosen by *A*, not by bytes.

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
* **libaom 3.15.1 still temporally filters its alt-ref in lossless mode** (source code alone). Only key-frame
  filtering checks for lossless ([S2] `encode_strategy.c:746-757`). The filtered alt-ref is coded and never shown; the real frame follows
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
largest claim, P8, is untested. *Corrected 2026-10-30:* the 20 % line is not a finding (§3); the DBT verdict stands
on the numbers of §1.

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
* [S24] W3C WebCodecs, Working Draft 26 October 2026 (`2960ce936587`), `w3.org/TR/webcodecs/`: §1 *Internal Pending Output*; §4.5, `decode()`, `flush()` and `[[key chunk required]]`; §7.6 `optimizeForLatency`.
* [S25] W3C AV1 WebCodecs Registration, Group Note Draft 13 October 2026 (`58b18e65c972`), `w3.org/TR/webcodecs-av1-codec-registration/`, §2, §4.
* [S26] dav1d 1.5.4, `src/decode.c` (`3ff801271cb7`), `:3671-3677`, references refreshed by reference count.
* [S27] J. Han et al., "A Technical Overview of AV1", Proc. IEEE 109(9):1435-1462, 2021, doi:10.1109/JPROC.2021.3058584, §III-A, §III-B; read as arXiv:2008.06091v2, the journal text not read.
* [S28] H. Schwarz, D. Marpe, T. Wiegand, "Analysis of Hierarchical B Pictures and MCTF", IEEE ICME 2006, pp. 1929-1932, doi:10.1109/ICME.2006.262934; abstract only (the full text refused).
* [S29] libaom v3.15.1 (`44d0a57`) documentation, `aomedia.googlesource.com/aom/+/refs/tags/v3.15.1`: `aom/aomcx.h` (API header; `AV1E_SET_ENABLE_OVERLAY`, "overlay frames for filtered ALTREF frames") and `doc/dev_guide/av1_encoder.dox` §GF/ARF Frame Groups & Hierarchical Coding, §Temporal Filtering.
* [S30] VVC test model (VTM) `cfg/encoder_randomaccess_vtm.cfg:13-51` at `051e5e7`, source of last resort: `IntraPeriod` 32, `GOPSize` 32, temporal levels 0–5.

Re-read 2026-10-24: [S1]'s section numbers, counted from its headings at `5e04f3f`, and the `Lossless` tests cited in
§4; [S2] `encode_strategy.c:78-99, 746-757` at `v3.15.1`; [S3] `enc_handle.c:3256` and the v3.1.1 entry of its
CHANGELOG at `v4.2.0`; the abstracts of [S8], [S9], [S16] and [S18], and the metadata of every DOI above. The others
were not re-read.

Read 2026-10-27 for §5a–§5d: [S1] §3, §5.9.2, §6.8.2, §7.5 and §7.6.2–7.6.3 at `5e04f3f`; [S23]–[S26] at the sections
cited. The hash is the SHA-256 prefix of the copy read.

Read 2026-10-30 for §5d: [S1] §4.10.5, §5.2, §5.3.2, §5.5.1 and §5.9.2 at `5e04f3f`; [S24] §1, §4.5 and §7.6 and [S25]
§4, the same copies by hash. Read 2026-10-30 for [`../decode/README.md`](../decode/README.md) §WebCodecs without a
flush: [S1] §5.2, §5.3.1, §5.9.2, §5.9.30, §6.8.2, §7.2, §7.5 and §7.6.3 from `aomediacodec.github.io/av1-spec/`
(`acf58a3fdb82`, its commit not checked against `5e04f3f`); [S24] §1, §4.5, §4.6 and §7.6 and [S25] §4, the same
copies by hash.

Read 2026-10-30 for §5e: [S1] §2, §3, §5.9.2, §5.9.22, §6.2.1, §6.2.3, §6.8.2, §7.5, §7.6, §7.11.3, §7.20–7.21 at
`5e04f3f`, section numbers counted from its headings; [S25] §4; [S27]–[S30] as cited; both DOIs' metadata. [S2]'s
`encode_strategy.c:705-721` and `examples/svc_encoder_rtc.cc` at `v3.15.1`, source of last resort.
