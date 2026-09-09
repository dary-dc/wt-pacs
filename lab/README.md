# wt-pacs lab (scaffolding)

Measurement for [`docs/window-saturation-experiment.md`](../docs/window-saturation-experiment.md)
and Q2 (head-of-line). **No product crate depends on these.**

## Crates

| Crate | Purpose |
| ----- | ------- |
| `window-harness` | Headless client — `--mode saturate` (E1), `--depth` + traces (E2), `--mode stall` (pathological client). Stream-shape cells need `--reader-mode open` |
| `cold-page-bench` | Warm/cold `frame_slice` + heartbeat stall (E3) |
| `telemetry-bench` | Telemetry pipeline microbench: emit seams under contention, drain shapes at scale — no network, no product crate. See `docs/telemetry/analysis-scale-and-serving-path-2026-09-06.md` §5 |

## Run

```bash
./lab/scripts/gen_tf_fixtures.sh          # ~32 KB / ~250 KB studies
./lab/scripts/e1_saturation_sweep.sh      # → .local/measurements/E1_SATURATION.tsv
./lab/scripts/e2_miss_cost_sweep.sh       # → .local/measurements/E2_MISS_COST.tsv
cargo run -p cold-page-bench --release -- --study lab/fixtures/queue_large/queue_large.sbnd

# Server telemetry pipeline baseline (docs/telemetry/analysis-scale-and-serving-path-2026-09-06.md §5)
lab/scripts/telemetry_bench_matrix.sh                       # → .local/measurements/telemetry-bench-*.jsonl
SERVER_DEFAULT=… SERVER_TELEMETRY=… BIND=127.0.0.1 HARNESS_IPV4=1 \
  lab/scripts/telemetry_e2e_baseline.sh                     # → .local/measurements/telemetry-e2e-*.jsonl
SERVER_TELEMETRY=… BIND=127.0.0.1 HARNESS_IPV4=1 \
  lab/scripts/telemetry_kill_test.sh                        # SIGKILL mid-run: rows + timer summary survive
```

Focused defaults: RTT≈0 (localhost read pacing). Add netem for RTT axis later.

This lane's campaign drivers (`lab/transport/`, extra fixtures/traces) are on tag
`archive/transport-lab-2026-09`. Restore: see [`docs/transport/README.md`](../docs/transport/README.md).
