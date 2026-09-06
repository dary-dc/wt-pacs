# S5 — separating the reader loop from the ring

> **Ran on two core counts, and the answer depends on the core count.** On 4 vCPU the loop is
> a tie everywhere and the ring earns the margin. On **8 CPU the loop RESOLVES on hits** at
> −33.6/−32.9%, growing with depth. Both terms are real, in different regimes — and the design
> that takes both is **`hybrid_lazyring`**, measured in §The design this implies.
> Raw: [`v24_s5_loop_vs_ring.tsv`](v24_s5_loop_vs_ring.tsv) ·
> [verdict](v24_s5_loop_vs_ring_verdict.txt) · [host](v24_s5_loop_vs_ring_host.txt).
> Result and the correction to this document's own success criterion are in §Result.

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

~~Run the existing phases; the `hit` regime should now read ~0% for `hybrid` − `pool_ringloop`,
and that is the check that the arm is built right.~~

**That criterion was wrong, and the run disproved it before it disproved anything else.**
`hybrid` − `pool_ringloop` came out **+13% to +22%** on a pure-hit cell — with `miss_pct`
**0.0% in every arm**, so not one read reached the ring. Two arms that share a loop and
never touch the ring do *not* converge, because the hybrid still pays to **construct and
hold** a ring it never uses. That is a cost, not a defect.

The correct check is the one the data supports: **`miss_pct` must be 0.0% in both arms** on a
warm cell, which is what proves no read reached the ring. Any remaining gap is then the ring's
fixed per-session cost — which is the thing [`adr.md`](adr.md) rejected the hybrid over, now
with a number on it.

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

## Result

Two runs of the same configuration, sandbox host, `--monitors 4`→0, 512 asks × 6 repeats,
A_stride + A_sweep + C_readers. Rule applied as written: |median| ≥ 28.5% **and** sign
agreement ≥ 0.8n, **and** the same sign in both runs.

| | hit | mix | miss |
| --- | ---: | ---: | ---: |
| **L** — loop alone (`pool_ringloop` − `pool`) | −17.1 / −13.2% · tie | −2.0 / −1.3% · tie | +8.6 / +10.7% · tie |
| **R** — ring alone (`hybrid` − `pool_ringloop`) | +7.9 / +10.0% · tie | **−56.9 / −56.0% · RESOLVED** | **−70.7 / −72.7% · RESOLVED** |
| **L+R** — what the campaign reports (`hybrid` − `pool`) | −12.6 / −7.7% · tie | −61.0 / −53.8% · RESOLVED | −66.0 / −68.1% · RESOLVED |

Sign agreement on the resolved rows: 39/40, 42/42, 66/66, 66/66.

**By the decision rule set above, this is the first row: |R| ≫ |L|, so the ring earns its
per-session cost.** The loop is a tie in all three regimes in both runs, and on misses it
works slightly *against* the hybrid — R is larger than L+R because L is +8.6%.

So R8 does not weaken the recommendation; it removes a doubt from it. What raised R8 was a
hit-regime spread of up to −35% across hosts, and that spread never resolved under the 28.5%
rule. It was read as signal before the rule was applied to it — the exact error the rule
exists to prevent.

One thing worth carrying: the ring's idle cost is measurable. On a cell where `miss_pct` is
**0.0% for every arm**, the hybrid still costs **+7.9 / +10.0%** over the same loop without a
ring. A tie by the rule, but it is the per-session price the ADR objected to, and it is not
zero.

## The design this implies

The split says: take the **ring-shaped loop** (worth up to −33.6% on hits where cores
contend, ~0 on misses) and the **ring on the miss** (−42 to −73%, everywhere), and avoid the
**idle ring** (+6 to +18% on hits — the hybrid builds one per session whether or not a read
ever misses).

`hybrid_lazyring` is `hybrid` with the ring built on the **first miss**. A session whose
reads all hit never constructs one; a session that misses pays construction once, carries
the prefix the inline read already produced into the ring's slot so no byte is read twice,
and is `hybrid` from then on.

Measured, two runs, 4 vCPU ([`v27_lazyring.tsv`](v27_lazyring.tsv) ·
[verdict](v27_lazyring_verdict.txt)):

| vs `pool` | hit | mix | miss |
| --- | ---: | ---: | ---: |
| `hybrid` | −9.6 / −5.4% · tie | −63.0 / −59.6% · RESOLVED | −62.8 / −65.4% · RESOLVED |
| **`hybrid_lazyring`** | **−19.7 / −15.3% · tie** | **−63.2 / −57.4% · RESOLVED** | **−61.8 / −64.4% · RESOLVED** |

Against `hybrid` directly it is **−10.9 / −9.0% on hits** and a tie in mix and miss
(−0.9/+7.1%, +1.9/+3.4%): **deferring construction costs nothing where the ring is needed,
and saves the ring entirely where it is not.**

~~This host has 4 vCPU, where the loop term is only a tie. On 8 CPU the loop resolves at
−33.6%, so the lazy arm's hit-regime advantage should be **larger** there, not smaller.~~

**That prediction was wrong, and wrong structurally rather than by luck.** On 8 CPU the lazy
arm's hit advantage is **−3.2 / −2.9%** against `hybrid`, *smaller* than the sandbox's
−10.9 / −9.0% ([`v28_lazyring_laptop-btrfs.tsv`](v28_lazyring_laptop-btrfs.tsv)).

`hybrid_lazyring` and `hybrid` share **both** the ring-shaped loop and the miss mechanism —
the only difference between them is whether a ring is built when nothing misses. So their
delta is the **idle-ring term alone**, which is R measured in the hit regime. The loop term L
sits inside both arms and cannot widen the gap between them. "L resolves on 8 CPU" is true
and irrelevant to this comparison; what governs it is the idle ring, which is simply cheaper
on that host (**+5.4 / +4.6%** against the sandbox's **+17.5 / +14.2%**), so there is less to
save.

What does hold is the part that matters: deferring construction costs **nothing** where the
ring is needed — mix −1.2 / +0.7%, miss +0.2 / +0.0%, tighter than the sandbox's
+1.9 / +3.4%. The design is free everywhere; it just buys less on some hosts.

## Cost and caveats

One arm in `lab/disk-access-bench/src/bin/read_campaign.rs`, reusing `reader_ring`'s slot
bookkeeping with the ring calls replaced by `spawn_blocking`. The campaign itself is ~30 s;
the existing hosts can all re-run it ([`RUN-ON-YOUR-HOST.md`](RUN-ON-YOUR-HOST.md)).

Two things this does **not** settle:

* **One host.** The loop result is a tie on a 4-vCPU sandbox. Core count is precisely where a
  task-per-slot loop would be expected to differ, so repeat it somewhere with a different core
  count before treating "the loop is worth nothing" as settled.

* **Session count.** These loops are compared inside one reader. The product runs one per
  session, and the per-session cost of a ring is exactly what the ADR objected to — that is
  a memory-and-fd question, not a CPU one, and needs the multi-session cell.
* **`--readers` interaction.** `reader_pool` spreads asks over `depth` tasks; with
  `--readers > 1` the task count multiplies. Hold `readers` fixed when reading L, or the
  loop effect and the session effect mix again.
