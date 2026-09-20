# Proposal: two round trips off a cold open

**2026-09-19 · Status: proposed. Lever 1 prototyped behind a flag, off by default; lever 2 not
built. The count below is now measured (N1, §The count, measured), and what a production
certificate does to it with it (H1, §What production adds to the count); neither lever is.**
Structural, so this is a proposal first (`CLAUDE.md`). R1, from [S5](improvements/2026-09-18.md).

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
browser's half of the same count. R2 measured it: in a browser the dial is **3.0 round trips**
too, and everything a page spends before it is
[`../lab/page-open/README.md`](../lab/page-open/README.md) — 3.6 of them, once its hints are
right. That leaves the dial the largest single item in a cold open, which is what the levers
below are for.

## What production adds to the count, and what removes it

**2026-09-19, H1.** Every count above was taken with this tree's dial: one self-signed 450 B P-256
leaf, pinned by hash, so the server answers in ~1.3 KB. Production replaces it with a WebPKI chain,
and the chain is what decides whether the count stays at four. Re-measured first, same rig, same
method: **4.03 round trips + 41.4 ms** to first byte, against the 4.01 + 17.7 ms above. The slope
reproduces to two decimals; the intercept is higher because the box carried another lane
throughout, which the relay's own floor shows (0.90 ms of round trip today against 0.40). **Nothing
below is claimed from the intercept.**

**The budget.** Before it has validated the client's address a QUIC server may send no more than
three times what it has received — `total_recvd * 3 < total_sent + bytes_to_send`
(`quinn-proto-0.11.18/src/connection/paths.rs`). A quinn client Initial is padded to 1 200 B, so
the first flight is capped at **3 600 B** and whatever will not fit waits for the client's next
packet, one round trip later. Chromium's Initial is reported at 1 250 B (S37, not measured here),
which would buy it 150 B more.

**Three chains from a throwaway private CA** (`../lab/scripts/cert_chain_cells.sh`), each leaf
padded with what a public CA issues — several SANs, AIA, a CRL distribution point, policies with a
CPS URI, and an SCT-sized blob — and the probe skipping validation as `cold_open` always has, so
only the bytes on the wire matter. Flights read by `../lab/scripts/first_flight.py`:

| Arm | Leaf | Intermediate | Server's first flight | Then |
| --- | --- | --- | --- | --- |
| today's dial | 450 B | — | 1 338 B / 2 datagrams | — |
| ECDSA P-256 | 1 237 B | 855 B | 2 810 B / 4 | — |
| RSA-2048 | 1 633 B | 1 253 B | **3 600 B / 3** | **240 B, a round trip later** |
| ECDSA, compressed | " | " | 1 840 B / 3 | — |
| RSA-2048, compressed | " | " | 2 870 B / 4 | — |

3 600 B to the byte — three datagrams of 1 200 B: quinn fills to the cap, stops mid-flight, and
resumes once the client's 1 200 B acknowledgement has bought it credit. The tap was mutated to
group every datagram on its own, and the same connection then read `1200 1200 1200`, which is where
the 3 600 comes from.

**The slope, refitted** — the five arms interleaved within every round, n = 7 per delay, at round
trips of 40, 80 and 160 ms, the medians fitted against the round trip:

| Arm | First byte | Session ready | Rounds behind the dev arm, 40 / 80 / 160 ms |
| --- | --- | --- | --- |
| today's dial | 4.03 rt + 41.4 ms | 3.03 rt | — |
| ECDSA chain | 4.04 rt + 39.7 ms | 3.05 rt | 3/7 · 4/7 · 2/7 |
| RSA-2048 chain | **5.05 rt** + 45.1 ms | **4.03 rt** | 7/7 · 7/7 · 7/7 |
| ECDSA + compression | 4.02 rt + 42.9 ms | 3.03 rt | 4/7 · 4/7 · 4/7 |
| RSA + compression | 4.08 rt + 38.7 ms | 3.07 rt | 3/7 · 4/7 · 4/7 |

**An RSA chain costs a whole round trip; an ECDSA chain costs nothing.** The extra trip is inside
the handshake — session-ready moves 3.03 → 4.03 — which is exactly where the budget bites, and it
is every cold open and every reconnect: **+60–80 ms at the target's round trip.** The ECDSA arm
ties, 2–4 rounds of 7 behind at each delay.

**Certificate compression buys the round trip back.** `exact-server`'s `cert-compression` feature
(and `window-harness`'s, so the probe offers the decompressor) is the whole change — no code.
Confirmed from the handshake rather than inferred: with `RUST_LOG=rustls=trace` the server logs the
ClientHello offering `certificate_compression_algorithms: [Brotli, Zlib]` and its own
`CompressedCertificate { alg: Brotli, uncompressed_len: 2909 }` at 1 968 B — **−32.3 % on the
Certificate message**, and 3 840 → 2 870 B on the wire, back inside the budget.

**A browser does offer it over QUIC.** Google Chrome 148.0.7778.96, headless and with no driver,
dialling this server with the dev certificate pinned by hash, sent
`certificate_compression_algorithms: [Brotli]` — brotli alone, where the native probe offers
`[Brotli, Zlib]` — and the server with the feature on answered it with a `CompressedCertificate {
alg: Brotli }`. So `zlib` buys nothing against a browser, and `brotli` is the whole of the feature.

**The feature still stays off by default**, because it costs five crates in `Cargo.lock` (`brotli`,
`brotli-decompressor`, `alloc-stdlib`, `alloc-no-stdlib`, `zlib-rs`) and **+1.29 MiB on the release
binary** (5 307 808 → 6 656 680 B), and **ECDSA is the cheaper answer**: an ECDSA leaf and
intermediate fit the budget uncompressed, on any peer, with no dependency added. Compression is
what makes an RSA chain viable where one is forced.

**A leaf-only PEM (S39).** `Identity::load_pemfiles` ships whatever the file holds, so a PEM with
no intermediate leaves the browser to fetch it over AIA — DNS, TCP, TLS, GET — on every cold open
until it is cached. `../deploy/check_equivalence.sh` now warns on a PEM holding one certificate
that something else issued, and `--cert PEM` runs that check alone. **The cost of the AIA fetch
itself is not measured here.**

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
once that stream arrives — not by dropping the session. *Corrected 2026-09-20 (R1): until then the
prototype had no control stream to refuse on at all* — `serve_opening_ask` built its pipeline
without one, so **every** refusal in such a session was dropped, not only an opening one. The
pipeline now takes the send half over a `oneshot` the accept task fills, and `refuse` waits for it.
`server/src/transport/server.rs`'s `an_opening_ask_is_served_behind_the_accept` asserts it.

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

Behind `--open-ask` on the server, off by default, with the client sending it only when told to:
`DownloaderClient.connect(url, certHash, { fill, openAsk: true })` puts the run it would have asked
for on the control stream into the URL instead, and does not ask for it again.
**On loopback a round trip is ~0 and the change is invisible by construction**, which is why it is
timed through an impaired link in [`../lab/page-open/README.md`](../lab/page-open/README.md)
§The first byte on a fill rather than here.

## Order

1. This proposal. ✔
2. The prototype behind the flag, and the two conformance clauses. ✔ — server-side, plus the
   client half (`openAsk`) and its clauses in `client/conformance/dispatch-rig.ts`.
3. Row 36's container. ✔ — and with it the count above. The timing cell it was built for,
   navigation → ready → first byte with the flag on and off, is still owed.
4. Lever 2 upstream, if the cell says step 2 is worth halving.

The timing cell step 3 owes is `lab/page-open/README.md` §The first byte on a fill.
