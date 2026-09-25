# The same fill over QUIC, a WebSocket and the race

TC1 (queue row 77). `exact-server --websocket` serves the same envelopes and FoD messages over a
WebSocket, TCP on the QUIC port's number; `run.mjs` drives the downloader over WebTransport, over the
WebSocket (`ws-session.js`) and over the race (`race-session.js`), and hashes every frame it gets
against its source: a 120-frame fill of frames 1 KB–600 KB, three asks outside the fill while it
runs, three inside it after it completes. Arms interleaved, the order rotated each round.

```bash
NODE_PATH=$(npm root -g) node lab/tcp-fallback/run.mjs 3    # rounds
```

**A correctness smoke, not a comparison.** Loopback's 64 KB MTU favours TCP (`docs/rig-limits.md`
§3). Results and what the shaped A/B on the workstation should measure:
[`docs/proposal-udp-fallback.md`](../../docs/proposal-udp-fallback.md) §What was built.
