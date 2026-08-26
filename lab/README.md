# wt-pacs lab (scaffolding)

Measurement for [`docs/window-saturation-experiment.md`](../docs/window-saturation-experiment.md)
and Q2 (head-of-line). **No product crate depends on these.**

## Crates

| Crate | Purpose |
| ----- | ------- |
| `window-harness` | Headless client — `--mode saturate` (E1), `--depth` + traces (E2) |
| `cold-page-bench` | Warm/cold `frame_slice` + heartbeat stall (E3) |

## Run

```bash
./lab/scripts/gen_tf_fixtures.sh          # ~32 KB / ~250 KB studies
./lab/scripts/e1_saturation_sweep.sh      # → .local/measurements/E1_SATURATION.tsv
./lab/scripts/e2_miss_cost_sweep.sh       # → .local/measurements/E2_MISS_COST.tsv
cargo run -p cold-page-bench --release -- --study lab/fixtures/queue_large/queue_large.sbnd
```

Focused defaults: RTT≈0 (localhost read pacing). Add netem for RTT axis later.
