#!/usr/bin/env python3
"""REPORT-RERUNS: each cell of page-runs.md §2 read against its pre-registered rule.
python3 read.py <rows dir> [cells.log] [cpu.log]"""
import json, math, statistics as st, sys
from collections import defaultdict
from pathlib import Path

R = Path(sys.argv[1])


def rows(name):
    f = R / f"r3-{name}.jsonl"
    if not f.exists():
        return None, None
    out, line = [], None
    for l in f.read_text().splitlines():
        o = json.loads(l)
        if "cell" in o:
            line = o
        elif "unit" in o:
            out.append(o)
    return out, line


def q(xs, p):
    s = sorted(xs)
    return s[max(0, math.ceil(p * len(s)) - 1)] if s else None


def iqr(xs):
    return q(xs, 0.25), q(xs, 0.75)


def d5a_busy(name="chromium-D5a-busy"):
    rs, line = rows(name)
    if rs is None:
        return
    print(f"## {name}: {len(rs)} rows, complete={line is not None}")
    by = defaultdict(list)
    for r in rs:
        by[r["unit"]].append(r)
    for u, xs in by.items():
        valid = [r for r in xs if r["reached"] == "mismatch" and r.get("kill")]
        delivered = sum(1 for r in valid if r["safety"] >= 1)
        expected = len(valid) - sum(0.5 * (1 - min(r["kill"]["atKill"], 50) / 50) for r in valid)
        drawn = len(valid) - sum(0.5 * (1 - r["killDelay"]["ms"] / 50) for r in valid)
        late = sum(1 for r in valid if r["kill"]["late"])
        learned = [r["kill"]["learned"] for r in valid]
        at_kill = [r["kill"]["atKill"] for r in valid]
        fill = sum(1 for r in xs if r["fill"])
        spread = (line or {}).get("spread", {}).get(u)
        print(f"  {u:12} valid {len(valid):2}/{len(xs)} safety {delivered:2} fill {fill:2} | page-thread model "
              f"expected {expected:5.2f} band {expected - 3.5:5.2f}-{expected + 3.5:5.2f} (drawn {drawn:5.2f}) | late {late} learned p50 "
              f"{q(learned, .5):.1f} max {max(learned):.1f} atKill p50 {q(at_kill, .5):.1f} | spread "
              f"{spread and round(spread['span'], 1)} void={spread and spread['void']} errors "
              f"{sum(1 for r in xs if r['error'])}")


def lbusy(name="chromium-Lbusy"):
    rs, line = rows(name)
    if rs is None:
        return
    print(f"## {name}: {len(rs)} rows, complete={line is not None}")
    by = defaultdict(list)
    for r in rs:
        by[r["unit"]].append(r)
    for u, xs in by.items():
        later = [x for r in xs if r.get("latency") for x in r["latency"]["later"] if x is not None]
        lost = sum(1 for r in xs if r.get("latency") for x in r["latency"]["later"] if x is None)
        per_load = [r["latency"]["p99"] for r in xs if r.get("latency") and r["latency"]["p99"] is not None]
        print(f"  {u:12} loads {len(xs)} later {len(later)} lost {lost} pooled p50 {q(later, .5):.2f} p99 "
              f"{q(later, .99):.2f} | per-load p99 median {q(per_load, .5):.2f} | errors {sum(1 for r in xs if r['error'])}")
    bh = [r for r in by.get("beacon:H", []) if r.get("floor") and r["floor"]["appendMs"] is not None]
    even = [r["floor"]["appendMs"] for r in bh if r["round"] % 2 == 0]
    odd = [r["floor"]["appendMs"] for r in bh if r["round"] % 2 == 1]
    if even and odd:
        ratio = st.median(even) / st.median(odd)
        print(f"  A/A: BEACON-H floor median even {st.median(even):.3f} ms, odd {st.median(odd):.3f} ms, ratio "
              f"{ratio:.3f} -> {'pass' if 0.95 <= ratio <= 1.05 else 'VOID'} (0.95-1.05)")


def cost(name="chromium-C"):
    rs, line = rows(name)
    if rs is None:
        return
    print(f"## {name}: {len(rs)} rows, complete={line is not None}")
    off = {r["round"]: r["fillMs"] for r in rs if r["unit"] == "off" and r.get("fillMs")}
    by = defaultdict(list)
    long_tasks = defaultdict(int)
    for r in rs:
        if r.get("fillMs") and r["round"] in off:
            by[r["unit"]].append(r["fillMs"] / off[r["round"]])
        for t in (r.get("cost") or {}).get("longTasks") or []:
            if (t.get("duration") if isinstance(t, dict) else t) >= 50:
                long_tasks[r["unit"]] += 1
    lo, hi = iqr(by.get("off'", [1]))
    aa = st.median(by["off'"]) if by.get("off'") else None
    print(f"  A/A off'/off median {aa:.3f} -> {'pass' if aa and 0.95 <= aa <= 1.05 else 'VOID'}; off' IQR band "
          f"{lo:.3f}-{hi:.3f}")
    for u, xs in by.items():
        m = st.median(xs)
        print(f"  {u:24} n {len(xs):2} median ratio {m:.3f} IQR {iqr(xs)[0]:.3f}-{iqr(xs)[1]:.3f} inside off' band "
              f"{lo <= m <= hi} long tasks >=50 ms {long_tasks[u]}")


def firefox(e):
    rs, line = rows(f"firefox-{e}")
    if rs is None:
        return
    print(f"## firefox-{e}: {len(rs)} rows, complete={line is not None}")
    by = defaultdict(list)
    for r in rs:
        by[r["unit"]].append(r)
    for u, xs in by.items():
        void = sum(1 for r in xs if (r["error"] or "").startswith("VOID"))
        nofill = sum(1 for r in xs if r.get("reached") == "starting")
        print(f"  {u:12} loads {len(xs)} safety {sum(1 for r in xs if r['safety'] >= 1)} fill record "
              f"{sum(1 for r in xs if r['fill'])} VOID:driver {void} no fill {nofill} errors "
              f"{sum(1 for r in xs if r['error'] and not r['error'].startswith('VOID'))}")


def cpu(cells, log):
    spans, open_ = [], {}
    for l in Path(cells).read_text().splitlines():
        t, kind, eng, e, *_ = l.split()
        if kind == "start":
            open_[(eng, e)] = t
        else:
            spans.append((eng, e, open_.pop((eng, e)), t))
    for (eng, e), t in open_.items():
        spans.append((eng, e, t, None))
    from datetime import datetime, timezone
    ts = lambda s: datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    samples = [tuple(map(int, l.split())) for l in Path(log).read_text().splitlines() if l.strip()]
    for eng, e, a, b in spans:
        xs = [c for t, c in samples if ts(a) <= t <= (ts(b) if b else 1e12)]
        if xs:
            print(f"  host CPU {eng} {e}: p50 {q(xs, .5)} % max {max(xs)} %, samples over 90 %: {sum(x > 90 for x in xs)}")


d5a_busy()
lbusy()
cost()
for e in ["D5a", "D1", "L", "D6"]:
    firefox(e)
if len(sys.argv) > 3:
    cpu(sys.argv[2], sys.argv[3])
