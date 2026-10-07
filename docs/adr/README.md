# Decisions

One record per decision, corrected in place when a claim in it is wrong ([`disk-access.md`](disk-access.md) §2 is the model).

| ADR | decision | status |
| --- | --- | --- |
| [`stream-shape.md`](stream-shape.md) | one shared stream carries a session's frames | accepted, default since 2026-09-11 |
| [`frame-framing-and-loop-shape.md`](frame-framing-and-loop-shape.md) | the session loop: an ask-reader task feeding a planner, a server-driven fill, read-ahead from asks in hand | open; §6b–6d built 2026-09-09, §6 closed by `stream-shape.md` |
| [`client-window-depth.md`](client-window-depth.md) | the client keeps the minimum ask depth that saturates the link | accepted; the browser client's window removed 2026-10-03 |
| [`stride-is-bandwidth-conservation.md`](stride-is-bandwidth-conservation.md) | skipping frames under a fast scroll conserves bandwidth, not fidelity | accepted |
| [`resolution-fitting-for-large-frames.md`](resolution-fitting-for-large-frames.md) | frames larger than the viewport are delivered at the resolution it shows | accepted, blocked on a dependency outside this repo |
| [`reject-server-cancel.md`](reject-server-cancel.md) | the server takes no cancel | accepted; §4–5 superseded by `reject-server-ordering.md` |
| [`reject-server-ordering.md`](reject-server-ordering.md) | the server serves asks in the order they arrive | accepted |
| [`disk-access.md`](disk-access.md) | how the server reads frame bytes: a page-cache hit inline, a miss to the ring or the pool, and its deployment | accepted |
| [`transport-idle-sessions.md`](transport-idle-sessions.md) | a keep-alive pair holds a session open while the user reads | proposed; built, off by default |
| [`transport-quic-stream-receive-window-defaults.md`](transport-quic-stream-receive-window-defaults.md) | quinn's default stream receive windows, not equalised across arms | accepted |
| [`telemetry-server-pipeline.md`](telemetry-server-pipeline.md) | server telemetry: the lab wraps the product's pipeline steps, in a feature-gated build | accepted |
| [`telemetry-instrument-clients-from-outside.md`](telemetry-instrument-clients-from-outside.md) | the browser clients are instrumented by patching `WebTransport` from outside, not by an inline recorder | accepted |
| [`exactness-in-production.md`](exactness-in-production.md) | every shown frame checked in the decoder worker against an XXH3-64 digest written at ingest, before paint; a mismatch decoded again, else blocked, and reported | proposed 2026-10-07; not built |
