# T1 — The client window: which depth ships

**Status:** built, undecided · **Needs:** the browser rig, Chromium 148, the cloud rig · **Size:** one rig day, a small driver change

## Question

`TransportSession.connect(url, hash, { window })` is built: fixed `{ depth: N }`, or
`{ depth: "auto", initial }` with `D = ceil(0.95 × (1 + RTT / Tf))`, RTT from
`getStats().smoothedRtt` or, where the browser has no `getStats`, from the smallest of at least
two asks sent into an idle window; `Tf` the median time between arrivals
([`../adr-client-window-depth.md`](../adr-client-window-depth.md)). Headless Chromium 141 has no
`getStats`. Which of the two ships, and whether `auto` earns its estimator over a fixed
constant, is L2's question ([`L2-ask-policy.md`](L2-ask-policy.md)), never run.

## Decision rule

On every cell, `auto` must reach a depth within ±1 of the formula's for that cell, and its p95
wait must be within 10 % of the fixed arm run at the formula's depth. Then `auto` is the
harness default and the recommended viewer setting. If `auto` fails any cell, the product
setting is fixed `D` per link class from the formula, and `auto` stays an opt-in.

## Steps

1. **`getStats` in Chromium 148** (the browser rig): `lab/scripts/browser_getstats.py <server-bin>`
   prints `typeof getStats` and the stats object after 40 frames. If `smoothedRtt` is there and
   moves, `auto` reads it directly; if not, the idle-ask fallback is the only source and step 3
   decides whether it suffices.
2. **Driver.** `lab/scripts/browser_cell.py` launches a local server; add `SERVER_URL` and
   `CERT_SHA256` so it drives a browser on the workstation against `exact-server` on the rig,
   the X3 shape. Keep `INTERVAL_MS`, `w:N` and `w:auto:N` as they are.
3. **Grid on the rig.** Server on the rig, `cloud_netem.sh 20 | 60 | 150 [0.5]` on its egress,
   10 Mbit. Fixtures `frames_32k` and `frames_250k`. Arms per cell, interleaved, six repeats:
   `d=1` (control), `w:<formula D>` (fixed), `w:auto:2`, and `w:auto:16` (must descend). The
   telemetry build (`telemetry=1`) harvests per-frame `askMs → receivedMs`; report p95 wait
   over positive waits, mean, and `window_depth` at the end of each run. The step interval is
   the trace's; a dead cell (cache hit rate above 0.9, or every wait zero) is void.
4. **The viewer.** Expose `window` where the viewer creates its session, default from the
   rule above.

## Report

Per cell: arm, formula `D`, final `window_depth`, p95 wait, mean wait, frames. TSV under
`docs/measurements/r2/`, the reading in `adr-client-window-depth.md`.

## Stop conditions

`auto` oscillating between two depths on consecutive evaluations despite the damping; a cell
whose fixed arm at the formula's depth does not beat `d=1` (the formula is wrong there, and
the ADR's "extend the grid until the curve turns over" applies).
