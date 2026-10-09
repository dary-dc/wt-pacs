# Transport — what was measured, what was chosen, what is open

What the transport measured and chose, why each change exists, and what is still open. One entry
per decision, not per commit; the code carries a one-line pointer here and this file carries the
reason.

**The tree as it builds.** `--stream-mode` defaults to `shared`, the controller to Cubic with
slow start restarted after a silence (`cubic-restart`, §3), the opening ask to on (§3 *The bytes the viewer needs anyway, pushed at session open*), and
every flow-control window to quinn's default. A frame goes to quinn as the reader's own buffer
(`media/frame_pool.rs`), the only send path. The release profile is `lto = "fat"`, one codegen unit.
Two crate patches are on by default through `[patch.crates-io]` — wtransport's SETTINGS in the
handshake flight and quinn-proto's probe of every space — and why they exist is
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Early SETTINGS. Two levers are **build-time opt-ins**: the
MTU-derived GSO cap (`patches/quinn-0.11.11-mtu-gso.patch`, §4) and a profile-guided build
(`scripts/pgo_build.sh`, §4). Every other lever below is a flag at quinn's default.

**The target**, set with the owner 2026-09-14: a browser on a mobile, lossy wireless link, thousands
of sessions per server. In numbers: at 20 Mbit a 250 KB frame is 100 ms on the wire, so bytes and
round trips outweigh anything the server does per frame; 20 Mbit is ~2.5 MB/s, about 0.4 % of a
core (0.7 % measured on a container's core, §4 LOAD), so no session is heavy and at thousands of sessions the cost is CPU per byte; and the round
trip is 30–80 ms, so a 28 ms tail that dominates loopback is half a round trip there.

**How to read the numbers.** Variants are interleaved inside every round unless a row says otherwise;
figures are medians; "5/7" is rounds won, paired round against round. The userspace relay
`lab/scripts/link_impair.py` is the impaired link in a container; what it cannot model is
[`../rig-limits.md`](../rig-limits.md) §3. Rejected variants (`copy` / `split` send paths,
`--ask-priority`, MTU and socket knobs) were deleted from `server/`, not hidden behind a feature;
the campaigns that rejected them, with method, reviews and TSVs, are on tag
`archive/transport-lab-2026-09`:

```bash
git show archive/transport-lab-2026-09:docs/transport/transport-conclusions.md   # read, do not restore
git checkout archive/transport-lab-2026-09 -- lab/transport                      # the campaign drivers
```

The variants measured below and retired on 2026-10-02 — the bounded BBR, the early slow-start exit
(HyStart), the idle restart, NewReno, the fixed stream pool and the prefault hop — are in the history
at `6e9c126`.

---

## The answer

| decision | verdict |
| -------- | ------- |
| **Congestion controller** | **Cubic, restarting slow start after a silence (`cubic-restart`, the default since 2026-10-02: −4.6 to −6.6 s a fill after a dropped blink, a tie otherwise, §3 W5b). BBR stays opt-in.** Congestive loss → Cubic, random loss → BBR, both by large margins (§1). Through the whole product on lossy links, BBR fills in 0.04–0.76 of `cubic-restart`'s time on both codecs but costs +2–13 % on some clean and jitter cells, so it is not adopted (LOSSCC, the owner's call). In a browser under 1–3 % random loss BBR fills 12–19× faster (CC1); on phone-like profiles it ties or beats Cubic by 1.0–2.3× (PROF). Its price is the queue: ~45 % of its datagrams overflow a 120 ms buffer, it stands 27–294 ms of queue, and it takes 99 % from TCP Cubic behind a shallow FIFO — a neighbour cost fq_codel removes, though not its own queue (FQC). An ask's loss slope is the controller's on QUIC and kernel TCP alike (§5 ASKL). Through the product's client, 1–5 % loss: BBR 0.04–0.74 of the fill, Cubic with or without the restart the same; not adopted, 1.01–1.04 on clean 5 Mbit (LOSSCC). A bounded BBR was built and retired (BB2, BBF); v3's loss bound is built opt-in as `bbr-bound` and fails its pre-registered rule: 2.3–3.2 % of its packets meet CoDel against a 2 % bar, +375 ms on an ask at 4 % loss against +73 (BB3, BB3MEASURE); it stays opt-in |
| **Stream shape** | **One shared stream.** Per-frame + FIFO lost 5.76× at 250 KB on a real path; with ask-order priority it is level, and a fixed pool is closed and retired (§2, [`../adr/stream-shape.md`](../adr/stream-shape.md)) |
| **Initial congestion window** | **quinn's default — but the "≤ 7 %" that used to be the reason is corrected (2026-09-19).** That cell averaged many asks on one session and never measured the first ask, the only place the window matters. On the first ask of an idle session 32 packets is **−28 to −33 %**, and flat at −16…−33 % behind any queue of 20 packets or more; it loses in one cell (+11.8 %, 250 KB / 80 ms / 10-packet queue) and buys nothing on top of the push at session open, which is the larger lever and the default (§3) |
| **Send path** | **The reader's buffer handed to quinn** as `Bytes`, one copy of four gone: −3 to −8 % CPU per ask in every cell, nothing against (§4). It also bounds what a stalled client costs (§3) |
| **GSO segment cap 10 → `65527 / mtu`** | **Opt-in at build time.** −16 to −21 % CPU per ask, 6/6, and +10 to +30 % throughput where the pipe is full — and at 250 KB, depth 1, four sessions it takes p99 from ~2 ms to ~28 ms, reproduced twice. GS1 found that tail to be the rig client's receive queue, which a browser does not share, and a ceiling of 24 that keeps two thirds of the win with no tail seen. Ship 24, or 45 behind the product's buffer: **the owner's call** (§4, §5) |
| **Profile-guided build** | **Opt-in, per release build.** −8.6 to −10.6 % CPU per ask on top of the plain build of the same source, no cell against (§4) |
| **Flow-control windows** | **quinn's defaults.** A client that asks for 25 MB and stops reading costs the server **180 kB** on this send path (§3) |
| **Runtime shape** | **One endpoint on the multi-thread runtime.** One endpoint per core won every single-session cell and most saturation cells, and **12 of 16 NAT rebinds kill the session** on it. Parked at `d9ebe32` (§6) |

`--stream-mode per-frame`, `--congestion cubic | bbr`, `--initial-window-bytes`, `--initial-rtt-ms`
and `--opening-ask false` are flags, each for the cell named where it is measured below.
`--packet-threshold`, `--persistent-congestion-threshold` and `--ack-frequency-max-delay-ms` were
removed with their variants once closed (§3, [`../CLIENTS.md`](../CLIENTS.md) §ACK frequency, by browser);
code: `git show archive/variants-2026-10-03:server/src/transport/tuning.rs`.

---

## 1 · Controller: two answers, which applies is measurable

Every flip in this work happened because a campaign sat in one loss regime and the result
was read as general. The two regimes were run side by side, each verified by queue-drop
counters.

**Congestive** (queue overflow is the only loss) — Cubic wins, and the margin is at high
RTT. At 600 ms / 8 Mbps: Cubic 941 ms vs BBR 1535 ms (BBR is n = 2; Cubic's worst repeat
still beats BBR's best). BBR also drops 30–100× more packets at the bottleneck.

**Exogenous** (1 % radio loss, queue never drops) — BBR wins by roughly half at both RTTs
(−48 % at 50 ms / 20 Mbps; −44 % at 600 ms / 8 Mbps).

5G, satellite and WiFi have both kinds. The diagnostic is: is loss correlated with
queueing delay? RTT rising before loss → congestive → Cubic; loss with RTT flat → radio →
BBR.

**Default Cubic** (since 2026-10-02 with slow start restarted after a silence, §3) until that mix is measured: it is the incumbent; it is the safer error
(63 % worse if wrong, against 48 % the other way); and BBRv1's queue-drop excess is
inflicted on other traffic sharing the link.

That neighbour cost is measured. Two flows, one shared 5 Mbps bottleneck, the cloud rig:

| bottleneck buffer | our flow | competing TCP Cubic | our share |
| --- | --- | --- | --- |
| shallow, ≈48 ms | QUIC BBR | 0.03 Mbps | 99.4 % |
| shallow, ≈48 ms | QUIC Cubic | 1.46 Mbps | 70.0 % |
| deep, ≈1.2 s | QUIC BBR | 2.12 Mbps | 55.1 % |
| deep, ≈1.2 s | QUIC Cubic | 1.07 Mbps | 76.8 % |

The same TCP flow takes 4.5 Mbps alone against the shallow bottleneck — BBR starves it
150×. In a shallow buffer (an access link) BBR takes essentially everything. Cubic is not
innocent (70–77 % from a flow that can take 90 % alone). *Partly corrected 2026-10-01 (NBR,
below):* that rig's TCP flow started 1.5 s after ours; through the relay the same lag takes a QUIC
Cubic from 51.8 % to 67.4 % of a deep buffer against another QUIC Cubic, so most of the 77 % is the
late start, not the protocol.

**Through the relay, 2026-10-01 (NBR, `87df230`, `07bda80`).** The same table through
`link_impair.py`, whose `--udp` pairs share one queue and one clock each way:
[`neighbour_cells.sh`](../../lab/scripts/neighbour_cells.sh), 5 Mbit down, 56 ms, two 30 s native
fills at depth 8 from two servers, 7 rounds by `order.py`, `--self-timing` (6 of 84 runs `VOID`).
**The neighbour is quinn's Cubic, a proxy for Linux TCP Cubic**: it paces and has no HyStart. Our
flow's share, median:

| buffer | our flow : neighbour | `netem`, the rig | relay, 20 / 500 packets | relay, 10 packets |
| --- | --- | --- | --- | --- |
| shallow | QUIC Cubic : QUIC Cubic | 55.6 % | 47.8 % | 54.0 % |
| shallow | QUIC BBR : QUIC BBR | 48.5 % | 50.5 % | 55.3 % |
| shallow | QUIC BBR : TCP Cubic / the proxy | **99.4 %** | **94.0 %** | **95.6 %** |
| deep | QUIC Cubic : QUIC Cubic | 50.4 % | 50.9 % | |
| deep | QUIC BBR : QUIC BBR | 27.6 % (noisy) | 50.5 % | |
| deep | QUIC Cubic : the proxy, 1.5 s late | 76.8 % | 67.4 % | |
| deep | QUIC BBR : TCP Cubic / the proxy | **55.1 %** | **15.2–15.8 %** | |

**Within ±10 points in every cell but the deep BBR ones, so the shallow verdict on BBR against TCP is
admissible through the relay.** BBR starves the proxy 16–22× where the rig's TCP was starved 150×.
The deep cell's gap was the proxy, not the relay: against kernel TCP it reads 49.6 % (FQC, below).
The retired bounded BBR starved itself behind the proxy: 17.6 % of a 20-packet queue, 2.5 % of a
500-packet one.

### A neighbour behind fq_codel, 2026-10-02 (FQC)

`2d087f2`, `2694235`. Does BBR's neighbour cost survive RFC 8290's fq_codel, now in the relay
([`rig-limits.md`](../rig-limits.md) §3)? [`fq_neighbour_cells.sh`](../../lab/scripts/fq_neighbour_cells.sh)
runs on the TUN plane, so the neighbour is **kernel TCP Cubic** under the same queue and loss. Per
run the neighbour starts, then our fresh session makes 20 asks of 64 KB one at a time, then a 30 s
fill at depth 8 runs beside it. NBR's 5 Mbit, 56 ms link with a shallow (20-packet) or deep
(500-packet) buffer, and PROF's LTE-loaded; FIFO and fq_codel (5:100) hold the same total. 7 rounds
by `order.py`, `--self-timing`, 1 of 126 runs `VOID`. Medians; a queue is the flow's median sojourn:

| profile | variant | ask p50 / p99 ms | share | our queue ms | the neighbour's queue ms |
| --- | --- | --- | --- | --- | --- |
| shallow | Cubic, FIFO | 289 / 401 | 44.8 % | 35.5 | 34.2 |
| | Cubic, fq | 278 / 319 | 50.1 % | 6.5 | 5.5 |
| | BBR, FIFO | 257 / 543 | **98.8 %** | 44.0 | 29.7 |
| | BBR, fq | 274 / 330 | **49.9 %** | 27.1 | 4.3 |
| deep | Cubic, FIFO | **2 159 / 4 262** | **13.1 %** | 1 077 | 1 028 |
| | Cubic, fq | 277 / 330 | 50.6 % | 6.4 | 5.5 |
| | BBR, FIFO | 1 045 / 3 438 | 49.6 % | 1 058 | 1 014 |
| | BBR, fq | 302 / 405 | 49.7 % | **102.6** | 4.7 |
| LTE-loaded | Cubic, FIFO | 871 / 2 530 | 51.7 % | 881 | 504 |
| | Cubic, fq | 351 / 540 | 50.6 % | 9.3 | 8.5 |
| | BBR, FIFO | 602 / 2 327 | 66.8 % | 833 | 467 |
| | BBR, fq | 271 / 539 | 59.6 % | **196.1** | 8.5 |

**BBR's neighbour cost does not survive fq_codel; its own queue does.** Behind a shallow FIFO BBR
leaves kernel TCP 1.2 %; behind fq_codel the split is 49.9 / 50.1 in every round, and the neighbour's
queue is 4–9 ms in every fq_codel variant whatever our controller does. BBR ignores CoDel's drops (14–26 %
of its packets, Cubic's 0.6–1.4 %), so its fill stands 27–196 ms in its own flow queue, which its asks
share. With real TCP the deep FIFO reads 49.6 % (the rig 55.1 %), and a deep FIFO starves quinn's
paced Cubic against Linux's: 13.1 % in every round, a 2.2 s ask; fq_codel gives it 50.6 %. Every
steady ask's p99 falls behind fq_codel (−81 ms to −3.9 s); BBR's shallow p50 alone rises, +17 ms. The
retired bounded BBR's starvation was a FIFO's (18 → 50 % shallow, 25 → 50 % deep, 7/7). Whether a
user's bottleneck runs fq_codel is not measured. No default changed.

### Why two answers and not one

Picking one and moving on was rejected: whichever is picked is ~50 % wrong on half the users, and
nothing in the transport says which half. **What would make the second answer academic:** client
telemetry showing the mix is overwhelmingly one kind.

**The prior may be inverted — unverified, and the owner's to weigh (2026-09-19).** Published
link-layer figures put the residual loss a transport sees on LTE / 5G near 10⁻⁵: the radio's own
retransmission turns radio loss into delay. What a phone then loses is queue overflow in the radio
network — congestive, Cubic's case — and handover gaps (§3, after a blink). So the 1–3 % random loss
behind every BBR win below may describe an edge rather than the median. Wi-Fi was not covered.

**The server's half of the question is already logged.** Once per session, from quinn's counters:
`session path mtu=… rtt_us=… cwnd=… sent=… lost=… congestion_events=… datagrams_tx=…`
(`server/src/record/path.rs`). `lost` against `congestion_events` and the round trip is the
server-side reading; the client half — the round-trip trend in the second before each loss — is
not built.

### Priced in a browser, on a lossy link, 2026-09-24 (CC1)

A native run (L3, 2026-09-18, [`../rig-limits.md`](../rig-limits.md) §3) found BBR 5–9× faster than
Cubic at 1–3 % loss and left it to be priced in a browser.
[`../../lab/scripts/controller_browser_cells.sh`](../../lab/scripts/controller_browser_cells.sh):
headless Chromium, the downloader through `link_impair.py` at **20 Mbit and 80 ms**, a 200-packet
queue (120 ms) unless stated, one server per run, variants rotated inside every round, **7 rounds**. A
fill is 20 × 428 KB; an ask is one 428 KB frame on a fresh session. Lost and overflowed are shares
of the server's datagrams (its `session path` line, the relay's queue counter); the queue is the
smoothed round trip at the session's end less 80 ms. Median [range], rounds won against Cubic:

| cell | fill: Cubic | Cubic + restart | BBR | ask: Cubic | BBR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 % loss | 45.1 s [39.6–48.3] | 42.7 s, 3/7 | **3.8 s** [3.7–3.8], 7/7 | 807 ms | **338**, 7/7 |
| 3 % loss | 75.5 s [71.1–82.5] | 78.0 s, 2/7 | **3.9 s** [3.8–4.1], 7/7 | 2 360 | **380**, 7/7 |
| radio: ordered ±10 ms, Gilbert–Elliott | 6.4 s [4.0–15.0] | 5.2 s, 2/7 | **3.9 s** [3.8–4.0], 6/7 | 624 | **484**, 7/7 |
| a 500 ms blink, no loss | **4.54 s** [4.52–4.56] | 4.85 s, 0/7 | 4.89 s, 0/7 | 553 | **315**, 7/7 |
| 1 % loss, 1 500-packet queue | 43.4 s [38.5–49.2] | — | **3.8 s** [3.7–3.8], 7/7 | 795 | **344**, 6/7 |

| what BBR costs | Cubic | BBR |
| --- | ---: | ---: |
| datagrams lost, 1 % / 3 % / radio | 1.1 / 3.0 / 0.7 % | **46.4 / 47.1 / 40.6 %** |
| of which the queue overflowed | 0 | **45.3 / 44.0 / 40.1 %** |
| standing queue, 200 packets | 4–11 ms | **43–77 ms** |
| standing queue, 1 500 packets (no overflow) | 5 ms | **294 ms** |

*Re-taken 2026-09-24 on an idle box*; a first run shared the cores with runaway servers and agreed in
every verdict.

**The browser confirms L3 and widens it**: under random loss BBR fills **12× (1 %) to 19× (3 %)
faster** and answers a fresh ask **1.3 to 6.2× sooner**, 6/7 or 7/7 in every lossy cell. **Its price
is the queue, both ways.** Against a 120 ms buffer it sends about twice the fill's bytes and the
bottleneck drops half; against a 900 ms buffer it stops overflowing and **stands 294 ms of queue** in
front of everything else the phone does. After one blink with no loss it is 7.8 % slower than Cubic
(0/7). The restart (§3, after a blink) as first built tied Cubic in every lossy cell.

**Not the cause of the overflow: quinn's pacer.** It sends `1.25 × window / RTT` and never reads BBR's
pacing rate (`connection/pacing.rs`, 0.11.18), but a prototype pacing a controller at its own rate
overflowed as much (57.6 % against 47.8 %, 3 rounds, 1 %). The excess is BBR's own estimate or window.

**Neither, as they stand.** Cubic is an order of magnitude wrong for random loss; quinn's BBRv1 buys
that back with the queue and a neighbour's share. What would change the default treats random loss as
noise *and* bounds its queue (BB3). Every fill is link-bound (BBR's 3.8 s is 18 Mbit of goodput), so
latency and completion are quoted, not throughput. The relay's loss is exogenous by construction, and
a phone's receive path is not modelled.

### Through the whole product, on a lossy link, 2026-10-08 (LOSSCC)

Row LOSSLINK's cells through the downloader and both codecs, with the controller as the variant: today's
`cubic-restart` against `bbr`. Headless Chromium 141, the 10-bit tomosynthesis volume, HTJ2K and the
optimized AV1 payload (0.943 of its bytes). Frames 0–3 are filled, then 4–7 asked one at a time. Links are
5/20/50 Mbit at 40 ms and `lte-good`, each with no loss, 1, 2 or 5 % (iid; Gilbert–Elliott bursts on
`lte-good`), or ±20 ms of ordered jitter, at 1× and 4×. Williams-ordered, with every visit refusing a
server whose banner names another controller. 28 rounds, the last 16 topping up the cells VOID left short:
3 416 visits, 1 281 `VOID`. **27 328/27 328 frames exact.** n = 10–19 a cell and variant, except BBR's AV1
variant on `lte-good` at 4× with no loss (8) and HTJ2K's with jitter (9).

The VOIDs rose from 11 % of a round to 40–80 % on `lte-good` as the host's steal time rose (≈6 000 ticks
a round). That is the relay's self-timing refusing what it cannot time, so the kept visits are clean but
fewer.

HTJ2K's fill under `cubic-restart` in s; BBR's fill over `cubic-restart`'s for the same codec (the median
of round-paired ratios; in brackets, rounds where BBR was slower, shown only when there were any); an
ask's p50/p95 in ms over both codecs. Each cell is 1× · 4×:

| link | impairment | HTJ2K fill, `cubic-restart`, s | BBR ÷ `cubic-restart`, HTJ2K | BBR ÷ `cubic-restart`, AV1 | ask p50/p95, `cubic-restart` | ask p50/p95, BBR |
| --- | --- | --- | --- | --- | --- | --- |
| 5 Mbit | none | 3.78 · 3.83 | 1.03 (4/6) · 1.03 (8/8) | 1.03 (11/11) · 1.02 (9/10) | 971/990 · 1074/1111 | 975/989 · 1069/1115 |
|  | 1 % | 5.37 · 4.82 | 0.71 (1/9) · 0.74 (1/13) | 0.76 (1/10) · 0.69 | 1602/2219 · 1715/2370 | 984/1021 · 1068/1139 |
|  | 2 % | 8.52 · 8.95 | 0.46 · 0.46 | 0.45 · 0.49 | 2319/3015 · 2319/3012 | 987/1151 · 1085/1187 |
|  | 5 % | 13.7 · 14.0 | 0.30 · 0.29 | 0.28 · 0.30 | 3600/4429 · 3635/4476 | 1006/1424 · 1094/1423 |
|  | ±20 ms | 3.84 · 3.88 | 0.98 (2/8) · 1.01 (5/8) | 0.99 (3/10) · 1.01 (6/9) | 988/1020 · 1076/1127 | 1003/1081 · 1079/1144 |
| 20 Mbit | none | 1.08 · 1.16 | 0.91 · 0.90 | 0.91 · 0.90 | 305/324 · 353/457 | 308/378 · 423/521 |
|  | 1 % | 4.31 · 4.05 | 0.24 · 0.26 | 0.25 · 0.31 | 1486/1934 · 1487/1993 | 317/369 · 401/491 |
|  | 2 % | 7.60 · 7.20 | 0.14 · 0.15 | 0.14 · 0.17 | 2035/2690 · 2060/2744 | 327/487 · 442/536 |
|  | 5 % | 12.2 · 12.5 | 0.09 · 0.09 | 0.09 · 0.11 | 3229/3873 · 3257/4039 | 361/651 · 461/799 |
|  | ±20 ms | 1.19 · 1.23 | 1.03 (6/9) · 1.07 (5/7) | 1.02 (5/8) · 1.01 (4/7) | 320/365 · 418/480 | 326/511 · 432/552 |
| 50 Mbit | none | 0.63 · 0.67 | 0.85 · 0.90 | 0.90 (1/15) · 0.94 (2/9) | 172/193 · 224/332 | 184/273 · 298/425 |
|  | 1 % | 4.14 · 3.70 | 0.13 · 0.16 | 0.14 · 0.17 | 1433/1877 · 1373/2029 | 209/285 · 327/409 |
|  | 2 % | 7.82 · 7.29 | 0.07 · 0.08 | 0.07 · 0.11 | 1965/2596 · 2063/2613 | 216/286 · 328/436 |
|  | 5 % | 12.5 · 12.1 | 0.04 · 0.05 | 0.05 · 0.07 | 3159/3797 · 3320/3946 | 247/393 · 347/463 |
|  | ±20 ms | 0.78 · 0.82 | 1.13 (6/7) · 1.13 (7/9) | 1.00 (3/5) · 1.12 (8/9) | 186/215 · 277/356 | 197/289 · 266/423 |
| `lte-good` | none | 1.14 · 1.19 | 0.99 (1/5) · 0.89 (1/9) | 0.88 (1/7) · 0.92 (1/3) | 270/437 · 387/483 | 299/434 · 394/508 |
|  | 1 % | 1.31 · 1.43 | 0.88 (2/8) · 0.62 | 0.72 (1/9) · 0.60 | 697/1360 · 727/1689 | 303/443 · 404/571 |
|  | 2 % | 4.01 · 3.04 | 0.32 · 0.32 | 0.21 · 0.56 (1/7) | 1290/2118 · 1312/2351 | 314/442 · 404/569 |
|  | 5 % | 11.1 · 9.37 | 0.11 · 0.16 | 0.12 · 0.12 | 2676/10699 · 2759/10193 | 343/1946 · 412/675 |
|  | ±20 ms | 1.24 · 1.28 | 0.97 (2/7) · 1.02 (3/5) | 1.06 (7/8) · 0.97 (2/7) | 342/437 · 408/558 | 314/440 · 395/566 |

* **Under loss BBR is the larger lever by far, on both codecs.** It takes 0.04–0.76 of the fill's time on
  every loss cell, and no 1 % or 2 % cell on a fixed rate came out slower in more than 1 of 9–13 pairs.
  At 5 % the fill no longer depends on loss: 0.55–1.1 s at 20 and 50 Mbit against 12.1–12.5 s, and the link's
  rate is the clock again. An ask's median falls from 1.4–3.6 s to 0.21–1.1 s. On `lte-good` at 5 %, the
  p95 falls from 10.2–10.7 s to 0.7–1.9 s: the probe-timeout tail row LOSSLINK found is gone.
* **Where nothing is lost it can cost.**
  * At 5 Mbit with no loss: +2–3 %, slower in 8/8 and 11/11 pairs.
  * At 50 Mbit with ±20 ms jitter: +12–13 %, in 6/7, 7/9 and 8/9 pairs; AV1 at 1× ties.
  * At 20 Mbit with jitter: +1–7 %, mixed pairs.
  * An ask on a clean fixed rate at 4×: p50 +70 ms at 20 Mbit (353 → 423) and +74 ms at 50 Mbit
    (224 → 298).
  * Clean 20 and 50 Mbit fills, and `lte-good` without loss, are 0.85–0.99 for BBR.
* **`cubic-restart` reproduces row LOSSLINK** within one loss event's spread: 1 % at 5 Mbit 5.37 s against
  5.82, 5 % at 50 Mbit 12.5 s against 12.4.
* **Not adopted, by the round's rule**: a controller may not regress a clean cell, and BBR does (above).
  The neighbour cost and standing queue measured in CC1, FQC and PROF stand unmeasured here. **Whether
  loss's 4–25× outweighs that is the owner's call** (queue.md §Blocked, 2026-10-08). BB3's loss bound is
  the candidate that would aim at both.

### A bounded BBR, retired (BB2, 2026-09-25; BBF, 2026-10-01, `3a221e5`)

Could BBR keep its loss tolerance without its queue? A cap held quinn's BBR window to g × (the best delivery rate of the last ten round trips ×
the minimum round trip), over the public `Controller` trait. CC1's link and cells, 7 rounds rotated
(BB2); then ordered jitter and no loss, a 40 × 428 KB fill, 7 rounds in a Williams order,
`--self-timing` (BBF, `controller_browser_cells.sh jitter10 | jitter20`). Medians:

| cell | Cubic | BBR | bound ×1.25 |
| --- | ---: | ---: | ---: |
| fill, 1 % / 3 % loss | 43.0 / 74.7 s | 3.88 / 3.87 s | **3.86 / 3.92 s** |
| fill, a 500 ms blink | **4.54 s** | 4.94 s | 4.91 s |
| datagrams overflowing 200 packets, 1 % / 3 % | 0 / 0 % | 43.4 / 44.5 % | **0 / 0 %** |
| standing queue, 200 / 1 500 packets | 4 / 4 ms | 50 / 309 ms | **13 / 16 ms** |
| fill, ±10 ms jitter | 7.54 s | 7.37 s | 8.06 s |
| fill, ±20 ms jitter | 7.62 s (3 valid) | all `VOID` | **79.9 s** [12.6–281.4], 4 of 7 on the floor |

**On a link whose round trip stays near its minimum the bound kept BBR's fill at Cubic's queue; on a
jittery one it collapsed.** It multiplies by quinn's all-time minimum round trip, so held at its cap
its next cap is 1.25 × window × min ÷ srtt: it shrinks whenever srtt exceeds 1.25 × min, and the
4-packet floor is absorbing. Jitter lowers the minimum and raises the mean. A 10 s windowed minimum did
not rescue it (−4.6 s, 4/7, still 4 of 7 on the floor): a jitter trough recurs inside any window. It
also starved itself behind a neighbour (NBR, PROF's LTE-loaded: 1 %), and paid 77–104 ms on every
steady ask (§5 TAX). **Retired 2026-10-02.** A cap that jitter cannot ratchet down needs a round-trip
floor not set by the lowest sample; the candidate now is v3's loss bound (BB3).

### Link profiles close to a phone, 2026-10-02 (PROF)

`2cf0354`, `e2190d0`. [`profile_cells.sh`](../../lab/scripts/profile_cells.sh) runs eight profiles
through the relay: a rate trace, a base round trip, Gilbert–Elliott loss in bursts of 3.5 packets, a
FIFO sized in ms at the trace's mean (or CoDel 5:100 on top), and in two of them a quinn Cubic
neighbour. The LTE traces are mahimahi's (GPL-3.0, fetched, never committed): `TMobile-LTE-short`
sha256 `4f33dce8dd811b57…`, `Verizon-LTE-short` `c918436fbd6246af…`, `TMobile-LTE-driving`
`d48ff134fc29c36c…`, from their start; the Wi-Fi traces are steps. **The loss rates, burst length and
depths are picks, not fitted to any measurement.** Each run: a 250 KB first ask on a fresh session,
then a 30 s fill at depth 8 with a 20 ms probe whose extra round trip is the standing queue. 5 rounds
by `order.py`, `--self-timing`, 10 of 120 runs `VOID`. Medians, the neighbour profiles' share in
brackets:

| profile | Cubic: ask ms · fill Mbit/s · queue ms | BBR: ask · fill · queue | BBR's fill × Cubic's |
| --- | --- | --- | --- |
| control: 20 Mbit, 50 ms, 1 % uniform, 120 ms FIFO | 408 · 2.59 · 0.8 | 202 · 18.91 · 109 | 7.29× (5/5) |
| LTE-good: 50 ms, 0.01 %, 500 ms | 314 · 16.18 · 360 | 212 · 15.84 · 382 | 0.97× (0/3) |
| LTE-good + CoDel | 317 · **8.26** · 4.7 | 211 · 15.15 · 200 | 1.83× (5/5) |
| LTE-loaded: 60 ms, 0.1 %, 1 s, a neighbour | **6 101** · 2.12 (45 %) · 731 | 2 208 · 3.07 (67 %) · 702 | 1.42× (4/4) |
| LTE-moving: 70 ms, 0.3 %, 500 ms, a 200 ms held outage | 418 · 5.12 · 57 | 200 · 6.69 · 703 | 1.29× (3/3) |
| Wi-Fi home: 30 ms, 0.5 %, 300 ms | 231 · 10.45 · 1.6 | 223 · 23.07 · 85 | 2.12× (4/4) |
| Wi-Fi home + CoDel | 232 · 10.04 · 1.5 | 239 · 22.60 · 77 | 2.26× (5/5) |
| Wi-Fi busy: 40 ms, 1 %, 300 ms, a neighbour | 756 · 4.78 (51 %) · 8.0 | 717 · 9.63 (85 %) · 199 | 2.01× (5/5) |

**BBR ties or beats Cubic on every profile, 1.0–2.3× (7.3× on uniform loss), and its first ask is
sooner on every LTE profile, every round.** Loss in bursts, not the trace, decides Cubic: 0.5 % on
Wi-Fi home holds it at 10.4 of the trace's 22 Mbit. **CoDel halves Cubic on LTE-good** (16.2 → 8.3
Mbit/s, queue 360 → 4.7 ms) while BBR ignores its drops (6.6 % of its packets) and keeps 200 ms, so a
managed queue widens BBR's lead and makes its queue the neighbour's problem. LTE-loaded is bufferbloat
for every variant (0.6–0.7 s of queue). One trace each, from its start: a profile's verdict, not a
carrier's. No default changed (§9 item 2).

### Under row LOSSLINK's loss, the product's client, 2026-10-08 (LOSSCC, first run)

`c20e7b0`. Queue row 75 of [`../av1/queue.md`](../av1/queue.md): the three controllers the server ships
(`--congestion`), on row LOSSLINK's cells ([`../../lab/av1/delivery/total-time/README.md`](../../lab/av1/delivery/total-time/README.md)
§Row LOSSCC) — the 10-bit tomosynthesis volume as HTJ2K and as the optimized AV1 payload, frames 0–3 filled
then 4–7 asked one at a time, through the downloader in headless Chromium 141; 5/20/50 Mbit and
`lte-good` × clean, ±5/±20 ms ordered jitter, 1/2/5 % loss × 1× and 4×. Six variants (codec × controller)
interleaved in every cell, cells in a Williams order, 10 rounds and 3 more on the clean and jitter cells;
2 879 of 3 312 visits kept (433 `VOID`), **n = 5–13 kept a variant and cell** (103 of 288 under 10),
26 496/26 496 frames exact, no ask failed. The server's own startup line is checked against the variant's
controller every visit. Fill time is frame 0's issue to frame 3 on the page; ratios are median of
rounds paired:

| link | impairment | Cubic-restart fill s, HTJ2K · AV1 (1× / 4×) | BBR ÷ Cubic-restart, HTJ2K · AV1 (1× / 4×) | Cubic ÷ Cubic-restart | ask p50 ms, Cubic-restart → BBR (HTJ2K 1× · 4×) |
| --- | --- | --- | --- | --- | --- |
| r5000 | clean | 3.78 · 3.59 / 3.83 · 3.72 | 1.03 · 1.04 / 1.03 · 1.01 | 1.00–1.00 | 987 → 986 · 1036 → 1036 |
|  | j5 | 3.79 · 3.60 / 3.83 · 3.73 | 0.99 · 1.00 / 0.99 · 0.99 | 1.00–1.00 | 989 → 991 · 1035 → 1061 |
|  | j20 | 3.83 · 3.65 / 3.88 · 3.78 | 1.00 · 1.00 / 0.99 · 1.01 | 1.00–1.00 | 1003 → 1006 · 1051 → 1052 |
|  | l1 | 6.17 · 5.22 / 5.23 · 5.71 | 0.63 · 0.71 / 0.68 · 0.67 | 0.94–1.02 | 1823 → 996 · 1796 → 1039 |
|  | l2 | 9.11 · 8.02 / 8.66 · 8.31 | 0.43 · 0.48 / 0.46 · 0.45 | 0.97–1.01 | 2412 → 993 · 2525 → 1052 |
|  | l5 | 14.03 · 13.19 / 14.06 · 12.98 | 0.27 · 0.28 / 0.29 · 0.30 | 0.99–1.02 | 3745 → 1025 · 3675 → 1055 |
| r20000 | clean | 1.08 · 1.06 / 1.17 · 1.24 | 0.92 · 0.95 / 0.91 · 0.92 | 1.00–1.01 | 292 → 292 · 340 → 343 |
|  | j5 | 1.09 · 1.08 / 1.15 · 1.26 | 0.93 · 0.94 / 0.94 · 0.93 | 0.99–1.01 | 296 → 300 · 344 → 348 |
|  | j20 | 1.19 · 1.18 / 1.24 · 1.33 | 0.96 · 0.96 / 0.98 · 1.02 | 1.00–1.01 | 312 → 318 · 355 → 418 |
|  | l1 | 4.32 · 4.28 / 4.97 · 5.00 | 0.21 · 0.23 / 0.24 · 0.22 | 0.92–1.04 | 1622 → 299 · 1673 → 363 |
|  | l2 | 8.09 · 7.50 / 7.61 · 7.96 | 0.13 · 0.13 / 0.15 · 0.17 | 1.00–1.04 | 2186 → 325 · 2200 → 376 |
|  | l5 | 12.92 · 11.84 / 12.67 · 12.35 | 0.08 · 0.09 / 0.09 · 0.10 | 0.99–1.05 | 3418 → 349 · 3448 → 409 |
| r50000 | clean | 0.61 · 0.64 / 0.68 · 0.80 | 0.86 · 0.82 / 0.86 · 0.92 | 0.95–1.00 | 151 → 156 · 199 → 245 |
|  | j5 | 0.61 · 0.63 / 0.67 · 0.81 | 1.04 · 0.95 / 1.00 · 0.97 | 1.00–1.03 | 157 → 161 · 205 → 280 |
|  | j20 | 0.78 · 0.79 / 0.83 · 1.04 | 1.03 · 0.98 / 1.11 · 0.98 | 0.99–1.01 | 171 → 192 · 222 → 229 |
|  | l1 | 4.18 · 3.98 / 4.53 · 4.22 | 0.12 · 0.15 / 0.13 · 0.21 | 1.00–1.05 | 1534 → 206 · 1631 → 245 |
|  | l2 | 6.45 · 7.32 / 7.77 · 7.67 | 0.08 · 0.08 / 0.08 · 0.11 | 0.96–1.00 | 2090 → 190 · 2153 → 260 |
|  | l5 | 12.43 · 11.90 / 12.73 · 11.78 | 0.04 · 0.05 / 0.05 · 0.07 | 0.97–1.00 | 3313 → 224 · 3236 → 279 |
| lte-good | clean | 1.14 · 1.13 / 1.21 · 1.26 | 0.90 · 0.88 / 0.90 · 0.94 | 0.97–1.01 | 269 → 279 · 315 → 351 |
|  | j5 | 1.16 · 1.14 / 1.20 · 1.26 | 0.92 · 0.90 / 0.88 · 0.98 | 0.98–1.00 | 260 → 293 · 314 → 319 |
|  | j20 | 1.24 · 1.21 / 1.39 · 1.35 | 0.97 · 1.05 / 0.97 · 1.05 | 0.95–1.00 | 314 → 306 · 326 → 328 |
|  | l1 | 1.81 · 1.34 / 1.30 · 1.57 | 0.54 · 0.74 / 0.61 · 0.49 | 0.99–1.11 | 971 → 299 · 806 → 333 |
|  | l2 | 4.39 · 4.50 / 4.01 · 4.35 | 0.24 · 0.23 / 0.26 · 0.58 | 0.97–1.18 | 1597 → 302 · 1552 → 342 |
|  | l5 | 11.63 · 8.69 / 8.73 · 9.27 | 0.10 · 0.12 / 0.11 · 0.14 | 1.08–1.27 | 3293 → 334 · 2795 → 370 |

**Under loss BBR is the only controller that is not the clock**: it fills in 0.04–0.30 of Cubic's time
on the fixed links at 1–5 % (0.49–0.74 on `lte-good`'s bursts at 1 %), wins every paired round but
a handful, and holds an ask near its clean time (3 313 → 224 ms at 5 % on 50 Mbit) where Cubic's grows
with the loss rate — row LOSSLINK's 20–22× is Cubic's, not the link's. **It is not adopted, because it
regresses where loss is absent:** 1.01–1.04 of Cubic's fill on clean 5 Mbit (faster in 0 of 15 paired rounds at 1×, 3 of 14 at 4×),
1.03–1.11 with ±20 ms jitter on 50 Mbit HTJ2K, and an ask on clean 50 Mbit at 4× 199 → 245 ms; the
round's rule wants no clean cell worse. On clean 20/50 Mbit and `lte-good` it is 0.82–0.95. Its queue
and neighbour cost (CC1, FQC) were not re-measured here. **Cubic restarting after a silence ties plain
Cubic on every cell** (pooled 0.997–1.016): random loss is not a silence, so the restart neither helps
nor hurts here, and stays the default for the blink it was built for (§3 W5b). The two codecs move
together under every controller. The client in the tree carries row ASKDEADLINE's resume on a frame
timeout (`37d7cb1`); one container, the relay on its own core.

### quinn's BBR read against the published BBRv1, 2026-09-15

A public report called quinn's BBR broken without naming a cause, so `congestion/bbr` (651 lines) was
read against the published BBRv1 before any cell. **Faithful** in its four modes and transitions, its
constants (high gain 2.885, pacing cycle `[1.25, 0.75, 1×6]`, startup growth target 1.25, three rounds
without growth to leave Startup, cwnd gain 2.0), the gain-cycle seed and the recovery window. **Three
departures.** The minimum round trip is all-time, not v1's 10 s window: on expiry `on_ack` re-reads
`RttEstimator::min`, which never rises, so ProbeRtt drains the pipe and refreshes nothing, at
0.75 × BDP rather than 4 packets (*corrected 2026-10-02, BB3:* the first reading called the model
faithful and missed this). The pacer ignores BBR's pacing rate (not the overflow's cause, CC1). And
`exiting_quiescence` is never set, so BBR enters ProbeRtt on the first ACK after ≥ 10 s idle. The
window ignores loss in Startup (`window()`, line 488), as v3 does, so that is not a departure to fix.

### quinn's BBR against BBRv3, 2026-10-02 (BB3)

`0052dc4`. An answer from sources, nothing measured: the CCWG draft's editor's copy
(`draft-ietf-ccwg-bbr-latest`, sha256 `f0304976…`), the BBRv3 branch of Linux's `net/ipv4/tcp_bbr.c`
(sha256 `04ba1e8b…`) and quinn-proto 0.11.18 `congestion/bbr`. A figure not quoted from a row is
derived.

| | quinn 0.11.18 (v1) | v3 (draft; Linux where it differs) |
| --- | --- | --- |
| loss in Startup | ignored by the window; Startup ends after a round without +25 % growth while in recovery | ignored by the window; Startup ends when a round loses > 2 % in ≥ 6 ranges, `inflight_hi` := max(BDP, last round's delivery) |
| loss after Startup | one round of packet conservation, floored at in-flight + acked; the model never moves | a probe round losing > 2 %: `inflight_hi` := the in-flight where loss crossed 2 %, ≥ 0.7 × BDP; any lossy round: short-term rate and volume := max(last round's, 0.7 × previous), reset each probe cycle |
| probing | `[1.25, 0.75, 1×6]`, one min RTT a phase, window 2 × BDP + aggregation throughout | DOWN 0.9 → CRUISE (cap 0.85 × `inflight_hi`) → REFILL → UP 1.25 (`inflight_hi` grown 1, 2, 4… packets a round); next probe in 2–3 s or min(BDP in packets, 63) rounds |
| min RTT, ProbeRTT | all-time; every 10 s, 0.75 × BDP for 200 ms | 10 s window; every 5 s, 0.5 × BDP for 200 ms |
| ECN | quinn hands CE to the controller as 0 lost bytes: ignored | draft: CE is congestion, response unspecified; Linux: only at min RTT ≤ 5 ms |
| pacing | computed, unused — quinn paces 1.25 × window / srtt (CC1) | the gains are v3's main queue control |

**On quinn's pacer any BBR is window-limited**, so v3's pacing gains do nothing unless the pacer reads
the controller's rate, and its queue is whatever its window caps leave. ECN is out of reach on a phone
path. Each measured cost, and whether v3 removes it:

| cost (row) | v3 | why |
| --- | --- | --- |
| CoDel's drops ignored, 200 ms kept (PROF) | **removes the ignoring** | 6.6 % is 3.3× its threshold, and every lossy round cuts the short-term volume to what the round delivered; where it settles is not derived |
| a 500 ms buffer overrun, 24 000–41 000 packets lost (W4b) | **removes the loss** | a probe overshoots for about one round, ≤ ~275 packets, every 2–3 s: ≤ 2 000–3 300 lost in a 22 s fill. Not the queue: CRUISE's 0.85 × (BDP + buffer) stands ≈ 410 ms, Cubic's 423 |
| a small share against TCP in a deep buffer (NBR) | does not | quinn's window on the all-time minimum carries 2R₀ / (R₀ + Q) of its rate behind a neighbour's queue Q, 9–13 % derived against 15–16 % measured; v1's windowed minimum is what would size it. Against kernel TCP the cell reads 49.6 % (FQC), so the cost may be the proxy's |
| the jitter floor (BBF) | does not | v3 keeps the window form at g = 2; with ±J on 80 ms it can shrink once srtt > 160 − 4J, 80 ms at ±20 — a necessary condition, not a prediction |
| ASKL's flat slope (+1 ms a percent) | may lose it | one 3.5-packet burst in an 82-packet round is 4.3 %, past the 2 % bound; at the 0.7 × BDP floor a 256 KB ask goes 171 → 244 ms, at most +73 ms, flat beyond |

**The smallest build.** Three shapes, by what each removes:

| build | size | removes | does not |
| --- | --- | --- | --- |
| **v3's loss bound alone**, a cap over quinn's BBR as the retired bound was: a round losing > 2 % sets `inflight_hi` := max(in-flight, 0.7 × BDP); the window ≤ 0.85 × `inflight_hi`, regrown 1, 2, 4… packets a clean round | ~150 lines and tests | CoDel ignored, the overrun's loss, the shallow neighbour (derived) | the deep queue (≈ 410 ms on W4b's `flat`), the deep-buffer share (needs the minimum inside quinn's BBR) |
| **a full v3** as a quinn `Controller`, plus a pacer patch | ~2 000 lines, a third carried quinn patch | the first three; the queue only with the pacer patch | the jitter floor |
| **an existing Rust implementation** | one BBRv3 under Apache-2.0, ~2 000 lines with its rate sampler; two BBRv2s, Apache-2.0 and BSD-2-Clause, 5 000–7 000 | as a full v3 | — it is a port, not a dependency |

The loss bound fits quinn's trait with one approximation: `on_congestion_event` gives the lost bytes
and the newest lost packet's send time, so the 2 % is a round's rate rather than the draft's
per-packet `InflightAtLoss`. The full v3 and every existing implementation need a per-packet record of
delivered and in-flight at send, which quinn does not hand over. All three licences are
MIT-compatible.

**The cell that decides it**: PROF's LTE-good + CoDel profile, variants `bbr`, the loss bound and `cubic`,
≥ 5 rounds by `order.py`, `--self-timing`. The bound passes if under 2 % of its packets meet CoDel and
it stands under 50 ms while keeping ≥ 0.9 × BBR's 15.15 Mbit/s. ASKL's 1 % and 4 % cells guard the
slope (≤ +73 ms over `bbr` at 4 %), and W4b's `flat` at 500 ms its loss (< 3 300).

*Built since (row BB3, 2026-10-09):* `--congestion bbr-bound` (`server/src/transport/loss_bound.rs`), the first
shape above, opt-in; the default unchanged. A round ends with the first acknowledgement of a packet sent after it
began; its loss is the bytes quinn declared lost during it over those plus the bytes acknowledged, and its in-flight
the last `on_end_acks` value. The run that decides it is fixed, before any data, in
[`bb3-protocol.md`](bb3-protocol.md).

**Predictions for the bound as built**, per cost; *derived* from the rules above, or *not derived*:

| cost | predicted on the protocol's cell | |
| --- | --- | --- |
| CoDel ignored (PROF) | under 2 % of its packets meet CoDel and its queue stands under 50 ms: a lossy round caps the window at 0.85 of the in-flight that filled CoDel's queue | derived |
| | its fill ≥ 0.9 × `bbr`'s: where the cap settles between 0.85 × in-flight and the regrowth is not derived | not derived |
| the overrun's loss (W4b `flat`, 500 ms) | < 3 300 lost: the cap regrows 1, 2, 4… packets a round, so from 0.85 × (BDP + buffer), ≈ 1 330 packets here, it takes ~8 rounds of ~0.5 s to overshoot again, by at most the last step, ≤ 256 packets: ≈ 5 overshoots in a 22 s fill, ≲ 1 300 lost, plus Startup's one overshoot of at most a round's excess, ≲ 1 330: ≲ 2 600. The queue stays ≈ 0.85 of the buffer, as v3's CRUISE does | derived |
| ASKL's slope, 4 % | ≤ +73 ms over `bbr`: the 0.7 × BDP floor bounds what one capped round costs a 256 KB ask | derived (§1's table) |
| row 75's lossy cells (`l1`–`l5`) | at 2 % and 5 % iid loss most rounds lose over 2 %, so the cap sits near its floor, 0.85 × 0.7 ≈ 0.6 BDP, and a link-bound fill takes up to ~1.7 × `bbr`'s time; over 1.10 × on `l2` and `l5` wherever the wire is the clock, within it on `l1` | derived, the size not |
| row 75's clean and jitter cells | `bbr`'s own time, so `bbr`'s +2–13 % over `cubic-restart` stays — unless those costs are BBR's own overflow, which a lossy round would cap: LOSSCC did not attribute them | not derived |

So the bound is predicted to pass the protocol's first three cells and not to become the default.

---

### The bound, measured (BB3MEASURE, 2026-10-09)

[`bb3-protocol.md`](bb3-protocol.md) run as written on one release build of `claude/av1-unified`; every visit's raw
output is in [`lab/bb3`](../../lab/bb3/README.md). `VOID` is the relay's own timing rule; medians [range over rounds],
ratios the median of round-paired ones. Host: 4 cores; load 0.2–4.2 and steal 0.7–1.3 % median (max 5.8 %) across
the cells. *Not as written:* cells 1–3 ran beside a build pinned to the fourth core at the lowest priority (load up
to 4.2), and cell 4 ran 6 of its 10 rounds, the row's five-hour budget.

**Cell 1, PROF's LTE-good with CoDel** (7 rounds; **16 of 21 visits `VOID`**, every `bbr` and `bbr-bound` visit, so
none of theirs is kept; counted):

| arm | met CoDel | standing queue | fill | first ask |
| --- | ---: | ---: | ---: | ---: |
| `bbr` | 6.54 % [6.14–7.18] | 206 ms [173–213] | 15.29 Mbit/s [15.02–15.56] | 213 ms [181–250] |
| `bbr-bound` | **2.82 %** [2.27–3.23] | 49.9 ms [38.3–60.8] | 14.27 Mbit/s [14.13–14.47], ×0.933 of `bbr`'s [0.908–0.964] | 217 ms [194–232] |
| `cubic-restart` (5 kept) | 0.33 % [0.12–0.38] | 4.6 ms [4.4–5.2] | 7.92 Mbit/s [6.55–8.81] | 316 ms [311–321] |

**Cell 2, ASKL's 1 % and 4 %** (9 rounds; asks 2–30; runs kept/`VOID`): at 1 % `bbr` p50 331 ms, p99 1 045 (8/1),
`bbr-bound` 330 and 1 006 (7/2), `cubic-restart` 697 and 1 664 (9/0); **at 4 %** `bbr` 327 and 5 200 (6/3),
**`bbr-bound` 713 and 6 099 (8/1), +375 ms over `bbr` paired, lower in 0 of 5 rounds**, `cubic-restart` 1 505 and
9 046 (8/1). No ask failed but one of `bbr-bound`'s at 4 %.

**Cell 3, W4b's flat link, 500 ms queue** (7 rounds; 4 `VOID`): fill 23.50 s `bbr`, 23.53 `bbr-bound`, 23.65
`cubic-restart`; standing queue p50 497, 340 and 423 ms; packets lost, kept, **927 for `bbr-bound`** (all seven
0–4 782, median 1 297), 17 401 for `bbr` (0–40 676), 1 681 for `cubic-restart`.

**Cell 4, row 75's cells through the product** (rounds 0–5; 1 440 visits, **603 `VOID`**, 11 520/11 520 delivered frames exact,
6 696 of them in kept visits): `bbr-bound`'s time to every frame on the page over `bbr`'s on the lossy cells and over
`cubic-restart`'s on the clean and jitter cells, `VOID` dropped (n kept pairs in brackets; **bold** over the rule's bar):

| codec | CPU | cell | r5000 | r20000 | r50000 | lte-good |
| --- | --- | --- | --- | --- | --- | --- |
| htj2k | 1× | clean ÷ cubic-restart | **1.031** [1.03–1.03] (3) | 0.895 [0.88–0.91] (4) | 0.876 [0.75–0.95] (4) | — |
| htj2k | 1× | j20 ÷ cubic-restart | 0.982 [0.98–0.98] (1) | **1.038** [1.01–1.07] (2) | 0.936 [0.94–0.94] (1) | 0.973 [0.97–0.97] (1) |
| htj2k | 1× | l1 ÷ bbr | 1.096 [0.99–1.11] (4) | 1.052 [0.99–2.15] (5) | 1.089 [1.05–1.46] (3) | **1.157** [1.11–1.20] (2) |
| htj2k | 1× | l2 ÷ bbr | **1.210** [1.21–1.21] (1) | **1.969** [1.97–1.97] (1) | **1.492** [1.18–1.80] (2) | **1.223** [0.95–3.34] (5) |
| htj2k | 1× | l5 ÷ bbr | **1.781** [1.53–2.03] (2) | **4.196** [3.99–4.40] (2) | **2.691** [2.27–3.11] (2) | — |
| htj2k | 4× | clean ÷ cubic-restart | **1.027** [1.02–1.05] (4) | — | 0.925 [0.81–0.98] (6) | 0.885 [0.88–0.88] (1) |
| htj2k | 4× | j20 ÷ cubic-restart | **1.040** [1.04–1.04] (1) | **1.123** [1.12–1.12] (1) | **1.032** [0.91–1.32] (3) | — |
| htj2k | 4× | l1 ÷ bbr | 1.074 [0.98–1.22] (4) | **1.316** [1.18–1.58] (3) | 0.973 [0.76–2.21] (4) | **1.355** [1.36–1.36] (1) |
| htj2k | 4× | l2 ÷ bbr | 1.056 [0.99–1.12] (2) | **2.704** [2.61–2.80] (2) | **2.404** [1.25–2.52] (3) | — |
| htj2k | 4× | l5 ÷ bbr | **2.024** [1.63–2.42] (2) | **4.049** [3.35–4.75] (2) | **8.341** [4.54–10.86] (3) | **2.969** [2.21–9.68] (3) |
| AV1 | 1× | clean ÷ cubic-restart | **1.024** [1.02–1.02] (1) | 0.956 [0.96–0.96] (1) | 0.857 [0.85–0.97] (3) | 0.876 [0.88–0.88] (1) |
| AV1 | 1× | j20 ÷ cubic-restart | 1.002 [1.00–1.00] (1) | 0.944 [0.85–0.97] (3) | 0.959 [0.96–0.96] (1) | **1.365** [0.97–1.76] (2) |
| AV1 | 1× | l1 ÷ bbr | 1.083 [1.07–1.10] (3) | **1.121** [0.98–1.13] (3) | 1.007 [0.85–1.77] (5) | **1.432** [1.43–1.43] (1) |
| AV1 | 1× | l2 ÷ bbr | **1.129** [1.07–1.25] (3) | **1.823** [1.36–2.29] (2) | **1.417** [1.22–2.34] (5) | **1.193** [1.02–1.37] (2) |
| AV1 | 1× | l5 ÷ bbr | **2.182** [2.18–2.18] (1) | — | **4.576** [1.20–11.84] (4) | **6.210** [3.35–9.07] (2) |
| AV1 | 4× | clean ÷ cubic-restart | 0.985 [0.97–1.00] (2) | 0.875 [0.84–0.90] (3) | 0.951 [0.76–1.15] (4) | 0.924 [0.92–0.92] (1) |
| AV1 | 4× | j20 ÷ cubic-restart | 0.980 [0.97–0.99] (2) | **1.036** [0.97–1.10] (2) | **1.129** [0.96–1.30] (2) | 0.870 [0.87–0.87] (1) |
| AV1 | 4× | l1 ÷ bbr | **1.189** [1.17–1.21] (2) | 1.082 [0.96–2.16] (3) | **1.256** [0.85–3.22] (5) | — |
| AV1 | 4× | l2 ÷ bbr | **1.187** [0.98–1.38] (3) | **1.854** [1.68–2.02] (2) | **1.314** [1.15–1.48] (2) | 0.982 [0.98–0.98] (1) |
| AV1 | 4× | l5 ÷ bbr | **1.823** [1.67–1.98] (2) | **4.086** [2.63–5.55] (2) | **4.812** [4.81–4.81] (1) | **2.742** [2.28–3.20] (2) |

44 of the 73 cells with a kept pair are over the bar with `VOID` dropped, 45 with it counted (`lab/bb3/rule4.py`): 34
of 44 lossy cells, up to ×8.3 at 4× on 50 Mbit/s with 5 % loss, and 10 of 29 clean or jitter cells. Most cells hold
1–5 kept pairs, short of the protocol's 10 rounds.

**By the rule: the bound does not pass** — cell 1's CoDel share is 2.27–3.23 % in every visit against the 2 % bar
(its queue, 49.9 ms, and its fill, ×0.933, are inside theirs), and cell 2's 4 % ask p50 is +375 ms against +73; cell 3
passes. **`cubic-restart` stays the default and `bbr-bound` opt-in**; cell 4 could not have changed that, and it also
misses both of its own bars on most cells. Every `bbr` and `bbr-bound` visit of cell 1 was `VOID`, so its verdict
rests on visits the relay's timing flags; nothing in cells 2–4 depends on that.

## 2 · One shared stream

**The binary defaults to `shared`; `per-frame` is a product flag.** The decision, the
three campaigns behind it and every retraction are
[`../adr/stream-shape.md`](../adr/stream-shape.md). In short:

* **Per-frame + FIFO lost to retransmit deferral.** quinn's `retransmit()` re-queues a lost stream
  with `push_pending`, behind every already-queued stream; on one stream recovery goes out ahead of
  newer data. 3.5× (64 KB) and 8.5× (250 KB) in simulation, **5.76× at 250 KB on a real path, 3/3**,
  and the absolute penalty matched across rigs to 1.6 %. The deciding cell was fixed before it ran,
  with the rule "if it separates, flip the default" — a contested default is settled by the
  measurement named in advance, not by adjudication.
* **Ask-order priority repaired that and did not beat `shared`.** `per-frame` now ranks its streams
  by ask order. Natively (2026-09-15) no per-frame interval excludes zero at any loss level; in
  Chromium through the relay (HOL1, 2026-09-25, Cubic, 128 KB) it moves nothing past 6 %.
* **A fixed pool is closed, and retired.** `pool:2` cost ~75 % on the p95 with no loss;
  in the browser `pool:2` asks were +23 % at 1 % and 3 %, and `pool:4` / `pool:8` fills +268 to +583 %.
* **The variants are byte-identical at depth 1**, so the question has teeth only where the client keeps
  more than one ask outstanding.
* `send_fairness(true)` was worse than FIFO in every cell and is gone from the product crate.
* Bursty loss degrades `shared` by 38 % where scattered loss of the same 0.5 % mean degrades it by
  9 %, and no stream variant changes that: the loss's shape points at the controller (§1), not at the
  streams.

### A closed-loop reader cannot see head-of-line blocking

Four early campaigns compared stream shapes with a reader that blocked on each frame, so the
transport could never fall behind: **0.00 MB stranded**, where the open-loop reader strands
18.31 MB in the same cell. They measured a rig property. `window-harness --reader-mode open` is
that reader; `closed` is still the harness default, and **no stream-shape result from `closed` is
admissible**. A campaign cell whose open-loop reader strands nothing is void, a gate rather than
something to notice afterwards.

---

## 3 · Send path, windows, and the controller's knobs

Send-path and window cells were measured on loopback, never through a path simulator that forwards
datagram by datagram and destroys GSO batching. The controller knobs were measured through
`link_impair.py`.

The pooled hand-off's CPU numbers are §4. A per-frame prefault hop cost 10 % throughput and 14–34 %
CPU per byte with a warm cache, and its flag is retired. `aws-lc-rs` for `ring`, re-measured
2026-09-10 on VAES / AVX-512 hardware: +3–5 % CPU at 32 KB (4/4), a tie at 250 KB, +10–18 % peak RSS
— `crypto-ring` stays. *Corrected 2026-10-03:* this said the `crypto-aws-lc-rs` feature remained for
other hardware; its build no longer compiled, and it was removed (code: `git show c9fce63^:server/Cargo.toml`). ACK frequency, socket buffers and the
initial MTU: ≤ 3 % or nil.

### Flow-control windows — the 180 kB property

"Bound the windows for memory at thousands of viewers" was carried on arithmetic: quinn's
`send_window` defaults to 10 MB, and 10 MB × 5 000 is 50 GB. **Measured, it is not a risk on this
send path.** `window-harness --mode stall` asks 400 frames (25 MB) then stops reading: the server
holds **180 kB**, 11 % more than a client that merely reads slowly and 50× below the ceiling. The
withheld bytes queue on the *client* (2.20 MB), because a stalled peer's stack still ACKs and the
server frees what is acknowledged. On the old `copy` + per-frame path the same client cost
**6.8 MB** — the arithmetic worry was right for the send path the project used to ship, and the
chunked path is what removed it. `RssAnon` and total RSS agree within 1.2 % in every variant, so this is
not a file-backed blind spot. Windows stay at quinn's defaults.

With the pooled hand-off quinn holds the reader's own buffer until the peer acknowledges it, so a
peer that never reads pins it. `lab/scripts/stall_memory_cell.sh`, peak `RssAnon` over the hold
minus the settled baseline (a different instrument from the 180 kB, not comparable to it): at
250 KB, before the pool 3 584 KiB and with it 3 364; at 32 KB, 2 364 against 2 152. **The pool
does not add to what a stalled client costs.**

**What would overturn it:** a client that widens its own receive window on a high-BDP path, where
the in-flight window rather than the peer's credit bounds the server. *A browser is one*
(2026-10-02, W4b, below): Chromium let a fill put a 2.75 MB buffer plus the path's BDP in flight,
where the rig's quinn client stops at 1.25 MB. What that costs the server's memory is unmeasured.

### The first ask on an idle session, 2026-09-19

**W1.** One frame, asked as the first thing a session asks for, through
[`../../lab/scripts/link_impair.py`](../../lab/scripts/link_impair.py) at 40 and 80 ms round
trip. `lab/scripts/first_ask_cells.sh`, five rounds a cell, medians in ms at 40 / 80 ms; "trips" is
the median over the link's round trip. The link has no rate limit, so nothing here is the link.

| session state | 50 KB | trips | 250 KB | trips |
| --- | ---: | ---: | ---: | ---: |
| **fresh** — nothing sent yet | 127.5 / 248.2 | 3.1 | 234.5 / 454.7 | 5.8 |
| **filled** — after eight frames | 51.8 / 98.6 | 1.3 | 55.5 / 104.3 | 1.3 |
| **lossy** — a fill through a 300 ms blackout | 103.8 / 190.8 | 2.5 | 220.1 / 430.8 | 5.4 |
| **rebound** — a fill, then the relay changes its source port | 49.4 / 93.9 | 1.2 | 52.0 / 101.1 | 1.3 |

**The first ask is slow start.** A 250 KB frame costs **5.8 round trips on a fresh session against
1.3 on a warmed one** — 4.4 of them the window opening; 12 KB doubling to 250 KB is exactly six
flights. At 50 KB it is 3.1 against 1.3. A warmed session is **4.2× faster** at 250 KB and 2.5× at
50 KB, at both round trips. quinn keeps a grown window through silence (below), so a warmed session
stays warm.

**"After a lossy fill the ask is slower than on a fresh session" did not reproduce**: the lossy variant
lands *between* fresh and filled (−6 % against fresh at 250 KB, −23 % at 50 KB), because the
blackout collapses the window without taking it below where it started.

**A source-port change keeps the warmed window; a new address resets it** (PUSH, 2026-10-02,
`fa694ee`). quinn-proto 0.11.18 keeps the congestion and RTT state when the peer's port changes on the
same IPv4 address, because that "looks like a NAT rebinding" (`migrate`, `connection/mod.rs` ~:3077).
`first_ask_cells.sh rebind` at 250 KB, 9 rounds Williams-ordered, `--self-timing`, the relay's
`REBOUND` line required: **a port-only rebind reads as warmed**, 50.6 / 102.5 ms against warmed
52.7 / 104.9 and fresh 234.6 / 454.0, every paired round, on the warmed window (1.14–1.18 MB); **a
rebind to a new address** (`--rebind-ip 127.0.0.2`) **reads as fresh**, 223.6 / 442.7, on a fresh
window. *Corrected in place:* LD (2026-09-20) read a port-only rebind as fresh (236.7 / 454.7 at
250 KB) and this row was changed to match; it ran before the relay could change the address, and what
produced that reading is not known. Not tested: whether a real mobile NAT keeps the address.

#### The bytes the viewer needs anyway, pushed at session open

`--opening-ask`: the session URL carries `?ask=fill:0-k`, so the series's first frames are moving when
the control stream opens. The TypeScript client sends it (`openingAsk`), on by default since 2026-10-02; the design and its
browser measurement are [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The opening ask. Pushing 1, 2, 4 and 8
frames before one more is asked takes that ask at 250 KB / 80 ms from 454.7 ms to 204.0, 157.2,
127.6 and **103.9 — the filled variant's 104.3**; at 50 KB, 248.2 to 165.9, 124.8, 108.5 and 98.1. **It
reaches the warmed session's speed**, most of the way at 1 MB.

#### A 32-packet initial window

`--initial-window-bytes 38400` against quinn's 12 000. On the unshaped link it is free: fresh
50 KB 85.8 / 165.5 ms (**−33 %**), 250 KB 167.7 / 319.5 (**−28 to −30 %**), zero loss and zero
congestion events, and no effect once the session is warm. **But an uncongested link cannot punish a
burst.** On 10 Mbit with a 20-packet queue — shallower than the window itself — both levers still
win the asked frame (default 324.2 / 578.2 ms at 40 / 80 ms, 32 packets 266.6 / 432.5, a 1 MB push
248.7 / 305.7) and both pay in loss: at 80 ms datagrams lost go from 2.1 % of the session to 6.5 %
with the wider window and 11.7 % with the push, most of it the push's own bytes.

#### Which default for which session shape, 2026-09-20 (LD)

**W1b.** The cells W1 lacks, on the same probe and relay: the two levers together, a warmed session
left idle, and the wide first flight against the queue depth. Seven rounds a cell, variants interleaved
inside every round with the order reversed every other round, wins counted round against round;
`lab/scripts/first_ask_cells.sh together|idle|queue`. The box carried other lanes, so every figure
reads 3–8 % slower than W1's and only within-cell comparisons are claimed.

**The two levers do not stack.** Ask to last byte, 40 / 80 ms:

| variant | 50 KB | 250 KB | wins vs fresh |
| --- | ---: | ---: | ---: |
| fresh | 133.8 / 255.9 | 244.0 / 463.3 | |
| 32-packet window | 89.7 / 171.8 | 182.3 / 333.4 | 7/7 |
| push 4 frames | 57.5 / 109.9 | 69.2 / 137.9 | 7/7 |
| **push + 32-packet window** | 58.5 / 110.7 | 65.8 / 132.5 | 7/7 |
| warmed (the ceiling) | 55.0 / 102.2 | 53.9 / 109.4 | 7/7 |

Against the push alone the combined variant is −4.9 to +1.7 %, on ranges
that overlap in all four cells. The push leaves no slow start for a wider first flight to skip.

**A warmed window survives a silence, on both controllers.** Eight frames, then 0, 10 or 30 s of
silence, then the ask, with the keep-alive pair of [`../adr/transport-idle-sessions.md`](../adr/transport-idle-sessions.md) in
every variant (without it the native session died at 30 s in 2 of 2 rounds; a browser pings every 15 s).
After 30 s, 50 / 250 KB at 80 ms: Cubic 99.4 / 111.1 ms against 103.3 / 108.0 with no silence, BBR
94.8 / 107.3 against 97.2 / 105.1. The worst cell is 250 KB at 40 ms, Cubic +9 % and BBR +17 %; every
variant ends on the window it had before the silence, and 56 of 56 rounds served the ask. quinn 0.11.18
has no window restart after idle, and `cubic-restart` does not count an idle spell as an outage (W5b).
A link that slowed during the silence does not change that verdict (§The window through a silence).

**The wide first flight fails at one queue depth, not gradually.** A 32-packet window is ~26
datagrams; by the relay's queue on a 10 Mbit link (`default → 32 packets`, 7/7 for the wider window
except where marked):

| queue | 50 KB, 40 ms | 50 KB, 80 ms | 250 KB, 40 ms | 250 KB, 80 ms |
| --- | ---: | ---: | ---: | ---: |
| 10 pkt (12 ms of buffer) | 149.5 → 113.0 | 268.9 → 205.2 | 354.5 → 346.0 | 557.3 → **623.3, 0/7** |
| 20 pkt | 150.5 → 102.8 | 270.0 → 182.9 | 334.2 → 275.0 | 600.1 → 456.4 |
| 40 pkt | 149.0 → 102.6 | 271.7 → 183.0 | 359.3 → 291.1 | 498.7 → 373.4 |
| 100 pkt | 149.5 → 102.7 | 269.9 → 182.9 | 325.3 → 272.1 | 499.5 → 373.5 |

From 20 packets up the win is flat — −31…−33 % at 50 KB, −16…−25 % at 250 KB. At 10 packets the 250
KB / 80 ms cell **loses by 11.8 %**: the burst is chopped at the queue, and the wider variant ends the
session on 44 kB against the default's 87 kB having lost *fewer* datagrams (3.0 against 10.4) — it
pays a round trip to lose half its window.

#### What the numbers support, by session shape

**A session that opens with a fill is warmed by the fill** and needs neither lever. **An ask-only
session is not**, and pays 4.4 round trips, 4.2× at 250 KB, once per session and again after every
new client address (not after a port-only rebind). For it the push and the wider window are
**alternatives, not a pair**. **After a path reset the window lever is re-applied and the push is
not**: on a new address the 32-packet window gives 167.0 / 321.1 ms against a fresh session's
167.6 / 323.4 with the same window, while the push rides the session URL and is spent at open (PUSH).
A per-client jump start from a saved window was proposed (2026-09-24) and not built: at 80 ms the push
recovers the same (130 against 134 ms of 462). **The push is the default since 2026-10-02**
(`--opening-ask`); the window stays the owner's call.

#### The idle radio: its penalty, a wake, a keep-alive, 2026-10-01 (IDL, I1)

`ece7e89`, `e534009`, `2fbcd2e`. The relay's `--idle-promote S:P` ([`../rig-limits.md`](../rig-limits.md)
§3) holds both directions for P ms on the first packet after S s of quiet: one radio's idle state. A
filled session, 80 ms, the keep-alive pair, 7 interleaved rounds, every relay `--self-timing` and
`VOID` runs dropped; a lead is the paired median over the unpromoted ask (103–110 ms).
`first_ask_cells.sh wake | late | keep`:

| cell | lead |
| --- | --- |
| S = 5, P = 80 or 300, 6 s quiet, one datagram sent L ahead of the ask (`--wake-lead-ms`), 250 and 50 KB | **max(0, P − L) within 4 ms**: at P = 300 and L = 0 / 50 / 100 / 200 ms, +300 / +246 / +199 / +98 |
| S = 5, P = 200 / 400 / 1 000 / 1 900, after 6 and 10 s, the next ask sent at once (`--next-ask`) | **P within 3 ms**, no packet lost; the next ask 100–104 ms, unpromoted |
| S = 5, P = 400, 10 s quiet: a server keep-alive, or one datagram ahead | keep-alive every 3 s −399 (4/4), 5 s −398 (4/4), 10 s +2 (0/4); a datagram 100 / 300 ms ahead −100 / −301 |

**The promotion costs P, once, and nothing else; a wake sent L ahead takes L off it, and a keep-alive
at ≤ S keeps it off the ask.** The hold delays the client's ask, so the inflated round-trip sample
lands on the client; the server, which sends the frame, takes none. Mutants: the probe without its
datagram reads +299 to +301 at every lead; a probe left quiet before its next ask pays P on it. **This
proves the plumbing, not a radio**: S, P, how much of a promotion a gesture's lead overlaps, and what a
wake or a keep-alive costs in energy are a device's. The page's `pointerdown` wake is not built;
nothing on the server reads datagrams, and a control-stream message would end a running fill
([`../WIRE.md`](../WIRE.md) §An ask during a fill).

### The window through a silence, when the link slowed meanwhile, 2026-10-01 (STW)

`fe9994e`. A step trace slows the link inside the silence: eight 250 KB frames fill at 40 Mbit, 8 s of
silence, the link at 8 Mbit, then one 250 KB ask; 60 ms, a 50-packet queue, the keep-alive pair,
`first_ask_cells.sh stw`, nine interleaved rounds, `--self-timing` (5 of 45 runs `VOID`):

| variant | ask ms | paired against Cubic | wins |
| --- | ---: | ---: | ---: |
| Cubic, 40 → 8 Mbit | **340.9** (338–345) | | |
| Cubic, 8 Mbit throughout | 382.8 (362–386) | +41.2 | 0/7 |
| Cubic, 40 Mbit throughout | 130.2 (129–134) | −209.7 | 7/7 |
| `cubic-restart` as first built, 40 → 8 | 831.8 (800–915) | +489.6 | 0/5 |
| `cubic-restart` fixed (W5b), 40 → 8, 15 rounds | | −1.4 | 4/7 |

**The kept window wins, and by more than it would lose**: the stale window's ask is faster than a
session warmed at 8 Mbit (7/7), and the derived loss storm (~145 of 200 packets) did not happen.
`cubic-restart` first misfired here — an idle spell's overflow looked like its outage test, so it
rebuilt at the initial window and the ask paid slow start (2.4×, a 17.7 kB window against 194) — and
is fixed (W5b, §After a blink). Slow start restarted after idle (RFC 5681 §4.1's restart window) bought
nothing, bimodal and never ahead of Cubic, and is retired. One step, one
depth, one size.

### The slow-start exit, an outage and the first timeout, 2026-09-19

**W2.** `lab/scripts/controller_cells.sh`, three rounds a cell, through
[`../../lab/scripts/link_impair.py`](../../lab/scripts/link_impair.py) at 80 ms round trip and
20 Mbit; the fill is 40 frames of 64 KB. `lost` and `cong` are per session.

**The early slow-start exit is a tie, and retired.** RFC 9406's detector over the public `Controller`
trait was within 5 % of Cubic in all six cells — a 20-
and a 1 500-packet buffer, no jitter, ±2 and ±10 ms — and behind a deep queue tied on time while
often halving the queue (W4b).

**Reordering, not jitter — corrected 2026-09-19 (N2).** These cells first read Cubic **8.6×**
slower at ±2 ms of jitter and **25×** at ±10 ms, where BBR took 1.05× and 2.9×. The relay's jitter
was independent per packet and reordered across up to seven of them. With `--jitter-mode ordered`
— the same wobble delivered in sequence, which is what one LTE, 5G or Wi-Fi leg does
([`../rig-limits.md`](../rig-limits.md) §3) — `lab/scripts/radio_link_cells.sh`, five rounds, deep
queue, against each controller's own no-jitter fill:

| variant | ±2 ms reordering | ±2 ms ordered | ±10 ms reordering | ±10 ms ordered |
| --- | ---: | ---: | ---: | ---: |
| Cubic | **8.22×** | **1.01×** | **23.68×** | **1.03×** |
| BBR | 1.02× | 0.99× | 2.65× | 1.17× |

**On a link that delivers in sequence there is no effect left to measure**, and most of BBR's 2.9×
was the reordering too. The reordering cells stand as what a multi-leg path would do; nothing in
them supports "Cubic cannot take a radio's jitter", and §1, which rests on loss, is untouched.

**The reordering threshold is not the mechanism — a prediction refuted.** `--packet-threshold`
exposed quinn's setter (default 3, unchanged; flag and variants removed 2026-10-03, code:
`git show archive/variants-2026-10-03:lab/scripts/radio_link_cells.sh`). Under reordering jitter, fill ms at thresholds 3 / 6
/ 12 / 48: ±2 ms 11 880 / 6 124 / 6 135 / 6 124; ±10 ms 34 217 / 30 214 / 31 094 / 31 428. At ±2 ms
raising it removes the spurious losses (21 per session become 0 or 1) and still leaves **4.2×**,
because *one* congestion event is worth that much: every round that declared one ended on an 84 ms
smoothed RTT and a 6.1 s fill, every round that declared none on ~140 ms and 1.44 s. At ±10 ms the
largest possible overtake is ~34 packet numbers, under a threshold of 48, yet ~140 packets a session
are still declared lost and the relay dropped nothing. **What declares them is unattributed**;
quinn's other detector is the 9/8 × RTT time threshold. A qlog cell owes the answer.

W3's "a megabyte of standing queue" behind a deep buffer was the rig client's stream credit, not the
buffer (W4b).

#### A fill ten times the buffer, 2026-10-02 (W4b)

`eaafef8`, `d95c305`. [`deep_queue_cells.sh`](../../lab/scripts/deep_queue_cells.sh): a 61 MB fill
(237 × 265 kB) at 80 ms through a buffer of 500 or 1 000 ms at the link's 22 Mbit mean, on four links
of that mean: `flat`; `step`, home Wi-Fi's 15/40/10/30/15 Mbit of 12 s each; `step40`, entered so the
fill crosses 40 → 10; `burst`, a 1 ms grant every 10 ms. 7 rounds, 13 on `step40` and `burst`, by
`order.py`, `--self-timing` (91 of 400 runs `VOID`, 41 % of `burst`'s). The standing queue is smoothed
less minimum RTT, sampled every 100 ms.

**The rig's client never let the buffer fill**: `first_ask` at quinn's default credit has ~1.25 MB in
flight on the shared stream, a 348 ms queue on `flat` at both buffers. **A browser grants more**:
headless Chromium's downloader fills either buffer to its limit (median 422 / 840 ms on `flat`), as
`first_ask --stream-recv-window 16000000` does (423 / 890), so every cell below is at that credit
([`../rig-limits.md`](../rig-limits.md) §6). Against wide-credit Cubic, paired by round:

| link, buffer | Cubic queue p50 ms | BBR fill | BBR queue |
| --- | ---: | ---: | ---: |
| flat, 500 ms | 423 | −158 ms, 5/6 | +75, 2/6 |
| flat, 1 000 ms | 890 | −159, 7/7 | **−292, 6/7** |
| step, 500 ms | 478 | −28, 4/6 | **−228, 6/6** |
| step, 1 000 ms | 672 | −23, 5/6 | **−282, 6/6** |
| step40, 500 ms | 222 | **−425, 11/11** | +51, 1/11 |
| step40, 1 000 ms | 454 | **−442, 11/11** | +75, 4/11 |
| burst, 500 ms | 433 | −190, 4/7 | +56, 0/7 |
| burst, 1 000 ms | 926 | −65, 2/4 | +34, 1/4 |

**The fill is the link's whichever controller** (17.1–24.1 s, every variant within 2.5 % of Cubic); what a
deep buffer costs is the wait of anything asked behind the fill, up to the whole buffer (2.1–2.2 s at
`step40`'s 10 Mbit step). **BBR overruns a 500 ms buffer**: 24 000–41 000 of ~51 000 packets declared
lost where Cubic loses ~1 600, an overflow the link's other users pay for, not the fill. The retired
slow-start exit tied on time in all eight cells, lost no packet behind 1 000 ms, and stood 239–454 ms
less queue than Cubic in four. With no exogenous loss no verdict of §1 moves.

#### An outage: the threshold is not the lever

Fill ms through a blackout, persistent-congestion threshold 3 (default) / 6 / 12 (flag and variant removed
2026-10-03; code: `git show archive/variants-2026-10-03:lab/scripts/controller_cells.sh`), against 1 437
with no outage: 500 ms 6 836 / 6 881 / 6 871; 1 s 7 503 / 7 508 / 7 626; 2 s 8 704 / 9 058 / 9 092.
**Raising the persistent-congestion threshold changes nothing**: one congestion event and 3 to 11
lost datagrams per session, so persistent congestion is never declared. The outage costs **+5.4 s**
of fill at 500 ms, +6.1 s at 1 s and +7.3 s at 2 s. **"The cost is the probe-timeout ladder" was
wrong — corrected 2026-09-19 (W3), below.** The cost is the window's regrowth from a window the
outage halved; the ladder is only the difference between the three rows.

#### The first timeout, at 1 % loss

200 cold connects a variant, 80 ms round trip, 1 % loss each way:

| `initial_rtt` | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| 333 ms (quinn's default) | 252.3 | 417.6 | **1 335.1** |
| 100 ms | 252.3 | **255.6** | **637.8** |
| 50 ms | 252.3 | 334.4 | 502.4 |

One cold open in a hundred waits 1.3 s where the median waits 0.25 — the 999 ms first probe timeout,
three times a 333 ms assumption. `--initial-rtt-ms 100` halves the p99 and leaves the median alone.
**50 ms is worse at p95**: the first probe fires before an 80 ms path could have answered.
Twenty-four connects showed none of this; the tail needs a couple of hundred. **Not changed**: the
right number is the target's round trip, which this rig cannot stand in for — 100 ms is right at
80 ms and wrong at 300.

### After a blink, 2026-09-19

**W3.** [`../../lab/scripts/blink_cells.sh`](../../lab/scripts/blink_cells.sh), five rounds a cell,
variants interleaved within every round, on W2's link: 80 ms, 20 Mbit, a 1 500-packet queue, a fill of
40 × 64 KB. `wins` counts rounds beaten against Cubic.

**The window says where the time goes.** Sampled every 50 ms from the server's path telemetry, a 1 s
blink fired as the fill is requested: the session holds the 12 000 B initial window through the
outage, takes one congestion event, drops to **8 400 B — 0.7 × 12 000 — and opens by one MTU every
second round trip**, a measured 0.51 packets per round trip for 3.4 s. It never re-enters slow
start, and the fill takes 7 659 ms where a clean one takes 1 440. The cost is regrowth from a window
that was tiny when the blink hit, so **the blink's position prices it, not its length**.

| the blink | Cubic | Cubic + restart | wins | BBR |
| --- | ---: | ---: | ---: | ---: |
| none | 1 440 | 1 437 | 2/5 | **1 222** |
| 500 ms, at the fill's start | 6 915 | **2 116** | 5/5 | **1 897** |
| 1 s, at the fill's start | 7 659 | **2 891** | 5/5 | **2 802** |
| 2 s, at the fill's start | 9 326 | **4 409** | 5/5 | **4 352** |
| 1 s, at frame 20 of 40 | 2 444 | 2 175 | 2/5 | 2 880 |
| 1 s, at frame 36 of 40 | 1 445 | 1 441 | 3/5 | 1 230 |

**A blink is expensive only in a fill's first round trips**: +5.5 to +7.9 s at the start, +1.0 s at
frame 20, nothing measurable at frame 36 (where the remaining bytes already sit in the relay's
queue, which a blackout does not drop).

**Restarting slow start after a silence is worth about five seconds.**
`server/src/transport/restart.rs` is `--congestion cubic-restart`: a wrapper over the public
`Controller` trait that, when a congestion event's lost packets all predate a silence of four round
trips, replaces the inner Cubic with a fresh one — quinn's only way back into slow start. It takes
**4.8 to 4.9 s off every start-of-fill row, 5/5**. It is the default since 2026-10-02 (W5b below). Its first form
compared only the two most recent acknowledgements and missed the 500 ms outage, because quinn
declares the loss an acknowledgement or two *after* the one that ended the silence; the silence is
now remembered until a congestion event spends it, and measured against the RTT estimate from
*before* it.

**BBR through the same blink** beats Cubic 5/5 at the fill's start and is **worse** mid-fill (0/5).
Across every blink cell the three variants send within 1 % of each other and lose the same.

**A blink across an ask costs ~2 s and the restart does not help.** One 250 KB ask on a warmed
session, the blink fired as it goes out: Cubic 2 099 ms, restart 2 312 (1/5), BBR **1 859** (5/5),
against 195 clean. A warmed window has no regrowth to save; what is left is the client's own request
retransmitted through the outage.

**The misfire check.** At 1 % loss with no blackout the restart first read 4 387 ms against Cubic's
10 774, 3/5, with a four-fold spread: the detector firing where a whole flight went missing. *Sized in
W5b, below: no misfire at 0.1–1 % loss; the spread was five rounds' noise.* A blink is a *slow-start*
problem: large at the start of a session or a fill, nothing to win anywhere else.

**A blackout that holds instead of dropping costs the outage and nothing else (N2).**
`link_impair.py` dropped both directions through a blackout, where a radio's link layer usually
buffers and delivers late. `--blackout-mode hold` freezes each direction's rate clock instead;
`radio_link_cells.sh outage`, five rounds interleaved, fill ms against a 1 445 ms undisturbed fill:
Cubic held **1 943 / 2 475 / 3 449** against dropped 6 984 / 7 727 / 8 920 at 0.5 / 1 / 2 s, BBR
held 1 822 / 2 371 / 3 392 against 1 970 / 2 720 / 4 362; holding wins 5/5 in all six cells. Held,
there is **no congestion event and no lost datagram**, and the fill is the undisturbed fill plus the
outage to within 30 ms. Every number above it — the regrowth, the threshold that does nothing, the
restart's win — belongs to the dropping model. **A predicted second-blink penalty is refuted**:
held, a second 1 s blink three seconds or 200 ms after the first costs its own length (+1 003 / +1
097 ms), with zero congestion events. **Which model a radio follows is unverified** — no primary
source for the link layer's discard timer was found — and it decides whether the outage work has a
target at all.

**W5b — the restart sized, 2026-10-02** (`60e0a63`, `f8fc7de`). `blink_cells.sh w5b`: the same link
and fill, Gilbert–Elliott loss at 0.1, 0.3 and 1 %, a 0.5 or 2 s blink at the fill's start held or
dropped, 15 rounds Williams-ordered, `--self-timing` (76 of 675 runs `VOID`); the next ask is one
64 KB frame right after the fill. Paired leads against Cubic, the restart with its idle fix:

| cell | Cubic fill ms | `cubic-restart` | wins | next ask |
| --- | ---: | ---: | ---: | ---: |
| no blink, 0.1 / 0.3 / 1 % | 1 438 / 1 438 / 2 162 | −0.5 / −1.2 / +4.7 | 6/12, 8/14, 5/11 | tie |
| 0.5 s held, 0.1 / 0.3 / 1 % | 1 925 / 1 929 / 2 122 | −0.8 / −4.7 / −21.1 | 7/11, 9/14, 7/13 | tie |
| 2 s held, 0.1 / 0.3 / 1 % | 3 494 / 3 497 / 3 632 | +4.8 / +0.3 / −18.5 | 5/11, 7/15, 7/12 | tie |
| **0.5 s dropped**, 0.1 / 0.3 / 1 % | 6 839 / 7 422 / 8 244 | **−4 694 / −5 289 / −6 164** | 9/9, 13/13, 6/6 | −57 to −61 |
| **2 s dropped**, 0.1 / 0.3 / 1 % | 8 871 / 10 264 / 10 990 | **−4 551 / −6 166 / −6 608** | 12/12, 11/11, 9/11 | −12 to −72 |

**The restart keeps its whole win under loss and costs nothing without a blink**: 4.6–6.6 s off every
dropped blink, the next ask back to the clean 109 ms where Cubic's is 121–184, and within 21 ms of
Cubic with no blink or a held one. The fix — the gap measured from the first send after nothing was in
flight (two tests, two mutants caught) — took STW's misfire from +491.5 to −1.4 ms without touching
the win. **`cubic-restart` became the default controller 2026-10-02**; the idle restart, never
resolvably ahead (+96 to +120 ms behind a dropped 0.5 s blink at 0.3–1 %), is retired. Whether a radio
drops or holds through an outage still decides whether the restart has a target at all.

### The fill's order, 2026-09-19

**O1.** A fill asked coarse to fine — every 8th frame, then every 4th, then every 2nd, then the rest
— against sequential, each frame asked once at the same depth. `lab/scripts/fill_order_cells.sh`,
200 frames of 64 KB, depth 4, variants interleaved with the order reversed every round. Every 8th frame
is in hand at **1 043 ms against 5 688** at 80 ms / 20 Mbit (n = 3; fill 5 826 against 6 032), and
at 27 against 183 ms on loopback with every frame a miss (n = 12; fill 189 against 190).

**Time-to-scrubbable moves 5.5× and the fill moves by nothing.** Under `--force-pool-reads` the
permuted order costs the read path 0.3 %, warm 1.9 % — a stride of eight moves the read head half a
megabyte, nothing to an NVMe, something to a spinning disk or a cold object store. **No server
change**: ask order is already the client's priority, and what the order should be depends on what
the viewer does with a partly-filled series.

---

## 4 · CPU per byte: segments per `sendmsg`, a profile-guided build, one copy fewer

**Why.** A 250 KB frame cost about 340 µs of CPU under load — ~2 µs per 1 452-byte datagram, over
AES-GCM, quinn's packet assembly, four copies of every byte (page cache → buffer → quinn → packet →
kernel) and the kernel's per-segment work. quinn sends at most 10 datagrams per `sendmsg`. None of
this is a lever a lossy link cares about; every item is **sessions per core**, the target's
constraint at thousands of viewers.

**Four candidates, one interleaved A/B** (server on two cores, driver on the other two, one client
socket per session, six repeats paired): the MTU-derived GSO cap −16 to −21 % CPU per
ask, 6/6, in every cell above 100 B; PGO −9 to −26 %; the pooled hand-off 0 to −10 %; **mimalloc
ties or loses everywhere but the 100-byte cell and is not taken.** The three kept are independent
mechanisms.

**What each is.**

- **The GSO cap** — `patches/quinn-0.11.11-mtu-gso.patch`, applied at build time to the crates.io
  tarball (`scripts/patch_crate.sh quinn`, `patched/quinn`): segments per `sendmsg` are
  `min(platform, 65527 / mtu)` — **45 at 1 452 bytes, 44 at 1 472** (an earlier write-up said 44 at
  1 452) — and the driver may emit 64 datagrams per poll instead of 20. quinn 0.11.11 and upstream
  `main` hard-code 10 with no `TransportConfig` knob (quinn-rs/quinn#2189, the shape that would
  remove the patch). Never raise the cap from `max_gso_segments()` alone: over 65 527 bytes returns
  `EINVAL` and `quinn-udp` disables offload for that socket permanently. **Opt-in**:
  `cargo build --release -p series-server --config 'patch.crates-io.quinn.path="patched/quinn"'`;
  the gate runs `scripts/patch_crate.sh quinn --check`. Refresh: bump the version in
  `scripts/patch_crate.sh` and `patched/quinn/Cargo.toml`, retarget the hunks, `--check`.
- **PGO** — `scripts/pgo_build.sh` instruments, trains on the cells this section measures, and
  rebuilds. A profile is bound to its source, so the script runs per release build and
  `cargo build --release` stays the plain build; a stale profile is worse than none. It doubles the
  release build.
- **The pooled hand-off** — `media/frame_pool.rs`: both readers hand the frame off as `Bytes` over
  their own buffer and take the next from a pool; `FrameOut` gives quinn head and body with
  `write_all_chunks`, and the buffer returns when quinn drops it after acknowledgement. One copy of
  four gone. The pool is shared, not thread-local, because a work-stealing runtime does not promise
  a buffer returns to the thread that read it; a thread-local variant measured a tie on every column
  (0.1–0.8 %, 2–3/6), so the shared shape buys the invariant, not speed.

**First measured 2026-09-18, after one false alarm.** The first check on the stock multi-thread
runtime read −38 % throughput: the revert of §6 had left `#[tokio::main(flavor = "current_thread")]`,
so every variant was single-threaded — CPU per ask down, context switches down, throughput down reads
like lock contention and is equally what one worker looks like. Restored, six repeats paired, all
6/6: sixteen sessions at depth 4 +13.5 % asks/s at 250 KB and +23.2 % at 32 KB, a 250 KB fill
+73.9 %, one session at depth 1 p50 −32.5 % and −6.9 %. Over 24 cells of depth × sessions
(`lab/scripts/depth_session_matrix.sh`) CPU per ask fell in all 24, 6/6 each, by −5.9 to −45.3 %;
**one cell was materially worse, 250 KB at depth 1 with four sessions: p99 2.2 → 27.8 ms**, a probe
timeout (`srtt + 4·rttvar` plus the peer's 25 ms `max_ack_delay`), and the GSO cap is the whole of it
— the frame's size against the client's 212 KB receive queue, not the session count (§5, GS1).

**Re-checked on this tree, 2026-09-23.** Four release binaries of the same source — `base` (before
the merge), `pool` (the hand-off, the default build), `gso` (`pool` + the patch), `pgo` (`gso`
through the script) — in one `lab/scripts/runtime_ab.sh` run, server on cores 0–1 and driver on 2–3
of a 4-core laptop shared with other jobs, loopback, six repeats reversed every repeat,
paired against `base`:

| cell | `pool` | `gso` | `pgo` | CPU per ask, `pool` · `gso` · `pgo` |
| ---- | -----: | ----: | ----: | ---: |
| 250 KB, 16 sessions, depth 4 — asks/s | +7.4 % (6/6) | **+25.8 % (6/6)** | +27.8 % (6/6) | −7.7 · −16.9 · −19.6 % (6/6) |
| 32 KB, 16 sessions, depth 4 — asks/s | +2.3 % (4/6) | **+26.8 % (6/6)** | +41.8 % (6/6) | −6.0 · −23.3 · −32.0 % (6/6) |
| 250 KB, 4 sessions, depth 1 — **p99** | −3.1 % (4/6) | **+1 390 %, 1.9 → 27.5 ms (0/6)** | +1 380 % (0/6) | −3.2 · −7.3 · −19.6 % |
| 250 KB, 1 session, depth 1 — p50 | −4.6 % (5/6) | −15.5 % (5/6) | −19.1 % (5/6) | −5.8 · −35.7 · −42.5 % |
| 32 KB, 1 session, depth 1 — p50 | −2.3 % (5/6) | −4.3 % (6/6) | −8.1 % (6/6) | −3.0 · −28.8 · −37.4 % |
| 250 KB fill, 80 frames — asks/s | +7.9 % (6/6) | +27.5 % (6/6) | +34.2 % (5/6) | −6.5 · −25.8 · −33.0 % (6/6) |

The pooled hand-off holds in every cell with nothing against it, so it is the send path. The GSO cap
holds its win **and its regression reproduces**, to within 1 % of 2026-09-18, so it is an opt-in.
PGO re-run **without** the cap (`base` · `pool` · `pgo`, same rig, n = 6): CPU per ask against
`base`, the hand-off included, −13.4 to −19.6 % in every cell and the four-session depth-1 p99
**−11.8 % (5/6)** — no cell against. The host saturates at the two server cores in the depth-4 and
fill cells; nothing is claimed past them.

**A browser does not see it.** Headless Chromium, `lab/scripts/browser_cell.py`, variants interleaved,
wall per frame, n = 6: 32 KB on demand −0.8 % (2/6, a tie), 250 KB +3.2 % (1/6, ranges overlapping).
At 250 KB Chromium's receive path is ~1.7 ms per frame and is the ceiling
([`../rig-limits.md`](../rig-limits.md) §1): its network-service IO thread runs at 82–85 % of a core
through a fill whichever server sends. 44 datagrams per `sendmsg` did not worsen that browser's
socket overflow (866 → 852 per run, 3/6), so burst size is not what sheds them. With the
downloader's wire ring (three decoders, ring of 8, 87 × 512² 16-bit frames, eight rounds) `base`
against `pool`: fill-and-decode 394.2 → 394.9 ms, renderer peak 256.4 → 255.5 MB, 87/87 bit-exact —
no interaction. **The case for this section is cost per session, measured and large; it is not a
latency win for a browser on this rig**, and should not be read as one.

**Costs.** A 64 KB batch holds the connection lock ~30 µs longer than a 14 KB one, which widens a
fill's inter-arrival p99. quinn holds the reader's buffer until acknowledged: memory per session is
unchanged in total, since quinn held a copy before, and the pool keeps at most 64 buffers in all
(*corrected 2026-10-06*: not per thread; what large frames leave resident is in
[`disk-access.md`](../adr/disk-access.md) §11, *Frames past 250 kB*).

**What would overturn it:** a CPU-bound cell on the production target where the combined binary does
not beat the plain one on CPU per ask; a quinn upgrade that moves the batching itself. Re-run with
`lab/scripts/runtime_ab.sh` (`SERVER_CPUS` / `CLIENT_CPUS` pin the two sides) and
`lab/scripts/runtime_ab_pair.py`, one binary per variant; between variant builds `git checkout Cargo.lock`,
because a `--config` patch the lock cannot take is only a warning and the next build may resolve
quinn to a newer crates.io release.

**LTO is in the release profile** (2026-09-10): server CPU per frame −3.7 to −8.4 %, 4/4 in every
cell, binary −26 %, release rebuild 10 → 39 s. A later campaign on this tree read +7 % p50 (6/6) at
32 KB, depth 1, one session, against −3 to −6 % CPU at saturation; if large frames ship at depth 1,
that is the cell to weigh.

### Many fills at once: fills per core, 2026-10-07 (LOAD)

**How many concurrent fills one server core carries before it, not the links, is the clock**
(`lab/server-load`, queue row 81). The server on one core of a 4-vCPU container, N native sessions
(`fill_load`) on the other three, each on its own socket, all asking the whole 10-bit tomosynthesis
volume at once — 24 × 678×1727, 13.6 MB as HTJ2K, 13.0 MB as the optimized AV1 payload. Each session
reads as fast as it can, or at 20 or 50 Mbit by pacing its reads, so flow control holds the server
back on loopback: no loss, no queue. A fresh server per cell, warmed by one fill; 10 rounds of 54 cells
in Williams order and 10 more of 10 cells around the knee: 640 runs, **1 012 320/1 012 320 frames
byte-identical** to the payloads ingest decoded back to the source's checksum (a flipped reference byte
failed every run). Container-measured.

Per-session fill time over the single-session figure (HTJ2K / AV1), the server's cores and its
resident set over the warmed server:

| sessions | 20 Mbit: fill | cores | 50 Mbit: fill | cores | RSS over warm |
| --: | --: | --: | --: | --: | --: |
| 1 | 5.46 / 5.19 s | 0.01 | 2.18 / 2.08 s | 0.02 | 1 MB |
| 32 | ×1.00 | 0.19 | ×1.00 | 0.45 | 131–141 MB |
| 64 | ×1.00 | 0.39–0.41 | **×1.00** (worst session ×1.01–1.02) | 0.98–0.99 | 239–305 MB |
| 80 | | | **×1.25** | 0.99 | 365–379 MB |
| 96 | | | ×1.55–1.57 | 0.99 | 440–459 MB |
| 128 | ×1.00 | 0.84–0.89 | ×2.12–2.19 | 0.99 | 575–614 MB |
| 160 | **×1.03** | 0.95–0.96 | | | 715–754 MB |
| 192 | ×1.30 † | 0.70 | | | 838–876 MB |
| 256 | ×1.72–1.75 † | 0.65–0.71 | ×4.30–4.39 † | 0.68–0.70 | 1.06–1.11 GB |

* **One core delivers about 400 MB/s of fills, and a fill departs from its single-session time where
  the sessions' rates sum past it**: between 64 and 80 sessions at 50 Mbit (400 → 500 MB/s asked), at
  about 160 at 20 Mbit. Past the knee every fill stretches alike, to N × series ÷ ~380–400 MB/s;
  unpaced, the server is the clock from two sessions on (one: 0.98 cores, 33 / 31 ms).
* **2.0–3.1 ms of server CPU a MB**, the same for both codecs — the server sends bytes, and AV1's 5 %
  fewer is its whole difference. A 20 Mbit fill costs **0.7 % of a core** (0.84–0.89 cores over 128).
* **3.7–4.8 MB resident a concurrently filling session** — what quinn holds in flight under its 10 MB
  send window; 256 at once is 1.1 GB.
* **Where the host saturates**: the server's core, in every cell past the knee; the host is 58–60 %
  busy there, the clients 1.3 of their 3 cores. † The rig's own client sockets drop datagrams even with
  4 MB receive buffers — a few hundred a run from 64 sessions, 26–38 k at 128, 125–132 k at 256: at 192 and 256 the server falls to 0.65–0.71 cores, so those cells are the rig's
  clock as much as the server's, and nothing is claimed past 160. Nothing is claimed for more than one
  core: the multi-thread runtime across cores is §6's scale cell, still unmeasured.

On the target this is ~160 phones filling at once per core at 20 Mbit; viewers that are not filling
cost a session, not a core (§9 item 9).

---

## 5 · Depth and the depth-1 tail: where latency and throughput part

Measured 2026-09-12 on the 4 vCPU VM, client on the box and unpinned, six repeats paired and variant
order reversed unless a row says otherwise; loss is read from the client socket's
`Udp: RcvbufErrors` (`runtime_ab.sh` carries the column), never assumed.

**Depth.** One session, `server_ab`, medians of three sweeps. At 32 KB, depth 1 / 2 / 4 / 8 / 16:
p50 148 / 204 / 241 / 436 / 757 µs, asks/s 6 241 / 8 618 / 13 710 / 15 007 / 18 252, CPU per ask
96 / 69 / 56 / 49 / 49 µs. At 250 KB, depth 1 / 2 / 4 / 8: p50 495 / 790 / 1 443 / 3 085 µs, asks/s
1 855 / 2 306 / 2 614 / 2 380, CPU 373 / 338 / 345 / 369 µs.

Throughput is depth over latency, and the table is where the division stops paying: at 32 KB, 1 → 4
is 2.2× the asks for 1.6× the p50 and −42 % CPU per ask; past 4 the p50 grows and the throughput
barely. At 250 KB one session saturates its thread at depth 2. The depth that takes the link's
throughput at the least queueing is
[`../adr/client-window-depth.md`](../adr/client-window-depth.md)'s `D_min`. Disk look-ahead is
already the server's and independent of how the client asks (`TILE_SLOTS`, `FILL_AHEAD`,
`ASKS_AHEAD`); network depth belongs to the client. **Depth 1 is `D_min`'s answer when `Tf ≫ RTT`**
— a large frame on a slow link — and that is the case the tail below has to survive, because "just
ask two" is then the wrong latency trade.

**A lost tail at depth 1 costs a probe timeout.** 250 KB, depth 1, four and sixteen sessions: p99
28–31 ms against a p50 of 1–3 ms, with 22–81 datagrams dropped on the client socket per run (212 KB
default buffer). A lost last datagram with nothing behind it waits quinn's PTO — `srtt + 4·rttvar`
plus the peer's `max_ack_delay`, 25 ms by default and in Chromium; a loss mid-frame is found by the
packets behind it within an RTT. With the client's receive buffer at 1 MiB the drops and the tail go
to zero (p99 30.7 → 8.5 ms at sixteen sessions, 28.1 → 2.5 at four). The buffer is the rig's; the
mechanism is the product's on any lossy link at depth 1. **Priced for the target**: on a 50 ms path
a tail loss is ~95 ms to detect against ~55 ms for a mid-frame loss; only a frame's last few packets
can be a tail, so at 1 % loss it averages under a millisecond per 250 KB frame. Real, and small —
large on loopback only because the RTT there is 0.1 ms.

**The 44-segment batch makes a drop a tail loss.** The patch at 44 against the same source clamped
to 10, 250 KB:

| cell | drops / run, 44 → 10 | p99 | asks / s | CPU / ask |
| ---- | -------------------: | --: | -------: | --------: |
| depth 1, 4 sessions | 24 → 56 | 28.1 → 2.9 ms (**−90 %**, 6/6) | +24 % (6/6) | +10 % (5/6) |
| depth 1, 16 sessions | 86 → 196 | 30.7 → 9.0 ms (**−71 %**, 6/6) | +4 % (5/6) | +10 % (6/6) |
| depth 4, 16 sessions | 226 → 670 | +9 % (5/6) | **−5 % (6/6)** | **+11 % (6/6)** |
| depth 1, 1 session | 0 → 4 | +6 % — tie | −7 % — tie | +20 % (6/6) |

Ten segments drop more often and lose ten packets each time; forty-four drop less often and lose the
frame's tail in one event. **Derived from source, not measured:** quinn's pacer caps a burst at
`window × 2 ms / RTT`, clamped to 10–256 packets, so on a 20 Mbit / 50 ms path (window ~125 KB) the
burst is the 10-packet floor and the 44 never forms; on a LAN at 1 ms it does. §4's CPU win is a
loopback and LAN figure.

### Why a drop takes the tail, and what keeps the win — GS1, 2026-09-24

The mechanism is the client's receive queue; the segment cap only chooses which frame sizes meet it.
Five builds in one `runtime_ab.sh` run: `base` (crates.io quinn, 10 per `sendmsg`), `gso` (the
patch, 45), the patch with its ceiling at 24, 16 and 10 (`cap10` isolates the patch's other change,
64 datagrams per poll). Cloud container, 4 vCPU, server on cores 0–1, `server_ab` on 2–3, loopback,
ten repeats reversed every repeat, the client socket at the kernel's default 212 992 bytes; server
lost and datagrams per `sendmsg` from its `session path` line. 250 KB, depth 1, four sessions:

| variant | datagrams / `sendmsg` | client drops / run | server lost / run | p99 | CPU / ask |
| --- | --: | --: | --: | --: | --: |
| `base` | 9.4 | 53.5 | 535 | 2.4 ms | — |
| `gso` | 34.8 | 8.5 | 340 | **27.7 ms (0/10 lower)** | −9 % (7/10) |
| `cap24` | 19.7 | 32.5 | 769 | 2.8 ms, −3 % (6/10) | **−16 % (9/10)** |
| `cap16` | 13.9 | 41.5 | 659 | 2.3 ms, −2 % (5/10) | −11 % (7/10) |
| `cap10` | 9.3 | 57.0 | 569 | 2.6 ms, +4 % (4/10) | −3 % (7/10) |

*Server lost ≈ drops × datagrams per send.* The client is quinn, which turns on `UDP_GRO`, so the
kernel queues each GSO send as one buffer and a full queue drops all of it — 10 packets in `base`,
about 40 in `gso`. A tail loss follows when the dropped send is the frame's last. The capture shows
it (`tcpdump -s 64` on `lo`, sends after more than 15 ms of silence on their connection): `gso` has
14, at a median 26.3 ms — the PTO — each after a ~60 KB batch; `base`, `cap16` and `cap24` have none
despite 20–60 drops a run. On loopback the pacer's burst limit is 256 packets and no variant reached it.

**Every cap has the cliff; the size of a send sets how wide it is.** Twenty frame sizes from 100 KB
to 1 MB, 4–10 repeats; below 200 KB nothing drops. The p99 is a PTO (≥ 15 ms) at **12 of 20 sizes
for `gso`** (210–240, 250, 275, 300, 350, 400, 700 KB), at 225 KB only for `cap16`, at 240 KB for
`base` — quinn's own 10 has the cliff too — and at **none for `cap24`** (worst 3.9 ms, at 240 KB).

At 1 MB every variant drops, mid-frame. With the receive buffer at 1 MiB every drop and every tail went,
and `gso` kept −11 to −19 % CPU per ask. **So the regression that keeps the patch opt-in is the rig
client's, not the product's**: Chromium sets `SO_RCVBUF` 1 MiB on its QUIC socket and no `UDP_GRO`
(strace of Chromium 141 here); the kernel caps that at `net.core.rmem_max` and doubles it, so a drop
there costs one datagram, not a batch. The browser at depth 1 was not measured.

**What keeps the win.** Where the two server cores saturate, asks/s and CPU per ask against `base`,
`gso` then `cap24`: 250 KB at sixteen sessions, depth 4, +13 / −13 % and +10 / −9 % (10/10 each);
32 KB there +12 / −13 % (7/8) and +9 / −14 % (8/8); a 250 KB fill +30 / −29 % and +24 / −21 %.
At 250 KB, depth 1, 16 sessions `cap24`'s p99 is −25 % (9/10) where `gso`'s is +200 % (0/10). None
of this proves 24 has no cliff — a size not swept can hold one. **Clamping to 10 everywhere is not
the answer**: it has the cliff too, and spends the CPU on a LAN to buy a tail that exists only when
nothing follows the frame. What removes the cliff at every cap is a receive buffer larger than a
frame, which the product's client already has; what removes the tail itself is a packet after the
frame — the next ask at depth ≥ 2, or an ACK-eliciting probe after an isolated frame (not built).

**A payload above 1 472 bytes is closed for browsers.** Chromium advertises 1 472 and quinn takes
the smaller bound: through the relay with the server's bound at 4 000 and 8 972, no datagram above
1 472 in 85 k (2026-09-10). It was worth −35 % CPU with a quinn peer on a jumbo-frame LAN, the only
taker left ([`../adr/disk-access.md`](../adr/disk-access.md) §8). quinn's own discovery stops at
1 452; the 20 bytes between are open (§9). `quinn-proto` 0.11.18 also fixed a black-hole detection
that pinned the MTU at 1 200 for 60 s after one ACK revealing four holes, which this project had
seen twice.

### The controller's tax on a steady ask, against an ideal TCP, 2026-10-01 (TAX)

`d6068e9`. Depth-1 asks of 131 072 B on a fresh session, 30 a run, through the relay at 60 ms with a
50-packet queue (`lab/stream-shape/run.mjs --tax`, headless Chromium, the raw TS client, a Williams
order, `--self-timing`, 8–14 rounds a variant after `VOID` runs). The `ws` variant, the WebSocket through the
relay's TCP plane with no loss and no window, is an **ideal-TCP floor**, not a TCP reference
([`../rig-limits.md`](../rig-limits.md) §3). Tax is the median of asks 2–30 over RTT + size / rate:

| variant | 15 Mbit (floor 129.9 ms) | tax | 25 Mbit (floor 101.9) | tax |
| --- | ---: | ---: | ---: | ---: |
| `ws`, ideal TCP | 131.6 | +1.7 | 103.6 | +1.6 |
| Cubic | 132.3 | +2.4 | 115.6 | +13.7 |
| Cubic, `--initial-window-bytes 38400` | 132.3 | +2.4 | 117.1 | +15.2 |
| bounded BBR, retired | 235.7 | +105.8 | 197.0 | +95.1 |

**Cubic's tax is under 2 % where an ask is longer than a round trip's worth of link, and 13 % where it
is not** (at 25 Mbit 131 KB is 0.7 of the BDP; paired against `ws` 7/7) — consistent with quinn pacing
an app-limited window at 1.25 × window / RTT, inferred, not measured. The initial window is spent on
the first ask (284 → 197 ms at 15 Mbit) and changes nothing after it. A floor variant dialled past the
relay (the mutant) reads −128 ms, below arithmetic.

### The ask's loss sensitivity, QUIC against kernel TCP, 2026-10-02 (ASKL)

`6c681d1`. On the workstation one ask's median grew 130 → 609 ms from 0 to 4 % loss; whether that is
QUIC's or any reliable transport's was not measurable there. Through the packet-layer relay
([`../rig-limits.md`](../rig-limits.md) §3, TUN) kernel TCP meets the same loss: depth-1 asks of
256 000 B on a fresh session, 30 a run, the raw TS client in headless Chromium over QUIC
(`series-server`) or the WebSocket fallback; 80 ms, a 24 / 12 Mbit step trace down and 20 Mbit up, a
100-packet queue, Gilbert–Elliott loss both ways in bursts of 3.5. `ws:<cc>` sets the server sockets'
controller (`lab/stream-shape/tcp_cc.c`). Williams order, 9 rounds, `--self-timing` (33 of 180 runs
`VOID`); `lab/scripts/askl_cells.sh`, summarised by `lab/stream-shape/askl.py`; p50 · p99 over asks
2–30:
| loss | QUIC Cubic p50 · p99 | TCP Cubic | QUIC BBR | TCP BBR |
| --- | ---: | ---: | ---: | ---: |
| 0 | 176 · 415 | 255 · 1 188 | 337 · 514 | 210 · 477 |
| 0.5 % | 370 · 1 506 | 434 · 1 182 | 329 · 746 | 249 · 4 642 |
| 1 % | 752 · 1 585 | 571 · 1 595 | 331 · 553 | 260 · 802 |
| 2 % | 1 052 · 2 810 | 907 · 6 357 | 325 · 2 668 | 260 · 694 |
| 4 % | 1 549 · 11 031 | 1 675 · 11 596 | 338 · 3 645 | 298 · 4 674 |
| **per 1 %, p50 · p99** | **+339 · +2 606** | **+354 · +2 841** | **+1 · +865** | **+18 · +627** |

**The slope is the controller's, not QUIC's**: with the same controller QUIC and kernel TCP grow
alike, Cubic +339 against +354 ms a percent at the median, BBR +1 against +18. For QUIC Cubic at 1 %
(path telemetry every 50 ms) the first loss ends slow start at ~42 KB and the window then sits at
20–56 KB for the run where the path holds 120–240 KB, so a 256 KB ask takes ~8 round trips; kernel BBR
holds 186–312 packets through the same losses. `--congestion bbr` flattens it and costs the lossless
ask +160 ms paired; it wins from 1 %. At 4 % asks fail on the client's 15 s timeout (44 over 8 TCP
Cubic runs, 23 over 2 QUIC Cubic runs), partly the relay's model: Gilbert–Elliott steps once a
packet, so a silence does not leave the bad state. During a 40-frame fill at 1 % the fallback's
head-of-line cost ties QUIC's shared stream (frame gap p99 1 522 against 1 368 ms, 9 rounds).
*Retracted the same day:* a first campaign read QUIC 20× steeper than TCP; its `ws` variant took the
container's default controller, BBR, so it compared controllers, not transports.

---

## 6 · One endpoint per core — parked

**Not in `server/`.** The work is whole at `d9ebe32`, an unmerged branch's tip. It was
`--workers N`: N OS threads, each a `current_thread` runtime owning its own endpoint on an `SO_REUSEPORT` socket,
so the kernel hashes a client's 4-tuple to one thread for the life of the session.

**Why it was built.** On one endpoint on the multi-thread runtime a frame crosses five tasks and
tokio hands each wake to whichever worker is idle; at depth 1 a 250 KB frame took **28 context
switches**, and the server spent more CPU on it (790 µs) than the round trip took (630 µs).

**What it measured.** Against the stock tree, six repeats paired (4 vCPU VM, then an 8-core
workstation): one session **−23 to −40 % p50 on demand and −39 to −64 % CPU per ask, 6/6 in every
cell**; 16–32 sessions at depth 4, +8 to +17 % asks/s on six of eight cells, two ties, and the 32 KB
tail on four shared cores +23 % (6/6). A browser saw a tie with media in the round trip and −25 %
(6/6) with none: the server's slice of a browser's depth-1 round trip is about a quarter at 32 KB.

**Why it is parked.**

* **A 4-tuple change kills the session.** The wrong endpoint drops the packets in silence, so the
  client freezes and dies of `connection timed out` at quinn's 30 s idle timeout: **12 of 16 rebinds
  at `--workers 4`, the `(W−1)/W` the hash predicts, against 0 of 6 at `--workers 1`** (T6,
  2026-09-18). This file said "answers with a stateless reset: the session drops and the client
  reconnects" until then; both halves were wrong. A browser page has no connection migration to lose
  ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Session survival), so the product's cost is a NAT
  rebind, not a handover — on a mobile target that is a correctness cliff, not a tuning trade.
* **Placement is a lottery, and count balance is the wrong statistic.** At four sessions on the
  workstation per-core read −14 % (4/6 worse), its floor inside the band one worker gives. A
  deliberate collision (`server_ab --one-socket`, sixteen sessions on one 4-tuple) cost per-core
  **−32 % asks/s and 2.4× the p50** where the multi-thread runtime lost 5 %. At a thousand sessions
  the counts even out; the load does not — a few fills among many idle viewers — and a UDP front
  forwarding from one source port makes the collision permanent.
* The scale case was never measured: 16–32 sessions on 2–4 cores with the clients on the box.

`--workers` above the core count is a small-N hedge for the lottery (four sessions share a thread
58 % of the time on four endpoints, 5 % on sixty-four), not a scale plan. Yielding the serving loop
after every frame (`yield_now`) was measured on this shape and rejected: +7 % p50 and −9 % asks/s at
32 KB depth 1 (6/6). §4's per-byte work does not depend on any of this.

**It returns if** a steering answer exists (reuseport steering on the connection ID; not here) and a
scale cell passes: 64–256 sessions with the client off the box, a few fills looped beside the
on-demand sessions, against one endpoint on the multi-thread runtime — keep per-core unless the
multi-thread variant wins throughput by more than 10 % or p99 by more than 30 % on the heavy-tail cell.
`lab/scripts/runtime_ab.sh` is the instrument.

---

## 7 · Larger levers, above this layer

On a real-looking link a third to a half of steps wait on the network, and these outweigh everything
above: **bytes per displayed frame** — a truncated HTJ2K prefix, resolution rungs and the stride law
([`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md),
[`../adr/stride-is-bandwidth-conservation.md`](../adr/stride-is-bandwidth-conservation.md)); on the
target the wire binds first, so fewer bytes is the only lever above ~2×, and abandoning a frame's
tail with `RESET_STREAM_AT` is not carried by quinn or wtransport yet. **Ask window depth** —
[`../adr/client-window-depth.md`](../adr/client-window-depth.md): in a browser a fixed window of 4
against serial asks is −26.6 % per frame at 250 KB and −59.4 % at 32 KB (6/6), the largest latency
lever measured, and the client's — measured on the harness's page path; the window went with that path
on 2026-10-03, and behind the downloader, which asks every frame at once, it is unmeasured. **Cache size** — a 64-frame cap on a 500-frame series costs +65 %
offered load for +2.8 pp of misses.

---

## 8 · Confidence

**Strong**: the controller's dependence on the loss regime (the 600 ms congestive cell is n = 2 for
BBR); BBR's 12–19× under random loss in a browser, and its queue cost; the shared stream, on real
hardware and in a browser; the first ask as slow start and its levers, within cell on one relay and
one address; CPU per ask from the GSO cap, PGO and the hand-off, 6/6 in every saturation cell on
three boxes; the depth-1 tail as the rig client's receive queue, on loopback. **Moderate**: the
windows never approached (loopback, N ≤ 16); per-core endpoints at saturation; the phone profiles
(picked, not fitted). **Weak or unmeasured**: which regime the deployment mix is in; which outage
model a radio follows; anything on the target, on a phone, or in a browser at depth 1.

What would overturn the shipped defaults: a cell where per-frame separates in its favour (none
found), or client telemetry showing the loss mix is overwhelmingly radio (which would reopen the
Cubic default, not the stream default).

---

## 9 · What is open

Ranked for the target. *By report* marks a claim from specifications and public reports read
2026-09-14, unverified here.

1. **Draft compatibility — gating, unverified.** wtransport 0.7.2 speaks the legacy draft-02 and the
   draft-07 SETTINGS with the `webtransport` token; by report every current browser accepts that, so
   the risk is the day a stable browser drops draft-07. Owed: one session and one frame per stable
   browser, capturing the SETTINGS and transport parameters it sends (which also answers
   `min_ack_delay` and `max_udp_payload_size`). Advertise neither draft-14 nor any WebTransport
   flow-control SETTING, so only quinn's two windows bound a session; by report a WebKit browser
   offered draft-14 without `WT_MAX_DATA` capsules hangs, and its certificate-hash pinning fails in
   some releases. A failure is a release blocker.
2. **The loss mix** (§1): client telemetry, the round-trip trend in the second before each loss; until
   then, one calibration of `link_impair.py` against `netem`. On phone-like profiles BBR ties or beats
   Cubic (PROF); behind fq_codel it costs a neighbour nothing but keeps 27–196 ms of its own queue
   (FQC); an ask's loss slope is the controller's on either transport (§5 ASKL). In the product's client under 1–5 % loss it fills in 0.04–0.74 of Cubic's time and is 1.01–1.04 of it on a clean 5 Mbit link (LOSSCC). The candidate is v3's
   loss bound over quinn's BBR, built opt-in as `bbr-bound` and decided by [`bb3-protocol.md`](bb3-protocol.md) (BB3).
3. **The first ask's defaults**: the push at session open is on by default since 2026-10-02; the
   initial window stays the owner's call (§3). A port-only rebind keeps quinn's window,
   and a new address resets it, which re-applies the window lever but not the push (§3, PUSH). Not
   tested: whether a real mobile NAT keeps the address.
4. **Hold or drop**: which a radio does through an outage, from a device trace — it decides whether the
   restart (§3 W5b) has a target. What declares ~140 losses a session under ±10 ms reordering (a qlog
   cell: quinn's `qlog_stream` reads pacing, flow-control blocking and recovery instead of inferring
   them). Delivery-trace replay in the relay. **The idle radio**: by report carriers drop a radio to
   idle after 5–10.5 s without traffic, and promotion costs 190–396 ms on 4G and 341–1 907 ms on 5G;
   neither a browser's 15 s ping nor the 20 s keep-alive ([`../adr/transport-idle-sessions.md`](../adr/transport-idle-sessions.md))
   comes often enough to prevent it. On the relay it costs P once, a wake sent L ahead takes L off it,
   and a keep-alive at ≤ S keeps it off the ask (§3, IDL and I1); S, P, the gesture's lead and the
   energy are a device's.
5. **`--initial-rtt-ms`**, at the target's real round trip (§3).
6. **The GSO cap: 24, or 45 behind the product's buffer** — the owner's call (§5). Owed: 44 against
   10 on CPU per ask at 20 Mbit / 50 ms and 100 Mbit / 30 ms, with a 1 Gbit / 1 ms control that must
   separate; within 5 % means inert on the target, kept only for a LAN deployment. **The packet
   size**: where a browser advertises `max_udp_payload_size` ≥ 1 472, raise
   `MtuDiscoveryConfig::upper_bound` to 1 472 for IPv4 peers — 1.4 % fewer packets, never above what
   the peer advertises.
7. **The depth-1 tail.** Headless Chromium 141 does not advertise `min_ack_delay`
   ([`../CLIENTS.md`](../CLIENTS.md) §ACK frequency, by browser); one run on 148 closes that, with
   the server's request restored from `archive/variants-2026-10-03`. An
   ACK-eliciting packet after an isolated frame would turn a lost tail into a gap, if quinn's packet
   builder can place it *after* the tail. Not before items 1–3.
8. **Two upstream quinn items, drafted, not posted**:
   [`upstream-quinn-ack.md`](upstream-quinn-ack.md) (the patch is carried, off; whether it removes
   the session-open probe in a browser is unmeasured) and the probe-every-space companion in
   [`upstream-wtransport-settings.md`](upstream-wtransport-settings.md).
9. **A thousand stalled sessions.** `window-harness --mode stall` at 1 000 sessions on the rig, RSS
   and fds per session from `/proc`: under 300 kB and 3 fds, and the deployment manifest
   ([`../adr/disk-access.md`](../adr/disk-access.md) §6) is enough; otherwise an accept cap. There
   is no admission control at accept today.
10. **Reachability.** By report 3–5 % of networks impair UDP. A WebSocket carrying the same wire
    exists behind `--websocket` ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The TCP fallback); the
    field failure rate that decides whether it is enabled is unmeasured.
11. **Stream shape under BBR**: HOL1 ran Cubic only
    ([`../adr/stream-shape.md`](../adr/stream-shape.md)).
12. **WebKit**: every browser number here is Chromium ([`../CLIENTS.md`](../CLIENTS.md) §On WebKit).

**Closed — reopen only on new evidence.** A payload above 1 472 bytes for browsers (§5). 0-RTT and
TLS resumption: a browser never resumed a WebTransport session in 216 dials, and the draft forbids
CONNECT in 0-RTT. Connection pooling, and the browser's `congestionControl` hint, which shapes only
its send side, which carries only asks. A 10-segment clamp everywhere (§5). Per-frame without
priority, `send_fairness`, a fixed stream pool (§2). `yield_now`, `--workers` above the cores, per-core
endpoints until §6's conditions (§6). The persistent-congestion and reordering thresholds as levers
(§3). The bounded BBR, the slow-start exit and the idle restart, retired (§1, §3). `aws-lc-rs`,
mimalloc (§3, §4). Window equalisation
([`../adr/transport-quic-stream-receive-window-defaults.md`](../adr/transport-quic-stream-receive-window-defaults.md)).
