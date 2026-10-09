# The same fill over QUIC, a WebSocket and the race

TC1 (queue row 77). `series-server --websocket` serves the same envelopes and FoD messages over a
WebSocket, TCP on the QUIC port's number; `run.mjs` drives the downloader over WebTransport, over the
WebSocket (`ws-session.js`) and over the race (`race-session.js`), and hashes every frame it gets
against its source: a 120-frame fill of frames 1 KB–600 KB, three asks outside the fill while it
runs, three inside it after it completes. Variants interleaved, the order rotated each round.

```bash
NODE_PATH=$(npm root -g) node lab/tcp-fallback/run.mjs 3    # rounds
```

**A correctness smoke, not a comparison.** Loopback's 64 KB MTU favours TCP (`docs/rig-limits.md`
§3). Results and what the shaped A/B on the workstation should measure:
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §What was built.

## The opening ask in the upgrade's URL

WSA (queue row 106). `wsa.mjs` dials `ws-session.js` through the relay's TCP plane and fills four
250 KB frames: `ws` asks the fill on the socket once it is open (today), `ask` carries it in the
upgrade's URL (`--open-ask`). Variants Williams-ordered (`lab/order.mjs`), a server and a `--self-timing`
relay per visit, `VOID` visits dropped.

```bash
NODE_PATH=$(npm root -g) node lab/tcp-fallback/wsa.mjs --rounds 12    # [--rtts "40 80 160"] [--server BIN]
```

2026-10-02, 20 Mbit, 200-packet queue, 12 rounds, 14 of 72 visits `VOID`, every frame bit-exact:

| RTT | first frame, `ws` | `ask` | `ask` − `ws`, paired | in round trips |
| --- | --- | --- | --- | --- |
| 40 ms | 271.4 ms (10) | 227.0 (8) | −43.6 (7/7 faster) | −1.09 |
| 80 ms | 431.0 (10) | 347.5 (12) | −83.8 (10/10) | −1.05 |
| 160 ms | 751.3 (8) | 587.6 (11) | −164.3 (7/7) | −1.03 |

The fill's end moves by the same amount; the split by predecessor is flat. A server that ignores
the query (mutant) gives the `ask` variant no frame at all — the client trusts the push, as over QUIC —
rather than a tie. The TCP plane shapes rate and delay only and charges the TCP setup round trip;
TLS is not modelled and there is no loss (`docs/rig-limits.md` §3), so this is the round trip the
ask saves and nothing about TCP's recovery.
