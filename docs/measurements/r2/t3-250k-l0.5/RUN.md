# t3-250k-l0.5

Queue run 1, third pass, after `5d678fb` (discarded warm-up). Earlier attempt `673007f` stays in history. `lab/scripts/stream_shape_cells.sh` then `lab/scripts/stream_shape_pool.py`.

## Binaries

Same binaries as `t3-250k-l0` (`3690191`): built from `a63ab3063fedcd39fc9fc9d5365bf3150afd0b39`. Scripts from `5d678fb`.

| name | path copied to the rig | sha256 |
| --- | --- | --- |
| `exact-server` | `/home/ubuntu/bin/exact-server` | `20d48ed9e25341339cf1ccb64b7dcf9797df44a0676491671c70092f81b0f0ae` |
| `window-harness` | `/home/ubuntu/bin/window-harness` | `dd04ef7f2b43820293e12105cbc7c0e5c0c2fa9fc79fdacb575089a42e628e37` |

Arms: `shared`, `pool:2`, `per-frame`. Servers logged `workers=2`.

## Host

- `uname -r`: `6.17.0-1011-oracle`
- cores: 2
- MemTotal: 954 MB
- started: `2026-09-15T01:18:47+00:00`

Cell stderr:

```
frame=250000B wire=200ms step=280ms
qdisc netem 805f: root refcnt 2 limit 1000 delay 30ms loss 0.5% rate 10Mbit
  warmup shared done
  warmup pool:2 done
  warmup per-frame done
```

`RATE_MBIT=10 RTT_MS=60 LOSS_PCT=0.5 LOSS_MODEL=iid REPS=6 DEPTH=2`
`--read-bps 0 --step-interval-ms 280`

One discarded warm-up per arm, then six interleaved repeats. 18 JSON files. `sudo unshare --net`. Host `lo` stayed `noqueue`. `exact-server-q` on UDP 4437 left running.

## Deviations

- `t3-250k-l2` and `t3-250k-ge` were not started. The pooler returned VOID on this cell.

## What the rows show (not a verdict)

Every JSON has `read_bps=0`, `censored_frac=0`, `center_asks_dropped=0`, `asks_sent=49`. `cache_hit_rate` by repeat:

```
per-frame  0.5062 0.7531 0.7284 0.8642 0.8148 0.7037
shared     0.7407 0.8272 0.8642 0.8765 0.7407 0.6420
pool:2     0.4074 0.3951 0.4074 0.3951 0.4074 0.4074
```

`stranded_frames`: `pool:2` 25–29 every repeat; `shared` 4–13; `per-frame` 3–7. No `rcvbuf_drops` field. Server logs have no `open_uni` / block line.

## Pooler, verbatim

`lab/scripts/stream_shape_pool.py` on the 18 JSONs. Exit 1.

```
arm          runs  misses    p95_ms  median_ms    vs ref  CI95
shared          6     106    449.95     231.06         —  
per-frame       6     132    411.81     130.22     -8.5%  [-34.5, -0.1]
pool:2          6     290    544.07     341.40    +20.9%  [+3.2, +48.1]
```

```
VOID — this cell decides nothing:
  · per-frame cache hit rate spans 0.51–0.86 across repeats — the repeats are not one cell; the first read comes off disk
```

Same pooler with `--null` pointing at this pass's `t3-250k-l0`. Exit 1. Also in `pooler-null.stdout` / `pooler-null.stderr`.

```
arm          runs  misses    p95_ms  median_ms    vs ref  vs own null  CI95
shared          6     106    449.95     231.06         —        +9.1%  
per-frame       6     132    411.81     130.22     -8.5%        -0.3%  [-34.5, -0.1]
pool:2          6     290    544.07     341.40    +20.9%       +12.7%  [+3.2, +48.1]
```

```
VOID — this cell decides nothing:
  · per-frame cache hit rate spans 0.51–0.86 across repeats — the repeats are not one cell; the first read comes off disk
```
