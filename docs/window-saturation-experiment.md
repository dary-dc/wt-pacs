# Window saturation and miss cost — the experiments that remain

**Status:** design + **first focused run 2026-08-26** (RTT≈0) · **Date:** 2026-08-26
**Replaces:** `window-depth-and-priority-experiment.md` (deleted — it swept arms for a mechanism
rejected in [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md))

> **Results (RTT≈0):** see `.local/measurements/WINDOW_SATURATION_RESULTS.md`.
> E1 pass at predicted `D_min=1`. E2 warm-cache ok; magnitude vs `(D−1)·Tf` not within 20%.
> E3 inconclusive on small warm fixtures. **RTT axis (netem) still required for E1.**


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
