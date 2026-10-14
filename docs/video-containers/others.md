# The other formats, and the formats that already look like ours

*Theory, 2026-10-14, read from sources (§4). Short on purpose: each entry says only what matters for reading one
frame at a time. The IVF and raw OBU sizes are [`guide.md`](guide.md)'s.*

## Contents

1. [Streams with no index](#1-streams-with-no-index)
2. [Older containers with an index](#2-older-containers-with-an-index)
3. [Formats that already look like .sbnd](#3-formats-that-already-look-like-sbnd)
4. [Sources](#4-sources)

## 1. Streams with no index

**Raw AV1.** A **temporal unit** is a temporal delimiter OBU and everything up to the next one. Two serialisations:

* **Low-overhead format** (AV1 §5.2): OBUs back to back, each with its own size (leb128). Temporal-unit boundaries
  are found only by reading OBU headers. **This is what WebCodecs takes per chunk** (its AV1 registration) and what
  MP4 and Matroska store per sample, minus the delimiter.
* **Annex B**: sizes nested as temporal unit → frame unit → OBU, a skip list that walks faster but still walks;
  WebCodecs does not take it as is.

**IVF**, the container libaom's tools write: a 32-byte header (`DKIF`, FourCC, size, time base, a frame count that is
advisory) and a 12-byte header (size, timestamp) per frame. No index. Our ingest strips these headers to get temporal
units (`docs/av1/payload-format.md` at `e8f6374` on `claude/av1-unified`).

**MPEG-2 Transport Stream** (ITU-T H.222.0, still a paid document): fixed 188-byte packets, each with a 4-byte header,
carrying PES packets with timestamps. Built for broadcast tune-in, it has **no index**, and **a frame is not contiguous**:
its bytes are cut into 184-byte pieces between packet headers, so even with an external index a reader must
de-packetise. Overhead is at least 2.1 % from packet headers alone, about 4.5 % on 4.5 KB frames by the research notes'
arithmetic. **AV1 in TS** (an AOM working-group draft, 2021) puts a start code before every OBU and escapes the
payload, so the stored bytes are not the coded frame. JPEG 2000 (H.222.0 Amd 5, 2011) and JPEG XS (2018 Amd 1) have TS
mappings, used for broadcast contribution. HLS segments are TS or fragmented MP4; an HLS playlist's
`EXT-X-BYTERANGE: length@offset` is an external offset-and-length table (RFC 8216).

**Ogg** (RFC 3533): pages of up to 64 KB with a granule position; no index, seeking by bisection; a packet can span
pages. **NUT**: syncpoints and an optional index of syncpoints, not frames. **FLV**: an 11-byte tag header and a 4-byte
back-pointer per frame; the keyframe index in `onMetaData` is a writer convention. None is relevant to us.

**Y4M** (YUV4MPEG2): a text header, then `FRAME\n` and raw planes; ffmpeg writes grey as `Cmono`, `Cmono10`,
`Cmono12`, `Cmono16`. With a fixed frame size frame i is at a computed offset, so it needs no index. A convenient
lab interchange format for uncompressed grey, not a store.

## 2. Older containers with an index

**AVI** (RIFF): every chunk is FourCC + size; the AVI 1.0 `idx1` index has 16-byte entries (chunk id, flags with a
key-frame bit, 32-bit offset, size), the offset's base ambiguous between files. **OpenDML** adds a super index of
standard indexes with 64-bit base offsets and 8-byte entries. A true offset-and-length table per frame, 32-bit in its
first form; no browser plays it, and AV1 has no standard mapping.

**QuickTime** (`.mov`) is ISO BMFF's ancestor: the same `stsz`, `stsc`, `stco`/`co64` sample tables
([`iso-bmff.md`](iso-bmff.md)).

## 3. Formats that already look like .sbnd

The pattern "small header, a table of (offset, length) per independently coded unit, the units after" is not ours
alone. Four standards, two from imaging, use it:

* **TIFF and BigTIFF**: every image is cut into strips or tiles, each located by two parallel arrays,
  `StripOffsets`/`StripByteCounts` or `TileOffsets`/`TileByteCounts`: 8 bytes per unit in TIFF, 16 in BigTIFF (64-bit,
  past 4 GB). Pages are a chain of directories. **Whole-slide imaging lives on this** (Aperio SVS is a tiled pyramidal
  TIFF with JPEG 2000 tiles, and dual-personality DICOM-TIFF files exist). **OME-TIFF** adds OME-XML and one directory
  per plane for microscopy stacks.
* **Cloud Optimized GeoTIFF** (OGC 21-026, 2023): TIFF with **every directory and the tile offset arrays forced to the
  front**, then the tiles; a client reads the whole header in one HTTP range request and then one range per tile. The
  standard's rationale is the same arithmetic as ours: scattered directories cost sequential requests (its S3 example:
  about 540 ms for three). It is the closest outside precedent for `.sbnd`'s layout.
* **Zarr v3 with the sharding codec**: an N-dimensional array cut into chunks, many chunks packed into one object with
  an index of **(offset u64, nbytes u64) per chunk** at its start or end, empty chunks marked, an optional CRC32C. That is
  `.sbnd`'s frame table, standardised, at 16 bytes per entry. **OME-Zarr** (NGFF) builds bioimaging's cloud format on it.
* **DICOM's Extended Offset Table**, the medical one ([`dicom.md`](dicom.md)).

The lesson for the comparison: every format built for random access to independent units converges on this table. A
standard container can only match `.sbnd` on lookup; what it can add is tooling, interchange and recognition.

## 4. Sources

* AV1 bitstream specification, §5 and Annex B: https://github.com/AOMediaCodec/av1-spec
* W3C, WebCodecs AV1 registration: https://www.w3.org/TR/webcodecs-av1-codec-registration/
* FFmpeg `libavformat/ivfdec.c`, `mpegts.h`, `yuv4mpegenc.c`, `flvenc.c`: https://github.com/FFmpeg/FFmpeg
* ITU-T H.222.0: https://www.itu.int/rec/T-REC-H.222.0; Amd 5 (JPEG 2000):
  https://itu.int/dms_pubrec/itu-t/rec/h/T-REC-H.222.0-201105-S!Amd5!SUM-HTM-E.htm
* AOM, Carriage of AV1 in MPEG-2 TS (draft): https://github.com/AOMediaCodec/av1-mpeg2-ts
* RFC 8216, HLS: https://datatracker.ietf.org/doc/html/rfc8216; RFC 3533, Ogg: https://datatracker.ietf.org/doc/html/rfc3533
* FFmpeg NUT documentation: https://github.com/FFmpeg/FFmpeg/blob/master/doc/nut.texi
* Microsoft, AVI RIFF reference and OpenDML index structures:
  https://learn.microsoft.com/en-us/windows/win32/directshow/avi-riff-file-reference,
  https://learn.microsoft.com/en-us/previous-versions/windows/desktop/api/aviriff/ns-aviriff-avisuperindex
* libtiff `tiff.h`: https://github.com/libsdl-org/libtiff/blob/master/libtiff/tiff.h; BigTIFF:
  https://awaresystems.be/imaging/tiff/bigtiff.html
* OpenSlide, Aperio format: https://openslide.org/formats/aperio/; DICOM WSI: https://dicom.nema.org/Dicom/DICOMWSI/
* OME-TIFF: https://ome-model.readthedocs.io/en/stable/ome-tiff/specification.html; OME-Zarr (NGFF):
  https://github.com/ome/ngff-spec
* OGC 21-026, Cloud Optimized GeoTIFF: https://docs.ogc.org/is/21-026/21-026.html
* Zarr v3 sharding codec: https://zarr-specs.readthedocs.io/en/main/v3/codecs/sharding-indexed/v1.0.html
* JPEG 2000 family and JPEG XS: https://jpeg.org/jpeg2000/, https://jpeg.org/jpegxs/
