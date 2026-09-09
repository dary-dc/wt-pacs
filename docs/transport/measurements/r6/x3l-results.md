# X3L on the Oracle rig — stream shape at 250 KB, on a real path

**Run 2026-09-07, one sitting.** Procedure: [`x3l-run-card.md`](x3l-run-card.md). What a
null would have meant was written and committed *before* calibration, in
[`x3l-prereg.md`](x3l-prereg.md) (commit `3ea058d`). This document is the data, the
deviations, and the reading.

Read it beside [`r6cloud-results.md`](r6cloud-results.md), which is the 64 KB real-path
campaign this one exists to rescue: that cell could not resolve the stream-shape question
because the effect sought (3.5×) was smaller than the loss-realisation noise (4.32×).

---

## 0 · Instrument

| | |
| --- | --- |
| server | Oracle E2, São Paulo, `6.17.0-1011-oracle`, 2 vCPU, 954 MB |
| server binary | `target/lab-arms/exact-server-seg10`, built 2026-09-06 — **deliberately not rebuilt**, §5.3 |
| client | this laptop, `target/release/window-harness`, residential path |
| fixture | `frames_500x250k` — **generated on the rig**, sha256 `ca71265f…d8dc237`, 125 006 090 B |
| trace | `radiologist_review_500.json`, 681 steps, 655 distinct asks |
| cell | netem egress, +25 ms one-way, 20 Mbit, 1.0 % loss, limit 500 pkt |
| arms | `shared`, `perframe_fifo` — **both `--segmentation-offload false`** |
| depth / cache | 8 / 64 frames |
| step-scale | **32**, calibrated on this rig in this condition (§2) |

The fixture was regenerated on the rig rather than uploaded, and then **checksummed against
the local copy**: both are `ca71265fd75c04c050b88c19372c79856c629c3e30671148a2438fe6fd8dc237`
at 125 006 090 bytes. The run card only asks that sizes match before skipping the upload;
the hash is stronger, and it is what rules out the failure this cell is most vulnerable to —
running X3L's step-scale against the wrong fixture.

### Base path, start of session

- **RTT 29.3–29.8 ms** median (min 28.0), by TCP connect to :22, which the shaper bypasses.
  Occasional spikes to ~100 ms. The documented band is 28–35 ms, so the path started inside it.
- **Unshaped throughput 56.0 Mbps** app-layer (`--mode saturate`, 14 000 224 B over a 2.0 s
  dwell) — above the 51.4 Mbps of the 64 KB session, and **2.8× the 20 Mbit cap**. netem,
  not the internet, is the bottleneck.

---

## 1 · What GSO-off does to this cell, measured before calibrating

`--segmentation-offload false` is required on both arms because `sch_netem` draws loss once
per GSO batch and the batch size differs by arm ([`r6cloud-results.md`](r6cloud-results.md)
§3.2). Turning it off is not free: it changes the rate the reader's demand has to be set
against. Measured here, shared arm, in the X3L cell, `--mode saturate`, three runs each:

| | achievable app-layer rate | median |
| --- | --- | --- |
| GSO **on** | 9.50 / 6.00 / 4.50 Mbps | 6.00 |
| GSO **off** | 3.50 / 3.50 / 2.25 Mbps | **3.50** |

**GSO-off roughly halves the achievable rate under 1 % netem loss.** That is §3.2's finding
measured directly rather than inferred from batch sizes, and it is why the calibration below
was run with GSO off too — see §5.1.

---

## 2 · Calibration — the old default of 16 would have been wrong

`SCALE_X3L` has no default on purpose. The removed value was 16: netsim's 32, halved by the
"the real path is one step-scale easier" rule measured for X1/X2/X3 **at 64 KB with GSO on**.

Sweep on the incumbent (`shared`) arm only, GSO off, one realisation each:

| scale | trace | strand | censored | `center_dropped` | p95 | frames on wire | admissible |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 90 s | 117 | 43.6 % | 357 | 80 488 ms | 126 | no |
| 8 | 180 s | 227 | 11.4 % | 104 | 57 388 ms | 245 | no |
| 16 | 360 s | 407 | 0.6 % | 0 | 7 294 ms | 463 | *technically yes* |
| **32** | **719 s** | **49** | **0 %** | **0** | **687 ms** | **655** | **yes** |

**Scale 16 passes the admissibility band and is still the wrong operating point**, which is
exactly the case the run card's sanity check exists to catch. Two independent signs:

- **Frames delivered.** netsim's X3L delivered **655** frames in all nine rows. Scale 32
  delivers 655; scale 16 delivers 463 — a third of the series never arrives.
- **Demand/achievable.** netsim chose scale 32 so this ratio was 0.64, matching the 64 KB
  run's 0.66, keeping frame size the only thing that changed. Using the same demand model
  netsim used — one new frame per step at 30 fps ÷ scale, which reproduces its own published
  1.82 Mbps at scale 32 — and the *measured* achievable rate of 3.50 Mbps:

  | scale | demand | demand/achievable (range over the three achievable measurements) |
  | --- | --- | --- |
  | 16 | 3.79 Mbps | **1.08** (1.08–1.68) |
  | 32 | 1.89 Mbps | **0.54** (0.54–0.84) |

  0.64 sits inside scale 32's band and nowhere near scale 16's. Stranding says the same
  thing: 49 at scale 32 against netsim's 33–34, versus 407 at scale 16.

**So the rig needs netsim's own scale 32, not the halved 16.** The halving rule does not
survive the move to 250 KB with GSO off, because GSO-off drops the achievable rate to
3.50 Mbps — close to netsim's own ~2.85 Mbps ceiling — so the path is no longer "one
step-scale easier" at all. Had the removed default of 16 been inherited, the campaign would
have run in a cell delivering two thirds of the series, at nearly double the intended
reader demand, and the rows would have looked admissible.

### E0-R6c — the chosen point at three independent loss realisations

netem has no seed, so three separate runs are three independent realisations. All three must
hold; X3S was clean at one and then voided 4 of 9 campaign rows.

| rep | strand | censored | `center_dropped` | p95 | nz_n | frames | admissible |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 48 | 0 % | 0 | 596.6 ms | 93 | 655 | yes |
| 2 | 40 | 0 % | 0 | 528.7 ms | 76 | 655 | yes |
| 3 | 49 | 0 % | 0 | 623.2 ms | 87 | 655 | yes |

**All three admissible. Scale 32 frozen before any per-frame arm ran.**

### The noise floor, which is the whole reason this cell exists

Across the four `shared` realisations at scale 32 (sweep + three re-checks) p95 was
**687.3 / 596.6 / 528.7 / 623.2 ms** — a **1.30× spread**. The 64 KB real-path cell's
reference arm moved by **4.32×**. That collapse in realisation noise is what gives this cell
the power the 64 KB one lacked, and it was established *before* the comparison arm ran.

---

## 3 · Result — it separates

`docs/transport/measurements/r6/r6cloud_x3l.tsv`. **6 rows, 0 VOID**, both arms
`--segmentation-offload false`, arms interleaved within each repeat.

| run | `shared` | `perframe_fifo` | ratio |
| --- | --- | --- | --- |
| 1 | 590.3 ms | 4337.3 ms | 7.35× |
| 2 | 653.2 ms | 3426.2 ms | 5.25× |
| 3 | 594.7 ms | 3288.2 ms | 5.53× |
| **median** | **594.7 ms** | **3426.2 ms** | **5.76×** |

`r6_analyse.py` on the pre-registered rules: **`perframe_fifo` +476.1 %, separated**. On
`nz_p95` — waits that actually waited — 1518.3 → 5638.0 ms, **+271.3 %, separated**.

**Every gate in run card §4 passes:**

| gate | result |
| --- | --- |
| stranded_bytes ≠ 0 in every row | 10.8–29.0 MB stranded; **no vacuous row** |
| `center_dropped` == 0 | 0 in all six rows |
| VOID rows kept | none occurred; all six verdicts `ok` |
| base path RTT start and end | **28–29.8 ms → 27.9–29.5 ms**; unshaped 56.0 → 54.0 Mbps |

The path did not move. That matters because the previous attempt died exactly there
(51 → 9 Mbps mid-session), and it is what makes these three repeats one comparison rather
than three.

### Where this sits beside everything else

| | `shared` | `perframe_fifo` | ratio |
| --- | --- | --- | --- |
| netsim, 64 KB | 182.2 ms | 637.1 ms | 3.5× |
| netsim, 250 KB | 372.7 ms | 3159.5 ms | 8.5× |
| real path, 64 KB | — | — | **not a result** (realisation noise 4.32×) |
| **real path, 250 KB** | **594.7 ms** | **3426.2 ms** | **5.76×** |

### The number that actually tests the mechanism

The ratio is the headline, but it is not what the mechanism predicts. Retransmit deferral
says a lost frame waits behind up to D−1 *whole frames*, which is a claim about **absolute
milliseconds at a given depth and rate** — the adversarial review made this point when
defending the netsim result against the change of step-scale, and it is what makes the two
rigs comparable despite different baselines.

| | absolute per-frame penalty |
| --- | --- |
| netsim, 250 KB | 2786.8 ms |
| **real path, 250 KB** | **2831.5 ms** |

**1.6 % apart**, across two rigs that differ in RTT (50 vs 53 ms), in loss model (seeded
userspace PRNG vs `sch_netem`), in achievable rate, and in every layer between the sender
and the receiver. The ratio differs (8.5× vs 5.76×) only because the *baseline* differs —
`shared` costs 594.7 ms here against netsim's 372.7 — which is what a mechanism that adds a
fixed queueing delay should do.

### Why this cell could succeed where the 64 KB one could not

| | 64 KB real path | 250 KB real path |
| --- | --- | --- |
| realisation noise on `shared` | **4.32×** | **1.11×** |
| effect measured | 1.46× median, sign flipped across repeats | **5.76×, same sign in all three** |
| verdict | not a result | **separated** |

`r6_adversarial_checks.py` puts it precisely: *realisation moves `shared` by 1.11×* while
the arm effect is **+424.5 %, +452.9 %, +634.8 %** — same sign in every repeat. The effect
is two orders of magnitude clear of the noise, where at 64 KB it was underneath it.

### The other attacks, all checked

- **1.1 same population** — `wait_samples` = 682 for both arms in all six rows.
- **1.2 no arm wins by delivering less** — `bytes_on_wire` spread **0.10 %**; censoring is
  0.0000 in every row. `perframe_fifo` run 1 delivered 653 frames against 655, and that is
  the *losing* arm delivering marginally less, so it can only flatter per-frame.
- **1.3 / 1.6 depth and reader clock** — `peak_outstanding` = 8 = depth everywhere; reader
  lag 0.6–1.8 ms.

---

## 4 · What this changes

The stream-shape recommendation was, until today, a simulator result: netsim said 3.5× at
64 KB and 8.5× at 250 KB, and the one real-path test of it was noise-dominated.
`transport-conclusions.md` §2.6 said the mechanism was *unconfirmed on real hardware*.

**It is confirmed now.** On a real network, through a real kernel shaper, at the frame size
this product actually ships, one shared stream is **5.76× better** than a stream per frame,
and the absolute penalty the mechanism predicts reproduces to within 1.6 % of the simulator.

The pre-registered null — *per-frame does not separate at 250 KB with the stranding gate
passing* — **did not occur**, and it was a live possibility: the gate passed (10.8–29.0 MB
stranded per row, `center_dropped` 0 throughout), so a null would have been readable and
would have put the retransmit-deferral mechanism in trouble.

What it does **not** settle is the GSO-on real-path condition at 250 KB. §2.7 has since
landed: `server/src/main.rs` defaults to `shared` as of 2026-09-08. This run made the cost
of leaving the old default measurable rather than simulated.

---

## 5 · Deviations from the run card, and other judgement calls

Stated explicitly because the run card asks for it.

### 5.1 · Calibration was run with `--segmentation-offload false` — the run card's command is not

The run card's §2 calibration command does not pass the flag, while §3 requires it on both
campaign arms. Calibrating in one condition and running in another is the "calibrated once,
assumed to hold" failure this project has made five times, and here it is not academic:
**GSO-off halves the achievable rate** (§1), so the reader would have been set against
roughly double the real denominator. `r6cloud-results.md` §5 already anticipates this —
*"then again with the server started `--segmentation-offload false`"*.

`e0_r6_calibrate_cloud.sh` could only start the shared arm with default flags, so it gained
an `SRV_EXTRA` knob (commit `888cda9`). That is the one code change the campaign required.

### 5.2 · `r6_row.py` did not enforce run card gate 1 for X3L

`STRANDING_CELLS` was `{X1, X2}`, so an X3L row that stranded nothing would have been
verdicted `ok` while the run card says it voids. X3L was added to the set (commit `d924b20`)
**before** any X3L row existed, so nothing already committed changes. In the event every row
stranded 10.8–29.0 MB, so the gate never fired — but it was armed rather than eyeballed.

### 5.3 · The binaries were not rebuilt

`window-harness` and `exact-server-seg10` are the 2026-09-06 builds, the same ones the 64 KB
real-path campaign used. The only source changes since are `--mode stall` — a separate
module whose commit states it shares no code path with `client.rs`, and whose only
`client.rs` edit is `fn` → `pub(crate) fn` — and the loss-regime sampler, which is compiled
out without `--features telemetry`. Rebuilding would have traded comparability for nothing.

### 5.4 · The fixture was generated on the rig, and checksummed

The run card prefers this ("Regenerating on the rig itself is faster if you can"). The local
command it gives would also have rewritten the tracked `frames_500x250k/README.md` with the
generator's stub, since `gen_one` overwrites it. Both copies hash to
`ca71265fd75c04c050b88c19372c79856c629c3e30671148a2438fe6fd8dc237`.

### 5.5 · Calibration went to its own TSV

`calibration_x3l.tsv` and `calibration_x3l_recheck.tsv` rather than the shared
`calibration.tsv`, which has no fixture column — 250 KB rows would have been
indistinguishable from the 64 KB rows already in it at the same delay/rate/loss.

### 5.6 · `perframe_fair` was not run

As the run card directs: already settled (worse in all twelve real-path comparisons), its
control is known invalid, and it would have cost a third of the rig time.

---

## 6 · Limits, unchanged

- **One rig, one client, one trace, one fixture, one cache size, one depth**, n = 3.
- **Both endpoints are datacentre grade.** Handovers, fading and order-of-magnitude
  bandwidth change live at the client's radio edge and are absent here (A1–A3).
- **Shaping is egress-only**; the ask path is unshaped.
- **GSO is off in both arms**, which is what makes netem's loss i.i.d. per datagram and the
  comparison fair — but it is not how the server would run in production. The result says
  per-frame is worse under i.i.d. loss at 250 KB; the GSO-on real-path condition at this
  frame size is unmeasured.
