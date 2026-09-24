# Upstream draft: the server's SETTINGS at 0.5-RTT in wtransport

**A draft, not posted.** The owner posts it, or does not. Below are an issue and a pull-request
description for [BiagioFesta/wtransport](https://github.com/BiagioFesta/wtransport), written from
[`../proposal-session-open.md`](../proposal-session-open.md) §Lever 2, whose numbers they quote.
Before posting: check for an open issue or PR again (none on 2026-09-23, §Upstream there), and
rebase the patch onto the release current then. [#324](https://github.com/BiagioFesta/wtransport/pull/324)
touches `open_and_send_settings`, which this patch starts earlier.

---

## Issue

**Title:** Server sends its HTTP/3 SETTINGS a round trip late, which delays every WebTransport session by one RTT

**What happens.** `IncomingSessionFuture` awaits the QUIC handshake (`quic_incoming.await`) before
it calls `Driver::init`. So the server opens its control stream, and writes SETTINGS, only after
the handshake completes. That is half a round trip after the server could first send 1-RTT data.
In practice the SETTINGS reach the client with `HANDSHAKE_DONE`, a full round trip after the
server's first flight.

**Why it costs a round trip.** A WebTransport client must not send its extended CONNECT until it
has seen the server's SETTINGS (they carry `ENABLE_CONNECT_PROTOCOL` and the WebTransport
settings). Chrome and wtransport's own client both wait for them. With SETTINGS in the server's
first flight, Chrome sends its CONNECT together with its handshake Finished. Without, it waits a
round trip for them.

**What the RFCs allow.** RFC 9114 §6.2.1 has each endpoint open its control stream at the start of
the connection and send SETTINGS first on it. A QUIC server may send 1-RTT data before the
handshake completes, which is 0.5-RTT data. Nothing in the server's SETTINGS depends on the client.

**Measured** (loopback through a delay relay; Chrome 141 headless and wtransport's client;
round trips from the first packet to a ready session):

| client | today | SETTINGS in the first flight |
| --- | --: | --: |
| Chrome, page arms, 8 rounds at 40 and 80 ms | 3.15–3.55 | **2.14–2.49**, 8/8 rounds won |
| wtransport client, 6 rounds | 3.10 | **2.10**, 6/6 |
| webtransport-go v0.9.0, 5 rounds at 40 ms | 3.21 | **2.17** |
| aioquic 1.3.0, 5 rounds at 40 ms | 3.48 | **2.45** |

At 80 ms that is Chrome's dial taking 177 ms instead of 258. Chrome's net log shows it in 18 of 18
sessions: the SETTINGS arrive with the first flight, and the CONNECT leaves 0–2 ms after the
client's Finished, before `HANDSHAKE_DONE`. End to end, a page served over TLS by nginx has
its session 77–86 ms sooner at 80 ms RTT (7/7 rounds in every cell: HTTP/1.1 and HTTP/2, cold and
warm cache). Its first image is 63–83 ms sooner (6/7 or 7/7).

**What it costs.** No bytes: the SETTINGS fit the padding of the server's 1200-byte Initial
datagram. The server's first flight stays within the amplification limit. Under 1 % loss the
median dial still wins; the loss tail is the next point.

**One case it loses, and its cure, which is a quinn change.** When the server's whole first flight
is lost, quinn's handshake probe resends only the lost packet's own space. The SETTINGS in the
1-RTT space are then declared lost only after the handshake. That puts the patched server a round
trip *behind* today's, measured at +40 ms at 40 ms RTT and +80 at 80. A client that drops 0.5-RTT
packets pays that same round trip (4.2–4.5 round trips against 3.2), and none of the five clients
measured does. A companion quinn-proto change removes the loss case: when a server's probe fires
during the handshake, probe every space with data in flight. The phase then wins by a round trip:
Chrome 1 249 ms against 1 332 at 80 ms, 7/7. That belongs in a quinn issue of its own (below),
and wtransport's change stands without it.

---

## Pull request

**Title:** Send the server's SETTINGS at 0.5-RTT

**What.** `IncomingSessionFuture::new` converts the server's `Connecting` with `into_0rtt()`,
which always succeeds on a server, and starts the driver on it. The driver's first act — open the
control stream, write SETTINGS — therefore rides the handshake flight. It then awaits the handshake
before `accept` reads the client's SETTINGS and CONNECT. `with_quic_connecting` is unchanged.

```diff
--- a/src/endpoint.rs
+++ b/src/endpoint.rs
@@ -607,20 +607,34 @@
     pub fn with_quic_connecting(quic_connecting: quinn::Connecting) -> Self {
         Self(Box::pin(async move {
             let quic_connection = quic_connecting.await?;
-            Self::accept(quic_connection).await
+            let driver = Driver::init(quic_connection.clone());
+            Self::accept(quic_connection, driver).await
         }))
     }
 
     fn new(quic_incoming: quinn::Incoming) -> Self {
         Self(Box::pin(async move {
-            let quic_connection = quic_incoming.await?;
-            Self::accept(quic_connection).await
+            // 0.5-RTT: the driver opens the control stream and writes SETTINGS with the
+            // handshake flight (RFC 9114 §6.2.1), rather than a round trip later.
+            let (quic_connection, handshake) = quic_incoming
+                .accept()?
+                .into_0rtt()
+                .unwrap_or_else(|_| unreachable!("a server connection always converts"));
+            let driver = Driver::init(quic_connection.clone());
+
+            // A session request is surfaced only from a completed handshake.
+            handshake.await;
+            if let Some(error) = quic_connection.close_reason() {
+                return Err(error.into());
+            }
+            Self::accept(quic_connection, driver).await
         }))
     }
```

(`accept` now takes the driver instead of creating it; its body is otherwise unchanged.)

**What does not change.** The public API. A `SessionRequest` still exists only after a completed
handshake, so a 0-RTT CONNECT could not be surfaced before it, even on a server that enabled early
data. wtransport's TLS config leaves `max_early_data_size` at 0, so it does not. The only bytes
that move earlier are the server's SETTINGS.

**Tested.** A test in which the client loses everything it sends after its first flight, so the
server's handshake never completes: the client must still receive the server's control stream,
opening with SETTINGS. It times out without the change and passes with it. A PR would carry it
into wtransport's own tests. Interop checked against Chrome 141, wtransport's client,
webtransport-go v0.9.0 and aioquic 1.3.0 (sessions and a stream each way). Also against quic-go's
HTTP/3 client and hyperium h3, whose handshakes and SETTINGS read the same with and without the
change. A client that ignores 0.5-RTT data was built by stripping the server's 1-RTT packets until
the client sends one: it still connects, a round trip slower than today, as the issue says.

---

## The quinn companion, as its own issue

**Title:** Server PTO during the handshake probes only the expired space, leaving 0.5-RTT data a round trip behind

When a server's whole first flight is lost, its probe timeout resends only the Initial space's
packet (the ServerHello). The Handshake flight waits for that probe's ACK. The 0.5-RTT data is
declared lost only once the client ACKs a 1-RTT packet sent after the handshake. An 8-line change
in `on_loss_detection_timeout`: while a server is handshaking, a probe for one space adds one to
every other space with data in flight. RFC 9002 §6.2.4 requires a probe in the expired space and
bars none in the others; §6.2.3 lets an endpoint resend unacknowledged CRYPTO data early.
Measured at 80 ms: a lost first flight costs Chrome 1 249 ms instead of 1 414 (1 332 without
0.5-RTT data at all). Clean dials tie, and a 1 % loss median ties. The patch as carried is
[`../../patches/quinn-proto-0.11.18-probe-every-space.patch`](../../patches/quinn-proto-0.11.18-probe-every-space.patch),
and `proposal-session-open.md` §The losing phase, removed, has the trace.

A second quinn item, found since: an owed ACK waits while the congestion window is full and
stream data is queued ([`../proposal-session-open.md`](../proposal-session-open.md) §The probe
after the open). It is a separate issue and not part of this draft.
