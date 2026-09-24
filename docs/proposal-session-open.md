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
default, behind no flag**: nothing unsafe was found for a flag to guard, and the one cost found is a
round trip in one phase of a blink (§What lever 2 costs).

**How it is carried** — the mechanism the transport branch used for its quinn patch.
[`../scripts/patch_wtransport.sh`](../scripts/patch_wtransport.sh) takes the crates.io 0.7.2 tarball
(checksum-verified, from cargo's cache or downloaded), applies the patch with `--fuzz=0` so a stale
hunk fails the build, and writes the crate into `OUT_DIR`; `patched/wtransport/` is a
`[patch.crates-io]` shim — the crate's manifest, a `build.rs` that runs the script, and a `lib.rs`
that is one `include!`. A `mod` inside an included file resolves beside that file, so nothing is
copied into the source tree. Dropping the patch is deleting the two `[patch.crates-io]` lines.

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
detection only after the handshake completes (inferred from the timing, not traced). Everywhere else the patch wins by 80–340 ms. The
crate's native client adds a second losing phase that Chrome does not have: a blink over the
client's Finished and CONNECT (60–75 ms) costs it +220 ms, which is what RFC 9002 §6.2.1 predicts — no probe for
application data before the handshake is confirmed — though not traced (`cold_open`, one blink per
offset, 10 offsets);
Chrome recovers its early CONNECT at no cost.

**What would remove the losing phase** is quinn retransmitting 0.5-RTT data with its handshake
probe, a transport change this project does not make. It is priced here instead: one round trip,
in one 20–40 ms window of a dial that has already lost a second to the blink.

**What this rig does not decide.** Loopback, the userspace relay, one box carrying other lanes
throughout; nothing here is a phone or a real path (`rig-limits.md` §3). The dial's fixed costs
(6–36 ms) are this box's; only the slope is claimed.

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
