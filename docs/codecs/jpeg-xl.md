# JPEG XL

Measured, exact, not adopted. The side-by-side table is [`README.md`](README.md); its decode numbers live in
[`../decode/README.md`](../decode/README.md) §JPEG XL, and what the literature says of it in
[`../av1/lossless-literature.md`](../av1/lossless-literature.md).

## What it is

ISO/IEC 18181: a still-image codec whose lossless (modular) mode trades encoder effort and a decode-speed setting
(`--faster_decoding`) against bytes. The reference library is libjxl.

## How we use it (or would)

Lab only, as the reference column of row SIZE, the progressive codestream of row EMBED and the effort sweep of row
JXL. Not adopted: no setting is both smaller than HTJ2K and as fast to decode.

## Bytes

0.81–0.96 of HTJ2K at the default effort, 0.94–1.03 at the fastest, and half on a 16-bit film scan
([`../decode/README.md`](../decode/README.md) §JPEG XL; per set and effort,
[`lab/av1/bytes/jpeg-xl`](../../lab/av1/bytes/jpeg-xl/README.md)). Row SIZE's reference column, on three series:
[`../av1/README.md`](../av1/README.md) §Bytes. The literature puts it at 0.78–0.95 of HTJ2K
([`../av1/lossless-literature.md`](../av1/lossless-literature.md) §5).

## Decode speed

In WASM (libjxl 0.12.0), from about OpenJPH's time at the fastest effort to ten times it at the default:
[`../decode/README.md`](../decode/README.md) §JPEG XL.

## Total time

Unmeasured.

## Client resources

Code: row EMBED's libjxl WASM decoder, sized in [`lab/av1/bytes/embedded`](../../lab/av1/bytes/embedded/README.md).
Memory: unmeasured.

## Browser and device support

Native decoding sits behind a flag in Chromium 154 and a preference in Firefox 157, and is absent from WebKitGTK;
where it decodes, every path returns 8-bit samples ([`../decode/README.md`](../decode/README.md) §JPEG XL). Safari
has decoded it since 17.0; not tested here. Over 8 bits the exact path is libjxl in WASM.

## Bit depths, signed, colour

Integer samples to 31 bits in the standard, 24 in libjxl, Bits Stored 1–24 in DICOM
([`../av1/split-prior-art.md`](../av1/split-prior-art.md) §2). Exact here from 8 to 16 bits at every effort, grey and
RGB; a signed series is shifted by 2^(B−1) before coding, as for HTJ2K (`lab/av1/size.py` `pnm()`).

## Random access and on-demand

Every frame is its own codestream; an ask decodes one frame.

## Progressive / preview

**Progressive lossless JPEG XL** (libjxl 0.12.0, `-p`, squeeze) draws its first picture only after
**6–48 % of the bytes** (tomosynthesis 6 %, CT, MR and cone-beam 44–48 %), at 28–47 dB. libjxl
pauses at no progression step in a lossless frame, so a preview is a prefix flushed. The first
picture decodes in 1.3–2.9× OpenJPH's exact time and the whole codestream in 4.0–6.2×, and its
bytes are 0.91–0.95 of HTJ2K's. Row EMBED's run: [`jpeg2000.md`](jpeg2000.md) §Decode speed.

## Exactness risks and how they're checked

Row SIZE's 12-bit codings with libjxl 0.7.0 were inexact; 0.12.0 is exact at every depth up to 16. The browsers'
native paths are exact on 8-bit sources only. Both: [`../decode/README.md`](../decode/README.md) §JPEG XL.

## Licensing / patents

libjxl is BSD-3-Clause with its own royalty-free patent grant ([`../av1/licensing.md`](../av1/licensing.md)).

## DICOM standing

`1.2.840.10008.1.2.4.110`, JPEG XL Lossless, from Supplement 232 (final text 2024-09-18; PS3.6 2026d, PS3.5
§8.2.15).

## Maturity / tooling

libjxl 0.12.0, pinned in the lab; jxl-rs inside Chromium 154. Encode time a frame by effort:
[`lab/av1/bytes/jpeg-xl`](../../lab/av1/bytes/jpeg-xl/README.md).

## Where it wins

Bytes, at the default effort, on every set measured, and by half on the 16-bit film scan.

## Where it loses

Decode, wherever it saves 5 % of the bytes or more, and the browsers' native paths, which stop at 8 bits.

## Open questions

Safari on a device; a WASM build of jxl-rs with a sample API; JPEG-LS and the learned coders the literature
proposes ([`../av1/lossless-literature.md`](../av1/lossless-literature.md) §Proposed measurements).
