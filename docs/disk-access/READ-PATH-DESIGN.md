# Read path — design proposal: depth, messages, and the loop around the seam

**2026-09-08 · Proposed. 2026-09-09 · §13 landed.** Assembled from what was agreed on the
day. Steps 0–2 and the four §13 commits (W = 4, planner, thin ring) are in the tree
([`HANDOFF.md`](HANDOFF.md) §1). §9 records why the loop and W are not where latency is lost
on the default link; remaining: the throttled-link cell, P0. It builds on three documents
and repeats none of them:

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
| memory per session | 32 → 64 KiB | after a miss, 2 → 4 frames: 500 KB → 1 MB; a thousand fills 500 MB → 1 GB |
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
| `w_named_frames_put_w_reads_in_flight` | on a `force_pool_reads` store, naming W − 1 upcoming frames starts W − 1 reads before the first is waited on: count blocking reads started against reads finished |
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
lab/scripts/read_path_ab.sh <base-commit>
    builds `read_campaign` from a worktree at <base-commit> and from HEAD,
    runs, alternating arms within each round: warm 16 KiB · cold 16 KiB at depth 1 and W ·
    the 1 GiB sequential fixture,
    pairs them, prints tie / RESOLVED per cell with the 28.5 % rule.
```

Run it for every change under `server/src/media/` and commit the TSV beside the others; the
rule for a refactor is that every cell ties. That is the performance test: on demand, on
the host that can resolve it, with the decision rule fixed before the run. In production,
the `session reads … miss_rate=…` line and `check-fastpath` are the running check that the
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
| naming W − 1 frames puts W − 1 reads in flight | **add** `w_named_frames_put_w_reads_in_flight` (§12) |
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
with its signature in commit 1a — they are also the check. The lab implements
`FramePipeline` for its timing stamps (`prepare`, `note_fill`), so the trait stays with one
serving method; it is not a mock. `note_batch(position, size)` loses its caller with cut 1,
since the loop no longer sees batches. **Recommendation: delete it** — the harness knows its
own asks. If a lab metric needs it, that metric is the reason to keep batch identity on
`Ask::Frame`, and that is a decision for the owners, not the implementer.

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
| **The upcoming-naming line is not observable on the wire** | the read path's use of `upcoming` is tested from both ends; the loop's naming of it is one line the wire tests cannot see | `w_named_frames_put_w_reads_in_flight` covers the read path; the loop's line is covered by the harness depth measurement in commit 2 | §12, §13.4 |
| **Say where the host saturates** | ~64 reads in flight on the workstation, ~840 MB/s; the sandbox on CPU; past it every arm ties by construction | every claim quotes its plateau | [`NEXT.md`](NEXT.md) §6 |
| **Quote latency or throughput, not both** | one is the other divided by depth | every table | `CLAUDE.md` |

### 14.5 · Documents

| item | do it when | owner |
| --- | --- | --- |
| **Fold [`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md) into this document** | when commit 3 lands, since A is then the only thing left in it | [`NEXT.md`](NEXT.md) §7 |
| **Correct the six documents in §13.6** | as each commit lands, not after | §13.6 |
| **`adr.md` §2 "numbers safe to quote"** | add the commit-3 depth number and the throttled-cell tie once measured | [`adr.md`](adr.md) |
