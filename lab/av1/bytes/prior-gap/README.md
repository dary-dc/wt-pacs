# lab/av1/bytes/prior-gap — the proof of concept's 10-bit gap, paired

Queue row 66 (POCGAP) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md). An earlier private proof of
concept reported lossless AV1 about 31 % below HTJ2K on 10-bit data; the lab finds a few percent. This codes
the lab's two real 10-bit DBT series paired, frame for frame, and moves one setting at a time. The verdict is
in [`docs/av1/README.md`](../../../../docs/av1/README.md) §Prior evidence.

```bash
lab/av1/tools/tools.sh && lab/av1/fetch_data.sh dbt10_ea1141 dbt10_d
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # builds ojph_compress once
W=lab/.av1-work; P=lab/av1/.venv/bin/python
$P lab/av1/bytes/prior-gap/pocgap.py lab/.av1-build $W/pocgap $W/pocgap.tsv    # ~45 min, 4 cores
$P lab/av1/bytes/prior-gap/mutate.py lab/.av1-build $W/pocgap
```

## How

The first 4 frames of `dbt10_ea1141` and `dbt10_d` (CC BY 4.0, [`FIXTURES.md`](../../../../docs/FIXTURES.md)
§AV1 data), as fetched (cropped to the breast) and two derived copies, each written with its own checksums:
**uncropped**, the pinned DICOM's whole 1890×2457 frame, checked to hold the pinned crop; and **8-bit**,
v ≫ 2 of the cropped frames. Every coding is [`llsize.py`](../represented/README.md)'s: HTJ2K is row SIZE's
served profile (OpenJPH 0.31.0); AV1 is libaom `--lossless=1 --cpu-used=0 --threads=1`, one keyframe a frame,
`direct` (plain) or `low2.screen-sb64` (row LLSIZE's best, "optimized"); the settings varied are
`--threads=4`, `--cpu-used=6`, and libaom 3.8.2 against 3.15.1 at cpu6. Every frame of every coding decoded
by native dav1d 1.5.4 and compared with the checksum: **20/20 cells exact, 80/80 frames**, each intra last
frame also alone. Bytes only; nothing is timed.

## Bytes over HTJ2K's, paired

| set | plain (cpu0) | optimized | `--threads=4` | cpu6, 3.15.1 | cpu6, 3.8.2 | uncropped plain | uncropped optimized | 8-bit plain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dbt10_ea1141` | 0.976 | 0.940 | 0.976 | 0.995 | 0.990 | 0.968 | 0.934 | 0.941 |
| `dbt10_d` | 0.973 | 0.943 | 0.973 | 0.990 | 0.983 | 0.968 | 0.939 | 0.942 |

* **`--threads` changes lossless bytes**: 4 threads against 1, −0.019 to −0.038 % a frame on `dbt10_ea1141`,
  −0.049 to −0.062 % on `dbt10_d`; the output is still exact, but not reproducible across thread counts, so
  `--threads=1` is part of the pin.
* **The crop** moves AV1 ÷ HTJ2K by 0.5–0.8 point (uncropped favours AV1: its background is free to both, and
  more of it to AV1).
* **libaom 3.8.2 against 3.15.1 at cpu6** differs by 0.5 and 0.7 point, 3.8.2 the smaller (at cpu0 the lab
  uses 3.15.1 only; 3.8.2 is inexact on 10-bit inter, row TOOL).
* **An 8-bit copy favours AV1 by 3.1–3.5 points** (0.941 against 0.976, 0.942 against 0.973): it is a
  different picture, and its ratio says nothing about the 10-bit one.

## Mutations

`mutate.py`, one frame each: an 8-bit copy's checksum corrupted, an uncropped frame's samples changed after
its checksum (background 0 → 1), the low2 merge without its low bits, and a crop off by one row in the
uncropped check — every one caught.
