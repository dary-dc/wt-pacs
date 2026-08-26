# Stride depth and queue value — the experiment that decides both

> **Paused 2026-08-26.** Stride is paused at the design level — the control law (how stride follows
> reader speed, how fast gap-fill engages on deceleration) is undesigned, so there is nothing to
> measure yet. The queue half is rejected outright.
> **§2 (the RTT-recovery derivation) stands** and is cited by
> [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md).

**Written:** 2026-08-24 · **Status:** predicted analytically, unmeasured ·
**Companion to:** [`queue-and-hol-harness.md`](queue-and-hol-harness.md), which says what to build.
This says what to measure and what the numbers have to clear.

---

## 0. Why these are one question

The queue can only hold something if the client permits more than one ask outstanding at a time. Call
that **D**, the outstanding-ask depth — it is set by stride policy, not by the server.

> **If D = 1, the deque never holds a second entry and the entire queue family — mechanism, cancel,
> priority — is provably worthless.** Not "small". Zero.

So the queue's value is a *function of a client policy we have not chosen yet*, and neither can be
decided alone. The experiment must sweep D rather than fix it.

---

## 1. The model

| Symbol | |
| ------ | - |
| `S` | frame size, bytes |
| `R` | link rate, bytes/sec |
| `Tf = S/R` | time to put one frame on the wire |
| `RTT` | round trip time |
| `D` | max outstanding asks the client permits |
| `U` | link-utilisation target (0.95 unless stated) |

**Cost of a shallow D.** With depth `D`, delivering `D` frames takes `max(D·Tf, RTT + Tf)` — below a
threshold the link idles waiting for the next ask.

```
utilisation(D) = min(1, D·Tf / (RTT + Tf))
D_min          = ceil( U · (1 + RTT/Tf) )
```

**Benefit of cancel.** At a reversal or a settle, frames already committed must drain before the wanted
frame starts. One frame is mid-write and cannot be cancelled; the rest can.

```
recovered = (D − 1) · Tf
```

**Combined, at the depth stride would actually choose (`D = D_min`):**

```
recovered ≈ U·RTT − (1−U)·Tf      [clamped at 0, and quantised by the ceiling]
```

---

## 2. The finding: this is an RTT-recovery mechanism

That closed form is the result. **When stride picks the shallowest depth that still saturates the link,
the queue recovers approximately one RTT — near-independently of frame size and link rate.**

The queue is not a bandwidth mechanism. It buys back the pipelining depth that latency forced on you.

### Predicted surface, U = 0.95

`recovered` in ms, at `D = D_min`:

| frame | rate | RTT 5 ms | RTT 50 ms | RTT 150 ms |
| ----- | ---- | -------- | --------- | ---------- |
| small ~250 KB | 5 Mbps | 0 *(D=1)* | 400 | 400 |
| small ~250 KB | 25 Mbps | 80 | 80 | 160 |
| small ~250 KB | 100 Mbps | 20 | 60 | 160 |
| small ~250 KB | 1 Gbps | 6 | 48 | 144 |
| large ~2.85 MiB | 5 Mbps | 0 *(D=1)* | **0** *(D=1)* | **0** *(D=1)* |
| large ~2.85 MiB | 25 Mbps | 0 *(D=1)* | 0 *(D=1)* | 956 |
| large ~2.85 MiB | 100 Mbps | 0 *(D=1)* | 239 | 239 |
| large ~2.85 MiB | 1 Gbps | 24 | 48 | 143 |

Two regimes, and they behave differently:

- **`Tf ≪ RTT`** (small frames, fast link) — `D_min` is large, the ceiling barely matters, and
  `recovered → U·RTT`. Smooth
- **`Tf ≫ RTT`** (large frames, slow link) — `D_min` collapses to 1 or 2 and `recovered` is
  **quantised**: either exactly 0 or one whole `Tf`. Lumpy, and when it is nonzero it is large

### The consequence nobody would guess

**On the hard modality over a slow link — the case the whole programme is shaped around — the queue is
worth exactly nothing.** `Tf` is so much larger than `RTT` that `D = 1` already saturates the link, so
there is never a second entry to cancel. Running D=1 there costs ~1 % of throughput.

The queue earns its keep in the *opposite* corner: small frames, fast links, high RTT — where
pipelining is mandatory and the pipeline is deep.

---

## 3. What this does to the stride/queue relationship

**A well-tuned stride removes most of the queue's value by construction.** Choosing `D = D_min` is
choosing the smallest commitment that does not waste the link, and that is the same thing the queue was
trying to claw back. The residual — roughly one RTT — is irreducible: you cannot go below `D_min`
without idling the link.

So the honest characterisation:

> **The queue is insurance against a mis-estimated `D`, plus one RTT.**

That reframes the experiment. The decisive question is not "does cancel help at some D" — it does,
trivially, at large D. It is:

1. Is `U·RTT` alone above the bar for the links we serve?
2. **Can the client pick `D_min` at all?** It needs `R` and `RTT`, which are unknown at connect and
   drift during a session — mobile links especially. A client that must be conservative will
   over-commit, and the queue absorbs exactly that error

Question 2 is the one worth real effort, and it is measurable: sweep `D` chosen from *imperfect*
estimates of `R` and `RTT` against the true values, and see how much the queue recovers.

---

## 4. Correction to the harness plan

An earlier draft said client-side read pacing was "exact, not an approximation" for the queue question,
and that `netem` was only needed for the head-of-line question. **That was wrong.**

`recovered ≈ U·RTT` makes **RTT the dominant variable**, and read pacing cannot vary RTT — it varies
throughput only. A pacing-only rig would sweep the axis that barely matters and hold fixed the one that
decides the answer.

| | Needs |
| - | ----- |
| Sweeping `D` and `R` | read pacing — fine, cheap, deterministic |
| **Sweeping RTT** | **`netem` delay. Not optional** |
| Loss (head-of-line question) | `netem` loss |

Read pacing keeps its place for the throughput axis. It is no longer sufficient on its own.

---

## 5. Sweep plan

**Axes**

| Axis | Points | Source |
| ---- | ------ | ------ |
| `D` | 1, 2, 4, 8, 16, 32 | client policy under test |
| `R` | 5, 25, 100 Mbps, 1 Gbps | read pacing |
| `RTT` | 5, 50, 150 ms | `netem` delay |
| `S` | small (~250 KB), large (~2.85 MiB) | fixtures |
| trace | `fly_and_settle`, `reversal_storm`, `dense_scrub` | committed traces |
| arm | cancel on / off | sim only — server cancel rejected; see [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md) |

Full cross product is simulation work (§3 of the companion doc, layer 1). Layer 2 confirms a handful of
cells — pick the two predicted to pay, the two predicted not to, and one boundary cell.

**Measure both sides.** This is the part that is easy to get wrong:

- **benefit** — `recovered` (time from settle to first byte of the wanted frame, cancel-off minus
  cancel-on), and `wasted bytes`
- **cost** — **link utilisation at that `D`**

A run that reports only the benefit will happily conclude "use `D = 1`, no queue needed" while
destroying throughput in the regimes where `D=1` idles the link most of the time. Utilisation is not a
secondary curiosity here; it is half the decision.

---

## 6. Decision rule, fixed in advance

For each (`S`, `R`, `RTT`) cell:

1. Find `D*` = smallest `D` reaching the utilisation target
2. Read `recovered` at `D*`
3. The queue pays in that cell iff `recovered` clears the threshold

Then:

> **Ship the queue** if it pays in the cells that match real deployments, **or** if §3 question 2 shows
> the client cannot reliably pick `D*` and the over-commitment is expensive.
>
> **Do not ship it** if `D*` is reliably pickable and `U·RTT` is under the threshold there. In that case
> stride alone is the answer, and the whole family — reader task, channel, cancel, flag — comes out.

The threshold is a product fact, not an engineering one, and it is not ours to set. Neither is the set
of link profiles that count as "real deployments". **Both must be settled before the runs, not after** —
choosing a threshold once the numbers are visible is choosing the conclusion.

---

## 7. What simulation cannot answer

Escalate these to layer 2 or to source reading; do not let the simulation imply an answer.

- **Where a frame's bytes stop being cancellable.** If the transport buffers a whole frame before it
  reaches QUIC, `recovered` is smaller than modelled. Read the source; this is not a measurement
- **Congestion-control ramp.** `R` is not constant over a short burst. Affects `Tf` early in a session,
  which is exactly when first impressions form
- **Decode-side backpressure.** If the client decodes slower than the link delivers, decode sets the
  useful `D`, not the link, and the wasted work is decode rather than transport. This is the
  backpressure gap, and it changes which resource the experiment is even about
- **Whether real readers produce the traces.** All committed traces have `max_step = 1`. If the product
  exposes a jump affordance, commitment is deeper than any of these traces show and every number here
  is a lower bound
