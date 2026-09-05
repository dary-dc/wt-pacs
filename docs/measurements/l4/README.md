# L4 — p95 time-to-displayable across deployment cells

Pre-registration: [`../../lanes/L4-preregistration.md`](../../lanes/L4-preregistration.md).
**T2** — single host, `lab/netsim` (userspace UDP delay/loss/rate) standing in for
`sch_netem`, which this kernel does not have.

Cells: **A** 30 ms / 50 Mbps / 0 % · **B** 60 ms / 25 Mbps / 0.5 % · **C** 150 ms /
10 Mbps / 2 %. Trace `cine_scrub_30fps` — 160 steps at 33 ms over 80 unique frames, so
demand actually approaches cell capacity. Arms interleaved within each repeat.

| file | experiment |
| ---- | ---------- |
| `e12_iw_x_congestion.tsv` | initial window × congestion controller, at **matched windows** so the two are not confounded |
| `e6_loss_burstiness.tsv` | the same two controllers at burst 1 / 5 / 20, mean loss held constant |

## Read `e6_loss_burstiness.tsv` before quoting anything from `e12`

`e12` was run with uniform Bernoulli loss (`--loss-burst 1`), which is the **most
favourable possible model for a rate-based controller and the most punishing for a
loss-based one**. Holding the mean loss rate constant and only clustering it:

| cell | burst 1 | burst 5 | burst 20 |
| ---- | ------- | ------- | -------- |
| B, cubic → bbr | 345 → 77 ms (−78 %) | 54 → 74 ms (**+38 %, BBR worse**) | 53 → 52 ms (tie) |
| C, cubic → bbr | 1888 → 325 ms (−83 %) | 468 → 262 ms (−44 %) | 175 → 180 ms (tie) |

Cubic's p95 improves ~11× as loss clusters; BBR is comparatively flat. At constant mean
rate, bursty loss means fewer independent congestion *events*, and Cubic reduces its
window per event rather than per lost packet. **A controller comparison that fixes the
loss model has not measured a controller; it has measured the loss model.**

## Reading these columns

- **`p95_wait_ms` is the metric.** Medians and ranges over 3 repeats; three repeats do
  not support a mean and an SD.
- **`fill_rate` is NOT link utilisation in trace mode.** It measures bytes during a
  post-settle dwell, so a client that has fallen behind reports a drained-queue burst and
  over-states the rate — values above the cell's configured rate appear and are an
  artefact of the metric, not of the rig. netsim's limiter was verified exact
  (25 Mbps → 25.0, 50 → 50.0) with a direct UDP blast. Use `wall_s` and `wait_samples`
  to check an arm is not winning by delivering less.
- **`wall_s`** is how long the 5.3 s trace actually took — the honest throughput proxy.
- **`peak_outstanding`, `cli_cpu_s`, `ns_cpu_s`** are the pre-registered stop-condition
  instruments. `l4_analyse.py` marks rows VOID on any breach.

## What netsim may not be used for

It forwards datagram-by-datagram in userspace, destroying the server's send-side GSO
batching and adding its own per-packet cost. **No CPU or throughput-ceiling claim may be
made through it.** Those belong to the direct-loopback rigs in `../quic-opt/`.
