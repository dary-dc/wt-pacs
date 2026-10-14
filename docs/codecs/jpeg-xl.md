# JPEG XL

Measured, exact, not adopted. The side-by-side table is [`README.md`](README.md); its decode numbers live in
[`../decode/README.md`](../decode/README.md) §JPEG XL, and what the literature says of it in
[`../av1/lossless-literature.md`](../av1/lossless-literature.md).

## What it is

ISO/IEC 18181: a still-image codec whose lossless (modular) mode trades encoder effort and a decode-speed setting
(`--faster_decoding`) against bytes. The reference library is libjxl.

## How we use it (or would)

Lab only, as the reference column of the lossless-bytes measurement (queue row SIZE), the progressive codestream of
the embedded-preview measurement (queue row EMBED) and the effort sweep of the JPEG XL measurement (queue row JXL). Not adopted: no setting is both smaller than HTJ2K and as fast to decode.

## Bytes

0.81–0.96 of HTJ2K at the default effort, 0.94–1.03 at the fastest, and half on a 16-bit film scan
([`../decode/README.md`](../decode/README.md) §JPEG XL; per set and effort,
[`lab/av1/bytes/jpeg-xl`](../../lab/av1/bytes/jpeg-xl/README.md)). The lossless-bytes measurement's reference column (queue row
SIZE), on three series:
[`../av1/README.md`](../av1/README.md) §Bytes. The literature puts it at 0.78–0.95 of HTJ2K
([`../av1/lossless-literature.md`](../av1/lossless-literature.md) §5).

## Decode speed

In WASM (libjxl 0.12.0), from about OpenJPH's time at the fastest effort to ten times it at the default:
[`../decode/README.md`](../decode/README.md) §JPEG XL.

## Total time

Unmeasured.

## Client resources

Code: the embedded-preview measurement's (queue row EMBED) libjxl WASM decoder, sized in [`lab/av1/bytes/embedded`](../../lab/av1/bytes/embedded/README.md).
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
bytes are 0.91–0.95 of HTJ2K's. The embedded-preview measurement's run (queue row EMBED): [`jpeg2000.md`](jpeg2000.md) §Decode speed.

## Exactness risks and how they're checked

The lossless-bytes measurement's 12-bit codings (queue row SIZE) with libjxl 0.7.0 were inexact; 0.12.0 is exact at every depth up to 16. The browsers'
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

## jxl-rs in WASM

*Queue row JXLRS (186), 2026-10-13. Theory: jxl-rs read at v0.7.4 (`624ce908`), libjxl at v0.12.0 (`a7a9c787`);
nothing built or timed. The protocol below is for a separate session given it and its rule only.*

**The question.** Built to WASM with a sample API, is any JPEG XL setting decoded by jxl-rs as fast as OpenJPH and
smaller? The decoder is jxl-rs, which Chromium and Firefox both adopted.

**What it starts from** (row JXL, [`lab/av1/bytes/jpeg-xl`](../../lab/av1/bytes/jpeg-xl/README.md), libjxl 0.12.0 in
WASM against OpenJPH):

| setting | bytes, × HTJ2K | decode, × OpenJPH |
| --- | --- | --- |
| e1 | 0.94–1.03 | 1.03–1.91 (timed rounds) |
| e2 | 0.89–0.97 | 1.7–2.6 |
| e7 f3 | 0.91–0.98 | 1.56–2.45 |
| e7, the default | 0.81–0.96 | 5.35–10.0 |

To be net, jxl-rs must decode e1 1.0–1.9× faster than libjxl does (on all but the projections, where e1 is larger
than HTJ2K), or e2 1.7–2.6× faster.

**What jxl-rs has that the libjxl build had not:**

* **16-bit modular buffers** (0.7.0): `ModularStorage::I16`, chosen when the header's
  `modular_16bit_sufficient` is set (`jxl/src/frame/mod.rs:169–179`). libjxl's encoder clears that flag above 12
  bits (`lib/jxl/image_metadata.h:241`). So the gain is open to the ≤ 12-bit series (MR, `dbt10`/`dbt12`,
  mammograms for presentation, ultrasound). CT (13), projections (14), raw mammograms (14) and PET (15) keep 32-bit
  buffers.
* **Specialised trees**, which libjxl has too: `WpOnly`, `GradientOnly`, `SingleGradientOnly`, `NoTreeZero`
  (`jxl/src/frame/modular/decode/specialized_trees.rs:262–387`). e1's fixed gradient tree takes the gradient path in
  both decoders.
* **A WASM SIMD128 backend**, `jxl_simd/src/wasm32/simd128.rs`, built with `+simd128,+relaxed-simd` in its own
  config (`.cargo/config.toml`). It has no threads on `wasm32` (rayon is not supported there, `jxl/Cargo.toml:37`), as
  OpenJPH has none.
* **An integer sample output**, `JxlDataFormat::U16 { bit_depth }` (`jxl/src/api/data_types.rs:107`). It reaches
  u16 through f32: modular i32 × 1/(2^b − 1), then × (2^b − 1) and rounded (`ConvertModularToF32Stage`,
  `ConvertF32ToU16Stage`, `jxl/src/render/stages/convert.rs:246`, `:787`). For b ≤ 16 that round trip is exact by
  arithmetic: the error is under (2^b − 1) × 2^−23 ≤ 2^−7, far inside the rounding's half step. *D, still checked
  against the encoder's input.* It costs two passes over the frame that a direct i32 → u16 stage would not, and
  libjxl's u16 output pays the same.

**Where its time would go.** A lossless modular frame is decoded pixel by pixel. For each pixel the tree picks a
context from the neighbours, a predictor runs, and the entropy decoder (prefix codes at e1, ANS above) reads a
residual. That loop is scalar in both decoders; SIMD reaches only the inverse transforms (RCT, palette, squeeze) and
the output conversion. 16-bit buffers halve those passes' memory traffic and double their lanes. They do not touch the
per-pixel loop, which is most of the frame at e1 and e2. jxl-rs's README claims speed that "closely matches (and
sometimes exceeds)" libjxl's, natively and with no numbers.

**Predictions.** jxl-rs in WASM at ×0.8–1.2 of libjxl-WASM's decode on ≤ 12-bit series and ×0.9–1.2 above. So e1
at 0.85–2.3× OpenJPH and e2 at 1.4–3.1×: **no setting both smaller than HTJ2K and as fast as OpenJPH on a sound
target series.** The closest is e1 on a ≤ 12-bit series where libjxl was 1.03–1.5×; it is net only if jxl-rs beats
the top of that range. The bytes are libjxl's encoder's and do not change. **A trade-off at best:** 1–5 % fewer bytes
at e1, ≥ OpenJPH's decode.

**Protocol, for a separate session (the measuring row):**

* **Build:** a lab crate (`lab/av1/bytes/jxl-rs`). It wraps `jxl` at v0.7.4 (commit `624ce908…`, the `Cargo.lock`
  checksummed) with `wasm-bindgen`, and exposes `decode(bytes) → { width, height, bits, samples: Uint16Array |
  Uint8Array }` through `JxlDataFormat::U16` or `U8` at the codestream's bit depth. It is built for
  `wasm32-unknown-unknown` with the `simd128` feature and `-C target-feature=+simd128`; the Rust toolchain and
  wasm-bindgen are pinned by version. `+relaxed-simd` goes in a second build only if both engines run it. Licence (BSD-3-Clause)
  into [`../av1/licensing.md`](../av1/licensing.md) first.
* **Codings:** row JXL's `encode.py` (cjxl 0.12.0) at e1 f0, e2 f0, e7 f3, and each set's smallest. Sets: row JXL's
  sound ones (`dbt10_ea1141`, `dbt12_ea1141`, `ffdm_a`, `dbtproj_holo`), plus `mr_ispy1` (11-bit, 16-bit buffers),
  `ct_lidc` (13-bit) and `dbtproj_ge` (14-bit, 32-bit buffers). The ultrasound sets are `lossy-sourced` and the film
  `lossless-but-unrepresentative`: reported, deciding nothing.
* **Arms:** OpenJPH (the product's build), libjxl-WASM (row EMBED's build) and jxl-rs-WASM, by row JXL's `run.mjs`
  timing. Headless Chromium 141 and Firefox 157, 1× and 4×, n = 8 rounds in a Williams order. Every arm's build is
  printed by sha256. Every frame is hashed against the checksum written from the encoder's input; `--mutate hash`
  fails every variant.
* **Measured:** bytes × HTJ2K, decode × OpenJPH and × libjxl paired by round, the `.wasm`'s size, and the worker's
  memory (`measureUserAgentSpecificMemory`).
* **Rule:**
  * Proposed to the owner as a third codec (structural: a codec tag and a decoder module, as AV1 took) only if a
    setting on a sound series is ≤ 0.97 of HTJ2K's bytes, its decode no slower than OpenJPH's beyond the spread of
    the round ratios, in both engines at 1× and 4×, with every frame exact.
  * Otherwise closed, naming the closest cell.
  * jxl-rs against libjxl is reported either way: it settles which JPEG XL decoder the lab uses.

## Open questions

Safari on a device; a WASM build of jxl-rs with a sample API (§jxl-rs in WASM, a protocol); JPEG-LS and the learned coders the literature
proposes ([`../av1/lossless-literature.md`](../av1/lossless-literature.md) §Proposed measurements).
