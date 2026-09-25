# Proposal: when UDP does not work

**2026-09-19 · Status: proposed, nothing built. One part measured here; the rest is design and
arithmetic.** Structural, so this is a proposal first (`CLAUDE.md`). L21, amended by
[S1 and S22](improvements/2026-09-18.md).

**2026-09-25 · Built, off by default** (TC1, queue row 77): the owner decided the TCP path is completion of
the implementation, not a bet on performance. §What was built says what exists and what is still owed; the
device check of §What must be shown is still owed before it is *enabled* anywhere.

WebTransport needs UDP. Some networks impair it — Chrome's field data puts it near 5 % — and on
those a client gets nothing at all, not a slow viewer. Separately and more seriously,
**every iPhone is affected by something else entirely**, which changes what this proposal is for.

## How fast a client knows — measured

`lab/scripts/udp_reject_time.mjs`, headless Chromium, 6 rounds, arms interleaved with the order
reversed each round. Time from `new WebTransport(...)` to its rejection. The certificate hash is
deliberately bogus: the dial has to fail at the UDP layer, well before anything reads a
certificate.

| the network | what the host does | time to rejection |
| --- | --- | ---: |
| **refused** — nothing bound on the port | answers ICMP port unreachable | **2 ms** [2 … 3] |
| **silent** — a socket bound, replying to nothing | swallows the datagram | **4 004 ms** [4 003 … 4 005] |

**The two failure modes differ by a factor of two thousand, and the one that matters is the slow
one.** A network that impairs UDP does not send ICMP — a firewall that drops is the ordinary case,
and a middlebox that answers "unreachable" is the rare one. So the realistic cost of dialling into
an impaired network is **four seconds of blank viewer**, and the 2 ms case is the one that already
behaves.

Four seconds is Chromium's own handshake timeout and is not configurable from the page. **A client
that waits for rejection has already lost.** That is the whole argument for §Race it, below.

## The iOS problem is bigger, and is not about networks at all

[S1](improvements/2026-09-18.md): WebKit bug 319818 — a WebTransport connection stalls after
16 MB because flow control never refills. Open since 2026-08-26. A 61 MB fill would freeze at
about a quarter of the way through **on every iPhone, on a perfectly good network**.

This changes the proposal's scope. A fallback justified by "~5 % of networks" is a contingency; one
that also covers **all of iOS** is a platform requirement. Whatever is chosen here should be
chosen on the second framing.

**There is a route that keeps QUIC on iOS**, and it should be costed before a TCP path is adopted
for that platform: recycle the session before 16 MB and re-issue. The downloader already re-issues
an undelivered remainder after an ask ends a fill (L16, D3), and
[`proposal-session-survival.md`](proposal-session-survival.md) makes re-dial-and-re-issue an
ordinary operation on the per-frame records. A 61 MB study then needs four sessions rather than
one, at the cold-open cost [`proposal-session-open.md`](proposal-session-open.md) is reducing.
**Nobody has measured what that recycling costs**, and it is the cheaper experiment of the two.

## What to fall back to, and what each option loses

A WebSocket over TCP carrying the same envelopes is the obvious candidate. Against a QUIC session
it gives up four things this project has measured or relies on:

| lost | why it matters here |
| --- | --- |
| **independent streams** | one TCP connection is one ordered byte stream, so a slow frame blocks every frame behind it — head-of-line blocking is exactly what `queue-and-hol-harness.md` exists to keep out |
| **loss recovery per stream** | a retransmit stalls everything, not one frame |
| **the idle-session behaviour L15 measured** | Chromium's 30 s advertised timeout and its self-pings are QUIC-side; a WebSocket's liveness is a different mechanism with different numbers, and none of L15 transfers |
| **`stream_frames` as it stands** | a pushed fill over one ordered stream is a different protocol, not the same one on another transport |

None of that makes TCP wrong as a *fallback* — a degraded viewer beats no viewer. It makes it
wrong as a silent equivalent, and it means the conformance suite cannot simply be pointed at it
and declared passing: the clauses about independent delivery would have to be marked
not-applicable rather than green.

## Race it, do not detect it

[S22](improvements/2026-09-18.md). Given 4 004 ms to rejection, detection is the wrong shape. The
client should **open both and use whichever answers**, then drop the other. The cost is one extra
connection attempt on every open; the saving is the four seconds, which is otherwise paid in full
by exactly the users the fallback is for.

This makes the measured number above **moot by design**, which is the point: it is reported here so
the cost of *not* racing is on the record, not because a future client should depend on it.

## What it costs

Rough, and deliberately so — this is a proposal:

* **Server:** a second listener speaking the same envelopes over TCP. The frame path, the store and
  the planner do not change; `FrameOut` gains a second implementation. One process can serve both —
  they are different sockets, not different services.
* **Client:** a second `Implementation` behind the existing seam
  ([`client-shape-plan.md`](client-shape-plan.md) §0). That is what the seam is for, and the
  conformance suite already runs every clause against every implementation — which is how the
  losses in the table above would be made visible rather than assumed.
* **The wire:** unchanged. Same envelopes, same FoD messages.

## What must be shown before any of this is built

*Superseded for the build on 2026-09-24/25 by the owner's decision (queue §Row 77); item 1 still stands
before the path is enabled anywhere, and items 2–3 remain the open questions they were.*

1. **A device check.** iOS is the reason the scope grew and **nobody here has run a browser on an
   iPhone**. The 16 MB stall is read from a bug report, not reproduced. Before a TCP path is built
   for it: confirm the stall, and confirm the recycling route does or does not avoid it.
2. **The cost of recycling**, which is cheaper to try than a second transport and may remove the
   iOS half of the justification entirely.
3. Only then, whether ~5 % of networks alone justifies carrying a second transport.

The decision stays with the workstation. Nothing above is a recommendation to build.

## What was built

2026-09-25, TC1. The shape §What it costs describes; the frame path, the store and the planner are
untouched.

**The wire.** One WebSocket carries what a session's QUIC streams carry, in the same bytes:

| | QUIC | WebSocket |
| --- | --- | --- |
| FoD, both ways | the control bidi, `[4B LE len][JSON]` | one text message per FoD message, the JSON alone |
| media | uni streams, `[4B BE len][4B BE index][codestream]` | binary messages whose bytes, joined, are the shared uni stream's; the codestream split every 64 KiB, the grain at which a browser — which hands a message over only whole — sees a frame's bytes move |
| port | UDP `--port` | TCP, the same number, with `--websocket` |
| certificate | pinned by hash | the browser's trust store: a real certificate in deployment; a test cert through Chromium's `--ignore-certificate-errors-spki-list` |
| opening ask | `?ask=` in the URL | not honoured: the fill is the socket's first message, a round trip later |

**Server** (`server/src/transport/websocket.rs`). A TCP listener with the same certificate, TLS via
rustls, `TCP_NODELAY`; `FrameOut::WebSocket` beside `Shared` and `PerFrame`, and refusals through the
same writer as the frames. One process serves both. What the WebSocket path does not have: the QUIC
knobs (`--congestion`, the windows — TCP's are the kernel's), the per-session `session path` line,
and telemetry rows. L15's idle behaviour does not transfer, and nothing here measures TCP's.

**Client.** `client/transport-ts/frame-session.ts` now holds everything a session does whatever
carries its bytes; `session.ts` (WebTransport) and `ws-session.ts` (WebSocket) are carriers over it,
and the downloader takes either as `transport`. `race-session.ts` is §Race it: opt-in, it dials both
and keeps the first ready, closes the other when its dial settles, and sends an opening fill to the
winner alone — in both dials' URLs, both servers would push it.

**Conformance.** Every clause runs against the WebSocket client, and the independent-delivery ones are
listed by name as not applicable rather than counted: the per-frame mode of two clauses, and a new
clause — *a frame slow on its own stream holds no other* — that the WebTransport clients and the
downloader pass. A truncated frame does apply: on TCP it is the connection ending inside one. Four race
clauses: QUIC first, TCP first, QUIC refused (and both refused), and the opening fill. The real-server
check in `run_wire.sh` now runs refusals and an ask during a fill over the WebSocket, raw and through the
downloader; its refusal count had passed a session that died, and now requires the server's reason.

**The loopback smoke** (`lab/tcp-fallback/`): WebTransport, WebSocket and the race through the
downloader, a 120-frame fill with asks during and after it, **every frame bit-exact on every arm, 3
rounds interleaved**. No performance claim (`rig-limits.md` §3). One observation it turned up: **on
loopback the WebSocket wins the race — 58 of 60 dials against a debug server, 57 of 60 against a release
one**, headless Chromium, 200 ms between dials. With the round trip near zero, the handshakes' work
decides; on a link, TCP+TLS+upgrade is three round trips against
the QUIC dial's 2.1, so QUIC should win by about one. Not measured on a link.

**What the shaped A/B on the workstation should measure**, arms interleaved:

1. A fill's wall time and its per-frame inter-arrival p99, WebTransport against WebSocket, at 40 and
   80 ms, clean and at 1 % / 3 % loss. The owner expects a tie or a TCP win clean and a loss under
   loss; the p99 is where head-of-line blocking shows.
2. An ask during a fill: time to the asked frame. Over either it waits behind what of the fill is already
   queued — QUIC's send window, TCP's socket buffer — and the two are not the same size.
3. Each dial's time to ready, and which one the race keeps at each RTT. If TCP wins on short links, the
   race hands the fallback every LAN, and QUIC wants a head start.
4. A network that drops UDP: the race's time to ready against the four seconds a WebTransport dial waits.
