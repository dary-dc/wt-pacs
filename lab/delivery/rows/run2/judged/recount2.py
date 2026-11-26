#!/usr/bin/env python3
"""DELIVERY-VERDICT-2's recount of DELIVERY-RUN-2, written apart from judge.mjs: VOID from each row's raw fields,
every (cell, volume, arm, clock)'s ratios, holds (10 of 12, A2.8) and regime misses, the pilot rule, the rows'
digest, and the ratios between arms. A reading aid, not a reviewed tool.

    python3 lab/delivery/rows/run2/judged/recount2.py lab/delivery [--no-guard]
"""
import collections
import json
import statistics
import sys

CELLS = ["CLEAN", "PUB", "LTE", "LOSS", "CR"]
VOLUMES = ["dbts_a1", "dbts_b1", "dbts_c1"]
HOLD = 10


def most_at_once(spans):
    edges = sorted([(at - ms, 1) for at, ms in spans] + [(at, -1) for at, ms in spans])
    now = most = 0
    for _, step in edges:
        now += step
        most = max(most, now)
    return most


def record(row, kind):
    return next((r for r in row.get("records") or [] if r["kind"] == kind), None)


def press_to_painted(row):
    records = row.get("records") or []
    press = next((r for r in records if r["kind"] == "lossless"), None)
    painted = press and next((r for r in records if r["kind"] == "label" and r.get("quality") == "lossless"
                              and r["at"] >= press["at"]), None)
    return painted["at"] - press["at"] if painted else None


def measured(row, kind):
    if kind == "fill":
        return (row.get("load") or {}).get("fillMs")
    if kind == "latency":
        return press_to_painted(row)
    if kind == "askLastByte":
        r = record(row, "askLastByte")
        return r and r["ms"]
    if kind == "zoom":
        r = record(row, "zoom")
        return r and r["ms"]
    raise ValueError(kind)


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


def cores(listing):
    out = set()
    for part in listing.split(","):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return out


def void_reasons(row, pilot_median, guard):
    why = []
    if row.get("crash"):
        why.append("crash")
    if (row.get("verdict") or {}).get("void"):
        why.append("timers")
    if guard and (row.get("relayTally") or {}).get("late"):
        why.append("guard")
    busy = row.get("busy") or []
    if any(b > 0.95 for b in busy[:2]):
        why.append("busy")
    load = row.get("load") or {}
    if pilot_median and (load.get("fillMs") or 0) > 3 * pilot_median:
        why.append("pilot 3x")
    if any(not cores(p["allowed"]) <= {2, 3} for p in row.get("cpus") or []):
        why.append("escaped")
    spans = [(f["decodedAt"], f["decodeMs"]) for f in load.get("frames") or [] if f.get("decodedAt") and f.get("decodeMs") is not None]
    if most_at_once(spans) > 2:
        why.append("decoders")
    return why


def curve_wire(size, form, curve):
    points = [[0, 3 * form["rttMs"] + 20]] + curve
    k = next((j for j, (b, _) in enumerate(points) if size <= b), len(points) - 1)
    (b0, t0), (b1, t1) = points[max(1, k) - 1], points[max(1, k)]
    return t0 + (size - b0) * (t1 - t0) / (b1 - b0)


def main(root, guard):
    text = open(f"{root}/predictions.json", "rb").read()
    predictions = json.loads(text)["predictions"]
    counts = collections.Counter()
    medians = {}
    for cell in CELLS:
        rows = [json.loads(line) for line in open(f"{root}/rows/run2/{cell}.jsonl")]
        pilot = json.load(open(f"{root}/rows/run2/{cell}-pilot.pilot-medians.json"))
        reasons = collections.Counter()
        digests = collections.Counter(r.get("predictionsXxh3") for r in rows)
        stops = [r for r in rows if not r.get("crash") and r.get("verdict") and not r["verdict"].get("ok") and not r["verdict"].get("void")]
        for r in rows:
            r["why"] = void_reasons(r, pilot.get(f"{cell}/{r['volume']}/{r['arm']}"), guard)
            reasons.update(set(r["why"]))
            if guard and bool(r["why"]) != bool(r.get("void")):
                print(f"VOID DIFFERS from the row's own: {cell} round {r['round']} {r['volume']} {r['arm']} {r['why']} {r.get('void')}")
        live = [r for r in rows if not r["why"]]
        view_void = sum(bool(r["why"]) and "guard" in r["why"] and r["arm"] in ("A", "A'", "C1", "SPLIT") for r in rows)
        print(f"# {cell}: {len(rows)} loads, VOID {sum(bool(r['why']) for r in rows)} {dict(reasons)}, guard on view arms {view_void}, "
              f"digests {dict(digests)}, stops {len(stops)}, rounds {len({r['round'] for r in rows})}")
        for p in (p for p in predictions if p["cell"] == cell):
            lo, hi = p["band"]
            ok = [r for r in live if r["volume"] == p["volume"] and r["arm"] == p["arm"]]
            values = [(r, measured(r, p["kind"])) for r in ok]
            ratios = [m / p["ms"] for _, m in values if m is not None]
            median = statistics.median(ratios)
            medians[(cell, p["volume"], p["arm"], p["kind"])] = statistics.median([m for _, m in values if m is not None])
            in_band = sum(lo <= x <= hi for x in ratios)
            side = "below" if median < lo else "above" if median > hi else "in"
            if p.get("judged") is False:
                verdict = "reported"
            elif len(ratios) < HOLD:
                verdict = "cannot hold"
            else:
                verdict = "holds" if side == "in" and in_band >= HOLD else "misses"
            misses = ""
            if p["kind"] == "fill" and p.get("regime") not in (None, "near"):
                misses = sum(regime(r["load"], 1 if r["arm"] in ("B", "FIT") else 8) != p["regime"] for r in ok)
                if misses > 2:
                    verdict += ", regime miss"
            counts[verdict.split(",")[0] + ("" if verdict.split(",")[0] != "misses" else " " + side)] += 1
            counts["regime miss"] += verdict.endswith("regime miss")
            print(cell, p["volume"], p["arm"], p["kind"], f"pred {p['ms']:.0f}", f"x{median:.3f}", f"{in_band}/{len(ratios)}",
                  verdict, side, f"regime misses {misses}" if misses != "" else "", sep="\t")
    print("COUNTS", dict(counts))
    inputs = json.loads(text)["inputs"]
    for cell, n in (("LTE", 16), ("LOSS", 8)):
        form = inputs["forms"][cell]
        rows = [r for r in map(json.loads, open(f"{root}/rows/run2/{cell}.jsonl")) if not r.get("void")]
        for v in VOLUMES:
            for arm in ("A", "A'", "C1", "SPLIT", "B"):
                frames = inputs["volumes"][v]["exact" if arm == "B" else "view"]["frames"][:n]
                ok = [r["load"] for r in rows if r["volume"] == v and r["arm"] == arm]
                wire = statistics.median(max(f["lastByte"] for f in load["frames"]) - load["fillFrom"] for load in ok)
                per_frame = statistics.median(statistics.median(f["decodeMs"] for f in load["frames"]) for load in ok)
                predicted = curve_wire(sum(frames), form, form["curves"][v])
                print("WIRE", cell, v, arm, f"{sum(frames) / 1e6:.2f} MB", f"curve {predicted:.0f} ms", f"measured {wire:.0f} ms",
                      f"x{wire / predicted:.2f}", f"decode a frame {per_frame:.0f} ms", sep="\t")
    for cell in CELLS:
        for v in VOLUMES:
            a = medians[(cell, v, "A", "fill")]
            print("RATIO", cell, v, *(f"{arm}/A x{medians[(cell, v, arm, 'fill')] / a:.2f}" for arm in ("B", "FIT", "SPLIT", "C1")),
                  f"A {a / 1000:.2f} s", f"B {medians[(cell, v, 'B', 'fill')] / 1000:.2f} s", f"FIT {medians[(cell, v, 'FIT', 'fill')] / 1000:.2f} s", sep="\t")


if __name__ == "__main__":
    main(sys.argv[1], "--no-guard" not in sys.argv)
