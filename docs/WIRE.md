# Wire protocol

Two WebTransport streams per session:

1. **Control (bidirectional)** — length-prefixed FoD JSON (`RequestFrame`, `RequestFrames`,
   `EndSession`). After the bidi is accepted the server writes one `Study { frames }` so the
   client learns how many instances exist without a sidecar GET. It may also write `FrameError`
   for an immediate refusal.

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
| `Study { frames }` | catalog: how many instances the opened study holds | written once, pre-encoded at process start, as the first control message after accept |
| `RequestFrame { frame }` | interactive path, *depth = outstanding asks* | ask-reader + planner: this frame is served with any already-queued asks as `upcoming` |
| `RequestFrames { frames }` | bulk path, several indexes in one message | flattened to one `Ask::Frame` per index; the same planner, the same upcoming |
| `EndSession` | stop | stop |

`Study` is the QIDO/WADO-metadata analogue on this wire: JSON, no pixels. The bytes are
`{"op":"study","frames":N}`. A client that already has the bidi does not need
`GET /study/metadata` to learn `frameCount`. Measured on this host, interleaved, 8 pairs,
after the session is up: control-catalog p50 vs sidecar HTTP GET p50 is recorded with the
test `catalog_on_control_is_faster_than_a_sidecar_get` (run it; the gap is host-local).

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

**One full-frame copy remains:** `wtransport` only exposes `write_all(&[u8])`, so QUIC copies the
codestream into its send buffer for retransmission. `quinn`'s chunk/`Bytes` API could avoid that copy
on a native path; browsers cannot. A copy-cost knee sweep (link rate vs memcpy time) is still open
in [`client-runtime-experiment-plan.md`](client-runtime-experiment-plan.md) §0.
