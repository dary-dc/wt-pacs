# R6 on a real network — results

**The campaign the four previous ones could not run.** Stream shape measured against the
Oracle rig over a real internet path shaped by `sch_netem`, with the harness on a laptop,
rather than against `lab/netsim` on localhost.

Instrument, deviations from netsim, and the E0 gates: [`real-path-notes.md`](real-path-notes.md).
Pre-registration, unchanged and fixed before any of this ran:
[`../../lanes/R6-preregistration.md`](../../lanes/R6-preregistration.md).
Raw data: [`r6cloud.tsv`](r6cloud.tsv) — 36 rows, **0 VOID**.

```bash
EXP=r6cloud CELLS="X1 X2 X3 N0" lab/scripts/r6_campaign_cloud.sh 3
python3 lab/scripts/r6_analyse.py .local/measurements/r6/r6cloud.tsv
python3 lab/scripts/r6_adversarial_checks.py .local/measurements/r6/r6cloud.tsv
```

---

## The headline

**Three of the four cells agree with the simulator. The fourth — the one the simulator's
64 KB conclusion rests on — does not separate here, and §4.3 shows this cell was too noisy
to have detected that effect even if it is real.**

p95 time-to-displayable, median of 3 repeats, arms interleaved within each repeat.
`per-frame + FIFO` is `--stream-mode per-frame --send-fairness false`.

| cell | what it is | shared | per-frame + FIFO | rig verdict | netsim verdict |
| --- | --- | --- | --- | --- | --- |
| **N0** | control: no loss, reader keeps up | 82.0 ms | 82.7 ms | **tie (+0.8 %)** | tie (−0.1 %) |
| **X2** | stranding, no loss | 93.8 ms | 91.7 ms | **tie (−2.3 %)** | tie (+2 %) |
| **X1** | 0.1 % loss + stranding | 96.8 ms | 91.8 ms | **tie (−5.1 %)** | tie |
| **X3** | **1 % loss** | 119.3 ms | 174.4 ms | **NOT a result** — ranges overlap, sign flips | shared wins **+250 %, separated 3/3** |

Absolute latencies are **not** comparable between the two rigs — different operating
points, different loss processes, a real base RTT. Only the ordering and separation of arms
within a cell are.

### The gates, applied before any of the above was read

1. **N0 must not separate for `shared` vs `perframe_fifo`.** It does not: +0.8 %, ranges
   overlap, and the sign flips across repeats (+0.7 %, +1.6 %, −0.4 %). The campaign is
   **not void**. `perframe_fair` does separate in N0 (+115 %), which is expected and
   pre-conceded — that arm's control is known invalid
   ([`adversarial-review.md`](adversarial-review.md) §3.1), so nothing here is attributed
   to head-of-line blocking on its behalf.
2. **VOID rows are kept and reported.** There are none: 36 of 36 rows admissible. That is
   the calibration having done its job before the arms ran, not the guards failing to bite —
   they fired during calibration, voiding step-scale 1 at 1 % loss on 67 dropped centre
   asks ([`real-path-notes.md`](real-path-notes.md) §4).
3. **Adversarial review before the conclusion** — §3 below, and it found a real defect.

---

## X3 — why the simulator's result does not survive

X3 is the cell that produced netsim's entire stream-shape conclusion. On the real path it
produces nothing, and the reason is visible in the per-repeat numbers rather than in the
medians.

| repeat | shared | per-frame + FIFO | per-frame vs shared |
| --- | --- | --- | --- |
| 1 | 119.3 ms | 436.8 ms | **+266 %** |
| 2 | 84.7 ms | 117.1 ms | **+38 %** |
| 3 | 365.8 ms | 174.4 ms | **−52 %** |

**The loss realisation moves the reference arm by 4.32×** (84.7 → 365.8 ms) while the arm
difference flips sign. Under the pre-registered min/max non-overlap rule this is *not a
result*, and it would not be one under a sign test either (2/3, p = 1.0).

This is the same failure mode netsim's X1 showed and which
[`adversarial-review.md`](adversarial-review.md) §3.3 diagnosed there: *"at 0.1 % loss the
loss realisation itself dominates … while the arm difference flips sign."* On the real path
that regime has moved. It now swallows the 1 % cell as well.

For contrast, in the cells with no loss to realise, the same reference arm moves by
**1.01×** (N0) and **1.03×** (X2), and the arms agree within 4 %. The variance in X3 is loss
variance, not rig noise.

### What did reproduce

**`perframe_fair` is worse than `shared` everywhere, in every cell, in every repeat** —
+54 % (X2), +82 % (X1), +115 % (N0), +332 % (X3), same sign in all twelve repeat-level
comparisons. That is the pre-registered prediction **P5 failing again**, on a second and
independent rig. P5 said fairness-on would *beat* FIFO under stranding. It does not, and now
it does not on a real network either.

`shared` and `perframe_fifo` tie in three cells out of four and fail to separate in the
fourth. **Nothing anywhere in this campaign favours per-frame streams over a shared stream,
and nothing favours a shared stream over per-frame + FIFO either.**

---

## The reading, stated against what it replaces

`docs/transport-conclusions.md` §2 currently says: *"Per-frame is 3.5× worse at 1 % loss and
never better anywhere"*, separated 3/3, and treats that as the mechanism-backed reason to
keep one shared stream.

On a real path, at the same nominal 1 % loss and the same 64 KB frames:

- the **3.5×** is not reproduced. The median gap is 1.46× and the ranges overlap. But the
  cell's noise floor is 4.32×, so **it could not have reproduced it either way** — see §4.3
  before drawing anything from this line.
- **"never better anywhere" still holds** — no cell, arm or repeat favours per-frame — and on
  this rig it is supported by four ties rather than by one large separation.
- the recommendation itself (**keep one shared stream**) is *not* overturned, and neither is
  the mechanism. What is missing is real-path *confirmation*: it has been sought at the one
  frame size where the predicted effect is smaller than the noise.

`transport-conclusions.md` §2.6 is amended to this. **The direction of the correction
matters**: the simulator's number was quoted as a property of the transport, and on real
hardware it is so far only a property of the simulator — not because it was contradicted, but
because it has not yet been tested where it could be seen.

---

## 3 · Adversarial review of the real-path campaign

Method unchanged: take the data, the pre-registration and the harness, and try to **break**
the reading rather than confirm it. The netsim campaign's §1–2 attacks are re-run here
rather than inherited, because a different rig has to earn them again.
`lab/scripts/r6_adversarial_checks.py` runs them.

### 3.1 · The carried-over attacks — all four survive

| attack | check | result |
| --- | --- | --- |
| "the arms are scored on different samples" | `wait_samples` per arm per cell | **682 in every arm of every cell.** Identical fixed population; `p95_wait_ms` is comparable |
| "an arm wins by delivering less" | spread of `bytes_on_wire` within a cell | **≤ 0.87 % between arm means** (≤ 1.40 % row to row), and `censored_frac` is **0.0000 in all 36 rows**. No arm bought latency by moving less |
| "the depth ceiling was never reached" | `peak_outstanding` vs `depth` | ≥ 8 everywhere, 10 for `perframe_fair` in X1/X2 |
| "a slower arm got a slower reader" | `reader_lag_ms` | **≤ 2.0 ms** in every row, over runs of 25–95 s |

### 3.2 · **A new defect, found here, and it is not small**

**`sch_netem` draws its loss once per socket buffer, not once per datagram — and how many
datagrams are in a buffer depends on the arm.**

Linux qdisc accounting makes this measurable without touching the server. `bstats_update()`
charges the packet counter `skb_is_gso(skb) ? gso_segs : 1`, so `Sent … pkt` counts
**datagrams**; `qdisc_qstats_drop()` adds 1 per dropped skb, so `dropped` counts
**GSO batches**. Dividing recovers the batch:

```
batch = (datagrams x loss_fraction) / batch_drops
```

Validated against the case where the answer is known — with `--segmentation-offload false`
each skb is one datagram, and the estimator returns **1.0**:

| server | GSO | datagrams | batch drops | implied batch |
| --- | --- | --- | --- | --- |
| seg10 | **off** | 3 677 | 37 | **1.00** ← the control |
| seg10 | on | 7 067 | 21 | 3.4 |
| seg32 | on | 11 100 | 19 | 5.8 |

Now measure it **per arm**, in the X3 cell, at identical shaping and near-identical bytes
(the open-loop reader runs on its own clock, so every arm sends the same data in the same
wall time — confirmed by the 0.20 % `bytes_on_wire` spread):

| arm | datagrams | netem loss events | implied batch | loss events/s |
| --- | --- | --- | --- | --- |
| `shared` | 29 910 | **44** | **6.87** | 0.48 |
| `perframe_fair` | 29 454 | **70** | 4.25 | 0.76 |
| `perframe_fifo` | 29 981 | **69** | 4.39 | 0.75 |

**One stream packs a fuller GSO batch than many streams do**, because per-frame streams
break a batch at every frame boundary. netem then draws loss per batch, so at the same byte
count the shared arm absorbs **44 loss events where per-frame absorbs 69** — a ~1.5×
gentler congestion signal, and loss-based congestion control reacts per *event*. Across the
campaign's own `ns_qdrop` column the same ordering holds more modestly: 49.7 (shared) vs
54.7 (fifo) vs 58.3 (fair).

**This is an artifact of shaping on the sender, not a property of networks.** A real
bottleneck router sees datagrams — the NIC segments the batch on the way out, downstream of
the qdisc. netem sits *upstream* of segmentation and therefore correlates loss with the
sender's own batching behaviour.

Three consequences, applied rather than noted:

1. **It biases X3 in favour of `shared`** — the arm this project already prefers. And
   `shared` *still* did not separate. The failure to reproduce netsim's result therefore
   cannot be explained away by this artifact; if anything the artifact was helping.
2. **X2 and N0 are untouched.** No loss, no draws, no confound. The ties there are clean.
3. **Any netem-based loss experiment comparing stream shapes is confounded unless GSO is
   disabled.** The corrected X3 — `--segmentation-offload false`, which forces batch = 1 and
   restores the i.i.d. per-datagram loss netsim models — is the experiment this campaign
   should be followed by, and it is **not run here**: see §4.

### 3.3 · "The path was not constant, so the campaign drifted"

**Real, checked, and it did not touch the campaign.** The residential link delivered
**51.4 Mbps** unshaped at the start of the session and **9.2 Mbps** three hours later.

The campaign is unaffected, and this is checkable rather than assumed. The open-loop reader
runs on a fixed wall clock, so a halving of path capacity would show up immediately as more
stranding and non-zero censoring. Across the three repeats:

- X1 `shared` stranded 165, 158, 152 frames — flat
- X2 `shared` stranded 156, 159, 156 — flat
- N0 stranded 0 in all nine of its rows
- `censored_frac` is 0.0000 in all 36 rows

A path that had collapsed mid-campaign could not produce that. The degradation is dated
after the campaign and before the fairness runs, and it is why the fairness experiment runs
at a 5 Mbps cap with an explicit "is the cap still the bottleneck?" guard (§5).

### 3.4 · "You found the answer you already believed" — the standing attack, re-aimed

The netsim campaign answered this by pointing out that its own pre-registered hypothesis
lost. That defence is unavailable to a campaign that reports a **null**, so the attack has
to be aimed the other way: *did I want the simulator to be wrong?*

Three things argue against it:

1. **The null is the expensive answer.** It costs `transport-conclusions.md` §2 its headline
   number and its mechanism story, and it leaves the recommendation resting on ties.
2. **The one defect I found points the other way.** §3.2's artifact biases X3 *toward*
   `shared` — that is, toward reproducing netsim. Reporting it makes the null harder to
   dismiss, not easier.
3. **The prediction that failed is the same one that failed on netsim.** P5 lost again, in
   all twelve comparisons, on a rig that shares no code with the first.

The reading that survives is narrow and dull: three ties, one cell too noisy to read, and a
fairness arm that is reliably worst. It is not a reversal and should not be written up as
one.

---

## 4 · What the rig answered that netsim cannot

### 4.1 · Competing-flow fairness — **BBR starves a neighbour in a shallow buffer**

`transport-conclusions.md` §1 defaults to Cubic partly on a risk it had never measured:
*"quinn ships BBRv1 … documented to take > 90 % of a shallow buffer from competing Cubic
flows"*, and warns that the p95 metric does not price harm done to other traffic on the same
hospital uplink. **That claim is now measured, and it holds.**

Two flows, one shared 5 Mbps netem band, +25 ms one-way. Raw:
[`r6cloud_fairness.tsv`](r6cloud_fairness.tsv).

| queue | flow A | flow B | n | A Mbps | B Mbps | A share | Jain |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **20 p (≈48 ms)** | QUIC Cubic | QUIC Cubic | 5 | 2.61 | 2.08 | 55.6 % | 0.950 |
| **20 p** | QUIC BBR | QUIC BBR | 5 | 2.22 | 2.35 | 48.5 % | 0.994 |
| **20 p** | QUIC Cubic | **TCP Cubic** | 5 | 3.40 | 1.46 | 70.0 % | 0.862 |
| **20 p** | **QUIC BBR** | **TCP Cubic** | 5 | **4.54** | **0.03** | **99.4 %** | 0.506 |
| 500 p (≈1.2 s) | QUIC Cubic | QUIC Cubic | 3 | 2.37 | 2.34 | 50.4 % | 1.000 |
| 500 p | QUIC BBR | QUIC BBR | 3 | 1.30 | 3.40 | 27.6 % | 0.833 |
| 500 p | QUIC Cubic | TCP Cubic | 3 | 3.57 | 1.07 | 76.8 % | 0.777 |
| 500 p | QUIC BBR | TCP Cubic | 3 | 2.59 | 2.12 | 55.1 % | 0.982 |

**The control that makes the 99.4 % row mean anything.** A 20-packet queue is shallow enough
that it could plausibly break TCP by itself, in which case the row would say nothing about
BBR. Run alone against the same bottleneck, the same TCP flow takes:

| queue | TCP alone |
| --- | --- |
| 20 p | **4.52, 4.47, 4.52 Mbps** |
| 500 p | 4.49, 4.11, 4.17 Mbps |

(committed as [`r6cloud_fairness_controls.tsv`](r6cloud_fairness_controls.tsv) — a split is
not a measurement unless each flow is shown able to take the link unopposed)

So the competitor is fully capable of ~90 % of the link at that queue depth, and QUIC BBR
drives it from **4.5 Mbps to 0.03 Mbps — a 150× reduction.** That is starvation, not a
handicapped competitor.

Three things follow:

1. **The risk is real and buffer-dependent.** In the deep buffer BBR is the *better*
   neighbour (55 % share, Jain 0.982) and Cubic is the worse one (77 %, Jain 0.777). In the
   shallow buffer that reverses completely. Shallow buffers are the norm at access links.
2. **"Default to Cubic" is now supported by a measurement, not only by caution.** The
   asymmetry §1 relied on — BBR being 48 % better for us but harmful to others — is
   quantified: harmful means *the neighbour gets 0.6 % of the link*.
3. **QUIC is not a polite neighbour even with Cubic.** 70–77 % against a TCP flow that can
   take 90 % alone. That is a smaller effect than BBR's but it is not nothing, and it is not
   attributable to the congestion controller.

**Limits.** The TCP competitor is an SSH bulk transfer — genuinely TCP Cubic from the rig's
own stack, but carrying SSH framing and crypto; its solo control (4.5 Mbps, against 4.66 for
a solo QUIC flow at the same cap) shows it is a near-equal competitor rather than a
strawman. Every cell is additionally gated on a "can one flow alone still reach the cap?"
check that **aborts** the run below 85 %, so no split in this table was taken across a
bottleneck other than the configured one. Both flows terminate
on the same laptop. `qbbr_qbbr` at 500 p is visibly noisy (27.6 % median over 3 repeats)
and no weight is put on it.

Because port 22 is the only TCP the rig's VCN admits, the cross-protocol cells required
removing the shaper's own SSH bypass. A pid-file deadman on the rig unconditionally restores
the qdisc after 10 minutes, so a mis-shaped path cannot lock the rig out; recovery does not
depend on the network still working.

### 4.2 · GSO segment cap — the cap is real, the density claim is **not testable here**

`transport-conclusions.md` records **+17 % throughput, −21 % CPU/byte** for raising quinn's
`MAX_TRANSMIT_SEGMENTS` from 10 to 32, taken on a rig where netsim voided it by
construction. On real hardware, 5 interleaved repeats per arm, unshaped
([`r6cloud_gso_cpu.tsv`](r6cloud_gso_cpu.tsv)):

| seg cap | n | throughput | CPU per MB | server CPU as % of wall |
| --- | --- | --- | --- | --- |
| 10 | 5 | 48.71 Mbps | 17 384 µs | 10.5 % |
| 32 | 5 | 48.23 Mbps | 18 797 µs | 11.2 % |

**seg32 vs seg10: throughput −1.0 %, CPU/byte +8.1 %** — and the per-arm ranges overlap
heavily (seg10 16 337–20 062 µs/MB, seg32 16 578–18 918), so by this project's own
separation rule **neither number is a result**.

The reason is legible rather than mysterious, and it is the honest answer: **the server is
at 10 % CPU and the path is the ceiling.** Both arms sit at ~48.7 Mbps because that is what
the internet gave, not what the send path could do. A 2 vCPU box at 10 % for 48 Mbps
extrapolates to several hundred Mbps before batching could bind.

The cap is nonetheless **doing something measurable** — §3.2's estimator reads the batch
straight off the wire:

| server | GSO | implied datagrams per batch |
| --- | --- | --- |
| seg10 | off | **1.00** (the control) |
| seg10 | on | 3.4 |
| seg32 | on | 5.8 |

So raising the cap does raise the achieved batch, by ~70 % at this rate. What is not shown
is that this buys throughput or CPU where it was claimed to. **The published +17 % / −21 %
is neither confirmed nor refuted by this rig; it is untested here, and the reason is the
path.** Confirming it needs a server-side bottleneck — a second rig on the same LAN, or a
loopback client on a box with more than 2 vCPU.

---

## 4.3 · Why this null is weak evidence against the mechanism

Written after reading `transport-conclusions.md`'s X3L result, which landed on this branch
while the campaign was running and changes how the null should be read.

The effect X3 looks for is netsim's **3.5×**. The realisation noise here is **4.32×**. The
signal is smaller than the noise, so **this cell could not have detected the simulator's own
effect at n = 3 even if the mechanism were exactly right.** A null from an underpowered cell
is not evidence of absence, and this document should not be cited as if it were.

The mechanism's own falsifiable prediction points at the fix. It says the penalty scales with
frame size, and netsim measured **8.5× at 250 KB** against 3.5× at 64 KB. An 8.5× effect
clears a 4.3× noise floor; a 3.5× effect does not. **The real-path experiment with the power
to succeed is X3L — 250 KB frames — and it was not run here.** It is now the highest-value
run on this rig, ahead of everything in §5.

Sizing it honestly, because it is not cheap: netsim's X3L needed step-scale 32, and the real
path runs about one step-scale easier, so ~16. That is 681 × 33 ms × 16 ≈ **6 minutes per
run**, or ~1 hour for `shared` vs `perframe_fifo` at n = 3, plus its own calibration. It also
needs a *stable* path — see §3.3.

> **Run on 2026-09-07 — and it separated.** `shared` 594.7 ms against `perframe_fifo`
> 3426.2 ms, **5.76×**, 6 rows, 0 VOID, same sign in all three repeats. Data and method:
> [`x3l-results.md`](x3l-results.md); the reading is in `../../transport-conclusions.md`
> §2.6a. Two corrections to the sizing above, both worth carrying:
>
> - **The step-scale is 32, not ~16.** The "one step-scale easier" rule was measured at
>   64 KB *with GSO on*. With `--segmentation-offload false` the achievable rate in this cell
>   halves (measured: 6.00 → 3.50 Mbps median), which puts the rig back at netsim's own
>   operating point. Scale 16 passes the admissibility band and is still the wrong cell — it
>   delivers 463 frames against netsim's 655 and strands 407 against 33.
> - **So it is ~12 minutes per run, not 6** — about 2 h 15 for calibration plus campaign.
>
> The realisation noise that defeated X3 does not survive the move to 250 KB: `shared` moves
> by **1.11×** here against 4.32× at 64 KB.

---

## 5 · The other experiments this campaign should be followed by, and did not run

**X3 with `--segmentation-offload false`.** §3.2 establishes that netem correlates loss with
the sender's GSO batching, that the batch differs by arm (6.87 vs ~4.3), and that the
resulting congestion-event rate differs by ~1.5× in the shared arm's favour. Disabling GSO
forces batch = 1 and restores exactly the i.i.d. per-datagram loss that `lab/netsim` models,
which makes it the one experiment that can separate "the simulator's result was an artifact
of its loss model" from "the real path is simply noisier".

> **Partly answered by X3L**, which ran GSO-off on both arms and separated 5.76×
> ([`x3l-results.md`](x3l-results.md)). That rules out "the simulator's result was an
> artifact of its loss model" at 250 KB. It also puts a number on what the flag costs:
> measured achievable rate in this cell, shared arm, three runs each — GSO on
> 9.50/6.00/4.50 Mbps, GSO off 3.50/3.50/2.25 Mbps. **Disabling GSO roughly halves the
> achievable rate under 1 % netem loss**, which is §3.2's batching finding measured directly
> rather than inferred. The 64 KB GSO-on/GSO-off pair below is still not run.

It is **not run here**, for a stated reason rather than an omission: the residential path
degraded from 51 Mbps to 9 Mbps during the session (§3.3). The corrected cell would need its
own calibration at the new achievable rate *and* a matched GSO-on control re-run at that
same rate to be comparable, and a comparison spanning a 5× change in path capacity would be
worth less than not running it. It should be run in one sitting, on a stable path:

```bash
# 1 · recalibrate BOTH conditions at the current achievable rate, shared arm only
DELAY=25 RATE=20 LOSS=1.0 SCALES="2 4 6 8" REPS=3 lab/scripts/e0_r6_calibrate_cloud.sh
#     then again with the server started --segmentation-offload false

# 2 · run X3 and N0 under both conditions, interleaved, in one sitting
EXP=r6gso_on  CELLS="X3 N0" lab/scripts/r6_campaign_cloud.sh 3
EXP=r6gso_off CELLS="X3 N0" SRV_EXTRA="--segmentation-offload false" \
  lab/scripts/r6_campaign_cloud.sh 3
```

`r6_campaign_cloud.sh` does not yet take `SRV_EXTRA`; adding it is a one-line change to the
arm spec, deliberately left undone so nobody runs the above believing it already works.

Two smaller follow-ups, in priority order:

- **X3 at n ≫ 3.** The cell's realisation variance (4.32×) makes n = 3 powerless. The
  pre-registration fixes n = 3 and this campaign honoured it; establishing whether a 1.46×
  median gap is real needs a separately pre-registered run at n = 15–20 with a paired test,
  not more repeats bolted onto this one.
- **A second rig on the same LAN**, to give the GSO cap a server-side bottleneck (§4.2).
