# Transport — what was measured, what was chosen, what is open

What the transport measured and chose, why each change exists, and what is still open. One entry
per decision, not per commit; the code carries a one-line pointer here and this file carries the
reason.

**The tree as it builds.** `--stream-mode` defaults to `shared`, the controller to Cubic, and every
flow-control window to quinn's default. A frame goes to quinn as the reader's own buffer
(`media/frame_pool.rs`), the only send path. The release profile is `lto = "fat"`, one codegen unit.
Two crate patches are on by default through `[patch.crates-io]` — wtransport's SETTINGS in the
handshake flight and quinn-proto's probe of every space — and why they exist is
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Lever 2. Two levers are **build-time opt-ins**: the
MTU-derived GSO cap (`patches/quinn-0.11.11-mtu-gso.patch`, §4) and a profile-guided build
(`scripts/pgo_build.sh`, §4). Every other lever below is a flag at quinn's default. `--prefault` is
accepted and does nothing.

**The target**, set with the owner 2026-09-14: a browser on a mobile, lossy wireless link, thousands
of sessions per server. In numbers: at 20 Mbit a 250 KB frame is 100 ms on the wire, so bytes and
round trips outweigh anything the server does per frame; 20 Mbit is ~2.5 MB/s, about 0.4 % of a
core, so no session is heavy and at thousands of sessions the cost is CPU per byte; and the round
trip is 30–80 ms, so a 28 ms tail that dominates loopback is half a round trip there.

**How to read the numbers.** Arms are interleaved inside every round unless a row says otherwise;
figures are medians; "5/7" is rounds won, paired round against round. The userspace relay
`lab/scripts/link_impair.py` is the impaired link in a container; what it cannot model is
[`../rig-limits.md`](../rig-limits.md) §3. Rejected arms (`copy` / `split` send paths,
`--ask-priority`, MTU and socket knobs) were deleted from `server/`, not hidden behind a feature;
the campaigns that rejected them, with method, reviews and TSVs, are on tag
`archive/transport-lab-2026-09`:

```bash
git show archive/transport-lab-2026-09:docs/transport/transport-conclusions.md   # read, do not restore
git checkout archive/transport-lab-2026-09 -- lab/transport                      # the campaign drivers
```

---

## The answer

| decision | verdict |
| -------- | ------- |
| **Congestion controller** | **Cubic, by default, until the loss mix is measured.** Congestive loss → Cubic; radio loss → BBR; both directions large (§1). In a browser under 1–3 % random loss BBR fills 12–19× faster and pays with ~45 % of its datagrams overflowing a 120 ms queue, or 294 ms of standing queue in a 900 ms one (CC1). BBR with its window held to 1.25× its own path estimate keeps that fill with no overflow and 13–16 ms of queue — a candidate for the rig, not a default (BB2) |
| **Stream shape** | **One shared stream.** Per-frame + FIFO lost 5.76× at 250 KB on a real path; with ask-order priority it is level, and a fixed pool is closed (§2, [`../adr-stream-shape.md`](../adr-stream-shape.md)) |
| **Initial congestion window** | **quinn's default — but the "≤ 7 %" that used to be the reason is corrected (2026-09-19).** That cell averaged many asks on one session and never measured the first ask, the only place the window matters. On the first ask of an idle session 32 packets is **−28 to −33 %**, and flat at −16…−33 % behind any queue of 20 packets or more; it loses in one cell (+11.8 %, 250 KB / 80 ms / 10-packet queue) and buys nothing on top of the push at session open, which is the larger lever (§3) |
| **Send path** | **The reader's buffer handed to quinn** as `Bytes`, one copy of four gone: −3 to −8 % CPU per ask in every cell, nothing against (§4). It also bounds what a stalled client costs (§3) |
| **GSO segment cap 10 → `65527 / mtu`** | **Opt-in at build time.** −16 to −21 % CPU per ask, 6/6, and +10 to +30 % throughput where the pipe is full — and at 250 KB, depth 1, four sessions it takes p99 from ~2 ms to ~28 ms, reproduced twice. GS1 found that tail to be the rig client's receive queue, which a browser does not share, and a ceiling of 24 that keeps two thirds of the win with no tail seen. Ship 24, or 45 behind the product's buffer: **the owner's call** (§4, §5) |
| **Profile-guided build** | **Opt-in, per release build.** −8.6 to −10.6 % CPU per ask on top of the plain build of the same source, no cell against (§4) |
| **Flow-control windows** | **quinn's defaults.** A client that asks for 25 MB and stops reading costs the server **180 kB** on this send path (§3) |
| **Runtime shape** | **One endpoint on the multi-thread runtime.** One endpoint per core won every single-session cell and most saturation cells, and **12 of 16 NAT rebinds kill the session** on it. Parked on `claude/per-core-endpoints` (§6) |

`--stream-mode per-frame` and `pool:k`, `--congestion cubic-hystart | cubic-restart | bbr |
bbr-bounded`, `--initial-window-bytes`, `--initial-rtt-ms`, `--packet-threshold`,
`--persistent-congestion-threshold`, `--ack-frequency-max-delay-ms` and `--open-ask` are flags at
quinn's behaviour, each for the cell named where it is measured below.

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

**Default Cubic** until that mix is measured: it is the incumbent; it is the safer error
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
innocent (70–77 % from a flow that can take 90 % alone).

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
queue (120 ms) unless stated, one server per run, arms rotated inside every round, **7 rounds**. A
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

*Re-taken 2026-09-24 on an idle box.* The first run of every cell shared the four cores with four
runaway server processes from another lane; the tables are the re-take. The first run agreed in
every verdict and within a few points in every figure.

**The browser confirms L3 and widens it**: under random loss BBR fills **12× (1 %) to 19× (3 %)
faster** and answers a fresh ask **1.3 to 6.2× sooner**, 6/7 or 7/7 in every lossy cell; a fresh ask
is ~1.8× faster on a clean link too. **Its price is the queue, both ways.** Against a 120 ms buffer
it sends about twice the fill's bytes and the bottleneck drops the other half; against a 900 ms
buffer it stops overflowing and **stands 294 ms of queue** in front of everything else the phone
does. On a link whose only trouble is one blink it is 7.8 % slower than Cubic (0/7). The restart
(§3, after a blink) ties Cubic in every lossy cell and loses the blink cell, which lands late in a
3.6 s fill.

**Why BBR overdrives the queue — one reading refuted.** quinn's pacer sends `1.25 × window / RTT`
and never reads the pacing rate BBR computes, which goes only to its metrics
(`connection/pacing.rs`, `congestion/bbr/mod.rs`, 0.11.18). With BBR's window at twice the path's
BDP that paces at ~2.5× the bottleneck — a plausible cause. **It is not the cause here:** a
prototype that paces a rate-reporting controller at its own rate overflowed as much (57.6 % against
47.8 %, 3 rounds, 1 %; taken under the same load as the first run, and not re-taken). The excess is
BBR's own estimate or window; the source reading below has the other candidate, loss ignored during
Startup.

**Neither, as they stand.** Cubic is an order of magnitude wrong for random loss. quinn's BBRv1 buys
that back by doubling the bytes on a shallow link or standing a quarter-second of queue on a deep
one, and starves a neighbour 150× (above). What would change the default is a controller that
treats random loss as noise *and* bounds its queue — BBRv2/v3's loss- and inflight-bounded probing,
which quinn does not carry. Nothing was changed.

**Where the host saturates.** The relay's 20 Mbit is far below loopback's reach and every fill here
is link-bound (BBR's 3.8 s is 18 Mbit of goodput); latency and completion are quoted, not
throughput. **What this rig does not decide:** the relay's loss is exogenous by construction, so a
real radio's mix is not modelled; nor is a phone's receive path.

### A bounded BBR, 2026-09-25 (BB2)

Can BBR keep its loss tolerance without its queue? **quinn exposes neither knob that would say** —
`BbrConfig` sets only an initial window, and Cubic's β is a constant — so the variant is built as
`restart.rs` is, over the public `Controller` trait:
[`bounded.rs`](../../server/src/transport/bounded.rs), `--congestion bbr-bounded --bdp-gain g`,
quinn's BBR with its window held to `g` × (the best delivery rate of the last ten round trips × the
minimum round trip). A larger Cubic β needs a Cubic of our own or a quinn patch, and is not built.

**The rule, fixed before the run.** CC1's rig and cells (1 % and 3 % behind 200 packets, 1 % behind
1 500, a 500 ms blink), arms `cubic`, `bbr` and the bound at 1.0, 1.25 and 1.5, 7 rounds rotated. A
variant *keeps BBR's loss tolerance* if its median fill is within 2× BBR's at 1 % and 3 %; it does
so *at Cubic's queue cost* if under 5 % of its datagrams overflow the 200-packet queue and it stands
under 50 ms in the 1 500-packet one.

**The bound at 1.25 keeps all of BBR's goodput under loss, and none of its queue.** Medians,
7 rounds, every run complete; rounds won against Cubic in brackets:

| cell | Cubic | BBR | bound ×1.0 | bound ×1.25 | bound ×1.5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| fill, 1 % | 43.0 s | 3.88 s (7/7) | 5.65 s (7/7) | **3.86 s** (7/7) | 3.91 s (7/7) |
| fill, 3 % | 74.7 s | 3.87 s (7/7) | 5.58 s (7/7) | **3.92 s** (7/7) | 3.84 s (7/7) |
| fill, 1 %, 1 500 packets | 41.8 s | 3.89 s (7/7) | 5.48 s (7/7) | **3.89 s** (7/7) | 3.88 s (7/7) |
| fill, a 500 ms blink | **4.54 s** | 4.94 s (0/7) | 6.17 s (0/7) | 4.91 s (0/7) | 5.00 s (1/7) |
| ask, 1 % / 3 % | 788 / 1 676 ms | 419 / 413 | 423 / 456 | 456 / 488 | 419 / 475 |
| datagrams overflowing 200 packets, 1 % / 3 % | 0 / 0 % | **43.4 / 44.5 %** | 0 / 0 % | **0 / 0 %** | 0 / 0 % |
| standing queue, 200 / 1 500 packets | 4 / 4 ms | 50 / **309 ms** | 4 / 4 ms | **13 / 16 ms** | 27 / 31 ms |

* All three bounds pass both halves of the rule. ×1.0 is the only one whose queue equals Cubic's,
  and it pays 45 % of the fill for the last 10 ms. **×1.25 keeps most of BBR's goodput at Cubic's
  queue cost**: 17.7 of 20 Mbit under 3 % loss where Cubic carries 0.9, no datagram overflowed, and
  its retransmitted share is the link's own loss (1.0 / 3.0 %) where BBR's is 45–48 %.
* **The blink is where none of them helps**: every BBR, bounded or not, is 8–10 % slower than Cubic
  after a 500 ms outage with no loss; ×1.0 is 36 % slower. Asks still come 1.3–2× sooner.
* **Not covered.** A competing flow: the relay gives each plane its own queue, and the neighbour
  table above is BBRv1's, not the bound's. Congestive loss, where Cubic led, was not re-run. One
  host through a userspace relay. **Nothing changed**: the bound is a candidate for the rig, against
  a competing flow and congestive loss, before any default moves.

### quinn's BBR read against the published BBRv1, 2026-09-15

A public report called quinn's BBR broken without naming a cause, so
`quinn-proto-0.11.17/src/congestion/bbr` (651 lines) was read against the published BBRv1 before any
cell. **Faithful**: the four modes and their transitions; the constants (high gain 2.885, pacing
cycle `[1.25, 0.75, 1×6]`, startup growth target 1.25, three rounds without growth to leave Startup,
cwnd gain 2.0); the gain-cycle seed; the recovery window's arithmetic and its floor at `in_flight +
bytes_acked`. No `TODO`, `FIXME` or "simplified" marker.

**One candidate deviation, which may explain §1's two-sided result**: `window()` applies the
recovery window only when `mode != Startup`, unconditionally. If loss never limits the window during
Startup, that is a win on exogenous loss, where ignoring loss is right, and a loss on congestive
loss, where it is not. **That this departs from the algorithm as published is a lead, not a
finding** — it rests on recollection, not a reading — and is the first thing to check before rig
time. Two more source leads: the pacer ignores BBR's pacing rate (refuted as the overflow's cause,
CC1), and `exiting_quiescence` is never set, so BBR enters ProbeRtt on the first ACK after ≥ 10 s
idle.

---

## 2 · One shared stream

**The binary defaults to `shared`; `per-frame` and `pool:k` are product flags.** The decision, the
three campaigns behind it and every retraction are
[`../adr-stream-shape.md`](../adr-stream-shape.md). In short:

* **Per-frame + FIFO lost to retransmit deferral.** quinn's `retransmit()` re-queues a lost stream
  with `push_pending`, behind every already-queued stream; on one stream recovery goes out ahead of
  newer data. 3.5× (64 KB) and 8.5× (250 KB) in simulation, **5.76× at 250 KB on a real path, 3/3**,
  and the absolute penalty matched across rigs to 1.6 %. The deciding cell was fixed before it ran,
  with the rule "if it separates, flip the default" — a contested default is settled by the
  measurement named in advance, not by adjudication.
* **Ask-order priority repaired that and did not beat `shared`.** `per-frame` now ranks its streams
  by ask order. Natively (2026-09-15) no per-frame interval excludes zero at any loss level; in
  Chromium through the relay (HOL1, 2026-09-25, Cubic, 128 KB) it moves nothing past 6 %.
* **A fixed pool is closed.** `pool:2` costs ~75 % on the p95 with no loss; in the browser `pool:2`
  asks are +23 % at 1 % and 3 %, and `pool:4` / `pool:8` fills +268 to +583 %.
* **The arms are byte-identical at depth 1**, so the question has teeth only where the client keeps
  more than one ask outstanding.
* `send_fairness(true)` was worse than FIFO in every cell and is gone from the product crate.
* Bursty loss degrades `shared` by 38 % where scattered loss of the same 0.5 % mean degrades it by
  9 %, and no stream arm changes that: the loss's shape points at the controller (§1), not at the
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

The pooled hand-off's CPU numbers are §4. A per-frame prefault hop costs 10 % throughput and 14–34 %
CPU per byte with a warm cache; the flag is inert on this build. `aws-lc-rs` for `ring`, re-measured
2026-09-10 on VAES / AVX-512 hardware: +3–5 % CPU at 32 KB (4/4), a tie at 250 KB, +10–18 % peak RSS
— `crypto-ring` stays, the feature remains for other hardware. ACK frequency, socket buffers and the
initial MTU: ≤ 3 % or nil.

### Flow-control windows — the 180 kB property

"Bound the windows for memory at thousands of viewers" was carried on arithmetic: quinn's
`send_window` defaults to 10 MB, and 10 MB × 5 000 is 50 GB. **Measured, it is not a risk on this
send path.** `window-harness --mode stall` asks 400 frames (25 MB) then stops reading: the server
holds **180 kB**, 11 % more than a client that merely reads slowly and 50× below the ceiling. The
withheld bytes queue on the *client* (2.20 MB), because a stalled peer's stack still ACKs and the
server frees what is acknowledged. On the old `copy` + per-frame path the same client cost
**6.8 MB** — the arithmetic worry was right for the send path the project used to ship, and the
chunked path is what removed it. `RssAnon` and total RSS agree within 1.2 % in every arm, so this is
not a file-backed blind spot. Windows stay at quinn's defaults.

With the pooled hand-off quinn holds the reader's own buffer until the peer acknowledges it, so a
peer that never reads pins it. `lab/scripts/stall_memory_cell.sh`, peak `RssAnon` over the hold
minus the settled baseline (a different instrument from the 180 kB, not comparable to it): at
250 KB, before the pool 3 584 KiB and with it 3 364; at 32 KB, 2 364 against 2 152. **The pool
does not add to what a stalled client costs.**

**What would overturn it:** a client that widens its own receive window on a high-BDP path, where
the in-flight window rather than the peer's credit bounds the server. Unmeasured; on this rig such a
client is killed by its own quinn first.

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
| **rebound** — a fill, then the relay changes its source port | ~~49.4 / 93.9~~ 135.6 / 255.6 | 3.3 | ~~52.0 / 101.1~~ 236.7 / 454.7 | 5.8 |

**The first ask is slow start.** A 250 KB frame costs **5.8 round trips on a fresh session against
1.3 on a warmed one** — 4.4 of them the window opening; 12 KB doubling to 250 KB is exactly six
flights. At 50 KB it is 3.1 against 1.3. A warmed session is **4.2× faster** at 250 KB and 2.5× at
50 KB, at both round trips. quinn keeps a grown window through silence (below), so a warmed session
stays warm.

**"After a lossy fill the ask is slower than on a fresh session" did not reproduce**: the lossy arm
lands *between* fresh and filled (−6 % against fresh at 250 KB, −23 % at 50 KB), because the
blackout collapses the window without taking it below where it started.

**The rebound row is corrected 2026-09-20 (LD): a source-port change does reset the controller.**
This table first read it as indistinguishable from filled; re-run on the same script it reads as
**fresh** — 236.7 / 454.7 ms at 250 KB against the fresh arm's 250.8 / 465.5 and the filled arm's
52.9 / 109.3, five rounds, and again at n = 3 with the relay's own `REBOUND <old> -> <new>` lines
in view, so the poke is known to have landed. That is RFC 9000 §9.4: a new path resets the
congestion controller and the RTT estimator. What produced the earlier reading is not known. **It is
the target's case**: a mobile NAT rebind puts a warmed session back at the initial window, so every
lever below is worth its cost again after each rebind. A genuinely different client address is
untested; this container has one loopback address.

#### Lever 1 — the bytes the viewer needs anyway, pushed at session open

`--open-ask`: the session URL carries `?ask=fill:0-k`, so the study's first frames are moving when
the control stream opens. Both clients can send it (`openAsk`), off by default; the design and its
browser measurement are [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Lever 1. Pushing 1, 2, 4 and 8
frames before one more is asked takes that ask at 250 KB / 80 ms from 454.7 ms to 204.0, 157.2,
127.6 and **103.9 — the filled arm's 104.3**; at 50 KB, 248.2 to 165.9, 124.8, 108.5 and 98.1. **It
reaches the warmed session's speed**, most of the way at 1 MB.

#### Lever 2 — a 32-packet initial window

`--initial-window-bytes 38400` against quinn's 12 000. On the unshaped link it is free: fresh
50 KB 85.8 / 165.5 ms (**−33 %**), 250 KB 167.7 / 319.5 (**−28 to −30 %**), zero loss and zero
congestion events, and no effect once the session is warm. **But an uncongested link cannot punish a
burst.** On 10 Mbit with a 20-packet queue — shallower than the window itself — both levers still
win the asked frame (default 324.2 / 578.2 ms at 40 / 80 ms, 32 packets 266.6 / 432.5, a 1 MB push
248.7 / 305.7) and both pay in loss: at 80 ms datagrams lost go from 2.1 % of the session to 6.5 %
with the wider window and 11.7 % with the push, most of it the push's own bytes.

#### Which default for which session shape, 2026-09-20 (LD)

**W1b.** The cells W1 lacks, on the same probe and relay: the two levers together, a warmed session
left idle, and the wide first flight against the queue depth. Seven rounds a cell, arms interleaved
inside every round with the order reversed every other round, wins counted round against round;
`lab/scripts/first_ask_cells.sh together|idle|queue`. The box carried other lanes, so every figure
reads 3–8 % slower than W1's and only within-cell comparisons are claimed.

**The two levers do not stack.** Ask to last byte, 40 / 80 ms:

| arm | 50 KB | 250 KB | wins vs fresh |
| --- | ---: | ---: | ---: |
| fresh | 133.8 / 255.9 | 244.0 / 463.3 | |
| 32-packet window | 89.7 / 171.8 | 182.3 / 333.4 | 7/7 |
| push 4 frames | 57.5 / 109.9 | 69.2 / 137.9 | 7/7 |
| **push + 32-packet window** | 58.5 / 110.7 | 65.8 / 132.5 | 7/7 |
| warmed (the ceiling) | 55.0 / 102.2 | 53.9 / 109.4 | 7/7 |

Against the push alone the combined arm is +1.7 % and +0.7 % at 50 KB and −4.9 % and −3.9 % at
250 KB, on ranges that overlap in all four cells. The push already leaves the ask within 5–28 % of a
warmed session; there is no slow start left for a wider first flight to skip.

**A warmed window survives a silence, on both controllers.** Eight frames, then 0, 10 or 30 s of
silence, then the ask, with the keep-alive pair of [`adr-idle-sessions.md`](adr-idle-sessions.md) —
20 s keep-alive, 60 s idle timeout — in every arm. Without it (library defaults, a 30 s idle timeout
at both ends) the native session is **dead in 2 of 2 rounds on both controllers at 30 s**; a real
Chromium pings itself every 15 s and would not die, so the pair makes the native probe model the
browser. Ask to last byte after 30 s of silence against no silence, 50 KB / 250 KB at 80 ms: Cubic
99.4 / 111.1 against 103.3 / 108.0, BBR 94.8 / 107.3 against 97.2 / 105.1; the 10 s arms and the 40
ms cells read alike.

**No arm goes back to slow start**, which at 250 KB would be a 4.2× ask. The worst cell is 250 KB at
40 ms — Cubic +9 %, BBR +17 % and 0/7 against its own no-idle arm. Every arm ends on the window it
had before the silence, and **56 of 56 rounds with 30 s of silence served the ask**. The mechanism
agrees: quinn 0.11.18 has no congestion-window restart after idle in any controller, and the pacer
only clamps the first flight after a silence to its burst capacity.

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
KB / 80 ms cell **loses by 11.8 %**: the burst is chopped at the queue, and the wider arm ends the
session on 44 kB against the default's 87 kB having lost *fewer* datagrams (3.0 against 10.4) — it
pays a round trip to lose half its window.

#### What the numbers support, by session shape

**A session that opens with a fill is warmed by the fill** and needs neither lever. **An ask-only
session is not**, and pays 4.4 round trips, 4.2× at 250 KB, once per session and again after every
NAT rebind. For it the push and the wider window are **alternatives, not a pair**: the window if the
page cannot be changed, the push if it can; the keep-alive pair buys nothing on a first ask and
keeps a warmed window through silence. Not measured: a path reset restarts the controller at the
*initial* window, so the window lever is re-applied after every rebind where the push is spent at
open. A per-client jump start from a saved window was proposed (2026-09-24) and not built: at 80 ms
the push recovers the same (130 against 134 ms of 462). **No product default is changed**; which
lever becomes one is the owner's call.

### The slow-start exit, an outage and the first timeout, 2026-09-19

**W2.** `lab/scripts/controller_cells.sh`, three rounds a cell, through
[`../../lab/scripts/link_impair.py`](../../lab/scripts/link_impair.py) at 80 ms round trip and
20 Mbit; the fill is 40 frames of 64 KB. `lost` and `cong` are per session.

**The early slow-start exit is a tie, in every cell.** `server/src/transport/hystart.rs` is
RFC 9406's detector over the public `Controller` trait — no fork, no patch: it watches the
per-round minimum RTT and, when it rises, caps the window where slow start left it and opens one
datagram per round trip after that. Across a 20- and a 1 500-packet buffer with no jitter, ±2 ms and
±10 ms, it is within 5 % of Cubic in all six cells, both directions (1 437 against 1 437 ms deep and
unjittered; BBR 1 231) — **it does not pay for itself and it is not the default.** It stays as
`--congestion cubic-hystart` for the deep-queue cell (below) owed on a rig that shapes with `netem`.

**Reordering, not jitter — corrected 2026-09-19 (N2).** These cells first read Cubic **8.6×**
slower at ±2 ms of jitter and **25×** at ±10 ms, where BBR took 1.05× and 2.9×. The relay's jitter
was independent per packet and reordered across up to seven of them. With `--jitter-mode ordered`
— the same wobble delivered in sequence, which is what one LTE, 5G or Wi-Fi leg does
([`../rig-limits.md`](../rig-limits.md) §3) — `lab/scripts/radio_link_cells.sh`, five rounds, deep
queue, against each controller's own no-jitter fill:

| arm | ±2 ms reordering | ±2 ms ordered | ±10 ms reordering | ±10 ms ordered |
| --- | ---: | ---: | ---: | ---: |
| Cubic | **8.22×** | **1.01×** | **23.68×** | **1.03×** |
| BBR | 1.02× | 0.99× | 2.65× | 1.17× |

**On a link that delivers in sequence there is no effect left to measure**, and most of BBR's 2.9×
was the reordering too. The reordering cells stand as what a multi-leg path would do; nothing in
them supports "Cubic cannot take a radio's jitter", and §1, which rests on loss, is untouched.

**The reordering threshold is not the mechanism — a prediction refuted.** `--packet-threshold`
exposes quinn's setter (default 3, unchanged). Under reordering jitter, fill ms at thresholds 3 / 6
/ 12 / 48: ±2 ms 11 880 / 6 124 / 6 135 / 6 124; ±10 ms 34 217 / 30 214 / 31 094 / 31 428. At ±2 ms
raising it removes the spurious losses (21 per session become 0 or 1) and still leaves **4.2×**,
because *one* congestion event is worth that much: every round that declared one ended on an 84 ms
smoothed RTT and a 6.1 s fill, every round that declared none on ~140 ms and 1.44 s. At ±10 ms the
largest possible overtake is ~34 packet numbers, under a threshold of 48, yet ~140 packets a session
are still declared lost and the relay dropped nothing. **What declares them is unattributed**;
quinn's other detector is the 9/8 × RTT time threshold. A qlog cell owes the answer.

**The deep buffer does fill — corrected 2026-09-19 (W3).** "39 ms of standing queue" was read off
the end-of-session path line, after the queue had drained. Sampled every 50 ms through the fill, one
clean trace has the smoothed RTT at **468 ms against the link's 80**: 388 ms of standing queue, a
megabyte, in a 1 500-packet buffer, and the session still ends with zero loss. One trace, not an
interleaved cell. Whether the slow-start exit still ties once that queue is the steady state is
unrun.

#### An outage: the threshold is not the lever

Fill ms through a blackout, persistent-congestion threshold 3 (default) / 6 / 12, against 1 437 with
no outage: 500 ms 6 836 / 6 881 / 6 871; 1 s 7 503 / 7 508 / 7 626; 2 s 8 704 / 9 058 / 9 092.
**Raising the persistent-congestion threshold changes nothing**: one congestion event and 3 to 11
lost datagrams per session, so persistent congestion is never declared. The outage costs **+5.4 s**
of fill at 500 ms, +6.1 s at 1 s and +7.3 s at 2 s. **"The cost is the probe-timeout ladder" was
wrong — corrected 2026-09-19 (W3), below.** The cost is the window's regrowth from a window the
outage halved; the ladder is only the difference between the three rows.

#### The first timeout, at 1 % loss

200 cold connects an arm, 80 ms round trip, 1 % loss each way:

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
arms interleaved within every round, on W2's link: 80 ms, 20 Mbit, a 1 500-packet queue, a fill of
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
**4.8 to 4.9 s off every start-of-fill row, 5/5**. It is **not** the default. Its first form
compared only the two most recent acknowledgements and missed the 500 ms outage, because quinn
declares the loss an acknowledgement or two *after* the one that ended the silence; the silence is
now remembered until a congestion event spends it, and measured against the RTT estimate from
*before* it.

**BBR through the same blink** beats Cubic 5/5 at the fill's start and is **worse** mid-fill (0/5).
Across every blink cell the three arms send within 1 % of each other and lose the same.

**A blink across an ask costs ~2 s and the restart does not help.** One 250 KB ask on a warmed
session, the blink fired as it goes out: Cubic 2 099 ms, restart 2 312 (1/5), BBR **1 859** (5/5),
against 195 clean. A warmed window has no regrowth to save; what is left is the client's own request
retransmitted through the outage.

**The misfire check is not clean.** With no blackout: clean 1 440 / 1 437 (2/5); at 1 % loss Cubic
10 774 ms (3 564–13 814) against the restart's 4 387 (2 230–12 608), 3/5, on the same datagrams sent
and lost — the detector fires where there is no outage, because at that loss rate a whole flight
goes missing often enough to look like one; at 3 % the two tie within 1 %. Favourable, four-fold
spread, unsized. **Before it is a default it needs 0.1–1 % loss with rounds enough to separate.** A
blink is a *slow-start* problem: fixed at the start of a session or a fill the lever is large,
anywhere else there is nothing to win.

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

### The fill's order, 2026-09-19

**O1.** A fill asked coarse to fine — every 8th frame, then every 4th, then every 2nd, then the rest
— against sequential, each frame asked once at the same depth. `lab/scripts/fill_order_cells.sh`,
200 frames of 64 KB, depth 4, arms interleaved with the order reversed every round. Every 8th frame
is in hand at **1 043 ms against 5 688** at 80 ms / 20 Mbit (n = 3; fill 5 826 against 6 032), and
at 27 against 183 ms on loopback with every frame a miss (n = 12; fill 189 against 190).

**Time-to-scrubbable moves 5.5× and the fill moves by nothing.** Under `--force-pool-reads` the
permuted order costs the read path 0.3 %, warm 1.9 % — a stride of eight moves the read head half a
megabyte, nothing to an NVMe, something to a spinning disk or a cold object store. **No server
change**: ask order is already the client's priority, and what the order should be depends on what
the viewer does with a partly-filled study.

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
  tarball (`scripts/patch_quinn.sh`, `patched/quinn`): segments per `sendmsg` are
  `min(platform, 65527 / mtu)` — **45 at 1 452 bytes, 44 at 1 472** (an earlier write-up said 44 at
  1 452) — and the driver may emit 64 datagrams per poll instead of 20. quinn 0.11.11 and upstream
  `main` hard-code 10 with no `TransportConfig` knob (quinn-rs/quinn#2189, the shape that would
  remove the patch). Never raise the cap from `max_gso_segments()` alone: over 65 527 bytes returns
  `EINVAL` and `quinn-udp` disables offload for that socket permanently. **Opt-in**:
  `cargo build --release -p exact-server --config 'patch.crates-io.quinn.path="patched/quinn"'`;
  the gate runs `scripts/patch_quinn.sh --check`. Refresh: bump the version in
  `scripts/patch_quinn.sh` and `patched/quinn/Cargo.toml`, retarget the hunks, `--check`.
- **PGO** — `scripts/pgo_build.sh` instruments, trains on the cells this section measures, and
  rebuilds. A profile is bound to its source, so the script runs per release build and
  `cargo build --release` stays the plain build; a stale profile is worse than none. It doubles the
  release build.
- **The pooled hand-off** — `media/frame_pool.rs`: both readers hand the frame off as `Bytes` over
  their own buffer and take the next from a pool; `FrameOut` gives quinn head and body with
  `write_all_chunks`, and the buffer returns when quinn drops it after acknowledgement. One copy of
  four gone. The pool is shared, not thread-local, because a work-stealing runtime does not promise
  a buffer returns to the thread that read it; a thread-local arm measured a tie on every column
  (0.1–0.8 %, 2–3/6), so the shared shape buys the invariant, not speed.

**Without per-core endpoints, it still pays — after one false alarm (2026-09-18).** The first check
on the stock multi-thread runtime read −38 % throughput. It was a measurement bug: the revert of §6
had left `#[tokio::main(flavor = "current_thread")]`, so every arm was single-threaded. Recorded
because the wrong answer was convincing — CPU per ask down, context switches down, throughput down
reads like lock contention and is equally what one worker looks like. With `#[tokio::main]`
restored, against the tree before this work, release builds without PGO, six repeats paired, all
6/6: sixteen sessions at depth 4 **+13.5 % asks/s at 250 KB and +23.2 % at 32 KB** (CPU per ask
−16.8 and −22.0 %); a 250 KB fill +73.9 % asks/s (CPU −44.0 %); one session at depth 1, the latency
cell, **p50 −32.5 % at 250 KB and −6.9 % at 32 KB** (CPU −46.3 and −30.9 %).

The quinn patch alone carries +10 and +21 % asks/s and −11 and −21 % CPU at saturation, and −71 %
receive drops; the pooled hand-off roughly doubles the throughput half at 250 KB. PGO on this
runtime: −8.6 to −10.6 % CPU per ask and +7 to +8 % asks/s (6/6), 250 KB depth-1 p50 −4.7 % (6/6).
An earlier "−15 % throughput at 250 KB, depth 1" was against the per-core tree, not the stock one;
against the stock tree that cell goes the other way.

**The depth × sessions plane, 2026-09-18.** `lab/scripts/depth_session_matrix.sh`, 24 cells — both
frame sizes, depth 1/2/4/8, 1/4/16 sessions, six interleaved repeats. **CPU per ask falls in all
24, 6/6 in each**, by −5.9 to −45.3 %. Throughput is up in 22, +1.5 to +63 %. **One cell is
materially worse, and it is the product's shape today** — 250 KB, depth 1, four sessions: p50
1 220 → 757 µs (−37 %), **p99 2 210 → 27 786 µs (+1 163 %)**, asks/s −29 %, and `main` carrying only
the quinn patch reproduces it to within 1 %.
The median gets faster and the tail becomes a probe timeout: ~28 ms is `srtt + 4·rttvar` plus the
peer's 25 ms `max_ack_delay`. **The GSO cap is the whole of it.** *Corrected 2026-09-24 (GS1):* the
band is the frame's size against the client's 212 KB receive queue, not the session count — §5 has
the mechanism and the sweep.

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

**A browser does not see it.** Headless Chromium, `lab/scripts/browser_cell.py`, arms interleaved,
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
unchanged in total, since quinn held a copy before, and the pool keeps at most 64 buffers per
thread.

**What would overturn it:** a CPU-bound cell on the production target where the combined binary does
not beat the plain one on CPU per ask; a quinn upgrade that moves the batching itself. Re-run with
`lab/scripts/runtime_ab.sh` (`SERVER_CPUS` / `CLIENT_CPUS` pin the two sides) and
`lab/scripts/runtime_ab_pair.py`, one binary per arm; between arm builds `git checkout Cargo.lock`,
because a `--config` patch the lock cannot take is only a warning and the next build may resolve
quinn to a newer crates.io release.

**LTO is in the release profile** (2026-09-10): server CPU per frame −3.7 to −8.4 %, 4/4 in every
cell, binary −26 %, release rebuild 10 → 39 s. A later campaign on this tree read +7 % p50 (6/6) at
32 KB, depth 1, one session, against −3 to −6 % CPU at saturation; if large frames ship at depth 1,
that is the cell to weigh.

---

## 5 · Depth and the depth-1 tail: where latency and throughput part

Measured 2026-09-12 on the 4 vCPU VM, client on the box and unpinned, six repeats paired and arm
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
[`../adr-client-window-depth.md`](../adr-client-window-depth.md)'s `D_min`. Disk look-ahead is
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

| arm | datagrams / `sendmsg` | client drops / run | server lost / run | p99 | CPU / ask |
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
despite 20–60 drops a run. On loopback the pacer's burst limit is 256 packets and no arm reached it.

**Every cap has the cliff; the size of a send sets how wide it is.** Twenty frame sizes from 100 KB
to 1 MB, 4–10 repeats; below 200 KB nothing drops. The p99 is a PTO (≥ 15 ms) at **12 of 20 sizes
for `gso`** (210–240, 250, 275, 300, 350, 400, 700 KB), at 225 KB only for `cap16`, at 240 KB for
`base` — quinn's own 10 has the cliff too — and at **none for `cap24`** (worst 3.9 ms, at 240 KB).

At 1 MB every arm drops, mid-frame. With the receive buffer at 1 MiB every drop and every tail went,
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
taker left ([`../disk-access/adr.md`](../disk-access/adr.md) §8). quinn's own discovery stops at
1 452; the 20 bytes between are open (§9). `quinn-proto` 0.11.18 also fixed a black-hole detection
that pinned the MTU at 1 200 for 60 s after one ACK revealing four holes, which this project had
seen twice.

---

## 6 · One endpoint per core — parked

**Not in `server/`.** The work is whole on branch `claude/per-core-endpoints`. It was `--workers N`:
N OS threads, each a `current_thread` runtime owning its own endpoint on an `SO_REUSEPORT` socket,
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
multi-thread arm wins throughput by more than 10 % or p99 by more than 30 % on the heavy-tail cell.
`lab/scripts/runtime_ab.sh` is the instrument.

---

## 7 · Larger levers, above this layer

On a real-looking link a third to a half of steps wait on the network, and these outweigh everything
above: **bytes per displayed frame** — a truncated HTJ2K prefix, resolution rungs and the stride law
([`../adr-resolution-fitting-for-large-frames.md`](../adr-resolution-fitting-for-large-frames.md),
[`../adr-stride-is-bandwidth-conservation.md`](../adr-stride-is-bandwidth-conservation.md)); on the
target the wire binds first, so fewer bytes is the only lever above ~2×, and abandoning a frame's
tail with `RESET_STREAM_AT` is not carried by quinn or wtransport yet. **Ask window depth** —
[`../adr-client-window-depth.md`](../adr-client-window-depth.md): in a browser a fixed window of 4
against serial asks is −26.6 % per frame at 250 KB and −59.4 % at 32 KB (6/6), the largest latency
lever measured, and the client's. **Cache size** — a 64-frame cap on a 500-frame series costs +65 %
offered load for +2.8 pp of misses.

---

## 8 · Confidence

**Strong**: the controller's dependence on the loss regime (the 600 ms congestive cell is n = 2 for
BBR); BBR's 12–19× under random loss in a browser, and its queue cost; the shared stream, on real
hardware and in a browser; the first ask as slow start and its levers, within cell on one relay and
one address; CPU per ask from the GSO cap, PGO and the hand-off, 6/6 in every saturation cell on
three boxes; the depth-1 tail as the rig client's receive queue, on loopback. **Moderate**: the
windows never approached (loopback, N ≤ 16); per-core endpoints at saturation. **Weak or
unmeasured**: which regime the deployment mix is in; the bounded BBR (one rig, no competing flow, no
congestive loss); the restart at 1 % loss; which outage model a radio follows; anything on the
target, on a phone, or in a browser at depth 1.

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
2. **The loss mix** (§1): client telemetry, the round-trip trend in the second before each loss.
   Until then, the bounded BBR on a rig against a competing flow and congestive loss, and one
   calibration of `link_impair.py` against `netem`.
3. **The first ask's defaults** — the owner's call (§3). Unmeasured: which lever a NAT rebind
   re-applies, and a genuinely new client address.
4. **The restart at 0.1–1 % loss**, with rounds enough to size the misfire; **hold or drop** — which
   a radio does through an outage, from a device trace; the slow-start exit once a deep queue is the
   steady state; what declares ~140 losses a session under ±10 ms reordering (a qlog cell: quinn's
   `qlog_stream` reads pacing, flow-control blocking and recovery instead of inferring them);
   delivery-trace replay in the relay; and the idle radio — by report carriers drop a radio to idle
   after 5–10.5 s without traffic and promotion back costs 190–396 ms on 4G and 341–1 907 ms on 5G;
   neither a browser's 15 s ping nor the 20 s keep-alive ([`adr-idle-sessions.md`](adr-idle-sessions.md))
   comes often enough to prevent it, so every idle ask may pay it. A device decides.
5. **`--initial-rtt-ms`**, at the target's real round trip (§3).
6. **The GSO cap: 24, or 45 behind the product's buffer** — the owner's call (§5). Owed: 44 against
   10 on CPU per ask at 20 Mbit / 50 ms and 100 Mbit / 30 ms, with a 1 Gbit / 1 ms control that must
   separate; within 5 % means inert on the target, kept only for a LAN deployment. **The packet
   size**: where a browser advertises `max_udp_payload_size` ≥ 1 472, raise
   `MtuDiscoveryConfig::upper_bound` to 1 472 for IPv4 peers — 1.4 % fewer packets, never above what
   the peer advertises.
7. **The depth-1 tail.** Headless Chromium 141 does not advertise `min_ack_delay`
   ([`../CLIENTS.md`](../CLIENTS.md) §ACK frequency, by browser); one run on 148 closes that. An
   ACK-eliciting packet after an isolated frame would turn a lost tail into a gap, if quinn's packet
   builder can place it *after* the tail. Not before items 1–3.
8. **Two upstream quinn items, drafted, not posted**:
   [`upstream-quinn-ack.md`](upstream-quinn-ack.md) (the patch is carried, off; whether it removes
   the session-open probe in a browser is unmeasured) and the probe-every-space companion in
   [`upstream-wtransport-settings.md`](upstream-wtransport-settings.md).
9. **A thousand stalled sessions.** `window-harness --mode stall` at 1 000 sessions on the rig, RSS
   and fds per session from `/proc`: under 300 kB and 3 fds, and the deployment manifest
   ([`../disk-access/adr.md`](../disk-access/adr.md) §6) is enough; otherwise an accept cap. There
   is no admission control at accept today.
10. **Reachability.** By report 3–5 % of networks impair UDP. A WebSocket carrying the same wire
    exists behind `--websocket` ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The TCP fallback); the
    field failure rate that decides whether it is enabled is unmeasured.
11. **Stream shape under BBR**: HOL1 ran Cubic only
    ([`../adr-stream-shape.md`](../adr-stream-shape.md)).
12. **WebKit**: every browser number here is Chromium ([`../CLIENTS.md`](../CLIENTS.md) §On WebKit).

**Closed — reopen only on new evidence.** A payload above 1 472 bytes for browsers (§5). 0-RTT and
TLS resumption: a browser never resumed a WebTransport session in 216 dials, and the draft forbids
CONNECT in 0-RTT. Connection pooling, and the browser's `congestionControl` hint, which shapes only
its send side, which carries only asks. A 10-segment clamp everywhere (§5). Per-frame without
priority, `send_fairness`, `pool:k` (§2). `yield_now`, `--workers` above the cores, per-core
endpoints until §6's conditions (§6). The persistent-congestion and reordering thresholds as levers,
the slow-start exit as a default (§3). `aws-lc-rs`, mimalloc (§3, §4). Window equalisation
([`adr-quic-stream-receive-window-defaults.md`](adr-quic-stream-receive-window-defaults.md)).
