# Residual exact: does the server's residual rebuild the exact frame on every client decoder?

*Row RESIDEXACT, 2026-11-07.* The exact frame on request is the **VL view** (the visually lossless AV1 stream a
user scrolls) plus a **residual**: exact − decoded view + one offset, coded HTJ2K lossless. The server computes the
residual from **its own** decode of the view, native dav1d. The client adds it to **its** decode of the same units.
The sum is exact only if every client decoder returns the server's decode sample for sample. This file asks whether
it does, from the standards (§1) and by measurement (§2).

Terms: **G** = frames per keyframe; **Q** = libaom quantizer (`--cq-level`, 0–63); *derived* = our arithmetic or
reading, *unverified* = no source or run confirms it.

## Verdict

*Pending: §1 (the sources) is written; §2 (the harness) is running. This block is rewritten when it lands.*

## 1 · What the sources say

**Method card (sources).** Read 2026-11-07, nothing run. AV1 Bitstream & Decoding Process Specification, HTML at
<https://aomediacodec.github.io/av1-spec/> (source repo `AOMediaCodec/av1-spec` HEAD `5e04f3f`, the commit row SWEEP
read). W3C WebCodecs Editor's Draft of 2 November 2026, <https://w3c.github.io/webcodecs/>; AV1 WebCodecs
Registration, Editor's Draft of 13 October 2026, <https://w3c.github.io/webcodecs/av1_codec_registration.html>.
dav1d at tag `1.5.4` (the product's pin, `client/decode/wasm/build/pins.sh`). Chromium at tag `153.0.8010.12`, the
Chrome for Testing build the harness runs, read through the GitHub mirror `chromium/chromium`. Quotes are verbatim;
the HTML was flattened to text, so section numbers are the spec's own and list layout is lost.

### 1a. AV1 decoding is normatively bit-exact, unless film grain is on

The AV1 specification, §7.2 *General decoding process*
(<https://aomediacodec.github.io/av1-spec/#general-decoding-process>):

> When film_grain_params_present is equal to 0, decoders shall produce output frames that are identical in all
> respects and have the same output order as those produced by the decoding process specified herein.

The output it means is defined in §7.18.1 *Output process*:

> Finally, the frame to be output is defined to be the arrays OutY, OutU, OutV where the bit depth for each sample
> is BitDepth. This frame to be output is the overall output of the decoding process and further processing (such
> as color conversion) is outside the scope of this specification.

So for a stream with `film_grain_params_present` 0, a conformant decoder's output arrays are fixed bit for bit by
the stream — at the coded BitDepth, before any conversion (*derived*: the two quotes together). Decoding has no
implementer choice once the stream is fixed; the spec's integer process is the output. What the spec does not
reach is anything after OutY: a browser's pixel format, a copy, a colour conversion.

### 1b. Conformance streams

AOMedia's AV1 decoder verification tool (Argon Streams AV1), <https://aomedia.org/av1-video-decoder-verification-tool/>:

> MD5 digests of the output YUV files are provided to verify that the output is correct.

The download offered there is `argon_coveragetool_av1_base_and_extended_profiles_v2.1.1.zip` (7 GB), with the
generator at <https://gitlab.com/AOMediaCodec/argon-streams>. A digest of the whole output file is a bit-exact
check by construction (*derived*). dav1d's `README.md` at 1.5.4
(<https://github.com/videolan/dav1d/blob/1.5.4/README.md>), §*Decoder conformance tests (optional but encouraged)*:

> 1. Download the argon conformance bitstreams from https://streams.videolan.org/argon/
> 3. Execute tests with `tests/dav1d_argon.bash -d build/tools/dav1d -a argon`

So conformance is defined by output digests, and dav1d ships the runner. **Whether dav1d 1.5.4, its WASM build or
any hardware decoder passes every Argon stream is *unverified* here**: no source read states a pass for a given
build, and this run did not fetch the 7 GB set. A pass would also cover only the tools Argon exercises; the
question for the product is narrower — these encoder settings, these depths, these decoders — and §2 measures it.

### 1c. Film grain is outside the bit-exact output

§7.2 again, the case `film_grain_params_present` = 1:

> When film_grain_params_present is equal to 1, a conformant decoder shall satisfy at least one of the following
> two options: A conformant decoder shall produce output frames that are identical in all respects and have the
> same output order as those produced by the decoding process specified herein including applying the exact film
> grain synthesis process as specified in section 7.18.3 . A conformant decoder shall produce intermediate frames
> that are identical in all respects and have the same order as the frames produced by the process specified in
> section 7.18.2 . In addition to that, a conformant decoder shall produce output frames that are in the same order
> and do not have perceptually significant differences with the frames produced by the reference film grain
> synthesis process specified in section 7.18.3 when applied to the input frames of the film grain synthesis
> process with the film grain parameters signaled for these frames.

and:

> The definition of “perceptually significant differences” is beyond the scope of this specification

So **with film grain on, a conformant decoder may return different samples**, and a residual against one decoder's
output would not rebuild the exact frame on another (*derived*). Film grain is also on by default in every decoder
the product uses: dav1d 1.5.4 `include/dav1d/dav1d.h`,

> int apply_grain; ///< whether to apply film grain on output frames (default 1)

and Chromium 153's `media/filters/dav1d_video_decoder.cc` never sets `apply_grain` (no occurrence in the file;
*derived*: dav1d's default holds there). The product's `dav1d_wrap.c` does not set it either. **The residual
therefore requires `film_grain_params_present` = 0 in every VL view's sequence header** — a property of the
encode, not of the client. The VL views here are coded with `--denoise-noise-level=0` (`aomenc_args`), which writes
no grain; §2 reads the flag from every sequence header and refuses a stream that sets it.

### 1d. WebCodecs: the output formats, and what `copyTo` does

The `VideoPixelFormat` enum (WebCodecs §9.8, <https://w3c.github.io/webcodecs/#enumdef-videopixelformat>) has 4:2:0
at three depths and no single-plane format:

> enum VideoPixelFormat { // 4:2:0 Y, U, V "I420" , "I420P10" , "I420P12" , …

> I420P10 … Each sample in this format is 10 bits, encoded as a 16-bit integer in little-endian byte order.

> I420P12 … Each sample in this format is 12 bits, encoded as a 16-bit integer in little-endian byte order.

A decoded frame keeps the decoder's format (§9.4.6 *Create a VideoFrame*):

> If output uses a recognized VideoPixelFormat , assign that format to [[format]] . Otherwise, assign null to
> [[format]] .

`copyTo()` without a `format` copies bytes; with one, only RGB is allowed (§9.4.5 and *Parse VideoFrameCopyToOptions*):

> Copy rowBytes bytes from resource starting at sourceOffset to destination starting at destinationOffset .

> If options . format does not exist , assign [[format]] to format . Otherwise, if options . format is equal to one
> of RGBA , RGBX , BGRA , BGRX , then assign options . format to format , otherwise return NotSupportedError .

So in the specification **`copyTo()` with no `format` is a byte copy of the decoder's planes** — no depth change, no
range change; asking for RGB converts, and nothing else may be asked (*derived*). The harness copies with no
`format`.

What Chromium 153 hands that copy, from `media/filters/dav1d_video_decoder.cc`
(<https://github.com/chromium/chromium/blob/153.0.8010.12/media/filters/dav1d_video_decoder.cc>):

> // Single plane monochrome images will be converted to standard 3 plane ones
> // since Chromium doesn't support single Y plane images.
> case DAV1D_PIXEL_LAYOUT_I400:
> case DAV1D_PIXEL_LAYOUT_I420:
> switch (pic->bpc) { case 8: return PIXEL_FORMAT_I420; case 10: return PIXEL_FORMAT_YUV420P10; case 12: return PIXEL_FORMAT_YUV420P12;

> const uint16_t kBlankUV = (1 << pic->p.bpc) / 2;

and the luma plane is wrapped, not copied (`VideoFrame::WrapExternalYuvData(… pic->stride[0] … y_plane …)`). So a
4:0:0 view arrives as `I420`/`I420P10`/`I420P12` with mid-grey chroma and dav1d's own luma (*derived*). **12 bits
never reach it through WebCodecs**: `third_party/blink/renderer/modules/webcodecs/video_decoder.cc` checks every key
chunk with libgav1's parser —

> *is_key_frame = status_code == libgav1::kStatusOk && parser.frame_header().frame_type == libgav1::kFrameKey;

— and `third_party/libgav1/BUILD.gn` builds that parser with

> "LIBGAV1_MAX_BITDEPTH=10",

so a 12-bit key chunk fails the check and `decode()` is refused (*derived* from the source; WCAP measured the refusal
on Chromium 141, and §2 re-measures it on 153). A 12-bit view goes to dav1d-WASM; the **top 10 bits** form exists
so that WebCodecs can take it.

### 1e. What follows, before measuring

*Derived.* With grain off, every **conformant** decoder returns the same samples, so the residual is exact on every
client by the specification — provided the path from the decoder to the client's array copies and does not convert.
In the browsers read here that holds by spec (§1d) and by Chromium's source. Three things the standard does not
settle: (i) whether a given decoder build is conformant on these streams — the measurement; (ii) what a hardware
decoder or another browser's pipeline does between its output and `copyTo` (NV12 or P010 surfaces, a GPU readback)
— *unverified*, §3; (iii) Chromium's software path **is dav1d**, so a match there is the same code compiled twice,
not an independent check — §2 adds libaom's `aomdec`, the reference decoder, for that.

## 2 · The harness

*Pending.*

## 3 · Owed: hardware and other browsers

*Pending.*
