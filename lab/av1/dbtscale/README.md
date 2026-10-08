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
