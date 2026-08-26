# Implementer handoff — window depth experiments

**Date:** 2026-08-26 · **Prior handoff:** `queue-and-hol-harness.md` §7 (queue work, now **done and
partly rejected** — do not work from it)

---

## 0. Where things stand

You already landed the cleanup: server back to a serial loop (562 → 433 lines), `CancelFrames` off the
wire, `queue-sim` and `window-server` deleted, `queue-harness` renamed `window-harness`. Nothing below
asks you to revisit that.

**What changed in the design since:** server-side ordering joined cancel in being rejected
([`adr-reject-server-ordering.md`](adr-reject-server-ordering.md)), and the client-side window that
replaces both is specified in [`adr-client-window-depth.md`](adr-client-window-depth.md):

```
D = ceil( U × (1 + RTT / Tf) )        Tf = time to send one frame,  U ≈ 0.95
```

**That formula is unvalidated.** Everything below exists to test it, including the possibility that it
should be deleted.

---

## 1. Finish the cleanup first — small, and it keeps measurements clean

| | |
| - | - |
| **`generation`** | remove from `RequestFrame` / `RequestFrames`, `WIRE.md`, and both clients. Server ignores it; it was added for the rejected ordering design |
| **`RequestPath`** | currently falls into `warn!("ignoring unexpected FoD message")`. Either remove it or mark it reserved-and-unimplemented in `WIRE.md`. Not both silent and present |
| **`cancelFrame`** | client-local, **no callers anywhere**. Remove from `transport-wasm` and `transport-ts` |

Detail in [`cleanup-plan-2026-08.md`](cleanup-plan-2026-08.md) §2b.

---

## 2. Build this before any experiment

**The objective metric.** Everything decision-relevant depends on it:

> `mean_wait_ms` — across a trace, mean time from *reader wants frame N* to *frame N displayable*.
> Cache hits count as 0.

Report **mean and p95 together.** They select different optima and the choice between them is a
product decision, not yours to bury.

`window-harness` already has `--depth`. What is new is trace-driven "reader wants frame N" timing and
a client-side cache model so hits can score 0.

---

## 3. Run order — the first result can cancel the rest

### Gate: E4 premise check *(do this first)*

Run the **random control** (`D` drawn uniformly 1–8 per session) against the **oracle control** (best
`D` by exhaustive sweep) on `fly_and_settle`.

| Outcome | Then |
| ------- | ---- |
| Random ≈ oracle | **Stop.** `D` does not matter. Say so, and [`adr-client-window-depth.md`](adr-client-window-depth.md) gets an ADR rejecting it. Do not run E1, E2, E4, or E5 |
| Oracle clearly beats random | Continue below |

This is deliberately the cheapest way to kill the design. Do not skip it because the formula looks
reasonable.

### Then, in order

| | Experiment | Why here |
| - | ---------- | -------- |
| 1 | **E1** — does `D_min` saturate? | Cheap, no trace needed. Validates the model that generates `D` |
| 2 | **E2** — real miss cost | Prices the residual the design accepts |
| 3 | **E4** full + `U` sub-sweep | Does the predicted `D` match the optimal `D` |
| 4 | **E5** — estimator sensitivity | **Gates whether RTT and `Tf` estimators need designing at all** |
| — | **E3** — cold-page I/O | Independent of all of the above. Run whenever convenient |

Specifications: [`window-saturation-experiment.md`](window-saturation-experiment.md).

---

## 4. Three traps, each of which has already cost this project a wrong answer

**Measuring a parameter where it is defined to do nothing.** The 0-of-100 cancel result was taken at
`D ≈ 1`, where the mechanism is zero by construction. The `U` sweep can repeat this exactly: `D` is an
integer, so `U` only moves it when `1 + RTT/Tf` sits just above an integer. Place `(RTT, Tf)` pairs
deliberately at `x ≈ 1.02`, `2.05`, `3.05`, and **report which points those are.**

**Reporting a sweep without a ceiling.** A plateau is not a ceiling. Every `D` sweep needs the
`D = 64` control or the result is unreadable.

**Tuning and reporting on the same trace.** Choose parameters on `fly_and_settle`, report on
`reversal_storm` and `dense_scrub` **without re-tuning**. Otherwise the formula has learned the trace.

---

## 5. What not to do

- Do not build server-side ordering, priority, generations, or cancel. All rejected, with ADRs
- Do not implement the window using `RequestFrames` — a batch of `N` produces an effective depth of `N`
  and silently defeats depth control. Real-time path is **one `RequestFrame` per message** (`WIRE.md`)
- Do not implement "cache whatever arrives, never discard." It is a recorded idea, untested, explicitly
  not phase 1 (`cleanup-plan-2026-08.md` §2)
- Do not design RTT or `Tf` estimators before E5 says how accurate they need to be
- Do not quote a number without checking [`queue-and-hol-harness.md`](queue-and-hol-harness.md) §5

---

## 6. Reporting

For each experiment: the groups actually run, the control values, the objective (mean **and** p95), and
the pass/fail against the criterion **as written in the spec** — not a criterion adjusted after seeing
the data.

A null result is a result. The two most valuable outcomes available here are *"`D` does not matter"*
and *"the estimators can be crude"*, and both are nulls.
