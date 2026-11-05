#!/usr/bin/env python3
"""rule.py's arithmetic: each carrier's stage bytes and stage times built from the arms' ops, which arm-rounds a
failed check removes, the A/A and order gates reaching a pair, the cross-block quarter-base pairing, and the label.

usage: rule_test.py   — exits 1 naming each wrong case
"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rule import STAGES, aa, arms, failed, judge, label, normalized, order_effects, pair, stage_bytes, stages, unread_blocks  # noqa: E402

wrong = []
cases = 0


def check(name, got, want):
    global cases
    cases += 1
    if got != want:
        wrong.append(f"{name}: {got!r}, want {want!r}")


# A four-frame volume at G = 2: every unit size distinct, so a sum over the wrong span shows.
F = 4
e = {"frames": F, "htj2k_bytes": [1000, 1001, 1002, 1003], "low_bytes": [5, 6, 7, 8], "g": {"2": {
    "preview": {"units": [10, 1, 2, 3]}, "vl": {"4": {"units": [100, 20, 30, 40], "residual_units": [900, 901, 902, 903]}},
    "snr": {"4": {"layers": {"preview": {"units": [11, 2, 3, 4]}, "vl": {"units": [131, 32, 43, 54]}}, "residual_units": [800, 801, 802, 803]}},
    "svc": {"base": {"units": [3, 1, 1, 1]}, "full": {"units": [500, 400, 401, 402]}}}}}
b = stage_bytes(e, 2, 4)
# In order: first unit; every preview; preview + visually lossless; + every residual.
check("two in order", [b["two"][s] for s in STAGES[:4]], [10, 16, 16 + 190, 16 + 190 + 3606])
check("snr in order", [b["snr"][s] for s in STAGES[:4]], [11, 20, 260, 260 + 3206])
check("one in order", [b["one"][s] for s in STAGES[:4]], [100, 190, 190, 190 + 3606])
check("sep exact is whole HTJ2K", b["sep"]["every slice, exact"], 16 + 190 + 4006)
check("svc to visually lossless is its exact", (b["svc"]["every slice, visually lossless"], b["svc"]["every slice, exact"]), (1703 + 26, 1703 + 26))
# A jump to i, i = 0 … F − 2 at G = 2: from i's keyframe; frames 0, 1, 2 → spans [0], [0, 1], [2].
check("two jump preview", b["two"]["jump, preview"], (10 + 11 + 2) / 3)
check("two jump exact", b["two"]["jump, exact"], ((10 + 100 + 900) + (11 + 120 + 901) + (2 + 30 + 902)) / 3)
check("snr jump visually lossless", b["snr"]["jump, visually lossless"], (131 + 163 + 43) / 3)
check("svc jump exact adds i's low bits", b["svc"]["jump, exact"], ((500 + 5) + (900 + 6) + (401 + 7)) / 3)
check("svc jump to visually lossless is its exact", b["svc"]["jump, visually lossless"], b["svc"]["jump, exact"])
check("htj2k jump", b["htj2k"]["jump, exact"], (1000 + 1001 + 1002) / 3)


def rows_for(s, g, v, r, ms, prev=None, bad=None):
    """One block-round of arm rows; ms scales each arm's times, so a carrier's ratio is known."""
    out = []
    for arm in ("snr", "two", "svc", "ctrl", "ctrl-aa"):
        if arm == "svc" and v != 8:
            continue
        k = ms.get(arm, 1.0)
        base = dict(set=s, g=g, v=v, arm=arm, round=r, prev=(prev or {}).get(arm))
        if arm.startswith("ctrl"):
            out.append({**base, "op": "cine-exact", "ms": [10 * k] * F, "exact": F, "frames": F})
        elif arm == "svc":
            out += [{**base, "op": "preview", "ms": [1 * k] * F, "lossy": F, "frames": F},
                    {**base, "op": "exact", "ms": [30 * k] * F, "exact": F, "frames": F},
                    {**base, "op": "preview-jump", "i": 1, "ms": 2 * k, "lossy": True},
                    {**base, "op": "exact-jump", "i": 1, "ms": 60 * k, "exact": True}]
        else:
            out += [{**base, "op": "preview", "ms": [2 * k] * F, "lossy": F, "frames": F},
                    {**base, "op": "vl", "ms": [20 * k] * F, "res": [9 * k] * F, "lossy": F, "exact": F, "frames": F},
                    {**base, "op": "preview-jump", "i": 1, "ms": 4 * k, "lossy": True},
                    {**base, "op": "vl-jump", "i": 1, "ms": 40 * k, "lossy": True},
                    {**base, "op": "residual", "i": 1, "ms": 9 * k, "exact": True}]
    if bad is not None:
        x = out[bad]
        k = next(c for c in ("lossy", "exact") if c in x)
        out[bad] = {**x, k: False if isinstance(x[k], bool) else x[k] - 1}
    return out


cells = arms(rows_for("a", 2, 8, 0, {}))
a = cells[("a", 2, 8, 0)]
ctrl = [10.0] * F
t = stages("two", a["two"], ctrl)
check("two times", [t[s] for s in STAGES], [2, 8, 88, 124, 4, 44, 53])
check("one times", [stages("one", a["two"], ctrl)[s] for s in STAGES], [20, 80, 80, 116, 40, 40, 49])
check("sep exact by the control", [stages("sep", a["two"], ctrl)[s] for s in ("every slice, exact", "jump, exact")], [128, 54])
check("svc times", [stages("svc", a["svc"], ctrl)[s] for s in STAGES], [1, 4, 124, 124, 2, 62, 62])
check("htj2k times", [stages("htj2k", a["two"], ctrl)[s] for s in STAGES], [10, 40, 40, 40, 10, 10, 10])
# A failed check removes that arm's round, and only it.
for k in range(0, 9):
    got = arms(rows_for("a", 2, 8, 0, {}, bad=k))[("a", 2, 8, 0)]
    arm = rows_for("a", 2, 8, 0, {})[k]["arm"]
    check(f"failed row {k} drops {arm}", (arm in got, sorted(got)), (False, sorted({"snr", "two", "svc", "ctrl", "ctrl-aa"} - {arm})))
check("a residual short of its frames fails", failed({"res": [1], "exact": 0, "frames": 1, "lossy": 1}), True)


def campaign(n, ratio, prev=None, noise=0.01, seed=1):
    rng = random.Random(seed)
    rows = []
    for r in range(n):
        for v in (4, 8):
            j = lambda: math.exp(rng.gauss(0, noise))  # noqa: E731
            rows += rows_for("a", 2, v, r, {"snr": ratio * j(), "two": j(), "svc": j(), "ctrl": j(), "ctrl-aa": j()},
                             prev=prev(r) if prev else None)
    return rows


rows = campaign(24, 1.3)
cells = arms(rows)
norm = normalized(cells)
gate = aa(cells)
unread = unread_blocks(gate, order_effects(cells, rows))
check("A/A passes on the same arm", unread, set())
check("snr slower, decided", pair(norm, "a", 2, 4, "snr", "two", "every slice, preview", unread), "y")
check("two faster, decided", pair(norm, "a", 2, 4, "two", "snr", "every slice, preview", unread), "x")
check("svc paired across blocks at v 4", pair(norm, "a", 2, 4, "svc", "two", "first picture", unread), "x")
check("too few rounds", pair(normalized(arms(campaign(5, 1.3))), "a", 2, 4, "snr", "two", "first picture", set()), "not resolved")
check("a failing A/A block is not read", pair(norm, "a", 2, 4, "snr", "two", "first picture", {("a", 2, 4)}), "not read")
check("svc not read with its own block", pair(norm, "a", 2, 4, "svc", "two", "first picture", {("a", 2, 8)}), "not read")
check("a flagged control is not read", pair(norm, "a", 2, 8, "snr", "two", "first picture", {("a", 2, 8, "ctrl")}), "not read")
check("one reads two's flag", pair(norm, "a", 2, 4, "one", "snr", "first picture", {("a", 2, 4, "two")}), "not read")
# The A/A gate fails when ctrl-aa carries a steady 10 % over ctrl.
aa_rows = [dict(x, ms=[m * 1.1 for m in x["ms"]]) if x["arm"] == "ctrl-aa" else x for x in rows]
check("A/A fails on a steady gap", ("a", 2, 4) in unread_blocks(aa(arms(aa_rows)), {}), True)
# An arm that runs 30 % slower after one predecessor is flagged by order.
after = lambda r: {"snr": ["two", "ctrl", "ctrl-aa", "first"][r % 4]}  # noqa: E731
carry = [dict(x, ms=[m * 1.3 for m in x["ms"]] if isinstance(x["ms"], list) else x["ms"] * 1.3)
         if x["arm"] == "snr" and x["prev"] == "two" else x for x in campaign(24, 1.0, prev=after)]
fx = order_effects(arms(carry), carry)
check("carryover flagged", fx[("a", 2, 4, "snr")][1], True)
check("no carryover", order_effects(arms(campaign(24, 1.0, prev=after)), campaign(24, 1.0, prev=after))[("a", 2, 4, "snr")][1], False)

# The label: dominance one way only is better or worse; both ways a trade; an unread stage voids all but a trade.
check("better", label([(True, False, True), (False, False, True)]), "better")
check("worse", label([(False, True, True)]), "worse")
check("trade", label([(True, False, True), (False, True, True)]), "a trade")
check("neither", label([(False, False, True)]), "neither dominates")
check("unread voids better", label([(True, False, True), (False, False, False)]), "not read")
check("unread keeps a trade", label([(True, False, True), (False, True, True), (False, False, False)]), "a trade")
# judge on the synthetic campaign: two dominates snr nowhere it is compared, but against one (its own VL stream)
# two pays the preview's bytes for a faster first picture.
e8 = {**e, "g": {"2": {**e["g"]["2"], "vl": {"4": e["g"]["2"]["vl"]["4"]}, "snr": {"4": e["g"]["2"]["snr"]["4"]}}}}
_, labels = judge(norm, "a", 2, 4, stage_bytes(e8, 2, 4), unread)
check("two against one", labels[("two", "one")][0], "a trade")
check("two against one: first picture", "first picture" in labels[("two", "one")][1], True)

print(f"{cases - len(wrong)}/{cases} claims hold")
for w in wrong:
    print("  " + w)
sys.exit(1 if wrong else 0)
