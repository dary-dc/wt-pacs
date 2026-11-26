#!/usr/bin/env python3
"""lab/scripts/exec_gap_summary.py's claims, each on rounds written with a known effect.

    python3 lab/scripts/exec_gap_summary_test.py
"""
import contextlib
import io
import random
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import exec_gap_summary  # noqa: E402

COLUMNS = ("cell", "arm", "round", "asks", "wall_ns", "cpu_ns_per_ask", "misses",
           "cot_p50_ns", "cot_p99_ns", "cot_max_ns")


def at(effect, rnd):
    return effect(rnd) if callable(effect) else effect


def verdicts(effects, busy=0.4, noise=0.01, aa_noise=0.0, seed=3):
    """effects: {(arm, cell, metric): ratio, or ratio of the round}; each value is the base times ±noise,
    G0p's times ±aa_noise more."""
    rng = random.Random(seed)
    base = {"wall_ns": 1e8, "misses": 1000, "cot_p50_ns": 1e5, "cot_p99_ns": 2e6, "cot_max_ns": 5e6}
    rows = ["\t".join(COLUMNS)]
    for r in range(1, 13):
        for cell in ("a16", "a64", "b"):
            for arm in ("G0", "G0p", "G1", "G2"):
                spread = noise + aa_noise * (arm == "G0p")
                v = {m: x * at(effects.get((arm, cell, m), 1), r) * rng.uniform(1 - spread, 1 + spread)
                     for m, x in base.items()}
                cpu = busy * v["wall_ns"] * 2 / 100 * effects.get((arm, cell, "cpu_ns_per_ask"), 1)
                rows.append("\t".join(str(x) for x in (cell, arm, r, 100, v["wall_ns"], cpu, v["misses"],
                                                       v["cot_p50_ns"], v["cot_p99_ns"], v["cot_max_ns"])))
    with tempfile.NamedTemporaryFile("w", suffix=".tsv") as f:
        f.write("\n".join(rows) + "\n")
        f.flush()
        with contextlib.redirect_stdout(io.StringIO()):
            lines = exec_gap_summary.judge(f.name, 2)
    return {arm: line.split(" — ")[0].split(": ")[1] for arm, line in lines.items()}


def test_a_lower_co_tenant_p99_in_one_cell_lands_the_arm():
    assert verdicts({("G1", "a64", "cot_p99_ns"): 0.7}) == {"G1": "lands", "G2": "closed"}


def test_a_lower_p99_only_where_the_host_saturates_lands_nothing():
    assert verdicts({("G1", "a64", "cot_p99_ns"): 0.7}, busy=0.9)["G1"] == "closed"


def test_a_guard_worse_anywhere_closes_the_arm_its_p99_would_land():
    assert verdicts({("G2", "b", "cot_p99_ns"): 0.7, ("G2", "a16", "wall_ns"): 1.3})["G2"] == "closed"


def test_an_effect_inside_the_a_a_spread_is_a_tie():
    assert verdicts({("G1", "a64", "cot_p99_ns"): 0.93}, aa_noise=0.15)["G1"] == "closed"


def test_an_effect_fewer_than_eight_rounds_in_ten_agree_on_is_a_tie():
    three_in_twelve_the_other_way = lambda r: 1.3 if r % 4 == 0 else 0.7  # noqa: E731
    assert verdicts({("G1", "a64", "cot_p99_ns"): three_in_twelve_the_other_way})["G1"] == "closed"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
