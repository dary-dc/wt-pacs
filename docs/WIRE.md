# Wire protocol

Two WebTransport streams per session:

1. **Control (bidirectional)** — length-prefixed FoD JSON (`RequestFrame`, `RequestFrames`,
   `CancelFrames`, `EndSession`). Server may write `FrameError` on the same stream for immediate
   refusal.

`CancelFrames` is best-effort: the server **ignores** it and drains asks FIFO. Frames already being
written complete; there is no ack. See [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md).

2. **Media (server unidirectional)** — one stream per frame response, payload
   `[4B BE display_index][HTJ2K codestream…]`.

Media-complete: frame completion is the envelope payload on a uni stream, not a separate control ack.

Study bundles use on-disk **SBND** layout (see `docs/FIXTURES.md`).
