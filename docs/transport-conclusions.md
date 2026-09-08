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
| **Stream shape** | **Keep one shared stream — and the binary now defaults to it (§2.7).** In simulation, per-frame is 3.5× worse at 64 KB and 8.5× worse at 250 KB. On a **real network** the 64 KB cell is noise-dominated and does not separate (§2.6), but **the 250 KB cell does: per-frame is 5.76× worse, separated 3/3, and the absolute penalty the mechanism predicts reproduces to within 1.6 % of the simulator** (§2.6a). At the frame size this product ships, the recommendation is a **measured property of the transport on real hardware**, not a simulator result. No cell on either rig separates in per-frame's favour |
| **Fixed-N pool** | **Still untested** — a server-side change. (The "this lane may not modify `server/`" constraint this row used to cite has not held since the transport-knob work: eight server files are modified on this branch.) R6 makes it *less* promising: the retransmit-deferral cost grows with N, and the winning endpoint is N = 1 (§2) |
| **Initial congestion window** | Leave at quinn's default — ≤ 7 %, ranges overlapping |
| **GSO segment cap 10 → 32** | Worth doing, but it is **density, not latency**: +17 % throughput, −21 % CPU/byte, **zero** effect on p95. **Not confirmed on real hardware** — on the rig the path, not the send path, is the ceiling ([`measurements/r6/r6cloud-results.md`](measurements/r6/r6cloud-results.md) §4.2) |
| **Chunked send path** | Keep. −6…−14 % CPU/byte at every rate |
| **Flow-control windows** | **Depends on the send path, which matters more than the windows do.** On `chunked` + shared (this branch's defaults) a client that asks for 25 MB and stops reading costs **180 kB** — hygiene only. On `copy`/`split` + per-frame the same client costs **6.8 MB, 68 % of the 10 MB `send_window`**, and bounding is worth it for the original reason (§3.1) |

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
| **600 ms, 8 Mbps** | **941 ms** *(n = 3)* | **1535 ms** *(**n = 2**, +63 %, separated)* | 218 → 9 128 |

> **The 600 ms row is n = 2 for BBR, and that was undisclosed until 2026-09-07.** Run 2 of
> the BBR arm produced no JSON (`VOID:no-data` in
> [`measurements/l4/r5a_congestive.tsv`](measurements/l4/r5a_congestive.tsv)), so 1535 ms is
> the median of two repeats against Cubic's three. The figures are `nz_p95` — waits over
> non-zero samples — which is the column an adversarial review found the analyser did not
> then report; it reports both columns now, and prints `n` per arm precisely so this cannot
> recur. Reproduce with:
>
> ```bash
> python3 lab/scripts/l4_analyse.py docs/measurements/l4/r5a_congestive.tsv --congestive
> ```
>
> **The direction survives the disclosure and the separation is clean**: Cubic's *worst*
> repeat beats BBR's *best* on both columns (946 vs 1459 on `nz_p95`; 672 vs 972 on
> `p95_wait_ms`). What n = 2 costs is the precision of "+63 %" — the same comparison on
> `p95_wait_ms` is +45 % — not the ordering. **Re-running the missing repeat is the one
> outstanding fix to this section**, and it must happen on the rig that produced runs 1 and
> 3; a replacement measured on different hardware would not be comparable. That rig was an
> ephemeral agent sandbox and is probably gone, which may make the single repeat
> unobtainable and the honest alternatives a whole-cell re-run or leaving this disclosure
> standing — see [`HANDOFF.md`](HANDOFF.md) §4.4a item 1.

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

### 1.1 · The neighbour cost is no longer a citation — it is measured

That last sentence was carried from quinn's own documentation and had never been tested
here. It has now been measured on the Oracle rig: two flows, one shared 5 Mbps bottleneck,
and the buffer depth varied deliberately, because BBRv1's pathology is specific to shallow
buffers. Data: [`measurements/r6/r6cloud_fairness.tsv`](measurements/r6/r6cloud_fairness.tsv);
method and controls: [`measurements/r6/r6cloud-results.md`](measurements/r6/r6cloud-results.md) §4.1.

| bottleneck buffer | our flow | competing TCP Cubic flow | our share |
| --- | --- | --- | --- |
| **shallow, ≈48 ms** | **QUIC BBR** | **0.03 Mbps** | **99.4 %** |
| shallow, ≈48 ms | QUIC Cubic | 1.46 Mbps | 70.0 % |
| deep, ≈1.2 s | QUIC BBR | 2.12 Mbps | 55.1 % |
| deep, ≈1.2 s | QUIC Cubic | 1.07 Mbps | 76.8 % |

The same TCP flow takes **4.5 Mbps** when it runs alone against the same shallow bottleneck,
so the 0.03 Mbps figure is starvation — a **150× reduction** — and not a handicapped
competitor.

**This strengthens "default to Cubic" and gives it a number.** In a shallow buffer, which is
what an access link has, BBR does not merely take more than its share: it takes essentially
all of it. In a deep buffer BBR is the better-behaved of the two. Two further notes, both
uncomfortable and both kept:

- **Cubic is not innocent.** QUIC-with-Cubic still takes 70–77 % from a TCP flow that can
  take 90 % alone. Some of the unfairness is ours regardless of controller.
- **BBR's own 48 % latency win still stands** (§1). The case for Cubic is a case about
  people who are not our users.

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
chosen so the demand/achievable ratio (0.64 vs 0.66) and the measured stranding (33/50/36 at
64 KB against 33–35 at 250 KB — the 64 KB side spans more than the original "33 vs 33–35"
suggested, D5
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
establishes is that **nothing reverses for per-frame + FIFO**: no trace, cell or repeat in
R6 favours it. `perframe_fair` beats `shared` in X3S run 3 (905.9 vs 965.1 ms) — one repeat,
overlapping ranges, stated rather than rounded away (D4).

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

### 2.6 · **Amended by the real-path campaign — the 3.5× does not reproduce**

Everything above §2.6 was measured through `lab/netsim`, a userspace path simulator on one
host. R6 was subsequently repeated against the Oracle rig over a real internet path shaped
by `sch_netem`, which is what
[`measurements/r6/oracle-runbook.md`](measurements/r6/oracle-runbook.md) was written for.
Full results, gates and adversarial review:
[`measurements/r6/r6cloud-results.md`](measurements/r6/r6cloud-results.md).

**Three cells of four agree. The cell carrying the conclusion does not.**

| cell | netsim | real path |
| --- | --- | --- |
| N0 (control) | tie −0.1 % | tie +0.8 % — **the gate passes**, the rig adds no artifact |
| X2 (stranding, no loss) | tie +2 % | tie −2.3 % |
| X1 (0.1 % loss) | tie | tie −5.1 % |
| **X3 (1 % loss)** | **shared wins +250 %, separated 3/3** | **not a result**: +266 %, +38 %, **−52 %** across repeats |

In X3 on the real path the **loss realisation moves `shared` alone by 4.32×** (84.7 →
365.8 ms) while the arm difference flips sign — exactly the regime §2's own "Why X1 is a tie"
subsection describes, now reaching the 1 % cell as well.

**Why the null is weak evidence against the mechanism — a power argument, not an excuse.**

The effect this cell is looking for is netsim's 3.5×. The realisation noise on the real path
is **4.32×**. The signal is smaller than the noise, so a null here is close to uninformative
about the mechanism: this cell could not have detected the simulator's own effect at n = 3
even if it were exactly right.

That has a constructive consequence. The mechanism predicts — and netsim confirms — that the
penalty **grows with frame size**: 8.5× at 250 KB against 3.5× at 64 KB. An **8.5× effect is
comfortably larger than a 4.3× noise floor**, whereas a 3.5× one is not. So the real-path
test with the power to succeed was **X3L on the rig**. It was run on 2026-09-07 and it
separated — see **§2.6a**, which supersedes the "unconfirmed on real hardware" reading this
section carried until then.

**What this changes, and what it does not.**

- The recommendation is unchanged: **keep one shared stream.** No cell, arm or repeat on
  either rig separates in per-frame's favour. At the level of individual repeats the picture
  is less absolute than this document once claimed: `perframe_fifo` has the lower p95 in 8 of
  12 paired real-path comparisons, and `perframe_fair` beats `shared` in X3S run 3. None of it
  separates, so none of it is a result — but "ties" and "nothing favours per-frame" are
  different sentences, and only the first is true (D4).
- At 64 KB its *real-path* support is four ties. "Per-frame is 3.5× worse at 1 % loss **at
  64 KB**" remains a simulator result a real path could not resolve, and should still be
  quoted as such. The 250 KB claim is no longer in that position (§2.6a).
- **P5 lost again.** `send_fairness(true)` is worse than FIFO in all twelve real-path
  repeat-level comparisons, on a rig sharing no code with the first. That finding is now
  replicated and is the strongest thing R6 has.
- The retransmit-deferral mechanism read out of quinn's source is **not** falsified — it
  predicts an effect that a noisy 1 % cell at n = 3 cannot resolve at 64 KB. **At 250 KB, in
  the cell built to have the power, it is confirmed on real hardware (§2.6a).**

**A defect worth carrying forward.** The real-path campaign found that `sch_netem` draws
loss **once per GSO batch, not per datagram**, and that the batch size differs by arm
(reported as 6.87 datagrams for `shared` against ~4.3 for per-frame — see the caveat
below). At equal bytes the shared arm
therefore absorbs ~1.5× fewer congestion events. This biases the comparison **toward** the
incumbent — and the incumbent still failed to separate, which is why the null stands. Any
future netem loss experiment comparing stream shapes must run with
`--segmentation-offload false`.

> **The per-arm batch figures are unsourced, and the rule survives without them.**
> `measurements/r6/r6cloud_gso_batch.tsv` is keyed by segment cap and GSO on/off, not by
> arm, so "6.87 against ~4.3" exists only as a table typed into a markdown file. What the
> committed data *does* support is the premise the rule rests on: turning GSO off drops the
> implied batch from **3.37 to 0.99** datagrams, so batching demonstrably changes how netem
> draws loss. Keep the rule; treat the per-arm ratio — and with it the "biases toward the
> incumbent" reading — as unverified until the rows behind it are committed. Adversarial
> review, 2026-09-07 (D3).

There is no cell in which **per-frame + FIFO** is better. The `perframe_fair` arm does beat
`shared` once, in X3S run 3 (905.9 ms against 965.1 ms) — one repeat inside a cell whose
ranges overlap, so it changes nothing, but the absolute phrasing this paragraph used to
carry was false and a reader checks that sentence first (D4).

### 2.6a · **X3L on the rig — the mechanism is confirmed on real hardware**

**Run 2026-09-07**, one sitting, on the Oracle rig. Data and full method:
[`measurements/r6/x3l-results.md`](measurements/r6/x3l-results.md); the losing condition was
written down and committed before calibration, in
[`measurements/r6/x3l-prereg.md`](measurements/r6/x3l-prereg.md).

§2.6 said the real-path test with the power to succeed was the 250 KB cell. This is it.
**6 rows, 0 VOID**, both arms `--segmentation-offload false` so `sch_netem` draws loss per
datagram rather than per GSO batch.

| | `shared` | `perframe_fifo` | ratio |
| --- | --- | --- | --- |
| netsim, 64 KB | 182.2 ms | 637.1 ms | 3.5× |
| netsim, 250 KB | 372.7 ms | 3159.5 ms | 8.5× |
| real path, 64 KB | — | — | **not a result** (noise 4.32×) |
| **real path, 250 KB** | **594.7 ms** | **3426.2 ms** | **5.76×** |

Separated on the pre-registered rule (+476.1 % on `p95_wait_ms`, +271.3 % on `nz_p95`), same
sign in all three repeats (+424.5 %, +452.9 %, +634.8 %), zero censoring, `bytes_on_wire`
spread 0.10 %.

**The mechanism's own prediction is about absolute milliseconds**, not a ratio — a lost frame
waits behind up to D−1 whole frames at a given depth and rate. That is the quantity to
compare across rigs, and it is the one that reproduces:

| | absolute per-frame penalty |
| --- | --- |
| netsim, 250 KB | 2786.8 ms |
| **real path, 250 KB** | **2831.5 ms** |

**1.6 % apart**, across rigs differing in RTT, loss model, achievable rate and every layer
between sender and receiver. The *ratio* differs (8.5× vs 5.76×) only because the baseline
does — `shared` costs 594.7 ms here against netsim's 372.7 — which is exactly what a
mechanism adding a fixed queueing delay should produce.

**Why this cell resolved what X3 could not**, in one line: the realisation noise on `shared`
is **1.11×** here against **4.32×** at 64 KB, while the effect is 5.76×. The signal is far
above the noise instead of underneath it. That was established from four calibration
realisations *before* the per-frame arm ran.

**The null was live and did not occur.** The stranding gate passed in every row
(10.8–29.0 MB stranded, `center_dropped` 0 throughout), so "per-frame does not separate at
250 KB with stranding present" was readable and would have put retransmit deferral in
trouble. It separated instead.

**What it does not settle:** §2.7. The binary still defaults to `per-frame`. And GSO is off
in both arms — necessary to make the loss model fair, but not how the server runs in
production, so the GSO-on real-path condition at 250 KB is unmeasured.

### 2.7 · The binary now implements this recommendation

**Landed 2026-09-08.** `server/src/main.rs` defaults `--stream-mode` to **`shared`**. The
rule below decided it; the record of how is kept because the point of a pre-registered rule
is that it can be checked afterwards.

Until then the binary defaulted to `per-frame` — the arm this section argues against — as
`main` still does. That was never a regression, only a conclusion the branch had not landed.

### The rule that decides it, so nobody has to adjudicate

This is not a matter of taste, and it should not wait on someone's judgement. **X3L is the
deciding measurement, and its outcome was pre-registered before it ran**
([`measurements/r6/x3l-run-card.md`](measurements/r6/x3l-run-card.md)):

| X3L on the real path | then |
| --- | --- |
| **`shared` separates**, stranding gate passing | **Flip the default to `shared`.** The mechanism is then confirmed on real hardware at the frame size the product ships, and the last reason to hold — "the real-path evidence is four ties" — is gone |
| **Does not separate**, stranding gate passing | **Leave the default, and rewrite §2 as advice rather than a decision.** A null there puts the retransmit-deferral mechanism itself in question, and a default may not outrun its evidence |
| Stranding gate fails | Not a result. Re-run; decide nothing |

Two standing inputs sit alongside it, and neither is enough on its own:

- **Nothing on either rig has ever favoured per-frame** — four real-path ties and every
  netsim cell. The risk of flipping is bounded by that.
- **Per-frame costs more at zero loss too**: §3.1 measures a stalled client at **2.05×** the
  server cost and **3.46×** the client cost under per-frame, on a mechanism that owes nothing
  to loss. That is an argument for `shared` that X3L cannot overturn.

> ### The rule has fired — 2026-09-07
>
> **X3L ran, and `shared` separated with the stranding gate passing**: 594.7 ms against
> `perframe_fifo`'s 3426.2 ms, **5.76×**, 6 rows, 0 VOID, same sign in all three repeats,
> 10.8–29.0 MB stranded per row and `center_dropped` 0 throughout (§2.6a,
> [`measurements/r6/x3l-results.md`](measurements/r6/x3l-results.md)).
>
> That is row 1 of the table above. **The pre-registered consequence is: flip the default to
> `shared`.** It has deliberately *not* been flipped in the same pass that measured it —
> changing a shipped default is a separate, announced act — but the decision is no longer
> open, and the reason to hold is gone rather than outweighed.


**What is not acceptable is the current state**, where the answer sheet reads as a settled
decision and anyone deploying either branch gets the arm measured 3.5–8.5× worse under loss.
That was written while X3L was outstanding, and X3L has since run and decided it. Found by
adversarial review, 2026-09-07; resolved by measurement the same day.

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

Unchanged in status: a pool is a server-side change, and no one has written it. The older
phrasing — "this lane may not modify `server/`" — stopped being true once the transport-knob
work landed; the branch modifies eight server files (D5).

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
| **GSO segment cap 10 → 32** | +17.2 % / −20.9 % CPU per byte **on the 250 KB fixture at n = 1**; the 32 KB fixture gives +5.1 % / −15.6 %, and the real-hardware re-run gives **−1.0 % / +8.1 % with overlapping ranges**. Not a flag either (see below) |
| Chunked send path | −6…−14 % CPU/byte at every rate |
| Per-frame prefault hop, warm cache | costs 10 % throughput, 14–34 % CPU/byte |
| `aws-lc-rs`, ACK frequency, socket buffers, initial MTU | ≤ 3 % or nil |

The GSO cap was re-run as a **negative control** in an RTT-bound cell and correctly showed
nothing — evidence the latency rig measures what it claims.

### 3.1 · The pathological client is measured, and the flow-control worry does not survive it

`transport-conclusions.md` used to carry *"bound the windows … as a bound on the
pathological case"* on arithmetic: quinn's `send_window` defaults to 10 MB per connection,
and 10 MB × 5 000 viewers is 50 GB. The case was never produced, because every harness in
this project reads. `window-harness --mode stall` produces it — asks 400 frames (25 MB, 2.5×
the ceiling), then stops reading while holding the connection and every receive stream open.

Data: [`measurements/mem/stall_client.tsv`](measurements/mem/stall_client.tsv), 48 rows,
0 VOID, gated by `lab/scripts/e0_stall_validate.sh`.
Full result: [`measurements/mem/stall-client.md`](measurements/mem/stall-client.md).

| workload | server per connection |
| --- | --- |
| ordinary reading | 110 kB |
| slow reader, 2 Mbps drain | 162 kB |
| **stops reading entirely, shared stream** | **180 kB** |
| stops reading entirely, per-frame | 370 kB |

**A client that stops reading costs the server 11 % more than one that reads slowly, and
sits 55× below the ceiling the recommendation was built on.** Bounding the windows moves it
1.09× in shared mode and 1.62× in per-frame — real, ordered the right way in all three
workloads, and not a lever.

The reason is that the queue forms at the **other end**. A stalled client's stack still
acknowledges at the transport layer, so the bytes leave the server and pile up in the
client's receive buffers, where they stay because the application never reads them. The
same client holds **2.20 MB against the server's 180 kB — twelve times as much.** What the
server retains is connection and per-stream bookkeeping, not queued payload, which is
exactly why bounding the payload windows barely moves it.

**This is also an independent argument for one shared stream.** A per-frame server hands a
non-reading client a fresh flow-control window per frame until the stream-concurrency limit
stops it — 99 streams here, against quinn's default limit of 100 — so per-frame costs the
server **2.05×** and the client **3.46×** what shared does. §2's case for the shared stream
rests on head-of-line blocking under loss; this one is visible at zero loss and does not
depend on the loss mechanism at all.

### The send path decides this, and it is why the numbers above are small

Everything above is on `--send-path chunked`, which moves a `Bytes` slice of the study
mapping into quinn's send buffer without copying. `copy` and `split` leave quinn holding a
private copy per connection instead, and the difference is not subtle
([`measurements/mem/stall_send_path.tsv`](measurements/mem/stall_send_path.tsv);
total RSS agrees with `RssAnon` in every arm, so this is a real saving and not a metric
blind spot):

| send path | shared | per-frame |
| --- | --- | --- |
| **chunked** | **198 kB** | **375 kB** |
| copy | 1 299 kB | **6 990 kB (6.8 MB)** |
| split | 1 292 kB | 6 807 kB |

**`copy` + per-frame reaches 68 % of the 10 MB `send_window`** — ~34 GB at 5 000 stalled
viewers. The flow-control worry was well founded for the send path this project used to
ship; the chunked default is what removed it. `RssAnon` was checked against total RSS
*within* each arm before this was believed: the two slopes agree to within 1.2 % — the
widest gap is chunked per-frame, 374.9 against 379.5 kB — so nothing is hiding in
file-backed pages.

**So the chunked send path is a memory-containment property, not only a CPU one.** It was
adopted for −6…−14 % CPU/byte; it also makes the pathological client **6.5× cheaper in
shared mode and 18.6× cheaper in per-frame**. `main` has the copy path only, and is exposed
to this in a way this branch is not.

---

**The cap is not something the server can set.** `MAX_TRANSMIT_SEGMENTS` is a
compile-time constant in `quinn`, not a `TransportConfig` knob, so every number in the row
above was measured against a **patched quinn** — `lab/scripts/quinn_lab_build.sh` vendors
the crate outside the tree and rebuilds one binary per value. Acting on this finding
therefore means an upstream change or a vendored fork, not a configuration change, and that
cost belongs in the decision. `--segmentation-offload true|false` *is* a server flag, but it
turns GSO **off and on** — it does not move the cap.

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

**T2 throughout** — one host, a userspace path simulator, no real network, n = 3 **except
where a row says otherwise**. One arm is n = 2: BBR in the congestive 600 ms cell (§1). The
campaign analysers print `n` per arm, and any figure quoted from them should carry it.

| conclusion | strength | what would overturn it |
| ---------- | -------- | ---------------------- |
| Controller depends on loss regime | **strong for the ordering, qualified on magnitude** — both directions large and separated, regimes verified by counters; but the congestive 600 ms cell is **n = 2 for BBR and may stay that way**, since the rig that produced it was an ephemeral sandbox and is probably gone (§1). Cubic's worst repeat still beats BBR's best on both columns | nothing for the ordering; the *mix* is unknown, not the physics |
| Which regime your links are in | **unknown** | client telemetry: loss vs queueing delay |
| The loss-regime classifier reproduces a known answer | **strong for its logic, and its input path is now fixed** — validated against two constructed regimes with an independent queue-drop witness, but on **one client**, which could not exercise the concurrent-write defect found on 2026-09-07 (29 % of rows survived at 32 connections). Nothing concluded is affected: the sampler was never deployed at scale | a multi-client collection whose `dropped_since_last` is non-zero, or whose unreadable-line count is above 0 |
| Keep shared stream | **strong, and now on real hardware** — separated 3.5× at 64 KB in simulation and **5.76× at 250 KB on the Oracle rig**, 3/3, same sign in every repeat, every gate passing (10.8–29.0 MB stranded per row, zero censoring, path stable start to end). The rig calibration independently landed on netsim's own step-scale of 32, and both rigs delivered **655 frames in every row**, so the two cells are the same cell. Negative control clean to 0.1 % | a cell where per-frame+FIFO separates *in its favour*; none found |
| Per-frame is worse *because of retransmit deferral* | **strong, and this is the branch's best-evidenced claim** — the mechanism predicts an **absolute** penalty (a lost frame waits behind D−1 whole frames), not a ratio, and that penalty reproduced across two rigs sharing no code: **2 786.8 ms on netsim against 2 831.5 ms on real hardware, 1.6 % apart** (§2.6a). A ratio can be moved by changing the baseline; a predicted millisecond figure landing twice cannot be. Still not *directly* instrumented | per-stream retransmit timing telemetry showing recovery is not deferred — which would now have to explain the coincidence |
| Per-frame without FIFO is worst | **strong** — four campaigns, matches scheduler source | — |
| GSO cap worth 17 % | **weak** — loopback, **n = 1 on every one of the 24 rows**, and fixture-dependent: +17.2 % at 250 KB against +5.1 % at 32 KB. The real-hardware re-run reads **−1.0 % / +8.1 %, ranges overlapping**. The external corroboration (ETH Zürich thesis, quinn #2201) is for the **byte cliff**, not the gain | repeats at n ≥ 3, and a real-hardware cell where the send path is the ceiling |
| Initial window is not a lever | **strong** — two independent measurements | — |
| Flow-control ceilings are never approached **on the chunked send path** | **moderate** — 48 rows, 0 VOID, linear to r² ≥ 0.979, but T2 loopback and N ≤ 16 | a client that widens its own receive window on a high-BDP path, where the in-flight window rather than the peer's credit would bound the server |
| The send path, not the windows, sets the pathological-case cost (6–17×) | **moderate** — n = 2 probe, but the effect is far outside what n = 2 could manufacture, and total RSS corroborates `RssAnon` | a copy-path arm that matches chunked once the sampler catches the true peak |

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
