# MXF

*Theory, 2026-10-14, read from SMPTE documents (free on pub.smpte.org since June 2026) and from the readers that
implement them (§9). ST 377-1's own text could be read only up to §6.2.3, so the byte layouts of partition packs, the
Random Index Pack and index table segments are taken from FFmpeg's MXF reader and writer: what readers do, which is
not quite the same as what the standard says.*

## Contents

1. [In one paragraph](#1-in-one-paragraph)
2. [KLV](#2-klv)
3. [Structure](#3-structure)
4. [Finding frame i](#4-finding-frame-i)
5. [The codecs it carries](#5-the-codecs-it-carries)
6. [Throughput and latency](#6-throughput-and-latency)
7. [Playback, tools, licence](#7-playback-tools-licence)
8. [For wt-pacs](#8-for-wt-pacs)
9. [Sources](#9-sources)

## 1. In one paragraph

MXF (SMPTE ST 377-1, the Material eXchange Format) is broadcast and cinema's professional container: an object model
of packages, tracks and descriptors (AAF's), serialised as **KLV** triplets, wrapping coded "essence" in a **Generic
Container**. It is built for interchange and archives, "not designed for desktop playback" (Library of Congress). It
is where digital cinema keeps its 12-bit JPEG 2000 frames, where IMF keeps mastering-grade video, and, since
ST 422:2022, a standard home for **HTJ2K**.

## 2. KLV

* **Key**: always 16 bytes, a SMPTE Universal Label starting `06 0E 2B 34` (ST 336).
* **Length**: ASN.1 BER, one byte below 128, otherwise `0x80 | n` and n bytes; writers usually use 4 bytes
  (`0x83 …`), so a key and length cost **20 bytes**. Readers such as FFmpeg refuse lengths over 8 bytes.
* **Value**: the payload. Metadata sets use local sets with 2-byte tags mapped to full labels by a **Primer Pack**.
* **KLV Fill** items pad between triplets; the **KAG** (KLV Alignment Grid) is the byte grid a writer aligns
  triplets to.

## 3. Structure

* **Partitions**: a header partition, optional body partitions, an optional footer partition, each opened by a
  **partition pack** (version, KAG size, this/previous/footer partition offsets, header and index byte counts,
  IndexSID, BodyOffset, BodySID, the operational pattern). A partition holds header metadata, index table segments,
  and essence of one container.
* **The Random Index Pack**, at the very end: 12 bytes per partition (BodySID, offset) and its own length in the last 4
  bytes of the file, so a reader seeks to the end, reads the length, and finds every partition without scanning.
* **Header metadata**: the Preface, a Material Package (the output timeline), Source Packages (a File Package
  describes the stored essence), tracks, sequences, and **essence descriptors** (picture: CDCI for Y'CbCr, RGBA;
  codec sub-descriptors such as JPEG 2000's). The descriptor is MXF's equivalent of our metadata JSON; DICOM attributes
  have no slot and would ride in descriptive metadata.
* **The Generic Container** (ST 379-2) holds essence in **content packages**, one per edit unit (a frame), each
  holding items (system, picture, sound, data), each element one KLV. **Frame wrapping** puts each frame in its own
  KLV; **clip wrapping** puts the whole stream in one.
* **Operational patterns** bound complexity. **OP1a** is one playable item (used by IMF track files and broadcast
  delivery profiles). **OP-Atom** (ST 390) is one essence track per file, with a closed and complete header and a
  complete index in the footer; it is "unsuitable" where recording and playout run concurrently. Digital cinema track
  files (ST 429-3) are OP-Atom with exactly three partitions and a mandatory Random Index Pack.

## 4. Finding frame i

**The index table** converts an edit unit (frame number) into a byte offset in the essence container. Its segments
(local sets) carry an edit rate, a start position and a duration, and either:

* **`EditUnitByteCount`** for constant-size frames: offset = count × i, no per-frame storage (uncompressed video); or
* an **index entry array** for variable sizes, one entry per frame: temporal offset, key-frame offset, flags and a
  64-bit **StreamOffset**, **11 bytes** at minimum (FFmpeg writes 15).

Then, for frame-wrapped essence:

```text
open:  end of file → Random Index Pack → every partition pack; header metadata (Primer + local sets);
       every index table segment (often in the footer)
frame: StreamOffset[i]  → find the partition whose BodyOffset ≤ it → file offset of the frame's KLV key
       frame bytes = that + 16 + BER length size; length = the BER length (or StreamOffset[i+1] − StreamOffset[i])
```

**After open, a frame is one lookup and one read**, like `.sbnd`. Two differences: the index stores **only the
offset** (the length is the next offset's difference or the KLV's own length), and the offset is a position in the
essence *stream*, mapped to the file through the partition table. The open is the heaviest of any container here: a
KLV parser, a Primer, local sets, a partition map, at least three reads (tail, header, footer).

## 5. The codecs it carries

* **JPEG 2000 and HTJ2K: SMPTE ST 422:2022.** It maps ISO/IEC 15444-1 and **15444-15 (HTJ2K)** codestreams into a
  picture track; in the progressive-frame mode (P1) **each KLV value is exactly one codestream**, what `.sbnd` stores.
  HTJ2K has its own picture coding label, and a JPEG 2000 sub-descriptor carries the SIZ and COD values and the
  profile. An index table *should* be used for variable sizes.
* **Digital cinema** (ST 429-4:2023): OP-Atom, frame-wrapped JPEG 2000 Part 1, X'Y'Z', **12 bits** per component; no
  HTJ2K in that edition.
* **IMF** (ST 2067-21, application 2E) and the cinema archive application (ST 2067-40) take JPEG 2000; ST 2067-40
  was updated for HTJ2K, and the next revision of 2067-21 "improves documentation of HTJ2K codestream constraints",
  which suggests the 2023 edition already admits it (the 2023 text was not read).
* **Archives**: AS-07 became SMPTE RDD 48 (2018); its 2022 amendment maps **FFV1**. The Library of Congress keeps
  video masters as MXF OP1a with lossless JPEG 2000; some archives are moving to FFV1 in Matroska.
* **Uncompressed** (ST 384): constant edit-unit size, indexed by arithmetic.
* **AV1: no mapping found** in SMPTE's library or in FFmpeg's MXF label table. A private label would be ours alone.

## 6. Throughput and latency

* **OP-Atom, one body partition, footer index, Random Index Pack**: the shape closest to `.sbnd`; three reads at open.
* **Frame wrapping, KAG 1, no fill, picture only**: frame i's KLV is contiguous with the next, so one read of
  `StreamOffset[i+1] − StreamOffset[i]` returns the key, length and frame. A larger KAG (FFmpeg's OP1a writer uses
  512) pads every frame and puts fill into that read.
* **Per frame**: 16 (key) + 4 (length) + 11 (index entry) ≈ **31 bytes**, against `.sbnd`'s 12; FFmpeg's OP1a output
  adds a system item per frame and the 512-byte alignment, hundreds of bytes on average.
* **Clip wrapping** stores frames back to back inside one KLV, and the index points straight at each frame's first
  byte: fewer bytes, the same lookup.

## 7. Playback, tools, licence

* **No browser plays MXF**; the Media Source Extensions registry has WebM, ISO BMFF, MPEG-2 TS and MPEG audio.
  Irrelevant to us, since the client decodes bare codestreams.
* **Tools**: bmx (EBU's fork of the BBC's, BSD-3: `raw2bmx`, `bmxtranswrap`, `mxf2raw`, with libMXF and MXFDump), asdcplib
  (CineCert, cinema and IMF track files), FFmpeg (MXF in and out, and a native HTJ2K decoder since 6.1), MediaInfo.
* **Licence**: SMPTE made its whole catalogue free to read on 17 June 2026; no royalty pool for the container was
  found.

## 8. For wt-pacs

* **MXF has the property after open, with the heaviest open of all the candidates.** Its value to us is
  interoperability for **HTJ2K**: a published mapping that carries our codestreams unchanged, and the cinema and IMF
  toolchains, the precedent of 12-bit JPEG 2000 frames served in a professional chain. *Inferred, not measured.*
* **Not a storage candidate**: the same lookup as `.sbnd` behind much more parsing, nothing a browser can use, and no
  AV1 path.
* **As an export format**, it is the broadcast and archive counterpart of DICOM: if a partner ever wants a series
  as a professional media file rather than a DICOM object, ST 422 HTJ2K in OP-Atom is the standard answer.

## 9. Sources

* SMPTE announcement, free standards: https://www.smpte.org/blog/smpte-makes-its-standards-freely-accessible-openingstandards-library-to-the-global-media-technology-community
* ST 377-1:2019: https://pub.smpte.org/pub/st377-1/st377-1-2019.pdf
* ST 336:2017 (KLV): https://pub.smpte.org/pub/st336/st0336-2017.pdf
* ST 379-2:2010 (Generic Container): https://pub.smpte.org/doc/st379-2/20100223-pub/st0379-2-2010_stable2016.pdf
* ST 390:2011 (OP-Atom): https://pub.smpte.org/pub/st390/st0390-2011_stable2016.pdf
* ST 422:2022 (JPEG 2000 and HTJ2K): https://pub.smpte.org/pub/st422/st422-2022.pdf
* ST 384:2005 (uncompressed): https://pub.smpte.org/pub/st384/st0384-2005.pdf
* ST 429-3 and 429-4:2023 (digital cinema): https://pub.smpte.org/pub/st429-3/index.html, https://pub.smpte.org/pub/st429-4/index.html
* ST 2067-21 revision repository: https://github.com/SMPTE/st2067-21
* FADGI, RDD 48: https://www.digitizationguidelines.gov/guidelines/MXF_app_spec.html
* FFmpeg `libavformat/mxfdec.c`, `mxfenc.c`, `mxf.c`: https://github.com/FFmpeg/FFmpeg
* bmx: https://github.com/ebu/bmx; asdcplib: https://github.com/cinecert/asdcplib
* Library of Congress: MXF https://loc.gov/preservation/digital/formats/fdd/fdd000013.shtml, OP1a
  https://loc.gov/preservation/digital/formats/fdd/fdd000266.shtml, HTJ2K https://loc.gov/preservation/digital/formats/fdd/fdd000565.shtml
* W3C MSE byte stream format registry: https://www.w3.org/TR/mse-byte-stream-format-registry/
