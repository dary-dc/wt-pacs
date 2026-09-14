# Latency and throughput — what is still open, in order

**Target, set with the owner 2026-09-14: a browser on a mobile, lossy wireless link, thousands of
sessions per server.** Every row is ranked for that reader: first what shortens the wait for a
frame on such a link, then what cuts the server's cost per session, then what sits below the
wire, then what is closed. A row that is not measured says so. The mechanisms and the product
direction on each are [`why-these-changes.md` §10](why-these-changes.md#10--latency-and-throughput-on-one-tree-where-they-part-and-what-joins-them);
this page is the order. An external survey of WebTransport limits (14 September 2026) was read
against every row; where it adds a lever or a bound, the row says so, and its sources are at the
end.

Three facts about the target order the list. On a 20 Mbps link a 250 KB frame takes 100 ms on
the wire, so bytes and round trips dominate anything the server does per frame. No session can
be heavy — 20 Mbps is about 2.5 MB/s, near 0.4 % of a core — so at thousands of sessions the cost
is CPU per byte. And the round trip is 30–80 ms, so a tail that reads as 28 ms of `max_ack_delay`
against a 0.1 ms loopback RTT is worth half a round trip there, not fifty of them.

## 1 · What shortens the wait on the target link

| # | Item | Why it matters on the target | What decides it | Size |
| --- | --- | --- | --- | --- |
| 1 | **The on-demand network window at `D_min`** | Throughput at the least queueing ([`../adr-client-window-depth.md`](../adr-client-window-depth.md), 6/6 under netem). **Built 2026-09-14 in the TypeScript client** as an opt-in `window` on `connect`: fixed, or `"auto"` from `getStats().smoothedRtt` (absent in Chromium 141; 148 unverified) or from the smallest of at least two asks sent into an idle window, and the time between arrivals; a reader that never pauses holds its initial depth. In headless Chromium 141 the fixed window matched the harness's own loop at depth 4. The WASM client has none; the viewer chooses whether to turn it on. When `Tf ≫ RTT` (a large frame on a slow link) `D_min` is 1 and that is the right answer | L2 on the rig, fixed against `auto` ([`../lanes/L2-ask-policy.md`](../lanes/L2-ask-policy.md), never run), and the browser campaign that shows `auto` converging on a real Chromium `getStats`. Re-check [`../adr-reject-server-ordering.md`](../adr-reject-server-ordering.md)'s one flip condition, RTT above ~100 ms, which mobile can cross | One rig campaign, one browser campaign |
| 2 | **Congestion controller for radio loss** | Measured: BBR −44 to −48 % on exogenous loss, Cubic +63 % better on congestive loss ([`transport-conclusions.md` §1](transport-conclusions.md)). The default is Cubic because the mix was unknown; the target is now stated as radio, and the survey's cellular row and the moq-dev defaults (quinn to BBRv1 for live media, July 2026) point the same way. Mobile also has bufferbloat, so the mix is still a measurement, and BBRv1's neighbour cost stands | Client telemetry from real sessions: is loss correlated with RTT rise. Until then the rig's Gilbert-Elliott model (`cloud_netem.sh … gemodel`) prices BBR against Cubic on a bursty-loss link | One flag; one rig campaign |
| 3 | **Per-frame streams with ask-order priority under loss** (arm Q) | One stream for everything is the survey's first anti-pattern: one lost packet holds every later frame on the stream, and under sustained loss the recoveries queue behind each other. Per-frame + FIFO lost 5.76× to retransmit deferral; priority by ask order removes the deferral (quinn's pending queue is priority, then FIFO), so frames recover in parallel. At 32 KB Q read inside noise at 0.5 % loss and +28 % on the reader clock at 2 %; never run at 250 KB. **`--stream-mode per-frame` now carries ask-order priority**, so the arm is one flag. A client would pass `anticipatedConcurrentIncomingUnidirectionalStreams` so the stream credit does not cost a round trip | One rig campaign at 250 KB, 0.5 and 2 % loss, Q against shared, both at their own `D_min` | One flag, one rig campaign |
| 4 | **Bytes per displayed frame** — progressive HTJ2K prefix, resolution rungs, the stride control law | On this link the wire binds before the receiver (`docs/rig-limits.md` §1 on the `docs/rig-limits` branch), so fewer bytes is the only lever above ~2×. The transport piece, once frames are streams: `RESET_STREAM_AT` (reliable partial reset, now required by the WebTransport draft) lets the server abandon a frame's tail past a viewable prefix; quinn and wtransport do not carry it yet | Product decisions above the transport ([`transport-conclusions.md` §4](transport-conclusions.md), [`../adr-stride-is-bandwidth-conservation.md`](../adr-stride-is-bandwidth-conservation.md)); the render path must accept a rung | Outside this layer |
| 5 | **The client off the main thread** — the session in a Worker, BYOB reads | The survey ranks main-thread contention at 10–50 ms of tail and calls a Worker the highest-leverage single latency change for a web app; on this rig the page took 28.9 ms per frame to accept a decoded result and the decode queue set a fill's finish (`rig-limits.md` §2). BYOB deletes the accumulator copy (parked in [`../improvements/README.md`](../improvements/README.md)). Neither client does either | One interleaved browser campaign, Worker against main thread, all-received and all-decoded reported separately | Client work; a campaign |
| 6 | **Session survival across a 4-tuple change, and what a reconnect costs** | Per-core endpoints hash on the 4-tuple; a Wi-Fi to cellular move or a NAT rebind lands on another endpoint, which answers with a stateless reset, and the TS client has no reconnect. A reconnect is 1.5–2 RTT plus TLS: WebTransport cannot use 0-RTT for CONNECT, and pooling onto a warm connection (0.5 RTT) is refused when `serverCertificateHashes` is set. On mobile this is the design's one cliff | How often it happens, from client telemetry, and whether Chromium migrates a WebTransport session at all (unknown). Then: reuseport steering on the connection ID (the QUIC-LB idea, draft expired), or the multi-thread runtime carrying §9's per-byte work without §8, or client reconnect with optimistic stream opening | Design decision; each option is a few hundred lines |
| 7 | **The depth-1 tail: a lost last datagram waits the probe timeout** | `srtt + 4·rttvar` + the peer's 25 ms `max_ack_delay`, against about 1.1 RTT for a loss with a packet behind it. Priced for the target: on a 50 ms path that is ~95 ms against ~55 ms to detect, so a tail loss costs about half a round trip plus 25 ms more than a mid-frame loss; only the last few packets of a frame can be a tail, so at 1 % loss it averages under a millisecond per 250 KB frame. Real, small; large on loopback only because the RTT there is 0.1 ms (§10 entry 2). The ACK-frequency extension that would shrink the 25 ms is expired at the IETF and absent in browsers | If it is ever taken: an ACK-eliciting packet after an isolated frame (§10 proposal 3), placed after the tail, which quinn's packet builder does not do for a datagram queued behind buffered stream data — the placement is the whole design. Not before items 1–3 | One send in `frame_out.rs`, if at all |
| 8 | **Reachability** | 3–5 % of networks impair UDP (Chrome field data: 5 %). wtransport speaks HTTP/3 only, there is no HTTP/2 fallback, and the TS client checks neither `reliability` nor `requireUnreliable`. A viewer on such a network gets nothing, not a slower session | A product decision: a TCP fallback path (the survey's capsule mode loses stream independence, which this protocol does not need) or a stated non-goal | Outside this layer |

## 2 · What cuts the cost per session

| # | Item | Why it matters on the target | What decides it | Size |
| --- | --- | --- | --- | --- |
| 9 | **The quinn segment cap: does the 44 form on the target, and how small can the patch be** | quinn's pacer bounds a burst to `window × 2 ms / RTT`, floor 10 packets; a 20 Mbps, 50 ms path should never form a 44-packet batch (derived, §10 entry 3), so on the target the change is inert and on LAN it is −16 to −21 % CPU. Fastly settled on 10 packets per GSO burst for the same reason the loopback tail showed: bursts raise loss. Footprint: **PR #31 merged 2026-09-14** — the change is now a 31-line patch applied to the crates.io crate at build time (`patches/`, `patched/quinn`, `scripts/patch_quinn.sh`), byte-equivalent to the vendored tree it replaced | The shaped cell: seg44 against seg10, CPU per ask, at 20 Mbps / 50 ms and 100 Mbps / 30 ms, both sides in one netns on the rig (`lab/scripts/rig_cells.sh`; the seg10 arm is the patch with its clamp at 10). A `TransportConfig` knob upstream ([quinn-rs/quinn#2189](https://github.com/quinn-rs/quinn/issues/2189)) is the shape that removes the patch | One rig campaign |
| 10 | **Placement at thousands of sessions** | One endpoint per core is the default that uses every core, and thousands of sessions multiplex on those threads; the counts even out and the remaining risk is load — a few fills among idle sessions on one thread. On the target no session is heavy, so that risk should be small. Named, not measured. Oversubscribing `--workers` is a small-N hedge (§10 entry 4), not the plan | The rig at 64–256 sessions with the client off the box, the heavy-tail mix at the default worker count, against one endpoint on the multi-thread runtime | One rig campaign |
| 11 | **PR #27, LTO** | −3 to −6 % CPU per ask at saturation on this tree; +7 % p50 (6/6) at 32 KB, depth 1, one session. Depth 1 is the large-frame case (item 1), so that cell can veto it; depth 4 cannot | Weigh on the depth-1 cell if that path ships; otherwise take the CPU | A profile entry |
| 12 | **Read path on the target** | P0 and the rest of [`../disk-access/NEXT.md`](../disk-access/NEXT.md): ring against pool on the production volume, `read_ahead_kb`, the frame cache. On this link a read is ~1 % of a frame's wire time, so this is cost, not latency | The disk lane's own list, on the target | Its own list |
| 13 | **Memory and limits at thousands of sessions** | `send_window` default 10 MB is the ceiling per stalled client and the chunked path holds 180 kB of it; rings charge memlock; no admission control at accept | Deployment manifest ([`../disk-access/DEPLOYMENT.md`](../disk-access/DEPLOYMENT.md)); a stall campaign at 1 000 sessions on the target | Manifest lines; one campaign |

## 3 · Below the wire on this link, or not yet a question

| # | Item | Standing |
| --- | --- | --- |
| 14 | Chromium's receive thread and decode queue (`rig-limits.md` §1–2) | The ceiling on loopback; on a 20 Mbps link the wire binds first. Client-side work, after items 4 and 5 |
| 15 | Safari and iOS (WebTransport since 26.4, March 2026) | A second browser stack on the target's devices; every browser number here is Chromium. Unmeasured |
| 16 | Session flow control | wtransport 0.7.2 speaks the early draft (`SETTINGS_ENABLE_WEBTRANSPORT`, no `WT_MAX_DATA`), so only quinn's windows bound a session, and at the target's BDP (125 KB at 20 Mbps × 50 ms) the defaults are fifty times wide. The current draft adds a session window that defaults to 0 and is credited in order on the CONNECT stream; when wtransport moves to it, the server must grant credit proactively or nothing flows | Watch |
| 17 | `--workers` above the core count | A small-N, LAN-side hedge for the placement lottery (§10 entry 4); not the target's problem and not the scale plan |
| 18 | Diagnostics on the rig | quinn exposes `qlog_stream`; a qlog per arm is how pacing, flow-control blocking and loss recovery are read rather than inferred, and the browser's `getStats()` is the client side of the same picture | Use in the rig campaigns |

## 4 · Closed

| Item | Why |
| --- | --- |
| `max_udp_payload_size` above 1 472 B | Chromium's reader drops the datagram (§10 entry 6) |
| ACK-frequency extension to shorten the probe timeout | quinn peers only; Chromium's `max_ack_delay` is 25 ms and fixed; the IETF draft is expired |
| 0-RTT session setup, and `congestionControl: "low-latency"` | The draft forbids CONNECT in 0-RTT; the hint is a feature at risk with no browser algorithm behind it |
| L4S | No Chromium client support at the last public statement |
| A 10-segment clamp everywhere as the depth-1 answer | Spends §9's LAN CPU to buy a tail that only exists when nothing follows the frame (§10 proposal 3) |
| Per-frame streams without priority, `send_fairness`, `yield_now`, window equalisation | Measured and rejected: [`transport-conclusions.md`](transport-conclusions.md), [`why-these-changes.md` §8](why-these-changes.md) |

## Sources read against this list

Beyond the repository's own measurements: draft-ietf-webtrans-http3-16 (session flow control,
no 0-RTT, optimistic streams, `RESET_STREAM_AT`); the W3C WebTransport Candidate Recommendation
of 30 July 2026 (`getStats`, `anticipatedConcurrentIncomingUnidirectionalStreams`, BYOB, the
`congestionControl` caveat); RFC 9002 (the probe timeout); draft-ietf-quic-ack-frequency-14
(expired); Oku and Iyengar, Fastly, *QUIC matches TCP's efficiency* (ACK rate, GSO at 10);
König et al., IFIP Networking 2025 (sender-bound CPU, receive-buffer drops, stream count);
moq-dev PR #2468 (controller defaults); Chrome field data on UDP impairment (5 %); Chromium's
`quic_constants.h` and packet reader (1 472 B, 1 MiB receive buffer).
