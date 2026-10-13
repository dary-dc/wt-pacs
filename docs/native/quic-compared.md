# The QUIC implementations, compared

*Queue rows 156, QUICCOMPARE, and 157, QUICREWRITE, 2026-10-12, and 158, QUICLATENCY, 2026-10-13. Theory and
writing: nothing built or timed. How each stack works, lever by lever, how the stacks compare when each is at its
best, and what each does to a frame's latency (§8). Every choice stays the owner's ([`quic.md`](quic.md) §5,
§7.7).*

**What row 157 changed, and why (corrected in place).** Row 156 read each stack at its defaults and showed its best
only as a footnote, so a stack with a small default window looked worse for a reason the owner had ruled out:
defaults are settings, not limits. And many numbers carried only a section-level "(S)". This rewrite reads every lever
at the best setting the stack allows, or a one-constant patch would allow, and gives each number its own source at the
point of use. Re-reading the code at the same pins also corrected row 156's facts:

* **The window that matters is the client's window for a server-opened *unidirectional* stream.** The media arrives
  on the server's unidirectional streams ([`../WIRE.md`](../WIRE.md)); row 156 read the bidirectional one. At
  defaults that is 32 KiB for lsquic's client, 65 535 B for picoquic and 16 KiB for Google QUICHE (§6).
* **Google QUICHE auto-tunes only as a server**; as a client its window never grows (§3.1).
* **msquic sends ACK_FREQUENCY** as well as obeying it; **Google QUICHE never sends it**; **mvfst uses another
  codepoint**, so it negotiates with none of the others; lsquic advertises two older ones (§4.1).
* **Cloudflare quiche's window caps are settings**, not constants (§3.1). **neqo has a WebTransport server**
  (experimental), its default slow start is classic, not HyStart, and its 1 MiB socket buffer is its demo binary's.
* **quic-go's default controller is Reno**, and its pacing burst is *at least* 10 packets (§4.3, §4.4).
* mvfst's stream window is 66 560 B and its client 0-RTT is off by default; Google QUICHE's PCC and GoogCC are
  aliases of CUBIC and BBR; s2n-quic's `unstable_resumption` gates session tickets, not 0-RTT; picoquic's multipath is
  off by default.

**How a number is sourced.** At its point of use, each number carries one of:
* a file and line at the stack's pinned tag (§10), written `path:line` beside the stack's name;
* an RFC, draft or paper with its section, table or figure;
* its derivation, written out (D), every input sourced; [`quic_grid.py`](quic_grid.py) prints the tables.

Measured results (this repository) are kept apart, in §9, and named with their row.

**Two framings kept from row 156.**
* **"Our client" is a native client on raw QUIC with an ALPN of our own** (the owner, 2026-10-10). WebTransport
  counts only for the server's browser side.
* **No claim here is restricted to a "target band".** The repository's 5–50 Mbit/s and 30–150 ms
  ([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md), The target) are an assumption,
  not field data. The grid runs from 1 Mbit/s to 1 Gbit/s and from 10 to 300 ms.

## Contents

1. [What the comparison shows](#1-what-the-comparison-shows)
2. [Glossary](#2-glossary)
3. [Throughput, at each stack's best](#3-throughput-at-each-stacks-best)
4. [The other levers, at each stack's best](#4-the-other-levers-at-each-stacks-best)
5. [Each stack at its best](#5-each-stack-at-its-best)
6. [Defaults: what you would change, and how](#6-defaults-what-you-would-change-and-how)
7. [Raw QUIC for the native client: what it changes](#7-raw-quic-for-the-native-client-what-it-changes)
8. [Latency, at each stack's best](#8-latency-at-each-stacks-best)
9. [Measured here](#9-measured-here)
10. [Sources](#10-sources)

## 1. What the comparison shows

* **At their best, the receive window stops separating the stacks.** Every stack's window is a setting that reaches
  the grid's largest bandwidth-delay product, 37.5 MB (D: 1 Gbit/s × 0.3 s ÷ 8), except two constants: neqo's
  10 MiB stream cap and Google QUICHE's 16 MiB auto-tune limit. Each binds only above 280 and 447 Mbit/s at 300 ms
  (§3.1), and each is one constant to patch.
* **Under random loss the sender's controller binds long before any window, and that is the server's choice.**
  CUBIC averages 1.74 Mbit/s at 1 % loss and 80 ms whichever stack runs it (D from RFC 9438 §5.1, §3.2). What
  separates the stacks there is which controllers they ship and whether an application can supply its own without a
  fork: quinn, picoquic, Google QUICHE and mvfst can; s2n-quic only behind an unstable feature (§4.4).
* **CPU per byte separates them on fast links only**, and the published numbers are server CPUs at multi-gigabit
  rates; on phones they are unknown for every stack (§3.3).
* **What still separates the stacks once tuned** is mostly not throughput:
  * whether the sender can ask the client to acknowledge less often or sooner (ACK_FREQUENCY): only quinn, msquic and
    picoquic send and obey it at the current codepoint (§4.1);
  * whether the sender paces Cubic: all do but Cloudflare quiche (§4.3);
  * whether the client probes a new path before it moves, can resume in 0-RTT, and runs multipath (§4.5–§4.7);
  * whether the server side has WebTransport for browsers and a controller hook (§4.8).
* **On latency, the server's stack sets nearly every term** (§8): slow start from its initial window dominates a
  first frame (an ask's 0.5 MB takes 2.1 s at 300 ms on a fresh connection whatever the link above 50 Mbit/s, D), and
  its loss recovery and controller set an ask under loss. The client's stack sets four things: how long a lost first
  flight waits (3 × its initial RTT, 150–999 ms across the stacks), whether a lost last packet waits its 25 ms ack
  delay or 1 ms (quinn, msquic and picoquic obey the server's ACK_FREQUENCY), 0-RTT (which saves its RTT only with an
  address token), and how it notices and survives a network change.
* **Throughput's best window and latency's part.** A client window far above the BDP lets a fill queue more ahead of
  an ask on the shared stream (§8.2); an auto-tuned window that grows with the reader approximates the BDP by itself.

## 2. Glossary

Each term with its mechanism in plain words.

* **Round-trip time (RTT).** The time from sending a packet to receiving its acknowledgement. Every feedback loop in
  QUIC runs once per RTT, so most ceilings below are "something ÷ RTT".
* **Bandwidth-delay product (BDP).** The link's rate × the RTT: the bytes in flight when the link is full. Any window
  smaller than the BDP leaves the link idle for part of each round trip.
* **Receive window (flow control).** How many bytes past the last one read the receiver allows the sender to send,
  per stream and per connection; the receiver raises it with `MAX_STREAM_DATA` and `MAX_DATA` frames (RFC 9000 §4).
  The sender learns of a raise one RTT later, so **one stream moves at most window ÷ RTT**. RFC 9000 encodes every
  limit as a variable-length integer, at most 2^62 − 1 (RFC 9000 §16).
  * **Fixed**: stays at what was set.
  * **Auto-tuned**: starts small and grows when the reader keeps up, up to a cap. The common rule doubles the window
    when the previous update went out less than two RTTs ago (§3.1 gives each stack's line). It binds at the start of
    each new stream.
* **ACK policy.** When the receiver acknowledges: after at least two ack-eliciting packets (RFC 9000 §13.2.2), and
  within `max_ack_delay`, 25 ms unless the receiver advertises another (RFC 9000 §18.2). ACKs are the sender's clock:
  its window grows and its loss detection runs only on them. Each ACK is also a packet both ends spend CPU on.
* **ACK frequency.** draft-ietf-quic-ack-frequency-14 lets a *sender* ask its peer to acknowledge every *n* packets
  and within a given delay; a peer that advertises the `min_ack_delay` transport parameter can be asked (§3 of the
  draft). Both ends must use the same codepoint.
* **Socket buffer.** The kernel's queue of datagrams the application has not read. When it is full the kernel drops
  what arrives, and QUIC reads the drop as congestion. It bounds how long the reader may stall, not the rate.
* **Batched I/O.** `recvmmsg`/`sendmmsg` move several datagrams per system call; **GSO** hands the kernel one buffer
  it cuts into datagrams on the way out, **GRO** joins consecutive datagrams of one flow on the way in. They cut CPU
  per byte, not what the link carries.
* **Pacing.** Spreading a window's packets across the RTT instead of sending them back to back, so a shallow queue at
  the bottleneck does not drop a burst's tail.
* **Congestion controller, and its hook.** The sender's rule for how much may be in flight. **Reno** and **CUBIC**
  shrink the window at each loss, so random loss caps them (§3.2); **BBR** models the bottleneck's rate and RTT and
  tolerates up to 2 % loss per round trip (draft-ietf-ccwg-bbr-06 §2.8, `BBR.LossThresh`). A **hook** is a public
  interface through which an application supplies its own controller; without one, a new controller is a fork.
* **Initial window.** What a new connection may send before its first ACK: min(10 × max_datagram_size,
  max(14 720 B, 2 × max_datagram_size)) in RFC 9002 §7.2.
* **Connection migration.** Moving a live connection to a new address. A careful client first **probes** the new path
  (`PATH_CHALLENGE`/`PATH_RESPONSE`, RFC 9000 §9) and then switches; a **rebind** switches at once.
* **0-RTT.** A client resuming with a ticket sends its first request in its first flight, one RTT sooner (RFC 9001
  §4.6); the data can be replayed, so only idempotent requests may ride it.
* **Multipath.** One connection over several paths at once (draft-ietf-quic-multipath-21), unlike migration.
* **WebTransport over HTTP/3.** A session opened by an HTTP/3 `CONNECT` inside which the application gets streams and
  datagrams (draft-ietf-webtrans-http3-16): how a browser page reaches QUIC.
* **ALPN.** The TLS extension naming the application protocol (`h3`, or one of ours); one port can route by it.

## 3. Throughput, at each stack's best

For one connection, the rate is at most the least of (D, from §2's mechanisms):

```
rate ≤ min( link rate,
            stream receive window ÷ RTT,              (shared-stream mode, docs/WIRE.md)
            connection receive window ÷ RTT,          (all streams together)
            the sender's controller under loss,       (§3.2)
            CPU per byte on either end )              (§3.3)
```

The window that binds depends on the server's `stream_mode`: one shared media stream binds on the stream window; a
stream per frame spreads the bytes over many streams and binds on the connection window.

### 3.1 The window term

**At its best, each stack's client-side window is set to at least the grid's largest BDP, 37.5 MB** (D:
1 000 Mbit/s × 0.3 s ÷ 8). Where a setting allows that, window ÷ RTT is above the link everywhere in the grid (D).

| stack | uni-stream and connection window: the setting | the most it allows | auto-tune cap |
| --- | --- | --- | --- |
| quinn | `stream_receive_window`, `receive_window` (`quinn-proto/src/config/transport.rs:114`, `:125`) | 2^62 − 1 (`VarInt`) | none: fixed |
| msquic | `StreamRecvWindowUnidiDefault`, `ConnFlowControlWindow` (`src/inc/msquic.h:884`, `:837`) | 2^32 − 1 (`uint32_t`); the stream value a power of 2 (`src/core/settings.c:539`) | the connection window (`src/core/stream_recv.c:808`) |
| Cloudflare quiche | `set_initial_max_stream_data_uni`, `set_initial_max_data` (`quiche/src/lib.rs:1007`, `:952`) | 2^62 − 1 (`lib.rs:953–954`) | settable: `set_max_stream_window`, `set_max_connection_window` (`lib.rs:1225`, `:1218`), no clamp |
| ngtcp2 | `initial_max_stream_data_uni`, `initial_max_data`; `max_stream_window`, `max_window` (`lib/includes/ngtcp2/ngtcp2.h:1541`, `:1522`, `:1966`, `:1947`) | 2^62 − 1 (`ngtcp2.h:357`) | settable, as named |
| picoquic | `picoquic_set_default_tp` (`picoquic/picoquic.h:779`) | unchecked (`picoquic/quicctx.c:812–825`) | none (§ below) |
| Google QUICHE | `SetInitialStreamFlowControlWindowToSend` and the session one (`quiche/quic/core/quic_config.cc:772–777`) | no ceiling, 16 KiB floor (same lines); above **16 MiB** a debug build's check fails (`quic_flow_controller.cc:55`) | 16 MiB stream, 24 MiB session, constants (`quic_constants.h:90–92`); a client does not auto-tune (`quic_session.cc:184`) |
| neqo | `max_stream_data(UniDi, …)`, `max_data` (`neqo-transport/src/connection/params.rs:312`, `:286`) | the auto-tune cap below | **10 MiB stream, 20 MiB connection, constants** (`params.rs:83`, `:88`) |
| s2n-quic | `with_unidirectional_data_window`, `with_data_window` (`quic/s2n-quic-core/src/connection/limits.rs:174–212`) | 2^32 − 1 (same lines) | none: fixed |
| quic-go | `MaxStreamReceiveWindow`, `MaxConnectionReceiveWindow` (`interface.go:130–144`) | 2^62 − 1 (`config.go:36–40`) | settable, as named |
| lsquic | `es_init_max_stream_data_uni`, `es_init_max_data`; `es_max_sfcw`, `es_max_cfcw` (`include/lsquic.h:815–839`, `:551`, `:563`) | `unsigned` (same lines) | settable, off by default |
| mvfst | `advertisedInitialUniStreamFlowControlWindow`, `advertisedInitialConnectionFlowControlWindow` (`quic/state/TransportSettings.h:212–220`) | 2^62 − 1 (`quic/flowcontrol/QuicFlowController.cpp:24–25`) | settable (`TransportSettings.h:383`, `:390`) |

* **Every setting but two reaches 37.5 MB**: 2^32 − 1 B is 4.29 GB (D), and msquic's largest power of 2 under it is
  2^31 B, 2.1 GB (D). So **for nine of the eleven the window term never binds in the grid at their best** (D).
* **neqo's cap is a constant**: 10 MiB ÷ RTT, so it binds above 280 Mbit/s at 300 ms and above 559 at 150 ms (D:
  10 485 760 × 8 ÷ 0.3 s; ÷ 0.15 s).
* **Google QUICHE as a client** takes a window above 16 MiB only by tripping a debug-build check, so its clean best is
  16 MiB: above 447 Mbit/s at 300 ms and 895 at 150 ms (D: 16 777 216 × 8 ÷ 0.3 s; ÷ 0.15 s). The bare library's
  client never grows its window: auto-tuning is passed `perspective() == Perspective::IS_SERVER`
  (`quic_session.cc:184`). How Chromium wires its client was not re-read.
* **With one constant patched** (`MAX_LOCAL_MAX_STREAM_DATA` in neqo, `kStreamReceiveWindowLimit` in Google
  QUICHE), neither binds either (D). [`quic_grid.py`](quic_grid.py) prints both grids.

**Auto-tuning is the start of a stream, not its ceiling.** Where the window grows, it grows by the rule below; set the
first window to the BDP and the rule no longer matters for throughput.

| stack | grows when | by | source |
| --- | --- | --- | --- |
| msquic | a quarter of the window drains within about one smoothed RTT | × 2 | `src/core/stream_recv.c:785–786`, `:800`, `:809–811`, `:832`; ratio 4, `src/core/quicdef.h:355` |
| Cloudflare quiche | the last update went out less than 2 RTTs ago | × 2 | `quiche/src/flowcontrol.rs:117–118`, constants `:32`, `:36` |
| ngtcp2 | the same | × 2 | `lib/ngtcp2_conn.c:49`, `:52`, `:4039–4055` |
| picoquic | half the window is consumed | the limit rises by 2 × the previous window when the minimum RTT is ≤ 100 ms, otherwise by previous × min(RTT, 610 ms) ÷ 100 ms | `picoquic/frames.c:4579–4584`, `picoquic/cc_common.c:269–276` |
| Google QUICHE (server) | the last update went out less than 2 RTTs ago | × 2 | `quiche/quic/core/quic_flow_controller.cc:157`, `:186–188` |
| neqo | an update is due (a quarter of the window used) and more arrived than ¾ × window × elapsed ÷ RTT | + 4 × the excess | `neqo-transport/src/fc.rs:309`, `:416–421`, `:430–433`, `:46` |
| quic-go | more than half was read within 4 × 0.25 × RTT of the epoch's start | × 2 | `flow_controller_base.go:58`, `:67`, `:69`; `internal/protocol/params.go:31` |
| lsquic | the refresh came within 2 × srtt of the last | × 2 | `src/liblsquic/lsquic_sfcw.c:109`, `:49` |
| mvfst | the last update went out less than 2 × srtt ago | × 2 | `quic/flowcontrol/QuicFlowController.cpp:146–155` |

quinn and s2n-quic do not auto-tune: quinn's stream window is a constant derived for "100 Mbit/s at 100 ms"
(`quinn-proto/src/config/transport.rs:366–370`), s2n-quic's for 150 Mbit/s at 100 ms × 2
(`quic/s2n-quic-core/src/transport/parameters/mod.rs:634`).

### 3.2 The controller term, under random loss

A loss-based controller cuts its window at each congestion event, so its average window depends on how often loss
arrives. RFC 9438 §5.1 gives CUBIC's average window as `1.054 × RTT^0.75 ÷ p^0.75` segments (Figure 8, C = 0.4) and
Reno's in the same table; Reno's column is reproduced by `1.2 ÷ √p` (D, checked against Table 1 by
[`quic_grid.py`](quic_grid.py)). CUBIC uses the larger of the two (its Reno-friendly region, §5.1). Times
1 452 bytes per RTT, in Mbit/s (D; 1 452 B is [`quic.md`](quic.md) §7.1's payload per packet):

| p \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --: | --: | --: | --: | --: |
| 0.01 | 13.9 | 4.65 | 1.74 | 0.929 | 0.523 |
| 0.001 | 44.1 | 14.7 | 5.51 | 3.5 | 2.94 |
| 0.0001 | 139 | 46.5 | 23 | 19.7 | 16.5 |
| 1e-05 | 441 | 165 | 129 | 111 | 93 |
| 1e-06 | 1 394 | 930 | 728 | 622 | 523 |

* **It applies to every stack's CUBIC and Reno**: the formula is the controller's. A stack counts several losses in
  one RTT as one event, so under random loss read the table as an order of magnitude (D).
* **The controller is the sender's.** For a fill or an ask the server sends, so this term belongs to the server's
  stack; the client's stack changes it only for the ingest upload.
* **At its best, a stack runs a controller not bound by this table** (BBR below 2 % loss per round trip, §2), or
  this repository's own through a hook. What each ships, read at the pins:

| stack | controllers | default | an application's own controller |
| --- | --- | --- | --- |
| quinn | NewReno, CUBIC, BBR ("Experimental!", `quinn-proto/src/congestion/bbr/mod.rs:19`) | CUBIC (`config/transport.rs:400`) | **public**: `Controller`, `ControllerFactory` (`quinn-proto/src/congestion.rs:17`, `:100`) |
| msquic | CUBIC; BBR under `QUIC_API_ENABLE_PREVIEW_FEATURES` (`src/inc/msquic.h:527–533`) | CUBIC (`src/core/quicdef.h:525`) | none: a fixed switch (`src/core/congestion_control.c:29–43`) |
| Cloudflare quiche | Reno, CUBIC, BBR2 (`quiche/src/recovery/mod.rs:374–382`) | CUBIC (`lib.rs:654`) | none: `RecoveryOps` is in a private module (`recovery/mod.rs:189`, `lib.rs:9609`) |
| ngtcp2 | Reno, CUBIC, BBR (v2, `lib/includes/ngtcp2/ngtcp2.h:1745–1758`) | CUBIC (`lib/ngtcp2_settings.c:46`) | none: internal (`lib/ngtcp2_cc.h:208`, `lib/ngtcp2_conn.c:1436–1452`) |
| picoquic | NewReno, CUBIC, dcubic, fast, BBR (v3), BBRv1, Prague, C4 (`picoquic/register_all_cc_algorithms.c:42–49`; v3 at `bbr.c:104`) | NewReno (`picoquic/picoquic.h:1860`) | **public**: `picoquic_congestion_algorithm_t` (`picoquic.h:1850–1858`) with per-ACK state (`:1822–1838`) |
| Google QUICHE | CUBIC, Reno, BBR, BBRv2, BBRv3, Prague; PCC and GoogCC fall back to CUBIC and BBR (`quic/core/congestion_control/send_algorithm_interface.cc:34`, `:55–57`) | CUBIC (`quic_sent_packet_manager.cc:173`) | **public**: `SendAlgorithmInterface` (`send_algorithm_interface.h:32`) via `SetSendAlgorithm` (`quic_sent_packet_manager.h:473`) |
| neqo | NewReno, CUBIC (`neqo-transport/src/cc/mod.rs:106–111`) | CUBIC, classic slow start (`cc/mod.rs:116–124`) | none: private module (`neqo-transport/src/lib.rs:18`) |
| s2n-quic | CUBIC, BBR (`s2n-quic/src/provider/congestion_controller.rs:27`) | CUBIC (`:30`) | behind the `unstable-congestion-controller` feature (`:15–24`) |
| quic-go | Reno and CUBIC in one sender | **Reno** (`internal/ackhandler/sent_packet_handler.go:137`) | none: `internal/` |
| lsquic | CUBIC, BBRv1, adaptive (`include/lsquic.h:752–758`) | adaptive: CUBIC at RTT ≤ 1.5 ms, else BBRv1 (`:438`, `:441`) | none: `cong_ctl_if` is not in `include/` |
| mvfst | CUBIC, NewReno, Copa, BBR, BBR2, BBR2Modular, static (`quic/QuicConstants.h:520–532`) | CUBIC (`quic/state/TransportSettings.h:230–231`) | **public**: `CongestionControllerFactory` (`quic/congestion_control/CongestionControllerFactory.h:23`) |

**What separates the stacks here, at their best:** every server stack read ships a BBR except quic-go and neqo, and
four let this repository plug in its own controller without a fork. This is the term that binds first under loss at
any rate in the grid (the table above).

### 3.3 The CPU term

Published one-connection results are on server CPUs, all above 1 Gbit/s for the stacks that have one, so **CPU binds
nowhere in the grid on such hardware** (D). On a phone it is unknown for every stack.

| stack | one connection, CPU-bound | source |
| --- | --- | --- |
| msquic | 14.8–16.4 Gbit/s, docker, 0 ms | quinn issue #2262, 2025-08-12 comment (read live, [`quic.md`](quic.md) §8) |
| s2n-quic | 13.0 Gbit/s, same setup | same |
| quinn | 11.8–12.4 Gbit/s, same setup | same |
| lsquic | 3 004 Mbit/s, both ends lsquic, 10 Gbit/s link | Jaeger et al. 2023, Fig. 3 |
| Cloudflare quiche | 2 506 Mbit/s, same | same |
| picoquic | 1 530 Mbit/s, same | same |
| mvfst | 1 198 Mbit/s, same | same |
| quic-go | 1 043 Mbit/s, same | same |
| ngtcp2, Google QUICHE, neqo | none per stack read here | — |

The two sources' setups differ (#2262 ran tuned msquic against quinn at defaults, [`quic.md`](quic.md) §7.3), so
compare within a source, not across.

## 4. The other levers, at each stack's best

### 4.1 ACK policy and ACK frequency

The receiver's ACK policy is the client's lever; ACK_FREQUENCY lets the server's stack ask the client to change it.
Fewer ACKs save CPU on both ends; a shorter delay shortens the sender's loss timer (row 158).

| stack | ACK after | delay | either one settable | ACK_FREQUENCY codepoint · sends · obeys |
| --- | --- | --- | --- | --- |
| quinn | 2 packets (`quinn-proto/src/connection/spaces.rs:651`) | 25 ms (`transport_parameters.rs:60`) | no, but the peer's frame changes both | `0xFF04DE1B` (`transport_parameters.rs:646`) · when the application sets `AckFrequencyConfig` (`config/transport.rs:248`) · yes |
| msquic | 2 (`src/core/quicdef.h:118`) | 25 ms (`:647`) | delay: `MaxAckDelayMs` | `0xFF04DE1B` (`src/core/crypto_tls.c:66`) · when send-limited, asking for its batch + 1 (`src/core/send.c:1514–1521`) · yes (`connection.c:5351`) |
| Cloudflare quiche | every ack-eliciting packet the application next builds: no ACK timer (`quiche/src/lib.rs:4565–4566`, `:7094`) | advertises 25 ms (`transport_params.rs:211`) | `set_max_ack_delay` (`lib.rs:1069`) | none |
| ngtcp2 | 2 (`lib/ngtcp2_settings.c:48`) | min(25 ms, srtt ÷ 8) (`lib/ngtcp2_conn.c:1851–1854`) | both: `ack_thresh`, `max_ack_delay` | none |
| picoquic | 2 for the first 128 packets, then (packets in flight + 3) ÷ 4, from 2 to 32 (`picoquic/frames.c:4239–4240`, `:2900`, `:2902–2926`) | RTT ÷ 4, at most 10 ms (`frames.c:2936`, `:2942–2943`) | no (fork) | `0xff04de1b` (`picoquic/picoquic.h:255`) · yes (`sender.c:2655`) · yes (`frames.c:5487–5513`) |
| Google QUICHE | 2, then 10 after 100 packets (`quic_constants.h:297`, `:299`, `:303`) | min(25 ms, min RTT ÷ 4) after 100 packets (`quic_received_packet_manager.cc:262–264`) | through connection options and flags | `0xFF04DE1B` (`crypto/transport_parameters.cc:100`) · **never**: `peer_min_ack_delay_` is never set (`quic_sent_packet_manager.cc:144`, `:683–684`) · behind a feature flag, default off (`quiche/common/quiche_feature_flags_list.h:61`) |
| neqo | 2 (`neqo-transport/src/tracking.rs:170`, `:340`) | 20 ms (`tracking.rs:161`) | no | `0xff02de1a`, an older draft (`tparams.rs:62`) · yes, cwnd ÷ (4 × MTU) packets (`ackrate.rs:41`) · yes (`tracking.rs:251–255`) |
| s2n-quic | **10**, a local constant (`s2n-quic-transport/src/ack/ack_manager.rs:319`) | 25 ms (`transport/parameters/mod.rs:844`) | delay: `with_max_ack_delay` | none (`ack_manager.rs:317`) |
| quic-go | 2 (`internal/ackhandler/received_packet_tracker.go:79`) | 25 ms (`internal/protocol/params.go:144`) | no | `0xff04de1b` parsed (`internal/wire/transport_parameters.go:56`) · no · no (`connection.go:520`) |
| lsquic | 2 (`src/liblsquic/lsquic_full_conn_ietf.c:87`) | max(1 ms, min(25 ms, srtt ÷ 4)) (`:6975`) | no | `0xde1a` and `0xff02de1a` (`lsquic_enc_sess_ietf.c:659–662`) · yes, PID-tuned (`full_conn_ietf.c:4798–4895`) · yes (`:6607`, `:6612`) |
| mvfst | **10** (`quic/QuicConstants.h:622–626`) | min(25 ms, srtt ÷ 4), rounded up to whole ms (`quic/api/QuicTransportBaseLite.cpp:3484–3496`) | both: `rxPacketsBeforeAck*`, `ackTimerFactor` | `0xff04de1a` (`quic/handshake/TransportParameters.h:41`) · BBRv1 only (`congestion_control/Bbr.cpp:307`) · only if `minAckDelay` set (`TransportSettings.h:316`) |

* **Measured elsewhere:** Cloudflare quiche clients replied to 99.7–101.9 % of the packets they received, every other
  client 42–53 % (PEMI, Zhang et al. 2026, Table 1); the paper traces it to quiche's eliciting threshold of 1 (its
  Table 2).
* **What separates the stacks at their best:** whether our server can tune the client's ACKs. With quinn on the
  server sending at `0xFF04DE1B`, the clients that obey are quinn, msquic and picoquic, and Google QUICHE behind a
  flag (D, from the codepoints above). neqo and lsquic use older codepoints and mvfst a third, so they negotiate with
  none of those; ngtcp2, Cloudflare quiche and s2n-quic have none. Where a stack's own policy is a constant (s2n-quic's
  10, neqo's 20 ms, quic-go's 25 ms, picoquic's 10 ms cap), its best is a fork.

### 4.2 Socket buffer and batched I/O

CPU per byte and drops during a reader's stall; not the link's rate (§2). At its best every stack lets the
application set the socket buffer; what differs is batched receive.

| stack | socket buffer it asks for | batched receive at its best | GSO |
| --- | --- | --- | --- |
| quinn | the application's | `recvmmsg` × 32 (`quinn-udp/src/unix.rs:806`) and GRO (`:129`), Linux | yes; 10 segments a call, a constant (`quinn/src/connection.rs:1350`) |
| msquic | `INT32_MAX` (`src/platform/datapath_epoll.c:702`) | `recvmmsg` × 53, or GRO after a self-test (`src/platform/datapath_linux.h:25`, `datapath_linux.c:181`) | after the same self-test (`datapath_linux.c:153`) |
| Cloudflare quiche | the application's | tokio-quiche: GRO (`tokio-quiche/src/socket/capabilities.rs:220–226`), Linux | tokio-quiche (`capabilities.rs:179`) |
| ngtcp2 | the application's | the application's (the examples: GRO, `examples/shared.h:121`) | `ngtcp2_conn_write_aggregate_pkt` (`ngtcp2.h:6957–6995`) |
| picoquic | set only if asked (`picoquic/sockloop.c:496`) | `sockloop.c` reads one datagram a call, no GRO; an application's own loop can batch | `sockloop.c:2629–2630` |
| Google QUICHE | 1 MiB (`quic_constants.h:100`) | `recvmmsg` × 16 (`quic_packet_reader.h:21`); GRO parsed but never enabled (`quic_udp_socket_posix.inc:94–96`) | a writer exists (`quic_gso_batch_writer.h:58`), not the default |
| neqo | the application's (1 MiB in its demo binary, `neqo-bin/src/udp.rs:31`) | GRO through quinn-udp; 16 buffers on Apple (`neqo-udp/src/lib.rs:46`, `:49`) | through quinn-udp (`lib.rs:277–278`) |
| s2n-quic | set only if asked (`s2n-quic-platform/src/io/tokio/builder.rs:86`) | `recvmmsg` and GRO, Linux only (`io/tokio.rs:157`, `build.rs:93–95`) | 10 segments, at most 64 (`features/gso.rs:95–96`, `:86`), Linux only |
| quic-go | 7 MiB (`sys_conn_buffers_nonopenbsd.go:5`) | `recvmmsg` × 8 on Linux, 1 on macOS (`sys_conn_helper_linux.go:24`); **no GRO** | Linux (`sys_conn_helper_linux.go:66–76`) |
| lsquic | the application's | the application's | the application's (`ea_packets_out`) |
| mvfst | the application's | GRO and `recvmmsg` × 5 when set (`quic/state/TransportSettings.h:240`, `:337`, `:341`) | `batchingMode` (`TransportSettings.h:293`) |

**What separates them at their best:** only CPU per byte. GRO needs a patch in quic-go and Google QUICHE, and an application's own receive loop in picoquic. On Apple, quinn
reads one datagram per call (`quinn-udp/src/unix.rs:809`) unless built with `fast-apple-datapath`
(`quinn-udp/Cargo.toml:21`).

### 4.3 Pacing

The sender's lever: burst loss on shallow queues. At its best every stack paces, but one:

| stack | at its best | rate · burst |
| --- | --- | --- |
| quinn | always (`quinn-proto/src/connection/pacing.rs`) | 1.25 × cwnd ÷ srtt (`:92`) · cwnd × 2 ms ÷ srtt, 10–256 packets (`:145–151`) |
| msquic | on (`src/core/quicdef.h:406`, `PacingEnabled`) | 1.25 × cwnd ÷ srtt, 2 × in slow start (`src/core/cubic.c:223–236`) · 1 ms timer (`quicdef.h:416`) |
| Cloudflare quiche | **BBR2 only**: CUBIC and Reno release every packet at once (`quiche/src/recovery/congestion/recovery.rs:1087–1091`) | BBR2's pacer, initial burst 10 (`recovery/gcongestion/pacer.rs:59`) |
| ngtcp2 | computed always, honoured by the application (`ngtcp2.h:6862`) | 1.25 × cwnd ÷ srtt (`lib/ngtcp2_cc.c:45`, `:61–65`) |
| picoquic | always | cwnd ÷ RTT, × 1.25 in slow start (`picoquic/pacing.c:210`, `:235–236`) · cwnd ÷ 4, 2–16 packets (`:211–230`) |
| Google QUICHE | on (`quic_sent_packet_manager.cc:206`) | 1.25 × cwnd ÷ srtt, 2 × in slow start (`tcp_cubic_sender_bytes.cc:175`) · first 10 unpaced (`pacing_sender.cc:19`) |
| neqo | on (`neqo-transport/src/connection/params.rs:203`) | 2 × cwnd ÷ RTT (`pace.rs:52`) · 2 packets (`sender.rs:29`) |
| s2n-quic | always (`recovery/cubic.rs:151`) | 1.25 × cwnd ÷ RTT, 2 × in slow start (`recovery/pacing.rs:16`, `:22`) · 10 packets (`recovery/mod.rs:41`) |
| quic-go | always | 1.25 × bandwidth (`internal/congestion/pacer.go:31`) · **at least** 10 packets (`pacer.go:11`, `:64–68`) |
| lsquic | on (`include/lsquic.h:381`) | 1.25 × cwnd ÷ srtt, 2 × in slow start (`src/liblsquic/lsquic_cubic.c:270–275`) · 10 (`lsquic_pacer.c:32`) |
| mvfst | when `pacingEnabled` (`quic/state/TransportSettings.h:260`) | cwnd ÷ RTT in 1 ms ticks, at least 5 packets (`CongestionControlFunctions.cpp:37–53`, `QuicConstants.h:492`, `:500`) |

* **Published, at defaults, 40 Mbit/s and 40 ms, a 2-BDP queue:** about half of all packets left back to back for
  quiche, picoquic and ngtcp2 (Kempf et al. 2025, §4.1), and drops were 687, 861 and 503 per 100 MiB against TCP's
  16.5 (Table 1). quiche "does not pace packets but relies on a suitable qdisc" (§4.1); with the FQ qdisc its drops
  rose to 1 022, which the authors trace to repeated congestion-window rollbacks (§4.2). ngtcp2 reached 15.93 Mbit/s
  against 34.67–37.37 for the others (Table 1); why was not read.
* **What separates them at their best:** Cloudflare quiche, unless it runs BBR2. The burst sizes differ (2 to 256
  packets), but no source here prices that difference.

### 4.4 Initial window

The sender's lever: how many round trips a fill spends in slow start. At its best it is a setting in six stacks and a
constant in five:

| setting (default) | constant |
| --- | --- |
| quinn: `CubicConfig::initial_window` (12 000 B, `quinn-proto/src/congestion/cubic.rs:257`, `:266`) | ngtcp2: RFC 9002's formula (`lib/ngtcp2_cc.c:38–40`) |
| msquic: `InitialWindowPackets` (10, `src/core/quicdef.h:48`) | picoquic: 15 360 B (`picoquic/picoquic_internal.h:92`) |
| Cloudflare quiche: `set_initial_congestion_window_packets` (10, `quiche/src/lib.rs:496`, `:1133`) | neqo: RFC 9002's formula (`cc/classic_cc.rs:29`, `:617`) |
| Google QUICHE: connection options IW03–IW50 (32, `quic_constants.h:73`; `quic_sent_packet_manager.cc:176–199`) | quic-go: 32 packets (`internal/congestion/cubic_sender.go:20`) |
| s2n-quic: `with_initial_congestion_window` (RFC 9002's formula, `recovery/cubic.rs:536–541`, `:912`) | lsquic: 32 × 1 460 B (`src/liblsquic/lsquic_cubic.c:47`) |
| mvfst: `initCwndInMss` (10, `quic/QuicConstants.h:540`) | |

It sets latency more than throughput: row 158.

### 4.5 Migration

| client probes the new path first | client rebinds without a probe | no client API |
| --- | --- | --- |
| Cloudflare quiche `probe_path`, `migrate` (`quiche/src/lib.rs:7238`, `:7280`); ngtcp2 `ngtcp2_conn_initiate_migration` (`ngtcp2.h:6152`); picoquic `picoquic_probe_new_path` (`picoquic.h:1170`); Google QUICHE `ValidatePath`, `MigratePath` and a migration manager (`quic_connection.h:1352`, `:1379`; `http/quic_connection_migration_manager.h:169`); neqo `migrate` (`connection/mod.rs:2118`); quic-go `AddPath` → `Probe` → `Switch` (`connection.go:3101`, `path_manager_outgoing.go:38`, `:70`); mvfst `startPathProbe`, `migrateConnection` (`quic/client/QuicClientTransportLite.h:193`, `:199`) | quinn `Endpoint::rebind` (`quinn/src/endpoint.rs:243`); msquic `QUIC_PARAM_CONN_LOCAL_ADDRESS`, then a PING (`src/core/connection.c:6435`, `:6531`) | s2n-quic (server side only, `limits.rs:331`); lsquic (only to a server's preferred address, `full_conn_ietf.c:3360–3452`) |

What a migration costs in time is row 158's.

### 4.6 0-RTT

At its best every stack resumes in 0-RTT except two: **s2n-quic drops received 0-RTT packets**
(`s2n-quic-transport/src/connection/connection_impl.rs:1996–2024`, "FIXME"), and **msquic has none on Schannel**
(`src/platform/tls_schannel.c:1603`), only on its OpenSSL builds (`tls_openssl.c:1914`). mvfst's client needs
`attemptEarlyData` (off, `quic/state/TransportSettings.h:279`). Each of the rest: quinn `into_0rtt`
(`quinn/src/connection.rs:126`); Cloudflare quiche `enable_early_data` (`lib.rs:836`); ngtcp2 (`ngtcp2.h:4881`);
picoquic on by default (`picoquic/tls_api.c:2761–2769`); Google QUICHE on by default
(`quic_crypto_client_config.cc:84–85`); neqo `enable_resumption` (`connection/mod.rs:777`); quic-go `DialEarly`
(`client.go:65`); lsquic `sess_resume` (`include/lsquic.h:1548–1556`).

### 4.7 Multipath

Only **picoquic** at its pin, at draft-20's transport parameter `0x3e` (`picoquic/picoquic.h:260`), off until
`picoquic_set_default_multipath_option` (`quicctx.c:956–963`). quinn's fork noq-proto 1.3.0 carries it too
([`quic.md`](quic.md) §2). None of the other ten has it.

### 4.8 WebTransport, for the server's browser side

| stack | WebTransport | source |
| --- | --- | --- |
| quinn | client and server, released: wtransport 0.7.2 (today's server), web-transport-quinn 0.13.2 | [`quic.md`](quic.md) §8 |
| neqo | client and server, the server experimental | `neqo-http3/src/conn_params.rs:104`, `webtransport.rs:147`, `:402` |
| picoquic | client and server in tree (picowt) | `picohttp/pico_webtransport.h:66` |
| Google QUICHE | a client (`WebTransportOnlyClient`) and server code, unreleased | `quiche/quic/tools/web_transport_only_client.h:40` |
| lsquic | server only, behind a build flag, off by default | `include/lsquic.h:1197`, `:1203` |
| quic-go | through webtransport-go v0.13.0, client and server | [`quic.md`](quic.md) §8 |
| msquic, Cloudflare quiche, ngtcp2, s2n-quic, mvfst | none at the pins (§10) | ngtcp2's is on unreleased branches ([`quic.md`](quic.md) §8) |

## 5. Each stack at its best

What each is, its best configuration, and what still separates it. "Fork" means changing a constant in its source.

* **quinn** — a pure-Rust QUIC on tokio, community-maintained; today's server. **Best:** windows set to the BDP;
  `AckFrequencyConfig` on, to tune its peer; BBR or this repository's controllers through the public hook; GRO on Linux.
  **Still separating:** pacing always on; the GSO constant (10 segments, patched here, §9); a rebind without a probe;
  no multipath outside the noq fork. **As our client:** the server's own crate; obeys ACK_FREQUENCY. **As our
  server:** the only stack with a released WebTransport server, a public hook and raw QUIC on one endpoint today.
* **msquic** — Microsoft's C library with its own worker threads. **Best:** `StreamRecvWindowUnidiDefault` and
  `ConnFlowControlWindow` up to 2^31 B; pacing on; it sends and obeys ACK_FREQUENCY. **Still separating:** no
  controller hook; 0-RTT on OpenSSL builds only; a rebind without a probe; no WebTransport; the fastest published
  single connection (§3.3).
* **Cloudflare quiche** — a sans-I/O Rust library under Cloudflare's edge; tokio-quiche wraps it. **Best:** all four
  windows and both caps set; BBR2 for pacing; GRO and GSO through tokio-quiche on Linux. **Still separating:** it
  acknowledges every packet (PEMI Table 1), unchangeable without a fork; CUBIC unpaced; no ACK_FREQUENCY, no hook, no
  WebTransport.
* **ngtcp2** — a sans-I/O C library; the application owns I/O, batching and pacing timers. **Best:** windows and
  auto-tune caps set; `ack_thresh` and `max_ack_delay` set; a probed migration. **Still separating:** no
  ACK_FREQUENCY, no hook, a constant initial window; the one published in-range shortfall (Kempf et al., Table 1).
* **picoquic** — a research-driven C library, one thread per context. **Best:** windows already grow without a cap;
  ACK_FREQUENCY both ways; the richest controller hook; multipath at draft-20 once enabled. **Still separating:** its
  own loop reads one datagram a call, no GRO; ACK constants and initial window are forks; date tags, no releases.
* **Google QUICHE** — Google's C++ stack, inside Chromium and Google's servers. **Best:** windows up to 16 MiB as a
  client (§3.1); BBRv3 or this repository's controller through `SendAlgorithmInterface`. **Still separating:** a
  client that never auto-tunes; never sends ACK_FREQUENCY; GRO and GSO not on by default; no releases, no C API.
* **neqo** — Firefox's Rust stack. **Best:** windows up to its 10 MiB constant (§3.1); probed migration; WebTransport
  both ways. **Still separating:** the window cap; an older ACK_FREQUENCY codepoint; no hook, no BBR; not on
  crates.io.
* **s2n-quic** — AWS's Rust stack on tokio. **Best:** windows up to 4.29 GB; BBR; GRO and GSO on Linux. **Still
  separating:** ACK every 10th packet (a constant); 0-RTT packets dropped; no client migration; hook only behind an
  unstable feature; no batching off Linux.
* **quic-go** — a Go stack with goroutines. **Best:** windows and caps set; probed migration; 0-RTT. **Still
  separating:** no GRO; Reno by default, no BBR, no hook; never acts on ACK_FREQUENCY; a Go runtime inside the app.
* **lsquic** — LiteSpeed's C engine. **Best:** `es_init_max_stream_data_uni` and the caps set; pacing on.
  **Still separating:** no client migration API; ACK constants; no hook; a WebTransport server behind a build flag.
* **mvfst** — Meta's C++ stack. **Best:** windows, ACK count and delay, pacing, GRO and batching all settings;
  public hook. **Still separating:** its ACK_FREQUENCY codepoint matches no other stack read; no WebTransport.

[`quic.md`](quic.md) §2 holds platforms, builds, security records and licences, and the four stacks read briefly
(Apple's Network.framework, Cronet, xquic, tquic).

## 6. Defaults: what you would change, and how

The client's receive window for a server-opened unidirectional stream at defaults, its ceiling (D, window ÷ RTT,
[`quic_grid.py`](quic_grid.py)), and the change that removes it from the grid.

| stack | default uni-stream window → auto-tune cap | ceiling at 80 ms · 300 ms | change, and how |
| --- | --- | --- | --- |
| quinn | 1.25 MB, fixed (`config/transport.rs:370`, `:377`) | 125 · 33.3 Mbit/s | `stream_receive_window` (setting) |
| msquic | 64 KiB (`src/core/settings.c:105–106`) → 16 MiB (`quicdef.h:253`) | 6.55 → 1 678 · 1.75 → 447 | `StreamRecvWindowUnidiDefault` (setting) |
| Cloudflare quiche | 0 in the library (`transport_params.rs:204`); tokio-quiche 1 MB (`tokio-quiche/src/settings/quic.rs:91`, `:399–400`) → 16 MiB | 100 → 1 678 · 26.7 → 447 | `set_initial_max_stream_data_uni`, `set_max_stream_window` (settings) |
| ngtcp2 | 0 in the library (`lib/ngtcp2_transport_params.c:48`); the example client 16 MiB (`examples/client_base.h:132`) | 1 678 · 447 | `initial_max_stream_data_uni` (setting) |
| picoquic | 65 535 B (`picoquic/quicctx.c:1418`) → no cap | 6.55 at the start · then none | `picoquic_set_default_tp` (setting) |
| Google QUICHE | 16 KiB (`quic_config.cc:1053–1054`, `quic_constants.h:83–87`), a client never grows it | 1.64 · 0.437 | `SetInitialStreamFlowControlWindowToSend` (setting); above 16 MiB, `kStreamReceiveWindowLimit` (patch) |
| neqo | 1 MiB (`params.rs:60`, `:193`) → 10 MiB (`:83`) | 105 → 1 049 · 28 → 280 | `max_stream_data` (setting); above 10 MiB, `MAX_LOCAL_MAX_STREAM_DATA` (patch) |
| s2n-quic | 3.75 MB, fixed (`parameters/mod.rs:634`, `:692`) | 375 · 100 | `with_unidirectional_data_window` (setting) |
| quic-go | 512 KiB → 6 MiB (`internal/protocol/params.go:19`, `:25`) | 52.4 → 629 · 14 → 168 | `InitialStreamReceiveWindow`, `MaxStreamReceiveWindow` (settings) |
| lsquic | client 32 KiB, auto-tune off (`include/lsquic.h:304`; `es_max_sfcw` 0, `include/lsquic.h:543`, `src/liblsquic/lsquic_engine.c:306`) | 3.28 · 0.874 | `es_init_max_stream_data_uni` (setting) |
| mvfst | 66 560 B, auto-tune off (`quic/QuicConstants.h:591`; `TransportSettings.h:219–220`, `:388`) | 6.66 · 1.77 | `advertisedInitialUniStreamFlowControlWindow` (setting) |

The other defaults worth changing, and how (sources in §4):

| stack | default | change, and how |
| --- | --- | --- |
| quinn | ACK_FREQUENCY off; GSO 10 segments | `AckFrequencyConfig` (setting); `MAX_TRANSMIT_SEGMENTS` (patch, carried here) |
| msquic | BBR in preview only | build with preview features (build flag) |
| Cloudflare quiche | CUBIC unpaced | `set_cc_algorithm` to BBR2 (setting) |
| picoquic | NewReno; multipath off | `picoquic_set_default_congestion_algorithm`, `picoquic_set_default_multipath_option` (settings) |
| Google QUICHE | ACK_FREQUENCY receive off; no GRO | the feature flag (setting); `setsockopt(UDP_GRO)` (patch) |
| neqo | classic slow start | `slow_start` (setting) |
| s2n-quic | ACK every 10th | `packet_tolerance` (fork) |
| quic-go | Reno | none: CUBIC is not exposed as a setting (fork) |
| mvfst | pacing off; ACK every 10th; GRO off; client 0-RTT off | `pacingEnabled`, `rxPacketsBeforeAck*`, `numGROBuffers_`, `attemptEarlyData` (settings) |

## 7. Raw QUIC for the native client: what it changes

Rows 124 and 127 assumed a WebTransport native client and quinn on the server; each premise is re-read here.

* **"quinn alone … speaks to the server unchanged" no longer separates the stacks.** On raw QUIC no client speaks to
  today's server unchanged: the server must also accept our ALPN. [`quic.md`](quic.md) §4 read that wtransport can
  take a session from a quinn connection the server already holds, so one endpoint could route `h3` to wtransport and
  our ALPN to a raw handler (read from the API, not built; a wire change, proposed not built). After it every stack but
  Cronet can be our client ([`quic.md`](quic.md) §2).
* **What quinn keeps as a client:** the server's own crate, so the wire's framing and exactness code is one Rust
  crate on both ends; the only measured native receive cost (§9); ACK_FREQUENCY at the current codepoint — shared
  with msquic and picoquic (§4.1); 0-RTT on raw QUIC without patching wtransport, which exposes none
  ([`quic.md`](quic.md) §7.1).
* **What raw QUIC opens.** Apple's Network.framework becomes a possible iOS client ([`quic.md`](quic.md) §2), and
  the probe-then-migrate clients of §4.5 lose nothing by lacking WebTransport.
* **What the server then needs, as one stack** (§3.2, §4.8):

  | stack | WebTransport server | controller hook | all three |
  | --- | --- | --- | --- |
  | quinn | released | public | **yes, today** |
  | Google QUICHE | unreleased | public | yes, unreleased |
  | picoquic | in tree, date tags | public | yes, date tags |
  | neqo | experimental | none | no |
  | mvfst | none | public | no |
  | lsquic | behind a build flag | none | no |
  | quic-go | webtransport-go | none | no |
  | msquic, Cloudflare quiche, ngtcp2, s2n-quic | none | none or unstable | no |

* **The band assumption, examined.** Row 127 predicted a native client would tie the browser on fill time in the
  assumed band. §3 says why it can at every rate and RTT in the grid once the window is set; it stops being true only
  where the server's controller meets random loss (§3.2), which no client stack changes.

## 8. Latency, at each stack's best

*Row 158, QUICLATENCY, 2026-10-13. Theory only. Each term as a formula over RTT, loss and rate, with its mechanism and
which end's stack owns it; [`quic_latency.py`](quic_latency.py) prints every table (D). The frame is one 512² 16-bit
slice, F = 524 288 B (D: 512 × 512 × 2), uncompressed, so an upper bound for a coded frame of that size.*

**Who owns each term.** The server sends the frames, so it owns the sender's terms: the initial window and slow start,
pacing, loss detection and the probe timeout, and the controller under loss. The client's stack owns only what a
receiver decides: how quickly it acknowledges (which enters the server's probe timeout), whether it resumes in 0-RTT,
its own handshake timer, how it delivers stream bytes to the application, its receive CPU, and how it migrates. No
client stack can shorten a server-side term.

### 8.1 Time to the first frame

```
T_first = H × RTT + RTT + T_xfer(F)        H = 1 on a fresh connection, 0 with 0-RTT and an address token
T_xfer  = one RTT per slow-start round while the window is below both the rest of F and the BDP, then rest ÷ rate
```

* **H = 1**: QUIC carries the TLS 1.3 handshake in its first round trip (RFC 9001 §4), so the ask leaves after one
  RTT. **H = 0 with 0-RTT**: the ask rides the first flight (RFC 9001 §4.6). But a server may send only three times
  what it received to an address it has not validated (RFC 9000 §8.1), so beyond that the response waits for the
  handshake anyway; only an address token from an earlier connection (`NEW_TOKEN`, RFC 9000 §8.1.3) lifts the limit at
  once. **0-RTT saves the whole RTT only with a token** (D).
* **On our raw-QUIC ALPN** 0-RTT needs a ticket from an earlier connection on the same ALPN: a server rejects early
  data under another (RFC 8446 §4.2.10). The ask is a read, so replaying it is harmless (RFC 9001 §4.6's condition).
  On the server, quinn accepts 0-RTT ([`quic.md`](quic.md) §7.1) and sends tokens only when `ValidationTokenConfig::sent`
  is set: 0 by default without the `bloom` feature (`quinn-proto/src/config/mod.rs:518`, `:533`). Clients with a
  token store: quinn (`ClientConfig::token_store`, `quinn-proto/src/config/mod.rs:609`) and quic-go (`TokenStore`,
  `interface.go:42`); the others' were not read. 0-RTT per stack is §4.6.
* **T_xfer** doubles the window per RTT in slow start (RFC 9002 §7.3.1) from the server's initial window (§4.4).
  With quinn's 12 000 B (`quinn-proto/src/congestion/cubic.rs:266`), in ms (D):

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --: | --: | --: | --: | --: |
| 1 Mbit/s | 4 214 | 4 254 | 4 354 | 4 548 | 5 106 |
| 5 Mbit/s | 859 | 910 | 1 104 | 1 454 | 2 351 |
| 10 Mbit/s | 440 | 511 | 755 | 1 175 | 2 222 |
| 50 Mbit/s | 120 | 235 | 584 | 1 074 | 2 124 |
| 100 Mbit/s | 87.5 | 222 | 572 | 1 062 | 2 112 |
| 500 Mbit/s | 72.4 | 212 | 562 | 1 052 | 2 102 |
| 1000 Mbit/s | 71.2 | 211 | 561 | 1 051 | 2 101 |

  0-RTT with a token takes one RTT off every cell (D). Above about 50 Mbit/s the cells are almost flat in rate: slow
  start, not the link, sets the time, so the server's initial window is the lever (§4.4), not the client's stack.
* **A lost first flight** waits the handshake's probe timeout, `smoothed_rtt + 4 × rttvar` with `smoothed_rtt` = the
  initial RTT, `rttvar` = half of it and no ack delay (RFC 9002 §5.3, §6.2.1): **3 × the initial RTT**, "a PTO of 1
  second" at the RFC's 333 ms (§6.2.2). The client's initial RTT therefore sets how long its lost Initial waits:
  * 50 ms → 150 ms: mvfst (`quic/QuicConstants.h:472`), settable;
  * 100 ms → 300 ms: Google QUICHE (`quic_constants.h:284`), settable within 10 ms–1 s (`quic_sent_packet_manager.cc:1574–1580`); neqo (`neqo-transport/src/rtt.rs:26`), settable; quic-go (`internal/utils/rtt_stats.go:18`), not settable;
  * 250 ms → 750 ms: picoquic (`picoquic/picoquic_internal.h:57`), a constant;
  * 333 ms → 999 ms: quinn (`quinn-proto/src/config/transport.rs:384`), msquic (`src/core/quicdef.h:30`), Cloudflare
    quiche (`quiche/src/lib.rs:446`), ngtcp2 (`ngtcp2.h:439`), s2n-quic (`quic/s2n-quic-core/src/recovery/rtt_estimator.rs:17`), all
    settable; lsquic (`src/liblsquic/lsquic_send_ctl.c:71`), a constant.

  At its best a client resumes with the previous connection's smoothed RTT (RFC 9002 §6.2.2 allows it); which stacks
  do was not read. A lower initial RTT on a long path fires spurious probes: it is a bet on the path.

### 8.2 An ask

**On a warm connection, clean link** (the window already covers F):

```
T_ask = RTT + F ÷ rate
```

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --: | --: | --: | --: | --: |
| 1 Mbit/s | 4 204 | 4 224 | 4 274 | 4 344 | 4 494 |
| 5 Mbit/s | 849 | 869 | 919 | 989 | 1 139 |
| 10 Mbit/s | 429 | 449 | 499 | 569 | 719 |
| 50 Mbit/s | 93.9 | 114 | 164 | 234 | 384 |
| 100 Mbit/s | 51.9 | 71.9 | 122 | 192 | 342 |
| 500 Mbit/s | 18.4 | 38.4 | 88.4 | 158 | 308 |
| 1000 Mbit/s | 14.2 | 34.2 | 84.2 | 154 | 304 |

**During a fill on the shared stream** the ask waits behind what of the fill is already written and undelivered
(measured, [`../WIRE.md`](../WIRE.md) §The send path: "the ask waits for the send window to drain"):

```
ΔT_fill ≈ min(the client's stream window, the server's send window, its congestion window) ÷ rate
```

* This is where **the window's best for throughput and its best for latency part**. A window far above the BDP lets
  the fill queue more ahead of the ask. quinn's server-side send window defaults to 10 MB (8 × 1.25 MB,
  `quinn-proto/src/config/transport.rs:379`): 1.68 s at 50 Mbit/s (D: 10 000 000 × 8 ÷ 50 × 10⁶). A client window
  of about one BDP keeps the queue to about one RTT (D). An auto-tuned window that grows only while the reader keeps
  pace (§3.1) approximates that by itself; a fixed window set to the grid's 37.5 MB does not.
* Which of the three binds is a server setting and the client's window together; the client's stack only sets its own
  window.

**Under random loss p**, a lost packet is detected when three later packets are acknowledged (RFC 9002 §6.1.1) or
9/8 × max(smoothed RTT, latest RTT) after it was sent (§6.1.2); the receiver acknowledges at once when it sees a gap
(RFC 9000 §13.2.1). A loss early in the frame is repaired before the frame ends. What delays the frame:

```
the last packet lost:                 + PTO = srtt + max(4 × rttvar, 1 ms) + max_ack_delay     (RFC 9002 §6.2.1)
a loss among the last RTT's packets:  + 9/8 × RTT
E[ΔT_loss] ≈ p × PTO + (1 − p) × (1 − (1 − p)^m) × 9/8 × RTT,   m = min(packets in F − 1, rate × RTT ÷ 1 452 B)
```

At p = 1e-3, ms (D; max_ack_delay 25 ms):

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --: | --: | --: | --: | --: |
| 1 Mbit/s | 0.036 | 0.123 | 0.644 | 2.19 | 8.65 |
| 5 Mbit/s | 0.0809 | 0.458 | 3.11 | 10.6 | 41.2 |
| 10 Mbit/s | 0.126 | 0.889 | 6.02 | 20.6 | 77 |
| 50 Mbit/s | 0.509 | 4.14 | 26.3 | 51.3 | 103 |
| 100 Mbit/s | 0.963 | 7.73 | 27.4 | 51.3 | 103 |
| 500 Mbit/s | 3.44 | 10.3 | 27.4 | 51.3 | 103 |
| 1000 Mbit/s | 3.44 | 10.3 | 27.4 | 51.3 | 103 |

At p = 1e-2:

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --: | --: | --: | --: | --: |
| 1 Mbit/s | 0.36 | 1.22 | 6.27 | 20.7 | 77.5 |
| 5 Mbit/s | 0.799 | 4.36 | 26.8 | 81 | 246 |
| 10 Mbit/s | 1.22 | 7.98 | 45.2 | 123 | 312 |
| 50 Mbit/s | 4.27 | 24.8 | 87.4 | 164 | 329 |
| 100 Mbit/s | 6.8 | 31.5 | 87.8 | 164 | 329 |
| 500 Mbit/s | 11.2 | 33.1 | 87.8 | 164 | 329 |
| 1000 Mbit/s | 11.2 | 33.1 | 87.8 | 164 | 329 |

* **The client's only lever here is the `max_ack_delay` inside PTO**, and only for a lost last packet. The server can
  lower it with ACK_FREQUENCY down to the client's `min_ack_delay`, where the client obeys (§4.1): quinn advertises
  1 ms (`quinn-proto/src/transport_parameters.rs:174–176`, `lib.rs:334`), picoquic 1 ms
  (`picoquic/picoquic_internal.h:66`), msquic its timer resolution (`src/core/connection.c:2361–2364`). PTO after the
  handshake (rttvar → 0 on a steady path), ms (D):

| max_ack_delay \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --: | --: | --: | --: | --: |
| 26 ms | 37 | 57 | 107 | 177 | 327 |
| 25 ms | 36 | 56 | 106 | 176 | 326 |
| 20 ms | 31 | 51 | 101 | 171 | 321 |
| 10 ms | 21 | 41 | 91 | 161 | 311 |
| 1 ms | 12 | 32 | 82 | 152 | 302 |

  So a lost last packet costs 24 ms less with ACK_FREQUENCY (25 → 1 ms, D); averaged over asks that is p × 24 ms,
  0.24 ms at 1 % (D). Its value is in the tail, not the mean.
* **The server's levers dominate.** quinn's packet and time thresholds are settings (`packet_threshold`,
  `time_threshold`, `quinn-proto/src/config/transport.rs:164`, `:171`). Under loss, a CUBIC sender's rate falls to
  §3.2's bound, and that sets the ask (D: RTT + F ÷ min(link, CUBIC's rate) + E[ΔT_loss], at p = 1e-2):

| link \ RTT | 10 ms | 30 ms | 80 ms | 150 ms | 300 ms |
| --- | --: | --: | --: | --: | --: |
| 1 Mbit/s | 4 205 | 4 226 | 4 281 | 4 684 | 8 395 |
| 5 Mbit/s | 850 | 937 | 2 514 | 4 745 | 8 564 |
| 10 Mbit/s | 431 | 941 | 2 532 | 4 787 | 8 630 |
| 50 Mbit/s | 315 | 958 | 2 575 | 4 828 | 8 646 |
| 100 Mbit/s | 318 | 964 | 2 575 | 4 828 | 8 646 |
| 500 Mbit/s | 322 | 966 | 2 575 | 4 828 | 8 646 |
| 1000 Mbit/s | 322 | 966 | 2 575 | 4 828 | 8 646 |

  A sender not bound by the loss formula (BBR under 2 % per round trip, §2) stays near the clean table plus
  E[ΔT_loss]; that is the server's controller, §3.2.

### 8.3 Head-of-line blocking

* **Between streams: none.** Each stream is ordered on its own (RFC 9000 §2.2), so a loss on one stream holds no other.
* **Within one stream:** a lost packet holds every later byte of that stream until it is repaired, about 9/8 × RTT
  after the loss, or a PTO for a lost last packet (§8.2, D). In the default `shared` mode every frame behind the gap
  waits; in `per-frame` mode only the frame with the gap does ([`../WIRE.md`](../WIRE.md), the stream modes;
  [`../adr/stream-shape.md`](../adr/stream-shape.md) prices it). That choice is the server's.
* **The client's lever: out-of-order delivery** (RFC 9000 §2.2 allows it). quinn's `read_chunk(…, ordered: false)`
  (`quinn/src/recv_stream.rs:172–176`) and picoquic's direct receive (`picoquic/picoquic.h:1450–1470`) hand bytes
  over as they arrive; a search of the other public APIs found none. On the `shared` stream it helps only if the
  client can find envelope boundaries past a gap, which the wire's length-prefixed envelopes do not allow
  ([`../WIRE.md`](../WIRE.md)); with `per-frame` streams it is not needed (D).

### 8.4 Receive CPU per frame

**Measured here (row 135):** quinn 2.05–2.16 ms of CPU per MB with GRO. For F that is 1.1 ms of CPU per frame (D:
0.524 MB × 2.1 ms). It reaches latency two ways:
* **after the last byte**, only the last datagram's share: 2.16 ms/MB × 1 452 B ≈ 3 µs (D);
* **as queueing**, when receive work approaches a whole core: 1 ÷ 2.16 ms per MB = 463 MB/s, about 3.7 Gbit/s on that
  host (D), far above the grid. At 50 Mbit/s it is 6.25 MB/s × 2.16 ms = 1.35 % of a core (D), as measured (≤ 0.05
  cores, §9).

No other stack's receive cost was measured here; on a phone it is unknown for every stack, and §3.3's published
rates are whole-connection, both-ends costs, not a client's per frame.

### 8.5 Migration

```
probe, then switch:   ΔT ≈ T_detect + RTT_new (PATH_CHALLENGE → PATH_RESPONSE, RFC 9000 §8.2) + T_xfer from the initial window
rebind:               ΔT ≈ T_detect + RTT_new (the server validates the new address, sending ≤ 3× what it received until then, RFC 9000 §9.3.1, §8) + T_xfer from the initial window
re-dial:              ΔT ≈ T_detect + 2 × RTT_new + T_xfer   (1 × RTT_new with 0-RTT and a token, §8.1)
```

* Both migrations restart the congestion controller and RTT estimator unless only the port changed (RFC 9000 §9.4),
  so both pay slow start again (D). **They cost about the same time**; probing first protects against moving onto a
  path that does not work, which a rebind discovers only through a probe timeout (D).
* **Migration saves one RTT over a plain re-dial and about nothing over a 0-RTT re-dial with a token** (D, from the
  three lines above).
* **T_detect** is the client's: an OS signal where the stack takes one (Google QUICHE's migration manager is driven by
  the embedder's network events, `quiche/quic/core/http/quic_connection_migration_manager.h:189`, `:193`; mvfst's
  `onNetworkSwitch`, `quic/client/QuicClientTransportLite.h:191`), otherwise the application's call, or failing that a
  train of probe timeouts. Which stacks probe and which rebind is §4.5.

### 8.6 Per stack, the client's terms at its best

| stack | its `max_ack_delay`, at best | 0-RTT | its initial RTT | out-of-order reads | migration |
| --- | --- | --- | --- | --- | --- |
| quinn | 25 ms; 1 ms when the server asks (ACK_FREQUENCY) | yes; token store | 333 ms, settable | yes | rebind |
| msquic | `MaxAckDelayMs`; its timer resolution when asked | OpenSSL builds | 333 ms, settable | not found | rebind |
| Cloudflare quiche | acknowledges every packet at once; advertises 25 ms, settable | yes | 333 ms, settable | not found | probe |
| ngtcp2 | min(setting, srtt ÷ 8) | yes | 333 ms, settable | not found | probe or immediate |
| picoquic | ≤ 10 ms; 1 ms when asked | on | 250 ms, constant | yes (direct receive) | probe |
| Google QUICHE | 25 ms, ¼ min RTT after 100 packets; 5 ms when asked, behind a flag | yes | 100 ms, settable | not found | probe; OS-driven manager |
| neqo | 20 ms, constant; old ACK_FREQUENCY codepoint | yes | 100 ms, settable | not found | probe |
| s2n-quic | 25 ms, settable, but every 10th packet | **no** (dropped) | 333 ms, settable | not found | none |
| quic-go | 26 ms advertised, constant | yes; token store | 100 ms, constant | not found | probe |
| lsquic | ≤ 25 ms, srtt ÷ 4; old codepoint | yes | 333 ms, constant | not found | none |
| mvfst | settable count and factor; its codepoint matches no other | when set | 50 ms, settable | not found | probe |

Sources: §4.1 (ACK), §4.5 (migration), §4.6 (0-RTT), §8.1 (initial RTT, token stores), §8.3 (reads).

**What separates the stacks on latency, at their best** (D, from §8.1–§8.5): every term that dominates an ask's time
— slow start, loss recovery, the controller under loss, the stream mode — is the server's. Of the client's terms, the
ones that differ between stacks are a lost first flight's wait (150–999 ms, set by the initial RTT, a setting in eight
stacks), a lost last packet's 24 ms (only where the client obeys the server's ACK_FREQUENCY: quinn, msquic, picoquic),
0-RTT (missing in s2n-quic and on msquic's Schannel), and how a network change is noticed and survived (§8.5).

## 9. Measured here

Kept apart from the theory above; each names its row.

* **Receive CPU (row 135, [`quic.md`](quic.md) §6 N1):** quinn 2.05–2.16 ms of CPU per MB with GRO and 3.07–3.14
  without, Chromium's network service 4.0–4.3; at 50 Mbit/s every arm used ≤ 0.05 cores.
* **GSO segments (row 75's lineage, [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md)
  §4):** quinn patched from 10 to 45 segments cut CPU per ask by 16–21 %.
* **Controllers (rows 75, 119, 121, same file §1):** in a browser under 1–3 % random loss BBR filled 12–19× faster
  than Cubic.
* **Chromium's ACK_FREQUENCY:** Chromium 141 does not advertise it ([`../CLIENTS.md`](../CLIENTS.md) §ACK frequency).

## 10. Sources

**Code, at the pins of [`quic.md`](quic.md) §8**, re-fetched 2026-10-12 for row 157. Each archive or file hash
matched the pin listed there: quinn `quinn-proto-0.11.19` (archive `3ad67a0cb40f`; quinn 0.11.12 and quinn-udp
0.5.16 in tree); s2n-quic `v1.90.0` (`8d61838b5901`); Cloudflare quiche `0.30.0` (`8019982c0618`, tokio-quiche in
tree); neqo `v0.32.0` (`f98912deee13`); msquic `v2.6.2` (`settings.c` `e5161a97a6ba`, `quicdef.h` `b4e1012cd2bd`,
`stream_recv.c` `426854b5b81b`); ngtcp2 `v1.25.0` (`ngtcp2_conn.c` `c7c2515c1944`, `ngtcp2.h` `7ce1c48908e5`);
lsquic `v4.10.0` (`lsquic.h` `fb84c9add4b3`, `lsquic_full_conn_ietf.c` `085a89b42fbc`); picoquic
`v2026.10.09.938685c` (`picoquic.h` `a222a0cdcc33`, `frames.c` `6c01e6fb03d7`); mvfst `v2026.10.05.00`
(`TransportSettings.h` `153fa17f8321`, `QuicConstants.h` `b629e036ce32`); quic-go `v0.63.0` (`params.go`
`ffb7c4be1bcb`, `received_packet_tracker.go` `1c496fb40b02`); Google QUICHE `c8b1052048f1755982feef370c7a07d4418d0f04`
(`quic_flow_controller.cc` `df119c2fc56d`, `quic_constants.h` `8b38b35a52cd`). Paths in the text are relative to each
repository's root; Google QUICHE's under `quiche/`.

**Papers**, the pinned arXiv versions of [`quic.md`](quic.md) §8, re-fetched with matching hashes: Jaeger et al.,
arXiv 2309.16395v1 (`ac596357096a`), Fig. 3; Kempf et al., "QUIC Steps", arXiv 2505.09222v1 (`a776a96ec961`),
§4.1, §4.2, Table 1; PEMI, Zhang et al., arXiv 2602.12732v1 (`4185b441392c`), Tables 1–2. quinn issue #2262 as
[`quic.md`](quic.md) §8 read it.

**IETF**, re-fetched as text: RFC 9000 (`f88aae47f8b1`) §4, §9, §13.2.2, §16, §18.2; RFC 9001 (`3bbaecdf5afd`) §4.6;
RFC 9002 (`3a8a54eea1ad`) §7.2; RFC 9438 (`baa4dd77295e`, the text; row 156's `2647ced79cfc` was another rendering)
§5.1, Figure 8, Tables 1–2; draft-ietf-ccwg-bbr-06 (`ba4f90e93d83`) §2.8; draft-ietf-quic-ack-frequency-14
(`aed59e2a6fd2`); draft-ietf-quic-multipath-21 (`c9812f7c0fc6`); draft-ietf-webtrans-http3-16 (`49e0a03b06f0`).
