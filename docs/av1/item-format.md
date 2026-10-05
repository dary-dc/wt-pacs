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

* `bits` — the source sample depth the decoder reports (e.g. 12 for a 12-bit MR, 13 for CT after offset, 8 for RGB).
* `depth` — bits of the deepest coded stream (8, 10 or 12). Picks the decoder before anything is decoded.
* `split` — low bits coded apart: 0, 1 or 2 (1 only in the plain representation, below).
* `flags` — bit 0 `signed` (source samples signed; `offset` was added at ingest); bit 1 `rct` (RGB coded through
  JPEG 2000's reversible colour transform). Other bits must be 0; a reader refuses unknown bits. RGB without `rct`
  is planes G, B, R, 8-bit 4:4:4 (the plain representation).
* `offset` — added at ingest so every sample is ≥ 0; the decoder subtracts it.
* Sample = `((top << split) | low) − offset` for grey; R, G, B from planes G, B, R for RGB without `rct`.
* Grey 8-bit and plain RGB share a header (bits 8, depth 8, split 0, flags 0); the decoded stream's plane count
  tells them apart (a client may read the unit's AV1 `seq_profile` first: profile 1 is always 4:4:4).
* A reader refuses: version ≠ 1, unknown flag bits, a decoded stream whose depth ≠ `depth` (top) or ≠ 8 (low),
  `n` ≠ the count expected, lengths that overrun the item, `split` ∉ {0, 1, 2}, `rct` with `split` > 0, a top
  stream not of three planes under `rct`, or of three planes without it unless bits 8, depth 8, split 0, unsigned;
  without `rct`, `bits` > `depth + split`, or `bits` ≤ 8 with `depth + split` > 8; a non-zero `offset` without
  `signed`. *Built, and also refused:* an item under 16 bytes, a pad byte not 0, a `depth` other than 8, 10
  or 12, and bytes past the last frame.
* HTJ2K items stay bare codestreams (the bundle's codec field says which).

## Representation at ingest (lab row 28 LLSIZE, `lab/av1/llsize/` in the public lab)

| source | coded as | header |
| --- | --- | --- |
| grey ≤ 8 bits | one 8-bit 4:0:0 stream | split 0, depth 8 |
| grey 9–14 bits (after any offset) | top = v ≫ 2, 4:0:0 at the smallest of 8/10/12 that holds bits − 2; low = v & 3, 8-bit 4:0:0 | split 2, depth = top's coded depth |
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
([`lab/av1/item`](../../lab/av1/item/README.md) §Checked).

