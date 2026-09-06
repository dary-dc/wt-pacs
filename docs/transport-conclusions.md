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
| **Stream shape** | **Keep one shared stream.** | Per-frame is 25–67 % worse. Per-frame + `send_fairness(false)` only ties. The pre-registered bar was not met |
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

## 2 · Stream shape — the question three campaigns failed to answer

Measured at 0.5 % and 2 % loss, under both uniform and clustered loss:

| condition | per-frame | per-frame + `send_fairness(false)` |
| --------- | --------- | ---------------------------------- |
| 60 ms, uniform | +25 % worse *(separated)* | −1.9 % *(tie)* |
| 60 ms, clustered | +67 % worse *(separated)* | +0.5 % *(tie)* |
| 150 ms, uniform | +51 % worse *(separated)* | +2.6 % *(tie)* |
| 150 ms, clustered | +56 % worse *(separated)* | **−39 % better *(separated)*** |

**Per-frame without FIFO scheduling loses cleanly in every condition**, confirming
campaign v2's mechanism: concurrent streams fair-share bandwidth, so all of them finish
late. `send_fairness(false)` — one connection-level flag — recovers that deficit
completely, and is cheaper than the per-stream `set_priority` bookkeeping campaign v2
proposed.

**Decision rule D3 required per-frame to beat shared by > 15 % at 0.5 % loss. It does
not.** Shared stays. The −39 % at 150 ms with clustered loss is a real, separated result
and the one lead worth following, but it was not the pre-registered condition, so it is a
lead and not a decision.

Caveat: E3 ran at depth 4, i.e. the same 0.68 × BDP uncongested path as §1's middle rows.
The per-frame vs shared mechanism is about scheduling *between* streams and is not obviously
BDP-sensitive, but this should be re-run congested before the −39 % is acted on.

---

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
| Keep shared stream | **strong for per-frame**, **moderate for FIFO** | re-running E3 congested; the 150 ms clustered-loss cell |
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
