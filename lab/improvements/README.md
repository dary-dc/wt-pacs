# Improvements-lab drivers (archived from the tip)

Measurement drivers for [`docs/improvements/`](../../docs/improvements/README.md).
**No product crate depends on these.** They are not on the branch tip; this directory
exists only in the archive snapshot. Restore:

```bash
git checkout archive/improvements-lab-2026-09 -- lab/improvements
```

Outputs go under `.local/` (gitignored). Browser drivers need Node with Playwright and a
Chromium; override with `PLAYWRIGHT_MODULE` / `CHROME_BIN`.

## 2026-09-06

Evidence: `docs/improvements/2026-09-06.md`.

| Driver | What |
| ------ | ---- |
| `scripts/sendpath_ab_bench.sh OUT A_LABEL A_BIN [B_LABEL B_BIN]` | Server A/B: telemetry builds, one saturate harness per cell, `send_us`/`serve_us` percentiles, CPU per frame, VmHWM |
| `scripts/rss_timeline.sh LABEL BIN OUT` | Server VmRSS once a second through one saturate session |
| `scripts/callgrind_run.sh LABEL BIN FIXTURE MODE` | Server under `valgrind --tool=callgrind` while one harness saturates; annotated self/inclusive costs |
| `scripts/client_profile.mjs HTTP ARM QUERY OUT` | One harness cell under the Chromium sampling profiler; self time per function |
| `scripts/client_ab_profile.sh ARTIFACTS [OUT]` · `scripts/client_ab_summarize.py OUT` | Before/after client profiles, both arms, three cells, medians |
| `scripts/refusals_e2e.mjs` · `scripts/frame0_e2e.mjs` | Browser regression drivers for `client/harness/refusals.html` and the frame0 / bulk buttons |
| `bench/textencoder.html` · `bench/byob_probe.html` · `bench/run_page.mjs` | Micro-benchmark and probe pages; `run_page.mjs URL` prints a page's `__rows` |

## 2026-09-08

Evidence: `docs/improvements/2026-09-08.md`.

| Driver | What |
| ------ | ---- |
| `bench/ts_session_stub.mjs BUNDLE` | The product TypeScript client in plain Node against a stub `WebTransport` — D2 / D3 reproductions |
| `bench/wasm_variants.sh` | Builds `transport-wasm` under several release-profile variants into `.local/wasm-variants/` and prints `.wasm` / gzip sizes (needs `wasm-pack`, `wasm-opt`) |
| `bench/wasm_init_time.mjs HTTP PKG_PATH [RUNS]` | `import()` + `init()` time of one WASM package in Chromium, median of RUNS fresh contexts |
| `scripts/client_profile_groups.mjs HTTP ARM QUERY OUT` | Like `client_profile.mjs`, grouped by source, plus `tap_read_cost_us` when `telemetry=1` |
