# Hardware decode

*Queue row 161, HWDECODE, 2026-10-13. Theory only: nothing built or run, no device touched. One question: **which
hardware decode paths can serve the diagnostic viewer?** Every choice stays the owner's.*

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
* A frame whose shared image "prefers an external sampler" reads back only as `BGRX`: RGB, converted (`:455–462`). On
  Android every MediaCodec frame is wrapped as `ABGR` (S, `media/gpu/android/video_frame_factory_impl.cc:155`), so
  **an Android hardware frame never comes back as its YUV planes** (D).
* `copyTo({format: "RGBA"…})` is a colour conversion (`:1390–1404`): not exact.
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

### 4.3 Safari

From the same row's reading of WebKit's source (S, [`README.md`](README.md) §Why, and what would make it exact):
WebCodecs AV1 is behind `WebCodecsAV1Enabled`, off by default on Cocoa, and is libwebrtc's dav1d in software,
refusing anything but 8-bit 4:2:0. `<video>` AV1 on Apple is hardware only. ScientiaMobile reports that Safari plays
AV1 only on devices with a hardware decoder (S, ScientiaMobile 2024 Q2). Its read-back is the `<video>`-to-canvas path,
RGB (D). No Safari path reads hardware AV1 planes.

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
