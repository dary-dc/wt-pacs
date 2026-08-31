# ADR: how the server reads SBND frame bytes

**Status:** Accepted · **2026-08-31** · Evidence: [`docs/measurements/r2/DISK_ACCESS_RERUN.md`](measurements/r2/DISK_ACCESS_RERUN.md)  
Prior flawed campaigns: caveated under `docs/measurements/r2/` / git history only.

## Context

`FrameStore` serves immutable HTJ2K frames from an SBND file. Studies can exceed RAM (DBT).
The server uses Tokio. A major page fault on an mmap’d slice is **not** an `.await`, so it freezes
every task on that OS thread.

Question: how should we bring frame bytes into a state safe for `write_all` (next version: no
`wrap()` — the only copy is quinn’s inside the write)?

## Decision

**Use mmap + unconditional blocking pre-touch (`spawn_blocking(touch_frame_pages)`), then
`frame_slice` + write on the executor.**

1. Map the study once (`mmap`).
2. Before serving frame *i*, always `spawn_blocking(touch_frame_pages(i))`.
3. Then `frame_slice` + `write_all` on the executor.

Do **not** load the whole study into process RAM. Do **not** use a `mincore` hop-skip gate as the
product default. Do **not** default to `pread`.

### Soft guarantee

Pages touched on the pool may be reclaimed before quinn finishes copying them under memory
pressure. With `wrap()` removed, that window is the **whole flow-controlled write**.
`pread` into a private buffer is the hard guarantee (one extra copy) — keep as escape hatch.

## Consequences

| | |
| --- | --- |
| **Good** | Cold faults leave the executor; other sessions stay healthy (C2 other p99). Warm path pays only a pool hop (~10–30 µs lab), not a full-frame `pread` copy. |
| **Cost** | Hop on every frame even when hot. Soft reclaim race remains (document; accept for default). |
| **Next version** | mmap → **1** copy (quinn); `pread` → **2**. Favors mmap on copy count. |

## Alternatives considered

| Option | Verdict | Why |
| --- | --- | --- |
| mmap naive | **Rejected** | Faults freeze co-tenants (C2). |
| mmap + `mincore` gate | **Rejected as default** | Under >RAM pressure worst gap matches naive (host-dependent rate); residency ≠ lease for the write window. |
| mmap always-touch (L3 v1) | **Accepted** | Safe under pressure; protects neighbours; warm later beats pooled `pread` on this host (~23 µs vs ~53 µs). |
| `pread` fresh `Vec` / **pooled buffer (D3)** | **Rejected as default; first-class escape** | Same safety class; **2 copies**; pooled removes alloc tax but warm later still ~2× always-touch here. Prefer if hard reclaim guarantee outweighs copy+latency. |
| WILLNEED on executor | **Rejected** | Fault still on executor. |
| Ahead-2 / ask prefetch | **Deferred** | Needs real ask window. |
| Dedicated fault thread | **Deferred** | ≈ `spawn_blocking` unless pool contends. |
| `io_uring` | **Deferred** | Lab; prior art at deep `O_DIRECT` QD. |
| `sendfile`/splice | **Rejected for this stack** | Userspace QUIC still copies. |
| `O_DIRECT` + app cache / SPDK / whole-study preload | **Rejected** | Wrong scale or scope. |

## Evidence (fixed instrument)

See [`DISK_ACCESS_RERUN.md`](measurements/r2/DISK_ACCESS_RERUN.md):

| Cell | Result |
| --- | --- |
| Arm parity (warm) | Naive ≈ hybrid once both consume bytes |
| C1 mempressure | Hybrid unsafe (ms gaps); always-touch / pread ~tens–low-hundreds µs gap_max |
| C2 multi-session | Cold naive inflates neighbour **p99**; always-touch does not |
| D3 pooled `pread` | Warm always-touch **faster** than pooled `pread`; pooling ≪ gap to mmap; default unchanged |

Review trail: [`l3-disk-access-evidence-review.md`](l3-disk-access-evidence-review.md).

## Follow-ups (non-blocking)

- Real-disk confirm (C3)
- All-sessions hop-cost cell (every session on the arm under test)
- Dedicated pool under product load; `io_uring` lab
- Gate+verify only if a future regime clears C1 **and** adds verification (D2)
