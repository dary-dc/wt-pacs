# Read path — design proposal: depth, messages, and the loop around the seam

**2026-09-08 · Proposed, not implemented. For iteration.** This is the design the owners asked
for, assembled from what was agreed on the day. It builds on three documents and repeats
none of them:

* [`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md) — the seam. Change **A** moves the frame loop
  into the read path behind `ctx.frame(span, next)`; change **B** makes a window own its ring
  slot, after P0. Both stand as written there.
* [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6d — the
  session loop. Option **B** there, an ask-reader task feeding a bounded channel, stands too.
* [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md) — the sequential reader is the same reader
  going forward, one frame ahead.

What this document adds: how many reads are in flight and who decides it, the messages,
the numbers per use case, and the order to build in. **`RequestFrame` stays.** Nothing here
changes the wire format of an existing message.

## 1 · Depth is two quantities

```
 client ──asks──▶ ask-reader task ──channel──▶ serving loop ──"these are next"──▶ read path ──reads──▶ device
                  owns the control stream       holds the ask in hand,            holds W windows,
                  never blocks the loop         sees L more in the channel        starts ≤ W reads
```

| | Loop depth **L** | Read depth **R** |
| --- | --- | --- |
| Meaning | asks the server has in hand beyond the one being served | device reads outstanding at once |
| Comes from | `RequestFrames`: the rest of the list. `RequestFrame`: the channel, when the client pipelined. `StreamFrames`: the server's own sequence, unbounded | the read path: one window and one ring slot per read |
| Cap | channel capacity, `W − 1` | **W**, a parameter of the read path; the server's defensive cap |
| Effective in flight | | `min(what the client has outstanding, W)` |

Neither half is a fixed number. The client decides how much it wants outstanding; the server
bounds what it can hold, with **backpressure rather than refusal**: the ask reader stops
pulling from the control stream when the channel is full and QUIC flow control does the
rest. No server memory grows with a greedy client.

R above 1 needs R buffers: a read has to land somewhere. That is physics, not design. The
double buffer that ships is R = 2 in its smallest form; change A makes W a parameter and
removes the flip that cannot become 4.

## 2 · Messages

| Message | Status | What the read path is told is coming | Reads in flight |
| --- | --- | --- | --- |
| `RequestFrame { frame }` | **kept** | whatever else is already in the channel, up to `W − 1` | `min(pipelined, W)` |
| `RequestFrames { frames }` | kept | the rest of the list | `min(len, W)` |
| `StreamFrames { from }` | **new** | every frame from `from` to the end | **2**, by construction |
| `Stop` | **new** | ends a stream at the next frame boundary; seek is `Stop` then `StreamFrames { from }` | |
| `EndSession` | kept | | |

`StreamFrames` exists because a stream is the server reciting its own index: the client
says where to start, the server knows the rest, and QUIC flow control paces it — when the
client stops reading, `write_all` waits and the read-ahead waits with it. It also fixes the
reads-in-flight number for the sequential case without a mode flag anywhere: the message
type is the mode.

Delivery order is ask order, always. Reads land in any order; a slow head frame delays the
delivery of the ones behind it, never their reads. That is the pipelining
[`../adr-reject-server-ordering.md`](../adr-reject-server-ordering.md) allows.

## 3 · The loop, the seam, the reader

**The loop** is §6d option B with one change: the channel capacity is `W − 1`, tied to the
read path, so the loop never holds an ask the read path cannot start.

```
reader task:  control stream ──▶ channel(W − 1)
loop:
    current = recv()
    upcoming = the rest of a batch, or the stream sequence, or what try_recv finds
    serve(current, upcoming)
    a Stop or EndSession found in the channel is acted on here, between frames
```

**The seam** is change A, with `next` widened from one frame to the frames the loop knows:

```rust
/// Bytes of one frame; reads of `upcoming` started under them, as many as free windows allow.
/// With W = 2 this is exactly READ-PATH-REVIEW.md's `frame(span, next)`.
pub fn frame(&mut self, store: &Arc<FrameStore>, span: FrameSpan, upcoming: impl Iterator<Item = FrameSpan>)
    -> FrameBytes<'_>;
```

The order inside is the one the review pins, because it is the one that was measured:
adopt or start the current frame, then start what fits, then wait. `upcoming` is an iterator
so a stream can say "to the end" without materialising it; the read path takes at most
`W − 1` from it and never guesses — everything it starts is an ask the client already sent.

**The reader** is the shipped mechanism. `RWF_NOWAIT` inline for a hit, the ring built on the
first miss for the rest of the frame, the pool as fallback. Change B reshapes its ownership
later; nothing here depends on B.

## 4 · Numbers per use case

The two use cases want different sizes, and they get them from one mechanism with two
numbers, because a window already sizes itself to what it escalates.

| | Tiles | Sequential stream |
| --- | --- | --- |
| A window holds | the tile; it never grows past what a miss needs | 64 KiB on hits, the frame on the first miss, then stays |
| W | **measured**, not chosen: candidates 4 and 8. `v35` on this host: 1→2 +67 %, 2→4 +37 %, 4→16 +28 % | **2** — the wire is ~200× slower than a warm read |
| Memory per session at W | 8 × 16 KiB = 128 KiB | 2 × frame: 500 KB at 250 KB frames once the session has missed |
| Latency means | first byte per tile: device parallelism | steady cadence: the sender never waits |

The one number that is a real trade is the stream's: thousands of streaming sessions on
studies larger than RAM each hold two frame-sized windows. If it bites, the lever is a
vectored read into fixed 64 KiB blocks — one round trip into several small buffers — and it
is not needed until measured to bite.

## 5 · Order of work, and what each step solves

| Step | Solves | Leaves |
| --- | --- | --- |
| **1. Change A** (review §3), W parametric, `upcoming` an iterator | the seam; fault 1's container defect; W can become more than 2 | W stays 2; single asks still depth 1 |
| **2. `StreamFrames` + `Stop`**, the reader task and channel (§6d B) | sequential serving; single asks pipelined get `min(pipelined, W)`; control seen between frames | the value of W for tiles |
| **3. W for tiles, measured** with the harness at client depths 2, 4, 8 against batches of the same size | the number | — |
| **4. P0**, then change B and P1 together | whether the ring stays; the ownership; the eventfd | — |

Step 1 first because it is the only one that makes W a parameter, and because §6d's other
caller of the seam is then one `ctx.frame(...)` call site to feed rather than a second
refactor. Step 3 before step 4 because W is worth measuring on the shipped mechanism, and
P0 decides on the target, not on this host.

**Checks** are the review's: the twelve read-path and ring tests as the specification, the
two wire tests for the bytes, one new test pinning the write chunk at `READ_WINDOW` on a
`force_pool_reads` store, and every measurement interleaved against a worktree build.

## 6 · Open for iteration

* **W for tiles**: 4, 8, or per link? The harness run in step 3 answers the first two.
* **`Stop` granularity**: the next frame boundary is ~1 ms at 250 KB. Is that enough, or does a
  stream on per-frame uni streams also reset the frame in progress (§5 of the loop ADR)?
* **Does `StreamFrames` need a `to`?** Not for start-to-end; only if a client wants a range.
* **Memory at thousands of streams** (§4): measure before building the block pool.
* **The change-of-direction question** for tile clients — pipelined single asks against
  batches — is the owners' to settle, with a harness run if they want one; nothing in this
  design depends on the answer, because both messages feed the same `upcoming`.
