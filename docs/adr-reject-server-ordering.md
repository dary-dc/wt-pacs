# ADR: reject server-side ask ordering

**Status:** accepted · **Date:** 2026-08-26 ·
**Supersedes:** §4 and §5 of [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md)

> **Stream architecture, added 2026-08-26.** The measurements behind this ADR were taken on a server
> opening **one uni stream per frame**; the viewer integration target uses **one shared stream**. The
> load-bearing argument here is analytic — the saving is bounded by `(D−1)·Tf` regardless of how the
> bytes are framed — so it carries to both. And as with cancel, a shared stream makes ordering **less**
> useful, not more: frames commit to one stream strictly in order, so less work remains reorderable in
> the deque. **The rejection is safe on both architectures.** What is *not* transferable is the depth
> arithmetic in §2, whose measured `D_min` values are architecture-specific — see
> [`adr-client-window-depth.md`](adr-client-window-depth.md) and §3e of
> [`window-saturation-experiment.md`](window-saturation-experiment.md).

---

## 1 · What was proposed

The cancel ADR rejected *undoing* commitment but left ordering open: the server holds client asks in a
deque and serves the newest first, so a reader who moves is not stuck behind work for where they used
to be. This ADR closes that question.

---

## 2 · Why it loses

### Last-ask-wins is the wrong rule

A client emitting `cursor, near-fill, far-fill` for one viewport position would have far-fill served
**first**. Newest-ask ordering inverts the client's own priority.

Keying on window *generation* instead of ask recency fixes that inversion. It does not save the idea.

### FIFO is priority-preserving, not priority-absent

The client encodes priority as **ask order**. A FIFO server transmits that order unchanged, so the
priority scheme already works. Server-side ordering is not an addition — it is a **second, competing**
scheme layered on one that is already correct, and only the client knows the cursor position, the
direction of travel, what is already cached, and the reader's speed. A server that cannot reorder
cannot order wrongly.

### The saving is bounded by one frame time

Ask depth is not a free parameter. Depth past the point that saturates the link buys no throughput and
adds only staleness, so the correct production value is the link-derived minimum:

```
D_min  = ceil( U × (1 + RTT / Tf) )      U ≈ 0.95
saving = (D_min − 1) · Tf          →  bounded by ≈ RTT + one frame time
```

| frame | link | Tf | `D_min` | ordering saves |
| ----- | ---- | -- | ------- | -------------- |
| 2.85 MB | 10 Mbps | 2000 ms | 1 | **0** — depth 1 already saturates |
| 250 KB | 10 Mbps | 200 ms | 2 | 200 ms |
| 32 KB | 10 Mbps | 26 ms | 4 | 78 ms |

### And it only fires on a cache miss, which scroll-only movement makes rare

With `max_step = 1` the outstanding asks are always adjacent frames **in the direction of travel**.
They get used. There is no stale work to skip. The residual case is a reader who outruns the link and
then reverses — and stride removes most of that, because frames they moved too fast to see were never
fetched.

---

## 3 · Corrections to the cancel ADR

That ADR's §4 listed four conditions that would flip its verdict. Three are wrong:

| §4 claimed | Actually |
| ---------- | -------- |
| Much smaller frames (tile-sized codestreams) | **Wrong.** More deque entries, proportionally smaller. Same total drain time |
| Higher RTT / further readers | **Correct.** The only real one |
| Jump affordance in the UI | **Wrong.** A jump changes whether the backlog is wasted or reused, not how long it takes to drain |
| Trace with linear 0→N asks | **Wrong.** Same reason |

Its §5 also kept the two-task queue shape. With both cancel and ordering rejected, that shape carries
no measured benefit — see §5 below.

---

## 4 · What we keep instead

**The client window.** Depth is the smallest that saturates the link; ask order carries priority;
background fill occupies whatever depth the foreground is not using. This needs **no server change** —
asks pipeline in the QUIC receive buffer on a plain serial loop.

**Wire:** `CancelFrames` is removed. The server ignored it, and an ignored message is worse than no
message: it implies a capability that does not exist.

---

## 5 · Consequences for the code

`server/src/transport/queue.rs` is 209 of the product server's 562 lines. With cancel rejected and
ordering rejected, it earns nothing measurable. The remaining argument for holding asks server-side is
a **cap on outstanding work**, which is robustness, not priority — and a serial loop already bounds it,
because unread asks are bounded by QUIC stream flow control and each is served to completion before the
next is read.

Cleanup is tracked in [`cleanup-plan-2026-08.md`](cleanup-plan-2026-08.md).

---

## 6 · What would flip this

**One condition, and it is a deployment property, not a code property:** RTT above roughly 100 ms.
Intercontinental reading crosses it; same-metro and national teleradiology do not. Nothing about frame
size, tiling, or trace shape changes the answer.

---

## References

- [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md) — the measured null result, §4 and §5 superseded here
- [`window-saturation-experiment.md`](window-saturation-experiment.md) — the experiment that replaces the ordering sweep
