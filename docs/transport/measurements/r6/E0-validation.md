# E0-R6 — instrument validation

Run **before** any arm comparison. Its job is not to produce good numbers but to answer one
question: **can this rig still generate the effect it is about to measure?**

Three previous reviews all watched the measurement and none watched the mechanism. This is
the check that was missing.

---

## E0-R6a — does `--reader-mode open` do what its name says?

Same cell, same server, same trace; only the reader mode differs.
Cell: 50 ms RTT, 20 Mbps, 0.1 % loss, depth 8, cache 64 frames, step-scale 1.

| stream mode | reader | stranded frames | stranded bytes | p95 (ms) | frames delivered |
| ----------- | ------ | --------------- | -------------- | -------- | ---------------- |
| shared | closed | **0** | **0.00 MB** | 130.9 | 654 |
| shared | **open** | **286** | **18.31 MB** | 1728.3 | 390 |
| per-frame | closed | **0** | **0.00 MB** | 297.4 | 654 |
| per-frame | **open** | **304** | **19.46 MB** | 3207.9 | 378 |

**Verdict: pass, and the margin is not subtle.** The closed-loop reader strands *exactly
zero bytes* under both stream shapes. Not "few" — none, and it cannot, because it refuses
to advance until the frame it is waiting for has arrived, so every byte in flight is by
construction a byte it still wants.

This is the direct quantitative confirmation of the defect withdrawn in
[`../../transport-conclusions.md`](../../transport-conclusions.md) §2: **head-of-line
blocking had no opportunity to occur in any campaign before R6**, so no stream-shape
result from any of them was admissible.

Two secondary observations, recorded because they matter for reading the campaign:

- p95 rises 13× (shared) and 11× (per-frame) between modes. The absolute latencies in
  every previous campaign are therefore **underestimates** of what a reader who keeps
  scrolling experiences.
- Delivered frames *fall* (654 → ~380) in open mode. The reader stops re-asking frames it
  has scrolled past, so an arm cannot be compared on latency alone — which is why
  `censored_frac` is a decision rule and not a footnote.

This run is at step-scale 1, where `center_asks_dropped` is 32–60. **It is a validation
run, not a result**, and would be VOID as a campaign row.

---

## E0-R6b — calibrating the operating point

The reader's offered load must be set against the rate the link can **achieve**, not the
rate it is labelled with. The two differ by an order of magnitude at realistic loss:

| RTT | loss | Cubic's Mathis ceiling |
| --- | ---- | ---------------------- |
| 50 ms | 0.10 % | 9.00 Mbps |
| 50 ms | 1.00 % | 2.85 Mbps |
| 600 ms | 1.00 % | **0.24 Mbps** |

A 30 fps reader over 64 KB frames with a 64-frame cache and depth 8 demands **~15 Mbps**.
The first validation attempt used the 600 ms / 1 % cell — a **62× overload** — and produced
93 % censoring with 597 of 681 centre asks dropped. Every arm collapses identically there
and nothing is distinguished. **The new counters caught this before any arm was compared**,
which is the entire point of adding them.

`--step-scale` multiplies the trace's step interval. Calibration sweeps it on the
**incumbent arm only** (shared stream) and the chosen value is then **frozen across every
arm in that cell**.

### 50 ms, 20 Mbps, 0.1 % loss

| scale | stranded | censored | centre dropped | p95 | nz_n | verdict |
| ----- | -------- | -------- | -------------- | --- | ---- | ------- |
| 1 | 283 | 2.3 % | **29** | 1762.0 | 586 | void — centre asks dropped |
| **2** | **152** | 0.0 % | 0 | 735.8 | 278 | **admissible → X1** |
| 4 | 4 | 0.0 % | 0 | 80.7 | 60 | admissible, but barely strands |
| 8 | **0** | 0.0 % | 0 | 79.6 | 54 | no stranding |
| 16 | — | — | — | — | — | trace exceeds the run timeout |

### 50 ms, 20 Mbps, 0 % loss

| scale | stranded | censored | centre dropped | p95 | nz_n | verdict |
| ----- | -------- | -------- | -------------- | --- | ---- | ------- |
| **1** | **137** | 0.0 % | 0 | 82.7 | 358 | **admissible → X2** |
| 2 | 20 | 0.0 % | 0 | 79.5 | 111 | admissible, weak |
| 4 | 0 | 0.0 % | 0 | 79.6 | 55 | no stranding |
| **8** | **0** | 0.0 % | 0 | 79.5 | 54 | **→ N0, negative control** |

### 50 ms, 20 Mbps, 1 % loss

| scale | stranded | censored | centre dropped | p95 | nz_n | verdict |
| ----- | -------- | -------- | -------------- | --- | ---- | ------- |
| 6 | 206 | 0.0 % | 0 | 1117.5 | 352 | admissible, but strands strongly |
| **8** | **35** | 0.0 % | 0 | 180.8 | 80 | **admissible → X3** |

---

## A finding from calibration itself

**Loss and stranding are not independently controllable.** There is no operating point on
this trace with strong loss and no stranding, because loss lowers achievable throughput and
lower throughput is what causes stranding. Compare at step-scale 8: 0 % loss strands 0
frames, 1 % loss strands 35.

So the planned 2 × 2 factorial is not fully realisable, and X3 is labelled
**"loss-dominant, weak stranding"** rather than "loss without stranding". X2 and N0 remain
logically clean in the other direction: at 0 % loss nothing is retransmitted, so
receiver-side head-of-line blocking cannot occur there whatever else does.

A degenerate cell was also rejected here rather than run: at 0.1 % loss and step-scale 8,
p95 is 79.6 ms **with** loss against 79.5 ms **without** — no effect to attribute to
anything. That is why X3 uses 1 %.

---

## E0-R6c — calibrating on one seed is not enough

**Found the hard way, and the failed run is kept as `r6scrub_scale6_VOIDED.tsv` rather than
deleted.**

The X3S robustness cell (the decisive 1 % loss cell, driven by the scroll trace) was
calibrated at step-scale 6 on the calibration seed and came back clean: 100 stranded frames,
`nz_n` 177, **zero** centre asks dropped. On that basis it was frozen and the campaign run.

It then voided **4 of 9 rows**:

| repeat | shared | perframe_fair | perframe_fifo |
| ------ | ------ | ------------- | ------------- |
| 1 | ok | ok | ok |
| 2 | ok | **VOID** center-dropped | ok |
| 3 | **VOID** | **VOID** | **VOID** |

The seeds get harder. By repeat 3 every arm had fallen far enough behind that the hard
outstanding ceiling bound and centre asks were suppressed, which makes those steps a
measurement of the harness's ask policy rather than of the transport.

**The operating point has to be admissible under the campaign's own loss realisations, not
just under the calibration seed.** Re-validated at step-scale 7 against each campaign seed:

| campaign seed | stranded | censored | centre dropped | nz_n | verdict |
| ------------- | -------- | -------- | -------------- | ---- | ------- |
| 7932 (repeat 1) | 11 | 0.0 % | 0 | 49 | admissible |
| 15851 (repeat 2) | 19 | 0.0 % | 0 | 93 | admissible |
| 23770 (repeat 3) | 34 | 0.0 % | 0 | 121 | admissible |

`e0_r6_calibrate.sh` now takes `SEED=`, and the procedure is: sweep the scale on the
incumbent arm, then **re-check the chosen scale at every seed the campaign will use**,
before freezing it.

This is the same class of failure as the previous four, arriving once more in a new
costume: **a guard that was checked once and assumed to hold thereafter.** The guard itself
worked — it voided the rows rather than letting them through — which is the only reason the
campaign did not quietly report a comparison taken at a broken operating point.
