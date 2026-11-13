#!/usr/bin/env python3
"""R5's reading (docs/lines/proposals.md §P6's rule, §R5 amendment 1): per route and cell, each arm against today's
page, the A/A arm's spread as the floor of each time tolerance, pooled over cells as the median of the cells' values.

    python3 lab/proposals/r5_summary.py rows/r5-taken.jsonl rows/r5-refused.jsonl rows/r5-failed.jsonl
"""
import collections
import json
import statistics
import sys

med = statistics.median


def rows(path):
    try:
        return [json.loads(l) for l in open(path) if l.strip()]
    except FileNotFoundError:
        return []


def cell(r):
    run = r["run"]
    return (run["static"], "loss 1" if "--loss 1" in run["link"] else "clean", run["id"])


def timed(route, rs, fp_bar, fill_bar):
    by = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in rs:
        by[cell(r)][r["arm"]].append(r)
    print(f"\n## {route}: {len(rs)} rows, {len(by)} cells")
    per = collections.defaultdict(lambda: {"fp": [], "fill": []})
    for c in sorted(by):
        today = by[c]["today"]
        base_fp = med([r["run"]["cold"]["firstPictureMs"] for r in today])
        base_fill = med([r["run"]["cold"]["fillMs"] for r in today])
        line = [f"{' · '.join(c)}: today fp {base_fp:.0f} fill {base_fill:.0f}"]
        for arm in ("aa", "lazy", "probe"):
            a = by[c][arm]
            fp = med([r["run"]["cold"]["firstPictureMs"] for r in a]) - base_fp
            fill = med([r["run"]["cold"]["fillMs"] for r in a]) / base_fill
            per[arm]["fp"].append(fp)
            per[arm]["fill"].append(fill)
            line.append(f"{arm} {fp:+.0f} ms {fill:.3f}x (n {len(a)})")
        print("  " + "; ".join(line))
    aa_fp = abs(med(per["aa"]["fp"]))
    aa_fill = abs(med(per["aa"]["fill"]) - 1)
    fp_tol, fill_tol = max(fp_bar, aa_fp), max(fill_bar or 0, aa_fill)
    print(f"  A/A pooled: fp {med(per['aa']['fp']):+.1f} ms, fill {med(per['aa']['fill']):.3f}x; "
          f"tolerances fp {fp_tol:.1f} ms, fill {1 + fill_tol:.3f}x")
    out = {}
    for arm in ("lazy", "probe"):
        fp, fill = med(per[arm]["fp"]), med(per[arm]["fill"])
        ok_fp = fp <= fp_tol
        ok_fill = fill <= 1 + fill_tol if fill_bar is not None else True
        out[arm] = (ok_fp, ok_fill)
        print(f"  {arm} pooled: fp {fp:+.1f} ms ({'holds' if ok_fp else 'fails'}), fill {fill:.3f}x "
              f"({'holds' if ok_fill else 'fails'}); cells over fp tolerance "
              f"{sum(v > fp_tol for v in per[arm]['fp'])} of {len(per[arm]['fp'])}")
    return out


def requests(route, rs):
    print(f"  {route} dav1d requests per cold load, by arm and host (warm in brackets):")
    t = collections.defaultdict(list)
    for r in rs:
        t[(r["arm"], r["run"]["static"])].append(r)
    for k in sorted(t):
        cold = collections.Counter(len(r["run"]["cold"]["dav1dRequests"]) for r in t[k])
        warm = collections.Counter(len(r["run"].get("warm", {}).get("dav1dRequests", [])) for r in t[k])
        bytes_ = sorted({r["run"]["cold"]["dav1dBytes"] for r in t[k]})
        print(f"    {k[0]:5} {k[1]:5}: {dict(cold)} [{dict(warm)}], body bytes {bytes_[:3]}{'…' if len(bytes_) > 3 else ''}")
    return t


def main():
    taken, refused, failed = (rows(p) for p in sys.argv[1:4])
    errors = [r for r in taken + refused + failed if r["run"].get("error")]
    print(f"errors: {len(errors)}", *[f"  {r['route']} {r['arm']} {r['round']} {r['run']['error'][:120]}" for r in errors], sep="\n")
    if taken:
        t = requests("taken", taken)
        bad = [(r["arm"], r["run"]["id"]) for r in taken if r["arm"] in ("lazy", "probe") and r["run"]["cold"]["dav1dRequests"]]
        print(f"  rule (1) bytes: lazy/probe cold loads with a dav1d request: {len(bad)}")
        routes = collections.Counter((r["arm"], r["run"]["cold"]["decoders"]) for r in taken)
        print(f"  routes: {dict(routes)}")
        timed("taken", taken, 10, 0.02)
    if refused:
        requests("refused", refused)
        want = {(r["run"]["id"], r["round"], cell(r)): r["run"]["cold"]["label"] for r in refused if r["arm"] == "today"}
        n = {r["run"]["id"]: int(r["run"]["cold"]["status"].split(" of ")[1].split(" ")[0]) for r in refused}
        bad = [r for r in refused if r["run"]["cold"]["decoders"] != f"av1-dav1d {n[r['run']['id']]}"
               or r["run"]["cold"]["label"] != want.get((r["run"]["id"], r["round"], cell(r)))]
        print(f"  rule (2) routes and label: {len(bad)} loads not all av1-dav1d or not today's label",
              *[f"    {r['arm']} {cell(r)} {r['run']['cold']['decoders']} {r['run']['cold']['label']}" for r in bad[:10]], sep="\n")
        timed("refused", refused, 50, None)
    if failed:
        print(f"\n## failed: {len(failed)} rows")
        by = collections.defaultdict(dict)
        for r in failed:
            run = r["run"]
            painted = [f[0] for i, f in enumerate(run.get("routes", [])) if i == 0 or f[1] != run["routes"][i - 1][1]]
            stale = sorted({int(f[0]) for i, f in enumerate(run.get("routes", [])) if i and f[1] == run["routes"][i - 1][1]})
            routes = collections.Counter(f[1].split(" · ")[0] for f in run.get("routes", []))
            by[(run["id"], r["round"])][r["arm"]] = (run["cold"]["status"].split(" · ")[3], run["cold"]["decoders"], tuple(stale))
        for k in sorted(by):
            same = len({v for v in by[k].values()}) == 1
            print(f"  {k[0]} round {k[1]}: {'same in every arm' if same else 'DIFFERS'}: " + "; ".join(f"{a} {v}" for a, v in sorted(by[k].items())))


main()
