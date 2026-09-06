# wt-pacs lab (scaffolding)

Measurement for [`docs/window-saturation-experiment.md`](../docs/window-saturation-experiment.md)
and Q2 (head-of-line). **No product crate depends on these.**

## Crates

| Crate | Purpose |
| ----- | ------- |
| `window-harness` | Headless client — `--mode saturate` (E1), `--depth` + traces (E2) |
| `cold-page-bench` | Warm/cold `frame_slice` + heartbeat stall (E3) |
| `aead-bench` | Per-packet AEAD throughput, ring vs aws-lc-rs (QUIC datagram sizes) |
| `netsim` | Userspace UDP path simulator — delay, loss, rate, finite queue. Stands in for `sch_netem`, which this kernel does not have |

## Run

```bash
./lab/scripts/gen_tf_fixtures.sh          # ~32 KB / ~250 KB studies
./lab/scripts/e1_saturation_sweep.sh      # → .local/measurements/E1_SATURATION.tsv
./lab/scripts/e2_miss_cost_sweep.sh       # → .local/measurements/E2_MISS_COST.tsv
cargo run -p cold-page-bench --release -- --study lab/fixtures/queue_large/queue_large.sbnd
```

Focused defaults: RTT≈0 (localhost read pacing). Add netem for RTT axis later.

## QUIC transport arms

Measurements: [`docs/quic-transport-optimization.md`](../docs/quic-transport-optimization.md).
Implementation spec (portable across the server rewrite, ranked for p95):
[`docs/transport-optimization-spec.md`](../docs/transport-optimization-spec.md).

```bash
# unshaped loopback — the CPU-bound regime (copies, crypto, GSO)
SRV_FLAGS="--send-path chunked" ./lab/scripts/quic_opt_bench.sh chunked \
  target/release/exact-server frames_250k 4,16 3

# rate-shaped, in a private netns (needs iproute2; tbf only, no netem)
RATE=1600mbit ./lab/scripts/quic_opt_shaped.sh chunked \
  target/release/exact-server frames_250k 16 3

cargo run --release -p aead-bench --no-default-features --features ring
cargo run --release -p aead-bench --no-default-features --features aws-lc-rs
```

```bash
# multi-client — use this for server-side arms; one harness caps a session at ~1.4 Gbps
SRV_FLAGS="--send-path chunked" ./lab/scripts/quic_opt_multiclient.sh chunked \
  target/release/exact-server 4

# GSO segment cap arms (patches quinn outside the tree)
./lab/scripts/gso_cap_experiment.sh 10 32 44
```

`SRV_FLAGS` passes arm-specific flags to `exact-server`; unset knobs keep quinn's own
defaults, so an arm that changes nothing measures nothing. **Interleave arms within each
repeat** — running one arm to completion then the next let host drift land on one arm and
produced a wrong answer once already.

## Latency campaigns (L4) — RTT, loss and p95

`netsim` is a userspace UDP path simulator. It exists because this kernel has no
`sch_netem` (Firecracker, no loadable modules) and `tbf` gives rate only, so without it
every congestion-control, initial-window and loss question is unanswerable.

**It is valid for latency questions only.** It forwards datagram-by-datagram in userspace,
which destroys the server's send-side GSO batching and adds its own per-packet cost — so
no CPU or throughput ceiling may be quoted through it. Use the direct loopback rigs above
for those.

```bash
# validate the instruments first — a failure here voids the campaign
./lab/scripts/e0_netsim_validate.sh

# build server arms with knobs the product does not expose (initial window, GSO cap).
# Patches quinn OUTSIDE the tree; `server/` is never modified and no fork is committed.
./lab/scripts/quinn_lab_build.sh 10 32

# the campaign, then the summary
REPEATS=3 ./lab/scripts/l4_run_all.sh e12 e3 e4 e5
python3 lab/scripts/l4_analyse.py .local/measurements/l4/e12.tsv cubic_iw12k
```

Deployment cells are fixed in [`docs/lanes/L4-preregistration.md`](../docs/lanes/L4-preregistration.md):
**A** 30 ms / 50 Mbps / 0 %, **B** 60 ms / 25 Mbps / 0.5 %, **C** 150 ms / 10 Mbps / 2 %.
`l4_analyse.py` enforces the pre-registered stop conditions and marks offending rows VOID;
it reports medians and ranges rather than means, because three repeats do not support more.

The trace matters as much as the arms. `cine_scrub_30fps.json` steps every 33 ms over 80
unique frames, so demand (~7.9 Mbps at 32 KB) actually approaches the cells' capacity.
The older traces step at 111–185 ms, which every cell absorbs — with those, `p95_wait_ms`
is 0 in cell A because over 95 % of wants are cache hits, and no arm can be ranked.
