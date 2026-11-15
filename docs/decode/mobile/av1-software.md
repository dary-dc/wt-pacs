# AV1 in software on a phone's browser

*Queue row MOBILE-OPT-AV1-SOFTWARE, 2026-11-15, option 1 of MOBILE-DECODE-OPTIONS' brief
(`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendments 19 and 20): AV1 in software (WebCodecs
`prefer-software`, dav1d-WASM), what bounds it on a phone and what settings are left, worked out as its advocate, then
its disadvantages. Theory and sources; nothing run on a device, a GPU or a coder. Every choice stays the owner's.*

Labels, as [`new-options.md`](new-options.md): **(S)** a source quoted verbatim, listed in §9 with its revision;
**(R)** a result of this repository, by its file; **(D)** derived here, the arithmetic written out; **(T)** theory,
not measured. Fixtures behind every (R): three timed DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`),
19 DBT volumes for bytes; no ultrasound cine; 4-core cloud hosts without a GPU, headless Chromium, software decode;
one Android 16 phone (Chrome 157), one home link, one evening, three decoders, its core count not recorded.

## 1. What it shows

* **It is the one route that is checked, at full precision, on every engine today.** A software decoder hands the
  page the decoder's own planes, so the frame check and window/level run on the samples (≤ 10 bits, or the depth
  cut's 10-bit codes). Chromium's WebCodecs runs dav1d with its Arm assembly under `prefer-software` (§2, S); where
  WebCodecs refuses (Safari's 10-bit frames, Firefox for Android), dav1d-WASM gives the same samples (R).
* **On the phone it is what bounds the fill** (R): 133–135 ms a frame on `dbts_b1-q8-g8` (8.5 Mpx, 10 bits) with three
  decoders, about 22 frames a second, 0.76–0.94 of every fill. Once a frame is decoded and stored it is never decoded
  again (the OPFS cache, decided), so the decode bounds the fill and asks made during it, not scrolling after it.
* **Settings are left, none measured on a phone** (§4): the decoder count against the cores; `optimizeForLatency`
  (today it switches dav1d's frame threads off); 2 × 2 tiles (0.64–0.72 of a frame's decode on the cloud host, R;
  waiting on the owner); loop filters off in the encode; an 8-bit view; a threaded dav1d-WASM.
* **Its best case, theory** (§5): 2 × 2 tiles, if the cloud factor held on the phone, would take `dbts_b1`'s decode
  floor from 2.25 s to 1.44–1.62 s; the phone's spare cores, which no run recorded, decide whether it holds.
* **Its cost** (§6): the phone's CPU at full load for the whole fill (energy and heat unmeasured), dav1d-WASM 1.86–2.89
  HTJ2K frames on the cloud host where WebCodecs refuses, and a page frozen when hidden stops decoding.

## 2. The route as the product runs it

**What the page asks** (R, `client/decode/av1-webcodecs.js` on `claude/docs-client`): every AV1 decoder is configured
`{ codec, hardwareAcceleration: "prefer-software", optimizeForLatency: true }`; the downloader runs
`Math.min(3, navigator.hardwareConcurrency || 3)` decoders (`client/transport/downloader.js:23`).

**What the specification gives** (S, WebCodecs WD 2026-11-09 §7.9): "prefer-software Indicates that the User Agent
SHOULD prefer a software codec implementation. User Agents may ignore this value for any reason." Its own example of
when to ask for it: "a good example of using "prefer-software" would be if an author is especially sensitive to the
higher startup latency or decreased robustness generally associated with hardware acceleration." And §7.6:
"optimizeForLatency … Hint that the selected decoder SHOULD be configured to minimize the number of
EncodedVideoChunks that have to be decoded before a VideoFrame is output."

**What Chromium runs** (S, Chromium `main` at `aa345ede`):

* The software AV1 decoder is dav1d: `enable_dav1d_decoder = use_blink` and `enable_av1_decoder =
  enable_dav1d_decoder` (`media/media_options.gni:112, 157`); the factory adds
  `std::make_unique<OffloadingDav1dVideoDecoder>(media_log->Clone())` under `BUILDFLAG(ENABLE_DAV1D_DECODER)`
  (`media/renderers/default_decoder_factory.cc:149–152`). dav1d is pinned at `4e3ab21f` (`DEPS:2137–2138`).
* On Arm it carries dav1d's assembly: `sources += arm64_asm_sources` for `current_cpu == "arm64"`
  (`third_party/dav1d/BUILD.gn:249–250`), with separate `-DBITDEPTH=8` and `-DBITDEPTH=16` builds (`:186, :216`).
* `prefer-software` never reaches a hardware decoder: under `kPreferSoftware` the support check refuses any codec that
  is not `IsDecoderBuiltInVideoCodec` (`third_party/blink/renderer/modules/webcodecs/video_decoder.cc:308–313`); the
  broker's gate is cited in [`../hardware.md`](../hardware.md).
* `optimizeForLatency` becomes `low_delay` (`video_decoder.cc:363–365`, `return config.hasOptimizeForLatency() &&
  config.optimizeForLatency();`), and `low_delay` sets dav1d's frame delay to one: "We only want 1 frame thread in low
  delay mode, since otherwise we'll require at least two buffers before the first frame can be output. if
  (low_delay) { s.max_frame_delay = 1; }" (`media/filters/dav1d_video_decoder.cc:103–107`).
* **Threads a decoder gets** (`media/filters/davxd_video_decoder_base.cc:46–63, 347–355`): for `coded_height >= 700`,
  `*tile_threads = 4` and `*frame_threads = 3`; then `n_threads = VideoDecoder::GetRecommendedThreadCount(frame_threads
  * (tile_threads + 1))`, which clamps "to the number of available logical processors/cores" and to
  `kMinVideoDecodeThreads = 2` … `kMaxVideoDecodeThreads = 16` (`media/base/video_decoder.cc:49–63`,
  `media/base/limits.h:97–98`).

  (D) For `dbts_b1` (coded height 3328): 3 × (4 + 1) = 15 threads wanted, so min(15, N) on an N-processor phone; at
  N = 8, 8 threads a decoder and 3 × 8 = 24 threads for the product's three decoders, on 8 processors.
* **What one dav1d does with them** (S, dav1d `4e3ab21f`, `include/dav1d/dav1d.h:79–80`): "int n_threads; ///< number
  of threads (0 = number of logical cores in host system, default 0)", "int max_frame_delay; ///< Set to 1 for
  low-latency decoding (0 = ceil(sqrt(n_threads)), default 0)"; `src/lib.c:124–125`: `*n_fc = s->max_frame_delay ?
  umin(s->max_frame_delay, *n_tc) : *n_tc < 50 ? fc_lut[*n_tc - 1] : 8; // min(8, ceil(sqrt(n)))`. So with
  `optimizeForLatency` one frame is in flight per decoder, and its threads share that one frame.
* **One frame, one tile** (S, AV1 spec, §Definitions): "Tile A rectangular region of the frame that can be decoded and
  encoded independently, although loop-filtering across tile edges is still applied." The product codes one tile
  (`ingest/coded-frames/ingest.py` `lossy_args` sets no `--tile-columns`); one tile is legal at this size (§Symbols:
  `MAX_TILE_WIDTH 4096`, `MAX_TILE_AREA 4096 * 2304`; D: 2560 ≤ 4096 and 2560 × 3328 = 8 519 680 ≤ 9 437 184).
  (T) A tile's symbols are one serial entropy-decoding stream, so a one-tile frame with one frame in flight leaves
  dav1d's threads only the stages after it (reconstruction and the post-filters, which dav1d 0.8.2 gave "their own
  threads", S, `NEWS:261`). The product's parallelism on the phone is its three decoders.

**dav1d-WASM, where WebCodecs refuses** (R, `client/decode/wasm/build/inside.sh` on `claude/docs-client`): dav1d 1.5.4
built with `-Denable_asm=false` and `-msimd128`, one thread (`client/decode/av1-dav1d.js`: `M._av1_open(d.threads ??
1)`; no `-pthread`). dav1d has no WebAssembly assembly to enable: its `is_asm_enabled` lists `aarch64`, `arm`,
`ppc64le`, `riscv`, `loongarch`, `x86` and `x86_64` only (S, `meson.build:69–76`); for `wasm` it adds only "enable
atomics + bulk-memory features" (`meson.build:223–226`). So the SIMD is the compiler's, from C.

## 3. What bounds it on a phone

**Measured** (R, [`../../client/evidence/fill-bound-on-phone.md`](../../client/evidence/fill-bound-on-phone.md)):
`dbts_b1-q8-g8`, 50 frames of ~460 KB, three decoders, 12 loads a cell:

| link | controller | fill | decode floor | floor ÷ fill | a frame's decode |
| --- | --- | --- | --- | --- | --- |
| tether | `cubic-restart` | 2.87 s | 2.45 s | 0.91 | 135 ms |
| Wi-Fi | `cubic-restart` | 2.62 s | 2.35 s | 0.91 | 133 ms |

(D) 1000 ÷ 135 = 7.41 frames a second a decoder; × 3 = 22.2 a second; 50 × 135 ÷ 3 = 2 250 ms, the floor's order.
8 519 680 samples × 22.2 = 189 M samples a second decoded. The wire was 0.5–1.0 s of it.

**Against the cloud host** (R, [`../../client/evidence/decode-speed-of-the-optimal-quality-picture.md`](../../client/evidence/decode-speed-of-the-optimal-quality-picture.md)
§Protocol C): one WebCodecs decoder alone on `dbts_b1` Q 8, 1×, is 1.74 of the product's HTJ2K frame (57.1 ms), so
(D) 1.74 × 57.1 = 99.4 ms, with up to four cores to itself. The phone's 135 ms is one of three decoders sharing the
phone; the two are not one quantity, and the phone's per-decoder speed alone is unmeasured.

**What the bound is made of** (T): the entropy decode of one tile per frame per decoder (serial), so a decoder's
frame time is set by one core's speed; three decoders use three such cores at a time. Which cores they land on (an
Android phone's CPUs are of two or three kinds) and whether a fourth decoder would gain are not recorded:
[`fill-bound-on-phone.md`](../../client/evidence/fill-bound-on-phone.md) §Where the phone saturates claims nothing past
three decoders, and neither does this file.

**Other series** (T): if decode time scaled with samples alone, `dbts_c1` (976 × 2513 = 2 452 688, 0.288 of
`dbts_b1`) would decode in 0.288 × 135 = 38.9 ms a frame, `dbts_a1` (1142 × 1785 = 2 038 470, 0.239) in 32.3 ms. W ÷ Hp
rises as Q falls (R, §Protocol C), so bytes count too; neither is measured on a phone.

## 4. The settings that are left

| lever | today | source | measured | on the phone |
| --- | --- | --- | --- | --- |
| decoders per page | `min(3, hardwareConcurrency)` | HTML §10.2.7: the getter "must return a number between 1 and the number of logical processors potentially available to the user agent" (S) | — | not varied (R) |
| `optimizeForLatency` | `true`: one frame in flight a decoder (§2) | dav1d.h: `0 = ceil(sqrt(n_threads))` frames (S); at 8 threads `fc_lut[7]` = 3 (D) | confounded with the flush: "−7 to −20 %" compared arms that differed in both (R) | unmeasured |
| tiles | one | AV1 §Definitions (S); aomenc `--tile-columns`, `--tile-rows` "Number of tile columns to use, log2" (S); Chromium assumes 4 tile threads at ≥ 700 lines (§2) | 2 × 2: decode 0.64–0.72×, bytes 1.0001–1.0065×; not ready by its quality rule; waits (the owner, 2026-11-13) (R) | unmeasured |
| post-filters in the encode | libaom's defaults (CDEF and loop restoration on) | AV1 §Sequence header OBU semantics: "enable_cdef equal to 0 specifies that cdef filtering is disabled", "enable_restoration equal to 0 specifies that loop restoration filtering is disabled" (S); aomenc `--enable-cdef`, `--enable-restoration` (S) | — | unmeasured; bytes and quality too |
| an 8-bit view | ≤ 10 bits | dav1d `bitdepths` "Enable only specified bitdepths", choices `8`, `16` (S); Chromium builds both (§2) | 1.14–1.86× today's bytes at its highest Q under 1.00 (R, DEPTH8-MEASURE) | decode unmeasured |
| Q and G | Q 8, G 8 (the demo's form) | — | W ÷ Hp rises as Q falls; G > 1 decode-timed only on low-delay streams (R) | one form |
| dav1d-WASM threads | one | the deploy template sets `Cross-Origin-Opener-Policy same-origin` and `Cross-Origin-Embedder-Policy require-corp` (R, `deploy/nginx/wt-pacs.conf.template:23–24`), so a threaded build can run | WebCodecs 1.4–1.9× faster than one-thread dav1d-WASM (R) | unmeasured |

Each, as its advocate would put it (T):

* **`optimizeForLatency: false` for the fill.** A fill decodes every frame of a group in order; frame threads let one
  decoder pipeline consecutive frames of a group, and with one tile they are the only intra-decoder parallelism left.
  The cost is up to `n_fc` frames of output delay (3 at 8 threads), which an ask during the fill would pay. One
  decoder configured each way (a fill decoder and an ask decoder) is the form to test, not a default.
* **Tiles.** They give dav1d's per-frame threads work; on a phone whose cores the three decoders already fill, they
  shorten a frame (an ask) more than the fill. Both depend on the spare cores.
* **Post-filters off.** CDEF and loop restoration run on every sample after reconstruction; turning them off saves
  their decode at a cost in bytes or quality at equal Q that nothing here has measured.
* **8 bits.** dav1d's 8-bit and 16-bit paths are separate builds; an 8-bit sample takes half the SIMD lane of a 16-bit
  one, so the 8-bit path may be faster. It costs bytes (R, above) and the depth: an 8-bit view is a further cut.
* **A threaded dav1d-WASM.** The page is cross-origin isolated already; the WASM route serves Safari and Firefox for
  Android, the engines where WebCodecs refuses.

## 5. Its best case (theory)

On `dbts_b1-q8-g8`, three decoders, starting from the measured 135 ms (R):

* **2 × 2 tiles**, if the cloud factor transferred: 135 × 0.64 = 86.4 ms to 135 × 0.72 = 97.2 ms a frame; the floor
  50 × 86.4 ÷ 3 = 1 440 ms to 50 × 97.2 ÷ 3 = 1 620 ms, from 2 250 ms. It holds only if the phone has cores the three
  decoders leave idle; the run did not record the core count.
* **An ask during the fill at G 8** costs the decodes from its group's keyframe: to frame k of a group, k + 1 decodes;
  the worst is 8 × 135 = 1 080 ms, the mean over k = 0 … 7 is 4.5 × 135 = 607.5 ms, behind the decoder's queue. After
  the fill an ask costs no decode (the cache).
* **dav1d-WASM on a phone**, if the cloud ratio transferred: 135 × 1.4 = 189 ms to 135 × 1.9 = 256.5 ms a frame. The
  ratio was measured against Chromium's x86 assembly; against its Arm assembly it is unknown.

For reference only, not a target: a 30-frames-a-second cine shows a frame every 33.3 ms; the fill's 22.2 decoded
frames a second is below it, so a cine started during the fill of this series waits on the decode.

## 6. Its disadvantages

* **The fill is the decode** on the phone (R), and decode time grows with bytes (lower Q) and samples.
* **Energy and heat**: three decoders keep several cores busy for the whole fill; nothing here measures a phone's
  battery or a sustained run's slowdown (T).
* **Engines that refuse**: Safari gives no exact 10-bit WebCodecs frame and Firefox for Android has no `VideoDecoder`
  (R, [`../../client/evidence/browser-decode-routes.md`](../../client/evidence/browser-decode-routes.md)); there the
  route is dav1d-WASM at 1.86–2.89 HTJ2K frames on the cloud host (R).
* **12 bits never**: Chromium refuses 12-bit AV1 at the key-frame check (R, `browser-decode-routes.md`); a D > 10
  series is always its depth cut (decided).
* **A hidden page stops decoding**: one load's keyframes took 17.6–18.1 s inside one decode call (R,
  [`../../client/evidence/hidden-page-decode.md`](../../client/evidence/hidden-page-decode.md)).
* **Oversubscription**: Chromium's thread rule was written for one decoder playing one video ("Recommended by
  YouTube", S, `davxd_video_decoder_base.cc:44–45`); three decoders ask for up to three times the processors (§2, D).

## 7. The comparison's columns

| column | AV1 in software |
| --- | --- |
| decode time on a phone | **measured**: 133–135 ms a frame on `dbts_b1-q8-g8` (8.5 Mpx, 10 bits), three decoders, one phone; ~22 frames a second; dav1d-WASM unmeasured on a phone |
| bytes | the view's: ~460 KB a frame on `dbts_b1-q8-g8` (R); HTJ2K is 4.6–14× the view's on these fixtures (the brief) |
| precision on screen | the stored depth D ≤ 10, or the depth cut's 10-bit codes (rounding error ≤ 2^(D−11)) |
| checked | yes by construction: the decoder's planes reach the page (`copyTo`, or dav1d-WASM's output), so XXH3-64 runs on them; whether every view frame is checked is #368's, the owner's |
| window/level and tools | all functional: the paint has the samples |
| ships today | yes: built and run in Chromium on the phone; dav1d-WASM wherever WebCodecs refuses |
| what a phone cell must measure | §8 |

## 8. What a phone cell must measure

Each on `dbts_b1-q8-g8` unless named, interleaved with today's form, recording `navigator.hardwareConcurrency`:

1. The decoder count, 1 to `hardwareConcurrency`: a frame's decode and the fill; where the phone saturates.
2. `optimizeForLatency: false` against `true`, at three decoders: a frame's decode, the fill, an ask's latency.
3. One decoder alone, the phone idle: a frame's decode with no contention (the number §3 lacks).
4. A sustained run (the series filled again and again for minutes, the screen on): a frame's decode against time.
5. dav1d-WASM on the phone, one thread: a frame's decode against WebCodecs on the same frames.
6. Only once the owner lifts the tiles' wait, or as a series built for the round: 2 × 2 tiles, and an 8-bit view, each
   against today's form.

## 9. Sources

Fetched 2026-11-15; SHA-256 prefix of the copy read.

| source | revision | where | SHA-256 |
| --- | --- | --- | --- |
| WebCodecs, W3C Working Draft | <https://www.w3.org/TR/2026/WD-webcodecs-20261109/> | §7.6 VideoDecoderConfig, §7.9 Hardware Acceleration | `0fa152953edb` |
| Chromium `media/filters/dav1d_video_decoder.cc` | `main` at `aa345ede3fb87b32cf7975d351d0d6ae3d749163` (2026-11-15) | 90–116 | `bd41ddccf7ce` |
| Chromium `media/filters/davxd_video_decoder_base.cc` | the same | 41–63, 345–357 | `246fd0000402` |
| Chromium `media/base/video_decoder.cc` | the same | 39–63 | `ee086b2ec0a7` |
| Chromium `media/base/limits.h` | the same | 96–101 | `7db39f96cc18` |
| Chromium `media/media_options.gni` | the same | 112, 157 | `f3abb053f986` |
| Chromium `media/renderers/default_decoder_factory.cc` | the same | 149–152 | `4b808bab6d40` |
| Chromium `third_party/blink/renderer/modules/webcodecs/video_decoder.cc` | the same | 304–313, 363–365 | `55d926ef10a0` |
| Chromium `third_party/dav1d/BUILD.gn`; `DEPS` | the same | 181–186, 211–216, 238–251; DEPS 2137–2138 | `855545b101e9` |
| dav1d `NEWS` | <https://code.videolan.org/videolan/dav1d> at `4e3ab21fbbf84a4bd283ea27f96287fcd7c228c1` (Chromium's pin) | 1.5.4, 1.0.0, 0.8.2 entries | `4020f6980838` |
| dav1d `include/dav1d/dav1d.h` | the same | 78–80 | `dbc211a0f548` |
| dav1d `src/lib.c` | the same | 109–126 | `969f8ef9b5d7` |
| dav1d `meson.build`; `meson_options.txt` | the same | 69–77, 223–226; 3–6 | `0d237fdbedb1`; `673b03bdd965` |
| AV1 Bitstream & Decoding Process Specification | <https://aomediacodec.github.io/av1-spec/>, "Last modified: 2023-05-25" | §Definitions (Tile), §Symbols and abbreviated terms, §Sequence header OBU semantics | `acf58a3fdb82` |
| libaom `av1/arg_defs.c` | <https://aomedia.googlesource.com/aom> `v3.15.1` (`44d0a57786f432d933ff64b653347c66f4d0fa1d`) | 325–327, 345–353 | `9f0a8ad3363e` |
| HTML Standard, Web workers | <https://html.spec.whatwg.org/multipage/workers.html>, "Last Updated 14 November 2026" | §10.2.7 Concurrent hardware capabilities | `662332721827` |
