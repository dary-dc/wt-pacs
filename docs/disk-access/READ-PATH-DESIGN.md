# Read path — design proposal: depth, messages, and the loop around the seam

**2026-09-08 · Proposed. 2026-09-09 · §13 landed; §15 is the plan to fix it, §16 the review
of that plan as applied and the first product-level numbers, §17 the proposals §16 left
open, §18 those proposals as code an implementer can apply, §19 the verification against
`580e312` — it works, and it optimises at client depth 4 — and §20 the alternatives (the
other rings, the pool, mmap) re-measured against the code that ships.** Assembled
from what was agreed on the day. Steps 0–2 and the four §13 commits (W = 4, planner, thin
ring) are in the tree ([`HANDOFF.md`](HANDOFF.md) §1) — **unmeasured**: §13.2's A/B gate was
never run, and §15.1 has what a mutation pass found. §9 records why the loop and W are not
where latency is lost on the default link; remaining: the throttled-link cell, P0. It builds
on three documents and repeats none of them:

* [`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md) — the seam. Change **A** moves the frame loop
  into the read path behind `ctx.frame(...)`; change **B** makes a window own its ring slot,
  after P0. Both stand as written there.
* [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6d — the
  session loop. Option **B** there, an ask-reader task feeding a bounded channel, stands too.
  Channel capacity is **`ASKS_AHEAD`**, shared with `in_hand`; the read path takes at
  most `WINDOWS − 1`.
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
| Cap | channel and `in_hand` share `ASKS_AHEAD` (control messages only) | **W**, a parameter of the read path |
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
| `RequestFrame { frame }` | **kept** | other asks already in the channel, up to `ASKS_AHEAD` | `min(pipelined, W)` |
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

**The loop** is §6d option B. Channel and `in_hand` share `ASKS_AHEAD`; the read path takes at most `WINDOWS − 1`.

```
reader task:  control stream ──▶ channel(ASKS_AHEAD)     // FoD messages only
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
building a `Vec`. The read path takes at most `WINDOWS − 1` from it.

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

**Fill is built on the read path that ships.** Steps 0–2 landed 2026-09-09. The four commits
in §13 replace steps 3–4: window table at W = 2, thin ring, planner, then `WINDOWS = 4`.
Change A (`frame()` + `FrameBytes`) is deferred. P0 then change B-as-was is subsumed; P1
waits for P0.

| Step | Solves | Size | Leaves |
| --- | --- | --- | --- |
| **0–2.** Fault 1, ask-reader, `StreamFrames` + `EndStream` | fill, seek, pipelined `RequestFrame` | landed | — |
| **§13 commits 0–3.** A/B script, cuts 3–6, planner, W = 4 | tiles at W = 4, fill at 2, one serve path | landed | the throttled-link cell, P0 |
| **5. P0**, then P1 | whether the ring stays; the eventfd | | — |

**Checks** are the review's: the twelve read-path and ring tests as the specification, the
two wire tests for the bytes, one new test pinning the write chunk at `READ_WINDOW` on a
`force_pool_reads` store, and every measurement interleaved against a worktree build.

**The interleaved A/B is `lab/scripts/read_path_ab.sh`.** Run it for changes under
`server/src/media/`. The throttled-link cell is §9.4, after this landing.

## 7 · Still open

* **W for tiles**: ~~4, 8, or per link?~~ **4 on the lab numbers — §9.3, §9.5.** P0's depth ladder on the target is what could move it to 8 or 16.
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

## 9 · Latency on the default link — what the loop and W can and cannot buy

**2026-09-09, after steps 0–2 landed.** The owners' default link is medium-to-bad wireless.
The loss-run branch (`cursor/l1-loss-run-dbae`, its `docs/transport-conclusions.md`) measured
on two profiles, **50 ms / 20 Mbps** and **600 ms / 8 Mbps**, and settled two things this
design inherits: **one shared stream** — per-frame streams are 5.76× worse at 250 KB under
1 % loss on real hardware, and no cell on either rig favours them — and Cubic by default.
What follows is arithmetic on those rates against read costs the lab measured. None of it is
an end-to-end measurement; §9.4 names the one to run. It is written down because its
conclusion — **the loop and W are not where latency is lost on this link** — is the kind
that gets forgotten and re-argued.

### 9.1 · Why the serial loop does not hurt here

An ask passes three stages in series: the read on the server, QUIC's send buffer, the wire.
On one shared stream delivery is FIFO whatever the server does, so serving asks in parallel
on the server can only help when the server is the slowest stage. On the default link it is
not, by two to four orders of magnitude:

| per 16 KiB tile | time |
| --- | --- |
| wire at 20 Mbps | 6.5 ms |
| wire at 8 Mbps | 16 ms |
| server, hit (`v36` warm p50) | 2 µs |
| server, miss on the lab NVMe (`v36` cold p50) | 65 µs |
| server, miss on a cloud volume | **unmeasured** — ~1 ms is the usual figure, and P0's job |

A 250 KB frame is 100 ms of wire at 20 Mbps and 250 ms at 8 Mbps.

The loop as landed reads the next ask while the current frame is written (step 1's peek), so
the read of ask *n + 1* overlaps the write of ask *n*. That is all the parallelism the wire
can use: QUIC's send buffer holds more than one window, and a 65 µs read never drains it.

**Where latency is lost on this link is the queue in front of a new ask, not the loop.**
After a change of direction the newest ask waits behind every byte already handed to QUIC:
100 ms per 250 KB frame queued ahead at 20 Mbps, 250 ms at 8 Mbps. No server-side
parallelism shortens that — the stream is FIFO, and per-frame streams, which could, lost the
loss run. What shortens it is queueing less: the **client's cap on asks in flight, chosen per
link**, and the server's send window. Both are client-protocol and transport levers, not
read-path ones, and the client cap is the one lever on this link that moves latency at all.

### 9.2 · What W = 2 covers

W = 2 is one window written while the next is read. The wire idles only when a read takes
longer than the wire needs to drain one window:

| link | wire per 64 KiB window | over a 65 µs lab miss | over a ~1 ms cloud miss |
| --- | --- | --- | --- |
| 8 Mbps | 66 ms | 1000× | 66× |
| 20 Mbps | 26 ms | 400× | 26× |
| 100 Mbps | 5 ms | 80× | 5× |
| 1 Gbps | 0.5 ms | 8× | **server-bound** |

* **Fill on wireless: covered.** Sequential and wire-bound at every rate above; read-ahead
  by one never falls behind.
* **On-demand tiles on wireless: covered.** What W changes is server time only. 16 cold
  tiles on the lab NVMe take 0.86 ms at depth 2 and 0.68 ms at depth 4 (`v35` medians,
  16 ÷ asks/s). That 0.2 ms sits against 105 ms of wire for the same tiles at 20 Mbps.
* **At scale the device gets its depth from the session count.** A thousand sessions at
  W = 2 is far past the ~64 reads in flight where the host stops separating arms
  ([`NEXT.md`](NEXT.md) §6). Widening W per session adds nothing there.

W = 2 is not enough in two places. A **fast link** — at 1 Gbps the same 16 tiles are 2 ms of
wire, so the 0.2 ms is 10 %, and `v35` prices depth 2 → 4 at +26 to +37 % cold throughput
(`product` and `hybrid_lazyring` arms). And a **cloud volume**, where a miss is ~15× the
lab's and W's worth scales with it — unmeasured, which is what P0 is for.

### 9.3 · Decision: tiles go to W = 4, fill stays at 2

The owners' call, 2026-09-09, with the return stated so it is not re-argued: **latency is
the first metric and the cost for tiles is 32 KiB per session, so tiles widen even though
the default link cannot show it.** Fill does not, because there the same change is pure cost.

| | tiles, W 2 → 4 | fill, W 2 → 4 |
| --- | --- | --- |
| worth on the default link | none measurable: ~0.2 ms on a 16-tile cold burst against 105 ms of wire | none: the wire sets the pace |
| worth elsewhere | LAN, and cloud-volume misses: +26 to +37 % cold throughput (`v35`), scaled by the volume's miss cost | only if a miss exceeds one window of wire — 26 ms at 20 Mbps — which no volume class does |
| memory per session | 32 → 64 KiB on hits; a miss grows each window to frame size, so 250 KB frames are W × 250 KB, not 64 KiB | after a miss, 2 → 4 frames: 500 KB → 1 MB; a thousand fills 500 MB → 1 GB |
| ring slots | 2 → 4 | 2 → 4 |
| reads that can go unwanted | none: on demand every read is an ask already sent | up to 3 frames past an `EndStream` |
| **call** | **yes**, at step 3 | **no** |

The scalability cost the owners named is the fill column, and it is why W stays two numbers
(§5) rather than one.

### 9.4 · The one cell to run, and what it can show

Before and after step 3, interleaved against a worktree build: the harness on a throttled
link — **20 Mbps, 50 ms, 1 % loss, cold tiles, client depth 4, W = 2 against W = 4**.
Expected: a tie on first byte and on time to the last tile; the only quantity that can move
is server time, and §9.2 says by how much. A tie is the result this section predicts, and
the record that the loop and W were checked on the link that matters. P0 then supplies the
miss cost on the production volume, the one number that scales W's worth.

### 9.5 · Why 4 and not 16 for tiles

`v35` also priced depth 16, and the owners asked whether latency wants it. W for tiles is the
number of a client's asks the server reads at once, so it can only help a burst larger than
itself. Cold 16 KiB tiles, one session, the lab NVMe, `product` arm, medians of 12:

| W (= asks in flight) | 1 | 2 | 4 | 16 |
| --- | --- | --- | --- | --- |
| 16-tile burst, server side | 1.37 ms | 0.86 ms | 0.69 ms | 0.45 ms |
| 4-tile burst, server side | 0.34 ms | 0.22 ms | 0.17 ms | 0.17 ms — a 4-tile ask cannot use 16 |
| per tile, steady state, p50 / p99 | 80 / 167 µs | 93 / 237 µs | 154 / 330 µs | 325 / 1221 µs |
| memory per session, per thousand | 16 KiB, 16 MB | 32 KiB, 32 MB | 64 KiB, 64 MB | 256 KiB, 256 MB |

**What 16 buys over 4: 0.24 ms on a 16-tile cold burst, nothing on a smaller one.** Against
the wire for those 16 tiles that is 0.2 % at 20 Mbps, 1 % at 100 Mbps, 11 % at 1 Gbps. In
steady state each tile waits behind 15 others instead of 3, which is the p50 doubling — the
burst ends sooner and every tile in it arrives later than it would alone.

**At scale, 16 makes the busy case worse for everyone.** `v34` on the workstation: cold
throughput is flat at ~50 k asks/s from 64 reads in flight, and from there every extra read
in flight is queue, not throughput — p50 4.9 ms at 256 in flight, 15 ms at 1024. A thousand
sessions can put 4 000 reads in flight at W = 4 and 16 000 at W = 16; at the plateau that is
80 ms against 320 ms of queue if they all burst at once. W bounds how much of the device one
session can take, and 4 is the bound that costs a quiet session 0.24 ms.

**The one place 16 could matter is unmeasured.** On a cloud volume with ~1 ms misses that
parallelise, a 16-tile burst is ~4 ms at W = 4 and ~1–2 ms at W = 16 — 2–3 ms, 2–3 % of the
20 Mbps wire, 10–14 % at 100 Mbps. That is P0's depth ladder to measure on the target, so P0
runs depths 2, 4, 8 and 16, not 4 alone. Until it does, **4 stands**, and W stays one
constant so moving it is one line.

## 10 · Simplification proposals — the shape of the code, every capability kept

Written 2026-09-09 from the design as agreed and the code as it stood before steps 0–2,
deliberately without reading what landed. The brief is `CLAUDE.md`'s: essentialist, simple,
readable by a junior — **and nothing lost**: `RequestFrame`, `RequestFrames`, `StreamFrames`
with `EndStream`, read-ahead, the ring with the pool behind it, `RWF_NOWAIT` hits, the
defensive cap, ask-order delivery and the miss reporting all stay. Each cut says what it
removes, what it keeps and how it is checked. The owners analyse, choose, and the chosen
cut is reviewed against the code before it is built.

*The first version of this section, the same day, listed six cuts that traded capability or
measured behaviour for lines (delete the ring, A-lite, windows that never grow, no W sweep
among them). Withdrawn; the ring question stays P0's rule in [`NEXT.md`](NEXT.md) §3.*

**Already proposed, restated here so the list is complete in one place.** Change **A**
([`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md) §3): one frame loop instead of one split across
two modules, `frame(span, upcoming)` and `FrameBytes::next()`, the read-ahead intent visible
once per frame. Change **B** (§4 there): a window owns its ring slot — one `unsafe fn` fewer,
one drop-order obligation fewer, `SLOTS` and `WINDOWS` become one number, after P0. **P1**
([`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md)): park on the ring's own
fd — one fd per session instead of two, ~30 lines fewer, after P0.

| cut | removes | keeps | checked by |
| --- | --- | --- | --- |
| **1** one ask unit, one serve path | `serve_batch`, its untested look-ahead, the batch-versus-pipelined distinction in the loop | `RequestFrames` on the wire, unchanged; ask order; one `refuse` per bad frame | §8's tests less the batch one, `a_batch_arrives_whole_and_in_ask_order` |
| **2** the loop is a planner; the transport is not mocked | the test-only `FramePipeline` and the pre-loaded-channel harness; timing from every loop test | every row of §8's test table, as planner tests | the same claims on the planner; the two wire tests for the transport |
| **3** one `Window` type, W of them, no `Ahead` | `Ahead`, `begin_ahead`, `abandon_ahead`, the take-ahead decode; the flip that cannot become 4 | nowait, ring and pool inside `Pending`; read-ahead as a property of "a window already holds that span" | the twelve read-path and ring tests, `v36` interleaved |
| **4** sizes have one owner each | `FrameStore::read_window` and the policy hidden in it | the whole-frame pooled read where nowait is refused; the ≤ `READ_WINDOW` write chunk | `a_pooled_frame_is_written_in_read_windows_not_in_one_copy` and the ring tests |
| **5** a named channel capacity | the `W − 1` coupling | the defensive cap; backpressure | one constant, no test change |
| **6** the ring keeps no state the window already has | the ring's own `Pending`, its slot table, `SLOTS`, `finish`'s loop; `Ring::Refused` | the ring on misses, short-read resubmission, drain on drop, the eventfd until P1 | the two ring tests and the ring rows of the read-path tests, `v36` interleaved |

**Cut 1.** The ask reader expands `RequestFrames { frames }` into one channel item per frame,
so the loop serves frames from one call, `serve_one(frame, upcoming)`, with two sources of
frame numbers: the channel on demand, the recited range in a fill. A batch and a pipelined
run of `RequestFrame` become the same thing to the loop, which is what they are on the wire.
A batch longer than the channel blocks the reader task on backpressure, which QUIC absorbs;
`EndSession` behind it is seen after it, today's order. Pairs with cut 3, where `upcoming`
is "what the channel holds" in both modes.

**Cut 2.** Split "what to serve next" from "serve it". The first is a small state machine
with no I/O — the current source (channel or range), a `poll` that yields the next control
message if one is waiting, and one method returning the next step: serve this frame with
these upcoming, refuse this range, end. The second is the transport, which only does what
the step says. Every claim in §8's test table is then a test on the state machine with a
`Vec` of messages, and the transport keeps the two wire tests as its proof. Removes the
mock, the channel from the tests, and the question of whether a test depends on timing.

**Cut 3.** The read path today has a current window and one `Ahead`, with the take-ahead
decision decoded from coordinates (review fault 4). Make it `windows: [Window; W]`, each
`{ span, buf, state: Idle | Reading(Pending) | Ready }`, and one rule: *for each wanted span
not already held, start it in a free window; wait on the window holding the current span; a
window whose span is no longer wanted is free.* "Ahead" stops being a concept — it is a window
that holds a span nobody has asked to wait on yet — so `abandon_ahead` has nothing to
abandon. The `RWF_NOWAIT` probe runs inside `Window::start` and either fills the buffer
(`Ready`) or hands back a ring or pool `Pending`; `Pending::Ready` goes. This is the slot
table step 3 needs whichever seam shape is chosen, and with B each window carries its slot.

**Cut 4.** `read_window(len)` on the store answers a read-path question — it returns the
whole frame when the probe is refused, which is a policy, not a property. Let the store say
one thing, whether nowait works on this file, and let the read path own how much to read per
call and the transport own how much to write per call. Two sizes, two owners, both named at
the one place each is decided. This is the review's "two chunk sizes" note done fully.

**Cut 6.** `uring_reader.rs` keeps, per slot, the address, length, progress and offset of a
read whose buffer, length and offset the window in `read_path.rs` already knows. Make the
ring a thin wrapper — submit, reap, park, drain — and let the window track its own progress.
One source of truth for what is being read into where, no slot table, one constant instead
of two, and `Ring::Refused` folds into `Off` since both mean "use the pool". §11 has the
code; the honest expectation is fewer pieces at about the same line count.

**Cut 5.** `W − 1` makes the server's cap on asks held ahead a side-effect of a read-path
constant. Name it — `ASKS_AHEAD`, in the loop — and let the read path take what fits. One
sentence of explanation disappears and the two constants can move independently.

**Not proposed, because measured against** — listed so they are not proposed again: every
read through the ring (hits +106 % / +298 % at depth 2 / 4, [`adr.md`](adr.md) §5); SQPOLL
(2.2–2.8× CPU warm, [`RERUN.md`](RERUN.md)); `tokio::fs::File` (15× per read, `x15`); mmap
with pre-touch (a hop per ask, [`adr.md`](adr.md) §5); per-frame streams (5.76× under loss,
the loss-run branch); server-side reordering
([`../adr-reject-server-ordering.md`](../adr-reject-server-ordering.md)); deleting the ring
outright (P0's rule, not a shape choice).

## 11 · The cuts as code

Shape, not final code: written against the design and the read path as it stands, without
the loop that landed in steps 1–2, so the loop sketches are checked against
`server/src/transport/server.rs` when a cut is chosen. Each block is what a reader would
find in the file afterwards.

### Cut 1 · one ask unit, one serve path

```rust
/// What the loop consumes: one item per frame, whichever message carried it.
enum Ask {
    Frame(u32),
    Fill { from: Option<u32>, to: Option<u32> },
    EndStream,
    EndSession,
    Failed(anyhow::Error),
}

/// How many asks the server holds beyond the frame being served (cut 5).
const ASKS_AHEAD: usize = 8;
/// A fill reads one frame ahead: two windows, §9.3. Tiles are bounded by `WINDOWS` instead.
const FILL_AHEAD: usize = 1;

fn spawn_ask_reader(mut control: RecvStream) -> mpsc::Receiver<Ask> {
    let (tx, rx) = mpsc::channel(ASKS_AHEAD);
    tokio::spawn(async move {
        loop {
            let asks = match read_fod_msg(&mut control).await {
                Ok(FodMsg::RequestFrame { frame }) => vec![Ask::Frame(frame)],
                Ok(FodMsg::RequestFrames { frames }) => frames.into_iter().map(Ask::Frame).collect(),
                Ok(FodMsg::StreamFrames { from, to }) => vec![Ask::Fill { from, to }],
                Ok(FodMsg::EndStream) => vec![Ask::EndStream],
                Ok(FodMsg::EndSession) => vec![Ask::EndSession],
                Ok(FodMsg::FrameError { .. }) => continue,
                Err(err) => vec![Ask::Failed(err)],
            };
            for ask in asks {
                if tx.send(ask).await.is_err() {
                    return;
                }
            }
        }
    });
    rx
}
```

`serve_batch` is gone; a batch is frames in the channel, and a pipelined `RequestFrame` is
the same. `FramePipeline` keeps one serving method, `serve(frame, upcoming: &[u32])`, which
is `serve_one` with its `next` widened. The loop that consumes `Ask` is cut 2.

### Cut 2 · the loop is a planner; the transport is not mocked

```rust
/// The next thing to do. Decided without I/O, so it is tested with a `Vec`.
enum Step {
    Serve { frame: u32, upcoming: Vec<u32> },
    Refuse { frame: u32, reason: String },
    Wait,
    End,
}

struct Planner {
    in_hand: VecDeque<Ask>,
    fill: Option<(u32, u32)>, // next frame to recite, last frame
    frames: u32,
}

impl Planner {
    fn push(&mut self, ask: Ask) {
        self.in_hand.push_back(ask);
    }

    /// `poll` yields asks that arrived since the last step; a fill checks it between frames.
    fn next(&mut self, mut poll: impl FnMut() -> Option<Ask>) -> Result<Step> {
        while let Some(ask) = poll() {
            self.in_hand.push_back(ask);
        }
        loop {
            if let Some((frame, to)) = self.fill {
                if self.in_hand.is_empty() {
                    self.fill = (frame < to).then_some((frame + 1, to));
                    let upcoming = (frame + 1..=to).take(FILL_AHEAD).collect();
                    return Ok(Step::Serve { frame, upcoming });
                }
                self.fill = None; // whatever arrived ends the fill; a data request is served next
                if matches!(self.in_hand.front(), Some(Ask::EndStream)) {
                    self.in_hand.pop_front();
                }
            }
            return match self.in_hand.pop_front() {
                None => Ok(Step::Wait),
                Some(Ask::EndSession) => Ok(Step::End),
                Some(Ask::Failed(err)) => Err(err),
                Some(Ask::EndStream) => continue,
                Some(Ask::Fill { from, to }) => match fill_range(from, to, self.frames) {
                    Ok(range) => {
                        self.fill = Some(range);
                        continue;
                    }
                    Err(reason) => Ok(Step::Refuse { frame: from.unwrap_or(0), reason }),
                },
                Some(Ask::Frame(frame)) => {
                    let upcoming = self.in_hand.iter().filter_map(Ask::frame).take(ASKS_AHEAD).collect();
                    Ok(Step::Serve { frame, upcoming })
                }
            };
        }
    }
}

async fn run_session<P: FramePipeline>(p: &mut P, mut asks: mpsc::Receiver<Ask>) -> Result<()> {
    let mut plan = Planner::new(p.store().frame_count());
    loop {
        match plan.next(|| asks.try_recv().ok())? {
            Step::Serve { frame, upcoming } => p.serve(frame, &upcoming).await?,
            Step::Refuse { frame, reason } => p.refuse(frame, anyhow!(reason)).await?,
            Step::Wait => match asks.recv().await {
                Some(ask) => plan.push(ask),
                None => break,
            },
            Step::End => break,
        }
    }
    p.drain_acks().await;
    Ok(())
}
```

Every row of §8's test table is a test on `Planner` with no runtime, no channel and no
timing. Two of them, to show the shape:

```rust
/// `EndStream` found between two frames of a fill stops it; the session goes on.
#[test]
fn end_stream_stops_a_fill_before_the_next_frame() {
    let mut plan = Planner::new(10);
    plan.push(Ask::Fill { from: Some(3), to: Some(7) });
    assert!(matches!(plan.next(|| None).unwrap(), Step::Serve { frame: 3, .. }));
    let mut arrived = Some(Ask::EndStream);
    assert!(matches!(plan.next(|| arrived.take()).unwrap(), Step::Wait));
}

/// Asks already in hand are what the frame in hand is told is coming.
#[test]
fn pipelined_asks_supply_the_upcoming_frames() {
    let mut plan = Planner::new(10);
    for frame in [4, 5, 6] {
        plan.push(Ask::Frame(frame));
    }
    let Step::Serve { frame, upcoming } = plan.next(|| None).unwrap() else { panic!() };
    assert_eq!((frame, upcoming), (4, vec![5, 6]));
}
```

The transport implements `serve`, `refuse` and `drain_acks` once, for real, and keeps
`a_batch_arrives_whole_and_in_ask_order` and the fill wire test as its proof. There is no
second implementation.

### Cuts 3, 4 and 6 · the read path with W windows, and a ring that keeps no state

Today `read_path.rs` has a current window, one `Ahead`, a flip (`cur ^= 1`), a take-ahead
decision decoded from `pos == 0 && ahead.span == span`, and `begin` / `begin_ahead` /
`abandon_ahead` / `escalate` / `settle` / `grow`; `uring_reader.rs` has its own `Pending`
per slot (address, length, progress, offset, submitted) and a `SLOTS` that must equal
`WINDOWS`. The essential work is the nowait probe, two ways to wait for a miss, short-read
resubmission and drop safety; everything else is duplication or a special case of "a window
holds a span". Afterwards:

```rust
pub const WINDOWS: usize = 4;

/// A buffer, whose bytes it holds, and the one read at most still landing in it.
struct Window {
    key: Option<(FrameSpan, u32)>, // the frame and the position in it these bytes start at
    buf: Vec<u8>,
    at: u64,                       // file offset of `buf[0]`
    len: usize,                    // bytes valid once `read` is `None`
    filled: usize,                 // bytes landed so far, for a short read
    read: Option<InFlight>,
}

enum InFlight {
    #[cfg(feature = "uring")]
    Ring, // the ring's slot is this window's index
    Pool(JoinHandle<Result<Vec<u8>>>),
}

#[cfg(feature = "uring")]
enum Ring {
    Off,    // never wanted, or refused once — both mean the pool
    Wanted, // built on the first miss
    Built(Box<UringReader>),
}

pub struct ReadCtx {
    probe: bool,
    #[cfg(feature = "uring")]
    ring: Ring,
    windows: [Window; WINDOWS],
    stats: ReadStats,
}

impl ReadCtx {
    /// Bytes of `span` from `pos`; reads of `upcoming` started underneath, one window each.
    pub async fn read(
        &mut self,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        pos: u32,
        upcoming: impl Iterator<Item = FrameSpan>,
    ) -> Result<&[u8]> {
        let wanted: Vec<(FrameSpan, u32)> =
            iter::once((span, pos)).chain(upcoming.take(WINDOWS - 1).map(|s| (s, 0))).collect();
        for &(s, p) in &wanted {
            if self.holding(s, p).is_none() {
                let w = self.windows.iter().position(|w| !w.key.is_some_and(|k| wanted.contains(&k)))
                    .expect("at most W wanted, W windows");
                self.wait(w).await?; // a read nobody wants still lands before its buffer is reused
                self.begin(store, w, s, p)?;
            }
        }
        let w = self.holding(span, pos).expect("started above");
        self.wait(w).await?;
        Ok(&self.windows[w].buf[..self.windows[w].len])
    }

    fn holding(&self, span: FrameSpan, pos: u32) -> Option<usize> {
        self.windows.iter().position(|w| w.key == Some((span, pos)))
    }

    /// Probe one window without waiting; on a shortfall ask for the rest of the frame.
    fn begin(&mut self, store: &Arc<FrameStore>, w: usize, span: FrameSpan, pos: u32) -> Result<()> {
        let at = span.offset + u64::from(pos);
        let remaining = (span.len - pos) as usize;
        let want = READ_WINDOW.min(remaining); // cut 4: the read size is decided here, nowhere else
        let win = &mut self.windows[w];
        win.fit(want);
        let hit = if self.probe { store.read_at_nowait(&mut win.buf[..want], at)? } else { 0 };
        win.key = Some((span, pos));
        win.at = at;
        win.len = hit;
        win.filled = hit;
        if hit == want {
            self.stats.hits += 1;
            return Ok(());
        }
        self.stats.misses += 1;
        win.len = remaining;
        win.fit(remaining);
        win.read = Some(self.escalate(store, w)?);
        Ok(())
    }

    /// The ring if this session has one, the pool otherwise. Neither is waited on here.
    fn escalate(&mut self, store: &Arc<FrameStore>, w: usize) -> Result<InFlight> {
        #[cfg(feature = "uring")]
        if let Some(ring) = self.ring.build_on_first_miss(store) {
            let win = &mut self.windows[w];
            // SAFETY: `win.buf` is neither grown, read nor dropped while `win.read` is `Some`;
            // `wait` clears it, and `Drop` drains the ring before the windows go.
            unsafe { ring.submit(w, &mut win.buf[win.filled..win.len], win.at + win.filled as u64) }?;
            return Ok(InFlight::Ring);
        }
        let store = Arc::clone(store);
        let win = &mut self.windows[w];
        let (from, len, at) = (win.filled, win.len, win.at);
        let mut buf = mem::take(&mut win.buf);
        Ok(InFlight::Pool(tokio::task::spawn_blocking(move || {
            store.read_at_blocking(&mut buf[from..len], at + from as u64)?;
            Ok(buf)
        })))
    }

    async fn wait(&mut self, w: usize) -> Result<()> {
        match self.windows[w].read.take() {
            None => Ok(()),
            Some(InFlight::Pool(join)) => {
                self.windows[w].buf = join.await.context("join frame read")??;
                Ok(())
            }
            #[cfg(feature = "uring")]
            Some(InFlight::Ring) => {
                self.windows[w].read = Some(InFlight::Ring);
                let Self { ring: Ring::Built(ring), windows, .. } = self else { unreachable!("a ring read outlived its ring") };
                while windows[w].read.is_some() {
                    for (slot, landed) in ring.reap()? {
                        let win = &mut windows[slot];
                        win.filled += landed;
                        if win.filled == win.len {
                            win.read = None;
                        } else {
                            // SAFETY: as in `escalate`; the same window, its unread tail.
                            unsafe { ring.submit(slot, &mut win.buf[win.filled..win.len], win.at + win.filled as u64) }?;
                        }
                    }
                    if windows[w].read.is_some() {
                        ring.park().await?;
                    }
                }
                Ok(())
            }
        }
    }
}

impl Window {
    /// Never on a window with a read in flight — `begin` and `wait` are the only callers.
    fn fit(&mut self, need: usize) {
        if self.buf.len() < need {
            self.buf.resize(need, 0);
        }
    }
}
```

What was removed: `Ahead`, `cur`, the flip, the take-ahead decode, `begin_ahead`,
`abandon_ahead` (reuse waits — that is the whole rule), `settle` (now `wait`), `grow`
(now `fit`), `Pending::Ready`, `Ring::Pending` versus `Refused`, and `read_window` on the
store. What is parametric: W. What stays and is not smaller: the probe, the two escalations,
the short-read loop, drop safety.

`uring_reader.rs` after cut 6 — four operations and a count:

```rust
pub struct UringReader {
    ring: IoUring,
    eventfd: AsyncFd<OwnedFd>, // P1 parks on the ring's own fd instead
    in_flight: usize,
}

impl UringReader {
    pub fn new(file: &File) -> Result<Self> { /* as today: build, register the file, the eventfd */ }

    /// # Safety
    /// `buf` stays valid, unmoved and unaliased until `reap` reports `slot` or this reader is
    /// dropped, which waits.
    pub(crate) unsafe fn submit(&mut self, slot: usize, buf: &mut [u8], offset: u64) -> Result<()> {
        let entry = opcode::Read::new(types::Fixed(0), buf.as_mut_ptr(), buf.len() as u32)
            .offset(offset)
            .build()
            .user_data(slot as u64);
        unsafe { self.ring.submission().push(&entry) }.map_err(|_| anyhow!("io_uring SQ full"))?;
        self.ring.submit().context("io_uring submit")?;
        self.in_flight += 1;
        Ok(())
    }

    /// Every completion landed so far: `(slot, bytes)`. A short read is the caller's to resubmit.
    pub(crate) fn reap(&mut self) -> Result<Vec<(usize, usize)>> {
        self.ring.completion().sync();
        let mut landed = Vec::new();
        for cqe in self.ring.completion() {
            self.in_flight -= 1;
            match cqe.result() {
                n if n > 0 => landed.push((cqe.user_data() as usize, n as usize)),
                0 => bail!("io_uring read hit EOF"),
                e => return Err(io::Error::from_raw_os_error(-e)).context("io_uring read"),
            }
        }
        Ok(landed)
    }

    pub(crate) async fn park(&mut self) -> Result<()> { /* as today */ }

    /// The one place this file blocks; the alternative is a use-after-free.
    pub(crate) fn drain_in_flight(&mut self) {
        if self.in_flight > 0 && self.ring.submitter().submit_and_wait(self.in_flight).is_ok() {
            self.ring.completion().sync();
            while self.ring.completion().next().is_some() {}
        }
        self.in_flight = 0;
    }
}
```

`Pending`, `slots`, `SLOTS`, `finish` and `submitted` are gone; the ring knows how many reads
are out, not what they are. The `Vec` in `reap` is one small allocation per wake and can be
a fixed `[_; WINDOWS]` if it ever shows.

### Cut 4 · sizes have one owner each

The store answers one question:

```rust
impl FrameStore {
    /// False where `RWF_NOWAIT` is refused (overlayfs, tmpfs); every read is then a miss.
    pub fn nowait_supported(&self) -> bool { self.nowait }
}
```

`read_window` is deleted. The read size is `READ_WINDOW.min(remaining)` in `begin` above,
the miss size is the rest of the frame there too, and the write size is `READ_WINDOW` in
`frame_out.rs`. Where nowait is refused the probe returns 0 and the miss reads the whole
rest of the frame in one pooled read, which is what `read_window` used to arrange from the
other side. `read_window_collapses_to_the_frame_without_nowait` becomes a read-path test:
on a `force_pool_reads` store a 250 KB frame costs one blocking read.

### Cut 5 · a named channel capacity

```rust
/// Asks the server holds beyond the frame being served. The read path takes what fits (W − 1).
const ASKS_AHEAD: usize = 8;
let (tx, rx) = mpsc::channel(ASKS_AHEAD);
```

That is the whole cut. `WINDOWS` and `ASKS_AHEAD` move independently, and the sentence
explaining why the channel is `W − 1` is not needed.

## 12 · Performance tests — what a test can hold, and what only a campaign can

Asked 2026-09-09: should there be performance tests so the read path keeps meeting its
numbers? Yes for the mechanism, no for the clock.

**A test can pin the mechanism the numbers come from**, deterministically, through the
store's levers (`force_short_reads`, `force_pool_reads`) and by counting. Three already do:
`a_frame_that_misses_costs_one_round_trip_not_one_per_window`,
`naming_the_next_frame_starts_its_read_and_serves_it_from_the_other_window`,
`a_pooled_frame_is_written_in_read_windows_not_in_one_copy`. Two more close the gaps the
cuts open:

| test | claim |
| --- | --- |
| `w_named_frames_start_before_the_current_read_finishes` | on a gated one-thread blocking pool, naming W − 1 upcoming frames starts W pooled reads before the current one can finish |
| `a_hit_never_touches_the_ring` | a warm frame at `ReadMode::Auto` leaves `ring_built()` false and `stats.misses` at 0 — the trap in `IMPLEMENTATION.md`, pinned |

Mutate each once, per `CLAUDE.md`.

**A test cannot pin time here.** This sandbox is ~10× slower than the workstation; `v36`'s
250 KB cell varied 12.5× between repeats of the same arm; resolving a 28.5 % difference took
12 interleaved repeats and a paired sign rule. A threshold in `cargo test` is either flaky or
loose enough to mean nothing, and a flaky test gets deleted.

**What holds the numbers is the interleaved A/B**, which already exists: `pair_ab.py` and the
`x13` precedent, where a sequential before/after read +8.1 % on a refactor that changed
nothing and the interleaved run read the tie. Make it one command so it is run rather than
remembered:

```
lab/scripts/server_ab.sh <base-commit>
    builds `exact-server --release` from a worktree at <base-commit> and from HEAD,
    drives both with the same `server_ab` client, alternating who goes first:
    cold tiles at depth 1, 2 and 4 · warm tiles at 1 and 4 · fill,
    pairs them on **p50** with the 28.5 % rule and `MIN_N = 5`.
    Gates `server/src/transport/` and `server/src/media/`.

lab/scripts/read_path_ab.sh <base-commit>
    builds `read_campaign` from a worktree at <base-commit> and from HEAD,
    runs the lab arms: warm 16 KiB · cold 16 KiB at depth 1 and W · the 1 GiB sequential
    fixture (a P0 I/O cell, not a product verdict),
    pairs them on **p50** with the 28.5 % rule. Gates P0 (ring vs pool).
```

Run `server_ab.sh` for every change under `server/src/transport/` or `server/src/media/`
and commit the TSV beside the others, on the host that can resolve it. A number from the
sandbox is not evidence (§14.4). `read_path_ab.sh` stays for P0. In production, the
`session reads … miss_rate=…` line and `check-fastpath` are the running check that the
mechanism the tests pin is the one actually taken.

## 13 · Handoff to the implementer

§11 was chosen on 2026-09-09: the ask reader and channel (cut 1), the planner (cut 2), the
read path as W windows with a thin ring (cuts 3, 4, 6), the named capacity (cut 5). This
section is what §11 leaves unsaid. An implementer who has read §11 and this should not need
to ask a question; where one remains it is listed as such.

### 13.1 · Decisions fixed here, so they are not re-decided in code

| | value | why |
| --- | --- | --- |
| `WINDOWS` | **4** | §9.3, §9.5. One constant in `read_path.rs`; the lab and the loop read it from there |
| `FILL_AHEAD` | **1** | fill stays at two windows (§9.3); the loop names one frame ahead and the read path uses two of its four |
| `ASKS_AHEAD` | **8** | the channel's capacity and the planner's look-ahead; the read path takes at most `WINDOWS − 1` of it |
| `READ_WINDOW` | 64 KiB, unchanged | the probe size and the write chunk |
| change **A** (`frame()` + `FrameBytes`) | **not part of this**; optional later, ~20 lines over `read` | §11 keeps `read(span, pos, upcoming)`; review faults 2 and 3 stay, made harmless by the `holding` check |
| change **B** | subsumed: the window index is the slot, the ring has no slot table | the one `unsafe fn` stays, at `submit` |
| **P1** | after P0, unchanged | `park` is the one method P1 replaces |
| `Ring::Refused` | folded into `Off` | both mean "the pool"; `ring_built()` reports `Built` |

### 13.2 · Order of work — four commits, each with its own check

Every commit passes `scripts/gate.sh` and the comment budget, and every measurement is
interleaved against a worktree build of the previous commit (§12's script, written
**first**, as commit 0).

| # | lands | files | passes when |
| --- | --- | --- | --- |
| 0 | `lab/scripts/read_path_ab.sh` (§12) | `lab/scripts/` | it runs both binaries and prints tie/RESOLVED per cell |
| 1a | cuts 3 and 4 at **`WINDOWS = 2`**: the window table replaces `Ahead`; `read_window` deleted; `read(span, pos, upcoming)`; `stream_codestream` passes `next.into_iter()`; lab arms updated | `read_path.rs`, `frame_store.rs`, `frame_out.rs`, `read_campaign.rs` | the tests in 13.4 green; **every A/B cell ties** |
| 1b | cut 6: the ring as `submit` / `reap` / `park` / `drain_in_flight`; `SLOTS` gone | `uring_reader.rs`, `read_path.rs` | the two ring tests green; every cell ties |
| 2 | cuts 1, 2 and 5 at `WINDOWS = 2`: `Ask`, the reader, `Planner`, `serve(frame, upcoming)`; `serve_batch` and the recording pipeline gone | `server.rs`, `pipeline.rs`, `frame_out.rs` | planner tests and the two wire tests green; harness pipelining `RequestFrame` at client depth 2: cold moves toward `v36`'s +73.8 %, warm ties |
| 3 | `WINDOWS = 4` | one line | harness at client depth 4, cold tiles: +26 to +37 % asks/s expected (§9.5), warm ties, fill ties; RSS per session +32 KiB at most |

Commit 1a is the one that can go wrong silently: it changes shape while claiming no change,
which is exactly what `x13` caught. Do not merge 1a on a tie that was measured sequentially.

**The "every A/B cell ties" condition was met on 2026-09-09, after the fact and for all four
commits at once: §19.2.**

### 13.3 · The seam, end to end, after commit 3

```
FodMsg ──ask reader──▶ Ask ──channel(ASKS_AHEAD)──▶ Planner::next ──▶ Step::Serve { frame, upcoming: Vec<u32> }
   ▶ FramePipeline::serve(frame, &upcoming)          // default method, one implementation each for product and lab
       span = locate(frame)?                          // refuse before a stream opens, as today
       ahead: Vec<FrameSpan> = upcoming.iter().filter_map(|&f| store.frame_span(f).ok()).collect()
       send(frame, store, span, &ahead)
   ▶ stream_codestream(uni, store, span, ahead: &[FrameSpan], ctx)
       loop over pos: ready = ctx.read(store, span, pos, ahead.iter().copied()).await?
                      write ready in pieces ≤ READ_WINDOW
   ▶ ReadCtx::read: start current if not held · start ahead that fit · wait current
```

An upcoming frame that fails to locate is dropped from `ahead`, never an error for the frame
being served. `send`'s `next: Option<FrameSpan>` becomes `ahead: &[FrameSpan]`; the lab's
`look_ahead` becomes a one-element slice. `Ask::frame()` is `Some(f)` for `Ask::Frame(f)`.
`fill_range(from, to, frames)` resolves `from` to 0 and `to` to `frames − 1`, and refuses
when `frames == 0`, `from > to`, or `to ≥ frames`.

### 13.4 · What must still be true, and the test that says so

| holds | pinned by |
| --- | --- |
| inside `read`: current first, then upcoming that fit, then wait — the measured order | `naming_the_next_frame_starts_its_read_and_serves_it_from_the_other_window` (harness rewritten: assert a window holds the next span with a read in flight before the current is waited) |
| a hit is one window; a miss is one read for the rest of the frame | `a_frame_that_misses_costs_one_round_trip_not_one_per_window` — unchanged |
| where nowait is refused, a frame is one pooled read | `read_window_collapses_to_the_frame_without_nowait` **moves** from `frame_store.rs` to `read_path.rs`, same claim on a `force_pool_reads` store |
| a hit never touches the ring; the ring is built once, on the first miss | `lazy_ring_is_not_built_when_every_read_hits`, `lazy_ring_is_never_built_without_nowait` — unchanged; **add** `a_hit_never_touches_the_ring` (§12) |
| naming W − 1 frames puts W − 1 reads in flight | **add** `w_named_frames_start_before_the_current_read_finishes` (§12, §15.6) |
| reuse waits: a window with a read in flight is never grown, read or overwritten | `a_read_ahead_nobody_asked_for_is_waited_for_before_its_window_is_reused` (harness rewritten) |
| drop drains the ring before the windows go | `dropping_a_reader_mid_read_waits_for_the_kernel` — unchanged, `DRAINED_ON_DROP` stays |
| two ring reads land in their own windows, short reads resubmitted | `two_reads_in_flight_land_in_their_own_slots` (rewritten against `submit` / `reap`) |
| bytes and order on the wire unchanged | `a_batch_arrives_whole_and_in_ask_order`, `streamed_bytes_match_the_envelope_they_replaced`, `a_pooled_frame_is_written_in_read_windows_not_in_one_copy` — unchanged |
| every loop rule in §8's table | one planner test per row, the two in §11 as the model; the recording-pipeline tests that landed with steps 1–2 are **replaced** by these, claim for claim |
| a fill delivers the study in order and stops on `EndStream` | **add** the fill wire test (`StreamFrames {}` whole study in order) and `end_stream_stops_a_fill_on_the_wire` (asserts it stopped before the end, not at frame *k* — §12) |
| miss reporting unchanged | `read_stats_report_the_session_miss_rate` — unchanged |

Mutate every new or rewritten test once and watch it fail (`CLAUDE.md`).

### 13.5 · The lab

`read_campaign.rs`'s `product` and `product_ahead` arms call `ctx.read` directly and change
with its signature in commit 1a — they are also the check. The lab does **not** implement
`FramePipeline`; that trait's only implementors are `ProductPipeline`, `RecordedPipeline`
and the two test recorders in `server/` (§16, §18). `note_batch(position, size)` loses its
caller with cut 1, since the loop no longer sees batches. **Recommendation: delete it** — the
harness knows its own asks. If a lab metric needs it, that metric is the reason to keep batch
identity on `Ask::Frame`, and that is a decision for the owners, not the implementer.

### 13.6 · Documents to correct when it lands

[`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Mechanism (the window table replaces the two-window
flip; the ring section), [`adr.md`](adr.md) §1 and §7 (`SLOTS` is gone; W is 4 for tiles, 2
for fill), [`HANDOFF.md`](HANDOFF.md) §1 and §10 item 4, [`NEXT.md`](NEXT.md) §1 (item 1
closes when commit 3 lands), [`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md) status line (A
deferred, B subsumed), and §6 of this document (steps 3–4 are the four commits above).

### 13.7 · Out of scope, on purpose

The client's cap on asks in flight per link (§9.1) — client protocol. P0 and P1. Change A.
The throttled-link cell (§9.4) — after commit 3. The loop shape without a reader task
(discussed 2026-09-09, not chosen; would add `tokio-util`).

## 14 · Not to forget — everything raised that §13's four commits do not deliver

A register, 2026-09-09, of every point and optimisation raised while this design was made
that is not one of the four commits. Each row says what it is, the number or evidence behind
it, what triggers doing it, and the document that owns it — the row here is the reminder, the
pointer is the detail. [`NEXT.md`](NEXT.md) keeps the owners' ranking; nothing here reorders
it.

### 14.1 · Read path, after commit 3

| item | evidence | do it when | owner |
| --- | --- | --- | --- |
| **P0 — ring against pool on the production target**, depths 2, 4, 8, 16, both read modes | decides whether ~800 lines stay; a tie deletes the ring; the depth ladder is where W = 8 or 16 could earn its place (§9.5) | first thing on the target; `check-fastpath` and `ulimit -l` recorded beside the TSV | [`NEXT.md`](NEXT.md) §3, [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) §Decision |
| **P1 — park on the ring's own fd, drop the eventfd** | `x14`: tie on CPU, gain by construction; 1 fd per session instead of 2; ~30 lines fewer, now all inside `park` | after P0 keeps the ring | [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) P1 |
| **P2 — `io-uring` 0.7.14 → 0.7.15** | drop-in | next dependency pass | same, P2 |
| **P6 — `IORING_SETUP_ATTACH_WQ` across session rings** | one kernel worker pool instead of one per ring; unmeasured | only if P0 shows per-ring kernel workers cost at thousands of sessions | same, P6 |
| **Ring entries follow W** | `build(8)` today; the ring never holds more than W reads per session | with commit 3, or when W moves | §11 cut 6 |
| **`reap`'s `Vec` → fixed `[_; WINDOWS]`** | one small allocation per wake | only if it shows in a profile | §11 cut 6 |
| **Memory at thousands of fills** | 2 windows × frame size after a miss: 500 MB per thousand fills at 250 KB frames | measure before building; the fix is a vectored read into fixed 64 KiB blocks in one round trip, not the windowed escalation measured at a third of the throughput | §5 |
| **`posix_fadvise(SEQUENTIAL)` per fill session** | cheap, unmeasured | a fill campaign on the target, interleaved | [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md) S3 |
| **Bounded frame cache** | −20.2 % CPU at a 0.92 hit rate, lab only | needs a real ask trace to size; not before one exists | [`adr.md`](adr.md) §8 |
| **`read_ahead_kb` and study layout on the target** | miss rate moved 2–15× by that one knob; with studies far larger than RAM, latency is miss count × miss cost and this sets the count | with P0, on the study volume | [`NEXT.md`](NEXT.md) §6, [`../disk-layout/`](../disk-layout/README.md) |
| **Change A — the frame loop behind `frame()` / `FrameBytes`** | review faults 2 and 3; ~20 lines over `read` after §11 | when the seam is wanted for its own sake; not for W | [`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md) §3 |
| **One session in both modes** | unspecified today: fill is start-to-end, tiles are on demand; the window table serves both, the numbers were argued per mode | when a client does it | §5 |

### 14.2 · Transport and link — where latency actually goes on the default link

| item | evidence | do it when | owner |
| --- | --- | --- | --- |
| **Client cap on asks in flight, per link** | the one lever that moves latency on wireless: a new ask waits behind every queued byte, 100 ms per 250 KB frame at 20 Mbps, 250 ms at 8 Mbps | client protocol; design it with the viewer, the server's `ASKS_AHEAD` is only the defensive side | §9.1 |
| **Server `send_window` bounded** | the same queue from the server's side; the knob exists (`send_window_bytes`) | set with the client cap, measured on the throttled cell | §9.1, [`../transport-conclusions.md`] on `cursor/l1-loss-run-dbae` §3.1 |
| **Keep one shared stream** | per-frame streams 5.76× worse at 250 KB under 1 % loss on real hardware; no cell favours them | standing decision; reopen only with a new mechanism, not a re-run | the loss-run branch §2 |
| **Congestion controller: Cubic default, BBR where loss is radio** | congestive 600 ms / 8 Mbps: Cubic 941 ms vs BBR 1535 ms; exogenous 1 % loss: BBR −48 % / −44 %; BBRv1 takes 99 % of a shallow buffer from a competing flow | needs client telemetry to tell the regimes apart (loss with RTT flat = radio); until then Cubic | the loss-run branch §1 |
| **`max_udp_payload_size` 1472 → 4000 B** | −35 % CPU, +55 % throughput — the largest effect measured anywhere | blocked on what browsers advertise; price it first | [`adr.md`](adr.md) §8 |
| **GSO segment cap 10 → 32** | +17 % throughput, −21 % CPU per byte, zero effect on p95 — density, not latency | not confirmed on real hardware; a density run | the loss-run branch, summary table |
| **`EndStream` and the wire** | the server stops within one frame, but bytes already handed to QUIC drain at the link's pace; a fast stop needs a small client receive window | client side, with the cap above; whether a fill should also reset a frame in progress is open | §7 |
| **`RequestFrame` against `RequestFrames` for a reactive viewer** | argued both ways, never measured; both stay | a harness campaign with a real ask trace, if the viewer team wants the number | §2 |
| **Throttled-link cell** | 20 Mbps / 50 ms / 1 % loss, cold tiles, client depth 4, W = 2 against 4; predicted tie | after commit 3; the record that W was checked on the link that matters | §9.4 |

### 14.3 · Deployment — the silent fallbacks

| item | evidence | do it when | owner |
| --- | --- | --- | --- |
| **`RLIMIT_MEMLOCK` or `CAP_IPC_LOCK`** | 8.7 KiB of ring memory charged per missing session; the 8 MB default is ~940 rings; a refused ring falls back to the pool per session without a log line | in the manifest before the first container deployment | [`NEXT.md`](NEXT.md) §4, [`DEPLOYMENT.md`](DEPLOYMENT.md) |
| **`RLIMIT_NOFILE`** | 2 fds per missing session, 1 after P1 | same | same |
| **`RWF_NOWAIT` on the study path** | refused on overlayfs and tmpfs: a study on the image layer never builds a ring and runs the pool; a bind mount or block volume is fine | `check-fastpath` on the study volume at deploy; the startup banner says which path was taken | same |
| **Cloud miss cost** | unmeasured; ~1 ms is the usual figure, 15× the lab's; it scales W's worth and P0's answer | P0 | §9.1 |

### 14.4 · Measurement and lab — traps already fallen into once

| item | evidence | do it when | owner |
| --- | --- | --- | --- |
| **Interleave, against a worktree build** | sequential before/after read +8.1 % on a tie (`x13`) | every A/B, §12's script | [`HANDOFF.md`](HANDOFF.md) §6 |
| **The 250 KB miss cell** | the same arm varies 12.5× between repeats, and at 8 MiB of read-ahead the "cold" cell reached 4.7 % misses — a hit cell wearing a cold label; isolating 250 KB misses needs ≥ 8 MiB between asks, a ~2 GB fixture | before any 250 KB conclusion | [`NEXT.md`](NEXT.md) §7 |
| **The bench copies `stream_codestream`'s loop** | four lines, measured instead of the product's; they can drift | when the loop changes (commit 2), re-check the copy | [`NEXT.md`](NEXT.md) §7 |
| **The upcoming-naming line is not observable on the wire** | the read path's use of `upcoming` is tested from both ends; the loop's naming of it is one line the wire tests cannot see | `w_named_frames_start_before_the_current_read_finishes` covers the read path; the loop's line is covered by `server_ab.sh` depth cells | §12, §13.4, §15.4 |
| **Say where the host saturates** | ~64 reads in flight on the workstation, ~840 MB/s; the sandbox on CPU; past it every arm ties by construction | every claim quotes its plateau | [`NEXT.md`](NEXT.md) §6 |
| **Quote latency or throughput, not both** | one is the other divided by depth | every table | `CLAUDE.md` |

### 14.5 · Documents

| item | do it when | owner |
| --- | --- | --- |
| **Fold [`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md) into this document** | when commit 3 lands, since A is then the only thing left in it | [`NEXT.md`](NEXT.md) §7 |
| **Correct the six documents in §13.6** | as each commit lands, not after | §13.6 |
| **§15 supersedes this register where they overlap** | §15 is the plan for the round after §13; rows here it takes on (ring entries follow W, `reap`'s `Vec`) say so | §15 |
| **`adr.md` §2 "numbers safe to quote"** | add the commit-3 depth number and the throttled-cell tie once measured | [`adr.md`](adr.md) |

## 15 · Fix and optimise what §13 landed — the plan

**2026-09-09, after the four §13 commits.** §13 landed W = 4, the planner, the thin ring and
the two fill wire tests. This section is the evaluation of what landed and the plan to
correct it. It does not reopen a §13 decision; `WINDOWS = 4`, `FILL_AHEAD = 1`,
`ASKS_AHEAD = 8` and change **A** deferred all stand.

One thing has to be said first, because everything below depends on it. §13.2 gave every one
of the four commits the same pass condition — *every A/B cell ties*, measured interleaved
against a worktree build. **No such run exists.** `lab/scripts/read_path_ab.sh` was written
as commit 0 and never run to a committed TSV; the branch has `x13_refactor_ab.tsv` from the
previous refactor and nothing since. So the four commits are unmeasured, and the warm
`+17 %` CPU figure quoted in conversation has no file behind it. `CLAUDE.md` says a number
lives in `docs/`; this one does not, and until §15.4's run it is not a number.

### 15.1 · What was checked, and how

Every row was run in this tree on 2026-09-09. The mutations are the `CLAUDE.md` rule applied
to code that already shipped: break it on purpose, see whether anything fails.

| claim | how it was checked | result |
| --- | --- | --- |
| `Planner::next` bounds what it holds | temporary planner test: offer 800 `Ask::Frame`, call `next` 100 times | **high-water 799** against `ASKS_AHEAD` 8 |
| `w_named_frames_put_w_reads_in_flight` pins start-then-wait | mutate `read` to wait the current frame before `begin`ning any upcoming | **all 38 tests pass** |
| the planner → read path seam is covered | mutate `FramePipeline::serve` so `ahead` is always empty | **all 38 tests pass** |
| read ahead exists at all | mutate `read` to ignore `upcoming` entirely | 3 tests fail — *naming starts a read* is pinned, the order is not |
| `fills=N` counts fills that served a frame | planner probe: `StreamFrames {}` and `EndStream` in one write | `Step::Wait`, `note_fill = true` — **`fills=1`, nothing served** |
| the §13.2 A/B gate was met | search the whole branch history for a committed `read_path_ab.tsv` | **none** — the script, never a run |

Green as it stands: 38 tests default, 31 `--no-default-features`, 64 `telemetry`; clippy
clean; comment budget ok. `cargo fmt --check` is dirty on the four server files this branch
touched (the rest of the repo is drifted too, and `gate.sh` has no fmt step).

The third row is the one that matters. **The feature the four commits exist to deliver — a
frame's read starting while the frame before it is still on the wire — can be severed at the
seam and the suite stays green.** §14.4 predicted half of this ("the loop's naming of
`upcoming` is one line the wire tests cannot see") and pointed at "the harness depth
measurement in commit 2" to cover it. That measurement was never made. So the naming line,
the seam that carries it and the order inside `read` are all unverified, and the only
evidence for read-ahead-by-one is `v36`, taken through the lab's *copy* of the serving loop.

### 15.2 · The defects, ranked

| # | defect | where | severity |
| --- | --- | --- | --- |
| 1 | `in_hand` grows with ask rate; §1's backpressure invariant does not hold | `planner.rs` | **the one bug**: unbounded per-session memory a client controls |
| 2 | the A/B gate measures a lab copy of the read loop, not the product's | `read_path_ab.sh`, §12 | the landed work has no gate |
| 3 | nothing fails when the planner's names are dropped before the read path | tests | the feature is untested end to end |
| 4 | nothing fails when the read path waits before it starts | tests | the order §13.4 names is not pinned |
| 5 | small leftovers | §15.7 | each one line |

### 15.3 · Change 1 · bound what the loop holds

`Planner::next` drains the channel into `in_hand` on every call and pops one. A client that
stays ahead moves the whole channel into the deque, refills it, and the deque grows without
limit. §1 says the opposite: the ask reader stops pulling when the channel is full and QUIC
holds the rest.

Four edits, one invariant — **no per-session memory grows with ask rate**:

**a · stop polling at the cap.** One condition in `Planner::next`:

```rust
while self.in_hand.len() < ASKS_AHEAD {
    let Some(ask) = poll() else { break };
    self.in_hand.push_back(ask);
}
```

Peak becomes `ASKS_AHEAD` in the deque and `ASKS_AHEAD` in the channel — 16 frame indexes.
The rest stay in QUIC. `Planner::push` keeps no cap: `run_session` calls it only on the
`Step::Wait` path, where `in_hand` is empty by construction.

Test `the_loop_holds_no_more_than_asks_ahead`: flood 100 `Ask::Frame`, assert `in_hand.len()
<= ASKS_AHEAD` after every `next`. Mutate by removing the condition — measured at 799.

**b · the ask reader streams a batch instead of collecting it.** `spawn_ask_reader` builds a
`Vec<Ask>` per message; for `RequestFrames` that copies the decoded message into a second
allocation — 700 k asks at the 4 MiB cap, 11 MiB of `Ask`. Replace the fan-out with a free
`async fn read_asks(control_recv, tx)` that sends per message and iterates `frames` directly,
so backpressure applies mid-batch and nothing is duplicated.

**c · `read_fod_msg` stops copying the body twice.** It reads `body` (up to 4 MiB), then
builds `full = len ++ body` (another 4 MiB) only so `decode_fod_msg` can re-read a length it
already has. Add `fod::decode_fod_body(&[u8])`, keep `decode_fod_msg` as a wrapper over it,
and call the body form. Peak on a max-size ask drops from ~12 MiB to ~8 MiB per session.
Test in `common/fod`: the two decoders agree on every `FodMsg` variant.

**d · `upcoming` stops naming past a `Fill` or `EndSession`.** `filter_map(Ask::frame)` walks
the whole deque, so `[Frame(5), Fill{..}, Frame(9)]` names 9 as what follows 5. It does not:
the fill runs first. The read path then spends a window and a device read on a frame that is
not next. `EndStream` is a no-op and must still be skipped:

```rust
let upcoming = self.in_hand.iter()
    .take_while(|a| matches!(a, Ask::Frame(_) | Ask::EndStream))
    .filter_map(Ask::frame)
    .take(ASKS_AHEAD)
    .collect();
```

Test `upcoming_stops_at_the_first_ask_that_is_not_a_frame`. This corrects §11 cut 2's code as
well as the tree; §13.3 already says `upcoming` means "the frames this session will be asked
for after `frame`".

### 15.4 · Change 2 · the A/B measures the product server

`read_path_ab.sh` times two `read_campaign` binaries. `read_campaign`'s `product` arm calls
`ReadCtx::read` directly through **a copy of `stream_codestream`'s loop** — §14.4 lists that
copy as a known trap, and HANDOFF §9 admits it. Upcoming, W, fill and pipelined
`RequestFrame` live in `run_session` → `Planner` → `serve` → `stream_codestream`. The lab
runs none of that. Teaching `product_ahead` to name W − 1 frames would not fix it: that would
still be a lab policy standing in for the planner's.

**The binary under test is `exact-server`. The driver is a client.**

**a · `lab/disk-access-bench/src/bin/server_ab.rs`**, ~250 lines, a WebTransport client and
nothing else:

* connect (dual-stack, IPv4 fallback, `with_no_cert_validation`) — the same connect path the
  wire tests and `window-harness` use;
* open the bi control stream, accept the shared media uni;
* on demand: keep D `RequestFrame`s in flight. The shared stream is FIFO and the server
  serves in ask order, so envelope *n* answers ask *n*; record `recv − sent[n]`;
* fill: one `StreamFrames {}`, read `frames` envelopes, record inter-arrival;
* emit one TSV row: `label arm temp mode depth asks p50_ns p90_ns p99_ns wall_ns asks_per_s
  cpu_ns_per_ask rss_kib miss_pct`. **`cpu_ns_per_ask` and `rss_kib` are the server's**, read
  from `/proc/<server-pid>/stat` (utime + stime) and `/proc/<server-pid>/statm` around the
  session — the driver's own CPU is not the quantity, and `read_campaign`'s process clock has
  no equivalent once the work is in another process.

**Depth is client asks in flight**, not harness reader tasks. That is the whole difference
from the lab, and it is what makes the cells able to see the planner.

Not `window-harness`: it is a trace / link-pacer / simulated-RTT rig, and its `--read-bps`
pacer would sit between the server and the clock. Reuse its connect block, not its loop.

**b · `lab/scripts/server_ab.sh <base-commit>`**, the runner:

* `git worktree add --detach` at `<base>`; build `exact-server --release` in both trees, and
  `server_ab` once — the *same* driver drives both arms;
* one dev cert, two ports, **both servers up for the whole run** so idle RSS baselines stay
  comparable; rotate which one goes first each round;
* per cell: stride the plan so consecutive asks clear the kernel's read-ahead — without it a
  cold cell reports 1.6 % misses, measured (§16.2a);
* per cell: evict the study and assert residency < 2 %, exactly as `read_campaign` does — move
  `evict` / `evict_retry` out of `read_campaign.rs` into `residency.rs` and add a small
  `evict` bin, so there is one eviction implementation and not two (§14.4's "hit cell wearing
  a cold label");
* warm cells: one discarded pass in a **separate session**, then measure — a warm-up inside
  the measured session would leave the server's windows holding bytes;
* after each session ends, read the server's `session reads … miss_rate=… ring=…` line off
  its stderr into the row, and **abort a cold cell whose miss rate is below 0.99**;
* preconditions recorded beside the TSV: `check-fastpath` on the study volume (without
  `RWF_NOWAIT` every read reports a miss and the warm cell means nothing),
  `read_fast_path=` from both banners, `--stream-mode shared` pinned on both servers, no
  co-tenant load.

**c · the cells, and which number decides each.** Two questions, two metrics:

| cell | what the client does | compared with | metric | passes when |
| --- | --- | --- | --- | --- |
| cold tiles, depth 1 | one `RequestFrame`, wait, repeat | base binary, same depth | p50 | **tie** — capability preserving |
| cold tiles, depth 2 | two in flight | base binary, same depth | p50 | HEAD **wins** if the old loop was serial |
| cold tiles, depth 4 | four in flight | base binary, same depth | p50 | win or tie |
| warm tiles, depth 1 and 4 | same, cached | base binary, same depth | p50 | **tie** |
| fill | one `StreamFrames {}` | base binary | p50 per frame | **tie** — fill still names one ahead |
| depth ladder 1 → 2 → 4 | HEAD only | HEAD against itself | **asks/s** | toward `v36`'s +73.8 % at 2; modest gain or tie at 4 (§9.5) |

The split is not a detail. **p50 per ask rises with depth by construction** — §9.5 measures
80 µs at depth 1 and 154 µs at depth 4 on the same code, because each tile waits behind three
others. A ladder read on p50 reads a regression that is not there. A/B cells hold depth fixed
on both sides, so p50 is right there, and latency is the metric §9.3 put first. `asks_per_s`,
`cpu_ns_per_ask` and `rss_kib` ride in the TSV as columns; only the one named above is the
verdict. Pairing rule unchanged: |median| ≥ 28.5 %, signs agree on ≥ 0.8n, and
`pair_arms.py`'s `MIN_N = 5` — which `read_path_ab.sh` does not enforce and should.

**This is also how the planner is known to have named upcoming.** If it did not, cold depth 4
matches cold depth 1. No lab hook, no wire timing assertion.

**d · RSS.** +32 KiB per session is below what one session's process RSS can separate. Run
the RSS cell at `--sessions 64`, depth 4, on the tile fixture, and quote the delta divided by
the session count — ~+2 MiB total against W = 2. **Tiles only.** A window grows to the whole
frame on a miss and never shrinks, so at 250 KB frames the figure is W × frame size, not
32 KiB; §9.3's memory row should say so.

**e · what happens to `read_path_ab.sh`.** It stays, as the **P0 and arm-vs-arm** driver over
`read_campaign` — the right tool for *ring against pool*, which is what P0 asks. Two fixes
while it stays: verdict on `p50_ns` with `cpu_ns_per_ask` kept as a column (§12 never named a
metric, and CPU alone is how an unpaired warm figure came to look like a verdict), and
`MIN_N = 5`. The 1 GiB sequential cell leaves the product verdict path and stays there as a
P0 I/O cell. §12 gains one line saying which script gates what: `server_ab.sh` for
`server/src/transport/` and `server/src/media/`, `read_path_ab.sh` for P0.

Neither script can run in the sandbox and mean anything — it is ~10× slower than the
workstation and CPU-bound (§14.4). The run belongs on the workstation, with its host file
beside the TSV.

### 15.5 · Change 3 · warm CPU — read the product cells, then decide

The `+17 %` was `ReadCtx` in the lab, with no matching p50 or asks/s move, and no committed
file. It may be real hit-path overhead — the W = 4 window table, a `wanted` `Vec` built on
every `read`, so once per 64 KiB — or it may be lab noise. **Do not touch `read` until the
product warm cells exist.**

* product warm depth 1 **ties** on p50 → ignore the CPU, or trim later as taste;
* product warm **loses** on p50 → cut the per-`read` allocation (`wanted` becomes
  `[(FrameSpan, u32); WINDOWS]` with a length, no heap) and compute each window's `holding`
  once instead of rescanning in `free_window`. Both inside `read_path.rs`, no signature
  change, existing tests cover the result.

Either way the verdict and its TSV go into §12, so the number stops being spoken and starts
being written down.

**Resolved 2026-09-09 (§19.3): the product warm cells tie** — depth 1 flat on p50, CPU and
asks/s, depth 4 running 14/16 *toward* the branch, and the lab's own `warm16_d1` at −8.5 %.
The `+17 %` is not reproduced. `read` is not to be touched for it.

### 15.6 · Change 4 · pin start-then-wait

`w_named_frames_put_w_reads_in_flight` asserts `pool_starts() == WINDOWS` and
`pending_windows() == WINDOWS − 1` **after** `read` returns. Both are equally true of a `read`
that waited for the current frame first and then started the upcoming ones — verified: that
mutant passes the test and the other 37.

Rewrite it as `w_named_frames_start_before_the_current_read_finishes`, on a runtime whose
blocking pool has exactly one thread, occupied:

```rust
let rt = Builder::new_multi_thread().worker_threads(2).max_blocking_threads(1).enable_all().build()?;
rt.spawn_blocking(move || gate_rx.recv().unwrap());     // the one blocking thread, held
let task = rt.spawn(async move {
    let bytes = ctx.read(&store2, span, 0, upcoming).await.map(<[u8]>::to_vec);
    (ctx, bytes)                                        // the borrow ends at the await
});
wait_until(|| store.pool_starts() == WINDOWS, 5s);      // deadline, so a bug fails rather than hangs
gate_tx.send(()).unwrap();
let (ctx, bytes) = rt.block_on(task).expect("join");
bytes.expect("read");
assert_eq!(ctx.pending_windows(), WINDOWS - 1);
```

`account_pool_start` runs at *spawn* time in `escalate`, and the pool is gated, so
`pool_starts() == WINDOWS` while the gate is held **is** "W reads started before the current
one could finish". No new product hook — `force_pool_reads`, `pool_starts` and
`reset_pool_starts` already exist; `ReadMode::Pool` keeps the ring out of it. This is cleaner
than latching inside the store, which would need a new test-only field on `FrameStore`.

Mutate by waiting the current frame before `begin`ning any upcoming — the mutant that passes
today. `naming_the_next_frame_…` keeps its "served from the other window" claim; this test
owns the order.

Still a unit test of the product `ReadCtx`. That is the right layer for an order the wire
cannot see.

### 15.7 · Change 5 · the leftovers

| item | change | pinned by |
| --- | --- | --- |
| `fills=1` when `EndStream` arrives before the first fill frame | set `note_fill` when `next` returns the first `Serve` of that fill, not when `Fill` is accepted | `a_fill_stopped_before_its_first_frame_is_not_counted` |
| ring `build(8)` at W = 4 | `build(WINDOWS as u32)` — §14.1 asked; the ring never holds more than W. Not a performance lever | the two ring tests, unchanged |
| §1, §2, §4, §5 here and [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6d still say the channel is `W − 1` | correct to: the channel and `in_hand` share `ASKS_AHEAD`; the read path takes at most `WINDOWS − 1`. After 15.3 lands | — |
| `serve_batch` in two `read_campaign.rs` comments | strike — the lab should not describe a product method that is gone | — |
| HANDOFF §1 "Validated as the **product**"; NEXT §1 "Done" | **corrected with this section**, in place: the **read path** is validated as the product, the **session loop** is not until 15.4's run | — |
| an empty study refuses with `StreamFrames 0..=0 outside 0..=0` | say the study is empty | extend `an_empty_study_is_refused_with_from` |
| `end_stream_stops_a_fill_on_the_wire` can pass vacuously — on a slow host the 400 ms read times out before frame 1 | assert at least one frame arrived *and* `got < frames`; raise the study to 64 frames so the race window is wide | mutate: make `EndStream` a no-op |
| `cargo fmt` drift on the four files this branch touched | run `cargo fmt` on those files only | — |
| 470 of `server.rs`'s 763 lines are tests, the runtime / cert / port / connect preamble repeated 6× and `connect_session` unused by two of them | one `wire_test(frames, body)` helper taking a closure over `(control, media)`, every claim unchanged | the existing wire tests |
| Change **A** | still deferred, not this round | §13.1 |

Noted, not changed: `read_mode_parses_the_three_it_documents` sets a process-wide env var
while other tests construct a `ReadCtx`. Harmless today — no concurrent test asserts on the
mode — and Rust 2024 will make `set_var` unsafe. If it ever bites, split parsing into a
`from_str` the test calls directly and keep one env test.

Out of this round, for the owners: `exact-server` defaults to `--stream-mode per-frame`,
while §9.1's standing decision is one shared stream (per-frame is 5.76× worse at 250 KB under
1 % loss). The A/B pins `shared` on both arms; whether the binary's default should follow the
decision is a wire question, not a read-path one.

### 15.8 · Order of work

| # | lands | passes when |
| --- | --- | --- |
| 1 | 15.3 — bound `in_hand`, stream the batch, drop the double copy, stop `upcoming` at a non-frame | its three new tests green, each mutated once; `gate.sh` green. No measurement of its own: nothing here changes which bytes are served |
| 2 | 15.4a–b — `server_ab` and its runner | both binaries drive, tie/RESOLVED printed per cell, cold cells assert ≥ 99 % misses |
| 3 | **the run**: HEAD (with 1) against `580e312`, the six cells, on the workstation | `docs/disk-access/server_ab.tsv` + a host file committed. This is the run the four §13 commits never had, and one run covers them and change 1 together |
| 4 | 15.5 — `read` only if the **server** warm cell loses | the same cells, re-run interleaved, warm back to a tie |
| 5 | 15.6 — the gated-pool order test | the wait-first mutant fails it |
| 6 | 15.7 — `note_fill`, the ring's entries, the documents, the test-harness cleanup | `gate.sh` green; §1's channel sentence agrees with `planner.rs` |

Nothing in that list makes the lab a better product. The lab is not in the verdict path for
this work; after step 2 it is not in the gate path either.

### 15.9 · What this round does not do

P0 and P1. Change **A**. The throttled-link cell (§9.4) — it is a transport cell and wants
the product driver too, but after step 3, not with it. The client's cap on asks in flight
(§14.2), which is the one lever that moves latency on the default link and is client
protocol. `WINDOWS`, `FILL_AHEAD` and `ASKS_AHEAD` keep their §13.1 values; 15.4's run is
what could argue for moving one, and it has not run yet.

## 16 · Review of §15 as applied — the harness, and what the read path is now known to do

**2026-09-09, after §15's first four commits.** §15.3, §15.4a–b, §15.6 and §15.7 landed. This
section reviews them, records the defects found in the new harness, and answers the question
§15 could not: **is the disk-reading approach that ships still the one the lab measured?**

### 16.1 · The product changes hold, and now fail when broken

Every new test was mutated. All four kill their mutant, and two seam lines that §15.1 found
uncovered are covered now:

| mutation | before this review | now |
| --- | --- | --- |
| drop the `in_hand` cap in `Planner::next` | — | `the_loop_holds_no_more_than_asks_ahead` fails at 799 |
| `filter_map` instead of `take_while` on `upcoming` | — | `upcoming_stops_at_the_first_ask_that_is_not_a_frame` fails |
| `note_fill` on accept rather than on the first `Serve` | — | `a_fill_stopped_before_its_first_frame_is_not_counted` fails |
| wait the current frame before starting any upcoming | 38/38 green | `w_named_frames_start_before_the_current_read_finishes` times out and fails |
| **`serve` never turns `upcoming` into spans** | 41/41 green | `serve_hands_every_named_frame_to_the_read_path_as_a_span` fails |
| **`run_session` passes `&[]` to `serve`** | 41/41 green | `the_loop_hands_serve_the_frames_the_planner_named` fails |
| an upcoming frame out of range is not dropped | 41/41 green | `an_upcoming_frame_out_of_range_is_dropped_not_refused` fails |

The last three are this review's additions. §14.4 called the naming line "not observable on
the wire" and left it to a campaign; it is observable one layer down, without a clock. Two
unit tests own it now:

* `pipeline.rs` — `FramePipeline::serve`'s **default body** is product code; the test
  implements the trait's sink to see what reaches it, and `locate` stays the store's. The
  loop above it is not mocked, and neither is the read path below.
* `server.rs` — the loop is extracted as `drive(pipeline, asks)`, so a `Vec` of `Ask` drives
  planner → `serve` with no QUIC. Fill order, `FILL_AHEAD` and `fills=N` come with it.

`drive` is the one structural change here: six lines moved out of `run_session`, which keeps
the reader task's lifetime. It is §11 cut 2's own rule — the loop tested without the
transport — applied one level up.

### 16.2 · The harness had two defects that would have produced a wrong answer

Both were measured, not reasoned. **Neither is theoretical: together they would have filled
`server_ab.tsv` with cold cells that were 98 % hits, and said nothing.**

**a · the cold cell was not cold.** The driver walked `frame = i % frames` — consecutive
16 KiB frames, so kernel read-ahead served 7 of every 8. Measured on the shipped driver
against a live server, one cold cell of 64 asks after `evict`:

| frames between asks | bytes between asks | server-reported `miss_rate` |
| --- | --- | --- |
| **1 (as written)** | 16 384 | **0.016** |
| 8 | 131 072 | 1.00 |
| 16 | 262 144 | 1.00 |
| 32, on a 1024-frame study | 524 288 | 0.50 — the plan wrapped and re-read warm frames |

This is §14.4's trap, reintroduced: *"at 8 MiB of read-ahead the cold cell reached 4.7 %
misses — a hit cell wearing a cold label"*. `read_campaign` strides 250 kB for exactly this
reason. **Fixed:** `server_ab --step`, and the runner derives it as
`ceil(250000 / FRAME_BYTES)` — 16 for 16 KiB tiles — then refuses to start unless
`asks × step ≤ frames`, which is what the 0.50 row above costs when it is not checked.

**b · the control that would have caught (a) could not read its own input.** The runner
grepped `miss_rate=[0-9.]+` out of the server log, but `tracing_subscriber` emits ANSI
between the field name and the `=` even when stdout is a file, so the pattern never matched:
`miss` fell back to `-`, the `≥ 0.99` gate was skipped, and the row recorded `-`. **Fixed:**
`NO_COLOR=1` on both servers, a separator-tolerant pattern, and a missing `session reads`
line is now a hard failure rather than a `-`.

Two more, from reading rather than running:

* **the fill cell was held to the 99 % miss floor.** A fill is sequential; read-ahead turning
  it into hits is the design working (measured: `miss_rate=0.0029`, `fills=1`, whole study).
  The floor now applies to on-demand cells only.
* **`cpu_ns_per_ask` came from `stat`'s utime+stime — clock ticks, 10 ms here.** A 256-ask
  cell is one or two ticks. It reads `/proc/<pid>/task/*/schedstat` now: nanoseconds, summed
  over the server's threads.

And three smaller ones, all fixed: the driver never checked that envelope *n* answered ask
*n* (it does now, and the pairing is the whole timing model); `--asks` above the study's
frame count made a fill hang on a stream that had ended (`asks.min(frames)`); `rss_kib` was
one sample taken after the sessions had gone, so it is a baseline-to-peak delta from a
2 ms sampler now, and the runner has the `--sessions 64` cell §15.4d asked for.

**c · the lab did not compile, and `gate.sh` could not see it.** `UringReader::new` gained an
`entries` argument; `lab/disk-access-bench/src/bin/ring_scale.rs` still called it with one.
HANDOFF §10.2 says the lab arms are part of the API — so `gate.sh` now runs
`cargo check -p disk-access-bench --all-targets`, which is where this would have surfaced.

`ring_scale` re-run at `build(WINDOWS)`, 200 rings: **2.0 fds, 8.7 KiB, setup p50 17.9 µs**.
Unchanged from the `build(8)` figures in HANDOFF §2 — io_uring's per-ring memory is page
granularity, not four SQEs against eight — so [`DEPLOYMENT.md`](DEPLOYMENT.md)'s memlock
arithmetic stands as written.

### 16.3 · The A/B expected a base that does not exist

`server_ab.sh` wanted cold depth 2 to be a **win** for HEAD, "if the old loop was serial".
It is not: `9200c02` landed one-ask look-ahead before `580e312`, so the base peeks one ask
(`try_recv` once) and holds `WINDOWS = 2`. At client depth 2 both arms name one frame ahead
and use two windows — **the same shape**. The cells that can separate them are:

| cell | base at `580e312` | HEAD | can it separate? |
| --- | --- | --- | --- |
| cold depth 1 | names nothing | names nothing | no — tie is the control |
| cold depth 2 | 1 ahead, 2 windows | 1 ahead, 2 windows | no — **tie**, not a win |
| cold depth 4 | 1 ahead, 2 windows | 3 ahead, 4 windows | **yes** — this is the cell §13 is claiming |
| warm | one window per read | W-window table, `wanted` per read | only as cost |
| fill | 1 ahead, 2 windows | 1 ahead, 2 windows (`FILL_AHEAD`) | no — tie |

`WANT` is corrected to `cold_d2: tie`, `cold_d4: win`. The round's whole claim now rests on
one cell, which is the honest reading of §9.3: **tiles widen, fill does not.**

### 16.4 · What the read path is now known to do, end to end

Two interleaved A/Bs through the product server, 8 rounds, cold 16 KiB tiles at
`step 16` with `miss_rate ≥ 0.94` on every row, shared stream, loopback.
**Sandbox, not the workstation:** ~2.4–4.8 k asks/s against the workstation's ~50 k plateau
([`NEXT.md`](NEXT.md) §6), so nothing below resolves the 28.5 % rule. These are mechanism
checks — is the path taken, and which way does it move. Files:
[`x16_seam_ab.tsv`](x16_seam_ab.tsv), [`x16_ringpool_ab.tsv`](x16_ringpool_ab.tsv),
[`x16_host.txt`](x16_host.txt).

**HEAD against a build with the seam severed** (`serve` never turns `upcoming` into spans —
same binary otherwise):

| cell | p50 Δ | signs | verdict | severed | HEAD |
| --- | --- | --- | --- | --- | --- |
| cold depth 1 | −2.3 % | 5/8 | tie | 360 µs | 364 µs |
| cold depth 4 | **−20.6 %** | **7/8** | tie (under 28.5 %) | 742 µs | 608 µs |
| ladder d1 → d4 | HEAD **+101 %** asks/s | | | severed **+71 %** | |

Depth 1 ties, which is the control: with nothing named, the two builds are the same code.
Depth 4 moves in one direction 7 times out of 8. **The seam is live in the product.** And the
split is the useful part: of the ~101 % that client depth 4 buys, about 30 points are the
read-ahead and about 71 are the client pipelining hiding the round trip. That is §9.1's
argument — *"the loop and W are not where latency is lost on this link"* — measured rather
than reasoned, for the first time.

**The same binary, ring against pool** (`WTPACS_READ_PATH=auto` against `=pool`):

| cell | p50 Δ | signs | verdict | pool | ring |
| --- | --- | --- | --- | --- | --- |
| cold depth 1 | −13.1 % | 6/8 | tie | 396 µs | 348 µs |
| cold depth 4 | −12.6 % | 6/8 | tie | 689 µs | 620 µs |

The kill switch works — `ring=false` under `pool`, `ring=true` after the first miss under
`auto`. End-to-end **latency** is a tie, which is what [`adr.md`](adr.md) claims: the ring's
resolved result is **CPU per miss** (−42 to −73 %) and thread count, not latency, and §9.1
says the wire swamps a 65 µs read. Nothing here contradicts the ADR; it is the first time the
ADR's silence about end-to-end latency has been checked instead of assumed.

### 16.5 · Is the shipped read path the one the lab measured?

**The mechanism: yes.** `preadv2(RWF_NOWAIT)` inline on the executor, a ring built on the
first miss and never on a hit, the blocking pool where there is no ring, one read for the
rest of the frame on a miss. Every `hybrid_lazyring` claim in
[`EVIDENCE.md`](EVIDENCE.md) and [`adr.md`](adr.md) is about that mechanism, and it is
still the one taken: `read_fast_path=preadv2` in the banner, `ring=false` on a warm session
and after `WTPACS_READ_PATH=pool`, `ring=true` after the first miss, `miss_rate=1.0` on a
strided cold cell, `a_hit_never_touches_the_ring` and the two lazy-ring tests green.

**The implementation: no, and that has not changed since §15.1.** The numbers were taken at
`WINDOWS = 2` with the `Ahead` flip, a ring with its own slot table and `build(8)`. §13
replaced all three, §13.2 required each commit to tie against a worktree build, and no such
run is committed. `server_ab.sh` and `read_path_ab.sh` against `580e312` are still the two
runs that would close it, and neither has been made on a host that can resolve them.

**One translation gap, now closed.** §9.5 priced W against *reads in flight in the lab*, which
is `read_campaign`'s `--depths`. In the product, reads in flight are `min(client depth − 1,
W − 1) + 1` — the planner cannot name what the client has not asked for. So `W = 4` earns
nothing until a client pipelines four asks, and the lab's "depth 4: +26 to +37 %" is a
statement about client depth 4, not about the server alone. §16.4's ladder is that mapping
measured: the same +101 % against +71 % is the read path's share of it.

**What is still unmeasured, in order:**

1. `server_ab.sh <580e312>` on the workstation — the six cells, with `cold_d4` as the one
   that can separate the arms. The gate §15.4 was built for.
2. `read_path_ab.sh <580e312>` — the read path's own cost after the §13 rewrite, which is
   the commit-by-commit tie §13.2 asked for and never got.
3. P0 on the target: the ring against the pool where a miss costs ~1 ms rather than 65 µs.
   §16.4 says the ring is not a latency lever *here*; the volume class is what decides
   whether it is one there.

Everything §16 found and did not change is §17.

## 17 · Fix proposals — what §16 found and did not change

**2026-09-09.** §16 fixed the harness where it would have produced a wrong answer and closed
the two uncovered seam lines. What follows is everything else it found, as proposals rather
than commits, because each is either a product change (`CLAUDE.md`: propose before
implementing) or a cost that §15.5 says must wait for the warm cells. Ranked by what blocks
the run that decides this round.

§15.7's leftovers are **done** and are not repeated here: `note_fill`, `build(WINDOWS)`, the
`W − 1` sentences in §1/§2/§4 and §6d, the `serve_batch` comments, the empty-study message,
the vacuous `EndStream` wire test, and the `server.rs` test preamble.

### 17.1 · Before `server_ab.sh 580e312` runs

These decide whether that run's answer can be trusted. All three are small.

**P1 · `session reads` should say how far the planner reached, and how many reads were in
flight. Landed** with P7; recipe in §18.1. §16.4 had to *infer* that the seam was live by
timing two binaries against each other. Nothing — in the lab or in production — reports it
directly, so `W = 4` cannot be confirmed to engage on a real study, and the A/B cannot prove
the base used two windows and HEAD used four rather than infer it from a 20 % p50 move.

Two counters on `ReadStats`, both maxima, both set in `read`:

```rust
pub struct ReadStats {
    pub hits: u64,
    pub misses: u64,
    /// Most frames named at once — the planner's reach, `1 + min(upcoming, W − 1)`.
    pub peak_named: u16,
    /// Most windows with a read outstanding at once — what the device actually saw.
    pub peak_in_flight: u16,
}
```

`peak_named` is `wanted.len()` after the plan is built; `peak_in_flight` is the count of
windows with `read.is_some()` after the start loop, before the current one is waited. Both
join the `session reads` line beside `miss_rate` and `ring`. Six lines of product code.

This is the same argument that added miss-rate reporting — [`adr.md`](adr.md) §Reporting:
*the server could not report about itself*. With it, `server_ab.sh` asserts `peak_named` per
cell the way it already asserts `miss_rate ≥ 0.99`, and a severed seam fails the run instead
of showing up as a tie. Test: extend `w_named_frames_start_before_the_current_read_finishes`
to assert `(peak_named, peak_in_flight) == (WINDOWS, WINDOWS)`; mutate by dropping `upcoming`.

**P2 · `--sessions > 1` with `--temp cold` is not a cold cell.** All sessions walk the same
plan, so the first warms the study for the rest — `read_campaign` has `--partition` for
exactly this. Only the warm RSS cell uses `N > 1` today, so this is latent, not live. The
cheap fix is a refusal in `server_ab`'s argument parsing; partitioning the plan per session is
the other option and is only worth it when a cold multi-session cell is actually wanted.

**P3 · say what `rss_kib` is.** It is the server process's whole RSS growth over the session —
QUIC's per-connection buffers dominate it. Measured here: 64 warm sessions at depth 4 grew the
server by 14.7 MiB, **230 KiB per session**, against 64 KiB of windows. It is meaningful only
as a *difference between the two arms*, where the QUIC part cancels and the remainder is the
W = 2 → 4 window delta; the script already divides by the session count and must say so. One
line in the driver's header comment and one in the script's output. Without it the column will
be quoted as "the per-session cost of W = 4", which it is not.

### 17.2 · Product invariants

**P4 · `begin` keys a window before the read that fills it can fail.** `win.key = Some(...)`
and `win.len = remaining` are set, then `escalate` runs and can return `Err` (`io_uring SQ
full`, a failed `submit`). The window is then keyed as holding `remaining` bytes of which only
`hit` are real, and `holding` — which every later read trusts — would hand them out. It is not
reachable today: `read` propagates the error and the session ends. It is still the one
invariant the window table rests on, broken on a path nobody checks. Set the key after
`escalate` returns, or clear it on the error path; two lines. Test: a store lever that fails
the escalation once, then assert the window is not `holding` that span.

**P5 · a window never shrinks, and §9.3 understates it.** `fit` grows and never releases, and
a miss grows the window to the whole frame. A session that serves one 250 KB frame keeps
W × 250 KB = **1 MB** for its lifetime. §9.3's memory row reads "tiles, W 2 → 4: 32 → 64 KiB
per session", which is true only for 16 KiB tiles that hit; §14.1's "memory at thousands of
fills" covers the fill case at two windows, not the on-demand case at four.

**Proposal: correct the row, do not add shrinking.** The bound is `W × largest frame this
session served`, and the fix if it ever bites is §14.1's vectored read into fixed 64 KiB
blocks — already costed there. Adding an idle-shrink heuristic now is building for a future
that may not arrive. Measure it instead: run §15.4d's RSS cell once against the 250 KB fixture
as well as the tile one, and quote both.

**P6 · `read_asks` returns `Result<(), ()>`.** `map_err(|_| ())?` three times to say "the
receiver is gone, stop". `ControlFlow`, or a `bool`, says it once. Cosmetic; listed so it is
not rediscovered.

### 17.3 · Costs deferred until the warm cells rule (§15.5)

P7 landed with P1 because they share a hunk. The rest should not land before `server_ab.sh`
says the product warm cells lose. Costed here so the decision is one reading rather than
four investigations.

| # | cost | where | change |
| --- | --- | --- | --- |
| P7 | one `Vec` allocation per **64 KiB read** | `read_path.rs` `read` | **landed with P1** — `wanted` is `[(FrameSpan, u32); WINDOWS]` with a length |
| P8 | `free_window` rescans all W windows against `wanted`, O(W²) per read | `read_path.rs` | compute each `holding` once and reuse it |
| P9 | up to 5 wasted `frame_span` lookups and two oversized `Vec`s **per frame** | `planner.rs`, `pipeline.rs` | the planner names up to `ASKS_AHEAD` = 8; `read` uses `WINDOWS − 1` = 3. Cap `upcoming` at `WINDOWS − 1`. Trade-off: naming more survives an upcoming frame that fails to locate (§13.3), so the cap costs a little resilience for a smaller allocation |
| P10 | one `Vec` per ring wake | `uring_reader.rs` `reap` | `[_; WINDOWS]`; §14.1 already has this row |
| P11 | one atomic pair per frame | `pipeline.rs` `serve` | `Arc::clone(self.store())` exists to satisfy the borrow checker; a restructure removes it |

P9 is the only one of the five that is also a correctness-of-intent point: §13.3 says
`upcoming` is "the frames this session will be asked for after `frame`", and naming five the
read path throws away is not that. It is still a cost question, not a bug.

### 17.4 · Owner decisions

**P12 · `exact-server` defaults to `--stream-mode per-frame`.** §9.1's standing decision is one
shared stream — per-frame is 5.76× worse at 250 KB under 1 % loss on real hardware, and no cell
on either rig favours it. The wire tests, the harness and both A/B scripts all pin `shared`
explicitly, so the default is the one configuration nothing measures and nobody wants. Changing
it is a wire-behaviour change, not a read-path one, and the clients would need checking first.

**P13 · `gate.sh` has no `cargo fmt --check`.** The four server files this branch touched were
formatted by hand in §16; `client/`, `lab/window-harness/`, `server/src/record/` and
`tools/pack-study/` are still drifted, so adding the check repo-wide fails today. It needs one
mechanical `cargo fmt` commit across the workspace first, and that commit should land on its
own so it never sits inside a diff anyone has to read.

§18 is every proposal above as verified code. Where the two disagree, §18 is right: it was
written against the compiler.

### 17.5 · Not a proposal — the measurement backlog

Unchanged from §16.5 and repeated only so this section is not read as the whole of what is
left: `server_ab.sh 580e312` on the workstation, `read_path_ab.sh 580e312`, then P0 on the
target. No proposal here substitutes for any of them.

## 18 · §17 as code — for the implementer

**2026-09-09.** Each proposal below was written, compiled and tested in this tree. **P1 and
P7 landed** — they share a hunk, and P1 is what turns `server_ab.sh 580e312` from a timing
inference into an assertion. The rest wait here as verified recipes: **P2, P3, P4, P6,
P9–P13**. **P8 is withdrawn.**

Every remaining proposal was reverted after verification. Diffs are small, and each is
independent of the others except where said. Recipes stay so they can land later without
being rediscovered.

Order that remains: **P1 is in.** §19 already ran the A/B; the next run can assert `named`.
The waiting proposals can land in any order.

Two corrections to §17 first, both found while writing the code:

* **§17.3's P8 is wrong and is withdrawn.** It proposed computing each window's `holding`
  once and reusing it. That cannot be done: `begin` changes which window holds what *inside*
  the loop, so a cached map would be stale by the second iteration. The only sound version is
  fusing `holding` and `free_window` into one pass, which saves four comparisons at W = 4 and
  is not worth a line.
* **§13.5 was stale** (the lab does not implement `FramePipeline`). Corrected in place.

### 18.1 · P1 · the session line says how far the planner reached — landed

**Why:** §16.4 needed two binaries and eight interleaved rounds to infer that the seam was
live. This makes it one log line, on a real study, in production.

`server/src/media/read_path.rs`:

```rust
pub struct ReadStats {
    pub hits: u64,
    pub misses: u64,
    /// Most frames named at once: `1 + min(upcoming, WINDOWS - 1)`, the planner's reach.
    pub peak_named: u16,
    /// Most windows with a read outstanding at once — what the device saw.
    pub peak_in_flight: u16,
}
```

Two lines in `read`, one after the plan is built and one after the start loop, before the
current frame is waited:

```rust
        self.stats.peak_named = self.stats.peak_named.max(wanted.len() as u16);
        for &(s, p) in &wanted { /* unchanged */ }
        let started = self.windows.iter().filter(|w| w.read.is_some()).count() as u16;
        self.stats.peak_in_flight = self.stats.peak_in_flight.max(started);
```

`server/src/transport/pipeline.rs`, in `Drop for ProductPipeline`:

```rust
            named = stats.peak_named,
            in_flight = stats.peak_in_flight,
```

**Test:** extend `w_named_frames_start_before_the_current_read_finishes`:

```rust
        assert_eq!(
            (ctx.stats().peak_named, ctx.stats().peak_in_flight),
            (WINDOWS as u16, WINDOWS as u16),
            "the session line would not show W engaging"
        );
```

**Mutate:** make `read` ignore `upcoming`. Fails.

**Measured against a live server** on the tile fixture, cold, 64 asks per cell:

| client depth | `session reads` |
| --- | --- |
| 1 | `miss_rate=1.0 named=1 in_flight=1 ring=true` |
| 2 | `miss_rate=1.0 named=2 in_flight=2 ring=true` |
| 4 | `miss_rate=1.0 named=4 in_flight=4 ring=true` |
| 4, **seam severed** | `miss_rate=1.0 named=1 in_flight=1 ring=true` |

That last row is the whole argument for this proposal: what §16.4 read off a 20 % p50 move
across eight rounds, the log says outright.

**Harness half — landed.** `server_ab` has a `named` column (a `-` the runner fills, as it
does `miss_pct`); `field_from_log <key>` is ANSI-tolerant. The runner refuses any **after**
on-demand cell at depth ≥ 2 that named fewer than two frames (`580e312` has no field, so
before is not held to it), and the analysis prints the per-arm median at cold depth 4 —
which is where `before` showing 2 and `after` showing 4 proves the arms differ in the way
§13 claims, without reference to any timing.

### 18.2 · P2 · a cold cell is one session

**Why:** all sessions walk the same plan, so the first warms the study for the rest.
Latent — only the warm RSS cell uses `N > 1` — and one `ensure!` closes it.

`lab/disk-access-bench/src/bin/server_ab.rs`, first statement of `run`:

```rust
    anyhow::ensure!(
        args.sessions <= 1 || args.temp != "cold",
        "{} sessions cannot share a cold cell: the first warms the study for the rest",
        args.sessions
    );
```

**Verified:** `--sessions 64 --temp cold` now exits with that message.

### 18.3 · P3 · say what `rss_kib` is

**Why:** measured, 64 warm sessions at depth 4 grew the server by 14.7 MiB — 230 KiB per
session against 64 KiB of windows. QUIC's per-connection buffers are most of it.

Module header of `server_ab.rs`:

```rust
//! `rss_kib` is the server process's whole RSS growth, QUIC's per-connection buffers
//! included — read it as a difference between the two arms, never as the cost of a window.
```

and the runner's line becomes `… KiB/session (the arm difference; QUIC cancels)`.

### 18.4 · P4 · a window that could not start its read does not claim the frame

**Why:** `begin` sets `key` and `len = remaining`, then `escalate` can fail. The window is
then keyed as holding bytes no read ever wrote, and `holding` is what every later read
trusts. Unreachable today because `read`'s error ends the session; it is still the invariant
the window table rests on.

`server/src/media/read_path.rs`, the tail of `begin`:

```rust
        win.len = remaining;
        win.fit(remaining);
        match self.escalate(store, w) {
            Ok(pending) => {
                self.windows[w].read = Some(pending);
                Ok(())
            }
            // A keyed window promises the bytes it claims; one with no read landing in it
            // cannot keep that, so it goes back to being free.
            Err(err) => {
                self.windows[w].key = None;
                Err(err)
            }
        }
```

The test needs a failure it can cause, so `ReadCtx` gains one, alongside `force_pool_reads`
and `account_pool_start`:

```rust
pub struct ReadCtx {
    /* … */
    #[cfg(test)]
    fail_escalate: bool,
}

    fn escalate(&mut self, store: &Arc<FrameStore>, w: usize) -> Result<InFlight> {
        #[cfg(test)]
        if std::mem::take(&mut self.fail_escalate) {
            anyhow::bail!("test: escalation refused");
        }
        /* … */

    #[cfg(test)]
    pub(crate) fn fail_next_escalation(&mut self) {
        self.fail_escalate = true;
    }
```

**Test** `a_window_whose_read_could_not_start_does_not_claim_the_frame`: fail one escalation,
assert `read` returns `Err`, assert `!ctx.holds(span, 0)`, then drain the frame normally and
assert the bytes are right — the window has to be reusable, not just unkeyed.

**Mutate:** drop the `key = None`. Fails with *"the window still claims bytes no read ever
wrote"*.

### 18.5 · P6 · `read_asks` returns a bool

**Why:** `Result<(), ()>` with `map_err(|_| ())?` three times says "the loop has gone" three
times. Ten lines in, fifteen out.

`server/src/transport/server.rs`:

```rust
/// False once there is nothing more to read: the loop has gone, or the stream failed.
async fn read_asks(control_recv: &mut RecvStream, tx: &mpsc::Sender<Ask>) -> bool {
    let ask = match read_fod_msg(control_recv).await {
        Ok(FodMsg::RequestFrame { frame }) => Ask::Frame(frame),
        Ok(FodMsg::RequestFrames { frames }) => {
            for frame in frames {
                if tx.send(Ask::Frame(frame)).await.is_err() {
                    return false;
                }
            }
            return true;
        }
        Ok(FodMsg::StreamFrames { from, to }) => Ask::Fill { from, to },
        Ok(FodMsg::EndStream) => Ask::EndStream,
        Ok(FodMsg::EndSession) => Ask::EndSession,
        Ok(FodMsg::FrameError { .. }) => return true,
        Err(err) => Ask::Failed(err),
    };
    let failed = matches!(ask, Ask::Failed(_));
    tx.send(ask).await.is_ok() && !failed
}
```

with the caller becoming `if !read_asks(&mut control_recv, &tx).await { return; }`. Behaviour
is unchanged; the existing wire tests cover it.

### 18.6 · P9 · the planner names what a read can start

**Why:** it names up to `ASKS_AHEAD` = 8, `serve` locates all eight, and `read` uses three.
Five wasted `frame_span` lookups and two oversized `Vec`s per frame.

`server/src/transport/planner.rs`:

```rust
use crate::media::read_path::WINDOWS;

                    let upcoming = self
                        .in_hand
                        .iter()
                        .take_while(|a| matches!(a, Ask::Frame(_) | Ask::EndStream))
                        .filter_map(Ask::frame)
                        .take(WINDOWS - 1)
                        .collect();
```

`ASKS_AHEAD` keeps its meaning as the channel's and `in_hand`'s cap; its doc comment loses
the claim that it is also the naming cap.

**Test** `upcoming_never_exceeds_what_a_read_can_start`: push `ASKS_AHEAD` frames, assert
`upcoming.len() == WINDOWS - 1`. **Mutate:** back to `take(ASKS_AHEAD)`.

**The trade-off, stated so it is a decision:** naming eight survives an upcoming frame that
fails to locate (§13.3 drops those from `ahead`), so the cap trades a little resilience
against a client asking for out-of-range frames for a smaller allocation. A client that does
that is already getting `FrameError` per frame.

**Cost:** this couples `transport` to `media::read_path::WINDOWS`. `pipeline.rs` already
depends on `ReadCtx`, so the crate graph does not change.

### 18.7 · P7 · `wanted` stops allocating — landed

**Why:** one `Vec` per **64 KiB read**, so once per window of every frame.

`server/src/media/read_path.rs`, the head of `read` — this is the same hunk P1 touches, so
land them together or rebase:

```rust
        let mut named = [(span, pos); WINDOWS];
        let mut count = 1;
        for s in upcoming.into_iter().take(WINDOWS - 1) {
            named[count] = (s, 0);
            count += 1;
        }
        let wanted = &named[..count];
        self.stats.peak_named = self.stats.peak_named.max(count as u16);
        for &(s, p) in wanted {
            if self.holding(s, p).is_none() {
                let w = self.free_window(wanted);
                self.wait(w).await?;
                self.begin(store, w, s, p)?;
            }
        }
```

`free_window` already takes a slice. No test changes; the whole read-path suite covers it.

### 18.8 · P10 · `reap` fills a caller's array

**Why:** one `Vec` per ring wake. §14.1 has this row as *"only if it shows in a profile"* —
it is the least justified of the nine, and it is here so the decision is one reading.

`server/src/media/uring_reader.rs`:

```rust
    /// Fills `landed` with `(slot, bytes)` and returns how many. A short read is the
    /// caller's to resubmit. `landed` must hold one entry per read this ring can have in
    /// flight, which is one per window.
    pub(crate) fn reap(&mut self, landed: &mut [(usize, usize)]) -> Result<usize> {
        self.ring.completion().sync();
        let mut n = 0;
        for cqe in self.ring.completion() {
            self.in_flight = self.in_flight.saturating_sub(1);
            match cqe.result() {
                bytes if bytes > 0 => {
                    let slot = landed.get_mut(n).context("more completions than windows")?;
                    *slot = (cqe.user_data() as usize, bytes as usize);
                    n += 1;
                }
                0 => bail!("io_uring read hit EOF"),
                e => return Err(std::io::Error::from_raw_os_error(-e)).context("io_uring read"),
            }
        }
        Ok(n)
    }
```

`get_mut` rather than an index: more completions than windows cannot happen — one submission
per window, resubmitted only after its own completion — and a panic inside the ring path is
not the way to find out otherwise.

`ReadCtx::wait`'s ring arm becomes:

```rust
                let mut reaped = [(0usize, 0usize); WINDOWS];
                while windows[w].read.is_some() {
                    let got = ring.reap(&mut reaped)?;
                    for &(slot, landed) in &reaped[..got] {
```

`two_reads_in_flight_land_in_their_own_slots` drives `reap` directly and moves with it.

### 18.9 · P11 · the store leaves the trait's signatures

**Why:** `serve` clones the `Arc` once per frame purely to break a borrow — `self.store()`
borrows `self`, and `locate`/`send` take `&mut self`. Two atomics per frame. **Twenty lines
in, fifty-two out**, which is the real reason to take it.

`server/src/transport/pipeline.rs`:

```rust
    fn locate(&mut self, frame: u32) -> Result<FrameSpan>;

    async fn send(&mut self, frame: u32, span: FrameSpan, ahead: &[FrameSpan]) -> Result<()>;

    async fn serve(&mut self, frame: u32, upcoming: &[u32]) -> Result<()> {
        self.prepare(frame);

        let span = match self.locate(frame) {
            Ok(span) => span,
            Err(err) => return self.refuse(frame, err).await,
        };
        let ahead: Vec<FrameSpan> = upcoming
            .iter()
            .filter_map(|&frame| self.store().frame_span(frame).ok())
            .collect();

        self.send(frame, span, &ahead).await?;
        Ok(())
    }
```

`ProductPipeline` then reads its own fields, which is what the clone was standing in for:

```rust
    fn locate(&mut self, frame: u32) -> Result<FrameSpan> {
        self.store.frame_span(frame)
    }

    async fn send(&mut self, frame: u32, span: FrameSpan, ahead: &[FrameSpan]) -> Result<()> {
        let Self { store, out, read, .. } = self;
        out.send_frame(frame, store, span, ahead, read).await
    }
```

Four implementors change, all in `server/`: `ProductPipeline`, `RecordedPipeline` (delegation
only), and the two test recorders. `FrameOut::send_frame` is untouched. **Verified on
`telemetry` as well as default**, which is the one that could have broken.

**Recommendation: take it for the fifty-two lines, not for the atomics.** Two atomics per
frame will not show against 65 µs of read and 6.5 ms of wire (§9.1).

### 18.10 · Order, and what each costs

| # | lands in | + / − | independent | test |
| --- | --- | --- | --- | --- |
| **P1** | `read_path.rs`, `pipeline.rs`, `server_ab.rs`, `server_ab.sh` | 48 / 9 | yes | **landed** with P7 |
| P2 | `server_ab.rs` | 6 / 0 | yes | the binary refuses the cell |
| P3 | `server_ab.rs`, `server_ab.sh` | 4 / 1 | yes | — |
| P4 | `read_path.rs` | 53 / 3 | yes | new, mutated |
| P6 | `server.rs` | 10 / 15 | yes | existing wire tests |
| P9 | `planner.rs` | 17 / 2 | yes | new, mutated |
| **P7** | `read_path.rs` | 10 / 6 | **shares a hunk with P1** | **landed** with P1 |
| P10 | `uring_reader.rs`, `read_path.rs` | 17 / 7 | yes | existing ring test moves |
| P11 | `pipeline.rs`, `server.rs` | 20 / 52 | yes | existing |

**P1 and P7 landed.** §19 already ran `server_ab.sh 580e312` without them — cold depth 4
won on clocks. The next run can assert `named` instead of inferring W. P9, P10 and P11 are
§17.3's deferred
bucket: they are written here so the warm-cell decision is one reading, and none of them
should land on their own evidence. P2, P3, P4 and P6 are free of that rule — they are a
guard, a sentence, an invariant and a simplification.

## 19 · Verification — does the branch work, and does it optimise as expected?

**2026-09-09.** Asked before landing on `main`. Answered against `580e312`, the pre-cut base,
with the branch exactly as it ships — §18's proposals are **not** applied. Files:
[`server_ab.tsv`](server_ab.tsv), [`read_path_ab.tsv`](read_path_ab.tsv),
[`server_ab_host.txt`](server_ab_host.txt).

**Short answers.** It works: byte-exact against an independently computed digest, on both
binaries, warm and cold. It optimises as expected: **at client depth 4 and nowhere else**,
which is what §9.3 and §9.5 predicted. Every capability-preserving cell ties. Nothing
regressed — warm included, which settles §15.5.

### 19.1 · It works — bytes, not timings

A 512-frame fixture whose frames differ from one another in both content and length — 37 B,
65 535, 65 536, 65 537, 131 089 and 16 384, plus the index, so frames straddle `READ_WINDOW`
in every direction and a mis-assembled, misordered or mis-windowed frame cannot pass. The
digest is `sha256` over `(index, length, body)` in delivery order, computed independently
from the `.sbnd` file in Python and compared with what each server put on the wire.

| binary | fill (whole study) | on-demand depth 1 | on-demand depth 4 |
| --- | --- | --- | --- |
| base `580e312` | match | match | match |
| **branch** | **match** | **match** | **match** |

Repeated cold, with the file evicted first, so the escalation path and the ring carried part
of the traffic — both arms reported `ring=true`, and both still matched. Base and branch also
did the same number of reads per frame at depth 1 (`hits=935 misses=2` on both).

### 19.2 · The read path alone ties — §13.2's gate, met at last

`lab/scripts/read_path_ab.sh 580e312`, two `read_campaign` binaries interleaved, 8 rounds,
256 asks, p50 with `MIN_N = 5`:

| cell | p50 Δ | signs | verdict |
| --- | --- | --- | --- |
| `cold16_d1` | −0.9 % | 5/8 | tie |
| `cold16_dW` | +0.4 % | 4/8 | tie |
| `warm16_d1` | −8.5 % | 7/8 | tie |
| `seq1g_d1` (here an 84 MB sweep) | +17.0 % | 5/8 | tie, and exempt — a P0 I/O cell |

**Exit 0.** This is the condition §13.2 attached to each of the four §13 commits — *every A/B
cell ties* — and it is the first time it has been run. The window table, the thin ring and
`WINDOWS = 4` cost the read path nothing against the `Ahead` flip they replaced.

### 19.3 · The product server — where the win is, and where it is not

`lab/scripts/server_ab.sh 580e312`, both binaries up together, order rotated each round, 16
rounds, 256 asks, cold cells evicted and asserted, 16 KiB tiles strided 16 frames.

| cell | p50 Δ | signs | CPU/ask Δ | signs | asks/s Δ | miss control |
| --- | --- | --- | --- | --- | --- | --- |
| cold, depth 1 | +0.6 % | 8/16 | +2.6 % | 10/16 | −0.5 % | 0.984–1.000 |
| cold, depth 2 | +2.3 % | 10/16 | +0.0 % | 8/16 | −2.2 % | 0.984–1.000 |
| **cold, depth 4** | **−19.1 %** | **15/16** | **−28.0 %** | **16/16** | **+20.7 %** | 0.984–1.000 |
| warm, depth 1 | −1.3 % | 9/16 | +0.4 % | 9/16 | +2.4 % | 0.000 |
| warm, depth 4 | −9.6 % | 14/16 | −8.9 % | 14/16 | +10.2 % | 0.000 |
| fill | +1.6 % | 9/16 | +0.7 % | 8/16 | −0.2 % | 0.010–0.019 |

Read the sign column first. **Depth 1 is 8/16 — a coin flip on p50, +0.6 %.** That is the
control the whole run rests on: with no frame named, the two binaries are the same code, and
the instrument says so. Depth 2 is a tie too, and it should be: `9200c02` gave the base
one-ask look-ahead before `580e312`, so at client depth 2 both arms name one frame ahead and
use two windows. §16.3 predicted exactly this, and corrected the script's expectation to
match; the run confirms it.

**Depth 4 is where the four windows can show, and they do:** 15/16 on latency, **16/16 on
server CPU per ask**, +20.7 % throughput. Under a null of no effect, 16/16 is one run in
32 768. The CPU figure is −28.0 % against a threshold of 28.5 % — the cleanest metric lands
on the line, which is what a sandbox that tops out at ~7 k asks/s against the workstation's
~50 k plateau can be expected to do with a difference the wire dilutes.

**The script reports `cold_d4` as a failure, and it is right to.** Its `WANT` says *win*,
meaning RESOLVED under the 28.5 % rule, and this host cannot deliver that. Do not relax the
rule to make the run green: run it on the workstation, where the server is a much larger
share of each ask.

**Warm did not regress, on any metric.** Depth 1 is flat on all three; depth 4 is 14/16
*toward* the branch. Together with `warm16_d1` in §19.2 (−8.5 %, 7/8), the **`+17 %` warm CPU
that §15.5 was written around is not reproduced anywhere on the product path.** §15.5's rule
was: *product warm ties → ignore the CPU, do not micro-optimise `read`.* It ties. §18's P7
and P8 are therefore not justified by evidence, and P8 was already withdrawn as unsound.

**Fill ties**, as §9.3 says it must — fill names one frame ahead on both arms. It is worth
recording that an 8-round run beforehand read −22.0 % at 7/8 on this cell and the next read
+13.2 % at 5/8: a sign that flips between runs is noise, and the 16-round run reads +1.6 % at
9/16. Quoting the first of those three would have been a wrong answer.

**The depth ladder on the branch**: 2 992 → 4 772 asks/s (+59.5 %) → 6 812 (+42.7 %). §9.5
priced the lab equivalent at +59 % and +26 %.

### 19.4 · Memory — §9.3's row is a third short

Per-session RSS needs an untouched heap, so each measurement starts its own server (§19.5).
48 sessions, depth 4, warm 16 KiB tiles, interleaved:

| measurement | rounds | branch − base, per session |
| --- | --- | --- |
| standalone | 6 | **+42.6 KiB** |
| `server_ab.sh`, 8 rounds | 6 | **+39.4 KiB** |
| `server_ab.sh`, 16 rounds | 8 | **+49.0 KiB** |

**§9.3 predicts +32 KiB for tiles at W 2 → 4; the measurement is +39 to +49.** Two more
16 KiB windows are 32 KiB of buffer; the rest is allocator and page granularity. At a
thousand sessions the row's 32 MB is really ~43 MB. Total per-session server RSS is 228 KiB
on base and 271 KiB on the branch — QUIC's per-connection buffers are most of it, which is
why the number is only meaningful as a difference between arms (§17.3 P3).

### 19.5 · Three harness bugs, found only by running it

`server_ab.sh` had never been executed end to end. It does not survive first contact:

| bug | what happens | fix |
| --- | --- | --- |
| arm state packed as `arm:pid:url:log` | a URL contains colons, so `url` parsed as `https` and the run died at round 0 with `//127.0.0.1:14433/…: No such file or directory` | keyed by arm in three associative arrays; no delimiter at all |
| `miss_from_log` under `pipefail` | a log line not yet flushed makes `grep` exit 1, which `set -e` turns into an aborted run — **the 30-try retry loop the author wrote can never execute.** It survived two runs on timing luck and killed the third mid-flight, silently | `\|\| true` on the pipeline; the caller's retry now works |
| the RSS cell ran against a server that had already served the round's other cells | a warm heap absorbs a new session, so the cell reported **+1.8 KiB per session against a true +42.6** — a 24× under-read | the RSS cell leaves the round loop into its own phase, one fresh server per measurement |

One threshold also needed correcting: the cold floor of `miss_rate ≥ 0.99` is not expressible
below ~200 asks, and aborted a run on 63/64 misses. Measured, a cold cell reads 0.98–1.00 and
the failure the floor guards against — a stride inside the kernel's read-ahead — reads
0.02–0.05 (§16.2a). The floor is **0.95**, which separates them with two orders of magnitude
to spare and does not depend on the sample size.

### 19.6 · What this does not establish

* **Magnitudes.** ~7 k asks/s here against ~50 k on the workstation. Every number above is a
  direction with a sign count; the percentages are the sandbox's.
* ~~**That the planner named four frames.**~~ **Closed** — §18's P1 landed as `4d6b1ce`, and
  the session line now says it outright (§20.4). `cold_d4` showed it by its cost; it is an
  observable now.
* **The default link.** §9.4's throttled cell (20 Mbps, 50 ms, 1 % loss) is still unrun, and
  §9.1's arithmetic says the loop and W will tie there. The +20.7 % at depth 4 is a
  loopback number; on wireless the wire is three orders of magnitude larger than the read.
* **P0.** The ring against the pool where a miss costs ~1 ms rather than 65 µs. §16.4 found
  them tied on end-to-end latency here, consistent with the ADR claiming CPU per miss.

### 19.7 · Verdict

| claim | status |
| --- | --- |
| the branch serves the study exactly, warm and cold, fill and on-demand | **verified**, byte-exact against an independent digest |
| the §13 rewrite costs the read path nothing | **verified** — every `read_path_ab.sh` cell ties, exit 0 |
| depth 1 and 2 are unchanged against the base | **verified** — 8/16 and 10/16 signs, ±2 % |
| `WINDOWS = 4` buys something at client depth 4 | **verified in direction**: 15/16 on p50, 16/16 on CPU/ask, −28.0 % — at the resolution limit of this host, not past it |
| fill is unchanged | **verified** — 9/16, +1.6 % |
| warm does not regress | **verified**; the `+17 %` CPU that §15.5 was built around is not reproduced |
| the cost is 32 KiB per session | **corrected** — +39 to +49 KiB measured |
| `server_ab.sh` is a usable gate | **now**; it was not, and §19.5 is why |

## 20 · The alternatives, re-measured on the code that ships

**2026-09-09.** Asked after §19: *does this prove the approach superior to the other rings, and
to mmap?* **§19 does not, and cannot.** §19 compared the branch with `580e312` — the same
mechanism in a different shape — and answers "did the rewrite cost anything, and did W = 4 buy
anything". Arm-versus-arm superiority is a different question, settled in [`adr.md`](adr.md) §5
and [`EVIDENCE.md`](EVIDENCE.md) on the **pre-§13 shape**. Since §13 reshaped the code, those
verdicts were inherited, not re-checked.

So they were re-checked. `read_campaign`'s `product` arm is the shipped `ReadCtx` itself, so
this is the alternatives against the code that ships, today.
[`x17_arms.tsv`](x17_arms.tsv), [`x17_depth.tsv`](x17_depth.tsv),
[`x17_mmap.tsv`](x17_mmap.tsv), [`x17_host.txt`](x17_host.txt).

### 20.1 · Against the other ring shapes and the pool

12 repeats, 16 KiB, stride 250 kB, depths 1 and 4, warm and cold, arm order rotated per repeat,
paired under the campaign's rule (|median| ≥ 28.5 %, signs ≥ 0.8n). Negative favours the
shipped path.

| shipped `product` against | hits, depth 1 | hits, depth 4 | misses, by depth (CPU/ask) |
| --- | --- | --- | --- |
| **`pooled_pread`** — every read on the blocking pool | **−93.2 %, 12/12 RESOLVED** | **−92.6 %, 12/12 RESOLVED** | −19.7 % · **−29.6 % RESOLVED** · **−37.7 % RESOLVED** |
| **`uring`** — every read through the ring | **−33.0 %, 11/12 RESOLVED** | **−89.9 %, 12/12 RESOLVED** | −3.4 % · **+38.0 % RESOLVED** · **+86.6 % RESOLVED** |
| **`pool`** — `RWF_NOWAIT` inline, pool on the miss | −2.5 %, 8/12 tie | +9.4 %, 10/12 tie | +24.0 % · −20.3 % · **−29.8 %, 10/10 RESOLVED** |
| **`hybrid_lazyring`** — the lab's model of what ships | +3.9 %, 7/12 tie | +21.7 %, 11/12 tie | tie at every depth |

Miss columns are depth 1 · 4 · 16 from [`x17_depth.tsv`](x17_depth.tsv), 10 repeats, cold.
Medians behind the percentages, warm depth 4: `product` 2.2 µs p50, `pool` 2.0, `uring` 22.1,
`pooled_pread` 30.3.

**The same cells as medians, because a ratio is not a number anyone can picture.** p50 per
ask, median of 12 repeats of 256 asks ([`x17_arms.tsv`](x17_arms.tsv)); the cold ladder is
10 repeats ([`x17_depth.tsv`](x17_depth.tsv)):

| arm | warm p50 | warm p99 | warm CPU/ask | cold p50 | cold CPU/ask |
| --- | --- | --- | --- | --- | --- |
| | *depth 1 · depth 4* | *depth 1 · depth 4* | *depth 1 · depth 4* | *depth 1 · 4 · 16* | *depth 1 · 4 · 16* |
| **`product`** — what ships | **2.0 · 2.2 µs** | 3.5 · 8.0 µs | 0.4 · 2.6 µs | 95 · 133 · 282 µs | 147 · 79 · 57 µs |
| `hybrid_lazyring` | 1.9 · 1.7 µs | 3.6 · 3.4 µs | 0.4 · 0.4 µs | — | — |
| `pool` | 2.1 · 2.0 µs | 3.3 · 3.9 µs | 0.3 · 2.4 µs | 92 · 151 · 327 µs | 117 · 94 · 78 µs |
| `uring` | 3.1 · **22.1 µs** | 21.9 · 44.7 µs | 8.4 · 1.9 µs | 100 · 162 · 397 µs | 148 · **57 · 30 µs** |
| `pooled_pread` | **29.3 · 30.3 µs** | 69.1 · 296.4 µs | 42.1 · 38.5 µs | 110 · 160 · 326 µs | 171 · 105 · 89 µs |

`uring` reports `miss_pct` 100 even warm: `ReadMode::Uring` sets `probe = false`, so every read
is an escalation by construction. That is the lab lever, not a measurement of the cache.

Dividing these medians very nearly reproduces the paired percentages above — `product` against
`pool` on cold CPU at depth 16 is 57 / 78 = −27 % against the paired −29.8 %. **That agreement
is a property of this dataset, not a rule**: [`pair_arms.py`](../../lab/scripts/pair_arms.py)
exists because the two statistics once differed by 42 % against 24 % on the same cells, and
the paired one is what the threshold is defined on. Where they disagree here they disagree
loudly — `product` against `hybrid_lazyring` on warm CPU at depth 4 is 2.6 µs against 0.4,
which reads as 6×, and pairs at 14/24 signs: **not established, and the medians are the
misleading half.** Two runs of the same cell also differ by ~5 % (`product` cold depth 1 p50
is 99.7 µs in one file and 95.2 in the other), which is this host's floor.

Three things follow, and only the first is new.

**The `RWF_NOWAIT` fast path is worth what the ADR says.** Against `pooled_pread` — the escape
hatch that ships if P0 goes the other way — the shipped path is **93 % faster on a hit, 12/12,
at both depths**, and better on misses from depth 4. That is the largest single margin in the
tree and it is not close.

**A hit must never touch a ring, and the cost of getting that wrong grows with depth.**
`uring` is 33 % worse on hits at depth 1 and **90 % worse at depth 4** — 22.1 µs against 2.2.
It is genuinely *better* on CPU per miss (+38 % at depth 4, +87 % at 16), which is why it stays
as a lab flag: on a workload that never hits it would be the right arm. Real ones hit, which is
what `miss_rate=` in the session line exists to check.

**Against `pool`, the ring is still only conditionally better — and this host says so.** Hits
tie, as they must (the same inline `preadv2`); the miss margin is +24 % at depth 1, −20 % at 4,
and resolves only at **depth 16 (−29.8 %, 10/10)**. `adr.md` §5 claims −56 / −70 / −75 % at
depth 1 / 4 / 16 from the campaign hosts. **The shape reproduces; the magnitude does not.**
§16.4 found the same thing end to end — ring against pool tied on latency through the product
server. This is exactly the question [`NEXT.md`](NEXT.md) §3's **P0** exists to settle on the
production volume, where a miss costs ~1 ms rather than 65 µs, and it is why `adr.md` says
*Accepted — conditional on P0* rather than Accepted. Nothing here changes that status.

### 20.2 · Against mmap

`disk-access-bench` still carries every mmap arm. It has no arm that is today's `ReadCtx`; its
`pread_nowait_chunked` is the 2026-09-07 shape of the same mechanism — inline `RWF_NOWAIT`,
escalate the shortfall — and that is the bridge between the two harnesses. **Stated as an
assumption**, because it is one.

Multi-thread runtime, forward trace, 16 KiB, 9 repeats, co-tenant monitor on. `gap_max` is what
a co-tenant task waited while a worker was busy — the column mmap is rejected on:

| arm | warm p50 | warm gap max | cold p50 | **cold gap max** |
| --- | --- | --- | --- | --- |
| **`pread_nowait_chunked`** — the shipped mechanism | 3.5 µs | 93 µs | 3.1 µs | **289 µs** |
| `uring_nowait_whole` | 3.5 µs | 252 µs | 3.1 µs | 282 µs |
| `mmap_naive` | **2.1 µs** | 78 µs | **1.9 µs** | **2 095 µs** |
| `mmap_hybrid_mincore` | 2.8 µs | 74 µs | 2.7 µs | 164 µs |
| `mmap_touch_in_place` | 19.5 µs | 656 µs | 19.3 µs | 654 µs |
| `mmap_populate_read` | 37.2 µs | 150 µs | 32.9 µs | 193 µs |
| `mmap_blocking_touch` | 34.5 µs | 134 µs | 34.8 µs | 198 µs |
| `pread_blocking_pooled` | 31.7 µs | 151 µs | 35.0 µs | 192 µs |

**mmap is faster than the shipped path on the frame being read, and that is not the trade.**
`mmap_naive` is 2.1 µs against 3.5 warm and 1.9 against 3.1 cold — genuinely quicker, because
there is no copy. Then a page is missing, the executor thread faults, and **every co-tenant on
that worker waits 2.1 ms**: `gap_max` 2 095 µs against the shipped path's 289. That is
`adr.md` §5's *"faults freeze co-tenants: gap_max 1.5–4.2 ms"*, reproduced on this host, on
today's tree, at 2.1 ms. A PACS server is co-tenanted by construction — one runtime, many
sessions — so a 2 ms freeze charged to whichever session happens to share the worker is not a
latency profile anyone can reason about.

Every mmap arm that makes the fault **safe** pays for it: `blocking_touch` and `populate_read`
move the fault to the pool and land at 33–37 µs, ten times the shipped path;
`touch_in_place` keeps it on the worker via `block_in_place` and has the worst tail of anything
measured (p99 538 µs warm, `gap_max` 656 µs). `mmap_hybrid_mincore` looks fine in this table
and is rejected on a ground this run does not test: residency is not a lease, so a page
`mincore` calls resident can be evicted before the touch — `adr.md` records it unsafe under
memory pressure in 5 of 5 runs. **That rejection is structural and stands independently of
these numbers.**

### 20.3 · What this establishes, and what it does not

| claim | status |
| --- | --- |
| the shipped path beats the always-pool fallback | **RESOLVED**, −93 % on hits, 12/12, both depths |
| a hit must not go through a ring | **RESOLVED**, `uring` −33 % / −90 % on hits at depth 1 / 4 |
| `uring` is better on CPU per miss at depth | **RESOLVED** — and irrelevant while workloads hit; it stays a lab flag |
| the ring beats the pool on the miss path | **shape reproduced, magnitude not**: resolves at depth 16 only, on this host. **P0's question, unchanged** |
| mmap freezes co-tenants | **reproduced**: `gap_max` 2 095 µs cold against 289 µs |
| safe mmap is 10× slower | **reproduced**: 33–37 µs against 3.1–3.5 µs |
| `mmap + mincore` is unsafe under pressure | **not tested here** — structural, from `adr.md`; this run has no memory pressure |
| the §13 rewrite preserved any of this | **inferred**, not measured per arm: §19.2 shows today's read path ties `580e312`'s, and `product` ties `hybrid_lazyring` here |

And the standing caveat: 4 cores, ~7 k asks/s against ~50 k on the workstation. Directions and
sign counts are what these files establish. **The one verdict that would move on a better host
is the ring against the pool — which is the one already marked conditional.**

### 20.4 · Confirmed after P1 and P7 landed, and the mechanism read off the wire

The runs above were taken at `4239f5a`, before §18's **P1** (the session line reports the
planner's reach) and **P7** (`wanted` on the stack) landed as `4d6b1ce`. Both change `read`
on the hit path, so the arm comparison was repeated on the merged tree, 8 repeats, same cells:

| shipped `product` against | hits, depth 1 | hits, depth 4 | verdict |
| --- | --- | --- | --- |
| `pooled_pread` | −83.4 %, 8/8 | −86.6 %, 8/8 | RESOLVED, unchanged |
| `uring` | −76.0 %, 8/8 | −86.7 %, 8/8 | RESOLVED, unchanged |
| `pool` | +6.3 %, 7/8 | +1.3 %, 6/8 | tie, unchanged |
| `hybrid_lazyring` | +7.6 %, 6/8 | +18.2 %, 7/8 | tie, unchanged |

**No verdict moves.** Magnitudes shift inside this host's noise; the margins that resolve are
an order of magnitude clear of the rule, which is why they survive a change to `read`.

P1 also closes the one mechanism claim §19 could only infer. Cold 16 KiB tiles, strided,
through the product server, reading the session line rather than the clock:

| what the client did | `session reads` |
| --- | --- |
| depth 1 | `miss_rate=0.996 named=1 in_flight=1 ring=true` |
| depth 2 | `miss_rate=0.992 named=2 in_flight=2 ring=true` |
| **depth 4** | `miss_rate=0.996 **named=4 in_flight=4** ring=true` |
| **one `StreamFrames {}`** | `miss_rate=0.009 **named=2 in_flight=2** ring=true fills=1` |

`named` tracks client depth to `WINDOWS`, `in_flight` with it — **four device reads
outstanding at client depth 4**, which is what §19.3's −19.1 % p50 and −28.0 % CPU were
paying for. And the fill row is §9.3's decision as a fact rather than an inference:
`FILL_AHEAD = 1`, so a fill uses **two** windows however wide W is. *Tiles widen, fill does
not* — no longer argued, reported.

