# Read path — design review of the read/write seam

**2026-09-08 · Proposed, not implemented.** The owners flagged `stream_codestream`
(`server/src/transport/frame_out.rs`) and `ReadCtx::read` (`server/src/media/read_path.rs`)
as badly shaped and asked whether the whole read path is. The fault is real and confined to
that seam; the mechanism under it is small and measured. Per `CLAUDE.md`, a structural change
is proposed before it is built.

Revised the same day after a second pass, which found that fault 1 had a live consequence,
that the proposed call order loses the thing that was measured, and that the change is really
two changes with different prerequisites.

> The loop, the messages and the depth *around* this seam are proposed separately in
> [`READ-PATH-DESIGN.md`](READ-PATH-DESIGN.md), which builds on the changes below. **The two
> overlap and are pending a fold into one** — [`NEXT.md`](NEXT.md) §7. Read both before
> implementing either.

## 1 · What is wrong, exactly

```
serve_batch ──for frame──▶ serve_one(frame, next) ──▶ send_frame(span, next, ctx)
                                                             │ writes the 8-byte head
                                                             ▼
                       stream_codestream(uni, store, span, next, ctx)
                          pos = 0                                    ◀─(2) the cursor lives here
                          loop:
                            ready = ctx.read(store, span, pos, next)  ◀─(3) `next` on EVERY window
                            pos += ready.len()
                            for piece in ready.chunks(READ_WINDOW)    ◀─(1) a constant here…
                              write_all(piece)

                       ReadCtx::read(store, span, pos, next)
                          stride = store.read_window(span.len)       ◀─(1) …a question to the store here
                          at = span.offset + pos                     ◀─(2) …and re-derived here
                          take_ahead = pos == 0 && ahead.span == span ◀─(4) intent decoded from coordinates
```

1. **One value, two owners — and it was a live defect, not a smell.** Both sides sized the
   pieces from `store.read_window`. The transport used it to bound a *write* chunk, the read
   path to bound a *read*, and `read_window` answers only the second: it returns the **whole
   frame** when `RWF_NOWAIT` is refused, deliberately, so a container pays one pooled read per
   frame instead of one per window. The transport inherited that as its write chunk, so
   `ready.chunks(stride)` yielded **one piece of the whole frame** — a 250 KB uninterrupted
   executor copy, the shape [`adr.md`](adr.md) rejected an arm for at **4.0 ms warm
   `gap_max`**, on exactly the deployment [`DEPLOYMENT.md`](DEPLOYMENT.md) already calls the
   slow one. **Fixed in `259e25f`**, pinned by
   `a_pooled_frame_is_written_in_read_windows_not_in_one_copy`. What is left is the shape: two
   sizes with two reasons, one now a bare constant in the transport and the other a question to
   the store, and nothing naming either. That is what change A fixes.
2. **One cursor, two owners.** The caller advances `pos`; the callee re-derives the offset and
   remainder from it. Neither layer owns the iteration over a frame, so neither reads alone.
3. **Read-ahead threaded through every call.** `next` is an intent that applies once per
   frame; it rides on every window read and is acted on only when an internal `Option` is
   empty.
4. **Intent decoded from coordinates.** `pos == 0` means "a new frame: take the prefetched
   window, or abandon a wrong one". Frame identity is span equality, not the index. The callee
   is a state machine whose transitions are inferred from argument patterns.

Below the seam:

5. **Window and ring slot coupled by convention.** `WINDOWS = 2` in one file, `SLOTS = 2` in
   another, and "window index equals ring slot" lives in a comment. "Never grow a window
   while its slot is busy" is enforced by discipline, and the ring keeps a raw address to
   honour it.
6. **Two ownership models for one buffer.** On the ring path the window stays put and the
   kernel writes into it; on the pool path the `Vec` is moved to the blocking thread and
   back. Same window, a different story depending on which fallback ran.

Also fixed since this was first written: `prepare()` carried an `async`, a `Result` and a
refuse branch that no implementation could reach. It is now `fn prepare(&mut self, frame: u32)`.

## 2 · What is not wrong

* **Efficiency.** A 16 KiB tile that hits is one `preadv2` and one `write_all`; a 250 KB frame
  is four of each, deliberately. A miss is one ring submission for the rest of the frame, and
  the bytes the probe already produced are kept. The shipped path ties the lab arm on every
  column, is −45.4 % CPU against the pool on 16 KiB misses, and read-ahead by one added
  +73.8 % on missing tiles at a warm tie ([`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Validated,
  [`v36_readahead.tsv`](v36_readahead.tsv)). Nothing measured is left on the table here.
* **The ring binding** (`uring_reader.rs`): one job, a stated contract, a drop that waits for
  the kernel, and two-slot completion demultiplexing that is right.
* **The store** (`frame_store.rs`): `read_at_nowait` and the `RWF_NOWAIT` probe are as simple
  as they should be.

"The whole implementation is this bad" is not what the code shows. The problem is ~120 lines:
one API and its one caller.

## 3 · Change A — the seam

**No `unsafe`, no ring change, and independent of P0**: the shape is the same whether the
miss path is a ring or the pool, so this does not wait on the backend decision.

Move the loop into the read path. The transport stops knowing about windows and cursors.

```rust
// server/src/media/read_path.rs
impl ReadCtx {
    /// Bytes of one frame, and the read of `next` started under them.
    pub fn frame(&mut self, store: &Arc<FrameStore>, span: FrameSpan, next: Option<FrameSpan>)
        -> FrameBytes<'_>;
}

impl FrameBytes<'_> {
    /// The next piece, or `None` at the end of the frame. Each piece is at most one window.
    pub async fn next(&mut self) -> Result<Option<&[u8]>>;
}
```

```rust
// server/src/transport/frame_out.rs
uni.write_all(&head).await?;
let mut bytes = ctx.frame(store, span, next);
while let Some(piece) = bytes.next().await? {
    uni.write_all(piece).await.context("write codestream")?;
}
```

Four notes an implementer needs, each of which is a way to get this wrong:

* **`frame(span, next)`, not `prefetch(next)` then `open(span)`.** The +73.8 % came from this
  order — adopt-or-start the current frame, *then* start the next, *then* wait — and calling
  a separate `prefetch(next)` first inverts it, submitting the next frame's read ahead of the
  one the client is waiting for. It also cannot compile the other way round: `FrameBytes`
  borrows the `ReadCtx` for the loop, so nothing else can call into it in between. Both
  problems disappear when the two intents arrive together, once per frame.
* **Two chunk sizes, deliberately named.** `259e25f` separated them; A is where they get
  names and one owner:

  | | today | after |
  | --- | --- | --- |
  | how much to ask the store for in one call | `store.read_window`, inside `ReadCtx::read` | whole frame where `RWF_NOWAIT` is refused — saves pool round trips |
  | how much to hand the transport at a time | `READ_WINDOW`, a constant in `frame_out.rs` | always ≤ `READ_WINDOW` — bounds the executor copy |

  Collapsing them back into one inside `FrameBytes` restores the defect.
* **`next()` is a lending method, not a `Stream`.** `-> Result<Option<&[u8]>>` borrows the
  reader for as long as the piece is used, which a `while let` loop satisfies and a `Stream`
  impl cannot express without GATs. Do not try to make it one.
* **The transport now accepts the reader's piece size**; it no longer chooses. That is one
  owner rather than none, which is the point — but it does mean a future write path that
  wants a different chunk (`write_chunk`, say) is a change in `FrameBytes`, not in the wire
  loop.

## 4 · Change B — the ownership

**After P0**, and only if the ring survives it. One type owns a buffer and its slot, and its
state says who holds it:

```
Window { buf: Vec<u8>, slot: 0 | 1 }

   Idle(Window) ──start(ring or pool)──▶ InFlight(Window, Pending) ──settle──▶ Idle(Window)
```

The headline is not "fewer concepts". It is that two of the read path's safety obligations
stop being obligations:

* **`UringReader::start` stops being an `unsafe fn`.** Its contract today — "valid, unmoved,
  unaliased until `finish`" — is pushed onto the caller and honoured by a comment. If the
  ring takes the `Window` by value while the kernel holds it, ownership discharges the
  contract; only the internal re-submit of a partial read stays unsafe.
* **`ReadCtx::drop`'s explicit drain becomes unnecessary.** It exists so the guarantee does
  not depend on field declaration order. A ring that owns its in-flight windows drops,
  drains, and releases them in that order by construction.

`grow()` exists only on `Idle`, so growing a busy window becomes a compile error rather than
a `SAFETY` note. The pool path moves the whole `Window` to the blocking thread and back, so
both fallbacks tell one ownership story. `WINDOWS` and `SLOTS` become one constant, because a
window *is* its slot.

## 5 · Cost, checks and collisions

| | |
| --- | --- |
| Buys (A) | one loop instead of one split across two modules; the read-ahead intent visible in the API; the two chunk sizes named and owned in one place, where `259e25f` only pulled them apart |
| Buys (B) | one fewer `unsafe fn`, one fewer drop-order obligation, one constant instead of two |
| Costs | roughly the same line count, no new mechanism, no new measurement |
| Also moves | `lab/disk-access-bench/src/bin/read_campaign.rs` — the `product` and `product_ahead` arms call `ctx.read` directly, so the API change lands there too, and they are also the check |
| Not touched | `frame_store.rs`, the wire format, `pipeline.rs` beyond its `next` translation |

**Checks, in order.** The ten `read_path` tests and two `uring_reader` tests are the
specification: their assertions stay, their harness moves with the API. Then
`a_batch_arrives_whole_and_in_ask_order` (the end-to-end wire test) and
`streamed_bytes_match_the_envelope_they_replaced`, which together say the bytes did not
change. `a_pooled_frame_is_written_in_read_windows_not_in_one_copy` is the test that pins the
write chunk; it was written for A and landed early with `259e25f`, so A inherits it and must
keep it passing.

**Then measure, interleaved.** Build the pre-refactor binary in a `git worktree` and alternate
arms within each round; a sequential before/after already produced a wrong answer in this
project (+8.1 % on what was a tie). `read_campaign --arms product,product_ahead` on the sweep
and stride shapes, paired with `lab/scripts/pair_arms.py`, must tie.

**Two collisions to sequence.** P1 (park on the ring fd, drop the eventfd) rewrites the same
file as B and was costed against today's binding — land them together or order them
explicitly. And the session loop, the seam's other caller, **landed first**: the ask-reader
task and the `StreamFrames` fill are built
([`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6d,
[`READ-PATH-DESIGN.md`](READ-PATH-DESIGN.md)), so A now lands against `serve_one`,
`serve_batch` and `fill` as they are, rather than leaving them one call site to feed.

Status: **A is proposed and unblocked. B is proposed and waits for P0.**
