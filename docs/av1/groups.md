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

### Groups shard 1, measured (2026-11-10)

*Run 2026-11-10 00:45–05:10 UTC on one 4-core cloud host, from §Shards exactly, nothing above §Shards changed. Code:
`lab/av1/groups/` (commits from `05186de5`); rows: `lab/av1/groups/rows/groups-pilot.jsonl` (not a result),
`groups-1.checks.json`, `groups-1.jsonl`, `groups-1.decode.json`; curves `rows/curves/*.svg`.*

1. **Asked:** shard 1 of the protocol — the pilot and §8's checks, every cell of `dbts_b1` (slices 9–40), the three
   lossy-sourced clips, and the in-order decode timing of their streams.
2. **Answer, for `dbts_b1`'s 32 slices only:** at equal in-window PSNR inside the VL interval (43.72–54.65 dB), the
   filtered alt-ref arms cost **4.9–6.3 % fewer bytes than O G 1** (A −6.1, AT G 16 −4.9, AT G 32 −6.3, AD −5.3,
   AQ −5.7 %) and O G 16 / G 32 cost **2.5 % fewer**, against a method resolution ε of 0.76 %. At equal Q, as the
   quality study found, G 16 saves 0.9 % at Q 8. The noise swap places the cause in the slices' own noise: one shared
   noise pattern (C) lets G 16 save 75 % at Q 8, a shuffled one (X) changes nothing (−1.0 % against real's +0.9 %).
   Decoding in order costs the alt-ref arms a slowest frame of about 0.52–0.63 s on dav1d-WASM at Q 8, 3.4–5.2× their median.
3. **The numbers that decide it** are below: every cell, the BD-rates, the swap, the decode, and P1–P8 and P10 as their
   clauses read them. P1–P4, P6 and P8 are refuted on this volume, P10 is held on dav1d-WASM and refuted on WebCodecs (the arms' mean ÷ O at the same G is 0.89–0.90, under 0.9), P7 held, P5 neither held nor refuted.
4. **It rests on** `dbts_b1` slices 9–40 alone (system B, 10-bit, one volume), libaom 3.15.1 at cpu-used 6 (3 for
   O3/AT3), native dav1d 1.5.4 for every measure, dav1d-WASM and WebCodecs in headless Chromium for the timing, and the
   quality study's measures unchanged.
5. **Left open:** shard 2 (`dbts_a1`, `dbts_c1`, both TRUS sweeps, the alt-ref reproduction) did not run in this
   session, so §7's verdict, which needs all three DBT volumes, is not reached and P9 is not run. Systems A and C are
   unmeasured here.

**Host.** 4 vCPU (Intel Xeon @ 2.10 GHz, one thread a core), 15.7 GB, no swap. Encode phase 01:10–03:22 UTC, 2.2 h of
wall clock for 23 675 CPU s of cells (encode, dav1d, measures, ColorVideoVDP), so 3.0 of 4 cores busy on average. The
host saturates on **memory** for `dbts_b1`'s lookahead cells, not CPU: an `aomenc` at lag 39 on 8.5 Mpx frames holds
about 3.0 GB (`ps`, during the run), so the scheduler (`cell.py`, a 13.5 GB budget learnt from each series' finished
cells) ran them 3–4 in flight. Nothing past one host at 1× is claimed. Peak resident memory per arm as `wait4` reports
it is **not** usable: it includes the forking Python worker's own resident set (up to 3.64 GB for O G 1 here), so only
the `ps` figure above is quoted. Decode phase 03:23–05:10 UTC with nothing else running.

**Deviations, each listed.**
* The pilot and its checks ran with the system's libdav1d 1.4.1: the built `dav1d` loads it unless `LD_LIBRARY_PATH`
  names the built one (the quality study's §Host note). The shard's cells were started again at 01:10 with the pinned
  1.5.4 and every earlier cell row was discarded; `shard.sh` now sets the path. The pilot is not a result.
* The encode phase was restarted three times in its first 8 minutes (the scheduler twice, the library once); cells in
  flight were coded again whole, as §Shards allows.
* The noise proxy's own cell (O G 1 at Q 32, real source) runs on every series, not only DBT, because κ_ℓ needs r_k on
  every O cell: one extra cell on each clip. κ is not computed on that cell itself, and on S (which carries no noise);
  on X and C it is against the noise each carries. On RGB clips κ and ρ are on the first channel (R) only.
* O3 and AT3, §9's first cut, ran last and were not cut. Nothing else was cut. The pilot projected 2.7 h of encode.

**Checks** (`rows/groups-1.checks.json`; pilot `dbt12_ea1141` unless named):

| check | expected | got | mutation |
| --- | --- | --- | --- |
| O reproduces the quality study | pilot O G 1 and G 16 at Q 8 identical | identical (1 399 993, 1 394 903 B) | `--cpu-used=5` differs ✓ |
| … on the cut series | `dbts_b1` O G 1 = units[9:41] at every shared rung | identical at Q 2, 4, 8, 12, 16, 24, 32 | one slice later differs ✓ |
| TPL needs lag | O with `--enable-tpl-model=0` = O | identical | at lag 39 the pair differs (1 055 063 vs 1 114 747 B) ✓ |
| the filter needs lag | O with keyframe filter 0, arnr 0 = O | identical | at lag 39 the pair differs ✓ |
| arms distinct | L ≠ A ≠ AT ≠ AD at Q 8 G 16 | all distinct | — |
| q pinned | every coded frame of O, L, A, AT, AD at Q | **misses as written**: O `{8: 30}`; L, A, AT, AD `{0: 29, 8: 30}` | AQ shows `{7: 1}` off Q ✓ |
| headers | O G 16: 29 shown, 0 hidden, keys 0, 16; alt-ref ≤ 16-byte units all `show_existing_frame` | as expected; 11 small units, all shown-existing | `show_frame` a bit late: hidden 12 → 19 ✓ |
| swap identity | X at offset 0 = source, its stream = O | max \|Δ\| 0, identical | offset 1 differs ✓ |
| determinism | AT twice identical | identical | `--cpu-used=5` differs ✓ |
| bands, white noise | \|ρ\| < 0.02 | −0.007 to −0.001 at offset 0; **0.044–0.048 at the best offset** | — |
| bands, identical | 1.00 | 1.00 | — |
| bands, shifted 3 px | 1.00 at its offset | **misses: 0.833 · 0.424 · 0.58 at ℓ 0 · 1 · 2** | search removed: 0.000 at ℓ 0 ✓ |
| κ of an exact frame | 0 | 0 | — |
| BD-rate | −10.0 % (±0.1) for ln 0.9; identical 0 | −10.0 %, 0 | axes swapped: sign flips ✓ |
| decode | every frame = native dav1d (hash) | every frame of every kept round | one hash altered: the unit misses ✓ |

Two misses, both read rather than changed. **q-hist**: in the lag arms `aomenc --q-hist` books one entry at 0 for each
input frame held in lookahead (29 = n); every coded frame is at Q, since a frame at Q 0 would be near-lossless and no
unit is that large. **Shifted bands**: §6.4's pyramid (2 × 2 mean, pixel repetition) is not shift-invariant — a shift by
an odd number of samples at level ℓ changes the decimation's phase, so the check reads 1.00 only for shifts that are
multiples of 2^(ℓ+1) (2 px: 1.00 · 0.83 · 0.41; 4 px: 1.00 · 1.00 · 0.84; 8 px: 1.00 at ℓ ≤ 2). DBT slices share their geometry, and on
`dbts_b1` the best offset and offset 0 agree to 0.002, so ρ_ℓ here is not bent by it; a moving series would be. The best
offset's maximum over 289 offsets also lifts independent noise to 0.048, the estimator's floor at 64 × 64 blocks.

**Two readings the clauses do not make for themselves.** (a) **S is not structure alone.** S_k is a Q 32 intra decode,
so it carries each slice's own Q 32 coding error, which neighbours do not share: on S, G 16 costs **25.5 % more** than
G 1 at Q 8 (P/K 1.26). So e < 0 and s · e = −2.6 %, and P4's refutation bound −(s · e) − ε = +1.9 % is crossed by any
arm that saves bytes at all. P4 is refuted as its clause reads; the arms' BD-rates (−4.9 to −6.3 %) do lie inside its
predicted −15 … +5 %. P1 is refuted by S's gain (< 15 %) for the same reason, not by X, which met its clause. (b) **The
OQ point punishes the arms on a ladder this coarse.** O G 1's OQ point is Q 12 (e_N/σ 0.999, 7.05 MB); every alt-ref
arm crosses e_N/σ = 1 between Q 8 and Q 10, so its OQ point is Q 8 at 9.4–10.5 MB, *more* bytes than O G 1's, though at
higher PSNR. At equal PSNR the arms save bytes; at the noise anchor's rung they do not. Both are true of these cells.

**`collect.py --partial`, shard 1's series** (missing: shard 2's series, owed). Columns: bytes of the whole cut; ÷ HTJ2K is the quality study's lossless control over the same frames; P/K the median predicted unit ÷ its keyframe's; PSNR in-window and full, median frame and worst; e_N/σ median and worst frame; keyframes' e_N/σ; JOD (grey series, stored form, middle 8 frames); shares of first-window samples moved ≥ 1 and ≥ 2 displayed levels, worst frame; κ_ℓ medians over frames; hidden coded frames and units showing an existing frame. Curves: `lab/av1/groups/rows/curves/`.

*151 cells, 0 failed rows, 304 planned cells missing.*

Missing, by series: `dbts_a1` 103, `dbts_c1` 103, `ustrus_1` 49, `ustrus_2` 49.


#### `dbts_b1` (32 frames from 9, 2560 × 3328 × 1, 10-bit; HTJ2K reference 69351403 B)

| arm | G | Q | source | bytes | ÷ HTJ2K | P/K | PSNR in, med · worst | PSNR, med · worst | e_N/σ, med · max | keyframes e_N/σ | JOD | ≥ 1 · ≥ 2 levels, worst frame | κ_0 · κ_1 · κ_2 · κ_3 | hidden · shown existing |
| --- | --: | --: | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- | --: |
| A | 16 | 2 | real | 41436192 | 0.597 | 0.88 | 60.06 · 59.82 | 64.64 · 64.43 | 0.190 · 0.200 | 0.183 | 10.00 | 0.377 · 0.0065 | — | 12 · 9 |
| A | 16 | 4 | real | 27810819 | 0.401 | 0.81 | 53.83 · 53.40 | 58.42 · 58.01 | 0.405 · 0.444 | 0.359 | 9.99 | 0.654 · 0.1777 | — | 12 · 9 |
| A | 16 | 6 | real | 17887482 | 0.258 | 0.68 | 49.04 · 48.02 | 53.59 · 52.63 | 0.690 · 0.764 | 0.583 | 9.98 | 0.804 · 0.4569 | — | 12 · 9 |
| A | 16 | 8 | real | 10511283 | 0.152 | 0.50 | 45.67 · 44.93 | 50.25 · 49.47 | 0.921 · 0.968 | 0.797 | 9.94 | 0.863 · 0.6044 | — | 12 · 9 |
| A | 16 | 10 | real | 6023052 | 0.087 | 0.32 | 43.64 · 43.19 | 48.22 · 47.83 | 1.007 · 1.019 | 0.934 | 9.89 | 0.887 · 0.6704 | — | 12 · 9 |
| A | 16 | 12 | real | 3662430 | 0.053 | 0.22 | 42.49 · 42.09 | 47.10 · 46.71 | 1.027 · 1.034 | 0.995 | 9.80 | 0.900 · 0.7058 | — | 12 · 9 |
| A | 16 | 16 | real | 1610304 | 0.023 | 0.10 | 41.22 · 40.88 | 45.78 · 45.49 | 1.034 · 1.039 | 1.030 | 9.55 | 0.912 · 0.7395 | — | 12 · 9 |
| A | 16 | 24 | real | 564998 | 0.008 | 0.03 | 39.94 · 39.51 | 44.51 · 44.05 | 1.040 · 1.044 | 1.036 | 8.63 | 0.924 · 0.7735 | — | 12 · 9 |
| AD | 16 | 2 | real | 41260895 | 0.595 | 0.88 | 59.96 · 59.81 | 64.54 · 64.36 | 0.192 · 0.202 | 0.184 | 10.00 | 0.377 · 0.0066 | — | 12 · 9 |
| AD | 16 | 4 | real | 27481741 | 0.396 | 0.80 | 53.58 · 53.37 | 58.19 · 57.90 | 0.418 · 0.450 | 0.362 | 9.99 | 0.655 · 0.1795 | — | 12 · 9 |
| AD | 16 | 6 | real | 17151804 | 0.247 | 0.72 | 48.68 · 47.71 | 53.28 · 52.32 | 0.722 · 0.780 | 0.672 | 9.97 | 0.810 · 0.4719 | — | 12 · 9 |
| AD | 16 | 8 | real | 9445768 | 0.136 | 0.63 | 45.11 · 44.25 | 49.74 · 48.88 | 0.946 · 0.981 | 0.940 | 9.93 | 0.873 · 0.6323 | — | 12 · 9 |
| AD | 16 | 10 | real | 5149292 | 0.074 | 0.46 | 43.21 · 41.95 | 47.82 · 46.58 | 1.017 · 1.025 | 1.019 | 9.85 | 0.903 · 0.7141 | — | 12 · 9 |
| AD | 16 | 12 | real | 3073035 | 0.044 | 0.40 | 42.15 · 40.13 | 46.74 · 44.68 | 1.030 · 1.038 | 1.033 | 9.70 | 0.920 · 0.7646 | — | 12 · 9 |
| AD | 16 | 16 | real | 1430637 | 0.021 | 0.17 | 41.06 · 38.92 | 45.66 · 43.45 | 1.034 · 1.039 | 1.035 | 9.39 | 0.931 · 0.7937 | — | 12 · 9 |
| AD | 16 | 24 | real | 522475 | 0.008 | 0.05 | 39.88 · 37.99 | 44.44 · 42.50 | 1.040 · 1.045 | 1.038 | 8.44 | 0.937 · 0.8123 | — | 12 · 9 |
| AQ | 16 | 2 | real | 42568757 | 0.614 | 0.84 | 60.89 · 59.82 | 65.42 · 64.35 | 0.177 · 0.202 | 0.163 | 10.00 | 0.377 · 0.0065 | — | 12 · 9 |
| AQ | 16 | 4 | real | 28293697 | 0.408 | 0.77 | 54.15 · 53.35 | 58.71 · 57.90 | 0.397 · 0.448 | 0.332 | 9.99 | 0.655 · 0.1801 | — | 12 · 9 |
| AQ | 16 | 6 | real | 17957580 | 0.259 | 0.63 | 49.04 · 48.10 | 53.61 · 52.70 | 0.705 · 0.768 | 0.554 | 9.98 | 0.801 · 0.4514 | — | 12 · 9 |
| AQ | 16 | 8 | real | 10215899 | 0.147 | 0.40 | 45.49 · 44.42 | 50.08 · 49.03 | 0.940 · 0.977 | 0.750 | 9.94 | 0.870 · 0.6249 | — | 12 · 9 |
| AQ | 16 | 10 | real | 5749232 | 0.083 | 0.22 | 43.39 · 42.79 | 47.98 · 47.33 | 1.015 · 1.026 | 0.885 | 9.88 | 0.891 · 0.6827 | — | 12 · 9 |
| AQ | 16 | 12 | real | 3583083 | 0.052 | 0.11 | 42.29 · 41.92 | 46.87 · 46.46 | 1.029 · 1.038 | 0.939 | 9.79 | 0.901 · 0.7089 | — | 12 · 9 |
| AQ | 16 | 16 | real | 1803714 | 0.026 | 0.04 | 41.23 · 40.91 | 45.80 · 45.55 | 1.034 · 1.041 | 0.990 | 9.57 | 0.911 · 0.7391 | — | 12 · 9 |
| AQ | 16 | 24 | real | 821088 | 0.012 | 0.01 | 40.18 · 39.57 | 44.73 · 44.20 | 1.039 · 1.045 | 1.025 | 8.92 | 0.923 · 0.7729 | — | 12 · 9 |
| AT | 16 | 2 | real | 41258584 | 0.595 | 0.88 | 59.96 · 59.83 | 64.54 · 64.39 | 0.192 · 0.202 | 0.183 | 10.00 | 0.377 · 0.0065 | 0.01 · 0.01 · 0.00 · 0.00 | 12 · 9 |
| AT | 16 | 4 | real | 27480344 | 0.396 | 0.80 | 53.58 · 53.37 | 58.20 · 57.89 | 0.417 · 0.449 | 0.359 | 9.99 | 0.655 · 0.1794 | 0.06 · 0.02 · 0.01 · 0.01 | 12 · 9 |
| AT | 16 | 6 | real | 17323108 | 0.250 | 0.65 | 48.69 · 47.72 | 53.29 · 52.33 | 0.720 · 0.781 | 0.583 | 9.98 | 0.810 · 0.4718 | 0.20 · 0.07 · 0.03 · 0.02 | 12 · 9 |
| AT | 16 | 8 | real | 9792023 | 0.141 | 0.43 | 45.26 · 44.37 | 49.86 · 48.91 | 0.946 · 0.982 | 0.797 | 9.94 | 0.871 · 0.6262 | 0.43 · 0.16 · 0.06 · 0.04 | 12 · 9 |
| AT | 16 | 10 | real | 5484575 | 0.079 | 0.25 | 43.26 · 42.87 | 47.88 · 47.41 | 1.017 · 1.026 | 0.934 | 9.87 | 0.890 · 0.6801 | 0.64 · 0.30 · 0.12 · 0.09 | 12 · 9 |
| AT | 16 | 12 | real | 3328637 | 0.048 | 0.16 | 42.19 · 42.01 | 46.79 · 46.54 | 1.028 · 1.037 | 0.995 | 9.78 | 0.900 · 0.7075 | 0.77 · 0.45 · 0.19 · 0.14 | 12 · 9 |
| AT | 16 | 16 | real | 1529627 | 0.022 | 0.08 | 41.12 · 40.87 | 45.67 · 45.45 | 1.034 · 1.039 | 1.030 | 9.52 | 0.912 · 0.7398 | 0.89 · 0.65 · 0.35 · 0.24 | 12 · 9 |
| AT | 16 | 24 | real | 566514 | 0.008 | 0.03 | 39.95 · 39.51 | 44.51 · 44.04 | 1.040 · 1.044 | 1.036 | 8.70 | 0.924 · 0.7740 | 0.98 · 0.90 · 0.73 · 0.65 | 12 · 9 |
| AT | 32 | 2 | real | 41092065 | 0.593 | 0.89 | 59.94 · 59.82 | 64.50 · 64.35 | 0.194 · 0.202 | 0.183 | 10.00 | 0.377 · 0.0066 | — | 11 · 9 |
| AT | 32 | 4 | real | 27227963 | 0.393 | 0.81 | 53.55 · 53.35 | 58.11 · 57.89 | 0.423 · 0.447 | 0.358 | 9.99 | 0.656 · 0.1802 | — | 11 · 9 |
| AT | 32 | 6 | real | 17102484 | 0.247 | 0.66 | 48.69 · 47.60 | 53.25 · 52.21 | 0.728 · 0.792 | 0.580 | 9.98 | 0.812 · 0.4779 | — | 11 · 9 |
| AT | 32 | 8 | real | 9603150 | 0.138 | 0.44 | 45.29 · 44.73 | 49.87 · 49.34 | 0.946 · 0.969 | 0.799 | 9.94 | 0.866 · 0.6123 | — | 11 · 9 |
| AT | 32 | 10 | real | 5307038 | 0.077 | 0.27 | 43.30 · 43.04 | 47.88 · 47.60 | 1.016 · 1.022 | 0.934 | 9.88 | 0.889 · 0.6750 | — | 11 · 9 |
| AT | 32 | 12 | real | 3303405 | 0.048 | 0.19 | 42.32 · 42.06 | 46.87 · 46.62 | 1.030 · 1.034 | 0.995 | 9.80 | 0.900 · 0.7061 | — | 11 · 9 |
| AT | 32 | 16 | real | 1508117 | 0.022 | 0.11 | 41.14 · 40.92 | 45.69 · 45.48 | 1.035 · 1.039 | 1.030 | 9.56 | 0.912 · 0.7390 | — | 11 · 9 |
| AT | 32 | 24 | real | 517316 | 0.007 | 0.04 | 39.81 · 39.24 | 44.37 · 43.84 | 1.040 · 1.044 | 1.036 | 8.88 | 0.926 · 0.7801 | — | 11 · 9 |
| AT3 | 16 | 8 | real | 9370219 | 0.135 | 0.38 | 45.20 · 44.10 | 49.81 · 48.70 | 0.947 · 0.993 | 0.778 | 9.93 | 0.874 · 0.6355 | — | 12 · 9 |
| I | 1 | 4 | real | 30388818 | 0.438 | — | 54.08 · 54.05 | 58.64 · 58.61 | 0.380 · 0.395 | 0.380 | 9.99 | 0.629 · 0.1472 | — | 0 · 0 |
| I | 1 | 8 | real | 15292737 | 0.221 | — | 47.03 · 46.97 | 51.60 · 51.57 | 0.822 · 0.844 | 0.822 | 9.95 | 0.828 · 0.5148 | — | 0 · 0 |
| I | 1 | 12 | real | 7358190 | 0.106 | — | 43.60 · 43.50 | 48.19 · 48.10 | 1.006 · 1.010 | 1.006 | 9.85 | 0.883 · 0.6588 | — | 0 · 0 |
| L | 16 | 4 | real | 29525030 | 0.426 | 0.96 | 54.10 · 53.96 | 58.73 · 58.51 | 0.390 · 0.417 | 0.359 | 9.99 | 0.633 · 0.1515 | — | 0 · 0 |
| L | 16 | 8 | real | 13092958 | 0.189 | 0.85 | 46.47 · 46.27 | 51.12 · 50.84 | 0.872 · 0.907 | 0.797 | 9.95 | 0.841 · 0.5464 | — | 0 · 0 |
| L | 16 | 12 | real | 5022302 | 0.072 | 0.67 | 43.01 · 42.79 | 47.66 · 47.35 | 1.018 · 1.026 | 0.995 | 9.83 | 0.891 · 0.6830 | — | 0 · 0 |
| O | 1 | 2 | real | 43820076 | 0.632 | — | 60.29 · 60.26 | 64.86 · 64.79 | 0.184 · 0.191 | 0.184 | 10.00 | 0.358 · 0.0040 | 0.01 · 0.01 · 0.00 · 0.00 | 0 · 0 |
| O | 1 | 4 | real | 30700221 | 0.443 | — | 54.65 · 54.56 | 59.19 · 59.11 | 0.360 · 0.375 | 0.360 | 10.00 | 0.611 · 0.1254 | 0.05 · 0.02 · 0.01 · 0.01 | 0 · 0 |
| O | 1 | 6 | real | 21828519 | 0.315 | — | 50.37 · 50.33 | 54.96 · 54.86 | 0.584 · 0.607 | 0.584 | 9.98 | 0.751 · 0.3403 | 0.13 · 0.05 · 0.02 · 0.01 | 0 · 0 |
| O | 1 | 8 | real | 15112123 | 0.218 | — | 47.32 · 47.31 | 51.89 · 51.85 | 0.798 · 0.820 | 0.798 | 9.96 | 0.822 · 0.4991 | 0.27 · 0.10 · 0.04 · 0.03 | 0 · 0 |
| O | 1 | 10 | real | 10250652 | 0.148 | — | 45.18 · 45.14 | 49.76 · 49.69 | 0.934 · 0.946 | 0.934 | 9.92 | 0.860 · 0.5967 | 0.44 · 0.18 · 0.07 · 0.05 | 0 · 0 |
| O | 1 | 12 | real | 7047133 | 0.102 | — | 43.72 · 43.65 | 48.31 · 48.21 | 0.995 · 0.999 | 0.995 | 9.86 | 0.881 · 0.6538 | 0.59 · 0.27 · 0.11 · 0.07 | 0 · 0 |
| O | 1 | 16 | real | 3700441 | 0.053 | — | 42.01 · 41.90 | 46.58 · 46.48 | 1.029 · 1.032 | 1.029 | 9.71 | 0.901 · 0.7105 | 0.80 · 0.47 · 0.21 · 0.15 | 0 · 0 |
| O | 1 | 24 | real | 1751745 | 0.025 | — | 40.67 · 40.57 | 45.24 · 45.10 | 1.036 · 1.038 | 1.036 | 9.29 | 0.914 · 0.7471 | 0.93 · 0.75 · 0.47 · 0.36 | 0 · 0 |
| O | 1 | 32 | real | 822767 | 0.012 | — | 39.44 · 39.35 | 43.97 · 43.82 | 1.043 · 1.048 | 1.043 | — | 0.925 · 0.7779 | — | 0 · 0 |
| O | 8 | 2 | real | 43313674 | 0.625 | 0.99 | 60.24 · 60.23 | 64.80 · 64.74 | 0.183 · 0.190 | 0.186 | 10.00 | 0.359 · 0.0043 | 0.01 · 0.01 · 0.00 · 0.00 | 0 · 0 |
| O | 8 | 4 | real | 30335374 | 0.437 | 0.99 | 54.48 · 54.46 | 59.05 · 58.99 | 0.362 · 0.377 | 0.364 | 9.99 | 0.615 · 0.1297 | 0.05 · 0.02 · 0.01 · 0.01 | 0 · 0 |
| O | 8 | 6 | real | 21584007 | 0.311 | 0.99 | 50.37 · 50.34 | 54.94 · 54.88 | 0.580 · 0.606 | 0.591 | 9.98 | 0.751 · 0.3401 | 0.13 · 0.05 · 0.02 · 0.01 | 0 · 0 |
| O | 8 | 8 | real | 14988836 | 0.216 | 1.00 | 47.45 · 47.31 | 52.01 · 51.87 | 0.787 · 0.819 | 0.805 | 9.96 | 0.822 · 0.4991 | 0.26 · 0.10 · 0.04 · 0.03 | 0 · 0 |
| O | 8 | 10 | real | 9976447 | 0.144 | 0.98 | 45.28 · 45.16 | 49.84 · 49.73 | 0.931 · 0.945 | 0.936 | 9.92 | 0.860 · 0.5959 | 0.42 · 0.18 · 0.07 · 0.05 | 0 · 0 |
| O | 8 | 12 | real | 6632176 | 0.096 | 0.94 | 43.87 · 43.71 | 48.45 · 48.28 | 0.995 · 1.000 | 0.995 | 9.86 | 0.880 · 0.6516 | 0.57 · 0.26 · 0.11 · 0.07 | 0 · 0 |
| O | 8 | 16 | real | 3065442 | 0.044 | 0.80 | 42.10 · 42.00 | 46.68 · 46.55 | 1.030 · 1.033 | 1.030 | 9.70 | 0.900 · 0.7072 | 0.78 · 0.46 · 0.22 · 0.16 | 0 · 0 |
| O | 8 | 24 | real | 1127058 | 0.016 | 0.59 | 40.64 · 40.49 | 45.21 · 45.04 | 1.037 · 1.040 | 1.036 | 9.25 | 0.915 · 0.7493 | 0.94 · 0.75 · 0.47 · 0.39 | 0 · 0 |
| O | 16 | 2 | real | 43274051 | 0.624 | 0.99 | 60.23 · 60.22 | 64.80 · 64.74 | 0.183 · 0.190 | 0.183 | 10.00 | 0.359 · 0.0044 | 0.01 · 0.01 · 0.00 · 0.00 | 0 · 0 |
| O | 16 | 4 | real | 30299197 | 0.437 | 0.99 | 54.48 · 54.46 | 59.04 · 58.99 | 0.361 · 0.376 | 0.359 | 9.99 | 0.615 · 0.1298 | 0.05 · 0.02 · 0.01 · 0.01 | 0 · 0 |
| O | 16 | 6 | real | 21569941 | 0.311 | 0.99 | 50.37 · 50.35 | 54.94 · 54.88 | 0.580 · 0.601 | 0.583 | 9.98 | 0.750 · 0.3393 | 0.13 · 0.05 · 0.02 · 0.01 | 0 · 0 |
| O | 16 | 8 | real | 14981915 | 0.216 | 0.99 | 47.44 · 47.31 | 52.01 · 51.87 | 0.788 · 0.808 | 0.797 | 9.96 | 0.822 · 0.4991 | 0.26 · 0.10 · 0.04 · 0.03 | 0 · 0 |
| O | 16 | 10 | real | 9961962 | 0.144 | 0.97 | 45.28 · 45.16 | 49.85 · 49.73 | 0.931 · 0.942 | 0.934 | 9.92 | 0.860 · 0.5959 | 0.42 · 0.18 · 0.07 · 0.05 | 0 · 0 |
| O | 16 | 12 | real | 6623228 | 0.096 | 0.93 | 43.87 · 43.71 | 48.45 · 48.28 | 0.997 · 1.001 | 0.995 | 9.86 | 0.880 · 0.6516 | 0.57 · 0.26 · 0.11 · 0.07 | 0 · 0 |
| O | 16 | 16 | real | 3034290 | 0.044 | 0.80 | 42.11 · 42.00 | 46.68 · 46.55 | 1.030 · 1.033 | 1.030 | 9.70 | 0.900 · 0.7071 | 0.78 · 0.46 · 0.22 · 0.16 | 0 · 0 |
| O | 16 | 24 | real | 1099332 | 0.016 | 0.60 | 40.64 · 40.51 | 45.19 · 45.04 | 1.038 · 1.041 | 1.036 | 9.25 | 0.915 · 0.7478 | 0.93 · 0.75 · 0.47 · 0.39 | 0 · 0 |
| O | 32 | 2 | real | 43257943 | 0.624 | 1.00 | 60.24 · 60.22 | 64.80 · 64.74 | 0.183 · 0.190 | 0.183 | 10.00 | 0.359 · 0.0044 | 0.01 · 0.01 · 0.00 · 0.00 | 0 · 0 |
| O | 32 | 4 | real | 30283184 | 0.437 | 0.99 | 54.48 · 54.46 | 59.04 · 58.99 | 0.362 · 0.377 | 0.358 | 9.99 | 0.615 · 0.1299 | 0.05 · 0.02 · 0.01 · 0.01 | 0 · 0 |
| O | 32 | 6 | real | 21564194 | 0.311 | 0.99 | 50.37 · 50.35 | 54.94 · 54.88 | 0.580 · 0.601 | 0.580 | 9.98 | 0.750 · 0.3391 | 0.13 · 0.05 · 0.02 · 0.01 | 0 · 0 |
| O | 32 | 8 | real | 14981053 | 0.216 | 1.00 | 47.45 · 47.31 | 52.01 · 51.93 | 0.787 · 0.809 | 0.799 | 9.95 | 0.822 · 0.4991 | 0.26 · 0.10 · 0.04 · 0.03 | 0 · 0 |
| O | 32 | 10 | real | 9961396 | 0.144 | 0.98 | 45.28 · 45.16 | 49.84 · 49.78 | 0.931 · 0.944 | 0.934 | 9.92 | 0.860 · 0.5959 | 0.42 · 0.18 · 0.07 · 0.05 | 0 · 0 |
| O | 32 | 12 | real | 6613062 | 0.095 | 0.95 | 43.88 · 43.71 | 48.45 · 48.34 | 0.996 · 1.001 | 0.995 | 9.86 | 0.880 · 0.6516 | 0.57 · 0.26 · 0.11 · 0.07 | 0 · 0 |
| O | 32 | 16 | real | 3017923 | 0.044 | 0.83 | 42.11 · 42.00 | 46.68 · 46.57 | 1.031 · 1.033 | 1.030 | 9.69 | 0.900 · 0.7073 | 0.78 · 0.46 · 0.22 · 0.16 | 0 · 0 |
| O | 32 | 24 | real | 1085789 | 0.016 | 0.63 | 40.65 · 40.52 | 45.21 · 45.04 | 1.038 · 1.041 | 1.036 | 9.25 | 0.915 · 0.7477 | 0.93 · 0.75 · 0.47 · 0.39 | 0 · 0 |
| O3 | 1 | 8 | real | 15313056 | 0.221 | — | 47.57 · 47.54 | 52.14 · 52.08 | 0.778 · 0.801 | 0.778 | 9.96 | 0.817 · 0.4872 | — | 0 · 0 |
| O3 | 16 | 8 | real | 14887958 | 0.215 | 0.97 | 47.64 · 47.55 | 52.21 · 52.12 | 0.772 · 0.793 | 0.777 | 9.96 | 0.817 · 0.4870 | — | 0 · 0 |
| R | 16 | 4 | real | 27745161 | 0.400 | 0.90 | 51.03 · 50.90 | 55.60 · 55.54 | 0.538 · 0.553 | 0.382 | 9.99 | 0.704 · 0.2689 | — | 0 · 0 |
| R | 16 | 8 | real | 13588154 | 0.196 | 0.85 | 46.21 · 46.14 | 50.78 · 50.71 | 0.836 · 0.850 | 0.791 | 9.93 | 0.842 · 0.5501 | — | 0 · 0 |
| R | 16 | 12 | real | 6531375 | 0.094 | 0.77 | 43.45 · 43.32 | 48.01 · 47.85 | 0.981 · 0.988 | 0.988 | 9.81 | 0.885 · 0.6647 | — | 0 · 0 |
| O | 1 | 4 | C | 31026521 | 0.447 | — | 54.64 · 54.57 | 59.18 · 59.09 | 0.361 · 0.373 | 0.361 | — | 0.611 · 0.1253 | 0.05 · 0.02 · 0.01 · 0.01 | 0 · 0 |
| O | 1 | 8 | C | 15318369 | 0.221 | — | 47.34 · 47.33 | 51.87 · 51.85 | 0.797 · 0.827 | 0.797 | — | 0.821 · 0.4976 | 0.27 · 0.10 · 0.04 · 0.03 | 0 · 0 |
| O | 1 | 12 | C | 7189227 | 0.104 | — | 43.73 · 43.72 | 48.27 · 48.25 | 0.999 · 1.036 | 0.999 | — | 0.880 · 0.6504 | 0.59 · 0.27 · 0.11 · 0.07 | 0 · 0 |
| O | 16 | 4 | C | 7251589 | 0.105 | 0.19 | 53.85 · 53.76 | 58.39 · 58.29 | 0.387 · 0.402 | 0.359 | — | 0.641 · 0.1604 | 0.06 · 0.02 · 0.01 · 0.01 | 0 · 0 |
| O | 16 | 8 | C | 3860235 | 0.056 | 0.21 | 47.20 · 47.17 | 51.74 · 51.71 | 0.801 · 0.831 | 0.794 | — | 0.824 · 0.5042 | 0.28 · 0.11 · 0.04 · 0.03 | 0 · 0 |
| O | 16 | 12 | C | 2247521 | 0.032 | 0.27 | 43.83 · 43.74 | 48.37 · 48.28 | 1.001 · 1.039 | 0.995 | — | 0.880 · 0.6498 | 0.57 · 0.26 · 0.11 · 0.08 | 0 · 0 |
| O | 1 | 4 | S | 2907235 | 0.042 | — | 61.57 · 61.37 | 66.04 · 65.77 | 0.084 · 0.088 | 0.084 | — | 0.270 · 0.0078 | — | 0 · 0 |
| O | 1 | 8 | S | 1551548 | 0.022 | — | 59.02 · 58.76 | 63.44 · 63.07 | 0.091 · 0.094 | 0.091 | — | 0.371 · 0.0245 | — | 0 · 0 |
| O | 1 | 12 | S | 1173715 | 0.017 | — | 57.72 · 57.42 | 62.09 · 61.64 | 0.098 · 0.103 | 0.098 | — | 0.428 · 0.0376 | — | 0 · 0 |
| O | 16 | 4 | S | 3667268 | 0.053 | 1.28 | 61.20 · 60.56 | 65.69 · 64.98 | 0.085 · 0.090 | 0.084 | — | 0.321 · 0.0080 | — | 0 · 0 |
| O | 16 | 8 | S | 1946976 | 0.028 | 1.26 | 57.51 · 57.15 | 61.94 · 61.51 | 0.092 · 0.097 | 0.091 | — | 0.466 · 0.0447 | — | 0 · 0 |
| O | 16 | 12 | S | 1313114 | 0.019 | 1.12 | 55.43 · 55.04 | 59.81 · 59.33 | 0.105 · 0.113 | 0.098 | — | 0.557 · 0.0969 | — | 0 · 0 |
| O | 1 | 4 | X | 30847652 | 0.445 | — | 54.61 · 54.58 | 59.14 · 59.11 | 0.360 · 0.374 | 0.360 | — | 0.611 · 0.1249 | 0.05 · 0.02 · 0.01 · 0.01 | 0 · 0 |
| O | 1 | 8 | X | 15246863 | 0.220 | — | 47.33 · 47.31 | 51.89 · 51.86 | 0.797 · 0.823 | 0.797 | — | 0.822 · 0.4980 | 0.27 · 0.10 · 0.04 · 0.03 | 0 · 0 |
| O | 1 | 12 | X | 7110822 | 0.103 | — | 43.73 · 43.63 | 48.28 · 48.19 | 0.998 · 1.034 | 0.998 | — | 0.881 · 0.6542 | 0.59 · 0.27 · 0.11 · 0.07 | 0 · 0 |
| O | 16 | 4 | X | 30812411 | 0.444 | 1.00 | 54.45 · 54.43 | 58.99 · 58.97 | 0.364 · 0.377 | 0.359 | — | 0.616 · 0.1311 | 0.05 · 0.02 · 0.01 · 0.01 | 0 · 0 |
| O | 16 | 8 | X | 15396425 | 0.222 | 1.01 | 47.40 · 47.34 | 51.95 · 51.88 | 0.792 · 0.816 | 0.795 | — | 0.821 · 0.4966 | 0.27 · 0.10 · 0.04 · 0.03 | 0 · 0 |
| O | 16 | 12 | X | 7132576 | 0.103 | 1.00 | 43.84 · 43.73 | 48.39 · 48.26 | 0.999 · 1.034 | 0.997 | — | 0.880 · 0.6503 | 0.58 · 0.26 · 0.11 · 0.07 | 0 · 0 |

ρ_ℓ of the noise proxy between neighbours, offset 0 and best offset within ±8 (median · 90th percentile; blocks): ℓ 0: 0.312 · 0.381, 0.314 · 0.381 (19684); ℓ 1: 0.498 · 0.537, 0.498 · 0.537 (4230); ℓ 2: 0.601 · 0.647, 0.601 · 0.647 (735); ℓ 3: 0.485 · 0.531, 0.485 · 0.531 (45). Samples clipped in the swaps: X 11321316, C 10327536.

VL interval 43.72–54.65 dB (in-window PSNR of O G 1 at Q 12 and Q 4).

| arm | G | BD-rate vs O G 1 (in-window) | vs O G 16 | vs O G 1, full-frame PSNR | vs O G 1, JOD | OQ point | guard vs O G 1 |
| --- | --: | --: | --: | --: | --: | --- | --- |
| O | 1 | +0.0 % | +2.5 % | +0.0 % | +0.0 % | Q 12, 7047133 B | holds (JOD 9.86 vs 9.86 − 0.16; ≥ 2 0.6538 vs 0.6538 + 0.0567) |
| O | 8 | -2.4 % | +0.1 % | -2.3 % | -1.8 % | Q 10, 9976447 B | holds (JOD 9.92 vs 9.86 − 0.16; ≥ 2 0.5959 vs 0.6538 + 0.0567) |
| O | 16 | -2.5 % | +0.0 % | -2.4 % | -2.0 % | Q 10, 9961962 B | holds (JOD 9.92 vs 9.86 − 0.16; ≥ 2 0.5959 vs 0.6538 + 0.0567) |
| O | 32 | -2.5 % | -0.1 % | -2.4 % | -1.9 % | Q 10, 9961396 B | holds (JOD 9.92 vs 9.86 − 0.16; ≥ 2 0.5959 vs 0.6538 + 0.0567) |
| A | 16 | -6.1 % | -3.7 % | -6.0 % | -19.9 % | Q 8, 10511283 B | holds (JOD 9.94 vs 9.86 − 0.16; ≥ 2 0.6044 vs 0.6538 + 0.0567) |
| AT | 16 | -4.9 % | -2.5 % | -5.2 % | -19.3 % | Q 8, 9792023 B | holds (JOD 9.94 vs 9.86 − 0.16; ≥ 2 0.6262 vs 0.6538 + 0.0567) |
| AT | 32 | -6.3 % | -3.9 % | -6.2 % | -25.7 % | Q 8, 9603150 B | holds (JOD 9.94 vs 9.86 − 0.16; ≥ 2 0.6123 vs 0.6538 + 0.0567) |
| AD | 16 | -5.3 % | -2.9 % | -5.9 % | -18.0 % | Q 8, 9445768 B | holds (JOD 9.93 vs 9.86 − 0.16; ≥ 2 0.6323 vs 0.6538 + 0.0567) |
| AQ | 16 | -5.7 % | -3.3 % | -5.7 % | -21.0 % | Q 8, 10215899 B | holds (JOD 9.94 vs 9.86 − 0.16; ≥ 2 0.6249 vs 0.6538 + 0.0567) |
| L | 16 | +1.5 % | +4.2 % | +0.5 % | -11.0 % | Q 8, 13092958 B | holds (JOD 9.95 vs 9.86 − 0.16; ≥ 2 0.5464 vs 0.6538 + 0.0567) |
| R | 16 | — | — | — | +14.1 % | Q 12, 6531375 B | holds (JOD 9.81 vs 9.86 − 0.16; ≥ 2 0.6647 vs 0.6538 + 0.0567) |
| I | 1 | +6.5 % | +9.4 % | +6.5 % | +6.9 % | Q 8, 15292737 B | holds (JOD 9.95 vs 9.86 − 0.16; ≥ 2 0.5148 vs 0.6538 + 0.0567) |

| source | G 16 gain at Q 4 · 8 · 12 | G 1 bytes ÷ real at Q 4 · 8 · 12 |
| --- | --- | --- |
| real | +1.3 % · +0.9 % · +6.0 % | 1.000 · 1.000 · 1.000 |
| S | -26.1 % · -25.5 % · -11.9 % | 0.095 · 0.103 · 0.167 |
| X | +0.1 % · -1.0 % · -0.3 % | 1.005 · 1.009 · 1.009 |
| C | +76.6 % · +74.8 % · +68.7 % | 1.011 · 1.014 · 1.020 |

s = 0.103, e = -0.255, bound s · e = -2.6 % of O G 1's bytes at Q 8.

#### `usb_cine` (64 frames from 0, 512 × 512 × 1, 8-bit; HTJ2K reference 4992262 B)

| arm | G | Q | source | bytes | ÷ HTJ2K | P/K | PSNR in, med · worst | PSNR, med · worst | e_N/σ, med · max | keyframes e_N/σ | JOD | ≥ 1 · ≥ 2 levels, worst frame | κ_0 · κ_1 · κ_2 · κ_3 | hidden · shown existing |
| --- | --: | --: | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- | --: |
| AT | 16 | 4 | real | 680271 | 0.136 | 0.19 | 52.05 · 50.71 | 52.05 · 50.71 | 1.514 · 1.752 | 1.152 | 10.00 | 0.332 · 0.0622 | 0.10 · 0.04 · 0.03 · 0.03 | 24 · 20 |
| AT | 16 | 8 | real | 444151 | 0.089 | 0.12 | 48.98 · 48.06 | 48.98 · 48.06 | 1.810 · 2.124 | 1.374 | 9.99 | 0.398 · 0.1342 | 0.17 · 0.10 · 0.08 · 0.08 | 24 · 20 |
| AT | 16 | 12 | real | 270859 | 0.054 | 0.02 | 46.24 · 45.24 | 46.24 · 45.24 | 2.115 · 2.524 | 1.696 | 9.96 | 0.449 · 0.2227 | 0.29 · 0.21 · 0.17 · 0.20 | 24 · 20 |
| AT | 16 | 16 | real | 181467 | 0.036 | 0.01 | 44.48 · 43.25 | 44.48 · 43.25 | 2.390 · 2.919 | 1.952 | 9.93 | 0.477 · 0.2822 | 0.42 · 0.34 · 0.29 · 0.38 | 24 · 21 |
| AT | 16 | 24 | real | 94037 | 0.019 | 0.00 | 42.12 · 40.54 | 42.12 · 40.54 | 2.834 · 3.573 | 2.552 | 9.83 | 0.509 · 0.3528 | 0.68 · 0.60 · 0.59 · 0.73 | 24 · 22 |
| O | 1 | 4 | real | 1853350 | 0.371 | — | 53.11 · 52.48 | 53.11 · 52.48 | 1.338 · 1.448 | 1.338 | 10.00 | 0.283 · 0.0266 | 0.08 · 0.03 · 0.02 · 0.02 | 0 · 0 |
| O | 1 | 8 | real | 1452140 | 0.291 | — | 50.78 · 49.52 | 50.78 · 49.52 | 1.544 · 1.699 | 1.544 | 9.99 | 0.366 · 0.0924 | 0.12 · 0.07 · 0.05 · 0.05 | 0 · 0 |
| O | 1 | 12 | real | 1238150 | 0.248 | — | 48.72 · 47.54 | 48.72 · 47.54 | 1.791 · 1.942 | 1.791 | 9.98 | 0.410 · 0.1493 | 0.18 · 0.12 · 0.10 · 0.09 | 0 · 0 |
| O | 1 | 16 | real | 1076761 | 0.216 | — | 46.99 · 45.79 | 46.99 · 45.79 | 2.054 · 2.222 | 2.054 | 9.97 | 0.440 · 0.2032 | 0.25 · 0.18 · 0.16 · 0.15 | 0 · 0 |
| O | 1 | 24 | real | 735686 | 0.147 | — | 43.24 · 43.10 | 43.24 · 43.10 | 2.627 · 3.129 | 2.627 | 9.90 | 0.483 · 0.2851 | 0.56 · 0.46 · 0.40 · 0.37 | 0 · 0 |
| O | 1 | 32 | real | 470009 | 0.094 | — | 40.20 · 39.96 | 40.20 · 39.96 | 3.262 · 4.245 | 3.262 | — | 0.526 · 0.3649 | — | 0 · 0 |
| O | 16 | 4 | real | 565317 | 0.113 | 0.27 | 52.65 · 51.78 | 52.65 · 51.78 | 1.421 · 1.595 | 1.152 | 10.00 | 0.309 · 0.0380 | 0.08 · 0.04 · 0.03 · 0.02 | 0 · 0 |
| O | 16 | 8 | real | 403348 | 0.081 | 0.22 | 50.03 · 48.93 | 50.03 · 48.93 | 1.733 · 1.874 | 1.374 | 9.99 | 0.381 · 0.1075 | 0.14 · 0.08 · 0.06 · 0.06 | 0 · 0 |
| O | 16 | 12 | real | 332520 | 0.067 | 0.20 | 47.44 · 46.62 | 47.44 · 46.62 | 2.053 · 2.372 | 1.696 | 9.97 | 0.426 · 0.1754 | 0.24 · 0.15 · 0.13 · 0.13 | 0 · 0 |
| O | 16 | 16 | real | 255259 | 0.051 | 0.17 | 45.35 · 44.73 | 45.35 · 44.73 | 2.335 · 2.777 | 1.952 | 9.95 | 0.458 · 0.2340 | 0.37 · 0.26 · 0.23 · 0.23 | 0 · 0 |
| O | 16 | 24 | real | 135278 | 0.027 | 0.10 | 42.62 · 41.92 | 42.62 · 41.92 | 2.849 · 3.547 | 2.552 | 9.86 | 0.494 · 0.3124 | 0.63 · 0.53 · 0.49 · 0.56 | 0 · 0 |

ρ_ℓ of the noise proxy between neighbours, offset 0 and best offset within ±8 (median · 90th percentile; blocks): ℓ 0: 0.643 · 0.777, 0.643 · 0.777 (3087); ℓ 1: 0.606 · 0.699, 0.606 · 0.699 (567); ℓ 2: 0.406 · 0.465, 0.406 · 0.465 (63); ℓ 3: — · —, — · — (0). Samples clipped in the swaps: X 123, C 73.

VL interval 48.72–53.11 dB (in-window PSNR of O G 1 at Q 12 and Q 4).

| arm | G | BD-rate vs O G 1 (in-window) | vs O G 16 | vs O G 1, full-frame PSNR | vs O G 1, JOD | OQ point | guard vs O G 1 |
| --- | --: | --: | --: | --: | --: | --- | --- |
| O | 1 | +0.0 % | +230.5 % | +0.0 % | +0.0 % | — | — |
| O | 16 | -69.7 % | +0.0 % | -69.7 % | -68.0 % | — | — |
| AT | 16 | -61.4 % | +28.6 % | -61.4 % | -62.3 % | — | — |

#### `usb_cine_rgb` (64 frames from 0, 512 × 512 × 3, 8-bit; HTJ2K reference 11821475 B)

| arm | G | Q | source | bytes | ÷ HTJ2K | P/K | PSNR in, med · worst | PSNR, med · worst | e_N/σ, med · max | keyframes e_N/σ | JOD | ≥ 1 · ≥ 2 levels, worst frame | κ_0 · κ_1 · κ_2 · κ_3 | hidden · shown existing |
| --- | --: | --: | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- | --: |
| AT | 16 | 4 | real | 2028234 | 0.172 | 0.51 | 44.70 · 44.28 | 46.22 · 45.81 | 0.923 · 0.988 | 0.806 | — | 0.703 · 0.2584 | 0.13 · 0.07 · 0.08 · 0.16 | 24 · 19 |
| AT | 16 | 8 | real | 1388539 | 0.117 | 0.48 | 42.87 · 42.30 | 44.40 · 43.84 | 1.030 · 1.090 | 0.875 | — | 0.773 · 0.3876 | 0.22 · 0.12 · 0.14 · 0.24 | 24 · 19 |
| AT | 16 | 12 | real | 1028496 | 0.087 | 0.39 | 41.36 · 40.04 | 42.86 · 41.58 | 1.130 · 1.249 | 1.042 | — | 0.830 · 0.5176 | 0.34 · 0.21 · 0.21 · 0.28 | 24 · 19 |
| AT | 16 | 16 | real | 782537 | 0.066 | 0.31 | 39.89 · 38.87 | 41.41 · 40.42 | 1.217 · 1.325 | 0.988 | — | 0.851 · 0.5718 | 0.48 · 0.35 · 0.30 · 0.38 | 24 · 19 |
| AT | 16 | 24 | real | 451848 | 0.038 | 0.10 | 37.39 · 36.38 | 38.91 · 37.91 | 1.307 · 1.488 | 1.227 | — | 0.892 · 0.6759 | 0.78 · 0.73 · 0.73 · 0.82 | 24 · 20 |
| O | 1 | 4 | real | 2926819 | 0.248 | — | 45.14 · 44.99 | 46.66 · 46.52 | 0.858 · 0.898 | 0.858 | — | 0.676 · 0.2069 | 0.11 · 0.06 · 0.07 · 0.13 | 0 · 0 |
| O | 1 | 8 | real | 2094793 | 0.177 | — | 43.54 · 43.34 | 45.06 · 44.87 | 0.973 · 1.012 | 0.973 | — | 0.739 · 0.3196 | 0.19 · 0.10 · 0.11 · 0.21 | 0 · 0 |
| O | 1 | 12 | real | 1695499 | 0.143 | — | 42.13 · 41.96 | 43.65 · 43.49 | 1.067 · 1.107 | 1.067 | — | 0.783 · 0.4072 | 0.28 · 0.17 · 0.17 · 0.26 | 0 · 0 |
| O | 1 | 16 | real | 1431393 | 0.121 | — | 41.05 · 40.80 | 42.58 · 42.34 | 1.114 · 1.154 | 1.114 | — | 0.812 · 0.4722 | 0.37 · 0.24 · 0.24 · 0.32 | 0 · 0 |
| O | 1 | 24 | real | 1026203 | 0.087 | — | 38.93 · 38.71 | 40.44 · 40.21 | 1.243 · 1.268 | 1.243 | — | 0.855 · 0.5806 | 0.60 · 0.47 · 0.44 · 0.52 | 0 · 0 |
| O | 1 | 32 | real | 634557 | 0.054 | — | 36.22 · 35.88 | 37.72 · 37.35 | 1.359 · 1.487 | 1.359 | — | 0.895 · 0.6926 | — | 0 · 0 |
| O | 16 | 4 | real | 2147092 | 0.182 | 0.79 | 44.96 · 44.77 | 46.47 · 46.31 | 0.906 · 0.953 | 0.806 | — | 0.684 · 0.2248 | 0.11 · 0.06 · 0.07 · 0.13 | 0 · 0 |
| O | 16 | 8 | real | 1399818 | 0.118 | 0.69 | 43.32 · 43.07 | 44.85 · 44.60 | 1.016 · 1.064 | 0.875 | — | 0.749 · 0.3387 | 0.20 · 0.11 · 0.12 · 0.18 | 0 · 0 |
| O | 16 | 12 | real | 1131668 | 0.096 | 0.65 | 42.18 · 41.99 | 43.68 · 43.52 | 1.083 · 1.133 | 1.042 | — | 0.782 · 0.4062 | 0.27 · 0.17 · 0.18 · 0.24 | 0 · 0 |
| O | 16 | 16 | real | 940155 | 0.080 | 0.63 | 41.25 · 40.85 | 42.76 · 42.39 | 1.122 · 1.216 | 0.988 | — | 0.812 · 0.4719 | 0.33 · 0.23 · 0.24 · 0.30 | 0 · 0 |
| O | 16 | 24 | real | 669604 | 0.057 | 0.60 | 39.27 · 38.73 | 40.77 · 40.24 | 1.239 · 1.416 | 1.227 | — | 0.854 · 0.5772 | 0.52 · 0.41 · 0.42 · 0.52 | 0 · 0 |

ρ_ℓ of the noise proxy between neighbours, offset 0 and best offset within ±8 (median · 90th percentile; blocks): ℓ 0: 0.342 · 0.481, 0.342 · 0.481 (1713); ℓ 1: 0.313 · 0.392, 0.313 · 0.392 (360); ℓ 2: — · —, — · — (0); ℓ 3: — · —, — · — (0). Samples clipped in the swaps: X 554157, C 706440.

VL interval 42.13–45.14 dB (in-window PSNR of O G 1 at Q 12 and Q 4).

| arm | G | BD-rate vs O G 1 (in-window) | vs O G 16 | vs O G 1, full-frame PSNR | vs O G 1, JOD | OQ point | guard vs O G 1 |
| --- | --: | --: | --: | --: | --: | --- | --- |
| O | 1 | +0.0 % | +41.8 % | +0.0 % | — | Q 4, 2926819 B | no JOD |
| O | 16 | -29.5 % | +0.0 % | -29.5 % | — | Q 4, 2147092 B | no JOD |
| AT | 16 | -25.1 % | +7.0 % | -25.3 % | — | Q 4, 2028234 B | no JOD |

#### `us_liver` (70 frames from 0, 760 × 421 × 3, 8-bit; HTJ2K reference 18019334 B)

| arm | G | Q | source | bytes | ÷ HTJ2K | P/K | PSNR in, med · worst | PSNR, med · worst | e_N/σ, med · max | keyframes e_N/σ | JOD | ≥ 1 · ≥ 2 levels, worst frame | κ_0 · κ_1 · κ_2 · κ_3 | hidden · shown existing |
| --- | --: | --: | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- | --: |
| AT | 16 | 4 | real | 4949376 | 0.275 | 0.82 | 40.98 · 39.52 | 42.80 · 41.32 | 0.330 · 0.356 | 0.322 | — | 0.645 · 0.2876 | 0.24 · 0.06 · 0.06 · 0.04 | 26 · 21 |
| AT | 16 | 8 | real | 3882190 | 0.215 | 0.78 | 39.60 · 38.80 | 41.42 · 40.58 | 0.390 · 0.443 | 0.343 | — | 0.773 · 0.4197 | 0.28 · 0.17 · 0.17 · 0.10 | 26 · 21 |
| AT | 16 | 12 | real | 3162626 | 0.176 | 0.71 | 37.94 · 37.39 | 39.73 · 39.21 | 0.478 · 0.537 | 0.375 | — | 0.834 · 0.5378 | 0.35 · 0.34 · 0.35 · 0.22 | 26 · 21 |
| AT | 16 | 16 | real | 2668027 | 0.148 | 0.65 | 36.79 · 36.07 | 38.58 · 37.87 | 0.553 · 0.633 | 0.413 | — | 0.865 · 0.6125 | 0.43 · 0.48 · 0.51 · 0.33 | 26 · 21 |
| AT | 16 | 24 | real | 1956289 | 0.109 | 0.53 | 34.87 · 33.96 | 36.69 · 35.77 | 0.718 · 0.840 | 0.557 | — | 0.903 · 0.7147 | 0.68 · 0.71 · 0.79 · 0.77 | 26 · 21 |
| O | 1 | 4 | real | 5461905 | 0.303 | — | 41.19 · 39.60 | 43.03 · 41.39 | 0.322 · 0.336 | 0.322 | — | 0.593 · 0.2684 | 0.24 · 0.05 · 0.05 · 0.03 | 0 · 0 |
| O | 1 | 8 | real | 4454968 | 0.247 | — | 40.39 · 38.98 | 42.20 · 40.76 | 0.344 · 0.359 | 0.344 | — | 0.703 · 0.3355 | 0.26 · 0.09 · 0.11 · 0.09 | 0 · 0 |
| O | 1 | 12 | real | 3841186 | 0.213 | — | 39.26 · 38.03 | 41.07 · 39.80 | 0.376 · 0.393 | 0.376 | — | 0.770 · 0.4199 | 0.28 · 0.19 · 0.22 · 0.16 | 0 · 0 |
| O | 1 | 16 | real | 3363647 | 0.187 | — | 38.07 · 37.06 | 39.88 · 38.83 | 0.417 · 0.433 | 0.417 | — | 0.821 · 0.5125 | 0.33 · 0.32 · 0.35 · 0.27 | 0 · 0 |
| O | 1 | 24 | real | 2684670 | 0.149 | — | 36.30 · 35.41 | 38.11 · 37.17 | 0.558 · 0.577 | 0.558 | — | 0.877 · 0.6405 | 0.49 · 0.53 · 0.56 · 0.51 | 0 · 0 |
| O | 1 | 32 | real | 1857378 | 0.103 | — | 33.65 · 32.98 | 35.44 · 34.72 | 0.828 · 0.851 | 0.828 | — | 0.918 · 0.7572 | — | 0 · 0 |
| O | 16 | 4 | real | 5104569 | 0.283 | 0.93 | 41.11 · 39.56 | 42.95 · 41.36 | 0.335 · 0.346 | 0.322 | — | 0.620 · 0.2751 | 0.24 · 0.06 · 0.05 · 0.03 | 0 · 0 |
| O | 16 | 8 | real | 4086148 | 0.227 | 0.90 | 40.08 · 38.90 | 41.91 · 40.68 | 0.380 · 0.412 | 0.343 | — | 0.734 · 0.3633 | 0.27 · 0.12 · 0.12 · 0.08 | 0 · 0 |
| O | 16 | 12 | real | 3436208 | 0.191 | 0.87 | 38.78 · 37.93 | 40.60 · 39.70 | 0.453 · 0.492 | 0.375 | — | 0.802 · 0.4708 | 0.31 · 0.23 · 0.23 · 0.16 | 0 · 0 |
| O | 16 | 16 | real | 2954917 | 0.164 | 0.85 | 37.56 · 36.97 | 39.38 · 38.74 | 0.517 · 0.555 | 0.413 | — | 0.839 · 0.5490 | 0.38 · 0.38 · 0.38 · 0.25 | 0 · 0 |
| O | 16 | 24 | real | 2293507 | 0.127 | 0.82 | 35.75 · 35.38 | 37.56 · 37.14 | 0.648 · 0.684 | 0.557 | — | 0.878 · 0.6470 | 0.54 · 0.63 · 0.65 · 0.52 | 0 · 0 |

ρ_ℓ of the noise proxy between neighbours, offset 0 and best offset within ±8 (median · 90th percentile; blocks): ℓ 0: 0.169 · 0.359, 0.172 · 0.359 (1374); ℓ 1: 0.148 · 0.208, 0.148 · 0.208 (112); ℓ 2: — · —, — · — (0); ℓ 3: — · —, — · — (0). Samples clipped in the swaps: X 1954921, C 1914153.

VL interval 39.26–41.19 dB (in-window PSNR of O G 1 at Q 12 and Q 4).

| arm | G | BD-rate vs O G 1 (in-window) | vs O G 16 | vs O G 1, full-frame PSNR | vs O G 1, JOD | OQ point | guard vs O G 1 |
| --- | --: | --: | --: | --: | --: | --- | --- |
| O | 1 | +0.0 % | +4.1 % | +0.0 % | — | Q 24, 2684670 B | no JOD |
| O | 16 | -3.9 % | +0.0 % | -4.1 % | — | Q 24, 2293507 B | no JOD |
| AT | 16 | -2.1 % | +1.9 % | -2.1 % | — | Q 24, 1956289 B | no JOD |

**ε** = 0.76 % (largest |BD-rate| of a thinned O G 1 or O G 16 curve against its full curve, 10 thinnings on dbts_b1).

**Decode in order**, ms a frame (handed in to shown frame copied out), 1×, one host:

**`dbts_b1`**, 46 rounds kept, 0 void.

| stream | decoder | ms a frame: mean · median · p95 · slowest (medians over rounds) | slowest at group position | mean ÷ O G 1 (95 % interval) | p95 ÷ O G 1 (95 % interval) |
| --- | --- | --- | --- | --: | --: |
| AD|G16|Q6 | dav1d | 161.6 · 152.8 · 502.4 · 622.8 | 1 | 1.205 (1.184–1.220) | 3.304 (3.204–3.459) |
| AD|G16|Q8 | dav1d | 136.6 · 121.4 · 438.6 · 515.5 | 1 | 1.024 (1.000–1.033) | 2.854 (2.758–3.012) |
| AT|G16|Q6 | dav1d | 160.9 · 154.0 · 501.2 · 606.9 | 1 | 1.193 (1.169–1.213) | 3.258 (3.180–3.429) |
| AT|G16|Q8 | dav1d | 138.5 · 124.9 · 426.8 · 520.7 | 1 | 1.021 (1.006–1.042) | 2.874 (2.720–2.990) |
| AT|G32|Q6 | dav1d | 161.6 · 155.7 · 442.4 · 740.4 | 1 | 1.195 (1.175–1.211) | 2.926 (2.812–3.021) |
| AT|G32|Q8 | dav1d | 136.4 · 121.0 · 379.7 · 625.2 | 1 | 0.999 (0.990–1.018) | 2.560 (2.400–2.651) |
| O'|G1|Q8 | dav1d | 136.0 · 132.7 · 150.8 · 167.1 | 0 | 1.007 (0.975–1.019) | 1.007 (0.985–1.054) |
| O|G16|Q8 | dav1d | 150.7 · 148.4 · 175.2 · 194.9 | 6 | 1.119 (1.100–1.129) | 1.148 (1.102–1.203) |
| O|G1|Q8 | dav1d | 135.0 · 132.3 · 153.4 · 169.4 | 0 | 1.000 (1.000–1.000) | 1.000 (1.000–1.000) |
| O|G32|Q8 | dav1d | 150.6 · 147.6 · 173.4 · 195.9 | 11 | 1.120 (1.106–1.133) | 1.147 (1.086–1.206) |

A/A (dav1d): O′ ÷ O mean 1.007 (0.975–1.019); not wholly beyond ±5 %, so not void; half-width a = 2.2 %.
| AD|G16|Q6 | webcodecs | 109.5 · 104.2 · 305.1 · 355.4 | 1 | 1.133 (1.127–1.146) | 2.883 (2.824–2.912) |
| AD|G16|Q8 | webcodecs | 90.5 · 82.5 · 243.8 · 277.0 | 1 | 0.944 (0.928–0.953) | 2.334 (2.286–2.352) |
| AT|G16|Q6 | webcodecs | 110.6 · 106.3 · 303.6 · 353.4 | 1 | 1.134 (1.128–1.148) | 2.892 (2.834–2.924) |
| AT|G16|Q8 | webcodecs | 90.9 · 83.8 · 239.9 · 280.7 | 1 | 0.942 (0.931–0.954) | 2.299 (2.255–2.346) |
| AT|G32|Q6 | webcodecs | 108.6 · 106.0 · 267.6 · 421.7 | 1 | 1.133 (1.120–1.141) | 2.548 (2.517–2.609) |
| AT|G32|Q8 | webcodecs | 91.0 · 85.4 · 220.6 · 332.0 | 1 | 0.941 (0.927–0.948) | 2.096 (2.053–2.123) |
| O'|G1|Q8 | webcodecs | 95.8 · 95.7 · 105.0 · 110.0 | 0 | 0.997 (0.983–1.011) | 1.005 (0.984–1.028) |
| O|G16|Q8 | webcodecs | 101.3 · 101.1 · 110.9 · 115.9 | 6 | 1.061 (1.042–1.077) | 1.059 (1.041–1.083) |
| O|G1|Q8 | webcodecs | 97.1 · 96.6 · 105.1 · 109.6 | 0 | 1.000 (1.000–1.000) | 1.000 (1.000–1.000) |
| O|G32|Q8 | webcodecs | 101.7 · 101.6 · 110.7 · 114.5 | 12 | 1.056 (1.050–1.070) | 1.055 (1.040–1.075) |

A/A (webcodecs): O′ ÷ O mean 0.997 (0.983–1.011); not wholly beyond ±5 %, so not void; half-width a = 1.4 %.

**`usb_cine`**, 46 rounds kept, 0 void.

| stream | decoder | ms a frame: mean · median · p95 · slowest (medians over rounds) | slowest at group position | mean ÷ O G 1 (95 % interval) | p95 ÷ O G 1 (95 % interval) |
| --- | --- | --- | --- | --: | --: |
| AT|G16|Q4 | dav1d | 4.7 · 2.7 · 13.5 · 39.8 | 1 | 0.784 (0.749–0.806) | 1.664 (1.543–1.735) |
| AT|G16|Q8 | dav1d | 4.1 · 2.0 · 11.8 · 36.6 | 1 | 0.668 (0.640–0.692) | 1.430 (1.353–1.535) |
| O'|G1|Q8 | dav1d | 6.0 · 5.6 · 8.2 · 9.8 | 0 | 0.993 (0.963–1.032) | 0.980 (0.928–1.087) |
| O|G16|Q4 | dav1d | 4.1 · 3.3 · 7.9 · 8.9 | 1 | 0.684 (0.663–0.714) | 0.981 (0.896–1.041) |
| O|G16|Q8 | dav1d | 3.7 · 3.0 · 7.7 · 9.6 | 1 | 0.629 (0.598–0.658) | 0.926 (0.858–1.010) |
| O|G1|Q8 | dav1d | 6.0 · 5.6 · 8.2 · 9.9 | 0 | 1.000 (1.000–1.000) | 1.000 (1.000–1.000) |

A/A (dav1d): O′ ÷ O mean 0.993 (0.963–1.032); not wholly beyond ±5 %, so not void; half-width a = 3.5 %.
| AT|G16|Q4 | webcodecs | 2.7 · 2.1 · 7.5 · 12.2 | 1 | 0.795 (0.767–0.810) | 1.772 (1.701–1.858) |
| AT|G16|Q8 | webcodecs | 2.4 · 1.8 · 6.3 · 9.9 | 1 | 0.660 (0.648–0.695) | 1.426 (1.395–1.515) |
| O'|G1|Q8 | webcodecs | 3.5 · 3.4 · 4.3 · 4.6 | 0 | 1.015 (0.956–1.047) | 1.026 (0.967–1.066) |
| O|G16|Q4 | webcodecs | 2.5 · 2.2 · 3.8 · 4.4 | 0 | 0.735 (0.697–0.753) | 0.901 (0.839–0.997) |
| O|G16|Q8 | webcodecs | 2.3 · 2.1 · 3.3 · 4.2 | 0 | 0.649 (0.632–0.668) | 0.787 (0.740–0.822) |
| O|G1|Q8 | webcodecs | 3.5 · 3.4 · 4.3 · 4.5 | 0 | 1.000 (1.000–1.000) | 1.000 (1.000–1.000) |

A/A (webcodecs): O′ ÷ O mean 1.015 (0.956–1.047); not wholly beyond ±5 %, so not void; half-width a = 4.6 %.

**`usb_cine_rgb`**, 46 rounds kept, 0 void.

| stream | decoder | ms a frame: mean · median · p95 · slowest (medians over rounds) | slowest at group position | mean ÷ O G 1 (95 % interval) | p95 ÷ O G 1 (95 % interval) |
| --- | --- | --- | --- | --: | --: |
| AT|G16|Q4 | dav1d | 11.1 · 9.7 · 32.0 · 58.6 | 1 | 1.156 (1.131–1.183) | 2.624 (2.436–2.925) |
| AT|G16|Q8 | dav1d | 9.8 · 8.0 · 27.8 · 57.4 | 1 | 1.019 (1.000–1.058) | 2.455 (2.220–2.687) |
| O'|G1|Q8 | dav1d | 9.6 · 9.5 · 11.3 · 15.3 | 0 | 1.004 (0.981–1.025) | 1.005 (0.889–1.104) |
| O|G16|Q4 | dav1d | 10.8 · 10.7 · 12.9 · 16.3 | 1 | 1.130 (1.103–1.157) | 1.130 (1.062–1.228) |
| O|G16|Q8 | dav1d | 9.4 · 9.1 · 11.6 · 13.9 | 2 | 0.972 (0.929–0.990) | 0.997 (0.919–1.020) |
| O|G1|Q8 | dav1d | 9.6 · 9.4 · 11.8 · 15.6 | 0 | 1.000 (1.000–1.000) | 1.000 (1.000–1.000) |

A/A (dav1d): O′ ÷ O mean 1.004 (0.981–1.025); not wholly beyond ±5 %, so not void; half-width a = 2.3 %.
| AT|G16|Q4 | webcodecs | 5.2 · 4.2 · 15.3 · 22.0 | 1 | 1.072 (1.051–1.090) | 2.750 (2.600–2.796) |
| AT|G16|Q8 | webcodecs | 4.2 · 3.4 · 12.1 · 17.3 | 1 | 0.876 (0.840–0.888) | 2.147 (2.059–2.208) |
| O'|G1|Q8 | webcodecs | 4.9 · 4.7 · 5.7 · 6.1 | 0 | 0.996 (0.973–1.020) | 0.993 (0.953–1.048) |
| O|G16|Q4 | webcodecs | 5.5 · 5.5 · 6.7 · 7.6 | 6 | 1.139 (1.102–1.152) | 1.191 (1.131–1.244) |
| O|G16|Q8 | webcodecs | 4.0 · 3.9 · 4.8 · 5.5 | 0 | 0.819 (0.795–0.846) | 0.855 (0.821–0.895) |
| O|G1|Q8 | webcodecs | 4.8 · 4.7 · 5.6 · 6.3 | 0 | 1.000 (1.000–1.000) | 1.000 (1.000–1.000) |

A/A (webcodecs): O′ ÷ O mean 0.996 (0.973–1.020); not wholly beyond ±5 %, so not void; half-width a = 2.4 %.

**`us_liver`**, 46 rounds kept, 0 void.

| stream | decoder | ms a frame: mean · median · p95 · slowest (medians over rounds) | slowest at group position | mean ÷ O G 1 (95 % interval) | p95 ÷ O G 1 (95 % interval) |
| --- | --- | --- | --- | --: | --: |
| AT|G16|Q4 | dav1d | 15.3 · 14.0 · 43.6 · 67.5 | 1 | 1.187 (1.169–1.226) | 2.637 (2.493–2.720) |
| AT|G16|Q8 | dav1d | 14.2 · 13.0 · 39.9 · 63.7 | 1 | 1.112 (1.086–1.138) | 2.403 (2.303–2.550) |
| O'|G1|Q8 | dav1d | 13.1 · 12.2 · 17.7 · 20.7 | 0 | 1.012 (0.981–1.050) | 1.013 (0.957–1.077) |
| O|G16|Q4 | dav1d | 15.1 · 14.1 · 19.9 · 22.7 | 2 | 1.150 (1.129–1.190) | 1.162 (1.086–1.244) |
| O|G16|Q8 | dav1d | 13.7 · 13.1 · 18.4 · 20.5 | 3 | 1.068 (1.042–1.102) | 1.098 (1.015–1.158) |
| O|G1|Q8 | dav1d | 12.9 · 12.1 · 16.4 · 19.5 | 0 | 1.000 (1.000–1.000) | 1.000 (1.000–1.000) |

A/A (dav1d): O′ ÷ O mean 1.012 (0.981–1.050); not wholly beyond ±5 %, so not void; half-width a = 3.4 %.
| AT|G16|Q4 | webcodecs | 9.2 · 8.8 · 25.3 · 34.6 | 1 | 1.199 (1.154–1.248) | 2.672 (2.508–2.782) |
| AT|G16|Q8 | webcodecs | 7.7 · 7.2 · 20.2 · 29.1 | 1 | 0.989 (0.970–1.014) | 2.138 (2.061–2.290) |
| O'|G1|Q8 | webcodecs | 7.8 · 7.4 · 9.6 · 10.3 | 0 | 1.003 (0.969–1.040) | 1.008 (0.965–1.063) |
| O|G16|Q4 | webcodecs | 9.1 · 9.0 · 11.3 · 12.3 | 6 | 1.193 (1.142–1.209) | 1.183 (1.126–1.240) |
| O|G16|Q8 | webcodecs | 7.7 · 7.5 · 9.8 · 10.5 | 5 | 0.997 (0.962–1.029) | 1.022 (0.975–1.067) |
| O|G1|Q8 | webcodecs | 7.8 · 7.4 · 9.6 · 10.1 | 0 | 1.000 (1.000–1.000) | 1.000 (1.000–1.000) |

A/A (webcodecs): O′ ÷ O mean 1.003 (0.969–1.040); not wholly beyond ±5 %, so not void; half-width a = 3.6 %.

| # | series | deciding numbers | outcome |
| --- | --- | --- | --- |
| P1 | `dbts_b1` | G 16 gain at Q 8: real +0.9 %, X -1.0 %, S -25.5 %, C +74.8 %; S ÷ real bytes at G 1 10.3 % | **refuted** |
| P2 | `dbts_b1` | κ at Q 8: 0.27 · 0.10 · 0.04 · 0.03; at Q 16: 0.80 · 0.47 · 0.21 · 0.15; ρ_ℓ (best offset, median): 0.314 · 0.498 · 0.601 · 0.485 | **refuted** |
| P3 | `dbts_b1` | Q 2 +1.2 % (kept band); Q 4 +1.3 % (kept band); Q 6 +1.2 % (kept band); Q 8 +0.9 % (kept band); Q 10 +2.8 % (kept band); Q 12 +6.0 % (kept band); Q 16 +18.0 % (kept band); Q 24 +37.2 % (kept band) | **refuted** |
| P4 | `dbts_b1` | BD-rate vs O G 1 in [43.72, 54.65] dB: A G 16 -6.1 %; AT G 16 -4.9 %; AT G 32 -6.3 %; AD G 16 -5.3 %; AQ G 16 -5.7 %; −(s · e) − ε = +1.9 % | **refuted** |
| P5 | `dbts_b1` | keyframes' e_N/σ at Q 4 · 6 · 8: AD 0.362 · 0.672 · 0.940, A 0.359 · 0.583 · 0.797 | not held, not refuted |
| P6 | `dbts_b1` | AT ÷ A − 1, ΔPSNR in: Q 2 -0.4 %, -0.10 dB; Q 4 -1.2 %, -0.24 dB; Q 6 -3.2 %, -0.35 dB; Q 8 -6.8 %, -0.41 dB; Q 10 -8.9 %, -0.38 dB; Q 12 -9.1 %, -0.30 dB; Q 16 -5.0 %, -0.10 dB; Q 24 +0.3 %, +0.01 dB | **refuted** |
| P7 | `dbts_b1` | G 32 ÷ G 16 − 1, P/K (G 16): Q 2 -0.0 %, 0.987; Q 4 -0.1 %, 0.986; Q 6 -0.0 %, 0.988; Q 8 -0.0 %, 0.992; P/K at Q 24 0.596 | held |
| P8 | `dbts_b1` | I vs O G 1 +6.5 %; R G 16 vs O G 16 —; O3 G 16 gain at Q 8 +2.8 %; AT3 ÷ AT − 1 -4.3 % | **refuted** |
| P10 | `dbts_b1`, dav1d | ÷ O G 1 mean: O|G16 1.119; O|G32 1.120; AT|G16 1.021; AT|G32 0.999; AD|G16 1.024; ARF ÷ O same G: AT|G16 0.919; AT|G32 0.906; AD|G16 0.907; slowest ÷ median: AT|G16 4.17; AT|G32 5.17; AD|G16 4.25 | held |
| P10 | `dbts_b1`, webcodecs | ÷ O G 1 mean: O|G16 1.061; O|G32 1.056; AT|G16 0.942; AT|G32 0.941; AD|G16 0.944; ARF ÷ O same G: AT|G16 0.897; AT|G32 0.895; AD|G16 0.893; slowest ÷ median: AT|G16 3.35; AT|G32 3.89; AD|G16 3.36 | **refuted** |

**Decode, read.** 46 rounds fit before 4.4 h of the session (≥ 10 required), none void; every frame of every kept
unit matched native dav1d 1.5.4's hash. On `dbts_b1` at Q 8 the alt-ref arms' **mean** per frame is no slower than
O G 1's (dav1d 1.00–1.02, WebCodecs 0.94), because they code fewer bytes, but their frames are not even: the unit
after each keyframe carries the ARF and the internal ARFs (4 coded frames, 1.35–1.49 MB against O's 0.47 MB), so the
slowest frame, at group position 1 (the median position over rounds), takes **about 0.52–0.63 s on dav1d-WASM and 0.28–0.33 s on WebCodecs**, 3.4–5.2×
the median frame, and their 95th percentile is 2.1–2.9× O G 1's. Every stream on `dbts_b1`, O G 1 included (132 ms
median on dav1d, 97 ms on WebCodecs), is slower than the 66.7 ms of 15 slices/s on this host; that bar is the quality
study's reference interval, not this protocol's. O G 16 and G 32 cost 12 % more per frame than G 1 on dav1d and 6 % on
WebCodecs. At the matched rung (Q 6: the arms reach O G 1 Q 8's in-window PSNR only one rung finer) their mean rises to
1.13–1.21× O G 1's, with 95 % upper bounds well past 1 + a (a = 2.2 % on dav1d, 1.4 % on WebCodecs), so on this volume
**no alt-ref arm meets §7 (2)**, whatever shard 2 finds for (1). The clips' tables are above and are reported apart.

## Groups, measured (2026-11-10 — shard 1 of 2; shard 2 owed)

*Collected by `lab/av1/groups/collect.py rows/groups-1.jsonl --decode rows/groups-1.decode.json --partial`, the only
shard that has run. §7's rule needs all three DBT volumes; with one, every verdict below is that volume's and none is
the protocol's.*

**Method card.**

| | |
| --- | --- |
| input and pin | `dbts_b1` slices 9–40 of 50 (2560 × 3328, 10-bit, system B), and `usb_cine`, `usb_cine_rgb`, `us_liver` (lossy-sourced, apart), as `lab/av1/fetch_data.sh` writes them against the SHA-256s in `lab/av1/data.json`; protocol at `7534b5c1`, code and rows on `claude/av1-groups` from `05186de5` |
| encoder, per arm | `aomenc` libaom 3.15.1 (the tarball `ingest/tools.sh` pins), one thread, `--limit=n --q-hist=64` and `arms.py`'s flags: the base `--ivf --good --threads=1 --passes=1 --tune=psnr --end-usage=q --cq-level=Q --min-q=Q --max-q=Q --deltaq-mode=0 --aq-mode=0 --denoise-noise-level=0 --kf-min-dist=G --kf-max-dist=G` (G 1: `--kf-max-dist=0`) `--monochrome --profile=0 --bit-depth=10 --input-bit-depth=10 --cpu-used=6`, then O `--lag-in-frames=0 --auto-alt-ref=0`; L `--lag-in-frames=39 --auto-alt-ref=0 --enable-tpl-model=0 --enable-keyframe-filtering=0`; A as L with `--auto-alt-ref=1`; AT as A with `--enable-tpl-model=1`; AD as AT with `--enable-keyframe-filtering=1`; AQ as AT without `--min-q`/`--max-q`; I `--allintra --lag-in-frames=0`, G 1; R `--rt` with O's flags; O3, AT3 with `--cpu-used=3` (RGB clips: `--bit-depth=8 --profile=0` and BT.601 tags in place of the monochrome flags) |
| decoders | native `dav1d` 1.5.4 (`54706fc`, `LD_LIBRARY_PATH` on the built library) for every measure and every reference hash; dav1d-WASM (one thread, `max_frame_delay` 1) and WebCodecs (`prefer-software`, `optimizeForLatency`) from `lab/av1/profiles/decoders.js`, built per `client/decode/wasm/build` (manifest checked), in headless Chromium from Playwright 1.56.1 |
| clocks | encode: `wait4` user + system CPU of `aomenc`; a cell: CPU of the worker and its children, encode to last measure; decode: `performance.now()` in a worker per unit, from handing the unit in to its shown frame's luma copied out, hashing after the clock stops; a fresh decoder per stream, opened and primed off the clock |
| bytes | the sum of the IVF frame payloads (`ingest.ivf_units`, IVF headers excluded); ÷ HTJ2K against the quality study's lossless control on the same slices |
| metrics | the quality study's `measure()` unchanged: PSNR over the frame and in-window, e_N/σ (σ from the real source), displayed-level moves under the first window, JOD from ColorVideoVDP 0.5.7 on the middle 8 frames (grey only); κ_ℓ and ρ_ℓ from `bands.py` (§6.4); BD-rate per §7 (`bd.py`, PCHIP, 0.01 dB grid, ≥ 70 % overlap) |
| host | 4 vCPU Xeon @ 2.10 GHz, 15.7 GB, one host; encode saturates memory on `dbts_b1`'s lookahead arms (≈ 3.0 GB an encode, 3–4 in flight), decode ran alone at 1×; nothing past this host is claimed |

**Verdict, one screen.**

* **Claim (`dbts_b1`'s 32 slices, one 4-core host).** At equal in-window PSNR across the VL interval, libaom's filtered
  alt-ref saves **4.9–6.3 % of O G 1's bytes** (O G 16: 2.5 %; ε 0.76 %), with the quality guard holding; it does not
  save bytes at the OQ point, where its rung (Q 8, 9.4–10.5 MB) costs more than O G 1's (Q 12, 7.05 MB); and it makes
  in-order decoding uneven, its slowest frame 3.4–5.2× its median. No arm is recommended over O G 1 on this volume: none
  passes §7 (2) at its matched rung. **G 1 stays** until shard 2 says otherwise for §7 (1).
* **Proof chain.** O reproduces the quality study byte for byte (pilot, and `dbts_b1` slices 9–40 at seven rungs) → the
  arms are distinct, deterministic and pinned at Q (§Checks; q-hist's zero entries read) → per-cell measures with the
  study's code → BD-rate on PCHIP curves, ε from the data → decode hashed frame by frame against native dav1d, paired
  by round, A/A inside its rule.
* **Why, as far as these cells show.** The swap says the slices' own noise blocks inter coding at Q 2–12: a shared noise
  (C) lets G 16 save 69–77 % at Q 4–12; a shuffled one (X) leaves it at −1.0 to +0.1 %, where the real source gains +0.9 to +6.0 % — so at Q 12 the real neighbours' own noise correlation is what G 16 uses. κ_ℓ says that at Q 8 every band still
  carries most of the noise (κ_0 0.27, κ_3 0.03) and that it is gone first in the finest band (κ_0 0.80 at Q 16), and
  G 16's gain switches on as κ_0 rises (+2.8 % at Q 10, +6.0 % at Q 12, +18 % at Q 16). Yet ρ_ℓ rises to 0.60 at ℓ 2,
  above §2.2's threshold √(1 − κ)/2 ≈ 0.49, with no gain: §2.2's per-band inequality does not predict this volume. P2
  and P3 are refuted. P1 and P4 are refuted by a swap source that is not what §5 assumed (S carries Q 32's own error).
* **What would change it.** Shard 2: `dbts_a1` and `dbts_c1` decide §7 (1) for systems A and C, and the TRUS sweeps P9;
  then a breast ultrasound cine or ABUS fixture, more volumes per system, a finer ladder at Q 8–12 (where the OQ point
  and the ARF arms' crossing of e_N/σ = 1 both sit), a reader study, and another host for the decode.
* **What is owed.** Shard 2 whole (305 cells, its decode, the alt-ref reproduction check); then this section collected
  again without `--partial`. A structure-only source that carries no coding error of its own, if P1 and the s · e bound
  are to test what §2.5 meant. A shift-invariant band filter, if ρ_ℓ is ever measured on moving content.
* **Fixtures and their limits.** `dbts_b1`'s middle 32 slices: one volume of system B, cut for time, its G 32 the
  whole cut. The three clips came from lossy video and support no verdict. No lossless breast ultrasound cine or ABUS
  exists among the fixtures.

## Settings amendment, pre-registered

*Row GROUPS-SETTINGS-PROTOCOL, written 2026-11-10 before anything in it ran. Theory and protocol only: nothing was
encoded, decoded or timed for it. Every number in §S1–§S3 is quoted from a row already measured (named at each use),
from libaom's source, or is labelled *derived*. It amends the protocol above and changes nothing in it or in the
measured sections: a separate session runs §Settings shards from this section alone and reports every cell,
including those that miss.*

1. **Asked:** every G result so far used low-delay settings (`--lag-in-frames=0 --auto-alt-ref=0`: no lookahead, no
   alt-ref frames, no temporal filter). Do they hide a saving at **equal quality as the quality line measures it**
   (the noise anchor e_N/σ ≤ 1, not equal PSNR), and what would the alternative cost to decode in display order
   through the product's routes?
2. **Answer, as theory:** the filter is the only setting that can change the answer, and at the anchor it should cost
   bytes rather than save them. In libaom 3.15.1 its weight strengthens 28–64-fold in its exponent from Q 4 to
   Q 16 (§S2.2), so the filtered arms lose the source's noise at a lower Q than O does and reach e_N/σ = 1 sooner:
   shard 1 shows exactly that on `dbts_b1` (§S1). An alt-ref with the filter off keeps the noise, and so it should
   behave like O at G 16.
3. **The numbers that decide it:** bytes interpolated at worst-frame e_N/σ = 1.00 on an integer-Q ladder, for O at
   G 1, 8, 16 and 32 against four lookahead arms (two of them new), on the three DBT volumes, A and C coded by the
   product's depth cut; a noise-retention guard; and in-order decode per frame through WebCodecs at 10 bits and
   dav1d-WASM.
4. **It rests on** `dbts_a1`, `dbts_b1` (slices 9–40), `dbts_c1`; libaom 3.15.1 at speed 6; the quality study's
   `measure()`; the groups code (`lab/av1/groups/`) at its shard 1 state; one 4-core cloud host.
5. **Left open:** readers (visual losslessness); other DBT systems and datasets; breast ultrasound cine and ABUS
   (no lossless fixture); hardware decoders and phones; other speeds, tunes, two-pass (encoder settings §9 T3–T8).

### S1 · What is already measured, and the gap

From shard 1 (`dbts_b1` slices 9–40, §Groups shard 1, measured): at equal in-window PSNR the filtered alt-ref arms
save 4.9–6.3 % against O G 1 (ε 0.76 %); at the noise anchor they save nothing, because they cross e_N/σ = 1
between Q 8 (worst frame 0.968–0.982) and Q 10 (1.019–1.026) while O G 1 crosses at Q 12 (0.999). Interpolated in
ln bytes between those rungs (*derived*, linear in worst-frame e_N/σ, from that section's rows): AT G 16 reaches
1.00 at about 7.7 MB, O G 1 at about 6.9 MB, O G 16 at about 6.7 MB. So on this one volume the filtered arm costs
about **+12 %** at the anchor and O G 16 saves about **3 %**, on a ladder too coarse (two Q a rung) to resolve either.

What the protocol above leaves untested (encoder settings §9, `claude/av1-encoder-settings:docs/av1/encoder-settings.md`):

* **an alt-ref without the filter**, which separates "lookahead and hidden frames" from "temporal denoising";
* **the filter's strength** (T2); libaom's full default, which pairs TPL with **objective delta-q** (T1);
* **alt-ref at G 8**, where a group caps how many frames the filter may average;
* **the product's form for D > 10**: systems A and C coded by the depth cut at 10 bits, so that WebCodecs, the
  product's route, can be timed on them (the protocol gives A and C no WebCodecs claim, §6.5);
* **equal quality by the quality line's own metric**, on a ladder fine enough to resolve it.

### S2 · Theory

**S2.1 What an alt-ref is for.** The AV1 overview by libaom's authors [H]: an encoder may "synthesize a frame that
can potentially reduce the collective prediction errors among several display frames. One example is to apply
temporal filtering along the motion trajectories of consecutive original frames to build an ARF, which retains the
common information with the acquisition noise on each individual frame largely removed. The encoder typically uses
a relatively lower quantization step size to code the common information (i.e., ARF)". And its cost: "this results
in an additional frame for decoders to process" [H §II.B]. On DBT the "acquisition noise" is the patient's image
noise that the noise anchor is defined to keep (quality study §Terms), so the tool's purpose and the view's contract
point in opposite directions (*derived*).

**S2.2 How hard libaom's filter averages** (`av1/encoder/temporal_filter.c`, quoted; [L1] at the pin). Each 64 × 64
block of the frame to filter is matched by motion search in each neighbour and averaged with weight
`exp(-scaled_error) * TF_WEIGHT_SCALE`, where `scaled_error = combined_error * d_factor[subblock_idx] *
decay_factor[plane]` and `decay_factor[plane] = 1 / (n_decay * q_decay * s_decay)` (`:943-948`, `:842`); the
frame being filtered enters with the fixed weight `TF_WEIGHT_SCALE` (1000, `:679`). Then:

* **q:** `double q_decay = pow((double)q_factor / TF_Q_DECAY_THRESHOLD, 2); q_decay = CLIP(q_decay, 1e-5, 1);`
  (`:829-830`), with `#define TF_Q_DECAY_THRESHOLD 20` and its comment "when using a small q (high bitrate), we
  would like to reduce the filtering strength such that more detailed information can be preserved"
  (`temporal_filter.h:53-58`). In Q mode `q_factor` is `av1_convert_qindex_to_q(cq_level, bit_depth)` (`:173-176`),
  the AC step ÷ 16 at 10 bits and ÷ 64 at 12 (`ratectrl.c:199-205`). From the AC tables (*derived*): q_factor is
  3, 5, 7, 9, 12, 16 at Q 4, 6, 8, 10, 12, 16 (10-bit), so q_decay is 0.023, 0.063, 0.12, 0.20, 0.36, 0.64. The
  exponent's scale therefore grows about 28× from Q 4 to Q 16 at 10 bits (about 64× at 12 bits, where Q 4 gives
  q_factor 2), and it is constant only from Q ≈ 20 up. **The filter is weak at Q 4 and strong at Q 12–16: exactly
  across the VL interval.**
* **strength:** `double s_decay = pow((double)filter_strength / TF_STRENGTH_THRESHOLD, 2); s_decay = CLIP(s_decay,
  1e-5, 1);` (`:837-838`) with `#define TF_STRENGTH_THRESHOLD 4`. So `--arnr-strength` 4, 5 (the default) and 6 all
  give s_decay = 1, and **they should code identical streams** (*derived*; `arnr_strength` is read nowhere else in
  `av1/encoder/`, checked by `grep`). Strength 2 gives 0.25, a filter four times weaker in its exponent. Strength 0
  gives 1e-5: `scaled_error` hits its cap of 7, so every neighbour's weight is exp(−7) × 1000 ≈ 0.9, truncated to 0
  or rounded to 1 by the approximate path, against the frame's own 1000. With the default `--arnr-maxframes` 7 plus libaom's adjustment of up to 6
  (`:1335-1375`), at most 12 neighbours: **the filtered frame is the source frame** to within 1.2 % of its weight
  (*derived*). That is the unfiltered
  alt-ref of §S4.
* **noise:** `const double n_decay = 0.5 + log(2 * noise_levels[plane] + 5.0);` "Larger noise -> larger filtering
  weight." (`:840-841`).
* **frames:** "Temporal filtering should not go beyond key frames" (`:1276`); `int num_frames =
  AOMMAX(cpi->oxcf.algo_cfg.arnr_max_frames, 1);` (`:1270`), then adjusted by noise level and by the alt-ref's boost
  (`:1335-1375`). So at **G 8 a keyframe-bounded group lets the filter average at most 8 frames**, and at G 1 none
  (*derived*).
* **what is shown:** a filtered alt-ref is shown directly, with no overlay coding the real frame, when
  `mean < threshold && std < mean * 1.2` with `threshold = 0.7f * ac_q_step * ac_q_step` (`:1607-1609`), or always
  if `!enable_overlay` (`:1594`). `--enable-overlay` defaults to 1 (`av1_cx_iface.c:360`). The shown frame is then
  the filtered one where libaom judges the filter's change smaller than the quantizer's.

**S2.3 What a filtered reference does to inter coding of a noisy, slowly changing volume.** The protocol's §2.2 gives
the inter residual's noise term on a band as σ_b²[1 + (1 − κ_b) − 2ρ_b√(1 − κ_b)], with 1 − κ_b the share of the
band's noise the reference still holds. A filtered alt-ref lowers 1 − κ_b on its own reference: averaging N frames
of independent noise with weights w_i leaves the noise variance σ²·Σw_i²/(Σw_i)², σ²/N when equal (*derived*,
elementary). Frames predicted from it pay σ_b² for their own noise either way and gain only on what neighbours
share: structure (§2.5's bound s · e). On DBT the structure does not hold still: features finer than a slice's
depth blur change from slice to slice (§2.3), so the average also blurs the shared structure in depth, and the
motion search cannot undo that, because the change is not a motion (*derived*). The prediction is that the filtered
arms buy their bytes from noise removal, which the anchor counts as error.

**S2.4 What that predicts for bytes at equal quality.** e_N is the coding error in the Laplacian band; deleting the
band's noise outright reads e_N = σ (audit F4, `claude/av1-audit-quality:docs/av1/audit-quality.md`). A shown
filtered frame (a directly shown alt-ref, or a filtered keyframe) carries less of its noise than O's frame at the
same Q, so its e_N is higher, and the q-dependence of S2.2 makes that gap grow with Q. At the anchor the filtered
arms must therefore sit at a lower Q than O, where every frame costs more; the frames they save on are the
predicted ones, at most s · e of the bytes (§2.5). Net: **filtered arms cost more than O G 1 at e_N/σ = 1**, by an
amount that grows with σ (more noise, stronger filter) and so should be largest on A and C (σ 10–18) and smallest
on B (σ 3.4–5.7). The unfiltered alt-ref keeps every reference's noise, so §2.2 makes it behave like O at the same
G: hidden frames and a pyramid, but nothing that inter can use on noise (*derived*). Objective delta-q lowers q on
the superblocks of alt-refs that many frames reference ("Note objective delta_q and tpl eligible frames are only
altref frames currently", `encodeframe.c:2339-2340`): finer steps on a filtered frame, which spends bytes where the
filter already removed the noise. Its sign at the anchor is not predicted by this theory beyond "small".

**S2.5 What it predicts for decode in display order.** Every temporal unit holds one shown frame ([A1]), so the
product's in-order model holds (§2.4). The work moves: the unit after a keyframe carries the alt-ref and internal
alt-refs, and a `show_existing_frame` unit decodes nothing new. On shard 1's `dbts_b1` alt-ref streams, 12 hidden
frames and 9 shown-existing units in 32 frames, i.e. 35 coded frames for 32 shown (*derived* from §Groups shard 1's
table). The mean per shown frame should move little (fewer bits a frame against 9 % more frames), the slowest
frame a lot (shard 1: slowest ÷ median 3.4–5.2 on dav1d-WASM at Q 8). A lower matched Q for the filtered arms
means more bits a frame, so at equal quality their mean should rise, not fall (*derived*). [H] notes the same
cost from the decoder's side: levels bound "the total number of samples in both displayable frames and ARFs that
will not be used as a 'show existing frame'".

### S3 · Predictions

Written before any run; each is decided by the collector (§S7) using its refutation clause exactly as written.
"Anchor bytes" is B₁ of §S6; "saving" is 1 − B₁(arm) ÷ B₁(O G 1) on the same volume.

| # | prediction | refuted if |
| --- | --- | --- |
| **Q1** strength saturates | AT at `--arnr-strength` 4 and 6 is byte-identical to AT (strength 5) at Q 8, G 16 on every volume | any byte differs |
| **Q2** G 1 has no lookahead tool | AT and AF at G 1 are byte-identical to O G 1 at Q 8 on every volume | any byte differs |
| **Q3** the filter costs at the anchor | AT, AD and AF at G 16: saving in −30 … 0 % on every volume, most negative on A or C | any of them saves > ε on any volume |
| **Q4** the filter saves at equal PSNR | AT, AD, AF at G 16: in-window PSNR BD-rate against O G 1 over the curves' overlap, −12 … −3 % on every volume | outside that range on any volume |
| **Q5** unfiltered alt-ref ≈ O | AU G 16's saving within ±3 points of O G 16's on every volume; its worst-frame e_N/σ at Q 8 within ±0.03 of O G 16's | outside either on any volume |
| **Q6** strength orders the arms | at Q 8, G 16 on every volume, ν (§S6) and anchor bytes order AU ≥ AW ≥ AT for ν and AU ≤ AW ≤ AT for bytes, each step larger than ε for bytes or 0.01 for ν | any pair out of order by more than those margins |
| **Q7** the group caps the filter | AT G 8's saving lies between O G 8's and AT G 16's (within ε) on every volume; at Q 8 its ν is ≥ AT G 16's | outside on any volume |
| **Q8** G alone, at the anchor | O G 8, 16, 32 savings in −1 … +6 % on B and −2 … +3 % on A and C; G 32 within 1 point of G 16 | outside on any volume |
| **Q9** delta-q is small | AF G 16 within ±3 % of AD G 16 in bytes at every rung, and their anchor bytes within ±3 % | outside either |
| **Q10** the depth cut costs little | on A and C: O G 1 at Q 0 on the cut form reads worst-frame e_N/σ ≤ 0.12 (its rounding alone, below); and its B₁ is within ±10 % of the full-depth O G 1's B₁ interpolated from the quality study's rows at Q 4, 8, 12 (`claude/av1-quality-metrics:lab/av1/metrics/rows/`; coarse, hence ±10 %) | either fails on either volume |
| **Q11** decode in order, WebCodecs at 10 bits | at each stream's matched rung, mean per shown frame ÷ O G 1's: O G 8, 16 in 0.85–1.25; AT, AF, AU G 16 in 0.85–1.35; slowest ÷ median ≥ 2 for every alt-ref stream and ≤ 1.6 for O | any ratio outside its range |
| **Q12** decode, dav1d-WASM | the same ratios in 0.8–1.4, slowest ÷ median ≥ 2 for alt-ref streams | outside |

ν: σ_out ÷ σ of §S6. Q3 is the owner's question; Q4–Q7 say why; Q1, Q2, Q9, Q10 check the theory's reading of
the source; Q11–Q12 are the decode cost. The ranges in Q3, Q8 and Q11 are wide on purpose: shard 1 is one volume,
and the theory gives signs and orders, not sizes.

### S4 · Arms

Each arm is the protocol's base (§5) at `--cpu-used=6`, q pinned (`--min-q=Q --max-q=Q`, the view's one step),
`--deltaq-mode=0` unless stated, `--enable-overlay` and `--arnr-maxframes` at libaom's defaults (1 and 7), built by
`lab/av1/groups/arms.py`:

| arm | flags over the base | what it isolates | in the protocol |
| --- | --- | --- | --- |
| **O** | `--lag-in-frames=0 --auto-alt-ref=0` | the settings used so far | yes |
| **AT** | `--lag-in-frames=39 --auto-alt-ref=1 --enable-tpl-model=1 --enable-keyframe-filtering=0` | filtered alt-ref with TPL | yes |
| **AD** | AT with `--enable-keyframe-filtering=1` | + filtered keyframes | yes |
| **AF** | AD with `--deltaq-mode=1` | libaom's full default for all five knobs (T1) | new |
| **AU** | AT with `--arnr-strength=0` | alt-ref and lookahead, filter off (S2.2) | new |
| **AW** | AT with `--arnr-strength=2` | a filter four times weaker in its exponent (T2) | new |

**The flags this amendment sets or varies,** verbatim from `av1/arg_defs.c` [L1] with libaom's default
(`av1_cx_iface.c`, `default_extra_cfg`) and what each does here:

| flag | help text (line) | default (line) | what it does here |
| --- | --- | --- | --- |
| `--lag-in-frames` | "Max number of frames to lag" (224) | `35` raised to 39 in good mode (§5) | 0: no filter, no TPL (§2.4); 39: one 32-frame group of lookahead |
| `--auto-alt-ref` | "Enable automatic alt reference frames" (300) | `1` (257) | hidden alt-ref frames |
| `--enable-tpl-model` | "RDO based on frame temporal dependency (0: off, 1: backward source based); required for --deltaq-mode=1" (330-333) | `1` (268) | needed by AF; inert at lag 0 |
| `--enable-keyframe-filtering` | "Apply temporal filtering on key frame (0: no filter, 1: filter without overlay (default), 2: filter with overlay - experimental, may break random access in players)" (334-339) | `1` (269) | AD, AF: the shown keyframe is a filtered frame |
| `--deltaq-mode` | "Delta qindex mode (0: off, 1: deltaq objective (default), 2: deltaq placeholder, 3: key frame visual quality, 4: user rating based visual quality optimization, 5: HDR video, 6: Variance Boost); --deltaq-mode=1 requires --enable-tpl-model=1" (560-564) | `DELTA_Q_OBJECTIVE` (305) | AF: per-superblock q on alt-refs, inside the pinned frame q (whether min/max q bound the deltas is *unverified*; Q9 and the q-hist check read it) |
| `--arnr-strength` | "AltRef filter strength (0..6)" (304) | `5` (271) | AU 0, AW 2, the rest 5 (S2.2) |
| `--arnr-maxframes` | "AltRef max frames (0..15)" (302) | `7` (270) | not varied; stated |
| `--enable-overlay` | "Enable coding overlay frames (0: false, 1: true (default))" (454-455) | `1` (360) | not varied: a filtered alt-ref is shown directly only under S2.2's threshold |
| `--kf-min-dist`, `--kf-max-dist` | "Minimum keyframe interval (frames)", "Maximum keyframe interval (frames)" (278-281) | `0`, `9999` | G; at G 1 `--kf-max-dist=0` also turns keyframe filtering off (encoder settings §2a) |

**Streams per volume:** O at G 1, 8, 16, 32; AT and AF at G 8, 16, 32; AD, AU and AW at G 16 — 13 streams. G 1 of
the lookahead arms is Q2's check only: if it holds, O G 1 stands for every arm's G 1. On `dbts_b1`, G 32 is the
whole cut (§4).

**Forms.** `dbts_b1` (D = 10) at its own depth. `dbts_a1` and `dbts_c1` (D = 12) in the **cut form** only: each
sample through `depth_cut(v, 12)` of `claude/oq-depth-cut:ingest/coded-frames/ingest.py` (round half up to 10
bits, clamped), imported unchanged, coded at `--bit-depth=10 --profile=0`, and measured against the 12-bit source
after reconstructing each decoded code c as c · 4. The cut's rounding is uniform on [−2, +1], RMS ≈ 4 ÷ √12 ≈ 1.15
sample units against σ ≥ 10 on A and C (*derived*). Equal Q is not equal step across forms: at Q 4, 8, 12 the 10-bit
AC step times 4 is 1.20, 1.07 and 1.04 of the 12-bit step (`quant_common.c`, *derived*), so the forms compare only
at equal quality (B₁). This is the form the product decodes through WebCodecs
(`claude/docs-lines-3:docs/lines/optimal-quality.md` §Terms). σ is the 12-bit source's, as the quality study
takes it.

**Ladders,** every integer Q so the anchor is bracketed within one rung (four qindex): `dbts_b1` Q 6–12 and 14
(8 rungs; its O G 1 crosses at Q 12, its alt-ref arms at Q 8–10, §S1); `dbts_a1`, `dbts_c1` Q 4–12 (9 rungs; their
noise-rule Q is 4–8, `claude/docs-lines-3:docs/lines/codecs.md` §AV1 harvest). If an arm's worst-frame e_N/σ
is not bracketed by its ladder, one rung outward is added and listed (the only extension allowed).

Cells: 13 × 8 = 104 on `dbts_b1`, 13 × 9 = 117 each on A and C, plus the checks' cells (§S8): **338**.

### S5 · Fixtures

As `lab/av1/fetch_data.sh` writes them against `lab/av1/data.json` (`docs/FIXTURES.md` §AV1 data):

| set | system · depth | frames · size | what a result may claim |
| --- | --- | --- | --- |
| `dbts_a1` | A · 12 (cut to 10) | 56 × 1142 × 1785 | this volume, in the cut form |
| `dbts_b1` | B · 10 | slices 9–40 of 50 × 2560 × 3328 | those 32 slices |
| `dbts_c1` | C · 12 (cut to 10) | 69 × 976 × 2513 | this volume, in the cut form |

**Limits.** One volume per system, all three from the one EA1141 dataset; the quality study found system A's
anchor spread over Q 4–8 across five volumes, so a verdict here is these volumes', not a system's. No lossless
breast ultrasound cine or ABUS exists among the fixtures: nothing here speaks for them, and TRUS is not run (the
protocol's shard 2 covers it). No full-depth (12-bit) arm is coded: the product codes D > 10 by the cut, and the
protocol's shard 2 holds the 12-bit cells.

### S6 · What is measured

**Per cell,** the protocol's §6.1–§6.3 unchanged (bytes per unit, the quality study's `measure()` per frame, frame
headers), plus **ν = σ_out ÷ σ**: σ_out is the same noise estimator `measure()` applies to the source, applied to
the decoded frame, in-window; ν is its median over frames. ν near 1 says the frame kept the source's noise; it is the
measure audit F4 names for "how much noise each Q keeps". Also recorded: `--q-hist` per cell, and the count of shown
frames not coded from their own source (filtered keyframes and `show_existing_frame` units, §6.3).

**Equal quality, the quality line's metric.** The quality line's anchor is e_N/σ ≤ 1 on every frame (quality study
§Terms; the noise rule's P1). For each stream, x(Q) = worst-frame e_N/σ and y(Q) = ln bytes over its ladder, keeping
rungs up to the first with x ≥ 1.02 (above it the plateau, 1.02–1.05, no longer resolves Q: audit F4). If x is not
strictly increasing over the kept rungs, the stream is "not monotone" and only its integer point is read. Otherwise:

* **B₁**, the anchor bytes: exp of the PCHIP interpolant of y against x, read at x = 1.00.
* **The integer point**: the highest integer Q with x ≤ 1.00, and its bytes. This is what an ingest would code;
  it is reported, and decides nothing, since adjacent integer rungs differ by about 15–20 % in bytes (§S1).
* **ν₁**: ν interpolated in the same way at x = 1.00.
* **At the 1.03 bar** (the owner's open decision 1, `claude/docs-lines-3:docs/lines/codecs.md`): the integer
  point only, since 1.03 sits on the plateau.
* **Secondary:** BD-rate on median in-window PSNR as the protocol's §7 computes it, over the two curves' overlap
  within the ladder (the VL interval reaches below these ladders on B); reported, decides only Q4.

**ε**, from the data, as §7 does: for O G 1 and O G 16 on each volume, B₁ recomputed with each kept rung dropped in
turn; ε is the largest |ln change| over both streams and three volumes, as a percentage.

**Decode in order,** with the protocol's §6.5 drivers unchanged (`decode.mjs`, `decode.js`, the profiles run's
`decoders.js`): one unit in flight, the clock from handed in to the shown frame written, each frame hashed against
native dav1d 1.5.4. **Streams timed**, each at its own **matched rung** (its integer point): O G 1 twice (O and O′,
the A/A), O G 8, O G 16, AT G 16, AF G 16, AU G 16 — seven per volume. **Decoders:** WebCodecs
`{ hardwareAcceleration: "prefer-software", optimizeForLatency: true }` on every stream, since all are 10-bit (the
product's route); dav1d-WASM, one thread, `max_frame_delay` 1 (the product's fallback). **A unit:** a fresh decoder
off the clock, then the stream's first 32 shown frames in order. **Figures:** mean per shown frame, median, 95th
percentile, slowest, and the slowest frame's position in its group.

### S7 · Decision rule

**Saves at equal quality,** per (arm, G) on DBT: saving > ε on all three volumes, and the guards hold on all three.
**Guards,** each against O G 1 on the same volume, each margin one integer rung of O G 1's own curve at its
crossing, read from the data: ν₁ no lower than O G 1's ν₁ minus O G 1's change in ν over that rung; JOD and the
first window's ≥ 2-level share as §7's quality guard, at the integer point.

**Recommended** if it saves at equal quality and, at its matched rung, WebCodecs's in-order ratios to O G 1 (mean
and 95th percentile per frame, paired by round, median over rounds) have 95 % upper bounds ≤ 1 + a, a the half-width
of that volume's A/A interval. dav1d-WASM's ratios are reported beside it; a failure there is named, not decisive.
**Filtered arms** (AT, AD, AF, AW) show and reference temporally averaged frames: they can be recommended only if
the owner answers yes to "may the OQ view be temporally denoised" (decision 4, `claude/docs-lines-3:docs/lines/codecs.md`
§Open). Until then each is reported as "would be recommended" or not. O at G > 1 and AU need no such
answer (each shown frame is coded from its own source; AU's must be confirmed by Q5's e_N/σ reading).

**Among recommended** streams the largest saving wins; within ε, the simpler in the order O < AU < AW < AT < AD <
AF, then the smaller G. **If none is recommended, G 1 and lag 0 stay for DBT** on these fixtures, and Q3–Q7 say why.

**Stopping.** The run ends when every planned cell and ≥ 10 decode rounds are written, or at its time limit with
§S9's cuts. Nothing is re-run to change an outcome; the one ladder extension of §S4 is the only cell added. A decode
round with a hash miss voids that round; fewer than 10 rounds void that volume's decode verdicts; an A/A interval
wholly beyond ±ln 1.05 voids that volume's decode cells, reported. Every void and cut is listed.

### S8 · Interleaving, repeats, host, and the checks

**Interleaving.** Cells run in a Williams order over (arm, G, Q) per volume (`lab/scripts/order.py`). Encodes are
deterministic (checked below), so order touches only times, which are reported and never compared across arms. Decode
rounds: one fresh Chromium a round; volumes in a Williams row; within a volume the seven units in that round's
Williams row (`lab/order.mjs`); the two decoders alternate first and second by round. Paired by round against O G 1.

**Repeats.** One encode per cell (deterministic). Decode ≥ 10 rounds, as many as fit, at 1× only.

**Host.** One 4-core, 15 GB cloud host per shard, headless, software decode, no GPU or phone. Shard 1 saturated on
**memory**, not CPU, for `dbts_b1`'s lookahead cells (about 3.0 GB an `aomenc` at lag 39, 3–4 in flight); the
scheduler's 13.5 GB budget stays. The cut forms of A and C are smaller frames and should run four in flight. Each
shard reports cores busy (CPU ÷ wall), peak memory as `ps` reads it, and claims nothing past its host.

**Checks** (to `rows/groups-settings-K.checks.json`; each is mutated, and the mutation must change what it says):

| check | expected | mutation |
| --- | --- | --- |
| arms are the table | `arms.py`'s flag lists for AF, AU, AW differ from AD, AT, AT by exactly the flags of §S4 | drop `--arnr-strength=0` from AU: the check fails |
| reproduction | O G 16 and AT G 16 at Q 8 on `dbts_b1` byte-identical to `rows/groups-1.jsonl` | `--cpu-used=5`: differs |
| Q1 strength | AT at strength 4 and 6 = AT | strength 3: differs |
| Q2 G 1 | AT and AF at G 1 = O G 1 at Q 8 | G 2: differs |
| AU's filter off | AU ≠ AT at Q 8 G 16 (else strength 0 did nothing and AU is void) | — (a tie is reported) |
| AF's delta-q acts | AF ≠ AD at Q 8 G 16; `--q-hist` entries reported (lookahead zeros read as §Groups shard 1 reads them) | — (a tie: AF void, "delta-q inert under pinned q") |
| the cut | `depth_cut` on [0, 1, 2, 5, 6, 4093, 4094, 4095] = [0, 0, 1, 1, 2, 1023, 1023, 1023] (its own test); O G 1 at Q 0 on the cut form, reconstructed c · 4, within [−2, +1] of the source on every sample | reconstruct as c · 2: fails |
| per-group form | AT G 16 Q 8 on `dbts_a1` coded one encoder per group (the ingest's way) byte-identical to the whole-volume encode | — (a difference is reported; then every cut-form stream is coded per group, as the product does) |
| equal quality | B₁ on synthetic curves with a known crossing reads it to 0.1 %; ln bytes offset by ln 0.9 reads −10.0 % | x reversed: the sign flips |
| ν | ν of the source against itself 1.000; of a frame with its noise replaced by zero (S of §5) < 0.3 | estimator fed the source twice: ν = 1 on S, check fails |
| determinism | AU and AF at Q 8 G 16 coded twice: identical | `--cpu-used=5`: differs |
| decode | every timed frame equal to native dav1d's (hash), on both decoders; WebCodecs' output format 10-bit; A/A within ±5 % on the first volume | one hash altered: the round voids; a 12-bit stream fed to WebCodecs: refused |

### S9 · Settings shards

| shard | series | cells | CPU s (est.) | setup h | encode h | decode h | total h (est.) |
| --- | --- | --: | --: | --: | --: | --: | --: |
| S1 | `dbts_b1` (slices 9–40) | 104 + checks | 104 × 272 Mpx × 0.95 ≈ 26 900 | 0.5 | 2.5 (3 in flight) | ≤ 1.0 | ≤ 4.0 |
| S2 | `dbts_a1`, `dbts_c1` (cut form) | 234 + checks | 117 × (114 + 169) Mpx × 0.95 ≈ 31 500 | 0.5 | 2.2 (4 in flight) | ≤ 1.0 | ≤ 3.7 |

0.95 CPU s a megapixel a cell is shard 1's measured mean (0.81 over its `dbts_b1` cells, *derived* from its 23 675
CPU s) raised for this amendment's larger share of lookahead cells (*estimated*). Setup is shorter than the
protocol's, since `lab/av1/groups/` exists: S1 adds AF, AU and AW to `arms.py`, the cut form and ν to `cell.py`,
B₁ to `collect.py`, and the checks above, each with its mutation and inside `scripts/comment_budget.sh`; S2 pulls that
code. **Cuts if a shard would pass 4.5 h**, in this order, each listed: AW; then AD; then the G 32 streams; then the
decode unit shortened to its first 16 frames. Q6, Q9 and Q8's G 32 clause then read "not run".

**Running one.** On `claude/av1-groups-settings`: the protocol's §Running one setup (tools, fetch, decoders, venvs),
`git checkout origin/claude/oq-depth-cut -- ingest/coded-frames/ingest.py` into a scratch path for `depth_cut`
(imported, not copied into the product tree), then `lab/av1/groups/shard.sh settings-K`. Rows:
`rows/groups-settings-K.checks.json`, `rows/groups-settings-K.jsonl`, `rows/groups-settings-K.decode.json`. Push
after the checks, then hourly, `git pull --rebase` first. Its section, at the end of this file:
`### Settings shard K, measured (date)`, with the five plain lines, the host, the checks table, every cell, and every
cut or void. The collector (S2's session, or a third) writes `## Settings amendment, measured (date)`: the cells, B₁
and ν₁ with ε, the integer points at 1.00 and 1.03, the decode table, Q1–Q12 each held or refuted with its deciding
numbers, and §S7's verdict.

### S10 · What the result would change, and what it cannot settle

**For the product (G per modality, decided 2026-11-09 by measurement).**

* **O at G 8 or 16 recommended:** G for DBT becomes that G, with lag 0 unchanged; `lossy_args` and the client's
  G > 1 path stay as built, and the PCS note (codecs line Open 5) says so. No structural change.
* **AU recommended:** the OQ ingest's argument set gains lookahead and hidden frames. The product's group model
  survives ([A1]: one shown frame per temporal unit), but a unit may carry several coded frames and the slowest
  frame sets cine (§2.6). That is a structural change, proposed to the owner, not made here.
* **A filtered arm "would be recommended":** nothing changes until the owner's decision 4. A yes also needs a new
  noise rule, since the rule's Q assumes every shown frame is the source coded at one step.
* **None:** G 1 and lag 0 stay for DBT on these fixtures, and the confound the 2026-11-10 decision names is closed
  for them: the low-delay settings did not hide a saving at the quality line's equal quality.
* **Q10 refuted:** the depth cut costs fidelity at the anchor, which reopens its own line (`claude/oq-depth-cut`).

**What it cannot settle:** whether any of these streams is visually lossless (readers, the quality study's §6);
whether the filter's removed noise mattered diagnostically (the noise-ratio protocol's model observer); any DBT
system beyond one volume each, any other dataset, breast ultrasound cine or ABUS; libaom at other speeds, tunes or
two passes, or another encoder; hardware decoders, phones, or any host but these.

**Sources, added.**

* [H] J. Han et al., *A Technical Overview of AV1*, arXiv:2008.06091v2 (8 Feb 2021), §II.B "Alternate Reference
  Frame", read 2026-11-10 from `arxiv.org/pdf/2008.06091v2` (SHA-256 `57f5654f…7c45`).
* [L1] as above, the libaom 3.15.1 tarball, its SHA-256 checked against `ingest/tools.sh` on 2026-11-10:
  `av1/arg_defs.c`, `av1/av1_cx_iface.c:255-360`, `av1/encoder/temporal_filter.c:169-181, 815-860, 936-952,
  1260-1375, 1590-1655`, `av1/encoder/temporal_filter.h:44-85`, `av1/encoder/ratectrl.c:199-209`,
  `av1/encoder/encodeframe.c:346-350, 2336-2342`, `av1/common/quant_common.c` (the 10- and 12-bit AC tables).

### Settings shard 1, choices (written before any cell was read)

*Row GROUPS-SETTINGS-MEASURE, 2026-11-10. Where §S1–§S9 leave a choice open, this session made it here, before
reading any result, and the section that follows reports under these choices.*

1. **Which shard.** This session runs S1 (`dbts_b1`, slices 9–40) and writes the code S2 pulls. S2 (`dbts_a1`,
   `dbts_c1`, cut form) runs after it if the session lasts; otherwise it is owed. Predictions "on every volume" read
   on `dbts_b1` alone are reported as **held on B / refuted on B**, never as held.
2. **Where the checks run.** The `dbts_b1` checks (reproduction, Q1, Q2, AU ≠ AT, AF ≠ AD, determinism, ν) are their
   own encodes at Q 8 in `checks_settings.py`, before any cell. The cut and per-group checks run on `dbts_a1` here,
   so that S2 starts from a tested form. Q1 and Q2 are decided from these encodes; S2 repeats them on A and C.
3. **ν.** σ_out is `quality.sigma` (the estimator σ is read with) on the decoded frame, luma, over the *source*
   frame's in-window samples (the mask σ uses), back at the source's depth (c · 4 on the cut form). ν per cell is the
   median over frames of σ_out ÷ σ; ν on S is the noise proxy's decode (O G 1 Q 32) read the same way.
4. **B₁.** Rungs in increasing Q, kept up to and including the first with x ≥ 1.02. "Not monotone" if x is not
   strictly increasing over the kept rungs; "not bracketed" if 1.00 lies outside their x. PCHIP of ln bytes (and of
   ν, for ν₁) against x, read at 1.00.
5. **The one extension.** Below the ladder if every rung reads x > 1.00, above it if every rung reads x < 1.00; the
   next integer Q (`dbts_b1`: Q 5 or Q 15). Q 13 is not added: 1.00 is bracketed by 12 and 14 when it falls there.
6. **ε.** For O G 1 and O G 16, B₁ re-read with each kept rung dropped in turn and §S6's rule re-applied to the
   rest (so the next rung up becomes the bracket when the top one is dropped); a drop that leaves 1.00 unbracketed
   is listed and not counted. In S1, ε is `dbts_b1`'s alone and provisional.
7. **Guard margins.** "One integer rung of O G 1's own curve at its crossing": the two kept rungs that bracket
   x = 1.00. ν margin: |ν(lower) − ν(upper)|. JOD and ≥ 2-level margins as §7's `guard()`: O G 1's integer point
   and the next rung up.
8. **Q4's overlap.** In-window PSNR BD-rate (`bd.py`) with the interval set to the two curves' overlap over all
   ladder rungs, the noise proxy excluded.
9. **Decode.** 20 rounds (≥ 10 asked, "as many as fit" bounded by the session); each timed stream at its integer
   point at 1.00 (its matched rung). "Slowest ÷ median" is per round, median over rounds. The 12-bit refusal is
   tried on one 12-bit stream of `dbts_a1` (O G 1 Q 8, 16 frames).
10. **Mutations not in the harness's main path** (the decode hash and the 12-bit refusal) are run as their own
    rounds after the timed ones and written to `rows/groups-settings-1.decode-checks.json`.
