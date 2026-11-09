# Groups — what inter coding can buy the optimal-quality view, at equal quality

## Groups protocol, pre-registered

*Row GROUPS-THEORY, written 2026-11-09 before anything in it ran. Theory and protocol only: nothing was coded or timed
for it. Every number in §1–§3 is read from rows already measured (named at each use) or is labelled *derived*. A
separate session runs §Shards from this file alone, changes nothing above §Shards, and reports every cell, including
those that miss.*

1. **Asked:** why G (frames per keyframe) saves almost nothing in the optimal-quality (OQ) view's bytes at Q 8 on DBT;
   whether that survives a comparison at **equal quality** instead of equal Q; whether our encoder settings suppress
   inter coding; and what each choice costs to decode in order, the way the view is read (cine, scrolling).
2. **Answer, as theory:** the OQ view sits by its definition at the last rung where the view still carries part of the
   source's noise, and on the three timed volumes G's gain switches on within a rung of it, where the fine-band noise
   is gone from the reference (§1, §2.2). Our settings do switch off libaom's one tool built for this case, a
   temporally filtered reference: with `--lag-in-frames=0`, libaom applies no temporal filter and no temporal
   dependency model (§2.4, quoted). Such a reference can gain at most the structure's share of the bytes times inter's
   efficiency on structure (§2.5), about 3–15 % by a proxy from the rows, not the factor inter gives natural video.
3. **The numbers that decide it** come from the two shards (§Shards): bytes against in-window PSNR, e_N/σ and JOD on a
   dense ladder (Q 2–24), for G 1, 8, 16 and 32 across nine encoder configurations. A swap of noise between slices tests
   the mechanism directly. In-order decode is timed per frame through dav1d-WASM and WebCodecs.
4. **It rests on** `dbts_a1`, `dbts_b1` (its middle 32 slices), `dbts_c1`, the two TRUS sweeps, and the three
   lossy-sourced cine clips reported apart; on libaom 3.15.1, dav1d 1.5.4 and the quality study's measures
   (`lab/av1/metrics/`).
5. **Left open:** breast ultrasound cine and ABUS (no lossless dataset exists); other DBT systems; jumps (a fresh
   decoder at an arbitrary slice), measured elsewhere; any device but a 4-core cloud host at 1×; whether any rung is
   visually lossless to a reader (the quality study's §6 flicker test, not run).

### Terms

* **OQ view** — the series' optimal-quality AV1 view ([`../glossary.md`](../glossary.md), *optimal quality*): Q fixed
  per series, G frames a group, at the source's depth.
* **Q** — libaom's quantizer, 0–63 (`--cq-level`); qindex = 4Q. **Δ(Q)** — the AC step in sample units at the stream's
  depth, `av1_ac_quant_QTX(4Q, 0, depth) ÷ 8` (`noise-point.md` on `claude/av1-noise-point`, §Terms).
* **G** — frames from one keyframe to the next. **P/K** — the median predicted frame's unit bytes ÷ its keyframe's.
* **σ, e_N, in-window** — as `lab/av1/metrics/README.md` §Terms defines them: σ is a frame's noise in the 3 × 3
  Laplacian's band; e_N is the coding error in that band; in-window means samples strictly inside the first header
  window. **e_N/σ ≤ 1 on every frame** is the quality study's anchor (a) by noise, which the noise rule reproduces.
* **Gain at equal Q** — 1 − bytes(arm) ÷ bytes(reference) at the same Q. **BD-rate** — the mean log-ratio of bytes at
  equal quality between two curves over a stated quality interval (§7); negative means fewer bytes.
* **VL interval** — for a series, the in-window PSNR range between its O G 1 cells at Q 12 and Q 4. It contains every
  DBT noise anchor the quality study found (Q 4–12).
* **Hidden frame** — a coded frame with `show_frame` 0, shown later (if at all) by a unit with `show_existing_frame` 1.
  **ARF** — libaom's alternate reference: a future frame, temporally filtered, coded hidden.
* **Systems A, B, C** — the three EA1141 DBT scanners: A and C store 12 bits, B 10.

### 1 · What was measured, all at equal Q

From the quality study's rows (`lab/av1/metrics/rows/curves.tsv`, stored form, O; *derived* by dividing them):

| series | rung | e_N/σ, G 1 | bits a pixel, G 1 | G 16 gain at equal Q |
| --- | --: | --: | --: | --: |
| `dbts_a1` (A, 12-bit) | Q 4 · 8 · 12 · 16 · 24 | 0.58 · **0.995** · 1.027 · 1.028 · 1.029 | 1.28 · 0.35 · 0.11 · 0.052 · 0.027 | −0.6 · **−0.2** · +22.8 · +42.2 · +58.2 % |
| `dbts_c1` (C, 12-bit) | the same | 0.50 · 0.979 · 1.069 · 1.075 · 1.077 | 0.95 · 0.32 · 0.11 · 0.051 · 0.024 | +0.1 · +1.2 · +14.0 · +37.0 · +59.9 % |
| `dbts_b1` (B, 10-bit) | the same | 0.36 · 0.795 · **0.994** · 1.029 · 1.035 | 0.89 · 0.44 · 0.20 · 0.11 · 0.050 | +1.5 · +1.2 · **+6.4** · +18.3 · +38.5 % |
| `ustrus_1`, `ustrus_2` (TRUS) | Q 8 | 0.76, 0.77 | 1.00, 1.06 | +23.0, +22.7 % |

The OQ ingest build (`origin/claude/oq-ingest`, `docs/av1/payload-format.md` §Optimal quality) reproduced Q 8 at
0.074 / 0.219 / 0.096 of HTJ2K for `dbts_a1` / `b1` / `c1` at G 1, with G 16 within −1.2 to +0.2 % of it. Two readings
follow (*derived*):

* **G's gain switches on at the noise anchor.** On the three DBT volumes, G 16 gains under 2 % at every rung with
  e_N/σ ≤ 0.98, and at least 14 % at every rung with e_N/σ ≥ 1.02. The two rungs in between (bold) gain −0.2 %
  (`dbts_a1` Q 8) and +6.4 % (`dbts_b1` Q 12). The OQ view is defined at the last rung with e_N/σ ≤ 1, so under these
  settings it sits by construction where G has little or nothing to gain.
* **The bytes at Q 8 are not mostly fine-band noise.** On `dbts_a1`, e_N/σ is 0.995 at Q 8: the finest band's noise is
  nearly all quantized away already, yet Q 8 still costs 3.2× Q 12's bytes. What Q 8 keeps and Q 12 drops lies in
  coarser bands: noise that the Laplacian sees only partly, and fine structure. Neighbouring-slice correlation was
  measured only in the finest band (LOCO-I residual, `lab/av1/bytes/frame-groups/rho.py`): ρ 0.11–0.13 on A and C,
  0.18–0.27 on B. **So the working explanation, ρ < ½ of the fine-band noise, names the right mechanism in the wrong
  band**; §2.2–2.3 make it precise, and §6.4 measures ρ by band.

**The earlier alt-ref arm, re-read.** The bytes run's secondary arm (`lab/av1/profiles/README.md` on
`origin/claude/av1-quality-profiles`, §Secondary arm; `results/altref.jsonl`) coded the three volumes at G 16 with
`--lag-in-frames=19 --auto-alt-ref=1` and libaom's defaults for everything else, including keyframe filtering. It
reported "smaller at G 16 by 2.3–59.1 % but not at equal quality: its PSNR is lower at Q 2–32 by 0.1–2.1 dB." Read
again from its rows (*derived*):

* At Q 8 its PSNR (48.4, 50.0, 49.7 dB) falls between O's Q 8 and Q 12. Interpolated in ln bytes between those two
  rungs of the quality study's curves, it is **−13 to −5 % against O G 1 and +2 to +7 % against O G 16**. The two
  interpolations disagree by up to 19 points because Q 8 and Q 12 lie 2–4× apart in bytes. The ladder here is
  denser (Q 6, 8, 10, 12) for exactly that reason. At Q 16 the same arm is −57 to −35 % against O G 1 and −19 to −2 %
  against O G 16.
* Its keyframe units at Q 8 are 31.6, 305.9 and 42.1 kB, against O's 91.2, 467.8 and 102.2 kB. That is the keyframe
  filter's work: libaom 3.15.1 filters a keyframe and "filter without overlay (default)" (§2.4). In this arm, then,
  the shown keyframes are temporally filtered frames, not the source coded at Q.
* 15–26 of each stream's 50–69 units are at most 16 bytes long: a unit that only shows a frame already decoded
  (`show_existing_frame`). Whether those frames were filtered is not recorded; §6.3 parses it.

### 2 · Theory

**2.1 What the quantizer leaves at Q 8.** Δ(8) is 57 sample units at 12 bits and 15.3 at 10 (libaom's
`ac_qlookup_12_QTX[32]` = 456 and `ac_qlookup_10_QTX[32]` = 122, ÷ 8). Against the frames' σ (10–18 on A and C, 3.4–5.7
on B, quality study §Verdict), Δ/σ is 3.2–5.7 on A and C and 2.7–4.5 on B (*derived*). An orthonormal transform spreads
spatially white noise of variance σ² evenly over its coefficients (`lab/av1/profiles/README.md` §1b on
`origin/claude/av1-quality-profiles`), so at Δ ≥ 3σ almost every white-noise coefficient falls in the dead zone. That is
why e_N/σ ≈ 1 at Q 8. DBT's noise is not white: it is reconstructed, spatially correlated noise (the estimator check
in the quality study's §4.4 reads blurred noise at 0.66 of its σ). Its coarser-band components have per-coefficient
variance well above σ², so Q 8 still codes them while Q 12–16 drops them (*derived*; measured by κ, §6.4).

**2.2 Why inter loses while the reference still carries that noise.** Write a band of frame k as structure plus noise
n_k of variance σ_b², with correlation ρ_b to n_{k+1} at the best motion offset. Intra predicts from noisy
neighbours of the same frame; inter predicts from the *decoded* previous frame, which carries a fraction 1 − κ_b of
n_k (κ_b = 1: that band's noise fully removed; 0: fully kept). The inter residual's noise term is then
σ_b²[1 + (1 − κ_b) − 2ρ_b√(1 − κ_b)], which is 2σ²(1 − ρ) at κ = 0 (the lossless case, frame-groups §T2) and σ² at κ = 1
(*derived*). Inter beats intra on a noise band only when its noise term falls below intra's floor σ_b², that is
only when ρ_b > √(1 − κ_b) ÷ 2. At Q 8 on DBT the reference keeps the coarser-band noise (κ_b small) and ρ_b is
measured below ½ in the finest band. The encoder then codes such blocks intra inside inter frames and G gains
nothing. Where the reference has lost that noise (κ_b → 1), inter costs the same as intra on noise and wins on
structure: G's gain switches on, at Q 12 on A and C and at Q 12–16 on B (§1). §2.1–2.2 are the same theory as the
profiles run's §1b, with the reference's retained noise made explicit and the band left open.

**2.3 What DBT slices share, by band.** A volume is reconstructed from one set of 9–25 projections, and its slices
are about 1 mm apart against 0.1 mm pixels (frame-groups §T3, [S6]–[S7] there). A feature of in-plane size L is blurred
in depth over about L ÷ tan θ_max, half the angular range (*derived* from that geometry, unchecked against a
reconstruction). For θ_max 7.5–25°, a 0.1–0.2 mm grain spreads over 0.2–1.5 mm, one slice at most, while a 1.6 mm
blob spreads over 3.4–12 mm, several slices. So **ρ_b should rise toward coarser bands**, and inter could win on
those bands even with noise present. That is the case §2.2 leaves open. Whether the bands Q 8 still codes are
shared enough (ρ_b > √(1 − κ_b) ÷ 2) is unmeasured; §6.4 measures it.

**2.4 What our settings switch off** (libaom 3.15.1, the release tarball whose SHA-256 `ingest/tools.sh` pins;
verbatim).

* **No lag, no temporal filter.** The filter runs only with lookahead:
  `return oxcf->algo_cfg.arnr_max_frames > 0 && oxcf->gf_cfg.lag_in_frames > 1;` (`av1/encoder/temporal_filter.c:1654`,
  `av1_is_temporal_filter_on`). `--lag-in-frames` is "Max number of frames to lag" (`av1/arg_defs.c:224`).
* **No lag, no temporal dependency model.** `int allow_tpl = oxcf->gf_cfg.lag_in_frames > 1 &&
  oxcf->algo_cfg.enable_tpl_model;` (`encode_strategy.c:877-878`). `--enable-tpl-model` is "RDO based on frame temporal
  dependency (0: off, 1: backward source based); required for --deltaq-mode=1" (`arg_defs.c:330-333`). Its default is
  on (below), so O carries it, and lag 0 makes it inert (*derived*; §8 checks it byte for byte).
* **What the filter does.** Motion search: "given a frame to be filtered and another frame as reference, this function
  searches the reference frame to find out the most similar block … This found block will be further used for
  weighted averaging" (`temporal_filter.c:186-191`). Then "construct predictions from all reference frames INCLUDING
  the frame to be filtered itself … and will be futher used for weighted averaging" (`:532-537`). The weights:
  "Larger q -> stronger filtering -> larger weight. Smaller q -> weaker filtering -> smaller weight." (`:827-828`), and
  "Larger noise -> larger filtering weight." (`:840`). It is a motion-compensated average over neighbouring frames,
  weaker at low Q, stronger on noisier frames: a partial denoiser.
* **What gets filtered, and what is shown.** Only keyframes and ARFs: `if (update_type != KF_UPDATE && update_type !=
  ARF_UPDATE && !is_second_arf) { apply_filtering = 0; }` (`encode_strategy.c:748-750`). The filtered buffer then
  *replaces the source*: `frame_input->source = tf_buf;` (`:802`). For a keyframe, `--enable-keyframe-filtering` is
  "Apply temporal filtering on key frame (0: no filter, 1: filter without overlay (default), 2: filter with overlay -
  experimental, may break random access in players)" (`arg_defs.c:334-340`). So at the default the *shown* keyframe is
  the filtered frame. An ARF is shown directly, with no overlay coding the real frame, when `mean < threshold && std <
  mean * 1.2` with `threshold = 0.7f * ac_q_step * ac_q_step` (`temporal_filter.c:1606-1611`). Internal ARFs are
  unfiltered: "we enforce the filtering strength on internal ARFs except the second ARF to be zero" (`:1623-1624`).
* **Defaults we override.** Without flags, libaom's good-quality configuration has `1, // enable_auto_alt_ref`,
  `1, // enable_tpl_model`, `1, // enable_keyframe_filtering`, `7, // arnr_max_frames`, `5, // arnr_strength`
  (`av1/av1_cx_iface.c:257-271`).
* **Pinned q.** `--min-q = --max-q = Q` holds every coded frame at Q, so libaom cannot spend more on an ARF that many
  frames predict from and less on the frames that use it. That spending is libaom's usual way of making an ARF pay
  (*unverified* for 3.15.1 under `--end-usage=q`; arm AQ, §5, measures it).
* **TPL under pinned q and `--deltaq-mode=0`.** It can still steer the rate-distortion multiplier on ARFs:
  `if (cpi->oxcf.algo_cfg.enable_tpl_model && cpi->oxcf.q_cfg.aq_mode == NO_AQ && cpi->oxcf.q_cfg.deltaq_mode ==
  NO_DELTA_Q && gf_group_index > 0 && cpi->ppi->gf_group.update_type[gf_group_index] == ARF_UPDATE)` →
  `av1_get_rdmult_delta(…)` (`encodeframe.c:519-523`). That is a small lever (*derived*).
* **What the bitstream allows.** "Each temporal unit must have exactly one shown frame" ([A1] §Ordering of OBUs).
  "show_frame equal to 0 specifies that this frame should not be immediately output. (It may be output later if a
  later uncompressed header uses show_existing_frame equal to 1)" ([A1] §Uncompressed header semantics). So a
  stream with hidden frames still gives one unit a shown frame, as the product's groups assume
  (payload-format §Optimal quality, *Groups*). But one unit may now carry several coded frames.

**2.5 The most any inter tool can save while the view keeps the noise** (*derived*). With a clean (filtered)
reference, inter's noise cost equals intra's (§2.2, κ = 1), and only the structure's bytes can shrink. Let s be the
structure's share of O G 1's bytes at the OQ rung, and e be inter's gain on structure alone. The bound is then about
s · e of the bytes. Both are measured here: s from the structure-only source at Q 8 (§5, swap S), e from that source's
own G 16 gain at Q 8. A proxy from §1: real content at Q 16 costs 15–24 % of Q 8's bytes, and G 16 gains 18–60 % at
Q 16–24, so s · e is plausibly 3–15 %. A tool that saves more than s · e at equal fidelity exploits something this
model leaves out. That is P4's refutation.

**2.6 Decode in order.** The decoder's work per shown frame is about the same at every G, intra or inter (*derived*;
measured by the profiles run: in order, G 8 and 16 ÷ G 1, 1.04–1.20 on WebCodecs and 0.38–1.56 on dav1d-WASM at 1×,
`origin/claude/av1-quality-profiles` §Profiles decode, measured (amended)). Hidden frames change the *distribution*:
the unit after an ARF group's keyframe carries the ARF and the internal ARFs. In the earlier alt-ref arm at Q 8 that
unit was 2.2–2.8× an ordinary unit's bytes (202 kB against 91 kB on `dbts_a1`). Cine at a fixed rate is then set by the
slowest frame, not by the median. The quality study's scrolling rate, 15 slices/s (66.7 ms a slice, its §4.7), is the
reference interval here; it is not a bar.

### 3 · Predictions

Each prediction is decided by `collect.py` (§Collector), using the refutation clause exactly as written here.

| # | prediction | refuted if |
| --- | --- | --- |
| **P1** mechanism | At Q 8, O's G 16 gain at equal Q is −2 to +2 % on the real source (as measured) and within 3 points of it on the shuffled-noise source X. It is ≥ 30 % on the structure-only source S and on the shared-noise source C. S costs ≤ 35 % of the real source's bytes at Q 8, G 1. | S's gain < 15 % (the encoder, not the noise, blocks inter); or X differs from real by > 3 points (the slices' own noise correlation matters); or S > 50 % of real's bytes (Q 8's bytes are mostly structure) |
| **P2** bands | At Q 8, κ_0 ≥ 0.8 (the finest band already removed) and some coarser band has κ ≤ 0.5. At Q 16 every band ℓ ≤ 2 has κ ≥ 0.8. ρ_0 lies in 0.05–0.30, and ρ_ℓ rises with ℓ. | any band with κ ≤ 0.5 at Q 8 has ρ ≥ √(1 − κ) ÷ 2 while O's G 16 gain at Q 8 is < 5 %; or ρ_ℓ does not rise with ℓ on any DBT volume |
| **P3** gain follows κ | Across Q 2–24, O's G 16 gain is ≤ 3 % at every rung where some band ℓ ≤ 2 has κ ≤ 0.5 (a kept band), and ≥ 6 % at every rung where none has | a rung with a kept band gains > 6 %, or a rung without one gains < 3 %, on any DBT volume |
| **P4** alt-ref, equal quality | In the VL interval, the BD-rate of A, AT, AD and AQ (G 16, 32) against O G 1 lies in −15 … +5 % on every DBT volume | any arm's BD-rate < −(s · e) − ε on a DBT volume (§2.5, s and e from that volume's swap cells, ε from §7) |
| **P5** keyframe filter | AD's keyframes read e_N/σ ≥ 1.0 at Q 4–8, where A's keyframes read ≤ 0.9 | AD's keyframes ≤ A's + 0.05 at Q 4–8 |
| **P6** TPL | AT within ±3 % of A in bytes and ±0.1 dB in-window PSNR at every rung | outside either |
| **P7** G scaling | O at Q ≤ 8: G 32 within ±1 % of G 16, P/K ≥ 0.95; at Q 24, P/K ≤ 0.6 | outside either |
| **P8** modes, speed | I within ±3 % of O G 1 at equal PSNR; R's G 16 is +0 to +15 % over O's G 16; at cpu-used 3, O3's G 16 gain over O3 G 1 at Q 8 < 3 % and AT3 within ±5 % of AT | outside any |
| **P9** TRUS | AT G 16's BD-rate against O G 16 ≤ −5 % on both sweeps (speckle behaves as shared structure, frame-groups §T2) | > 0 on either |
| **P10** decode in order | At Q 8, O G 16 and G 32 ÷ O G 1 mean per frame: 0.9–1.3 on dav1d-WASM, 1.0–1.25 on WebCodecs. ARF arms: mean per shown frame within 0.9–1.3 of O at the same G, and their slowest frame ≥ 2× their median frame | an ARF arm's slowest ÷ median < 1.5, or any ratio outside its range |

P4 and P10 are the owner's questions; P1–P3 explain the answer; P5–P9 locate it among libaom's settings.

### 4 · Fixtures

As `lab/av1/fetch_data.sh` writes them, checked against their pins (`docs/FIXTURES.md` §AV1 data).

| group | sets | depth · frames | what a result here may claim |
| --- | --- | --- | --- |
| DBT, systems A, C | `dbts_a1` (56 × 1142 × 1785), `dbts_c1` (69 × 976 × 2513) | 12 · all | these two volumes |
| DBT, system B | `dbts_b1`, **its middle 32 slices (9–40)** of 50 × 2560 × 3328 | 10 · 32 | those 32 slices; the cut is for time (§Shards), and G 32 is the whole cut |
| swept ultrasound | `ustrus_1`, `ustrus_2` (TRUS rotational sweeps, 280 × 452²) | 8 · all | the nearest cine-like sound series; never an ABUS or breast-cine verdict |
| **lossy-sourced, apart** | `usb_cine` (breast US cine), `usb_cine_rgb`, `us_liver` (RGB) | 8 · all | nothing: their source was a lossy video whose quantizer removed the noise; reported in no verdict |

**Limits.** No lossless breast ultrasound cine and no ABUS exist among the fixtures (FIXTURES.md §The frame-group data
search), so nothing here speaks for the modality most often shown as cine. One volume per DBT system: the
quality study found A's noise anchor spread over Q 4–8 across five volumes, so a system's verdict from one volume is
named as that volume's. The three are the AV1 work's timed fixtures.

### 5 · Arms

**Configurations.** Every one is `aomenc` 3.15.1 with `lab/av1/profiles/bytes.py`'s `aomenc_args` base (`--ivf --good
--cpu-used=6 --threads=1 --passes=1 --tune=psnr --end-usage=q --cq-level=Q --min-q=Q --max-q=Q --deltaq-mode=0
--aq-mode=0 --denoise-noise-level=0`, its group and colour flags, stored form), and differs only as follows:

| arm | differs from the base by | answers |
| --- | --- | --- |
| **O** (ours) | `--lag-in-frames=0 --auto-alt-ref=0` | the OQ view as built |
| **L** | `--lag-in-frames=39 --auto-alt-ref=0 --enable-tpl-model=0 --enable-keyframe-filtering=0` | lookahead alone |
| **A** | `--lag-in-frames=39 --auto-alt-ref=1 --enable-tpl-model=0 --enable-keyframe-filtering=0` | + filtered alt-ref |
| **AT** | A with `--enable-tpl-model=1` | + temporal dependency model |
| **AD** | AT with `--enable-keyframe-filtering=1` | libaom's own defaults for all four knobs (§2.4) |
| **AQ** | AT without `--min-q=Q --max-q=Q` | libaom's per-frame q around `--cq-level` |
| **I** | `--allintra` in place of `--good`, `--lag-in-frames=0`, G 1 | the intra mode |
| **R** | `--rt` in place of `--good`, `--lag-in-frames=0 --auto-alt-ref=0` | the real-time mode |
| **O3, AT3** | O, AT with `--cpu-used=3` | encoder speed |

Lag 39: libaom raises any lag of 32–38 to 39 in good mode ("if (oxcf->mode == GOOD && gf_cfg->lag_in_frames >= 32 &&
gf_cfg->lag_in_frames < 39) gf_cfg->lag_in_frames = AOMMIN(39, MAX_LAG_BUFFERS);", `av1_cx_iface.c:1446-1448`), so 39
is stated rather than reached silently. It is at least one 32-frame group (`MAX_GF_INTERVAL 32`, `ratectrl.h:45`).

**The ladder.** Q 2, 4, 6, 8, 10, 12, 16, 24: dense where the VL interval lies, and wide enough for BD-rate to have
overlap.

**Per DBT volume** (full measures, §6):

| stream | G | rungs | cells |
| --- | --- | --- | --: |
| O | 1, 8, 16, 32 | all 8 | 32 |
| A | 16 | all 8 | 8 |
| AT | 16, 32 | all 8 | 16 |
| AD, AQ | 16 | all 8 | 16 |
| L, R (G 16); I (G 1) | — | Q 4, 8, 12 | 9 |
| O3 (G 1, 16), AT3 (G 16) | — | Q 8 | 3 |

**The noise swap** (per DBT volume, O only, G 1 and 16, Q 4, 8, 12, bytes and the cheap measures of §6.1). Let S_k be
frame k decoded from O G 1 at Q 32, whose fine-band noise is gone (e_N/σ 1.03–1.08 there, §1). Let r_k = source_k − S_k,
an integer noise proxy that also holds the fine structure Q 32 lost. Then:

* **S** — S_k alone: structure without noise;
* **X** — S_k + r_{(k + ⌊n/2⌋) mod n}: each slice's own noise statistics, none shared with its neighbour;
* **C** — S_k + r_m, m the middle slice, for every k: one noise pattern shared by all slices (ρ = 1);
* real = S_k + r_k = the source, whose cells are O's.

All are clipped to the stream's range, and clipped samples are counted. That is 1 cell (S's Q 32) + 18.

**TRUS sweeps:** O at G 1, 16, 32; AT at G 16, 32; AD at G 16; all 8 rungs (48 cells each). **Lossy-sourced clips:**
O at G 1, 16; AT at G 16; Q 4, 8, 12, 16, 24 (15 cells each).

**Interleaving.** Each series' cells run in a Williams order over (arm, G, Q) (`lab/scripts/order.py`), four in flight
(fewer where §9's memory rule says). Encodes are deterministic (§8), so order touches only times, which are reported
and never compared across arms. The decode timing is interleaved and paired by round (§6.5).

### 6 · What is measured

**6.1 Quality, per frame,** with the quality study's own code, unchanged: `lab/av1/metrics/cell.py`'s `measure()` and
`series_row()` and `quality.py`. That gives PSNR over the frame and in-window (from `mse_in`), max |Δ|, SSIM, MS-SSIM,
e_N and σ, displayed-level moves under every header window, and error ÷ step. JOD comes from ColorVideoVDP 0.5.7 on the
stored form's middle 8 frames, as `vdp.py` sets it up (grey series only). Swap cells take PSNR, in-window PSNR and e_N
against their own source, with σ from the real source; they get no MS-SSIM and no JOD. Every cell reports the median
frame, the 5th and 1st percentiles (95th and 99th for errors), and the worst frame, as `collect.py` there does.

**6.2 Bytes, per unit.** Each IVF unit's size, the keyframes' positions, and P/K. For `dbts_b1` the HTJ2K reference is
the sum of slices 9–40 in the quality study's control row (`shard-4.jsonl`, `kind: control`), so it is not coded again.

**6.3 Frame headers, per unit** (new, `lab/av1/groups/headers.py`). Every OBU_FRAME_HEADER and OBU_FRAME is parsed as
far as `show_existing_frame`, `frame_type` and `show_frame`, per [A1] §Uncompressed header syntax (`uncompressed_header`: "show_existing_frame
f(1); if ( show_existing_frame == 1 ) { frame_to_show_map_idx f(3) …} … frame_type f(2) … show_frame f(1)"), with
`reduced_still_picture_header` taken from the sequence header. The parse reports per stream: coded frames, hidden frames,
units with `show_existing_frame`, coded frames per unit (max and mean), and **shown frames that were not coded from
their source**: AD's keyframes (filtered by its flag, §2.4), and every `show_existing_frame` unit, reported as "shown
from a hidden frame". Whether that hidden frame was a filtered ARF or an unfiltered internal one cannot be read from the
bitstream, so the quality measures, not the count, carry the verdict.

**6.4 Bands** (new, `lab/av1/groups/bands.py`). A Laplacian pyramid of four levels: G_0 is the frame, G_{ℓ+1} is G_ℓ
reduced by the 2 × 2 mean that `quality.py`'s MS-SSIM uses, and B_ℓ = G_ℓ − G_{ℓ+1} expanded by pixel repetition. A
sample is in-window at level ℓ when all of its 2^ℓ × 2^ℓ source samples are.

* **ρ_ℓ**, per series, before any encode: per 64 × 64 block of B_ℓ(r_k) inside the window, the Pearson correlation
  with B_ℓ(r_{k+1}) at the best integer offset within ±8 samples of that level. Also at offset 0. Reported as the
  median and 90th percentile over blocks and frame pairs.
* **κ_ℓ**, per cell: Σ in-window B_ℓ(decoded − source)² ÷ Σ in-window B_ℓ(r)², the median over frames. It is 0 where
  the band is reproduced and about 1 where its noise is gone. Computed on every O cell, on AT G 16, and on the swap
  cells.

**6.5 Decode in order, per frame** (new driver `lab/av1/groups/decode.mjs` and worker `decode.js`). They use the
profiles run's decoders unchanged (`lab/av1/profiles/decoders.js`, `shared.js`, checked out from
`origin/claude/av1-quality-profiles`) in headless Chromium through Playwright 1.56.1 (`decode_setup.sh` there). The
settings are the profiles run's: WebCodecs `{ codec, hardwareAcceleration: "prefer-software", optimizeForLatency: true
}`, and dav1d-WASM one thread with `max_frame_delay` 1. One unit in flight, each fed after the one before has been
written.

* **Streams timed**, per series: O G 1, O G 16, O G 32, AT G 16, AT G 32 and AD G 16 at Q 8. Each of these is also
  timed at its **matched rung**: the highest Q whose median in-window PSNR is at least O G 1 Q 8's, where that differs
  from Q 8. On TRUS, Q 4 replaces Q 8 (its noise anchor, quality study §For the owner). O G 1 Q 8 is timed twice as
  two units (O and O′), the block's A/A.
* **Decoders:** dav1d-WASM on every stream, since the product decodes 12-bit there. WebCodecs only on 8- and 10-bit
  streams (`dbts_b1`, TRUS, the clips): Chromium's WebCodecs refuses 12-bit AV1 (row WCAP, profiles §7), so **A and C
  get no WebCodecs claim**.
* **A unit:** a fresh decoder opened off the clock, then the stream's first 32 units in order (all 32 on `dbts_b1`).
  For each unit the clock runs from handed in to its shown frame written, back-conversion included. Every decoded frame
  is hashed against native dav1d 1.5.4's decode of the same stream; a miss voids the round.
* **Its figures:** mean per shown frame (the sustained in-order rate), median, 95th percentile, the slowest frame, and
  the slowest frame's position in its group.
* **Rounds:** one fresh Chromium per round. In it the series run in a Williams row, and within a series every unit runs
  in that round's Williams row (`lab/order.mjs`). Each round's rows are written as it ends, and the run resumes at the
  first round missing. At least 10 rounds, as many as fit (§Shards), at 1× only.
* **Statistic:** per (series, stream, decoder), paired by round against O G 1 at Q 8 (TRUS: Q 4), ln(stream ÷ O G 1)
  for the mean and for the 95th percentile. The median over rounds is reported with its distribution-free 95 %
  interval (order statistics from the binomial(n, ½) tails, as profiles §7). Milliseconds never leave their series.
  **A/A:** ln(O′ ÷ O) the same way. A series whose A/A interval lies wholly beyond ±ln 1.05 measures position, not
  decoders, and its cells are void and reported. One host a series: no between-host spread is claimed.

### 7 · Decision rule

**BD-rate**, per series and arm against O G 1 (and, for P9, against O G 16). Each curve is ln bytes against
median in-window PSNR through the arm's rungs, as a monotone piecewise-cubic (PCHIP) interpolant. The BD-rate is
exp(mean over the overlap of the two curves inside the VL interval of ln bytes_arm − ln bytes_ref) − 1, integrated on
a 0.01 dB grid. This is the Bjøntegaard delta's idea [B1] computed this way, stated so here (the original fits a cubic
polynomial; that text was not read here: *unverified*). With overlap under 70 % of the VL interval, the result is "not
comparable". The same computation on median full-frame PSNR and on JOD is reported beside it, and decides nothing.

**ε, the method's own resolution, from the data.** For O G 1 and O G 16 on each DBT volume, drop each rung inside the
VL interval in turn and compute the BD-rate of the thinned curve against the full one. ε is the largest |value| over
both arms and all three volumes. A gain smaller than ε is not distinguished from interpolation.

**The OQ point** of an arm: its highest rung with e_N/σ ≤ 1 on every frame (the quality study's anchor (a)), and the
bytes there. **Quality guard** at that point, against O G 1's own point on the same series: JOD no lower by more than
O G 1's JOD step from its point to the next rung up, and the first window's worst-frame share moved by ≥ 2 levels no
higher by more than O G 1's step over that same rung. Both margins are one rung of the reference's own curve, so they are read from
the data.

**Verdict per arm, on the DBT volumes:**

1. **Saves bytes at equal quality** if its BD-rate against O G 1 is < −ε on all three volumes and the quality guard
   holds on all three.
2. **Recommended over O G 1** if (1) holds and, at its matched rung, the in-order ratios (mean and 95th percentile per
   frame) have 95 % upper bounds ≤ 1 + a. Here a is the half-width of that series' A/A interval, read from the data.
   The test uses dav1d-WASM on A and C, and both decoders on B.
3. **A trade, for the owner,** if (1) holds and (2) does not. The report gives the bytes saved, the ms added per frame
   on each decoder, and the slowest frame against 66.7 ms. The rule does not decide it.
4. Among recommended arms, the largest saving wins. Arms within ε of each other go to the simplest, in the order O <
   L < A < AT < AD < AQ, then the smaller G. **If none is recommended, G 1 stays** for DBT on these fixtures, and
   P1–P3 say why.

The rule decides nothing for TRUS or the lossy-sourced clips: their verdicts are computed the same way and reported
apart. An arm with any shown frame that was not coded from its source (§6.3) is named as such beside its verdict.
A product consequence follows if an arm with hidden frames is recommended: the OQ ingest's argument set and its check
(payload-format §Optimal quality) would change, which is a structural change proposed to the owner, not made here.

### 8 · Checks, and their mutations

Each check runs once on the pilot series of §9, unless stated, and is mutated. Results go to `rows/groups-K.checks.json`.

| check | expected | mutation, and what must change |
| --- | --- | --- |
| O reproduces the quality study | O cells at G 1, 8, 16 and Q 2, 4, 8, 12, 16, 24 on `dbts_a1` and `dbts_c1`: unit sizes identical to `lab/av1/metrics/rows/shard-*.jsonl`; on `dbts_b1` O G 1: each slice's unit identical to that row's `units[9:41]` (run in the shards) | `--cpu-used=5`: sizes differ; slices 10–41: differ |
| the earlier alt-ref arm reproduces | `bytes.py --altref` flags, `dbts_a1` Q 8 G 16: units identical to `lab/av1/profiles/results/altref.jsonl`'s on `origin/claude/av1-quality-profiles` (run in shard 2) | `--lag-in-frames=18`: differ |
| TPL needs lag (§2.4, quoted source) | O with `--enable-tpl-model=0` is byte-identical to O (whose default is 1) | both with `--lag-in-frames=39 --auto-alt-ref=0 --enable-keyframe-filtering=0`: the pair differs |
| the filter needs lag | O with `--enable-keyframe-filtering=0 --arnr-maxframes=0` byte-identical to O | both with lag 39: the pair differs |
| arms are distinct | L ≠ A ≠ AT ≠ AD at Q 8 G 16 (any byte) | — (an identical pair is reported: its knob did nothing here) |
| q pinned | every coded frame of O, L, A, AT, AD at Q in `--q-hist=64`; AQ's histogram reported | the histogram parser fed an unpinned AQ stream: entries off Q seen |
| headers | O G 16: n shown, 0 hidden, keyframes at multiples of 16; the earlier alt-ref arm's 5-byte units all `show_existing_frame` 1 | `show_frame` read one bit late: counts change |
| swap identity | S + r = source exactly (max \|Δ\| 0); X with the offset ⌊n/2⌋ replaced by 0 is byte-identical to O at Q 8 G 16 | offset 1: differs |
| bands | ρ_ℓ of two independent white-noise frames \|ρ\| < 0.02; identical frames 1.00; one shifted 3 px reads 1.00 at its offset; κ of an exact frame 0 | offset search removed: the shifted pair reads < 0.3 |
| BD-rate | curves with ln bytes offset by ln 0.9 read −10.0 % (±0.1); identical curves 0 | the PSNR axis reversed: the sign flips |
| determinism | one AT cell coded twice is byte-identical | `--cpu-used=5` differs |
| decode | every frame on the clock equal to native dav1d's (hash); A/A within ±5 % on the pilot | one frame's hash altered: the round voids |

### 9 · Pilot, and sizing

Before shard 1's first series, its session runs a **pilot on `dbt12_ea1141`** (29 × 614 × 1359, 12-bit, 24.2 Mpx,
the quality study's own pilot series). Every arm runs at Q 8 (G 16, or G 1 for I), along with §8's checks.
Its rows go to `rows/groups-pilot.jsonl` and **are not a result**. From them, `plan.py` re-estimates each shard from
measured CPU s a megapixel per arm, and peak resident memory per arm (each child's `ru_maxrss`). If four in flight would
pass 12 GB on a series (likely for ARF arms on `dbts_b1`: 39 frames of lookahead at 8.5 Mpx), that series' ARF cells
run with fewer in flight, and the estimate says so. The pilot also times one decode round of shard 1's units (§6.5) on
its first rows, and from it projects whether 10 rounds fit.

**Costs used below,** CPU s a megapixel of the series per cell. From the quality study's rows for these three volumes
at Q 2–24: O at G 1, 1.0–1.2 (encode, dav1d, measures, JOD); O at G > 1, 0.7–0.85. From the bytes run's alt-ref arm,
encode 1.7× O's at G 16, so A ≈ 1.05. TPL is assumed +20 % encode (AT, AD, AQ ≈ 1.15; **unmeasured**, the pilot's to
fix). cpu-used 3 is assumed 3× encode (≈ 2.7–3.0; **unmeasured**). Swap cells ≈ 0.55. Bands add ≈ 0.1 to the cells that
take them. Summed over §5, that is **≈ 107 CPU s a megapixel per DBT volume**, 49 per TRUS sweep and 15 per clip.

**If a shard would not fit** 4.5 h after the pilot or after its first series, cells are cut in this order, each cut
listed in its section and never dropped quietly: O3 and AT3; then L, R and I; then Q 2 on the ARF arms; then AQ;
then, on `dbts_b1` only, the decode unit shortened to its first 16 units (G 32 then half a group, said so). P8 and P6 then report "not run" where their cells are gone.

## Shards

Two, each one session on its own 4-core, 15 GB cloud host, each **≤ 4.5 h of wall clock**. Each runs its series'
cells (encode phase, four in flight), then the decode timing with nothing else running. The estimates use §9's costs;
encode wall clock is CPU ÷ 4. *Before encoding* is shard 1 writing and checking `lab/av1/groups/` (about 1 h,
*estimated*), with tools, fetch and decoders building beside it. Shard 2 does the same setup and then waits for that
code.

| shard | series | cells | CPU s (est.) | before encoding h | encode h | decode h | total h (est.) |
| --- | --- | --: | --: | --: | --: | --: | --: |
| 1 | pilot `dbt12_ea1141`; `dbts_b1` (slices 9–40); `usb_cine`, `usb_cine_rgb`, `us_liver` | 15 + 103 + 45 | 1 000 + 29 000 + 2 050 = 32 050 | 1.15 | 2.25 | ≤ 1.0 | ≤ 4.4 |
| 2 | `dbts_a1`, `dbts_c1`, `ustrus_1`, `ustrus_2`; the alt-ref reproduction | 103 + 103 + 48 + 48 + 1 | 12 200 + 18 100 + 2 800 + 2 800 + 100 = 36 000 | 1.15 | 2.5 | ≤ 0.6 | ≤ 4.25 |

Setup is the tools (`lab/av1/tools/tools.sh aom`: libaom 3.15.1, dav1d 1.5.4), the fetch, and the decoders and browser
(`decode_setup.sh`, about 20 min by its own header). Decode rounds run until 4.4 h of the session has passed. At least
10 rounds must fit; with fewer, that shard's decode cells are void and reported as such. The decode estimate is not
sized from a pilot of this file: the pilot (§9) times one round of shard 1's units and re-projects it.

### Running one

A shard session reads this file, changes nothing above §Shards, and works on `claude/av1-groups`:

```bash
git fetch origin && git checkout claude/av1-groups && git pull --rebase
git checkout origin/claude/av1-quality-profiles -- lab/av1/profiles/decoders.js lab/av1/profiles/decode_setup.sh \
    lab/av1/profiles/shared.js           # the profiles run's decoders, unchanged
pip install meson && BUILD=$PWD/lab/.av1-build lab/av1/tools/tools.sh aom
lab/av1/fetch_data.sh <the shard's sets>
lab/av1/.venv/bin/pip install --require-hashes -r lab/av1/profiles/requirements.txt
python3.11 -m venv lab/av1/metrics/.venv && lab/av1/metrics/.venv/bin/pip install --require-hashes \
    -r lab/av1/metrics/requirements-vdp.txt
lab/av1/groups/shard.sh K                # K = 1 or 2: checks (shard 1: pilot first), cells, bands, then decode
```

* **Code it writes first** (shard 1's session; shard 2 pulls it): `lab/av1/groups/` with `arms.py` (§5's flags as one
  table, building on `aomenc_args`), `cell.py` (one cell, reusing the metrics `measure()`), `swap.py`, `bands.py`,
  `headers.py`, `decode.mjs` / `decode.js`, `plan.py`, `collect.py`, `shard.sh`. Each one has §8's checks with
  their mutations, and each passes `scripts/comment_budget.sh`. Shard 2 starts its cells only once shard 1 has pushed
  that code and its pilot checks. Until then it builds tools and fetches.
* **What it writes:** `rows/groups-K.checks.json`, then `rows/groups-K.jsonl` (one `series` row with σ, step and ρ_ℓ
  per set; one `cell` row per cell with its units, headers, q-hist, per-frame measures and κ_ℓ), then
  `rows/groups-K.decode.json`. The IVFs of §6.5's timed streams are kept in the work directory until the decode ends.
* **Resuming:** every row already written is skipped. A cell in flight when the session stopped is coded again whole.
* **Push** after the checks, then about hourly (`git pull --rebase` first). Only its rows and its section are its own.
* **Its section:** at the end of this file, `### Groups shard K, measured (date)`, with the five plain lines; the host
  (cores, memory, wall ÷ CPU, peak resident memory per arm); the checks table; `collect.py --partial`'s tables for its
  series; and anything cut or void.

## Collector

Once both shards have pushed, one session (shard 2's, if it has time) runs `lab/av1/groups/collect.py
rows/groups-{1,2}.jsonl --decode rows/groups-{1,2}.decode.json`. It refuses a missing cell against `plan.json`, and
`--partial` says what is missing. It writes **`## Groups protocol, measured (YYYY-MM-DD)`** at the end of this file, with
the five plain lines and then:

1. **Per series:** every cell (bytes ÷ HTJ2K, P/K, in-window and full PSNR median and worst, e_N/σ median and worst,
   JOD, the ≥ 1- and ≥ 2-level shares, κ_ℓ, header counts); ρ_ℓ; the curves as SVG, ln bytes against in-window
   PSNR, one per series, every arm.
2. **BD-rates** of every arm against O G 1 and O G 16 in the VL interval, with ε; the OQ points and the quality guard.
3. **The swap:** S, X, C against real, per DBT volume; s and e, and the bound s · e.
4. **Decode in order:** per stream and decoder, the mean, p95 and slowest ms per frame, and the ratios to O G 1 with
   their intervals and the A/A.
5. **P1–P10**, each held or refuted, with its deciding numbers; then **§7's verdict** per arm, recommended, a trade
   (with its numbers), or neither. TRUS and the clips come in their own tables.
6. **What would change it:** a breast ultrasound cine or ABUS fixture, more DBT systems, a reader study, another host.

## Sources

Read 2026-11-09.

* [A1] AV1 Bitstream & Decoding Process Specification, `github.com/AOMediaCodec/av1-spec` @ `5e04f3f75e73`:
  `06.bitstream.syntax.md` (uncompressed_header), `07.bitstream.semantics.md` (show_existing_frame, show_frame,
  showable_frame), `08.decoding.process.md:369` ("Each temporal unit must have exactly one shown frame"),
  `02.terms.md:330-334` (temporal unit).
* [L1] libaom v3.15.1 release tarball, `storage.googleapis.com/aom-releases/libaom-3.15.1.tar.gz`, SHA-256
  `8ca0c527…d01bf` (the pin in `ingest/tools.sh`): `av1/arg_defs.c`, `av1/av1_cx_iface.c`,
  `av1/encoder/temporal_filter.c`, `encode_strategy.c`, `encodeframe.c`, `ratectrl.h`, `common/quant_common.c` (the AC
  tables), at the lines given in §2.4 and §5.
* [B1] G. Bjøntegaard, *Calculation of average PSNR differences between RD-curves*, ITU-T SG16 Q.6 VCEG-M33, 2001 —
  cited for the idea only; not read here (*unverified*).
* In this repository: `lab/av1/metrics/README.md` and `rows/` (the quality study); `lab/av1/profiles/README.md` and
  `results/` on `origin/claude/av1-quality-profiles` (the bytes and decode runs, the alt-ref arm);
  `docs/av1/frame-groups.md` (§T2, §T3 and its [S6]–[S9]); `docs/av1/noise-point.md` on `origin/claude/av1-noise-point`;
  `docs/av1/payload-format.md` on `origin/claude/oq-ingest`.
