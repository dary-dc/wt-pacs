# Disk-access re-run (fixed instrument) — 2026-08-31

**Host:** cloud agent · **Branch:** `cursor/l3-executor-stall-bc88`  
**Spec:** [`docs/l3-disk-access-evidence-review.md`](../../l3-disk-access-evidence-review.md) §6–§7  
**Harness:** `lab/disk-access-bench` / `lab/cold-page-bench` after A1–A5 / B1–B3 fixes  

**Instrument changes vs prior campaigns:** co-tenant `yield_now` gaps (not sleep heartbeat);
per-frame await + quinn-shaped `write_sim`; every arm consumes bytes the same way; cold =
one pass; `--repeats 5`; streamed cold copies with Drop cleanup.

Prior `DISK_ACCESS_*.tsv` / stall columns remain as **raw history only** — do not cite for decisions.

---

## Metric glossary

| Column | Meaning |
| --- | --- |
| `later_p50_ns` | Median per-frame prep+write cost after the first ask |
| `hop_p50_ns` | Median `spawn_blocking` (or dedicated) round trip when the arm hops |
| `gap_p50/p99/max_ns` | Co-tenant `yield_now` poll gaps — how long the executor was unavailable to another task |
| `gap_samples` | Number of co-tenant gap samples (not a safety flag) |
| `other_later_*` | Multi-session cell: latency of background warm sessions during the primary worker |
| `chunk` | Simulated flow-control write chunk (16 KiB = backpressured; 256 KiB ≈ one chunk/frame) |
| `bytes_copied` | Explicit pool `pread` bytes (mmap arms = 0 for the access step; quinn copy is separate) |

---

## Acceptance smoke (arm parity · warm · 80×250 KB)

Naive and hybrid agree within noise once both consume bytes (F5 fixed). Always-touch pays the hop.

| Arm | chunk 16 KiB later p50 (3 reps median) | chunk 256 KiB |
| --- | ---: | ---: |
| mmap_naive | ~14.7 µs | ~9.5 µs |
| mmap_hybrid_mincore | ~15.2 µs | ~9.9 µs |
| mmap_blocking_touch | ~22.6 µs | ~16.6 µs |

`cold-page-bench` one-pass cold naive p50 ≈ **147 µs** (was sub‑µs with `i % n` — F4 fixed).

---

## C2 — Multi-session (`--sessions 4`)

TSV: [`disk_access_multisession.tsv`](disk_access_multisession.tsv) · study `frames_250k_live` · chunk 16 KiB · 5 repeats  

Median across repeats of **other sessions’** later p50 while the primary runs:

| Arm | Warm other p50 | Cold other p50 |
| --- | ---: | ---: |
| mmap_naive | ~50 µs | **~161 µs** |
| mmap_blocking_touch | ~47 µs | ~42 µs |
| mmap_hybrid_mincore | ~50 µs | ~43 µs |
| pread_blocking | ~48 µs | ~46 µs |

**Reading:** when the primary is cold, naive inflates **other** sessions (~3–4×). Always-touch / hybrid / pread keep other-session p50 near the warm baseline. On this no-pressure cold cell hybrid ≈ always-touch for *other* latency (gate still fires often enough inside cache). Warm hop saving does **not** show up as a win for other sessions — they look alike across arms when hot.

---

## C1 — Memory pressure (48 MiB cgroup · 80 MB study)

TSV: [`disk_access_mempressure.tsv`](disk_access_mempressure.tsv) · via `lab/scripts/run_disk_access_mempressure.sh 48M` · cold forward · 5 repeats  

Worst co-tenant **gap_max** per arm (µs), 5 runs:

| Arm | gap_max runs | median gap_max |
| --- | --- | ---: |
| mmap_naive | 1979–2119 | **~1993 µs** |
| **mmap_hybrid_mincore** | 72, 72, 78, **2267, 2268** | ~78 µs (but **2/5 runs ~2.3 ms**) |
| mmap_blocking_touch | 57–78 | **~62 µs** |
| pread_blocking | 33–57 | **~54 µs** |

**Reading:** under the ADR’s >RAM premise, hybrid’s **worst** gap matches naive’s millisecond class in 2/5 runs; always-touch and pread stay tens of µs. Gate is **not** cleared for product. Provisional ADR default (always-touch) stands. `pread` remains first-class on safety; copy cost is separate (D3 still open — pooled buffer).

---

## Product path

`send_one_frame` uses **unconditional** `spawn_blocking(touch_frame_pages)` (L3 v1). `frame_pages_resident` remains a lab helper. Gate returns only with verification (D2) if a future cell clears both C1 worst-case and C2 hop-worth.
