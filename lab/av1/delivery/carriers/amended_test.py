#!/usr/bin/env python3
"""amended.py's arithmetic: the median's order-statistic interval, the pair decision, the order-effect permutation,
dominance and the frontier, the bytes an ask adds, and which arm-rounds a failed check removes.

usage: amended_test.py   — exits 1 naming each wrong case
"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from amended import config_bytes, decided, dominates, frontier, interval_rank, median_interval, metrics, order_p, pair  # noqa: E402

wrong = []
cases = 0


def check(name, got, want):
    global cases
    cases += 1
    if got != want:
        wrong.append(f"{name}: {got!r}, want {want!r}")


# NIST's table for n = 6 … 25 at 95 %: rank 1 at n = 6 (P = 0.969), 6 at n = 20 (0.959), 8 at n = 25 (0.957).
check("rank n 5", interval_rank(5), 0)
check("rank n 6", interval_rank(6), 1)
check("rank n 20", interval_rank(20), 6)
check("rank n 25", interval_rank(25), 8)
check("interval ends", median_interval(list(range(1, 21)))[1:], (6, 15))
# Twenty rounds all below zero are decided; mixed signs around zero are not; under six rounds nothing is.
check("decided A", decided([-0.1 - 0.001 * i for i in range(20)])[0], "A")
check("decided B", decided([0.1 + 0.001 * i for i in range(20)])[0], "B")
check("straddles", decided([(-1) ** i * 0.1 for i in range(20)])[0], "not resolved")
check("too few", decided([-0.1] * 5)[0], "not resolved")
# One predecessor carrying +20 % over 24 rounds is flagged; the same values with labels unrelated to them are not.
rng = random.Random(3)
noise = [rng.gauss(0, 0.02) for _ in range(24)]
carry = {p: [noise[i] + (0.2 if p == "b" else 0) for i in range(24) if i % 4 == j] for j, p in enumerate("abcd")}
check("carryover flagged", order_p(carry) < 0.05 / 4, True)
check("no carryover", order_p({p: [noise[i] for i in range(24) if i % 4 == j] for j, p in enumerate("abcd")}) < 0.05 / 4, False)


def cfg(name, b, times):
    return {"name": name, "bytes": b, "times": times}


# Fewer bytes and no time against: dominates. A time against: does not. Equal on both: neither dominates.
x, y = cfg("x", 10, {"y": {"t": "not resolved"}}), cfg("y", 20, {"x": {"t": "not resolved"}})
check("dominates on bytes", dominates(x, y), True)
check("not dominated back", dominates(y, x), False)
check("a time against", dominates(cfg("x", 10, {"y": {"t": "y"}}), y), False)
check("equal, no time", dominates(cfg("x", 20, {"y": {"t": "not resolved"}}), y), False)
check("equal bytes, time for x", dominates(cfg("x", 20, {"y": {"t": "x"}}), y), True)
# A time not read never lets bytes alone decide (review finding 2).
check("not read blocks dominance", dominates(cfg("x", 10, {"y": {"t": "not read"}}), y), False)
# A pair is read only when both blocks pass their A/A and neither arm nor the control is flagged by order.
norm = {("s", "lay-k4"): {r: {"t": 1.0} for r in range(10)}, ("s", "sep-g4"): {r: {"t": 2.0} for r in range(10)}}
check("pair read", pair(norm, "s", "lay-k4", "sep-g4", "t", set()), "x")
check("pair, A/A failed", pair(norm, "s", "lay-k4", "sep-g4", "t", {("s", 4)}), "not read")
check("pair, arm flagged", pair(norm, "s", "lay-k4", "sep-g4", "t", {("s", 4, "sep-g4")}), "not read")
check("pair, control flagged", pair(norm, "s", "lay-k4", "sep-g4", "t", {("s", 4, "ctrl")}), "not read")
# A trade leaves both on the frontier; a dominated one leaves it.
check("frontier trade", frontier([cfg("x", 10, {"y": {"t": "y"}}), cfg("y", 20, {"x": {"t": "x"}})]), ["x", "y"])
check("frontier dominated", frontier([x, y]), ["x"])
# An ask at keyframe interval 4 on a 6-frame volume: frame i needs the tops of i's group up to i and i's low bits;
# the mean over i = 0 … 4. The separate ask is the residual of i, the whole frame HTJ2K's.
e = {"frames": 6, "low_bytes": [1] * 6, "target": {"high": 45.0, "cheap": 38.0}, "htj2k_bytes": [100] * 6,
     "layered": {"4": {"units": {"base": [1] * 6, "middle": [11] * 6, "top": [21] * 6}, "tried": {"20": [44.0, 60], "19": [46.0, 70]}}},
     "separate": {"4": {"high": {"units": [5] * 6, "residual_units": [7, 7, 7, 7, 7, 9], "tried": {"16": [44.0, 30], "15": [46.0, 40]}},
                        "cheap": {"units": [1] * 6, "tried": {"56": [38.0, 6]}}}}}
b = config_bytes(e)
check("layered ask bytes", b["lay-k4"]["exact on request"], (10 * (1 + 2 + 3 + 4 + 1) + 5) / 5)
check("separate ask bytes", b["sep-g4"]["exact on request"], 7)
check("whole ask bytes", b["whole"]["exact on request"], 100)
check("high bytes at equal PSNR", math.isclose(b["sep-g4"]["high view"], math.sqrt(30 * 40)), True)
# An arm-round with one failed exact check, or a view short of its frames, has no metrics.
ok = [{"set": "s", "block": 1, "round": 0, "arm": "ctrl", "op": "cine-exact", "ms": [1.0, 2.0], "exact": 2, "frames": 2}]
bad = [dict(ok[0], arm="ctrl-aa", exact=1)]
check("failed check drops the arm-round", sorted(metrics(ok + bad)[("s", 1, 0)]), ["ctrl"])

for w in wrong:
    print("WRONG", w)
print(f"amended_test: {cases - len(wrong)}/{cases}")
sys.exit(1 if wrong else 0)
