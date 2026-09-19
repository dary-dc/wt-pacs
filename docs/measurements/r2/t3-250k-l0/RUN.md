# t3-250k-l0

Queue run 1, third pass, after `5d678fb` (discarded warm-up). Earlier attempts stay in history: VOID `15b32d8`, second pass `8b903cd`. `lab/scripts/stream_shape_cells.sh` then `lab/scripts/stream_shape_pool.py`.

## Binaries

Built from `a63ab3063fedcd39fc9fc9d5365bf3150afd0b39`. Scripts on the rig from `5d678fb`. rustc 1.88.0.

| name | path copied to the rig | sha256 |
| --- | --- | --- |
| `exact-server` | `/home/ubuntu/bin/exact-server` | `20d48ed9e25341339cf1ccb64b7dcf9797df44a0676491671c70092f81b0f0ae` |
| `window-harness` | `/home/ubuntu/bin/window-harness` | `dd04ef7f2b43820293e12105cbc7c0e5c0c2fa9fc79fdacb575089a42e628e37` |

Arms: `shared`, `pool:2`, `per-frame`. Servers logged `workers=2`.

## Host

- `uname -r`: `6.17.0-1011-oracle`
- cores: 2
- MemTotal: 954 MB
- started: `2026-09-15T01:09:17+00:00`

Cell stderr:

```
frame=250000B wire=200ms step=280ms
qdisc netem 805e: root refcnt 2 limit 1000 delay 30ms rate 10Mbit
  warmup shared done
  warmup pool:2 done
  warmup per-frame done
```

`RATE_MBIT=10 RTT_MS=60 LOSS_PCT=0 LOSS_MODEL=iid REPS=6 DEPTH=2`
`--read-bps 0 --step-interval-ms 280`

One discarded warm-up per arm, then six interleaved repeats. 18 JSON files. `sudo unshare --net`. Host `lo` stayed `noqueue`. `exact-server-q` on UDP 4437 left running.

## Deviations

None beyond the standing ones in the runbook.

## What the rows show (not a verdict)

Every JSON has `read_bps=0`, `censored_frac=0`, `center_asks_dropped=0`, `asks_sent=49`. `cache_hit_rate` spans 0.8395–0.8765 (`shared`, `per-frame`) and 0.3951–0.4074 (`pool:2`). No `rcvbuf_drops` field. Server logs have no `open_uni` / block line.

## Pooler, verbatim

`lab/scripts/stream_shape_pool.py` on the 18 JSONs. Exit 0.

```
arm          runs  misses    p95_ms  median_ms    vs ref  CI95
shared          6      67    412.35     203.36         —  
per-frame       6      73    413.01     203.30     +0.2%  [-17.2, +21.0]
pool:2          6     289    482.88     320.95    +17.1%  [+16.9, +41.5]

A CI spanning zero is not a result. T3's bar is 15% on the reference arm.
```
