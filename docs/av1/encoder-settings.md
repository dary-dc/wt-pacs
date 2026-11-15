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

## 4 · The lossless payload: `encoder_args`

```
aomenc --ivf --lossless=1 --bit-depth=B --input-bit-depth=B --kf-max-dist=0 --threads=1 --profile=P <preset> \
       [--tune-content=screen --sb-size=64]   (the optimized representation)   --monochrome | <RGB labels>
```

The ingest runs this once a frame (`--limit=1`). `<preset>` is `--cpu-used=0` (`cpu0`), `--cpu-used=N` (`good:N`)
or `--allintra --cpu-used=N` (`allintra:N`), the preset by content of [`../FIXTURES.md`](../FIXTURES.md) §From DICOM.

| flag | what it does (quoted) | default | why the lab set it | theory, fit, and what it may bias |
| --- | --- | --- | --- | --- |
| `--lossless=1` | "Lossless mode (0: false (default), 1: true)" (L1:343-344); `rc_cfg->best_allowed_q = extra_cfg->lossless ? 0 : …`, likewise the worst (L2:1263-1266); "Only --aq_mode=0 can be used with --lossless=1." (L2:908-910) | `0, // lossless` (L2:286) | the exact form | q 0 on every frame. [S] makes a block lossless by `qindex == 0` with no delta-q. Bytes, not quality, are the only variable. This is the exact form, not the OQ view: it is kept outside the top ([`../lines/codecs.md`](../lines/codecs.md)) |
| presets `cpu0`, `good:6`, `allintra:6`, `allintra:7` | `--cpu-used` as in §2a; `--allintra`: "Use all intra mode" (L1:168), and `aomenc` then forces one pass: "Enforcing one-pass encoding in all intra mode" (L3:751-754) | speed 0, good mode | "AV1's preset defaults by content to the fastest, in the encode-time measurement (queue row ENC), within 2 % of the slowest's bytes" ([`../FIXTURES.md`](../FIXTURES.md)) | Measured, not theory: within 2 % of the slowest preset's bytes. Results stated at `cpu0` and at `good:6` differ for that reason. The decode-settings measurement found no encoder setting that cuts a lossless frame's decode by more than 10 % ([`README.md`](README.md), DECSPEED) |
| `--kf-max-dist=0` | as §2a, and it turns keyframe filtering off (L2:1395-1398) | 9999 | every frame alone (G 1) | Lag and alt-ref are left at their defaults (35, raised to 39, and 1), but each run codes one frame as a keyframe, so neither can act (*derived*) |
| `--threads=1` | as §2a | 0 | POCGAP: bytes change by 0.02–0.06 % a frame at 4 threads | none |
| `--tune-content=screen` | "Tune content type" (L1:628); values `default`, `screen`, `film` (L1:105-110). In good mode it sets `features->allow_screen_content_tools = 1;` and `features->allow_intrabc = … 1` (L9 `encoder.c`:2449-2452) | `AOM_CONTENT_DEFAULT` (L2:309) | "plus `--tune-content=screen --sb-size=64` for 0–1 %" (LLSIZE, [`README.md`](README.md)) | Screen tools add palette and intra block copy ([S]: "**allow_intrabc** equal to 1 indicates that intra block copy may be used in this frame."). They pay on few-valued content, and the 0–1 % gain is measured. Their effect on decode is *unverified* |
| `--sb-size=64` | "Superblock size to use" (L1:637); `if (oxcf->tool_cfg.superblock_size == AOM_SUPERBLOCK_SIZE_64X64) { return BLOCK_64X64;` (L9 `encoder_utils.c`:962-963) | `AOM_SUPERBLOCK_SIZE_DYNAMIC` (L2:317) | as above | Smaller superblocks give finer partitions. Decode: "No encoder setting cuts it by more than 10 %: presets, 64² superblocks, and every optional intra tool off" (DECSPEED) |
| `--monochrome`, or for RGB 4:4:4 `--color-primaries=bt709 --transfer-characteristics=srgb --matrix-coefficients=identity` | §2a; [S]: "If matrix_coefficients is equal to MC_IDENTITY, it is a requirement of bitstream conformance that subsampling_x is equal to 0 and subsampling_y is equal to 0." | — | the code's own note: "Identity under BT.709 primaries and the sRGB transfer is AV1's RGB signal: WebCodecs reports no matrix." | Labels only, and they must be 4:4:4. Since the reversible colour transform became the RGB representation (LLSIZE), the colour work is done before the encoder |

## 5 · The SVC encoder: `svc_encoder_rtc`, patched

```
svc_encoder_rtc -o OUT -lm MODE -sl S -tl T -b 600000×S -bl 600000,… --min-q=0 --max-q=0 -k KEY -sp 7 -d D \
                --profile=P --layer-q=q1,q2,… [--monochrome] [-r SCALES] IN.y4m
```

The patch changes only the example's command line: 12 bits, `--profile`, `--monochrome`, `--layer-q` and `--rgb`
(`lab/av1/delivery/scalable/encoder/build.sh`: "the example's CLI only, the library untouched"). Everything else the
example decides for itself, and it decides for real time:

| setting | quoted from L11 | theory, fit, and what it may bias |
| --- | --- | --- |
| usage real time | `#define GOOD_QUALITY 0` (:46); `cfg.g_usage = AOM_USAGE_REALTIME;` (:1903) | The real-time mode's search, not good mode's. The same example builds for good quality with `GOOD_QUALITY` set to 1 (:1888-1890), which no run tried |
| constant bitrate, far above need | `cfg.rc_end_usage = AOM_CBR;` (:1906); `-b`/`-bl` at `KBPS = 600_000` a layer, "far above any lossless frame, so rate control never drops one" (`lab/av1/delivery/scalable/encoder/svc.py`) | With `--layer-q` setting each layer's min and max q (the patch: `svc_params.max_quantizers[i] = svc_params.min_quantizers[i] = (int)q;`), rate control has nothing left to decide (*derived*). The check that every frame came out exact confirms no frame was dropped |
| no lookahead | `cfg.g_lag_in_frames = 0;` (:1915) | as §2b: no temporal filter, no TPL |
| speed 7 | `-sp 7`, "Speeds 7 (the example's default) and 10" (`lab/av1/delivery/scalable/encoder/README.md`) | the slowest speed the run used |
| intra tools off | "// Settings to reduce key frame encoding time." then `AV1E_SET_ENABLE_CFL_INTRA, 0`, `AV1E_SET_ENABLE_SMOOTH_INTRA, 0`, `AV1E_SET_ENABLE_ANGLE_DELTA, 0`, `AV1E_SET_ENABLE_FILTER_INTRA, 0`, `AV1E_SET_INTRA_DEFAULT_TX_ONLY, 1` (:2060-2065) | **Bytes, measured:** "L1T1 at speed 7 is 1.067 of HTJ2K on fluoroscopy, 1.102 on MR and 1.581 on the ultrasound — above `aomenc`'s slowest intra (1.024, 1.034, 1.117)" (same README). Every SVC shape is compared with single-layer lossless from this same encoder (0.968–1.003), a fair test of the layering. But **SVC against HTJ2K or against `aomenc` lossless carries the example's real-time handicap**: that bears on "the payload keeps lossless AV1's size at this encoder's speed: 0.94 … to 1.59 … of HTJ2K's bytes" and on the decision to keep SVC outside the top |
| other tools fixed | `AV1E_SET_ENABLE_CDEF, 1`, `AV1E_SET_LOOPFILTER_CONTROL, 1`, `AV1E_SET_ENABLE_WARPED_MOTION, 0`, `AV1E_SET_ENABLE_OBMC, 0`, `AV1E_SET_ENABLE_GLOBAL_MOTION, 0`, `AV1E_SET_ENABLE_ORDER_HINT, 0`, `AV1E_SET_ENABLE_TPL_MODEL, 0`, `AV1E_SET_DELTAQ_MODE, 0`, `AV1E_SET_AUTO_TILES, 1` (:2036-2067) | Inter tools that are off cost the temporal-layer shapes' bytes (*derived*). The lossy base layers (q 20 / 40 / 60) were coded under these too |
| **fit for an offline encode** | — | None of the real-time choices is needed offline. If SVC is reopened, the first step is the example with `GOOD_QUALITY` 1 and its intra tools on |

## 6 · The residual design's encoder: `encode.py`

```
aomenc -q --ivf -o OUT --end-usage=q --cq-level=CRF --cpu-used=6 --limit=N <colour> --kf-min-dist=8 --kf-max-dist=8 IN.y4m
```

"CRF" here is `--cq-level`, CRF 8, 20, 32 and 44, G 8 (row PREVIEW's settings, `lab/av1/delivery/residual/README.md`).
No reason is recorded for any flag left out. The ones left out keep libaom's defaults, and those differ from the OQ
view in every respect §2b found important (*derived* from the defaults quoted in §2a):

| left at the default | value | what it can change |
| --- | --- | --- |
| `--passes` | two (L3:731-738) | keyframe and golden-frame structure, and rate allocation |
| `--lag-in-frames`, `--auto-alt-ref` | 35, raised to 39; and 1 | temporal filter, hidden alt-refs, filtered keyframes on: the preview frames are partly temporal averages |
| `--enable-tpl-model`, `--deltaq-mode` | 1, and objective | per-superblock q from TPL on alt-refs |
| `--min-q`, `--max-q` | 0 and 63 | each frame's q free around cq-level: alt-refs and keyframes finer than inter frames |
| `--threads` | 0 | bytes may depend on the thread count (POCGAP's 0.02–0.06 %) |

So whether the residual design's preview frames carried alt-refs, and at what q, was not recorded (*unverified*).
The residual made each frame exact whatever the preview was, so exactness holds. What the defaults can move is the
split of bytes between preview and residual: row 17's sum "0.947–1.002 of HTJ2K at each series' best CRF". Any
comparison of that sum with the profiles run's pinned-q lossy-plus-residual cells compares two encoder
configurations, not two designs. The residual design was dropped on 2026-11-09, so this bears only on the record.

## 7 · HTJ2K: `ojph_compress`

```
ojph_compress -i IN -o OUT -num_decomps 5 -block_size {64,64} -prog_order RPCL -reversible true
```

| flag | what it does (quoted from [J], `ojph_compress.cpp:542-569`) | default ([J]) | why the lab set it | theory, and what it may bias |
| --- | --- | --- | --- | --- |
| `-num_decomps 5` | "number of decompositions" | "(5)": restates the default | the served profile, "kept by the HTJ2K encoder-settings measurement (queue row HTJ2KENC) against 35 other settings" ([`../codecs/htj2k.md`](../codecs/htj2k.md)) | five wavelet levels, so six resolutions in each frame |
| `-block_size {64,64}` | "{x,y} (64,64) where x and y are the height and width of a codeblock" | 64 × 64: restates the default | as above | the unit of HT block decoding |
| `-prog_order RPCL` | "is the progression order, and can be one of: LRCP, RLCP, RPCL, PCRL, CPRL." | "(RPCL)": restates the default | as above; "RPCL with one layer puts each smaller resolution first, so a prefix of a frame is an exact smaller picture" ([`../codecs/htj2k.md`](../codecs/htj2k.md)) | only the order of the bytes changes: measured, LRCP's bytes equal RPCL's (HTJ2KENC) |
| `-reversible true` | "If this is 'false', an irreversible or lossy compression is employed, using the 9/7 wavelet transform; if 'true', a reversible compression is performed, where the 5/3 wavelet is used." | "Default value is 'false'." | lossless | The one flag here that is not a default. Every "fraction of HTJ2K" in the AV1 line divides by this profile. HTJ2KENC measured it against 35 others: "No setting is 0.5 % under the served profile on any series but the 256² PET", and "LRCP's bytes equal RPCL's on every cell" ([`../decode/README.md`](../decode/README.md) §Encoder settings). So the denominator is within 0.5 % of the best OpenJPH setting on those nine series |

## 8 · Where the studies differ, and what each difference can change

No one list of the studies' encoder settings existed. This one is built from each study's own text and code
(§1-§7). Rows that share a configuration are grouped.

| studies | encoder configuration | differs from the OQ view by | what the difference can change |
| --- | --- | --- | --- |
| profiles main arm; quality study; noise point; window study; groups arm O; OQ ingest | §2 | — (the OQ view) | Within this group: bytes.py feeds 4:2:0 with neutral chroma under `--monochrome`, while the ingest feeds 4:0:0. bytes.py codes a series in one run, the ingest one run per group. Neither should change the bitstream (*derived*); the demo's ratios agree to three digits |
| profiles **alt-ref arm** (`results/altref.jsonl`) | §2 with `--lag-in-frames=19 --auto-alt-ref=1` | lookahead 19, so the temporal filter, TPL and keyframe filtering run at their defaults (§3); q still pinned; `--deltaq-mode=0` | Shown keyframes were filtered frames (keyframe units 31.6–305.9 kB against 91.2–467.8 at Q 8), so it was "smaller … but not at equal quality". It tested lookahead and keyframe filtering together, with q pinned, at one G. A lag of 19 is under libaom's 32-frame maximum golden-frame interval (`MAX_GF_INTERVAL 32`, cited in groups §5), and how far an alt-ref can sit beyond the lookahead is *unverified* |
| groups arms L, A, AT, AD, AQ | §2 with lag 39 and the knobs of `claude/av1-groups:lab/av1/groups/arms.py` | as each arm states; all keep `--deltaq-mode=0` | §9 T1: AD is not libaom's whole default |
| residual design (rows PREVIEW, 17, RESIDAPART) | §6 | two passes, lookahead 39, alt-ref, TPL and keyframe filtering on, objective delta-q, q free in 0–63, threads unset | Its preview and residual bytes come from a different encoder configuration. Its residual totals do not compare with the profiles run's pinned-q cells (§6) |
| lossless: LLSIZE onward, the per-depth split, DBTSCALE | §4, with the preset by content or `cpu0` | lossless, so only bytes and decode move; preset `cpu0`, `good:6` or `allintra:6`/`7` | Bytes across presets differ by up to 2 % by construction (ENC's rule). DBTSCALE ran at `allintra` 7, LLSIZE at the slowest preset: compare their ratios only with the preset named |
| lossless groups (`gop-protocol.md`, rows CONTENT, BREAST) | §4 with G > 1, alt-ref off; alt-ref on at G 8 and 16 "used only where every frame is exact" | lossless, plus the alt-ref arm | "libaom 3.15.1 still temporally filters its alt-ref in lossless mode" ([`gop-theory.md`](gop-theory.md)). P6 was "refuted on system B; untestable on A and C", where alt-ref on was not lossless at all |
| POCGAP | libaom 3.8.2 and 3.15.1, cpu6, lossless | the libaom version, the thread count | "libaom 3.8.2 against 3.15.1 at cpu6 by 0.5–0.7" points, and 0.02–0.06 % a frame from threads: two reasons why a number from another libaom or thread count does not carry over |
| SVC shapes and preview | §5 | real-time mode, speed 7, intra tools and several inter tools off | SVC against HTJ2K or `aomenc` carries the real-time handicap (lossless single layer 1.067–1.581 of HTJ2K against 1.024–1.117) |

## 9 · Settings worth testing, and the measurement that would decide each

**Already covered by the groups protocol** (`claude/av1-groups:docs/av1/groups.md` §5; not duplicated here):
lookahead alone (arm L), filtered alt-ref (A), TPL (AT), keyframe filtering (AD), an unpinned q (AQ), all-intra (I),
real time (R), and `--cpu-used=3` at Q 8 (O3, AT3), with bytes, in-window PSNR, e_N/σ and JOD over the VL interval
and in-order decode per frame. Its predictions P4 (alt-ref at equal quality), P5 (keyframe filter), P6 (TPL), P8
(modes and speed) and P10 (decode) answer the owner's question about `--lag-in-frames=0 --auto-alt-ref=0`. The
tests below fill its gaps. Each runs on the groups protocol's fixtures, `dbts_a1`, `dbts_b1` (middle 32 slices)
and `dbts_c1`, and makes no claim beyond them. Each interleaves its variants (`CLAUDE.md` §Measurement) and names
the host's saturation.

| # | setting | the measurement that decides it | overlap with the groups protocol | worth it when |
| --- | --- | --- | --- | --- |
| T1 | `--deltaq-mode=1` with lookahead (libaom's real default pairs it with TPL) | arm AD with `--deltaq-mode=1`, G 16, Q 2–24: BD-rate against O G 1 and AD in the VL interval; the spread of per-superblock q, read from the frame headers' delta-q; each frame's e_N/σ, worst frame included | adds one arm to §5's table. Without it, "libaom's own defaults for all four knobs" leaves out the fifth | P4 finds that alt-ref gains |
| T2 | `--arnr-strength` 0–6, `--arnr-maxframes` | arm AT at G 16, Q 4–12, strength 0, 2, 5 (the default): the e_N/σ of shown and keyframes and BD-rate. It decides whether a weaker filter keeps the noise texture and the gain together | none: the protocol varies no filter strength | P4 or P5 finds that filtering costs fidelity |
| T3 | `--cpu-used` 0, 2, 4, 6 | O at G 1 and 16 across Q 4–12, plus CPU seconds per frame of encode: BD-rate against speed 6, and the encode time the PCS would pay | extends O3 and AT3 (Q 8 only, speed 3 only) to a ladder | always: this is the PCS's preset choice, made offline |
| T4 | `--enable-cdef=0`, `--enable-restoration=0` | first, cheaply, read the existing O streams' frame headers for CDEF and loop-restoration use at Q 4–12. If used: O G 1 with each filter off and both off, giving bytes, e_N/σ, JOD, and the time to decode a frame in dav1d-WASM and WebCodecs at 1× and 4× | none. P10 times decode but varies no decode-side tool | the headers show the filters on. Decode time is AV1's weak point here (1.05–2.04 HTJ2K frames through WebCodecs) |
| T5 | `--tune` `ssim`, `iq`, `ssimulacra2` against `psnr` | O G 1, Q 2–24: bytes against e_N/σ, in-window PSNR and JOD. A tune that wins on JOD at fewer bytes then goes to the readers' test (quality study §6) | none | the readers' test is scheduled. A tune change moves the mapping from Q to quality, so the noise rule would be refitted |
| T6 | `--passes=2` | O and AT at G 16, Q 4–12: bytes at equal Q (q pinned, so nearly equal quality) | none | cheap. Expected under 1 % (*derived*); dropped if it is |
| T7 | `--tile-columns` 1, 2 | O G 1 at Q 8: bytes, and the latency of one frame's decode with dav1d threads | the lossy form of DECSPEED's lossless result | a single frame's latency matters (a jump), not a fill's |
| T8 | `--enable-qm=1` | O G 1, Q 4–12: bytes and e_N/σ | none | last. It breaks the flat step that the noise rule's Δ(Q) assumes (§3) |

**Not worth testing:** `--denoise-noise-level` > 0. It replaces the patient's noise with synthesised grain, and
decoders need not agree on it (§2b). `--threads` is measured already (POCGAP). The SVC example's settings matter
only if SVC is reopened: the first step would then be its good-quality build with its intra tools on (§5).
