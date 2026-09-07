# Read-path evidence — the whole campaign in one file

**Decision:** [`adr.md`](adr.md) · **Implementation:** [`IMPLEMENTATION.md`](IMPLEMENTATION.md) ·
**Deployment:** [`DEPLOYMENT.md`](DEPLOYMENT.md) · **Reproduce:** [`RERUN.md`](RERUN.md) ·
**How much a miss reads:** [`RERUN-miss.md`](RERUN-miss.md) · **Next steps:** [`PLAN.md`](PLAN.md)

Self-contained on purpose. The full campaign — thirteen documents, sixty-nine raw artifacts —
is in git at **`a330783`** and its ancestors; this file carries every number the decision rests
on so it survives a squash merge, when `git show` against that history would not.

```bash
git show a330783:docs/disk-access/READ-PATH-DECISION.md   # the argument, long form
git show a330783:docs/disk-access/SCOREBOARD.md           # risk register + evidence grading
git show a330783:docs/disk-access/S5-CONTROL-ARM.md       # loop vs ring, the control arm
git show a330783:docs/disk-access/SEND-BUDGET.md          # where a frame's microseconds go
git show a330783 --stat                                    # every raw TSV
```

The lab that produced it stays on the tip on purpose: `lab/disk-access-bench` is a workspace
member, and `lab/scripts/{s5_split,compare_hosts,loop_shape_control}.py` re-derive the tables
below. The 2026-08-31 decision was wrong partly because re-running its harness meant restoring
a crate from a named commit, and three defects went unnoticed for a whole campaign as a result.

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

**The miss-regime tie is a near miss, and it rests on one cell shape.** −24.0% against a
28.5% bar with 73 of 84 cells agreeing on the sign is not a coin flip; it is a difference
that did not clear the bar. And every one of those 84 cells is the same phase, frame size
and reader count — `A_stride`, **16 KB**, **1 reader**. Frame size demonstrably moves the
ring's margin (see below), and nobody has swept it for *this* pair.
[`PLAN.md`](PLAN.md) step 3 is the experiment that would settle it.

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

## Risks, as closed

| | Verdict |
| --- | --- |
| **R1** single host | **Closed** — three further hosts, table above |
| **R3** synthetic fixture | **Closed** — real ask schedules, 4 GB fixture ([`../disk-layout/ACCESS-PATTERNS.md`](../disk-layout/ACCESS-PATTERNS.md)) |
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

[`RERUN-miss.md`](RERUN-miss.md) measures that separately, at 250 KB frames on an 8 GB
fixture, and it changed the product. Two numbers from it belong here:

| | |
| --- | --- |
| Escalating the pool read to the rest of the frame | **2.1×** throughput at one reader, **3.0–3.2×** at 8/16/32, on 100% misses. Identical warm. Landed |
| Whole-frame `io_uring` vs whole-frame `spawn_blocking`, 250 KB frames | **A tie** on throughput and latency at 1/2/4/8/16/32 readers, both arm orders |

The tie does not contradict the −42/−73% above, and **this campaign's own `D_size` cells
show why**: the ring's margin over the pool decays monotonically with frame size, and stops
clearing the bar at exactly the size the miss campaign used.

| `hybrid` vs `pool`, miss regime | 4 KiB | 16 KiB | 64 KiB | 250 KB |
| --- | ---: | ---: | ---: | ---: |
| `v22_campaign_ci.tsv` | −62.2% | −58.2% | −45.9% | **−24.8% tie** |
| `v10_campaign.tsv` | −63.9% | −66.8% | −45.3% | — |

A round trip costs roughly what it costs; the rest of a read scales with its bytes, so the
share the ring can remove shrinks as frames grow. **At 250 KB the whole ring benefit is
already a tie** — which is the same conclusion the miss campaign reached on throughput, from
the other direction. Reproduce with
`lab/scripts/pair_arms.py --pairs hybrid:pool --by size docs/disk-access/v22_campaign_ci.tsv`.

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
| `SQPOLL` | 2.8× the CPU for worse latency — nothing completes inline, so every read parks |
| `sendfile` / splice | Userspace QUIC copies regardless |

## What is worth more than any of this

The read path is worth 2–4×. **The disk layout is worth 17.6×** on the same reads, and it is
undecided — see [`../disk-layout/ACCESS-PATTERNS.md`](../disk-layout/ACCESS-PATTERNS.md).
