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

So the server is the only end that can hold a browser's session open. **Measured, not assumed**: a
server with a 5 s idle timeout and no keep-alive lost 3 of 3 sessions over a 12 s idle hold; the
same server with `--keep-alive-interval-ms 2000` kept 3 of 3, with the client sending nothing.

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

* **20 s keep-alive.** Comfortably below the 60 s timeout, and below the 30 s that browsers
  typically advertise — which matters, because the effective idle timeout is the *lower* of the two
  ends and the browser's end is not ours to set.
* **60 s idle timeout.** Long enough that a brief loss of connectivity does not cost the session,
  short enough that a genuinely dead peer's 75 KB comes back inside a minute. The current default is
  the library's 30 s, which is below the browser's own and leaves no margin.

The pair is deliberately conservative on packets and deliberately generous on state, because state
is cheap here — 75 KB — and a dropped session costs a user-visible reconnect at the moment they
open the viewer.

## What is not measured

* **The browser's advertised idle timeout is assumed, not measured.** 30 s is the common figure and
  the reason 20 s was chosen, but nothing here ran a browser. It wants one run on the rig with a
  real Chrome to confirm the effective timeout is the one this ADR assumes.
* **Every millisecond is container-measured.** Memory, datagram counts and survive/die are not
  timing and are safe; the CPU column is reported and decides nothing.
* **Loopback only.** A real link adds NAT rebinding, which is one of the things keep-alive is
  actually for and which loopback cannot show.
* **Nothing was measured past 2 000 sessions**, and nothing is claimed past it.
* **The idle sessions here hold a control stream and say nothing**, which is the product's shape.
  A session holding open media streams was not measured.
