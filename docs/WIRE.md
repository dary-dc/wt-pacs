# Wire protocol

Two WebTransport streams per session:

1. **Control (bidirectional)** — length-prefixed FoD JSON (`RequestFrame`, `RequestFrames`,
   `EndSession`). Server may write `FrameError` on the same stream for immediate refusal.

   **Ask granularity matters.** The **real-time path uses one `RequestFrame` per message.**
   An ask-reader task owns the control stream and feeds a planner; pipelined `RequestFrame`s
   become `current` + `upcoming`, not one-at-a-time. `RequestFrames` flattens to the same
   `Ask::Frame` per index. Start-to-end delivery without naming every index is `StreamFrames`,
   not a large batch. Client window depth
   ([`adr-client-window-depth.md`](adr-client-window-depth.md)) is the client's outstanding
   asks; the server realises up to `TILE_SLOTS` of them on one session.

`CancelFrames`, `generation`, and `RequestPath` were removed — see
[`adr-reject-server-ordering.md`](adr-reject-server-ordering.md) and
[`cleanup-plan-2026-08.md`](cleanup-plan-2026-08.md) §2b.

2. **Media (server unidirectional)** — `[4B BE envelope_len][4B BE display_index][HTJ2K codestream…]`.
   Every media envelope is length-prefixed in **both** stream modes. The difference is stream
   lifetime only: one persistent uni for the session (`shared`) or one uni per frame (`per-frame`).

Media-complete: frame completion is the envelope payload on a uni stream, not a separate control ack.

Study bundles use on-disk **SBND** layout (see `docs/FIXTURES.md`).

## Ask messages, and what the server actually does with them

| Message | Documented intent | What the server does today |
| --- | --- | --- |
| `RequestFrame { frame }` | interactive path, *depth = outstanding asks* | ask-reader + planner: this frame is served with any already-queued asks as `upcoming` |
| `RequestFrames { frames }` | bulk path, several indexes in one message | flattened to one `Ask::Frame` per index; the same planner, the same upcoming |
| `EndSession` | stop | stop |

The depth in `RequestFrame`'s intent is the **client's** — how many asks it may have
outstanding. The server keeps up to `ASKS_AHEAD` of them in hand and the tile reader
starts as many as fit in `TILE_SLOTS`. The shape:
[`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md) §6d.

### Fill mode (`StreamFrames`)

The client does not name every index. `StreamFrames { from?, to? }` (empty = the whole
study; omitted `from` → 0, omitted `to` → last frame) and `EndStream` at the next frame
boundary — not `EndSession`. A data request during a fill ends the fill and is served next.
[`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md) §6c.

## Server send path (copy discipline)

The server sends each media frame as an 8-byte head (`write_all`) and then the HTJ2K
codestream in `READ_WINDOW` (64 KiB) pieces. The bytes come from a session-owned buffer
(`SeqReader` or `TileReader`), not a mapping — `server/` has no mmap. That matches the
wire layout above without assembling a contiguous envelope in userspace.

**First-byte order.** `locate` already knows `span.len`, but the body must land before the
length prefix is written — a failed read after that prefix would desynchronise the shared
uni. What *can* move is the next-frame probe. `read` returns the current frame; `send_first`
puts the head and the first window into the QUIC send buffer; **then** `prime` starts the
named look-ahead; then `send_rest` writes the remaining windows. A miss still starts
upcoming tiles *before* the current wait (device depth, measured). A hit does not: those
probes are memcpy on the executor, and they used to sit in front of the first write.

`claude/serene-rubin-wakfg7` spent the hop on LTO, an MTU Chromium will not take, and a
fill `fadvise` that was a warm regression under a browser. This change is the serving-hop
wait, not those. **No real-computer first-byte move is claimed** — the tests pin the order;
an interleaved client-visible cell has not been run.

**One full-frame copy remains:** `wtransport` only exposes `write_all(&[u8])`, so QUIC copies the
codestream into its send buffer for retransmission. Handing quinn owned `Bytes` was measured
worse at 16 and 32 sessions and is not reopened. A copy-cost knee sweep (link rate vs memcpy
time) is still open in [`client-runtime-experiment-plan.md`](client-runtime-experiment-plan.md) §0.
