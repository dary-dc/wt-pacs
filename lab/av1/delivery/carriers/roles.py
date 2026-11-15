#!/usr/bin/env python3
"""Row CARRIERS' reading (docs/av1/profile-carriers.md §4): per role and volume the bytes, storage and quality from
content.py's index, the times from ask.mjs's rows, each role's fill on a modelled link, and the decision rule.

usage: roles.py WORK ROWS.jsonl   — prints the tables; roles_test.py checks the arithmetic
"""
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from aa_rule import ALPHA, mw_greater_p  # noqa: E402

RATES = (5, 20, 50)
T0_MS = 40.0  # one round trip: the rig's 20 ms each way
GROUP = 8
PAIRS = (("m10", "q8"), ("m20", "q16"), ("m30", "q32"))


def pipeline(unit_bytes, decode_ms, mbps, t0=T0_MS):
    """Each frame shown at max(its last byte, the previous frame shown) + its decode, in ms."""
    t, sent, out = 0.0, 0, []
    for b, d in zip(unit_bytes, decode_ms):
        sent += b
        t = max(t0 + sent * 8 / (mbps * 1e3), t) + d
        out.append(t)
    return out


def at_psnr(points, psnr):
    """Bytes at a PSNR: log bytes linear in PSNR between the two rungs around it; None outside them."""
    pts = sorted(points)
    for (p0, b0), (p1, b1) in zip(pts, pts[1:]):
        if p0 <= psnr <= p1:
            f = 0.0 if p1 == p0 else (psnr - p0) / (p1 - p0)
            return math.exp(math.log(b0) + f * (math.log(b1) - math.log(b0)))
    return None


def ask_bytes(top, low, key, k):
    """The tops from k's keyframe to k, and k's low bits (none when low is None)."""
    return sum(top[k - k % key:k + 1]) + (low[k] if low is not None else 0)


def decided(sep, lay, ref, aa):
    """'separate', 'layered' (the lower time) or 'not resolved': aa_rule's test on the round-paired ratios over ref,
    and the paired median outside the A/A ratio's range. Lists are one value a round, None where missing."""
    rounds = [r for r in zip(sep, lay, ref, aa) if None not in r]
    if len(rounds) < 3:
        return "not resolved", None
    s = [a / c for a, _, c, _ in rounds]
    lo = [b / c for _, b, c, _ in rounds]
    a = [d / c for _, _, c, d in rounds]
    paired = statistics.median(x / y for x, y in zip(s, lo))
    outside = not (min(a) <= paired <= max(a))
    if outside and mw_greater_p(lo, s) < ALPHA:
        return "separate", paired
    if outside and mw_greater_p(s, lo) < ALPHA:
        return "layered", paired
    return "not resolved", paired


def lower(sep, lay):
    """A deterministic quantity: the carrier with less of it, or 'the same'."""
    return "separate" if sep < lay else "layered" if lay < sep else "the same"


def verdict(results):
    """Per role: 'better' for a carrier no metric decides against and one decides for; else a trade or the same."""
    won = {r for r in results if r in ("separate", "layered")}
    if not won:
        return "the same"
    return f"{won.pop()} better" if len(won) == 1 else "a trade"


def order_effect(values_by_prev):
    """The largest |median by predecessor ÷ median − 1| (RESIDAPART's statistic)."""
    allv = [v for vs in values_by_prev.values() for v in vs]
    if not allv:
        return 0.0
    m = statistics.median(allv)
    return max(abs(statistics.median(vs) / m - 1) for vs in values_by_prev.values() if vs)


def load_rows(path):
    rows = [json.loads(line) for line in Path(path).open()]
    return [r for r in rows if not r.get("mutate") and not r.get("void")]


def per_round(rows, key):
    """{(set, throttle, arm): {round: value}} with value = key(rows of that cell and round)."""
    cells = defaultdict(lambda: defaultdict(list))
    for r in rows:
        cells[(r["set"], r["throttle"], r["arm"])][r["round"]].append(r)
    return {c: {n: key(rs) for n, rs in by.items()} for c, by in cells.items()}


def ask_ms(rs):
    return statistics.mean(r["ms"] for r in rs) if all(r["exact"] for r in rs) else None


def view_ms(rs):
    return None if rs[0]["lossy"] < rs[0]["frames"] else rs[0]["ms"]


def series(cells, s, t, arm, rounds):
    return [cells.get((s, t, arm), {}).get(n) for n in rounds]


def fmt(v, unit=""):
    return "—" if v is None else f"{v:.3g}{unit}"


def main():
    work, rows = Path(sys.argv[1]), load_rows(sys.argv[2])
    asks, views = per_round([r for r in rows if "k" in r], ask_ms), per_round([r for r in rows if "frames" in r], view_ms)
    rounds = sorted({r["round"] for r in rows})
    throttles = sorted({r["throttle"] for r in rows})
    voids = sum(1 for line in Path(sys.argv[2]).open() if '"void"' in line)
    print(f"rounds {len(rounds)}; throttles {throttles}; VOID cells {voids}\n")
    for idx in sorted(work.glob("dbts_*.json")):
        e = json.loads(idx.read_text())
        s, H = e["name"], sum(e["htj2k_bytes"])
        lay = e["layered"]
        sep = e["separate"]
        low = e["low_bytes"] if e["shift"] else None
        tops = {n: [a - b for a, b in zip(c["bytes"]["top"], c["bytes"]["middle"])] for n, c in lay.items()}
        frame = statistics.mean(e["k2_bytes"])
        print(f"## {s}: {e['frames']} × {e['width']}×{e['height']}, {e['bits']}-bit; HTJ2K {H} B\n")
        print("| quantity | layered | separate | lower |\n| --- | --- | --- | --- |")
        cheap_l, cheap_s = sum(lay["three-full-m20"]["bytes"]["base"]), sum(sep["q56"]["units"])
        print(f"| cheap view bytes (base · Q 56) | {cheap_l} | {cheap_s} | {lower(cheap_s, cheap_l)} |")
        qs = [(c["quality"]["psnr"], sum(c["units"])) for c in sep.values()]
        for m, q in PAIRS:
            c = lay[f"three-full-{m}"]
            mid = sum(c["bytes"]["middle"])
            eq = at_psnr(qs, c["middle_quality"]["psnr"])
            print(f"| high view {m} bytes; separate at its PSNR {c['middle_quality']['psnr']:.2f} dB | {mid} | {fmt(eq)} |"
                  f" {'—' if eq is None else lower(eq, mid)} |")
        for name, key in (("three-full-m20", GROUP), ("three-full-m20-k1", 1)):
            b = [ask_bytes(tops[name], low, key, k) for k in range(e["group"], e["group"] + GROUP)]
            res = [e["separate"]["q16"]["residual_units"][k] for k in range(e["group"], e["group"] + GROUP)]
            print(f"| ask bytes, mean ÷ a shipped frame ({name} · residual) | {statistics.mean(b) / frame:.3f} |"
                  f" {statistics.mean(res) / frame:.3f} | {lower(statistics.mean(res), statistics.mean(b))} |")
        store_l = sum(lay["three-full-m20"]["bytes"]["top"]) + (sum(e["low_bytes"]) if e["shift"] else 0)
        streams = sum(sep["q16"]["units"]) + cheap_s
        store_r, store_w = streams + sum(sep["q16"]["residual_units"]), streams + H
        print(f"| storage ÷ HTJ2K (layered · by residual) | {store_l / H:.4f} | {store_r / H:.4f} | {lower(store_r, store_l)} |")
        print(f"| storage ÷ HTJ2K (layered · by whole frame) | {store_l / H:.4f} | {store_w / H:.4f} | {lower(store_w, store_l)} |\n")
        for t in throttles:
            ref, aa = series(asks, s, t, "htj2k", rounds), series(asks, s, t, "htj2k-aa", rounds)
            print(f"### {s}, {t}×\n\n| role · metric | layered | separate | median sep ÷ layered | decided |\n| --- | --- | --- | --- | --- |")
            out = defaultdict(list)

            def row(role, label, lay_v, sep_v):
                d, paired = decided(sep_v, lay_v, ref, aa)
                med = lambda v: statistics.median([x for x in v if x is not None]) if any(x is not None for x in v) else None  # noqa: E731
                print(f"| {role} · {label} | {fmt(med(lay_v), ' ms')} | {fmt(med(sep_v), ' ms')} | {fmt(paired)} | {d} |")
                out[role].append(d)

            for arm in ("res", "htj2k"):
                row("exact ask", f"svc vs {arm}", series(asks, s, t, "svc", rounds), series(asks, s, t, arm, rounds))
                row("exact ask", f"svc1 vs {arm}", series(asks, s, t, "svc1", rounds), series(asks, s, t, arm, rounds))
            pairs = [("cheap view", "base", "sep-q56", lay["three-full-m20"]["bytes"]["base"], sep["q56"]["units"])] + [
                ("high view", f"mid-{m}", f"sep-{q}", lay[f"three-full-{m}"]["bytes"]["middle"], sep[q]["units"]) for m, q in PAIRS]
            pairs += [("cheap view", "base", "wc-q56", pairs[0][3], pairs[0][4]),
                      ("high view", "mid-m20", "wc-q16", lay["three-full-m20"]["bytes"]["middle"], sep["q16"]["units"])]
            for role, la, sa, lb, sb in pairs:
                lv, sv = series(views, s, t, la, rounds), series(views, s, t, sa, rounds)
                frame_med = lambda v: [None if x is None else statistics.median(x) for x in v]  # noqa: E731
                total = lambda v: [None if x is None else sum(x) for x in v]  # noqa: E731
                row(role, f"{la} vs {sa}: decode a frame", frame_med(lv), frame_med(sv))
                row(role, f"{la} vs {sa}: decode in total", total(lv), total(sv))
                for mbps in RATES:
                    first = lambda v, b: [None if x is None else pipeline(b, x, mbps)[0] for x in v]  # noqa: E731
                    every = lambda v, b: [None if x is None else pipeline(b, x, mbps)[-1] for x in v]  # noqa: E731
                    row(role, f"{la} vs {sa}: first picture, {mbps} Mbit/s", first(lv, lb), first(sv, sb))
                    row(role, f"{la} vs {sa}: every slice, {mbps} Mbit/s", every(lv, lb), every(sv, sb))
            print()
            for role, ds in out.items():
                print(f"* **{role}**, times alone: {verdict(ds)}")
            for arm in sorted({r["arm"] for r in rows if r["set"] == s and r["throttle"] == t}):
                by = defaultdict(list)
                for r in rows:
                    if (r["set"], r["throttle"], r["arm"]) == (s, t, arm):
                        if (v := r["ms"] if "k" in r else sum(r["ms"])) is not None:
                            by[r["prev"]].append(v)
                if (effect := order_effect(by)) > 0.10:
                    print(f"* order effect {arm}: {effect:.1%}, not read")
            print()


if __name__ == "__main__":
    main()
