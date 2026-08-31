# Lane L3 — keep page faults off the executor

**Status: accepted — always-touch (L3 v1).**  
ADR: [`docs/adr-frame-disk-access.md`](../adr-frame-disk-access.md) ·
Evidence: [`docs/measurements/r2/DISK_ACCESS_RERUN.md`](../measurements/r2/DISK_ACCESS_RERUN.md).

## Purpose

`FrameStore` uses `mmap`. A cold page fault on the async executor stalls every task on that OS thread.
Invariant: **a major page fault must not run on the executor.**

## Landed

- `FrameStore::touch_frame_pages` + unconditional `spawn_blocking` in `send_one_frame`
- `mincore` gate evaluated and **rejected** as product default (unsafe under >RAM pressure)
- Pooled `pread` evaluated (D3) — escape hatch, not default

Optional leftovers: [`docs/disk-access-later.md`](../disk-access-later.md).
