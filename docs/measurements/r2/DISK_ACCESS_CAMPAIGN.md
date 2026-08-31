# Disk-access campaign — raw results

> ⚠️ **Evidence under review — see [`docs/l3-disk-access-evidence-review.md`](../../l3-disk-access-evidence-review.md). Raw TSV is sound; the `stall_*` columns are at instrument noise and `stall_samples` counts await points, not faults.**

**Host:** cloud agent container (overlayfs) · **Branch:** `cursor/l3-executor-stall-bc88`  
**Spec:** [`docs/disk-access-campaign.md`](../../disk-access-campaign.md)  
**TSV:** [`disk_access_campaign.tsv`](disk_access_campaign.tsv) · 72 cells (2 studies × 2 temps × 3 traces × 6 arms)  
**Harness:** `lab/disk-access-bench` · Evidence ≤ T2 — compare **within this run**, not to Oracle SP µs.

---

## Complexity scorecard

| Arm | Linux-only advice | Copies frame to heap | Needs lookahead | Stall risk on executor |
| --- | --- | --- | --- | --- |
| `mmap_naive` | N | N (touch only) | N | **Y** |
| `mmap_blocking_touch` | N | N | N | N (hop cost) |
| `pread_blocking` | N | **Y** (full frame) | N | N (hop + copy) |
| `mmap_willneed` | Y (`madvise`) | N | N | **Y** (touch still on executor) |
| `mmap_willneed_next` | Y | N | Y (next ask) | **Y** |
| `mmap_blocking_ahead_2` | N | N | Y (next ask) | N |

---

## Headline cells — `frames_250k` (80 × 250 KB)

Units: ns unless noted. `stall_samples` = heartbeat wakes during the series (more ⇒ runtime kept running).

### Cold · forward

| Arm | first | later p50 | series wall | stall max | stall n | bytes copied | hop p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| mmap_naive | 140 µs | 139 µs | 10.6 ms | **10.1 ms** | **1** | 0 | 0 |
| mmap_blocking_touch | 521 µs | 145 µs | 14.1 ms | 0.76 ms | **15** | 0 | 146 µs |
| pread_blocking | 800 µs | 115 µs | 16.9 ms | 1.4 ms | **17** | **20 MB** | 115 µs |
| mmap_willneed | 97 µs | 142 µs | 11.8 ms | **11.3 ms** | **1** | 0 | 0 |
| mmap_willneed_next | 151 µs | 104 µs | 7.6 ms | **7.1 ms** | **1** | 0 | 0 |
| mmap_blocking_ahead_2 | 914 µs | 157 µs | 16.1 ms | 0.76 ms | **17** | 0 | 157 µs |

### Cold · reverse

| Arm | first | later p50 | series wall | stall max | stall n | hop p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| mmap_naive | 229 µs | 185 µs | 14.7 ms | **14.2 ms** | **1** | 0 |
| mmap_blocking_touch | 516 µs | 210 µs | 17.1 ms | 0.64 ms | **18** | 210 µs |
| pread_blocking | 700 µs | 268 µs | 24.1 ms | 0.79 ms | **25** | 269 µs |
| mmap_willneed | 148 µs | 138 µs | 11.0 ms | **10.5 ms** | **1** | 0 |
| mmap_willneed_next | 164 µs | 97 µs | 9.1 ms | **8.6 ms** | **1** | 0 |
| mmap_blocking_ahead_2 | 1.6 ms | 191 µs | 19.0 ms | 0.84 ms | **20** | 192 µs |

### Warm · forward (steady path)

| Arm | later p50 | series wall | bytes copied | hop p50 | rss Δ |
| --- | ---: | ---: | ---: | ---: | ---: |
| mmap_naive | **0.89 µs** | 73 µs | 0 | 0 | 0 |
| mmap_blocking_touch | 10.5 µs | 1.1 ms | 0 | **10.2 µs** | 0 |
| pread_blocking | 34.9 µs | 3.3 ms | **20 MB** | 34.8 µs | 0 |
| mmap_willneed | 1.7 µs | 138 µs | 0 | 0 | 0 |
| mmap_willneed_next | 2.5 µs | 201 µs | 0 | 0 | 0 |
| mmap_blocking_ahead_2 | 10.8 µs | 1.1 ms | 0 | 10.6 µs | 0 |

---

## Same pattern on `frames_32k` (spot-check)

Cold forward: `mmap_naive` stall_n=1 / stall_max≈0.87 ms; `mmap_blocking_touch` stall_n=2; `pread_blocking` stall_n=2, copies 2.56 MB.  
Warm forward: naive later_p50 **52 ns**; blocking hop ≈10 µs; pread hop ≈13 µs + 2.56 MB copied.

---

## Within-run deltas that matter (not product conclusions)

1. **Executor stall:** only arms that leave faults/`touch` on the executor (`mmap_naive`, both `willneed*`) show `stall_samples=1` and multi‑ms `stall_max` on cold 250 KB. Blocking touch / pread / ahead_2 keep the heartbeat alive (teen samples).
2. **`madvise(WILLNEED)` alone does not fix stall** here — advice may help populate cache, but the timed touch still runs on the executor, so the runtime still freezes on cold.
3. **`pread_blocking` vs `mmap_blocking_touch` (cold 250 k forward):** similar stall behaviour; pread copies **20 MB**/series and pays a larger warm later_p50 (≈35 µs vs ≈10 µs hop for mmap blocking).
4. **Warm floor:** mmap touch without a hop stays sub‑µs; any `spawn_blocking` arm pays ~10 µs hop even when hot.
5. **Ahead-2** does not beat single-frame blocking touch on series wall in these cells; it costs more on first frame when cold.

Absolute cold I/O on overlay is milder than a spinning/remote disk would be; re-check Wave A winners on a real study volume before a product decision.

---

## Wave C not run

`io_uring` and layout-padded fixtures left for a follow-up if `pread` vs mmap-blocking remains too close on a real disk.
