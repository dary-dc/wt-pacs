# Read path — design proposal: depth, messages, and the loop around the seam

**2026-09-08 · Proposed, not implemented. For iteration.** Assembled from what was agreed on
the day. It builds on three documents and repeats none of them:

* [`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md) — the seam. Change **A** moves the frame loop
  into the read path behind `ctx.frame(...)`; change **B** makes a window own its ring slot,
  after P0. Both stand as written there.
* [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6d — the
  session loop. Option **B** there, an ask-reader task feeding a bounded channel, stands too.
  Channel capacity is **`W − 1`**, not 1.
* [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md) — the sequential reader is the same reader
  going forward, one frame ahead.

What this document adds: how many reads are in flight and who decides it, the messages, two
app modes, why fill needs a second task, the numbers per use case, and the order to build in.
**`RequestFrame` stays.** Nothing here changes the wire format of an existing message.

## 1 · Depth is two quantities

```
 client ──control──▶ ask-reader task ──channel──▶ serving loop ──upcoming──▶ read path ──reads──▶ device
                     owns the control stream      holds the work in hand,     holds W windows,
                     never blocks the loop        sees L more asks / the      starts ≤ W reads
                                                  stream sequence
```

| | Loop depth **L** | Read depth **R** |
| --- | --- | --- |
| Meaning | work the server has in hand beyond the frame being served | device reads outstanding at once |
| Comes from | **On-demand:** `RequestFrames` — the rest of the list; `RequestFrame` — other asks already in the channel. **Fill:** `StreamFrames` — the server's own index, produced by the loop, not the channel | the read path: one window and one ring slot per read |
| Cap | channel capacity `W − 1` (control messages only) | **W**, a parameter of the read path |
| Effective in flight | | `min(what is named or generated, W)` |

The **channel holds control messages** — every FoD message the client sent that the loop has
not taken yet. It does **not** hold generated stream indexes. A greedy on-demand client is
bounded by **backpressure rather than refusal**: the ask reader stops pulling when the
channel is full and QUIC holds the rest. No server memory grows with ask rate.

A running `StreamFrames` is not paced by that queue. The loop produces the next index itself.
`EndStream` arrives as a control message and is acted on **in the loop, between frames**. It
cannot sit behind thousands of generated indexes, because those indexes never enter the
channel. Slowing the client is `write_all` waiting on QUIC, which holds the read-ahead with it.

R above 1 needs R windows: a read has to land somewhere. That is physics, not design. The
double buffer that ships is R = 2; change A makes W a parameter and removes the flip that
cannot become 4.

## 2 · Two app modes, four messages

| Mode | What the user is doing | Messages |
| --- | --- | --- |
| **Fill** | start to end, no per-frame choice | one `StreamFrames`, then `EndStream` if they stop early |
| **On-demand** | the client names what it needs | `RequestFrame` (one) or `RequestFrames` (a batch) |

| Message | Status | What the read path is told is coming | Reads in flight |
| --- | --- | --- | --- |
| `RequestFrame { frame }` | **kept** | other asks already in the channel, up to `W − 1` | `min(pipelined, W)` |
| `RequestFrames { frames }` | kept | the rest of the list | `min(len, W)` |
| `StreamFrames { from?, to? }` | **new** | the server's index from `from` through `to` | **2**, by construction |
| `EndStream` | **new** | ends the current fill at the next frame boundary | |
| `EndSession` | kept | ends the session | |

`StreamFrames {}` is the fill we will implement first: the whole study. `from` and `to` stay
on the message so a later range does not need a new type — omitted `from` is 0, omitted `to`
is the last frame. **Current use is start-to-end only.** When the type is added, one comment
on it says that. Seek and mid-session mode switch (fill, then on-demand, or a second
`StreamFrames`) are **not specified yet**; do not invent them in the loop.

`EndStream` is not session-wide — that is `EndSession`. It only stops the fill the loop is
reciting. Seek, when specified, is `EndStream` then `StreamFrames { from, to }`.

`StreamFrames` is the server reciting its own index. The client sent a range (or the
defaults), not every index. The read path starts frames from that range; it does not invent
indexes outside it. On-demand is the other half: everything it starts is an ask the client
already sent.

Delivery order is ask order (fill order, for a stream), always. Reads land in any order; a
slow head frame delays the delivery of the ones behind it, never their reads. That is the
pipelining [`../adr-reject-server-ordering.md`](../adr-reject-server-ordering.md) allows.

## 3 · Why fill needs a second task

Today one task does both jobs, one after the other:

```
read one FoD message → serve everything that message named → read the next message
```

That is enough for **on-demand**. `RequestFrame` names one frame. `RequestFrames` names a
list. When serving is done, the next message is waiting.

**Fill is not a list the client sent.** `StreamFrames` means "keep generating indexes until
`to`." While that is happening, the same task is not reading the control stream. `EndStream`
sits in QUIC, and nobody looks at it until the study ends. The user cannot stop the fill.
`EndSession` has the same hole during a fill.

So we split the two jobs:

```
reader task:  only reads FoD messages, puts them in a small channel
serving loop: takes a message, serves, looks at the channel between frames
```

The channel is those messages — `RequestFrame`, `RequestFrames`, `StreamFrames`, `EndStream`,
`EndSession`, and anything else the client sends. It is **not** the generated index list.
The loop recites `from..to` itself. Between two frames it `try_recv`s. If that is
`EndStream`, the fill stops. Channel queueing cannot stop the stream, because the stream is
not in the channel.

The same split lets extra `RequestFrame`s already in the channel become `upcoming` (on-demand
depth > 1). That is a bonus. **Fill is why we build it.** Doing nothing and telling clients
to batch (`RequestFrames`) is the on-demand path we already have; it is not fill.

## 4 · The loop, the seam, the reader

**The loop** is §6d option B. Channel capacity is `W − 1`.

```
reader task:  control stream ──▶ channel(W − 1)     // FoD messages only
loop:
    current = recv()
    if current is StreamFrames:
        upcoming = the study index from..to, one frame at a time
        between frames: try_recv → EndStream ends the fill; EndSession ends the session
    else:
        upcoming = the rest of a batch, or RequestFrame asks waiting in the channel
        serve(current, upcoming)
```

**The seam** is change A, with `next` widened to the frames the loop knows:

```rust
/// Bytes of one frame; reads of `upcoming` started under them, as many as free windows allow.
/// With W = 2 this is exactly READ-PATH-REVIEW.md's `frame(span, next)`.
pub fn frame(&mut self, store: &Arc<FrameStore>, span: FrameSpan, upcoming: impl Iterator<Item = FrameSpan>)
    -> FrameBytes<'_>;
```

The order inside is the one that was measured: adopt or start the current frame, then start
what fits, then wait. `upcoming` is an iterator so a fill can say "through `to`" without
building a `Vec`. The read path takes at most `W − 1` from it.

**The reader** is the shipped mechanism. `RWF_NOWAIT` inline for a hit, the ring built on the
first miss for the rest of the frame, the pool as fallback. Change B reshapes its ownership
later; nothing here depends on B.

## 5 · Numbers per use case

One mechanism, two numbers. A window already sizes itself to what it escalates.

| | On-demand (tiles) | Fill (stream) |
| --- | --- | --- |
| A window holds | the tile; it never grows past what a miss needs | 64 KiB on hits, the frame on the first miss, then stays |
| W | **measured**, not chosen: candidates 4 and 8. `v35` on this host: 1→2 +67 %, 2→4 +37 %, 4→16 +28 % | **2** — the wire is ~200× slower than a warm read |
| Memory per session at W | 8 × 16 KiB = 128 KiB | 2 × frame: 500 KB at 250 KB frames once the session has missed |
| Latency means | first byte per tile: device parallelism | steady cadence: the sender never waits |

**W is not one number across modes.** Tile W and fill W = 2 can differ. What happens if one
session uses both modes is unspecified for now — fill is start-to-end only.

**How much RAM a fill uses.** Each fill session has two buffers (W = 2). After a miss, each
buffer is as tall as one frame.

```
1 session     ×  2 buffers  ×  250 KB  =  500 KB
1000 sessions                          =  500 MB
```

We have not run a thousand fills. If 500 MB is too much, the later fix is: keep each buffer
at 64 KiB and take several disk trips per frame. Do not build that until a run says the
500 MB bites.

## 6 · Order of work, and what each step solves

The final shape is what matters; the steps are just the order that gets there without
measuring the wrong thing.

| Step | Solves | Leaves |
| --- | --- | --- |
| **1. Change A** (review §3), W parametric, `upcoming` an iterator | the seam; fault 1's container defect; W can become more than 2 | W stays 2; single asks still depth 1 |
| **2. `StreamFrames` + `EndStream`**, the reader task and channel (§6d B) | fill; on-demand pipelined asks get `min(pipelined, W)`; `EndStream` seen between frames | the value of W for tiles |
| **3. W for tiles, measured** with the harness at client depths 2, 4, 8 against batches of the same size | the number | — |
| **4. P0**, then change B and P1 together | whether the ring stays; the ownership; the eventfd | — |

Step 1 first because it is the only one that makes W a parameter, and because the loop then
has one `ctx.frame(...)` call site to feed. Step 3 before step 4 because W is worth measuring
on the shipped mechanism, and P0 decides on the target, not on this host.

**Checks** are the review's: the twelve read-path and ring tests as the specification, the
two wire tests for the bytes, one new test pinning the write chunk at `READ_WINDOW` on a
`force_pool_reads` store, and every measurement interleaved against a worktree build.

## 7 · Still open

* **W for tiles**: 4, 8, or per link? The harness run in step 3 answers the first two.
* **`EndStream` granularity**: the next frame boundary is ~1 ms at 250 KB. Is that enough, or
  does a fill on per-frame uni streams also reset the frame in progress (§5 of the loop ADR)?
* **Fill then on-demand on one session**, and a second `StreamFrames` after `EndStream`: not
  specified.
* **Memory at thousands of fills** (§5): measure before building the block pool.

## 8 · Review of this iteration — resolve each item, then delete this section

Second pair of eyes on the 2026-09-08 iteration. Each item is a fix or a decision; none
re-opens what §1–§7 settle. Facts checked against the code on the day.

**Fixes — the text is wrong or inconsistent as written**

1. **The `EndStream` hole reopens if any other message arrives during a fill.** The channel
   holds every FoD message and has capacity `W − 1`. If a client sends a `RequestFrame`
   during a fill, the loop's `try_recv` takes it (what does it do with it?), and the next one
   fills the channel, so the reader task blocks and the `EndStream` behind it never enters.
   §3's guarantee depends on the channel never being full of anything but what the loop
   consumes. Decide one rule and write it: **a data request during a fill ends the fill**
   (the client changed its mind; this also gives "fill then on-demand" and "seek" for free —
   a second `StreamFrames` is a seek), or **a data request during a fill is refused** with
   `FrameError`. Either keeps the channel draining. "Unspecified" is the one answer that does
   not.
2. **Which W sizes the channel?** §5 says W differs per mode and the session's mode is not
   known when the channel is built. Capacity is therefore `W_tiles − 1`, the larger, and the
   fill's 2 is the read path's per-mode cap on how many of `upcoming` it starts — two
   numbers, not one, and §1's table should say so.
3. **The memory fallback in §5 is the shape superseded on 2026-09-07.** "Keep each buffer at
   64 KiB and take several disk trips per frame" is windowed escalation: 2–3 round trips per
   250 KB frame, 1 404 vs 4 539 f/s ([`adr.md`](adr.md) §3). The fallback that keeps one
   round trip is a **vectored read into fixed 64 KiB blocks** (`preadv`, or `Readv` on the
   ring). Replace the sentence.
4. **On-demand memory assumes 16 KiB tiles.** `RequestFrame` also serves whole frames, and a
   window grows to what it escalates: at W = 8 and 250 KB frames a session that has missed
   holds 2 MB, a thousand of them 2 GB. Give both numbers in §5; the tile number alone
   decides W = 8 for the wrong workload.
5. **The ring's queue is built for two slots.** `IoUring::builder().build(8)` and a partial
   read re-submits, so W = 8 can hit the "io_uring SQ full" error path under load. Step 3
   sizes entries at `2 × W`; the review's change B is where it lands.
6. **§6d's shape takes one `next`; depth `W − 1` needs several.** To reach
   `min(pipelined, W)` the loop drains the channel into a small local FIFO of asks (a
   `RequestFrames` expands to its list) until `W − 1` frames are known or the channel is
   empty; `upcoming` iterates that FIFO. `EndSession` found while draining is processed at
   its place in the FIFO, which is invariant 2 restated for the drained form.

**Decisions to take now — they change what gets built**

7. **W on the pool path.** Where a session has no ring (`RWF_NOWAIT` refused, ring refused,
   the `pool` kill switch), every read in flight is a blocking thread, and tokio caps those at
   512 per process. W = 8 there is 64 missing sessions to the cap. Cap W at 2 whenever the
   escalation is the pool, whatever the mode.
8. **`EndStream` latency on a slow link is the QUIC send window, not the frame boundary.**
   The loop stops producing within ~1 ms, but bytes already handed to QUIC still go out: up
   to the stream's send window, which at quinn's defaults is on the order of a megabyte —
   several 250 KB frames, seconds at 10 Mbps. The lever is the **client's** receive window
   for a fill session, and on the server the existing `stream_receive_window_bytes` knob in
   `server.rs`. Say which one bounds what; §7's "granularity" question is about this, not
   about the frame boundary.
9. **"No server memory grows with ask rate" is bounded, not zero.** When the channel is full,
   asks accumulate in the control stream's QUIC receive buffer, up to its receive window —
   at the default that is ~100 000 asks per session. Set the control stream's window small,
   which the same knob does, and state the bound.
10. **`upcoming` should carry frame indexes, not spans.** `store.frame_span` can fail, and an
    out-of-range look-ahead is not this frame's failure (§6d already says so). Let the read
    path resolve and skip. And write the two window rules the iterator implies: a frame
    already held by a window is not started again; a window whose frame is neither current
    nor in `upcoming` is released once its read settles.
11. **`StreamFrames` validation.** `to` inclusive; require `from ≤ to < frame_count`; refuse
    otherwise with `FrameError { frame_index: from }`. `EndStream` with no fill running is a
    no-op, not an error.
12. **Report the mode.** The per-session `session reads …` line gains the mode and W, or the
    miss rate of a fill and of a tile session become indistinguishable in production.

**Optimisations and simplifications**

13. **Fix fault 1 now, before change A.** `ready.chunks(stride)` in `stream_codestream`
    becomes `chunks(stride.min(READ_WINDOW))`: one line, plus the test the review names
    (a 250 KB frame on a `force_pool_reads` store, every piece ≤ `READ_WINDOW`). It is a
    defect on the deployment [`DEPLOYMENT.md`](DEPLOYMENT.md) calls the default, and nothing
    in change A depends on it landing later.
14. **Split step 2.** 2a: the reader task and channel alone — no new messages, and the harness
    measures pipelined `RequestFrame` depth the same day. 2b: `StreamFrames` and `EndStream`,
    which need the wire format and a client. Same end state, half the blast radius per step.
15. **Head-of-line at W = 8 is inherent and bounded.** Reads land out of order, delivery is
    FIFO, so a missed head frame delays landed frames by one device read. Keep FIFO; per-frame
    streams do not change this without the reordering the ordering ADR rejects. Just say it.
16. **Tests this iteration owes**, each mutated once: `EndStream` mid-fill stops within one
    frame; `EndSession` mid-fill ends the session; the rule from item 1; pipelined
    `RequestFrame` reaches `W − 1` in `upcoming`; a full channel still delivers `EndStream`
    under item 1's rule; a bad `StreamFrames` range is refused; the fault-1 chunk bound.
