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
| `sendpath_interleaved_unshaped.tsv` | `quic_opt_bench.sh`, interleaved | copy / split / chunked, one client |
| `sendpath_interleaved_shaped.tsv` | `quic_opt_shaped.sh`, interleaved | the same three at 378 and 756 Mbps |
| `sendpath_multiclient.tsv` | `quic_opt_multiclient.sh` | the same three with two clients — the rig where the server binds |
| `gso_segment_cap.tsv` | `quic_opt_multiclient.sh` | `MAX_TRANSMIT_SEGMENTS` 10 / 32 / 44, both fixtures |
| `gso_segment_cliff.tsv` | `quic_opt_multiclient.sh` | 40 / 44 / 45 / 48 — locates the 65 535-byte GSO buffer edge |
| `prefault.tsv` | `quic_opt_multiclient.sh` | `--prefault true\|false`, warm cache, both fixtures |

Columns: `mbps` / `agg_mbps` is harness `fill_rate` (summed over clients); `cpu_s_per_gb`
is server CPU seconds over the session divided by bytes on the wire. **Prefer
`cpu_s_per_gb`**: one harness caps a session at ~1.4 Gbps well before the server does, so
single-client throughput is a client ceiling, while CPU per byte measures server work
regardless of which side is limiting. `quic_opt_bench.sh` also emits `srv_cores` and
`cli_cores` — `cli_cores` near 1.00 means the row is a client result. All repeats kept.

`sendpath_interleaved_unshaped.tsv` predates the `cli_cpu_s` / `srv_cores` / `cli_cores`
columns, so re-running `quic_opt_bench.sh` now produces three more columns than that file
has. Nothing else changed about the rig.

The `sendpath_*`, `gso_*` and `prefault` files interleave arms within each repeat so host
drift is common-mode; the earlier files do not, and the host was replaced mid-campaign.
Compare arms within a file, never absolutes across files.

Shaped rows label the **configured** TBF bucket. Achieved goodput is a consistent
47.3 % of it on loopback — arms are compared at equal achieved rate, so the labels are
identifiers, not link rates.

## External corroboration

`gso_segment_cap.tsv` and `gso_segment_cliff.tsv` are not the only evidence for the
segment-cap finding. An ETH Zürich QUIC benchmarking thesis patched the same constant
from 10× to 40× MTU and measured gains in every scenario, up to 2×. The cliff's mechanism
is the Linux 65 527-byte UDP GSO payload limit, and quinn issue #2201 (open) derives the
same bound independently. See the analysis §7 for the full check, including which of these
numbers turned out to be rig-inflated.
