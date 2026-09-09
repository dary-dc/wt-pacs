# Read-path evidence — every number the decision rests on

**Decision:** [`adr.md`](adr.md) · **Implementation:** [`IMPLEMENTATION.md`](IMPLEMENTATION.md) ·
**Deployment:** [`DEPLOYMENT.md`](DEPLOYMENT.md)

This file carries the numbers so they survive a squash. Raw TSVs and the design diary:

```bash
git show read-path-workstation-2026-09-09:docs/disk-access/  # the workstation run (w1_*)
git show read-path-evidence-2026-09-09:docs/disk-access/     # this branch's tables
git show a330783:docs/disk-access/READ-PATH-DECISION.md      # 2026-09-04 campaign, long form
```

`lab/disk-access-bench` stays on the tip. `lab/scripts/s5_split.py` and `pair_arms.py`
apply the rule below to a TSV checked out from the tag.

## The rule every number below obeys

Re-running an identical configuration moves a median by up to 7% within a run and ~11% (p50)
across campaigns on these hosts. So:

> A difference counts only if **|median| ≥ 28.5%** (the measured p90 drift) **and** sign
> agreement **≥ 0.8n**, **and** it keeps its sign across independent runs.

Everything else is reported as a **tie** — not as a small effect. `lab/scripts/s5_split.py`
applies this mechanically.

## The candidates

Median CPU per read (ns), 4 vCPU sandbox, two runs pooled. Regime is `pool`'s miss rate:
hit < 5%, mix 5–50%, miss ≥ 50%.

| Arm | What it is | hit | mix | miss |
| --- | --- | ---: | ---: | ---: |
| `pool` | **ships today** — `RWF_NOWAIT` inline, `spawn_blocking` on the miss | 2 598 | 14 004 | 60 100 |
| `pool_ringloop` | S5 control — same, one task holding N slots | **2 069** | 12 146 | 77 079 |
| `hybrid` | `RWF_NOWAIT` inline, io_uring on the miss | 2 351 | **5 068** | 22 612 |
| **`hybrid_lazyring`** | **recommended** — `hybrid`, ring built on the *first miss* | 2 144 | 5 298 | 24 188 |
| `uring` | every read through the ring | 4 942 | 5 312 | **14 051** |
| `pooled_pread` | escape hatch — every read on the pool | 36 798 | 38 014 | 68 770 |

**The shipped path has since been measured as an arm of its own** — `product` drives
`server`'s `ReadCtx` rather than modelling it (`v30_product.tsv` at the evidence tag, a
different host and a different cell design, so read it against `hybrid_lazyring` in its own
run and not against the column above). It ties the chosen arm and beats the path it replaced:
−0.5% on hits, **+0.7% on 16 KiB misses**, **−45.4% RESOLVED against `pool`** there. See
[`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Validated.

> **Read the column, then read the pair.** These are pooled medians per arm, and the rule
> above is defined on **paired** per-cell deltas. The two disagree by about 2x on the one
> comparison a reader most wants to make: `uring` against `hybrid_lazyring` on misses is
> **−41.9%** as a ratio of the medians in this table and **−24.0%** as the median of the
> per-cell ratios. Both are arithmetically right on the same 84 cells; only the second is
> what the threshold applies to. The table has been misread as a 42% win for plain io_uring
> twice. Run `lab/scripts/pair_arms.py` before concluding anything from a row of it.

| Pair, miss regime | ratio of medians here | **paired median (the rule)** | verdict |
| --- | ---: | ---: | --- |
| `uring` vs `hybrid_lazyring` | −41.9% | **−24.0%**, 73/84 same sign | **tie** — fails on magnitude, not consistency |
| `uring` vs `hybrid` | −37.9% | **−26.5 / −16.7%** | tie |
| `hybrid_lazyring` vs `pool` | −59.8% | **−61.8 / −64.4%** | RESOLVED |

`hybrid_lazyring` is **tied for cheapest in all three regimes** under the rule above. No arm
is established better than it anywhere; `uring`, the only arm cheaper on misses, is
established **+141.7 / +131.0% worse on hits**. That is why there is no tuning toggle —
see [`IMPLEMENTATION.md`](IMPLEMENTATION.md).

> **Re-measured 2026-09-08 on the product's own host** (`v32_depth.tsv` at the evidence tag),
> 16 KiB reads, misses forced past the read-ahead window. The depth effect reproduces in
> direction but is **much smaller than published**: `uring` vs `hybrid_lazyring` on misses is
> +0.1% at depth 1, **−14.9%** at depth 4 and **−9.7%** at depth 16 — all ties — against a
> published −30 to −43% at those depths. Priced in absolute ns per ask, `uring`'s penalty on
> a hit exceeds its saving on a miss at every depth, so it only pays above a **53–64% miss
> rate**:
>
> | depth | `uring` hit penalty | `uring` miss saving | breakeven miss rate |
> | ---: | ---: | ---: | ---: |
> | 1 | +9 009 ns | −1 800 ns (worse) | never wins |
> | 4 | +4 433 ns | +3 913 ns | **53%** |
> | 16 | +1 575 ns | +890 ns | **64%** |
>
> Meanwhile the win that is established is `hybrid_lazyring` against `pool` on misses:
> **−56 / −70 / −75% RESOLVED** at depths 1 / 4 / 16. The large gain is already taken; the
> `uring` question is a 5–15% residual on top of it, and only in a deep, miss-dominated
> regime.

**The miss-regime tie is a queue-depth artefact, and it disappears at the depth the product
runs.** Splitting the same 84 cells by `depth`:

| `uring` vs `hybrid_lazyring`, misses | depth 1 | 4 | 8 | 16 | 32 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `v27` run1 / run2 | **−1.2 / −1.9%** | −41.6 / −25.6% | −42.8 / −40.5% | −41.8 / −40.8% | −28.5 / −29.5% |
| `v28` (btrfs) | **+4.0 / −0.8%** | +2.0 / +1.8% | −1.6 / −0.8% | −6.4 / −4.7% | +4.1 / +3.0% |

At depth > 1 the hybrid's inline probes run serially on the executor before the ring can
batch, turning a parallel submission into a serial prologue. **At depth 1 there is nothing to
serialise and the arms tie.** `docs/adr-reject-server-ordering.md` fixes the session loop at
**depth 1**, so the −24.0% never applied to this product. Restricted to depth-1 cells,
`uring`'s hit penalty is **+386%** (`v27`) / **+133%** (`v28`) and its miss advantage is
**4–6%**, moving the breakeven miss rate from 21.6% to **65–84%**.

Reproduce: `lab/scripts/pair_arms.py --pairs uring:hybrid_lazyring --by depth /tmp/v27_lazyring.tsv`.

**What is still open** is not that comparison but its coverage: both lazyring datasets are
**`readers=1`**, so the recommended arm has never run with more than one concurrent session.
The reader-scale evidence (`v25_r5`, to 128 readers) does not include it — though it does show
`hybrid` and `uring` both flat at **5 OS threads** where `pool` reaches **381**, so thread
growth separates ring-from-`pool`, not the two ring arms.

## The candidates, re-measured on the code that ships · 2026-09-09 (4 vCPU sandbox)

The table above was taken before the read path was reshaped (`WINDOWS`, the planner, the thin
ring) and its verdicts were inherited, not re-checked. They were re-checked on 2026-09-09, at
**two frame sizes**, through `read_campaign`'s **`product` arm — the shipped `ReadCtx`
itself, not a model of it**. Raw TSVs (`x17_*`, `x18_*`) are at the evidence tag.

**Two harnesses, and they do not share a scale.** `read_campaign` times a read;
`disk-access-bench` times a read **plus a quinn-shaped copy into a write buffer** — its
`copied/ask` column. The same mechanism reads 1.6 µs in one and 3.6 µs in the other.
**Compare arms within a block, never across the rule.** `pread_nowait_chunked` is the bridge:
the 2026-09-07 shape of what `product` is now.

Depth 4, median of 8 (`read_campaign`) or 7 (`disk-access-bench`) repeats, 4 vCPU sandbox.
Latency is **p50 · p90 · p99** per ask; the lower block reports a mean where the upper reports
p90. `gap max` is the longest a co-tenant task waited — the column mmap is rejected on.

#### 16 KiB frames

| arm | warm p50 · p90 · p99 | warm CPU/ask | warm gap max | cold p50 · p90 · p99 | cold CPU/ask | cold gap max | copied/ask | cold miss |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`product`** | **1.6 · 1.9 · 5.7 µs** | 2.0 µs | 224 µs | **125 · 171 · 233 µs** | 69 µs | 261 µs | — | 99.4 % |
| `hybrid_lazyring` | 1.5 · 1.7 · 2.3 µs | 1.5 µs | 518 µs | 117 · 166 · 250 µs | 48 µs | 1 590 µs | — | 99.2 % |
| `pool` | 1.6 · 1.8 · 3.2 µs | 1.7 µs | 170 µs | 141 · 228 · **473 µs** | 94 µs | 512 µs | — | 98.8 % |
| `uring` | **20.4** · 23.6 · 49.2 µs | 2.8 µs | 1 552 µs | 133 · 174 · 229 µs | **39 µs** | 212 µs | — | 100 % |
| `pooled_pread` | **22.4** · 98.7 · **276 µs** | 32 µs | 360 µs | 146 · 237 · 461 µs | 93 µs | 285 µs | — | 100 % |
| *— the copying harness —* | | | | | | | | |
| `pread_nowait_chunked` | 3.6 · 4.4 · 26.3 µs | 9.9 µs | 80 µs | 20.0 · 48.8 · 191 µs | 66 µs | 771 µs | 16 KiB | — |
| `uring_nowait_whole` | 3.3 · 4.2 · 24.9 µs | 9.2 µs | 130 µs | 16.5 · 49.6 · 197 µs | 78 µs | 547 µs | 16 KiB | — |
| `mmap_naive` | **1.9** · 2.4 · 21.3 µs | **5.4 µs** | 76 µs | **2.2** · 10.7 · 27.6 µs | **11 µs** | **4 158 µs** | **0** | — |
| `mmap_hybrid_mincore` | 2.7 · 3.5 · 23.1 µs | 7.7 µs | 80 µs | 3.0 · 12.5 · 29.6 µs | 22 µs | 118 µs | **0** | — |
| `mmap_touch_in_place` | 19.2 · 44.7 · 182 µs | 71 µs | 829 µs | 19.3 · 53.2 · **1 067 µs** | 84 µs | 530 µs | **0** | — |
| `mmap_populate_read` | 37.8 · 40.5 · 78.4 µs | 57 µs | 137 µs | 42.8 · 49.3 · 94.2 µs | 70 µs | 202 µs | **0** | — |
| `mmap_blocking_touch` | 34.1 · 40.0 · 81.0 µs | 54 µs | 128 µs | 35.6 · 47.5 · 84.2 µs | 67 µs | 140 µs | **0** | — |
| `pread_blocking_pooled` | 32.8 · 37.4 · 80.8 µs | 54 µs | 132 µs | 48.5 · 78.1 · 234 µs | 122 µs | 235 µs | 16 KiB | — |

#### 250 kB frames

| arm | warm p50 · p90 · p99 | warm CPU/ask | warm gap max | cold p50 · p90 · p99 | cold CPU/ask | cold gap max | copied/ask | cold miss |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`product`** | **39.6 · 49.3 · 90.0 µs** | 39 µs | 2 329 µs | 623 · 745 · 877 µs | 261 µs | 300 µs | — | 99.5 % |
| `hybrid_lazyring` | 41.7 · 50.2 · 92.4 µs | 42 µs | 8 819 µs | 611 · 732 · 901 µs | 270 µs | 6 133 µs | — | 99.5 % |
| `pool` | 38.9 · 46.9 · 77.8 µs | 35 µs | 2 387 µs | **514 · 616 · 776 µs** | **238 µs** | 398 µs | — | 99.5 % |
| `uring` | **262 · 290 · 335 µs** | 68 µs | 13 726 µs | 693 · 807 · **1 407 µs** | 258 µs | 1 330 µs | — | 100 % |
| `pooled_pread` | 82.4 · 210 · 467 µs | 95 µs | 381 µs | 563 · 700 · 1 007 µs | 268 µs | 285 µs | — | 100 % |
| *— the copying harness —* | | | | | | | | |
| `pread_nowait_chunked` | 52.5 · 58.7 · 115 µs | 128 µs | 173 µs | 72.1 · 199 · **1 036 µs** | 315 µs | 516 µs | 244 KiB | — |
| `uring_nowait_whole` | 50.6 · 57.3 · 115 µs | 128 µs | 318 µs | 262 · 252 · 989 µs | 415 µs | 622 µs | 244 KiB | — |
| `mmap_naive` | **33.0** · 38.3 · 87.1 µs | **85 µs** | **92 µs** | **45.3** · 155 · **3 276 µs** | 262 µs | **3 991 µs** | **0** | — |
| `mmap_hybrid_mincore` | 35.1 · 42.5 · 94.8 µs | 96 µs | 94 µs | 50.1 · 169 · **3 364 µs** | 291 µs | 436 µs | **0** | — |
| `mmap_touch_in_place` | 54.7 · 62.5 · 158 µs | 138 µs | 612 µs | 99.2 · 239 · **3 654 µs** | 388 µs | 724 µs | **0** | — |
| `mmap_populate_read` | 137 · 142 · 288 µs | 207 µs | 129 µs | 155 · 270 · **3 668 µs** | 397 µs | 1 269 µs | **0** | — |
| `mmap_blocking_touch` | 130 · 137 · 271 µs | 193 µs | 134 µs | 160 · 277 · **3 914 µs** | 413 µs | 246 µs | **0** | — |
| `pread_blocking_pooled` | 163 · 169 · 320 µs | 284 µs | 133 µs | 289 · 312 · 1 107 µs | 509 µs | 571 µs | 244 KiB | — |

### What the second frame size settled

**`uring`'s penalty is a hit penalty, and it scales with the frame.** 20.4 µs against
`product`'s 1.6 at 16 KiB; **262 against 39.6 at 250 kB** — 6.6× either way, but 222 µs of
absolute latency per frame at the size a viewer pulls, and a **13.7 ms warm `gap max`**.

**mmap does not copy, and it shows — in CPU, not in latency.** Within the copying harness,
`mmap_naive` against `pread_nowait_chunked`: **5.4 µs against 9.9** warm at 16 KiB, **85
against 128** at 250 kB. A third to a half less CPU per ask, exactly the 16 KiB / 244 KiB the
`copied/ask` column says it never moves.

**And then the tail, which 250 kB frames make worse.** Every mmap arm sits at
**p99 3 276–3 914 µs** at 250 kB cold against `pread_nowait_chunked`'s 1 036, and
`mmap_naive` holds a worker for **3 991 µs** — whichever *other* session shares it waits 4 ms.
At 16 KiB the freeze was there too (4 158 µs) but hid behind a p99 of 27.6 µs; at 250 kB the
tail is bad **and** the median it hid behind is gone. This is [`adr.md`](adr.md) §5's
*"faults freeze co-tenants: 1.5–4.2 ms"*, reproduced on the current tree.

**No mmap arm is both quick and safe.** `populate_read` and `blocking_touch` move the fault to
the pool and land at 130–160 µs against 52.5–72.1 — 2–3× slower at 1.5–2× the CPU. The whole
saving, paid back.

**The ring's worth is size-dependent, not only depth-dependent.** At 250 kB cold, `pool` beats
`product` at both depths — **514 µs against 623, at less CPU (238 against 261)**. At 16 KiB the
ring was ahead from depth 4 and resolved at 16 (−29.8 %, 10/10). This is the *"Frames past
250 KB"* row below, arriving early: **the ring's per-round-trip saving does get less
significant as the frame grows, and by 250 kB it is already negative on this host.** P0 must
run both frame sizes, not only both depths.

> **Confirmed on the workstation, where it clears the rule** — `product` against `pool` at
> 250 kB cold is **+38.5 % / +42.3 % RESOLVED** at depths 1 and 4 on p50, CPU agreeing. That
> run also found the penalty is **`product`'s and not the ring's**: `hybrid_lazyring` ties
> `pool` at 250 kB at every depth. See *The same candidates on the workstation*.

> **The lower block's cold cells are only partly cold, and the arms differ in how.**
> `disk-access-bench` reports no residency or miss control — `read_campaign` has `miss_pct`
> and `resident_pct`, which is how the upper block can say 99.5 %. Cold p50 ÷ warm p50 is
> **5.3× for `pread_nowait_chunked` at 16 KiB but 1.1× for `mmap_naive`**: mmap's fault-around
> pulls in neighbours a 64 KiB `pread` window does not, so on a walk it converts misses to
> hits more aggressively. That is a real advantage — and it is also why its cold median
> flatters it. **It is not doing the same I/O faster, it is doing less of it.** The asks that
> do reach the device are the 3–4 ms p99 above. **The workstation widens this gap**: 14.9× for
> `uring_nowait_whole` against 1.8× for `mmap_naive` in the one cell that is properly cold
> there (250 kB random), and its forward-trace cells are barely cold at all (1.1–1.6× for
> every arm).

Cold thresholds on that host (`read_ahead_kb` 8192), because a contiguous stride is a hit cell
wearing a cold label at both sizes: 16 KiB asks miss 1.6 % at a 16 kB stride and 100 % at
262 kB; 250 kB asks miss 2.3 % at a 250 kB stride, 97.7 % at 500 kB and 99.2 % at 2 MB.

**The workstation's thresholds are different and had to be re-derived** — `read_ahead_kb` is
4096 there on the **btrfs bdi**, not the 128 the block device reports, and reading the block
device alone would have set the stride 32× too low. 16 KiB asks miss **0.8–2.3 %** at a 16 kB
stride, 93.0 % at 32 kB, 96.1 % at 64 kB, 98.4–99.2 % at 250 kB; 250 kB asks miss
**3.1–12.5 %** at a 250 kB stride and 99.2 % from 500 kB up. Full sweep in `w1_host.txt` at
the workstation tag. **A stride calibrated on one host is not portable to another.**


## The same candidates on the workstation · 2026-09-09

The block above is the 4 vCPU sandbox, whose cold misses are partly hypervisor-cached. This
is the **8-thread i5-8250U**, btrfs-on-LUKS over NVMe, where a miss is a real device read —
the campaign's only bare-metal host. Five arms, both frame sizes, cold and warm, depths
1 / 4 / 16, 12 interleaved repeats, monitors on. Raw at the workstation tag: `w1_16k_arms.tsv`,
`w1_250k_arms.tsv`, `w1_16k_mmap.tsv`, `w1_250k_mmap.tsv`, `w1_host.txt`.

**Not P0.** P0 is the production instance type, volume class and container image
([`NEXT.md`](NEXT.md)); nothing here is labelled P0. Two preconditions this host could not
meet, and they bound the magnitudes: a desktop session stayed up (~82 % CPU idle), and
`powersave` + turbo could not be pinned without root. Arms interleave per repeat, so the
paired deltas absorb drift; the absolute microseconds carry it.

### The ring still loses to the pool at 250 kB cold — and here it clears the rule

The sandbox saw `pool` ahead of `product` at 250 kB cold (514 µs against 623) and reported it
as an observation. On the workstation it clears the bar on **both** metrics, at the depths the
device does not dominate:

| `product` vs `pool`, 250 kB cold | p50 | CPU/ask |
| --- | --- | --- |
| depth 1 | **+38.5 % RESOLVED**, 11/12 | **+36.5 % RESOLVED**, 11/12 |
| depth 4 | **+42.3 % RESOLVED**, 11/12 | **+33.2 % RESOLVED**, 11/12 |
| depth 16 | +3.7 % tie | +7.3 % tie — *past saturation, below* |

At 16 KiB the same pair ties at every depth (+4.3 / +1.2 / −6.6 %). **The size-dependence is
confirmed, and P0 must run both frame sizes, not only both depths.**

> **This retracts a standing claim: `product` no longer tracks `hybrid_lazyring` at 250 kB.**
> The sandbox had them within 2 % (623 against 611, a tie), which is why
> [`IMPLEMENTATION.md`](IMPLEMENTATION.md) says the shipped path *is* the arm. Here, 250 kB
> cold: **+34.5 % p50 (12/12) at depth 1 and +38.4 % (10/12) at depth 4, RESOLVED**, CPU
> agreeing (+37.7 %, +29.0 %). Meanwhile `hybrid_lazyring` against `pool` at 250 kB cold is a
> **tie at every depth** (+1.6 / +1.6 / −2.0 %). So the 250 kB penalty is the shipped
> `ReadCtx`'s, not the ring mechanism's — 783 µs against `hybrid_lazyring`'s 578 and `pool`'s
> 571 at depth 1. **The claim holds at 16 KiB and is retracted at 250 kB.**

`uring`'s hit penalty reproduces and scales with depth: **+59.9 / +345.6 / +1571.5 %** at
16 KiB and **+29.8 / +430.0 / +1985.0 %** at 250 kB, 12/12 throughout. Nothing here disturbs
the reason there is no tuning toggle.

### Where this host saturates, and which cells are past it

Cold throughput, median of 12, `hybrid_lazyring`:

| | depth 1 | depth 4 | depth 16 | d1→d4 | d4→d16 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 16 KiB | 4 952/s · 81 MB/s | 15 566/s · 255 MB/s | 35 266/s · 578 MB/s | ×3.14 | ×2.27 |
| 250 kB | 1 709/s · 427 MB/s | 5 612/s · 1 403 MB/s | 6 102/s · 1 525 MB/s | ×3.28 | **×1.09** |

**250 kB at depth 16 is past saturation** — ×1.09 for a 4× depth increase, with all five arms
inside **5.3 %** (6 046–6 366 asks/s). Every 250 kB depth-16 comparison here is a tie *by
construction*; the +3.7 % row above is that, not an equivalence, and no arm claim is made
there. **16 KiB at depth 16 is not saturated** — ×2.27 and still climbing, arms spread 10.9 %.

The ceiling seen here is ~1.5–1.6 GB/s against the ~840 MB/s this same machine reached on an
8 GB fixture at an 8 MiB stride. Those do not conflict — scattered gets 840 MB/s,
semi-sequential (512 MB at a 500 kB stride) gets 1.5 GB/s. **Caveat, and it cuts against the
larger number:** 512 MB can sit inside a consumer NVMe's own cache, which `mincore` residency
(99.6 % miss) cannot see. Treat 1.5–1.6 GB/s as an upper bound. Warm rows (4.0–5.0 GB/s at
16 KiB, 5.8–8.3 GB/s at 250 kB) are the page-cache ceiling, not a device measurement.

### The tables

#### The same arms on the workstation — 16 KiB, depth 4

| arm | warm p50 · p90 · p99 | warm CPU/ask | warm gap max | cold p50 · p90 · p99 | cold CPU/ask | cold gap max | cold miss | cold ÷ warm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`product`** | 3.9 · 4.9 · 7.2 µs | 4.5 µs | 302 µs | 249.9 · 331.2 · 395.0 µs | 116 µs | 141 µs | 99.6 % | 64× |
| `hybrid_lazyring` | 2.8 · 3.3 · 4.7 µs | 5.1 µs | 372 µs | 246.0 · 328.5 · 391.0 µs | 109 µs | 128 µs | 99.2 % | 89× |
| `pool` | 3.6 · 4.7 · 9.3 µs | 4.7 µs | 284 µs | 244.1 · 327.5 · 390.6 µs | 115 µs | 99 µs | 99.6 % | 67× |
| `uring` | 13.0 · 15.6 · 25.0 µs | 4.8 µs | 980 µs | 250.6 · 336.1 · 393.0 µs | 113 µs | 100 µs | 100.0 % | 19× |
| `pooled_pread` | 12.1 · 47.9 · 162.8 µs | 28.9 µs | 143 µs | 256.2 · 338.6 · 410.4 µs | 139 µs | 67 µs | 100.0 % | 21× |

#### The same arms on the workstation — 250 kB, depth 4

| arm | warm p50 · p90 · p99 | warm CPU/ask | warm gap max | cold p50 · p90 · p99 | cold CPU/ask | cold gap max | cold miss | cold ÷ warm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`product`** | 48.6 · 65.5 · 79.1 µs | 53.8 µs | 3424 µs | 958.8 · 1055.9 · 1184.0 µs | 411 µs | 289 µs | 99.6 % | 20× |
| `hybrid_lazyring` | 31.4 · 35.0 · 47.7 µs | 33.2 µs | 8257 µs | 690.5 · 789.7 · 882.3 µs | 319 µs | 492 µs | 99.6 % | 22× |
| `pool` | 50.3 · 62.7 · 74.1 µs | 52.2 µs | 3361 µs | 681.5 · 776.6 · 931.1 µs | 308 µs | 308 µs | 99.6 % | 14× |
| `uring` | 168.8 · 194.0 · 223.6 µs | 46.8 µs | 10673 µs | 696.0 · 803.7 · 1537.8 µs | 315 µs | 630 µs | 100.0 % | 4× |
| `pooled_pread` | 59.6 · 78.6 · 230.4 µs | 88.8 µs | 151 µs | 708.7 · 816.5 · 1028.6 µs | 434 µs | 108 µs | 100.0 % | 12× |

#### The copying harness on the workstation — 16 KiB, forward

| arm | warm p50 · p99 | warm CPU/ask | cold p50 · p99 | cold CPU/ask | cold gap max | copied/ask | cold ÷ warm |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `mmap_naive` | 1.5 · 4.2 µs | 4.9 µs | 2.3 · 14.8 µs | 26 µs | 2187 µs | 0 KiB | 1.6× |
| `mmap_hybrid_mincore` | 2.9 · 6.8 µs | 9.0 µs | 4.5 · 16.5 µs | 29 µs | 57 µs | 0 KiB | 1.6× |
| `mmap_touch_in_place` | 5.2 · 12.7 µs | 19.0 µs | 6.6 · 23.8 µs | 40 µs | 83 µs | 0 KiB | **1.3×** |
| `mmap_populate_read` | 11.2 · 20.7 µs | 26.3 µs | 14.1 · 43.4 µs | 46 µs | 59 µs | 0 KiB | **1.3×** |
| `mmap_blocking_touch` | 9.4 · 17.2 µs | 21.7 µs | 11.8 · 33.5 µs | 41 µs | 43 µs | 0 KiB | **1.3×** |
| `pread_blocking_pooled` | 12.7 · 22.5 µs | 30.4 µs | 14.4 · 53.6 µs | 47 µs | 96 µs | 16 KiB | **1.1×** |
| `pread_nowait_chunked` | 3.4 · 6.8 µs | 10.1 µs | 4.5 · 13.9 µs | 28 µs | 233 µs | 16 KiB | **1.3×** |
| `uring_nowait_whole` | 3.5 · 7.1 µs | 10.5 µs | 4.9 · 15.0 µs | 26 µs | 301 µs | 16 KiB | **1.4×** |

#### The copying harness on the workstation — 250 kB, random

| arm | warm p50 · p99 | warm CPU/ask | cold p50 · p99 | cold CPU/ask | cold gap max | copied/ask | cold ÷ warm |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `mmap_naive` | 26.7 · 44.9 µs | 71.9 µs | 48.7 · 4439.5 µs | 629 µs | 3683 µs | 0 KiB | 1.8× |
| `mmap_hybrid_mincore` | 28.8 · 47.6 µs | 77.8 µs | 53.1 · 4582.1 µs | 648 µs | 542 µs | 0 KiB | 1.8× |
| `mmap_touch_in_place` | 28.8 · 50.3 µs | 81.6 µs | 67.2 · 4608.5 µs | 665 µs | 137 µs | 0 KiB | 2.3× |
| `mmap_populate_read` | 52.2 · 93.2 µs | 119.2 µs | 77.5 · 4573.9 µs | 673 µs | 153 µs | 0 KiB | **1.5×** |
| `mmap_blocking_touch` | 43.8 · 81.3 µs | 97.7 µs | 70.2 · 4583.4 µs | 649 µs | 139 µs | 0 KiB | 1.6× |
| `pread_blocking_pooled` | 64.1 · 103.0 µs | 155.6 µs | 654.7 · 1575.3 µs | 1000 µs | 128 µs | 244 KiB | 10.2× |
| `pread_nowait_chunked` | 42.8 · 69.4 µs | 117.6 µs | 68.3 · 2253.3 µs | 830 µs | 1001 µs | 244 KiB | 1.6× |
| `uring_nowait_whole` | 43.5 · 71.2 µs | 124.0 µs | 646.8 · 1579.2 µs | 897 µs | 926 µs | 244 KiB | 14.9× |
> **`disk-access-bench` has no miss control, and on this host its cold cells are weak.** The
> `cold ÷ warm` column is the substitute. On the **forward** trace at 16 KiB *every* arm sits
> at **1.1–1.6×** — a contiguous walk against a 4096 KB read-ahead window is barely cold at
> all, the same trap the stride calibration exists to avoid. Only **250 kB random** separates
> them, and there the asymmetry the sandbox warned about is wider, not narrower:
> **`uring_nowait_whole` 14.9× and `pread_blocking_pooled` 10.2× against `mmap_naive`'s 1.8×
> and `mmap_hybrid_mincore`'s 1.8×**. In that cell mmap looks 13× quicker (48.7 µs against
> 646.8) while being 6–8× less cold. **It is not doing the same I/O faster, it is doing less
> of it.**
>
> The co-tenant freeze reproduces, and it is the column mmap is still rejected on:
> `mmap_naive` holds a worker for **2 187 µs** at 16 KiB forward, **3 699 µs** at 16 KiB random
> and **3 683 µs** at 250 kB random, against `pread_nowait_chunked`'s 233 / 791 / 1 001 µs.
> That is [`adr.md`](adr.md)'s *"faults freeze co-tenants: 1.5–4.2 ms"*, on a third host.


## Where the margin comes from

`pool` and `hybrid` differ in two things at once — the reader loop and the miss mechanism —
so `pool_ringloop` was added to hold each fixed and split them.

| | hit | mix | miss |
| --- | --- | --- | --- |
| **loop** (`pool_ringloop` − `pool`) | 4 vCPU tie; 8 CPU **−26 to −34%**, straddling the threshold | 8 CPU **−48 to −53% RESOLVED** | tie (±2%) |
| **ring** (`hybrid` − `pool_ringloop`) | tie (+4.6 to +17.5%, the idle ring) | **−56 to −57% RESOLVED** | **−42 to −73% RESOLVED** |

**The ring is RESOLVED on misses on every host and every run.** The loop is a second, smaller,
core-dependent term — nothing on 4 vCPU, real on 8 — which `hybrid` already collects because it
uses the same loop. The idle ring is what `hybrid_lazyring` removes.

## What serving depth is worth — and what depth 2 buys

The server serves one frame at a time ([`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md)
§6b). Earlier sweeps priced depth 1 against 4 and 16 and never measured **2**, which is the
only depth the shape being proposed there can reach. Measured 2026-09-08,
`v35_depth2.tsv` at the evidence tag, 12
interleaved repeats, `hybrid_lazyring`, cold 16 KiB, paired by repeat against depth 1:

| depth | asks/s | vs depth 1 | signs | 16 missing tiles | CPU/ask |
| ---: | ---: | ---: | :---: | ---: | ---: |
| 1 | 12 041 | — | — | 1.33 ms | 53.3 µs |
| **2** | **20 397** | **+67.4% RESOLVED** | 12/12 | **0.78 ms** | 41.8 µs |
| 4 | 28 000 | +125.8% RESOLVED | 12/12 | 0.57 ms | 31.8 µs |
| 16 | 35 767 | +184.4% RESOLVED | 12/12 | 0.45 ms | 23.0 µs |

**Depth 2 collects 62% of everything depth 16 has to offer** (0.55 ms of the 0.88 ms between
depth 1 and 16), for two buffers and two ring slots rather than a slot table. It also costs
*less* CPU per ask, not more, and warm cells are a tie at every depth (+2.7%, 7/12) — a
session whose reads hit pays nothing for a depth it never uses.

That is the measurement `adr-frame-framing-and-loop-shape.md` §6b asked for before building
the double buffer, and it supports building it. It does not support going past two: the
step from 2 to 4 is worth a further 0.21 ms and the step from 4 to 16 another 0.12 ms, both
against a much harder invariant.

**Built, and measured as the product.** `product` against `product_ahead` — the shipped
`ReadCtx` driven with and without the look-ahead, one session, depth 1, 12 repeats
(`v36_readahead.tsv` at the evidence tag):

| cell | asks/s | signs | p50 | CPU/ask |
| --- | ---: | :---: | ---: | ---: |
| cold 16 KiB (99.6% miss) | **+73.8% RESOLVED** | 12/12 | −53.4% | −18.9% (tie) |
| warm 16 KiB | −3.8% tie | 5/12 | +5.6% | +1.1% tie |
| 250 KB, 4.7% miss | +7.2% tie | 9/12 | +3.5% | +1.3% |

The product collects slightly more than the arm's +67.4%, and the warm tie is the load-bearing
row: read-ahead costs a hit-only session nothing. The 250 KB cell never went miss-dominated —
`--stride 250000` against an 8 MiB read-ahead window is a hit cell in disguise — so it shows
no regression rather than no win.

## Hosts

The whole campaign originally came from one machine, which was its largest risk.

| Host | Hop tax (`spawn_blocking` round trip) | vs lab |
| --- | ---: | ---: |
| lab KVM — Intel Xeon, ext4, read-ahead 8 MiB | 34 385 ns | — |
| GitHub runner — AMD EPYC, ext4, read-ahead 128 KiB | 23 648 ns | 0.69× |
| Bare-metal laptop — Intel i5, btrfs-on-LUKS | 24 470 ns | 0.71× |
| Agent sandbox — same class as lab | 26 275 ns | 0.76× |

Two CPU vendors, VM and bare metal, three filesystems: **24–34 µs everywhere**, and no
miss-regime row flipped on any host.

> The "bare-metal laptop" row and the 2026-09-09 workstation section are the **same machine**
> — an 8-thread i5-8250U on btrfs-on-LUKS/NVMe. It is the campaign's only bare-metal host; a
> claim needing a second one is still unmet.

## Risks, as closed

| | Verdict |
| --- | --- |
| **R1** single host | **Closed** — three further hosts, table above |
| **R3** synthetic fixture | **Closed** — real ask schedules, 4 GB fixture (layout study at the evidence tag) |
| **R4** force-evicted not pressure-evicted | **Closed** — cgroup cap, verified by `failcnt` |
| **R5** ring count at scale | **Closed** — 128 concurrent rings under 53–79% miss spawn **no** io-wq workers; `pool` reaches 265 OS threads at 64 readers |
| **R6** filesystem support | **Closed operationally** — `check-fastpath` per host; ext4 and btrfs honour `RWF_NOWAIT`, overlayfs and tmpfs refuse it |
| **R8** loop vs ring attribution | **Closed** — split above |
| **R2** cold is guest-cold | Open, direction known and **favourable** — it understates the ring. Not worth closing |
| **R7** one read per ask | Open, affects all arms equally. Not worth closing |

## What this campaign did not vary: how much a miss reads

Every arm above reads a **whole frame per round trip** — `read_campaign` calls
`read_at_nowait(&mut buf[..len])` for the frame's full length. The shipped
`stream_codestream` did not: until 2026-09-07 it windowed the *pool* read too, and paid 2–3
round trips per 250 KB frame instead of one. So `pool` above is a fair pool-vs-ring control
and was never the shipped loop.

A separate miss-size run, at 250 KB frames on an 8 GB fixture, changed the product. Two
numbers from it belong here:

| | |
| --- | --- |
| Escalating the pool read to the rest of the frame | **2.1×** throughput at one reader, **3.0–3.2×** at 8/16/32, on 100% misses. Identical warm. Landed |
| Whole-frame `io_uring` vs whole-frame `spawn_blocking`, 250 KB frames | **A tie** on throughput and latency at 1/2/4/8/16/32 readers, both arm orders |

The tie does not contradict the −42/−73% above, and **this campaign's own `D_size` cells
show why**: the ring's margin over the pool decays monotonically with frame size, and stops
clearing the bar at exactly the size the miss campaign used.

| `hybrid` vs `pool`, miss regime | 4 KiB | 16 KiB | 64 KiB | 250 KB |
| --- | ---: | ---: | ---: | ---: |
| `v22` (evidence tag) | −62.2% | −58.2% | −45.9% | **−24.8% tie** |
| `v10` (evidence tag) | −63.9% | −66.8% | −45.3% | — |

A round trip costs roughly what it costs; the rest of a read scales with its bytes, so the
share the ring can remove shrinks as frames grow. **At 250 KB the whole ring benefit is
already a tie** — which is the same conclusion the miss campaign reached on throughput, from
the other direction. Reproduce with
`git show read-path-evidence-2026-09-09:docs/disk-access/v22_campaign_ci.tsv`.

The thread-count finding agrees across both: 5 OS threads against 44 at 32 concurrent
missing readers, with no `iou-wrk` worker visible under tight-loop `/proc` sampling (R5
here). On ~1.25 GB/s storage it converts into nothing — capping Tokio's blocking pool at
**four** threads costs the pool arms nothing at 32 readers, because the device saturates
first.

## Rejected, with the reason

| Option | Why not |
| --- | --- |
| `uring` everywhere | +131 to +142% on cache hits, RESOLVED |
| mmap + pre-fault + zero-copy handoff | Hands quinn page-cache pages: reclaim can take them mid-send, and the refault lands inside quinn on the executor. Also one pool hop per ask |
| Handing quinn owned buffers (`BytesMut`) | Measured **−3.2%, 9 of 12 same sign** — below drift, not landed. The copy is real and provable in quinn's source; it is not worth removing |
| A read-path config toggle | `hybrid_lazyring` already chooses per session at runtime; a static flag can only be wrong |
| `SQPOLL` | 2.8× the CPU and +30 to +86% warm latency: `COOP_TASKRUN` is refused alongside it, so all 320 completions park instead of none, and a kernel poller thread spins **per session ring**. Structural; a re-run does not reopen it |
| mmap, any variant | Faster on p50 and cheaper on CPU — and its **p99 is 3 276–3 914 µs at 250 kB cold against 1 036**, with a co-tenant `gap max` of 3 991 µs. The variants that make the fault safe (`populate_read`, `blocking_touch`) are 2–3× slower at 1.5–2× the CPU. Re-measured 2026-09-09 |
| mmap + `mincore` gate | Residency is not a lease: a page `mincore` calls resident can be evicted before the touch. Unsafe under pressure 5/5 runs — structural, and the 2026-09-09 run does not test it |
| `sendfile` / splice | Userspace QUIC copies regardless |

## What is worth more than any of this

The read path is worth 2–4×. **The disk layout is worth 17.6×** on the same reads, and it is
undecided — study at the evidence tag, `docs/disk-layout/`.

## Not established anywhere, by any campaign here

Named so they are not mistaken for measured, and so a future run knows where to point.

- **Storage faster than ~1.25 GB/s.** Every miss-regime conclusion here is device-bound. On
  NVMe at several GB/s, thread scheduling could become the limit instead, and io_uring's
  5 threads against 381 would start converting into something. *Partly probed 2026-09-09*: the
  workstation reached **1.5–1.6 GB/s** on a semi-sequential 250 kB walk and the arms collapsed
  to a 5.3 % spread there — device-bound, not scheduler-bound, so nothing converted. That
  figure may be flattered by the NVMe's own cache on a 512 MB fixture; the row stays open.
- ~~**Frames past 250 KB.**~~ **250 kB measured 2026-09-09** and it went the way this row
  predicted: at 250 kB cold the `pool` beats the ring at both depths — sandbox 514 µs against
  623, workstation **+38.5 / +42.3 % RESOLVED** — where at 16 KiB the ring was ahead from
  depth 4. Still open **past** 250 kB — native DBT is 3 MB, and windowing gets worse from
  here.
- **`hybrid_lazyring` above one reader** — [`NEXT.md`](NEXT.md) P0.
- **`hybrid_lazyring` on the 4 vCPU sandbox or the GitHub runner.**
- ~~**Serving depth on any host but the sandbox above.**~~ **Closed 2026-09-09 on the
  workstation**: the shipped server's cold depth-4 win against `580e312` is **−42.1 %, 16/16,
  RESOLVED** there, where the sandbox reached −19.1 % and could not clear the bar, and the
  HEAD depth ladder reads 2 831 → 4 813 → 7 710 asks/s. Ranking *and* magnitude now hold on a
  second host. Still one bare-metal host, and untested on the production instance type.

## Against the double-buffer server (`580e312`) · 2026-09-09

The base already peeks one ask and holds two windows. Fill and client depth 2 are the same
shape on both arms — they must tie. Depth 4 is the claim.

**Bytes.** A 512-frame fixture whose frames differ in content and length (37 B to 128 KiB).
Digest over `(index, length, body)` in delivery order, computed from the `.sbnd` and from
the wire. Match on both binaries, fill and on-demand, warm and cold, with the ring carrying
part of the traffic.

**`read_path_ab.sh`:** every cell ties, exit 0. The window table costs the isolated read
path nothing against the `Ahead` flip it replaced.

**`server_ab.sh`**, 16 interleaved rounds, 256 asks, cold miss 0.984–1.000:

| cell | p50 Δ | signs | CPU/ask Δ | signs | asks/s Δ |
| --- | ---: | :---: | ---: | :---: | ---: |
| cold d1 | +0.6 % | 8/16 | +2.6 % | 10/16 | −0.5 % |
| cold d2 | +2.3 % | 10/16 | +0.0 % | 8/16 | −2.2 % |
| **cold d4** | **−19.1 %** | **15/16** | **−28.0 %** | **16/16** | **+20.7 %** |
| warm d1 | −1.3 % | 9/16 | +0.4 % | 9/16 | +2.4 % |
| warm d4 | −9.6 % | 14/16 | −8.9 % | 14/16 | +10.2 % |
| fill | +1.6 % | 9/16 | +0.7 % | 8/16 | −0.2 % |

Sandbox, ~7 k asks/s against a workstation's ~50 k. Directions and sign counts, not
magnitudes. The script's 28.5 % wait bar does not clear on p50 here; CPU/ask does. After P1
the session line reports `named=1/2/4` at those depths and `named=2` on a fill.

Per-session RSS, fresh server per cell: **+39 to +49 KiB**, not the +32 the design guessed.
TSVs at the evidence tag (`server_ab.tsv`, `read_path_ab.tsv`).

### The workstation re-run this section asked for · 2026-09-09

Same script, same 16 interleaved rounds, on the 8-thread i5-8250U (btrfs-on-LUKS/NVMe,
`read_ahead_kb` 4096 on the btrfs bdi). Cold miss 1.000 on all 96 on-demand cells.

| cell | p50 Δ | signs | verdict | sandbox p50 |
| --- | ---: | :---: | --- | ---: |
| cold d1 | +2.8 % | 10/16 | tie | +0.6 % tie |
| cold d2 | −0.2 % | 8/16 | tie | +2.3 % tie |
| **cold d4** | **−42.1 %** | **16/16** | **RESOLVED** | −19.1 %, did not clear |
| warm d1 | +0.5 % | 10/16 | tie | −1.3 % tie |
| warm d4 | −5.3 % | 11/16 | tie | −9.6 % tie |
| fill | +9.2 % | 11/16 | tie | +1.6 % tie |

**The claim clears here.** 816.6 → 470.6 µs, 16 of 16 rounds the same sign, against a
sandbox that reached −19.1 % (15/16) and could not clear the 28.5 % bar on p50. The shape
is unchanged — depth 1, depth 2, warm and fill all tie on both hosts — so the win is depth 4
and nothing else. `named` = 4 on `after`, absent on `580e312`. HEAD depth ladder:
2 831 → 4 813 (+70.0 %) → 7 710 asks/s (+60.2 %). Per-session RSS **+46.8 KiB** over 64
sessions, inside the sandbox's +39 to +49.

`read_path_ab.sh` ties every cell there too (cold d1 −0.7 %, cold dW −0.3 %, warm +0.9 %,
`seq1g` +0.8 %), so the read path is neutral and the depth-4 win belongs to the serving
shape. **Caveat on `seq1g`:** 256 asks × 16 KiB contiguous spans 4 MB against a 4096 KB
read-ahead window, so it reads 0.0–0.8 % misses at 2.6–2.8 µs — roughly 4× this host's own
cold ceiling. The tie is real for the read-ahead-served path; it is not 1 GiB of I/O.

TSVs at the workstation tag (`w1_server_ab.tsv`, `w1_read_path_ab.tsv`, `w1_host.txt`).
