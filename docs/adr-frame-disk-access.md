# ADR: how the server reads SBND frame bytes

> ⚠️ **Status: under review** — see [`docs/l3-disk-access-evidence-review.md`](l3-disk-access-evidence-review.md).
> Prior campaign stall columns sit at the instrument noise floor; the warm “hybrid beats naive”
> ranking compared arms that did different work. Under memory pressure the `mincore` gate’s worst
> executor block matches naive’s millisecond class (host-dependent hit rate; see re-run C1).
> **Do not treat the old campaign tables as decided.** Product path is **unconditional
> `spawn_blocking` touch (L3 v1)**.

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

The **`mincore` gate** (skip hop when resident) is **not the product default**: under >RAM
pressure it fails open onto the executor with a host-dependent rate; keep as a lab arm. If revived,
it needs verification after the hop, not check-alone (review §6 D2).

### Soft guarantee (document either way)

Pages touched on the pool may be reclaimed before quinn finishes copying them under memory
pressure. With `wrap()` removed, the window is the **whole flow-controlled write**, not one
immediate `memcpy`. `pread` into a private buffer is the hard guarantee (one extra copy).

## Consequences

| | |
| --- | --- |
| **Good** | Cold faults leave the executor; co-tenant sessions stay healthy while one session hops (re-run C2 other p99). |
| **Cost** | Pool hop on every frame (~10–30 µs primary latency on lab hosts) even when already hot. |
| **Next version** | No product `wrap` copy; mmap arms do **1** copy (quinn); `pread` does **2**. That strengthens mmap vs `pread` on copy count and weakens any residency prediction that must hold for the whole write. |

## Alternatives considered

| Option | Verdict | Why |
| --- | --- | --- |
| mmap naive (touch/read on executor) | **Rejected** | Major faults block every task on that OS thread (invariant stands; re-measured with co-tenant gaps + C2 neighbour p99). |
| mmap always `spawn_blocking` touch (L3 v1) | **Provisional default** | Safe in pressure cells; pays hop always. |
| mmap + `mincore` gate (hybrid) | **Rejected as default** | Equal-work warm ≈ naive; under pressure worst gap is millisecond-class at naive’s magnitude (host-dependent rate). |
| `pread` on blocking pool | **First-class candidate** | 2 copies vs 1, but immune to reclaim and to the widened write window. Per-frame cost vs always-touch flips by host under pressure — re-measure with pooled buffers (D3). |
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
hybrid-vs-naive ranking are **not decision evidence** (F1–F5).

**Decision evidence (fixed instrument):** [`docs/measurements/r2/DISK_ACCESS_RERUN.md`](measurements/r2/DISK_ACCESS_RERUN.md)
— C1 mempressure (`disk_access_mempressure.tsv`), C2 multi-session (`disk_access_multisession.tsv`),
arm-parity smoke, one-pass cold.

Also:

- Evidence review + checklist: `docs/l3-disk-access-evidence-review.md`
- Raw first-review probes: `docs/measurements/r2/REVIEW_2026-08-31_RAW.txt`
- Historical campaigns (caveated): `docs/measurements/r2/DISK_ACCESS_{CAMPAIGN,FOLLOWUP,REALISTIC}.md`
- Prior art: `docs/disk-access-prior-art.md`
- Implementation: `FrameStore::touch_frame_pages`, `send_one_frame` (always-touch)

## Follow-ups

**Done (re-derived):** C1 memory-pressure · C2 multi-session neighbour safety — see `DISK_ACCESS_RERUN.md`.

**Blocking for any gate return:**

1. Gate **plus** verification after hop (D2), not check-alone.
2. Fair all-sessions hop-cost cell (all N on the arm under test + throughput) — C2 so far only measures neighbour *safety* while backgrounds are always-touch.

**Raise priority:** pooled-buffer `pread` (D3) — copy-vs-safety trade still host-dependent.

**Non-blocking:** real-disk confirm (C3), dedicated pool under product load, `io_uring` lab, drop prefix APIs from product type (E5).

Merge plan: `docs/l3-merge-plan.md` — keep harness/TSVs until essential merge after review sign-off.
