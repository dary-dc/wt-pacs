# ADR: treat stride as bandwidth conservation, not fidelity degradation

**Status:** accepted · **Date:** 2026-08-26 · **Tags:** delivery, client, clinical

## Context and Problem Statement

When a reader scrolls faster than the link can deliver frames, the system must do one of two things:
send every frame and let them all arrive late, or skip some and keep motion tracking the cursor. The
second is *stride*.

Stride reads, on first encounter, as "we are hiding slices from a radiologist." Framed that way it is a
clinical decision requiring clinical sign-off, and it will be blocked. That framing is wrong, and this
ADR exists so the argument is on record **before** that conversation happens rather than after.

## Decision Drivers

- Motion must track the cursor. A stack that lags the scroll is unusable
- Nothing diagnostic may be silently withheld
- Readers make repeated depth passes over ≥80% of a series, so anything skipped is re-asked later

## Considered Options

- **A** — Never skip. Deliver every frame, accept that motion lags
- **B** — Skip frames during fast motion (*stride*)
- **C** — Drop a resolution rung instead, delivering every frame smaller

## Decision Outcome

**Chosen option: B** — *the alternative to skipping a frame is not that the reader sees it, but that it
arrives after the reader has already moved past it.*

At 9 slices/second a frame is on screen for 111 ms. If the link delivers 2 frames/second, un-strided
fetching does not show the reader more slices — it shows them **stale** ones, because every frame
arrives after the cursor has moved on. Stride removes fetches that would have been discarded on
arrival.

So nothing diagnostic is skipped, because nothing skipped would have been displayed. **This is a
bandwidth decision, not a fidelity decision, and it needs no clinical gate.**

Two invariants make that true and must hold:

| | |
| - | - |
| **Settle is never strided** | the frame the reader stops on is always fetched exact |
| **Nothing is permanently lost** | repeated depth passes re-ask skipped frames at examining speed |

Option C is not an available alternative: reduced-resolution delivery does not reach the render path
in the current integration target. That constraint is recorded outside this repo. Until it changes,
stride is the only lever.

### Positive consequences

- Motion tracks the cursor at any link rate
- Link is spent only on frames that will actually be displayed
- No clinical sign-off required, so it does not block the delivery path

### Negative consequences

- **Deceleration is a real gap.** Stride chosen for fast motion leaves holes in exactly the region a
  decelerating reader begins to examine. "Repeated depth passes cover it" is true and insufficient —
  the gap is visible *during* the slowdown. The control law that closes it is undesigned
- A reader who uses fast scrolling to *detect* a single-slice finding sees fewer slices. Note that a
  link that cannot deliver those frames could not have shown them either

### Follow-up actions

- Design the stride control law: how stride is chosen from measured reader speed, and how fast gap-fill
  engages on deceleration. Currently **paused**; the design record lives outside this repo. Its
  missing input is the bytes a displayed frame needs
  ([`adr-resolution-fitting-for-large-frames.md`](adr-resolution-fitting-for-large-frames.md) §6)

## What a queue behind the window can recover

*Derived 2026-08-24, predicted analytically and never measured. The queue half is rejected
([`adr-reject-server-cancel.md`](adr-reject-server-cancel.md)); the derivation stands, and both
rejections — cancel and [ordering](adr-reject-server-ordering.md) — cite it.*

Stride and a server-side queue looked like one question: the queue can only hold something if the
client keeps more than one ask outstanding, and that depth `D` is set by client policy. **At
`D = 1` the queue never holds a second entry, and the whole family — mechanism, cancel, priority —
is worth exactly zero.**

With `S` the frame size, `R` the link rate, `Tf = S/R`:

```
utilisation(D)      = min(1, D·Tf / (RTT + Tf))
D_min               = ceil( U · (1 + RTT/Tf) )
recovered           = (D − 1) · Tf
recovered at D_min  ≈ U·RTT − (1−U)·Tf          clamped at 0, quantised by the ceiling
```

`recovered` is what cancel would buy at a reversal or a settle: every committed frame but the one
mid-write.

**When the client picks the shallowest depth that saturates the link, a queue recovers about one
RTT, nearly independently of frame size and link rate.** It is an RTT-recovery mechanism, not a
bandwidth one: it buys back the pipelining depth latency forced on the client. Predicted, `U` = 0.95,
in ms at `D = D_min`:

| frame | rate | RTT 5 ms | RTT 50 ms | RTT 150 ms |
| ----- | ---- | -------- | --------- | ---------- |
| ~250 KB | 5 Mbps | 0 *(D=1)* | 400 | 400 |
| ~250 KB | 25 Mbps | 80 | 80 | 160 |
| ~250 KB | 100 Mbps | 20 | 60 | 160 |
| ~250 KB | 1 Gbps | 6 | 48 | 144 |
| ~2.85 MiB | 5 Mbps | 0 *(D=1)* | **0** *(D=1)* | **0** *(D=1)* |
| ~2.85 MiB | 25 Mbps | 0 *(D=1)* | 0 *(D=1)* | 956 |
| ~2.85 MiB | 100 Mbps | 0 *(D=1)* | 239 | 239 |
| ~2.85 MiB | 1 Gbps | 24 | 48 | 143 |

Where `Tf ≪ RTT` `D_min` is large and `recovered → U·RTT`, smoothly. Where `Tf ≫ RTT` `D_min` is 1
or 2 and `recovered` is quantised: exactly 0, or one whole `Tf`. **On the large-frame modality over
a slow link — the case this design is shaped around — a queue is worth nothing**: `D = 1` already
saturates the link (at ~1 % of throughput), so there is never a second entry to cancel. A queue
earns its keep in the opposite corner: small frames, fast links, high RTT.

So a well-chosen `D` removes most of a queue's value by construction, and what remains is **insurance
against a mis-estimated `D`, plus one RTT**. Whether the client can pick `D_min` at all — `R` and
RTT are unknown at connect and drift, on mobile links especially — is the window ADR's E5.

> **Corrected 2026-08-24.** An earlier harness plan held that client-side read pacing was exact for
> this question and `netem` was needed only for head-of-line loss. **Wrong:** RTT is the dominant
> variable, and read pacing varies throughput, not RTT. Pacing sweeps `D` and `R`; **RTT needs
> `netem` delay**; loss needs `netem` loss.

A measurement of either side has to report both: the benefit (`recovered`, and wasted bytes) and
the cost (link utilisation at that `D`) — benefit alone concludes "`D = 1`" while idling the link.
Whether it pays is a threshold, and the set of link profiles that count, that are product facts to
fix **before** a run. What a model cannot answer:

- **Where a frame's bytes stop being cancellable.** If the transport buffers a whole frame before
  QUIC, `recovered` is smaller than modelled — a source-reading question
- **Congestion-control ramp.** `R` is not constant over a short burst, least of all early in a session
- **Decode-side backpressure.** If decode is slower than the link, decode sets the useful `D`
- **Whether real readers produce the traces.** Every committed trace has `max_step = 1`; a jump
  affordance would make every number here a lower bound

## Pros and Cons of the Options

### A — never skip

- ✅ Every slice is delivered
- ⚠️ Motion lags the cursor by a growing margin; the reader scrolls into an empty stack
- ⚠️ Spends the entire link on frames that arrive too late to display

### B — stride *(chosen)*

- ✅ Motion tracks the cursor
- ✅ No clinical gate
- ⚠️ Deceleration leaves gaps until fill catches up

### C — drop a resolution rung

- ✅ Would keep every frame, at lower detail
- ⚠️ **Not available.** Reduced-resolution planes do not reach the render path in the integration target

## More Information

- [`adr-client-window-depth.md`](adr-client-window-depth.md) — the ask window. Stride engages when `demand > 1`
- The resolution constraint is recorded outside this repo
