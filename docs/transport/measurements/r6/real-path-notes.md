# R6 on the Oracle rig — what the instrument is, and how it differs from netsim

Companion to [`E0-validation.md`](E0-validation.md), which is the netsim edition of the same
checks. This file records the real-path instrument: what was measured, on what, and every
way in which it is *not* the simulator, so that a disagreement between the two campaigns can
be attributed rather than argued about.

Run from a laptop with ordinary outbound internet, per
[`../../ORACLE-RIG-AGENT-GUIDE.md`](../../ORACLE-RIG-AGENT-GUIDE.md). `cloud_preflight.sh`
passed: TCP :22 reachable, key fingerprint `SHA256:CAD0bvPh5zni9qJ5mZhO3UUr+1Fwg7ZMS70O4blE90g`
matching the cloud-agent row of [`../../cloud-rig-access.md`](../../cloud-rig-access.md),
and `sch_netem` loads.

---

## 1 · The rig, the path, and the client

| | |
| --- | --- |
| server | Oracle E2, São Paulo, `6.17.0-1011-oracle`, **2 vCPU, 954 MB**, x86_64, glibc 2.39 |
| server binary | `target/lab-arms/exact-server-seg10` — the same patched-quinn arm the netsim campaign used |
| client | this laptop, `target/release/window-harness`, ordinary residential internet |
| base path RTT | **28–35 ms**, measured by TCP connect to :22 (which the shaper deliberately bypasses) |
| unshaped throughput | **51.4 Mbps** app-layer, rig → laptop, `--mode saturate` |
| shaped throughput | **18.4 Mbps** app-layer under a 20 Mbit netem cap — 92 % of the cap, the remainder being UDP/IP/QUIC header overhead |

The shaped figure is the one that matters: it establishes that **netem, not the path, is the
bottleneck**, with 2.8× of headroom. Without that check a "20 Mbps cell" could silently have
been a "whatever the internet gave us today" cell.

## 2 · Four ways this instrument is not netsim

Each of these is a real difference, not a nuisance. They are listed because the campaign's
result has to be read through them.

### 2.1 · Shaping is egress-only

`sch_netem` runs on the rig's default route and shapes **server → client**. The ask path,
client → server, is unshaped: no added delay, no loss, no rate cap.

`lab/transport/netsim` shapes **both directions independently** (`lab/transport/netsim/src/main.rs`: "Independent
per-direction drop probability", per-direction rate and queue). So under netsim, 0.1 % loss
also drops 0.1 % of the client's ACKs and asks; here it does not.

This cuts both ways and should not be waved through as "more realistic":

- It **is** more realistic for the deployment shape. A radiologist's downlink carries 64 KB
  frames; the uplink carries a few dozen bytes per ask. Real access links are asymmetric.
- It is also **easier on the transport** than netsim was. Lost ACKs delay congestion-window
  growth and can trigger spurious retransmission; none of that happens here.

The second point is the likely mechanical cause of §3's finding that the rig is about one
step-scale easier than netsim at the same nominal parameters.

### 2.2 · The RTT is not 50 ms

netsim's 25 ms each way *is* 50 ms RTT. The rig adds 25 ms of egress delay on top of a real
28–35 ms internet path, so the cell is **≈53–59 ms RTT**, and it drifts with the internet.

The `rtt_ms` column in `r6cloud.tsv` records **base + delay, measured at campaign start**,
not the netem flag. Writing `delay × 2` there would have understated the path by its entire
base RTT — the kind of column that gets quoted years later as "the 50 ms cell".

All four cells share one path and differ only in loss and reader speed, which is the property
the pre-registration actually depends on. That property holds here.

### 2.3 · There is no seed

netem draws loss from kernel randomness. There is no `--seed`, so the campaign's
`SEED=RUN*7919+13` has no analogue and repeats resample loss **by construction** — which is
what the netsim seed was for in the first place (pre-registration §5, "vary the seed per
repeat, so repeats resample loss rather than replaying it").

The E0-R6c guard survives the translation intact and is *not* skipped. Under netsim it read
"re-check the chosen scale at every campaign seed". Here it reads **"re-run the chosen scale
at N independent realisations and require the band to hold in every one"**, implemented as
`REPS=` in `e0_r6_calibrate_cloud.sh`. §3 below is that check.

### 2.4 · `ns_cpu_s` is meaningless and `ns_qdrop` changes meaning

There is no simulator process to charge CPU to, so `ns_cpu_s` is 0 in every row and the
`netsim-bound` void condition can never fire. It is kept only so the two campaigns share one
schema.

`ns_qdrop` carries netem's own drop counter for the shaped band instead — loss-model drops
plus 500-packet queue overflow, sampled per row. It is the closest analogue of netsim's
`down_queue=`.

---

## 3 · E0-R6a on the real path — the gate that voided four campaigns

Same cell, same server, same trace; **only the reader mode differs**. Rig egress netem
+25 ms one-way, 20 Mbps, 0.1 % loss, depth 8, cache 64, step-scale 1.

| stream mode | reader | stranded frames | stranded bytes | p95 (ms) | centre dropped | frames delivered |
| --- | --- | --- | --- | --- | --- | --- |
| shared | closed | **0** | **0.00 MB** | 85.3 | 0 | 655 |
| shared | **open** | **161** | **10.30 MB** | 97.8 | 0 | 654 |
| per-frame | closed | **0** | **0.00 MB** | 151.3 | 0 | 655 |
| per-frame | **open** | **247** | **15.81 MB** | 151.9 | 0 | 650 |

**PASS, and for the same structural reason as under netsim.** The closed-loop reader strands
exactly zero bytes over a real network too — it cannot strand any, because it refuses to
advance until the frame it is waiting for has arrived. Head-of-line blocking had no
opportunity to occur in any pre-R6 campaign, and that is a property of the *client*, not of
the simulator. The real path confirms it rather than excusing it.

Reproduce with:

```bash
DELAY=25 RATE=20 LOSS=0.1 lab/transport/scripts/e0_r6_reader_validate_cloud.sh
```

## 4 · E0-R6b/c on the real path — the operating point had to be recalibrated

The netsim step-scales are wrong here, exactly as the runbook predicted. Swept on the
**incumbent (`shared`) arm only**, one run per point:

| loss | scale 1 | scale 2 | scale 4 | scale 8 |
| --- | --- | --- | --- | --- |
| **0.1 %** | 155 strand, cdrop 0 — **admissible** | 30 strand | 0 strand | 0 strand |
| **0 %** | 153 strand, cdrop 0 — **admissible** | 30 strand | 0 strand | 0 strand |
| **1 %** | 263 strand, **cdrop 67 — VOID** | 363 strand | 75 strand, cdrop 0 — **admissible** | 0 strand |

Read against the netsim table in [`E0-validation.md`](E0-validation.md) §E0-R6b, **the real
path is one step-scale easier**:

| | netsim | rig |
| --- | --- | --- |
| X1 (0.1 % loss) | scale 2 → 152 stranded | **scale 1 → 155 stranded** |
| X2 (0 % loss) | scale 1 → 137 stranded | **scale 1 → 153 stranded** |
| X3 (1 % loss) | scale 8 → 35 stranded, p95 181 | **scale 4 → 75 stranded, p95 489** |
| N0 (control) | scale 8 → 0 stranded | **scale 4 → 0 stranded** |

Had the netsim column been reused, X1, X2 and X3 would every one have run at **zero
stranding** — that is, the campaign would have compared stream shapes in cells that cannot
produce the effect the comparison is about. This is the fifth time in this project that a
number carried over from a previous rig would have quietly invalidated the next one.

### The E0-R6c re-check, at three independent loss realisations each

Frozen scale, `REPS=3`, incumbent arm:

| cell | loss | scale | stranded (3 runs) | cdrop | censored | nz_n | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| X1 | 0.1 % | 1 | 161, 162, 173 | 0, 0, 0 | 0 % | 383, 381, 403 | **3/3 admissible** |
| X2 | 0 % | 1 | 162, 153, 156 | 0, 0, 0 | 0 % | 384, 383, 378 | **3/3 admissible** |
| X3 | 1 % | 4 | 46, 39, 14 | 0, 0, 0 | 0 % | 115, 103, 71 | **3/3 admissible** |
| N0 | 0 % | 4 | 0, 0, 0 | 0, 0, 0 | 0 % | 57, 55, 58 | **3/3 control holds** |

X3's stranding moves 14 → 46 across realisations, so the realisations genuinely differ; the
weakest still strands and still has a 71-sample tail. N0 strands nothing in all three, which
is the control property, not a failure — `r6_row.py` encodes the same asymmetry
(`STRANDING_CELLS = {X1, X2}`).

Raw: `.local/measurements/r6/cal_cloud/calibration.tsv`, committed here as
[`r6cloud_calibration.tsv`](r6cloud_calibration.tsv).

---

## 5 · What this rig still cannot answer

Unchanged from the runbook, and worth restating so the tier is not quietly promoted:

- **Both endpoints are datacentre grade.** Handovers, fading and order-of-magnitude
  bandwidth changes mid-scroll live at the *client's* radio edge. An Oracle-to-laptop path
  has none of them ([`../../transport-assumption-audit.md`](../../transport-assumption-audit.md) A1–A3).
- **One client, one trace, one fixture, one cache size, one depth**, exactly as under netsim.
- **The base path drifts.** RTT moved 28–35 ms across the session. Within a cell the arms are
  interleaved, so drift is common-mode within a comparison, but absolute latencies are not
  comparable to netsim's.
