#!/usr/bin/env python3
"""Row 195's decision rule read off its visits: docs/adr/disk-access.md §6, Protocol for the measuring row.

    dockerread_summary.py WORK [--file time.jsonl]

Each comparison is a unit's metric over a reference's in the same round and cell. Its resolution is the p90 of
|H'/H - 1| over the rounds for that metric and cell; it counts as beyond when the median ratio is past the resolution
and at least 80 % of rounds fall on the median's side. Pairs are read strict (neither visit VOID) and round-paired
(every visit); past the 10 % VOID bar both readings are printed and a disagreement is named.
"""
import argparse
import json
import statistics
from pathlib import Path

REF, AA = "H", "Hp"
VOID_BAR, AGREE, FOLIO_BAND = 0.10, 0.80, 0.20
TIMED = ["tile_hit_p50_ns", "tile_hit_p99_ns", "tile_miss_p50_ns", "fill_hit_fps", "fill_hit_cpu_ns_per_gb",
         "fill_miss_fps", "fill_miss_cpu_ns_per_gb"]
COLD = ["cold.cold_p50_ns", "cold.cold_p99_ns", "cold.cold_cpu_ns_per_frame"]
# (unit, reference, the unit's metric, the reference's metric): what rules (b) and (c) and the O predictions read.
CROSS = [("O", REF, "tile_hit_p50_ns", "tile_miss_p50_ns"), ("O", REF, "tile_hit_p99_ns", "tile_miss_p99_ns"),
         ("O", REF, "fill_hit_fps", "fill_miss_fps"), ("O", REF, "fill_hit_cpu_ns_per_gb", "fill_miss_cpu_ns_per_gb"),
         ("O", "B", "tile_hit_p50_ns", "tile_hit_p50_ns"), ("O", "B", "tile_hit_p99_ns", "tile_hit_p99_ns")]


def value(row, metric):
    for key in metric.split("."):
        row = (row or {}).get(key)
    return row


def visits(rows):
    """{(round, arm, set, state): row}."""
    return {(r["round"], r["arm"], r["set"], r["state"]): r for r in rows}


def ratios(v, unit, ref, mu, mr, cell, strict):
    """{round: unit's mu over ref's mr} for one cell."""
    out = {}
    for (rnd, arm, s, st), row in v.items():
        if arm != unit or (s, st) != cell:
            continue
        other = v.get((rnd, ref, s, st))
        if other is None or value(row, mu) is None or value(other, mr) in (None, 0):
            continue
        if strict and (row["void"] or other["void"]):
            continue
        out[rnd] = value(row, mu) / value(other, mr)
    return out


def p90(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(0.9 * len(xs)))] if xs else None


def resolution(v, metric, cell, strict):
    return p90([abs(x - 1) for x in ratios(v, AA, REF, metric, metric, cell, strict).values()])


def judge(rs, res):
    """(median ratio, share of rounds on its side, 'beyond' or 'tie'), or None without pairs or a resolution."""
    if not rs or res is None:
        return None
    med = statistics.median(rs.values())
    side = sum((x > 1) == (med > 1) and x != 1 for x in rs.values()) / len(rs)
    return med, side, "beyond" if abs(med - 1) > res and side >= AGREE else "tie"


def comparisons(arms):
    out = [(a, REF, m, m) for a in arms if a not in (REF, AA) for m in TIMED + COLD]
    out += [c for c in CROSS if c[0] in arms and c[1] in arms]
    if "BUL" in arms and "B" in arms:
        out += [("BUL", "B", m, m) for m in TIMED + COLD]
    return out


def read(v, cells, arms, strict):
    """{(unit, ref, mu, mr, cell): (median, side, verdict, n, resolution)}."""
    out = {}
    for cell in cells:
        for unit, ref, mu, mr in comparisons(arms):
            rs = ratios(v, unit, ref, mu, mr, cell, strict)
            res = resolution(v, mu, cell, strict)
            j = judge(rs, res)
            if j:
                out[(unit, ref, mu, mr, cell)] = (*j, len(rs), res)
    return out


def verdict(reading, unit, ref, mu, mr, cell):
    return reading.get((unit, ref, mu, mr, cell), (None, None, None))[2]


def ties(reading, unit, ref, metrics):
    keys = [k for k in reading if k[0] == unit and k[1] == ref and k[2] in metrics]
    return bool(keys) and all(reading[k][2] == "tie" for k in keys)


def rules(reading, rows, arms):
    """The lines rules (a)–(c) turn on, from one reading."""
    out = []
    for arm in ("B", "V"):
        if arm in arms:
            out.append(f"(a) {arm} ties H on every timed metric: {ties(reading, arm, REF, TIMED)}")
    if "O" in arms:
        cells = {k[4] for k in reading if k[0] == "O"}
        at_miss = bool(cells) and all(verdict(reading, "O", REF, "tile_hit_p50_ns", "tile_miss_p50_ns", c) == "tie"
                                      for c in cells)
        past_b = bool(cells) and all(verdict(reading, "O", "B", "tile_hit_p50_ns", "tile_hit_p50_ns", c) == "beyond"
                                     for c in cells)
        out.append(f"(b) O's hit p50 ties H's forced miss in every cell: {at_miss}; beyond B in every cell: {past_b}")
    if "BUL" in arms:
        rings = [r.get("cold", {}).get("ring") for r in rows if r["arm"] == "BUL" and r.get("cold")]
        ring = bool(rings) and all(rings)
        out.append(f"(c) BUL ring=true on every cold pass: {ring}; cold ties H: {ties(reading, 'BUL', REF, COLD)}; "
                   f"every other metric ties B: {ties(reading, 'BUL', 'B', TIMED)}")
    return out


def folios(work):
    """Each arm's folios a frame against H's (within 20 %) and after against before (identical per frame)."""
    files = {label: work / f"folios-{label}.jsonl" for label in ("before", "after")}
    if not files["before"].exists():
        return ["folios: no folios-before.jsonl"]
    out = []
    counts = {}
    for label, path in files.items():
        if not path.exists():
            continue
        rows = [json.loads(ln) for ln in path.read_text().splitlines()]
        counts[label] = {(r["arm"], r["file"]): r for r in rows}
        h = {r["file"]: r["folios_per_frame"] for r in rows if r["arm"] == REF}
        off = [f"{r['arm']} {r['file']} ×{r['folios_per_frame'] / h[r['file']]:.2f}" for r in rows
               if abs(r["folios_per_frame"] / h[r["file"]] - 1) > FOLIO_BAND]
        out.append(f"(e) folios {label}: {len(rows) - len(off)} of {len(rows)} files within 20 % of H"
                   + (f"; outside: {', '.join(off)}" if off else ""))
    if "after" in counts:
        changed = [k for k, r in counts["before"].items()
                   if counts["after"].get(k, {}).get("per_frame_digest") != r["per_frame_digest"]]
        out.append(f"(e) folios after the last round equal those after placing: {not changed}"
                   + (f"; changed: {changed}" if changed else ""))
    return out


def summary(work, rows):
    v = visits(rows)
    arms = sorted({r["arm"] for r in rows}, key=[r["arm"] for r in rows].index)
    cells = sorted({(r["set"], r["state"]) for r in rows}, key=[(r["set"], r["state"]) for r in rows].index)
    voided = sum(bool(r["void"]) for r in rows) / len(rows)
    out = [f"{len(rows)} visits, {len({r['round'] for r in rows})} rounds, {voided:.1%} VOID (bar {VOID_BAR:.0%})"]
    readings = {"strict": read(v, cells, arms, True), "round-paired": read(v, cells, arms, False)}
    shown = ["strict", "round-paired"] if voided > VOID_BAR else ["strict"]
    for arm in arms:
        cold = [r["cold"] for r in rows if r["arm"] == arm and r.get("cold")]
        if cold:
            errs = sorted({c["ring_error"] for c in cold if c["ring_error"]})
            out.append(f"ring {arm}: {sum(c['ring'] for c in cold)} of {len(cold)} cold passes"
                       + (f"; {errs[0]}" if errs else ""))
    for name in shown:
        out.append(f"--- {name}")
        for (unit, ref, mu, mr, cell), (med, side, verdict, n, res) in readings[name].items():
            metric = mu if mu == mr else f"{mu} / {ref}'s {mr}"
            out.append(f"{unit:>3} / {ref:<3} {cell[0]:>12} {cell[1]:<8} {metric:<42} ×{med:.3f} "
                       f"(res {res:.3f}, {side:.0%} on its side, n {n})  {verdict.upper() if verdict == 'beyond' else verdict}")
        out += rules(readings[name], rows, arms)
    if len(shown) == 2:
        split = [k for k in readings["strict"] if k in readings["round-paired"]
                 and readings["strict"][k][2] != readings["round-paired"][k][2]]
        out.append(f"readings disagree on {len(split)} comparisons: not conclusive on this host" if split
                   else "the two readings agree")
    return out + folios(work)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work", type=Path)
    ap.add_argument("--file", default="time.jsonl")
    a = ap.parse_args()
    rows = [json.loads(ln) for ln in (a.work / a.file).read_text().splitlines()]
    print("\n".join(summary(a.work, rows)))


if __name__ == "__main__":
    main()
