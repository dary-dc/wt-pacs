# ADR: how the server reads SBND frame bytes

**Status:** Accepted · **2026-08-30** · Branch evidence under `docs/measurements/r2/`

## Context

`FrameStore` serves immutable HTJ2K frames from an SBND file. Studies can exceed RAM (DBT).
The server uses Tokio. A major page fault on an mmap’d slice is **not** an `.await`, so it freezes
every task on that OS thread.

Question: how should we bring frame bytes into a state safe for `wrap` / `write_all`?

## Decision

**Use mmap + residency check (`mincore`) + blocking pre-touch only when cold.**

1. Map the study once (`mmap`).
2. Before serving frame *i*, call `frame_pages_resident(i)` on the executor (no fault).
3. If not fully resident → `spawn_blocking(touch_frame_pages(i))` (one byte / 4 KiB).
4. Then `frame_slice` + `wrap` + `write_all` on the executor.

Do **not** load the whole study into process RAM. Do **not** use `pread` as the default path.

## Consequences

| | |
| --- | --- |
| **Good** | Cold faults leave the executor; warm frames skip the pool hop (~sub‑µs later p50 in lab). No full-frame copy for the access step. |
| **Cost** | Extra `mincore` syscall per frame; rare false “not resident” → unnecessary hop (safe). |
| **Still true** | Product `wrap` still copies into a `Vec` for the wire; this ADR is about *storage → ready bytes*, not QUIC zero-copy. |

## Alternatives considered

| Option | Verdict | Why |
| --- | --- | --- |
| mmap naive (touch on executor) | **Rejected** | Freezes runtime when cold (`stall_samples=1`). |
| mmap always `spawn_blocking` touch (L3 v1) | **Superseded** by hybrid | Safe, but pays ~10 µs hop even when already hot. |
| `pread` on blocking pool | **Rejected as default** | Same safety class; copies every frame; warm later ~3× hybrid. Keep as escape hatch if mmap/`mincore` ever broken on a FS. |
| `madvise(WILLNEED)` then touch on executor | **Rejected** | Does not remove executor stall in our cells. |
| Blocking ahead-2 / ask-queue prefetch | **Deferred** | Needs a real ask window; ahead-2 did not beat single-frame prefault on series wall. |
| Dedicated mmap-fault OS thread | **Deferred** | Lab hop ≈ `spawn_blocking`; isolation only matters under pool contention we have not measured in product. |
| `io_uring` read | **Deferred** | True async file I/O; high integration cost with multi-thread Tokio + userspace QUIC; prior art: wins mainly for deep `O_DIRECT` queues, not warm page-cache serve. |
| `sendfile` / splice file→socket | **Rejected for this stack** | Zero-copy into kernel TCP paths; WebTransport/QUIC is userspace — bytes still enter library buffers. |
| `O_DIRECT` + app cache | **Rejected** | Throws away page cache that helps revisits; app would reimplement caching. |
| SPDK / userspace NVMe | **Rejected** | Out of scope for SBND-on-filesystem. |
| Whole-study preload | **Rejected** | Does not survive DBT-scale RAM. |

## Evidence

- Campaign Wave A/B: `docs/measurements/r2/DISK_ACCESS_CAMPAIGN.md`
- Follow-up (hybrid / dedicated): `docs/measurements/r2/DISK_ACCESS_FOLLOWUP.md`
- Prior art: `docs/disk-access-prior-art.md`
- Team brief: `docs/disk-access-team-brief.md`
- Implementation: `FrameStore::frame_pages_resident`, `send_one_frame` in `server/src/transport/server.rs`

Evidence tier ≤ T2 (lab / overlayfs). Optional confirm on a real study volume does not change the decision shape unless ranking flips.

## Follow-ups (non-blocking)

Listed in `docs/disk-access-later.md` — dedicated pool under load, io_uring experiment, real-disk confirm, ask-queue prefetch when a window exists.
