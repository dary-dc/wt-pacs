# Standard containers, against the `.sbnd`

*Queue row 159, CONTAINERS, 2026-10-13. Theory: nothing built or timed here. One question, the owner's: **what is
each container, and what can it do for us?** Row 160 measures it, by §9's protocol, in a session given only §9.*

**The answer, short.**

* **The read path does not care.** Once a series is open the server needs one thing per frame: where its bytes start
  and how many there are (`server/src/media/frame_store.rs:74-77`). Every candidate below stores a frame (or, for AV1,
  a temporal unit) as one contiguous run of bytes, so any of them can feed the same lookup and the same `pread`
  ([`../adr/disk-access.md`](../adr/disk-access.md) §1) once a table of (offset, length) is built at open (D, §2).
  Per-frame read latency, fill throughput and CPU per GB are therefore predicted to **tie**, apart from the bytes a
  fill reads that are not frame (§4: ≤ 0.3 % for every arm at 16 KiB and up, except FFmpeg's MXF at 6.3 %).
* **What differs is the open and the payload.** The `.sbnd` builds that table from two reads of a fixed-stride array.
  Progressive MP4 and DICOM with an Extended Offset Table come close; Matroska, MXF and fragmented MP4 store no frame
  length where the index is, so an exact table costs a header read per frame (or per fragment); raw AV1 and IVF have
  no index at all (§5).
* **No standard container carries our AV1 payload as a standard track** (§6). The payload is a 16-byte header and,
  for 10–14-bit grey, two AV1 streams whose samples combine as `(top << split) | low`
  ([`../av1/payload-format.md`](../av1/payload-format.md)); no codec mapping, player or decoder knows that, and AV1
  stops at 12 bits (AV1 spec §6.4.1). HTJ2K has a standard home in DICOM (transfer syntax .201) and MXF (ST 422:2022),
  and only a draft or unverified one in Matroska and MP4.
* **The draft target's features have no standard field anywhere** (§7): a coded and a samples hash per frame, and the
  band-major tiled layout, would be private extensions that the standard tools ignore. Study and Series UIDs are
  native only to DICOM.
* **Prediction for row 160:** the `.sbnd` stays as the stored form; DICOM with an Extended Offset Table is the one
  standard container that ties on the open and the reads, and is the candidate for an *export* (HTJ2K only). Proposed,
  for the owner and the team (§9).

**How a number is sourced.** As in [`../native/quic-compared.md`](../native/quic-compared.md): each number at its
point of use is **(S)** sourced — a spec section or table, or `file:line` at a pinned tag (§10) — **(D)** derived, with
its inputs sourced and its arithmetic written out or in [`containers_overhead.py`](containers_overhead.py) — or
**(M)** measured here, with its row. *Unverified* says so. ISO/IEC 14496-12 (ISO BMFF) and 15444-3 (Motion JPEG 2000)
are paywalled and were not read; their box layouts are taken from FFmpeg n7.1's reader and writer and from Apple's
QuickTime File Format (2001), which ISO BMFF "was based on" (LoC fdd000079) — neither is the ISO text. No claim here
depends on a link band.

## 1 · The reference: the `.sbnd`

**Today** (`common/series-bundle/src/format.rs`, version 1), little-endian:

```text
 0      4        8              12            16                 16+12N           16+12N+M
 ┌──────┬────────┬──────────────┬─────────────┬──────────────────┬────────────────┬───────────────────────┐
 │"SBND"│ ver u32│ metadata u32 │ frames u32  │ index: N × 12 B  │ metadata JSON  │ frames back to back,  │
 │      │  = 1   │  = M bytes   │  = N        │ offset u64 · len │ (M bytes)      │ display order         │
 └──────┴────────┴──────────────┴─────────────┴──────────────────┴────────────────┴───────────────────────┘
```

* **Open:** two `pread`s — the 16-byte header, then the whole prefix up to the first frame (`format.rs:87-99`); each
  entry is bounds-checked against the file (`format.rs:43-58`). Bytes read: 16 + 12N + M (S).
* **Per frame:** `frame_span(i)` is an array lookup (`server/src/media/frame_store.rs:74-77`), then one `preadv2`
  (`RWF_NOWAIT`) on a hit, or the pool's `pread` / the ring on a miss (`disk-access.md` §1). The index is held once per
  series, 12 B a frame on disk (`disk-access.md` §7).
* **Write:** lengths up front, one pass, no fsync (`writer.rs:20-60`, `:79-92`); since row 269 (2026-10-16) to `NAME.partial`, renamed at `finish`, where this said no temporary name.
* **No codec field:** the codec is in the metadata (`"codec": "av1"`, `ingest/coded-frames/ingest.py:6`). Row 164 fixes
  `payload-format.md`'s line that says otherwise.

**The draft target** (row 164's brief, agreed 2026-10-12, a draft until rows 159–160 report): a 148-byte header —
"SBND", version 2, codec ("HTJ2", "AV01"), layout, entry count, Study and Series Instance UID (64 B each) — then, for
layout 0, a **28-byte entry**: offset u64 · length u32 · XXH3-64 of the coded bytes · XXH3-64 of the samples; no
metadata in or beside the file; published by `.partial` → fsync → rename → fsync of the directory. Layout 1 (tiled,
later) stores 36-byte entries band-major, so a screen-fitted read is one contiguous range; the layout is what the
2026-09-10 evidence calls "worth 17.6×" on the same reads (`read-path-evidence-2026-09-10:docs/disk-access/EVIDENCE.md:828`; row 164's brief names an `ACCESS-PATTERNS` study at a 2026-09-09 tag, which no ref in this repository carries).

## 2 · What the read path asks of a container

Three properties, each from the shipped code:

1. **A frame is one contiguous byte range**, so one positional read returns it whole and the bytes go to quinn as
   they are (`disk-access.md` §1, the pooled hand-off).
2. **An (offset, length) table in memory**, built once per series and shared by every session (`disk-access.md` §7,
   *One index per series*). Where it is on disk only changes the open.
3. **Frames in display order, back to back**, so a fill's `posix_fadvise(WILLNEED)` over `FILL_WINDOW` (4 MiB,
   `read_path.rs:28`) covers the next frames and little else (`read_path.rs:197-211`).

Every candidate below satisfies 1 for intra-only content and 3 when written in display order (D, §3). So the fair arm
(row 160's brief) loads the container's index at open into the same table and serves through the same path; the
comparison is then **the open, the bytes between frames, the payloads it can carry and what else it brings**, not the
read path. Where a container's index lacks the length, the fair arm must read each frame's header once to make the
table exact (§5).

## 3 · Each container

### 3.1 MP4 / ISO BMFF, progressive

```text
ftyp │ moov ─ trak ─ mdia ─ minf ─ stbl: stsd · stts · [stss] · stsc · stsz · stco|co64 │ mdat: sample sample …
      (FFmpeg default: ftyp │ free │ mdat … │ moov at the end; faststart moves moov to the front)
```

* **Boxes:** an 8-byte header (size, type), 16 with a 64-bit size (S, QTFF "Atom Structure"; `mov.c:9186-9219`). The
  sample tables are full boxes (+4 B version and flags).
* **Index:** `stsz` 4 B a sample, `stco` 4 B or `co64` 8 B a *chunk*, `stsc` 12 B per run of equal chunks, `stts` 8 B a
  run, `stss` omitted when every sample is a sync sample (S: QTFF Fig. 2-29–2-36; `movenc.c:187-274`, `:3197`). Chunk
  offsets are file offsets (S, QTFF p. 78). Frame i: find its chunk via `stsc`, add the sizes before it in that chunk,
  read its size from `stsz` (S, `mov.c:4639-4720`). One sample a chunk with `co64` is **12 B a frame**, the `.sbnd`'s
  figure, in two tables (D). FFmpeg groups contiguous samples while a chunk stays under 1 MiB (`movenc.c:4899-4902`)
  and writes `co64` only past 4 GiB (`movenc.c:163-168`).
* **Open:** FFmpeg reads the whole `moov` and builds a 24-byte `AVIndexEntry` per sample (`mov.c:4602-4715`,
  `avformat.h:615`). A fair reader walks the top-level box headers (a few small reads; one seek to the end when `moov`
  is last) and reads `moov` once: 4–12 B a frame plus ~88 B of sample-table headers and the box tree (D).
* **Metadata:** `udta`, `meta`, `uuid` (registered, MP4RA boxes; LoC fdd000079: "Private extensions are possible by
  using the uuid box type").
* **Per-frame overhead:** none inline; samples back to back in `mdat` (`movenc.c:80-125` has no alignment option).

### 3.2 Fragmented MP4 and CMAF

```text
ftyp │ moov (empty tables, mvex) │ [sidx] moof (mfhd, traf: tfhd · tfdt · trun) mdat │ [sidx] moof mdat │ … │ mfra (tfra) mfro
```

* **Index:** each `trun` carries 0–16 B a sample (size, duration, flags, composition offset by flag; `isom.h:387-392`,
  `movenc.c:5264-5317`); `sidx` 12 B a reference (`mov.c:5939-5998`); `mfra`/`tfra` at the end, 19 B a fragment as
  FFmpeg writes it (`movenc.c:5698-5720`).
* **Overhead (D, FFmpeg `-movflags dash`):** 112 B a frame (moof + mdat headers) with one frame a fragment, 164 with
  its `sidx`, 183 with its `tfra` entry; about 4 + 160/F B a frame at F frames a fragment.
* **Open:** fragment offsets come from a global `sidx` or the `mfra`; each frame's length is in its fragment's `trun`,
  so an exact table reads every `moof` — N/F reads (D). FFmpeg's `dash` writes a `sidx` per fragment, not one global
  (`movenc.c:5677-5679`).
* **What it is for:** MSE takes only this form — an init segment of `ftyp` + `moov` with empty sample tables, then
  `moof` + `mdat` segments (S, MSE ISO BMFF byte stream format, §init-segments, §media-segments).

### 3.3 Matroska and WebM

```text
EBML header │ Segment: SeekHead · Info · Tracks · [Cues] · Cluster(Timestamp, SimpleBlock…) · Cluster … · [Cues] · Tags
SimpleBlock = 0xA3 · size VINT · track VINT · 16-bit relative time · flags · frame
```

* **Elements:** an ID (1–4 B) and a size VINT (1–8 B) before every element (S, RFC 8794 §4–6). A SimpleBlock's framing
  is 7 B at 10 KB, 8 B at 300 KB, 9 B at 30 MB (D, RFC 9559 §10.2; `matroskaenc.c:643`, `:655-657`). A Cluster's
  relative timestamp is 16-bit: ≤ 32.767 s at the default 1 ms tick (S, RFC 9559 §11.2, §5.1.2.9).
* **FFmpeg puts each intra frame of 4 KiB or more in its own Cluster** (`matroskaenc.c:3098-3101`), with a CRC-32 by
  default in Matroska and not in WebM (`:3549`, `:3411-3414`).
* **Index (Cues):** time → Cluster position (relative to the Segment's data, RFC 9559 §16), plus
  `CueRelativePosition` inside the Cluster, which FFmpeg always writes (`matroskaenc.c:977-993`). **No length.** Cues
  "can be used to index every single timestamp … or … selectively" and SHOULD reference video keyframes (RFC 9559
  §4.5, §22.1); a frame number must first become a time (constant duration only). FFmpeg's demuxer ignores
  `CueRelativePosition` and loads Cues only on the first seek unless they precede the Clusters (`matroskadec.c:701-703`,
  `:3311`, `:1497-1498`).
* **Open:** read the EBML header, SeekHead and Cues (19–20 B a cue as FFmpeg writes them, D), then — for an exact
  length — the ≤ 13-byte block header of every frame: N small reads (D). Cues at the end by default; at the front
  with `-reserve_index_space` or `-cues_to_front`, the latter by shifting the data (`matroskaenc.c:2659-2668`,
  `:3212-3226`).
* **Metadata:** Tags, Attachments (arbitrary files), a 16-byte SegmentUUID (RFC 9559 §5.1.8, §5.1.6, §5.1.2.1).
* **Overhead, FFmpeg:** ~42–48 B a frame with Cues, 36–42 B in WebM (D, §4).

### 3.4 DICOM multi-frame, encapsulated

```text
preamble 128 │ "DICM" │ group 0002 (meta) │ data set in tag order … (5200,9230) per-frame groups … (7FE0,0001) EOT
(7FE0,0002) EOT lengths │ (7FE0,0010) Pixel Data, undefined length: item(BOT, empty) item(frame 0) item(frame 1) … (FFFE,E0DD)
```

* **Structure:** elements in increasing tag order (S, PS3.5 2026d §7.1), so everything per frame — the Per-Frame
  Functional Groups and the offset tables — precedes the pixel data and has no fixed offset: a reader walks every
  element header from byte 132 (D). Each fragment is an item with an 8-byte header (PS3.5 §A.4, Table A.4-1), padded
  to even length.
* **Index:** the Basic Offset Table — 4-byte offsets, no lengths, so ≤ 4 GiB of pixel data (PS3.5 §A.4) — or the
  **Extended Offset Table**, 8-byte offsets and 8-byte lengths, allowed only with an empty BOT and one fragment a frame
  (PS3.3 2026d Table C.7-11a, §C.7.6.3.1.8). **HTJ2K requires one fragment a frame**: "For HTJ2K encoding, each Frame
  shall be encoded separately as a single Fragment" (PS3.5 §A.4.4).
* **Per frame after open:** with an EOT, offset = first item + EOT[i] + 8, length = EOTLengths[i]: one lookup and one
  `pread`, as the `.sbnd` (D). 24 B a frame (D, §4).
* **Open:** the data set up to Pixel Data; for an enhanced object that includes one Per-Frame Functional Groups item a
  frame (PS3.3 §C.7.6.16), so the open grows with the per-frame metadata, not with the index alone (D).
* **Limits:** Number of Frames ≤ 2³¹ − 1 (PS3.5 §8.2.5 Note); a fragment ≤ 2³² − 2 B (§8.2.7 Note); Bits Stored up
  to 38 under HTJ2K (PS3.5 Table 8.2.14-1).
* **Serving it as DICOMweb:** `/frames/{n}` returns each frame without its item header, `multipart/related` required
  (PS3.18 2026d §10.4.4, §8.7.3.3.2) — the same bytes as an EOT lookup gives.

### 3.5 MXF (SMPTE ST 377-1)

```text
Header Partition (pack · header metadata · [index]) │ Body Partitions (pack · [index segment] · content packages: KLV …)
│ Footer Partition (pack · [header metadata] · [index segments]) │ Random Index Pack
KLV = 16-byte key · BER length (1–9 B) · value
```

* **KLV everywhere,** no gaps (ST 377-1:2019 §6.3.1, §6.3.4, §6.3.8). Frame-wrapped: one KLV a frame; clip-wrapped:
  one KLV for all (ST 379-1 §5.4).
* **Index:** 11 B an edit unit (temporal offset, key-frame offset, flags, stream offset u64), **no length**, the offset
  counted from the start of the essence container, not the file (ST 377-1 Table 28, §11.1.4). Complete tables "should
  be placed in the Header Partition and / or the Footer Partition" (§11.2.1); OP-Atom requires the footer (ST 390 §5).
* **Open (FFmpeg):** read the Random Index Pack at the end, the header metadata, then walk every partition backwards
  for its index segments (`mxfdec.c:3646`, `:3721`, `:3383-3458`), and map container offsets to file offsets by
  partition (`mxfdec.c:1823-1850`). An exact table also needs each frame's KL (or each next offset): N reads (D).
* **Overhead:** 31 B a frame at its minimum (16 + 4 + 11, D); FFmpeg's OP1a writes a 512-byte system item, fills to
  a 512-byte grid and 15-byte entries: **847–1 039 B a frame** (D, `mxfenc.c:76`, `:1955-1962`, `:2055`), and its 4-byte
  BER caps a frame at 2²⁴ − 1 B ≈ 16 MiB (`mxfenc.c:537-541`, D).
* **HTJ2K:** ST 422:2022 maps 15444-15 codestreams (§1; Table 4, label byte 08h). FFmpeg n7.1 writes only the
  15444-1 label and the "FU" wrapping ST 422 says new files should not use (`mxfenc.c:216-218`; ST 422 §5.5).
* **Maturity:** digital cinema (ST 429-4:2023 §7.1, frame-wrapped only), IMF App 2E (ST 2067-21:2026, HTJ2K and
  16-bit allowed, colour only), the Library of Congress's > 635 TB of lossless JPEG 2000 in MXF OP1a (LoC fdd000013).

### 3.6 Motion JPEG 2000, and JPEG 2000 in HEIF

* **MJ2** (ISO/IEC 15444-3 = ITU-T T.802, paywalled): an ISO BMFF brand (`mjp2`, `mj2s`), each sample one JPEG 2000
  codestream (LoC fdd000127; MP4RA codecs `mjp2`). So §3.1's index and open apply (D). FFmpeg n7.1 **cannot write
  it**: no mj2 muxer; MP4 mode writes JPEG 2000 as `mp4v` with object type 0x6E, MOV mode tags it `mjp2` without a
  `jp2h` (`movenc.c:8559`, `isom.c:57`, `isom_tags.c:210`). "No adoption by broadcasters … known"; the Library chose
  MXF instead (LoC fdd000127).
* **ISO/IEC 15444-16:2025** (T.815) registers a `j2ki` sample entry and a `j2is` image-sequence brand (MP4RA codecs,
  brands). Whether it covers HTJ2K is **unverified**: jpeg.org says "a revision is underway to support … HTJ2K", and
  the text is paywalled. FFmpeg n7.1 has no `j2ki`.

### 3.7 Raw AV1: OBUs, Annex B, IVF

* **Low-overhead format** (AV1 spec §5.2): OBUs back to back, each a 1–2-byte header and a LEB128 size (§5.3,
  §4.10.5). **Annex B** wraps each temporal unit, frame and OBU in a LEB128 length (Annex B.2–B.3). Neither has an
  index: reaching temporal unit i is i sequential reads (D).
* **IVF:** a 32-byte header and 12 B a frame inline (size u32, pts u64) (`ivfenc.c:59-70`, `:80-82`); FFmpeg adds a
  2-byte temporal delimiter to each AV1 frame (`ivfenc.c:45-47`). No index (`ivfdec.c:92-100`).
* **What WebCodecs takes** is a §5 temporal unit, no container (WebCodecs AV1 registration §2–3) — which is what each
  AV1 stream in our payload already is.

### 3.8 Others in use for frame sequences

DICOM's video transfer syntaxes (MPEG-2, H.264, HEVC) put one inter-coded stream in one fragment inside MPEG-TS or
MP4 (PS3.5 §8.2.7, §8.2.10), so a frame is reached through the inner container, not DICOM's tables. ISO/IEC 23001-17
`uncv` (uncompressed video in ISO BMFF) is registered (MP4RA); its bit-depth range is unverified and FFmpeg n7.1 does
not write it. Neither adds a property §3.1–3.4 lack.

## 4 · Bytes on disk

`python3 docs/disk-layout/containers_overhead.py` (D): framing plus index per frame, 1 000 frames, at the lab's
16 KiB and 250 kB rungs (`docs/FIXTURES.md`, the rung sets), a 3 MB tomosynthesis frame
(`read-path-evidence-2026-09-10:docs/disk-access/EVIDENCE.md:845`) and a 27 MB mammogram frame
([`../ingest/design.md`](../ingest/design.md):204).

| container | 16 384 B | 250 000 B | 3 000 000 B | 27 000 000 B |
| --- | --: | --: | --: | --: |
| .sbnd today | 12 · 0.07% | 12 · 0.00% | 12 · 0.00% | 12 · 0.00% |
| .sbnd draft (row 164) | 28 · 0.17% | 28 · 0.01% | 28 · 0.00% | 28 · 0.00% |
| MP4, FFmpeg's chunks | 4.06 · 0.02% | 5 · 0.00% | 8 · 0.00% | 12 · 0.00% |
| MP4, one sample a chunk, co64 | 12 · 0.07% | 12 · 0.00% | 12 · 0.00% | 12 · 0.00% |
| fragmented MP4, a frame a fragment | 183 · 1.12% | 183 · 0.07% | 183 · 0.01% | 183 · 0.00% |
| fragmented MP4, 30 frames a fragment | 9.97 · 0.06% | 9.97 · 0.00% | 9.97 · 0.00% | 9.97 · 0.00% |
| Matroska, FFmpeg | 44 · 0.27% | 45 · 0.02% | 47 · 0.00% | 48 · 0.00% |
| WebM, FFmpeg | 38 · 0.23% | 39 · 0.02% | 41 · 0.00% | 42 · 0.00% |
| DICOM, Extended Offset Table | 24 · 0.15% | 24 · 0.01% | 24 · 0.00% | 24 · 0.00% |
| DICOM, Basic Offset Table | 12 · 0.07% | 12 · 0.00% | 12 · 0.00% | past 4 GiB |
| MXF frame-wrapped, minimal | 31 · 0.19% | 31 · 0.01% | 31 · 0.00% | 31 · 0.00% |
| MXF frame-wrapped, FFmpeg OP1a | 1039 · 6.34% | 895 · 0.36% | 847 · 0.03% | 847 · 0.00% |
| IVF, AV1 | 14 · 0.09% | 14 · 0.01% | 14 · 0.00% | 14 · 0.00% |

Fixed costs (the header, `moov`'s box tree, the EBML header and SeekHead, DICOM's meta group and data set, MXF's
partitions) are left out: per series, not per frame. Matroska's timestamps assume 40 ms a frame. FFmpeg's MXF writer
cannot hold the 27 MB frame (§3.5). The script checks itself against the hand derivations in §3 and fails on each of
15 mutations of its constants and boundaries (run 2026-10-13).

**Reading:** every arm but FFmpeg's MXF and one-frame fragments stays within 0.3 % of the frame at 16 KiB and within
0.02 % at 250 kB. Bytes do not separate the containers; a fill's extra read is the same fraction (D).

## 5 · What maximizes throughput or minimizes latency in each

After open, every arm is the same lookup and `pread` (§2); what a container's layout can still cost is the open, and
whether the read stays one `pread`:

| container | to build an exact (offset, length) table at open | per frame after | levers |
| --- | --- | --- | --- |
| `.sbnd` | 2 reads, 16 + 12N + M B (S, `format.rs:87-99`) | 1 lookup, 1 `pread` | none needed |
| MP4, progressive | top-level box headers (a few reads) + `moov` (4–12 B a frame + box tree); prefix sums inside chunks (D) | same | `moov` first (faststart, a second full copy at write, `mux_utils.c:72-121`), or `moov` last and one more read; one sample a chunk |
| fragmented MP4 | a global `sidx` or `mfra`, then every `moof`: N/F reads (D) | same | F large; a global `sidx` (`global_sidx`) |
| Matroska / WebM | header, SeekHead, Cues, then each frame's ≤ 13-byte block header: N reads (D) | same (or 2 reads if the header is read lazily) | Cues before Clusters; one cue a frame with `CueRelativePosition` |
| DICOM, EOT | the data set to Pixel Data (all per-frame metadata), EOT 16N B (D) | same | an EOT; little per-frame metadata; one fragment a frame |
| DICOM, BOT only | as EOT, lengths from the next offset and an item header (D) | same | — (4 GiB cap) |
| MXF | RIP, header metadata, every partition's index segments, then each frame's KL: N reads (D) | same | complete index in the header or footer; frame wrapping; KAG 1 |
| IVF / raw AV1 | a scan of the file: N chained reads (D) | same | none: no index |

**Predicted ranking of the open** (D, by reads and bytes): `.sbnd` ≈ progressive MP4 < DICOM with EOT (as much more
as its per-frame metadata) < Matroska ≈ MXF ≈ fragmented MP4 at F = 1 (N small reads) < IVF / raw (N chained reads).
How much each matters is row 160's to say: a series is opened once per server process (`disk-access.md` §7), so the
open counts on the first ask of a cold series and nowhere else.

**Alignment:** none of the `.sbnd`'s reads needs it, and none of the containers requires it; MP4 (unreferenced bytes,
`free`), Matroska (Void ≥ 2 B, RFC 8794 §11.3.2) and MXF (KAG fill, ST 377-1 §6.4.1) allow it (S); FFmpeg's MXF
aligns to 512 B and is the one arm whose bytes it inflates (§4).

**Server CPU per GB** is set by the send path: 1.5–2.6 µs/kB from 250 kB to 16 MB, not growing with the frame
(**M**, `disk-access.md` §11 *Frames past 250 kB*, row 51). A container adds work only at open (D).

## 6 · Codec mappings, against our two payloads

Our payloads: **HTJ2K**, a bare codestream (`payload-format.md`, last bullet); **AV1**, a 16-byte header (version,
bits, depth, split, flags, offset, n) and per frame either one temporal unit (`split` 0: grey ≤ 9 bits, 8-bit RGB
through the RCT) or a top and a low unit (`split` 2–3: grey 10–14 bits) (`payload-format.md` §Payload, §Representation).

| container | HTJ2K | AV1, one stream (`split` 0) | AV1, top + low (`split` > 0) | 16-bit grey |
| --- | --- | --- | --- | --- |
| MP4 | `j2ki` (15444-16:2025), HTJ2K unverified; MJ2 Part 1 only; FFmpeg writes neither | `av01` + `av1C` (AV1-ISOBMFF v1.3.0 §2) — but RCT colour is ours | two tracks no player combines; header fields have no home | MJ2/`j2ki` (JPEG 2000 to 38 bits) |
| Matroska / WebM | `V_JPEG2000` in a CELLAR draft only (`codec_specs.md:209-215`); FFmpeg: `V_MS/VFW/FOURCC` | `V_AV1` | as MP4 | `V_UNCOMPRESSED` (no FourCC registry), FFV1 |
| DICOM | **.201/.202/.203** (PS3.5 §8.2.14, §A.4.4) | none: no AV1 in PS3.5 or PS3.6 2026d | none | yes (Bits Stored ≤ 38) |
| MXF | **ST 422:2022** (label 08h); FFmpeg writes Part 1's label | none found | none | permitted by ST 422; unverified in a profile |
| MJ2 / HEIF | Part 1 (MJ2); `j2ki` unverified for HTJ2K | — | — | yes |
| IVF / raw | — | yes (`AV01`) | two files | — |

* **AV1 stops at 12 bits** (AV1 spec §6.4.1, §5.5.2; Professional profile for 12-bit monochrome), which is why our
  payload splits 10–14-bit grey and refuses 15–16 (`payload-format.md`). A standard AV1 track can therefore carry only
  the `split` 0 cases, and a player shows the RCT planes, not RGB, for colour (D).
* **Carried opaquely,** any container stores the whole payload as a sample under a private sample entry or CodecID:
  byte-exact, but no standard tool can decode it, which is the benefit the team proposed containers for (D).

## 7 · Everything else that counts

**Tooling.** ffprobe shows FFmpeg's demuxed packets (size, position; `-show_data_hash`) for MP4, Matroska, MXF, IVF
(`ffprobe.texi:126-128`, `:200-205`); MP4Box dumps every box and sample position (GPAC `mp4box-dump-opts.md:73-130`);
mkvinfo/mkvextract/mkvmerge for Matroska; MediaInfo summarises all; dcmdump for DICOM, though open-source DCMTK has no
JPEG 2000 or HTJ2K codec (DCMTK `README`). For the `.sbnd` the tools are ours (`pack-series`, `format.rs`'s parser); no third-party tool reads it. None of these tools decodes our split AV1 payload (§6).

**Hardware playback** belongs to the codec; the container only feeds it (D). For our payloads it buys nothing
diagnostic: a `split` > 0 frame's top stream alone is the sample shifted right by two or three bits, and HTJ2K
hardware decode is row 161's question. Row 161 (HWDECODE) owns this.

**Browsers.** The client never receives a file: the server sends frames over WebTransport, each `[4B display_index]
[bytes]` ([`../WIRE.md`](../WIRE.md)), and WebCodecs takes no container ("encoded media is not containerized",
WebCodecs §7.4). So the stored container is invisible to the page (D). Only a design that served whole files to
`<video>` or MSE would care: MSE takes fragmented MP4 and WebM Clusters and ignores Cues (MSE byte stream formats,
ISO BMFF §media-segments; WebM §Media Segments), and the WebM byte stream registry's codec table does not list `av01`
(S); whether a media element returns exact samples is row 161's.

**The draft target's features** (§1):

| feature | MP4 | Matroska | DICOM | MXF | IVF |
| --- | --- | --- | --- | --- | --- |
| Study / Series UID | `udta`/`meta`/`uuid` (private) | Tags (private names) | **native** (0020,000D/E) | descriptive metadata (unverified detail) | none |
| coded + samples hash a frame | `saiz`/`saio` with a private type; no hash type registered (MP4RA aux-info-types); FFmpeg ignores them on clear tracks (`mov.c:7205-7208`) | BlockAdditions, private type, forces a BlockGroup (RFC 9559 §5.1.3.5.2; CELLAR `codec_iana.md:144-155`) | none per frame; signatures cover a data set (PS3.3 §C.12.1.1.3) | none standard | none |
| band-major tiled layout | a sample is one range (`stsz`/`stco`); a frame split across ranges is not a sample | a block is one range | one fragment a frame for HTJ2K (§3.4) | one KLV a frame or a clip | — |

A tiled, band-major frame is by design not one contiguous range, so in every container it would be stored as many
samples (or fragments, blocks) and the frame reassembled by our code — a private layout inside a standard wrapper (D).
Each hash and UID column outside DICOM's UIDs is a private extension the standard tools ignore.

**Licences and patents.** ISO BMFF: Apple and Matsushita offered RAND licences for the original specification
(LoC fdd000079); MP4: MPEG-4 Systems licensing "managed by VIA Licensing Alliance" (LoC fdd000155) — whether that
reaches a container-only use is unverified; MJ2: Sony RAND (LoC fdd000127); MXF: "Licensing and patents: None"
(LoC fdd000013); Matroska: library licences only, no patent statement in the LoC page or RFC 9559 (unverified beyond
those); DICOM: published free at dicom.nema.org (§10); a patent statement was not read. Tools: FFmpeg LGPL-2.1+ (GPL with
`--enable-gpl`), GPAC LGPL-2.1+, MKVToolNix GPL-2 (libebml, libmatroska LGPL-2.1+), MediaInfo BSD-2-Clause, DCMTK
BSD-3-Clause, pydicom MIT (each tree's licence file, §10). The `.sbnd` is ours: no licence question, and no standard
either.

**Maturity.** MP4, Matroska, MXF and DICOM are each decades in production; MJ2 has little adoption (above); HTJ2K in
MP4 and in Matroska is not yet settled (§6).

## 8 · What the theory predicts

* **Ties** after open on per-frame read latency (hit and miss), fill throughput and CPU per GB, for every arm whose
  bytes are within 0.3 % (§4, §5). FFmpeg's MXF at 16 KiB is the one arm whose extra bytes (6.3 %) should show in a
  fill, by that fraction.
* **The open separates them**, by the reads in §5's table; its cost lands only on a cold series' first ask.
* **No standard container carries both payloads under standard mappings** (§6), and none carries the draft's
  per-frame hashes or tiled layout in a standard field (§7). What a container would standardise for us is the wrapper,
  not the content the tools could use.
* **DICOM with an Extended Offset Table** is the closest standard: one lookup and one `pread` per frame, HTJ2K native,
  the UIDs native, 24 B a frame; it lacks AV1, per-frame hashes and a fixed-offset index.

## 9 · Row 160's protocol (*proposed*, for the owner and the team)

**Arms**, each written in display order, its index loaded at open into the server's (offset, length) table, then
served by the shipped read path (`FrameStore`, `RWF_NOWAIT`, the pool, the ring): a fair arm, not a strawman.

1. `.sbnd` v1 (today), `pack-series`.
2. `.sbnd` v2 draft, 28-byte entries (row 164's layout 0), ours.
3. MP4, progressive, `moov` first, one sample a chunk (`co64` where needed) — and FFmpeg's default chunks as a
   second packing, by `ffmpeg -movflags +faststart` where it takes the codec.
4. Fragmented MP4, F = 1 and F = 30, a global `sidx`.
5. Matroska, Cues before the Clusters, one cue a frame with `CueRelativePosition` (`mkvmerge --cues …:all`, or
   FFmpeg `-reserve_index_space`).
6. DICOM multi-frame, HTJ2K .201, Extended Offset Table, no per-frame functional groups and with the source's own.
7. MXF OP1a frame-wrapped, a complete index in the footer — by FFmpeg (Part 1 label) and by ours at KAG 1.
8. IVF (AV1 only), as the no-index bound.

AV1 arms carry the payload opaquely where no standard mapping fits it, and say so.

**Data:** sound sets only (`lab/av1/data.json` provenance `sound`); others labelled, deciding nothing. At least one
series at each of the §4 sizes the sound sets offer, and the largest sound series by frame count.

**Metrics**, CLAUDE.md §Measurement: time to open (cold, through the store's test levers, and warm); bytes on disk;
per-frame read latency, hit and forced miss; fill throughput (frames/s, not latency); server CPU per GB served;
ingest packing time by the standard tool and by ours. Interleave arms with `lab/order.mjs` or `lab/scripts/order.py`;
n and spread per cell; mutate every new reader (a shifted offset, a wrong length) and watch the exactness check fail;
every frame read compared by XXH3-64 with the encoder's input; say where the host saturates. Arms differ in the
container alone (codec build, read path and host printed per arm).

**Predictions** (from §4, §5, §8): read latency, fill throughput and CPU per GB tie with `.sbnd` v1 for arms 2–7 at
16 KiB and above, except arm 7 by FFmpeg at 16 KiB (fill −6 %); open: arms 1–3 within a few reads of each other,
arm 6 growing with its per-frame metadata, arms 4 (F = 1), 5 and 7 growing with N, arm 8 slowest; bytes within 0.3 %
except as §4 says; packing by FFmpeg's faststart or `cues_to_front` about one extra copy of the file.

**Decision rule.** A standard container **replaces the `.sbnd` as the stored form** only if all of:
(a) per-frame read latency (hit and miss), fill throughput and CPU per GB tie with or beat `.sbnd` v1 by the paired
rule of `disk-access.md` §2 (a difference counts when the median beats the resolution and ≥ 80 % of cells agree);
(b) cold open within 1 ms or 2× of `.sbnd` v1 at the p50, whichever is larger, on the largest sound series;
(c) bytes within 1 % of `.sbnd` v2;
(d) every sound series' frames, in both payloads, round-trip byte-exact through the container's reference tool
(packed by ours, extracted by the tool, and the reverse), with the draft's two hashes and UIDs carried.
**Otherwise the `.sbnd` stays.** An arm that meets (d) for HTJ2K alone and (a)–(c) is a candidate **export** format,
not a store, and is proposed as such. Whether a standard mapping exists for each payload is reported, not decisive:
it is §6's answer and does not change with a measurement.

## 10 · Sources

Fetched 2026-10-13; nothing fetched is committed. SHA-256 of each file as read.

| source | version / pin | sha256 |
| --- | --- | --- |
| FFmpeg source (read, not built) | tag n7.1, `b08d7969c550a804a59511c7b83f2dd8cc0499b8` | `movenc.c` and the rest at that commit |
| RFC 9559 Matroska | Oct 2024 | `f251c1e9b6879bb308000fbd9b2359de9472160c56d121b9345b6433afb00cb7` |
| RFC 8794 EBML | | `3b39e9f494f040e3b7b91d9bbe2441af5f4b4e2ae4a374b8dcf917ab9aecd409` |
| AV1 in Matroska/WebM (CELLAR `codec/av1.md`) | master `1a943ead9bb4c67b02b966cebafe51c8c074e703` | `6a499d9ae97852e68284625801d65b5baf3d219031d984f152e2edf2cabe217d` |
| CELLAR `cellar-codec/codec_specs.md`, `codec_iana.md` (Internet-Draft) | same commit | `2a9b25e3…5719`, `dad98a7f…b78f` |
| AV1-ISOBMFF binding | v1.3.0, 2024-04-03 | `20ed4fbbad5f0846de8da7635d67ab5ea6b9b9967dd2e0fbf5f05c26ebdd0f98` |
| AV1 bitstream specification (PDF) | 1.0.0 with Errata 1 | `ec44e9fc42c4e5851faa879a1818dcb9014d834bbdd9420ccca7dcea05a3abe9` |
| DICOM PS3.5 | 2026d | `34fe12d2f0bf7f13c7ec19784c5ffc0aea39c46d00e6d043ab76c2f373bcf6d1` |
| DICOM PS3.3 §C.7.6.3, §C.7.6.16, §C.12 | 2026d | `bb72b6e1…42ac`, `ad70f442…4524`, `9b7cca8d…a42c` |
| DICOM PS3.6 ch. 6, ch. A | 2026d | `7f3518a7…d2b1`, `778ad3e4…1eff` |
| DICOM PS3.18 §8.7.3, §8.7.3.3.2, §10.4.4 | 2026d | `a71adf2e…d5f8`, `6d8e1ae1…71e1`, `b13b8892…d291` |
| SMPTE ST 377-1:2019, ST 422:2022, ST 379-1:2009, ST 390:2011 | pub.smpte.org | `e46a68ad…5d98`, `922030ea…5515`, `6d669a28…37f1`, `368d9edd…f59a` |
| SMPTE ST 2067-21:2026, ST 429-4:2023 | pub.smpte.org | `7cb77d88…a8a645`, `abaed9ce…b6e2` |
| W3C MSE byte stream formats: ISO BMFF, WebM | Editor's Drafts | `aff68246…0a60`, `bce7c223…cdd5` |
| W3C WebCodecs; AV1 codec registration | EDs of 2026-10-07, 2026-06-08 | `70028a11…5f04`, `2aebcb56…d092` |
| Apple QuickTime File Format | 2001-03-01 | `fbd57904da54174e86df1aca03b3099af45166690f5eb9a59543d8de7c1649a3` |
| MP4RA registries: boxes, brands, codecs, aux-info-types | as fetched | `de64f1fd…3648`, `e1d775cd…0b21`, `25c7b0a6…4952`, `b863f039…b45b` |
| jpeg.org JPEG 2000 overview, workplan | as fetched | `5a1306c8…076f`, `b46b49b2…6fe5` |
| LoC FDD: ISO BMFF, MP4 v2, MJ2, MXF, Matroska | fdd000079, 155, 127, 013, 342 | `e3b0edf6…72f9`, `0f85c7e9…cbc5`, `436e4fbe…10be3`, `709bc67e…e538`, `82c7b9d9…aa5` |
| mkvmerge documentation; MKVToolNix README, COPYING | as fetched | `e8c4ef60…27ed`, `551eac11…db12`, `8177f975…0b880643` |
| GPAC README, COPYING, MP4Box dump options | master | `ab4da107…bbd`, `512d2d21…5779`, `4d44b8fe…c4c7` |
| MediaInfo page, LICENSE | as fetched | `52d77716…c5647`, `a8f0db97…358af` |
| DCMTK COPYRIGHT, README; pydicom LICENSE | master / main, commit not pinned | `6c8ade56…14a0`, `41b90b60…e9b`, `a567a2a7…e7e` |

Not obtainable: ISO/IEC 14496-12 (the ITTF free list is closed), 15444-3 / T.802, 15444-16 and 23001-17 (paywalled).

## Measured (row 160, 2026-10-13)

Measured blind to §1–§8 and §10 (given §9 only; the session saw row 159's one-line queue cell through a `grep` before
any number). Code: [`lab/container-bench`](../../lab/container-bench/README.md); every arm is opened by our parser of
its own index into the server's (offset, length) table (`FrameStore::with_index`), then read by the shipped readers.

**Setup, the same for every arm.** Host: 4 vCPU Xeon @ 2.10 GHz cloud VM, 15 GB, ext4 on virtio (`RWF_NOWAIT`
honoured, `read_ahead_kb` 128), kernel 6.18.44. Payloads from `ingest/coded-frames/ingest.py`: HTJ2K by OpenJPH 0.31.0
(reversible, 5 decompositions, 64² blocks, RPCL); AV1 optimized by aomenc 3.15.1 `good:6` (`pt15_cptac` `--split 3`),
every frame decoded back to its source before it was written. Read path: `TileReader` one slot (`ReadMode::Auto`), a
random permutation of the frames repeated to ≥ 400 asks; `FillReader` whole walks in display order to ≥ 256 MiB.
*Hit* is the page cache through `RWF_NOWAIT`; *forced miss* is `force_pool_reads`. *Cold open* reads through
`O_DIRECT` (past the cache, nothing evicted); *warm open* through the cache. One session on the server's one runtime:
the host never saturated, and nothing here is claimed for concurrent sessions or for a device-bound miss.

**Data** — sound sets only, one per frame size the sound sets offer (none near 16 KiB): `pt15_cptac` (335 frames, the
largest sound series by count; median frame 32 kB HTJ2K / 35 kB AV1), `mr9_ispy2` (34; 41 / 38 kB), `ct_lidc` (100;
163 / 154 kB), `dbt12_ea1141` (29; 503 / 476 kB), `ffdm_b` (2; 2.77 / 2.76 MB).

**Arms.** `sbnd1` (`pack-series`), `sbnd1-aa` (the same, another file: the A/A control), `sbnd2` (28 B entries,
ours), `mp4` (ours: `moov` first, one sample a chunk; `co64` past 4 GiB), `mp4-ff` (FFmpeg 6.1.1 `-movflags
+faststart`, its own chunks), `fmp4-1` / `fmp4-30` (ours, one global `sidx`), `mkv` (ours: Cues first, a cue a frame
with `CueRelativePosition`, `V_MS/VFW/FOURCC`), `mkv-ff` (FFmpeg `-cues_to_front 1`), `dicom` / `dicom-fg` (ours
through pydicom 3.0.1: one fragment a frame, Extended Offset Table, TS .201; `-fg` adds the source's per-frame
attributes), `mxf` (ours: OP1a partitions, frame-wrapped, KAG 1, the index in the footer — **no structural header
metadata**, a layout to time, which FFmpeg refuses to open), `mxf-ff` (FFmpeg, KAG 512 with a system item a frame),
`ivf` (AV1 only, no index). Our arms carry the draft's identity (both UIDs, each frame's coded and samples XXH3-64):
a private `uuid` box (MP4), a `TagBinary` (Matroska), native UIDs and a private block (DICOM), a dark KLV (MXF);
none is a standard field. **AV1 is opaque in every container but the `.sbnd`** (MP4 `sbav`, Matroska FourCC `SBAV`,
a private DICOM TS UID, MXF's picture key); **FFmpeg cannot pack it** — its input must name a codec — so `mp4-ff`,
`mkv-ff` and `mxf-ff` exist for HTJ2K only. mkvmerge, MP4Box and DCMTK were not fetched.

**Exact.** 3 120 timed cells (26 Williams rounds, `lab/scripts/order.py`), 25 324 884 frames read, each XXH3-64-checked
against the encoder's codestream: 0 inexact. Every arm's every frame (12 000) through the fill reader, decoded, against
the digest ingest took from the encoder's input: 0 inexact. Mutations, each caught: `--mutate shift|short` on all 13
arm kinds (238/238 frames flagged each); 17 source mutations of the parsers and packers (`cargo test`); a flipped byte
after the read, both payloads, against the decode check.

### Per-frame read, fill and CPU: a tie everywhere

Paired per round against `sbnd1` (the same series, payload and round), pooled over the 10 series·payload cells. The
resolution is this campaign's A/A drift (p90 of |`sbnd1-aa`/`sbnd1` − 1|): hit latency 30.3 %, forced-miss latency
17.0 %, fill hit 22.8 %, fill miss 17.6 %, CPU/GB hit 23.9 %, miss 14.5 %. A difference counts at ≥ the resolution
and ≥ 80 % sign agreement (`disk-access.md` §2).

| arm | hit latency | miss latency | fill hit | fill miss | CPU/GB hit | CPU/GB miss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `sbnd1-aa` | 1.001 | 1.017 | 1.001 | 0.992 | 1.003 | 1.007 |
| `sbnd2` | 0.887 | 0.985 | 1.100 | 1.038 | 0.913 | 0.960 |
| `mp4` | 0.894 | 0.978 | 1.083 | 1.027 | 0.921 | 0.974 |
| `mp4-ff` | 0.986 | 1.037 | 1.028 | 0.992 | 0.975 | 1.008 |
| `fmp4-1` | 0.893 | 0.995 | 1.138 | 1.052 | 0.876 | 0.956 |
| `fmp4-30` | 0.892 | 0.989 | 1.096 | 1.039 | 0.914 | 0.967 |
| `mkv` | 0.918 | 0.989 | 1.051 | 1.004 | 0.957 | 0.991 |
| `mkv-ff` | 0.884 | 0.984 | 1.123 | 1.017 | 0.887 | 0.978 |
| `dicom` | 0.879 | 0.990 | 1.066 | 1.022 | 0.939 | 0.978 |
| `dicom-fg` | 0.878 | 0.978 | 1.090 | 1.019 | 0.917 | 0.978 |
| `mxf` | 0.918 | 0.980 | 1.106 | 1.039 | 0.906 | 0.963 |
| `mxf-ff` | 0.887 | 0.995 | 1.159 | 1.037 | 0.882 | 0.965 |
| `ivf` | 0.883 | 0.981 | 1.132 | 1.040 | 0.884 | 0.968 |

Median ratio to `sbnd1`; every cell is a **tie** (agreement 50–80 %, all under the resolution). Absolute, `sbnd1`:
hit p50 2.3–5.5 µs at 32–41 kB, 15–17 µs at 160 kB, 26–29 µs at 500 kB, 216–220 µs at 2.8 MB; CPU 0.16–0.18 s per GB
served on hits. The ~11 % that `sbnd1` and `mp4-ff` trail the rest on small-frame hits is the **writer, not the
layout**: `sbnd1` rewritten with 1 MiB writes (`dd`) against `sbnd2` rewritten with 8 KiB writes, 16 interleaved
rounds on `mr9_ispy2` and `pt15_cptac` HTJ2K: hit p50 0.76 / 0.69 of `sbnd1` with 1 MiB writes (81 % / 100 % agree),
1.05 / 1.08 with 8 KiB; fill 1.32 / 1.24 against 1.00 / 0.96. `pack-series` writes through an 8 KiB `BufWriter`. The
mechanism, page-cache folio size, is row 168's theory, measured by row 172: confirmed on ext4, the fix under its
rule's resolution ([`README.md`](README.md) §The writer, §Measured).

### Open, bytes and packing: where the arms part

| arm | reads at open (`pt15`, N = 335) | cold open p50 `pt15` HTJ2K / AV1 [p10–p90] | warm open p50 `pt15` | bytes vs `sbnd2`, worst series | packing `pt15` HTJ2K, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| `sbnd1` | 2 | 168 [108–263] / 142 µs | 5.5 µs | +0.07 % | 10 |
| `sbnd2` | 2 | 161 [99–273] / 136 µs | 4.3 µs | 0 | 20 |
| `mp4` | 1 (64 KiB window) | 159 [117–234] / 172 µs | 16.8 µs | +0.04 % | 18 |
| `mp4-ff` | 1 | 182 [124–290] µs | 16.6 µs | −0.07 %¹ | 73 (no faststart 72) |
| `fmp4-1` | 336 | 13.7 [11.6–16.2] / 14.2 ms | 242 µs | +0.33 % | 18 |
| `fmp4-30` | 13 | 679 [436–894] / 676 µs | 21 µs | +0.05 % | 21 |
| `mkv` | 338 | 13.6 [9.5–17.3] / 14.1 ms | 198 µs | +0.13 % | 20 |
| `mkv-ff` | 671 | 25.9 [20.6–29.3] ms | 339 µs | +0.07 %¹ | 96 (no cues to front 81) |
| `dicom` | 1 | 185 [118–301] / 198 µs | 9.9 µs | +0.10 % | 888 |
| `dicom-fg` | 2 | 311 [196–446] / 261 µs | 14.9 µs | **+1.21 %** | 1 336 |
| `mxf` | 341 | 14.7 [9.9–16.2] / 14.0 ms | 257 µs | +0.09 % | 18 |
| `mxf-ff` | 343 | 14.0 [11.0–18.6] ms | 251 µs | **+2.62 %**¹ | 84 |
| `ivf` | 336 | — / 13.3 [9.2–16.0] ms | 161 µs | −0.05 % | 16 (AV1) |

¹ FFmpeg's files carry no identity (16 B a frame less than ours). Reads scale with N for `fmp4-1`, Matroska, MXF and IVF:
at `ct_lidc` (N = 100) they open cold in 3.9–4.8 ms (`mkv-ff` 8.3), at `ffdm_b` (N = 2) in 0.2–0.4 ms. Cold-open
resolution (A/A p90) is 107 %: one `O_DIRECT` read costs ~40–170 µs on this host. Packing is the process's wall time
from ingest's files, 8 interleaved rounds: ours (Rust) hashes every frame for the identity, `pack-series` does not;
`dicom` is Python with pydicom's import and the source headers read; FFmpeg's ~55 ms is mostly its start-up.

### Round trips through the reference tools (decision rule (d)), all five series

| arm | ours → tool | tool → ours |
| --- | --- | --- |
| MP4, fMP4 F = 1 and 30, Matroska | FFmpeg 6.1.1 `-c copy`: 500/500 exact, both payloads (it copies the opaque AV1 track) | HTJ2K 500/500 (`mp4-ff`, `mkv-ff`, FFmpeg's `frag_every_frame` + `global_sidx`); AV1: FFmpeg cannot pack it |
| MXF | ours refused by FFmpeg (no material package) | HTJ2K `mxf-ff` 500/500; AV1 cannot be packed |
| IVF | FFmpeg parses the payload as AV1 and fails: 0/500 | — |
| DICOM, EOT | pydicom 3.0.1 `generate_frames` with the EOT: 500/500, both payloads | pydicom's `encapsulate_extended`: HTJ2K 241/500, AV1 268/500 — it writes each length padded to even, where PS3.3 C.7.6.3.1.8 says the length excludes the padding (fetched 2026-10-13); every odd frame comes back one byte long |

UIDs travel in a standard field only in DICOM; the two hashes in none; nothing the tools pack carries them.

### Verdict (*proposed*, for the owner and the team): the `.sbnd` stays

| arm | (a) read, fill, CPU | (b) cold open `pt15` ≤ 1 ms | (c) ≤ 1 % of `sbnd2` | (d) round trip, identity |
| --- | --- | --- | --- | --- |
| `sbnd2` | tie | yes | — | (ours) |
| `mp4`, `mp4-ff` | tie | yes | yes | no: AV1 not packable by the tool; identity only in a private box |
| `fmp4-30` | tie | yes | yes | no: the same |
| `fmp4-1`, `mkv`, `mkv-ff`, `mxf`, `mxf-ff`, `ivf` | tie | **no** (13–26 ms) | yes but `mxf-ff` | no |
| `dicom` | tie | yes | yes | no: pydicom's padded lengths; hashes only in a private block |
| `dicom-fg` | tie | yes | **no** (+1.2 %) | no |

No container meets all four, so **the `.sbnd` stays** as the stored form, and no arm meets (d) even for HTJ2K alone, so
**no export format is proposed by the rule**. Nearest: DICOM with an Extended Offset Table and no per-frame groups
passes (a)–(c) and round-trips both payloads into the reference tool exactly; it misses (d) on the tool's own packing
(a deviation in pydicom 3.0.1, not in the format) and on the hashes, which DICOM has no field for. Progressive MP4
passes (a)–(c) with HTJ2K exact both ways through FFmpeg, and misses on the identity. `.sbnd` v2 ties v1 on every
metric and is 0.006–0.07 % smaller. Not measured: concurrent sessions, a device-bound miss, a frame near 16 KiB, a
series with thousands of frames (the N-read opens would grow past 14 ms), DCMTK, MP4Box and mkvmerge.

### §9's predictions, against the numbers

* **Read latency, fill and CPU tie for arms 2–7 at 16 KiB and above** — held at 32 kB–2.8 MB, both payloads, hit and
  forced miss. FFmpeg's MXF fill −6 % at 16 KiB: not testable (no sound series near 16 KiB; at 32–41 kB it ties,
  and −6 % is under this host's 17–23 % resolution).
* **Open: arms 1–3 within a few reads** — held: 2, 2 and 1 reads; cold 159–182 µs against 168.
* **Arm 6 grows with its per-frame metadata** — held: the source's groups take `pt15`'s open from 1 read to 2 and its
  cold p50 from 185 to 311 µs; at 29–100 frames the groups still fit the first 64 KiB read.
* **Arms 4 (F = 1), 5 and 7 grow with N** — held: one read a frame (FFmpeg's Matroska two), 13.6–25.9 ms cold at
  N = 335. F = 30 grows by N / 30 (13 reads, 0.68 ms).
* **Arm 8 slowest** — not held: IVF's chained reads (13.3 ms cold, 161 µs warm) are no slower than the indexed
  containers that still read a header a frame; FFmpeg's Matroska is slowest (a cluster a frame: 671 reads).
* **Bytes within 0.3 % except as §4 says** — held: FFmpeg's MXF measured 844–1 050 B a frame against §4's 847–1 039
  (+2.5–2.6 % at 32–41 kB), our one-frame fragments 130–156 B against FFmpeg's 183 (+0.30–0.33 %); everything else
  ≤ 0.13 %. Not in §4: the source's per-frame groups cost DICOM ~400 B a frame (+1.1–1.2 % at 32–41 kB).
* **FFmpeg's faststart or `cues_to_front` cost about one extra copy** — not seen at these sizes: +1 % and +2–18 % of
  wall time, within FFmpeg's start-up and the page cache; not conclusive.
