# Wire protocol

Two WebTransport streams per session:

1. **Control (bidirectional)** — length-prefixed FoD JSON (`RequestFrame`, `RequestFrames`, `EndSession`).
   Server may write `FrameError` on the same stream for immediate refusal.

2. **Media (server unidirectional)** — one stream per frame response, payload
