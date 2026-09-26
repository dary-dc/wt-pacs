# ADR: one shared stream for a session's frames

**Status:** accepted · **Date:** 2026-09-26 — default set 2026-09-11, confirmed natively 2026-09-15
and in Chromium 2026-09-25 (HOL1) · **Closes:** §6 of
[`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md) · **Tags:** transport,
wire

## Decision

* **One shared uni stream per session is the default** (`--stream-mode shared`).
* **`pool:k` is closed.** No cell on either rig recommends it, and it costs where the others tie.
* **`per-frame` stays a flag**, and ranks each stream by ask order — earlier asks outrank later
  ones. It measured level with `shared`, not better, and level is not a reason to change a default.
* **The WebSocket path is one ordered stream by construction**, so the question does not arise
  there.

All three shapes carry the same length-prefixed envelope ([`WIRE.md`](WIRE.md)); they differ only in
how long a stream lives: one per session, `k` per session dealt round-robin, or one per frame.

## Context

The textbook argument is that one stream holds every later frame behind one lost packet, and one
stream per frame confines a loss to its own frame. It was pre-registered as H4, and it lost.

**The validity condition, before any number.** The arms are byte-identical when one frame is in
flight: at depth 1 all three send one frame on one stream. A cell measures stream shape only where
`D_min > 1` ([`adr-client-window-depth.md`](adr-client-window-depth.md)) — 32 KB to 250 KB on a
10 Mbit link. **Nothing here transfers to mammography and tomosynthesis sizes**, where `Tf ≫ RTT`
puts `D_min` at 1. And the family's value is exactly zero on a lossless link, so a lossless run
says nothing for or against independent delivery.

## 1 · Why per-frame lost, and why it no longer does

**A misplaced `await` first.** Per-frame streams read a flat 7.00 Mbps at `D` = 1–8 against 8.50
shared, because `wtransport`'s `finish()` waits for the peer's ack (~272 ms) and was awaited on the
serial loop ([`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md) §1). With
it moved into a `JoinSet`, per-frame at 250 KB, `D` = 4, 10 Mbit / 60 ms reads **8.0 Mbps** (X1,
2026-08-28), clear of the old `Tf/(Tf+RTT)` ceiling.

**Then fair sharing.** With `D` equal-priority streams open, QUIC shares the link across all of them
and every frame finishes late; one ordered stream sends frame 1 whole, then frame 2, so the frame
the reader waits for lands first. For ordered demand that ordering is alignment, not a defect. The
cloud rig measured it lossless (2026-08-29, 432 rows, 5 s dwell, 3 repeats, `--mode saturate`),
three arms — **S** shared, **P** per-frame FIFO, **Q** per-frame with ask-order priority:

| `frames_32k` | S | P | Q |
| --- | ---: | ---: | ---: |
| 60 ms, `D` = 12 | **7.920** Mbps | 7.032 | **7.920** |
| 150 ms, `D` = 12 | **7.408** | 6.350 | **7.374** |
| 150 ms, `D` = 8 | 6.520 | 5.052 | 5.991 |

P trails S by 10–25 % across the grid; Q ties S and never beats it. At `D` = 1 the arms agree
(250 KB spread 0.133 Mbps, 32 KB 0.034), and divergence starts at `D` = 2, the first depth with two
streams to share — the predicted onset. It accounts for X2's lossless 18 % gap at 150 ms, and is
consistent with X2's `D_min` of 8 for per-frame against 2 for shared (Q's own `D_min` was not
reported). Two anomalies are recorded, not explained: Q at 32 KB / 150 ms / `D` = 16 reads 5.701
against 7.374 at `D` = 12, and S at 250 KB / 60 ms falls 7.200 → 3.867 → 2.933 from `D` = 8 to 16,
where a shared stream should hold flat past saturation.

**Then retransmit deferral — why FIFO per-frame loses under loss.** quinn's `retransmit()` re-queues
a lost stream with `push_pending`, behind every stream already queued. One stream sends its
recovery ahead of its own newer data; per-frame FIFO sends it behind the other frames' whole
backlogs. The penalty is absolute (a wait behind `D − 1` frames), and it reproduced across rigs:

| p95 | shared | per-frame, FIFO | ratio |
| --- | ---: | ---: | ---: |
| netsim, 64 KB | 182.2 ms | 637.1 ms | 3.5× |
| netsim, 250 KB | 372.7 ms | 3 159.5 ms | 8.5× |
| real path, 64 KB | — | — | not a result: realisation noise 4.32× |
| **real path, 250 KB** | **594.7 ms** | **3 426.2 ms** | **5.76×**, 3/3 |

The absolute penalty is 2 787 ms on netsim and 2 832 ms on the real path, **1.6 % apart**. The
real-path cell was pre-registered as the decider — flip the default if `shared` separates with
the stranding gate passing — and it did (10.8–29.0 MB stranded, zero censoring). **That set the
default, 2026-09-11.** Until then the binary defaulted to per-frame. `send_fairness(true)` was
worse than FIFO in every cell tried, a scheduling penalty rather than a head-of-line one; it is
gone from the product.

**Ask-order priority removes the deferral**: a retransmit of an earlier frame now outranks newer
frames' data. `ask_priority(seq) = −seq` gives every frame its own level. quinn warns that many
levels per connection may cost performance; that concerns streams *concurrently pending*, which is
only `D` of them, so it stands. It is also the rule
[`adr-reject-server-ordering.md`](adr-reject-server-ordering.md) settled — the client's ask order is
the priority — expressed at the transport. Before the campaign below it had been measured only at
32 KB, inside noise at the decision cell (pooled CI [−7.3, +26.3] % at 0.5 % loss; the one tight
cell +1.5 %, CI [+0.6, +5.1]).

## 2 · The three-arm campaign, native, 2026-09-15

`shared`, `pool:2` (frames dealt round-robin over two long-lived streams, each ranked by the frame
last dealt to it) and `per-frame` with priority. 250 KB, depth 2, 10 Mbit / 60 ms under netns
netem, six repeats, arms interleaved with the order reversed every repeat, one warm-up pass per arm
discarded; the bursty cell (Gilbert–Elliott, `p 0.07 % r 14 %`: 0.5 % mean, bursts of ~7 packets)
re-run at eighteen. p95 over **every step, zeros included**, so each arm brings the same samples
(486 per six repeats); against `shared` in the same cell:

| cell | `per-frame` | `pool:2` |
| --- | --- | --- |
| no loss | +0.1 % | **+74.9 %** |
| 0.5 % iid | −7.0 %, CI [−23.8, +2.9] | **+69.2 %**, CI [+34.1, +85.1] |
| bursty, 18 repeats | −21.7 %, CI [−45.2, +79.8] | **+88.1 %**, CI [+73.9, +294.3] |

**`per-frame` and `shared` are indistinguishable at every loss level tested.** No interval excludes
zero, and in the bursty cell the two per-run p95 distributions overlay: ten quiet runs at 64–65 ms
each, eight a burst reached, **median of per-run p95 65 ms for both**. Two defensible estimators
reading a dead heat and −21.7 % is not a finding.

**`pool:2` is decisively worse, on four independent signals.** It costs ~75 % of tail with no loss
at all — two equal frames interleave where one stream would finish the first early — so it is the
arm's own cost, not a loss effect. It strands 24–29 frames of 49 in every repeat against 2–13. In
the bursty cell its mean wait is 197–217 ms against 27–49, and it sat at exactly 483 ms in fifteen
runs and **collapsed to 26 s in two of eighteen**.

**Throughput separates nothing.** Six 10 s saturation probes per arm per loss level: 4.30 / 4.10 /
4.30 frames/s (`shared` / `pool:2` / `per-frame`) at 0 %, 4.30 / 4.00 / 4.35 at 0.5 %, 2.65 / 1.95 /
2.05 at 2 %. At 2 % each arm's probes span ~3× and the ranges overlap almost entirely.

**Bursts cost more than the arms do.** From the same baselines, bursty loss at 0.5 % mean degrades
`shared`'s tail by 38 % (18 repeats; 46 % at six) where scattered loss of the same mean costs 9 %,
and neither stream arm changes that. That points at the congestion controller
([`transport/transport-conclusions.md`](transport/transport-conclusions.md) §1), not at the streams.

## HOL1 — in Chromium, through the relay (2026-09-25)

Queue row 78. The same question asked of a browser, for an owner deciding whether another stack
should move from one shared stream to K persistent ones — so the pool at `k` = 2, 4, 8 is the arm
that matters. `lab/stream-shape/` ([README](../lab/stream-shape/README.md)); rows in history at
`d184333`.

**The rig.** 20 Mbit, 40 ms each way, a 200-packet queue (`lab/scripts/link_impair.py`), Cubic,
128 KB frames, the raw TS client in headless Chromium. Per run: a fresh release server and relay, a
fill of 40 frames, then 30 asks with the arm's `D_min` outstanding. Arms `shared`, `per-frame`,
`pool:2`, `pool:4`, `pool:8`, rotated every round, 7 rounds. Cells 0 %, 1 %, 3 % iid, and
Gilbert–Elliott at the relay's default (0.5 % mean, bursts of ~7 packets). The pool's priority is
exact only while a stream holds one unsent frame: a stream still sending frame `n` takes frame
`n + k`'s rank when it is dealt.

**The rule, pushed before the first run:**

1. `D_min` per arm from a lossless sweep of depths 1–6: the smallest within 95 % of the arm's best.
2. Metrics: all received; the fill's gap (frame `i` shows once `0..i` have landed), 7 × 39 = 273
   samples; an ask's latency, 7 × 30 = 210. Nearest-rank p95 — about the 14th and 11th largest.
3. Control: at 0 % every arm receives everything and `per-frame` sits within 15 % of `shared` on
   both p95s, or no loss cell is read. A pool outside 15 % at 0 % is read against its own control.
4. Per lossy cell and arm: *worth it* if pooled p95 is ≥ 20 % under `shared`'s and the run's own p95
   is under `shared`'s in ≥ 5 of 7 rounds, everything received; *costs* the other way; otherwise
   *no separation*.
5. K persistent streams are worth moving to if some `pool:k` is *worth it* on either metric in at
   least two of the three lossy cells, and passes its control or stays worth it against its own.

**Results.** Every arm received everything in every cell: 280 of 280 fill frames, 210 of 210 asks.
`D_min` is 3 for every arm (6.1 / 12.7 / 15.2 asks/s at depths 1 / 2 / 3, flat after). The control
passes: `per-frame` −2.1 % on the fill's gap and +0.3 % on asks.

| pooled p95 vs `shared` | `shared` gap / ask | `per-frame` | `pool:2` | `pool:4` | `pool:8` |
| --- | --- | --- | --- | --- | --- |
| 0 % | 221 / 190 ms | −2 % / +0 % | −8 % / +0 % | **+141 %** / +0 % | **+34 %** / −0 % |
| burst (0.5 %) | 213 / 605 ms | −4 % / −1 % | −16 % / +13 % | **+151 %** / −3 % | **+39 %** / −19 % |
| 1 % | 1 013 / 2 822 ms | +4 % / −0 % | +4 % / **+23 %** | **+475 %** / −3 % | **+268 %** / −4 % |
| 3 % | 1 667 / 4 413 ms | −6 % / −2 % | −1 % / **+23 %** | **+583 %** / +2 % | **+271 %** / −1 % |

**Verdicts, by the rule.** `per-frame`: *no separation* in every lossy cell, the largest −5.5 % (3 %,
fill, 5 of 7 rounds). `pool:2`: *costs* on asks at 1 % and 3 % (0 of 7 rounds won in both). `pool:4`
and `pool:8`: *cost* on the fill at 1 % and 3 % even against their own control — ×2.4 → ×5.8 and
×6.8 for `pool:4`, ×1.3 → ×3.7 for `pool:8`; `pool:8`'s burst ask (−19 %, 5 of 7) came closest to
*worth it* and is under the bar. **The owner's question: no** — no `pool:k` is worth it in any lossy
cell.

**Two mechanisms, both in the rows.** *Independent delivery has nothing to rescue here:* under random
loss Cubic's window is the limit — ~1.7 Mbit of frames at 1 %, where Mathis' 1.22·MSS/(RTT·√p) gives
1.5 at 80 ms — so an ask waits ~2 s and one lost packet's round trip is a few percent of it.
*K persistent streams cannot keep ask order:* QUIC ranks streams, not frames, so frames behind a
re-ranked pool stream jump the queue. That bites the fill (bunches of `k`, gap p50 0 ms) and the
asks only where 3 asks share 2 streams. Without priority the pool round-robins; with it, it reorders.
Either way it is the shape, not the build.

**What HOL1 does not say.** One link, 128 KB frames, Cubic, one host through a userspace relay
([`rig-limits.md`](rig-limits.md) §3). Under BBR the controller stops being the limit, and
independent delivery may then have something to rescue; that cell was not run.

## Corrections on record

Each was published or specified, then found wrong. Kept so none is re-derived.

* **The X3 campaign (2026-08-28) is invalid, and its "chosen: shared" retracted.** It ran both arms
  at `D` = 4 where their `D_min` were 2 and 8; its 0 % control showed per-frame 92 % worse and was not
  treated as a stop; X2's > 10 % stop gate was overridden; its p95 rested on ~4 tail samples. Shared
  won later on other evidence; X3 is cited in neither direction.
* **"Per-frame is worse under loss" was never a finding.** Per-frame *without priority* is worse for
  ordered demand at any loss, because concurrent streams share fairly.
* **X3's `mild_cell` timeout was a harness defect**, not a stall: asks wrapped modulo the study's
  80 frames while the waits did not, so from step 81 the harness waited for a frame never asked.
  Fixed in `lab/window-harness/src/client.rs`; the 80-step trace X3 swapped in was the workaround.
* **The v2 control was specified at the wrong depth.** "All arms close at 20 ms" was checked at
  `D` = 16, where concurrency is the effect under test; at `D` = 1 it passes. The same campaign
  carried no loss and, in saturate mode, no p95, so it could not evaluate its own decision rule.
* **A 3.5× throughput claim, retracted within the hour.** One 4 s probe at 2 % loss read `shared`
  1.00 frames/s against `per-frame` 3.50; three 10 s probes read 1.90 against 1.70, ranges 1.5–2.7
  and 1.5–2.4. Quantisation cannot make a 3.5× gap; one sample of a high-variance quantity can.
* **Per-frame's 0.5 % "win" is not established.** Miss-only it read −8.5 %, CI [−34.5, −0.1]; with
  every step, CI [−23.8, +2.9] spans zero.
* **`pool:2`'s bursty "win" was an estimator artifact.** Pooling positive waits only set `shared`'s
  worst 47 samples against `pool:2`'s typical 289; miss-only −16.4 % is +73.5 % with every step. The
  pooler now prints both and warns when miss counts differ by more than 2×. The miss-only reading of
  the null cell is `pool:2` +17.1 %, CI [+16.9, +41.5]; an earlier summary printed that CI beside
  the all-step +74.9 %, which it does not bound.
* **The bursty-cell prediction was not falsified.** Six repeats read per-frame +2.0 % and this was
  called falsification; eighteen read −21.7 %, the predicted direction. Neither interval excludes
  zero: the prediction is untested.
* **Median of per-run p95 inverted a slope** on the same rows in the 32 KB priority lane; the pooled
  estimator replaced it.
* **A first 0.5 % cell pooled two cache regimes.** Its first repeat was a cold page cache (hit rate
  0.28–0.30 against 0.70–0.84), making `shared` 50× the worst arm with it and the best without.
* **A first 2 % cell over-demanded ~2×**: the step interval came from the link label while Cubic
  carried 2.5–4.3 of 10 Mbit, and every arm censored 5–33 % of waits.
* **Shared was not "worst under loss".** [`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md)
  §4 ranked it so by argument; measured against per-frame with priority, it is level.

## How a stream-shape cell is read

What the corrections above cost to learn, and what `lab/scripts/stream_shape_cells.sh` and
`stream_shape_pool.py` now enforce:

* **An open-loop reader.** A closed-loop reader cannot produce head-of-line blocking (0.00 MB
  stranded); no result from `--reader-mode closed`, still the harness default, is admissible.
* **Each arm at its own `D_min`**, and a zero-loss control where `per-frame` and `shared` must sit
  within 15 %, or the gap is the instrument. A pool's own zero-loss cost is divided out, not a stop.
* **Equal samples per arm** — every step, not positive waits only — and a bootstrap CI.
* **One discarded warm-up pass per arm**; a cache-hit spread above 0.25 within an arm voids the cell.
* **The step interval measured**, from a saturate probe on the reference arm, one interval for every
  arm — so the cell adapts to loss, rate and controller.
* **VOID is a verdict**: fewer than 20 reference-arm misses, a reader that never met its schedule, or
  service from cache. Fix the cell; do not raise the repeats.
* **A bursty cell needs two to three times an iid cell's repeats**: bursts damage fewer frames at the
  same mean loss (47 pooled misses against 106).
* **Real netem only.** The harness's `--rtt-ms` delays the return path and is inert in shared mode;
  `--read-bps 0` whenever `tc` shapes, or the software pacer fights it.
* **State first what result the cell cannot produce.** A cell where "no signal" is possible for
  reasons unrelated to the hypothesis is void before it runs.

## Consequences

* **The server.** `server/src/transport/frame_out.rs`: `Shared` opens one uni at session start;
  `PerFrame` opens a uni per frame at `ask_priority`, finishes it off the loop and reaps finished
  acks as it sends (before 2026-09-06 they were held to session end: RSS 30.8 MB after 35 k frames,
  12.5 MB flat after). `Pool` stays only so the recorded cells reproduce; nothing recommends it.
* **Priority under `shared`** cannot raise a new ask above frames already committed to the stream.
  The planner does it instead: an ask ends a fill and is served next ([`WIRE.md`](WIRE.md)).
* **A truncated frame is reported the same in both modes**; the client cannot tell them apart, and
  narrowing per-frame's report would need a wire field for a mode the default does not use
  ([`CLIENTS.md`](CLIENTS.md)).
* **The WebSocket path** (`exact-server --websocket`) carries the shared stream's bytes as binary
  messages on one TCP stream, which the session's refusals share. It gives up independent streams
  and per-stream loss recovery; the conformance clauses that need them are not applicable there.
  Its tail under loss is not measured.

## What would reopen it

* **Progressive delivery.** Once a frame's viewable prefix goes out beside the next frame's and the
  server abandons the tail, per-frame is required: `RESET_STREAM_AT` abandons a tail per stream
  ([`transport/transport-conclusions.md`](transport/transport-conclusions.md) §4). The per-frame flag
  is kept for this.
* **BBR, or any controller that is not the limit under loss.** Independent delivery may then have
  something to rescue. HOL1's cells under BBR; `lab/stream-shape/run.mjs` would take `--congestion`
  in one line. Not run.
* **A cell with `D_min > 1` where `per-frame` beats `shared` by more than 15 % (native rule) or 20 %
  (browser rule)** with an interval excluding zero and a passing control. None has, on either rig.

Not a reopener: a pool of any size. Its cost is structural — interleaving without priority,
reordering with it — and it grew, not shrank, from `k` = 2 to `k` = 4 in the browser.

## References

* [`transport/transport-conclusions.md`](transport/transport-conclusions.md) §2 — the summary this
  ADR details
* [`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md) — the options and the
  `finish()` retraction
* [`adr-client-window-depth.md`](adr-client-window-depth.md) — `D_min`
* [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md) — ask order is the priority
* `lab/stream-shape/`, `lab/scripts/stream_shape_cells.sh`, `lab/scripts/stream_shape_pool.py` — the
  instruments; raw rows in git history under `docs/measurements/`
