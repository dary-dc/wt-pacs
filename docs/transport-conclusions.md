# Transport optimisation — conclusions

**2026-09-06.** The short answer, then the evidence. Method, hypotheses and decision rules
were fixed in advance in [`lanes/L4-preregistration.md`](lanes/L4-preregistration.md);
raw data in [`measurements/l4/`](measurements/l4/) and [`measurements/quic-opt/`](measurements/quic-opt/).

Target profile: **p95 time-to-displayable** first, **server density** second; browser
client over the public internet, indefinitely; possibly thousands of viewers.

---

## The answer

| decision | verdict | why |
| -------- | ------- | --- |
| **Congestion controller** | **Keep Cubic. Do not switch to BBR.** | Under real (congestive) loss BBR is 66 % worse at high RTT and never better. It only wins under injected loss on an uncongested path |
| **Stream shape** | **Shared stays — as the incumbent, not because it was shown better.** | The head-of-line question is **still unresolved**. See §2 |
| **Initial congestion window** | **Leave at quinn's default.** | ≤ 7 %, ranges overlapping. My earlier "largest lever" claim was wrong |
| **GSO segment cap 10 → 32** | **Do it — but it is a density change, not a latency one.** | +17 % throughput, −21 % CPU/byte. Zero effect on p95 (verified as a negative control) |
| **Chunked send path** | **Keep** (already the default on this branch) | −6…−14 % CPU/byte at every rate |
| **Flow-control windows** | **Set them.** Not for speed — for memory | quinn's defaults are per-connection ceilings tuned for one connection, not thousands |
| **Everything else** | Leave alone | ACK frequency, socket buffers, initial MTU, crypto provider: ≤ 3 % or nil |

**If you change one thing for p95: nothing in the transport.** See "What actually sets
p95" below. **If you change one thing for density: the GSO segment cap.**

---

## 1 · Congestion controller — the case that reversed twice

This is the only decision where the answer flipped, twice, and the flips are the finding.

### What the loss regime does to the answer

| regime | cells | Cubic | BBR | winner |
| ------ | ----- | ----- | --- | ------ |
| **Pure congestion** — queue overflow, no injected loss | E (150 ms, 10 Mbps) | **733 ms** | 1218 ms | **Cubic, +66 % separated** |
| | D (60 ms, 25 Mbps) | 272 ms | 292 ms | tie (overlap) |
| **Injected uniform loss, uncongested** | B, C | 342 / 1896 ms | 95 / 318 ms | BBR, −72 / −83 % |
| **Injected loss, clustered (burst 20)** | B, C | 53 / 175 ms | 52 / 180 ms | tie / Cubic |

**Read the first row, not the second.** The middle rows come from a rig defect: the three
original cells were specified with rate × RTT constant, so all had the same BDP
(187 500 B) and the client offered only 0.68 × BDP. **The bottleneck queue never built, so
no loss was congestive** — it was all injected and independent of what the sender did,
which makes a loss-blind controller optimal by construction. Cubic's numbers there
reproduce the Mathis formula; that cell measured an equation, not a network.

The E8 row is the corrected experiment: depth 16 = **2.7 × BDP**, zero injected loss,
`down_queue = 6161` overflow drops and `down_loss = 0` confirming every drop came from the
queue. There, BBR does what BBRv1 is known to do — it does not treat loss as congestion,
so it keeps the bottleneck queue full and raises its own latency.

**Cubic is also far steadier.** Spread of p95 across repeats: Cubic 1.04–1.40×, BBR
1.44–2.34×. For a p95 target, variance is the metric.

### And the external evidence points the same way

quinn ships **BBRv1** (`quinn-proto` marks it "Experimental! Use at your own risk"), which
is documented to take > 90 % of a shallow-buffer bottleneck from competing Cubic flows
(Jain's index ≈ 0.55) and to cause 100–200× more retransmissions. With thousands of
viewers sharing hospital uplinks, that is a hazard, not a footnote.

**When BBR *would* win:** a path whose loss is not congestive — wireless bit errors, a
lossy policer — *and* where the application does not fill the pipe. If client telemetry
ever shows loss uncorrelated with queueing delay, revisit. That is a measurement you can
make from real sessions; it is not guessable.

---

## 2 · Stream shape — still unresolved, and now I know why

**This section previously said "keep shared, strong evidence". That was wrong**, for a
reason worth stating: the trace it used was strictly sequential (0…79 then 79…0, one step
at a time), which is the one demand pattern where head-of-line blocking **cannot cost
anything by construction** — the frame the client wants next is always the next frame in
stream order. `CAMPAIGN_V2_ANALYSIS.md` already said exactly this: *"for ordered demand,
in-order delivery matches the request pattern; head-of-line blocking is alignment, not a
defect."*

Head-of-line only bites on a **reversal**: the client asked 40, 41, 42, 43, the reader
scrolls back, and frame 39 is queued behind three frames nobody wants any more.

### The proper test, twice, and it does not discriminate

`lab/traces/radiologist_read.json` — burst-scroll, pause, reverse; four reversals, 45 %
dwell time, 30 fps as a burst rate rather than a sustained demand. Cell W (5G/WiFi:
50 ms, 20 Mbps, 1 % loss in bursts of 5), n=4:

| frames | metric | shared | per-frame | per-frame + FIFO | verdict |
| ------ | ------ | ------ | --------- | ---------------- | ------- |
| 32 KB, depth 16 | p95 | 164 ms | 201 ms | 136 ms | **all overlap** |
| 250 KB, depth 8 | p95 | 2061 ms | 3325 ms | 2093 ms | **all overlap** |
| 250 KB, depth 8 | mean | 650 ms | 605 ms | 615 ms | **all overlap** |

The 250 KB cell is the maximum-stress case available: one frame is 100 ms of
serialisation, so a reversal strands ~0.8 s of stale data ahead of the wanted frame, and
p95 is ~2 s — the transport is unambiguously on the critical path. **Nothing separates.**

### What the numbers hint at, below the noise

At 250 KB, per-frame's **median** wait is 744 ms against shared's 1689 ms — less than
half — while its **p95** is worse (3325 vs 2061). That is the shape you would expect if
out-of-order arrival lets the wanted frame jump the queue while fair-sharing stretches the
tail. It is a coherent story and it is **not a result**: ranges overlap at n=4.

### Why this is hard to measure, which may be the real finding

With a realistic read pattern, a working client cache and a prefetch window, **only ~18 of
191 steps ever wait on the transport at all** at 32 KB. Stream shape cannot matter much
when the transport is rarely what the reader is waiting on. The question only becomes
live at large frame sizes, and there the variance swamps the effect.

### Position

**Shared stays because it is what ships and nothing displaced it — not because it won.**
Anyone reopening this needs n ≈ 20 per cell or a lower-variance rig, and should measure
median and tail separately, since the two appear to move in opposite directions.

One thing that *is* established, from the earlier uncongested campaign and consistent with
campaign v2: **per-frame without FIFO scheduling is the worst option** in every condition
measured. If per-frame is ever chosen, `send_fairness(false)` goes with it.

## 3 · Initial congestion window — my own claim, retracted

[`transport-optimization-spec.md`](transport-optimization-spec.md) §S1 called this "the
largest lever", predicting 2–5× from arithmetic: a 250 KB frame needs ~5 slow-start round
trips at IW10.

**Measured: ≤ 7 %, usually less, ranges mostly overlapping.** Directly:
IW 2400 → 240 000 at 150 ms RTT moved per-frame time 800 → 615 ms, i.e. **4.10 round trips
at a window that should have carried the whole frame in one.**

The arithmetic ignored that quinn paces (a large window becomes a rate, not a burst), that
the window restarts after idle, and that the ask costs a round trip the window cannot
touch. **§S1 is demoted.** Decision rule D1, fixed in advance, required exactly this.

---

## 4 · Density — separate metric, separate rig, unchanged conclusions

These come from the direct-loopback campaign
([`quic-transport-optimization.md`](quic-transport-optimization.md)) and are about CPU per
byte, not p95. The GSO cap was re-run here as a **negative control**: in an RTT-bound cell
it showed no effect (271–399 vs 274–275 ms, overlapping), which is what it must do and is
evidence the latency rig measures what it claims.

| item | effect | status |
| ---- | ------ | ------ |
| GSO segment cap 10 → 32 | +17.2 % throughput, −20.9 % CPU/byte | **best density lever**; upstream constant, add to quinn issue #2201 |
| Chunked send path | −6…−14 % CPU/byte at every rate | already default here |
| Per-frame prefault hop (warm) | costs 10 % throughput, 14–34 % CPU/byte | leave on — it is a safety decision; consider one hop per ask-batch |
| `aws-lc-rs`, ACK frequency, socket buffers, initial MTU | ≤ 3 % or nil | leave |

**Never set the GSO cap from `max_gso_segments()` directly.** The binding limit is bytes:
65 527 = 45 segments at a 1452-byte MTU. Exceeding it returns `EINVAL` and `quinn-udp`
then disables offload **permanently for that socket** — measured as a 91 % collapse.

---

## 5 · What actually sets p95, and it is not a transport knob

At 30 fps, 250 KB frames demand **~62 Mbps** — more than every deployment cell, including
50 Mbps broadband. No congestion controller, window or stream shape closes a 6× gap.

The levers that do move p95 are above the transport:

1. **Frame size / progressive delivery.** The slow-start round-trip count is a function of
   frame size. HTJ2K is progressive: a truncated resolution-ordered prefix is a viewable
   image, which makes first-displayable one round trip regardless of full-frame size.
2. **Ask window depth**, already decided in `adr-client-window-depth.md`.
3. **Cache hit rate.** In the easy cell, > 95 % of wants were already cached and *no* arm
   mattered — every one within ±5 % at 11–12 ms.

---

## 6 · Confidence, and what would change these answers

**T2 throughout** — one host, a userspace path simulator, no real network.

| conclusion | strength | what would overturn it |
| ---------- | -------- | ---------------------- |
| Keep Cubic | **strong** — corrected rig, congestion verified, n=4, ranges separated, matches known BBRv1 behaviour | client telemetry showing non-congestive loss |
| Keep shared stream | **none — unresolved.** Incumbent by default | n ≈ 20 per cell, or a lower-variance rig |
| Initial window is not a lever | **strong** — two independent measurements | — |
| GSO cap is worth 17 % | **strong** — corroborated by an independent thesis and upstream issue #2201 | — |
| Nothing matters on a clean path | **weak** — netsim's own 1.2 ms load-dependent latency is larger than the effect | a real network |

**Known limits of this work**, all recorded in
[`lanes/L4-preregistration.md`](lanes/L4-preregistration.md) §7:

- The first campaign (E12/E6) is **retained as data but must not be quoted as deployment
  guidance** — uncongested, exogenous-loss-only.
- Loss bursts are packet-counted, not time-bounded, so an outage lasts longer for a slower
  sender.
- The client re-asks frames it already holds, so arms transfer 3.7–9× redundant bytes and
  do not do equal work.
- MTU is unpinned across arms.
- Cell-A resolution is below the simulator's own noise floor.
- Fairness between competing flows — the main BBR risk — is **not measured at all**.
- The harness re-asked frames it already held until 2026-09-06, flooding its own link on
  any trace with a reversal (42× redundancy). Results from before that fix are not
  comparable with results after it.
- The controller conclusion was measured on **wired-style congestive loss**. The stated
  use case is 5G / satellite / WiFi, where loss is substantially **non-congestive** — the
  regime that favours BBR. Cells W and S exist for this and the controller answer should
  be re-taken in them before it is trusted for this deployment.
