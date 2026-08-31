# Disk access — later ideas

**ADR (accepted):** [`docs/adr-frame-disk-access.md`](adr-frame-disk-access.md) ·
Re-run record: [`docs/measurements/r2/DISK_ACCESS_RERUN.md`](measurements/r2/DISK_ACCESS_RERUN.md).

---

## Done

| Item | Status |
| --- | --- |
| Cold mmap must not run on the Tokio executor | **Done** |
| Fixed instrument (gaps, write_sim, equal work, one-pass cold) | **Done** |
| C1 memory-pressure · C2 multi-session | **Done** |
| D3 pooled `pread` | **Done** — warm always-touch still preferred; default unchanged |
| Always-touch product path · ADR accepted | **Done** |
| `mincore` gate as product default | **Rejected** |

---

## Still optional later

| Idea | Note |
| --- | --- |
| Real study disk / Oracle volume (C3) | Ranking confirm off overlayfs |
| All-sessions hop-cost cell | Every session on the arm under test + throughput |
| Dedicated fault thread under product load | Only if blocking pool contends |
| `io_uring` lab | Unlikely to beat warm page-cache mmap |
| Ask-queue ahead-N prefetch | When a real client window exists |
| Gate + verification (D2) | Only if a future regime clears C1 with a lease-like check |

## Rejected / out of scope

| Idea | Note |
| --- | --- |
| `sendfile` / splice into QUIC | Userspace QUIC still copies |
| `O_DIRECT` + app cache | Wrong default for revisitable studies |
| SPDK / whole-study RAM | Explicit non-goals |
| Product `frame_prefix_*` APIs | Dropped (E5); restore from history if progressive serve lands |
