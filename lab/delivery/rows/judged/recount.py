#!/usr/bin/env python3
"""DELIVERY-VERDICT-REVIEW's recount, written apart from judge.mjs: VOID from each row's raw fields, every
(cell, volume, arm, clock)'s ratios, holds and regime misses, and §7's A/A input. A reading aid, not a reviewed tool.

    python3 lab/delivery/rows/judged/recount.py lab/delivery [--no-guard] [--span-fill-band]
"""
import collections
import json
import statistics
import sys

CELLS = ["CLEAN", "PUB", "LTE", "LOSS", "CR"]
VOLUMES = ["dbts_a1", "dbts_b1", "dbts_c1"]


def most_at_once(spans):
    edges = sorted([(at - ms, 1) for at, ms in spans] + [(at, -1) for at, ms in spans])
    now = most = 0
    for _, step in edges:
        now += step
        most = max(most, now)
    return most


def latency(records):
    press = next((r for r in records if r["kind"] == "lossless"), None)
    painted = press and next((r for r in records if r["kind"] == "label" and r.get("quality") == "lossless"
                              and r["at"] >= press["at"]), None)
    return painted["at"] - press["at"] if painted else None


def makespan(units, decoders=2):
    free = [0.0] * decoders
    for u in units:
        free[free.index(min(free))] += u
    return max(free)


def regime(load, group):
    frames = sorted(load["frames"], key=lambda f: f["i"])
    wire = max(f["lastByte"] for f in frames) - load["fillFrom"]
    floor = makespan([sum(f["decodeMs"] for f in frames[k:k + group]) for k in range(0, len(frames), group)])
    return "wire" if wire > 1.1 * floor else "decode" if floor > 1.1 * wire else "near"


def void_reasons(row, pilot_median, guard=True):
    why = []
    if row.get("crash"):
        why.append("crash")
    if (row.get("verdict") or {}).get("void"):
        why.append("timers")
    if guard and (row.get("relayTally") or {}).get("late"):
        why.append("guard")
    busy = row.get("busy") or []
    if len(busy) > 1 and max(busy[:2]) > 0.95:
        why.append("busy")
    load = row.get("load") or {}
    if pilot_median and load.get("fillMs", 0) > 3 * pilot_median:
        why.append("pilot 3x")
    frames = [(f["decodedAt"], f["decodeMs"]) for f in load.get("frames") or [] if f.get("decodedAt") and f.get("decodeMs") is not None]
    if most_at_once(frames) > 2:
        why.append("decoders")
    exact = (row.get("exactFill") or {}).get("frames")
    if isinstance(exact, list) and most_at_once([(f["at"], f["decodeMs"]) for f in exact]) > 2:
        why.append("exact decoders")
    return why


def measured(row, kind):
    if kind == "fill":
        return row["load"]["fillMs"]
    if kind == "latency":
        return latency(row.get("records") or [])
    return row["exactFill"]["spanMs"]


def main(root, guard, span_fill_band):
    predictions = json.load(open(f"{root}/predictions.json"))["predictions"]
    totals = {}
    for cell in CELLS:
        rows = [json.loads(line) for line in open(f"{root}/rows/{cell}.jsonl")]
        pilot = json.load(open(f"{root}/rows/{cell}-pilot.pilot-medians.json"))
        reasons = collections.Counter()
        for r in rows:
            r["why"] = void_reasons(r, pilot.get(f"{cell}/{r['volume']}/{r['arm']}"), guard)
            reasons.update(set(r["why"]))
            if guard and bool(r["why"]) != bool(r.get("void")):
                print(f"VOID DIFFERS from the row's own: {cell} round {r['round']} {r['volume']} {r['arm']}")
        live = [r for r in rows if not r["why"]]
        totals[cell] = (sum(bool(r["why"]) for r in rows), len(rows), dict(reasons))
        for p in (p for p in predictions if p["cell"] == cell):
            lo, hi = p["band"]
            if span_fill_band and p["kind"] == "span":
                lo, hi = (0.75, 1.33) if cell in ("LTE", "LOSS") else (0.85, 1.15)
            ok = [r for r in live if r["volume"] == p["volume"] and r["arm"] == p["arm"]]
            ratios = [m / p["ms"] for m in (measured(r, p["kind"]) for r in ok) if m is not None]
            median, in_band = statistics.median(ratios), sum(lo <= x <= hi for x in ratios)
            verdict = "holds" if lo <= median <= hi and in_band >= 8 else "cannot hold" if len(ratios) < 8 else "misses"
            side = "below" if median < lo else "above" if median > hi else "in"
            misses = ""
            if p["kind"] == "fill" and p["regime"] != "near":
                misses = sum(regime(r["load"], 1 if r["arm"] == "B" else 8) != p["regime"] for r in ok)
            print(cell, p["volume"], p["arm"], p["kind"], f"x{median:.3f}", f"{in_band}/{len(ratios)}", verdict, side,
                  f"regime misses {misses}" if misses != "" else "", sep="\t")
        for volume in VOLUMES:
            rounds = sorted({r["round"] for r in live if r["volume"] == volume})
            fill = lambda arm: [next((r["load"]["fillMs"] for r in live if r["volume"] == volume and r["round"] == k
                                      and r["arm"] == arm), None) for k in rounds]
            print("A/A input", f"{cell}/{volume}", json.dumps({"ref": fill("A"), "aa": fill("A'"), "arm": fill("A'")}), sep="\t")
    print("VOID", json.dumps(totals))


if __name__ == "__main__":
    main(sys.argv[1], "--no-guard" not in sys.argv, "--span-fill-band" in sys.argv)
