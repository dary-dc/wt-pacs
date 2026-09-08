# Wire protocol

Two WebTransport streams per session:

1. **Control (bidirectional)** — length-prefixed FoD JSON (`RequestFrame`, `RequestFrames`,
   `EndSession`). Server may write `FrameError` on the same stream for immediate refusal.

   **Ask granularity matters.** The **real-time path uses one `RequestFrame` per message.**
   `RequestFrames` is served as a batch — every frame in it is sent before the next control message is
   read — which makes it a **bulk / sequential path for testing** (start-to-end sends where latency is
   not under test). A batch of `N` produces an effective outstanding depth of `N` regardless of the
   depth the client computed, so client window depth
   ([`adr-client-window-depth.md`](adr-client-window-depth.md)) **does not apply to it** and its
   latency numbers are not comparable to the interactive path.

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
| `RequestFrame { frame }` | interactive path, *depth = outstanding asks* | **serves one at a time** — the next ask is not read until the current frame is on the wire |
| `RequestFrames { frames }` | bulk path, batch drained before the next ask | serves the batch serially, frame *n+1* not read until *n* is sent |
| `EndSession` | stop | stop |

The depth in `RequestFrame`'s intent is the **client's** — how many asks it may have
outstanding. The server flattens it to one. That is a known limitation with a measured cost
and a proposed shape, not a protocol decision:
[`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md) §6b.

### Missing: a server-driven streaming mode

For ultrasound and other small/medium-frame studies the client should not have to name
indexes at all — one "study open, start loading" message, then the server streams frames in
order until told otherwise. **Not implemented**, and `RequestFrames` is not a substitute
because it still enumerates every index. Design notes and the open question (flow control) in
[`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md) §6c.

## Server send path (copy discipline)

The server sends each media frame as **three `write_all` calls** on the uni stream: length prefix,
4-byte display index, then the HTJ2K codestream slice from the mmap'd bundle. That matches the wire
layout above without assembling a contiguous envelope in userspace.

**One full-frame copy remains:** `wtransport` only exposes `write_all(&[u8])`, so QUIC copies the
codestream into its send buffer for retransmission. `quinn`'s chunk/`Bytes` API could avoid that copy
on a native path; browsers cannot. A copy-cost knee sweep (link rate vs memcpy time) is still open
in [`client-runtime-experiment-plan.md`](client-runtime-experiment-plan.md) §0.
