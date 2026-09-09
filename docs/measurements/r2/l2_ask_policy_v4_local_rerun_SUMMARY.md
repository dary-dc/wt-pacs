# L2 ask-policy v4 local rerun — mechanism check (dynfb in the grid)

**Date:** 2026-09-07 · **Branch:** `cursor/l2-harness-fix-plan-c999`  
**What this is:** the pre-registered local grid after the methodology fix. Emulator only
(`--rtt-ms` + LinkPacer). **Not a policy lock. Not a substitute for the cloud rerun.**

**Script:** `RTTS=60 lab/scripts/l2_ask_policy_v4_local.sh`  
**Raw:** `.local/l2/v4-local-rerun/` (gitignored). Summariser: `lab/scripts/l2_v4_summarize.py`.  
**Primaries** (written before the run): `lateness_median_ms`, `stranded_bytes`.
`p95_lateness_ms` is diagnostic.

The earlier 126-row local file (`.local/l2/v4-local/`, three RTTs, `dynpath`/`bounded`, no
`dynfb`) stays as history: [`l2_ask_policy_v4_local_SUMMARY.md`](l2_ask_policy_v4_local_SUMMARY.md).

## Grid

| | |
| - | - |
| Where | loopback, LinkPacer 10 Mbps, `--rtt-ms 60` |
| Traces | scroll, jump · 40 ms steps |
| Arms | control · window · adr · bulk · **dynfb** · dynclean |
| n | 3, shuffled |
| Integrity | **36/36** `run_rc=0`, no empty waits, no drain fail, no oscillation, `duplicate_asks=0` |

`window` = prefetch `D−1`, no cap. `adr` = formula `D=4` + same prefetch. `dynfb` =
`--dynamic-depth --rtt-source first-byte` (no `--path-rtt-ms`). `dynclean` = hold-D control.

## Registered primaries (median of 3 runs)

### Scroll

| arm | lateness_median_ms | stranded_KB | D observed |
| --- | ---: | ---: | --- |
| control | 63.4 | 0 | — |
| window | 0.0 | 0 | — |
| adr | 0.0 | 0 | 4–4 |
| bulk | 0.0 | 0 | — |
| dynfb | 0.0 | 0 | 3–4 |
| dynclean | 0.0 | 0 | 4–4 |

### Jump

| arm | lateness_median_ms | stranded_KB | p95 (diagnostic) | D observed |
| --- | ---: | ---: | ---: | --- |
| control | 64.3 | 0 | 73 | — |
| window | 0.0 | 96 | 50 | — |
| adr | 0.0 | 96 | 50 | 4–4 |
| bulk | 23.7 | **768** | 331 | — |
| dynfb | 0.0 | 96 | 51 | 3–4 |
| dynclean | 0.0 | 96 | 51 | 4–4 |

Simulator p95 vs harness p95 still misses by 12–100 % (warm-up / no QUIC start). Reported, not
smoothed. Rank on the primaries above, not on that gap.

## What this can support

- **Prefetch vs none:** scroll median 0 vs ~63 ms. Same mechanism as the earlier local file.
- **Bulk vs others on stranded_bytes:** jump 768 KB vs 96 KB (prefetch `K`) vs 0 (control). Bulk
  also loses jump median (24 vs 0).
- **`window` vs `adr` on median:** tie (both 0). Formula `D=4` at emulated 60 ms does not bind.
  This is not “the cap wins” and not “the cap costs.”
- **`dynfb` vs `adr`:** first-byte **moved `D`** (warm-up 4 → 3 on every run, both traces). It
  did **not** ratchet to 16. Reader primaries matched `adr` (median 0, stranded 96 KB). Moving
  one step on an unsaturated emulator is not a reason to adopt or reject live adaptivity.
- **`dynclean`:** held 4–4 on every run. Sanity pass.

## What this cannot support

- A shaped-path ranking, a loss ranking, or “lab implements fixed `D`.”
- “Do not adapt.” `dynfb` was in the grid and did not lose on a registered primary.
- The void 182-row cloud file.

A shaped-path rerun would still be required to rank `window` vs `adr` or to talk about
loss. The investigation closed without it:
[`L2-ask-policy-CLOSED.md`](../../lanes/L2-ask-policy-CLOSED.md).
