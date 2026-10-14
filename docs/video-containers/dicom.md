# DICOM as a container

*Theory, 2026-10-14, read from the DICOM standard (current edition, 2026) and the toolkits' documentation and
source (§10); the Extended Offset Table read back on a real file in [`guide.md`](guide.md) §7. The per-tag rows of
the data dictionary (PS3.6) could not be read; where a value representation is quoted from elsewhere, it says so.*

## Contents

1. [In one paragraph](#1-in-one-paragraph)
2. [Encapsulated pixel data](#2-encapsulated-pixel-data)
3. [Finding frame i](#3-finding-frame-i)
4. [Multi-frame objects and their headers](#4-multi-frame-objects-and-their-headers)
5. [Transfer syntaxes: the codecs DICOM carries](#5-transfer-syntaxes-the-codecs-dicom-carries)
6. [DICOMweb: frames over HTTP](#6-dicomweb-frames-over-http)
7. [Viewers](#7-viewers)
8. [Throughput and latency](#8-throughput-and-latency)
9. [Tools](#9-tools)
10. [For wt-pacs](#10-for-wt-pacs)
11. [Sources](#11-sources)

## 1. In one paragraph

A DICOM file is a header of tagged attributes (patient, study, series, geometry, the transfer syntax) followed, last
or nearly last, by **Pixel Data (7FE0,0010)**. A compressed image's pixel data is **encapsulated**: a sequence of
items, each one **fragment** of coded data, with a frame-to-fragment rule set per **transfer syntax** (the UID that
names the codec). A **multi-frame** object holds all of a series' frames, a whole cine or a tomosynthesis stack, in
one file, and since 2019 can carry an **Extended Offset Table** that gives every frame's 64-bit offset and exact
length. It is the medical standard: every PACS, viewer and validator speaks it, and HTJ2K is one of its codecs.

## 2. Encapsulated pixel data

```text
(7FE0,0010) OB, undefined length        12-byte element header (explicit VR little endian)
  (FFFE,E000) length L0  [L0/4 × u32]   item 0: the Basic Offset Table, possibly empty
  (FFFE,E000) length L1  fragment       item 1
  (FFFE,E000) length L2  fragment       …
  (FFFE,E0DD) length 0                  sequence delimiter
```

* **Every item is an 8-byte header** (tag, length; no VR) and an even-length value, padded with one byte when the
  data is odd.
* **A fragment holds data of one frame only, but a frame may span several fragments**, unless its transfer syntax
  forbids it. HTJ2K, JPEG XL, Encapsulated Uncompressed and Deflated Image Frame require **exactly one fragment per
  frame**; JPEG and JPEG 2000 Part 1 allow several.
* A reader must walk item lengths, never scan for the delimiter's bytes, which can occur inside coded data.

**The Basic Offset Table**, the first item, holds 32-bit offsets of each frame's first fragment, **no lengths**, and
may be empty. 32 bits cap the addressable pixel data near 4 GiB, which is the problem the next table solves.

**The Extended Offset Table** (7FE0,0001) and **its Lengths** (7FE0,0002), added by CP-1818 (Final Text January
2019, with CP-1819's 64-bit VR, OV per the DCMTK ticket) and clarified by CP-2362 (2024) and CP-2388:

* one 64-bit offset and one 64-bit length per frame;
* allowed only when the Basic Offset Table item is empty and **each frame is exactly one fragment**;
* offsets point at the frame's item tag, counted from the first item after the empty Basic Offset Table;
* lengths "may be an odd number" and do "not include any trailing padding": the exact codestream length
  (PS3.3 C.7.6.3.1.8). **pydicom 3.0.2 writes the padded length instead**, one byte long for odd frames
  ([`guide.md`](guide.md) §7).

## 3. Finding frame i

With the Extended Offset Table, after the header is parsed:

```text
P     = the first byte after Pixel Data's element header       (the empty Basic Offset Table item starts here)
frame = P + 8 + offset[i] + 8                                    (skip the empty table item, then the frame's item header)
bytes = length[i]
```

**One lookup and one read**, exactly `.sbnd`'s shape; the guide's file read 16 of 16 frames back exactly. Without
it: a populated Basic Offset Table gives the start and the item header gives the length (two small reads or one
over-read); an empty one means walking every item header once; and with more fragments than frames, the boundaries
are ambiguous without parsing the codestream.

**The cost is at open.** DICOM has **no pointer to the start of Pixel Data** (CP-2388 lists adding one as an open
issue), and attributes come in tag order, so a reader walks the whole header to reach it, the Extended Offset
Table included (it sorts just before Pixel Data). A writer must know every frame's length before writing the pixels,
or back-patch fixed-size values; appending a frame rewrites the header region. Uncompressed pixel data needs no
table: frame i is at a fixed stride.

## 4. Multi-frame objects and their headers

* **Enhanced objects** (Enhanced CT, MR, XA; Breast Tomosynthesis; and others) describe frames with **functional
  groups**: a Shared Functional Groups Sequence (one item) and a **Per-Frame Functional Groups Sequence with one item
  per frame** (position, orientation, timing, window, rescale…), stored before the pixels. Its size is what makes the
  header large: a few hundred bytes to a few KB per frame is the research notes' estimate, not measured, so 10 000
  frames could put megabytes between the start of the file and the frame table. Moving constant groups into the
  shared sequence is the lever.
* **Simpler multi-frame objects**: Multi-frame Grayscale Word Secondary Capture (MONOCHROME2, 16 bits allocated,
  9–16 stored) is the generic container for 10–16-bit grey frames; Ultrasound Multi-frame and the three Video
  storage classes (endoscopic, microscopic, photographic) use cine timing instead of functional groups.
* **Concatenations** split one multi-frame image across several instances (Concatenation UID, frame offset
  numbers), each with its own Extended Offset Table: DICOM's sharding.
* **Whole-slide imaging is the precedent for us.** A `TILED_FULL` pyramid level is a multi-frame object whose frame
  i is a tile at a computed position, often tens of thousands of frames, with no per-frame groups needed; viewers
  fetch tiles one at a time through DICOMweb `/frames`. Large tile counts are why 32-bit offsets stopped being
  enough.

## 5. Transfer syntaxes: the codecs DICOM carries

Still-image codecs, one frame per fragment (or more for JPEG and JPEG 2000 Part 1):

| family | UIDs (1.2.840.10008.1.2.…) | grey depth |
| --- | --- | --- |
| **HTJ2K** (Supplement 235, Final Text 2023-11-14) | `.4.201` lossless; `.4.202` lossless, RPCL with TLM markers; `.4.203` lossless or lossy; `.4.204`/`.4.205` via JPIP | MONOCHROME1/2, **1–38 bits stored, signed allowed** |
| JPEG 2000 | `.4.90` lossless, `.4.91`, `.4.92`/`.4.93` (Part 2) | to 16 bits |
| JPEG-LS | `.4.80`, `.4.81` | to 16 bits |
| JPEG lossless | `.4.57`, `.4.70` | 1–16 bits, signed allowed |
| JPEG XL | `.4.110`, `.4.111`, `.4.112` | — |
| Deflated Image Frame (Sup 244) | `.8.1`, Deflate per frame | any |
| Encapsulated Uncompressed | `.1.98` | any |

HTJ2K's `.4.202` exists for progressive display: RPCL order, enough resolution levels that the smallest is at most
64 pixels across, and TLM markers so a reader can find resolution breakpoints in a prefix of the frame's bytes.
The codestream is stored bare: "the optional JP2 file format header shall NOT be included", the DICOM attributes
playing its role. Our `.sbnd` HTJ2K frames are already that.

**The video syntaxes do not fit our frames:**

* MPEG-2 (`.4.100`, `.4.101`), H.264 (`.4.102`–`.4.106`), HEVC Main (`.4.107`) and **Main 10 (`.4.108`)**, plus the
  "fragmentable" `.1` variants (Supplement 225, 2022) for streams over 4 GiB.
* **The stored bytes are a whole MPEG-TS or MP4 file** ("the container format for the video bit stream shall be
  MPEG-2 Transport Stream … or … MP4"), in one fragment or split at arbitrary byte boundaries. Fragments are not
  frames, so the Extended Offset Table cannot apply; frame i is found through the inner container's index and
  decoded from the preceding key picture.
* **Every one is 3-sample YBR_PARTIAL_420**: at most 10 bits (HEVC Main 10), **no MONOCHROME2, no 12-bit, no signed
  data**. A grey 12-bit series cannot go into a DICOM video syntax losslessly.

**AV1 has no transfer syntax.** It is absent from the 2026 UID registry and from the DICOM work items; the WG-04
(compression) page says "No new work items proposed" and that the group "continues to track developments in video
and still frame compression". No supplement in progress was found as of October 2026 (an unpublished agenda could
be missed). An AV1 frame could only travel in DICOM under a **private** transfer syntax UID, which no other system
negotiates.

## 6. DICOMweb: frames over HTTP

* **Frame retrieval** (PS3.18 §10.4): `GET /studies/{s}/series/{r}/instances/{i}/frames/{list}`, the list
  comma-separated, answered as **`multipart/related`, one part per frame**, each with its own content type. HTJ2K's
  media type is **`image/jphc`** (default for `.4.201`); `image/jph` (the boxed file format) is used only for rendered
  output. Uncompressed frames are `application/octet-stream`. `/frames/{list}/rendered` returns a picture (JPEG, PNG,
  `image/jph`, JPEG XL; multi-frame as GIF or JPEG XL; video as MP4 or H.265).
* **Video retrieval** returns the whole stream as one `video/mp4`, `video/mpeg` or `video/H265` part: "all Frames of
  an MPEG-4 video will be encoded as a single video/mp4" representation.
* A server typically indexes each instance's pixel-data start and frame table at ingest and answers `/frames/n` with
  a read of that fragment, wrapped in a multipart part. That is the same work as ours, with HTTP and multipart
  framing in place of WebTransport envelopes.
* **JPIP** (`.4.94`, `.4.95`, and HTJ2K's `.4.204`, `.4.205`) leaves Pixel Data out and points to a JPIP server that
  streams resolutions and regions on demand: a standard precedent for "header in DICOM, pixels over a separate
  streaming protocol", which is what wt-pacs does over WebTransport.

## 7. Viewers

* **Cornerstone3D (OHIF) plays DICOM video through a `<video>` element**: its `VideoViewport` sets the element's
  source to the instance's rendered MP4 URL, maps frame numbers to time as (frame − 1)/fps with 30 fps by default,
  and reads pixels for its tools with `drawImage` and `getImageData`. That is hardware decode where available, and
  8-bit RGBA pixels, the limit the guide measured ([`guide.md`](guide.md) §8, [`hardware-decode.md`](hardware-decode.md)).
  Its documentation asks the server for byte ranges and fast-start MP4.
* **Still multi-frame** goes through its image loader, one `/frames/n` request per frame, **HTJ2K decoded by
  OpenJPH compiled to WebAssembly** (`@cornerstonejs/codec-openjph`, with reduced-resolution decode). Progressive
  HTJ2K needs a server that honours HTTP ranges and the RPCL layout; on a 3036×3036, 11.1 MB test image its first view
  needed about 1/16 to 1/10 of the bytes (their documentation's figure).
* No GPU HTJ2K decode path was found in Cornerstone.

## 8. Throughput and latency

* **Extended Offset Table, one fragment per frame**: offset and exact length per frame, no codestream parse.
  HTJ2K requires one fragment per frame anyway, so an HTJ2K multi-frame object always qualifies.
* **Parse the header once and cache** the pixel-data offset and the table; never reparse per request.
* **Keep the header small**: constant functional groups in the shared sequence, `TILED_FULL`-style implicit
  positions where they apply, explicit-length sequences so a reader can skip them in one seek.
* **Per frame**: an 8-byte item header, at most one pad byte, 16 bytes of table: about 0.02 % of a 100 KB frame.
* **Progressive HTJ2K** (`.4.202`): a byte prefix of a frame is a lower resolution, servable without transcoding.

## 9. Tools

* **pydicom**: `encapsulate_extended(frames)` returns pixel data, offsets and lengths; `get_frame(..., extended_offsets=...)`
  reads by the table; `generate_fragments`, `parse_basic_offsets`. The guide's `dicom_eot.py` uses it.
* **DCMTK** `dcmdump` (`+P 7fe0,0001 +P 7fe0,0002` to print the tables, `+W dir` to write pixel data out). DCMTK's
  ticket for Extended Offset Table support in its codecs is still open.
* **dicom3tools** `dciodvfy` validates an object against its IOD (`-verbose` shows byte offsets).
* **GDCM** `gdcmdump`, `gdcminfo`.
* **dicom-rs** 0.10 exposes the Basic Offset Table only; `read_until(PIXEL_DATA)` reads a header without pixels.
* **ffprobe does not read DICOM**; it misreads it as a raw JPEG 2000 stream ([`guide.md`](guide.md) §3).

## 10. For wt-pacs

* **`.sbnd`'s frame table is an Extended Offset Table kept at a fixed place.** DICOM multi-frame with HTJ2K has the
  property our server needs, by standard rather than by convention, and serving after open is the same single read.
  The cost is the open: a variable header to walk, megabytes for an enhanced object with per-frame groups.
  *Predicted, not measured.*
* **For HTJ2K, DICOM is a mechanical export**: our codestreams are already bare, one per frame, and `.4.201`/`.4.202`
  take them as they are; the frame digests and our metadata map to attributes. What it gives: C-STORE, DICOMweb
  `/frames` with `image/jphc`, OHIF and Cornerstone out of the box, validators, self-identifying objects (SOP Class,
  Transfer Syntax and instance UIDs).
* **For AV1 it is closed**: no standard UID and none in progress, and the video syntaxes stop at 10-bit 4:2:0 YBR with
  no per-frame index. Our AV1 series would have to leave DICOM as HTJ2K (transcoded) or under a private UID. Our
  two-streams-per-frame split would have to live inside one fragment (as our 16-byte header already arranges).
* **The old local note** is right that DICOM multi-frame with an Extended Offset Table gives per-frame offsets and
  lengths and that HTJ2K has standard syntaxes; it should add that the table requires one fragment per frame, and that
  DICOM's video syntaxes, the ones a "video container" discussion would reach for, cannot carry our data at all.

## 11. Sources

* PS3.5 A.4, encapsulation: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_A.4.html; A.4.4
  (JPEG 2000, HTJ2K), A.4.5–A.4.7 (video), A.4.11, A.4.12: same tree, `sect_A.4.N.html`
* PS3.5 §7.5 (items), §8.2 and §8.2.7–8.2.14 (per-syntax rules): https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.html
* PS3.5 §10.18, HTJ2K RPCL: https://dicom.nema.org/medical/dicom/2024c/output/chtml/part05/sect_10.18.html
* PS3.3 C.7.6.3, Image Pixel module and the Extended Offset Table: https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.3.html
* PS3.3 C.7.6.16 and C.7.6.17, functional groups, concatenations, dimension organisation: https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.16.html
* PS3.4 B.5, storage SOP classes: https://dicom.nema.org/medical/dicom/current/output/chtml/part04/sect_B.5.html
* PS3.6 Table A-1, UID registry: https://dicom.nema.org/medical/dicom/current/output/chtml/part06/chapter_A.html
* PS3.18 §8.6, §8.7.3, §8.7.4, §10.4, DICOMweb: https://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_10.4.html
* CP-2362: https://www.dicomstandard.org/news-dir/current/docs/cpack126/cp2362.pdf; CP-2388:
  https://dicom.nema.org/medical/dicom/CP/cp2388_01_ExtendedOffsetTable.xml; WG-06 minutes approving CP-1818/1819:
  https://dicom.nema.org/DICOM/minutes/WG-06/2019/WG-06-2019-01-07-Min-F2F.pdf
* Supplements 225, 235, 244: https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup225.pdf,
  https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup235.pdf, https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup244.pdf
* DICOM work items and WG-04: https://www.dicomstandard.org/workitems, https://www.dicomstandard.org/activity/wgs/wg-04
* Cornerstone3D: `VideoViewport.ts`, `decodeHTJ2K.ts` (https://github.com/cornerstonejs/cornerstone3D); video tutorial
  https://cornerstonejs.org/docs/tutorials/basic-video; progressive loading
  https://cornerstonejs.org/docs/concepts/progressive-loading/requirements
* pydicom encaps: https://pydicom.github.io/pydicom/stable/reference/encaps.html
* DCMTK ticket #866: https://support.dcmtk.org/redmine/issues/866; dcmdump and dciodvfy man pages:
  https://dyn.manpages.debian.org/trixie/dcmtk/dcmdump.1.en.html, https://dyn.manpages.debian.org/trixie/dicom3tools/dciodvfy.1.en.html
* dicom-rs: https://docs.rs/dicom-core, https://docs.rs/dicom-object
* D. Clunie, DICOM WSI (FDA, 2024): https://dclunie.com/papers/FDA_WSI_2024_Clunie.pdf
