# AV1 — a second lossless codec beside HTJ2K

The phase's goal: a study can be served as lossless AV1 as well as lossless HTJ2K, the codec chosen
per series, and **every frame on screen is bit-exact with the source**, whichever codec carried it.
This file owns the phase: what is decided, what is open and the measurement that decides each. The
work itself is queued in [`queue.md`](queue.md); licences are in [`licensing.md`](licensing.md).

## What already does not care about the codec

| layer | what it carries | codec-specific today |
| --- | --- | --- |
| wire (`common/frame-envelope`, [`WIRE.md`](../WIRE.md)) | `[4B display_index][opaque bytes]` | nothing |
| store ([`FIXTURES.md`](../FIXTURES.md) §SBND) | a frame table, a metadata JSON, opaque frames | nothing; `pack-study` names its inputs `NNN.htj2k` |
| server | bytes by index | nothing |
| decoder (`client/downloader/decoder.js`) | codestream in, `{pixels, width, bits, signed, range}` out | **all of it** (OpenJPH) |

So an intra-only AV1 frame — one that decodes alone — needs a codec tag in the series metadata, an
ingest step and a second decoder behind the same output contract. Nothing above the decoder changes,
and that contract is what a viewer integrating the downloader consumes, so it changes nothing there
either.

## Open, each with what decides it

**A1 — one frame, or a group of frames, as the unit.** Inter prediction (a frame coded from its
neighbours) is where AV1 is expected to beat HTJ2K on size; intra-only AV1 against lossless HTJ2K is
not expected to win by much. *Expected, not measured* — queue row SIZE measures it.

What inter costs is **random access**, and a viewer has it even with no timeline: a stack is
scrolled both ways and jumped across (a reference line clicked, a linked series, a key image, the
middle slice first). Here that is the ask during a fill ([`WIRE.md`](../WIRE.md) §An ask during a
fill). With a group of G frames that only decode in order:

* an ask for frame N costs the bytes and the decode of every frame from N's keyframe up to N — up to
  G frames instead of one;
* the fill is decoder-bound ([`decode/README.md`](../decode/README.md)), and frames in one group
  decode one after another on one decoder: decoders run in parallel only across groups, so G bounds
  the fill's parallelism from above;
* once a frame is decoded and cached nothing changes — frames are decoded once
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md)).

So G trades bytes on the wire against the ask's latency and the fill's parallelism. A G of 1 keeps
today's model; any G > 1 makes the group a unit of delivery (an ask names a frame and receives its
group from the keyframe, or the client keeps the group's decoder state). Rows SIZE and SPEED give
the curve. The shape is proposed in [`adr-unit.md`](adr-unit.md): a `codec` field in the bundle's
metadata, one decoder module per codec behind `decoder.js`, and for G > 1 the group as the
*client's* unit — an ask for N is `request_frames [k … N]`, a group goes to one decoder — with the
wire, the store and the server unchanged.

**A2 — which decoder for which frame.** WebCodecs' `VideoDecoder` is native (on Chromium without an
AV1 hardware decoder it is dav1d in the browser process) and dav1d compiled to WASM runs everywhere.
Neither is assumed faster or exact:

* the profiles, per the AV1 spec: Main is 8/10-bit 4:0:0 or 4:2:0; High is 8/10-bit 4:4:4 (no
  4:0:0); Professional adds 12-bit, 4:0:0 included. Chromium's software decoder maps all three
  (and turns a 4:0:0 frame into three planes); whether `isConfigSupported` accepts Professional, and
  whether 12-bit samples survive `copyTo`, is unconfirmed. Safari offers AV1 only on hardware with an
  AV1 decoder (M3 and later, iPhone 15 Pro and later), at profiles unconfirmed.
* lossless coding is part of the normative decode process, not an optional tool, so every
  conforming decoder must take it.
* a hardware decoder may hand back a GPU frame whose read-back is converted; exactness is per
  platform, not per spec.
* one decoder for everything is the simplest shape; a second path earns its place by a measured
  win, interleaved, on the frames it would serve.

Rows WCAP (what WebCodecs supports and returns exactly), WASM (the dav1d build) and SPEED decide it.

**A3 — samples above 12 bits, and signed samples.** AV1 codes at most 12 bits a sample and only
unsigned. Signed data is offset by 2^(B−1), which is reversible; data over 12 bits (stored 16-bit)
needs a split into planes or streams. Row DEPTH measures the options against HTJ2K on the same frames.

**A4 — content.** The synthetic sets add independent noise to every frame
(`lab/scripts/gen_frame_pnm.py`), so an inter-frame gain measured on them is not a claim about any
modality. Row DATA brings public, freely licensed series fetched at run time (checksummed, never
committed); a size verdict names its content.

## Prior evidence, not reproduced here

An earlier private proof of concept measured parts of this. Its numbers are **not measured in this
repository** and are recorded only so the queue tests them rather than rediscovers them:

* **Size is content-dependent, not a given win.** Exact bytes over raw on public series: one 8-bit RGB
  ultrasound clip, HTJ2K 768 KB against AV1 inter (G = 5) 1 082 KB and intra 1 693 KB; a 12-bit CT
  stack of 24, HTJ2K 4.78 MB against AV1 intra 4.79 and inter 4.95; the median over 73 series,
  HTJ2K 0.138, AV1 intra 0.124, AV1 inter 0.106 (lossless JPEG XL 0.090, for reference).
* **libaom's lossless mode was not always lossless.** With libaom 3.8.2, inter-coded 10- and 12-bit
  grey came back wrong on P-frames (up to 38 of 6.3 M samples, |Δ| ≤ 11), the same from two
  independent decoders — so the encoder, not a decoder. Intra-only was exact up to 12 bits; 3.14.1
  passed its own lossless cases, but the failing grey clips were never re-run on it.
* **WebCodecs on Chromium returned no frames from lossless streams** (Main 4:2:0 and High 4:4:4,
  8-bit), with `isConfigSupported` answering true; whether that was the probe's packaging was not
  settled.
* **dav1d in WASM decoded an 8-bit 4:4:4 clip exactly** in a browser over WebTransport (dav1d 1.5.0,
  no SIMD, one thread). Nothing above 8 bits or 4:0:0 was decoded in WASM, and no WASM decode time
  was taken.
* **Decode cost is the risk to watch**: on a desktop, through a subprocess (pessimistic), AV1 took
  12–14 ms a frame against HTJ2K's 1.2. The fill here is decoder-bound, so a slower decoder costs
  the fill directly, whatever it saves on the wire.
* Signed CT there spanned −1024..2461, which fits 12 bits after a +1024 offset; it was not tried.

## Decided

* **Bit-exact or nothing**: a codec, depth or decoder path that does not round-trip exactly is not
  used for that series. Ground truth is the encoder's input, never a decoder under test (as for
  HTJ2K, [`decode/README.md`](../decode/README.md) §Ground truth).
* **The codec belongs to the series**, carried in its metadata; the envelope stays opaque.
* **AV1 frames are this project's own format**: DICOM defines no AV1 transfer syntax, and the store
  is not DICOM ([`licensing.md`](licensing.md) §DICOM).
* **Everything here is MIT-compatible open source** ([`licensing.md`](licensing.md)); no code from
  any other viewer or private project enters this repository.
