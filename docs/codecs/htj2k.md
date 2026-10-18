# HTJ2K

The product's codec: every series is served as HTJ2K today, and every other codec here is measured against it. The
side-by-side table is [`README.md`](README.md); the decoder's own numbers live in
[`../decode/README.md`](../decode/README.md).

## What it is

High-Throughput JPEG 2000, ISO/IEC 15444-15 | ITU-T T.814 (2019): JPEG 2000's wavelet and codestream with EBCOT's
block coder replaced by a faster one. The reversible 5/3 path is lossless.

## How we use it (or would)

Every frame is one codestream in the served profile — reversible 5/3, five decompositions, 64² code-blocks, RPCL,
one layer, one tile ([`../decode/README.md`](../decode/README.md) §The decoder), kept by the HTJ2K encoder-settings measurement (queue row HTJ2KENC) against 35
other settings (§Encoder settings there). Ingest writes it with OpenJPH
(`ingest/coded-frames/ingest.py`, codec `htj2k`); the client decodes it with OpenJPH in WASM, a build the product makes from pinned sources
([`client/decode/wasm/build`](../../client/decode/wasm/build/README.md)).

## Bytes

The reference: every ratio in these docs is a codec's bytes over HTJ2K's on the same frames. JPEG 2000 Part 1 is a
few per cent smaller ([`jpeg2000.md`](jpeg2000.md) §Bytes); no OpenJPH setting is smaller by more than 1 %
([`../decode/README.md`](../decode/README.md) §Encoder settings).

## Decode speed

The fastest exact decoder measured here on every series but 8-bit RGB, where native JPEG XL behind a flag beats it
([`jpeg-xl.md`](jpeg-xl.md) §Browser and device support): [`../decode/README.md`](../decode/README.md) §Decode time
against HTJ2K, per frame against AV1's paths, and §Faster HTJ2K in the browser, where its time goes (the HT block
decoder) and what moves it (code-blocks on threads: an ask's lever on frames from 1914×2572 up, not shipped).

## Total time

The baseline of every total-time table ([`../av1/README.md`](../av1/README.md) §Total time). In the five-link
total-time measurement's fills (queue row TOTAL) its decode was the clock on no cell, where AV1's was at 4× on 50 Mbit.

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
  it ([`../av1/README.md`](../av1/README.md) §Encoding, the codec-versions measurement, queue row VERSIONS).

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

## A value map for sparse series

*Queue row HTJ2KPACK (185), 2026-10-13. Theory: nothing new built or timed. The protocol below is for a separate
session given it and its rule only.*

**The question.** Which target series have sparse histograms (a few used levels across a wide range), and does a
value map before HTJ2K cut their bytes with decode unchanged beyond a lookup pass?

**The map.** Histogram packing replaces each sample by the rank of its value among the series' used levels, codes the
ranks, and stores the used levels as a per-series table. The client looks every decoded sample up in the table.
Sources: Pinho, ICIP 2001 and IEEE SPL 9(1), 2002; Starosolski, SPIE 5959, 2005 and AIP 1060:269, 2008, both as
[`../av1/split-prior-art.md`](../av1/split-prior-art.md) cites them, with JPEG-LS. Starosolski's figures:

* CT −42 %, MR −51 %, CR −15 %;
* ~0 to −3.7 % on dense histograms;
* the gain negligible above half the range used.

**Why it pays a wavelet coder.** Lossless HTJ2K is the reversible 5/3 lifting wavelet and then a block coder over the
coefficients' magnitude bits. Take a comb, values on every g-th level. Its lifting rounds a mean of two samples that
are multiples of g, so the detail coefficients carry the comb's step as structure in their low log₂ g bit planes:
about log₂ g bits a sample that a packed plane does not spend. An isolated gap, such as a CT's pad at −2048 under air
at −1097, costs only at its edges. Packing shrinks that step from ~950 to 1, and the cost of the edge's coefficients
goes with it. Irregular gaps are mapped non-linearly, so a smooth ramp across them becomes uneven steps. That can
cost bits, which is why the gain follows the used fraction and not the gaps alone. *Derived, not measured here.*

**The target series as row 64 (REMAP) counted them** ([`lab/av1/bytes/remap`](../../lab/av1/bytes/remap/README.md)):
levels used, and the fraction of the span they cover (D, from its table):

| series | depth | levels used | fraction of the span | predicted HTJ2K bytes, packed |
| --- | --: | --: | --- | --- |
| `mg16_cbis` film | 16 | 2 969 | 2 969 over 16 bits, ≪ ½ | **0.576 of HTJ2K, measured** (row 64); the set is `lossless-but-unrepresentative`, so it decides nothing |
| `dbtproj_holo` projections | 14 | 1 685 | 0.41 of 12 bits, plus one saturated level | 0.90–0.99: under ½, so some gain; the 0.59 % saturated samples' step shrinks too |
| `dbtproj_ge` projections | 14 | 3 364 | 0.82 of 12 bits, plus 16383 on 10.9 % of samples | 0.95–1.00: dense; the saturated step's edges are the only gain |
| `ct_lidc`, `ct_nlst`, `ct_crc` | 13 | 3 112–3 666 | dense but for the pad's gap | 0.97–1.00 |
| `xa_dynact16` cone-beam | 13 | 5 460 | dense | 1.00 ± 0.01 |
| `pt15_cptac` PET | 15 | 30 900 | 0.94 | 1.00 ± 0.01 |

Nobody has counted the breast family's processed images: mammograms for presentation (`ffdm_*`, `ffdms_*`) and
synthesized 2D (`syn2d*`). Those are the likeliest combs here. A 12- or 13-bit detector written into 14 or 16 bits
through a gain gives every g-th level, and a comb at g = 4 is predicted at ~2 bits a sample, 0.7–0.8 of HTJ2K's bytes.
**How often such series reach a PACS is not known**, and that is the question the row's first step answers.

**Decode.** Three effects:

* **The block decoder spends less.** HT's cleanup and refinement passes cost per coded byte and per magnitude bit,
  and 55–70 % of a frame's decode is that block decoder ([`../decode/README.md`](../decode/README.md) §Faster HTJ2K in the browser). A plane with fewer bytes decodes in
  less time, roughly in proportion. *Predicted, not measured:* row 64 timed only AV1 on its maps.
* **A lookup is added.** Per sample, one gather from a table of n ≤ 2^16 entries. Fused into the wrapper's output
  pass (`client/decode/wasm/openjph/htj2k_decoder.cpp`), it takes that pass off SIMD. The pass's SIMD was worth
  5.5–8.3 % of a grey frame ([`../decode/README.md`](../decode/README.md) §The wrapper's two passes), so the lookup
  is predicted at +5–10 % fused and +8–15 % as a separate pass over the samples.
* **The frame check is unchanged.** The ingest's digest is over the source's samples, so it must be taken after the
  lookup, which the check then covers.

So on a series with fraction ≪ ½ (bytes ≤ 0.8) the decode is predicted to be at most today's, and **net**. On a
mildly sparse one (0.9–0.99) it is predicted **slower by the lookup**, a trade-off. On dense ones it is a tie in
bytes and a loss in decode, so a series is mapped only where its table pays.

**What it would change** (structural: a store-format change, proposed, not built):

* a `valueMap` in the series' metadata, the used levels in order, n × 2 B, and absent on every series today;
* a series without it decodes exactly as today, so HTJ2K is unchanged;
* the wire and the server are unchanged;
* the ingest packs, records the table, and keeps the digest over the source;
* the ingest picks a map only when the packed series is smaller by its rule;
* DICOM export (`ingest/from-dicom` is the import) must unpack and re-code, since packed codestreams are not the
  source's pixel data.

**Protocol, for a separate session (the measuring row):**

1. **Density first.** For every `sound` target set in `lab/av1/data.json`, the whole series as fetched: levels used,
   the span, the fraction, and the gcd of the gaps between used levels (a comb's g), from the encoder's input. Sets
   with a fraction under ½ or a g > 1 go to step 2, with `ct_lidc` and `dbtproj_ge` as dense controls. If none does,
   the row ends there with the table, and the lever is closed for want of sparse series.
2. **Bytes.** HTJ2K as the product's ingest codes it (OpenJPH 0.31.0, its settings), on the source and on the packed
   plane, at the packed plane's own depth (⌈log₂ n⌉ bits, unsigned). The table's bytes are counted in. Every frame is
   decoded natively and matched with the checksum written at fetch, after the lookup. A mutated table, one entry off,
   fails every frame.
3. **Decode,** on the sets that step 2 finds ≤ 0.95. The product's decoder against itself with the lookup:
   unfused (a pass over the frame before the check) and, if the session builds it, fused into the wrapper's output
   pass. §Net protocols' common rule ([`../decode/README.md`](../decode/README.md), A, A′ and B, n = 12, interleaved
   by `lab/scripts/order.py`); headless Chromium 141 and Firefox 157 at 1× and 4×. Every arm prints its build's
   sha256.
4. **Predictions:** the bytes column above, and 0.7–0.8 on any comb with g = 4. Decode with the lookup ≤ ×1.0 where
   bytes are ≤ 0.8, and ×1.05–1.15 where they are 0.9–0.99.
5. **Rule.**
   * **Net**, and proposed to the owner as the format change above, if a sound target series packs to ≤ 0.95 of
     HTJ2K's bytes with every frame exact, and no decode cell is worse beyond the A/A spread.
   * **A trade-off for the owner**, with both numbers, if the bytes hold and decode is worse.
   * **Closed** if no sound target series reaches ≤ 0.95.

## Open questions

Anything on a phone ([`../decode/README.md`](../decode/README.md) §Open).
