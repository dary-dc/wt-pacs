# Read-path scoreboard · four candidates, five metrics, three regimes · 2026-09-06

Companion to [`READ-PATH-DECISION.md`](READ-PATH-DECISION.md). That document argues the
decision; this one is the measurement table it rests on, plus an explicit grading of **how
well each claim is actually evidenced**.

Regenerate every number here with:

```bash
python3 lab/scripts/analyze_read_campaign.py docs/disk-access/v10_campaign.tsv
```

§Scoreboard below is `section_scoreboard`; nothing in this document is hand-computed.

---

## 1. Candidates

| Arm | Implementation | Where a page-cache **hit** is served | Where a **miss** is served | Concurrency held by |
| --- | --- | --- | --- | --- |
| `pool` | **Ships today.** `preadv2(RWF_NOWAIT)` on the executor; `spawn_blocking` for the shortfall | Inline syscall on the worker | Blocking-pool thread | **One OS thread per concurrent miss** |
| `uring` | One `io_uring` per reader, registered file + registered buffers, `ReadFixed`, completions awaited on a registered eventfd via `AsyncFd` | Ring submit + complete (it cannot tell) | Ring submit + complete | Ring slots (SQ entries) |
| `hybrid` | `RWF_NOWAIT` inline first; the ring carries only the shortfall | Inline syscall, ring never sees it | Ring submit + complete | Ring slots for misses; nothing for hits |
| `pooled_pread` | ADR escape hatch: every read on the blocking pool, no fast path attempted | Blocking-pool thread | Blocking-pool thread | **One OS thread per read** |

Ring configuration is fixed across all cells: `COOP_TASKRUN`, no `SINGLE_ISSUER` and no
`DEFER_TASKRUN` (Tokio's work-stealing runtime migrates tasks across `.await`, so a
per-session ring would see submissions from multiple threads), `SQPOLL` measured separately
and not used here.

## 2. Metrics, and what each one is for

| Metric | Definition | Why it is in the table | Known limitation |
| --- | --- | --- | --- |
| `cpu_ns` | `CLOCK_PROCESS_CPUTIME_ID` delta over the cell ÷ asks recorded | **The budget metric.** Cost per user at scale is CPU, not wall time | Whole-process; monitors disabled (`--monitors 0`) on every cost cell because the co-tenant monitor is a spin loop whose CPU scales with wall time |
| `dCPU` / `cheaper` | Median % vs `pool`, paired by (cell, run, repeat), with sign agreement | Paired comparison survives host drift; the sign count is the reproducibility check | Requires `abs(median) > 28.5%` **and** agreement `>= 0.8n` to count as a result (`DRIFT_PCT`, set to this host's measured p90 run-to-run drift) |
| `tput` | `asks_per_s` ratio vs `pool` | Catches an arm that buys CPU by doing less at once — which is exactly what happened (§4.2) | Per-cell wall time includes cell setup |
| `dp50` | Median % change in per-ask p50 latency | What a single reader feels | ⚠️ **Only comparable in the `miss` regime.** On the hit path `pool`/`hybrid` start the clock inside the worker after dequeue, while the ring timestamps at slot fill and charges the batch drain — so warm `dp50` overstates the ring by roughly Little's-law factor 6× |
| `thr med/max` | Process OS-thread high-water mark during the cell | **The scaling ceiling.** Tokio's blocking pool caps at 512 threads; a concurrent miss consumes one | Measured on one process; not validated at production session counts |

**Regime** is bucketed by **`pool`'s** miss rate for the same cell, never the row's own —
`uring` reports 100% by construction (every read goes through the ring whether or not the
page was resident) and `pooled_pread` never attempts the fast path. Bucketing on `pool`'s
counter makes the x-axis a property of the *workload* rather than of the arm.

## 3. Scoreboard

`cpu_ns` is the arm's own median. Everything else is versus `pool`. `tput > 1.00x` = more
asks per second than `pool`. Bold marks the winner of each block.

### 3.1 `hit` regime — under 5% of reads miss the page cache

| In flight | Arm | cpu_ns | dCPU | cheaper | tput | dp50 ⚠️ | thr med/max | n |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `pool` | 6 598 | base | — | — | — | 5 / 6 | 126 |
| 1 | **`hybrid`** | **5 585** | −5% | 80/126 | **1.00×** | −3% | **5 / 5** | 126 |
| 1 | `uring` | 16 802 | **+160%** | 8/126 | **0.53×** | +110% | 5 / 5 | 126 |
| 1 | `pooled_pread` | 63 464 | **+1384%** | 0/54 | **0.07×** | +1615% | 6 / 8 | 54 |
| 4 | `pool` | 4 034 | base | — | — | — | 5 / 10 | 104 |
| 4 | `hybrid` | **3 260** | −23% | 91/104 | 0.57× | −16% | **5 / 5** | 104 |
| 4 | `uring` | 9 344 | +114% | 19/104 | 0.21× | +575% | 5 / 5 | 104 |
| 4 | `pooled_pread` | 39 739 | +821% | 0/99 | 0.10× | +1196% | 12 / 23 | 99 |
| 16 | `pool` | 3 977 | base | — | — | — | 5 / 41 | 120 |
| 16 | `hybrid` | **3 391** | −11% | 80/120 | 0.41× | −9% | **5 / 5** | 120 |
| 16 | `uring` | 5 168 | +36% | 20/120 | 0.28× | +1721% | 5 / 5 | 120 |
| 16 | `pooled_pread` | 34 543 | +819% | 0/72 | 0.10× | +1842% | 43 / 99 | 72 |
| 64 | `pool` | **4 347** | base | — | — | — | 5 / **96** | 86 |
| 64 | `hybrid` | 4 548 | −4% | 47/86 | 0.36× | −17% | **5 / 5** | 86 |
| 64 | `uring` | 5 354 | +20% | 20/86 | 0.29× | +4277% | 5 / 5 | 86 |
| 64 | `pooled_pread` | 38 264 | +804% | 1/74 | 0.10× | +9974% | 55 / 91 | 74 |

**Reading:** `pool` and `hybrid` are within drift on CPU at every in-flight level (sign
agreement 47/86 to 91/104 — below the 0.8 rule everywhere except in-flight 4, so *tie*).
`uring` is decisively worse and `pooled_pread` catastrophically so. The `hybrid` `tput`
column is **not** an arm property — see §4.2.

### 3.2 `mix` regime — 5% to 50% of reads miss

| In flight | Arm | cpu_ns | dCPU | cheaper | tput | dp50 ⚠️ | thr med/max | n |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `pool` | 46 404 | base | — | — | — | 6 / 6 | 12 |
| 1 | **`hybrid`** | **26 533** | **−45%** | **12/12** | 1.21× | −3% | **5 / 5** | 12 |
| 1 | `uring` | 28 773 | −41% | 12/12 | 1.20× | +1% | 5 / 5 | 12 |
| 4 | `pool` | 13 151 | base | — | — | — | 10 / 16 | 52 |
| 4 | **`hybrid`** | **7 844** | **−48%** | **51/52** | 1.12× | −15% | **5 / 5** | 52 |
| 4 | `uring` | 9 667 | −43% | 51/52 | 1.25× | +193% | 5 / 5 | 52 |
| 4 | `pooled_pread` | 38 375 | +220% | 0/9 | 0.89× | +621% | 17 / 20 | 9 |
| 16 | `pool` | 19 496 | base | — | — | — | 26 / 45 | 94 |
| 16 | **`hybrid`** | **8 245** | **−61%** | **90/94** | 1.08× | −16% | **5 / 5** | 94 |
| 16 | `uring` | 8 730 | −61% | 88/94 | 1.08× | +1141% | 5 / 5 | 94 |
| 16 | `pooled_pread` | 42 604 | +133% | 0/36 | 0.90× | +1180% | 48 / 96 | 36 |
| 64 | `pool` | 29 382 | base | — | — | — | 53 / 77 | 40 |
| 64 | **`hybrid`** | **8 569** | **−72%** | **40/40** | 1.07× | −16% | **5 / 5** | 40 |
| 64 | `uring` | 9 004 | −71% | 40/40 | 1.07× | +4124% | 5 / 5 | 40 |
| 64 | `pooled_pread` | 46 006 | +55% | 2/34 | 0.84× | +7700% | 66 / 93 | 34 |

### 3.3 `miss` regime — 50% or more of reads miss · **our deployment**

| In flight | Arm | cpu_ns | dCPU | cheaper | tput | dp50 | thr med/max | n |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `pool` | 87 988 | base | — | — | — | 6 / 7 | 84 |
| 1 | **`hybrid`** | **39 676** | **−54%** | **83/84** | **1.34×** | **−27%** | **5 / 5** | 84 |
| 1 | `uring` | 39 687 | −54% | 82/84 | 1.30× | −26% | 5 / 5 | 84 |
| 1 | `pooled_pread` | 94 446 | +5% | 5/30 | 0.84× | +17% | 6 / 7 | 30 |
| 4 | `pool` | 77 765 | base | — | — | — | 12 / 15 | 90 |
| 4 | **`hybrid`** | 23 548 | −69% | **90/90** | **1.21×** | **−39%** | **5 / 5** | 90 |
| 4 | `uring` | **20 492** | **−73%** | 90/90 | 1.10× | −12% | 5 / 5 | 90 |
| 4 | `pooled_pread` | 80 100 | +3% | 14/48 | 0.89× | +12% | 12 / 18 | 48 |
| 16 | `pool` | 61 832 | base | — | — | — | 28 / 41 | 110 |
| 16 | **`hybrid`** | 17 384 | −71% | **110/110** | **1.02×** | **−22%** | **5 / 5** | 110 |
| 16 | `uring` | **15 709** | **−75%** | 109/110 | 0.95× | +16% | 5 / 5 | 110 |
| 16 | `pooled_pread` | 64 532 | +2% | 20/48 | 0.96× | +4% | 34 / 61 | 48 |
| 64 | `pool` | 65 178 | base | — | — | — | 70 / **88** | 42 |
| 64 | **`hybrid`** | 15 210 | −77% | **42/42** | **1.03×** | **−17%** | **5 / 5** | 42 |
| 64 | `uring` | **14 080** | **−78%** | 42/42 | 0.96× | +13% | 5 / 5 | 42 |
| 64 | `pooled_pread` | 65 152 | +0% | 18/36 | 0.95× | +3% | 80 / **118** | 36 |

**Reading:** `uring` is 2–4% cheaper than `hybrid` on CPU above 4 in flight; `hybrid` is
1.02–1.34× on throughput and −17% to −39% on p50 where `uring` is 0.95–1.10× and *positive*.
The two are interchangeable on cost here; `hybrid` wins the tiebreak on latency and
throughput, and does not carry `uring`'s §3.1 penalty. **`pooled_pread` is within noise of
`pool` in this regime** — the fast-path syscall is nearly free when it nearly always fails,
which is the control that shows the win is the *ring*, not the removal of a wasted syscall.

## 4. Two structural effects the aggregate hides

### 4.1 Thread count is not a metric, it is a ceiling

`thr` is the only column with a hard limit behind it. Tokio's blocking pool defaults to 512
threads; a concurrent miss occupies one for the duration of the device I/O. On the `miss`
row at 64 in flight, `pool` holds 88 and `pooled_pread` 118 — both ring arms hold **5, in
every cell of the campaign**. On slower storage the pool arms' counts climb *faster*, not
slower, because each thread is parked longer.

This is a structural property of where the wait lives, not a measured effect size, and it is
the one finding that does not depend on this host's timing constants at all.

### 4.2 "Reads in flight" is not the same object across arms

At depth *D*, `pool` runs *D* concurrent tasks and serves a hit as a synchronous `preadv2`,
so it gets *D*-way CPU parallelism. The ring arms run **one task per reader** with *D* ring
slots, and the `hybrid` serves hits inline on that single task — one at a time. On a
hit-dominated workload that is a throughput handicap the CPU column does not show, and it is
the whole of the 0.36–0.57× in §3.1.

Holding the *same* reads in flight as independent readers instead of depth removes it
([`v14_warm_concurrency.tsv`](v14_warm_concurrency.tsv), warm, 512 asks/reader, 6 repeats):

| Reads in flight | Held as | `hybrid` tput | `uring` tput |
| ---: | --- | ---: | ---: |
| 4 | depth 4, one reader | 0.45× | 0.21× |
| 4 | **4 readers, depth 1** | **1.40×** | 0.64× |
| 16 | depth 16, one reader | 0.31× | 0.26× |
| 16 | **16 readers, depth 1** | **0.95×** | 0.66× |

Our concurrency is one reader per user. In that arrangement the handicap is absent. `uring`
is bad on hits in **both** arrangements, which is the part that generalises.

---

## 5. Is this supported by evidence? — claim-by-claim grading

Grades: **A** = reproduced across independent runs *and* the mechanism confirmed by a
targeted experiment. **B** = reproduced, mechanism inferred. **C** = single run or single
configuration. **D** = stated but not supported by this campaign.

| # | Claim | Grade | What actually supports it | What would break it |
| ---: | --- | :---: | --- | --- |
| 1 | Above ~5% misses the ring arms cost 45–77% less CPU than `pool` | **A** | 3 independent runs; sign agreement 12/12, 51/52, 90/94, 110/110, 40/40, 42/42; effect 3–10× the 28.5% drift threshold; `pooled_pread` acts as a control ruling out "it's just the wasted syscall" | A host where `spawn_blocking` is cheap — see risk R1 |
| 2 | Below ~5% misses `pool` and `hybrid` are indistinguishable on CPU | **A** | Sign agreement 47/86 … 91/104, i.e. at or near a coin flip; effect within drift at 3 of 4 in-flight levels | — |
| 3 | Pure `uring` is materially worse on cache hits | **A** | +20% to +160% CPU across in-flight levels, 8/126 … 20/120; **and** the placement A/B ([`v13_placement_ab.tsv`](v13_placement_ab.tsv)) shows it survives when the confound that could have caused it is removed | — |
| 4 | Ring arms hold 5 OS threads where `pool` holds up to 96 | **A** | Structural, not statistical: observed in every cell; follows from where the wait lives | Enough concurrent rings to force `io-wq` punting — **untested**, see risk R5 |
| 5 | The ring wins at **one** read in flight too | **A** | Was contested by two harnesses. Settled by controlled A/B on placement: flipping one variable moves the ring arms 2.05×/1.96× and `pool` within noise; hybrid-vs-pool goes +1.4% (2/6) → −52.8% (6/6) vs the campaign's −53.4% | — |
| 6 | `hybrid` is never materially worse than the better of the other two | **B** | 960 paired cells: worse by >28.5% in 29 (3.0%), better in 563 (58.6%), median −43.4%. 27 of the 29 bad cells sit in the regions already labelled tie | The 2 unexplained exceptions are single repeats and were not re-run |
| 7 | The decision surface is *miss rate × reads in flight*, multiplicatively | **B** | Both factors move the effect monotonically and independently across 3 runs; `crossover_bench` controls miss rate directly and reproduces the ordering | Bucket boundaries (5%, 50%) are chosen, not fitted. The crossover is *somewhere* in 5–20%; it is not located precisely |
| 8 | `POSIX_FADV_WILLNEED` is a **substitute** for the ring, not a complement | **B** | −29% to −48% for `pool` on strided cold (6/6 each), and the same hint gives `hybrid` a tie at depth ≥ 4 | Single access shape; not tested against a real ask sequence |
| 9 | Ask size does not change the ranking, only the miss rate it produces | **B** | The 250 KB row leaves the ranking only because a 250 KB ask at a 250 KB stride *is* a sequential sweep (miss 88% → 11%) | Corrected once already after review (F7). Real frames are variable-size; not measured |
| 10 | The `hybrid` costs no throughput on hits **in our shape** | **B** | Direct experiment, 4 and 16 in flight, both arrangements | 6 repeats, one host, warm only |
| 11 | Latency comparison on the **hit** path | **D** | **Withdrawn.** The arms start their clocks at different points; Little's law shows `pool` reporting 0.13× its own implied residence time warm against the ring's 0.80× | Fix the instrument, or use throughput (which is what §3.1 does) |
| 12 | The cheaper arm is gentler on co-tenants (executor safety) | **D** | **Unmeasured.** The metric scores `pooled_pread` — 118 threads — as *gentler* than `pool`, which cannot be true. No evidence of harm, no evidence of benefit | Needs one monitor per worker, gaps normalised by sample count, and a real co-tenant workload rather than a spin loop |

### 5.1 Threats to validity, ranked by how much they could move the answer

| Risk | What it is | Why it matters | Status |
| :---: | --- | --- | --- |
| **R1** | **Single host.** 4-vCPU KVM guest, virtio-blk, ext4, near-idle. One `spawn_blocking` round trip costs a median **34 µs** of process CPU here | **This constant is what generates the ring's win.** If the hop is cheap on the production instance, claims 1 and 5 shrink or vanish | **Closed — the constant transfers.** Three further hosts, measured with `compare_hosts.py`: GitHub runner (AMD EPYC, ext4, [`v22_campaign_ci.tsv`](v22_campaign_ci.tsv)) **23 648 ns / 0.69×**; bare-metal laptop (Intel i5-8250U, btrfs-on-LUKS, [`v23_campaign_laptop-btrfs.tsv`](v23_campaign_laptop-btrfs.tsv)) **24 470 ns / 0.71×**; agent sandbox ([`v21_campaign_sandbox.tsv`](v21_campaign_sandbox.tsv), same class as the lab) 26 275 ns / 0.76×. Two CPU vendors, VM and bare metal, three filesystems: the hop is **24–34 µs everywhere**. No `miss`-regime row flipped on any host. What remains is not R1 but **R8** — how much of the margin is the ring at all |
| **R2** | **Cold is guest-cold, not device-cold.** The hypervisor caches the backing file, so absolute miss latencies are optimistic | Compresses the gap between hit and miss, which *understates* the ring | Open; direction is known and favourable |
| **R2b** | **This host's read-ahead window is 8 MiB, 64× Linux's 128 KiB default.** Found by a shuffle control, not by inspection ([`ACCESS-PATTERNS.md`](ACCESS-PATTERNS.md) §3) | It suppresses the miss rate of every sequential pattern, so the campaign's `sweep` cells are flattered. Direction favours `pool`: at the default window the hybrid wins **all eight** trace cases instead of five | **Quantified**, not removed. Record `read_ahead_kb` beside any future run |
| **R3** | **Synthetic fixture.** 84 MB, uniform 16 KB records, constant bytes, fixed stride. Real studies are tens of GB of variable-size HTJ2K codestreams | Miss rate is the x-axis of the whole decision, and every miss rate here comes from a synthetic stride | **Closed** by [`ACCESS-PATTERNS.md`](ACCESS-PATTERNS.md): real ask schedules through candidate layouts, 4 GB fixture with realistic geometry. Ranking unchanged; the premise *why* we are miss-dominated was wrong — it is the layout, not the study size |
| **R4** | **Force-evicted, not pressure-evicted.** Cells `fadvise(DONTNEED)` the file; they never run with a working set larger than RAM | A study larger than RAM misses because of *eviction*, a regime never measured. Steady-state hit rate under pressure is unknown | **Closed** by [`ACCESS-PATTERNS.md`](ACCESS-PATTERNS.md) §4 (cgroup cap, verified by `memory.failcnt`). Strided access cliffs to 99% miss at ~1× oversubscription; sequential access holds at 0.5–43% at 2.5×. The hybrid's margin *grows* under pressure |
| **R5** | **Ring count at scale.** One ring per reader, max 16 readers | Enough concurrent rings would force `io-wq` punting and could reintroduce threads — the exact property claim 4 rests on | **Answered — it does not happen, and the risk is on the other arm.** Readers pushed to 1/16/64/128 with misses held at **53–79%** by a 64 MiB cap against an 84 MB study (failcnt 2.86M / 2.75M), two runs ([`v25_r5_ring_scale.tsv`](v25_r5_ring_scale.tsv), [verdict](v25_r5_ring_scale_verdict.txt)). `hybrid` and `uring` hold **5 threads at every reader count in both runs** — no io-wq worker ever appeared at 128 concurrent rings. `pool` is the arm that grows threads: **11 → 80 → 265 → 227**. Thread count is structural, not a percentage, so it needs no drift rule; CPU/ask under this much pressure is noisy (up to 24% between runs) and is deliberately **not** quoted. Caveat: one host, 4 vCPU — `io-wq` spawns per-core, so a host with many more cores is where punting would show first |
| **R6** | **ext4 only.** Where `RWF_NOWAIT` is refused (overlayfs, some network filesystems), `pool` and `hybrid` both degrade to `pooled_pread` | Changes which arm is even available, not which is better | Known; `pooled_pread` is the documented fallback |
| **R7** | **One read per ask.** The product streams a frame in 64 KiB windows; a 250 KB whole-frame ask is 4 reads there and 1 here | Affects absolute numbers equally across arms; should not move a comparison | Low |
| **R8** | **`pool` and `hybrid` do not share a code path on a cache hit.** `pool` → `reader_pool` (`depth` Tokio tasks on one atomic), `hybrid`/`uring` → `reader_ring` (one task, `depth` slots). On a hit the ring is never engaged, so the `hit` regime measures reader-loop shape alone | If the loop is a real share of the margin, a restructured pool reader captures it **without** a ring per session | **Answered, core-dependent, and the loop term is weaker than first reported.** Split with `lab/scripts/s5_split.py`; **compare campaigns only on a shared phase set** — v25's L-on-mix reads a flat tie with `C_readers` included and **−53%** with it excluded, on the same runs, which is why the script now warns on a population mismatch. Like-for-like (A_stride+A_sweep), **8 CPU, four runs** across [`v25`](v25_s5_laptop-btrfs.tsv) and [`v28`](v28_lazyring_laptop-btrfs.tsv): loop **RESOLVED in mix** (−48 to −53%, 4/4 runs), **nothing on miss** (±2%), and on hits **straddling the threshold** — RESOLVED in v25 (−33.6/−32.9%) but a tie in v28 (−26.5/−25.4%); pooled over all four runs n=454, median **−28.8%**, 401/454 negative, i.e. it clears 28.5% by 0.3pp. Record the direction as robust and the magnitude as unresolved, not as RESOLVED. **4 vCPU** ([`v24`](v24_s5_loop_vs_ring.tsv)): loop a tie in every regime — the term needs cores to contend for. The ring is RESOLVED on misses on **every host and every run** (−42 to −73%); the idle ring is a tie everywhere (+4.6 to +17.5%) and is what `hybrid_lazyring` removes |

**Summary of the evidence position:** the **ranking** is well supported — reproduced three
times, mechanism-confirmed twice by targeted A/B, and backed by one structural (non-timing)
result in the thread count. The **magnitudes** are this host's, and the **location of our
workload on the surface** is not measured at all: every miss rate in this campaign is a
synthetic construction. That is the gap §6 addresses.

---

## 6. What would change this answer — proposed next work

Two questions are open, and they are different questions.

**Q1 — "Is the win real on our hardware?"** (validity)
**Q2 — "Which square of the surface do we actually live in?"** (magnitude, and whether a
router is needed at all)

| Study | Answers | Cost | Verdict |
| --- | :---: | --- | --- |
| **S1. Re-run the existing campaign on the production-class cloud instance** | Q1 | **Low.** `read_campaign` is a self-contained binary; `deploy_exact_server_cloud.sh` and `cloud_common.sh` already ship binaries and fixtures to the Oracle E2 rig. No new harness | **Do first.** R1 is the single highest-value unknown and this is the cheapest way to close it. If the hop tax is small there, claims 1 and 5 shrink and the whole recommendation is re-opened — better to know before designing around it |
| **S2. Replay a real ask sequence instead of a fixed stride** | Q2 | **Low–medium.** `lab/scripts/gen_live_cell_trace.py` already produces a realistic scroll schedule (300 unique frames, max_step 1, ~9 fps, reversal at 60%). Needs a `--trace` input on `read_campaign` mapping ask → (offset, len) | **Do second.** Converts miss rate from a knob into a *measured property of real behaviour*. Also tests the hypothesis that the disk pattern is 1:1 with the client ask pattern — if it is, `FADV_WILLNEED` becomes issuable from the ask stream rather than guessed, which could move claim 8 from substitute back to complement |
| **S3. Fixture larger than RAM, with realistic geometry** | Q2 | **Medium.** Generating ≥ 2× RAM of SBND with a realistic frame-size distribution and per-frame rung offsets | **Do third, and scope it tightly** — see the note below |
| **S4. Real DICOM / real HTJ2K codestreams** | — | **High.** Encoding pipeline, data handling, storage | **Not worth it for this question.** See below |
| **S5. A control arm that separates the reader loop from the ring** | R8 | Done | **Ran.** `pool_ringloop` is in `read_campaign`; two runs on the sandbox host resolve it — the ring earns the margin, the loop is a tie everywhere. **Repeated on 8 CPU and the answer changed**: the loop resolves on hits there. Settled on two core counts; `hybrid_lazyring` is the design that follows |
| **S6. Hand quinn owned buffers instead of copying into it** | — | — | **Closed by existing evidence — do not re-run.** [`SEND-BUDGET.md`](SEND-BUDGET.md) §5 already tried exactly this (a pool of reclaimable `BytesMut` windows handed to quinn): **−3.2% server CPU, 9 of 12 same sign**, below the drift threshold, and it trades the ADR's fixed 64 KiB-per-session bound for "however many windows are unacked". The copy is provably there in quinn's source and still is not worth removing. What *did* reach −20% was not the handoff but **not reading the frame again** — the bounded frame cache in the same section |

### Why S4 is not worth it and S3 is

**Read cost does not depend on the bytes.** The kernel copies 16 KB whether it is entropy-coded
wavelet coefficients or zeros. What read cost *does* depend on is **geometry** — where the
reads land and how far apart — and **volume** relative to RAM. So a fixture built from a real
frame-size *distribution* and real rung *offsets* buys essentially all of S4's validity at a
fraction of the cost. Real pixel data would only matter if we were measuring decode or
compression, which we are not.

That makes S3 the right shape: **synthetic bytes, real geometry, real size.** Specifically it
should carry the one property no cell in this campaign has — a working set larger than RAM, so
misses come from **eviction under pressure** rather than from `fadvise(DONTNEED)`. That is a
genuinely different regime (R4) and it is the one our deployment actually runs in.

### The scope line

S2 and S3 characterise the **access pattern**; they do not design the **disk layout**, which
stays out of scope. The distinction is worth holding: from one client ask sequence, each
candidate layout produces a *different* disk access pattern. So the layout-independent work
available now is —

1. characterise the **client ask sequence** (S2's trace), and
2. write the **transform** from an ask sequence to a disk pattern, parameterised by layout.

That transform is what lets a future layout proposal be priced without re-running anything,
and it is why doing S2 now is not premature.

### What none of these would change

Claim 4 (thread ceiling) is structural — it follows from a blocking read occupying a thread,
and no fixture or pattern changes that. Claim 3 (`uring` is bad on hits) is mechanism, not
magnitude. Those two are settled regardless of what S1–S3 return.

### The decision rule worth stating in advance

Set the abort condition before running, not after:

* If **S1** shows the `spawn_blocking` hop is cheap on the production instance (say the ring's
  advantage in the `miss` regime falls below 25%), the recommendation reverts to `pool` and
  S2/S3 are not worth running.
* If **S2 + S3** show a real steady-state miss rate **below 5%**, the hybrid is a tie and the
  right answer is to keep `pool` and spend the effort on the layout instead.
* Only if the miss rate lands **above ~20%** does the hybrid's 45–77% become the real number
  for us, and the implementation work is justified.
