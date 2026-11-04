# profiles — lossy AV1 quality profiles by role, intra and inter, with the exact frame on request

*The owner, 2026-11-02.* The product is considering **quality profiles** by user role. Most users scroll a cine-like
series — frames along one axis: DBT slices, breast ultrasound cine, ABUS; ≤ 12 bits — as a lossy AV1 stream meant
to be visually lossless; some roles may ask for the exact frame, explicitly and on demand, never by default. The exact
frame is either a whole HTJ2K frame or a lossless HTJ2K **residual** added to the decoded lossy frame (row 17,
[`../delivery/residual`](../delivery/residual/README.md); its decode timed apart is pre-registered on the branch
`claude/av1-residual-apart`, §Residual apart protocol).

**This file is theory, a prediction and two protocols, written before any number** and run by separate sessions:
nothing here was encoded, decoded or timed, and no product or server code changes. The one change to data is §Larger
cine fixtures, which pins five more public series. Repo claims carry their row and file; outside claims quote their
source ([L1]–[L7], §Sources); inference is marked *derived*, the rest *unverified*. §7, written 2026-11-04 after §6 ran
and could not decide, amends §6's campaign from that run's numbers and a pilot of its own.

## Names

* **Quantizer** — libaom's 0–63 scale, the one `--cq-level`, `--min-q` and `--max-q` take; aomenc maps it to the
  AV1 specification's 0–255 `base_q_idx` through a fixed table ([L2]: `quantizer_to_qindex[]`, 4 a step, 62 → 249,
  63 → 255). Written **Q**. Quantizer 0 is lossless by the specification's own definition ([L1]: `LosslessArray[
  segmentId ] = qindex == 0 && DeltaQYDc == 0 && …`), so the ladder starts at 1. The owner's "qualities" are rungs of Q.
* **Lossy stream** — a series' frames coded lossy AV1 at one Q and one G, shown as they decode.
* **Residual** — source − the decoded lossy frame, per sample, one offset per series making it unsigned, coded
  losslessly in HTJ2K's served profile (row 17). The decoded lossy frame plus the residual is the exact frame.
* **Quality profile** — what a role receives by default; three are compared:

| profile | by default | on request | today |
| --- | --- | --- | --- |
| **exact** | every frame exact: HTJ2K, or lossless AV1 at G = 1 split as shipped | — | the product |
| **standard** | the lossy stream | nothing more | proposed |
| **exact on request** | the lossy stream | the asked frame exact: its residual, or its whole HTJ2K frame | proposed |

*G* is the group length, a keyframe every G frames ([`../../../docs/glossary.md`](../../../docs/glossary.md), *group*).
*Gain* is 1 − bytes(G) ÷ bytes(G = 1) of the lossy stream at the same Q: positive is smaller.

## 1 · Theory

**1a. What lossless inter did, and why** ([`docs/av1/frame-groups.md`](../../../docs/av1/frame-groups.md) §4). Write
a frame as structure s plus noise n of variance σ². Lossless coding pays every bit of the noise; an inter copy's
residual noise is n_t − n_t−1, variance 2σ²(1 − ρ), which beats intra's σ² only when the noise correlates between
frames at ρ > ½. DBT measured ρ 0.11–0.22 (system medians; floor 0.059), so lossless G > 1 was 0.2–2.9 % *larger*
than intra on 12 of 15 volumes and gained at most +1.51 % (row 100).

**1b. What a quantizer changes** (*derived*). A lossy AV1 block codes its prediction residual through a transform and
a quantizer of step Δ looked up from qindex ([L1] §Dequantization functions: "The function dc_q( b ) is specified as
Dc_Qlookup[ (BitDepth-8) >> 1 ][ Clip3( 0, 255, b ) ]", one table a depth, rising with b; `ac_q` alike). Spatially white noise
spreads evenly over an orthonormal transform's coefficients, so each carries variance about σ²; a coefficient much
smaller than Δ is coded as zero, and rate-distortion optimisation zeroes more. Three regimes follow, by the ratio of
the step to the noise:

* **Δ ≪ σ** — the noise is still coded, nearly as in lossless; inter carries 2σ²(1 − ρ) against intra's σ², and
  loses as lossless did.
* **Δ ≈ σ** — the crossover: most noise coefficients fall to zero in either mode; what is left is structure plus the
  noise's large tail.
* **Δ ≫ σ** — the noise is not coded in either mode; both pay for structure alone. The reference an inter block
  predicts from is a *decoded* frame, which the quantizer and the loop filters have already denoised, so inter's
  noise penalty vanishes and what remains is how well the previous slice predicts this one's structure.

So **the sign of inter's gain should turn with Q**, from lossless's small loss to a gain set by the structure the
slices share. ρ of the noise stops mattering; the structural correlation takes its place. It is observable: the
coded error's RMSE, e, against the source's noise, σ — the crossover sits near e ≈ σ, which is PSNR ≈ 20·log10(peak ÷ σ).

**1c. How much structure DBT slices share.** A feature in one plane reappears blurred and shifted in its neighbours,
because every slice is reconstructed from the same projections (frame-groups §T3, [S6]–[S7] there). Row 100's ρ
statistic mixes structure and noise; its 90th percentile reaches 0.32–0.91 on the top stream (structured blocks),
against medians of 0.11–0.27 where noise dominates. One offset cannot align the per-projection shifts (Δz·tan θ, 0–4.7
px at ±25°, frame-groups §T3), so inter predicts the coarse, out-of-plane part well and the in-focus detail badly:
DBT should gain clearly less than natural video, where a predicted frame costs a small fraction of a keyframe at the
same Q (*unverified* for these encoders and settings; a reading of common practice, not a measured figure here).

**1d. How the gain scales with G** (*derived*). With a keyframe of K bytes and predicted frames of P bytes each,
gain(G) = (1 − 1/G)(1 − P/K). So gain(8) ÷ gain(16) = 0.875 ÷ 0.9375 = 0.93 and gain(whole) ÷ gain(16) ≤ 1 ÷ 0.9375
= 1.07 when P/K holds across G. The prediction chain is one frame long at every G (low-delay, §5), so P/K should hold.

**1e. The residual** (*derived*). Residual = source − decoded lossy frame = noise + coding error of the structure. At
small Q it is about the noise the lossy stream left out, and its lossless bytes approach what HTJ2K pays for that
noise, so lossy stream + residual ≈ HTJ2K plus the lossy stream's share of structure coded twice; at large Q the
residual also carries structure, and its bytes rise. Row 17 measured the sum at **0.947–1.002 of HTJ2K** at each
series' best CRF (G = 8, `--end-usage=q`, cpu6), the best CRF 8 or 20, never the smallest stream. Inter coding of the
lossy stream changes the residual little: the residual is mostly noise, which intra and inter leave alike once
Δ ≫ σ.

**1f. Depth** — §4.

## 2 · Prediction

Written 2026-11-02, before any number. Each is for the bytes protocol (§5) unless it says otherwise. *Crossover rung*
is, per series, the first rung of the ladder at which intra's (G = 1) RMSE at the coded depth reaches the series'
measured noise σ (§5, *Noise σ and ρ*). Bands are per series unless they say system median.

| # | prediction | refuted by |
| --- | --- | --- |
| **P1** | **Inter turns from loss to gain with Q.** On every DBT series, G = 16's gain is ≤ +5 % at every rung whose intra RMSE is under σ ÷ 2, and ≥ +10 % from the crossover rung up (± one rung). | a series with gain > +5 % below σ ÷ 2; or < +10 % on every rung from the crossover up, on ≥ 3 of 15 series |
| **P2** | **How much, once the noise is gone.** At the first rung whose intra RMSE ≥ 2σ, G = 16's gain is **+15 to +50 %** (system medians); at equal PSNR (§5, *Derived per series*) **+10 to +40 %**. | a system median outside either band |
| **P3** | **Monotone.** From the crossover rung up, gain rises or holds with Q (one rung's dip of ≤ 2 points allowed). | a fall of > 2 points between adjacent rungs, or two dips, on ≥ 3 series |
| **P4** | **Scaling with G** (1d). On every series whose G = 16 gain is ≥ +10 %: G = 8 holds ≥ 80 % of it, and the whole series ≤ 115 %. | either bound broken on ≥ 3 such series |
| **P5** | **System B gains most.** B (10-bit, ρ 0.18–0.27) has the highest system median G = 16 gain at the majority of rungs from the crossover up; A and C (12-bit, ρ 0.11–0.13) within 5 points of each other there. | B not highest at the majority of those rungs |
| **P6** | **The bend sits at the noise.** On log bytes against PSNR, the steepest change of slope (§5, *Derived per series*) falls within one rung of the crossover rung. | > 1 rung away on ≥ 5 of 15 series |
| **P7** | **The residual ties HTJ2K.** Lossy stream + residual, at its best rung, is **0.93–1.03 of HTJ2K** per DBT series at G = 1; at G = 16 at most 3 points under G = 1's at the same rung; residual bytes rise with Q at every G. | a series outside 0.93–1.03; inter lowering the sum by > 5 points; residual bytes falling between adjacent rungs on ≥ 3 series |
| **P8** | **Display error follows RMSE.** For each header window, the share of in-window samples whose 8-bit code differs is within ×2 of min(1, 0.8 · e · 255 ÷ W) (*derived*: a Gaussian error's mean absolute value is 0.8 e, against a code W ÷ 255 units wide). | outside ×2 on > ⅓ of (series, rung, window) cells with RMSE ≥ σ ÷ 2 |
| **P9** | **Depth** (§4). On the 12-bit series at rungs from the crossover up, the 10-bit top and the windowed map's lossy streams are within ±10 % of the 12-bit stream's bytes at the same Q and within 0.5 dB of its PSNR; under the crossover the 12-bit stream is larger (it codes the noise in its two extra bits). The windowed map's residual is ≥ the top-10's on every series. | a 12-bit series breaking any of the three |
| **P10** | **Cine** (provisional: `usb_cine` and `us_liver` are lossy-sourced, §3). Gain larger than every DBT system's at every rung, ≥ +40 % at the crossover rung. Recorded, never read as a verdict: their source was an inter-coded clip whose quantizer already removed the noise (frame-groups §4, point 9). | — (no verdict on lossy-sourced data) |

**What would refute the theory as a whole:** inter gaining under σ ÷ 2 (P1) would mean the noise is not what lossless
inter lost to; no gain at any rung (P1, P2) would mean DBT slices share too little structure for a lossy group either,
and the standard profile should stay at G = 1.

**Decode, for the decode protocol (§6):** **D1** — a lossy frame through WebCodecs decodes in ≤ 1.0× an HTJ2K exact
frame's time on DBT at 1× and 4× (row PREVIEW measured WebCodecs faster than OpenJPH's exact decode on every cell,
fluoroscopy and ultrasound); **D2** — an ask at G = 16 costs (G + 1)/2 = 8.5 lossy decodes on average, so 5–9× a
G = 1 ask (*derived*; a predicted frame may decode faster than a keyframe); **D3** — residual decode + add is 0.9–1.1× an HTJ2K whole frame (RESIDAPART's own prediction, re-tested here
on DBT at the bytes run's rungs). Any DBT cell outside a band refutes it there.

## 3 · Fixture profiles

**What the repo knows now.** *b* is the stored depth the lab measures (`docs/FIXTURES.md` §AV1 data); ρ is row 100's
top stream at the best offset, system or series median; the noise σ is not yet measured on any series (the bytes run
measures it, §5). *Class* is the provenance class: only `sound` enters a verdict.

| profile | fixtures | modality | b | matrix | frames | ρ | class | predicted to gain from |
| --- | --- | --- | --: | --- | --: | --- | --- | --- |
| **DBT-10** | `dbts_b1`…`b5`, `dbt10_ea1141`, `dbt10_d`; `dbts_b_max` (new) | DBT slices, system B and the two earlier 10-bit volumes | 10 | 1890×2457 to 3328×4096 (`dbt10_*` cropped: 678×1727, 757×2336) | 24–84 | 0.18–0.27 (B) | sound | **lossy + inter**, most of the DBT (P5); residual ties HTJ2K (P7) |
| **DBT-12** | `dbts_a1`…`a5`, `dbts_c1`…`c5`, `dbt12_ea1141`, `dbt12_c`; `dbts_a_max`, `dbts_c_max` (new) | DBT slices, systems A and C | 12 | 614×1359 to 1833×2971 | 29–87 | 0.11–0.13 (A, C) | sound | **lossy + inter**, after the depth choice (§4); residual ties HTJ2K |
| **US cine, B-mode** | `usb_cine` (luma), `usb_cine_rgb` | breast ultrasound cine | 8 | 512² | 64 | not measured | **lossy-sourced** | predicted most of all (speckle repeats, frame-groups §4 point 8) — **pending**: the owner's dataset arrives this week |
| **US cine, other** | `us_liver` | liver B-mode/CEUS cine, RGB | 8 | 760×421 | 70 | not measured | **lossy-sourced** | provisional only |
| **ABUS** | none; `ustrus_1`, `ustrus_2` (new) are prostate sweeps, the nearest swept volume | 3-D transrectal ultrasound | 8 | 452² | 280 | not measured | sound, other anatomy | ABUS **pending** (the owner's dataset); TRUS a stand-in, never an ABUS verdict |
| **off-target stacks** | `rf_fluoro`, `mr_ispy1`, `mr9_ispy2` | fluoroscopy (2 frames/s), breast MR | 12, 11, 9 | 768², 512², 320² | 18, 58, 34 | not measured | sound | controls; no profile decision |
| **neither** | FFDM, synthesized 2D, ultrasound stills | single images | 10–12, 8 | — | 1 a view | — | sound | **neither**: one frame an image, nothing to predict from; lossy alone, outside this study |
| **out of scope** | projections (`dbtproj_*`), raw FFDM, CT, cone-beam, PET | over 12 bits | 13–16 | — | — | — | sound | not cine-like at ≤ 12 bits; their depth is row DEPTH's |

The residual helps every profile alike in bytes (it ties HTJ2K, row 17) and nowhere by itself: it buys the exact frame
for the lossy stream's bytes, not fewer bytes. The profile that gains from neither is the single image.

**Which share of the breast-family studies falls in each.** From the repo, only the shape of an exam, not a mix:

* A screening DBT exam is four views, each one DBT volume plus single images ([`docs/av1/series.md`](../../../docs/av1/series.md)
  §1c, from the vendors' conformance statements): **every cine-like series of a screening DBT exam is DBT-10 or
  DBT-12**, by the system that made it (system B's 10 bits; A and C's 12).
* Which system, by series, in one public collection: in EA1141 (IDC, `idc-index-data` 25.0.5, read 2026-11-02),
  3 453 Breast Tomosynthesis series from system B's model and 272 + 198 from systems C and A's — **88 % DBT-10** by
  series among the three (*derived*: 3 453 ÷ 3 923). A further 339 series from three other software versions of
  system C's maker are ~14.7 MB each, too small for a slice volume (what they hold is *unverified*). A trial's
  archive, not the product's sites.
* Diagnostic exams add ultrasound stills and cine (series.md §1c); ABUS adds several volumes a breast. How many, and how
  often, nothing in the repo says.

**Missing, for the owner:** the product's expected study mix — screening against diagnostic, the systems and their
depths at the target sites, how many diagnostic studies carry cine and how many frames, and the ABUS share. Until then
the shares above are a collection's, and the US-cine and ABUS cells are **pending**.

## 4 · Depth: a 12-bit source as a ≤ 10-bit lossy stream

WebCodecs in Chromium refuses 12-bit AV1 (measured, row WCAP, [`docs/decode/README.md`](../../../docs/decode/README.md) §AV1),
though the specification lists 12-bit formats ([L5]: `enum VideoPixelFormat { // 4:2:0 Y, U, V "I420" , "I420P10" ,
"I420P12" , …`) and none of luma alone (the same enum, read 2026-11-02); dav1d-WASM decodes 12. A 12-bit DBT slice must reach WebCodecs as ≤ 10
bits. Three ways, each with what it does (*derived* unless measured):

| form | lossy stream | quality before AV1 | residual |
| --- | --- | --- | --- |
| **top 10 bits**, p = min((v + 2) ≫ 2, 1023), shown as p ≪ 2 (row 17's s = 2) | every value kept to a step of 4 | error in {−2, −1, 0, +1} (+2, +3 at 4094–4095, clamped): RMSE 1.22, max 2 below the clamp, a PSNR ceiling of 70.5 dB at 12-bit peak (*derived*: mean square 1.5); in a window W wide that is a code every W ÷ 255 units, so ≤ 1 code where W ≥ 510 | carries the two low bits' noise (row 100's low stream sits at the noise floor on all 15 volumes): the residual costs at least what the split's low stream costs |
| **windowed map**, the series' first header window [c − w/2, c + w/2] to 0 … 1023, clipped outside, an integer table shipped per series | finer than the top 10 bits inside the window when w < 4 096 (w ÷ 1 024 units a step), and exact there before AV1 when w ≤ 1 024 — the new 12-bit volumes' header windows are 651–850 wide | in the window: < ¼ of a display code for that window (1 024 levels for 256 codes); outside: clipped, max \|Δ\| up to the clipped extent; another window shows clipped tails as flat | the clipped tails enter the residual whole, widening its range by up to the tails' extent: more bits a sample there; inverse table identical in encoder and client, integer only (row 17's rule) |
| **12 bits** (`--profile=2`), dav1d-WASM only | no depth loss | none | as the source's noise after the AV1 error |

A fourth form — a noise-equalising curve (a square root, for Poisson-like noise) — needs the same shipped integer
table as the windowed map and was not added: the window is what the reader looks at, and the curve has no source here.
P9 is the prediction; §5 codes the first and third forms on every 12-bit series and the second on the same series
wherever their header carries a window.

## 5 · Profiles bytes protocol, pre-registered

*Row PROFILEBYTES, proposed. Offline: bytes, quality and encode time; no browser. Written 2026-11-02 before any data;
the session that runs it changes nothing below, reports every cell including those that miss, and writes its results
under the heading **`## Profiles bytes, measured`** in this file.*

**Tools.** `lab/av1/tools/tools.sh` (libaom 3.15.1, dav1d 1.5.4, OpenJPH 0.31.0, `ojph_compress`), `ingest/coded-frames/ingest.py`
for the shipped lossless codings, the venv of `lab/av1/requirements.txt` plus scikit-image 0.25.2 for SSIM, added with
`--require-hashes`. Native dav1d decodes every stream; nothing reaches a browser.

**Content, in this order** (each set's frames as `lab/av1/fetch_data.sh` writes them; every frame of every series —
whole volumes, not the middle 16):

1. the 15 DBT volumes `dbts_a1`…`dbts_c5` ([`../bytes/frame-groups/README.md`](../bytes/frame-groups/README.md));
2. the cine-like sets of §3 at ≤ 12 bits: `dbt10_ea1141`, `dbt12_ea1141`, `dbt12_c`, `dbt10_d`, `rf_fluoro`,
   `mr_ispy1`, `mr9_ispy2` (sound); `usb_cine`, `usb_cine_rgb`, `us_liver` (**lossy-sourced: reported, provisional,
   in a table of their own, and in no verdict**);
3. the new larger sets of §Larger cine fixtures: `dbts_a_max`, `dbts_b_max`, `dbts_c_max`, `ustrus_1`, `ustrus_2`;
4. **pending**: the owner's breast ultrasound cine and ABUS dataset, once it is in `data.json` with its class.

**Codings.** For each series:

* **HTJ2K lossless**, `ingest.py`'s served profile (reversible 5/3, 5 levels, 64×64 blocks, RPCL, one layer, one tile).
* **Lossless AV1, G = 1, split as shipped**: `ingest.py` `encoder_args`, optimized representation, the preset by
  content of `docs/FIXTURES.md` §From DICOM (`good:6` for tomosynthesis and MR, `allintra:7` for fluoroscopy, `cpu0`
  for RGB and the 8-bit ultrasound), every frame decoded back and checked as the ingest checks it.
* **Lossy AV1**, libaom 3.15.1's `aomenc`, one thread, **these knobs and no others**:

  ```
  aomenc --ivf --good --cpu-used=6 --threads=1 --passes=1 --tune=psnr \
         --end-usage=q --cq-level=Q --min-q=Q --max-q=Q --deltaq-mode=0 --aq-mode=0 \
         --denoise-noise-level=0 --lag-in-frames=0 --auto-alt-ref=0 \
         --kf-min-dist=G --kf-max-dist=G   (G = 1: --kf-max-dist=0)
  grey ≤ 10 bits: --monochrome --profile=0 --bit-depth=B --input-bit-depth=B
  grey 12 bits:   --monochrome --profile=2 --bit-depth=12 --input-bit-depth=12   (the 12-bit form, §4)
  RGB:            row 17's 4:2:0 BT.601 full range, 8 bits, and its integer back-conversion
  ```

  What each knob says, verbatim from libaom 3.15.1's `av1/arg_defs.c` [L3]: `--end-usage` "Rate control mode";
  `--cq-level` "Constant/Constrained Quality level"; `--min-q` "Minimum (best) quantizer"; `--max-q` "Maximum (worst)
  quantizer"; `--deltaq-mode` "Delta qindex mode (0: off, 1: deltaq objective (default), …"; `--aq-mode` "Adaptive
  quantization mode (0: off (default), …"; `--lag-in-frames` "Max number of frames to lag"; `--auto-alt-ref` "Enable
  automatic alt reference frames"; `--denoise-noise-level` "Amount of noise (from 0 = don't denoise, to 50)";
  `--kf-min-dist`/`--kf-max-dist` "Minimum/Maximum keyframe interval (frames)"; `--monochrome` "Monochrome video (no
  chroma planes)". `--min-q = --max-q = Q` is meant to hold every frame's quantizer at Q, so that intra and inter are
  compared at one step; that libaom then holds it is *unverified*, and the run checks it with `--q-hist=64` ("Show
  quantizer histogram (n-buckets)", [L3]) on every encode, reporting any frame off Q. Lag 0 and alt-ref off make every
  temporal unit one shown frame, decoded in display order — the product's group model (frame-groups §5c), so an ask at
  frame k of a group costs frames 0 … k. G = 1 uses the same `--good` mode, so G alone differs between arms.
* **G ∈ {1, 8, 16, whole series}**. **Secondary arm**, bytes only, `dbts_a1`, `dbts_b1`, `dbts_c1` at G = 16:
  `--lag-in-frames=19 --auto-alt-ref=1`, hidden alt-ref frames on — reported apart, because an ask then also decodes a
  frame from later in the group.
* **Depth forms** (§4) on every 12-bit series: the 10-bit top (`--profile=0 --bit-depth=10`, p = min((v + 2) ≫ 2, 1023)), the
  12-bit stream, and the windowed map where the series' header carries a window, all at every rung and G.
* **The quantizer ladder**, Q → qindex: **1 → 4, 2 → 8, 4 → 16, 8 → 32, 12 → 48, 16 → 64, 24 → 96, 32 → 128,
  40 → 160, 56 → 224** ([L2]), from near-lossless to clearly lossy (row 17's CRF 8, 20, 32, 44 lie inside it).
* **Each stream decoded** by native dav1d 1.5.4. The sequence header's `film_grain_params_present` read from every
  stream and required 0 ([L1] §7.2: "When film_grain_params_present is equal to 0, decoders shall produce output frames
  that are identical in all respects…"); on one rung a series, libaom's `aomdec` decodes the same stream and must
  match dav1d sample for sample.
* **The residual**: source − the lossy frame brought back to the source's depth (p, p ≪ 2, or the map's inverse table),
  plus one offset per series; coded HTJ2K lossless as above. Every frame's decoded residual added back must hash to
  the fetch's checksum.

**Fitting a session.** Whole volumes, one rung, all four G and both forms of the 12-bit series: about 3.2 Gpx of DBT
a G (994 slices), ~24 Gpx a rung over the four G with the 12-bit series' two extra forms (*derived*). How fast libaom 3.15.1 codes 10-bit grey at cpu6,
one thread, is not measured here (*unverified*). So: a **pilot**, discarded, codes `dbts_a1` at Q 8 and Q 32, G = 1 and
16, four encodes in parallel, and gives T, the core-seconds a megapixel. The rungs then run in this order, as many as
fit **5 hours of wall clock on 4 cores** at that T: **8, 32, 2, 16, 56, 4, 24, 1, 12, 40** (each prefix spans the
ladder). At least the first five; if five do not fit, the depth forms drop to `dbts_a1` and `dbts_c1` first, then the
content to every volume's middle 32 slices (G = whole then is 32, and is said so). The ladder that ran is stated
with its T. The lossy-sourced and new sets run after the DBT, at the same rungs, if time is left; whatever is not run
is listed as not run.

**Measured per (series, form, Q, G):**

* **Bytes** — the lossy stream's temporal units (IVF headers stripped), the residual's HTJ2K codestreams, HTJ2K
  lossless and lossless AV1 (shipped), each per series; ratios over HTJ2K lossless and over lossless AV1; gain over G = 1; lossy + residual.
* **Quality**, against the source samples at the coded depth b (peak 2^b − 1; the lossy stream brought back to b):
  PSNR over the series (from the summed squared error) and the frame minimum; max \|Δ\| over the series; **SSIM**,
  scikit-image's `structural_similarity` set as its documentation says matches Wang et al. ([L6]: "To match the
  implementation of Wang et al. [1], set gaussian_weights to True, sigma to 1.5, use_sample_covariance to False, and
  specify the data_range argument"), `data_range` = 2^b − 1, mean over frames and the minimum frame. PSNR and SSIM are
  reported also over the **in-window samples** (those whose code under the series' first window is strictly between 0
  and 255), since air around the breast inflates both.
* **Display error** — for every window pair the series' header carries (first frame; every alternative, such as
  `NORMAL`, `HARDER`, `SOFTER` — DICOM: "Multiple values indicate that multiple alternative views may be presented",
  [L4] C.11.2.1.2), source and lossy frame through the window to 8-bit codes as the product paints them
  (`client/paint/voi.js`; LINEAR as [L4] C.11.2.1.2.1 gives it: "if (x <= c - 0.5 - (w-1) /2), then y = y min else
  if (x > c - 0.5 + (w-1) /2), then y = y max else y = ((x - (c - 0.5)) / (w-1) + 0.5) * (y max - y min ) + y min",
  SIGMOID where the VOI LUT Function says so, MONOCHROME1 inverted): the share of in-window samples whose code differs,
  the share differing by > 1, and max \|Δcode\|. A series with no window (the ultrasound) is shown as stored, codes =
  samples. The presets are each series' own header's, the modality's; none are invented.
* **Noise σ and ρ** — σ per series: the median absolute value of each frame's finest diagonal Haar detail
  ((a − b − c + d) ÷ 2 over 2×2 blocks, which keeps white noise's variance) over in-window blocks, ÷ 0.6745 (the MAD
  estimator of Donoho and Johnstone [L7]); its fitness here is *unverified*, and is checked (below). ρ by
  `../bytes/frame-groups/rho.py` unchanged, on every series that row 100 did not measure.
* **Encode time** — per encode, wall-clock and CPU seconds (the child's `getrusage`), per frame and per megapixel,
  four encodes in parallel on 4 cores; at most 4 in flight, so no core is shared (`docs/rig-limits.md`).

**Derived per series:** the **crossover rung** (§2); **bytes at equal PSNR** — for G > 1 against G = 1, log bytes
interpolated linearly in PSNR between adjacent rungs, at each G = 1 rung inside both curves' range (*derived*: the
Bjøntegaard idea, one point at a time, no curve fit); the **bend** — the rung where the slope of log bytes against PSNR
changes most between its two sides.

**Checked, and mutated before the campaign** (each reported):

* every lossless coding and every lossy stream + residual exact against the fetch checksum: a sample flipped in one
  decoded residual must fail its frame; the residual offset off by one must fail every frame;
* dav1d against `aomdec` on one rung a series, sample for sample: one sample flipped in dav1d's output must fail;
* σ: synthetic frames, a smooth ramp plus white Gaussian noise of σ ∈ {1, 4, 16}, must give σ within 10 %; the same
  frames with the noise removed must give under 0.5;
* the display codes: `voi.js`'s own tests' cases reproduced by the run's Python port (`lab/av1/display_tags.py` holds
  one) to the code;
* `--q-hist`: one encode with `--max-q=Q+8` must show frames off Q, or the check is reported as unable to see it.

**Reported:** one table per profile of §3 — rows (series, form), columns Q, cells at each G: lossy ÷ HTJ2K, gain,
residual ÷ HTJ2K, lossy + residual ÷ HTJ2K, PSNR · in-window PSNR, SSIM, max \|Δ\|, display share differing; then
σ, ρ, the crossover rung, the bend, the encode times; then P1–P10 each **held**, **did not hold** or **refuted**, with
the deciding numbers. No rung is called visually lossless: that threshold is the owner's, or a reader study's.
Nothing past this host (4 cores, 15 GB) is claimed.

## 6 · Profiles decode protocol, pre-registered

*Row PROFILEDECODE, proposed, after PROFILEBYTES has been reported (its rungs choose the content). Written
2026-11-02 before any data; the session changes nothing below and reports every cell.*

**A lab harness, not the product worker.** One page, one worker per arm, with **the same decoder settings in every
arm**, so that no product tuning — the product's per-group flush, `av1.js`'s low-unit `{ key: true }` that broke split
groups on dav1d-WASM (row 100) — favours one:

* **WebCodecs**: `VideoDecoder.configure({ codec, hardwareAcceleration: "prefer-software", optimizeForLatency: true })`,
  the codec string from each stream's sequence header; `flush()` only at the end of a timed operation, in every arm.
  WebCodecs says of the hint: "prefer-software Indicates that the User Agent SHOULD prefer a software codec
  implementation. User Agents may ignore this value for any reason." [L5]; the run records the decoder's
  implementation from Chromium's media log where it reports one, and says so where it does not.
* **dav1d-WASM**: the client's `built("dav1d")` SIMD build, one thread, `max_frame_delay` 1, one instance per stream
  (the top and the low of a split each on its own), never flushed mid-group.
* **OpenJPH-WASM**: the client's `built("openjph")`, one thread, for HTJ2K frames and residuals.
* The add, the split's merge and the depth back-conversion: one shared module, integer arithmetic, the same in every arm.

**Arms**, each on dav1d-WASM and on WebCodecs where it is AV1 (WebCodecs only at ≤ 10 bits):

| arm | what is decoded | on the clock |
| --- | --- | --- |
| **H** HTJ2K exact only | HTJ2K whole frames | each frame |
| **L** lossless AV1 only | G = 1, split as shipped (top + low units, merged) | each frame |
| **S1, S8, S16, SW** lossy AV1 only | the lossy stream at G = 1, 8, 16, whole | each lossy frame |
| **R** lossy + residual | the residual's HTJ2K decode and the add | residual + add; the lossy frame decoded before the clock starts |
| **W** lossy + whole HTJ2K on request | the asked frame's HTJ2K codestream, with the AV1 decoder alive beside it | the HTJ2K frame; the lossy frame decoded before |

**Clocks** (latency in ms; no throughput is quoted — `CLAUDE.md` §Measurement):

* **per frame scrolled** — frames in display order, one in flight; from a frame's unit handed in to its samples written;
  per arm, the median over the run's frames;
* **per random-access ask, at G > 1** — an ask at each position k of a group, every position once a round in a Williams
  order (`lab/order.mjs`), each from a fresh decoder: from the group's keyframe handed in to frame k written, so it costs
  frames 0 … k; for G = 1 arms the same ask is one frame;
* **per whole series** — first unit handed in to the last frame written, one decoder, frames in order.

**Content.** `dbts_a1`, `dbts_b1`, `dbts_c1` (one volume a system), at three rungs per series from the bytes run: the
crossover rung, the rung below and the rung above; the 12-bit volumes as their 10-bit top through WebCodecs and as
12 bits through dav1d-WASM. Per frame and per ask on the middle 16 slices; per series on the whole volume. Then the
pending breast cine and ABUS, once classed `sound`, at the same three rungs of their own. `usb_cine` only as a
provisional cell, reported apart.

**Links.** (i) **No limit**: every byte in memory before the clock starts, so decode is the clock; (ii) two rates,
**5 and 50 Mbit/s**, as a pacer inside the harness that releases each unit or codestream at bytes ÷ rate after the
previous one — a model of the link, not a network; nothing about transport, loss or the server is measured.

**Throttle and rounds.** 1× and 4× through `lab/scripts/cpu_throttle.mjs` (`throttleTree`); each (throttle, round) a fresh
headless Chromium (playwright 1.56.1, Chromium 141); inside a round every (arm, decoder, series, rung, link) in a
Williams order, the paired leads by predecessor printed with their `UNBALANCED` flag (`docs/rig-limits.md` §6), a cell
whose order effect exceeds 10 % not read. n by power, as RESIDAPART sizes it: a 5-round pilot per throttle on
`dbts_a1`, discarded, gives σ of ln(arm ÷ H) over paired rounds; n = max(10, ⌈((1.96 + 0.84) · σ ÷ ln 1.05)²⌉),
rounded up to a whole Williams period. **Fitting a session**: the pilot's round time sets a cap of **5 hours** at both
throttles; if n would not fit, the whole-series clock drops first to dav1d-WASM's L at 4× on `dbts_b1` alone (its
lossless frame is 2.1 s there, row 100), then the 50 Mbit/s link; whatever is dropped is said, and a cell whose n fell
under 10 is marked and not read.

**Saturation.** One decode in flight on a 4-core host. WebCodecs runs its own decoder threads, so its 4× cells are not
a one-core figure; dav1d-WASM and OpenJPH are one thread each. Nothing is claimed for concurrent asks, a phone or a
host other than this one; at 4× the 50 Mbit/s cells are where decode, not the link, is the clock, and are read only as such.

**Checked, every round:** every exact frame (H, L, R after its add, W) hashed against the fetch checksum; every lossy
frame against native dav1d 1.5.4's decode of the same stream, through both decoders (bit-identical lossy output, as
row 17 found on 13 440 frames); every residual against what the bytes run wrote. A miss voids its (series, rung,
throttle) cell, reported, not re-run quietly. **Mutations**, once before the campaign: `--mutate hash` turns every
check to 0; the residual offset off by one turns R to 0 with the lossy checks intact; a group's second unit dropped
turns S8's ask at k ≥ 1 to a decode error or a failed check.

**Reported:** per (series, rung, throttle, link) the median over rounds of each clock, its range and n, and the
paired ratio over H with the rounds it was slower; D1–D3 (§2) each held or refuted, with the deciding cells.

## 7 · Profiles decode protocol, amended

*Row PROFILEDECODE, amended 2026-11-04 by the protocol session, after §Profiles decode, measured (2026-11-04) ran §6 and
could not decide in its 5 h. §6 stays as written, the record of what was pre-registered and run; this section replaces
its campaign. Six separate sessions, given only this section, run it (§Shards); a seventh pools them.*

* **Asked:** make §6's decode decision fit exactly six cloud sessions run in parallel, each ≤ 4.5 h wall on a 4-core
  host, keeping D1–D3's questions and adding how frames are reached (in order, or a jump) and the 12-bit forms' decode.
* **Answer:** **it fits.** A round takes 10.6 min here (§6's: 8.85 h), so each 4.5 h session runs 14–22 rounds
  (floor 10); six pooled blocks should pin D1 to ±4–8 %, D2 to ±6–17 %, D3 to ±3–6 % (95 %), inside bands of ±10–29 %.
* **The numbers that decide it:** round 10.6 min, setup 16 min, 22 rounds fit here; σ of ln ratio ≤ 0.19 on every D1 and D3 cell,
  up to 0.37 on WebCodecs' D2 at 4× (§Sizing pilot).
* **What it rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` (§6's, one a scanner), their streams byte for byte the bytes
  run's; a 6-round pilot and a 4-round check of the jump against §6's ask, on one 4-core host, Chromium 141.
* **What is left:** §6's 5 % on WebCodecs jumps at 4×; 4× off the crossover rung; L, W, G = whole series, the series clock and
  timed links; the top 10 bits through dav1d-WASM; cine and ABUS; other hosts. The six blocks: §Shards.

**Terms.** **G** — frames coded together: a keyframe every G frames, the rest predicted from the frame before; G = 1
codes each frame alone. **Q** — the lossy quantizer, libaom's 0–63 scale (§Names): 2 is near-lossless, 56 heavy.
**Systems A, B, C** — the three DBT scanners of the EA1141 dataset (§3); A and C store 12 bits, B 10. **Residual** —
exact − lossy, per sample, coded losslessly in HTJ2K; lossy + residual is the exact frame. **Forms** (§4): a 12-bit
volume goes to dav1d-WASM as its **12-bit** stream and to WebCodecs as its **top 10 bits** (Chromium's WebCodecs refuses
12-bit AV1, row WCAP), shifted back by 2 on the clock; system B's volume is one **10-bit** stream to both. **Arms:** **H**
— an HTJ2K exact frame through OpenJPH-WASM; **R** — a residual's HTJ2K decode plus the add onto a lossy frame already
decoded; **S_G** — the lossy stream at G, through dav1d-WASM or WebCodecs. **In order** — the next slice, the decoder
holding the one before: cine playback, scrolling one slice. **Jump** — a slice reached from elsewhere: a fresh decoder,
its group's keyframe, then each frame up to it. A **unit** is one arm with its form, decoder, G and pattern, timed over
the middle 16 slices. A **round** runs every unit once at each throttle; a **block** is one session's rounds, on one
host. **A/A** is H timed twice in a round as two units, H and H′, whose ratio should be 1. A **Williams order**
(`lab/order.mjs`, `docs/rig-limits.md` §6) puts every unit at every position, and after every other unit, equally often
over its period. **4×** is `lab/scripts/cpu_throttle.mjs`'s cap of every browser thread to a quarter of a CPU.

### What changed from §6, and why

| §6 | amended | why, and the source |
| --- | --- | --- |
| links of 5 and 50 Mbit/s, timed through a pacer | **not timed**: each unit's figure on a link is *derived* by replaying §6's own pacer over the unit's measured decode times and its bytes (`decode_pool.py --links`) | a paced link is waiting, bytes ÷ rate: no measurement in it; §6's run put the 5 Mbit/s link alone at about 28 min a throttle-round |
| **L**, lossless AV1 split as shipped | **dropped** | measured elsewhere: row SPEED, `docs/decode/README.md` §Decode time against HTJ2K, lossless AV1 through dav1d-WASM 5.4–8.1× OpenJPH in Chromium at 1× and 4×, "the smallest of 224 paired ratios is 3.6×"; §6's pilot 9.2× (dav1d-WASM) and 7.7× (WebCodecs) on `dbts_a1`, n = 5, not read. It enters none of D1–D3 |
| **W**, a whole HTJ2K frame on request beside a live AV1 decoder | **folded into H** | every decoder of the (series, rung) stays open in the same worker beside OpenJPH in every unit, so every H is timed beside live AV1 decoders |
| **SW**, G = the whole series | **dropped** | not asked; G 1, 8 and 16 are |
| the whole-series clock | **dropped** | in none of D1–D3; in order per frame answers cine playback |
| an ask: 16 fresh chains, keyframe … k, 136 decodes at G = 16 | a **jump**: one fresh chain a group the middle 16 touch, the jump to k read off it as written(k) − handed(its keyframe); 20 decodes at G = 16 | with one unit in flight and no flush until a chain ends, decoding keyframe … k is the first steps of decoding keyframe … the group's last asked slice, so the clock to k is the same; checked against §6's own ask: 0.96–1.03 (`--direct`, below) |
| one worker a cell; 351 cells in one Williams order over a round of 8.85 h | **one worker a (series, rung)** holding every decoder and byte; its 15–16 units back to back in a Williams row; the 9 (series, rung) in a Williams row | §6's pilot: σ of ln(arm ÷ H) to 0.31 and order effects to 52 %, with each arm minutes from its H |
| every rung at 1× and at 4× | **every rung at 1×; at 4× the crossover rung alone** (`--every-rung-at 1`) | 4× was 18.3 of the pilot's 22.8 min a round (below); a host as slow as §6's (its H 26 ms a frame at 1× against 17 here) must still fit 10 rounds. D1–D3 keep a 4× cell on every series |
| n by power on a normal, in one session, cap 5 h | **as many rounds as fit** each block's 4.5 h, at least 10 (§6's floor); each block's median, then a *t* over **6 blocks**; the resolution this buys, per cell, from the pilot (below) | the six-session budget; §6's own n (5 % at 80 % power) does not fit it on the WebCodecs jumps (below) |
| a cell read when n ≥ 10 and its order effect ≤ 10 %; its median against the band | the pooled ratio's **95 % interval** against the band; each block's median over rounds; an order effect read against its own shuffles | below |

### Units, decoders and clocks

**Decoders and settings: §6's, unchanged** — WebCodecs `{ codec, hardwareAcceleration: "prefer-software",
optimizeForLatency: true }`, one unit in flight, `flush()` only at the end of a timed operation; dav1d-WASM, the
client's `built("dav1d")`, one thread, `max_frame_delay` 1; OpenJPH-WASM, the client's `built("openjph")`, one thread;
the add and the back-conversion from `shared.js`. Code: `decoders.js` (the three, moved out of `decode.js` unchanged),
`decode_block.js` (one (series, rung) in a worker), `decode_block.mjs` (the driver), `decode_pool.py` (checks, A/A,
pooling, the rule, the sizing, the derived links).

**Units, per (series, rung)** — H, H′; R per form; S_G for G = 1, 8, 16 × {dav1d-WASM, WebCodecs} × {in order, jump}:
16 units on `dbts_a1` and `dbts_c1` (R on the 12-bit and on the top-10 form), 15 on `dbts_b1`.

**Clocks** — latency, ms, one decode in flight; no throughput is quoted (`CLAUDE.md` §Measurement):

* **H, R** — per slice, codestream handed in to samples written; R's clock is the residual's decode and the add, its
  lossy frame (the G = 16 stream's, the profile's G as in §6) decoded once per worker off the clock and checked. The
  unit's figure is the median over the middle 16.
* **In order** — a fresh decoder primed off the clock from the first middle slice's keyframe, then the 16 middle
  slices, each from its unit handed in to its samples written, back-conversion included; the median over the 16.
* **Jump** — for each group the middle 16 touch, a fresh decoder opened off the clock (dav1d closed and opened; a new
  `VideoDecoder` configured), then that group's units in order from its keyframe to the last middle slice in it; the
  jump to slice k is written(k) − handed(k − k mod G). The figure is the mean over the middle 16, §6's ask. At G = 1 a
  jump is one keyframe from a fresh decoder.
* **On a link** (*derived*, never timed) — §6's pacer replayed: unit j released bytes ÷ rate after unit j − 1 and
  handed in at the later of that and the frame before written, each decode the time measured. In order, the median
  interval between frames written; a jump, from its first byte to slice k written. Reported at 5 and 50 Mbit/s beside
  the read cells, not decided on.

**Content: §6's, as its run reproduced it** — `dbts_a1` and `dbts_c1` Q 8, 16, 32 (system A and C, 12 bits),
`dbts_b1` Q 16, 32, 56 (system B, 10 bits): the crossover rung of the bytes run, the rung below and the rung above. The
middle 16 slices (`dbts_a1` 20–35, `dbts_b1` 17–32, `dbts_c1` 26–41). At 4× only the crossover rung runs (Q 16, 32,
16). `streams.py … --groups 1,8,16 --no-lossless-av1` codes only what these units read, and refuses a stream whose unit
sizes differ from the bytes run's.

**Order.** A round is each throttle, 1× and 4× (which first alternates by round), in a fresh headless Chromium;
inside it the (series, rung) it runs — 9 at 1×, 3 at 4× — in that round's Williams row; inside each, one worker, its
units in that round's Williams row. A block runs rows 0, 1, 2, … of both squares, the same in every block, so each block is balanced on its
own. Rows are written after every round; a stopped session resumes at the first round it lacks.

**Checked, every unit** (unchanged from §6): every exact frame (H, H′, R after its add) against the fetch checksum;
every lossy frame decoded on a clock, and R's lossy frames, against native dav1d 1.5.4's decode of the same stream;
every residual against what `streams.py` wrote. A miss or an error voids that (block, series, rung, throttle).

### Questions, ratios and the rule

Every ratio is formed **inside a block**, paired by round within (series, rung, throttle): ln(numerator ÷
denominator). Milliseconds never leave their block.

| question | ratio, each (series, rung, throttle) | band, and its source |
| --- | --- | --- |
| **D1** — a lossy frame through WebCodecs against an HTJ2K exact frame | S_G WebCodecs in order ÷ H, G = 1, 8, 16 | ≤ 1.0 (§2, from row PREVIEW) |
| **D2** — a jump at G = 16 against one at G = 1 | S16 jump ÷ S1 jump, each decoder | 5–9 (§2, *derived*: (G + 1) ÷ 2 = 8.5 lossy decodes, a predicted frame possibly cheaper) |
| **D3** — residual decode + add against an HTJ2K whole frame | R ÷ H, each form | 0.9–1.1 (§2, RESIDAPART's prediction) |
| how G costs a jump | S8 jump ÷ S1 jump, each decoder | none: an estimate and its interval |
| how G costs in order | S8 and S16 in order ÷ S1 in order, each decoder | none |
| the 12-bit forms | S_G dav1d-WASM (12-bit stream) ÷ S_G WebCodecs (top 10 bits), G = 1, 8, 16, in order and jump, on `dbts_a1`, `dbts_c1`; on `dbts_b1` the same ratio is the two decoders on one 10-bit stream | none: "faster" said only where the interval excludes 1 |
| every unit against H | S_G ÷ H, each decoder and pattern | none |
| A/A | H′ ÷ H | — |

**A block's statistic is a median over its rounds.** The pilot (below) caught the host slowing one unit 2.4× for ten
consecutive frames while the same unit's first six, and its A/A twin beside it, ran at speed; a mean over rounds
carries such an event into the block's figure, a median does not (it breaks down only past half the rounds).

**A block's A/A.** Per (block, throttle), the median of ln(H′ ÷ H) over every (series, rung) and round, with its
distribution-free 95 % interval (order statistics k and n + 1 − k, k from the binomial(n, ½) tails). H′ and H are the
same unit, so a block whose interval lies wholly beyond ±ln 1.05 — identical units apart by more than the 5 % §6 sized
its n to see — measures position, not decoders, at that throttle: every one of its cells there is **void**. Noise alone
voids nothing; it widens the block's intervals, and through them the pooled one. (The pilot's 4× A/A, σ ≈ 0.085 a pair,
would have voided 27–67 % of blocks under a rule that asked its interval to sit *inside* ±5 %: a bootstrap of its 30
pairs.) A block under 10 rounds (§6's floor) is void when others are pooled. A void block, or cell, is reported with why
and enters no pooled figure; nobody re-runs it quietly.

**Pooling.** For each ratio and (series, rung, throttle), each kept block contributes **one number**: its median of ln
ratio over its rounds. The pooled ratio is exp of the mean of those numbers, with a 95 % *t* interval on B − 1 degrees
of freedom over the B kept blocks — so a difference between hosts widens the interval instead of hiding in it. One kept
block gives no between-host spread: **not decided**.

**Order effect.** On the pooled pairs, the largest |median by the numerator's predecessor ÷ median − 1|, and the share
of 400 shuffles of the same pairs' predecessors that reach it. A cell is not read when the effect exceeds 10 %
(`docs/rig-limits.md` §6) **and** under 5 % of its shuffles reach it: at a few pairs a predecessor the statistic alone
runs past 10 % on noise (§6's pilot: 52 % at n = 5; this pilot: 5–52 % at n = 6, its A/A's 18–37 % on `dbts_a1`), and the shuffles
measure that noise on the cell's own data. The Williams square balances first-order carry-over in every block either way.

**The rule** (the bands are §2's, unchanged): in a read cell, **held** where the 95 % interval lies inside the band,
**refuted** where it lies wholly outside, **not decided** otherwise. D1, D2, D3 each **held** if every read cell holds,
**refuted** if any read cell refutes, else not decided, with the cells that left it open. The new questions carry no
band and get none: each is reported as its pooled ratio and interval. `decode_pool.py` computes all of it; its
`--test` builds blocks with known answers.

**Saturation.** One decode in flight on 4 cores. dav1d-WASM and OpenJPH run one thread each, so at 1× they use one
core and the host does not saturate; at 4× each thread gets a quarter of a CPU. WebCodecs runs its own decoder threads
(its decoder: `Dav1dVideoDecoder`, not a platform decoder, from Chromium's media log in §6's run), so its cells are not
a one-core figure at either throttle. Nothing is claimed past 4×, for concurrent decodes, for a phone, for another host
type, or for a timed link.

### Checks and mutations, as run (2026-11-04)

Every new check broken on purpose, once, on `dbts_a1` Q 16 at 1× (`lab/av1/profiles/rows/decode-amended-mutate-*`):

| what is checked | broken by | seen |
| --- | --- | --- |
| exact frames against the fetch checksum; lossy frames against native dav1d; residuals against `streams.py` | `--mutate hash`: every expected hash flipped | 0 of every check on all 16 units |
| R's add | `--mutate offset`: the residual's offset off by one | R exact 0/16 on both forms, its residuals 16/16 and lossy frames 16/16 intact; the other 14 units untouched |
| a jump's chain | `--mutate drop`: a group's second unit dropped at G = 8 | both S8 jumps fail — dav1d-WASM `-28`, WebCodecs `Decoding error.` — with 1 of 20 frames matched, the keyframe before the gap; S1 and S16 untouched |
| `decode_pool.py`: pooling, the A/A, the rule, order effects, the link replay, the *t* quantiles (`--test`, blocks with known answers) | nine mutations: the A/A rule off; checks ignored; a jump timed from its own slice's hand-in; the replay not waiting for the frame before; the blocks' pairs pooled as one sample; a block's mean for its median; a block under 10 rounds kept; the *t* series a term short; predecessors never shuffled | each fails the test (`decode-amended-mutate-pool.txt`) |

**The jump against §6's ask** (`--direct`, `dbts_a1` Q 16, 4 rounds a throttle, `decode-amended-direct.*`), jump ÷ ask,
median of the rounds [range]: dav1d-WASM 0.991 [0.946–1.073] at 1×, 0.966 [0.943–0.981] at 4×; WebCodecs 1.025
[0.954–1.078] at 1×, 0.961 [0.825–1.232] at 4×; the A/A beside them 1.008 [0.887–1.054] and 0.991 [0.950–1.051]. The
two read the same within the A/A's own spread, except dav1d-WASM at 4×, where the jump read 3.4 % under the ask in 4 of
4 rounds: D2 at 4× on dav1d-WASM may sit up to that much under §6's definition (its denominator, a jump at G = 1, is one
frame and the same either way). n = 4: a check, not a reading.

**In the pilot**, every check matched in every round: H exact 2 688/2 688, R exact, residual and lossy 2 240/2 240 each,
S lossy 17 360/17 360; no error.

### Sizing pilot (2026-11-04)

`decode_block.mjs --block pilot`, six rounds on this host with nothing else running (`decode-amended-pilot.*`; rounds
0–1 ran every rung at 4×, 2–5 as amended), then `decode_pool.py … --size --setup-hours 0.6 --every-rung-at 1`
(`decode-amended-size.txt`). Discarded: a pilot sizes, it is not read.

* **A round:** 10.6 min (median of six) — 4.4 min at 1×, 6.3 at 4×; 22.8 min with every rung at 4×. §6's round, on
  its host and after its own drops: 8.85 h.
* **Setup on a fresh host** (`decode_setup.sh`, timed in a fresh worktree here): 954 s, 16 min — decoders, encoders
  and data in parallel, then the 45 streams (13 min of it), all byte for byte the bytes run's; then the driver ran from
  that worktree with nothing else. Here emscripten's library cache and meson were already present; a cold host builds
  them too (*unverified* how long).
* **Rounds that fit** 4.5 h less 0.6 h (setup, the section, pushes): 22 here. §6's host timed H at 26 ms a frame where
  this one takes 17, so a host that much slower fits about 14 (*derived*, ×1.5 on the round). `--until` stops each block
  where its own host's time runs out.
* **σ** of ln ratio over the pilot's rounds, robust (1.4826 × the median absolute deviation), largest cell by
  question: D1 0.19, D2 0.37, D3 0.13, G in order 0.15, G on a jump 0.51, the 12-bit forms 0.30. The large ones are all
  WebCodecs jumps at 4×: a fresh `VideoDecoder` now and then takes up to ~1 s to give its first frame there (`dbts_c1`
  Q 16, round 0: two of 16 jumps at 615 and 1 058 ms, the other 14 at 80–124).
* **What §6's n would ask** (5 % at 80 % power, on a *t* over six blocks of medians, variance π/2 · σ² ÷ n), rounds a
  block, largest cell by question: D3 24, G in order 30, D1 48, the 12-bit forms 118, D2 184, G on a jump 351.
* **What the budget buys instead**, the widest expected 95 % half-interval of a pooled cell (*derived* from the σ, if
  the blocks agree; a spread between hosts widens it):

| question | at 10 rounds a block, 1× · 4× | at 22, 1× · 4× | its band |
| --- | --- | --- | --- |
| D1 | ±8 % · ±7 % | ±5 % · ±4 % | ≤ 1.0 |
| D2 | ±9 % · ±17 % | ±6 % · ±11 % | 5–9 |
| D3 | ±5 % · ±6 % | ±3 % · ±4 % | 0.9–1.1 |
| G in order | ±4 % · ±6 % | ±3 % · ±4 % | — |
| G on a jump | ±3 % · ±24 % | ±2 % · ±15 % | — |
| the 12-bit forms | ±6 % · ±13 % | ±4 % · ±9 % | — |

So the decision fits: every D2 and D3 cell gets a pooled interval narrower than its band, every D1 cell one of
±4–8 %, and a cell is decided wherever its estimate sits farther from a band edge than that; a cell whose estimate sits nearer stays **not decided**, and is
reported so. What it does not buy is §6's 5 % on WebCodecs jumps at 4× — listed as left.

## Shards

Six sessions run in parallel, each on its own fresh 4-core host, each **one block**: every arm, form, decoder, G,
pattern, series and rung, interleaved, with its own A/A — split by rounds, never by arm. Each starts from this branch,
runs the same commands with its own k, and writes **only its own files and its own section**:

| k | block | runs | writes | its section |
| --: | --- | --- | --- | --- |
| 1 | `shard-1` | rounds 0, 1, 2, … (both Williams squares from row 0) until `--until`: ≥ 10, about 22 on a host like the pilot's; 1× every rung, 4× the crossover rung, all three series | `lab/av1/profiles/rows/decode-shard-1.{json,log,txt}` | `### Decode shard 1, measured` |
| 2 | `shard-2` | the same | `lab/av1/profiles/rows/decode-shard-2.{json,log,txt}` | `### Decode shard 2, measured` |
| 3 | `shard-3` | the same | `lab/av1/profiles/rows/decode-shard-3.{json,log,txt}` | `### Decode shard 3, measured

*Run 2026-11-04, 18:31–22:31 UTC, by a separate session given only §7, which it ran as §Shards assigns k = 3; nothing
outside this section and `rows/decode-shard-3.*` was changed. **One block: not a verdict.***

* **Run:** block `shard-3`, rounds 0–21 (22 rounds), 1× every rung, 4× the crossover rung, all three series, every
  unit interleaved in §7's Williams rows; then §7's three block mutations and nine pool mutations.
* **Shows:** this block's A/A (H′ ÷ H, two timings of the same HTJ2K unit) is 1.002 at 1× and 1.000 at 4×, kept;
  every check matched; no cell void; its within-block ratios are below.
* **Rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` only, at §7's rungs, on one 4-core host, through Playwright
  1.56.1's headless Chromium shell (build 1194; its Chromium major not read here: *unverified*).
* **Left:** everything pooled — the between-host spread, the order effects on pooled pairs, D1–D3's verdicts — is
  the collector's (§Shards); nothing here is read against a band.

**Terms**, §7's: a **round** runs every unit once at each throttle; a **block** is this session's rounds on its one
host; **in order** is the next slice from a decoder holding the one before; a **jump** reaches a slice from a fresh
decoder via its group's keyframe; **4×** caps every browser thread to a quarter of a CPU.

**Host** (its `host` row): Intel Xeon @ 2.10 GHz, 4 cores, 16 GB. **Setup** (`decode_setup.sh` on this fresh host):
16.6 min. **A round:** 10.0 min, the median of 22 (9.5–10.4) — 4.3 at 1×, 5.7 at 4×; `--until` stopped the block
before round 22. **Where it saturates:** one decode in flight; OpenJPH-WASM and dav1d-WASM run one thread each, so
at 1× they use one of four cores and the host does not saturate; at 4× each thread gets a quarter of a CPU. WebCodecs
runs its own decoder threads, so its cells are a one-core figure at neither throttle. Nothing is claimed past 4×, for
concurrent decodes, or for another host.

**A/A**, median of ln(H′ ÷ H) over every (series, rung) and round, its distribution-free 95 % interval: 1× **1.002
[0.999–1.011]** over 198 pairs; 4× **1.000 [0.994–1.013]** over 66 pairs. Both lie inside ±5 %: kept at both throttles.

**Checks, every unit of every round** (4 136 rows, no error): H and H′ exact frames against the fetch checksum
5 376/5 376; R exact after its add 4 480/4 480, its residuals against `streams.py` 4 480/4 480, its lossy frames
against native dav1d 4 480/4 480; S lossy frames against native dav1d 34 720/34 720. **Void cells: none.** Every exact
frame was checked against its source.

**Mutations, as §7 names them**, rerun here on `dbts_a1` Q16 at 1×, one round each (rows kept outside the repo, as
§Shards gives this shard no other file): `--mutate hash` — 0 of every check on all 16 units; `--mutate offset` — R exact
0/16 on both forms, its residuals and lossy frames 16/16, the other 14 units untouched; `--mutate drop` — both S8 jumps
fail, dav1d-WASM `-28`, WebCodecs `Decoding error.`, 1 of 20 frames matched, S1 and S16 untouched. `decode_pool.py
--test` passes as committed and fails under each of §7's nine mutations (the A/A rule off; checks ignored; a jump
timed from its own slice's hand-in; the replay not waiting for the frame before; pairs pooled as one sample; a
block's mean for its median; a block under 10 rounds kept; the *t* series a term short; predecessors never shuffled).

**Cells** (`rows/decode-shard-3.txt`, which also holds every unit's ms and every S ÷ H): each ratio the block's median
over its 22 rounds, paired by round, with its distribution-free 95 % interval over those rounds; H's ms the median
over rounds. `decode_pool.py` marks every cell *not read: one block*, as §7 does for any single block; the order
effects it prints are this block's alone (no cell's is both over 10 % and beyond its shuffles, p < 0.05).

| series, Q, throttle | H ms | D1 S1 · S8 · S16 WebCodecs in order ÷ H | D2 S16 ÷ S1 jump: dav1d-WASM · WebCodecs | D3 R ÷ H, each form |
| --- | --: | --- | --- | --- |
| `dbts_a1` Q8 1× | 17 | 1.772 [1.726–1.826] · 2.034 [1.965–2.179] · 2.096 [2.033–2.157] | 10.029 [9.661–10.637] · 9.071 [8.741–9.758] | 12bit 1.406 [1.371–1.447] · top10 1.398 [1.360–1.454] |
| `dbts_a1` Q16 1× | 17 | 1.159 [1.102–1.237] · 1.239 [1.199–1.363] · 1.279 [1.202–1.361] | 12.519 [11.989–13.347] · 8.538 [8.184–9.046] | 12bit 1.439 [1.427–1.474] · top10 1.439 [1.408–1.466] |
| `dbts_a1` Q32 1× | 17 | 0.990 [0.953–1.069] · 1.063 [0.998–1.113] · 1.106 [1.036–1.193] | 7.103 [6.446–7.671] · 8.229 [7.821–8.681] | 12bit 1.478 [1.461–1.499] · top10 1.443 [1.407–1.492] |
| `dbts_b1` Q16 1× | 50 | 1.666 [1.604–1.691] · 1.852 [1.765–1.938] · 1.851 [1.807–1.990] | 11.170 [10.489–11.561] · 8.682 [8.451–9.110] | 10bit 1.584 [1.541–1.621] |
| `dbts_b1` Q32 1× | 49 | 1.383 [1.330–1.428] · 1.501 [1.431–1.553] · 1.492 [1.459–1.549] | 7.838 [7.419–8.101] · 8.483 [8.251–8.759] | 10bit 1.659 [1.617–1.709] |
| `dbts_b1` Q56 1× | 49 | 1.277 [1.223–1.304] · 1.377 [1.324–1.432] · 1.381 [1.338–1.421] | 3.774 [3.633–4.053] · 8.232 [7.716–8.531] | 10bit 1.652 [1.586–1.700] |
| `dbts_c1` Q8 1× | 17 | 2.018 [1.963–2.069] · 2.197 [2.134–2.300] · 2.179 [2.114–2.232] | 9.906 [9.730–10.281] · 8.891 [8.457–9.183] | 12bit 1.516 [1.487–1.588] · top10 1.540 [1.467–1.569] |
| `dbts_c1` Q16 1× | 17 | 1.380 [1.305–1.404] · 1.474 [1.427–1.519] · 1.404 [1.364–1.437] | 11.462 [10.960–12.410] · 8.516 [8.069–8.981] | 12bit 1.551 [1.523–1.617] · top10 1.512 [1.470–1.586] |
| `dbts_c1` Q32 1× | 17 | 1.151 [1.136–1.212] · 1.269 [1.242–1.304] · 1.177 [1.153–1.226] | 4.549 [4.323–4.866] · 8.163 [8.008–8.373] | 12bit 1.536 [1.503–1.593] · top10 1.539 [1.490–1.578] |
| `dbts_a1` Q16 4× | 76 | 0.765 [0.728–0.796] · 0.777 [0.748–0.810] · 0.770 [0.729–0.790] | 12.898 [12.249–13.293] · 7.552 [6.893–7.792] | 12bit 1.426 [1.388–1.493] · top10 1.411 [1.376–1.451] |
| `dbts_b1` Q32 4× | 217 | 1.107 [1.087–1.137] · 1.113 [1.077–1.148] · 1.121 [1.103–1.155] | 7.876 [7.588–8.089] · 7.710 [6.731–8.182] | 10bit 1.582 [1.552–1.629] |
| `dbts_c1` Q16 4× | 77 | 0.886 [0.861–0.913] · 0.922 [0.887–0.966] · 0.901 [0.879–0.950] | 11.144 [10.476–11.631] · 7.330 [4.955–7.760] | 12bit 1.539 [1.468–1.602] · top10 1.480 [1.439–1.545] |
| series, Q, throttle | jump G: S8 ÷ S1 jump, dav1d-WASM · WebCodecs | in order G: S8 · S16 ÷ S1, dav1d-WASM | in order G: S8 · S16 ÷ S1, WebCodecs | decoders: dav1d-WASM ÷ WebCodecs, in order G 1 · 8 · 16 | the same, jump G 1 · 8 · 16 |
| --- | --- | --- | --- | --- | --- |
| `dbts_a1` Q8 1× | 5.263 [4.899–5.424] · 4.913 [4.734–4.972] | 1.212 [1.178–1.245] · 1.256 [1.171–1.303] | 1.170 [1.129–1.198] · 1.204 [1.159–1.256] | 1.665 [1.574–1.727] · 1.709 [1.657–1.788] · 1.712 [1.663–1.754] | 1.563 [1.486–1.667] · 1.680 [1.622–1.732] · 1.738 [1.671–1.791] |
| `dbts_a1` Q16 1× | 6.618 [6.318–6.769] · 4.674 [4.299–4.779] | 1.552 [1.507–1.591] · 1.545 [1.529–1.598] | 1.084 [1.033–1.156] · 1.102 [1.057–1.165] | 1.701 [1.571–1.748] · 2.455 [2.261–2.507] · 2.354 [2.256–2.505] | 1.499 [1.449–1.611] · 2.191 [2.082–2.245] · 2.228 [2.083–2.433] |
| `dbts_a1` Q32 1× | 3.749 [3.434–3.961] · 4.483 [4.191–4.762] | 0.937 [0.904–0.967] · 0.899 [0.871–0.960] | 1.034 [0.982–1.113] · 1.108 [1.023–1.206] | 2.638 [2.525–2.817] · 2.393 [2.212–2.450] · 2.252 [2.116–2.324] | 2.361 [2.213–2.509] · 1.957 [1.837–2.061] · 1.997 [1.909–2.065] |
| `dbts_b1` Q16 1× | 5.497 [5.395–5.721] · 4.705 [4.607–4.797] | 1.312 [1.293–1.333] · 1.336 [1.294–1.370] | 1.095 [1.082–1.145] · 1.117 [1.097–1.163] | 1.591 [1.531–1.637] · 1.844 [1.786–1.955] · 1.858 [1.817–1.904] | 1.486 [1.444–1.552] · 1.752 [1.707–1.793] · 1.859 [1.791–1.919] |
| `dbts_b1` Q32 1× | 4.078 [3.949–4.175] · 4.636 [4.500–4.723] | 0.943 [0.929–0.979] · 0.954 [0.926–0.975] | 1.075 [1.041–1.132] · 1.085 [1.062–1.105] | 2.192 [2.065–2.276] · 1.898 [1.841–1.988] · 1.941 [1.888–1.988] | 1.972 [1.887–2.008] · 1.725 [1.666–1.777] · 1.809 [1.696–1.914] |
| `dbts_b1` Q56 1× | 2.189 [2.103–2.266] · 4.418 [4.353–4.564] | 0.372 [0.357–0.383] · 0.373 [0.360–0.383] | 1.086 [1.047–1.119] · 1.073 [1.037–1.108] | 3.670 [3.486–3.716] · 1.262 [1.195–1.284] · 1.252 [1.223–1.288] | 3.232 [3.159–3.310] · 1.581 [1.485–1.679] · 1.494 [1.412–1.600] |
| `dbts_c1` Q8 1× | 5.005 [4.772–5.219] · 4.571 [4.491–4.725] | 1.171 [1.136–1.190] · 1.136 [1.112–1.182] | 1.096 [1.054–1.116] · 1.080 [1.035–1.116] | 1.449 [1.406–1.479] · 1.558 [1.497–1.607] · 1.512 [1.472–1.597] | 1.315 [1.265–1.435] · 1.451 [1.408–1.516] · 1.508 [1.465–1.596] |
| `dbts_c1` Q16 1× | 5.994 [5.688–6.171] · 4.642 [4.379–4.911] | 1.395 [1.326–1.440] · 1.397 [1.360–1.418] | 1.061 [1.037–1.128] · 1.043 [0.985–1.072] | 1.502 [1.470–1.559] · 1.959 [1.875–1.996] · 2.034 [1.928–2.101] | 1.329 [1.265–1.409] · 1.729 [1.637–1.852] · 1.848 [1.714–1.941] |
| `dbts_c1` Q32 1× | 2.471 [2.354–2.600] · 4.441 [4.103–4.789] | 0.482 [0.466–0.509] · 0.487 [0.476–0.497] | 1.090 [1.040–1.116] · 1.025 [0.985–1.066] | 3.735 [3.501–3.811] · 1.631 [1.548–1.799] · 1.758 [1.698–1.838] | 2.950 [2.892–3.203] · 1.686 [1.584–1.767] · 1.725 [1.592–1.780] |
| `dbts_a1` Q16 4× | 6.330 [6.036–6.518] · 4.010 [2.672–4.311] | 1.563 [1.504–1.597] · 1.542 [1.503–1.601] | 1.008 [0.956–1.043] · 0.995 [0.940–1.011] | 2.481 [2.430–2.617] · 3.862 [3.802–3.941] · 3.877 [3.638–4.025] | 2.001 [1.190–2.173] · 3.205 [3.011–3.259] · 3.439 [3.271–3.626] |
| `dbts_b1` Q32 4× | 4.235 [4.033–4.347] · 4.129 [3.777–4.402] | 0.945 [0.926–0.980] · 0.948 [0.933–0.976] | 0.993 [0.978–1.036] · 1.023 [0.994–1.033] | 2.672 [2.629–2.808] · 2.540 [2.491–2.657] · 2.516 [2.430–2.619] | 2.395 [1.994–2.457] · 2.389 [2.233–2.550] · 2.413 [2.278–2.506] |
| `dbts_c1` Q16 4× | 5.754 [5.629–5.887] · 4.032 [2.550–4.358] | 1.366 [1.314–1.432] · 1.355 [1.259–1.440] | 1.032 [1.011–1.061] · 1.019 [0.995–1.069] | 2.333 [2.200–2.437] · 3.001 [2.901–3.146] · 3.096 [2.813–3.220] | 1.886 [1.179–2.063] · 2.711 [2.628–2.931] · 2.869 [2.800–2.944] |

### Decode shard 4, measured` |
| 5 | `shard-5` | the same | `lab/av1/profiles/rows/decode-shard-5.{json,log,txt}` | `### Decode shard 5, measured` |
| 6 | `shard-6` | the same | `lab/av1/profiles/rows/decode-shard-6.{json,log,txt}` | `### Decode shard 6, measured` |

**A shard session, k = 1 … 6** (the clock starts when the session does):

```bash
T0=$(date +%s); K=1                         # the session's first command; K is this shard's k, 1 … 6
lab/av1/profiles/decode_setup.sh && source lab/.av1-work/decode-env.sh   # 16 min here
R=lab/av1/profiles/rows/decode-shard-$K
for n in $(seq 2 2 40); do                  # resumes at the first round it lacks; pushes every 2 rounds
  node lab/av1/profiles/decode_block.mjs --block shard-$K --rounds $n --every-rung-at 1 \
    --until $((T0 + 14760)) --out $R.json 2>>$R.log
  python3 lab/av1/profiles/decode_pool.py $R.json > $R.txt
  git add $R.*; git -c user.name=dary-dc -c user.email=crespoydelgado@gmail.com commit -qm "av1: profiles decode shard $K rows"; git pull -q --rebase; git push -q
  grep -q "would pass --until" $R.log && break   # the next round would end past T0 + 4.1 h
done
```

`--until` stops before a round that would end past T0 + 4.1 h (the last round's length decides), leaving the rest of
the 4.5 h for the section.
Commits are authored `dary-dc <crespoydelgado@gmail.com>`, `git pull --rebase` before each push, never a force-push.
The session then replaces the one line under its own `### Decode shard k, measured` with: the host (its `host` row:
CPU, cores, memory), the rounds it ran, setup minutes, its A/A at each throttle, every check's tally, void cells with
why, and its `$R.txt` cells — ms inside the block only, ratios with their within-block interval, marked
**one block: not a verdict**. It claims nothing for the other blocks and decides nothing.

**Shards that started before `51c2ef69`** run a driver that checks `--until` after each round rather than before it
(so one round may end up to its own length past T0 + 4.1 h, inside the 0.4 h kept back) and keeps timestamps unrounded;
their rows, statistics and rule are the same, and the collector pools them as they are.

**A block fewer than 10 rounds** (a slower host) is reported and enters no pooled cell; **a void block** (its A/A, or
every cell failing a check) is reported with why. Neither is re-run in place; a replacement block, if the owner wants
one, is a seventh session with k = 7, appended as a row here first.

**The collector**, a later session once the six have pushed (no setup; Python only):

```bash
git pull -q --rebase
python3 lab/av1/profiles/decode_pool.py lab/av1/profiles/rows/decode-shard-*.json --links > lab/av1/profiles/rows/decode-pooled.txt
```

It writes `### Decode, pooled` only: the kept and void blocks and why; per cell the pooled ratio, its interval, the
blocks and rounds in it, the order effect and its shuffles; D1, D2, D3 each **held**, **refuted** or **not decided**
by §7's rule with the deciding cells; the new questions (G in order and on a jump; the 12-bit forms) as estimates
with their intervals; the derived link figures, marked *derived*. Claims are for `dbts_a1`, `dbts_b1` and `dbts_c1`,
these hosts and Chromium 141 only.

## Profiles bytes, measured

*Run 2026-11-02 to 2026-11-03 by a separate session, given only §5, which it ran as written; nothing above was
changed. Harness: `bytes.py` (one cell), `checks.py` (the checks and their mutations), `noise.py` (σ), `report.py`
(every table below and P1–P9, computed, not judged), `run.sh` (the order); rows in `results/`.*

```bash
P=lab/av1/.venv/bin/python; B=lab/.av1-build; D=lab/av1/data; W=…   # BUILD from lab/av1/tools/tools.sh aom
$P -m pip install --require-hashes -r lab/av1/profiles/requirements.txt
$P lab/av1/profiles/checks.py $B $W/checks $D/dbts_a1
WORK=$W lab/av1/profiles/run.sh 8,32,2,16,56 $D/dbts_{a,b,c}{1,2,3,4,5}
$P lab/av1/profiles/report.py $W
```

**Host.** 4 cores (Intel Xeon @ 2.80 GHz), 15 GB, no swap, Linux; libaom 3.15.1, dav1d 1.5.4, OpenJPH 0.31.0 as
`lab/av1/tools/tools.sh` builds them; scikit-image 0.25.2 (scipy 1.17.1). Four encodes in flight, one thread each:
wall ÷ CPU was 1.014–1.016 in every (Q, G) median, so no core was shared. Nothing past this host is claimed.

**Pilot and the ladder that ran.** `dbts_a1`, 12-bit form, Q 8 and 32 at G 1 and 16, four in parallel: 241 CPU s over
4 × 114.2 Mpx, **T = 0.53 CPU s a megapixel** (Q 8: 1.01 at G 1, 0.58 at G 16; Q 32: 0.35, 0.16). One rung over the
four G with the 12-bit series' three forms is 23 692 Mpx, 12 509 CPU s at T; 5 h × 4 cores = 72 000 CPU s holds 5.76
rungs, so **the first five ran — Q 8, 32, 2, 16, 56 — on whole volumes, every form, every G**. Not run: Q 4, 24, 1, 12,
40. The encodes themselves took 52 900 CPU s; the quality pass (SSIM above all) as long again in wall clock, which the
rule does not count. The run was stopped once by the session's usage limit with 600 of 700 cells written; it resumed
from those rows, and the four cells in flight were coded again whole.

**Readings of §5 this run had to make** (each a reading, not a change):

* *b* is the depth after the offset (`hi.bit_length()`), the table of §3's b; on all 15 DBT volumes it equals Bits
  Stored. Quality is against the source at b, every form brought back to b (p ≪ 2, the map's inverse table), so the
  three forms of a 12-bit series share one scale.
* The verdicts P1–P8 read each series in its stored form: system B's 10-bit stream, A's and C's 12-bit stream. P9 reads
  the three forms.
* The windowed map: lo = c − w/2, code = clip(rint((v − lo) · 1023 ÷ w), 0, 1023), inverse rint(lo + k · w ÷ 1023),
  both integer tables over the whole range; from the first header window.
* *One rung* is one step of the ladder that ran (2, 8, 16, 32, 56). The crossover rung is the first of those whose
  G = 1 RMSE reaches σ.
* σ per series is the median of its frames' σ; in-window is all four samples of a 2×2 block strictly inside (0, 255)
  under the first window.
* The bend is the interior rung with the largest absolute change in the slope of ln bytes (G = 1) against PSNR.
* P4 is read per (series, rung) cell whose G = 16 gain is ≥ +10 %; P5 at the rungs from the median crossover rung of the
  15 (Q 16) up; P8's e is the in-window RMSE, the samples P8 counts being in-window, at G = 1.
* One flag outside "these knobs": aomenc 3.15.1 stops at min-q = max-q with "Warning: Bad quantizer values. Quantizer
  values should not be equal, and should differ by at least 8." and waits for a key, so every encode carries `-y`,
  which its help gives as "Display warnings, but do not prompt user to continue"; it changes no coding decision
  (*unverified* beyond that text).

**Checks, and their mutations** (`results/checks.json`, `dbts_a1`'s middle 4 frames):

| check | as run | mutated | verdict |
| --- | --- | --- | --- |
| lossy + residual exact against the fetch checksum | 4 of 4 frames | one sample flipped in one decoded residual: 3 of 4; offset off by one: 0 of 4 | **sees it** |
| aomdec = dav1d, sample for sample | equal | one sample flipped in dav1d's output: unequal | **sees it** |
| `film_grain_params_present` read from the sequence header (new parser, `obu.py`) | 0 (profile 2, 12 bits, mono) | `--denoise-noise-level=25`: 1 | **sees it** |
| display codes: `voi.test.mjs`'s 18 cases, the rescaled table and the clamp, Python port | all 18 | LINEAR's − 0.5 dropped: 5 of 18 miss | **sees it** |
| `--q-hist` | every frame at Q 32 | `--max-q=40`: still every frame at Q 32 | **unable to see it**: libaom held cq-level, so a moved quantizer is not shown by this mutation |
| σ: ramp + white noise σ 1, 2, 4, 16; ramp alone | real-valued frames: 0.999, 1.998, 3.983, 15.925; ramp 0.000 — **held** | horizontal detail in place of the diagonal: ramp alone 2.52 — fails | **sees it** |
| the same σ on frames rounded to integers, as every fixture is | 0.741, 2.224, 3.706, 16.308; ramp 0.000 — **did not hold at σ 1 (−26 %) and 2 (+11 %)** | — | the MAD of half-integer details is quantized: σ comes only in steps of 0.5 ÷ 0.6745 = 0.741 |

So σ is fit to 10 % only from about σ 4 up on integer data (*derived* from the rows above): systems A and C (σ 13–18)
are inside that, system B (σ 4.4–6.7) at its edge, where σ is known to one 0.741 step. `--q-hist` also counts one
more entry than frames on every encode (57 for 56 frames); every entry sat at Q on all 700 cells.

**Every cell:** 1 100 cells of the main arm — the 15 DBT volumes (700: A and C three forms, B one; five rungs; four G)
and content 2 and 3 below (400) — and 15 of the alt-ref arm: **74 815 of 74 815 frames exact** (lossy frame + decoded
residual − offset, hashed against the fetch checksum). `film_grain_params_present` 0 on every stream; every main-arm
`--q-hist` entry at Q; keyframes exactly at the multiples of G and one temporal unit a frame on every stream; aomdec =
dav1d sample for sample on 27 of 27 streams (Q 8, G 16, stored form, one a series). The alt-ref arm's histograms also
carry 18 entries at quantizer 0 per volume beside the shown frames' Q (what libaom counts there is *unverified*).

**What else ran, after the DBT, within the 5 h at T.** The encodes of the main DBT arm took 52 900 CPU s, which left
19 100 at T: **all ten sets of content 2** (sound: `dbt10_ea1141`, `dbt12_ea1141`, `dbt12_c`, `dbt10_d`, `rf_fluoro`,
`mr_ispy1`, `mr9_ispy2`; lossy-sourced, provisional: `usb_cine`, `usb_cine_rgb`, `us_liver`), then of content 3 the sets
that fit whole, **`ustrus_1` and `ustrus_2`**; **not run: `dbts_a_max`, `dbts_b_max`, `dbts_c_max`** (2.9–5.4 Gpx a
rung each, over what was left). The secondary alt-ref arm ran on `dbts_a1`, `dbts_b1`, `dbts_c1` at G 16, all five rungs.
ρ by `rho.py` unchanged on every new grey set (the two RGB sets: not measured; `rho.py` reads one plane). Lossless AV1
G = 1 split as shipped ran on every set, every frame checked by the ingest. `mr_ispy1` is stored in 16 bits with b = 11
and `mr9_ispy2` in 12 with b = 9: their forms follow b (11 → the 12-bit stream, the top 10 with a shift of 1, the
window; 9 → a 10-bit stream). On sets with σ under about 4 (every ultrasound, `mr9_ispy2`) σ is no better than one
0.741 step (the σ check), and on `usb_cine` it reads 0.00: a lossy video source with its noise already removed. Content
4 is pending the owner's dataset. No rung is called visually lossless.

### The predictions, against the numbers

Decided by `report.py` with each refutation clause as §2 writes it. **Held: P3, P4, P6, P8. Refuted: P1, P2, P5, P7,
P9.** P10: recorded below, no verdict (lossy-sourced).

In short (every number in the tables after): the sign of inter's gain does turn with Q, as 1b says — at Q 2 and 8 the
G = 16 gain is −1.2 to +6.8 %, at each series' crossover rung (Q 16 on A, C and `dbts_b2`; Q 32 on the other four of
B) +29 to +61 %, at Q 56 +75 to +86 %. It turns at the noise (P6), rises with Q (P3) and scales with G as 1d (P4).
What is wrong is **how much** (P2: +80 % system medians at the first rung ≥ 2σ, Q 56 on every series that reaches it,
where +15 to +50 % was predicted), **which system** (P5: B gains least, not most), **one cell under the noise** (P1:
`dbts_b3` +6.8 % at Q 8, where its RMSE 3.13 is under σ ÷ 2 = 3.34 — with σ known only to one 0.741 step there, see the
σ check), **the residual's low end** (P7: on `dbts_b4` and `dbts_b5` lossy + residual at Q 2 is 0.896 and 0.928 of
HTJ2K, under the band; the other 13 sit at 1.002–1.012) and **depth** (P9: the windowed map clips the air and the
tails, 6.7–13.2 dB over the series; the 10-bit top is 11–26 % larger than the 12-bit stream at Q 16).Beside the predictions (*derived* from the tables): lossless AV1 as shipped is 0.935–0.954 of HTJ2K on 13 volumes and
0.743 and 0.775 on `dbts_b4` and `dbts_b5`, the same two whose lossy + residual fell under P7's band — HTJ2K is weaker
there, not the residual stronger. P10's provisional cine: `usb_cine` gains +62 to +91 % at G 16 at every rung, above
every DBT system's median at all five; `us_liver` +5 to +47 %, above them at two of five. The alt-ref arm is smaller at
G 16 by 2.3–59.1 % but not at equal quality: its PSNR is lower at Q 2–32 by 0.1–2.1 dB.

| # | verdict | deciding numbers |
| --- | --- | --- |
| P1 | refuted | gain > +5 % under σ ÷ 2: [('dbts_b3', 8, 6.8)]; under +10 % at some rung from one above the crossover: none; under +10 % on every rung from the crossover up: 0 of 15 (—) |
| P2 | refuted | A: G16 gain +80.8 %, at equal PSNR +76.8 % (5 of 5 series reach 2σ); B: G16 gain +80.8 %, at equal PSNR +76.5 % (3 of 5 series reach 2σ); C: G16 gain +80.4 %, at equal PSNR +75.6 % (5 of 5 series reach 2σ) |
| P3 | held | 0 of 15 series fall > 2 points or dip twice: none |
| P4 | held | 45 (series, rung) cells with G16 ≥ +10 %; broken (G8 ÷ G16 < 0.8 or whole ÷ G16 > 1.15) on 0 series: none |
| P5 | refuted | rungs from the median crossover (16) up: Q 16: A +38.9, B +21.2, C +31.9; Q 32: A +70.8, B +59.4, C +68.4; Q 56: A +80.8, B +80.8, C +80.4; B highest at 0 of 3; A–C within 5 points at all: False |
| P6 | held | bend > 1 rung from the crossover on 0 of 15: none |
| P7 | refuted | best-rung sum ÷ HTJ2K at G1: dbts_a1 1.007 (Q 16), dbts_a2 1.005 (Q 16), dbts_a3 1.007 (Q 32), dbts_a4 1.006 (Q 32), dbts_a5 1.008 (Q 32), dbts_b1 1.002 (Q 32), dbts_b2 1.003 (Q 32), dbts_b3 1.002 (Q 32), dbts_b4 0.896 (Q 2), dbts_b5 0.928 (Q 2), dbts_c1 1.006 (Q 16), dbts_c2 1.007 (Q 32), dbts_c3 1.008 (Q 16), dbts_c4 1.012 (Q 16), dbts_c5 1.005 (Q 32); outside 0.93–1.03: [('dbts_b4', 0.896), ('dbts_b5', 0.928)]; G16 under G1 by > 3 points: none; residual falling between adjacent rungs at some G: 0 series  |
| P8 | held | outside ×2 on 0 of 137 (series, rung, window) cells at G1 with RMSE ≥ σ ÷ 2 (e is the in-window RMSE) |
| P9 | refuted | 10 of 10 12-bit series break it; 250 breaking cells, first: [('dbts_a1', 'top10', 16, 1, 1.113, 0.1), ('dbts_a1', 'window', 16, 1, 21.585, -33.71), ('dbts_a1', 'top10', 16, 8, 1.172, 0.12), ('dbts_a1', 'window', 16, 8, 36.526, -33.7), ('dbts_a1', 'top10', 16, 16, 1.18, 0.12), ('dbts_a1', 'window', 16, 16, 37.706, -33.7)] |
| P10 | recorded, no verdict | us_liver: G16 gain Q 2 +5.1, Q 8 +8.3, Q 16 +12.2, Q 32 +19.2, Q 56 +46.9; above every DBT system at 2 of 5 rungs; at its crossover rung (2) +5.1 %; usb_cine: G16 gain Q 2 +61.6, Q 8 +72.2, Q 16 +76.3, Q 32 +86.5, Q 56 +91.0; above every DBT system at 5 of 5 rungs; at its crossover rung (2) +61.6 % |

#### σ, ρ, crossover, bend

| series | σ | ρ (top, best offset, median) | HTJ2K B | lossless AV1 ÷ HTJ2K | crossover rung, by form | bend (G1) |
| --- | --- | --- | --- | --- | --- | --- |
| `dbt10_d` | 5.19 | 0.2216 | 42131909 | 0.9497 | 10bit 16 | 16 |
| `dbt10_ea1141` | 5.93 | 0.2809 | 13637860 | 0.9511 | 10bit 16 | 16 |
| `dbt12_c` | 15.57 | 0.1215 | 64907190 | 0.9480 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbt12_ea1141` | 14.83 | 0.1229 | 14476791 | 0.9479 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_a1` | 13.34 | 0.112 | 67812443 | 0.9425 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_a2` | 14.08 | 0.116 | 97667570 | 0.9447 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_a3` | 15.57 | 0.109 | 39712458 | 0.9450 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_a4` | 16.31 | 0.111 | 117046467 | 0.9455 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_a5` | 14.08 | 0.125 | 73139226 | 0.9509 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_b1` | 5.93 | 0.181 | 107407602 | 0.9354 | 10bit 32 | 16 |
| `dbts_b2` | 4.45 | 0.189 | 143768865 | 0.9476 | 10bit 16 | 16 |
| `dbts_b3` | 6.67 | 0.266 | 119235171 | 0.9359 | 10bit 32 | 16 |
| `dbts_b4` | 6.67 | 0.228 | 125719597 | 0.7434 | 10bit 32 | 16 |
| `dbts_b5` | 4.45 | 0.215 | 91380288 | 0.7751 | 10bit 32 | 16 |
| `dbts_c1` | 14.83 | 0.117 | 70664924 | 0.9423 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_c2` | 16.31 | 0.117 | 60299025 | 0.9537 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_c3` | 16.31 | 0.116 | 94483885 | 0.9451 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_c4` | 17.79 | 0.118 | 41429376 | 0.9463 | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_c5` | 14.83 | 0.113 | 82238373 | 0.9448 | 12bit 16 · top10 16 · window 2 | 32 |
| `mr9_ispy2` | 0.74 | 0.127 | 1365691 | 0.9267 | 9bit 2 | 16 |
| `mr_ispy1` | 6.67 | 0.0705 | 10821976 | 0.9964 | 11bit 8 · top10 8 · window 2 | 8 |
| `rf_fluoro` | 13.34 | 0.0791 | 9267247 | 0.9469 | 12bit 8 · top10 8 · window 2 | 8 |
| `us_liver` | 1.48 | not measured | 18019334 | 0.9675 | rgb420 2 | 8 |
| `usb_cine` | 0.00 | 0.8694 | 4992262 | 0.9023 | 8bit 2 | 32 |
| `usb_cine_rgb` | 0.74 | not measured | 11821475 | 0.9166 | rgb420 2 | 8 |
| `ustrus_1` | 0.74 | 0.6214 | 21200492 | 0.9055 | 8bit 8 | 32 |
| `ustrus_2` | 1.48 | 0.6493 | 21866379 | 0.9104 | 8bit 16 | 32 |

#### Bytes, DBT-10 (system B)

Each cell: G = 1 · 8 · 16 · whole.

| series, form | Q | lossy ÷ HTJ2K | gain % | residual ÷ HTJ2K | lossy + residual ÷ HTJ2K |
| --- | --- | --- | --- | --- | --- |
| `dbts_b1` 10bit | 2 | 0.6314 · 0.6236 · 0.6231 · 0.6226 | 0 · +1.2 · +1.3 · +1.4 | 0.457 · 0.458 · 0.459 · 0.459 | 1.089 · 1.082 · 1.082 · 1.081 |
| `dbts_b1` 10bit | 8 | 0.2186 · 0.2161 · 0.2159 · 0.2158 | 0 · +1.2 · +1.2 · +1.3 | 0.825 · 0.822 · 0.822 · 0.822 | 1.044 · 1.038 · 1.038 · 1.038 |
| `dbts_b1` 10bit | 16 | 0.0526 · 0.0434 · 0.0430 · 0.0426 | 0 · +17.4 · +18.3 · +19.1 | 0.960 · 0.959 · 0.958 · 0.959 | 1.013 · 1.002 · 1.001 · 1.001 |
| `dbts_b1` 10bit | 32 | 0.0113 · 0.0053 · 0.0050 · 0.0047 | 0 · +53.0 · +55.9 · +58.5 | 0.991 · 0.991 · 0.991 · 0.992 | 1.002 · 0.996 · 0.996 · 0.996 |
| `dbts_b1` 10bit | 56 | 0.0014 · 0.0004 · 0.0003 · 0.0003 | 0 · +71.7 · +75.5 · +78.1 | 1.007 · 1.007 · 1.008 · 1.010 | 1.009 · 1.007 · 1.009 · 1.011 |
| `dbts_b2` 10bit | 2 | 0.5940 · 0.5880 · 0.5876 · 0.5873 | 0 · +1.0 · +1.1 · +1.1 | 0.506 · 0.507 · 0.507 · 0.507 | 1.100 · 1.095 · 1.095 · 1.095 |
| `dbts_b2` 10bit | 8 | 0.1502 · 0.1417 · 0.1415 · 0.1414 | 0 · +5.6 · +5.8 · +5.8 | 0.878 · 0.874 · 0.873 · 0.873 | 1.028 · 1.015 · 1.015 · 1.015 |
| `dbts_b2` 10bit | 16 | 0.0409 · 0.0295 · 0.0291 · 0.0287 | 0 · +28.0 · +29.0 · +29.9 | 0.969 · 0.968 · 0.968 · 0.968 | 1.010 · 0.997 · 0.997 · 0.997 |
| `dbts_b2` 10bit | 32 | 0.0081 · 0.0031 · 0.0029 · 0.0027 | 0 · +61.9 · +64.6 · +67.2 | 0.995 · 0.996 · 0.996 · 0.997 | 1.003 · 0.999 · 0.999 · 0.999 |
| `dbts_b2` 10bit | 56 | 0.0011 · 0.0003 · 0.0002 · 0.0002 | 0 · +76.7 · +80.8 · +84.1 | 1.005 · 1.005 · 1.007 · 1.010 | 1.006 · 1.006 · 1.008 · 1.010 |
| `dbts_b3` 10bit | 2 | 0.6377 · 0.6155 · 0.6133 · 0.6117 | 0 · +3.5 · +3.8 · +4.1 | 0.447 · 0.447 · 0.448 · 0.448 | 1.084 · 1.062 · 1.061 · 1.060 |
| `dbts_b3` 10bit | 8 | 0.2370 · 0.2220 · 0.2208 · 0.2200 | 0 · +6.3 · +6.8 · +7.2 | 0.804 · 0.800 · 0.800 · 0.800 | 1.041 · 1.022 · 1.021 · 1.020 |
| `dbts_b3` 10bit | 16 | 0.0653 · 0.0520 · 0.0514 · 0.0511 | 0 · +20.3 · +21.2 · +21.8 | 0.951 · 0.949 · 0.949 · 0.950 | 1.016 · 1.001 · 1.001 · 1.001 |
| `dbts_b3` 10bit | 32 | 0.0113 · 0.0048 · 0.0044 · 0.0042 | 0 · +57.9 · +60.9 · +62.7 | 0.991 · 0.992 · 0.992 · 0.993 | 1.002 · 0.996 · 0.996 · 0.997 |
| `dbts_b3` 10bit | 56 | 0.0016 · 0.0004 · 0.0003 · 0.0003 | 0 · +74.6 · +78.5 · +81.5 | 1.005 · 1.006 · 1.008 · 1.012 | 1.007 · 1.007 · 1.008 · 1.012 |
| `dbts_b4` 10bit | 2 | 0.5033 · 0.5044 · 0.5041 · 0.5045 | 0 · -0.2 · -0.2 · -0.2 | 0.392 · 0.404 · 0.402 · 0.404 | 0.896 · 0.909 · 0.907 · 0.908 |
| `dbts_b4` 10bit | 8 | 0.1851 · 0.1820 · 0.1820 · 0.1820 | 0 · +1.7 · +1.7 · +1.7 | 0.820 · 0.830 · 0.827 · 0.821 | 1.005 · 1.012 · 1.009 · 1.003 |
| `dbts_b4` 10bit | 16 | 0.0534 · 0.0458 · 0.0455 · 0.0452 | 0 · +14.2 · +14.8 · +15.3 | 0.955 · 0.955 · 0.955 · 0.955 | 1.009 · 1.001 · 1.000 · 1.001 |
| `dbts_b4` 10bit | 32 | 0.0076 · 0.0035 · 0.0033 · 0.0031 | 0 · +54.7 · +57.2 · +59.4 | 0.991 · 0.993 · 0.993 · 0.993 | 0.998 · 0.996 · 0.996 · 0.996 |
| `dbts_b4` 10bit | 56 | 0.0012 · 0.0003 · 0.0002 · 0.0002 | 0 · +78.2 · +82.8 · +86.4 | 1.002 · 1.004 · 1.006 · 1.011 | 1.003 · 1.004 · 1.006 · 1.011 |
| `dbts_b5` 10bit | 2 | 0.4941 · 0.4995 · 0.5001 · 0.5008 | 0 · -1.1 · -1.2 · -1.4 | 0.434 · 0.439 · 0.440 · 0.440 | 0.928 · 0.938 · 0.940 · 0.941 |
| `dbts_b5` 10bit | 8 | 0.1428 · 0.1390 · 0.1392 · 0.1394 | 0 · +2.7 · +2.5 · +2.4 | 0.859 · 0.866 · 0.860 · 0.853 | 1.002 · 1.005 · 1.000 · 0.992 |
| `dbts_b5` 10bit | 16 | 0.0455 · 0.0360 · 0.0356 · 0.0353 | 0 · +20.9 · +21.7 · +22.4 | 0.960 · 0.959 · 0.959 · 0.959 | 1.005 · 0.995 · 0.994 · 0.994 |
| `dbts_b5` 10bit | 32 | 0.0088 · 0.0038 · 0.0036 · 0.0034 | 0 · +56.8 · +59.4 · +61.7 | 0.991 · 0.993 · 0.993 · 0.994 | 1.000 · 0.997 · 0.997 · 0.998 |
| `dbts_b5` 10bit | 56 | 0.0013 · 0.0003 · 0.0002 · 0.0002 | 0 · +77.9 · +82.2 · +85.8 | 1.005 · 1.006 · 1.008 · 1.010 | 1.006 · 1.007 · 1.008 · 1.010 |

#### Quality, DBT-10 (system B)

Each cell: G = 1 · 8 · 16 · whole; against the source at its depth b.

| series, form | Q | PSNR / in-window PSNR, dB | SSIM mean | SSIM min frame | max \|Δ\| | 1st window: % differ / % > 1 / max Δcode |
| --- | --- | --- | --- | --- | --- | --- |
| `dbts_b1` 10bit | 2 | 64.91/60.29 · 64.86/60.25 · 64.86/60.24 · 64.85/60.24 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 19 · 27 · 27 · 27 | 35.6/0.4/3 · 35.8/0.4/12 · 35.8/0.4/12 · 35.9/0.4/12 |
| `dbts_b1` 10bit | 8 | 51.95/47.33 · 52.05/47.43 · 52.05/47.43 · 52.06/47.44 | 0.9945 · 0.9946 · 0.9946 · 0.9946 | 0.9944 · 0.9944 · 0.9945 · 0.9945 | 131 · 131 · 86 · 109 | 82.1/49.7/29 · 81.9/49.3/31 · 81.9/49.2/34 · 81.9/49.2/31 |
| `dbts_b1` 10bit | 16 | 46.60/41.98 · 46.69/42.07 · 46.69/42.07 · 46.70/42.08 | 0.9811 · 0.9816 · 0.9816 · 0.9817 | 0.9804 · 0.9807 · 0.9807 · 0.9807 | 269 · 251 · 229 · 200 | 90.0/70.8/59 · 90.0/70.5/76 · 90.0/70.5/73 · 89.9/70.5/67 |
| `dbts_b1` 10bit | 32 | 44.00/39.42 · 43.96/39.38 · 43.96/39.38 · 43.96/39.37 | 0.9693 · 0.9697 · 0.9696 · 0.9698 | 0.9681 · 0.9682 · 0.9683 · 0.9685 | 349 · 399 · 378 · 403 | 92.4/77.6/83 · 92.5/77.7/97 · 92.5/77.7/86 · 92.5/77.7/83 |
| `dbts_b1` 10bit | 56 | 39.68/35.68 · 39.49/35.46 · 39.42/35.37 · 39.40/35.28 | 0.9277 · 0.9284 · 0.9270 · 0.9297 | 0.9198 · 0.9222 · 0.9217 · 0.9270 | 547 · 504 · 531 · 522 | 94.8/84.4/154 · 94.9/84.8/146 · 95.0/85.0/146 · 95.0/85.2/146 |
| `dbts_b2` 10bit | 2 | 62.03/60.22 · 61.99/60.19 · 61.99/60.19 · 61.98/60.19 | 0.9994 · 0.9994 · 0.9994 · 0.9994 | 0.9994 · 0.9994 · 0.9994 · 0.9994 | 18 · 24 · 24 · 27 | 35.9/0.4/4 · 36.0/0.4/3 · 36.1/0.4/3 · 36.1/0.4/6 |
| `dbts_b2` 10bit | 8 | 49.73/47.93 · 49.85/48.05 · 49.86/48.06 · 49.87/48.07 | 0.9902 · 0.9905 · 0.9905 · 0.9905 | 0.9901 · 0.9901 · 0.9901 · 0.9902 | 110 · 88 · 77 · 79 | 80.7/46.5/18 · 80.5/45.9/23 · 80.4/45.9/22 · 80.4/45.8/21 |
| `dbts_b2` 10bit | 16 | 45.47/43.68 · 45.49/43.70 · 45.50/43.70 · 45.50/43.71 | 0.9745 · 0.9748 · 0.9749 · 0.9749 | 0.9741 · 0.9742 · 0.9742 · 0.9744 | 260 · 244 · 244 · 244 | 87.8/64.6/56 · 87.8/64.6/56 · 87.8/64.6/47 · 87.8/64.6/56 |
| `dbts_b2` 10bit | 32 | 42.81/41.08 · 42.67/40.94 · 42.65/40.92 · 42.62/40.89 | 0.9602 · 0.9601 · 0.9599 · 0.9595 | 0.9590 · 0.9592 · 0.9592 · 0.9588 | 334 · 374 · 389 · 389 | 90.7/72.6/74 · 90.8/73.0/78 · 90.8/73.0/74 · 90.9/73.1/86 |
| `dbts_b2` 10bit | 56 | 38.77/37.52 · 38.58/37.31 · 38.48/37.21 · 38.33/37.02 | 0.9346 · 0.9344 · 0.9330 · 0.9322 | 0.9305 · 0.9310 · 0.9307 · 0.9306 | 536 · 535 · 584 · 548 | 93.4/80.4/178 · 93.5/80.7/187 · 93.6/80.9/176 · 93.7/81.3/187 |
| `dbts_b3` 10bit | 2 | 63.17/60.30 · 63.15/60.29 · 63.14/60.29 · 63.14/60.29 | 0.9996 · 0.9996 · 0.9996 · 0.9996 | 0.9996 · 0.9996 · 0.9996 · 0.9996 | 21 · 34 · 34 · 35 | 35.6/0.4/3 · 35.7/0.4/11 · 35.7/0.4/15 · 35.7/0.4/15 |
| `dbts_b3` 10bit | 8 | 50.28/47.42 · 50.39/47.52 · 50.40/47.53 · 50.40/47.54 | 0.9922 · 0.9925 · 0.9925 · 0.9925 | 0.9921 · 0.9921 · 0.9921 · 0.9922 | 85 · 78 · 78 · 91 | 81.9/49.3/31 · 81.7/48.8/29 · 81.7/48.7/37 · 81.7/48.7/29 |
| `dbts_b3` 10bit | 16 | 44.54/41.67 · 44.62/41.75 · 44.62/41.75 · 44.62/41.76 | 0.9706 · 0.9712 · 0.9712 · 0.9713 | 0.9697 · 0.9698 · 0.9702 · 0.9703 | 337 · 237 · 241 · 275 | 90.5/71.9/92 · 90.4/71.7/63 · 90.4/71.7/70 · 90.4/71.7/83 |
| `dbts_b3` 10bit | 32 | 41.69/38.85 · 41.59/38.75 · 41.58/38.73 · 41.56/38.71 | 0.9487 · 0.9485 · 0.9486 · 0.9485 | 0.9471 · 0.9471 · 0.9473 · 0.9472 | 435 · 420 · 433 · 419 | 92.9/79.0/135 · 93.0/79.2/135 · 93.0/79.3/101 · 93.0/79.3/103 |
| `dbts_b3` 10bit | 56 | 37.52/35.12 · 37.30/34.89 · 37.18/34.76 · 37.02/34.58 | 0.9156 · 0.9150 · 0.9147 · 0.9124 | 0.9101 · 0.9104 · 0.9103 · 0.9093 | 799 · 858 · 858 · 858 | 95.0/85.0/254 · 95.0/85.2/250 · 95.1/85.4/250 · 95.2/85.7/254 |
| `dbts_b4` 10bit | 2 | 64.67/60.27 · 64.48/60.27 · 64.49/60.27 · 64.46/60.26 | 0.9996 · 0.9996 · 0.9996 · 0.9996 | 0.9996 · 0.9996 · 0.9995 · 0.9995 | 9 · 26 · 29 · 29 | 35.7/0.4/4 · 35.8/0.4/12 · 35.8/0.4/15 · 35.8/0.4/15 |
| `dbts_b4` 10bit | 8 | 51.88/47.41 · 52.00/47.58 · 52.03/47.59 · 52.07/47.61 | 0.9938 · 0.9940 · 0.9941 · 0.9942 | 0.9936 · 0.9936 · 0.9936 · 0.9938 | 38 · 49 · 54 · 49 | 81.9/49.2/17 · 81.6/48.5/25 · 81.6/48.4/26 · 81.5/48.4/25 |
| `dbts_b4` 10bit | 16 | 46.50/41.82 · 46.59/41.92 · 46.60/41.93 · 46.61/41.94 | 0.9792 · 0.9797 · 0.9797 · 0.9798 | 0.9786 · 0.9786 · 0.9788 · 0.9794 | 115 · 197 · 273 · 304 | 90.2/71.1/48 · 90.1/70.8/38 · 90.1/70.8/54 · 90.0/70.8/50 |
| `dbts_b4` 10bit | 32 | 43.43/38.69 · 43.33/38.57 · 43.31/38.56 · 43.31/38.55 | 0.9624 · 0.9622 · 0.9623 · 0.9624 | 0.9615 · 0.9613 · 0.9614 · 0.9613 | 208 · 380 · 375 · 395 | 92.8/78.7/79 · 92.9/78.9/99 · 92.9/79.0/103 · 92.9/79.0/71 |
| `dbts_b4` 10bit | 56 | 39.87/35.51 · 39.54/35.20 · 39.40/35.08 · 39.26/34.88 | 0.9231 · 0.9227 · 0.9195 · 0.9260 | 0.9003 · 0.9035 · 0.9035 · 0.9153 | 459 · 460 · 470 · 473 | 94.9/84.7/183 · 95.0/85.0/203 · 95.0/85.1/189 · 95.1/85.5/203 |
| `dbts_b5` 10bit | 2 | 64.25/60.20 · 64.22/60.20 · 64.21/60.20 · 64.22/60.20 | 0.9996 · 0.9996 · 0.9996 · 0.9996 | 0.9996 · 0.9996 · 0.9995 · 0.9996 | 8 · 20 · 19 · 21 | 36.0/0.4/4 · 36.0/0.4/4 · 36.0/0.4/4 · 36.0/0.4/8 |
| `dbts_b5` 10bit | 8 | 51.91/47.78 · 52.04/47.96 · 52.08/47.97 · 52.12/47.98 | 0.9938 · 0.9940 · 0.9941 · 0.9941 | 0.9937 · 0.9937 · 0.9937 · 0.9938 | 36 · 49 · 43 · 45 | 81.0/47.2/16 · 80.7/46.4/25 · 80.7/46.3/18 · 80.6/46.3/23 |
| `dbts_b5` 10bit | 16 | 47.47/43.21 · 47.56/43.31 · 47.58/43.32 · 47.59/43.33 | 0.9830 · 0.9834 · 0.9835 · 0.9836 | 0.9826 · 0.9827 · 0.9828 · 0.9831 | 98 · 122 · 109 · 156 | 88.4/66.3/49 · 88.3/66.0/34 · 88.3/65.9/38 · 88.3/65.9/47 |
| `dbts_b5` 10bit | 32 | 44.28/39.93 · 44.13/39.77 · 44.11/39.76 · 44.10/39.75 | 0.9697 · 0.9695 · 0.9695 · 0.9697 | 0.9685 · 0.9679 · 0.9677 · 0.9682 | 202 · 422 · 525 · 525 | 91.7/75.4/74 · 91.8/75.8/109 · 91.8/75.8/137 · 91.8/75.9/137 |
| `dbts_b5` 10bit | 56 | 40.00/36.03 · 39.70/35.73 · 39.54/35.57 · 39.41/35.37 | 0.9284 · 0.9320 · 0.9322 · 0.9466 | 0.8902 · 0.8943 · 0.9103 · 0.9289 | 635 · 553 · 553 · 549 | 94.5/83.5/148 · 94.5/83.8/204 · 94.6/84.0/192 · 94.8/84.4/199 |

#### Bytes, DBT-12 (systems A, C)

Each cell: G = 1 · 8 · 16 · whole.

| series, form | Q | lossy ÷ HTJ2K | gain % | residual ÷ HTJ2K | lossy + residual ÷ HTJ2K |
| --- | --- | --- | --- | --- | --- |
| `dbts_a1` 12bit | 2 | 0.4806 · 0.4670 · 0.4664 · 0.4658 | 0 · +2.8 · +3.0 · +3.1 | 0.567 · 0.579 · 0.581 · 0.581 | 1.048 · 1.046 · 1.047 · 1.047 |
| `dbts_a1` 12bit | 8 | 0.0740 · 0.0741 · 0.0741 · 0.0741 | 0 · -0.2 · -0.2 · -0.1 | 0.946 · 0.943 · 0.943 · 0.944 | 1.020 · 1.017 · 1.018 · 1.018 |
| `dbts_a1` 12bit | 16 | 0.0110 · 0.0065 · 0.0063 · 0.0062 | 0 · +40.3 · +42.2 · +43.8 | 0.996 · 0.997 · 0.998 · 0.999 | 1.007 · 1.004 · 1.004 · 1.005 |
| `dbts_a1` 12bit | 32 | 0.0030 · 0.0011 · 0.0010 · 0.0009 | 0 · +65.2 · +68.0 · +70.4 | 1.005 · 1.008 · 1.010 · 1.013 | 1.008 · 1.009 · 1.011 · 1.014 |
| `dbts_a1` 12bit | 56 | 0.0006 · 0.0002 · 0.0001 · 0.0001 | 0 · +76.7 · +80.8 · +84.2 | 1.019 · 1.021 · 1.023 · 1.025 | 1.020 · 1.021 · 1.023 · 1.026 |
| `dbts_a1` top10 | 2 | 0.3889 · 0.3904 · 0.3905 · 0.3906 | 0 · -0.4 · -0.4 · -0.4 | 0.669 · 0.672 · 0.674 · 0.675 | 1.058 · 1.063 · 1.064 · 1.065 |
| `dbts_a1` top10 | 8 | 0.0687 · 0.0684 · 0.0684 · 0.0684 | 0 · +0.3 · +0.3 · +0.3 | 0.950 · 0.948 · 0.949 · 0.949 | 1.019 · 1.017 · 1.017 · 1.018 |
| `dbts_a1` top10 | 16 | 0.0122 · 0.0077 · 0.0075 · 0.0073 | 0 · +37.2 · +38.7 · +40.2 | 0.994 · 0.996 · 0.996 · 0.996 | 1.006 · 1.003 · 1.003 · 1.003 |
| `dbts_a1` top10 | 32 | 0.0035 · 0.0013 · 0.0012 · 0.0012 | 0 · +61.3 · +64.3 · +66.8 | 1.004 · 1.007 · 1.009 · 1.009 | 1.008 · 1.009 · 1.010 · 1.010 |
| `dbts_a1` top10 | 56 | 0.0008 · 0.0002 · 0.0002 · 0.0001 | 0 · +74.8 · +78.2 · +81.7 | 1.017 · 1.019 · 1.021 · 1.024 | 1.017 · 1.019 · 1.022 · 1.024 |
| `dbts_a1` window | 2 | 0.7063 · 0.7075 · 0.7075 · 0.7075 | 0 · -0.2 · -0.2 · -0.2 | 0.472 · 0.473 · 0.473 · 0.473 | 1.178 · 1.180 · 1.180 · 1.181 |
| `dbts_a1` window | 8 | 0.3953 · 0.3973 · 0.3975 · 0.3978 | 0 · -0.5 · -0.6 · -0.6 | 0.671 · 0.673 · 0.673 · 0.673 | 1.066 · 1.070 · 1.071 · 1.071 |
| `dbts_a1` window | 16 | 0.2364 · 0.2388 · 0.2389 · 0.2390 | 0 · -1.0 · -1.0 · -1.1 | 0.810 · 0.811 · 0.811 · 0.811 | 1.047 · 1.050 · 1.050 · 1.050 |
| `dbts_a1` window | 32 | 0.0602 · 0.0606 · 0.0606 · 0.0607 | 0 · -0.5 · -0.7 · -0.8 | 0.961 · 0.958 · 0.958 · 0.958 | 1.021 · 1.019 · 1.019 · 1.018 |
| `dbts_a1` window | 56 | 0.0028 · 0.0012 · 0.0011 · 0.0010 | 0 · +57.9 · +60.5 · +62.5 | 1.005 · 1.005 · 1.006 · 1.006 | 1.008 · 1.006 · 1.007 · 1.007 |
| `dbts_a2` 12bit | 2 | 0.4881 · 0.4768 · 0.4761 · 0.4755 | 0 · +2.3 · +2.5 · +2.6 | 0.559 · 0.571 · 0.572 · 0.574 | 1.047 · 1.048 · 1.048 · 1.049 |
| `dbts_a2` 12bit | 8 | 0.0890 · 0.0884 · 0.0883 · 0.0883 | 0 · +0.6 · +0.7 · +0.7 | 0.932 · 0.930 · 0.930 · 0.930 | 1.021 · 1.018 · 1.018 · 1.019 |
| `dbts_a2` 12bit | 16 | 0.0136 · 0.0085 · 0.0083 · 0.0081 | 0 · +37.3 · +38.9 · +40.7 | 0.992 · 0.993 · 0.994 · 0.995 | 1.005 · 1.001 · 1.002 · 1.003 |
| `dbts_a2` 12bit | 32 | 0.0032 · 0.0010 · 0.0009 · 0.0009 | 0 · +67.6 · +70.8 · +73.4 | 1.002 · 1.005 · 1.006 · 1.011 | 1.005 · 1.006 · 1.007 · 1.012 |
| `dbts_a2` 12bit | 56 | 0.0006 · 0.0002 · 0.0001 · 0.0001 | 0 · +76.3 · +80.7 · +84.5 | 1.013 · 1.013 · 1.016 · 1.031 | 1.013 · 1.013 · 1.016 · 1.031 |
| `dbts_a2` top10 | 2 | 0.3972 · 0.3999 · 0.4001 · 0.4003 | 0 · -0.7 · -0.7 · -0.8 | 0.660 · 0.663 · 0.664 · 0.665 | 1.057 · 1.063 · 1.064 · 1.065 |
| `dbts_a2` top10 | 8 | 0.0832 · 0.0823 · 0.0822 · 0.0821 | 0 · +1.1 · +1.2 · +1.2 | 0.938 · 0.936 · 0.936 · 0.937 | 1.021 · 1.018 · 1.018 · 1.019 |
| `dbts_a2` top10 | 16 | 0.0154 · 0.0103 · 0.0101 · 0.0098 | 0 · +33.3 · +34.8 · +36.3 | 0.991 · 0.991 · 0.992 · 0.993 | 1.006 · 1.002 · 1.002 · 1.003 |
| `dbts_a2` top10 | 32 | 0.0038 · 0.0014 · 0.0012 · 0.0011 | 0 · +63.8 · +66.9 · +69.8 | 1.002 · 1.005 · 1.006 · 1.008 | 1.006 · 1.007 · 1.008 · 1.009 |
| `dbts_a2` top10 | 56 | 0.0008 · 0.0002 · 0.0002 · 0.0001 | 0 · +75.2 · +79.4 · +82.6 | 1.012 · 1.013 · 1.016 · 1.035 | 1.012 · 1.013 · 1.016 · 1.035 |
| `dbts_a2` window | 2 | 0.6487 · 0.6563 · 0.6567 · 0.6571 | 0 · -1.2 · -1.2 · -1.3 | 0.550 · 0.551 · 0.551 · 0.551 | 1.199 · 1.208 · 1.208 · 1.209 |
| `dbts_a2` window | 8 | 0.3643 · 0.3663 · 0.3661 · 0.3666 | 0 · -0.5 · -0.5 · -0.6 | 0.710 · 0.712 · 0.712 · 0.712 | 1.074 · 1.078 · 1.078 · 1.079 |
| `dbts_a2` window | 16 | 0.2210 · 0.2225 · 0.2226 · 0.2228 | 0 · -0.7 · -0.7 · -0.8 | 0.825 · 0.826 · 0.826 · 0.826 | 1.046 · 1.048 · 1.048 · 1.048 |
| `dbts_a2` window | 32 | 0.0644 · 0.0647 · 0.0647 · 0.0648 | 0 · -0.4 · -0.5 · -0.6 | 0.957 · 0.955 · 0.954 · 0.954 | 1.021 · 1.019 · 1.019 · 1.019 |
| `dbts_a2` window | 56 | 0.0023 · 0.0010 · 0.0009 · 0.0009 | 0 · +58.0 · +60.1 · +61.6 | 1.002 · 1.003 · 1.004 · 1.008 | 1.005 · 1.004 · 1.005 · 1.009 |
| `dbts_a3` 12bit | 2 | 0.4978 · 0.4969 · 0.4968 · 0.4968 | 0 · +0.2 · +0.2 · +0.2 | 0.549 · 0.550 · 0.550 · 0.550 | 1.047 · 1.047 · 1.046 · 1.046 |
| `dbts_a3` 12bit | 8 | 0.0970 · 0.0966 · 0.0965 · 0.0966 | 0 · +0.5 · +0.5 · +0.4 | 0.929 · 0.926 · 0.926 · 0.927 | 1.026 · 1.023 · 1.023 · 1.023 |
| `dbts_a3` 12bit | 16 | 0.0126 · 0.0078 · 0.0075 · 0.0073 | 0 · +38.3 · +40.4 · +42.1 | 0.995 · 0.996 · 0.996 · 0.997 | 1.007 · 1.003 · 1.004 · 1.004 |
| `dbts_a3` 12bit | 32 | 0.0030 · 0.0009 · 0.0008 · 0.0007 | 0 · +70.0 · +74.2 · +75.9 | 1.004 · 1.006 · 1.007 · 1.010 | 1.007 · 1.007 · 1.008 · 1.010 |
| `dbts_a3` 12bit | 56 | 0.0007 · 0.0001 · 0.0001 · 0.0001 | 0 · +79.0 · +85.7 · +89.0 | 1.017 · 1.017 · 1.018 · 1.020 | 1.018 · 1.017 · 1.018 · 1.020 |
| `dbts_a3` top10 | 2 | 0.4104 · 0.4108 · 0.4106 · 0.4105 | 0 · -0.1 · -0.1 · -0.0 | 0.648 · 0.648 · 0.649 · 0.649 | 1.058 · 1.059 · 1.059 · 1.059 |
| `dbts_a3` top10 | 8 | 0.0907 · 0.0898 · 0.0897 · 0.0897 | 0 · +1.0 · +1.1 · +1.0 | 0.935 · 0.933 · 0.932 · 0.934 | 1.026 · 1.023 · 1.022 · 1.024 |
| `dbts_a3` top10 | 16 | 0.0144 · 0.0091 · 0.0089 · 0.0086 | 0 · +36.6 · +38.6 · +40.0 | 0.994 · 0.995 · 0.995 · 0.996 | 1.008 · 1.004 · 1.004 · 1.004 |
| `dbts_a3` top10 | 32 | 0.0035 · 0.0012 · 0.0010 · 0.0010 | 0 · +66.8 · +70.5 · +72.5 | 1.004 · 1.007 · 1.008 · 1.009 | 1.008 · 1.008 · 1.009 · 1.010 |
| `dbts_a3` top10 | 56 | 0.0008 · 0.0002 · 0.0001 · 0.0001 | 0 · +78.3 · +84.4 · +87.8 | 1.018 · 1.018 · 1.019 · 1.024 | 1.019 · 1.019 · 1.019 · 1.024 |
| `dbts_a3` window | 2 | 0.6915 · 0.6915 · 0.6916 · 0.6915 | 0 · +0.0 · -0.0 · +0.0 | 0.526 · 0.526 · 0.526 · 0.526 | 1.218 · 1.218 · 1.218 · 1.218 |
| `dbts_a3` window | 8 | 0.4058 · 0.4070 · 0.4069 · 0.4070 | 0 · -0.3 · -0.3 · -0.3 | 0.678 · 0.675 · 0.675 · 0.675 | 1.084 · 1.082 · 1.082 · 1.082 |
| `dbts_a3` window | 16 | 0.2648 · 0.2646 · 0.2646 · 0.2646 | 0 · +0.1 · +0.1 · +0.1 | 0.789 · 0.790 · 0.790 · 0.790 | 1.054 · 1.054 · 1.054 · 1.054 |
| `dbts_a3` window | 32 | 0.0963 · 0.0960 · 0.0960 · 0.0960 | 0 · +0.4 · +0.3 · +0.3 | 0.933 · 0.931 · 0.931 · 0.931 | 1.029 · 1.027 · 1.027 · 1.027 |
| `dbts_a3` window | 56 | 0.0029 · 0.0012 · 0.0012 · 0.0011 | 0 · +57.7 · +59.9 · +60.9 | 1.002 · 1.002 · 1.003 · 1.004 | 1.005 · 1.003 · 1.004 · 1.005 |
| `dbts_a4` 12bit | 2 | 0.5019 · 0.4867 · 0.4856 · 0.4846 | 0 · +3.0 · +3.3 · +3.5 | 0.544 · 0.555 · 0.556 · 0.558 | 1.046 · 1.042 · 1.041 · 1.042 |
| `dbts_a4` 12bit | 8 | 0.1014 · 0.1017 · 0.1018 · 0.1018 | 0 · -0.4 · -0.4 · -0.4 | 0.924 · 0.922 · 0.922 · 0.922 | 1.025 · 1.024 · 1.024 · 1.024 |
| `dbts_a4` 12bit | 16 | 0.0112 · 0.0071 · 0.0069 · 0.0068 | 0 · +36.3 · +38.0 · +39.6 | 0.996 · 0.997 · 0.998 · 1.000 | 1.007 · 1.004 · 1.005 · 1.006 |
| `dbts_a4` 12bit | 32 | 0.0021 · 0.0006 · 0.0006 · 0.0005 | 0 · +69.6 · +72.5 · +74.9 | 1.004 · 1.005 · 1.007 · 1.010 | 1.006 · 1.006 · 1.008 · 1.010 |
| `dbts_a4` 12bit | 56 | 0.0004 · 0.0001 · 0.0001 · 0.0001 | 0 · +75.6 · +80.5 · +84.2 | 1.013 · 1.013 · 1.015 · 1.019 | 1.014 · 1.014 · 1.015 · 1.019 |
| `dbts_a4` top10 | 2 | 0.4138 · 0.4129 · 0.4128 · 0.4126 | 0 · +0.2 · +0.2 · +0.3 | 0.643 · 0.645 · 0.645 · 0.646 | 1.057 · 1.058 · 1.058 · 1.059 |
| `dbts_a4` top10 | 8 | 0.0946 · 0.0946 · 0.0946 · 0.0947 | 0 · -0.0 · -0.0 · -0.1 | 0.930 · 0.929 · 0.929 · 0.930 | 1.025 · 1.023 · 1.024 · 1.025 |
| `dbts_a4` top10 | 16 | 0.0133 · 0.0089 · 0.0087 · 0.0085 | 0 · +33.0 · +34.5 · +36.0 | 0.993 · 0.995 · 0.995 · 0.996 | 1.007 · 1.004 · 1.004 · 1.004 |
| `dbts_a4` top10 | 32 | 0.0025 · 0.0009 · 0.0008 · 0.0007 | 0 · +65.4 · +68.1 · +70.7 | 1.003 · 1.005 · 1.006 · 1.007 | 1.005 · 1.006 · 1.007 · 1.008 |
| `dbts_a4` top10 | 56 | 0.0005 · 0.0001 · 0.0001 · 0.0001 | 0 · +74.7 · +78.9 · +83.0 | 1.011 · 1.012 · 1.013 · 1.015 | 1.011 · 1.012 · 1.013 · 1.015 |
| `dbts_a4` window | 2 | 0.7552 · 0.7541 · 0.7539 · 0.7537 | 0 · +0.2 · +0.2 · +0.2 | 0.476 · 0.476 · 0.476 · 0.476 | 1.231 · 1.230 · 1.230 · 1.230 |
| `dbts_a4` window | 8 | 0.4455 · 0.4454 · 0.4460 · 0.4467 | 0 · +0.0 · -0.1 · -0.3 | 0.640 · 0.642 · 0.641 · 0.641 | 1.086 · 1.087 · 1.087 · 1.087 |
| `dbts_a4` window | 16 | 0.2942 · 0.2937 · 0.2937 · 0.2938 | 0 · +0.2 · +0.2 · +0.2 | 0.761 · 0.763 · 0.763 · 0.763 | 1.055 · 1.057 · 1.057 · 1.057 |
| `dbts_a4` window | 32 | 0.1081 · 0.1087 · 0.1088 · 0.1088 | 0 · -0.6 · -0.6 · -0.7 | 0.922 · 0.920 · 0.920 · 0.920 | 1.030 · 1.029 · 1.029 · 1.029 |
| `dbts_a4` window | 56 | 0.0024 · 0.0010 · 0.0010 · 0.0010 | 0 · +57.3 · +58.6 · +59.9 | 1.002 · 1.003 · 1.003 · 1.004 | 1.005 · 1.004 · 1.004 · 1.005 |
| `dbts_a5` 12bit | 2 | 0.4893 · 0.4732 · 0.4721 · 0.4709 | 0 · +3.3 · +3.5 · +3.8 | 0.562 · 0.573 · 0.574 · 0.575 | 1.051 · 1.046 · 1.046 · 1.046 |
| `dbts_a5` 12bit | 8 | 0.0902 · 0.0884 · 0.0884 · 0.0883 | 0 · +1.9 · +2.0 · +2.1 | 0.933 · 0.930 · 0.930 · 0.930 | 1.023 · 1.019 · 1.019 · 1.019 |
| `dbts_a5` 12bit | 16 | 0.0150 · 0.0094 · 0.0092 · 0.0089 | 0 · +37.2 · +38.9 · +40.6 | 0.993 · 0.994 · 0.994 · 0.996 | 1.008 · 1.003 · 1.004 · 1.005 |
| `dbts_a5` 12bit | 32 | 0.0035 · 0.0011 · 0.0010 · 0.0009 | 0 · +67.4 · +70.4 · +72.9 | 1.004 · 1.007 · 1.008 · 1.011 | 1.008 · 1.008 · 1.009 · 1.012 |
| `dbts_a5` 12bit | 56 | 0.0007 · 0.0002 · 0.0001 · 0.0001 | 0 · +77.2 · +81.9 · +85.4 | 1.015 · 1.016 · 1.017 · 1.026 | 1.015 · 1.016 · 1.017 · 1.026 |
| `dbts_a5` top10 | 2 | 0.3978 · 0.3969 · 0.3967 · 0.3965 | 0 · +0.2 · +0.3 · +0.3 | 0.663 · 0.664 · 0.665 · 0.666 | 1.061 · 1.061 · 1.061 · 1.063 |
| `dbts_a5` top10 | 8 | 0.0845 · 0.0824 · 0.0822 · 0.0821 | 0 · +2.5 · +2.7 · +2.8 | 0.938 · 0.936 · 0.936 · 0.937 | 1.023 · 1.018 · 1.019 · 1.019 |
| `dbts_a5` top10 | 16 | 0.0170 · 0.0112 · 0.0109 · 0.0106 | 0 · +34.1 · +35.7 · +37.3 | 0.991 · 0.992 · 0.992 · 0.992 | 1.008 · 1.003 · 1.003 · 1.003 |
| `dbts_a5` top10 | 32 | 0.0040 · 0.0015 · 0.0013 · 0.0012 | 0 · +63.4 · +66.5 · +69.3 | 1.004 · 1.007 · 1.008 · 1.009 | 1.008 · 1.008 · 1.009 · 1.010 |
| `dbts_a5` top10 | 56 | 0.0008 · 0.0002 · 0.0002 · 0.0001 | 0 · +76.1 · +79.7 · +83.1 | 1.015 · 1.017 · 1.019 · 1.028 | 1.015 · 1.017 · 1.019 · 1.028 |
| `dbts_a5` window | 2 | 0.6565 · 0.6561 · 0.6559 · 0.6560 | 0 · +0.1 · +0.1 · +0.1 | 0.517 · 0.518 · 0.518 · 0.518 | 1.173 · 1.174 · 1.174 · 1.174 |
| `dbts_a5` window | 8 | 0.3688 · 0.3687 · 0.3688 · 0.3693 | 0 · +0.0 · -0.0 · -0.1 | 0.697 · 0.699 · 0.699 · 0.699 | 1.066 · 1.068 · 1.068 · 1.069 |
| `dbts_a5` window | 16 | 0.2236 · 0.2237 · 0.2236 · 0.2236 | 0 · -0.0 · -0.0 · +0.0 | 0.822 · 0.822 · 0.822 · 0.822 | 1.045 · 1.046 · 1.046 · 1.046 |
| `dbts_a5` window | 32 | 0.0651 · 0.0639 · 0.0639 · 0.0639 | 0 · +1.9 · +1.9 · +1.9 | 0.957 · 0.955 · 0.954 · 0.954 | 1.022 · 1.018 · 1.018 · 1.018 |
| `dbts_a5` window | 56 | 0.0028 · 0.0011 · 0.0010 · 0.0010 | 0 · +60.5 · +63.2 · +65.3 | 1.003 · 1.004 · 1.005 · 1.008 | 1.006 · 1.005 · 1.006 · 1.009 |
| `dbts_c1` 12bit | 2 | 0.4909 · 0.4749 · 0.4738 · 0.4729 | 0 · +3.3 · +3.5 · +3.7 | 0.553 · 0.564 · 0.566 · 0.567 | 1.044 · 1.039 · 1.040 · 1.040 |
| `dbts_c1` 12bit | 8 | 0.0958 · 0.0948 · 0.0947 · 0.0945 | 0 · +1.1 · +1.2 · +1.4 | 0.926 · 0.923 · 0.923 · 0.924 | 1.022 · 1.018 · 1.018 · 1.019 |
| `dbts_c1` 12bit | 16 | 0.0152 · 0.0099 · 0.0096 · 0.0094 | 0 · +34.9 · +37.0 · +38.5 | 0.991 · 0.992 · 0.994 · 0.995 | 1.006 · 1.002 · 1.003 · 1.004 |
| `dbts_c1` 12bit | 32 | 0.0037 · 0.0013 · 0.0012 · 0.0011 | 0 · +65.5 · +68.8 · +71.6 | 1.004 · 1.006 · 1.009 · 1.013 | 1.007 · 1.007 · 1.010 · 1.014 |
| `dbts_c1` 12bit | 56 | 0.0008 · 0.0002 · 0.0002 · 0.0001 | 0 · +75.5 · +79.9 · +83.7 | 1.018 · 1.017 · 1.020 · 1.034 | 1.019 · 1.017 · 1.020 · 1.034 |
| `dbts_c1` top10 | 2 | 0.4011 · 0.4003 · 0.4003 · 0.4002 | 0 · +0.2 · +0.2 · +0.2 | 0.653 · 0.655 · 0.656 · 0.658 | 1.054 · 1.056 · 1.057 · 1.058 |
| `dbts_c1` top10 | 8 | 0.0898 · 0.0883 · 0.0882 · 0.0880 | 0 · +1.7 · +1.8 · +2.0 | 0.931 · 0.929 · 0.930 · 0.932 | 1.021 · 1.017 · 1.018 · 1.020 |
| `dbts_c1` top10 | 16 | 0.0173 · 0.0118 · 0.0115 · 0.0112 | 0 · +32.1 · +33.7 · +35.3 | 0.989 · 0.990 · 0.990 · 0.991 | 1.006 · 1.002 · 1.002 · 1.002 |
| `dbts_c1` top10 | 32 | 0.0043 · 0.0016 · 0.0015 · 0.0014 | 0 · +62.2 · +65.5 · +68.2 | 1.003 · 1.006 · 1.008 · 1.009 | 1.007 · 1.008 · 1.009 · 1.010 |
| `dbts_c1` top10 | 56 | 0.0010 · 0.0003 · 0.0002 · 0.0002 | 0 · +73.6 · +77.6 · +80.9 | 1.016 · 1.017 · 1.022 · 1.035 | 1.017 · 1.017 · 1.023 · 1.035 |
| `dbts_c1` window | 2 | 0.5881 · 0.5889 · 0.5888 · 0.5888 | 0 · -0.1 · -0.1 · -0.1 | 0.580 · 0.581 · 0.581 · 0.581 | 1.168 · 1.170 · 1.170 · 1.170 |
| `dbts_c1` window | 8 | 0.3155 · 0.3162 · 0.3162 · 0.3162 | 0 · -0.2 · -0.2 · -0.2 | 0.752 · 0.753 · 0.753 · 0.753 | 1.067 · 1.069 · 1.069 · 1.069 |
| `dbts_c1` window | 16 | 0.1764 · 0.1774 · 0.1774 · 0.1774 | 0 · -0.5 · -0.6 · -0.5 | 0.865 · 0.865 · 0.865 · 0.865 | 1.041 · 1.042 · 1.042 · 1.042 |
| `dbts_c1` window | 32 | 0.0395 · 0.0380 · 0.0381 · 0.0381 | 0 · +3.7 · +3.6 · +3.6 | 0.976 · 0.974 · 0.974 · 0.974 | 1.016 · 1.012 · 1.012 · 1.012 |
| `dbts_c1` window | 56 | 0.0019 · 0.0007 · 0.0007 · 0.0006 | 0 · +62.3 · +65.3 · +67.4 | 1.005 · 1.005 · 1.005 · 1.009 | 1.007 · 1.006 · 1.006 · 1.010 |
| `dbts_c2` 12bit | 2 | 0.5057 · 0.4938 · 0.4930 · 0.4923 | 0 · +2.3 · +2.5 · +2.7 | 0.543 · 0.554 · 0.555 · 0.557 | 1.049 · 1.048 · 1.048 · 1.049 |
| `dbts_c2` 12bit | 8 | 0.1133 · 0.1129 · 0.1128 · 0.1128 | 0 · +0.3 · +0.4 · +0.4 | 0.915 · 0.913 · 0.913 · 0.915 | 1.028 · 1.026 · 1.026 · 1.027 |
| `dbts_c2` 12bit | 16 | 0.0180 · 0.0127 · 0.0124 · 0.0121 | 0 · +29.7 · +31.0 · +32.9 | 0.991 · 0.992 · 0.993 · 0.995 | 1.009 · 1.005 · 1.005 · 1.008 |
| `dbts_c2` 12bit | 32 | 0.0038 · 0.0013 · 0.0012 · 0.0011 | 0 · +65.5 · +68.4 · +70.7 | 1.003 · 1.005 · 1.007 · 1.011 | 1.007 · 1.007 · 1.008 · 1.012 |
| `dbts_c2` 12bit | 56 | 0.0006 · 0.0001 · 0.0001 · 0.0001 | 0 · +77.6 · +81.4 · +84.8 | 1.012 · 1.013 · 1.015 · 1.018 | 1.012 · 1.013 · 1.015 · 1.018 |
| `dbts_c2` top10 | 2 | 0.4171 · 0.4191 · 0.4191 · 0.4191 | 0 · -0.5 · -0.5 · -0.5 | 0.643 · 0.645 · 0.646 · 0.647 | 1.060 · 1.065 · 1.065 · 1.066 |
| `dbts_c2` top10 | 8 | 0.1066 · 0.1057 · 0.1057 · 0.1056 | 0 · +0.8 · +0.9 · +1.0 | 0.922 · 0.921 · 0.921 · 0.922 | 1.029 · 1.027 · 1.027 · 1.027 |
| `dbts_c2` top10 | 16 | 0.0206 · 0.0150 · 0.0147 · 0.0144 | 0 · +27.5 · +28.7 · +30.1 | 0.990 · 0.991 · 0.991 · 0.993 | 1.011 · 1.006 · 1.006 · 1.007 |
| `dbts_c2` top10 | 32 | 0.0044 · 0.0017 · 0.0016 · 0.0015 | 0 · +61.0 · +63.8 · +66.4 | 1.004 · 1.007 · 1.007 · 1.010 | 1.008 · 1.008 · 1.008 · 1.012 |
| `dbts_c2` top10 | 56 | 0.0008 · 0.0002 · 0.0002 · 0.0001 | 0 · +75.6 · +79.3 · +82.4 | 1.012 · 1.014 · 1.016 · 1.024 | 1.013 · 1.014 · 1.016 · 1.024 |
| `dbts_c2` window | 2 | 0.7251 · 0.7329 · 0.7337 · 0.7339 | 0 · -1.1 · -1.2 · -1.2 | 0.483 · 0.485 · 0.485 · 0.485 | 1.208 · 1.218 · 1.219 · 1.219 |
| `dbts_c2` window | 8 | 0.4258 · 0.4244 · 0.4242 · 0.4240 | 0 · +0.3 · +0.4 · +0.4 | 0.652 · 0.654 · 0.654 · 0.655 | 1.078 · 1.078 · 1.078 · 1.079 |
| `dbts_c2` window | 16 | 0.2812 · 0.2811 · 0.2810 · 0.2811 | 0 · +0.0 · +0.0 · +0.0 | 0.772 · 0.773 · 0.773 · 0.773 | 1.053 · 1.054 · 1.054 · 1.054 |
| `dbts_c2` window | 32 | 0.1109 · 0.1111 · 0.1111 · 0.1110 | 0 · -0.1 · -0.1 · -0.1 | 0.921 · 0.920 · 0.920 · 0.920 | 1.032 · 1.031 · 1.031 · 1.031 |
| `dbts_c2` window | 56 | 0.0040 · 0.0018 · 0.0017 · 0.0016 | 0 · +54.2 · +56.4 · +58.8 | 1.002 · 1.003 · 1.004 · 1.009 | 1.006 · 1.005 · 1.006 · 1.010 |
| `dbts_c3` 12bit | 2 | 0.5031 · 0.4887 · 0.4879 · 0.4872 | 0 · +2.9 · +3.0 · +3.2 | 0.540 · 0.552 · 0.553 · 0.555 | 1.043 · 1.040 · 1.041 · 1.043 |
| `dbts_c3` 12bit | 8 | 0.1110 · 0.1115 · 0.1115 · 0.1115 | 0 · -0.5 · -0.5 · -0.5 | 0.914 · 0.912 · 0.912 · 0.913 | 1.025 · 1.023 · 1.024 · 1.025 |
| `dbts_c3` 12bit | 16 | 0.0169 · 0.0118 · 0.0115 · 0.0113 | 0 · +30.2 · +31.9 · +33.6 | 0.991 · 0.993 · 0.994 · 0.996 | 1.008 · 1.004 · 1.005 · 1.007 |
| `dbts_c3` 12bit | 32 | 0.0036 · 0.0013 · 0.0012 · 0.0011 | 0 · +64.8 · +67.7 · +70.4 | 1.006 · 1.009 · 1.011 · 1.016 | 1.010 · 1.010 · 1.012 · 1.017 |
| `dbts_c3` 12bit | 56 | 0.0007 · 0.0002 · 0.0002 · 0.0001 | 0 · +74.9 · +79.0 · +81.9 | 1.025 · 1.027 · 1.029 · 1.036 | 1.026 · 1.027 · 1.029 · 1.037 |
| `dbts_c3` top10 | 2 | 0.4152 · 0.4154 · 0.4154 · 0.4154 | 0 · -0.0 · -0.0 · -0.0 | 0.638 · 0.640 · 0.641 · 0.642 | 1.053 · 1.056 · 1.057 · 1.058 |
| `dbts_c3` top10 | 8 | 0.1042 · 0.1043 · 0.1043 · 0.1043 | 0 · -0.1 · -0.1 · -0.1 | 0.920 · 0.918 · 0.920 · 0.921 | 1.024 · 1.023 · 1.024 · 1.025 |
| `dbts_c3` top10 | 16 | 0.0196 · 0.0142 · 0.0139 · 0.0136 | 0 · +27.7 · +29.0 · +30.6 | 0.988 · 0.989 · 0.989 · 0.990 | 1.007 · 1.003 · 1.003 · 1.004 |
| `dbts_c3` top10 | 32 | 0.0042 · 0.0016 · 0.0015 · 0.0014 | 0 · +61.0 · +63.9 · +66.9 | 1.003 · 1.006 · 1.006 · 1.008 | 1.007 · 1.007 · 1.008 · 1.010 |
| `dbts_c3` top10 | 56 | 0.0009 · 0.0002 · 0.0002 · 0.0002 | 0 · +73.2 · +77.3 · +80.5 | 1.019 · 1.021 · 1.024 · 1.031 | 1.020 · 1.021 · 1.024 · 1.031 |
| `dbts_c3` window | 2 | 0.6733 · 0.6744 · 0.6744 · 0.6744 | 0 · -0.2 · -0.2 · -0.2 | 0.533 · 0.534 · 0.534 · 0.534 | 1.206 · 1.209 · 1.209 · 1.209 |
| `dbts_c3` window | 8 | 0.3805 · 0.3820 · 0.3820 · 0.3822 | 0 · -0.4 · -0.4 · -0.4 | 0.702 · 0.704 · 0.704 · 0.704 | 1.083 · 1.086 · 1.086 · 1.086 |
| `dbts_c3` window | 16 | 0.2325 · 0.2339 · 0.2340 · 0.2342 | 0 · -0.6 · -0.7 · -0.7 | 0.820 · 0.820 · 0.820 · 0.820 | 1.053 · 1.054 · 1.054 · 1.055 |
| `dbts_c3` window | 32 | 0.0673 · 0.0671 · 0.0671 · 0.0672 | 0 · +0.3 · +0.2 · +0.1 | 0.957 · 0.955 · 0.955 · 0.954 | 1.025 · 1.022 · 1.022 · 1.022 |
| `dbts_c3` window | 56 | 0.0026 · 0.0010 · 0.0010 · 0.0009 | 0 · +60.1 · +62.7 · +65.0 | 1.006 · 1.007 · 1.009 · 1.011 | 1.009 · 1.008 · 1.010 · 1.012 |
| `dbts_c4` 12bit | 2 | 0.5096 · 0.5091 · 0.5087 · 0.5087 | 0 · +0.1 · +0.2 · +0.2 | 0.530 · 0.532 · 0.533 · 0.535 | 1.040 · 1.041 · 1.041 · 1.043 |
| `dbts_c4` 12bit | 8 | 0.1241 · 0.1224 · 0.1222 · 0.1222 | 0 · +1.4 · +1.5 · +1.5 | 0.902 · 0.902 · 0.903 · 0.905 | 1.026 · 1.025 · 1.026 · 1.027 |
| `dbts_c4` 12bit | 16 | 0.0221 · 0.0161 · 0.0156 · 0.0152 | 0 · +27.2 · +29.2 · +30.9 | 0.990 · 0.992 · 0.993 · 0.995 | 1.012 · 1.008 · 1.009 · 1.010 |
| `dbts_c4` 12bit | 32 | 0.0049 · 0.0019 · 0.0017 · 0.0015 | 0 · +62.6 · +65.9 · +68.9 | 1.011 · 1.014 · 1.016 · 1.022 | 1.016 · 1.016 · 1.018 · 1.023 |
| `dbts_c4` 12bit | 56 | 0.0013 · 0.0003 · 0.0003 · 0.0002 | 0 · +75.9 · +80.8 · +83.9 | 1.040 · 1.043 · 1.043 · 1.056 | 1.042 · 1.043 · 1.043 · 1.056 |
| `dbts_c4` top10 | 2 | 0.4231 · 0.4237 · 0.4235 · 0.4233 | 0 · -0.2 · -0.1 · -0.1 | 0.626 · 0.627 · 0.628 · 0.630 | 1.049 · 1.051 · 1.052 · 1.053 |
| `dbts_c4` top10 | 8 | 0.1172 · 0.1153 · 0.1151 · 0.1151 | 0 · +1.6 · +1.7 · +1.8 | 0.907 · 0.909 · 0.910 · 0.912 | 1.025 · 1.024 · 1.025 · 1.027 |
| `dbts_c4` top10 | 16 | 0.0252 · 0.0195 · 0.0191 · 0.0188 | 0 · +22.7 · +24.1 · +25.2 | 0.985 · 0.986 · 0.987 · 0.987 | 1.011 · 1.005 · 1.006 · 1.006 |
| `dbts_c4` top10 | 32 | 0.0057 · 0.0023 · 0.0021 · 0.0019 | 0 · +59.2 · +62.7 · +65.8 | 1.007 · 1.010 · 1.012 · 1.013 | 1.013 · 1.012 · 1.014 · 1.015 |
| `dbts_c4` top10 | 56 | 0.0015 · 0.0004 · 0.0003 · 0.0003 | 0 · +73.9 · +79.0 · +82.8 | 1.037 · 1.039 · 1.039 · 1.052 | 1.039 · 1.039 · 1.039 · 1.052 |
| `dbts_c4` window | 2 | 0.7441 · 0.7433 · 0.7432 · 0.7431 | 0 · +0.1 · +0.1 · +0.1 | 0.478 · 0.478 · 0.478 · 0.478 | 1.222 · 1.221 · 1.221 · 1.221 |
| `dbts_c4` window | 8 | 0.4422 · 0.4464 · 0.4465 · 0.4466 | 0 · -0.9 · -1.0 · -1.0 | 0.644 · 0.639 · 0.639 · 0.639 | 1.086 · 1.086 · 1.085 · 1.085 |
| `dbts_c4` window | 16 | 0.2986 · 0.3032 · 0.3039 · 0.3045 | 0 · -1.6 · -1.8 · -2.0 | 0.761 · 0.758 · 0.757 · 0.757 | 1.060 · 1.061 · 1.061 · 1.061 |
| `dbts_c4` window | 32 | 0.1256 · 0.1263 · 0.1264 · 0.1265 | 0 · -0.5 · -0.6 · -0.7 | 0.912 · 0.910 · 0.910 · 0.909 | 1.037 · 1.036 · 1.036 · 1.036 |
| `dbts_c4` window | 56 | 0.0048 · 0.0022 · 0.0021 · 0.0020 | 0 · +53.5 · +56.3 · +58.8 | 1.006 · 1.007 · 1.008 · 1.011 | 1.011 · 1.009 · 1.010 · 1.013 |
| `dbts_c5` 12bit | 2 | 0.4954 · 0.4810 · 0.4800 · 0.4792 | 0 · +2.9 · +3.1 · +3.3 | 0.551 · 0.563 · 0.565 · 0.566 | 1.046 · 1.044 · 1.045 · 1.046 |
| `dbts_c5` 12bit | 8 | 0.0965 · 0.0963 · 0.0964 · 0.0964 | 0 · +0.2 · +0.1 · +0.1 | 0.927 · 0.924 · 0.925 · 0.924 | 1.023 · 1.020 · 1.021 · 1.021 |
| `dbts_c5` 12bit | 16 | 0.0139 · 0.0090 · 0.0087 · 0.0085 | 0 · +34.9 · +36.9 · +38.5 | 0.992 · 0.993 · 0.994 · 0.994 | 1.005 · 1.002 · 1.002 · 1.003 |
| `dbts_c5` 12bit | 32 | 0.0031 · 0.0010 · 0.0009 · 0.0008 | 0 · +67.3 · +70.9 · +73.5 | 1.002 · 1.005 · 1.006 · 1.011 | 1.005 · 1.006 · 1.007 · 1.011 |
| `dbts_c5` 12bit | 56 | 0.0006 · 0.0002 · 0.0001 · 0.0001 | 0 · +74.8 · +80.4 · +83.8 | 1.012 · 1.013 · 1.014 · 1.024 | 1.013 · 1.013 · 1.015 · 1.024 |
| `dbts_c5` top10 | 2 | 0.4055 · 0.4058 · 0.4057 · 0.4057 | 0 · -0.1 · -0.1 · -0.1 | 0.651 · 0.654 · 0.655 · 0.656 | 1.057 · 1.060 · 1.060 · 1.062 |
| `dbts_c5` top10 | 8 | 0.0903 · 0.0898 · 0.0897 · 0.0896 | 0 · +0.5 · +0.6 · +0.7 | 0.933 · 0.931 · 0.932 · 0.931 | 1.023 · 1.021 · 1.021 · 1.021 |
| `dbts_c5` top10 | 16 | 0.0160 · 0.0109 · 0.0106 · 0.0104 | 0 · +31.8 · +33.7 · +35.3 | 0.991 · 0.991 · 0.992 · 0.992 | 1.007 · 1.002 · 1.002 · 1.002 |
| `dbts_c5` top10 | 32 | 0.0036 · 0.0013 · 0.0012 · 0.0011 | 0 · +63.4 · +67.0 · +69.8 | 1.002 · 1.004 · 1.006 · 1.008 | 1.006 · 1.006 · 1.007 · 1.009 |
| `dbts_c5` top10 | 56 | 0.0008 · 0.0002 · 0.0002 · 0.0001 | 0 · +74.3 · +79.0 · +81.9 | 1.012 · 1.012 · 1.016 · 1.031 | 1.013 · 1.013 · 1.016 · 1.031 |
| `dbts_c5` window | 2 | 0.6485 · 0.6497 · 0.6495 · 0.6491 | 0 · -0.2 · -0.1 · -0.1 | 0.573 · 0.574 · 0.574 · 0.574 | 1.222 · 1.224 · 1.224 · 1.223 |
| `dbts_c5` window | 8 | 0.3683 · 0.3699 · 0.3694 · 0.3683 | 0 · -0.5 · -0.3 · +0.0 | 0.717 · 0.718 · 0.719 · 0.719 | 1.085 · 1.088 · 1.088 · 1.087 |
| `dbts_c5` window | 16 | 0.2282 · 0.2297 · 0.2299 · 0.2298 | 0 · -0.7 · -0.7 · -0.7 | 0.822 · 0.823 · 0.823 · 0.823 | 1.050 · 1.053 · 1.053 · 1.053 |
| `dbts_c5` window | 32 | 0.0716 · 0.0719 · 0.0719 · 0.0720 | 0 · -0.4 · -0.5 · -0.5 | 0.952 · 0.950 · 0.949 · 0.949 | 1.023 · 1.021 · 1.021 · 1.021 |
| `dbts_c5` window | 56 | 0.0023 · 0.0010 · 0.0009 · 0.0009 | 0 · +57.4 · +59.9 · +61.4 | 1.003 · 1.003 · 1.004 · 1.008 | 1.005 · 1.004 · 1.005 · 1.009 |

#### Quality, DBT-12 (systems A, C)

Each cell: G = 1 · 8 · 16 · whole; against the source at its depth b.

| series, form | Q | PSNR / in-window PSNR, dB | SSIM mean | SSIM min frame | max \|Δ\| | 1st window: % differ / % > 1 / max Δcode |
| --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` 12bit | 2 | 65.83/64.12 · 65.38/63.67 · 65.35/63.64 · 65.32/63.62 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 25 · 69 · 75 · 69 | 46.1/4.5/5 · 47.4/5.4/5 · 47.5/5.5/5 · 47.6/5.6/5 |
| `dbts_a1` 12bit | 8 | 50.08/48.35 · 50.23/48.50 · 50.23/48.51 · 50.24/48.51 | 0.9902 · 0.9906 · 0.9906 · 0.9906 | 0.9899 · 0.9899 · 0.9899 · 0.9900 | 242 · 246 · 255 · 210 | 88.1/66.8/33 · 87.9/66.3/33 · 87.9/66.3/32 · 87.9/66.2/35 |
| `dbts_a1` 12bit | 16 | 46.65/44.95 · 46.64/44.94 · 46.64/44.94 · 46.64/44.94 | 0.9797 · 0.9799 · 0.9799 · 0.9800 | 0.9786 · 0.9786 · 0.9788 · 0.9788 | 389 · 380 · 380 · 289 | 91.7/76.4/82 · 91.7/76.4/61 · 91.7/76.4/74 · 91.7/76.4/69 |
| `dbts_a1` 12bit | 32 | 44.91/43.33 · 44.64/43.06 · 44.60/43.02 · 44.55/42.97 | 0.9756 · 0.9756 · 0.9755 · 0.9754 | 0.9742 · 0.9743 · 0.9741 · 0.9741 | 717 · 556 · 556 · 512 | 93.1/80.2/124 · 93.3/80.7/129 · 93.3/80.8/129 · 93.4/80.9/130 |
| `dbts_a1` 12bit | 56 | 39.54/38.60 · 39.14/38.06 · 38.81/37.67 · 38.47/37.23 | 0.9487 · 0.9511 · 0.9507 · 0.9508 | 0.9324 · 0.9450 · 0.9450 · 0.9470 | 1631 · 1619 · 1542 · 1542 | 95.7/87.3/204 · 95.9/87.9/193 · 96.0/88.3/203 · 96.3/89.0/188 |
| `dbts_a1` top10 | 2 | 61.49/59.77 · 61.43/59.72 · 61.42/59.71 · 61.42/59.71 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 33 · 112 · 75 · 82 | 61.6/17.9/8 · 61.7/18.1/8 · 61.8/18.1/8 · 61.8/18.1/8 |
| `dbts_a1` top10 | 8 | 49.81/48.08 · 49.93/48.20 · 49.94/48.21 · 49.94/48.22 | 0.9897 · 0.9900 · 0.9900 · 0.9900 | 0.9894 · 0.9894 · 0.9894 · 0.9895 | 242 · 230 · 200 · 203 | 88.4/67.8/37 · 88.3/67.3/32 · 88.3/67.3/32 · 88.3/67.3/38 |
| `dbts_a1` top10 | 16 | 46.75/45.04 · 46.76/45.05 · 46.76/45.05 · 46.76/45.06 | 0.9803 · 0.9804 · 0.9805 · 0.9805 | 0.9793 · 0.9794 · 0.9794 · 0.9794 | 377 · 377 · 377 · 308 | 91.6/76.2/58 · 91.6/76.2/61 · 91.6/76.2/57 · 91.6/76.1/72 |
| `dbts_a1` top10 | 32 | 45.18/43.55 · 45.05/43.42 · 45.02/43.40 · 44.99/43.37 | 0.9768 · 0.9768 · 0.9767 · 0.9767 | 0.9754 · 0.9755 · 0.9755 · 0.9754 | 640 · 464 · 507 · 535 | 93.0/79.8/94 · 93.0/80.1/126 · 93.1/80.1/126 · 93.1/80.1/126 |
| `dbts_a1` top10 | 56 | 40.79/39.62 · 40.51/39.29 · 40.36/39.12 · 40.17/38.88 | 0.9582 · 0.9597 · 0.9598 · 0.9620 | 0.9515 · 0.9515 · 0.9515 · 0.9576 | 1641 · 1466 · 1466 · 1360 | 95.2/86.1/213 · 95.4/86.5/175 · 95.5/86.7/176 · 95.6/87.0/191 |
| `dbts_a1` window | 2 | 12.94/39.93 · 12.94/39.93 · 12.94/39.93 · 12.94/39.93 | 0.6643 · 0.6643 · 0.6643 · 0.6643 | 0.5759 · 0.5759 · 0.5759 · 0.5759 | 1602 · 1602 · 1602 · 1602 | 23.7/9.6/30 · 24.0/9.6/30 · 24.0/9.6/30 · 24.0/9.6/30 |
| `dbts_a1` window | 8 | 12.94/39.91 · 12.94/39.91 · 12.94/39.91 · 12.94/39.91 | 0.6639 · 0.6639 · 0.6639 · 0.6639 | 0.5756 · 0.5756 · 0.5756 · 0.5756 | 1610 · 1605 · 1606 · 1605 | 58.6/17.4/31 · 59.0/17.6/31 · 59.0/17.6/31 · 59.0/17.6/31 |
| `dbts_a1` window | 16 | 12.94/39.82 · 12.94/39.82 · 12.94/39.82 · 12.94/39.81 | 0.6626 · 0.6626 · 0.6626 · 0.6626 | 0.5744 · 0.5744 · 0.5744 · 0.5744 | 1613 · 1610 · 1610 · 1616 | 79.0/44.6/33 · 79.1/44.9/32 · 79.1/44.9/32 · 79.1/44.9/32 |
| `dbts_a1` window | 32 | 12.93/39.34 · 12.93/39.36 · 12.93/39.36 · 12.93/39.36 | 0.6547 · 0.6551 · 0.6551 · 0.6551 | 0.5670 · 0.5674 · 0.5674 · 0.5674 | 1621 · 1623 · 1623 · 1623 | 90.8/73.3/53 · 90.7/72.9/33 · 90.7/72.9/34 · 90.7/72.8/34 |
| `dbts_a1` window | 56 | 12.93/38.41 · 12.93/38.42 · 12.93/38.42 · 12.93/38.41 | 0.6438 · 0.6437 · 0.6437 · 0.6436 | 0.5576 · 0.5575 · 0.5575 · 0.5574 | 1660 · 1692 · 1646 · 1672 | 94.3/83.1/106 · 94.3/83.1/126 · 94.3/83.1/126 · 94.3/83.2/122 |
| `dbts_a2` 12bit | 2 | 66.31/64.11 · 65.86/63.67 · 65.83/63.65 · 65.80/63.62 | 0.9998 · 0.9997 · 0.9997 · 0.9997 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 41 · 105 · 105 · 85 | 40.9/3.1/5 · 42.2/3.8/5 · 42.3/3.8/5 · 42.4/3.9/5 |
| `dbts_a2` 12bit | 8 | 50.52/48.31 · 50.64/48.43 · 50.64/48.43 · 50.65/48.44 | 0.9912 · 0.9916 · 0.9916 · 0.9916 | 0.9905 · 0.9906 · 0.9906 · 0.9906 | 264 · 264 · 206 · 214 | 85.6/61.0/35 · 85.5/60.6/31 · 85.5/60.6/31 · 85.5/60.5/31 |
| `dbts_a2` 12bit | 16 | 46.49/44.30 · 46.49/44.31 · 46.49/44.31 · 46.49/44.31 | 0.9789 · 0.9792 · 0.9793 · 0.9793 | 0.9768 · 0.9771 · 0.9771 · 0.9771 | 392 · 356 · 356 · 391 | 90.2/72.6/58 · 90.2/72.6/64 · 90.2/72.6/63 · 90.2/72.6/89 |
| `dbts_a2` 12bit | 32 | 44.64/42.59 · 44.41/42.35 · 44.37/42.32 · 44.31/42.26 | 0.9741 · 0.9743 · 0.9743 · 0.9741 | 0.9712 · 0.9716 · 0.9716 · 0.9716 | 999 · 686 · 689 · 640 | 92.0/77.3/122 · 92.3/77.8/144 · 92.3/77.9/143 · 92.3/78.0/142 |
| `dbts_a2` 12bit | 56 | 39.65/38.45 · 39.45/38.16 · 39.18/37.89 · 38.49/37.14 | 0.9521 · 0.9530 · 0.9526 · 0.9463 | 0.9332 · 0.9448 · 0.9478 · 0.9439 | 2201 · 2101 · 2101 · 2007 | 94.7/84.2/202 · 94.8/84.7/215 · 95.0/85.1/219 · 95.3/86.1/219 |
| `dbts_a2` top10 | 2 | 61.97/59.77 · 61.90/59.70 · 61.89/59.70 · 61.88/59.69 | 0.9994 · 0.9994 · 0.9994 · 0.9994 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 53 · 110 · 99 · 99 | 56.4/13.5/8 · 56.6/13.7/8 · 56.6/13.7/8 · 56.6/13.7/8 |
| `dbts_a2` top10 | 8 | 50.22/48.01 · 50.32/48.11 · 50.33/48.12 · 50.33/48.12 | 0.9908 · 0.9910 · 0.9910 · 0.9910 | 0.9901 · 0.9901 · 0.9901 · 0.9902 | 262 · 262 · 203 · 213 | 86.0/62.1/31 · 85.9/61.8/32 · 85.9/61.7/33 · 85.9/61.7/35 |
| `dbts_a2` top10 | 16 | 46.63/44.44 · 46.64/44.45 · 46.64/44.46 · 46.64/44.46 | 0.9797 · 0.9800 · 0.9800 · 0.9800 | 0.9779 · 0.9780 · 0.9780 · 0.9780 | 455 · 355 · 404 · 383 | 90.1/72.3/56 · 90.1/72.3/62 · 90.1/72.3/63 · 90.0/72.3/72 |
| `dbts_a2` top10 | 32 | 44.92/42.82 · 44.79/42.70 · 44.77/42.68 · 44.74/42.66 | 0.9752 · 0.9752 · 0.9752 · 0.9752 | 0.9723 · 0.9724 · 0.9726 · 0.9726 | 992 · 608 · 474 · 478 | 91.8/76.7/91 · 91.9/77.0/96 · 91.9/77.1/112 · 92.0/77.1/124 |
| `dbts_a2` top10 | 56 | 40.89/39.51 · 40.72/39.29 · 40.55/39.11 · 40.28/38.75 | 0.9530 · 0.9543 · 0.9543 · 0.9568 | 0.9424 · 0.9502 · 0.9502 · 0.9511 | 2076 · 1888 · 1869 · 1488 | 94.2/82.9/194 · 94.3/83.3/205 · 94.4/83.5/208 · 94.6/84.0/204 |
| `dbts_a2` window | 2 | 9.17/37.79 · 9.17/37.79 · 9.17/37.79 · 9.17/37.79 | 0.5902 · 0.5902 · 0.5902 · 0.5902 | 0.4516 · 0.4516 · 0.4516 · 0.4516 | 2244 · 2245 · 2246 · 2245 | 31.8/18.8/30 · 31.9/18.7/30 · 31.9/18.7/30 · 31.9/18.7/30 |
| `dbts_a2` window | 8 | 9.17/37.77 · 9.17/37.77 · 9.17/37.77 · 9.17/37.77 | 0.5898 · 0.5898 · 0.5898 · 0.5898 | 0.4514 · 0.4513 · 0.4513 · 0.4514 | 2252 · 2254 · 2249 · 2249 | 61.6/25.0/31 · 61.8/25.0/31 · 61.9/25.0/31 · 61.9/25.0/31 |
| `dbts_a2` window | 16 | 9.17/37.71 · 9.17/37.71 · 9.17/37.71 · 9.17/37.71 | 0.5886 · 0.5886 · 0.5886 · 0.5886 | 0.4504 · 0.4504 · 0.4504 · 0.4504 | 2256 · 2253 · 2256 · 2252 | 80.0/47.9/34 · 80.2/48.1/33 · 80.2/48.2/33 · 80.2/48.2/32 |
| `dbts_a2` window | 32 | 9.17/37.40 · 9.17/37.41 · 9.17/37.42 · 9.17/37.42 | 0.5817 · 0.5820 · 0.5820 · 0.5820 | 0.4442 · 0.4445 · 0.4445 · 0.4445 | 2275 · 2275 · 2275 · 2271 | 91.0/74.0/48 · 90.9/73.7/45 · 90.9/73.6/45 · 90.9/73.6/42 |
| `dbts_a2` window | 56 | 9.16/36.66 · 9.16/36.66 · 9.16/36.65 · 9.16/36.66 | 0.5692 · 0.5691 · 0.5690 · 0.5690 | 0.4335 · 0.4334 · 0.4334 · 0.4333 | 2298 · 2315 · 2298 · 2321 | 94.5/83.6/137 · 94.5/83.7/136 · 94.5/83.7/117 · 94.5/83.7/98 |
| `dbts_a3` 12bit | 2 | 65.71/64.15 · 65.70/64.14 · 65.70/64.14 · 65.71/64.16 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 25 · 65 · 65 · 81 | 46.6/5.4/6 · 46.6/5.5/5 · 46.6/5.5/6 · 46.6/5.4/5 |
| `dbts_a3` 12bit | 8 | 49.62/48.06 · 49.74/48.16 · 49.74/48.17 · 49.75/48.18 | 0.9891 · 0.9896 · 0.9896 · 0.9897 | 0.9889 · 0.9890 · 0.9891 · 0.9891 | 180 · 207 · 205 · 242 | 88.4/68.0/36 · 88.3/67.6/35 · 88.3/67.6/35 · 88.3/67.5/34 |
| `dbts_a3` 12bit | 16 | 45.46/43.90 · 45.42/43.87 · 45.42/43.87 · 45.41/43.86 | 0.9729 · 0.9731 · 0.9732 · 0.9732 | 0.9718 · 0.9720 · 0.9720 · 0.9720 | 431 · 309 · 263 · 340 | 92.4/78.6/84 · 92.4/78.7/84 · 92.4/78.7/89 · 92.4/78.7/89 |
| `dbts_a3` 12bit | 32 | 43.81/42.38 · 43.54/42.11 · 43.49/42.05 · 43.42/41.99 | 0.9673 · 0.9675 · 0.9675 · 0.9675 | 0.9651 · 0.9657 · 0.9657 · 0.9658 | 631 · 577 · 577 · 601 | 93.7/81.9/182 · 93.8/82.3/151 · 93.9/82.4/151 · 93.9/82.5/148 |
| `dbts_a3` 12bit | 56 | 39.13/38.33 · 38.98/38.16 · 38.83/37.97 · 38.47/37.57 | 0.9435 · 0.9462 · 0.9483 · 0.9481 | 0.9240 · 0.9400 · 0.9453 · 0.9441 | 1522 · 1559 · 1536 · 1614 | 95.8/87.5/213 · 95.8/87.6/224 · 95.9/87.8/217 · 96.1/88.3/219 |
| `dbts_a3` top10 | 2 | 61.40/59.83 · 61.41/59.85 · 61.41/59.85 · 61.41/59.85 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 39 · 84 · 95 · 88 | 61.0/18.5/8 · 60.9/18.4/9 · 60.9/18.4/8 · 60.9/18.4/8 |
| `dbts_a3` top10 | 8 | 49.32/47.74 · 49.40/47.83 · 49.40/47.83 · 49.41/47.84 | 0.9886 · 0.9888 · 0.9888 · 0.9889 | 0.9884 · 0.9884 · 0.9885 · 0.9885 | 176 · 216 · 256 · 199 | 88.8/69.0/37 · 88.7/68.7/40 · 88.7/68.7/37 · 88.7/68.6/37 |
| `dbts_a3` top10 | 16 | 45.58/44.02 · 45.53/43.97 · 45.53/43.97 · 45.53/43.97 | 0.9738 · 0.9738 · 0.9738 · 0.9738 | 0.9727 · 0.9727 · 0.9727 · 0.9727 | 431 · 264 · 254 · 302 | 92.3/78.4/80 · 92.4/78.5/80 · 92.4/78.5/87 · 92.4/78.5/87 |
| `dbts_a3` top10 | 32 | 44.05/42.57 · 43.87/42.41 · 43.84/42.37 · 43.80/42.33 | 0.9687 · 0.9686 · 0.9685 · 0.9685 | 0.9672 · 0.9670 · 0.9670 · 0.9671 | 554 · 543 · 543 · 543 | 93.5/81.5/178 · 93.6/81.8/125 · 93.7/81.9/125 · 93.7/82.0/125 |
| `dbts_a3` top10 | 56 | 40.32/39.34 · 40.07/39.07 · 39.93/38.92 · 39.75/38.71 | 0.9476 · 0.9481 · 0.9488 · 0.9507 | 0.9412 · 0.9418 · 0.9418 · 0.9467 | 1433 · 1401 · 1371 · 1371 | 95.4/86.5/221 · 95.5/86.8/222 · 95.6/86.9/217 · 95.6/87.2/219 |
| `dbts_a3` window | 2 | 13.21/39.12 · 13.21/39.12 · 13.21/39.12 · 13.21/39.12 | 0.6833 · 0.6833 · 0.6833 · 0.6833 | 0.6391 · 0.6391 · 0.6391 · 0.6391 | 1611 · 1611 · 1610 · 1611 | 30.9/19.6/30 · 30.9/19.5/30 · 30.9/19.5/30 · 30.9/19.5/30 |
| `dbts_a3` window | 8 | 13.21/39.09 · 13.21/39.10 · 13.21/39.10 · 13.21/39.10 | 0.6831 · 0.6831 · 0.6831 · 0.6831 | 0.6388 · 0.6388 · 0.6389 · 0.6389 | 1617 · 1617 · 1614 · 1611 | 61.5/25.2/30 · 61.1/24.8/31 · 61.1/24.7/30 · 61.1/24.6/30 |
| `dbts_a3` window | 16 | 13.21/39.03 · 13.21/39.03 · 13.21/39.03 · 13.21/39.03 | 0.6820 · 0.6820 · 0.6820 · 0.6820 | 0.6379 · 0.6378 · 0.6378 · 0.6378 | 1617 · 1617 · 1617 · 1615 | 80.2/48.4/32 · 80.4/48.8/32 · 80.4/48.8/32 · 80.4/48.8/32 |
| `dbts_a3` window | 32 | 13.21/38.69 · 13.21/38.70 · 13.21/38.70 · 13.21/38.70 | 0.6755 · 0.6756 · 0.6757 · 0.6757 | 0.6313 · 0.6314 · 0.6314 · 0.6313 | 1630 · 1622 · 1622 · 1624 | 91.9/76.4/44 · 91.8/76.3/43 · 91.8/76.3/40 · 91.8/76.3/43 |
| `dbts_a3` window | 56 | 13.20/37.68 · 13.20/37.66 · 13.20/37.66 · 13.20/37.66 | 0.6575 · 0.6574 · 0.6574 · 0.6574 | 0.6150 · 0.6149 · 0.6148 · 0.6148 | 1646 · 1641 · 1646 · 1658 | 95.6/87.0/182 · 95.6/87.1/123 · 95.6/87.1/124 · 95.6/87.1/106 |
| `dbts_a4` 12bit | 2 | 65.48/64.15 · 65.03/63.71 · 65.00/63.68 · 64.97/63.66 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 31 · 87 · 70 · 88 | 48.7/6.2/6 · 50.0/7.3/6 · 50.1/7.3/6 · 50.2/7.4/6 |
| `dbts_a4` 12bit | 8 | 49.32/47.98 · 49.42/48.09 · 49.43/48.09 · 49.43/48.10 | 0.9885 · 0.9888 · 0.9889 · 0.9889 | 0.9881 · 0.9882 · 0.9882 · 0.9882 | 296 · 160 · 185 · 252 | 89.5/70.6/39 · 89.4/70.2/37 · 89.4/70.2/39 · 89.4/70.2/39 |
| `dbts_a4` 12bit | 16 | 44.94/43.61 · 44.92/43.60 · 44.92/43.60 · 44.92/43.60 | 0.9694 · 0.9695 · 0.9695 · 0.9696 | 0.9671 · 0.9671 · 0.9671 · 0.9671 | 340 · 375 · 389 · 339 | 93.4/81.0/72 · 93.4/81.1/71 · 93.4/81.1/72 · 93.4/81.1/70 |
| `dbts_a4` 12bit | 32 | 43.53/42.29 · 43.33/42.10 · 43.28/42.05 · 43.22/42.01 | 0.9643 · 0.9641 · 0.9641 · 0.9639 | 0.9614 · 0.9613 · 0.9613 · 0.9613 | 633 · 652 · 599 · 568 | 94.3/83.7/125 · 94.5/84.0/124 · 94.5/84.1/127 · 94.5/84.2/123 |
| `dbts_a4` 12bit | 56 | 39.64/39.10 · 39.48/38.87 · 39.27/38.65 · 39.00/38.31 | 0.9413 · 0.9416 · 0.9404 · 0.9325 | 0.9320 · 0.9324 · 0.9333 · 0.9306 | 2157 · 1836 · 1823 · 1753 | 95.9/88.0/245 · 96.0/88.3/226 · 96.1/88.6/210 · 96.3/89.0/213 |
| `dbts_a4` top10 | 2 | 61.14/59.81 · 61.07/59.75 · 61.07/59.74 · 61.06/59.73 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 0.9992 · 0.9992 · 0.9992 · 0.9992 | 42 · 70 · 94 · 78 | 63.3/20.5/9 · 63.5/20.8/9 · 63.5/20.8/9 · 63.5/20.8/9 |
| `dbts_a4` top10 | 8 | 48.99/47.65 · 49.08/47.74 · 49.08/47.75 · 49.08/47.75 | 0.9877 · 0.9880 · 0.9880 · 0.9880 | 0.9872 · 0.9873 · 0.9873 · 0.9873 | 297 · 151 · 200 · 182 | 89.9/71.6/39 · 89.8/71.3/40 · 89.8/71.3/40 · 89.8/71.3/42 |
| `dbts_a4` top10 | 16 | 45.09/43.76 · 45.05/43.73 · 45.05/43.73 · 45.05/43.73 | 0.9705 · 0.9705 · 0.9705 · 0.9705 | 0.9684 · 0.9681 · 0.9681 · 0.9681 | 307 · 333 · 304 · 312 | 93.2/80.8/75 · 93.3/80.9/75 · 93.3/80.9/67 · 93.3/80.9/66 |
| `dbts_a4` top10 | 32 | 43.72/42.45 · 43.60/42.34 · 43.58/42.32 · 43.55/42.30 | 0.9654 · 0.9654 · 0.9653 · 0.9653 | 0.9623 · 0.9622 · 0.9622 · 0.9622 | 736 · 545 · 758 · 710 | 94.2/83.4/124 · 94.3/83.6/125 · 94.3/83.7/126 · 94.3/83.7/125 |
| `dbts_a4` top10 | 56 | 40.72/39.94 · 40.59/39.77 · 40.49/39.66 · 40.33/39.48 | 0.9522 · 0.9521 · 0.9521 · 0.9532 | 0.9466 · 0.9476 · 0.9473 · 0.9506 | 1915 · 1831 · 1831 · 1755 | 95.6/87.0/229 · 95.6/87.2/222 · 95.7/87.3/180 · 95.7/87.5/201 |
| `dbts_a4` window | 2 | 11.94/41.62 · 11.94/41.63 · 11.94/41.63 · 11.94/41.63 | 0.7271 · 0.7272 · 0.7272 · 0.7272 | 0.6453 · 0.6453 · 0.6453 · 0.6453 | 2004 · 2004 · 2003 · 2004 | 24.3/11.9/30 · 24.4/11.8/30 · 24.5/11.8/30 · 24.5/11.8/30 |
| `dbts_a4` window | 8 | 11.94/41.58 · 11.94/41.59 · 11.94/41.59 · 11.94/41.59 | 0.7268 · 0.7269 · 0.7269 · 0.7269 | 0.6451 · 0.6451 · 0.6451 · 0.6451 | 2011 · 2009 · 2009 · 2009 | 57.6/18.3/31 · 58.0/18.3/31 · 57.9/18.2/31 · 57.9/18.1/31 |
| `dbts_a4` window | 16 | 11.94/41.48 · 11.94/41.48 · 11.94/41.48 · 11.94/41.48 | 0.7257 · 0.7257 · 0.7257 · 0.7257 | 0.6441 · 0.6441 · 0.6441 · 0.6441 | 2026 · 2015 · 2015 · 2012 | 78.1/43.2/35 · 78.3/43.8/32 · 78.4/43.8/32 · 78.4/43.8/32 |
| `dbts_a4` window | 32 | 11.94/40.86 · 11.94/40.87 · 11.94/40.87 · 11.94/40.88 | 0.7181 · 0.7183 · 0.7183 · 0.7183 | 0.6371 · 0.6372 · 0.6372 · 0.6372 | 2034 · 2029 · 2030 · 2023 | 91.2/74.4/54 · 91.1/74.2/47 · 91.1/74.1/49 · 91.1/74.1/41 |
| `dbts_a4` window | 56 | 11.93/39.19 · 11.93/39.18 · 11.93/39.18 · 11.93/39.17 | 0.6963 · 0.6962 · 0.6962 · 0.6961 | 0.6179 · 0.6179 · 0.6179 · 0.6179 | 2058 · 2058 · 2058 · 2050 | 95.3/86.1/124 · 95.3/86.2/126 · 95.3/86.2/126 · 95.3/86.2/121 |
| `dbts_a5` 12bit | 2 | 66.25/64.11 · 65.82/63.67 · 65.79/63.64 · 65.76/63.61 | 0.9998 · 0.9997 · 0.9997 · 0.9997 | 0.9998 · 0.9997 · 0.9997 · 0.9997 | 38 · 91 · 76 · 87 | 42.9/3.6/5 · 44.2/4.4/5 · 44.3/4.5/5 · 44.4/4.5/5 |
| `dbts_a5` 12bit | 8 | 50.55/48.39 · 50.67/48.51 · 50.68/48.52 · 50.68/48.53 | 0.9913 · 0.9917 · 0.9918 · 0.9918 | 0.9910 · 0.9911 · 0.9911 · 0.9911 | 232 · 180 · 220 · 232 | 86.2/62.5/31 · 86.0/62.0/34 · 86.0/62.0/34 · 86.0/62.0/51 |
| `dbts_a5` 12bit | 16 | 46.48/44.35 · 46.48/44.35 · 46.48/44.35 · 46.48/44.35 | 0.9790 · 0.9793 · 0.9794 · 0.9794 | 0.9774 · 0.9775 · 0.9775 · 0.9775 | 518 · 518 · 426 · 373 | 90.6/73.9/59 · 90.6/73.9/72 · 90.6/73.9/70 · 90.6/73.9/75 |
| `dbts_a5` 12bit | 32 | 44.46/42.46 · 44.18/42.18 · 44.14/42.14 · 44.07/42.08 | 0.9730 · 0.9733 · 0.9734 · 0.9733 | 0.9703 · 0.9707 · 0.9714 · 0.9716 | 1074 · 692 · 692 · 604 | 92.6/78.8/99 · 92.8/79.3/87 · 92.8/79.4/94 · 92.9/79.6/85 |
| `dbts_a5` 12bit | 56 | 39.29/37.98 · 39.06/37.68 · 38.69/37.30 · 38.19/36.75 | 0.9474 · 0.9495 · 0.9453 · 0.9464 | 0.9160 · 0.9351 · 0.9351 · 0.9443 | 2107 · 2074 · 2073 · 1706 | 95.3/86.1/206 · 95.4/86.5/217 · 95.5/86.9/216 · 95.7/87.5/182 |
| `dbts_a5` top10 | 2 | 61.93/59.77 · 61.87/59.72 · 61.86/59.71 · 61.85/59.71 | 0.9994 · 0.9994 · 0.9994 · 0.9994 | 0.9994 · 0.9994 · 0.9994 · 0.9994 | 43 · 121 · 121 · 95 | 58.5/15.7/7 · 58.6/15.8/8 · 58.7/15.9/8 · 58.7/15.9/8 |
| `dbts_a5` top10 | 8 | 50.26/48.09 · 50.36/48.19 · 50.36/48.20 · 50.36/48.20 | 0.9909 · 0.9912 · 0.9912 · 0.9912 | 0.9906 · 0.9907 · 0.9907 · 0.9907 | 225 · 215 · 219 · 226 | 86.6/63.6/33 · 86.5/63.2/33 · 86.5/63.2/33 · 86.5/63.2/34 |
| `dbts_a5` top10 | 16 | 46.63/44.49 · 46.64/44.50 · 46.64/44.50 · 46.64/44.50 | 0.9800 · 0.9801 · 0.9802 · 0.9802 | 0.9787 · 0.9787 · 0.9787 · 0.9787 | 462 · 422 · 422 · 341 | 90.5/73.6/58 · 90.5/73.6/71 · 90.5/73.6/60 · 90.5/73.6/71 |
| `dbts_a5` top10 | 32 | 44.74/42.69 · 44.60/42.55 · 44.57/42.52 · 44.52/42.49 | 0.9745 · 0.9746 · 0.9746 · 0.9746 | 0.9722 · 0.9729 · 0.9729 · 0.9729 | 934 · 694 · 694 · 596 | 92.4/78.3/89 · 92.5/78.6/85 · 92.5/78.6/86 · 92.5/78.7/94 |
| `dbts_a5` top10 | 56 | 40.51/39.06 · 40.26/38.77 · 40.04/38.54 · 39.74/38.21 | 0.9486 · 0.9498 · 0.9479 · 0.9488 | 0.9378 · 0.9435 · 0.9435 · 0.9445 | 2069 · 1670 · 1670 · 1109 | 94.8/84.8/182 · 94.9/85.1/155 · 95.0/85.4/155 · 95.2/85.9/141 |
| `dbts_a5` window | 2 | 9.64/37.76 · 9.64/37.76 · 9.64/37.76 · 9.64/37.76 | 0.5951 · 0.5951 · 0.5951 · 0.5951 | 0.5306 · 0.5306 · 0.5306 · 0.5306 | 2145 · 2144 · 2144 · 2145 | 30.6/17.2/30 · 30.8/17.1/30 · 30.8/17.1/30 · 30.8/17.1/30 |
| `dbts_a5` window | 8 | 9.64/37.74 · 9.64/37.74 · 9.64/37.74 · 9.64/37.74 | 0.5947 · 0.5947 · 0.5947 · 0.5947 | 0.5303 · 0.5303 · 0.5303 · 0.5303 | 2153 · 2150 · 2150 · 2147 | 62.7/24.6/31 · 63.1/24.8/31 · 63.1/24.8/31 · 63.1/24.8/31 |
| `dbts_a5` window | 16 | 9.64/37.68 · 9.64/37.67 · 9.64/37.67 · 9.64/37.67 | 0.5935 · 0.5935 · 0.5935 · 0.5935 | 0.5292 · 0.5292 · 0.5292 · 0.5292 | 2156 · 2153 · 2154 · 2157 | 81.0/49.7/32 · 81.1/49.9/32 · 81.1/49.9/32 · 81.1/49.9/32 |
| `dbts_a5` window | 32 | 9.64/37.36 · 9.64/37.37 · 9.64/37.38 · 9.64/37.38 | 0.5864 · 0.5867 · 0.5867 · 0.5868 | 0.5222 · 0.5226 · 0.5226 · 0.5225 | 2163 · 2165 · 2165 · 2170 | 91.5/75.4/38 · 91.4/75.1/53 · 91.4/75.0/53 · 91.4/75.0/49 |
| `dbts_a5` window | 56 | 9.63/36.58 · 9.63/36.58 · 9.63/36.57 · 9.63/36.57 | 0.5733 · 0.5732 · 0.5732 · 0.5731 | 0.5108 · 0.5107 · 0.5107 · 0.5107 | 2197 · 2190 · 2198 · 2237 | 94.9/85.1/127 · 95.0/85.2/94 · 95.0/85.2/88 · 95.0/85.2/108 |
| `dbts_c1` 12bit | 2 | 67.50/64.14 · 67.05/63.70 · 67.02/63.67 · 66.99/63.64 | 0.9998 · 0.9998 · 0.9998 · 0.9998 | 0.9998 · 0.9998 · 0.9998 · 0.9998 | 37 · 105 · 104 · 130 | 32.3/1.0/4 · 33.5/1.3/5 · 33.6/1.3/5 · 33.7/1.4/4 |
| `dbts_c1` 12bit | 8 | 51.63/48.26 · 51.74/48.37 · 51.75/48.37 · 51.76/48.38 | 0.9932 · 0.9936 · 0.9936 · 0.9936 | 0.9928 · 0.9928 · 0.9928 · 0.9930 | 280 · 201 · 228 · 230 | 81.3/51.1/25 · 81.1/50.6/25 · 81.1/50.6/24 · 81.1/50.6/24 |
| `dbts_c1` 12bit | 16 | 47.37/44.02 · 47.37/44.02 · 47.38/44.03 · 47.38/44.03 | 0.9827 · 0.9830 · 0.9831 · 0.9832 | 0.9812 · 0.9816 · 0.9816 · 0.9816 | 523 · 523 · 523 · 328 | 87.3/65.4/46 · 87.4/65.4/58 · 87.3/65.4/58 · 87.3/65.3/46 |
| `dbts_c1` 12bit | 32 | 45.48/42.27 · 45.25/42.03 · 45.20/41.99 · 45.12/41.92 | 0.9779 · 0.9782 · 0.9779 · 0.9777 | 0.9753 · 0.9762 · 0.9762 · 0.9762 | 825 · 683 · 637 · 649 | 89.7/71.0/122 · 90.0/71.7/119 · 90.0/71.8/119 · 90.1/72.0/121 |
| `dbts_c1` 12bit | 56 | 40.18/37.78 · 39.85/37.37 · 39.54/37.05 · 38.90/36.40 | 0.9493 · 0.9513 · 0.9487 · 0.9388 | 0.8945 · 0.9372 · 0.9372 · 0.9372 | 2331 · 2060 · 2060 · 1979 | 93.2/80.1/213 · 93.4/80.7/194 · 93.6/81.3/185 · 94.0/82.4/195 |
| `dbts_c1` top10 | 2 | 63.16/59.79 · 63.10/59.74 · 63.09/59.73 · 63.08/59.73 | 0.9996 · 0.9996 · 0.9995 · 0.9995 | 0.9995 · 0.9995 · 0.9995 · 0.9995 | 55 · 107 · 102 · 109 | 47.3/6.3/6 · 47.5/6.4/6 · 47.5/6.4/6 · 47.5/6.4/6 |
| `dbts_c1` top10 | 8 | 51.33/47.95 · 51.42/48.04 · 51.42/48.04 · 51.42/48.05 | 0.9930 · 0.9931 · 0.9931 · 0.9932 | 0.9926 · 0.9926 · 0.9926 · 0.9926 | 280 · 262 · 214 · 207 | 81.9/52.4/25 · 81.7/52.0/25 · 81.7/52.0/25 · 81.7/52.0/25 |
| `dbts_c1` top10 | 16 | 47.54/44.17 · 47.54/44.17 · 47.54/44.18 · 47.54/44.18 | 0.9837 · 0.9839 · 0.9839 · 0.9839 | 0.9827 · 0.9827 · 0.9827 · 0.9827 | 462 · 456 · 456 · 344 | 87.1/65.0/45 · 87.2/65.0/47 · 87.2/65.0/47 · 87.2/65.0/58 |
| `dbts_c1` top10 | 32 | 45.77/42.50 · 45.63/42.37 · 45.61/42.34 · 45.56/42.31 | 0.9795 · 0.9797 · 0.9797 · 0.9797 | 0.9775 · 0.9781 · 0.9782 · 0.9782 | 806 · 607 · 583 · 562 | 89.4/70.4/122 · 89.6/70.8/117 · 89.6/70.8/117 · 89.6/70.9/130 |
| `dbts_c1` top10 | 56 | 41.43/38.92 · 41.21/38.65 · 41.02/38.44 · 40.76/38.11 | 0.9461 · 0.9482 · 0.9490 · 0.9492 | 0.9340 · 0.9397 · 0.9397 · 0.9436 | 2129 · 2052 · 2052 · 1431 | 92.5/78.3/207 · 92.7/78.8/216 · 92.8/79.2/216 · 93.1/79.9/176 |
| `dbts_c1` window | 2 | 7.90/35.30 · 7.90/35.30 · 7.90/35.30 · 7.90/35.30 | 0.4472 · 0.4472 · 0.4472 · 0.4472 | 0.3677 · 0.3677 · 0.3677 · 0.3677 | 2235 · 2235 · 2235 · 2236 | 30.9/18.0/30 · 31.1/18.1/30 · 31.1/18.1/30 · 31.1/18.1/30 |
| `dbts_c1` window | 8 | 7.90/35.29 · 7.90/35.29 · 7.90/35.29 · 7.90/35.29 | 0.4468 · 0.4468 · 0.4468 · 0.4468 | 0.3674 · 0.3674 · 0.3674 · 0.3674 | 2247 · 2244 · 2243 · 2245 | 61.4/24.8/31 · 61.6/24.9/31 · 61.7/24.9/31 · 61.7/24.9/31 |
| `dbts_c1` window | 16 | 7.90/35.24 · 7.90/35.24 · 7.90/35.24 · 7.90/35.23 | 0.4453 · 0.4453 · 0.4453 · 0.4453 | 0.3661 · 0.3660 · 0.3660 · 0.3660 | 2265 · 2250 · 2251 · 2247 | 79.6/47.1/32 · 79.7/47.3/32 · 79.7/47.3/32 · 79.7/47.3/32 |
| `dbts_c1` window | 32 | 7.90/34.99 · 7.90/34.99 · 7.90/34.99 · 7.90/34.99 | 0.4378 · 0.4381 · 0.4381 · 0.4382 | 0.3589 · 0.3591 · 0.3591 · 0.3592 | 2263 · 2258 · 2258 · 2257 | 89.9/70.9/46 · 89.8/70.7/36 · 89.8/70.7/36 · 89.8/70.7/40 |
| `dbts_c1` window | 56 | 7.89/34.51 · 7.89/34.50 · 7.89/34.49 · 7.89/34.49 | 0.4297 · 0.4296 · 0.4296 · 0.4295 | 0.3519 · 0.3519 · 0.3519 · 0.3518 | 2378 · 2378 · 2378 · 2427 | 93.1/79.8/146 · 93.2/80.0/126 · 93.2/80.0/126 · 93.2/80.0/127 |
| `dbts_c2` 12bit | 2 | 65.72/64.22 · 65.28/63.78 · 65.25/63.75 · 65.22/63.72 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 33 · 68 · 68 · 93 | 47.8/6.7/5 · 49.1/7.7/9 · 49.2/7.8/9 · 49.3/7.9/11 |
| `dbts_c2` 12bit | 8 | 49.75/48.24 · 49.85/48.33 · 49.85/48.34 · 49.85/48.34 | 0.9898 · 0.9902 · 0.9902 · 0.9902 | 0.9891 · 0.9891 · 0.9891 · 0.9891 | 251 · 314 · 314 · 205 | 87.3/67.3/37 · 87.2/67.0/38 · 87.2/67.0/38 · 87.3/67.0/38 |
| `dbts_c2` 12bit | 16 | 45.03/43.54 · 45.06/43.56 · 45.06/43.56 · 45.04/43.56 | 0.9708 · 0.9712 · 0.9713 · 0.9712 | 0.9690 · 0.9690 · 0.9690 · 0.9690 | 383 · 394 · 394 · 300 | 91.5/77.8/76 · 91.6/77.8/74 · 91.6/77.8/73 · 91.7/77.9/74 |
| `dbts_c2` 12bit | 32 | 43.05/41.66 · 42.79/41.41 · 42.74/41.37 · 42.69/41.32 | 0.9623 · 0.9623 · 0.9623 · 0.9622 | 0.9596 · 0.9603 · 0.9603 · 0.9603 | 931 · 680 · 645 · 575 | 93.5/82.1/133 · 93.7/82.6/140 · 93.8/82.7/140 · 93.9/82.9/129 |
| `dbts_c2` 12bit | 56 | 38.14/37.44 · 37.88/37.10 · 37.53/36.75 · 37.11/36.29 | 0.9394 · 0.9404 · 0.9375 · 0.9249 | 0.9128 · 0.9259 · 0.9238 · 0.9228 | 2301 · 2291 · 2138 · 1766 | 96.2/89.0/203 · 96.2/89.1/205 · 96.3/89.4/176 · 96.5/89.9/227 |
| `dbts_c2` top10 | 2 | 61.39/59.88 · 61.30/59.80 · 61.30/59.79 · 61.29/59.78 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 44 · 80 · 82 · 89 | 62.6/21.5/9 · 62.8/21.8/11 · 62.9/21.8/11 · 62.9/21.8/11 |
| `dbts_c2` top10 | 8 | 49.42/47.90 · 49.49/47.98 · 49.49/47.98 · 49.50/47.98 | 0.9892 · 0.9894 · 0.9894 · 0.9894 | 0.9885 · 0.9885 · 0.9885 · 0.9885 | 263 · 203 · 217 · 173 | 87.9/68.4/38 · 87.9/68.2/37 · 88.0/68.2/36 · 88.0/68.2/38 |
| `dbts_c2` top10 | 16 | 45.21/43.71 · 45.21/43.71 · 45.21/43.71 · 45.21/43.71 | 0.9721 · 0.9723 · 0.9723 · 0.9723 | 0.9704 · 0.9704 · 0.9704 · 0.9704 | 383 · 353 · 352 · 369 | 91.6/77.6/70 · 91.6/77.6/68 · 91.7/77.7/70 · 91.8/77.8/67 |
| `dbts_c2` top10 | 32 | 43.30/41.87 · 43.17/41.75 · 43.15/41.73 · 43.12/41.71 | 0.9636 · 0.9637 · 0.9636 · 0.9636 | 0.9615 · 0.9618 · 0.9618 · 0.9618 | 927 · 660 · 546 · 529 | 93.4/81.7/133 · 93.5/82.0/126 · 93.5/82.0/123 · 93.6/82.1/122 |
| `dbts_c2` top10 | 56 | 39.32/38.42 · 39.05/38.13 · 38.87/37.96 · 38.66/37.71 | 0.9420 · 0.9439 · 0.9440 · 0.9437 | 0.9318 · 0.9375 · 0.9408 · 0.9402 | 2152 · 2150 · 2150 · 1764 | 95.8/87.8/183 · 95.9/88.1/207 · 96.0/88.2/185 · 96.2/88.7/168 |
| `dbts_c2` window | 2 | 9.95/39.18 · 9.95/39.18 · 9.95/39.18 · 9.95/39.18 | 0.6926 · 0.6926 · 0.6926 · 0.6926 | 0.6369 · 0.6369 · 0.6369 · 0.6369 | 2380 · 2380 · 2380 · 2380 | 28.4/15.3/30 · 28.6/15.2/30 · 28.6/15.2/30 · 28.7/15.2/30 |
| `dbts_c2` window | 8 | 9.95/39.15 · 9.95/39.15 · 9.95/39.15 · 9.95/39.15 | 0.6924 · 0.6924 · 0.6923 · 0.6923 | 0.6367 · 0.6366 · 0.6366 · 0.6366 | 2387 · 2384 · 2388 · 2386 | 61.0/23.0/31 · 61.4/23.3/31 · 61.4/23.3/32 · 61.5/23.4/33 |
| `dbts_c2` window | 16 | 9.95/39.09 · 9.95/39.09 · 9.95/39.09 · 9.95/39.09 | 0.6913 · 0.6913 · 0.6913 · 0.6913 | 0.6357 · 0.6357 · 0.6357 · 0.6357 | 2389 · 2391 · 2388 · 2385 | 79.5/48.1/32 · 79.7/48.5/32 · 79.7/48.5/31 · 79.8/48.5/32 |
| `dbts_c2` window | 32 | 9.95/38.73 · 9.95/38.73 · 9.95/38.73 · 9.95/38.73 | 0.6845 · 0.6847 · 0.6847 · 0.6847 | 0.6290 · 0.6292 · 0.6292 · 0.6292 | 2401 · 2393 · 2402 · 2395 | 90.9/75.4/60 · 90.9/75.3/42 · 90.9/75.3/36 · 91.0/75.3/44 |
| `dbts_c2` window | 56 | 9.94/37.43 · 9.94/37.43 · 9.94/37.43 · 9.94/37.42 | 0.6608 · 0.6607 · 0.6607 · 0.6607 | 0.6069 · 0.6069 · 0.6069 · 0.6068 | 2425 · 2425 · 2451 · 2427 | 95.3/86.8/149 · 95.4/86.8/98 · 95.4/86.9/117 · 95.5/87.0/102 |
| `dbts_c3` 12bit | 2 | 67.23/64.17 · 66.79/63.73 · 66.76/63.70 · 66.73/63.68 | 0.9998 · 0.9998 · 0.9998 · 0.9998 | 0.9998 · 0.9998 · 0.9998 · 0.9998 | 30 · 86 · 73 · 89 | 38.2/2.1/4 · 39.5/2.6/5 · 39.6/2.6/4 · 39.7/2.7/5 |
| `dbts_c3` 12bit | 8 | 51.18/48.09 · 51.27/48.19 · 51.28/48.19 · 51.28/48.20 | 0.9927 · 0.9929 · 0.9930 · 0.9930 | 0.9921 · 0.9922 · 0.9922 · 0.9923 | 350 · 276 · 237 · 317 | 85.1/59.9/28 · 85.0/59.5/29 · 85.0/59.5/29 · 84.9/59.5/29 |
| `dbts_c3` 12bit | 16 | 46.48/43.42 · 46.49/43.43 · 46.49/43.43 · 46.49/43.43 | 0.9788 · 0.9791 · 0.9792 · 0.9793 | 0.9770 · 0.9771 · 0.9771 · 0.9771 | 576 · 405 · 414 · 393 | 90.5/73.8/54 · 90.5/73.8/57 · 90.5/73.8/63 · 90.5/73.8/61 |
| `dbts_c3` 12bit | 32 | 44.57/41.65 · 44.35/41.43 · 44.31/41.39 · 44.28/41.36 | 0.9717 · 0.9720 · 0.9720 · 0.9725 | 0.9698 · 0.9706 · 0.9707 · 0.9711 | 892 · 645 · 645 · 583 | 92.3/78.4/122 · 92.5/78.8/107 · 92.5/78.9/107 · 92.6/79.0/92 |
| `dbts_c3` 12bit | 56 | 39.45/37.40 · 39.19/36.99 · 38.95/36.70 · 38.56/36.21 | 0.9377 · 0.9398 · 0.9373 · 0.9393 | 0.9043 · 0.9256 · 0.9256 · 0.9374 | 2371 · 2311 · 2249 · 2220 | 95.0/85.3/224 · 95.2/85.8/215 · 95.3/86.1/215 · 95.5/86.6/212 |
| `dbts_c3` top10 | 2 | 62.90/59.82 · 62.83/59.77 · 62.82/59.76 · 62.82/59.76 | 0.9995 · 0.9995 · 0.9995 · 0.9995 | 0.9995 · 0.9995 · 0.9995 · 0.9995 | 40 · 108 · 108 · 100 | 54.2/10.5/7 · 54.3/10.6/7 · 54.4/10.7/7 · 54.4/10.7/7 |
| `dbts_c3` top10 | 8 | 50.84/47.75 · 50.92/47.83 · 50.92/47.84 · 50.92/47.84 | 0.9922 · 0.9924 · 0.9924 · 0.9924 | 0.9917 · 0.9917 · 0.9918 · 0.9918 | 350 · 276 · 300 · 269 | 85.7/61.2/29 · 85.5/60.9/29 · 85.5/60.9/29 · 85.6/60.9/29 |
| `dbts_c3` top10 | 16 | 46.66/43.59 · 46.65/43.58 · 46.65/43.58 · 46.64/43.58 | 0.9801 · 0.9802 · 0.9802 · 0.9802 | 0.9787 · 0.9787 · 0.9787 · 0.9787 | 532 · 413 · 413 · 348 | 90.4/73.4/55 · 90.4/73.5/52 · 90.4/73.5/53 · 90.4/73.5/56 |
| `dbts_c3` top10 | 32 | 44.84/41.85 · 44.73/41.75 · 44.71/41.73 · 44.69/41.72 | 0.9744 · 0.9745 · 0.9745 · 0.9745 | 0.9713 · 0.9713 · 0.9727 · 0.9727 | 731 · 528 · 528 · 570 | 92.2/77.9/116 · 92.2/78.1/113 · 92.2/78.2/115 · 92.3/78.2/115 |
| `dbts_c3` top10 | 56 | 40.78/38.47 · 40.60/38.22 · 40.52/38.10 · 40.29/37.83 | 0.9454 · 0.9469 · 0.9511 · 0.9519 | 0.9313 · 0.9313 · 0.9313 · 0.9474 | 2246 · 2246 · 2246 · 1419 | 94.5/84.0/212 · 94.6/84.3/182 · 94.7/84.4/182 · 94.9/84.8/173 |
| `dbts_c3` window | 2 | 7.43/38.00 · 7.43/38.00 · 7.43/38.00 · 7.43/38.00 | 0.4807 · 0.4807 · 0.4807 · 0.4807 | 0.3982 · 0.3982 · 0.3982 · 0.3982 | 2434 · 2434 · 2434 · 2434 | 26.9/13.6/30 · 27.1/13.6/30 · 27.1/13.6/30 · 27.2/13.6/30 |
| `dbts_c3` window | 8 | 7.43/37.97 · 7.43/37.97 · 7.43/37.97 · 7.43/37.97 | 0.4803 · 0.4803 · 0.4803 · 0.4803 | 0.3979 · 0.3979 · 0.3979 · 0.3979 | 2442 · 2441 · 2439 · 2441 | 58.9/20.1/31 · 59.2/20.2/31 · 59.2/20.2/31 · 59.2/20.2/31 |
| `dbts_c3` window | 16 | 7.43/37.88 · 7.43/37.88 · 7.43/37.88 · 7.43/37.88 | 0.4790 · 0.4790 · 0.4790 · 0.4790 | 0.3968 · 0.3968 · 0.3968 · 0.3968 | 2444 · 2447 · 2444 · 2453 | 78.6/44.4/33 · 78.7/44.7/32 · 78.8/44.7/32 · 78.8/44.7/32 |
| `dbts_c3` window | 32 | 7.43/37.45 · 7.43/37.47 · 7.43/37.47 · 7.43/37.47 | 0.4714 · 0.4717 · 0.4717 · 0.4717 | 0.3896 · 0.3898 · 0.3898 · 0.3899 | 2473 · 2457 · 2458 · 2462 | 90.5/72.7/49 · 90.4/72.3/49 · 90.4/72.3/36 · 90.4/72.3/35 |
| `dbts_c3` window | 56 | 7.42/36.49 · 7.42/36.49 · 7.42/36.49 · 7.42/36.49 | 0.4581 · 0.4580 · 0.4579 · 0.4579 | 0.3777 · 0.3777 · 0.3777 · 0.3776 | 2521 · 2509 · 2534 · 2505 | 94.2/82.9/131 · 94.2/83.0/97 · 94.2/83.0/94 · 94.3/83.0/119 |
| `dbts_c4` 12bit | 2 | 67.61/64.13 · 67.60/64.14 · 67.60/64.14 · 67.60/64.15 | 0.9998 · 0.9998 · 0.9998 · 0.9998 | 0.9998 · 0.9998 · 0.9998 · 0.9998 | 26 · 79 · 55 · 83 | 51.0/8.2/6 · 51.0/8.2/7 · 51.0/8.2/8 · 50.9/8.1/7 |
| `dbts_c4` 12bit | 8 | 51.47/47.96 · 51.49/47.99 · 51.48/47.98 · 51.48/47.99 | 0.9934 · 0.9935 · 0.9935 · 0.9935 | 0.9930 · 0.9930 · 0.9930 · 0.9932 | 267 · 220 · 239 · 232 | 89.3/71.5/36 · 89.3/71.4/38 · 89.3/71.4/38 · 89.3/71.4/36 |
| `dbts_c4` 12bit | 16 | 46.40/42.92 · 46.39/42.93 · 46.38/42.92 · 46.37/42.91 | 0.9790 · 0.9792 · 0.9792 · 0.9792 | 0.9777 · 0.9782 · 0.9782 · 0.9782 | 493 · 368 · 381 · 381 | 93.4/82.1/74 · 93.4/82.1/82 · 93.4/82.2/82 · 93.4/82.2/80 |
| `dbts_c4` 12bit | 32 | 44.22/40.95 · 44.01/40.75 · 43.96/40.71 · 43.91/40.67 | 0.9707 · 0.9708 · 0.9707 · 0.9707 | 0.9685 · 0.9691 · 0.9691 · 0.9690 | 857 · 708 · 708 · 641 | 94.9/85.8/109 · 95.0/86.1/131 · 95.0/86.1/116 · 95.0/86.2/137 |
| `dbts_c4` 12bit | 56 | 38.77/36.80 · 38.39/36.21 · 38.07/35.82 · 37.73/35.33 | 0.9257 · 0.9289 · 0.9287 · 0.9341 | 0.8807 · 0.9138 · 0.9138 · 0.9245 | 2380 · 2267 · 2055 · 1716 | 96.8/90.8/232 · 96.9/91.1/229 · 97.1/91.5/227 · 97.2/92.0/215 |
| `dbts_c4` top10 | 2 | 63.27/59.78 · 63.30/59.82 · 63.30/59.82 · 63.29/59.82 | 0.9996 · 0.9996 · 0.9996 · 0.9996 | 0.9996 · 0.9996 · 0.9996 · 0.9996 | 47 · 78 · 100 · 97 | 64.8/24.2/9 · 64.7/24.1/10 · 64.7/24.1/10 · 64.7/24.1/10 |
| `dbts_c4` top10 | 8 | 51.12/47.61 · 51.13/47.63 · 51.13/47.63 · 51.12/47.63 | 0.9929 · 0.9930 · 0.9930 · 0.9930 | 0.9926 · 0.9927 · 0.9927 · 0.9927 | 262 · 262 · 262 · 204 | 89.7/72.5/40 · 89.7/72.4/37 · 89.7/72.4/39 · 89.7/72.4/41 |
| `dbts_c4` top10 | 16 | 46.60/43.11 · 46.61/43.13 · 46.61/43.13 · 46.60/43.13 | 0.9802 · 0.9805 · 0.9805 · 0.9805 | 0.9792 · 0.9795 · 0.9795 · 0.9795 | 502 · 349 · 418 · 353 | 93.3/81.8/79 · 93.3/81.8/72 · 93.3/81.8/71 · 93.3/81.8/81 |
| `dbts_c4` top10 | 32 | 44.52/41.17 · 44.41/41.07 · 44.38/41.06 · 44.36/41.04 | 0.9728 · 0.9730 · 0.9731 · 0.9731 | 0.9712 · 0.9718 · 0.9718 · 0.9719 | 758 · 597 · 633 · 633 | 94.7/85.4/106 · 94.7/85.5/109 · 94.7/85.6/107 · 94.8/85.6/93 |
| `dbts_c4` top10 | 56 | 40.06/37.71 · 39.84/37.42 · 39.70/37.25 · 39.50/37.02 | 0.9401 · 0.9444 · 0.9447 · 0.9401 | 0.9310 · 0.9379 · 0.9379 · 0.9366 | 2282 · 2282 · 1892 · 1634 | 96.5/89.9/222 · 96.6/90.2/209 · 96.6/90.3/208 · 96.7/90.5/210 |
| `dbts_c4` window | 2 | 6.70/36.88 · 6.70/36.88 · 6.70/36.88 · 6.70/36.88 | 0.4314 · 0.4314 · 0.4314 · 0.4314 | 0.3680 · 0.3680 · 0.3680 · 0.3680 | 2535 · 2535 · 2535 · 2535 | 24.8/12.0/30 · 24.8/12.0/30 · 24.8/12.0/30 · 24.8/12.0/30 |
| `dbts_c4` window | 8 | 6.70/36.87 · 6.70/36.87 · 6.70/36.87 · 6.70/36.87 | 0.4312 · 0.4313 · 0.4313 · 0.4313 | 0.3679 · 0.3679 · 0.3679 · 0.3679 | 2541 · 2539 · 2539 · 2539 | 60.4/20.4/31 · 59.7/19.6/31 · 59.6/19.5/31 · 59.6/19.5/31 |
| `dbts_c4` window | 16 | 6.70/36.82 · 6.70/36.82 · 6.70/36.82 · 6.70/36.82 | 0.4306 · 0.4306 · 0.4307 · 0.4307 | 0.3674 · 0.3674 · 0.3674 · 0.3674 | 2549 · 2543 · 2543 · 2543 | 80.0/47.4/34 · 79.7/46.7/34 · 79.7/46.6/33 · 79.7/46.6/33 |
| `dbts_c4` window | 32 | 6.70/36.60 · 6.70/36.60 · 6.70/36.60 · 6.70/36.60 | 0.4263 · 0.4264 · 0.4264 · 0.4264 | 0.3634 · 0.3635 · 0.3635 · 0.3636 | 2561 · 2554 · 2558 · 2561 | 92.0/76.8/94 · 91.9/76.6/83 · 91.9/76.6/83 · 91.9/76.6/83 |
| `dbts_c4` window | 56 | 6.69/35.60 · 6.69/35.59 · 6.69/35.59 · 6.69/35.57 | 0.4080 · 0.4079 · 0.4079 · 0.4079 | 0.3463 · 0.3463 · 0.3463 · 0.3462 | 2619 · 2585 · 2594 · 2586 | 96.3/89.0/140 · 96.3/89.1/118 · 96.3/89.1/116 · 96.3/89.1/116 |
| `dbts_c5` 12bit | 2 | 66.21/64.13 · 65.77/63.69 · 65.73/63.65 · 65.70/63.63 | 0.9998 · 0.9997 · 0.9997 · 0.9997 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 35 · 97 · 80 · 100 | 41.0/3.3/6 · 42.4/4.0/5 · 42.5/4.1/5 · 42.5/4.1/5 |
| `dbts_c5` 12bit | 8 | 50.27/48.17 · 50.38/48.28 · 50.39/48.29 · 50.40/48.29 | 0.9908 · 0.9911 · 0.9912 · 0.9912 | 0.9903 · 0.9903 · 0.9903 · 0.9904 | 299 · 292 · 292 · 241 | 86.0/61.8/32 · 85.8/61.3/35 · 85.8/61.3/33 · 85.8/61.3/33 |
| `dbts_c5` 12bit | 16 | 46.01/43.93 · 46.02/43.94 · 46.02/43.95 · 46.02/43.95 | 0.9764 · 0.9768 · 0.9768 · 0.9769 | 0.9748 · 0.9749 · 0.9749 · 0.9749 | 380 · 351 · 356 · 384 | 90.6/73.7/65 · 90.6/73.7/78 · 90.6/73.6/76 · 90.6/73.6/73 |
| `dbts_c5` 12bit | 32 | 44.27/42.32 · 44.06/42.11 · 44.02/42.08 · 43.96/42.02 | 0.9713 · 0.9716 · 0.9715 · 0.9714 | 0.9692 · 0.9694 · 0.9694 · 0.9694 | 771 · 803 · 803 · 803 | 92.3/77.9/115 · 92.4/78.4/150 · 92.5/78.4/159 · 92.5/78.6/147 |
| `dbts_c5` 12bit | 56 | 39.51/38.42 · 39.28/38.09 · 38.96/37.76 · 38.48/37.18 | 0.9508 · 0.9531 · 0.9528 · 0.9523 | 0.9324 · 0.9448 · 0.9495 · 0.9504 | 2186 · 2092 · 2085 · 2056 | 94.7/84.3/215 · 94.8/84.8/221 · 95.0/85.2/221 · 95.2/86.0/220 |
| `dbts_c5` top10 | 2 | 61.88/59.78 · 61.81/59.72 · 61.80/59.72 · 61.79/59.71 | 0.9994 · 0.9994 · 0.9994 · 0.9994 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 59 · 123 · 110 · 110 | 56.6/13.7/8 · 56.8/13.9/9 · 56.8/13.9/8 · 56.8/13.9/8 |
| `dbts_c5` top10 | 8 | 49.96/47.86 · 50.06/47.95 · 50.06/47.96 · 50.07/47.96 | 0.9903 · 0.9905 · 0.9905 · 0.9905 | 0.9898 · 0.9898 · 0.9898 · 0.9898 | 311 · 311 · 311 · 283 | 86.4/62.9/33 · 86.2/62.6/35 · 86.2/62.6/36 · 86.2/62.6/33 |
| `dbts_c5` top10 | 16 | 46.17/44.08 · 46.17/44.09 · 46.17/44.09 · 46.17/44.09 | 0.9774 · 0.9776 · 0.9776 · 0.9776 | 0.9760 · 0.9761 · 0.9761 · 0.9761 | 355 · 390 · 390 · 390 | 90.4/73.4/67 · 90.4/73.4/67 · 90.4/73.4/67 · 90.4/73.4/55 |
| `dbts_c5` top10 | 32 | 44.53/42.53 · 44.41/42.42 · 44.39/42.40 · 44.35/42.38 | 0.9724 · 0.9724 · 0.9724 · 0.9724 | 0.9700 · 0.9700 · 0.9704 · 0.9704 | 724 · 531 · 531 · 609 | 92.1/77.4/118 · 92.1/77.7/118 · 92.2/77.7/117 · 92.2/77.8/133 |
| `dbts_c5` top10 | 56 | 40.71/39.43 · 40.52/39.19 · 40.39/39.05 · 40.13/38.70 | 0.9513 · 0.9511 · 0.9510 · 0.9527 | 0.9458 · 0.9479 · 0.9480 · 0.9481 | 2113 · 2078 · 2078 · 1275 | 94.2/83.1/199 · 94.3/83.4/228 · 94.4/83.6/201 · 94.6/84.1/208 |
| `dbts_c5` window | 2 | 8.99/38.12 · 8.99/38.12 · 8.99/38.12 · 8.99/38.12 | 0.6043 · 0.6043 · 0.6043 · 0.6043 | 0.4987 · 0.4987 · 0.4987 · 0.4987 | 2333 · 2333 · 2333 · 2333 | 33.5/20.5/30 · 33.7/20.5/30 · 33.7/20.5/30 · 33.8/20.5/30 |
| `dbts_c5` window | 8 | 8.99/38.09 · 8.99/38.10 · 8.99/38.10 · 8.99/38.10 | 0.6039 · 0.6040 · 0.6040 · 0.6040 | 0.4984 · 0.4984 · 0.4984 · 0.4984 | 2338 · 2337 · 2336 · 2336 | 62.6/27.0/31 · 62.9/26.9/31 · 63.0/26.9/31 · 63.1/26.9/31 |
| `dbts_c5` window | 16 | 8.99/38.03 · 8.99/38.04 · 8.99/38.04 · 8.99/38.04 | 0.6027 · 0.6027 · 0.6027 · 0.6027 | 0.4974 · 0.4974 · 0.4974 · 0.4974 | 2341 · 2341 · 2343 · 2343 | 80.5/49.1/33 · 80.7/49.3/32 · 80.7/49.4/32 · 80.7/49.4/33 |
| `dbts_c5` window | 32 | 8.99/37.71 · 8.99/37.72 · 8.99/37.72 · 8.99/37.72 | 0.5957 · 0.5960 · 0.5960 · 0.5960 | 0.4908 · 0.4908 · 0.4910 · 0.4910 | 2356 · 2348 · 2350 · 2351 | 91.4/74.9/52 · 91.4/74.7/39 · 91.3/74.7/39 · 91.3/74.7/39 |
| `dbts_c5` window | 56 | 8.99/36.87 · 8.99/36.87 · 8.99/36.87 · 8.99/36.86 | 0.5812 · 0.5811 · 0.5811 · 0.5810 | 0.4776 · 0.4776 · 0.4775 · 0.4775 | 2384 · 2388 · 2412 · 2484 | 94.8/84.4/146 · 94.8/84.5/128 · 94.8/84.5/128 · 94.8/84.5/127 |

#### Bytes, other sound sets

Each cell: G = 1 · 8 · 16 · whole.

| series, form | Q | lossy ÷ HTJ2K | gain % | residual ÷ HTJ2K | lossy + residual ÷ HTJ2K |
| --- | --- | --- | --- | --- | --- |
| `dbt10_d` 10bit | 2 | 0.6174 · 0.6137 · 0.6135 · 0.6135 | 0 · +0.6 · +0.6 · +0.6 | 0.473 · 0.472 · 0.473 · 0.473 | 1.090 · 1.086 · 1.087 · 1.087 |
| `dbt10_d` 10bit | 8 | 0.1976 · 0.1889 · 0.1884 · 0.1881 | 0 · +4.4 · +4.7 · +4.8 | 0.830 · 0.825 · 0.824 · 0.824 | 1.028 · 1.014 · 1.013 · 1.012 |
| `dbt10_d` 10bit | 16 | 0.0690 · 0.0558 · 0.0552 · 0.0548 | 0 · +19.1 · +20.0 · +20.6 | 0.942 · 0.941 · 0.941 · 0.941 | 1.011 · 0.997 · 0.996 · 0.995 |
| `dbt10_d` 10bit | 32 | 0.0142 · 0.0060 · 0.0056 · 0.0054 | 0 · +57.8 · +60.7 · +62.3 | 0.990 · 0.990 · 0.991 · 0.991 | 1.005 · 0.996 · 0.997 · 0.996 |
| `dbt10_d` 10bit | 56 | 0.0017 · 0.0004 · 0.0003 · 0.0003 | 0 · +77.5 · +81.8 · +84.0 | 1.011 · 1.011 · 1.012 · 1.018 | 1.012 · 1.012 · 1.013 · 1.018 |
| `dbt10_ea1141` 10bit | 2 | 0.6285 · 0.6246 · 0.6244 · 0.6243 | 0 · +0.6 · +0.6 · +0.7 | 0.459 · 0.459 · 0.459 · 0.459 | 1.088 · 1.084 · 1.084 · 1.084 |
| `dbt10_ea1141` 10bit | 8 | 0.2159 · 0.2051 · 0.2048 · 0.2047 | 0 · +5.0 · +5.1 · +5.2 | 0.813 · 0.808 · 0.807 · 0.807 | 1.028 · 1.013 · 1.012 · 1.012 |
| `dbt10_ea1141` 10bit | 16 | 0.0812 · 0.0665 · 0.0662 · 0.0657 | 0 · +18.1 · +18.5 · +19.1 | 0.933 · 0.930 · 0.930 · 0.930 | 1.014 · 0.997 · 0.996 · 0.996 |
| `dbt10_ea1141` 10bit | 32 | 0.0179 · 0.0085 · 0.0082 · 0.0078 | 0 · +52.7 · +54.5 · +56.3 | 0.989 · 0.990 · 0.990 · 0.991 | 1.006 · 0.999 · 0.999 · 0.999 |
| `dbt10_ea1141` 10bit | 56 | 0.0029 · 0.0007 · 0.0006 · 0.0005 | 0 · +76.0 · +79.2 · +82.6 | 1.011 · 1.015 · 1.016 · 1.017 | 1.014 · 1.016 · 1.017 · 1.017 |
| `dbt12_c` 12bit | 2 | 0.5023 · 0.4865 · 0.4855 · 0.4849 | 0 · +3.2 · +3.3 · +3.5 | 0.543 · 0.555 · 0.557 · 0.558 | 1.046 · 1.041 · 1.042 · 1.043 |
| `dbt12_c` 12bit | 8 | 0.1090 · 0.1087 · 0.1087 · 0.1086 | 0 · +0.3 · +0.3 · +0.3 | 0.915 · 0.913 · 0.914 · 0.915 | 1.024 · 1.022 · 1.023 · 1.023 |
| `dbt12_c` 12bit | 16 | 0.0189 · 0.0129 · 0.0126 · 0.0123 | 0 · +31.7 · +33.4 · +35.0 | 0.989 · 0.991 · 0.992 · 0.993 | 1.008 · 1.004 · 1.005 · 1.006 |
| `dbt12_c` 12bit | 32 | 0.0044 · 0.0016 · 0.0015 · 0.0014 | 0 · +62.7 · +65.8 · +68.4 | 1.004 · 1.007 · 1.009 · 1.014 | 1.009 · 1.009 · 1.010 · 1.015 |
| `dbt12_c` 12bit | 56 | 0.0009 · 0.0002 · 0.0002 · 0.0002 | 0 · +74.1 · +78.1 · +81.4 | 1.024 · 1.027 · 1.029 · 1.036 | 1.025 · 1.027 · 1.029 · 1.037 |
| `dbt12_c` top10 | 2 | 0.4129 · 0.4125 · 0.4124 · 0.4124 | 0 · +0.1 · +0.1 · +0.1 | 0.642 · 0.644 · 0.645 · 0.646 | 1.055 · 1.057 · 1.057 · 1.059 |
| `dbt12_c` top10 | 8 | 0.1024 · 0.1017 · 0.1017 · 0.1016 | 0 · +0.7 · +0.8 · +0.8 | 0.921 · 0.919 · 0.920 · 0.922 | 1.023 · 1.021 · 1.022 · 1.024 |
| `dbt12_c` top10 | 16 | 0.0213 · 0.0150 · 0.0147 · 0.0144 | 0 · +29.6 · +31.2 · +32.7 | 0.985 · 0.986 · 0.987 · 0.988 | 1.007 · 1.001 · 1.002 · 1.002 |
| `dbt12_c` top10 | 32 | 0.0051 · 0.0021 · 0.0019 · 0.0018 | 0 · +58.7 · +61.9 · +64.8 | 1.001 · 1.005 · 1.006 · 1.007 | 1.006 · 1.007 · 1.008 · 1.009 |
| `dbt12_c` top10 | 56 | 0.0011 · 0.0003 · 0.0003 · 0.0002 | 0 · +71.9 · +76.0 · +79.2 | 1.020 · 1.022 · 1.024 · 1.034 | 1.021 · 1.022 · 1.024 · 1.034 |
| `dbt12_c` window | 2 | 0.6490 · 0.6479 · 0.6478 · 0.6479 | 0 · +0.2 · +0.2 · +0.2 | 0.519 · 0.521 · 0.521 · 0.521 | 1.168 · 1.169 · 1.168 · 1.169 |
| `dbt12_c` window | 8 | 0.3649 · 0.3647 · 0.3648 · 0.3648 | 0 · +0.1 · +0.0 · +0.0 | 0.703 · 0.704 · 0.705 · 0.705 | 1.068 · 1.069 · 1.069 · 1.070 |
| `dbt12_c` window | 16 | 0.2216 · 0.2222 · 0.2222 · 0.2222 | 0 · -0.3 · -0.3 · -0.3 | 0.825 · 0.826 · 0.826 · 0.826 | 1.047 · 1.048 · 1.048 · 1.048 |
| `dbt12_c` window | 32 | 0.0626 · 0.0621 · 0.0621 · 0.0621 | 0 · +0.9 · +0.8 · +0.8 | 0.961 · 0.958 · 0.958 · 0.958 | 1.024 · 1.020 · 1.020 · 1.020 |
| `dbt12_c` window | 56 | 0.0029 · 0.0012 · 0.0011 · 0.0010 | 0 · +59.5 · +62.2 · +64.3 | 1.008 · 1.009 · 1.011 · 1.015 | 1.011 · 1.010 · 1.012 · 1.016 |
| `dbt12_ea1141` 12bit | 2 | 0.4913 · 0.4925 · 0.4924 · 0.4926 | 0 · -0.3 · -0.2 · -0.3 | 0.554 · 0.555 · 0.555 · 0.555 | 1.045 · 1.047 · 1.047 · 1.048 |
| `dbt12_ea1141` 12bit | 8 | 0.0967 · 0.0965 · 0.0964 · 0.0962 | 0 · +0.3 · +0.4 · +0.5 | 0.923 · 0.923 · 0.924 · 0.925 | 1.020 · 1.019 · 1.021 · 1.021 |
| `dbt12_ea1141` 12bit | 16 | 0.0169 · 0.0121 · 0.0117 · 0.0116 | 0 · +28.5 · +30.9 · +31.7 | 0.993 · 0.996 · 0.997 · 0.998 | 1.010 · 1.008 · 1.009 · 1.010 |
| `dbt12_ea1141` 12bit | 32 | 0.0038 · 0.0015 · 0.0014 · 0.0013 | 0 · +60.9 · +64.3 · +66.7 | 1.008 · 1.013 · 1.015 · 1.017 | 1.012 · 1.014 · 1.017 · 1.019 |
| `dbt12_ea1141` 12bit | 56 | 0.0010 · 0.0002 · 0.0002 · 0.0001 | 0 · +76.7 · +81.7 · +85.7 | 1.033 · 1.034 · 1.035 · 1.034 | 1.034 · 1.034 · 1.035 · 1.035 |
| `dbt12_ea1141` top10 | 2 | 0.4008 · 0.4024 · 0.4025 · 0.4025 | 0 · -0.4 · -0.4 · -0.4 | 0.653 · 0.654 · 0.654 · 0.654 | 1.054 · 1.056 · 1.056 · 1.057 |
| `dbt12_ea1141` top10 | 8 | 0.0909 · 0.0905 · 0.0904 · 0.0904 | 0 · +0.4 · +0.5 · +0.5 | 0.927 · 0.928 · 0.929 · 0.930 | 1.018 · 1.018 · 1.019 · 1.020 |
| `dbt12_ea1141` top10 | 16 | 0.0197 · 0.0143 · 0.0139 · 0.0136 | 0 · +27.2 · +29.3 · +30.8 | 0.989 · 0.992 · 0.993 · 0.994 | 1.008 · 1.006 · 1.006 · 1.007 |
| `dbt12_ea1141` top10 | 32 | 0.0044 · 0.0019 · 0.0017 · 0.0016 | 0 · +57.1 · +60.5 · +63.0 | 1.007 · 1.012 · 1.016 · 1.017 | 1.011 · 1.014 · 1.018 · 1.019 |
| `dbt12_ea1141` top10 | 56 | 0.0012 · 0.0003 · 0.0002 · 0.0002 | 0 · +75.6 · +80.1 · +83.8 | 1.030 · 1.030 · 1.032 · 1.032 | 1.032 · 1.031 · 1.033 · 1.032 |
| `dbt12_ea1141` window | 2 | 0.7321 · 0.7335 · 0.7338 · 0.7341 | 0 · -0.2 · -0.2 · -0.3 | 0.479 · 0.479 · 0.479 · 0.479 | 1.212 · 1.213 · 1.213 · 1.213 |
| `dbt12_ea1141` window | 8 | 0.4240 · 0.4277 · 0.4278 · 0.4279 | 0 · -0.9 · -0.9 · -0.9 | 0.657 · 0.654 · 0.653 · 0.654 | 1.081 · 1.081 · 1.081 · 1.081 |
| `dbt12_ea1141` window | 16 | 0.2724 · 0.2741 · 0.2744 · 0.2742 | 0 · -0.7 · -0.8 · -0.7 | 0.784 · 0.783 · 0.783 · 0.783 | 1.056 · 1.058 · 1.058 · 1.058 |
| `dbt12_ea1141` window | 32 | 0.0988 · 0.0989 · 0.0989 · 0.0989 | 0 · -0.1 · -0.2 · -0.1 | 0.931 · 0.929 · 0.929 · 0.929 | 1.030 · 1.028 · 1.028 · 1.027 |
| `dbt12_ea1141` window | 56 | 0.0040 · 0.0018 · 0.0017 · 0.0016 | 0 · +54.7 · +58.0 · +59.2 | 1.006 · 1.008 · 1.010 · 1.012 | 1.010 · 1.010 · 1.012 · 1.014 |
| `mr9_ispy2` 9bit | 2 | 0.3173 · 0.3216 · 0.3202 · 0.3187 | 0 · -1.4 · -0.9 · -0.5 | 0.764 · 0.780 · 0.781 · 0.781 | 1.082 · 1.101 · 1.101 · 1.100 |
| `mr9_ispy2` 9bit | 8 | 0.0564 · 0.0532 · 0.0528 · 0.0524 | 0 · +5.8 · +6.5 · +7.1 | 0.954 · 0.955 · 0.958 · 0.958 | 1.010 · 1.009 · 1.010 · 1.010 |
| `mr9_ispy2` 9bit | 16 | 0.0212 · 0.0184 · 0.0180 · 0.0177 | 0 · +13.5 · +15.1 · +16.6 | 0.987 · 0.987 · 0.989 · 0.990 | 1.008 · 1.006 · 1.007 · 1.007 |
| `mr9_ispy2` 9bit | 32 | 0.0060 · 0.0040 · 0.0038 · 0.0037 | 0 · +32.7 · +35.8 · +37.7 | 1.001 · 1.002 · 1.003 · 1.004 | 1.007 · 1.006 · 1.007 · 1.008 |
| `mr9_ispy2` 9bit | 56 | 0.0015 · 0.0008 · 0.0007 · 0.0007 | 0 · +46.3 · +51.0 · +55.3 | 1.008 · 1.008 · 1.010 · 1.011 | 1.009 · 1.009 · 1.011 · 1.011 |
| `mr_ispy1` 11bit | 2 | 0.3701 · 0.3830 · 0.3842 · 0.3845 | 0 · -3.5 · -3.8 · -3.9 | 0.628 · 0.628 · 0.628 · 0.628 | 0.998 · 1.011 · 1.012 · 1.013 |
| `mr_ispy1` 11bit | 8 | 0.0448 · 0.0444 · 0.0445 · 0.0445 | 0 · +0.7 · +0.6 · +0.6 | 0.950 · 0.954 · 0.954 · 0.954 | 0.995 · 0.998 · 0.998 · 0.999 |
| `mr_ispy1` 11bit | 16 | 0.0098 · 0.0095 · 0.0094 · 0.0094 | 0 · +3.3 · +4.1 · +4.0 | 0.991 · 0.992 · 0.992 · 0.992 | 1.001 · 1.001 · 1.001 · 1.001 |
| `mr_ispy1` 11bit | 32 | 0.0026 · 0.0021 · 0.0020 · 0.0020 | 0 · +18.8 · +21.2 · +23.2 | 1.001 · 1.001 · 1.001 · 1.001 | 1.003 · 1.003 · 1.003 · 1.003 |
| `mr_ispy1` 11bit | 56 | 0.0004 · 0.0002 · 0.0002 · 0.0002 | 0 · +40.1 · +44.4 · +49.7 | 1.001 · 1.001 · 1.002 · 1.002 | 1.001 · 1.002 · 1.002 · 1.003 |
| `mr_ispy1` top10 | 2 | 0.3912 · 0.4241 · 0.4263 · 0.4279 | 0 · -8.4 · -9.0 · -9.4 | 0.597 · 0.595 · 0.594 · 0.594 | 0.988 · 1.019 · 1.021 · 1.022 |
| `mr_ispy1` top10 | 8 | 0.1269 · 0.1287 · 0.1286 · 0.1285 | 0 · -1.4 · -1.4 · -1.3 | 0.854 · 0.857 · 0.858 · 0.859 | 0.981 · 0.986 · 0.987 · 0.987 |
| `mr_ispy1` top10 | 16 | 0.0348 · 0.0342 · 0.0340 · 0.0339 | 0 · +1.8 · +2.1 · +2.6 | 0.962 · 0.964 · 0.964 · 0.964 | 0.997 · 0.998 · 0.998 · 0.998 |
| `mr_ispy1` top10 | 32 | 0.0074 · 0.0070 · 0.0069 · 0.0068 | 0 · +6.5 · +7.7 · +8.1 | 0.994 · 0.995 · 0.995 · 0.995 | 1.002 · 1.002 · 1.002 · 1.002 |
| `mr_ispy1` top10 | 56 | 0.0009 · 0.0007 · 0.0007 · 0.0007 | 0 · +22.3 · +25.5 · +27.6 | 1.002 · 1.002 · 1.003 · 1.003 | 1.003 · 1.003 · 1.003 · 1.004 |
| `mr_ispy1` window | 2 | 0.9329 · 0.9398 · 0.9401 · 0.9405 | 0 · -0.7 · -0.8 · -0.8 | 0.211 · 0.210 · 0.210 · 0.210 | 1.144 · 1.150 · 1.150 · 1.150 |
| `mr_ispy1` window | 8 | 0.4648 · 0.4909 · 0.4926 · 0.4943 | 0 · -5.6 · -6.0 · -6.3 | 0.544 · 0.540 · 0.540 · 0.539 | 1.009 · 1.031 · 1.032 · 1.034 |
| `mr_ispy1` window | 16 | 0.3035 · 0.3142 · 0.3149 · 0.3155 | 0 · -3.5 · -3.8 · -4.0 | 0.680 · 0.679 · 0.679 · 0.679 | 0.983 · 0.993 · 0.993 · 0.994 |
| `mr_ispy1` window | 32 | 0.1432 · 0.1486 · 0.1488 · 0.1490 | 0 · -3.8 · -3.9 · -4.1 | 0.850 · 0.851 · 0.851 · 0.851 | 0.993 · 1.000 · 1.000 · 1.000 |
| `mr_ispy1` window | 56 | 0.0076 · 0.0076 · 0.0076 · 0.0076 | 0 · -0.3 · +0.1 · +0.1 | 0.997 · 0.998 · 0.998 · 0.998 | 1.005 · 1.005 · 1.005 · 1.005 |
| `rf_fluoro` 12bit | 2 | 0.4827 · 0.4663 · 0.4621 · 0.4609 | 0 · +3.4 · +4.3 · +4.5 | 0.569 · 0.579 · 0.580 · 0.580 | 1.051 · 1.045 · 1.042 · 1.041 |
| `rf_fluoro` 12bit | 8 | 0.0856 · 0.0851 · 0.0850 · 0.0850 | 0 · +0.6 · +0.8 · +0.7 | 0.925 · 0.924 · 0.924 · 0.925 | 1.011 · 1.009 · 1.009 · 1.010 |
| `rf_fluoro` 12bit | 16 | 0.0148 · 0.0127 · 0.0127 · 0.0126 | 0 · +13.9 · +14.0 · +14.6 | 0.977 · 0.978 · 0.978 · 0.978 | 0.992 · 0.991 · 0.991 · 0.990 |
| `rf_fluoro` 12bit | 32 | 0.0049 · 0.0035 · 0.0033 · 0.0032 | 0 · +29.4 · +32.2 · +35.4 | 0.989 · 0.988 · 0.988 · 0.988 | 0.993 · 0.991 · 0.991 · 0.991 |
| `rf_fluoro` 12bit | 56 | 0.0011 · 0.0007 · 0.0006 · 0.0006 | 0 · +42.3 · +44.1 · +49.2 | 1.002 · 1.003 · 1.006 · 1.005 | 1.003 · 1.004 · 1.007 · 1.006 |
| `rf_fluoro` top10 | 2 | 0.3828 · 0.3828 · 0.3816 · 0.3815 | 0 · +0.0 · +0.3 · +0.3 | 0.672 · 0.674 · 0.674 · 0.674 | 1.055 · 1.057 · 1.056 · 1.056 |
| `rf_fluoro` top10 | 8 | 0.0802 · 0.0798 · 0.0796 · 0.0794 | 0 · +0.6 · +0.8 · +1.0 | 0.931 · 0.930 · 0.930 · 0.930 | 1.011 · 1.010 · 1.010 · 1.010 |
| `rf_fluoro` top10 | 16 | 0.0164 · 0.0142 · 0.0142 · 0.0141 | 0 · +13.6 · +13.2 · +13.7 | 0.977 · 0.977 · 0.977 · 0.977 | 0.993 · 0.992 · 0.992 · 0.992 |
| `rf_fluoro` top10 | 32 | 0.0056 · 0.0040 · 0.0039 · 0.0037 | 0 · +28.4 · +30.7 · +33.1 | 0.988 · 0.988 · 0.988 · 0.988 | 0.994 · 0.992 · 0.992 · 0.992 |
| `rf_fluoro` top10 | 56 | 0.0014 · 0.0008 · 0.0008 · 0.0008 | 0 · +40.2 · +42.0 · +46.2 | 1.000 · 1.001 · 1.004 · 1.003 | 1.002 · 1.002 · 1.004 · 1.004 |
| `rf_fluoro` window | 2 | 0.4402 · 0.4402 · 0.4403 · 0.4406 | 0 · +0.0 · -0.0 · -0.1 | 0.643 · 0.644 · 0.644 · 0.645 | 1.083 · 1.085 · 1.085 · 1.085 |
| `rf_fluoro` window | 8 | 0.1579 · 0.1587 · 0.1596 · 0.1598 | 0 · -0.5 · -1.1 · -1.2 | 0.875 · 0.874 · 0.872 · 0.872 | 1.033 · 1.033 · 1.032 · 1.032 |
| `rf_fluoro` window | 16 | 0.0493 · 0.0481 · 0.0478 · 0.0477 | 0 · +2.5 · +3.2 · +3.3 | 0.963 · 0.963 · 0.962 · 0.962 | 1.012 · 1.011 · 1.010 · 1.010 |
| `rf_fluoro` window | 32 | 0.0096 · 0.0073 · 0.0069 · 0.0067 | 0 · +24.8 · +28.2 · +30.4 | 0.990 · 0.990 · 0.989 · 0.989 | 0.999 · 0.997 · 0.996 · 0.996 |
| `rf_fluoro` window | 56 | 0.0023 · 0.0013 · 0.0012 · 0.0011 | 0 · +41.9 · +47.6 · +50.8 | 1.002 · 1.000 · 0.998 · 0.998 | 1.004 · 1.001 · 1.000 · 0.999 |
| `ustrus_1` 8bit | 2 | 0.6929 · 0.6053 · 0.5992 · 0.5932 | 0 · +12.6 · +13.5 · +14.4 | 0.475 · 0.491 · 0.493 · 0.495 | 1.168 · 1.097 · 1.092 · 1.088 |
| `ustrus_1` 8bit | 8 | 0.3377 · 0.2647 · 0.2599 · 0.2549 | 0 · +21.6 · +23.0 · +24.5 | 0.722 · 0.727 · 0.727 · 0.727 | 1.060 · 0.992 · 0.987 · 0.982 |
| `ustrus_1` 8bit | 16 | 0.1861 · 0.1350 · 0.1316 · 0.1283 | 0 · +27.5 · +29.3 · +31.1 | 0.849 · 0.849 · 0.850 · 0.848 | 1.035 · 0.984 · 0.981 · 0.976 |
| `ustrus_1` 8bit | 32 | 0.0632 · 0.0402 · 0.0388 · 0.0374 | 0 · +36.4 · +38.6 · +40.8 | 0.957 · 0.962 · 0.962 · 0.962 | 1.020 · 1.002 · 1.001 · 1.000 |
| `ustrus_1` 8bit | 56 | 0.0088 · 0.0041 · 0.0038 · 0.0035 | 0 · +53.1 · +56.6 · +59.9 | 1.039 · 1.038 · 1.038 · 1.029 | 1.048 · 1.043 · 1.042 · 1.032 |
| `ustrus_2` 8bit | 2 | 0.7034 · 0.6099 · 0.6034 · 0.5969 | 0 · +13.3 · +14.2 · +15.1 | 0.460 · 0.480 · 0.481 · 0.484 | 1.164 · 1.089 · 1.084 · 1.080 |
| `ustrus_2` 8bit | 8 | 0.3471 · 0.2732 · 0.2683 · 0.2634 | 0 · +21.3 · +22.7 · +24.1 | 0.713 · 0.716 · 0.717 · 0.718 | 1.060 · 0.990 · 0.985 · 0.981 |
| `ustrus_2` 8bit | 16 | 0.1837 · 0.1339 · 0.1308 · 0.1273 | 0 · +27.1 · +28.8 · +30.7 | 0.848 · 0.849 · 0.846 · 0.848 | 1.032 · 0.983 · 0.977 · 0.975 |
| `ustrus_2` 8bit | 32 | 0.0579 · 0.0365 · 0.0352 · 0.0340 | 0 · +37.1 · +39.2 · +41.4 | 0.961 · 0.965 · 0.965 · 0.963 | 1.019 · 1.001 · 1.000 · 0.997 |
| `ustrus_2` 8bit | 56 | 0.0086 · 0.0038 · 0.0034 · 0.0031 | 0 · +56.2 · +60.4 · +64.4 | 1.026 · 1.027 · 1.028 · 1.026 | 1.035 · 1.031 · 1.032 · 1.029 |

#### Quality, other sound sets

Each cell: G = 1 · 8 · 16 · whole; against the source at its depth b.

| series, form | Q | PSNR / in-window PSNR, dB | SSIM mean | SSIM min frame | max \|Δ\| | 1st window: % differ / % > 1 / max Δcode |
| --- | --- | --- | --- | --- | --- | --- |
| `dbt10_d` 10bit | 2 | 61.77/60.22 · 61.73/60.18 · 61.72/60.18 · 61.72/60.18 | 0.9994 · 0.9994 · 0.9994 · 0.9994 | 0.9994 · 0.9994 · 0.9994 · 0.9994 | 17 · 30 · 29 · 29 | 35.9/0.4/3 · 36.1/0.5/12 · 36.1/0.5/12 · 36.1/0.5/14 |
| `dbt10_d` 10bit | 8 | 49.27/47.72 · 49.40/47.85 · 49.41/47.86 · 49.41/47.87 | 0.9900 · 0.9904 · 0.9904 · 0.9904 | 0.9898 · 0.9898 · 0.9899 · 0.9900 | 85 · 65 · 65 · 65 | 81.2/47.6/26 · 80.9/47.0/28 · 80.9/46.9/29 · 80.9/46.9/31 |
| `dbt10_d` 10bit | 16 | 44.34/42.80 · 44.42/42.87 · 44.42/42.88 · 44.42/42.88 | 0.9695 · 0.9703 · 0.9703 · 0.9704 | 0.9685 · 0.9686 · 0.9692 · 0.9692 | 322 · 310 · 179 · 177 | 89.0/67.9/71 · 88.9/67.7/71 · 88.9/67.6/48 · 88.9/67.6/57 |
| `dbt10_d` 10bit | 32 | 40.68/39.18 · 40.52/39.01 · 40.50/39.00 · 40.49/38.98 | 0.9364 · 0.9363 · 0.9364 · 0.9365 | 0.9347 · 0.9347 · 0.9350 · 0.9357 | 466 · 499 · 466 · 405 | 92.4/77.5/105 · 92.5/77.9/116 · 92.5/77.9/124 · 92.5/77.9/116 |
| `dbt10_d` 10bit | 56 | 36.08/35.09 · 35.91/34.89 · 35.83/34.78 · 35.73/34.65 | 0.9009 · 0.9029 · 0.9037 · 0.9014 | 0.8901 · 0.8904 · 0.8931 · 0.8932 | 615 · 559 · 591 · 540 | 94.9/84.8/182 · 95.0/85.1/216 · 95.1/85.4/205 · 95.2/85.6/230 |
| `dbt10_ea1141` 10bit | 2 | 62.05/60.26 · 62.08/60.30 · 62.08/60.30 · 62.08/60.30 | 0.9995 · 0.9995 · 0.9995 · 0.9995 | 0.9995 · 0.9995 · 0.9995 · 0.9995 | 9 · 19 · 22 · 24 | 35.8/0.4/3 · 35.6/0.4/9 · 35.6/0.4/9 · 35.6/0.4/10 |
| `dbt10_ea1141` 10bit | 8 | 49.42/47.65 · 49.55/47.77 · 49.55/47.78 · 49.56/47.79 | 0.9912 · 0.9915 · 0.9915 · 0.9915 | 0.9907 · 0.9909 · 0.9909 · 0.9909 | 80 · 59 · 59 · 70 | 81.4/48.0/13 · 81.1/47.4/27 · 81.1/47.3/28 · 81.1/47.3/35 |
| `dbt10_ea1141` 10bit | 16 | 44.25/42.48 · 44.37/42.60 · 44.38/42.61 · 44.38/42.61 | 0.9713 · 0.9723 · 0.9723 · 0.9724 | 0.9693 · 0.9705 · 0.9705 · 0.9705 | 343 · 132 · 131 · 131 | 89.4/69.1/43 · 89.3/68.7/66 · 89.3/68.7/66 · 89.3/68.7/66 |
| `dbt10_ea1141` 10bit | 32 | 40.31/38.61 · 40.17/38.47 · 40.16/38.46 · 40.13/38.44 | 0.9356 · 0.9349 · 0.9349 · 0.9346 | 0.9325 · 0.9330 · 0.9330 · 0.9326 | 417 · 337 · 337 · 340 | 93.1/79.5/94 · 93.2/79.8/76 · 93.2/79.8/82 · 93.2/79.8/96 |
| `dbt10_ea1141` 10bit | 56 | 35.36/34.02 · 35.00/33.67 · 34.92/33.58 · 34.89/33.51 | 0.8896 · 0.8896 · 0.8893 · 0.8902 | 0.8760 · 0.8857 · 0.8857 · 0.8858 | 522 · 504 · 504 · 504 | 95.7/87.0/163 · 95.8/87.4/143 · 95.8/87.5/143 · 95.9/87.7/133 |
| `dbt12_c` 12bit | 2 | 66.93/64.13 · 66.50/63.70 · 66.47/63.67 · 66.43/63.64 | 0.9998 · 0.9998 · 0.9998 · 0.9998 | 0.9998 · 0.9998 · 0.9998 · 0.9998 | 31 · 72 · 72 · 79 | 36.9/1.6/4 · 38.2/2.1/4 · 38.3/2.2/4 · 38.4/2.2/4 |
| `dbt12_c` 12bit | 8 | 50.96/48.14 · 51.06/48.24 · 51.06/48.24 · 51.07/48.24 | 0.9924 · 0.9927 · 0.9927 · 0.9927 | 0.9919 · 0.9920 · 0.9920 · 0.9920 | 291 · 282 · 218 · 208 | 83.8/57.8/27 · 83.6/57.4/26 · 83.6/57.4/26 · 83.6/57.4/27 |
| `dbt12_c` 12bit | 16 | 46.41/43.60 · 46.40/43.61 · 46.40/43.61 · 46.40/43.61 | 0.9790 · 0.9791 · 0.9791 · 0.9792 | 0.9774 · 0.9774 · 0.9774 · 0.9774 | 401 · 393 · 409 · 413 | 89.3/71.4/69 · 89.3/71.4/59 · 89.3/71.4/54 · 89.3/71.4/59 |
| `dbt12_c` 12bit | 32 | 44.25/41.59 · 43.99/41.34 · 43.96/41.31 · 43.91/41.27 | 0.9717 · 0.9718 · 0.9719 · 0.9720 | 0.9695 · 0.9695 · 0.9701 · 0.9701 | 1055 · 659 · 668 · 687 | 91.6/77.0/109 · 91.8/77.6/104 · 91.8/77.6/85 · 91.9/77.7/83 |
| `dbt12_c` 12bit | 56 | 38.78/36.99 · 38.38/36.48 · 38.12/36.16 · 37.71/35.64 | 0.9390 · 0.9335 · 0.9340 · 0.9352 | 0.9111 · 0.9166 · 0.9224 · 0.9334 | 2363 · 2284 · 2284 · 1909 | 94.7/84.8/228 · 94.9/85.4/224 · 95.1/85.8/217 · 95.3/86.6/203 |
| `dbt12_c` top10 | 2 | 62.60/59.79 · 62.55/59.74 · 62.54/59.73 · 62.53/59.73 | 0.9995 · 0.9995 · 0.9995 · 0.9995 | 0.9995 · 0.9995 · 0.9995 · 0.9995 | 50 · 90 · 85 · 91 | 52.8/9.9/6 · 53.0/10.0/7 · 53.0/10.0/7 · 53.0/10.0/7 |
| `dbt12_c` top10 | 8 | 50.63/47.80 · 50.71/47.89 · 50.71/47.89 · 50.72/47.89 | 0.9919 · 0.9921 · 0.9921 · 0.9921 | 0.9914 · 0.9915 · 0.9915 · 0.9915 | 291 · 241 · 248 · 359 | 84.3/59.1/29 · 84.2/58.8/32 · 84.2/58.8/29 · 84.2/58.7/29 |
| `dbt12_c` top10 | 16 | 46.58/43.76 · 46.56/43.75 · 46.55/43.75 · 46.55/43.75 | 0.9800 · 0.9801 · 0.9801 · 0.9801 | 0.9786 · 0.9786 · 0.9786 · 0.9786 | 395 · 394 · 367 · 352 | 89.1/71.0/60 · 89.1/71.1/57 · 89.1/71.1/54 · 89.1/71.1/58 |
| `dbt12_c` top10 | 32 | 44.55/41.83 · 44.42/41.72 · 44.40/41.71 · 44.37/41.68 | 0.9736 · 0.9736 · 0.9736 · 0.9736 | 0.9713 · 0.9714 · 0.9715 · 0.9715 | 860 · 580 · 572 · 576 | 91.3/76.4/104 · 91.4/76.7/99 · 91.5/76.7/73 · 91.5/76.8/71 |
| `dbt12_c` top10 | 56 | 40.07/37.99 · 39.82/37.70 · 39.73/37.56 · 39.53/37.30 | 0.9487 · 0.9478 · 0.9517 · 0.9516 | 0.9355 · 0.9358 · 0.9464 · 0.9496 | 2302 · 1987 · 1907 · 1907 | 94.2/83.6/202 · 94.4/84.0/199 · 94.5/84.2/212 · 94.6/84.7/194 |
| `dbt12_c` window | 2 | 7.48/33.77 · 7.48/33.77 · 7.48/33.77 · 7.48/33.77 | 0.5076 · 0.5076 · 0.5076 · 0.5076 | 0.4218 · 0.4218 · 0.4218 · 0.4218 | 2491 · 2490 · 2490 · 2491 | 27.0/14.4/30 · 27.2/14.4/30 · 27.2/14.4/30 · 27.2/14.4/30 |
| `dbt12_c` window | 8 | 7.48/33.76 · 7.48/33.76 · 7.48/33.76 · 7.48/33.76 | 0.5072 · 0.5072 · 0.5072 · 0.5072 | 0.4215 · 0.4215 · 0.4215 · 0.4215 | 2497 · 2497 · 2495 · 2494 | 59.4/20.7/31 · 59.7/20.9/31 · 59.8/20.9/31 · 59.8/20.9/35 |
| `dbt12_c` window | 16 | 7.48/33.72 · 7.48/33.72 · 7.48/33.72 · 7.48/33.72 | 0.5059 · 0.5059 · 0.5059 · 0.5059 | 0.4203 · 0.4203 · 0.4203 · 0.4203 | 2506 · 2504 · 2500 · 2500 | 79.0/45.2/43 · 79.1/45.5/35 · 79.2/45.5/41 · 79.2/45.5/33 |
| `dbt12_c` window | 32 | 7.48/33.54 · 7.48/33.55 · 7.48/33.55 · 7.48/33.55 | 0.4978 · 0.4982 · 0.4982 · 0.4982 | 0.4128 · 0.4131 · 0.4131 · 0.4131 | 2514 · 2508 · 2514 · 2509 | 90.7/73.0/73 · 90.6/72.7/43 · 90.6/72.6/63 · 90.6/72.6/45 |
| `dbt12_c` window | 56 | 7.48/33.09 · 7.48/33.09 · 7.48/33.10 · 7.48/33.10 | 0.4842 · 0.4841 · 0.4841 · 0.4840 | 0.4008 · 0.4007 · 0.4007 · 0.4006 | 2565 · 2555 · 2555 · 2622 | 94.4/83.5/147 · 94.5/83.6/103 · 94.5/83.6/111 · 94.5/83.6/103 |
| `dbt12_ea1141` 12bit | 2 | 65.91/64.11 · 65.92/64.12 · 65.92/64.12 · 65.92/64.13 | 0.9998 · 0.9998 · 0.9998 · 0.9998 | 0.9997 · 0.9997 · 0.9997 · 0.9997 | 19 · 61 · 50 · 57 | 51.6/8.7/5 · 51.6/8.6/5 · 51.6/8.6/5 · 51.6/8.6/6 |
| `dbt12_ea1141` 12bit | 8 | 50.19/48.37 · 50.26/48.45 · 50.26/48.44 · 50.25/48.44 | 0.9908 · 0.9910 · 0.9910 · 0.9910 | 0.9907 · 0.9908 · 0.9908 · 0.9908 | 165 · 163 · 163 · 181 | 89.5/71.1/37 · 89.4/70.9/36 · 89.4/70.9/33 · 89.4/70.9/37 |
| `dbt12_ea1141` 12bit | 16 | 45.74/43.95 · 45.72/43.93 · 45.71/43.92 · 45.71/43.93 | 0.9752 · 0.9753 · 0.9752 · 0.9753 | 0.9747 · 0.9748 · 0.9747 · 0.9748 | 277 · 376 · 376 · 371 | 93.4/81.7/81 · 93.4/81.7/60 · 93.4/81.7/67 · 93.4/81.7/67 |
| `dbt12_ea1141` 12bit | 32 | 43.70/42.08 · 43.44/41.83 · 43.38/41.78 · 43.34/41.75 | 0.9674 · 0.9672 · 0.9671 · 0.9669 | 0.9651 · 0.9645 · 0.9645 · 0.9641 | 540 · 488 · 488 · 527 | 94.7/85.1/144 · 94.9/85.5/102 · 94.9/85.6/101 · 94.9/85.6/101 |
| `dbt12_ea1141` 12bit | 56 | 38.52/37.75 · 38.18/37.17 · 37.81/36.75 · 37.73/36.60 | 0.9352 · 0.9368 · 0.9392 · 0.9401 | 0.9204 · 0.9279 · 0.9331 · 0.9326 | 1374 · 1364 · 1364 · 1364 | 96.7/90.3/200 · 96.8/90.6/229 · 96.8/90.8/192 · 96.9/91.0/188 |
| `dbt12_ea1141` top10 | 2 | 61.60/59.79 · 61.62/59.81 · 61.62/59.81 · 61.62/59.81 | 0.9994 · 0.9994 · 0.9994 · 0.9994 | 0.9993 · 0.9993 · 0.9993 · 0.9993 | 29 · 87 · 56 · 67 | 65.4/24.8/8 · 65.4/24.7/9 · 65.4/24.7/9 · 65.4/24.7/8 |
| `dbt12_ea1141` top10 | 8 | 49.88/48.06 · 49.95/48.13 · 49.95/48.13 · 49.94/48.13 | 0.9902 · 0.9904 · 0.9904 · 0.9904 | 0.9901 · 0.9901 · 0.9902 · 0.9902 | 164 · 181 · 186 · 176 | 89.8/72.0/37 · 89.8/71.8/37 · 89.8/71.8/37 · 89.8/71.8/37 |
| `dbt12_ea1141` top10 | 16 | 45.96/44.15 · 45.90/44.10 · 45.89/44.09 · 45.87/44.08 | 0.9765 · 0.9764 · 0.9764 · 0.9763 | 0.9760 · 0.9757 · 0.9757 · 0.9753 | 260 · 307 · 317 · 328 | 93.3/81.3/58 · 93.3/81.4/61 · 93.3/81.4/59 · 93.4/81.4/58 |
| `dbt12_ea1141` top10 | 32 | 43.98/42.30 · 43.84/42.17 · 43.81/42.14 · 43.78/42.11 | 0.9686 · 0.9686 · 0.9685 · 0.9684 | 0.9671 · 0.9663 · 0.9663 · 0.9667 | 446 · 473 · 473 · 529 | 94.6/84.8/99 · 94.7/85.0/100 · 94.7/85.0/101 · 94.7/85.0/101 |
| `dbt12_ea1141` top10 | 56 | 39.80/38.69 · 39.51/38.34 · 39.34/38.16 · 39.39/38.15 | 0.9468 · 0.9462 · 0.9454 · 0.9460 | 0.9379 · 0.9375 · 0.9375 · 0.9397 | 1380 · 1372 · 1372 · 1372 | 96.3/89.3/187 · 96.4/89.6/177 · 96.5/89.7/163 · 96.5/89.8/161 |
| `dbt12_ea1141` window | 2 | 13.55/38.90 · 13.55/38.90 · 13.55/38.90 · 13.55/38.90 | 0.6443 · 0.6443 · 0.6443 · 0.6443 | 0.6084 · 0.6084 · 0.6084 · 0.6084 | 1454 · 1454 · 1454 · 1454 | 25.6/12.5/30 · 25.6/12.5/30 · 25.6/12.5/30 · 25.6/12.5/30 |
| `dbt12_ea1141` window | 8 | 13.55/38.87 · 13.55/38.87 · 13.55/38.87 · 13.55/38.87 | 0.6440 · 0.6441 · 0.6441 · 0.6441 | 0.6081 · 0.6081 · 0.6081 · 0.6081 | 1458 · 1455 · 1455 · 1455 | 61.1/21.2/31 · 60.5/20.5/31 · 60.5/20.5/31 · 60.5/20.5/31 |
| `dbt12_ea1141` window | 16 | 13.55/38.81 · 13.55/38.80 · 13.55/38.80 · 13.55/38.80 | 0.6431 · 0.6431 · 0.6431 · 0.6431 | 0.6072 · 0.6071 · 0.6072 · 0.6072 | 1465 · 1461 · 1463 · 1460 | 80.5/48.5/32 · 80.6/48.6/32 · 80.5/48.6/33 · 80.6/48.7/32 |
| `dbt12_ea1141` window | 32 | 13.55/38.49 · 13.55/38.49 · 13.55/38.49 · 13.55/38.49 | 0.6371 · 0.6373 · 0.6373 · 0.6373 | 0.6012 · 0.6014 · 0.6013 · 0.6013 | 1474 · 1472 · 1472 · 1474 | 91.8/76.3/49 · 91.7/76.1/37 · 91.7/76.1/37 · 91.7/76.1/38 |
| `dbt12_ea1141` window | 56 | 13.54/37.40 · 13.54/37.37 · 13.54/37.37 · 13.54/37.36 | 0.6181 · 0.6179 · 0.6179 · 0.6178 | 0.5842 · 0.5840 · 0.5840 · 0.5839 | 1503 · 1503 · 1500 · 1494 | 95.9/87.9/96 · 95.9/88.0/98 · 95.9/88.0/100 · 95.9/88.0/100 |
| `mr9_ispy2` 9bit | 2 | 54.95/54.95 · 54.76/54.76 · 54.71/54.71 · 54.69/54.69 | 0.9960 · 0.9959 · 0.9959 · 0.9958 | 0.9955 · 0.9954 · 0.9952 · 0.9949 | 5 · 10 · 12 · 15 | 53.9/37.3/9 · 55.4/38.8/18 · 55.8/39.1/22 · 55.9/39.0/27 |
| `mr9_ispy2` 9bit | 8 | 47.38/47.39 · 47.31/47.32 · 47.29/47.30 · 47.30/47.31 | 0.9804 · 0.9799 · 0.9798 · 0.9799 | 0.9781 · 0.9778 · 0.9776 · 0.9774 | 31 · 30 · 42 · 34 | 72.3/57.4/56 · 72.3/57.5/54 · 72.4/57.5/75 · 72.3/57.4/61 |
| `mr9_ispy2` 9bit | 16 | 44.09/44.11 · 44.10/44.12 · 44.08/44.11 · 44.07/44.09 | 0.9613 · 0.9627 · 0.9626 · 0.9623 | 0.9544 · 0.9554 · 0.9550 · 0.9549 | 63 · 66 · 70 · 66 | 77.4/64.1/113 · 76.2/62.3/118 · 76.2/62.3/124 · 76.0/62.2/118 |
| `mr9_ispy2` 9bit | 32 | 40.64/40.77 · 40.52/40.65 · 40.51/40.63 · 40.47/40.59 | 0.9340 · 0.9329 · 0.9331 · 0.9317 | 0.9127 · 0.9131 · 0.9133 · 0.9105 | 140 · 127 · 127 · 140 | 79.7/66.0/167 · 79.4/66.0/166 · 79.1/65.8/165 · 79.4/66.3/165 |
| `mr9_ispy2` 9bit | 56 | 36.40/36.67 · 36.29/36.58 · 36.19/36.46 · 35.98/36.24 | 0.8590 · 0.8667 · 0.8667 · 0.8693 | 0.8199 · 0.8286 · 0.8286 · 0.8397 | 296 · 308 · 305 · 309 | 87.1/78.9/204 · 85.3/76.0/192 · 85.3/75.7/206 · 84.5/74.6/213 |
| `mr_ispy1` 11bit | 2 | 58.97/58.90 · 59.02/58.95 · 59.02/58.95 · 59.02/58.95 | 0.9988 · 0.9988 · 0.9988 · 0.9988 | 0.9986 · 0.9986 · 0.9986 · 0.9986 | 20 · 20 · 22 · 22 | 77.1/42.8/17 · 77.0/42.6/17 · 77.0/42.6/18 · 77.0/42.6/18 |
| `mr_ispy1` 11bit | 8 | 44.99/44.92 · 44.94/44.86 · 44.94/44.87 · 44.94/44.87 | 0.9682 · 0.9678 · 0.9679 · 0.9679 | 0.9643 · 0.9632 · 0.9635 · 0.9635 | 75 · 86 · 83 · 86 | 94.9/86.1/61 · 95.0/86.1/70 · 95.0/86.1/66 · 94.9/86.1/70 |
| `mr_ispy1` 11bit | 16 | 41.96/42.04 · 41.97/42.05 · 41.97/42.05 · 41.99/42.06 | 0.9420 · 0.9425 · 0.9427 · 0.9429 | 0.9370 · 0.9376 · 0.9379 · 0.9380 | 167 · 226 · 223 · 229 | 96.1/89.4/137 · 96.1/89.3/185 · 96.1/89.3/180 · 96.1/89.2/187 |
| `mr_ispy1` 11bit | 32 | 39.41/40.12 · 39.29/40.04 · 39.28/40.03 · 39.25/40.02 | 0.9196 · 0.9197 · 0.9197 · 0.9195 | 0.8931 · 0.8913 · 0.8922 · 0.8916 | 433 · 618 · 524 · 636 | 96.6/90.9/209 · 96.6/90.9/237 · 96.6/90.9/237 · 96.4/90.6/219 |
| `mr_ispy1` 11bit | 56 | 34.29/36.41 · 34.30/36.51 · 34.27/36.42 · 34.23/36.37 | 0.8676 · 0.8713 · 0.8715 · 0.8720 | 0.8185 · 0.8211 · 0.8175 · 0.8170 | 1009 · 1084 · 1084 · 1099 | 97.9/93.7/249 · 97.9/93.7/249 · 97.9/93.5/249 · 97.9/92.6/249 |
| `mr_ispy1` top10 | 2 | 60.12/60.05 · 60.23/60.16 · 60.24/60.17 · 60.24/60.17 | 0.9990 · 0.9991 · 0.9991 · 0.9991 | 0.9989 · 0.9989 · 0.9990 · 0.9990 | 19 · 23 · 23 · 23 | 73.3/36.8/16 · 72.9/36.4/19 · 72.9/36.4/19 · 72.9/36.4/19 |
| `mr_ispy1` top10 | 8 | 49.71/49.63 · 49.67/49.59 · 49.66/49.58 · 49.66/49.58 | 0.9893 · 0.9892 · 0.9892 · 0.9892 | 0.9880 · 0.9879 · 0.9880 · 0.9880 | 46 · 54 · 52 · 52 | 91.7/77.2/38 · 91.8/77.4/44 · 91.8/77.4/43 · 91.8/77.3/43 |
| `mr_ispy1` top10 | 16 | 44.33/44.26 · 44.26/44.20 · 44.26/44.20 · 44.25/44.19 | 0.9631 · 0.9626 · 0.9626 · 0.9626 | 0.9596 · 0.9588 · 0.9591 · 0.9591 | 82 · 85 · 85 · 85 | 95.5/87.1/67 · 95.5/87.0/70 · 95.5/87.0/70 · 95.5/86.9/70 |
| `mr_ispy1` top10 | 32 | 41.55/41.69 · 41.49/41.62 · 41.48/41.62 · 41.47/41.61 | 0.9388 · 0.9384 · 0.9384 · 0.9384 | 0.9304 · 0.9300 · 0.9301 · 0.9296 | 204 · 231 · 237 · 243 | 96.3/89.5/167 · 96.3/89.4/183 · 96.3/89.4/178 · 96.3/89.2/170 |
| `mr_ispy1` top10 | 56 | 37.26/38.74 · 37.16/38.61 · 37.15/38.62 · 37.15/38.61 | 0.8958 · 0.8945 · 0.8946 · 0.8952 | 0.8582 · 0.8552 · 0.8574 · 0.8582 | 837 · 812 · 734 · 745 | 97.0/91.6/249 · 97.1/91.7/249 · 97.2/91.7/249 · 97.3/91.5/253 |
| `mr_ispy1` window | 2 | 35.88/76.18 · 35.88/76.22 · 35.88/76.22 · 35.88/76.22 | 0.9897 · 0.9897 · 0.9897 · 0.9897 | 0.9695 · 0.9695 · 0.9695 · 0.9695 | 1453 · 1453 · 1453 · 1453 | 8.2/0.0/2 · 8.2/0.0/3 · 8.2/0.0/3 · 8.1/0.0/2 |
| `mr_ispy1` window | 8 | 35.87/63.90 · 35.87/64.13 · 35.87/64.15 · 35.87/64.17 | 0.9893 · 0.9893 · 0.9893 · 0.9893 | 0.9692 · 0.9692 · 0.9692 · 0.9692 | 1453 · 1453 · 1453 · 1453 | 60.4/17.0/12 · 59.7/16.1/10 · 59.6/16.0/10 · 59.5/15.9/10 |
| `mr_ispy1` window | 16 | 35.85/58.06 · 35.85/58.16 · 35.85/58.18 · 35.85/58.18 | 0.9882 · 0.9882 · 0.9882 · 0.9882 | 0.9681 · 0.9681 · 0.9682 · 0.9681 | 1453 · 1453 · 1453 · 1453 | 78.4/46.4/24 · 78.2/45.9/28 · 78.2/45.8/29 · 78.2/45.8/35 |
| `mr_ispy1` window | 32 | 35.72/50.60 · 35.72/50.67 · 35.72/50.67 · 35.72/50.68 | 0.9812 · 0.9813 · 0.9813 · 0.9813 | 0.9617 · 0.9619 · 0.9619 · 0.9618 | 1453 · 1453 · 1453 · 1454 | 90.4/74.5/40 · 90.3/74.3/45 · 90.3/74.3/45 · 90.2/74.3/45 |
| `mr_ispy1` window | 56 | 34.86/42.04 · 34.86/42.00 · 34.86/42.00 · 34.85/42.01 | 0.9318 · 0.9315 · 0.9315 · 0.9316 | 0.9081 · 0.9074 · 0.9078 · 0.9084 | 1469 · 1453 · 1453 · 1455 | 96.1/89.2/146 · 96.1/89.1/136 · 96.1/89.1/146 · 96.0/89.0/145 |
| `rf_fluoro` 12bit | 2 | 64.14/64.14 · 63.67/63.66 · 63.64/63.62 · 63.62/63.59 | 0.9996 · 0.9996 · 0.9996 · 0.9996 | 0.9996 · 0.9996 · 0.9996 · 0.9996 | 24 · 24 · 24 · 24 | 23.3/0.0/3 · 24.5/0.0/3 · 24.6/0.0/3 · 24.7/0.0/3 |
| `rf_fluoro` 12bit | 8 | 48.79/48.74 · 48.83/48.79 · 48.81/48.77 · 48.81/48.77 | 0.9878 · 0.9880 · 0.9879 · 0.9879 | 0.9863 · 0.9863 · 0.9863 · 0.9863 | 104 · 138 · 123 · 99 | 74.2/36.0/11 · 74.2/35.9/16 · 74.2/35.9/14 · 74.2/35.9/12 |
| `rf_fluoro` 12bit | 16 | 44.78/44.75 · 44.78/44.75 · 44.77/44.75 · 44.78/44.75 | 0.9711 · 0.9712 · 0.9712 · 0.9712 | 0.9523 · 0.9523 · 0.9523 · 0.9523 | 260 · 283 · 441 · 295 | 80.1/49.5/24 · 80.1/49.5/33 · 80.1/49.5/51 · 80.0/49.4/35 |
| `rf_fluoro` 12bit | 32 | 42.63/42.64 · 42.60/42.59 · 42.56/42.55 · 42.56/42.55 | 0.9625 · 0.9628 · 0.9627 · 0.9627 | 0.9400 · 0.9400 · 0.9400 · 0.9400 | 711 · 777 · 1047 · 944 | 83.8/57.0/82 · 83.8/56.9/90 · 84.0/57.1/121 · 83.9/57.0/109 |
| `rf_fluoro` 12bit | 56 | 35.55/36.47 · 35.53/36.23 · 35.31/35.99 · 35.41/36.00 | 0.9420 · 0.9413 · 0.9399 · 0.9406 | 0.9170 · 0.9170 · 0.9170 · 0.9170 | 2354 · 2533 · 2285 · 2285 | 91.1/74.2/234 · 91.4/74.8/232 · 91.5/75.0/231 · 91.4/74.9/231 |
| `rf_fluoro` top10 | 2 | 59.77/59.76 · 59.66/59.65 · 59.66/59.65 · 59.65/59.64 | 0.9990 · 0.9990 · 0.9990 · 0.9990 | 0.9990 · 0.9990 · 0.9990 · 0.9990 | 31 · 31 · 31 · 31 | 37.8/0.7/3 · 38.2/0.8/3 · 38.2/0.8/3 · 38.3/0.8/3 |
| `rf_fluoro` top10 | 8 | 48.48/48.44 · 48.52/48.48 · 48.50/48.46 · 48.49/48.46 | 0.9870 · 0.9872 · 0.9871 · 0.9871 | 0.9851 · 0.9851 · 0.9851 · 0.9851 | 107 · 105 · 105 · 115 | 74.9/37.3/12 · 74.9/37.1/12 · 74.9/37.2/12 · 75.0/37.3/13 |
| `rf_fluoro` top10 | 16 | 44.92/44.89 · 44.92/44.90 · 44.92/44.89 · 44.92/44.90 | 0.9719 · 0.9720 · 0.9720 · 0.9720 | 0.9546 · 0.9546 · 0.9546 · 0.9546 | 266 · 266 · 325 · 339 | 80.0/49.1/25 · 80.1/49.2/29 · 80.1/49.2/38 · 80.1/49.2/39 |
| `rf_fluoro` top10 | 32 | 43.02/43.02 · 43.00/42.98 · 42.98/42.96 · 42.97/42.95 | 0.9640 · 0.9641 · 0.9641 · 0.9641 | 0.9414 · 0.9414 · 0.9414 · 0.9414 | 617 · 669 · 1097 · 1097 | 83.2/55.8/60 · 83.2/55.8/77 · 83.4/55.9/105 · 83.4/55.8/115 |
| `rf_fluoro` top10 | 56 | 37.15/37.52 · 37.11/37.40 · 37.06/37.34 · 37.09/37.36 | 0.9448 · 0.9448 · 0.9443 · 0.9448 | 0.9171 · 0.9171 · 0.9171 · 0.9171 | 2307 · 2042 · 1887 · 1853 | 89.9/71.0/236 · 90.1/71.3/236 · 90.4/72.0/218 · 90.4/72.0/200 |
| `rf_fluoro` window | 2 | 32.17/65.14 · 32.17/65.06 · 32.17/65.04 · 32.17/65.03 | 0.9893 · 0.9893 · 0.9893 · 0.9893 | 0.9582 · 0.9582 · 0.9582 · 0.9582 | 1218 · 1220 · 1218 · 1220 | 19.9/0.0/5 · 20.2/0.0/5 · 20.2/0.0/5 · 20.2/0.0/6 |
| `rf_fluoro` window | 8 | 32.14/53.06 · 32.14/53.10 · 32.14/53.20 · 32.14/53.22 | 0.9855 · 0.9856 · 0.9856 · 0.9857 | 0.9550 · 0.9552 · 0.9552 · 0.9552 | 1218 · 1225 · 1222 · 1222 | 63.6/16.7/16 · 63.4/16.5/16 · 63.1/16.1/16 · 63.1/16.0/14 |
| `rf_fluoro` window | 16 | 32.05/47.44 · 32.05/47.47 · 32.05/47.50 · 32.05/47.50 | 0.9754 · 0.9755 · 0.9755 · 0.9756 | 0.9464 · 0.9467 · 0.9466 · 0.9466 | 1220 · 1225 · 1227 · 1233 | 76.3/40.9/33 · 76.3/40.9/19 · 76.3/40.8/19 · 76.3/40.8/19 |
| `rf_fluoro` window | 32 | 31.91/44.29 · 31.91/44.27 · 31.91/44.28 · 31.91/44.28 | 0.9632 · 0.9631 · 0.9632 · 0.9632 | 0.9356 · 0.9356 · 0.9357 · 0.9357 | 1240 · 1233 · 1250 · 1250 | 81.0/51.3/93 · 80.9/51.2/51 · 80.9/51.2/44 · 80.8/51.2/41 |
| `rf_fluoro` window | 56 | 31.30/39.95 · 31.35/40.07 · 31.37/40.12 · 31.39/40.18 | 0.9494 · 0.9506 · 0.9512 · 0.9515 | 0.9208 · 0.9226 · 0.9225 · 0.9225 | 2025 · 1734 · 1729 · 1729 | 87.9/65.8/234 · 87.5/65.0/151 · 87.3/64.5/160 · 87.1/64.1/160 |
| `ustrus_1` 8bit | 2 | 54.69/53.23 · 54.39/52.93 · 54.37/52.91 · 54.34/52.89 | 0.9977 · 0.9975 · 0.9975 · 0.9975 | 0.9966 · 0.9965 · 0.9965 · 0.9965 | 5 · 11 · 11 · 8 | 30.0/0.3/5 · 32.0/0.4/11 · 32.1/0.4/11 · 32.3/0.4/8 |
| `ustrus_1` 8bit | 8 | 47.33/45.88 · 47.21/45.74 · 47.20/45.73 · 47.19/45.72 | 0.9873 · 0.9871 · 0.9871 · 0.9871 | 0.9829 · 0.9827 · 0.9827 · 0.9827 | 38 · 28 · 28 · 26 | 68.1/22.7/38 · 68.6/23.3/28 · 68.6/23.4/28 · 68.6/23.4/26 |
| `ustrus_1` 8bit | 16 | 43.31/41.89 · 43.26/41.82 · 43.26/41.81 · 43.28/41.82 | 0.9716 · 0.9716 · 0.9716 · 0.9718 | 0.9667 · 0.9664 · 0.9666 · 0.9669 | 38 · 32 · 35 · 40 | 78.9/43.0/38 · 79.0/43.3/32 · 79.1/43.3/35 · 79.0/43.3/40 |
| `ustrus_1` 8bit | 32 | 38.47/37.09 · 38.39/37.01 · 38.39/37.00 · 38.41/37.01 | 0.9334 · 0.9329 · 0.9329 · 0.9331 | 0.9101 · 0.9103 · 0.9103 · 0.9094 | 73 · 91 · 133 · 69 | 86.3/61.0/73 · 86.5/61.5/91 · 86.5/61.6/133 · 86.6/61.6/69 |
| `ustrus_1` 8bit | 56 | 32.24/30.98 · 32.10/30.81 · 32.09/30.79 · 32.11/30.76 | 0.8229 · 0.8245 · 0.8258 · 0.8364 | 0.7155 · 0.7157 · 0.7157 · 0.7245 | 181 · 195 · 195 · 191 | 91.1/74.1/181 · 91.2/74.4/195 · 91.3/74.5/195 · 91.5/75.1/191 |
| `ustrus_2` 8bit | 2 | 54.70/53.22 · 54.33/52.86 · 54.31/52.84 · 54.27/52.82 | 0.9978 · 0.9976 · 0.9976 · 0.9975 | 0.9970 · 0.9969 · 0.9969 · 0.9969 | 5 · 10 · 11 · 11 | 30.1/0.3/4 · 32.4/0.4/10 · 32.6/0.4/11 · 32.8/0.4/11 |
| `ustrus_2` 8bit | 8 | 47.07/45.60 · 46.97/45.49 · 46.96/45.48 · 46.95/45.47 | 0.9869 · 0.9868 · 0.9868 · 0.9868 | 0.9831 · 0.9828 · 0.9829 · 0.9829 | 27 · 21 · 23 · 58 | 69.3/24.4/27 · 69.6/24.9/21 · 69.6/24.9/23 · 69.7/25.0/58 |
| `ustrus_2` 8bit | 16 | 42.92/41.46 · 42.89/41.41 · 42.89/41.41 · 42.89/41.41 | 0.9687 · 0.9687 · 0.9688 · 0.9688 | 0.9632 · 0.9631 · 0.9634 · 0.9634 | 46 · 45 · 31 · 43 | 80.2/45.9/46 · 80.3/46.1/45 · 80.3/46.1/31 · 80.3/46.1/43 |
| `ustrus_2` 8bit | 32 | 38.20/36.82 · 38.15/36.76 · 38.16/36.76 · 38.20/36.78 | 0.9244 · 0.9241 · 0.9242 · 0.9248 | 0.9006 · 0.9019 · 0.9019 · 0.9024 | 75 · 82 · 80 · 87 | 87.5/64.0/75 · 87.6/64.3/82 · 87.6/64.3/80 · 87.6/64.3/87 |
| `ustrus_2` 8bit | 56 | 32.54/31.33 · 32.41/31.18 · 32.39/31.15 · 32.35/31.08 | 0.8249 · 0.8260 · 0.8262 · 0.8302 | 0.7374 · 0.7426 · 0.7429 · 0.7430 | 158 · 237 · 236 · 227 | 92.0/76.4/151 · 92.1/76.6/237 · 92.1/76.8/236 · 92.3/77.2/227 |

#### Bytes, lossy-sourced, provisional

Each cell: G = 1 · 8 · 16 · whole.

| series, form | Q | lossy ÷ HTJ2K | gain % | residual ÷ HTJ2K | lossy + residual ÷ HTJ2K |
| --- | --- | --- | --- | --- | --- |
| `us_liver` rgb420 | 2 | 0.3633 · 0.3460 · 0.3449 · 0.3436 | 0 · +4.8 · +5.1 · +5.4 | 0.623 · 0.631 · 0.632 · 0.633 | 0.986 · 0.977 · 0.977 · 0.977 |
| `us_liver` rgb420 | 8 | 0.2472 · 0.2280 · 0.2268 · 0.2251 | 0 · +7.8 · +8.3 · +8.9 | 0.698 · 0.715 · 0.717 · 0.719 | 0.945 · 0.943 · 0.944 · 0.944 |
| `us_liver` rgb420 | 16 | 0.1867 · 0.1659 · 0.1640 · 0.1623 | 0 · +11.2 · +12.2 · +13.0 | 0.774 · 0.800 · 0.803 · 0.805 | 0.961 · 0.966 · 0.967 · 0.968 |
| `us_liver` rgb420 | 32 | 0.1031 · 0.0848 · 0.0833 · 0.0817 | 0 · +17.8 · +19.2 · +20.7 | 0.918 · 0.936 · 0.940 · 0.949 | 1.021 · 1.021 · 1.023 · 1.031 |
| `us_liver` rgb420 | 56 | 0.0116 · 0.0066 · 0.0061 · 0.0057 | 0 · +43.0 · +46.9 · +51.0 | 1.041 · 1.043 · 1.049 · 1.071 | 1.053 · 1.049 · 1.055 · 1.077 |
| `usb_cine` 8bit | 2 | 0.4786 · 0.2002 · 0.1838 · 0.1728 | 0 · +58.2 · +61.6 · +63.9 | 0.457 · 0.464 · 0.469 · 0.475 | 0.935 · 0.664 · 0.652 · 0.648 |
| `usb_cine` 8bit | 8 | 0.2909 · 0.0932 · 0.0808 · 0.0739 | 0 · +68.0 · +72.2 · +74.6 | 0.598 · 0.618 · 0.630 · 0.650 | 0.889 · 0.712 · 0.711 · 0.724 |
| `usb_cine` 8bit | 16 | 0.2157 · 0.0607 · 0.0511 · 0.0447 | 0 · +71.8 · +76.3 · +79.3 | 0.697 · 0.752 · 0.768 · 0.790 | 0.912 · 0.813 · 0.819 · 0.835 |
| `usb_cine` 8bit | 32 | 0.0941 · 0.0174 · 0.0127 · 0.0094 | 0 · +81.5 · +86.5 · +90.0 | 0.896 · 0.906 · 0.914 · 0.929 | 0.990 · 0.924 · 0.926 · 0.938 |
| `usb_cine` 8bit | 56 | 0.0215 · 0.0032 · 0.0019 · 0.0010 | 0 · +85.2 · +91.0 · +95.2 | 1.033 · 1.035 · 1.039 · 1.051 | 1.055 · 1.038 · 1.041 · 1.052 |
| `usb_cine_rgb` rgb420 | 2 | 0.3320 · 0.2718 · 0.2675 · 0.2656 | 0 · +18.1 · +19.4 · +20.0 | 0.780 · 0.783 · 0.783 · 0.784 | 1.112 · 1.055 · 1.051 · 1.050 |
| `usb_cine_rgb` rgb420 | 8 | 0.1772 · 0.1213 · 0.1184 · 0.1170 | 0 · +31.5 · +33.2 · +34.0 | 0.835 · 0.845 · 0.849 · 0.853 | 1.012 · 0.967 · 0.967 · 0.970 |
| `usb_cine_rgb` rgb420 | 16 | 0.1211 · 0.0819 · 0.0795 · 0.0779 | 0 · +32.3 · +34.3 · +35.7 | 0.878 · 0.881 · 0.885 · 0.893 | 0.999 · 0.963 · 0.964 · 0.971 |
| `usb_cine_rgb` rgb420 | 32 | 0.0537 · 0.0308 · 0.0293 · 0.0283 | 0 · +42.7 · +45.4 · +47.2 | 0.957 · 0.964 · 0.968 · 0.979 | 1.011 · 0.994 · 0.997 · 1.008 |
| `usb_cine_rgb` rgb420 | 56 | 0.0102 · 0.0033 · 0.0028 · 0.0025 | 0 · +67.7 · +72.1 · +75.3 | 1.024 · 1.038 · 1.042 · 1.054 | 1.034 · 1.041 · 1.045 · 1.056 |

#### Quality, lossy-sourced, provisional

Each cell: G = 1 · 8 · 16 · whole; against the source at its depth b.

| series, form | Q | PSNR / in-window PSNR, dB | SSIM mean | SSIM min frame | max \|Δ\| | 1st window: % differ / % > 1 / max Δcode |
| --- | --- | --- | --- | --- | --- | --- |
| `us_liver` rgb420 | 2 | 43.29/43.29 · 43.26/43.26 · 43.25/43.25 · 43.25/43.25 | 0.9948 · 0.9947 · 0.9947 · 0.9947 | 0.9941 · 0.9940 · 0.9940 · 0.9940 | 85 · 86 · 86 · 85 | — · — · — · — |
| `us_liver` rgb420 | 8 | 42.16/42.16 · 41.92/41.92 · 41.89/41.89 · 41.87/41.87 | 0.9918 · 0.9912 · 0.9911 · 0.9910 | 0.9915 · 0.9906 · 0.9905 · 0.9905 | 92 · 88 · 87 · 90 | — · — · — · — |
| `us_liver` rgb420 | 16 | 39.85/39.85 · 39.47/39.47 · 39.42/39.42 · 39.39/39.39 | 0.9841 · 0.9825 · 0.9823 · 0.9822 | 0.9837 · 0.9814 · 0.9812 · 0.9812 | 94 · 94 · 93 · 97 | — · — · — · — |
| `us_liver` rgb420 | 32 | 35.42/35.42 · 35.01/35.01 · 34.95/34.95 · 34.89/34.89 | 0.9452 · 0.9433 · 0.9431 · 0.9430 | 0.9426 · 0.9396 · 0.9404 · 0.9398 | 106 · 110 · 108 · 101 | — · — · — · — |
| `us_liver` rgb420 | 56 | 26.65/26.65 · 26.56/26.56 · 26.54/26.54 · 26.51/26.51 | 0.6498 · 0.6590 · 0.6604 · 0.6639 | 0.6338 · 0.6338 · 0.6338 · 0.6338 | 166 · 166 · 166 · 161 | — · — · — · — |
| `usb_cine` 8bit | 2 | 55.74/55.74 · 55.56/55.56 · 55.47/55.47 · 55.36/55.36 | 0.9986 · 0.9986 · 0.9986 · 0.9985 | 0.9983 · 0.9982 · 0.9982 · 0.9982 | 4 · 9 · 9 · 5 | — · — · — · — |
| `usb_cine` 8bit | 8 | 50.99/50.99 · 50.43/50.43 · 50.14/50.14 · 49.66/49.66 | 0.9963 · 0.9959 · 0.9957 · 0.9952 | 0.9943 · 0.9941 · 0.9938 · 0.9938 | 11 · 17 · 18 · 18 | — · — · — · — |
| `usb_cine` 8bit | 16 | 47.12/47.12 · 45.78/45.78 · 45.50/45.50 · 45.11/45.11 | 0.9915 · 0.9884 · 0.9876 · 0.9867 | 0.9874 · 0.9855 · 0.9855 · 0.9850 | 17 · 21 · 20 · 20 | — · — · — · — |
| `usb_cine` 8bit | 32 | 40.21/40.21 · 39.81/39.81 · 39.72/39.72 · 39.46/39.46 | 0.9604 · 0.9583 · 0.9579 · 0.9575 | 0.9588 · 0.9555 · 0.9560 · 0.9555 | 28 · 36 · 38 · 38 | — · — · — · — |
| `usb_cine` 8bit | 56 | 31.56/31.56 · 31.51/31.51 · 31.46/31.46 · 31.26/31.26 | 0.8597 · 0.8586 · 0.8578 · 0.8561 | 0.8487 · 0.8487 · 0.8470 · 0.8462 | 172 · 173 · 172 · 162 | — · — · — · — |
| `usb_cine_rgb` rgb420 | 2 | 47.57/47.57 · 47.51/47.51 · 47.50/47.50 · 47.49/47.49 | 0.9972 · 0.9971 · 0.9971 · 0.9971 | 0.9967 · 0.9966 · 0.9966 · 0.9966 | 50 · 51 · 51 · 51 | — · — · — · — |
| `usb_cine_rgb` rgb420 | 8 | 45.25/45.25 · 45.06/45.06 · 45.01/45.01 · 44.97/44.97 | 0.9940 · 0.9937 · 0.9936 · 0.9935 | 0.9926 · 0.9922 · 0.9922 · 0.9920 | 55 · 53 · 55 · 55 | — · — · — · — |
| `usb_cine_rgb` rgb420 | 16 | 42.83/42.83 · 42.98/42.98 · 42.92/42.92 · 42.81/42.81 | 0.9885 · 0.9891 · 0.9889 · 0.9885 | 0.9857 · 0.9864 · 0.9868 · 0.9867 | 58 · 69 · 64 · 61 | — · — · — · — |
| `usb_cine_rgb` rgb420 | 32 | 37.72/37.72 · 37.76/37.76 · 37.73/37.73 · 37.68/37.68 | 0.9581 · 0.9592 · 0.9595 · 0.9594 | 0.9510 · 0.9525 · 0.9547 · 0.9533 | 94 · 109 · 109 · 97 | — · — · — · — |
| `usb_cine_rgb` rgb420 | 56 | 29.71/29.71 · 29.72/29.72 · 29.72/29.72 · 29.66/29.66 | 0.8132 · 0.8106 · 0.8103 · 0.8085 | 0.7884 · 0.7908 · 0.7911 · 0.7911 | 173 · 178 · 170 · 170 | — · — · — · — |

#### Every window

| series | Q | window c/w | % differ | % > 1 code | max Δcode |
| --- | --- | --- | --- | --- | --- |
| `dbt10_d` | 2 | 512/512 LINEAR | 35.94 | 0.42 | 3 |
| `dbt10_d` | 8 | 512/512 LINEAR | 81.20 | 47.59 | 26 |
| `dbt10_d` | 16 | 512/512 LINEAR | 89.00 | 67.87 | 71 |
| `dbt10_d` | 32 | 512/512 LINEAR | 92.41 | 77.53 | 105 |
| `dbt10_d` | 56 | 512/512 LINEAR | 94.91 | 84.84 | 182 |
| `dbt10_ea1141` | 2 | 512/512 LINEAR | 35.80 | 0.40 | 3 |
| `dbt10_ea1141` | 8 | 512/512 LINEAR | 81.37 | 47.97 | 13 |
| `dbt10_ea1141` | 16 | 512/512 LINEAR | 89.44 | 69.09 | 43 |
| `dbt10_ea1141` | 32 | 512/512 LINEAR | 93.09 | 79.49 | 94 |
| `dbt10_ea1141` | 56 | 512/512 LINEAR | 95.66 | 87.04 | 163 |
| `dbt12_c` | 2 | 2917/857 SIGMOID | 36.90 | 1.65 | 4 |
| `dbt12_c` | 2 | 2878/768 SIGMOID | 40.60 | 2.81 | 4 |
| `dbt12_c` | 2 | 2964/966 SIGMOID | 32.98 | 0.79 | 4 |
| `dbt12_c` | 8 | 2917/857 SIGMOID | 83.77 | 57.83 | 27 |
| `dbt12_c` | 8 | 2878/768 SIGMOID | 85.14 | 61.38 | 30 |
| `dbt12_c` | 8 | 2964/966 SIGMOID | 82.12 | 53.58 | 24 |
| `dbt12_c` | 16 | 2917/857 SIGMOID | 89.27 | 71.42 | 69 |
| `dbt12_c` | 16 | 2878/768 SIGMOID | 90.13 | 73.87 | 74 |
| `dbt12_c` | 16 | 2964/966 SIGMOID | 88.23 | 68.45 | 63 |
| `dbt12_c` | 32 | 2917/857 SIGMOID | 91.61 | 77.02 | 109 |
| `dbt12_c` | 32 | 2878/768 SIGMOID | 92.29 | 79.03 | 114 |
| `dbt12_c` | 32 | 2964/966 SIGMOID | 90.79 | 74.59 | 100 |
| `dbt12_c` | 56 | 2917/857 SIGMOID | 94.71 | 84.84 | 228 |
| `dbt12_c` | 56 | 2878/768 SIGMOID | 95.15 | 86.21 | 236 |
| `dbt12_c` | 56 | 2964/966 SIGMOID | 94.18 | 83.17 | 219 |
| `dbt12_ea1141` | 2 | 1760/614 SIGMOID | 51.65 | 8.65 | 5 |
| `dbt12_ea1141` | 2 | 1732/550 SIGMOID | 55.34 | 11.95 | 6 |
| `dbt12_ea1141` | 2 | 1794/692 SIGMOID | 47.52 | 5.42 | 5 |
| `dbt12_ea1141` | 8 | 1760/614 SIGMOID | 89.48 | 71.11 | 37 |
| `dbt12_ea1141` | 8 | 1732/550 SIGMOID | 90.44 | 73.76 | 41 |
| `dbt12_ea1141` | 8 | 1794/692 SIGMOID | 88.28 | 67.75 | 32 |
| `dbt12_ea1141` | 16 | 1760/614 SIGMOID | 93.42 | 81.68 | 81 |
| `dbt12_ea1141` | 16 | 1732/550 SIGMOID | 94.02 | 83.39 | 91 |
| `dbt12_ea1141` | 16 | 1794/692 SIGMOID | 92.67 | 79.47 | 70 |
| `dbt12_ea1141` | 32 | 1760/614 SIGMOID | 94.74 | 85.11 | 144 |
| `dbt12_ea1141` | 32 | 1732/550 SIGMOID | 95.23 | 86.54 | 156 |
| `dbt12_ea1141` | 32 | 1794/692 SIGMOID | 94.13 | 83.30 | 130 |
| `dbt12_ea1141` | 56 | 1760/614 SIGMOID | 96.66 | 90.27 | 200 |
| `dbt12_ea1141` | 56 | 1732/550 SIGMOID | 96.99 | 91.25 | 215 |
| `dbt12_ea1141` | 56 | 1794/692 SIGMOID | 96.24 | 89.01 | 184 |
| `dbts_a1` | 2 | 1958/717 SIGMOID | 46.08 | 4.52 | 5 |
| `dbts_a1` | 2 | 1926/643 SIGMOID | 49.87 | 7.03 | 6 |
| `dbts_a1` | 2 | 1998/808 SIGMOID | 41.54 | 2.57 | 5 |
| `dbts_a1` | 8 | 1958/717 SIGMOID | 88.10 | 66.79 | 33 |
| `dbts_a1` | 8 | 1926/643 SIGMOID | 89.23 | 69.98 | 37 |
| `dbts_a1` | 8 | 1998/808 SIGMOID | 86.58 | 62.80 | 28 |
| `dbts_a1` | 16 | 1958/717 SIGMOID | 91.69 | 76.37 | 82 |
| `dbts_a1` | 16 | 1926/643 SIGMOID | 92.48 | 78.70 | 92 |
| `dbts_a1` | 16 | 1998/808 SIGMOID | 90.62 | 73.42 | 71 |
| `dbts_a1` | 32 | 1958/717 SIGMOID | 93.14 | 80.23 | 124 |
| `dbts_a1` | 32 | 1926/643 SIGMOID | 93.81 | 82.22 | 123 |
| `dbts_a1` | 32 | 1998/808 SIGMOID | 92.25 | 77.71 | 122 |
| `dbts_a1` | 56 | 1958/717 SIGMOID | 95.70 | 87.32 | 204 |
| `dbts_a1` | 56 | 1926/643 SIGMOID | 96.13 | 88.64 | 215 |
| `dbts_a1` | 56 | 1998/808 SIGMOID | 95.11 | 85.63 | 189 |
| `dbts_a2` | 2 | 2611/736 SIGMOID | 40.89 | 3.08 | 5 |
| `dbts_a2` | 2 | 2578/660 SIGMOID | 44.25 | 4.85 | 5 |
| `dbts_a2` | 2 | 2652/830 SIGMOID | 36.89 | 1.76 | 4 |
| `dbts_a2` | 8 | 2611/736 SIGMOID | 85.64 | 61.02 | 35 |
| `dbts_a2` | 8 | 2578/660 SIGMOID | 86.77 | 64.14 | 37 |
| `dbts_a2` | 8 | 2652/830 SIGMOID | 84.09 | 57.14 | 32 |
| `dbts_a2` | 16 | 2611/736 SIGMOID | 90.19 | 72.62 | 58 |
| `dbts_a2` | 16 | 2578/660 SIGMOID | 90.94 | 74.83 | 65 |
| `dbts_a2` | 16 | 2652/830 SIGMOID | 89.14 | 69.82 | 51 |
| `dbts_a2` | 32 | 2611/736 SIGMOID | 92.05 | 77.26 | 122 |
| `dbts_a2` | 32 | 2578/660 SIGMOID | 92.68 | 79.13 | 117 |
| `dbts_a2` | 32 | 2652/830 SIGMOID | 91.18 | 74.87 | 126 |
| `dbts_a2` | 56 | 2611/736 SIGMOID | 94.66 | 84.23 | 202 |
| `dbts_a2` | 56 | 2578/660 SIGMOID | 95.11 | 85.61 | 204 |
| `dbts_a2` | 56 | 2652/830 SIGMOID | 94.03 | 82.46 | 202 |
| `dbts_a3` | 2 | 1916/614 SIGMOID | 46.56 | 5.44 | 6 |
| `dbts_a3` | 2 | 1888/550 SIGMOID | 50.35 | 8.27 | 7 |
| `dbts_a3` | 2 | 1950/692 SIGMOID | 42.35 | 3.10 | 5 |
| `dbts_a3` | 8 | 1916/614 SIGMOID | 88.42 | 67.97 | 36 |
| `dbts_a3` | 8 | 1888/550 SIGMOID | 89.46 | 70.89 | 41 |
| `dbts_a3` | 8 | 1950/692 SIGMOID | 87.13 | 64.48 | 32 |
| `dbts_a3` | 16 | 1916/614 SIGMOID | 92.41 | 78.60 | 84 |
| `dbts_a3` | 16 | 1888/550 SIGMOID | 93.08 | 80.57 | 91 |
| `dbts_a3` | 16 | 1950/692 SIGMOID | 91.56 | 76.22 | 75 |
| `dbts_a3` | 32 | 1916/614 SIGMOID | 93.67 | 81.86 | 182 |
| `dbts_a3` | 32 | 1888/550 SIGMOID | 94.24 | 83.57 | 193 |
| `dbts_a3` | 32 | 1950/692 SIGMOID | 92.96 | 79.81 | 168 |
| `dbts_a3` | 56 | 1916/614 SIGMOID | 95.79 | 87.53 | 213 |
| `dbts_a3` | 56 | 1888/550 SIGMOID | 96.18 | 88.72 | 215 |
| `dbts_a3` | 56 | 1950/692 SIGMOID | 95.29 | 86.07 | 212 |
| `dbts_a4` | 2 | 2309/614 SIGMOID | 48.67 | 6.22 | 6 |
| `dbts_a4` | 2 | 2281/550 SIGMOID | 52.58 | 9.11 | 6 |
| `dbts_a4` | 2 | 2343/692 SIGMOID | 44.39 | 3.67 | 5 |
| `dbts_a4` | 8 | 2309/614 SIGMOID | 89.53 | 70.57 | 39 |
| `dbts_a4` | 8 | 2281/550 SIGMOID | 90.54 | 73.43 | 44 |
| `dbts_a4` | 8 | 2343/692 SIGMOID | 88.29 | 67.11 | 35 |
| `dbts_a4` | 16 | 2309/614 SIGMOID | 93.35 | 81.05 | 72 |
| `dbts_a4` | 16 | 2281/550 SIGMOID | 93.99 | 82.92 | 81 |
| `dbts_a4` | 16 | 2343/692 SIGMOID | 92.58 | 78.77 | 64 |
| `dbts_a4` | 32 | 2309/614 SIGMOID | 94.35 | 83.70 | 125 |
| `dbts_a4` | 32 | 2281/550 SIGMOID | 94.91 | 85.34 | 138 |
| `dbts_a4` | 32 | 2343/692 SIGMOID | 93.68 | 81.71 | 113 |
| `dbts_a4` | 56 | 2309/614 SIGMOID | 95.94 | 88.03 | 245 |
| `dbts_a4` | 56 | 2281/550 SIGMOID | 96.37 | 89.30 | 248 |
| `dbts_a4` | 56 | 2343/692 SIGMOID | 95.46 | 86.54 | 237 |
| `dbts_a5` | 2 | 2520/754 SIGMOID | 42.91 | 3.63 | 5 |
| `dbts_a5` | 2 | 2486/676 SIGMOID | 46.28 | 5.59 | 5 |
| `dbts_a5` | 2 | 2562/850 SIGMOID | 38.83 | 2.12 | 4 |
| `dbts_a5` | 8 | 2520/754 SIGMOID | 86.16 | 62.47 | 31 |
| `dbts_a5` | 8 | 2486/676 SIGMOID | 87.27 | 65.47 | 35 |
| `dbts_a5` | 8 | 2562/850 SIGMOID | 84.65 | 58.68 | 28 |
| `dbts_a5` | 16 | 2520/754 SIGMOID | 90.62 | 73.85 | 59 |
| `dbts_a5` | 16 | 2486/676 SIGMOID | 91.37 | 76.00 | 63 |
| `dbts_a5` | 16 | 2562/850 SIGMOID | 89.60 | 71.11 | 53 |
| `dbts_a5` | 32 | 2520/754 SIGMOID | 92.56 | 78.79 | 99 |
| `dbts_a5` | 32 | 2486/676 SIGMOID | 93.16 | 80.57 | 107 |
| `dbts_a5` | 32 | 2562/850 SIGMOID | 91.74 | 76.49 | 88 |
| `dbts_a5` | 56 | 2520/754 SIGMOID | 95.29 | 86.14 | 206 |
| `dbts_a5` | 56 | 2486/676 SIGMOID | 95.69 | 87.35 | 219 |
| `dbts_a5` | 56 | 2562/850 SIGMOID | 94.75 | 84.58 | 189 |
| `dbts_b1` | 2 | 512/512 LINEAR | 35.65 | 0.38 | 3 |
| `dbts_b1` | 8 | 512/512 LINEAR | 82.10 | 49.74 | 29 |
| `dbts_b1` | 16 | 512/512 LINEAR | 90.04 | 70.77 | 59 |
| `dbts_b1` | 32 | 512/512 LINEAR | 92.45 | 77.63 | 83 |
| `dbts_b1` | 56 | 512/512 LINEAR | 94.78 | 84.42 | 154 |
| `dbts_b2` | 2 | 512/512 LINEAR | 35.94 | 0.42 | 4 |
| `dbts_b2` | 8 | 512/512 LINEAR | 80.69 | 46.46 | 18 |
| `dbts_b2` | 16 | 512/512 LINEAR | 87.81 | 64.61 | 56 |
| `dbts_b2` | 32 | 512/512 LINEAR | 90.68 | 72.57 | 74 |
| `dbts_b2` | 56 | 512/512 LINEAR | 93.42 | 80.44 | 178 |
| `dbts_b3` | 2 | 512/512 LINEAR | 35.59 | 0.38 | 3 |
| `dbts_b3` | 8 | 512/512 LINEAR | 81.91 | 49.26 | 31 |
| `dbts_b3` | 16 | 512/512 LINEAR | 90.46 | 71.94 | 92 |
| `dbts_b3` | 32 | 512/512 LINEAR | 92.94 | 79.05 | 135 |
| `dbts_b3` | 56 | 512/512 LINEAR | 94.97 | 84.98 | 254 |
| `dbts_b4` | 2 | 512/512 LINEAR | 35.72 | 0.40 | 4 |
| `dbts_b4` | 8 | 512/512 LINEAR | 81.87 | 49.22 | 17 |
| `dbts_b4` | 16 | 512/512 LINEAR | 90.16 | 71.09 | 48 |
| `dbts_b4` | 32 | 512/512 LINEAR | 92.80 | 78.66 | 79 |
| `dbts_b4` | 56 | 512/512 LINEAR | 94.87 | 84.70 | 183 |
| `dbts_b5` | 2 | 512/512 LINEAR | 36.03 | 0.43 | 4 |
| `dbts_b5` | 8 | 512/512 LINEAR | 81.02 | 47.21 | 16 |
| `dbts_b5` | 16 | 512/512 LINEAR | 88.41 | 66.25 | 49 |
| `dbts_b5` | 32 | 512/512 LINEAR | 91.65 | 75.38 | 74 |
| `dbts_b5` | 56 | 512/512 LINEAR | 94.46 | 83.51 | 148 |
| `dbts_c1` | 2 | 2718/969 SIGMOID | 32.26 | 0.99 | 4 |
| `dbts_c1` | 2 | 2674/868 SIGMOID | 35.37 | 1.78 | 4 |
| `dbts_c1` | 2 | 2772/1093 SIGMOID | 28.80 | 0.48 | 4 |
| `dbts_c1` | 8 | 2718/969 SIGMOID | 81.33 | 51.09 | 25 |
| `dbts_c1` | 8 | 2674/868 SIGMOID | 82.86 | 54.79 | 28 |
| `dbts_c1` | 8 | 2772/1093 SIGMOID | 79.36 | 46.68 | 23 |
| `dbts_c1` | 16 | 2718/969 SIGMOID | 87.33 | 65.35 | 46 |
| `dbts_c1` | 16 | 2674/868 SIGMOID | 88.38 | 68.12 | 51 |
| `dbts_c1` | 16 | 2772/1093 SIGMOID | 85.99 | 61.96 | 42 |
| `dbts_c1` | 32 | 2718/969 SIGMOID | 89.72 | 71.05 | 122 |
| `dbts_c1` | 32 | 2674/868 SIGMOID | 90.59 | 73.44 | 135 |
| `dbts_c1` | 32 | 2772/1093 SIGMOID | 88.62 | 68.09 | 108 |
| `dbts_c1` | 56 | 2718/969 SIGMOID | 93.20 | 80.10 | 213 |
| `dbts_c1` | 56 | 2674/868 SIGMOID | 93.80 | 81.81 | 215 |
| `dbts_c1` | 56 | 2772/1093 SIGMOID | 92.42 | 77.90 | 207 |
| `dbts_c2` | 2 | 2700/642 SIGMOID | 47.80 | 6.66 | 5 |
| `dbts_c2` | 2 | 2671/576 SIGMOID | 51.27 | 9.50 | 6 |
| `dbts_c2` | 2 | 2736/725 SIGMOID | 43.71 | 4.00 | 5 |
| `dbts_c2` | 8 | 2700/642 SIGMOID | 87.27 | 67.35 | 37 |
| `dbts_c2` | 8 | 2671/576 SIGMOID | 88.26 | 69.97 | 42 |
| `dbts_c2` | 8 | 2736/725 SIGMOID | 85.99 | 63.94 | 31 |
| `dbts_c2` | 16 | 2700/642 SIGMOID | 91.54 | 77.82 | 76 |
| `dbts_c2` | 16 | 2671/576 SIGMOID | 92.20 | 79.60 | 85 |
| `dbts_c2` | 16 | 2736/725 SIGMOID | 90.67 | 75.53 | 66 |
| `dbts_c2` | 32 | 2700/642 SIGMOID | 93.53 | 82.11 | 133 |
| `dbts_c2` | 32 | 2671/576 SIGMOID | 94.06 | 83.61 | 139 |
| `dbts_c2` | 32 | 2736/725 SIGMOID | 92.83 | 80.16 | 126 |
| `dbts_c2` | 56 | 2700/642 SIGMOID | 96.22 | 88.97 | 203 |
| `dbts_c2` | 56 | 2671/576 SIGMOID | 96.55 | 89.97 | 214 |
| `dbts_c2` | 56 | 2736/725 SIGMOID | 95.80 | 87.67 | 187 |
| `dbts_c3` | 2 | 2846/828 SIGMOID | 38.17 | 2.06 | 4 |
| `dbts_c3` | 2 | 2809/743 SIGMOID | 41.72 | 3.29 | 4 |
| `dbts_c3` | 2 | 2893/935 SIGMOID | 34.16 | 1.06 | 4 |
| `dbts_c3` | 8 | 2846/828 SIGMOID | 85.11 | 59.93 | 28 |
| `dbts_c3` | 8 | 2809/743 SIGMOID | 86.41 | 63.25 | 32 |
| `dbts_c3` | 8 | 2893/935 SIGMOID | 83.45 | 55.66 | 25 |
| `dbts_c3` | 16 | 2846/828 SIGMOID | 90.49 | 73.83 | 54 |
| `dbts_c3` | 16 | 2809/743 SIGMOID | 91.31 | 76.06 | 61 |
| `dbts_c3` | 16 | 2893/935 SIGMOID | 89.46 | 70.91 | 48 |
| `dbts_c3` | 32 | 2846/828 SIGMOID | 92.32 | 78.40 | 122 |
| `dbts_c3` | 32 | 2809/743 SIGMOID | 93.05 | 80.28 | 132 |
| `dbts_c3` | 32 | 2893/935 SIGMOID | 91.51 | 75.93 | 109 |
| `dbts_c3` | 56 | 2846/828 SIGMOID | 95.00 | 85.33 | 224 |
| `dbts_c3` | 56 | 2809/743 SIGMOID | 95.47 | 86.70 | 230 |
| `dbts_c3` | 56 | 2893/935 SIGMOID | 94.39 | 83.56 | 215 |
| `dbts_c4` | 2 | 2840/614 SIGMOID | 50.99 | 8.18 | 6 |
| `dbts_c4` | 2 | 2812/550 SIGMOID | 54.31 | 11.19 | 7 |
| `dbts_c4` | 2 | 2874/692 SIGMOID | 47.17 | 5.24 | 6 |
| `dbts_c4` | 8 | 2840/614 SIGMOID | 89.33 | 71.51 | 36 |
| `dbts_c4` | 8 | 2812/550 SIGMOID | 90.07 | 73.73 | 41 |
| `dbts_c4` | 8 | 2874/692 SIGMOID | 88.34 | 68.60 | 34 |
| `dbts_c4` | 16 | 2840/614 SIGMOID | 93.38 | 82.14 | 74 |
| `dbts_c4` | 16 | 2812/550 SIGMOID | 93.81 | 83.50 | 85 |
| `dbts_c4` | 16 | 2874/692 SIGMOID | 92.79 | 80.35 | 69 |
| `dbts_c4` | 32 | 2840/614 SIGMOID | 94.86 | 85.82 | 109 |
| `dbts_c4` | 32 | 2812/550 SIGMOID | 95.22 | 86.91 | 112 |
| `dbts_c4` | 32 | 2874/692 SIGMOID | 94.39 | 84.37 | 102 |
| `dbts_c4` | 56 | 2840/614 SIGMOID | 96.79 | 90.76 | 232 |
| `dbts_c4` | 56 | 2812/550 SIGMOID | 97.04 | 91.53 | 237 |
| `dbts_c4` | 56 | 2874/692 SIGMOID | 96.46 | 89.74 | 227 |
| `dbts_c5` | 2 | 2690/717 SIGMOID | 41.03 | 3.35 | 6 |
| `dbts_c5` | 2 | 2658/643 SIGMOID | 44.26 | 5.12 | 6 |
| `dbts_c5` | 2 | 2730/808 SIGMOID | 37.17 | 1.95 | 4 |
| `dbts_c5` | 8 | 2690/717 SIGMOID | 85.97 | 61.76 | 32 |
| `dbts_c5` | 8 | 2658/643 SIGMOID | 87.04 | 64.73 | 36 |
| `dbts_c5` | 8 | 2730/808 SIGMOID | 84.52 | 58.01 | 28 |
| `dbts_c5` | 16 | 2690/717 SIGMOID | 90.58 | 73.66 | 65 |
| `dbts_c5` | 16 | 2658/643 SIGMOID | 91.29 | 75.72 | 73 |
| `dbts_c5` | 16 | 2730/808 SIGMOID | 89.63 | 71.02 | 57 |
| `dbts_c5` | 32 | 2690/717 SIGMOID | 92.27 | 77.88 | 115 |
| `dbts_c5` | 32 | 2658/643 SIGMOID | 92.85 | 79.64 | 124 |
| `dbts_c5` | 32 | 2730/808 SIGMOID | 91.47 | 75.62 | 105 |
| `dbts_c5` | 56 | 2690/717 SIGMOID | 94.68 | 84.34 | 215 |
| `dbts_c5` | 56 | 2658/643 SIGMOID | 95.12 | 85.65 | 226 |
| `dbts_c5` | 56 | 2730/808 SIGMOID | 94.10 | 82.64 | 200 |
| `mr9_ispy2` | 2 | 52/143 LINEAR | 53.90 | 37.30 | 9 |
| `mr9_ispy2` | 8 | 52/143 LINEAR | 72.34 | 57.41 | 56 |
| `mr9_ispy2` | 16 | 52/143 LINEAR | 77.39 | 64.08 | 113 |
| `mr9_ispy2` | 32 | 52/143 LINEAR | 79.73 | 66.02 | 167 |
| `mr9_ispy2` | 56 | 52/143 LINEAR | 87.07 | 78.86 | 204 |
| `mr_ispy1` | 2 | 156/313 LINEAR | 77.08 | 42.79 | 17 |
| `mr_ispy1` | 8 | 156/313 LINEAR | 94.95 | 86.07 | 61 |
| `mr_ispy1` | 16 | 156/313 LINEAR | 96.11 | 89.35 | 137 |
| `mr_ispy1` | 32 | 156/313 LINEAR | 96.59 | 90.89 | 209 |
| `mr_ispy1` | 56 | 156/313 LINEAR | 97.91 | 93.69 | 249 |
| `rf_fluoro` | 2 | 2346/2208 LINEAR | 23.28 | 0.00 | 3 |
| `rf_fluoro` | 8 | 2346/2208 LINEAR | 74.25 | 36.04 | 11 |
| `rf_fluoro` | 16 | 2346/2208 LINEAR | 80.09 | 49.50 | 24 |
| `rf_fluoro` | 32 | 2346/2208 LINEAR | 83.84 | 57.05 | 82 |
| `rf_fluoro` | 56 | 2346/2208 LINEAR | 91.12 | 74.18 | 234 |
| `ustrus_1` | 2 | 128/256 LINEAR | 30.04 | 0.29 | 5 |
| `ustrus_1` | 8 | 128/256 LINEAR | 68.09 | 22.66 | 38 |
| `ustrus_1` | 16 | 128/256 LINEAR | 78.89 | 42.95 | 38 |
| `ustrus_1` | 32 | 128/256 LINEAR | 86.32 | 60.98 | 73 |
| `ustrus_1` | 56 | 128/256 LINEAR | 91.14 | 74.12 | 181 |
| `ustrus_2` | 2 | 128/256 LINEAR | 30.10 | 0.28 | 4 |
| `ustrus_2` | 8 | 128/256 LINEAR | 69.30 | 24.38 | 27 |
| `ustrus_2` | 16 | 128/256 LINEAR | 80.25 | 45.87 | 46 |
| `ustrus_2` | 32 | 128/256 LINEAR | 87.49 | 63.97 | 75 |
| `ustrus_2` | 56 | 128/256 LINEAR | 92.00 | 76.44 | 151 |

#### Encode time

Median over the 15 DBT volumes and every form, CPU seconds a megapixel; wall ÷ CPU with 4 encodes in flight.

| Q | G | CPU s / Mpx | wall ÷ CPU | CPU s / frame |
| --- | --- | --- | --- | --- |
| 2 | 1 | 1.174 | 1.014 | 2.49 |
| 2 | 8 | 0.650 | 1.015 | 1.33 |
| 2 | 16 | 0.611 | 1.015 | 1.24 |
| 2 | whole | 0.598 | 1.015 | 1.19 |
| 8 | 1 | 0.947 | 1.015 | 1.96 |
| 8 | 8 | 0.551 | 1.015 | 1.17 |
| 8 | 16 | 0.543 | 1.014 | 1.14 |
| 8 | whole | 0.503 | 1.014 | 1.11 |
| 16 | 1 | 0.696 | 1.015 | 1.56 |
| 16 | 8 | 0.295 | 1.014 | 0.60 |
| 16 | 16 | 0.277 | 1.014 | 0.53 |
| 16 | whole | 0.250 | 1.014 | 0.48 |
| 32 | 1 | 0.318 | 1.015 | 0.72 |
| 32 | 8 | 0.161 | 1.015 | 0.38 |
| 32 | 16 | 0.145 | 1.014 | 0.32 |
| 32 | whole | 0.134 | 1.016 | 0.29 |
| 56 | 1 | 0.154 | 1.015 | 0.38 |
| 56 | 8 | 0.096 | 1.014 | 0.24 |
| 56 | 16 | 0.093 | 1.015 | 0.23 |
| 56 | whole | 0.096 | 1.016 | 0.23 |

#### Secondary arm: hidden alt-ref frames on, G = 16

| series | Q | alt-ref B | alt-ref off B | alt-ref saves % | PSNR on | PSNR off | exact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 8 | 2055532 | 5027649 | +59.1 | 48.37 | 50.23 | 56/56 |
| `dbts_a1` | 32 | 41258 | 65923 | +37.4 | 44.37 | 44.60 | 56/56 |
| `dbts_a1` | 2 | 30721723 | 31628081 | +2.9 | 65.22 | 65.35 | 56/56 |
| `dbts_a1` | 16 | 218652 | 429647 | +49.1 | 46.08 | 46.64 | 56/56 |
| `dbts_a1` | 56 | 7226 | 8384 | +13.8 | 39.12 | 38.81 | 56/56 |
| `dbts_b1` | 8 | 14700783 | 23191007 | +36.6 | 50.00 | 52.05 | 50/50 |
| `dbts_b1` | 32 | 294657 | 536683 | +45.1 | 43.45 | 43.96 | 50/50 |
| `dbts_b1` | 2 | 63938714 | 66926568 | +4.5 | 64.62 | 64.86 | 50/50 |
| `dbts_b1` | 16 | 2069413 | 4614488 | +55.2 | 45.59 | 46.69 | 50/50 |
| `dbts_b1` | 56 | 25435 | 37079 | +31.4 | 39.35 | 39.42 | 50/50 |
| `dbts_c1` | 8 | 3349448 | 6688677 | +49.9 | 49.74 | 51.75 | 69/69 |
| `dbts_c1` | 32 | 53400 | 81405 | +34.4 | 44.98 | 45.20 | 69/69 |
| `dbts_c1` | 2 | 32702369 | 33483791 | +2.3 | 66.90 | 67.02 | 69/69 |
| `dbts_c1` | 16 | 286321 | 677406 | +57.7 | 46.68 | 47.38 | 69/69 |
| `dbts_c1` | 56 | 10221 | 11655 | +12.3 | 39.76 | 39.54 | 69/69 |


## Profiles decode, measured (2026-11-04)

*Run 2026-11-04 by a separate session, given only §6, which it ran as written; nothing above was changed. Harness:
`streams.py` (the content, coded again with `bytes.py`'s own functions and checked byte for byte against the bytes
run's rows), `decode.mjs` (driver), `decode.js` (one cell in a worker), `shared.js` (the merge, the back-conversion,
the add), `decode.html`, `decode_report.py` (every table below and D1–D3, computed), `decode_fit.py` (§6 Fitting a
session), `media_log.cjs`; rows and printed summaries in `results/decode/`.*

```bash
P=lab/av1/.venv/bin/python; B=lab/.av1-build; D=lab/av1/data; W=lab/.av1-work/profiles-decode
$P lab/av1/profiles/streams.py $B $W $D/dbts_a1 --rungs 8,16,32 --forms 12bit,top10    # b1: 16,32,56 10bit; c1 as a1
PW=…  # playwright 1.56.1 with its Chromium 141: PLAYWRIGHT_BROWSERS_PATH, NODE_PATH
node lab/av1/profiles/decode.mjs --sets dbts_a1 --rounds 1 --throttles 1 --links none --mutate hash|offset|drop …
node lab/av1/profiles/decode.mjs --sets dbts_a1 --rounds 5 --throttles 1,4 --links none --series all --out results/decode/pilot.json
$P lab/av1/profiles/decode_fit.py results/decode/pilot.json $W
$P lab/av1/profiles/decode_report.py results/decode/pilot.json --pilot    # and --table
```

**The verdict, first.** The pilot asked for n = 315 rounds at 1× (σ of ln(arm ÷ H) up to 0.309 on the per-frame
clock; 590 over every clock), and one full round, after both of the protocol's drops, takes 8.85 h (*derived*, below)
against a cap of 5 h: **no campaign round fits, so no cell reaches n = 10, and by §6 no cell is read. D1, D2 and D3
are not decided.** What follows is the content, the checks, the pilot and the fit; the pilot is discarded by the
protocol and its numbers are reported as a pilot's, never as a reading.

**Host.** 4 cores (Intel Xeon @ 2.80 GHz), 15 GB, no swap, Linux; nothing else ran during the pilot. Headless
Chromium 141.0.7390.37 (playwright 1.56.1's headless shell), as §6 names. The client's decoders built from
`client/decode/wasm/build`'s pinned inputs; the build's container could not start (no Docker daemon here), so
`inside.sh` ran on the host from the same checked cache, as the RESIDAPART run did, and every built file matches
`manifest.sha256`. **Saturation:** one decode in flight; dav1d-WASM and OpenJPH are one thread each, so at 1× they use
one of the four cores and the host does not saturate; at 4× every thread is capped at a quarter of a CPU
(`cpu_throttle.mjs --check` here: page thread 926 → 4 168 ms, worker 917 → 4 013 ms). WebCodecs runs its own decoder
threads, so its cells are not a one-core figure at either throttle. Nothing is claimed past 4×, for concurrent asks,
a phone, or another host.

**The WebCodecs decoder.** Chromium's media log, read through the DevTools protocol's `Media` domain on a page decoding
one of these units with §6's configuration, reports `kVideoDecoderName` **`Dav1dVideoDecoder`** and
`kIsPlatformVideoDecoder` `false` (`results/decode/media-log.txt`). The log was read on a page, not inside the
harness's workers, where the same configuration is used (that the worker's decoder is the same is *unverified*).

**Content, as §6 chose it from the bytes run.** The crossover rung, the rung below and the rung above, on the ladder
that ran (2, 8, 16, 32, 56): `dbts_a1` and `dbts_c1` Q 8, 16, 32 (crossover 16, every form), `dbts_b1` Q 16, 32, 56
(crossover 32). The 12-bit volumes go to WebCodecs as the 10-bit top and to dav1d-WASM as 12 bits; `dbts_b1` is its
10-bit stream through both. G 1, 8, 16 and the whole series at each rung. Every lossy stream's unit sizes, and the
G = 16 residual's sizes, offset and bits, equal the bytes run's row (`results/cells.jsonl`), and HTJ2K's and lossless
AV1's sizes equal `results/lossless.jsonl`: **the bytes run's encodings, byte for byte**, on all 60 lossy streams and
the six lossless codings. `film_grain_params_present` is 0 on every keyframe of every stream. Every residual added back
is exact on every frame (`streams.py` refuses otherwise). Per frame and per ask: the middle 16 slices (`dbts_a1`
20–35, `dbts_b1` 17–32, `dbts_c1` 26–41); per series: the whole volume.

**Readings §6 needed** (each a reading, not a change):

* *Arm R's residual* is the G = 16 stream's (the profile's own G; on these streams its bytes are within 0.55 % of G = 1's,
  bytes run); *W's lossy frame* is the same stream's. In R and W each asked slice's lossy frame is decoded off the clock just
  before its residual or HTJ2K frame is handed in, so the AV1 decoder is alive and interleaved, as on request.
* *Per ask*: the asks are the middle 16 slices, each from a fresh decoder (dav1d closed and opened; a new
  `VideoDecoder`, configured off the clock), in a Williams order of the 16; an ask at slice k decodes from its group's
  keyframe, k − k mod G. At G = 16 the middle 16 hold every position once, at G = 8 twice, at the whole series they are
  positions 17–41. A round's ask figure is the mean over the 16. Asks run on the S arms; H, L, R and W are G = 1 arms,
  whose ask is their per-frame clock.
* *Per whole series* runs on H, L, every S and R; not on W, whose clock is one asked frame.
* *One in flight* on every clock and decoder, WebCodecs included (each unit's frame awaited before the next is
  handed in); WebCodecs returned every frame without a flush, which ran only at each timed operation's end. A unit with
  no frame in 20 s is reported as an error (none was).
* *The link*: unit i is released bytes ÷ rate after unit i − 1, and handed in at the later of that and the previous
  frame written; the per-frame clock starts at hand-in (so it is decode only, as §6 defines it), the ask and series
  clocks span the hand-in of the first unit to the last frame written.
* *A round* is every (arm, decoder, series, rung, link) once, in one Williams order of all of them: 351 units, a
  period of 702 rounds, which no n here reaches.
* *Pilot n*: σ of ln(arm ÷ H) over the paired pilot rounds, per arm, decoder, rung and clock; n is the largest.
* *The cap* of 5 h covers both throttles together (the bytes protocol's own "5 hours of wall clock"). Read as 5 h for
  each throttle, it changes nothing below: 4× alone needs 6.8 h a round.

**Checked, and mutated before the pilot** (`results/decode/mutate-*.txt`, `dbts_a1` Q 16, 1×, no limit):

| check | as run (pilot, 5 rounds × 2 throttles) | mutated | verdict |
| --- | --- | --- | --- |
| every exact frame (H, L, R after its add, W) against the fetch checksum | H 720/720, L 1 440/1 440, R 4 320/4 320, W 960/960 | `--mutate hash`: 0 of every check, every arm | **sees it** |
| every lossy frame against native dav1d 1.5.4, both decoders | S 3 840/3 840 per frame, 3 840/3 840 asks, 13 440/13 440 series; R 4 320/4 320; W 960/960 | (as above) | **sees it** |
| every residual against what the bytes run wrote | R 4 320/4 320 | residual offset off by one: R exact 0/72, its lossy and residual checks 72/72 | **sees it** |
| a group's second unit dropped | — | S8's asks at k mod 8 ≥ 1: 14 of 14 fail on each decoder (12 a decode error, `dav1d -28` or WebCodecs `EncodingError`; 2 a wrong frame), k mod 8 = 0 still exact, S1 untouched | **sees it** |

No cell is void: 0 errors, every check matched on every round.

**Pilot** (`dbts_a1`, no limit, 5 rounds at each throttle, discarded by §6; `results/decode/pilot-summary.txt` holds
every cell with its range, order effect and σ). Per frame, ms, median over rounds; in brackets the median paired ratio
over H; then the mean ask and the whole series. dav1d decodes the 12-bit form, WebCodecs the 10-bit top. **n = 5:
none of this is read.**

| series · Q · throttle · link | decoder | H | L | S1 | S8 | S16 | SW | R | W |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` Q8 1× none | dav1d | 26 · series 1.7 s | 273 (9.21) · series 13.2 s | 63 (2.42) · ask 61 · series 3.6 s | 81 (3.07) · ask 390 · series 4.9 s | 78 (3.03) · ask 730 · series 4.8 s | 81 (3.13) · ask 2456 · series 5.0 s | 38 (1.43) · series 2.2 s | 25 (0.88) |
| `dbts_a1` Q8 1× none | webcodecs | 26 · series 1.7 s | 208 (7.71) · series 10.8 s | 42 (1.55) · ask 49 · series 2.4 s | 53 (2.02) · ask 253 · series 2.9 s | 54 (2.01) · ask 464 · series 2.7 s | 54 (1.92) · ask 1502 · series 3.0 s | 42 (1.53) · series 2.3 s | 26 (1.00) |
| `dbts_a1` Q16 1× none | dav1d | 26 · series 1.7 s | 273 (9.21) · series 13.2 s | 40 (1.55) · ask 44 · series 2.5 s | 70 (2.57) · ask 316 · series 4.1 s | 70 (2.64) · ask 606 · series 3.8 s | 71 (2.78) · ask 2080 · series 4.0 s | 37 (1.47) · series 2.3 s | 25 (0.94) |
| `dbts_a1` Q16 1× none | webcodecs | 26 · series 1.7 s | 208 (7.71) · series 10.8 s | 29 (1.03) · ask 32 · series 1.6 s | 30 (1.15) · ask 162 · series 1.9 s | 32 (1.16) · ask 287 · series 1.8 s | 34 (1.24) · ask 972 · series 1.9 s | 46 (1.61) · series 2.3 s | 28 (1.02) |
| `dbts_a1` Q32 1× none | dav1d | 26 · series 1.7 s | 273 (9.21) · series 13.2 s | 59 (2.48) · ask 63 · series 4.8 s | 60 (2.17) · ask 260 · series 3.1 s | 57 (2.06) · ask 463 · series 3.3 s | 63 (2.30) · ask 1635 · series 3.3 s | 37 (1.43) · series 2.2 s | 25 (0.89) |
| `dbts_a1` Q32 1× none | webcodecs | 26 · series 1.7 s | 208 (7.71) · series 10.8 s | 26 (0.92) · ask 30 · series 1.4 s | 29 (1.06) · ask 140 · series 1.6 s | 27 (1.00) · ask 267 · series 1.5 s | 29 (1.01) · ask 836 · series 1.5 s | 47 (1.52) · series 2.2 s | 32 (1.10) |
| `dbts_a1` Q8 4× none | dav1d | 120 · series 7.2 s | 1051 (8.90) · series 58.1 s | 318 (2.60) · ask 298 · series 17.0 s | 416 (3.52) · ask 1854 · series 22.1 s | 378 (3.32) · ask 3316 · series 21.2 s | 404 (3.36) · ask 11434 · series 21.6 s | 159 (1.36) · series 10.1 s | 123 (1.03) |
| `dbts_a1` Q8 4× none | webcodecs | 120 · series 7.2 s | 750 (6.37) · series 41.2 s | 108 (0.91) · ask 129 · series 6.2 s | 134 (1.12) · ask 583 · series 6.9 s | 129 (1.13) · ask 1162 · series 6.6 s | 123 (1.09) · ask 3798 · series 7.0 s | 176 (1.46) · series 10.6 s | 124 (1.03) |
| `dbts_a1` Q16 4× none | dav1d | 120 · series 7.2 s | 1051 (8.90) · series 58.1 s | 205 (1.75) · ask 209 · series 11.8 s | 356 (2.95) · ask 1500 · series 18.5 s | 363 (2.96) · ask 2912 · series 19.3 s | 346 (2.90) · ask 9850 · series 19.6 s | 188 (1.56) · series 10.6 s | 126 (1.11) |
| `dbts_a1` Q16 4× none | webcodecs | 120 · series 7.2 s | 750 (6.37) · series 41.2 s | 91 (0.74) · ask 109 · series 4.6 s | 81 (0.72) · ask 411 · series 4.7 s | 92 (0.75) · ask 829 · series 5.3 s | 85 (0.71) · ask 2572 · series 4.9 s | 180 (1.47) · series 10.4 s | 124 (1.03) |
| `dbts_a1` Q32 4× none | dav1d | 120 · series 7.2 s | 1051 (8.90) · series 58.1 s | 286 (2.45) · ask 319 · series 23.1 s | 303 (2.53) · ask 1214 · series 14.8 s | 300 (2.50) · ask 2220 · series 15.1 s | 303 (2.66) · ask 7827 · series 15.6 s | 181 (1.70) · series 11.1 s | 121 (1.02) |
| `dbts_a1` Q32 4× none | webcodecs | 120 · series 7.2 s | 750 (6.37) · series 41.2 s | 86 (0.75) · ask 103 · series 4.6 s | 87 (0.77) · ask 403 · series 4.6 s | 92 (0.76) · ask 779 · series 4.5 s | 85 (0.70) · ask 2421 · series 4.6 s | 177 (1.54) · series 10.5 s | 131 (1.02) |

The ask at G = 16 over the ask at G = 1 (D2's ratio), pilot medians: dav1d 11.1, 14.2, 7.8 at Q 8, 16, 32 (1×) and
11.0, 13.8, 7.0 (4×); WebCodecs 9.6, 9.1, 9.0 (1×) and 9.1, 7.6, 7.6 (4×). Order effects in the pilot ran to 52 %
(n = 5 over 117 units, one predecessor each).

**Fitting a session** (`results/decode/fit.txt`, *derived*: each pilot unit's clocks scaled to a series by its pixels a
frame — and its frames, for the series clock — on a link no shorter than its bytes ÷ rate, plus the pilot's time
outside the clocks):

| as §6 orders it | a round at 1× | at 4× | a round | rounds in 5 h |
| --- | --: | --: | --: | --: |
| as written | 263 min | 772 min | 17.25 h | 0 |
| whole-series clock dropped to dav1d-WASM's L at 4× on `dbts_b1` | 171 min | 601 min | 12.87 h | 0 |
| then the 50 Mbit/s link dropped | 123 min | 408 min | 8.85 h | 0 |

§6 lists no further drop, so the campaign ran no round: **every (series, rung, throttle, link) cell has n = 0 < 10 and
is marked not read; D1, D2, D3 are not decided** (`decode_report.py`'s rule: no cell read, no verdict). The pilot's
own n would have been 315 at 1× and 82 at 4× on the per-frame clock even if time had allowed.

**Left for the owner** (not a judgment of the run's, which applies §6 as written): §6 fits neither its rounds nor its
power in 5 h on this host. What a session could fit is a decision for the owner: fewer units a round (351 now; the
5 Mbit/s link's per-frame cells alone are about 28 min a throttle-round of waiting, *derived*), a longer cap, or a
smaller n target.

## Profiles decode, amended, measured

*Six blocks of §7, one a session (§Shards), then the pool. Each session replaces only the line under its own heading
and writes only its own files.*

### Decode shard 1, measured

*Run 2026-11-04, 18:30–22:40 UTC, by a separate session given only §7, which it ran as §Shards gives it. One block:
not a verdict.*

* **Run:** block `shard-1`, 15 rounds (0–14), every unit of §7 interleaved in its Williams rows, 1× every rung and 4×
  the crossover rung, on `dbts_a1`, `dbts_b1` and `dbts_c1`; then the three driver mutations and the pool's nine.
* **Shows:** for this block alone, the ratios below with their within-block 95 % intervals; its A/A at 0.997 (1×) and
  0.989 (4×), both kept; no cell void.
* **Rests on:** those three series' middle 16 slices, one 4-core host, Playwright 1.56.1's headless shell (build 1194,
  §7's Chromium 141); every exact frame checked against the fetch checksum, every lossy frame against native dav1d.
* **Left:** pooling and the rule — the collector's; other hosts; nothing claimed for any other series or fixture.

**Terms**, beyond §7's: the **within-block interval** is the distribution-free 95 % interval of the median over this
block's rounds (`decode_pool.py`'s `median_interval`, order statistics from the binomial(n, ½) tails), no *t* over
blocks; with one block every cell prints *not read: one block*, as §7's rule asks.

**Host** (its `host` row): Intel Xeon Processor @ 2.80 GHz, 4 cores, 16 GB (`os.totalmem`, rounded), no swap, Linux;
nothing else ran during the block. **Saturation:** as §7 states it, one decode in flight; dav1d-WASM and OpenJPH one
thread each, so at 1× one core and the host does not saturate; at 4× each browser thread is capped to a quarter CPU;
WebCodecs runs its own threads, so its cells are not one-core figures (not measured separately here). Nothing past 4×.

**Time.** T0 18:30:56 UTC; `decode_setup.sh` 1 204 s, **20.1 min**; the block 18:51–22:28, a round **14.4 min** median
of 15 (1× 5.6–6.7 min, 4× 7.8–8.8), against the pilot's 10.6: this host ran about 1.35× the pilot's round. The
driver stopped before round 15 ("it would pass --until"). The block started from `deebda0a`, before `51c2ef69`: rounds
0–1 ran the driver that checks `--until` after a round and keeps timestamps unrounded; from round 2 the loop's own
`git pull --rebase` brought `51c2ef69`'s driver. §Shards pools such rows as they are.

**Checks, every unit, every round** (`rows/decode-shard-1.json`): H and H′ exact **5 760/5 760**; R exact after its add
**4 800/4 800**, its residuals 4 800/4 800, its lossy frames 4 800/4 800; S lossy frames against native dav1d 1.5.4
**37 200/37 200**; no error, no void cell. 2 820 rows.

**Mutations**, once after the block, `dbts_a1` Q 16 at 1×, one round (rows kept outside the repo):
`--mutate hash` — every check 0 on all 16 units (exact 0/16, lossy 0/16 or 0/20, residuals 0/16); `--mutate offset` —
R exact 0/16 on both forms, its residuals 16/16 and lossy 16/16 intact, the other 14 units untouched; `--mutate drop` —
both S8 jumps fail, dav1d-WASM `dav1d -28`, WebCodecs `Decoding error.`, each 1/20 lossy matched, S1 and S16 untouched.
`decode_pool.py --test`: every test passed; §7's nine pool mutations, applied to a copy by text substitution: each
fails the test.

**A/A** (H′ ÷ H, median over every (series, rung) and round): 1× **0.997 [0.977–1.017]** over 135 pairs, 4× **0.989
[0.952–1.052]** over 45 — both inside ±5 %, kept.

**The question cells**, ratio and within-block 95 % interval over 15 rounds, from `rows/decode-shard-1.txt`
(D1: S_G WebCodecs in order ÷ H; D2: S16 jump ÷ S1 jump; D3: R ÷ H, by form); H ms is this block's median, inside it only:

| series Q, throttle | H ms | A/A | D1 G 1 · 8 · 16 | D2 dav1d-WASM · WebCodecs | D3 R ÷ H |
| --- | --: | --- | --- | --- | --- |
| `dbts_a1` Q 8, 1× | 19 | 0.97 [0.73–1.07] | 1.86 [1.36–2.09] · 2.13 [1.52–2.38] · 2.23 [1.54–2.44] | 9.92 [9.36–10.88] · 9.30 [8.80–10.09] | 12bit 1.37 [1.26–1.46] · top10 1.34 [1.01–1.43] |
| `dbts_a1` Q 16, 1× | 19 | 1.00 [0.96–1.21] | 1.25 [1.19–1.37] · 1.38 [1.23–1.47] · 1.46 [1.25–1.52] | 12.97 [11.47–15.17] · 8.70 [8.28–9.26] | 12bit 1.46 [1.33–1.58] · top10 1.52 [1.35–1.58] |
| `dbts_a1` Q 32, 1× | 19 | 0.99 [0.91–1.09] | 1.03 [0.98–1.14] · 1.18 [1.13–1.45] · 1.22 [1.12–1.31] | 6.93 [6.62–7.85] · 8.55 [7.70–9.11] | 12bit 1.51 [1.45–1.67] · top10 1.45 [1.27–1.59] |
| `dbts_a1` Q 16, 4× | 89 | 0.99 [0.88–1.16] | 0.79 [0.74–0.86] · 0.76 [0.70–0.83] · 0.77 [0.67–0.81] | 13.61 [12.74–14.16] · 7.36 [4.73–8.23] | 12bit 1.47 [1.33–1.58] · top10 1.47 [1.25–1.57] |
| `dbts_b1` Q 16, 1× | 54 | 0.99 [0.94–1.30] | 1.71 [1.55–1.93] · 2.02 [1.87–2.07] · 2.02 [1.81–2.22] | 12.49 [10.85–12.92] · 9.12 [8.60–9.60] | 10bit 1.66 [1.57–2.45] |
| `dbts_b1` Q 32, 1× | 53 | 0.97 [0.71–1.10] | 1.33 [1.21–1.47] · 1.51 [1.12–1.67] · 1.55 [1.43–1.68] | 7.54 [7.09–8.25] · 8.17 [7.73–8.69] | 10bit 1.69 [1.22–2.21] |
| `dbts_b1` Q 56, 1× | 54 | 1.00 [0.94–1.38] | 1.33 [1.19–1.46] · 1.43 [1.32–1.50] · 1.36 [1.30–1.51] | 3.54 [3.31–4.12] · 7.88 [7.15–9.16] | 10bit 1.70 [1.63–2.04] |
| `dbts_b1` Q 32, 4× | 273 | 0.95 [0.93–1.06] | 1.02 [0.96–1.17] · 1.05 [0.90–1.16] · 1.03 [0.96–1.13] | 7.75 [7.47–7.89] · 8.31 [7.33–8.79] | 10bit 1.72 [1.53–1.80] |
| `dbts_c1` Q 8, 1× | 19 | 1.00 [0.94–1.04] | 2.02 [1.90–2.24] · 2.19 [2.04–2.30] · 2.19 [1.89–2.32] | 10.15 [9.16–10.78] · 8.84 [8.33–9.05] | 12bit 1.53 [1.36–1.57] · top10 1.52 [1.21–1.73] |
| `dbts_c1` Q 16, 1× | 18 | 1.01 [0.95–1.05] | 1.57 [1.40–1.82] · 1.73 [1.60–1.88] · 1.70 [1.53–1.86] | 12.18 [11.92–13.97] · 8.53 [8.10–9.12] | 12bit 1.54 [1.50–1.61] · top10 1.53 [1.44–1.63] |
| `dbts_c1` Q 32, 1× | 19 | 1.00 [0.95–1.02] | 1.30 [1.21–1.51] · 1.36 [1.25–1.48] · 1.44 [1.23–1.57] | 4.89 [4.72–5.21] · 8.62 [7.67–9.13] | 12bit 1.62 [1.53–1.68] · top10 1.57 [1.54–1.71] |
| `dbts_c1` Q 16, 4× | 91 | 1.00 [0.96–1.08] | 0.94 [0.87–1.08] · 0.97 [0.91–1.09] · 0.97 [0.87–1.09] | 12.24 [11.16–13.02] · 7.54 [4.80–8.27] | 12bit 1.51 [1.38–1.63] · top10 1.59 [1.50–1.77] |

**The other ratios** (every one in `rows/decode-shard-1.txt`), ranges over the 12 (series, rung, throttle): dav1d-WASM ÷
WebCodecs (the 12-bit forms on `dbts_a1` and `dbts_c1`; two decoders on one 10-bit stream on `dbts_b1`) 1.205–3.96, over
1 in every cell; S8 jump ÷ S1 jump 2.14–6.86; S8 and S16 in order ÷ S1 in order 0.34–1.64 (the lowest, 0.34, dav1d-WASM
on `dbts_b1` Q 56). The order effect printed beside each cell is not read: §7 reads it on the pooled pairs.

### Decode shard 2, measured

*Run 2026-11-04, 18:31–21:52 UTC, by a separate session given only §7, which it ran as §Shards writes it; nothing
above was changed. Rows: `rows/decode-shard-2.{json,log,txt}`. **One block: not a verdict.***

* **Run:** block `shard-2`, rounds 0–23 (24, both Williams squares from row 0), every rung at 1×, the crossover rung
  at 4×, all three series, every unit of §7 interleaved, with its own A/A; the loop's list ended at 24 before `--until`.
* **Shows:** within this one block, D1 ratios 1.09–2.27 at 1× and 0.87–1.25 at 4×; D2 4.03–12.96 on dav1d-WASM and
  5.94–9.22 on WebCodecs; D3 1.43–1.70; the A/A 1.002 at 1× and 0.998 at 4×; every check matched; no cell void.
* **Rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` (systems A, B, C; DBT, not cine) only, their streams from
  `decode_setup.sh`; one 4-core host; Chromium 141.0.7390.37 (`headless_shell --version`).
* **Left:** pooling with the other five blocks and the rule (the collector); everything §7 lists as left.
* **Host:** Intel Xeon @ 2.30 GHz, 4 cores, 16 GB (the block's `host` row); one decode in flight, so at 1× dav1d-WASM
  and OpenJPH use one core and the host does not saturate; at 4× every browser thread is capped at a quarter of a CPU;
  WebCodecs' own threads make its cells no one-core figure. Nothing is claimed past 4× or for another host.

**Terms** are §7's. In the tables: **d** — dav1d-WASM, **WC** — WebCodecs, **ord** — in order, **S*G*** — the lossy
stream at G, **R *form*** — residual decode + add on that form; a ratio is ln-paired by round inside the block and
reported as exp of its median over rounds.

**Setup** (`decode_setup.sh`): 12.8 min. A first start was stopped after about two minutes and restarted, so some
fetches were already cached: an under-estimate of a cold host. **A round:** 7.3 min (median of 24; 7.1–7.6),
3.1 min at 1× and 4.2 at 4×.

**A/A**, H′ ÷ H, median of the pairs [distribution-free 95 %]: **1×** 1.002 [0.993–1.007] over 216 pairs; **4×**
0.998 [0.990–1.007] over 72 pairs. Both inside ±5 %: both throttles kept.

**Checks, every unit, every round:** H exact 9 216/9 216 and R exact 7 680/7 680 against the fetch checksum; R's
residuals 7 680/7 680 against `streams.py`; R's lossy frames 7 680/7 680 and every clocked lossy frame 59 520/59 520
against native dav1d 1.5.4; no error in 4 512 units. **Void:** none.

**Mutations, rerun on this host** after the block, `dbts_a1` Q 16 at 1×, one round each (rows in the session only):
`--mutate hash` — 0 of every check on all 16 units; `--mutate offset` — R exact 0/16 on both forms, residuals and
lossy 16/16, the other 14 units intact; `--mutate drop` — both S8 jumps fail (dav1d-WASM `-28`, WebCodecs
`Decoding error.`) with 1 of 20 frames matched, every other unit intact. `decode_pool.py --test` passes, and each of
its nine mutations (§7's list, applied to a copy) fails it. Each as §7's table records.

**Order effect:** the largest across every ratio and cell, 203 % (S8 ÷ S1 WebCodecs jump, `dbts_a1` Q 16 4×), reached
by 39 % of its shuffles; no cell over 10 % with under 5 % of its shuffles reaching it (the smallest share, 0.22).

**ms, median over the 24 rounds, inside this block only** (H, R: the median slice; in order: the median frame; a jump:
the mean over the middle 16):

| cell | H | H′ | R 12/10 bit | R top10 | S1 d ord | S1 WC ord | S16 d ord | S16 WC ord | S1 d jump | S1 WC jump | S16 d jump | S16 WC jump |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `dbts_a1` Q 8 1× | 13 | 13 | 18 | 18 | 35 | 23 | 42 | 27 | 35 | 25 | 356 | 234 |
| `dbts_a1` Q 16 1× | 13 | 13 | 19 | 18 | 24 | 15 | 37 | 17 | 24 | 18 | 307 | 155 |
| `dbts_a1` Q 32 1× | 13 | 13 | 19 | 19 | 32 | 14 | 30 | 15 | 33 | 17 | 238 | 139 |
| `dbts_a1` Q 16 4× | 54 | 54 | 80 | 78 | 99 | 47 | 154 | 48 | 101 | 97 | 1296 | 443 |
| `dbts_b1` Q 16 1× | 36 | 36 | 60 | — | 95 | 64 | 128 | 73 | 95 | 72 | 1059 | 639 |
| `dbts_b1` Q 32 1× | 36 | 36 | 60 | — | 106 | 54 | 103 | 59 | 107 | 61 | 850 | 523 |
| `dbts_b1` Q 56 1× | 35 | 36 | 60 | — | 162 | 50 | 66 | 55 | 166 | 58 | 669 | 489 |
| `dbts_b1` Q 32 4× | 156 | 154 | 252 | — | 444 | 190 | 431 | 191 | 456 | 219 | 3587 | 1711 |
| `dbts_c1` Q 8 1× | 12 | 13 | 19 | 19 | 34 | 26 | 38 | 28 | 35 | 29 | 343 | 251 |
| `dbts_c1` Q 16 1× | 13 | 13 | 20 | 19 | 25 | 18 | 35 | 19 | 25 | 21 | 300 | 180 |
| `dbts_c1` Q 32 1× | 13 | 13 | 20 | 20 | 53 | 15 | 26 | 16 | 49 | 19 | 241 | 157 |
| `dbts_c1` Q 16 4× | 55 | 55 | 84 | 83 | 108 | 55 | 145 | 54 | 108 | 71 | 1256 | 505 |

**D1, S_G WebCodecs in order ÷ H** — the ratio, median over the 24 rounds [its distribution-free 95 % interval]

| cell | S1 WC ord ÷ H | S8 WC ord ÷ H | S16 WC ord ÷ H |
| --- | ---: | ---: | ---: |
| `dbts_a1` Q 8 1× | 1.797 [1.775–1.856] | 2.081 [2.044–2.115] | 2.101 [2.055–2.140] |
| `dbts_a1` Q 16 1× | 1.205 [1.163–1.219] | 1.308 [1.278–1.353] | 1.329 [1.284–1.377] |
| `dbts_a1` Q 32 1× | 1.090 [1.053–1.138] | 1.138 [1.116–1.153] | 1.174 [1.126–1.220] |
| `dbts_a1` Q 16 4× | 0.873 [0.823–0.910] | 0.872 [0.828–0.902] | 0.880 [0.830–0.935] |
| `dbts_b1` Q 16 1× | 1.764 [1.702–1.789] | 1.970 [1.947–2.029] | 2.018 [1.966–2.052] |
| `dbts_b1` Q 32 1× | 1.478 [1.435–1.517] | 1.619 [1.582–1.658] | 1.631 [1.597–1.658] |
| `dbts_b1` Q 56 1× | 1.402 [1.352–1.444] | 1.527 [1.465–1.552] | 1.528 [1.507–1.563] |
| `dbts_b1` Q 32 4× | 1.207 [1.151–1.283] | 1.253 [1.161–1.304] | 1.230 [1.185–1.282] |
| `dbts_c1` Q 8 1× | 2.032 [1.990–2.094] | 2.267 [2.231–2.319] | 2.236 [2.193–2.284] |
| `dbts_c1` Q 16 1× | 1.381 [1.361–1.407] | 1.560 [1.538–1.651] | 1.482 [1.435–1.518] |
| `dbts_c1` Q 32 1× | 1.225 [1.198–1.279] | 1.376 [1.348–1.448] | 1.287 [1.243–1.321] |
| `dbts_c1` Q 16 4× | 0.997 [0.941–1.062] | 1.029 [0.973–1.067] | 0.994 [0.965–1.025] |

**D2, S16 jump ÷ S1 jump** — the ratio, median over the 24 rounds [its distribution-free 95 % interval]

| cell | S16 d jump ÷ S1 d jump | S16 WC jump ÷ S1 WC jump |
| --- | ---: | ---: |
| `dbts_a1` Q 8 1× | 10.299 [9.919–10.439] | 9.222 [8.967–9.445] |
| `dbts_a1` Q 16 1× | 12.750 [12.307–13.044] | 8.678 [8.459–9.221] |
| `dbts_a1` Q 32 1× | 7.335 [7.121–7.616] | 8.393 [8.129–8.756] |
| `dbts_a1` Q 16 4× | 12.958 [12.259–13.421] | 5.944 [3.649–7.310] |
| `dbts_b1` Q 16 1× | 11.198 [11.095–11.515] | 8.924 [8.762–9.200] |
| `dbts_b1` Q 32 1× | 7.930 [7.844–8.137] | 8.650 [8.487–8.825] |
| `dbts_b1` Q 56 1× | 4.030 [3.939–4.114] | 8.441 [8.211–8.612] |
| `dbts_b1` Q 32 4× | 7.992 [7.626–8.413] | 7.763 [6.506–8.223] |
| `dbts_c1` Q 8 1× | 10.025 [9.566–10.240] | 8.800 [8.689–8.902] |
| `dbts_c1` Q 16 1× | 11.805 [11.515–11.998] | 8.656 [8.355–8.878] |
| `dbts_c1` Q 32 1× | 4.867 [4.806–5.041] | 8.523 [8.352–8.760] |
| `dbts_c1` Q 16 4× | 11.650 [11.424–12.033] | 7.227 [4.319–7.381] |

**D3, R ÷ H** — the ratio, median over the 24 rounds [its distribution-free 95 % interval]

| cell | R 12bit ÷ H | R top10 ÷ H | R 10bit ÷ H |
| --- | ---: | ---: | ---: |
| `dbts_a1` Q 8 1× | 1.453 [1.428–1.480] | 1.449 [1.429–1.475] | — |
| `dbts_a1` Q 16 1× | 1.464 [1.448–1.502] | 1.444 [1.413–1.478] | — |
| `dbts_a1` Q 32 1× | 1.484 [1.447–1.498] | 1.444 [1.434–1.459] | — |
| `dbts_a1` Q 16 4× | 1.479 [1.419–1.524] | 1.431 [1.389–1.493] | — |
| `dbts_b1` Q 16 1× | — | — | 1.652 [1.633–1.693] |
| `dbts_b1` Q 32 1× | — | — | 1.655 [1.614–1.708] |
| `dbts_b1` Q 56 1× | — | — | 1.704 [1.648–1.729] |
| `dbts_b1` Q 32 4× | — | — | 1.612 [1.556–1.678] |
| `dbts_c1` Q 8 1× | 1.532 [1.515–1.571] | 1.545 [1.498–1.569] | — |
| `dbts_c1` Q 16 1× | 1.576 [1.554–1.600] | 1.535 [1.493–1.557] | — |
| `dbts_c1` Q 32 1× | 1.584 [1.562–1.642] | 1.575 [1.542–1.610] | — |
| `dbts_c1` Q 16 4× | 1.538 [1.504–1.658] | 1.524 [1.470–1.604] | — |

**G on a jump, S8 ÷ S1** — the ratio, median over the 24 rounds [its distribution-free 95 % interval]

| cell | S8 d jump ÷ S1 d jump | S8 WC jump ÷ S1 WC jump |
| --- | ---: | ---: |
| `dbts_a1` Q 8 1× | 5.255 [5.167–5.467] | 4.883 [4.780–4.993] |
| `dbts_a1` Q 16 1× | 6.450 [6.243–6.562] | 4.689 [4.643–4.759] |
| `dbts_a1` Q 32 1× | 3.828 [3.748–3.903] | 4.450 [4.353–4.516] |
| `dbts_a1` Q 16 4× | 6.437 [6.228–6.648] | 2.880 [2.016–4.099] |
| `dbts_b1` Q 16 1× | 5.754 [5.639–5.925] | 4.766 [4.728–4.837] |
| `dbts_b1` Q 32 1× | 4.199 [4.119–4.309] | 4.636 [4.521–4.707] |
| `dbts_b1` Q 56 1× | 2.312 [2.270–2.345] | 4.522 [4.431–4.616] |
| `dbts_b1` Q 32 4× | 4.220 [4.087–4.344] | 4.141 [3.397–4.310] |
| `dbts_c1` Q 8 1× | 5.103 [4.961–5.247] | 4.670 [4.598–4.748] |
| `dbts_c1` Q 16 1× | 5.939 [5.881–6.010] | 4.695 [4.528–4.817] |
| `dbts_c1` Q 32 1× | 2.667 [2.584–2.783] | 4.637 [4.477–4.733] |
| `dbts_c1` Q 16 4× | 5.908 [5.710–6.051] | 3.892 [2.457–4.033] |

**G in order** — the ratio, median over the 24 rounds [its distribution-free 95 % interval]

| cell | S8 d ord ÷ S1 d ord | S16 d ord ÷ S1 d ord | S8 WC ord ÷ S1 WC ord | S16 WC ord ÷ S1 WC ord |
| --- | ---: | ---: | ---: | ---: |
| `dbts_a1` Q 8 1× | 1.199 [1.171–1.228] | 1.200 [1.191–1.224] | 1.152 [1.100–1.176] | 1.157 [1.136–1.182] |
| `dbts_a1` Q 16 1× | 1.542 [1.499–1.563] | 1.540 [1.516–1.596] | 1.087 [1.048–1.142] | 1.099 [1.063–1.129] |
| `dbts_a1` Q 32 1× | 0.968 [0.943–0.994] | 0.911 [0.887–0.945] | 1.034 [0.988–1.081] | 1.057 [1.030–1.097] |
| `dbts_a1` Q 16 4× | 1.556 [1.491–1.587] | 1.559 [1.501–1.590] | 1.013 [0.969–1.055] | 1.029 [0.999–1.061] |
| `dbts_b1` Q 16 1× | 1.339 [1.317–1.365] | 1.345 [1.321–1.381] | 1.134 [1.098–1.152] | 1.152 [1.132–1.163] |
| `dbts_b1` Q 32 1× | 0.968 [0.957–0.976] | 0.968 [0.953–0.988] | 1.085 [1.071–1.112] | 1.105 [1.062–1.127] |
| `dbts_b1` Q 56 1× | 0.404 [0.401–0.414] | 0.404 [0.397–0.420] | 1.086 [1.047–1.114] | 1.099 [1.068–1.110] |
| `dbts_b1` Q 32 4× | 0.976 [0.947–1.005] | 0.979 [0.957–0.997] | 1.023 [0.994–1.044] | 1.010 [0.995–1.030] |
| `dbts_c1` Q 8 1× | 1.159 [1.139–1.181] | 1.145 [1.116–1.162] | 1.108 [1.086–1.153] | 1.103 [1.083–1.126] |
| `dbts_c1` Q 16 1× | 1.375 [1.367–1.419] | 1.355 [1.336–1.393] | 1.128 [1.079–1.176] | 1.064 [1.036–1.103] |
| `dbts_c1` Q 32 1× | 0.503 [0.492–0.519] | 0.499 [0.490–0.513] | 1.116 [1.074–1.150] | 1.044 [1.014–1.080] |
| `dbts_c1` Q 16 4× | 1.370 [1.328–1.426] | 1.352 [1.307–1.412] | 1.010 [0.978–1.071] | 1.000 [0.943–1.043] |

**The 12-bit forms, dav1d-WASM ÷ WebCodecs (on `dbts_b1`: the two decoders on one 10-bit stream)** — the ratio, median over the 24 rounds [its distribution-free 95 % interval]

| cell | S1 d ord ÷ S1 WC ord | S1 d jump ÷ S1 WC jump | S8 d ord ÷ S8 WC ord | S8 d jump ÷ S8 WC jump | S16 d ord ÷ S16 WC ord | S16 d jump ÷ S16 WC jump |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `dbts_a1` Q 8 1× | 1.538 [1.490–1.562] | 1.379 [1.349–1.452] | 1.609 [1.568–1.644] | 1.507 [1.456–1.562] | 1.603 [1.560–1.628] | 1.563 [1.530–1.595] |
| `dbts_a1` Q 16 1× | 1.546 [1.509–1.610] | 1.373 [1.327–1.419] | 2.200 [2.134–2.289] | 1.869 [1.820–1.904] | 2.203 [2.132–2.260] | 1.982 [1.961–2.055] |
| `dbts_a1` Q 32 1× | 2.378 [2.248–2.422] | 1.959 [1.914–2.018] | 2.180 [2.148–2.249] | 1.675 [1.634–1.720] | 2.024 [1.951–2.076] | 1.688 [1.647–1.784] |
| `dbts_a1` Q 16 4× | 2.149 [2.071–2.208] | 1.116 [0.868–1.659] | 3.308 [3.183–3.398] | 2.749 [2.614–2.845] | 3.247 [3.119–3.382] | 2.970 [2.823–3.092] |
| `dbts_b1` Q 16 1× | 1.497 [1.456–1.528] | 1.320 [1.307–1.369] | 1.768 [1.727–1.806] | 1.619 [1.583–1.635] | 1.741 [1.722–1.787] | 1.672 [1.633–1.727] |
| `dbts_b1` Q 32 1× | 1.996 [1.942–2.018] | 1.763 [1.713–1.823] | 1.766 [1.737–1.780] | 1.596 [1.553–1.675] | 1.761 [1.714–1.802] | 1.626 [1.596–1.682] |
| `dbts_b1` Q 56 1× | 3.263 [3.184–3.338] | 2.866 [2.790–2.931] | 1.225 [1.180–1.254] | 1.469 [1.420–1.508] | 1.208 [1.150–1.242] | 1.362 [1.332–1.399] |
| `dbts_b1` Q 32 4× | 2.339 [2.298–2.415] | 2.100 [1.719–2.171] | 2.249 [2.165–2.324] | 2.079 [2.005–2.204] | 2.257 [2.209–2.316] | 2.104 [2.041–2.200] |
| `dbts_c1` Q 8 1× | 1.323 [1.293–1.344] | 1.206 [1.191–1.238] | 1.382 [1.342–1.420] | 1.329 [1.300–1.346] | 1.365 [1.355–1.430] | 1.363 [1.331–1.418] |
| `dbts_c1` Q 16 1× | 1.435 [1.403–1.458] | 1.231 [1.211–1.256] | 1.761 [1.709–1.838] | 1.587 [1.513–1.614] | 1.828 [1.803–1.867] | 1.641 [1.595–1.702] |
| `dbts_c1` Q 32 1× | 3.402 [3.295–3.502] | 2.665 [2.606–2.725] | 1.513 [1.471–1.551] | 1.541 [1.510–1.609] | 1.632 [1.581–1.671] | 1.523 [1.497–1.551] |
| `dbts_c1` Q 16 4× | 1.989 [1.896–2.030] | 1.505 [0.922–1.591] | 2.673 [2.547–2.830] | 2.341 [2.205–2.424] | 2.715 [2.548–2.830] | 2.559 [2.301–2.628] |

Every unit ÷ H, the per-cell A/A and each cell's order effect: `rows/decode-shard-2.txt`.

### Decode shard 3, measured

*Running since 2026-11-04 18:31 UTC (partial): setup, then block `shard-3` as §Shards assigns it; rows land in `rows/decode-shard-3.*` every 2 rounds.*

### Decode shard 4, measured

*Run 2026-11-04 by the shard-4 session, given only §7, which it ran as §Shards writes it, k = 4. Terms are §7's (Terms).*

* **Run:** block `shard-4`, 13 rounds (0–12 of both Williams squares), every unit of §7 at 1× on every rung and at 4× on the crossover rung, interleaved, with its own A/A.
* **Shows:** this block's ratios with their within-block 95 % intervals (below, and every cell in `rows/decode-shard-4.txt`). **One block: not a verdict**; `decode_pool.py` reads every cell as *not read: one block*.
* **Every check matched:** H exact 4 992/4 992, R exact, residual and lossy 4 160/4 160 each, S lossy 32 240/32 240; no unit errored; no void cell. Each exact frame was checked against the fetch checksum of its source.
* **Rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` only (two 12-bit, one 10-bit, middle 16 slices); one 4-core host; Chromium 141.0.7390.37 headless.
* **Left:** the other five blocks and the pool (§Shards); nothing here is claimed for another host, a phone, concurrent decodes or a timed link.

**Host** (its `host` row): Intel Xeon Processor @ 2.80 GHz, 4 cores, 16 GB. **Setup** (`decode_setup.sh`, fresh host): 25.3 min.
**Rounds:** 13. A round took 16–17 min here (1× 6.6–7.1 min; 4× 9.7–16.3 min), against the pilot's 10.6. `--until` stopped the
block before round 13. The shard loop was killed once by the session's 2 h background limit, in round 7. That round's partial rows were dropped. It resumed at round 7, as §7's Order allows. The stack trace in `decode-shard-4.log` is that kill.
**Saturation:** as §7 Saturation states it. One decode is in flight. dav1d-WASM and OpenJPH use one core of 4 at 1×. At 4× each browser thread is capped at a quarter of a CPU. WebCodecs runs its own threads, so its cells are not a one-core figure. Nothing is claimed past 4×.

**A/A** (H′ ÷ H, median over every (series, rung) and round, distribution-free 95 %): 1× **0.993 [0.984–0.999]**, 117 pairs; 4×
**0.996 [0.956–1.034]**, 39 pairs. Both are inside ±5 %, so both throttles are kept.

**D1–D3, this block** (ratio = median over 13 rounds of the paired ratio, [within-block distribution-free 95 %]; band from §7).
D1 is WebCodecs in order ÷ H, band ≤ 1.0. D2 is a jump at G = 16 ÷ a jump at G = 1, band 5–9. D3 is R ÷ H, band 0.9–1.1:

| cell | D1 G 1 · 8 · 16 | D2 dav1d-WASM · WebCodecs | D3 12-bit · top 10 (B: 10-bit) |
| --- | --- | --- | --- |
| `dbts_a1` Q 8, 1× | 1.82 [1.68–1.91] · 2.09 [2.00–2.14] · 2.16 [2.05–2.34] | 10.7 [9.5–11.4] · 9.08 [8.84–9.79] | 1.43 [1.38–1.50] · 1.46 [1.43–1.50] |
| `dbts_a1` Q 16, 1× | 1.23 [1.09–1.39] · 1.35 [1.26–1.43] · 1.43 [1.31–1.48] | 14.2 [12.7–15.4] · 8.69 [8.15–9.20] | 1.46 [1.36–1.52] · 1.46 [1.34–1.58] |
| `dbts_a1` Q 16, 4× | 0.78 [0.73–0.86] · 0.81 [0.77–0.86] · 0.83 [0.79–0.89] | 13.7 [12.6–13.9] · 7.00 [5.23–7.85] | 1.47 [1.34–1.57] · 1.50 [1.34–1.54] |
| `dbts_a1` Q 32, 1× | 1.05 [0.97–1.18] · 1.22 [1.15–1.27] · 1.20 [1.10–1.30] | 7.59 [6.74–8.24] · 8.33 [7.97–8.90] | 1.51 [1.49–1.65] · 1.46 [1.43–1.53] |
| `dbts_b1` Q 16, 1× | 1.64 [1.54–1.68] · 2.00 [1.90–2.02] · 2.00 [1.94–2.10] | 11.6 [10.9–12.4] · 9.31 [8.69–9.82] | 1.66 [1.53–1.81] |
| `dbts_b1` Q 32, 1× | 1.35 [1.28–1.44] · 1.56 [1.43–1.68] · 1.56 [1.49–1.65] | 8.22 [7.84–8.52] · 8.83 [7.83–9.20] | 1.67 [1.62–1.80] |
| `dbts_b1` Q 32, 4× | 1.05 [0.98–1.14] · 1.07 [0.99–1.13] · 1.08 [1.00–1.12] | 8.18 [7.67–8.74] · 8.12 [7.79–9.58] | 1.62 [1.44–1.78] |
| `dbts_b1` Q 56, 1× | 1.27 [1.12–1.35] · 1.53 [1.20–1.58] · 1.44 [1.28–1.53] | 4.00 [3.70–4.25] · 8.05 [7.60–8.84] | 1.74 [1.60–1.94] |
| `dbts_c1` Q 8, 1× | 1.95 [1.89–2.07] · 2.21 [2.00–2.33] · 2.17 [1.98–2.24] | 9.95 [9.21–10.6] · 8.63 [8.34–9.14] | 1.56 [1.50–1.70] · 1.55 [1.48–1.58] |
| `dbts_c1` Q 16, 1× | 1.46 [1.26–1.67] · 1.66 [1.48–1.70] · 1.54 [1.44–1.65] | 11.8 [10.8–12.6] · 8.36 [8.21–9.79] | 1.61 [1.54–1.71] · 1.61 [1.54–1.71] |
| `dbts_c1` Q 16, 4× | 0.98 [0.93–1.05] · 0.97 [0.96–1.06] · 0.99 [0.87–1.10] | 11.9 [10.9–12.7] · 7.73 [7.23–8.31] | 1.67 [1.48–1.73] · 1.55 [1.49–1.69] |
| `dbts_c1` Q 32, 1× | 1.23 [1.16–1.30] · 1.42 [1.32–1.55] · 1.33 [1.24–1.40] | 4.97 [4.73–5.48] · 8.05 [7.79–8.44] | 1.60 [1.52–1.74] · 1.57 [1.50–1.78] |

**H, ms** (median over rounds, a frame): 23–25 on `dbts_a1` and `dbts_c1` at 1×, 107–115 at 4×; 65–71 on `dbts_b1` at 1×,
335 at 4×. These are milliseconds inside this block only.

**Order effect.** Of the cells above, the largest effects are R ÷ H on `dbts_b1` (126–188 %), the `dbts_b1` A/A (61–155 %) and WebCodecs
jumps at 4× (54–57 %). In every cell all 400 shuffles reach the effect seen (p 1.0), so none is beyond its shuffles.
The rest of the block's cells are in `rows/decode-shard-4.txt`: G in order, G on a jump, the 12-bit forms (dav1d-WASM ÷
WebCodecs) and every unit ÷ H. The derived link figures are left to the collector's `--links`.

### Decode shard 5, measured

*Partial, 2026-11-04 20:55 UTC: setup and the mutations done; block `shard-5` running again after a void start (below), its rows pushed every two rounds
to `lab/av1/profiles/rows/decode-shard-5.*`. The cells follow when it stops.*

* **Host:** Intel Xeon @ 2.10 GHz, 4 cores (one thread each), 15 GiB, Linux; nothing else running during the block.
* **Setup** (`decode_setup.sh` on this fresh host): 16.9 min wall.
* **Mutations, once before the block**, `dbts_a1` Q 16 at 1×, one round: `--mutate hash` — every check 0 on all 16
  units (exact 0/16, lossy 0/16 or 0/20, residuals 0/16); `--mutate offset` — R exact 0/16 on both forms, residuals
  16/16 and lossy 16/16 intact, no other unit failed; `--mutate drop` — both S8 jumps fail, dav1d-WASM `dav1d -28`,
  WebCodecs `Decoding error.`, each with 1/20 lossy frames matched; `decode_pool.py --test`: every test passed.
* **A void start.** The first launch was meant to be stopped inside round 0 and relaunched detached from the
  session's two-hour command limit; only its browser stopped, its loop went on, so from 19:00 to 20:49 UTC two block
  drivers ran at once on this host, writing to the same rows. Every round of that (0–10, commit `d6fcace0`, the log
  above its `restart` line) had two decodes in flight on four cores: **void**, read nowhere. The block restarted from
  round 0 at 20:50 UTC with one driver, under the same `--until` (T0 + 4.1 h = 22:37 UTC), which leaves room for about
  10 rounds.

### Decode shard 6, measured

*Run 2026-11-04, 18:29–22:52 UTC, by a session given only §7; nothing in §7 was changed.*

* **Ran:** block `shard-6` of §7, rounds 0–22 (23), as §Shards writes it, then §7's three driver mutations and the pool's nine.
* **Shows:** every check matched in all 23 rounds; the A/A sits inside ±5 % at 1× and at 4×, so the block is kept.
* **Its cells:** the tables below, each a median over 23 rounds with its interval inside this block.
* **Rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` only (two DBT systems at 12 bits, one at 10), one 4-core host, Chromium 141.
* **Left:** everything across blocks — the pooled ratios, D1–D3, the order effects on pooled pairs: the collector's. **One block: not a verdict.**

Terms as §7 (H, H′, R, S_G, in order, jump, unit, round, block, A/A, 4×). Here **WC** is WebCodecs and **d1** is
dav1d-WASM; **ord** is in order. A **within-block interval** is the distribution-free 95 % interval of the median over
this block's rounds (`median_interval` in `decode_pool.py`): it states how far this host's rounds vary, not how far hosts
do.

**Host** (its `host` row): Intel Xeon Processor @ 2.10 GHz, 4 cores, 16 GB; headless Chromium 141.0.7390.37
(Playwright 1.56.1, `decode_setup.sh`'s pin). Setup (`decode_setup.sh`): 17.0 min. A round: 9.3 min (the median of the
12 rounds whose wall time the log carries, 548–609 s). The block ran nothing beside it.

**Saturation.** As §7 states it, not measured here: dav1d-WASM and OpenJPH-WASM run one thread each, so at 1× the 4-core
host does not saturate; at 4× each browser thread gets a quarter of a CPU; WebCodecs runs its own decoder threads, so its
cells are no one-core figure at either throttle. Nothing is claimed past 4×, for concurrent decodes or for a link.

**Checks, all 23 rounds** — every exact frame against its source's fetch checksum, every lossy frame against native
dav1d 1.5.4: H and H′ exact 8 832/8 832; R exact after its add 7 360/7 360, its residuals against `streams.py`
7 360/7 360, its lossy frames 7 360/7 360; S lossy 57 040/57 040; no error. **Void cells: none.**

**A/A** (H′ ÷ H over every (series, rung) and round): **1× 0.995 [0.984–1.003], 207 pairs; 4× 0.990 [0.971–1.009],
69 pairs** — both inside ±ln 1.05: kept at both throttles.

**Mutations**, once after the block, on `dbts_a1` Q 16 at 1×, one round each (rows not kept; tallies in
`decode-shard-6.log`): `--mutate hash` — every check 0 on all 16 units; `--mutate offset` — R exact 0/16 on both forms,
their residuals 16/16 and lossy frames 16/16 intact, the other 14 units untouched; `--mutate drop` — both S8 jumps fail
(dav1d-WASM `-28`, WebCodecs `Decoding error.`) with 1 of 20 frames matched, every other unit untouched.
`decode_pool.py --test` passes as committed; §7's nine pool mutations, each applied to a copy by one text
substitution, each fail it.

**Cells.** The ratios are block medians over 23 rounds of ln(numerator ÷ denominator), paired by round, followed by
their within-block intervals; `decode_pool.py` marks every cell "not read: one block", by §7's rule. Each heading gives
the family's largest order effect on this block's 23 pairs, with the share of 400 shuffles that reach it (§7: an effect
whose shuffle share is ≥ 5 % does not stop a cell being read). Full lines: `decode-shard-6.txt`.

**A/A per cell — H′ ÷ H**, block median [95 % within-block interval]; largest order effect 60% (shuffle p 0.91; dbts_b1 Q32 1× H′ ÷ H):

| series Q × | H′ ÷ H |
| --- | --: |
| `dbts_a1` Q8 1× | 0.988 [0.946–1.016] |
| `dbts_a1` Q16 1× | 1.004 [0.974–1.020] |
| `dbts_a1` Q32 1× | 0.998 [0.982–1.024] |
| `dbts_a1` Q16 4× | 0.969 [0.939–1.007] |
| `dbts_b1` Q16 1× | 0.999 [0.939–1.028] |
| `dbts_b1` Q32 1× | 0.993 [0.975–1.025] |
| `dbts_b1` Q56 1× | 0.981 [0.964–1.020] |
| `dbts_b1` Q32 4× | 0.999 [0.974–1.020] |
| `dbts_c1` Q8 1× | 0.962 [0.922–0.998] |
| `dbts_c1` Q16 1× | 1.005 [0.936–1.071] |
| `dbts_c1` Q32 1× | 1.002 [0.949–1.101] |
| `dbts_c1` Q16 4× | 0.993 [0.970–1.019] |

**D1 — S_G WebCodecs in order ÷ H (band ≤ 1.0)**, block median [95 % within-block interval]; largest order effect 50% (shuffle p 0.338; dbts_a1 Q16 4× S8|webcodecs|order ÷ H):

| series Q × | S1 WC ord ÷ H | S8 WC ord ÷ H | S16 WC ord ÷ H |
| --- | --: | --: | --: |
| `dbts_a1` Q8 1× | 1.867 [1.800–1.918] | 2.170 [2.120–2.218] | 2.207 [2.164–2.332] |
| `dbts_a1` Q16 1× | 1.254 [1.216–1.369] | 1.427 [1.359–1.520] | 1.379 [1.333–1.525] |
| `dbts_a1` Q32 1× | 1.115 [1.031–1.163] | 1.169 [1.142–1.319] | 1.213 [1.174–1.255] |
| `dbts_a1` Q16 4× | 0.829 [0.783–0.848] | 0.804 [0.773–0.861] | 0.829 [0.811–0.847] |
| `dbts_b1` Q16 1× | 1.841 [1.714–1.945] | 2.069 [1.931–2.237] | 2.033 [1.990–2.108] |
| `dbts_b1` Q32 1× | 1.492 [1.470–1.540] | 1.641 [1.583–1.712] | 1.621 [1.587–1.701] |
| `dbts_b1` Q56 1× | 1.383 [1.340–1.471] | 1.531 [1.463–1.585] | 1.521 [1.459–1.579] |
| `dbts_b1` Q32 4× | 1.188 [1.142–1.198] | 1.170 [1.150–1.205] | 1.180 [1.149–1.192] |
| `dbts_c1` Q8 1× | 2.121 [2.057–2.198] | 2.324 [2.235–2.371] | 2.229 [2.191–2.350] |
| `dbts_c1` Q16 1× | 1.504 [1.374–1.575] | 1.613 [1.480–1.751] | 1.554 [1.481–1.675] |
| `dbts_c1` Q32 1× | 1.299 [1.202–1.405] | 1.402 [1.344–1.496] | 1.322 [1.289–1.576] |
| `dbts_c1` Q16 4× | 0.970 [0.926–1.008] | 0.970 [0.937–1.003] | 0.959 [0.897–1.010] |

**D2 — S16 jump ÷ S1 jump (band 5–9)**, block median [95 % within-block interval]; largest order effect 308% (shuffle p 0.338; dbts_a1 Q16 4× S16|webcodecs|jump ÷ S1|webcodecs|jump):

| series Q × | S16 d1 jump ÷ S1 d1 jump | S16 WC jump ÷ S1 WC jump |
| --- | --: | --: |
| `dbts_a1` Q8 1× | 10.005 [9.421–10.948] | 9.207 [9.029–9.313] |
| `dbts_a1` Q16 1× | 12.782 [11.741–13.261] | 8.424 [8.048–8.879] |
| `dbts_a1` Q32 1× | 7.289 [6.675–7.657] | 8.152 [7.763–8.451] |
| `dbts_a1` Q16 4× | 12.801 [11.857–13.323] | 6.366 [4.774–7.400] |
| `dbts_b1` Q16 1× | 10.520 [10.085–11.209] | 8.784 [8.592–8.977] |
| `dbts_b1` Q32 1× | 8.055 [7.522–8.717] | 8.540 [8.209–8.690] |
| `dbts_b1` Q56 1× | 3.976 [3.710–4.158] | 8.549 [8.317–8.715] |
| `dbts_b1` Q32 4× | 7.957 [7.852–8.260] | 8.228 [7.594–8.449] |
| `dbts_c1` Q8 1× | 10.166 [9.710–10.685] | 8.742 [8.366–8.908] |
| `dbts_c1` Q16 1× | 11.415 [10.745–12.244] | 8.490 [8.119–8.838] |
| `dbts_c1` Q32 1× | 4.707 [4.629–5.001] | 8.826 [8.159–9.139] |
| `dbts_c1` Q16 4× | 11.269 [10.945–11.707] | 7.189 [4.407–7.590] |

**D3 — R ÷ H (band 0.9–1.1)**, block median [95 % within-block interval]; largest order effect 71% (shuffle p 0.875; dbts_b1 Q16 1× R|10bit ÷ H):

| series Q × | R 12bit ÷ H | R top10 ÷ H | R 10bit ÷ H |
| --- | --: | --: | --: |
| `dbts_a1` Q8 1× | 1.413 [1.350–1.483] | 1.407 [1.357–1.475] | — |
| `dbts_a1` Q16 1× | 1.482 [1.436–1.510] | 1.442 [1.398–1.480] | — |
| `dbts_a1` Q32 1× | 1.456 [1.423–1.508] | 1.441 [1.412–1.475] | — |
| `dbts_a1` Q16 4× | 1.426 [1.389–1.471] | 1.413 [1.359–1.465] | — |
| `dbts_b1` Q16 1× | — | — | 1.589 [1.485–1.908] |
| `dbts_b1` Q32 1× | — | — | 1.652 [1.575–1.763] |
| `dbts_b1` Q56 1× | — | — | 1.739 [1.655–1.873] |
| `dbts_b1` Q32 4× | — | — | 1.651 [1.587–1.681] |
| `dbts_c1` Q8 1× | 1.559 [1.481–1.599] | 1.478 [1.417–1.566] | — |
| `dbts_c1` Q16 1× | 1.571 [1.466–1.627] | 1.543 [1.411–1.627] | — |
| `dbts_c1` Q32 1× | 1.582 [1.509–1.653] | 1.520 [1.492–1.628] | — |
| `dbts_c1` Q16 4× | 1.551 [1.522–1.622] | 1.495 [1.464–1.567] | — |

**G on a jump — S8 jump ÷ S1 jump**, block median [95 % within-block interval]; largest order effect 79% (shuffle p 0.69; dbts_c1 Q16 4× S8|dav1d|jump ÷ S1|dav1d|jump):

| series Q × | S8 d1 jump ÷ S1 d1 jump | S8 WC jump ÷ S1 WC jump |
| --- | --: | --: |
| `dbts_a1` Q8 1× | 5.455 [5.148–5.637] | 4.794 [4.685–5.040] |
| `dbts_a1` Q16 1× | 6.404 [5.747–6.590] | 4.628 [4.390–4.767] |
| `dbts_a1` Q32 1× | 3.866 [3.656–4.156] | 4.523 [4.361–4.658] |
| `dbts_a1` Q16 4× | 6.326 [6.211–6.468] | 3.255 [2.367–3.772] |
| `dbts_b1` Q16 1× | 5.387 [5.261–5.629] | 4.905 [4.655–4.962] |
| `dbts_b1` Q32 1× | 4.209 [4.029–4.441] | 4.515 [4.374–4.696] |
| `dbts_b1` Q56 1× | 2.325 [2.228–2.417] | 4.507 [4.382–4.680] |
| `dbts_b1` Q32 4× | 4.225 [4.117–4.352] | 4.275 [3.933–4.441] |
| `dbts_c1` Q8 1× | 5.285 [5.005–5.452] | 4.592 [4.440–4.852] |
| `dbts_c1` Q16 1× | 5.899 [5.556–6.291] | 4.514 [4.348–4.685] |
| `dbts_c1` Q32 1× | 2.760 [2.560–2.872] | 4.817 [4.577–4.933] |
| `dbts_c1` Q16 4× | 5.800 [5.598–6.014] | 2.962 [2.370–4.030] |

**G in order — S8, S16 in order ÷ S1 in order**, block median [95 % within-block interval]; largest order effect 66% (shuffle p 0.815; dbts_c1 Q32 1× S16|dav1d|order ÷ S1|dav1d|order):

| series Q × | S8 d1 ord ÷ S1 d1 ord | S16 d1 ord ÷ S1 d1 ord | S8 WC ord ÷ S1 WC ord | S16 WC ord ÷ S1 WC ord |
| --- | --: | --: | --: | --: |
| `dbts_a1` Q8 1× | 1.203 [1.132–1.253] | 1.189 [1.176–1.243] | 1.147 [1.115–1.181] | 1.192 [1.162–1.223] |
| `dbts_a1` Q16 1× | 1.489 [1.447–1.527] | 1.536 [1.409–1.578] | 1.093 [1.067–1.183] | 1.102 [1.041–1.152] |
| `dbts_a1` Q32 1× | 0.954 [0.871–0.978] | 0.921 [0.884–0.957] | 1.132 [1.067–1.146] | 1.084 [1.036–1.241] |
| `dbts_a1` Q16 4× | 1.513 [1.485–1.561] | 1.542 [1.504–1.582] | 0.986 [0.957–1.016] | 1.021 [1.000–1.048] |
| `dbts_b1` Q16 1× | 1.334 [1.298–1.362] | 1.316 [1.265–1.344] | 1.098 [1.075–1.147] | 1.112 [1.087–1.154] |
| `dbts_b1` Q32 1× | 0.938 [0.864–0.960] | 0.960 [0.935–0.971] | 1.080 [1.046–1.117] | 1.091 [1.073–1.110] |
| `dbts_b1` Q56 1× | 0.392 [0.382–0.399] | 0.399 [0.384–0.416] | 1.094 [1.053–1.114] | 1.100 [1.044–1.124] |
| `dbts_b1` Q32 4× | 0.968 [0.930–0.988] | 0.963 [0.927–0.988] | 0.991 [0.972–1.035] | 1.002 [0.973–1.031] |
| `dbts_c1` Q8 1× | 1.168 [1.096–1.241] | 1.136 [1.092–1.175] | 1.098 [1.054–1.112] | 1.069 [1.042–1.104] |
| `dbts_c1` Q16 1× | 1.364 [1.288–1.418] | 1.335 [1.275–1.372] | 1.096 [1.047–1.134] | 1.047 [0.979–1.087] |
| `dbts_c1` Q32 1× | 0.518 [0.499–0.564] | 0.517 [0.492–0.523] | 1.120 [1.056–1.160] | 1.070 [1.042–1.100] |
| `dbts_c1` Q16 4× | 1.375 [1.352–1.399] | 1.347 [1.311–1.380] | 1.021 [0.972–1.050] | 0.991 [0.955–1.070] |

**the 12-bit forms — S_G dav1d-WASM ÷ S_G WebCodecs (on `dbts_b1` one 10-bit stream to both)**, block median [95 % within-block interval]; largest order effect 590% (shuffle p 0.46; dbts_c1 Q16 4× S1|dav1d|jump ÷ S1|webcodecs|jump):

| series Q × | S1 d1 ord ÷ S1 WC ord | S1 d1 jump ÷ S1 WC jump | S8 d1 ord ÷ S8 WC ord | S8 d1 jump ÷ S8 WC jump | S16 d1 ord ÷ S16 WC ord | S16 d1 jump ÷ S16 WC jump |
| --- | --: | --: | --: | --: | --: | --: |
| `dbts_a1` Q8 1× | 1.514 [1.435–1.544] | 1.372 [1.302–1.409] | 1.501 [1.469–1.602] | 1.506 [1.413–1.608] | 1.524 [1.420–1.644] | 1.510 [1.404–1.595] |
| `dbts_a1` Q16 1× | 1.554 [1.471–1.637] | 1.322 [1.271–1.426] | 2.058 [1.974–2.120] | 1.783 [1.687–1.897] | 2.121 [1.962–2.196] | 1.975 [1.905–2.070] |
| `dbts_a1` Q32 1× | 2.340 [2.239–2.561] | 1.948 [1.868–2.094] | 1.919 [1.762–2.134] | 1.727 [1.597–1.800] | 1.951 [1.868–2.028] | 1.714 [1.639–1.794] |
| `dbts_a1` Q16 4× | 2.198 [2.136–2.257] | 1.367 [1.094–1.910] | 3.468 [3.288–3.650] | 2.910 [2.862–3.010] | 3.390 [3.201–3.500] | 3.127 [2.898–3.260] |
| `dbts_b1` Q16 1× | 1.394 [1.352–1.475] | 1.341 [1.304–1.397] | 1.676 [1.629–1.721] | 1.505 [1.471–1.579] | 1.656 [1.586–1.700] | 1.636 [1.576–1.720] |
| `dbts_b1` Q32 1× | 1.967 [1.922–2.023] | 1.727 [1.638–1.872] | 1.717 [1.632–1.773] | 1.608 [1.548–1.676] | 1.717 [1.622–1.751] | 1.638 [1.598–1.740] |
| `dbts_b1` Q56 1× | 3.321 [3.212–3.380] | 2.891 [2.816–3.033] | 1.182 [1.156–1.209] | 1.498 [1.419–1.583] | 1.185 [1.151–1.261] | 1.350 [1.287–1.413] |
| `dbts_b1` Q32 4× | 2.467 [2.365–2.503] | 2.235 [2.028–2.274] | 2.356 [2.330–2.383] | 2.168 [2.119–2.228] | 2.371 [2.260–2.421] | 2.208 [2.135–2.270] |
| `dbts_c1` Q8 1× | 1.265 [1.228–1.339] | 1.156 [1.092–1.215] | 1.347 [1.302–1.434] | 1.313 [1.274–1.385] | 1.378 [1.322–1.432] | 1.362 [1.316–1.435] |
| `dbts_c1` Q16 1× | 1.359 [1.288–1.417] | 1.184 [1.090–1.246] | 1.707 [1.595–1.797] | 1.482 [1.412–1.641] | 1.766 [1.638–1.807] | 1.563 [1.476–1.730] |
| `dbts_c1` Q32 1× | 3.155 [2.910–3.326] | 2.675 [2.567–2.828] | 1.503 [1.432–1.611] | 1.509 [1.450–1.595] | 1.499 [1.405–1.639] | 1.511 [1.397–1.558] |
| `dbts_c1` Q16 4× | 2.085 [1.968–2.138] | 1.116 [0.977–1.722] | 2.768 [2.673–2.864] | 2.385 [2.313–2.568] | 2.771 [2.695–2.804] | 2.530 [2.475–2.570] |

**every unit against H — S_G ÷ H**, block median [95 % within-block interval]; largest order effect 457% (shuffle p 0.338; dbts_a1 Q16 4× S16|webcodecs|jump ÷ H):

| series Q × | S1 d1 ord ÷ H | S1 d1 jump ÷ H | S1 WC ord ÷ H | S1 WC jump ÷ H | S8 d1 ord ÷ H | S8 d1 jump ÷ H | S8 WC ord ÷ H | S8 WC jump ÷ H | S16 d1 ord ÷ H | S16 d1 jump ÷ H | S16 WC ord ÷ H | S16 WC jump ÷ H |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| `dbts_a1` Q8 1× | 2.816 [2.741–2.878] | 2.847 [2.735–3.066] | 1.867 [1.800–1.918] | 2.090 [2.051–2.169] | 3.342 [3.183–3.473] | 15.416 [15.008–16.181] | 2.170 [2.120–2.218] | 10.162 [9.932–10.646] | 3.391 [3.291–3.479] | 29.105 [28.324–32.509] | 2.207 [2.164–2.332] | 19.094 [18.736–20.033] |
| `dbts_a1` Q16 1× | 2.025 [1.851–2.072] | 2.055 [1.941–2.230] | 1.254 [1.216–1.369] | 1.536 [1.473–1.573] | 2.839 [2.803–2.963] | 12.424 [11.984–13.142] | 1.427 [1.359–1.520] | 6.930 [6.700–7.452] | 2.924 [2.840–3.008] | 25.414 [24.565–26.667] | 1.379 [1.333–1.525] | 12.714 [12.236–13.396] |
| `dbts_a1` Q32 1× | 2.572 [2.505–2.660] | 2.676 [2.565–2.819] | 1.115 [1.031–1.163] | 1.334 [1.282–1.416] | 2.411 [2.282–2.476] | 10.113 [9.620–10.657] | 1.169 [1.142–1.319] | 6.071 [5.824–6.395] | 2.370 [2.316–2.460] | 18.825 [18.057–20.215] | 1.213 [1.174–1.255] | 11.112 [10.762–11.322] |
| `dbts_a1` Q16 4× | 1.798 [1.740–1.894] | 1.858 [1.792–1.950] | 0.829 [0.783–0.848] | 1.360 [1.032–1.694] | 2.794 [2.679–2.832] | 11.781 [11.411–12.225] | 0.804 [0.773–0.861] | 3.987 [3.902–4.285] | 2.845 [2.685–2.920] | 23.698 [23.058–25.256] | 0.829 [0.811–0.847] | 7.710 [7.460–8.199] |
| `dbts_b1` Q16 1× | 2.575 [2.428–2.730] | 2.724 [2.622–2.842] | 1.841 [1.714–1.945] | 2.046 [1.923–2.235] | 3.379 [3.257–3.589] | 14.485 [13.649–15.759] | 2.069 [1.931–2.237] | 9.742 [9.371–10.131] | 3.403 [3.224–3.513] | 28.658 [27.689–31.318] | 2.033 [1.990–2.108] | 18.084 [16.942–18.558] |
| `dbts_b1` Q32 1× | 2.992 [2.841–3.093] | 2.984 [2.866–3.128] | 1.492 [1.470–1.540] | 1.679 [1.661–1.769] | 2.744 [2.665–2.851] | 12.212 [11.812–13.213] | 1.641 [1.583–1.712] | 7.805 [7.579–8.109] | 2.806 [2.723–2.937] | 24.139 [22.440–25.271] | 1.621 [1.587–1.701] | 14.521 [13.960–14.867] |
| `dbts_b1` Q56 1× | 4.545 [4.434–4.745] | 4.662 [4.558–4.842] | 1.383 [1.340–1.471] | 1.601 [1.571–1.645] | 1.799 [1.725–1.819] | 10.917 [10.494–11.482] | 1.531 [1.463–1.585] | 7.333 [6.929–7.674] | 1.831 [1.751–1.895] | 18.419 [17.218–19.353] | 1.521 [1.459–1.579] | 13.692 [13.070–14.339] |
| `dbts_b1` Q32 4× | 2.881 [2.756–2.950] | 2.907 [2.848–2.959] | 1.188 [1.142–1.198] | 1.290 [1.279–1.380] | 2.783 [2.724–2.811] | 12.211 [11.741–12.783] | 1.170 [1.150–1.205] | 5.654 [5.484–5.899] | 2.750 [2.689–2.833] | 23.390 [22.642–23.929] | 1.180 [1.149–1.192] | 10.487 [10.141–10.760] |
| `dbts_c1` Q8 1× | 2.676 [2.559–2.835] | 2.722 [2.595–2.925] | 2.121 [2.057–2.198] | 2.316 [2.241–2.481] | 3.127 [3.011–3.286] | 14.140 [13.682–15.040] | 2.324 [2.235–2.371] | 10.760 [10.321–11.647] | 2.968 [2.889–3.220] | 28.642 [27.337–29.168] | 2.229 [2.191–2.350] | 20.810 [19.743–21.412] |
| `dbts_c1` Q16 1× | 2.091 [1.877–2.161] | 2.055 [1.903–2.210] | 1.504 [1.374–1.575] | 1.714 [1.649–1.819] | 2.664 [2.561–2.935] | 12.416 [11.020–12.990] | 1.613 [1.480–1.751] | 7.731 [7.381–8.422] | 2.744 [2.524–2.916] | 23.284 [21.785–24.718] | 1.554 [1.481–1.675] | 14.683 [13.782–15.300] |
| `dbts_c1` Q32 1× | 4.131 [3.986–4.264] | 3.968 [3.776–4.228] | 1.299 [1.202–1.405] | 1.494 [1.443–1.598] | 2.088 [2.042–2.281] | 11.269 [10.240–11.440] | 1.402 [1.344–1.496] | 7.082 [6.691–7.378] | 2.070 [1.899–2.241] | 19.198 [18.331–20.680] | 1.322 [1.289–1.576] | 13.207 [12.550–13.772] |
| `dbts_c1` Q16 4× | 1.947 [1.888–2.061] | 2.027 [1.902–2.085] | 0.970 [0.926–1.008] | 1.845 [1.170–2.135] | 2.705 [2.566–2.798] | 11.971 [11.264–12.304] | 0.970 [0.937–1.003] | 4.913 [4.624–5.101] | 2.574 [2.525–2.785] | 22.825 [22.520–23.442] | 0.959 [0.897–1.010] | 8.914 [8.728–9.410] |

**ms, median over rounds, inside this block only:**

| series Q × | H | H′ | R 12bit | R top10 | S16 d1 jump | S16 d1 ord | S16 WC jump | S16 WC ord | S1 d1 jump | S1 d1 ord | S1 WC jump | S1 WC ord | S8 d1 jump | S8 d1 ord | S8 WC jump | S8 WC ord | R 10bit |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| `dbts_a1` Q8 1× | 16 | 16 | 22 | 22 | 457 | 54 | 305 | 35 | 45 | 45 | 33 | 29 | 245 | 53 | 160 | 34 | — |
| `dbts_a1` Q16 1× | 16 | 16 | 23 | 23 | 399 | 47 | 201 | 22 | 32 | 31 | 24 | 20 | 195 | 45 | 110 | 22 | — |
| `dbts_a1` Q32 1× | 16 | 16 | 24 | 23 | 299 | 38 | 176 | 20 | 42 | 41 | 21 | 18 | 162 | 39 | 96 | 19 | — |
| `dbts_a1` Q16 4× | 75 | 72 | 106 | 103 | 1760 | 207 | 576 | 62 | 140 | 135 | 98 | 62 | 877 | 205 | 301 | 60 | — |
| `dbts_b1` Q16 1× | 47 | 47 | — | — | 1364 | 157 | 833 | 95 | 127 | 120 | 93 | 85 | 682 | 161 | 451 | 95 | 74 |
| `dbts_b1` Q32 1× | 47 | 46 | — | — | 1095 | 128 | 665 | 75 | 137 | 135 | 79 | 70 | 574 | 129 | 360 | 74 | 76 |
| `dbts_b1` Q56 1× | 46 | 46 | — | — | 833 | 83 | 629 | 70 | 213 | 207 | 74 | 64 | 495 | 81 | 331 | 70 | 78 |
| `dbts_b1` Q32 4× | 208 | 206 | — | — | 4799 | 573 | 2180 | 241 | 604 | 589 | 271 | 246 | 2540 | 571 | 1173 | 243 | 332 |
| `dbts_c1` Q8 1× | 16 | 16 | 25 | 24 | 453 | 50 | 330 | 37 | 43 | 44 | 37 | 34 | 229 | 51 | 174 | 37 | — |
| `dbts_c1` Q16 1× | 16 | 16 | 25 | 25 | 378 | 44 | 243 | 25 | 33 | 33 | 28 | 24 | 195 | 45 | 130 | 26 | — |
| `dbts_c1` Q32 1× | 16 | 16 | 25 | 25 | 308 | 34 | 210 | 21 | 64 | 66 | 24 | 20 | 175 | 34 | 114 | 22 | — |
| `dbts_c1` Q16 4× | 74 | 74 | 115 | 110 | 1673 | 199 | 671 | 72 | 151 | 146 | 134 | 71 | 860 | 198 | 370 | 72 | — |

### Decode, pooled

*Not yet run: the collector, once the six have pushed (§Shards).*

## Larger cine fixtures

The largest open cine-like series at ≤ 12 bits the lab's sources hold (IDC v25, `idc-index` 0.13.4, `idc-index-data`
25.0.5, read 2026-11-02; earlier searches, `docs/FIXTURES.md` §The data hosts…, §The wider search, §The frame-group
data search):

| series | what | size | licence | verdict |
| --- | --- | --- | --- | --- |
| EA1141, system B's largest slice volume | DBT, 10 bits, 53 × 3328×4096 (AV1 level 6, `docs/av1/series.md` note 3) | 1 445 MB, one object | CC BY 4.0 | **added**, `dbts_b_max` |
| EA1141, system C's largest | DBT, 12 bits, 82 × 1833×2971 | 893 MB | CC BY 4.0 | **added**, `dbts_c_max` |
| EA1141, system A's largest | DBT, 12 bits, 84 × 1215×2761 | 564 MB | CC BY 4.0 | **added**, `dbts_a_max` |
| Prostate-MRI-US-Biopsy, two sweeps | 3-D transrectal ultrasound, 280 × 452², 8 bits, explicit LE | 57 MB each | CC BY 4.0 | **added**, `ustrus_1`, `ustrus_2`: sound, the nearest swept volume to ABUS, not breast |
| Breast-Cancer-Screening-DBT | DBT | 1.6 TB over 22 032 series | CC BY-NC 4.0 | no: non-commercial |
| VICTRE | in-silico DBT and mammograms | to 267 MB a series | CC BY 3.0 | no: simulated, not a modality's noise |
| ReMIND | brain ultrasound volumes, an NRRD export | to 197 MB | CC BY 4.0 | no: an export |
| B-mode-and-CEUS-Liver | liver cine | 2.3 GB a series on average | CC BY 4.0 | no: flagged lossy (`us_liver`'s source) |
| breast ultrasound cine, ABUS in DICOM | — | — | — | none open (unchanged since 2026-10-27) |

Their headers and pins are in `docs/FIXTURES.md` §AV1 data; each was fetched once, checked by `fetch_data.py`'s
provenance rule and its frame digest pinned.

## Sources

Read 2026-11-02.

* [L1] AOM, *AV1 Bitstream & Decoding Process Specification*, the editors' HTML edition,
  <https://aomediacodec.github.io/av1-spec/>: §Uncompressed header syntax (`LosslessArray`), §7.2 General decoding
  process, §Dequantization functions.
* [L2] libaom v3.15.1, `av1/encoder/av1_quantize.c`, `quantizer_to_qindex[]` ("Table that converts 0-63 Q-range values
  passed in outside to the Qindex range used internally"),
  <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/av1_quantize.c>; and `av1/av1_cx_iface.c`
  (`rc_cfg->cq_level = av1_quantizer_to_qindex(extra_cfg->cq_level)`).
* [L3] libaom v3.15.1, `av1/arg_defs.c`, <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/arg_defs.c>.
* [L4] DICOM PS3.3 2026d, C.11.2.1.2 and C.11.2.1.2.1,
  <https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.11.2.html>.
* [L5] W3C, *WebCodecs*, Working Draft, <https://www.w3.org/TR/webcodecs/>: `VideoPixelFormat`, `HardwareAcceleration`.
* [L6] scikit-image 0.25.x, `skimage.metrics.structural_similarity`,
  <https://scikit-image.org/docs/0.25.x/api/skimage.metrics.html>; Wang, Bovik, Sheikh, Simoncelli, *Image quality
  assessment: from error visibility to structural similarity*, IEEE TIP 13(4), 2004.
* [L7] D. L. Donoho, I. M. Johnstone, *Ideal spatial adaptation by wavelet shrinkage*, Biometrika 81(3), 1994 (the
  MAD ÷ 0.6745 noise estimate on the finest wavelet coefficients; cited, not re-read here: *unverified* wording).
* IDC: `idc-index` 0.13.4 and `idc-index-data` 25.0.5 (counts and sizes of §3 and §Larger cine fixtures).
