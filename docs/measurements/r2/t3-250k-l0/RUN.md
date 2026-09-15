# t3-250k-l0

Queue run 1, re-release after `17d4123`. First attempt (`15b32d8`) is the VOID cell; these rows replace that directory. `lab/scripts/stream_shape_cells.sh` then `lab/scripts/stream_shape_pool.py`.

## Binaries

Built on the runner VM from `a63ab3063fedcd39fc9fc9d5365bf3150afd0b39`. Scripts on the rig are from `17d4123` (`--read-bps 0`, derived `STEP_MS`). rustc 1.88.0.

| name | path copied to the rig | sha256 |
| --- | --- | --- |
| `exact-server` | `/home/ubuntu/bin/exact-server` | `20d48ed9e25341339cf1ccb64b7dcf9797df44a0676491671c70092f81b0f0ae` |
| `window-harness` | `/home/ubuntu/bin/window-harness` | `dd04ef7f2b43820293e12105cbc7c0e5c0c2fa9fc79fdacb575089a42e628e37` |

Arms: `shared`, `pool:2`, `per-frame`. The script does not pass `--workers`; each server logged `workers=2`.

## Host

- `uname -r`: `6.17.0-1011-oracle`
- cores: 2
- MemTotal: 954 MB
- started: `2026-09-15T00:39:23+00:00`

Cell stderr:

```
frame=250000B wire=200ms step=280ms
qdisc netem 805b: root refcnt 2 limit 1000 delay 30ms rate 10Mbit
```

`RATE_MBIT=10 RTT_MS=60 LOSS_PCT=0 LOSS_MODEL=iid REPS=6 DEPTH=2`
`FX=.../frames_250k/frames_250k.sbnd` (80 frames)
`ARMS="shared pool:2 per-frame"`
`TRACE=lab/traces/x3_short_scroll.json`
`--read-bps 0 --step-interval-ms 280`

Arm order in `cell.stderr` reverses every repeat. 18 JSON files.

## Preflight

- One-repeat smoke (`out/smoke-t3-250k-l0-v2`, not committed): all three arms `read_bps=0`, `censored_frac=0`, servers `frames=80`.
- `sudo unshare --net` as in the updated runbook. Host `lo` stayed `noqueue`. `exact-server-q` on UDP 4437 left running.

## Deviations

None beyond the standing ones already folded into the runbook (no `git` on the rig; campaign tree at `/home/ubuntu/wt-pacs-run`; `sudo unshare --net`).

## What the rows show (not a verdict)

Every JSON has `read_bps=0`, `censored_frac=0`, `center_asks_dropped=0`. `cache_hit_rate` is below 0.9 on every repeat. No `rcvbuf_drops` field. Server logs have no `open_uni` / block line (this cell is `window-harness`, not Chromium).

## Pooler, verbatim

`lab/scripts/stream_shape_pool.py` on the 18 JSONs. Exit 0.

```
arm          runs  misses    p95_ms  median_ms    vs ref  CI95
shared          6      74    413.24     202.66         —  
per-frame       6      87    416.62     203.58     +0.8%  [-17.3, +22.5]
pool:2          6     289    482.86     321.37    +16.8%  [+16.5, +41.4]

A CI spanning zero is not a result. T3's bar is 15% on the reference arm.
```
