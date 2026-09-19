# ADR: holding a session open while the user reads

**Status:** proposed, with the mechanism built and off by default · 2026-09-15 · container-measured.

The product opens its transport session when the user picks a series and uses it when the viewer
mounts, which may be minutes later. Nothing held such a session open, so it died in the gap — and
until `docs/CLIENTS.md#a-closed-session-is-noticed-at-once` the client did not even notice.

## The decision

**Server-sent keep-alive every 20 s, and a 60 s server idle timeout.** One pair, because they are
one budget: quinn only sends a keep-alive if the interval is below *both* peers' idle timeouts, so
the interval is meaningless without the timeout beside it.

`--keep-alive-interval-ms` and `--max-idle-timeout-ms` are both server flags. Keep-alive is built
and **off by default**; nothing changes until this ADR is accepted.

## Why the server sends it

A browser is the product's client, and the WebTransport API exposes no keep-alive knob at all. The
brief framed this as "quinn's `keep_alive_interval` is off by default"; for a browser it is not off,
it is absent. quinn's own documentation settles what to do about that:

> Only one side of any given connection needs keep-alive enabled for the connection to be preserved.

So the server is the only end that can hold a browser's session open *through the API*. **Measured,
not assumed**: a server with a 5 s idle timeout and no keep-alive lost 3 of 3 sessions over a 12 s
idle hold; the same server with `--keep-alive-interval-ms 2000` kept 3 of 3, with the client sending
nothing.

**A real browser turned out not to need it** (2026-09-16, §What a real Chromium does). The API has no
knob, but Chromium keeps the connection alive by itself, so the sentence above is true of the API and
too strong about the outcome.

## What an idle held session costs

`lab/scripts/idle_session_cost.sh`, which opens N sessions, holds them, and then proves each is
still usable rather than trusting the handle. Server RSS and CPU from `/proc`, datagrams from
`/proc/net/snmp` — system-wide, so on loopback it counts both ends.

| sessions | keep-alive | RSS | per session | CPU over 15 s* | datagrams/session |
| --- | --- | --- | --- | --- | --- |
| 200 | 3 s | 16.6 MB | 82 KB | 560 ms | 42 |
| 500 | 3 s | 39.1 MB | 78 KB | 1 220 ms | 43 |
| 1 000 | 3 s | 76.4 MB | 76 KB | 2 450 ms | 43 |
| 2 000 | none | 150.7 MB | 75 KB | 3 420 ms | 33 |
| 2 000 | 3 s | 150.8 MB | 75 KB | 4 810 ms | 44 |

**Linear to 2 000 with no knee**, and memory is identical whether keep-alive is on or off — it buys
packets, not state. The per-session figure falls slightly with N because the server's fixed
footprint is being divided by more sessions; 75 KB is the marginal cost.

Three numbers to carry:

* **~75 KB of server memory per idle session.**
* **~0.05 ms of CPU per session per second of hold** (2 000 sessions ≈ 32 % of one core), of which
  keep-alive at 3 s is about 40 %.
* **2 datagrams per interval per session** — one ping and its acknowledgement. The 11-datagram gap
  between the two 2 000-session rows over 15 s is exactly the 5 intervals a 3 s keep-alive fits.

**Where this host saturates, and what is therefore not claimed.** Nothing saturated: 2 000 sessions
is 150 MB and about a third of one core of four. The measurements stop there and so does the claim.
Extrapolating the CPU line puts one full core near 6 000 sessions, but that is arithmetic, not a
measurement, and CPU is container-measured anyway.

## Picking the pair

At 20 s rather than 3 s the packet cost falls by the same factor: **2 datagrams per session per
20 s**, so a thousand held sessions cost about 100 datagrams a second between them. The CPU share
attributable to keep-alive falls with it.

* **20 s keep-alive.** Comfortably below the 60 s timeout, and below the **30 s Chromium actually
  advertises** — measured, §What a real Chromium does — which matters, because the effective idle
  timeout is the *lower* of the two ends and the browser's end is not ours to set.
* **60 s idle timeout.** Long enough that a brief loss of connectivity does not cost the session,
  short enough that a genuinely dead peer's 75 KB comes back inside a minute. The current default is
  the library's 30 s, which is below the browser's own and leaves no margin.

The pair is deliberately conservative on packets and deliberately generous on state, because state
is cheap here — 75 KB — and a dropped session costs a user-visible reconnect at the moment they
open the viewer.

## What a real Chromium does

Headless Chromium 141, loopback, against this server, driven by `client/harness/idle-hold.html` —
which dials, takes a frame, sends nothing for the hold, then asks for another frame, so **alive
means a frame arrived**, not that the handle still exists.

**It advertises 30 s, as assumed.** From `--log-net-log`, the transport parameters Chromium sends
carry `max_idle_timeout 30000`; the server's carry the same (the library default). Only a server
sends `stateless_reset_token`, which is how the two sets are told apart.

**And it is not idle.** Over a 45 s hold Chromium sent three 29-byte packets, at **15.0, 30.0 and
45.0 s**, each `NOT_RETRANSMISSION` and each drawing an ACK from the server. That is a keep-alive
ping on Chromium's 15 s timer, and it restarts the idle timer at **both** ends.

| server | hold | alive |
| --- | --- | --- |
| idle 60 s, no keep-alive | 28 s / 33 s / 45 s | yes / yes / yes |
| idle 60 s, no keep-alive | **180 s** | **yes** |
| idle 60 s, keep-alive 20 s | 45 s / 180 s | yes / yes |
| idle 5 s, no keep-alive | 12 s | **no** — "Connection lost." |

The last row is the 5 s cell above, reproduced with a real browser instead of the native harness: a
15 s ping cannot save a 5 s timeout, and that is the whole of why that cell died.

**What this changes, and what it does not.** The pair stands — 30 s was the figure it was chosen
against and 30 s is what Chromium advertises. What is no longer true is that the server is the only
thing holding the session up: with the recommended 60 s timeout, **a browser session survives 180 s
of silence with server keep-alive off**. Keep-alive earns its place as the lever for an effective
timeout below ~15 s and for clients that do not ping — not as the thing that keeps Chrome connected.

**Do not lean on the 15 s.** It is Chromium's implementation, not a guarantee of the WebTransport or
QUIC specs; another browser, or another Chromium, may not do it. The 60 s timeout is what makes the
session survive, and it is ours. This was measured with an open bidi control stream — the product's
shape, and the case Chromium's ping timer covers; a session holding no stream open was not measured.
Loopback still cannot show NAT rebinding, which is one of the things keep-alive is actually for.

## What is not measured

* ~~The browser's advertised idle timeout is assumed, not measured.~~ **Measured 2026-09-16**: it is
  30 s exactly, and the browser does more than advertise it. §What a real Chromium does.
* **Every millisecond is container-measured.** Memory, datagram counts and survive/die are not
  timing and are safe; the CPU column is reported and decides nothing.
* **Loopback only.** A real link adds NAT rebinding, which is one of the things keep-alive is
  actually for and which loopback cannot show.
* **Nothing was measured past 2 000 sessions**, and nothing is claimed past it.
* **The idle sessions here hold a control stream and say nothing**, which is the product's shape.
  A session holding open media streams was not measured.
