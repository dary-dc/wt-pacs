# Which read path, for which case · 2026-09-05

**Read this one first.** Everything else in `docs/disk-access/` is a cell that fed it.

The question: *given what we know today — browser clients, tens-of-GB studies on cloud
storage, clients that cache every increment they receive, and a disk layout that has not
been designed yet — how should the server read frame bytes?*

> **Lab only.** Nothing here is implemented in `server/`. The product tree is untouched by
> this investigation; `git diff` over `server/` against the branch point is empty. The
> deliverable is the decision, not code.

---

## In plain terms

There are three ways the server can fetch bytes from disk without freezing the thread that
serves everyone else:

* **`pool`** — what ships today. Ask the OS for the bytes *only if they are already in RAM*;
  if they are not, hand that read to a background thread that is allowed to wait.
* **`uring`** — hand every read to io_uring, a kernel queue that can carry many reads at once
  without needing a thread each.
* **`hybrid`** — try RAM first like `pool`; when that comes up empty, use the ring instead of
  a thread.

What the campaign found:

1. **When the bytes are usually already in RAM, `pool` is the right answer** — it adds queue
   bookkeeping to a read that never had to wait. Pure io_uring costs 20–160% more CPU and
   delivers a fifth to a half of the throughput.
2. **When the bytes usually are not in RAM, io_uring wins big** — 45–77% less CPU per read,
   *and* a little more throughput — and the advantage grows the more reads are in flight.
3. **`hybrid` gets both**, because it picks per read rather than per deployment. It wins
   case 2 outright and is a tie in case 1, so it never has to be told which case it is in.
   The one caveat is narrow: it serves cache hits one at a time *per session*, so a server
   that pipelines many asks within a single all-RAM session would lose throughput. Ours does
   not — our concurrency is one reader per user, and in that shape the caveat disappears.
4. **Threads are the hidden ceiling.** Every simultaneous cache miss costs `pool` an OS
   thread — up to 96 in these runs. The ring arms held 5 throughout.

Our deployment (tens-of-GB studies on cloud storage, so most reads miss) sits squarely in
case 2. **The recommendation is the hybrid**, and it does not depend on the disk layout
design or on rung size — those change *how much* it wins by, never *whether* it wins. The one
input it does depend on is the one we already know: that concurrency comes from many
independent sessions rather than deep pipelining inside one. If the server ever pipelines
many asks per session *and* studies fit in RAM, re-measure — that is the only square of the
surface where the hybrid is not the answer.

---

## The answer in one table

**Two things decide it, and they multiply: how many reads are in flight, and what fraction
of them miss the page cache.** Temperature, access shape and ask size only *produce* a miss
rate; depth and session count only *produce* an in-flight count.

`hybrid` versus `pool` (the path shipped today), CPU per ask, paired cell by cell across
three independent runs ([`v10_campaign.tsv`](v10_campaign.tsv)). Negative = the hybrid is cheaper;
the fraction is how many paired comparisons agreed:

| Reads in flight | 0–5% miss | 5–50% miss | 50–100% miss |
| ---: | ---: | ---: | ---: |
| **1** | −4.7% · 80/126 *(tie)* | **−44.8% · 12/12** | **−54.2% · 83/84** |
| **4** | −22.8% · 91/104 *(tie)* | **−48.2% · 51/52** | **−69.4% · 90/90** |
| **16** | −11.1% · 80/120 *(tie)* | **−60.8% · 90/94** | **−71.0% · 110/110** |
| **64** | −3.8% · 47/86 *(tie)* | **−71.7% · 40/40** | **−76.9% · 42/42** |

Read it as two rules:

* **Below ~5% misses the hybrid is a CPU tie** — but see the warning below, because CPU is
  not the only metric there and the hybrid is *not* free in that region.
* **Above ~5% misses the hybrid wins, everywhere, and the win grows with concurrency** — from
  −45% at one read in flight to −77% at 64. Sign agreement is 12/12, 51/52, 90/94, 110/110,
  40/40, 42/42. These are not marginal effects. **In that region the hybrid also delivers
  more throughput than `pool`** (1.02× to 1.34×, never less), so the CPU saving is not bought
  with wall time.

⚠️ **On cache hits, *how* the reads are held in flight decides the answer — and the CPU
column hides it.** Below 5% misses the hybrid delivers **0.57× / 0.41× / 0.36×** `pool`'s
asks per second at 4 / 16 / 64 in flight. That looked like a hidden cost of the hybrid. It is
not: it is an artifact of the campaign holding concurrency as *ring slots inside one task*.
At depth *D* the `pool` arm runs *D* concurrent tasks and a cache hit is a synchronous
`preadv2`, so it gets *D*-way CPU parallelism; the ring arms run **one task per reader** and
serve hits inline, one at a time.

Holding the *same* number of reads in flight as independent readers instead of depth removes
it entirely ([`v14_warm_concurrency.tsv`](v14_warm_concurrency.tsv), warm, 512 asks per
reader, throughput relative to `pool`):

| Reads in flight | held as | `hybrid` | `uring` |
| ---: | --- | ---: | ---: |
| 4 | depth 4, one reader | 0.45× | 0.21× |
| 4 | **4 readers, depth 1** | **1.40×** | 0.64× |
| 16 | depth 16, one reader | 0.31× | 0.26× |
| 16 | **16 readers, depth 1** | **0.95×** | 0.66× |

**This matters for us specifically.** Our concurrency is many sessions, not deep pipelining
inside one session — every user is an independent reader. In that shape the hybrid is at
parity or better on cache hits, so it carries no throughput penalty anywhere on the surface.
The 0.36× figure applies only to a server that pipelines many asks *within* one session on an
all-RAM study, and it is a property of serving hits from a single task, which an
implementation could fix. `uring` is bad on hits in **both** arrangements (0.21–0.66×), which
is the claim that actually generalises.

The same comparison for **pure io_uring** shows why the hybrid rather than the ring: it
matches the hybrid when misses dominate, and on cache hits costs **+20% CPU at 64 reads in
flight rising to +160% at one**, plus 0.21–0.53× the throughput, because every cached read
pays a submit-and-complete round trip it never needed. `pooled_pread` — the ADR's escape
hatch — is 5–8× worse than either almost everywhere.

### Latency: one half stands, one half withdrawn

CPU per ask is the cost metric; per-ask latency is what a reader feels. Δ vs `pool`, median
of paired cells, negative = faster:

| Reads in flight | miss | `hybrid` p50 | faster in | `uring` p50 | faster in |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0–5% | **−3.2%** | 82/126 | **+110%** | 5/126 |
| 4 | 0–5% | **−15.6%** | 90/104 | **+575%** | 0/104 |
| 16 | 0–5% | **−9.4%** | 87/120 | **+1721%** | 2/120 |
| 64 | 0–5% | **−17.2%** | 67/86 | **+4277%** | 2/86 |
| 1 | 50–100% | **−27.1%** | 83/84 | −26.2% | 83/84 |
| 4 | 50–100% | **−39.1%** | 89/90 | −11.9% | 77/90 |
| 16 | 50–100% | **−21.5%** | 98/110 | +16.2% | 21/110 |
| 64 | 50–100% | **−16.9%** | 37/42 | +12.7% | 15/42 |

**The hybrid is faster than `pool` in every group.** That part stands.

⚠️ **The `uring` column above is largely an artifact and is withdrawn.** Adversarial review
(§Review, F3) showed the two arms start their clocks at different points on the *hit* path: a
`pool`/`hybrid` hit is a synchronous syscall with no `.await`, so its timer starts when a
worker picks the ask up and excludes all queueing, while the ring timestamps every slot at
fill and charges it the batch's drain time. Little's law confirms it — warm, at depth 16,
`pool` reports a p50 of 0.13× the residence time its own throughput implies, and `uring`
reports 0.80×. Cold, all three agree, so the asymmetry is confined to the hit path.

The honest version of "io_uring is bad on cached reads" is the **throughput** column, which
has no such asymmetry: 2–5× fewer asks per second (0.21–0.53× `pool`), not 43× the latency.
That is still a
decisive reason to prefer the hybrid over a pure ring, on a smaller number.

**Threads, the ceiling a CPU number does not show:**

| Arm | median | worst |
| --- | ---: | ---: |
| `pool` | 8 | **96** |
| `pooled_pread` | 31 | **118** |
| `uring` | 5 | **5** |
| `hybrid` | 5 | **5** |

A concurrent miss costs an OS thread in the pool arms and nothing in the ring arms. Tokio's
blocking pool defaults to 512 threads, so `pool` has a hard ceiling on concurrent misses per
process that a ring does not have.

**Ask size enters only through the miss rate it produces.** Cold, stride 250 KB:

| Ask size | Coverage | Miss rate | `pool` | `hybrid` | `uring` |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 4 KB | 1.6% | 88% | 45 749 ns | 12 704 ns | **7 233 ns** |
| 16 KB | 6.6% | 88% | 63 354 ns | 16 947 ns | **15 114 ns** |
| 64 KB | 26% | 90% | 84 723 ns | 35 521 ns | **31 012 ns** |
| **250 KB** | **100%** | **11%** | 51 476 ns | **48 882 ns** | 59 832 ns |

⚠️ **Corrected after review (§Review, F7).** The first version of this table claimed "the
ranking does not move with ask size" and omitted the 250 KB row — the size the product
actually uses — because a labelling bug filed it under the wrong access shape. It does move:
at 250 KB the ring's advantage collapses at one read in flight and `uring` *loses* to `pool`.

But the reason is not size. At a fixed 250 KB stride, a 250 KB ask reads *everything* — it is
a sequential sweep, so read-ahead works and the miss rate falls from 88% to 11%. The row has
not left the surface; it has moved to a different square of it. **Size is not an independent
factor; it is a way of setting the miss rate.** Anyone reading this table should read the
surface above instead.

### Reproduced three times

The whole of phase A was run three times, independently. `hybrid` vs `pool`, CPU per ask,
median of paired comparisons within each run:

| Shape | Temp | Depth | run 1 | run 2 | run 3 |
| --- | --- | ---: | ---: | ---: | ---: |
| stride | cold | 1 | −54.3% | −50.6% | −57.1% |
| stride | cold | 8 | −74.1% | −74.4% | −66.9% |
| stride | cold | 64 | −77.5% | −79.6% | −79.9% |
| sweep | cold | 1 | −9.2% | −16.2% | −15.9% |
| sweep | cold | 16 | −65.2% | −60.1% | −64.9% |
| sweep | warm | 4 | −21.9% | −16.6% | −20.8% |
| stride | warm | 1 | +15.8% | +4.3% | −6.0% |

**26 of 28 configurations keep their sign across all three runs.** Both exceptions are in the
warm/strided tie region, where the effect is a few percent and a sign flip is what "no
difference" looks like. Every cold configuration reproduces, at every depth.

Note the last-but-one row: **even the sweeping shape — the one read-ahead handles well —
favours the hybrid once the study is cold and more than one read is in flight.** The ring is
not only for pathological access patterns.

### The hybrid's worst cases, stated plainly

"Never materially worse" is a claim that deserves its own audit, so the analysis script
prints the whole distribution rather than its median (`section_worst_cases`). Over all **960
paired cost comparisons**, applying the campaign's own 28.5% resolution threshold:

* the hybrid is **worse by more than 28.5% in 29 cells (3.0%)** and **better by more than
  28.5% in 563 (58.6%)**;
* the median across every cell is **−43.4%**;
* the single worst cell is **+104.1%** — warm, strided, 16 KB asks, 64 reads in flight, 0%
  misses. That is the hit-path concurrency shape above: 64 ring slots in one task against 64
  `pool` tasks, on a workload with nothing to overlap.

So the honest form of H5 is not "never worse" but **"worse in about one cell in thirty,
better in three out of five."** **27 of the 29 bad cells are at one read in flight or under
5% misses** — the regions the table above already calls a tie. The two that are not are
single repeats (`run1_B_prefetch_stride` cold at 4 in flight, 33% misses, +36.6%;
`run2_D_size250000` cold sweeping at 16 in flight, 27% misses, +48.2%), neither of which
reproduces in its neighbours.

### The harness disagreement, resolved — it was the harness

Two earlier harnesses (`crossover_bench`, and the `depth_read_bench` behind
[`DEPTH.md`](DEPTH.md)) found a **tie at one read in flight**, where the campaign finds
−53%. Both reproduced their own answer on re-runs, so it was not host drift. The cause turned
out to be in the harnesses, and it is worth stating because it is the kind of mistake that
looks like a result:

**Those two harnesses spawned the `pool` arm onto the runtime and ran the ring arm inline in
the `block_on` future** — that is, on the calling thread, which is not a runtime worker. Every
`complete_into().await` there parks a thread Tokio cannot schedule, so each completion batch
costs a cross-thread wake. The `pool` arm never pays it. It is a difference between how the
two arms were *driven*, not between the interfaces.

Placement is now a switch in `crossover_bench` (`CROSSOVER_INLINE=1` for the old behaviour),
which turns the suspicion into a controlled A/B — same binary, same cell, same repeats, one
variable. Median CPU per ask, 6 repeats each
([`v13_placement_ab.tsv`](v13_placement_ab.tsv)):

| Cell | Arm | inline | spawned | change |
| --- | --- | ---: | ---: | ---: |
| cold, 1 in flight | `pool` | 94 208 ns | 105 455 ns | 0.89× |
| cold, 1 in flight | `uring` | 94 487 ns | **46 203 ns** | **2.05×** |
| cold, 1 in flight | `hybrid` | 95 907 ns | **49 042 ns** | **1.96×** |
| cold, 8 in flight | `pool` | 71 156 ns | 83 791 ns | 0.85× |
| cold, 8 in flight | `uring` | 26 676 ns | 22 644 ns | 1.18× |
| cold, 8 in flight | `hybrid` | 25 757 ns | 23 805 ns | 1.08× |

**`pool` does not move; the ring arms halve.** And the residual scales as `1/depth` — about
+47 µs per ask at one in flight, +2 to +4 µs at eight — which is what a fixed cost paid once
per completion batch and amortised over the batch looks like.

That is the whole disagreement:

| Placement | cold, 1 in flight: hybrid vs pool |
| --- | --- |
| inline (old harnesses) | **+1.4%, 2/6** — the "tie" |
| spawned (campaign) | **−52.8%, 6/6** |

−52.8% against the campaign's −53.4%. **The campaign was right, the tie was an artifact, and
the depth-1 magnitude is no longer unresolved.** [`DEPTH.md`](DEPTH.md)'s "Real I/O, one read
at a time → Tie" row is withdrawn.

**What this does *not* rescue is the ring on cache hits.** The same A/B at a 0% miss rate
leaves `uring` worse than `pool` under both placements — +150% CPU at one in flight (0/6) and
+33% at eight, with p50 still 41 µs against 4 µs — so "never route a cache hit through a
ring" is not a placement artifact either. It survives, and it is the reason the recommendation
is the hybrid rather than the ring.

A note on what this cost: the artifact was invisible from the outputs. Both harnesses
completed every ask, reported the same miss rate for the ring arm, and agreed on throughput
within 20%. It was only findable by asking *where each arm's code actually runs*, which is why
an unexplained disagreement between two harnesses is worth keeping on the record until it is
explained rather than settled by counting cells.

## What that means for our cases

| Case | Miss rate it produces | Read path | Why |
| --- | --- | --- | --- |
| **US stack, whole frames in order, study fits in RAM** | 0% | `pool` or `hybrid` — indistinguishable | Nothing to overlap. Don't add a ring for this alone. Equal on throughput too, *provided* the concurrency is one reader per session rather than many asks pipelined inside one ([`v14_warm_concurrency.tsv`](v14_warm_concurrency.tsv)) |
| **US stack, whole frames in order, study exceeds RAM** | ~6% (median; read-ahead carries most of it) | **`hybrid`** | Just past the crossover. Free when it does not help, −45% or better when it does |
| **Rung delivery from a frame-major layout** *(prefix of each frame, skip the rest)* | **91%** | **`hybrid`** | Read-ahead cannot see the pattern. **−69.6% CPU in 377 of 378 cells**, −25.6% p50 in 332 of 378 |
| **Rung delivery from a layout that groups what is read together** | ~6% | **`hybrid`** | Grouping converts the case above into the case above that. Worth doing on its own merits, and the hybrid does not care either way |
| **Many concurrent sessions, cold** | 60–92% | **`hybrid`** | −24% to −58% CPU, threads flat at 5 vs 82 ([`v12_readers_fixed.tsv`](v12_readers_fixed.tsv), re-run after the bug in §Review F1) |
| **Filesystem without `RWF_NOWAIT`** (overlayfs, tmpfs) | 100% by definition | `pooled_pread` | The existing escape hatch. Unchanged |

**One recommendation covers every case we know: the hybrid.** It is not a compromise — it is
the arm that wins or ties everywhere, because the two mechanisms it combines win in disjoint
regimes.

---

## The second lever: an explicit read-ahead hint

Independent of the mechanism, `POSIX_FADV_WILLNEED` for the ask one round ahead changes the
miss rate itself — it states an access pattern that kernel read-ahead cannot infer.

| Shape | Arm | Δ CPU with the hint | Miss rate |
| --- | --- | ---: | --- |
| **stride**, d1 | `pool` | **−48.3%** (6/6) | 88% → 38% |
| **stride**, d4 | `pool` | **−38.8%** (6/6) | 91% → 44% |
| **stride**, d16 | `pool` | **−29.3%** (6/6) | 93% → 51% |
| **stride**, d1 | `hybrid` | −26.4% (6/6) | 88% → 41% |
| **stride**, d4/d16 | `hybrid` | tie | 90% → 39% |
| **sweep**, any | any | +4% to +18% (worse) | unchanged |

Two things this settles:

* **The hint is a routed choice, not a default.** On a sweeping read it competes with the
  read-ahead already working and costs 4–18%.
* **The hint and the ring are substitutes, not complements** — H3 falsified. The hint attacks
  the miss *rate*; the ring attacks the miss *cost*. Once the ring makes a miss cheap, halving
  the number of misses buys little: the hybrid gains 26% at depth 1 and nothing at depth 4+.
  **If we adopt the hybrid, prefetch is optional.** If we stay on `pool`, prefetch is the
  single biggest lever available without changing the mechanism.

It also needs the next ask, which `RequestFrames { frames }` declares today and
`RequestFrame { frame }` does not.

---

## Safety: does the cheaper arm stall co-tenants?

The property the ADR was chosen for does not appear in any cost column, so it is measured
separately, with a co-tenant task spinning `yield_now` and recording its own scheduling gaps.

| Temp | Arm | Δ co-tenant gap p99 vs `pool` | lower in | verdict by our own rule |
| --- | --- | ---: | ---: | --- |
| cold | `uring` | −39.5% | 19/24 | **tie** (needs 20/24) |
| cold | `hybrid` | −41.0% | 23/24 | better |
| cold | `pooled_pread` | −45.5% | 20/24 | better ← **implausible** |
| warm | any | ±10% | 11/24 | noise |

⚠️ **This phase does not support a safety claim, and the earlier version of this section
overstated it.** Two problems, both found in review (§Review, F10):

1. `uring`'s 19/24 **fails the 0.8 sign-agreement rule this campaign applies everywhere
   else**. It was reported as "−39.5%" anyway.
2. `pooled_pread` — 118 threads, worst CPU, the arm this section is supposed to condemn —
   scores *better* than `pool` on the same metric. An arm with 118 blocking threads cannot
   plausibly be gentler on co-tenants. The metric is tracking something else, most likely
   monitor sample count against wall time.

**What we can say:** nothing here suggests the ring arms are *worse* for co-tenants, and the
`hybrid` row is the only one that passes the rule. **What we cannot say:** that they are
better. H6 is **unmeasured**, not supported. Settling it needs one monitor per worker, gaps
normalised by sample count, and a real co-tenant workload rather than a spin loop.

---

## Hypotheses, and how each ended

Stated before the campaign ran; see §Method for the controls.

| # | Hypothesis | Verdict |
| --- | --- | --- |
| **H1** | Ranking is governed by cache temperature, not shape | **Refined.** Neither: it is governed by *miss rate*, which temperature and shape both produce. But miss rate alone was not enough — see H2 |
| **H2** | Ranking depends on reads in flight; a ring cannot win at depth 1 | **Partly supported, and the correction to H1.** Miss rate and in-flight count *multiply*: the win runs from −45% at one read in flight to −77% at 64. The premise — that a ring cannot win at depth 1 — is **false**: it wins there too, and the two harnesses that said otherwise were driving the ring off the runtime (§The harness disagreement) |
| **H3** | The read-ahead hint and the mechanism are complementary | **Falsified.** They are substitutes: the hint's benefit collapses once the ring is in use |
| **H4** | Only total reads in flight matters, not how many readers hold them | **Supported, after a correction.** The first verdict said "falsified — 60 µs/ask as 1×16 vs 295 µs/ask as 16×1"; that gap was a harness bug that discarded 15 of 16 readers' records while keeping their CPU (§Review F1). Re-run: at 16 in flight, `pool` costs 53.9 µs/ask as 4×4 and 42.8 µs/ask as 16×1 — more readers is equal or slightly cheaper, not 5× dearer. **Then falsified for the hit path:** warm, the same 16 in flight gives the hybrid 0.31× `pool`'s throughput as depth 16 and 0.95× as 16 readers. On misses the total is what matters; on hits the arrangement is |
| **H5** | The hybrid is never worse than the better of pool and uring | **Supported with a caveat.** Worse by >28.5% in 29 of 960 comparisons (3.0%), better by >28.5% in 563 (58.6%), median −43.4%. 27 of the 29 bad cells sit at one read in flight or under 5% misses; the other two are unreproduced single repeats |
| **H6** | A CPU win does not cost executor safety | **Unmeasured.** The instrument does not discriminate: it scores `pooled_pread` — 118 threads — as gentler on co-tenants than `pool`. No evidence of harm, no evidence of benefit |

---

## Method and controls

`lab/scripts/run_read_campaign.sh` → [`v10_campaign.tsv`](v10_campaign.tsv), analysed by
`lab/scripts/analyze_read_campaign.py`. Harness: `lab/disk-access-bench/src/bin/read_campaign.rs`.
Fixture: 5 120 × 16 KB records in an 84 MB SBND, so stride and sweep come from the same bytes.

| Arm | What it is |
| --- | --- |
| `pool` | **The product today.** `RWF_NOWAIT` on the executor, `spawn_blocking` for the shortfall |
| `uring` | One io_uring ring per reader, registered file and buffers; every read goes through it |
| `hybrid` | `RWF_NOWAIT` inline, ring only for what it could not get |
| `pooled_pread` | The ADR's escape hatch: every read on the blocking pool |

Factors crossed: arm × depth (1–64) × readers (1–16) × temperature × shape × ask size
(4 KB–250 KB) × prefetch. **3 612 cells over three independent runs**, plus two follow-up
experiments run while folding in the review: the placement A/B
([`v13_placement_ab.tsv`](v13_placement_ab.tsv)) and the warm concurrency shape
([`v14_warm_concurrency.tsv`](v14_warm_concurrency.tsv)).

| Control | The failure it prevents |
| --- | --- |
| Arm order **rotates** per repeat | Drift settling on whichever arm runs first — this host produced a 34% "win" that reversed with the order in an earlier campaign |
| **Paired** comparisons by repeat, with sign counts | Comparing medians from cells that ran at different times |
| **Three independent runs**, sign-checked | Reading a within-run CI as an error bar. 26 of 28 phase-A configurations keep their sign across all three; every cold one does |
| **`--monitors 0` for cost cells** | The co-tenant monitor is a spin loop whose CPU scales with *wall time*, so leaving it on charges slow arms for the monitor's spinning. (An earlier pass of this analysis pooled safety cells into the cost buckets and had to be redone) |
| Cold cells **verify residency**, retry, and skip rather than abort | A warm cell silently labelled cold |
| **Wrap control** | `asks × stride` can exceed the file, so a "cold" cell re-reads its own pages warm. Re-run at 256 asks (no wrap) and 1024 asks (3× wrap): ranking and magnitudes unchanged (−50.8%/−54.7% vs −55.8%/−56.3% at cold d1) |
| **Partition control** | Overlapping readers share page-cache hits. Re-run with disjoint slices *and* an ask budget that fits inside a slice: ring arms still −20% to −56% |
| **Adversarial review** | The author grading their own homework — §Review |

### Limitations

* **This host is a 4-vCPU KVM guest on virtio-blk.** Cold cells are guest-cold but
  hypervisor-warm, so absolute latencies are optimistic. The CPU and thread findings do not
  depend on device speed; on slower storage `pool`'s thread count climbs *faster*.
* **Run-to-run drift is large.** Repeating identical configurations moves a median by p50
  11% and p90 28.5% on this host. The script's threshold is set to that p90 (`DRIFT_PCT`),
  not to taste — an earlier 7% threshold would have called more than half of pure drift a
  result (§Review, F6). Every headline effect above survives the stricter test; the ones
  that do not are labelled ties.
* **Synthetic fixture**: uniform 16 KB records of constant bytes. Real codestreams vary in
  size, which changes the miss-rate distribution but not the mechanism.
* **One process, one file.** Sessions here are tasks in one process, which is what the server
  is; a multi-process deployment shares only the page cache.
* **One read per ask, not the product's window loop.** Every arm here issues a single read of
  `size` bytes per ask. The product streams a frame in 64 KiB windows, so a 250 KB whole-frame
  ask is four reads there and one here. For rung delivery (16–210 KB) the models coincide;
  for whole-frame delivery the campaign understates the per-ask syscall count for every arm
  equally, which should not move a comparison but does move the absolute numbers.
* **The miss-rate bucketing uses `pool`'s miss counter** as the independent variable, because
  `uring` reports 100% by construction (every read goes through the ring, whether or not the
  page was cached). Buckets are therefore "what fraction *would* miss", which is the property
  of the workload, not of the arm.

---

## Review

This campaign was reviewed adversarially — a reviewer with the raw data, the harness source
and a written list of my claims, briefed to break them rather than confirm them. It found
eleven issues. The ones that changed something:

| # | Finding | What it cost |
| --- | --- | --- |
| **F1** | In multi-reader cells, reader *r*'s base offset was **added** to an already-wrapped offset, so every reader but the first read past EOF, panicked, and had its records discarded — while its CPU stayed in the total. `pool` recorded 512 asks where the ring arms recorded 8 192. | **Claim reversed.** "More readers is 5× worse for pool" was the artifact. Re-run: more readers is equal or cheaper. Harness fixed (offsets by reader *phase*, panics propagated, and a hard assertion that recorded asks == expected) |
| **F2** | Non-partitioned readers walked a shifted subset of the *same* offsets, so 16 "sessions" were ~96% re-reads of one session | Phase C re-run with interleaved phases so readers genuinely differ |
| **F3** | The two arms start their latency clocks at different points on the hit path; Little's law shows `pool` reporting 1/30th of its own implied residence time warm | **Warm latency comparison withdrawn.** Throughput used instead |
| **F4** | `miss_pct` means three different things across arms, and the bucketing script was not in the repo | Bucketing committed as `section_surface`, with the x-axis documented as *pool's* miss rate |
| **F6** | `paired()` keyed on `(cell, repeat)` without the run, so every "6/6" described one run while the median beside it pooled three. And a 7% drift threshold sat below the measured p50 drift of 11% | Both fixed. Threshold now 28.5%, the measured p90. **Every headline result survives the stricter test** |
| **F7** | The 250 KB block — the production frame size — was labelled with the wrong access shape and silently dropped from the size table | **Claim corrected.** "The ranking does not move with ask size" was wrong; size moves the miss rate, and the row belongs elsewhere on the surface |
| **F10** | The safety metric scores `pooled_pread` (118 threads) as gentler on co-tenants than `pool`, and `uring`'s 19/24 fails the campaign's own 0.8 rule | **Safety claim withdrawn.** H6 is unmeasured |
| **F8** | Diagnosed the harness disagreement at depth 1 as a `block_on`-placement artifact. Turned into a controlled A/B: placement is now a switch, and flipping it moves the ring arms 2× while leaving `pool` untouched | **Open question closed**, in the campaign's favour. The same A/B confirms the ring still loses on pure cache hits, so that claim is not an artifact |

What survived unchanged: the decision surface, the −45% to −77% CPU advantage above 5%
misses, the thread ceiling, and the recommendation. F9's audit of the timed region found the
remaining instrumentation asymmetries run *against* the ring, not for it, and noted that
`pooled_pread` is a genuine control showing the wasted `RWF_NOWAIT` syscall is not what drives
the win.

The review's own residual criticisms, which I have not resolved and which stand against this
document:

* **The hop tax is this host's.** `pooled_pread` prices a `spawn_blocking` round trip at
  68–91 µs of process CPU on a near-idle 4-vCPU KVM guest. That constant is what produces the
  2–3× ring win. Nothing here shows it holds on bare metal, on a loaded runtime, or at a
  different worker count.
* **`pool` cannot hold depth > 4 warm.** A hit is a synchronous syscall, so the warm "depth
  64" cells for `pool`/`hybrid` are really 4-worker cells. **Followed up and it turned out to
  be worse than the reviewer said, then better:** warm, the *arms* do not even hold depth the
  same way — `pool` gets *D* tasks, the ring arms get one — which cost the hybrid up to 0.31×
  `pool`'s throughput. Re-holding the same reads in flight as independent readers restores
  parity ([`v14_warm_concurrency.tsv`](v14_warm_concurrency.tsv)), which is our shape. The
  warm depth axis is still a 4-worker measurement and should not be read as a depth result.
* **The flat-5 thread count for ring arms is unverified at scale** — no cell here runs enough
  concurrent rings to force io-wq punting.
* **ext4 only.** Where `RWF_NOWAIT` is refused, `pool` and `hybrid` both collapse onto
  `pooled_pread`.

### After the review: two things the reconciliation itself turned up

Folding the review in meant re-deriving every number from the committed analysis script
rather than from working notes, and that shook out two more corrections. Both are in the doc
above; both are recorded here because neither came from the reviewer.

1. **The surface table and the worst-case audit had drifted from the script.** The published
   figures had been computed by hand at a 20% threshold over a subset of cells. Regenerated
   from `analyze_read_campaign.py` at 28.5% over all 960 pairs, the ranking and every verdict
   are unchanged, but the numbers move (median −46.6% → −43.4%, "40 of 792 bad" → "29 of
   960"). The audit is now a section of the script (`section_worst_cases`) so it cannot drift
   again.
2. **Throughput contradicted CPU on the hit path**, which is what exposed the arms holding
   concurrency differently — the `v14` experiment above. A CPU-only comparison would have
   shipped "the hybrid is a free tie on cache hits", which is true for our session shape and
   false for a pipelined one. **Reporting cost and throughput side by side is what caught
   it**; either alone would not have.
