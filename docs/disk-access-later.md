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
| Realistic access patterns (large series · user trace · prefix) | **Done** — `DISK_ACCESS_REALISTIC.md`; ranking unchanged |

---

## Still optional later

| Idea | Note |
| --- | --- |
| Dedicated fault thread under **product** load | Lab hop ≈ `spawn_blocking`; revisit if blocking pool contends |
| **Multi-session cold serve under load** | One runtime, many concurrent session tasks; one session goes cold while others keep asking. Measure **other sessions’** latency (p50/p99) during that cold serve — not only the cold session’s `later_p50`. Validates the scale concern: hybrid moves disk wait off the executor; naive freezes everyone on that thread. |
| Wave A on **real study disk** / Oracle volume | Confirm ranking off overlayfs |
| **`io_uring` read** prototype | Lab learning only — unlikely to beat hybrid on warm page-cache serve; try if leaving mmap assumptions or needing deep QD |
| Ask-queue **ahead-N** prefetch | When a real client window exists |
| Layout / page-align fixtures | Packer experiment |

## Rejected / out of scope

| Idea | Note |
| --- | --- |
| `sendfile` / splice into QUIC | Userspace QUIC still copies |
| `O_DIRECT` + app cache | Wrong default for revisitable studies |
| SPDK / whole-study RAM | Explicit non-goals |
