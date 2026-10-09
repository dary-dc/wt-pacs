# HTJ2K

The product's codec: every series is served as HTJ2K today, and every other codec here is measured against it. The
side-by-side table is [`README.md`](README.md); the decoder's own numbers live in
[`../decode/README.md`](../decode/README.md).

## What it is

High-Throughput JPEG 2000, ISO/IEC 15444-15 | ITU-T T.814 (2019): JPEG 2000's wavelet and codestream with EBCOT's
block coder replaced by a faster one. The reversible 5/3 path is lossless.

## How we use it (or would)

Every frame is one codestream in the served profile — reversible 5/3, five decompositions, 64² code-blocks, RPCL,
one layer, one tile ([`../decode/README.md`](../decode/README.md) §The decoder), kept by row HTJ2KENC against 35
other settings (§Encoder settings there). Ingest writes it with OpenJPH
(`ingest/coded-frames/ingest.py --codec htj2k`); the client decodes it with OpenJPH in WASM, a build the product makes from pinned sources
([`client/decode/wasm/build`](../../client/decode/wasm/build/README.md)).

## Bytes

The reference: every ratio in these docs is a codec's bytes over HTJ2K's on the same frames. JPEG 2000 Part 1 is a
few per cent smaller ([`jpeg2000.md`](jpeg2000.md) §Bytes); no OpenJPH setting is smaller by more than 1 %
([`../decode/README.md`](../decode/README.md) §Encoder settings).

## Decode speed

The fastest exact decoder measured here on every series but 8-bit RGB, where native JPEG XL behind a flag beats it
([`jpeg-xl.md`](jpeg-xl.md) §Browser and device support): [`../decode/README.md`](../decode/README.md) §Decode time
against HTJ2K, per frame against AV1's paths, and §Faster HTJ2K in the browser, where its time goes (the HT block
decoder) and what moves it (code-blocks on threads, an ask's lever, adopted by row HTJ2KMT).

## Total time

The baseline of every total-time table ([`../av1/README.md`](../av1/README.md) §Total time). In row TOTAL's fills its
decode was the clock on no cell, where AV1's was at 4× on 50 Mbit.

## Client resources

A decoder worker's resident memory and first use: [`../av1/README.md`](../av1/README.md) §Decode time and memory,
*Memory and first use*; its heap, by frame size: [`../decode/README.md`](../decode/README.md) §Heap and §What a
decoder worker costs, resident. Code: [`../decode/README.md`](../decode/README.md) §The build, as delivered.

## Browser and device support

No browser decodes it natively; OpenJPH in WASM is exact in Chromium 141, Firefox 157 and WebKitGTK 2.52. It needs
WASM SIMD in every engine and `SharedArrayBuffer`, which WebKitGTK as shipped leaves off
([`../decode/README.md`](../decode/README.md) §AV1 in WebKit and Firefox). Phones: not measured.

## Bit depths, signed, colour

1–38 bits stored in DICOM's HTJ2K transfer syntaxes (PS3.5 2026d §8.2.14), so every target series fits one
codestream, 15 and 16 bits included. Signed through the SIZ marker's sign bit, decoded and sign-extended exactly
([`../decode/README.md`](../decode/README.md) §Signed); RGB through the reversible colour transform inside the
codestream.

## Random access and on-demand

Every frame is its own codestream: an ask decodes one frame, and the fill decodes on every decoder at once.

## Progressive / preview

**A resolution prefix.** RPCL with one layer puts each smaller resolution first, so a prefix of a frame is an exact
smaller picture; a clamp makes the package's reduced level exact
([`../decode/README.md`](../decode/README.md) §A prefix draws a smaller image, §A frame at the level the screen
needs). Proposed, not built: [`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md).

## Exactness risks and how they're checked

* Ground truth is the encoder's input, never a decoder's output ([`../decode/README.md`](../decode/README.md)
  §Ground truth).
* OpenJPH's own `-signed true` encode saturates negatives, so a signed fixture is coded unsigned and its SIZ
  marked; OpenJPEG is the independent witness ([`../decode/README.md`](../decode/README.md) §Signed).
* The package's reduced-level output can leave the sample range; a clamp fixes it ([`../decode/README.md`](../decode/README.md) §A frame at the level
  the screen needs).
* OpenJPH 0.32.0 fixes a WASM decoder mask that breaks 24-bit reversible code-blocks; nothing up to 16 bits reaches
  it ([`../av1/README.md`](../av1/README.md) §Encoding, row VERSIONS).

## Licensing / patents

OpenJPH is BSD-2-Clause ([`../av1/licensing.md`](../av1/licensing.md)); its notice is served with the client.
Patent declarations on T.814: not read here.

## DICOM standing

In the standard since Supplement 235 (final text 2023-11-14): `1.2.840.10008.1.2.4.201` lossless only, `.202`
lossless with RPCL options, `.203` lossy allowed (PS3.6 2026d). Whether the served codestreams meet `.202`'s RPCL
options is not checked here.

## Maturity / tooling

OpenJPH 0.31.0, the newest tag when pinned; its encoder codes tens of frames a second
([`lab/av1/bytes`](../../lab/av1/bytes/README.md) §ENC).

## Where it wins

Decode, on every frame; every engine, exactly; every depth to 16 bits; a DICOM transfer syntax; and total time
wherever a slow CPU meets a fast link ([`../av1/README.md`](../av1/README.md) §Total time).

## Where it loses

Bytes, to the represented AV1 payload, JPEG 2000 Part 1 and JPEG XL ([`README.md`](README.md) §Side by side) — and
with them total time wherever the wire is slower than AV1's decoder.

## Open questions

Anything on a phone ([`../decode/README.md`](../decode/README.md) §Open).
