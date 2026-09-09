# Assumption audit — what the transport work takes for granted, and what breaks

**2026-09-06. Analysis, not measurement.** Written before further empirical work, because
one assumption (loss is congestive) already invalidated a headline conclusion after it had
been measured, reviewed and written up. The purpose here is to find the rest of them
*first*.

Scope: every premise baked into `lab/`'s rigs, the harness, the fixtures, and the
conclusions in [`transport-conclusions.md`](transport-conclusions.md) — checked against
the stated target: **diagnostic imaging to browsers on tablets and phones over 5G,
satellite and WiFi**, three stream-based candidates, p95 time-to-displayable first.

---

## How this list was built

For each component of the rig I asked: *what does this hold constant that the real system
does not?* Then: *if it varied the way it really varies, could the ranking change?* Only
assumptions that can flip a ranking are listed. "Severity" is how much of the current
conclusions they would invalidate, not how wrong they are.

---

## The audit

| # | assumption in the work | reality for this use case | if wrong | severity |
| - | ---------------------- | ------------------------- | -------- | -------- |
| **A1** | **Bandwidth is constant** (`netsim` is a fixed token bucket) | 5G/WiFi capacity swings by 10× in seconds — signal, contention, handover. Satellite varies with weather and elevation | Controller ranking is about *tracking a moving bottleneck*, which is the single thing BBR and Cubic differ on most. Untested for either | **critical** |
| **A2** | **RTT is stable** (fixed delay ± uniform jitter) | Cellular RTT swings 30→300 ms with scheduling and buffering; WiFi with contention; satellite has fixed high RTT plus handoffs | Breaks every RTT-based estimator: BBR's RTprop, quinn's RTO, and the client's own `D = ceil(U(1+RTT/Tf))` window formula | **critical** |
| **A3** | **No outages** — loss is per-packet | Cellular handover blacks out 100 ms–2 s. Satellite fades. WiFi roaming | p95 would be dominated by outage recovery, not by steady-state behaviour. Every current conclusion optimises the wrong term | **critical** |
| **A4** | **Client cache never evicts** (`HashSet<u32>`, insert-only) | A tablet browser has bounded memory; a 500-frame CT series at 250 KB is 125 MB | My finding *"only 18 of 191 steps wait on the transport"* depends entirely on an unbounded cache. With eviction the transport is on the critical path far more often — and stream shape may start to matter | **critical** |
| **A5** | **Fixed stream number was never tested** | It is one of the three candidates under consideration | A whole candidate is missing from every comparison, and theory says it may dominate both tested arms (§2) | **critical** |
| **A6** | **All frames are identical in size** (fixtures are constant 32 KB / 250 KB) | HTJ2K frame size varies with content; slice-to-slice variation is large | Changes queueing, the window formula, and how much a reversal strands. A uniform-size rig cannot show head-of-line variance caused by a big frame in front | high |
| **A7** | **Buffer is 500-packet drop-tail** | 5G has very deep buffers (bufferbloat); modern APs and ISPs increasingly run AQM (fq_codel/CoDel); satellite buffers are huge | Buffer depth and AQM policy are *the* variables in a loss- vs rate-based comparison. Drop-tail at one depth is a single point in a space that decides the answer | high |
| **A8** | **One flow owns the bottleneck** | Hospital uplinks and home WiFi carry other traffic; several viewers may share | BBR's documented unfairness (>90 % of a shallow-buffer link, Jain ≈ 0.55) never appears in a single-flow rig. This is the main deployment risk and is unmeasured | high |
| **A9** | **Connection is already established** — measurement starts after handshake | User-visible latency starts at click: DNS, QUIC handshake, WebTransport session, certificate validation. At 600 ms satellite RTT that is seconds | The stated goal is "minimal latency"; the metric currently excludes the part of it a user notices most on first open | high |
| **A10** | **Server study is warm in page cache** | Thousands of studies, cold storage, real disks | The prefault/disk work covers this, but the latency campaign never combined cold storage with a slow link | medium |
| **A11** | **Uplink is free** — asks are assumed to cost nothing | Cellular uplink is asymmetric, slower and lossier. An ask lost on the uplink costs a full RTO before the frame is even requested | Ask-path loss adds directly to time-to-displayable and is invisible in the current model | medium |
| **A12** | **No ECN** | Modern paths mark rather than drop; quinn supports ECN | Changes the congestion signal entirely, which changes the controller comparison | medium |
| **A13** | **Frames are opaque and atomic** | HTJ2K is progressive: a truncated prefix is a viewable lower-resolution image | If partial frames are displayable, "time-to-displayable" is a different quantity and the stream-shape question changes shape with it | medium |
| **A14** | **p95 is the right metric** | A reader may care more about *stutter* — consistency during a scroll — than about a tail percentile | Optimising p95 can be the wrong target; variance may matter more than the tail | medium |
| **A15** | **80-frame series** | Real CT/MR series run to hundreds or thousands of slices | Window depth, cache pressure and prefetch strategy all scale with series length | medium |
| **A16** | **Synthetic incompressible frames** (fixtures are `0xAB` repeated) | Real codestreams have real entropy | Only matters if anything downstream compresses; currently nothing does. Listed for completeness | low |

~~**A1–A5 are the ones that can invalidate the current conclusions.**~~ **Wrong — see §7.**
That sentence presupposed the conclusions were sound in their own regime and only a
different regime could overturn them. In fact four of them fail on their own data, and
three assumptions that implicate the *harness* rather than the world were missing from
this table entirely. Severity corrections in §7.5; missing entries in §7.3.

---

## 1 · The three assumptions that mirror the loss mistake

The congestive-loss error had a shape: *the rig held constant something the real network
varies, and the thing it held constant was exactly the thing the candidates differ on.*
Three assumptions have that same shape.

### A1 · Constant bandwidth

Cubic and BBR differ most in **how they track a bottleneck that moves**. Cubic probes by
growing until loss; BBR estimates delivery rate and paces to it. On a fixed-rate link both
converge and the comparison is about steady state — which is what I measured, twice, and
got opposite answers from depending on the loss model.

On a link whose capacity halves and doubles every few seconds — the defining property of
5G and WiFi — the question becomes *how fast does it re-converge, and what does it do
during the transient?* **Neither controller has been tested on a moving bottleneck here.**

> **Thesis T1.** On a variable-capacity link, ranking is determined by re-convergence
> behaviour after a capacity change, not by steady-state throughput. A controller that
> wins at constant rate may lose when rate steps.

### A2 · Stable RTT

Two things break when RTT is noisy, and both are in this system:

- **BBR's RTprop.** ~~A windowed minimum that can latch onto a stale minimum under
  persistent queueing.~~ **Wrong for this stack, and backwards** — see §7. quinn's
  `RttEstimator.min` is a *lifetime* monotone minimum, never decayed, and `Bbr::min_rtt`
  refreshes only on a 10-second timer gated on `!app_limited`. So the real failure is the
  opposite: when true propagation delay *rises* — handover, satellite elevation — quinn's
  BBR keeps a permanently too-small RTprop and under-shoots. On a trace with 44 % dwell it
  is frequently app-limited, so `ProbeRtt` may never run.
- **The client's own window formula** — `D = ceil(U × (1 + RTT/Tf))` from
  `L2-ask-policy.md` — takes a *median of the last 8* RTT samples. On a link where RTT
  swings 30→300 ms, that median is a lagging estimate of a quantity that has already
  changed, so the window is chronically wrong in one direction or the other.

> **Thesis T2.** Under wireless RTT variance, the ask-window estimator is a larger source
> of p95 than the congestion controller, because it mis-sizes the pipeline for seconds at
> a time while the controller re-converges in round trips.

### A3 · No outages

A cellular handover is not loss, it is a **gap**: 100 ms to 2 s of nothing, then
resumption. Every current arm was measured on a link that never stops.

This matters more than steady-state loss for a p95 metric: one 1.5 s handover in a 60 s
read *is* the p95. And the arms behave very differently across a gap — a loss-based
controller sees a burst of loss and collapses its window; a rate-based one sees delivery
rate go to zero; per-frame streams have N outstanding streams to recover rather than one.

> **Thesis T3.** For a mobile reader, p95 time-to-displayable is set by outage recovery
> behaviour, and the ranking under outages is not predicted by the ranking under
> steady-state loss.

### A4 · Unbounded client cache

This one directly undermines a finding I already reported. I observed that with a working
cache only ~18 of 191 steps ever wait on the transport, and concluded that stream shape
cannot matter much. **That conclusion is an artefact of a cache that never evicts.**

A 500-slice CT series at 250 KB is 125 MB. A tablet browser will evict. With eviction, a
reader scrolling back into evicted territory re-fetches — which is exactly the reversal
case where head-of-line blocking bites, and exactly the case my rig made impossible.

> ~~**Thesis T4.** Head-of-line blocking is unmeasurable with an unbounded cache…~~
> **Right symptom, wrong cause — see §7.3.** `window_frames` is *symmetric*
> (`center ± k`), so with `max_step: 1` a reversal is always already inside the window
> emitted before the reader got there. Bounding the cache does not create the missing
> event; a **jump-bearing trace** (displacement > D/2) does. The project already knew this:
> `adr-reject-server-cancel.md` lists "jump affordance in the UI — traces with
> `max_step = 1` cannot show that workload" as a flip condition.

---

## 2 · The missing candidate: fixed stream number

Three candidates are under consideration; **only two have ever been measured.**

| candidate | head-of-line coupling | bandwidth dilution | streams to recover after an outage |
| --------- | --------------------- | ------------------ | ---------------------------------- |
| **Shared (1 stream)** | total — one loss stalls every frame behind it | none | 1 |
| **Per-frame (D streams)** | none — each frame independent | worst — QUIC fair-shares across all D, so all finish late | D |
| **Fixed N (pool of N)** | **1/N** — a loss stalls only frames sharing that stream | **bounded to N-way**, independent of window depth | N |

The pool is not a compromise for its own sake; it is the only one of the three whose
coupling and dilution are **decoupled from the ask-window depth**. Shared and per-frame
both tie their behaviour to `D`, which the client varies at runtime.

> **Thesis T5 — retracted, then UN-retracted (2026-09-06).** §7.4 rejected it on the
> grounds that an N-pool is byte-identical to shared under `send_fairness(false)`. A third
> review showed that argument is false: `retransmit()` re-queues a stream to the **back**
> of its priority class regardless of the fairness setting
> (`quinn-proto` `streams/state.rs:677`), so under loss a per-frame stream awaiting
> retransmission waits behind every other stream's backlog while a shared stream
> retransmits ahead of newer data. Two opposing monotone effects in N — receive-side
> isolation improving, send-side retransmit deferral worsening — is exactly the structure
> that yields an interior optimum. **T5 stands.** Fixed-N is not dominated; it is simply
> not needed, because nothing beat shared. See `transport-conclusions.md` §2.
>
> **Thesis T5 (as written, superseded).** There is an interior optimum in N. At N=1 the arm is shared and pays full
> head-of-line coupling; at N=D it is per-frame and pays full dilution. Somewhere between,
> a small N (2–4) captures most of the decoupling for a small fraction of the dilution.
>
> **Prediction P5.** The optimal N rises with loss rate (more decoupling needed) and falls
> with window depth (more dilution to avoid). At zero loss, N=1 is optimal — which is a
> falsifiable and cheap control.

Note that `send_fairness(false)` interacts here: with FIFO scheduling, dilution is
suppressed for *any* N, which may flatten the curve and make the choice of N unimportant.
That is worth knowing either way, and it is one flag.

---

## 3 · Assumptions the *prior* campaigns carry, which I inherited

Not mine, but they propagate into anything built on them:

- **`adr-client-window-depth.md`** derives `D` as "minimum depth that saturates the link".
  That is a **throughput** criterion used to set a knob whose purpose is **latency**. On a
  variable link the minimum-saturating depth is a moving target, and the ADR's own
  decision driver ("minimise time from wants to first byte") is not what the formula
  optimises.
- **`adr-reject-server-cancel.md`** rejected cancel partly on a sweep the ADR itself
  admits ran at D≈1 with three unique frames. Cancel is exactly the mechanism that would
  help a reversal on a *bounded* cache, which is the case A4 says was never tested.
- **The stream-mode campaigns** all measured throughput or link utilisation, then had
  their conclusions read as latency guidance. The metric mismatch is noted in the v2
  analysis and was never closed.

---

## 4 · Proposed order of work

Cheap and decisive first; nothing here needs a real network.

| step | what | why first | cost |
| ---- | ---- | --------- | ---- |
| **1** | Add **bounded cache** to the harness (LRU, size in MB) | A4 gates the entire stream-shape question | small |
| **2** | Add **fixed-N stream pool** as a third arm | A5 — a candidate is missing | small–medium |
| **3** | Add **variable bandwidth, variable RTT and outage events** to `netsim` | A1–A3, the wireless regime itself | medium |
| **4** | Re-run **stream shape** (1 / N / per-frame × fairness) with 1+2 | the actual question | medium |
| **5** | Re-run **controller** in the wireless regime with 3 | the conclusion currently most likely to be wrong | medium |
| **6** | **Real study fixtures** — real frame-size distribution and series length | A6, A15; and the current fixtures are literally `0xAB` repeated | needs data |
| **7** | Multi-flow fairness | A8 — the main BBR deployment risk | medium |
| **8** | Cold-start / session establishment | A9 — the user-visible part currently excluded | small |

Steps 1–2 are prerequisites, not experiments: without them, step 4 measures a rig.

---

## 5 · What real data would be worth most

If a data collection is possible, in descending order of value per unit of effort:

1. **Client-side RTT and loss traces from real sessions** on 5G / WiFi / satellite —
   ideally a timeseries, not an average. This settles A1, A2, A3 and the congestive-vs-
   random question in one stroke, and it is the single input that most changes the answers.
2. **Real frame-size distributions** per modality (CT, MR, US cine) and typical series
   lengths. Settles A6 and A15 and makes the fixtures honest.
3. **Real reading traces** — actual scroll positions over time from a viewer session.
   Every trace in `lab/traces/` is synthetic and hand-designed, including mine.
4. **Device memory budgets** for the target tablets. Sets the cache bound in step 1.

Items 1 and 3 are the ones that would let this stop guessing.

---

## 6 · Standing rule

This document exists because a reviewed, measured, written-up conclusion was invalidated
by an unexamined premise. **Every future conclusion in this lane gets an adversarial
review before it is written up, and the review is given this list to check against.**

---

## 7 · Adversarial review of this audit — it did not survive

Reviewed by an independent agent given the audit, the conclusions, the pre-registration,
the rig source and quinn-proto. Findings re-verified before acceptance. The audit was
supposed to catch premises that invalidate conclusions; it missed several, and it missed
them in a pattern.

### 7.1 · Four errors in `transport-conclusions.md` the audit failed to catch

All four verified directly; all four are now corrected in that document's banner.

1. **The "Keep Cubic" verdict never passed the lane's own non-overlap rule** — the
   analyser prints `overlap` for both congestive cells. It was rated "strong … ranges
   separated", and the quoted numbers are not reproducible from the committed TSV.
2. **`e7_congested_plus_exogenous.tsv` — the only deployment-shaped cell — is cited zero
   times**, and shows Cubic **9× worse, 4/4 separated**.
3. **`nz_p50` separates 4/4 in per-frame's favour** (549–839 vs 1525–1930 ms) and was
   reported as "ranges overlap — not a result".
4. **Three rows with `p95 = 0`** — pre-registered stop condition 1 — were quoted as
   results without voiding.

### 7.2 · The audit picked the wrong side of its own best idea

The audit's instinct was right — the congestive/non-congestive axis is where this work
keeps failing — but it accepted that the uncongested regime was a **rig defect to be
voided**. Mathis at 1 % loss says otherwise:

| target cell | Cubic's ceiling | as % of link |
| ----------- | --------------- | ------------ |
| 5G / WiFi, 50 ms, 20 Mbps | 2.85 Mbps | **14 %** |
| GEO satellite, 600 ms, 8 Mbps | 0.24 Mbps | **3 %** |

**Cubic cannot congest the target links.** The uncongested, exogenous-loss regime *is* this
deployment's operating point, so the campaign that was voided was measuring the right
thing and the "correction" moved away from it.

### 7.3 · Missing assumptions, and the pattern in what was missing

The three that implicate the **harness** were the three absent:

- **In-flight ask redundancy.** `emit_window` re-asked frames already in flight on every
  step: **7.6–13.7×** redundant load, arm-dependent and self-reinforcing. Fixed 2026-09-06.
- **The reader is closed-loop.** `run_windowed` blocks until the cursor frame arrives, so
  `wall_s` runs 20× the trace's nominal duration and the reader can never get ahead of the
  transport — making stale-data-ahead-of-a-want impossible by construction.
- **`window_frames` is symmetric** (`center ± k`), so with `max_step: 1` a reversal is
  always already inside the emitted window. **This, not cache eviction, is why no trace in
  the repo can produce a head-of-line miss.** Thesis T4 named the wrong cause, and step 1
  of the work order (bounded cache) is therefore **not** the prerequisite claimed — the
  real prerequisite is a **jump-bearing trace** (displacement > D/2).

Also missing: per-stream flow control differs *between* the stream-shape arms by
construction (shared is capped at one 1.25 MB stream window; per-frame gets D of them);
effective buffer depth varies 0.71–5.31 BDP across cells, uncontrolled and unrecorded;
`rate × RTT` is *still* constant in the "corrected" cells D and E; the loss-burst setting
is not recorded in any output row; stop condition 4 remains unimplemented; and e7/e8/e9
have no committed campaign script.

### 7.4 · T5 does not hold

With `send_fairness(false)` — the configuration the project has already chosen for any
per-frame design — quinn drains streams in the order they became pending, and the server
loop is strictly serial, so pending order *is* ask order and an N-pool is **byte-identical
to the shared stream** for every N. The interior optimum exists only under fairness=true,
which is the arm already known to be worst. **A5 is downgraded from critical to medium.**
P5's zero-loss control is also non-diagnostic: it passes whether T5 is true or false.

The audit's "1/N head-of-line coupling" and "streams to recover after an outage" columns
are also wrong: loss detection, congestion control and pacing are connection-wide in QUIC,
so stream count does not change recovery cost — and per-frame has an outage hazard shared
does not, since `open_uni()` blocks on MAX_STREAMS until FINs are acknowledged.

### 7.5 · Severity corrections

`A7` buffer depth → **critical** (it is the parameter deciding Cubic vs BBR, and it varies
7.5× across cells uncontrolled). `A11` uplink → **critical for satellite** (a lost ask
costs a PTO before the frame is requested; quinn's `initial_rtt` is 333 ms). `A13`
progressive frames → **critical** (if a truncated prefix is displayable, it dissolves the
stream-shape, frame-size and initial-window questions at once). `A14` → **critical**: the
metric is not merely arguable, it is broken — `p95_wait_ms` includes cache-hit zeros, so
it is the ~76th percentile at 250 KB and roughly the median at 32 KB.

### 7.6 · Work-order corrections

Step 0 is a **jump-bearing trace** plus the re-ask fix. **Swap steps 4 and 5** — stream
shape is currently scheduled before the controller is re-taken, but in cell W Cubic
delivers ~14 % of the link, so every stream-shape arm was measured through a crippled
controller. Bounded cache is demoted from prerequisite to ordinary experiment.

### 7.7 · What survived

One claim: **per-frame without `send_fairness(false)` is the worst option in every
condition measured** — 4/4 separated in both cells and both loss regimes, consistent with
quinn's actual scheduler, and the known defects all push toward *reducing* separation
rather than manufacturing it.
