# QUIC transport optimisation — raw data

Analysis: [`../../quic-transport-optimization.md`](../../quic-transport-optimization.md).
**T2** — single host, loopback, `tbf` shaping in a private netns. No netem on this
kernel, so there is **no RTT and no loss axis**; read the analysis's limits section
before quoting any congestion-control or window row.

| file | rig | what varies |
| ---- | --- | ----------- |
| `loopback_arms.tsv` | `lab/scripts/quic_opt_bench.sh` | send path, crypto provider, GSO, windows, MTU, ACK frequency, congestion, socket buffers, `send_fairness` |
| `shaped_arms.tsv` | `lab/scripts/quic_opt_shaped.sh` | the same arms at 47 and 189 Mbps achieved |
| `copy_knee.tsv` | `lab/scripts/quic_opt_shaped.sh` | copy vs chunked across five rates — the knee sweep `send-path-copy-costs.md` asked for |
| `aead.tsv` | `lab/aead-bench` | ring vs aws-lc-rs, per-packet seal at 1200 / 1452 / 14520 B |

Columns: `mbps` is the harness `fill_rate` (dwell goodput); `cpu_s_per_gb` is server
CPU seconds over the session divided by bytes on the wire, which is the density metric
and the one that separates arms at rates where the link is the bottleneck. Three
repeats per cell, all rows kept.

Shaped rows label the **configured** TBF bucket. Achieved goodput is a consistent
47.3 % of it on loopback — arms are compared at equal achieved rate, so the labels are
identifiers, not link rates.
