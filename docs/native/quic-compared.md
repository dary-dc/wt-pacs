# The QUIC implementations, compared

*Queue row 156, QUICCOMPARE, 2026-10-12. Theory and writing: nothing built or timed. It rewrites rows 124 and 152
([`quic.md`](quic.md) §2, §7) for learning: how each stack works, lever by lever, and what that means for throughput
and latency. Every choice stays the owner's ([`quic.md`](quic.md) §5, §7.7).*

**How to read the labels.** Every claim carries one:
* **(S)** a source, pinned in [`quic.md`](quic.md) §8 or in §8 here;
* **(D)** derived: arithmetic on a sourced number, by hand or by [`quic_grid.py`](quic_grid.py);
* **(M, row N)** measured in this repository, by the row named. Measured results are kept in their own paragraphs.

**Two framings this row does not inherit.**
* **"Our client" is a native client on raw QUIC with an ALPN of our own** (the owner, 2026-10-10). WebTransport
  counts only for the server's browser side. Rows 124 and 127 assumed a WebTransport native client; §6 examines what
  changes.
* **No claim here is restricted to a "target band".** The repository's 5–50 Mbit/s and 30–150 ms
  ([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md), The target) are an assumption,
  not field data. Every ceiling below is given from 1 Mbit/s to 1 Gbit/s and from 10 to 300 ms, and wherever the
  assumed band is used it is named as such.

## Contents

1. [What the comparison shows](#1-what-the-comparison-shows)
2. [Glossary](#2-glossary)
3. [The throughput ceiling, one formula for every stack](#3-the-throughput-ceiling-one-formula-for-every-stack)
4. [The eleven read deeply](#4-the-eleven-read-deeply)
5. [The other four, briefly](#5-the-other-four-briefly)
6. [Raw QUIC for the native client: what it changes](#6-raw-quic-for-the-native-client-what-it-changes)
7. [Side by side](#7-side-by-side)
8. [Sources added by this row](#8-sources-added-by-this-row)

## 1. What the comparison shows

* **Every stack obeys the same ceiling**: one stream moves at most its receive window ÷ RTT, the sender's controller
  caps it again under loss, and CPU per byte caps it on fast links (§3). The stacks differ in their default windows,
  in whether those windows grow by themselves, and in which constants need a fork to change.
* **At their defaults, three stacks bind inside the grid at ordinary rates** (D): Google QUICHE's bare 16 KB stream
  window (1.6 Mbit/s at 80 ms), mvfst's 65 KiB (6.55 Mbit/s at 80 ms) and, for the first window of a fresh stream
  only, msquic's 64 KiB (6.55 Mbit/s at 80 ms). quinn's fixed 1.25 MB binds above 125 Mbit/s at 80 ms and above 33 at
  300 ms. The rest bind only in the grid's corner, at hundreds of Mbit/s and 150–300 ms.
* **At their best, no window binds anywhere in the grid except neqo's** (D): its 10 MiB stream cap is a constant,
  280 Mbit/s at 300 ms. Every other stack's windows are settings, or grow without a cap (picoquic).
* **Under loss the controller binds long before any window** (D from RFC 9438): CUBIC's own response function gives
  1.7 Mbit/s at 1 % random loss and 80 ms, whatever the stack. That is the sender's lever, so it is the server's
  choice, not the client's (M: Cubic is "an order of magnitude wrong for random loss",
  [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §1).
* **The client's stack decides latency more than throughput.** It decides how quickly it acknowledges (which sets the
  sender's loss timer), whether it can resume in 0-RTT, whether it migrates with a probe, and its receive CPU per byte.
  These differ more between the stacks than their throughput ceilings do (§7).
* **On raw QUIC, quinn's lead as the client narrows to one fact: it is the server's own crate.** "It speaks to our
  server unchanged" was a WebTransport argument; with an ALPN of our own every stack but Cronet can reach a server
  that offers that ALPN (S, [`quic.md`](quic.md) §4). Its remaining advantages are the shared Rust code, the
  measured receive cost (M, row 135) and the ack-frequency extension it sends and obeys (§6).
* **As the server, a stack must serve browsers over WebTransport and native clients over raw QUIC, and carry this
  repository's controllers.** Only quinn (today) does all three; Google QUICHE and picoquic could with unreleased
  WebTransport code; lsquic has a released WebTransport server but no public controller hook (§6).

## 2. Glossary

Each term with its mechanism in plain words.

* **Round-trip time (RTT).** The time from sending a packet to receiving its acknowledgement. Every feedback loop in
  QUIC runs once per RTT, so most ceilings below are "something ÷ RTT".
* **Bandwidth-delay product (BDP).** The link's rate × the RTT: the bytes that are in flight when the link is full.
  At 50 Mbit/s and 150 ms it is 0.94 MB (D); at 1 Gbit/s and 300 ms, 37.5 MB (D). Any window smaller than the BDP
  leaves the link idle for part of each round trip.
* **Receive window (flow control).** How many bytes past the last one read the receiver allows the sender to send,
  per stream and per connection (RFC 9000 §4, S). The receiver raises it with `MAX_STREAM_DATA` and `MAX_DATA` frames
  as the application reads. Because the sender learns of a raise only one RTT later, **one stream moves at most
  window ÷ RTT**. The window is also the receiver's promise of memory.
  * **Fixed**: stays at what was set (quinn, s2n-quic, lsquic; mvfst by default).
  * **Auto-tuned**: starts small and doubles when the reader is keeping up, up to a cap. The usual rule is "the last
    raise went out less than about two RTTs ago"; msquic's is "a quarter of the window drained within one RTT" (S,
    [`quic.md`](quic.md) §7.1). A doubling window cannot bind for long, but it binds at the start of each new stream.
* **Send window / send buffer.** What the sender keeps of unacknowledged data. It bounds memory per connection, not
  the rate, as long as it is above the BDP.
* **ACK policy.** When the receiver acknowledges: RFC 9000 §13.2.2 says at least every second ack-eliciting packet,
  and within `max_ack_delay` (25 ms by default) otherwise (S). ACKs are the sender's clock: its window grows and its
  loss detection runs only on them. Each ACK is also a packet the receiver builds and encrypts and the sender parses,
  so fewer ACKs cost less CPU on both ends.
* **ACK frequency.** draft-ietf-quic-ack-frequency-14 (S) lets a *sender* ask its peer to acknowledge every *n*
  packets and within a given delay. It needs both ends to support it; a peer that advertises `min_ack_delay` can be
  asked. A shorter delay shortens the sender's probe timeout, `PTO = srtt + max(4·rttvar, 1 ms) + max_ack_delay`
  (RFC 9002 §6.2.1, S), which is what a lost last packet of a burst waits for.
* **Socket buffer.** The kernel's queue of datagrams the application has not yet read. When it is full the kernel
  drops what arrives, and QUIC reads the drop as congestion. Linux before 6.18 caps it at `rmem_max` = 212 992 bytes
  unless the host raises it; 6.18 raised the cap to 4 MiB (S). A buffer is not a rate limit: it is how long the
  reader may stall before packets are lost, buffer ÷ rate (≈ 34 ms at 50 Mbit/s for 212 992 bytes, D).
* **Batched I/O.** Fewer system calls per byte:
  * `recvmmsg` / `sendmmsg` read or write several datagrams in one call;
  * **GSO** (generic segmentation offload) hands the kernel one large buffer that it cuts into equal datagrams on
    the way out; **GRO** (generic receive offload) coalesces consecutive datagrams of one flow into one buffer on the
    way in. Windows calls them USO and URO.
  These cut CPU per byte; they do not change what the link carries (M, row 135: quinn's receive CPU per MB falls by
  about a third with GRO).
* **Pacing.** Spreading a window's packets across the RTT instead of sending them back to back. Without it, a full
  window leaves as one burst and a shallow queue at the bottleneck drops its tail. GSO works against pacing: the
  kernel releases a GSO batch back to back unless patched (S, Kempf et al. 2025).
* **Congestion controller, and its hook.** The sender's rule for how much may be in flight. **Reno** and **CUBIC**
  shrink the window on each loss, so random loss caps them (§3); **BBR** models the bottleneck's rate and RTT
  instead and, in its current draft, reacts to loss only above 2 % per round trip (S, draft-ietf-ccwg-bbr-06 §2.8).
  A **hook** is a public interface through which an application supplies its own controller; without one, a new
  controller means a fork.
* **Initial window.** How much a new connection may send before its first ACK: 10 packets in RFC 9002 (S), more in
  some stacks. It sets how many round trips a short transfer spends in slow start.
* **Connection migration.** Moving a live connection to a new address (Wi-Fi to cellular). QUIC identifies a
  connection by its ID, not its address, so it can; a careful client first **probes** the new path
  (`PATH_CHALLENGE` / `PATH_RESPONSE`) and only then switches (RFC 9000 §9, S). A **rebind** switches at once and
  lets the server validate after.
* **0-RTT.** A client that resumes a connection with a ticket from an earlier one sends its first request in its
  first flight, one RTT sooner (RFC 9001 §4.6, S). The data can be replayed by an attacker, so only idempotent
  requests may ride it.
* **Multipath.** One connection using several paths at once (draft-ietf-quic-multipath-21, S), unlike migration,
  which uses one at a time.
* **WebTransport over HTTP/3.** A session opened by an HTTP/3 `CONNECT` request, inside which the application gets
  QUIC streams and datagrams (draft-ietf-webtrans-http3-16, S). It is how a browser page reaches raw-ish QUIC; a
  native client can skip it and use QUIC directly with its own ALPN.
* **ALPN.** The TLS extension that names the application protocol a connection will speak (`h3`, or one of ours).
  One server port can accept several and route each connection by it.

## 3. The throughput ceiling, one formula for every stack

For one connection carrying one stream (today's fill uses one shared stream,
[`../WIRE.md`](../WIRE.md)), the rate is at most the least of (D, from §2's mechanisms):

```
rate ≤ min( link rate,
            stream receive window ÷ RTT,
            connection receive window ÷ RTT,          (shared by all streams)
            the sender's controller under loss,       (§3.2)
            CPU per byte on either end )              (§3.3)
```

and it is drop-free only while the socket buffer outlasts the reader's longest stall. Which term binds moves with the
cell: windows bind at long RTT and high rate, the controller binds under loss at any rate, CPU binds only on fast links
(§3.3).

### 3.1 The window term, at each stack's defaults

window ÷ RTT in Mbit/s (D, [`quic_grid.py`](quic_grid.py)); where two numbers are given, the first is a fresh
stream's first window and the second the window it grows to. Defaults are §7.2 of [`quic.md`](quic.md) (S).

| window | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --: | --: | --: | --: | --: |
| quinn | 1 000 | 333 | 125 | 66.7 | 33.3 |
| msquic | 52.4 · 13 422 | 17.5 · 4 474 | 6.55 · 1 678 | 3.5 · 895 | 1.75 · 447 |
| Cloudflare quiche | 800 · 13 422 | 267 · 4 474 | 100 · 1 678 | 53.3 · 895 | 26.7 · 447 |
| ngtcp2 | 13 422 | 4 474 | 1 678 | 895 | 447 |
| picoquic | 839 · none | 280 · none | 105 · none | 55.9 · none | 28 · none |
| Google QUICHE | 12.8 | 4.27 | 1.6 | 0.853 | 0.427 |
| Google QUICHE in Chromium | 4 800 · 12 800 | 1 600 · 4 267 | 600 · 1 600 | 320 · 853 | 160 · 427 |
| neqo | 839 · 8 389 | 280 · 2 796 | 105 · 1 049 | 55.9 · 559 | 28 · 280 |
| s2n-quic | 3 000 | 1 000 | 375 | 200 | 100 |
| quic-go | 419 · 5 033 | 140 · 1 678 | 52.4 · 629 | 28 · 336 | 14 · 168 |
| lsquic | 5 033 | 1 678 | 629 | 336 | 168 |
| mvfst | 52.4 | 17.5 | 6.55 | 3.5 | 1.75 |

**At their best** every window above is a setting except neqo's caps (10 MiB stream, 20 MiB connection, constants;
S, [`quic.md`](quic.md) §7.2) and picoquic's, which has none. Set to the grid's largest BDP (37.5 MB, 1 Gbit/s ×
300 ms), no other stack's window binds anywhere in the grid (D). neqo's binds at 300 ms above 280 Mbit/s and at
150 ms above 559 (D). The cost of a large window is memory, and only when the reader falls behind.

### 3.2 The controller term, under random loss

A loss-based controller halves (Reno) or cuts to 0.7 (CUBIC) its window at each congestion event, so its average
window depends on how often loss arrives. RFC 9438 §5 gives CUBIC's: the larger of `1.054 × RTT^0.75 ÷ p^0.75` and
Reno's `1.2 ÷ √p` segments, with p the loss rate and RTT in seconds (S). Times 1 452 bytes per RTT, in Mbit/s (D,
checked against the RFC's own Tables 1 and 2):

| p \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --: | --: | --: | --: | --: |
| 0.01 | 13.9 | 4.65 | 1.74 | 0.929 | 0.523 |
| 0.001 | 44.1 | 14.7 | 5.51 | 3.5 | 2.94 |
| 0.0001 | 139 | 46.5 | 23 | 19.7 | 16.5 |
| 1e-05 | 441 | 165 | 129 | 111 | 93 |
| 1e-06 | 1 394 | 930 | 728 | 622 | 523 |

* It applies to **every stack's** Cubic and Reno: the formula is the controller's, not the implementation's. p is
  the rate of congestion events, and a QUIC stack counts several losses in one RTT as one event, so under random
  packet loss p the real window is somewhat larger: read the table as an order of magnitude (D).
* **BBR does not follow it.** Its draft tolerates up to 2 % loss per round trip before it backs off (S,
  draft-ietf-ccwg-bbr-06 §2.8). (M: in a browser under 1–3 % random loss BBR filled 12–19× faster than Cubic,
  [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §1 *Priced in a browser*.)
* **The controller is the sender's.** For a fill or an ask the server sends, so this term is the server's stack's
  and the client's stack changes nothing in it. It is the client's only for the ingest upload.

### 3.3 The CPU term

Every published one-connection number is on server CPUs and far above 1 Gbit/s, so **CPU binds nowhere in the grid
on such hardware** (D). On a phone it is unknown for every stack. Published, at each source's settings (S unless
marked; [`quic.md`](quic.md) §7.3 has the setups):

| stack | one connection, CPU-bound |
| --- | --- |
| quinn | 11.8–12.4 Gbit/s at 0 ms, docker (quinn #2262) |
| s2n-quic | 13.0 Gbit/s, same setup |
| msquic | 14.8–16.4 Gbit/s, same setup; 7.3–8.0 Linux, ~12.6 Windows on its dashboard |
| lsquic | 2.6–4.4 Gbit/s (Bünstorf & Jaeger, three host pairs) |
| Cloudflare quiche | 1.8–2.5 Gbit/s (same) |
| picoquic | 1.4–2.0 Gbit/s (same); 1.5–3.4 on a laptop's loopback (Huitema) |
| neqo | < 1 → 4 Gbit/s with quinn-udp (Firefox) |
| quic-go | 64–1 976 Mbit/s as a client, by the server it faced (Jaeger et al.) |
| mvfst, ngtcp2, Google QUICHE | none published per stack (Jaeger et al.'s pairs, mvfst among them, span 52–3 004 Mbit/s) |

**Measured here (row 135):** quinn's receive cost is 2.05–2.16 ms of CPU per MB with GRO and 3.07–3.14 without,
Chromium's network service 4.0–4.3; at 50 Mbit/s every arm used ≤ 0.05 cores, so CPU is a battery and sessions-per-core
term in the assumed band, not a rate term ([`quic.md`](quic.md) §6 N1).

## 4. The eleven read deeply

Each section: what it is; its design; each lever; its ceiling with the grid at its defaults (link rate down, RTT
across; **bold** where the steady window binds, in Mbit/s, "link" where the link does; a fresh stream's first window
is in §3.1; D, [`quic_grid.py`](quic_grid.py));
platforms and record; and what it would mean for us. Facts are (S) from [`quic.md`](quic.md) §2 and §7.2 unless
labelled otherwise.

### 4.1 quinn

* **What.** "A pure-Rust, async-compatible implementation of the IETF QUIC transport protocol", started in 2018 by
  two developers as a side project, community-maintained (S, README). It is today's server stack under wtransport,
  and Firefox's UDP I/O is its `quinn-udp`.
* **Design.** A sans-I/O core (`quinn-proto`: packets in, packets out, timers) wrapped by `quinn` on tokio (smol
  optional). All connections of one endpoint share one driver task for socket I/O (quinn #1576). TLS is rustls, on
  *ring* or aws-lc-rs.
* **Windows.** Fixed: stream 1.25 MB, connection unbounded, send 10 MB; all settable. The 1.25 MB is chosen in the
  source for "100 Mbit/s at 100 ms".
* **ACKs.** Every second packet, `max_ack_delay` 25 ms (no setter). Sends and obeys ACK_FREQUENCY at the draft's
  codepoint, off until the application sets `AckFrequencyConfig`.
* **Socket and batching.** The application builds the socket, so its buffer is the application's. `recvmmsg` ×32;
  GRO on Linux and Android; one datagram per call on Apple unless `fast-apple-datapath`; Windows URO off by default.
  GSO on Linux and Android, 10 segments a call hard-coded (this repository patches it to 45,
  [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §4); Windows USO on.
* **Pacing.** Always on, no switch: a token bucket refilled at 1.25 × cwnd ÷ sRTT, bursts of 10–256 packets, checked
  before every datagram of a GSO batch.
* **Controllers.** NewReno, CUBIC (default), BBR ("experimental"). **Hook: public** — `congestion::Controller` and
  `ControllerFactory`; this repository's `cubic-restart` and `bbr-bound` are written against it. Initial window
  12 000 B; initial RTT 333 ms, settable.
* **Migration, 0-RTT, multipath, WebTransport.** Client: `Endpoint::rebind`, a socket swap with no probe first;
  server-side migration on by default. 0-RTT on both ends (`into_0rtt`). No multipath (the fork noq 1.3.0 has
  draft-21). WebTransport through wtransport 0.7.2 (our server) and web-transport-quinn 0.13.2, client and server.
* **Ceiling.** Defaults: 1.25 MB ÷ RTT — 125 Mbit/s at 80 ms, 33 at 300 ms (D). A contributor measured exactly this:
  918, 465, 233 and 95 Mbit/s at 10, 20, 40 and 100 ms with default windows (S, quinn #2262). At best: any window;
  then CPU, 11.8–12.4 Gbit/s on one connection (S, #2262).

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | **33.3** |
| 100 Mbit/s | link | link | link | **66.7** | **33.3** |
| 500 Mbit/s | link | **333** | **125** | **66.7** | **33.3** |
| 1000 Mbit/s | link | **333** | **125** | **66.7** | **33.3** |

* **Platforms and record.** Linux, macOS, Windows tested; Android in CI; no iOS CI. Releases monthly for the proto
  crate. Five RustSec advisories, two in 2026 (DoS). MIT OR Apache-2.0.
* **As our client.** The server's own crate: the framing and exactness code can be one Rust crate on both ends.
  Receive cost measured at 2.05–2.16 ms per MB with GRO (M, row 135). Raise the stream window if a site's BDP can
  exceed 1.25 MB. It obeys ACK_FREQUENCY at the current codepoint (as msquic and picoquic do), so the server can ask
  it for a shorter `max_ack_delay`; 0-RTT on raw QUIC needs no wtransport patch (§6). Migration is a rebind without a probe.
* **As our server.** Today's. Carries this repository's controllers through the public hook; paces always. Its known
  limits are one I/O task per endpoint and the GSO constant (patched here).

### 4.2 msquic

* **What.** "A Microsoft implementation of the IETF QUIC protocol … cross-platform, written in C and designed to be a
  general purpose QUIC library", with C++, Rust and C# interop layers (S, README).
* **Design.** Its own worker threads; the application gets callbacks. TLS is Schannel on Windows, quictls/OpenSSL 3.5
  elsewhere. Receive-side scaling and XDP kernel bypass on Windows (S, README).
* **Windows.** Stream window starts at **64 KiB** and doubles each time a quarter of it drains within an RTT, up to the
  16 MiB connection window; both settable (`StreamRecvWindowDefault`, connection window). From 64 KiB to 1 MiB takes
  four doublings after 240 KiB has been read (D).
* **ACKs.** Every second packet, 25 ms. Obeys ACK_FREQUENCY; never asks for it.
* **Socket and batching.** Asks the kernel for an `INT32_MAX` receive buffer (clamped). `recvmmsg`/`sendmmsg` ×53,
  GRO and GSO on Linux after a self-test, URO and USO on Windows. **One datagram per call on macOS and iOS.**
* **Pacing.** On, settable. **Controllers.** CUBIC; BBR in preview. **Hook: none** (an internal table; a statistics
  event only). Initial window 10 packets; initial RTT 333 ms.
* **Migration, 0-RTT, multipath, WebTransport.** The client sets a new local address after the handshake; nothing
  watches the OS. 0-RTT with OpenSSL builds only, not Schannel. No multipath. **No WebTransport.** Its README lists
  the reliable-reset draft (S), which a draft-16 WebTransport server needs.
* **Ceiling.** Defaults: 64 KiB ÷ RTT for a fresh stream's first window (6.55 Mbit/s at 80 ms, D), then 16 MiB ÷ RTT
  (1.68 Gbit/s at 80 ms, 447 Mbit/s at 300 ms, D). At best: any window; then CPU, 14.8–16.4 Gbit/s on one connection
  (S, #2262), the fastest published.

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | link |
| 100 Mbit/s | link | link | link | link | link |
| 500 Mbit/s | link | link | link | link | **447** |
| 1000 Mbit/s | link | link | link | **895** | **447** |

* **Platforms and record.** Windows and Linux official; others best-effort, iOS static only. Releases monthly.
  CVE-2026-105794: before 2.6.1 every non-Windows client accepted any hostname, plus two more critical or high in
  2026. MIT.
* **As our client.** Fast on Windows and Linux desktops; a C library behind a binding (the crates.io crate lags).
  The 64 KiB start matters for a first frame on a fresh stream at long RTT; raise `StreamRecvWindowDefault`. On Apple
  its receive is one datagram per call, so on iOS it would be the slowest reader read here.
* **As our server.** The least CPU per byte published (~1.3× quinn's rate, D), but no controller hook (this
  repository's controllers would need a fork) and no WebTransport server for browsers.

### 4.3 Cloudflare quiche

* **What.** "An implementation of the QUIC transport protocol and HTTP/3", low level: "the application is responsible
  for providing I/O … as well as an event loop" (S, README). It runs Cloudflare's edge HTTP/3, Android's DNS-over-HTTP/3
  resolver and curl's HTTP/3 option (S, README).
* **Design.** Sans-I/O, single-threaded core; tokio-quiche adds a tokio runtime and Linux I/O. TLS is BoringSSL. A C
  API beside the Rust one.
* **Windows.** The library default is 0: the application must set one (tokio-quiche: 1 MB a stream). Auto-tuned up
  to 16 MiB a stream and 24 MiB a connection; the growth factors need a fork.
* **ACKs.** No timer: it acknowledges in whatever packet the application next asks it to build, which a 2026 paper
  measured at about one reply per packet received (S, PEMI). No ACK_FREQUENCY.
* **Socket and batching.** The application's; tokio-quiche has GRO and GSO with `SO_TXTIME` on Linux, one `recvmsg`
  a call.
* **Pacing.** **None for CUBIC and Reno** (`get_next_release_time` returns `Immediate`); only BBRv2 has a pacer.
* **Controllers.** Reno, CUBIC, BBRv2. **Hook: none** (`pub(crate)`). Initial window 10 packets, settable; initial RTT
  333 ms.
* **Migration, 0-RTT, multipath, WebTransport.** Client migration with a probe (`probe_path`, `migrate`). 0-RTT yes.
  No multipath. WebTransport not found in rows 124 and 152's reading.
* **Ceiling.** Defaults: the application's start (tokio-quiche's 1 MB: 100 Mbit/s at 80 ms) growing to 16 MiB ÷ RTT
  (D). Measured, defaults, 40 Mbit/s and 40 ms: 34.67 Mbit/s against TCP's 37.37, with 687 drops per 100 MiB against
  16.5 (S, Kempf et al. 2025). CPU: 1.8–2.5 Gbit/s (S, Bünstorf & Jaeger).

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | link |
| 100 Mbit/s | link | link | link | link | link |
| 500 Mbit/s | link | link | link | link | **447** |
| 1000 Mbit/s | link | link | link | **895** | **447** |

* **Platforms and record.** All five targets, iOS build-only in CI; Android ships it in its resolver. Five CVEs, one in
  2026 a use-after-free in the C API. BSD-2-Clause.
* **As our client.** Probe-then-migrate is built in, and it runs on Android in production. Its ACK on every packet
  costs both ends CPU; a Rust API, so it binds as easily as quinn.
* **As our server.** Unpaced CUBIC on a shallow queue is the published burst-loss case (Kempf et al.), no controller
  hook, no WebTransport found: the weakest server fit of the Rust stacks.

### 4.4 ngtcp2

* **What.** "An effort to implement RFC 9000 QUIC protocol" in C, by the nghttp2 project; HTTP/3 is nghttp3 (S,
  README).
* **Design.** The cleanest sans-I/O C library read: no threads, no sockets, one connection used by one thread at a
  time. TLS through a choice of backends: quictls, GnuTLS, BoringSSL, aws-lc, picotls, wolfSSL, LibreSSL, OpenSSL 3.5.
* **Windows.** The application's; auto-tuning is off until it sets `max_stream_window`. The example client sets
  16 MiB a stream. The growth factors need a fork.
* **ACKs.** Every second packet, within min(25 ms, srtt ÷ 8). No ACK_FREQUENCY.
* **Socket and batching.** The application's; its examples use GRO and one `recvmsg` a call;
  `write_aggregate_pkt` builds GSO batches.
* **Pacing.** Computed by the library, honoured by the application.
* **Controllers.** Reno, CUBIC, BBRv2. **Hook: none** (internal `ngtcp2_cc.h`). Initial window min(10 MSS, 14 720).
* **Migration, 0-RTT, multipath, WebTransport.** Client migration validated (`initiate_migration`) or immediate. 0-RTT
  yes. No multipath. WebTransport on unreleased `webtransport` branches of ngtcp2 and nghttp3.
* **Ceiling.** The application's window (the example's 16 MiB: 1.68 Gbit/s at 80 ms, D). Measured, defaults, 40 Mbit/s
  and 40 ms: **15.93 Mbit/s** against 34.67–37.37 for the others, 503 drops per 100 MiB (S, Kempf et al. 2025) — the
  one in-range published result where a stack lost half the link; why was not read. CPU: none published.

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | link |
| 100 Mbit/s | link | link | link | link | link |
| 500 Mbit/s | link | link | link | link | **447** |
| 1000 Mbit/s | link | link | link | **895** | **447** |

* **Platforms and record.** Linux, macOS, Windows in CI; no mobile statement. Monthly releases. Two CVEs, both in qlog.
  MIT.
* **As our client.** Everything is the application's, which is control and work: the I/O loop, the batching, the
  window. A C library behind bindings (third-party `-sys` crates).
* **As our server.** No controller hook, WebTransport only on branches; the published in-range result is the worst of
  the three it measured.

### 4.5 picoquic

* **What.** A "minimalist implementation of the QUIC protocol", written first to give feedback to the IETF working
  group and now to test new work such as multipath (S, README); its author is a QUIC working-group participant
  (Huitema, S).
* **Design.** **Single-threaded per context**, an application-driven loop (`sockloop.c` provides one). TLS is picotls
  (OpenSSL) or mbedTLS.
* **Windows.** Local stream 2 MiB, connection 1 MiB at the start; auto-tuned **without a cap**.
* **ACKs.** Adaptive: about a quarter of the congestion window in packets, a delay of RTT ÷ 4 and at most 10 ms.
  Sends and obeys ACK_FREQUENCY. The ACK algorithm is a fork.
* **Socket and batching.** Buffer off unless set; plain `recvmsg` ×10, no GRO on Linux; GSO on Linux, USO and URO on
  Windows.
* **Pacing.** Always. **Controllers.** NewReno (default), CUBIC, BBRv3, BBRv1, Prague, C4 and more. **Hook: public
  and the richest read** — `picoquic_congestion_algorithm_t`, with per-ACK newly lost bytes, loss ranges, one-way delay
  and ECN-CE. Initial window 15 360 B, a constant; initial RTT 250 ms, constant.
* **Migration, 0-RTT, multipath, WebTransport.** Probe and abandon paths (`probe_new_path`, `abandon_path`). 0-RTT on
  by default. **Multipath at draft-20 (0x3e)**, one of two released stacks at the final codepoint. WebTransport client
  and server in tree (picowt).
* **Ceiling.** Defaults: the 1 MiB connection window at the start (105 Mbit/s at 80 ms, D), then unbounded. Measured,
  defaults, 40 Mbit/s and 40 ms: 37.09 Mbit/s, the closest to TCP's 37.37, but 861 drops per 100 MiB (S, Kempf et al.).
  CPU: 1.4–2.0 Gbit/s (S, Bünstorf & Jaeger); 3.4 Gbit/s on loopback with the ACK gap capped at 32 (S, Huitema 2024).

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | link |
| 100 Mbit/s | link | link | link | link | link |
| 500 Mbit/s | link | link | link | link | link |
| 1000 Mbit/s | link | link | link | link | link |

* **Platforms and record.** Linux, macOS, Windows, FreeBSD; no mobile statement. **No releases**: date tags, several
  a day. Two CVEs. MIT.
* **As our client.** Multipath and probe-then-migrate are there today, in C, with no release to pin to but a tag;
  one thread per context fits a client.
* **As our server.** The best controller hook and a WebTransport server in tree, but one thread per context and the
  lowest published CPU ceiling of the eleven: sessions per core would be the open question.

### 4.6 Google QUICHE

* **What.** "Google's production-ready implementation of QUIC, HTTP/2, HTTP/3, and related protocols and tools. It
  powers Google's servers, Chromium, Envoy, and other projects" (S, README). The embedder supplies platform APIs and
  build files (S, README).
* **Design.** C++ on its own event loop, BoringSSL, Abseil, protobuf; Bazel builds a standalone Linux binary only. No
  C API; this repository would write a shim.
* **Windows.** The bare library's default is 16 KB; Chromium sets 6 MB a stream and 15 MB a connection; auto-tuned to
  16/24 MB. All flags.
* **ACKs.** Every second packet, then every tenth after 100 packets, with a delay of min(25 ms, min_rtt ÷ 4). Receiving
  ACK_FREQUENCY sits behind an off flag. Chromium is built on this policy.
* **Socket and batching.** Asks for 1 MiB; `recvmmsg` ×16, GRO and GSO in its own POSIX layer (Chromium uses neither by
  default).
* **Pacing.** On. **Controllers.** CUBIC, Reno, BBR, BBRv2, BBRv3, PCC, GoogCC, Prague. **Hook: public** —
  `SendAlgorithmInterface` via `SetSendAlgorithm`, and a loss-detection tuner. Initial window 32 packets (10–200);
  initial RTT 100 ms.
* **Migration, 0-RTT, multipath, WebTransport.** A migration manager (network change, path degrading, preferred
  address) driven by the embedder's OS signals. 0-RTT yes. No multipath. A native WebTransport client
  (`WebTransportOnlyClient`, drafts 02 and 07) and server code.
* **Ceiling.** Defaults: the bare 16 KB binds almost everywhere (1.6 Mbit/s at 80 ms, D); with Chromium's settings,
  6 MB then 16 MB (600 then 1 600 Mbit/s at 80 ms, D). CPU: none published for the library; Google's servers ran at
  about twice TLS/TCP's CPU after optimisation (S, Langley et al. 2017).

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | **0.853** | **0.427** |
| 5 Mbit/s | link | **4.27** | **1.6** | **0.853** | **0.427** |
| 10 Mbit/s | link | **4.27** | **1.6** | **0.853** | **0.427** |
| 50 Mbit/s | **12.8** | **4.27** | **1.6** | **0.853** | **0.427** |
| 100 Mbit/s | **12.8** | **4.27** | **1.6** | **0.853** | **0.427** |
| 500 Mbit/s | **12.8** | **4.27** | **1.6** | **0.853** | **0.427** |
| 1000 Mbit/s | **12.8** | **4.27** | **1.6** | **0.853** | **0.427** |

With Chromium's settings:

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | link |
| 100 Mbit/s | link | link | link | link | link |
| 500 Mbit/s | link | link | link | link | **427** |
| 1000 Mbit/s | link | link | link | **853** | **427** |

* **Platforms and record.** Linux standalone; everything else is the embedder's. **No tags or releases.** Chrome's
  QUIC CVEs, three high or critical in 2026. BSD-style.
* **As our client.** The most capable stack read and the hardest to ship: no releases, no C API, a Bazel build for
  Linux only. Its ACK decimation is the candidate mechanism for Chromium's 5–9 % loss under 2 % loss (M, row 135,
  unexplained; [`quic.md`](quic.md) §7.6).
* **As our server.** A public controller hook and WebTransport, at the cost of building and maintaining an unreleased
  C++ tree.

### 4.7 neqo

* **What.** "The QUIC implementation used by Mozilla in Firefox", Rust, with HTTP/3 and QPACK; TLS is NSS. "The neqo
  server functionality is experimental" (S, README).
* **Design.** Caller-driven: Firefox drives it from its own socket thread; I/O through quinn-udp.
* **Windows.** 1 MiB a stream auto-tuned to **10 MiB**, 2 MiB a connection to 20 MiB; the caps are constants.
* **ACKs.** Every second packet, 20 ms; ACK_FREQUENCY at an older codepoint, asking for cwnd ÷ 4 packets — it does not
  negotiate with the stacks at the current codepoint (D).
* **Socket and batching.** Asks for 1 MiB; quinn-udp 0.6 with GRO on Linux, URO on Windows and the Apple fast path on.
* **Pacing.** On, bursts of 2 packets; switchable. **Controllers.** NewReno, CUBIC with HyStart and SEARCH, spurious
  recovery on. **Hook: none.** Initial window a constant; initial RTT **100 ms**, with `max_pto` and `fast_pto`.
* **Migration, 0-RTT, multipath, WebTransport.** Probe-then-migrate (`migrate`), abandoning on failure. 0-RTT yes. No
  multipath. A WebTransport client (Firefox's), at the same draft-02 setting our server uses.
* **Ceiling.** Defaults and best are the same where it binds: 10 MiB ÷ RTT, 280 Mbit/s at 300 ms (D). CPU: Firefox
  went from < 1 to 4 Gbit/s with quinn-udp's batching (S, Inden 2025).

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | link |
| 100 Mbit/s | link | link | link | link | link |
| 500 Mbit/s | link | link | link | link | **280** |
| 1000 Mbit/s | link | link | link | **559** | **280** |

* **Platforms and record.** Linux, macOS, Windows; an Android build check, no iOS. Releases monthly; a git dependency,
  not on crates.io. No advisories under its crate names (Firefox's not checked). MIT OR Apache-2.0.
* **As our client.** The only stack with the Apple fast path on by default, which matters on iOS; probe-then-migrate.
  Not on crates.io and tied to NSS: a heavier dependency than a crate.
* **As our server.** Its own README calls the server experimental. Not a server candidate.

### 4.8 s2n-quic

* **What.** AWS's "Rust implementation of the IETF QUIC protocol", with s2n-tls (or rustls), "high configurability
  using providers" and extensive testing and compliance tracking (S, README).
* **Design.** tokio; providers for every component. TLS s2n-tls (C), rustls on MSVC.
* **Windows.** **3.75 MB, fixed**, stream and connection; settable.
* **ACKs.** **Every tenth packet** (hard-coded), 25 ms settable. No ACK_FREQUENCY.
* **Socket and batching.** The application's; GRO and `recvmmsg` on Linux only; GSO on Linux with kernel ≥ 5.0; none on
  Android, iOS or Windows.
* **Pacing.** Always, bursts of 10. **Controllers.** CUBIC, BBRv2. **Hook: sealed** behind
  `unstable-congestion-controller`, with the richest callback read (`new_loss_burst`, per-packet information).
* **Migration, 0-RTT, multipath, WebTransport.** No client migration exposed. 0-RTT behind `unstable_resumption`, and
  0-RTT packets are dropped ("FIXME"). No multipath, no WebTransport.
* **Ceiling.** Defaults: 3.75 MB ÷ RTT, 375 Mbit/s at 80 ms, 100 at 300 ms (D). Measured by a contributor at 100 ms:
  286–292 Mbit/s (S, #2262). CPU: 13.0 Gbit/s on one connection (S, #2262).

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | link |
| 100 Mbit/s | link | link | link | link | link |
| 500 Mbit/s | link | link | **375** | **200** | **100** |
| 1000 Mbit/s | link | link | **375** | **200** | **100** |

* **Platforms and record.** Linux, macOS, Windows; no mobile. Releases every few weeks. Four GHSA advisories.
  Apache-2.0.
* **As our client.** No batching off Linux, no migration and no usable 0-RTT: a desktop-Linux client at best.
* **As our server.** CPU close to quinn's and ACKs every tenth, but its controller hook is unstable and it has no
  WebTransport for browsers.

### 4.9 quic-go

* **What.** "A QUIC implementation in pure Go", with HTTP/3, datagrams, QUIC v2 and the reliable-reset draft (S,
  README); used by Caddy, cloudflared, go-libp2p, syncthing and others (S, README). webtransport-go builds
  WebTransport on it, client and server, at draft-16 (S, its README).
* **Design.** Goroutines; Go's `crypto/tls`.
* **Windows.** 512 KiB a stream auto-tuned to 6 MiB, 768 KiB a connection to 15 MiB; settable.
* **ACKs.** Every second packet, 25 ms; parses ACK_FREQUENCY but does not support it.
* **Socket and batching.** Asks for 7 MiB and warns when refused; `recvmmsg` ×8 on Linux, ×1 on macOS; **no GRO**; GSO
  on Linux only.
* **Pacing.** On, 5/4 of the rate, bursts ≤ 10. **Controllers.** A Reno-style CUBIC sender, initial window 32 ×
  1 280 B. **Hook: none** (`internal/`; future work in #776). Initial RTT 100 ms, fixed.
* **Migration, 0-RTT, multipath, WebTransport.** Application-driven `AddPath` → `Probe` → `Switch`; no preferred
  address. 0-RTT (`DialEarly`). No multipath (#3343).
* **Ceiling.** Defaults: 512 KiB ÷ RTT at a stream's start (52 Mbit/s at 80 ms, D), then 6 MiB (629 at 80 ms, 168 at
  300 ms, D). CPU: as a 10 Gbit/s client 64–1 976 Mbit/s depending on the server it faced (S, Jaeger et al. 2023).

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | link |
| 100 Mbit/s | link | link | link | link | link |
| 500 Mbit/s | link | link | link | **336** | **168** |
| 1000 Mbit/s | link | link | **629** | **336** | **168** |

* **Platforms and record.** Linux, macOS, Windows; phones through gomobile, with the Go runtime's size unknown.
  Releases monthly. Eight CVEs since 2023. MIT.
* **As our client.** Probe-then-migrate and 0-RTT, but no GRO and a Go runtime inside a Rust or Swift app.
* **As our server.** The one non-quinn stack with a released WebTransport server (webtransport-go, draft-16), but no
  controller hook; webtransport-go's client refuses today's server for want of reset-stream-at (M,
  [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Other clients).

### 4.10 lsquic

* **What.** "An open-source implementation of QUIC and HTTP/3 functionality for servers and clients", most of it used
  in LiteSpeed's own web servers (S, README).
* **Design.** An application-driven engine with a batched packets-out API (`ea_packets_out`). TLS BoringSSL or OpenSSL
  3.5.
* **Windows.** Client: 6 MiB a stream, 15 MiB a connection; auto-tuning off; settable.
* **ACKs.** Every second packet, 25 ms, fixed (a fork); ACK_FREQUENCY at an older codepoint, with a PID-tuned tolerance.
* **Socket and batching.** The application's.
* **Pacing.** On. **Controllers.** CUBIC, BBRv1, an adaptive one (default). **Hook: none** (internal `cong_ctl_if`).
  Initial window 32 × 1 460 B.
* **Migration, 0-RTT, multipath, WebTransport.** Client migration not found. 0-RTT yes. No multipath. **A released
  WebTransport server** (`es_webtransport_server`, 4.10.0).
* **Ceiling.** Defaults: 6 MiB ÷ RTT, 629 Mbit/s at 80 ms, 168 at 300 ms (D). CPU: 2.6–4.4 Gbit/s (S, Bünstorf &
  Jaeger); Chromium against an LSQUIC server took 18.60 s for 1 GB where HTTP/2 took 9.32 s, the cost on the receiver
  (S, Zhang et al. 2024).

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | link | link |
| 10 Mbit/s | link | link | link | link | link |
| 50 Mbit/s | link | link | link | link | link |
| 100 Mbit/s | link | link | link | link | link |
| 500 Mbit/s | link | link | link | **336** | **168** |
| 1000 Mbit/s | link | link | **629** | **336** | **168** |

* **Platforms and record.** Linux, FreeBSD, macOS, Windows; "tested on iOS ARM, Android ARM", no CI. Monthly
  releases. Three CVEs. MIT.
* **As our client.** No migration found: a phone that changes network re-dials.
* **As our server.** Built as one, with a released WebTransport server, but its controller would need a fork.

### 4.11 mvfst

* **What.** "A client and server implementation of IETF QUIC protocol in C++ by Facebook", meant for "use cases on
  both the internet and the data-center", "tested at scale on android, iOS apps, as well as servers" (S, README).
* **Design.** folly's `EventBase`; a "multi-threaded UDP socket server with a thread local architecture" (S, README).
  TLS is fizz.
* **Windows.** **65 KiB a stream**, 1 MiB a connection; auto-tuning off (caps 16/32 MiB when on); settable.
* **ACKs.** Every tenth packet; ACK_FREQUENCY only when `minAckDelay` is set.
* **Socket and batching.** GRO and `recvmmsg` (×5) off by default; GSO and/or `sendmmsg`.
* **Pacing.** **Off** by default. **Controllers.** CUBIC, NewReno, Copa, BBR, BBR2, static, none. **Hook: public** —
  `CongestionControllerFactory`, `CongestionControlType::Custom`. Initial window 10 MSS; initial RTT **50 ms**.
* **Migration, 0-RTT, multipath, WebTransport.** `onNetworkSwitch`, `startPathProbe`, `migrateConnection`. 0-RTT yes.
  No multipath. No WebTransport found.
* **Ceiling.** Defaults: 65 KiB ÷ RTT, 6.55 Mbit/s at 80 ms, 1.75 at 300 ms — inside the assumed band (D). One setting
  lifts it. Production: Facebook's apps saw −6 % request errors and −20 % tail latency after the move (S, Meta 2020).

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| 1 Mbit/s | link | link | link | link | link |
| 5 Mbit/s | link | link | link | **3.5** | **1.75** |
| 10 Mbit/s | link | link | **6.55** | **3.5** | **1.75** |
| 50 Mbit/s | link | **17.5** | **6.55** | **3.5** | **1.75** |
| 100 Mbit/s | **52.4** | **17.5** | **6.55** | **3.5** | **1.75** |
| 500 Mbit/s | **52.4** | **17.5** | **6.55** | **3.5** | **1.75** |
| 1000 Mbit/s | **52.4** | **17.5** | **6.55** | **3.5** | **1.75** |

* **Platforms and record.** Linux, macOS, Windows through getdeps; Meta's apps run it, but the mobile build files are
  not in the open tree. Weekly date tags. Two CVEs. MIT.
* **As our client.** Proven in phone apps at scale, with migration; but its defaults (65 KiB, no pacing, no GRO) all
  need changing, and the mobile build is not public.
* **As our server.** A public controller hook and a multi-threaded server; no WebTransport for browsers.

## 5. The other four, briefly

From [`quic.md`](quic.md) §2 (S); not re-read by rows 152 or 156.

* **Apple Network.framework.** The OS's stack: raw QUIC with our own ALPN from iOS 15 and macOS 12, datagrams, L4S
  built in since iOS 17, automatic Wi-Fi ↔ cellular migration. `initialMaxData` and `initialMaxStreamData*` are
  settable; their defaults, auto-tuning, ACK policy, batching, controller and pacing are not documented or exposed. No
  WebTransport. **As our client on iOS:** zero size and the OS's migration, against no control and a second
  implementation of the wire; [`quic.md`](quic.md) §6 N3 is the measurement. Not a server.
* **Cronet / HttpEngine.** Chromium's network stack (Google QUICHE inside) for Android apps; HTTP only, so **no raw
  QUIC, no ALPN of ours, no WebTransport**; QUICHE's settings pass only as connection-option tags. Migration on the
  default network and on path degradation. **As our client:** only behind a plain-HTTP/3 door on the server (row 128).
* **xquic** (Alibaba, C, Apache-2.0). Public controller callback, built-in FEC (both ends xquic), multipath at draft-10,
  `sendmmsg` without GSO, pacing off, no ECN; WebTransport on a branch. Windows, ACK policy and initial RTT were not
  re-read. Older multipath than the final draft.
* **tquic** (Tencent, Rust, Apache-2.0). BBR by default, multipath at draft-05, iOS and Android in CI, ≈ 2 MB stripped;
  last release 1.6.0 on 2025-02-25. No public controller hook, no DATAGRAM.

## 6. Raw QUIC for the native client: what it changes

Rows 124 and 127 assumed a WebTransport native client and quinn on the server. With the owner's 2026-10-10 framing,
each of their premises is re-read here (D, from §4 and [`quic.md`](quic.md) §4).

* **"quinn alone … speaks to the server unchanged" no longer separates the stacks.** On raw QUIC no client speaks to
  today's server unchanged: the server must also accept our ALPN. [`quic.md`](quic.md) §4 read that wtransport can
  take a session from a quinn connection the server already holds, so one endpoint could route `h3` to wtransport and
  our ALPN to the raw handler (read from the API, not built; a wire change, proposed not built). After that change
  every stack but Cronet can be our client.
* **What quinn keeps as a client** (S/M as marked): the server's own crate, so the wire's framing and exactness code
  is one Rust crate on both ends; the only measured native receive cost (M, row 135); ACK_FREQUENCY at the current
  codepoint, so the server can ask it for a shorter `max_ack_delay` (up to 20 ms off a lost tail's PTO, D,
  [`quic.md`](quic.md) §7.1) — msquic and picoquic also obey it; 0-RTT on raw QUIC without patching wtransport.
* **What raw QUIC opens.** Apple's Network.framework becomes a possible iOS client (§5). Probe-then-migrate clients —
  Cloudflare quiche, neqo, ngtcp2, picoquic, mvfst, quic-go — lose nothing by lacking WebTransport.
* **What the server then needs, as one stack**: WebTransport over HTTP/3 for browsers, raw QUIC for native clients,
  and this repository's controllers through a hook. Read across §4:

  | stack | WebTransport server | controller hook | all three |
  | --- | --- | --- | --- |
  | quinn | released (wtransport, web-transport-quinn) | public | **yes, today** |
  | Google QUICHE | in tree, unreleased | public | yes, unreleased |
  | picoquic | in tree (picowt), date tags | public | yes, date tags |
  | mvfst | not found | public | no |
  | lsquic | released | none | no |
  | quic-go | released (webtransport-go, draft-16) | none | no |
  | ngtcp2 | branch | none | no |
  | msquic, s2n-quic, Cloudflare quiche, neqo | none found | none or unstable | no |

* **The band assumption, examined.** Row 127 predicted a native client would tie the browser on fill time in the
  assumed band. The ceilings in §3 say why it can: at 5–50 Mbit/s every stack's window, at its best, is far above the
  BDP. They also say where it would stop being true: above ~125 Mbit/s at 80 ms on quinn's default window, and
  wherever the server's controller meets random loss (§3.2), which no client stack changes.

## 7. Side by side

At defaults unless marked; (S) [`quic.md`](quic.md) §2 and §7.2, ceilings (D) §3.

| stack | windows (stream): default → growth | binds at 80 ms above | ACKs | batched receive | pacing | controller hook | client migration | 0-RTT | multipath | WT server | phones | licence |
| --- | --- | --: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| quinn | 1.25 MB, fixed | 125 Mbit/s | 2nd, 25 ms; ACK_FREQUENCY | `recvmmsg` ×32, GRO | always | **public** | rebind, no probe | yes | fork (noq) | **released** | Android CI | MIT/Apache |
| msquic | 64 KiB → 16 MiB | 6.55 at start, then 1 678 | 2nd, 25 ms; obeys | ×53, GRO; ×1 on Apple | on | none | set address | OpenSSL only | no | none | best-effort | MIT |
| Cloudflare quiche | app's → 16 MiB | app's, then 1 678 | every packet | GRO (tokio-quiche) | **none for CUBIC** | none | **probe** | yes | no | none found | Android prod. | BSD-2 |
| ngtcp2 | app's (16 MiB example) | 1 678 | 2nd, ≤ srtt/8 | app's (GRO examples) | app honours | none | **probe** or immediate | yes | no | branch | no statement | MIT |
| picoquic | 2 MiB / 1 MiB conn → no cap | 105 at start, then none | ~¼ window, ≤ 10 ms; ACK_FREQUENCY | ×10, no GRO | always | **public, richest** | **probe** | on | **draft-20** | in tree | no statement | MIT |
| Google QUICHE | 16 KB (Chromium 6 MB) → 16 MB | 1.6 (Chromium 600) | 2nd → 10th | ×16, GRO | on | **public** | manager | yes | no | in tree | embedder's | BSD |
| neqo | 1 → 10 MiB, cap constant | 105 at start, then 1 049 | 2nd, 20 ms; old codepoint | GRO, Apple fast path | on | none | **probe** | yes | no | experimental | Android build | MIT/Apache |
| s2n-quic | 3.75 MB, fixed | 375 | **10th** (fork) | GRO, Linux only | always | unstable | none | dropped | no | none | none | Apache |
| quic-go | 512 KiB → 6 MiB | 52 at start, then 629 | 2nd, 25 ms | ×8, **no GRO** | on | none | **probe** | yes | no | **released** (draft-16) | gomobile | MIT |
| lsquic | 6 MiB, fixed | 629 | 2nd, 25 ms (fork) | app's | on | none | not found | yes | no | **released** | untested CI | MIT |
| mvfst | **65 KiB**, fixed | **6.55** | 10th | off by default | **off** | **public** | **probe** | yes | no | none found | Meta's apps | MIT |

**At their best** (D): no window binds in the grid but neqo's constant 10 MiB (above 280 Mbit/s at 300 ms); what
then separates the stacks is ACK policy (a fork in s2n-quic, lsquic, Cloudflare quiche), pacing (none for Cloudflare
quiche's CUBIC), batching (CPU, not rate), and whether the controller can be replaced without a fork (quinn, Google
QUICHE, picoquic, mvfst, xquic).

## 8. Sources added by this row

Fetched 2026-10-12, pinned by tag and the first 12 hex of the fetched file's sha256; raw copies are not committed.
Everything else is [`quic.md`](quic.md) §8.

* RFC 9438, CUBIC (`2647ced79cfc`): §5 Figure 8 and Tables 1–2.
* draft-ietf-ccwg-bbr-06 (`ba4f90e93d83`): §2.8 `BBR.LossThresh` = 2 %.
* READMEs at the pins of [`quic.md`](quic.md) §8: quinn `quinn-proto-0.11.19` (`fe91320a0fe0`), msquic `v2.6.2`
  (`025ed7ca6c8c`), Cloudflare quiche `0.30.0` (`b508071b040d`), ngtcp2 `v1.25.0` (`37c6d5d25c3c`, README.rst),
  picoquic `v2026.10.09.938685c` (`d75e1fb58a0a`), Google QUICHE `c8b1052048f1` (`fb30f2fa7d71`, the hash row 124
  pinned), neqo `v0.32.0` (`7c844f51fd10`), s2n-quic `v1.90.0` (`fa5ca3bfad0d`), quic-go `v0.63.0` (`3c4af91e57a4`),
  lsquic `v4.10.0` (`1517cc8f0545`), mvfst `v2026.10.05.00` (`de3a7097b381`); webtransport-go `v0.13.0`
  (`c7198ca4043e`, the hash row 124 pinned).
