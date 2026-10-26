# What a late frame costs, by container

A series is stored as one container of coded frames. A late instance's frame lands at its image number: at the end,
or in the middle. This directory measures what adding 1 and 10 late frames costs a 262- and a 2 000-frame series in
`.sbnd`, MXF OP1a (frame-wrapped HTJ2K) and MP4 (lossless AV1). It reports; it decides nothing.

## Pre-registered, 2026-10-26, before any cell ran

F is the mean coded frame, guessed at ~200 kB for a 512² 12-bit CT-like frame; S = N · F is the series.

| container | end | middle |
| --- | --- | --- |
| `.sbnd`, rewrite and rename | read S, write S + k·F; ~0.2–0.5 s warm at N = 2 000, bound by the page-cache copy | the same: the index is at the front, so every offset moves |
| MXF, index in the footer | write k·F + the whole index (~11 B a frame) + footer; < 10 ms | rewrite everything after the point, ≈ S/2 in place or S as a new file |
| MXF, index in body partitions | write k·F + ~1 kB, independent of N; < 10 ms | as above |
| MP4, moov at the end | write k·F + the new moov (~4–8 B a frame); < 10 ms | all-intra: the same as the end, the sample table places the frame; GOP 30: plus the re-encode of the group |
| MP4, moov at the front | rewrite: read S, write S + k·F | the same |
| MP4, fragmented | write k·F + one moof (~100 B); < 5 ms | rewrite from the fragment that holds the point on: decode order is fragment order |

* **Re-encode.** Every cell pays the late frame's own encode. Only AV1 with GOP > 1 in the middle pays more: decode
  the group (30 frames) and encode it again with the late frame (31, or 40). Guessed, libaom lossless 12-bit grey
  at `cpu-used=6`, one thread: ~0.15 s a frame intra, ~0.3 s inter, so ~10 s a group — which dominates every
  container operation in the table.
* **fsync** adds the written bytes over the disk's write rate: small for the appends, ~S for the rewrites.
* **End and middle are the same cost for `.sbnd`**, and for MP4 all-intra with the moov at the end.

## Against the numbers

The numbers are in [`../../docs/disk-layout/containers.md`](../../docs/disk-layout/containers.md) §Measured: what a
late frame costs; F came out at 264 kB (HTJ2K) and 344 kB (AV1).

* **`.sbnd`: read S, write S + k·F, end = middle** — held, to the byte. **~0.2–0.5 s** — not held: 0.57–1.02 s at
  N = 2 000 (0.36–3.6 s over runs), this host's page-cache rate, not the code's.
* **MXF appends < 10 ms, the footer layout writing the whole index** — held: 1.6–9.5 ms; at N = 2 000 and k = 1,
  286 kB against the body layout's 266 kB, the difference mostly the 22 kB index. **Body layout independent of N** —
  held in bytes (265 and 266 kB at N = 262 and 2 000), plus 8 B for each of its 68 partition packs at N = 2 000.
* **MXF middle ≈ S as a new file** — held (bmx rewrites it, 1.2–2.3 s).
* **MP4 moov at the end < 10 ms, and all-intra middle = end** — held: 2.2–8.6 ms, the middle 32 B more (one more chunk).
* **moov at the front rewrites S** — held. **Fragmented append < 5 ms** — held at GOP 30 (2.2 ms), not all-intra:
  19 ms, because FFmpeg's `frag_keyframe` made a fragment a frame and the mfra (an entry each) is rewritten.
* **Re-encode ~0.15 s a frame intra, ~0.3 s inter** — not held: 0.47–0.54 s intra, 0.24–0.25 s inter (inter is the
  cheaper here). **~10 s a group, dominating the container work** — held: 9.0–11.5 s against 37–70 ms.

## Reproduce

Run here: FFmpeg 6.1.1 (libdav1d), libaom 3.8.2's `aomenc` and `aomdec` (Ubuntu 24.04's `aom-tools`), numpy, Rust,
and from source by [`tools.sh`](tools.sh): OpenJPH 0.31.0 (commit `c68064d`, as `ingest/tools.sh` pins it) and bmx
v1.6 (commit `feb6e3d`) with [`bmx-grey.patch`](bmx-grey.patch), without which bmx refuses a one-component codestream
("Unsupported JPEG2000 component layout"). The patch maps one unsigned component to a `Y` layout and nothing else.
GPAC's MP4Box 2.2.1 was installed and used only to look at boxes.

```bash
W=lab/.late-frame-work
BUILD=$W/tools lab/late-frame/tools.sh && OJPH=$W/tools/ojph BMX=$W/tools/bmx
export LD_LIBRARY_PATH=$OJPH/lib:$BMX/lib
python3 lab/late-frame/frames.py $W "$OJPH/bin" /usr/bin/aomenc          # frames, HTJ2K, AV1
(cd lab/late-frame/sbnd-late && cargo build --release)
python3 lab/late-frame/run.py $PWD/$W "$BMX/bin" /usr/bin "$OJPH/bin" 5   # cells, encodes, the disk
python3 lab/late-frame/mutate.py $PWD/$W "$BMX/bin" /usr/bin              # each check caught breaking
python3 lab/late-frame/summary.py $W
```

| file | what |
| --- | --- |
| `frames.py` | 2 010 frames of `lab/scripts/gen_frame_pnm.py`'s `ct` mode, 512², 12-bit in 16-bit words; HTJ2K in the served profile; AV1 all-intra and GOP 30 |
| `sbnd-late/` | the `.sbnd` merge through `common/series-bundle`'s own reader and writer, rewrite and rename |
| `mxf.py` | the MXF append at the byte level, for the two layouts bmx writes |
| `mp4.py` | the MP4 splice at the byte level: moov at the end, at the front, fragmented |
| `run.py` | every cell interleaved (`lab/order.mjs`'s Williams square), each checked once; the encodes; the disk's rates |
| `check.py` | each output read by another tool: FFmpeg's libdav1d, bmx's `mxf2raw`, the `.sbnd` index |
| `mutate.py` | seven breakages, each of which its check must catch |
| `rows.jsonl`, `costs.jsonl`, `host.jsonl`, `mutate.txt` | this run's rows, 2026-10-26 |
| `tools.sh`, `bmx-grey.patch` | OpenJPH and bmx, pinned |
