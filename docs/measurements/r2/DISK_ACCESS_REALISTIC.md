# Disk-access realistic final wave

> ⚠️ **Evidence under review — see [`docs/l3-disk-access-evidence-review.md`](../../l3-disk-access-evidence-review.md). Raw TSV is sound; same two caveats as the earlier waves, and no cell here puts the working set above the page cache.**

**Host:** cloud agent container (overlayfs) · **Branch:** `cursor/l3-executor-stall-bc88`  
**TSV:** [`disk_access_realistic.tsv`](disk_access_realistic.tsv) · 90 cells  
**Harness:** `lab/disk-access-bench --realistic`  
**Study:** `frames_250k_live` (320 × 250 KB ≈ 80 MB)  
**Arms:** decision set — naive · blocking_touch · **hybrid_mincore** · dedicated_pool · pread  

## What this wave adds

Earlier waves used short synthetic orders (80 frames, forward/reverse/random) and **full-frame** touch.
This wave asks whether the hybrid decision still holds when:

| Axis | What we ran |
| --- | --- |
| **Large series** | 320-frame study; forward + reverse over the whole series |
| **User-like ask order** | `lab/traces/live_cell_scroll.json` — 500 asks, 300 unique, reversal @ 60% |
| **Partial access** | `full` · `prefix_4k` (1 page) · `prefix_64k` (early-layer / partial HTJ2K proxy) |

Prefix modes touch/`mincore`/`pread` only the first N bytes. Product today still serves **full** frames; prefixes stress “what if we only needed early bytes.”

Evidence ≤ T2 (lab / overlayfs). Rank arms within this run.

---

## Headline — warm `live_cell_scroll` (steady path)

### Full frame (product-shaped)

| Arm | later p50 | hop p50 | series wall | bytes copied |
| --- | ---: | ---: | ---: | ---: |
| mmap_naive | 0.88 µs | 0 | 0.51 ms | 0 |
| **mmap_hybrid_mincore** | **0.64 µs** | **0** | **0.36 ms** | 0 |
| mmap_blocking_touch | 12.2 µs | 12.0 µs | 6.8 ms | 0 |
| mmap_dedicated_pool | 11.7 µs | 11.4 µs | 6.1 ms | 0 |
| pread_blocking | 37.0 µs | 36.8 µs | 19.1 ms | **125 MB** |

### Prefix 4 KiB (header / one-page)

| Arm | later p50 | hop p50 | series wall | bytes copied |
| --- | ---: | ---: | ---: | ---: |
| **mmap_hybrid_mincore** | **0.33 µs** | **0** | **0.19 ms** | 0 |
| mmap_blocking_touch | 10.0 µs | 9.8 µs | 5.4 ms | 0 |
| pread_blocking | 11.0 µs | 10.8 µs | 5.8 ms | 2.0 MB |

### Prefix 64 KiB (partial codestream proxy)

| Arm | later p50 | hop p50 | series wall | bytes copied |
| --- | ---: | ---: | ---: | ---: |
| **mmap_hybrid_mincore** | **0.38 µs** | **0** | **0.22 ms** | 0 |
| mmap_blocking_touch | 10.3 µs | 10.1 µs | 5.7 ms | 0 |
| pread_blocking | 16.9 µs | 16.8 µs | 8.7 ms | 32.8 MB |

Warm hybrid stays hop-free and sub‑µs across full and prefix. Always-hop L3 stays ~10 µs. `pread` still copies; prefix shrinks the copy but does not beat hybrid.

---

## Headline — cold safety (`live_cell_scroll` · full)

| Arm | later p50 | stall max | stall n | note |
| --- | ---: | ---: | ---: | --- |
| mmap_naive | 169 µs | **54.9 ms** | **1** | executor froze for the series |
| **mmap_hybrid_mincore** | 125 µs | 1.5 ms | **50** | heartbeat kept running |
| mmap_blocking_touch | 121 µs | 1.1 ms | **49** | same safety class |
| pread_blocking | 96 µs | 1.3 ms | **57** | safe; copies 125 MB |

Same pattern on cold **forward/reverse** over 320 frames: naive `stall_n=1` / ~55 ms stall max; hybrid `stall_n` in the 50s with ~1 ms stall max.

---

## Large-series warm forward (320 frames · full)

| Arm | later p50 | hop p50 | series wall | bytes |
| --- | ---: | ---: | ---: | ---: |
| **mmap_hybrid_mincore** | **0.40 µs** | **0** | 0.15 ms | 0 |
| mmap_blocking_touch | 10.5 µs | 10.2 µs | 3.9 ms | 0 |
| pread_blocking | 35.1 µs | 35.0 µs | 11.6 ms | 80 MB |

Matches the earlier 80-frame follow-up ranking at larger N.

---

## Reading (decision unchanged)

1. **User-like traces do not flip the ranking.** Hybrid remains the warm winner and cold-safe.
2. **Partial / first-byte proxies do not flip it either.** Prefix makes `pread` less copy-heavy, but hybrid still wins warm later/hop; cold naive still freezes.
3. **Dedicated pool ≈ `spawn_blocking`** on this host under these traces — still no product reason to special-case.
4. Product path stays **full-frame** hybrid; prefix APIs stay lab/helpers unless progressive serve lands later.

Absolute µs remain overlayfs-limited; optional real-disk confirm is still non-blocking (`docs/disk-access-later.md`).
