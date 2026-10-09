# Codecs — which one carries a series, and why

The codec is chosen per series and carried in its metadata; the wire, the store and the server never look inside a
coded frame ([`../av1/README.md`](../av1/README.md) §What already does not care about the codec). This file sets the
codecs side by side. Each has its own doc under the same seventeen headings, and every number in the tables below
is keyed to the doc that owns it:

* [`htj2k.md`](htj2k.md) — HTJ2K, the product's codec;
* [`../av1/README.md`](../av1/README.md) — AV1, built beside it; its work queue is [`../av1/queue.md`](../av1/queue.md);
* [`jpeg-xl.md`](jpeg-xl.md), [`jpeg2000.md`](jpeg2000.md) (Part 1) and [`av2.md`](av2.md) — measured for contrast.

## The rule

**Every frame on screen is bit-exact with the source, whichever codec carried it.** Ground truth is the encoder's
input — a checksum written when the input is made — never a decoder under test. A codec, depth or decoder path that
does not round-trip exactly is not used for that series ([`../av1/README.md`](../av1/README.md) §Decided,
[`../decode/README.md`](../decode/README.md) §Ground truth).

## Which series AV1 is for

The owner's order ([`../av1/series.md`](../av1/series.md)): **the breast family first** — FFDM, synthesized 2D, DBT
slices and projections, breast ultrasound and ABUS — **general cine second** (echo and ultrasound cine, XA, RF), and
**CT and MR stay HTJ2K**. Measured so far, no series qualifies: by row TOTAL4's rule a series is served as AV1 only
where it fills first in Chromium and Firefox on every link and CPU, and none does
([`../av1/README.md`](../av1/README.md) §Total time). Breast ultrasound, ABUS and angiography have no sound source
here ([`../av1/queue.md`](../av1/queue.md) §Blocked).

## The choice, as built

```
series ── row TOTAL4's rule: AV1 only where it fills first in both engines on every cell
   │        none qualifies today ─────────────────────────────────► HTJ2K, every depth to 16 bits, signed, RGB
   │
   └─ AV1 on request (ingest.py --codec av1), by b, the bits after the offset (row 72):
        RGB 8 ────────── RCT, one 10-bit 4:4:4 stream ───────────► WebCodecs*, else dav1d-WASM
        grey ≤ 8 ─────── one 8-bit 4:0:0 stream ─────────────────► WebCodecs*, else dav1d-WASM
        grey 9 ───────── k = 0, one 10-bit stream ───────────────► WebCodecs*, else dav1d-WASM
        grey 10–12 ───── k = 2: a top of 8–10 bits, 2 low bits ──► WebCodecs*, else dav1d-WASM
        grey 13 ──────── k = 3: a 10-bit top, 3 low bits ────────► WebCodecs*, else dav1d-WASM
        grey 14 ──────── k = 2: a 12-bit top, 2 low bits ────────► dav1d-WASM
        grey 15–16 ───── refused by name ────────────────────────► HTJ2K

   * where the engine's probe of that layout passed: Chromium, every row; Firefox, none of these (it takes the
     plain representation's 8-bit GBR)
```

The rule per depth is [`../av1/payload-format.md`](../av1/payload-format.md) §The split per depth; the split itself,
with a worked example, [`../av1/README.md`](../av1/README.md) §The bit split, explained; which engine passes which
probe, [`../decode/README.md`](../decode/README.md) §Why, and what would make it exact.

## The target series' depths

*b* is the bits a series needs after subtracting its minimum; a conformance statement's Bits Stored only bounds it
([`../av1/series.md`](../av1/series.md)).

| series | b | where it is known from |
| --- | --- | --- |
| FFDM for presentation | 12 | [`series.md`](../av1/series.md) §1d (two vendors); 30 exams of three systems, row FFDMSCALE ([`../av1/README.md`](../av1/README.md) §Samples over 12 bits) |
| FFDM for processing (raw) | 13–14 | §1d (13, one raw image); row FFDMSCALE (14) |
| synthesized 2D | 10, 12 | §1d |
| DBT slices | 10, 12 | §1d; 15 volumes of three systems, row DBTSCALE ([`../av1/README.md`](../av1/README.md) §Total time, *At scale*) |
| DBT projections | 14 | §1d; three systems, row BREAST ([`../av1/README.md`](../av1/README.md) §Samples over 12 bits) |
| breast ultrasound, still and cine | 8 | §1d, from the standard and every statement read; no sound source in the lab |
| ABUS | 8 | §1d, one vendor's statement; none in the lab |
| echo and general ultrasound cine | 8 | [`series.md`](../av1/series.md) §2 |
| XA | 8–16 allowed | §2; no run open |
| RF (fluoroscopy) | 12 | §2 |
| CT | 13 | [`series.md`](../av1/series.md) §3 (three vendors) |
| MR | 9–11 | §3 |
| PET; a digitized film | 15; 16 | row DATA3 ([`../av1/README.md`](../av1/README.md) §Samples over 12 bits) |

## At a glance

| codec | here | bytes against HTJ2K | decode against HTJ2K | exact in a browser | DICOM syntax |
| --- | --- | --- | --- | --- | --- |
| HTJ2K | served | — | — | every engine, in WASM | yes |
| AV1 | built, not served | smaller once represented | slower on every frame | every engine through dav1d-WASM; WebCodecs in Chromium | no |
| JPEG XL | lab | smaller, by effort | slower, by effort | in WASM; natively at 8 bits only | yes |
| JPEG 2000 Part 1 | lab | smaller | several times slower | in WASM | yes |
| AV2 | lab, native only | smaller on grey to 13 bits but CT | slower, natively | no | no |

## Side by side

Every cell's key, in brackets, is the place that states its number; *unmeasured* is unmeasured. Ratios are over
HTJ2K on the same frames; "1× · 4×" is the CPU throttle.

| | HTJ2K | AV1 | JPEG XL | JPEG 2000 Part 1 | AV2 |
| --- | --- | --- | --- | --- | --- |
| lossless bytes | 1 | 0.902–0.987 represented, 0.760–0.797 on two 10-bit DBT volumes; 0.776–1.117 coded whole [A-bytes] | 0.81–0.96 default effort, 0.94–1.03 fastest [D-jxl] | 0.93–0.96, preview layers included [J2K] | 0.937–0.964 on grey up to 13 bits but CT; 1.648 RGB [AV2] |
| decode a frame, 1× · 4× | 4.88–9.78 · 16.8–34.8 ms at 512²–768², 93 · 396 ms at 1914×2572 [D-speed, A-14] | WebCodecs 1.59–4.12×, dav1d-WASM 5.4–11.6× [A-stands] | 1.03–1.91× fastest effort, 5.35–10.0× default, WASM [D-jxl] | 6–12×, WASM [J2K] | native only: 3.1–6.5× dav1d's [AV2] |
| total time, wire and CPU | the baseline; its decode the clock on no cell [A-total] | 0.89–0.98 on five of seven series where the wire is the clock; 1.33–2.53 in Firefox at 4× on 50 Mbit [A-total4] | unmeasured | unmeasured | unmeasured |
| client code | OpenJPH 245 456 B `.wasm`, 55 158 B glue, the delivered build [D-build] | dav1d 623 KB `.wasm`, 238 KB gzipped; WebCodecs none [D-dav1d] | libjxl 625 KB `.wasm`, 220 KB gzipped [L-embed] | OpenJPEG 249 KB `.wasm`, 82 KB gzipped [L-embed] | no decoder |
| decoder worker, largest frames | 24.6 MB resident [A-mem] | dav1d-WASM 31.6 MB; WebCodecs 5–10 MB settled, 58 MB peak [A-mem] | unmeasured | unmeasured | — |
| deepest sample, one bitstream | 38 bits [S-2, PS3.5] | 12; 10 through WebCodecs [A-exact] | 31 in the standard, 24 in libjxl and DICOM [S-2] | 38 [S-2] | 10 [AV2] |
| exact browser path | OpenJPH-WASM in Chromium, Firefox, WebKitGTK [D-engines] | WebCodecs ≤ 10 bits in Chromium, 8-bit GBR in Firefox; dav1d-WASM in all three [D-engines, D-why] | libjxl-WASM; native 8-bit only, flagged [D-jxl] | OpenJPEG-WASM, Chromium [J2K] | none |
| DICOM transfer syntax | `1.2.840.10008.1.2.4.201`–`.203` [PS3.6] | none [PS3.6] | `1.2.840.10008.1.2.4.110` [PS3.6] | `1.2.840.10008.1.2.4.90`, `.91` [PS3.6] | none [PS3.6] |
| licence; patents | OpenJPH BSD-2-Clause; declarations not read [Lic] | dav1d, libaom BSD-2-Clause; AOM Patent License 1.0; pools' claims unconfirmed [Lic] | libjxl BSD-3-Clause; royalty-free grant [Lic] | OpenJPEG BSD-2-Clause; none granted [Lic] | AVM BSD-3-Clause-Clear; the AOM licence's reach to AV2 unconfirmed [Lic] |
| encode a frame | 58–136 frames/s a core [A-enc] | 0.35–1.6 s at the fastest preset within 2 % of the slowest's bytes (7.2 s on the RGB ultrasound), 3.0–11.1 s at the slowest [A-enc] | 0.01–0.08 s at effort 1, 14–47× HTJ2K at 7 [L-jxl] | unmeasured | 450–11 900 s [AV2] |

Keys: **A-** [`../av1/README.md`](../av1/README.md): *bytes* §Bytes; *stands* §Where AV1 stands; *total* §Total time,
*Every exact form, five links*; *total4* §Total time, *Every change of the round*; *mem* §Decode time and memory,
*Memory and first use*; *exact* §Exactness and the decoders; *enc* §Encoding; *14* §Samples over 12 bits, row REP14.
**D-** [`../decode/README.md`](../decode/README.md): *speed* §Decode time against HTJ2K; *jxl* §JPEG XL; *build*
§The build, as delivered; *dav1d* §dav1d-WASM, the decoder the client runs; *engines* §AV1 in WebKit and Firefox;
*why* §Why, and what would make it exact. **L-** *embed* [`lab/av1/bytes/embedded`](../../lab/av1/bytes/embedded/README.md)
§Decode time; *jxl* [`lab/av1/bytes/jpeg-xl`](../../lab/av1/bytes/jpeg-xl/README.md). **J2K**
[`jpeg2000.md`](jpeg2000.md); **AV2** [`av2.md`](av2.md) §Bytes and [`lab/av1/bytes`](../../lab/av1/bytes/README.md) §AV2.
**S-2** [`../av1/split-prior-art.md`](../av1/split-prior-art.md) §2; **Lic** [`../av1/licensing.md`](../av1/licensing.md);
**PS3.5**, **PS3.6** §Specifications below. Times are a container's, never a phone's; the ultrasound's numbers are
provisional (a lossy-sourced set, [`../av1/README.md`](../av1/README.md)).

## Why HTJ2K is the default, and what would reopen it

HTJ2K decodes every frame faster than any exact AV1 path, exactly, in every engine measured; it holds every target
depth in one codestream; it has a DICOM transfer syntax; and by row TOTAL4's rule no series fills first as AV1 in
both engines on every cell. AV1's lead is bytes, and it collects them only where the wire is slower than its
decoder.

What would reopen it, each the owner's call or an engine's change ([`../av1/queue.md`](../av1/queue.md) §Blocked):

* **a rule by link or by client** in place of "every cell in both engines" — the server would need to know them;
* **a faster exact AV1 path outside Chromium**: Firefox returning grey and over 8 bits from WebCodecs, or WebKit's
  decoder taking AV1 at all ([`../decode/README.md`](../decode/README.md) §Why, and what would make it exact);
* **a device run**: Safari and phones decide where the CPU, not the wire, is the clock;
* **sound cine, ABUS or angiography data**, the content where inter coding could pay and nothing here measured it.

## Specifications

| specification | edition | where | read | what for |
| --- | --- | --- | --- | --- |
| AV1 Bitstream & Decoding Process Specification | 1.0.0 with Errata 1, 2019-01-08 | <https://aomediacodec.github.io/av1-spec/av1-spec.pdf> | 2026-10-09, the approved PDF's front matter; profiles and levels 2026-10-05 ([`series.md`](../av1/series.md) [A1]) | profiles, depths, lossless as normative |
| AV1 Codec ISO Media File Format Binding | v1.3.0, AOM Final Deliverable, 2024-04-03 | <https://aomediacodec.github.io/av1-isobmff/v1.3.0.html> | 2026-10-09 | §5, the codecs parameter string ([`../av1/payload-format.md`](../av1/payload-format.md) §Decoder choice, per payload) |
| WebCodecs | W3C Working Draft, 2026-10-07 | <https://www.w3.org/TR/2026/WD-webcodecs-20261007/> | 2026-10-09; the draft of 2026-09-21 on 2026-10-05 | `VideoDecoder`, `VideoPixelFormat` |
| AV1 WebCodecs Registration | W3C Group Note Draft, 2026-06-08 | <https://www.w3.org/TR/2026/DNOTE-webcodecs-av1-codec-registration-20260608/> | 2026-10-09 | no operating-point field |
| DICOM PS3.3 | 2026d | <https://dicom.nema.org/medical/dicom/current/output/chtml/part03/PS3.3.html> | 2026-10-05 ([`series.md`](../av1/series.md) [D1]); C.7.6.3 2026-10-09 | each target series' pixel module |
| DICOM PS3.5 | 2026d | <https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.html> | 2026-10-09: §8.2.4, §8.2.14–8.2.16 | JPEG 2000, HTJ2K (Bits Stored 1–38), JPEG XL, Deflated Image Frame |
| DICOM PS3.6 | 2026d | <https://dicom.nema.org/medical/dicom/current/output/chtml/part06/chapter_A.html> | 2026-10-09: Table A-1 | the transfer syntax UIDs; no AV1 entry |
| DICOM Supplement 232, JPEG XL Transfer Syntaxes | Final Text, 2024-09-18 | <https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup232.pdf> | 2026-10-09, its status and scope | `.4.110` |
| ITU-T T.814, High-throughput JPEG 2000 | 06/2019, in force | <https://www.itu.int/rec/T-REC-T.814> | 2026-10-09: the record and the freely available PDF's front matter | HTJ2K's standing |

**Not read.** ISO/IEC 15444-15 (HTJ2K) and ISO/IEC 18181-1 and -2 (JPEG XL) are sold; nothing here rests on them,
and T.814 is the common text of the first. ITU-T T.800 (JPEG 2000 Part 1) is free and was not read: no claim here
rests on it. AV2's specification: announced 2026-06-09, its host refused this container in row SWEEP and not tried
since ([`av2.md`](av2.md)). Patent declarations on T.814 and T.800 (the ITU's patent database): not read.
