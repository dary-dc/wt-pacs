#!/usr/bin/env python3
"""The A/A rule of docs/decode/README.md §Not yet tried, *Net protocols*: an arm against today's, judged by a
second copy of today's arm run in the same rounds.

    lab/scripts/aa_rule.py CELLS.json [--confirm CELLS2.json] [--bar 0.05]
    lab/scripts/aa_rule.py --simulate

CELLS.json is {cell: {"ref": [...], "aa": [...], "arm": [...]}}, one value a round, lower better, `null` where a
round has no value (the strict reading drops the round in all three).
"""
import json
import math
import random
import statistics
import sys

ALPHA = 0.05
POWER = 0.8


def mw_greater_p(x, y):
    """One-sided Mann–Whitney: P that x is not stochastically greater than y, normal approximation."""
    u = sum((a > b) + 0.5 * (a == b) for a in x for b in y)
    n1, n2 = len(x), len(y)
    mu, sd = n1 * n2 / 2, math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12)
    return 0.5 * math.erfc((u - mu - 0.5) / sd / math.sqrt(2))


def ratios(cell):
    rounds = [r for r in zip(cell["ref"], cell["aa"], cell["arm"]) if None not in r]
    return [aa / ref for ref, aa, _ in rounds], [arm / ref for ref, _, arm in rounds]


def flags(aa, arm):
    """(worse, better) at ALPHA: the arm's round-paired ratios against the A/A's."""
    return mw_greater_p(arm, aa) < ALPHA, mw_greater_p(aa, arm) < ALPHA


def can_flag(n):
    """Whether n rounds a side reach ALPHA at all, every arm round past every A/A round."""
    return n > 0 and mw_greater_p([1] * n, [0] * n) < ALPHA


def arm_sd(aa):
    """One arm's spread in log units, from the A/A ratios' MAD."""
    logs = [math.log(r) for r in aa]
    med = statistics.median(logs)
    return 1.4826 * statistics.median(abs(v - med) for v in logs) / math.sqrt(2)


def confirmed_power(n, sd, shift, trials, rng):
    def run():
        aa, arm = [], []
        for _ in range(n):
            ref = rng.lognormvariate(0, sd)
            aa.append(rng.lognormvariate(0, sd) / ref)
            arm.append(rng.lognormvariate(shift, sd) / ref)
        return flags(aa, arm)[0]
    return sum(run() and run() for _ in range(trials)) / trials


def mdl(n, sd, trials=600):
    """The smallest loss (a ratio − 1) the rule, confirmed, catches in POWER of campaigns of n rounds."""
    rng = random.Random(n * 1000 + round(sd * 1e4))
    lo, hi = 0.0, 0.5
    for _ in range(9):
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if confirmed_power(n, sd, mid, trials, rng) >= POWER else (mid, hi)
    return math.exp(hi) - 1


def judge(cells, confirm, bar):
    out = {}
    for name, cell in cells.items():
        aa, arm = ratios(cell)
        worse, better = flags(aa, arm)
        sizes = [len(aa)]
        if confirm is not None:
            aa2, arm2 = ratios(confirm[name]) if name in confirm else ([], [])
            again = flags(aa2, arm2) if aa2 else (False, False)
            worse, better = worse and again[0], better and again[1]
            sizes.append(len(aa2))
        loss = mdl(len(aa), arm_sd(aa))
        verdict = ("worse" if worse else "better" if better else "undecided at n = " + " + ".join(map(str, sizes))
                   if not can_flag(min(sizes)) else "tie" if loss <= bar else "not conclusive")
        out[name] = {"n": len(aa), "arm": round(statistics.median(arm), 4), "aa": round(statistics.median(aa), 4),
                     "sd": round(arm_sd(aa), 4), "mdl": round(loss, 4), "verdict": verdict}
    return out


def main(argv):
    if argv[:1] == ["--simulate"]:
        rng = random.Random(1)
        print("per-arm sd  n   false 'worse', confirmed   loss caught in 80 %")
        for sd in (0.01, 0.02, 0.03, 0.05):
            for n in (12, 24):
                false = confirmed_power(n, sd, 0.0, 2000, rng)
                print(f"{sd:9.2f}  {n:2d}  {false:24.4f}   {mdl(n, sd):+.1%}")
        return
    cells = json.load(open(argv[0]))
    confirm = json.load(open(argv[argv.index("--confirm") + 1])) if "--confirm" in argv else None
    bar = float(argv[argv.index("--bar") + 1]) if "--bar" in argv else 0.05
    for name, row in judge(cells, confirm, bar).items():
        print(name, json.dumps(row))


if __name__ == "__main__":
    main(sys.argv[1:])
