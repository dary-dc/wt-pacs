# Proposal: two round trips off a cold open

**2026-09-19 · Status: proposed. Lever 1 prototyped behind a flag, off by default; lever 2 not
built. The count below is now measured (N1, §The count, measured); neither lever is.** Structural,
so this is a proposal first (`CLAUDE.md`). R1, from [S5](improvements/2026-09-18.md).

## What a cold open costs today

Read from this tree, `wtransport` 0.7.2 in `Cargo.lock`, and Chromium's behaviour. Each step is a
round trip the viewer waits through before a single byte of pixel data moves:

| | Who waits on what |
| --- | --- |
| **1** | QUIC handshake. TLS 1.3, one round trip. |
| **2** | The client sends its SETTINGS and CONNECT; the server's SETTINGS come back and `transport.ready` resolves. Chromium holds CONNECT until the server's SETTINGS arrive, and the crate sends the server's only after the handshake future has resolved — so this is a *whole* round trip, not the half it could be. |
| **3** | The client opens the control bidi and writes the ask (`session.ts:79`). The server has been parked in `accept_bi()` since it accepted (`transport/server.rs:200`), so nothing server-side could start earlier. |
| **4** | The frame comes back. |

**About four round trips to first byte.** At the target's 60 ms that is ~240 ms of dead time on
every cold open, and [S2](improvements/2026-09-18.md) makes reconnects routine rather than rare.

**The count is not stated anywhere, and that is the first thing to fix.** S5 says "the docs say
2 (1.5)". They do not: no file in `docs/` states a cold-open round-trip count at all — `WIRE.md`
describes the two streams and never the handshake that precedes them. There is no wrong number to
correct. There is a missing one, and this file is where it now lives.

## The count, measured

**2026-09-19, native client, through `lab/scripts/link_impair.py`** at round trips of 40, 80 and
160 ms, five cold opens each, the phase fitted against the round trip so that the relay's floor
and the crypto fall out as an intercept ([`rig-limits.md`](rig-limits.md) §3):

| Phase | Round trips | Fixed |
| --- | --- | --- |
| Session ready (`connect()` resolves) | **3.00** | 13.7 ms |
| The control stream, opened | +0.00 | — |
| First byte of the frame | **4.01** | 17.7 ms |

**Four to first byte is right. The attribution above is not.** Steps 1 and 2 together cost three
round trips, not two, and step 3 costs nothing: a client-initiated stream opens locally, so the
ask rides out with it and the frame comes back one round trip later. Where the third trip sits
inside the session is not separated here — the probe sees `connect()` resolve, not the frames
inside it, so the table's reasoning about who holds what is untested.

**This is the native client.** Chromium holding CONNECT until the server's SETTINGS arrive is the
browser's half of the same count, and it is [R2](cloud-queue.md)'s to measure.

## Lever 1 — the ask in the session URL

**Removes step 3.** The client puts what it wants in the URL it dials:

```
https://host:4433/s/<study>?ask=frame:42
https://host:4433/s/<study>?ask=fill:0-486
```

`wtransport::SessionRequest::path()` is **public and readable before `accept()`**
(`endpoint.rs:650`). So the server parses the ask, starts the read, and opens the media uni
*behind its own accept* — the first frame is already moving while the client is still opening its
control stream. **No crate patch is needed for this half.** That is why it is the half that is
prototyped.

The control stream stays exactly as it is. It is still opened, still owns every later ask, still
carries `EndSession`. The URL ask is an *opening* ask and nothing more; a session that sends none
behaves as today, which is what keeps the change additive.

**What the server must not do:** treat the URL as trusted input. It is a path from the network,
so the study name is resolved against the configured root the same way today's `--study` is, and
a malformed or out-of-range ask is refused with the existing `FrameError` on the control stream
once that stream arrives — not by dropping the session.

## Lever 2 — the server's SETTINGS at 0.5 RTT

**Halves step 2, and needs the crate.** `IncomingSessionFuture::accept` calls `Driver::init` only
after `quic_incoming.await?` has resolved (`endpoint.rs:620-622`), so the local SETTINGS stream is
opened after the handshake completes. The server has 1-RTT keys half a round trip earlier and
could have written SETTINGS then; Chromium is holding its CONNECT on exactly that.

The change is to start the driver from the `Connecting` state rather than the completed
connection. S5 calls it "~5 lines"; read against the crate it is small but not that small, because
`Driver::init` takes a `quinn::Connection` and the accept path would have to hold the connecting
future instead. It is a patch to `wtransport`, best upstream — this project should not carry a
fork for it, and lever 1 does not depend on it.

## Lever 3 — link and device in the same URL

[S22](improvements/2026-09-18.md) wants the client to declare rather than be probed. The same URL
carries optional fields:

```
?ask=fill:0-486&rtt=62&down=18000&cores=4&mem=4
```

Free, because the URL is already being parsed for lever 1, and each field is a hint the server may
ignore. Nothing should be *decided* by them until something measures whether they help; they are
proposed here only so the format has room and is not revised later.

## What `WIRE.md` gains

A section it does not have: **the session's opening**. Today it starts at "two WebTransport
streams per session" and says nothing about how the session was established or what may ride in
its URL. It gains the round-trip count above, the URL grammar, and the rule that a URL ask is an
opening ask which the control stream then supersedes.

## What the conformance suite gains

Two clauses, in the shape the existing three take:

* **An opening ask is honoured, and is optional.** A session dialled with `?ask=frame:N` receives
  frame N without the client writing to the control stream; a session dialled without one behaves
  exactly as today. Both implementations.
* **A malformed opening ask does not kill the session.** `?ask=frame:999999` on a 20-frame study
  refuses that frame and leaves the session able to serve a later, valid ask — the same clause the
  suite already makes for refusals, moved to the opening.

Neither needs the impaired link. They are correctness, and they can run in this container today.

## The prototype, and what it does not claim

Behind `--open-ask` on the server, off by default, with the client sending it only when told to.
It is there so row 36 has something to time, and so the two clauses above have something to test.
**It is not a measurement.** On loopback a round trip is ~0 and this change is invisible by
construction; the cell that decides it is row 36's shaped link, and until that runs the only
honest claim is the arithmetic at the top of this file.

## Order

1. This proposal. ✔
2. The prototype behind the flag, and the two conformance clauses. ← next
3. Row 36's container. ✔ — and with it the count above. The timing cell it was built for,
   navigation → ready → first byte with the flag on and off, is still owed.
4. Lever 2 upstream, if the cell says step 2 is worth halving.
