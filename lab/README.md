# wt-pacs lab (scaffolding)

Measurement for [`docs/window-saturation-experiment.md`](../docs/window-saturation-experiment.md)
and Q2 (head-of-line). **No product crate depends on these.**

## Crates

| Crate | Purpose |
| ----- | ------- |
| `window-harness` | Headless client — `--mode saturate` (E1), `--depth` + traces (E2) |
| `cold-page-bench` | Warm/cold `frame_slice` + heartbeat stall (E3) |
| `telemetry-bench` | Telemetry pipeline microbench: emit seams under contention, drain shapes at scale — no network, no product crate. See `docs/telemetry/analysis-scale-and-serving-path-2026-09-06.md` §5 |

## N6 — WASM vs TypeScript client (scripts, not crates)

| Script | Purpose |
| ------ | ------- |
| `scripts/link_shim.py` | User-space bottleneck link (FIFO + delay + tail drop) in front of the server's UDP port — this kernel has no netem |
| `scripts/link_shim_check.py` | What the shim actually delivers: RTT, jitter, goodput, loss |
| `scripts/n6_campaign.py` | One cell: two arms interleaved, order alternated, fresh server per run. Drives `server/scripts/verify_e2e.py` unchanged via `--wt-url`. `--arms ts,ts` is the A/A control |
| `scripts/n6_analyze.py` | Controls first, then the comparison — per-run permutation test and pooled distributions |
| `scripts/n6_run_all.sh` | The whole campaign |

Report: [`docs/client-runtime-comparison-2026-09-06.md`](../docs/client-runtime-comparison-2026-09-06.md)

## Run

```bash
./lab/scripts/gen_tf_fixtures.sh          # ~32 KB / ~250 KB studies
./lab/scripts/e1_saturation_sweep.sh      # → .local/measurements/E1_SATURATION.tsv
./lab/scripts/e2_miss_cost_sweep.sh       # → .local/measurements/E2_MISS_COST.tsv
cargo run -p cold-page-bench --release -- --study lab/fixtures/queue_large/queue_large.sbnd

# N6 — WASM vs TypeScript client (docs/client-runtime-comparison-2026-09-06.md)
./lab/scripts/link_shim_check.py --delay-ms 30 --rate-mbit 10   # the link is the link it claims
./lab/scripts/n6_run_all.sh                                     # → .local/measurements/n6/
./lab/scripts/n6_analyze.py --all

# Server telemetry pipeline baseline (docs/telemetry/analysis-scale-and-serving-path-2026-09-06.md §5)
lab/scripts/telemetry_bench_matrix.sh                       # → .local/measurements/telemetry-bench-*.jsonl
SERVER_DEFAULT=… SERVER_TELEMETRY=… BIND=127.0.0.1 HARNESS_IPV4=1 \
  lab/scripts/telemetry_e2e_baseline.sh                     # → .local/measurements/telemetry-e2e-*.jsonl
SERVER_TELEMETRY=… BIND=127.0.0.1 HARNESS_IPV4=1 \
  lab/scripts/telemetry_kill_test.sh                        # SIGKILL mid-run: rows + timer summary survive
```

Focused defaults: RTT≈0 (localhost read pacing). Add netem for RTT axis later.
