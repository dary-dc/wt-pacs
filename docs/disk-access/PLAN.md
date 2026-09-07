# Read path — what to do next, in order

**Decision:** [`adr.md`](adr.md) · **Evidence:** [`EVIDENCE.md`](EVIDENCE.md) ·
[`RERUN-miss.md`](RERUN-miss.md) · **Design:** [`IMPLEMENTATION.md`](IMPLEMENTATION.md) ·
**Before shipping:** [`DEPLOYMENT.md`](DEPLOYMENT.md)

Written for an implementer picking this up cold. Five steps; the first is done and needs
checking, the third is the only one that can still change the answer.

---

## The state of it in five lines

1. **`hybrid_lazyring` is the right arm.** Tied for cheapest in all three regimes; the only
   arm cheaper on misses (`uring`) is established **+131 to +142% worse on hits**.
2. **The miss-regime tie is a near miss**, not a coin flip: `uring` is **−24.0%** against a
   28.5% bar, with **73 of 84 cells** agreeing on the sign — and on *expected CPU* it is the
   cheaper arm above a **22–34% miss rate**, which the rule never asked about.
3. **That comparison has only ever been run at one frame size, one reader count, one phase**
   — `A_stride`, 16 KB, 1 reader.
4. **Frame size moves the ring's margin a lot**, and past 64 KiB it stops clearing the bar.
5. **The shipped read path was not the `pool` arm** until 2026-09-07. It is now.

Steps 1 and 2 are validation. Step 3 is the open question. Steps 4 and 5 are the change.

---

## Step 0 — the trap that has now caught two readers

Before quoting any number from [`EVIDENCE.md`](EVIDENCE.md)'s candidate table: **that table is
pooled medians per arm, and the decision rule is defined on paired per-cell deltas.** On the
one comparison everyone wants to make they disagree by about 2×:

| `uring` vs `hybrid_lazyring`, miss regime | value |
| --- | ---: |
| ratio of the table's medians | **−41.9%** |
| median of the per-cell ratios — *what the rule tests* | **−24.0%** |

Both are arithmetically correct on the same 84 cells of `v27_lazyring.tsv`. The first reads
as "plain io_uring wins by 42% on misses"; the second does not clear the threshold. This is
exactly how the session that produced this plan started, and it is worth building the habit:

```bash
lab/scripts/pair_arms.py --pairs uring:hybrid_lazyring /tmp/v27.tsv
```

`s5_split.py` cannot answer it — it only ever compares against `pool`/`pool_ringloop`.
`pair_arms.py` takes arbitrary pairs and applies the rule mechanically.

---

## Step 1 — verify what already landed (½ hour)

`stream_codestream` used to send only *the rest of the window* to the pool on a miss.
`read_campaign`'s `pool` arm never did — it reads the whole frame in one call. **So for any
frame larger than `READ_WINDOW`, the product was strictly worse than the arm the campaign
called "ships today", and none of the campaign's numbers described it.** At 250 KB that is
2–3 device round trips per frame instead of one, worth 2.1× at one reader and 3.0–3.2× at
8/16/32 ([`RERUN-miss.md`](RERUN-miss.md) M5).

That is fixed. Confirm it rather than trusting it:

```bash
cargo test -p exact-server                     # 14 tests; the new one drives the real loop
# and prove the test actually covers the branch that changed:
sed -i 's/^        pos += ready as u32;$/        pos += want as u32;/' server/src/transport/server.rs
cargo test -p exact-server streaming_reassembles   # must FAIL
git checkout -- server/src/transport/server.rs
```

Then re-derive the headline on the deep fixture:

```bash
BYTES=250000 FRAMES=32000 NAME=frames_250k_deep ./lab/scripts/gen_live_cell_fixture.sh
cargo build -p disk-access-bench --release
./target/release/disk-access-bench --study lab/fixtures/frames_250k_deep/frames_250k_deep.sbnd \
  --arm pread-nowait-chunked --arm pread-nowait-escalate \
  --mix 1.0 --concurrency 8 --trace forward --runtime multi \
  --read-chunk 65536 --chunk 16384 --region-frames 320 --region-stride 40 \
  --repeats 5 --monitors 0
```

Expect ~1 400–1 570 f/s for `pread_nowait_chunked` against ~4 500–4 800 for
`pread_nowait_escalate`, and `hop_events/asks` of ~2.95 against 1.00. **If the hop ratio is
not ~1.00 the stride is too small** and the cell is measuring read-ahead, not misses — see
[`RERUN-miss.md`](RERUN-miss.md) §2.

**What this step is really checking** is that the product and the `pool` arm are now the same
shape. Everything in [`EVIDENCE.md`](EVIDENCE.md) assumes they are.

---

## Step 2 — validate the arm choice against the rule, not the table (1 hour)

Pull the archived datasets and re-derive every pair yourself. Nothing here should be taken on
trust; all of it reproduces in a few seconds.

```bash
for f in v10_campaign v22_campaign_ci v24_s5_loop_vs_ring v21_campaign_sandbox \
         v27_lazyring v28_lazyring_laptop-btrfs; do
  git show a330783:docs/disk-access/$f.tsv > /tmp/$f.tsv 2>/dev/null
done
lab/scripts/pair_arms.py /tmp/v27_lazyring.tsv /tmp/v28_lazyring_laptop-btrfs.tsv
lab/scripts/pair_arms.py --pairs uring:hybrid /tmp/v10_campaign.tsv /tmp/v22_campaign_ci.tsv \
                                              /tmp/v24_s5_loop_vs_ring.tsv /tmp/v21_campaign_sandbox.tsv
```

What it should say, and what it means:

| Pair | Regime | Result | Reading |
| --- | --- | --- | --- |
| `uring` vs `hybrid_lazyring` | hit | **+141.7 / +131.0% RESOLVED** (v27) | the case against `uring` as a default, and it is decisive |
| | | +17.3 / +21.5% tie (v28, btrfs laptop) | the hit penalty is host-dependent in *size*, never in sign |
| | miss | **−24.0%, 73/84** — tie | the near miss. Step 3 |
| `uring` vs `hybrid` | miss | −2.3 to −8.3%, tie on 4 datasets / 6 runs | consistent, small, never established |
| `hybrid_lazyring` vs `hybrid` | all three | ties, ±11% | the lazy build costs nothing |
| `hybrid_lazyring` vs `pool` | mix, miss | **−46 to −64% RESOLVED** | the whole prize |

**Conclusion to carry forward:** the recommendation in [`IMPLEMENTATION.md`](IMPLEMENTATION.md)
holds. `uring` is not established better than `hybrid_lazyring` anywhere, and is established
much worse on hits.

Also re-derive the size decay, because step 3 depends on it being real:

```bash
lab/scripts/pair_arms.py --pairs hybrid:pool --by size /tmp/v22_campaign_ci.tsv
# miss regime: -62.2% (4K) / -58.2% (16K) / -45.9% (64K) / -24.8% (250K, tie)
```

---

## Step 3 — the one open question, and it is the one that started this (½ day)

**Everything in step 2's miss regime comes from cells at 16 KB frames and one reader.** All 84
of them. Two facts make that worth closing rather than assuming:

- `uring` vs `hybrid_lazyring` on misses is **−24.0%** — under the bar by 4.5 points.
- Frame size demonstrably moves ring margins. `hybrid` vs `pool` runs −62% → −25% from 4 KiB
  to 250 KB, and `uring` vs `hybrid` runs −5.9% at 16 KB but **−12.0% at 250 KB** on `v22`.

So the honest statement is: *the arm choice is validated at 16 KB and 1 reader, and
extrapolated everywhere else.* If `uring`'s edge crosses 28.5% anywhere inside the box a real
deployment occupies, the arm choice changes there.

**The experiment.** `read_campaign` already has every arm and both axes; this is a sweep, not
new code.

```bash
./target/release/read_campaign \
  --arms pool,hybrid,hybrid_lazyring,uring \
  --sizes 16384,65536,250000 \
  --readers 1,4,16 \
  --phases A_stride \
  --repeats <as v27 used> \
  --out /tmp/v29_armchoice_size_readers.tsv
lab/scripts/pair_arms.py --pairs uring:hybrid_lazyring --by size    /tmp/v29_armchoice_size_readers.tsv
lab/scripts/pair_arms.py --pairs uring:hybrid_lazyring --by readers /tmp/v29_armchoice_size_readers.tsv
```

Check `read_campaign --help` for the exact flag spellings before running — this plan names
the axes, not necessarily the syntax.

**Write the decision rule down before looking at the output:**

| Outcome | What to do |
| --- | --- |
| `uring` vs `hybrid_lazyring` stays a tie at every size and reader count | Ship `hybrid_lazyring`. The question is closed and the extrapolation was safe |
| It becomes RESOLVED in a corner the deployment does not occupy | Ship `hybrid_lazyring`, record the corner in [`EVIDENCE.md`](EVIDENCE.md) |
| It becomes RESOLVED where the deployment *does* live, **and** the hit penalty is still RESOLVED there | Still `hybrid_lazyring` — a static flag cannot know a session's miss rate, which is the argument in [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Why no performance toggle |
| It becomes RESOLVED there **and** the hit penalty collapses to a tie | **Reopen the arm choice.** This is the only branch where plain `uring` wins outright, and it is what the original concern was about |
| `hybrid_adaptive` reaches `uring` on misses and `hybrid_lazyring` on hits | **Ship that instead.** It dominates both and needs no miss-rate assumption |

Two things not to skip:

- **Reverse the arm order and re-run.** Every cold ranking in this repo's history that was not
  order-controlled has reversed at least once ([`RERUN.md`](RERUN.md) §Limitations).
- **Report `hop_events` per ask, not just CPU.** If it is not ~1.00 for the whole-frame arms
  the cell is not miss-dominated and the comparison is void.

### The number that reframes the tie: breakeven ~22–34% misses

"Tie" answers *is this difference established?* It does not answer *is it worth acting on?*
Those come apart here, and the second question has never been asked. From the same pooled
medians:

* `uring` costs **+2 799 ns per hit** against `hybrid_lazyring` (4 942 vs 2 144)
* `uring` saves **−10 136 ns per miss** (14 051 vs 24 188)

Expected CPU per read therefore favours `uring` **above a 21.6% miss rate** on pooled
medians, or **33.7%** using the paired deltas (+136% hit / −24% miss) — call it a quarter to
a third. [`../disk-layout/ACCESS-PATTERNS.md`](../disk-layout/ACCESS-PATTERNS.md) says a
strided layout under pressure steps to **99% miss**. So there is a real region of the
workload space where plain `uring` is the cheaper arm, and the campaign never priced it
because the rule it applied tests resolution, not expected cost.

**This does not mean ship `uring`.** A static arm cannot know a session's miss rate, and the
hit penalty is RESOLVED — the argument in [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Why no
performance toggle stands. It means the *third* option is worth a measurement:

### The arm nobody has built: skip the probe when the session is clearly missing

On a miss, `hybrid_lazyring` pays the inline `RWF_NOWAIT` **and then** the ring read.
`uring` pays only the ring read. That difference is the entire miss-regime gap — **10 136 ns
on this host**, which is far more than a failed syscall should cost and is itself worth
understanding before acting (`RWF_NOWAIT` can return a *partial* read, so the probe may be
doing real copy work before giving up; confirm with `strace -c` or a counter before assuming
it is waste).

If most of it is avoidable, an adaptive probe gets `uring`'s miss cost **and**
`hybrid_lazyring`'s hit cost:

> after *k* consecutive misses, stop probing and go straight to the ring; re-probe every
> *N*th read so a session that warms up is noticed.

The catch is exactly that re-probe: skipping the probe means not learning whether the read
would have hit, so the arm cannot detect its own regime change for free. Price `k` and `N`
against the 2 799 ns hit penalty before building it.

Add it to `read_campaign` as `hybrid_adaptive` and run it in the step 3 sweep. If it lands
at `uring`'s miss cost and `hybrid_lazyring`'s hit cost, it dominates both and the arm
question is closed for good. If the probe turns out to be mostly unavoidable partial-copy
work, that is equally worth knowing — it explains the gap and closes the idea.

**Second gap, cheaper to close:** `hybrid_lazyring` exists on two hosts (`v27` 8-CPU, `v28`
btrfs laptop). `uring`'s hit penalty is +131–142% on one and +17–21% on the other. Nobody has
run the lazyring arm on the 4 vCPU sandbox or the GitHub runner, which are the two hosts most
like a small deployment. Re-running `v27`'s configuration there is an hour and closes R1 for
the arm that actually ships.

---

## Step 4 — implement `hybrid_lazyring`

[`IMPLEMENTATION.md`](IMPLEMENTATION.md) is the design and it is complete: `ReadCtx`, the
`nowait_supported()` gate, the kill switch, four tests, the sequencing. Two notes from this
round that it predates:

- **The shortfall branch now hands the pool the rest of the *frame*, not the rest of the
  window.** The ring submission inherits that: submit the remainder of the frame in one
  operation, not one per window. Windowed io_uring measures *worse* than whole-frame io_uring
  by the same round-trip-count mechanism that beat the windowed pool path
  ([`RERUN-miss.md`](RERUN-miss.md) M1) — do not reintroduce it inside the ring.
- **Keep `write_all` at `READ_WINDOW`.** A bigger read must not become a bigger uninterrupted
  executor copy; that is what keeps the warm co-tenant gap at 148 µs instead of 4.0 ms.

Add one test beyond the four listed:

| Test | Asserts |
| --- | --- |
| `ring_read_covers_the_rest_of_the_frame` | after a shortfall at window *k*, one ring operation returns bytes `k..len` — not `k..k+READ_WINDOW` |

---

## Step 5 — decide whether it was worth it, on the host that matters

```bash
./target/release/check-fastpath /path/to/studies    # DEPLOYMENT.md; answer this first
```

`RWF_NOWAIT` refused (any container serving studies from its own layer) means the ring is
never built and this change is inert — and the deployment is on the ~2.5×-worse escape hatch,
which is a bigger problem than the arm choice.

Then the two numbers nobody has written down, both of which decide what the change is worth
more than the arm choice does:

1. **`read_ahead_kb` on the deployment host.** The lab is 8192, 64× the usual 128. It decides
   how often reads miss far more than study size does — a sequential scroll through a study
   ten times RAM still hops about once per 32 frames at 8 MB read-ahead
   ([`RERUN-miss.md`](RERUN-miss.md) §2).
2. **The delivered frame size.** Rungs make frames smaller and the ring worth more; native DBT
   makes them larger and the ring worth less — measured, −62% at 4 KiB down to a tie at
   250 KB. [`adr-resolution-fitting-for-large-frames.md`](../adr-resolution-fitting-for-large-frames.md)
   is what sets it.

The layout work in [`../disk-layout/`](../disk-layout/) sets the miss rate and is the larger
lever (17.6× against this path's 2–4×). It does not change which arm is correct — see
[`IMPLEMENTATION.md`](IMPLEMENTATION.md) §The layout changes what this is worth.

---

## Appendix — what this round verified, and what it corrected

Reproduce all of it with `lab/scripts/pair_arms.py` on the archived TSVs.

| | |
| --- | --- |
| **Verified** | `uring` vs `hybrid_lazyring` is a tie on misses (−24.0%, 73/84) and RESOLVED worse on hits. The recommendation stands |
| **Verified** | `uring` vs `hybrid` is a tie on misses on 4 datasets and 6 runs, −2.3 to −8.3% |
| **Verified** | The ring's margin over the pool decays with frame size and stops clearing the bar past 64 KiB |
| **Found** | The candidate table's statistic is not the rule's. −41.9% against −24.0% on the same cells. Annotated in [`EVIDENCE.md`](EVIDENCE.md) |
| **Found** | The arm-choice comparison rests on one phase, one frame size, one reader count. Step 3 |
| **Found** | The shipped `stream_codestream` was not the `pool` arm for frames > 64 KiB. Fixed |
| **Corrected** | [`RERUN-miss.md`](RERUN-miss.md) claimed the two campaigns had never been run at the same frame size. `v22` has `D_size250000` cells |
| **Corrected** | Its size-scaling claim was written as a prediction. It was already answered by `v22`, and it holds |

### Still not established, anywhere

- Storage faster than ~1.25 GB/s. Every miss-regime conclusion here is device-bound; on NVMe
  at several GB/s, thread scheduling could become the limit and io_uring's 5-threads-against-44
  would start converting into something ([`RERUN-miss.md`](RERUN-miss.md) M3).
- Frames past 250 KB — native DBT is 3 MB, and the mechanisms point in opposite directions
  there (windowing worse, ring worth less).
- `hybrid_lazyring` on the 4 vCPU sandbox or the GitHub runner.
