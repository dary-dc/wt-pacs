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
