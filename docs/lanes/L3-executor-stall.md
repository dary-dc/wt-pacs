# Lane L3 — keep page faults off the executor

> ⚠️ **Evidence under review — see [`docs/l3-disk-access-evidence-review.md`](../l3-disk-access-evidence-review.md). The lane's invariant stands; the hybrid gate that shipped for it does not survive a >RAM cell.**

**Status: implemented (always-touch L3 v1); evidence under review — gate contested.**  
See [`docs/adr-frame-disk-access.md`](../adr-frame-disk-access.md).  
Optional leftovers: [`docs/disk-access-later.md`](../disk-access-later.md).

## Purpose

`FrameStore` uses `mmap`. A cold page fault happens **on the async executor**, so it stalls the whole
session task — every other frame in that session waits behind it.

E3 measured the floor (`.local/measurements/E3_COLD_PAGE_SUMMARY.md`):

| `frames_250k` | p50 | p99 | runtime stall |
| --- | --- | --- | --- |
| warm | 0.86 µs | 1.4 µs | 0 |
| **cold** | 28 µs | **19 ms** | mean 73 µs, max 190 µs |

This is not an edge case: a DBT series is ~570 MB against under 1 GB of page cache, so the first read
of a study is entirely cold.

**The invariant is already decided and is not yours to re-open: a page fault must not occur on the
executor.** Your job is to implement it and measure the result.

## The change

Keep `mmap` — it avoids a full-frame copy that `pread` would reintroduce. Instead **pre-touch the
frame's pages inside `spawn_blocking`** before the payload is written.

Subtlety that makes or breaks this: **wrapping `frame_slice()` alone does nothing.** The fault occurs
when `write_all` reads the slice, which is on the executor. The touch must happen inside the blocking
hop — one byte per 4 KiB page (61 touches for a 250 KB frame), so the pages are resident by the time
the write reads them.

Keep the warm path cheap. If the pages are already resident the touch is a few hundred nanoseconds;
do not add a copy, an allocation, or a second mapping.

## Verify

Extend `lab/cold-page-bench` with an arm for the new path and compare against the existing floor.

| | must |
| --- | --- |
| cold runtime stall | **→ ~0** (was mean 73 µs, max 190 µs) |
| cold p99 | may stay high — the fault still costs; it just no longer blocks the executor |
| warm p50 | **stays ≈ 1 µs** — if the blocking hop makes the warm path materially worse, report it and stop |

E3 used `posix_fadvise(DONTNEED)`, not `drop_caches`, so **no root is required** — the same method
works in your container. Use the same method so the numbers are comparable to the floor.

## Report

To `docs/measurements/r2/`: before/after table on the columns above, plus the diff.

Raw numbers. Do not conclude that mmap "beats" `pread` — that comparison is a later question and
needs `MADV_WILLNEED` and io_uring arms to be meaningful.

## Scope

`server/src/media/frame_store.rs` and its call site, plus `lab/cold-page-bench`. Nothing else — other
lanes own other files. Branch, do not push to `main`.

## Landed

- `FrameStore::touch_frame_pages` + `send_one_frame` `spawn_blocking` pre-touch
- Broader arm comparison: `docs/measurements/r2/DISK_ACCESS_CAMPAIGN.md`
- Prior art: `docs/disk-access-prior-art.md` · later ideas: `docs/disk-access-later.md`
