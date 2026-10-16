# Video containers: what there is, and what it could do for wt-pacs

*The theory phase, 2026-10-14. Mapped from specifications, vendor documents and the engines' source, with small
hands-on checks where they help understanding; nothing here is timed. Every claim is sourced in the page that owns
it, and what is predicted rather than measured says so.*

The team asked whether standard video containers (MKV, MP4, and with them ffmpeg) could replace or complement our
own packing. This folder maps the candidates first, so that a decision, and any measurement, starts from what each one
actually is.

## Reading order

| page | what it answers |
| --- | --- |
| [`guide.md`](guide.md) | hands-on: the same frames in six containers, ffprobe, box and element walks, DICOM's offset table, and the browser |
| [`iso-bmff.md`](iso-bmff.md) | MP4, fragmented MP4, CMAF, HEIF and AVIF |
| [`matroska.md`](matroska.md) | Matroska and WebM |
| [`dicom.md`](dicom.md) | DICOM multi-frame, its offset tables, transfer syntaxes and DICOMweb |
| [`mxf.md`](mxf.md) | MXF, broadcast and cinema's container |
| [`others.md`](others.md) | TS, IVF, raw AV1, Ogg, AVI and the rest; and TIFF, COG and Zarr, which already look like ours |
| [`hardware-decode.md`](hardware-decode.md) | hardware decode, in the browser and natively, and what samples come back |

## Three layers, and the one property

A **codec** (AV1, HTJ2K) turns samples into a bitstream; a **container** stores coded frames with an index and
metadata, never changing a frame's bytes; a **transport** moves bytes. A decoder, hardware or not, only ever sees the
codec layer.

Our server asks one thing of a store: **for frame i, an offset and a length, and the frame's bytes in one piece**,
so that serving is one lookup and one read. `.sbnd` keeps that as a table of 12 bytes per frame after a fixed header
([`../FIXTURES.md`](../FIXTURES.md) §SBND).

## The candidates side by side

| | `.sbnd` | MP4 (faststart) | fragmented MP4 | Matroska / WebM | DICOM multi-frame | MXF (OP-Atom) |
| --- | --- | --- | --- | --- | --- | --- |
| frame i's offset | table | `stco` (+ `stsc`) | per fragment (`sidx`) | Cues (one per keyframe, so per frame here) | Extended Offset Table | index table |
| frame i's length | table | `stsz` | `trun` | **in each block's header** | Extended Offset Table | next offset, or the KLV length |
| frame bytes contiguous | yes | yes | yes | yes (no lacing) | yes (one fragment per frame) | yes |
| work at open | one read | a box tree; a prefix sum unless one sample per chunk | a walk or `sidx` | Cues, then a read per block or a walk | **the whole header** (no pointer to the pixels) | tail, header, every partition, the index |
| container bytes per frame (measured, [`guide.md`](guide.md) §4) | 12 | 4–12 | 131 | 36–42 | ≈ 24.5 | ≈ 23 as FFmpeg writes OP-Atom (clip-wrapped); ≈ 820 for its OP1a (first estimated ≈ 31 from the structure, [`mxf.md`](mxf.md) §6) |
| AV1 | ours | `av01`, the defining binding | the same | `V_AV1` | **no transfer syntax** | **no mapping** |
| HTJ2K | ours | MJ2 or 15444-16, no HTJ2K brand, plays nowhere | — | `V_JPEG2000`, a draft, framing undefined | **native**, `.4.201`–`.4.203` | **ST 422:2022** |
| 12-bit grey | yes | in the stream (AV1 Professional) | yes | yes | HTJ2K to 38 bits; **video syntaxes stop at 10-bit 4:2:0 YBR** | JPEG 2000 to 16 |
| browser can demux it | — | video element | MSE | video element, MSE (WebM) | no | no |
| tools | ours | ffprobe, MP4Box, Bento4 | the same | ffprobe, MKVToolNix | pydicom, DCMTK, dciodvfy | bmx, asdcplib, ffprobe |
| standard text | ours | ISO, paid | ISO, paid | IETF RFC, free | NEMA, free | SMPTE, free since June 2026 |

## What this map says

**On serving, nothing beats `.sbnd`, and three can tie.** Every container here keeps a frame's bytes in one piece.
MP4 written with its index in front and one sample per chunk *is* our table in another syntax; DICOM's Extended
Offset Table is the same table at a variable place; MXF and Matroska get there after more work at open. The prediction
for a measurement: **a tie on serving, differences only at open** (Matroska's lengths, DICOM's header, MXF's partition
map) **and at ingest**. Every format built for random access to independent units converges on this table (TIFF,
Cloud Optimized GeoTIFF, Zarr's sharding, [`others.md`](others.md) §3); that `.sbnd` already looks like them is the
strongest argument that it is not a home-made oddity.

**Where the standard formats win is everything around the server:**

* **DICOM is the real opportunity, for HTJ2K.** Our HTJ2K codestreams are already bare and one per frame, which is
  exactly what `.4.201`/`.4.202` with an Extended Offset Table store. An export to (or import from) DICOM multi-frame is
  mechanical, and buys PACS interchange, DICOMweb `/frames` with `image/jphc`, OHIF and Cornerstone, validators and
  self-identifying objects ([`dicom.md`](dicom.md) §10).
* **MP4 is AV1's natural standard home**: an `av01` sample is byte for byte a WebCodecs chunk, and every tool reads it.
  An MP4 view of an AV1 series would give ffprobe and players access without changing how we serve
  ([`iso-bmff.md`](iso-bmff.md) §9).
* **MXF** is the broadcast and cinema counterpart of DICOM for HTJ2K, worth knowing as an export, not as a store.
* **Tooling (ffprobe, inspection) is the team's best argument**, and it can be had without changing the store: ffprobe
  reads MP4, Matroska and IVF but not DICOM (it misreads it) and not `.sbnd`.

**What a standard container would cost us** is what makes our payload ours: the AV1 16-byte header (depth, split,
offset), the top-and-low split, per-frame digests and DICOM UIDs all need a home in each format (sample auxiliary data
or two tracks in MP4, BlockAdditions or two tracks in Matroska, attributes in DICOM), and AV1 has none at all in DICOM
or MXF. AVIF's new Sample Transform item standardises our split, but for still images only.

**Hardware decode is not a container feature** ([`hardware-decode.md`](hardware-decode.md)). It is reachable from our
own frame table through WebCodecs or the native APIs. Today it is blocked for our streams in Chrome by policy
(monochrome refused, no 10-bit read-back), and nobody documents whether a GPU decodes lossless AV1 exactly. One route
is worth measuring: lossless 8-bit 4:2:0 with constant chroma, split 8 + 8, checked by the frame digest. The video
element, the path that "video containers" usually imply, returns 8-bit RGB pictures, not samples: fine for an 8-bit
cine, never for window/level.

**Dead ends**: MPEG-TS (no index, frames cut into 188-byte packets, AV1 escaped), DICOM's video transfer syntaxes (no
monochrome, no 12-bit, no per-frame index), ffmpeg on the serving path (fine at ingest), and the video element for
diagnostic frames.

**Worth borrowing**, whatever is decided: DICOM HTJ2K's RPCL layout (a byte prefix of a frame is a lower resolution), the
Cloud Optimized GeoTIFF rule of one read for the whole header, CMAF-over-MoQ (an IETF draft mapping fMP4 chunks onto
QUIC objects) as the standard neighbour of what we do over WebTransport.

## The local session's analysis, checked

Darian shared an earlier local analysis as context, not as fact. Each of its claims against the sources:

| claim | verdict |
| --- | --- |
| MP4 has per-frame size and offset tables, our index in another syntax; serving cost about equal | **holds** exactly with one sample per chunk, otherwise after a prefix sum at open; "about equal" is predicted, not measured |
| Matroska's Cues are usually per keyframe or per cluster, sizes in block headers, parse at open | **holds**, and is sharper for us: all-intra makes the Cues per frame, so only the lengths cost |
| DICOM multi-frame with an Extended Offset Table gives per-frame offsets and lengths; HTJ2K has DICOM syntaxes | **holds**; add that the table requires one fragment per frame (HTJ2K mandates it), and that DICOM's video syntaxes cannot carry our data |
| HTJ2K in MP4 or MKV is at best uncommon | **holds**: MJ2 and 15444-16 exist with no HTJ2K brand; Matroska's `V_JPEG2000` is a draft with undefined framing; nothing plays either |
| ffmpeg must stay off the hot path; harmless at ingest | agreed; nothing found against it |
| WebCodecs decodes AV1 with hardware where available, and keeps the raw planes | **partly**: for our monochrome streams Chrome refuses the hardware path, and reads back no 10-bit hardware frame |
| the video element is an 8- and 10-bit pipeline with colour conversion, no exact samples | **holds**, and measured: 8-bit RGBA out, 483 levels to 187 |
| Chromium refused 12-bit | **holds**: libgav1's parser, built for 10 bits, refuses the key chunk (measured on the AV1 branches) |
| native decoders return raw planes, not at every depth, and lossless support varies | **partly**: raw planes yes; lossless is documented by no vendor, so "varies" is not known; monochrome is the bigger gap |

## For the next phase

If the team wants numbers, the local analysis's measurement holds with two changes. Its arms: `.sbnd`, MP4
(faststart, one sample per chunk), Matroska (Cues in front) and DICOM with an Extended Offset Table, the same frames,
our read path, interleaved; its metrics: time to open, bytes on disk, per-frame read latency, server CPU per GB, ingest
time. The changes: **open time is where the prediction says they differ**, so it needs series of real size (thousands
of frames, enhanced DICOM headers with per-frame groups), and the decision rule should be agreed before the run. The
hardware questions are a separate measurement on real GPUs and a phone ([`hardware-decode.md`](hardware-decode.md) §8).

Decisions this map puts to the team:

1. Is DICOM export of HTJ2K series (and of AV1 series as HTJ2K) wanted? It is the clearest interoperability gain.
2. Is ffprobe access to an AV1 series worth an MP4 view of it, without changing the store?
3. Is the 8-bit 4:2:0 hardware route worth a device measurement?
