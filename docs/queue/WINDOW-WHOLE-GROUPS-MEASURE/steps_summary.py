#!/usr/bin/env python3
"""steps.jsonl -> per (form, rate, pass) and arm: a pass's MB on the wire, its steps that waited for their frame (count, sum,
median, max ms), each as the median over rounds; the tip over the branch, and each A/A pair's ratio. README.md beside this file.

  python3 steps_summary.py steps.jsonl
"""
import json
import statistics
import sys

rows = [json.loads(l) for l in open(sys.argv[1])]
bad = [r for r in rows if r.get("error") or r.get("void")]
rows = [r for r in rows if not (r.get("error") or r.get("void"))]
med = statistics.median


def cell(r, p):
    waited = [s["ms"] for s in r[p] if s["waited"]]
    return {"mb": r[f"{p}Wire"]["bytes"] / 1e6, "frames": r[f"{p}Wire"]["frames"], "n": len(waited), "sum": sum(waited),
            "med": med(waited) if waited else 0, "max": max(waited, default=0), "all": sum(s["ms"] for s in r[p])}


print(f"{len(rows)} rows kept, {len(bad)} VOID or failed:", [(r['round'], r['form'], r['rate'], r['label'], r.get('error')) for r in bad])
keys = ["mb", "frames", "n", "sum", "med", "max", "all"]
print("\nform  rate pass     arm   rounds    MB  frames waited  sum ms  med ms  max ms  pass ms")
for form in ("CLEAN", "LTE"):
    for rate in (1, 4):
        for p in ("forward", "backward"):
            by = {}
            for label in ("tip-a", "tip-b", "pr-a", "pr-b"):
                cs = [cell(r, p) for r in rows if (r["form"], r["rate"], r["label"]) == (form, rate, label)]
                if not cs:
                    continue
                by[label] = {k: med([c[k] for c in cs]) for k in keys}
                m = by[label]
                print(f"{form:5} {rate}x   {p:8} {label:5} {len(cs):5} {m['mb']:7.1f} {m['frames']:6.0f} {m['n']:6.0f} {m['sum']:7.0f} "
                      f"{m['med']:7.0f} {m['max']:7.0f} {m['all']:8.0f}")
            arm = lambda a, k: med([by[x][k] for x in by if x.startswith(a)])
            if any(x.startswith("tip") for x in by) and any(x.startswith("pr") for x in by):
                ratio = lambda k: arm("tip", k) / arm("pr", k) if arm("pr", k) else float("inf")
                aa = lambda a, k: by[f"{a}-a"][k] / by[f"{a}-b"][k] if f"{a}-b" in by and by[f"{a}-b"][k] else float("nan")
                print(f"      tip / pr: MB ÷{ratio('mb'):.2f}, waited sum ÷{ratio('sum'):.2f}, max ÷{ratio('max'):.2f}, pass ÷{ratio('all'):.2f}"
                      f"   A/A MB {aa('tip', 'mb'):.2f} {aa('pr', 'mb'):.2f}, waited sum {aa('tip', 'sum'):.2f} {aa('pr', 'sum'):.2f}")
