# T3 — The stream shape: one, a fixed pool, or one per frame

**Status:** three arms built, none measured on a fair cell · **Needs:** the cloud rig · **Size:** one rig day

## Question

One stream for everything holds every later frame behind one lost packet. Per-frame streams
with FIFO scheduling lost **5.76×** at 250 KB on the real path, and the mechanism was named:
quinn's `retransmit()` re-queues a lost stream behind *every* stream already pending, so the
recovery waits behind the other frames' full backlogs
([`../transport/transport-conclusions.md` §2](../transport/transport-conclusions.md)). That
verdict stands, twice confirmed, and `shared` is the default because of it.

Two things change the retransmit's backlog, and they are independent:

* **Ask-order priority** — `per-frame` now ranks each stream below the frames asked before it,
  so a retransmit precedes newer frames' data rather than trailing it.
* **A fixed pool** — `pool:k` deals frames round-robin over `k` long-lived unis, so the
  backlog a retransmit waits behind is bounded by `k − 1` streams rather than by every frame
  in flight.

The pool had never been built, so nothing in the record discards it. The priority arm has been
measured only at 32 KB, where it is inside noise at the decision cell — pooled CI
**[−7.3 %, +26.3 %]** at 0.5 % loss, and the one tight cell is **+1.5 %, CI [+0.6, +5.1]**, an
order of magnitude under the bar. Its one clean win (−28.5 % reader lateness at 2 % loss) sits
in a regime where the lane's own reader model has already failed. The Phase C review's reading
is that this is **cell selection, not a repeat count** — which is what this plan changes.

## The validity condition, before anything else

**The arms are byte-identical when one frame is in flight.** At depth 1 the server has one
frame's data to send and opens or uses one stream; `shared`, `pool:k` and `per-frame` then do
the same thing. A cell at depth 1 measures nothing here, however much loss it carries.

So this campaign lives at `D_min > 1`, which the formula puts at 32 KB and 250 KB on a 10 Mbit
link, and its result does **not** transfer to the mammography and tomosynthesis sizes, where
`Tf ≫ RTT` makes `D_min` 1. For those, the shape question reopens only once T4's prefix
delivery puts a frame's tail on the wire beside the next frame's prefix — and then per-frame is
required anyway, because `RESET_STREAM_AT` abandons a tail per stream.

## The null cell, measured 2026-09-15

`docs/measurements/r2/t3-250k-l0`, six repeats, 250 KB, depth 2, 10 Mbit / 60 ms, no loss:

| arm | pooled misses | p95 | median | vs `shared` |
| --- | ---: | ---: | ---: | ---: |
| `shared` | 74 | 413.24 ms | 202.66 ms | — |
| `per-frame` | 87 | 416.62 ms | 203.58 ms | +0.8 %, CI [−17.3, +22.5] |
| `pool:2` | 289 | 482.86 ms | 321.37 ms | **+16.8 %, CI [+16.5, +41.4]** |

`per-frame` against `shared` is inside noise, which is what makes the cell sound. `pool:2` is
worse, with a confidence interval excluding zero, **at zero loss** — where there is no
retransmit deferral for a pool to bound. So this is the arm's own cost, not a loss effect, and
it is the shape `send_fairness(true)` already showed
([`../transport/transport-conclusions.md` §2](../transport/transport-conclusions.md)): two
equal-priority streams round-robin, so two frames interleave where a shared stream would
serialise one and then the other, and both finish late instead of the first finishing early.

**Replicated 2026-09-15**, on a second cell with the warm-up discarded (cache-hit spread 0.04
against the first cell's, which was warm by luck): `per-frame` +0.2 %, CI [−17.2, +21.0];
`pool:2` **+17.1 %, CI [+16.9, +41.5]**. The two cells agree on the pool's cost to within
0.3 points. `pool:2` also stranded exactly 25 of 49 frames in **every repeat of both cells**,
against 3–4 for the other two arms — a deterministic structural cost, not a sampled one.

**Consequence for the reading:** `pool:k`'s loss cells are compared against **its own** null
p95 (`stream_shape_pool.py --null`), never against `shared` directly, or the scheduling cost
rides into the difference. **Falsifiable prediction**, to be checked when run 2 lands: if
interleaving is the mechanism, `pool:4` at 32 KB pays a larger null-cell cost than `pool:2`.
If it does not, this reading is wrong and the cause is elsewhere.

### The 0.5 % cell of 2026-09-15 decided nothing, and why

`docs/measurements/r2/t3-250k-l0.5` passed every void check it was given and was still
worthless. Its pooled p95 rested on the first repeat alone:

| arm | pooled p95, six repeats | r1 excluded |
| --- | ---: | ---: |
| `shared` | 20 922.6 ms | **412.2 ms** |
| `per-frame` | 2 953.8 ms | **709.2 ms** |
| `pool:2` | 513.7 ms | 513.8 ms |

The ordering reverses: with r1 in, `shared` is 50× the worst arm; with it out, `shared` is the
best. r1 is a cold page cache — hit rate 0.28–0.30 against 0.70–0.84 in the later repeats —
and the cell had no discarded warm-up, so it pooled two regimes and read the difference as
stream shape. `pool:2` looked immune only because it is slow enough not to notice.

The cell now discards one pass per arm, and a cache-hit spread above 0.25 within an arm voids
it. The null cell above was unaffected: it was itself a re-run, so its page cache was already
warm throughout (spread 0.07–0.11), which is why its reading stands.

### And the 2 % cell voided for a third reason

`docs/measurements/r2/t3-250k-l2`: every arm censored 5–33 % of waits and sent under half the
trace's asks. Not a defect in the arms — **at 2 % loss the 10 Mbit link carried 2.5–4.3 Mbit**,
Cubic's response to loss, and the step interval had been derived from the label rather than
what the link achieved, so the reader over-demanded by about 2×. Goodput was within noise
across the three arms, which is itself the only reading that cell supports.

The interval is now measured, not computed: the discarded pass runs in `saturate` mode, which
holds `DEPTH` asks in flight and reports the frame rate the link sustains, and the interval is
`HEADROOM` times that. One interval for every arm, from the reference arm's probe, or the arms
are not comparable. This makes the cell self-adapting to loss, rate and controller — the three
things that made the label wrong.

## Decision rule, fixed before the run

Pooled miss samples, the estimator N11 asked for and `stream_shape_pool.py` implements — never
median-of-p95, which inverted the slope last time on the same rows.

An arm replaces `shared` as the default only if, at 0.5 % loss, its pooled miss p95 beats
`shared` by **more than 15 %** with a bootstrap CI excluding zero, **and** the 0 % null cell has
the arms inside 15 % of each other. Otherwise `shared` stays the default and the arm stays a
flag. Reader lateness is reported beside every row and never substitutes for the p95.

If `pool:k` and `per-frame` both clear the bar, the simpler wins: `pool:k` reuses streams and
costs no `open_uni` per frame.

## Steps

1. **The cells.** `lab/scripts/stream_shape_cells.sh <out> <server> <harness>`, six repeats,
   arm order reversed every repeat. Two sizes, each at its own `D_min`:
   `FX=frames_250k DEPTH=2 ARMS="shared pool:2 per-frame"` and
   `FX=frames_32k DEPTH=4 ARMS="shared pool:2 pool:4 per-frame"`.
   Loss 0 / 0.5 / 2 % iid and 0.5 % Gilbert–Elliott, at 10 Mbit / 60 ms.
2. **The reading.** `lab/scripts/stream_shape_pool.py <out>` per cell. It refuses a cell whose
   reference arm pooled fewer than 20 misses, whose reader never met its schedule, or which
   served from cache — those are the failures that produced the last campaign's non-result.
3. **The browser arm** of the winning cell via `browser_cell.py`, to see whether Chromium's
   uni-stream credit ever blocks `open_uni` on the server
   (`anticipatedConcurrentIncomingUnidirectionalStreams` is the client's answer if it does).
4. If an arm applies: default flip, `transport-conclusions.md` §2 extended with the corrected
   reason, and the WASM client checked for out-of-order delivery.

## Report

Per cell: the pooler's table (arm, runs, pooled misses, p95, median, delta, CI) and reader
lateness beside it. JSONs and tables under `docs/measurements/r2/`.

## Stop conditions

The pooler reporting VOID — fix the cell, do not raise the repeats. `per-frame` and `shared`
differing by more than 15 % in the null cell: those two carry no baseline difference, so a gap
there is instrumentation and nothing downstream can be attributed to loss. A null-cell gap on
`pool:k` is not a stop — it is the arm's own cost, divided out by `--null`.
