# A basic guide: looking inside a container

*Hands-on, 2026-10-14. Inspection only: sizes and structure, nothing timed. Reproduce with
[`lab/containers/`](../../lab/containers/README.md); the run below is ffmpeg 6.1.1 (libaom 3.8.2, dav1d 1.4.1),
pydicom 3.0.2 and headless Chromium 141 with software decode.*

The question every page in this folder asks of a container is the one our server asks of `.sbnd`: **given frame i,
where do its bytes start, how many are there, and are they in one piece?** This guide builds the same frames into
six containers and answers that question for each with tools anyone can run.

## Contents

1. [Three layers](#1-three-layers)
2. [The samples](#2-the-samples)
3. [ffprobe: the first tool](#3-ffprobe-the-first-tool)
4. [What each container adds](#4-what-each-container-adds)
5. [MP4 by hand](#5-mp4-by-hand)
6. [Matroska by hand](#6-matroska-by-hand)
7. [DICOM by hand](#7-dicom-by-hand)
8. [The same frames in a browser](#8-the-same-frames-in-a-browser)
9. [Other tools](#9-other-tools)

## 1. Three layers

* **The codec** turns samples into a bitstream and back: AV1, HTJ2K, HEVC. A decoder, software or hardware, only
  ever sees this layer.
* **The container** stores coded frames in a file with their timing, an index and metadata: MP4, Matroska, MXF,
  DICOM. It never changes a coded frame's bytes, only where they sit and what surrounds them.
* **The transport** moves bytes: our WebTransport envelopes, HTTP ranges, DASH or HLS segments.

So "hardware playback" is a property of the codec and the decoder, not of the container (see
[`hardware-decode.md`](hardware-decode.md)). What a container decides is how cheaply a reader finds a frame, what it
costs in bytes, and which tools and players can open the file.

## 2. The samples

`make_samples.sh` encodes 160 frames of 256×256, 10-bit grey, as lossless all-keyframe AV1 (libaom
`lossless=1`, monochrome, the shape of our 10-bit payloads without our 16-byte header), then copies the coded
frames unchanged (`-c copy`) into each container. Every file is decoded back and compared with the source samples:
**all eight decode to the same SHA-256**, so the containers lose nothing.

One difference is visible at once: IVF and the raw OBU stream carry each frame's 2-byte temporal delimiter OBU,
and MP4, Matroska and WebM drop it, as AV1's ISO BMFF and Matroska bindings ask ([`iso-bmff.md`](iso-bmff.md) §4,
[`matroska.md`](matroska.md) §4). The coded frames are 4 467 and 4 465 bytes for the same picture.

## 3. ffprobe: the first tool

ffprobe is ffmpeg's inspector: it runs the demuxer and prints what it found, without decoding unless asked.

```bash
# What is in the file
ffprobe -v error -show_entries format=format_name,size:stream=codec_name,profile,pix_fmt,color_range,width,height,nb_frames \
  -of default=nw=1 faststart.mp4

# The frame table as the demuxer sees it: size, position, flags (K = keyframe); first three frames
ffprobe -v error -show_entries packet=pos,size,flags -of csv -read_intervals "%+#3" faststart.mp4

# Count frames by reading every packet (nb_frames is a header claim; this is the count)
ffprobe -v error -count_packets -show_entries stream=nb_read_packets -of csv plain.mkv

# Hash each frame's bytes, to check them against the file at their position
ffprobe -v error -show_packets -show_data_hash sha256 -of json plain.mkv
```

Three things to know before trusting its output:

* **`pos` does not mean the same thing in every demuxer.** In MP4 it is the first byte of the frame. In IVF it is
  the 12-byte frame header before it, and in Matroska and WebM the SimpleBlock's body, whose first 4 bytes are the
  block header. `frame_table.py` finds the true start by matching each frame's hash.
* **CSV columns come out in ffprobe's order, not the order asked**: the lines above print `size,pos,flags`.
* **ffprobe does not understand DICOM.** On the multi-frame DICOM below it reports a raw JPEG 2000 stream
  (`mjpeg_2000`) of 17 "frames" for 16, its positions wrong: a parser scanning for JPEG 2000 markers, not a DICOM
  reader. Use pydicom or dcmdump for DICOM (§7).

## 4. What each container adds

From the two runs, 16 and 160 frames, the bytes a container adds split into a fixed part and a per-frame part:

| file | per frame | fixed | where the index is | `pos` is the frame's first byte |
| --- | --- | --- | --- | --- |
| raw OBU (`-f obu`) | 0 B (2 B delimiter in the frame) | 0 B | none: walk every OBU header | yes |
| IVF | 12 B (+ 2 B delimiter) | 32 B | none: walk every frame header | no, +12 |
| MP4, moov at end | 4.0 B | 809 B | `moov`, after the frames | yes |
| MP4, `+faststart` | 4.0 B | 809 B | `moov`, before the frames | yes |
| fragmented MP4, a fragment per frame | 131.0 B | 801 B | a `moof` per frame, and an `mfra` at the end | yes |
| Matroska | 41.9 B | 501 B | `Cues`, after the frames | no, +4 |
| Matroska, `-cues_to_front 1` | 41.9 B | 501 B | `Cues`, before the frames | no, +4 |
| WebM | 35.9 B | 438 B | `Cues`, after the frames | no, +4 |
| multi-frame DICOM, Extended Offset Table | ≈ 24.5 B (8 item header, 16 table, ≤ 1 pad) | ≈ 850 B, this dataset only | the Extended Offset Table, in the header | no, +8 |
| our `.sbnd` | 12 B (offset u64, length u32) | 16 B + the metadata JSON | the frame table, after the header | yes |

**In every container, each frame's bytes are contiguous.** That is the property the server needs, and all of
them have it; what differs is how many reads it takes to learn the offset and the length (§5, §6, §7). Per frame,
on 4.5 KB frames, the most expensive layout (a fragment per frame) is 2.9 % of the frame; on a 0.5 MB frame it
is 0.03 %. Bytes on disk are not what separates these containers.

## 5. MP4 by hand

`mp4_walk.py faststart.mp4` prints the box tree:

```text
ftyp  moov ─ mvhd
           └ trak ─ tkhd, edts
                  └ mdia ─ mdhd, hdlr
                         └ minf ─ vmhd, dinf
                                └ stbl ─ stsd  162 B   the av01 sample entry and its av1C
                                         stts   24 B   1 entry: every frame the same duration
                                         stsc   28 B   1 entry: all 160 frames in one chunk
                                         stsz  660 B   160 sizes, 4 bytes each
                                         stco   20 B   1 chunk offset
free  mdat  (the 160 frames, back to back)
```

There is no `stss` box: its absence means every frame is a sync frame. To find frame i a reader combines three
tables: `stsc` maps frames to chunks, `stco` gives each chunk's offset, and `stsz` gives each frame's size, so the
frame's offset is its chunk's offset plus the sizes of the frames before it in that chunk. ffmpeg put all 160
frames in one chunk, so the frame table is `stco[0]` plus a running sum of `stsz`: computed once when the file is
opened, then one lookup and one read per frame, as with `.sbnd`. The 4 bytes per frame are the `stsz` entry.

With the `moov` at the end (ffmpeg's default) a reader must find the end of the file first; `+faststart` rewrites
the file with `moov` in front so one read from offset 0 gets the whole index. A fragment per frame costs 131 B per
frame because each frame gets its own `moof` (104 B: `mfhd`, `traf` with `tfhd`, `tfdt`, `trun`), an 8-byte `mdat`
header and a 19-byte `tfra` entry in the closing `mfra` index. [`iso-bmff.md`](iso-bmff.md) explains each box.

## 6. Matroska by hand

`ebml_walk.py cuesfront.mkv` prints the element tree and counts:

```text
EBML  Segment ─ SeekHead, Void, Info, Tracks, Tags
              ├ Cues          3 029 B: 160 CuePoints, each with CueClusterPosition and CueRelativePosition
              └ Cluster ×159  each: Timestamp, CRC-32, SimpleBlock (one frame)
```

ffmpeg wrote a CuePoint for every frame, because every frame is a keyframe, and each one carries the cluster's
position and the block's position inside it: frame i's start is one table lookup away. **Its length is not in the
Cues.** It is in the SimpleBlock's own size field, so a reader either reads a few bytes before the frame or, as
ffprobe does, walks every cluster once when the file is opened and builds the full table then. ffmpeg also started a
new cluster at almost every frame and gave each a CRC-32 element; about 19 B of the 41.9 B per frame are the Cue
entry, the rest the cluster and block headers. [`matroska.md`](matroska.md) explains each element and the muxer
options that change this.

## 7. DICOM by hand

`dicom_eot.py` wraps 16 lossless JPEG 2000 frames (ffmpeg's encoder; HTJ2K would be wrapped the same way) as a
multi-frame grey DICOM with pydicom's `encapsulate_extended`, then reads every frame back through the Extended
Offset Table, `(7FE0,0001)` with `(7FE0,0002)`: 16 of 16 exact.

What the run teaches:

* **The offsets count from the first item after the Basic Offset Table**, not from the start of the file: the
  reader adds the position of the Pixel Data element, the empty Basic Offset Table item (8 B) and the frame's own
  item header (8 B).
* **Every item has even length, and pydicom disagrees with the standard about the pad.** An odd codestream gets
  one 0x00 pad. The current standard says the Extended Offset Table Lengths value "may be an odd number" and "does
  not include any trailing padding" (PS3.3 C.7.6.3.1.8), but pydicom 3.0.2's `encapsulate_extended` writes the
  padded length: 15 312 for a 15 311-byte codestream (its source rounds every length up to even). A reader that
  trusts the table gets one byte too many from a pydicom file; JPEG 2000 decoders ignore it, since it follows the
  end-of-codestream marker, but an exactness hash over the coded bytes would not.
* **The header in front of the pixels is the cost at open.** Here it is about 850 B, because this dataset carries
  almost nothing; an enhanced multi-frame object with per-frame functional groups can carry kilobytes per frame
  ([`dicom.md`](dicom.md)).

## 8. The same frames in a browser

`browser_probe.mjs` serves the files to headless Chromium 141 and does two things with each container
(`plain.mkv`, `faststart.mp4`, `plain.webm`):

* **Frame table into WebCodecs.** The page reads ffprobe's frame table, cuts each frame out of the file and hands
  it to `VideoDecoder` as an `EncodedVideoChunk`, with no demuxer in the page. Every frame comes back as `I420P10`
  and **160 of 160 match the source samples**, for all three containers: once the offsets and lengths are known,
  the container is gone and WebCodecs sees only AV1.
* **The file in a video element.** The same file plays, and a canvas reads the first frame back as **8-bit RGBA**:
  the source's 483 distinct 10-bit levels arrive as 187 8-bit levels, stretched from the stream's limited range
  (121–843) to 16–226. The video element cannot return the samples; it returns a picture of them.

Headless Chromium here decodes in software; hardware decode on the same page is the subject of
[`hardware-decode.md`](hardware-decode.md). `MediaSource.isTypeSupported` and `VideoDecoder.isConfigSupported`
answered yes to every AV1 string tried, 12-bit profile 2 included, so a yes from either is not a promise that a
stream decodes: decoding it is.

## 9. Other tools

Not installed in this container, so not run here; each is the usual next step for its format:

| tool | for | what it adds over ffprobe |
| --- | --- | --- |
| `MP4Box -info`, `MP4Box -diso` (GPAC) | MP4, fMP4, HEIF, AVIF | every box dumped to XML, fragmenting and DASH packaging |
| `mp4dump`, `mp4info` (Bento4) | MP4, fMP4 | box tree with field values; `mp4fragment`, `mp4dash` |
| `mkvinfo -v`, `mkvmerge -J`, `mkvextract` (MKVToolNix) | Matroska, WebM | every element with its position; JSON identification |
| `mediainfo` | everything | one summary of container and codec fields |
| `dcmdump +P`, `dcmdump --print-all` (DCMTK) | DICOM | the dataset and its pixel items |
| `dciodvfy` (dicom3tools) | DICOM | checks an object against its IOD |
| `gdcmdump`, `gdcminfo` (GDCM) | DICOM | the dataset, fragments and offset tables |
| `bmxtranswrap`, `mxf2raw` (BBC bmx) | MXF | header metadata, index tables, essence |
