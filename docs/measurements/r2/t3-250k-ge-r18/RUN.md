# t3-250k-ge-r18

Queue run 1c re-run, Gilbert–Elliott, `REPS=18`. Same cell as `t3-250k-ge` (`af118e6`) with three times the repeats and `STEP_MS=330` forced. `lab/scripts/stream_shape_cells.sh` then `lab/scripts/stream_shape_pool.py` (`22606fa`). `--null` against this pass's `t3-250k-l0`.

## Binaries

Same binaries as `t3-250k-l0` (`3690191`): built from `a63ab3063fedcd39fc9fc9d5365bf3150afd0b39`. Cell script on the rig from `b213b31` (`PROBE_REPS=3`, 10 s dwell). `STEP_MS=330` set in the environment, not derived from this cell's probe median.

| name | path copied to the rig | sha256 |
| --- | --- | --- |
| `exact-server` | `/home/ubuntu/bin/exact-server` | `20d48ed9e25341339cf1ccb64b7dcf9797df44a0676491671c70092f81b0f0ae` |
| `window-harness` | `/home/ubuntu/bin/window-harness` | `dd04ef7f2b43820293e12105cbc7c0e5c0c2fa9fc79fdacb575089a42e628e37` |

Arms: `shared`, `pool:2`, `per-frame`. Servers logged `workers=2`.

## Host

- `uname -r`: `6.17.0-1011-oracle`
- cores: 2
- MemTotal: 954 MB
- started: `2026-09-15T02:08:00+00:00`

Cell stderr (probe + interval):

```
qdisc netem 8067: root refcnt 2 limit 1000 delay 30ms loss gemodel p 0.07% r 14% 1-h 100% 1-k 0% rate 10Mbit
  probe shared 4.300 4.30 4.30 4.30 frames/s (median, then each)
  probe pool:2 4.100 4.00 4.10 4.20 frames/s (median, then each)
  probe per-frame 4.300 4.30 4.30 4.30 frames/s (median, then each)
frame=250000B step=330ms (1.4x the rate shared sustained)
```

`RATE_MBIT=10 RTT_MS=60 LOSS_MODEL=gemodel GE_P=0.07 GE_R=14 REPS=18 DEPTH=2 STEP_MS=330 PROBE_REPS=3 PROBE_MS=10000`
`--read-bps 0 --step-interval-ms 330`

Three saturate probes per arm, then 18 interleaved repeats. 54 repeat JSONs plus 9 probe JSONs. `sudo unshare --net`. Host `lo` stayed `noqueue`. `exact-server-q` on UDP 4437 left running.

## Deviations

- Earlier single-sample `ge-r18` attempts and the `7142cf1` `-l2` restart were aborted; not landed.
- Pooler commits `be1121f` and `22606fa` landed during this cell. Cell script unchanged; pooler on the rig at the end was `22606fa`. `--null` output written locally from that pooler (the rig `--null` was still running at copy).

## What the rows show (not a verdict)

Every JSON has `read_bps=0`. `cache_hit_rate` spans 0.8272–0.9383 (`per-frame`), 0.8148–0.9383 (`shared`), 0.3951–0.4074 (`pool:2`). `stranded_frames`: `pool:2` 24–28 every repeat; `shared` 1–7; `per-frame` 1–6.

`asks_sent` is 49 on every `per-frame` repeat; 48 or 49 on `shared`; 41, 48 or 49 on `pool:2`. `censored_frac` is 0 on `shared` and `per-frame`; `pool:2` max is 0.0988. `center_asks_dropped` is 0 except some `pool:2` repeats at 8 or 9. No `rcvbuf_drops` field. Server logs have no `open_uni` / block line.

## Pooler, verbatim

`lab/scripts/stream_shape_pool.py` (`22606fa`) on the 54 repeat JSONs. Exit 0.

```
arm          runs  misses  miss_p95   vs ref  all_p95   vs ref  strand  CI95(miss)  CI95(all)
shared         18     126    569.84        —   272.87        —     1.9                
per-frame      18     124    421.90   -26.0%   213.65   -21.7%     1.4  [-51.1, +3.2]  [-45.2, +79.8]
pool:2         18     867    704.33   +23.6%   513.15   +88.1%    24.4  [-20.1, +115.0]  [+73.9, +294.3]

A CI spanning zero is not a result. T3's bar is 15% on the reference arm.
Miss counts differ 7.0x across arms — read all_p95, not miss_p95.
```

Same pooler with `--null` pointing at this pass's `t3-250k-l0`. Exit 0. Also in `pooler-null.stdout`.

```
arm          runs  misses  miss_p95   vs ref  all_p95   vs ref  strand  vs null  CI95(miss)  CI95(all)
shared         18     126    569.84        —   272.87        —     1.9   +38.2%                
per-frame      18     124    421.90   -26.0%   213.65   -21.7%     1.4    +2.2%  [-51.1, +3.2]  [-45.2, +79.8]
pool:2         18     867    704.33   +23.6%   513.15   +88.1%    24.4   +45.9%  [-20.1, +115.0]  [+73.9, +294.3]

A CI spanning zero is not a result. T3's bar is 15% on the reference arm.
Miss counts differ 7.0x across arms — read all_p95, not miss_p95.
```
