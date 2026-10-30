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

## A late instance: merging without the rewrite (decided: the rewrite)

*Proposed 2026-10-26; decided by the owner 2026-10-26 (§Decision below); corrected 2026-10-27 by a measurement.* **Decided by the owner, 2026-10-26:** a late instance (one
arriving after its series was sent) comes as an addition package and is merged at the PACS into the series' one
`.sbnd`; several files per series is refused. The question here is only whether a change of format lets that merge
avoid rewriting the file, without another trade-off that matters.

**The fixed points it must respect.** The receiver stages in `incoming/<f>.work/`, never the serving tree, reads the
staged file back from disk, and changes the serving tree by one `rename` (owner, 10-26;
`docs/ingest/pacs-receive-design.md` §3, `40fdbfd` on branch `claude/pacs-design-state`). A published
name is never written in place, and a new session tells a replaced file by `(st_dev, st_ino)`
(`docs/adr/serving-by-uid.md` §4, `51b4f9f` on branch `claude/serve-by-uid-impl`). An open session keeps the
version it opened (serving-by-uid §9 choice 7, the receive design's D10). The fill's read-ahead needs frames in display order on disk
([`README.md`](README.md) §The reader). The series digest is BLAKE3 over the entries' coded hashes in entry order
(serving-by-uid §2), so it depends on the index alone, never on where the bytes sit.

### The options

Notation: S the series' bytes, s the late frames' bytes, k late frames, N frames, E = 28 B an entry (layout 0).

* **(a) Today's layout, rewrite and rename.** The receiver merges old and new frames in display order into a staged
  file and publishes it by the steps of §Packing and publishing. Nothing in the format changes.
* **(b) Index at the end, fixed trailer.** Header (without N), frames in arrival order, index in display order, a
  fixed-size trailer at EOF giving the index's offset and N. A merge writes the new frames over the old index, then
  the new index and trailer: the file is changed in place.
* **(c) Append-only.** As (b), but a merge only appends: new frames, a new index, a new trailer. Readers take the last
  trailer; each old index becomes dead bytes.
* **(d) An extension segment per merge.** The first version as today; each merge appends a segment: its frames and
  an index of only them, each entry naming the display position it is inserted at. A reader replays the segments.

| | (a) rewrite | (b) trailer, in place | (c) append-only | (d) segments |
| --- | --- | --- | --- | --- |
| written per merge | S + s + N·E, plus `fsync`s | s + (N + k)·E + trailer | s + (N + k)·E + trailer | s + k·E + segment header |
| read per merge | S (the old file) + S + s (the read-back) | the trailer | the trailer | the last segment's header |
| read back from disk | the whole file: every old frame was copied, so every one may be wrong | the new bytes | the new bytes | the new bytes |
| a frame in the middle | in place in display order | at the end on disk; the index puts it in order | the same | the same, by a position the file must now store |
| crash between writes | nothing: the name holds the old file until `rename` | the old index is overwritten before the new one is complete: **no valid version** | a torn tail; the previous trailer is intact but has to be found | the same as (c) |
| an open session | keeps the old inode, whole (POSIX unlink) | keeps its in-memory index; frame bytes untouched | keeps the old version: its bytes are never written | the same as (c) |
| a new session | a new inode: §4's `stat` sees it | **the same inode**: §4's check must add the size or the trailer | the same as (b) | the same as (b) |
| an opener during a merge | sees old or new, never neither (rename(2)) | can read a trailer whose index is being overwritten | finds no trailer at EOF: refused, or scans back | the same as (c) |
| open, `pread`s | 2, as today | `stat`, trailer, header, index: 3–4 | 3–4 | 2 + one per segment |
| read-ahead | unchanged | one miss per late frame | the same | the same |
| layout 1 | unchanged | formula kept (the index is rewritten whole); the late frames' bands lie outside each band's run | the same as (b) | **breaks** the formula: entries are no longer at b·N·T + f·T + t |
| dead space | none; the old file lives until its last session ends | none | (N + k)·E per merge, the indexes | none, but open cost grows per merge |
| compaction | not needed | not needed | needed; it is (a) | needed; it is (a) |
| staging rule | kept | **broken**: written in the serving tree | broken | broken |
| new code | the merge only: today's reader and writer | trailer, reader, in-place writer, a `stat` change | (b)'s, plus recovery and compaction | (c)'s, plus replay and stored positions |

### Each, in a line

**(a)** costs I/O proportional to the series, every merge, and nothing else: it is the only option that keeps every
fixed point above. Its cost is two reads and one write of S (the owner's "one read and one write" plus the read-back
of 6b, which must cover every copied frame), and a second copy of S on disk while the merge runs and while an old
session holds the old file. ~~Extent sharing (`FICLONE`, `copy_file_range`) does not help: the index grows by k·E and
shifts every frame off its old offset.~~ **Corrected 2026-10-27:** that holds only for an index at the front with no
slack. With the index at the end (or slack reserved at the front) and a reflink clone (XFS), only the frames from the
insertion point on are written: at N = 2 000 a late frame at the end costs 342 kB and 3–7 ms instead of 529 MB and
2–4 s, in the middle 264 MB, and at the start more than the full rewrite (every block pays copy-on-write); ext4, without
reflinks, gains nothing; layout 1's band-major entries still rewrite ≥ 93 % of S (`docs/disk-layout/containers.md`
§Measured: rewriting only the tail, `6a85202` on branch `claude/sbnd-tail-rewrite`, #185).

**(b)** is not crash-safe and cannot be made so without writing somewhere else first, which is (c). Out.

**(c)** writes only what is new and is safe if the barriers are ordered: append the frames and the index,
`fdatasync`, append the trailer, `fdatasync`, then the study-DB transaction (step 7). One `fsync` for all of it is not
enough: a file system may persist the trailer before the frames it points to (Pillai et al. 2014 found appends that
are not content-atomic on common configurations). It then pays for that in five places: it writes the serving tree
outside a `rename`, against the owner's staging rule, and a refusal (R) or a crash must truncate a published file
back; §4's inode check stops telling a new version, so a new session can be handed the old in-memory index unless
the lookup also compares the size; an opener mid-merge finds no trailer at EOF; each late frame is a read-ahead miss
and, in layout 1, a hole in the band runs whose grouping is the layout's measured gain (17.6× when the cache cannot
hold the cycle, above); and the file's bytes now depend on its arrival history, so the site's pack and the PACS's
merged file of the same series differ byte for byte.

**(d)** has (c)'s costs and adds its own: the file must store each entry's display position, which v2 deliberately
leaves to the entry's place in the index; the arithmetic index of layout 1 is gone; and every open replays every
segment. It suits a series that only grows at its end in display order (fragmented MP4's case), which a late
instance is not.

### Prior art, and what it says here

* **ZIP** (PKWARE APPNOTE 6.3.10): "Files MAY be added or replaced within a ZIP file, or deleted" (§4.3.1); the
  central directory follows the file data and the end-of-central-directory record comes last (§4.3.6), and the
  directory's entries "MAY NOT necessarily be in the same order that files appear" (§4.4.1.3) — (c) exactly. Its
  trailer is not fixed: it ends in a comment of variable length (§4.3.16), so a reader scans back for it.
* **ISO BMFF** (ISO/IEC 14496-12): the `moov` index may follow the media data, and "fast start" tools exist to rewrite
  the file with it in front, which is what a streaming reader needs — (b)'s layout and the rewrite that undoes it.
  Movie fragments (§8.8) append in presentation order, and the Movie Fragment Random Access Offset box (`mfro`) is a
  fixed box at the end giving the size of the random-access index before it: (d), and (b)'s trailer.
* **MXF** (SMPTE ST 377-1): header, body and footer partitions; the index table segments and the closed, complete
  header metadata may sit in the footer, and the optional Random Index Pack ends the file with its own length so a
  reader finds every partition from the end — (b) and (d), for a recording that is written once while it grows.
* **SQLite WAL** (sqlite.org/wal.html): a reader "remembers the location of the last valid commit record in the WAL
  … the end mark", and the end mark "is unchanged for the duration of the transaction" (§2.2) — the open session of
  (c). The WAL needs a checkpoint to fold it back, and "if there is always at least one active reader, then no
  checkpoints will be able to complete and hence the WAL file will grow without bound" (§6): (c)'s compaction, and its
  dead space under sessions that never end ([`../adr/transport-idle-sessions.md`](../adr/transport-idle-sessions.md)).
* **LMDB** (Chu, LDAPCon 2011): copy-on-write pages, never overwritten while a reader holds them, and two meta pages
  at the head written alternately in place, so the newest valid root is found without a scan. It is the answer to
  (c)'s "opener finds no trailer", and it is an in-place write, which §4 forbids for a published name.
* **Log-structured file systems** (Rosenblum and Ousterhout, ACM TOCS 10(1), 1992): writes only append, and the cost
  moves to the segment cleaner, the compaction (c) and (d) owe.

Every design that appends in place pays with a pointer that must be found (a scan, or a fixed slot written in place)
and a compaction that is the rewrite, deferred. The rewrite-and-rename is what each of them falls back to.

### The deciding unknown: how often, and how big

(a)'s cost is per merge: the I/O is 3·S, so it matters only as (late merges per day) × (bytes of the series they hit).
Neither factor is known for this PACS. Measured by:

1. **Frequency.** From a site's own DICOM receive log (each instance's series UID and arrival time), replay the
   completeness rule the receiver will use (the quiet period *Q*, [`../ingest/design.md`](../ingest/design.md) §11.4)
   and count the series with at least one instance after "complete", per modality, over a month.
2. **Amplification.** For those series, Σ S over merges ÷ Σ bytes ingested: the share of the receiver's disk traffic
   (a) adds. The same replay at several *Q* shows how much a longer quiet period removes, since it calls fewer series
   complete too early.
3. **Cost on the host.** One merge of a 500 MB and a 4 GB series, timed, read-back included, the host's saturation
   stated, interleaved with an ingest of new series so its effect on them is seen.

### Recommendation

**Keep (a): today's layout, merged by rewrite and rename. Change nothing in the format for late instances.** It is
the only option that keeps the staging rule, the publish-by-rename, §4's "in place is never" and its inode check, the
fill's read-ahead, layout 1's band runs and a file whose bytes depend only on its content, and it adds no code to the
format. (c) is the only alternative that holds up; it would be a new `version`, so v2 needs no hedge for it now.

**What would change it:** step 2 showing (a) adding a material share of the receiver's disk traffic (a threshold
for the owner; a few percent would not move it), or step 3 showing a merge of the largest series delaying new
ingests beyond what the sending site tolerates. Then (c), with its compaction done by (a), the size added to §4's lookup, and
the staging rule revisited by the owner. A longer *Q* is tried first: it costs no format.

### Decision (owner, 2026-10-26)

**Stay with the current format and the full rewrite**: rewrite in staging, read back, `rename`. Publishing by rename
is needed for crash safety and for readers that already have the file open, as it is for MXF and MP4; modifications
are uncommon, so the full copy is acceptable. Frames stay contiguous in display order: layouts that store frames in
arrival order are rejected. Several bundle files per series are rejected: they complicate serving and archiving. The
tail rewrite measured above is not taken up. **Reopen** only if late merges prove frequent, measured by §The deciding
unknown.

Sources: PKWARE, APPNOTE.TXT 6.3.10 (§4.3.1, §4.3.6, §4.3.16, §4.4.1.3); ISO/IEC 14496-12 (§8.8, movie fragments and
`mfra`/`mfro`); SMPTE ST 377-1 (partitions, index tables, Random Index Pack); SQLite, *Write-Ahead Logging*
(sqlite.org/wal.html, §2.2, §6); H. Chu, *MDB: A Memory-Mapped Database and Backend for OpenLDAP*, LDAPCon 2011;
M. Rosenblum and J. Ousterhout, *The Design and Implementation of a Log-Structured File System*, ACM TOCS 10(1),
1992; T. S. Pillai et al., *All File Systems Are Not Created Equal*, OSDI 2014; POSIX `rename()` and `unlink()`;
rename(2), fsync(2).

## Open

* **Streaming the pack** while frames are still coded: the index needs every length first (queue row 163).
* **Standard containers** in place of the `.sbnd` (rows 159–160).
* **When a series is complete** ([`../ingest/design.md`](../ingest/design.md)); a late instance's merge is
  §A late instance above, decided: the full rewrite. What a late frame costs each container, measured:
  [`containers.md`](containers.md) §Measured: what a late frame costs.
* **Where `<Study>/` sits under the root** (flat, a date folder, a hashed level): the options and a recommendation
  in [`../adr/pacs-disk-layout.md`](../adr/pacs-disk-layout.md), for the meeting with the PCS team.
