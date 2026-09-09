# L1 v3 Isolation — D=1 wait vs RTT+Tf

**Date:** 2026-09-04 · **Arm:** S (shared) · **D=1** · **loss=0** · 5 repeats/cell  
**Fixture:** 32 KiB frames · harness `--rtt-ms 0 --read-bps 0`  
**Note:** First attempt left a stale `rate 10Mbit` on the return path when switching to
`RATE=none`; results below are from the **re-run after delete+add on both veths**.

## Isolation A — delay+rate vs delay-only

Ideals differ by cell:

| rate | Ideal wait |
| --- | --- |
| `10mbit` | **RTT + Tf** (Tf = 25.6 ms = 32 KiB @ 10 Mbit) |
| `delayonly` | **≈ RTT** (veth is not rate-limited; serialization ≪ 1 ms) |

| rate | RTT | median miss_p95 | median miss_mean | ideal | excess p95 | excess mean |
| --- | --- | --- | --- | --- | --- | --- |
| 10mbit | 60 | 109.9 | 98.8 | 85.6 | **+24.3** | +13.2 |
| 10mbit | 150 | 239.2 | 220.7 | 175.6 | **+63.6** | +45.1 |
| delayonly | 60 | 97.5 | 86.9 | 60.0 | **+37.5** | +26.9 |
| delayonly | 150 | 223.2 | 207.2 | 150.0 | **+73.2** | +57.2 |

Absolute drop when removing rate (same RTT): ~12 ms @ 60 and ~14 ms @ 150 on the means —
about **one Tf**, i.e. the serialization you expect from the 10 Mbit shaper. The
**RTT-proportional** excess remains.

### Read (Isolation A)

**Netem `rate` is not the main cause of the ~1.5×RTT band.** It adds roughly Tf. The leftover
excess still scales with RTT under delay-only (~0.4·RTT on the mean), so the leading suspect is
**on-path after the server has enqueued** (QUIC multi-flight / cwnd / ACK timing), not FoD and not
the rate limiter alone.

## Isolation B — server ask → write_all (`WT_SERVE_TIMING=1`)

Harness (rtt=60, rate=10mbit): miss_p95=110.1 · miss_mean=99.2 · asks=80

`serve_timing` samples: **n=80**

| stamp | median | p95 |
| --- | --- | --- |
| ask_to_first_ms | 0.014 | 0.030 |
| ask_to_last_ms | 0.021 | 0.052 |

### Read (Isolation B)

**FoD locate/write is not the latency.** Median ask→last `write_all` is **0.02 ms** (into quinn’s
send buffer). Client wait excess is **after enqueue**.

## Verdict

| Hypothesis | Result |
| --- | --- |
| FoD / disk / serial server loop | **Ruled out** (B) |
| Netem `rate` as sole cause of 1.5×RTT | **Ruled out** (A; rate ≈ +Tf only) |
| QUIC path after enqueue (CC / multi-flight / ACK delay) | **Leading cause** of RTT-proportional excess |

Product implication: the excess sits in **transport/stack + path**, not in ask handling. Worth
vendor attention for latency, but L1’s S4b empirical band remains a **gate calibration**, not a
claim that FoD needs 1.5 RTTs.

Artifacts: `l1_s_vs_q_loss_v3.isolate.tsv`, `raw/l1v3/isolate/`
