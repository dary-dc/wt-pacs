#!/usr/bin/env python3
"""Row CCATTRIB: R1's predictions and rule over run.mjs's rows and the server's controller traces.

Arms: htj2k (cubic-restart, 12 000 B), cr240k (cubic-restart, 240 000 B), bbr (240 000 B), bbr12k (bbr, 12 000 B).
A fill is a visit's decodedMs; a ratio is an arm's over htj2k's in the same round and cell, its median over rounds.
Strict pairs neither visit VOID; round-paired keeps every visit. The trace's terms, fixed before the data:
  rate     the most the path delivered in any 100 ms of the visit (bytes acknowledged ÷ time);
  needed   rate × the row's srtt;
  the fill the trace from its first row until the bytes acknowledged reach the four filled frames' bytes.

  ccattrib.py ROWS.jsonl FRAMES_DIR       — lab/av1/delivery/total-time/README.md §Row CCATTRIB
"""
import json
import statistics
import sys
from pathlib import Path

WINDOW_US = 100_000


def load(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def rate(trace):
    """Bytes per µs: the best 100 ms of acknowledgements."""
    best, j = 0.0, 0
    for i, r in enumerate(trace):
        while trace[j]["t_us"] < r["t_us"] - WINDOW_US:
            j += 1
        k = max(j - 1, 0)
        dt = r["t_us"] - trace[k]["t_us"]
        if dt >= WINDOW_US:
            best = max(best, (r["delivered"] - trace[k]["delivered"]) / dt)
    return best


def spans(trace, end_us):
    """Each row with the time until the next one, cut at end_us."""
    for a, b in zip(trace, trace[1:]):
        if a["t_us"] >= end_us:
            return
        yield a, min(b["t_us"], end_us) - a["t_us"]


def fill_end(trace, fill_bytes):
    return next((r["t_us"] for r in trace if r["delivered"] >= fill_bytes), trace[-1]["t_us"])


def probe_rtt(trace, bw):
    """P2 on one visit: a ProbeRtt starting inside the first second, and the longest run of rows in one
    that starts there with the window ≤ 0.8 × needed, in ms."""
    early, longest, run = False, 0, 0
    prev = None
    for a, dt in spans(trace, trace[-1]["t_us"]):
        if a["mode"] == "ProbeRtt" and prev != "ProbeRtt":
            early = a["t_us"] < 1_000_000
            run = 0
        if a["mode"] == "ProbeRtt" and early and a["window"] <= 0.8 * bw * a["srtt_us"]:
            run += dt
            longest = max(longest, run)
        else:
            run = 0
        prev = a["mode"]
    return any(r["mode"] == "ProbeRtt" and r["t_us"] < 1_000_000 for r in trace), longest / 1000


def short_share(trace, bw, end_us):
    """P3: the share of the fill with the window ≤ needed."""
    total = short = 0
    for a, dt in spans(trace, end_us):
        total += dt
        short += dt * (a["window"] <= bw * a["srtt_us"])
    return short / total if total else 0.0


def probe_cost(trace, bw, end_us):
    """The fill's time a ProbeRtt's window leaves the path idle, as a share of the fill: Σ (1 − window ÷ needed)⁺ dt."""
    total = idle = 0
    for a, dt in spans(trace, end_us):
        total += dt
        if a["mode"] == "ProbeRtt":
            idle += dt * max(0.0, 1 - a["window"] / (bw * a["srtt_us"] or 1))
    return idle / total if total else 0.0


def main():
    rows = [r for r in load(sys.argv[1]) if r.get("frames")]
    frames = Path(sys.argv[2])
    fill_bytes = sum((frames / f"{i:03d}.htj2k").stat().st_size for i in range(4))
    cells = sorted({(r["link"], r["impairment"], r["throttle"]) for r in rows}, key=lambda c: (c[0][1:].zfill(6), c[1], c[2]))
    med = statistics.median
    for r in rows:
        trace = load(r["ccTrace"]) if r.get("ccTrace") and Path(r["ccTrace"]).exists() else []
        r["trace"] = [t for t in trace if t["conn"] == 0]

    def ratios(arm, cell, strict, key="decodedMs"):
        of = lambda a: {r["round"]: r for r in rows if (r["link"], r["impairment"], r["throttle"]) == cell and r["variant"] == a}
        ref, got = of("htj2k"), of(arm)
        return [got[k][key] / ref[k][key] for k in got.keys() & ref.keys() if not strict or not (got[k]["void"] or ref[k]["void"])]

    out = {"cells": {}, "fill_bytes": fill_bytes}
    print(f"fill {fill_bytes} B; fill ÷ htj2k's (cubic-restart, 12 000 B), median of rounds paired: strict | round-paired (n)")
    for cell in cells:
        name = " ".join(map(str, cell[:2])) + f" {cell[2]}x"
        line, c = [], {}
        for arm in ("cr240k", "bbr", "bbr12k"):
            s, p = ratios(arm, cell, True), ratios(arm, cell, False)
            c[arm] = {"strict": med(s) if s else None, "n_strict": len(s), "paired": med(p) if p else None, "n_paired": len(p),
                      "received_strict": med(ratios(arm, cell, True, "receivedMs")) if s else None}
            line.append(f"{arm} {c[arm]['strict'] or float('nan'):.3f} ({len(s)}) | {c[arm]['paired'] or float('nan'):.3f} ({len(p)})")
        asks = {a: [ms for r in rows if (r["link"], r["impairment"], r["throttle"]) == cell and r["variant"] == a and not r["void"] for ms in r["afterMs"]]
                for a in ("htj2k", "cr240k", "bbr", "bbr12k")}
        c["ask_p50"] = {a: med(v) for a, v in asks.items() if v}
        out["cells"][name] = c
        print(f"{name}: " + " · ".join(line) + " · ask p50 " + " ".join(f"{a} {v:.0f}" for a, v in c["ask_p50"].items()))

    def p2(arm):
        visits = [r for r in rows if r["variant"] == arm and r["trace"]]
        res = [probe_rtt(r["trace"], rate(r["trace"])) for r in visits]
        return len(visits), sum(e for e, _ in res), sum(ms >= 150 for _, ms in res), sorted(ms for _, ms in res)

    print("\nP2 — visits; ProbeRtt begun inside the first second; and with the window ≤ 0.8 × needed for ≥ 150 ms in it; that run's ms (min, median, max)")
    for arm in ("bbr", "bbr12k"):
        n, early, long, ms = p2(arm)
        out[f"p2_{arm}"] = {"visits": n, "early": early, "long": long}
        if n:
            print(f"  {arm}: {n}; {early}; {long}; {ms[0]:.0f} {med(ms):.0f} {ms[-1]:.0f}")

    j20 = [r for r in rows if r["variant"] == "bbr" and r["link"] == "r50000" and r["impairment"] == "j20" and r["trace"]]
    print("\nP3 — r50000 j20, bbr: the fill's share with the window ≤ needed, median [min–max] per throttle")
    out["p3"] = {}
    for th in sorted({r["throttle"] for r in j20}):
        sh = sorted(short_share(r["trace"], rate(r["trace"]), fill_end(r["trace"], fill_bytes)) for r in j20 if r["throttle"] == th)
        out["p3"][th] = med(sh)
        print(f"  {th}x: {med(sh):.2f} [{sh[0]:.2f}–{sh[-1]:.2f}] n={len(sh)}")

    print("\nThe r5000 cost — bbr ÷ htj2k − 1; bbr12k ÷ htj2k − 1 (the window swapped); ProbeRtt's idle share of bbr12k's fill")
    out["r5000"] = {}
    for th in (1, 4):
        cell = ("r5000", "clean", th)
        nm = f"r5000 clean {th}x"
        if nm not in out["cells"]:
            continue
        idle = [probe_cost(r["trace"], rate(r["trace"]), fill_end(r["trace"], fill_bytes)) for r in rows
                if (r["link"], r["impairment"], r["throttle"]) == cell and r["variant"] == "bbr12k" and r["trace"]]
        res = {}
        for reading in ("strict", "paired"):
            b, b12 = out["cells"][nm]["bbr"][reading], out["cells"][nm]["bbr12k"][reading]
            res[reading] = {"cost": b - 1, "after_window": b12 - 1, "probe_idle": med(idle), "left": b12 - 1 - med(idle)}
            print(f"  {th}x {reading}: {b - 1:+.3f}; {b12 - 1:+.3f}; {med(idle):.3f}; left {b12 - 1 - med(idle):+.3f}")
        out["r5000"][th] = res

    print("\nPredictions and rule, each reading")
    for reading in ("strict", "paired"):
        p1 = all(out["cells"][f"{l} clean {th}x"]["bbr12k"][reading] >= 0.97 and out["cells"][f"{l} clean {th}x"]["cr240k"][reading] <= 0.95
                 for l in ("r20000", "r50000") for th in (1, 4) if f"{l} clean {th}x" in out["cells"])
        b = out.get("p2_bbr", {})
        p2_holds = bool(b.get("visits")) and b["early"] >= 0.9 * b["visits"] and b["long"] >= 0.9 * b["visits"]
        p3 = bool(out["p3"]) and all(v >= 0.30 for v in out["p3"].values())
        left = max((v[reading]["left"] for v in out["r5000"].values()), default=None)
        option3 = p1 and p2_holds and left is not None and left <= 0.01
        print(f"  {reading}: P1 {'holds' if p1 else 'fails'}, P2 {'holds' if p2_holds else 'fails'}, P3 {'holds' if p3 else 'fails'};"
              f" restate clean cells: {'yes' if p1 else 'no'}; option 3: {'proposed' if option3 else 'dropped'} (r5000 left {left:+.3f})")


if __name__ == "__main__":
    main()
