# dbtscale — the DBT verdicts on sound data at scale

Queue row 95 (DBTSCALE) of [`docs/av1/queue.md`](../../../docs/av1/queue.md): fifteen whole, uncropped DBT slice
volumes, five exams (five patients) from each of the three reconstruction systems the EA1141 collection holds
(`dbts_a1`…`dbts_c5`, [`docs/FIXTURES.md`](../../../docs/FIXTURES.md) §AV1 data, every one `sound`), through row
SPLITTIME's harness ([`../splittime`](../splittime/README.md)) unchanged. The reading is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §A3.

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh && lab/av1/item/build.sh
lab/decode-bench/fetch_decoder.sh
lab/av1/fetch_data.sh dbts_a1 dbts_a2 dbts_a3 dbts_a4 dbts_a5 dbts_b1 dbts_b2 dbts_b3 dbts_b4 dbts_b5 \
  dbts_c1 dbts_c2 dbts_c3 dbts_c4 dbts_c5                                # ~6 GB fetched, ~6 GB of frames
P=lab/av1/.venv/bin/python W=lab/.av1-work
$P lab/av1/splittime/make_frames.py lab/.av1-build $W/dbtscale lab/av1/data/dbts_* --preset allintra:7  # ~1 h, 4 cores
```

**Selection.** In IDC v24 (`idc-index` 0.12.5, `idc-index-data` 24.2.2), per system the slice series sorted by
SeriesInstanceUID, the first five from patients the lab had not used, each series' 1 mm slice instance (not its
10 mm slab). Every file: explicit VR little endian, Lossy Image Compression `00`.

## Bytes (2026-10-08)

Every slice, `allintra` 7 (the shipped preset row SPLITTIME found for DBT's k = 2 and k = 3), each item decoded back
natively and matched with the fetch's checksum before it is written (`ingest.py`), HTJ2K in the served profile
decoded back and checked: 994/994 frames exact in every arm. HTJ2K's bits a sample, then each arm's bytes over
HTJ2K's on the whole volume. k is the low bits split off; at 10 bits k = 0 is d12 and w10 alike, at 12 bits k = 0
is d12 and k = 2 is w10.

| set | b | frames | HTJ2K, bit/sample | k = 0 | k = 2 | k = 3 |
| --- | --: | --- | --: | --: | --: | --: |
| `dbts_a1` | 12 | 56 × 1142×1785 | 4.75 | 1.054 | 0.948 | 0.956 |
| `dbts_a2` | 12 | 87 × 1014×2046 | 4.33 | 1.064 | 0.950 | 0.953 |
| `dbts_a3` | 12 | 43 × 712×2041 | 5.08 | 1.068 | 0.948 | 0.950 |
| `dbts_a4` | 12 | 69 × 1131×2223 | 5.40 | 1.071 | 0.950 | 0.950 |
| `dbts_a5` | 12 | 71 × 845×2241 | 4.35 | 1.067 | 0.953 | 0.957 |
| `dbts_b1` | 10 | 50 × 2560×3328 | 2.02 | 0.967 | 0.939 | 0.966 |
| `dbts_b2` | 10 | 71 × 1890×2457 | 3.49 | 0.971 | 0.956 | 1.004 |
| `dbts_b3` | 10 | 63 × 1996×2457 | 3.09 | 0.975 | 0.941 | 0.965 |
| `dbts_b4` | 10 | 84 × 1996×2457 | 2.44 | 0.776 | 0.760 | 0.767 |
| `dbts_b5` | 10 | 66 × 1890×2457 | 2.39 | 0.803 | 0.797 | 0.814 |
| `dbts_c1` | 12 | 69 × 976×2513 | 3.34 | 1.063 | 0.948 | 0.950 |
| `dbts_c2` | 12 | 56 × 757×2227 | 5.11 | 1.080 | 0.956 | 0.958 |
| `dbts_c3` | 12 | 70 × 1147×2585 | 3.64 | 1.076 | 0.950 | 0.958 |
| `dbts_c4` | 12 | 66 × 662×2227 | 3.41 | 1.083 | 0.951 | 0.953 |
| `dbts_c5` | 12 | 73 × 955×2100 | 4.49 | 1.068 | 0.952 | 0.954 |

**cpu0 against the shipped preset**, on each volume's two middle slices (`make_frames.py … --preset cpu0` on sets of
those two, every item exact), cpu0 · `allintra` 7, bytes over HTJ2K's on the same slices. cpu0 on every slice would
take ~30 core-hours here; `allintra` 7 on the middle slices is within 0.01 of its whole-volume figure above on every
cell but three, all k = 3 (`dbts_b4` +0.021, `dbts_c3` +0.015, `dbts_c4` +0.019).

| set | k = 0 | k = 2 | k = 3 |
| --- | --- | --- | --- |
| `dbts_a1` | 1.025 · 1.059 | 0.940 · 0.950 | 0.937 · 0.953 |
| `dbts_a2` | 1.032 · 1.063 | 0.941 · 0.951 | 0.937 · 0.954 |
| `dbts_a3` | 1.042 · 1.072 | 0.942 · 0.950 | 0.937 · 0.952 |
| `dbts_a4` | 1.043 · 1.072 | 0.943 · 0.951 | 0.937 · 0.951 |
| `dbts_a5` | 1.039 · 1.069 | 0.947 · 0.955 | 0.942 · 0.958 |
| `dbts_b1` | 0.963 · 0.974 | 0.936 · 0.944 | 0.953 · 0.971 |
| `dbts_b2` | 0.956 · 0.975 | 0.945 · 0.959 | 0.978 · 1.007 |
| `dbts_b3` | 0.961 · 0.981 | 0.935 · 0.946 | 0.948 · 0.970 |
| `dbts_b4` | 0.765 · 0.781 | 0.744 · 0.763 | 0.755 · 0.788 |
| `dbts_b5` | 0.789 · 0.808 | 0.774 · 0.788 | 0.796 · 0.819 |
| `dbts_c1` | 1.033 · 1.065 | 0.938 · 0.949 | 0.934 · 0.950 |
| `dbts_c2` | 1.053 · 1.084 | 0.950 · 0.958 | 0.943 · 0.957 |
| `dbts_c3` | 1.048 · 1.081 | 0.942 · 0.953 | 0.935 · 0.973 |
| `dbts_c4` | 1.050 · 1.086 | 0.941 · 0.953 | 0.933 · 0.972 |
| `dbts_c5` | 1.038 · 1.069 | 0.941 · 0.953 | 0.937 · 0.955 |

## Decode (2026-10-08)

Row SPLITTIME's `decode.mjs` unchanged, every 8th slice of each volume (130 frames, hard-linked into
`$W/dbtscale-dec` with a `manifest.json` of their checksums), headless Chromium 141, 8 rounds, 1× and 4× interleaved,
the host otherwise idle: **8 320/8 320 frames exact**. HTJ2K is ms a frame, median of round medians, 1× · 4×; each
arm the median of round-paired ratios to it. Every AV1 arm here is WebCodecs' (every stream ≤ 10 bits) but k = 0 at
12 bits, which is dav1d-WASM's.

| set | HTJ2K, ms | k = 0 | k = 2 | k = 3 |
| --- | --- | --- | --- | --- |
| `dbts_a1` | 33.0 · 126 | 6.10 · 7.16 | 3.43 · 3.84 | 3.30 · 3.29 |
| `dbts_a2` | 30.3 · 135 | 6.30 · 6.39 | 3.86 · 3.51 | 3.25 · 3.01 |
| `dbts_a3` | 26.0 · 90.7 | 6.08 · 7.47 | 3.60 · 4.05 | 3.22 · 3.56 |
| `dbts_a4` | 40.7 · 164 | 7.50 · 7.87 | 4.01 · 4.16 | 3.35 · 3.45 |
| `dbts_a5` | 28.0 · 113 | 6.38 · 6.87 | 3.80 · 3.78 | 3.26 · 3.25 |
| `dbts_b1` | 97.9 · 429 | 3.45 · 3.33 | 2.50 · 2.37 | 2.58 · 2.34 |
| `dbts_b2` | 70.1 · 308 | 3.72 · 3.87 | 2.64 · 2.46 | 2.98 · 2.77 |
| `dbts_b3` | 67.8 · 283 | 3.99 · 3.91 | 2.78 · 2.51 | 2.64 · 2.57 |
| `dbts_b4` | 61.9 · 279 | 3.16 · 3.00 | 2.25 · 2.00 | 2.30 · 1.99 |
| `dbts_b5` | 65.0 · 252 | 2.98 · 3.08 | 2.11 · 2.09 | 2.26 · 2.28 |
| `dbts_c1` | 33.1 · 140 | 5.35 · 5.52 | 3.28 · 3.32 | 2.94 · 2.87 |
| `dbts_c2` | 25.3 · 106 | 7.26 · 7.55 | 4.10 · 3.99 | 3.68 · 3.36 |
| `dbts_c3` | 39.0 · 161 | 5.89 · 6.54 | 3.62 · 3.69 | 3.25 · 3.24 |
| `dbts_c4` | 21.3 · 78.8 | 5.33 · 6.17 | 3.47 · 3.61 | 2.95 · 3.18 |
| `dbts_c5` | 29.8 · 133 | 6.59 · 6.61 | 3.86 · 3.40 | 3.53 · 3.05 |

**No AV1 arm decodes as fast as HTJ2K on any volume in any round** (0/8 faster, every cell). The fastest arm is
k = 3 at 12 bits, 2.87–3.68× HTJ2K's time a frame, and at 10 bits k = 2 or k = 3, 1.99–2.64× (k = 2 alone
2.00–2.78×); row SPLITTIME's two DBT volumes were 3.07 · 2.83 (12-bit, k = 3) and 2.61 · 2.27 (10-bit, k = 2),
inside these ranges.
