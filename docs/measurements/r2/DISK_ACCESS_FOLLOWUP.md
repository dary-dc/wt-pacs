# Disk-access follow-up — hybrid & dedicated pool

> ⚠️ **Evidence under review — see [`docs/l3-disk-access-evidence-review.md`](../../l3-disk-access-evidence-review.md). Raw TSV is sound; the warm ranking compares arms that do different work (the mmap arms never read the frame bytes), and the `stall_*` columns are at instrument noise.**

**Host:** cloud agent container (overlayfs) · **Branch:** `cursor/l3-executor-stall-bc88`  
**TSV:** [`disk_access_followup.tsv`](disk_access_followup.tsv) · 60 cells  
**Arms:** naive · blocking_touch (L3) · **hybrid_mincore** · dedicated_pool · pread  
**Axes:** cold/warm × forward/reverse/random × frames_32k / frames_250k  

Product path now uses **hybrid**: `mincore` on the executor; `spawn_blocking` touch only when cold.

---

## Headline — `frames_250k` forward

### Warm (steady path — where hop tax matters)

| Arm | later p50 | hop p50 | series wall | bytes copied | stall n |
| --- | ---: | ---: | ---: | ---: | ---: |
| mmap_naive | 0.95 µs | 0 | 80 µs | 0 | 1 |
| **mmap_hybrid_mincore** | **0.40 µs** | **0** | **40 µs** | 0 | 1 |
| mmap_blocking_touch (always hop) | 10.6 µs | 10.4 µs | 1.05 ms | 0 | 2 |
| mmap_dedicated_pool | 10.1 µs | 9.9 µs | 0.99 ms | 0 | 1 |
| pread_blocking | 35.2 µs | 35.2 µs | 3.3 ms | 20 MB | 4 |

### Cold (safety — stall samples)

| Arm | later p50 | stall max | stall n | bytes copied |
| --- | ---: | ---: | ---: | ---: |
| mmap_naive | 110 µs | **8.6 ms** | **1** | 0 |
| mmap_blocking_touch | 157 µs | 0.81 ms | **15** | 0 |
| **mmap_hybrid_mincore** | 166 µs | 0.66 ms | **15** | 0 |
| mmap_dedicated_pool | 159 µs | 1.5 ms | **16** | 0 |
| pread_blocking | 254 µs | 0.67 ms | **20** | 20 MB |

---

## Within-run reading

1. **Hybrid wins the warm path** among safe arms: hop p50 = 0, later p50 sub‑µs — close to naive speed without cold freeze.
2. **Hybrid stays executor-safe when cold** (stall n ≈ 15, same class as always-hop L3).
3. **Dedicated fault thread ≈ Tokio `spawn_blocking`** here — no material win; adds a private queue for isolation only.
4. **`pread` remains the copy-heavy option** (20 MB/series @ 250 KB×80); warm later ~3× hybrid/L3 hop path.

Absolute cold I/O still overlayfs-limited; ranking is what matters.
