# Read path — what to do next, in order

**Decision:** [`adr.md`](adr.md) · **Evidence:** [`EVIDENCE.md`](EVIDENCE.md) ·
[`RERUN-miss.md`](RERUN-miss.md) · **Design:** [`IMPLEMENTATION.md`](IMPLEMENTATION.md) ·
**Before shipping:** [`DEPLOYMENT.md`](DEPLOYMENT.md)

Written for an implementer picking this up cold.

**The investigation is closed.** The arm is chosen, the evidence is validated, the one product
defect it turned up is fixed, and the question that kept it open — whether plain `uring` beats
`hybrid_lazyring` once reads miss — is now answered: **it depends on a session's in-flight
depth, not on the miss rate.** Four steps below, none of them research. Two things at the end
need a decision rather than a measurement: how the tile path fans out, and reader scale.

---

## The state of it in five lines

1. **`hybrid_lazyring` is the right arm.** Tied for cheapest in all three regimes; the only
   arm cheaper on misses (`uring`) is established **+131 to +142% worse on hits**.
2. **The `uring` miss advantage is a queue-depth effect.** −1.2/−1.9% at depth 1, −30 to −43%
   at depths 4–16. Today's loop is depth 1, where `uring` costs **+133 to +386% on hits** and
   breakeven sits at a **65–84%** miss rate. **A tile viewport will not be depth 1** — see the
   end, where the fan-out shape decides it.
3. **Frame size moves the ring's margin a lot**, and past 64 KiB it stops clearing the bar.
4. **The shipped read path was not the `pool` arm** until 2026-09-07. It is now.
5. **Still open: reader scale.** Both lazyring datasets are `readers=1`, and the target is
   thousands. `pool` reaches 381 threads at 128 readers; both ring arms stay at 5.

Steps 1 and 2 are validation, 3 and 4 are the change.

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

## Step 3 — implement `hybrid_lazyring`

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

## Step 4 — decide whether it was worth it, on the host that matters

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

## Answered — the probe is free at this server's queue depth

**This was the open question, and it is now closed with a measurement rather than a deferral.**
Full working in [`RERUN-miss.md`](RERUN-miss.md) M10.

`hybrid_lazyring` is `uring` plus one inline `RWF_NOWAIT` before the ring read. The entire case
for ever routing a study to plain `uring` was the −24.0% gap between them on misses. Three
findings kill it:

1. **The probe returns 0 bytes** — it is a question, not hidden copy work. So the cost, whatever
   it is, is genuinely avoidable and worth pricing.
2. **Pricing it directly, the arms do not separate.** `uring_nowait_whole` vs `uring_whole` at
   100% miss: −9.5/−5.5% (16 KB, 1 session), −3.8/**+35.9%** (16 KB, 8), −15.3/+0.3% (250 KB, 1),
   +0.2/+3.0% (250 KB, 8). The sign flips under the order control in three of four cells.
3. **The −24% is a queue-depth artefact.** Split by depth, it is **−1.2/−1.9% at depth 1** and
   −25 to −43% only at depths 4–32, and only on one of two hosts. At depth > 1 the hybrid's
   probes run serially on the executor before the ring can batch; at depth 1 there is nothing
   to serialise.

`docs/adr-reject-server-ordering.md` fixes the session loop at **depth 1** — one frame to
completion before the next ask. Restricted to depth-1 cells:

| CPU ns/read, depth 1 | `v27` hit | `v27` miss | `v28` hit | `v28` miss |
| --- | ---: | ---: | ---: | ---: |
| **`hybrid_lazyring`** | **2 030** | 36 817 | 4 250 | 50 256 |
| `uring` | 9 858 | 35 300 | 9 910 | 47 177 |
| | **+386%** | −4% | **+133%** | −6% |

**Breakeven moves from a 21.6% miss rate to 65–84%**, and past it `uring` wins by 4–6%. A
99%-miss tile workload would buy 4–6% of read CPU and pay 133–386% on whatever hits remain.

### The branch is not needed for today's loop — and the tile path is expected to need it

The branch's whole value is skipping the probe, and **at depth 1 the probe is free**. Today's
session loop is depth 1 by construction (`docs/adr-reject-server-ordering.md`: one frame to
completion before the next ask), so for sequential serving — the US case, whether client-driven
or pushed start-to-end — `hybrid_lazyring` is the answer and nothing else is needed.

**The tile path is a different loop.** A viewport at zoom covers many tiles; serving them
concurrently within a session puts that path at depth 4–16, where the probe costs **30–43%**
([`RERUN-miss.md`](RERUN-miss.md) M10). That is not hypothetical — it is what a tile viewport
does.

**But the fan-out shape decides it, and that is a choice you make first:**

| Fan-out | Axis | Probe cost on misses | Arm |
| --- | --- | ---: | --- |
| One task holding *N* slots, submitted together | `depth` | **−30 to −43%** | wants the branch |
| *N* independent tasks, one read each | `readers` | −2 to −10%, ties | `hybrid_lazyring`, unchanged |

So the decision to make before building tiles is **not** which read arm to use — it is whether
the tile fan-out batches into one submission or spreads across tasks. Batching is what makes
the probe a serial prologue. Spreading keeps it a syscall.

**If you batch, build the branch:** one `probe_inline: bool` on `ReadCtx`, default `true`, set
from the serving mode — not from a runtime guess and not from a human toggle. It is one field
and one branch; `uring` and `hybrid_lazyring` share the ring, the buffers and the completion
path, and differ only in whether the inline read is attempted.

### Remaining triggers

| Trigger | Why it changes the answer |
| --- | --- |
| The read path shows up as a real share of server CPU in a profile | Today it is ~a fifth of a frame's cost; 4–6% of one regime of that is not where the cycles are |
| Storage gets much faster than ~1.25 GB/s | Scheduling rather than the device becomes the limit ([`RERUN-miss.md`](RERUN-miss.md) M3) |

### What is still genuinely open: reader scale

Both `hybrid_lazyring` datasets (`v27`, `v28`) are **`readers=1`**. The recommended arm has
never been measured with more than one concurrent session, and the deployment target is
thousands. The reader-scale evidence tops out at 128 readers and does not include it:

| readers | `pool` threads | `hybrid` | `uring` |
| ---: | ---: | ---: | ---: |
| 1 | 11–12 | 5 | 5 |
| 16 | 77–82 | 5 | 5 |
| 64 | 160–265 | 5 | 5 |
| 128 | 227–381 | 5 | 5 |

Two readings. **Thread growth separates ring-from-`pool`, not the two ring arms** — so scale is
an argument for shipping the ring at all, not for the branch. And `pool` at 381 threads for 128
readers is the number that should decide the schedule: at thousands of concurrent sessions the
arm that ships today is the one that does not hold up.

Closing it is cheap and worth doing before rollout, not before implementation:

```bash
./target/release/read_campaign --arms pool,hybrid,hybrid_lazyring,uring \
  --readers 1,16,64,128 --depth 1 --out /tmp/v29_lazyring_readers.tsv
lab/scripts/pair_arms.py --pairs hybrid_lazyring:hybrid,uring:hybrid_lazyring \
  --by readers /tmp/v29_lazyring_readers.tsv
```

Expect ties throughout — `hybrid_lazyring` is `hybrid` with a lazier constructor, and `hybrid`
is already measured to 128. A surprise there is the only thing that would change the arm.

---

## Appendix — what this round verified, and what it corrected

Reproduce all of it with `lab/scripts/pair_arms.py` on the archived TSVs.

| | |
| --- | --- |
| **Verified** | `uring` vs `hybrid_lazyring` is a tie on misses (−24.0%, 73/84) and RESOLVED worse on hits. The recommendation stands |
| **Verified** | `uring` vs `hybrid` is a tie on misses on 4 datasets and 6 runs, −2.3 to −8.3% |
| **Verified** | The ring's margin over the pool decays with frame size and stops clearing the bar past 64 KiB |
| **Found** | The candidate table's statistic is not the rule's. −41.9% against −24.0% on the same cells. Annotated in [`EVIDENCE.md`](EVIDENCE.md) |
| **Found** | The arm-choice comparison rests on one phase, one frame size, one reader count |
| **Answered** | That comparison's −24.0% is a queue-depth artefact: −1.2/−1.9% at depth 1, where this server runs. Plain `uring` is not a candidate here — +133 to +386% on hits, breakeven at 65–84% misses |
| **Still open** | Both `hybrid_lazyring` datasets are `readers=1`; the target is thousands. Threads separate ring-from-`pool` (5 vs 381 at 128 readers), not the two ring arms |
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
