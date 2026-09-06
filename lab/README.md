# wt-pacs lab (scaffolding)

Measurement for [`docs/window-saturation-experiment.md`](../docs/window-saturation-experiment.md)
and Q2 (head-of-line). **No product crate depends on these.**

## Crates

| Crate | Purpose |
| ----- | ------- |
| `window-harness` | Headless client — `--mode saturate` (E1), `--depth` + traces (E2) |
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

## Measurement drivers added 2026-09-06

Evidence they produced: `docs/improvements-2026-09-06.md` and
`docs/measurements/improvements-2026-09-06/`. Browser drivers need Node with Playwright and a
Chromium; defaults point at the Claude Code runner, override with `PLAYWRIGHT_MODULE` / `CHROME_BIN`.

| Driver | What |
| ------ | ---- |
| `scripts/sendpath_ab_bench.sh OUT A_LABEL A_BIN [B_LABEL B_BIN]` | Server A/B: telemetry builds, one saturate harness per cell, `send_us`/`serve_us` percentiles, CPU per frame, VmHWM |
| `scripts/rss_timeline.sh LABEL BIN OUT` | Server VmRSS once a second through one saturate session |
| `scripts/callgrind_run.sh LABEL BIN FIXTURE MODE` | Server under `valgrind --tool=callgrind` while one harness saturates; annotated self/inclusive costs |
| `scripts/client_profile.mjs HTTP ARM QUERY OUT` | One harness cell under the Chromium sampling profiler; self time per function |
| `scripts/client_ab_profile.sh ARTIFACTS [OUT]` · `scripts/client_ab_summarize.py OUT` | Before/after client profiles, both arms, three cells, medians |
| `scripts/refusals_e2e.mjs` · `scripts/frame0_e2e.mjs` | Browser regression drivers for `client/harness/refusals.html` and the frame0 / bulk buttons |
| `bench/textencoder.html` · `bench/byob_probe.html` · `bench/run_page.mjs` | Micro-benchmark and probe pages; `run_page.mjs URL` prints a page's `__rows` |
