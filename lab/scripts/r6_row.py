#!/usr/bin/env python3
"""Emit one R6 result row, with its own pre-registered verdict attached.

Verdicts live on the row rather than in the analyser because the alternative has already
failed: in L4 the stop conditions lived downstream, and three rows with ``p95 == 0`` were
quoted as results anyway. A row that carries its own verdict cannot be quoted without it.

Void conditions are those fixed in ``docs/lanes/R6-preregistration.md`` §1 and §4, before
any arm ran.
"""
import json
import math
import sys

(exp, arm, cell, rtt, rate, loss, scale, depth, cache, run,
 s0, s1, cli, n0, n1, w0, w1, out, jf, qd) = sys.argv[1:21]

# Cells that must strand: one that stranded nothing did not produce the condition under test.
# N0 inverts this; X3L is here and X3 is not, per x3l-run-card.md 4.1.
STRANDING_CELLS = {"X1", "X2", "X3L"}


def nz_stats(m):
    """Percentiles over waits that actually waited.

    Most steps in a realistic read are cache hits and score a structural zero. A p95 over
    all samples is therefore roughly the 89th percentile of the informative ones, and in
    an easy cell close to their median — which is how an easy cell came to look like a
    result. ``nz_n`` says how many informative samples there were; below ~30 no percentile
    from the row means much.
    """
    xs = sorted(x for x in m.get("wait_ms", []) if x > 0.0)
    if not xs:
        return ["0", "0", "0", "0", "0"]

    def q(p):
        # nearest-rank, the rule the client telemetry contract uses
        return xs[min(len(xs) - 1, max(0, math.ceil(p / 100 * len(xs)) - 1))]

    return [str(len(xs)), "%.2f" % q(50), "%.2f" % q(95), "%.2f" % q(99), "%.2f" % xs[-1]]


def verdict(m, cli_cpu, ns_cpu, wall, depth, cell):
    bad = []
    # The measured frame was not always asked for, so the step scored ask policy rather
    # than transport.
    if m.get("center_asks_dropped", 0) > 0:
        bad.append("center-dropped")
    # The arm collapsed; its p95 is not a latency, it is a timeout.
    if m.get("censored_frac", 0.0) > 0.25:
        bad.append("censored")
    # The cell exists to strand and did not.
    if cell in STRANDING_CELLS and m.get("stranded_frames", 0) == 0:
        bad.append("no-stranding")
    # The harness did not produce the concurrency it claims.
    if m["peak_outstanding"] < depth:
        bad.append("depth")
    # A percentile over a thin tail is an outlier, not a percentile.
    if len([x for x in m.get("wait_ms", []) if x > 0.0]) < 30:
        bad.append("thin-tail")
    # The row measured a load generator, not a server.
    if wall > 0 and cli_cpu / wall >= 0.9:
        bad.append("client-bound")
    # The row measured the simulator, not the emulated link.
    if wall > 0 and ns_cpu / wall >= 0.9:
        bad.append("netsim-bound")
    return "VOID:" + "+".join(bad) if bad else "ok"


head = [exp, arm, cell, rtt, rate, loss, scale, depth, cache, run]
wall = float(w1) - float(w0)

try:
    m = json.load(open(jf))
except Exception:
    # Emit, never drop: failures are the slowest runs, so dropping flatters the failing arm.
    row = "\t".join(head + ["nan"] * 2 + ["0"] * 2 + ["nan"] * 5 + ["nan"] + ["0"] * 2 +
                    ["0", "nan", "0"] + ["0", "0"] + ["nan"] * 4 + [qd, "VOID:no-json"])
    print(row)
    open(out, "a").write(row + "\n")
    raise SystemExit(0)

ns_cpu = float(n1) - float(n0)
row = "\t".join(
    head
    + ["%.2f" % m["p95_wait_ms"], "%.2f" % m["mean_wait_ms"],
       str(m["peak_outstanding"]), str(m["wait_samples"])]
    + nz_stats(m)
    + ["%.1f" % m.get("reader_lag_ms", 0.0),
       str(m.get("stranded_frames", 0)), str(m.get("stranded_bytes", 0)),
       str(m.get("censored_waits", 0)), "%.4f" % m.get("censored_frac", 0.0),
       str(m.get("center_asks_dropped", 0)),
       str(m["frames_on_wire"]), str(m["bytes_on_wire"]),
       "%.3f" % (float(s1) - float(s0)), "%.3f" % float(cli), "%.3f" % ns_cpu,
       "%.2f" % wall, qd,
       verdict(m, float(cli), ns_cpu, wall, int(depth), cell)]
)
print(row)
open(out, "a").write(row + "\n")
