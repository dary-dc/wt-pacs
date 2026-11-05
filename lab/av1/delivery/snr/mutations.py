#!/usr/bin/env python3
"""The browser mutations' outcome (docs/av1/snr-preview.md §7): per break, which (arm, op) checks failed, against
the checks it must fail and only those. Exits 1 if a break misses its own check or fails another's.

usage: mutations.py shard-k.mutations.jsonl
"""
import json
import sys
from collections import defaultdict

LOSSY_JUMPS = {("snr", "preview-jump"), ("snr", "vl-jump"), ("two", "preview-jump"), ("two", "vl-jump"), ("svc", "preview-jump")}
EXACT_JUMPS = {("snr", "residual"), ("two", "residual"), ("svc", "exact-jump")}
EVERY = {(a, o) for a in ("snr", "two") for o in ("preview", "vl", "preview-jump", "vl-jump", "residual")} | \
    {("svc", o) for o in ("preview", "exact", "preview-jump", "exact-jump")} | {("ctrl", "cine-exact"), ("ctrl-aa", "cine-exact")}
# What each break must fail, and nothing else; skip may leave a jump to a keyframe whole, so it must fail at least one.
# An arm stopped by the decoder's error fails every check of that arm the break must fail.
MUST = {
    "sample": EVERY, "truth": EVERY,
    "offset": {("snr", "vl"), ("two", "vl"), ("snr", "residual"), ("two", "residual")},
    "skip": LOSSY_JUMPS | EXACT_JUMPS,
    "low": {("svc", "exact"), ("svc", "exact-jump")},
    "unit": {("snr", "vl"), ("snr", "vl-jump"), ("snr", "residual")},
}
SOME = {"skip", "unit"}


def bad(x):
    return bool(x.get("error") or x.get("exact") is False or x.get("lossy") is False
                or ("frames" in x and (x.get("lossy", x.get("exact")) < x["frames"]))
                or ("res" in x and x.get("exact") < x["frames"]))


def main():
    got = defaultdict(set)
    seen = set()
    for line in open(sys.argv[1]):
        x = json.loads(line)
        if x.get("void"):
            got[x["mutate"]].add(("VOID", ""))
            continue
        seen.add(x["mutate"])
        if x["op"] == "failed":
            got[x["mutate"]] |= {c for c in MUST[x["mutate"]] if c[0] == x["arm"]} or {(x["arm"], "failed")}
        elif bad(x):
            got[x["mutate"]].add((x["arm"], x["op"]))
    wrong = []
    print("| break | checks failed | must fail | outcome |\n| --- | --- | --- | --- |")
    for m in MUST:
        must, failed = MUST[m], got[m]
        ok = m in seen and (failed & must if m in SOME else must <= failed) and failed <= must
        wrong += [] if ok else [m]
        print(f"| {m} | {', '.join(f'{a} {o}' for a, o in sorted(failed)) or 'none'} | {len(must)} | {'caught, only its own' if ok else 'WRONG'} |")
    sys.exit(1 if wrong else 0)


if __name__ == "__main__":
    main()
