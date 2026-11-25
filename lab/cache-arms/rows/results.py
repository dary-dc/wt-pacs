#!/usr/bin/env python3
"""cache-plan.md §8.3-§8.5 applied to one engine's counted rows: python3 lab/cache-arms/rows/results.py chromium"""
import json
import statistics
import sys
from pathlib import Path

ROWS = Path(__file__).parent / sys.argv[1]
PILOT = json.loads((Path(__file__).parents[1] / f"pilot-{sys.argv[1]}.json").read_text())
DECODE_MS = {"512": 3.0, "2560": 47.0, "3328": 69.0}
PERIOD_MS = 16.7
F_MS = {"512": 7500.0, "3328": 31000.0}
FRAME = {"512": 512 * 512 * 2, "2560": 2560 * 3328 * 2, "3328": 3328 * 4096 * 2}
ARMS = ["opfs-sync", "opfs-async", "idb", "cachestorage"]
MiB = 2**20


def load(name):
    p = ROWS / f"{name}.jsonl"
    if not p.exists():
        return None
    rows = [json.loads(line) for line in p.open()]
    return [r for r in rows if "unit" in r]


def inflight(arm):
    for kv in PILOT.get(arm.removesuffix("-aa"), "").split("&"):
        if kv.startswith("inflight="):
            return int(kv.split("=")[1])
    return 1


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def at_least(met, share=0.75):
    return bool(met) and sum(met) / len(met) >= share


def fmt(rounds):
    return f"{sum(rounds)}/{len(rounds)}"


def exact(r):
    v = r.get("verify")
    return bool(v) and v["notOk"] == 0 and v["ok"] > 0


def l_rounds(rows, size, unit):
    ref = {r["round"]: r for r in rows if r["unit"] == "none" and not r.get("error")}
    out = []
    for r in (r for r in rows if r["unit"] == unit and r["round"] in ref):
        n = ref[r["round"]]
        if r.get("error"):
            out.append(dict.fromkeys(["missed", "delayP99", "delivered", "backlog", "pss", "exact"], False))
            continue
        out.append({
            "missed": r["shown"]["missedShare"] <= n["shown"]["missedShare"] + 0.01,
            "delayP99": r["shown"]["paintDelayP99"] <= n["shown"]["paintDelayP99"] + 4,
            "delivered": r["deliveredMBps"] >= 0.95 * n["deliveredMBps"],
            "backlog": r["unwrittenAt5s"] == 0,
            "pss": r["pssGrowthMiB"] <= n["pssGrowthMiB"] + inflight(unit) * FRAME[size] / MiB + 64,
            "exact": exact(r),
        })
    return out


def l_verdict(rounds):
    if not rounds:
        return "unjudged", ""
    keys = rounds[0].keys()
    failed = [k for k in keys if not (all(m[k] for m in rounds) if k == "exact" else at_least([m[k] for m in rounds]))]
    detail = ", ".join(f"{k} {fmt([m[k] for m in rounds])}" for k in failed)
    return ("pass" if not failed else "fail"), detail


def miss_ms(r):
    return [m["ms"] for m in r.get("misses") or []]


def r_verdict(rows, size, unit):
    bar = DECODE_MS[size] + PERIOD_MS
    mine = [r for r in rows if r["unit"] == unit]
    met, p50s = [], []
    for r in mine:
        ms = miss_ms(r)
        ok = not r.get("error") and bool(ms) and exact(r)
        if ok:
            p50s.append(statistics.median(ms))
        met.append(ok and statistics.median(ms) <= bar and pct(ms, 0.99) <= 2 * bar)
    med = f"p50 {statistics.median(p50s):.1f} ms" if p50s else "no misses"
    return ("pass" if at_least(met) else "fail"), f"{med}, {fmt(met)} rounds within (bar {bar:.1f} / {2 * bar:.1f})"


def aa(rows, metric, kind):
    a = {r["round"]: r for r in rows if r["unit"] == "opfs-sync" and not r.get("error")}
    b = {r["round"]: r for r in rows if r["unit"] == "opfs-sync-aa" and not r.get("error")}
    pairs = [(a[k], b[k]) for k in a if k in b]
    if not pairs:
        return None
    if kind == "L":
        dm = statistics.median(abs(x["shown"]["missedShare"] - y["shown"]["missedShare"]) for x, y in pairs)
        dp = statistics.median(abs(x["shown"]["paintDelayP99"] - y["shown"]["paintDelayP99"]) for x, y in pairs)
        return ("VOID" if dm > 0.01 or dp > 4 else "ok"), f"A/A median |Δmissed| {dm * 100:.2f} %, |Δp99| {dp:.1f} ms"
    ratio = statistics.median(metric(x) / metric(y) for x, y in pairs if metric(y))
    return ("VOID" if not 0.90 <= ratio <= 1.10 else "ok"), f"A/A median ratio {ratio:.3f}"


def saturated():
    out = {}
    for name in ["L-512-1x", "L-2560-1x", "L-3328-1x", "L-512-4x", "L-2560-4x-none", "L-3328-4x-none"]:
        rows = load(name)
        if rows:
            share = statistics.median(r["shown"]["missedShare"] for r in rows if r["unit"] == "none" and not r.get("error"))
            out[name] = share
    return out


def every(rows, unit, ok):
    mine = [r for r in rows if r["unit"] == unit]
    met = [bool(not r.get("error") and ok(r)) for r in mine]
    errs = sorted({str(r["error"])[:60] for r in mine if r.get("error")})
    return ("pass" if met and all(met) else "fail"), fmt(met) + (f"; errors: {'; '.join(errs)}" if errs else "")


def main():
    lines = [f"Engine {sys.argv[1]}; arms' pilots {json.dumps(PILOT)}", ""]
    sat = saturated()
    lines.append("none's median missed share in L: " + ", ".join(f"{k} {v * 100:.1f} %" for k, v in sat.items()))
    lines += ["", "| cell | A/A | " + " | ".join(ARMS) + " |", "| --- | --- |" + " --- |" * len(ARMS)]

    def row(cell, aa_text, verdicts):
        lines.append(f"| {cell} | {aa_text} | " + " | ".join(f"{v[0]}: {v[1]}" if v[1] else v[0] for v in verdicts) + " |")

    for name, size in [("L-2560-1x", "2560"), ("L-512-1x", "512"), ("L-3328-1x", "3328"), ("L-512-4x", "512")]:
        rows = load(name)
        if rows:
            a = aa(rows, None, "L")
            row(name, f"{a[0]}, {a[1]}", [l_verdict(l_rounds(rows, size, u)) for u in ARMS])
    for name in ["W-2560-1x", "W-512-1x", "W-3328-1x"]:
        rows = load(name)
        if rows:
            a = aa(rows, lambda r: r["store"]["writeMBps"], "W")
            vs = []
            for u in ARMS:
                mine = [r for r in rows if r["unit"] == u]
                met = [not r.get("error") and exact(r) and r["store"]["writeMBps"] >= 125 for r in mine]
                rate = statistics.median(r["store"]["writeMBps"] for r in mine if not r.get("error"))
                vs.append(("pass" if at_least(met) else "fail", f"{rate:.0f} MB/s, {fmt(met)}"))
            row(name, f"{a[0]}, {a[1]}", vs)
    for name, size in [("R-idle-2560-1x", "2560"), ("R-idle-512-1x", "512"), ("R-idle-3328-1x", "3328"),
                       ("R-idle-512-4x", "512"), ("R-busy-2560-1x", "2560"), ("R-busy-3328-1x", "3328")]:
        rows = load(name)
        if rows:
            a = aa(rows, lambda r: statistics.median(miss_ms(r)) if miss_ms(r) else 0, "R")
            row(name, f"{a[0]}, {a[1]}" if a else "—", [r_verdict(rows, size, u) for u in ARMS])
    rows = load("B-2560-1x")
    if rows:
        a = aa(rows, None, "L")
        vs = []
        for u in ARMS:
            lv, rv = l_verdict(l_rounds(rows, "2560", u)), r_verdict(rows, "2560", u)
            vs.append(("pass" if lv[0] == rv[0] == "pass" else "fail", f"L {lv[0]} {lv[1]}; R {rv[1]}".strip()))
        row("B-2560-1x", f"{a[0]}, {a[1]}", vs)
    for name, size, n in [("O-3328-1x", "3328", 32), ("O-512-1x", "512", 256)]:
        rows = load(name)
        if rows:
            a = aa(rows, lambda r: r["warm"]["read"]["fromStartMs"], "O")
            vs = []
            for u in ARMS:
                mine = [r for r in rows if r["unit"] == u]

                def ok(r, k):
                    t = r[k]["read"]["fromStartMs"]
                    return t <= 0.5 * F_MS[size] and t / n <= DECODE_MS[size] and r[k]["verify"]["notOk"] == 0
                warm = [not r.get("error") and ok(r, "warm") for r in mine]
                cold = [not r.get("error") and ok(r, "cold") for r in mine]
                tw = statistics.median(r["warm"]["read"]["fromStartMs"] for r in mine if not r.get("error"))
                tc = statistics.median(r["cold"]["read"]["fromStartMs"] for r in mine if not r.get("error"))
                vs.append(("pass" if all(warm) and all(cold) else "fail", f"warm {tw:.0f} ms {fmt(warm)}, cold {tc:.0f} ms {fmt(cold)}"))
            row(name, f"{a[0]}, {a[1]}", vs)
    state = {
        "E-3328-1x": lambda r: r["checks"].get("sets") and r["checks"].get("exact"),
        "K-3328-1x": lambda r: all(v for k, v in r["checks"].items()),
        "Q-2560-1x": lambda r: all(v for k, v in r["checks"].items()),
        "T-2560-1x": lambda r: all(r["checks"]["tab1"].values()) and r["checks"]["tab2"]["exact"]
        and r["checks"]["tab2"]["readerWroteNothing"],
        "P-2560-1x": lambda r: r["checks"].get("exact"),
    }
    for name, ok in state.items():
        rows = load(name)
        if rows:
            vs = [every(rows, u, ok) for u in ARMS]
            row(name, "—", [("exact" if v[0] == "pass" else "not exact", v[1]) for v in vs] if name.startswith("P") else vs)
    print("\n".join(lines))


main()
