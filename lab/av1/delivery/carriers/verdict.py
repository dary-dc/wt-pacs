#!/usr/bin/env python3
"""Row CARRIERS' decision rule per role, volume and throttle (docs/av1/profile-carriers.md §4, *Decision rule*):
the time metrics through roles.decided, bytes as deterministic, an arm whose order effect passes 10 % not read.

usage: verdict.py WORK ROWS.jsonl
  strict: a metric is not read if any arm it uses (the two compared, htj2k, htj2k-aa) is not read;
  compared only: if either compared arm is not read — printed beside it, not the verdict.
"""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from roles import (GROUP, PAIRS, RATES, ask_bytes, ask_ms, at_psnr, decided, load_rows, lower,  # noqa: E402
                   order_effect, per_round, pipeline, verdict, view_ms)

LAY, K1 = "three-full-m20", "three-full-m20-k1"
REF = ("htj2k", "htj2k-aa")
ORDER_LIMIT = 0.10


def not_read(rows, s, t):
    """The arms of one (volume, throttle) whose order effect passes the limit, as roles.py prints them."""
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if (r["set"], r["throttle"]) == (s, t):
            v = r["ms"] if "k" in r else sum(r["ms"])
            by[r["arm"]][r["prev"]].append(v)
    return {arm: e for arm, prevs in by.items() if (e := order_effect(prevs)) > ORDER_LIMIT}


def pairing(lay, sep):
    """Each middle m with the separate rung nearest its PSNR."""
    return [(m, min(sep, key=lambda q: abs(sep[q]["quality"]["psnr"] - lay[f"three-full-{m}"]["middle_quality"]["psnr"])))
            for m, _ in PAIRS]


def main():
    work, rows = Path(sys.argv[1]), load_rows(sys.argv[2])
    asks = per_round([r for r in rows if "k" in r], ask_ms)
    views = per_round([r for r in rows if "frames" in r], view_ms)
    rounds = sorted({r["round"] for r in rows})
    throttles = sorted({r["throttle"] for r in rows})
    print(f"rounds {len(rounds)}\n")
    for idx in sorted(work.glob("dbts_*.json")):
        e = json.loads(idx.read_text())
        s, lay, sep = e["name"], e["layered"], e["separate"]
        low = e["low_bytes"] if e["shift"] else None
        tops = {n: [a - b for a, b in zip(c["bytes"]["top"], c["bytes"]["middle"])] for n, c in lay.items()}
        asked = range(e["group"], e["group"] + GROUP)
        ask_b = {"svc": statistics.mean(ask_bytes(tops[LAY], low, GROUP, k) for k in asked),
                 "svc1": statistics.mean(ask_bytes(tops[K1], low, 1, k) for k in asked),
                 "res": statistics.mean(sep["q16"]["residual_units"][k] for k in asked),
                 "htj2k": statistics.mean(e["htj2k_bytes"][k] for k in asked)}
        pairs = pairing(lay, sep)
        print(f"## {s}\n\npairing by nearest PSNR: {pairs}\n")
        qs = [(c["quality"]["psnr"], sum(c["units"])) for c in sep.values()]
        for t in throttles:
            gone = not_read(rows, s, t)
            ref = [asks.get((s, t, "htj2k"), {}).get(n) for n in rounds]
            aa = [asks.get((s, t, "htj2k-aa"), {}).get(n) for n in rounds]
            print(f"### {s}, {t}×\n\nnot read (order effect): "
                  + ", ".join(f"{a} {v:.0%}" for a, v in sorted(gone.items())) + "\n")
            print("| role | comparison | metric | strict | compared only |\n| --- | --- | --- | --- | --- |")
            by_role = defaultdict(lambda: ([], []))

            def put(role, comp, metric, strict, loose):
                print(f"| {role} | {comp} | {metric} | {strict} | {loose} |")
                by_role[(role, comp)][0].append(strict)
                by_role[(role, comp)][1].append(loose)

            def timed(role, comp, metric, la, sa, lv, sv):
                d, paired = decided(sv, lv, ref, aa)
                cell = f"{d} ({paired:.3g})" if paired is not None else d
                strict = "not read" if {la, sa, *REF} & gone.keys() else cell
                loose = "not read" if {la, sa} & gone.keys() else cell
                put(role, comp, metric, strict, loose)

            series = lambda c, arm: [c.get((s, t, arm), {}).get(n) for n in rounds]  # noqa: E731
            for la in ("svc", "svc1"):
                for sa in ("res", "htj2k"):
                    comp = f"{la} vs {sa}"
                    b = lower(ask_b[sa], ask_b[la])
                    put("exact ask", comp, f"bytes {ask_b[la]:.0f} · {ask_b[sa]:.0f}", b, b)
                    timed("exact ask", comp, "decode", la, sa, series(asks, la), series(asks, sa))
            view_pairs = [("cheap view", "base", "sep-q56", "q56", None), ("cheap view", "base", "wc-q56", "q56", None)]
            view_pairs += [("high view", f"mid-{m}", f"sep-{q}", q, m) for m, q in pairs]
            view_pairs += [("high view", "mid-m20", "wc-q16", "q16", "m20")]
            for role, la, sa, q, m in view_pairs:
                lb = lay[LAY]["bytes"]["base"] if m is None else lay[f"three-full-{m}"]["bytes"]["middle"]
                sb = sep[q]["units"]
                comp = f"{la} vs {sa}"
                if m is None:
                    b = lower(sum(sb), sum(lb))
                    put(role, comp, f"bytes {sum(lb)} · {sum(sb)}", b, b)
                else:
                    eq = at_psnr(qs, lay[f"three-full-{m}"]["middle_quality"]["psnr"])
                    b = lower(eq, sum(lb))
                    put(role, comp, f"bytes at equal PSNR {sum(lb)} · {eq:.0f}", b, b)
                lv, sv = series(views, la), series(views, sa)
                fm = lambda v: [None if x is None else statistics.median(x) for x in v]  # noqa: E731
                tot = lambda v: [None if x is None else sum(x) for x in v]  # noqa: E731
                timed(role, comp, "decode a frame", la, sa, fm(lv), fm(sv))
                timed(role, comp, "decode in total", la, sa, tot(lv), tot(sv))
                for mbps in RATES:
                    for name, at in (("first picture", 0), ("every slice", -1)):
                        f = lambda v, units: [None if x is None else pipeline(units, x, mbps)[at] for x in v]  # noqa: E731,B023
                        timed(role, comp, f"{name}, {mbps} Mbit/s", la, sa, f(lv, lb), f(sv, sb))
            print()
            for (role, comp), (strict, loose) in by_role.items():
                read = lambda ds: [d.split(" (")[0] for d in ds if d != "not read"]  # noqa: E731
                print(f"* **{role}, {comp}**: strict {verdict(read(strict))}; compared only {verdict(read(loose))}")
            print()


if __name__ == "__main__":
    main()
