# Disk layout: the target (draft)

**Draft**, agreed with the owner 2026-10-12; it stays a draft until the standard containers are characterized and
measured against it (queue rows 159–160). Nothing here is built. Today's layout is [`README.md`](README.md).
*Corrected 2026-10-26* against [`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) §1–§4: scope
starts at the PACS, which receives each `.sbnd` in a submission package from the PCS; the metadata rule is restated
below; group files are named by XXH3.

```text
 <Study>/<Series>.sbnd

 offset 0                                        148            148 + E·N
 ┌──────────────────────────────────────────────┬──────────────┬─────────┬─────────┬─────┐
 │ header 148 B                                 │ index E × N  │ entry 0 │ entry 1 │  …  │
 │ "SBND" · 2 · codec · layout · N · Study UID  │              │         │         │     │
 │ · Series UID                                 │              │         │         │     │
 └──────────────────────────────────────────────┴──────────────┴─────────┴─────────┴─────┘
   the file says what it is                        E = 28 B (layout 0) or 36 B (layout 1); no metadata in the file
```

## What changes from today, and why

| Today | Target | Why |
| --- | --- | --- |
| any path, one per server process | `<Study>/<Series>.sbnd`, each the UID as the PCS codes it ([`../ingest/contract.md`](../ingest/contract.md) §The layout) | a server finds a series by its UIDs ([`../adr/serving-by-uid.md`](../adr/serving-by-uid.md), proposed); where `<Study>/` sits is open (§Open) |
| metadata JSON in the file and in a sidecar; the server reads neither | **none in the file; the study DB is the one source of metadata.** A file beside the `.sbnd` may hold metadata only if it is derived from the study DB and can be regenerated from it (*restated 2026-10-26*: this row said "none in or beside the file", which read as forbidding derived files) | one source, where it is queried and updated; a derived copy is a cache, never read back |
| group files named by the parser's BLAKE3-256 | named by the **XXH3** of their bytes, by the PCS (decided 2026-10-24/25); the study DB keeps each group as a row with that hash, keyed by UID (proposed) | the PACS checks them for integrity, not against an adversary: no cryptographic need, and faster |
| header 16 B, nothing about what the file holds | 148 B: codec, layout and both UIDs | the file says what it is |
| entry 12 B, no hash | 28 B: both hashes per frame | the coded bytes can be checked for life; the samples hash travels with its frame |
| written in place, flushed, never synced | `.partial` → `fsync` → `rename` → `fsync` of the directory | a name only ever holds a complete, durable file |

## The header, 148 B

All integers little-endian.

| Field | Size | Value |
| --- | ---: | --- |
| magic | 4 B | `"SBND"` |
| version | u32 | `2`; a version the reader does not know is refused |
| codec | 4 B ASCII | `"HTJ2"` or `"AV01"` |
| layout | u32 | `0` sequential, `1` tiled |
| entry count | u32 | N |
| Study Instance UID | 64 B | ASCII, NUL-padded (a DICOM UID is at most 64 characters, PS3.5 §9.1) |
| Series Instance UID | 64 B | the same |

## Layout 0, sequential — the one to build

Entry **28 B**, one per frame, in display order:

| Field | Size |
| --- | ---: |
| offset | u64 |
| length | u32 |
| XXH3-64 of the coded bytes | 8 B |
| XXH3-64 of the samples | 8 B |

The frame number is the entry's position, as today. Frames follow the index back to back in display order, so the
fill's read-ahead keeps working unchanged ([`README.md`](README.md) §The reader).

## Layout 1, tiled — later, its own format

*Row 175, TILESTORE, 2026-10-13: a proposal, nothing built. It specifies what row 143 left open
([`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §8, the owner's rule
for large frames) on row 133's measurement ([`../decode/README.md`](../decode/README.md) §Not yet tried, P-TILE).
Each choice's recommendation and reason are in the ADR's §8.8.*

**Which series.** Layout 1 is for a series under the owner's rule: over 12 bits, not a volume or a 3D view, codec
`HTJ2`, frames of at least 1 MP. Every other series is layout 0, unchanged. A layout-1 series stores each frame as
**T tiles × B bands**:

* **Tiles: T = 3 horizontal strips** (k = 3, measured), each its own HTJ2K codestream in the served profile (RPCL, one
  layer, five decompositions). A strip's height is ⌈H ÷ 3 ÷ 32⌉ × 32 rows, and the last strip takes the rest. A
  height that is a multiple of 2^5 starts every strip on a row of every level's grid, so the level-L strips stack
  into a ⌈H ÷ 2^L⌉-row picture with no seam row.
* **Bands: B = 3, levels 2, 1 and 0.** Band 0 is each tile's exact prefix through level 2. Band 1 adds level 1's
  increment and band 2 the rest, so bands 0..b together are the tile's level 2 − b picture. Measured on breast frames,
  whole: level 2 is 7.0–7.5 % of the bytes and level 1 25.8–29.0 % (§A frame at the level the screen needs there).
  So the bands are ~7 %, ~20 % and ~72 % (D). Level 2 serves the first exact picture, level 1 a phone's device
  pixels (ADR §8.2), and level 0 everything else.

**Entries are band-major, and the index is arithmetic.** Entry *e* holds band *b*, frame *f*, tile *t*, with

```text
e = b · N · T + f · T + t        N frames, T tiles, B bands; N · T · B entries
```

and its bytes follow the index in entry order. Every frame's band 0 comes first, then every band 1, then every band 2.
A fitted fill at level L is one contiguous run of entries, and the fill's read-ahead
([`README.md`](README.md) §The reader) keeps working unchanged.

The gain of grouping what is read together is conditional. On a 4 GB series whose access cycle the cache cannot
hold, it cost 6 014 ns of CPU per read at 0.5 % misses, against 105 563 ns at 99.6 % for the strided layout: 17.6×.
With a cache that holds the cycle, the strided layout cost 3 976 ns at 0.0 %, and the layout was worth 1.50× (the
2026-09-06 study, `git show b55b68db:docs/disk-layout/ACCESS-PATTERNS.md`, removed from the tree in `2a14c47a`).

| Field | Size | Value |
| --- | ---: | --- |
| offset, length | u64 · u32 | as layout 0 |
| XXH3-64 of the coded bytes | 8 B | this entry's bytes |
| XXH3-64 of the samples | 8 B | tile *t*'s level 2 − *b* picture, decoded from bands 0..*b*, as `decodeFrame` hands it on |
| frame · tile · band | u32 · u16 · u8 | redundant with *e*: a reader checks them against the formula at open and refuses the file if any differs |
| spare | u8 | 0 |

Entry **36 B**, as the draft set it. The header is unchanged: `layout = 1`, and the entry count is N · T · B. T and B are
the fixed values above, so the header carries no new field. A version that changes them is a new `version`.

**The samples hash of a level picture is per tile, from the encoder's input.** It is the tile's own 5/3 analysis to
level L, then the clamp to 2^bits − 1 (`ll.py`, ADR §7). Near a strip's edge that picture is not the untiled
frame's level picture, because each tile's wavelet extends symmetrically at its own edge. So its truth is the tiled
analysis, never the whole frame's digest, and never a decoder's output. The three level-0 tiles together are the frame
exactly: their samples, stacked, hash to the frame's digest of today ([`../FIXTURES.md`](../FIXTURES.md) §Frame
digests), which the packer checks before it publishes.

**The wire is unchanged.** Entries are asked as frames are today ([`../WIRE.md`](../WIRE.md) §FoD messages), and the
client turns *e* back into (*b*, *f*, *t*) by the formula:

* **a fitted fill at level L** is `stream_frames {from: 0, to: (3 − L) · N · T − 1}`;
* **an ask** for frame *f* at level L is its (3 − L) · T entries, `request_frame` each (6 at level 1);
* **a zoom past the fitted view** asks the finer bands of the tiles in view.

As today, an ask ends a running fill, and the downloader re-asks what is left.

**The client** places tile *t* at row *t* · ⌈H ÷ 3 ÷ 32⌉ × 32 ÷ 2^L of the level-L picture. It decodes each tile on
its own idle decoder (ADR §8.5), and it checks each picture against its entry's samples hash. A client that does not
know layout 1 refuses the series before the dial, as it does an unknown codec.

**Migration.** A stored series under the rule is re-encoded, not cut: a tile cannot be cut out of today's whole-frame
codestream.
1. The packer decodes each frame and checks the samples against the frame's digest from the encoder's input. A frame
   that does not match stops the series.
2. It encodes the three tiles and cuts their bands.
3. It publishes a layout-1 file next to the old one, by the steps of §Packing and publishing below.

The old file goes once the study DB names the new one. A series not under the rule is not touched by this
migration; its move from today's version 1 to layout 0 is the target's own.

## The two hashes

* **The coded hash is kept for life:** checked when the file is received, by a scrub, and optionally on read. It is
  what today's layout lacks ([`README.md`](README.md) §The writer).
* **The samples hash is the client's exactness check:** today's per-frame `digests`
  ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests), moved from the metadata into the entry.

## Packing and publishing

Packed by the PCS, which sends it to the PACS inside a submission package (the PCS's side, out of this repository's
scope since 2026-10-24). The PACS publishes it by staging `<Series>.sbnd` on the root's filesystem, `fsync` of the
file, reading it back from disk against its coded hashes, `rename` into `<Study>/`, `fsync` of the directory
([`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) §3, steps 6–6c, proposed). A reader never
opens a staged file.

## Open

* **Streaming the pack** while frames are still coded: the index needs every length first (queue row 163).
* **Standard containers** in place of the `.sbnd` (rows 159–160).
* **When a series is complete**, and what a late instance does ([`../ingest/design.md`](../ingest/design.md)).
* **Where `<Study>/` sits under the root** (flat, a date folder, a hashed level): the options and a recommendation
  in [`../adr/pacs-disk-layout.md`](../adr/pacs-disk-layout.md), for the meeting with the PCS team.
