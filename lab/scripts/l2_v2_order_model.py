#!/usr/bin/env python3
"""Falsification check for the L2 v2 ask-policy grid.

Claim under test (l2_ask_policy_EVIDENCE.md): at loss=0, `control` beats
`fixed`/`dynamic` on `p95_lateness_ms`, and that ranking says something about
bounding the outstanding-ask depth D.

Counter-model: at loss=0 the harness is a FIFO pipe. Every arm asks the same 80
unique frames and moves the same 2 560 320 bytes (see the TSV). So the only thing
that can separate the arms is the ORDER in which frames are first asked, and that
order is set by `window_frames()` in lab/window-harness/src/client.rs, which walks
a RING (center±r modulo n). At the study boundary that ring asks frames 79, 78,
77 ... before frames 8..15 while the reader is still on frame 0.

The model here has no depth, no RTT, no congestion, no loss — two parameters
(Tf = per-frame serialization time, c0 = time to first byte) fitted on the
CONTROL arm only, then used to PREDICT the D=16 arms with zero free parameters.

Usage:  python3 lab/scripts/l2_v2_order_model.py
Exit 0 if the model reproduces every loss=0 windowed cell within 1 %.
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, "docs/measurements/r2/l2_ask_policy_v2/raw")
TRACE = os.path.join(ROOT, "lab/traces/l2_ask_policy_scroll.json")
N = 80
STEP_MS = 16.0
TOLERANCE_PCT = 1.0


def window_frames(center, d, n):
    """Port of client.rs window_frames() — center ± radius, modulo n."""
    out = []
    if d == 0 or n == 0:
        return out
    out.append(center % n)
    r = 1
    while len(out) < d:
        plus = (center + r) % n
        if plus not in out:
            out.append(plus)
            if len(out) >= d:
                break
        minus = (center + n - (r % n)) % n
        if minus not in out:
            out.append(minus)
        r += 1
        if r > n:
            break
    return out


def forward_window_frames(center, d, n):
    """What a scroll-forward viewer would ask: no wrap past the study edge."""
    return [f for f in range(center, min(center + d, n))]


def first_ask_order(steps, d, wf):
    order, seen = [], set()
    for cursor in steps:
        for f in (wf(cursor, d, N) if d > 0 else [cursor % N]):
            if f not in seen:
                seen.add(f)
                order.append(f)
    return order


def lateness(steps, order, tf_ms, c0_ms):
    """FIFO service in first-ask order; frame at queue position k lands at c0+Tf*(k+1)."""
    arrive = {f: c0_ms + tf_ms * (i + 1) for i, f in enumerate(order)}
    return [max(0.0, arrive[fr % N] - STEP_MS * i) for i, fr in enumerate(steps)]


def stats(lat):
    s = sorted(lat)
    p95 = s[max(0, math.ceil(0.95 * len(s)) - 1)]  # nearest-rank, same as metrics.rs
    return p95, sum(lat) / len(lat), sum(1 for x in lat if x > 0) / len(lat)


def fit_on_control(steps, ctrl_order, obs_p95, obs_mean):
    best = None
    for tf in (x / 100 for x in range(2000, 3200, 2)):
        for c0 in range(200, 1500, 2):
            p95, mean, _ = stats(lateness(steps, ctrl_order, tf, c0))
            err = (p95 - obs_p95) ** 2 + (mean - obs_mean) ** 2
            if best is None or err < best[0]:
                best = (err, tf, c0)
    return best[1], best[2]


def observed(name):
    with open(os.path.join(RAW, name + ".json")) as fh:
        m = json.load(fh)
    return m["p95_lateness_ms"], m["mean_lateness_ms"], m["frac_steps_late"]


def main():
    steps = [s["frame"] for s in json.load(open(TRACE))["steps"]]
    ctrl = first_ask_order(steps, 0, window_frames)
    ring16 = first_ask_order(steps, 16, window_frames)

    cells = [
        ("rtt20/loss0", "control_rtt20_loss0_run1", ["fixed_rtt20_loss0_run1", "dynamic_rtt20_loss0_run1"]),
        ("rtt60/loss0", "control_rtt60_loss0_run1", ["fixed_rtt60_loss0_run1", "dynamic_rtt60_loss0_run1"]),
        ("rtt150/loss0", "control_rtt150_loss0_run2", ["fixed_rtt150_loss0_run2", "dynamic_rtt150_loss0_run2"]),
    ]

    print(f"ring window D=16, first 16 asks: {ring16[:16]}")
    print(f"(reader is on frame 0; frames 73-79 are asked before frames 9-15)\n")

    worst = 0.0
    for label, ctrl_run, win_runs in cells:
        op95, omean, olate = observed(ctrl_run)
        tf, c0 = fit_on_control(steps, ctrl, op95, omean)
        mp95, mmean, mlate = stats(lateness(steps, ctrl, tf, c0))
        pp95, pmean, plate = stats(lateness(steps, ring16, tf, c0))
        link = 32004 * 8 / tf / 1000
        print(f"### {label}   fitted on CONTROL only: Tf={tf:.2f} ms ({link:.2f} Mbps), c0={c0} ms")
        print(f"  control   observed p95={op95:8.1f}  model p95={mp95:8.1f}")
        print(f"  D=16      PREDICTED p95={pp95:8.1f}   (no depth term in the model)")
        for r in win_runs:
            wp95, wmean, wlate = observed(r)
            err = abs(pp95 - wp95) / wp95 * 100
            worst = max(worst, err)
            flag = "ok" if err <= TOLERANCE_PCT else "MISS"
            print(f"    {r:34} observed p95={wp95:8.1f}  err={err:5.2f}%  {flag}")
        print(f"  mean/frac_late are NOT fully reproduced "
              f"(model mean={pmean:.0f} late={plate:.3f}); p95 is.")
        fwd = first_ask_order(steps, 16, forward_window_frames)
        fp95, _, _ = stats(lateness(steps, fwd, tf, c0))
        print(f"  same D=16 with a FORWARD-ONLY window (no ring wrap): p95={fp95:8.1f} "
              f"-> gap vs control = {fp95 - mp95:+.1f} ms\n")

    print(f"worst p95 prediction error across loss=0 windowed cells: {worst:.2f}%")
    if worst <= TOLERANCE_PCT:
        print("VERDICT: the loss=0 arm ranking is reproduced by ask ORDER alone. "
              "It carries no information about ask depth.")
        return 0
    print("VERDICT: model does not reproduce the grid; the ranking may be a real depth effect.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
