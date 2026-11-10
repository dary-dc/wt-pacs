# Decoding media in the browser

A reference, built only on official sources, of every route a page has to decode images and video, what each hands
back, and what each engine ships. Research only, read 2026-11-10; nothing here was built or measured. Each claim is
labelled **(S)** sourced (a verbatim quote, in §Sources), **(D)** derived (the reasoning beside it) or **(U)** not
found in an official source.

*In progress: sections are added as they are written.*

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

| format | planes, in order | chroma sub-sampling | sample container | significant bits | `visibleRect` / `rect` offset | opaque equivalent | src |
|---|---|---|---|---|---|---|---|
| `I420` | Y, U, V | 2 × 2 | 8-bit | 8 | x, y even | itself | [F12] [F13] |
| `I420P10` | Y, U, V | 2 × 2 | 16-bit little-endian | 10 | x, y even | itself | [F14] |
| `I420P12` | Y, U, V | 2 × 2 | 16-bit little-endian | 12 | x, y even | itself | [F15] |
| `I420A` | Y, U, V, A | 2 × 2 (A full) | 8-bit | 8 | x, y even | `I420` | [F16] |
| `I420AP10` | Y, U, V, A | 2 × 2 (A full) | 16-bit LE | 10 | x, y even | `I420P10` | [F14] [F16] |
| `I420AP12` | Y, U, V, A | 2 × 2 (A full) | 16-bit LE | 12 | x, y even | `I420P12` | [F15] [F16] |
| `I422` | Y, U, V | 2 × 1 | 8-bit | 8 | x even | itself | [F17] |
| `I422P10` | Y, U, V | 2 × 1 | 16-bit LE | 10 | x even | itself | [F14] [F17] |
| `I422P12` | Y, U, V | 2 × 1 | 16-bit LE | 12 | x even | itself | [F15] [F17] |
| `I422A` / `I422AP10` / `I422AP12` | Y, U, V, A | 2 × 1 (A full) | 8 / 16 LE / 16 LE | 8 / 10 / 12 | x even | `I422` / `I422P10` / `I422P12` | [F16] [F17] |
| `I444` / `I444P10` / `I444P12` | Y, U, V | none | 8 / 16 LE / 16 LE | 8 / 10 / 12 | any | itself | [F18] |
| `I444A` / `I444AP10` / `I444AP12` | Y, U, V, A | none | 8 / 16 LE / 16 LE | 8 / 10 / 12 | any | `I444` / `I444P10` / `I444P12` | [F16] [F18] |
| `NV12` | Y, then UV interleaved (U first) | 2 × 2 | 8-bit | 8 | x, y even | itself | [F19] |
| `RGBA` / `BGRA` | one plane, 4 components in the named order | none | 8-bit | 8 | any | `RGBX` / `BGRX` | [F20] |
| `RGBX` / `BGRX` | one plane; fourth byte padding, "always fully opaque" | none | 8-bit | 8 | any | itself | [F21] |

| claim | label | src |
|---|---|---|
| For P10/P12 the spec says only "10 bits, encoded as a 16-bit integer in little-endian byte order"; it does **not** say whether the value sits in the low bits (0–1023) or is shifted to the top. Looked for "least significant", "MSB", "shift", "padding" in §9.8 of [F2]: none. | U | [F14] |
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

| member | values | H.273 code points |
|---|---|---|
| `primaries` | `bt709`, `bt470bg`, `smpte170m`, `bt2020`, `smpte432` (P3 D65) | 1, 5, 6, 9, 12 |
| `transfer` | `bt709`, `smpte170m`, `iec61966-2-1` (sRGB), `linear`, `pq`, `hlg` | 1, 6, 13, 8, 16, 18 |
| `matrix` | `rgb`, `bt709`, `bt470bg`, `smpte170m`, `bt2020-ncl` | 0, 1, 5, 6, 9 |
| `fullRange` | `true` / `false` / null | — |

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

| route | output | bit depth / format | where exactness can be lost | src |
|---|---|---|---|---|
| `frame.copyTo(buf)` (no `format`) | the frame's planes, its own `VideoPixelFormat` | 8-bit or 16-bit LE container, as the format says | nowhere in the algorithm (D: byte copy) | [F3] |
| `frame.copyTo(buf, {format:'RGBA'…, colorSpace})` | one RGB plane, `visibleRect` size | 8-bit | unspecified YUV→RGB conversion; bit-depth reduction; `srgb` / `display-p3` only | [F35] [F37] [F39] |
| 2D canvas `drawImage(frame, …)` | canvas backing store, at `displayWidth` × `displayHeight` | `unorm8` by default; `float16` with `colorType` | conversion to the canvas colour space; scaling to display size; filter "may use any filtering algorithm"; premultiplied alpha; 8-bit store | [F62] [F64] [F65] [F66] [F67] [F68] |
| `getImageData()` after `drawImage` | `ImageData` | `rgba-unorm8` (`Uint8ClampedArray`) or `rgba-float16` | everything above, plus the readback format | [F69] |
| `createImageBitmap(frame)` | `ImageBitmap` | not stated | "a copy of image's visible pixel data" (crop, optional resize with `resizeQuality`); bit depth unspecified | [F70] [F71] |
| WebGL `texImage2D(…, frame)` | texture of the `format`/`type` asked | RGBA-derived; WebGL 2 allows 8-bit unorm, ≤ 8-bit uint, half float, float | conversion to `unpackColorSpace` (unless `NONE`); YUV→RGB always; precision guarantee only for 8-bit lossless images | [F72] [F73] [F74] [F76] |
| WebGPU `importExternalTexture({source: frame, colorSpace})` | `GPUExternalTexture` (`texture_external`) | read as `vec4<f32>` | conversion to `srgb` (default) or `display-p3`; sampling before or after conversion is implementation-dependent; internal representation may vary per frame | [F79] [F80] [F81] [F82] [F83] |
| WebGPU `copyExternalImageToTexture({source: frame}, {texture, colorSpace, premultipliedAlpha})` | a `GPUTexture` | unorm / unorm-srgb / float / ufloat formats, e.g. `rgba16float`; not uint or sint | "color-managed color value" of each pixel, re-encoded to the destination `colorSpace`; frame read at display size | [F84] [F85] [F86] [F87] [F88] |

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
| So a `VideoFrame` cannot be uploaded to an integer texture wider than 8 bits, and the best upload is RGB in `RGBA16F`/`RGBA32F` after a UA conversion; exact 10/12-bit luma in WebGL needs `copyTo()` then `texImage2D` from an `ArrayBufferView` (D: [F78], [F74], [F3]). | D | [F78] [F74] [F3] |

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
| browser-compat-data: `importExternalTexture` and `copyExternalImageToTexture` — Chrome 144 (Linux limited to Intel Gen12+), Firefox partial (141/144, platform-limited), Safari 26. | S | [F93] [F94] |

### Reading samples back exactly

| claim | label | src |
|---|---|---|
| Only `copyTo()` without `format` is specified as a byte copy of the decoder's planes; every other route above specifies a colour conversion, a scale to display size, a float or 8-bit store, or an unspecified intermediate. So `copyTo()` is the only route that can be relied on for exact 10/12-bit samples (D: rows above). | D | [F3] [F62] [F74] [F80] [F87] |
| Rendering exact samples on screen: upload the `copyTo()` planes as data (`texImage2D` with an `ArrayBufferView`, or WebGPU `writeTexture`) and do the window/level in a shader. Not a spec statement; follows from the rows above. | D | [F3] [F78] [F75] |

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

| `VideoFrameCallbackMetadata` field | meaning | src |
|---|---|---|
| `presentationTime` | when the UA submitted the frame for composition | [F132] |
| `expectedDisplayTime` | when the UA expects the frame to be visible | [F132] |
| `width` / `height` | frame size in media pixels ("visible decoded pixels, without pixel aspect ratio adjustments") | [F132] |
| `mediaTime` | PTS in seconds of the presented frame; may be 0 for live / WebRTC | [F132] |
| `presentedFrames` | count of frames submitted for composition; "MUST be monotonically increasing"; a gap means missed callbacks | [F132] |
| `processingDuration` (optional) | seconds from submitting the encoded packet to the decoder until the frame was ready; may include YUV conversion and GPU staging | [F132] |
| `captureTime`, `receiveTime`, `rtpTimestamp` (optional) | WebRTC / `getUserMedia` sources only | [F132] |

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

## WebKit

Safari on macOS, iOS and iPadOS. Engine source is pinned at WebKit commit
`5dbb0d4dcc9b3c87d4d457fabe6cfb62be40cb40` (committed 2026-11-09); browser-compat-data (BCD) at
`918d2d721cc80c26c2eed7e64c6fa43da59322fd`. Release-note versions are as Apple publishes them on 2026-11-10,
including Safari 27.3 **beta**.

**Bottom line for this client.** On Safari, WebCodecs `VideoDecoder` decodes AV1 only where the device has an AV1
hardware decoder unless a hidden flag is on, and its software AV1 path accepts only 8-bit 4:2:0. A 10-bit frame from
any Safari decoder reports `format === null`, and `copyTo()` then either rejects or converts to 8-bit RGB. So the
exact-sample 10- and 12-bit path on Safari is dav1d-WASM, not WebCodecs.

(draft in progress)

## Gecko

Firefox desktop (Windows, macOS, Linux) and Firefox for Android. Engine source pinned at
`mozilla-firefox/firefox@47f2a88cbab9072c8f8f156494b92d6891e488fb` (main, `browser/config/version.txt` = `162.0a1`).

### Since which version

| claim | label | src |
|---|---|---|
| `VideoDecoder`, `EncodedVideoChunk` ship in desktop Firefox 130; browser-compat-data marks Firefox for Android as not supported | (S) | [G1] [G2] |
| WebCodecs shipped on desktop in 130; Android was then Nightly-only | (S) | [G10] [G11] |
| Android release builds still have WebCodecs video off at the pinned source: `dom.media.webcodecs.enabled` is `@IS_NIGHTLY_BUILD@` on `MOZ_WIDGET_ANDROID` | (S) | [G30] |
| `VideoFrame` 130 on desktop; Android `"mirror"` (i.e. 130) because `VideoFrame` is also exposed when only the image-decoder pref is on | (S) | [G3] [G33] |
| `VideoFrame` `flip`, `rotation`, `metadata` not supported (`metadata` tracked in bug 1802053) | (S) | [G3] |
| `ImageDecoder` ships in 133, on main thread and in workers; Android `"mirror"` | (S) | [G4] [G12] [G13] |
| `requestVideoFrameCallback` ships in 132 (Nightly-only behind `media.rvfc.enabled` in 130) | (S) | [G5] [G14] [G15] |
| `MediaCapabilities` 63; before 101 `decodingInfo()` ignored `av01` codec-string parameters | (S) | [G6] |
| `MediaSource` 42 desktop, 41 Android; not available in workers (`worker_support`, `handle`, `canConstructInDedicatedWorker` all `false`) | (S) | [G7] |
| AV1 video: Windows 65 (default), macOS and Windows 66, Linux 67 with dav1d as default AV1 decoder, Android 113 (hardware when the device supports it) | (S) | [G16] [G17] [G18] [G19] |
| AVIF images default on in 93; animated AVIF in 113 | (S) | [G20] [G19] |
| HEVC: hardware playback on Windows 134, macOS 136; Linux (hardware and software) and Android (hardware) 137 | (S) | [G21] [G22] [G23] [G24] |
| HEVC in WebCodecs is Nightly-only at the pinned source (`dom.media.webcodecs.h265.enabled` = `@IS_NIGHTLY_BUILD@`) | (S) | [G30] |
| JPEG XL: experimental via Firefox Labs in 152 and 153; Rust (jxl-rs) decoder replaced the C++ one in 149 Nightly; enabled by default in 158 | (S) | [G25] [G26] [G27] |
| No Firefox for Android release note through 160 mentions WebCodecs or JPEG XL (release notes 130–160 searched) | (U) | [G28] |

## Sources

Every source read 2026-11-10 unless its row says otherwise; ids are prefixed by the section that cites them.

### V

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
| V22 | https://www.w3.org/TR/webcodecs/#hardware-acceleration | 2026-11-10 | "the User Agent MUST ensure rejection or acceptance of a given HardwareAcceleration preference reveals no additional information on top of what is inherent to the User Agent and revealed by [media-capabilities]." |
| V23 | https://www.w3.org/TR/webcodecs/#hardware-acceleration | 2026-11-10 | "a good example of using "prefer-hardware" would be if an author intends to provide their own software based fallback via WebAssembly." |
| V24 | https://www.w3.org/TR/webcodecs/#dom-videodecoder-isconfigsupported | 2026-11-10 | "The returned VideoDecoderSupport config will contain only the dictionary members that User Agent recognized." / "If config is not a valid VideoDecoderConfig, return a promise rejected with TypeError." / "dictionary VideoDecoderSupport { boolean supported; VideoDecoderConfig config; };" |
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
| V35 | https://www.w3.org/TR/webcodecs/#privacy-output-fingerprinting | 2026-11-10 | "conforming decoders for modern video codecs (such as AVC, HEVC, VP8, VP9, and AV1) produce bit-exact reconstructed YUV samples in their native format, so video decode differences arise primarily from output frame format and alignment metadata" |
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

### F

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
| F78 | https://github.com/KhronosGroup/WebGL/blob/39443210f7f81db4773eb104facadfb85d05dfa4/specs/latest/2.0/index.html | 2026-11-10 | "Therefore, only converting to unsigned integer of at most 8 bits, half float, or float is allowed." |
| F79 | https://gpuweb.github.io/gpuweb/#dictdef-gpuexternaltexturedescriptor | 2026-11-10 | "required (HTMLVideoElement or VideoFrame) source; PredefinedColorSpace colorSpace = \"srgb\";" |
| F80 | https://gpuweb.github.io/gpuweb/#dom-gpudevice-importexternaltexture | 2026-11-10 | "Let data be the result of converting the current image contents of source into the color space descriptor.colorSpace with unpremultiplied alpha." |
| F81 | https://gpuweb.github.io/gpuweb/wgsl/#textureload | 2026-11-10 | "@must_use fn textureLoad(t: texture_external, coords: vec2<C>) -> vec4<f32>" |
| F82 | https://gpuweb.github.io/gpuweb/#gpuexternaltexture | 2026-11-10 | "It is implementation-dependent whether, for any given external texture, the sampler (and filtering) is applied before or after conversion from underlying values into the specified color space." |
| F83 | https://gpuweb.github.io/gpuweb/#gpuexternaltexture | 2026-11-10 | "The configuration used internally by an implementation may be inconsistent across time, systems, user agents, media sources, or even frames within a single video source." |
| F84 | https://gpuweb.github.io/gpuweb/#typedefdef-gpucopyexternalimagesource | 2026-11-10 | "HTMLVideoElement or VideoFrame or HTMLCanvasElement or OffscreenCanvas) GPUCopyExternalImageSource;" |
| F85 | https://gpuweb.github.io/gpuweb/#dom-gpuqueue-copyexternalimagetotexture | 2026-11-10 | "unorm/unorm-srgb or float/ufloat format (not snorm, uint, or sint)." |
| F86 | https://gpuweb.github.io/gpuweb/#dictdef-gpucopyexternalimagedestinfo | 2026-11-10 | "PredefinedColorSpace colorSpace = \"srgb\"; boolean premultipliedAlpha = false;" |
| F87 | https://gpuweb.github.io/gpuweb/#dom-gpuqueue-copyexternalimagetotexture | 2026-11-10 | "Let srcColor be the color-managed color value of the pixel at (srcOrigin.x + x, srcOrigin.y + srcY) of source.source." |
| F88 | https://gpuweb.github.io/gpuweb/#external-source-dimensions | 2026-11-10 | "VideoFrame \| VideoFrame.displayWidth, VideoFrame.displayHeight" |
| F89 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/HTMLCanvasElement.json | 2026-11-10 | `"options_colorType_parameter"`: `"chrome": {"version_added": "137"}`, `"firefox": {"version_added": false}`, `"safari": {"version_added": false}` |
| F90 | https://www.w3.org/TR/webgpu/ | 2026-11-10 | "W3C Candidate Recommendation Draft, 15 September 2026" |
| F91 | https://gpuweb.github.io/gpuweb/#external-texture-creation | 2026-11-10 | "An external texture created from a VideoFrame expires (is destroyed) when, and only when, the source VideoFrame is closed" / "Garbage collection is unpredictable, so this may still stall the video decoder." |
| F92 | https://gpuweb.github.io/gpuweb/#color-space-conversions | 2026-11-10 | "these colors are preserved through color space conversion, with intermediate computations having at least the precision of the source." |
| F93 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/GPUDevice.json | 2026-11-10 | `"importExternalTexture"`: `"chrome": [{"version_added": "144", "notes": "Supported on ChromeOS, macOS, Windows, and Linux (Intel Gen12+ GPUs only)."}, …]`, `"firefox": {"version_added": "144", "partial_implementation": true, "notes": "Supported on Windows only, in all contexts except for service workers."}`, `"safari": {"version_added": "26"}` |
| F94 | https://raw.githubusercontent.com/mdn/browser-compat-data/918d2d721cc80c26c2eed7e64c6fa43da59322fd/api/GPUQueue.json | 2026-11-10 | `"copyExternalImageToTexture"`: `"chrome": [{"version_added": "144", …}]`, `"firefox": {"version_added": "141", "partial_implementation": true, …}`, `"safari": {"version_added": "26"}` |
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
