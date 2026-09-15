# T8 — Reachability: the sessions that cannot use UDP

**Status:** open, product · **Needs:** client telemetry, a decision · **Size:** ~300 lines each side if built

## Question

Three to five percent of networks impair UDP (Chrome's field data: 5 %, mostly at the access
network). `wtransport` speaks HTTP/3 only, and the TS client checks neither `reliability` nor
`requireUnreliable`. A viewer on such a network gets no session, not a slower one. The
survey's capsule-mode fallback loses stream independence and unreliable delivery; this
protocol uses neither on its default shared stream, so a fallback that carries the same wire
over a TCP transport loses nothing it uses.

## Decision rule

Measure first: if more than 2 % of sessions fail to establish over UDP in the field, build
the fallback; if fewer, record reachability as a non-goal with the number.

## Steps

1. **Telemetry.** The client recorder counts `WebTransport` construction failures and
   `ready` rejections per network type where the platform exposes it, and successes, over a
   month of real sessions.
2. **Design, if built.** The same FoD messages and `[len][index][codestream]` envelopes as
   binary WebSocket frames on one TCP connection: a `TransportSession` adapter in the TS
   client behind the same API, chosen when `WebTransport` is absent or fails; on the server a
   WebSocket endpoint that feeds the same ask reader and `FramePipeline`, with a `FrameOut`
   variant writing to the socket. Ordering and head-of-line blocking are those of the shared
   stream already.
3. **Not** `webtransport-h2`: wtransport does not carry it, browsers' support is uneven, and
   it buys nothing over a WebSocket for this wire.

## Report

The failure rate by network type in `docs/CLIENTS.md`; the decision beside it.

## Stop conditions

None until the number exists.
