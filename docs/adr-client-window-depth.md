# ADR: size the client ask window from the link, at the minimum depth that saturates

**Status:** accepted · **Date:** 2026-08-26 · **Tags:** delivery, client, transport

## Context and Problem Statement

The client asks the server for frames. If it asks for one, waits, then asks for the next, the link
idles for a full round trip between every frame. So it keeps several asks outstanding — a *window*.

How deep should that window be? The intuitive answer is "as deep as possible": more outstanding asks
means more speculative fill, a warmer cache, and the link never starves. That answer is wrong, and the
reason is not obvious.

## Decision Drivers

- Minimise time from *reader wants a frame* to *first byte of that frame*
- Keep the link at 100% — unused bandwidth cannot be banked, except in the cache
- The client cannot un-ask. Cancel was measured and rejected (see [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md))

## Considered Options

- **A** — Fixed shallow depth (1). Maximum responsiveness
- **B** — Fixed deep window. Maximum fill
- **C** — Minimum depth that saturates the link, derived continuously
- **D** — Deep window plus server-side reordering to undo staleness

## Decision Outcome

**Chosen option: C** — *any depth past saturation buys no throughput and costs latency on every miss.*

Two quantities were being conflated and are in fact independent:

| | |
| - | - |
| **`W`** — cache window | how many frames are held locally. Grows over **time** at the link's fill rate |
| **`D`** — ask depth | how many asks are outstanding. Sets **pipelining only** |

Cache coverage is a function of time and link rate, not of `D`. Once `D` is deep enough to keep the
link busy, more depth fills the cache no faster — it only lengthens the queue a reader must wait
behind when they ask for something uncached.

```
D = ceil( U × (1 + RTT / Tf) )        Tf = time to send one frame,  U ≈ 0.95
```

| term | what it is |
| ---- | ---------- |
| `RTT / Tf` | how many frame-times fit inside one round trip — the gap pipelining must cover |
| `1 +` | the frame currently arriving |
| `U` | how much link we are willing to leave unused in exchange for responsiveness |

`U` is **the knob for the trade this ADR is about**, not a constant of nature. It earns its place at the
extremes: a 2.85 MB frame on a 10 Mbps link has `Tf ≈ 2 s`, so `D = 1` already reaches 97% utilisation.
Without `U` the formula would return 2 — doubling the miss cost from 0 to 2000 ms to buy 3% throughput.
`U = 0.95` correctly declines.

> **Corrected 2026-08-26.** An earlier draft replaced `U` with `demand = reader speed × Tf`, on the
> reasoning that a slow reader does not need a full link. That is **incompatible with running the link
> at 100%**: if background fill takes the slack, the link is always fully demanded and the reader's own
> speed never reduces the depth required. Reader speed drives **stride** and the **ask-order split**,
> not depth.

Background fill occupies whatever depth the foreground is not using. It never gets its own budget, so
the link is always full and cursor-driven asks always go first.

### Positive consequences

- Requires **no server change**. Asks pipeline in the QUIC receive buffer on the existing serial loop
- Link runs at 100% while the miss penalty stays at its theoretical minimum
- Ask order carries priority; a FIFO server preserves it exactly (see [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md))

### Negative consequences

- On a cache miss the reader waits behind `D − 1` outstanding asks. Unavoidable without cancel, which
  does not work. Scroll-only movement (`max_step = 1`) makes this rare — outstanding asks are almost
  always adjacent frames in the direction of travel, so they get used
- `D` depends on measured RTT and on `Tf`, which is itself an estimate — HTJ2K compression varies per
  slice, so frame size is not constant within a series. Both need estimators and both can be wrong
- **`U` is a policy choice with no measured basis yet.** 0.95 is a starting value, not a result

### Re-validated 2026-08-26 under real netem, on the shared stream

Superior evidence to the simulated-RTT results below. Real `tc netem` (delay + rate) inside an
unprivileged network namespace — `unshare --user --map-root-user --net`, **no root required**. In-process
pacer disabled (`--read-bps 0`); netem shapes the wire. Measured RTT 60.3 ms, 250 KB frames, 10 Mbit
cap.

Full grid, shared stream, `D_min` = smallest depth reaching 95% of the measured ceiling:

| frames | `Tf` | RTT | predicted | measured | |
| ------ | ---- | --- | --------- | -------- | - |
| 250 KB | 200 ms | 20 ms | 2 | 2 | pass |
| 250 KB | 200 ms | 60 ms | 2 | 3 | pass (±1) |
| 250 KB | 200 ms | 150 ms | 2 | 3 | pass (±1) |
| 51 KB | 40.8 ms | 20 ms | 2 | 3 | pass (±1) |
| 51 KB | 40.8 ms | 60 ms | 3 | 3 | pass |
| 51 KB | 40.8 ms | 150 ms | 5 | **5** | pass |

**Six of six.**

The last row is the one that failed under simulated RTT. It passes here — and the first shared-stream
attempt at it also read as a fail until the sweep was extended past `D`=8. The curve was still climbing
at 8; the ceiling is 7.84 Mbps at `D`=12. **A plateau is not a ceiling, and the grid must be extended
until the curve turns over.** The same error makes the per-frame 51 KB / 150 ms result inconclusive
rather than a fail: that sweep jumped 4 → 8 and never sampled 5, 6 or 7.

Direct architecture comparison at RTT 60, 250 KB, identical netem:

| `D` | shared stream | per-frame streams |
| --- | ------------- | ----------------- |
| 1 | 7.00 Mbps | 7.00 Mbps |
| 2 | **8.00** | 7.00 |
| 4 | **8.50** | 7.00 |
| 8 | 8.50 | 7.00 |

Two things this settles:

**1. The over-depth throughput penalty is per-frame-stream-specific.** Under simulated RTT, per-frame
mode lost 36% at `D`=8. On the shared stream there is **no degradation at all** — 8.50 at `D`=2 and at
`D`=8. The "worse on both axes" claim below applies to per-frame streams only.

**2. Depth does nothing at all in per-frame mode** — flat at the `D`=1 value across every depth, with
`peak_outstanding` correctly reaching 8. Asks are concurrent; throughput does not follow.

**Mechanism confirmed by measurement**, not inference. Per-frame send phases instrumented and run under
netem (250 KB frames, 10 Mbit, 60 ms RTT), median of 14 frames:

| phase | median |
| ----- | ------ |
| `open_uni` | **0.0 ms** |
| `write_all` | **0.1 ms** |
| **`finish`** | **271.8 ms** |

`finish().await` blocks until the frame is transmitted **and acknowledged** — 272 ms is `Tf + RTT`
(200 + 60). The server loop is serial, so it cannot read the next ask until that returns. Every frame
costs `Tf + RTT` regardless of how many asks are queued, capping throughput at:

```
Tf / (Tf + RTT)
```

Two things this kills:

- **"Opening a stream is expensive" is wrong** — `open_uni` measured 0.0 ms. QUIC stream creation is
  local and free. The cost is entirely in waiting for the acknowledgement
- **Client-side depth cannot fix it.** Nothing the client does changes a serial server blocked on a
  flush

### This is a live defect in wt-pacs, not an academic finding

Per-frame streams are still wt-pacs's **product default**, so the product currently leaves
`RTT / (Tf + RTT)` of the link unused — 18% at 250 KB / 60 ms, and **~79% at 51 KB / 150 ms**. It gets
worse as frames shrink and readers get further away, which is the direction the delivery design is
heading.

The shared-stream path has no per-frame `finish()`: `write_all` returns once buffered and the loop
proceeds immediately. **Recommendation: make shared-stream the wt-pacs default** — it is the decided
architecture, it is measurably faster, and it collapses two code paths into one.

It does mean the shared stream — chosen because changing the viewer is expensive — is also the one where
window depth demonstrably works.

---

### Validated 2026-08-26 — **on one stream architecture only** (simulated RTT, superseded above)

> **Scope limit, added after review.** Everything below was measured on a server that opens **one uni
> stream per frame**. The viewer integration target uses **one stream per endpoint**. Three of the four
> findings here are properties of the stream layout, not of the formula, and **do not describe a
> single-stream system.** Marked inline. The formula itself is transport-independent and should carry.
> See §3e of [`window-saturation-experiment.md`](window-saturation-experiment.md).

Measured on `exact-server` at 10 Mbps, simulated RTT, fixed harness (see
[`window-saturation-experiment.md`](window-saturation-experiment.md) §0c). `D_min` = smallest depth
reaching 95% of the ceiling.

| frames | `Tf` | RTT | predicted | measured | |
| ------ | ---- | --- | --------- | -------- | - |
| 250 KB | 200 ms | 20 ms | 2 | 2 | pass |
| 250 KB | 200 ms | 60 ms | 2 | 2 | pass |
| 250 KB | 200 ms | 150 ms | 2 | 3 | pass (±1) |
| 51 KB | 40.8 ms | 20 ms | 2 | 2 | pass |
| 51 KB | 40.8 ms | 60 ms | 3 | 3 | pass |
| 51 KB | 40.8 ms | 150 ms | 5 | **8** | **fail** |

**Five of six.** The formula holds for CT-sized frames across the whole RTT range.

#### The limit: small frames at high RTT — **architecture-specific, and mechanism unproven**

At 51 KB / 150 ms the measured curve tracks theory at low depth and falls behind as depth grows:

| `D` | theory | measured |
| --- | ------ | -------- |
| 1 | 0.214 | 0.217 |
| 2 | 0.428 | 0.420 |
| 3 | 0.641 | 0.609 |
| 4 | 0.855 | 0.692 |

The obvious explanation is per-stream overhead — high RTT with small frames needs many concurrent
streams. **That mechanism is asserted, not tested.** Eight concurrent QUIC streams are not obviously
expensive (opening one is local and costs no round trip), and the harness's in-process `LinkPacer`
takes a mutex on every 16 KB chunk, so lock contention across 8 concurrent readers is at least as
plausible a cause. Distinguish them by shaping with `tc` instead of the in-process pacer.

Where this bites is the **tile regime** — small units, distant reader. It does not affect the
250 KB case the delivery design is built on.

#### Second mechanism, not predicted: over-depth costs throughput — **architecture-specific**

The ADR argued "not less, not more" purely on miss latency. Measurement shows depth past the optimum
also **loses throughput**:

| | best | over-deep |
| - | ---- | --------- |
| 250 KB, RTT 60 | 0.933 at `D`=2 | **0.600 at `D`=8** — 36% loss |
| 51 KB, RTT 20 | 0.978 at `D`=3 | 0.870 at `D`=64 — 11% loss |
| 250 KB, any RTT | — | **`D`=64 delivered nothing at all** |

So on this architecture the case against over-asking is stronger than written: not a
latency-versus-throughput trade, worse on **both** axes. `D`=64 with 250 KB frames failed outright —
that is ~16 MB of concurrent in-flight data hitting connection flow control, **not** stream-creation
cost, which in QUIC is local and cheap.

**None of this is established for a single-stream server**, where 64 queued frames and 64 concurrent
streams are entirely different things.

### Follow-up actions

- Measure whether `D_min` actually saturates the real `wtransport` path. The formula is arithmetic;
  the transport may need more. See [`window-saturation-experiment.md`](window-saturation-experiment.md)

## Pros and Cons of the Options

### A — fixed depth 1

- ✅ Zero queueing; every ask served next
- ⚠️ Utilisation caps at `Tf / (Tf + RTT)`. At 40 ms frames and 60 ms RTT that is 40% of the link
- ⚠️ Cache fills slower, so misses become *more* frequent — the opposite of the intent

### B — fixed deep window

- ✅ Simple; link always saturated
- ⚠️ Buys no extra fill over C, and every extra slot is latency on a miss
- ⚠️ Depth chosen without reference to the link is wrong on most links

### C — minimum depth that saturates *(chosen)*

- ✅ Optimal on both axes simultaneously: full link, minimum miss penalty
- ✅ No server involvement
- ⚠️ Needs live estimates of reader speed and RTT

### D — deep window plus server reordering

- ✅ Would recover the miss penalty while keeping deep fill
- ⚠️ The extra fill it protects does not exist: depth past saturation adds no coverage
- ⚠️ Rejected on its own merits — see [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md)

## More Information

- [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md) (wt-pacs) — why the server stays FIFO
- [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md) (wt-pacs) — why the client cannot un-ask
- [`adr-stride-is-bandwidth-conservation.md`](adr-stride-is-bandwidth-conservation.md) — stride, which handles the case where demand exceeds 1
- Reader behaviour: published measurements of radiologist scroll speed, oscillation over adjacent
  slices, and repeated depth passes over ≥80% of a series
