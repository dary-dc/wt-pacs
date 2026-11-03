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
source ([L1]–[L7], §Sources); inference is marked *derived*, the rest *unverified*.

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

**Every cell:** 700 cells (15 volumes; A and C three forms, B one; five rungs; four G), **46 280 of 46 280 frames
exact** (lossy frame + decoded residual − offset, hashed against the fetch checksum); `film_grain_params_present` 0
on every stream; every `--q-hist` entry at Q; keyframes exactly at the multiples of G and one temporal unit a frame
on every stream; aomdec = dav1d sample for sample on 15 of 15 streams (Q 8, G 16, stored form).

**Not yet in this section** (running on this host, appended here when done): lossless AV1 G = 1 split as shipped
(the column below says not run); the secondary alt-ref arm (`dbts_a1`, `dbts_b1`, `dbts_c1`, G 16); the sets of
content 2 and 3 that fit what is left of the 5 h at T (all ten of content 2, then `ustrus_1` and `ustrus_2`; the three
`*_max` volumes do not fit, 2.9–5.4 Gpx a rung each, and are **not run**); ρ on those. Content 4 is pending the owner's
dataset. No rung is called visually lossless.

### The predictions, against the numbers

Decided by `report.py` with each refutation clause as §2 writes it. **Held: P3, P4, P6, P8. Refuted: P1, P2, P5, P7,
P9.** P10: not run yet.

In short (every number in the tables after): the sign of inter's gain does turn with Q, as 1b says — at Q 2 and 8 the
G = 16 gain is −1.2 to +6.8 %, at each series' crossover rung (Q 16 on A, C and `dbts_b2`; Q 32 on the other four of
B) +29 to +61 %, at Q 56 +75 to +86 %. It turns at the noise (P6), rises with Q (P3) and scales with G as 1d (P4).
What is wrong is **how much** (P2: +80 % system medians at the first rung ≥ 2σ, Q 56 on every series that reaches it,
where +15 to +50 % was predicted), **which system** (P5: B gains least, not most), **one cell under the noise** (P1:
`dbts_b3` +6.8 % at Q 8, where its RMSE 3.13 is under σ ÷ 2 = 3.34 — with σ known only to one 0.741 step there, see the
σ check), **the residual's low end** (P7: on `dbts_b4` and `dbts_b5` lossy + residual at Q 2 is 0.896 and 0.928 of
HTJ2K, under the band; the other 13 sit at 1.002–1.012) and **depth** (P9: the windowed map clips the air and the
tails, 6.7–13.2 dB over the series; the 10-bit top is 11–26 % larger than the 12-bit stream at Q 16).

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
| P10 | recorded, no verdict | not run |

#### σ, ρ, crossover, bend

| series | σ | ρ (row 100) | HTJ2K B | lossless AV1 ÷ HTJ2K | crossover rung, by form | bend (G1) |
| --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 13.34 | 0.112 | 67812443 | not run | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_a2` | 14.08 | 0.116 | 97667570 | not run | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_a3` | 15.57 | 0.109 | 39712458 | not run | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_a4` | 16.31 | 0.111 | 117046467 | not run | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_a5` | 14.08 | 0.125 | 73139226 | not run | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_b1` | 5.93 | 0.181 | 107407602 | not run | 10bit 32 | 16 |
| `dbts_b2` | 4.45 | 0.189 | 143768865 | not run | 10bit 16 | 16 |
| `dbts_b3` | 6.67 | 0.266 | 119235171 | not run | 10bit 32 | 16 |
| `dbts_b4` | 6.67 | 0.228 | 125719597 | not run | 10bit 32 | 16 |
| `dbts_b5` | 4.45 | 0.215 | 91380288 | not run | 10bit 32 | 16 |
| `dbts_c1` | 14.83 | 0.117 | 70664924 | not run | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_c2` | 16.31 | 0.117 | 60299025 | not run | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_c3` | 16.31 | 0.116 | 94483885 | not run | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_c4` | 17.79 | 0.118 | 41429376 | not run | 12bit 16 · top10 16 · window 2 | 32 |
| `dbts_c5` | 14.83 | 0.113 | 82238373 | not run | 12bit 16 · top10 16 · window 2 | 32 |

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

#### Every window

| series | Q | window c/w | % differ | % > 1 code | max Δcode |
| --- | --- | --- | --- | --- | --- |
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
