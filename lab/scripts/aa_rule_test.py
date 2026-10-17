#!/usr/bin/env python3
"""lab/scripts/aa_rule.py's claims, each on rounds drawn with a known shift."""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aa_rule  # noqa: E402


def cell(rng, n, sd, shift):
    ref = [rng.lognormvariate(0, sd) for _ in range(n)]
    return {"ref": ref, "aa": [r * rng.lognormvariate(0, sd) for r in ref],
            "arm": [r * rng.lognormvariate(shift, sd) for r in ref]}


def verdicts(shift, sd=0.01, n=12, seed=7):
    rng = random.Random(seed)
    first = {f"c{i}": cell(rng, n, sd, shift) for i in range(5)}
    again = {f"c{i}": cell(rng, n, sd, shift) for i in range(5)}
    return {v["verdict"] for v in aa_rule.judge(first, again, 0.05).values()}


def test_a_ten_percent_loss_is_worse_in_every_cell():
    assert verdicts(0.10) == {"worse"}


def test_a_ten_percent_gain_is_better_in_every_cell():
    assert verdicts(-0.10) == {"better"}


def test_no_shift_on_a_quiet_host_is_a_tie():
    assert verdicts(0.0) == {"tie"}


def test_no_shift_on_a_noisy_host_is_not_conclusive():
    assert verdicts(0.0, sd=0.15) == {"not conclusive"}


def test_a_loss_the_confirming_run_does_not_repeat_is_not_worse():
    rng = random.Random(9)
    first = {f"c{i}": cell(rng, 12, 0.01, 0.10) for i in range(5)}
    again = {f"c{i}": cell(rng, 12, 0.01, 0.0) for i in range(5)}
    assert "worse" not in {v["verdict"] for v in aa_rule.judge(first, again, 0.05).values()}


def test_a_loss_the_confirming_run_is_too_short_to_flag_is_undecided_not_a_tie():
    rng = random.Random(11)
    first = {f"c{i}": cell(rng, 12, 0.01, 0.25) for i in range(5)}
    again = {f"c{i}": cell(rng, 2, 0.01, 0.25) for i in range(5)}
    assert {v["verdict"] for v in aa_rule.judge(first, again, 0.05).values()} == {"undecided at n = 12 + 2"}


def test_three_rounds_a_side_can_flag_and_two_cannot():
    assert [aa_rule.can_flag(n) for n in (0, 1, 2, 3)] == [False, False, False, True]


def test_a_null_round_drops_from_all_three_arms():
    aa, arm = aa_rule.ratios({"ref": [1, 1, None], "aa": [2, 2, 2], "arm": [None, 3, 3]})
    assert (aa, arm) == ([2.0], [3.0])


def test_the_rule_catches_a_two_percent_loss_at_a_one_percent_spread():
    assert 0.01 < aa_rule.mdl(12, 0.01) < 0.03


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
