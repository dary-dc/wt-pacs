# 10-bit hardware routes

*Queue row HW10-ROUTES, 2026-11-14. Theory and sources; nothing run on a device or a GPU. One question: **every route
by which a hardware-decoded 10-bit AV1 frame can be painted at full precision and checked against its digest, in a
browser and natively, ranked.** Read with [`hardware.md`](hardware.md) §11–§18 as HW-DECODE-DEEP and its review left
it (PR 387, `claude/hw-decode`), whose findings this file takes as given and does not repeat. Every choice stays the
owner's.*

Labels as in [`hardware.md`](hardware.md): **(S)** a source quoted at a pinned revision (§10 here); **(D)** derived
from sources, written out; **(M)** measured, in this container (4 cores, no GPU, headless Chromium, software paths
only).

## Contents

1. [What it shows](#1-what-it-shows)
2. [What a route must do](#2-what-a-route-must-do)
3. [The probe's stall: `copyTo({format: "I420P10"})` in Chromium 141](#3-the-probes-stall-copytoformat-i420p10-in-chromium-141)
4. [WebCodecs `copyTo` from a hardware frame](#4-webcodecs-copyto-from-a-hardware-frame)
5. [WebGPU](#5-webgpu)
6. [WebGL2](#6-webgl2)
7. [Android: MediaCodec frames in Chromium](#7-android-mediacodec-frames-in-chromium)
8. [Native](#8-native)
9. [The routes, ranked](#9-the-routes-ranked)
10. [Sources](#10-sources)

## 1. What it shows

* **No browser route serves the checked 10-bit view today, and none is behind a flag.** Every path from a hardware
  frame to a page or a shader in Chromium 157 and 158 either refuses a 10-bit frame (`copyTo`) or passes it through an
  8-bit RGB image (WebGPU's import and copy, every WebGL2 upload) before the page sees it (§4–§6). The one cell
  [`hardware.md`](hardware.md) §13 left unknown, WebGL2's shared-image copies, is now traced: 8 bits (§6).
* **Each browser route is blocked by a missing format, not by the hardware.** Desktop Chromium has the 10-bit planes
  (`P010`) in a shared image and has no `VideoPixelFormat` to hand them over; Dawn has a 10-bit two-plane texture
  format that Blink does not expose; Android's Chromium reads MediaCodec through an opaque image format that has no
  planes at all (§4, §5.3, §7). What upstream would have to add is listed with each route (§9).
* **Natively, every platform API returns the 10-bit planes** (`P010` or its kin), which a viewer can hash on the CPU
  after one copy, or, through Vulkan, hash on the GPU and paint with no read-back (§8). On Android that is MediaCodec
  in ByteBuffer mode or an `ImageReader` in `YCBCR_P010`. The 4:0:0 limit is unchanged: most decoders take only
  4:2:0, so the stream would be 4:2:0 with constant chroma (§8).
* **XXH3-64 can be computed on a GPU in WGSL**, though WGSL has no 64-bit integer: the work inside each 1 KiB block is
  a sum, so blocks run in parallel, and one short chain of scrambles runs in order (§5.4, D). It helps only where a
  shader holds the exact samples, which in this list is native Vulkan alone.
* **The probe's stall at cell 7 is, by Chromium 141's source, a renderer crash, not a hang**: an explicit non-RGB
  `copyTo` format throws and then falls through into the RGB converter, which hits a fatal `NOTREACHED()` on a
  10-bit format (§3, D). A crashed renderer takes the page and its workers with it, so no per-task bound can fire.
  Chromium 153 throws `NotSupportedError` and returns (M); 157 and 158 reject the call while parsing its options (S).
* **Ranked** (§9): native Android MediaCodec to `P010` first for the phone, native desktop APIs second, then the
  software decode the client runs today. Every browser hardware route is closed; desktop Chromium's 8-bit `NV12`
  read-back (GREY420) is the only checkable browser hardware path, and it is 8-bit.

## 2. What a route must do

Two conditions, both required (amendment 1 of `docs/queue-client-2026-11-14.md`):

* **Painted at full precision:** every one of the frame's 10 bits reaches the window table (VOI). On 8 bits a window
  narrower than 1024 codes repeats display levels ([`hardware.md`](hardware.md) §13).
* **Checked:** the decoder's own output samples reach an XXH3-64 that is compared with the digest computed at ingest
  over "the decoded samples as stored (two bytes a sample above 8 bits)" ([`hardware.md`](hardware.md) §13). A
  converted picture cannot be checked: no spec defines a browser's YUV-to-RGB conversion
  ([`hardware.md`](hardware.md) §18.2 a).

Hardware returns 10-bit samples in the top bits of 16-bit words. Vulkan's `VK_FORMAT_G10X6_B10X6R10X6_2PLANE_420_UNORM_3PACK16`
"has a 10-bit G component in the top 10 bits of each 16-bit word of plane 0" (S, Vulkan-Docs v1.4.328
`chapters/formats.adoc:930–933`); Android's `YCBCR_P010` has "the lower 6 bits set to zero"
([`hardware.md`](hardware.md) §15). So a route that has the planes recovers the stored samples with a 6-bit shift of
the luma plane, which is exact (D). The digest is over luma only where the stream is 4:0:0; for a 4:2:0
constant-chroma stream the ingest digest must be defined over the luma plane, a definition to settle where the
digest is (`claude/oq-integrity-build:docs/av1/payload-format.md` §Integrity), not here.

## 3. The probe's stall: `copyTo({format: "I420P10"})` in Chromium 141

`claude/work-ledger:docs/queue/HW-PROBE-PAGE.md` records that in headless Chromium 141, `copyTo({format: "I420P10"})`
of a 10-bit software frame blocks the thread that calls it, and that the run then stalls at cell 7 with no per-task
bound firing. Chromium 141.0.7390.37's source:

1. *Parsing passes.* `ParseCopyToOptions` rejects an explicit format only when it differs from the frame's and is not
   RGB: `if (copy_to_format != frame.format() && !media::IsRGB(copy_to_format))` (S,
   `third_party/blink/renderer/modules/webcodecs/video_frame.cc:562–567`). `I420P10` on an `I420P10` frame is equal,
   so it passes.
2. *The throw does not return.* `copyTo` then reads `if (RuntimeEnabledFeatures::WebCodecsCopyToRGBEnabled() &&
   options->hasFormat()) { if (!media::IsRGB(dest_layout.Format())) { exception_state.ThrowDOMException(…
   "copyTo() doesn't support explicit copy to non-RGB formats. …"); }` and goes straight on to
   `ConvertAndCopyToRGB(local_frame, src_rect, dest_layout, buffer, target_color_space);` with no `return` between
   (S, `:1389–1405`). `WebCodecsCopyToRGB` is `status: "stable"` (S, `runtime_enabled_features.json5:5536–5537`).
3. *The converter cannot take a planar layout.* `ConvertAndCopyToRGB` begins `DCHECK(media::IsRGB(dest_layout.Format()));`
   (off in a release build) and calls `media::SkColorTypeForPlane(dest_layout.Format(), …kARGB)` (S, `:1283–1285`),
   whose switch lists no `I420P10` and ends `default: NOTREACHED();` (S, `media/base/video_util.cc:759–793`).
4. *`NOTREACHED()` is fatal.* In a build without check streaming it is `[[noreturn]] … void NotReachedFailure() {
   base::ImmediateCrash(); }` (S, `base/notreached.h:18–26`).

So the call crashes the renderer process (D). Dedicated workers run in the page's renderer, so a worker per cell
does not contain it, and the page's own timers die with it: that is why no 10 s or 30 s bound fired (D, the probe's
symptom matching the source; not reproduced on 141 here). A headless harness sees a page that never answers.

**Later versions.** At 153.0.8010.12 the same throw is followed by `return CopyToPromise();` (S, `video_frame.cc:1442–1444`)
and the call rejects: `NotSupportedError: … copyTo() doesn't support explicit copy to non-RGB formats. Remove format
parameter to use VideoFrame's pixel format.`, while `copyTo()` with no format returns the samples (M, Google Chrome
for Testing 153.0.8010.12 headless, a 16 × 16 `I420P10` frame built from a buffer). At 157 and 158 `ParseCopyToOptions`
itself rejects any explicit non-RGB format and returns (S, 157 `video_frame.cc:507–519`, 158 `:500–512`). The
commit that fixed it was not identified: gitiles' history pages require a sign-in.

**For the probe:** on Chromium 141 the explicit-planar `copyTo` cell is a renderer crash, an outcome to record as
such (a harness's page-crash event), and it must run last or alone, never before other cells of the same page.

## 4. WebCodecs `copyTo` from a hardware frame

Settled by [`hardware.md`](hardware.md) §12 and §18.2 b, at 157 and 158: a hardware 10-bit frame is `P010`, which no
`VideoPixelFormat` names in the spec or in Chromium, so its `format` is `null` and `copyTo()` throws "Operation is not
supported when format is null."; an explicit planar format is `NotSupportedError` by the spec's *Parse
VideoFrameCopyToOptions*; a non-mappable frame above 8 bits fails earlier, "Readback is not supported for high
bit-depth formats". The 10-bit planar formats `WebCodecsHBDFormatsEnabled` once gated (`I420P10`, `I422P10`,
`I444P10`, …) are shipped, but only a software frame has them (D).

**What would open it** (an upstream change, two parts): a `P010` member of `VideoPixelFormat`, so that a hardware
frame's `format` maps and `copyTo()` with no format returns its two planes as they are; and, in Chromium, `P010`
in `IsFormatEnabled` plus a read-back of a 10-bit shared image, which today stops at "Readback is not supported for
high bit-depth formats" (D). A re-layout to `I420P10` is not needed: the page can shift and de-interleave the planes
itself, exactly (§2). The open WebCodecs issues found by a search of `w3c/webcodecs` for "P010" (2026-11-14) are about
HDR (#384, "HDR support") and buffer pools (#569); none asks for `P010` as a format. Desktop only: on Android the
frame is not `P010` but an opaque image (§7).

## 5. WebGPU

### 5.1 `importExternalTexture`

At 157, the zero-copy branch needs `media_video_frame->format() == media::PIXEL_FORMAT_NV12` (S,
`third_party/blink/renderer/modules/webgpu/external_texture_helper.cc:285–289`). It binds the planes as
`wgpu::TextureFormat::R8Unorm` and `RG8Unorm` (`:301–309`) and passes a matrix,
`external_texture_desc.yuvToRgbConversionMatrix = yuvToRgbMatrix.data();` (`:320–321`), so the shader samples RGB,
never the planes (S). Every other frame, `P010` included, is drawn into an N32 image: "High bit depth formats should
also use F16, but do not yet." (S, `:400–401`; the same at 158, `2e1f8985b250`). **8 bits, converted: closed.**

### 5.2 `copyExternalImageToTexture` from a `VideoFrame`

The spec preserves high bit depth through this copy, "with intermediate computations having at least the precision
of the source" (S, W3C WebGPU CRD 15 September 2026, §3.11), so an `rgba16float` destination would be within the
spec's terms. Chromium 157 does not keep them: a `VideoFrame` source becomes an `external_texture_source`
(S, `external_image_utils.cc:335–350`), and `GPUQueue::CopyFromVideoElement` calls
`CreateExternalTexture(device_, dst_color_space, source.media_video_frame)` and then
`CopyExternalTextureForBrowser` (S, `gpu_queue.cc:613, 627, 650`), the same helper as §5.1, with its 8-bit N32 image
(D). And the result is RGB in the destination's colour space, a conversion no spec defines
([`hardware.md`](hardware.md) §18.2 a). **8 bits, converted: closed.** Even with F16 inside Chromium it would stay
uncheckable, because it is converted.

### 5.3 A `VideoFrame` as a multi-planar texture

Dawn, the WebGPU implementation Chromium 157 pins (`dawn_revision` `106245fa2b9e`, S, `DEPS:443`), defines the
features `"dawn multi planar formats"`, `"multi planar format p010"` and `"unorm16 formats for external texture"`,
and the texture format `"R10X6 BG10X6 biplanar 420 unorm"`, each `"tags": ["dawn"]` (S, `src/dawn/dawn.json:2540,
2552, 2599, 4504`). A view of plane 0 of that format would hold the luma samples themselves (D, by the format's
definition). None of it reaches a page: Blink's `GPUFeatureName` at 157 lists the spec's features and five
`// Non-standard` ones, none of them planar (S, `gpu_supported_features.idl:7–39`), and its enum conversions name no
planar format (S, `dawn_enum_conversions.cc`, 0 matches for "planar"; the same file at 158, `2e7e4c8c04c7`). The
WebGPU spec has no planar texture format (S, CRD 15 September 2026, 0 matches for "planar"). `gpuweb/gpuweb#5281`,
"Support for YUV textures", is open (S, its title and state, 2026-11-14). So **no flag exposes it**: a page could
reach it only through new Blink code and, for the web, a spec change (D). Dawn uses these formats inside Chromium,
which is what the zero-copy `NV12` import of §5.1 rests on.

### 5.4 XXH3-64 on the GPU

If a shader ever holds the exact samples (§5.3 opened, or natively through Vulkan, §8), can it check them?

* **WGSL has no 64-bit integer**: "The scalar types are bool, AbstractInt, AbstractFloat, i32, u32, f32, and f16."
  (S, W3C WGSL CRD 6 November 2026, §6.2.5), and "WGSL does not have a concrete 64-bit integer type." (§14.4.4). A
  64-bit lane is a `vec2<u32>`; its adds carry by hand, and a 32 × 32 → 64 product, which WGSL has no instruction
  for, takes four 16 × 16 products (D).
* **XXH3's structure.** Inputs over 240 bytes are consumed in blocks of 16 stripes of 64 bytes with the default
  secret, "the block size is 1024 bytes"; each stripe's step is `acc[i xor 1] = acc[i xor 1] + stripe[i];
  acc[i] = acc[i] + (u64)lowerHalf(value) * (u64)higherHalf(value);`, and after each block `round_scramble()`
  shifts, xors and multiplies every accumulator (S, xxHash v0.8.3 `doc/xxhash_spec.md` §XXH3 large inputs,
  Steps 2-1 and 2-2). The stripe step adds to the accumulators a quantity that depends only on the stripe and the
  secret, so a block's 16 contributions are a sum that can be formed in any order; only the scrambles must run one
  after another (D).
* **So on a GPU** every block's sum is computed in parallel, then one thread runs the chain `acc = scramble(acc +
  S_b)` over the blocks, then the last block and the finalization (D). For `dbts_b1` (2560 × 3328 at 2 bytes a
  sample, `docs/FIXTURES.md`) that is 17 039 360 bytes: 2.1 M lane products in parallel and a chain of 16 640
  scrambles. Its time per frame is **not measured**; no GPU is here. A shader must also apply §2's shift and drop row
  padding first, or it hashes a different byte string from the ingest's.

## 6. WebGL2

At 157 a hardware frame (one with a shared image) is uploaded by `texImage2D(VideoFrame)` through one of three
calls, all 8-bit (S, `third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc:6672–6707`, read
with the functions they call):

* **Direct texture copy** (`CanCopySharedImageToGLTextureViaTextureCopy`) only for a shared image that is single-plane
  or "use[s] external sampler" (S, `gpu/command_buffer/client/gles2_implementation.cc:190–203`): Android's `ABGR`,
  already RGB (§7), or an RGB image. It is `glCopyTextureCHROMIUM`, which "requires the source texture to be in 8-bit
  format" (S, `webgl_rendering_context_base.cc:6640–6644`).
* **Skia** (`CanCopySharedImageToGLTextureViaSkia`, desktop only, "disable this codepath on Android") only when
  `ValidFormatForDirectUploading` holds, which accepts `GL_RGBA` and `GL_RGB` with `GL_UNSIGNED_BYTE` and returns
  `false` for `GL_RGBA16F` and every sized format (S, `gles2_implementation.cc:117–138, 205–239`).
* **Otherwise** an intermediate shared image of `viz::SkColorTypeToSinglePlaneSharedImageFormat(kN32_SkColorType)`
  (S, `webgl_rendering_context_base.cc:287–291`), 8 bits a channel.

A `P010` image is two-plane, so it takes the third: 8 bits (D). The same at 158 (`ValidFormatForDirectUploading`
unchanged, the N32 intermediate at `:291`, S). WebGL's 16-bit normalized textures do not help:
`EXT_texture_norm16`'s history reads "Constrain the scope to only support ArrayBufferView." (S, WebGL registry
`extensions/EXT_texture_norm16/extension.xml` at `39443210`, revision 2020/12/03), so it uploads samples a page
already holds, never a `VideoFrame`. **Closed**; [`hardware.md`](hardware.md) §13's unknown cell is 8 bits.

## 7. Android: MediaCodec frames in Chromium

* **The image has no planes.** Chromium reads MediaCodec's output through an `AImageReader` created with
  `AIMAGE_FORMAT_PRIVATE` (S, 157 and 158 `gpu/command_buffer/service/image_reader_gl_owner.cc:157–158`), in every
  mode its video frame factory uses (`kAImageReaderInsecure`, `…SecureSurfaceControl`, `…InsecureSurfaceControl`;
  S, `media/gpu/android/video_frame_factory_impl.cc:36–45`). The NDK: "Android private opaque image format. The
  choices of the actual format and pixel data layout are entirely up to the device-specific and framework internal
  implementations … the contents of these buffers are not directly accessible to the application. When an AImage of
  this format is obtained … AImage_getNumberOfPlanes() method will return zero." (S, Android NDK *Media* reference,
  `AIMAGE_FORMAT_PRIVATE`, last updated 2026-08-27). Chromium itself: "We don't know the exact format of the image so
  we use NV12 as approximation" (S, `image_reader_gl_owner.cc:399–401`). It then wraps the frame as `ABGR`
  ([`hardware.md`](hardware.md) §12).
* **No flag at 157 changes that.** `kMediaCodecBlockModel` (input side; "only supported on Android 17 26Q4+") and
  `kMediaCodecBlockModelOutput` ("Enables output-side block model (OutputFrame) on supported devices") are both
  `FEATURE_DISABLED_BY_DEFAULT` (S, `media/base/media_switches.cc:1298–1303`). The decoder reads only the first,
  gated on an SDK level as well (S, `media_codec_video_decoder.cc:274–277`); the second appears in none of the files
  read for this row (`media_codec_video_decoder.cc`, `codec_wrapper.cc`, `media_codec_bridge_impl.cc`,
  `MediaCodecBridge.java`), so what it would deliver is not known from source (D).
* **What would open it:** Chromium's WebCodecs decoder on Android reading MediaCodec in ByteBuffer mode or through a
  `YUV_420_888`/`YCBCR_P010` reader, and mapping that to a `VideoPixelFormat` (§4's `P010` too). That is a change to
  Chromium's Android media stack, not a format addition alone (D). No issue for it was searched for here.

## 8. Native

Every API returns the decoder's planes, so the check is a hash of the luma plane after §2's shift, on the CPU after
one copy or, where the API gives the GPU image to a compute shader, on the GPU (§5.4). The AV1 profiles and 4:0:0
support per API are [`hardware.md`](hardware.md) §5; the 10-bit output formats:

| API | 10-bit output, by the source | 4:0:0 | checked how |
| --- | --- | --- | --- |
| **MediaCodec** (Android) | ByteBuffer mode: "you can access raw video frames using the Image class and getInput / OutputImage(int)"; with an output Surface "the output buffers will not be accessible" (S, `MediaCodec`, last updated 2026-08-03); `COLOR_FormatYUVP010`, "P010 is 10-bit-per component 4:2:0 YCbCr semiplanar format.", API 33 (S, `CodecCapabilities`); `ImageFormat.YCBCR_P010`, API 31 (S) | no constant ([`hardware.md`](hardware.md) §12) | CPU, from the `Image`'s luma plane |
| **VideoToolbox** (Apple) | `kCVPixelFormatType_420YpCbCr10BiPlanarFullRange` exists; as AV1's output, not documented ([`hardware.md`](hardware.md) §15) | not published | CPU, a locked `CVPixelBuffer` |
| **VA-API** (Intel, AMD) | Intel: AV1 10-bit to `P010` from Gen12 ([`hardware.md`](hardware.md) §5) | Intel: none listed; AMD: the flag reaches the firmware | CPU, `vaDeriveImage`/`vaGetImage` |
| **NVDEC** | `NV12`/`P016` device memory ([`hardware.md`](hardware.md) §5) | **yes** | CUDA or a host copy |
| **D3D12** | `DXGI_FORMAT_P010 = 104` (S, DirectX-Headers v1.616.0 `dxgiformat.h:117`) | per driver | a mapped staging copy, or a compute shader |
| **Vulkan Video** | `VK_FORMAT_G10X6_B10X6R10X6_2PLANE_420_UNORM_3PACK16` (S, Vulkan-Headers v1.4.328 `vulkan_core.h:1946`); plane 0 is `compatible="VK_FORMAT_R10X6_UNORM_PACK16"` (S, Vulkan-Docs v1.4.328 `xml/vk.xml:30036–30041`) | `VK_VIDEO_CHROMA_SUBSAMPLING_MONOCHROME_BIT_KHR`, per driver ([`hardware.md`](hardware.md) §5) | **on the GPU, no read-back**: a compute shader over a plane-0 view, the same image painted |

Android's `isHardwareAccelerated()` is "provided by the device manufacturer. Note that it cannot be tested for
correctness." (S, `MediaCodecInfo`, last updated 2026-08-03): a native viewer still records which codec decoded.
Every API takes 4:2:0 at 10 bits; 4:0:0 only where §5 of [`hardware.md`](hardware.md) shows it. A native 10-bit
hardware view therefore needs the stream coded as 4:2:0 with constant chroma at 10 bits (not built: `--grey8` is
8-bit only, [`hardware.md`](hardware.md) §14) on every API but NVDEC (D).

## 9. The routes, ranked

Rank by the two conditions of §2 first (a route that fails either does not serve the view), then by whether it ships
today, then by its cost. Costs are theory: none is measured.

| # | route | platform | decodes in hardware | painted at 10 bits | checkable | ships | cost per frame (theory) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | native MediaCodec, ByteBuffer or `ImageReader`, `P010` | Android (the phone) | where an AV1 Main 10 codec is listed; the S23's is unsettled ([`hardware.md`](hardware.md) §15) | yes | yes, CPU | today, API 31/33 | one copy of the luma plane plus the hash, as today's software copy; the decode itself unmeasured |
| 2 | native Vulkan Video, `P010` image | desktop, Android where a driver lists AV1 decode | per driver | yes | yes, on the GPU | today, per driver | the hash on the GPU (§5.4), no read-back; unmeasured |
| 3 | native D3D12, VA-API, NVDEC, VideoToolbox | desktop | per §5 of [`hardware.md`](hardware.md) | yes | yes, CPU after a copy | today | a GPU-to-host copy of the luma plane plus the hash |
| 4 | browser, software decode (today's client) | every engine with 10-bit WebCodecs | no | yes | yes | today | the software decode; not a hardware route, the baseline |
| 5 | browser, WebCodecs `copyTo`, a `P010` format | desktop Chromium | yes | yes | yes | **blocked**: no `P010` in the spec or Chromium (§4) | a GPU read-back, as GREY420's `NV12` |
| 6 | browser, WebGPU multi-planar import, plane-0 `r16unorm`-like view | desktop Chromium | yes | yes | yes, on the GPU (§5.4) | **blocked**: Dawn-only features, no Blink or spec format (§5.3) | no read-back; unmeasured |
| 7 | browser, WebCodecs on Android with a YUV reader | Chrome Android | yes | yes | yes | **blocked**: opaque image, no flag (§7) | a copy, as row 1 |
| 8 | browser, desktop Chromium, GREY420 `NV12` read-back | desktop Chromium | yes | **no: 8 bits** | yes | today | a GPU read-back; the 8-bit fallback, DEPTH8-THEORY's question |
| — | WebGPU `importExternalTexture`, `copyExternalImageToTexture`; WebGL2 `texImage2D`; any path on Firefox or Safari | all | — | no: 8 bits | no: converted | — | closed (§5.1, §5.2, §6; [`hardware.md`](hardware.md) §4.2–4.3) |

**Decided by the sources alone:** rows 5–7 and the closed row are not available in any shipped browser, behind a flag
or otherwise; row 8 is 8-bit. So the 10-bit hardware view is native or nothing, today. Native rows 1–3 are possible
by their APIs.

**Needs a device:** whether the phone's codec lists AV1 Main 10 and `COLOR_FormatYUVP010` in ByteBuffer mode, and
decodes a 4:2:0 constant-chroma 10-bit unit exactly (row 1); its decode time against software; a Vulkan driver's
AV1 decode and the GPU hash's time (row 2).

**Upstream, where only a missing format blocks a route:**

* WebCodecs spec: a `P010` `VideoPixelFormat` (row 5), an issue in `w3c/webcodecs`; none exists among the issues found
  (§4).
* Chromium, desktop: `P010` in `IsFormatEnabled` and a 10-bit shared-image read-back (row 5); the F16 intermediate the
  `external_texture_helper.cc:400` comment already names (it would lift §5.1–§5.2 above 8 bits but leave them
  converted, so it serves display only).
* WebGPU: plane access for a `VideoFrame` (row 6), the subject of `gpuweb/gpuweb#5281`.
* Chromium, Android: a WebCodecs output path from MediaCodec that keeps the planes (row 7): not a format alone.

**The probe's cells for the top rows** are asks for the device session, appended to `lab/devices/README.md` on
`claude/hw-probe` without changing its code: the phone's AV1 codec list (row 1), a 10-bit constant-chroma unit
through `prefer-hardware` (rows 5 and 7's prediction: `format` null on desktop, `BGRX` on the phone), and §3's crash
recorded as an outcome.

## 10. Sources

Read 2026-11-14. Each SHA-256 prefix is of the copy read.

**Chromium**, via `chromium.googlesource.com/chromium/src/+/refs/tags/<tag>/<path>?format=TEXT`:

* 141.0.7390.37: `third_party/blink/renderer/modules/webcodecs/video_frame.cc` (`312d100462d8`, as
  [`hardware.md`](hardware.md) §10); `third_party/blink/renderer/platform/runtime_enabled_features.json5`
  (`645f5b7eaba4`); `media/base/video_util.cc` (`6f33a7b8ba26`); `base/notreached.h` (`3793a02d64c9`).
* 153.0.8010.12: `…/webcodecs/video_frame.cc` (`4728731574bb`).
* 157.0.8103.79: `…/webcodecs/video_frame.cc` (`28e41e741719`); `…/webgpu/external_texture_helper.cc`
  (`cec4fc80a2cc`), `gpu_queue.cc` (`72495004328d`), `external_image_utils.cc` (`7a862c678ce2`),
  `gpu_supported_features.idl` (`f5457af3b224`), `dawn_enum_conversions.cc` (`2e7e4c8c04c7`);
  `…/webgl/webgl_rendering_context_base.cc` (`b89b445caeea`); `gpu/command_buffer/client/gles2_implementation.cc`
  (`40f84935012c`); `gpu/command_buffer/service/image_reader_gl_owner.cc` (`737011356556`);
  `media/gpu/android/video_frame_factory_impl.cc` (`fb4bc6c5fb50`), `media_codec_video_decoder.cc`
  (`55fb0c80da25`), `codec_wrapper.cc` (`bfc20a2562c2`), `codec_image.cc` (`9543d25e361d`);
  `media/base/android/media_codec_bridge_impl.cc` (`bcb724c3daa7`),
  `media/base/android/java/src/org/chromium/media/MediaCodecBridge.java` (`1223ee6ef9cd`); `DEPS`.
* 158.0.8127.36: `…/webcodecs/video_frame.cc` (`8a066993aa2a`); `…/webgpu/external_texture_helper.cc`
  (`2e1f8985b250`), `dawn_enum_conversions.cc` (`2e7e4c8c04c7`), `gpu_queue.cc` (`72495004328d`);
  `…/webgl/webgl_rendering_context_base.cc` (`f0855d5e4e04`); `gles2_implementation.cc` (`40f84935012c`);
  `image_reader_gl_owner.cc` (`737011356556`); `video_frame_factory_impl.cc` (`fb4bc6c5fb50`).
* Versions: chromiumdash `fetch_releases`, 2026-11-14: Android stable 158.0.8127.36 and 157.0.8103.79.

**Dawn** `106245fa2b9e1cf8b59b1bb8e010af3c7ca8b600` (Chromium 157's `dawn_revision`): `src/dawn/dawn.json`
(`d5d5e1d48a47`).

**Specifications and registries:** W3C WebGPU, Candidate Recommendation Draft 15 September 2026
(`https://www.w3.org/TR/2026/CRD-webgpu-20260915/`, `7c6768143075`), §3.11; W3C WGSL, Candidate Recommendation
Draft 6 November 2026 (`https://www.w3.org/TR/2026/CRD-WGSL-20261106/`, `c7b8cc9d175f`), §6.2.5, §14.4.4; W3C
WebCodecs, Working Draft 9 November 2026 (`0fa152953edb`, as [`hardware.md`](hardware.md)); WebGL registry
`KhronosGroup/WebGL` `39443210`, `extensions/EXT_texture_norm16/extension.xml` (`f1157baa9cad`); Vulkan-Docs
`v1.4.328` `chapters/formats.adoc` (`c80d78d1948a`), `xml/vk.xml` (`de8de467ccd2`); Vulkan-Headers `v1.4.328`
`include/vulkan/vulkan_core.h` (`fb8ef9af8011`); DirectX-Headers `v1.616.0` `include/directx/dxgiformat.h`
(`0ac14d7da595`); xxHash `v0.8.3` (`e626a72bc232`) `doc/xxhash_spec.md`, version 0.2.0 (`61c47af338b2`).

**Android** (developer.android.com): `reference/android/media/MediaCodec` (`fb4e7ab79adf`),
`MediaCodecInfo` (`5877d0d96036`), `MediaCodecInfo.CodecCapabilities` (`b95b318105ab`),
`reference/android/graphics/ImageFormat` (`f0d4318a14f5`), each "Last updated 2026-08-03 UTC";
`ndk/reference/group/media` (`e144e4123df8`), "Last updated 2026-08-27 UTC". Android's pages change bytes under the
same date ([`hardware.md`](hardware.md) §18.0); the quotes are the check.

**Issue trackers** (titles and states from GitHub's search, 2026-11-14): `w3c/webcodecs#384` "HDR support" (open),
`#569` "VideoDecoder API may expose the underlying buffer pool size" (open); `gpuweb/gpuweb#5281` "Support for YUV
textures" (open).
