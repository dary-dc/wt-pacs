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
**nothing under A on a healthy link** for on-demand asks. It buys two things there: headroom under
congestion, which is when a redirect matters; and it is a *precondition* for B/C, since `set_priority`
and `reset` are inert if the ask has not been read.

**2026-09-08.** Fill (`StreamFrames`, §6c) needs the split even on a healthy shared stream: without a
reader, `EndStream` is not seen until the recitation ends. That is why §6d recommends B. The ranking
below still holds for the framing decision; it does not hold for fill.

The channel is FIFO and preserves client ask order, so it is not the queue rejected in
[`adr-reject-server-ordering.md`](adr-reject-server-ordering.md).

**Rank loop shape below the framing decision, not beside it** — for on-demand. Fill ranks the split
with the message, not under framing.

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

## 6b · Serving depth: the loop was depth 1, and the protocol said otherwise

**Status: built 2026-09-09.** Option B shipped: an ask-reader task owns `control_recv` and
feeds a planner; `RequestFrame` and `RequestFrames` are the same `Ask::Frame` to the loop.
The read path split on 2026-09-10 (`SeqReader` / `TileReader`). Historical cost of depth 1
is the table below. [`disk-access/IMPLEMENTATION.md`](disk-access/IMPLEMENTATION.md).

Until then, `FodMsg::RequestFrame` was documented as "one frame per message (**depth =
outstanding asks**)" and the server did not realise that depth. `run_session` read one
ask, served it to completion, and only then read the next message:

```rust
loop {
    let msg = read_fod_msg(&mut control_recv).await;   // next ask not read until…
    match msg {
        FodMsg::RequestFrame { frame } => pipeline.serve_one(frame, …).await?,  // …this finishes
```

A client that pipelined asks got them served **one at a time**; its outstanding asks
queued in the transport, not in the server. `RequestFrames` reached the same place by a
different route — `serve_batch` was a `for` loop with an `.await`.

### What it costs

16 tiles of 16 KiB, all missing the page cache. Depths 1, 4 and 16 are
[`disk-access/v32_depth.tsv`](disk-access/v32_depth.tsv); **depth 2 — the only depth the
shape below reaches — was measured on 2026-09-08**,
`v35_depth2.tsv` at tag `read-path-evidence-2026-09-09`, 12 interleaved repeats, paired
by repeat:

| | time until the last tile is served | vs serial |
| --- | ---: | ---: |
| serial (today) | **1.33 ms** | — |
| **read ahead by one (depth 2)** | **0.78 ms** | **+67.4% asks/s, 12/12, RESOLVED** |
| depth 4 | 0.57 ms | +125.8% RESOLVED |
| depth 16 | 0.45 ms | +184.4% RESOLVED |

Small in absolute terms on a local NVMe-class device; on storage with millisecond latency
the same 16 tiles become tens of milliseconds, which is a visible stall on a zoom.

Two things the depth-2 row settles. It collects **62% of what depth 16 offers**, which is
the argument for stopping at two. And it costs *less* CPU per ask (41.8 µs against 53.3),
while warm cells tie at every depth — so a session whose reads hit pays nothing for a depth
it never uses.

### It is not forbidden — it is unbuilt

[`adr-reject-server-ordering.md`](adr-reject-server-ordering.md) rejects serving the *newest*
ask first, on the grounds that FIFO already carries the client's priority. Reading frame *n+1*
while frame *n* is on the wire preserves FIFO delivery exactly. That is **pipelining, not
reordering**, and nothing in that ADR speaks against it.

What stood in the way was state, in two places:

1. **The session loop** awaited `serve_one` before reading the next ask. **Fixed**: the
   ask-reader task plus planner.
2. **The reader held one window and its ring one in-flight slot**, so even a concurrent
   loop would have serialised on the buffer. **Fixed**: `TileReader` holds `TILE_SLOTS`
   frames; `SeqReader` is the double buffer.

### The shape to build, when it is built

**Read ahead by one — a double buffer — not N slots.** Two windows and two ring slots let the
read of frame *n+1* overlap the read *and* send of frame *n*, which is where the latency
goes. A general *N*-deep design costs a slot table, a completion demultiplexer and a much
harder invariant; the measurement above says the first step is worth 0.55 ms of the 0.88 ms
available and the whole rest of the ladder the other 0.33 ms.

**The overlap has to be two reads in flight, not one read against one write.** Submitting
frame *n+1* only after frame *n*'s read completes leaves the device at depth 1 and collects
none of the table above — that number is device queueing, not wire time.

**A page-cache hit still never touches the ring.** The read ahead probes with
`RWF_NOWAIT` first, exactly as an on-demand read does, and only a shortfall is submitted.
Anything else would rebuild the `uring` arm's +131% on hits
([`disk-access/IMPLEMENTATION.md`](disk-access/IMPLEMENTATION.md) §The trap).

**This does not change the read arm.** At depth 1 `hybrid_lazyring` and `uring` tie; the
choice between them only becomes interesting once this is built
(depth × readers, evidence tag `v33_cross.tsv`) — and now that a batch runs at
depth 2, that question is open again on a host bigger than 4 vCPU.

### What it measured, once built

The shipped reader driven both ways by `read_campaign`, one session, 12 interleaved
repeats: **+73.8% asks/s,
12/12, RESOLVED** on cold 16 KiB, p50 per frame −53.4%, and a **tie warm** — the result the
design had to produce, since a session whose reads hit must pay nothing for a depth it never
uses. 16 missing tiles: 1.14 ms → 0.62 ms.

## 6c · Server-driven streaming

**Status: built 2026-09-09.** Messages and the loop: [`disk-access/adr.md`](disk-access/adr.md),
[`disk-access/IMPLEMENTATION.md`](disk-access/IMPLEMENTATION.md).

This is the **fill** app mode. The client sends `StreamFrames` (empty = the whole study;
optional `from` / `to` default to 0 and the last frame). Current use is start-to-end; `from`
/ `to` stay on the type so a later range does not need a new message. The server recites its
own index. `RequestFrames` is not it — it still names every index.

Why it fits: sequential delivery needs no per-frame ask; the server reads forward, which is
what the page cache and read-ahead are best at. On-demand (the client names tiles) stays on
`RequestFrame` / `RequestFrames`.

Stop is `EndStream` at the next frame boundary — not session-wide, that is `EndSession`. Slow
is QUIC: when the client stops reading, `write_all` waits and the read-ahead waits with it.
`EndStream` is seen by the serving loop between frames; it does not queue behind generated
indexes. A data request during a fill ends the fill and is then served: a second
`StreamFrames` is a seek, a `RequestFrame` or `RequestFrames` puts the session back on demand
([`disk-access/adr.md`](disk-access/adr.md)).

## 6d · The other half of §6b: `RequestFrame` is still depth 1

**Status: built 2026-09-09; readers split 2026-09-10.** `TileReader::read` starts upcoming
frames that fit before waiting on this one **when this one missed**. A hit returns without
those probes — otherwise a depth-4 warm ask copied `slots − 1` extra frames before the
first write. Unmeasured on a shaped link. A batch supplies names from `frames[i + 1]`. A
stream of single `RequestFrame` asks supplies them from the ask-reader channel — the planner
peeks what is already in hand. `SeqReader` names one frame ahead (`FILL_AHEAD`).

### Why the loop change is not optional

The two app modes are **fill** (`StreamFrames`) and **on-demand** (`RequestFrame` /
`RequestFrames`). Fill needs the reader task so `EndStream` can arrive while the loop is
reciting the study. On-demand that pipelines `RequestFrame` needs it so those asks become
`upcoming`. An interactive viewer that asks as the user moves still has depth 1 by nature —
there is no next ask to name.

`lab/window-harness` pipelines `RequestFrame` and holds `--depth` outstanding
(`client.rs:530`, `PEAK_OUTSTANDING`). The server now keeps those asks as `upcoming`;
`TileReader` starts as many as fit in `TILE_SLOTS`.

### Options

| | shape | cost |
| --- | --- | --- |
| **A** | `select!` in `run_session` over a pinned `read_fod_msg` future and the in-flight `serve_one` | Every future pinned and re-created only on completion. `read_fod_msg` is **not cancel-safe** — it holds partial length/body state in locals (`wire.rs:22`) — so dropping it mid-message loses stream bytes. One misplaced re-creation is a protocol desync |
| **B** | an ask-reader task owning `control_recv`, feeding a bounded (capacity **`ASKS_AHEAD`**) channel; the serving loop takes one and peeks the next | One task and one channel per session. Cancel-safety stops being a hazard because one owner reads the stream start to finish. §5 already wanted this shape for a second reason: it is the precondition for per-frame `set_priority` and `reset`. Fill needs it so `EndStream` can arrive while the loop is reciting |
| **C** | do nothing; clients that want depth send `RequestFrames` | Free for on-demand batches. Does not give fill a message, and does not let `EndStream` in during a recitation |

**Recommendation: B, not A.** A buys nothing over B and puts a cancel-safety hazard in the
session loop's hot path. C is not enough: the two app modes are fill (`StreamFrames`) and
on-demand (`RequestFrame` / `RequestFrames`), and fill needs the reader task.
[`disk-access/IMPLEMENTATION.md`](disk-access/IMPLEMENTATION.md).

Note the owners' requirement is **depth 4 or more**, and C alone does not reach it for a
client that asks per tile: `RequestFrames` gives depth 2 today, and widening past two is a
read-path change to make *after* the loop can keep more than one ask in flight.

### If B is built

The peek is not a peek: `try_recv` removes the message, so the loop carries it as the next
iteration's current ask. A fill does not enqueue indexes; it recites `from..to` and
`try_recv`s between frames. Shape, not code:

```
current = recv()
if current is StreamFrames { from, to }:          // missing from → 0; missing to → last
    for i in from..=to:
        try_recv → EndStream breaks; EndSession ends the session;
                   any data request breaks and becomes current
        serve(i, upcoming = i+1..=to)
    current = recv()
else:                                             // RequestFrame / RequestFrames
    next = try_recv()                             // present only when the client pipelined
    serve(current, upcoming from next)
    current = next or recv()
```

Invariants an implementation has to keep, each of which is a way to get this wrong:

1. **FIFO.** Asks are served in the order they were read. This is pipelining, not the
   reordering [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md) rejects.
2. **`EndSession` must not overtake queued asks** — it is a message in the same stream, so it
   must be handled where it arrives in the sequence, not when it is read. **`EndStream` is
   different:** it stops a fill. Generated indexes are not in the channel, so the loop must
   `try_recv` between stream frames or `EndStream` waits until the study ends.
3. **A closed channel ends the session**, and the reader task's error is the session's error —
   losing it turns a broken control stream into a silent hang.
4. **Capacity `ASKS_AHEAD`, shared with `in_hand`.** The channel holds control messages, not
   generated stream indexes. The tile reader takes at most `slots − 1` of what the planner
   names; a fill takes `FILL_AHEAD`. A running fill is not sized by this queue.
5. **Depth 2 is the first step, not the target.** The owners asked for depth 4 or more
   ([`disk-access/NEXT.md`](disk-access/NEXT.md)). Depth 2 → 4 is a further
   0.21 ms on 16 tiles, 4 → 16 another 0.12 ms, against a slot table and a completion
   demultiplexer. Build the loop first — four asks in flight is worth nothing while the loop
   supplies one — then widen the read path with that measurement in hand.

### How to know it worked

`window-harness --mode saturate --depth 4` against the same study, before and after,
interleaved. Expect the miss-dominated cells to move by something like the batch path's
**+73.8% asks/s** and warm
cells to tie. A warm regression means the look-ahead is reaching the ring on a hit, which is
the one thing the read path is built not to do.

## 7 · Corrections owed

- [`adr-client-window-depth.md`](adr-client-window-depth.md) — the architecture comparison must be
  labelled as measuring a misplaced `await`, not framing
- [`cleanup-plan-2026-08.md`](cleanup-plan-2026-08.md) §4b — the recommendation to default to the
  shared stream stands, but for the reasons in §4 above, not the measurement it currently cites
