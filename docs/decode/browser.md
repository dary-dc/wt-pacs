# Decoding media in the browser

A reference, built only on official sources, of every route a page has to decode images and video, what each hands
back, and what each engine ships. Research only, read 2026-11-10: nothing here was built or measured. Each claim is
labelled **(S)** sourced (a verbatim quote, in §Sources), **(D)** derived (the reasoning beside it) or **(U)** not
found in an official source (what was searched beside it). Versions come from browser-compat-data or release notes.

## One screen: the routes, what each hands back, each engine

### The routes

```
                     ┌─► <img>, CSS ───────────────┐
                     ├─► createImageBitmap ────────┼─► an image the UA decoded ─► 2D canvas, WebGL, WebGPU
 coded bytes ────────┤                             │        (RGB after the UA's colour conversion; getImageData: 8-bit or float16)
 (fetched,           ├─► <video> (src or MSE) ─────┴─► the screen; one frame on demand:
  WebTransport, …)   │        rVFC + new VideoFrame(video)  ──┐
                     ├─► ImageDecoder (WebCodecs) ────────────┼─► VideoFrame ─┬─► copyTo() with no format: the planes as the
                     ├─► VideoDecoder (WebCodecs) ────────────┘               │     decoder emitted them (the one exact read)
                     │                                                        ├─► copyTo({format:'RGBA'…}): 8-bit RGB, converted
                     │                                                        └─► drawImage, texImage2D, importExternalTexture,
                     │                                                              copyExternalImageToTexture: RGB, converted
                     └─► a decoder compiled to WebAssembly (dav1d, OpenJPH, …) ─► the page's own buffers, any depth
```

(D, from §VideoFrame, §From a VideoFrame to the screen, §The `<video>` and MSE route and §Decoding in WebAssembly.)

| route | the page gets | can read the samples? | bit depth, sample format | exact samples? | label | where |
|---|---|---|---|---|---|---|
| `VideoDecoder` → `copyTo()`, no `format` | the decoder's planes, in the frame's `VideoPixelFormat` | yes, if `format` is not `null` | 8-bit, or 10/12-bit in 16-bit little-endian containers; YUV only above 8 bits | yes, byte copy, when the decoder hands back CPU planes | S / D | [F3] [F5] [F14] [F15] |
| `VideoDecoder` → `copyTo({format})` | one RGB plane | yes | 8-bit `RGBA`/`RGBX`/`BGRA`/`BGRX`, conversion unspecified | no above 8 bits | S / D | [F35] [F39] |
| `VideoFrame` → canvas, WebGL, WebGPU | pixels on a canvas or texture | through `getImageData`, texture read-back | 8-bit or float16 canvas; float textures; never > 8-bit integer from a frame | no: colour conversion, scaling | S / D | [F62] [F73] [F74] [F78] [F80] [F87] |
| `ImageDecoder` → `VideoFrame` | as `VideoDecoder`, format chosen by the UA | as above | 8-bit RGB except Chromium's 10/12-bit colour AVIF (`I4xxP10`/`P12`) | only there | S / D | [I14] [I42] §ImageDecoder |
| `<img>` / `createImageBitmap` → canvas | the canvas bitmap | `getImageData` | `rgba-unorm8`, or `rgba-float16` (Chromium only) | not above 8 bits | S | [I36] [I37] [I41] |
| `<video>` / MSE → `new VideoFrame(video)` | the frame at the current playback position | as `VideoFrame` | whatever the media pipeline holds | no: frames may be dropped or skipped; no frame by index | S / D | [F59] [F121] [F133] |
| WebAssembly decoder | the decoder's output, in WASM memory | yes | anything the decoder supports | yes, by construction (it is the decoder's own output) | D | §Decoding in WebAssembly |

### Engine by engine

Versions come from browser-compat-data at commit `918d2d72…` or the release notes cited; source at the pinned commits
named in each engine's section. "Exact 10-bit" means `copyTo()` with no `format` returns `I4xxP10` planes.

| question | Chromium (Chrome, Edge, Opera, Samsung Internet; Android; WebView) | WebKit (Safari macOS, iOS, iPadOS; every iOS browser outside the EU and Japan) | Gecko (Firefox) | src |
|---|---|---|---|---|
| `VideoDecoder` ships | 94, all Chromium browsers (BCD `mirror`) (S) | 16.4, macOS and iOS (S) | desktop 130; **Android: not shipped** (S) | [C1] [K5] [G1] [G37] |
| AV1 through WebCodecs | dav1d in software everywhere; hardware where the GPU or OS offers it (S) | only where AV1 **hardware** exists, by default; Main profile (`av01.0`) only (S) | dav1d (FFmpeg's wrapper) in software; WMF, VideoToolbox, VA-API in hardware (S/D) | [C18] [K31] [K32] [K47] [G43] [G46] |
| exact 10-bit samples | yes from the software decoders (`I420P10` …); `null` from hardware P010; RGB on Android hardware (S/D) | **no**: every 10-bit frame has `format` `null` (S/D) | `I420P10` when the frame comes back as CPU planes, `BGRX` when it comes back as a texture (S/D) | [C35] [C44] [C41] [K42] [K43] [G56] [G57] |
| 12-bit | **AV1 refused** at the key-frame check (libgav1 built to 10 bits), though dav1d outputs `I420P12`; VP9 12-bit through libvpx (S/D) | no path (S) | `I420P12` on the CPU-plane path (S) | [X1]–[X4] [C35] [C38] [K35] [K40] [G56] |
| 4:0:0 (monochrome) AV1 | `I420` with mid-grey chroma synthesised (S) | software dav1d refuses anything but 8-bit 4:2:0 (S) | dropped by Gecko's dav1d module; FFmpeg path has no grey format (S) | [C35] [C36] [K36] [G53] [G55] |
| `ImageDecoder` | 94 (S) | 27.3 beta (S) | 133 (S) | [C4] [K20] [G4] |
| AVIF / JPEG XL / JPEG 2000 in `<img>` | 85 / 155 / none (S/D) | 16.4 / 17 / removed in 18 (S) | 93 / 158 / none (S/D) | [I21] [I22] [I28] |
| float16 canvas (`colorType`) | 137 (S) | no (S) | no (S) | [F89] [I37] |
| WASM SIMD, threads | 91, 74 (Android 88; **WebView: no threads**) (S) | 16.4, 15.2; COEP `credentialless` not supported (S) | 89, 79 (S) | [A1] [A4] [C8] [A8] |

**So, for exact 10- and 12-bit medical samples (D, from the rows above):** WebCodecs is exact only where the engine's
software decoder hands back CPU planes: Chromium at ≤ 10 bits for AV1 (12 for VP9), and Gecko on its CPU-plane path.
Safari gives no exact samples above 8 bits through any browser API. A WebAssembly decoder is exact in every engine.

### How to read this document

§WebCodecs VideoDecoder, §VideoFrame and §From a VideoFrame to the screen are the specification; §Codec strings is the
registry; §Chromium, §WebKit and §Gecko are what each engine ships; §ImageDecoder and image formats, §Media
Capabilities decodingInfo, §The `<video>` and MSE route and §Decoding in WebAssembly the other routes; §Performance and
resource guidance and §How to test support are practice; §What it means for this repository compares this with the
repository's own decode documents. Every id resolves in §Sources, which holds the quote.

## WebCodecs VideoDecoder

**Which document.** The TR is a W3C Working Draft dated 9 November 2026 [V1]; the editor's draft carries the same
date [V2]. A text diff of the two (fetched 2026-11-10) differs only in the status boilerplate and in the dates of
cited references; every algorithm, IDL block and member quoted below reads the same in both. (D, from [V1], [V2]
and the diff.) Nothing below is ED-only.

### What a junior must know first

| claim | label | src |
|---|---|---|
| The interface exists only in secure contexts, in windows and dedicated workers: `[Exposed=(Window,DedicatedWorker), SecureContext]`. | S | [V3] |
| `configure()` sets `state` to `"configured"` **at once**, before support is checked; an unsupported config shows up later as a `NotSupportedError` through the `error` callback, and the decoder is then closed. | S | [V5], [V6] |
| So `state === "configured"` does not mean the config works; check `isConfigSupported()` first, as the spec's own note advises. | D | [V5], [V6] |
| Every error that reaches the `error` callback closes the decoder; a closed decoder cannot be configured again (`InvalidStateError`), so recovery means constructing a new `VideoDecoder`. | D | [V5], [V14] |
| The first chunk after `configure()` **and after `flush()`** must have `type: "key"`, or `decode()` throws `DataError` synchronously. | S | [V4], [V7], [V12] |
| Output frames must be closed promptly: the decoder owns their media resources and decoding can stall otherwise. | S | [V10] |
| The pixel format of output frames is whatever the codec implementation emits; `VideoFrame.format` is `null` when it does not map to a `VideoPixelFormat`. No config member requests a format. | S / D | [V33], [V18] |
| The privacy section (non-normative) states conforming decoders for AVC, HEVC, VP8, VP9 and AV1 produce bit-exact YUV samples in their native format; differences across devices come from output format, alignment metadata, colour space and post-decode conversion (e.g. `copyTo()`). | S | [V35], [V75] |

### Interface

```webidl
[Exposed=(Window,DedicatedWorker), SecureContext]
interface VideoDecoder : EventTarget {
 constructor(VideoDecoderInit init);
 readonly attribute CodecState state;
 readonly attribute unsigned long decodeQueueSize;
 attribute EventHandler ondequeue;
 undefined configure(VideoDecoderConfig config);
 undefined decode(EncodedVideoChunk chunk);
 Promise<undefined> flush();
 undefined reset();
 undefined close();
 static Promise<VideoDecoderSupport> isConfigSupported(VideoDecoderConfig config);
};
dictionary VideoDecoderInit {
 required VideoFrameOutputCallback output;
 required WebCodecsErrorCallback error;
};
callback VideoFrameOutputCallback = undefined(VideoFrame output);
```
(S) [V3]; `callback WebCodecsErrorCallback = undefined(DOMException error);` (S) [V38].

### Methods

| method | what it does (sync part) | async part (control message) | label | src |
|---|---|---|---|---|
| `new VideoDecoder({output, error})` | Both callbacks required. Sets state `"unconfigured"`, `[[key chunk required]]` true, `decodeQueueSize` 0. | — | S | [V3], [V4] |
| `configure(config)` | `TypeError` if config not valid; `InvalidStateError` if closed; else state → `"configured"`, key chunk required → true, queue message. | Blocks the queue; runs Check Configuration Support; if false, closes with `NotSupportedError`; else configures the implementation. | S | [V5], [V6] |
| `decode(chunk)` | `InvalidStateError` unless `"configured"`; if key chunk required and `chunk.type` is not `key`, `DataError`; increments `decodeQueueSize`. | Waits while the codec is saturated; decrements `decodeQueueSize`, schedules `dequeue`; a decode failure closes with `EncodingError`; outputs go to `output` in presentation order. | S | [V7], [V9], [V11] |
| `flush()` | Promise rejected with `InvalidStateError` unless `"configured"`; sets key chunk required → true. | Emits all pending outputs, then resolves. | S | [V12] |
| `reset()` | Runs Reset with `AbortError`: `InvalidStateError` if closed; state → `"unconfigured"`; drops queued messages; `decodeQueueSize` → 0; rejects pending `flush()` promises with `AbortError`. | — | S | [V13] |
| `close()` | Runs Close with `AbortError`: Reset, state → `"closed"`, releases resources. "Close is final." | — | S | [V14] |
| `VideoDecoder.isConfigSupported(config)` | Rejects with `TypeError` if config not valid. | Resolves `{supported, config}`; see below. | S | [V24] |

Implementers SHOULD also inspect the chunk's bytes to check it truly is a key chunk, and throw `DataError` on a mismatch (S) [V8].

### States

| from | event | to | label | src |
|---|---|---|---|---|
| (construction) | — | `unconfigured` | S | [V4] |
| `unconfigured` / `configured` | `configure()` with a valid config | `configured` (also on re-configure) | S | [V5] |
| `configured` | `reset()` | `unconfigured` | S | [V13] |
| any but `closed` | `close()`, or an error (`NotSupportedError`, `EncodingError`, `QuotaExceededError`) | `closed` | S | [V6], [V9], [V14], [V36] |
| `closed` | `configure()` / `reset()` | throws `InvalidStateError`; stays `closed` | S | [V5], [V13] |

```
            configure()                 close() / error
 unconfigured ─────────► configured ────────────────────► closed (final)
      ▲                    │  ▲ configure() again              ▲
      └──── reset() ───────┘  └──┘                              │
      └──────────────────────── close() ───────────────────────┘
```
(D, drawn from the table above.) `CodecState` values: `"unconfigured"`, `"configured"`, `"closed"` (S) [V38].

### Control message queue, `decodeQueueSize`, `dequeue`

| claim | label | src |
|---|---|---|
| Each method call queues a control message; the queue is processed in order while not blocked, and a message returning "not processed" stays at the front to be retried. | S | [V16] |
| `configure` blocks the queue until the implementation is configured. | S | [V6] |
| `decodeQueueSize` is "The number of pending decode requests"; it counts chunks not yet handed to the codec — it drops when the decode message runs, not when the frame is output. | S / D | [V4], [V9] |
| Codec saturation: the implementation's active-request maximum "may be any value greater than 1, including infinity"; while saturated, `decode()` calls stay queued and raise `decodeQueueSize`. | S | [V15] |
| `dequeue` fires "when the decodeQueueSize has decreased"; at most one is scheduled at a time (coalesced, "to avoid event spam"). | S | [V15], [V17] |
| Output `VideoFrame`s take `timestamp` and `duration` from the chunk that produced them. | S | [V34] |

### Errors

| exception | how delivered | condition in the spec | label | src |
|---|---|---|---|---|
| `TypeError` | thrown by `configure()`; rejection from `isConfigSupported()` | config is not a valid `VideoDecoderConfig` (rules below) | S | [V5], [V24] |
| `TypeError` | thrown by `EncodedVideoChunk.copyTo()` | chunk byte length exceeds the destination's | S | [V31] |
| `InvalidStateError` | thrown | `configure()` or `reset()` on a closed decoder; `decode()` when not `"configured"` | S | [V5], [V7], [V13] |
| `InvalidStateError` | rejected `flush()` promise | not `"configured"` | S | [V12] |
| `DataError` | thrown by `decode()` | key chunk required and `chunk.type` is not `key`, or the UA detects the data is not a key chunk | S | [V7], [V8] |
| `NotSupportedError` | `error` callback; decoder closed | Check Configuration Support returned false while running the configure message | S | [V6] |
| `EncodingError` | `error` callback; decoder closed | "If decoding results in an error" | S | [V9] |
| `QuotaExceededError` | `error` callback; decoder closed | the UA reclaims the codec | S | [V36] |
| `AbortError` | rejects pending `flush()` promises; **not** passed to `error` | `reset()` or `close()` by the page | S | [V13], [V14] |
| `DataCloneError` | thrown by `new EncodedVideoChunk()` | `transfer` lists one buffer twice, or a detached one; also on serializing a chunk for storage | S | [V30], [V32] |

Reclamation (`QuotaExceededError`) is allowed only for inactive (no progress on the work queue for 10 s) or background
(document `hidden`) codecs, never for one that is active and in the foreground, and not for an active background
decoder while an encoder is active in the same global (S) [V37].

### `VideoDecoderConfig`

```webidl
dictionary VideoDecoderConfig {
 required DOMString codec;
 AllowSharedBufferSource description;
 [EnforceRange] unsigned long codedWidth;
 [EnforceRange] unsigned long codedHeight;
 [EnforceRange] unsigned long displayAspectWidth;
 [EnforceRange] unsigned long displayAspectHeight;
 VideoColorSpaceInit colorSpace;
 HardwareAcceleration hardwareAcceleration = "no-preference";
 boolean optimizeForLatency = false;
 double rotation = 0;
 boolean flip = false;
};
```
(S) [V18]. The same members are in the TR and the ED [V1], [V2].

| member | meaning | label | src |
|---|---|---|---|
| `codec` | required codec string; grammar per registration, see §"Codec strings" | S | [V18], [V28] |
| `description` | "A sequence of codec specific bytes, commonly known as extradata"; whether and how to fill it is per registration (AV1, VP8, VP9: not used; AVC/HEVC: decoder configuration record) | S | [V20], [V43], [V59] |
| `codedWidth` / `codedHeight` | frame size in pixels incl. non-visible padding; "used when selecting a [[codec implementation]]" | S | [V20] |
| `displayAspectWidth` / `Height` | display aspect ratio applied to output frames | S | [V20], [V34] |
| `colorSpace` | if present, overrides in-band colour values; UAs MAY fill its `null` members from the bitstream | S | [V20], [V34] |
| `hardwareAcceleration` | hint: `"no-preference"` (default; UA MAY use hardware), `"prefer-hardware"`, `"prefer-software"`; UAs "may ignore these values in some or all circumstances for any reason"; a preference can make a config unsupported | S | [V21] |
| `optimizeForLatency` | hint that the decoder SHOULD minimise chunks needed before a frame is output; some bitstreams need a minimum anyway | S | [V20] |
| `rotation`, `flip` | copied onto output frames' `rotation` / `flip` | S | [V20], [V34] |

**Valid VideoDecoderConfig** (else `TypeError`) — all of (S) [V19]:

1. `codec` is not empty after trimming ASCII whitespace;
2. `codedWidth` and `codedHeight` are both present or both absent, and neither is 0;
3. `displayAspectWidth` and `displayAspectHeight` are both present or both absent, and neither is 0;
4. `description` is not detached.

A malformed but non-empty codec string (e.g. `"av01"`) passes validity, so it gives `supported: false` /
`NotSupportedError`, not `TypeError` (D, from [V19] and the first step of [V25]).

Hardware preference and privacy: if the UA implements Media Capabilities, accepting or rejecting a
`HardwareAcceleration` preference MUST reveal nothing beyond what Media Capabilities reveals; a UA that does not
implement it for fingerprinting reasons SHOULD ignore the preference (S) [V22]. The spec's own example of
`prefer-hardware` is an author who provides "their own software based fallback via WebAssembly" (S) [V23].

### `isConfigSupported()`: what it promises

| claim | label | src |
|---|---|---|
| Resolves `VideoDecoderSupport { boolean supported; VideoDecoderConfig config; }`. | S | [V24] |
| `config` is a deep clone holding only the members the UA recognises; compare it with the input to detect unrecognised members. | S | [V24] |
| `supported` is false if the codec string is invalid or unrecognised, or if the UA cannot decode "the exact profile (where present), level (where present), and constraint bits (where present)"; true if the UA "can provide a codec to support all entries of the config". | S | [V25] |
| `configure()` runs the same algorithm, so both reflect the same supported set. | S | [V27] |
| Support is best-effort "given the resources that are available at the time of the query" and can change (e.g. GPU unplugged). | S | [V26] |
| UAs may limit answers to a common baseline to reduce fingerprinting. | S | [V27] |
| **Not promised:** that a later `decode()` succeeds (a failure still arrives as `EncodingError`); that hardware is used (the result carries no such field, and the preference is a hint); which output pixel format frames will have. | D | [V9], [V21], [V24], [V33] |
| **Not promised:** that bit depth or chroma subsampling in the codec string were checked — the algorithm names only profile, level and constraint bits explicitly; "all entries of the config" is the only wider rule. | D | [V25] |

### `EncodedVideoChunk`

```webidl
[Exposed=(Window,DedicatedWorker), Serializable]
interface EncodedVideoChunk {
 constructor(EncodedVideoChunkInit init);
 readonly attribute EncodedVideoChunkType type;
 readonly attribute long long timestamp; // microseconds
 readonly attribute unsigned long long? duration; // microseconds
 readonly attribute unsigned long byteLength;
 undefined copyTo(AllowSharedBufferSource destination);
};
dictionary EncodedVideoChunkInit {
 required EncodedVideoChunkType type;
 required [EnforceRange] long long timestamp; // microseconds
 [EnforceRange] unsigned long long duration; // microseconds
 required AllowSharedBufferSource data;
 sequence<ArrayBuffer> transfer = [];
};
enum EncodedVideoChunkType { "key", "delta" };
```
(S) [V29] (the enum is laid out on one line here).

| claim | label | src |
|---|---|---|
| By default the constructor **copies** `data` ("Assign a copy of init.data to [[internal data]]"). | S | [V30] |
| If `transfer` contains the buffer behind `data`, the UA MAY reference it instead of copying; every buffer in `transfer` is detached either way. | S | [V30] |
| `duration` is `null` when not given; `timestamp` and `duration` are in microseconds. | S | [V29], [V30] |
| `copyTo(dest)` throws `TypeError` if `dest` is smaller than `byteLength`. | S | [V31] |
| Chunks are serializable (`postMessage`) but not for storage. | S | [V32] |

## VideoFrame

The WebCodecs Working Draft of 9 November 2026 [F1] and the Editor's Draft of the same date [F2] carry the same
normative text: diffing the two (as text) shows differences only in the status block and in reference dates. So
everything below, including `copyTo`'s RGB conversion, is in **both** TR and ED (D: diff of [F1] and [F2]).

### What a frame is, and when you get its bytes exactly

| claim | label | src |
|---|---|---|
| `copyTo()` without `format` copies the frame's media resource row by row, byte for byte: no conversion step exists in the algorithm. | S | [F3] |
| The default output format of `copyTo()` is the frame's own `format`. | S | [F4] |
| `copyTo()` and `allocationSize()` reject with `NotSupportedError` when `format` is null and no `options.format` is given — a frame whose format is null cannot be read raw. | S | [F5] |
| `format` is null "whenever the underlying format does not map to a VideoPixelFormat", or after `close()`. | S | [F6] |
| A decoder output gets null `format` when the codec emits a layout the enum does not name. | S | [F7] |
| So reading the decoder's samples exactly needs a non-null `format` from the decoder and `copyTo()` without `options.format` (D: [F3], [F5], [F7]). | D | [F3] [F5] [F7] |
| `copyTo()` promises are not guaranteed to resolve in call order. | S | [F8] |
| `VideoFrame` is exposed in `Window` and `DedicatedWorker`, and is `Serializable` and `Transferable`. | S | [F9] |

### `VideoPixelFormat`

Every value in the enum [F10]. "Integer values are unsigned" [F11]. Chroma planes have `ceil(codedWidth / 2)`
samples per row where sub-sampled horizontally, and `ceil(codedHeight / 2)` rows where sub-sampled vertically [F12].

| format | planes, in order | chroma sub-sampling | sample container | significant bits | `visibleRect` / `rect` offset | opaque equivalent | label | src |
|---|---|---|---|---|---|---|---|---|
| `I420` | Y, U, V | 2 × 2 | 8-bit | 8 | x, y even | itself | S | [F12] [F13] |
| `I420P10` | Y, U, V | 2 × 2 | 16-bit little-endian | 10 | x, y even | itself | S | [F14] |
| `I420P12` | Y, U, V | 2 × 2 | 16-bit little-endian | 12 | x, y even | itself | S | [F15] |
| `I420A` | Y, U, V, A | 2 × 2 (A full) | 8-bit | 8 | x, y even | `I420` | S | [F16] |
| `I420AP10` | Y, U, V, A | 2 × 2 (A full) | 16-bit LE | 10 | x, y even | `I420P10` | S | [F14] [F16] |
| `I420AP12` | Y, U, V, A | 2 × 2 (A full) | 16-bit LE | 12 | x, y even | `I420P12` | S | [F15] [F16] |
| `I422` | Y, U, V | 2 × 1 | 8-bit | 8 | x even | itself | S | [F17] |
| `I422P10` | Y, U, V | 2 × 1 | 16-bit LE | 10 | x even | itself | S | [F14] [F17] |
| `I422P12` | Y, U, V | 2 × 1 | 16-bit LE | 12 | x even | itself | S | [F15] [F17] |
| `I422A` / `I422AP10` / `I422AP12` | Y, U, V, A | 2 × 1 (A full) | 8 / 16 LE / 16 LE | 8 / 10 / 12 | x even | `I422` / `I422P10` / `I422P12` | S | [F16] [F17] |
| `I444` / `I444P10` / `I444P12` | Y, U, V | none | 8 / 16 LE / 16 LE | 8 / 10 / 12 | any | itself | S | [F18] |
| `I444A` / `I444AP10` / `I444AP12` | Y, U, V, A | none | 8 / 16 LE / 16 LE | 8 / 10 / 12 | any | `I444` / `I444P10` / `I444P12` | S | [F16] [F18] |
| `NV12` | Y, then UV interleaved (U first) | 2 × 2 | 8-bit | 8 | x, y even | itself | S | [F19] |
| `RGBA` / `BGRA` | one plane, 4 components in the named order | none | 8-bit | 8 | any | `RGBX` / `BGRX` | S | [F20] |
| `RGBX` / `BGRX` | one plane; fourth byte padding, "always fully opaque" | none | 8-bit | 8 | any | itself | S | [F21] |

| claim | label | src |
|---|---|---|
| For P10/P12 the spec says only "10 bits, encoded as a 16-bit integer in little-endian byte order"; it does **not** say whether the value sits in the low bits (0–1023) or is shifted to the top. Searched §9.8 of [F2] for "least significant", "most significant", "MSB", "LSB", "shift", "upper bits", "lower bits": no match ("padding" appears only for the RGBX/BGRX fourth byte). | U | [F14] |
| There is no 10/12-bit packed format (no P010, no 16-bit RGB) and no single-channel (grey) format in the enum: a monochrome decode must arrive as a YUV format or as null `format`. | D | [F10] |
| `copyTo`'s byte width per plane is "the number of bytes per sample for plane, multiplied by the number of samples stored at each position" (2 for NV12's UV, 4 for RGBA). | S | [F22] |

### Geometry and timing attributes

| attribute | meaning | label | src |
|---|---|---|---|
| `codedWidth` / `codedHeight` | size in pixels "potentially including non-visible padding" | S | [F23] |
| `codedRect` | `{0, 0, codedWidth, codedHeight}`; "Offered for convenience for use with allocationSize() and copyTo()"; null after close | S | [F24] |
| `visibleRect` | the visible rectangle; null after close; the default `rect` of `copyTo()` | S | [F25] |
| `displayWidth` / `displayHeight` | size "when displayed after applying rotation and aspect ratio adjustments" | S | [F26] |
| `rotation` / `flip` | degrees clockwise, applied before horizontal flip, at render time only | S | [F27] |
| `timestamp` | presentation timestamp in microseconds (`long long`) | S | [F28] |
| `duration` | microseconds, nullable | S | [F28] |
| `metadata()` | a structured-clone copy of the frame's `VideoFrameMetadata`; members listed in the VideoFrame Metadata Registry | S | [F29] |
| The default `rect` (visibleRect) "does not necessarily meet the sample-alignment requirement and can result in copyTo() or allocationSize() rejecting." | S | [F30] |
| Fractional `DOMRectInit` values are truncated. | S | [F31] |
| A `BufferSource`-constructed frame may be given a larger `codedWidth`/`codedHeight` and moved `visibleRect` by the UA: read them back, do not assume your input. | S | [F32] |

### `copyTo()` / `allocationSize()` options

| option | rule | label | src |
|---|---|---|---|
| `rect` | rectangle to copy; default `visibleRect`; pass `codedRect` for the coded area; must be sample-aligned for `format` | S | [F30] |
| `layout` | one `PlaneLayout {offset, stride}` per plane, in bytes; default tightly packed; planes must not overlap; `stride` ≥ row bytes | S | [F33] [F34] |
| `format` | only `RGBA`, `RGBX`, `BGRA`, `BGRX`; any other value → `NotSupportedError` | S | [F35] [F36] |
| `colorSpace` | a `PredefinedColorSpace`, used only with an RGB `format`, default `srgb` | S | [F37] |
| Of `PredefinedColorSpace`, the conversion asserts only `srgb` or `display-p3`; HTML's enum also has `srgb-linear` and `display-p3-linear`, which the WebCodecs algorithm does not handle (D: assert in [F38] vs enum in [F63]). | D | [F38] [F63] |
| RGB conversion runs "Convert to RGB frame": a new resource at `visibleRect` size holding "the result of conversion" — no algorithm, matrix or rounding is specified. Output is 8-bit (the RGB formats are 8-bit, [F20]). | S | [F39] |
| So `copyTo({format: 'RGBA'})` of a P10/P12 frame loses at least 2–4 bits and applies an unspecified YUV→RGB conversion (D: [F39], [F20]). | D | [F39] [F20] |
| `allocationSize(options)` returns "the minimum byte length for a valid destination"; the returned `PlaneLayout`s of `copyTo()` give the real offsets and strides. | S | [F40] [F34] |
| browser-compat-data has a `copyTo.format_property` entry: Chrome 127, Firefox 130, Safari not supported; no entry for `colorSpace`. | S | [F41] |

### `VideoColorSpace`

All four members are nullable [F42]. Values [F43]:

| member | values | H.273 code points | label | src |
|---|---|---|---|---|
| `primaries` | `bt709`, `bt470bg`, `smpte170m`, `bt2020`, `smpte432` (P3 D65) | 1, 5, 6, 9, 12 | S | [F43] |
| `transfer` | `bt709`, `smpte170m`, `iec61966-2-1` (sRGB), `linear`, `pq`, `hlg` | 1, 6, 13, 8, 16, 18 | S | [F43] |
| `matrix` | `rgb`, `bt709`, `bt470bg`, `smpte170m`, `bt2020-ncl` | 0, 1, 5, 6, 9 | S | [F43] |
| `fullRange` | `true` / `false` / null | — | S | [F42] |

| claim | label | src |
|---|---|---|
| A decoder's colour space comes from the bitstream "on a best-effort basis"; a `colorSpace` in `VideoDecoderConfig` overrides it. | S | [F44] |
| With no colour space given, an RGB-format frame gets sRGB (full range) and a YUV-format frame gets REC709 with `fullRange` false. | S | [F45] [F46] |
| The enums have no BT.2020 constant-luminance and no YCgCo matrix; such streams cannot be labelled exactly (D: lists in [F43]). | D | [F43] |

### Memory model: `close()`, `clone()`

| claim | label | src |
|---|---|---|
| "Authors are encouraged to call close() immediately when frames are no longer needed." | S | [F47] |
| Decoder output frames' resources "are owned by the VideoDecoder and failing to release them (or waiting for garbage collection) can cause decoding to stall." | S | [F48] |
| Codec system resources (CPU memory, GPU memory, decoder hardware handles) "MAY be quickly exhausted and SHOULD be released immediately". | S | [F49] |
| `close()` "Clears all state and releases the reference to the media resource. Close is final."; after it `format` is null and all sizes 0. | S | [F50] |
| `clone()` returns a new frame referencing the **same** media resource; the resource lives while any reference does, so every clone must be closed too. | S | [F51] |
| `new VideoFrame(otherFrame, init)` also shares the resource rather than copying it. | S | [F52] |

### Transfer and serialization

| claim | label | src |
|---|---|---|
| Transferring (`postMessage(frame, [frame])`) "moves its [[resource reference]] to the destination object and closes (as in close()) the source object". | S | [F53] |
| Serializing without transfer (`postMessage(frame)`) "effectively clones (as in clone())", so both realms must close their copy. | S | [F53] |
| Serializing for storage (e.g. IndexedDB) throws `DataCloneError`. | S | [F54] |
| Serializing or transferring a closed frame throws `DataCloneError`. | S | [F54] |

### Constructing frames

`constructor(CanvasImageSource image, optional VideoFrameInit init)` and
`constructor(AllowSharedBufferSource data, VideoFrameBufferInit init)` [F9].

| claim | label | src |
|---|---|---|
| `VideoFrameBufferInit` requires `format`, `codedWidth`, `codedHeight`, `timestamp`; optional `duration`, `layout`, `visibleRect`, `rotation`, `flip`, `displayWidth`/`displayHeight`, `colorSpace`, `transfer`, `metadata`. | S | [F9] |
| `data.byteLength` below the computed allocation size → `TypeError`. | S | [F55] |
| With `transfer` naming `data`'s `ArrayBuffer`, the UA "MAY" reference the pixels in place instead of copying; every buffer in `transfer` is detached either way. | S | [F56] |
| From an `HTMLImageElement`, `SVGImageElement`, `HTMLCanvasElement`, `ImageBitmap` or `OffscreenCanvas`, a `timestamp` in `init` is required, else `TypeError`. | S | [F57] |
| A non-origin-clean image throws `SecurityError`. | S | [F58] |
| From an `HTMLVideoElement` it takes "the VideoFrame at the current playback position" (see §The `<video>` and MSE route). | S | [F59] |
| `init.alpha = "discard"` swaps the format for its opaque equivalent. | S | [F60] |
| Spec defect: the buffer constructor's `defaultRect` sets `"height" → init.codedWidth`; the frame's visible size is set later from `visibleRect` or the coded size, so the slip affects only the alignment check of a default rect (D: steps in [F61]). | D | [F61] |

## From a VideoFrame to the screen

Every route except `copyTo()` without `format` passes the frame through a UA-chosen colour conversion to RGB.
"When rendered … a VideoFrame MUST be converted to a color space compatible with the rendering target, unless color
conversion is explicitly disabled" [F62]; and "WebGPU does not provide color management" — its textures hold raw
numbers, so the conversion happens at import [F75].

| route | output | bit depth / format | where exactness can be lost | label | src |
|---|---|---|---|---|---|
| `frame.copyTo(buf)` (no `format`) | the frame's planes, its own `VideoPixelFormat` | 8-bit or 16-bit LE container, as the format says | nowhere in the algorithm (D: byte copy) | D | [F3] |
| `frame.copyTo(buf, {format:'RGBA'…, colorSpace})` | one RGB plane, `visibleRect` size | 8-bit | unspecified YUV→RGB conversion; bit-depth reduction; `srgb` / `display-p3` only | S | [F35] [F37] [F39] |
| 2D canvas `drawImage(frame, …)` | canvas backing store, at `displayWidth` × `displayHeight` | `unorm8` by default; `float16` with `colorType` | conversion to the canvas colour space; scaling to display size; filter "may use any filtering algorithm"; premultiplied alpha; 8-bit store | S | [F62] [F64] [F65] [F66] [F67] [F68] |
| `getImageData()` after `drawImage` | `ImageData` | `rgba-unorm8` (`Uint8ClampedArray`) or `rgba-float16` | everything above, plus the readback format | S | [F69] |
| `createImageBitmap(frame)` | `ImageBitmap` | not stated | "a copy of image's visible pixel data" (crop, optional resize with `resizeQuality`); bit depth unspecified | S | [F70] [F71] |
| WebGL `texImage2D(…, frame)` | texture of the `format`/`type` asked | RGBA-derived; WebGL 2 allows 8-bit unorm, ≤ 8-bit uint, 10-bit unorm (`RGB10_A2`), half float, float | conversion to `unpackColorSpace` (unless `NONE`); YUV→RGB always; precision guarantee only for 8-bit lossless images | S | [F72] [F73] [F74] [F76] |
| WebGPU `importExternalTexture({source: frame, colorSpace})` | `GPUExternalTexture` (`texture_external`) | read as `vec4<f32>` | conversion to `srgb` (default) or `display-p3`; sampling before or after conversion is implementation-dependent; internal representation may vary per frame | S | [F79] [F80] [F81] [F82] [F83] |
| WebGPU `copyExternalImageToTexture({source: frame}, {texture, colorSpace, premultipliedAlpha})` | a `GPUTexture` | unorm / unorm-srgb / float / ufloat formats, e.g. `rgba16float`; not uint or sint | "color-managed color value" of each pixel, re-encoded to the destination `colorSpace`; frame read at display size | S | [F84] [F85] [F86] [F87] [F88] |

### 2D canvas

| claim | label | src |
|---|---|---|
| A `VideoFrame` is a `CanvasImageSource`; its "pixel data must be used as the source image", sized `[[display width]]` × `[[display height]]` — so a non-square-pixel frame is scaled even at 1:1 draw (D). | S | [F64] |
| `CanvasColorType` `"unorm8"` is "8-bit unsigned normalized"; `"float16"` is "16-bit floating point". Default `unorm8`. | S | [F65] |
| browser-compat-data: `getContext('2d', {colorType})` — Chrome 137; Firefox and Safari not supported. | S | [F89] |
| Canvas colour spaces: `srgb`, `srgb-linear`, `display-p3`, `display-p3-linear`. | S | [F63] |
| When scaling up with `imageSmoothingEnabled = false`, "the image must be rendered using nearest-neighbor interpolation"; the down-scaling algorithm is not defined. | S | [F66] |
| The 2D output bitmap "must use premultiplied alpha", and converting premultiplied ↔ unpremultiplied "is a lossy operation" for non-opaque colours. | S | [F67] |
| A `float16` canvas holds a 10/12-bit value without integer truncation only if the UA's conversion to RGB keeps it; the spec states no such guarantee (D: [F62], [F39] unspecified). | D | [F62] [F65] |

### `createImageBitmap`

| claim | label | src |
|---|---|---|
| WebCodecs says ImageBitmap colour conversion "is controlled by ImageBitmapOptions colorSpaceConversion". HTML applies `colorSpaceConversion` only "If image is an img element or a Blob object" — the two specs disagree for `VideoFrame` (D). | D | [F62] [F71] |

### WebGL and WebGL 2

| claim | label | src |
|---|---|---|
| `TexImageSource` includes `VideoFrame`; texture size is "the width and height of the uploaded frame of the video in pixels". | S | [F72] [F77] |
| Upload first converts to `unpackColorSpace` "except if the the UNPACK_COLORSPACE_CONVERSION_WEBGL pixel storage parameter is set to NONE", then to the requested format/type; precision loss implied by a packed format "must occur". | S | [F73] |
| With `NONE`, "no colorspace conversion is applied, other than conversion to RGBA. (For example, a rec709 YUV video is still converted to rec709 RGB data …)" | S | [F74] |
| Full precision is guaranteed only for "an HTMLImageElement or ImageBitmap containing an RGB or RGBA lossless image with 8 bits per channel" — not for video or `VideoFrame`. | S | [F76] |
| WebGL 2 from a DOM source allows "only converting to unsigned integer of at most 8 bits, half float, or float"; the allowed-combination table lists `R8UI`, `RGBA8UI`, `R16F`, `RGBA16F`, `RGBA32F` and no `R16UI` / `RGBA16UI`. | S | [F78] |
| WebGL 2's rule names DOM elements, `ImageBitmap`, `ImageData` and `OffscreenCanvas`, not `VideoFrame`; it reaches a `VideoFrame` through WebGL 1's `TexImageSource` [F72]. So a `VideoFrame` cannot be uploaded to an integer texture wider than 8 bits, and the best upload is RGB in `RGB10_A2`, `RGBA16F` or `RGBA32F` after a UA conversion; exact 10/12-bit luma in WebGL needs `copyTo()` then `texImage2D` from an `ArrayBufferView` (D: [F78], [F74], [F3]). | D | [F78] [F74] [F3] |

### WebGPU

The Editor's Draft of 6 November 2026 (source commit `6bf1c35f…`) and the Candidate Recommendation Draft of 15
September 2026 were both read [F75] [F90]; the quotes below are in the ED.

| claim | label | src |
|---|---|---|
| `GPUExternalTextureDescriptor { required (HTMLVideoElement or VideoFrame) source; PredefinedColorSpace colorSpace = "srgb"; }` | S | [F79] |
| Import converts "the current image contents of source into the color space descriptor.colorSpace with unpremultiplied alpha", possibly outside [0, 1]. | S | [F80] |
| `textureLoad(t: texture_external, …) -> vec4<f32>`: samples are floats, never integers. | S | [F81] |
| "It is implementation-dependent whether … the sampler (and filtering) is applied before or after conversion". | S | [F82] |
| The internal layout (planes, matrices, 3D LUT) "may be inconsistent across time, systems, user agents, media sources, or even frames within a single video source". | S | [F83] |
| An external texture from a `VideoFrame` expires "when, and only when, the source VideoFrame is closed"; a dropped, unclosed frame is kept alive and "this may still stall the video decoder". | S | [F91] |
| `GPUCopyExternalImageSource` includes `VideoFrame`; copy size is `displayWidth` × `displayHeight`. | S | [F84] [F88] |
| Destination must be "a unorm/unorm-srgb or float/ufloat format (not snorm, uint, or sint)". | S | [F85] |
| `GPUCopyExternalImageDestInfo` adds `colorSpace = "srgb"` and `premultipliedAlpha = false`. | S | [F86] |
| Each texel is "the color-managed color value of the pixel", re-encoded for the destination. | S | [F87] |
| High-bit-depth sources "are preserved through color space conversion, with intermediate computations having at least the precision of the source" — but the source here is the UA's RGB view of the frame, whose precision WebCodecs does not specify (D: [F92], [F39]). | D | [F92] [F39] |
| browser-compat-data: `importExternalTexture` and `copyExternalImageToTexture` — Chrome 113 (partial: ChromeOS, macOS, Windows), 144 adds Linux on Intel Gen12+ GPUs; Firefox partial (141/144, platform-limited), Safari 26. | S | [F93] [F94] |

### Reading samples back exactly

| claim | label | src |
|---|---|---|
| Only `copyTo()` without `format` is specified as a byte copy of the decoder's planes; every other route above specifies a colour conversion, a scale to display size, a float or 8-bit store, or an unspecified intermediate. So `copyTo()` is the only route that can be relied on for exact 10/12-bit samples (D: rows above). | D | [F3] [F62] [F74] [F80] [F87] |
| Rendering exact samples on screen: upload the `copyTo()` planes as data (`texImage2D` with an `ArrayBufferView`, or WebGPU `writeTexture`) and do the window/level in a shader. Not a spec statement; follows from the rows above. | D | [F3] [F78] [F75] |

## Codec strings and the WebCodecs Codec Registry

### Registry

| claim | label | src |
|---|---|---|
| The registry is a W3C Registry Draft dated 24 September 2026, and "This registry is non-normative." | S | [V39] |
| "Implementers of WebCodecs are not required to support any particular codec nor registry entry." | S | [V39] |
| A valid codec string is valid per its codec's specification, describes one codec, and "is unambiguous about codec profile, level, and constraint bits for codecs that define these concepts". | S | [V28] |
| Only the value of a `codecs=` parameter is accepted, not a MIME type. | S | [V28] |
| Each registration defines: recognised codec strings, chunk internal data, `description` bytes, and what `type: "key"` means. | S | [V39] |
| Registered video codecs: `av01.*` (AV1), `avc1.*`, `avc3.*` (AVC/H.264), `hev1.*`, `hvc1.*` (HEVC/H.265), `vp8`, `vp09.*` (VP9). No VVC entry. | S | [V40] |
| Registered audio codecs (named only): `flac`, `mp3`, `mp4a.*` (AAC), `opus`, `vorbis`, `ulaw`, `alaw`, `pcm-*`. | S | [V40] |
| The registry ED and each video registration's ED have the same content as the TR versions on 2026-11-10. | D | text diff of [V40] vs ED, [V41] etc. |

### Per codec

| codec | codec string | `description` | chunk data | `type: "key"` means | label | src |
|---|---|---|---|---|---|---|
| AV1 | `av01.` + suffix per Section 5 of AV1-ISOBMFF | **not used** | OBUs in low-overhead format forming one temporal unit; the leading temporal delimiter may be omitted | contains a sequence header OBU before the first frame header, and that frame is `KEY_FRAME`, `show_frame` 1, `show_existing_frame` 0 | S | [V41]–[V44] |
| VP9 | `vp09.` + suffix per the "Codecs Parameter String" section of VP-ISOBMFF | not used | a frame (Section 6 of VP9) | frame with `frame_type` `KEY_FRAME` | S | [V53] |
| VP8 | exactly `vp8` | not used | a frame (Section 4 and Annex A of VP8) | `key_frame` true | S | [V57] |
| AVC | `avc1.` or `avc3.` + 6 characters (RFC 6381 §3.4; ISO/IEC 14496-15 §5.4.1) | present → `AVCDecoderConfigurationRecord` (avcC, 14496-15 §5.3.3.1) and the stream is `avc` format; **absent → Annex B** | one access unit | `avc`: an IDR picture; `annexb`: an IDR picture **plus** all parameter sets it needs | S | [V58]–[V60] |
| HEVC | `hev1.` or `hvc1.` + four dot-separated fields (14496-15 Annex E.3) | present → `HEVCDecoderConfigurationRecord` (hvcC, 14496-15 §8.3.3.1), `hevc` format; **absent → Annex B** | one access unit | an IDR, CRA or BLA picture; in `annexb`, plus all parameter sets | S | [V63]–[V65] |

AV1 takes no `description`: the av1C box of an MP4 file is not passed; the sequence header must travel in the key
chunk instead (D, from [V43], [V44]).

**Bitstream format options are encoder-only.** `VideoEncoderConfig.avc = { format: "annexb" | "avc" }` (default
`"avc"`) and `VideoEncoderConfig.hevc = { format: "annexb" | "hevc" }` (default `"hevc"`); in `avc`/`hevc` format
parameter sets go out in `EncodedVideoChunkMetadata.decoderConfig.description` (S) [V61], [V66]. On the decoder side
the format is chosen only by whether `description` is present (S) [V59], [V64]. AV1, VP9 and AVC also add a
per-frame `quantizer` encode option (S) [V41], [V53], [V61].

### AV1 codec string (AV1-ISOBMFF §5)

Grammar, verbatim (S) [V45]:

```
<sample entry 4CC>.<profile>.<level><tier>.<bitDepth>.<monochrome>.<chromaSubsampling>.
<colorPrimaries>.<transferCharacteristics>.<matrixCoefficients>.<videoFullRangeFlag>
```

| field | digits | value | label | src |
|---|---|---|---|---|
| sample entry 4CC | — | `av01` | S | [V41] |
| profile | 1 | `seq_profile`: 0 Main (8/10-bit 4:2:0 or mono), 1 High (adds 4:4:4), 2 Professional (adds 12-bit and 4:2:2) | S | [V46], [V50] |
| level | 2 | `seq_level_idx[0]`; level X.Y with X = 2 + (idx >> 2), Y = idx & 3 (so `08` = 4.0, `13` = 5.1) | S / D | [V46], [V49] |
| tier | 1 letter | `M` (seq_tier 0) or `H` (1) | S | [V46] |
| bitDepth | 2 | `BitDepth`: `08`, `10`, or `12`; 12 exists only with profile 2 (`twelve_bit` is read only when `seq_profile == 2 && high_bitdepth`) | S | [V46], [V51] |
| monochrome | 1 | `mono_chrome` | S | [V46] |
| chromaSubsampling | 3 | subsampling_x, subsampling_y, then `chroma_sample_position` if both are 1, else 0; a monochrome stream has x = y = 1 and position `CSP_UNKNOWN` (0), so `110` | S / D | [V46], [V52] |
| colorPrimaries, transferCharacteristics, matrixCoefficients | 2 each | CICP codes from `colr` box or the sequence header | S | [V46] |
| videoFullRangeFlag | 1 | `color_range` | S | [V46] |

| claim | label | src |
|---|---|---|
| 4CC, profile, level, tier and bitDepth are mandatory; the rest are optional and all-or-none, defaulting to `0.110.01.01.01.0` (non-mono, 4:2:0, BT.709 ×3, studio swing), and that default tail SHOULD be omitted. | S | [V47] |
| WebCodecs therefore requires at least `av01.P.LLT.DD`; its validity rule asks for unambiguous profile and level, which those fields give. | D | [V28], [V47] |
| `av01.0.04M.10.0.112.09.16.09.0` = Main, level 3.0, Main tier, 10-bit, 4:2:0 colocated, BT.2100 PQ, studio swing. | S | [V48] |
| `av01.0.08M.10` = Main profile, level 4.0, Main tier, 10-bit, defaults for the rest. | D | [V46], [V47], [V49] |
| 12-bit AV1 needs profile 2, e.g. `av01.2.08M.12`; 10-bit monochrome is `av01.0.08M.10.1.110.01.01.01.0` (full tail, since mono ≠ default). | D | [V47], [V50]–[V52] |
| Whether a UA's `isConfigSupported()` rejects an unsupported bitDepth or monochrome value (rather than only profile/level). | U | spec names only profile/level/constraint bits [V25]; per-UA behaviour belongs to the engine sections |

### VP9 codec string (VP-ISOBMFF)

Grammar, verbatim (S) [V54]:

```
<sample entry 4CC>.<profile>.<level>.<bitDepth>.<chromaSubsampling>.
<colourPrimaries>.<transferCharacteristics>.<matrixCoefficients>.
<videoFullRangeFlag>
```

| claim | label | src |
|---|---|---|
| "All parameter values are expressed as double-digit decimals"; 4CC, profile, level, bitDepth are mandatory; the rest optional, all-or-none, default 4:2:0 colocated (`01`), BT.709, legal range. | S | [V54] |
| Profile 0: 8-bit 4:2:0; 1: 8-bit 4:2:2/4:4:4; 2: 10/12-bit 4:2:0; 3: 10/12-bit 4:2:2/4:4:4. | S | [V55] |
| Level is ten times the level number: `10` = 1, `41` = 4.1, `62` = 6.2. | S | [V56] |
| `vp09.00.10.08` = profile 0, level 1, 8-bit; `vp09.00.41.08` = profile 0, level 4.1, 8-bit (the latter is the binding's own example). | D / S | [V55], [V56] |

### AVC and HEVC codec strings

| claim | label | src |
|---|---|---|
| AVC suffix = hex of three SPS bytes: `profile_idc`, the constraint_set flags byte, `level_idc` (`avcoti := 6(DIGIT / "A" / … / "F")`). | S | [V62] |
| `avc1.42001E` = `profile_idc` 0x42 = 66, constraints 0x00, `level_idc` 0x1E = 30. | D | [V62] |
| HEVC suffix layout (`hev1.1.6.L93.B0`: profile space/idc, compatibility flags, tier+level, constraint bytes) is defined in ISO/IEC 14496-15 Annex E.3, which is not freely published; not verified here. | U | looked for: an open copy of 14496-15 Annex E.3; the registration only points to it [V63] |
| `hev1` vs `hvc1` and `avc1` vs `avc3` are both accepted; the registrations give no decoder-side difference between them. | D | [V58], [V63] |

## Chromium

Covers Chrome desktop, Chrome for Android and Android WebView. Edge, Opera and Samsung Internet come up only where
they differ. In browser-compat-data (BCD) they are all `"mirror"` entries for every API below, which means BCD copies
their data from Chrome or Chrome Android [C1]. Engine source is pinned to Chromium `main` at
`81ba34d0f9102bff3e2062ce81389410a7c16bb3` (committed 2026-11-10, after tag 159.0.8153.x), and every source id below
refers to that commit. A source fact describes the code at that commit, not any particular stable release.

**What matters most for exact 10- and 12-bit samples:**

* Only the software decoders (dav1d for AV1, libvpx for VP9) hand WebCodecs planar `I420P10` or `I420P12` frames that
  `copyTo()` can read.
* Hardware paths give NV12 (8-bit), RGB (Android), or a frame whose `format` is `null` (10-bit P010 or textures).
* `hardwareAcceleration: "prefer-software"` is the only setting that keeps the hardware path out (§Which decoder).

### Since which version

BCD at commit `918d2d72…`. Every Chromium-family browser except Chrome desktop is `"mirror"` unless the table says
otherwise.

| API (BCD key) | chrome `version_added` | other Chromium browsers | label | src |
|---|---|---|---|---|
| `VideoDecoder` (and `configure`, `decode`, `decodeQueueSize`, `flush`, `reset`, `close`) | `"94"` | mirror | S | [C1] |
| `VideoDecoder.isConfigSupported_static` | `"94"` | mirror | S | [C1] |
| `VideoDecoder` `dequeue_event` | `"106"` | mirror | S | [C2] |
| `VideoDecoder.configure` `flip_option`, `rotation_option` | `"138"` | mirror | S | [C2] |
| `VideoFrame` (and `copyTo`, `allocationSize`, `format`, `clone`, `close`) | `"94"` | mirror | S | [C3] |
| `VideoFrame.copyTo` `format_property` (convert to RGB) | `"127"` | mirror | S | [C3] |
| `VideoFrame.metadata` | `"145"` | mirror | S | [C3] |
| `EncodedVideoChunk` | `"94"` | mirror | S | [C4] |
| `ImageDecoder` (and `isTypeSupported_static`) | `"94"` | mirror | S | [C4] |
| `HTMLVideoElement.requestVideoFrameCallback` | `"83"` | mirror | S | [C5] |
| `MediaCapabilities.decodingInfo` | `"66"`, with notes: "`codecs` string can contain any subset of optional parameters (should be all or none)." and "Errors if `codecs` string contains unexpected characters (should evaluate string up to character)." | mirror | S | [C5] |
| `ManagedMediaSource` | `false` | mirror (so `false` everywhere) | S | [C6] |
| `MediaSource` `worker_support`, `handle`, `canConstructInDedicatedWorker_static` | `"108"` | mirror | S | [C6] |
| `webassembly.api` (`WebAssembly` JS API) | `"57"` | Edge `"16"`, others mirror | S | [C7] |
| WebAssembly `fixed-width-SIMD` / `relaxed-SIMD` / `memory64` / `bulk-memory-operations` | `"91"` / `"114"` / `"133"` / `"75"` | mirror | S | [C7] |
| WebAssembly `threads-and-atomics` | `"74"`; chrome_android `"88"`; **webview_android `false`** | Edge mirror | S | [C8] |
| BCD has no `worker_support` entry for `VideoDecoder`, `VideoFrame` or `ImageDecoder` (the IDL exposure is under §Workers) | — | — | S | [C1][C3][C4] |
| A WASM decoder that relies on threads (shared memory plus Atomics) has no BCD support in Android WebView: it must also run single-threaded | — | — | D | from [C8] |

chromestatus.com entries:

| feature (id) | milestone as read | label | src |
|---|---|---|---|
| WebCodecs (5669293909868544): "Provides efficient, low-level access to built-in (software and hardware) media encoders and decoders." | desktop 94, android 94, webview 94; origin trial 86–93 | S | [C9] |
| ImageDecoder API extension for WebCodecs (4561928577875968) | desktop/android/webview 94 | S | [C10] |
| Enable HEVC hardware decoding (5186511939567616) | desktop/android/webview 107 | S | [C11] |
| Conversion to RGB in VideoFrame: copyTo() method (4668827056209920) | desktop 127, android 127, webview `null`; status text as read: "In developer trial (Behind a flag)" (BCD lists 127 as shipped [C3]) | S | [C12] |
| MSE in Workers (5177263249162240) | desktop/android/webview 108 | S | [C13] |
| Media Source Extensions for WebCodecs (5649291471224832) | "Origin trial", not shipped; flag `--enable-blink-features=MediaSourceExtensionsForWebCodecs` | S | [C14] |
| WebGPU WebCodecs integration (5078348864159744): `VideoFrame` as a `GPUExternalTexture` source | "Origin trial" (stage 113–118) | S | [C15] |
| HTMLVideoElement.requestVideoFrameCallback() (6335927192387584) | desktop 83, android 83, webview `null` (BCD mirrors 83 to WebView [C5]) | S | [C16] |

### Which decoder backs each codec

How a `VideoDecoder` picks its implementation. The renderer's software factory lists decoders in this order: the
external (GPU-process) factory first, "since one will only exist if it is hardware accelerated", then libvpx, dav1d,
dav2d (behind a flag) and FFmpeg [C17].

| codec | software (bundled) | hardware / OS path | label | src |
|---|---|---|---|---|
| AV1 | dav1d (`enable_dav1d_decoder = use_blink`, `enable_av1_decoder = enable_dav1d_decoder`). dav1d is pinned in DEPS at `4e3ab21fbbf84a4bd283ea27f96287fcd7c228c1`. README.chromium says `Version: master` | Windows: D3D (`D3DVideoDecoder`); macOS: VideoToolbox (Main profile only); Linux: VA-API; ChromeOS: VA-API/V4L2; Android: MediaCodec | S | [C18][C19][C21][C22][C23][C24] |
| VP9 | libvpx at `fb0a26ad923b58c3663aaa9523992cf779b1563b` (CPE `libvpx:1.17.0`). Outside Android, profiles 2 and 3 only if libvpx reports `VPX_CODEC_CAP_HIGHBITDEPTH`; on Android every VP9 profile passes this check | same platform decoders; macOS VideoToolbox supports profiles 0 and 2 only | S | [C20][C25][C23] |
| VP8 | libvpx (`ConfigureDecoder` accepts `kVP8` and `kVP9`) | MediaCodec on Android if `IsVp8DecoderAvailable()` | S | [C26][C24] |
| H.264 | FFmpeg: "We only build support for H.264." FFmpeg video decoders are left out on Android arm (`enable_ffmpeg_video_decoders = media_use_ffmpeg && (!is_android \|\| current_cpu != "arm")`) | D3D, VideoToolbox, VA-API, MediaCodec | S | [C27][C18] |
| HEVC | **none bundled.** `IsDecoderBuiltInVideoCodec` lists only H.264 (FFmpeg), VP8/VP9 (libvpx), AV1 and the flagged AV2 | platform only, gated by `kPlatformHEVCDecoderSupport` (`FEATURE_ENABLED_BY_DEFAULT`). The build includes the HEVC hardware decoder for `is_win \|\| is_apple \|\| is_android \|\| is_linux`. chromestatus: "Android 5.0+, macOS 11+, with supported hardware on Windows 8+ and ChromeOS" | S | [C20][C28][C11] |
| HEVC on macOS | the VideoToolbox path may use Apple's OS software decoder: "because we allow the OS software decoder we report the minimum possible HEVC encode size" | — | S | [C23] |
| Android OS software codecs | MediaCodec's own software decoders (e.g. for AV1/VP9) are excluded when Chromium bundles one: "Don't allow OS software decoding for bundled software decoders unless the content is encrypted". VP9 profiles 2/3 are the exception. `kAllowMediaCodecSoftwareDecoder` is `FEATURE_DISABLED_BY_DEFAULT` | — | S | [C24][C28] |
| Linux hardware decode | the `AcceleratedVideoDecoder` feature defaults to enabled only `#if BUILDFLAG(USE_VAAPI)`. `use_vaapi` is `is_linux && !is_castos && (ozone x11 or wayland) && (x86, x64 or arm64)` | — | S | [C21][C29] |
| Windows D3D12 | `kD3D12VideoDecoder` is `FEATURE_DISABLED_BY_DEFAULT`, so D3D11 is the default | — | S | [C22][C28] |

How `hardwareAcceleration` maps to source:

| value | effect in source | label | src |
|---|---|---|---|
| `"no-preference"` | software factory wrapping the external (hardware) factory. The hardware decoder is tried first if the GPU reports decode acceleration, then the software decoders | S | [C30][C17] |
| `"prefer-hardware"` | `decoder_factory_ = std::move(external_decoder_factory);` (hardware only). `isConfigSupported` asks the GPU factories, and any answer other than `kTrue` resolves `supported: false` | S | [C30][C31] |
| `"prefer-software"` | the external factory is never built (`if (hardware_preference_ != HardwarePreference::kPreferSoftware)`). `isConfigSupported` returns `false` for codecs not built in, so **HEVC + `prefer-software` is always unsupported** | S, D (HEVC) | [C30][C31][C20] |
| `"no-preference"` / `"prefer-software"` in `isConfigSupported` | resolves `true` once the codec string and config are valid and `IsDecoderSupportedVideoType` passes. No decoder is instantiated, so `configure()` can still fail | S (code), D (consequence) | [C31] |
| H.264/HEVC configs that need software (decided by `RequiresSoftwareDecoder()`) + `prefer-hardware` | rejected: "This configuration is only supported by the software decoder." | S | [C32] |
| no `codedWidth`/`codedHeight` in config | "Guess 720p if no coded size hint is provided. This choice should result in a preference for hardware decode." | S | [C32] |
| `VideoDecoder.isConfigSupported` for AV1 on Android without the bundled decoder | needs `SDK_VERSION_Q` or later. In Chrome the bundled dav1d build flag is on (`use_blink`) | S | [C33][C18] |

### Output formats and bit depths per path

WebCodecs `VideoPixelFormat` values in this Chromium build: `I420`, `I420P10`, `I420P12`, `I420A`, `I420AP10`,
`I422`, `I422P10`, `I422P12`, `I422A`, `I422AP10`, `I444`, `I444P10`, `I444P12`, `I444A`, `I444AP10`, `NV12`, `RGBA`,
`RGBX`, `BGRA`, `BGRX` [C34]. There is no P010, no 16-bit, no monochrome and no 12-bit-with-alpha value.

| path | 8-bit | 10-bit | 12-bit | 4:0:0 (monochrome) | label | src |
|---|---|---|---|---|---|---|
| AV1, dav1d (software) | `PIXEL_FORMAT_I420` → `"I420"` (also I422/I444) | `PIXEL_FORMAT_YUV420P10` → `"I420P10"` | `PIXEL_FORMAT_YUV420P12` → `"I420P12"`, but a 12-bit AV1 key chunk is refused before dav1d (§12-bit AV1 below). dav1d is built twice, with `-DBITDEPTH=8` and `-DBITDEPTH=16` (`CONFIG_16BPC 1`) | reported as I420/P10/P12 with **synthesised** chroma: "Single plane monochrome images will be converted to standard 3 plane ones since Chromium doesn't support single Y plane images." U and V are filled with `(1 << bit_depth) / 2` (8-bit: `256 / 2`) | S | [C35][C36][C37] |
| VP9, libvpx (software) | `VPX_IMG_FMT_I420` → I420 (I422/I444, plus A variants when there is alpha) | `I42016`, bit_depth 10 → `YUV420P10` | `I42016`, bit_depth 12 → `YUV420P12` (12-bit has no alpha variant) | not handled (no 4:0:0 case) | S | [C38] |
| H.264, FFmpeg (software) | `AV_PIX_FMT_YUV420P` → I420 | `YUV420P10LE` → YUV420P10 (9-bit is treated as 10-bit) | `YUV420P12LE` → YUV420P12 | no `GRAY` case, so it falls to `default` (unsupported) | S (mapping), U (whether this FFmpeg build decodes H.264 above 8 bits: not checked) | [C39] |
| H.264 4:4:4 GBR via FFmpeg | `AV_PIX_FMT_GBRP` maps to `PIXEL_FORMAT_I444` | `GBRP10LE` → YUV444P10 | `GBRP12LE` → YUV444P12 | — | S | [C39] |
| Windows D3D (hardware) | NV12 (or ARGB if a copy is needed and NV12 is not supported) | `DXGI_FORMAT_P010` → `PIXEL_FORMAT_P010LE` (or XB30/ARGB) | `DXGI_FORMAT_P016` takes the same branch as P010: → `P010LE`, XB30 or ARGB | — | S | [C40] |
| Android MediaCodec (hardware or OS software) | `VideoPixelFormat pixel_format = PIXEL_FORMAT_ABGR;` for every output (texture-backed, any bit depth) | same | same | — | S | [C41] |
| macOS VideoToolbox | pixel format read from the IOSurface (`IOSurfacePixelFormatToSharedImageFormat`) | — | — | — | S (mechanism), U (which CoreVideo formats Chromium requests: not found in the files read) | [C42] |
| Linux/ChromeOS VA-API/V4L2 | `VideoDecoderPipeline` with `MailboxVideoFrameConverter`, so output is a shared-image (texture) frame | — | — | — | S (mechanism), U (exact fourcc) | [C21] |

How `VideoFrame.format` and `copyTo()` treat those frames (`CopyToFormat` in `video_frame.cc`):

| rule | label | src |
|---|---|---|
| A frame neither CPU-mappable nor backed by a shared image has `format` `null` (`if (!(mappable \|\| texturable)) { return std::nullopt; }`), and `copyTo()` then throws "Operation is not supported when format is null." | S | [C43] |
| A frame with no CPU mapping and bit depth other than 8 has `format` `null`: "Readback is not supported for high bit-depth formats." | S | [C43] |
| A frame with no CPU mapping whose shared image prefers an external sampler reports `NV12`/`I420` if that is its format, otherwise `PIXEL_FORMAT_XRGB`, i.e. `"BGRX"` | S | [C43] |
| `IsFormatEnabled` does not list `PIXEL_FORMAT_P010LE`, and `ToV8VideoPixelFormat` has no P010 case | S | [C44] |
| So a Windows hardware 10-bit (or 12-bit) frame in P010LE always has `format === null`: CPU-mappable, it fails `IsFormatEnabled`; texture-only, it fails the 8-bit rule. Its samples reach script only through `copyTo({format: "RGBA"…})` or drawing, both 8-bit RGB | D | [C40][C43][C44] |
| An Android hardware frame (ABGR) reports `"RGBA"` or `"BGRX"`, never a YUV format. YUV samples are not readable on that path | D | [C41][C43] |
| `copyTo()` with an explicit `format` accepts only RGB targets: "copyTo() doesn't support explicit copy to non-RGB formats. Remove format parameter to use VideoFrame's pixel format." | S | [C45] |
| The `colorSpace` option of `copyTo()` accepts only `srgb` and `display-p3`: "This pixel conversion to this color space is not supported." | S | [C45] |
| Exact 10- and 12-bit samples in Chrome come only from the software paths (dav1d, libvpx, FFmpeg) with `copyTo()` and no `format` option. Use `hardwareAcceleration: "prefer-software"` to force them | D | rows above, [C30] |
| Whether `copyTo()` of a 8-bit NV12 hardware texture is bit-exact against the decoder output | U: no statement found in the source read or in Chrome docs | — |

### Limits

| limit | value / behaviour | label | src |
|---|---|---|---|
| largest dimension for any video | `kMaxDimension = (1 << 15) - 1;  // 32767` | S | [C46] |
| largest area | `kMaxCanvas = (1 << 29) - 1;  // 23170 x 23170`; dav1d is opened with `s.frame_size_limit = limits::kMaxCanvas;` | S | [C46][C35] |
| software decode threads | `kMaxVideoDecodeThreads = 16` | S | [C46] |
| macOS VideoToolbox coded size | H.264/VP9 `kLegacyMaxSize(4096, 4096)`; AV1/HEVC `kModernMaxSize(8192, 8192)` | S | [C23] |
| Windows minimum size | `kMinResolution(64, 64)`; NVIDIA VP9/AV1 128×128, HEVC 144×144; Qualcomm 96×96 | S | [C47] |
| `decodeQueueSize` | returns `num_pending_decodes_` | S | [C48] |
| back-pressure inside Chromium | requests wait while `pending_decodes_.size() + 1 > GetMaxDecodeRequests()`. The broker defaults to `1` until a decoder is selected | S | [C48][C49] |
| too many decoders | `kTooManyDecoders` closes the codec with `QuotaExceededError`: "Decoder initialization failed, too many decoders in use." After a flush: "…Close all pending frames and try again." | S | [C50] |
| reclaiming hardware codecs | only platform (hardware) decoders apply "codec pressure". A codec is reclaimed after `base::Seconds(90)` of inactivity, and only when pressure is exceeded **and** the page is backgrounded | S | [C51][C52] |
| pressure thresholds (per process) | Windows decoders `6`; ChromeOS `3`; macOS `24`; Android `4`; others `0` ("roughly 1/4th of the empirical lower limit at which we start getting errors") | S | [C53] |
| frames not closed | console error: "A VideoFrame was garbage collected without being closed. Applications should call close() on frames when done with them to prevent stalls." | S | [C54] |
| Android flush | the decoder is kept across `flush()` to work around "an issue with flushing on Android where the automatic call to Initialize() after Flush() destroys the codec; invalidating any unrendered output buffers" (crbug 474398415) | S | [C55] |
| Android `isConfigSupported` with `prefer-hardware` | answered from `MediaCodecVideoDecoder::GetSupportedConfigs()`, which lists H.264/HEVC entries even for OS software codecs. "Supported" therefore does not guarantee a hardware codec on Android | S (code), D (consequence) | [C24][C31] |
| MediaCodec instance count, GPU memory budget | U: no numeric limit found in the source read or in Chrome docs | — |
| WebView-specific WebCodecs differences | U: none found in source read. chromestatus lists webview 94 for WebCodecs [C9]. WASM threads differ (BCD `false`) [C8] | — |

### Workers, flags

| item | label | src |
|---|---|---|
| `VideoDecoder`, `VideoFrame`: `Exposed=(Window,DedicatedWorker), SecureContext` | S | [C56] |
| `ImageDecoder`: `Exposed=(Window,DedicatedWorker), SecureContext` | S | [C57] |
| "WebCodecs API is only available in secure contexts, so detection will fail if self.isSecureContext is false." | S | [C58] |
| MSE in a DedicatedWorker since 108 (chromestatus flag name `MediaSourceInWorkers`) | S | [C13][C6] |
| `MediaSourceExtensionsForWebCodecs`: `status: "experimental"` in `runtime_enabled_features.json5`; command line `--enable-blink-features=MediaSourceExtensionsForWebCodecs` | S | [C59][C14] |
| `--disable-accelerated-video-decode` (content switch; "used inside ChromeOS code to implement the DeviceHardwareVideoDecodingEnabled policy") | S | [C60] |
| Linux: `--enable-features=AcceleratedVideoDecoder` / `--disable-features=AcceleratedVideoDecoder` (feature name of `kAcceleratedVideoDecodeLinux`) | D (standard `base::Feature` switch syntax applied to the name in [C21]) | [C21] |
| Windows: `D3D12VideoDecoder` (disabled by default); Android: `AllowMediaCodecSoftwareDecoder` (disabled); all: `PlatformHEVCDecoderSupport` (enabled) | S (names and defaults as `BASE_FEATURE` declarations) | [C28][C22] |
| ImageDecoder decodes only Blink's built-in image formats. The decoder directories at this commit are `avif`, `bmp`, `gif`, `ico`, `jpeg`, `jxl`, `png`, `webp`, so there is **no JPEG 2000 / HTJ2K** (WASM is needed) | S (listing), D (no J2K) | [C61][C10] |

### 12-bit AV1: the key-frame check refuses it before dav1d

Added in integration, from the same pinned commit.

| claim | label | src |
|---|---|---|
| `decode()` classifies an AV1 key chunk by parsing it with libgav1's OBU parser; the chunk is key only if the parse returns `kStatusOk` and the frame is a key frame. | S | [X2] |
| Chromium builds libgav1 with `LIBGAV1_MAX_BITDEPTH=10`, and DEPS pins libgav1 at `4ad43370…`, whose parser returns `kStatusUnimplemented` for a sequence header deeper than that. | S | [X1] [X4] [X5] |
| A chunk marked key that is not classified key is refused: "A key frame is required after configure() or flush()." | S | [X3] |
| So a 12-bit AV1 stream is refused at its first key chunk, though dav1d is built for 16-bit and maps 12-bit to `I420P12` [C35] [C37]. The 12-bit `I420P12` row of §Output formats holds for VP9 (libvpx), not for AV1 through `decode()`. | D | [X1]–[X4], [C35] |
| The 10- and 12-bit planar formats are listed in `IsFormatEnabled` without a runtime flag at this commit. | S | [X6] |

### Open bugs

Issue tracker queries were run on 2026-11-10 with the tracker's own `status:open` / `status:closed` filters, so the
status column reflects which filter returned the issue. Queries: `status:open componentid:1457007 <term>` for
P010, "high bit depth", 10-bit, 12-bit, monochrome, copyTo, I420P10; plus unscoped `status:open WebCodecs …`.
"monochrome", "4:0:0", "I420P10" and "dav1d 12-bit" returned nothing relevant.

| id | title (as read) | status (by filter) | label | src |
|---|---|---|---|---|
| 570740224 | VideoDecoder.isConfigSupported() accepts VP9 codec strings whose bit depth or chroma subsampling contradicts the profile | open | S | [C62] |
| 524008896 | VideoPixelFormat I444AP12 is not recognized | open | S | [C62] |
| 422919705 | Incorrect chroma values in result of VideoFrame.copyTo() for uneven sized Video frames automation coverage needed for 409576884 | open | S | [C62] |
| 409576884 | Incorrect chroma values in result of VideoFrame.copyTo() for uneven sized Video frames | closed | S | [C62] |
| 40258906 | VideoDecoder shouldn't select the hardware decoder for interlaced content (or should support software fallback). | open | S | [C62] |
| 471204163 | Mobile Chrome: WebCodecs VideoDecoder fails ("Decoder Failure") when decoding AV1 DataChannel stream approaches ~60 FPS; no actionable error detail | open | S | [C62] |
| 425634684 | Make VideoFrame metadata match SharedImage metadata | open | S | [C62] |
| 343014700 | GBR Video support (cited at the D3D 4:2:2/4:4:4 output branch) | open | S | [C62][C63] |
| 40215121 | Implement HBD/HDR/WCG Decoding (cited at `ToOpaqueMediaPixelFormat` and the alpha readback TODO) | closed | S | [C62] |
| 40267195 | Add pixel format conversion to VideoFrame.copyTo() | closed | S | [C62] |
| 40225585 | WebCodecs VideoDecoder hardwareAcceleration "prefer-hardware" throws Unsupported configuration exception for certain video files | closed | S | [C62] |
| 474398415 | When decoding a video, the last few frames are missing. (Android flush workaround, see §Limits) | closed | S | [C62] |
| older ids in comments (1138680, 1214061, 1198324, 1311345, 897297, …) | not readable without signing in, or "does not exist" | — | U | [C63] |

### Performance and resource guidance (Chrome's own docs)

| guidance | label | src |
|---|---|---|
| Handle frames and chunks in a worker: "it is preferable to move handling of individual frames and encoded chunks into a web worker." | S | [C58] |
| `VideoFrame` is transferable: "VideoFrame itself is transferable and may be moved between workers." | S | [C58] |
| Close frames early: "Once a frame is no longer needed, call close() to release underlying memory before the garbage collector gets to it, this will reduce the average amount of memory used by the web application." | S | [C58] |
| Return quickly from the decoder `output` callback: "It's better to make sure that the decoder output callback (handleFrame()) quickly returns." | S | [C58] |
| Queue limit in the encoder sample: `if (encoder.encodeQueueSize > 2) {` drop the frame. The decode-side counterpart is `decodeQueueSize` plus the `dequeue` event (106) | S (sample), D (decode counterpart) | [C58][C2] |
| Debug in DevTools: "Use the Media Panel in Chrome DevTools to view media logs and debug WebCodecs." The panel shows the chosen decoder name and whether it is a platform decoder (`kVideoDecoderName`, `kIsPlatformVideoDecoder`) | S | [C58][C64] |
| Unclosed frames log a console error and can stall the decoder | S | [C54] |
| Inactive hardware decoders in background tabs can be reclaimed after 90 s, so be ready to re-create the decoder on `QuotaExceededError` | D | [C51][C52] |

## WebKit

This section covers Safari on macOS, iOS and iPadOS. Engine source is WebKit `main` pinned at commit
`5dbb0d4dcc9b3c87d4d457fabe6cfb62be40cb40` (committed 2026-11-09). Main can be ahead of the Safari that has
shipped, so a source claim says what WebKit does now, not what every Safari version did. Browser-compat-data (BCD)
is pinned at `918d2d721cc80c26c2eed7e64c6fa43da59322fd`. Release notes were read on 2026-11-10; the newest is
Safari 27.3 **beta**.

**Bottom line for this client.** In Safari, a WebCodecs `VideoDecoder` decodes AV1 only when the device has an AV1
hardware decoder (unless a hidden flag is turned on), and the software AV1 path accepts only 8-bit 4:2:0. A 10-bit
frame from any Safari decoder reports `format === null`. `copyTo()` on such a frame either rejects it or converts it to
8-bit RGB. No path outputs 12 bits. So on Safari, exact 10- and 12-bit samples come from dav1d-WASM, not from
WebCodecs (D: from K29–K44 below).

### All iOS browsers use WebKit, and the EU and Japan exceptions

| claim | label | src |
|---|---|---|
| App Store rule: apps that browse the web must use WebKit. An entitlement for another engine can be requested, and the rule points to the EU and Japan. | S | [K1] |
| EU: other engines are allowed in dedicated browser apps and in in-app browsing, through two entitlements, on iOS 17.4 or later and iPadOS 18 or later, for EU users only. | S | [K2] |
| EU: the app must be distributed only on iOS and/or iPadOS in the EU. | S | [K2] |
| Japan: other engines are allowed from iOS 26.2. In-app browsing is limited to "apps from browser engine stewards". | S | [K4] |
| BrowserEngineKit is available from iOS 17.4 and iPadOS 18.0. Apple's documentation lists exactly two regions, the European Union and Japan. In Japan the app must also adopt the `hardened-process.checked-allocations` entitlement. | S | [K3] |
| So outside the EU and Japan, every iOS and iPadOS browser (Chrome, Firefox, Edge included) runs WebKit, and this section applies to all of them. Inside those two regions, a browser that has the entitlement may ship another engine. | D | K1–K4 |
| Whether any non-WebKit browser actually ships on iOS in the EU or Japan today. | U | Apple's pages describe the entitlement only; no official list of shipped engines was found |

### Since which version

Columns are the BCD `safari` / `safari_ios` entries, verbatim. `"mirror"` means iOS takes the desktop value.

| feature | `safari` | `safari_ios` | label | src |
|---|---|---|---|---|
| `VideoDecoder` (and `configure`, `decode`, `flush`, `isConfigSupported`, …) | `{"version_added": "16.4"}` | `"mirror"` | S | [K5] |
| `VideoDecoder.configure` `flip` / `rotation` options | `{"version_added": false}` | `"mirror"` | S | [K5] |
| `VideoFrame` (and `copyTo`, `allocationSize`, `format`, `colorSpace`) | `{"version_added": "16.4"}` | `"mirror"` | S | [K6] |
| `VideoFrame.copyTo` `format` option (convert on copy) | `{"version_added": false}` | `"mirror"` | S | [K6] |
| `VideoFrame.metadata`, `flip`, `rotation` | `{"version_added": false}` | `"mirror"` | S | [K6] |
| `EncodedVideoChunk` | `{"version_added": "16.4"}` | `"mirror"` | S | [K7] |
| `ImageDecoder` (all members) | `{"version_added": "preview"}` | `"mirror"` | S | [K8] |
| `HTMLVideoElement.requestVideoFrameCallback` | `{"version_added": "15.4"}` | `"mirror"` | S | [K9] |
| `MediaCapabilities.decodingInfo` | `{"version_added": "13"}` | `"mirror"` | S | [K10] |
| `ManagedMediaSource` | `{"version_added": "17"}` | `{"version_added": "17.1"}` | S | [K11] |
| `MediaSource` | `{"version_added": "8"}` | `{"version_added": "13", "impl_url": "https://webkit.org/b/200147", "partial_implementation": true, "notes": "Exposed in Mobile Safari on iPad but not on iPhone."}` | S | [K12] |
| `MediaSource.worker_support` | `{"version_added": false}` | `"mirror"` | S | [K12] |
| `MediaSource.handle`, `canConstructInDedicatedWorker` | `{"version_added": "18"}` | `{"version_added": "18", … "partial_implementation": true, "notes": "Exposed in Mobile Safari on iPad but not on iPhone."}` | S | [K12] |

The release notes and webkit.org posts give the history. BCD has no row for which codecs `VideoDecoder` accepts.

| version | what shipped | label | src |
|---|---|---|---|
| 16.4 | WebCodecs, video only: "Added video-only support for Web Codecs." | S | [K13], [K22] |
| 16.4 | AVIF on macOS Monterey and Big Sur | S | [K21] |
| 16.5 | Lockdown Mode: "Disabled WebCodecs API" | S | [K14] |
| 17.0 | JPEG XL. Managed Media Source on macOS and iPadOS, and as a preview on iOS. AV1 in MediaCapabilities "for devices with hardware support". AV1 `<video>` playback only "on devices with hardware decoding support" | S | [K15], [K23] |
| 17.4 | WebCodecs HEVC. VP8/VP9 and WebM on iOS and iPadOS | S | [K16] |
| 17.5 | "Added support for WebCodecs AV1 when an AV1 hardware decoder is available." "Fixed WebCodecs to correctly use the VP9 hardware decoder." | S | [K17], [K25] |
| 18.0 | Managed Media Source and MSE in workers. This conflicts with BCD `MediaSource.worker_support: false` above, while BCD dates `handle` and `canConstructInDedicatedWorker` to 18 | S | [K26], [K12] |
| 26.0 | WebCodecs `AudioDecoder` and `AudioEncoder` | S | [K27] |
| 26.4 | "Fixed an issue where WebCodecs VideoDecoder could output H264 frames in the wrong order." | S | [K18] |
| 27.0 | A hardware `VideoDecoder`'s colour space can be overridden. Fixed B-frame output order | S | [K19], [K27] |
| 27.3 beta | "Added support for the WebCodecs ImageDecoder API." This matches BCD `"preview"` | S | [K20], [K8] |
| none | Release notes from 16.4 to 27.3 beta mention neither 10-bit nor high-bit-depth WebCodecs **decode** output. The only 10-bit item is an encoder fix in 27.3 beta | S | [K20] |

### Which decoder backs each codec

How a request is routed: `VideoDecoder` calls the creator hook that WebKit installs. That hook sends the codec to the
**GPU process** (VideoToolbox) unless `shouldUseLocalDecoder` says otherwise. A local decoder (libwebrtc's libvpx,
or dav1d) runs in the web content process.

| codec string | which decoder | label | src |
|---|---|---|---|
| `avc1.*` (H.264) | GPU process, VideoToolbox (`GPUVideoDecoderVTB`). The GPU process accepts at most High profile, level 5.2 | S | [K31], [K38], [K58] |
| `hev1.*` / `hvc1.*` (HEVC) | GPU process, VideoToolbox. Gated by `WebCodecsHEVCEnabled`, which is on for Cocoa | S | [K31], [K47], [K52] |
| `vp09.0*`, VP9 hardware present | GPU process, VideoToolbox. On **macOS**, `hardwareAcceleration: "prefer-software"` sends VP9 to libvpx instead | S | [K30], [K31], [K62] |
| `vp09.0*`, no VP9 hardware | libwebrtc `VP9Decoder`, which is `LibvpxVp9Decoder` (libvpx), in the web content process | S | [K31], [K29], [K34] |
| `vp8` | libwebrtc VP8 decoder (libvpx), local | S | [K29], [K34] |
| `av01.*`, AV1 hardware present (`VTIsHardwareDecodeSupported('av01')`) | GPU process, VideoToolbox | S | [K31], [K33] |
| `av01.*`, no AV1 hardware | dav1d through `createLibWebRTCDav1dDecoder()`, local | S | [K29], [K34] |
| WebCodecs accepts AV1 only with the prefix `av01.0` (AV1 Main profile, `seq_profile` 0). `av01.1` and `av01.2` fail `isConfigSupported` before any decoder is chosen | S | [K47] |
| `WebCodecsAV1Enabled` is off by default on Cocoa (`status: preview`). WebKit turns it on for every page once it learns that an AV1 hardware decoder exists | S | [K51], [K32] |
| So on a device with no AV1 hardware, the default Safari setting rejects `av01` in WebCodecs, and the dav1d path runs only when the Feature Flag is on (or in Safari Technology Preview, where `preview` features are on) | D | K51, K32, K56 |
| Apple names AV1 hardware decoding on iPhone 15 Pro. No official per-device list of Apple chips with AV1 or VP9 hardware decoding was found | S / U | [K23]; searched developer.apple.com and webkit.org |
| The VideoToolbox session sets `EnableHardwareAcceleratedVideoDecoder: @YES` (not `Require…`), so whether VideoToolbox may fall back to software is VideoToolbox's decision | S | [K39] |
| GStreamer ports (WebKitGTK, WPE) skip all of this: every codec goes to `GStreamerVideoDecoder` | S | [K29] |

### Output formats and bit depths per path

| path | decoder output (CVPixelBuffer) | `VideoFrame.format` | label | src |
|---|---|---|---|---|
| VideoToolbox, 8-bit | `kCVPixelFormatType_420YpCbCr8BiPlanar{Full,Video}Range` | `"NV12"` | S | [K40], [K42] |
| VideoToolbox, 10-bit | `kCVPixelFormatType_420YpCbCr10BiPlanar{Full,Video}Range` | `null`: this format has no case in `convertVideoFramePixelFormat` | S / D | [K40], [K42], [K43] |
| VideoToolbox, 12-bit | Not supported. The pixel-buffer code does `ASSERT(bitDepth == 8 \|\| bitDepth == 10)`. Bug 329242 is open: "GPU process crashes when VideoDecoder decodes 12-bit HEVC" | S | [K40], [K61] |
| libvpx VP8/VP9, 8-bit (I420/I422 from libvpx) | copied into an 8-bit **bi-planar** buffer | `"NV12"` (a 4:2:2 source is also stored as 4:2:0 NV12) | S / D | [K41], [K42] |
| libvpx VP9 profile 2, 10-bit (I010) | `kCVPixelFormatType_420YpCbCr10BiPlanar…` | `null` | S / D | [K41], [K42] |
| libvpx, more than 10 bits | rejected: `"VPx decoding of 12-bit content is not supported"` | n/a | S | [K35] |
| VP9 codec strings | `isConfigSupported` accepts profile 0 at 8-bit 4:2:0, and profile 2 at 10-bit 4:2:0 (`WebRTCVP9Profile2CodecEnabled`, on for Cocoa). It rejects profiles 1 and 3 | S | [K48], [K63] |
| dav1d AV1 software | `// Only accept I420 pixel format and 8 bit depth.` Any other picture returns `WEBRTC_VIDEO_CODEC_ERROR` | `"NV12"` for 8-bit 4:2:0; 10-bit, 12-bit, 4:2:2 and 4:4:4 give a decode error | S | [K36] |
| `ImageDecoder` (types accepted are those ImageIO decodes, via UTI [K60]) | Builds the frame from a `NativeImage` through `ImageTransferSessionVT::create(kCVPixelFormatType_32ARGB, false)` | `"RGBA"`/`"RGBX"` (8-bit) | S / D | [K45], [K42] |

What `copyTo()` does with these frames:

| claim | label | src |
|---|---|---|
| If `format` is `null` and no `options.format` is passed, `copyTo` and `allocationSize` throw `NotSupportedError` "No format is available" | S | [K44] |
| `options.format` can only be `RGBA`, `RGBX`, `BGRA` or `BGRX`. Anything else gives "Format is not supported" | S | [K44] |
| So a 10-bit decoded frame can be read back only as 8-bit RGB, converted by VideoToolbox. On Safari, WebCodecs cannot return exact 10-bit samples (no `I420P10` comes out of any decoder). BCD also marks the `copyTo` `format` option `false`, which conflicts with the source at the pinned commit | D | K42, K44, K6 |
| Building a `VideoFrame` from a buffer with `I420P10`/`I420P12`/… needs `WebCodecsHighBitDepthEnabled` (`status: testable`, default `false`). Even with it on, the constructor only builds `NV12`, `RGBA`, `RGBX`, `BGRA`, `BGRX`, `I420` and `I420A`; anything else throws "VideoPixelFormat is not supported" | S | [K46], [K53], [K59] |
| Bug 325753 "WebCodecs add support for > 8bits per channel video" is open | S | [K61] |
| GStreamer ports map `I420`, `I420A`, `I422`, `I444`, `NV12` and RGB formats, and no 10- or 12-bit format | S | [K64] |

### Limits, workers, flags

| claim | label | src |
|---|---|---|
| `VideoDecoder`, `VideoFrame` and `EncodedVideoChunk` are `Exposed=(Window,DedicatedWorker)` | S | [K49] |
| `ImageDecoder` is `Exposed=(Window,DedicatedWorker)` and `SecureContext` | S | [K50] |
| BCD has no `worker_support` row for these WebCodecs interfaces, so dedicated-worker support is sourced only from the engine IDL | S / U | [K5]–[K8] |
| `WebCodecsVideoEnabled` has `status: mature`. Default on Cocoa: `WebKit::defaultPeerConnectionEnabledAvailable()`. `disableInLockdownMode: true` | S | [K55] |
| `WebCodecsAV1Enabled` has `status: preview`, default `false` (on for GStreamer), `disableInLockdownMode: true` | S | [K51] |
| `WebCodecsHEVCEnabled` has `status: mature`, default `true` for Cocoa and GStreamer | S | [K52] |
| `WebCodecsHighBitDepthEnabled` ("Enable WebCodecs 10 and 12 bit video pixel formats") has `status: testable`, default `false` | S | [K53] |
| `WebCodecsImageEnabled` (ImageDecoder) has `status: stable`, default `true` | S | [K54] |
| Status legend: `preview` is "ON by default in Safari Technology Preview and test infrastructure. OFF by default elsewhere." `testable` is "OFF by default. Enabled in test infrastructure only." | S | [K56] |
| The flags can be toggled in macOS Safari's Feature Flags panel (from 17.0; it replaced Develop › Experimental Features). It needs Developer Features enabled | S | [K23] |
| Where the iOS/iPadOS Feature Flags setting lives | U | not found in Apple or webkit.org text read |
| `ENABLE_AV1` is defined for macOS, iOS, Mac Catalyst and visionOS | S | [K57] |
| dav1d runs with `n_threads = max(2, cores)` and `max_frame_delay = 1` | S | [K37] |
| Lockdown Mode disables WebCodecs | S | [K14], [K55] |
| Memory limits for web content on iOS/iPadOS (per tab, per frame pool) | U | no Apple document states one; searched developer.apple.com and webkit.org |
| MSE on iPhone: BCD says only on iPad, and Managed Media Source from iOS 17.1 | S | [K12], [K11] |

### Open bugs

Bugs.webkit.org REST `quicksearch`, which returns open bugs only, read 2026-11-10 [K61]. Picked for decoding,
formats, bit depth, AV1 and ImageDecoder. All are `NEW` unless marked. Every row is (S) [K61].

| id | summary (as read) | component |
|---|---|---|
| 325753 | WebCodecs add support for > 8bits per channel video | Media |
| 329242 | GPU process crashes when VideoDecoder decodes 12-bit HEVC | Media |
| 329244 | WebGL: On macOS Sequoia, software upload of AV1 VideoDecoder output leaves the texture unchanged | WebGL |
| 329235 | WebGL: Software upload of 10-bit video played through MediaSource is black | WebGL |
| 329245 | webgl/video-formats upload path tests fail where the platform cannot play the test video or decodes it to another pixel format | WebGL |
| 309518 | WebCodecs VideoDecoder reports incorrect VideoFrame.colorSpace for BT.2020/HLG (HDR) video | Media |
| 318440 | WebCodecs: AV1 isConfigSupported returns false in windows opened from another page | Media |
| 304668 | av1 not supported in webm containers, only in mp4 containers | Media |
| 275206 | [MediaCapabilities] No support for AV1 codecs. | Media |
| 262950 (REOPENED) | WebCodecs HEVC isSupported returns true but decoding failed | Media |
| 276152 | Webcodecs HEVC decoded result is different from Chrome / FFMPEG | Media |
| 297788 | VideoDecoder error when starting to decode an H.265 stream from a non-IDR CRA_NUT frame | Media |
| 329241 | HEVC video with alpha loses its alpha through MediaSource and VideoDecoder | Media |
| 325278 | VTB Decoders should set kVTDecompressionPropertyKey_RealTime when WebCodecsVideoDecoderConfig.optimizeForLatency is true | WebRTC |
| 258569 | WebCodecs decoders should be able to decode synchronously two frames with the same timestamp | Media |
| 246151 | Close WebCodecsVideo remote decoders in case of failure | Media |
| 317761 | ArrayBuffer-backed I420/I420A/NV12 VideoFrame ignores non-zero visibleRect origin and crops from the coded top-left | Media |
| 329786 | drawImage() and createImageBitmap() draw a VideoFrame whole, ignoring its visibleRect and the source rectangle | Canvas |
| 286959 | VideoFrameBufferInit.codedHeight ignored when visibleRect is present | Media |
| 293425 | WebCodecs VideoFrame constructor doesn't work with odd codedWidth/codedHeight | Media |
| 325800 | VideoFrame should allow its clients to get its pixel buffer asynchronously | WebRTC |
| 325914 | WebCodecs allows partial color spaces for video decoding/encoding | New Bugs |
| 329734 | [WebCodecs] Use rgb matrix for srgb colorspace | Media |
| 327666 | Add support for VideoDecoderConfig rotation and flip | Media |
| 321709 | WebCodecsImageDecoder should take a SharedArrayBuffer as an input | Images |
| 282299 | [HDR] Support HDR images | Images |

### Performance and resource guidance

| claim | label | src |
|---|---|---|
| Apple: hardware decoding "significantly impacts power usage and makes a battery last longer". From 17.4, `<video>` picks the best source rather than the first one it supports. "Video codecs with hardware decoding support on various Apple devices include VP9, h.264, HEVC and AV1." | S | [K24] |
| AV1 in Safari 17.0 is limited to hardware: "Hardware encoding/decoding provides an efficient way support the video codec without an undesired impact on battery life." | S | [K23] |
| Managed Media Source "can reduce power usage by telling the webpage when it's a good time to buffer more media data". MSE "was never made available on iPhones because we couldn't achieve with MSE the required battery savings." | S | [K28] |
| So for AV1 on iPhone or iPad without AV1 hardware, a WASM decoder (dav1d) is the only AV1 path open by default, and Apple's own guidance says software decoding costs battery | D | K24, K51, K32 |
| A WebCodecs-specific WWDC session or Apple performance guide | U | WWDC23–26 web session pages linked from webkit.org checked (10122, 2025/233, 2026/204, …); none covers WebCodecs |
| Throughput figures for Safari's WebCodecs or dav1d decode | U | none published by Apple or WebKit; not measured here |

## Gecko

Firefox desktop (Windows, macOS, Linux) and Firefox for Android. Engine source is pinned at
`mozilla-firefox/firefox@47f2a88cbab9072c8f8f156494b92d6891e488fb`, which is `main`, i.e. Nightly
(`browser/config/version.txt` reads `162.0a1`) [G69]. A pref whose default is `@IS_NIGHTLY_BUILD@` is **on in Nightly
only, off in Beta and Release**. Release notes were read for desktop and Android 130–160 and for MDN's developer
notes 65–161.

**Summary for this project.** Desktop Firefox has had WebCodecs `VideoDecoder` since 130. Firefox for Android does not
ship it. AV1 is decoded in software by dav1d, or in hardware where the OS offers it. Whether you get exact 10- or
12-bit planes back depends on how the frame comes back from the decoder process. A frame that comes back as a GPU
texture reports `BGRX`, and `copyTo` cannot return YUV planes from it (bug 1969762, open). A frame that comes back as
CPU planes reports `I420P10` or `I420P12` and copies out unchanged. Monochrome (4:0:0) AV1 is a gap: the fallback
dav1d wrapper drops those frames.

### Since which version

| claim | label | src |
|---|---|---|
| `VideoDecoder` and `EncodedVideoChunk` ship in desktop Firefox 130. Firefox for Android: not supported | (S) | [G1] [G2] |
| Release notes: WebCodecs on by default on desktop in 130; on Android it was then on in Nightly only | (S) | [G10] [G11] |
| WebCodecs video was first exposed in Nightly on Linux desktop in 123 | (S) | [G29] |
| At the pinned source, the Android release build still has WebCodecs off: `dom.media.webcodecs.enabled` is `@IS_NIGHTLY_BUILD@` under `MOZ_WIDGET_ANDROID` | (S) | [G30] |
| Even with the pref on, on Android `VideoDecoder.isConfigSupported()` answers false for every codec: `CanDecode` returns `false` when `IsOnAndroid()` | (S) | [G37] |
| Bug "Ship Web Codecs on Android" is open (NEW) | (S) | [G64] |
| No Firefox for Android release note from 130 to 160 mentions WebCodecs (searched for "WebCodecs", "Web Codecs") | (U) | — |
| `VideoFrame`: desktop 130. Android `"mirror"`, i.e. also 130, because `VideoFrame` is exposed when the WebCodecs pref **or** the image-decoder pref is on | (S) | [G3] [G33] |
| `VideoFrame` `flip`, `rotation` and `metadata` are not supported (the constructor's `metadata` option is tracked in bug 1802053) | (S) | [G3] |
| `ImageDecoder` ships in 133, on the main thread and in workers. Android `"mirror"`; its pref has no Android condition | (S) | [G4] [G12] [G13] [G30] |
| `requestVideoFrameCallback` ships in 132. In 130 it was on in Nightly only, behind `media.rvfc.enabled` | (S) | [G5] [G14] [G15] |
| `MediaCapabilities` since 63. Before 101, `decodingInfo()` ignored `av01` codec-string parameters | (S) | [G6] |
| `MediaSource`: desktop 42, Android 41. Not in workers (`worker_support`, `handle`, `canConstructInDedicatedWorker` are all `false`) | (S) | [G7] |
| AV1 video: Windows 65; macOS and Windows 66; Linux 67, where dav1d became the default AV1 decoder; Android 113, using hardware where the device has it | (S) | [G16] [G17] [G18] [G19] |
| AVIF images on by default in 93; animated AVIF in 113 | (S) | [G20] [G19] |
| HEVC playback: Windows hardware 134; macOS hardware 136; Linux hardware and software 137; Android hardware 137 | (S) | [G21] [G22] [G23] [G24] |
| HEVC in **WebCodecs** is Nightly-only and limited to macOS and Linux. Enabling it on Windows is bug 1942421, ASSIGNED | (S) | [G30] [G38] [G64] |
| JPEG XL: Rust decoder (jxl-rs) replaced the C++ one in 149, Nightly only; experimental via Firefox Labs in 152–153; on by default in 158 | (S) | [G26] [G25] [G27] |
| No Firefox for Android release note through 160 mentions JPEG XL | (U) | — |

### Which decoder backs each codec

How a WebCodecs decoder is chosen: `VideoDecoder` → `DecoderTemplate` → `DecoderAgent` → `PDMFactory::CreateDecoder`.
The factory tries its platform decoder modules (PDMs) in order. It takes the first one whose `Supports()` answer is
not empty and falls through to the next one if creation fails [G39] [G40] [G41]. In the content process the remote
GPU-process module comes first when `media.gpu-process-decoder` is on (Windows: on; Android: Nightly; others: off),
then the remote RDD (Remote Data Decoder) process [G42] [G31].

| claim | label | src |
|---|---|---|
| `hardwareAcceleration: "prefer-software"` becomes `CreateDecoderParams::Option::HardwareDecoderNotAllowed`. `"prefer-hardware"` gets no special handling: it is the same as `"no-preference"` | (S) | [G39] [G40] |
| With resist-fingerprinting (`MediaCapabilities` target) on, the hardware preference is reset to `No_preference` | (S) | [G72] |
| `optimizeForLatency: true` becomes `Option::LowLatency`. dav1d then runs with `max_frame_delay = 1` | (S) | [G39] [G40] [G54] |
| RDD process order: WMF (Windows) → Apple VideoToolbox (macOS) → bundled FFmpeg "FFVPX" → system FFmpeg (if built) → "Agnostic" (dav1d / libaom / libvpx) | (S) | [G43] |
| GPU process (Windows): FFVPX with hardware only (`media.ffvpx-hw.enabled`, Nightly on Windows), then WMF. FFmpeg software decoding is refused in the GPU process | (S) | [G44] [G31] [G48] |
| FFVPX is built with ffmpeg's `libdav1d` wrapper, VP8 and VP9, and with no H.264 or HEVC decoder (`CONFIG_H264_DECODER 0`, `CONFIG_HEVC_DECODER 0`) | (S) | [G46] |
| So software AV1 on desktop goes through FFVPX's `libdav1d` wrapper in the RDD process. Gecko's own `DAV1DDecoder` (Agnostic, last in order) is only a fallback | (D) | [G43] [G46] [G45]: FFVPX comes before Agnostic, and FFVPX contains `libdav1d` |
| Agnostic module: AV1 goes to dav1d when `media.av1.use-dav1d` is on (default on), otherwise to libaom; VP8/VP9 go to libvpx | (S) | [G45] [G31] |
| Linux hardware decoding goes through FFmpeg device types in this order: Vulkan (if built), then VA-API, then V4L2. H.264 and HEVC hardware decoding need the **system** FFmpeg, not FFVPX | (S) | [G47] |
| Windows hardware decoding goes through WMF/D3D11 (`media.wmf.dxva.d3d11.enabled` on). The AV1 MFT is used only with DXVA ("AV1 MFT requires DXVA"); AV1 also needs the AV1 extension ("Lacking of AV1 extension") | (S) | [G50] [G31] |
| macOS: VideoToolbox. AV1 there is hardware-only (Apple silicon, macOS 14+), 8- or 10-bit, Main profile, not RGB, and refused under `HardwareDecoderNotAllowed` | (S) | [G49] |
| Android: H.264 and HEVC are decoded only through MediaCodec, which may itself be software or hardware. Platform decoders must run in the GPU process unless it is disabled | (S) | [G70] [G71] |
| What happens on each OS when `prefer-software` meets a module that can only decode in hardware (for example WMF AV1 in the GPU process) was not traced end to end | (U) | looked in [G41] [G50] [G48] |

| codec (WebCodecs) | Windows | macOS | Linux | Android | label | src |
|---|---|---|---|---|---|---|
| AV1 `av01.*` | WMF hardware (DXVA + AV1 extension), else FFVPX/libdav1d | VideoToolbox hardware (Apple silicon, 14+), else FFVPX/libdav1d | FFVPX hardware (VA-API/Vulkan) or FFVPX/libdav1d | no WebCodecs | (D) | [G43] [G44] [G46] [G47] [G49] [G50] [G37]: module order plus each module's `Supports` |
| VP8 `vp8`, VP9 `vp09.*` | WMF (VP9) or FFVPX | VideoToolbox (VP9 hardware) or FFVPX | FFVPX | no WebCodecs | (D) | [G43] [G46] [G49] |
| H.264 `avc1`/`avc3` | WMF | VideoToolbox | system FFmpeg | no WebCodecs | (D) | [G43] [G46] [G47] |
| HEVC `hev1`/`hvc1` | not in WebCodecs (bug 1942421) | VideoToolbox, Nightly only | system FFmpeg, Nightly only | no WebCodecs | (S) | [G38] [G30] |
| Codec strings `av1…` or `vp9…` (not `av01`/`vp09`) | rejected | rejected | rejected | — | (S) | [G38] |

### Output formats and bit depths per path

The `VideoFrame.format` a decoded frame reports comes from `GuessVideoPixelFormat(image)`, which looks at the kind of
`layers::Image` the decoder handed back [G73] [G56].

| image kind and bit depth | `VideoFrame.format` | label | src |
|---|---|---|---|
| Planar YCbCr, 8-bit, 4:2:0 / 4:2:2 / 4:4:4 | `I420` / `I422` / `I444` (alpha: `I420A` …) | (S) | [G56] |
| Planar YCbCr, 10-bit | `I420P10` / `I422P10` / `I444P10` | (S) | [G56] |
| Planar YCbCr, 12-bit | `I420P12` / `I422P12` / `I444P12` | (S) | [G56] |
| Planar YCbCr, 16-bit (`COLOR_16`) | none: `format` is `null` and `copyTo` throws `NotSupportedError` | (S) | [G56] [G58] |
| Semi-planar (NV image) | `NV12` only for 8-bit 4:2:0 with no alpha; anything else (for example 10-bit P010) gives `null` | (S) | [G56] |
| `GPU_VIDEO`, a frame left in another process as a GPU texture | `BGRX` ("This process only reads a remote image back as RGB.") | (S) | [G56] |
| macOS IOSurface, Linux DMABUF | from the surface format: `YUV420`→`I420`, `YUV420P10`→`I420P10`, `YUV422P10`→`I422P10`, `NV12`→`NV12`, 8-bit RGB variants; other formats give `null` | (S) | [G56] |

| claim | label | src |
|---|---|---|
| The decoder process sends a frame back as a GPU texture when it can create one for the compositor. Otherwise it copies the planar YCbCr planes into shared memory | (S) | [G57] |
| WebCodecs passes the compositor (`ImageBridgeChild`) to the decoder, so the texture path is open to WebCodecs decodes | (S) | [G40] |
| So the same 10-bit AV1 stream can report `BGRX` (texture path, colour converted to 8-bit RGB) or `I420P10` (shared-memory path). Which path a given OS/GPU takes was not measured | (D) | [G56] [G57] [G40] |
| Open bug 1969762: "VideoFrame.format reports BGRX for remote-decoded frames and copyTo cannot return YUV planes (Chrome returns I420)" (ASSIGNED) | (S) | [G64] |
| Fixed bug 2071132: "VideoFrame.format reports I420 for 10-bit planar frames …". In the release where 10-bit frames first reported `I420P10`, check `format` before reading samples; that release number was not found | (S) | [G64] |
| Planar YCbCr `copyTo` is a plane-by-plane copy of `SampleBytes` per sample (1 byte at 8-bit, 2 at 10/12-bit). No value conversion | (S) | [G59] |
| `copyTo({format})` accepts only `RGBA`, `RGBX`, `BGRA`, `BGRX` ("… is unsupported in ParseVideoFrameCopyToOptions"). YUV→RGB conversion happens; YUV→other-YUV and RGB→YUV do not ("The conversion between RGB and non-RGB is unsupported") | (S) | [G58] [G60] |
| `copyTo` colour space defaults to `srgb` when not given | (S) | [G58] |
| dav1d's high bit depth maps directly: `b.mColorDepth = gfx::ColorDepthForBitDepth(aPicture.p.bpc)`. It is narrowed to 8-bit only when `Output8BitPerChannel` is requested | (S) | [G53] |
| FFVPX narrows to 8-bit only when `Output8BitPerChannel` is set, and only for `libdav1d` or `vp9` | (S) | [G51] |
| `DecoderAgent` never sets `Output8BitPerChannel`, so WebCodecs is not narrowed to 8-bit on the CPU-plane path | (D) | [G40]: its option set is `HardwareDecoderNotAllowed`/`Default`, `LowLatency`, `KeepOriginalPts` only |
| FFmpeg path maps `YUV4xxP10LE` → `COLOR_10` and `YUV4xxP12LE` → `COLOR_12` | (S) | [G52] |
| Monochrome AV1 in Gecko's `DAV1DDecoder` (the Agnostic fallback): I400 pictures are **skipped** ("I400 picture: No chroma data to construct an image") and produce no frame | (S) | [G53] |
| Monochrome AV1 through FFVPX: the `libdav1d` wrapper emits `AV_PIX_FMT_GRAY8/10/12`. `FFmpegVideoDecoder::GetColorDepth` has no `GRAY` case and hits `MOZ_ASSERT_UNREACHABLE("Not supported format?")` | (S) | [G55] [G52] |
| The result for monochrome AV1 through FFVPX (error, wrong frame, or working) was not found in source or bugs (searched Bugzilla for "monochrome av1", "I400", "grayscale av1") | (U) | — |
| `ImageDecoder` frames are imagelib surfaces wrapped as `SourceSurfaceImage`; the AVIF decoder converts to `B8G8R8A8`/`B8G8R8X8`. So `ImageDecoder` output is 8-bit RGB, whatever the bit depth of the source | (D) | [G61]: surface → `SurfaceFormatToPixelFormat` [G56]; AVIF writes BGRA/BGRX |
| `ImageDecoder.isTypeSupported` answers from imagelib's MIME table (PNG, APNG, GIF, JPEG, BMP, ICO, WebP, AVIF; JXL only while `image.jxl.enabled` is on). JPEG 2000 and HTJ2K are not in it | (S) | [G62] |

### Limits, workers, flags

| pref (`StaticPrefList.yaml`) | default at pin | effect | label | src |
|---|---|---|---|---|
| `dom.media.webcodecs.enabled` | `true`; on Android `@IS_NIGHTLY_BUILD@` | exposes the WebCodecs codec interfaces | (S) | [G30] [G36] |
| `dom.media.webcodecs.image-decoder.enabled` | `true` | exposes `ImageDecoder` (and `VideoFrame`) | (S) | [G30] [G33] |
| `dom.media.webcodecs.h265.enabled` | `@IS_NIGHTLY_BUILD@` | HEVC in WebCodecs (macOS, Linux only) | (S) | [G30] [G38] |
| `media.av1.enabled` / `media.av1.use-dav1d` | `true` / `true` | AV1 at all / dav1d rather than libaom in the Agnostic module | (S) | [G31] |
| `media.av1.force-thread-count` | `0` | `> 0` overrides dav1d's thread count | (S) | [G31] [G54] |
| `media.hevc.enabled` | `true` | HEVC in every module (there is no `media.wmf.hevc.enabled` in the file) | (S) | [G31] |
| `media.hardware-video-decoding.enabled` | `true` (`mirror: once`, read at startup) | hardware video decoding | (S) | [G31] |
| `media.hardware-video-decoding-vulkan.enabled` | `@IS_NIGHTLY_BUILD@` | Vulkan video decode on Linux | (S) | [G31] |
| `media.ffvpx-hw.enabled` | GTK `true`; Windows and Android `@IS_NIGHTLY_BUILD@`; else `false` | hardware decoding through FFVPX | (S) | [G31] |
| `media.gpu-process-decoder` | Windows `true`; Android `@IS_NIGHTLY_BUILD@`; else `false` | decode in the GPU process | (S) | [G31] |
| `media.wmf.av1.enabled`, `media.wmf.vp9.enabled`, `media.wmf.dxva.d3d11.enabled` | `true` | WMF codecs and D3D11 hardware decoding | (S) | [G31] |
| `media.wmf.force.allow-p010-format` | `false` | P010 output from WMF | (S) | [G31] |
| `media.android-media-codec.enabled` / `.preferred` | `@IS_NOT_NIGHTLY_BUILD@` | MediaCodec PDM on Android | (S) | [G31] |
| `image.avif.use-dav1d` | `true` | AVIF images through dav1d (else libaom). There is no `image.avif.enabled` in the file | (S) | [G32] |
| `image.jxl.enabled` | `true` under `#ifdef MOZ_JXL`; `MOZ_JXL` is on unless built with `--disable-jxl`; Firefox Labs feature `jpeg-xl` sets the user pref | JPEG XL in imagelib and in `ImageDecoder` | (S) | [G32] [G68] [G67] [G62] |
| `media.rvfc.enabled` | not in the file at the pin | named in the 130 notes only | (S) | [G15] [G31] |

| claim | label | src |
|---|---|---|
| `VideoDecoder` is `[Exposed=(Window,DedicatedWorker), SecureContext]`: it needs HTTPS, works in dedicated workers, and is not exposed in shared or service workers | (S) | [G34] |
| `ImageDecoder`, `ImageTrack` and `ImageTrackList` are `[Exposed=(Window,DedicatedWorker), SecureContext]` | (S) | [G35] |
| `VideoFrame` is `[Exposed=(Window,DedicatedWorker)]` with no `SecureContext` | (S) | [G34] |
| With resist-fingerprinting on for WebCodecs, the WebCodecs interfaces are hidden | (S) | [G36] |
| dav1d threads (Agnostic path): 2, or 4 at a display width of 1024 or more, or 8 at 2048 or more, capped at the core count | (S) | [G54] |
| A maximum decode size or concurrent-decoder limit specific to WebCodecs was not found (searched `dom/media/webcodecs/` and the prefs file) | (U) | — |
| WMF hardware video has a cap: `media.wmf.dxva.max-videos` = `8` | (S) | [G31] |

### Open bugs

Read from bugzilla.mozilla.org on 2026-11-10. The Web Codecs component had 135 open bugs [G63]; the ones that bear on
exact high-bit-depth decoding are listed here.

| id | summary (verbatim) | status | label | src |
|---|---|---|---|---|
| 1969762 | VideoFrame.format reports BGRX for remote-decoded frames and copyTo cannot return YUV planes (Chrome returns I420) | ASSIGNED | (S) | [G64] |
| 1934008 | Ship Web Codecs on Android | NEW | (S) | [G64] |
| 1942421 | Enable H265 Decoder on Windows for WebCodecs | ASSIGNED | (S) | [G64] |
| 1999168 | [Windows] VideoDecoder.isConfigSupported() return false for 'hev1.1.6.L123.00' but about:support indicates HEVC hardware decoding is available | NEW | (S) | [G63] |
| 2021505 | Check bit depth for codec | NEW | (S) | [G64] |
| 1968022 | Implement proper VideoDecoder.isConfigSupport w/ hardware support check | ASSIGNED | (S) | [G63] |
| 1932392 | VideoDecoder.isConfigSupported() incorrectly reports true | UNCONFIRMED | (S) | [G63] |
| 1915307 | HTMLMediaElement.canPlayType and MediaSource.isTypeSupported incorrectly reports AV1 12-bit HDR profiles as supported | UNCONFIRMED | (S) | [G63] |
| 1779655 / 1779656 | Support I422 format for VideoFrame / Support I444 format for VideoFrame | NEW | (S) | [G63] |
| 1909373 | Improve VideoFrame.copyTo performance | NEW | (S) | [G63] |
| 1780656 | `VideoFrame::CopyTo` can do copy in thread pool | NEW | (S) | [G63] |
| 2068332 | Support odd-sized subsampled VideoFrames in allocationSize() and copyTo() | NEW | (S) | [G63] |
| 2089535 | Remove the size alignment check from VideoFrame.copyTo | NEW | (S) | [G63] |
| 2073730 | VideoDecoder cannot report a decoded frame that fails to become a VideoFrame and dereferences a null image after a failed remote transfer | NEW | (S) | [G63] |
| 2052255 | Predict VideoFrame pathways for remote decoding/encoding | NEW | (S) | [G63] |
| 2081675 | Drawing software-decoded 4K VideoFrames with WebGL halves the page frame rate (60 → 30 fps) on Linux | NEW | (S) | [G63] |
| 1966024 | Only allow an explicit list of image formats in ImageDecoder | ASSIGNED | (S) | [G63] |
| 1929528 | ImageDecoder.decode from WebCodecs API doesn't support progressive JPEG | ASSIGNED | (S) | [G63] |
| 1539075 | Implement support for JPEG XL (image/jxl): the JPEG XL umbrella bug, RESOLVED FIXED (so it is not open) | RESOLVED FIXED | (S) | [G64] |
| — | No open bug found for monochrome/I400 AV1 output (searches above) | — | (U) | — |

### Performance and resource guidance

| claim | label | src |
|---|---|---|
| MDN: WebCodecs decodes "efficiently (using hardware acceleration)"; `hardwareAcceleration` is only "A hint" | (S) | [G65] |
| Hardware video decoding is on for AMD GPUs on Linux since 136. Zero-copy playback of hardware-decoded video on AMD since 147, at parity with Intel and NVIDIA | (S) | [G22] [G66] |
| In Gecko, `"prefer-hardware"` does not force hardware (see above). To get CPU planes, `"prefer-software"` is the only lever a page has | (D) | [G39] [G40] |
| Rough performance numbers for Firefox WebCodecs decoding were not found in Mozilla's docs. firefox-source-docs `media/` holds only a MediaFormatReader page; support.mozilla.org returned a bot-check page | (U) | — |
| Open performance bugs exist for copyTo and for a slow WebCodecs demo with "continuous readback on MediaSupervisor thread" (1926801) | (S) | [G63] |

## ImageDecoder and image formats

**Bottom line for exact 10/12/16-bit samples.** The only route found that hands a page integer samples above 8 bits
from a browser-native image decoder is Chromium's `ImageDecoder` on a 10- or 12-bit **colour** AVIF that is still,
has no alpha and is not 4:0:0. That AVIF arrives as an `I4xxP10`/`P12` `VideoFrame` and `copyTo()` gives the
samples. Monochrome AVIF (which is what most medical greyscale would be), 16-bit PNG, JPEG XL, and every format in
Gecko all come out at 8 bits. Canvas gives at most `float16`, and float16 cannot hold all 4096 12-bit levels. No
engine decodes JPEG 2000 or HTJ2K. Exact medical samples therefore need a WASM decoder (see the Wasm section below).

### ImageDecoder API (WebCodecs §10)

The ImageDecoder section is the same in the Editor's Draft and in the W3C Working Draft of 9 November 2026 (D: diffed
§10 of both texts on 2026-11-10 and found no difference [I1]).

| claim | label | src |
|---|---|---|
| `ImageDecoder` exists in Window and dedicated workers, secure contexts only. | S | [I2] |
| Members: `type`, `complete`, `completed` (a Promise), `tracks`, `decode(options)`, `reset()`, `close()`, static `isTypeSupported(type)`. | S | [I2] |
| `ImageDecoderInit`: `type` and `data` are required. `data` is a BufferSource **or a `ReadableStream`**. The optional members are `colorSpaceConversion` (default `"default"`), `desiredWidth`/`desiredHeight`, `preferAnimation` and `transfer`. | S | [I3] |
| `desiredWidth` and `desiredHeight` must be given together, or the init is invalid (TypeError). Resizing is best effort. | S | [I4] [I5] |
| `colorSpaceConversion` has the same meaning as in `ImageBitmapOptions`, which is "converted or ignored". It does not choose a bit depth. | S | [I6] |
| `preferAnimation` steers which track is selected first in a multi-track file. | S | [I7] |
| `transfer`: if `data`'s ArrayBuffer is listed, the UA may use the bytes without copying them, and the buffer is detached afterwards. | S | [I8] |
| With a `ReadableStream`, `complete` stays false until the stream closes. `completed` resolves at that point. | S | [I9] |
| `tracks` is a live `ImageTrackList`. Each `ImageTrack` exposes `animated`, `frameCount`, `repetitionCount` and a settable `selected`. | S | [I10] |
| `isTypeSupported` only asks whether the UA "can provide a codec". The spec requires no format. | S | [I11] |
| `decode({frameIndex, completeFramesOnly})` resolves to `ImageDecodeResult {image: VideoFrame, complete}`. Setting `completeFramesOnly:false` lets a progressive image resolve early with less detail. | S | [I12] [I13] |
| **The output pixel format is whatever the decoder emits.** If that is a recognised `VideoPixelFormat` the frame carries it, otherwise `format` is `null`. The spec never names a format for an image. | S | [I14] |
| Every `VideoPixelFormat` with more than 8 bits is YUV (`I420P10`…`I444AP12`), stored as 16-bit little-endian integers. The RGB formats (`RGBA`, `RGBX`, `BGRA`, `BGRX`) are 8 bits per sample. There is no greyscale format and no high-bit-depth RGB format. | S | [I15] [I16] |
| A 16-bit or greyscale image can therefore reach a `VideoFrame` only as YUV P10/P12, as 8-bit RGB, or as `format: null`. | D | from [I14]–[I16] |
| `copyTo({format})` converts only to `RGBA`/`RGBX`/`BGRA`/`BGRX`. Any other target gives NotSupportedError. A `null`-format frame can be read only through that 8-bit RGB conversion. | S | [I17] |

`ImageDecoder` support, as browser-compat-data `api/ImageDecoder.json` gives it:

| engine | version | label | src |
|---|---|---|---|
| Chromium | `"chrome": { "version_added": "94" }` | S | [I18] |
| Gecko | `"firefox": { "version_added": "133" }`. The `dom.media.webcodecs.image-decoder.enabled` pref defaults to true at the pinned source. | S | [I18] [I19] |
| WebKit | `"safari": { "version_added": "preview" }`. At the pinned WebKit `main`, the `WebCodecsImageEnabled` preference is `status: stable`, `default: true`. | S | [I18] [I20] |

### Format support per engine

The `<img>` column comes from browser-compat-data `mediatypes/image/*.json`. `createImageBitmap` takes an image element
or Blob and goes through the same engine decoders (D: the engine decoder sources below are shared code; no per-format
`createImageBitmap` data exists in BCD). The `ImageDecoder` column is derived from engine source: both Chromium and
Gecko create the WebCodecs decoder through the same factory that `<img>` uses [I31] [I44] [I51].

| format | Chromium `<img>` | WebKit `<img>` | Gecko `<img>` | via `ImageDecoder` | label | src |
|---|---|---|---|---|---|---|
| AVIF (8/10/12-bit) | 85 | 16.4 (16.1 partial: macOS Ventura only) | 93 (animation 113) | Chromium, Gecko: yes. WebKit: in the MIME list where `HAVE(AVIF) \|\| USE(AVIF)` | S | [I21] [I25] [I31] [I35] [I44] |
| JPEG XL | 155: jxl-rs decoder, `kJXLImageFormat` enabled by default | 17 (no animation, no progressive) | 158: `--disable-jxl` is opt-out, `image.jxl.enabled` defaults to true | Chromium, Gecko: yes (same factory, same gate). WebKit: in the MIME list where `HAVE(JPEGXL) \|\| USE(JPEGXL)` | S | [I22] [I24] [I26] [I29] [I30] [I31] [I32] [I33] [I34] [I35] |
| WebP | 17 | 14 | 65 | yes in all three (same factories) | S / D | [I23] [I31] [I35] [I51] |
| PNG (16-bit) | 1 | 1 | 1 | yes, but at 8 bits (see the next table) | S | [I27] |
| JPEG 2000 (`.jp2`/`.j2k`) | no | **removed in Safari 18** | no | no | S (WebKit) / D (Chromium, Gecko: no JPEG 2000 branch in either decoder factory) | [I28] [I31] [I34] |
| HTJ2K (JPEG 2000 Part 15) | no | no | no | no | D: follows from the JPEG 2000 row; BCD and MDN have no entry for it | [I28] [I31] [I34] |

* JPEG XL in Chromium: chromestatus lists the feature as "in Blink using jxl-rs" with `"desktop": 155` (S [I29]). It
  was removed in 2022 (Chrome 110), which this pass did not check against an official source (U).
* MDN's image-format guide matches BCD for JPEG XL ("Chrome 155, Firefox 158, and Safari 17") and has no JPEG 2000
  entry (S [I24]).
* BCD has no `image/jp2` or `image/jxs` file at the pinned commit (D: listing of `mediatypes/image/`, [I21]).

### What bit depth reaches the page

| route | Chromium | WebKit | Gecko | label | src |
|---|---|---|---|---|---|
| `<img>` → 2D canvas → `getImageData()` (default) | 8-bit `Uint8ClampedArray` (`"rgba-unorm8"`) | same | same | S | [I36] |
| `getImageData(..., {pixelFormat:"rgba-float16"})` on a `colorType:"float16"` canvas | 137 (BCD marks it `experimental`) | not supported | not supported (`impl_url` bug 1958830) | S | [I37] [I38] [I39] |
| Can float16 hold exact 12- or 16-bit integers? | No for normalised 12-bit: binary16 values just below 1.0 are 2⁻¹¹ apart, wider than the 1/4095 step of 12-bit data | — | — | D: binary16 from [I40]; 1.0009765625 = 1 + 2⁻¹⁰ is the next value after 1, so the spacing below 1 is 2⁻¹¹ |  [I37] [I40] |
| `createImageBitmap` options | `ImageBitmapOptions` has orientation, premultiply, `colorSpaceConversion` and resize, but **no bit-depth or pixel-format option** | same | same | S | [I41] |
| `ImageDecoder`, 10/12-bit AVIF, colour, still, no alpha | `I420P10`/`P12` (or 422/444) with **unscaled** 16-bit containers, so the exact samples come through `copyTo()` | U (VideoFrame built from a `NativeImage`, whose format is not stated) | 8-bit: AVIF is converted with `ConvertYCbCrToRGB32` into `OS_RGBX`/`B8G8R8A8` | S (Chromium, Gecko), U (WebKit) | [I42] [I43] [I45] [I46] [I47] |
| `ImageDecoder`, AVIF that is monochrome (4:0:0), has alpha, is animated, or needs a colour transform | 8-bit RGB: the YUV path is skipped and the RGB path decodes with `kDefaultBitDepth` (uint8) | U | 8-bit | S / D | [I42] [I43] [I44] [I45] |
| `ImageDecoder`, 16-bit PNG | 8-bit (`kDefaultBitDepth`; PNG has no YUV path) | U | 8-bit (`png_set_scale_16`) | S (Gecko), D (Chromium) | [I42] [I43] [I48] |
| `ImageDecoder`, JPEG XL > 8-bit | 8-bit (`kDefaultBitDepth`. The decoder goes to half float only when asked for `kHighBitDepthToHalfFloat`) | U | 8-bit (HDR is converted to u8 rows) | S | [I42] [I43] [I49] [I50] |
| Any route giving **12- or 16-bit integer samples of a greyscale image** to the page | none found | none found | none found | D: from every row above | — |

## Media Capabilities decodingInfo

Working Draft and Editor's Draft, both 9 November 2026; their normative text is the same (D: text diff of [F100]
and [F101] differs only in the table of contents and reference dates).

### What the answer means

| field | definition (verbatim) | label | src |
|---|---|---|---|
| `supported` | set true once the video and audio MIME types pass "check MIME type support" (and, with a key system, once access is granted) | S | [F102] |
| `smooth` | "If the user agent is able to decode the media represented by configuration at the indicated framerate without dropping frames, set smooth to true. Otherwise set it to false." | S | [F102] |
| `powerEfficient` | "If the user agent is able to decode the media represented by configuration in a power efficient manner, set powerEfficient to true." | S | [F102] |
| power efficient | "Encoding or decoding is considered power efficient when the power draw is optimal. The definition of optimal power draw for encoding or decoding is left to the user agent." | S | [F103] |
| `powerEfficient` is **not** "hardware" | "User agents SHOULD NOT mark hardware encoding or decoding as power efficient by default, as non-hardware-accelerated codecs can be just as efficient, particularly with low-resolution video." | S | [F103] |
| `keySystemAccess` | a `MediaKeySystemAccess` when an encrypted configuration is supported, else null | S | [F104] |

### `MediaDecodingConfiguration`

| member | rule | label | src |
|---|---|---|---|
| `type` (required) | `file` (playback of sources other than MSE and `RTCPeerConnection`), `media-source`, `webrtc` | S | [F105] |
| no `webcodecs` type | the enum has exactly the three values above in both TR and ED; "This specification supports MediaDecodingType values of file, media-source or webrtc". For WebCodecs, `VideoDecoder.isConfigSupported()` is the query (see §WebCodecs). | S | [F105] [F106] |
| `video.contentType` (required) | "the MIME type of the video track"; a container type that allows several codecs needs exactly one codec in `codecs` | S | [F107] [F108] |
| `video.width` / `height` (required) | "the visible horizontal and vertical encoded pixels in the encoded video frames" | S | [F107] |
| `video.bitrate` (required) | bits per second; average for CBR, maximum for VBR | S | [F107] |
| `video.framerate` (required) | frames per second, finite and > 0; maximum for variable frame rate | S | [F107] |
| `hasAlphaChannel` | whether decoding yields per-pixel alpha | S | [F107] |
| `hdrMetadataType` | `smpteSt2086`, `smpteSt2094-10`, `smpteSt2094-40`; only for `media-source` and `file` | S | [F109] |
| `colorGamut` | `srgb`, `p3`, `rec2020`; only for `media-source` and `file` | S | [F109] |
| `transferFunction` | `srgb`, `pq`, `hlg`; only for `media-source` and `file` | S | [F109] |
| `scalabilityMode` | only for `MediaEncodingConfiguration` of type `webrtc` — giving it to `decodingInfo` makes the configuration invalid | S | [F110] |
| `spatialScalability` | decoder can use frames of other resolutions as references; default false; for `media-source`, `file`, `webrtc` | S | [F110] |
| `keySystemConfiguration` | `keySystem`, `initDataType`, `distinctiveIdentifier`, `persistentState`, `sessionTypes`, `audio`/`video` `{robustness, encryptionScheme}`; only with `media-source` or `file` | S | [F111] |
| A member given for a type it does not apply to makes the configuration invalid, and `decodingInfo()` rejects with `TypeError`. | S | [F110] [F112] |
| There is no bit-depth or chroma-format member: 10/12-bit or 4:4:4 can be asked only through the profile/level in the `codecs` string (D: member list [F107]). | D | [F107] |
| `decodingInfo()` is on `Navigator` and `WorkerNavigator`; with a `keySystemConfiguration` it rejects in workers (`InvalidStateError`) and in insecure contexts (`SecurityError`). | S | [F112] [F113] |

### Privacy

| claim | label | src |
|---|---|---|
| The spec "provides easier access to some information that can be used to fingerprint users"; the entropy is expected to be small because device classes share capabilities. | S | [F114] |
| `colorGamut`, `transferFunction` and `hdrMetadataType` "have the potential to add significant entropy". | S | [F114] |
| Suggested mitigations: fake a fixed capability set, limit to top-level browsing contexts, a privacy budget that throttles calls. So answers may be deliberately coarse (D). | S | [F114] |

## The `<video>` and MSE route

### What the element shows

| claim | label | src |
|---|---|---|
| While playing, the element "represents the frame of video at the continuously increasing "current" position"; when the position moves past the last rendered frame, "the new frame must be rendered". | S | [F120] |
| "Which frame in a video stream corresponds to a particular playback position is defined by the video stream's format." | S | [F120] |
| "when the playback rate is not exactly 1.0, hardware, software, or format limitations can cause video frames to be dropped". | S | [F121] |
| Video is drawn letterboxed into the playback area, aspect ratio preserved: scaled to the element's size, not shown at sample resolution (D: scaled to "the largest possible size that fits"). | S | [F122] |
| HTML says nothing about bit depth, colour conversion or scaling filter of the rendered video. Searched [F120]'s page for "bit", "color space", "colour", "filter": no requirement found. | U | [F120] |
| `drawImage(video)` uses "the frame at the current playback position", sized to the natural size "after any aspect-ratio correction". | S | [F123] |

### Media Source Extensions

| claim | label | src |
|---|---|---|
| `MediaSource` and `ManagedMediaSource` are `[Exposed=(Window,DedicatedWorker)]`; `MediaSource.canConstructInDedicatedWorker` "Returns true". | S | [F124] |
| A worker-built `MediaSource` attaches only through its `handle`: transfer the `MediaSourceHandle` to the Window and assign it to the element's `srcObject`. The element and its rendering stay on the Window (D). | S | [F125] |
| `ManagedMediaSource` "is a MediaSource that actively manages its memory content": the UA can evict buffered content "for any reason". | S | [F126] |
| browser-compat-data: `MediaSource.handle` — Chrome 108, Firefox not supported, Safari 18; `ManagedMediaSource` — Safari 17 (iOS 17.1), Chrome and Firefox not supported. | S | [F127] [F128] |
| MSE takes encoded byte streams and has no API returning decoded frames; decoded pixels reach script only through the `<video>` element, `requestVideoFrameCallback` + `new VideoFrame(video)` or `drawImage` (D: interface list of [F124]). | D | [F124] |
| Dropped-frame counting (`getVideoPlaybackQuality`) has left MSE for the Media Playback Quality spec. | S | [F129] |

### `requestVideoFrameCallback`

Status: "Draft Community Group Report, 2 August 2024"; "It is not a W3C Standard nor is it on the W3C Standards
Track" [F130]. browser-compat-data: Chrome 83, Firefox 132, Safari 15.4 [F131].

| `VideoFrameCallbackMetadata` field | meaning | label | src |
|---|---|---|---|
| `presentationTime` | when the UA submitted the frame for composition | S | [F132] |
| `expectedDisplayTime` | when the UA expects the frame to be visible | S | [F132] |
| `width` / `height` | frame size in media pixels ("visible decoded pixels, without pixel aspect ratio adjustments") | S | [F132] |
| `mediaTime` | PTS in seconds of the presented frame; may be 0 for live / WebRTC | S | [F132] |
| `presentedFrames` | count of frames submitted for composition; "MUST be monotonically increasing"; a gap means missed callbacks | S | [F132] |
| `processingDuration` (optional) | seconds from submitting the encoded packet to the decoder until the frame was ready; may include YUV conversion and GPU staging | S | [F132] |
| `captureTime`, `receiveTime`, `rtpTimestamp` (optional) | WebRTC / `getUserMedia` sources only | S | [F132] |

| claim | label | src |
|---|---|---|
| Callbacks are best effort: "a callback can occasionally be fired one v-sync late", and under main-thread load "we might not get a callback for every frame". | S | [F133] |
| The callback rate is the lesser of video rate and display rate: a 120 fps video on a 60 Hz display fires at 60 Hz. | S | [F134] |
| "There are no strict timing guarantees when it comes to how soon callbacks are run after a new video frame has been presented." | S | [F134] |

### `new VideoFrame(video)`

| claim | label | src |
|---|---|---|
| It takes "the VideoFrame at the current playback position", sharing its media resource and metadata. | S | [F59] [F52] |
| It throws `InvalidStateError` when `networkState` is `NETWORK_EMPTY`, or when `readyState` is `HAVE_NOTHING` / `HAVE_METADATA` (the usability check). | S | [F59] [F135] |
| Its `format` is whatever the UA's pipeline holds; null if that layout is not a `VideoPixelFormat`, which blocks raw `copyTo()` (D: [F6], [F5]). | D | [F6] [F5] |

### Why `<video>` pixels are not exact

| reason | label | src |
|---|---|---|
| Presentation follows the clock, not the decode: frames may be dropped and rVFC may skip frames, so there is no guarantee to see every decoded frame. | S | [F121] [F133] |
| The frame captured is the one at the current position when called, not a frame you chose by index (D: [F59], [F120]). | D | [F59] [F120] |
| The UA may scale, letterbox and colour-convert for display, and HTML defines neither depth nor conversion (D: [F122], U row above). | D | [F122] |
| Any route onward from the captured frame (canvas, WebGL, WebGPU) adds the conversions of §From a VideoFrame to the screen. | D | [F62] |
| For exact decoder samples, decode with WebCodecs `VideoDecoder` and `copyTo()` the outputs; `<video>`/MSE is a viewing route (D: rows above, [F3]). | D | [F3] |

## Decoding in WebAssembly

**Bottom line.** Fixed-width SIMD, threads with shared memory, and `instantiateStreaming` ship in all three
engines. Threads need cross-origin isolation, which means COOP `same-origin` together with COEP `require-corp` or
`credentialless`; Safari does not support `credentialless`. A wasm32 memory can reach 4 GiB on 64-bit builds of all
three engines. Relaxed SIMD and memory64 ship in Chromium and Gecko, while Safari has them only in preview or behind a
flag.

### Feature support

The WebAssembly CG table (`features.json`) and BCD disagree in two cells, and both values are shown there.

| feature | Chromium | WebKit / Safari | Gecko / Firefox | label | src |
|---|---|---|---|---|---|
| Fixed-width SIMD (128-bit) | 91 | 16.4 | 89 | S | [A1] [A2] |
| Relaxed SIMD | 114 | BCD `preview`; CG table: flag `useWebAssemblyRelaxedSIMD` | BCD 146; CG table 145 | S | [A1] [A3] |
| Threads and atomics | 74 (Android 88) | BCD 15.2; CG table 14.1 desktop / 14.5 iOS | 79 | S | [A1] [A4] |
| `WebAssembly.Memory({shared:true})` | 74 (Android 88) | 15.2: "gated behind COOP/COEP" | 78 | S | [A5] |
| `SharedArrayBuffer` | 68 (Android 89) | 15.2 | 79 | S | [A6] |
| `crossOriginIsolated` | 87 | 15.2 | 72 | S | [A7] |
| COEP header / `credentialless` | 83 / 96 | 15.2 / **not supported** | 79 / 119 | S | [A8] |
| COOP header | 83 | 15.2 | 79 | S | [A9] |
| memory64 | 133 | BCD `preview`; CG table: Technology Preview 251 | 134 | S | [A1] [A10] |
| `compileStreaming` / `instantiateStreaming` | 60 | 15 | 58 | S | [A11] |
| `WebAssembly` in workers | exposed everywhere (`[Exposed=*]`), so dedicated, shared and service workers all have it | same | same | S (spec); per-engine worker data is not in BCD (U) | [A12] |

### Cross-origin isolation (HTML)

| claim | label | src |
|---|---|---|
| Unless the agent cluster is cross-origin isolated, the global `SharedArrayBuffer` constructor is deleted. A shared `WebAssembly.Memory` still exposes the constructor through `.buffer.constructor`. | S | [A13] |
| `postMessage` of a SAB (and so of a shared `WebAssembly.Memory`) throws `DataCloneError` unless the sender has the cross-origin isolated capability. | S | [A14] [A20] |
| Isolation needs **every top-level document to send `Cross-Origin-Opener-Policy: same-origin`** and **every document to send a COEP value that is "compatible with cross-origin isolation"**, which is `require-corp` or `credentialless`. | S | [A15] [A16] |
| `require-corp`: a cross-origin subresource needs CORS or a `Cross-Origin-Resource-Policy` header. `credentialless`: no-CORS cross-origin requests are sent without credentials and need no CORP. | S | [A16] |
| Only the "concrete" isolation mode grants the capability. "logical" applies the restrictions without granting it, on platforms that cannot provide the security. | S | [A17] |
| `self.crossOriginIsolated` reports the capability, in both windows and workers. Read it before you create threads. | S | [A18] |
| The `Atomics` object is available without isolation, and so are wasm atomic instructions. Only sharing memory between threads is gated. | S | [A20] |

### Memory: limits, sharing, growth

| claim | label | src |
|---|---|---|
| JS-API limits: a 32-bit memory may be at most 65,536 pages (4 GiB) at runtime. A 64-bit memory may be at most 262,144 pages (16 GiB). A page is 65,536 bytes. | S | [A19] |
| V8 (Chrome): 4 GiB for wasm32 and 16 GiB for memory64 on 64-bit builds. On 32-bit builds both are 32,767 pages (2 GiB − 64 KiB). | S | [A21] |
| Chrome moved from 2 GB to 4 GB in M83 ("Make sure to test on Chrome M83 … or later"). | S | [A22] |
| SpiderMonkey (Firefox), 64-bit: wasm32 gets 65,536 pages (4 GiB), the smaller of the 2¹⁶-page validation cap and a 16 GB ArrayBuffer limit. memory64 gets 16 GiB, the smaller of 2³⁷−1 pages and 16 GB. 32-bit builds stop one page short of 2 GB. | D: min() applied to the constants in [A23] |
| JavaScriptCore (Safari), 64-bit (`USE(LARGE_TYPED_ARRAYS)`): wasm32 gets 64 × 1024 pages (4 GiB). The memory64 buffer is capped at `MAX_ARRAY_BUFFER_SIZE` = 2³⁴ bytes (16 GiB). 32-bit builds get 2 GB. | S / D (16 GiB = 2³⁴) | [A24] |
| These are upper bounds. "In practice, an implementation may run out of resources for valid modules below these limits." | S | [A19] |
| A shared `WebAssembly.Memory` **must declare `maximum`**, or the constructor throws TypeError. | S | [A25] |
| Growing an unshared memory detaches the old `ArrayBuffer`. A shared memory is not detached: the memory gets a new fixed-length `SharedArrayBuffer`, so `memory.buffer` must be read again and views rebuilt after `grow()`. | S (detach rule) / D (re-read) | [A25] |
| `Memory.toResizableBuffer()` / `toFixedLengthBuffer()` are available: Chromium 144, Firefox 145, Safari 26.2. | S | [A5] |

### Compilation tiers (only where official docs say)

| engine | claim | label | src |
|---|---|---|---|
| V8 | Functions compile lazily with Liftoff, a baseline compiler, on their first call. Hot functions are compiled again with TurboFan. With `compileStreaming`, the TurboFan code is cached too. | S | [A26] |
| JavaScriptCore | Safari 26 added an in-place interpreter for Wasm. | S | [A27] |
| SpiderMonkey | Tiers not checked against firefox-source-docs. | U | — |

## Performance and resource guidance

What the vendors' own documents advise is stated once, in the section that owns it:

| guidance | where |
|---|---|
| close every `VideoFrame` promptly, or the decoder stalls; clones and serialized copies hold the same resource | §VideoFrame, Memory model [F47] [F48] [F51] |
| decode in a dedicated worker; transfer frames rather than clone them | §Chromium, Performance [C58]; §VideoFrame, Transfer [F53] |
| keep the `output` callback short; watch `decodeQueueSize` and `dequeue` for back-pressure | §Chromium, Performance [C58]; §WebCodecs VideoDecoder, Control message queue [V15] [V17] |
| a background or idle hardware decoder can be reclaimed (`QuotaExceededError`); be ready to build a new one | §WebCodecs VideoDecoder, Errors [V36] [V37]; §Chromium, Limits [C51] [C52] [C53] |
| hardware decoding saves battery; Safari plays AV1 only with hardware | §WebKit, Performance [K23] [K24] |
| `powerEfficient` is not "hardware" | §Media Capabilities decodingInfo [F103] |
| WASM threads need cross-origin isolation; a shared memory needs `maximum` and a re-read of `buffer` after `grow()` | §Decoding in WebAssembly [A15] [A25] |

No vendor document found gives decode throughput figures for WebCodecs in any engine (U: §WebKit and §Gecko,
Performance, say what was searched).

## How to test support

### Feature detection

| step | pattern | what it tells you | label | src |
|---|---|---|---|---|
| 1 | `isSecureContext` | `[SecureContext]` means the interface is exposed "only within a secure context" — on plain `http:` (other than what the platform counts as secure) `VideoDecoder` is simply absent | S | [V3], [V67] |
| 2 | `'VideoDecoder' in self` (works in a window and in a dedicated worker; `self` exists in both) | the interface is exposed in this realm; MDN marks it secure-context, window and dedicated worker | S / D | [V3], [V68] |
| 3 | `(await VideoDecoder.isConfigSupported(cfg)).supported` with the exact codec string, sizes and `hardwareAcceleration` you will use | the UA claims it can configure that config right now | S | [V24], [V25], [V26] |
| 4 | compare the returned `config` with your input (e.g. `rotation`, `flip` missing) | which members the UA ignores | S | [V24] |
| 5 | decode one known key chunk and compare output to a reference | the only check of what `isConfigSupported` does not promise (decode success, `format`, exact samples) | D | §"isConfigSupported" above |
| — | `'ondequeue' in VideoDecoder.prototype` | `dequeue` support; BCD records it later than the interface in Chrome | D | [V71] |

Not exposed in shared or service workers (D: `Exposed` lists only `Window` and `DedicatedWorker` [V3]). The spec
encourages running media pipelines in a worker (S) [V74]. MDN's own `isConfigSupported` example probes
`"avc1.42001E"`, `"hvc1.1.6.L123.00"`, `"vp8"`, `"vp09.00.10.08"`, `"av01.0.04M.08"` with both acceleration
preferences (S) [V69]. Shipping versions per engine are owned by the engine sections; the BCD root entry reads
`"chrome": { "version_added": "94" }`, `"firefox": { "version_added": "130" }`,
`"firefox_android": { "version_added": false }` (S) [V70].

### web-platform-tests

| claim | label | src |
|---|---|---|
| WebCodecs tests live in one flat wpt directory, `/webcodecs/`: 320 test files in the latest aligned stable run (323 results returned by the search API for `q=webcodecs`, 3 outside the directory). | S / D | [V72], [V73] |
| Decoder-specific files include `video-decoder.https.any.js`, `videoDecoder-codec-specific.https.any.js` (variants `?av1`, `?vp8`, `?vp9`, `?h264_avc`, `?h264_annexb`, `?h265_hevc`, `?h265_annexb`), `video-decoder-no-size-in-configure`, `videoDecoder-codec-specific-orientation`, `videoDecoder-444-h264`, `videoDecoder-h264-sei`, `videoDecoder-interlaced-h264`. | S | [V73] |

Latest **aligned** stable run (all four at wpt revision `fea36e49ddda8a206a5d3489ac377c8b9f406af9`), subtests
summed over every `/webcodecs/` result, as returned by `https://wpt.fyi/api/search?run_ids=…&q=webcodecs`
(`legacy_status` passes/total) and cross-checked against each run's `summary_v2` file (S) [V72], [V73]:

| browser | version | OS | run id | pass / total | % |
|---|---|---|---|---|---|
| Chrome | 157.0.8103.38 | linux 22.04 | 5070179567140864 | 3571 / 3920 | 91.1 |
| Edge | 157.0.4341.42 | win 10.0 | 5167475038355456 | 3551 / 3920 | 90.6 |
| Firefox | 159.0.1 | linux 22.04 | 5140459022974976 | 2810 / 3922 | 71.6 |
| Safari | 27.2 (22625.2.8.11.9) | mac 27.2 | 5107094106406912 | 1603 / 3632 | 44.1 |

Decoder rows that matter here (pass / total per subtest, same runs) (S) [V73]:

| test | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| `video-decoder.https.any.html` | 33/33 | 33/33 | 33/33 | 30/33 |
| `videoDecoder-codec-specific.https.any.html?av1` | 23/23 | 23/23 | 23/23 | 0/23 |
| `…codec-specific…?vp9` | 23/23 | 23/23 | 23/23 | 22/23 |
| `…codec-specific…?h264_avc` | 23/23 | 23/23 | 23/23 | 22/23 |
| `…codec-specific…?h265_hevc` | 0/23 | 0/23 | 0/23 | 22/23 |
| `videoDecoder-codec-specific-orientation.https.any.html?av1` | 2/2 | 2/2 | 0/2 | 0/2 |

| claim | label | src |
|---|---|---|
| Fixtures and limits: one CI machine per browser (OS as listed), whatever codecs and hardware that machine has; a 0/23 row says that codec failed there, not why, and says nothing about other devices. | D | [V72] |
| Safari's total is smaller (3632) because its run reports fewer subtests (13 files ended in harness `ERROR`, 1 `TIMEOUT`), so its % is not comparable subtest-for-subtest. | S / D | [V73] (status counts from the `summary_v2` file) |
| Totals are raw subtest sums, not wpt.fyi's per-test-normalised "interop" score. | D | method above |

## What it means for this repository

Compared on 2026-11-10 with `docs/decode/README.md` §AV1 and §JPEG XL, `docs/decode/hardware.md` §4, and
`origin/claude/av1-webcodecs-profiles:docs/av1/webcodecs-profiles.md`. Those files were not edited. They hold
measurements (Chromium 141, Firefox 157, WebKitGTK 2.52.6, headless, no GPU) and source reads of their own dates;
this document holds official sources of 2026-11-10, Chromium and Firefox at `main`. A disagreement can therefore be a
version change rather than an error on either side; each row says which it looks like (D).

### Where the sources disagree

| # | the repository says (verbatim) | this document's source says (verbatim) | which it looks like (D) |
|---|---|---|---|
| 1 | Safari's WebCodecs AV1 is software only. `README.md` §Why, and what would make it exact: "Where it is on, it decodes in software through libwebrtc's dav1d (`LibWebRTCVPXVideoDecoder`, type AV1), which refuses anything but 8-bit 4:2:0 (`layout != I420 \|\| bpc != 8`) and returns `NV12`. No hardware decoder is on that path." `hardware.md` §4.3: "WebCodecs AV1 is behind `WebCodecsAV1Enabled`, off by default on Cocoa, and is libwebrtc's dav1d in software, refusing anything but 8-bit 4:2:0." | Safari 17.5 release notes: "Added support for WebCodecs AV1 when an AV1 hardware decoder is available." [K17]. WebKit source: `if (codec.startsWith("av01."_s)) {` routes to the GPU process when AV1 hardware exists [K31], and `setHasAV1HardwareDecoder` turns the AV1 setting on [K32]. | **The repository missed a path.** On a device with AV1 hardware, Safari's WebCodecs AV1 is on by default and goes to VideoToolbox; the dav1d path is the no-hardware case behind the flag. Its 10-bit output has `format` `null` [K42] [K43], so the repository's verdict (no exact 10-bit AV1 in Safari) still holds; the exactness of 8-bit `NV12` from VideoToolbox is not known (U). |
| 2 | Firefox hands every frame back as 8-bit RGB. `README.md` §Why: "Everything that does decode reaches the page as 8-bit `BGRX`, whatever its depth or layout." and "Even a planar image would lose its depth: Gecko's image formats have no 10-bit YUV (`ImageUtils`)." `hardware.md` §4.2: "every frame reaches the page as 8-bit `BGRX`". `webcodecs-profiles.md`: "Every remote-decoded frame is `BGRX`, from a placeholder texture format". | Gecko `main` (162.0a1): `case ColorDepth::COLOR_10:` … `ImagePixelFormat::I420P10`; `case ColorDepth::COLOR_12:` … `ImagePixelFormat::I420P12` [G56]; "If failed to create a GPU accelerated surface descriptor, fall back to copying frames via shmem." [G57]; bug 2071132, RESOLVED FIXED: "VideoFrame.format reports I420 for 10-bit planar frames and BGRA for frames created from a video element" [G64]; bug 1969762, ASSIGNED: "VideoFrame.format reports BGRX for remote-decoded frames and copyTo cannot return YUV planes" [G64]. | **Probably a version change, partly.** The texture path still gives `BGRX` (bug 1969762 open), as the repository measured on 157. A frame that comes back as CPU planes now reports `I420P10`/`I420P12`, so "no 10-bit YUV" no longer holds at `main`. Which path a WebCodecs decode takes on a given OS and GPU was not established (U, §Gecko); a run on a current release would settle it. |
| 3 | Chromium's 10/12-bit formats need a flag. `hardware.md` §4.1, gate 3: "The 10- and 12-bit planar formats are behind a runtime flag, `WebCodecsHBDFormatsEnabled`." | Chromium `main`, `IsFormatEnabled`: `case media::PIXEL_FORMAT_YUV420P10:` `case media::PIXEL_FORMAT_YUV420P12:` … `return true;`, with no flag in the function [X6]; no `WebCodecsHBDFormatsEnabled` entry in `runtime_enabled_features.json5` at that commit (D: searched [X6]'s companion file). | **A version change** (141 read then, `main` now). Either way a software 10-bit frame reaches the page as `I420P10`, which the repository measured. |
| 4 | JPEG XL is off by default. `README.md` §JPEG XL: "Native JPEG XL decoding exists in Chromium 154 (jxl-rs, behind `JXLImageFormat`, off by default; none in Chromium 141) and Firefox 157.0.1 (behind `image.jxl.enabled`, off)". | BCD `mediatypes/image/jxl.json`: `"chrome": { "version_added": "155" }`, `"firefox": { "version_added": "158" }` [I22]; Firefox 158: "Support for the JPEG XL image format (image/jxl) is now enabled by default." [G27]. | **A version change**: both shipped on by default one release after the versions measured. The repository's conclusion (8-bit samples only) agrees with §ImageDecoder and image formats [I42] [I49] [I50]. |

### Where they agree

| the repository's claim | agreeing source here |
|---|---|
| Chromium refuses 12-bit AV1 at the key-frame check, libgav1 built to 10 bits (`README.md` §WebCodecs, what it decodes exactly; `webcodecs-profiles.md` [C4]) | [X1]–[X4] |
| Chromium returns 4:0:0 as `I420` with mid-grey chroma | [C35] [C36] |
| `isConfigSupported` does not promise bit depth, chroma, or that decoding works | [V25], §`isConfigSupported()` |
| WebCodecs has no `P010` and no grey format; a hardware 10-bit frame has `format` `null` in Chromium | [F10] [C44] |
| Android hardware frames come back as RGB in Chromium | [C41] |
| WebCodecs only takes `av01.0` in WebKit; Safari's software AV1 is 8-bit 4:2:0 only | [K47] [K36] |
| Firefox has no WebCodecs on Android | [G1] [G37] |
| `<video>` AV1 on Apple devices is hardware only; Safari has JPEG XL since 17 | [K15] [I22] |

### Consequences for the client (D)

* The client's choice (WebCodecs for ≤ 10 bits where a per-layout probe decodes a known frame exactly, dav1d-WASM
  otherwise) is what the specification supports: nothing short of decoding a frame tells the page the output format
  or exactness ([V25], §How to test support row 5).
* `prefer-software` is the one setting that keeps Chromium's hardware path, and its `null`-format 10-bit frames, out
  ([C30]); Gecko treats it the same way ([G39]); WebKit honours it only for VP9 on macOS ([K30]).
* Safari on an AV1-hardware device now reaches WebCodecs AV1 (row 1); the probe should fail its 10-bit layouts
  (`format` `null`) and send them to dav1d-WASM. Its 8-bit grey-as-4:2:0 form through VideoToolbox is untested.
* Firefox: the probe would pass a 10-bit layout wherever the CPU-plane path is taken (row 2). The engine read-back
  check is owed on a current Firefox release before anything is inferred from it.
* No browser route gives exact 12-bit (AV1) or 16-bit samples, and no engine decodes JPEG 2000 or HTJ2K: HTJ2K stays
  on OpenJPH-WASM and 12-bit AV1 on dav1d-WASM.

### Quote check

An adversarial pass, by an agent that wrote none of the sections, re-fetched 94 of the 482 sources on 2026-11-10 (V 13,
F 14, C 12, K 15, G 15, I 15, A 10) and checked each quote against the fetched text and against the claims citing it.

| result | count | what was done |
|---|---|---|
| quote verbatim | 94 of 94 | — |
| quote supports its claims | 85 | — |
| supports them only in part | 7 (V22, V24, V35, F78, C20, C43, G3) | each quote extended with the source's own sentence, or the claim narrowed (F78: `RGB10_A2` added; C20: outside Android; G3: the constructor option) |
| does not support the claim | 2 (F93, F94) | corrected: Chrome has had both WebGPU external-image routes since 113 on ChromeOS, macOS and Windows; 144 added Linux |

The X sources were added in integration after that pass and were read by the integrator, not by the checker. 388
sources were not re-fetched; their quotes stand on their authors' reading alone.

## Sources

Every source read 2026-11-10 unless its row says otherwise; ids are prefixed by the section that wrote them: V the decoder, codec strings and testing; F `VideoFrame`, the screen, Media Capabilities and `<video>`; C Chromium; K WebKit; G Gecko; I images; A WebAssembly; X added in integration.

### Sources (V)

| id | URL | read | verbatim quote |
|---|---|---|---|
| V1 | https://www.w3.org/TR/webcodecs/ | 2026-11-10 | "W3C Working Draft, 9 November 2026" |
| V2 | https://w3c.github.io/webcodecs/ | 2026-11-10 | "Editor’s Draft, 9 November 2026" |
| V3 | https://www.w3.org/TR/webcodecs/#videodecoder-interface | 2026-11-10 | "[Exposed=(Window,DedicatedWorker), SecureContext] interface VideoDecoder : EventTarget {" |
| V4 | https://www.w3.org/TR/webcodecs/#videodecoder-constructors | 2026-11-10 | "Assign true to [[key chunk required]]. Assign "unconfigured" to [[state]] Assign 0 to [[decodeQueueSize]]." / "[[decodeQueueSize]] The number of pending decode requests." |
| V5 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-configure | 2026-11-10 | "If config is not a valid VideoDecoderConfig, throw a TypeError. If [[state]] is “closed”, throw an InvalidStateError. Set [[state]] to "configured". Set [[key chunk required]] to true." / "Authors are encouraged to first check support by calling isConfigSupported() with config." |
| V6 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-configure | 2026-11-10 | "Assign true to [[message queue blocked]]." / "If supported is false, queue a task to run the Close VideoDecoder algorithm with NotSupportedError and abort these steps." |
| V7 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-decode | 2026-11-10 | "If [[state]] is not "configured", throw an InvalidStateError. If [[key chunk required]] is true: If chunk.type is not key, throw a DataError." |
| V8 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-decode | 2026-11-10 | "Implementers SHOULD inspect the chunk’s [[internal data]] to verify that it is truly a key chunk. If a mismatch is detected, throw a DataError." |
| V9 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-decode | 2026-11-10 | "If [[codec saturated]] equals true, return "not processed"." / "Decrement [[decodeQueueSize]] and run the Schedule Dequeue Event algorithm." / "If decoding results in an error, queue a task to run the Close VideoDecoder algorithm with EncodingError and return." |
| V10 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-decode | 2026-11-10 | "The underlying media resources are owned by the VideoDecoder and failing to release them (or waiting for garbage collection) can cause decoding to stall." |
| V11 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-decode | 2026-11-10 | "VideoDecoder requires that frames are output in the order they expect to be presented, commonly known as presentation order." |
| V12 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-flush | 2026-11-10 | "If [[state]] is not "configured", return a promise rejected with InvalidStateError DOMException. Set [[key chunk required]] to true." / "Signal [[codec implementation]] to emit all internal pending outputs." |
| V13 | https://www.w3.org/TR/webcodecs/#reset-videodecoder | 2026-11-10 | "If state is "closed", throw an InvalidStateError. Set state to "unconfigured"." / "Remove all control messages from the [[control message queue]]." / "For each promise in [[pending flush promises]]: Reject promise with exception." / "run the Reset VideoDecoder algorithm with an AbortError DOMException." |
| V14 | https://www.w3.org/TR/webcodecs/#close-videodecoder | 2026-11-10 | "Close is final." / "Set state to "closed"." / "If exception is not an AbortError DOMException, invoke the [[error callback]] with exception." |
| V15 | https://www.w3.org/TR/webcodecs/#saturated | 2026-11-10 | "The maximum may be any value greater than 1, including infinity (no maximum). While saturated, additional calls to decode() or encode() will be buffered in the control message queue, and will increment the respective decodeQueueSize" / "Fired at the VideoDecoder when the decodeQueueSize has decreased." |
| V16 | https://www.w3.org/TR/webcodecs/#control-messages | 2026-11-10 | ""not processed" indicates the message must not be processed at this time and should remain in the control message queue to be retried later." |
| V17 | https://www.w3.org/TR/webcodecs/#videodecoder-algorithms | 2026-11-10 | "If [[dequeue event scheduled]] equals true, return." / "A boolean indicating whether a dequeue event is already scheduled to fire. Used to avoid event spam." |
| V18 | https://www.w3.org/TR/webcodecs/#video-decoder-config | 2026-11-10 | "HardwareAcceleration hardwareAcceleration = "no-preference"; boolean optimizeForLatency = false; double rotation = 0; boolean flip = false;" |
| V19 | https://www.w3.org/TR/webcodecs/#valid-videodecoderconfig | 2026-11-10 | "If one of codedWidth or codedHeight is provided but the other isn’t, return false. If codedWidth = 0 or codedHeight = 0, return false." / "If description is [detached], return false." |
| V20 | https://www.w3.org/TR/webcodecs/#video-decoder-config | 2026-11-10 | "codedWidth and codedHeight are used when selecting a [[codec implementation]]." / "If colorSpace exists, the provided values will override any in-band values from the bitsream." / "Hint that the selected decoder SHOULD be configured to minimize the number of EncodedVideoChunks that have to be decoded before a VideoFrame is output." / "rotation ... Sets the rotation attribute on decoded frames." |
| V21 | https://www.w3.org/TR/webcodecs/#hardware-acceleration | 2026-11-10 | "prefer-hardware and prefer-software are hints. While User Agents SHOULD respect these values when possible, User Agents may ignore these values in some or all circumstances for any reason." / "Setting a value of prefer-hardware or prefer-software can significantly restrict what configurations are supported." |
| V22 | https://www.w3.org/TR/webcodecs/#hardware-acceleration | 2026-11-10 | "the User Agent MUST ensure rejection or acceptance of a given HardwareAcceleration preference reveals no additional information on top of what is inherent to the User Agent and revealed by [media-capabilities]." / "If a User Agent does not implement [media-capabilities] for reasons of fingerprinting, they SHOULD ignore the HardwareAcceleration preference." |
| V23 | https://www.w3.org/TR/webcodecs/#hardware-acceleration | 2026-11-10 | "a good example of using "prefer-hardware" would be if an author intends to provide their own software based fallback via WebAssembly." |
| V24 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-isconfigsupported | 2026-11-10 | "Set config to the result of running the Clone Configuration algorithm with config." / "The returned VideoDecoderSupport config will contain only the dictionary members that User Agent recognized." / "If config is not a valid VideoDecoderConfig, return a promise rejected with TypeError." / "dictionary VideoDecoderSupport { boolean supported; VideoDecoderConfig config; };" |
| V25 | https://www.w3.org/TR/webcodecs/#check-configuration-support | 2026-11-10 | "If the codec string in config.codec is not a valid codec string or is otherwise unrecognized by the User Agent, return false." / "can’t provide a codec that can decode the exact profile (where present), level (where present), and constraint bits (where present)" / "If the User Agent can provide a codec to support all entries of the config, including applicable default values for keys that are not included, return true." |
| V26 | https://www.w3.org/TR/webcodecs/#check-configuration-support | 2026-11-10 | "User Agents describe support on a best-effort basis given the resources that are available at the time of the query." |
| V27 | https://www.w3.org/TR/webcodecs/#check-configuration-support | 2026-11-10 | "User Agents can limit the configurations they provide to a common baseline subset" / "Because both isConfigSupported() and configure() invoke this algorithm, both reflect the same supported set." |
| V28 | https://www.w3.org/TR/webcodecs/#config-codec-string | 2026-11-10 | "It is unambiguous about codec profile, level, and constraint bits for codecs that define these concepts." / "only the value of the codecs parameter is accepted." |
| V29 | https://www.w3.org/TR/webcodecs/#encodedvideochunk-interface | 2026-11-10 | "readonly attribute unsigned long long? duration; // microseconds" / "required AllowSharedBufferSource data; sequence<ArrayBuffer> transfer = [];" |
| V30 | https://www.w3.org/TR/webcodecs/#encodedvideochunk-constructors | 2026-11-10 | "If init.transfer contains more than one reference to the same ArrayBuffer, then throw a DataCloneError DOMException." / "If init.transfer contains an ArrayBuffer referenced by init.data the User Agent MAY choose to:" / "Otherwise: Assign a copy of init.data to [[internal data]]." / "Perform DetachArrayBuffer on transferable" |
| V31 | https://www.w3.org/TR/webcodecs/#dom-encodedvideochunk-copyto | 2026-11-10 | "If [[byte length]] is greater than the [[byte length]] of destination, throw a TypeError." |
| V32 | https://www.w3.org/TR/webcodecs/#encodedvideochunk-serialization | 2026-11-10 | "If forStorage is true, throw a DataCloneError." |
| V33 | https://www.w3.org/TR/webcodecs/#create-a-videoframe | 2026-11-10 | "If output uses a recognized VideoPixelFormat, assign that format to [[format]]. Otherwise, assign null to [[format]]." |
| V34 | https://www.w3.org/TR/webcodecs/#output-videoframes | 2026-11-10 | "Let timestamp and duration be the timestamp and duration from the EncodedVideoChunk associated with output." / "User Agents MAY replace null members of colorSpace with the corresponding values detected by the codec implementation." |
| V35 | https://www.w3.org/TR/webcodecs/#privacy-output-fingerprinting | 2026-11-10 | "conforming decoders for modern video codecs (such as AVC, HEVC, VP8, VP9, and AV1) produce bit-exact reconstructed YUV samples in their native format, so video decode differences arise primarily from output frame format and alignment metadata (e.g. VideoFrame.format, VideoFrame.codedWidth, VideoFrame.codedHeight, and VideoFrame.colorSpace) and from post-decode pixel format or color space conversions (such as during VideoFrame.copyTo())" |
| V36 | https://www.w3.org/TR/webcodecs/#resource-reclamation | 2026-11-10 | "To reclaim a codec, a User Agent MUST run the appropriate close algorithm (amongst Close AudioDecoder, Close AudioEncoder, Close VideoDecoder and Close VideoEncoder) with a QuotaExceededError." |
| V37 | https://www.w3.org/TR/webcodecs/#resource-reclamation | 2026-11-10 | "An active codec is a codec that has made progress on the [[codec work queue]] in the past 10 seconds." / "A User Agent MUST NOT reclaim a codec that is both active and in the foreground" |
| V38 | https://www.w3.org/TR/webcodecs/#codec-state | 2026-11-10 | "enum CodecState { "unconfigured", "configured", "closed" };" / "callback WebCodecsErrorCallback = undefined(DOMException error);" |
| V39 | https://www.w3.org/TR/webcodecs-codec-registry/ | 2026-11-10 | "W3C Registry Draft, 24 September 2026" / "This registry is non-normative." / "Implementers of WebCodecs are not required to support any particular codec nor registry entry." |
| V40 | https://www.w3.org/TR/webcodecs-codec-registry/#video-codec-registry | 2026-11-10 | "av01.* \| AV1" / "avc1.*, avc3.* \| AVC / H.264" / "hev1.*, hvc1.* \| HEVC / H.265" / "vp8 \| VP8" / "vp09.* \| VP9" |
| V41 | https://www.w3.org/TR/webcodecs-av1-codec-registration/ | 2026-11-10 | "W3C Group Note Draft, 13 October 2026" / "The codec string begins with the prefix "av01.", followed by a variable length suffix as described in Section 5 of [AV1-ISOBMFF]." |
| V42 | https://www.w3.org/TR/webcodecs-av1-codec-registration/ | 2026-11-10 | "a sequence of Open Bitstream Units (OBUs) compliant to the "low-overhead bitstream format" (Section 5.2 of [AV1]) forming a single temporal unit" |
| V43 | https://www.w3.org/TR/webcodecs-av1-codec-registration/ | 2026-11-10 | "description is not used for this codec." |
| V44 | https://www.w3.org/TR/webcodecs-av1-codec-registration/ | 2026-11-10 | "the EncodedVideoChunk is expected to contain an OBU_SEQUENCE_HEADER OBU before the first frame header" |
| V45 | https://aomediacodec.github.io/av1-isobmff/ (v1.3.0, 3 April 2024) §5 | 2026-11-10 | "<sample entry 4CC>.<profile>.<level><tier>.<bitDepth>.<monochrome>.<chromaSubsampling>." |
| V46 | https://aomediacodec.github.io/av1-isobmff/ §5 | 2026-11-10 | "The level parameter value SHALL equal the first level value indicated by seq_level_idx in the Sequence Header OBU. The tier parameter value SHALL be equal to M when the first seq_tier value in the Sequence Header OBU is equal to 0, and H when it is equal to 1." / "If both subsampling_x and subsampling_y are set to 1, then the third digit SHALL be equal to chroma_sample_position, otherwise it SHALL be set to 0." |
| V47 | https://aomediacodec.github.io/av1-isobmff/ §5 | 2026-11-10 | "The parameters sample entry 4CC, profile, level, tier, and bitDepth are all mandatory fields." / "If the codecs parameter string ends with ".0.110.01.01.01.0" (containing all the default values below), that trailing part of the string SHOULD be omitted." |
| V48 | https://aomediacodec.github.io/av1-isobmff/ §5 | 2026-11-10 | "codecs="av01.0.04M.10.0.112.09.16.09.0" represents AV1 Main Profile, level 3.0, Main tier, 10-bit content" |
| V49 | https://aomediacodec.github.io/av1-spec/ Annex A | 2026-11-10 | "X is equal to 2 + (seq_level_idx >> 2). Y is given by (seq_level_idx & 3)." |
| V50 | https://aomediacodec.github.io/av1-spec/ Annex A | 2026-11-10 | "Finally, the Professional profile extends support over the High profile to also bitstreams with bit depth equal to 12, and also adds support for the 4:2:2 video format." |
| V51 | https://aomediacodec.github.io/av1-spec/ §5.5.2 color_config | 2026-11-10 | "if ( seq_profile == 2 && high_bitdepth ) {" / "BitDepth = twelve_bit ? 12 : 10" |
| V52 | https://aomediacodec.github.io/av1-spec/ §5.5.2, §6.4.2 | 2026-11-10 | "subsampling_x = 1" / "subsampling_y = 1" / "chroma_sample_position = CSP_UNKNOWN" (under `if ( mono_chrome )`); "0 \| CSP_UNKNOWN" |
| V53 | https://www.w3.org/TR/webcodecs-vp9-codec-registration/ | 2026-11-10 | "The codec string begins with the prefix "vp09.", followed by a variable length suffix as described in the "Codecs Parameter String" Section of [VP9-ISOBMFF]." / "The description is not used for this codec." |
| V54 | https://github.com/webmproject/vp9-dash/blob/b91775b9d2d1b0d83c0ad265aeb61886303071da/VPCodecISOMediaFileFormatBinding.md | 2026-11-10 | "All parameter values are expressed as double-digit decimals." / "**sample entry 4CC**, **profile**, **level**, and **bitDepth** are all mandatory fields." |
| V55 | same as V54 | 2026-11-10 | "\| 2       \| 10 or 12 bit \| 4:2:0              \|" |
| V56 | same as V54 | 2026-11-10 | "\| 41    \| Level 4.1                   \|" / "The string `codecs="vp09.00.41.08"` in this case would represent VP9 profile 0, level 4.1, 8-bit YUV content" |
| V57 | https://www.w3.org/TR/webcodecs-vp8-codec-registration/ | 2026-11-10 | "The codec string is "vp8"." / "contain a frame where key_frame is true" |
| V58 | https://www.w3.org/TR/webcodecs-avc-codec-registration/ | 2026-11-10 | "The codec string begins with the prefix "avc1." or "avc3.", with a suffix of 6 characters as described respectively in Section 3.4 of [rfc6381] and Section 5.4.1 of [iso14496-15]." |
| V59 | https://www.w3.org/TR/webcodecs-avc-codec-registration/ | 2026-11-10 | "If the description is present, it is assumed to be an AVCDecoderConfigurationRecord, as defined by [iso14496-15], section 5.3.3.1, and the bitstream is assumed to be in avc format." / "If the description is not present, the bitstream is assumed to be in annexb format." |
| V60 | https://www.w3.org/TR/webcodecs-avc-codec-registration/ | 2026-11-10 | "expected to contain both a primary coded picture that is an instantaneous decoding refresh (IDR) picture, and all parameter sets necessary to decode all video data NAL units in the EncodedVideoChunk." |
| V61 | https://www.w3.org/TR/webcodecs-avc-codec-registration/ | 2026-11-10 | "dictionary AvcEncoderConfig { AvcBitstreamFormat format = "avc"; };" / "emitted via the [[output callback]] as the VideoDecoderConfig.description of the EncodedVideoChunkMetadata.decoderConfig." |
| V62 | https://www.rfc-editor.org/rfc/rfc6381.txt §3.3–3.4 | 2026-11-10 | "the hexadecimal representation of the following three bytes in the (subset) sequence parameter set Network Abstraction Layer (NAL) unit specified in [AVC]: (1) profile_idc, (2) the byte containing the constraint_set flags" / "(3) level_idc." |
| V63 | https://www.w3.org/TR/webcodecs-hevc-codec-registration/ | 2026-11-10 | "The codec string begins with the prefix "hev1." or "hvc1.", with a suffix of four dot-separated fields as described in Section E.3 of [iso14496-15]." |
| V64 | https://www.w3.org/TR/webcodecs-hevc-codec-registration/ | 2026-11-10 | "If the description is present, it is assumed to be an HEVCDecoderConfigurationRecord, as defined by [iso14496-15], section 8.3.3.1, and the bitstream is assumed to be in hevc format." |
| V65 | https://www.w3.org/TR/webcodecs-hevc-codec-registration/ | 2026-11-10 | "a base layer primary coded picture that is an instantaneous decoding refresh (IDR), clean random access (CRA), or broken link access (BLA) picture." |
| V66 | https://www.w3.org/TR/webcodecs-hevc-codec-registration/ | 2026-11-10 | "dictionary HevcEncoderConfig { HevcBitstreamFormat format = "hevc"; };" |
| V67 | https://webidl.spec.whatwg.org/#SecureContext | 2026-11-10 | "it indicates that the construct is exposed only within a secure context." |
| V68 | https://github.com/mdn/content/blob/edc9ab5479d1253d9edd93bfe90dd1d100605c26/files/en-us/web/api/videodecoder/index.md | 2026-11-10 | "{{securecontext_header}}{{APIRef("WebCodecs API")}}{{AvailableInWorkers("window_and_dedicated")}}" |
| V69 | https://github.com/mdn/content/blob/edc9ab5479d1253d9edd93bfe90dd1d100605c26/files/en-us/web/api/videodecoder/isconfigsupported_static/index.md | 2026-11-10 | ""avc1.42001E", "hvc1.1.6.L123.00", "vp8", "vp09.00.10.08", "av01.0.04M.08"," |
| V70 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/VideoDecoder.json | 2026-11-10 | `"chrome": { "version_added": "94" }`, `"firefox": { "version_added": "130" }`, `"firefox_android": { "version_added": false }`, `"safari": { "version_added": "16.4" }` |
| V71 | same as V70, `dequeue_event` | 2026-11-10 | `"dequeue_event"` … `"chrome": { "version_added": "106" }` |
| V72 | https://wpt.fyi/api/runs?label=stable&label=master&aligned=true&max-count=1 | 2026-11-10 | `"id":5070179567140864,"browser_name":"chrome","browser_version":"157.0.8103.38","os_name":"linux","os_version":"22.04"` … `"full_revision_hash":"fea36e49ddda8a206a5d3489ac377c8b9f406af9"` (and runs 5167475038355456 edge, 5140459022974976 firefox, 5107094106406912 safari) |
| V73 | https://wpt.fyi/api/search?run_ids=5070179567140864,5167475038355456,5140459022974976,5107094106406912&q=webcodecs | 2026-11-10 | per-test `legacy_status` `passes`/`total`; summed over `/webcodecs/`: `[[3571, 3920], [3551, 3920], [2810, 3922], [1603, 3632]]` (sum computed by the author) |
| V74 | https://www.w3.org/TR/webcodecs/#best-practices-developers | 2026-11-10 | "authors working with realtime media or in contended main thread environments are encouraged to ensure their media pipelines operate in worker contexts" |
| V75 | https://www.w3.org/TR/webcodecs/#privacy-considerations | 2026-11-10 | "13. Privacy Considerations This section is non-normative." |

### Sources (F)

| id | URL | read | verbatim quote |
|---|---|---|---|
| F1 | https://www.w3.org/TR/webcodecs/ | 2026-11-10 | "W3C Working Draft, 9 November 2026" |
| F2 | https://w3c.github.io/webcodecs/ | 2026-11-10 | "This document was published by the Media Working Group as an Editor’s Draft." |
| F3 | https://w3c.github.io/webcodecs/#dom-videoframe-copyto | 2026-11-10 | "Copy rowBytes bytes from resource starting at sourceOffset to destination starting at destinationOffset." |
| F4 | https://w3c.github.io/webcodecs/#dom-videoframe-copyto | 2026-11-10 | "The format of the data is options.format, if it exists or this VideoFrame’s format otherwise." |
| F5 | https://w3c.github.io/webcodecs/#dom-videoframe-copyto | 2026-11-10 | "If [[format]] is null and options.format does not exist, return a promise rejected with a NotSupportedError DOMException." |
| F6 | https://w3c.github.io/webcodecs/#dom-videoframe-format | 2026-11-10 | "Will be null whenever the underlying format does not map to a VideoPixelFormat or when [[Detached]] is true." |
| F7 | https://w3c.github.io/webcodecs/#create-a-videoframe | 2026-11-10 | "If output uses a recognized VideoPixelFormat, assign that format to [[format]]. Otherwise, assign null to [[format]]." |
| F8 | https://w3c.github.io/webcodecs/#dom-videoframe-copyto | 2026-11-10 | "Promises that are returned by several calls to copyTo() are not guaranteed to resolve in the order they were returned." |
| F9 | https://w3c.github.io/webcodecs/#videoframe-interface | 2026-11-10 | "[Exposed=(Window,DedicatedWorker), Serializable, Transferable] interface VideoFrame { constructor(CanvasImageSource image, optional VideoFrameInit init = {}); constructor(AllowSharedBufferSource data, VideoFrameBufferInit init);" |
| F10 | https://w3c.github.io/webcodecs/#pixel-format | 2026-11-10 | "// 4:2:0 Y, UV \"NV12\", // 4:4:4 RGBA \"RGBA\", // 4:4:4 RGBX (opaque) \"RGBX\", // 4:4:4 BGRA \"BGRA\", // 4:4:4 BGRX (opaque) \"BGRX\"," |
| F11 | https://w3c.github.io/webcodecs/#pixel-format | 2026-11-10 | "Integer values are unsigned unless otherwise specified." |
| F12 | https://w3c.github.io/webcodecs/#dom-videopixelformat-i420 | 2026-11-10 | "The U and V planes have a number of rows equal to the result of the division of codedHeight by 2, rounded up to the nearest integer." |
| F13 | https://w3c.github.io/webcodecs/#dom-videopixelformat-i420 | 2026-11-10 | "Each sample in this format is 8 bits." / "The visible rectangle offset (visibleRect.x and visibleRect.y) MUST be even." |
| F14 | https://w3c.github.io/webcodecs/#dom-videopixelformat-i420p10 | 2026-11-10 | "Each sample in this format is 10 bits, encoded as a 16-bit integer in little-endian byte order." |
| F15 | https://w3c.github.io/webcodecs/#dom-videopixelformat-i420p12 | 2026-11-10 | "Each sample in this format is 12 bits, encoded as a 16-bit integer in little-endian byte order." |
| F16 | https://w3c.github.io/webcodecs/#dom-videopixelformat-i420a | 2026-11-10 | "The U and V planes are sub-sampled horizontally and vertically by a factor of 2 compared to the Y and Alpha planes." / "I420A’s equivalent opaque format is I420." |
| F17 | https://w3c.github.io/webcodecs/#dom-videopixelformat-i422 | 2026-11-10 | "The U and V planes are sub-sampled horizontally by a factor of 2 compared to the Y plane, and not sub-sampled vertically." / "The visible rectangle horizontal offset (visibleRect.x) MUST be even." |
| F18 | https://w3c.github.io/webcodecs/#dom-videopixelformat-i444 | 2026-11-10 | "This format does not use sub-sampling." |
| F19 | https://w3c.github.io/webcodecs/#dom-videopixelformat-nv12 | 2026-11-10 | "Each element is composed of two Chroma samples, the U and V samples, in that order." |
| F20 | https://w3c.github.io/webcodecs/#dom-videopixelformat-rgba | 2026-11-10 | "Each sample in this format is 8 bits, and each pixel is therefore 32 bits." / "RGBA’s equivalent opaque format is RGBX." |
| F21 | https://w3c.github.io/webcodecs/#dom-videopixelformat-rgbx | 2026-11-10 | "The fourth element in each pixel is to be ignored, the image is always fully opaque." |
| F22 | https://w3c.github.io/webcodecs/#compute-layout-and-allocation-size | 2026-11-10 | "Let sampleBytes be the number of bytes per sample for plane, multiplied by the number of samples stored at each position of plane (for example, 2 for the UV plane of NV12 and 4 for RGBA)." |
| F23 | https://w3c.github.io/webcodecs/#dom-videoframe-codedwidth | 2026-11-10 | "Width of the VideoFrame in pixels, potentially including non-visible padding, and prior to considering potential ratio adjustments." |
| F24 | https://w3c.github.io/webcodecs/#dom-videoframe-codedrect | 2026-11-10 | "Offered for convenience for use with allocationSize() and copyTo()." |
| F25 | https://w3c.github.io/webcodecs/#dom-videoframe-visiblerect | 2026-11-10 | "A DOMRectReadOnly describing the visible rectangle of pixels for this VideoFrame." / "If [[Detached]] is true, return null." |
| F26 | https://w3c.github.io/webcodecs/#dom-videoframe-displaywidth | 2026-11-10 | "Width of the VideoFrame when displayed after applying rotation and aspect ratio adjustments." |
| F27 | https://w3c.github.io/webcodecs/#dom-videoframe-rotation | 2026-11-10 | "The rotation to applied to the VideoFrame when rendered, in degrees clockwise. Rotation applies before flip." |
| F28 | https://w3c.github.io/webcodecs/#videoframe-interface | 2026-11-10 | "readonly attribute unsigned long long? duration; // microseconds readonly attribute long long timestamp; // microseconds" |
| F29 | https://w3c.github.io/webcodecs/#dom-videoframe-metadata | 2026-11-10 | "Possible members are recorded in the VideoFrame Metadata Registry." / "The goal of this algorithm is to ensure that metadata owned by a VideoFrame is immutable." |
| F30 | https://w3c.github.io/webcodecs/#dictdef-videoframecopytooptions | 2026-11-10 | "If unspecified, the visibleRect will be used." / "The default rect does not necessarily meet the sample-alignment requirement and can result in copyTo() or allocationSize() rejecting." |
| F31 | https://w3c.github.io/webcodecs/#videoframe-domrects | 2026-11-10 | "All floating point values provided to DOMRectInit will be truncated." |
| F32 | https://w3c.github.io/webcodecs/#dom-videoframe-videoframe-data-init | 2026-11-10 | "The User Agent MAY choose to allocate resource with a larger coded size and plane strides to improve memory alignment. Increases will be reflected by codedWidth and codedHeight." |
| F33 | https://w3c.github.io/webcodecs/#dom-videoframecopytooptions-layout | 2026-11-10 | "If unspecified, the planes will be tightly packed. It is invalid to specify planes that overlap." |
| F34 | https://w3c.github.io/webcodecs/#plane-layout | 2026-11-10 | "The number of bytes, including padding, used by each row of the plane within a BufferSource." |
| F35 | https://www.w3.org/TR/webcodecs/#dom-videoframecopytooptions-format | 2026-11-10 | "Potential values are: RGBA, RGBX, BGRA, BGRX." |
| F36 | https://w3c.github.io/webcodecs/#videoframe-parse-videoframecopytooptions | 2026-11-10 | "Otherwise, if options.format is equal to one of RGBA, RGBX, BGRA, BGRX, then assign options.format to format, otherwise return NotSupportedError." |
| F37 | https://www.w3.org/TR/webcodecs/#dom-videoframecopytooptions-colorspace | 2026-11-10 | "A PredefinedColorSpace that MUST be used as a target color space for the pixel data in the destination BufferSource, but only if format is one of RGBA, RGBX, BGRA, BGRX, otherwise it is ignored. If it does not exist, srgb is used." |
| F38 | https://w3c.github.io/webcodecs/#convert-predefinedcolorspace-to-videocolorspace | 2026-11-10 | "Assert: colorSpace is equal to one of srgb or display-p3." |
| F39 | https://w3c.github.io/webcodecs/#convert-to-rgb-frame | 2026-11-10 | "Let resource be a new media resource containing the result of conversion of media resource referenced by frame’s [[resource reference]] into a color space and pixel format specified by [[color space]] and [[format]] respectively." |
| F40 | https://w3c.github.io/webcodecs/#dom-videoframe-allocationsize | 2026-11-10 | "Returns the minimum byte length for a valid destination BufferSource to be used with copyTo() with the given options." |
| F41 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/VideoFrame.json | 2026-11-10 | `"format_property"`: `"chrome": {"version_added": "127"}`, `"firefox": {"version_added": "130"}`, `"safari": {"version_added": false}` |
| F42 | https://w3c.github.io/webcodecs/#videocolorspace | 2026-11-10 | "readonly attribute VideoColorPrimaries? primaries; readonly attribute VideoTransferCharacteristics? transfer; readonly attribute VideoMatrixCoefficients? matrix; readonly attribute boolean? fullRange;" |
| F43 | https://w3c.github.io/webcodecs/#videocolorprimaries | 2026-11-10 | "smpte432 Color primaries used by P3 D65, as described by [H.273] section 8.1 table 2 value 12." / "bt2020-ncl Matrix coefficients used by BT.2020 NCL, as described by [H.273] section 8.3 table 4 value 9." |
| F44 | https://w3c.github.io/webcodecs/#output-videoframes | 2026-11-10 | "Detection is made on a best-effort basis." / "Authors can override the detected VideoColorSpace by providing a colorSpace in the VideoDecoderConfig." |
| F45 | https://w3c.github.io/webcodecs/#videoframe-pick-color-space | 2026-11-10 | "Otherwise, if [[format]] is an RGB format return a new instance of the sRGB Color Space" / "Otherwise, return a new instance of the REC709 Color Space." |
| F46 | https://w3c.github.io/webcodecs/#rec709-color-space | 2026-11-10 | "[[matrix]] is set to bt709, [[full range]] is set to false" |
| F47 | https://w3c.github.io/webcodecs/#raw-media-memory-model | 2026-11-10 | "Authors are encouraged to call close() immediately when frames are no longer needed." |
| F48 | https://w3c.github.io/webcodecs/#dom-videodecoder-decode | 2026-11-10 | "The underlying media resources are owned by the VideoDecoder and failing to release them (or waiting for garbage collection) can cause decoding to stall." |
| F49 | https://w3c.github.io/webcodecs/#codec-system-resources | 2026-11-10 | "Such resources MAY be quickly exhausted and SHOULD be released immediately when no longer in use." |
| F50 | https://w3c.github.io/webcodecs/#dom-videoframe-close | 2026-11-10 | "Clears all state and releases the reference to the media resource. Close is final." |
| F51 | https://w3c.github.io/webcodecs/#raw-media-memory-model-reference-counting | 2026-11-10 | "A media resource MUST remain alive at least as long as it continues to be referenced by a [[resource reference]]." / "Creates a new VideoFrame with a reference to the same media resource." |
| F52 | https://w3c.github.io/webcodecs/#videoframe-initialize-frame-from-other-frame | 2026-11-10 | "Let resource be the media resource referenced by otherFrame’s [[resource reference]]. Assign a new reference for resource to frame’s [[resource reference]]." |
| F53 | https://w3c.github.io/webcodecs/#raw-media-memory-model-transfer-serialization | 2026-11-10 | "Transferring an AudioData or VideoFrame moves its [[resource reference]] to the destination object and closes (as in close()) the source object." / "Serializing an AudioData or VideoFrame effectively clones (as in clone()) the source object" |
| F54 | https://w3c.github.io/webcodecs/#videoframe-transfer-serialization | 2026-11-10 | "If forStorage is true, throw a DataCloneError." / "If value’s [[Detached]] is true, throw a DataCloneError DOMException." |
| F55 | https://w3c.github.io/webcodecs/#dom-videoframe-videoframe-data-init | 2026-11-10 | "If data.byteLength is less than combinedLayout’s allocationSize, throw a TypeError." |
| F56 | https://w3c.github.io/webcodecs/#dom-videoframe-videoframe-data-init | 2026-11-10 | "If init.transfer contains an ArrayBuffer referenced by data the User Agent MAY choose to: Let resource be a new media resource referencing pixel data in data." / "Perform DetachArrayBuffer on transferable" |
| F57 | https://w3c.github.io/webcodecs/#dom-videoframe-videoframe | 2026-11-10 | "If timestamp does not exist in init, throw a TypeError." |
| F58 | https://w3c.github.io/webcodecs/#dom-videoframe-videoframe | 2026-11-10 | "If image is not origin-clean, then throw a SecurityError DOMException." |
| F59 | https://w3c.github.io/webcodecs/#dom-videoframe-videoframe | 2026-11-10 | "If image’s networkState attribute is NETWORK_EMPTY, then throw an InvalidStateError DOMException. Let currentPlaybackFrame be the VideoFrame at the current playback position." |
| F60 | https://w3c.github.io/webcodecs/#videoframe-initialize-frame-from-other-frame | 2026-11-10 | "If init.alpha is discard, assign otherFrame.format’s equivalent opaque format format." |
| F61 | https://w3c.github.io/webcodecs/#dom-videoframe-videoframe-data-init | 2026-11-10 | "\"height\" → init.codedWidth ]»" |
| F62 | https://w3c.github.io/webcodecs/#videoframe-rendering | 2026-11-10 | "When rendered, for example by CanvasDrawImage drawImage(), a VideoFrame MUST be converted to a color space compatible with the rendering target, unless color conversion is explicitly disabled." / "Color space conversion during ImageBitmap construction is controlled by ImageBitmapOptions colorSpaceConversion." |
| F63 | https://html.spec.whatwg.org/multipage/canvas.html#colour-spaces-and-colour-correction | 2026-11-10 | "enum PredefinedColorSpace { \"srgb\", \"srgb-linear\", \"display-p3\", \"display-p3-linear\" };" |
| F64 | https://html.spec.whatwg.org/multipage/canvas.html#canvasimagesource | 2026-11-10 | "When a CanvasImageSource object represents a VideoFrame, the object's pixel data must be used as the source image, and the source image's dimensions must be the object's [[display width]] and [[display height]]." |
| F65 | https://html.spec.whatwg.org/multipage/canvas.html#canvascolortype | 2026-11-10 | "The \"unorm8\" value indicates that the type for all color components is 8-bit unsigned normalized. The \"float16\" value indicates that the type for all color components is 16-bit floating point." |
| F66 | https://html.spec.whatwg.org/multipage/canvas.html#drawing-images | 2026-11-10 | "Otherwise, the image must be rendered using nearest-neighbor interpolation." / "This specification does not define the precise algorithm to use when scaling an image down" / "The user agent may use any filtering algorithm (for example bilinear interpolation or nearest-neighbor)." |
| F67 | https://html.spec.whatwg.org/multipage/canvas.html#premultiplied-alpha-and-the-2d-rendering-context | 2026-11-10 | "converting between premultiplied and non-premultiplied alpha is a lossy operation on colors that are not fully opaque." / "must use premultiplied alpha to represent transparent colors." |
| F68 | https://html.spec.whatwg.org/multipage/canvas.html#colour-spaces-and-colour-correction | 2026-11-10 | "Color space conversion must be applied to the canvas's backing store when rendering the canvas to the output device." |
| F69 | https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagedatapixelformat | 2026-11-10 | "Each element represents the 8-bit unsigned normalized value for that component." / "The \"rgba-float16\" value indicates that the data attribute of an ImageData must be of type Float16Array." |
| F70 | https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap | 2026-11-10 | "Set imageBitmap's bitmap data to a copy of image's visible pixel data, cropped to the source rectangle with formatting." / "The user agent should use the value of the resizeQuality option to guide the choice of scaling algorithm." |
| F71 | https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#cropped-to-the-source-rectangle-with-formatting | 2026-11-10 | "If image is an img element or a Blob object, let val be the value of the colorSpaceConversion member of options" |
| F72 | https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html | 2026-11-10 | "VideoFrame) TexImageSource;" |
| F73 | https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html | 2026-11-10 | "First, the source image data is conceptually converted to the color space specified by the unpackColorSpace attribute, except if the the UNPACK_COLORSPACE_CONVERSION_WEBGL pixel storage parameter is set to NONE." / "If a packed pixel format is specified which would imply loss of bits of precision from the image data, this loss of precision must occur." |
| F74 | https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html | 2026-11-10 | "If set to NONE, no colorspace conversion is applied, other than conversion to RGBA. (For example, a rec709 YUV video is still converted to rec709 RGB data, but not then converted to e.g. srgb RGB data)" |
| F75 | https://gpuweb.github.io/gpuweb/#color-spaces | 2026-11-10 | "WebGPU does not provide color management. All values within WebGPU (such as texture elements) are raw numeric values, not color-managed color values." |
| F76 | https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html | 2026-11-10 | "If the source is an HTMLImageElement or ImageBitmap containing an RGB or RGBA lossless image with 8 bits per channel, the browser guarantees that the full precision of all channels is preserved." |
| F77 | https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/1.0/index.html | 2026-11-10 | "The width and height of the texture are set to the width and height of the uploaded frame of the video in pixels." |
| F78 | https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/2.0/index.html | 2026-11-10 | "Therefore, only converting to unsigned integer of at most 8 bits, half float, or float is allowed."; the table of allowed combinations lists `RGB10_A2` / `RGBA` / `UNSIGNED_INT_2_10_10_10_REV` |
| F79 | https://gpuweb.github.io/gpuweb/#dictdef-gpuexternaltexturedescriptor | 2026-11-10 | "required (HTMLVideoElement or VideoFrame) source; PredefinedColorSpace colorSpace = \"srgb\";" |
| F80 | https://gpuweb.github.io/gpuweb/#dom-gpudevice-importexternaltexture | 2026-11-10 | "Let data be the result of converting the current image contents of source into the color space descriptor.colorSpace with unpremultiplied alpha." |
| F81 | https://gpuweb.github.io/gpuweb/wgsl/#textureload | 2026-11-10 | "@must_use fn textureLoad(t: texture_external, coords: vec2<C>) -> vec4<f32>" |
| F82 | https://gpuweb.github.io/gpuweb/#gpuexternaltexture | 2026-11-10 | "It is implementation-dependent whether, for any given external texture, the sampler (and filtering) is applied before or after conversion from underlying values into the specified color space." |
| F83 | https://gpuweb.github.io/gpuweb/#gpuexternaltexture | 2026-11-10 | "The configuration used internally by an implementation may be inconsistent across time, systems, user agents, media sources, or even frames within a single video source." |
| F84 | https://gpuweb.github.io/gpuweb/#typedefdef-gpucopyexternalimagesource | 2026-11-10 | "HTMLVideoElement or VideoFrame or HTMLCanvasElement or OffscreenCanvas) GPUCopyExternalImageSource;" |
| F85 | https://gpuweb.github.io/gpuweb/#dom-gpuqueue-copyexternalimagetotexture | 2026-11-10 | "unorm/unorm-srgb or float/ufloat format (not snorm, uint, or sint)." |
| F86 | https://gpuweb.github.io/gpuweb/#dictdef-gpucopyexternalimagedestinfo | 2026-11-10 | "PredefinedColorSpace colorSpace = \"srgb\"; boolean premultipliedAlpha = false;" |
| F87 | https://gpuweb.github.io/gpuweb/#dom-gpuqueue-copyexternalimagetotexture | 2026-11-10 | "Let srcColor be the color-managed color value of the pixel at (srcOrigin.x + x, srcOrigin.y + srcY) of source.source." |
| F88 | https://gpuweb.github.io/gpuweb/#external-source-dimensions | 2026-11-10 | "VideoFrame.displayWidth, VideoFrame.displayHeight" |
| F89 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/HTMLCanvasElement.json | 2026-11-10 | `"options_colorType_parameter"`: `"chrome": {"version_added": "137"}`, `"firefox": {"version_added": false}`, `"safari": {"version_added": false}` |
| F90 | https://www.w3.org/TR/webgpu/ | 2026-11-10 | "W3C Candidate Recommendation Draft, 15 September 2026" |
| F91 | https://gpuweb.github.io/gpuweb/#external-texture-creation | 2026-11-10 | "An external texture created from a VideoFrame expires (is destroyed) when, and only when, the source VideoFrame is closed" / "Garbage collection is unpredictable, so this may still stall the video decoder." |
| F92 | https://gpuweb.github.io/gpuweb/#color-space-conversions | 2026-11-10 | "these colors are preserved through color space conversion, with intermediate computations having at least the precision of the source." |
| F93 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/GPUDevice.json | 2026-11-10 | `"importExternalTexture"`: `"chrome": [{"version_added": "144", "notes": "Supported on ChromeOS, macOS, Windows, and Linux (Intel Gen12+ GPUs only)."}, {"version_added": "113", "version_removed": "144", "partial_implementation": true, "notes": "Supported on ChromeOS, macOS, and Windows."}]`, `"firefox": {"version_added": "144", "partial_implementation": true, "notes": "Supported on Windows only, in all contexts except for service workers."}`, `"safari": {"version_added": "26"}` |
| F94 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/GPUQueue.json | 2026-11-10 | `"copyExternalImageToTexture"`: `"chrome": [{"version_added": "144", "notes": "Supported on ChromeOS, macOS, Windows, and Linux (Intel Gen12+ GPUs only)."}, {"version_added": "113", "version_removed": "144", "partial_implementation": true, "notes": "Supported on ChromeOS, macOS, and Windows."}]`, `"firefox": {"version_added": "141", "partial_implementation": true, …}`, `"safari": {"version_added": "26"}` |
| F100 | https://www.w3.org/TR/media-capabilities/ | 2026-11-10 | "W3C Working Draft, 9 November 2026" |
| F101 | https://w3c.github.io/media-capabilities/ | 2026-11-10 | "The API indicates if the configuration is supported and whether the playback is expected to be smooth and/or power efficient." |
| F102 | https://w3c.github.io/media-capabilities/#create-a-mediacapabilitiesdecodinginfo | 2026-11-10 | "If the user agent is able to decode the media represented by configuration at the indicated framerate without dropping frames, set smooth to true. Otherwise set it to false." / "If the user agent is able to decode the media represented by configuration in a power efficient manner, set powerEfficient to true." |
| F103 | https://w3c.github.io/media-capabilities/#media-capabilities-info | 2026-11-10 | "Encoding or decoding is considered power efficient when the power draw is optimal." / "User agents SHOULD NOT mark hardware encoding or decoding as power efficient by default, as non-hardware-accelerated codecs can be just as efficient, particularly with low-resolution video." |
| F104 | https://w3c.github.io/media-capabilities/#media-capabilities-info | 2026-11-10 | "If the encrypted decoding configuration is supported, the resulting MediaCapabilitiesInfo will include a MediaKeySystemAccess." |
| F105 | https://www.w3.org/TR/media-capabilities/#mediadecodingtype | 2026-11-10 | "enum MediaDecodingType { \"file\", \"media-source\", \"webrtc\" };" |
| F106 | https://w3c.github.io/media-capabilities/#capabilities-model | 2026-11-10 | "This specification supports MediaDecodingType values of file, media-source or webrtc" |
| F107 | https://w3c.github.io/media-capabilities/#videoconfiguration | 2026-11-10 | "required DOMString contentType; required unsigned long width; required unsigned long height; required unsigned long long bitrate; required double framerate; boolean hasAlphaChannel; HdrMetadataType hdrMetadataType; ColorGamut colorGamut; TransferFunction transferFunction; DOMString scalabilityMode; boolean spatialScalability;" |
| F108 | https://w3c.github.io/media-capabilities/#check-mime-type-validity | 2026-11-10 | "If the value of mimeType.parameters[\"codecs\"] does not describe a single media codec, return false." |
| F109 | https://w3c.github.io/media-capabilities/#videoconfiguration | 2026-11-10 | "colorGamut is only applicable to MediaDecodingConfiguration for types media-source and file." |
| F110 | https://w3c.github.io/media-capabilities/#videoconfiguration | 2026-11-10 | "scalabilityMode is only applicable to MediaEncodingConfiguration for type webrtc." / "If an optional member is specified for a MediaDecodingType or MediaEncodingType to which it’s not applicable, return false and abort these steps." |
| F111 | https://w3c.github.io/media-capabilities/#mediacapabilitieskeysystemconfiguration | 2026-11-10 | "If keySystemConfiguration exists: The type MUST be media-source or file." |
| F112 | https://w3c.github.io/media-capabilities/#dom-mediacapabilities-decodinginfo | 2026-11-10 | "If configuration is not a valid MediaDecodingConfiguration, return a Promise rejected with a newly created TypeError." / "If the global object is of type WorkerGlobalScope, return a Promise rejected with a newly created DOMException whose name is InvalidStateError." |
| F113 | https://w3c.github.io/media-capabilities/#navigators-extensions | 2026-11-10 | "[Exposed=Worker] partial interface WorkerNavigator { [SameObject] readonly attribute MediaCapabilities mediaCapabilities; };" |
| F114 | https://w3c.github.io/media-capabilities/#fingerprinting | 2026-11-10 | "Adding colorGamut, transferFunction, and hdrMetadataType has the potential to add significant entropy." / "it would be recommended to fake a given set of capabilities (i.e., decode up to 1080p VP9, etc.)" |
| F120 | https://html.spec.whatwg.org/multipage/media.html#the-video-element | 2026-11-10 | "When the current playback position changes such that the last frame rendered is no longer the frame corresponding to the current playback position in the video, the new frame must be rendered." / "Which frame in a video stream corresponds to a particular playback position is defined by the video stream's format." |
| F121 | https://html.spec.whatwg.org/multipage/media.html#best-practices-for-authors-using-media-elements | 2026-11-10 | "Similarly, when the playback rate is not exactly 1.0, hardware, software, or format limitations can cause video frames to be dropped and audio to be choppy or muted." |
| F122 | https://html.spec.whatwg.org/multipage/media.html#the-video-element | 2026-11-10 | "video content should be rendered inside the element's playback area such that the video content is shown centered in the playback area at the largest possible size that fits completely within it, with the video content's aspect ratio being preserved." |
| F123 | https://html.spec.whatwg.org/multipage/canvas.html#canvasimagesource | 2026-11-10 | "the frame at the current playback position when the method with the argument is invoked must be used as the source image when rendering the image for CanvasRenderingContext2D APIs, and the source image's dimensions must be the natural width and natural height of the media resource (i.e., after any aspect-ratio correction has been applied)." |
| F124 | https://www.w3.org/TR/media-source-2/#mediasource | 2026-11-10 | "[Exposed=(Window,DedicatedWorker)]" / "canConstructInDedicatedWorker attribute Returns true." |
| F125 | https://www.w3.org/TR/media-source-2/#mediasource-attach | 2026-11-10 | "Attaching a MediaSource that was constructed in a DedicatedWorkerGlobalScope can only be done by obtaining a handle from it using handle, transferring that MediaSourceHandle to the Window context and assigning it to the media element srcObject attribute." |
| F126 | https://www.w3.org/TR/media-source-2/#managedmediasource-interface | 2026-11-10 | "A ManagedMediaSource is a MediaSource that actively manages its memory content. Unlike a MediaSource, the user agent can evict content through the memory cleanup algorithm from its sourceBuffers (populated with ManagedSourceBuffer) for any reason." |
| F127 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/MediaSource.json | 2026-11-10 | `"handle"`: `"chrome": {"version_added": "108"}`, `"firefox": {"version_added": false}`, `"safari": {"version_added": "18"}` |
| F128 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/ManagedMediaSource.json | 2026-11-10 | `"chrome": {"version_added": false}`, `"firefox": {"version_added": false}`, `"safari": {"version_added": "17"}`, `"safari_ios": {"version_added": "17.1"}` |
| F129 | https://www.w3.org/TR/media-source-2/#videoplaybackquality | 2026-11-10 | "The video playback quality metrics described in previous revisions of this specification (e.g., sections 5 and 10 of the Candidate Recommendation) are now being developed as part of [MEDIA-PLAYBACK-QUALITY]." |
| F130 | https://wicg.github.io/video-rvfc/ | 2026-11-10 | "Draft Community Group Report, 2 August 2024" / "It is not a W3C Standard nor is it on the W3C Standards Track." |
| F131 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/HTMLVideoElement.json | 2026-11-10 | `"requestVideoFrameCallback"`: `"chrome": {"version_added": "83"}`, `"firefox": {"version_added": "132", …}`, `"safari": {"version_added": "15.4"}` |
| F132 | https://wicg.github.io/video-rvfc/#video-frame-callback-metadata-attributes | 2026-11-10 | "media pixels are defined as a media resource’s visible decoded pixels, without pixel aspect ratio adjustments." / "A count of the number of frames submitted for composition. Allows clients to determine if frames were missed between VideoFrameRequestCallbacks. MUST be monotonically increasing." |
| F133 | https://wicg.github.io/video-rvfc/#introduction | 2026-11-10 | "Best effort in this case means that, even with a normal work load, a callback can occasionally be fired one v-sync late, relative to when the new video frame was presented." / "if there is a heavy load on the main thread, we might not get a callback for every frame (as measured by a discontinuity in the presentedFrames)." |
| F134 | https://wicg.github.io/video-rvfc/#procedures | 2026-11-10 | "a 25fps video playing in a browser that paints at 60Hz would fire callbacks at 25Hz; a 120fps video in that same 60Hz browser would fire callbacks at 60Hz." / "There are no strict timing guarantees when it comes to how soon callbacks are run after a new video frame has been presented." |
| F135 | https://html.spec.whatwg.org/multipage/canvas.html#check-the-usability-of-the-image-argument | 2026-11-10 | "If image's readyState attribute is either HAVE_NOTHING or HAVE_METADATA, then return bad." |

### Sources (C)

| id | URL | read | verbatim quote |
|---|---|---|---|
| C1 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/VideoDecoder.json | 2026-11-10 | `"chrome": { "version_added": "94" }, "chrome_android": "mirror", "edge": "mirror", … "opera": "mirror", … "samsunginternet_android": "mirror", "webview_android": "mirror"` (same for `isConfigSupported_static`, `decodeQueueSize`) |
| C2 | same file | 2026-11-10 | `dequeue_event`: `"chrome": { "version_added": "106" }`; `configure.flip_option`: `"chrome": { "version_added": "138" }` |
| C3 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/VideoFrame.json | 2026-11-10 | `copyTo`: `"chrome": { "version_added": "94" }`; `copyTo.format_property`: `"description": "\`format\` property" … "chrome": { "version_added": "127" }`; `metadata`: `"version_added": "145"` |
| C4 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/EncodedVideoChunk.json and …/api/ImageDecoder.json | 2026-11-10 | `"chrome": { "version_added": "94" }` (both; `isTypeSupported_static` 94) |
| C5 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/HTMLVideoElement.json and …/api/MediaCapabilities.json | 2026-11-10 | `requestVideoFrameCallback`: `"version_added": "83"`; `decodingInfo`: `"version_added": "66", "notes": ["\`codecs\` string can contain any subset of optional parameters (should be all or none).", "Errors if \`codecs\` string contains unexpected characters (should evaluate string up to character)."]` |
| C6 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/ManagedMediaSource.json and …/api/MediaSource.json | 2026-11-10 | ManagedMediaSource: `"chrome": { "version_added": false }`; MediaSource `worker_support`: `"chrome": { "version_added": "108" }` |
| C7 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/webassembly/api.json and …/webassembly/fixed-width-SIMD.json, relaxed-SIMD.json, memory64.json, bulk-memory-operations.json | 2026-11-10 | api: `"chrome": {"version_added":"57"}`, `"edge": {"version_added":"16"}`; `"91"`, `"114"`, `"133"`, `"75"` respectively |
| C8 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/webassembly/threads-and-atomics.json | 2026-11-10 | `"chrome": { "version_added": "74" }, "chrome_android": { "version_added": "88" }, "edge": "mirror", … "webview_android": { "version_added": false }` |
| C9 | https://chromestatus.com/api/v0/features/5669293909868544 | 2026-11-10 | `"summary": "Provides efficient, low-level access to built-in (software and hardware) media encoders and decoders."`, `"desktop": 94, "android": 94, "webview": 94` |
| C10 | https://chromestatus.com/api/v0/features/4561928577875968 | 2026-11-10 | `"all_platforms_descr": "Reuses existing internal image decoders already available."`, `"desktop": 94, "android": 94, "webview": 94` |
| C11 | https://chromestatus.com/api/v0/features/5186511939567616 | 2026-11-10 | "Enables support for decoding HEVC video on platforms where hardware (e.g., GPU, media accelerator, etc) for decoding HEVC is available (Android 5.0+, macOS 11+, with supported hardware on Windows 8+ and ChromeOS)." `"desktop": 107` |
| C12 | https://chromestatus.com/api/v0/features/4668827056209920 | 2026-11-10 | "Specifying VideoFrameCopyToOptions.format and VideoFrameCopyToOptions.colorSpace make it possible to convert frames to RGB pixel format"; `"text": "In developer trial (Behind a flag)", … "desktop": 127, "android": 127, "webview": null` |
| C13 | https://chromestatus.com/api/v0/features/5177263249162240 | 2026-11-10 | "MSE-in-Workers has since been relaunched on-by-default in M108 beginning with 108.0.5334.0."; `"flag_name": "MediaSourceInWorkers"` |
| C14 | https://chromestatus.com/api/v0/features/5649291471224832 | 2026-11-10 | `"flag_name": "--enable-blink-features=MediaSourceExtensionsForWebCodecs"`, `"text": "Origin trial"` |
| C15 | https://chromestatus.com/api/v0/features/5078348864159744 | 2026-11-10 | "This feature adds support for using a VideoFrame as the source for a GPUExternalTexture and a copyExternalImageToTexture call." `"text": "Origin trial"` |
| C16 | https://chromestatus.com/api/v0/features/6335927192387584 | 2026-11-10 | `"desktop": 83, "android": 83, "webview": null` |
| C17 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/renderers/default_decoder_factory.cc | 2026-11-10 | "Prefer an external decoder since one will only exist if it is hardware accelerated."; then `OffloadingVpxVideoDecoder`, `OffloadingDav1dVideoDecoder`, `OffloadingDav2dVideoDecoder` (if `kDav2dVideoDecoder`), `FFmpegVideoDecoder` |
| C18 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/media_options.gni | 2026-11-10 | `enable_dav1d_decoder = use_blink`; `enable_av1_decoder = enable_dav1d_decoder`; `enable_ffmpeg_video_decoders = media_use_ffmpeg && (!is_android \|\| current_cpu != "arm")`; `enable_hevc_parser_and_hw_decoder = proprietary_codecs && (use_fuzzing_engine \|\| is_win \|\| is_apple \|\| is_android \|\| is_linux)` |
| C19 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/DEPS and …/third_party/dav1d/README.chromium | 2026-11-10 | `'src/third_party/dav1d/libdav1d': Var('chromium_git') + '/external/github.com/videolan/dav1d.git' + '@' + '4e3ab21fbbf84a4bd283ea27f96287fcd7c228c1'`; README: "Version: master" |
| C20 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/base/supported_types.cc | 2026-11-10 | `IsDecoderBuiltInVideoCodec`: `if (codec == VideoCodec::kVP8 \|\| codec == VideoCodec::kVP9) { return true; }` …; VP9: "High bit depth capabilities may be toggled via LibVPX config flags." `case VP9PROFILE_PROFILE2: case VP9PROFILE_PROFILE3: return vpx_supports_hbd;`; under `#if BUILDFLAG(IS_ANDROID)`: "After Q, all VP9 profiles are required by Android" |
| C21 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/mojo/services/gpu_mojo_media_client_linux.cc, …/gpu_mojo_media_client_cros.cc, …/media/base/media_switches.cc | 2026-11-10 | "VaapiVideoDecoder flag is required for VaapiVideoDecoder."; cros: `case VideoDecoderType::kVaapi: case VideoDecoderType::kV4L2: { … MailboxVideoFrameConverter::Create(`; switches: `BASE_FEATURE(kAcceleratedVideoDecodeLinux, "AcceleratedVideoDecoder", #if BUILDFLAG(USE_VAAPI) base::FEATURE_ENABLED_BY_DEFAULT);` |
| C22 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/mojo/services/gpu_mojo_media_client_win.cc | 2026-11-10 | `return D3DVideoDecoder::Create(`; `if (base::FeatureList::IsEnabled(kD3D12VideoDecoder)) {` |
| C23 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/gpu/mac/video_toolbox_video_decoder.cc (and gpu_mojo_media_client_mac.cc) | 2026-11-10 | `constexpr gfx::Size kLegacyMaxSize(4096, 4096); constexpr gfx::Size kModernMaxSize(8192, 8192);`; AV1 `/*profile_min=*/AV1PROFILE_PROFILE_MAIN, /*profile_max=*/AV1PROFILE_PROFILE_MAIN`; "HEVC hardware decoding is limited to kMinSize, but because we allow the OS software decoder we report the minimum possible HEVC encode size." |
| C24 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/gpu/android/media_codec_video_decoder.cc (and gpu_mojo_media_client_android.cc) | 2026-11-10 | "Don't allow OS software decoding for bundled software decoders unless the content is encrypted."; "Prioritize hardware decoder. Software decoder will be selected as a fallback option."; `return MediaCodecVideoDecoder::GetSupportedConfigs();` |
| C25 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/libvpx/README.chromium | 2026-11-10 | "Revision: fb0a26ad923b58c3663aaa9523992cf779b1563b"; "CPEPrefix: cpe:/a:webmproject:libvpx:1.17.0" |
| C26 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/filters/vpx_video_decoder.cc | 2026-11-10 | `if (config.codec() != VideoCodec::kVP8 && config.codec() != VideoCodec::kVP9) return false;` |
| C27 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/filters/ffmpeg_video_decoder.cc | 2026-11-10 | "We only build support for H.264." `return codec == VideoCodec::kH264 && IsDecoderBuiltInVideoCodec(codec);` |
| C28 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/base/media_switches.cc | 2026-11-10 | `BASE_FEATURE(kPlatformHEVCDecoderSupport, base::FEATURE_ENABLED_BY_DEFAULT);` `BASE_FEATURE(kAllowMediaCodecSoftwareDecoder, base::FEATURE_DISABLED_BY_DEFAULT);` `BASE_FEATURE(kD3D12VideoDecoder, base::FEATURE_DISABLED_BY_DEFAULT);` |
| C29 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/gpu/args.gni | 2026-11-10 | `use_vaapi = is_linux && !is_castos && (ozone_platform_x11 \|\| ozone_platform_wayland) && (target_cpu == "x86" \|\| target_cpu == "x64" \|\| target_cpu == "arm64")` |
| C30 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/video_decoder_broker.cc | 2026-11-10 | `if (hardware_preference_ != HardwarePreference::kPreferSoftware) {` … `if (hardware_preference_ == HardwarePreference::kPreferHardware) { decoder_factory_ = std::move(external_decoder_factory); return; }` |
| C31 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/video_decoder.cc | 2026-11-10 | `if ((hw_pref == HardwarePreference::kPreferSoftware && !media::IsDecoderBuiltInVideoCodec(video_type->codec)) \|\| !media::IsDecoderSupportedVideoType(*video_type)) { support->setSupported(false);`; "If hardware is preferred, asynchronously check for a hardware decoder."; "Otherwise, the config is supported." |
| C32 | same file | 2026-11-10 | "This configuration is only supported by the software decoder."; "Guess 720p if no coded size hint is provided. This choice should result in a preference for hardware decode." |
| C33 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/base/supported_types.cc | 2026-11-10 | `#elif BUILDFLAG(IS_ANDROID) return base::android::android_info::sdk_int() >= base::android::android_info::SDK_VERSION_Q &&` |
| C34 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/video_pixel_format.idl | 2026-11-10 | `"I420", "I420P10", "I420P12",` … `"NV12",` … `"BGRX",` |
| C35 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/filters/davxd_video_decoder_base.cc (and dav1d_video_decoder.cc) | 2026-11-10 | "Single plane monochrome images will be converted to standard 3 plane ones since Chromium doesn't support single Y plane images." `case 10: return PIXEL_FORMAT_YUV420P10; case 12: return PIXEL_FORMAT_YUV420P12;`; dav1d: `s.frame_size_limit = limits::kMaxCanvas;` |
| C36 | same file as C35 | 2026-11-10 | `const uint16_t kBlankUV = (1 << bit_depth) / 2;`; `constexpr uint8_t kBlankUV = 256 / 2;` |
| C37 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/dav1d/BUILD.gn and …/third_party/dav1d/config/linux/x64/config.h | 2026-11-10 | `static_library("dav1d_10bit") {` … `cflags += [ "-DBITDEPTH=16" ]`; `#define CONFIG_16BPC 1` |
| C38 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/filters/vpx_video_decoder.cc | 2026-11-10 | `case VPX_IMG_FMT_I42016: switch (vpx_image->bit_depth) { case 10: … PIXEL_FORMAT_YUV420P10; break; case 12: codec_format = PIXEL_FORMAT_YUV420P12;` |
| C39 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/ffmpeg/ffmpeg_common.cc | 2026-11-10 | `case AV_PIX_FMT_GBRP: return PIXEL_FORMAT_I444;` … `case AV_PIX_FMT_YUV420P12LE: return PIXEL_FORMAT_YUV420P12;` … "FFmpeg knows more pixel formats than Chromium cares about." |
| C40 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/gpu/windows/d3d11_texture_selector.cc | 2026-11-10 | `case DXGI_FORMAT_P010: case DXGI_FORMAT_P016: {` … "If device support P010 zero copy, then try P010 firstly." `output_pixel_format = PIXEL_FORMAT_P010LE;` |
| C41 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/gpu/android/video_frame_factory_impl.cc | 2026-11-10 | "Since we create all the textures/abstract textures as well as shared images for video to be of format RGBA, we need to use the pixel format as ABGR here(which corresponds to 32bpp RGBA)." `VideoPixelFormat pixel_format = PIXEL_FORMAT_ABGR;` |
| C42 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/gpu/mac/video_toolbox_frame_converter.cc | 2026-11-10 | `OSType pixel_format = IOSurfaceGetPixelFormat(handle.io_surface().get());` `gfx::IOSurfacePixelFormatToSharedImageFormat(pixel_format);` |
| C43 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/video_frame.cc | 2026-11-10 | "Readback is not supported for high bit-depth formats." `if (!mappable && frame.BitDepth() != 8u) { return std::nullopt; }`; "Externally-sampled frames can be read back as YUV (NV12/I420) or RGB." `return media::PIXEL_FORMAT_XRGB;`; `if (!(mappable \|\| texturable)) { return std::nullopt; }`; "Operation is not supported when format is null." |
| C44 | same file | 2026-11-10 | `bool IsFormatEnabled(media::VideoPixelFormat fmt) { switch (fmt) { case media::PIXEL_FORMAT_I420:` … `case media::PIXEL_FORMAT_YUV444AP10: return true; default: return false;` (no `PIXEL_FORMAT_P010LE`) |
| C45 | same file | 2026-11-10 | "copyTo() doesn't support explicit copy to non-RGB formats. Remove format parameter to use VideoFrame's pixel format."; "This pixel conversion to this color space is not supported." |
| C46 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/base/limits.h | 2026-11-10 | `inline constexpr int kMaxDimension = (1 << 15) - 1;  // 32767`; `inline constexpr int kMaxCanvas = (1 << 29) - 1;  // 23170 x 23170`; `kMaxVideoDecodeThreads = 16;` |
| C47 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/media/gpu/windows/supported_profile_helpers.cc | 2026-11-10 | `constexpr gfx::Size kMinResolution(64, 64); constexpr gfx::Size kMinVP9ResolutionForNvidia(128, 128); constexpr gfx::Size kMinAV1ResolutionForNvidia(128, 128); constexpr gfx::Size kMinHEVCResolutionForNvidia(144, 144); constexpr gfx::Size kMinResolutionForQualcomm(96, 96);` |
| C48 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/decoder_template.cc | 2026-11-10 | `uint32_t DecoderTemplate<Traits>::decodeQueueSize() { return num_pending_decodes_; }`; `pending_decodes_.size() + 1 > static_cast<size_t>(Traits::GetMaxDecodeRequests(*decoder()))` |
| C49 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/video_decoder_broker.cc | 2026-11-10 | `return decoder_details_ ? decoder_details_->max_decode_requests : 1;` |
| C50 | same file as C48 | 2026-11-10 | "Unexpectedly ran out of decoders during initialize after flush. Close all pending frames and try again."; "Decoder initialization failed, too many decoders in use." |
| C51 | same file as C48 | 2026-11-10 | `if (decoder()->IsPlatformDecoder()) ApplyCodecPressure(); else ReleaseCodecPressure();` |
| C52 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/reclaimable_codec.h and reclaimable_codec.cc | 2026-11-10 | "Use 1.5 minutes since some RDP clients are only ticking at 1 FPM." `base::Seconds(90)`; `return is_applying_pressure_ && global_pressure_exceeded_ && is_backgrounded_;` |
| C53 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/codec_pressure_gauge.cc | 2026-11-10 | "These numbers were picked as roughly 1/4th of the empirical lower limit at which we start getting errors when allocating new codecs." `constexpr int kDecoderPressureThreshold = 6;` … `#elif BUILDFLAG(IS_ANDROID) constexpr int kSharedPressureThreshold = 4;` |
| C54 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/webcodecs_logger.cc | 2026-11-10 | "A VideoFrame was garbage collected without being closed. Applications should call close() on frames when done with them to prevent stalls." |
| C55 | same file as C49 | 2026-11-10 | "This also works around an issue with flushing on Android where the automatic call to Initialize() after Flush() destroys the codec; invalidating any unrendered output buffers. See https://crbug.com/474398415" |
| C56 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/video_decoder.idl and video_frame.idl | 2026-11-10 | `Exposed=(Window,DedicatedWorker), SecureContext,` |
| C57 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/image_decoder.idl | 2026-11-10 | `Exposed=(Window,DedicatedWorker), SecureContext, ImplementedAs=ImageDecoderExternal,` |
| C58 | https://developer.chrome.com/docs/web-platform/best-practices/webcodecs (page "Last updated 2025-01-22 UTC") | 2026-11-10 | "it is preferable to move handling of individual frames and encoded chunks into a web worker."; "Once a frame is no longer needed, call close() to release underlying memory before the garbage collector gets to it"; `if (encoder.encodeQueueSize > 2) {`; "WebCodecs API is only available in secure contexts, so detection will fail if self.isSecureContext is false." |
| C59 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/platform/runtime_enabled_features.json5 | 2026-11-10 | `name: "MediaSourceExtensionsForWebCodecs", status: "experimental", base_feature: "none", origin_trial_feature_name: "MediaSourceExtensionsForWebCodecs",` |
| C60 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/content/public/common/content_switches.cc | 2026-11-10 | "Warning: do not remove or rename this flag, as it is used inside ChromeOS code to implement the DeviceHardwareVideoDecodingEnabled policy." `"disable-accelerated-video-decode"` |
| C61 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/platform/image-decoders/?format=JSON | 2026-11-10 | directory entries: `avif`, `bmp`, `gif`, `ico`, `jpeg`, `jxl`, `png`, `skia`, `testing`, `webp` |
| C62 | https://issues.chromium.org/action/issues/list (POST, query strings as in §Open bugs) and https://issues.chromium.org/issues/<id> | 2026-11-10 | titles as listed in the table, e.g. "VideoPixelFormat I444AP12 is not recognized"; "Implement HBD/HDR/WCG Decoding" |
| C63 | https://issues.chromium.org/action/issues/343014700 and …/action/issues/1311345 | 2026-11-10 | "GBR Video support"; for old ids: "Unsigned-in user does not have permission to view issue 1311345." / "Issue 1138680 does not exist." |
| C64 | same file as C31 | 2026-11-10 | `media_log->SetProperty<media::MediaLogProperty::kVideoDecoderName>(decoder.GetDecoderType()); media_log->SetProperty<media::MediaLogProperty::kIsPlatformVideoDecoder>(decoder.IsPlatformDecoder());` |

### Sources (K)

All read 2026-11-10. WebKit links are pinned at `5dbb0d4dcc9b3c87d4d457fabe6cfb62be40cb40` (shortened as `…/5dbb0d4/`
below, i.e. `https://github.com/WebKit/WebKit/blob/5dbb0d4dcc9b3c87d4d457fabe6cfb62be40cb40/`).

| id | URL | read | verbatim quote |
|---|---|---|---|
| K1 | https://developer.apple.com/app-store/review/guidelines/#2.5.6 | 2026-11-10 | "2.5.6 Apps that browse the web must use the appropriate WebKit framework and WebKit JavaScript. You may apply for an entitlement to use an alternative web browser engine in your app. Learn more about these entitlements for the EU and Japan." |
| K2 | https://developer.apple.com/support/alternative-browser-engines/ | 2026-11-10 | "iOS and iPadOS include capabilities that let apps use alternative browser engines — browser engines other than WebKit — for dedicated browser apps and apps providing in-app browsing experiences in the EU." … "These capabilities are available to EU users on devices running a minimum of iOS 17.4 or iPadOS 18." … "Be distributed solely on iOS and/or iPadOS in the European Union" |
| K3 | https://developer.apple.com/documentation/browserenginekit (JSON: https://developer.apple.com/tutorials/data/documentation/browserenginekit.json) | 2026-11-10 | "Create a browser that renders content using an alternative browser engine." platforms `iOS 17.4`, `iPadOS 18.0`; "Support for alternative browser engines varies by geographic region:" European Union: "To request the entitlements in the EU for an iOS or iPadOS app, see …"; Japan: "To request the entitlements in Japan for an iOS app, see … Also, your app needs to adopt the … checked-allocations entitlement." |
| K4 | https://developer.apple.com/support/alternative-browser-engines-jp/ | 2026-11-10 | "In iOS 26.2 and later, browser engines other than WebKit can be used in two types of apps for users in Japan: Dedicated browser apps that provide a full web browser experience, and apps from browser engine stewards that provide in-app browsing experiences using an embedded browser engine." |
| K5 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/VideoDecoder.json | 2026-11-10 | `"safari": { "version_added": "16.4" }, "safari_ios": "mirror"`; `flip_option`/`rotation_option`: `"safari": { "version_added": false }` |
| K6 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/VideoFrame.json | 2026-11-10 | `VideoFrame`, `copyTo`, `format`: `"safari": { "version_added": "16.4" }`; `copyTo.format_property`: `"safari": { "version_added": false }, "safari_ios": "mirror"` |
| K7 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/EncodedVideoChunk.json | 2026-11-10 | `"safari": { "version_added": "16.4" }, "safari_ios": "mirror"` |
| K8 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/ImageDecoder.json | 2026-11-10 | `"safari": { "version_added": "preview" }, "safari_ios": "mirror"` |
| K9 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/HTMLVideoElement.json | 2026-11-10 | `requestVideoFrameCallback`: `"safari": { "version_added": "15.4" }, "safari_ios": "mirror"` |
| K10 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/MediaCapabilities.json | 2026-11-10 | `decodingInfo`: `"safari": { "version_added": "13" }, "safari_ios": "mirror"` |
| K11 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/ManagedMediaSource.json | 2026-11-10 | `"safari": { "version_added": "17" }, "safari_ios": { "version_added": "17.1" }` |
| K12 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/MediaSource.json | 2026-11-10 | `"safari_ios": { "version_added": "13", "impl_url": "https://webkit.org/b/200147", "partial_implementation": true, "notes": "Exposed in Mobile Safari on iPad but not on iPhone." }`; `worker_support`: `"safari": { "version_added": false }`; `handle`: `"safari": { "version_added": "18" }` |
| K13 | https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes | 2026-11-10 | "Added video-only support for Web Codecs." |
| K14 | https://developer.apple.com/documentation/safari-release-notes/safari-16_5-release-notes | 2026-11-10 | Lockdown Mode, New Restrictions: "Disabled WebCodecs API" |
| K15 | https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes | 2026-11-10 | "Added support for JPEG XL. (100641584)"; "Added support for Managed Media Source on macOS and iPadOS, and added support as a preview on iOS. (30320350)"; "Added support for AV1 codec support to the MediaCapabilities API for devices with hardware support. (97803066)" |
| K16 | https://developer.apple.com/documentation/safari-release-notes/safari-17_4-release-notes | 2026-11-10 | "Added support for VP8/VP9 and WebM on iOS and iPadOS. (64825245)"; "Added WebCodecs HEVC support. (112067287)" |
| K17 | https://developer.apple.com/documentation/safari-release-notes/safari-17_5-release-notes | 2026-11-10 | "Added support for WebCodecs AV1 when an AV1 hardware decoder is available. (123433815)"; "Fixed WebCodecs to correctly use the VP9 hardware decoder. (123475343)" |
| K18 | https://developer.apple.com/documentation/safari-release-notes/safari-26_4-release-notes | 2026-11-10 | "Fixed an issue where WebCodecs VideoDecoder could output H264 frames in the wrong order. (168046597)" |
| K19 | https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes | 2026-11-10 | "Added support for overriding color space for hardware video decoders in WebCodecs. (178717498)"; "Fixed an issue where the WebCodecs VideoDecoder API output frames in an incorrect order for videos containing B-frames. (145093697)" |
| K20 | https://developer.apple.com/documentation/safari-release-notes/safari-27_3-release-notes | 2026-11-10 | "Released November 3, 2026 — 27.3 beta"; "Added support for the WebCodecs ImageDecoder API. (184857272)"; "Fixed WebCodecs VP8, VP9, and AV1 encoders encoding uninitialized data for 10-bit frames. (189532957)"; "Fixed 8-bit YUV 4:2:2 VP9 frames from the software decoder being converted with the U and V planes swapped. (189584834)" |
| K21 | https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes | 2026-11-10 | "Added support for AVIF on macOS Monterey and macOS Big Sur." |
| K22 | https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ | 2026-11-10 | "Safari 16.4 adds support for the video portion of Web Codecs API." |
| K23 | https://webkit.org/blog/14445/webkit-features-in-safari-17-0/ | 2026-11-10 | "Safari 17.0 adds support for AV1 video on devices with hardware decoding support, like iPhone 15 Pro and iPhone 15 Pro Max."; "Hardware encoding/decoding provides an efficient way support the video codec without an undesired impact on battery life."; "The new Feature Flags panel replaces the previous Experimental Features section of the Develop menu" |
| K24 | https://webkit.org/blog/15063/webkit-features-in-safari-17-4/ | 2026-11-10 | "It’s definitely a better user experience to use hardware decoding. Doing so significantly impacts power usage and makes a battery last longer." … "Video codecs with hardware decoding support on various Apple devices include VP9, h.264, HEVC and AV1." |
| K25 | https://webkit.org/blog/15383/webkit-features-in-safari-17-5/ | 2026-11-10 | "WebKit for Safari 17.5 adds support for AV1 to WebCodecs when an AV1 hardware decoder is available." |
| K26 | https://webkit.org/blog/15865/webkit-features-in-safari-18-0/ | 2026-11-10 | "WebKit for Safari 18.0 adds Workers support for both Managed Media Source (MMS) and Media Source Extensions (MSE)." |
| K27 | https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ ; https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ | 2026-11-10 | 26.0: "Safari 26.0 expands support for WebCodecs API by adding AudioEncoder and AudioDecoder." 27.0: "Safari 27.0 lets you override the color space a hardware VideoDecoder uses when decoding video with WebCodecs." |
| K28 | https://developer.apple.com/videos/play/wwdc2023/10122/ | 2026-11-10 | "Managed Media Source can reduce power usage by telling the webpage when it's a good time to buffer more media data."; "MSE was never made available on iPhones because we couldn't achieve with MSE the required battery savings." |
| K29 | …/5dbb0d4/Source/WebCore/platform/VideoDecoder.cpp#L90-L118 | 2026-11-10 | `if (codecName.startsWith("vp09.02"_s)) { LibWebRTCVPXVideoDecoder::create(LibWebRTCVPXVideoDecoder::Type::VP9_P2, …` / `if (codecName.startsWith("av01."_s)) { LibWebRTCVPXVideoDecoder::create(LibWebRTCVPXVideoDecoder::Type::AV1, …` / `#elif USE(GSTREAMER) GStreamerVideoDecoder::create(codecName, config, …` |
| K30 | …/5dbb0d4/Source/WebKit/WebProcess/GPU/media/RemoteVideoCodecFactory.cpp#L129-L151 | 2026-11-10 | `#if PLATFORM(MAC) if (*type == WebCore::VideoCodecType::VP9 && config.decoding == WebCore::VideoDecoder::HardwareAcceleration::No) return true;` |
| K31 | …/5dbb0d4/Source/WebKit/WebProcess/GPU/webrtc/LibWebRTCCodecs.cpp#L105-L127 | 2026-11-10 | `if (codec.startsWith("vp09.0"_s)) { if (!isSupportingVP9HardwareDecoder()) return { };` … `if (codec.startsWith("av01."_s)) { if (!hasAV1HardwareDecoder()) return { };` |
| K32 | …/5dbb0d4/Source/WebKit/WebProcess/GPU/webrtc/LibWebRTCCodecs.cpp#L129-L143 | 2026-11-10 | `void LibWebRTCCodecs::setHasAV1HardwareDecoder(bool hasAV1HardwareDecoder)` … `settings.setWebRTCAV1CodecEnabled(true); settings.setWebCodecsAV1Enabled(true);` |
| K33 | …/5dbb0d4/Source/WebCore/platform/graphics/cocoa/AV1UtilitiesCocoa.mm#L234 | 2026-11-10 | `s_av1HardwareDecoderAvailableInProcess = canLoad_VideoToolbox_VTIsHardwareDecodeSupported() && VTIsHardwareDecodeSupported('av01');` |
| K34 | …/5dbb0d4/Source/WebCore/platform/libwebrtc/LibWebRTCVPXVideoDecoder.cpp#L184-L192 ; …/5dbb0d4/Source/ThirdParty/libwebrtc/Source/webrtc/modules/video_coding/codecs/vp9/vp9.cc#L92-L94 | 2026-11-10 | `webrtc::CreateVp8Decoder(…)` / `webrtc::VP9Decoder::Create()` / `case LibWebRTCVPXVideoDecoder::Type::AV1: return createLibWebRTCDav1dDecoder();`; vp9.cc: `return std::make_unique<LibvpxVp9Decoder>();` |
| K35 | …/5dbb0d4/Source/WebCore/platform/libwebrtc/LibWebRTCVPXVideoDecoder.cpp#L157-L158 | 2026-11-10 | `if (record->bitDepth > 10) return VideoDecoder::DecodePromise::createAndReject("VPx decoding of 12-bit content is not supported"_s);` |
| K36 | …/5dbb0d4/Source/WebCore/platform/mediastream/libwebrtc/LibWebRTCDav1dDecoder.cpp#L207-L209 | 2026-11-10 | `// Only accept I420 pixel format and 8 bit depth. if (dav1dPicture.p.layout != DAV1D_PIXEL_LAYOUT_I420 \|\| dav1dPicture.p.bpc != 8) return WEBRTC_VIDEO_CODEC_ERROR;` |
| K37 | …/5dbb0d4/Source/WebCore/platform/mediastream/libwebrtc/LibWebRTCDav1dDecoder.cpp#L124-L125 | 2026-11-10 | `s.n_threads = std::max(2, settings.number_of_cores()); s.max_frame_delay = 1;` |
| K38 | …/5dbb0d4/Source/WebCore/platform/video-codecs/cocoa/GPUVideoDecoder.mm#L44-L47 | 2026-11-10 | `return makeUnique<GPUVideoDecoderVTB>(callback, WTF::move(queue), WTF::move(colorSpaceOverride));` |
| K39 | …/5dbb0d4/Source/WebCore/platform/video-codecs/cocoa/VideoDecoderVTBSession.mm#L42 | 2026-11-10 | `auto videoDecoderSpecification = @{ (__bridge NSString *)kVTVideoDecoderSpecification_EnableHardwareAcceleratedVideoDecoder: @YES };` |
| K40 | …/5dbb0d4/Source/WebCore/platform/video-codecs/cocoa/GPUVideoDecoderVTB.mm#L73-L81 | 2026-11-10 | `ASSERT(bitDepth == 8 \|\| bitDepth == 10);` … `if (bitDepth > 8) pixelFormatType = isFullRange ? kCVPixelFormatType_420YpCbCr10BiPlanarFullRange : kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange; else pixelFormatType = isFullRange ? kCVPixelFormatType_420YpCbCr8BiPlanarFullRange : …` |
| K41 | …/5dbb0d4/Source/WebCore/platform/libwebrtc/LibWebRTCVPXVideoDecoder.cpp#L246-L251 | 2026-11-10 | `case webrtc::BufferType::I420: case webrtc::BufferType::I422: pixelBufferType = isFullRange ? kCVPixelFormatType_420YpCbCr8BiPlanarFullRange : …; case webrtc::BufferType::I010: pixelBufferType = isFullRange ? kCVPixelFormatType_420YpCbCr10BiPlanarFullRange : …` |
| K42 | …/5dbb0d4/Source/WebCore/platform/VideoPixelFormat.cpp#L43-L51 | 2026-11-10 | `if (format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange \|\| format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange \|\| format == kCVPixelFormatType_Lossless_420YpCbCr8BiPlanarVideoRange) return VideoPixelFormat::NV12; if (format == kCVPixelFormatType_32BGRA) … if (format == kCVPixelFormatType_32ARGB) return shouldDiscardAlpha ? VideoPixelFormat::RGBX : VideoPixelFormat::RGBA;` |
| K43 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsVideoDecoder.cpp#L206-L207 | 2026-11-10 | `WebCodecsVideoFrame::BufferInit init { .format = convertVideoFramePixelFormat(frame->pixelFormat()),` |
| K44 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsVideoFrameAlgorithms.cpp#L322-L335 | 2026-11-10 | `if (!format) return Exception { ExceptionCode::NotSupportedError, "No format is available"_s };` … `if (options.format && *options.format != VideoPixelFormat::RGBA && *options.format != VideoPixelFormat::RGBX && *options.format != VideoPixelFormat::BGRA && *options.format != VideoPixelFormat::BGRX) return Exception { ExceptionCode::NotSupportedError, "Format is not supported"_s };` |
| K45 | …/5dbb0d4/Source/WebCore/platform/graphics/cv/VideoFrameCV.mm#L62-L66 ; …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsVideoFrame.cpp#L496 | 2026-11-10 | `RefPtr<VideoFrame> VideoFrame::fromNativeImage(NativeImage& image) { // FIXME: Set VideoFrame colorSpace. auto transferSession = ImageTransferSessionVT::create(kCVPixelFormatType_32ARGB, false);`; `auto internalVideoFrame = VideoFrame::fromNativeImage(image.get());` |
| K46 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsVideoFrame.cpp#L288-L289 | 2026-11-10 | `if (isHighBitDepthVideoPixelFormat(pixelFormat) && !context.settingsValues().webCodecsHighBitDepthEnabled) return Exception { ExceptionCode::TypeError, "VideoPixelFormat is not valid"_s };` |
| K47 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsVideoDecoder.cpp#L99-L106 | 2026-11-10 | `return codec.startsWith("vp8"_s) \|\| codec.startsWith("avc1."_s) \|\| (codec.startsWith("vp09."_s) && isSupportedVP9DecoderCodec(codec, settings)) \|\| (codec.startsWith("hev1."_s) && settings.webCodecsHEVCEnabled) \|\| (codec.startsWith("hvc1."_s) && settings.webCodecsHEVCEnabled) \|\| (codec.startsWith("av01.0"_s) && settings.webCodecsAV1Enabled);` |
| K48 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsVideoDecoder.cpp#L76-L95 | 2026-11-10 | `case 0: return parameters->bitDepth == 8 && is420;` … `case 2: return settings.webRTCVP9Profile2CodecEnabled && parameters->bitDepth == 10 && is420;` … `default: return false;` |
| K49 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsVideoDecoder.idl#L32 (also WebCodecsVideoFrame.idl, WebCodecsEncodedVideoChunk.idl) | 2026-11-10 | `EnabledBySetting=WebCodecsVideoEnabled, ExportMacro=WEBCORE_EXPORT, Exposed=(Window,DedicatedWorker), InterfaceName=VideoDecoder,` |
| K50 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsImageDecoder.idl#L32-L37 | 2026-11-10 | `EnabledBySetting=WebCodecsImageEnabled, ExportMacro=WEBCORE_EXPORT, Exposed=(Window,DedicatedWorker), InterfaceName=ImageDecoder, JSCustomMarkFunction, SecureContext` |
| K51 | …/5dbb0d4/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L7223-L7234 | 2026-11-10 | `WebCodecsAV1Enabled: type: bool status: preview category: media humanReadableName: "WebCodecs AV1 codec" … defaultValue: "USE(GSTREAMER)": true default: false WebKitLegacy: false disableInLockdownMode: true` |
| K52 | …/5dbb0d4/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L7247-L7258 | 2026-11-10 | `WebCodecsHEVCEnabled: type: bool status: mature … defaultValue: "USE(GSTREAMER)": true "PLATFORM(COCOA)": true default: false` |
| K53 | …/5dbb0d4/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L7260-L7267 | 2026-11-10 | `WebCodecsHighBitDepthEnabled: type: bool status: testable category: media humanReadableName: "WebCodecs high bit depth video" humanReadableDescription: "Enable WebCodecs 10 and 12 bit video pixel formats" condition: ENABLE(WEB_CODECS) defaultValue: false` |
| K54 | …/5dbb0d4/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L7269-L7278 | 2026-11-10 | `WebCodecsImageEnabled: type: bool status: stable … humanReadableName: "WebCodecs Image API" … defaultValue: default: true WebKitLegacy: false` |
| K55 | …/5dbb0d4/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L7280-L7299 | 2026-11-10 | `WebCodecsVideoEnabled: type: bool status: mature … defaultValue: "USE(LIBWEBRTC) && PLATFORM(COCOA)": WebKit::defaultPeerConnectionEnabledAvailable() … disableInLockdownMode: true` |
| K56 | …/5dbb0d4/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L31-L36 | 2026-11-10 | `# testable:: … OFF by default. Enabled in test infrastructure only. # preview:: # Ready to be used in beta contexts like Safari Technology Preview. # ON by default in Safari Technology Preview and test infrastructure. # OFF by default elsewhere. May be enabled automatically by clients.` |
| K57 | …/5dbb0d4/Source/WTF/wtf/PlatformEnableCocoa.h#L1166-L1169 | 2026-11-10 | `#if !defined(ENABLE_AV1) && (PLATFORM(MAC) \|\| PLATFORM(IOS) \|\| PLATFORM(MACCATALYST) \|\| PLATFORM(VISION)) #define ENABLE_AV1 1` |
| K58 | …/5dbb0d4/Source/WebKit/GPUProcess/webrtc/LibWebRTCCodecsProxy.mm#L178-L182 | 2026-11-10 | `// Limit to High Profile, level 5.2. return parameters && parameters->profileIDC <= 100 && parameters->levelIDC <= 52;` |
| K59 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsVideoFrame.cpp#L315-L338 | 2026-11-10 | `case VideoPixelFormat::NV12:` … `case VideoPixelFormat::I420A:` … `default: return Exception { ExceptionCode::NotSupportedError, "VideoPixelFormat is not supported"_s };` |
| K60 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsImageDecoder.cpp#L344-L351 | 2026-11-10 | `#if USE(CG) return isSupportedImageType(UTIFromMIMEType(type)); #else return MIMETypeRegistry::isSupportedImageMIMEType(type);` |
| K61 | https://bugs.webkit.org/rest/bug?quicksearch=WebCodecs (also `VideoDecoder`, `VideoFrame`, `AV1`, `ImageDecoder`, `10-bit`, `copyTo`, `dav1d`, `high bit depth`) | 2026-11-10 | `{"summary":"WebCodecs add support for > 8bits per channel video","status":"NEW","id":325753}`; `{"summary":"GPU process crashes when VideoDecoder decodes 12-bit HEVC","status":"NEW","id":329242}` |
| K62 | …/5dbb0d4/Source/WebCore/Modules/webcodecs/WebCodecsVideoDecoder.cpp#L157 | 2026-11-10 | `.decoding = config.hardwareAcceleration == HardwareAcceleration::PreferSoftware ? VideoDecoder::HardwareAcceleration::No : VideoDecoder::HardwareAcceleration::Yes,` |
| K63 | …/5dbb0d4/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L7636-L7645 | 2026-11-10 | `WebRTCVP9Profile2CodecEnabled: type: bool status: mature … defaultValue: "PLATFORM(COCOA)": true default: false` |
| K64 | …/5dbb0d4/Source/WebCore/platform/VideoPixelFormat.cpp#L52-L76 | 2026-11-10 | `#elif USE(GSTREAMER) switch (format) { case GST_VIDEO_FORMAT_I420: return VideoPixelFormat::I420; case GST_VIDEO_FORMAT_A420: … case GST_VIDEO_FORMAT_Y42B: return VideoPixelFormat::I422; case GST_VIDEO_FORMAT_Y444: return VideoPixelFormat::I444; case GST_VIDEO_FORMAT_NV12: return VideoPixelFormat::NV12;` |

### Sources (G)

Engine source base: `https://raw.githubusercontent.com/mozilla-firefox/firefox/47f2a88cbab9072c8f8f156494b92d6891e488fb/`
(written `FX/` below). BCD base:
`https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/` (written `BCD/`).

| id | URL | read | verbatim quote |
|---|---|---|---|
| G1 | BCD/VideoDecoder.json | 2026-11-10 | `"firefox": { "version_added": "130" }, "firefox_android": { "version_added": false }` |
| G2 | BCD/EncodedVideoChunk.json | 2026-11-10 | `"firefox": { "version_added": "130" }, "firefox_android": { "version_added": false }` |
| G3 | BCD/VideoFrame.json | 2026-11-10 | `"firefox": { "version_added": "130" }, "firefox_android": "mirror"`; `metadata_option`: `"firefox": { "version_added": false, "impl_url": "https://bugzil.la/1802053" }`; `flip`, `rotation`: `"firefox": { "version_added": false }` |
| G4 | BCD/ImageDecoder.json | 2026-11-10 | `"firefox": { "version_added": "133" }, "firefox_android": "mirror"` |
| G5 | BCD/HTMLVideoElement.json (`requestVideoFrameCallback`) | 2026-11-10 | `"firefox": { "version_added": "132", "impl_url": ["https://bugzil.la/1800882", "https://bugzil.la/1908245"] }, "firefox_android": "mirror"` |
| G6 | BCD/MediaCapabilities.json (`decodingInfo`) | 2026-11-10 | `"firefox": { "version_added": "63", "notes": "Before Firefox 101, \`decodingInfo()\` ignored \`codecs\` parameter options for \`av01\` codecs (treating them as \`av1\`)." }` |
| G7 | BCD/MediaSource.json | 2026-11-10 | `"firefox": { "version_added": "42" }, "firefox_android": { "version_added": "41" }`; `worker_support`: `"firefox": { "version_added": false }` |
| G10 | https://www.mozilla.org/en-US/firefox/130.0/releasenotes/ | 2026-11-10 | "Enabled the Web Codecs API on desktop platforms, allowing low-level access to audio and video encoders and decoders." |
| G11 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/130 | 2026-11-10 | "The Web Codecs API is supported on desktop releases … Android support is enabled in the Nightly release." |
| G12 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/133 | 2026-11-10 | "The ImageDecoder, ImageTrackList, and ImageTrack interfaces of the WebCodecs API are now supported, enabling the decoding images from the main and worker threads. (Firefox bug 1923755)." |
| G13 | https://www.mozilla.org/en-US/firefox/133.0/releasenotes/ | 2026-11-10 | "Added support for image decoding as part of the WebCodecs API. This allows for decoding of images from the main and worker threads." |
| G14 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/132 | 2026-11-10 | "The requestVideoFrameCallback() and cancelVideoFrameCallback() methods of the HTMLVideoElement interface are now supported." |
| G15 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/130 | 2026-11-10 | "Request video frame callback: media.rvfc.enabled." … "Both methods are enabled by default on the nightly build. (Firefox bug 1800882)." |
| G16 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/65 | 2026-11-10 | "The AV1 codec is now supported by default on Windows (Firefox bug 1452146)." |
| G17 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/66 | 2026-11-10 | "The new AV1 video codec is now enabled by default on both macOS and Windows (for Intel processors). Linux support will come in Firefox 67" |
| G18 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/67 | 2026-11-10 | "The AV1 video codec is now supported on Linux." "dav1d is now the default media decoder for AV1" |
| G19 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/113 | 2026-11-10 | "The AV1 video codec is now enabled on Android. Hardware accelerated decoding is used if supported by the device (Firefox bug 1672276)." "Support for animated AVIF (AV1 Image Format files) images." |
| G20 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/93 | 2026-11-10 | "Support for AVIF images is now enabled by default (Firefox bug 1682995)." |
| G21 | https://www.mozilla.org/en-US/firefox/134.0/releasenotes/ | 2026-11-10 | "Hardware-accelerated playback of HEVC video content is now supported on Windows." |
| G22 | https://www.mozilla.org/en-US/firefox/136.0/releasenotes/ | 2026-11-10 | "Hardware-accelerated playback of HEVC video content is now supported on macOS." "Hardware video decoding is now enabled for AMD GPUs on Linux." |
| G23 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/137 | 2026-11-10 | "HEVC (H.265) is now hardware enabled on Android, and hardware and software enabled on Linux. This adds to existing hardware and software support on Windows and macOS. (Firefox bug 1950032)." |
| G24 | https://www.mozilla.org/en-US/firefox/android/137.0/releasenotes/ | 2026-11-10 | "HEVC support is now supported on Android." |
| G25 | https://www.mozilla.org/en-US/firefox/152.0/releasenotes/ (same text at 153.0) | 2026-11-10 | "Firefox now offers experimental support for the new JPEG XL image format … You can enable it from the Firefox Labs panel in Settings." |
| G26 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/149 | 2026-11-10 | "JPEG XL image support: Rust-based decoder (Nightly only): image.jxl.enabled" "The previous C++ JPEG XL image decoder has been replaced with a new Rust-based implementation that uses the jxl-rs library. (Firefox bug 1986393)." |
| G27 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/158 ; https://www.mozilla.org/en-US/firefox/158.0/releasenotes/ | 2026-11-10 | "Support for the JPEG XL image format (image/jxl) is now enabled by default. … (Firefox bug 2065096)." / "Firefox now supports the JPEG XL image format" |
| G29 | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/123 | 2026-11-10 | "Web Codecs API: dom.media.webcodecs.enabled. The video interfaces of the Web Codecs API are supported on Linux desktop on Nightly." |
| G30 | FX/modules/libpref/init/StaticPrefList.yaml | 2026-11-10 | `- name: dom.media.webcodecs.enabled` `#if defined(MOZ_WIDGET_ANDROID)` `value: @IS_NIGHTLY_BUILD@` `#else` `value: true`; `- name: dom.media.webcodecs.image-decoder.enabled` `value: true`; `- name: dom.media.webcodecs.h265.enabled` `value: @IS_NIGHTLY_BUILD@` |
| G31 | FX/modules/libpref/init/StaticPrefList.yaml | 2026-11-10 | `- name: media.av1.enabled` `value: true`; `- name: media.av1.use-dav1d` `value: true`; `- name: media.av1.force-thread-count` `value: 0`; `- name: media.hevc.enabled` `value: true`; `- name: media.hardware-video-decoding.enabled` `value: true` `mirror: once`; `- name: media.hardware-video-decoding-vulkan.enabled` `value: @IS_NIGHTLY_BUILD@`; `- name: media.ffvpx-hw.enabled` `#if defined(MOZ_WIDGET_GTK)` `value: true` `#elif defined(XP_WIN)` `value: @IS_NIGHTLY_BUILD@`; `- name: media.gpu-process-decoder` `#if defined(XP_WIN)` `value: true`; `name: media.wmf.av1.enabled` `value: true`; `name: media.wmf.dxva.max-videos` `value: 8`; `name: media.wmf.force.allow-p010-format` `value: false`; `name: media.android-media-codec.enabled` `value: @IS_NOT_NIGHTLY_BUILD@` |
| G32 | FX/modules/libpref/init/StaticPrefList.yaml | 2026-11-10 | `# Whether we use dav1d (true) or libaom (false) to decode AVIF image` `- name: image.avif.use-dav1d` `value: true`; `#ifdef MOZ_JXL` `# Whether we attempt to decode JXL images or not.` `- name: image.jxl.enabled` `value: true` |
| G33 | FX/dom/media/webcodecs/VideoFrame.cpp | 2026-11-10 | `return (StaticPrefs::dom_media_webcodecs_enabled() \|\| StaticPrefs::dom_media_webcodecs_image_decoder_enabled()) && !nsRFPService::IsWebCodecsRFPTargetEnabled(aCx);` |
| G34 | FX/dom/webidl/VideoDecoder.webidl ; FX/dom/webidl/VideoFrame.webidl | 2026-11-10 | `[Exposed=(Window,DedicatedWorker), SecureContext, Func="nsRFPService::ExposeWebCodecsAPI"]` / `[Exposed=(Window,DedicatedWorker), Func="mozilla::dom::VideoFrame::PrefEnabled"]` |
| G35 | FX/dom/webidl/ImageDecoder.webidl | 2026-11-10 | `[Exposed=(Window,DedicatedWorker), SecureContext, Func="nsRFPService::ExposeWebCodecsAPIImageDecoder"]` |
| G36 | FX/toolkit/components/resistfingerprinting/nsRFPService.cpp | 2026-11-10 | `if (!StaticPrefs::dom_media_webcodecs_enabled()) { return false; } return !IsWebCodecsRFPTargetEnabled(aCx);` |
| G37 | FX/dom/media/webcodecs/VideoDecoder.cpp | 2026-11-10 | `// TODO: Enable WebCodecs on Android (Bug 1840508)` `if (IsOnAndroid()) { return false; }` |
| G38 | FX/dom/media/webcodecs/WebCodecsUtils.cpp | 2026-11-10 | `// H265 is supported only on MacOS in Nightly for now.` `return StaticPrefs::dom_media_webcodecs_h265_enabled() && StaticPrefs::media_hevc_enabled() && (IsOnMacOS() \|\| IsOnLinux());` … `if (StringBeginsWith(aCodec, u"vp9"_ns) \|\| StringBeginsWith(aCodec, u"av1"_ns)) { return false; }` |
| G39 | FX/dom/media/webcodecs/DecoderTemplate.cpp | 2026-11-10 | `bool preferSW = mActiveConfig->mHardwareAcceleration == HardwareAcceleration::Prefer_software;` … `mAgent->Configure(preferSW, lowLatency)` |
| G40 | FX/dom/media/webcodecs/DecoderAgent.cpp | 2026-11-10 | `aPreferSoftwareDecoder ? CreateDecoderParams::Option::HardwareDecoderNotAllowed : CreateDecoderParams::Option::Default), mInfo->GetType(), mImageContainer, knowsCompositor};` … `params.mOptions += CreateDecoderParams::Option::KeepOriginalPts;` |
| G41 | FX/dom/media/platforms/PDMFactory.cpp | 2026-11-10 | `if (mCurrentPDMs[i]->Supports(params, nullptr /* diagnostic */).isEmpty()) { continue; }` … `// Try the next PDM.` |
| G42 | FX/dom/media/platforms/PDMFactory.cpp (`CreateContentPDMs`) | 2026-11-10 | `if (StaticPrefs::media_gpu_process_decoder()) { StartupPDM(RemoteDecoderModule::Create(RemoteMediaIn::GpuProcess)); }` `if (StaticPrefs::media_rdd_process_enabled()) { StartupPDM(RemoteDecoderModule::Create(RemoteMediaIn::RddProcess)); }` |
| G43 | FX/dom/media/platforms/PDMFactory.cpp (`CreateRddPDMs`) | 2026-11-10 | `StartupPDM(WMFDecoderModule::Create());` … `StartupPDM(AppleDecoderModule::Create());` … `StartupPDM(FFVPXRuntimeLinker::CreateDecoder());` … `StartupPDM(FFmpegRuntimeLinker::CreateDecoder(), preferSystemForVulkan)` … `StartupPDM(AgnosticDecoderModule::Create(), StaticPrefs::media_prefer_non_ffvpx());` |
| G44 | FX/dom/media/platforms/PDMFactory.cpp (`CreateGpuPDMs`) | 2026-11-10 | `#ifdef XP_WIN if (StaticPrefs::media_ffvpx_hw_enabled()) { StartupPDM(FFVPXRuntimeLinker::CreateDecoder()); } if (StaticPrefs::media_wmf_enabled()) { StartupPDM(WMFDecoderModule::Create()); }` |
| G45 | FX/dom/media/platforms/agnostic/AgnosticDecoderModule.cpp | 2026-11-10 | `if (StaticPrefs::media_av1_use_dav1d()) { m = new DAV1DDecoder(aParams); } else { m = new AOMDecoder(aParams); }` |
| G46 | FX/media/ffvpx/config_components_audio_video.h ; FX/media/ffvpx/libavcodec/codec_list.c | 2026-11-10 | `#define CONFIG_H264_DECODER 0` `#define CONFIG_HEVC_DECODER 0` `#define CONFIG_LIBDAV1D_DECODER 1` `#define CONFIG_VP9_DECODER 1`; `#if CONFIG_LIBDAV1D` `&ff_libdav1d_decoder,` |
| G47 | FX/dom/media/platforms/ffmpeg/FFmpegDecoderModule.h | 2026-11-10 | `AV_HWDEVICE_TYPE_VULKAN,` `AV_HWDEVICE_TYPE_VAAPI,` `AV_HWDEVICE_TYPE_NONE,  // Placeholder for V4L2.` … `// These proprietary video codecs can only be decoded via hardware by using the system ffmpeg, not supported by ffvpx.` |
| G48 | FX/dom/media/platforms/ffmpeg/FFmpegDecoderModule.h | 2026-11-10 | `// FFmpeg SW decoding is not allowed in the GPU process.` |
| G49 | FX/dom/media/platforms/apple/AppleDecoderModule.cpp | 2026-11-10 | `// AV1 HW is supported since 14.0 on Apple silicon.` … `CreateDecoderParams::Option::HardwareDecoderNotAllowed)) { return false; }` `// HW AV1 decoder only supports 8 or 10 bit color.` … `// HW AV1 decoder doesn't support RGB` |
| G50 | FX/dom/media/platforms/wmf/WMFDecoderModule.cpp | 2026-11-10 | `// If this process cannot use DXVA, the AV1 decoder will not be used.` … `"AV1 MFT requires DXVA"` … `"Lacking of AV1 extension"` |
| G51 | FX/dom/media/platforms/ffmpeg/FFmpegVideoDecoder.cpp | 2026-11-10 | `return 0 == strncmp(aCodec->name, "libdav1d", 8) \|\| 0 == strncmp(aCodec->name, "vp9", 3);` … `if (m8BitOutput && b.mColorDepth != gfx::ColorDepth::COLOR_8) { MediaResult ret = b.To8BitPerChannel(m8BitRecycleBin);`; FFmpegDecoderModule.h: `aParams.mOptions.contains(CreateDecoderParams::Option::Output8BitPerChannel)` |
| G52 | FX/dom/media/platforms/ffmpeg/FFmpegVideoDecoder.cpp (`GetColorDepth`) | 2026-11-10 | `case AV_PIX_FMT_YUV420P10LE:` … `return gfx::ColorDepth::COLOR_10;` … `case AV_PIX_FMT_YUV420P12LE:` … `return gfx::ColorDepth::COLOR_12;` … `default: MOZ_ASSERT_UNREACHABLE("Not supported format?"); return gfx::ColorDepth::COLOR_8;` |
| G53 | FX/dom/media/platforms/agnostic/DAV1DDecoder.cpp | 2026-11-10 | `if ((*picture).p.layout == DAV1D_PIXEL_LAYOUT_I400) { // Use NS_OK to indicate that this picture should be skipped.` … `"I400 picture: No chroma data to construct an image"`; `b.mColorDepth = gfx::ColorDepthForBitDepth(aPicture.p.bpc);`; `if (aPicture.p.bpc != 8 && m8bpcOutput) {` |
| G54 | FX/dom/media/platforms/agnostic/DAV1DDecoder.cpp (`Init`) | 2026-11-10 | `if (mLowLatency) { settings.max_frame_delay = 1; } size_t decoder_threads = 2; if (mInfo.mDisplay.width >= 2048) { decoder_threads = 8; } else if (mInfo.mDisplay.width >= 1024) { decoder_threads = 4; }` |
| G55 | FX/media/ffvpx/libavcodec/libdav1d.c | 2026-11-10 | `[DAV1D_PIXEL_LAYOUT_I400] = { AV_PIX_FMT_GRAY8,   AV_PIX_FMT_GRAY10,    AV_PIX_FMT_GRAY12 },` |
| G56 | FX/dom/media/ImagePixelFormat.cpp | 2026-11-10 | `// 16-bit samples have no name.`; `case ColorDepth::COLOR_10:` … `ImagePixelFormat::I420P10`; `case ColorDepth::COLOR_12:` … `ImagePixelFormat::I420P12`; `aData.mColorDepth != ColorDepth::COLOR_8 \|\| aData.mAlpha.isSome()) { return Nothing(); }`; `case ImageFormat::GPU_VIDEO: // This process only reads a remote image back as RGB. return Some(ImagePixelFormat::BGRX);` |
| G57 | FX/dom/media/ipc/RemoteVideoDecoder.cpp | 2026-11-10 | `texture = video->mImage->GetTextureClient(mKnowsCompositor);` … `// If failed to create a GPU accelerated surface descriptor, fall back to copying frames via shmem.` |
| G58 | FX/dom/media/webcodecs/VideoFrame.cpp (`ParseVideoFrameCopyToOptions`, `CopyTo`) | 2026-11-10 | `error.Append(" is unsupported in ParseVideoFrameCopyToOptions");`; `aRv.ThrowNotSupportedError("VideoFrame's image format is unrecognized");`; `// By [1], if color space is not set, use "srgb".` |
| G59 | FX/dom/media/webcodecs/VideoFrame.cpp (`Resource::CopyTo`, `SampleBytes`) | 2026-11-10 | `if (mImage->GetFormat() == ImageFormat::PLANAR_YCBCR) {` … `return CopyPlaneRegion(mFormat->SampleBytes(aPlane),`; `return 1;  // 8 bits/sample on the Y, U, V, A plane.` |
| G60 | FX/dom/media/webcodecs/VideoFrame.cpp | 2026-11-10 | `LOGE("The conversion between RGB and non-RGB is unsupported");` |
| G61 | FX/dom/media/webcodecs/ImageTrack.cpp ; FX/image/decoders/nsAVIFDecoder.cpp | 2026-11-10 | `auto image = MakeRefPtr<layers::SourceSurfaceImage>(size, f.mSurface); Maybe<VideoPixelFormat> format = GuessVideoPixelFormat(image);` / `// When we convert the data to rgb we always pass either B8G8R8A8 or B8G8R8X8 to ConvertYCbCrToRGB32.` |
| G62 | FX/image/DecoderFactory.cpp ; FX/dom/media/webcodecs/ImageDecoder.cpp | 2026-11-10 | `else if (!strcmp(aMimeType, IMAGE_JXL) && StaticPrefs::image_jxl_enabled()) { type = DecoderType::JXL; }` / `promise->MaybeResolve(type != image::DecoderType::UNKNOWN);` |
| G63 | https://bugzilla.mozilla.org/rest/bug?product=Core&component=Audio/Video:%20Web%20Codecs&resolution=---&include_fields=id,summary,status | 2026-11-10 | 135 bugs returned; e.g. `1999168 NEW "[Windows] VideoDecoder.isConfigSupported() return false for 'hev1.1.6.L123.00' but about:support indicates HEVC hardware decoding is available"` (each summary in the table is copied from this response) |
| G64 | https://bugzilla.mozilla.org/rest/bug/1969762 (also /1934008, /1942421, /2021505, /2071132, /1539075) | 2026-11-10 | `1969762 ASSIGNED "VideoFrame.format reports BGRX for remote-decoded frames and copyTo cannot return YUV planes (Chrome returns I420)"`; `2071132 RESOLVED FIXED "VideoFrame.format reports I420 for 10-bit planar frames and BGRA for frames created from a video element"`; `1934008 NEW "Ship Web Codecs on Android"`; `1539075 RESOLVED FIXED "Implement support for JPEG XL (image/jxl)"` |
| G65 | https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API ; https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder/configure | 2026-11-10 | "The WebCodecs API enables web developers to encode and decode video and audio in the browser efficiently (using hardware acceleration)" / "hardwareAcceleration Optional A hint as to the hardware acceleration method to use." |
| G66 | https://www.mozilla.org/en-US/firefox/147.0/releasenotes/ | 2026-11-10 | "Improved video playback performance on systems with AMD GPUs by enabling zero-copy playback for hardware-decoded video where supported, bringing them to parity with Intel and NVIDIA GPUs." |
| G67 | FX/toolkit/components/nimbus/FeatureManifest.yaml | 2026-11-10 | `jpeg-xl:` `description: "JPEG-XL"` … `setPref:` `branch: user` `pref: "image.jxl.enabled"` |
| G68 | FX/toolkit/moz.configure | 2026-11-10 | `option("--disable-jxl", help="Disable jxl image support")` … `set_define("MOZ_JXL", jxl)` |
| G69 | FX/browser/config/version.txt | 2026-11-10 | `162.0a1` |
| G70 | FX/dom/media/platforms/ffmpeg/FFmpegDecoderModule.h | 2026-11-10 | `// These proprietary codecs can only be decoded via MediaCodec decoders, but the underlying implementation may be software or hardware.` |
| G71 | FX/dom/media/ipc/RemoteDecoderModule.cpp | 2026-11-10 | `// Platform decoders must be used in the GPU process, unless it is disabled. Pure software decoding may still be performed in the RDD process since it is not permitted in the GPU process.` |
| G72 | FX/dom/media/webcodecs/WebCodecsUtils.cpp | 2026-11-10 | `"Resist fingerprinting (MediaCapabilities) enabled, overriding "` `"hardware preference");` `aConfig->mHardwareAcceleration = HardwareAcceleration::No_preference;` |
| G73 | FX/dom/media/webcodecs/VideoDecoder.cpp (`CreateVideoFrame`) | 2026-11-10 | `Maybe<VideoPixelFormat> format = GuessVideoPixelFormat(aData->mImage.get());` |

### Sources (I)

Engine source is pinned to these commits: Chromium GitHub mirror `42b48607b5e4351a61742e83eb6d7ee99d483a86`, Gecko
`mozilla-firefox/firefox` `47f2a88cbab9072c8f8f156494b92d6891e488fb`, WebKit `5dbb0d4dcc9b3c87d4d457fabe6cfb62be40cb40`,
BCD `918d2d721cc80c26c2eed7e64c6fa43da59322fd`, mdn/content `edc9ab5479d1253d9edd93bfe90dd1d100605c26`.
`CR` = `https://raw.githubusercontent.com/chromium/chromium/42b48607b5e4351a61742e83eb6d7ee99d483a86/`,
`FF` = `https://raw.githubusercontent.com/mozilla-firefox/firefox/47f2a88cbab9072c8f8f156494b92d6891e488fb/`,
`WK` = `https://raw.githubusercontent.com/WebKit/WebKit/5dbb0d4dcc9b3c87d4d457fabe6cfb62be40cb40/`,
`BCD` = `https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/`.

| id | URL | read | verbatim quote |
|---|---|---|---|
| I1 | https://www.w3.org/TR/webcodecs/ | 2026-11-10 | "W3C Working Draft, 9 November 2026" |
| I2 | https://w3c.github.io/webcodecs/#imagedecoder-interface | 2026-11-10 | "[Exposed=(Window,DedicatedWorker), SecureContext] interface ImageDecoder {" … "static Promise<boolean> isTypeSupported(DOMString type);" |
| I3 | https://w3c.github.io/webcodecs/#imagedecoderinit-interface | 2026-11-10 | "typedef (AllowSharedBufferSource or ReadableStream) ImageBufferSource;" |
| I4 | https://w3c.github.io/webcodecs/#imagedecoderinit-interface | 2026-11-10 | "If desiredWidth exists and desiredHeight does not exist, return false." |
| I5 | https://w3c.github.io/webcodecs/#dom-imagedecoderinit-desiredwidth | 2026-11-10 | "Implementation is best effort; decoding to a desired width MAY not be supported by all formats/ decoders." |
| I6 | https://w3c.github.io/webcodecs/#dom-imagedecoderinit-colorspaceconversion | 2026-11-10 | "Controls whether decoded outputs' color space is converted or ignored, as defined by colorSpaceConversion in ImageBitmapOptions." |
| I7 | https://w3c.github.io/webcodecs/#dom-imagedecoderinit-preferanimation | 2026-11-10 | "For images with multiple tracks, this indicates whether the initial track selection SHOULD prefer an animated track." |
| I8 | https://w3c.github.io/webcodecs/#dom-imagedecoder-imagedecoder | 2026-11-10 | "If init.transfer contains an ArrayBuffer referenced by init.data the User Agent MAY choose to:" … "Perform DetachArrayBuffer on transferable" |
| I9 | https://w3c.github.io/webcodecs/#dom-imagedecoder-completed | 2026-11-10 | "The promise used to signal when complete becomes true." |
| I10 | https://w3c.github.io/webcodecs/#imagetrack-interface | 2026-11-10 | "Returns a live ImageTrackList, which provides metadata for the available tracks and a mechanism for selecting a track to decode." |
| I11 | https://w3c.github.io/webcodecs/#dom-imagedecoder-imagedecoder | 2026-11-10 | "User Agents don’t have to support any particular type." |
| I12 | https://w3c.github.io/webcodecs/#imagedecoderesult-interface | 2026-11-10 | "required VideoFrame image; required boolean complete;" |
| I13 | https://w3c.github.io/webcodecs/#dom-imagedecodeoptions-completeframesonly | 2026-11-10 | "For Progressive Images, a value of false indicates that the decoder MAY output an image with reduced detail." |
| I14 | https://w3c.github.io/webcodecs/#create-a-videoframe | 2026-11-10 | "If output uses a recognized VideoPixelFormat, assign that format to [[format]]. Otherwise, assign null to [[format]]." |
| I15 | https://w3c.github.io/webcodecs/#enumdef-videopixelformat | 2026-11-10 | "Each sample in this format is 12 bits, encoded as a 16-bit integer in little-endian byte order." |
| I16 | https://w3c.github.io/webcodecs/#dom-videopixelformat-rgba | 2026-11-10 | "Each sample in this format is 8 bits, and each pixel is therefore 32 bits." |
| I17 | https://w3c.github.io/webcodecs/#dom-videoframe-copyto | 2026-11-10 | "Otherwise, if options.format is equal to one of RGBA, RGBX, BGRA, BGRX, then assign options.format to format, otherwise return NotSupportedError." |
| I18 | BCD `api/ImageDecoder.json` | 2026-11-10 | `"chrome": { "version_added": "94" }`, `"firefox": { "version_added": "133" }`, `"safari": { "version_added": "preview" }` |
| I19 | FF `modules/libpref/init/StaticPrefList.yaml` | 2026-11-10 | `- name: dom.media.webcodecs.image-decoder.enabled` `type: RelaxedAtomicBool` `value: true` |
| I20 | WK `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` | 2026-11-10 | `WebCodecsImageEnabled:` `type: bool` `status: stable` … `default: true` |
| I21 | BCD `mediatypes/image/avif.json` | 2026-11-10 | `"chrome": { "version_added": "85" }`, `"firefox": { "version_added": "93" }`, `"safari": [ { "version_added": "16.4" }, { "version_added": "16.1", "version_removed": "16.4", "partial_implementation": true, "notes": [ "Only on macOS Ventura. Big Sur and Monterey are not supported."` |
| I22 | BCD `mediatypes/image/jxl.json` | 2026-11-10 | `"chrome": { "version_added": "155" }`, `"firefox": { "version_added": "158" }`, `"safari": { "version_added": "17", "notes": "Animated images are not supported." }` |
| I23 | BCD `mediatypes/image/webp.json` | 2026-11-10 | `"chrome": { "version_added": "17" }`, `"firefox": { "version_added": "65" }`, `"safari": { "version_added": "14" }` |
| I24 | https://raw.githubusercontent.com/mdn/content/edc9ab5479d1253d9edd93bfe90dd1d100605c26/files/en-us/web/media/guides/formats/image_types/index.md | 2026-11-10 | "Chrome 155, Firefox 158, and Safari 17. Safari does not support progressive download of JPEG XL files (it can render them after complete download)." |
| I25 | same as I24 (AVIF table) | 2026-11-10 | "Bits: 8/10/12-bit" |
| I26 | https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes | 2026-11-10 | "Added support for JPEG XL." |
| I27 | BCD `mediatypes/image/png.json` | 2026-11-10 | `"chrome": { "version_added": "1" }`, `"firefox": { "version_added": "1" }`, `"safari": { "version_added": "1" }` |
| I28 | https://developer.apple.com/documentation/safari-release-notes/safari-18-release-notes | 2026-11-10 | "Removed support for JPEG2000." |
| I29 | https://chromestatus.com/feature/5114042131808256 | 2026-11-10 | "Adds support for decoding JPEG XL (image/jxl) images in Blink using jxl-rs, a memory-safe pure Rust decoder"; `"desktop": 155` |
| I30 | CR `third_party/blink/common/features.cc` | 2026-11-10 | `BASE_FEATURE(kJXLImageFormat, base::FEATURE_ENABLED_BY_DEFAULT);` |
| I31 | CR `third_party/blink/renderer/platform/image-decoders/image_decoder.cc` | 2026-11-10 | `} else if (mime_type == "image/jxl" &&` `base::FeatureList::IsEnabled(features::kJXLImageFormat)) {` (branches: jpeg, png/apng, gif, webp, ico, bmp, avif, jxl) |
| I32 | FF `toolkit/moz.configure` | 2026-11-10 | `option("--disable-jxl", help="Disable jxl image support")` |
| I33 | FF `modules/libpref/init/StaticPrefList.yaml` | 2026-11-10 | `- name: image.jxl.enabled` `type: RelaxedAtomicBool` `value: true` |
| I34 | FF `image/DecoderFactory.cpp` | 2026-11-10 | `else if (!strcmp(aMimeType, IMAGE_JXL) && StaticPrefs::image_jxl_enabled()) {` |
| I35 | WK `Source/WebCore/platform/MIMETypeRegistry.cpp` | 2026-11-10 | `#if HAVE(JPEGXL) \|\| USE(JPEGXL)` `"image/jxl"_s,` (also `#if HAVE(AVIF) \|\| USE(AVIF)` `"image/avif"_s,`; no `jp2`) |
| I36 | https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagedatasettings | 2026-11-10 | `enum ImageDataPixelFormat { "rgba-unorm8", "rgba-float16" };` … `ImageDataPixelFormat pixelFormat = "rgba-unorm8";` |
| I37 | https://html.spec.whatwg.org/multipage/canvas.html#canvascolortype | 2026-11-10 | "The "float16" value indicates that the type for all color components is 16-bit floating point." |
| I38 | BCD `api/ImageData.json` (`settings_parameter.pixelFormat_option`) | 2026-11-10 | `"chrome": { "version_added": "137" }`, `"firefox": { "version_added": false, "impl_url": "https://bugzil.la/1958830" }`, `"safari": { "version_added": false, "impl_url": "https://webkit.org/b/291196" }`, `"experimental": true` |
| I39 | BCD `api/HTMLCanvasElement.json` (`getContext` … `options_colorType_parameter`) | 2026-11-10 | `"chrome": { "version_added": "137" }`, `"firefox": { "version_added": false }`, `"safari": { "version_added": false }` |
| I40 | https://tc39.es/ecma262/#sec-math.f16round | 2026-11-10 | "Let n16 be the result of converting n to IEEE 754-2019 binary16 format using roundTiesToEven mode." … "Math.f16round(k) is 1.0009765625𝔽" |
| I41 | https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagebitmapoptions | 2026-11-10 | `dictionary ImageBitmapOptions { ImageOrientation imageOrientation = "from-image"; PremultiplyAlpha premultiplyAlpha = "default"; ColorSpaceConversion colorSpaceConversion = "default"; [EnforceRange] unsigned long resizeWidth; [EnforceRange] unsigned long resizeHeight; ResizeQuality resizeQuality = "low"; };` |
| I42 | CR `third_party/blink/renderer/platform/image-decoders/image_decoder.h` | 2026-11-10 | `// Decode everything to uint8 pixel format (kN32 channel order).` `kDefaultBitDepth,` `// Decode high bit depth images to half float pixel format.` `kHighBitDepthToHalfFloat` |
| I43 | CR `third_party/blink/renderer/modules/webcodecs/image_decoder_core.cc` | 2026-11-10 | `ImageDecoder::HighBitDepthDecodingOption::kDefaultBitDepth,` … `case 12:` `return media::PIXEL_FORMAT_YUV420P12;` … `bit_depth > 8 ? kA16_unorm_SkColorType : kGray_8_SkColorType;` … `ImagePlanes::HighBitDepthOutputType::kUnscaled);` |
| I44 | CR same file as I43 | 2026-11-10 | `// Due to implementation limitations YUV support for some formats is only` `// known once all data is received. Animated images are never supported.`; also `decoder_ = ImageDecoder::CreateByMimeType(` |
| I45 | CR `third_party/blink/renderer/platform/image-decoders/avif/avif_image_decoder.cc` | 2026-11-10 | `allow_decode_to_yuv_ =` `avif_yuv_format_ != crabbyavif::AVIF_PIXEL_FORMAT_YUV400 &&` `!decoder_->alphaPresent && decoded_frame_count_ == 1 &&` … `!NeedsDecodeTimeColorTransform();` |
| I46 | WK `Source/WebCore/Modules/webcodecs/WebCodecsImageDecoder.cpp`, `.../WebCodecsVideoFrame.cpp` | 2026-11-10 | `auto videoFrame = WebCodecsVideoFrame::create(*protect(scriptExecutionContext()), nativeImage.releaseNonNull(), WTF::move(init));`; `auto initialFormat = convertVideoFramePixelFormat(internalVideoFrame->pixelFormat());` |
| I47 | FF `image/decoders/nsAVIFDecoder.cpp` | 2026-11-10 | `gfx::SurfaceFormat format = SurfaceFormat::OS_RGBX;` … `format = SurfaceFormat::B8G8R8A8;` … `nsresult result = gfx::ConvertYCbCrToRGB32(*decodedData, format, rgbBuf.get(),` |
| I48 | FF `image/decoders/nsPNGDecoder.cpp` | 2026-11-10 | `if (bit_depth == 16) {` `png_set_scale_16(png_ptr);` |
| I49 | FF `image/decoders/nsJXLDecoder.cpp` | 2026-11-10 | `// Per-row u8 scratch for all non-passthrough paths (gray, CMYK, HDR,`; `(Rgba16f via qcms_transform_data_rgba_f16_to_rgba_u8` |
| I50 | CR `third_party/blink/renderer/platform/image-decoders/jxl/jxl_image_decoder.cc` | 2026-11-10 | `bool decode_to_half_float =` `ImageIsHighBitDepth() &&` `high_bit_depth_decoding_option_ == kHighBitDepthToHalfFloat;` |
| I51 | FF `dom/media/webcodecs/ImageDecoder.cpp`, `ImageTrack.cpp` | 2026-11-10 | `promise->MaybeResolve(type != image::DecoderType::UNKNOWN);`; `Maybe<VideoPixelFormat> format = GuessVideoPixelFormat(image);` |

### Sources (A)

Pins: WebAssembly/website `128c38126af305f53bc22b31c30aefa3f5efe824`, BCD `918d2d721cc80c26c2eed7e64c6fa43da59322fd`,
V8 `f8e74b163471aba777cfe6b5e570465c8f8c238f`, Gecko and WebKit as in Sources (I). `BCD` as in Sources (I).

| id | URL | read | verbatim quote |
|---|---|---|---|
| A1 | https://raw.githubusercontent.com/WebAssembly/website/128c38126af305f53bc22b31c30aefa3f5efe824/features.json (rendered at https://webassembly.org/features/) | 2026-11-10 | Chrome `"simd": "91", "relaxedSimd": "114", "threads": "74", "memory64": "133"`; Firefox `"simd": "89", "relaxedSimd": "145", "threads": "79", "memory64": "134"`; Safari `"simd": "16.4", "relaxedSimd": ["flag", "Requires JavaScriptCore flag `useWebAssemblyRelaxedSIMD`"], "threads": ["14.1", "Supported in desktop Safari since 14.1 and iOS Safari since 14.5"], "memory64": ["flag", "Supported in Safari Technical Preview 251"]` |
| A2 | BCD `webassembly/fixed-width-SIMD.json` | 2026-11-10 | `"chrome": { "version_added": "91" }`, `"firefox": { "version_added": "89" }`, `"safari": { "version_added": "16.4" }` |
| A3 | BCD `webassembly/relaxed-SIMD.json` | 2026-11-10 | `"chrome": { "version_added": "114" }`, `"firefox": { "version_added": "146" }`, `"safari": { "version_added": "preview" }` |
| A4 | BCD `webassembly/threads-and-atomics.json` | 2026-11-10 | `"chrome": { "version_added": "74" }`, `"chrome_android": { "version_added": "88" }`, `"firefox": { "version_added": "79" }`, `"safari": { "version_added": "15.2" }` |
| A5 | BCD `webassembly/api/Memory.json` | 2026-11-10 | `shared`: `"chrome": { "version_added": "74" }`, `"firefox": { "version_added": "78" }`, `"safari": { "version_added": "15.2", "notes": "Shared \`WebAssembly.Memory\` is gated behind COOP/COEP.` …; `toResizableBuffer`: `"chrome": { "version_added": "144" }`, `"firefox": { "version_added": "145" }`, `"safari": { "version_added": "26.2" }` |
| A6 | BCD `javascript/builtins/SharedArrayBuffer.json` | 2026-11-10 | `"chrome": { "version_added": "68" }`, `"chrome_android": { "version_added": "89" }`, `"firefox": { "version_added": "79" }`, `"safari": { "version_added": "15.2" }` |
| A7 | BCD `api/_globals/crossOriginIsolated.json` | 2026-11-10 | `"chrome": { "version_added": "87" }`, `"firefox": { "version_added": "72" }`, `"safari": { "version_added": "15.2" }` |
| A8 | BCD `http/headers/Cross-Origin-Embedder-Policy.json` | 2026-11-10 | `"chrome": { "version_added": "83" }` …; `credentialless`: `"chrome": { "version_added": "96" }`, `"firefox": { "version_added": "119" }`, `"safari": { "version_added": false }` |
| A9 | BCD `http/headers/Cross-Origin-Opener-Policy.json` | 2026-11-10 | `"chrome": { "version_added": "83" }`, `"firefox": { "version_added": "79" }`, `"safari": { "version_added": "15.2" }` |
| A10 | BCD `webassembly/memory64.json` | 2026-11-10 | `"chrome": { "version_added": "133" }`, `"firefox": { "version_added": "134" }`, `"safari": { "version_added": "preview" }` |
| A11 | BCD `webassembly/api.json` | 2026-11-10 | `instantiateStreaming_static`: `"chrome": { "version_added": "60" }`, `"firefox": { "version_added": "58" }`, `"safari": { "version_added": "15" }` |
| A12 | https://webassembly.github.io/spec/js-api/ | 2026-11-10 | `[Exposed=*]` `namespace WebAssembly {` |
| A13 | https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-new-javascript-realm | 2026-11-10 | "If agent's agent cluster's cross-origin isolation mode is "none": Let global be realm's global object.Let status be ! global.[[Delete]]("SharedArrayBuffer")." … "new WebAssembly.Memory({ shared:true, initial:0, maximum:0 }).buffer.constructor." |
| A14 | https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal | 2026-11-10 | "If IsSharedArrayBuffer(value) is true: If the current settings object's cross-origin isolated capability is false, then throw a "DataCloneError" DOMException." |
| A15 | https://html.spec.whatwg.org/multipage/document-sequences.html#cross-origin-isolation-mode | 2026-11-10 | "every top-level Document has `Cross-Origin-Opener-Policy: same-origin`, andevery Document has a `Cross-Origin-Embedder-Policy` header whose value is compatible with cross-origin isolation." |
| A16 | https://html.spec.whatwg.org/multipage/browsers.html#embedder-policy-value | 2026-11-10 | "An embedder policy value is compatible with cross-origin isolation if it is "credentialless" or "require-corp"."; ""credentialless"When this value is used, fetching cross-origin no-CORS resources omits credentials. In exchange, an explicit `Cross-Origin-Resource-Policy` header is not required." |
| A17 | https://html.spec.whatwg.org/multipage/document-sequences.html#cross-origin-isolation-mode | 2026-11-10 | "As a result, only "concrete" can grant access that capability." |
| A18 | https://html.spec.whatwg.org/multipage/webappapis.html#dom-crossoriginisolated | 2026-11-10 | "The crossOriginIsolated getter steps are to return this's relevant settings object's cross-origin isolated capability." |
| A19 | https://webassembly.github.io/spec/js-api/#limits | 2026-11-10 | "The maximum size of a 32-bit memory is 65,536 pages (4 GiB). The maximum size of a 64-bit memory is 262,144 pages (16 GiB)."; "In practice, an implementation may run out of resources for valid modules below these limits." |
| A20 | https://raw.githubusercontent.com/mdn/content/edc9ab5479d1253d9edd93bfe90dd1d100605c26/files/en-us/web/javascript/reference/global_objects/sharedarraybuffer/index.md | 2026-11-10 | "The `Atomics` object is always available."; "the WebAssembly atomic instructions are also unconditionally allowed." |
| A21 | https://raw.githubusercontent.com/v8/v8/f8e74b163471aba777cfe6b5e570465c8f8c238f/src/wasm/wasm-limits.h | 2026-11-10 | `constexpr size_t kV8MaxWasmMemory32Pages = kSystemPointerSize == 4` `? 32'767   // = 2 GiB - 64Kib` `: 65'536;  // = 4 GiB`; `kV8MaxWasmMemory64Pages` … `: 262'144;  // = 16 GiB` |
| A22 | https://v8.dev/blog/4gb-wasm-memory | 2026-11-10 | "you can now use up to 4GB of memory in WebAssembly applications. That’s up from the previous limit of 2GB."; "Make sure to test on Chrome M83 (currently in Beta) or later." |
| A23 | FF `js/src/wasm/WasmConstants.h`, `js/src/wasm/WasmMemory.cpp`, `js/src/vm/ArrayBufferObject.h` | 2026-11-10 | `static const uint64_t MaxMemory32StandardPagesValidation = uint64_t(1) << 16;`; `(uint64_t(1) << 37) - 1;`; `ArrayBufferObject::ByteLengthLimit / PageSizeInBytes(pageSize);` `return wasm::Pages::fromPageCount(std::min(desired, actual), pageSize);`; `size_t(16) * 1024 * 1024 * 1024;  // 16 GB.`; `// code is one wasm page less than 2GB.` |
| A24 | WK `Source/JavaScriptCore/runtime/PageCount.h`, `Source/JavaScriptCore/wasm/WasmLimits.h` | 2026-11-10 | `#define MAX_ARRAY_BUFFER_SIZE (1ull << 34)`; `static constexpr uint32_t maxMemory32PageCount = 64 * 1024;`; `// So we are sticking with 2GB.`; `static_assert(maxBufferByteLength(AddressType { AddressType::I64 }) == maxPageAlignedArrayBufferBytes);` |
| A25 | https://webassembly.github.io/threads/js-api/ | 2026-11-10 | "If share is shared and maximum is empty, throw a TypeError exception."; "If IsSharedArrayBuffer(buffer) is false, Perform ! DetachArrayBuffer(buffer, "WebAssembly.Memory"). Let newBuffer be the result of creating a fixed length memory buffer from memaddr." |
| A26 | https://v8.dev/docs/wasm-compilation-pipeline | 2026-11-10 | "functions get compiled lazily with the baseline compiler Liftoff when the function gets called for the first time."; "hot functions, which are functions that get executed often, get re-compiled with TurboFan" |
| A27 | https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes | 2026-11-10 | "Added support for an in-place interpreter for Wasm." |

### Sources (X)

| id | URL | read | verbatim quote |
|---|---|---|---|
| X1 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/libgav1/BUILD.gn (line 17) | 2026-11-10 | `"LIBGAV1_MAX_BITDEPTH=10",` |
| X2 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/video_decoder.cc (lines 170–180) | 2026-11-10 | `libgav1::StatusCode status_code = parser.ParseOneFrame(&frame);` `*is_key_frame = status_code == libgav1::kStatusOk &&` `parser.frame_header().frame_type == libgav1::kFrameKey;` |
| X3 | same file (lines 690–691) | 2026-11-10 | `"An EncodedVideoChunk was marked as type `key` but wasn't a key frame"` `". A key frame is required after configure() or flush()."` |
| X4 | https://chromium.googlesource.com/codecs/libgav1/+/4ad433700e5d7c45df3d6146b7c92c8945c19e64/src/obu_parser.cc (lines 2879–2884) | 2026-11-10 | `if (sequence_header_.color_config.bitdepth > LIBGAV1_MAX_BITDEPTH) {` … `return kStatusUnimplemented;` |
| X5 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/DEPS (lines 2329–2330) | 2026-11-10 | `'src/third_party/libgav1/src':` `Var('chromium_git') + '/codecs/libgav1.git' + '@' + '4ad433700e5d7c45df3d6146b7c92c8945c19e64',` |
| X6 | https://chromium.googlesource.com/chromium/src/+/81ba34d0f9102bff3e2062ce81389410a7c16bb3/third_party/blink/renderer/modules/webcodecs/video_frame.cc (lines 203–228); companion: …/third_party/blink/renderer/platform/runtime_enabled_features.json5 | 2026-11-10 | `bool IsFormatEnabled(media::VideoPixelFormat fmt) {` … `case media::PIXEL_FORMAT_YUV420P10:` `case media::PIXEL_FORMAT_YUV420P12:` … `return true;` |
