# opfs — what an OPFS frame cache costs from a worker

Throwaway probe for the frame-path review: an OPFS cache of decoded frames, one file per frame, written
through `FileSystemSyncAccessHandle` from a dedicated worker, in headless Chromium. Every number is from
one run of the command below; nothing here is a product claim.

## What was run

`run.mjs` serves `page.html`, `worker.js` and `nested.js` from a tiny node static server on `127.0.0.1`
(a secure context; the server also sends COOP/COEP so the worker clock is 5 µs instead of 100 µs — OPFS
itself needs no cross-origin isolation). Each round launches a fresh on-disk profile
(`launchPersistentContext`, so storage is the disk backend, not an in-memory one), opens the page once and
runs, for each frame size in a rotated order (sizes interleaved within the round):

1. **write** — in the page's dedicated worker: `navigator.storage.getDirectory()`, a series directory, then
   per frame: `getFileHandle(create:true)`, `createSyncAccessHandle()`, one `write()` of S bytes from a
   `Uint8Array`, `close()`, each timed separately.
2. **read** — the 20 files back: `getFileHandle()`, `createSyncAccessHandle()`, `getSize()`, one `read()`
   into a reused S-byte buffer, `close()`. The files were just written, so this is a warm read; a cold
   read was not measured.
3. **preopen** — the pipelined variant: all 20 handles (`getFileHandle` + `createSyncAccessHandle`) created
   first while nothing else runs, then `write` + `close` per frame. The handle columns are the idle handle
   cost; the write/close columns are what is left on a decoder's critical path.
4. **nested** — the same write loop in a worker started by the worker (`nested.js`).
5. **three** — three workers of `worker.js` writing 20 frames each to different files at the same time.

Then once per round: a directory of 1000 small files created serially and listed with
`for await (const k of dir.keys())`, and `navigator.storage.estimate()` from the worker.

Frame sizes: 524288 B (CT 512² 16-bit), 1669104 B (DBT 614×1359 16-bit), 17039360 B (mammogram 2560×3328
16-bit). 7 rounds × 20 frames; the per-frame median [min … max] below is over all 140 samples (420 for the
three-writer cell). MB = 10^6 bytes; MB/s uses the median.

**Engine:** chromium 153.0.8010.12 — `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like
Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36`, `crossOriginIsolated=true`.
**Firefox was not run:** no binary on this machine (`which firefox` empty, no firefox folder under
`/opt/pw-browsers`, `FIREFOX_PATH` unset); `--browser firefox` prints the same and exits.
**Host:** 4 cores, Intel Xeon @ 2.10 GHz, Linux 6.18, 16 GB, a container on a virtio disk. These numbers
are indicative only — the same probe on a phone is a different measurement.

## Re-run

```bash
node lab/target-review/opfs/run.mjs                       # 7 rounds, 20 frames, chromium
node lab/target-review/opfs/run.mjs --rounds 7 --frames 20 --browser chromium --profile "$SCRATCH"
```

`--profile DIR` is where the per-round profiles go (default `os.tmpdir()`; each round writes ~2.3 GB there
and removes it). Tables print to stdout, progress to stderr.

## Results
### Sequential write, dedicated worker (handle created, then written, per frame)

| frame | getFileHandle ms | createSyncAccessHandle ms | write ms | close ms | MB/s (write only) | MB/s (all steps) | n |
|---|---:|---:|---:|---:|---:|---:|---:|
| CT 512² 16-bit 0.52 MB | 0.805 [0.455 … 3.745] | 0.505 [0.335 … 3.585] | 0.410 [0.320 … 4.405] | 0.330 [0.195 … 1.105] | 1279 | 251 | 140 |
| DBT 614×1359 16-bit 1.67 MB | 0.770 [0.510 … 3.540] | 0.450 [0.330 … 1.640] | 0.640 [0.530 … 0.955] | 0.385 [0.250 … 0.675] | 2608 | 742 | 140 |
| mammo 2560×3328 16-bit 17.04 MB | 0.965 [0.545 … 3.910] | 0.555 [0.370 … 3.265] | 4.165 [3.465 … 93.5] | 0.535 [0.370 … 2.870] | 4091 | 2705 | 140 |

### Read-back, dedicated worker (into one reused buffer)

| frame | getFileHandle ms | createSyncAccessHandle ms | getSize ms | read ms | close ms | MB/s (read only) | MB/s (all steps) | n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| CT 512² 16-bit 0.52 MB | 0.270 [0.190 … 1.830] | 0.415 [0.305 … 1.170] | 0.005 [0.000 … 0.045] | 0.075 [0.060 … 0.305] | 0.320 [0.210 … 2.725] | 6991 | 470 | 140 |
| DBT 614×1359 16-bit 1.67 MB | 0.285 [0.195 … 0.885] | 0.425 [0.325 … 2.020] | 0.005 [0.000 … 0.055] | 0.225 [0.200 … 1.040] | 0.405 [0.250 … 2.610] | 7418 | 1218 | 140 |
| mammo 2560×3328 16-bit 17.04 MB | 0.335 [0.210 … 0.945] | 0.500 [0.340 … 1.670] | 0.005 [0.000 … 0.045] | 2.290 [2.120 … 10.5] | 0.560 [0.365 … 6.195] | 7441 | 4443 | 140 |

### Pre-opened handles: all 20 handles created while nothing else runs, then write+close each

| frame | getFileHandle ms | createSyncAccessHandle ms | write ms | close ms | MB/s (write only) | MB/s (all steps) | n |
|---|---:|---:|---:|---:|---:|---:|---:|
| CT 512² 16-bit 0.52 MB | 0.735 [0.420 … 2.145] | 0.475 [0.320 … 0.735] | 0.375 [0.280 … 2.230] | 0.310 [0.205 … 1.550] | 1398 | 265 | 140 |
| DBT 614×1359 16-bit 1.67 MB | 0.740 [0.375 … 2.015] | 0.470 [0.300 … 1.100] | 0.660 [0.535 … 6.650] | 0.395 [0.245 … 0.860] | 2529 | 742 | 140 |
| mammo 2560×3328 16-bit 17.04 MB | 0.705 [0.340 … 1.780] | 0.455 [0.300 … 1.220] | 4.090 [3.510 … 83.7] | 0.600 [0.365 … 3.130] | 4166 | 2826 | 140 |

### Nested worker (worker started by a worker): createSyncAccessHandle works

| frame | getFileHandle ms | createSyncAccessHandle ms | write ms | close ms | MB/s (write only) | MB/s (all steps) | n |
|---|---:|---:|---:|---:|---:|---:|---:|
| CT 512² 16-bit 0.52 MB | 0.870 [0.490 … 3.500] | 0.540 [0.355 … 1.860] | 0.470 [0.300 … 3.220] | 0.365 [0.225 … 1.770] | 1116 | 231 | 140 |
| DBT 614×1359 16-bit 1.67 MB | 0.860 [0.540 … 5.150] | 0.515 [0.360 … 1.965] | 0.725 [0.560 … 10.3] | 0.415 [0.310 … 1.085] | 2302 | 649 | 140 |
| mammo 2560×3328 16-bit 17.04 MB | 0.985 [0.560 … 1.775] | 0.575 [0.390 … 5.605] | 4.305 [3.550 … 89.2] | 0.555 [0.270 … 3.055] | 3958 | 2632 | 140 |

### Three workers writing different files at once (errors: "none")

| frame | getFileHandle ms | createSyncAccessHandle ms | write ms | close ms | MB/s (write only) | MB/s (all steps) | n |
|---|---:|---:|---:|---:|---:|---:|---:|
| CT 512² 16-bit 0.52 MB | 0.885 [0.395 … 7.745] | 0.615 [0.335 … 4.665] | 0.535 [0.240 … 8.240] | 0.435 [0.185 … 3.920] | 980 | 188 | 420 |
| DBT 614×1359 16-bit 1.67 MB | 0.920 [0.450 … 7.780] | 0.625 [0.345 … 5.440] | 1.030 [0.505 … 15.5] | 0.480 [0.170 … 7.735] | 1620 | 439 | 420 |
| mammo 2560×3328 16-bit 17.04 MB | 1.115 [0.485 … 7.640] | 0.760 [0.340 … 7.035] | 5.080 [3.700 … 104.4] | 0.635 [0.265 … 11.5] | 3354 | 1833 | 420 |

### Directory of 1000 files

| step | ms |
|---|---:|
| create 1000 files (getFileHandle create:true, serial) | 628.1 [371.4 … 899.1] |
| for await (const k of dir.keys()) — 1000 keys | 19.8 [13.5 … 41.3] |

### navigator.storage.estimate() from the worker

{"exists":true,"value":{"quota":13045563326,"usage":2308145086,"usageDetails":{"fileSystem":2308145086}}}

## Reading

* **Per-frame fixed cost, write path:** `getFileHandle(create:true)` ≈ 0.8 ms + `createSyncAccessHandle`
  ≈ 0.5 ms + `close` ≈ 0.35 ms, independent of size. For a CT frame that is 4× the write itself; the
  "all steps" column is what a decoder pays per frame (≈ 2 ms for CT, 2.2 ms for DBT, 6 ms for a mammogram).
* **The write median is a copy into the page cache,** not a disk rate: 17 MB in 4.2 ms. The max column
  carries writeback stalls of 60–100 ms on the mammogram size, in every variant. The disk's rate is not
  what this probe measures.
* **Pre-opening removes ~1.2 ms per frame** from the critical path: write+close with a handle opened
  earlier costs the same as in the sequential loop, and the handle pair costs the same when opened idle.
* **Read-back is warm** (just written): `read` ≈ 7 GB/s is a memcpy, and `getFileHandle` without
  `create` is ~0.3 ms, a third of the create cost. The handle pair + close (≈ 1.2 ms) dominates CT and DBT
  reads. `getSize` is free.
* **Nested worker: yes.** `createSyncAccessHandle` works in a worker started by a worker, at the same cost.
* **Three writers, different files: no error** in 7 rounds × 3 sizes. Write medians are 20–60% higher and
  the tails longer, which is three workers sharing 4 cores with the browser, not the lock.
* **1000 keys list in ~20 ms**; creating them serially costs ~0.63 ms per `getFileHandle(create:true)`.
* **`navigator.storage.estimate()` exists in the worker** and reports `quota`, `usage` and
  `usageDetails.fileSystem` (usage here is the ~2.3 GB this round wrote).
