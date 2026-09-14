# Latency and throughput — what is still open, in order

**Target, set with the owner 2026-09-14: a browser on a mobile, lossy wireless link, thousands of
sessions per server.** Every row below is ranked for that reader: first what shortens the wait
for a frame on such a link, then what cuts the server's cost per session, then what is closed.
A row that is not measured says so. The mechanisms and the product direction on each are
[`why-these-changes.md` §10](why-these-changes.md#10--latency-and-throughput-on-one-tree-where-they-part-and-what-joins-them);
this page is the order.

Two facts about the target order the list. On a 20 Mbps link a 250 KB frame takes 100 ms on the
wire, so bytes and round trips dominate anything the server does per frame. And no session can be
heavy — 20 Mbps is about 2.5 MB/s, near 0.4 % of a core — so at thousands of sessions the cost is
CPU per byte, and the load lottery measured on loopback has to be re-read on the target.

## 1 · What shortens the wait on the target link

| # | Item | Why it matters on the target | What decides it | Size |
| --- | --- | --- | --- | --- |
| 1 | **The on-demand network window at `D_min`** | Throughput at the least queueing ([`../adr-client-window-depth.md`](../adr-client-window-depth.md), 6/6 under netem). Built nowhere: neither client keeps outstanding asks, the viewer decides. When `Tf ≫ RTT` (a large frame on a slow link) `D_min` is 1 and that is the right answer, so item 2 has to hold there | Who owns the schedule, this library or the viewer. Then L2 on the rig, fixed against live `D_min` ([`../lanes/L2-ask-policy.md`](../lanes/L2-ask-policy.md), never run). Re-check [`../adr-reject-server-ordering.md`](../adr-reject-server-ordering.md)'s one flip condition, RTT above ~100 ms, which mobile can cross | ~100 lines of TypeScript, one rig campaign |
| 2 | **The depth-1 tail: a lost last datagram waits the probe timeout** | `srtt + 4·rttvar` + the peer's 25 ms `max_ack_delay` — on a 50 ms path about 100 ms, against one RTT for a loss with a packet behind it (§10 entry 2). Inevitable the first time a large frame's last datagram is lost on the target; the 44-segment batch makes a drop that tail more often (entry 3) | §10 proposal 3, in order: an ACK-eliciting packet after an isolated frame (a 1-byte datagram is the cheapest; check first that quinn does not coalesce it into the tail packet), then a 10-segment clamp only for isolated sends, then the shaped cell. Not the clamp everywhere | One send in `frame_out.rs`, one loopback cell (the drop-prone one is on this VM) |
| 3 | **Congestion controller for radio loss** | Measured: BBR −44 to −48 % on exogenous loss, Cubic +63 % better on congestive loss ([`transport-conclusions.md` §1](transport-conclusions.md)). The default is Cubic because the mix was unknown; the target is now stated as radio. Mobile also has bufferbloat, so the mix is still a measurement | Client telemetry from real sessions: is loss correlated with RTT rise. Until then the rig's Gilbert-Elliott model (`cloud_netem.sh … gemodel`) prices BBR against Cubic on a bursty-loss link, with the neighbour-fairness cost in view | One flag; one rig campaign |
| 4 | **Bytes per displayed frame** — progressive HTJ2K prefix, resolution rungs, the stride control law | On this link the wire binds before the receiver (`docs/rig-limits.md` §1 on the `docs/rig-limits` branch), so fewer bytes is the only lever above ~2× | Product decisions above the transport ([`transport-conclusions.md` §4](transport-conclusions.md), [`../adr-stride-is-bandwidth-conservation.md`](../adr-stride-is-bandwidth-conservation.md)); the render path must accept a rung | Outside this layer |
| 5 | **Per-frame streams with ask-order priority under loss** (arm Q) | The shared stream blocks every later frame on one lost packet; per-frame + FIFO lost 5.76× to retransmit deferral; priority by ask order removes the deferral (quinn's pending queue is priority, then FIFO). At 32 KB Q read inside noise at 0.5 % loss and +28 % on the reader clock at 2 %; never run at 250 KB | One rig campaign at 250 KB, 0.5 and 2 % loss, Q against shared, both at their own `D_min`. Branch `feat/set-priority-per-frame` holds the arm; the product form is one `set_priority` call in `frame_out.rs` | One call, one rig campaign |
| 6 | **Session survival across a 4-tuple change** | Per-core endpoints hash on the 4-tuple; a Wi-Fi to cellular move or a NAT rebind lands on another endpoint, which answers with a stateless reset, and the TS client has no reconnect. On mobile this is the design's one cliff | How often it happens, from client telemetry, and whether Chromium migrates a WebTransport session at all (unknown). Then: eBPF reuseport steering on the connection ID, or the multi-thread runtime carrying §9's per-byte work without §8, or client reconnect | Design decision; each option is a few hundred lines |

## 2 · What cuts the cost per session

| # | Item | Why it matters on the target | What decides it | Size |
| --- | --- | --- | --- | --- |
| 7 | **The vendored quinn: does the 44 form on the target, and how small can the patch be** | quinn's pacer bounds a burst to `window × 2 ms / RTT`, floor 10 packets; a 20 Mbps, 50 ms path should never form a 44-packet batch (derived, §10 entry 3), so on the target the change is inert and on LAN it is −16 to −21 % CPU. Either way the footprint is 17 files and 6 000 vendored lines for a one-function change | The shaped cell: seg44 against seg10, CPU per ask, at 20 Mbps / 50 ms and 100 Mbps / 30 ms, both sides in one netns on the rig as `stream_mode_x3_only.sh` does. Footprint, independent of that answer: PR #31's build-time patch (a `.patch`, a thin crate, a script) or a pinned fork; a `TransportConfig` knob upstream ([quinn-rs/quinn#2189](https://github.com/quinn-rs/quinn/issues/2189)) is the shape that removes the patch | One rig campaign; one PR already open |
| 8 | **Placement at thousands of sessions** | One endpoint per core is the default that uses every core, and thousands of sessions multiplex on those threads; the counts even out and the remaining risk is load — a few fills among idle sessions on one thread. On the target no session is heavy, so that risk should be small. Named, not measured. Oversubscribing `--workers` is a small-N hedge (§10 entry 4), not the plan | The rig at 64–256 sessions with the client off the box, the heavy-tail mix at the default worker count, against one endpoint on the multi-thread runtime | One rig campaign |
| 9 | **PR #27, LTO** | −3 to −6 % CPU per ask at saturation on this tree; +7 % p50 (6/6) at 32 KB, depth 1, one session. Depth 1 is the large-frame case (item 1), so that cell can veto it; depth 4 cannot | Weigh on the depth-1 cell if that path ships; otherwise take the CPU | A profile entry |
| 10 | **Read path on the target** | P0 and the rest of [`../disk-access/NEXT.md`](../disk-access/NEXT.md): ring against pool on the production volume, `read_ahead_kb`, the frame cache. On this link a read is ~1 % of a frame's wire time, so this is cost, not latency | The disk lane's own list, on the target | Its own list |
| 11 | **Memory and limits at thousands of sessions** | `send_window` default 10 MB is the ceiling per stalled client and the chunked path holds 180 kB of it; rings charge memlock; no admission control at accept | Deployment manifest ([`../disk-access/DEPLOYMENT.md`](../disk-access/DEPLOYMENT.md)); a stall campaign at 1 000 sessions on the target | Manifest lines; one campaign |

## 3 · Below the wire on this link

| # | Item | Standing |
| --- | --- | --- |
| 12 | Chromium's receive thread and decode queue (`rig-limits.md` §1–2) | The ceiling on loopback; on a 20 Mbps link the wire binds first. Client-side work, after item 4 |
| 13 | `--workers` above the core count | A small-N, LAN-side hedge for the placement lottery (§10 entry 4); not the target's problem and not the scale plan |

## 4 · Closed

| Item | Why |
| --- | --- |
| `max_udp_payload_size` above 1 472 B | Chromium's reader drops the datagram (§10 entry 6) |
| ACK-frequency extension to shorten the probe timeout | quinn peers only; Chromium's `max_ack_delay` is 25 ms and fixed |
| A 10-segment clamp everywhere as the depth-1 answer | Spends §9's LAN CPU to buy a tail that only exists when nothing follows the frame (§10 proposal 3) |
| Per-frame streams without priority, `send_fairness`, `yield_now`, window equalisation | Measured and rejected: [`transport-conclusions.md`](transport-conclusions.md), [`why-these-changes.md` §8](why-these-changes.md) |
