# Transport optimisation — conclusions

**2026-09-06.** Method, hypotheses and decision rules fixed in advance in
[`lanes/L4-preregistration.md`](lanes/L4-preregistration.md). Raw data in
[`measurements/l4/`](measurements/l4/) — **R-series only**; the e-series is superseded and
marked so in that directory's README. Three adversarial reviews; each found
conclusion-invalidating defects, and each is recorded rather than absorbed (§7).

Target: **p95 time-to-displayable** first, **server density** second. Browser client on
tablets and phones over **5G, satellite and WiFi**. Three stream-based candidates.

---

## The answer

| decision | verdict |
| -------- | ------- |
| **Congestion controller** | **Two opposite answers, depending on which kind of loss your links have.** Congestive → **Cubic**. Radio/exogenous → **BBR**. Both directions large and separated. **Default to Cubic** until the mix is measured (§1) |
| **Stream shape** | **Open — the rig could not produce the condition that decides it.** Nothing displaced the incumbent shared stream, but the client never let the transport fall behind, so head-of-line blocking was never generated (§2). Per-frame *without* `send_fairness(false)` is the one shape measured worse, repeatedly |
| **Fixed-N pool** | **Untested, and untestable under this lane's constraint** — a pool is a server-side change and this lane may not modify `server/`. An earlier claim that it was strictly dominated was wrong (§2) |
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

## 2 · Stream shape — **not decided.** The rig removed the deciding condition

This is the question the lane was built to answer, and it is the one question it did not
answer. The measurements below are real; what they measure is not the thing that decides.

| condition | shared | per-frame | per-frame + FIFO |
| --------- | ------ | --------- | ---------------- |
| 5G, under BBR | 263 ms | 263 ms *(overlap)* | 259 ms *(overlap)* |
| 5G, under Cubic | 454 ms | 820 ms *(worse, separated)* | 545 ms *(overlap)* |
| Satellite, under BBR | 1202 ms | 1255 ms *(worse, separated)* | 1120 ms *(overlap)* |

### Why these rows cannot settle it

A shared stream is worse than per-frame streams **only when the reader is stuck behind
bytes it no longer wants** — one lost packet holding up delivery of everything queued
behind it in the same stream. That requires the transport to fall behind the reader.

**The harness client makes that impossible.** `run_windowed` walks the trace like this:

```
for each cursor:  sleep(step_interval) → emit_window(±D/2 around cursor) → wait_displayable(cursor)
                                                                          ^^^^^^^^^^^^^^^^^^^^^^^^
                                                                          blocks until it arrives
```

followed by `wait_outstanding_below(D)`, which blocks again. The reader therefore advances
**at the speed of the transport**, never faster. In-flight data is always data it still
wants, because it refuses to move on until that data lands. Head-of-line blocking has no
opportunity to occur, and a second-order effect — `window_frames` emits
`center, +1, −1, +2, −2…`, so with `max_step: 1` a reversal is always already prefetched —
suppresses what little remains.

So every row above is a measurement of a rig in which **the mechanism under test was
switched off**, and the correct reading is not "shared wins" but **"no shape was
distinguishable, because nothing was being distinguished."** This is the same failure the
three earlier reviews found three times (§7): the rig quietly removed the condition under
test. It is recorded here rather than corrected in place, because an earlier draft of this
document did print "Keep one shared stream", and that claim exceeded its evidence.

**A real server does not fix this.** The defect is in the client, so it would reproduce
unchanged over any network.

### What does survive

**Per-frame without `send_fairness(false)` is consistently worse** — four campaigns, and it
matches the scheduler source: with fairness on, N concurrent streams round-robin and every
frame finishes late; `reinsert_pending` (fairness off) drains a stream to completion before
the next, and this server's session loop is serial, so pending order is ask order.
`quinn-proto/src/connection/streams/state.rs:592-597`.

That is a claim about **fairness**, not about shape, and it holds regardless of the above.
If per-frame is ever adopted, `send_fairness(false)` is a precondition.

### Fixed-N is untested, and an earlier claim about it was wrong

An earlier draft argued a pool was strictly dominated because all three shapes are
byte-identical under FIFO. **That is false.** `retransmit()` re-queues a stream to the
**back** of its priority class regardless of the fairness setting (`state.rs:677`), so
under loss a per-frame stream awaiting retransmission waits behind every other stream's
backlog, while a shared stream retransmits ahead of newer data. Two opposing effects in N —
receive-side isolation improving, send-side retransmit deferral worsening — is exactly the
structure that produces an interior optimum, so a pool *could* beat both endpoints.

It remains **unmeasured**: stream shape is chosen in `server/src/transport/server.rs`, and
this lane is constrained not to modify `server/`. Adding a pool arm requires lifting that
constraint.

### What would settle it

Named here so the next attempt is not improvised:

1. **An open-loop reader** — advance on the trace's wall clock, not on arrival, so the
   transport can fall behind and the reader can be stuck behind data it no longer wants.
2. **A depth gate that caps in-flight asks without stalling the reader**, so the arms are
   not silently serialised into identical behaviour.
3. **Wants that go unmet must be counted, not dropped** — otherwise an arm that fails to
   deliver loses its slow samples and wins on p95 by delivering less.
4. **Loss on the path**, so receiver-side head-of-line blocking has something to block on.

Progress against this list is tracked in [`lanes/L4-preregistration.md`](lanes/L4-preregistration.md) §8.

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

## 4 · What actually sets p95, and it is not a transport knob

With a realistic read, a prefetch window and a working cache, **only ~8 % of steps ever
wait on the transport**; the rest are cache hits. The levers above the transport dominate:

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
| Keep shared stream | **withdrawn** — the rig suppressed head-of-line blocking by construction (§2) | not supported at any strength; needs re-measuring with an open-loop reader |
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
- **The reader is closed-loop**, so the transport can never fall behind it. This voids the
  stream-shape comparison outright (§2) and makes every absolute millisecond figure in this
  document an underestimate of what a reader who keeps scrolling would see.
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
  recommendation was untestable on this rig**. It is withdrawn above rather than softened.

Each guard added after a review caught the *previous* failure, never the next one. Two
practices are worth keeping. The first: run opposing regimes side by side and **make each
prove itself with a counter before its numbers are read** — that is what finally settled
the controller question. The second, from review 4: before trusting any comparison, **check
that the rig can still produce the effect being compared**. Three reviews' worth of guards
all watched the measurement and none of them watched the mechanism.
