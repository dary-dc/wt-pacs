# Window saturation and miss cost — the experiments that remain

**Status:** design + **first focused run 2026-08-26** (RTT≈0) · **Date:** 2026-08-26
**Replaces:** `window-depth-and-priority-experiment.md` (deleted — it swept arms for a mechanism
rejected in [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md))

> **Status correction (2026-08-26):** E1 at RTT≈0 is **not yet tested** — `D = ceil(U×(1+RTT/Tf))`
> collapses to 1 when RTT is 0, so that run cannot validate the model. E2 at `D=1` is likewise
> uninformative because `(D−1)·Tf = 0`. Prior RTT≈0 numbers are exploratory only.
> **Gate first:** E4 premise (random `D` vs oracle `D` on `fly_and_settle`) — see
> [`implementer-handoff-2026-08-26.md`](implementer-handoff-2026-08-26.md) §3.


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

`recovered_ms` — reversal → first byte of the wanted frame.

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
