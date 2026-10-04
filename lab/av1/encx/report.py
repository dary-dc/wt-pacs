#!/usr/bin/env python3
"""ENCX's tables from encx.py's and noise.py's JSON: bytes over HTJ2K's (the served profile) per set.

usage: report.py BYTES.json NOISE.json [TOOLS.json]   — README.md here
"""
import json
import sys
from collections import defaultdict

LOW = ("", "+raw", "+deflate", "+deflate-u")
DATA = "lab/av1/data"


def table(head, rows):
    print("| " + " | ".join(head) + " |")
    print("| " + " | ".join("---" for _ in head) + " |")
    for r in rows:
        print("| " + " | ".join(r) + " |")
    print()


def fmt(x):
    return "—" if x is None else f"{x:.3f}"


def main():
    rows = json.load(open(sys.argv[1]))
    noise = json.load(open(sys.argv[2]))
    by = defaultdict(dict)
    for r in rows:
        by[r["set"]][r["coding"]] = r
    sets = list(by)
    ratio = lambda s, c: by[s].get(c, {}).get("ratio")  # noqa: E731
    bad = [(r["set"], r["coding"], r["exact"], r["frames"]) for r in rows if r["exact"] != r["frames"]]
    print(f"{len(rows) - len(bad)}/{len(rows)} codings exact; not: {bad}\n")

    print("Fairness: HTJ2K on the same representation\n")
    table(["set", "frames", "HTJ2K served", "HTJ2K direct", "HTJ2K low2", "HTJ2K top2 + low2 deflated", "AV1 low2 (row 28)", "AV1 direct"],
          [[s, str(by[s]["htj2k.direct"]["frames"]), f"{by[s]['htj2k.direct']['htj2k'] / 1e6:.2f} MB", fmt(ratio(s, "htj2k.direct")),
            fmt(ratio(s, "htj2k.low2")), fmt(ratio(s, "htj2k.low2+deflate")), fmt(ratio(s, "av1.low2")), fmt(ratio(s, "av1.direct"))]
           for s in sets])

    print("The low stream: AV1 top, the low k bits by each coder (whole coding over HTJ2K); the low stream's bits a sample\n")
    head = ["set"] + [f"low{k}{lc or ' AV1'}" for k in (1, 2, 3) for lc in LOW]
    out = []
    for s in sets:
        out.append([s] + [fmt(ratio(s, f"av1.low{k}{lc}")) for k in (1, 2, 3) for lc in LOW])
    table(head, out)
    out = []
    for s in sets:
        m = json.load(open(f"{DATA}/{s}/metadata.json"))
        samples = by[s]["htj2k.direct"]["frames"] * m["width"] * m["height"] * m["channels"]
        line = [s]
        for lc in LOW:
            c = by[s].get(f"av1.low2{lc}")
            low = c and next(v for k, v in c["streams"].items() if k.startswith(("low2.", "rctlow2.")))
            line.append(f"{8 * low / samples:.3f}" if low else "—")
        out.append(line)
    table(["set", "low2 by AV1, bits a sample", "raw", "deflate", "deflate-u"], out)

    print("The split per frame: k by an oracle on bytes, by the noise estimate, and fixed at 2\n")
    est = defaultdict(dict)
    for n in noise:
        est[n["set"]][n["frame"]] = n
    out = []
    for s in sets:
        ks = [k for k in (1, 2, 3) if f"av1.low{k}" in by[s] and by[s][f"av1.low{k}"]["bytes"]]
        ht = by[s]["htj2k.direct"]["htj2k"]
        n = by[s]["htj2k.direct"]["frames"]

        def best(k, i, coders=LOW):
            return min(by[s][f"av1.low{k}{lc}"]["bytes"][i] for lc in coders if by[s].get(f"av1.low{k}{lc}", {}).get("bytes"))

        fixed_av1 = sum(by[s]["av1.low2"]["bytes"]) / ht
        fixed_best = sum(best(2, i) for i in range(n)) / ht
        oracle = [min(ks, key=lambda k: best(k, i)) for i in range(n)]
        orc = sum(best(oracle[i], i) for i in range(n)) / ht
        ek = [est[s][i]["k"] for i in range(n)]
        e = sum(best(ek[i], i) for i in range(n)) / ht
        sig = sorted({est[s][i]["sigma"] for i in range(n)})
        out.append([s, f"{sig[0]:.1f}–{sig[-1]:.1f}" if len(sig) > 1 else f"{sig[0]:.1f}", "".join(map(str, ek)), fmt(e),
                    "".join(map(str, oracle)), fmt(orc), fmt(fixed_best), fmt(fixed_av1)])
    table(["set", "σ", "k̂ a frame", "k̂, best low coder", "oracle k a frame", "oracle", "k = 2, best low coder", "k = 2, AV1 low (row 28)"], out)

    print("Temporal: a group (the set's frames) as one inter stream\n")
    table(["set", "AV1 low2 intra", "top inter, low intra", "top intra, low inter", "both inter", "direct inter"],
          [[s] + [fmt(ratio(s, c)) for c in ("av1.low2", "av1.low2.top-inter", "av1.low2.low-inter", "av1.low2.both-inter", "av1.direct.inter")]
           for s in sets if "av1.low2.both-inter" in by[s]])

    if len(sys.argv) > 3:
        tools = json.load(open(sys.argv[3]))
        tb = defaultdict(dict)
        for r in tools:
            tb[r["set"]][r["coding"]] = r
        names = [c for c in dict.fromkeys(r["coding"] for r in tools) if c != "av1.low2"]
        print("libaom's lossless tools on the split streams, bytes over the set's row 28 coding on the same frames\n")
        out = []
        for s in tb:
            b = tb[s]["av1.low2"]["total"]
            out.append([s, str(tb[s]["av1.low2"]["frames"]), fmt(tb[s]["av1.low2"]["ratio"])] +
                       [fmt(tb[s][c]["total"] / b) if tb[s].get(c, {}).get("total") else "—" for c in names])
        table(["set", "frames", "row 28 over HTJ2K"] + [c.removeprefix("av1.low2.") for c in names], out)


if __name__ == "__main__":
    main()
