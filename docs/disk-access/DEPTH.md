# Reads in flight: where `pread` wins, where io_uring wins · 2026-09-05

> **Superseded by [`READ-PATH-DECISION.md`](READ-PATH-DECISION.md).** That campaign crosses
> depth with miss rate, adds the hybrid arm, and reproduces over three independent runs.
>
> **This document's depth-1 row is withdrawn.** Its harness ran the ring arms inline in the
> `block_on` future — on the calling thread, which is not a runtime worker — while spawning
> the `pool` arm onto the runtime. Every completion the ring waited for therefore cost a
> cross-thread wake that `pool` never paid, a fixed cost per completion batch that is
> crushing at one read in flight and amortised away by depth 8. A controlled A/B of exactly
> that placement is in [`READ-PATH-DECISION.md`](READ-PATH-DECISION.md) §The harness
> disagreement: flipping it moves the ring arms **2×** at depth 1 and leaves `pool`
> untouched. The depth-1 tie below is that artifact; the real figure is ~−53% for the ring
> arms. Everything from depth 2 up stands, and understates the ring by a few percent.
>
> Read this for the depth argument; read the decision doc for the answer.

> **Harness note.** `depth_read_bench` was replaced by `read_campaign` in `d69dfb3` and is no
> longer in the tree; recover it at `git show d8f9d8a:lab/disk-access-bench/src/bin/depth_read_bench.rs`
> if you need to reproduce these exact cells. New work should use `read_campaign` or
> `crossover_bench`, which spawn every arm onto the runtime.

**This document corrects a conclusion in [`RERUN.md`](RERUN.md) and
[`PREFIX-READS.md`](PREFIX-READS.md).** Both rejected io_uring on evidence collected
entirely at **queue depth 1** — one read outstanding at a time. At depth 1 a ring has
nothing to overlap and can only add bookkeeping, so those cells could not have found a win
however io_uring was tuned. They measured the harness's shape, not the interface.

Raw: [`v9_depth_sweep.tsv`](v9_depth_sweep.tsv) · harness: `depth_read_bench`

```bash
cargo build -p disk-access-bench --release
./target/release/depth_read_bench <study.sbnd> [asks] [size] [stride] [repeats]
```

## Why depth 1 was assumed, and why that was the wrong thing to assume

`run_session` reads one ask, serves it to completion, then reads the next — on `main` and on
`cursor/client-frame-pipeline-telemetry-8017` alike, where `RequestFrames` still loops
`serve_one(...).await` per frame. So the *code today* does hold one read at a time.

But the client already keeps several asks outstanding — that is the whole subject of
[`adr-client-window-depth.md`](../adr-client-window-depth.md), where `D` is the ask window.
The depth reaching the disk is 1 because the **server flattens** the client's window, not
because anything makes it 1. That is a server design choice, and one under active change.

Treating it as fixed turned an implementation detail into a permanent verdict on an
interface. The rest of this document is what happens when the assumption is lifted.

## The cell

1024 asks of 16 KB, 250 KB apart (the strided shape rung delivery produces), against the
84 MB fixture. Cold cells `fadvise(DONTNEED)` the file and abort unless residency is under
1%. 6 repeats, arms rotated between repeats. Three arms, all holding `depth` reads in
flight, differing only in **how** they hold them:

| Arm | Concurrency mechanism |
| --- | --- |
| `pool` | The product's read: `RWF_NOWAIT` on the executor, `spawn_blocking` for the shortfall. `D` concurrent misses ⇒ `D` blocking-pool threads parked on the device |
| `uring` | One ring, registered file and buffers, slots refilled as they complete, completions awaited on a registered eventfd. `D` concurrent misses ⇒ one ring, no extra threads |
| `hybrid` | `RWF_NOWAIT` inline first; the ring only for what it could not get. A cache hit never touches the ring; a miss never touches a thread |

## Cold — real device I/O

| Depth | Arm | CPU / ask | vs `pool` | asks/s | p50 | Threads |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | pool | 50 278 ns | — | 16 284 | 63 µs | 7 |
| 1 | ~~uring~~ | ~~50 138 ns~~ | ~~1.00×~~ | — | — | 5 |
| 1 | ~~hybrid~~ | ~~50 013 ns~~ | ~~1.01×~~ | — | — | 5 |
| 2 | pool | 49 074 ns | — | 25 307 | 77 µs | 9 |
| 2 | **hybrid** | **27 446 ns** | **1.79×** | 27 435 | **67 µs** | 5 |
| 4 | pool | 40 378 ns | — | 37 699 | 101 µs | 16 |
| 4 | **hybrid** | **17 634 ns** | **2.29×** | 37 200 | **81 µs** | 5 |
| 8 | pool | 39 711 ns | — | 45 116 | 163 µs | 20 |
| 8 | **hybrid** | **13 150 ns** | **3.02×** | 46 430 | **122 µs** | 5 |
| 16 | pool | 34 742 ns | — | 58 038 | 248 µs | 37 |
| 16 | **hybrid** | **10 760 ns** | **3.23×** | 56 645 | **196 µs** | 5 |
| 32 | pool | 32 928 ns | — | 73 434 | 373 µs | 52 |
| 32 | **hybrid** | **9 215 ns** | **3.57×** | 69 959 | **315 µs** | 5 |
| 64 | pool | 38 055 ns | — | 70 108 | 681 µs | **89** |
| 64 | **hybrid** | **9 581 ns** | **3.97×** | 82 754 | **559 µs** | **5** |

Paired by repeat, `hybrid` is cheaper than `pool` in **6 of 6** at every depth from 2 up
(−43%, −57%, −66%, −69%, −72%, −74%). `uring` alone tracks it within a couple of points.

Two things are happening at once, and both matter for cost per user:

* **CPU per ask falls ~4×.** A `spawn_blocking` round trip costs a task hand-off, a thread
  wake and a migration; a ring submission costs a queue entry. At depth the difference
  compounds.
* **Thread count stops growing.** `pool` reaches **89 OS threads** at depth 64 because a
  thread is what holds a concurrent miss. The ring holds 64 in flight on **5**. That ceiling
  — Tokio's blocking pool defaults to 512 threads — is a hard scaling limit for the pool
  arm and simply absent for the ring.

Throughput is close throughout: `pool` buys its concurrency with threads and gets similar
asks/s for 3–4× the CPU. On a machine serving many users, CPU is the budget.

## Warm — page-cache hits

| Depth | `pool` | `uring` | `hybrid` |
| ---: | ---: | ---: | ---: |
| 1 | **2 114 ns** · p50 1.8 µs | 8 521 ns · p50 2.9 µs | 2 145 ns · p50 1.8 µs |
| 4 | **2 386 ns** · p50 1.9 µs | 4 401 ns · p50 14.9 µs | **2 092 ns** · p50 1.8 µs |
| 16 | 2 420 ns · p50 1.9 µs | 2 507 ns · p50 32.5 µs | **2 105 ns** · p50 1.8 µs |
| 64 | 2 488 ns · p50 1.9 µs | 3 307 ns · p50 **144 µs** | 3 144 ns · p50 2.0 µs |

**Here `pread` beats io_uring outright, and it is not close at low depth** — 4× the CPU per
ask at depth 1 and latency that degrades with depth (2.9 µs → 144 µs) because every read
goes through submit-and-complete instead of returning inline. A cached read has nothing to
wait for, so everything a ring adds is overhead.

`hybrid` shows why that does not have to be a trade: it is within noise of `pool` warm
(−10 to −12% CPU, 6 of 6, at depths 4–32) because a hit never reaches the ring at all.

## The answer to "is `pread` faster than io_uring?"

| Regime | Answer |
| --- | --- |
| **Page-cache hit, any depth** | **Yes, `pread`, decisively.** 4× less CPU at depth 1 and 1.8 µs vs 2.9–144 µs. The ring adds submission and completion to a read that never waits |
| **Real I/O, one read at a time** | ~~**Tie.** 50.3 vs 50.1 µs CPU/ask~~ — **withdrawn**, a harness artifact (see the note at the top). The ring wins here too, by about half |
| **Real I/O, ≥ 2 reads in flight** | **No — io_uring, by a lot.** 1.8× at depth 2 rising to ~4× at depth 64, and threads flat at 5 instead of 89 |

So neither answer is "faster" on its own — **the two win in different regimes, and the split
is between cached and uncached, not between interfaces.** The hybrid exploits exactly that
split, and it is the only arm here that is never worse than the best of the other two.

That also means the earlier verdict was not wrong about its cells, it was wrong about their
reach: [`RERUN.md`](RERUN.md) §Cell 6 rejects `uring_nowait_hybrid` as "a tie bounded at
±5%… it buys a ring, an eventfd and registered buffers per session for nothing that
reproduces". Every one of those cells was depth 1, and at depth 1 that finding reproduces
here exactly (1.01×) — but that reproduction is now known to be the placement artifact, not
the interface. The rejection does not survive depth 2 on any harness, and does not survive
depth 1 either once the ring is driven from a runtime worker.

## What this does and does not settle

**Settles:** the read interface should follow the server's concurrency design. A serial
server has no reason to hold a ring. A server that serves the client's ask window
concurrently has a 2–4× CPU reason to hold one, and a thread-count reason on top.

**Does not settle:**

* **Whether the server should pipeline asks.** That is the ordering and fairness question of
  [`adr-reject-server-ordering.md`](../adr-reject-server-ordering.md) and the pipeline work
  on `cursor/client-frame-pipeline-telemetry-8017`, not a disk question. This document only
  prices the disk consequence of the choice.
* **Per-session versus per-process rings.** The cell holds one ring for the whole process.
  A ring per session would multiply the fixed costs and re-open `SINGLE_ISSUER`, which
  [`RERUN.md`](RERUN.md) §Cell 6 rules out for a work-stealing runtime.
* **The executor-safety properties.** This bench measures cost, not co-tenant gaps. Nothing
  here re-tests the stall behaviour the ADR was chosen for.

## Limitations

* **One process, one file, one ring.** Concurrency here is `D` reads from one reader, which
  is the shape of a pipelined session. Many sessions each at depth 1 is a different shape
  and is not measured here.
* **Cold is guest-cold, not device-cold** — the hypervisor caches the backing file, so
  absolute latencies are optimistic. The CPU and thread findings do not depend on device
  speed; on slower storage the pool arm's thread count would climb *faster*, not slower.
* **Latency comparisons across arms carry the arms' own scheduling.** Slots refill as they
  complete in both ring arms, and pool tasks are independent, so neither is batched — but
  `pool` gets extra parallelism from its extra threads, which flatters its p50 at depth
  while costing the CPU the table reports.
* **`uring` warm at depth 64 (144 µs p50)** is the ring saturating its own completion path
  on reads that never needed it. It is a real number for that arm and an argument against
  ever routing cached reads through a ring — not a general io_uring result.
