# T3 — The stream shape: one, a fixed pool, or one per frame

**Status:** measured — `shared` holds and `pool:k` is closed on every reading below · **Needs:** nothing further on this rig · **Size:** done

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

## The 0.5 % cell, 2026-09-15 — and its verdict

`docs/measurements/r2/t3-250k-l0.5`, six repeats, zero censoring and all 49 asks sent in every
repeat of every arm; no repeat carries the result (dropping the first moves the pooled p95 by
under 0.5 %).

| arm | pooled misses | p95 | median | vs `shared` | vs own null |
| --- | ---: | ---: | ---: | ---: | ---: |
| `shared` | 106 | 449.95 ms | 231.06 ms | — | +9.1 % |
| `per-frame` | 132 | 411.81 ms | 130.22 ms | **−8.5 %**, CI [−34.5, −0.1] | **−0.3 %** |
| `pool:2` | 290 | 544.07 ms | 341.40 ms | +20.9 %, CI [+3.2, +48.1] | +12.7 % |

**The rule's verdict: `shared` stays the default.** `per-frame` beats it, and its interval
excludes zero, but by 8.5 % against a bar of 15 %. `pool:2` is worse on both readings.

The mechanism is nonetheless visible where theory puts it. `per-frame` does not degrade at all
from its own null (−0.3 %) while `shared` degrades 9.1 %: a loss confined to one frame's stream
costs only that frame. So head-of-line blocking is real here and costs `shared` about 9 % of
its tail at 0.5 % loss — measured, and below the product bar. `per-frame` also carries *more*
positive waits (132 against 106) that are individually smaller, which is the same story: the
cost is spread rather than concentrated.

**Read with the caveat that has not gone away:** these p95s are over pools of 106, 132 and 290
samples, so each sits at a different depth of its arm's tail. That is the Phase C review's own
criticism of the estimator, inherited here deliberately rather than changed after seeing data.
`stranded_frames` is the corroborating signal and agrees: 3–13 for `shared` and `per-frame`,
25–29 for `pool:2`, every repeat.

### A prediction for the Gilbert–Elliott cell, recorded before it lands

`p 0.07 % r 14 %` puts the link in its bad state 0.50 % of the time in bursts averaging
7.1 packets — the same mean loss as the iid cell above, delivered differently. A 250 KB frame
is 172 packets, so iid scatters about 0.9 losses across every frame, while a burst lands inside
one frame and leaves its neighbours clean.

If `per-frame`'s advantage comes from confining a loss to the frame that suffered it, then
**bursts should favour it more than scattered loss does**: the same bytes lost, concentrated,
means fewer frames damaged but each damaged worse, and only the shared stream makes the
undamaged frames wait behind them. So `per-frame`'s margin over `shared` should be **larger**
in this cell than the 8.5 % it managed at iid 0.5 %. If it is the same or smaller, the
confinement story is wrong and the 0.5 % margin needs another explanation.

The probe reported a third, independent corroboration of the pool's cost while setting the
cell up: saturated frame rate **3.50/s for `pool:2` against 4.25/s** for both other arms, 18 %
less throughput on a measurement that has nothing to do with the latency pools.

### The bursty cell falsified the prediction — and said something else

`docs/measurements/r2/t3-250k-ge`, same 0.5 % mean loss as the iid cell, delivered in bursts of
about 7 packets:

| arm | pooled misses | p95 | vs `shared` | vs own null |
| --- | ---: | ---: | ---: | ---: |
| `shared` | 47 | 601.15 ms | — | +45.8 % |
| `per-frame` | 47 | 613.37 ms | +2.0 %, CI [−41.5, +71.0] | +48.5 % |
| `pool:2` | 289 | 502.31 ms | −16.4 %, CI [−42.3, +19.0] | +4.0 % |

**At six repeats the prediction appeared falsified** — `per-frame`'s margin read +2.0 % here
against −8.5 % under iid — and this file said so. **At eighteen repeats it reads −21.7 %**, the
direction the prediction named. Neither number is a result: the interval spans zero in both
cells, and the per-repeat rows say why.

| arm | all-step p95 per repeat, 18 runs |
| --- | --- |
| `shared` | 63 · 64 · 64 · 64 · 65 · 65 · 65 · 65 · 65 · 65 · 71 · 153 · 154 · 273 · 275 · 325 · 361 · 439 |
| `per-frame` | 64 · 64 · 64 · 64 · 64 · 64 · 64 · 65 · 65 · 65 · 119 · 153 · 154 · 180 · 277 · 279 · 279 · 415 |
| `pool:2` | 483 × 15 · 621 · **26 431** · **26 431** |

`shared` and `per-frame` are the same distribution to the eye: ten quiet runs at 64–65 ms and
eight that a burst reached, with `shared`'s worst somewhat worse. Their **median of per-run p95
is 65 ms each** — a dead heat — while pooling every wait gives −21.7 %. Two defensible
estimators, opposite readings, neither interval excluding zero: by this lane's own standard
that is not a finding, and **the prediction is untested rather than falsified**. Declaring it
falsified from six repeats was premature, and declaring it confirmed from eighteen would repeat
the mistake in the other direction.

What eighteen repeats does establish is about the pool. `pool:2` sits at exactly 483 ms in
fifteen runs — its deterministic interleaving cost — and then **collapses to 26 seconds in two
of eighteen**. It is not merely slower; it fails outright about one run in nine.

Two cautions against over-reading the falsification. Every interval here spans zero, so no arm
separates. And the cell is thin: 47 pooled misses against the iid cell's 106, because bursts
damage fewer frames at the same mean loss — which is a property of the loss model, not of the
arms, and means **a Gilbert–Elliott cell needs two to three times the repeats of an iid cell to
carry the same power**. That is the cell to re-run, not a conclusion to draw.

**What the cell does support, and it is not about stream shape.** Both `shared` and `per-frame`
degrade **45–49 %** from their own nulls under bursts, against +9.1 % and −0.3 % under scattered
loss of the same mean rate. The same 0.5 % costs five times as much tail when it arrives in
bursts. For a target stated as a radio link that is the more consequential number on this page,
and it points at [`T2`](T2-controller.md) — how the controller reads a burst — rather than at
stream shape.

### A 3.5× throughput claim, and its retraction the same hour

Setting up the 2 % cell, a **single 4 s** saturation probe per arm read `shared` 1.00 frames/s,
`pool:2` 1.50 and `per-frame` 3.50, and this file recorded it as the campaign's largest effect:
head-of-line blocking turning from a tail cost into a 3.5× capacity ceiling.

**It was noise.** Repeated — three probes, 10 s each — the same cell reads:

| arm | 1 × 4 s dwell | median of 3 × 10 s | the three |
| --- | ---: | ---: | --- |
| `shared` | 1.00 | **1.90** | 1.50 · 1.90 · 2.70 |
| `pool:2` | 1.50 | 1.20 | 1.20 · 1.20 · 1.60 |
| `per-frame` | 3.50 | 1.70 | 1.50 · 1.70 · 2.40 |

`per-frame` against `shared` was 3.50×; it is 0.89×. The ordering reverses and the ranges
overlap almost entirely — 1.5–2.7 against 1.5–2.4. **At 2 % loss these arms do not differ
measurably in sustained throughput**, on the evidence available.

The 4 s dwell counted 4, 6 and 14 frames. A count of 4 quantises to 25 %, and the note that
recorded the claim said so and drew the conclusion anyway, on the grounds that quantisation
cannot manufacture a 3.5× gap. That was the error: quantisation cannot, but a single sample of
a high-variance quantity can, and at 2 % loss the variance is most of the signal.

What caught it was the probe becoming a repeated measurement — a change made in the same commit
that published the claim, for unrelated reasons.

### The estimator was flattering the pool, and one cell's headline reverses

The pre-registered metric pools **positive waits only**. When arms miss at very different rates
that compares one arm's bulk against another's tail: in the bursty cell `shared` contributed 47
samples and `pool:2` 289, so `shared`'s 90 % of instant steps were discarded and only its worst
47 were set against `pool:2`'s typical ones. That is the Phase C review's criticism, inherited
into this campaign deliberately and flagged at every reading.

Re-read with **every step, zeros included, so each arm brings the same 486 samples**:

| cell | `pool:2`, miss-only | `pool:2`, all steps | `per-frame`, miss-only | `per-frame`, all steps |
| --- | ---: | ---: | ---: | ---: |
| null | +17.1 % | **+74.9 %** | +0.2 % | +0.1 % |
| 0.5 % iid | +20.9 % | **+69.2 %** | −8.5 % | −7.0 % |
| bursty | **−16.4 %** | **+73.5 %** | +2.0 % | +0.1 % |

**The bursty cell's `pool:2` win was an artifact**: −16.4 % becomes +73.5 %. Its mean wait across
all steps is 197–217 ms against 27–49 ms for the other two, about seven times worse, and it
strands 24–26 frames per run against 2–6.

`per-frame` against `shared` moves by at most 1.5 points under either estimator, so **the
decision the rule governs is unchanged** — and that is the reason to trust this correction
rather than suspect it: the arm the campaign is actually deciding on reads the same either way,
while the arm that was being flattered gets worse, not better.

**But its interval does change, and it matters.** At 0.5 % iid, `per-frame`'s miss-only CI is
[−34.5, −0.1] — excluding zero by a hair — while its equal-N CI is **[−23.8, +2.9]**, which
spans it. So the −7 to −8.5 % is a favourable point estimate that is **not distinguishable from
no difference**. An earlier note in this file called it a win below the bar; it is not
established as a win at all. `pool:2`'s intervals exclude zero everywhere and comfortably:
[+34.1, +85.1] at 0.5 % iid, [+59.8, +215.7] bursty.

The honest summary of the three 250 KB cells is therefore: **`per-frame` and `shared` are
indistinguishable at every loss level tested, and `pool:2` is decisively worse than both.**

The pooler now prints both, with a warning when the miss counts differ by more than 2×. The
pre-registered rule is still stated on `miss_p95`; `all_p95` is what to read when they diverge.

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

## HOL1 — in Chromium, through the relay (2026-09-25)

Queue row 78. The rig campaign above was native; this asks the same question of a browser, for
an owner who will use the pool's answer to decide whether another stack moves from one shared
stream to K persistent ones. `lab/stream-shape/`.

**What was ported.** `pool:k` and per-frame ask-order priority were built on
`claude/per-core-endpoints` and never reached this tree; both are here now. The pool also takes
ask-order priority: each stream takes the rank of the frame just dealt to it. That is exact only
while a stream holds one unsent frame, true of a run of asks at `D_min < k` and false of a fill,
where a stream still sending frame `n` is demoted when frame `n + k` is dealt to it. Priority is
per stream in QUIC, so K persistent streams cannot carry per-frame order: that is a property of the
shape, not of this build.

**The rig.** 20 Mbit, 40 ms each way, a 200-packet queue (`link_impair.py`); Cubic; 128 KB frames,
so the ask window's formula puts `D_min` at 3 and the arms are not byte-identical. Per run: a fresh
release server and relay, the raw TS client, a fill of 40 frames, then 30 asks outside it with the
arm's `D_min` outstanding. Arms `shared`, `per-frame`, `pool:2`, `pool:4`, `pool:8`, rotated every
round. Cells: 0 %, 1 % and 3 % iid, and Gilbert–Elliott at the relay's default (0.5 % mean, bursts
of ~7 packets).

### Decision rule, fixed before the first run

Written and pushed before any campaign run; the one run before it was a 10-frame harness check.

1. **`D_min` per arm.** Asks alone at depths 1–6, no loss, 3 rounds: the smallest depth whose
   median asks/s is within 95 % of the arm's best. Every later cell runs each arm at its own.
2. **Metrics.** *All received*: fill frames and asks delivered of those owed. *The fill's gap*:
   the wait between consecutive frames for an in-order viewer (frame `i` shows once `0..i` have
   landed), pooled over 7 rounds × 39 gaps = 273 samples, nearest-rank p50 and p95 (p95 is about
   the 14th largest). *An ask's latency*: send to arrival, pooled over 7 × 30 = 210 samples (p95
   about the 11th largest). Each run's own p95, paired with `shared`'s in the same round, gives the
   rounds won.
3. **The control.** At 0 % every arm must receive everything, and `per-frame` must sit within 15 %
   of `shared` on both p95s — those two carry no baseline difference, so a gap between them is the
   instrument, and no loss cell is read until it closes. A pool outside 15 % at 0 % has a cost of its
   own: it is reported, and that arm's loss cells are read against its own control, as the ratio
   loss p95 / control p95 against `shared`'s.
4. **A verdict per lossy cell and arm.** *Worth it*: pooled p95 at least 20 % under `shared`'s and
   the run's own p95 under `shared`'s in at least 5 of 7 rounds, everything received. *Costs*: the
   same the other way. Otherwise *no separation*.
5. **The owner's question.** K persistent streams are worth moving to if some `pool:k` is *worth it*
   on the fill's gap or on asks in at least two of the three lossy cells, and passes its control or
   stays worth it against its own. Otherwise not, on this evidence.
