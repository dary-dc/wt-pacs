# Proposal: when UDP does not work

**2026-09-19 · Status: proposed, nothing built. One part measured here; the rest is design and
arithmetic.** Structural, so this is a proposal first (`CLAUDE.md`). L21, amended by
[S1 and S22](improvements/2026-09-18.md).

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

1. **A device check.** iOS is the reason the scope grew and **nobody here has run a browser on an
   iPhone**. The 16 MB stall is read from a bug report, not reproduced. Before a TCP path is built
   for it: confirm the stall, and confirm the recycling route does or does not avoid it.
2. **The cost of recycling**, which is cheaper to try than a second transport and may remove the
   iOS half of the justification entirely.
3. Only then, whether ~5 % of networks alone justifies carrying a second transport.

The decision stays with the workstation. Nothing above is a recommendation to build.
