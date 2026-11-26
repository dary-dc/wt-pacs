# containers

Inspection, not timing: each script shows where a container keeps a frame's bytes and how a reader finds them.
[`docs/video-containers/guide.md`](../../docs/video-containers/guide.md) walks through the output and owns its numbers.

```bash
lab/containers/make_samples.sh                 # needs ffmpeg with libaom, libdav1d and jpeg2000; python3 -m pip install pydicom
node lab/containers/browser_probe.mjs lab/containers/out plain.mkv   # needs playwright and Chromium
```

| file | what it shows |
| --- | --- |
| `make_samples.sh` | one lossless 10-bit grey AV1 sequence remuxed to IVF, raw OBU, MP4, fragmented MP4, Matroska and WebM, each decoding back to the source samples; 16 JPEG 2000 frames as DICOM and as MXF (OP-Atom, OP1a) |
| `frame_table.py` | every frame's offset and length as ffprobe's demuxer reports them, checked against the file's bytes, and the container's bytes per frame |
| `mp4_walk.py` | the MP4 box tree and the sample tables a reader combines into a frame table |
| `ebml_walk.py` | the Matroska element tree and how many Cues, Clusters and SimpleBlocks it holds |
| `klv_walk.py` | the KLV sequence of an MXF file (partitions, essence, index, Random Index Pack), where ffprobe places each frame, and the bytes between frames |
| `dicom_eot.py` | a multi-frame DICOM with an Extended Offset Table, read back frame by frame from the table |
| `browser_probe.*` | the frames read by the frame table into WebCodecs, digested; the same file in a video element, read back through a canvas |
