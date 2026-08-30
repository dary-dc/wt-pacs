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
- **Realistic final wave** (large series · `live_cell_scroll` · full / prefix_4k / prefix_64k):
  `docs/measurements/r2/DISK_ACCESS_REALISTIC.md`
- Prior art: `docs/disk-access-prior-art.md`
- Team brief: `docs/disk-access-team-brief.md`
- Implementation: `FrameStore::frame_pages_resident`, `send_one_frame` in `server/src/transport/server.rs`

### Realistic wave — explained (why the decision still holds)

Study `frames_250k_live` (320 × 250 KB). Decision arms only. Overlayfs lab (≤ T2).

**Warm user-like scroll (`live_cell_scroll`, 500 asks) · full frame**

| Arm | later p50 | hop p50 | Why it matters |
| --- | ---: | ---: | --- |
| **hybrid** | **0.64 µs** | **0** | Already-resident frames skip the pool; typical scroll after first pass. |
| always blocking touch | 12 µs | 12 µs | Safe but pays hop tax every ask even when hot. |
| pread | 37 µs | 37 µs | Same safety class; **125 MB** copied for this trace. |
| naive | 0.88 µs | 0 | Fast when warm — but see cold row. |

**Cold same trace · full frame**

| Arm | stall n | stall max | Why it matters |
| --- | ---: | ---: | --- |
| naive | **1** | **~55 ms** | Heartbeat never woke during the series → executor frozen. |
| **hybrid** | **50** | ~1.5 ms | Runtime stayed alive; hops only while pages are cold. |

**Partial access (prefix_4k / prefix_64k) on the same warm scroll:** hybrid remains hop-free and sub‑µs; `pread` copies shrink (2 MB / 33 MB) but still lose to hybrid on later/hop. Ranking does **not** flip if we only needed early HTJ2K bytes.

**Large-series forward (320 frames, warm full):** hybrid later ~0.40 µs / hop 0 — same shape as the 80-frame follow-up at larger N.

Product path remains **full-frame** hybrid; prefix helpers are lab/API for progressive experiments, not a change to wire serve.

Evidence tier ≤ T2 (lab / overlayfs). Optional confirm on a real study volume does not change the decision shape unless ranking flips.

## Follow-ups (non-blocking)

Listed in `docs/disk-access-later.md` — dedicated pool under load, io_uring experiment, real-disk confirm, ask-queue prefetch when a window exists.
