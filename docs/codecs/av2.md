# AV2

Measured on one frame a series, natively; no browser can decode it. The side-by-side table is
[`README.md`](README.md); the measurement is [`lab/av1/bytes`](../../lab/av1/bytes/README.md) §AV2.

## What it is

AOMedia's successor to AV1. Its reference software AVM v1.0.0 was tagged 2026-05-27 and the specification
announced 2026-06-09 ([`../av1/README.md`](../av1/README.md) §Options read from the sources). The specification's
text was not read here.

## How we use it (or would)

Lab only (the AV2 measurement, queue row AV2): bytes and native decode against libaom 3.15.1 and HTJ2K on the same frames. Nothing to adopt
while no browser decoder exists.

## Bytes

*Measured (the AV2 measurement, queue row AV2, [`lab/av1/bytes`](../../lab/av1/bytes/README.md) §AV2), one middle frame a series:*
AV2 has no profile over 10 bits, so it codes 11–14-bit samples split. On grey up to 13 bits but
CT it is the smallest coding here, 0.937–0.964 of HTJ2K and 0.4–4.7 % under libaom on the same
planes; libaom's 12-bit split stays 3–8 % smaller on CT and the 14-bit projections. The RGB
ultrasound is 1.648 of HTJ2K against libaom's 1.117. Encoding takes 50–110× libaom's time
(450–11 900 s a frame), native decoding 3.1–6.5× dav1d's. All 68 cells are exact.

## Decode speed

Native only (`avmdec`), in the paragraph above; no WASM build exists, and none is made.

## Total time

Unmeasured: no browser decodes it.

## Client resources

None: no client decoder exists.

## Browser and device support

None.

## Bit depths, signed, colour

10 bits a stream in AVM v1.0.0 (Main 4:2:0, 4:2:2 and 4:4:4); 12 bits is a test-only build flag
([`lab/av1/bytes`](../../lab/av1/bytes/README.md) §AV2; [`../av1/split-prior-art.md`](../av1/split-prior-art.md) §2).
Deeper samples are split as for AV1 ([`../av1/README.md`](../av1/README.md) §The bit split, explained); RGB is
coded as 4:4:4 identity.

## Random access and on-demand

As AV1's: a key frame decodes alone. Four tomosynthesis slices as one group were measured once
([`lab/av1/bytes`](../../lab/av1/bytes/README.md) §AV2); groups are otherwise unmeasured.

## Progressive / preview

The encoder has 1–16 operating-point sets ([`../av1/README.md`](../av1/README.md) §Options read from the sources);
unmeasured.

## Exactness risks and how they're checked

Every stream decoded by its own codec's decoder, merged, and matched against the checksum written when the frame
was made; four mutations each caught ([`lab/av1/bytes`](../../lab/av1/bytes/README.md) §AV2).

## Licensing / patents

AVM is BSD-3-Clause-Clear, which grants no patents; its `PATENTS` file is the AOM Patent License 1.0, and whether
AOM issued it for AV2's specification is unconfirmed ([`../av1/licensing.md`](../av1/licensing.md)).

## DICOM standing

None (PS3.6 2026d).

## Maturity / tooling

A reference encoder at v1.0.0, the slowest encoder measured here (§Bytes), and no browser
decoder.

## Where it wins

Bytes on grey from 10 to 13 bits but CT, on the frames measured.

## Where it loses

Encode time, decode time, colour, depths over 10 bits a stream, and every browser.

## Open questions

Whole series rather than one frame; a 12-bit profile, if AV2 defines one; a browser decoder.
