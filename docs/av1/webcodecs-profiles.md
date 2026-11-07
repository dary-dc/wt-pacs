# AV1 profiles through WebCodecs, per engine

Which AV1 profiles, bit depths and chroma formats `VideoDecoder` decodes in Chromium (Chrome, Edge), WebKit (Safari)
and Gecko (Firefox), on desktop and phone, and through which decoder. Research only, read 2026-11-07: sources, not a
run. Where this repository has already measured an engine, the measurement is cited beside the source
([`../decode/README.md`](../decode/README.md) §AV1).

## Verdict

**Claim.** No engine hands a page 12-bit AV1 samples through WebCodecs. Chromium's dav1d is built for 12 bits, but
Blink's key-frame check parses each first chunk with libgav1 built to 10 bits, so a 12-bit stream fails with `A key
frame is required`. Firefox's dav1d keeps 12 bits but every frame reaches the page as 8-bit `BGRX`. Safari takes Main profile only (`av01.0`), and Firefox has no
WebCodecs on Android. Grey 4:0:0 comes back as `I420` with mid-grey chroma in Chromium, and is refused in Firefox
and in WebKit's software path. Exact 10-bit RGB as 4:4:4 decodes in one place, Chromium's dav1d, on every Chromium
platform. Safari cannot take it because 4:4:4 needs profile 1 or 2, and Firefox hands it back as 8-bit `BGRX`.

**Proof chain.**
1. AV1 puts 12 bits in Professional only and 4:4:4 at 8/10 bits in High or Professional; monochrome is Main or
   Professional (§The specifications).
2. Chromium: the 12-bit refusal is Blink's key-frame parse (`LIBGAV1_MAX_BITDEPTH=10`), not dav1d (built `BITDEPTH=16`).
   This was measured on 141 and is still in main's source (§Chromium).
3. WebKit: `isSupportedDecoderCodec` takes `av01.0` alone. Its software decoder takes 8-bit 4:2:0 alone, and its
   VideoToolbox output is 4:2:0 at 8 or 10 bits (§WebKit).
4. Firefox: `CanDecode` refuses all of Android. Every remote-decoded frame is `BGRX`, from a placeholder texture
   format (§Firefox).
5. `isConfigSupported` checks the codec and colour space in Chromium, the profile digit in WebKit and the container
   path in Firefox; none checks the bit depth (§Where `isConfigSupported` and decode disagree).

**What would change it.**
* Chromium building libgav1 with `LIBGAV1_MAX_BITDEPTH=12`, or classifying key chunks without it. That alone would
  open 12-bit (*derived*: dav1d already outputs `YUV420P12`).
* WebKit widening the `av01.0` gate.
* Gecko bug [1969762](https://bugzilla.mozilla.org/show_bug.cgi?id=1969762), planar YUV from remote-decoded frames.
* Gecko bug [1934008](https://bugzilla.mozilla.org/show_bug.cgi?id=1934008), WebCodecs on Android.
* A run on a phone or a GPU decoder, which nothing here is.

**What is owed.**
* A run on Chrome for Android, Safari on an AV1-hardware Mac or iPhone, and Edge on Windows. None has been run.
* Edge's own documentation: none found.
* Apple's per-device AV1 decode list and its VideoToolbox profile limits: none found.
* Chromium's decoder order on Android (MediaCodec or dav1d first) for clear content: *unverified*.

## The specifications

**AV1** ([AV1 Bitstream & Decoding Process Specification](https://aomediacodec.github.io/av1-spec/), "Last modified:
2023-05-25", read 2026-11-07), §6.4.1 `seq_profile`:

| `seq_profile` | Bit depth | Monochrome support | Chroma subsampling |
| --- | --- | --- | --- |
| 0 | 8 or 10 | Yes | YUV 4:2:0 |
| 1 | 8 or 10 | No | YUV 4:4:4 |
| 2 | 8 or 10 | Yes | YUV 4:2:2 |
| 2 | 12 | Yes | YUV 4:2:0, YUV 4:2:2, YUV 4:4:4 |

> "Monochrome can only be signaled when seq_profile is equal to 0 or 2."

Annex A.2:

> "“Main” compliant decoders must be able to decode streams with seq_profile equal to 0. “High” compliant decoders
> must be able to decode streams with seq_profile less than or equal to 1. “Professional” compliant decoders must be
> able to decode streams with seq_profile less than or equal to 2."

So 12-bit grey is Professional (`av01.2…12.1.110`); 10-bit grey is Main (`av01.0…10.1.110`); 10-bit 4:4:4 is High
(`av01.1…10.0.000`).

**The codec string** ([AV1 Codec ISO Media File Format Binding v1.3.0](https://aomediacodec.github.io/av1-isobmff/),
read 2026-11-07), §Codecs Parameter String:

> "`<sample entry 4CC>.<profile>.<level><tier>.<bitDepth>.<monochrome>.<chromaSubsampling>.`"

The [WebCodecs AV1 Codec Registration](https://www.w3.org/TR/webcodecs-av1-codec-registration/) (Draft Note, 13 October
2026, read 2026-11-07) defers to it: "The codec string begins with the prefix "av01." , followed by a variable length
suffix as described in Section 5 of [AV1-ISOBMFF]". It also says "Implementers of WebCodecs are not required to support
the AV1 codec."

**What WebCodecs requires a support answer to check** ([WebCodecs](https://www.w3.org/TR/webcodecs/), Working Draft,
2 November 2026, read 2026-11-07), §7.1 Check Configuration Support:

> "If config is an AudioDecoderConfig or VideoDecoderConfig and the User Agent can’t provide a codec that can decode
> the exact profile (where present), level (where present), and constraint bits (where present) indicated by the codec
> string in config .codec, return false."

Bit depth, monochrome and subsampling are none of those three, so a user agent that ignores them follows the letter
(*derived*). The note that follows: "User Agents describe support on a best-effort basis".

**No grey pixel format.** `VideoPixelFormat` (§9.8) lists `I420`, `I420P10`, `I420P12`, the `I422` and `I444` families,
alpha variants, `NV12` and four RGB formats, and no single-plane format. So a 4:0:0 decode reaches the page as 4:2:0 or
not at all (*derived*). §9.4.3: `format` "Will be null whenever the underlying format does not map to a VideoPixelFormat".
For such a frame `copyTo()` without `options.format` throws "NotSupportedError". The formats `copyTo()` can convert to are
"RGBA , RGBX , BGRA , BGRX", all 8-bit. WebCodecs issue [#767](https://github.com/w3c/webcodecs/issues/767), "Figure out
what should happen to the unused bits in 10-bits and 12-bits pixel formats", is open; its title was read from GitHub
search, its body not (*unverified*).

## The table

`VideoDecoder`, each cell the engine's own code or tracker, keyed to the sections below. **yes** decodes; **no**
refused or fails; *derived* read from code, not run; *nf* not found. "Out" is the `VideoFrame.format` the page gets.

| engine · platform · decoder | Main / High / Pro | 8 / 10 / 12 bit | 4:0:0 | 4:2:0 | 4:4:4 | out, > 8 bit |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium desktop (Win, mac, Linux, ChromeOS), dav1d | yes / yes / yes [C3] | yes / yes / **no** [C4] | yes, as `I420`, chroma mid [C3] | yes | yes | `I420P10`, `I444P10` [C3] |
| Chromium, Windows D3D11/12 | yes / if the GPU has it / if the GPU has it [C5] | yes / yes / Pro only, may fail at first decode [C5] | no [C5] | yes | High or Pro [C5] | *nf* |
| Chromium, Linux VA-API | yes / no / no [C5] | yes / yes / no [C5] | no [C5] | yes | no | *nf* |
| Chromium, ChromeOS V4L2 | yes, *derived* / *nf* / *nf* [C5] | yes / yes / no [C5] | no [C5] | yes | no, *derived* [C5] | *nf* |
| Chromium, macOS VideoToolbox | yes / no / no [C5] | yes / *nf* / no | no [C5] | yes | no | *nf* |
| Chrome Android, dav1d | yes / yes / yes [C3] | yes / yes / **no** [C4] | yes, as `I420` [C3] | yes | yes | as desktop, *derived* |
| Chrome Android, MediaCodec | yes / no / no [C5] | yes / yes / no [C5] | *nf* | yes | no [C5] | *nf* |
| Edge (any) | *nf* — Chromium's rows, *unverified* [C6] | | | | | |
| Safari macOS · iOS, VideoToolbox | yes / no / no [W1] | yes / yes / *nf* [W3] | *nf* [W3] | yes [W3] | no [W1] | `null` for 10-bit [W5] |
| Safari, dav1d (preview flag only) [W2] | yes / no / no [W1] | yes / no / no [W4] | no [W4] | 8-bit only [W4] | no [W1, W4] | — |
| WebKitGTK · WPE, GStreamer | yes / no / no [W1] | the plugin's [W6] | the plugin's [W6] | yes [W6] | no [W1] | *nf* |
| Firefox desktop, bundled FFmpeg or dav1d | yes / full string / full string [G2] | yes / yes / yes, *derived* [G3] | **no** [G3] | yes | yes, as 8-bit `BGRX` [G4] | `BGRX`, 8 bits [G4] |
| Firefox, Windows WMF | *nf* [G5] | yes / yes / *nf* [G5] | *nf* | yes | *nf* | `BGRX`, *derived* [G4] |
| Firefox, Linux VA-API | *nf* | yes / yes / *nf* [G5] | no, *derived* [G5] | yes | no, *derived* [G5] | *nf* |
| Firefox, macOS VideoToolbox | yes / no / no [G5] | yes / yes / no [G5] | *nf* | yes | no [G5] | *nf* |
| Firefox Android, any | no — WebCodecs refused [G1] | | | | | |

## Chromium

Read at `chromium/src` main, tip `db89eb15d8217da45eb6c974402e0e039402371c`, 2026-11-07
(`https://chromium.googlesource.com/chromium/src/+/<commit>/<path>`). Measured here on 141.0.7390.37 (Linux, no GPU):
8- and 10-bit exact in 4:0:0, 4:2:0, 4:2:2 and 4:4:4, every 12-bit stream refused
([`../decode/README.md`](../decode/README.md) §WebCodecs, what it decodes exactly).

**[C1] The codec string.** `media/base/video_codec_string_parsers.cc` `ParseAv1CodecId` maps `case 1:` to
`AV1PROFILE_PROFILE_HIGH`, `case 2:` to `AV1PROFILE_PROFILE_PRO`, and accepts bit depths 8, 10 and 12. It rejects
monochrome in High (`"Monochrome isn't supported in high profile."`). 4:4:4 in Main is only logged (`DVLOG(3) <<
__func__ << "4:4:4 isn't supported in main profile.";`) and not refused, *derived*.

**[C2] `isConfigSupported`.** `third_party/blink/renderer/modules/webcodecs/video_decoder.cc` keeps four of the
string's fields, `out_video_type = {result->codec, result->profile, result->level, result->color_space};` (L115–116).
It then asks `!media::IsDecoderSupportedVideoType(*video_type)` (L308). For AV1 that is, in
`media/base/supported_types.cc` L284–292:

```cpp
bool IsDecoderAV1Supported(const VideoType& type) {
  // If the AV1 decoder is enabled, or if we're on Q or later, yes.
#if BUILDFLAG(ENABLE_AV1_DECODER)
  return IsColorSpaceSupported(type.color_space);
```

So without `prefer-hardware` the answer is the colour space's, whatever the profile, depth or chroma (*derived*). It
matches the measurement: `true` for every 12-bit string, and for strings AV1 forbids.

**[C3] The software decoder is dav1d, everywhere Blink is.**
* `media/media_options.gni`: `enable_dav1d_decoder = use_blink`, `enable_av1_decoder = enable_dav1d_decoder`.
* `media/renderers/default_decoder_factory.cc` pushes `OffloadingDav1dVideoDecoder` with no Android guard.
* `third_party/dav1d/BUILD.gn` builds `"-DBITDEPTH=8"` and a `dav1d_10bit` library with `"-DBITDEPTH=16"`.
* The `config.h` for linux x64, arm64 and arm and for win x64 each `#define CONFIG_16BPC 1`. Android builds take
  `config/linux/$current_cpu` (`BUILD.gn` L30), *derived*.
* `media/filters/davxd_video_decoder_base.cc` maps I420, I422 and I444 at 8, 10 and 12 bits to `PIXEL_FORMAT_I420` /
  `YUV420P10` / `YUV420P12` and so on.
* Monochrome: `// Single plane monochrome images will be converted to standard 3 plane ones`, chroma
  `const uint16_t kBlankUV = (1 << bit_depth) / 2;`.

libgav1 is no longer a decoder here: `media/filters/gav1_video_decoder.cc` is gone.

**[C4] Why 12 bits fails: the key-frame check, not the decoder.**
* `video_decoder.cc` `ParseAv1KeyFrame` (L170–180) runs `libgav1::ObuParser … parser.ParseOneFrame(&frame)` and sets
  `*is_key_frame = status_code == libgav1::kStatusOk && …`.
* A chunk that comes back not key is refused: `"An EncodedVideoChunk was marked as type `key` but wasn't a key frame.
  A key frame is required after configure() or flush()."` (L687–691).
* `third_party/libgav1/BUILD.gn` L17 defines `"LIBGAV1_MAX_BITDEPTH=10"`.
* libgav1 at the revision Chromium's `DEPS` pins, `4ad433700e5d7c45df3d6146b7c92c8945c19e64`, has this in
  `src/obu_parser.cc` L2879–2884
  ([source](https://chromium.googlesource.com/codecs/libgav1/+/4ad433700e5d7c45df3d6146b7c92c8945c19e64/src/obu_parser.cc)):

```cpp
if (sequence_header_.color_config.bitdepth > LIBGAV1_MAX_BITDEPTH) {
  …
  return kStatusUnimplemented;
```

The measurement's `DataError: A key frame is required` on every 12-bit first chunk is this. This document finds that
it holds on today's main as it did on 141, 154 and 155 (the newer-versions survey, queue row VERSIONS). The VERSIONS
survey and the source agree.

**[C5] Hardware.** `media/gpu/av1_decoder.cc`, shared by VA-API, D3D11/12, VideoToolbox and (*derived*) V4L2:
* Main and High take `bit_depth == 8u || bit_depth == 10u`; Pro takes those or `12u`.
* Any chroma but 4:2:0 and 4:4:4 is refused at decode with `"Only YUV 4:2:0 and YUV 4:4:4 are supported"`; monochrome
  is `k400`, so it never decodes in hardware.

Per platform:
* **Windows**, `media/gpu/windows/supported_profile_helpers.cc`: `// Note: Each bit depth of AV1 uses a different
  DXGI_FORMAT, here we only test for the 8-bit one (NV12).` It queries `DXVA_ModeAV1_VLD_Profile0`, `Profile1` and
  `Profile2`. On 12-bit Profile 2: "we don't know the bit depth or pixel format until too late. In these cases we'll
  end up initializing the decoder and failing on the first decode".
* **VA-API**, `media/gpu/vaapi/vaapi_wrapper.cc`: `{AV1PROFILE_PROFILE_MAIN, VAProfileAV1Profile0}, // VaapiWrapper
  does not support AV1 Profile 1.` Output is NV12 or P010 (`vaapi_video_decoder.cc`).
* **V4L2**, `media/gpu/v4l2/v4l2_video_decoder.cc`: `bit_depth = (bit_depth == 10u) ? 10 : 8` with both subsampling
  flags set.
* **macOS**, `media/gpu/mac/video_toolbox_video_decoder.cc`: `/*profile_min=*/AV1PROFILE_PROFILE_MAIN,
  /*profile_max=*/AV1PROFILE_PROFILE_MAIN`.
* **Android**:
  * `media/base/android/java/src/org/chromium/media/CodecProfileLevelList.java` maps only `AV1ProfileMain8`,
    `Main10` and the HDR Main10 profiles.
  * `media/gpu/android/media_codec_video_decoder.cc`: `// Don't allow OS software decoding for bundled software
    decoders unless` the content is encrypted. So clear AV1 is MediaCodec hardware or dav1d (*derived*).
  * Which comes first for a WebCodecs decoder: *unverified*.

Whether a hardware decode error falls back to dav1d inside WebCodecs: *not found*.

**[C6] Edge.** No Microsoft document on Edge's AV1 or WebCodecs support was found on learn.microsoft.com. Edge is
assumed to share Chromium's code (*unverified*); its Windows hardware path would be [C5]'s D3D rows.

## WebKit

Read at WebKit main `dab1a6d759d2fceef0c7da3fa4e30989813b6aae`, 2026-11-07
(`https://github.com/WebKit/WebKit/blob/<commit>/<path>`). Measured here: WebKitGTK 2.52.6 failed every AV1 unit,
4:4:4 refused as `av01.1` ([`../decode/README.md`](../decode/README.md) §Why, and what would make it exact).

**[W1] Main profile only, every port.** `Source/WebCore/Modules/webcodecs/WebCodecsVideoDecoder.cpp`
`isSupportedDecoderCodec`:

```cpp
|| (codec.startsWith("av01.0"_s) && settings.webCodecsAV1Enabled);
```

So `av01.1` (all 4:4:4 at 8/10 bits) and `av01.2` (all 12 bits) are unsupported to `isConfigSupported` and to
`configure()`. The function that does check profile, depth and chroma, `validateAV1Parameters`, is called from
`PlatformMediaEngineConfigurationFactoryCocoa.cpp`, Media Capabilities, and not from WebCodecs (*derived*).

**[W2] On by hardware, on Cocoa.**
* `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`: `WebCodecsAV1Enabled:` with `status: preview` and
  defaults `"USE(GSTREAMER)": true` / `default: false`.
* `Source/WebKit/WebProcess/GPU/webrtc/LibWebRTCCodecs.cpp` `setHasAV1HardwareDecoder`: `if
  (!hasAV1HardwareDecoder) return;` … `settings.setWebCodecsAV1Enabled(true);`.
* The probe, `Source/WebCore/platform/graphics/cocoa/AV1UtilitiesCocoa.mm`: `VTIsHardwareDecodeSupported('av01')`.
* Apple, [Safari 17.5 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-17_5-release-notes)
  (read 2026-11-07): "Added support for WebCodecs AV1 when an AV1 hardware decoder is available. (123433815)", and
  "Fixed AV1 to decode in hardware on iPhone 15 Pro. (121924090)". The same change is WebKit bug
  [269908](https://bugs.webkit.org/show_bug.cgi?id=269908), "[Cocoa] Enable WebCodecs AV1 when HW AV1 decoder is
  available", RESOLVED FIXED.
* Which Macs and iPhones have the hardware: Apple list *not found*.
* A WebKit engineer, bug [329735](https://bugs.webkit.org/show_bug.cgi?id=329735) comment 2 (2026-11-04): "It does
  appear the AV1 is still in Preview stage at the moment, so only STP is affected (or via enabling the feature
  flag)". The same bug's report decodes AV1 Main 10 through `VideoDecoder` in release "Safari 27.0 … MacBook Air
  15-inch M3 (2024), hardware AV1 decoding". The code above explains the report; the comment is not reconciled
  (*unverified*).

**[W3] VideoToolbox output.** `Source/WebCore/platform/video-codecs/cocoa/GPUVideoDecoderVTB.mm`:
`ASSERT(bitDepth == 8 || bitDepth == 10);` then `kCVPixelFormatType_420YpCbCr10BiPlanar…` or `…8BiPlanar…`: 4:2:0
only. The session asks `kVTVideoDecoderSpecification_EnableHardwareAcceleratedVideoDecoder: @YES`, which is "Enable",
not "Require" (`VideoDecoderVTBSession.mm`). What VideoToolbox does with a 4:0:0 Main stream: *not found*. Apple
documents no AV1 profile, depth or chroma limits that were found: [`kCMVideoCodecType_AV1`](https://developer.apple.com/documentation/coremedia/kcmvideocodectype_av1)'s
page has no abstract.

**[W4] The software path.** Without hardware, `LibWebRTCCodecs.cpp` returns `{ }` for `av01.`, and the local decoder is
`LibWebRTCVPXVideoDecoder::Type::AV1` → `createLibWebRTCDav1dDecoder()`. That decoder,
`Source/WebCore/platform/mediastream/libwebrtc/LibWebRTCDav1dDecoder.cpp`:

```cpp
// Only accept I420 pixel format and 8 bit depth.
if (dav1dPicture.p.layout != DAV1D_PIXEL_LAYOUT_I420 || dav1dPicture.p.bpc != 8)
    return WEBRTC_VIDEO_CODEC_ERROR;
```

It is reached only with the preview flag on, [W2].

**[W5] 10-bit output is `format: null`.** Bug 329735's report, Safari 27.0 on an M3, prints for a decoded AV1 Main
10-bit keyframe: `isConfigSupported(no-preference): true` / `frame.format=null`. By §9.4.3 such a frame's planes
cannot be copied, only converted to 8-bit RGB (*derived*). One report, one stream: *unverified* beyond it.

**[W6] GStreamer.** `Source/WebCore/platform/graphics/gstreamer/GStreamerRegistryScanner.cpp`:
`m_decoderCodecMap.add("av01*"_s, av1DecoderAvailable);`, so WebKit checks no profile, depth or chroma and passes the
stream to whichever AV1 element the system has (`vaav1dec`, `dav1ddec`, `av1dec`; `VideoDecoderGStreamer.cpp`).
Bug [327481](https://bugs.webkit.org/show_bug.cgi?id=327481), "[GStreamer][WebCodecs] AV1 VideoDecoder: every
decode() fails, no av1parse before the decoder", is FIXED. That bug is the measured WebKitGTK 2.52.6 failure (*derived*).

## Firefox

Read at `FIREFOX_157_0_RELEASE` (`https://github.com/mozilla-firefox/firefox/blob/FIREFOX_157_0_RELEASE/<path>`) and
checked against main (162.0a1), 2026-11-07. Measured here on 157.0 (Linux): monochrome refused, everything else back as
8-bit `BGRX` ([`../decode/README.md`](../decode/README.md) §Why, and what would make it exact, which reads the same
source).

**[G1] No WebCodecs on Android.**
* `dom/media/webcodecs/VideoDecoder.cpp` `CanDecode`: `// TODO: Enable WebCodecs on Android (Bug 1840508)` /
  `if (IsOnAndroid()) {` / `return false;`.
* `modules/libpref/init/StaticPrefList.yaml`: `dom.media.webcodecs.enabled` is `@IS_NIGHTLY_BUILD@` under
  `MOZ_WIDGET_ANDROID`.
* Bug 1840508 is a duplicate of [1934008](https://bugzilla.mozilla.org/show_bug.cgi?id=1934008), "Ship Web Codecs on
  Android", NEW.
* [Firefox 130 release notes](https://www.mozilla.org/en-US/firefox/130.0/releasenotes/): "Enabled the Web Codecs API
  on desktop platforms".

**[G2] The codec string.** `dom/media/VideoUtils.cpp` `ExtractAV1CodecDetails`: "Valid profiles are: Main (0), High
(1), Professional (2)", "Supported bit depths are 8, 10 and 12", "Profile 1 only supports 4:4:4". The short form
defaults to 4:2:0 (`aSubsamplingX = true; aSubsamplingY = true;`), so a profile 1 string needs its subsampling field
(*derived*). `isConfigSupported` decides through the media element's path: `TODO (1880326): code below is wrongly using
the logic of HTMLMediaElement` (`VideoDecoder.cpp`).

**[G3] The decoders, and monochrome.**
* `dom/media/platforms/PDMFactory.cpp` `CreateRddPDMs` starts the bundled FFmpeg (`FFVPXRuntimeLinker`) before
  `AgnosticDecoderModule` (dav1d), unless `media.prefer_non_ffvpx`.
* Through FFmpeg, monochrome fails with `EncodingError` (the cause traced here before, `GRAY8` with no plane
  geometry).
* Through dav1d it would be dropped, `dom/media/platforms/agnostic/DAV1DDecoder.cpp`: `if ((*picture).p.layout ==
  DAV1D_PIXEL_LAYOUT_I400) {` / `// Use NS_OK to indicate that this picture should be skipped.`
* dav1d keeps the depth (`b.mColorDepth = gfx::ColorDepthForBitDepth(aPicture.p.bpc);`), so 12-bit decodes (*derived*,
  not run).

**[G4] Everything returns as 8-bit `BGRX`.** `gfx/layers/client/GPUVideoTextureClient.cpp`:

```cpp
// TODO: We should probably try do better for this.
// layers::Image doesn't expose a format, so it's hard
// to figure out in VideoDecoderParent.
aInfo.format = SurfaceFormat::B8G8R8X8;
```

`VideoDecoder.cpp` reports that texture's format, and `copyTo` reads it back as RGB. Two bugs track it:
* [2071132](https://bugzilla.mozilla.org/show_bug.cgi?id=2071132), "VideoFrame.format reports I420 for 10-bit planar
  frames and BGRA for frames created from a video element". RESOLVED FIXED 2026-10-18; first release *unverified*.
* [1969762](https://bugzilla.mozilla.org/show_bug.cgi?id=1969762), "VideoFrame.format reports BGRX for
  remote-decoded frames and copyTo cannot return YUV planes (Chrome returns I420)". ASSIGNED.

Main's `dom/media/ImagePixelFormat.cpp` now names `I420P10` … `I444P12` but keeps `case ImageFormat::GPU_VIDEO:` /
`// This process only reads a remote image back as RGB.` / `return Some(ImagePixelFormat::BGRX);`. Until 1969762
lands, no WebCodecs frame over 8 bits is exact in Firefox.

**[G5] Hardware.**
* **macOS**, `dom/media/platforms/apple/AppleDecoderModule.cpp`: `// HW AV1 decoder only supports 8 or 10 bit color.`,
  `// HW AV1 decoder doesn't support RGB`, `return profile == 0;`.
* **Windows**, `WMFVideoMFTManager.cpp`: "Use VP8/VP9/AV1 MFT only if HW acceleration". The outputs are
  `MFVideoFormat_YV12`, `MFVideoFormat_P010` and `MFVideoFormat_P016`, and `SupportsColorDepth` returns `true`.
* **Linux VA-API**, `FFmpegVideoDecoder.cpp`: `AV_PIX_FMT_NV12` … `AV_PIX_FMT_P016`, all 4:2:0.

## Where `isConfigSupported` and decode disagree

Sourced, not inferred from a run, except where the measurement is named:

* **Chromium, 12 bits.** Supported (`IsDecoderAV1Supported` checks the colour space only, [C2]). It fails on the first
  chunk, [C4]. Measured on 141.
* **Chromium, Windows 12-bit Profile 2 in hardware.** The source says so itself: "we'll end up initializing the decoder
  and failing on the first decode" ([C5]).
* **Chromium, strings AV1 forbids** (profile 0 with 4:4:4 or 12 bits) answer `true` (measured; [C1] logs and goes on).
* **WebKit's software path.** `isConfigSupported` resolves `!!result` of creating the decoder, which reads no depth
  (`WebCodecsVideoDecoder.cpp`), and the decoder refuses all but 8-bit 4:2:0 ([W4]). *Derived*, not run.
* **WebKit, opened windows.** Bug [318440](https://bugs.webkit.org/show_bug.cgi?id=318440), "WebCodecs: AV1
  isConfigSupported returns false in windows opened from another page", NEW. `setHasAV1HardwareDecoder` flips the
  setting on `Page::forEachPage` (*derived*; a page made later is not shown to receive it).
* **Firefox, monochrome.** Supported (the string passes, [G2]); decode refused (measured on 157, [G3]).
* **Firefox, depth.** Supported and decoded, but the frame is 8-bit `BGRX` ([G4]): the support answer says nothing of
  exactness.

The measurement's conclusion stands on the sources: a client learns what decodes exactly by decoding a known frame, not
by asking ([`../decode/README.md`](../decode/README.md) §AV1 in WebKit and Firefox).

## What it means here

**12-bit grey DBT.**
* Whole, it is a Professional stream (`av01.2.…12.1.110`). No engine's WebCodecs takes it:
  * Chromium refuses it at the key-frame check, [C4].
  * WebKit refuses `av01.2`, [W1].
  * Firefox would decode it but return 8 bits, [G4], and refuses monochrome anyway, [G3].
* So dav1d-WASM stays the only exact decoder for the whole stream, as the lab has it.
* The split's top 10 bits through WebCodecs are a Main 4:0:0 stream (`av01.0.…10.1.110`):
  * Chromium decodes that exactly as `I420P10`, measured.
  * Safari's hardware path is 4:2:0 out ([W3]), and its 10-bit frames came back `format: null` in the one report
    found ([W5]). An exact read-back there is not shown.
  * Firefox refuses it.
* So the top-10-bits path is a Chromium path (desktop, and Android through dav1d, *derived*). Elsewhere the split falls
  back to dav1d-WASM, as the client already does on a refusal.
* If Chromium's libgav1 were built at 12 bits ([C4]), the whole 12-bit grey stream would decode as `I420P12`, mid-grey
  chroma (*derived*: [C3]'s formats and `kBlankUV`). Nothing measures that build.

**10-bit RGB.**
* As 4:4:4 (the RCT's output, or GBR) it is High (`av01.1.…10.0.000`):
  * Chromium's dav1d decodes it, `I444P10`, measured exact. No Chromium hardware path takes 4:4:4 except D3D with a
    Profile 1 GUID, [C5].
  * Safari refuses `av01.1`, [W1], and VideoToolbox outputs 4:2:0, [W3].
  * Firefox returns 8 bits of it, [G4].
* So exact 10-bit RGB through WebCodecs is Chromium and its software decoder only, and needs `prefer-software` or the
  default to land on dav1d.
* Coding RGB as Main 4:2:0 would put it in Safari's and the hardware paths, but 4:2:0 subsamples chroma. It is not
  lossless RGB and is outside this project's lossless contract (*derived*).
