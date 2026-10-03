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

*Measured (SIZE, libaom 3.15.1, every coding exact; [`lab/av1`](../../lab/av1/README.md) §SIZE):*
**inter coding does not pay on any real series here, and AV1 does not beat HTJ2K.** Bytes over
HTJ2K's at the slowest preset, intra → whole series: fluoroscopy (12-bit, 2 frames/s) 1.024 → 1.027,
MR (11-bit, 3.5 mm) 1.034 → 1.062, ultrasound cine (RGB 8) 1.117 → 1.534; at a practical preset
1.04–1.75. The smallest G that collects most of the gain is **G = 1**: there is no gain to collect
(fluoroscopy's best group, G = 2, is 0.04 % under intra). Lossless JPEG XL, for reference, is
0.83–0.93 of HTJ2K. CT and the cone-beam set need 13 bits — row DEPTH. Bytes therefore give G > 1
no reason; the content measured is three series, none of them a contrast angiography run.

*What G = 1 costs an ask and a fill (SPEED's decode times × SIZE's bytes; arithmetic, not
measured).* An ask is one frame either way: AV1 adds 2–12 % of a frame's bytes and **20–260 ms of
decoding** in Chromium at 1×–4× (fluoroscopy 9.8 → 70 ms at 1×, 35 → 291 ms at 4×). A fill's
decoding with the three decoders, each series whole: fluoroscopy 0.06 → 0.42 s, MR 0.09 → 0.51 s,
ultrasound 0.18 → 1.13 s (0.78 s through WebCodecs) at 1×; at 4× 0.21 → 1.74 s, 0.33 → 2.01 s and
0.67 → 4.59 s. Their AV1 bytes take 1.5–3.8 s, 1.8–4.5 s and 3.2–8.1 s on a 50–20 Mbit/s link, so at
1× AV1's decoding still hides under the wire; **at 4× and the fast end of that link AV1 becomes the
fill's clock on every series, where HTJ2K never is.** Three decoders in parallel were not run.

**A2 — which decoder for which frame.** WebCodecs' `VideoDecoder` is native (on Chromium without an
AV1 hardware decoder it is dav1d in the browser process) and dav1d compiled to WASM runs everywhere.
Neither is assumed faster or exact:

* the profiles, per the AV1 spec: Main is 8/10-bit 4:0:0 or 4:2:0; High is 8/10-bit 4:4:4 (no
  4:0:0); Professional adds 12-bit, 4:0:0 included. **Measured (WCAP), headless Chromium 141, no
  GPU:** every 8- and 10-bit layout comes back exact through `copyTo`, intra and inter, Professional
  4:2:2 included; **12-bit is refused** — `decode()` will not take its keyframe — although
  `isConfigSupported` says `true` for it (and for strings the spec forbids), so the answer to that
  call decides nothing. A 4:0:0 frame comes back as three planes. Safari offers AV1 only on hardware
  with an AV1 decoder (M3 and later, iPhone 15 Pro and later), at profiles unconfirmed.
  [`decode/README.md`](../decode/README.md) §AV1.
* lossless coding is part of the normative decode process, not an optional tool, so every
  conforming decoder must take it.
* a hardware decoder may hand back a GPU frame whose read-back is converted; exactness is per
  platform, not per spec.
* one decoder for everything is the simplest shape; a second path earns its place by a measured
  win, interleaved, on the frames it would serve.

**dav1d in WASM is exact** (row WASM, [`lab/av1/dav1d-wasm`](../../lab/av1/dav1d-wasm/README.md)):
dav1d 1.5.4 under emscripten 3.1.74, scalar, `-msimd128` and `-msimd128 -pthread` (four threads),
matches the native dav1d CLI and a second native build with assembly on every frame of 12 lossless
streams — 8/10/12-bit 4:0:0 and 4:4:4 identity, intra and G = 8 — one picture per temporal unit at a
frame delay of 1. 546 KB `.wasm` scalar, 623 KB with SIMD (219 and 238 KB gzipped). Decode time is
5–10× OpenJPH's on the same frames (below). **It is the client's AV1 decoder at G = 1** (row
DEC): `decoder.codec: "av1"` loads it behind `decoder.js`'s contract, and every shape decodes
through the downloader to its source's checksum ([`client/downloader/README.md`](../../client/downloader/README.md)).

**Decode time, measured (SPEED, [`decode/README.md`](../decode/README.md) §Decode time against
HTJ2K):** the product's worker, the same 18 frames of three real series, 16 interleaved rounds, Node
and Chromium 141, 1× and 4×, every frame exact. dav1d-WASM takes **5.4–9.7× OpenJPH's time** a frame
— 70 against 9.8 ms on 12-bit fluoroscopy in Chromium, 26 against 4.9 on MR, 48 against 7.9 on RGB
ultrasound — slower in all 224 paired rounds, and dav1d itself is ~90 % of it. WebCodecs, on the one
series it decodes exactly (8-bit), is 1.55× faster than dav1d-WASM and still 4.1–4.2× OpenJPH. So
neither AV1 path wins on decode, and with §A1's bytes AV1 at G = 1 wins on nothing on this content:
by [`adr-unit.md`](adr-unit.md) §4's rule it does not earn its place. Whether the phase continues is
the owner's call; DEPTH (CT, cone-beam) is the content not yet measured. Container figures, not a
phone's.

**A3 — samples above 12 bits, and signed samples.** AV1 codes at most 12 bits a sample and only
unsigned. Signed data is offset by 2^(B−1), which is reversible; data over 12 bits (stored 16-bit)
needs a split into planes or streams. Row DEPTH measures the options against HTJ2K on the same frames.
On row DATA's sets, measured: the CT spans −2048..3746 (−1097..3746 without its pad), so it does
**not** fit 12 bits after an offset; the cone-beam volume needs 13 bits; MR, fluoroscopy and
ultrasound fit 12 or fewer.

**A4 — content.** The synthetic sets add independent noise to every frame
(`lab/scripts/gen_frame_pnm.py`), so an inter-frame gain measured on them is not a claim about any
modality. Row DATA brings public, freely licensed series fetched at run time (checksummed, never
committed); a size verdict names its content. They are a CT stack, an MR stack, an RGB ultrasound
cine, a 12-bit fluoroscopy run and a 16-bit cone-beam volume, all CC BY
([`FIXTURES.md`](../FIXTURES.md) §AV1 data); no open angiography run was found.

## Prior evidence, not reproduced here

An earlier private proof of concept measured parts of this. Its numbers are **not measured in this
repository** and are recorded only so the queue tests them rather than rediscovers them:

* **Size is content-dependent, not a given win.** Exact bytes over raw on public series: one 8-bit RGB
  ultrasound clip, HTJ2K 768 KB against AV1 inter (G = 5) 1 082 KB and intra 1 693 KB; a 12-bit CT
  stack of 24, HTJ2K 4.78 MB against AV1 intra 4.79 and inter 4.95; the median over 73 series,
  HTJ2K 0.138, AV1 intra 0.124, AV1 inter 0.106 (lossless JPEG XL 0.090, for reference).
  *Not reproduced here (SIZE)*: on the three real series AV1 lossless, intra or inter, is 2–53 %
  larger than HTJ2K at libaom's slowest preset (§A1); the settings and series behind those medians
  are not known here.
* **libaom's lossless mode was not always lossless.** With libaom 3.8.2, inter-coded 10- and 12-bit
  grey came back wrong on P-frames (up to 38 of 6.3 M samples, |Δ| ≤ 11), the same from two
  independent decoders — so the encoder, not a decoder. Intra-only was exact up to 12 bits; 3.14.1
  passed its own lossless cases, but the failing grey clips were never re-run on it.
  *Reproduced here* with the same 3.8.2 through ffmpeg: inter (G = 8) 10- and 12-bit grey and 12-bit
  4:4:4 inexact (up to 15 904 of 1 M samples, |Δ| ≤ 11), three decoders agreeing — [`lab/av1/dav1d-wasm`](../../lab/av1/dav1d-wasm/README.md). 3.15.1
  has it too, and `--auto-alt-ref=0` cures both (§Measured here).
* **WebCodecs on Chromium returned no frames from lossless streams** (Main 4:2:0 and High 4:4:4,
  8-bit), with `isConfigSupported` answering true; whether that was the probe's packaging was not
  settled. *Not reproduced here (WCAP):* both cells decode exactly in Chromium 141. Lossless is not
  the cause; the decoder holds two frames until `flush()`, so one chunk unflushed returns nothing —
  consistent with that probe, whose code is not here to check.
* **dav1d in WASM decoded an 8-bit 4:4:4 clip exactly** in a browser over WebTransport (dav1d 1.5.0,
  no SIMD, one thread). Nothing above 8 bits or 4:0:0 was decoded in WASM, and no WASM decode time
  was taken.
  *Superseded here*: 8/10/12-bit, 4:0:0 and 4:4:4, SIMD and threads, exact (§A2).
* **Decode cost is the risk to watch**: on a desktop, through a subprocess (pessimistic), AV1 took
  12–14 ms a frame against HTJ2K's 1.2. The fill here is decoder-bound, so a slower decoder costs
  the fill directly, whatever it saves on the wire.
  *Reproduced here in size (SPEED)*: dav1d-WASM 5.4–9.7× OpenJPH a frame in the product's
  worker, WebCodecs 4.1–4.2× (§A2).
* Signed CT there spanned −1024..2461, which fits 12 bits after a +1024 offset; it was not tried.

## Measured here

**Encoders (row TOOL, synthetic frames; [`lab/av1/README.md`](../../lab/av1/README.md)).** The
libaom fault above reproduces, and **3.15.1 has it too**: with default settings, inter-coded grey
at 10 and 12 bits came back wrong on 1–8 of 16 frames (|Δ| ≤ 2 at 10 bits, ≤ 11 at 12), never on a
keyframe, identically from dav1d and aomdec. It goes with the alt-ref frames: with
`--auto-alt-ref=0` every cell — grey 8/10/12 as 4:0:0 and RGB 8 as 4:4:4, intra and inter, both
versions, two presets — is exact. libaom 3.15.1 is pinned. SVT-AV1 v4.2.0 codes 4:2:0 at 8 and 10
bits only, and its 10-bit inter stays inexact under every setting tried; rav1e 0.7.1 has no lossless
mode. 12-bit 4:4:4 behaves alike on 3.8.2; 3.15.1's `aomenc` cannot encode it at all. Every SIZE
encode of row DATA's series re-checks exactness on real content.

## Decided

* **Bit-exact or nothing**: a codec, depth or decoder path that does not round-trip exactly is not
  used for that series. Ground truth is the encoder's input, never a decoder under test (as for
  HTJ2K, [`decode/README.md`](../decode/README.md) §Ground truth).
* **The codec belongs to the series**, carried in its metadata; the envelope stays opaque.
* **AV1 frames are this project's own format**: DICOM defines no AV1 transfer syntax, and the store
  is not DICOM ([`licensing.md`](licensing.md) §DICOM).
* **Everything here is MIT-compatible open source** ([`licensing.md`](licensing.md)); no code from
  any other viewer or private project enters this repository.
