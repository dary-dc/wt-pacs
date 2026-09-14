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

The pooler reporting VOID — fix the cell, do not raise the repeats. The null cell's arms
differing by more than 15 % (an instrumentation gap, not a loss effect).
