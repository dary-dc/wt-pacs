# Decode on a phone's browser: the options compared

*Queue row MOBILE-DECODE-COMPARE, 2026-11-15 (`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendments 19 and
20), by a session that wrote none of the option files. It compares the nine files beside it as they stand at
`claude/mobile-decode` `f4021c40`. It does not re-derive their numbers. Every number below is quoted from its option file,
which holds the arithmetic, the sources and the cells. Every choice stays the owner's.*

The question: **in a phone's browser, how can a series be shown fast enough, at full precision, with every frame
checked, and at what cost in bytes?**

Labels, as the option files use them: **(S)** a source quoted verbatim, listed in §7 with its revision; **(R)** a
result of this repository; **(M)** measured by an option row's own cloud cell; **(D)** derived; **(T)** theory, not
measured. Fixtures and limits: §8.

## 1. What it shows

* **Only software and GPU-compute routes are at full precision today.** No shipped engine returns a hardware decoder's
  samples above 8 bits, for any codec (`other-codecs.md` §1; S2 below). Three options keep the stored depth on every
  series and check every frame: HTJ2K in software, lossy HTJ2K, and HTJ2K in WebGPU compute. AV1 in software is full
  precision up to 10 bits and the depth cut above (`av1-software.md` §6: "a D > 10 series is always its depth cut";
  two of the three timed volumes, `dbts_a1` and `dbts_c1`, are 12-bit). Of the four, only AV1 in software has been
  timed on a phone (133–135 ms a `dbts_b1` frame, R). The other three are predicted at or near it (78–154 ms) or
  unknown. *Corrected 2026-11-15 (PR 397 §Review, blocker 1): this read "Four options keep the stored depth", counting
  AV1 in software among them.*
* **Hardware decode gets the check back only at 8 bits**: by `NV12` read-back on Safari (`other-codecs.md` §3: "8
  bits: samples back"; which decoder serves Safari's WebCodecs is unconfirmed, T), and by inverting the picture on
  Android Chromium and Firefox (`hw-inverted.md` §11: "It is needed only where samples do not come back: Android
  Chromium and Firefox."). *Corrected 2026-11-15 (PR 397 §Review, blocker 2): this read "and only by inverting the
  picture".* The inverted form is studio swing on 16…235 (7.78 bits, and fewer once the headroom the measured overshoot asks for is added), at
  1.16–2.49× today's bytes (M). Whether the map is one-to-one, and whether the decoder takes the frame at all, are
  device facts. HEVC, VP9 and H.264 are the same route with a decoder phones are more likely to have
  (`other-codecs.md`). Their bytes are unmeasured.
* **AV1 in hardware, unchecked, keeps every tool but fails the check.** Amendment 1 says "a path that paints but cannot
  be checked does not serve the view". So on its own it is not a candidate. It enters only as the composition
  new-options §6.1 names (§5 here), and that composition is the owner's call.
* **Two of the new options shrink on measurement** (M). Lossy HTJ2K gains no bytes over the AV1 view at equal error
  (median 1.05× at the noise rule's bar), and its WASM decode is slower than the lossless frame's (1.12–1.21×). The
  content's rectangle moves bytes by ×0.997–1.002 and gives a decode below 0.90 of the whole only on `dbts_b1` (0.85
  for AV1, 0.76 for HTJ2K).
* **The axis that separates the full-precision routes is bytes against the link**, not the check. The lossless HTJ2K
  routes send the exact series, 4.6–14.6× the view. The WebGPU route is wire-bound below ~382 Mbit/s of goodput against
  today's fill, and only "if the GPU decodes in ≤ 45 ms" (`gpu-compute-decode.md` §6, D); software HTJ2K below
  ~405–665 Mbit/s, where its own predicted decode binds (`htj2k-software.md` §1, D).
* **What the sources settle alone** is §3. **What only the phone settles** is §4: 19 asks, M4–M22, added one line each
  to `claude/phone-protocol:docs/phone-rows/next-round.md` §Decode-option cells beside M1–M3.
* **A leaning, labelled as one** (§6): keep the AV1 software view as the route of record. Run the phone's cheap asks
  in the next round. The decision then rests on three device numbers: HTJ2K's decode per frame (cell 1), the WebGPU
  decoder's time (M20), and whether a hardware frame inverts and checks (M1–M3, M6–M7).

## 2. The table

One row per option file. "Today" is the product as shipped: the 10-bit AV1 view, the exact HTJ2K series on request.

| option (file) | decode on a phone | bytes, against today's view | precision on screen | checked | window/level and tools | ships today |
| --- | --- | --- | --- | --- | --- | --- |
| AV1 in software ([`av1-software.md`](av1-software.md)) | **measured** 133–135 ms a `dbts_b1-q8-g8` frame, three decoders, ~22 frames/s (R); dav1d-WASM unmeasured on a phone | 1× (~460 KB a `dbts_b1` frame) | the stored depth ≤ 10, or the depth cut's 10-bit codes | **yes**, the decoder's planes | all, on the samples | **yes**, every engine (WebCodecs, else dav1d-WASM) |
| AV1 in hardware, unchecked ([`av1-hardware-unchecked.md`](av1-hardware-unchecked.md)) | **unknown**; level 5.0 bounds it at ≤ 31.1 ms a `dbts_b1` frame if the decoder takes the size (D) | +0.01–0.12 % as 4:2:0 (R at 8 bits); more to meet the noise rule on screen, not computed | **8 bits**: 2.0–7.4 display levels a step at the header windows, assuming a full-range conversion (on Android the range is the driver's, so a best case; at studio range the 220-level figures apply); above the noise rule's bar at today's Q (1.02–1.09, D) | **no** (the coded bytes can be checked before decode) | **yes**, all, at 8-bit input; values as intervals | the APIs do; the S23's decoder and the size are **unknown** |
| A hardware frame inverted and checked ([`hw-inverted.md`](hw-inverted.md)) | **unknown**; the same level bound plus upload, pass, read-back and ~2.6 ms of hash (R rate, desktop) | **1.16–2.49×** at the noise rule's bar (M, 19 volumes); more with headroom | **7.78 bits** (220 levels), fewer with headroom: 4.67 source units a step (10-bit), 18.70 (12-bit) | **yes**, every frame, against the 8-bit luma digest | **yes**, a table over 220 inputs | the APIs do; one-to-one and the decoder are **device facts** |
| Other codecs: HEVC, VP9, H.264 ([`other-codecs.md`](other-codecs.md)) | **unknown**; ≤ 62.8 /s (HEVC), ≤ 69.0 /s (VP9), ≤ 29.5 /s (H.264) a `dbts_b1` frame at level 5.1 (D, T) | **unmeasured** | 8 bits (220 if inverted, 256 through `NV12`) | yes at 8 bits, as the inverted frame (T) | as AV1 in hardware at 8 bits | decoders yes (HEVC in > 95 % of phones, R; its source unverified, PR 397 §Review item 6); a codec the ingest does not code |
| HTJ2K in software ([`htj2k-software.md`](htj2k-software.md)) | **unknown**; 78–127 ms a `dbts_b1` frame predicted (T) | **4.6–14.6×** at Q 8, 3.6–10× at the rule's Q (R, D) | the stored depth, bit for bit | **yes**, today's exact-frame digest | all, on the samples | **yes**: the *Lossless* path, every engine with WASM SIMD |
| Lossy HTJ2K ([`htj2k-lossy.md`](htj2k-lossy.md)) | **unknown**; 93–154 ms predicted (T); cloud 1.12–1.21× the lossless frame, 0.41–0.50× dav1d-WASM's view (M) | **0.85–1.47×, median 1.05** at the noise rule's bar, with 1.05–1.17× the in-window error, median 1.13 (M; the median interpolated, D) | the stored depth, no cut | yes, **if** the digest comes from the shipped WASM build (native differs by ±1, M) | all, on the samples | decoder yes; ingest form and client route not built |
| HTJ2K in WebGPU compute ([`gpu-compute-decode.md`](gpu-compute-decode.md)) | **unknown**; bound 5.3 ms on a 2017 low-end card (D); breaks even with one software AV1 decoder if the phone's GPU is ≤ 25× slower | the exact series: 4.63× on `dbts_b1` (R) | full, the stored depth | **yes**, the reversible path only; exact on SwiftShader (R) | all, with a WebGPU painter (not built) | WebGPU: Chrome Android 12+ ARM/Qualcomm/Intel (121), Android 16+ Imagination (139), Safari iOS 26; not Firefox Android, not Xclipse; decoder a lab tool |
| The content's rectangle ([`content-crop.md`](content-crop.md)), a **factor** on any row above | decode × 0.85 (AV1), × 0.76 (HTJ2K) on `dbts_b1`; 0.94 on `dbts_b3`; ≈ 1 on the other 17, 16 of which have no safe rectangle and are coded whole (M) | × 0.997–1.002 (M) | unchanged | as the row it multiplies | unchanged | no: an ingest change and the paint's placement |
| Native, paused 2026-11-15 (`docs/native/`) | the reference point, not a browser option (amendments 18, 19) | | | | | |

Reading the table against the question:

* **Fast enough.** There is no phone number except AV1 in software. Every hardware row's time is a level's
  conformance floor ("must be able to decode", S1), not a measurement, and holds only if the decoder accepts a
  `dbts_b1` or `dbts_c1` frame. The platform does not promise that (§3, item 4).
* **Full precision.** The three HTJ2K rows give it on every series; AV1 in software up to 10 bits, the depth cut above
  (*corrected 2026-11-15, PR 397 §Review blocker 1: this read "The four non-hardware rows give it"*). The three hardware rows top out at 8 bits, and amendment 16
  makes 10 bits on hardware the goal, 8 bits the fallback.
* **Every frame checked.** Every row but AV1 in hardware, unchecked. Lossy HTJ2K is checked only if its digest is tied
  to one decoder build.
* **Bytes.** Today's view or near it (AV1 in software, AV1 in hardware, lossy HTJ2K), 1.16–2.49× (the inverted frame),
  or the exact series (both HTJ2K lossless routes). The other codecs are unmeasured.

## 3. What the sources decide alone

Each item comes from a source fetched by this row on 2026-11-15 and quoted verbatim (§7), or from an option file's
source as that file quotes it (named, not re-fetched).

1. **An ingest digest is valid for any AV1 decoder, hardware included.** S1 §7.2: "decoders shall produce output
   frames that are identical in all respects and have the same output order as those produced by the decoding
   process specified herein" (when `film_grain_params_present` is 0). This is why the inverted frame and the other
   codecs can be checked at 8 bits (`other-codecs.md` §2 quotes H.264, H.265 and VP9 to the same effect).
2. **WebCodecs does not have to hand the page a hardware frame's samples.** S2 §9.4: `format` "Will be null whenever
   the underlying format does not map to a VideoPixelFormat or when [[Detached]] is true." The engines' code (read
   in `hw-inverted.md` §2 and `claude/hw10-routes:docs/decode/hardware-10bit.md`) is what makes this the case for every
   hardware frame above 8 bits today. The page can override the colour space it declares: S2 §7.6, "If colorSpace
   exists, the provided values will override any in-band values from the bitsream". Whether a hardware upload obeys
   that override is per engine (`hw-inverted.md` §2: on Android the driver's range, on desktop Firefox always narrow; on Firefox for Android
   the EGL driver's, PR 397 §Review item 3).
3. **A floating-point GPU decode cannot meet an ingest digest.** S3: "An implementation may reassociate operations."
   and "An implementation may fuse operations if the transformed expression is at least as accurate as the original
   formulation." So the GPU route is the reversible (integer) one, and a GPU lossy view would need integer arithmetic
   (`gpu-compute-decode.md` §4).
4. **No phone is promised a hardware decoder for `dbts_b1` or `dbts_c1`.** S1 Annex A: "A level X.Y compliant decoder
   must be able to decode all bitstreams (that can be decoded by the general decoding process) that conform to that
   level", and these frames need level 5.0 (new-options §2.1, D). S4 asks at most "[5.1/H-1-14] MUST support AV1 hardware
   decoder Main 10, Level 4.1 with film grain effect over GPU composition." of handhelds reporting media performance
   class V (§2.2.7.1), and "[C-2-2] MUST be able to decode at least HD 1080p video decoding profiles" only of devices
   with an AV1 hardware decoder (§5.3.9). Neither is a general floor, which makes the conclusion stronger. Whether a given phone takes the frame is the
   vendor's choice. The page learns it only by configuring and decoding.
5. **One WASM build gives the same samples on every engine, floats included, short of NaN and relaxed SIMD.** S5:
   "Some operators are non-deterministic, because they can return one of several possible results (such as different
   NaN values)."; relaxed operators are implementation-dependent too (`htj2k-lossy.md` §3), and the shipped build uses
   none (no `-mrelaxed-simd`). That
   carries the reversible HTJ2K check to every engine. It also carries lossy HTJ2K's check, but only for the one build
   the digest was made with (`htj2k-lossy.md` §3, M: native x86 differs by ±1).
6. **WebGPU's reach** (`gpu-compute-decode.md` S5, as quoted there): "WebGPU is now enabled by default in Chrome 121 on
   devices running Android 12 and greater powered by Qualcomm and ARM GPUs."; "WebKit for Safari 26.0 adds support for
   WebGPU." The gpuweb wiki (its S4) adds "ARM/Qualcomm/Intel, Android 12+: 121" and "Imagination, Android 16+: 139";
   Firefox for Android and Samsung's Xclipse GPUs are outside it.

What the sources do not decide: any decode time on a phone; whether a real converter's map is one-to-one; any read-back
cost; energy and heat; the bytes of HEVC, VP9 or H.264 on these frames.

## 4. What the next phone round must add

These are asks, not cells. Each is one line in `next-round.md` §Decode-option cells, numbered on from M1–M3
(MOBILE-DECODE-OPTIONS'), exploratory and deciding nothing, by that section's rules. An ask that a counted cell already
covers is not repeated. HTJ2K's per-frame decode (`htj2k-software.md` §8.1) is cell 1. Arm B's fill (its §8.2) is cell
2. `av1-software.md` §8.3 (one decoder, the phone idle) is cell 1's one-decoder point. The forms through
`prefer-hardware` are tried by cell 4, the hardware-decode probe, as M5 asks.

| ask | from | settles |
| --- | --- | --- |
| M4 · codec lists and sizes | `av1-hardware-unchecked.md` §9.1, `other-codecs.md` §6.1 | which decoders the phone has, and for 2560 × 3328 and 976 × 2513 |
| M5 · forms through `prefer-hardware` | `av1-hardware-unchecked.md` §9.2, `other-codecs.md` §6.2 | 10 bits and 4:0:0 for AV1; HEVC, VP9, H.264 at 8 bits |
| M6 · the map at full size | `av1-hardware-unchecked.md` §9.3, `hw-inverted.md` §12.1 | monotonic, one-to-one, clip, with the colour space declared or not |
| M7 · a whole unit, checked | `hw-inverted.md` §12.2 | the share of frames that pass their digest |
| M8 · hardware time, step by step | `av1-hardware-unchecked.md` §9.4, `hw-inverted.md` §12.3 | decode, upload, read-back, hash against software |
| M9 · frames held open | `av1-hardware-unchecked.md` §9.5 | the product's limit |
| M10 · Firefox for Android | `hw-inverted.md` §12.4 | whether a second engine has the route |
| M11 · inversion through HEVC or VP9 | `other-codecs.md` §6.3 | the route where AV1 hardware is absent |
| M12 · decoders up to `hardwareConcurrency` | `av1-software.md` §8.1 | where the phone saturates beyond cell 1's four |
| M13 · `optimizeForLatency` | `av1-software.md` §8.2 | today's setting against dav1d's frame threads |
| M14 · sustained decode | `av1-software.md` §8.4 | thermal drift over minutes |
| M15 · dav1d-WASM on the phone | `av1-software.md` §8.5 | the fallback's cost where WebCodecs refuses |
| M16 · HTJ2K's pool at two threads | `htj2k-software.md` §8.3 | an ask's lever on big and little cores |
| M17 · lossy against lossless HTJ2K | `htj2k-lossy.md` §10.1 | whether the cloud ratio holds (1.19–1.21 predicted on `dbts_b1`; 1.12–1.21 over the cloud's frames) |
| M18 · lossy samples across engines | `htj2k-lossy.md` §10.2 | the one-build check on Chrome, Firefox, Safari |
| M19 · lossy level 1 from its prefix | `htj2k-lossy.md` §10.3 | decode at the screen's size for a lossy frame |
| M20 · the WebGPU decoder | `gpu-compute-decode.md` §9.1–9.2 | the adapter, and ms a frame against OpenJPH-WASM, every frame exact |
| M21 · the `mapAsync` read-back | `gpu-compute-decode.md` §9.3 | one 17 MB frame, and 2 bytes for `valueAt` |
| M22 · the rectangle on the phone | `content-crop.md` §8 | `dbts_b1` whole against its rectangle, AV1 and HTJ2K |

Left out, each with its reason. `av1-software.md` §8.6 (2 × 2 tiles, an 8-bit view) runs "only once the owner lifts
the tiles' wait, or as a series built for the round"; the byte cell of `other-codecs.md` §5 is the owner's. One cannot run yet: `gpu-compute-decode.md` §9.4
(XXH3-64 in WGSL, not built). One is a cloud cell, not a phone cell: `av1-hardware-unchecked.md` §9's 8-bit rounding
against the noise rule, still owed.

## 5. Carried without a row (new-options §6.1)

* **Decode at the screen's size.** HTJ2K's level 1 is 25.8–29.0 % of a frame's bytes and ×0.27–0.31 of its decode,
  exact after a clamp (R, `htj2k-software.md` §5). `dbts_b1` at level 1 is 1280 × 1664, about a phone's height. It
  is measured on lossless frames only: lossy HTJ2K's share is not measured (`htj2k-lossy.md` §6), the WebGPU decoder's
  file does not treat levels, and none of the AV1 rows has it. "No low-resolution preview" is decided, and that
  decision weighed bytes and waits over links, never a phone's decode. Reopening it is the owner's. M19 and cell 1 give
  the number it would rest on.
* **Hardware paints first, software confirms.** The unchecked hardware frame is shown while the reader moves and
  replaced by the checked software frame when it lands (`av1-hardware-unchecked.md` §6). Under amendment 1 this paints
  unchecked frames, so it is the owner's to allow. The inverted frame (`hw-inverted.md`) makes it unnecessary wherever
  M6–M7 pass.

## 6. A leaning, labelled as one

* **The route of record stays AV1 in software.** It is the only row measured on a phone, and it is full precision up
  to 10 bits (the depth cut above; *corrected 2026-11-15, PR 397 §Review blocker 1: this read "full precision"*),
  checked and shipped on every engine. Its spare levers (M12–M15) cost a page, not a build.
* **The first full-precision alternative to settle is HTJ2K on the phone**: cell 1 for WASM, M20 for WebGPU, whose
  decoder already exists and is exact. Either wins only where its decode beats AV1's and the link carries 4.6× the
  bytes (above ~382 Mbit/s against today's fill for WebGPU, if the GPU decodes in ≤ 45 ms; ~405–665 Mbit/s for
  software HTJ2K). That is the home Wi-Fi fit but not a median mobile link. So an HTJ2K
  route is the likelier exact-frame decoder before it is the fill's.
* **Hardware is the only route that changes the decode by an order of magnitude**, and it costs precision. It is worth
  weighing only if M1, M4–M7 pass, and then as the inverted, checked form at 1.16–2.49× bytes and under 7.78 bits, not
  the unchecked one. The other codecs matter only where M4 shows HEVC or VP9 hardware and no AV1 hardware that takes
  the size.
* **Lossy HTJ2K and the content's rectangle: hold.** The cloud cells removed the bytes and decode they were proposed
  for. What is left is lossy HTJ2K's full depth and screen-sized levels (§5), and the rectangle's halving on the
  largest detector (`dbts_b1`). M17–M19 and M22 test them cheaply.

## 7. Sources

Fetched by this row on 2026-11-15. Section numbers are the documents' own.

* **S1** AV1 Bitstream & Decoding Process Specification, <https://aomediacodec.github.io/av1-spec/>, "Last modified:
  2023-05-25 12:27 PT": §7.2 *General decoding process*; Annex A, *Decoder Conformance*.
* **S2** WebCodecs, W3C Working Draft, 9 November 2026, <https://www.w3.org/TR/2026/WD-webcodecs-20261109/>: §7.6
  *VideoDecoderConfig* (`colorSpace`), §9.4 *VideoFrame Interface* (`[[format]]`).
* **S3** WGSL, `gpuweb/gpuweb` at `10be35c70d7bfc37e0557f2d0e38ec42742aba63`, `wgsl/index.bs`, *Floating Point
  Evaluation*: <https://github.com/gpuweb/gpuweb/blob/10be35c70d7bfc37e0557f2d0e38ec42742aba63/wgsl/index.bs>.
* **S4** Android 16 Compatibility Definition, "Last updated: December 2, 2025",
  <https://source.android.com/docs/compatibility/16/android-16-cdd>: §5.3.9 *AV1* [C-2-2]; §2.2.7.1 [5.1/H-1-14].
* **S5** WebAssembly Core Specification, <https://webassembly.github.io/spec/core/exec/numerics.html>, *Numerics*
  (fetched as the live page; `htj2k-lossy.md` S3 pins version 3.0 of 2026-11-04).

The option files' own sources (Chromium 157 and 158, WebKit, Gecko, Vulkan, HTML, ITU-T H.273, DICOM, OpenJPH, the
vendors' pages) are listed in each file's last section with their revisions and were not re-fetched here.

## 8. Fixtures and limits

Three timed DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`); 19 DBT volumes for bytes, noise and the
rectangle; no breast ultrasound cine. 4-core cloud hosts without a GPU, headless Chromium, software decode, one host
saturated for the option rows' cells, so no time is claimed from them. One Android 16 phone (Chrome 157), one home
Wi-Fi link, one evening, three decoders, its core count not recorded: the only phone number (133–135 ms) comes from
it. Nothing was run by this row. It compares documents.
