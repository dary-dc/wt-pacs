# The AV1 payload: format and representations

The unit one stored entry, one ask and one media message carry when the codec is AV1. Settled from the lossless-bytes, high-depth split, encode-time and AV1-alone bytes measurements
(queue rows 6, 7, 14 and 28) and adopted by the owner on 2026-10-04 as the shape both the lab and the product use. Two representations: **plain**
(lossless AV1 as it codes out of the box — the control set against HTJ2K) and **optimized** (the high-depth split and AV1-alone bytes measurements: the two
low bits apart, JPEG 2000's reversible colour transform), so the representation work is measured against the control.

Today G = 1: one frame per payload (n = 1). The format still carries n so G > 1 needs no format change.

## Payload

```
payload   := header(16) · len[n] · frame[n]
header := version u8 = 1 · bits u8 · depth u8 · split u8 · flags u8 · pad u8[3] = 0 · offset u32le · n u32le
len    := u32le                                   byte length of frame j
frame  := one temporal unit                       when split = 0
        | u32le top length · top unit · low unit  when split > 0
```

* `bits` — the source sample depth the decoder reports (e.g. 12 for a 12-bit MR, 13 for CT after offset, 8 for RGB),
  at most 16.
* `depth` — bits of the deepest coded stream (8, 10 or 12). Picks the decoder before anything is decoded.
* `split` — low bits coded apart, k = 0 to 8 (the low stream is 8-bit). Ingest emits 0, 1 or 2 by default (1 only in
  the plain representation, below); `--split K` writes any k of the split exactness check's matrix (queue row SPLITOK), below.
* `flags` — bit 0 `signed` (source samples signed; `offset` was added at ingest); bit 1 `rct` (RGB coded through
  JPEG 2000's reversible colour transform). Other bits must be 0; a reader refuses unknown bits. RGB without `rct`
  is planes G, B, R, 8-bit 4:4:4 (the plain representation).
* `offset` — added at ingest so every sample is ≥ 0; the decoder subtracts it.
* Sample = `((top << split) | low) − offset` for grey; R, G, B from planes G, B, R for RGB without `rct`.
* Grey 8-bit and plain RGB share a header (bits 8, depth 8, split 0, flags 0); the decoded stream's plane count
  tells them apart (a client may read the unit's AV1 `seq_profile` first: profile 1 is always 4:4:4).
* A reader refuses: version ≠ 1, unknown flag bits, a decoded stream whose depth ≠ `depth` (top) or ≠ 8 (low),
  `n` ≠ the count expected, lengths that overrun the payload, `split` over 8 (*was* ∉ {0, 1, 2} *until the split exactness check*),
  `bits` over 16, `rct` with `split` > 0, a top stream not of three planes under `rct`, or of three planes without it
  unless bits 8, depth 8, split 0, unsigned; without `rct`, `bits` > `depth + split`, or a `depth` other than the
  smallest of 8, 10, 12 holding the top's `bits − split` (*was* `bits` ≤ 8 with `depth + split` > 8 *until the split exactness check*,
  which refused every split 8-bit source); a non-zero `offset` without `signed`. *Built, and also refused:* a payload under 16 bytes, a pad byte not 0, a `depth` other than 8, 10
  or 12, and bytes past the last frame.
* HTJ2K coded frames stay bare codestreams (the series' metadata, `codec`, says which; the bundle has no codec field,
  [`../disk-layout/README.md`](../disk-layout/README.md)).

## Representation at ingest

*`lab/av1/bytes/represented/` in the public lab, queue row 28 LLSIZE.*

| source | coded as | header |
| --- | --- | --- |
| grey ≤ 8 bits | one 8-bit 4:0:0 stream | split 0, depth 8 |
| grey 9 bits (after any offset) | the samples, one 10-bit 4:0:0 stream | split 0, depth 10 |
| grey 10–12 and 14 bits | top = v ≫ 2, 4:0:0 at the smallest of 8/10/12 that holds bits − 2; low = v & 3, 8-bit 4:0:0 | split 2, depth = top's coded depth |
| grey 13 bits | top = v ≫ 3 at 10 bits; low = v & 7, 8-bit 4:0:0 | split 3, depth 10 |
| grey 15–16 bits | refused: served as HTJ2K (the per-depth split measurement, queue row SPLITTIME: every AV1 layout 1.02–3.11 of its fill) | — |
| RGB 8-bit | RCT: Y = ⌊(R + 2G + B)/4⌋, Cb = B − G + 256, Cr = R − G + 256; one 10-bit 4:4:4 stream, identity matrix, plane order exactly as the lab's `llsize.py` writes it (confirmed on sound colour stills, the native colour stills measurement, queue row RGBNATIVE: 0.54–0.66 of GBR's bytes) | flags.rct, split 0, depth 10, bits 8 |
| signed | offset = −min of the series first, then the grey rules | flags.signed |
| RGB > 8 bits | refused (no modality needs it; aomenc 3.15.1 cannot) | — |

Inverse RCT (exact, the lab's): G = Y − ⌊((Cb − 256) + (Cr − 256))/4⌋, R = (Cr − 256) + G, B = (Cb − 256) + G.

### The plain representation: the control (owner, 2026-10-04)

AV1 as it codes out of the box, to set against HTJ2K in its normal form; the table above is measured against it
as our improvement. The lab's `direct`, `low1` and `gbr` codings. `--av1-representation plain` at ingest.

| source | coded as | header |
| --- | --- | --- |
| grey ≤ 12 bits (after any offset) | the samples, 4:0:0 at the smallest of 8/10/12 holding them | split 0 |
| grey 13–14 bits | top = v ≫ (bits − 12) at 12 bits; low = v & (2^(bits − 12) − 1), 8-bit 4:0:0 | split 1 or 2, depth 12 |
| RGB 8-bit | the channels as they are, 4:4:4 8-bit, identity matrix, planes G, B, R | flags 0, split 0, depth 8, bits 8 |

Encoder: the settings below less `--tune-content=screen --sb-size=64`; the same presets per content.

**Encoder:** libaom 3.15.1 `aomenc --ivf --lossless=1 --bit-depth=B --input-bit-depth=B --kf-max-dist=0
--tune-content=screen --sb-size=64 --threads=1`, `--monochrome` for grey, `--color-primaries=bt709 --transfer-characteristics=srgb --matrix-coefficients=identity` for
RGB (AV1's RGB signal: with the identity matrix alone WebCodecs reports a BT.709 matrix and no colour payload passes its probe) (Y4M `420`/`420p10`/`420p12` with
neutral chroma, as the lab does); preset: the fastest within 2 % of cpu0's bytes per content (the encode-time measurement, queue row ENC); RGB ultrasound at cpu0; IVF split into one temporal unit per frame (strip each IVF frame's 12-byte header). Frames parallel across
processes.

**Exact at ingest, or nothing written:** native dav1d decodes every payload and the reconstructed samples must equal
the source plane (the same plane the tag's `exactness` hash covers) before the bundle is written; a mismatch names
the frame.

## Decoder choice, per payload

* **WebCodecs** (`hardwareAcceleration: 'prefer-software'`, `optimizeForLatency: true`, `copyTo`) when every
  stream of the payload is ≤ 10 bits, `VideoDecoder` exists, and a per-worker, per-layout probe (one tiny bundled unit,
  checksum checked) passes.
* **The codec string is the stream's own** (queue row 67 CODECSTR): each keyframe's sequence header gives the AV1 codecs
  parameter string (AV1-ISOBMFF §5) with every optional field — `av01.P.LLT.DD.M.CCC.cp.tc.mc.F`, the level and tier
  of operating point 0 as coded, 31 included — and the decoder is reconfigured only when the string changes. Chromium
  reports the string's colour on the frame, not the stream's, so whether a 4:4:4 stream is identity (matrix 0) is
  read from the sequence header, as for dav1d-WASM. Which engines accept which strings:
  [`lab/av1/exact/codec-string`](../../lab/av1/exact/codec-string/README.md).
* **dav1d-WASM** (dav1d 1.5.4, emscripten 3.1.74, SIMD build) otherwise — 12-bit top streams, no `VideoDecoder`,
  or a failed probe.
* Both imported, and dav1d's glue and WASM fetched, when an AV1 series' decoder starts; each initialised on first use, memoised; an HTJ2K page fetches no AV1 code ([`lab/page-open/README.md`](../../lab/page-open/README.md) §Cold round trips by codec).

## Built (`20c3674`)

The writer is [`ingest/coded-frames/ingest.py`](../../ingest/coded-frames/README.md), `pack-series` bundles its payloads when the metadata
says `"codec": "av1"`, and the reader is `client/decode/av1.js` with `av1-payload.js` (the header and its refusals) and
`av1-frame.js` (the merge) — [`client/README.md`](../../client/README.md) §An AV1 series. The
per-layout probes are 16×16 units (grey 8/10, 4:4:4 8/10, and 8-bit grey as 4:2:0 since the grey-as-4:2:0 measurement, queue row GREY420) in `av1-probe.js`, checked by an FNV-1a of their planes. On
the first 8 frames of the fluoroscopy, CT, MR and ultrasound series, both representations, all 96 payloads were written and
decoded by the reader to their sources; optimized over plain matches the AV1-alone bytes measurement to the third digit
([`lab/av1/exact/coded-frame`](../../lab/av1/exact/coded-frame/README.md) §Checked). The lab harnesses of the earlier measurements (queue rows 9–38) that hand the client bare temporal units, or import the decoder modules
(`lab/av1/{speed,fill,total,decspeed,wcbase,xbrowser,footprint,rep14}`), are not ported: on this branch they would
need their frames written as payloads; their readings stand as measured before it.

**Widened (the split exactness check, queue row SPLITOK, [`lab/av1/exact/split`](../../lab/av1/exact/split/README.md)).** The writer (`ingest.py --split K`)
and the reader take grey of 8–16 bits after the offset, unsigned and signed, at any k ≤ 8 whose top fits a 12-bit
stream; the defaults above are unchanged until the per-depth split measurement (queue row SPLITTIME). Checked exact at every b = 8…16 and every k = max(0, b − 12) …
max(b − 8, 4), natively, in Node and in Chromium, Firefox and WebKitGTK, synthetic to 4096×5120 and real, and the old and new
refusals matched by message. *Corrected 2026-10-30:* its signed sets are centred on 0, so a signed source of ≤ 8
bits after the offset whose values leave −128…127 was not shown exact, and wrapped (§Is the split safe?, P4; fixed 2026-10-31). The reader's signed mask is now the output container's (0xFF, 0xFFFF): the old
2^(depth + split) − 1 reports a wrong range for signed 8-bit with a split and for signed 16-bit at k = 5 and 7.
**New limits:** `bits` ≤ 16, `split` ≤ 8, a top of at most 12 bits; a payload's `depth` is the smallest of 8, 10, 12
holding its top.

## Proposed: a remapped plane, not built

*Queue row 64 REMAP.*

Measured in [`lab/av1/bytes/remap`](../../lab/av1/bytes/remap/README.md); built in the lab only, since it changes the payload.
Where a series is 12-bit data plus rare levels above it (two of three projection systems: one saturated level,
0.6–11 % of samples; the CTs and the cone-beam: 0.0003–0.02 %), ingest would clamp the outliers to the 12-bit window
and store them in a per-frame map, then split the 12-bit plane at k = 2 as today:

```
header.flags  bit 2 `remap`: a map follows the frame's units
frame         := … as today … · u32le map length · map
map           := deflate( u32le runs · varint (gap, length)[runs] · u16le value[outliers] )   raster order
header.offset is the window's low end; a sample = plane + offset, then each outlier its value, then − the source offset
```

What it buys: the k = 2 split's bytes (within −0.1…+0.05 %; maps 1–10 KB a series) with every stream ≤ 10 bits, so
WebCodecs decodes it in 0.46–0.71 of the split's dav1d-WASM time — or w10's decoder at 1.5–12 % fewer bytes on four of
six series. What it costs: a flag, a map field and a pass over the frame in the reader (1.05–1.34× w10's time in the
lab, applied on the page, not fused into the merge). Coded as one 12-bit stream (k = 0) it loses to the split on
every series, by 2.6–13 % in bytes. The per-series palette of high parts (L = 0: histogram packing) is the same
shape with a table in the bundle's metadata instead of a map; on the one sparse 16-bit series it is worth as much to
HTJ2K as to AV1 (0.576 and 0.571 of HTJ2K on the source). The owner decides whether either is worth a format change.

## The split per depth

*Measured by queue row 44 SPLITTIME, adopted by queue row 72 SPLITRULE.*

Measured in [`lab/av1/delivery/split-rule`](../../lab/av1/delivery/split-rule/README.md) by total time against HTJ2K on eleven real
series (README §Total time, *The split per depth*); the grey rows of §Representation at ingest are its rule,
`ingest.py`'s `optimized_split`. What it changed against the k = 2 it replaced:

| b | k | top | decoder | against k = 2 |
| --- | --- | --- | --- | --- |
| ≤ 9 | 0 | the samples, 8 or 10 bits | WebCodecs | 0.93–1.01 of HTJ2K for k = 2's 1.03–1.07 |
| 10–12 | 2 | as before | WebCodecs | unchanged (k = 3 at 12 bits within 0.02) |
| 13 | 3 | 10 bits (w10) | WebCodecs | 0.91–0.98 on every cell; k = 2 is 1.66–1.68 at 4× on 50 Mbit |
| 14 | 2 | 12 bits | dav1d-WASM | unchanged; HTJ2K where a slow CPU meets ≥ 20 Mbit |
| 15–16 | — | serve HTJ2K | OpenJPH | every AV1 variant 1.02–3.11; refused by name, as before |

The format did not change: `split` and `depth` already carried every k (the split exactness check), and the reader decodes each
layout exactly (§Built; golden `optimized/g9` and `optimized/s13`).

## Is the split safe? (audit, 2026-10-30)

*Theory and audit; only cases 1 and 2 of §5 were run (2026-10-31), on the reader's merge and the writer's digest. The literature is [`split-prior-art.md`](split-prior-art.md);
G > 1 is [`frame-groups.md`](frame-groups.md) §2, §5.*

**Verdict.** G = 1: **safe with conditions** — the arithmetic is exact for every in-range sample, each frame is shown
exact at ingest, and the client checks every frame; one container defect (P4, now fixed) was outside both checks. G > 1: **not
shown** — dav1d-WASM fails every split group, and a 12-bit top has no other browser path.

**1 · The arithmetic** (*derived*). For integers 0 ≤ v < 2^b and 0 ≤ k, Euclidean division by 2^k gives
v = t·2^k + l with t = v ≫ k and 0 ≤ l = v & (2^k − 1) < 2^k. The low k bits of t·2^k are zero, so
`(t << k) | l` = t·2^k + l = v. Also 0 ≤ t < 2^(b−k): each part is a sample of its stream when b − k ≤ the top's depth
and k ≤ 8. The merge is the split's inverse iff each stream comes back unchanged and the output holds v − offset.

| precondition | enforced by |
| --- | --- |
| P1 v ≥ 0: offset = −min when min < 0 | `ingest/from-dicom/dicom_series.py:32`; b = bit length of max + offset, `ingest/coded-frames/ingest.py:47` |
| P2 b ≤ 16, k ≤ 8, b − k ≤ 12, depth the smallest of 8/10/12 holding it | writer `ingest.py:26-30, 58-66`; reader `client/decode/av1-payload.js:31-36` |
| P3 the header's offset is the one added | `ingest.py:211`, and the ingest gate (`:221`) |
| P4 the output type holds v − offset | `av1-frame.js:32` picks Int8/Uint8 for b ≤ 8, 16-bit above. *Was not enforced:* a signed source whose b ≤ 8 after the offset but whose values leave −128…127 (a 16-bit signed series spanning, say, −10…200) wrapped in Int8 (reproduced 2026-10-31). Now a signed 8-bit payload not centred on 0 (offset ≠ 128) is 9 bits, Int16, in the reader (`av1-frame.js`) and the digest (`ingest.py`'s `wide`) |
| P5 the stored value, not the 16-bit word: Bits Stored taken at High Bit, sign-extended | `dicom_series.py:95-99`. PS3.5 2026d §8.1.1: "High Bit (0028,0102) shall be one less than Bits Stored (0028,0101)"; the ingest checked only High Bit < Bits Allocated (`:84`), so High Bit < Bits Stored − 1 was not refused (reproduced 2026-10-31); it is now refused by name. High Bit > Bits Stored − 1, the retired layout the shift reads, is still taken |
| P6 padding values and MONOCHROME1 | nothing needed: a padding value is a sample within min…max, and MONOCHROME1's inversion is applied "after any VOI gray scale transformations" (PS3.3 2026d C.7.6.3.1.2), after the merge |
| P7 each stream returns its samples unchanged | §2 below, and the gate per frame |

P4 escaped both checks (reproduced 2026-10-31): the ingest gate compares in the source's type (`ingest.py:221`), the
frame digest is cast to the same 8 bits (`ingest.py:119`; NumPy 2.4.6 wraps there, 200 to −56, and does not raise),
and the client hashes bytes (`client/decode/decoder.js:25`), which are equal; the value read as Int8 is not. The
split exactness check's signed sets are all centred on 0 (`lab/av1/exact/split/make_sets.py:34`), so it never met
this case. It is not split-specific: k = 0 has it too.

**2 · The codec contract.** AV1 specification at `5e04f3f`
([github.com/AOMediaCodec/av1-spec](https://github.com/AOMediaCodec/av1-spec)):

* Lossless is per segment: `LosslessArray[segmentId] = qindex == 0 && DeltaQYDc == 0 && …` (§5.9.2); "It is a
  requirement of bitstream conformance that delta_q_present is equal to 0 when CodedLossless is equal to 1" (§6.8.2).
  CodedLossless turns off the loop filter and CDEF (§5.9.11, §5.9.19); AllLossless also needs FrameWidth =
  UpscaledWidth, and only it turns off loop restoration (§5.9.20): superres would not be lossless.
* Reconstruction clips: "Clip1( CurrFrame[ plane ][ y + yy ][ x + xx ] + Residual[ i ][ j ] )" (§7.12.3), and
  Clip1(x) = Clip3(0, 2^BitDepth − 1, x) (§4.7) — the identity on 0 … 2^BitDepth − 1. The spec binds the decoder, not
  the encoder: the source comes back only if the encoder wrote it so, which is why the ingest gate decodes each frame.
* "When film_grain_params_present is equal to 0, decoders shall produce output frames that are identical in all
  respects" (§7.2); with it 1, a decoder may instead produce grain that is only perceptually alike. Nothing in the
  ingest or reader reads the flag (*not found*); `encoder_args` asks for no grain (`ingest.py:123`), and grain would
  fail the gate and the per-frame check.
* Colour range is signalling: "this specification does not enforce the range when signaled as Studio swing"
  (§6.4.2), and output is the arrays "where the bit depth for each sample is BitDepth … further processing (such as
  color conversion) is outside the scope" (§7.18.1). Monochrome is allowed in profile 0 at 8 and 10 bits and profile 2
  at 12 (§6.4.1).

W3C WebCodecs, Editor's Draft 26 October 2026 ([w3c.github.io/webcodecs](https://w3c.github.io/webcodecs/)):
`copyTo`: "The format of the data is options.format, if it exists or this VideoFrame's format otherwise" (§9.4.5); RGB
conversion runs only when `format` names RGBA, RGBX, BGRA or BGRX. The client passes no `format`
(`client/decode/av1-webcodecs.js:136, 153, 169`), and I420P10 is "10 bits, encoded as a 16-bit integer" (§9.8). The
spec says nothing on whether the decoded resource equals the codec's output (*not found*: no "bit-exact"), and
`prefer-software` is a hint "User Agents may ignore … for any reason" (§7.9). Firefox converts to `BGRX` regardless
([`../decode/README.md`](../decode/README.md) §Why, and what would make it exact).

**3 · Others' evidence.** AOM's Argon streams claim "complete coverage of every equation in the core specification
… every extreme value in the pixel processing pipeline" ([aomedia.org](https://aomedia.org/av1-video-decoder-verification-tool/));
dav1d's README (1.5.4, §Decoder conformance tests) expects "2763 files successfully verified" on them. Whether those
include lossless 4:0:0 at 10 and 12 bits, and any published dav1d-WASM or browser run of them: *not found*. Encoders
do break lossless: SVT-AV1 #2260 "Lossless is broken" (v3.0.2, closed;
[gitlab.com](https://gitlab.com/AOMediaCodec/SVT-AV1/-/issues/2260)), and libaom with alt-ref at 10 and 12 bits here
(row 100). No published bit-exactness test of lossless AV1 at 10 or 12 bits, and no split study beyond
`split-prior-art.md` §1, was found.

**4 · What is verified, per path.** Rows and commits are [`queue.md`](queue.md)'s.

| | native dav1d | dav1d-WASM | WebCodecs | mixed |
| --- | --- | --- | --- | --- |
| G = 1 | every b 8–16, every k, both signs, synthetic, large and nine real series (row 43, `95b80dc`); every written frame by the gate | the same matrix in Node, Chromium, Firefox, WebKitGTK (row 43); nine series (row 37, `653f6d7`) | Chromium 141, every payload with streams ≤ 10 bits (row 43); Firefox refuses 4:0:0, WebKitGTK decodes no AV1: dav1d-WASM takes them; 12 bits refused | Chromium, Firefox, WebKitGTK (row 47, `f434b72`); off by default; the row-43 matrix not run through it |
| G > 1 | 159/159 libaom cells, alt-ref off, 8- and 10-bit tops, k = 2 (row 100, `cbbdf06`); 12-bit tops, other k: not run; alt-ref on not lossless | **fails every split group** (row 100), not fixed | 8- and 10-bit G = 8 streams (row 30, `5e693b6`), row 100's timed frames 5 760/5 760; 12 bits refused | not run; separate instances avoid the flush (*derived*), the dav1d-WASM fallback may not |
| every cell | P4's signed sources: the reader's merge in Node and the writer's digest only (§5, case 1); not through a codec or an engine | | | |

The per-frame check ([`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §2) covers a wrong
decoder, engine, grain or flush: the frame is decoded again or shown as failed, never as exact — but only where the
metadata carries digests (`decoder.js:10, 29-30`), and it could not see P4. So the real risk is that at G > 1 that a 12-bit
top's only browser path fails (an availability loss the check turns into failed frames, not wrong ones).

**5 · Protocol, for a separate session (cases 1 and 2 run 2026-10-31, the rest not).** Every frame against the SHA-256 of its source, compared as
numbers in the source's type, not as bytes.

1. *P4:* signed 16-bit sources spanning −10…200, 0…200, −200…0 and −128…127 (the control), k = 0 and 1, through every
   path. Prediction: the first three wrong, the control exact. *Run* on the reader's merge (`client/decode/av1.test.mjs`)
   and the digest (`ingest/coded-frames/merge_test.py`), not through a decoder: as predicted, then all four exact.
2. *P5:* a source with High Bit < Bits Stored − 1: the ingest must refuse it by name. *Run*: it was not; it is now
   (`ingest/from-dicom/from_dicom_test.py`).
3. *Mixed:* row 43's synthetic and real matrix through `mixed` in the three engines.
4. *G > 1:* row 100's DBT payloads at G ∈ {2, 8, 16}, plus the 14-bit projections at k = 2 (12-bit tops), through
   native dav1d, dav1d-WASM (one instance a stream), WebCodecs (≤ 10 bits) and mixed.

Mutations, each to be caught: the output typed 8-bit for a 9-bit source; the signed mask dropped; top and low swapped;
one dav1d-WASM instance shared by both streams at G > 1; a group's frames reordered; one sample of a frame's digest
flipped; a unit with film grain parameters. **Rule:** G = 1 is safe once case 1 is fixed (typed by the
source's range, 2026-10-31) and cases 1–3 are exact with every mutation caught. A path is a candidate at G > 1 only if every frame of case
4 is exact on it at every G and every mutation is caught; a failing path is refused for groups.

## 8-bit grey as 4:2:0, not adopted

*Queue row 80 GREY420.*

Measured in [`lab/av1/delivery/grey-420`](../../lab/av1/delivery/grey-420/README.md) on the two 8-bit grey series. Coded as full-range
4:2:0 with every chroma sample mid-grey (`ingest.py --grey8 420`), 8-bit grey is exact through Firefox's
WebCodecs, which refuses 4:0:0 (the cross-engine exactness study, queue row XENGINE). The header does not change: the stream's own sequence header says
4:2:0, and every reader path takes it as grey only when it is, so a series coded either way decodes everywhere.

| | Chromium | Firefox |
| --- | --- | --- |
| bytes | +0.20–0.23 % (≈ 100–140 B a frame) | the same |
| a frame's decode | WebCodecs either way: 1.06–1.11× | dav1d-WASM → WebCodecs: 0.63–0.66× at 4×, 1.03–1.04× at 1× |
| a whole fill | +0.2–0.5 % where the wire is the clock; +3.4 % on the cine at 4× on LTE and 50 Mbit | 0.74–0.87 at 4× on LTE and 50 Mbit; ±3 % elsewhere |

**Not adopted**: Chromium's total time is not unchanged — it is slower by the bytes on every cell and by 3.4 % where
its decode is the clock — and the round's rule takes 4:2:0 only if it is. The ingest keeps 4:0:0; the readers keep
taking 4:2:0 grey (`g8f` probe), so serving it is an ingest flag, should Firefox on slow devices outweigh that cost
([`README.md`](README.md) §Open questions).

## For the PCS team: coding AV1 for this PACS

*2026-10-27. Nothing here was measured for this note. What the PCS sends is quoted from `docs/adr/pcs-transfer.md`
(#149, `a197b23d`) and `docs/ingest/pacs-receive-design.md` (#168, `f8b0bb2a`), not yet on this branch, and claimed no
further.*

**Code every frame alone (G = 1): one shown key frame with its sequence header per frame, libaom 3.15.1 lossless, in
the representation of §Representation at ingest and the split of §The split per depth.** Why, per content type, and
what would reopen G > 1: [`frame-groups.md`](frame-groups.md) §1 and §5. HTJ2K serves every series today
([`../codecs/README.md`](../codecs/README.md) §Which series AV1 is for).

* **Encoder**, as `ingest/coded-frames/ingest.py` `encoder_args` builds it, one frame a run (`--limit=1`), the preset
  by content of [`../FIXTURES.md`](../FIXTURES.md) §From DICOM:

  ```
  aomenc --ivf --lossless=1 --bit-depth=B --input-bit-depth=B --kf-max-dist=0 --threads=1 --profile=P \
         --tune-content=screen --sb-size=64 --monochrome  <preset>
  ```

  `--profile` 0 for grey at 8 or 10 bits, 2 at 12, 1 for the RGB stream, which takes colour flags in place of
  `--monochrome`. Wherever inter is ever tried, `--auto-alt-ref=0` ([`frame-groups.md`](frame-groups.md) §2). SVT-AV1
  v4.2.0 has no 4:0:0 and rav1e 0.7.1 no lossless mode ([`README.md`](README.md) §Exactness and the decoders).
* **The one check** is §Exact at ingest: every frame decoded alone by native dav1d and matched to the encoder's input,
  nothing written for a series with a frame that fails. Every frame exact alone shows lossless and G = 1 together.
* **What the PACS reads.** #168 §1: "the PACS receives our `.sbnd` (the role MXF/MP4/JXL play in the PDF); no MXF/MP4
  reading in the server". #149 §9: "the formatted pixels end in an `.sbnd` (§1), not `sf.jxl`, `mf.mxf` or `mf.mp4`".
  A frame is one entry of its frame table, one payload of §Payload with n = 1 ([`../FIXTURES.md`](../FIXTURES.md)
  §SBND series bundle). When an MP4's samples remux to payloads: [`frame-groups.md`](frame-groups.md) §5d.
* **What the PACS checks.** #168 §3, step 6b: "every frame's coded XXH3 against the .sbnd index; the PACS never decodes
  (decoded-sample hashes are the client's)"; #168 §15: "Not needed from you: a decoded-samples hash per frame". The
  samples are checked at encode (above) and by the client against each frame's sample digest
  ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests), made by "the ingest at the PCS" (#149 §6).

Series the PCS could share are the owner's call ([`queue.md`](queue.md) §Blocked); the protocol they would run is
[`gop-protocol.md`](gop-protocol.md).
