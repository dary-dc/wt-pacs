# Disk access — later ideas

**2026-08-30** · Baseline + hybrid shipped; **ADR:** [`docs/adr-frame-disk-access.md`](adr-frame-disk-access.md).  
Shareable summary: [`docs/disk-access-team-brief.md`](disk-access-team-brief.md).

---

## Done

| Item | Status |
| --- | --- |
| Cold mmap must not run on the Tokio executor | **Done** |
| mmap-blocking vs `pread` vs willneed* | **Measured** |
| WILLNEED-only on executor | **Rejected** |
| **`mincore` hybrid** (skip hop when resident) | **Done** — product path + follow-up TSV |
| ADR | **Written** |

---

## Still optional later

| Idea | Note |
| --- | --- |
| Dedicated fault thread under **product** load | Lab hop ≈ `spawn_blocking`; revisit if blocking pool contends |
| Wave A on **real study disk** / Oracle volume | Confirm ranking off overlayfs |
| **`io_uring` read** prototype | Only if leaving page-cache assumptions or needing deep QD |
| Ask-queue **ahead-N** prefetch | When a real client window exists |
| Layout / page-align fixtures | Packer experiment |

## Rejected / out of scope

| Idea | Note |
| --- | --- |
| `sendfile` / splice into QUIC | Userspace QUIC still copies |
| `O_DIRECT` + app cache | Wrong default for revisitable studies |
| SPDK / whole-study RAM | Explicit non-goals |
