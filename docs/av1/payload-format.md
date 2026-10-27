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
refusals matched by message. The reader's signed mask is now the output container's (0xFF, 0xFFFF): the old
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

*2026-10-27. Nothing here was measured for this note; each claim points to where it was measured or decided. What the
PCS sends is quoted from `docs/adr/pcs-transfer.md` (#149, `a197b23d`) and `docs/ingest/pacs-receive-design.md`
(#168, `f8b0bb2a`), not yet on this branch, and claimed no further.*

**Code every frame alone: G = 1, one shown key frame with its sequence header per frame, libaom 3.15.1 lossless, the
representation of §Representation at ingest.** No content type has evidence for G > 1; on DBT slices that is a
conclusion by a rule fixed before the data, elsewhere a default ([`frame-groups.md`](frame-groups.md) §1). AV1 is
coded on request beside HTJ2K, which every series is served as today ([`../codecs/README.md`](../codecs/README.md)
§Which series AV1 is for).

* **Proof chain.** Groups gain at most +1.51 % on 15 sound DBT volumes against the 20 % the rule needs, and miss the
  decode bound by 4.6–24.6× ([`frame-groups.md`](frame-groups.md) §3); the mechanism is noise that adjacent frames do
  not share, ρ 0.11–0.22 against the ½ inter needs (§4); one all-key stream and per-frame streams are the same bytes
  at G = 1 (§5d, *derived*); libaom with alt-ref off is exact in 159 of 159 cells, SVT-AV1's inter not on a 10-bit
  top (§2, §3).
* **The one check.** Decode every frame alone, from its own bytes, with native dav1d 1.5.4, and match its samples to
  the encoder's input. Every frame exact alone shows lossless and G = 1 together. It is §Exact at ingest above, which
  writes nothing for a series with a frame that fails, and names the frame.

### G = 1, per target type ([`frame-groups.md`](frame-groups.md) §1)

| type | why G = 1 |
| --- | --- |
| DBT reconstructed slices | conclusive: best gain +1.51 % on 15 volumes of three systems, against 20 %; every G > 1 over the decode bound. Adjacent slices share little noise (frame-groups §4 point 5) |
| DBT projections | default, outside the measured scope: two series, +0.29 % and −0.2 to −1.0 % (row 21) |
| breast ultrasound cine | default, untested: no native, losslessly stored, licensed cine is open. Predicted to gain (frame-groups §4 point 8), so it is the type most worth data |
| ABUS | default, untested: no open ABUS volume in DICOM |
| angiography and fluoroscopy | default, untested: independent quantum noise per exposure predicts under 5 % (frame-groups §4 point 10) |
| FFDM, synthesized 2D, ultrasound stills | one frame an image: nothing to predict from. MR and CT stay HTJ2K |

### Encoder

libaom 3.15.1 (`44d0a57`), the line in §Representation at ingest and `ingest/coded-frames/ingest.py`
`encoder_args`:

```
aomenc --ivf --lossless=1 --bit-depth=B --input-bit-depth=B --kf-max-dist=0 --threads=1 --profile=P \
       --tune-content=screen --sb-size=64 --monochrome  <preset>
```

`--monochrome` is for grey; the RGB stream takes the colour flags of §Representation at ingest instead.

* `--lossless=1` is quantiser index 0 with no delta-q, AV1's only lossless mode ([`frame-groups.md`](frame-groups.md) §2).
* `--kf-max-dist=0`: every frame a key frame. `--profile` is 0 for grey at 8 or 10 bits, 2 at 12 (monochrome is not
  allowed in profile 1, [`series.md`](series.md)), 1 for the RGB stream.
* **Preset** ([`../FIXTURES.md`](../FIXTURES.md) §From DICOM): `--cpu-used=6` (good) for MR, mammography and
  tomosynthesis; `--allintra --cpu-used=6` for CT; `--allintra --cpu-used=7` for fluoroscopy and angiography;
  `--cpu-used=0` otherwise.
* **Alt-ref.** None at G = 1. Wherever inter is ever used, `--auto-alt-ref=0` and `--kf-min-dist=G --kf-max-dist=G`:
  with alt-ref on, libaom's inter is not lossless at 10 and 12 bits ([`frame-groups.md`](frame-groups.md) §2).
* Ingest encodes each frame in its own run (`--limit=1`). One run over a series with `--kf-max-dist=0` should give
  the same units (frame-groups §5d, *derived*); not checked, so the one check above decides.

### The top/low split, by b, the bits after subtracting the series minimum

§The split per depth: b ≤ 9, k = 0 (one stream); b = 10–12, k = 2; b = 13, k = 3; b = 14, k = 2 (a 12-bit top);
b = 15–16, not AV1, send HTJ2K. RGB 8-bit goes through the RCT as one 10-bit 4:4:4 stream. The top is v ≫ k, the low
v & (2^k − 1), each its own 8-, 10- or 12-bit stream coded as above.

### Grey as 4:0:0, per encoder

* **libaom**: `--monochrome`, the shipped form.
* **SVT-AV1 v4.2.0**: no 4:0:0; grey only as 4:2:0 at mid-grey chroma, and its inter exact at 8 bits only
  ([`frame-groups.md`](frame-groups.md) §2). Readers take 4:2:0 grey (§8-bit grey as 4:2:0), but it is not adopted.
* **rav1e 0.7.1**: no lossless mode ([`frame-groups.md`](frame-groups.md) §5a).

### What the PACS reads, and what an MP4 must hold

The PACS reads no MP4. #168 §1: "the PACS receives our `.sbnd` (the role MXF/MP4/JXL play in the PDF); no MXF/MP4
reading in the server, the PACS does no repacking". #149 §9: "the formatted pixels end in an `.sbnd` (§1), not
`sf.jxl`, `mf.mxf` or `mf.mp4`". What the PACS addresses is the `.sbnd`'s frame table, one (offset, length) a frame,
each entry one payload of §Payload with n = 1 ([`../FIXTURES.md`](../FIXTURES.md) §SBND series bundle).

If the PCS keeps `mf.mp4`, its samples become payloads by a remux, not a re-encode, only if
([`frame-groups.md`](frame-groups.md) §5d; [`../disk-layout/containers.md`](../disk-layout/containers.md) §3.1, §6):

* **every sample a sync sample**: a shown key frame after a sequence header in the same sample, so `stss` is omitted;
* **one temporal unit a sample**, sample i the series' frame i, its length in `stsz` and its offset through
  `stsc` and `stco`/`co64`; progressive, not fragmented;
* **no edit list** (*inferred*, no record covers it): sample i must be frame i as the tables give it;
* **at k > 0, two tracks**, top and low, which no player combines; the header's `bits`, `split`, `flags` and
  `offset` have no field in MP4 and must reach the payload another way. Who remuxes is not recorded.

### What the PACS checks on receipt

#168 §3, step 6b: "every frame's coded XXH3 against the .sbnd index; the PACS never decodes (decoded-sample hashes are
the client's)". Exactness of samples is proven twice elsewhere: at encode, by the one check above, and in the client,
against each frame's sample digest ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests), which #149 §6 lists as made
by "the ingest at the PCS". #168 §15 to the PCS team: "Not needed from you: a decoded-samples hash per frame (the
PACS checks coded hashes; the client checks samples)". Whether the PCS's own encoder or our ingest at the PCS writes
that digest is open.

### What would make us accept G > 1 ([`frame-groups.md`](frame-groups.md) §5, §3 *The rule*)

* **Data**, per untested type: ≥ 2 independent sources of ≥ 2 series each, native frames stored uncompressed or
  losslessly ((0028,2110) absent or `00`), whole, in acquisition order, under a licence that allows commercial use.
  For DBT: a sound series of a system not yet measured whose median ρ is over ½.
* **The result**, on every sound series, the best G ≤ 16 at the shipped preset, every frame exact: ≥ 20 % fewer bytes
  than G = 1, ≤ 0.80 of HTJ2K's bytes, and a mid-group ask inside the decode bound.
* **The client first**: dav1d-WASM fails every split group at G > 1 today (frame-groups §5 *The client*).

Series the PCS could share are the owner's call ([`queue.md`](queue.md) §Blocked); the protocol they would run is
[`gop-protocol.md`](gop-protocol.md).
