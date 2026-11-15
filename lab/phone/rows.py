#!/usr/bin/env python3
"""The phone run's rows read against docs/devices.md §7 as amended: per load the beacon's verdict and fill, per link the
quads' worker/page and bbr/cubic-restart ratios, and the pre-registered rule over them.

  rows.py BEACON_DIR SERIES [--exclude LOAD_ID ...]   loads are the runner's steps, 1-based as its banner names them
"""
import argparse
import glob
import json
import statistics
from pathlib import Path

ARMS = {("cubic-restart", "page"): "A", ("cubic-restart", "worker"): "B", ("bbr", "worker"): "C", ("bbr", "page"): "D"}
NEEDED_BELOW = {12: 10, 11: 10, 10: 9, 9: 8, 8: 8}  # the Second amendment's thresholds, two-sided p <= 0.05


def loads(beacon_dir: str, series: str, exclude: set) -> dict:
    by_load = {}
    for f in sorted(glob.glob(f"{beacon_dir}/beacon-*.jsonl")):
        for line in open(f):
            r = json.loads(line)
            if r.get("series") != series or r["load"] in exclude:
                continue
            by_load.setdefault(r["load"], []).append(r)
    out = {}
    for records in by_load.values():
        first = records[0]
        load = next((r for r in records if r["kind"] == "load"), {})
        verdict = next((r for r in records if r["kind"] == "verdict"), None)
        step = first["step"] + 1
        if step in out:
            raise SystemExit(f"load {step} appears twice: exclude one by its load id")
        out[step] = {"link": first["link"], "arm": ARMS[(first["controller"], first["view"])], "counted": first["counted"],
                     "ok": verdict["ok"] if verdict else None, "why": verdict.get("why") if verdict else "no verdict",
                     "fill_ms": load.get("fillMs"), "id": first["load"]}
    return out


def quads(rows: dict) -> list:
    """Each link's quads in order: the counted loads of one link within one octet, four arms."""
    counted = sorted((s, r) for s, r in rows.items() if r["counted"])
    first = 5
    by_quad = {}
    for step in range(first, first + 48):
        octet, link = (step - first) // 8, None
        by_quad.setdefault((octet, "tether" if (step - first) % 2 == octet % 2 else "wifi"), []).append(step)
    return [(octet, link, steps, {rows[s]["arm"]: rows[s] for s in steps if s in rows}) for (octet, link), steps in
            sorted(by_quad.items())] if counted else []


def ratio(q: dict, num: str, den: str):
    a, b = q.get(num), q.get(den)
    if not a or not b or not a["ok"] or not b["ok"] or not a["fill_ms"] or not b["fill_ms"]:
        return None
    return a["fill_ms"] / b["fill_ms"]


def verdict(ratios: list, numerator: str, denominator: str) -> str:
    n = len(ratios)
    if n < 8:
        return f"not decided: {n} ratios left"
    below, med = sum(r < 1 for r in ratios), statistics.median(ratios)
    need = NEEDED_BELOW[n]
    if below >= need and med <= 0.95:
        return f"{numerator} faster ({below} of {n} below 1, median {med:.3f})"
    if n - below >= need and 1 / med <= 0.95:
        return f"{denominator} faster ({n - below} of {n} above 1, median {med:.3f})"
    return f"no difference shown at n = {n} ({below} below 1, median {med:.3f}, range {min(ratios):.3f}-{max(ratios):.3f})"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("beacon_dir")
    ap.add_argument("series")
    ap.add_argument("--exclude", nargs="*", default=[])
    a = ap.parse_args()
    rows = loads(a.beacon_dir, a.series, set(a.exclude))
    print("step link arm counted verdict fill_s")
    for s in sorted(rows):
        r = rows[s]
        print(s, r["link"], r["arm"], "counted" if r["counted"] else "warm-up",
              "PASS" if r["ok"] else f"FAIL ({r['why']})", f"{r['fill_ms'] / 1000:.3f}" if r["fill_ms"] else "-")
    missing = [s for s in range(5, 53) if s not in rows]
    print("missing:", missing or "none")
    for link in ("tether", "wifi"):
        qs = [q for q in quads(rows) if q[1] == link]
        view = {"cubic-restart": [ratio(q[3], "B", "A") for q in qs], "bbr": [ratio(q[3], "C", "D") for q in qs]}
        cc = {"page": [ratio(q[3], "D", "A") for q in qs], "worker": [ratio(q[3], "C", "B") for q in qs]}
        print(f"\n== {link}: fills (s) per arm, passed loads only")
        for arm in "ABCD":
            fills = [q[3][arm]["fill_ms"] / 1000 for q in qs if arm in q[3] and q[3][arm]["ok"]]
            print(f"  {arm}: n={len(fills)} median {statistics.median(fills):.3f} range {min(fills):.3f}-{max(fills):.3f}")
        for name, (num, den), groups in (("worker / page", ("worker", "page"), view), ("bbr / cubic-restart", ("bbr", "cubic-restart"), cc)):
            pooled = [r for g in groups.values() for r in g if r is not None]
            meds = {k: statistics.median([r for r in v if r is not None]) for k, v in groups.items() if any(r is not None for r in v)}
            print(f"  {name}: per level " + ", ".join(f"{k} {[round(r, 3) if r else None for r in v]} median {meds.get(k, float('nan')):.3f}" for k, v in groups.items()))
            if len(meds) == 2 and (min(meds.values()) < 1 < max(meds.values())):
                print(f"  {name}: depends on the other factor (medians on opposite sides of 1); not pooled")
            else:
                print(f"  {name}: {verdict(pooled, num, den)}")


if __name__ == "__main__":
    main()
