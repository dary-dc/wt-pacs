#!/usr/bin/env python3
"""cells.py's rows, per cell: each arm's median [min–max] ask, fill and bytes ahead, the server's RSS per session,
and the arm's change against today paired by round — strict (neither run `VOID`) and round-paired (`VOID` included).

usage: summary.py ROWS.jsonl   — lab/ask-ahead/README.md
"""
import collections
import json
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
head, rows = rows[0], [r for r in rows[1:] if "cell" in r]
print(json.dumps(head))
bad = [r for r in rows if not r["exact"] or r["error"]]
print(f"runs {len(rows)}, VOID {sum(r['void'] for r in rows)}, not exact or failed {len(bad)}")
by = collections.defaultdict(dict)
for r in rows:
    by[(r["cell"], r["arm"])][r["round"]] = r


def span(xs):
    xs = sorted(xs)
    return f"{statistics.median(xs):7.0f} [{xs[0]:.0f}–{xs[-1]:.0f}]" if xs else "      –"


def paired(cell, key, strict):
    a, b = by[(cell, "today")], by[(cell, "follow")]
    d = [(b[k][key] - a[k][key]) / a[k][key] for k in a if k in b
         and not (strict and (a[k]["void"] or b[k]["void"]))]
    return (f"{100 * statistics.median(d):+6.1f} % [{100 * min(d):+.1f}…{100 * max(d):+.1f}] n={len(d)}"
            if d else "n=0")


cells = list(dict.fromkeys(r["cell"] for r in rows))
print("\ncell            arm     ask ms              fill ms             ahead MB  RSS MB  cwnd KB")
for cell in cells:
    for arm in ("today", "follow"):
        rs = list(by[(cell, arm)].values())
        print(f"{cell:15} {arm:7} {span([r['ask_ms'] for r in rs])}  {span([r['fill_ms'] for r in rs])}"
              f"  {statistics.median(r['ahead_bytes'] for r in rs) / 1e6:6.2f}"
              f"  {statistics.median(r['rss_session_kb'] for r in rs) / 1e3:6.1f}"
              f"  {statistics.median(r['cwnd'] or 0 for r in rs) / 1e3:7.0f}")
print("\nfollow against today, paired by round: median [min…max]")
for cell in cells:
    for strict in (True, False):
        print(f"{cell:15} {'strict' if strict else 'paired':7} ask {paired(cell, 'ask_ms', strict):34}"
              f" fill {paired(cell, 'fill_ms', strict)}")
