# L2 v4 — what to change, then rerun

The independent review (2026-09-07) is right: several conclusions were stronger than
the data. This is the fix list. **Lab only.** Product ask paths stay untouched.

## What the last cloud grid actually measured

`lab/scripts/cloud_netem.sh` deleted the root qdisc **before** the `case` statement.
`stats` is how the campaign reads drop counters. So every `netem_drops` call did:

1. `tc qdisc del dev ens3 root`
2. look for a netem `Sent` line (none)
3. return empty → TSV `netem_drops=0`

The first `run_one` therefore **removed rate, delay, and loss** after the path-RTT
probe. The 182 rows are an unshaped WAN bake-off mislabelled as netem 60 / 0.5 %.
That matches bulk `achieved_mbps` ≈ 15 on a named 10 Mbit cap, and loss 0 looking
like loss 0.5 %. **Those rows cannot support a loss conclusion or a shaped-path
ranking.** Marked void in `l2_ask_policy_v4_SUMMARY.md`.

The local `--rtt-ms` grid is still a userspace emulator. Keep it as a mechanism
check (prefetch vs none, first-byte ratchet). Do **not** lock a cap from it.

## Pre-registered metrics (do not switch)

Written here **before** the rerun:

| Role | Metric | Use |
| --- | --- | --- |
| Primary (reader) | `lateness_median_ms` | Rank arms. p95 on 56-step traces is a near-max / warm-up. |
| Primary (abandon) | `stranded_bytes` | Rank bulk vs anyone on jump/reversal. |
| Diagnostic | `p95_lateness_ms`, `lateness_max_ms`, `frac_steps_late` | Report; do not change the ranking rule after seeing them. |
| Path proof | `achieved_mbps`, `netem_drops`, `path_rtt_ms` | Void the cell if these fail the gates below. |

A conclusion that needs a different metric is a new experiment, not a rewrite of this one.

## Code / script changes

| Defect | Change |
| --- | --- |
| `stats` wipes netem | Delete the qdisc only in `apply_netem` / `off`, never in `stats`. |
| E0 was a `tc` regex | Packet e0: after shaping, bulk `achieved_mbps` ≤ 12; a 10 % loss run must increment `netem_drops`. No grid without that. |
| Dynamic arms were `adr` in costume | Add `dynfb` (`--rtt-source first-byte`, the lane estimator). Keep `dynclean` as a **hold-D control**. Do not pass `--path-rtt-ms` on `dynfb`. Drop `dynpath` from the default grid (it is adr + noisy Tf). |
| Cap vs no-cap buried | Default arms always include `window` (same `K`, no cap) and `adr` (same `K`, formula `D`). Rank them on median lateness. If `window` wins, the conclusion is “this `D` costs,” not “fixed D is the policy.” |
| Named RTT vs WAN | Label cells `path_rtt_ms=…`. Formula `D` still uses the probe. Do not void the WAN cell for being 20 % off *named* 60 — that rule assumed named ≈ path. |
| Shaper not on path | After the first bulk row, abort if `achieved_mbps` > 12. After the first loss>0 cell, abort if total `netem_drops` is 0. |
| `pkill -x exact-server` | Free **port 4435** only; do not rely on the binary name. |
| Local header | State: emulator, not a policy lock. Same arms as cloud for the first-byte check. |

## Grid that will run after the fix

Cloud (only if packet e0 passes): `RTTS=60`, traces scroll+jump, 40 ms, loss 0 (n=3) and 0.5 % (n=10), arms

`control window adr bulk dynfb dynclean`

Local (mechanism): same arms, `--rtt-ms` 60, n=3, scroll+jump. Not a lock.

## What we will allow ourselves to conclude

- Prefetch vs none, if medians separate and the shaper gate passed.
- Bulk vs others on **stranded_bytes** (and on median only if it separates).
- `window` vs `adr` on median: which way the cap goes on a real path.
- `dynfb` vs `adr`: whether the lane estimator moves `D` and whether that helps or ratchets.
- `dynclean` vs `adr`: must stay at warm-up `D` (sanity).
- Loss: only if `netem_drops` rose on the 0.5 % cell.

We will **not** write “lab implements fixed D” or “do not adapt” unless `dynfb` was in the grid and the cap still won on the registered primary.
