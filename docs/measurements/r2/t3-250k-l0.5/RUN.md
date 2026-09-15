# t3-250k-l0.5

Queue run 1, re-release after `17d4123`. `lab/scripts/stream_shape_cells.sh` then `lab/scripts/stream_shape_pool.py`.

## Binaries

Same binaries as `t3-250k-l0` (`8b903cd`): built from `a63ab3063fedcd39fc9fc9d5365bf3150afd0b39`. Scripts from `17d4123`.

| name | path copied to the rig | sha256 |
| --- | --- | --- |
| `exact-server` | `/home/ubuntu/bin/exact-server` | `20d48ed9e25341339cf1ccb64b7dcf9797df44a0676491671c70092f81b0f0ae` |
| `window-harness` | `/home/ubuntu/bin/window-harness` | `dd04ef7f2b43820293e12105cbc7c0e5c0c2fa9fc79fdacb575089a42e628e37` |

Arms: `shared`, `pool:2`, `per-frame`. Servers logged `workers=2`.

## Host

- `uname -r`: `6.17.0-1011-oracle`
- cores: 2
- MemTotal: 954 MB
- started: `2026-09-15T00:48:49+00:00`

Cell stderr:

```
frame=250000B wire=200ms step=280ms
qdisc netem 805c: root refcnt 2 limit 1000 delay 30ms loss 0.5% rate 10Mbit
```

`RATE_MBIT=10 RTT_MS=60 LOSS_PCT=0.5 LOSS_MODEL=iid REPS=6 DEPTH=2`
`--read-bps 0 --step-interval-ms 280`

Arm order reverses every repeat. 18 JSON files. `sudo unshare --net`. Host `lo` stayed `noqueue`. `exact-server-q` on UDP 4437 left running.

## Deviations

None beyond the standing ones in the runbook.

## What the rows show (not a verdict)

Every JSON has `read_bps=0`. `censored_frac` is 0 on 16/18 repeats; `shared.r1` is 0.0864 and `per-frame.r1` is 0.0247. `center_asks_dropped` is 14 on `shared.r1` and 10 on `per-frame.r1`, 0 otherwise. `cache_hit_rate` is below 0.9 on every repeat. No `rcvbuf_drops` field. Server logs have no `open_uni` / block line.

## Pooler, verbatim

`lab/scripts/stream_shape_pool.py` on the 18 JSONs. Exit 0.

```
arm          runs  misses    p95_ms  median_ms    vs ref  CI95
shared          6     139  20922.59     302.34         —  
per-frame       6     163   2953.84     354.24    -85.9%  [-92.2, -18.5]
pool:2          6     290    513.68     324.42    -97.5%  [-97.8, -87.2]

A CI spanning zero is not a result. T3's bar is 15% on the reference arm.
```
