# Window saturation and miss cost — the experiments that remain

**Status:** design + **first focused run 2026-08-26** (RTT≈0) · **Date:** 2026-08-26
**Replaces:** `window-depth-and-priority-experiment.md` (deleted — it swept arms for a mechanism
rejected in [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md))

> **Status (2026-08-26):** E4 premise gate **not yet answered**. The RTT≈0 run is a floor control only
> (oracle→D=1 was guaranteed). Decision rule: oracle must beat random by **≥100 ms at p95** under
> netem RTT 20/60/150 ms — see [`implementer-handoff-2026-08-26.md`](implementer-handoff-2026-08-26.md) §3.
> E1/E2 at RTT≈0 remain **not tested** (formula collapses; `(D−1)·Tf=0` at D=1).


---

## 0. What is actually still open

Server ordering and cancel are both closed. What is **not** closed is the arithmetic the entire client
window design rests on:

```
D_min = ceil( U × (1 + RTT / Tf) )        Tf = time to send one frame, U ≈ 0.95
```

That is a model. If the real transport needs depth 4 where it predicts 2, every number downstream
changes. Three experiments, in priority order.

---

## 0b. Precondition — the condition that makes any of this measurable

**Added 2026-08-26 after two null runs. This was missing from the original spec and is the reason both
produced no signal.**

A cache miss can only happen when the reader **outruns the link**. If the link delivers frames faster
than the reader consumes them, the cache is always ahead, every wait is 0, and `D` cannot matter no
matter how the grid is swept.

```
reader demand  =  reader speed (frames/s) × frame bytes
must exceed
link supply    =  configured link rate
```

### Dead vs live cells

| fixture | link | link delivers | reader wants | verdict |
| ------- | ---- | ------------- | ------------ | ------- |
| 51 KB | 5 Mbps | 12.0 f/s | 9 f/s | **dead** — link faster than reader |
| 51 KB | 1 Mbps | 2.4 f/s | 9 f/s | live |
| 250 KB | 10 Mbps | 4.9 f/s | 9 f/s | **live, ratio 1.8** ← primary |
| 250 KB | 25 Mbps | 12.2 f/s | 9 f/s | dead |

**Every group in every experiment must be run in a live cell.** Report the demand/supply ratio
alongside every result; a result from a dead cell is not a null, it is not a measurement.

This is also the product's stated target regime — low bandwidth, large studies — so it is where the
numbers should come from anyway.

### Trace requirements

`fly_and_settle` has `frame_modulo: 3` — three unique frames. Once cached, everything is a hit. It
cannot test depth, **and it could not have tested cancel either** (see the caveat in
[`adr-reject-server-cancel.md`](adr-reject-server-cancel.md)).

The replacement trace must have:

| | |
| - | - |
| **≥ 300 unique frames** | no modulo, no small cycling set |
| **`max_step = 1`** | scroll-only. Established reader behaviour; no jump affordance exists |
| **Sustained traversal at ~9 frames/s** | fast enough to outrun the link in a live cell |
| **A reversal at ~60% through** | the miss-generating event E2 needs |
| **Long enough to reach steady state** | the first few frames are cold-start, not the regime under test |

---

## 0c. Harness defects found 2026-08-26 — all three produced convincing nulls

Three campaigns reported "formula not validated". None of them measured the formula. Fixed in
`lab/window-harness` and `lab/scripts/`.

| # | Defect | Effect |
| - | ------ | ------ |
| 1 | `ask_frame` slept `RTT/2` **inline**, and every caller awaited it in a loop | Issuing `D` asks took `D × RTT/2` ms. Asks were never simultaneously in flight. `D` was a counter with no wire meaning |
| 2 | `LinkPacer::consume_bytes` held its mutex **across the sleep** | Only one uni stream could read at a time. Concurrent delivery impossible by construction |
| 3 | `e1_saturation_sweep.sh` started the server with `>/dev/null 2>&1` | A failed bind was **silent**. The `frames_250k` cells were served by the *`queue_large`* server — reported `per_frame_bytes` was 51,004 against a 250,000-byte fixture |

Defects 1 and 2 pinned measured utilisation at the `D`=1 value for every depth. That is the flat
**0.408** in the old tables: for 51 KB at 10 Mbps and RTT 60, `Tf/(Tf+RTT) = 40.8/100.8 = 0.405`. It was
never a result — it was the only number the harness could produce.

Defect 3 is what earlier reports called *"identical util matrices — metric artifact."* Not an
artifact; the wrong server.

### Defect 4 — simulated RTT is inert in shared-stream mode

Found 2026-08-26 while adding `--shared-stream`. Measured at `D`=1, 250 KB frames, 10 Mbps
(`Tf` = 200 ms):

| RTT | measured util | correct |
| --- | ------------- | ------- |
| 0 | 1.000 | 1.000 |
| 60 | **1.000** | 0.77 |
| 150 | **1.000** | 0.57 |
| 400 | 0.333 | 0.333 |

**`--rtt-ms` has no effect until RTT exceeds the frame time.** Below that it is invisible; above it, it
is exact. The mechanism is **not established** — two earlier mechanism guesses in this campaign were
wrong, so this one is recorded as an observation only.

**Consequence: depth cannot be measured on shared-stream mode with `--rtt-ms`.** It needs `tc netem` —
but **not** root and **not** the cloud host:

```bash
unshare --user --map-root-user --net -- bash
ip link set lo up
tc qdisc add dev lo root netem delay 30ms rate 10mbit   # loopback traverses once per direction → RTT 60
# run server and harness inside this shell; disable the in-process pacer with --read-bps 0
```

Verified working on Fedora 2026-08-26; `ping` confirmed 60.3 ms RTT. The cloud host is still wanted for
**loss** emulation and a real-path check, but it is no longer a prerequisite for depth numbers. Per-frame mode does not show this, which is itself the
point — a harness property that holds in one architecture and not the other is exactly why local
emulation cannot be trusted across a design change.

### Guards now required

| | |
| - | - |
| **`peak_outstanding`** | highest concurrent ask count actually observed, recorded per run. **If it is below `D`, the run is void.** This is the invariant defects 1 and 2 violated |
| **Frame-size assertion** | compare observed bytes-per-frame against the fixture's declared size. This is what exposed defect 3. Note fixtures with *variable* frame sizes (`queue_large`) need a tolerance, not equality |
| **Never discard server output** | a silently failing server is indistinguishable from a slow one |
| **Fresh port per cell** | do not rebind the same port across studies |
| **`--rtt-ms` is per-frame-mode only** | in shared-stream mode use `tc netem`. Any shared-stream depth number taken with `--rtt-ms` below the frame time is void |

---

## 1. E1 — does `D_min` saturate the link?

**The load-bearing question.** Everything in the client window design assumes it does.

### Groups

| Group | Setting | Purpose |
| ----- | ------- | ------- |
| Treatment | `D` = 1, 2, 3, 4, 6, 8, 16 | the curve |
| **Ceiling control** | `D` = 64 | establishes maximum achievable throughput. **Without it you cannot tell whether `D_min` reached the ceiling or merely a plateau** |
| **Floor control** | `D` = 1 | un-pipelined baseline. Predicted utilisation `Tf/(Tf+RTT)`. If the measurement disagrees here, the model is wrong before the sweep starts |
| **Null control** | link capped far above demand | throughput must be **flat across all `D`**. If it varies, something other than pipelining is limiting and the run is invalid |

### Axes

`U` fixed at 0.95 · `Tf` via frame size (~32 KB, ~51 KB, ~250 KB) · RTT via netem (0, 20, 60, 150 ms) · link rate 1–300 Mbps

### Metric

Delivered throughput as a fraction of the configured link rate.

### Pass condition, fixed in advance

Measured `D_min` — the smallest depth reaching **95% of the ceiling control** — is within **±1** of
predicted, at every (frame size, RTT) point.

If it is consistently higher, the client must size depth from a measured curve rather than the formula,
and ADR-0006 needs a correction. If it is consistently *lower*, the transport is buffering more than
one frame and §3 of the ordering ADR needs re-reading.

---

## 2. E2 — what does a cache miss actually cost?

The residual the design accepts: on a miss the reader waits behind `D − 1` outstanding asks.
Predicted `(D − 1) · Tf`. We accepted it analytically; measure it once.

### Groups

| Group | Setting | Purpose |
| ----- | ------- | ------- |
| Treatment | `D` = 1…8 on `traces/reversal_storm.json` | the curve |
| **Floor control** | `D` = 1 | minimum possible miss cost — just the in-flight frame, ≈ `Tf/2` |
| **No-miss control** | same depths on `traces/fly_and_settle.json` | isolates the reversal from baseline latency |
| **Warm-cache control** | reversal trace, cache pre-filled | miss cost must be ≈ 0. Confirms the metric measures a miss and not something else |

### Metric

**`recovered_ms` — reversal → the wanted frame is _displayable_.** Not first byte.

> **Changed 2026-08-26.** One uni stream per frame means QUIC can **interleave** them: the wanted
> frame's first byte can arrive while earlier frames are still draining, so a first-byte metric looks
> good while the frame completes no sooner. You cannot show a partial frame. First-byte would also make
> E2 incomparable with E4, which measures displayable.

### Pass condition

Treatment tracks `(D − 1) · Tf` within 20%, and the warm-cache control is ≈ 0. A non-zero warm-cache
control invalidates the metric, not the design.

---

## 3. E3 — cold-page I/O

Independent of everything above. Three real options; no measurement exists.

### Groups

| Group | Setting |
| ----- | ------- |
| Treatment | mmap + `MADV_WILLNEED` · `pread` on a blocking pool · io_uring |
| **Warm control** | page cache hot — the floor. Any arm near it is good enough |
| **Naive control** | plain mmap, no advice — what we have today |

> **The arms are not on equal footing, and the spec must say so.** `MADV_WILLNEED` needs to know which
> frame comes next. The server is now a serial loop — it reads one ask at a time and has no lookahead,
> so it cannot issue a useful hint beyond the frame it is already serving. Judge that arm on what it
> can actually do here, not on what it could do with a queue.
>
> Study bundles lay frames out sequentially, so kernel readahead should cover forward scrolling on its
> own. **Expect cold-page cost to appear on reversal, not on traversal** — the trace must contain one.

### Metrics — two, and the second is the one that matters

| | |
| - | - |
| `frame_slice` latency, p50 / p99 | the obvious one |
| **Runtime stall** | a page fault is **not** an await. It blocks the OS thread and every task sharing it. Latency on one frame can look fine while the runtime is stalling for everyone |

Measure stall directly (e.g. a heartbeat task recording scheduling delay), not by inference from
frame latency.

---

## 3b. E4 — does the formula actually pick the right `D`?

E1 and E2 measure the two halves separately: throughput, then miss cost. **The formula is a trade-off
between them, so neither test validates it.** Sweeping `D` and picking the best is fitting, not
testing. E4 tests whether the *predicted* `D` is the *optimal* `D`.

### Objective — one number combining both halves

`mean_wait_ms` — across a full trace, mean time from *reader wants frame N* to *frame N displayable*.
Cache hits count as 0. This is the only metric that prices link idle and miss cost on the same scale.

### Groups

| Group | Setting | Purpose |
| ----- | ------- | ------- |
| **Formula** | `D` from `ceil(U × (1 + RTT/Tf))`, recomputed live | the treatment |
| **Oracle control** | best `D` found by exhaustive sweep, chosen with hindsight | **the ceiling.** If the formula lands within noise of it, the formula is validated. If it is far off, the formula is wrong *even when E1 passes* |
| **Shallow control** | `D` = 1 | responsiveness-only extreme |
| **Deep control** | `D` = 8 | throughput-only extreme |
| **Random control** | `D` drawn uniformly 1–8 per session | **tests the premise.** If random ≈ formula ≈ oracle, `D` does not matter and [`adr-client-window-depth.md`](adr-client-window-depth.md) is over-engineering |

The random control is the one that can kill the whole design. It should be run first.

### `U` sub-sweep — and the trap that would void it

`U` ∈ {0.80, 0.90, 0.95, 1.00}, formula arm only.

**Once an objective is fixed, `U` is measurable, not merely a policy.** `mean_wait_ms` already prices
link idle and miss cost on the same scale, so sweeping `U` and taking the minimum *is* finding the
optimum. What stays a policy is the **choice of objective** — a mean weights every wait equally, and a
p95 or a never-exceed-500 ms target would select a different `U`. Report the mean and p95 side by side
so that choice stays visible instead of buried.

> **The trap.** `D` is an integer, so `U` only changes anything when `U·x` and `x` fall on opposite
> sides of an integer, where `x = 1 + RTT/Tf`. That happens only when `x` sits **just above** an
> integer. At `x = 1.3` (a 250 KB frame, 60 ms RTT, 10 Mbps) every `U` in the sweep yields `D = 2` and
> the result is a null by construction.
>
> **This is the same error that produced the 0-of-100 cancel result** — measuring a parameter at the
> one point where it is defined to do nothing. Place `(RTT, Tf)` pairs deliberately at `x ≈ 1.02`,
> `2.05`, `3.05` so `U` can actually move `D`, and report which points those are.

**Outcome with teeth:** if `mean_wait_ms` is flat across `U` **at points where `U` changes `D`**,
remove `U` from the formula. It prices a trade; if the trade does not show up in the objective, it is
decoration.

**Second question the sweep answers:** is the optimal `U` *stable* across traces and link rates? A
stable optimum ships as a constant. An optimum that moves means `U` is standing in for something that
should react — most likely the cache hit rate — and the formula needs rethinking, not retuning.

### Cross-validation

Choose any parameter on `fly_and_settle`, then report on `reversal_storm` and `dense_scrub`
**without re-tuning.** A formula tuned per trace has learned the trace, not the system.

---

## 3c. E5 — how wrong can the estimators be?

`D` needs live RTT and live `Tf`. Neither estimator is designed yet. **Measure the sensitivity before
designing them** — it says how precise they must be, which is otherwise a guess.

`Tf` in particular cannot be exact: HTJ2K compression varies per slice, so frame size varies within a
series.

### Groups

| Group | Setting |
| ----- | ------- |
| Treatment | RTT fed to the formula scaled by ×0.5, ×0.75, ×1.5, ×2 |
| Treatment | `Tf` fed to the formula scaled by ×0.5, ×0.75, ×1.5, ×2 |
| **Truth control** | exact RTT and `Tf` — the floor |
| **Blind control** | fixed `D` = 2, no estimation at all | 

### What the answers mean

| Result | Consequence |
| ------ | ----------- |
| `mean_wait_ms` flat under ±50% error | Estimators can be crude. Large design saving — take it |
| Degrades sharply | Estimator accuracy is load-bearing and must be designed carefully |
| **Blind control ≈ truth control** | Stop estimating. Ship a constant and delete the machinery |

---

## 3d. E0 — does netem tell the truth?

**Cheap, and it validates the entire rest of the campaign. Run it early, not last.**

Every other number here comes from an emulated link. If the emulation is wrong, all of them are wrong
together and nothing downstream reveals it.

| Step | |
| ---- | - |
| 1 | Run the harness against the cloud host over the **real path, unshaped**. Record actual RTT and achieved throughput |
| 2 | Run the same trace locally under **netem configured to those measured values** |
| 3 | Compare `mean_wait_ms` (mean and p95) |

| Result | Meaning |
| ------ | ------- |
| Within ~15% | The netem grid is trustworthy. Proceed |
| Diverges | **Stop.** netem is not reproducing this transport's behaviour, and every emulated result needs re-reading before it is quoted |

Clocks are not an issue: `mean_wait_ms` is measured entirely client-side, end to end, so nothing is
subtracted across machines.

---

## 3e. E6 — one stream per frame, or one stream per session?

**This now gates the depth numbers, not just head-of-line.** Depth results measured on one stream
layout do not describe the other, so E1/E2/E4 cannot be finalised until this is settled.

### Why it is open

wt-pacs opens **one uni stream per frame**. The viewer integration target opens **one stream per
endpoint** — a single shared stream. The reason for per-frame streams is head-of-line avoidance: on a
shared stream one lost packet stalls everything behind it until retransmitted.

### Why the benefit is smaller than it looks

Two factors multiply, and both are small:

| | |
| - | - |
| **Loss** | On a clean link the two designs are identical. The difference exists only under loss |
| **Out-of-order demand** | During a scroll you want frames **in order anyway**. If frame N stalls, finishing N+1 first does not help — you cannot show N+1 before N in a stack. The benefit appears only when the reader reverses or jumps |

So the real quantity is **loss × out-of-order demand**, not raw head-of-line probability.

### What is at stake

Per-frame streams in the viewer means restructuring around endpoints — substantial work.
**The valuable outcome of this experiment is the negative one:** if the shared stream is within noise
at target loss rates, the viewer keeps what it has, per-frame streams get an ADR rejecting them, and
that investigation never happens.

### Groups

| Group | Setting | Purpose |
| ----- | ------- | ------- |
| **A** | one uni stream per frame (today) | treatment |
| **B** | one shared uni stream, frames back to back | treatment — new server flag |
| **Clean-link control** | both arms at **0% loss** | A and B must land within noise. **If they differ at 0% loss, something other than head-of-line is driving it and the run is invalid** |
| **In-order control** | pure forward scroll, no reversal | tests the claim above. Head-of-line should buy little or nothing here |
| **Out-of-order treatment** | reversal trace | where the benefit should appear, if anywhere |

### Axes

Loss 0 / 0.1 / 0.5 / 1% via netem · depth 1–8 · fixtures 250 KB and 51 KB · RTT 60 ms

Loss requires `tc`, so this runs on the cloud host.

### Decision rule, fixed in advance

| Result | Consequence |
| ------ | ----------- |
| B within **100 ms p95** of A at ≤ 0.5% loss | **Reject per-frame streams.** Write the ADR; the viewer keeps one stream; the endpoint restructuring is cancelled |
| A beats B by > 100 ms p95 at target loss | Per-frame streams are worth the work. Size the effort before committing |
| A and B differ at **0% loss** | Invalid run — a confound is present. Find it before interpreting anything |
| Benefit appears only in the out-of-order arm | Correct and expected. Weight it by how often readers actually reverse, not by how often packets are lost |

### Prerequisite — remove a known confound first

The in-process `LinkPacer` takes a mutex on every 16 KB chunk, so concurrent readers contend. That
confound scales with **stream count**, which is exactly the variable under test here. **Shape with `tc`
and disable the in-process pacer before running E6**, or arm A is penalised by the harness rather than
by the transport.

This also settles the open question from §1: whether the 51 KB / 150 ms shortfall is transport
behaviour or pacer contention. If it disappears under `tc` shaping, it was the harness.

---

## 4. What invalidates a run

Beyond the invariants in [`queue-and-hol-harness.md`](queue-and-hol-harness.md) §5:

- Any null control that is not flat
- Any warm control that is not ≈ 0
- A `D` sweep run without the ceiling control — a plateau is not a ceiling

---

## 5. Deliberately not in this document

- **Head-of-line / multi-stream (Q2)** — still open, see `queue-and-hol-harness.md` §2
- **Stride** — paused at the design level; nothing to measure until the control law exists
- **Reader-speed estimation** — client design, not a transport measurement
