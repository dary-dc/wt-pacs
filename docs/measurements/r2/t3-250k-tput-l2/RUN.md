# t3-250k-tput-l2

Probe-only throughput cell, 2 % iid loss. `REPS=0 PROBE_REPS=6`. No latency repeats. `lab/scripts/stream_shape_cells.sh` from `b213b31`.

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
- started: `2026-09-15T02:46:56+00:00`

Cell stderr:

```
qdisc netem 806a: root refcnt 2 limit 1000 delay 30ms loss 2% rate 10Mbit
  probe shared 2.650 1.30 1.30 2.30 3.00 3.40 3.80 frames/s (median, then each)
  probe pool:2 1.950 1.40 1.70 1.90 2.00 2.60 3.20 frames/s (median, then each)
  probe per-frame 2.050 1.00 1.90 1.90 2.20 2.70 3.50 frames/s (median, then each)
frame=250000B step=529ms (1.4x the rate shared sustained)
wrote 0 repeats and 18 probes to /home/ubuntu/wt-pacs-run/out/t3-250k-tput-l2
```

`RATE_MBIT=10 RTT_MS=60 LOSS_PCT=2 LOSS_MODEL=iid REPS=0 PROBE_REPS=6 PROBE_MS=10000 DEPTH=2`
`--read-bps 0`

18 probe JSONs. `sudo unshare --net`. Host `lo` stayed `noqueue`. `exact-server-q` on UDP 4437 left running. No pooler — there are no repeats.

## Deviations

None beyond `REPS=0` as ordered.
