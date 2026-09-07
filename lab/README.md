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

## L2 ask policy (reworked 2026-09-06)

Conclusions: `docs/l2-ask-policy-design-2026-09-06.md`. The harness (`window-harness`) separates
`--depth` (in-flight cap; the on-screen frame is exempt) from `--prefetch` (lookahead in the
direction of travel), emulates a path RTT on both halves of the round trip (`--rtt-ms`), and reports
lateness by step. Server for every local driver:
`target/release/exact-server --study lab/fixtures/frames_32k/frames_32k.sbnd --stream-mode shared --bind 127.0.0.1`.
Outputs go under `.local/` (gitignored); the browser probe needs Node with Playwright and a Chromium
(`PLAYWRIGHT_MODULE` / `CHROME_BIN` override the defaults in `bench/run_page.mjs`).

| Driver | What |
| ------ | ---- |
| `scripts/l2_policy_sim.py --validate` · `--grid --step-ms 16|40` · `--dynamic` · `--cell …` · `--emit-traces lab/traces` | FIFO-pipe simulator of the shared stream; validated on the v2 rig rows; generates `traces/l2_reversal.json` and `traces/l2_jump.json` |
| `scripts/l2_local_crosscheck.sh` | The same cells on the loopback harness and in the simulator, side by side |
| `scripts/l2_harness_smoke.sh` | Ten gates that can fail (one negative control must fail); run before any rig campaign |
| `scripts/l2_ask_policy_v4_cloud.sh` | The rig campaign the review asked for — prepared, not run (needs the rig key and netem) |
| `scripts/l2_v2_order_model.py` | The two-parameter order model that first reproduced the v2 rows; superseded by the simulator, kept as the record |
| `bench/wt_stats_probe.html` | Does the browser expose `WebTransport.getStats()` RTT to a page? (Chromium 141: no) |
| `scripts/rig_lock.sh` · `scripts/cloud_netem.sh … [loss] [limit]` · `cloud_netem.sh stats` | Rig round-robin lock; netem with loss and an explicit queue limit; drop counters |
