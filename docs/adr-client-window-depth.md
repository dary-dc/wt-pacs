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
