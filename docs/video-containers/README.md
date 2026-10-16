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

## Goals

What the comparison is for, in order; every row below answers one of them.

1. **Understand the landscape**: what each container is, and what it would cost or buy us.
2. **Decide whether a container would change serving.** The prediction is no ([What this map says](#what-this-map-says)).
3. **Decide what to export for interoperability and tooling**: DICOM for HTJ2K, an MP4 view for AV1.
4. **Decide whether hardware decode on the client is worth a device measurement**
   ([`hardware-decode.md`](hardware-decode.md) §8).

## The candidates by goal

**Carries our data** comes first: a "no" ends the comparison for that codec. **Latency** and **throughput** are split
into what differs (open time; bytes per frame) and what every candidate shares (one lookup and one read per frame,
predicted). Numbers marked *measured* come from [`guide.md`](guide.md) §4.

| goal | `.sbnd` | MP4 (faststart) | fragmented MP4 | Matroska / WebM | DICOM multi-frame | MXF |
| --- | --- | --- | --- | --- | --- | --- |
| **carries AV1** | yes | yes, `av01` | yes | yes, `V_AV1` | **no transfer syntax** | **no mapping** |
| **carries HTJ2K** | yes | a mapping exists, nothing plays it | — | a draft, framing undefined | **yes, native** | **yes, ST 422:2022** |
| **carries 12-bit grey** | yes | in AV1's Professional profile | yes | yes | HTJ2K yes; the video syntaxes no | JPEG 2000 to 16-bit |
| **latency: open** | one read | one read of `moov` from byte 0 | a walk, or `mfra` from the end | the Cues, then each block's length: a read per frame or a walk | the whole header, in tag order | tail, footer index, header: three reads or more |
| **latency: per frame** | one lookup, one read | the same, predicted | the same | the same | the same | the same |
| **throughput: container bytes per frame** (measured) | 12 | 4 | 131 | 36–42 | ≈ 24.5 | ≈ 23 (OP-Atom), ≈ 820 (OP1a) |
| **client: a browser demuxes it** | our code | the video element | MSE | WebM everywhere; `.mkv` new in Chrome and Firefox | a JS library | nothing |
| **tools and interop** | ours only | ffprobe, MP4Box, every player | the same, DASH and HLS | ffprobe, MKVToolNix | **PACS, DICOMweb, OHIF**, validators | broadcast and cinema tools |
| **cost to adopt** | — | the current ISO text is sold; open implementations; Rust crates young | the same | free text; one solid Rust demuxer | free text; no Rust reader uses its offset table | free text; no Rust or browser reader |

Decoding is the codec's business, not the container's, so it has its own table:

| decode in a browser | AV1 | HTJ2K |
| --- | --- | --- |
| WebCodecs | Chrome: 10-bit grey bit-exact through `copyTo` (measured, 160 of 160); 12-bit refused before decoding, measured on the AV1 branches. Firefox: the product's probes failed every grey layout. Safari: only with AV1 hardware, which is Main profile (8/10-bit, inferred) | not offered |
| video element | Chrome decodes 10- and 12-bit grey in software, then hands back 8-bit RGB (measured: 483 grey levels to 187); Firefox skips monochrome pictures | not offered |
| WASM | dav1d builds exist, little maintained | OpenJPH (`@cornerstonejs/codec-openjph`), what DICOM viewers use |
| hardware | Chrome refuses monochrome; no 10-bit hardware read-back | none |

Sources: [`hardware-decode.md`](hardware-decode.md) §4, §5, §7.

## Tools by operation

| operation | MP4 / fragmented MP4 | Matroska / WebM | DICOM | MXF |
| --- | --- | --- | --- | --- |
| **inspect** (dump the structure) | ffprobe (frames, not boxes); **MP4Box** `-info`, `-diso`; Bento4 `mp4dump`; ComplianceWarden, in the browser too | **mkvinfo** `-v -v`; ffprobe; MediaInfo | **dcmdump** (DCMTK); dciodvfy, dcdump; gdcmdump; pydicom | **mxf2raw**, bmxparse (bmx); MXFDump; asdcp-info; ffprobe |
| **write** (pack frames) | ffmpeg `-c copy` (`+faststart`; fragments); MP4Box; Bento4; Mediabunny in the browser | **mkvmerge**; ffmpeg (`-cues_to_front 1`); libwebm; Mediabunny | **pydicom `encapsulate_extended`**; gdcmimg (codestreams as they are); highdicom, dcmqi for segmentations | raw2bmx (JPEG 2000); asdcp-wrap; ffmpeg (`mxf`, `mxf_opatom`) |
| **read from Rust** | `mp4-atom`, `re_mp4` (active); `mp4` (no release since 2023); `mp4parse` (Firefox's) | **`matroska-demuxer`** (reads CueRelativePosition); `webm-iterable` | `dicom-rs` (does not look frames up through the Extended Offset Table) | **none mature**: C or C++ through FFI (bmx, asdcplib, libavformat) |
| **read in a browser** (demuxers) | **mp4box.js** (GPAC); Mediabunny; web-demuxer (ffmpeg in WASM); hls.js, dash.js, shaka-player for MSE | Mediabunny; ts-ebml (an element parser); web-demuxer | **dcmjs**; dicom-parser (no release since 2023); Cornerstone's dicom-image-loader, which also decodes | none mature (mxf.js 0.1.0, 2026, untried) |
| **validate** | ComplianceWarden (AV1 in ISOBMFF yes, CMAF no); MPEG's conformance files | mkvalidator (no release since 2021); MediaConch | **dciodvfy**; dicom-validator | bmx's tools; Netflix Photon for IMF |

`.sbnd`: `pack-study` writes it, the server refuses a malformed one at open, and nothing outside wt-pacs reads it.
Versions and licences, read 2026-10-16, are in each container's page.

## The browser, per container

| | MP4 | fragmented MP4 | Matroska | WebM | DICOM | MXF |
| --- | --- | --- | --- | --- | --- | --- |
| video element | Chrome, Firefox; Safari plays AV1 only with AV1 hardware | — | Chrome (Chromium commit of 2025-12-11, first release around 145, inferred); Firefox 145; Safari: none found | Chrome, Firefox, Safari (iOS since 17.4) | no | no |
| Media Source Extensions | no: a flat MP4 cannot be appended | all three; on iPhone only through ManagedMediaSource (17.1) | Firefox: an open bug; the others not verified | all three | no | no |
| several tracks switchable | Safari only; Chrome and Firefox behind flags | Safari only | Safari only | Safari only | — | — |
| captions inside the file shown | Chrome: none; Safari's MSE: `wvtt` only | the same | Chrome: none | Chrome: none; Firefox: a bug open since 2015 | — | — |

## Caveats

**MP4**
* ffmpeg writes the index (`moov`) at the end by default; `+faststart` moves it to the front in a second pass.
* ffmpeg puts every frame in one chunk, so the frame table is a running sum computed at open ([`guide.md`](guide.md) §5).
* 12-bit AV1 is the Professional profile, which almost no fixed-function decoder handles (AMD's VCN 4 and 5, 4:2:0
  only, are the exceptions found; [`hardware-decode.md`](hardware-decode.md) §3, §6).
* A flat MP4 plays in the video element but cannot be appended to MSE; that takes fragments.

**Fragmented MP4**
* No global frame table: a reader walks the `moof`s or reads `mfra`, which points at fragments, not frames.
* 131 B per frame when every frame is its own fragment.

**Matroska / WebM**
* The Cues give a frame's position, never its length: the length is in each block's header.
* FFmpeg writes the in-cluster position (CueRelativePosition) and its own demuxer ignores it ([`matroska.md`](matroska.md)).
* `.mkv` in the video element is new and partial; WebM plays everywhere. AV1 with alpha is not specified.

**DICOM**
* No AV1 transfer syntax: AV1 frames would be non-standard DICOM.
* No browser parses it or decodes JPEG 2000 natively (Safari dropped JPEG 2000 in 18.0): a JS parser and a WASM
  HTJ2K decoder are needed, which is what OHIF and Cornerstone ship.
* The offset table counts from the first item after the empty Basic Offset Table, not from byte 0, and pydicom
  writes padded lengths against the standard ([`guide.md`](guide.md) §7).
* FFmpeg has no DICOM demuxer; what ffprobe prints for a DICOM file depends on the bytes it happens to find.

**MXF**
* No AV1 mapping; HTJ2K is mapped (ST 422:2022).
* FFmpeg's OP-Atom puts every frame in one KLV; its OP1a adds ≈ 820 B per frame of alignment and system items.
* No mature Rust or browser reader.

**The video element, whatever the container**
* It decodes, and in Chrome even 12-bit grey, but hands back 8-bit RGB: fine for an 8-bit cine, never for
  window/level ([`hardware-decode.md`](hardware-decode.md) §4).
* Annotations drawn over it follow `requestVideoFrameCallback`, which can fire one display refresh late; drawn into
  the canvas that receives a WebCodecs frame, they are locked to the frame.

## What reading and implementing each costs

What is sold is the official text, never the right to implement; patents are a separate question, declared by their
holders under the ISO/IEC/ITU common patent policy (https://www.iso.org/iso-standards-and-patents.html).

* **MP4**: ISO/IEC 14496-12, 8th edition, 2026 (https://www.iso.org/standard/85596.html); IEC sells the 2022
  edition at CHF 67. Older editions were free, and what an AV1 writer needs beyond the boxes is free (the AOM binding,
  MP4RA, MPEG's conformance files). A 2003 patent pool covered MP4 packaging; whether it still holds live patents was
  not found. Details and sources: [`iso-bmff.md`](iso-bmff.md) §8.
* **Matroska**: RFC 9559, free (https://www.rfc-editor.org/rfc/rfc9559.html); usable "without paying any license or
  patents" (https://www.matroska.org/legal.html).
* **DICOM**: "No license is required to download or implement the DICOM Standard"
  (https://www.dicomstandard.org/patent).
* **MXF**: every SMPTE standard free to read since 2026-06-17 ([`mxf.md`](mxf.md) §7).

## Reference table: how each one finds frame i

The first table of this page, kept as it was: the mechanism behind the rows above.


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
| standard text | ours | ISO, paid for the current text; older editions were free; the AV1 binding is free ([`iso-bmff.md`](iso-bmff.md) §8) | the same | IETF RFC, free | NEMA, free | SMPTE, free since June 2026 |

## What this map says

**On serving, nothing beats `.sbnd`, and three can tie.** Every container here keeps a frame's bytes in one piece.
MP4 written with its index in front and one sample per chunk *is* our table in another syntax; DICOM's Extended
Offset Table is the same table at a variable place; MXF and Matroska get there after more work at open. The prediction
for a measurement: **a tie on serving, differences only at open** (Matroska's lengths, DICOM's header, MXF's partition
map) **and at ingest**. Every format built for random access to independent units converges on this table (TIFF,
Cloud Optimized GeoTIFF, Zarr's sharding, [`others.md`](others.md) §3); that `.sbnd` already looks like them is the
strongest argument that it is not a home-made oddity.

What the prediction rests on (none of it timed):

1. **The server never reads the container while serving.** `FrameStore::open` loads the frame table once into a list
   of (offset, length), and a frame is one lookup in that list and one read
   (`server/src/media/frame_store.rs`, `server/src/media/read_path.rs`). Any container that yields that list at open
   feeds the same code.
2. **Every candidate stores a frame's bytes in one piece**: checked on every frame of every sample file
   ([`guide.md`](guide.md) §4).
3. **Every candidate can yield the list at open**: MP4 from `stco` and `stsz`, DICOM from its Extended Offset Table,
   MXF from its index table, Matroska from its Cues plus a read of each block's length.
4. **The container's bytes per frame are small**: 4 to 131 B on 4.5 KB frames, under 3 %; MXF's OP1a is the
   exception at ≈ 820 B on 16 KB frames, about 5 %.
5. **Formats built for random access converge on the same table** (above).

Two doubts raised in review and withdrawn: frame alignment (no candidate aligns frames to the 4 KiB page, `.sbnd`
included, so each touches the same pages on average; MXF's 512 B grid is not a page) and index memory (every
container ends as the same 12 B per frame in the server's memory).

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
