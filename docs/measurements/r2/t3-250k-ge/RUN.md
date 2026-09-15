# t3-250k-ge

Queue run 1c, Gilbert–Elliott. `lab/scripts/stream_shape_cells.sh` then `lab/scripts/stream_shape_pool.py`. Saturate probe sets the step interval. `--null` against this pass's `t3-250k-l0`.

## Binaries

Same binaries as `t3-250k-l0` (`3690191`): built from `a63ab3063fedcd39fc9fc9d5365bf3150afd0b39`. Cell script on the rig from `23b6a94` (shaped probe/step/repeat path identical to `7151cab`). Pooler copied from `b065e98`; re-run at `7151cab` matched.

| name | path copied to the rig | sha256 |
| --- | --- | --- |
| `exact-server` | `/home/ubuntu/bin/exact-server` | `20d48ed9e25341339cf1ccb64b7dcf9797df44a0676491671c70092f81b0f0ae` |
| `window-harness` | `/home/ubuntu/bin/window-harness` | `dd04ef7f2b43820293e12105cbc7c0e5c0c2fa9fc79fdacb575089a42e628e37` |

Arms: `shared`, `pool:2`, `per-frame`. Servers logged `workers=2`.

## Host

- `uname -r`: `6.17.0-1011-oracle`
- cores: 2
- MemTotal: 954 MB
- started: `2026-09-15T01:42:07+00:00`

Cell stderr:

```
qdisc netem 8061: root refcnt 2 limit 1000 delay 30ms loss gemodel p 0.07% r 14% 1-h 100% 1-k 0% rate 10Mbit
  probe shared 4.25 frames/s
  probe pool:2 3.50 frames/s
  probe per-frame 4.25 frames/s
frame=250000B step=330ms (1.4x the rate shared sustained)
```

`RATE_MBIT=10 RTT_MS=60 LOSS_MODEL=gemodel GE_P=0.07 GE_R=14 REPS=6 DEPTH=2`
`--read-bps 0 --step-interval-ms 330`

One discarded saturate probe per arm, then six interleaved repeats. 18 repeat JSONs plus 3 probe JSONs. `sudo unshare --net`. Host `lo` stayed `noqueue`. `exact-server-q` on UDP 4437 left running.

## Deviations

`7151cab` (unshaped `UNSHAPED` marker + `stream_shape_preflight.sh`) landed during this cell. Shaped path unchanged; cell not restarted.

## What the rows show (not a verdict)

Every JSON has `read_bps=0`, `censored_frac=0`, `center_asks_dropped=0`, `asks_sent=49`. `cache_hit_rate` by repeat:

```
per-frame  0.8272 0.9383 0.8642 0.9136 0.9383 0.9383
shared     0.8025 0.9383 0.9136 0.9383 0.9259 0.9012
pool:2     0.4074 0.4074 0.4074 0.4074 0.3951 0.4074
```

`stranded_frames`: `pool:2` 24–25 every repeat; `shared` 1–7; `per-frame` 1–6. No `rcvbuf_drops` field. Server logs have no `open_uni` / block line.

## Pooler, verbatim

`lab/scripts/stream_shape_pool.py` on the 18 repeat JSONs. Exit 0.

```
arm          runs  misses    p95_ms  median_ms    vs ref  CI95
shared          6      47    601.15     281.05         —  
per-frame       6      47    613.37     278.97     +2.0%  [-41.5, +71.0]
pool:2          6     289    502.31     408.10    -16.4%  [-42.3, +19.0]

A CI spanning zero is not a result. T3's bar is 15% on the reference arm.
```

Same pooler with `--null` pointing at this pass's `t3-250k-l0`. Exit 0. Also in `pooler-null.stdout`.

```
arm          runs  misses    p95_ms  median_ms    vs ref  vs own null  CI95
shared          6      47    601.15     281.05         —       +45.8%  
per-frame       6      47    613.37     278.97     +2.0%       +48.5%  [-41.5, +71.0]
pool:2          6     289    502.31     408.10    -16.4%        +4.0%  [-42.3, +19.0]

A CI spanning zero is not a result. T3's bar is 15% on the reference arm.
```
