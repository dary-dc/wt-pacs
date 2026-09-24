# Proposal: two round trips off a cold open

**2026-09-19 · Status: proposed. Lever 1 is built behind a flag, off by default, on both sides,
and measured — −1.13 round trips off the first byte of a fill in a browser (§What lever 1 is
worth). Lever 2 is built, on by default, as a build-time patch of `wtransport`, and measured —
−1.0 round trips off the dial in a browser and natively (§What lever 2 is worth, 2026-09-23). The
count below is measured (N1, §The count, measured), and what a production certificate does to it
with it (H1, §What production adds to the count).**
Structural, so this is a proposal first (`CLAUDE.md`). R1, from [S5](improvements/2026-09-18.md).

## What a cold open costs today

Read from this tree, `wtransport` 0.7.2 in `Cargo.lock`, and Chromium's behaviour. Each step is a
round trip the viewer waits through before a single byte of pixel data moves:

| | Who waits on what |
| --- | --- |
| **1** | QUIC handshake. TLS 1.3, one round trip. |
| **2** | The client sends its SETTINGS and CONNECT; the server's SETTINGS come back and `transport.ready` resolves. Chromium holds CONNECT until the server's SETTINGS arrive, and the crate sends the server's only after the handshake future has resolved — so this is a *whole* round trip. Lever 2 removes it (§What lever 2 is worth). |
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

### What lever 1 is worth

**2026-09-20, in a browser, through the impaired link** — the ladder in
[`../lab/page-open/README.md`](../lab/page-open/README.md) §The first byte on a fill: a page that
opens a 12-frame fill with the flag on reaches its first frame in **13.44 round trips against
14.57**, seven rounds an arm at 40, 80 and 160 ms, interleaved, against an arm-to-arm spread of
±0.2 on the milestones the flag does not touch. **−1.13 round trips: 41 ms at 40, 90 ms at 80,
178 ms at 160.** The session itself resolves when it did (8.28 against 8.36), so the saving is
step 3 and nothing else — which is what this lever claimed and had not shown.

That is one round trip of the four a cold open spends. The other three are the dial, and lever 2
is the only thing here that touches them.

## Lever 2 — the server's SETTINGS at 0.5 RTT

**Removes step 2, and needs the crate.** `IncomingSessionFuture::accept` calls `Driver::init` only
after `quic_incoming.await?` has resolved (`endpoint.rs:620-622`), so the local SETTINGS stream is
opened after the handshake completes. The server has 1-RTT keys half a round trip earlier and
could have written SETTINGS then; Chromium is holding its CONNECT on exactly that.

*Corrected 2026-09-23:* this section said the lever **halves** step 2 and that the project should
not carry a fork for it. It removes the **whole** round trip — Chrome sends its CONNECT with its
handshake Finished once the SETTINGS are in hand, without waiting for `HANDSHAKE_DONE` (the net log
below) — and it is carried as a patch applied at build time, not as a fork.

**The change** — [`../patches/wtransport-0.7.2-settings-early.patch`](../patches/wtransport-0.7.2-settings-early.patch),
19 lines added and 5 removed in `endpoint.rs`. `IncomingSessionFuture::new` takes the server's `Connecting` to 0.5-RTT
with `quinn::Connecting::into_0rtt` (on a server it always succeeds) and starts the driver on it, so
the driver's first act — open the control stream, write SETTINGS — rides the handshake flight. It
then waits for the handshake before reading the client's SETTINGS and CONNECT, so a
`SessionRequest` still exists only after a completed handshake: the API's contract is unchanged,
and a replayed 0-RTT CONNECT could not be surfaced even on a server that enabled early data. This
one does not (`wtransport`'s TLS config leaves `max_early_data_size` at 0). The only bytes that move
earlier are the SETTINGS, which RFC 9114 §6.2.1 lets a server send as soon as it can. **On by
default, behind no flag**: nothing unsafe was found for a flag to guard, and the one cost found — a
round trip in one phase of a blink (§What lever 2 costs) — is removed since row 61 by a second patch
that turns the phase into a win (§The losing phase, removed).

**How it is carried** — the mechanism the transport branch used for its quinn patch.
[`../scripts/patch_crate.sh`](../scripts/patch_crate.sh) takes the crate's crates.io tarball
(checksum-verified, from cargo's cache or downloaded), applies the patch with `--fuzz=0` so a stale
hunk fails the build, and writes the crate into `OUT_DIR`; `patched/wtransport/` is a
`[patch.crates-io]` shim — the crate's manifest, a `build.rs` that runs the script, and a `lib.rs`
that is one `include!`. A `mod` inside an included file resolves beside that file, so nothing is
copied into the source tree. Dropping the patch is deleting its line under `[patch.crates-io]`.
Since row 61 the same script and shim carry a second patch, to quinn-proto (§The losing phase,
removed).

`server/src/transport/server.rs` `settings_ride_the_handshake_flight` holds it: a client that loses
everything it sends after its first flight — so the server's handshake never completes — must
still receive the server's control stream, opening with SETTINGS. With the `[patch.crates-io]` line
commented out it fails after its 3 s timeout (mutant, caught).

### What lever 2 is worth

**2026-09-23, in a browser** — [`../lab/page-open/run.mjs`](../lab/page-open/run.mjs) with
`SERVERS=unpatched=…,patched=…`: the same tree built with and without the patch, each behind its own
`link_impair.py` relay, the two interleaved inside every round, all three page arms, cold and warm
profile, 8 rounds at 0, 40 and 80 ms. The dial is each visit's `session − config`; the slope is
fitted over the three delays:

| arm | profile | dial, unpatched | dial, patched | rounds won at 40 / 80 ms |
| --- | --- | ---: | ---: | --- |
| ts | cold | 3.15 rt | **2.14 rt** | 8/8 · 8/8 |
| ts | warm | 3.19 rt | **2.16 rt** | 8/8 · 8/8 |
| wasm | cold | 3.41 rt | **2.49 rt** | 8/8 · 8/8 |
| wasm | warm | 3.55 rt | **2.42 rt** | 8/8 · 8/8 |
| downloader | cold | 3.40 rt | **2.41 rt** | 8/8 · 8/8 |
| downloader | warm | 3.51 rt | **2.18 rt** | 8/8 · 8/8 |

At 80 ms the ts arm's dial is 258 [253–260] ms against 177 [175–179]. At 0 ms the arms tie (4/8,
6/8, 3/8 …), as a round-trip lever must on loopback. `config`, which the patch cannot touch, ties
too (1/8 – 4/8 cold), which is how the table's noise is read.

**Why, in Chrome's net log** — `NETLOG=DIR` on the same runner and
[`../lab/scripts/netlog_dial.py`](../lab/scripts/netlog_dial.py), 3 rounds × 3 arms × 2 sessions
at 80 ms: in **18 of 18** patched sessions the server's SETTINGS arrive with its first flight
(83–88 ms), the CONNECT leaves 0–2 ms after the client's Finished and before `HANDSHAKE_DONE`, and
the session is ready at 165–172 ms. In 18 of 18 unpatched ones the SETTINGS arrive with
`HANDSHAKE_DONE` a round trip later (164–171 ms) and the session is ready at 247–254 ms.

**Natively** — `cold_open` through the relay, both servers interleaved, 6 rounds at 0 / 40 / 80 ms:
session ready 3.10 → **2.10** round trips, first byte 4.13 → **3.14**, 6/6 at 40 and at 80. The
crate's own client holds its CONNECT for the server's SETTINGS as Chrome does.

So the count at the top of this file is now **three round trips to first byte**, and two of them
are the dial: the handshake, and the CONNECT.

**End to end, from a TLS page host** (row 72, [`../lab/page-open/README.md`](../lab/page-open/README.md)
§The first frame on a real host): nginx over HTTP/1.1 and HTTP/2 at 40 and 80 ms, 7 rounds. The
lever takes its round trip off the page's first frame in every cell, and the dial is 1.85 of that
page's 12.65 round trips.

### What lever 2 costs

**Bytes in the first flight: none.** `first_flight.py` in front of the relay, three cold opens a
server: 1 406–1 409 B in 4 datagrams with the patch, 1 407–1 409 B without — the SETTINGS take the
padding of the server's 1 200-B Initial datagram. Chrome's net log reads 1 200 + 46 B either way.
The amplification budget (3 600 B against a quinn Initial, §What production adds) is untouched.

**Under 1 % loss, no regression but in the tail the blink prices.** Native, 80 ms, n = 10, both relays on one seed per round: session
2.04–2.13 round trips patched against 3.07–3.14, 10/10; the frame's tail unchanged. In Chrome
(`dial-blink.mjs` with `OFFSETS=none LOSS=1`, n = 40): ready 169 [165–1 414] ms against 251
[248–1 334], 34/40, mean 232 against 282. Each arm drew one lost handshake flight and paid the ~1.1 s
probe timeout for it; the patched arm's cost a round trip more, the phase the next paragraph prices.

**Under a blink, one phase loses a round trip.** `link_impair.py`'s 150 ms `blackout`, dropped,
sent at an offset into a cold dial at 80 ms — [`../lab/page-open/dial-blink.mjs`](../lab/page-open/dial-blink.mjs),
n = 5 an offset, the servers interleaved. Chrome's ready time, median ms:

| blink at | 0 | 20 | 40 | 60 | 80 | 100 | 120 | 140 | 160 | 180 | 200 | none |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| unpatched | 554 | 1334 | 1333 | 417 | 415 | 567 | 539 | 420 | 422 | 502 | 501 | 251 |
| patched | 472 | **1414** | **1417** | 416 | 416 | 434 | 431 | 170 | 169 | 167 | 170 | 169 |

Every column is 5/5 one way or the other except 60 and 80, which tie (2/5, 0/5 within 1–6 ms);
each range is at most 35 ms wide. An earlier run with a scratch copy of
the same script read the same to within 20 ms at every offset. **When the blink eats the
server's first flight (20–40 ms), the patched server is +80 ms, one round trip, behind**: both arms
wait out the same ~1 s probe timeout, then the unpatched server writes its SETTINGS fresh after the
handshake while the patched one's went out in the lost flight and are recovered by quinn's loss
detection only after the handshake completes (inferred from the timing; traced 2026-09-24 and
confirmed, with a round trip more for both servers than this said — §The losing phase, removed). Everywhere else the patch wins by 80–340 ms. The
crate's native client adds a second losing phase that Chrome does not have: a blink over the
client's Finished and CONNECT (60–75 ms) costs it +220 ms, which is what RFC 9002 §6.2.1 predicts — no probe for
application data before the handshake is confirmed — though not traced (`cold_open`, one blink per
offset, 10 offsets);
Chrome recovers its early CONNECT at no cost.

**What would remove the losing phase** is quinn retransmitting 0.5-RTT data with its handshake
probe. *Corrected 2026-09-24 (row 61):* this said it was a transport change the project does not
make, and priced the round trip instead. It is made, as a second build-time patch, and the phase
now wins by a round trip — §The losing phase, removed.

**What this rig does not decide.** Loopback, the userspace relay, one box carrying other lanes
throughout; nothing here is a phone or a real path (`rig-limits.md` §3). The dial's fixed costs
(6–36 ms) are this box's; only the slope is claimed.

### The losing phase, removed

*Row 61 (FF1), 2026-09-24.* `link_impair.py`'s `swallow` drops exactly the server's first flight
— every server datagram in the 50 ms after its first — so the phase is taken alone, not found by
sweeping a blink's offset. [`../lab/scripts/swallow_cells.sh`](../lab/scripts/swallow_cells.sh)
dials natively and `dial-blink.mjs`'s `swallow` offset in Chrome.

**What quinn does, traced** (`quinn_proto=trace`, 80 ms). The client repeats its Initial — quinn's
client once at +1.0 s; **Chrome four times, at +300, +546, +772 and +983 ms** — and quinn answers
none of them. Its own probe timeout fires at +1.001 s (three times its 333 ms initial RTT) and
carries **only the ServerHello**: a probe repeats its own packet-number space. The Handshake flight
goes when that probe's ACK comes back, a round trip later. The SETTINGS lost with the first flight
are declared lost only when the client ACKs a 1-RTT packet sent after the handshake —
HANDSHAKE_DONE — a round trip after that; an unpatched server writes them fresh at the handshake's
end, which is lever 2's round trip.

**The change** — [`../patches/quinn-proto-0.11.18-probe-every-space.patch`](../patches/quinn-proto-0.11.18-probe-every-space.patch),
8 lines: when a server's probe timer fires during the handshake, every other space with data in
flight gets a probe too. The ServerHello's probe then carries the Handshake flight, and the 1-RTT
space sends a probe of its own — a PING, because quinn's probes repeat control frames and not
stream data — whose ACK declares the SETTINGS lost a round trip before HANDSHAKE_DONE's would.
RFC 9002 §6.2.4 requires a probe in the expired space and bars none in the others; §6.2.3 lets an
endpoint resend unacknowledged CRYPTO data early. On by default, like lever 2.

Swallowed first flight, session ready in ms, median [range], rounds won against unpatched; seven
rounds, arms rotated inside each:

| client | round trip | unpatched | lever 2 | **lever 2 + this** |
| --- | --- | ---: | ---: | ---: |
| native | 40 ms | 1 167.5 [1 166.0–1 170.7] | 1 209.6 [1 206.9–1 212.8], 0/7 | **1 126.8** [1 126.0–1 128.4], 7/7 |
| native | 80 ms | 1 328.5 [1 327.0–1 330.4] | 1 411.7 [1 408.9–1 413.7], 0/7 | **1 247.3** [1 246.5–1 248.7], 7/7 |
| Chrome | 40 ms | 1 171 [1 170–1 172] | 1 213 [1 211–1 220], 0/7 | **1 130** [1 127–1 130], 7/7 |
| Chrome | 80 ms | 1 332 [1 330–1 334] | 1 414 [1 412–1 420], 0/7 | **1 249** [1 248–1 251], 7/7 |

**It costs nothing measured elsewhere.** A clean dial ties with lever 2 alone (native 85.3 against
84.7 ms at 40 and 165.8 against 165.8 at 80; Chrome 86–87 and 167–168). Across the blink offsets
above (Chrome, 80 ms, n = 5 an offset) the 20 and 40 ms columns go 1 415 → **1 250**, 5/5 each,
and every other column is within 2 ms, 1–4 of 5 either way. At 1 % loss (n = 40) the median ties at
168 ms, 20 of 40, and the worst dial — the one that drew a lost first flight — is 1 416 → 1 250.
The binary built through the shim reads as the prototype did, to 1.5 ms.

`server.rs` `a_lost_first_flight_is_repeated_whole` holds it: through a relay with 50 ms each way
that drops the server's first flight, the control stream reaches the client within 1.5 round
trips of its handshake (104 ms with the patch, 208–211 without). Two mutants caught: the
`[patch.crates-io]` line commented out, and the 1-RTT space left out of the probe. *Corrected
2026-09-24 (row 66's gate):* as first written the test raced — the test's quinn client repeats its
Initial at ~1 s too, and under the full suite's load it once landed ~3 ms **before** the server's
probe fired; in that ordering the SETTINGS came two round trips after the handshake again (221 ms),
1 run in 4. The test's client now waits 3 s before repeating, which pins the claim (0 of 12 loaded
runs failed; both mutants still caught). **The ordering itself is not traced**: a client whose repeat
reaches the server just before its probe may not get the round trip back. Chrome repeats at +300 ms,
well before, and read clean above.

**Tried, not built.**

* **Probing only the 1-RTT space** recovers lever 2's round trip and no more: it ties unpatched
  (1 168.2 and 1 328.0 native, 1 170 and 1 332 Chrome), because the Handshake flight still waits.
* **Re-queueing the 0.5-RTT stream data with the probe**, so the SETTINGS ride it as data rather
  than wait on the PING's ACK. They did — the client sent its CONNECT with its Finished — but the
  session then stalled until the idle timeout, in the one swallowed dial traced: the wtransport
  driver never saw the client's streams, and quinn logged nothing further. Cause not found.
* **A shorter initial probe timeout** (`--initial-rtt-ms 100`, W2's flag) is the larger lever in
  this phase and a different one: Chrome at 40 ms, every server **−700 ms** (unpatched 1 169 →
  470), but lever 2 stays a round trip behind with it (513 against 470; 714 against 631 at 80), so
  it does not recover the phase. With this patch as well, **430 and 550 ms**. Clean dials tie. Its
  default is still the shaped-link VM's to set ([`handoff-2026-09-19.md`](handoff-2026-09-19.md) §3).
* **A duplicated first flight** inside the amplification limit: a blink that eats one copy eats a
  copy sent with it, and a copy sent later is a shorter probe timeout, the item above.

**Not tried: answering the client's repeated Initial**, which RFC 9002 §6.2.3 allows and quinn
does not do. Chrome repeated its Initial four times before quinn's probe fired, the first at
+300 ms, so it would reach what `--initial-rtt-ms 100` reaches without guessing a round trip.

### Other clients

*WP1, 2026-09-24.* Lever 2 was proved with Chrome and the native client. Here it is against every
other client this container could run ([`../lab/other-clients/`](../lab/other-clients/README.md)).
Each ran against this tree with both patches (settings-early wtransport and the probe-every-space
quinn-proto) and against the same tree with `[patch.crates-io]` removed. Each went through the
relay at 40 ms, both directly and through
[`../lab/scripts/half_rtt_deaf.py`](../lab/scripts/half_rtt_deaf.py). That relay strips the
server's 1-RTT packets until the client sends one of its own, which makes any client one that
ignores 0.5-RTT data. 5 rounds, every cell rotated inside each round, medians in round trips:

| client | milestone | lever 2 on | on, 0.5-RTT ignored | off | off, 0.5-RTT ignored |
| --- | --- | --: | --: | --: | --: |
| native (wtransport 0.7.2) | session ready | **2.12** | 4.22 | 3.18 | 3.20 |
| webtransport-go v0.9.0 | session ready | **2.17** | 4.29 | 3.21 | 3.23 |
| aioquic 1.3.0 | session ready | **2.45** | 4.54 | 3.48 | 3.47 |
| quic-go v0.53.0 HTTP/3 | SETTINGS received | **1.13** | 3.25 | 2.20 | 2.22 |
| h3 0.0.8 on crates.io quinn | handshake | 1.07 | 1.08 | 1.08 | 1.09 |

Every client connects to both builds; the three WebTransport clients each get frame 0 too. Every
client takes the lever: session ready or SETTINGS a round trip sooner. None of them ignores
0.5-RTT data on its own. The relay stripped the SETTINGS packet in every lever-on dial, and one
other packet in every dial on either build.

**A client that ignores 0.5-RTT data still works, and pays a round trip for the lever.** Its
session is ready at ~4.2–4.5 round trips, against ~3.2 with the lever off. The SETTINGS the client
dropped are resent only once the server declares them lost. That needs the client's ACK of a later
1-RTT packet, which the client may delay up to 25 ms. This mechanism is inferred from the
timings, not traced. It is the cost of the worst case the relay builds, and no client here is that
case.

**Two findings that are not the lever.** First, the server's HTTP/3 surface answers a request that
is not a CONNECT by ending the stream with no response, on both builds. quic-go reports `parsing
frame failed: EOF`, and h3 closes the connection with `H3_FRAME_UNEXPECTED`. A plain HTTP/3 probe of
the server therefore sees a protocol error, where a 404 would be the polite answer. That is
wtransport's behaviour, not this tree's. Second, webtransport-go from v0.13.0 (draft 15) refuses
the server on both builds: *server didn't enable QUIC stream reset partial delivery*
(reset-stream-at). Hence the pin to v0.9.0.

**Not run.** Firefox: the container's network policy refuses Mozilla's archive and CDN, and
GitHub release downloads. `curl --http3`: the distro's curl 8.5.0 is built without HTTP/3, and
static HTTP/3 builds are on GitHub releases, refused likewise. One quic-go GET out of five came
back with an empty error string; 12 reruns of that cell did not repeat it.

### Upstream

No `wtransport` issue or pull request asks for this (GitHub search of the repository for `0-RTT`,
`rtt`, `settings` and `handshake`, 2026-09-23), and `master` still awaits the handshake before
`Driver::init`. The closest is [#324](https://github.com/BiagioFesta/wtransport/pull/324), which
races `open_and_send_settings` against the driver being dropped — the same function this patch
starts earlier, so a rebase onto a release carrying it needs a look. The patch is small, keeps the
public API and the `SessionRequest`-after-handshake contract, and is RFC-sanctioned, which is what an
upstream reviewer would ask; what they would also ask is the blink row above. None has been opened.

## Lever 3 — link and device in the same URL

[S22](improvements/2026-09-18.md) wants the client to declare rather than be probed. The same URL
carries optional fields:

```
?ask=fill:0-486&rtt=62&down=18000&cores=4&mem=4
```

Free, because the URL is already being parsed for lever 1, and each field is a hint the server may
ignore. Nothing should be *decided* by them until something measures whether they help; they are
proposed here only so the format has room and is not revised later.

## The probe after the open

*PT1, 2026-09-24.* The workstation's decrypted capture showed Chrome's client re-sending one small
packet as a `PTO_RETRANSMISSION` shortly after every session opened. It is spurious, the cause is
in quinn rather than here, and it costs one packet.

**Which packet.** The ask. From Chrome's net log
([`../lab/scripts/netlog_pto.py`](../lab/scripts/netlog_pto.py), `lab/page-open/run.mjs` with
`NETLOG=`, the downloader arm): the client opens the control stream (stream 4) in one packet, with
its 3-byte stream header, and puts the ask in the next, 2 ms later. The server answers the open
with the first frame, fast enough that its first data packet acknowledges the stream header but
not the ask. The rest of the initial window leaves without an ACK. Then the window is full and
the ACK of the ask waits for the client's ACKs of that burst, which take a round trip. At 80 ms
that is ~163 ms, and Chrome's probe timer (srtt + 4·rttvar + 25 ms) fires at ~146 ms. The server
then acknowledges the original, so nothing is declared lost. Here it is 65 bytes and ~160 ms after
`ready`. The workstation measured 72 bytes at ~400 ms from a different origin; the frames match.

**Why the ACK waits: quinn.** quinn-proto 0.11.18 `poll_transmit` skips the whole Data space when
the congestion window is full and stream data is queued. An owed ACK is skipped with it, even
once `MaxAckDelay` has marked it immediate. RFC 9000 §13.2.1 asks for 1-RTT packets to be
acknowledged within `max_ack_delay` (25 ms), and an ACK-only packet is outside the congestion
window. So this is a quinn defect, not the server's code, and not small to patch: a packet that
carries only the ACK needs a path through the packet builder that does not exist.

**Proved by moving the window.** The same server with `--initial-window-bytes 1000000`, so the
window cannot fill before the ask arrives, 4 rounds, both servers in each round, two sessions a
visit:

| RTT | default window | 1 MB window |
| --: | --: | --: |
| 40 ms | 0 / 8 sessions | 0 / 8 |
| 80 ms | **7 / 8** | 0 / 8 |

At 0 ms it is 0/6 here; the workstation saw 4/6. It needs the window to reopen later than the
probe fires: two round trips against one plus 4·rttvar + 25 ms, so a path above ~65 ms (derived).

**What it costs.** A 65-byte packet. Chrome's probe timeout does not shrink its congestion window,
and the original is acknowledged, so there is no congestion reaction. The first frame is not
delayed either, because the server was window-blocked with or without the probe. Derived and not
measured: an ask sent while a fill holds the window full waits for its ACK the same way. On a
long path it can draw the same spurious probe, still one small packet per ask. Nothing is
changed here. The quinn defect is worth an upstream issue: ACKs withheld while congestion-blocked.

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
**On loopback a round trip is ~0 and the change is invisible by construction**, which is why it was
timed through an impaired link — §What lever 1 is worth. What the flag is still short of being a
default: the URL carries one contiguous run, so a client whose first fill is not contiguous asks
for the rest on the control stream as today; and nothing has run it against a host that is not this
box's relay.

## Order

1. This proposal. ✔
2. The prototype behind the flag, and the two conformance clauses. ✔ — server-side, plus the
   client half (`openAsk`) and its clauses in `client/conformance/dispatch-rig.ts`.
3. Row 36's container. ✔ — and with it the count above. The timing cell it was built for,
   navigation → first byte with the flag on and off, is run: §What lever 1 is worth. ✔
4. Lever 2, if the cell says step 2 is worth removing. **The cell says a round trip is worth
   having** — step 3's was 41–178 ms of the open across 40–160 ms of link. ✔ — built as a build-time
   patch and measured, §Lever 2; upstream not opened.
