# A hardware frame inverted to its samples and checked

*Queue row MOBILE-OPT-HW-INVERTED, 2026-11-15, the option of [`new-options.md`](new-options.md) §3, §4 and §2.1
(`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendments 20 and 21), worked out as its advocate, then its
disadvantages. Sources and theory, and two cloud byte cells pre-registered in §8 before either ran. Nothing run on a
device or a GPU. Every choice stays the owner's.*

Labels, as [`new-options.md`](new-options.md): **(S)** a source quoted verbatim, listed in §13 with its revision (S1–S5 as `new-options.md` lists them);
**(R)** a result of this repository, by its file; **(D)** derived here, the arithmetic written out; **(T)** theory,
not measured; **(M)** measured here, §9.

## 1. What it shows

* **On every engine traced, the page cannot switch the conversion off; it can only choose what it feeds in** (§2,
  S). Chromium (157 on the phone and 158, today's stable, identical on every function read), WebKit and Gecko all
  upload a hardware `VideoFrame` to WebGL by a GPU copy that never reads `UNPACK_COLORSPACE_CONVERSION_WEBGL`
  (Chromium reads it only on its software fallback; Gecko's `VideoFrame` upload never passes it on). The HTML
  standard applies `colorSpaceConversion` only to "an img element or a Blob object". What reaches the texture is the
  YCbCr-to-RGB step alone: Chromium's copy says it reinterprets the colour space "to disable color conversion", and
  WebKit and Gecko apply a matrix and a range and nothing else.
* **Who picks the range and matrix differs by engine** (§2, S): on Android Chromium the GPU driver's suggestion for
  the decoder's buffer (Vulkan's `suggestedYcbcrRange`, Dawn's `yCbCrInfo`, or the external texture's EGLImage);
  on desktop Chromium the frame's colour space, which `VideoDecoderConfig.colorSpace` overrides; on Safari the
  pixel format (`420v` narrow, `420f` full); on desktop Firefox **narrow range always**, its own code noting "The
  colorspace is known by the IOSurface, why override it?"; on Firefox for Android the EGL driver's (*corrected
  2026-11-15, PR 397 §Review item 3: this read "narrow range always" on every platform; every Android blit samples an
  external texture with "kFragSample_OnePlane, kFragConvert_None", §2*).
* **So the one form every engine inverts is studio swing on 16…235** (§3, §4, D): a narrow reading maps it
  one-to-one, a full reading leaves it one-to-one, and desktop Firefox reads every stream as narrow (on Android the
  driver picks, as on Chromium: item 3 of PR 397 §Review). 220 levels, 7.78 bits.
* **One-to-one is likely, not promised** (§3). Vulkan specifies the range expansion "at least" to the source's
  precision and asks float-to-unorm rounding that "should" be to nearest; with that, the 220 levels map to 220
  distinct values (D). Its "must" allows either neighbour, which would merge most adjacent pairs; the GL external
  path specifies nothing; desktop Firefox's matrix is a `mediump` uniform, and evaluated in fp16 it merges one pair of
  the 220 (D, an emulation, not an engine run; Firefox for Android applies no matrix of its own, §2). The digest, checked on every frame, is what decides; a calibration unit
  finds a merging device once a session (§6).
* **The check costs about half today's** (§5, D): 8 519 680 bytes read back and hashed for a `dbts_b1` frame against
  today's 17 039 360, about 2.6 ms of XXH3 at the client's measured ~3.3 GB/s (R, desktop containers; the phone
  unmeasured); the read-back's time on a phone is unknown.
* **At 220 levels the windows lose a little more than at 256** (§4, D): 4.67 source units a step on a 10-bit series
  and 18.70 on a 12-bit one, against 4.01 and 16.05 for an 8-bit picture of the 10-bit view. Unlike the unchecked
  path, the rounding here comes **before** the coder, so the noise rule is met by choosing Q (M, §9): Q 2–5 on the
  12-bit volumes and 4–9 on the 10-bit ones, at **0.97–1.47× the 256-level cut's bytes, 1.16–2.49× today's**.
* **The coded luma does not stay in 16…235** (M, §9 I4): every cell overshoots on every frame, down to code 8 (12-bit)
  and 0 (10-bit), up to 239. The form needs headroom, and with it fewer than 220 levels, or the ingest's range check
  rejects every frame as coded (§4).
* **Whether a phone's hardware decoder takes the frame is still not documented** (§7): of the vendors' pages read,
  only MediaTek's Dimensity 9400 ties AV1 decode to a size ("8K60, 10-bit Video Decode (HEVC/AVC/VP9/AV1)"), whose
  box holds `dbts_b1` upright; no page names a level.

## 2. The route, per engine (S)

The route of [`new-options.md`](new-options.md) §3: decode in hardware (WebCodecs `prefer-hardware`), draw the frame
into a WebGL2 (or WebGPU) texture, read the red channel back through a measured inverse table, hash, paint from the
recovered samples. What each engine's upload computes for a hardware `VideoFrame`:

**Chromium, Android, 157.0.8103.79 and 158.0.8127.36** (S6; the functions quoted are byte-identical in both, D by
diff). `TexImageHelperMediaVideoFrame` takes the GPU copy when `use_copy_texture_chromium` holds: `texImage2D`, the
default source rectangle, depth 1, `TEXTURE_2D`, no frame transform, and `unpack_color_space_is_srgb`. A hardware
frame `HasSharedImage()`, so the copy is `CopySharedImageDirectlyToGLTexture` or, failing that, an intermediate RGBA
image filled by `PaintCanvasVideoRenderer::CopyVideoFrameToSharedImage`, whose shared-image branch is a raster
`CopySharedImage` of the frame's coded rectangle. That copy, in the GPU process:

> "// Reinterpret the source image as being in the destination color space, // to disable color conversion." …
> `canvas->drawImageRect(source_image_reinterpreted, …, SkSamplingOptions(), &paint, SkCanvas::kStrict_SrcRectConstraint)`
> (`copy_shared_image_helper.cc`)

`SkSamplingOptions()` is nearest-neighbour, and the source and destination rectangles are the same size, so no
filter touches a sample (D). `UNPACK_COLORSPACE_CONVERSION_WEBGL` enters only through
`params.unpack_colorspace_conversion`, which this branch never reads; it is read further down, on the fallback that
builds a snapshot (`kReinterpretAsSRGB` when it is `NONE`), which a hardware frame reaches only if the copy fails (D,
from the function's control flow).

The YCbCr-to-RGB step is the sampler's, and on Android its parameters come from the driver
(`video_image_reader_image_backing.cc`, `vulkan_image_android.cc`):

* Vulkan: `ycbcr_info_.emplace(VK_FORMAT_UNDEFINED, ahb_format_props.externalFormat,
  ahb_format_props.suggestedYcbcrModel, ahb_format_props.suggestedYcbcrRange, …)`; the Vulkan specification calls
  these "a suggested color model" and "a suggested numerical value range to use in the
  VkSamplerYcbcrConversionCreateInfo" (S9, `memory.adoc`).
* Graphite on Dawn: "// Obtain the YCbCr info from the device." `device.GetAHardwareBufferProperties(…)`, then
  `ahb_properties.yCbCrInfo` into the texture's description; the texture format is `OpaqueYCbCrAndroid`.
* GL: the buffer bound as `GL_TEXTURE_EXTERNAL_OES`, whose extension says "The parameters of the transformation from
  one basis (e.g. YUV) to RGB (color conversion matrix, sampling offsets, etc) are taken from the EGLImage which is
  associated with the external texture" (S10).

The page's own colour space reaches the decoder only as a hint: with `kMediaCodecColorSpaceCleanup`
(`FEATURE_ENABLED_BY_DEFAULT` at 157), `config->container_color_space =
MediaFormatColorSpace(decoder_config_.color_space_info())` (`media_codec_video_decoder.cc`), and WebCodecs fills
that from `VideoDecoderConfig.colorSpace` when present (`video_decoder.cc`: "if (config.hasColorSpace()) { …
media_color_space = color_space->ToMediaColorSpace();"). Android documents `KEY_COLOR_RANGE` only as "An optional
key describing the range of the component values of the video content" (S11); whether a codec's output buffer
follows the hint or the bitstream is the codec's (T). **What the page controls on Android is the bitstream**, which
the ingest writes.

**Chromium, desktop** (S6, the same Blink path). The source image is Skia's YUVA image of the multi-planar shared
image, its matrix and range from the frame's `gfx::ColorSpace`: "case MatrixID::BT709: *out = range_ ==
RangeID::FULL ? kRec709_Full_SkYUVColorSpace : kRec709_Limited_SkYUVColorSpace;" (`ui/gfx/color_space.cc`). The
frame's colour space is the decoder config's when the page sets one. Here the inversion is not needed at 8 bits:
`copyTo` returns a hardware frame's `NV12` planes (R, [`other-codecs.md`](other-codecs.md)), which are the samples.

**Safari (WebKit `19c5103d`)** (S7). `texImageSource(…, WebCodecsVideoFrame&)` takes the GPU copy only for frames
whose format is `I420` or `NV12` ("FIXME: We should be able to remove the YUV restriction"), and
`copyTextureFromVideoFrame` never receives the unpack colour-space state. The range is the pixel format's:
`kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange` "return EGL_YUV_NARROW_RANGE_EXT", `…FullRange` "return
EGL_YUV_FULL_RANGE_EXT", any other format first converted "to" `kCVPixelFormatType_420YpCbCr8BiPlanarFullRange`; the
matrix is the buffer's `kCVImageBufferYCbCrMatrixKey`, and "Assume unknown matrices are ITU R.601." ANGLE does the
conversion from those EGL hints; its arithmetic was not traced. WebCodecs AV1 on Safari is software when enabled (R,
`claude/hw-decode:docs/decode/hardware.md` §15), so a hardware AV1 frame reaches WebKit only through `<video>`, whose
upload path was not traced here.

**Firefox (`mozilla-firefox/firefox` release `dc1259ae`)** (S8). `FromVideoFrame` calls `SurfaceFromVideoFrame(…,
kDefaultSurfaceFromElementFlags)`; only `FromDomElem` adds "SFE_NO_COLORSPACE_CONVERSION" when
`unpacking.colorspaceConversion == LOCAL_GL_NONE` (`WebGLTextureUpload.cpp`). The blit's matrix is
`gfxUtils::YuvToRgbMatrix4x4ColumnMajor(…)`, whose tables are all narrow range ("kBT709NarrowYCbCrToRGB_RowMajor …
1.16438f"), with the code's own note on IOSurface and DMABuf: "// TODO: The colorspace is known by the IOSurface, why
override it? // See GetYUVColorSpace/GetFullRange()". The matrix is "uniform mediump MAT4X3 uColorMatrix"
(`GLBlitHelper.cpp`), applied only by the planar, IOSurface and DMABuf blits (lines 1300, 1542, 1754). On Android the
blit reads a `SurfaceTexture`, an `AndroidHardwareBuffer` or an
`AndroidImageReader` image through EGL, as Chromium's GL path does, with "kFragSample_OnePlane, kFragConvert_None"
(lines 1173, 1227, 1260): no matrix of Firefox's own, the driver's range (*corrected 2026-11-15, PR 397 §Review
item 3: §1 and §4 read Firefox as narrow on every platform*).

**`createImageBitmap`** is no way around it: "If image is an img element or a Blob object, let val be the value of
the colorSpaceConversion member of options … If val is "none", output must be decoded without performing any color
space conversions." (S12). A `VideoFrame` is neither.

**WebGPU.** On Android, Chromium imports the same buffer as `OpaqueYCbCrAndroid` with the device's `yCbCrInfo`
(above), so `importExternalTexture` sees the same conversion (S6). Its shaders read 8 bits a channel (R,
[`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §2).

## 3. Is the map one-to-one on 16…235?

**The ideal map** (R, [`new-options.md`](new-options.md) §3.1): narrow range, p = 255 × (Y − 16) ÷ 219, steps of
1.1644, one-to-one after any single rounding to nearest. Full range, p = Y. With neutral chroma R = G = B under any
matrix (same file, §3 step 2).

**Vulkan, the specified case** (S9, `textures.adoc` §Sampler YCbCr Range Expansion): narrow range is "Y′ =
(C′rgba[G] × (2ⁿ−1) − 16 × 2ⁿ⁻⁸) ÷ (219 × 2ⁿ⁻⁸)", and "The precision of the operations performed during range
expansion must: be at least that of the source format." The write into the RGBA8 target follows "Conversion From
Floating-Point to Normalized Fixed-Point": "convertFloatToUint(r,b) returns one of the two unsigned binary integer
values with exactly b bits which are closest to the floating-point value r. Implementations should: round to
nearest." (`fundamentals.adoc`). So (D):

* with rounding to nearest and fp32 arithmetic, the 220 values stay 220 (computed: 220 distinct, smallest gap 1);
* under the "must" alone, a value may go to either neighbour: for p = n + f, 0 < f < 0.836, rounding p up and p +
  1.1644 down gives both n + 1, so most adjacent pairs *may* merge. The specification does not promise the map;
* "at least that of the source format" allows an error near 2⁻⁸ of full scale, about one output level, which also
  permits a merge.

**GL external textures** specify no arithmetic at all (S10). **Desktop Chromium** converts in Skia's shader in float
(S6; not traced further). **Safari** converts in ANGLE (not traced). **Firefox** (desktop; on Android no matrix of its own, §2): the matrix row for red,
1.16438 Y
+ 1.79274 Cr − 0.97295, gives with Cr = 128/255 exactly the ideal 1.16438 Y − 0.07306 (D: 1.79274 × 0.501961 −
0.97295 = −0.07306; G and B agree to 6 × 10⁻⁶). Evaluated in fp32 it keeps 220 levels; evaluated in fp16, as a
`mediump` uniform may be on a phone's GPU, it merges one pair: **219 distinct** (D, numpy's `float16` with a rounding
after each operation, an emulation of one possible evaluation order, not of a GPU).

**What is monotonic for certain** (D): each step is an increasing affine map and one rounding, so a correct
implementation never reverses two values; a merge is the failure, and it is visible in the calibration unit (§6) as
two expected samples sharing one picture value. Where the map merges, the check fails on every frame that holds
either value, the frame falls back to software, and the route is off on that device (§6).

## 4. The form, and the window at 220 levels

**The form** (the advocate's choice, D from §2–§3):

* 8-bit 4:2:0, both chroma planes 128 (neutral in both ranges: narrow (128 − 128) ÷ 224 = 0, full 128 − 2⁷ = 0 by
  Vulkan's formulae, S9), AV1 Main profile, the hardware form of
  [`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §5;
* luma `c = 16 + round(v ÷ s)`, s = (2^D − 1) ÷ 219, **studio swing** (`color_range` 0): the only range every engine
  of §2 inverts, desktop Firefox's included; on phones the range is the driver's in both Chromium and Firefox, so the
  reason rests on the driver, which M6 and M10 check (*corrected 2026-11-15, PR 397 §Review item 3*);
* a colour description written in the sequence header (BT.709 primaries, transfer and matrix) and the same values in
  `VideoDecoderConfig.colorSpace` with `fullRange: false`, so that no engine falls back to a guess (Safari's "Assume
  unknown matrices are ITU R.601" is harmless for grey; a guessed *range* is not, T);
* the ingest's guarantees, checked at ingest on its own decode: every chroma sample 128 (held on all 129 cells, M,
  §9 I5) and every decoded luma sample inside 16…235. **The second fails as the form stands** (M, §9 I4): every
  cell's decode leaves the range on every frame, 4.6·10⁻⁵–2.0·10⁻³ of the samples, as far as 16 codes below 16 and 4
  above 235. So the source must be mapped to a narrower span inside 16…235 (about 32…231 covers the overshoot
  measured, 200 levels, 7.64 bits, D: 32 = 16 + 16, 231 = 235 − 4) or clamped at ingest before coding; which, and at
  what bytes, is unmeasured (T).

**Full range where it is honoured** would give 256 levels (8 bits instead of 7.78): Safari's `420f`, desktop
Chromium with the config's colour space, an Android codec whose buffer says full. The calibration unit (§6) could
tell a session which it has, but the stream is coded once for all of them, so the form stays studio (T).

**One step in source units** (D): s = 1023 ÷ 219 = **4.671** on a 10-bit series and 4095 ÷ 219 = **18.70** on a
12-bit one; [`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §3.2's 8-bit picture of the 10-bit view has
4.012 and 16.05. **Display levels a step** (255 across the window), beside that file's table:

| series | W | today's view | unchecked, 256 levels | this route, 220 levels |
| --- | --- | --- | --- | --- |
| 10-bit, header window | 512 | 0.50 level a code | 2.0 | 512 ÷ 4.671 = 109.6 inputs; 255 ÷ 109.6 = **2.33** |
| 10-bit, narrow | 64 | 3.98 | 16.0 | 13.7 inputs; **18.6** |
| 12-bit, widest header window | 1093 | 0.93 | 3.7 | 58.5 inputs; **4.36** |
| 12-bit, narrowest header window | 550 | 1.85 | 7.4 | 29.4 inputs; **8.67** |
| 12-bit, narrow | 100 | 10.2 | 41: 6 grey levels | 5.35 inputs; **47.7: 5 grey levels** |

A step is wider than one display level below W = 255 × s: **1191** source units on a 10-bit series and **4768** on a
12-bit one, every header window (D). The rounding RMS is 1.363 and 5.401 source units (§8.1), 0.24–0.41 of σ_min on
the 10-bit volumes and 0.36–0.52 on the 12-bit ones (D, `predictions.json`), against the 256-level cut's 0.20–0.33
and 0.31–0.44 (R, `claude/depth8:docs/av1/depth-cut-8.md` §2), so the volumes' noise still dithers the steps at the
header windows by that file's reading (T).

**The difference from the unchecked route is where the rounding sits.** There the 8-bit rounding follows the decode
and adds to the coding error, so at today's Q the screen exceeds the noise rule's bar (R,
[`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §3.2). Here the 220 levels are the coder's input, its
reconstruction is what the digest covers, and Q is chosen so that every frame's e_N ÷ σ, cut and coding together,
stays under the bar: what reaches the screen is what was measured.

**Pixel values** are the view's samples: code c reports `round((c − 16) × s)` source units, the view's coding error
on top as today; the cut adds ± s ÷ 2 = ± 2.34 (10-bit) and ± 9.35 (12-bit) source units of rounding (D).

## 5. The read-back and the check, a cost model (D unless marked)

Per `dbts_b1` frame, 2560 × 3328 = 8 519 680 samples, WebGL2:

1. `texImage2D(VideoFrame)` into an `RGBA8` texture (Chromium's intermediate is `kN32`, 4 bytes a pixel, S6):
   34 078 720 bytes written on the GPU.
2. A pass that reads four horizontally adjacent texels with `texelFetch` (no filter), maps each red value through
   the 256-entry inverse table, and packs the four samples into one `RGBA8` texel: a 640 × 3328 target, 8 519 680
   bytes.
3. `readPixels` into a `PIXEL_PACK_BUFFER`, a fence, then `getBufferSubData` once the fence has passed, so the page
   does not block in `readPixels`, which "is a blocking operation" (R, [`new-options.md`](new-options.md) §3.3, S3
   there): 8 519 680 bytes across to the page.
4. XXH3-64 over those bytes against the ingest's digest of the 8-bit luma plane: at the client's measured ~3.3 GB/s
   (R, `docs/av1/queue.md` row 151, desktop containers), 8 519 680 ÷ 3.3 × 10⁹ = **2.6 ms**.
5. Paint from the same packed texture (or from the RGBA texture through the table), window table after the inverse.

| per `dbts_b1` frame | today's software view (R) | this route |
| --- | --- | --- |
| decode | 133–135 ms, one decoder, the phone | hardware; unknown (§7) |
| copied out of the decoder | `copyTo`, 2 × 8 519 680 = 17 039 360 B | GPU copy 34 078 720 B, GPU-side |
| read back to the page | — (the copy is the read) | 8 519 680 B |
| hashed | 17 039 360 B, ~5.2 ms at 3.3 GB/s | 8 519 680 B, ~2.6 ms |

**On the GPU instead** (WebGPU): `importExternalTexture`, a compute pass reading with `textureLoad`, XXH3-64 in WGSL
over the recovered samples (R, `claude/hw10-routes:docs/decode/hardware-10bit.md` §5.4 derives it), 8 bytes read back.
WebGPU's external texture on Android carries the same `yCbCrInfo` (§2), so the inversion and its calibration are the
same. The GPU hash's time is unknown; XXH3's stripes are sequential within a block, which that file's design
addresses, not this one.

**Unknown, a phone's:** steps 1–3's time; whether the read-back of 8.5 MB overlaps the next decode; the GPU memory
(the unchecked route's `R8` store of a `dbts_b1` series is 406 MiB, R; this route keeps no picture past its check
and paint, but the decoder lends 1–5 frames, R, [`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §4).

## 6. The calibration unit, and what a failed check does

**The unit** (T, the advocate's design). One AV1 sequence coded at ingest in the view's form and at the series'
frame size, so that it also proves the decoder takes the size (§7): flat 8 × 8 blocks of each luma value 16…235 in a
known order, repeated to fill the frame, coded at the finest Q. Its expected decoded samples are known exactly at
ingest (AV1 decoding is exact, R, [`new-options.md`](new-options.md) §3 step 1), so the table is read off the block
interiors, value by value. It costs one hardware decode and one read-back a session (and a device, browser and
decoder). It yields the inverse table, and the route is used only if the 220 expected samples give 220 distinct
picture values. It is a convenience; every frame is still checked.

**A failed check** (T): the frame is not painted from the hardware picture; it is decoded again in software and
checked there (the client's existing path when a decoder refuses), and a safety report records which check failed
(amendment 9's fields). One failure turns the route off for the session: a device whose map merges two levels fails
every frame that holds them, and a decoder that dithers or enhances fails at random. The order is decode, upload,
invert, hash, then paint, so the check's latency (steps 1–4 of §5) is inside the frame's.

## 7. Does a phone's hardware decoder take the frame? (new-options §2.1)

The frames need AV1 level 5.0 (`dbts_b1`, 8 519 680 samples; `dbts_c1`, 2 452 688) or 4.x (`dbts_a1`), and
Android asks a hardware AV1 decoder for level 4.1 at most (R, [`new-options.md`](new-options.md) §2.1). The vendors'
pages read (S13):

| SoC | the vendor's words on AV1 decode | what it implies for `dbts_b1` (D) |
| --- | --- | --- |
| MediaTek Dimensity 9400 | "8K60, 10-bit Video Decode (HEVC/AVC/VP9/AV1)" | 8K (7680 × 4320 = 33 177 600 samples; the page's "7690 x 4320" is its own) holds 2560 × 3328 upright, 3.9× its samples; a level is not named |
| MediaTek Dimensity 9300 | "Video Playback H.264 HEVC Vp-9 AV1" | AV1 named, no size |
| Samsung Exynos 2200 | "capable of decoding 4K videos at up to 240fps and 8K videos at up to 60fps. In addition, the MFC includes a power efficient AV1 decoder" | the 8K figure is the codec block's, not tied to AV1 |
| Qualcomm Snapdragon 8 Gen 3 | page is script-only; its earlier quote "AV1 video playback" (R, [`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §5) | no size |
| Galaxy S23's SoC | unsettled (R, `hardware.md` §15) | — |

So **no vendor document read names an AV1 level**, and one ties AV1 to a frame size that holds `dbts_b1`. A decoder
whose largest size is 3840 × 2160 fails `dbts_b1` and `dbts_c1` in either orientation (R,
[`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §5). Android's `getSupportedHeightsFor(2560)` answers it on
the device (same file, §9 ask 1); the calibration unit at the frame's size answers it in the page (§6).

## 8. The cloud cells, pre-registered (2026-11-15, before any cell ran)

Two cells, by the quality study's harness (`claude/av1-noise-ratio:lab/av1/metrics` at `0a9d33ca`, the commit
DEPTH8-MEASURE's rows record), the way DEPTH8-MEASURE ran it (`claude/depth8:lab/av1/depth8/measure.py` at
`ddd3ec0e`): libaom 3.15.1 `aomenc` at the study's lossy settings, one thread a process, dav1d 1.5.4 (built, with
`LD_LIBRARY_PATH` naming it), the 19 DBT volumes from `lab/av1/fetch_data.sh` checked by their pins, G 1, every
measure at the source depth. Code and rows under `lab/decode/mobile/hw-inverted/` on this branch; predictions from
`predict.py` there (DEPTH8-THEORY's model, `claude/depth8:lab/av1/depth8/theory.py`, with this form's scale and
rounding), in `predictions.json`, written before any cell ran.

### 8.1 Cell C1: the 220-level form against DEPTH8-MEASURE's 256-level rows

**The form, `inv220-420`.** A D-bit sample v becomes the 8-bit luma code

```
c = 16 + round(v ÷ s),   s = (2^D − 1) ÷ 219        so c runs 16 … 235, 220 levels
```

and code c stands for `round((c − 16) × s)` source units. s = 1023 ÷ 219 = 4.671 at D 10 and 4095 ÷ 219 = 18.699 at
D 12 (D). Coded 8-bit 4:2:0 with both chroma planes 128, `--profile=0 --bit-depth=8 --input-bit-depth=8`, colour
range left at libaom's default (studio swing, `color_range` 0), the form the hardware route takes (§3).

**Arms.** Per volume, the Qs ascending, from `predictions.json`'s independent Q to its removal Q + 1 at both bars,
extended by DEPTH8-MEASURE's amendment A3 (the next Q until the highest tested fails 1.03, the Q below while the
lowest fails 1.00, never under Q 1); a **cut-only** row (the codes uncoded, measured as a cell); and one **A/A** cell
per Stage A volume: `cut8` at its DEPTH8-MEASURE highest Q under 1.00, re-run here, which must reproduce that row's
bytes exactly (one thread is deterministic) or the comparison is VOID for that volume. Order: DEPTH8's Stage A
volumes first (`dbts_a1`, `dbts_b1`, `dbts_c1`, `dbt12_ea1141`, `dbts_b2`, `dbts_c4`), then its Stage C order.
`cut8` and today's form are not re-run: DEPTH8-MEASURE's rows (`stage-a.jsonl`, `stage-c.jsonl` at `ddd3ec0e`) are
the comparison.

**Predictions** (each cell against its prediction, misses included):

* **I1 · the cut alone.** The cut-only row's e_N ÷ σ is r ÷ σ per frame within 3 %, with r the RMS of the form's
  rounding over every source value: **1.363** at D 10 and **5.401** at D 12 (D, `predict.py`; s ÷ √12 gives 1.348 and
  5.398). Against the 256-level cut's 1.118 and 4.61 that is 1.219× and 1.172×.
* **I2 · the highest Q.** The highest Q with every frame's e_N ÷ σ ≤ 1.00 lies in the table's interval (the
  independent and the removal model), and at or under `cut8`'s measured highest Q on every volume.
* **I3 · bytes.** `inv220-420` ÷ `cut8`, each at its highest Q under 1.00, lies in the table's interval widened 10 %
  downward (DEPTH8's bytes-model allowance); volumes without stored-form cells have no interval and are reported
  only. Over all: **0.94–1.38** (so 1.07–2.57 × today's view, by DEPTH8's 1.14–1.86).
* **I4 · the range.** Decoded luma outside 16…235 is counted per cell (samples, frames, the extreme). Theory: the
  coding error overshoots at the range's ends wherever the source reaches its extremes; predicted under 10⁻⁴ of the
  samples and at most 4 codes beyond, at every Q in the plan. A miss here is the ingest's headroom question of §5.
* **I5 · the chroma.** Every decoded chroma sample is 128.

| volume | D | r ÷ σ_min | highest Q ≤ 1.00, `inv220-420` (indep.–removal) | the same, `cut8` (model) | ≤ 1.03 | bytes ÷ `cut8` |
| --- | --: | --: | --- | --- | --- | --- |
| `dbt12_c` | 12 | 0.40 | 2–6 | 4–7 | 3–7 | 0.96–1.38 |
| `dbt12_ea1141` | 12 | 0.49 | 1–5 | 2–6 | 2–6 | 1.01–1.24 |
| `dbts_a1` | 12 | 0.52 | 1–4 | 2–5 | 1–5 | 1.04–1.29 |
| `dbts_a2` | 12 | 0.50 | 1–5 | 2–6 | 1–6 | 1.01–1.25 |
| `dbts_a3` | 12 | 0.42 | 2–6 | 3–7 | 2–7 | — |
| `dbts_a4` | 12 | 0.41 | 2–6 | 3–7 | 3–7 | — |
| `dbts_a5` | 12 | 0.50 | 1–5 | 2–6 | 1–6 | — |
| `dbts_c1` | 12 | 0.45 | 2–5 | 3–6 | 2–6 | 1.01–1.13 |
| `dbts_c2` | 12 | 0.39 | 3–6 | 4–8 | 3–7 | 1.06–1.21 |
| `dbts_c3` | 12 | 0.40 | 3–6 | 4–7 | 3–7 | 0.96–1.06 |
| `dbts_c4` | 12 | 0.36 | 3–7 | 5–8 | 4–8 | 0.94–1.24 |
| `dbts_c5` | 12 | 0.44 | 2–5 | 3–6 | 2–6 | 1.01–1.13 |
| `dbt10_d` | 10 | 0.35 | 3–7 | 5–8 | 4–8 | — |
| `dbt10_ea1141` | 10 | 0.33 | 4–8 | 6–9 | 5–9 | 0.95–1.15 |
| `dbts_b1` | 10 | 0.26 | 7–10 | 9–12 | 8–12 | 1.02–1.10 |
| `dbts_b2` | 10 | 0.41 | 3–6 | 4–7 | 3–7 | 0.98–1.07 |
| `dbts_b3` | 10 | 0.25 | 7–11 | 10–13 | 9–13 | 1.00–1.24 |
| `dbts_b4` | 10 | 0.24 | 7–11 | 10–13 | 9–13 | — |
| `dbts_b5` | 10 | 0.38 | 3–7 | 4–8 | 3–8 | 0.97–1.06 |

**Mutants**, each run once and seen to fail: (n1) s = 2^(D−8) (the 256-level step) in place of (2^D − 1) ÷ 219: I1
fails, r falls to the 256-level cut's; (n2) the back map without the offset 16: I1 fails by orders of magnitude;
(n3) chroma 127: I5 fails; (n4) the range counter reading chroma in place of luma: I4's count reads zero on a frame
built to overshoot.

### 8.2 Cell C2: a second picture (new-options §4; §10 here), theory's one byte cell

On the three timed volumes only (`dbts_a1`, `dbts_b1`, `dbts_c1`), after C1. **Picture A** is `inv220-420` at a
coarse Q_A ∈ {24, 40}; its decoded reconstruction r_A, mapped back to source units as above (`back(r_A)`). **Picture
B**, 8-bit 4:2:0, chroma 128, codes what A missed, one code per source unit:

```
b = clamp(v − back(r_A) + 126, 16, 235)          shown = back(r_A) + r_B − 126
```

B at Qs ascending from 1 until its worst frame's e_N ÷ σ, measured on `shown` against the source, exceeds 1.03.
**Reported:** B's highest Q under 1.00; bytes(A) + bytes(B) at it, ÷ today's form's bytes at its own highest Q under
1.00 (DEPTH8-MEASURE's rows); the share of samples where `b` clamped, per Q_A.

**Predictions** (T): **J1** the ratio lies in 1.2–2.5 at both Q_A (a layered coding costs more than one stream at
the same quality; B codes the noise at the source's resolution, which today's stream also spends its bytes on);
**J2** the clamped share is under 10⁻³ at Q_A 24 and above it at Q_A 40 on the 12-bit volumes (A's error in source
units grows with s = 18.7). A cell that reaches neither bar at Q 1 is reported as such.

**Mutant** (n5): `shown` without the − 126: J's e_N ÷ σ rises past every bar at every Q.

**Saturation.** Every measure but wall time is deterministic at one encoder thread; no time is claimed. Each cell
records its wall time; the report says whether 4 processes saturated the host's 4 cores (`/proc/stat`).

**Fixtures and limits.** 19 DBT volumes of three systems (C2 on three); libaom 3.15.1 at cpu6, one thread; dav1d
1.5.4; one σ estimator in one band; one 4-core cloud host without a GPU; no browser, no hardware decoder, no reader.

### Amendment, before any run (2026-11-15)

Written by the measuring session before any cell ran. What the host and the harness forced:

* **A1 · Where the forms live.** As DEPTH8-MEASURE's A1: `lab/decode/mobile/hw-inverted/measure.py` loads the
  harness from a checkout of `claude/av1-noise-ratio` at `0a9d33ca` and adds `inv220-420` and `cut8` to its `forms`
  (`cut8` rewritten from DEPTH8-MEASURE's `code8`; the A/A cells check it byte for byte). No harness file is copied or
  changed; every row records the harness commit. The series rows (σ per frame) are measured again here and checked
  equal to DEPTH8-MEASURE's; DEPTH8-MEASURE's cells are read with its own σ.
* **A2 · `inv220-420`'s arguments.** The harness's non-monochrome branch tags RGB series' colour (`bt601`); as
  DEPTH8-MEASURE's A4, it is replaced by `--profile=0 --bit-depth=8 --input-bit-depth=8` and nothing else. The back
  map is applied to every decoded code 0 … 255 unclipped, as written, so an overshoot counts in e_N as well as in I4.
* **A3 · C1's starting Qs.** From bar 1.00's independent Q to the larger of the two bars' removal Q, + 1 (as
  DEPTH8-MEASURE's A3 read its own); then §8.1's extension.
* **A4 · C2's Qs.** "Ascending from 1" is about 270 cells of B: by libaom's AC tables (D), B's step in source units
  (one code a unit) reaches today's form's step at its highest Q only near 8-bit Q 44–50 on the 12-bit volumes and
  Q 33–35 on `dbts_b1`, so 50, 50 and 36 cells a chain, six chains, against C1's ~145 cells on the same 4 cores. B
  runs instead at Q 1 and every multiple of 4 ascending until the worst frame exceeds 1.03, then at every Q between
  the highest multiple whose worst frame is ≤ 1.00 and that failing Q. This assumes the worst frame rises with Q
  between the multiples; the report lists every chain's worst frame by Q, so a step down shows.
* **A5 · Picture A.** Coded once per (volume, Q_A) as a C1 cell of `inv220-420` (its row kept in `c2.jsonl`), its
  decoded luma kept outside the repository for B's cells; bytes(A) is that row's. The clamped share is counted while
  B's input is written, the same at every Q of a chain.

## 9. Results (cloud cells, measured)

§8 run as amended, 2026-11-15: C1 on all 19 volumes (Stage A's six first; 129 `inv220-420` cells, 19 cut-only rows,
6 A/A cells), then C2 (6 pictures A, 93 cells of B). Rows `lab/decode/mobile/hw-inverted/rows/c1.jsonl`, `c2.jsonl`,
harness `claude/av1-noise-ratio` at `0a9d33ca` in every row; every cell against its prediction in `rows/report.md`
(`report.py`, rerun from the rows). σ per frame equals DEPTH8-MEASURE's on 19 of 19 volumes. (M)

* **A/A: 6 of 6 equal.** `cut8` re-run reproduces DEPTH8-MEASURE's bytes exactly on every Stage A volume; no volume
  is VOID.
* **I1 · the cut alone: 12 of 19 hit.** All 12 at D 12 read e_N = r within 0.2–1.8 %. All 7 at D 10 **miss**, low:
  e_N is 3.2–9.3 % under r = 1.363 (`dbts_b2` the most, as DEPTH8's P1 there). Against DEPTH8's cut-only rows,
  e_N rises 1.171× at D 12 (predicted 1.172) and 1.174–1.189× at D 10 (predicted 1.219).
* **I2 · the highest Q: 19 of 19 hit.** `inv220-420` reaches Q 2–5 on the 12-bit volumes and Q 4–9 on the 10-bit
  ones at 1.00, each with a failing Q above it, inside the interval and at or under `cut8`'s Q on every volume (one to
  two rungs under).
* **I3 · bytes: 12 of 14 hit.** `inv220-420` ÷ `cut8`, each at its highest Q under 1.00: **0.97–1.47** over all 19
  (0.97–1.19 on the other 17). Misses: `dbt12_ea1141` 1.470 against ≤ 1.240 (`inv220-420` one rung lower, Q 2 against 4) and
  `dbts_b1` 1.105 against ≤ 1.104. The five held-out volumes read 1.01–1.38. Against today's form (DEPTH8's rows):
  **1.16–2.49 ×**.
* **I4 · the range: miss, 5 of 129 cells hit.** Every cell decodes luma outside 16 … 235 on every frame: 4.6·10⁻⁵ –
  8.3·10⁻⁴ of the samples at D 12, 1.6·10⁻⁴ – 2.0·10⁻³ at D 10, against < 10⁻⁴; the extreme is code 8 at D 12 and
  code 0 at D 10 (8 and 16 codes beyond), at most 4 above 235 (239). Only Q 1 on four 12-bit volumes and Q 2 on one
  stay under 10⁻⁴. The undershoot below 16 is the larger: this is §5's headroom question, answered against the form.
* **I5 · the chroma: 129 of 129 hit.** Every decoded chroma sample of every `inv220-420` cell is 128.
* **J1 · two pictures: 4 of 6 hit.** (A + B) ÷ today's form, B at its highest Q under 1.00: `dbts_a1` 1.33 (Q_A 24,
  B Q 44) and 1.62 (Q_A 40, Q 42); `dbts_b1` 1.36 and 1.36 (Q 32 at both); `dbts_c1` 1.04 and 1.03 (Q 46 at both)
  **miss**, under 1.2. A alone is 0.13–2.1 MB (worst e_N ÷ σ 1.07–1.18); B is nearly all the bytes. B's worst
  frame rose with Q on every chain (A4's assumption held).
* **J2 · the clamp: hit on both 12-bit volumes.** Clamped share 1.8·10⁻⁴ and 4.6·10⁻⁴ at Q_A 24, 2.2·10⁻³ and
  3.1·10⁻³ at Q_A 40; `dbts_b1` (D 10) 1.5·10⁻⁶ and 7.2·10⁻⁵, reported only.
* **Not predicted:** B's decoded chroma is not 128 on `dbts_a1` (3.5 M and 12.3 M samples summed over its two
  chains' cells), 128 everywhere on `dbts_c1` and `dbts_b1`; C1's form never moved its chroma.
* **Mutants** (`rows/mutants.txt`): n1–n5 each fail `measure_test.py`. n1 fails I1 on a real cut-only row (e_N 14.9 %
  under r) and n3 fails I5 (114 M chroma samples). n2 and n5 do **not** fail the predictions as worded: a constant
  offset (16 × s = 299, and 126) has no energy in e_N's band, so I1 and J's e_N ÷ σ read as good; they show in the
  rows' mean and RMS error (299, 126). n4 is a unit-level mutant only (the overshooting frame reads zero).
* **Saturation.** Four processes kept the host's 4 cores busy: median busy share 1.00 a minute in both cells
  (`rows/c1.cpu.txt`, `c2.cpu.txt`), lower only at round ends. Cells took 17–424 s wall; no time is claimed.
* **Run note.** 22 C1 cells written between 14:54 and 15:07 were lost when a rebase replaced the row file under
  the open run; they were coded again (one thread is deterministic) and the rows hold each cell once.

Fixtures and limits: 19 DBT volumes of three systems (C2 on three); libaom 3.15.1 at cpu6, one thread, G 1; dav1d
1.5.4; one σ estimator in one band (blind to a constant offset); one 4-core cloud host without a GPU; no browser,
hardware decoder, phone or reader. What it settles: on these volumes the 220-level form meets the noise rule at a rung
or two under the 256-level cut, at 0.97–1.47 × its bytes (1.16–2.49 × today's), with chroma intact and luma
overshooting the studio range on every frame; a second picture over it reaches today's quality at 1.03–1.62 × today's
bytes.

## 10. Past 8 bits: a second picture (new-options §4, theory)

Theory and cell C2 only; it touches the 2026-11-09 decisions ("the residual dropped", "a split into top and low
streams discarded", R, `docs/client/design.md` §Decided) and is the owner's to open. What this file adds to
[`new-options.md`](new-options.md) §4 (D, T):

* Each picture goes through §2–§6 on its own: two hardware decodes, two read-backs and two hashes a shown frame, so
  §5's per-frame costs double, and the decoder's level bound halves (32 frames a second at level 5.1, R, same file).
* B's form is the same studio-swing 16…235 picture, so the same calibration table serves both.
* The sum `back(r_A) + r_B − 126` is formed after both checks pass; either failing sends the frame to software.
* Bytes (M, §9 J1, three volumes): A + B reach today's quality at **1.03–1.62×** today's bytes, B nearly all of it;
  A's error clamps B on 1.8·10⁻⁴–3.1·10⁻³ of the samples on the 12-bit volumes.

## 11. Its disadvantages

* **7.78 bits on screen**, 16 % coarser than an 8-bit picture: 2.33–8.67 display levels a step at the header windows
  (§4), and pixel values ± 2.34 or ± 9.35 source units of rounding.
* **Bytes**: 1.16–2.49× today's view at the noise rule's bar (M, §9), before the headroom of §4.
* **The range overshoots** (M, §9 I4): as coded, every frame leaves 16…235, so the form must shrink further.
* **Nothing promises the inversion** (§3): the digest proves each frame, but whether a device passes at all is known
  only by running it there; the GL external path and Firefox's `mediump` are the likeliest to merge levels.
* **A device that fails costs a decode twice** for its first frame, then runs in software as today.
* **The check moves onto the GPU and into a read-back**: 34 MB of GPU copy and 8.5 MB across to the page a frame,
  unmeasured on a phone (§5).
* **It needs the decoder to take the frame**, which no vendor document read promises by level (§7).
* **It is needed only where samples do not come back**: Android Chromium and Firefox. On desktop Chromium the same
  stream's `NV12` planes come back from `copyTo` (§2), so the inversion adds nothing there.
* **The cache** keeps checked samples again (the recovered 8-bit plane, 1 byte a sample), unlike the unchecked
  route; it is a new entry kind beside today's 16-bit samples (T).

## 12. The comparison's columns, and what a phone cell must measure

| column | this option |
| --- | --- |
| decode time on a phone | **unknown**; hardware, at most 31.1 ms a `dbts_b1` frame by level 5.0's floor if the decoder takes it (R, [`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §5), plus §5's upload, pass, read-back and ~2.6 ms of hash (R rate, desktop) |
| bytes | **1.16–2.49× today's** view (0.97–1.47× the 256-level cut's), measured on 19 volumes (§9); more with the headroom §4 now asks |
| precision on screen | **7.78 bits** (220 levels): 4.67 source units a step on 10-bit series, 18.70 on 12-bit |
| checked | **yes**, every frame, the digest of the decoded 8-bit luma plane (§5, §6) |
| window/level and tools functional | **yes**: a table over 220 inputs; values reported as the view's samples (§4) |
| ships today | the APIs ship (WebCodecs, WebGL2, WebGPU on Chrome Android; Firefox's WebGL); the map's being one-to-one, and the decoder's taking the frame, are **device facts** |

**Asks for the next phone round** (one line each, for MOBILE-DECODE-COMPARE to carry into
`claude/phone-protocol:docs/phone-rows/next-round.md`; [`new-options.md`](new-options.md) §7's asks 1–3 stand):

1. The calibration unit (§6) at `dbts_b1`'s size through `prefer-hardware` into WebGL2 and WebGPU: the 220 picture
   values, distinct or not; with `VideoDecoderConfig.colorSpace` absent, studio and full; `chrome://gpu`'s Vulkan or
   GL backend recorded.
2. One `dbts_b1` unit in the §4 form: every frame recovered, hashed, against its digest; the share that pass.
3. §5's steps 1–4 timed apart per frame, interleaved against `prefer-software`'s `copyTo` and hash on the same unit.
4. The same in Firefox for Android, if its WebCodecs offers hardware AV1 (its `isConfigSupported` answer recorded).

## 13. Sources

Read 2026-11-15. Each 12-hex prefix is the SHA-256 of the copy read.

* **S6** Chromium, `chromium.googlesource.com/chromium/src/+/refs/tags/157.0.8103.79/` and `…/158.0.8127.36/` (today's
  Android stable by `chromiumdash.appspot.com`): `third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc`
  (157 `b89b445caeea`) `GetCurrentUnpackState`, `CopyVideoFrameTexturesToGLTextureViaIntermediateSI`,
  `TexImageHelperMediaVideoFrame`; `media/gfx/paint_canvas_video_renderer.cc` (`3b64cf03f246`)
  `CopyVideoFrameToSharedImage`; `gpu/command_buffer/service/copy_shared_image_helper.cc` (`48d50fdca19b`)
  `CopySharedImage`; `gpu/command_buffer/service/shared_image/video_image_reader_image_backing.cc` (`db979e9d62c6`);
  `gpu/vulkan/vulkan_image_android.cc` (`09124ef1cd3d`) lines 185–192; `media/base/video_frame.cc` (`663e682271f4`)
  `CompatRGBColorSpace`; `ui/gfx/color_space.cc` (`13b9ccf09f04`) `ToSkYUVColorSpace`;
  `media/gpu/android/media_codec_video_decoder.cc` (`55fb0c80da25`) lines 706–713;
  `media/base/media_switches.cc` (`08f2faab9844`) line 1306;
  `third_party/blink/renderer/modules/webcodecs/video_decoder.cc` (`ac73aca73b90`) lines 542–546. The functions
  quoted from the first three files and `CompatRGBColorSpace` are identical at 158 (diffed).
* **S7** WebKit, `github.com/WebKit/WebKit` at `19c5103d1133bb2e0749728e49a506993dde3498`:
  `Source/WebCore/platform/graphics/cocoa/GraphicsContextGLCocoa.mm` (`e5fd4587c0c2`) `yuvSampleRangeHint`,
  `yuvColorSpaceHint`, `copyFromYUVVideoFrameSource`, `copyTextureFromVideoFrame`;
  `Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp` (`5e0ee6525794`) `isVideoFrameFormatEligibleToCopy`,
  `texImageSource(…, WebCodecsVideoFrame&)`.
* **S8** Firefox, `github.com/mozilla-firefox/firefox` branch `release` at `dc1259aee26fc94e00047ad4da433ceac1583eb4`:
  `dom/canvas/WebGLTextureUpload.cpp` (`161666e2e2a0`) `FromVideoFrame`, `FromDomElem`; `gfx/gl/GLBlitHelper.cpp`
  (`7c2cbe71fc90`) lines 203, 638–639, 1444–1447, 1681–1684; `gfx/thebes/gfxUtils.cpp` (`75baa2ed4ac8`) lines
  1218–1305.
* **S9** Vulkan specification source, `github.com/KhronosGroup/Vulkan-Docs` at
  `f7de774cace1509af0f10b8d859c973b5354ff62`: `chapters/textures.adoc` (`b26545e6d398`) §Sampler YCbCr Range
  Expansion and §Model Conversion; `chapters/fundamentals.adoc` (`0e505b495d75`) §Conversion From Floating-Point to
  Normalized Fixed-Point; `chapters/memory.adoc` `VkAndroidHardwareBufferFormatPropertiesANDROID`.
* **S10** OES_EGL_image_external, `github.com/KhronosGroup/OpenGL-Registry` at
  `6af574a14089ccfee87efe230ebcdd8742859813`, `extensions/OES/OES_EGL_image_external.txt` (`c567737b7bba`), lines
  244–260.
* **S11** Android, `developer.android.com/reference/android/media/MediaFormat` (`b2880c26972a`), "Last updated
  2026-08-03 UTC": `KEY_COLOR_RANGE`.
* **S12** HTML Living Standard, "Last Updated 14 November 2026",
  `html.spec.whatwg.org/multipage/imagebitmap-and-animations.html` (`d919b41466ca`): `ImageBitmapOptions`, the
  `createImageBitmap` steps.
* **S13** MediaTek, `mediatek.com/products/smartphones/mediatek-dimensity-9400` (`75795052eddf`) and
  `…/smartphones-2/mediatek-dimensity-9300` (`be7228ccbc10`); Samsung Semiconductor,
  `semiconductor.samsung.com/processor/mobile-processor/exynos-2200/` (`34b4cbb96696`); Qualcomm's Snapdragon 8
  Gen 3 page fetched script-only (no text). Vendor pages change without notice; the quotes are the check.

Results of this repository cited (R): [`new-options.md`](new-options.md) §2.1, §3, §4, §7;
[`av1-hardware-unchecked.md`](av1-hardware-unchecked.md) §2–§5, §9; [`other-codecs.md`](other-codecs.md);
`claude/depth8:docs/av1/depth-cut-8.md` §2, §7, §9 (`ddd3ec0e`); `claude/hw-decode:docs/decode/hardware.md` §15;
`claude/hw10-routes:docs/decode/hardware-10bit.md` §5.4; `docs/av1/queue.md` row 151; `docs/client/design.md`
§Decided.
