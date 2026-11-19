# The transport's design

How a frame's bytes get from the server's store to a client: what the transport is, its rules, what is decided and
what is open. What the product is for is [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product; the bytes on the
wire are [`../WIRE.md`](../WIRE.md); the reasons and numbers are the evidence files linked below, which stay where
they are this round. Rewritten in place, never appended to (`CLAUDE.md` §Docs). *Written 2026-11-14 as an inventory
of what exists; nothing here is new evidence.*

## What it is

```
browser                                                    series server (one process, one UDP port)
 downloader worker  (client/transport/downloader.js)
  └ session carrier: WebTransport  (ts/session.ts; wasm/)  ═ QUIC, ALPN h3 ══╗
                     WebSocket     (ts/ws-session.ts, off) ═ TCP + TLS ═══╗  ║   one quinn endpoint
                     race of both  (ts/race-session.ts, opt-in)           ║  ╠═► routes by ALPN (transport/server.rs)
    control bidi ── FoD asks: request_frame · stream_frames · end_stream ─╫──╫─►  planner   what to send next
    media uni   ◄── one envelope per frame [len BE][index BE][coded frame]╫──╫──  link      the send path, frame pool
native client (client/native)  ═ raw QUIC, ALPN wt-pacs/1 ═══════════════╫══╝   frame store, read path (media/)
                                                                         ╚══►  websocket.rs (--websocket)
```

| part | owns | where |
| --- | --- | --- |
| downloader | the session, a record per owed frame, the want sent as asks or a fill, re-dial on a dead session | `client/transport/downloader.js`, [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader, §Session survival |
| carriers | one session's bytes over WebTransport, WebSocket, or the race of the two; the same frame session above each | `client/transport/ts/`, `client/transport/wasm/` |
| endpoint | QUIC and TLS, the ALPN routing, the controller, the windows, the opening ask | `server/src/transport/server.rs`, `tuning.rs` |
| planner | asks in hand, a fill recited between them, the read-ahead | `server/src/transport/planner.rs` |
| link | the envelope head then the frame as `Bytes` from the pool; one shared uni stream | `server/src/transport/link.rs`, `server/src/media/frame_pool.rs` |
| native mapping | the same FoD and envelopes on a raw QUIC connection, no HTTP/3 | [`../WIRE.md`](../WIRE.md) §The raw QUIC mapping, [`../native/README.md`](../native/README.md) §8 |

## Rules

* The wire carries the stored coded frame unchanged; a frame is named by its index, never by its stream.
* A frame is complete at its envelope's last byte; there is no acknowledgement message.
* The want's order is the client's; the server serves asks in order and never reorders by a rule of its own.
* An ask ends a running fill; the asked frame is served next and the client asks again for the rest.
* The server bounds every message before allocating it: FoD ≤ 64 KiB, an envelope ≤ 64 MiB.
* A client's goodbye (close, stop, FIN, WebSocket Close) is a normal end, never a WARN.
* One endpoint serves WebTransport and raw QUIC from the same code below the first FoD message.
* Every option still under investigation is a flag whose default is the tip's behaviour, until its rule decides it.

## Decided

| choice | date | whose | evidence |
| --- | --- | --- | --- |
| `cubic-restart` (Cubic, slow start restarted after a silence) the default controller; `bbr`, `bbr-bound` options; real-world runs decide | 2026-10-02; kept 2026-11-11 | measured rule; the owner | [`transport-conclusions.md`](transport-conclusions.md) §The answer, §1, §3 *After a blink*; [`../client/evidence/congestion-controller.md`](../client/evidence/congestion-controller.md) |
| Initial window: quinn's default (12 000 B); 32 packets stays an opt-in proposal | 2026-09-19; 2026-10-13 | measured; the owner | [`transport-conclusions.md`](transport-conclusions.md) §3 *The first ask on an idle session*; [`link-conditions.md`](link-conditions.md) §Re-measured, proposed |
| The opening ask in the session URL (`?ask=`), on by default | 2026-10-02 | measured | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The opening ask; [`../WIRE.md`](../WIRE.md) §The opening ask |
| One shared media stream (`shared`); `per-frame` a flag | 2026-09-26 | measured | [`../adr/stream-shape.md`](../adr/stream-shape.md); [`transport-conclusions.md`](transport-conclusions.md) §2 |
| The fill and the ask: `stream_frames` for a fill, `request_frame` per ask, an ask ends the fill; one queue with a send window that follows cwnd measured a trade-off, flags off | 2026-10-03; 2026-10-22 | measured; the owner's call open | [`../WIRE.md`](../WIRE.md) §An ask during a fill; [`../client/evidence/ask-during-a-fill.md`](../client/evidence/ask-during-a-fill.md) |
| Flow-control windows: quinn's defaults (a stalled client costs 180 kB) | 2026-09-04 | measured | [`../adr/transport-quic-stream-receive-window-defaults.md`](../adr/transport-quic-stream-receive-window-defaults.md); [`transport-conclusions.md`](transport-conclusions.md) §3 |
| Early SETTINGS and a probe in every handshake space, build-time crate patches, on | by 2026-10-02 | measured | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Early SETTINGS; [`upstream-wtransport-settings.md`](upstream-wtransport-settings.md) |
| GSO cap 24 segments a `sendmsg` in the default build | 2026-10-14 | the owner | [`transport-conclusions.md`](transport-conclusions.md) §4, §9 item 6 |
| One endpoint on the multi-thread runtime; per-core endpoints parked (they drop rebinds) | 2026-09 | measured | [`transport-conclusions.md`](transport-conclusions.md) §6 |
| Raw QUIC (`wt-pacs/1`) for the native client, beside WebTransport on the same endpoint | 2026-10-26 | the owner | [`../native/quic.md`](../native/quic.md) §5; [`../client/evidence/native-client-wire-parity.md`](../client/evidence/native-client-wire-parity.md) (a tie) |
| A WebSocket carrying the same bytes, built, off by default; no TCP for the fill unless proven | 2026-10-02; 2026-11-11 | the owner | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The TCP fallback; [`../client/design.md`](../client/design.md) §Decided |

## Open

Fixtures behind every number below unless an item says otherwise: synthetic and DBT series on 4-core cloud hosts
without a GPU, headless Chromium, the userspace relay `lab/scripts/link_impair.py` or loopback, not a radio
([`../rig-limits.md`](../rig-limits.md) §3); one phone run on one home Wi-Fi link
([`../client/evidence/link-profiles.md`](../client/evidence/link-profiles.md)).

* **The target links.** Six profiles (home, enterprise and public Wi-Fi, LTE, 5G sub-6 and mmWave) from published
  measurements, with the regime per profile derived: the optimal-quality view decode-bound on a phone above
  ~83 Mbit/s, HTJ2K wire-bound almost everywhere if its phone decode keeps the cloud's ratio (unmeasured).
  *Decides:* the phone's HTJ2K decode per frame, the loss a radio leaves, loaded RTT per profile.
  *Evidence:* `claude/link-targets:docs/transport/link-profiles.md` (theory, sources; a draft PR), building on
  [`link-conditions.md`](link-conditions.md).
* **HTJ2K alone over WebTransport against TCP-based stacks (HTTP/2 `fetch`, WebSocket) and HTTP/3 `fetch`**, on the
  profiles above, the codec fixed so only the transport varies. *Theory so far, not measured:* HTTP/3 `fetch` in
  Chromium runs the same QUIC stack with the same 6 MB stream window, so on a clean link it should tie, gaining a
  pooled connection (no dial, TLS resumption, 0-RTT for a GET) and costing discovery (`Alt-Svc` or an HTTPS record)
  ([`delivery-prior-art.md`](delivery-prior-art.md) §8, Chromium 141 read). Over TCP one ordered byte stream holds
  every frame behind a loss, so the per-frame inter-arrival p99 should part from QUIC's under loss while the median
  follows the controller, which the ask's loss slope already did on both (QUIC and kernel TCP within the same
  controller's band, [`transport-conclusions.md`](transport-conclusions.md) §5 *The ask's loss sensitivity*); an ask
  during a fill waits behind TCP's socket buffer in place of QUIC's send window, not the same size; a cold dial is
  three round trips over TCP + TLS + upgrade against QUIC's 2.1 (not measured on a link,
  [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The TCP fallback). *Decides:* a protocol pre-registered by a session that
  will not run it — arms our session (TS and WASM clients), HTTP/3 `fetch`, HTTP/2 `fetch`, WebSocket; one metric a
  comparison (a fill's time, the first frame, an ask's latency during and after a fill; bytes; client and server
  CPU), a prediction per profile, arms interleaved, the host's saturation stated, each profile labelled measured or
  assumed. The comparison's brief: `claude/work-ledger:docs/transport-session-2026-11-14.md` question 2.
  *Theory and a prediction per profile, 2026-11-17:* [`evidence/stacks.md`](evidence/stacks.md) (the fill ties where the wire
  binds; setup, the ask during a fill and CPU part the arms; the protocol is TRANSPORT-PROTOCOL's).
* **The loss mix, and whether `bbr` is withdrawn.** BBR fills in 0.11–0.12 of Cubic's time under 1 % random loss on
  the lab's links; on the phone's Wi-Fi the loss was congestive and `cubic-restart` faster in 9 of 10 pairs, both
  failures under `bbr`. *Decides:* the server's round-trip samples before each loss on real links; the owner, on the
  phone round's rule. *Evidence:* [`../client/evidence/congestion-controller.md`](../client/evidence/congestion-controller.md),
  [`transport-conclusions.md`](transport-conclusions.md) §1, §9 item 2; a real-link protocol on
  `claude/design-congestion-controller:docs/transport/transport-conclusions.md` §Proposed: the congestion controller, on real links.
* **Host networking for the servers.** `deploy/compose.yml` publishes ports; the phone run used `--network host`.
  *Theory, not measured in a forwarded mode:* rootless publish walks the host stack once a datagram (~16 600 a fill
  against 750–1 200 sendmsg calls) through a 726 kB tap ring whose drops read as congestion; the proposal is an
  override with `network_mode: host`, the default unchanged until a check from a client off the host, arms
  interleaved, tap drops counted. *Evidence:* `claude/hostnet-theory:docs/transport/network-mode.md` §1, §2, §5, §6.
* **The first ask's window and `--initial-rtt-ms`** at the target's real round trip: 32 packets is −28 to −33 % on a
  fresh session's first ask and does not stack with the opening ask; under BBR on the exact server it read slower,
  unexplained. *Decides:* the owner; a run at the real RTT. [`transport-conclusions.md`](transport-conclusions.md) §3
  *A 32-packet initial window*, *A 100 ms initial RTT*.
* **The ask during a fill as the product:** one server queue with a send window that follows cwnd moved the ask to
  ×0.32–0.90, at a fill cost up to +45 ms in one cell. *Decides:* the owner.
  [`../client/evidence/ask-during-a-fill.md`](../client/evidence/ask-during-a-fill.md).
* **The idle radio and keep-alive:** by report a radio idles after 5–10.5 s and wakes in 0.19–1.9 s; neither the
  browser's ping nor the 20 s keep-alive prevents it. *Decides:* a device trace.
  [`transport-conclusions.md`](transport-conclusions.md) §3 *The idle radio*; [`../adr/transport-idle-sessions.md`](../adr/transport-idle-sessions.md).
* **Browsers beyond Chromium:** draft-02 and draft-07 negotiate in Chrome and Firefox; Safari unmeasured, and by
  report iOS stalls a WebTransport session after 16 MB (recycling measured in the lab only). *Decides:* one Safari
  session and one frame, and a device check of the stall. [`transport-conclusions.md`](transport-conclusions.md) §9
  items 1, 12; [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The TCP fallback.
* **Reachability and the fallback:** by report 3–5 % of networks impair UDP, and a swallowed dial costs 4 s; whether
  the WebSocket or the race is enabled waits on a field failure rate. [`transport-conclusions.md`](transport-conclusions.md) §9 item 10.
* **A handover:** Chromium's WebTransport client does not migrate (source read, no phone tried), so every handover
  is a cold re-dial. *Decides:* a device reading. [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Session survival.
* **Named only:** the stream shape under BBR; a thousand stalled sessions and admission at accept; a PING after a
  frame's tail; multipath and the native stack ([`transport-conclusions.md`](transport-conclusions.md) §9 items 7, 9,
  11; [`../native/quic.md`](../native/quic.md) §5).
