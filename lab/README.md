# wt-pacs lab (scaffolding)

Measurement for [`docs/window-saturation-experiment.md`](../docs/window-saturation-experiment.md)
and Q2 (head-of-line). **No product crate depends on these.**

## Crates

| Crate | Purpose |
| ----- | ------- |
| `window-harness` | Headless client — `--mode saturate` (E1), `--depth` + traces (E2) |
| `cold-page-bench` | Warm/cold `frame_slice` + heartbeat stall (E3) |
| `aead-bench` | Per-packet AEAD throughput, ring vs aws-lc-rs (QUIC datagram sizes) |

## Run

```bash
./lab/scripts/gen_tf_fixtures.sh          # ~32 KB / ~250 KB studies
./lab/scripts/e1_saturation_sweep.sh      # → .local/measurements/E1_SATURATION.tsv
./lab/scripts/e2_miss_cost_sweep.sh       # → .local/measurements/E2_MISS_COST.tsv
cargo run -p cold-page-bench --release -- --study lab/fixtures/queue_large/queue_large.sbnd
```

Focused defaults: RTT≈0 (localhost read pacing). Add netem for RTT axis later.

## QUIC transport arms

See [`docs/quic-transport-optimization.md`](../docs/quic-transport-optimization.md).

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
