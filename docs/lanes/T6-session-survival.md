# T6 — Session survival across a 4-tuple change, and what a reconnect costs

**Status:** open, design · **Needs:** a phone, client telemetry, a decision · **Size:** each option a few hundred lines

## Question

Per-core endpoints hash a session's 4-tuple onto one socket
([`../transport/why-these-changes.md` §8](../transport/why-these-changes.md)). A Wi-Fi to
cellular move or a NAT rebind changes the tuple; the packets land on another endpoint, which
does not know the connection and sends a stateless reset. The TS client has no reconnect. A
reconnect is a cold session — 2 RTT plus certificate verification, about 1.5 RTT to the first
server-side byte with optimistic streams — and pooling onto a warm connection is not available
in Chromium or Safari, only Firefox, so nothing shortens it.

## Decision rule

From the field rate: if sessions change their 4-tuple more than once per session-hour,
build steering; otherwise build client reconnect and keep per-core endpoints. Either way the
client reconnects, because steering does not cover a server restart.

## Steps

1. **Native probe** (this VM): a lab binary on quinn's client that opens a session, receives
   ten frames, calls `Endpoint::rebind()` to a new port, and asks again — against `--workers 4`
   and `--workers 1`. Expected: reset on 4, survival on 1. Records the mechanism rather than
   assuming it.
2. **The browser.** On a phone, a session scrolling while Wi-Fi is switched off: does
   Chromium migrate a WebTransport session at all, or does it reconnect on its own? Unknown
   today; a device answers it in an afternoon.
3. **Telemetry.** Count resets and reconnects per session-hour in the client recorder; that
   number is the decision.
4. **Options, costed:**
   - *Steering by connection ID.* `EndpointConfig::cid_generator` makes the server's CIDs
     encode the worker index; an `SO_ATTACH_REUSEPORT_EBPF` program (~40 lines) reads it and
     picks the socket. Needs `CAP_BPF` / `CAP_NET_ADMIN` at start, so root in a container.
     Migration then survives; the QUIC-LB draft's idea, one box wide.
   - *The multi-thread runtime without §8.* Keep the frame pool, PGO and the patch; drop the
     per-core endpoints. Costs 5–24 % CPU per ask at saturation and the depth-1 hand-offs
     (`why-these-changes.md` §8), buys migration for free.
   - *Client reconnect.* `TransportSession` re-establishes on a reset and re-asks the
     outstanding frames; the window carries over. Cheapest; every migration costs a cold
     handshake.

## Report

The probe's result, the phone's, and the rate; the decision in `why-these-changes.md` as a
new entry.

## Stop conditions

Step 2 showing Chromium never migrates: then only NAT rebinds matter and the rate in step 3
is what to read.
