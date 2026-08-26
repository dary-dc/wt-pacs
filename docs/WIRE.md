# Wire protocol

Two WebTransport streams per session:

1. **Control (bidirectional)** — length-prefixed FoD JSON (`RequestFrame`, `RequestFrames`,
   `EndSession`). `RequestFrame` / `RequestFrames` may include optional `generation` (default 0);
   product `exact-server` ignores it. Server may write `FrameError` on the same stream for immediate
   refusal.

`CancelFrames` was removed — see [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md).

2. **Media (server unidirectional)** — one stream per frame response, payload
   `[4B BE display_index][HTJ2K codestream…]`.

Media-complete: frame completion is the envelope payload on a uni stream, not a separate control ack.

Study bundles use on-disk **SBND** layout (see `docs/FIXTURES.md`).
