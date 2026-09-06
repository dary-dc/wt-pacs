# S5 — separating the reader loop from the ring

**Why:** risk **R8** in [`SCOREBOARD.md`](SCOREBOARD.md). `pool` and `hybrid` do not reach a
cache hit through the same code, so part of what the campaign scores as "io_uring wins" is
reader-loop shape. This is the measurement that says how much.

It matters because of what it could save. [`adr.md`](adr.md) rejected the hybrid on its
**per-session cost** — a ring, an eventfd and registered buffers for every session.
[`READ-PATH-DECISION.md`](READ-PATH-DECISION.md) recommends it on a margin that R8 shows is
partly loop shape. If the loop is a meaningful share of that margin, a restructured
pool-based reader captures it **with no ring at all**.

## What the two arms actually do today

```
pool            reader_pool   depth Tokio tasks, JoinSet, shared AtomicU64 cursor,
                              one heap Vec per task; RWF_NOWAIT inline, spawn_blocking
                              on the shortfall
hybrid / uring  reader_ring   ONE task, depth ring slots, registered buffers;
                              (hybrid) RWF_NOWAIT inline, ring on the shortfall
                              (uring)  everything through the ring
```

Two things differ at once — **loop shape** and **miss mechanism** — so no existing pair
isolates either. On a cache hit the ring is never engaged, which is why the `hit` regime
measures loop shape alone; that is the confound, not the design.

## The arm to add

**`pool_ringloop`** — `reader_ring`'s structure with `pool`'s miss mechanism:

* one task, `depth` slots in flight, one preallocated buffer per slot
* `RWF_NOWAIT` inline for the hit, exactly as `pool` does
* on a shortfall, `spawn_blocking` — **not** the ring
* no `UringReader`, no eventfd, no registered buffers

It shares the loop with `hybrid` and the miss mechanism with `pool`, so it completes the
2×2 and every comparison below is a single-variable difference:

| | miss → `spawn_blocking` | miss → io_uring |
| --- | --- | --- |
| **task-per-slot loop** | `pool` *(ships today)* | — *(the mirror arm, optional)* |
| **one task, N slots** | **`pool_ringloop`** *(new)* | `hybrid` |

## What it answers

| Comparison | Isolates |
| --- | --- |
| `pool_ringloop` − `pool` | **The loop alone.** Same miss mechanism, different structure |
| `hybrid` − `pool_ringloop` | **The ring alone.** Same structure, different miss mechanism |
| `hybrid` − `pool` | What the campaign reports today — the sum of both |

Run the existing phases; the `hit` regime should now read ~0% for `hybrid` − `pool_ringloop`,
and that is the check that the arm is built right: with the same loop and no reads reaching
the ring, the two must converge.

## Decision rule, set before the numbers exist

Let **L** = `pool_ringloop` − `pool` and **R** = `hybrid` − `pool_ringloop`, both in the
`miss` regime, at the depths the product will actually run.

| Outcome | Reading |
| --- | --- |
| \|R\| ≫ \|L\| | The ring earns its per-session cost. Adopt the hybrid |
| \|L\| ≫ \|R\| | **The loop was doing the work.** Restructure the pool reader; no ring, no eventfd, no registered buffers, and `adr.md`'s rejection stands |
| both material | Take the loop change first — it is free — then re-measure whether the ring still pays |
| both ~0 | The margin was neither; re-open how it was measured |

Apply the campaign's own rule to L and R: a difference counts only if it beats the 28.5%
drift threshold **and** keeps its sign across repeats
([`RERUN.md`](RERUN.md) §Precision).

## Cost and caveats

One arm in `lab/disk-access-bench/src/bin/read_campaign.rs`, reusing `reader_ring`'s slot
bookkeeping with the ring calls replaced by `spawn_blocking`. The campaign itself is ~30 s;
the existing hosts can all re-run it ([`RUN-ON-YOUR-HOST.md`](RUN-ON-YOUR-HOST.md)).

Two things this does **not** settle:

* **Session count.** These loops are compared inside one reader. The product runs one per
  session, and the per-session cost of a ring is exactly what the ADR objected to — that is
  a memory-and-fd question, not a CPU one, and needs the multi-session cell.
* **`--readers` interaction.** `reader_pool` spreads asks over `depth` tasks; with
  `--readers > 1` the task count multiplies. Hold `readers` fixed when reading L, or the
  loop effect and the session effect mix again.
