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
7. [At their best, not their defaults](#7-at-their-best-not-their-defaults)
8. [Sources](#8-sources)

## 1. The answer in plain words

*Each stack explained lever by lever and compared at its best, every number sourced at its point of use, with its
throughput ceiling from 1 Mbit/s to 1 Gbit/s and 10 to 300 ms and a native client on raw QUIC:
[`quic-compared.md`](quic-compared.md) (rows 156, 157), and what each does to a frame's latency, §8 there (row 158).
Row 157 corrects several of §7.2's facts there.*

* **The client's library matters through throughput and latency, the product's purpose.** It cannot raise either above
  what the server's controller and the link allow; it can only lose them — through its receive cost, its flow-control
  windows, when it acknowledges, its handshake and resumption, and migration. A default is not a limit when the
  setting can be changed or patched: §7 reads the candidates at their best (row 152); §2's tables read them at their
  defaults. At their best, no stack is flow-control-bound at the old 5–50 Mbit/s target, msquic's 64 KiB stream window
  doubles to 16 MiB, and no published study compares tuned stacks at the target's rates with loss (§7.6). *(Corrected
  in place 2026-10-11; this section first opened with the controller point below.)* *Corrected (queue row
  DOCFIX, 2026-10-13):* at the measured links (~100 Mbit/s median, 0.7 s loaded RTT) quinn's 1.25 MB stream window
  binds above 97 ms at 103 Mbit/s and 32 ms at 309; Chromium's 6 MiB does not bind at any idle RTT measured
  ([`../transport/link-conditions.md`](../transport/link-conditions.md) §Verdicts that rest on the band, item 4).
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

Each cell is from §8's sources, read 2026-10-10; **unknown** means searched and not found. GSO is batched send, GRO
batched receive, CC the congestion controller, MP multipath QUIC, WT a WebTransport-over-HTTP/3 client.

### Speed

| stack | published throughput | receive path | send path | pacing · ECN | QIR client, run 2026-10-10T19:16 (partial) |
| --- | --- | --- | --- | --- | --- |
| quinn 0.11.12 / quinn-proto 0.11.19 / quinn-udp 0.5.16 | none; Firefox on quinn-udp: < 1 → 4 Gbit/s | `recvmmsg` ×32 (Linux, Android); GRO Linux, Android; Windows URO off by default (quinn#2041); Apple: one per call unless `fast-apple-datapath` | GSO Linux, Android; Windows USO on (Firefox rolled USO back: loss, a driver crash) | always · yes | G 9 302 kbps, C 4 358; L2, C2 9/9 |
| s2n-quic 1.90.0 | none | GRO and `recvmmsg` on Linux only; none on Android, iOS, Windows | GSO Linux only; needs kernel ≥ 5.0 | yes · yes | G 9 226, C 4 046; all loss cases 10/10 |
| Cloudflare quiche 0.30.0 | 80–90 MB/s with plain `sendmsg` (2020, one laptop) | GRO, `recvmmsg` only in tokio-quiche, Linux | GSO, SO_TXTIME in tokio-quiche, Linux | app honours `SendInfo.at`, but Cubic and Reno get no pacing (*corrected 2026-10-11*, §7.1) · unknown | G 9 240, C 6 004 |
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
| msquic | Cubic; BBR in preview only | no (internal table); statistics event only | 333 ms · none | stream **64 KiB**, doubling to 16 MiB as the reader keeps up (*corrected 2026-10-11*, §7.1); conn 16 MiB | `STREAM_PRIORITY` · yes, off by default |
| Network.framework | not exposed | no | not exposed | `initialMaxData`, `initialMaxStreamData*` | not exposed · yes (iOS 15; Swift `QUICDatagram` iOS 26) |
| ngtcp2 | Reno, Cubic, BBRv2 | no (internal `ngtcp2_cc.h`) | settable · derived | auto-tune caps | in nghttp3 · yes |
| lsquic | Cubic, BBRv1, adaptive (default) | no (internal `cong_ctl_if`) | unknown | 15 MiB conn (client) | yes · yes |
| picoquic | NewReno (default), Cubic, BBRv3, BBRv1, Prague, C4, … | **yes**: `picoquic_congestion_algorithm_t`; per-ACK newly-lost bytes, loss ranges, lost packet number, one-way delay, ECN-CE | 250 ms constant · none public | settable | yes · yes |
| mvfst | Cubic, NewReno, Copa, BBR, BBR2, static, none | **yes**: `CongestionControllerFactory`, `CongestionControlType::Custom` | **50 ms** · — | stream 65 KiB, conn 1 MiB, auto-tune off (§7.2) | yes · yes |
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
  `series-server` build (this tree at `3add8a9`), `cubic-restart`, quinn's default initial window, `stream_mode=shared`,
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

## 7. At their best, not their defaults

*Queue row 152, QUICTUNED, 2026-10-11. Theory only: read from source at the pins in §8, nothing built or timed. A
number marked derived is arithmetic on a sourced one; the owner's decisions are listed in §7.7, not taken.*

**The target, in numbers.** 5–50 Mbit/s, a round trip of 30–80 ms and up to 150 ms, mobile loss
([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md), The target). *Corrected (queue row
DOCFIX, 2026-10-13):* that band is the slow tail; the measured links are 18 · 103 · 309 Mbit/s on cellular (p10 · p50
· p90), 16–55 ms idle and 0.7–0.8 s loaded at the median ([`../transport/link-conditions.md`](../transport/link-conditions.md) §Link profiles). This
section's readings at 5–50 Mbit/s stand as written there; where the band decides one, link-conditions.md re-derives it. The server sends and
the client receives. A lever helps only on the side that owns it, so each lever is read below with its owner.

| owned by | lever | what it bounds |
| --- | --- | --- |
| receiver (the client; the server for an upload) | stream and connection receive windows | throughput, ≤ window ÷ RTT |
| receiver | ACK policy: how many packets per ACK, and how long it may wait | the sender's clock and its loss timer; CPU on both ends |
| receiver | socket receive buffer, batched reads (`recvmmsg`, GRO) | drops when the reader stalls; CPU per byte |
| sender (the server) | controller and initial window | throughput under loss; how fast a fill starts |
| sender | pacing, GSO batch size | burst loss on shallow queues; CPU per byte |
| sender | send window | memory per session |
| both | 0-RTT resumption, migration | the time to reconnect |

### 7.1 Each lever, its mechanism and its numbers

**Receive window: a hard ceiling, set by the receiver.** A sender can have only one window of unread data
outstanding, and it learns that more is allowed one round trip later. So one stream moves at most window ÷ RTT,
whatever the controller does. At 50 Mbit/s and 150 ms that is 50 × 10⁶ × 0.15 ÷ 8 ≈ **0.94 MB**, and a smaller window
caps the link. Raising the window costs nothing until the reader falls behind, and then the window is memory: it is
how much the receiver agrees to buffer.

* **A fixed window** stays at what is set: quinn (1.25 MB), s2n-quic (3.75 MB), and lsquic and mvfst by default.
  quinn's 1.25 MB is chosen in its source for "100 Mbit/s at 100 ms" (`config/transport.rs:366–370`). It caps one stream at
  1.25 MB ÷ RTT: 125 Mbit/s at 80 ms, 67 at 150 ms, 50 at 200 ms (derived). It is above the target at every target
  RTT, by 1.3× at 150 ms. A contributor's runs show the cap exactly: quinn with default windows gave 918, 465, 233
  and 95 Mbit/s at 10, 20, 40 and 100 ms, which is 1.25 MB ÷ RTT within 5 % (quinn issue #2262, 2025-08-12).
* **An auto-tuned window** starts small and doubles when the reader keeps up. Each stack's rule is "the last update
  went out less than about 2 RTT ago" (quiche, ngtcp2, quic-go, Google QUICHE, lsquic and mvfst when on) or "a
  quarter drained within a round trip" (msquic). A window that doubles cannot bind for long, but **it binds at the
  start of every new stream**, which is when a viewer asks for the first frame.
* **The owner's example, read from source:** msquic's stream window starts at **64 KiB**, which is **5.24 Mbit/s at
  100 ms**, but only until its first doubling. `QuicStreamOnBytesDelivered` doubles the window each time a quarter of it
  drains fast enough (`stream_recv.c:807–834`, drain ratio 4, `quicdef.h:355`), up to the 16 MiB connection window:
  1.34 Gbit/s at 100 ms (derived). From 64 KiB to 1 MiB takes four doublings, after 16 + 32 + 64 + 128 = 240 KiB has
  been read (derived; the wall-clock ramp also waits on the sender's slow start, not measured). The cap the owner
  named is real for the first ~quarter of a fresh stream, and is a setting (`StreamRecvWindowDefault`) after that.
* **Defaults that would bind at the target** (derived, at 80 ms): mvfst's 65 KiB stream window with auto-tune off
  → 6.7 Mbit/s; Google QUICHE's bare library default of 16 KB → 1.6 Mbit/s (Chromium sets 6 MB per stream and 15 MB
  per connection); Cloudflare quiche's library default of 0 (the app must set one; tokio-quiche uses 1 MB per stream).
  Each is one setting.

**ACK policy: the receiver sets the sender's clock.** Every ACK is a packet the receiver builds, encrypts and sends,
and one the sender must process. RFC 9000 §13.2.2 says to acknowledge every second packet: at 50 Mbit/s with 1 452-byte
packets that is ~4 300 packets and ~2 150 ACKs a second (derived). Fewer ACKs save CPU on both ends. Jaeger et al.
saw LSQUIC's client fall from 180 k to 46 k ACKs per 8 GB with a larger buffer. Zhang et al. put 2.97 s of Chromium's
8.5 s per GB in "generate QUIC responses (e.g., ACK)". The cost is in the sender's control. It grows its window and
detects loss only from ACKs, and a lost tail waits for a probe timeout that includes the peer's `max_ack_delay`:
`PTO = srtt + max(4·rttvar, 1 ms) + max_ack_delay` (RFC 9002 §6.2.1).

* **What each stack does by default.**
  * Every second packet: quinn, msquic, neqo, ngtcp2, lsquic, quic-go.
  * Every 10th: s2n-quic (hard-coded) and mvfst.
  * Google QUICHE starts at every second packet and moves to every 10th after 100 packets, with a delay of
    min(25 ms, min_rtt ÷ 4); Chromium is built on it.
  * Cloudflare quiche has no ACK timer: it acknowledges in whatever packet the app next asks it to build, which a
    2026 paper measured as ~1 reply per packet sent (Zhang et al., PEMI).
  * picoquic adapts: about a quarter of the window in packets, a delay of RTT ÷ 4 and at most 10 ms.
* **The draft lets the sender choose.** draft-ietf-quic-ack-frequency-14 (2026-02; WG consensus, not an RFC) lets a
  sender ask its peer for an ACK every *n* packets and a maximum delay. It works only when the peer advertises
  `min_ack_delay`. At codepoint `0xff04de1b`:
  * quinn and picoquic advertise it and send the frames, quinn only when the app sets `AckFrequencyConfig`;
  * msquic advertises it and obeys, but never asks;
  * mvfst advertises it only when `minAckDelay` is set;
  * quic-go parses it but does not support it.

  neqo and lsquic use an older codepoint (`0xff02de1a`), so they do not negotiate with the others (derived from the
  codepoints). Chromium 141 does not advertise it, as measured here ([`../CLIENTS.md`](../CLIENTS.md) §ACK frequency).
* **What it buys this product.** In the target range the client spends ≤ 0.05 cores (§6 N1, measured), so fewer
  ACKs are not a throughput lever. The latency lever runs the other way. A **native** quinn client lets the server
  ask for a shorter `max_ack_delay`, which cuts a lost tail's PTO by up to 20 ms (25 → 5 ms, derived). That is the
  "25 ms half of the depth-1 tail" the browser could not be asked for. The flag was removed on 2026-10-03 for want
  of a peer ([`../CLIENTS.md`](../CLIENTS.md)).

**Socket buffer and batched reads: drops and CPU, not the link's rate.** The kernel holds datagrams the app has not
read yet. When the buffer is full, the kernel drops them, and QUIC reads that as congestion. Linux before 6.18 caps a
socket at `rmem_max` = 212 992 bytes unless the host raises it. That is ≈ 34 ms at 50 Mbit/s (derived, an upper bound,
since the kernel counts buffer overhead). So a reader that stalls longer than that, such as a phone's thread
descheduled for a moment, drops packets. Linux 6.18 raised both limits to 4 MiB (`net/core/sock.c`).

* Who sets the buffer: msquic asks for `INT32_MAX` (the kernel clamps it), quic-go for 7 MiB and warns when refused,
  neqo for 1 MiB, Google QUICHE for 1 MiB. quinn, s2n-quic, quiche, ngtcp2, picoquic and lsquic leave it to the app.
  For quinn, the app builds the socket (socket2) and hands it to `Endpoint::new`; for wtransport, `with_bind_socket`.
* Published effect, all far above the target's rate:
  * Jaeger et al.: the 208 KiB default cost 0.1–0.2 % drops at 10 Gbit/s, and a buffer 16× larger gave +3 % to +8.7 %.
  * quinn #2262: an internet path at 10 ms went from 335 to 897 Mbit/s when `rmem_max` went from 212 992 to
    2 097 152; msquic went from 927 to 1 146.
* At the target, the buffer matters for stalls rather than for the link's rate. How often a phone's reader stalls
  for more than 34 ms is not known. Batched reads (GRO, `recvmmsg`) are CPU: §6 N1 measured quinn at 2.1 ms per MB
  with GRO and 3.1 without.

**Pacing and GSO: how bursty the sender is.** A sender with a full window can emit it back to back. A shallow queue at
the bottleneck then drops the tail of the burst, and QUIC reads that as congestion. Pacing spreads the packets out
over the round trip. GSO sends many datagrams in one system call, which cuts CPU, but the kernel releases the batch
back to back unless it is patched.

* quinn always paces, with no switch. It refills a token bucket at 1.25 × cwnd ÷ sRTT, and the bucket holds
  cwnd × 2 ms ÷ sRTT, clamped to 10–256 packets (`pacing.rs:145–151`). It checks the bucket before every datagram of
  a GSO batch, so pacing cuts a batch short. At 50 Mbit/s and 80 ms the burst is the 10-packet floor, 14.5 KB: 2.3 ms
  of the link, or 5.8 ms at 20 Mbit/s (derived).
* Cloudflare quiche **does not pace Cubic or Reno at all**: `get_next_release_time` returns `Immediate`, and only its
  BBRv2 has a pacer. mvfst's pacing is off by default. msquic, ngtcp2 (the app must honour it), picoquic, lsquic,
  neqo, quic-go and Google QUICHE pace by default.
* Published: Kempf et al. ("QUIC Steps", 40 Mbit/s, 40 ms, a 2-BDP queue, each stack's example client and server at
  defaults with Cubic):
  * About half of all packets left back to back.
  * Drops were 503–861 per 100 MiB for quiche, picoquic and ngtcp2, against TCP's 16.5.
  * ngtcp2 reached only 15.93 Mbit/s against 34.67–37.37 for the others.

  Turning quiche's GSO off, or pacing it with a kernel patch, did not lower drops (6.35 → 160–166), which the authors
  put on HyStart++ leaving slow start later. **Pacing quality is the one lever in the target's range with published
  loss numbers, and none of them includes quinn.**
* quinn hard-codes 10 GSO segments per `sendmsg`. This repository's patch raised that to 45, which cut CPU per ask by
  16–21 % ([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §4); the default
  build caps it at 24 since 2026-10-14, −14 to −21 % CPU a MB with no fill or ask worse. That is sessions per
  core, not throughput.

**Initial window, controller, send window: the server's, and already this repository's subject.**
* The initial window decides how many round trips a fill or an ask spends in slow start. It is a setting in every
  stack but picoquic and neqo (constants). Defaults:
  * 12 000 B: quinn;
  * 10 packets: msquic, quiche, ngtcp2, mvfst;
  * 32 packets: quic-go, Google QUICHE, lsquic.
* The controllers and their trial are [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md)'s
  subject (rows 75, 119, 121).
* quinn's 10 MB send window bounds what a session buffers, not the rate (0.94 MB is the target's largest BDP). It is
  memory: 3.7–4.8 MB resident per filling session, measured (§4 there).

**0-RTT: one round trip off a reconnect.** A resumed client sends its request in its first flight (RFC 9001 §4.6), so
a re-dial saves one RTT: 80 ms at 80 ms (derived; today's dial measures 2.12 RTT to ready,
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Other clients). quinn supports it on both ends (`Connecting::into_0rtt`,
`max_early_data_size`). **wtransport 0.7.2 exposes neither**, so a WebTransport client on quinn has no 0-RTT without a
patch to wtransport on both ends. Whether a WebTransport CONNECT may ride 0-RTT was not read. s2n-quic drops 0-RTT
packets ("FIXME … when we support zero-rtt").

### 7.2 Each candidate at its best

*Corrected 2026-10-12 by row 157, which re-read the same pins line by line ([`quic-compared.md`](quic-compared.md)):
the window that matters is the client's for a server-opened unidirectional stream (lsquic's client 32 KiB, picoquic
65 535 B); Google QUICHE's client never auto-tunes; msquic does send ACK_FREQUENCY, Google QUICHE never does, and
mvfst's codepoint is `0xff04de1a`; Cloudflare quiche's window caps are settings; quic-go defaults to Reno; mvfst's
stream window is 66 560 B. The table below is row 152's reading; where it differs, `quic-compared.md` holds.*

Read at §8's pins. "Fork" means a hard-coded constant: changing it means patching the stack. The receiver columns
matter for a client, and the sender columns for a server.

| stack | receive window: default → cap, auto-tune | ACKs: default · ack-frequency draft | socket buffer · batched reads | pacing (sender) | initial window (sender) | fork needed for |
| --- | --- | --- | --- | --- | --- | --- |
| quinn 0.11.12 | 1.25 MB stream, connection unbounded; **fixed**, any value | every 2nd, 25 ms (no setter) · sends and obeys, off until `AckFrequencyConfig` | app's · `recvmmsg` ×32, GRO (Linux, Android) | always, 1.25×, burst 10–256 packets | 12 000 B, settable | GSO 10 segments, 20 datagrams per drive, pacing constants, own `max_ack_delay`, one driver task per endpoint (#1576) |
| s2n-quic 1.90.0 | 3.75 MB all; fixed | **every 10th**, 25 ms settable · none | app's · `recvmmsg`, GRO on | always, bursts of 10 | settable | ACK every 10, burst 10 |
| Cloudflare quiche 0.30.0 | 0 (app sets) → 16/24 MiB; auto | on each packet the app builds, no timer · none | app's · tokio-quiche: GRO, one `recvmsg` | **none for Cubic/Reno**; BBRv2 only | 10 packets, settable | the ACK policy, Cubic unpaced, auto-tune factors |
| neqo 0.32.0 | 1 → 10 MiB stream, 2 → 20 MiB conn; auto | every 2nd, 20 ms · old codepoint, asks for cwnd ÷ 4 packets | 1 MiB · GRO (Linux), URO, Apple fast path | on, burst 2 packets; switchable | constant | caps, burst, initial window |
| Google QUICHE `c8b1052` | 16 KB library (Chromium: 6/15 MB) → 16/24 MB; auto | every 2nd, then 10th after 100, ≤ min(25 ms, RTT/4) · receive behind an off flag | 1 MiB · `recvmmsg` ×16 | on | 32 packets (10–200) | — (flags) |
| msquic 2.6.2 | 64 KiB stream → 16 MiB, conn 16 MiB; **auto** (stream) | every 2nd, 25 ms · obeys, never asks | `INT32_MAX` · `recvmmsg`/`sendmmsg` ×53, GRO, GSO after a self-test | on, settable | 10 packets, settable | drain ratio, ack tolerance, batch 53 |
| ngtcp2 1.25.0 | app's (examples: client 16 MiB stream) → `max_stream_window`; auto off until set | every 2nd, ≤ min(25 ms, srtt/8) · none | app's · examples: GRO, one `recvmsg` | computed, app honours | min(10 MSS, 14 720) | auto-tune factors, ACK delay rule, pacing gain |
| lsquic 4.10.0 | client 6 MiB stream, 15 MiB conn; auto off | every 2nd, 25 ms (fixed) · old draft, PID-tuned tolerance | app's · app's | on | 32 × 1 460 B | ACK every 2, 25 ms |
| picoquic `v2026.10.09` | 2 MiB local stream, 1 MiB conn → unbounded; auto | adaptive: ~¼ window, ≤ 10 ms · sends and obeys | off unless set · plain `recvmsg` ×10, no GRO | always | 15 360 B, no setter | ACK algorithm, batch 10, initial window |
| mvfst `v2026.10.05.00` | **65 KiB stream**, 1 MiB conn; auto off (caps 16/32 MiB when on) | every 10th · only if `minAckDelay` set | — · GRO off, `recvmmsg` off by default | **off** by default | 10 MSS | — (settings) |
| quic-go 0.63.0 | 512 KiB → 6 MiB stream, 768 KiB → 15 MiB conn; auto | every 2nd, 25 ms · parsed, unsupported | 7 MiB · `recvmmsg` ×8, no GRO | on, 5/4× | 32 × 1 280 B | — |
| Network.framework | `initialMaxData`, `initialMaxStreamData*` settable; defaults and auto-tune undocumented | not exposed | not exposed | not exposed | not exposed | everything else (closed) |
| Cronet / HttpEngine | not exposed (QUICHE tags pass through `addConnectionOption`) | `AKDU`/`AKD3` tags | not exposed | QUICHE's | QUICHE's | everything else |

xquic and tquic were not re-read this round; §2 holds what row 124 found.

**In plain words.** At its best, every candidate but the two platform stacks can be given windows far above the
target's 0.94 MB, so **flow control binds no tuned stack in the target range**. What stays different at their best is:

* how often each acknowledges, which is a fork in s2n-quic, lsquic and Cloudflare quiche;
* whether it paces: never for Cloudflare quiche's Cubic, and not by default in mvfst;
* how it batches reads, which is CPU;
* what its controller does under loss, which only a public hook lets this repository change: quinn, Google QUICHE,
  picoquic, mvfst and xquic (§2 Control).

### 7.3 Every published result, on one table

"Tuned" means a stack's settings were changed from its defaults for the run. "Defaults" means they were not, or the
source does not say.

| source | stacks | setup: link · RTT · loss · hardware | settings | result |
| --- | --- | --- | --- | --- |
| Bünstorf & Jaeger, TUM seminar SS 23 | picoquic, quiche, LSQUIC, msquic | 10GBase-T back to back · none stated · none stated · three host pairs; one 1 073 MB file, 10 runs | **not stated** | msquic 5 443 / 4 845 / 3 898 Mbit/s, LSQUIC 2 568 / 4 416 / 3 543, quiche 1 847 / 2 525 / 2 441, picoquic 1 445 / 1 957 / 1 579 (E5-1650 v3 / Gold 6312U / EPYC 7543) |
| Jaeger et al., IFIP Networking 2023 | aioquic, quic-go 0.31.1, mvfst, picoquic, quiche, LSQUIC (commits in its artifact) | 10 Gbit/s · LAN · none · EPYC 7543, kernel 5.10; 8 GB, 50 runs | Cubic or Reno; LSQUIC and quiche windows set to their apps' defaults; else defaults | 52–3 004 Mbit/s across pairs; TCP 8 010; 208 KiB buffer drops 0.1–0.2 %; larger buffer +3 to +8.7 %; GSO/GRO: goodput flat, client CPU 82 → 92 % |
| Kempf et al., "QUIC Steps", CoNEXT 2025 | quiche, picoquic, ngtcp2 | **40 Mbit/s · 40 ms** · queue 2 BDP · I210, kernel 6.1-rt; 100 MiB, 20 runs | defaults, Cubic, 50 MiB receive buffer | 34.67 / 37.09 / 15.93 Mbit/s, TCP 37.37; drops 687 / 861 / 503 against 16.5; ~50 % of packets back to back |
| Zhang et al., WWW '24 | Chromium against LSQUIC (OpenLiteSpeed 1.7.15) | 1 Gbit/s · LAN · none · Xeon E5-2640 / i7-6700, Pixel 5 on 5G; 1 GB | buffers > 10 BDP; Cubic | H3 18.60 s against H2 9.32 s; Pixel 5 78.65 s against 37.11 s; receive 8.5 s per GB, 2.97 s in responses |
| quinn #2262, 2025 (contributors) | quinn, msquic `secnetperf`, s2n-quic | docker, no loss, 0–100 ms; and an internet path at 10 ms | **quinn at defaults against secnetperf's tuned harness** (128 MiB server window) | at 100 ms: quinn 95 Mbit/s (its 1.25 MB window), s2n-quic 286–292, msquic 2 237–2 812; at 0 ms: 11.8–12.4, 13.0, 14.8–16.4 Gbit/s; quinn with 8–16 MB windows ≈ 1 Gbit/s on the internet path |
| msquic netperf dashboard, read 2026-10-11 | msquic | 200 Gbit/s NICs in VMs, and Azure 4-vCPU · RTT not stated · none; 1 connection, 12 s | tuned harness (128 MiB window, send buffering off) | download 7.8–8.0 Gbit/s Linux, 6.2–8.0 Windows lab, 11.5–12.0 Azure Windows; TCP 14.5–25.0 |
| Cloudflare, 2020-01-08 | quiche (NGINX) | not stated; h2load, 100 MB × 10 | sendmsg, sendmmsg, GSO | 80–90 MB/s with plain `sendmsg`; the rest charts only |
| Huitema, 2023-12-12 and 2024-10 | picoquic | loopback, a Windows laptop | Cubic, BBR | 1.5–2 Gbit/s (2023); Cubic 3 Gbit/s, BBR 1.7 (2024); ACK gap capped at 32: Cubic 1.3–1.8 → 3.4 Gbit/s |
| LiteSpeed, 2020-06-01 | lsquic | 10 GbE, KVM guest · LAN · none | UDP against XDP | 102 → 146 MB/s with XDP; server CPU-bound |
| Inden, 2025 | neqo (Firefox) | CPU-bound, loopback | quinn-udp batching | < 1 → 4 Gbit/s; `mmsg` +11 % on loopback |
| PEMI, Zhang et al., arXiv 2602.12732 | quiche, quinn, quic-go | Mininet 2 ms 0–5 % 100 Mbit/s and 50 ms 10 Mbit/s; a cellular trace | defaults | quiche clients reply to ~100 % of packets, quinn and quic-go ~50 %; PEMI −45 to −70 % median frame delay on the trace |
| Sidhu & Bentaleb, arXiv 2505.21769 | aioquic, mvfst, picoquic, LSQUIC, quinn, TQUIC, xquic | 5G and LTE traces, TBF | defaults; then aioquic's windows raised | raising aioquic's windows: +16 % VMAF, −84 % RTT |
| QUIC interop runner, run 2026-10-11T19:32 (partial) | picoquic server against five clients | 10 Mbit/s · 15 ms · 25-packet queue (simulator) | each image's defaults | 9 194–9 408 kbps goodput; quinn client 9 263 |
| this repository, §6 N1 (row 135) | Chromium 141, wtransport and web-transport-quinn on quinn 0.11.11 | loopback; 20 and 50 Mbit/s, 20 ms each way, 2 % loss | defaults, `cubic-restart` server | quinn 2.05–2.16 ms CPU per MB with GRO, 3.1 without, Chromium 4.0–4.3 (network service); under 2 % loss Chromium 5–9 % slower |

Kernel and UDP path, not QUIC: de Bruijn and Dumazet, LPC 2018, found UDP GSO 1.6× more efficient per cycle at
10 Gbit/s, and GRO about 1.8× (preliminary). Tailscale's 2023 post measured wireguard-go going from 8.32 to
13.0 Gbit/s with UDP GSO and GRO. Earlier: Langley et al., SIGCOMM 2017, for 0-RTT (88 % of gQUIC handshakes) and
15 MB client windows; §3's papers. Not read (publisher refused): Custura et al. 2022 on ACK frequency, Kempf et al.
2024 (journal), and the full text of Marx et al. 2020.

**What the table shows.**
* **Only one study ran inside the target's range**: Kempf et al., at 40 Mbit/s and 40 ms, clean, with three stacks
  at defaults and neither quinn nor msquic.
* **No published study compares tuned stacks at 5–50 Mbit/s with RTT and loss.** Searched: arXiv's QUIC titles for
  2024–2026, and quinn, msquic, mobile, pacing, flow control and acknowledgement.
* **Every multi-gigabit result measures CPU per byte, not link behaviour.**
* **The one quinn-against-msquic comparison sets defaults against a tuned harness.** quinn's 95 Mbit/s at 100 ms is its
  window, not its speed.

### 7.4 The owner's paper, read critically

Bünstorf and Jaeger, "MsQuic – A High-speed QUIC Implementation", TUM seminar IITM SS 23, doi
10.2313/NET-2023-11-1_01. Row 152's reading is **confirmed**, with three notes.

* **What it is.** A student seminar paper using Jaeger et al.'s framework ("we used the test framework by Jaeger et
  al. [13]").
* **The setup.**
  * One 1 073 MB file, ten runs per stack, 10GBase-T back to back.
  * Added delay and loss are **not mentioned at all**: "none" is inferred from their absence.
  * HTTP version, OS and kernel are not stated.
  * Four stacks, no quinn. No versions, windows, buffers, controllers or GSO settings are stated.
* **The numbers.** Its Figure 3 gives msquic 5 443, 4 845 and 3 898 Mbit/s, the highest on every pair.
  * Its text calls 3 898 "the lowest goodput on this host pair", and its next paragraph says msquic "still
    surpasses all the other implementations on the newer hardware".
  * "Double the goodput of LSQUIC" holds on the E5-1650 v3 alone (×2.12); on the newer two it is ×1.10 and ×1.10.
  * Its text describes four host pairs and reports three.
* **[13] does not include msquic.** Jaeger et al. ran aioquic, quic-go, mvfst, picoquic, quiche and LSQUIC, so the
  seminar's settings cannot be read from [13]. Their artifact sets LSQUIC's and quiche's windows to those apps'
  defaults and changes nothing else.
* **A reason the ranking may be partly configuration, not code (a hypothesis, unmeasured).** msquic asks the kernel
  for an `INT32_MAX` receive buffer itself, while [13] found the 208 KiB default dropping packets for the other stacks.
* **What it bears on.** It measures CPU-bound bulk goodput at 4–5 Gbit/s on servers: CPU per byte. That is a phone's
  battery and a server's sessions per core. It is not throughput or latency at 5–50 Mbit/s with RTT and loss, where
  every stack here is far from CPU-bound (§6 N1).

### 7.5 The server's stack as a candidate

The server is the sender, so its stack decides four things. Each is set against what is published:

* **Its controller, under loss.** This is the lever with the most at stake (row 119's options). A stack can carry
  this repository's controllers only through a public hook: quinn's `Controller` (today), Google QUICHE's
  `SendAlgorithmInterface`, picoquic's algorithm table, mvfst's `CongestionControllerFactory`, or xquic's callback.
  msquic, s2n-quic (behind an unstable feature), quiche, ngtcp2, lsquic, neqo and quic-go would need a fork.
* **Its pacing.** quinn paces always, in bursts of at least 10 packets. No published loss result includes quinn, so
  whether another stack's pacing loses less on the target's queues is open (§7.6).
* **Its send cost per byte, which sets sessions per core.** Target sessions run at ~0.4–0.7 % of a core each at
  20 Mbit/s (measured, transport-conclusions The target), so this is the cost at thousands of sessions, not the link
  rate. *Corrected (queue row DOCFIX, 2026-10-13):* at the measured median of 103 Mbit/s a fill costs 2.6–4.0 % of a
  core, ~31 sessions a core against ~160 at 20 (derived, [`../transport/link-conditions.md`](../transport/link-conditions.md) §Verdicts that rest on the
  band, item 1). The one comparison at equal settings is quinn #2262 at 0 ms: quinn 11.8–12.4, s2n-quic 13.0, msquic 14.8–16.4
  Gbit/s on one connection. That puts msquic about 1.3× ahead, inside a 10× margin that CPU is not using today
  (derived). The comparison is a contributor's docker setup, not a server's workload.
* **Its memory per session.** quinn's 10 MB send window is a setting.

**What changing the server's stack would cost**, read from this tree:

* **The WebTransport layer.** Today it is wtransport 0.7.2 over quinn. A replacement needs a WebTransport-over-HTTP/3
  server on the new stack. Released: lsquic 4.10.0 (`es_webtransport_server`). Unreleased or branches: Google QUICHE,
  picoquic's picowt, ngtcp2/nghttp3. None for msquic, s2n-quic or quic-go's core (webtransport-go refuses this
  server's clients today, §4).
* **The controllers.** `restart.rs`, `loss_bound.rs` and `cc_trace.rs` (the last in `lab/server-telemetry`; 927 lines, with their tests) implement quinn's
  `Controller` trait and read quinn-proto's `RttEstimator`. They would be ported to the new hook, or lost on a stack
  without one.
* **The session code.** `server/src/transport/server.rs` (1 912 lines) and the stream code (`wire.rs`, `frame_out.rs`,
  `pipeline.rs`) are written against wtransport's API. The quinn GSO patch (`patches/`, checked by the gate) goes away
  or is replaced.
* **The contract.** [`../WIRE.md`](../WIRE.md)'s messages need not change, but every claim about them (stream mode,
  framing, exactness) would be re-proved on the new stack.
* **The gate.** Its server tests run against wtransport's client; a C stack adds a C build to the gate.

**In plain words.** Nothing published shows another server stack moving bytes faster or with less latency than quinn
at the target's rates, tuned or not. What a change could buy is sessions per core, ~1.3× on the one comparable
reading, and possibly better behaviour under loss, which is unpublished. Against that it costs the WebTransport layer,
927 lines of controller work and the gate. **Theory does not make the case for a change; it names the two
measurements that could** (§7.6).

### 7.6 What theory settles, and what it cannot

**Settled from source and published numbers:**
1. **No tuned stack is flow-control-bound in the target range.** quinn's fixed 1.25 MB covers 50 Mbit/s up to 200 ms.
   The auto-tuned stacks double past the target's BDP within a fresh stream's first few hundred KB. The defaults
   that would bind (mvfst, bare Google QUICHE, quiche's 0) are one setting each.
2. **msquic's 64 KiB is a starting window, not a cap.** It doubles to 16 MiB. The owner's 5 Mbit/s at 100 ms holds
   only for the first quarter-window of each new stream.
3. **The receive path is CPU, not rate, at the target** on desktop: ≤ 0.05 cores at 50 Mbit/s (§6 N1, measured).
   GRO saves a third of quinn's receive CPU.
4. **ACK frequency is a latency lever only a native client can unlock.** A server on quinn can ask a quinn client
   for a shorter `max_ack_delay`, up to 20 ms off a lost tail's PTO (derived). Chromium does not advertise the
   extension.
5. **0-RTT on quinn needs a wtransport patch on both ends, or a raw-QUIC ALPN** (§4). It saves one RTT per re-dial.
6. **The owner's paper ranks CPU efficiency at 4–5 Gbit/s with unstated settings.** It does not bear on the target's
   throughput or latency.

**Open, each in one line, for the owner to decide whether to measure:**
* *Sessions per server core* on quinn, msquic and one other sender at a fixed 20 Mbit/s each. Nothing published.
* *Loss under each stack's pacing* on a shallow queue at 20–50 Mbit/s with mobile loss, stacks tuned. Only Kempf et
  al.'s clean 40 Mbit/s run exists, without quinn.
* *Why Chromium is 5–9 % slower than quinn under 2 % loss* (§6 N1). A candidate mechanism: QUICHE's ACK decimation
  to every 10th packet with a ¼-RTT delay slows the sender's loss detection. Unmeasured.
* *How often a phone's reader stalls past the socket buffer* (≈ 34 ms at 50 Mbit/s with 208 KiB). Also unknown:
  Android's default `rmem_max`, and whether an app may raise its own buffer there.
* *What a shorter `max_ack_delay` buys a lossy ask's p95* with a native quinn client. Derived only.
* *iOS*: §6 N3 already.

### 7.7 The owner's decisions (listed, not taken)

1. **The native client's receive settings.** Keep quinn's defaults, which are above the target. Or set them
   explicitly: windows sized to the largest BDP (~1 MB at 50 Mbit/s and 150 ms), and a socket receive buffer raised
   through `with_bind_socket`.
2. **ACK frequency toward native clients.** Restore the server's `AckFrequencyConfig` (removed 2026-10-03 for want of
   a browser peer) for quinn clients, or not.
3. **0-RTT.** Patch wtransport on both ends; use 0-RTT only on a raw-QUIC ALPN (decision 2 of §5); or leave it.
4. **The server's stack.** quinn stays, which is what theory supports today. Or the owner measures the two open items
   above (sessions per core, loss under pacing) before a stack is chosen for the long term.

## 8. Sources

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

**Row 152 (§7), fetched 2026-10-11**, pinned the same way:

* **quinn** 0.11.12 (`4051e23e9185`), quinn-proto 0.11.19 (`0e750cca55fe`; `config/transport.rs` `6921939145be`),
  quinn-udp 0.5.16 (`af66907df186`) and 0.6.3 (`47091c86514c`); wtransport 0.7.2 (`b4273ce3157a`). quinn issues
  #2262, #1126, #1576, read live on GitHub (the API refused a hashed copy).
* **s2n-quic** 1.90.0 (`dc6fef951224`), -core 0.90.0 (`eb550bfe8d41`), -transport (`5d8cca099376`), -platform
  (`8796d0d3dc8d`). **neqo** `v0.32.0` (`28cacc8ea2b0`).
* **msquic** `v2.6.2` (`819ab74f851e`): `Settings.md` `da803bd4ea02`, `settings.c` `e5161a97a6ba`, `quicdef.h`
  `b4e1012cd2bd`, `stream_recv.c` `426854b5b81b`, `send_buffer.c` `626209cb7670`, `datapath_linux.c` `84fea9daeffe`,
  `datapath_winuser.c` `d98b5eb9a5c6`. The netperf `deploy` branch's result files (`1bcdca29c8bb`, `3735e2b36259`,
  `d6eeeb4c09e3`, `634416013a59`) and its `secnetperf.md` (`008e39e6920f`).
* **Cloudflare quiche** `0.30.0` (`07671779dead`: `flowcontrol.rs` `ec1f8d02cbef`, `congestion/recovery.rs`
  `8574077a38fb`, `gcongestion/pacer.rs` `ad35e18573cc`); tokio-quiche `0.20.0` (`84857b7e8ee4`; `settings/quic.rs`
  `aaef8ad4b0ae`, `quic/io/gso.rs` `063c4d9051fd`).
* **ngtcp2** `v1.25.0` (`843aa72100b5`; `ngtcp2_conn.c` `c7c2515c1944`, `ngtcp2_settings.c` `f282b9f41002`, `ngtcp2_cc.c`
  `f3e18b883759`, `examples/client_base.h` `c9f596e9d331`); nghttp3 `v1.18.0` (`868e81b343d1`).
* **picoquic** `v2026.10.09.938685c` (`frames.c` `6c01e6fb03d7`, `quicctx.c` `8121babf41f3`, `pacing.c` `525889ca9d1f`,
  `sockloop.c` `77f9b7cda903`). **lsquic** `v4.10.0` (`lsquic.h` `fb84c9add4b3`, `lsquic_engine.c` `ae4cb4a84cd3`,
  `lsquic_full_conn_ietf.c` `085a89b42fbc`, `lsquic_send_ctl.c` `d24ad24cc604`).
* **quic-go** `v0.63.0` (`flow_controller_base.go` `290f7a2495f8`, `internal/protocol/params.go` `ffb7c4be1bcb`,
  `received_packet_tracker.go` `1c496fb40b02`, `connection.go` `168593a4b6fe`, `sys_conn_buffers.go` `0a89b5f76413`,
  `pacer.go` `0b54925fc279`). **mvfst** `v2026.10.05.00` (`TransportSettings.h` `153fa17f8321`, `QuicConstants.h`
  `b629e036ce32`).
* **Google QUICHE** `c8b1052048f1` (`quic_received_packet_manager.cc` `64a7c3c9a3b8`, `quic_flow_controller.cc`
  `df119c2fc56d`, `quic_constants.h` `8b38b35a52cd`, `quic_config.cc` `408ed26a4e5a`, `quiche_protocol_flags_list.h`
  `14cf4084c39c`); Chromium `9de79faf785b` (`net/quic/quic_context.cc` `5bf388311d45`, `QuicOptions.java`
  `38a8a3c143d3`). Apple `NWProtocolQUIC.Options` JSON (`04576994859a`), `initialMaxData` (`77871ac30c44`).
* **IETF and kernel**: draft-ietf-quic-ack-frequency-14 (`aed59e2a6fd2`); RFC 9000 (`f88aae47f8b1`), 9001
  (`3bbaecdf5afd`), 9002 (`3a8a54eea1ad`); Linux `net/core/sock.c` at v6.17 (`25305e30f6a8`) and v6.18 (`42d20ab6d561`).
* **Papers and posts**: Bünstorf & Jaeger, the TUM PDF (`624c3d3d9a83`); Jaeger et al.'s artifact `tumi8/quic-10g-paper`
  `936484444d62`; Kempf et al.'s artifact `tumi8/quic-pacing-paper` `7c2161cc171c`; PEMI, arXiv 2602.12732v1
  (`4185b441392c`); Sidhu & Bentaleb, arXiv 2505.21769v2 (`847970b51385`); de Bruijn & Dumazet, LPC 2018
  (`46d3c424defa`); Tailscale, 2023-04-13 (`b1e1bc0d24cb`); Cloudflare 2020 (`47f5497601ab`); C. Huitema,
  2024-10-13 (`afcaf1844cf7`), 2024-10-23 (`98245e0a047c`), 2022-12-13 (`189b176c7969`); LiteSpeed, 2020-06-01
  (`4807f37c3ac0`). Interop runner: `logs/quic/logs.json` (`3b11fd8a2ebc`), run 2026-10-11T19:32 per-pair
  `output.txt` files (partial; every `result.json` 404).

**Not read**, so not cited: Kempf et al., Computer Communications 2024 (publisher 403, API 429); the full texts of
Marx et al. and Seemann & Iyengar (ACM 403); every QUIC `result.json` of the interop runner (404); GitHub's release
and advisory pages for the C stacks (403); Firefox's security advisories for neqo. Row 152: Custura et al. 2022 (Wiley 403), Kempf et al. 2024
(still refused), the full text of Marx et al. 2020, Google's ACK-decimation results (not found).
