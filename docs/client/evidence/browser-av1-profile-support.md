# Which AV1 profiles, depths and chroma does each browser's WebCodecs decode, exactly?

**Question:** the optimal-quality picture is AV1 Main 4:0:0 at 10 bits or less (the depth cut for D > 10). Which
engines' `VideoDecoder` take it, through which decoder, and do they hand back the samples, not a picture of them?

*Folded 2026-11-14. Sources: research from engine sources read 2026-11-07, not a run
(`claude/av1-webcodecs-profiles:docs/av1/webcodecs-profiles.md` §Verdict, §The table, §Chromium C2–C5, §WebKit
W1–W5, §Firefox G1–G4, §What is owed, `87640e5d`); a hands-on probe in headless Chromium 141
(`claude/video-containers-research-ed5fg2:docs/video-containers/guide.md` §8, `379ffc09`). What the lab measured of
Chromium, WebKitGTK and Firefox is [`../../decode/README.md`](../../decode/README.md) §WebCodecs, what it decodes
exactly, §AV1 in WebKit and Firefox and §Why, and what would make it exact; hardware decode is
[`../../decode/hardware.md`](../../decode/hardware.md). The routes a page has to decode by at all (`VideoDecoder`,
`ImageDecoder`, `<video>`, WebAssembly), what each engine ships and that survey's 2026-11-10 corrections are
[`browser-decode-routes.md`](browser-decode-routes.md). None is repeated here.*

## Verdict, from sources (theory)

No engine is shown to hand a page 12-bit AV1 samples through WebCodecs, and only Chromium hands back exact 10-bit
grey:

* **Chromium.** Its software decoder is dav1d on every Blink platform, Android included, built for 8 and 16 bits a
  sample (`third_party/dav1d/BUILD.gn`). The 12-bit refusal is Blink's key-frame check: `ParseAv1KeyFrame` runs
  libgav1's OBU parser, built with `LIBGAV1_MAX_BITDEPTH=10`, which returns `kStatusUnimplemented` above 10 bits, so
  the chunk is called not key (*A key frame is required*). Grey 4:0:0 comes back as `I420` with mid-grey chroma
  (`kBlankUV = (1 << bit_depth) / 2`). Chromium main at `db89eb15`, 2026-11-07.
* **WebKit (Safari).** `isSupportedDecoderCodec` takes `av01.0` only (Main), so `av01.1` (4:4:4) and `av01.2` (12-bit)
  are refused by `isConfigSupported` and `configure()`. WebCodecs AV1 is on only where `VTIsHardwareDecodeSupported('av01')`
  (Safari 17.5's notes); the software path (preview flag only) accepts 8-bit 4:2:0 alone. **One third-party report**
  (bug 329735, Safari 27.0 on an M3) decodes a 10-bit Main keyframe with `frame.format=null`, whose planes cannot be
  copied, only converted to 8-bit RGB. One report, one stream: *unverified* beyond it. So exact 10-bit read-back on
  Safari is not shown. WebKit main at `dab1a6d7`.
* **Firefox.** No WebCodecs on Android (`CanDecode` returns false; bug 1934008, "Ship Web Codecs on Android", NEW).
  On desktop every remote-decoded frame is reported as 8-bit `BGRX` (`GPUVideoTextureClient.cpp`, a placeholder
  format; bug 1969762, ASSIGNED), and monochrome is refused (FFmpeg path) or dropped (dav1d path). Until 1969762
  lands no WebCodecs frame over 8 bits is exact there. `FIREFOX_157_0_RELEASE`, checked against main.
* **`isConfigSupported` never checks the depth:** Chromium answers from the codec and colour space
  (`IsDecoderAV1Supported`), WebKit from the profile digit, Firefox through the media element's path. So a client
  learns what decodes exactly by decoding a known frame, not by asking; the product does.
* **Hardware, from source:** Chromium's GPU front end refuses 4:0:0 (`k400`) on every platform; VideoToolbox in
  Chromium and Firefox takes Main only; Chrome for Android's MediaCodec maps only Main 8 and 10.

So the optimal-quality picture at 10 bits is exact through WebCodecs on Chromium (desktop, and Android through dav1d,
*derived*); elsewhere it falls to dav1d-WASM, as the client already does on a refusal.

## The browser's own probe (measured, headless Chromium 141, software decode)

* The same 10-bit AV1 frames handed to `VideoDecoder` from a frame table matched the source on 160 of 160 frames as
  `I420P10`, in MP4, Matroska and WebM alike: once the offsets are known, the container is gone.
* The same file in a `<video>` element, read back through a canvas, arrives as 8-bit RGBA: the source's 483 distinct
  10-bit levels as **187** 8-bit levels, stretched from the stream's limited range 121–843 to 16–226. A video element
  returns a picture of the samples, not the samples.
* `isConfigSupported` and `MediaSource.isTypeSupported` answered yes to every AV1 string tried, 12-bit profile 2
  included.

## Owed (none run)

Chrome for Android, Safari on an AV1-hardware Mac or iPhone, and Edge on Windows (Edge is assumed to share
Chromium's code, *unverified*; no Microsoft document found). Chromium's decoder order on Android for clear content
(MediaCodec or dav1d first): *unverified*. Apple's per-device AV1 list: not found. Whether a hardware decode error
falls back to dav1d inside WebCodecs: not found.

## Scope

Sources read 2026-11-07 at the commits named; one probe on one headless Chromium. Engine code moves: Gecko bug
2071132 (`VideoFrame.format` for 10-bit planar frames) was fixed 2026-10-18 with its first release *unverified*, and
the version-dated statements in `docs/decode/README.md` (Safari software-only, Firefox always `BGRX`) need
re-reading against current releases.
