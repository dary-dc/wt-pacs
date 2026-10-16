#!/usr/bin/env python3
"""refill.py's verdict on rows drawn with a known loss, where VOID leaves a half too short to flag."""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import refill  # noqa: E402


def rows(cell, arm_ratio, void_rounds=(), seed=3):
    rng = random.Random(seed)
    out = []
    for rnd in range(24):
        ref = 2560 * rng.lognormvariate(0, 0.003)
        for arm, ratio in (("T", 1.0), ("Tp", 1.0), ("TB", arm_ratio)):
            ms = ref * ratio * rng.lognormvariate(0, 0.003)
            out.append({"cell": cell, "round": rnd, "arm": arm, "exact": True, "error": "",
                        "void": rnd in void_rounds and arm == "T", "ask_ms": ms, "fill_ms": ms})
    return out


SEVEN_AND_TWO = set(range(7, 22))


def test_a_loss_in_every_round_with_two_rounds_left_in_a_half_is_undecided_not_a_tie():
    v = refill.verdict(rows("c@10", 1.27, SEVEN_AND_TWO), "c@10", "ask_ms", strict=True)
    assert v["verdict"] == "undecided at n = 7 + 2"


def test_the_same_loss_with_every_round_kept_is_worse():
    v = refill.verdict(rows("c@10", 1.27, SEVEN_AND_TWO), "c@10", "ask_ms", strict=False)
    assert v["verdict"] == "worse"


def test_an_undecided_cell_keeps_b_from_becoming_the_default():
    rs = rows("gain@10", 0.9) + rows("short@10", 1.0, SEVEN_AND_TWO)
    assert refill.reading(rs, ["gain@10", "short@10"], strict=True) == "B not conclusive"
    assert refill.reading(rs, ["gain@10"], strict=True) == "B becomes the default"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
