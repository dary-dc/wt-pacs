#!/usr/bin/env python3
"""askstream.py's rule on rows drawn with known ratios to T: which arm is the candidate, and whether it is a default."""
import contextlib
import io
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import askstream  # noqa: E402

CELLS = ["18/46/fifo20@50", "18/46/fifo20/loss1@50", "18/46/fifo20~dbts@50", "18/46/fifo20@50#u1"]


def rows(ratios, seed=5):
    """`ratios[(arm, cell, measure)]` × T's value, every other arm and measure × 1, ten rounds of 0.3 % noise."""
    rng = random.Random(seed)
    out = []
    for rnd in range(10):
        for cell in CELLS:
            ref = 3000 * rng.lognormvariate(0, 0.003)
            for arm in ("T", "Tp", "QW", "QS"):
                r = {"cell": cell, "round": rnd, "arm": arm, "exact": True, "error": "", "void": False,
                     "sent": 9700, "asks_ms": [1] * 8}
                for k in askstream.MEASURES:
                    r[k] = ref * ratios.get((arm, cell, k), 1.0) * rng.lognormvariate(0, 0.003)
                out.append(r)
    return out


def verdict(ratios):
    rs = rows(ratios)
    with contextlib.redirect_stdout(io.StringIO()):
        return askstream.rule(askstream.reading(rs, CELLS, 5, strict=False), CELLS)


def test_qs_better_than_qw_under_loss_and_worse_nowhere_is_the_candidate_and_the_default():
    gain = {("QW", c, "ask_ms"): 0.4 for c in CELLS} | {("QS", c, "ask_ms"): 0.4 for c in CELLS}
    gain[("QS", "18/46/fifo20/loss1@50", "ask_ms")] = 0.1
    assert verdict(gain) == "QS is the candidate; QS becomes the default"


def test_qs_worse_than_qw_in_one_cell_leaves_qw_the_candidate():
    ratios = {("QS", "18/46/fifo20/loss1@50", "ask_ms"): 0.1, ("QS", "18/46/fifo20@50", "fill_ms"): 1.1}
    assert verdict(ratios) == "QW is the candidate; QW becomes the default"


def test_a_candidate_worse_than_t_is_a_trade_off_naming_the_cell():
    ratios = {("QW", "18/46/fifo20~dbts@50", "fill_ms"): 1.1, ("QS", "18/46/fifo20~dbts@50", "fill_ms"): 1.1}
    assert verdict(ratios) == "QW is the candidate; a trade-off: worse than T in 18/46/fifo20~dbts@50 fill"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
