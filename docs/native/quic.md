# Native client — which QUIC

*Queue row 124, QUICSURVEY, 2026-10-10. Theory only: read from sources, nothing built, nothing timed. The row reports
and compares; every choice below is the owner's (§5).*

**The question.** A native viewer, desktop first (Linux, macOS, Windows) and phones (Android, iOS) the goal, picks its
own QUIC stack instead of the browser's. Which implementation should it be, and does the same choice serve the link
from a site's ingest to the server ([`../av1/queue.md`](../av1/queue.md) row 126)?

**Why it matters.** The browser's receive path is today's ceiling, not the wire: Chromium spends ~9.8 ms of CPU per MB
received, one datagram per system call, no GRO ([`../rig-limits.md`](../rig-limits.md) §1). Its connection migration
is not reachable from a page ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Session survival), and it never resumes a
WebTransport session (§Resumption and 0-RTT). A native client chooses all three.

## Contents

1. [The answer in plain words](#1-the-answer-in-plain-words)
2. [The candidates, by column](#2-the-candidates-by-column)
3. [What the published comparisons say](#3-what-the-published-comparisons-say)
4. [Talking to our server](#4-talking-to-our-server)
5. [The owner's decisions](#5-the-owners-decisions)
6. [Proposed rows (not queued)](#6-proposed-rows-not-queued)
7. [Sources](#7-sources)

## 1. The answer in plain words

* **For the fill and the ask, the client's congestion controller does not matter: the server sends.** What the
  client's stack decides is its receive cost (batched reads, GRO, ACKs), its flow-control windows, migration and
  resumption. Row 119's controller options stay on the server, in quinn, whose `Controller` trait `bbr-bound` already
  implements ([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §1). A pluggable
  controller in the *client* matters only where the client sends: the ingest upload.
* **The receive gap is real and has a known shape.** Chromium v102 spent 8.5 s of packet processing per GB, 2.97 s of
  it generating ACKs, and received 744 K datagrams where TCP received 58 K (Zhang et al., WWW '24) — ≈ 8.4 ms per MB,
  close to this repository's 9.8. Chromium `main` now carries `recvmmsg` and UDP GRO code, **off by default**
  (`kQuicUseReadMultiple`, `kEnableUdpGro`). Firefox moved to quinn-udp (batched, GSO/GRO) and went "from < 1 Gbit/s
  to 4 Gbit/s" on CPU-bound benchmarks, ≈ 2 ms of CPU per MB if one core (derived). **No candidate publishes receive
  CPU per byte**; it is the first thing to measure (§6, N1).
* **The gap is a desktop and Android gap; on iOS it is unknown.** Apple has no UDP segmentation or receive offload;
  the only batching is a private `sendmsg_x`/`recvmsg_x` pair Firefox declined to ship. msquic and quic-go read one
  datagram per call on Apple platforms. Network.framework is closed and publishes no cost.
* **Only one stack runs everywhere we need, speaks to our server unchanged, and is already ours: quinn** (Rust, MIT OR
  Apache-2.0), through wtransport's or web-transport-quinn's client. It has GSO on Linux, Android and Windows, GRO on
  Linux and Android, `recvmmsg`, a public controller trait, 0-RTT, and a socket swap (`Endpoint::rebind`) but no
  probe-then-switch migration and no multipath. Its gaps: no Swift or Kotlin binding (UniFFI through
  `web-transport-ffi` exists for both), no iOS CI, the WebTransport clients call themselves "not completely
  production-ready", and five RustSec advisories, two of them 2026 DoS.
* **The platform stacks trade control for zero size.** Apple's Network.framework does raw QUIC with our own ALPN,
  datagrams, L4S/ECN and automatic Wi-Fi ↔ cellular migration, but exposes no controller, RTT or loss knob and no
  WebTransport. Android's Cronet/HttpEngine is HTTP only: no raw QUIC, no ALPN of ours, no WebTransport. Either means a
  server that also speaks plain HTTP/3 or raw QUIC (§4).
* **Multipath is not yet a product choice.** draft-ietf-quic-multipath-21 (2026-03-17) is in the RFC Editor queue
  with its final codepoint 0x3e. Released with it: noq 1.3.0 (a quinn fork) and picoquic (draft-20, 0x3e). xquic
  (draft-10) and tquic (draft-05) use older, mutually incompatible drafts. Nobody else.
* **The C and C++ stacks each lead on one axis, none on all.** picoquic has the richest public controller hook, draft-20
  multipath and a WebTransport client in tree, but no releases, one thread per context and no mobile statement. ngtcp2
  is the cleanest sans-I/O C library (MIT, many TLS backends, GSO/GRO in its examples) with WebTransport on an unreleased
  branch. msquic is MIT and fast on Windows and Linux but best-effort elsewhere, single-datagram on Apple, had a
  hostname-check CVE in every non-Windows client before 2.6.1, and has no WebTransport. Google's QUICHE has a public
  `SendAlgorithmInterface` and a native WebTransport client but no releases, no C API and a Bazel build for Linux
  only.

## 2. The candidates, by column

Each cell is from §7's sources, read 2026-10-10; **unknown** means searched and not found. GSO is batched send, GRO
batched receive, CC the congestion controller, MP multipath QUIC, WT a WebTransport-over-HTTP/3 client.

### Speed

| stack | published throughput | receive path | send path | pacing · ECN | QIR client, run 2026-10-10T19:16 (partial) |
| --- | --- | --- | --- | --- | --- |
| quinn 0.11.12 / quinn-proto 0.11.19 / quinn-udp 0.5.16 | none; Firefox on quinn-udp: < 1 → 4 Gbit/s | `recvmmsg` ×32 (Linux, Android); GRO Linux, Android; Windows URO off by default (quinn#2041); Apple: one per call unless `fast-apple-datapath` | GSO Linux, Android; Windows USO on (Firefox rolled USO back: loss, a driver crash) | always · yes | G 9 302 kbps, C 4 358; L2, C2 9/9 |
| s2n-quic 1.90.0 | none | GRO and `recvmmsg` on Linux only; none on Android, iOS, Windows | GSO Linux only; needs kernel ≥ 5.0 | yes · yes | G 9 226, C 4 046; all loss cases 10/10 |
| Cloudflare quiche 0.30.0 | 80–90 MB/s with plain `sendmsg` (2020, one laptop) | GRO, `recvmmsg` only in tokio-quiche, Linux | GSO, SO_TXTIME in tokio-quiche, Linux | app honours `SendInfo.at` · unknown | G 9 240, C 6 004 |
| neqo 0.32.0 | none alone (Firefox as above) | quinn-udp 0.6 with `fast-apple-datapath` on | as quinn-udp | on · yes (~50 % of Firefox paths ECN-capable) | G 9 341, C 5 389 |
| Google QUICHE (`main` c8b1052) | SIGCOMM 2017: server CPU ≈ 2× TLS/TCP after optimisation | GRO cmsg path in its own POSIX layer; Chromium uses neither by default | GSO, `sendmmsg` writers (own layer) | yes · yes, Prague shipped | not in the runner ("quiche" there is Cloudflare's) |
| Cronet / HttpEngine (Chromium 155) | none | Chromium's: one `recvmsg` per datagram by default | no GSO in `udp_socket_posix.cc` | QUICHE's | "chrome" client runs H3 only |
| msquic 2.6.2 | dashboard: ~12.6 Gbit/s Windows, 7.3–8.0 Linux, 1 connection (unit read from the page's "Gbps" label) | GRO, `recvmmsg` Linux; URO Windows; **one per call on macOS, iOS** | GSO Linux, USO Windows; XDP | on · **off** by default | G 9 390, C 5 668 |
| Apple Network.framework | none | unknown (closed) | unknown | unknown · L4S built in since iOS 17 | not in the runner |
| ngtcp2 1.25.0 + nghttp3 1.18.0 | none | app's I/O; examples use GRO | `write_aggregate_pkt` for GSO, paced | yes · per packet | G 9 295, C 4 626; all loss cases 10/10 |
| lsquic 4.10.0 | Tencent's RPS benchmark ranks it best of the alternatives | app's I/O, batched API | `ea_packets_out` batches | on · off by default | G 9 356, C 5 533 |
| picoquic (`v2026.10.09`) | 1.5–2 Gbit/s with GSO (2023 blog); "up to 5 Gbps" (README) | Windows URO; Linux GRO not found | GSO Linux, USO Windows | yes · yes | G 9 386, C 5 480 |
| mvfst `v2026.10.05.00` | Facebook apps 2020: −6 % request errors, −20 % tail latency | `recvmmsg` ×5, GRO accessor | GSO and/or `sendmmsg` | **off** · off by default | G 9 337, C 4 793; L1, C1 0/10 |
| xquic 1.9.7 | none | one packet per call into the engine | `sendmmsg`; no GSO | **off** · **none** | G 9 096, C 7 692 (n = 2) |
| tquic 1.6.0 | vendor: up to +20 % RPS over lsquic | app's | batch callback | yes · **none** | not registered |
| quic-go 0.63.0 | none; as a 10 Gbit/s client 64–1 976 Mbit/s (Jaeger 2023) | `recvmmsg` ×8 Linux, ×1 macOS; **no GRO** | GSO Linux only | burst ≤ 10 · yes | G 9 361, C 5 090 |

**The runner's numbers do not rank anything.** Its link is a simulated 10 Mbit/s with 15 ms one way and a 25-packet
queue, CPU-bound in the simulator; every client lands at 91–94 % of it. "C" is a share against one TCP Cubic flow
(≈ 5 000 is an even split). The run was in progress, with **no quinn, msquic, mvfst or xquic server yet**, so no result
against a server like ours exists; every `result.json` returned 404.

### Control

| stack | CCs shipped | your own CC | initial RTT · PTO | flow-control default | priorities · DATAGRAM |
| --- | --- | --- | --- | --- | --- |
| quinn | NewReno, Cubic (default), BBR ("experimental") | **yes**: `congestion::Controller` + `ControllerFactory`, public; loss callback carries bytes, not packets | 333 ms, settable · no PTO setter | stream 1.25 MB, conn unbounded, send 10 MB; all settable | `set_priority(i32)` · yes |
| s2n-quic | Cubic, BBRv2 | sealed behind `unstable-congestion-controller`; richest callback (`new_loss_burst`, per-packet info) | 333 ms · PTO jitter | 3.75 MB both | none found · unstable feature |
| Cloudflare quiche | Reno, Cubic, BBRv2 | no (`pub(crate)`); `set_enable_relaxed_loss_threshold` | 333 ms · fixed | auto-tuned to 16/24 MiB | RFC 9218 · yes |
| neqo | NewReno, Cubic; HyStart, SEARCH; `spurious_recovery` on | no | **100 ms** · `max_pto`, `fast_pto` | 1 → 10 MiB stream, 2 → 20 MiB conn | yes · yes |
| Google QUICHE | Cubic, Reno, BBR, BBRv2, BBRv3, PCC, GoogCC, Prague | **yes**: `SendAlgorithmInterface` via `SetSendAlgorithm`; `LossDetectionTunerInterface` | 100 ms · via config | settable | RFC 9218, WT send groups · yes |
| Cronet / HttpEngine | QUICHE's, chosen by tag strings (embedded Cronet only) | no | not exposed | not exposed | request priority · no |
| msquic | Cubic; BBR in preview only | no (internal table); statistics event only | 333 ms · none | stream **64 KiB**, conn 16 MiB | `STREAM_PRIORITY` · yes, off by default |
| Network.framework | not exposed | no | not exposed | `initialMaxData`, `initialMaxStreamData*` | not exposed · yes (iOS 15; Swift `QUICDatagram` iOS 26) |
| ngtcp2 | Reno, Cubic, BBRv2 | no (internal `ngtcp2_cc.h`) | settable · derived | auto-tune caps | in nghttp3 · yes |
| lsquic | Cubic, BBRv1, adaptive (default) | no (internal `cong_ctl_if`) | unknown | 15 MiB conn (client) | yes · yes |
| picoquic | NewReno (default), Cubic, BBRv3, BBRv1, Prague, C4, … | **yes**: `picoquic_congestion_algorithm_t`; per-ACK newly-lost bytes, loss ranges, lost packet number, one-way delay, ECN-CE | 250 ms constant · none public | settable | yes · yes |
| mvfst | Cubic, NewReno, Copa, BBR, BBR2, static, none | **yes**: `CongestionControllerFactory`, `CongestionControlType::Custom` | **50 ms** · — | settable | yes · yes |
| xquic | Cubic (default), BBR, BBR2, Reno, Copa | **yes**: `xqc_cong_ctrl_callback_t`; `on_lost` gets only a send time | 250 ms · `initial_pto_duration`, backoff | settable | H3 · yes; **FEC** built in (xquic both ends) |
| tquic | **BBR (default)**, Cubic, BBRv3, Copa | no (private module) | settable · `set_max_pto` | settable | yes · **none** |
| quic-go | Reno-style in a Cubic sender, IW 32 | no (`internal/`; #776 future work) | 100 ms fixed · none | 512 KB → 6 MB stream, 15 MB conn | RFC 9218 · yes |

### Mobility

| stack | client migration | multipath | 0-RTT | phones |
| --- | --- | --- | --- | --- |
| quinn | socket swap `Endpoint::rebind`, no probe first; server migration on by default | **no** (fork **noq 1.3.0**: draft-21, 0x3e) | yes | Android CI (emulator tests); no iOS CI; background unknown |
| s2n-quic | not exposed to clients | no | behind `unstable_resumption` | no mobile CI; GSO/GRO off on Android |
| Cloudflare quiche | **yes**: `probe_path`, `migrate` | no | yes | Android NDK CI, iOS build-only CI; Android's DoH3 resolver runs it |
| neqo | **yes**: `migrate` probes, abandons on failure | no | yes | Android build check; no iOS |
| Google QUICHE | **yes**: `QuicConnectionMigrationManager` (network change, path degrading, preferred address); embedder supplies OS signals | no | yes | embedder's job |
| Cronet / HttpEngine | **yes**: default-network and path-degradation migration, `bindToNetwork` | no | on unless disabled | **Android only**; iOS dropped at M108; Doze suspends network outside maintenance windows |
| msquic | set `LOCAL_ADDRESS` after the handshake; no OS watching | no | OpenSSL builds only, not Schannel | best-effort; iOS static only |
| Network.framework | automatic Wi-Fi ↔ cellular; no QUIC-specific setting | `MultipathServiceType` documented with MPTCP symbols; **multipath QUIC unknown** | unknown | the platform; background URLSession runs in another process (HTTP/3 there unknown) |
| ngtcp2 | **yes**: `initiate_migration` (validated) or immediate | no | yes | no statement, no CI |
| lsquic | not found | no | yes | "tested on iOS ARM, Android ARM"; no CI |
| picoquic | **yes**: `probe_new_path`, `abandon_path` | **draft-20 (0x3e)** | on by default | no statement |
| mvfst | **yes**: `onNetworkSwitch`, `startPathProbe`, `migrateConnection` | no | yes | in Meta's apps; the mobile build files are not in the open tree |
| xquic | path API | **draft-10** (README says 05/06) | yes | cross-build script; Taobao |
| tquic | `add_path`, `migrate_path` | **draft-05** | yes | iOS and Android CI; ≈ 2 MB stripped |
| quic-go | **yes**: `AddPath` → `Probe` → `Switch`, app-driven; no preferred address | no (#3343) | `DialEarly` | gomobile; Go runtime size unknown |

### Building and shipping

| stack | language · TLS | from Rust / Swift / Kotlin | threads | platforms (official) | releases, last three | security record | licence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| quinn | Rust · rustls (*ring*, aws-lc-rs) | native / none / none (UniFFI via `web-transport-ffi`) | tokio (smol optional); sans-I/O core | Linux, macOS, Windows, Android CI | 0.11.12 2026-09-14, 0.11.11 06-22, 0.11.9 2025-08-27 (proto monthly) | 5 RustSec, 2 in 2026 (DoS) | MIT OR Apache-2.0 |
| s2n-quic | Rust · s2n-tls (C), rustls on MSVC | native / none / none | tokio | Linux, macOS, Windows; no mobile | 1.90.0 2026-10-02, 1.89.0 09-22, 1.88.0 08-21 | 4 GHSA | Apache-2.0 |
| Cloudflare quiche | Rust · BoringSSL | native / **C API** / C API | single-threaded core; tokio-quiche | all five, iOS build-only | 0.30.0 2026-09-17, 0.29.3 07-14, 0.29.2 06-19 | 5 CVE, one 2026 use-after-free **in the C API** | BSD-2-Clause |
| neqo | Rust · **NSS** | git dependency (not on crates.io) / none / none | caller-driven | Linux, macOS, Windows, Android build | 0.32.0 2026-09-25, 0.31.1 09-01, 0.31.0 08-25 | none under crates names; Firefox's not checked | MIT OR Apache-2.0 |
| Google QUICHE | C++ · BoringSSL; Abseil, protobuf, Bazel | C shim / C shim / C shim | event loop | Linux standalone only | **no tags or releases** | Chrome QUIC CVEs, 3 high or critical in 2026 | BSD-style |
| Cronet / HttpEngine | C++ under Java · BoringSSL | JNI / — / native API | app's `Executor` | **Android** (HttpEngine API 34) | 500.0.1, 500.0.2, 500.1.0 (2026-07 to 10) | Chrome's | BSD |
| msquic | C · Schannel, quictls/OpenSSL 3.5 | in-repo crate (crates.io lags at 2.5.1-beta) / C / C | own worker threads | Windows, Linux; others best-effort | 2.6.0 2026-08-14, 2.6.1 08-29, 2.6.2 10-01 | **CVE-2026-105794** (client hostname unchecked on OpenSSL before 2.6.1), two more critical/high 2026 | MIT |
| Network.framework | the OS · the OS | Objective-C blocks / native / — | dispatch queues, Swift concurrency (26) | Apple only; QUIC iOS 15, macOS 12 | with the OS | none found | the platform's |
| ngtcp2 | C · quictls, GnuTLS, BoringSSL, aws-lc, picotls, wolfSSL, LibreSSL, OpenSSL 3.5 (experimental) | third-party `-sys` crates / C / C | none (one conn, one thread at a time) | Linux, macOS, Windows CI | 1.23.0 2026-05-31, 1.24.0 06-28, 1.25.0 07-26 | 2 CVE, both in qlog | MIT |
| lsquic | C · BoringSSL, OpenSSL 3.5 | one third-party crate / C / C | app-driven engine | Linux, FreeBSD, macOS, Windows | 4.9.3 2026-07-31, 4.9.4 08-30, 4.10.0 09-13 | 3 CVE | MIT |
| picoquic | C · picotls (OpenSSL), mbedTLS | dead 2018 crate / C / C | **single-threaded per context** | Linux, macOS, Windows, FreeBSD | **date tags only**, several a day | 2 CVE | MIT |
| mvfst | C++ · fizz; folly | C shim / C shim / C shim | folly EventBase | Linux, macOS, Windows (getdeps) | weekly date tags | 2 CVE | MIT |
| xquic | C · BoringSSL or Tongsuo | none / C / C | app-driven | Linux, macOS CI; Windows claimed | 1.9.5 2026-08-11, 1.9.6 08-27, 1.9.7 09-10 | 2 CVE 2026 | Apache-2.0 |
| tquic | Rust · vendored BoringSSL | native / C API / C API | sans-I/O | all five in CI | **1.6.0 2025-02-25**, then a handful of commits | none | Apache-2.0 |
| quic-go | Go · Go's crypto/tls | cgo `c-archive` / gomobile / gomobile | goroutines | Linux, macOS, Windows | 0.61.0 2026-07-21, 0.62.0 08-30, 0.63.0 09-22 | 8 CVE since 2023 | MIT |

Binary size on a phone is **unknown** for every stack but two: Cronet's `libcronet` 7.3 MB (arm64, uncompressed) and
tquic's ≈ 2 MB stripped. msquic's Windows DLL is 549 KB.

## 3. What the published comparisons say

* **Zhang et al., "QUIC is not Quick Enough over Fast Internet", WWW '24** (Chromium 102, OpenLiteSpeed's LSQUIC,
  1 Gbit/s): QUIC up to 45.2 % below HTTP/2; a 1 GB download 18.60 s against 9.32 s at 96.9 % against 77.5 % CPU;
  a Pixel 5 on 5G +110–112 %. Cause on the receiver: no GRO, one `recvmsg` per datagram, ACKs built in user space
  (2.97 s of 8.5 s per GB). Recommended: GRO, `recvmmsg`, ACK frequency, multi-threaded receive.
* **Jaeger et al., "QUIC on the Highway", IFIP Networking 2023** (aioquic, quic-go, mvfst, picoquic, quiche, LSQUIC,
  10 Gbit/s): best pair ≈ 3 Gbit/s (≈ 5 on a faster CPU) against TCP's 8 010 Mbit/s; packet I/O the largest cost; the default 208 KiB
  receive buffer drops packets at the client; GSO/GRO left goodput flat and raised client CPU (82 → 92 % LSQUIC).
  Its journal extension (Kempf et al., Computer Communications 2024) was **not read** (the publisher refused).
* **Kempf et al., "QUIC Steps", CoNEXT 2025** (quiche, picoquic, ngtcp2 at 40 Mbit/s, 40 ms — the target's range): TCP
  37.37 Mbit/s with 16.5 drops; quiche 34.67 / 687, picoquic 37.09 / 861, ngtcp2 15.93 / 503. GSO cuts CPU but sends
  bursts; pacing inside a GSO batch needs a kernel patch.
* **Yu & Benson, "Dissecting Performance of Production QUIC", WWW '21** (10 Mbit/s, 0–1 % loss): H3 ahead for 100 KB,
  level from 1 MB; at 1 % loss one provider's H3 lost to its H2 because of Cubic against BBR — the controller, not the
  protocol. "QUIC's performance is inherently tied to implementation design choices, bugs, and configurations."
* **Endres et al., GEO satellite, 2022** (twelve stacks, not quinn or s2n-quic): 20 Mbit/s at 30 ms averaged 76 % of
  the link; behaviour "depends on both client and server implementation".
* **Marx et al., EPIQ '20** (15 stacks) and **Seemann & Iyengar, EPIQ '20** (the interop runner): abstracts only,
  full texts refused. "Kosek et al. on multipath or QUIC CPU", a lead in the brief, **does not exist as named**.

None measured quinn's receive cost, none measured a phone stack other than Chrome's, and none ran at the target's
mobile loss. The receive-side mechanism, though, is the same everywhere: datagrams per system call and ACKs per packet.

## 4. Talking to our server

The server is wtransport 0.7.2 over quinn: draft-02 settings (`0x2b603742`, `0xc671706a`), `:protocol =
webtransport` only, no reset-stream-at. Three ways a native client can reach it:

* **WebTransport over HTTP/3, the server unchanged.** Clients that should work, by setting IDs and protocol token
  (read, not tested): wtransport's own client (measured: 2.12 round trips to ready, [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
  §Other clients), web-transport-quinn 0.13.2, neqo (Firefox's; same `0x2b603742`), picowt (falls back to
  `webtransport` when the server sends no `wt_enabled`), Google QUICHE's `WebTransportOnlyClient` (drafts 02 and 07).
  The ngtcp2 branch client sends `webtransport-h3` (one line to change, client or server). webtransport-go from
  v0.13.0 refuses the server for want of reset-stream-at (measured, §Other clients). xquic's branch: unknown. The
  WebTransport draft is at -16 in WG Last Call; a server that follows it will need reset-stream-at and the new
  settings, whatever the client.
* **Raw QUIC with an ALPN of our own, beside WebTransport.** Every stack but Cronet allows it. It drops the HTTP/3 and
  WebTransport layers (CONNECT, capsules, session IDs) and keeps [`../WIRE.md`](../WIRE.md)'s messages on plain
  streams. On the server, wtransport 0.7.2 accepts a session from a quinn connection the server already holds
  (`IncomingSessionFuture::with_quic_connecting`), so one quinn endpoint on one port could offer both ALPNs and hand
  only `h3` to wtransport — **read from the API, not built**. This is a change to the wire: proposed here, not built.
* **Plain HTTP/3** (row 128's subject): the only door for Cronet/HttpEngine and URLSession, so the only way to use the
  phone's own QUIC stack on Android.

**For the ingest upload** the client sends, so here its controller does matter. quinn is the same stack as the
server, with GSO and a public controller trait; its default 1.25 MB stream window caps one stream near 12.5 MB/s at
100 ms and must be raised on the receiving server for a fast site link (derived). s2n-quic and msquic are strong on a
Linux or Windows host but bring a second stack; picoquic has the best controller hook but no releases.

## 5. The owner's decisions

Each is the owner's; the row only lists them. They are also under §Blocked in [`../av1/queue.md`](../av1/queue.md).

1. **One Rust core everywhere, or the platform's stack on phones.**
   * *Rust core on quinn* (desktop, Android, iOS): one transport, one exactness and cache path, the server's own stack
     and controller trait; costs a Swift/Kotlin binding (UniFFI) and a receive path on iOS of unknown cost.
   * *Platform stacks on phones* (Network.framework, Cronet/HttpEngine): zero size, the OS's migration and L4S; no
     controller or loss knob, no WebTransport, Cronet HTTP only; needs a second wire (raw QUIC for Apple, HTTP/3 for
     Android).
   * *A C core* (ngtcp2 or picoquic) behind the same bindings: more control in places (picoquic's controller hook,
     multipath), less maturity in others (no releases for picoquic; WebTransport only on branches).
   * Decides it: N1's receive cost and N3's iOS reading.
2. **WebTransport from the native client, or raw QUIC with our own ALPN.** WebTransport keeps the server unchanged and
   the browser and native clients on one protocol; raw QUIC removes a layer and opens Apple's stack. Decides it: N2,
   and whether the browser client stays.
3. **Multipath now (noq, a quinn fork at the final codepoint), or after an RFC and quinn.** Decides it: whether a
   Wi-Fi ↔ cellular handover costs a fill enough to matter — not measured ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Session survival).
4. **Same stack for the ingest link** (quinn), or a second stack chosen for a Linux or Windows site host.
5. **What security record is acceptable** for a medical client: every candidate had 2026 advisories; msquic's
   hostname check is the one that broke authentication.

## 6. Proposed rows (not queued)

Each states its predictions and rule before any data; run in cloud containers first, so they need no workstation;
queued, each runs in a session given only the protocol and the rule. Arms differ in the client stack alone: the same
server build, controller (`cubic-restart`), initial window and relay, printed per arm.

* **N1 RECVCOST — receive CPU per MB, native against Chromium.** Arms: headless Chromium (today's client), the
  wtransport client, web-transport-quinn, and a raw-QUIC quinn client (a lab driver, nothing in the product);
  quinn arms with and without GRO (`UDP_GRO` off by socket option). Cells: loopback fills of 800 × 250 KB and
  800 × 32 KB; the relay at 20 and 50 Mbit/s clean and 2 % random loss. Per-thread CPU from `schedstat` as in
  `lab/scripts/browser_receive.py`; ≥ 7 rounds interleaved; bit-exact frames against the ingest digests.
  Predictions:
  * P1: on loopback, quinn with GRO ≤ 3 ms CPU per MB against Chromium's ~9.8 (Firefox's 4 Gbit/s ≈ 2).
  * P2: without GRO, quinn ≤ 6 ms per MB (`recvmmsg` alone).
  * P3: at 20 and 50 Mbit/s every arm's fill is within ±3 % (the wire binds, not the receiver).

  Rule: P1 holding makes the native receive path a lever on desktop and Android; P3 failing at 50 Mbit/s names the
  receive path as a bound inside the target range. Say where the container saturates.

  **Measured 2026-10-11 (queue row 135), run from this protocol and rule alone** ([`../../lab/recv-cost`](../../lab/recv-cost/README.md)):
  7 rounds, the five arms in a Williams order inside each (cell, round), 210 fills, **168 000 / 168 000 frames exact**
  against SHA-256s written when the series were made (random bytes, 800 × 250 KB and 800 × 32 KB). Every arm: one
  `series-server` build (this tree at `84cb4a8`), `cubic-restart`, quinn's default initial window, `stream_mode=shared`,
  on core 0; clients on cores 1–2; the relay (`link_impair.py`, 20 ms each way, a 200-packet queue) on core 3; the
  relay cells use the 32 KB series. Arms: headless Chromium 141.0.7390.37 with a page reading the shared stream (not
  the product's downloader), every Chromium process counted; wtransport 0.7.2 and web-transport-quinn 0.13.2, both on
  quinn 0.11.11 / quinn-proto 0.11.18 / quinn-udp 0.5.15 with each stack's own transport defaults, `UDP_GRO` on (quinn-udp's
  default) or off, read back from the socket in every fill. **Not run:** the raw-QUIC quinn arm — the server speaks
  WebTransport only, so it needs a raw-QUIC server, which would make the arms differ in more than the client.

  | loopback, client CPU per MB (ms), median [min–max] | 250 KB frames | 32 KB frames |
  | --- | --: | --: |
  | Chromium, all processes | 12.43 [6.78–13.39] | 6.36 [6.23–7.70] |
  | Chromium, network service alone (its QUIC receive) | 4.25 [3.97–4.68] | 3.98 [3.50–4.40] |
  | wtransport, GRO | 2.16 [1.88–2.81] | 2.16 [2.01–2.49] |
  | web-transport-quinn, GRO | 2.05 [1.88–2.54] | 2.16 [1.90–2.57] |
  | wtransport, no GRO | 3.11 [2.98–4.67] | 3.14 [2.86–3.26] |
  | web-transport-quinn, no GRO | 3.07 [2.88–3.77] | 3.11 [2.84–3.54] |

  Chromium's renderer — the page and Blink's streams — is the rest, and bimodal at 250 KB (2.5–3.3 in two rounds,
  7.2–8.6 in five), a page holding 200 MB of frames. On the relay every arm is far from busy (≤ 0.53 cores) and CPU per
  MB is mostly time, not bytes: Chromium 90–178, the quinn arms 26–44.

  * **P1 holds:** quinn with GRO 2.05–2.16 ms per MB (max 2.81) against Chromium's 6.4–12.4 whole, 4.0–4.3 for its
    network service alone.
  * **P2 holds:** without GRO 3.07–3.14 (max 4.67); GRO is worth about a third of quinn's receive CPU.
  * **P3 holds clean and fails under loss.** Clean, at 20 and 50 Mbit/s every arm fills within 0.6 % of the others
    (Chromium 0.995 and 0.996 of the quinn arms' mean). Under 2 % loss Chromium is slower in 7/7 rounds at both rates:
    1.089 [1.077–1.109] of the quinn arms at 20 Mbit/s, 1.054 [1.024–1.101] at 50, while the four quinn arms stay within
    ±3.7 % of each other.

  **By the rule:** the native receive path is a lever on desktop (Android is not measured here), and P3's failure at
  50 Mbit/s names the receive path as a bound inside the target range — though not by CPU: the client spends ≤ 0.05
  cores there, so what differs is the stack's behaviour under loss, which this protocol does not separate. **Where the
  container saturates:** on loopback the server's one core runs at ~0.9 during a quinn arm's fill (about 670 MB/s) and
  the clients at 1.3–1.5 of their two cores, so loopback fill times compare nothing; CPU per MB is the claim. Also seen,
  not asked: the server spends 2.3–2.6 ms per MB sending to Chromium against 1.3–1.5 to quinn with GRO and 1.9 without.
* **N2 NATIVEWT — which native clients reach the server unchanged.** Arms: wtransport, web-transport-quinn, neqo,
  picowt, QUICHE's `WebTransportOnlyClient`, ngtcp2's branch (with `webtransport` as its token), webtransport-go
  v0.9.0 and v0.13.0; 5 rounds at 40 ms. Prediction: all but webtransport-go v0.13.0 open a session and receive
  frame 0 bit-exact; ready in 2–3.5 round trips. Rule: every client that opens is listed as a supported native
  client; any that fails gets its cause read before a server change is proposed.
* **N3 APPLERECV — the receive path on macOS** (a cloud macOS runner, or the owner's machine; no Apple hardware here).
  Arms: quinn-udp default, quinn-udp with `fast-apple-datapath`, Network.framework raw QUIC with our ALPN (a lab
  driver against a raw-QUIC lab server). Cell: loopback and a 50 Mbit/s shaper, 61 MB series. Prediction: the
  default quinn arm costs ≥ 1.5× `fast-apple-datapath` per MB; Network.framework within ±30 % of the faster quinn
  arm. Rule: if Network.framework is ≥ 1.5× cheaper than both quinn arms, decision 1's platform option for iOS
  is costed in; otherwise the Rust core stands on iOS too.
* **N4 REBINDNEW — a native client across a new address.** quinn's `Endpoint::rebind` to a socket on a second
  interface (a second container network), against the single-endpoint server; quiche's or neqo's probe-then-migrate
  as the second arm. Prediction: both keep the session with the next ask ≤ 2 RTT after the switch, 10 of 10; quinn's
  unprobed switch loses packets in flight, neqo's does not. Rule: if both keep the session, a native client recovers
  a handover without §Re-dial and re-issue's cold session, and decision 3 is weighed on N4's time against a re-dial.

## 7. Sources

Fetched 2026-10-10, pinned by tag or commit and the first 12 hex of the fetched file's sha256 (a clone: of `git archive
HEAD`). Raw copies are not committed.

* **quinn**: tag `quinn-proto-0.11.19` (`8192ed399a26`, archive `3ad67a0cb40f`); crate quinn 0.11.12 (`4051e23e9185`);
  quinn-udp 0.6.3 (`47091c86514c`); noq-proto 1.3.0 (`7c1e5b6fe668`); RustSec advisory-db `7eebec69c352`.
* **wtransport 0.7.2** (`b4273ce3157a`), wtransport-proto 0.7.2 (`aad9059572c7`), web-transport-quinn 0.13.2
  (`101ac58477fd`); the web-transport repository README (`3f2f1d1c908b`).
* **s2n-quic** tag `v1.90.0` (`b0a09202be1c`, archive `8d61838b5901`); AWS launch post 2022-02-17 (`a2c4cb29ef7e`).
* **Cloudflare quiche** tag `0.30.0` (`be47c5011215`, archive `8019982c0618`); tokio-quiche 0.20.0 (`b36d680054da`);
  Cloudflare, "Accelerating UDP packet transmission for QUIC", 2020-01-08 (`79dba3f5adf5`); Google Security Blog,
  DNS-over-HTTP/3 in Android, 2022-07 (`a4082a65863a`).
* **neqo** tag `v0.32.0` (`28cacc8ea2b0`, archive `f98912deee13`); M. Inden, "Fast UDP I/O in Firefox", 2025-09-14
  (`6ced142a3754`), and his MIR³ 2025 slides (`22a5081c8d61`).
* **Google QUICHE** `main` `c8b1052048f1` (README `fb30f2fa7d71`, `send_algorithm_interface.h` `b918e9c6771f`,
  `web_transport_only_client.cc` `92fe235f0b45`); Langley et al., SIGCOMM 2017 (`e0e622044a20`).
* **Cronet / HttpEngine**: Chromium `6ad6b9de7dbd` (`components/cronet/README.md` `970128e5226c`,
  `net/base/features.cc` `165a703e7644`, `udp_socket_posix.cc` `c83c1c813536`); Android reference pages for
  HttpEngine, QuicOptions and ConnectionMigrationOptions (`3a080212e715`, `7b6b70db28a9`, `a55012d9f1d8`);
  cronet-bundled 500.1.0 AAR (`fa286aeebe66`).
* **msquic** tag `v2.6.2` (`819ab74f851e`; `Settings.md` `da803bd4ea02`, `Release.md` `349753421291`,
  `datapath_kqueue.c` `9d4741d90c01`); netperf dashboard data (`9a7606dae954`); NuGet 2.6.2 package
  (`3d9438193ff3`); NVD keyword search "msquic" (`1537108917e6`).
* **Apple**: developer documentation JSON for `NWProtocolQUIC.Options` (`04576994859a`), `QUIC` (`e361bcfe1a76`),
  `QUICDatagram` (`cb631d083884`), the L4S article (`d9e519025f29`); WWDC21 10094 (`fbf732931bf9`), WWDC25 250
  (`24bd3aeee020`).
* **ngtcp2** tag `v1.25.0` (`f9e9ff01ad21`; `ngtcp2.h` `7ce1c48908e5`); nghttp3 tag `v1.18.0`; the `webtransport`
  branches (ngtcp2 `593fcc96c40f`, nghttp3 `044ad5ff641c`).
* **lsquic** tag `v4.10.0` (`af9286e8a439`; `lsquic.h` `fb84c9add4b3`).
* **picoquic** tag `v2026.10.09.938685c` (`picoquic.h` `a222a0cdcc33`, `doc/multipath.md` `5f3beb9cce03`,
  `doc/pico_webtransport.md` `34baccf1398b`); C. Huitema, "Optimizing QUIC performance", 2023-12-12
  (`56e344d55631`).
* **mvfst** tag `v2026.10.05.00` (`8ca1fa0beac4`; `CongestionControllerFactory.h` `188bb8aaa5e7`); Meta Engineering,
  "How Facebook is bringing QUIC to billions", 2020-10-21 (`116d203c1300`).
* **xquic** tag `v1.9.7` (`39437fa331cd`; `xquic.h` `90c30cfb9d12`); branch `feat/webtransport` `e38278a2b5b9`.
* **tquic** tag `v1.6.0` (`d87a9a072475`; `congestion_control.rs` `0b6116dcfb50`); tquic.net benchmark
  (`41d71794da34`) and size (`a82b13f6b9d7`) pages.
* **quic-go** tag `v0.63.0` (`9d085cc6`; `sent_packet_handler.go` `7b7a772f3900`, `sys_conn_helper_darwin.go`
  `b19686c17a8a`); webtransport-go `v0.13.0` (`58c37d9b`, README `c7198ca4043e`); OSV queries (`b384307a673b`,
  `5760a98ded5c`).
* **Papers**: Zhang et al., arXiv 2310.09423v2 (`c000afca3e29`); Jaeger et al., arXiv 2309.16395v1 (`ac596357096a`);
  Kempf et al., "QUIC Steps", arXiv 2505.09222v1 (`a776a96ec961`); Yu & Benson, WWW '21, the authors' PDF
  (`3123699f19d2`); Endres et al., arXiv 2202.08228v2 (`2e9f9e3978f4`).
* **Interop runner** at `740c05a10b61` (`implementations_quic.json` `2958fcec80dc`, `testcases_quic.py`
  `8e004e1e58a1`); the per-pair logs of QUIC run 2026-10-10T19:16 (manifest `6e9295f5622d`); WebTransport run
  2026-10-10T15:48 (`b71c2f6c111e`).
* **IETF**: draft-ietf-quic-multipath-21 (`c9812f7c0fc6`) and its Datatracker record (`01e6642ec67a`);
  draft-ietf-webtrans-http3-16 (`49e0a03b06f0`).

**Not read**, so not cited: Kempf et al., Computer Communications 2024 (publisher 403, API 429); the full texts of
Marx et al. and Seemann & Iyengar (ACM 403); every QUIC `result.json` of the interop runner (404); GitHub's release
and advisory pages for the C stacks (403); Firefox's security advisories for neqo.
