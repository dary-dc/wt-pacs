# Transport optimisation — conclusions

**2026-09-06.** Method, hypotheses and decision rules fixed in advance in
[`lanes/L4-preregistration.md`](lanes/L4-preregistration.md). Raw data in
[`measurements/l4/`](measurements/l4/) — **R-series only**; the e-series is superseded and
marked so in that directory's README. Three adversarial reviews; each found
conclusion-invalidating defects, and each is recorded rather than absorbed (§7).

Target: **p95 time-to-displayable** first, **server density** second. Browser client on
tablets and phones over **5G, satellite and WiFi**. Three stream-based candidates.

**Stream shape was re-measured in R6** after review 4 found the rig could not produce
head-of-line blocking. Pre-registration: [`lanes/R6-preregistration.md`](lanes/R6-preregistration.md);
data and review: [`measurements/r6/`](measurements/r6/).

---

## The answer

| decision | verdict |
| -------- | ------- |
| **Congestion controller** | **Two opposite answers, depending on which kind of loss your links have.** Congestive → **Cubic**. Radio/exogenous → **BBR**. Both directions large and separated. **Default to Cubic** until the mix is measured (§1) |
| **Stream shape** | **Keep one shared stream** — measured on a rig that *can* produce head-of-line blocking, and won on a mechanism that then survived a falsifiable prediction. Per-frame is **3.5× worse at 64 KB and 8.5× worse at a realistic 250 KB** and never better anywhere. The textbook argument for per-frame is falsified: quinn re-queues a retransmitting stream to the **back** of the queue, so per-frame *defers* loss recovery behind other frames' backlogs (§2) |
| **Fixed-N pool** | **Still untested** — a server-side change, and this lane may not modify `server/`. R6 makes it *less* promising: the retransmit-deferral cost grows with N, and the winning endpoint is N = 1 (§2) |
| **Initial congestion window** | Leave at quinn's default — ≤ 7 %, ranges overlapping |
| **GSO segment cap 10 → 32** | Worth doing, but it is **density, not latency**: +17 % throughput, −21 % CPU/byte, **zero** effect on p95 |
| **Chunked send path** | Keep. −6…−14 % CPU/byte at every rate |
| **Flow-control windows** | Set them — for **memory** at thousands of viewers, not for speed |

---

## 1 · The controller answer is two answers, and which applies is measurable

Every flip in this work — there were three — happened because a campaign sat accidentally
in one loss regime and the result was read as the general answer. The two regimes were
finally run side by side on one rig, **each verified by queue-drop counters rather than
assumed**.

### Congestive loss — queue overflow is the only loss

| cell | Cubic | BBR | queue drops, Cubic → BBR |
| ---- | ----- | --- | ------------------------ |
| 50 ms, 20 Mbps | 186 ms | 190 ms *(+1.9 %, inside the noise band)* | 77 → 6 589 |
| **600 ms, 8 Mbps** | **941 ms** | **1535 ms** *(**+63 %**, separated)* | 218 → 9 128 |

**Cubic wins, and the margin is at high RTT.** BBR also drops **30–100× more packets at
the bottleneck** — BBRv1 declining to treat loss as congestion and keeping the queue full.
No earlier rig here could show this, because the queue could never overflow.

### Exogenous loss — 1 % radio loss, queue never drops

| cell | Cubic | BBR |
| ---- | ----- | --- |
| 50 ms, 20 Mbps | 359 ms | **187 ms** *(**−48 %**, separated)* |
| 600 ms, 8 Mbps | 1968 ms | **1098 ms** *(**−44 %**, separated)* |

**BBR wins by roughly half, at both RTTs.** Cubic halves its window for damage it cannot
prevent; BBR ignores loss and keeps sending.

### What to do

5G, satellite and WiFi have **both** kinds: radio errors, fades and handovers (exogenous),
plus congestion at the tower, the backhaul and the home access point. **The mix decides,
and the mix is unknown.**

The diagnostic is simple — **is loss correlated with queueing delay?** RTT rising before
loss appears means congestive (→ Cubic); loss arriving with RTT flat means radio (→ BBR).

**Default to Cubic until that is measured**, for three reasons: it is the incumbent; it is
the safer error (63 % worse if wrong, against 48 % the other way); and BBRv1's 30–100×
queue-drop excess is inflicted on *other traffic sharing the link*, which the p95 metric
does not price and which matters with many viewers on one hospital uplink. quinn ships
BBRv1, marked experimental, documented to take > 90 % of a shallow buffer from competing
Cubic flows.

---

## 2 · Stream shape — **keep one shared stream.** Now for a mechanism, not by default

The previous edition of this document withdrew a "keep one shared stream" recommendation
because the rig could not produce head-of-line blocking. **R6 rebuilt the rig so it could,
and the answer came back the same — but for the opposite reason to the one originally
assumed, and against the hypothesis this project pre-registered.**

Method and decision rules fixed in advance in
[`lanes/R6-preregistration.md`](lanes/R6-preregistration.md). Data and review in
[`measurements/r6/`](measurements/r6/).

### The rig now generates the effect, which is new

One cell, one server, only the reader mode differs:

| reader | stranded bytes |
| ------ | -------------- |
| closed-loop (every campaign before R6) | **0.00 MB** |
| open-loop | **18.31 MB** |

Zero — structurally, not incidentally. The old client blocked until each frame arrived
before advancing, so the transport could never fall behind and every byte in flight was a
byte the reader still wanted.

### The result

p95 time-to-displayable, median of repeats, arms interleaved within each repeat.
`per-frame + FIFO` is `--stream-mode per-frame --send-fairness false`.

n = 3 in every cell, all 36 rows admissible (no VOIDs).

| cell | what it is | shared | per-frame + FIFO | verdict |
| ---- | ---------- | ------ | ---------------- | ------- |
| **N0** | control: no loss, reader keeps up | 79.4 ms | 79.3 ms | **tie (−0.1 %)** — the rig adds no artifact |
| **X2** | stranding, no loss | 82.3 ms | 84.0 ms | **tie (+2 %)** |
| **X1** | 0.1 % loss + stranding | 372.9 ms | 363.6 ms | **tie** — ranges overlap, sign flips per seed |
| **X3** | **1 % loss** | **182.2 ms** | **637.1 ms** | **shared wins, +250 %, separated 3/3** |

The X3 margin replicates in every repeat — **3.34×, 2.38×, 3.88×** — with the arms
interleaved inside each repeat, so the loss realisation is common-mode within a comparison.

### H4 — the classic argument for per-frame streams — is **falsified**

The pre-registered hypothesis was the textbook one: *under loss, a shared stream delays
every frame queued behind a lost packet; per-frame streams confine the damage to one
frame.* Prediction P4 was that per-frame beats shared once loss and stranding are both
present.

**It does not. At the loss level where the effect should be strongest, per-frame is 3.5×
worse**, and the direction is the same in all three repeats.

The mechanism is in quinn's scheduler, and it was verified in source before the campaign
rather than invented to fit the result:

- `retransmit()` re-queues a stream with **`push_pending`** — *"queued **after** any
  already-queued streams for the priority"* — and it does so **regardless of the fairness
  setting** (`quinn-proto-0.11.17` `state.rs:677`, `mod.rs:402`).
- With **one** stream, a retransmission re-enters that stream and goes out ahead of newer
  application data behind it. Recovery is immediate.
- With **per-frame** streams, the stream that lost a packet goes to the **back of the
  queue**, behind every other pending frame's full backlog. Under FIFO drain-to-completion
  each of those drains entirely first — up to 7 × 64 KB ≈ 448 KB at depth 8, which is
  ~180 ms per queued frame on a 20 Mbps link.

That predicts the sign and roughly the magnitude of the 440–460 ms absolute penalty
measured in X3. **Receiver-side isolation is real, and sender-side retransmit deferral
costs more.** The classic argument is right about the receiver and silent about the sender.

### The mechanism made a falsifiable prediction, and it survived

If the penalty really is *"wait behind up to D−1 whole frames"*, it must scale with **frame
size**. That is a claim the 64 KB campaigns cannot test on their own, and it was written
down — with a number — before the run.

The cell was re-run at **250 KB**, the size `transport-optimization-spec.md` uses for a CT
slice throughout. Everything else was held: same depth, rate, loss, and an operating point
chosen so the demand/achievable ratio (0.64 vs 0.66) and the measured stranding (33 vs 33–35
frames) matched. All 9 rows admissible, zero censoring, every arm delivering the same 655
frames.

| | shared | per-frame + FIFO | ratio | penalty |
| --- | ------ | ---------------- | ----- | ------- |
| **64 KB** | 182.2 ms | 637.1 ms | 3.5× | 455 ms |
| **250 KB** | **372.7 ms** | **3159.5 ms** | **8.5×** | **2787 ms** |

**Prediction: the penalty grows 3.9× with frame size. Measured: 6.1×.**

**The direction and order are confirmed; my point estimate was 57 % low, and the reason is
instructive.** The simple model counted only the *size* of each deferral. It omitted that a
larger frame is also *hit more often*: at 1 % loss a 64 KB frame is 44 packets and has a
36 % chance of losing one, while a 250 KB frame is 172 packets and has an **82 %** chance.
Multiplying both effects predicts 9.0×, an overestimate — a frame that loses two packets
does not pay the deferral twice. Measured 6.1× sits between the two bounds, which is where
the mechanism says it should.

The practically important form of this result:

- **shared degrades sub-linearly** — 2.0× slower for 3.9× the bytes
- **per-frame degrades super-linearly** — 5.0× slower for 3.9× the bytes

**So the 64 KB campaigns understated the case.** At the frame size this product actually
ships, the shared stream is not 3.5× better but **8.5× better**, and the gap widens with
every increase in frame size.

### Robustness: a second reading pattern does not reverse it

The decisive cell was re-run against a structurally different trace — continuous scrolling,
where the window is stranded by **overrun** rather than by **displacement** — at its own
seed-validated operating point (cell X3S, all 9 rows admissible).

| | shared | per-frame + FIFO |
| --- | ------ | ---------------- |
| median | 673.5 ms | 1011.4 ms |
| paired, per repeat | — | +29.3 %, +55.4 %, +4.8 % |

Shared is better in **3/3 repeats**, but the ranges overlap, so by this lane's own rule
**that is not a result** — and it is reported as one rather than promoted. What it
establishes is that **nothing reverses**: no trace, cell or repeat in R6 favours per-frame.

The effect is an order of magnitude smaller than the jump trace's, and that is what the
mechanism predicts. Continuous scrolling issues asks near-sequentially, so a retransmitting
stream waits behind a small backlog; a jump fires D asks at once and it waits behind up to
D − 1 *full frames*. **The shared-stream advantage is largest for jump-heavy reading**,
which is the pattern this design targets.

### Why X1 is a tie and not a weaker version of X3

In X1 the **seed moves `shared` alone by 2.1×** (261 → 548 ms across repeats) while the
arm difference flips sign (−36.7 %, −2.5 %, +13.8 %). The loss realisation dominates the
stream shape completely. In X2 and N0, where there is no loss to realise, the seed effect
is 1.0× and the arms agree to within 2 % — so the overlap in X1 is genuine variance, not
insufficient resolution.

So: at low loss the shape does not matter; at high loss it matters and shared wins.
There is no cell in which per-frame is better.

### `send_fairness(false)` is mandatory if per-frame is ever used

`perframe_fair` is worse in **all four cells** — +74 %, +74 %, +23 %, +456 % — with a
consistent sign in all twelve repeat-level comparisons. That reproduces the finding of four earlier campaigns and
matches quinn's own scheduler test (`state.rs:1528-1541`: fair yields `a,b,c,a,b,c`,
unfair `a,a,a,b,b,b`).

**But it is worse in the negative control too**, which means the campaign cannot attribute
it to head-of-line blocking — fairness needs only concurrency, which every cell has. It is
a scheduling penalty, full stop. See [`measurements/r6/adversarial-review.md`](measurements/r6/adversarial-review.md) §3.1
for how this failed control narrows the campaign's scope.

**P5 — my own pre-registered prediction that fairness-on would *beat* FIFO under stranding
— is falsified.** It is recorded because it was written down in advance precisely so it
could not be quietly dropped.

### Fixed-N pool — still untested, and now less promising

Unchanged in status: a pool is a server-side change and this lane may not modify `server/`.

What R6 adds is a reason to expect less from it. The retransmit-deferral cost **grows with
N**, because a recovering stream waits behind more backlogs; receive-side isolation also
grows with N. Measured at N = 8 the cost dominates by 3.5×, and at N = 1 there is no cost
at all. An interior optimum remains possible in principle, but the endpoint that wins is
the one the incumbent already uses.

## 3 · Density — separate metric, separate rig, unchanged

Measured on the direct-loopback rig, never through the path simulator (which forwards
datagram-by-datagram and destroys GSO batching, so no CPU claim may pass through it).

| item | effect |
| ---- | ------ |
| **GSO segment cap 10 → 32** | +17.2 % throughput, −20.9 % CPU/byte — best density lever |
| Chunked send path | −6…−14 % CPU/byte at every rate |
| Per-frame prefault hop, warm cache | costs 10 % throughput, 14–34 % CPU/byte |
| `aws-lc-rs`, ACK frequency, socket buffers, initial MTU | ≤ 3 % or nil |

The GSO cap was re-run as a **negative control** in an RTT-bound cell and correctly showed
nothing — evidence the latency rig measures what it claims.

**Never derive the cap from `max_gso_segments()`.** The binding limit is bytes: 65 527,
i.e. 45 segments at a 1452-byte MTU. Exceeding it returns `EINVAL` and `quinn-udp` then
disables offload **permanently for that socket** — a measured 91 % collapse. Use
`min(platform, 65527 / mtu)`. Corroborated independently by an ETH Zürich thesis and by
open quinn issue #2201.

---

## 4 · The levers above the transport, which are still the bigger ones

**Correction.** An earlier edition said "only ~8 % of steps ever wait on the transport".
That figure came from the closed-loop reader on the *easiest* cell, and it understated the
transport's role. Re-measured open-loop, the share of steps that actually wait is:

| cell | steps that waited |
| ---- | ----------------- |
| N0 — no loss, reader keeps up | 8 % |
| X3 — 1 % loss, slow reader | 13 % |
| X1 — 0.1 % loss, fast reader | 37 % |
| X2 — no loss, fast reader | 52 % |

So on anything resembling a real link, **a third to a half of steps wait on the network**,
not 8 %. The transport is not a rounding error. The levers below still dominate, but they
are now "bigger" rather than "everything":

1. **Progressive delivery.** HTJ2K is progressive; a truncated resolution-ordered prefix
   is a viewable image. First-displayable becomes one round trip regardless of frame size,
   which dissolves the stream-shape and frame-size questions together.
2. **Cache size and eviction policy** — the single largest determinant of the absolute
   millisecond figures in this document. A 64-frame cap on a 500-frame series costs +65 %
   offered load for +2.8 pp of misses.
3. **Ask window depth**, decided in `adr-client-window-depth.md` — though that ADR derives
   it from a *throughput* criterion for a *latency* knob, which is worth revisiting.

---

## 5 · Confidence

**T2 throughout** — one host, a userspace path simulator, no real network, n = 3.

| conclusion | strength | what would overturn it |
| ---------- | -------- | ---------------------- |
| Controller depends on loss regime | **strong** — both directions large and separated, regimes verified by counters | nothing; the *mix* is unknown, not the physics |
| Which regime your links are in | **unknown** | client telemetry: loss vs queueing delay |
| Keep shared stream | **strong** — re-measured on a rig that generates head-of-line blocking; separated 3.5× at 1 % loss, replicated 3/3, matches a source-verified scheduler mechanism, negative control clean to 0.1 % | a cell where per-frame+FIFO separates *in its favour*; none found |
| Per-frame is worse *because of retransmit deferral* | **moderate** — mechanism is source-verified and predicts sign and magnitude, but was not directly instrumented | per-stream retransmit timing telemetry showing recovery is not deferred |
| Per-frame without FIFO is worst | **strong** — four campaigns, matches scheduler source | — |
| GSO cap worth 17 % | **strong** — externally corroborated | — |
| Initial window is not a lever | **strong** — two independent measurements | — |

### Limits that stand

- **n = 3 with a min/max non-overlap rule has a ~10 % false-positive rate per comparison.**
  The large effects (44–63 %) are far outside it. The small ones — cell L's 0.8 %, cell
  Wc's 1.9 % — are **not**, and must not be quoted as results.
- **Flow fairness against competing traffic is not measured at all** — the main BBR
  deployment risk. The queue-drop excess is a proxy, not a measurement.
- **Cell H is degenerate**: the harness caps in-flight at depth × frame size, making it a
  3.3 Mbps cell wearing a 40 Mbps label. Ignore it.
- **No real data anywhere.** Fixtures are one repeated byte; every trace is synthetic,
  including those written for this campaign.
- **The §1 controller figures were taken with a closed-loop reader**, so they remain
  underestimates of what a reader who keeps scrolling would see. The regime *ordering* they
  establish does not depend on reader mode, but their absolute values do — R6 measured p95
  rising 11–13× between the two modes on the same path.
- **The loss realisation can dominate the thing being compared.** In R6's X1 the seed alone
  moved one arm by 2.1× while the arm difference flipped sign. Any single-seed comparison at
  moderate loss is noise; this is why repeats resample loss rather than replaying it.
- **Handovers, variable bandwidth and variable RTT are unmodelled**
  ([`transport-assumption-audit.md`](transport-assumption-audit.md) A1–A3). For a mobile
  reader these plausibly dominate everything measured here.

---

## 6 · What to collect, in order of value

1. **Client RTT and loss timeseries from real sessions**, per access type. Settles the
   controller question outright, and A1–A3 with it.
2. **Real frame-size distributions and series lengths** per modality.
3. **Real reading traces** — actual scroll positions over time.
4. **Device memory budgets** for target tablets — sets the cache bound, the largest single
   determinant of the numbers above.

---

## 7 · How this document was reached

Four adversarial reviews, four sets of invalidated conclusions, and the same pattern every
time: **the rig quietly removed the condition under test**, and the result flattered
whichever arm had begun to look right.

- **Review 1** — the path was never congested; the harness re-asked frames already in
  flight (7.6–13.7× redundant load).
- **Review 2** — `p95` was computed over cache-hit zeros; a result that failed the
  project's own separation rule was reported as "strong"; the deployment-shaped experiment
  was omitted from the write-up entirely.
- **Review 3** — the queue *arithmetically could not drop* at the chosen depth and frame
  size, so the controller comparison was a test BBR could not lose; failed runs were
  deleted rather than voided, biasing the survivors.
- **Review 4, raised by the project owner and confirmed in source** — the reader is
  closed-loop, so head-of-line blocking could not occur and the **stream-shape
  recommendation was untestable on this rig**. It was withdrawn rather than softened, the
  reader was rebuilt open-loop, and the question was re-run as R6 (§2).
- **Review 5, on R6 itself** — the negative control failed for one arm of three. Fairness
  needs only concurrency, which every cell has, so N0 could not isolate it from head-of-line
  blocking. Recorded as a scope narrowing, with that arm's rows demoted, rather than the
  control being redefined after the fact.

Each guard added after a review caught the *previous* failure, never the next one. Three
practices are worth keeping.

1. **Make each regime prove itself with a counter before its numbers are read.** That is
   what finally settled the controller question.
2. **Check that the rig can still produce the effect being compared** — review 4's lesson.
   Three reviews' worth of guards all watched the measurement and none watched the
   mechanism. R6 makes this an explicit gate: `stranded_bytes == 0` voids a row, so a rig
   that has stopped generating the effect cannot report a comparison.
3. **Write down the prediction that would embarrass you.** R6 pre-registered P5, that
   fairness-on would *beat* FIFO under stranding — the opposite of what this project had
   published. It was falsified. Recording it in advance is what made it impossible to
   quietly drop, and the same discipline is what turned H4's falsification into the
   campaign's main finding rather than an inconvenience.
