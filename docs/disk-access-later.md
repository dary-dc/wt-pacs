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
| Realistic access patterns (large series · user trace · prefix) | **Done** — then **instrument invalidated** (evidence review); see re-run |
| Fixed instrument + C1/C2 re-run | **Done** — `DISK_ACCESS_RERUN.md`; always-touch provisional |

---

## Still optional later

| Idea | Note |
| --- | --- |
| Dedicated fault thread under **product** load | Lab hop ≈ `spawn_blocking`; revisit if blocking pool contends |
| **Multi-session cold serve under load** | Harness: `disk-access-bench --sessions N`. Measure **other sessions’** latency during cold serve. **Re-run required** with fixed instrument. |
| **Study ≫ page cache (memory-pressure)** | Harness: `lab/scripts/run_disk_access_mempressure.sh`. ADR premise. **Re-run required.** |
| Wave A on **real study disk** / Oracle volume | Confirm ranking off overlayfs |
| **`io_uring` read** prototype | Lab learning only — unlikely to beat always-touch/mmap on warm page-cache serve |
| Ask-queue **ahead-N** prefetch | When a real client window exists |
| Layout / page-align fixtures | Packer experiment |

## Rejected / out of scope

| Idea | Note |
| --- | --- |
| `sendfile` / splice into QUIC | Userspace QUIC still copies |
| `O_DIRECT` + app cache | Wrong default for revisitable studies |
| SPDK / whole-study RAM | Explicit non-goals |
