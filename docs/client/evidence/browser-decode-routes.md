# The routes a page has to decode, and what each engine ships

**The question:** which routes does a browser page have to decode images and video (`VideoDecoder`, `ImageDecoder`,
`<img>`/canvas, `<video>`/MSE, a decoder compiled to WebAssembly), what does each hand back, which gives exact medical
samples at 10 and 12 bits, and in which engine? It is the ground under the client's route choice (WebCodecs for the
optimal-quality view at ≤ 10 bits after a per-layout probe, dav1d-WASM otherwise, OpenJPH-WASM for HTJ2K).

*Folded 2026-11-14 from `claude/browser-decoding:docs/decode/browser.md` (`2a860249`; research only, official
sources read 2026-11-10; 482 sources, nothing built or measured) §One screen and §What it means for this repository,
and `claude/browser-decoding:docs/av1/webcodecs-profiles.md` §Verdict (read 2026-11-07, corrected in place after an
independent check on 2026-11-10). The full reference, with every quote, is that file (2 029 lines); it is not on this
branch. Labels as the source's: (S) sourced, a verbatim quote; (D) derived; (U) not found in an official source.
Which AV1 profiles, depths and chroma each engine's WebCodecs takes is
[`browser-av1-profile-support.md`](browser-av1-profile-support.md); this file holds the routes and the engines around it.*

## The routes (S/D)

| route | the page gets | exact samples? |
| --- | --- | --- |
| `VideoDecoder` → `copyTo()`, no `format` | the decoder's planes; 8-bit, or 10/12-bit in 16-bit containers; YUV only above 8 bits | yes, a byte copy, when the decoder hands back CPU planes |
| `VideoDecoder` → `copyTo({format})` | one 8-bit RGB plane, conversion unspecified | no above 8 bits |
| `VideoFrame` → canvas, WebGL, WebGPU | pixels after colour conversion and scaling | no |
| `ImageDecoder` → `VideoFrame` | as `VideoDecoder`, format the UA's; 8-bit RGB except Chromium's 10/12-bit colour AVIF | only there |
| `<img>` / `createImageBitmap` → canvas | `rgba-unorm8`, or `rgba-float16` (Chromium only) | not above 8 bits |
| `<video>` / MSE → `new VideoFrame(video)` | the frame at the playback position; frames may be dropped; none by index | no |
| a WebAssembly decoder | the decoder's own output, any depth | yes, by construction |

## Engine by engine (S/D; versions from browser-compat-data or release notes)

| question | Chromium (incl. Android, WebView) | WebKit (Safari; every iOS browser outside the EU and Japan) | Gecko (Firefox) |
| --- | --- | --- | --- |
| `VideoDecoder` ships | 94 | 16.4, macOS and iOS | desktop 130; **Android: not shipped** |
| AV1 through WebCodecs | dav1d in software everywhere; hardware where offered | **only where AV1 hardware exists**, by default; `av01.0` only | dav1d (FFmpeg's wrapper) in software; platform hardware |
| exact 10-bit samples | yes from software decoders (`I420P10`); `null` from hardware P010; RGB on Android hardware | **no**: every 10-bit frame has `format` `null` | `I420P10` when the frame comes back as CPU planes (from 160), `BGRX` as a texture |
| 12-bit | **AV1 refused** at the key-frame check (libgav1 built to 10 bits), though dav1d outputs `I420P12` | no path | `I420P12` on the CPU-plane path, from 160 |
| 4:0:0 AV1 | `I420` with mid-grey chroma synthesised | software dav1d refuses anything but 8-bit 4:2:0 | dropped (no grey case in Gecko's mapping) |
| JPEG XL in `<img>` | 155 | 17 | 158 |

**So (D):** WebCodecs is exact only where the engine's software decoder hands back CPU planes: Chromium at ≤ 10 bits
for AV1 through `VideoDecoder`, and Gecko on its CPU-plane path from 160. Safari gives no exact samples above 8 bits
through any browser API. A WebAssembly decoder is exact in every engine. **No engine is shown to hand a page 12-bit AV1
samples through `VideoDecoder`** (Chromium refuses at the key-frame check; Safari has no 12-bit path; Gecko refuses
4:0:0, and its CPU-plane `I420P12` from 160 is not run). This replaces the stronger "no engine's WebCodecs returns
12-bit samples" (`webcodecs-profiles.md` §Verdict, corrected 2026-11-10). No route gives 16-bit samples, and no
engine decodes JPEG 2000 or HTJ2K.

## Where the repository's record disagreed with the sources (2026-11-10)

The repository's records were measured on Chromium 141, Firefox 157 and WebKitGTK 2.52.6, headless, no GPU, at their
own dates; the sources are of 2026-11-10, Chromium and Firefox at `main`. So a disagreement can be a version change.

| # | the repository said | the sources say | which it looks like (D) |
| --- | --- | --- | --- |
| 1 | Safari's WebCodecs AV1 is libwebrtc's dav1d in software, behind a flag, 8-bit 4:2:0 only (`docs/decode/README.md`, `docs/decode/hardware.md` §4.3) | Safari 17.5: "Added support for WebCodecs AV1 when an AV1 hardware decoder is available"; WebKit routes `av01.` to the GPU process when AV1 hardware exists | **a path the repository missed**: on AV1 hardware it is on by default through VideoToolbox; its 10-bit output has `format` `null`, so "no exact 10-bit AV1 in Safari" still holds; 8-bit `NV12` exactness there unknown (U) |
| 2 | Firefox hands every frame back as 8-bit `BGRX` (`docs/decode/README.md`, `hardware.md` §4.2) | Gecko `main` maps 10/12-bit to `I420P10`/`I420P12` on the CPU-plane path; bug 2071132 fixed in 160; bug 1969762 (texture path `BGRX`) still open | **partly a version change**: the texture path still gives `BGRX`, as measured on 157; which path a decode takes per OS and GPU is not established (U) |
| 3 | Chromium's 10/12-bit formats are behind `WebCodecsHBDFormatsEnabled` (`hardware.md` §4.1) | `IsFormatEnabled` returns true for them with no flag at `main` | **a version change** (141 then, `main` now) |
| 4 | JPEG XL off by default in Chromium 154 and Firefox 157.0.1 (`docs/decode/README.md` §JPEG XL) | on by default in Chrome 155 and Firefox 158 | **a version change**; the 8-bit-samples conclusion agrees |

**Where they agree:** Chromium refuses 12-bit AV1 at the key-frame check; returns 4:0:0 as `I420` with mid-grey
chroma; `isConfigSupported` does not promise bit depth, chroma, or that decoding works; WebCodecs has no `P010` or grey
format; Android hardware frames come back as RGB in Chromium; Firefox has no WebCodecs on Android.

## Consequences for the client (D)

* The client's choice (WebCodecs at ≤ 10 bits where a per-layout probe decodes a known frame exactly, dav1d-WASM
  otherwise) is what the specification supports: nothing short of decoding a frame tells the page the output format.
* `prefer-software` (asked by `client/decode/av1-webcodecs.js:80`) is the one setting that keeps Chromium's hardware
  path and its `null`-format 10-bit frames out; Gecko treats it the same way; WebKit honours it only for VP9 on macOS.
* Safari on an AV1-hardware device now reaches WebCodecs AV1; the probe should fail its 10-bit layouts (`format`
  `null`) and send them to dav1d-WASM. Its 8-bit grey-as-4:2:0 form through VideoToolbox is untested.
* Firefox: the probe would pass a 10-bit layout wherever the CPU-plane path is taken. **Owed before anything is
  inferred:** the engine read-back check on Firefox 160, on a Safari AV1-hardware device, and on Chrome for Android.

## The sources' own check

An adversarial pass by an agent that wrote none of it re-fetched 94 of the 482 sources: 94 of 94 quotes verbatim, 85
support their claims, 7 in part (each extended or narrowed), 2 did not (F93, F94, corrected). The X sources were added
after that pass and read by the integrator only; 388 sources were not re-fetched. A second independent check on
2026-11-10 found eight points, each corrected in place.

**Verdict, scope:** sources, not a run; versions as of 2026-11-10; desktop engines measured in containers, no phone,
no GPU. The client's route choice stands on them; what changes is which engines are expected to take the WebCodecs
route, which a probe on each owed device decides.
