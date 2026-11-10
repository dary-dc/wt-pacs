# AV1 encoder settings: every flag the AV1 line used, and why

*Row ENCODER-SETTINGS, 2026-11-10. Research and theory only: nothing was encoded, decoded or timed for this file.
Every statement of what a setting does quotes the encoder's source or the AV1 specification at the version the lab
pins (§Sources). A consequence worked out here is marked *derived*, and a claim nobody checked is marked *unverified*.
A number not marked either way is quoted from the measured row that is named beside it.*

**The answer, short.** Yes, one group of settings may have decided a result. The optimal-quality (OQ) view is coded
with no lookahead (`--lag-in-frames=0`), and that one value switches off three libaom tools: the temporal filter,
the alt-ref frames it feeds, and the temporal dependency model (TPL). `--min-q = --max-q = Q` also takes away
libaom's usual way of paying for an alt-ref, a finer quantizer on the frames many others predict from. And
`--cpu-used=6` prunes the inter search. So the finding *G saves almost nothing at Q 8 on DBT* ([`../lines/codecs.md`](../lines/codecs.md))
is a finding about low-delay libaom at speed 6 with a pinned quantizer, not about inter coding as such. The
`claude/av1-groups` protocol already measures lookahead, alt-ref, TPL, keyframe filtering, an unpinned q, the
intra and real-time modes, and `--cpu-used=3` (§6 maps the overlaps). Three things it does not cover: libaom's
default delta-q (which goes with TPL), the alt-ref filter's own strength, and the in-loop filters' cost to decode.
Most other flags in `aomenc_args` only restate libaom's defaults, and they are listed as defaults below.

## Sources

Line numbers come from the libaom 3.15.1 release tarball that `ingest/tools.sh` pins by SHA-256
(`8ca0c527…d01bf`). The links point to the `v3.15.1` tag at gitiles. That the tag's files carry the same line
numbers as the tarball's is *unverified*.

* [L1] `av1/arg_defs.c`, the help text of every `aomenc` flag: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/arg_defs.c>
* [L2] `av1/av1_cx_iface.c`, the defaults (`default_extra_cfg`, `encoder_usage_cfg`) and how flags become the
  encoder's configuration: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/av1_cx_iface.c>
* [L3] `apps/aomenc.c`: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/apps/aomenc.c>
* [L4] `av1/encoder/ratectrl.c`: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/ratectrl.c>
* [L5] `av1/encoder/encode_strategy.c`: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/encode_strategy.c>
* [L6] `av1/encoder/temporal_filter.c`: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/temporal_filter.c>
* [L7] `av1/encoder/speed_features.c`: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/speed_features.c>
* [L8] `av1/encoder/encodeframe.c`: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/encodeframe.c>
* [L9] `av1/encoder/encoder.c` and `av1/encoder/encoder_utils.c`: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/encoder.c>,
  <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/encoder_utils.c>
* [L10] `av1/encoder/av1_quantize.c`: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/av1_quantize.c>
* [L11] `examples/svc_encoder_rtc.cc`: <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/examples/svc_encoder_rtc.cc>
* [S] AV1 Bitstream & Decoding Process Specification, `github.com/AOMediaCodec/av1-spec` at `5e04f3f75e73`
  (the same commit `claude/av1-groups:docs/av1/groups.md` cites as [A1]): `06.bitstream.syntax.md`,
  `07.bitstream.semantics.md`, `08.decoding.process.md`.
* [J] OpenJPH 0.31.0, `src/apps/ojph_compress/ojph_compress.cpp` (tag commit `c68064d0`):
  <https://github.com/aous72/OpenJPH/blob/0.31.0/src/apps/ojph_compress/ojph_compress.cpp>

## 1 · The invocations

| name here | where (branch tip read) | encoder | the results it made |
| --- | --- | --- | --- |
| **OQ** | `aomenc_args` in `claude/av1-quality-profiles:lab/av1/profiles/bytes.py` at `1232918d`; the same flags, without its alt-ref branch, as `lossy_args` in `claude/oq-ingest:ingest/coded-frames/ingest.py` at `36508b0a` | `aomenc` 3.15.1 | the profiles bytes run; the quality study (`claude/av1-quality-metrics`), the noise point (#317), the window study, the groups arm O, all of which call `aomenc_args` unchanged; the OQ ingest and its demo bytes |
| **OQ alt-ref arm** | `aomenc_args(…, altref=True)`, the same file | `aomenc` 3.15.1 | the profiles run's secondary arm (`results/altref.jsonl`) |
| **Lossless** | `encoder_args` in `ingest/coded-frames/ingest.py` (on `main` at `5952559a`, the same as on `claude/core` at `2e6fa5b2`) | `aomenc` 3.15.1 | every lossless AV1 series and measurement since LLSIZE: the presets by content of [`../FIXTURES.md`](../FIXTURES.md) §From DICOM |
| **SVC** | `lab/av1/delivery/scalable/shape/shape.py` and `lab/av1/delivery/scalable/encoder/svc_encoder_rtc.patch` (on `main` at `5952559a`, the same on `claude/av1-svc-preview` at `34d70cfc`) | libaom 3.15.1's `examples/svc_encoder_rtc`, patched | the scalable shapes and the SVC preview |
| **Residual** | `lab/av1/delivery/residual/encode.py` (`main` at `5952559a`; `claude/av1-residual-apart` at `6a2994f8` differs only in `--shift`) | `aomenc` 3.15.1 | rows PREVIEW and 17 and RESIDAPART: the residual design, now dropped |
| **HTJ2K** | `HTJ2K_ARGS` in `ingest/coded-frames/ingest.py`; the same four flags in `bytes.py`, `shape.py` and `encode.py` | `ojph_compress` 0.31.0 | every exact series, and the denominator of every "of HTJ2K" ratio |

## 2 · The OQ view: `aomenc_args`

```
aomenc --ivf --good --cpu-used=6 --threads=1 --passes=1 --tune=psnr --end-usage=q --cq-level=Q --min-q=Q --max-q=Q \
       --deltaq-mode=0 --aq-mode=0 --denoise-noise-level=0 --lag-in-frames=0 --auto-alt-ref=0 \
       --kf-min-dist=G --kf-max-dist=G   (G = 1: --kf-max-dist=0)   --monochrome --profile=P --bit-depth=D --input-bit-depth=D
```

The harness adds `--limit=N --q-hist=64 --disable-warning-prompt`, and the ingest adds `-q`. The alt-ref arm
replaces the lag pair with `--lag-in-frames=19 --auto-alt-ref=1`. Where a reason was recorded, it is the profiles
README's §5 *Codings* on `claude/av1-quality-profiles` at `1232918d`, which calls these "these knobs and no
others". That section gives one reason for the whole set and none for most single flags.

### 2a · What each flag does, its default, and why the lab set it

| flag | what it does (quoted) | libaom's default (quoted) | why the lab set it |
| --- | --- | --- | --- |
| `--good` | "Use Good Quality Deadline" (L1:166) | good already: `aomenc` zeroes its options (`memset(global, 0, …)`, L3:626) and `#define AOM_USAGE_GOOD_QUALITY 0u` (`aom/aom_encoder.h:1027`); *derived* | "G = 1 uses the same `--good` mode, so G alone differs between arms" |
| `--cpu-used=6` | "Speed setting (0..6 in good mode, 5..12 in realtime mode, 0..9 in all intra mode)" (L1:315-317) | `0, // cpu_used` (L2:256) | no reason recorded for the lossy view. Row PREVIEW used `--cpu-used=6`, and the lossless preset for tomosynthesis is `good:6`, chosen as "the fastest, in the encode-time measurement (queue row ENC), within 2 % of the slowest's bytes" ([`../FIXTURES.md`](../FIXTURES.md)). That choice was made on lossless bytes |
| `--threads=1` | "Max number of threads to use" (L1:207) | `0, // g_threads` (L2:5158). How libaom reads 0 is *unverified* | POCGAP (queue row 66): "`--threads=4` changes bytes 0.02–0.06 % a frame (so `--threads=1` is pinned)", measured lossless |
| `--passes=1` | "Number of passes (1/2/3)" (L1:161) | two: "Make default AV1 passes = 2 until there is a better quality 1-pass encoder" (L3:731-738) | no reason recorded |
| `--tune=psnr` | "Distortion metric tuned with" (L1:305); the choices are `psnr`, `ssim`, three `vmaf` variants, `butteraugli`, `vmaf_saliency_map`, `iq`, `ssimulacra2` (L1:42-54) | `AOM_TUNE_PSNR,  // tuning` (L2:276): the flag restates the default | no reason recorded |
| `--end-usage=q` | "Rate control mode" (L1:257-258); `q` is `AOM_Q` (L1:36-40) | `AOM_VBR,      // rc_end_usage` (L2:5188) | a fixed quantizer per rung: "The owner's 'qualities' are rungs of Q" (profiles README §Names) |
| `--cq-level=Q` | "Constant/Constrained Quality level" (L1:310-311); mapped as `rc_cfg->cq_level = av1_quantizer_to_qindex(extra_cfg->cq_level);` (L2:1267). The table runs 4 a step to 62 → 249, 63 → 255 (L10:1040-1046) | `10, // cq_level` (L2:282) | the rung |
| `--min-q=Q --max-q=Q` | "Minimum (best) quantizer", "Maximum (worst) quantizer" (L1:260-261). In Q mode the frame's q is the lower bound, clamped between them: `*bottom_index = clamp(active_best_quality, rc->best_quality, rc->worst_quality); q = *bottom_index;` (L4:2158-2163) | `0, // rc_min_quantizer`, `63, // rc_max_quantizer` (L2:5192-5193) | "meant to hold every frame's quantizer at Q, so that intra and inter are compared at one step". Measured held: "every main-arm `--q-hist` entry at Q" on 700 cells |
| `--deltaq-mode=0` | "Delta qindex mode (0: off, 1: deltaq objective (default), … --deltaq-mode=1 requires --enable-tpl-model=1" (L1:559-564) | `DELTA_Q_OBJECTIVE, // deltaq_mode` (L2:305) | no reason recorded beyond the set's one: one step across every frame |
| `--aq-mode=0` | "Adaptive quantization mode (0: off (default), 1: variance 2: complexity, 3: cyclic refresh)" (L1:555-558) | `NO_AQ, // aq_mode` (L2:304): restates the default | as above |
| `--denoise-noise-level=0` | "Amount of noise (from 0 = don't denoise, to 50)" (L1:535-537) | `0,   // noise_level` (L2:365): restates the default | none recorded. The run checks it: `film_grain_params_present` 0 on every stream, and a mutation with `--denoise-noise-level=25` reads 1 |
| `--lag-in-frames=0` | "Max number of frames to lag" (L1:223-224) | `35,  // g_lag_in_frames` (L2:5175), and in good mode "if (oxcf->mode == GOOD && gf_cfg->lag_in_frames >= 32 && gf_cfg->lag_in_frames < 39) gf_cfg->lag_in_frames = AOMMIN(39, MAX_LAG_BUFFERS);" (L2:1446-1448), so 39 | "Lag 0 and alt-ref off make every temporal unit one shown frame, decoded in display order — the product's group model (frame-groups §5c)". The lossless line had a second reason: "The lab found inter inexact at 10 and 12 bits with alt-ref on and exact with it off" ([`gop-theory.md`](gop-theory.md)) |
| `--auto-alt-ref=0` | "Enable automatic alt reference frames" (L1:299-300) | `1, // enable_auto_alt_ref` (L2:257) | as for the lag |
| `--kf-min-dist=G --kf-max-dist=G` | "Minimum keyframe interval (frames)", "Maximum keyframe interval (frames)" (L1:278-281). Equal values turn the automatic placement off: `kf_cfg->auto_key = cfg->kf_mode == AOM_KF_AUTO && cfg->kf_min_dist != cfg->kf_max_dist;` (L2:1386-1387) | `0, // kf_min_dist`, `9999, // kf_max_dist` (L2:5208-5209) | G is the variable of the comparison. Measured: "keyframes exactly at the multiples of G and one temporal unit a frame on every stream" |
| `--kf-max-dist=0` (G 1) | as above, and "// Disable key frame filtering in all intra mode. if (cfg->kf_max_dist == 0) { kf_cfg->enable_keyframe_filtering = 0; }" (L2:1395-1398) | — | G 1 |
| `--monochrome` | "Monochrome video (no chroma planes)" (L1:228-229); [S]: "**mono_chrome** equal to 1 indicates that the video does not contain U and V color planes." | `0, // monochrome` (L2:5213) | grey series. The ingest's 4:0:0 against 4:2:0 grey is measured at +0.20–0.23 % bytes for 4:2:0, lossless ([`payload-format.md`](payload-format.md)) |
| `--profile=P` (0, or 2 at 12 bits) | "Bitstream profile number to use" (L1:208); [S] seq_profile table: "0 \| 8 or 10 \| Yes \| YUV 4:2:0"; "2 \| 12 \| Yes \| YUV 4:2:0, YUV 4:2:2, YUV 4:4:4"; "Monochrome can only be signaled when seq_profile is equal to 0 or 2." | `0, // g_profile` (L2:5159) | forced by the depth |
| `--bit-depth=D --input-bit-depth=D` | "Bit depth for codec", "Actual bit depth of input source" (L1:196-198) | `AOM_BITS_8`, `8` (L2:5166-5167) | the source's depth: the smallest of 8, 10 and 12 that holds it (`claude/oq-ingest:docs/av1/payload-format.md` §Optimal quality) |
| `--ivf --limit --q-hist -y -q` | "Output IVF"; "Stop encoding after n input frames"; "Show quantizer histogram (n-buckets)"; "Display warnings, but do not prompt user to continue"; "Do not print encode progress" (L1:183, 164, 185-186, 193-194, 169) | — | container and diagnostics. None of them is a coding decision: *derived* from their text. `-y` was needed because "aomenc 3.15.1 stops at min-q = max-q with 'Warning: Bad quantizer values…' and waits for a key" (profiles README) |
| RGB only: `--bit-depth=8 --profile=0 --color-primaries=bt601 --transfer-characteristics=bt601 --matrix-coefficients=bt601` | "Color primaries (CICP) of input content", likewise the other two (L1:610-622) | — | row 17's 4:2:0 conversion. These flags only label the stream: the lab converts the colour itself (`preview_rgb`), *derived*. The OQ ingest refuses RGB |

### 2b · The theory of each flag's effect, its fit for an offline encode, and what it may have biased

"Offline" means the PCS encodes a series once, at ingest, with no real-time limit. The OQ view's own constraints
are three. Every frame decodes from its group's keyframe through the units in order. Each temporal unit holds one
shown frame. The view is judged at a fixed fidelity against the source, by the noise rule now and by readers later.

| flag | bytes · quality · decode cost · comparisons across G and Q (theory) | fit for the offline OQ view | results it may have biased |
| --- | --- | --- | --- |
| `--good` | Good mode runs libaom's full rate-distortion search. It also leaves loop restoration on: "1: true (default in non-realtime mode)" (L1:350-353). The other modes (`--allintra`, `--rt`) are arms I and R of the groups protocol | fits | none known. Prediction P8 of the groups protocol puts `--allintra` within ±3 % of G 1 |
| `--cpu-used=6` | Speed 6 prunes the search. Among its settings: `sf->intra_sf.intra_y_mode_mask[TX_32X32] = INTRA_DC;`, `sf->inter_sf.selective_ref_frame = 6;`, `sf->inter_sf.prune_single_ref = is_boosted_arf2_bwd_type ? 0 : 4;`, `sf->rd_sf.perform_coeff_opt = is_boosted_arf2_bwd_type ? 6 : 8;` (L7:1474-1508, `if (speed >= 6)`). At a pinned Q the step is fixed, so a slower speed mostly buys bytes at a similar error (*derived*). Pruned reference and mode searches act on inter blocks, so speed 6 can understate G's gain (*derived*; arm O3 measures it at Q 8). Effect on decode: *unverified* | **the weakest fit**. Encode time is what speed buys, and offline the PCS has time. The lossy encode time per frame at speeds 0–5 is not measured. Lossless `good:6` takes 3.3 s a frame ([`../FIXTURES.md`](../FIXTURES.md)) | every OQ byte count, so the OQ view at 0.07–0.22 of HTJ2K's bytes; every G gain at equal Q; the curves of bytes against Q in the quality and noise-point studies (the Q they pick depends on the step, not the speed, so the Q is likely unaffected: *derived*) |
| `--threads=1` | Bytes are reproducible, and differ by 0.02–0.06 % a frame at 4 threads (POCGAP, lossless). One thread makes no tiles, `0, // tile_columns` (L2:265), so the stream's decode does not depend on this flag (*derived*) | fits. Offline, parallelism comes from several groups or series at once (the ingest's `--jobs`) | none |
| `--passes=1` | A first pass gathers statistics for keyframe and golden-frame placement and for rate allocation. With q pinned and the keyframes fixed by G, little is left for it to change (*derived*; *unverified* in bytes) | fits. Two passes cost encode time only, which offline can afford | small or none (*unverified*) |
| `--tune=psnr` | Rate-distortion by squared error, the measure that PSNR and e_N/σ also use. The quality study judges a PSNR-tuned encoder with squared-error measures plus JOD, so a perceptual tune would likely score worse on PSNR and could score better on JOD or with readers (*unverified*). How a perceptual tune treats noise texture is *unverified* | fits the noise rule, because the rule is in sample units. Whether another tune is closer to visually lossless at fewer bytes is a question for readers | the mapping from Q to quality in the quality study and the noise point holds only for `psnr` |
| `--end-usage=q --cq-level=Q` | Q mode ignores bitrate. Each frame's q comes from cq-level and its frame type, then is clamped to the min and max (L4:2133-2171). Q maps to qindex 4Q up to 62. Q 0 gives qindex 0, which [S] defines as lossless when the delta-q terms are 0 (`LosslessArray[ segmentId ] = qindex == 0 && DeltaQYDc == 0 && …`, `06.bitstream.syntax.md`). These flags set none of those terms, so the ingest's "Q is any of 0–63" makes Q 0 a lossless stream labelled lossy (*derived*) | fits | none |
| `--min-q=Q --max-q=Q` | Holds every frame at step Δ(Q). That is the noise rule's premise, one step for a whole series, and it makes G the only difference between arms. It also takes away libaom's usual way of paying for an alt-ref: a finer q on a frame many others predict from (`claude/av1-groups:docs/av1/groups.md` §2.4, *unverified* under `--end-usage=q`; arm AQ measures it) | **fits the view's contract** (uniform fidelity, per-series Q). It does not fit a test of alt-ref, where it removes half of the mechanism | the alt-ref arm's verdict "smaller … but not at equal quality" was reached with q pinned |
| `--deltaq-mode=0` | Off: no per-superblock q. The default `1` acts only through TPL: `} else if (cpi->oxcf.q_cfg.deltaq_mode == DELTA_Q_OBJECTIVE && cpi->oxcf.algo_cfg.enable_tpl_model) { // Setup deltaq based on tpl stats` (L8:346-350); "Note objective delta_q and tpl eligible frames are only altref frames currently." (L8:2339-2340). At lag 0, TPL never runs (below), so in O this flag likely changes nothing (*derived*; *unverified* byte for byte). With lookahead it does matter, and it also selects TPL's other path: the rate-distortion multiplier on ARFs, only `cpi->oxcf.q_cfg.deltaq_mode == NO_DELTA_Q` (L8:519-523) | **fits** while fidelity is meant to be uniform. A per-superblock q would make the step, and so e_N/σ, vary inside a frame | none in O. In the groups arms AT and AD, which keep it at 0, AD is not "libaom's own defaults for all four knobs" in full, because the default pairs TPL with objective delta-q (§6) |
| `--aq-mode=0` | Restates the default: no adaptive q | fits, for the reason above | none |
| `--denoise-noise-level=0` | Restates the default. At a level above 0, libaom denoises the source and signals film-grain parameters to be re-synthesised at decode. [S] then lets a decoder's output differ from the reference: "a conformant decoder shall produce output frames that are in the same order and do not have perceptually significant differences with the frames produced by the reference film grain synthesis process" (`08.decoding.process.md`, option 2). Film grain also adds a decode pass (*derived*) | **must stay 0**: the patient's noise would be replaced by synthetic noise, and the output would not be the same on every decoder | none: checked 0 on every stream |
| `--lag-in-frames=0` | No lookahead, and so: no temporal filter, `return oxcf->algo_cfg.arnr_max_frames > 0 && oxcf->gf_cfg.lag_in_frames > 1;` (L6:1653-1654); no TPL, `int allow_tpl = oxcf->gf_cfg.lag_in_frames > 1 && oxcf->algo_cfg.enable_tpl_model;` (L5:877-878); and no filtered keyframe, since filtering runs only where `av1_is_temporal_filter_on(oxcf)` (L5:746-750). Every reference is a past decoded frame. **Bytes:** a filtered reference holds less of the noise that intra must still pay for. The groups theory bounds what it can save while the view keeps the noise at about 3–15 % (`claude/av1-groups:docs/av1/groups.md` §2.5, *derived*). **Quality:** a filtered frame "replaces the source": `frame_input->source = tf_buf;` (L5:802). If an alt-ref is shown directly (`show_existing_frame`) or a keyframe is filtered, the frame on screen is a temporal average, not this slice coded at Q. **Decode:** the hidden frames' work lands on a few units, so frame times are uneven (groups §2.6). **Comparisons:** every equal-Q G comparison so far ran without lookahead | **open: the main question of this row.** Offline, lookahead costs only memory and encode time. The product's group model survives it: [S] "Each temporal unit must have exactly one shown frame", so frame i still decodes from units k … i (*derived*). Whether a shown filtered frame passes the fidelity bar is the open part (groups P5) | *G saves almost nothing at Q 8 on DBT* ([`../lines/codecs.md`](../lines/codecs.md) §State now); the profiles run's G gains at equal Q; the OQ demo's G 8 and G 16 bytes (within −1.2 to +0.2 % of G 1 at Q 8); the quality study's G 16 gains. So also any choice of G for DBT made from them. None has been made yet |
| `--auto-alt-ref=0` | No alt-ref frames. At lag 0 there is nothing to filter, so the flag likely restates what the lag already forces (*derived*; arm I sets the lag alone) | as for the lag | as for the lag |
| `--kf-min-dist=G --kf-max-dist=G` | A fixed group of G frames, each group opening with a shown keyframe. bytes.py encodes a whole series in one run, while the OQ ingest runs one encoder per group. A keyframe resets what decoding depends on, so the two should give the same bytes (*derived*). The demo reproduced the profiles ratios at Q 8 to three digits, which agrees. **Across G:** at G 1, `--kf-max-dist=0` also turns keyframe filtering off (L2:1395-1398). In any arm with lookahead, G 1 and G > 1 then differ by a keyframe filter as well as by G (*derived*): this matters to groups arm AD, not to O | fits | none in O |
| `--monochrome` | No chroma is coded or decoded. Lossless, 4:2:0 grey costs +0.20–0.23 % more bytes | fits | none |
| `--profile`, `--bit-depth`, `--input-bit-depth` | Twelve bits require profile 2, and WebCodecs refuses 12 bits ([`../lines/codecs.md`](../lines/codecs.md)), so a 12-bit view decodes through dav1d-WASM at 1.9–4.7 HTJ2K frames. **Across depths, Q is not one quality:** Δ(8) is 57 sample units at 12 bits and 15.3 at 10 (`claude/av1-groups:docs/av1/groups.md` §2.1). A Q chosen on system B (10-bit) is not comparable with the same Q on A or C (12-bit) without σ, which is why the noise rule works in σ | fits. The depth cut, coding 12 bits as 10 so WebCodecs can decode them, is a separate design ([`../lines/optimal-quality.md`](../lines/optimal-quality.md) Open 7) | comparisons of Q across systems A, B and C without σ |
| diagnostics, RGB labels | none on coding (*derived*) | — | none |

## 3 · Settings the OQ view leaves at libaom's default that bear on it

These flags appear in no invocation. The view therefore runs with libaom's good-mode values, quoted from L2's
`default_extra_cfg`. Whether each tool is actually used in the OQ streams (CDEF strength, loop-restoration type,
tiles) is *unverified*: no frame header has been read for it. `claude/av1-groups:lab/av1/groups/headers.py`
reads frame headers and could be extended to read these.

| setting | what it does (quoted) | default | theory for the OQ view |
| --- | --- | --- | --- |
| `--enable-cdef` | "Enable the constrained directional enhancement filter (0: false, 1: true (default), …)" (L1:345-349) | `1, // enable_cdef` (L2:287) | An in-loop smoothing filter that the encoder tunes per frame. It can remove noise texture beyond what the quantizer removed, and it costs decode time on every frame (*derived*). Decode time is AV1's weak point here: the lossy view decodes in 1.05–2.04 HTJ2K frames through WebCodecs ([`../lines/codecs.md`](../lines/codecs.md)) |
| `--enable-restoration` | "Enable the loop restoration filter (0: false (default in realtime mode), 1: true (default in non-realtime mode))" (L1:350-353) | `1, // enable_restoration` (L2:288). Speed 6 keeps it, apart from `disable_loop_restoration_chroma` and the Wiener search refinement (L7:1283, 1461; *unverified* that luma is kept) | as for CDEF |
| `--enable-qm`, `--qm-min/max` | "Enable quantisation matrices (0: false (default), 1: true)" (L1:470-472) | `0, // enable_qm` (L2:292) | Off, every coefficient of a block shares one step: the flat quantizer the noise rule's Δ(Q) assumes. On, high frequencies get a coarser step, which removes more fine-band noise at the same Q and breaks the mapping from Q to Δ (*derived*) |
| `--enable-tpl-model` | "RDO based on frame temporal dependency (0: off, 1: backward source based); required for --deltaq-mode=1" (L1:330-333) | `1, // enable_tpl_model` (L2:268) | inert at lag 0 (§2b); arm AT of the groups protocol |
| `--enable-keyframe-filtering` | "Apply temporal filtering on key frame (0: no filter, 1: filter without overlay (default), 2: filter with overlay - experimental, may break random access in players)" (L1:334-340) | `1, // enable_keyframe_filtering` (L2:269) | inert at lag 0; arm AD. In the alt-ref arm it was on: that arm's keyframes at Q 8 were 31.6–305.9 kB against O's 91.2–467.8 kB (`claude/av1-groups:docs/av1/groups.md` §1) |
| `--arnr-maxframes`, `--arnr-strength` | "AltRef max frames (0..15)", "AltRef filter strength (0..6)" (L1:301-304) | `7, // arnr_max_frames`, `5, // arnr_strength` (L2:270-271) | inert at lag 0. With lookahead, these two set how much the filter averages, so how much noise a filtered reference or shown frame loses. No arm varies them (§6) |
| `--tile-columns` | "Number of tile columns to use, log2" (L1:325) | `0, // tile_columns` (L2:265) | One tile, so dav1d's threads cannot split a frame. Lossless, four tile columns cost +0.1–0.4 % bytes and cut one frame's decode to 0.37–0.44 of its time with 3 threads ([`README.md`](README.md), DECSPEED). For the lossy view this is *unverified* |
| `--sharpness` | "Bias towards block sharpness in rate-distortion optimization of transform coefficients and (in all intra mode only) reduce block edge filtering for better sharpness (0..7), default is 0" (L1:289-293) | `0, // sharpness` (L2:260) | could keep more fine texture at the same Q (*unverified*) |
