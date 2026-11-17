# Other codecs with browser hardware decode: HEVC, VP9, H.264

*Queue row MOBILE-OPT-OTHER-CODECS, 2026-11-15 (amendment 20 of `claude/work-ledger:docs/queue-client-2026-11-14.md`;
option 5 of MOBILE-DECODE-OPTIONS' first brief, "whether any route returns samples"; bound by
[`new-options.md`](new-options.md) §2.1 and §3's last paragraph). Written as the option's advocate. Sources and
arithmetic only: nothing run on a device, a GPU or a coder.*

Labels as in [`new-options.md`](new-options.md): **(S)** a source quoted, listed in §8 with its revision; **(R)** a
result of this repository, by its file; **(D)** derived here, the arithmetic written out; **(T)** theory, not measured.
Fixtures behind every (R): three timed DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`), 19 DBT volumes for
bytes and noise; 4-core cloud hosts without a GPU; one phone (Chrome 157), one home link.

## 1. What it shows

* **No browser route returns a hardware frame's samples above 8 bits, for any codec** (S). The gates are the frame's
  pixel format and storage, not its codec: Chromium wraps every Android MediaCodec frame as RGB, has no `P010` format
  on desktop, and Safari maps no 10-bit buffer to a WebCodecs format (§3). HEVC Main 10 and VP9 profile 2 are as
  closed as AV1 Main 10.
* **At 8 bits they are as checkable as AV1** (S, D): H.264, H.265 and VP9 each fix the decoder's output exactly (§2),
  so an ingest digest over the 8-bit luma holds for a hardware decoder too. The samples come back as `NV12` planes in
  desktop Chromium and Safari; on Android only through [`new-options.md`](new-options.md) §3's inversion (T).
* **What they add over AV1 is the decoder's presence and size, not a route** (S, R). HEVC hardware is in > 95 % of
  smartphones against 9.76 % for AV1 (R, [`../hardware.md`](../hardware.md) §6, citing ScientiaMobile 2024 Q2; the
  HEVC figure's page could not be fetched on 2026-11-15, so it is unverified, not refuted: PR 397 §Review item 6); Android requires an HEVC *or*
  VP9 decoder at UHD, which needs level 5.1, where its AV1 floor is level 4.1; `dbts_b1` needs level 5 in all three
  (§4).
* **H.264's High profile takes 4:0:0** (S), so 8-bit grey needs no constant chroma there; HEVC Main and VP9 profile 0
  do not take it (§2).
* **What they cost**: 8 bits (220 or 256 levels, as for AV1 in hardware), bytes **unmeasured** on our data (§5),
  HEVC's licensing (the owner's, as [`../hardware.md`](../hardware.md) §6 says), and a codec the ingest does not code
  today.

## 2. The codecs: profiles, grey, exactness

| | 8-bit 4:2:0 | 8-bit 4:0:0 | 10-bit 4:2:0 | decoding fixed exactly |
| --- | --- | --- | --- | --- |
| **H.264** High | yes | **yes** | High 10, rarely in hardware (T) | yes, §8 |
| **H.265** Main / Main 10 | Main | no (RExt monochrome profiles only) | Main 10 | yes, §8.1.1, with a note on best-effort decoding |
| **VP9** profile 0 / 2 | profile 0 | no | profile 2 | yes, §8.1 |

* **H.264** (S1, §A.2.4, High profile): "Sequence parameter sets shall have chroma_format_idc in the range of 0 to 1
  inclusive." and "Sequence parameter sets shall have bit_depth_luma_minus8 equal to 0 only." Its decoding process
  (S1, §8): "The decoding process is specified such that all decoders shall produce numerically identical results.
  Any decoding process that produces identical results to the process described here conforms to the decoding
  process requirements of this Recommendation | International Standard."
* **H.265** (S2, §A.3.2, Main profile): "Active SPSs for the base layer shall have chroma_format_idc equal to 1 only."
  Its decoding process (S2, §8.1.1): "The decoding process is specified such that all decoders that conform to a
  specified profile, tier and level will produce numerically identical cropped decoded output pictures when invoking
  the decoding process associated with that profile for a bitstream conforming to that profile, tier and level."
  With a caveat that matters for our frame sizes (§4): "NOTE 1 – For the purpose of best-effort decoding, a decoder
  that conforms to a particular profile at a given tier and level can additionally decode some bitstreams conforming
  to a different tier, level or profile without necessarily using a decoding process that produces numerically
  identical cropped decoded output pictures to those produced by the process specified herein". So a decoder that
  takes a stream above its level owes nothing exact; the digest, not the decoder, then says whether it was (D).
* **VP9** (S3, §7.2): "VP9 supports 4 profiles", profile 0 "8 … YUV 4:2:0", profile 2 "10 or 12 … YUV 4:2:0"; its
  subsampling table (§7.2) lists 4:4:4, 4:4:0, 4:2:2 and 4:2:0 only, so no 4:0:0. Its decoding process (S3, §8.1):
  "Decoders shall produce output frames that are identical in all respects and have the same output order as those
  produced by the decoding process specified herein." (the sentence AV1's §7.2 carries, S1 of `new-options.md`).

So [`new-options.md`](new-options.md) §3's step 1 holds for each, with the same form (D): 8-bit luma, chroma constant
128 for HEVC Main and VP9 profile 0, and for H.264 either that or 4:0:0. A 4:0:0 H.264 picture has no chroma to hold
at 128; how a browser draws it is unread here (T).

## 3. Whether any route returns samples

The gates read the frame, not the codec. Per engine:

* **Chromium on Android** (S4): the MediaCodec frame factory sets one format for every frame, codec aside: "we need to
  use the pixel format as ABGR here(which corresponds to 32bpp RGBA). VideoPixelFormat pixel_format =
  PIXEL_FORMAT_ABGR;" (`media/gpu/android/video_frame_factory_impl.cc:150–157`). The image behind it is Android's
  private opaque format with no planes (R, `claude/hw10-routes:docs/decode/hardware-10bit.md` §7). **No samples at
  any depth**; at 8 bits the RGB picture is invertible by [`new-options.md`](new-options.md) §3 (T).
* **Chromium on desktop** (R, [`../hardware.md`](../hardware.md) §4.1, gate 3): an 8-bit hardware frame is `NV12`
  and `copyTo` copies its planes; a 10-bit one is `P010`, its `format` is `null`, and `copyTo` throws. **8 bits:
  samples back** (their exactness unmeasured); 10 bits: none.
* **Safari** (S5): WebKit names a WebCodecs format for a Core Video buffer only for 8-bit biplanar and RGB:
  "if (format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || format ==
  kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange || format == kCVPixelFormatType_Lossless_420YpCbCr8BiPlanarVideoRange)
  return VideoPixelFormat::NV12;", then the two RGB types, else `return { };`
  (`Source/WebCore/platform/VideoPixelFormat.cpp:43–50`, 81). A 10-bit buffer
  (`kCVPixelFormatType_420YpCbCr10BiPlanar…`, which WebKit itself tests for in `VideoFrame::is10bits`,
  `platform/VideoFrame.cpp:210–214`) has no format. An `NV12` frame's `copyTo` reads the planes
  (`platform/graphics/cv/VideoFrameCV.mm:545–546`, `copyNV12`). **8 bits: samples back; 10 bits: none.** Which
  decoder Safari's WebCodecs uses is not settled here: when a creator is installed through `setCreatorCallback`
  every codec goes to it (`platform/VideoDecoder.cpp:69–72`), and who installs it, with which decoders, was not
  read; only without one do VP8, VP9 (profiles 0 and 2) and AV1 go to libwebrtc's own decoders,
  `webrtc::VP9Decoder::Create()` for VP9 (`VideoDecoder.cpp:94–109`,
  `platform/libwebrtc/LibWebRTCVPXVideoDecoder.cpp:186–189`), libvpx in software. So whether Safari's WebCodecs
  decodes H.264, HEVC or VP9 in hardware is not confirmed from source here (T); the format gate above holds for
  whichever decoder it is (S).
* **Firefox** (R, [`../hardware.md`](../hardware.md) §4.2): "every frame reaches the page as 8-bit `BGRX`, whatever
  its depth or layout"; at 8 bits "only GBR and full-range 4:2:0 grey survive the RGB conversion" (M, row XENGINE).
  **No samples**; inversion at 8 bits (T), full range measured to survive.

**HEVC in Chromium is a platform decoder or nothing** (S4; codec strings `hev1.*`, `hvc1.*`, `vp09.*`, `avc1.*` per
S8): `isConfigSupported` refuses `prefer-software` for a codec that is
not built in, and the built-in list is H.264 (FFmpeg, proprietary builds), VP8, VP9 (libvpx) and AV1
(`media/base/supported_types.cc:581–597`; `third_party/blink/renderer/modules/webcodecs/video_decoder.cc:307–311`).
On Android "the platform" may still be a software Codec2 component behind MediaCodec; Chrome's output is `ABGR`
either way (D). Which component took a frame is a `chrome://media-internals` read (R, the device probe's README).

## 4. The frame's size against each codec's levels

[`new-options.md`](new-options.md) §2.1's question for each codec. Sizes from `docs/FIXTURES.md`; coded sizes
rounded up as each codec codes them (D).

**H.265** (S2, §A.4.1): "PicSizeInSamplesY shall be less than or equal to MaxLumaPs", and width and height each
"less than or equal to Sqrt( MaxLumaPs * 8 )". Table A.8, MaxLumaPs: level 4 and 4.1 "2 228 224"; 5, 5.1, 5.2
"8 912 896". Table A.9, MaxLumaSr: 5 "267 386 880", 5.1 "534 773 760".

**VP9** (S6; *corrected 2026-11-15, PR 397 §Review item 5: cited to S3's Annex A, which has no width column*): Max
Luma Picture Size 4 and 4.1 "2228224", 5 to 5.2 "8912896"; Max Width and Height 4160 and 8384; Max Luma Sample Rate 5 "311951360", 5.1 "588251136". Its picture size is "The extended
frame size in pixels (samples). The decoder needs to handle pixels extended outside the frame towards the right and
bottom by up to 32 pixels", so the worst case below adds 32 to each side (D).

**H.264** (S1, Table A-1, and §A.3.2, the High profiles' limits: "PicWidthInMbs * FrameHeightInMbs <= MaxFS", each
side "<= Sqrt( MaxFS * 8 )"):
MaxFS 4 to 4.1 "8 192", 4.2 "8 704", 5 "22 080", 5.1 and 5.2 "36 864" macroblocks; MaxMBPS 5.1 "983 040".

| series | H.265: coded to 8 (D) | level | VP9: + 32 a side (D) | level | H.264: macroblocks (D) | level |
| --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1`, 1142 × 1785 | 1144 × 1792 = 2 050 048 | 4 | 1174 × 1817 = 2 133 158 | 4 | 72 × 112 = 8 064 | 4 |
| `dbts_c1`, 976 × 2513 | 976 × 2520 = 2 459 520 | **5** | 1008 × 2545 = 2 565 360 | **5** | 61 × 158 = 9 638 | **5** |
| `dbts_b1`, 2560 × 3328 | 2560 × 3328 = 8 519 680 | **5** | 2592 × 3360 = 8 709 120 | **5** | 160 × 208 = 33 280 | **5.1** |

Every side is within its level's bound (D): H.265 √(8 912 896 × 8) = 8 444 ≥ 3 328; VP9 8 384 ≥ 3 360; H.264 at 5.1
√(36 864 × 8) = 543 ≥ 208 macroblocks. So `dbts_c1` and `dbts_b1` need level 5 (H.264 5.1 for `dbts_b1`) in every
codec, as in AV1 (D).

**What Android asks** (S7, Android 16 CDD):

* §5.3.5 H.265: "[C-1-1] MUST support the Main Profile Level 3 Main tier and the SD video decoding profiles";
  "[C-1-2] MUST support the HD decoding profiles … if there is a hardware decoder"; and "If the height that is
  reported by the Display.getSupportedModes() method is equal to or greater than the video resolution, then: [C-2-1]
  Device implementations MUST support at least one of H.265 or VP9 decoding of 720, 1080 and UHD profiles." Its UHD
  profile: "3840 x 2160 px", "60 fps", "20 Mbps".
* §5.3.7 VP9: "[C-3-1] Device implementations MUST support at least one of VP9 or H.265 decoding of the 720, 1080
  and UHD profiles", same condition; "If device implementations claim to support VP9Profile2 or VP9Profile3 …
  Support for 12-bit format is OPTIONAL."
* §5.3.4 H.264: "[C-1-1] MUST support Main Profile Level 3.1 and Baseline Profile"; the largest profile it requires
  is "1920 x 1080 px". So H.264 High, 4:0:0 or level 5.1 is never required (D).
* §2.2.7.1, media performance class V: "[5.1/H-1-15] MUST have at least 1 hardware video decoder supporting 4K60."
  (no codec named), against "[5.1/H-1-14] MUST support AV1 hardware decoder Main 10, Level 4.1".

The UHD profile at 60 fps (D): 3840 × 2160 = 8 294 400 samples, over level 4's 2 228 224, and 8 294 400 × 60 =
497 664 000 samples a second, over H.265 level 5's 267 386 880 and within 5.1's 534 773 760. So a decoder meeting it
handles H.265 level 5.1's rate at 3840 × 2160. `dbts_b1` is 8 519 680 ÷ 8 294 400 = 1.027 of that picture and
taller (3328 against 2160): within level 5's bound, but whether a decoder built for UHD takes a portrait 2560 × 3328
is its own reported limit (`MediaCodecInfo.VideoCapabilities`), a device fact (T). Whether a phone's
`getSupportedModes()` height meets the UHD condition is also the device's (T). **Still, it is the only Android
requirement that reaches level 5 for any codec; AV1's stops at 4.1** (D).

The conformance bounds on rate for `dbts_b1` (D, T: a level's ceiling, not a measurement): H.265 5.1, 534 773 760 ÷
8 519 680 = 62.8 frames a second; VP9 5.1, 588 251 136 ÷ 8 519 680 = 69.0; H.264 5.1, 983 040 ÷ 33 280 = 29.5;
the CDD's UHD profile, 497 664 000 ÷ 8 519 680 = 58.4 if the rate carried to this picture. Against 7.4 a second for
one software AV1 decoder on the phone (R, `new-options.md` §2.1).

## 5. The comparison's columns

| column | HEVC Main (8-bit) | VP9 profile 0 | H.264 High (8-bit, 4:0:0) |
| --- | --- | --- | --- |
| decode on a phone | **unknown**; ≤ 62.8 /s at level 5.1 for `dbts_b1` (D, T) | **unknown**; ≤ 69.0 /s (D, T) | **unknown**; ≤ 29.5 /s (D, T) |
| decoder present | > 95 % of smartphones (R) | per device; HEVC or VP9 at UHD required under the display condition (S7) | everywhere at 1080p; High 4:0:0 and level 5.1 not required (S7) |
| bytes | **unmeasured** on our data | **unmeasured** | **unmeasured**; no chroma bytes |
| precision on screen | 8 bits: 220 levels if inverted (`new-options.md` §3.1), 256 through `NV12` | same | same |
| checked | yes at 8 bits: `NV12` on desktop Chromium and Safari, inversion on Android and Firefox (T) | same | same; 4:0:0's drawing unread (T) |
| window/level, tools | as AV1 in hardware at 8 bits (MOBILE-OPT-AV1-HW-UNCHECKED); on checked samples `valueAt` and measurements work (T) | same | same |
| ships today | yes, Chrome Android through MediaCodec; a platform decoder only in Chromium (S4) | yes in Chromium; Safari's decoder unread (S5, T) | yes; 4:0:0 in hardware unknown (T) |

The window at 8 bits (D; MOBILE-OPT-AV1-HW-UNCHECKED owns the full treatment): a 10-bit source cut to 256 levels puts
1024 ÷ 256 = 4 source units in a level, so a window W source units wide gets at most W ÷ 4 distinct display levels;
at 220 levels W ÷ 4.65. A window of 400 units: 100, or 86.

**Bytes** are this option's deciding unknown. AV1 is the newest of the four and the ingest's codec; nothing here says
by how much HEVC, VP9 or H.264 would cost more on DBT frames at the noise rule's bar (T). A cloud cell would answer
it beside DEPTH8-MEASURE's 8-bit AV1 rows: each codec's 8-bit form on the 19 volumes, coding error measured as
`lab/av1/metrics` measures the view's. Not pre-registered here: the brief names no byte cell, so it is listed as an
ask for the owner (§6).

**Its disadvantages, as the advocate sees them**: it is an 8-bit option, so everything [`new-options.md`](new-options.md)
§3.1 says about 220 levels applies; it adds a second lossy codec to the ingest; HEVC's licensing is the owner's; Safari's
WebCodecs decoder for each codec is unread; H.264's 4:0:0 and level 5.1 are not required of any phone. Its one
advantage over AV1 in hardware is that the decoder is far more likely to be there and to take the frame's size.

## 6. What a phone cell must measure (asks)

For `claude/phone-protocol:docs/phone-rows/next-round.md`, one line each, beside [`new-options.md`](new-options.md)
§7's asks 1–3 (which they extend from AV1 to these codecs):

1. The phone's codec list from a shell (HW10-ROUTES' first ask, extended): every HEVC, VP9 and AVC decoder, hardware
   or not, its profiles and levels, its maximum width and height and whether 2560 × 3328 and 976 × 2513 are
   supported sizes.
2. `isConfigSupported` and one decode with `prefer-hardware` of an 8-bit unit of `dbts_b1` and `dbts_c1` per codec:
   HEVC Main constant chroma, VP9 profile 0 constant chroma, H.264 High 4:0:0 and constant chroma; the outcome, the
   frame's `format`, the decoder `chrome://media-internals` names.
3. Where HEVC or VP9 decodes and AV1 does not: ask 2 and 3 of [`new-options.md`](new-options.md) §7 (the calibration
   unit inverted, one frame hashed against its digest) through that codec, and the time a frame of `dbts_b1`.

For the owner, not a phone cell: the byte cell of §5, if this option is to be weighed at all.

## 7. What the sources decide, and a leaning

**Decided by the sources alone**: no browser returns a hardware frame's samples above 8 bits in any of these codecs
(S4, S5, R); all three fix their decoding exactly, so an 8-bit ingest digest is valid for their hardware decoders,
with H.265's best-effort note for streams above the decoder's level (S1–S3); `dbts_b1` and `dbts_c1` need level 5
in every codec (D); Android requires level 5.1-class HEVC or VP9 only under its display condition and never H.264
above 1080p (S7). **Not decided**: any decode time on a phone, any byte count, whether a phone's decoder takes the
portrait sizes, how Android Chrome draws an H.264 4:0:0 frame.

**A leaning, labelled as one**: this option is [`new-options.md`](new-options.md) §3 with a different decoder, not a
route of its own. It is worth carrying only where a phone has no AV1 hardware decoder, or one that refuses the frame's
size, and HEVC or VP9 takes it; asks 1–2 settle that cheaply in the same round as AV1's. HEVC first among the three
(the most common decoder, level 5.1 by the UHD rate), VP9 second (required only as HEVC's alternative), H.264 last (no level 5.1 or
4:0:0 required).

## 8. Sources

Fetched 2026-11-15. Section numbers are the documents' own; line numbers are of the file at the revision named.

* **S1** Recommendation ITU-T H.264 (06/2026), *Advanced video coding for generic audiovisual services*: §8, §A.2.4,
  §A.3.2, Table A-1. <https://www.itu.int/rec/T-REC-H.264-202606-I>
* **S2** Recommendation ITU-T H.265 (V11) (01/2026), *High efficiency video coding*: §8.1.1, §A.3.2, §A.4.1,
  Tables A.8 and A.9. <https://www.itu.int/rec/T-REC-H.265-202601-I>
* **S3** VP9 Bitstream & Decoding Process Specification, v0.7, 22nd February 2017: §7.2, §8.1, Annex A.
  <https://storage.googleapis.com/downloads.webmproject.org/docs/vp9/vp9-bitstream-specification-v0.7-20170222-draft.pdf>
* **S4** Chromium at tag `157.0.8103.79`: `media/gpu/android/video_frame_factory_impl.cc`,
  `media/base/supported_types.cc`, `third_party/blink/renderer/modules/webcodecs/video_decoder.cc`.
  <https://chromium.googlesource.com/chromium/src/+/refs/tags/157.0.8103.79/>
* **S5** WebKit at `0e349c63d796f3d56bc082c0a08cee607f91227a` (`main`, 2026-11-15): `Source/WebCore/platform/VideoPixelFormat.cpp`,
  `platform/VideoFrame.cpp`, `platform/graphics/cv/VideoFrameCV.mm`, `platform/VideoDecoder.cpp`,
  `platform/libwebrtc/LibWebRTCVPXVideoDecoder.cpp`.
  <https://github.com/WebKit/WebKit/tree/0e349c63d796f3d56bc082c0a08cee607f91227a/Source/WebCore/platform>
* **S6** WebM Project, *VP9 Levels and Decoder Testing*, "Downloads last modified 2016-05-04".
  <https://www.webmproject.org/vp9/levels/>
* **S7** Android 16 Compatibility Definition, "Last updated: December 2, 2025": §5.3.4, §5.3.5, §5.3.7, §2.2.7.1.
  <https://source.android.com/docs/compatibility/16/android-16-cdd>
* **S8** WebCodecs Codec Registry, W3C Registry Draft, 24 September 2026, which registers `avc1.*`, `hev1.*`,
  `hvc1.*` and `vp09.*`. <https://www.w3.org/TR/2026/DRY-webcodecs-codec-registry-20260924/>
