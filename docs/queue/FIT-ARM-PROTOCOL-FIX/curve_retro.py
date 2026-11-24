"""FIT-ARM-PROTOCOL-FIX's retrodiction: A2.4's wire curve, built from the 2026-11-23 counted B loads, applied to that
run's A, A' and C1 fills of the same (form, volume). A reading aid, not a test.

    python3 curve_retro.py lab/delivery    (from a claude/delivery checkout's root)
"""
import json, statistics, sys
sys.path.insert(0, sys.argv[1] + "/rows/judged")
from recount import void_reasons

root = sys.argv[1]
inputs = json.load(open(f"{root}/inputs.json"))
PREFIX = {"LTE": 16, "LOSS": 8}
RTT = {"LTE": 38, "LOSS": 40}


def makespan(units, decoders=2):
    free = [0.0] * decoders
    for u in units:
        free[free.index(min(free))] += u
    return max(free)


def curve(points, start):
    pts = [(0.0, start)] + points
    def w(b):
        for (b0, t0), (b1, t1) in zip(pts, pts[1:]):
            if b <= b1:
                return t0 + (b - b0) * (t1 - t0) / (b1 - b0)
        (b0, t0), (b1, t1) = pts[-2], pts[-1]
        return t1 + (b - b1) * (t1 - t0) / (b1 - b0)
    return w


for cell in ["LTE", "LOSS"]:
    rows = [json.loads(l) for l in open(f"{root}/rows/{cell}.jsonl")]
    pilot = json.load(open(f"{root}/rows/{cell}-pilot.pilot-medians.json"))
    counted = [r for r in rows if not void_reasons(r, pilot.get(f"{cell}/{r['volume']}/{r['arm']}"))]
    for vol, v in inputs["volumes"].items():
        n = PREFIX[cell]
        exact = v["exact"]["frames"][:n]
        cum = [sum(exact[:i + 1]) for i in range(n)]
        b = [r for r in counted if r["volume"] == vol and r["arm"] == "B"]
        last = [statistics.median(next(f["lastByte"] for f in r["load"]["frames"] if f["i"] == i) - r["load"]["fillFrom"] for r in b) for i in range(n)]
        w = curve(list(zip(cum, last)), 3 * RTT[cell] + 20)
        view = v["view"]["frames"][:n]
        g, d = v["view"]["group"], v["view"]["frameMs"]
        units = [len(view[k:k + g]) * d for k in range(0, n, g)]
        pred = max(w(sum(view)) + d, w(sum(view[:g])) + makespan(units))
        wire_pred = w(sum(view))
        out = [f"{cell} {vol}: B loads {len(b)}, view {sum(view)/1e6:.2f} MB, first point {cum[0]/1e6:.2f} MB ({'under' if sum(view) < cum[0] else 'over'}), first group {sum(view[:g])/1e6:.2f} MB, predicted {pred:.0f} ms"]
        for arm in ["A", "A'", "C1"]:
            m = [r["load"]["fillMs"] for r in counted if r["volume"] == vol and r["arm"] == arm]
            wm = [max(f["lastByte"] for f in r["load"]["frames"]) - r["load"]["fillFrom"] for r in counted if r["volume"] == vol and r["arm"] == arm]
            out.append(f"{arm} n={len(m)} fill x{statistics.median(x / pred for x in m):.2f} wire x{statistics.median(x / wire_pred for x in wm):.2f}")
        print("; ".join(out))
