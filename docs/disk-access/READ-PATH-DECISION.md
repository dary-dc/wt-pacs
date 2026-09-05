# Which read path, for which case · 2026-09-05

**Read this one first.** Everything else in `docs/disk-access/` is a cell that fed it.

The question: *given what we know today — browser clients, tens-of-GB studies on cloud
storage, clients that cache every increment they receive, and a disk layout that has not
been designed yet — how should the server read frame bytes?*

> **Lab only.** Nothing here is implemented in `server/`. The product tree is untouched by
> this investigation; `git diff` over `server/` against the branch point is empty. The
> deliverable is the decision, not code.

---

## The answer in one table

**Two things decide it, and they multiply: how many reads are in flight, and what fraction
of them miss the page cache.** Temperature, access shape and ask size only *produce* a miss
rate; depth and session count only *produce* an in-flight count.

`hybrid` versus `pool` (the path shipped today), CPU per ask, paired cell by cell across two
independent runs ([`v10_campaign.tsv`](v10_campaign.tsv)). Negative = the hybrid is cheaper;
the fraction is how many paired comparisons agreed:

| Reads in flight | 0–5% miss | 5–50% miss | 50–100% miss |
| ---: | ---: | ---: | ---: |
| **1** | −3.5% · 66/108 *(tie)* | **−44.8% · 12/12** | **−53.4% · 77/78** |
| **4** | −24.0% · 65/74 | **−51.2% · 45/46** | **−69.9% · 78/78** |
| **16** | −5.4% · 59/96 *(tie)* | **−61.3% · 78/82** | **−70.9% · 98/98** |
| **64** | −6.8% · 38/62 *(tie)* | **−70.2% · 28/28** | **−76.5% · 30/30** |

Read it as two rules:

* **Below ~5% misses the hybrid is a tie.** It costs nothing and buys nothing. Sign agreement
  is near a coin flip, which is what "no effect" looks like.
* **Above ~5% misses the hybrid wins, everywhere, and the win grows with concurrency** — from
  −45% at one read in flight to −77% at 64. Sign agreement is 12/12, 45/46, 78/82, 98/98,
  30/30. These are not marginal effects.

The same comparison for **pure io_uring** shows why the hybrid rather than the ring: it
matches the hybrid when misses dominate, and is **+47% CPU and 6× the latency** when they do
not, because every cached read pays a submit-and-complete round trip it never needed.
`pooled_pread` — the ADR's escape hatch — is 5–8× worse than either almost everywhere.

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

**The ranking does not move with ask size.** Cold, strided, 16 in flight:

| Ask size | `pool` | `hybrid` | `uring` |
| ---: | ---: | ---: | ---: |
| 4 KB | 45 749 ns | 12 704 ns | **7 233 ns** |
| 16 KB | 63 354 ns | 16 947 ns | **15 114 ns** |
| 64 KB | 84 723 ns | 35 521 ns | **31 012 ns** |

Rung size — the number nobody can pin down yet — does not change which read path to use.
**That is the part of this answer that survives the layout design whatever it turns out to
be.**

### The hybrid's worst cases, stated plainly

"Never materially worse" is a claim that deserves its own audit. Over all 792 paired
comparisons:

* the hybrid is **>20% worse in 40 cells (5.1%)** and **>20% better in 535 (67.6%)**;
* the median across every cell is **−46.6%**;
* the single worst cell is **+78.8%** (cold, strided, 64 KB asks, one read in flight, 76%
  misses — a shape where the extra `RWF_NOWAIT` attempt before each ring submission is pure
  overhead because it nearly always fails).

So the honest form of H5 is not "never worse" but **"worse in about one cell in twenty, by
less than it is better in two out of three"**. Every one of the 40 bad cells is at one read
in flight or at a miss rate under 5% — the two regions where the table above already says the
hybrid is a tie rather than a win.

### The one thing that did not resolve

A separate harness (`crossover_bench`, which controls the miss rate directly by pre-warming a
chosen fraction of the offsets — [`v11_crossover.tsv`](v11_crossover.tsv)) agrees with the
campaign everywhere except **one read in flight**, where it finds a tie at every miss rate,
including 100%:

| Reads in flight | miss rate | campaign: hybrid vs pool | crossover: hybrid vs pool |
| ---: | ---: | ---: | ---: |
| 1 | 100% | −53.4% (77/78) | −2.1% (4/6) |
| 8 | 100% | — | **−67.1% (6/6)** |
| 8 | 2% | — | −16.8% (5/6) |

Both were re-run back to back on the identical configuration and both reproduced their own
answer, so this is a difference between the harnesses, not host drift. I could not identify
the cause: both complete all asks, both report the same miss rate for the ring arm, and their
throughputs match within 20%. **Treat the depth-1 magnitude as unresolved — somewhere between
a tie and −53%.**

It does not change the recommendation. At one read in flight the hybrid is *at worst a tie*
in both harnesses, and every case we care about runs deeper than one.

## What that means for our cases

| Case | Miss rate it produces | Read path | Why |
| --- | --- | --- | --- |
| **US stack, whole frames in order, study fits in RAM** | 0% | `pool` or `hybrid` — indistinguishable | Nothing to overlap. Don't add a ring for this alone |
| **US stack, whole frames in order, study exceeds RAM** | ~6% (median; read-ahead carries most of it) | **`hybrid`** | Just past the crossover. Free when it does not help, −45% or better when it does |
| **Rung delivery from a frame-major layout** *(prefix of each frame, skip the rest)* | **90%** | **`hybrid`** | Read-ahead cannot see the pattern. −65% CPU, −27% p50, 283/284 cells |
| **Rung delivery from a layout that groups what is read together** | ~6% | **`hybrid`** | Grouping converts the case above into the case above that. Worth doing on its own merits, and the hybrid does not care either way |
| **Many concurrent sessions, cold** | 88–98% | **`hybrid`** | −20% to −56% CPU, threads flat at 5 vs 12–74 |
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

| Temp | Arm | Δ co-tenant gap p99 vs `pool` | lower in |
| --- | --- | ---: | ---: |
| **cold** | `uring` | **−39.5%** | 19/24 |
| **cold** | `hybrid` | **−41.0%** | 23/24 |
| warm | `uring` | +0.3% | 11/24 |
| warm | `hybrid` | +9.4% | 11/24 |

**The ring arms stall co-tenants less, not more** — where it matters (cold), by ~40%. Fewer
thread wakes and cross-worker migrations. Warm is a coin flip in both directions, i.e. no
effect. H6 holds: the cheaper arm is also the safer one.

*(Warm safety cells are short, so the monitor collects few gap samples and their p99 is close
to a single observation — the `hybrid` warm-d1 outlier in the raw data is that, not a stall.
Lead with the cold rows.)*

---

## Hypotheses, and how each ended

Stated before the campaign ran; see §Method for the controls.

| # | Hypothesis | Verdict |
| --- | --- | --- |
| **H1** | Ranking is governed by cache temperature, not shape | **Refined.** Neither: it is governed by *miss rate*, which temperature and shape both produce. But miss rate alone was not enough — see H2 |
| **H2** | Ranking depends on reads in flight; a ring cannot win at depth 1 | **Partly supported, and the correction to H1.** Miss rate and in-flight count *multiply*: the win runs from −45% at one read in flight to −77% at 64. Whether a ring wins at exactly one read in flight is the unresolved disagreement above |
| **H3** | The read-ahead hint and the mechanism are complementary | **Falsified.** They are substitutes: the hint's benefit collapses once the ring is in use |
| **H4** | Only total reads in flight matters, not how many readers hold them | **Falsified.** At 16 in flight, `pool` costs 60 µs/ask as one reader × 16 and 295 µs/ask as 16 readers × 1. The ring arms are far less sensitive, so the multi-session case favours them *more* than the single-session depth sweep suggests |
| **H5** | The hybrid is never worse than the better of pool and uring | **Supported with a caveat.** Worse by >20% in 40 of 792 comparisons (5.1%), better by >20% in 535 (67.6%), median −46.6%. Every bad cell sits at one read in flight or under 5% misses |
| **H6** | A CPU win does not cost executor safety | **Supported.** The ring arms lower co-tenant gaps by ~40% cold and are neutral warm |

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
(4 KB–250 KB) × prefetch. 2 800+ cells over two independent runs.

| Control | The failure it prevents |
| --- | --- |
| Arm order **rotates** per repeat | Drift settling on whichever arm runs first — this host produced a 34% "win" that reversed with the order in an earlier campaign |
| **Paired** comparisons by repeat, with sign counts | Comparing medians from cells that ran at different times |
| **Two independent runs**, sign-checked | Reading a within-run CI as an error bar. 83 of 84 vs-pool comparisons keep their sign across runs |
| **`--monitors 0` for cost cells** | The co-tenant monitor is a spin loop whose CPU scales with *wall time*, so leaving it on charges slow arms for the monitor's spinning. (An earlier pass of this analysis pooled safety cells into the cost buckets and had to be redone) |
| Cold cells **verify residency**, retry, and skip rather than abort | A warm cell silently labelled cold |
| **Wrap control** | `asks × stride` can exceed the file, so a "cold" cell re-reads its own pages warm. Re-run at 256 asks (no wrap) and 1024 asks (3× wrap): ranking and magnitudes unchanged (−50.8%/−54.7% vs −55.8%/−56.3% at cold d1) |
| **Partition control** | Overlapping readers share page-cache hits. Re-run with disjoint slices *and* an ask budget that fits inside a slice: ring arms still −20% to −56% |
| **Adversarial review** | The author grading their own homework — §Review |

### Limitations

* **This host is a 4-vCPU KVM guest on virtio-blk.** Cold cells are guest-cold but
  hypervisor-warm, so absolute latencies are optimistic. The CPU and thread findings do not
  depend on device speed; on slower storage `pool`'s thread count climbs *faster*.
* **Run-to-run drift is larger than the analysis threshold.** Repeating identical
  configurations moves a median by p50 11%, p90 28%. The 7% threshold in the script is
  therefore too permissive for a *single* comparison; the conclusions above rest on paired
  sign counts (88/88, 283/284) and on effect sizes of 50–70%, both far outside that drift.
* **Synthetic fixture**: uniform 16 KB records of constant bytes. Real codestreams vary in
  size, which changes the miss-rate distribution but not the mechanism.
* **One process, one file.** Sessions here are tasks in one process, which is what the server
  is; a multi-process deployment shares only the page cache.
* **The miss-rate bucketing uses `pool`'s miss counter** as the independent variable, because
  `uring` reports 100% by construction (every read goes through the ring, whether or not the
  page was cached). Buckets are therefore "what fraction *would* miss", which is the property
  of the workload, not of the arm.
