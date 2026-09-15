# t3-250k-l2

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
- started: `2026-09-15T00:57:58+00:00`

Cell stderr:

```
frame=250000B wire=200ms step=280ms
qdisc netem 805d: root refcnt 2 limit 1000 delay 30ms loss 2% rate 10Mbit
```

`RATE_MBIT=10 RTT_MS=60 LOSS_PCT=2 LOSS_MODEL=iid REPS=6 DEPTH=2`
`--read-bps 0 --step-interval-ms 280`

Arm order reverses every repeat. 18 JSON files. `sudo unshare --net`. Host `lo` stayed `noqueue`. `exact-server-q` on UDP 4437 left running.

## Deviations

- `t3-250k-ge` was not started. The pooler returned VOID on this cell.

## What the rows show (not a verdict)

Every JSON has `read_bps=0` and `wait_samples=81`. `asks_sent` ranges 31–48. `censored_frac` exceeds 0.1 on 14 of 18 repeats (max `shared.r4` 0.3333). `center_asks_dropped` is non-zero on 17 of 18 repeats (0 on `per-frame.r3` only). `cache_hit_rate` is below 0.9 on every repeat. No `rcvbuf_drops` field. Server logs have no `open_uni` / block line.

## Pooler, verbatim

`lab/scripts/stream_shape_pool.py` on the 18 JSONs. Exit 1.

```
arm          runs  misses    p95_ms  median_ms    vs ref  CI95
shared          6     381  16725.96    2802.52         —  
per-frame       6     364  21204.64    2368.30    +26.8%  [+6.1, +39.5]
pool:2          6     395  21200.67    2717.53    +26.8%  [+10.7, +37.5]
```

```
VOID — this cell decides nothing:
  · per-frame sent under half the trace's asks — the outstanding ceiling suppressed them
  · per-frame censored over 10% of waits
  · pool:2 sent under half the trace's asks — the outstanding ceiling suppressed them
  · pool:2 censored over 10% of waits
  · shared sent under half the trace's asks — the outstanding ceiling suppressed them
  · shared censored over 10% of waits
```
