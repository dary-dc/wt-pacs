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
  engages on deceleration. Currently **paused**; the design record lives outside this repo

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
