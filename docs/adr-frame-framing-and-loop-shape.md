# ADR: frame framing and session-loop shape

**Status:** open — analysis recorded, decision deferred · **Date:** 2026-08-27 ·
**Corrects:** the architecture comparison quoted in
[`adr-client-window-depth.md`](adr-client-window-depth.md) and §4b of
[`cleanup-plan-2026-08.md`](cleanup-plan-2026-08.md) ·
**Amends:** [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md)

---

## 1 · Retraction: the comparison that chose the shared stream was rigged

Recorded 2026-08-26: per-frame streams measured flat at 7.00 Mbps for `D` = 1, 2, 4, 8, against 8.50
on one shared stream. That was read as per-frame streams losing on merit. **It is not evidence of
that.**

Source, `wtransport` 0.7.2 (`src/driver/streams/mod.rs:46`):

```rust
pub async fn finish(&mut self) -> Result<(), StreamWriteError> {
    let _ = self.0.finish();          // quinn::SendStream::finish — SYNC, instant, sends FIN
    let result = self.stopped().await; // ← the 272 ms: waits for the peer to acknowledge
}
```

`quinn::SendStream::finish` is not async and does not wait. `wtransport` bundles an acknowledgement
wait into the same call, and `send_one_frame` awaited it inside a serial loop. **We measured one
misplaced `await`, not a property of per-frame streams.**

Also unfair in the other direction: per-frame streams exist to isolate head-of-line blocking under
loss, and every run to date was **lossless**. Neither side was measured in the regime that separates
them.

`quinn`'s `Drop for SendStream` calls `finish()` itself, so a dropped stream is finished gracefully
and its data still retransmits. Per-frame streams cost approximately nothing.

---

## 2 · Options

| | framing |
| - | - |
| **A** | one persistent uni per session, `[4B BE len][envelope]` |
| **B** | one uni per frame, `drop(uni)` instead of `finish().await` |
| **C** | one uni per frame, `finish().await` moved to a bounded `JoinSet` |

---

## 3 · What does not discriminate

**Serve time.** `open_uni` 0.0 ms, `write_all` 0.1 ms; all three options delete the acknowledgement
wait. Identical on an uncongested link.

**Server load.** Per-stream state and a task spawn are noise against a 250 KB payload. `write_all`
copies into the connection send buffer, so the payload drops immediately under all three. Stream IDs
are 62-bit.

Neither metric may be cited as a reason to choose. Both have been, informally.

---

## 4 · What does discriminate

| | A | B | C |
| - | - | - | - |
| Displayable latency under loss | **worst** — one lost packet delays every later frame on the stream | good | good |
| Per-frame priority (`set_priority`) | impossible | yes | yes |
| Per-frame delivery timestamp | none | none | **free, server-side, no clock sync** |
| Abandon an in-flight frame (`reset`) | impossible | yes | yes |
| Client arrival order | strict ask order | out-of-order | out-of-order |
| Matches the viewer integration target | yes | no | no |

**`set_priority` is the finding worth carrying forward.** The window design's tension is *fill ahead,
but never delay the frame the reader needs now*. Under A the server can only transmit ask order —
prefetch bytes already committed to the stream go out first. Under B/C a newly asked frame's stream is
raised in priority and **preempts buffered prefetch at the transport layer**, with no server queue and
no application logic.

This is the useful half of server-side ordering, obtained as a QUIC primitive.
[`adr-reject-server-ordering.md`](adr-reject-server-ordering.md) rejected *application-level*
reordering and did not consider per-stream priority. That rejection stands as written; this is a
different mechanism, not a reopening of it.

Cost of B/C is client-side: out-of-order arrival and per-frame stream handling in the viewer
integration target.

B additionally trades an explicit acknowledgement wait for an implicit `Drop` contract, and
`open_uni().await` blocks once `max_concurrent_uni_streams` fills. **C dominates B.** The live choice
is A or C.

---

## 5 · Loop shape is a separate axis

`run_session` is serial — one task per *connection*, not per ask:

```rust
let msg = read_fod_msg(&mut control_recv).await;   // not polled again
send_one_frame(...).await?;                        // until this returns
```

While sending, no code is reading the control stream. The ask bytes arrive and QUIC buffers them; the
delay is an application read delay, not a network delay.

Blind period, corrected:

| | uncongested | congested |
| - | - | - |
| A | ~0.1 ms — negligible | as long as flow control blocks `write_all` |
| B / C | ~0.1 ms | same, plus `open_uni` at the stream limit |
| as shipped today (per-frame + `finish`) | **272 ms, always** | worse |

Splitting the loop into an ask reader and a sender joined by a bounded FIFO channel therefore buys
**nothing under A on a healthy link**. It buys two things: headroom under congestion, which is when a
redirect matters; and it is a *precondition* for B/C, since `set_priority` and `reset` are inert if the
ask has not been read.

The channel is FIFO and preserves client ask order, so it is not the queue rejected in
[`adr-reject-server-ordering.md`](adr-reject-server-ordering.md).

**Rank loop shape below the framing decision, not beside it.** Earlier framing of the split as a
standing defect overstated it.

---

## 6 · What decides A vs C

One netem run with **loss enabled**, which no run to date has had. Loss is the only regime where A's
head-of-line blocking is visible, and it is the regime A was implicitly credited as free in.

Decide C if measured displayable-latency loss under representative packet loss exceeds the cost of
out-of-order handling in the client. Decide A otherwise, and record that per-frame streams were
rejected on a *fair* comparison rather than this one.

Loss rate on representative links is not currently known and may be cheaper to obtain by asking than by
measuring.

---

## 7 · Corrections owed

- [`adr-client-window-depth.md`](adr-client-window-depth.md) — the architecture comparison must be
  labelled as measuring a misplaced `await`, not framing
- [`cleanup-plan-2026-08.md`](cleanup-plan-2026-08.md) §4b — the recommendation to default to the
  shared stream stands, but for the reasons in §4 above, not the measurement it currently cites
