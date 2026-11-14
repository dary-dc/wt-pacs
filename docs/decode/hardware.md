# Hardware decode

*Queue row 161, HWDECODE, 2026-10-13. Theory only: nothing built or run, no device touched. One question: **which
hardware decode paths can serve the diagnostic viewer?** Every choice stays the owner's.*

*Re-read 2026-11-14 (queue row HW-DECODE-DEEP), theory and sources only, nothing run on a device, for the
optimal-quality view at Chromium 157 (the phone's) and 158 (today's stable): [§11–§17](#11-the-optimal-quality-view-2026-11-14).
Where it corrects the 2026-10-13 text, the text stays and a *Corrected 2026-11-14* note follows it.*

*Reviewed 2026-11-14 (queue row HW-DECODE-DEEP-REVIEW, a session that wrote none of §11–§17): 15 sources drawn at
random and fetched, the owner's amendments applied, corrections in place marked *Corrected in review*: [§18](#18-review-2026-11-14).*

**How a claim is labelled.** **(S)** source: a file and line at a pinned tag, or a spec, document or page with its
section, each pinned in §10 with the SHA-256 prefix of the copy read; **(D)** derived: arithmetic or reasoning on
sources, written out; **(M)** measured: this repository, with its queue row. Nothing here is measured on a GPU: every
(M) is a container's, without one.

## Contents

1. [What it shows](#1-what-it-shows)
2. [What "serve the viewer" needs](#2-what-serve-the-viewer-needs)
3. [AV1's profiles and the product's layouts](#3-av1s-profiles-and-the-products-layouts)
4. [The browser paths](#4-the-browser-paths)
5. [The native paths](#5-the-native-paths)
6. [Other codecs in hardware](#6-other-codecs-in-hardware)
7. [Coverage](#7-coverage)
8. [What it means for the AV1 design](#8-what-it-means-for-the-av1-design)
9. [What a device run would settle](#9-what-a-device-run-would-settle)
10. [Sources](#10-sources)
11. [The optimal-quality view, 2026-11-14](#11-the-optimal-quality-view-2026-11-14)
12. [The gates at Chromium 157 and 158](#12-the-gates-at-chromium-157-and-158)
13. [Painting without a read-back](#13-painting-without-a-read-back)
14. [Coded forms that reach hardware](#14-coded-forms-that-reach-hardware)
15. [Phones, native, and beyond AV1](#15-phones-native-and-beyond-av1)
16. [What the sources decide](#16-what-the-sources-decide)
17. [A device probe for the phone round](#17-a-device-probe-for-the-phone-round)
18. [Review, 2026-11-14](#18-review-2026-11-14)

## 1. What it shows

* **No browser path can serve the viewer as the product codes AV1 today.** Chromium's hardware path refuses 4:0:0
  before it decodes (§4.1), and every grey stream the product codes is 4:0:0. Its RGB stream is 10-bit 4:4:4, which
  no hardware path Chromium uses advertises outside Windows. And even a stream hardware does decode cannot be read
  back at 10 bits: WebCodecs has no format for a hardware 10-bit frame, so `copyTo` refuses it (§4.1). Firefox returns
  8-bit RGB from every path (§4.2), and Safari's WebCodecs AV1 is software, 8-bit 4:2:0 only (§4.3).
* **One browser case is open: 8-bit 4:2:0 in Chromium on a desktop GPU.** An 8-bit stream coded as full-range 4:2:0
  with mid-grey chroma (row GREY420's form, built and not adopted) would reach a hardware decoder. It would come back
  as `NV12`, which `copyTo` copies plane by plane on a mappable frame (D, §4.1). Whether those samples are exact, and
  whether that is faster than dav1d once the read-back is paid, waits on a device run. On Android it cannot be exact:
  Chromium wraps MediaCodec's output as an RGB texture (§4.1).
* **Native, the samples come back exactly by API** (D, §5): VideoToolbox, MediaCodec, VA-API, NVDEC, D3D11/12 and
  Vulkan Video all hand the application the decoder's own planes (`NV12`/`P010` and their kin) with no colour
  conversion it did not ask for. What limits a native viewer is the formats each decoder takes. All of them take
  AV1 Main 4:2:0 at 8 and 10 bits (S). Few take 4:0:0, and only NVDEC is shown taking it (S, §5.4). 4:4:4 and
  12 bits are offered only through D3D12 and Vulkan Video, wherever a driver reports them (S, §5.5, §5.6).
* **Lossless needs no special support, by the spec.** `CodedLossless` is part of every profile's decoding process
  (S, AV1 §5.9.2, Annex A). Whether a given chip's lossless path is correct is a conformance question, and only a
  device run answers it (§9).
* **Coverage is small on phones and large on gaming desktops.** 9.76 % of smartphone use had an AV1 hardware decoder
  in 2024 Q2 (S, ScientiaMobile). In Valve's September 2026 survey, 69.6 % of desktop GPUs decode AV1, 17.2 % do
  not, and 13.2 % cannot be told (D, §7). These are a web-analytics vendor's sample and gamers who opted in; neither
  is a radiology reading room.
* **So, for this product: no hardware path changes a verdict today.** dav1d-WASM and WebCodecs in software stay the
  decoders. The one path worth a device run is native: NVDEC, VideoToolbox or VA-API returning a 4:2:0 or 4:0:0
  stream's planes for the native viewer (§9). The client asks WebCodecs for `prefer-software` (S,
  `client/decode/av1-webcodecs.js:80`), so nothing in §4.1 reaches it today.

*Corrected 2026-11-14:* the first bullet's 4:0:0 refusal is the desktop backends'. Android's MediaCodec path does
not run Chromium's AV1 front end, so a 4:0:0 stream reaches the device's codec, which decides (§12). And the 10-bit
planar `copyTo` formats were not off at 141: their flag was already `stable` (§12). What still closes 10 bits from
hardware is `P010`'s missing format and, on Android, the RGB wrapping; the conclusion for the browser stands.

## 2. What "serve the viewer" needs

A hardware path serves the diagnostic viewer only if all of these hold. The exactness check decides; the rest follow
from it.

| function | needs | survives a colour-converted 8-bit picture? |
| --- | --- | --- |
| **the exactness check** (samples hash against the encoder's input) | every sample, at its coded depth | **no**: the samples are gone |
| **window/level on > 8 bits** | the full-depth samples, mapped by the viewer | **no**: an 8-bit RGB picture holds at most 256 levels of a 4 096-level (12-bit) range |
| **zoom** | the samples, resampled by the viewer | yes, on the wrong samples |
| **measurement** (distance, ROI statistics) | geometry from the metadata; ROI statistics need the samples | geometry yes; statistics **no** |
| **cine** | a decoded frame per display interval | yes |

(D) A path is **exact** when the application can read the decoder's own planes at their coded depth: the planes are
copied, not converted to RGB. Then every row survives, because the viewer does what it does today on samples that
are the same. A path that returns only an RGB picture keeps zoom geometry and cine and loses the rest. That is a
display path, not a diagnostic one.

## 3. AV1's profiles and the product's layouts

**The profiles (S, AV1 §6.4.1 and Annex A.2):**

| seq_profile | name | bit depth | layouts |
| --- | --- | --- | --- |
| 0 | Main | 8, 10 | 4:2:0, **monochrome (4:0:0)** |
| 1 | High | 8, 10 | adds 4:4:4 (no monochrome) |
| 2 | Professional | 8, 10, 12 | adds 4:2:2; at 12 bits 4:0:0, 4:2:0, 4:2:2, 4:4:4 |

"Main compliant decoders must be able to decode streams with seq_profile equal to 0" (S, Annex A.2), and the note
there names monochrome as part of Main. So **a conforming Main decoder takes the product's 4:0:0 streams.** Where a
hardware path refuses them (§4.1), the refusal is that path's, not the spec's.

**What the product codes** (S, [`../av1/payload-format.md`](../av1/payload-format.md) §Representation at ingest;
[`../codecs/README.md`](../codecs/README.md) §The choice, as built):

| source | stream(s) | profile needed |
| --- | --- | --- |
| grey ≤ 8 bits | 8-bit 4:0:0 | Main |
| grey 9 bits | 10-bit 4:0:0 | Main |
| grey 10–13 bits (split) | top 8–10-bit 4:0:0, low 8-bit 4:0:0 | Main ×2 |
| grey 14 bits (split) | top 12-bit 4:0:0, low 8-bit 4:0:0 | **Professional** + Main |
| RGB 8-bit | RCT, one 10-bit 4:4:4 | **High** |
| 8-bit grey as 4:2:0 (row GREY420, ingest flag, not adopted) | 8-bit 4:2:0, mid-grey chroma, full range | Main |

## 4. The browser paths

### 4.1 Chromium: WebCodecs and `<video>`/MSE

Chromium 141.0.7390.37, the lab's (§10). WebCodecs and `<video>` share one decoder stack. A hardware AV1 frame passes
three gates.

**Gate 1: which profiles each platform advertises** (S):

| platform | backend | AV1 profiles advertised |
| --- | --- | --- |
| Linux, ChromeOS | VA-API | Main only; High is commented out: "VaapiWrapper does not support AV1 Profile 1" (`media/gpu/vaapi/vaapi_wrapper.cc:778–780`) |
| macOS | VideoToolbox | Main only, and only where `VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1)` (`media/gpu/mac/video_toolbox_video_decoder.cc:63–65, 497–504`) |
| Windows | D3D11 (DXVA) | Main, High and Professional, each where the device lists `DXVA_ModeAV1_VLD_Profile0/1/2`; the 12-bit Professional GUIDs are not tested (`media/gpu/windows/supported_profile_helpers.cc:327–362`) |
| Android | MediaCodec | where a hardware AV1 codec is listed (`media/gpu/android/media_codec_video_decoder.cc:73`) |

A configuration matches on profile, coded size and encryption alone; chroma layout and bit depth are not compared
(S, `media/base/supported_video_decoder_config.cc:28–51`).

**Gate 2: what the shared AV1 front end refuses** (S, `media/gpu/av1_decoder.cc`). VA-API, D3D11 and VideoToolbox all
run Chromium's `AV1Decoder` before the hardware (`d3d11_video_decoder.cc:177`, `video_toolbox_video_decoder.cc:198`).
On each sequence header it:

* returns `kDecodeError` for anything but 4:2:0 and 4:4:4, so **4:0:0 and 4:2:2 fail**: "Only YUV 4:2:0 and YUV
  4:4:4 are supported" (`:304–307`);
* takes 8 or 10 bits at Main and High, and 12 only at Professional (`:68–77`, `:314–318`).

A decode error closes a WebCodecs decoder with `EncodingError`. There is no fall-back to software inside it (S,
`third_party/blink/renderer/modules/webcodecs/decoder_template.cc:702–705`). `no-preference` offers hardware first
and `prefer-software` never offers it (S, `video_decoder_broker.cc:208–225`). **So with `no-preference` on a GPU
that advertises AV1 Main, the product's 4:0:0 grey would configure, reach hardware, and fail on its first chunk**
(D). The product's per-layout probe would then send it to dav1d-WASM
([`../av1/payload-format.md`](../av1/payload-format.md) §Decoder choice, per payload). The client asks for
`prefer-software` (S, `client/decode/av1-webcodecs.js:80`), so today none of this happens. Not run: the lab has no GPU.

**Gate 3: whether the page can read the frame** (S, `third_party/blink/renderer/modules/webcodecs/video_frame.cc`):

* `copyTo`'s format is the frame's own only if it is mappable, or a shared image at 8 bits. "Readback is not
  supported for high bit-depth formats" on a non-mappable frame (`:441–475`, `:449–451`).
* The format must be in `IsFormatEnabled` (`:205–233`), which lists `I420`, `I422`, `I444`, `NV12` and RGB at 8 bits.
  The 10- and 12-bit planar formats are behind a runtime flag, `WebCodecsHBDFormatsEnabled`. **`P010`, the 10-bit
  format hardware decoders output, is in neither list**, so its `format` is `null`. `copyTo` then throws
  `NotSupportedError`, "Operation is not supported when format is null" (`:530–543`). The WebCodecs spec has no
  `P010` either (S, WebCodecs §9.8 `VideoPixelFormat`; §9.4.1: `format` "will be null whenever the underlying format
  does not map").

  *Corrected 2026-11-14:* "behind a runtime flag" read as off; at 141 that flag was already on by default:
  `name: "WebCodecsHBDFormats", status: "stable"` (S, 141.0.7390.37
  `third_party/blink/renderer/platform/runtime_enabled_features.json5:5540–5541`). By 157 the flag is gone and the
  formats are listed unconditionally (§12). `P010` is still in neither list.
* A frame whose shared image "prefers an external sampler" reads back only as `BGRX`: RGB, converted (`:455–462`). On
  Android every MediaCodec frame is wrapped as `ABGR` (S, `media/gpu/android/video_frame_factory_impl.cc:155`), so
  **an Android hardware frame never comes back as its YUV planes** (D).
* `copyTo({format: "RGBA"…})` is a colour conversion (`:1390–1404`): not exact.
* *Corrected 2026-11-14:* gate 2's list above names the desktop backends only, but the table below applied its
  4:0:0 rows to every platform. Android's `MediaCodecVideoDecoder` hands the stream to MediaCodec without
  `AV1Decoder` (§12): there, whether 4:0:0 decodes is the device codec's answer, not Chromium's.
* `new VideoFrame(videoElement)` wraps the `<video>` element's current decoded frame directly (`:663–672`), so the
  MSE path has the same three gates, plus a container: MSE takes fragmented MP4 or WebM (row 159's subject).

**So, in Chromium 141** (D, from the three gates):

| stream | hardware decodes it | samples back |
| --- | --- | --- |
| 8-bit 4:0:0 (product grey ≤ 8, every split's low) | **no**, refused at gate 2 | — |
| 10-bit 4:0:0 (grey 9, tops of grey 10–13) | **no**, gate 2 | — |
| 12-bit 4:0:0 (top of grey 14) | **no**, gate 2; Chromium's software path refuses 12 bits too (M, row WCAP) | — |
| 10-bit 4:4:4 RCT (product RGB) | Windows only, where the device lists Profile1; gate 1 elsewhere | **no**: 10 bits, gate 3 |
| 8-bit 4:2:0 grey (GREY420 form) | yes, where Main is advertised | `NV12` on desktop, a plane copy (exactness unmeasured); RGB on Android |
| 10-bit 4:2:0 | yes | **no**: `P010`, gate 3 |

### 4.2 Firefox

From row XENGINE's reading of Firefox 157 (S, [`README.md`](README.md) §Why, and what would make it exact): WebCodecs
decodes in the RDD process and hands the page a texture, so **every frame reaches the page as 8-bit `BGRX`**, whatever
its depth or layout, and Gecko's image formats have no 10-bit YUV. A hardware decoder behind it changes neither
fact (D). No Firefox hardware path is exact above 8 bits. At 8 bits only GBR and full-range 4:2:0 grey survive
the RGB conversion (M, row XENGINE).

*Corrected 2026-11-14:* "every frame" holds for a frame decoded in another process, not for every image. At Gecko
`c72617c0` a decoded frame's format is guessed from its image: a planar YCbCr image maps to `I420`, `I420P10` or
`I420P12` by its depth, and a remote one does not: "This process only reads a remote image back as RGB", `BGRX` (S,
`dom/media/ImagePixelFormat.cpp:28–73, 144–146`; `dom/media/webcodecs/VideoDecoder.cpp:505`). A hardware frame
is a remote one, so the conclusion above stands; which images Firefox's WebCodecs output is today was not re-read.

### 4.3 Safari

From the same row's reading of WebKit's source (S, [`README.md`](README.md) §Why, and what would make it exact):
WebCodecs AV1 is behind `WebCodecsAV1Enabled`, off by default on Cocoa, and is libwebrtc's dav1d in software,
refusing anything but 8-bit 4:2:0. `<video>` AV1 on Apple is hardware only. ScientiaMobile reports that Safari plays
AV1 only on devices with a hardware decoder (S, ScientiaMobile 2024 Q2). Its read-back is the `<video>`-to-canvas path,
RGB (D). No Safari path reads hardware AV1 planes.

*Re-checked 2026-11-14:* unchanged at WebKit `main` `b4291f79`: `WebCodecsAV1Enabled`, `status: preview`,
`defaultValue: "USE(GSTREAMER)": true, default: false` (S, `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml:7290–7300`).
On Apple platforms WebCodecs AV1 is off unless the reader turns it on.

## 5. The native paths

A native viewer reads the decoder's surface itself. Each API below returns that surface in the decoder's format,
and copying its planes is exact by construction: a memory copy, with no conversion in it (D). `P010` keeps 10 bits
in the top of a 16-bit word, "the lower 6 bits set to zero" (S, Android `ImageFormat.YCBCR_P010`), so a shift
recovers them. The limits are the formats each decoder accepts.

| API | AV1 in hardware, by the source | 4:0:0 | 4:4:4 | 12-bit | how the planes come back |
| --- | --- | --- | --- | --- | --- |
| **VideoToolbox** (Apple) | A17 Pro and M3 and later: "a dedicated AV1 decoder" (S, Apple newsroom 2023-09-12, 2023-10-30); profiles not published | not published | not published | not published | `CVPixelBuffer` in the session's output format, locked and read (D) |
| **MediaCodec** (Android) | `AV1ProfileMain8`, `AV1ProfileMain10` (+HDR variants), API 29; no High or Professional constant (S, `MediaCodecInfo.CodecProfileLevel`) | not in the API's names | **no constant** | **no constant** | `Image`: `YUV_420_888` (API 19), `YCBCR_P010` (API 31) (S, `ImageFormat`) |
| **VA-API** (Intel) | `VAProfileAV1Profile0/1` exist (S, libva `va.h:537–538`); Intel's driver decodes AV1 8-bit to `NV12` and 10-bit to `P010` from Tiger Lake (Gen12) on (S, media-driver `media_features.md:28–31`) | no output format listed | no output format listed | no | `vaDeriveImage`/`vaGetImage` of the surface (D) |
| **VA-API** (AMD, Mesa) | AV1 decode on VCN ≥ 3.0 except VCN 3.0.33; 12-bit (`PROFILE2`) on VCN 4.0.0 and ≥ 5.0 (S, Mesa `si_get.c:470–473`) | the `mono_chrome` flag reaches the firmware (S, `radeon_vcn_dec.c:731, 869`) | — | VCN 4.0.0, ≥ 5.0 | as above |
| **NVDEC** (NVIDIA) | "AV1 Main Profile decoding" on GA10x, Ada and Blackwell (S, NVDEC application note 13.0, §2) | **yes**: FFmpeg routes `GRAY8`/`GRAY10` AV1 to NVDEC alone (S, FFmpeg n8.0 `av1dec.c:643–651`); `mono_chrome` in `CUVIDAV1PICPARAMS` (S, `cuviddec.h:773`) | no (Main only) | no | `cuvidMapVideoFrame` → `NV12`/`P016` device memory (S, `cuviddec.h:93–101`), copied to the host (D) |
| **D3D11 / D3D12 / Media Foundation** (Windows) | `D3D12_VIDEO_DECODE_PROFILE_AV1_PROFILE0/1/2`, `_12BIT_PROFILE2`, `_12BIT_PROFILE2_420` (S, DirectX-Headers `d3d12video.h:6329–6333`) | per driver | per driver (Profile1) | per driver | a staging copy of the `NV12`/`P010` texture, mapped (D) |
| **Vulkan Video** | `VK_KHR_video_decode_av1`; `STD_VIDEO_AV1_PROFILE_MAIN/HIGH/PROFESSIONAL` (S, Vulkan-Headers `vulkan_video_codec_av1std.h:48–50`) | `VK_VIDEO_CHROMA_SUBSAMPLING_MONOCHROME_BIT_KHR` exists (S, `vulkan_core.h:9206`); per driver | per driver | per driver | `vkCmdCopyImageToBuffer` (D) |

**5.1 FFmpeg's view, as a cross-check** (S, FFmpeg n8.0 `libavcodec/av1dec.c:554–651`). FFmpeg offers 8- and
10-bit 4:2:0 AV1 to every hardware API it has (DXVA2, D3D11VA, D3D12VA, NVDEC, VA-API, VDPAU, VideoToolbox, Vulkan).
It offers 12-bit, 4:2:2 and 4:4:4 only to Vulkan, and grey only to NVDEC. That is FFmpeg's routing, not each chip's
limit, but it is what an ffmpeg-based native viewer gets.

**5.2 Throughput, where published.** NVDEC decodes AV1 at 790 (Ampere), 1 018 (Ada) and 1 119 (Blackwell) frames a
second, 1920×1080 4:2:0, at the highest video clock (S, NVDEC application note 13.0, §3). That is throughput across
sessions, not one frame's latency. The bit depth is not stated. No other vendor publishes a per-frame figure. Android's
media performance class bounds a hardware decoder's *initialization* at 40 ms under load (S, CDD 16 §2.2.7.1,
5.1/H-1-12), not a frame's decode.

**5.3 What a handset guarantees.** Every Android 16 handheld must decode AV1 for third-party applications (S, CDD 16
§2.2.2, 5.3/H-0-6), software allowed. One declaring media performance class V "MUST support AV1 hardware decoder
Main 10, Level 4.1" (S, CDD 16 §2.2.7.1, 5.1/H-1-14). Level 4.1's picture limit is under both tomosynthesis sets
([`../av1/README.md`](../av1/README.md) §Browser and device support).

## 6. Other codecs in hardware

| codec | in hardware | lossless | grey / > 10 bits | for this product |
| --- | --- | --- | --- | --- |
| **HEVC** | in > 95 % of smartphones (S, ScientiaMobile 2024 Q2); Intel from Ice Lake/Tiger Lake up to 12-bit 4:4:4 (S, `media_features.md:16–21`); NVIDIA "Main 4:2:2/4:4:4 10/12 profile (exclude YUV400)" (S, NVDEC note §1) | **in Main and Main 10**: `transquant_bypass_enabled_flag` is not constrained by either profile (S, H.265 (09/2023) §A.3.2, §A.3.3, §7.4.3.3.1) | 4:0:0 only in RExt's monochrome profiles; Android has `HEVCProfileMain400` from API 37 (S); FFmpeg routes no grey HEVC to hardware (S, `hevcdec.c:594–700`) | a lossless 8/10-bit 4:2:0 path that hardware would take is plausible. Grey would need GREY420's mid-grey chroma (D). HEVC's patent pools are the owner's question; not proposed |
| **VVC** | Intel Lunar Lake and Panther Lake, 8/10-bit 4:2:0 (S, `media_features.md:32–35`); `VAProfileVVCMain10` (S, `va.h:543`); Android `VVCProfileMain10` from API 37 (S) | — | — | nothing in any browser at the pinned Chromium; not pursued |
| **JPEG 2000 / HTJ2K** | no fixed-function decoder found. nvJPEG2000 is CUDA compute, not NVDEC: up to 16 bits a component, reversible 5/3, and "High throughput jpeg2000 (all code-blocks have to be HT code-blocks…)" (S, nvJPEG2000 docs) | reversible 5/3 | up to 16 bits | native, NVIDIA only. Row FASTHTJ2K's WebGPU block decoder is the browser's GPU route ([`README.md`](README.md) §Faster HTJ2K in the browser) |

## 7. Coverage

* **Phones.** 9.76 % of smartphone device usage had AV1 hardware decode in 2024 Q2. The A17 Pro was 3.72 % and the
  Snapdragon 8 Gen 2 1.90 % (S, ScientiaMobile, 2024-08-08). Bias: a device-detection vendor's sample of its own
  customers' web traffic, weighted by use. Meta's David Ronca, February 2025: "maybe 10 % of the Android ecosystem
  has hardware AV1 decoders" (S, Streaming Media, 2025-02-21): an engineer's estimate, not a measurement. No
  independent share for 2025–2026 was found.
* **Desktops** (D, Steam Hardware & Software Survey, "All video cards", September 2026). Each listed GPU is classed
  by §5's sources:
  * **decodes AV1, 69.6 %:** RTX 30/40/50 and RTX 2050 (all Ampere or later), Intel Iris Xe and Arc (Gen12 and
    later), Radeon RX 6600–6900, 7000 and 9000, Radeon 780M;
  * **does not, 17.2 %:** GTX 10/16, RTX 20 (Turing), GT 1030, RX 500, RX 5700, RX 6500 XT (VCN 3.0.33, excluded at
    `si_get.c:473`), Vega, Intel UHD 620/630 and HD;
  * **cannot be told, 13.2 %:** "Other" 8.33 % and generic names such as "AMD Radeon Graphics" and "Intel UHD
    Graphics", which span generations.

  Bias: gamers who opted in, Windows-heavy. Hospital workstations, and the medical-grade displays' GPUs in
  particular, are not in it.
* Coverage counts only decoders of AV1 *Main 4:2:0*. The share that would take the product's own layouts (4:0:0,
  4:4:4 RCT, 12-bit) is unknown and smaller (D, §5).

## 8. What it means for the AV1 design

* **The split into 8/10-bit planes** ([`../av1/README.md`](../av1/README.md) §The bit split, explained) was made for
  software decoders, and hardware keeps it. Every top at 8–10 bits and every 8-bit low is a Main stream that a
  conforming decoder must take (S, Annex A.2). The 14-bit series' 12-bit top is Professional, which no
  phone API names (S, §5) and no Chromium path but Windows advertises.
* **4:0:0 is the obstacle, not depth.** The AV1 spec puts monochrome in Main; Chromium's hardware front end and
  most published decoder tables do not (§4.1, §5). Coding grey as 4:2:0 with mid-grey chroma (row GREY420: +0.20–0.23 %
  bytes, built, not adopted, [`../av1/payload-format.md`](../av1/payload-format.md) §8-bit grey as 4:2:0) would make
  every grey stream a plain Main 4:2:0 stream, the one layout every hardware decoder here takes (D). That is a
  reason to revisit GREY420 for a native viewer; it is not one for the browser, where 10-bit read-back is closed at
  gate 3 anyway.
* **Chromium's 12-bit refusal** (M, row WCAP: libgav1 built with `LIBGAV1_MAX_BITDEPTH=10`, row VERSIONS) is the
  software path's. Its hardware path takes 12 bits only at Professional on Windows (S, §4.1), and the page could
  not read the result (gate 3).
* **The measured decoders** (rows 8 DEC, 37 XBROWSER, 49 DECODE) ran headless with no GPU, so
  `prefer-hardware` was unsupported in every cell (M, row WCAP). Their verdicts are software verdicts, and §4 says
  hardware would not change the browser's: the WebCodecs path the client chose is the right one to have measured.
  Row 49's reused-buffer `copyTo` would have nothing to copy from a hardware 10-bit frame.
* **Lossless decode in hardware** is in the spec for every profile (S, §1); `CodedLossless` reaches AMD's firmware
  as a per-segment flag (S, `radeon_vcn_dec.c:993`). Whether each chip's implementation is right is not published
  anywhere read here.

## 9. What a device run would settle

Proposed for the owner, not queued: a native harness on three machines (an M3 Mac, an Ampere or later NVIDIA GPU
under Linux, an Intel Gen12 laptop), decoding the lab's lossless AV1 streams through VideoToolbox, NVDEC and VA-API.
Every plane is hashed against the encoder input's checksum (the rule of [`README.md`](README.md) §Ground truth).

* **Cells:** 8- and 10-bit × 4:0:0, 4:2:0 (GREY420 form) and 4:4:4 RCT × intra and G = 8.
* **Predictions** (from §5): every 4:2:0 cell exact on all three. 4:0:0 exact on NVDEC, refused or unknown on the
  other two. 4:4:4 refused on all three. A wrong sample in any cell means a hardware lossless defect, and that
  decoder serves nothing.
* **Then, only for exact cells:** a decode-plus-read-back time per frame, interleaved against dav1d native on the
  same frames (CLAUDE.md §Measurement).

The same for Chromium on a desktop GPU with `no-preference`. It would confirm gate 2's 4:0:0 refusal and gate 3's
`P010` refusal, and decide whether GREY420's `NV12` comes back exact.

## 10. Sources

Read 2026-10-13. Each SHA-256 prefix is of the copy read.

**Chromium 141.0.7390.37** (the lab's pin), via `raw.githubusercontent.com/chromium/chromium/141.0.7390.37/`:
`media/gpu/av1_decoder.cc` (`5c815bbc607a`); `media/gpu/vaapi/vaapi_wrapper.cc` (`fff466f8d1e3`);
`media/gpu/vaapi/av1_vaapi_video_decoder_delegate.cc` (`5c0917c18661`);
`media/gpu/windows/supported_profile_helpers.cc` (`97a00d0e7a1c`); `media/gpu/windows/d3d11_video_decoder.cc`
(`aa038e247c67`); `media/gpu/mac/video_toolbox_video_decoder.cc` (`6d3e544aac74`);
`media/gpu/android/media_codec_video_decoder.cc` (`fc17fc32b9a5`); `media/gpu/android/video_frame_factory_impl.cc`
(`08b8274cce04`); `media/base/supported_video_decoder_config.cc` (`53c5043cc75d`); `media/base/media_switches.cc`
(`7b928cd54e30`); `third_party/blink/renderer/modules/webcodecs/video_frame.cc` (`312d100462d8`),
`video_decoder_broker.cc` (`46590f523d36`), `decoder_template.cc` (`ffebf289662d`).

**Native APIs and drivers:** FFmpeg `n8.0` `libavcodec/av1dec.c` (`65f0ce82927a`), `libavcodec/hevc/hevcdec.c`
(`cf1000432ffd`); libva `2.22.0` `va/va.h` (`7a3da5d93255`); Intel media-driver `intel-media-25.3.0`
`docs/media_features.md` (`45d52242205d`); Mesa `mesa-25.2.0` `src/gallium/drivers/radeonsi/si_get.c`
(`1d90c032e560`), `radeon_vcn_dec.c` (`560b14ce18be`); nv-codec-headers `n13.0.19.0`
`include/ffnvcodec/dynlink_cuviddec.h` (`1244165ea552`); DirectX-Headers `v1.616.0` `include/directx/d3d12video.h`
(`501601d8eb22`); Vulkan-Headers `v1.4.328` `include/vk_video/vulkan_video_codec_av1std.h` (`23d31b4b03ed`),
`include/vulkan/vulkan_core.h` (`fb8ef9af8011`).

**Specifications:** AV1 Bitstream & Decoding Process Specification, v1.0.0 with Errata 1
(`aomediacodec.github.io/av1-spec/av1-spec.pdf`, `ec44e9fc42c4`), §6.4.1, Annex A.2; ITU-T H.265 (V9) (09/2023)
(`30b1f2dc016e`), §A.3.2, §A.3.3, §7.4.3.3.1; W3C WebCodecs, Working Draft 7 October 2026 (`4d3cfc10f8ce`), §9.4.1,
§9.8.

**Vendor documents** (unversioned pages; the hash is the copy read): NVIDIA Video Codec SDK 13.0 NVDEC application
note (`98b3bab5664a`) and programming guide (`087a77ceb54e`); nvJPEG2000 documentation, index (`90d4ffb32263`) and
release notes (`e86401a4ce61`); Android `MediaCodecInfo.CodecProfileLevel` (`bce5ece65090`), `ImageFormat`
(`cd692a2bcab2`), Android 16 CDD (`886c7f4df1c3`); Apple newsroom, "Apple unveils iPhone 15 Pro and iPhone 15 Pro
Max", 2023-09-12 (`b073191771e0`), and "Apple unveils M3, M3 Pro, and M3 Max", 2023-10-30 (`d2a4151de4f6`).

**Coverage:** ScientiaMobile, "Update: AV1 Hardware Decode Adoption Hits 9.76% in 2024Q2", 2024-08-08, read at
`www-2018.scientiamobile.com/?p=29961` (`bd4f2ef064f9`; the main site's copy returned 404); Streaming Media, "Meta's
David Ronca Talks Benchmarking and Deploying AV1 in the Android Ecosystem", 2025-02-21 (`42b0319df2ef`); Valve, Steam
Hardware & Software Survey, video cards, September 2026 column (`store.steampowered.com/hwsurvey/videocard/`,
`dbfa65fca588`).

**Read 2026-11-14 (§11–§17).** Each SHA-256 prefix is of the copy read.

*Chromium* 157.0.8103.79 (the newest 157 on Android's stable channel, chromiumdash, 2026-11-14; the phone's exact
157 build is not recorded) and 158.0.8127.36 (Android stable, 2026-11-14), via
`raw.githubusercontent.com/chromium/chromium/<tag>/`. At 157: `media/gpu/av1_decoder.cc` (`c737d6d8a82e`),
`media/gpu/android/media_codec_video_decoder.cc` (`55fb0c80da25`), `media/gpu/android/video_frame_factory_impl.cc`
(`fb4bc6c5fb50`, the same at 158), `media/base/supported_video_decoder_config.cc` (`53c5043cc75d`),
`media/base/video_codec_string_parsers.cc` (`a5df66a60183`), `media/base/media_switches.cc` (`08f2faab9844`),
`third_party/blink/renderer/modules/webcodecs/video_frame.cc` (`28e41e741719`), `video_decoder.cc`
(`ac73aca73b90`), `video_decoder_broker.cc` (`88b37012a004`), `video_pixel_format.idl` (`fbc4e1fd5cd0`),
`third_party/blink/renderer/modules/webgpu/external_texture_helper.cc` (`cec4fc80a2cc`),
`third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc` (`b89b445caeea`),
`third_party/blink/renderer/platform/graphics/video_frame_image_util.cc` (`f1b93846c0b4`). At 158:
`media/gpu/av1_decoder.cc` (`fb902c60ef53`), `webcodecs/video_frame.cc` (`8a066993aa2a`),
`webgpu/external_texture_helper.cc` (`2e1f8985b250`). At 141.0.7390.37:
`third_party/blink/renderer/platform/runtime_enabled_features.json5` (`645f5b7eaba4`).

*Engines:* WebKit `main` `b4291f793ce5`, `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`
(`6de1b27d7994`); Gecko (`github.com/mozilla-firefox/firefox`) `main` `c72617c01649`,
`dom/media/ImagePixelFormat.cpp` (`7de5cba7d740`), `dom/media/webcodecs/VideoDecoder.cpp` (`00f2e761b4ae`).

*Specifications:* W3C WebCodecs, Working Draft 9 November 2026 (`www.w3.org/TR/webcodecs/`, `0fa152953edb`); W3C
WebGPU, Candidate Recommendation Draft 15 September 2026 (`www.w3.org/TR/webgpu/`, `7c6768143075`); W3C WGSL,
Candidate Recommendation Draft 6 November 2026 (`www.w3.org/TR/WGSL/`, `c7b8cc9d175f`); Khronos WebGL 1.0 and 2.0
`specs/latest/` at `KhronosGroup/WebGL` `main` `39443210f7f8` (`0735f489eba0`, `05da9e8c2110`). The AV1
specification as pinned above.

*Vendor documents:* Android reference, "Last updated 2026-08-03 UTC": `MediaCodecInfo.CodecProfileLevel`
(`77e960c06044`), `MediaCodecInfo.CodecCapabilities` (`bb803b9d9fc2`), `ImageFormat` (`e7427d7aabe8`); Qualcomm,
Snapdragon 8 Gen 2 Mobile Platform product brief, two revisions: the launch press kit's (PDF modified 2022-11-12,
`b802e2cc3ce7`) and the current one (modified 2024-11-19, `493f0b17eba3`); Qualcomm, Snapdragon 8 Elite (SM8750-3-AB)
product brief (modified 2025-02-14, `f9a7b000cebe`); MediaTek, Dimensity 9200 product page (`55eec0742823`); Apple
developer documentation JSON for `VTIsHardwareDecodeSupported(_:)` (`68a68a5f9b48`),
`kCVPixelFormatType_420YpCbCr10BiPlanarFullRange` (`79f8ddf79873`), `kCMVideoCodecType_AV1` (`9daf916c7835`).
Not read: Samsung's Galaxy S23 page and its Exynos and Google Tensor pages, which serve no text without a script.

## 11. The optimal-quality view, 2026-11-14

**The question, again:** which hardware decode paths can serve the optimal-quality view, in which browsers and
engines, and what would each need? The view as coded is **grey 4:0:0 at D = 8 or 10, Main profile** (`--monochrome
--profile=0`; D > 10 is always the depth cut, so 12 bits never reaches a viewer; S,
[`../av1/payload-format.md`](../av1/payload-format.md) §Optimal quality, §Depth cut). `dbts_b1` is 10-bit; `dbts_a1`
and `dbts_c1` are 12-bit sources whose view is the 10-bit cut. The view must be painted with its window table, its
`valueAt` read, and, where the metadata carries it, checked against its reconstruction digest (XXH3-64 of the
decoded samples, `claude/oq-integrity-build:docs/av1/payload-format.md` §Integrity).

What the sources show (each in §12–§15):

* **On the phone (Android, Chrome 157), no hardware path gives the view's samples back, at any depth.** Chromium
  wraps every MediaCodec frame as RGB (`ABGR`) behind an external sampler, and `copyTo` of such a frame is `BGRX`,
  converted. Unlike desktop, Chromium does not refuse 4:0:0 there: the device codec decides, and Android's own API
  defines its AV1 profiles as "4:2:0" and has no monochrome AV1 profile.
* **On desktop Chromium, 4:0:0 is still refused before the hardware** (157 and 158), and 10-bit hardware frames
  (`P010`) still have no WebCodecs format. Only an 8-bit 4:2:0 stream comes back as planes (`NV12`).
* **The view need not be read back to be painted, but no browser path keeps more than 8 bits on the GPU today.**
  In Chromium 157 and 158 WebGPU's `importExternalTexture` imports only `NV12` without a copy, as 8-bit planes, and
  copies everything else into an 8-bit RGBA image: "High bit depth formats should also use F16, but do not yet." The
  WebGPU spec asks for "at least the precision of the source". WebGL's video upload goes through the same kind of
  8-bit image except on paths the source read here does not settle (§13).
* **The checks need samples.** The reconstruction digest and `valueAt` read the decoded samples. With no read-back
  of a 10-bit hardware frame in any browser, both are impossible on a hardware 10-bit view. At 8 bits on desktop
  they are possible from `NV12`.
* **So no browser hardware path serves the optimal-quality view as coded, on the phone or on desktop.** The nearest
  is GREY420 (8-bit 4:2:0, neutral chroma) on desktop Chromium: hardware decode and an `NV12` plane copy, 8 bits
  only. Native APIs return the planes (§5, confirmed in §15).

## 12. The gates at Chromium 157 and 158

**Gate 2, desktop: unchanged.** `AV1Decoder` still refuses anything but 4:2:0 and 4:4:4: "Only YUV 4:2:0 and YUV
4:4:4 are supported", `return kDecodeError` (S, 157 `media/gpu/av1_decoder.cc:335–338`; 158 `:389–392`).

**Gate 2, Android: it does not apply.** `media_codec_video_decoder.cc` at 157 includes no AV1 parser or
`AV1Decoder`. It lists one supported configuration per device codec with only `info.profile` and the coded sizes
(S, `:64–119`: `supported_configs.emplace_back(info.profile, info.profile, info.coded_size_min,
info.coded_size_max, …)`), and a configuration matches on profile, coded size and encryption alone (S,
`media/base/supported_video_decoder_config.cc:27–51`). The codec string's monochrome digit is parsed into a chroma
layout, `result.subsampling = VideoChromaSampling::k400` (S, `media/base/video_codec_string_parsers.cc:344–359`),
which that match never reads. So on Android, **`isConfigSupported({…, hardwareAcceleration: "prefer-hardware"})`
answers by profile and size**, not by layout (D), and a 4:0:0 stream is handed to the device's AV1 codec. Whether it
decodes is that codec's. Android's API names the AV1 profiles a codec can advertise as `AV1ProfileMain8`, "AV1 Main
profile 4:2:0 8-bit", and `AV1ProfileMain10`, "AV1 Main profile 4:2:0 10-bit" (S, `MediaCodecInfo.CodecProfileLevel`,
API 29), and has no monochrome AV1 constant. A codec therefore has no way to advertise 4:0:0 (D). The AV1
specification puts monochrome inside Main (§3); whether a given phone codec honours it is a device question (§17).

**`WebCodecsHBDFormatsEnabled`: shipped.** At 157 and 158 `IsFormatEnabled` lists `I420P10`, `I420P12`, `I422P10`,
`I444P10` and the rest with `return true` and no flag (S, `webcodecs/video_frame.cc:205–228` at 157). At 141 the flag
was already `stable` (§4.1, corrected).

**`P010`: not in WebCodecs, not in Chromium's list.** The spec's `VideoPixelFormat` enumerates `I420` … `I444AP12`,
`NV12`, `RGBA`, `RGBX`, `BGRA`, `BGRX` and no `P010` (S, WebCodecs WD 2026-11-09 §9.8); Chromium's IDL at 157 is the
same set (S, `video_pixel_format.idl`). `IsFormatEnabled` has no `PIXEL_FORMAT_P010LE`, so a hardware 10-bit frame's
`format` is null and `copyTo` throws "Operation is not supported when format is null." (S, `video_frame.cc:478–500`
at 157). A non-mappable frame above 8 bits fails before that: "Readback is not supported for high bit-depth formats"
(S, `:459–462`).

**Android still wraps every MediaCodec frame as `ABGR`.** "we need to use the pixel format as ABGR here(which
corresponds to 32bpp RGBA)", `VideoPixelFormat pixel_format = PIXEL_FORMAT_ABGR;` (S, 157 and 158
`media/gpu/android/video_frame_factory_impl.cc:150–157`). Such a frame "prefers an external sampler", and
"Externally-sampled frames can be read back as YUV (NV12/I420) or RGB": `NV12` or `I420` if the frame's format is
one, else `PIXEL_FORMAT_XRGB` (S, `video_frame.cc:465–476` at 157). An `ABGR` frame is neither, so `copyTo` gives
`BGRX` (D): the device's YUV-to-RGB conversion, 8 bits a channel, never the coded samples. Chromium 157 has
`kMediaCodecBlockModelOutput`, `FEATURE_DISABLED_BY_DEFAULT` (S, `media_switches.cc:1303`); what it would change is
not read here.

**`prefer-hardware` on Android is MediaCodec or nothing.** With `prefer-hardware` the broker's only factory is the
external (Mojo) one; `prefer-software` never creates it (S, `video_decoder_broker.cc:200–216`). Android's own
software AV1 codecs are left out for clear content unless `kAllowMediaCodecSoftwareDecoder`
(`FEATURE_DISABLED_BY_DEFAULT`, S, `media_switches.cc:1268–1269`; `media_codec_video_decoder.cc:86–98`), so a
`prefer-hardware` decoder on the phone is the device's hardware codec where one is listed (D).

## 13. Painting without a read-back

Today every view frame is copied out (`copyTo`, `client/decode/av1-webcodecs.js:137`) because the paint, the frame
check, `valueAt` and a decoded cache read samples. A software-decoded frame is already in memory, so that copy is a
memory copy; only a hardware frame makes it a GPU read-back (D). For a frame that stays on the GPU:

| | WebGL2 `texImage2D(VideoFrame)` | WebGPU `importExternalTexture` |
| --- | --- | --- |
| spec | `TexImageSource` includes `VideoFrame`; "the source image data is converted to the data type and format specified by the format and type arguments"; for DOM sources "commonly each channel's representation is an unsigned integer type of at least 8 bits" (S, WebGL 1.0 `texImage2D`, and WebGL 2.0's format table for `texImage2D`, at `39443210`) | "a sampleable 2D texture wrapping an external video frame" (S, WebGPU §6.4); colours of high bit depth "are preserved through color space conversion, with intermediate computations having at least the precision of the source" (S, §3.11) |
| Chromium 157/158 | GPU-to-GPU copies need an 8-bit source: "glCopyTextureCHROMIUM requires the source texture to be in 8-bit format. Converting 16-bits formatted source texture to 8-bits formatted texture will cause precision lost" (S, `webgl_rendering_context_base.cc:6640–6644`); the general path draws through `.format = GetN32FormatForCanvas()`, "N32 may be incorrect when drawing high bit depth frames" (S, `video_frame_image_util.cc:354–356`); a CPU `Y16` frame has its own path (`:6608`) | zero copy only for `NV12`, as `R8Unorm` and `RG8Unorm` planes (S, `external_texture_helper.cc:279–308` at 157); everything else is drawn into an N32 image: "High bit depth formats should also use F16, but do not yet." (S, `:401` at 157 and 158) |
| a 10-bit grey value reaches the shader as | 8 bits on the paths quoted; the YUV-plane upload into a half-float target (`CopyVideoFrameYUVDataToGLTexture`, `:6661`) was not traced to its intermediate's format: **unknown**, the probe's precision check (§17) | **8 bits** (D, from the two quotes); Chromium falls short of §3.11 here |
| on Android | the frame is already the external sampler's RGB, converted by the device (§12) | the same image, `ABGR`, not `NV12`: the N32 copy |

*Corrected in review:* the half-float upload (`CopyVideoFrameYUVDataToGLTexture`) is not a hardware frame's path.
It runs only `if (!media_video_frame->HasSharedImage() && …)`, for frames that "start on the CPU (e.g. video camera
frames)" (S, 157 `webgl_rendering_context_base.cc:6657–6661`). A hardware frame has a shared image and goes through
`CopySharedImageDirectlyToGLTexture` or `CopyVideoFrameTexturesToGLTextureViaIntermediateSI` (S, `:6672–6707`), whose
precision was not traced. The cell stays **unknown**, for those two calls. It decides nothing for the view: WebGL's
YUV-to-RGB conversion is unspecified ("The precise conversions may be specific to both the browser and file type", S,
WebGL 1.0 §Pixel Storage Parameters, `UNPACK_COLORSPACE_CONVERSION_WEBGL`), so no texture it fills can be checked
against a digest (§18.2).

**The window table (VOI)** maps a sample of D bits through the window to a display level. On 8 bits of a 10-bit
view, a window narrower than 1024 codes repeats display levels four codes at a time (D): a narrow window shows
steps a 10-bit view would not. A window table is a texture lookup either way, so the shader is not the obstacle;
the precision of the value it receives is.

**The reconstruction digest and `valueAt` without a read-back.** The digest is XXH3-64 over the decoded samples as
stored (two bytes a sample above 8 bits). A GPU could compute it only from a texture that holds those samples
exactly; no path above gives a 10-bit hardware frame's samples to a shader exactly (D). `valueAt` reads one sample:
`copyTo` takes a `rect` (S, WebCodecs §9.4 `VideoFrameCopyToOptions`), a cheap read of a few samples, but it
refuses a `P010` frame as the whole does (§12). So a hardware 10-bit frame can be painted (at 8 bits) but neither
checked nor sampled; the client's rule for an unchecked view frame applies to it.

## 14. Coded forms that reach hardware

* **4:2:0 with neutral chroma at 8 bits** (GREY420, `ingest.py --grey8 420`, built, not adopted): +0.20–0.23 %
  bytes (≈ 100–140 B a frame) on the two 8-bit grey series, lossless (M, row GREY420,
  [`../av1/payload-format.md`](../av1/payload-format.md) §8-bit grey as 4:2:0). For the lossy view the cost is
  **not measured**: the chroma planes are constant, so a small cost is expected (D), not shown. The client already
  takes it (`g8f`, `client/decode/av1-payload.js:172`, and its neutral-chroma check, `av1-webcodecs.js:146`).
* **4:2:0 with neutral chroma at 10 bits:** not built (`--grey8` is 8-bit only). It would reach every desktop
  hardware decoder of Main 10, then fail at gate 3 (`P010`) on desktop and come back as RGB on Android (§12). Building
  it changes no browser verdict today (D).
* **Which decoders take 4:0:0,** by vendor documentation: NVDEC (`mono_chrome` in `CUVIDAV1PICPARAMS`, FFmpeg's
  routing, §5); AMD's firmware receives the flag (§5); Vulkan Video has
  `VK_VIDEO_CHROMA_SUBSAMPLING_MONOCHROME_BIT_KHR`, per driver (§5). Intel's media-driver lists no 4:0:0 output
  (§5). Android's API has no way to say (§12). Apple publishes no AV1 profile list (§15). No other vendor document
  read here names AV1 monochrome.

## 15. Phones, native, and beyond AV1

**Android SoCs with a hardware AV1 decoder, by their vendors' documents:**

| SoC | the vendor's words | AV1 4:0:0 / 10-bit |
| --- | --- | --- |
| Snapdragon 8 Gen 2 (Galaxy S23; part SM8550-AC per the current brief's "Part Number: SM8550-AB, SM8550-AC2") | both product-brief revisions: "Hardware-accelerated H.265 and VP9 decoder" — **no AV1** (S, Qualcomm briefs 2022-11-12 and 2024-11-19); press coverage of Qualcomm's launch release reports AV1 decode up to 8K60, but the release itself was not read | not documented |
| Snapdragon 8 Elite (SM8750-3-AB) | "Hardware-accelerated H.265, VP9, AV1 decoder" (S, Qualcomm brief 2025-02-14) | not documented |
| Dimensity 9200 | "Video Playback H.264 HEVC Vp-9 AV1" (S, MediaTek product page) | not documented |
| Apple A17 Pro, M3 and later | "a dedicated AV1 decoder" (S, Apple newsroom, §5) | not published |

*Corrected in review:* Qualcomm's release of 2022-11-15 is script-only at qualcomm.com and was not read there. Its
republication attributed to Qualcomm (edge-ai-vision.com, "Nov 15, 2022") says: "This is also the first Snapdragon to
include an AV1 codec with support for video playback up to 8K HDR at 60 frames per second." That is a copy, not the
official page, and it contradicts both briefs. Nor does a Samsung source read here say which SoC the Galaxy S23 uses:
"Galaxy S23 = Snapdragon 8 Gen 2 (SM8550-AC)" is **unsourced**. The device answers both (§17: `chrome://gpu`, the codec name).

So **whether the Galaxy S23 decodes AV1 in hardware is not settled by its vendor's own brief**, which lists none;
ScientiaMobile counted the Snapdragon 8 Gen 2 among AV1 decoders (§7). The phone answers it (§17). No vendor
document read lists AV1 4:0:0 or a Codec2 component's layouts. Android's CDD requires an AV1 decoder for every
handheld, software allowed, and Main 10 in hardware only at media performance class V (§5.3).

**iOS.** Hardware AV1 reaches Safari's `<video>` only (§4.3); WebCodecs AV1 is off by default and is software when
on (re-checked at WebKit `b4291f79`, §4.3). Apple documents `VTIsHardwareDecodeSupported(_:)`: "Returns a Boolean
value that indicates whether the current system supports hardware decode for the specified codec" (S, Apple
developer documentation), and `kCMVideoCodecType_AV1` exists, but no AV1 profile, layout or depth list was found.
The 10-bit output format `kCVPixelFormatType_420YpCbCr10BiPlanarFullRange` exists (S); that it is AV1's output is
not documented (D, unverified).

**Native, §5 confirmed for the view** with one addition: every API there returns the decoder's own planes, so a
native viewer keeps 10 bits and can compute the reconstruction digest and `valueAt` from them (D). Android's
`ImageFormat.YCBCR_P010`: "Each sample is represented by a 16-bit little-endian value, with the lower 6 bits set to
zero" (S, `ImageFormat`, API 31), and `CodecCapabilities.COLOR_FormatYUVP010`, "10 MSB of actual data" (S, API 33).
Android also keeps `COLOR_FormatL8`, "8 bits per pixel Y color format" (S, API 16); no AV1 codec is documented to
output it. The 4:0:0 limit of §5 is unchanged: a native viewer on Android would need GREY420's form or a codec that
honours Main's monochrome.

**Beyond AV1, named only** (decode is the phone's bound): nvJPEG2000, CUDA compute, HT code-blocks only (§6);
row FASTHTJ2K's WebGPU block decoder ([`README.md`](README.md) §Faster HTJ2K in the browser). No phone GPU HTJ2K
decoder was found in a vendor document. Not evaluated.

## 16. What the sources decide

| path | stream form | decodes in hardware? | painted without read-back at full precision? | samples read back? |
| --- | --- | --- | --- | --- |
| Chrome Android (157) WebCodecs `prefer-hardware` | 8/10-bit 4:0:0 (as coded) | the device codec's; not refused by Chromium; unknown | no: RGB, 8 bits | no: `BGRX`, converted |
| Chrome Android (157) | 8-bit 4:2:0 neutral (GREY420) | yes where an AV1 codec is listed | 8-bit RGB, converted | no: `BGRX` |
| Chrome Android (157) | 10-bit 4:2:0 neutral (not built) | yes where Main 10 is listed | no: 8-bit RGB | no |
| Chrome desktop (157/158) | 8/10-bit 4:0:0 | **no**: refused at gate 2 | — | — |
| Chrome desktop | 8-bit 4:2:0 neutral | yes where Main is advertised | 8 bits is full precision: yes, `NV12` zero copy (WebGPU) | yes, `NV12` plane copy |
| Chrome desktop | 10-bit 4:2:0 neutral | yes | no: 8 bits (WebGPU); WebGL unknown | no: `P010` has no format |
| Firefox | any | remote frames come back `BGRX` | — | 8-bit RGB only |
| Safari | any | `<video>` only | — | no planes |
| native (VideoToolbox, MediaCodec, VA-API, NVDEC, D3D12, Vulkan) | 4:2:0 at 8/10 bits; 4:0:0 where §5 shows | per §5 | yes, own planes | yes |
| any browser, software (today) | as coded | — | the copy is a memory copy | yes |

*Corrected in review (amendment 1):* the view is checked in production, so "painted without read-back" serves
nothing unless the samples also reach an XXH3. Only two rows reach one: desktop Chromium's 8-bit GREY420 (`NV12`
plane copy) and native. Every other row is a display path (§18.1).

**Decided by the sources alone:**

* No browser hardware path serves the optimal-quality view at 10 bits with its digest and `valueAt`; on the phone
  none serves it at any depth with them. A hardware path in a browser is a display path for this view (§2's
  definition), not a checked one.
* `isConfigSupported` with `prefer-hardware` cannot tell whether the view's layout decodes, on Android or desktop:
  it matches profile and size (§12). Only a decoded unit can.
* On desktop, GREY420 at 8 bits is the one exact hardware form; it would serve an 8-bit view only.

**Not decided:** whether the Galaxy S23 has a hardware AV1 decoder at all (its vendor's brief says no; §15);
whether its codec decodes 4:0:0; WebGL's precision on the half-float YUV upload; whether hardware decode is faster
than software once a hardware path is chosen. Any choice between an 8-bit hardware view and the 10-bit software one
is the owner's.

## 17. A device probe for the phone round

Exploratory, deciding nothing (the phone round's cell 3). On the phone and, where the round has one, a desktop GPU.
Each probe is one tiny lossless unit with its sequence header, configured with the codec string the client derives
from it (`codecString`, `client/decode/av1-payload.js:161`), decoded once:

| probe | unit | configs |
| --- | --- | --- |
| `g8` | 8-bit 4:0:0, Main | `prefer-hardware`, then `prefer-software` as the control |
| `g10` | 10-bit 4:0:0, Main | the same |
| `g8f` | 8-bit 4:2:0, mid-grey chroma, full range (GREY420) | the same |
| `g10f` | 10-bit 4:2:0, mid-grey chroma (needs a lab-only unit: `--grey8` is 8-bit) | the same |
| `ramp10` | 10-bit 4:2:0 neutral, luma a ramp over 0…1023 (lab-only) | `prefer-hardware`, for the precision check |

Each at the existing 16 × 16 (`av1-probe.js`) and at 256 × 256, since a device codec lists a minimum coded size and
`isConfigSupported` refuses below it (§12, `coded_size_min`).

**Record, per probe and config:** `isConfigSupported`'s `supported`; the decode's outcome (a frame, or the error's
name and message); the frame's `format`; `copyTo`'s layout or its exception; the samples against the unit's source
(exact or not); `chrome://media-internals`' decoder name for the player (MediaCodec or a software decoder) and
`chrome://gpu`'s "Video Acceleration Information" list; and for `ramp10` the count of distinct values read back
from a WebGL2 `RGBA16F` texture filled by `texImage2D(VideoFrame)` and from a WebGPU pass sampling
`importExternalTexture` into an `rgba16float` target: more than 256 distinct values means more than 8 bits reached
the shader. **Predictions** (from §12–§13): on the phone, `g8f` and `g10f` decode in hardware if an AV1 codec is
listed, and come back `BGRX`; `g8` and `g10` unknown; `ramp10` at most 256 values on both APIs. On desktop Chromium,
`g8` and `g10` fail on their first chunk; `g8f` comes back `NV12` exact; `g10f` throws at `copyTo`; `ramp10` 256
values through WebGPU, WebGL unknown.
