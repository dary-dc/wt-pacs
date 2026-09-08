# Read path — design review of the read/write seam

**2026-09-08 · Proposed, not implemented.** The owners flagged `stream_codestream`
(`server/src/transport/frame_out.rs`) and `ReadCtx::read` (`server/src/media/read_path.rs`)
as badly shaped and asked whether the whole read path is. This is the answer: the fault is
real and confined to that seam; the mechanism under it is small and measured. A reshaping is
proposed below. Per `CLAUDE.md`, a structural change is proposed before it is built.

## 1 · What is wrong, exactly

```
serve_batch ──for frame──▶ serve_one(frame, next) ──▶ send_frame(span, next, ctx)
                                                             │ writes the 8-byte head
                                                             ▼
                       stream_codestream(uni, store, span, next, ctx)
                          stride = store.read_window(span.len)       ◀─(1) computed here…
                          pos = 0                                    ◀─(2) …and the cursor lives here
                          loop:
                            ready = ctx.read(store, span, pos, next)  ◀─(3) `next` on EVERY window
                            pos += ready.len()
                            for piece in ready.chunks(stride): write_all(piece)

                       ReadCtx::read(store, span, pos, next)
                          stride = store.read_window(span.len)       ◀─(1) …and again here
                          at = span.offset + pos                     ◀─(2) …and re-derived here
                          take_ahead = pos == 0 && ahead.span == span ◀─(4) intent decoded from coordinates
```

1. **One value, two owners.** Both sides compute the window from the store. The transport
   uses it to bound a write chunk, the read path to bound a read: two decisions, two reasons,
   tied to one store property (`nowait`) that has nothing to do with writing.
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

## 2 · What is not wrong

* **Efficiency.** A 16 KiB tile that hits is one `preadv2` and one `write_all`; a 250 KB frame
  is four of each, deliberately — a whole-frame read measured a 4.0 ms executor gap. A miss is
  one ring submission for the rest of the frame, and the bytes the probe already produced are
  kept. The shipped path ties the lab arm on every column, is −45.4 % CPU against the pool on
  16 KiB misses, and read-ahead by one added +73.8 % on missing tiles at a warm tie
  ([`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Validated, `v36_readahead.tsv`). Nothing measured
  is left on the table at this seam.
* **The ring binding** (`uring_reader.rs`): ~200 lines, one job, a stated contract, a drop
  that waits for the kernel, and two-slot completion demultiplexing that is right.
* **The store** (`frame_store.rs`): `read_at_nowait` and the `RWF_NOWAIT` probe are as simple
  as they should be.

"The whole implementation is this bad" is not what the code shows. The problem is ~120 lines:
one API and its one caller.

## 3 · The proposal

Move the loop into the read path; make the three intents explicit; let the transport know
nothing about windows or cursors.

```
serve_batch ──for (frame, next)──▶ send_frame(span, next, ctx)
                                       ctx.prefetch(next)                 ① once per frame, an explicit verb
                                       write head
                                       let mut frame = ctx.open(span)     ② takes the prefetched window if it is this frame
                                       while let Some(piece) = frame.next().await? {
                                           uni.write_all(piece).await?    ③ pieces arrive already window-sized
                                       }
```

* **`prefetch(next)`** replaces the `next` argument on every read. Called once, between
  frames, where the batch loop already knows the next index. Keyed by frame index.
* **`open(span)`** replaces `pos == 0`. It decides in one place whether the prefetched window
  is this frame's, and abandons a wrong one there and nowhere else.
* **`next()`** yields pieces until the frame is exhausted: one window on a hit; on a miss the
  reader holds the rest of the frame and yields it window by window. The cursor lives inside
  the frame reader only, and the transport never sees a read window size.

One type owns a buffer and its slot, and its state says who holds it:

```
Window { buf: Vec<u8>, slot: 0 | 1 }

   Idle(Window) ──start(ring or pool)──▶ InFlight(Window, Pending) ──settle──▶ Idle(Window)
                                                  ▲
                            the only state in which the kernel or the pool holds it;
                            grow() exists only on Idle, so growing a busy window is a
                            compile error rather than a SAFETY comment
```

The pool path moves the whole `Window` to the blocking thread and back, so both fallbacks
tell one ownership story; the ring's `start` takes the window, not an address. `WINDOWS` and
`SLOTS` become one constant, because a window *is* its slot.

## 4 · What it buys, what it costs, how it is checked

| | |
| --- | --- |
| Buys | fewer concepts; the read-ahead invariant visible in the API instead of a comment; one loop instead of one loop split across two modules; the busy-window rule enforced by the type |
| Costs | a refactor of about the same line count; no new mechanism, no new measurement |
| Check | the ten `read_path` tests and two `uring_reader` tests are the specification and stay; then `read_campaign --arms product,product_ahead` on the sweep and stride shapes, which must tie the current numbers |
| Not touched | `frame_store.rs`, the ring's submit/reap/park, `pipeline.rs`, the wire format |

Status: **proposed**. Build it as one change against those tests, after P0 has said whether the
ring stays — the seam is the same either way, but the ring branch of `Window` is not worth
polishing the week before it might be deleted.
