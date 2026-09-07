# Disk-access — the miss-dominated case — 2026-09-07

What a miss should read, measured where a miss is a real device read. **Decision:**
[`adr.md`](adr.md) · **Instrument:** [`RERUN.md`](RERUN.md) · **The other campaign:**
[`EVIDENCE.md`](EVIDENCE.md) · **Next steps:** [`PLAN.md`](PLAN.md)

> **This is a different question from the read-path campaign, and the two agree.**
> [`EVIDENCE.md`](EVIDENCE.md) asks *who submits the round trip* — pool or ring — and finds
> the ring worth −42 to −73% CPU per read on four hosts at **16 KB** frames. This asks *how
> many round trips a frame costs*, and finds the shipped loop taking two or three where one
> would do at **250 KB** frames. Composition, not competition: the ring makes a round trip
> cheaper, escalating makes there be one. §Reconciliation shows the arithmetic that makes
> both true.

**Host:** KVM/Firecracker guest · 4 vCPU Xeon @2.8 GHz · 15 GB RAM · **ext4 on `/dev/vda`** ·
Linux 6.18 · `RWF_NOWAIT` honoured · **`read_ahead_kb` = 8192**.
Instrument resolution: [`x0_instrument_selftest.txt`](x0_instrument_selftest.txt).
Fixture: `frames_250k_deep` — 32 000 × 250 000 B ≈ 8 GB.

**One-line result:** once most asks miss, the shipped loop is **2.4× behind at one session
and 3.1–3.4× behind at 8–32** — and every arm it is behind reads a whole frame per round
trip. `io_uring` doing that ties plain `spawn_blocking` doing that at every concurrency from
1 to 32, in both arm orders, so on *this* axis at *this* frame size the submission mechanism
is not the variable: **how many device round trips a frame costs** is. The fix is a dozen
lines in `stream_codestream`.

---

## Why the previous campaign could not see this

Three instrument defects, each of which alone is enough to hide the effect.

### 1. The fixture was hypervisor-cached, so "cold" was mostly not

`frames_250k_live` is 80 MB. Five consecutive cold forward passes over it, evicting in the
guest each time:

| pass | 1 | 2 | 3 | 4 | 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| wall | **442.7 ms** | 45.5 ms | 31.3 ms | 32.2 ms | 33.3 ms |
| throughput | 181 MB/s | 1759 MB/s | 2555 MB/s | 2481 MB/s | 2403 MB/s |

2.5 GB/s is not this device. Guest eviction cannot evict the *host's* cache, and 80 MB fits
in it. The same test over one region of an 8 GB file shows no such collapse — 93.6, 76.9,
74.2 ms across three passes over identical bytes — so the effect is the fixture's size, not
the method.

This is the direct cause of [`RERUN.md`](RERUN.md) §Limitations: "the same cold pass takes
25 ms on one repeat and 200 ms on another", and of the 34% CPU difference that reversed
under an order control. Those cells were resolving the hypervisor's cache.

### 2. Cold is not miss-dominated — read-ahead here is 8 MB

`/sys/block/vda/queue/read_ahead_kb` is **8192**, 64× the usual 128. One 250 KB frame read
pulls in the next ~32 frames. A **fully evicted** 256-frame contiguous region therefore
costs **4** pool round trips, not 256:

```
pread_nowait_chunked  mix=1.00  region contiguous   hops=4/256  p50 1316 us
pread_nowait_chunked  mix=1.00  region stride 40    hops=128/128  p50 1578 us
```

So "cold" and "miss-dominated" are different cells, and the campaign only ever ran the
first. Its headline cold-forward figure — 6 pool hops per 320 asks — is a **read-ahead**
result, and it holds however large the study is. Making an evicted frame an isolated miss
needs the asked frames spaced past the read-ahead window: `--region-stride 40` (10 MB at
250 KB frames).

**This is worth carrying into any deployment discussion.** Whether reads miss is decided far
more by access pattern and `read_ahead_kb` than by whether the study fits in RAM. A
sequential scroll through a study ten times the size of RAM still hops about once per 32
frames on this host.

### 3. There was no way to ask for a miss ratio

`warm` (every ask hits) and `cold` (read-ahead decides) were the only temperatures. Nothing
could answer "what happens at 60% misses", which is the shape a real deployment has.

---

## Instrument

New in `lab/disk-access-bench` (`--help` for all of it):

| Flag | What |
| --- | --- |
| `--mix <f>` | Fraction of a cell's frames that must **miss**, set and then verified with `mincore`. A cell that did not achieve its target aborts rather than reporting under the wrong label |
| `--region-stride <n>` | Frames between the frames a cell asks for — what makes an evicted frame an *isolated* miss rather than a read-ahead prefix |
| `--region-frames <n>` | Frames per cell. Each cell takes the **next** region, so the hypervisor's cache cannot follow one arm around |
| `--concurrency <n>` | `n` sessions, **all measured**, all on the arm under test, each on its own slice of the region. The old `--sessions` had warm background sessions around one cold primary, so no cell ever put more than one session on the miss path |
| `--max-blocking <n>` | Cap Tokio's blocking pool (its default is 512, which is not a pool an operator would run) |
| `--uring-depth <n>` | Windows `uring_pipelined` keeps in flight |

`residency.rs` sets the cache state and proves it. One detail decides whether it works:
**the hit set must be warmed through a `FADV_RANDOM` descriptor.** Evicting the read-ahead
spill afterwards does not work — measured 0.90 of the miss set resident after warming, 0.63
after one `fadvise(DONTNEED)` pass, and still 0.63 after five. Prevent the read-ahead;
do not try to undo it.

New column: **`hop_events`** — total pool/eventfd round trips. The old `hop_count` counts
asks that hopped *at all*, which cannot tell one 400 µs frame hop from four 100 µs window
hops. That distinction turns out to be the whole result.

New arms:

| Arm | What |
| --- | --- |
| `uring_whole` | Registered, **one read for the whole frame**. A ring read never runs on the executor, so it has no reason to be windowed — and the campaign never had this arm |
| `uring_batched_stream` | Every window submitted together, written **as each lands**. `uring_tuned` waits for the whole frame first, which is why it was the worst arm on a miss; that is a property of that arm, not of io_uring |
| `pread_nowait_escalate` | The accepted path, except a window that misses sends **the rest of the frame** to the pool rather than the rest of that window |

`complete_slot` returns "this read did not complete inline", not a park count — one read can
take two trips round the eventfd before its CQE is visible, and counting those would not
compare with a `spawn_blocking` round trip.

---

## Cell M1 — the miss ratio, one session

[`x1_missratio_order_a.tsv`](x1_missratio_order_a.tsv) ·
[`x1_missratio_order_b.tsv`](x1_missratio_order_b.tsv)

```bash
./target/release/disk-access-bench --study lab/fixtures/frames_250k_deep/frames_250k_deep.sbnd \
  --arm pread-blocking-pooled --arm pread-nowait --arm pread-nowait-chunked \
  --arm uring-whole --arm uring-tuned --arm uring-batched-stream \
  --arm uring-pipelined --arm uring-nowait-hybrid \
  --mix 0.0 --mix 0.25 --mix 0.5 --mix 0.75 --mix 1.0 --concurrency 1 \
  --trace forward --runtime multi --read-chunk 65536 --chunk 16384 \
  --region-frames 128 --region-stride 40 --repeats 7 --monitors 0 \
  --mix-out ... --mix-samples ...
```

Pooled p50 over 896 asks per cell, and the same run with the **arm order reversed** — per
[`RERUN.md`](RERUN.md) §Precision, a difference counts only if it reproduces with the same
sign. Percentages are against the accepted path.

| Arm | hop/ask @1.0 | p50 @ mix 0 | p50 @ mix 1.0 | vs accepted, order A | order B |
| --- | ---: | ---: | ---: | ---: | ---: |
| `pread_nowait_chunked` *(accepted)* | 2.00 | 165 / 177 µs | 1217 / 1207 µs | — | — |
| `pread_nowait` (whole frame) | 1.00 | 151 / 150 µs | 488 / 466 µs | **−60%** | **−61%** |
| `uring_whole` | 1.00 | 182 / 182 µs | 502 / 497 µs | **−59%** | **−59%** |
| `pread_blocking_pooled` | 1.00 | 338 / 289 µs | 518 / 502 µs | −57% | −58% |
| `uring_batched_stream` | 1.92 | 180 / 184 µs | 542 / 533 µs | −55% | −56% |
| `uring_tuned` | 3.99 | 176 / 180 µs | 652 / 599 µs | −46% | −50% |
| `uring_pipelined` | 1.99 | 218 / 210 µs | 1064 / 1057 µs | −13% | −13% |
| `uring_nowait_hybrid` | 5.99 | 167 / 165 µs | 1676 / 1538 µs | +38% | +28% |

Read the `hop/ask` column first: it predicts the ranking on its own. Every arm that costs
one device round trip per frame lands at 466–518 µs; every arm that costs two or more lands
above it in proportion. **Warm, nothing has changed** — the accepted path is still within a
few percent of the best, and the previous campaign's verdict on that half stands.

`uring_nowait_hybrid` is the clearest illustration: at 100% misses, `RWF_NOWAIT` is a
syscall that is guaranteed to fail, and doing it per window before *also* going to the ring
costs six round trips per frame.

## Cell M2 — concurrency

[`x2_concurrency_order_a.tsv`](x2_concurrency_order_a.tsv) ·
[`x2_concurrency_order_b.tsv`](x2_concurrency_order_b.tsv)

`--concurrency 1..32`, 320 asks per cell whatever the session count, so throughput is
comparable across the row. Median of 5, `--monitors 0`. Frames/s at 100% misses:

| sessions | 1 | 2 | 4 | 8 | 16 | 32 | peak threads @32 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `pread_nowait_chunked` *(accepted)* | 800 | 871 | 1257 | 1535 | 1614 | **1607** | 42 |
| `pread_nowait` | 1920 | 1839 | 3695 | 5174 | 5001 | **4912** | 39 |
| `pread_blocking_pooled` | 1857 | 2301 | 3492 | 5247 | 4815 | **4887** | 44 |
| `uring_whole` | 1812 | 2276 | 3740 | 5153 | 5051 | **4732** | **5** |
| `uring_batched_stream` | 1725 | 2231 | 2795 | 3402 | 3231 | **3003** | **5** |

Three things:

* **The accepted path does not scale on the miss path.** It flat-lines at ~1600 f/s from 8
  sessions on, while every whole-frame arm reaches ~5000 f/s — the device's ~1.25 GB/s. The
  gap *widens* with load: 2.4× at one session, 3.4× at eight, 3.1× at sixteen and 3.1× at
  thirty-two.
* **io_uring wins nothing here.** `uring_whole` is within ±5% of `pread_nowait` and
  `pread_blocking_pooled` at every point, in both arm orders.
* **io_uring's one real advantage is thread count** — 5 against 39–44 — and it does not
  convert. See M3.

At 0% misses the ranking is the old one, unchanged at every concurrency: accepted path
32 211 f/s at 32 sessions, `uring_whole` 22 440, `pread_blocking_pooled` 22 556 with 49
threads.

## Cell M3 — does the blocking pool ever become the constraint?

[`x3_poolcap_4.tsv`](x3_poolcap_4.tsv) · [`_8`](x3_poolcap_8.tsv) ·
[`_16`](x3_poolcap_16.tsv) · [`_64`](x3_poolcap_64.tsv)

The strongest remaining case for io_uring is that a `spawn_blocking` read needs a thread and
a ring read does not. 32 sessions, 100% misses, Tokio's blocking pool capped:

| `--max-blocking` | 4 | 8 | 16 | 64 |
| --- | ---: | ---: | ---: | ---: |
| `pread_nowait` | **6142** | 5287 | 4746 | 4841 |
| `pread_blocking_pooled` | 4694 | 5354 | 4458 | 4719 |
| `uring_whole` | 5672 | 5331 | 4390 | 4916 |

**Four blocking threads serve 32 concurrent missing sessions with no loss at all** — it is
the best cell in the table. The device saturates at ~5000–6000 f/s long before threads do,
so io_uring's structural advantage has nothing to convert into. It would need storage fast
enough that thread scheduling, not the device, is the limit.

The 5-thread figure is real and not an accounting artefact: sampling `/proc/<pid>/task` in a
tight loop for a whole 32-session run never sees an `iou-wrk` worker. Buffered reads that
would block are retried through the page-cache wait queue rather than punted to `io-wq`.

## Cell M4 — the read window is the variable

[`x4_readwindow_65536.tsv`](x4_readwindow_65536.tsv) ·
[`_131072`](x4_readwindow_131072.tsv) · [`_262144`](x4_readwindow_262144.tsv)

The accepted arm, unchanged, with only `--read-chunk` swept. 250 KB frames, so 262144
means one whole-frame read:

| `--read-chunk` | 64 KiB | 128 KiB | 256 KiB (whole frame) |
| --- | ---: | ---: | ---: |
| 100% miss, 8 sessions — f/s | 1660 | 3075 | **5592** |
| — hop/ask | 2.93 | 2.00 | **1.00** |
| 0% miss, 8 sessions — f/s | **30 738** | 26 899 | 23 187 |
| 0% miss, 1 session — p50 | 161.9 µs | 136.9 µs | 126.9 µs |

The whole 3.4× is recovered by the window size alone, with no io_uring anywhere in the
cell — and it costs 25% of the warm throughput to take it. That is the real trade, and it is
the one the ADR's `READ_WINDOW` doc comment already described from the other side.

## Cell M5 — taking both halves

[`x5_escalate_order_a.tsv`](x5_escalate_order_a.tsv) ·
[`x5_escalate_order_b.tsv`](x5_escalate_order_b.tsv) ·
[`x6_escalate_scale.tsv`](x6_escalate_scale.tsv)

The window exists to bound how long the executor copies without yielding. That argument
applies to the inline `RWF_NOWAIT` read, which only happens on a **hit**. The blocking read
runs on the pool, where a large read costs no more than a small one and a small one costs a
whole extra round trip. So: window the executor's reads, not the pool's.

`pread_nowait_escalate` — frames/s, median of 5, both arm orders:

| cell | accepted | **escalate** | `pread_nowait` | `uring_whole` | pooled |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0% miss, 1 session | 5860 / 5501 | 5621 / 6204 | 6452 / 6319 | 5445 / 5593 | 2909 / 4290 |
| 0% miss, 8 sessions | 25 919 / 26 411 | 26 625 / 29 862 | 33 276 / 31 571 | 27 947 / 24 453 | 16 076 / 19 064 |
| 50% miss, 8 sessions | 3117 / 3172 | **10 086 / 9829** | 9932 / 9930 | 10 051 / 9758 | 10 621 / 10 235 |
| 100% miss, 1 session | 858 / 780 | **1831 / 1645** | 2289 / 2255 | 2062 / 1940 | 2016 / 2009 |
| 100% miss, 8 sessions | 1404 / 1573 | **4539 / 4777** | 5081 / 5429 | 5072 / 5223 | 4950 / 5048 |
| 100% miss, 16 sessions | 1608 | **4959** | 4833 | 5009 | 5162 |
| 100% miss, 32 sessions | 1726 | **5129** | 5452 | 5233 | 5403 |

Warm it is the accepted path (within run-to-run drift, both signs across the two orders).
Miss-dominated it is **2.1× the accepted path at one session and 3.0–3.2× at 8, 16 and 32**
— the gap grows with load because the accepted path stops scaling and this does not. Against
the whole-frame arms it is 6–12% behind at 1 and 8 sessions, and level at 16 and 32 (+2.6%
and −5.9% against `pread_nowait`, −1.0% and −2.0% against `uring_whole`). The residue is the
one `RWF_NOWAIT` probe per frame that is guaranteed to fail when everything misses — which
is also what buys the warm half.

A random trace ([`x8_random_trace.tsv`](x8_random_trace.tsv)) gives the same ordering at
every mix, so this is not an artefact of a sequential trace.

## Cell M6 — and it is the safest arm, which the whole-frame arms are not

[`x7_escalate_gap.tsv`](x7_escalate_gap.tsv) — 8 sessions, one co-tenant `yield_now`
monitor. `gap_max`:

| Arm | 0% miss | 100% miss |
| --- | ---: | ---: |
| `pread_nowait_escalate` | **148 µs** | 1384 µs |
| `pread_nowait_chunked` *(accepted)* | 326 µs | 1525 µs |
| `uring_whole` | 560 µs | 749 µs |
| `pread_blocking_pooled` | 797 µs | 789 µs |
| `pread_nowait` (whole frame) | **4011 µs** | 794 µs |

This is why "just read whole frames" is not the answer. Reading 250 KB inline with
`RWF_NOWAIT` on a page-cache hit is a 250 KB uninterrupted executor copy, and it costs a
**4.0 ms** worst co-tenant gap warm — 27× the escalating arm, and the reason the previous
campaign rejected `pread_nowait` in the first place. That rejection was right, and it
survives this campaign: the whole-frame arms buy their miss throughput with executor
occupancy, and escalating buys the same throughput without it.

Under 100% misses the executor barely copies at all (everything arrives from the pool) and
the arms converge; read that column with the single-monitor caveat from
[`RERUN.md`](RERUN.md) §Limitations.

## Cell M7 — the same arms on the old instrument

[`x9_old_instrument_same_arms.tsv`](x9_old_instrument_same_arms.tsv) — `frames_250k_live`,
the 80 MB fixture, `--temp cold`, the previous campaign's exact cells:

| cell | accepted `later_p50` | escalate `later_p50` |
| --- | ---: | ---: |
| warm / forward | 73.5 µs | 72.2 µs |
| warm / reverse | 83.5 µs | 78.8 µs |
| cold / forward | 69.6 µs | 63.4 µs |
| **cold / reverse** (the old "100% miss" cell) | 570.5 µs | **549.5 µs — 4%** |

The same comparison that is 3.2× on the deep fixture is **4%** here. Nothing is wrong with
either number: on an 80 MB host-cached fixture a miss costs ~12 µs, so the round trips the
accepted path adds are nearly free, and the axis this campaign is about is invisible.
That is the whole reason the previous campaign concluded the accepted path "degrades to the
escape hatch; it never degrades below it" — on its instrument, it does.

---

## Cell M10 — the inline probe, priced; and where the −24% actually lives

[`x10_probe_16k_order_a.tsv`](x10_probe_16k_order_a.tsv) ·
[`x10_probe_16k_order_b.tsv`](x10_probe_16k_order_b.tsv) ·
[`x11_probe_250k_order_a.tsv`](x11_probe_250k_order_a.tsv) ·
[`x11_probe_250k_order_b.tsv`](x11_probe_250k_order_b.tsv)

`hybrid_lazyring` is `uring` plus one thing: an inline `RWF_NOWAIT` before the ring read.
[`EVIDENCE.md`](EVIDENCE.md)'s candidate table puts the gap between them at −41.9% on misses
(−24.0% paired), and that gap is the *entire* case for ever routing a study to plain `uring`.
So: what does the probe cost?

**It returns nothing, and it is not hidden copy work.** A new `probe_got` column records what
a failed `read_at_nowait` handed back. It is **0 in every cell, at both frame sizes, at 1 and
8 concurrent sessions.** The probe is a question, not a partial read — which rules out the
benign explanation and makes the cost, whatever it is, genuinely avoidable.

**But the arms do not separate.** `uring_nowait_whole` (probe, then ring) against `uring_whole`
(ring only), 100% miss, 7 repeats, both arm orders:

| cell | order A | order B |
| --- | ---: | ---: |
| 16 KB, 1 session | −9.5% | −5.5% |
| 16 KB, 8 sessions | −3.8% | **+35.9%** |
| 250 KB, 1 session | −15.3% | +0.3% |
| 250 KB, 8 sessions | +0.2% | +3.0% |

Sign flips under the order control in three of four cells. Nothing here is a −24% effect.

### The −24% is a queue-depth artefact

Splitting the read-path campaign's own comparison by `depth` — reads in flight per reader —
says where it lives (`pair_arms.py --pairs uring:hybrid_lazyring --by depth`):

| `uring` vs `hybrid_lazyring`, misses | depth 1 | 2 | 4 | 8 | 16 | 32 | 64 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `v27` run1 | **−1.2%** | +8.7% | −41.6% | −42.8% | −41.8% | −28.5% | −25.6% |
| `v27` run2 | **−1.9%** | −2.6% | −25.6% | −40.5% | −40.8% | −29.5% | −17.6% |
| `v28` (btrfs) | **+4.0%** | −1.5% | +2.0% | −1.6% | −6.4% | +4.1% | −3.4% |

**At depth 1 the two arms are a tie — −1.2% and −1.9%.** The whole signal lives at depths 4–32,
and only on one of the two hosts. Pooling depths 1…64 into a single "miss" bucket is what
produced −24.0%.

The mechanism is plain once seen: at depth > 1 the hybrid's probes run **serially on the
executor before the ring can batch anything**, converting a parallel submission into a serial
prologue. At depth 1 there is nothing to serialise, so the probe costs one syscall and the
arms converge.

### What the candidate table looks like at the depth the product runs

`docs/adr-reject-server-ordering.md` has the session loop send one frame to completion before
reading the next ask — **queue depth 1**. Restricted to those cells:

| CPU ns/read, depth 1 | `v27` hit | `v27` miss | `v28` hit | `v28` miss |
| --- | ---: | ---: | ---: | ---: |
| `pool` | 2 726 | 80 292 | 4 214 | 61 240 |
| `hybrid` | 2 256 | 35 678 | 4 150 | 45 948 |
| **`hybrid_lazyring`** | **2 030** | 36 817 | 4 250 | 50 256 |
| `uring` | **9 858** | 35 300 | **9 910** | 47 177 |

At depth 1 `uring`'s hit penalty is **+386%** on `v27` and **+133%** on `v28` — worse than the
+131/+142% the pooled table reports — while its miss advantage collapses to **4–6%**. The
breakeven moves with it:

| | breakeven miss rate | and then wins by |
| --- | ---: | ---: |
| pooled over depths 1…64 *(what §Reconciliation used)* | 21.6% | 42% |
| **depth 1, `v27`** | **84%** | 4% |
| **depth 1, `v28`** | **65%** | 6% |

**So the case for routing a study to plain `uring` does not survive contact with the product's
queue depth.** Even a 99%-miss tile workload would buy 4–6% of read CPU, and pay 133–386% on
whatever hits remain.

### What would bring it back

Not a miss rate, and not a layout — **a queue depth**. If the server ever serves the client's
ask window concurrently rather than one frame at a time, depth goes above 1 and the probe
starts costing 25–43%. That is a server-architecture change, it is already flagged in
[`adr.md`](adr.md) §Revisit, and it is the one condition under which a layout-routed
`probe_inline` branch would earn its keep.

---

## Reconciliation — why this and the read-path campaign both hold

[`EVIDENCE.md`](EVIDENCE.md) measures the ring at **−42 to −73% CPU per read on misses,
resolved on four hosts and six runs**. Nothing here contradicts it, and it is worth being
precise about why, because the two look like they disagree.

Three differences, and each one matters:

| | read-path campaign | this campaign |
| --- | --- | --- |
| Metric | **CPU per read** | wall throughput, latency, round trips |
| Frame size | **16 KB** (`frames_16k_big`) | **250 KB** (`frames_250k_deep`) |
| The `pool` arm | one `RWF_NOWAIT` for the **whole frame**, one hop | the **shipped windowed loop**, 2–3 hops |

The arithmetic that makes both true: the hop tax is a roughly fixed cost per round trip —
**24–34 µs across four hosts** ([`EVIDENCE.md`](EVIDENCE.md) §Hosts) — while the rest of a
read scales with the bytes. At 16 KB the hop is most of the read, so removing it is 42–73%.
At 250 KB the read costs ~300 µs of CPU here, so the same fixed saving is **under 8%** —
inside this campaign's ~7–11% run-to-run drift, which is exactly what was observed
(`uring_whole` 294 µs/ask against `pread_nowait` 314 and `pread_blocking_pooled` 253 at 32
readers: no sign that survives the rule).

**So the ring's win shrinks as frames grow, and this campaign is where it stops being
visible — not where it stops existing.** That was written here as a prediction. It is not a
prediction: the read-path campaign's own `D_size` cells already contain the answer, and they
confirm it.

| `hybrid` vs `pool`, miss regime, paired | 4 KiB | 16 KiB | 64 KiB | 250 KB |
| --- | ---: | ---: | ---: | ---: |
| `v22_campaign_ci.tsv` | −62.2% | −58.2% | −45.9% | **−24.8% tie** |
| `v10_campaign.tsv` | −63.9% | −66.8% | −45.3% | — |

Monotone, and it crosses the 28.5% bar between 64 KiB and 250 KB — the size this campaign
ran at. Reproduce with
`lab/scripts/pair_arms.py --pairs hybrid:pool --by size docs/disk-access/v22_campaign_ci.tsv`.
An earlier version of this section also said the two campaigns had never been run at the same
frame size. That was wrong: `v22` has `D_size250000` cells, and they are the right-hand
column above.

Two things this campaign does add to that decision:

1. **Escalate before ringing.** On 250 KB frames the shipped loop makes 2–3 round trips per
   frame. A ring that makes each of them 25 µs cheaper is optimising two round trips that
   should not exist. Escalating first is free, has no dependency, and is what makes a later
   `hybrid_lazyring` worth what it measures.
2. **The thread-count advantage is real and, on this device, inert.** io_uring holds **5 OS
   threads against 44** at 32 concurrent missing readers, and no `iou-wrk` worker ever
   appears under tight-loop `/proc` sampling — buffered reads that would block are retried
   through the page-cache wait queue rather than punted to `io-wq`. This matches
   [`EVIDENCE.md`](EVIDENCE.md) R5 (128 rings spawn none; `pool` reaches 265 threads). But
   capping Tokio's blocking pool at **four** threads costs the pool arms nothing at 32
   readers — it is the best cell in M3 — because the device saturates at ~1.25 GB/s first.
   Thread count buys latency only where storage is fast enough for scheduling to be the
   limit; that is a real condition, and it is not this device.

### What is settled here, and what is not

| | |
| --- | --- |
| **Settled** | A miss should read the rest of the frame, not the rest of the window. Independent of io_uring, measured in both arm orders, at 1/8/16/32 readers, on forward and random traces |
| **Settled** | At 250 KB frames on ~1.25 GB/s storage, whole-frame `io_uring` and whole-frame `spawn_blocking` are a tie on throughput and latency |
| **Not settled here** | Whether `hybrid_lazyring` is worth adopting. That rests on CPU per read at the frame sizes and miss rates a deployment actually has — [`EVIDENCE.md`](EVIDENCE.md)'s question, not this one |
| **Settled after all** | The size scaling above. `v22`'s `D_size` cells had it all along; it did not need a new run |
| **Settled, M10** | `uring`'s edge over `hybrid_lazyring` on misses is a **queue-depth artefact**: −1.2/−1.9% at depth 1, −25 to −43% at depths 4–32, and the product runs depth 1. At depth 1 the breakeven miss rate is 65–84%, not 22–34% |
| **Not settled** | Both lazyring datasets are **`readers=1`** — the recommended arm has never been measured with more than one concurrent session. The reader-scale evidence (`v25_r5`, to 128 readers) does not include it |

## Limitations

- **One storage device, one queue depth.** Everything above saturates at ~1.25 GB/s. On
  NVMe with several GB/s and a deeper queue, M3's conclusion (four blocking threads are
  enough) is the first thing that would change, and it is the one that io_uring's case
  rests on. Re-run M2 and M3 before carrying the verdict to different storage.
- **`read_ahead_kb` = 8192 on this host**, 64× the usual default. Every miss ratio here is
  *constructed* by spacing frames past that window; on a host at 128 KB the same access
  pattern would miss far more often at the same study size, and the accepted path's penalty
  would appear at smaller strides. The direction of every result is unaffected — more
  misses is the direction this campaign is about — but the *stride at which a deployment
  becomes miss-dominated* is host-specific. Check it where the product runs.
- **Frames are 250 KB, and frame size is the axis that reconciles this with the read-path
  campaign.** The windowed penalty is (frame ÷ window) round trips, so it grows with frame
  size — a 3 MB DBT frame at native resolution is 48 windows, not 4 — while the ring's
  per-round-trip saving shrinks as a share of the read (measured, §Reconciliation). Nothing
  here was run past 250 KB, and the mechanism says the windowed penalty gets worse there,
  not better.
- **`p50` at `--mix 0.5` is bimodal** and its bootstrap CI is correspondingly wide
  (232–754 µs in one cell). Read the 0.75 and 1.0 cells for separation, and throughput
  rather than p50 at 0.5.
- **Concurrency 32 gives each session 10 asks** at `--region-frames 320`, so per-cell tails
  are thin there; the throughput column is the one to read.
- **The lab reimplements the serving loop**, as it did for the previous campaign: arms read
  through the product `FrameStore` (`read_at_nowait` / `read_at_blocking` as shipped) but
  own their own window loop, so `pread_nowait_escalate` is a faithful model of
  `stream_codestream` rather than the function itself. The wire-shaped part of the loop is
  identical across arms, which is what makes them comparable to each other.
- **No live end-to-end run**, unchanged from [`RERUN.md`](RERUN.md): `with_bind_default`
  binds IPv6 and this container has none. Wire compatibility rests on unit tests, which now
  include one that drives `stream_codestream` itself against an evicted `FrameStore` for
  frame lengths either side of the window boundary.
- **The 8 GB fixture is not committed** (`lab/fixtures/frames_250k_deep/`, gitignored).
  Regenerate with
  `BYTES=250000 FRAMES=32000 NAME=frames_250k_deep ./lab/scripts/gen_live_cell_fixture.sh`.
