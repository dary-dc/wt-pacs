# T6 — Session survival across a 4-tuple change, and what a reconnect costs

**Status:** step 1 **measured 2026-09-15 — the cliff is real and `--workers` decides it** ·
**Needs:** a phone and client telemetry for the rest · **Size:** each option a few hundred lines

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

1. **Native probe** (this VM) — **done, 3/3 each, deterministic.**
   `wtransport`'s client endpoint exposes no `rebind()` and no handle on the quinn endpoint
   beneath it, so the plan's call is unreachable. `lab/scripts/nat_rebind_relay.py` sits between
   client and server and changes its own upstream source port mid-session instead: a NAT rebind,
   which is the field case this lane names, and a closer analogue of it than `rebind()` would be.
   `lab/scripts/t6_rebind_probe.sh <workers>` runs it.

   | `--workers` | frames delivered | asks sent | censored | server saw the session end |
   | --- | ---: | ---: | ---: | --- |
   | 4 (one endpoint per core) | 18 | 22 | 74 % | **no** |
   | 1 | **49** | 49 | 0 % | yes |

   Identical on every repeat, because the rebind is at a fixed 6 s and the trace is
   deterministic. **The session dies at the 4-tuple change under per-core endpoints and
   survives it with one**, which is the mechanism §8 predicted, now recorded rather than
   assumed. The server never logs a session end on four workers: it does not know the
   connection ended, because the packets went to an endpoint that never knew it.
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
