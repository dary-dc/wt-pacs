#!/usr/bin/env python3
"""links.py's visits as one row per (link, state, series, arm): medians and p90s, and each arm against B in the band.

usage: summary.py LINKS.ndjson [--markdown]
The band (README §Pre-registered): max(|B - B'|, 2 ms, 3 % of B), on medians.
"""
import argparse
import json
import statistics

LINKS = ("floor", "fiber", "4g5g", "geo")
ARMS = ("a1-instances", "a1-ready", "a2-instances", "a2-ready", "b", "b-again", "c")
MILESTONES = ("meta", "frame", "paint")


def pct(values: list, p: float) -> float:
    s = sorted(values)
    return s[round((len(s) - 1) * p)]


def verdict(arm: float, b: float, b_again: float) -> tuple:
    band = max(abs(b - b_again), 2.0, 0.03 * b)
    diff = arm - b
    return diff, band, "tie" if abs(diff) < band else ("slower" if diff > 0 else "faster")


def cells(rows: list) -> list:
    out = []
    for link in LINKS:
        for state in ("cold", "warm"):
            for series in ("ct", "ct2000"):
                group = {a: [r for r in rows if (r["link"], r["state"], r["series"], r["arm"]) == (link, state, series, a)]
                         for a in ARMS}
                if not group["b"]:
                    continue
                med = {a: {m: statistics.median(r[m] for r in group[a] if "error" not in r) for m in MILESTONES}
                       for a in ARMS}
                for arm in ARMS:
                    ok = [r for r in group[arm] if "error" not in r]
                    row = {"link": link, "state": state, "series": series, "arm": arm, "n": len(ok),
                           "errors": len(group[arm]) - len(ok)}
                    for m in MILESTONES:
                        row[f"{m}_p50"] = med[arm][m]
                        row[f"{m}_p90"] = pct([r[m] for r in ok], 0.9)
                        row[f"{m}_vs_b"] = verdict(med[arm][m], med["b"][m], med["b-again"][m])
                    out.append(row)
    return out


def markdown(out: list, milestone: str) -> None:
    cols = [(s, st) for s in ("ct", "ct2000") for st in ("cold", "warm")]
    print(f"| link | arm | {' | '.join(f'{s} {st}' for s, st in cols)} |")
    print("| --- | --- |" + " ---: |" * len(cols))
    for link in LINKS:
        for arm in ARMS:
            cell = []
            for s, st in cols:
                row = next((r for r in out if (r["link"], r["arm"], r["series"], r["state"]) == (link, arm, s, st)), None)
                if row is None:
                    cell.append("—")
                    continue
                diff, band, label = row[f"{milestone}_vs_b"]
                mark = "" if arm in ("b", "b-again") or label == "tie" else f" **{diff:+.0f}**"
                cell.append(f"{row[f'{milestone}_p50']:.0f} ({row[f'{milestone}_p90']:.0f}){mark}")
            print(f"| {link} | {arm} | {' | '.join(cell)} |")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("links")
    ap.add_argument("--markdown", action="store_true")
    args = ap.parse_args()
    out = cells([json.loads(line) for line in open(args.links)])
    if args.markdown:
        for m in MILESTONES:
            print(f"\n{m}\n")
            markdown(out, m)
    else:
        for row in out:
            print(json.dumps(row))


if __name__ == "__main__":
    main()
