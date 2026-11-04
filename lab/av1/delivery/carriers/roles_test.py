#!/usr/bin/env python3
"""roles.py's arithmetic: the link pipeline, bytes at equal PSNR, an ask's bytes, the decision rule and the verdict.

usage: roles_test.py   — exits 1 naming each wrong case
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from roles import ask_bytes, at_psnr, decided, order_effect, pipeline, verdict  # noqa: E402

wrong = []


def check(name, got, want):
    if got != want:
        wrong.append(f"{name}: {got!r}, want {want!r}")


def near(a, b):
    return abs(a - b) < 1e-9


# A link-bound fill: 1 000 000 B at 8 Mbit/s is 1 s; decode 1 ms after the last byte and the 40 ms round trip.
check("link-bound", [round(t, 6) for t in pipeline([500_000, 500_000], [1, 1], 8)], [541.0, 1041.0])
# A decode-bound fill: tiny units, 100 ms a frame — each frame waits for the one before, not for its bytes.
check("decode-bound", [round(t, 6) for t in pipeline([1, 1, 1], [100, 100, 100], 50)], [140.00016, 240.00016, 340.00016])
# Half way in PSNR is the geometric mean of the bytes; outside the rungs there is no answer.
check("at_psnr mid", near(at_psnr([(40, 100), (50, 10_000)], 45), 1000), True)
check("at_psnr outside", at_psnr([(40, 100), (50, 10_000)], 51), None)
# A group of 8: frame 13 needs tops 8…13 and its own low bits; a keyframe in every unit needs one top.
top, low = list(range(100, 116)), [1000 + i for i in range(16)]
check("ask in a group", ask_bytes(top, low, 8, 13), sum(range(108, 114)) + 1013)
check("ask alone", ask_bytes(top, low, 1, 13), 113 + 1013)
check("ask, whole stream", ask_bytes(top, None, 8, 8), 108)
# Ten rounds: the separate arm at half the layered arm's time, the A/A within ±1 %, is decided for separate.
ref = [100.0] * 10
aa = [99.0, 101.0] * 5
check("decided", decided([50.0 + i for i in range(10)], [100.0 + i for i in range(10)], ref, aa)[0], "separate")
check("decided, reversed", decided([100.0 + i for i in range(10)], [50.0 + i for i in range(10)], ref, aa)[0], "layered")
# Inside the A/A's range it is not resolved, however consistent; under three rounds it is never decided.
check("inside A/A", decided([100.5] * 10, [100.0] * 10, ref, aa)[0], "not resolved")
check("too few", decided([50.0, 51.0], [100.0, 101.0], ref[:2], aa[:2])[0], "not resolved")
check("verdict one way", verdict(["separate", "not resolved"]), "separate better")
check("verdict both", verdict(["separate", "layered"]), "a trade")
check("verdict none", verdict(["not resolved"]), "the same")
check("order effect", round(order_effect({"a": [1.0, 1.0], "b": [1.2, 1.2]}), 3), round(1.2 / 1.1 - 1, 3))

for w in wrong:
    print("WRONG", w)
print(f"roles_test: {16 - len(wrong)}/16")
sys.exit(1 if wrong else 0)
