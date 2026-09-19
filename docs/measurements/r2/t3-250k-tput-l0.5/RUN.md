# t3-250k-tput-l0.5

Probe-only throughput cell, 0.5 % iid loss. `REPS=0 PROBE_REPS=6`. No latency repeats. `lab/scripts/stream_shape_cells.sh` from `b213b31`.

## Binaries

Same binaries as `t3-250k-l0` (`3690191`): built from `a63ab3063fedcd39fc9fc9d5365bf3150afd0b39`.

| name | path copied to the rig | sha256 |
| --- | --- | --- |
| `exact-server` | `/home/ubuntu/bin/exact-server` | `20d48ed9e25341339cf1ccb64b7dcf9797df44a0676491671c70092f81b0f0ae` |
| `window-harness` | `/home/ubuntu/bin/window-harness` | `dd04ef7f2b43820293e12105cbc7c0e5c0c2fa9fc79fdacb575089a42e628e37` |

Arms: `shared`, `pool:2`, `per-frame`. Servers logged `workers=2`.

## Host

- `uname -r`: `6.17.0-1011-oracle`
- cores: 2
- MemTotal: 954 MB
- started: `2026-09-15T02:43:49+00:00`

Cell stderr:

```
qdisc netem 8069: root refcnt 2 limit 1000 delay 30ms loss 0.5% rate 10Mbit
  probe shared 4.300 1.50 3.90 4.30 4.30 4.50 4.50 frames/s (median, then each)
  probe pool:2 4.000 3.40 4.00 4.00 4.00 4.10 4.30 frames/s (median, then each)
  probe per-frame 4.350 3.20 4.30 4.30 4.40 4.40 4.50 frames/s (median, then each)
frame=250000B step=326ms (1.4x the rate shared sustained)
wrote 0 repeats and 18 probes to /home/ubuntu/wt-pacs-run/out/t3-250k-tput-l0.5
```

`RATE_MBIT=10 RTT_MS=60 LOSS_PCT=0.5 LOSS_MODEL=iid REPS=0 PROBE_REPS=6 PROBE_MS=10000 DEPTH=2`
`--read-bps 0`

18 probe JSONs. `sudo unshare --net`. Host `lo` stayed `noqueue`. `exact-server-q` on UDP 4437 left running. No pooler — there are no repeats.

## Deviations

None beyond `REPS=0` as ordered.
