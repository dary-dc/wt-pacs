# Hardware decode: what a container has to do with it, and what comes back

*Theory, 2026-10-14: read from specifications, vendor documentation and the engines' source at their main branches
(§9), set against what this repository has already measured on the AV1 branches (cited by the row of `docs/av1/queue.md` at `e8f6374` on `claude/av1-unified`). Hardware
support changes month to month; every claim is as of the date it was read. Nothing here ran on a GPU: this container
has none.*

## Contents

1. [The answer in four lines](#1-the-answer-in-four-lines)
2. [A container does not turn on hardware decode](#2-a-container-does-not-turn-on-hardware-decode)
3. [What AV1 asks of a hardware decoder](#3-what-av1-asks-of-a-hardware-decoder)
4. [The browser's video element and MSE](#4-the-browsers-video-element-and-mse)
5. [WebCodecs, per engine](#5-webcodecs-per-engine)
6. [Native decoders](#6-native-decoders)
7. [HTJ2K](#7-htj2k)
8. [What survives on each path, and a route worth measuring](#8-what-survives-on-each-path-and-a-route-worth-measuring)
9. [Sources](#9-sources)

## 1. The answer in four lines

* **Hardware decode belongs to the codec and the decoder, not the container.** Every hardware API takes AV1 OBUs; a
  container only matters to the browser's video element, MSE and the OS players.
* **The video element never hands back samples**: canvas, WebGL and WebGPU see 8-bit or colour-converted RGB. It is a
  display path, not a diagnostic one ([`guide.md`](guide.md) §8 shows 483 grey levels arriving as 187).
* **Chrome's hardware AV1 path refuses monochrome** before any GPU sees it, and **cannot read back 10-bit hardware
  frames**; our 4:0:0 streams decode exactly only in software there today.
* **A route worth measuring**: code each stream as lossless 8-bit **4:2:0 with constant chroma** (the repository's
  GREY420 form) and split deeper samples 8 + 8, so Chrome's hardware decoder accepts it and its NV12 read-back is
  exact, checked every frame against the frame digest. Whether any GPU decodes AV1 *lossless* bit-exactly is
  documented by nobody and has to be run.

## 2. A container does not turn on hardware decode

* **WebCodecs** takes an AV1 `EncodedVideoChunk` in the low-overhead format, `description` unused (the AV1
  registration): no container anywhere. The product already decodes this way.
* **VA-API, DXVA/D3D12, NVDEC and Vulkan Video** take picture parameters parsed by the application from the OBUs
  (`VADecPictureParameterBufferAV1`, `DXVA_PicParams_AV1`, the CUVID and Vulkan `Std` structures).
* **VideoToolbox** is the exception in form only: its format description needs an `av1C` record (four bytes and the
  sequence header), which an application builds without any file (Apple developer forum report).
* **What a container adds** is a demuxer the media stack runs for us: the video element and MSE need MP4 or WebM, the
  OS players need a file. It does not change which decoder runs; profile, depth, chroma format and the engine's policy
  decide that.

So the team's intuition holds: "hardware playback" is not something MKV or MP4 gives; it is something the client
reaches for frames from any source, including our frame table.

One consequence of the AV1 registration: a WebCodecs **key chunk must contain a `KEY_FRAME`** (not an `INTRA_ONLY`
frame); Chromium checks it with a key-frame parse on every chunk marked key. Our all-intra payloads are key frames.

## 3. What AV1 asks of a hardware decoder

From the AV1 specification (Annex A and the colour-config syntax):

* **Main** (profile 0): 4:2:0 **or monochrome**, 8 or 10 bits. **High** (1): adds 4:4:4, and cannot be monochrome.
  **Professional** (2): adds 12 bits and 4:2:2.
* Our streams: grey 8/10-bit is Main, **grey 12-bit is Professional**, RGB through the RCT (4:4:4) is High.
* **Lossless is not a profile feature**: `CodedLossless` (q index 0, no deltas) forces 4×4 transforms (the
  Walsh-Hadamard), turns off the loop filter and CDEF, and any conformant decoder of the profile must decode it. The
  Argon conformance streams claim "complete coverage of every equation in the core specification", and dav1d runs them.
  **Whether each hardware vendor passes Argon's lossless and monochrome streams is not public**, and no report either
  way was found.
* **Fixed-function decoders are almost all Main**: 4:2:0 at 8/10 bits. So 12-bit (Professional) and RGB (High) are
  effectively software only, and monochrome depends on the vendor and on the driver's caller.
* AV1 has **no in-band decoded-picture hash** (unlike HEVC's SEI; from memory, not re-read), so exactness has to be
  checked by the application, as the product's frame digests already do.

## 4. The browser's video element and MSE

* **Pipeline**: demux (MP4 or WebM through MSE) → decode (the engine picks hardware or software) → YUV-to-RGB and
  scaling → compositor. The page never sees the decoded planes.
* **Every way to read pixels converts them**: a 2D canvas is `unorm8` (or `float16`) RGB after colour conversion; WebGL 2
  uploads a video only as ≤ 8-bit unsigned, half float or float; WebGPU's `importExternalTexture` samples RGBA after the
  engine's conversion. The guide measured it: limited-range 10-bit grey read back as 8-bit RGBA, 483 source levels as
  187, not invertible.
* **What plays**: Chrome plays monochrome and 12-bit AV1 in software (dav1d), so the element shows them; Firefox's dav1d
  wrapper **skips I400 pictures**, so monochrome AV1 shows nothing; Safari plays AV1 only with a hardware decoder (Safari 17
  release notes), which is Main.
* **This is the path Cornerstone3D takes for DICOM video** ([`dicom.md`](dicom.md) §7): fine for showing an 8-bit cine,
  and for a pre-windowed 8-bit preview; not for full-depth window/level, measurement or an exactness check.

## 5. WebCodecs, per engine

**Chrome.**

* **Software (dav1d)**: monochrome comes back as `I420`/`I420P10` with synthesised mid-grey chroma, the Y plane exact;
  `copyTo` without a `format` copies the planes untouched. This is what the product uses (`prefer-software`), measured
  exact in the repository (queue rows 43 and 74; [`guide.md`](guide.md) §8 again: 160 of 160).
* **12-bit is refused before any decoder runs**: `decode()` parses the key chunk with libgav1's OBU parser, built for at
  most 10 bits in Chromium 141, 154 and 155 (measured, `docs/decode/README.md` at `e8f6374` on `claude/av1-unified`). The research notes
  read dav1d's wrapper as able to return `I420P12`; the measured refusal wins.
* **Hardware (VA-API on Linux, D3D11 on Windows, VideoToolbox on macOS)** shares one front end, `media/gpu/av1_decoder.cc`,
  which maps monochrome to 4:0:0 and returns a decode error: "Only YUV 4:2:0 and YUV 4:4:4 are supported". A policy
  refusal, independent of the GPU. The macOS decoder also advertises Main only. Whether Chrome then falls back to
  software silently was not established (an NVIDIA forum thread shows such a switch happening invisibly to the page).
* **No 10-bit read-back from hardware**: in `video_frame.cc`, a frame the CPU cannot map with a depth other than 8 has
  no copy format ("Readback is not supported for high bit-depth formats"). 8-bit NV12 and I420 hardware frames are read
  back as they are.
* **There is no grey pixel format**: `VideoPixelFormat` is I420/I422/I444 at 8, 10 and 12 bits (with alpha variants),
  NV12 and four RGB formats; no Y-only, no P010.
* **`isConfigSupported` does not tell**: it answered yes to every 12-bit string in the repository's runs and to every
  string the guide tried. Decoding a known frame is the test (the product's per-layout probe).
* Android Chrome uses MediaCodec without that front end: device-dependent, untested.

**Firefox**: refuses monochrome, and returns everything else as 8-bit `BGRX` through a compositor texture (bug
1969762, assigned, patches for planar read-back pending). Measured in the repository (row 74): 8-bit GBR and **8-bit grey
coded as full-range 4:2:0** come back exact; 10-bit is cut to 8.

**Safari**: two sources disagree and a device has to settle it. WebKit bug 269908 (fixed February 2024) enabled
WebCodecs AV1 on Cocoa when a hardware decoder exists (A17 Pro, M3 and later); the repository's reading of the 2026
source (row 74) found it behind a preview preference, off by default, decoding in software through libwebrtc's dav1d
at 8-bit 4:2:0 only. WebKit bug 309450: `copyTo` lacks the `format` and `colorSpace` options. WebKit bug 325884 (fixed
2026-10-02): the software VP9 WebCodecs path dropped 4:4:4 frames and corrupted 12-bit ones, a reminder that every path
needs an exactness test.

## 6. Native decoders

For the planned native client ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) has the browser's; the native plan is
`docs/native/README.md` at `e8f6374` on `claude/av1-unified`). All take OBUs; all document AV1 4:2:0 at 8 and 10 bits; **none documents
lossless, for or against**.

| API | AV1 | 4:0:0 | output | notes |
| --- | --- | --- | --- | --- |
| VideoToolbox (A17 Pro, M3+, macOS 14+) | Main, 8/10 | not found | `CVPixelBuffer` (IOSurface), CPU lock or Metal texture | Firefox's gate rejects RGB/identity; needs `av1C` in the format description |
| MediaCodec (Android) | hardware Main 10 at level 4.1 required only of Media Performance Class devices; CDD requires AV1 decode, software allowed | the AOSP software decoder fills neutral chroma | YUV420Flexible, P010 | AOSP's dav1d wrapper treats every depth but 10 as 8, so 12-bit looks broken |
| VA-API (Intel, AMD on Linux) | Main; AMD VCN 4/5 also 12-bit 4:2:0 | "8-bit/10bit 420 format only" (libva header) | VASurface: `vaGetImage`, or DMA-BUF into Vulkan | Intel's table: NV12 and P010 only |
| NVDEC (Ampere and later) | Profile 0 up to level 6.0 | **yes**: ffmpeg offers NVDEC as the only hardware decoder for grey AV1, checked against `cuvidGetDecoderCaps` | NV12 or P016 in CUDA memory | query monochrome at run time; Blackwell's HEVC row "exclude YUV400" shows it varies |
| D3D12 / DXVA (Windows) | profile GUIDs 0, 1, 2 and 12-bit | a `mono_chrome` field exists; support unknown | D3D texture, staging read-back | |
| Vulkan Video (`VK_KHR_video_decode_av1`) | Main, High, Professional by capability | a `MONOCHROME` subsampling bit exists; drivers say | `VkImage` on the same device | the natural fit for a wgpu client, through raw `ash` interop |

**The native case**: the GPU route avoids the browser's read-back limits, and an image decoded into a `VkImage` can be
painted without leaving the GPU. It still meets the same unknown, lossless exactness, plus monochrome on most vendors.

## 7. HTJ2K

* **No browser has any HTJ2K or JPEG 2000 decoder**, hardware or software; OpenJPH in WebAssembly stays the browser path,
  and a WebGPU compute decoder is plausible but unbuilt (the native plan lists it).
* **Natively, NVIDIA's nvJPEG2000** decodes HTJ2K on the GPU (from v0.7.0; refinement passes from v0.10.0); NVIDIA's own
  blog reports about 2.5× (512² CT, 16-bit) to 8× (a 3064×4774 mammogram) against OpenJPEG for lossless DICOM. Naman and
  Taubman (ICIP 2019) decoded HTJ2K in CUDA, though with a float DWT whose reversible exactness would need checking. No
  consumer GPU or SoC has a fixed-function JPEG 2000 block.
* JPEG XL ships in Chrome 155, in software (jxl-rs), and reaches the page only through `<img>`'s 8-bit pipeline.

## 8. What survives on each path, and a route worth measuring

| path | full-depth window/level | zoom | measurement | exactness check |
| --- | --- | --- | --- | --- |
| video element, MSE, canvas/WebGL/WebGPU import | no (≤ 8-bit or converted) | yes | no | no (no samples) |
| WebCodecs software in Chrome, dav1d-WASM, OpenJPH-WASM (today) | yes | yes | yes | yes |
| WebCodecs hardware in Chrome, 8-bit 4:2:0 streams, top and low recombined | yes | yes | yes | **required**: hardware lossless unproven |
| WebCodecs hardware in Chrome, 10-bit | no read-back unless the platform maps the frame | yes | no | no |
| native hardware, 4:2:0 ≤ 10-bit, recombined | yes | yes | yes | required |
| native hardware, 4:0:0 or 12-bit | NVDEC (grey), AMD VCN 4 (12-bit 4:2:0) are the only candidates | — | — | — |

**The route.** Code every stream as AV1 Main **lossless 8-bit 4:2:0 with constant chroma** (the repository's GREY420
form: +0.20–0.23 % bytes, row 80) and split samples above 8 bits into **8 + 8** rather than a 10-bit top, because
Chrome reads back only 8-bit hardware frames. Decode with `prefer-hardware`, copy the NV12 frame's Y plane, recombine,
and check the frame digest before paint. Every piece but the middle one is already built or measured here; the middle
one, a GPU decoding AV1 lossless exactly, is what nobody documents.

**Open questions, for a measurement phase:**

1. Does any GPU decoder (Intel Xe, AMD VCN 3/4, NVIDIA Ampere/Ada, Apple M3) return the Y plane of lossless 8-bit 4:2:0
   AV1 bit-exact? Our own frames and Argon's lossless streams, against dav1d.
2. In Chrome with `prefer-hardware`, does a monochrome stream fail, fall back silently, or produce nothing?
3. Is hardware faster than dav1d for one small intra frame at all? Per-frame setup may dominate a 512² CT slice. Quote
   latency only.
4. Can any platform read back a 10-bit hardware frame in Chrome (a CPU-mappable IOSurface on macOS)?
5. On a phone (A17 Pro, an Android SoC), the same four questions: the repository's §Open already owes this device run.

## 9. Sources

* AV1 specification: Annex A and the syntax, https://github.com/AOMediaCodec/av1-spec
* AOM, the Argon conformance streams: https://aomedia.org/av1-video-decoder-verification-tool/; dav1d:
  https://github.com/videolan/dav1d
* W3C: WebCodecs https://www.w3.org/TR/webcodecs/; the AV1 registration https://www.w3.org/TR/webcodecs-av1-codec-registration/;
  WebGL 2 https://registry.khronos.org/webgl/specs/latest/2.0/
* MDN: `VideoFrame.copyTo`, `VideoFrame.format`, `getContext`, `importExternalTexture` (https://developer.mozilla.org)
* Chromium (main, 2026-10-14), https://chromium.googlesource.com/chromium/src/+/main/: `media/gpu/av1_decoder.cc`,
  `media/gpu/mac/video_toolbox_video_decoder.cc`, `media/filters/dav1d_video_decoder.cc`,
  `media/base/video_codec_string_parsers.cc`, `third_party/blink/renderer/modules/webcodecs/video_decoder.cc`,
  `video_frame.cc`, `video_pixel_format.idl`; D3D11 decoder via the Cobalt mirror,
  https://cobalt.googlesource.com/cobalt/+/HEAD/media/gpu/windows/d3d11_video_decoder.cc
* Firefox: `dom/media/platforms/agnostic/DAV1DDecoder.cpp`, `dom/media/platforms/apple/AppleDecoderModule.cpp`
  (https://github.com/mozilla-firefox/firefox); bugs https://bugzilla.mozilla.org/show_bug.cgi?id=1969762,
  https://bugzilla.mozilla.org/show_bug.cgi?id=2048686
* WebKit: https://webkit.org/blog/14445/webkit-features-in-safari-17-0/; bugs https://bugs.webkit.org/show_bug.cgi?id=269908,
  https://bugs.webkit.org/show_bug.cgi?id=309450, https://bugs.webkit.org/show_bug.cgi?id=325884
* Apple developer forum, VideoToolbox AV1 setup: https://developer.apple.com/forums/thread/739953
* Android: CDD 17 https://source.android.com/docs/compatibility/17/android-17-cdd; Media Performance Class
  https://source.android.com/docs/compatibility/17/mpc; `MediaCodecInfo.java`, `C2SoftDav1dDec.cpp` (https://android.googlesource.com)
* VA-API `va_dec_av1.h`: https://github.com/intel/libva; Intel media-driver features:
  https://github.com/intel/media-driver/blob/master/docs/media_features.md
* AMD AMF hardware table: https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/GPU-and-APU-HW-Features-and-Support; rocDecode:
  https://rocm.docs.amd.com/projects/rocDecode/en/latest/reference/rocDecode-formats-and-architectures.html
* NVIDIA Video Codec SDK 13.1, NVDEC guide and application note: https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvdec-video-decoder-api-prog-guide/
* FFmpeg `libavcodec/av1dec.c`, `nvdec.c`, `dxva2_av1.c`: https://github.com/FFmpeg/FFmpeg
* Microsoft, Direct3D 12 video GUIDs: https://learn.microsoft.com/en-us/windows/win32/medfound/direct3d-12-video-guids
* Vulkan: https://docs.vulkan.org/refpages/latest/refpages/source/VK_KHR_video_decode_av1.html,
  https://docs.vulkan.org/refpages/latest/refpages/source/VkVideoChromaSubsamplingFlagBitsKHR.html
* NVIDIA nvJPEG2000 release notes: https://docs.nvidia.com/cuda/nvjpeg2000/releasenotes.html; NVIDIA blog:
  https://developer.nvidia.com/blog/advancing-medical-image-decoding-with-gpu-accelerated-nvimagecodec/
* Naman and Taubman, Decoding HTJ2K on a GPU: https://kakadusoftware.com/wp-content/uploads/ICIP2019_GPU.pdf
* NVIDIA forum, Chrome switching AV1 to software: https://forums.developer.nvidia.com/t/av1-encoder-disables-hardware-decoding-in-chrome-on-forcekeyframe-pli/345732
* Chrome and JPEG XL: https://developer.chrome.com/blog/jpeg-xl-in-chrome
