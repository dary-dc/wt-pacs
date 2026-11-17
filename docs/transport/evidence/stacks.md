# HTJ2K over four stacks: WebTransport, HTTP/3 fetch, HTTP/2 fetch, WebSocket — theory and a prediction per profile

*2026-11-17, queue row TRANSPORT-THEORY. **Theory and sources only: nothing was run.** Every number is a source's,
a measurement already in this repository (linked), or arithmetic on those, marked (D). The pre-registered protocol
that tests it is TRANSPORT-PROTOCOL's, by a session that wrote none of this and will not run it.*

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
quinn is already the kernel's. Where they still differ: the idle threshold (one RTO for the kernel; ours,
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
its window and the other does not (×0.5–2.0 either way; the thresholds compared by the protocol, not here).

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

## Fixtures and limits

One series' bytes (`dbts_b1`, 50 frames, HTJ2K); every profile as LINK-TARGETS left it (one measured, the rest from
sources and assumed); the four stacks read from their specifications, Chromium's `net/` at two tags and Linux's
documented defaults, not from a trace. Not read: Firefox's and Safari's HTTP stacks, Android's `tcp_rmem` and
`tcp_wmem`, the kernel's loss detection against RFC 9002, how Blink maps a worker's `fetch()` priority. No arm was run.
