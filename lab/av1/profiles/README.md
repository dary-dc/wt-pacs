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
