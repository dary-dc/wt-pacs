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
