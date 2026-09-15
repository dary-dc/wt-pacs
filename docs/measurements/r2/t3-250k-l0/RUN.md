# t3-250k-l0

Queue run 1, first cell. `lab/scripts/stream_shape_cells.sh` then `lab/scripts/stream_shape_pool.py`. This file is the execution log.

## Binaries

Built on the runner VM from `a63ab3063fedcd39fc9fc9d5365bf3150afd0b39` (`claude/clever-curie-flm0wi`), rustc 1.88.0.

| name | path copied to the rig | sha256 |
| --- | --- | --- |
| `exact-server` | `/home/ubuntu/bin/exact-server` | `20d48ed9e25341339cf1ccb64b7dcf9797df44a0676491671c70092f81b0f0ae` |
| `window-harness` | `/home/ubuntu/bin/window-harness` | `dd04ef7f2b43820293e12105cbc7c0e5c0c2fa9fc79fdacb575089a42e628e37` |

Arms: `shared`, `pool:2`, `per-frame`. The script does not pass `--workers`; each server logged `workers=2`.

## Host

- `uname -r`: `6.17.0-1011-oracle`
- cores: 2
- MemTotal: 954 MB
- started: `2026-09-15T00:20:43+00:00`

`tc qdisc show` as printed by the cell (stderr):

```
qdisc netem 8059: root refcnt 2 limit 1000 delay 30ms rate 10Mbit
```

`RATE_MBIT=10 RTT_MS=60 LOSS_PCT=0 LOSS_MODEL=iid REPS=6 DEPTH=2`
`FX=.../frames_250k/frames_250k.sbnd` (80 frames, generated on the rig by `lab/scripts/gen_tf_fixtures.sh`)
`ARMS="shared pool:2 per-frame"`
`TRACE=lab/traces/x3_short_scroll.json`

Arm order in `cell.stderr` reverses every repeat (r1 shared → pool:2 → per-frame; r2 per-frame → pool:2 → shared; …). 18 JSON files.

## Preflight

- `verify_netns_netem.sh` as written failed: `unshare --user --map-root-user --net` → `write failed /proc/self/uid_map: Operation not permitted` (`kernel.apparmor_restrict_unprivileged_userns=1`).
- Netem in an isolated netns was proved with `sudo unshare --net` (`tc qdisc replace dev lo root netem delay 20ms`; host `lo` stayed `noqueue`).
- One-repeat smoke (`out/smoke-t3-250k-l0`, not committed): all three arms wrote a JSON; servers logged `frames=80`.

## Deviations

- The rig has no `git`. `/home/ubuntu/wt-pacs` is a deploy tree (not a checkout) and hosts `exact-server-q` on UDP 4437. That process was left running. The campaign tree was copied to `/home/ubuntu/wt-pacs-run` and the binaries to `/home/ubuntu/bin`.
- The runbook command is `unshare --user --map-root-user --net`. That form cannot write the cell logs when wrapped in `sudo` (first smoke: `Permission denied` on `server.shared.log`, exit 124). The cell ran as `sudo unshare --net -- lab/scripts/stream_shape_cells.sh …` so netem stayed off the host and off the field server.
- `t3-250k-l0.5`, `t3-250k-l2`, and `t3-250k-ge` were not started. The pooler returned VOID on this cell.

## What the rows show (not a verdict)

Every JSON has `on_time_rate=0`, `censored_frac≈0.6296`, `center_asks_dropped=55`, `peak_outstanding=4`. No `rcvbuf_drops` field. Server logs have no `open_uni` / block line (this cell is `window-harness`, not Chromium).

## Pooler, verbatim

`lab/scripts/stream_shape_pool.py` on the 18 JSONs (same text from the rig and from this tree; seed `20260914`). Exit 1.

```
arm          runs  misses    p95_ms  median_ms    vs ref  CI95
shared          6     462  15949.80    7071.08         —  
per-frame       6     456  15951.72    7073.44     +0.0%  [-2.3, +2.4]
pool:2          6     457  16321.39    7624.65     +2.3%  [-2.3, +4.8]
```

```
VOID — this cell decides nothing:
  · per-frame never met its schedule (on_time_rate 0 in every repeat)
  · per-frame censored over 10% of waits
  · pool:2 never met its schedule (on_time_rate 0 in every repeat)
  · pool:2 censored over 10% of waits
  · shared never met its schedule (on_time_rate 0 in every repeat)
  · shared censored over 10% of waits
```
