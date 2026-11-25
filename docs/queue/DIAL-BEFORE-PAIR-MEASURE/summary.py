"""Medians per cell of rows.jsonl (VOID and failed visits out), PR 448 against the tip and the A/A pair, in ms and in
round trips. README.md beside this file.

    python3 -I summary.py rows.jsonl
"""
import json
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
kept = [r for r in rows if not r.get("void") and not r.get("error") and r.get("firstPicture") is not None]
print(f"{len(rows)} visits, {sum(bool(r.get('void')) for r in rows)} VOID, "
      f"{sum(bool(r.get('error')) or r.get('firstPicture') is None for r in rows)} failed, {len(kept)} kept\n")


def med(view, rtt, arms, key):
    v = [r[key] for r in kept if r["view"] == view and r["rtt"] == rtt and r["label"] in arms and r.get(key) is not None]
    return (statistics.median(v), len(v)) if v else (None, 0)


def paired(view, rtt, a, b, key):
    """Per round, the median of b's visits less a's: the interleaved difference."""
    d = []
    for rnd in sorted({r["round"] for r in kept}):
        x = [r[key] for r in kept if r["round"] == rnd and r["view"] == view and r["rtt"] == rtt and r["label"] in a]
        y = [r[key] for r in kept if r["round"] == rnd and r["view"] == view and r["rtt"] == rtt and r["label"] in b]
        if x and y:
            d.append(statistics.median(y) - statistics.median(x))
    return d


TIP, PR = ("tip-a", "tip-b"), ("pr-a", "pr-b")
for key in ("firstPicture", "fill"):
    print(f"{key}, ms from navigation: median (visits); PR − tip per round, median [range] (rounds), and in round trips; "
          "A/A tip-b − tip-a")
    print("| view | RTT | tip | PR 448 | PR − tip | round trips | A/A |")
    print("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
    for view in ("page", "worker"):
        for rtt in sorted({r["rtt"] for r in rows}):
            t, nt = med(view, rtt, TIP, key)
            p, np_ = med(view, rtt, PR, key)
            d = paired(view, rtt, TIP, PR, key)
            aa = paired(view, rtt, ("tip-a",), ("tip-b",), key)
            if t is None or p is None:
                continue
            dm = statistics.median(d) if d else None
            rng = f"[{min(d):.0f}, {max(d):.0f}]" if d else ""
            aam = f"{statistics.median(aa):+.0f} ({len(aa)})" if aa else "—"
            print(f"| {view} | {rtt} | {t:.0f} ({nt}) | {p:.0f} ({np_}) | {dm:+.0f} {rng} ({len(d)}) | "
                  f"{dm / rtt:+.2f} | {aam} |")
    print()

print("the fetches, ms from navigation, medians: /series/metadata end, exact metadata [start, end], manifest [start, end]")
for view in ("page", "worker"):
    for rtt in sorted({r["rtt"] for r in rows}):
        for name, arms in (("tip", TIP), ("PR", PR)):
            v = [r for r in kept if r["view"] == view and r["rtt"] == rtt and r["label"] in arms]
            if not v:
                continue
            m = lambda k, i: statistics.median([r[k][i] for r in v if r.get(k)]) if any(r.get(k) for r in v) else float("nan")
            print(f"{view} {rtt} {name}: metadata {m('metadata', 1):.0f}, exact [{m('exactMeta', 0):.0f}, "
                  f"{m('exactMeta', 1):.0f}], manifest [{m('manifest', 0):.0f}, {m('manifest', 1):.0f}]")
