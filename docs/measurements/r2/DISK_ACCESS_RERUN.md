# Disk-access re-run (fixed instrument) — 2026-08-31

**Host:** cloud agent container (overlayfs, ~16 GB RAM) · **Branch:** `cursor/l3-executor-stall-bc88`  
**Spec:** [`docs/l3-disk-access-evidence-review.md`](../../l3-disk-access-evidence-review.md) §6–§7  
**Harness:** `lab/disk-access-bench` / `lab/cold-page-bench` after A1–A5 / B1–B3 fixes  

**Instrument changes vs prior campaigns:** co-tenant `yield_now` gaps (not sleep heartbeat);
per-frame await + quinn-shaped `write_sim`; every arm consumes bytes the same way; cold =
one pass; `--repeats 5`; streamed cold copies with Drop cleanup; mempressure script asserts a
real cgroup limit (in-process `--require-cgroup-mem-bytes`).

> **Harness location:** `lab/disk-access-bench` and `lab/scripts/run_disk_access_mempressure.sh`
> were pruned from this essentialist tip; restore from git at `ca94a87` (or any ancestor) to re-run.

Prior campaign TSVs / stall columns remain as **raw history only** (in git) — do not cite for decisions.

---

## Metric glossary

| Column | Meaning |
| --- | --- |
| `later_p50_ns` | Median per-frame prep+write cost after the first ask |
| `hop_p50_ns` | Median `spawn_blocking` (or dedicated) round trip when the arm hops |
| `gap_p50/p99/max_ns` | Co-tenant `yield_now` poll gaps — how long the executor was unavailable to another task |
| `gap_samples` | Number of co-tenant gap samples (not a safety flag) |
| `other_later_p50/p99_ns` | Multi-session: latency of background warm sessions during the primary worker. **Lead with p99** for neighbour safety. |
| `other_asks` | Total background asks completed (should outlast primary wall) |
| `chunk` | Simulated flow-control write chunk (16 KiB = backpressured; 256 KiB ≈ one chunk/frame) |
| `bytes_copied` | Explicit pool `pread` bytes (mmap arms = 0 for the access step; quinn copy is separate) |

**“Consume” differs by tool:** `disk-access-bench` does a full chunked copy (`write_sim`);
`cold-page-bench` touches one byte per page. Their warm floors (~30 µs vs ~1 µs) are **not
comparable** across tools.

---

## Acceptance smoke (arm parity · warm · `frames_250k` 80×250 KB)

Naive and hybrid agree within noise once both consume bytes (F5 fixed). Always-touch pays the hop.

| Arm | chunk 16 KiB later p50 (3 reps median) | chunk 256 KiB |
| --- | ---: | ---: |
| mmap_naive | ~14.7 µs | ~9.5 µs |
| mmap_hybrid_mincore | ~15.2 µs | ~9.9 µs |
| mmap_blocking_touch | ~22.6 µs | ~16.6 µs |

### One-pass cold (`cold-page-bench`, this host)

| Fixture | cold frames | naive cold p50 (this host) | Notes |
| --- | ---: | ---: | --- |
| `lab/fixtures/frames_250k/frames_250k.sbnd` | 80 | **~150 µs** | Was 349–600 ns with `i % n` (F4). Second-review host ~18–22 µs — absolute µs vary; both ≫ sub‑µs artifact. |
| `lab/fixtures/frames_250k_live/frames_250k_live.sbnd` | 320 | **~140 µs** | Second-review host reported ~1.1 ms — name the fixture when quoting. |

---

## C2 — Multi-session (neighbour safety)

TSV: [`disk_access_multisession.tsv`](disk_access_multisession.tsv)  

```bash
./target/release/disk-access-bench \
  --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
  --arm mmap-naive --arm mmap-blocking-touch --arm mmap-hybrid-mincore --arm pread-blocking \
  --temp warm --temp cold --trace forward --access full \
  --chunk 16384 --repeats 5 \
  --sessions 4 --session-asks 400 \
  --out docs/measurements/r2/disk_access_multisession.tsv
```

Backgrounds are sized to **outlast** the cold primary (`other_asks=1600` vs primary wall ~44–80 ms).
Background sessions always use always-touch — this cell measures **how the primary’s arm hurts
neighbours**, not whether the hop tax survives when all N sessions use the arm under test.

Median across 5 repeats — **lead with other p99**:

| Arm | Cold other p99 | Cold other p50 | Warm other p99 | Primary warm later p50 |
| --- | ---: | ---: | ---: | ---: |
| mmap_naive | **~389 µs** | ~133 µs | ~67 µs | ~47 µs |
| mmap_blocking_touch | ~126 µs | ~47 µs | ~65 µs | ~46 µs |
| mmap_hybrid_mincore | ~143 µs | ~47 µs | ~66 µs | ~47 µs |
| pread_blocking | ~182 µs | ~50 µs | ~97 µs | ~84 µs |

**Reading:** cold naive inflates neighbour **p99** (~3× always-touch). Always-touch / hybrid / pread
keep neighbours near the warm baseline on this no-pressure cell. Warm hop cost shows on the
**primary** later p50 in other campaigns (~10–30 µs); neighbours stay similar when the primary is
warm — state hop-worth from primary numbers, not as a background-arm result.

Earlier short-background run (`--session-asks 80`) archived as
[`disk_access_multisession_sessions4_asks80.tsv`](disk_access_multisession_sessions4_asks80.tsv)
(backgrounds finished before primary was ~⅓ done).

---

## C1 — Memory pressure (48 MiB cgroup · 80 MB study)

TSV: [`disk_access_mempressure.tsv`](disk_access_mempressure.tsv)  

```bash
lab/scripts/run_disk_access_mempressure.sh 48M -- \
  --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
  --arm mmap-naive --arm mmap-blocking-touch --arm mmap-hybrid-mincore --arm pread-blocking \
  --temp cold --trace forward --access full \
  --chunk 16384 --repeats 5 \
  --out docs/measurements/r2/disk_access_mempressure.tsv
```

Script prints `fstype=cgroup2fs` (or v1) and the bench prints `cgroup mem assert ok` — abort if either is missing.

Worst co-tenant **gap_max** (µs), 5 runs on **this** host:

| Arm | gap_max runs | median gap_max |
| --- | --- | ---: |
| mmap_naive | 1979–2119 | **~1993 µs** |
| **mmap_hybrid_mincore** | 72, 72, 78, **2267, 2268** | ~78 µs median; **2/5 runs ~2.3 ms** |
| mmap_blocking_touch | 57–78 | **~62 µs** |
| pread_blocking | 33–57 | **~54 µs** |

**Reading:** the gate is **unsafe under pressure**, with a **host-dependent hit rate**. On this host
millisecond-class hybrid gaps appeared in 2/5 runs; an independent second-review host saw **5/5 at
naive’s magnitude** (~6–13 ms). Do not describe hybrid pressure failure as a rare outlier.
Always-touch and pread stay tens–low-hundreds of µs. Gate is **not** cleared for product.
`pread` vs always-touch per-frame cost under pressure **flips by host** — settle with pooled
buffers (D3), not a fresh `Vec` per ask.

---

## Product path

`send_one_frame` uses **unconditional** `spawn_blocking(touch_frame_pages)` (L3 v1).
`frame_pages_resident` remains a lab helper. Gate returns only with verification (D2) if a future
cell clears both C1 worst-case **and** a fair all-sessions hop-cost cell.

---

## D3 — Pooled-buffer `pread` vs always-touch

TSVs: [`disk_access_pread_pooled.tsv`](disk_access_pread_pooled.tsv) ·
[`disk_access_pread_pooled_mempressure.tsv`](disk_access_pread_pooled_mempressure.tsv)

```bash
./target/release/disk-access-bench \
  --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
  --arm mmap-blocking-touch --arm pread-blocking --arm pread-blocking-pooled \
  --temp warm --temp cold --trace forward --access full \
  --chunk 16384 --repeats 5 \
  --out docs/measurements/r2/disk_access_pread_pooled.tsv

lab/scripts/run_disk_access_mempressure.sh 48M -- \
  --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
  --arm mmap-blocking-touch --arm pread-blocking --arm pread-blocking-pooled \
  --temp cold --trace forward --access full \
  --chunk 16384 --repeats 5 \
  --out docs/measurements/r2/disk_access_pread_pooled_mempressure.tsv
```

Median across 5 repeats (this host):

| Arm | Warm later p50 | Cold later p50 | Cold mempressure later p50 | Cold mempressure gap_max |
| --- | ---: | ---: | ---: | ---: |
| mmap_blocking_touch | **~22.5 µs** | ~190 µs | ~219 µs | ~65 µs |
| pread_blocking (fresh `Vec`) | ~55.2 µs | ~94 µs | ~125 µs | ~57 µs |
| **pread_blocking_pooled** | ~52.8 µs | ~92 µs | ~119 µs | ~68 µs |

**Reading:** pooling removes little (~2–6 µs) vs a fresh `Vec`. On the **warm/common path**, always-touch
stays ~2× faster than pooled `pread` and avoids the second full-frame copy. Under cold/pressure,
`pread` can win later_p50 (I/O + hop shape) while gap_max stays in the same safe class — that does
**not** overturn the default: mmap always-touch remains preferred; pooled `pread` stays the hard-guarantee escape hatch. Absolute ranking can still flip by host; copy count (1 vs 2) does not.

