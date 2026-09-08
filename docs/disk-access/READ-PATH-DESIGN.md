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
on it says that.

**One rule covers seek and mode switch: a data request during a fill ends the fill** at the
next frame boundary and is then served. A `RequestFrame` or `RequestFrames` puts the session
back on demand; a second `StreamFrames` is a seek. The newest request is what the server is
doing — the simplest thing a client can reason about, and the only rule under which the
channel never holds a message the loop will not consume.

`EndStream` is not session-wide — that is `EndSession`. It stops the fill and sends nothing
after it.

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
        between frames: try_recv → EndStream ends the fill; EndSession ends the session;
                        any data request ends the fill and becomes `current`
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

We have not run a thousand fills. If 500 MB is too much, the later fix is a **vectored read
into fixed 64 KiB blocks in one round trip** (`preadv`, or `Readv` on the ring) — not several
disk trips per frame, which is the windowed escalation measured at a third of the throughput
and superseded on 2026-09-07 ([`adr.md`](adr.md) §3). Do not build it until a run says the
500 MB bites.

## 6 · Order of work, and what each step solves

**Fill is built on the read path that ships.** The double buffer is already fill's W of 2,
`serve_one(frame, next)` already reads ahead, and `x15` showed this reader ties every
alternative on a sequential stream at the device's rate. Change A stays valuable as the step
that makes W a parameter for tiles; it does not gate fill, and fill gets measured on code
that was validated rather than on a refactor that was not.

| Step | Solves | Size | Leaves |
| --- | --- | --- | --- |
| **0. Fault 1** — bound the write chunk at `READ_WINDOW` in `stream_codestream`, with the review's test | a 250 KB uninterrupted executor copy on the default container deployment | one line, one test | — |
| **1. The reader task and channel** (§6d B), no new messages | pipelined `RequestFrame` gets `min(pipelined, W)`; control seen between frames | ~15 lines | fill has no message yet |
| **2. `StreamFrames` + `EndStream`** on that loop, reciting `from..=to` through `serve_one`, with the rule in §2 | fill, seek, mode switch | ~30 lines of loop, two variants, client support | W stays 2 everywhere |
| **3. Change A** (review §3), W parametric, `upcoming` an iterator | the seam; W can become more than 2 | ~120 lines rewritten | the number |
| **4. W for tiles, measured** with the harness at client depths 2, 4, 8 | the number | a run | — |
| **5. P0**, then change B and P1 together | whether the ring stays; the ownership; the eventfd | | — |

Steps 0–2 are this week's, in that order. Step 3 waits until step 4 is wanted, because W
above 2 is the only thing it unlocks. Step 5 decides on the target, not on this host.

**Checks** are the review's: the twelve read-path and ring tests as the specification, the
two wire tests for the bytes, one new test pinning the write chunk at `READ_WINDOW` on a
`force_pool_reads` store, and every measurement interleaved against a worktree build.

**Two measurements prove steps 1 and 2, and nothing else is measured this week.** The harness
pipelining `RequestFrame` at depth 4 before and after step 1, interleaved: miss-dominated
cells move toward the batch path's +73.8 % ([`v36_readahead.tsv`](v36_readahead.tsv)), warm
cells tie. And a `StreamFrames` fill on the 1 GiB fixture against the campaign's `product`
arm going forward: the reference is `x15`, ~3 µs per 16 KiB read at the device's rate
([`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md)). Widening W, ring sizing and the pool-path
cap belong to step 3 and wait for these two.

## 7 · Still open

* **W for tiles**: 4, 8, or per link? The harness run in step 3 answers the first two.
* **`EndStream` and the wire.** The server stops producing within one frame, but bytes
  already handed to QUIC still drain, and on a slow link that is the client's receive window,
  not the server. A fill client that wants a fast stop keeps that window small. Whether a
  fill on per-frame uni streams should also reset the frame in progress (§5 of the loop ADR)
  is open.
* **Memory at thousands of fills** (§5): measure before building the block reads.
