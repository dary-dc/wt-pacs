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

## 8 · Proposed implementation — steps 0 to 2

Written against the code as it stood when this design was agreed, not against anything
landed since; shape, not final code. Everything here is `server/` plus two message variants
and one client call. Change A (step 3) is sketched at the end only as far as its signatures.

### Step 0 · Bound the write chunk

`stream_codestream` keeps `stride = store.read_window(span.len)` for how much to ask the
store for — the whole frame where `RWF_NOWAIT` is refused, which is what saves the pool round
trips — and bounds what it hands the wire:

```rust
for piece in ready.chunks(stride.min(READ_WINDOW)) {
    uni.write_all(piece).await.context("write codestream")?;
}
```

To test it, `stream_codestream` takes `uni: &mut impl AsyncWrite + Unpin` (wtransport's
`SendStream` is one); the test drives it with a sink that records every `poll_write` length
against a store under `force_pool_reads()` and a frame of `3 × READ_WINDOW + 17` bytes, and
asserts no write exceeds `READ_WINDOW` and the concatenation is the frame. Mutate by removing
the `.min`.

### Step 1 · The ask reader and the channel

One task owns the control stream for the session's life. The channel carries what it read,
errors included, so a broken control stream ends the session instead of hanging it.

```rust
/// Asks the loop may hold beyond the frame in hand: one per window the read path can start.
const LOOKAHEAD: usize = read_path::WINDOWS - 1;

fn spawn_ask_reader(mut control_recv: RecvStream) -> mpsc::Receiver<Result<FodMsg>> {
    let (tx, rx) = mpsc::channel(LOOKAHEAD);
    tokio::spawn(async move {
        loop {
            match read_fod_msg(&mut control_recv).await {
                Ok(Some(msg)) => if tx.send(Ok(msg)).await.is_err() { break },
                Ok(None) => break,
                Err(err) => { let _ = tx.send(Err(err)).await; break }
            }
        }
    });
    rx
}
```

`read_fod_msg` is untouched: it is still the only reader of the stream, start to finish, so
its non-cancel-safety stops mattering. `WINDOWS` becomes `pub(crate)` so the two halves of
depth share one constant.

The loop takes one message, looks for the next without waiting, and serves. `EndSession` is
handled where it sits in the sequence, never earlier.

```rust
async fn run_session<P: FramePipeline>(
    pipeline: &mut P,
    mut control_send: SendStream,
    control_recv: RecvStream,
) -> Result<()> {
    let mut asks = spawn_ask_reader(control_recv);
    let mut current = asks.recv().await;
    while let Some(msg) = current {
        current = match msg? {
            FodMsg::EndSession => break,
            FodMsg::RequestFrame { frame } => {
                let next = asks.try_recv().ok();
                pipeline.serve_one(frame, first_frame(&next), &mut control_send).await?;
                match next { Some(m) => Some(m), None => asks.recv().await }
            }
            FodMsg::RequestFrames { frames } => {
                pipeline.serve_batch(&frames, &mut control_send).await?;
                asks.recv().await
            }
            FodMsg::StreamFrames { from, to } => {
                fill(pipeline, &mut asks, from, to, &mut control_send).await?
            }
            FodMsg::EndStream => asks.recv().await,
            FodMsg::FrameError { .. } => asks.recv().await,
        };
    }
    pipeline.drain_acks().await;
    Ok(())
}

/// The frame a pipelined message would ask for first, so the frame in hand can read ahead.
fn first_frame(next: &Option<Result<FodMsg>>) -> Option<u32> {
    match next {
        Some(Ok(FodMsg::RequestFrame { frame })) => Some(*frame),
        Some(Ok(FodMsg::RequestFrames { frames })) => frames.first().copied(),
        _ => None,
    }
}
```

`serve_one(frame, next, control)` and `serve_batch` are the existing calls; nothing below the
pipeline changes in this step. A client that pipelines two `RequestFrame`s now gets the same
read-ahead a two-element batch gets, and `EndStream` without a fill is a no-op.

### Step 2 · Fill

Two variants and one function. The loop's rule is in the one `match`: whatever is found in the
channel between frames ends the fill, and everything except `EndStream` becomes the next
`current`.

```rust
// common/fod
StreamFrames {
    #[serde(default)] from: Option<u32>,   // None → 0
    #[serde(default)] to: Option<u32>,     // None → the last frame; inclusive
},
EndStream,
```

```rust
/// Recite `from..=to` through the ordinary per-frame path, looking at the channel between
/// frames. Returns the message that ends the fill, or the next one read when it completes.
async fn fill<P: FramePipeline>(
    pipeline: &mut P,
    asks: &mut mpsc::Receiver<Result<FodMsg>>,
    from: Option<u32>,
    to: Option<u32>,
    control: &mut SendStream,
) -> Result<Option<Result<FodMsg>>> {
    let last = pipeline.store().frame_count().saturating_sub(1);
    let (from, to) = (from.unwrap_or(0), to.unwrap_or(last));
    if from > to || to > last {
        pipeline.refuse(control, from, anyhow!("StreamFrames {from}..={to} outside 0..={last}")).await?;
        return Ok(asks.recv().await);
    }
    for frame in from..=to {
        match asks.try_recv() {
            Ok(Ok(FodMsg::EndStream)) => return Ok(asks.recv().await),
            Ok(msg) => return Ok(Some(msg)),
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => return Ok(None),
        }
        pipeline.serve_one(frame, (frame < to).then(|| frame + 1), control).await?;
    }
    Ok(asks.recv().await)
}
```

That is the whole of fill: `serve_one` already reads the next frame ahead, so a fill runs at
depth 2 with the double buffer that ships, and QUIC paces it because `write_all` waits when
the client stops reading. An empty study refuses with `from`. The per-session summary line
gains `fills=N` so a fill's miss rate is not read as a tile session's.

Client: `transport-wasm` gains `stream_frames(from, to)` and `end_stream()`, both one
`encode_fod_msg` each; the harness gains `--mode fill` so the measurement in §6 can run.

### Tests, each mutated once

Unit tests drive `run_session` and `fill` with a test `FramePipeline` that records what it
was asked to serve, over a channel pre-loaded with the messages of the case, so nothing
depends on timing.

| Test | Claim |
| --- | --- |
| `pipelined_asks_supply_the_next_frame` | two `RequestFrame`s in the channel: the first is served with `next` = the second |
| `a_batch_after_a_single_ask_supplies_its_first_frame` | `RequestFrame` then `RequestFrames`: `next` is the batch's first |
| `a_fill_recites_from_to_inclusive_in_order` | `StreamFrames { 3, 7 }` serves 3, 4, 5, 6, 7, each with the next named |
| `end_stream_stops_a_fill_before_the_next_frame` | `EndStream` in the channel at frame *k*: nothing after *k* is served, the session continues |
| `a_data_request_during_a_fill_ends_it_and_is_served_next` | `RequestFrame { 9 }` found mid-fill: the fill stops and 9 is served |
| `end_session_during_a_fill_ends_the_session` | `EndSession` mid-fill: nothing more is served, `run_session` returns |
| `a_bad_range_is_refused_with_from` | `from > to`, or `to` past the study: `refuse` with `from`, no frame served |
| `a_reader_error_is_the_session_error` | an `Err` in the channel makes `run_session` return it |
| `every_write_is_at_most_one_window_where_nowait_is_refused` | step 0 |

The existing end-to-end batch test stays as the proof that bytes did not change, and a
second one sends `StreamFrames {}` over the wire and receives the whole study in order.

### Step 3, only as far as its signatures

When W above 2 is wanted, change A replaces `ReadCtx::read(span, pos, next)` with:

```rust
pub fn frame(&mut self, store: &Arc<FrameStore>, span: FrameSpan,
             upcoming: impl Iterator<Item = u32>) -> FrameBytes<'_>;
impl FrameBytes<'_> { pub async fn next(&mut self) -> Result<Option<&[u8]>>; }
```

`windows: Vec<Window>` sized by W, `upcoming` consumed for at most `W − 1` frames not already
held, and `LOOKAHEAD` follows W. The loop above does not change: `first_frame` becomes the
frames the channel holds, `fill` passes `frame + 1..=to`. Nothing in steps 0–2 is undone.
