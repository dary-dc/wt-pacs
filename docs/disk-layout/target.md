# Disk layout: the target (draft)

**Draft**, agreed with the owner 2026-10-12; it stays a draft until the standard containers are characterized and
measured against it (queue rows 159–160). Nothing here is built. Today's layout is [`README.md`](README.md).

```text
 <StudyUID>/<SeriesUID>.sbnd

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
| any path, one per server process | `<StudyUID>/<SeriesUID>.sbnd` | a server finds a series by its UIDs |
| metadata JSON in the file and in a sidecar; the server reads neither | **none in or beside the file**: metadata only in the per-study database (Turso) | one copy, where it is queried |
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

Entry **36 B**: layout 0's 28 B, then frame u32 · tile u16 · band u8 · spare u8. Entries and their bytes are stored
**band-major**, so a screen-fitted read is one contiguous range. The gain is conditional: on a 4 GB series whose access cycle the cache cannot hold, grouping what is read
together cost 6 014 ns of CPU per read at 0.5 % misses against 105 563 ns at 99.6 % for the strided layout, 17.6×;
with a cache that holds the cycle the strided layout cost 3 976 ns at 0.0 %, and the layout was worth 1.50× (the
2026-09-06 study, `git show b55b68db:docs/disk-layout/ACCESS-PATTERNS.md`, removed from the tree in `2a14c47a`).

## The two hashes

* **The coded hash is kept for life:** checked when the file is received, by a scrub, and optionally on read. It is
  what today's layout lacks ([`README.md`](README.md) §The writer).
* **The samples hash is the client's exactness check:** today's per-frame `digests`
  ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests), moved from the metadata into the entry.

## Packing and publishing

Packed at the hospital. Published at both ends — the site that packs and the PACS that receives — by writing
`<SeriesUID>.sbnd.partial`, `fsync` of the file, `rename` to `<SeriesUID>.sbnd`, `fsync` of the directory. A reader
never opens a `.partial`.

## Open

* **Streaming the pack** while frames are still coded: the index needs every length first (queue row 163).
* **Standard containers** in place of the `.sbnd` (rows 159–160).
* **When a series is complete**, and what a late instance does ([`../ingest/design.md`](../ingest/design.md)).
