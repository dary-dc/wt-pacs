# Disk access — later ideas (lane closed)

**2026-08-30** · L3 ships **mmap + `spawn_blocking` pre-touch** (`send_one_frame`).  
This page is a parking lot only. Do not treat items below as open blockers.

Evidence already in-tree:

- [`docs/lanes/L3-executor-stall.md`](lanes/L3-executor-stall.md) — lane brief  
- [`docs/disk-access-campaign.md`](disk-access-campaign.md) — metrics / arms  
- [`docs/measurements/r2/DISK_ACCESS_CAMPAIGN.md`](measurements/r2/DISK_ACCESS_CAMPAIGN.md) — raw cells  
- [`docs/disk-access-prior-art.md`](disk-access-prior-art.md) — industry prior art  

---

## Done / closed

| Item | Status |
| --- | --- |
| Cold mmap must not run on the Tokio executor | **Shipped** (L3) |
| Compare mmap-blocking vs `pread` vs willneed* | **Measured** (Wave A/B) |
| WILLNEED-only on the executor | **Rejected** as a stall fix |

---

## Worth trying later (not now)

| Idea | Why it might help | Cost / risk |
| --- | --- | --- |
| **`mincore` hybrid** | Skip `spawn_blocking` when pages are already resident → remove ~10 µs warm hop | Extra syscall; platform quirks |
| **Dedicated fault thread pool** (Mimir-style) | Cap how many threads may sit in major faults; isolate from other `spawn_blocking` work | More plumbing |
| **Re-run Wave A on a real study disk / Oracle volume** | Overlayfs understates cold I/O; confirm ranking | Rig time only |
| **`io_uring` read** | Await cold I/O without a userspace pool hop | Complexity; biggest win off page-cache / deep QD |
| **Ask-queue prefetch (ahead-N)** | Prefault next frames when a real window exists | Needs product queue; wrong guesses waste I/O |
| **Zero-copy file→wire** (`sendfile` / splice) | Kernel path for TCP static files | Unlikely to plug into userspace QUIC/WebTransport cleanly |
| **Layout / page-align fixtures** | Fewer partial pages per frame | Fixture / packer change |
| **`O_DIRECT` + app cache** | Bypass page cache | Usually wrong for revisitable medical studies |

---

## Explicit non-goals

- Load entire study into process RAM  
- SPDK / userspace NVMe for SBND-on-filesystem  
- More willneed-on-executor variants  

When revisiting, start from prior art + this list; do not re-open “is mmap secretly blocking?”
