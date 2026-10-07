# The AV1 item: format and representations

The unit one stored entry, one ask and one media message carry when the codec is AV1. Settled from rows 6, 7, 14 and
28 and adopted by the owner on 2026-10-04 as the shape both the lab and the product use. Two representations: **plain**
(lossless AV1 as it codes out of the box — the control set against HTJ2K) and **optimized** (rows 7 and 28: the two
low bits apart, JPEG 2000's reversible colour transform), so the representation work is measured against the control.

Today G = 1: one frame per item (n = 1). The format still carries n so G > 1 needs no format change.

## Item

```
item   := header(16) · len[n] · frame[n]
header := version u8 = 1 · bits u8 · depth u8 · split u8 · flags u8 · pad u8[3] = 0 · offset u32le · n u32le
len    := u32le                                   byte length of frame j
frame  := one temporal unit                       when split = 0
        | u32le top length · top unit · low unit  when split > 0
```

* `bits` — the source sample depth the decoder reports (e.g. 12 for a 12-bit MR, 13 for CT after offset, 8 for RGB),
  at most 16.
* `depth` — bits of the deepest coded stream (8, 10 or 12). Picks the decoder before anything is decoded.
* `split` — low bits coded apart, k = 0 to 8 (the low stream is 8-bit). Ingest emits 0, 1 or 2 by default (1 only in
  the plain representation, below); `--split K` writes any k of row 43's matrix, below.
* `flags` — bit 0 `signed` (source samples signed; `offset` was added at ingest); bit 1 `rct` (RGB coded through
  JPEG 2000's reversible colour transform). Other bits must be 0; a reader refuses unknown bits. RGB without `rct`
  is planes G, B, R, 8-bit 4:4:4 (the plain representation).
* `offset` — added at ingest so every sample is ≥ 0; the decoder subtracts it.
* Sample = `((top << split) | low) − offset` for grey; R, G, B from planes G, B, R for RGB without `rct`.
* Grey 8-bit and plain RGB share a header (bits 8, depth 8, split 0, flags 0); the decoded stream's plane count
  tells them apart (a client may read the unit's AV1 `seq_profile` first: profile 1 is always 4:4:4).
* A reader refuses: version ≠ 1, unknown flag bits, a decoded stream whose depth ≠ `depth` (top) or ≠ 8 (low),
  `n` ≠ the count expected, lengths that overrun the item, `split` over 8 (*was* ∉ {0, 1, 2} *until row 43*),
  `bits` over 16, `rct` with `split` > 0, a top stream not of three planes under `rct`, or of three planes without it
  unless bits 8, depth 8, split 0, unsigned; without `rct`, `bits` > `depth + split`, or a `depth` other than the
  smallest of 8, 10, 12 holding the top's `bits − split` (*was* `bits` ≤ 8 with `depth + split` > 8 *until row 43*,
  which refused every split 8-bit source); a non-zero `offset` without `signed`. *Built, and also refused:* an item under 16 bytes, a pad byte not 0, a `depth` other than 8, 10
  or 12, and bytes past the last frame.
* HTJ2K items stay bare codestreams (the bundle's codec field says which).

## Representation at ingest (lab row 28 LLSIZE, `lab/av1/llsize/` in the public lab)

| source | coded as | header |
| --- | --- | --- |
| grey ≤ 8 bits | one 8-bit 4:0:0 stream | split 0, depth 8 |
| grey 9 bits (after any offset) | the samples, one 10-bit 4:0:0 stream | split 0, depth 10 |
| grey 10–12 and 14 bits | top = v ≫ 2, 4:0:0 at the smallest of 8/10/12 that holds bits − 2; low = v & 3, 8-bit 4:0:0 | split 2, depth = top's coded depth |
| grey 13 bits | top = v ≫ 3 at 10 bits; low = v & 7, 8-bit 4:0:0 | split 3, depth 10 |
| grey 15–16 bits | refused: served as HTJ2K (row SPLITTIME: every AV1 layout 1.02–3.11 of its fill) | — |
| RGB 8-bit | RCT: Y = ⌊(R + 2G + B)/4⌋, Cb = B − G + 256, Cr = R − G + 256; one 10-bit 4:4:4 stream, identity matrix, plane order exactly as the lab's `llsize.py` writes it | flags.rct, split 0, depth 10, bits 8 |
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
RGB (AV1's RGB signal: with the identity matrix alone WebCodecs reports a BT.709 matrix and no colour item passes its probe) (Y4M `420`/`420p10`/`420p12` with
neutral chroma, as the lab does); preset: the fastest within 2 % of cpu0's bytes per content (row 14); RGB ultrasound at cpu0; IVF split into one temporal unit per frame (strip each IVF frame's 12-byte header). Frames parallel across
processes.

**Exact at ingest, or nothing written:** native dav1d decodes every item and the reconstructed samples must equal
the source plane (the same plane the tag's `exactness` hash covers) before the bundle is written; a mismatch names
the frame.

## Decoder choice, per item

* **WebCodecs** (`hardwareAcceleration: 'prefer-software'`, `optimizeForLatency: true`, `copyTo`) when every
  stream of the item is ≤ 10 bits, `VideoDecoder` exists, and a per-worker, per-layout probe (one tiny bundled unit,
  checksum checked) passes.
* **The codec string is the stream's own** (row 67 CODECSTR): each keyframe's sequence header gives the AV1 codecs
  parameter string (AV1-ISOBMFF §5) with every optional field — `av01.P.LLT.DD.M.CCC.cp.tc.mc.F`, the level and tier
  of operating point 0 as coded, 31 included — and the decoder is reconfigured only when the string changes. Chromium
  reports the string's colour on the frame, not the stream's, so whether a 4:4:4 stream is identity (matrix 0) is
  read from the sequence header, as for dav1d-WASM. Which engines accept which strings:
  [`lab/av1/codecstr`](../../lab/av1/codecstr/README.md).
* **dav1d-WASM** (dav1d 1.5.4, emscripten 3.1.74, SIMD build) otherwise — 12-bit top streams, no `VideoDecoder`,
  or a failed probe.
* Both lazy-imported on the first AV1 item of a worker, memoised; an HTJ2K page fetches no AV1 code.

## Built (row 39, branch `claude/av1-unified`)

The writer is [`lab/av1/item/ingest.py`](../../lab/av1/item/README.md), `pack-study` bundles its items when the metadata
says `"codec": "av1"`, and the reader is `client/downloader/av1.js` with `av1-item.js` (the header and its refusals) and
`av1-frame.js` (the merge) — [`client/downloader/README.md`](../../client/downloader/README.md) §An AV1 series. The
per-layout probes are 16×16 units (grey 8/10, 4:4:4 8/10) in `av1-probe.js`, checked by an FNV-1a of their planes. On
the first 8 frames of the fluoroscopy, CT, MR and ultrasound series, both representations, all 96 items were written and
decoded by the reader to their sources; optimized over plain matches row 28 to the third digit
([`lab/av1/item`](../../lab/av1/item/README.md) §Checked). The lab harnesses of rows 9–38 that hand the client bare temporal units, or import the decoder modules
(`lab/av1/{speed,fill,total,decspeed,wcbase,xbrowser,footprint,rep14}`), are not ported: on this branch they would
need their frames written as items; their readings stand as measured on `claude/av1`.

**Widened (row 43 SPLITOK, [`lab/av1/splitok`](../../lab/av1/splitok/README.md)).** The writer (`ingest.py --split K`)
and the reader take grey of 8–16 bits after the offset, unsigned and signed, at any k ≤ 8 whose top fits a 12-bit
stream; the defaults above are unchanged until row 44. Checked exact at every b = 8…16 and every k = max(0, b − 12) …
max(b − 8, 4), natively, in Node and in Chromium, Firefox and WebKitGTK, synthetic to 4096×5120 and real, and the old and new
refusals matched by message. The reader's signed mask is now the output container's (0xFF, 0xFFFF): the old
2^(depth + split) − 1 reports a wrong range for signed 8-bit with a split and for signed 16-bit at k = 5 and 7.
**New limits:** `bits` ≤ 16, `split` ≤ 8, a top of at most 12 bits; an item's `depth` is the smallest of 8, 10, 12
holding its top.

## Proposed: a remapped plane (row 64 REMAP, not built)

Measured in [`lab/av1/remap`](../../lab/av1/remap/README.md); built in the lab only, since it changes the item.
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

## The split per depth (row 44 SPLITTIME, adopted by row 72)

Measured in [`lab/av1/splittime`](../../lab/av1/splittime/README.md) by total time against HTJ2K on eleven real
series (README §Total time, *The split per depth*); the grey rows of §Representation at ingest are its rule,
`ingest.py`'s `optimized_split`. What it changed against the k = 2 it replaced:

| b | k | top | decoder | against k = 2 |
| --- | --- | --- | --- | --- |
| ≤ 9 | 0 | the samples, 8 or 10 bits | WebCodecs | 0.93–1.01 of HTJ2K for k = 2's 1.03–1.07 |
| 10–12 | 2 | as before | WebCodecs | unchanged (k = 3 at 12 bits within 0.02) |
| 13 | 3 | 10 bits (w10) | WebCodecs | 0.91–0.98 on every cell; k = 2 is 1.66–1.68 at 4× on 50 Mbit |
| 14 | 2 | 12 bits | dav1d-WASM | unchanged; HTJ2K where a slow CPU meets ≥ 20 Mbit |
| 15–16 | — | serve HTJ2K | OpenJPH | every AV1 arm 1.02–3.11; refused by name, as before |

The format did not change: `split` and `depth` already carried every k (row 43), and the reader decodes each
layout exactly (§Built; golden `optimized/g9` and `optimized/s13`).
