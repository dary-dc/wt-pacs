# ADR: how the server reads SBND frame bytes

> ⚠️ **Status: under review** — see [`docs/l3-disk-access-evidence-review.md`](l3-disk-access-evidence-review.md).
> Prior campaign stall columns sit at the instrument noise floor; the warm “hybrid beats naive”
> ranking compared arms that did different work; the **>RAM regime this ADR cites was never
> measured in those campaigns**. Under memory pressure the `mincore` gate measured ~10× worse
> worst-case executor block than always-blocking touch (review §5). **Do not treat the old
> tables as decided.** Product path is **unconditional `spawn_blocking` touch (L3 v1)** until
> re-derived C1/C2 cells clear a gate.

**Status:** Under review · **2026-08-31** · Branch evidence under `docs/measurements/r2/`

## Context

`FrameStore` serves immutable HTJ2K frames from an SBND file. Studies can exceed RAM (DBT).
The server uses Tokio. A major page fault on an mmap’d slice is **not** an `.await`, so it freezes
every task on that OS thread.

Question: how should we bring frame bytes into a state safe for `write_all` (next version: no
`wrap()` — the only copy is quinn’s inside the write)?

## Decision (provisional)

**Use mmap + unconditional blocking pre-touch (`spawn_blocking(touch_frame_pages)`), then
`frame_slice` + write on the executor.**

1. Map the study once (`mmap`).
2. Before serving frame *i*, always `spawn_blocking(touch_frame_pages(i))`.
3. Then `frame_slice` + `write_all` on the executor.

Do **not** load the whole study into process RAM.

The **`mincore` gate** (skip hop when resident) is **lab-contested**: keep as a lab arm; do not
ship as product default until memory-pressure + multi-session cells clear it — and if kept, it
needs a verification step after the hop, not check-alone (review §6 D2).

### Soft guarantee (document either way)

Pages touched on the pool may be reclaimed before quinn finishes copying them under memory
pressure. With `wrap()` removed, the window is the **whole flow-controlled write**, not one
immediate `memcpy`. `pread` into a private buffer is the hard guarantee (one extra copy).

## Consequences

| | |
| --- | --- |
| **Good** | Cold faults leave the executor; co-tenant sessions can run while one session hops. |
| **Cost** | Pool hop on every frame (~10–30 µs latency on lab hosts) even when already hot — mostly overlaps under concurrency (to be confirmed by multi-session cell). |
| **Next version** | No product `wrap` copy; mmap arms do **1** copy (quinn); `pread` does **2**. That strengthens mmap vs `pread` on copy count and weakens any residency prediction that must hold for the whole write. |

## Alternatives considered

| Option | Verdict | Why |
| --- | --- | --- |
| mmap naive (touch/read on executor) | **Rejected** | Major faults block every task on that OS thread (invariant stands; re-measured with co-tenant gaps). |
| mmap always `spawn_blocking` touch (L3 v1) | **Provisional default** | Safe in review pressure cells; pays hop always. |
| mmap + `mincore` gate (hybrid) | **Contested / not default** | Warm path looks like naive when arms do equal work; under >RAM pressure gate fires rarely and worst executor block ≫ always-touch (review §5). |
| `pread` on blocking pool | **First-class candidate** | 2 copies vs 1, but immune to reclaim and to the widened write window. Re-measure with pooled buffers, not a fresh `Vec` per ask. |
| `madvise(WILLNEED)` then touch on executor | **Rejected** | Does not move the fault off the executor. |
| Blocking ahead-2 / ask-queue prefetch | **Deferred** | Needs a real ask window. |
| Dedicated mmap-fault OS thread | **Deferred** | Lab hop ≈ `spawn_blocking` unless pool contends. |
| `io_uring` read | **Deferred** | Lab learning; prior art wins mainly at deep `O_DIRECT` QD. |
| `sendfile` / splice file→socket | **Rejected for this stack** | Userspace QUIC still copies. |
| `O_DIRECT` + app cache | **Rejected** | Wrong default for revisitable studies. |
| SPDK / userspace NVMe | **Rejected** | Out of scope. |
| Whole-study preload | **Rejected** | Does not survive DBT-scale RAM. |

## Evidence

Prior campaign TSVs remain on the branch as **raw history** but their stall columns and warm
hybrid-vs-naive ranking are **not decision evidence** (F1–F5). Re-runs use the fixed instrument
(`docs/l3-disk-access-evidence-review.md` §6–§7).

- Evidence review + required actions: `docs/l3-disk-access-evidence-review.md`
- Raw review probes: `docs/measurements/r2/REVIEW_2026-08-31_RAW.txt`
- Historical campaigns (caveated): `docs/measurements/r2/DISK_ACCESS_*.md`
- Prior art: `docs/disk-access-prior-art.md`
- Implementation: `FrameStore::touch_frame_pages`, `send_one_frame` (always-touch)

## Follow-ups (blocking for any gate return)

1. **Memory-pressure cell (C1)** — study ≫ page cache; report worst co-tenant gap per arm.
2. **Multi-session cell (C2)** — other sessions’ latency while one goes cold; decides whether hop saving matters.
3. If gate returns: verification after hop + document reclaim race.

Non-blocking: real-disk confirm, dedicated pool under product load, `io_uring` lab.

Merge plan: `docs/l3-merge-plan.md` — **do not prune harness/TSVs until numbers are re-derived**.
