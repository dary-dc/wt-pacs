"""Stage 2's reading: per set and throttle, the median of round-paired ratios (each round's median over frames and timed
passes), the A/A spread s from S's Lossless against W (the same bytes, the same build), J3 and J9, and R2's clause on J3.

    summary.py rows/stage2.jsonl
"""
import json
import statistics as st
import sys
from collections import defaultdict


def main():
    rows = [json.loads(line) for line in open(sys.argv[1])]
    print(f"pictures exact {sum(r['exact'] for r in rows)}/{len(rows)}; Chromium {sorted({r['version'] for r in rows})}")
    ms = defaultdict(list)
    for r in rows:
        if r["pass"] > 0:
            ms[(r["set"], r["throttle"], r["round"], r["arm"], r["ask"], r["workers"])].append(r["ms"])
    keys = sorted({(r["set"], r["throttle"]) for r in rows})
    rounds = sorted({r["round"] for r in rows})

    def per_round(s, t, num, den):
        out = []
        for rd in rounds:
            a, b = ms.get((s, t, rd, *num)), ms.get((s, t, rd, *den))
            if a and b:
                out.append(st.median(a) / st.median(b))
        return out

    W = ("W", "lossless", 1)
    for s, t in keys:
        aa = per_round(s, t, ("S", "lossless", 1), W)
        spread = sorted(abs(x - 1) for x in aa)[max(0, int(0.9 * len(aa)) - 1)] if aa else float("nan")
        j3 = per_round(s, t, ("D+T3", "lossless", 3), W)
        one = per_round(s, t, ("D+T3", "lossless", 1), W)
        j9 = per_round(s, t, ("S★", "first", 3), ("S", "first", 1))
        w_ms = st.median(x for rd in rounds for x in ms.get((s, t, rd, *W), []))
        print(f"{s:18} {t}x  W {w_ms:6.1f} ms  s {spread:.3f}  J3 ×{st.median(j3):.3f} "
              f"[{min(j3):.3f}–{max(j3):.3f}] ≤0.60 in {sum(x <= 0.60 * (1 + spread) for x in j3)}/{len(j3)}"
              f" (strict {sum(x <= 0.60 for x in j3)})  one worker ×{st.median(one):.3f}  J9 ×{st.median(j9):.3f}"
              f" [{min(j9):.3f}–{max(j9):.3f}]  n {len(j3)}")


if __name__ == "__main__":
    main()
