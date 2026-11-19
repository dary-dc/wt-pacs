# HTJ2K over four stacks: WebTransport, HTTP/3 fetch, HTTP/2 fetch, WebSocket — theory and a prediction per profile

*2026-11-17, queue row TRANSPORT-THEORY. **Theory and sources only: nothing was run.** Every number is a source's,
a measurement already in this repository (linked), or arithmetic on those, marked (D). The pre-registered protocol
that tests it is TRANSPORT-PROTOCOL's, by a session that wrote none of this and will not run it: §5.*

**The question.** With the codec fixed to HTJ2K (the exact series alone), so only the transport varies: what does
each stack do with RTT, loss and connection setup, and what should a fill, the first frame and an ask cost on each
of LINK-TARGETS' profiles (`claude/link-targets:docs/transport/link-profiles.md`)?

**The answer, short (theory).**

* **The fill ties on every profile** where the wire binds (×0.95–1.05 against our session): the four stacks run the
  same controller family, Cubic, with slow start restarted after a silence, under the same 6 MB per-stream receive
  credit in Chromium (or the kernel's autotuned buffer for the WebSocket). The loss slope is the controller's, and
  the shared stream already holds every frame behind a loss, as TCP does; both were measured here (§2).
* **Connection setup is where they part**: a cold first frame costs one round trip more over TCP + TLS (+ the
  WebSocket upgrade) than over QUIC, and a pooled HTTP connection already up costs none. Over the ~7–8 round trips
  of slow start a 2.15 MB frame needs anyway, that is ±10–15 % (D), most on high-RTT profiles.
* **An ask during a fill** is the one place the stacks differ by design: our server orders one stream; a fetch arm
  relies on the browser's advisory priority or an abort; the WebSocket waits behind the kernel's send buffer, not
  quinn's. ×0.7–2.0 (§3), the widest band here.
* **CPU per byte** should favour the kernel's TCP (offloads, no per-datagram crypto in userspace): unsourced as a
  number, a prediction to measure.
* Of the four arms, **only WebTransport and the WebSocket are built**; both fetch arms need a GET path on the server
  ([`../delivery-prior-art.md`](../delivery-prior-art.md) §8 *What the server would need*).

---

## 1 · What each stack is, from its sources

Read 2026-11-17. RFCs from rfc-editor.org text; the WebTransport draft at revision -17
(<https://www.ietf.org/archive/id/draft-ietf-webtrans-http3-17.txt>); Chromium at tag `141.0.7390.37` (the lab's
browser) and `158.0.8127.42` (Android stable on 2026-11-17 by chromiumdash), from chromium.googlesource.com; Linux at
`v6.12` (the documentation of the server's kernel defaults). Quotations verbatim.

| arm | layers | built here |
| --- | --- | --- |
| **WT**, our session (TS and WASM clients) | one QUIC connection, HTTP/3 extended CONNECT, one control bidi, **one shared uni stream** for every frame | yes, the default ([`../design.md`](../design.md)) |
| **H3 fetch** | QUIC, HTTP/3, a GET a frame (a stream each) or a GET a fill (frames in order on one response) | no |
| **H2 fetch** | TCP, TLS 1.3, HTTP/2, the same two shapes as streams of one TCP connection | no |
| **WS** | TCP, TLS 1.3, an HTTP/1.1 Upgrade, one WebSocket; binary messages of 64 KiB carry the shared stream's bytes | yes, behind `--websocket` ([`../../WIRE.md`](../../WIRE.md) §The WebSocket mapping) |

**Head-of-line blocking.** QUIC: "When a packet loss occurs, only streams with data in that packet are blocked
waiting for a retransmission to be received, while other streams can continue making progress" (RFC 9000 §13).
HTTP/2: "Note, however, that TCP head-of-line blocking is not addressed by this protocol" (RFC 9113 §1). The
WebSocket "consists of an opening handshake followed by basic message framing, layered over TCP" (RFC 6455
abstract): one byte stream. **Our WT arm puts every frame on one stream**, so a loss holds the frames behind it there
too; only H3 fetch with a GET a frame has per-frame independence, the shape measured as `per-frame` and level with
the shared stream once the server ordered it ([`../../adr/stream-shape.md`](../../adr/stream-shape.md)).

**Connection setup.** "QUIC relies on a combined cryptographic and transport handshake to minimize connection
establishment latency" (RFC 9000 §7). TCP first runs its handshake: "The "three-way handshake" is the procedure used to establish a
connection" (RFC 9293 §3.5), then TLS 1.3's full handshake (RFC 8446 §2, one round trip), and the WebSocket then its opening
handshake, an HTTP Upgrade "intended to be compatible with HTTP-based server-side software and intermediaries"
(RFC 6455 §1.3). Counted in round trips before the first response byte, TLS 1.3 without early data (D):

| arm | cold, first visit | resumed or pooled |
| --- | --- | --- |
| WT | 2.1 to a ready session, the opening ask in the URL ([`../design.md`](../design.md) §Open, lab, not on a link) | the same: a dedicated connection every session, never resumed in 216 dials ([`../transport-conclusions.md`](../transport-conclusions.md) §9 *Closed*); "Clients cannot initiate WebTransport sessions in 0-RTT packets, as the CONNECT method is not considered safe" (draft -17 §3.2) |
| H3 fetch | 2 (QUIC 1, GET 1) **only with** an HTTPS record or a cached `Alt-Svc`; else H2's 3 ([`../delivery-prior-art.md`](../delivery-prior-art.md) §8) | 1 on the page's pooled connection; 1 in 0-RTT on a resumed one (a GET is safe) |
| H2 fetch | 3 (TCP 1, TLS 1, GET 1) | 1 on the pooled connection |
| WS | 3 (TCP 1, TLS 1, Upgrade 1), the opening ask on the upgrade's URL ([`../../WIRE.md`](../../WIRE.md) §The WebSocket mapping) | 3: a new connection every session |

**Congestion control.** WT and H3 fetch from our server send with quinn and the server's controller,
`cubic-restart` by default. H2 fetch and WS send with the kernel's: Linux's default is Cubic (`net/ipv4/Kconfig`:
`default "cubic"`), its initial window "TCP initial congestion window as per rfc6928", `TCP_INIT_CWND 10`
(`include/net/tcp.h`), against quinn's 12 000 B; and `tcp_slow_start_after_idle`, "If set, provide RFC2861 behavior
and time out the congestion window after an idle period. An idle period is defined at the current RTO. … Default: 1"
(`Documentation/networking/ip-sysctl.rst`) — the kernel's own slow-start restart, so the restart our default adds to
quinn is already the kernel's. *Corrected 2026-11-17 by TRANSPORT-PROTOCOL: ours is not an idle restart; quinn keeps its window
through a silence and `cubic-restart` restarts only after an outage that ends in loss (§5.0).* Where they still differ: the idle threshold (one RTO for the kernel; ours,
[`../transport-conclusions.md`](../transport-conclusions.md) §3 *After a blink*) and the loss detection (RFC 9002
against the kernel's), not compared from sources here.

**Receive credit, the browser's side.** Chromium 141 and 158 alike: `kQuicSessionMaxRecvWindowSize = 15 * 1024 *
1024; // 15 MB`, `kQuicStreamMaxRecvWindowSize = 6 * 1024 * 1024; // 6 MB` (`net/quic/quic_context.cc`), and for
HTTP/2 `kSpdySessionMaxRecvWindowSize = 15 * 1024 * 1024; // 15 MB`, `kSpdyStreamMaxRecvWindowSize = 6 * 1024 *
1024; // 6 MB` (`net/http/http_network_session.cc`), sent as `SETTINGS_INITIAL_WINDOW_SIZE` in place of the
protocol's "initial value … 2^16-1 (65,535) octets" (RFC 9113 §6.5.2). The WebSocket has no window of its own: the
kernel's receive buffer, autotuned to `tcp_rmem`'s max, "Default: between 131072 and 6MB, depending on RAM size"
(ip-sysctl.rst); Android's value was not read. One stream's rate is bounded by credit ÷ RTT (D):

| RTT | 2 ms | 10 | 38 | 56 | 825 (LTE loaded median) |
| --- | --- | --- | --- | --- | --- |
| 6 MiB a stream (WT, H2, H3 a GET a fill) | 25 Gbit/s | 5.0 | 1.3 | **0.90** | **0.061** |
| 15 MiB a connection (H3 or H2, a GET a frame, several in flight) | 63 | 12.6 | 3.3 | 2.2 | 0.15 |

So the shared stream's credit binds before the link only on mmWave (1 467 Mbit/s measured with 8 streams) and on
LTE when the queue is full; there **H3 fetch with a GET a frame** has 2.5× the credit, the one place a stack's shape
alone predicts a faster fill (D, theory).

**WebSocket over HTTP/2 or HTTP/3.** RFC 8441 (and RFC 9220 for HTTP/3) carry a WebSocket on an extended CONNECT
stream. Chromium 141 parses the server's `SETTINGS_ENABLE_CONNECT_PROTOCOL` (`net/spdy/spdy_session.cc`), and keeps
`BASE_FEATURE(kEnableWebsocketsOverHttp3, base::FEATURE_DISABLED_BY_DEFAULT)` in 158 (`net/base/features.cc`). Our
server speaks the HTTP/1.1 upgrade only; the WS arm is that.

## 2 · What is already measured here, and holds for HTJ2K

* **The loss slope is the controller's.** Depth-1 asks of 256 000 B through the relay at 80 ms, Gilbert–Elliott
  loss: QUIC Cubic +339 ms a percent at the median, kernel TCP Cubic +354; BBR +1 against +18
  ([`../transport-conclusions.md`](../transport-conclusions.md) §5 *The ask's loss sensitivity*, 2026-10-02).
* **Head-of-line blocking in a fill ties.** During a 40-frame fill at 1 % loss, frame gap p99 1 522 ms over the
  WebSocket against 1 368 over the shared stream, 9 rounds (the same).
* **An ideal TCP is the floor**: the WebSocket through the relay's TCP plane with no loss taxed an ask +1.6–1.7 ms
  over RTT + size ÷ rate, Cubic over QUIC +2.4 to +13.7 (§5 *The controller's tax*). That floor had no loss and no
  window; it bounds the WS arm from below, it does not predict it.
* **The handshake.** A swallowed UDP dial costs 4 004 ms before a fallback can start
  ([`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §The TCP fallback): a reachability cost no TCP arm pays.

Fixtures of those rows: synthetic asks of 256 KB and a 40-frame fill, not HTJ2K; the userspace relay, not a radio;
4-core cloud hosts, headless Chromium.

## 3 · Predictions per profile (theory)

Ratios are each arm's against **WT with the TS client**; < 1 is faster. The HTJ2K series is `dbts_b1`'s 50 frames,
2.15 MB a frame, 859 Mbit in all (`claude/link-targets:docs/transport/link-profiles.md` §2). "Ties" is ×0.95–1.05. The WASM
client is predicted to tie the TS client on the wire everywhere (the same session; a native-wire parity check tied,
[`../../client/evidence/native-client-wire-parity.md`](../../client/evidence/native-client-wire-parity.md)), and is
left out of the table.

**The fill (50 frames).** Wire-bound on every profile but mmWave and the measured home Wi-Fi (link-profiles §2).

| profile | WT, predicted wire time (D) | H3 fetch | H2 fetch | WS | why |
| --- | --- | --- | --- | --- | --- |
| home Wi-Fi, measured (≥ 600 Mbit/s, 2 ms) | 1.43 s, near the unmeasured phone decode | ties | ties | ties | decode or link, not the stack |
| home Wi-Fi, median (218, 10 ms) | 3.9 s | ties | ties | ties | same controller family, credit far above BDP |
| enterprise Wi-Fi (unknown) | — | ties | ×0.95–1.10 | ×0.95–1.10 | a hop tail of p99 ~250 ms hits the one-byte-stream arms on reordering, not loss |
| public Wi-Fi (~101, RTT unpublished) | 8.5 s | ties | ties | ties | — |
| LTE, one far stream (27–85, 38 ms, 0.1 % loss) | 10–32 s | ties | ties | ties | the loss slope is the controller's (§2) |
| LTE, queue full (loaded RTT ~825 ms) | credit-bound at ~61 Mbit/s | ×0.6–1.0 with a GET a frame | ties | ×0.5–1.2 | 6 MiB a stream ÷ 825 ms; the WS's kernel buffer, unread on Android, can be above or below it |
| 5G sub-6 (284–771 PHY, unknown RTT) | 1.1–3.0 s | ties | ties | ties | — |
| 5G mmWave (1 467, 56 ms, 0.01 %) | 0.96 s credit-bound (6 MiB ÷ 56 ms ≈ 900 Mbit/s); decode 1.3–1.8 unmeasured | ties if the decode binds; ×0.65–1.0 with a GET a frame if not | ties | ×0.9–1.1 | the shared stream's credit is the first bound below the link |

**The first frame, cold** (2.15 MB from a fresh connection). Slow start from ~12–14.5 kB takes ~7–8 round trips to
deliver 2.15 MB when the BDP is not reached (D: 12 000 × (2⁸ − 1) = 3.06 MB), plus setup (§1):

| profile, RTT | WT (2.1 + ~8) | H3 fetch, HTTPS record (2 + ~8) | H3, no record = H2 (3 + ~8) | WS (3 + ~8) |
| --- | --- | --- | --- | --- |
| home Wi-Fi measured, 2 ms | ~20 ms + decode | ties | ties | ties (< 2 ms apart, below the decode) |
| home median, 10 ms | ~100 ms | ties | ×1.05–1.15 | ×1.05–1.15 |
| LTE, 38 ms, 50 Mbit/s | ~0.38 s + 0.34 s wire ≈ 0.7 s | ties | ×1.03–1.08 | ×1.03–1.08 |
| mmWave, 56 ms | ~0.57 s | ties | ×1.07–1.12 | ×1.07–1.12 |
| any, the page's origin already pooled | — | ×0.5–0.92 (H3) | ×0.5–0.92 (H2) | no pool: as cold |
| any, a swallowed UDP dial | +4.0 s, then a fallback | +4.0 s unless the HTTPS record is absent | ties its cold row | ties its cold row |

**An ask, after a fill** (the session warm, the link idle past a silence): each stack restarts slow start (ours by
`cubic-restart`, the kernel's by `tcp_slow_start_after_idle`), so 1 round trip + the frame's slow start on all four:
**ties** on every profile, unless the silence falls between the kernel's RTO and our threshold, where one arm keeps
its window and the other does not (×0.5–2.0 either way; the thresholds compared by the protocol, not here). *Corrected 2026-11-17 by TRANSPORT-PROTOCOL: the
record says WT and H3 keep their window through any silence and the TCP arms restart after one RTO, so past an RTO
the TCP arms are predicted slower (§5.0; cell AA registers both lines).*

**An ask during a fill.**

| arm | what the ask waits behind | predicted |
| --- | --- | --- |
| WT | what the server has written to quinn, ≤ the 6 MiB stream credit, + 1 RTT; 0.08–2.8 s across the profiles (link-profiles §2) | the reference |
| H3 fetch | the fill's response stream; the ask jumps only if the server honours RFC 9218 urgency or the client aborts and re-asks ([`../delivery-prior-art.md`](../delivery-prior-art.md) §8) | ×1.0–2.0 |
| H2 fetch | the same, plus the kernel's send buffer under the HTTP/2 framing | ×1.0–2.0 |
| WS | the kernel's send buffer, autotuned to `tcp_wmem`'s max, "Default: between 64K and 4MB, depending on RAM size" (ip-sysctl.rst), + tungstenite's queue | ×0.7–1.2 |

**CPU.** Server CPU per byte: WS and H2 below WT and H3 (×0.5–0.9), since quinn spends ~2 µs a datagram in
userspace ([`../transport-conclusions.md`](../transport-conclusions.md) §4) where the kernel segments TCP itself;
client CPU likewise lower over TCP. *Theory, no source read gives a ratio.* **Bytes on the wire**: within ±3 % on
all four (HTTP or WebSocket framing against envelopes and QUIC headers), not derived further.

## 4 · What decides, and what the protocol must hold

* **Cells a cloud host can decide** (wire-bound, within its ceiling: the userspace relay checked to 100 Mbit/s, the
  2-vCPU rig never past ~58, [`../../rig-limits.md`](../../rig-limits.md) §3): LTE, public Wi-Fi, the p10 of every
  profile, the cold first frame on any RTT (rate-scaled), the ask during and after a fill. Above ~58–100 Mbit/s a
  scaled link decides queues and loss responses, never fill times; mmWave's credit bound and the home Wi-Fi rows
  are claimed nowhere past the host.
* **Cells only a phone decides**: whether HTJ2K's decode or the wire binds (HTJ2K's phone decode, unmeasured), the
  WS arm's receive buffer on Android, a radio's reordering and loss, a handover.
* **To hold fixed**: the server's controller per arm printed (quinn's `cubic-restart` and the kernel's `cubic`, or
  both BBR), the initial window, the idle threshold, the series and its digests; arms interleaved; one metric a
  comparison.
* **What would retract a line above**: a fill outside ×0.95–1.05 on a clean wire-bound link; a TCP arm's first frame
  within 1 RTT of WT's cold; an ask behind a fill over WS above ×1.2.

## 5 · Protocol

*Pre-registered 2026-11-17 by TRANSPORT-PROTOCOL, a session that wrote none of §1–§4 and will not build or run any
of it. The run follows it as written; an amendment goes in before any counted row if the host forces one, never
after. Every prediction below is **theory**, from §1–§3 and the measured rows they cite (with their fixtures); none
is a result. Every link form is **assumed**: a relay's model of a profile, none fitted to a radio.*

### 5.0 · Where this protocol departs from §1–§3

* **The ask after a fill.** §3 predicts a tie because "each stack restarts slow start". The repository's own record
  says ours does not: "quinn 0.11.18 has no window restart after idle, and `cubic-restart` does not count an idle
  spell as an outage" ([`../transport-conclusions.md`](../transport-conclusions.md) §3 *The first ask on an idle
  session*, its paragraph *A warmed window survives a silence*, measured: every variant "ends on the window it had before the silence"), and `server/src/transport/restart.rs`
  restarts only when "a congestion event closes a silence rather than a loss among acknowledgements". The kernel
  restarts after one RTO of idle by `tcp_slow_start_after_idle` (§1). So the WT and H3 arms keep their window and the
  H2 and WS arms do not: cell **AA** registers both lines, and §1 and §3 carry the correction in place.
* **The relay, not `netem`.** A cloud container has no root; the relay's `--tun` plane is the one model where "QUIC
  and kernel TCP share one queue and one clock each way, and a dropped TCP segment is one the sender's kernel
  retransmits" ([`../../rig-limits.md`](../../rig-limits.md) §3). Its ceiling: "Claim nothing through the TUN above 100
  Mbit on this host." Every cell runs at ≤ 90 Mbit; the profiles above it are **scaled**, and a scaled cell decides
  queues, loss responses and asks, never a profile's fill time.
* **Jitter.** The relay's jitter is uniform (`--jitter-ms`, "uniform, each direction"), not the Pareto tail of
  `claude/link-targets:docs/transport/link-profiles.md` §4's enterprise form; cell ENT says so.

### 5.1 · Arms

Eight arms, all from one server process where the arm allows, the same store, the same coded frames and digests.

| arm | client | server | what is held equal |
| --- | --- | --- | --- |
| **WT-TS** (the reference) | today's downloader, `ts/session.ts` | today's endpoint | the default build: `cubic-restart`, initial window 12 000 B, shared stream, opening ask, GSO 24 |
| **WT-TS′** (A/A) | WT-TS again | the same | — |
| **WT-WASM** | the downloader on `wasm/` | the same | — |
| **WS** | `ts/ws-session.ts` | `--websocket`, kernel TCP + TLS 1.3 on the same port number | the same envelopes and asks; the opening ask in the upgrade's URL |
| **H3-frame** | a lab fetch carrier: one GET a frame, **K = 6** in flight on one connection, in the fill's order | a lab GET path on the same quinn endpoint (§5.6; a second endpoint, §5.7) | the same controller and initial window as WT, printed |
| **H3-fill** | one GET for `[k … N]`, envelopes in order on one response; an ask aborts it, GETs the frame, then GETs the rest | the same | as H3-frame |
| **H2-frame** | as H3-frame, over HTTP/2 | a lab HTTP/2 listener, kernel TCP + TLS 1.3 | kernel `cubic`, `tcp_slow_start_after_idle`, `tcp_rmem`/`tcp_wmem` printed per run |
| **H2-fill** | as H3-fill, over HTTP/2 | the same | as H2-frame |

K = 6 is the connection's 15 MiB credit (§1) over 2.15 MB, less one: the shape a fetch design would pick, and the one
§1's credit table credits with 2.5×. Every visit records the fetch arms' `nextHopProtocol`; an arm that did not speak
its protocol is `VOID`.

### 5.2 · Rig, order, engine

* **Rig.** One 4-core container. `link_impair.py --tun` inside `unshare -rn`, the server in the relay's server
  namespace (`nsenter --net=`), the browser in the relay's; the relay pinned to core 0, the server to core 1, the
  browser to cores 2–3. A fresh browser profile a visit (no `Alt-Svc` or session-ticket cache), one visit at a time,
  10 s idle between visits ([`../../rig-limits.md`](../../rig-limits.md) §6). TLS 1.3 everywhere with the lab's
  certificate: WT by `serverCertificateHashes`; the others trusted by the browser's SPKI allow-list, and the H3 arms
  reach QUIC by Chromium's force-QUIC switch for the origin, **a stand-in for an HTTPS record**, labelled so.
* **Series.** `dbts_b1` HTJ2K, 2.15 MB a frame; the whole 50 frames unless a cell names a prefix (the lossy cells,
  to keep a visit under a minute). Every frame's XXH3 checked against the series' digest; one failure stops the run
  and is reported, never voided.
* **Order.** A Williams square over the eight arms (`lab/order.mjs`), one period = 8 rounds; each row carries its
  round, arm and predecessor; the summary prints the split by predecessor and the `UNBALANCED` flag.
* **Engine.** Headless Chromium, the version the host has, printed. §1 read `net/` at `141.0.7390.37` and
  `158.0.8127.42`; if the run's version is neither, the four window constants of §1 are re-read at its tag before the
  pilot, and a change is an amendment. Firefox and WebKit: not counted.
* **Printed per run:** every server flag; the kernel's `tcp_congestion_control`, `tcp_slow_start_after_idle`,
  `tcp_rmem`, `tcp_wmem` in both namespaces; the relay's arguments and seed; the browser's version and switches.

### 5.3 · Cells, metric, prediction

One metric a comparison (`CLAUDE.md` §Measurement). *t₀* is the worker's first call for the cell's action (the
dial, the fetch, the ask; an ask's at the page's call, §5.7); a time ends at the **last byte** of the frame named, so the decode stays out; the frame's
check is still made. Relay forms: delay one way, each direction; queue in 1 500 B packets.

| cell | relay form (scaled from) | frames | metric | WT-TS predicted (D) | predicted ratios (theory; WT-WASM and WT-TS′ tie everywhere) |
| --- | --- | --- | --- | --- | --- |
| **CLEAN** | 1 ms, 90 Mbit, 300 pkts (the measured home fit; 600 → 90 Mbit) | 50 | fill: *t₀* → last frame's last byte | 9.5 s + slow start | all tie |
| **PUB** | 10 ms, 90 Mbit, 2 000 pkts (public Wi-Fi; 101 → 90) | 50 | fill | ~9.7 s | all tie |
| **ENT** | 2 ms, jitter 10 ms reorder, 90 Mbit, 2 000 pkts (enterprise; uniform, not Pareto) | 50 | fill | ~9.6 s | H3 tie; H2-* and WS ×0.95–1.10 |
| **LTE** | 19 ms, 50 Mbit, 3 300 pkts, iid 0.1 %, a 40 ms blackout every 30 s (link-profiles §4's LTE) | 16 | fill | 20–30 s (Cubic's 0.1 % bound, ~10 Mbit at 38 ms) | all tie |
| **CR** | 400 ms, 90 Mbit, 1 875 pkts (LTE's loaded RTT, ~0.8 s, standing in for a full queue) | 50 | fill | ~20 s: 6 MiB ÷ 0.8 s ≈ 63 Mbit, + ~9 RTTs of slow start | H3-frame ×0.6–1.0; H3-fill, H2-* tie; WS ×0.5–1.2 (its kernel buffer, printed) |
| **LOSS** | 20 ms, 20 Mbit, 200 pkts, GE loss 1 % (§2's measured cell) | 8 | fill | ~46 s (~3 Mbit, Cubic at 1 %, 40 ms) | all tie |
| **HOL** | LOSS's visits | 8 | frame inter-arrival p99 within a visit | 1.4 s (§2's 1 368 ms) | H3-frame ×0.7–1.0 (a stream a frame); H2-*, WS, H3-fill tie (§2's WS 1 522 against 1 368) |
| **FF** | RTT 2, 20, 38, 56 ms (1, 10, 19, 28 one way), 90 Mbit, 2 000 pkts; the page from another origin | frame 0 | first frame, cold: *t₀* → frame 0's last byte | 2 ms ~0.2 s; 20 ms ~0.31; 38 ms ~0.46; 56 ms ~0.62 | 2 ms all tie; 20–56 ms H3-* tie, H2-* and WS ×1.03–1.12 (one RTT more over 4–11) |
| **FP** | FF at 20 and 56 ms; the page served by the frame server, so a fetch arm's connection is up | frame 0 | first frame, pooled | as FF | H3-*, H2-* ×0.5–0.92; WT, WS as their FF |
| **AD** | PUB, and LTE without the blackout | 50 / 16 | an ask during a fill: when frame 8 (PUB) or 4 (LTE) is checked, an ask for the last frame; ask → its last byte | PUB ~0.8 s (6 MiB at 90 Mbit + 1 RTT + the frame); LTE ~1.4 s, less if Cubic's loss bound keeps less in flight | H3-*, H2-* ×1.0–2.0; WS ×0.7–1.2 |
| **AA** | PUB and FF's 38 ms; idle gap 0.1, 1 and 5 s, a visit each | 16, then 1 | an ask after a fill: the last frame, withheld from the fill; ask → its last byte | 20 ms ~0.21 s, 38 ms ~0.23 s (window kept, §5.0) | **two lines**: §3's, all tie; the record's (§5.0), at 0.1 s all tie, at 1 and 5 s H3-* tie and H2-*, WS ×1.2–1.9 (slow start from 10 segments again). The gap against each TCP arm's RTO, read by `ss -ti` before the ask, is printed |
| **CPU** | CLEAN's visits | 50 | server CPU a GB: the server's `utime + stime` (`/proc/<pid>/stat`); host softirq a GB beside it (`/proc/stat`) | — | WS, H2-* ×0.5–0.9 of WT; H3-* tie (§3, *no source gives a ratio*) |
| **CPU-C** | CLEAN's visits | 50 | client CPU a GB, the browser's process tree (`lab/scripts/proc_sampler.mjs`) | — | WS, H2-* ×0.5–0.9 (§3, unsourced) |
| **BYTES** | CLEAN's visits | 50 | IP bytes server → client at the relay ÷ the frames' bytes | 1.03–1.05 | every arm within ±3 % of WT |

### 5.4 · Rounds, `VOID`, saturation, stopping

* **Rounds.** One period (8) a cell; **two (16) for CR, AD and AA**, the cells whose predicted ratios leave the tie
  band. "In ≥ 75 % of rounds" is ≥ 6 of 8, ≥ 12 of 16.
* **`VOID`** (a visit), recorded with its reason and kept in the rows: the relay's guard p99 above 1 ms
  (`--self-timing`; the TUN check held 0.24–0.81 ms to 100 Mbit); any core above 95 % busy over the visit; a fetch arm
  on the wrong protocol; a crash; the visit past 3× its cell's pilot median. A cell with more than 25 % `VOID` reports
  both readings, *strict* and *round-paired* ([`../../av1/queue.md`](../../av1/queue.md), the owner's rule of
  2026-10-09).
* **Where the host saturates**: the TUN at 100 Mbit (nothing claimed above 90); Chromium's receive path at ~100 MB/s
  ([`../../rig-limits.md`](../../rig-limits.md) §1), above every cell. CPU cells are claimed for this host's cores only.
* **Order of cells** (by what they decide): AA, AD, CR, FF, LOSS (with HOL), LTE, CLEAN (with CPU, CPU-C, BYTES),
  PUB, ENT, FP. ~8 h of visits at the predicted times (D); **stop at 12 h of wall clock**: cells not reached are
  reported as not run, a cell cut inside a period is reported with its balance flag.
* **Pilot.** Two rounds of every cell, not counted, before the first counted row. It may set only the visit timeout
  and the prefixes of LTE and LOSS (the fewest frames that keep each fill under a minute), and checks: every fetch
  arm's `nextHopProtocol`; the relay's tally against its configured loss and rate; the kernel values of §5.2 in both
  namespaces. Its choices are written here as an amendment before CLEAN's first counted row.

### 5.5 · The rule, stated before any data

* Per cell and arm: the ratio to WT-TS in each round, its median with range and rounds better out of n; judged by
  `lab/scripts/aa_rule.py` against WT-TS′ with `--bar 0.05`: **faster**, **slower**, **tie** or **unresolved**.
* A prediction **holds** when the median ratio lies in its band; otherwise it is a **miss**, reported beside it.
  §4's three retraction lines are judged as written; cell AA decides between its two lines.
* **What reaches the owner**: every arm faster than WT-TS in any cell, with its scope (Chromium headless, one
  container, the TUN relay at ≤ 90 Mbit, one series, assumed and scaled profiles), and AA's verdict. The run adopts
  nothing: a GET path is a second wire, structural, and the owner's ([`../delivery-prior-art.md`](../delivery-prior-art.md) §8).
* The phone decides what this rig cannot (§4): WS's `tcp_rmem` on Android, a radio's loss and reordering, a handover,
  HTJ2K's decode against the wire. Those go to the phone protocol as asks, not designed here.

### 5.6 · What must be built first, and its mutants

Owed by a build row and its review (neither this session's), lab only (`scripts/check_lab_absent.sh` green):

1. **A GET path on the series server**, behind a lab build feature: HTTP/3 on the same quinn endpoint (`h3` over
   `h3-quinn`, which the lab's other clients already build), HTTP/2 on a TCP listener (TLS 1.3); `GET` of one frame
   and of `[k … N]`, both answering envelopes as the shared stream carries them, from the same frame pool.
2. **A fetch carrier in the downloader's worker**, behind the viewer's lab gate: both shapes, K = 6, the abort and
   re-GET for an ask, `nextHopProtocol` recorded.
3. **The driver**, a new directory under `lab/`: the relay, the order, the A/A arm, the checks, the samplers, `ss -ti`
   before each AA ask, and the relay's byte count per flow (added to its tally if absent).

Each check fails once with its code broken (`CLAUDE.md` §Measurement): a carrier that speaks h2 where h3 is asked
(`VOID`), a server that drops one frame (the run stops), a relay at 0 % where 1 % is asked (the pilot's tally check),
the order forced to a fixed cycle (`UNBALANCED`), the CPU sampler on a wrong pid (a zero flagged).

### 5.7 · Amendments

**2026-11-18, before any counted row** (TRANSPORT-BUILD-FIX, from the build's review, `claude/transport-arms`
`fa002825:docs/reviews/transport-arms.md` B5). The host forced two departures from the text above; neither changes a cell,
a metric's end or a prediction.

1. **HTTP/3 on a quinn endpoint of its own** (§5.1, §5.6 item 1 said "the same quinn endpoint"). A WebTransport dial
   and a `fetch` both offer ALPN `h3`, so one endpoint cannot route them before wtransport reads the CONNECT. The GET
   path's endpoint is built in the same process from the same `TransportTuning::to_transport_config()`, which holds
   what the row asks to be equal: "the same controller and initial window as WT". Its port differs, and Chromium's
   force-QUIC switch names that port.
2. **An ask's *t₀* is the page's call** (§5.3 said the worker's first call), one `postMessage` earlier: a frame the
   fill still owes keeps the fill's ask stamp in the downloader's record, so the worker's own stamp is not the ask's.
   The hop is the same in every arm, so AD's and AA's ratios are unchanged; their absolute times carry it.

Held as written, recorded here because the host's default is not §5.1's: this container's kernel default is `bbr`
and its sysctl cannot be written, so the H2 and WS arms' "kernel `cubic`" is set on each accepted socket
(`TCP_CONGESTION`, the lab flag `--lab-tcp-congestion cubic`) and read back from the server's sockets by `ss -tin`
every visit; a visit that reads anything else stops the run. The namespaces' printed `tcp_congestion_control` is the
default those sockets do not use.

**2026-11-18, the pilot's choices, before any counted row** (TRANSPORT-RUN; §5.4 lets the pilot set only the visit
timeout and the prefixes of LTE and LOSS). Pilot rows: `claude/transport-arms` `lab/transport-arms/rows/*-pilot*.jsonl`.

1. **The engine.** Headless Chromium `157.0.8103.78`, neither of §1's tags, so the four window constants were re-read
   at its tag before the pilot: `kQuicSessionMaxRecvWindowSize = 15 * 1024 * 1024;  // 15 MB`,
   `kQuicStreamMaxRecvWindowSize = 6 * 1024 * 1024;    // 6 MB` (`net/quic/quic_context.cc`),
   `kSpdySessionMaxRecvWindowSize = 15 * 1024 * 1024;  // 15 MB`, `kSpdyStreamMaxRecvWindowSize = 6 * 1024 * 1024;    //  6 MB`
   (`net/http/http_network_session.cc`). Unchanged: no amendment to §1.
2. **The visit timeout is 600 s** (`--limit-ms 600000`; the build's default was 120 s). ENT's fills took 146–201 s a
   visit in the pilot, every arm, 50 of 50 frames exact; at 120 s every ENT visit would end unfinished. A visit past
   3× its form's pilot median wall time is `VOID` (§5.4), from `rows/pilot-medians.json` (each form and arm's median
   over its non-`VOID` pilot visits; `fp-20ms/H3-frame` has none, both its pilot visits `VOID` by the relay guard, so
   that arm carries no 3× rule).
3. **The prefixes are kept as the build set them: LTE 16 frames, LOSS 8.** Every pilot fill stayed under a minute
   (LTE ≤ 26 s, LOSS ≤ 30 s, AD's LTE form ≤ 20 s).
4. **The checks.** Every fetch arm spoke its protocol, except two visits whose resource entries included an empty
   `nextHopProtocol` beside the right one (`spoke h2,, not h2`, LOSS; `spoke h3,, not h3`, AD): `VOID` as the rule
   reads, kept. The relay's loss: LOSS 1.21 % against 1 %; AD's LTE form 0.12 % against 0.1 %. The kernel values of
   §5.2, both namespaces: `tcp_congestion_control` `bbr` (§5.7 above), `tcp_slow_start_after_idle` 1, `tcp_rmem`
   `4096 131072 33554432`, `tcp_wmem` `4096 16384 4194304`.
5. **A driver change the pilot forced** (`claude/transport-arms` `7ab31404`): the pilot's relay check refused one
   0.1 % visit as "too few packets to check 0.1 % loss (26961)", so it now judges such forms over their pilot visits
   pooled; a 1 % form is still judged per visit. Test first (`judge.test.mjs`), three mutants killed. It changes no
   counted row's verdict.
6. **The 12 h stop counts from the first counted row**, and this container stops a session's jobs at 2 h, so the run
   is one detached process (`lab/transport-arms/run.mjs` a cell at a time, in §5.4's order).

## 6 · Results

*Measured 2026-11-18 14:58Z to 2026-11-19 02:58Z by TRANSPORT-RUN, a session that wrote none of §1–§5 or the build.
Rows: `claude/transport-arms` `lab/transport-arms/rows/<CELL>.jsonl`; every table below is reproduced by
`python3 lab/transport-arms/summary.py lab/transport-arms/rows <CELLS>`, whose verdict column is
`lab/scripts/aa_rule.py --bar 0.05` against WT-TS′ (§5.5). Every visit's frames were checked by XXH3: none failed.
Ratios are each arm's to WT-TS in the same round, median (range), rounds better of n; a prediction **holds** when the
median lies in its band (ties ×0.95–1.05), else it is a **miss**. Every link is a relay's scaled model (§5.0), none a
radio.*

**Fixtures and limits.** One series, `dbts_b1` as HTJ2K (50 frames, 107 407 602 B, 2.15 MB a frame); one 4-core
container (Intel Xeon @ 2.30 GHz), headless Chromium 157.0.8103.78, the userspace TUN relay at ≤ 90 Mbit; the kernel's
default controller `bbr`, the TCP arms' server sockets on `cubic` (§5.7) and read back as `cubic` on every visit. **The
host:** the busiest core's median per cell 0.12–0.52, its maximum 0.91 (FF); no visit was `VOID` by a busy core, so no
cell reached this host's saturation. Nothing is claimed above 90 Mbit.

### 6.1 · Each cell against its prediction

| cell (form) | visits, `VOID` | WT-TS measured (predicted, D) | arms, median ratio (aa_rule) | prediction | holds? |
| --- | --- | --- | --- | --- | --- |
| **AA** pub 0.1 s | 128, 0 | 230 ms (~0.21 s) | WS 0.984, H2-frame 0.990, H2-fill 0.992 (faster); H3-frame 1.015, H3-fill 1.009 (slower); WT-WASM, WT-TS′ tie | at 0.1 s all tie | holds |
| AA pub 1 s | 128, 1 | 230 ms | WS 0.982 (faster), H2-frame 0.990 (tie), H2-fill 0.989 (faster); H3-* 1.007–1.010 (slower) | record's line: H2-*, WS ×1.2–1.9; §3's: all tie | record's line **miss**; §3's holds |
| AA pub 5 s | 128, 0 | 229 ms | WS 1.391, H2-frame 1.366, H2-fill 1.350 (slower); H3-frame 1.020 (slower), H3-fill 1.007 (tie) | record's: H2-*, WS ×1.2–1.9, H3 tie | record's line holds; §3's **miss** |
| AA 38 ms 0.1 s | 128, 1 | 252 ms (~0.23 s) | WS 0.970, H2-frame 0.975, H2-fill 0.974 (faster); H3-frame 1.018 (slower) | all tie | holds |
| AA 38 ms 1 s | 128, 1 | 251 ms | WS 1.010 (slower), H2-frame 1.000 (tie), H2-fill 0.975 (faster); H3-frame 1.019 (slower) | record's: H2-*, WS ×1.2–1.9 | record's line **miss**; §3's holds |
| AA 38 ms 5 s | 128, 1 | 251 ms | WS 1.635, H2-frame 1.687, H2-fill 1.699 (slower); H3-frame 1.021 (slower), H3-fill 1.006 (tie) | record's: ×1.2–1.9, H3 tie | record's line holds; §3's **miss** |
| **AD** pub | 128, 0 | 734 ms (~0.8 s) | WS 0.718 (faster); H3-frame 1.803, H2-frame 1.994 (slower); H3-fill 10.98, H2-fill 11.02 (slower) | H3-*, H2-* ×1.0–2.0; WS ×0.7–1.2 | WS, H3-frame, H2-frame hold; **H3-fill, H2-fill miss** (see 6.3) |
| AD lte | 128, 2 | 5 664 ms (~1.4 s, **miss**) | WS 0.448 (faster); H3-frame 1.667, H2-frame 1.881, H3-fill 2.835, H2-fill 2.644 (slower); WT-TS′ 0.978 (not conclusive) | as AD pub | H3-frame, H2-frame hold; WS, H3-fill, H2-fill **miss** |
| **CR** | 128, 1 | 35.0 s (~20 s, **miss**) | H3-frame 0.630 (faster); WS 1.088, H2-frame 1.091, H2-fill 1.052, H3-fill 1.001 (slower) | H3-frame ×0.6–1.0; H3-fill, H2-* tie; WS ×0.5–1.2 | H3-frame, H3-fill, WS, H2-fill hold; **H2-frame miss** |
| **FF** 2 ms | 64, 10 | 214 ms (~0.2 s) | WT-WASM 1.112 (slower); the rest tie | all tie | **WT-WASM miss**; the rest hold |
| FF 20 ms | 64, 6 | 323 ms (~0.31 s) | WS 1.013 (tie), H2-frame 1.016, H2-fill 1.014 (slower), H3-frame 1.012 (slower), H3-fill tie; WT-WASM 1.048 (slower) | H3 tie; H2-*, WS ×1.03–1.12 | H3 holds; **H2-*, WS miss** (below the band) |
| FF 38 ms | 64, 3 | 467 ms (~0.46 s) | WS 1.008, H3-* 1.004–1.007 (tie); H2-* 1.015 (slower); WT-WASM 1.047 (slower) | as 20 ms | H3 holds; **H2-*, WS miss** |
| FF 56 ms | 64, 7 | 626 ms (~0.62 s) | every fetch arm and WS 1.001–1.010 (tie); WT-WASM 1.021 (slower) | as 20 ms | H3 holds; **H2-*, WS miss** |
| **LOSS** | 64, 0 | 24.4 s (~46 s, **miss**) | WS 0.962, H2-frame 0.951 (faster); the rest not conclusive, 1.010–1.043 | all tie | holds (every median ×0.95–1.05) |
| **HOL** (LOSS's visits) | 64, 0 | 4.74 s (1.4 s, **miss**) | WS 0.871 (faster); H3-frame 1.598 (slower); H2-frame 1.196, H2-fill 0.926, H3-fill 0.973 (not conclusive) | H3-frame ×0.7–1.0; the rest tie | H3-fill holds; **H3-frame, WS, H2-frame, H2-fill miss** |
| **LTE** | 64, 0 | 24.0 s (20–30 s) | every arm not conclusive: WS 0.859, H2-frame 0.963, H2-fill 0.980, H3-frame 1.069, H3-fill 1.020, WT-WASM 1.055 | all tie | H2-*, H3-fill hold; **WS, H3-frame, WT-WASM miss** (not conclusive) |
| **CLEAN** | 64, 0 | 9.92 s (9.5 s + slow start) | every arm 1.000–1.002 (tie) | all tie | holds |
| **CPU** (CLEAN's) | 64, 0 | 573 server ticks a GB | WS 0.145, H2-frame 0.162, H2-fill 0.145 (lower); H3-frame 1.112 (higher); H3-fill 1.075 (not conclusive) | WS, H2-* ×0.5–0.9; H3 tie | **WS, H2-* miss** (far lower); **H3-frame miss** |
| **CPU-C** (CLEAN's) | 64, 0 | 82 s of client CPU a GB | WS 0.695, H2-frame 0.770, H2-fill 0.723 (lower); H3-frame 1.665, H3-fill 1.628 (higher); WT-WASM 1.040 (higher) | WS, H2-* ×0.5–0.9 | holds; H3's ×1.6 was not predicted |
| **BYTES** (CLEAN's) | 64, 0 | 1.037 of the frames' bytes (1.03–1.05) | every arm 1.000–1.002 of WT-TS | within ±3 % | holds |
| **PUB** | 64, 0 | 10.03 s (~9.7 s) | every arm 0.999–1.003 | all tie | holds |
| **ENT** | *the run's last cell, cut by the 12 h stop; filled below* | | | | |
| **FP** | not run: the 12 h stop | | | | |

The host's CPU per cell (the busiest core over a visit, median / max): AA 0.43 / 0.81, AD 0.39 / 0.85, CR 0.22 / 0.47, FF
0.52 / 0.91, LOSS 0.12 / 0.20, LTE 0.16 / 0.36, CLEAN 0.51 / 0.88, PUB 0.47 / 0.82. `VOID`s were the relay's guard
(p99 over 1 ms) but for two AD visits whose resource entries carried an empty `nextHopProtocol` beside `h3` (§5.7 item
4); no cell voided over 25 %, so each is reported in its strict reading alone.

### 6.2 · §4's retraction lines and cell AA

* **"A fill outside ×0.95–1.05 on a clean wire-bound link"**: not met. CLEAN and PUB: every arm 0.999–1.003.
* **"A TCP arm's first frame within 1 RTT of WT's cold"**: **met.** At 20, 38 and 56 ms the H2 arms and WS land
  1.000–1.016 of WT-TS (56 ms: WT-TS 626 ms, H2-frame 1.002), well inside one RTT, against §3's "one RTT more over
  4–11". §3's first-frame table's H2-* and WS columns (×1.05–1.15 and ×1.03–1.12) are **retracted** on this rig.
* **"An ask behind a fill over WS above ×1.2"**: not met. WS answered an ask during a fill faster than WT-TS (0.718 on
  PUB, 0.448 on LTE).
* **AA decides between its two lines by the gap.** At 0.1 s both lines hold (all tie). At 5 s the record's line holds
  (§5.0: WT and H3 keep their window; the TCP arms ×1.35–1.70) and §3's "all tie" misses. At 1 s, past one RTO (the
  servers' sockets read `rto:` 406–454 ms before the ask), the record's line misses: the TCP arms tie. The kernel's
  restart does not return to the initial window after one RTO; it halves the window once per RTO elapsed, down to the
  initial one, Linux `net/ipv4/tcp_output.c` at `v6.12` and `v6.18` (the host's kernel, 6.18.44), `tcp_cwnd_restart()`:
  `while ((delta -= inet_csk(sk)->icsk_rto) > 0 && cwnd > restart_cwnd)` / `cwnd >>= 1;`. So a 1 s gap leaves ~¼ of a
  ~1 600-segment window (read by `ss -tin`), above a 2.15 MB frame's ~1 485 segments' need for a round trip or two, and
  5 s leaves the initial window. *Derived from the source and the read windows; the halving count per visit was not
  traced.*

### 6.3 · What the rows show that no prediction covered

* **ENT's fills take 15–20× the prediction** (pilot 146–201 s a visit against ~9.6 s, every arm, every frame exact):
  the relay's uniform 10 ms reorder at 90 Mbit (§5.0's departure) reorders far more than §3's p99 tail assumed. A
  property of this jitter model, not of a radio: the enterprise row is not decided here.
* **The fill-shape fetch arms' ask did not jump.** In every AD visit of H3-fill and H2-fill the frames landed strictly
  in order 0 … 49 and the asked frame 49 last, at the whole fill's time (round 3 of `ad-pub`: H3-fill frame 49 at
  10 031 ms from the dial, WT-TS at 2 690 ms, right after frame 11). §5.1 defines the arm as "an ask aborts it, GETs
  the frame, then GETs the rest"; the rows show no abort took effect, so the ×11 is the carrier's, not yet the arm's.
  *A suspected build defect in `lab/transport-arms/fetch-session.ts`, unresolved by reading; for the verdict review.*
* **Server CPU over kernel TCP is ×0.15, not ×0.5–0.9**, and the H3 fetch arms cost the browser ×1.6 the CPU of WT
  on CLEAN's visits: for this host's cores only (§5.4).
* **WT-WASM is slower than WT-TS on the first frame** (×1.02–1.11, all four RTTs), against "ties everywhere": its start,
  not the wire (it ties on every fill).

### 6.4 · What reaches the owner (§5.5)

Each arm faster than WT-TS in some cell, scope: Chromium headless 157, one 4-core container, the TUN relay at ≤ 90
Mbit, one series, assumed and scaled profiles.

* **WS**: an ask during a fill (0.718 PUB, 0.448 LTE), an ask after a short gap (0.97–0.98), LOSS's fill (0.962) and
  its frame inter-arrival p99 (0.871); server CPU ×0.145, client CPU ×0.695. Slower after a 5 s silence (×1.39–1.64)
  and on CR (×1.088).
* **H2-frame, H2-fill**: an ask after a short gap (0.97–0.99), LOSS (H2-frame 0.951); server CPU ×0.15, client CPU
  ×0.72–0.77. Slower after a 5 s silence (×1.35–1.70) and during a fill (×1.9–2.0 frame shape).
* **H3-frame**: CR's fill (0.630: one stream a frame escapes the 6 MiB stream credit at 0.8 s RTT). Slower on HOL
  (1.598) and during a fill (1.67–1.80).
* **AA's verdict**: WT and H3 keep their window through a silence; the TCP arms lose it past a few RTOs (5 s), not
  yet at one (1 s).

The run adopts nothing: a GET path is a second wire, structural, and the owner's. Owed to the verdict review: §6.3's
fill-shape ask, and whether AD's fill-shape readings stand.

## Fixtures and limits

One series' bytes (`dbts_b1`, 50 frames, HTJ2K); every profile as LINK-TARGETS left it (one measured, the rest from
sources and assumed); the four stacks read from their specifications, Chromium's `net/` at two tags and Linux's
documented defaults, not from a trace. Not read: Firefox's and Safari's HTTP stacks, Android's `tcp_rmem` and
`tcp_wmem`, the kernel's loss detection against RFC 9002, how Blink maps a worker's `fetch()` priority. No arm was run *(corrected 2026-11-19: §6 holds the run, with its own
fixtures and limits)*.
