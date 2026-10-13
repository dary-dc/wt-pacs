#!/usr/bin/env python3
"""FASTCLOCK's tables from its three row files — lab/fastclock/README.md.

usage: summary.py [DIR]   DIR holds rows-fill.jsonl, rows-gso.jsonl, rows-ask.jsonl (default: this directory)
"""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
med = statistics.median


def rows(name):
    f = DIR / name
    return [json.loads(line) for line in f.read_text().splitlines() if line.strip()] if f.exists() else []


def span(xs, d=0):
    return f"{med(xs):.{d}f} [{min(xs):.{d}f}–{max(xs):.{d}f}]"


def paired(a, b, key):
    """b over a, matched by round: the median ratio and how many rounds b was lower."""
    ra = {r["round"]: key(r) for r in a}
    q = [key(r) / ra[r["round"]] for r in b if r["round"] in ra and ra[r["round"]]]
    return (med(q), sum(x < 1 for x in q), len(q)) if q else (None, 0, 0)


def fill():
    rs = rows("rows-fill.jsonl")
    if not rs:
        return
    print(f"## Fill: {len(rs)} visits, {sum(r['void'] for r in rs)} VOID, "
          f"{sum(r['exact'] for r in rs)}/{sum(r['owed'] for r in rs)} frames exact over every visit")
    print("engine set variant CPU | per rate (Mbit/s): last byte ms, fill ms, tail ms (fill − last byte), decoders busy, n "
          "| the decoders' clock from (Δfill < ½ Δlast byte)")
    for reading, keep in (("strict: VOID dropped", lambda r: not r["void"]), ("VOID kept", lambda r: True)):
        print(f"### {reading}")
        clocks(rs, keep)


def clocks(rs, keep):
    cells = defaultdict(lambda: defaultdict(list))
    for r in rs:
        if keep(r) and r["frames"]:
            cells[(r["engine"], r["set"], r["variant"], r["throttle"])][r["rateKbit"] / 1000].append(r)
    for (engine, s, v, cpu), by_rate in sorted(cells.items()):
        parts, prev, clock = [], None, "never"
        for rate in sorted(by_rate):
            g = by_rate[rate]
            last, done = med([r["receivedMs"] for r in g]), med([r["decodedMs"] for r in g])
            parts.append(f"{rate:.0f}: {span([r['receivedMs'] for r in g])}, {span([r['decodedMs'] for r in g])}, "
                         f"{span([r['decodedMs'] - r['receivedMs'] for r in g])}, {med([r['meanBusy'] for r in g]):.2f}, n={len(g)}")
            if prev and clock == "never" and prev[0] - last > 0 and (prev[1] - done) < 0.5 * (prev[0] - last):
                clock = f"{prev[2]:.0f}→{rate:.0f}"
            prev = (last, done, rate)
        print(f"{engine} {s} {v} {cpu}x | " + " · ".join(parts) + f" | {clock}")


def ratios(rs):
    print("\nAV1 (k2) over HTJ2K, fill, round-paired, strict (neither visit VOID): median [slower/n]")
    by = defaultdict(dict)
    for r in rs:
        if r["frames"]:
            by[(r["engine"], r["set"], r["throttle"], r["rateKbit"] / 1000, r["round"])][r["variant"]] = r
    out = defaultdict(lambda: ([], []))
    for (engine, s, cpu, rate, _), v in by.items():
        if "htj2k" in v and "k2" in v:
            q = v["k2"]["decodedMs"] / v["htj2k"]["decodedMs"]
            out[(engine, s, cpu, rate)][1].append(q)
            if not v["k2"]["void"] and not v["htj2k"]["void"]:
                out[(engine, s, cpu, rate)][0].append(q)
    for k, (strict, rp) in sorted(out.items()):
        f = lambda q: f"{med(q):.2f} [{sum(x > 1 for x in q)}/{len(q)}]" if q else "—"  # noqa: E731
        print(f"{k[0]} {k[1]} {k[2]}x {k[3]:.0f}: strict {f(strict)} · round-paired {f(rp)}")


def gso():
    rs = [r for r in rows("rows-gso.jsonl") if "error" not in r]
    if not rs:
        return
    print(f"\n## GSO cap, native fills (server on one core): {len(rs)} runs, "
          f"{sum(r['exact'] for r in rs)}/{sum(r['frames'] for r in rs)} frames exact")
    print("codec N | server ms/MB base, cap24 · cap24/base paired [lower/n] | fill p50 ms base, cap24 · paired [lower/n] "
          "| worst session ms base, cap24 | client drops base, cap24")
    groups = defaultdict(lambda: defaultdict(list))
    for r in rs:
        groups[(r["codec"], r["sessions"])][r["server"]].append(r)
    cpu = lambda r: r["server_cpu_s"] * 1e3 / (r["bytes"] / 1e6)  # noqa: E731
    p50 = lambda r: med(r["fill_ms"])  # noqa: E731
    worst = lambda r: max(r["fill_ms"])  # noqa: E731
    for (codec, n), g in sorted(groups.items()):
        a, b = g["base"], g["cap24"]
        c, f = paired(a, b, cpu), paired(a, b, p50)
        print(f"{codec} {n} | {span([cpu(r) for r in a], 2)}, {span([cpu(r) for r in b], 2)} · ×{c[0]:.3f} [{c[1]}/{c[2]}] | "
              f"{span([p50(r) for r in a])}, {span([p50(r) for r in b])} · ×{f[0]:.3f} [{f[1]}/{f[2]}] | "
              f"{span([worst(r) for r in a])}, {span([worst(r) for r in b])} | "
              f"{med([r['rcvbuf_drops'] for r in a]):.0f}, {med([r['rcvbuf_drops'] for r in b]):.0f}")


def ask():
    rs = [r for r in rows("rows-ask.jsonl") if "cell" in r]
    if not rs:
        return
    print(f"\n## GSO cap, an ask during a fill in Chromium: {len(rs)} runs, {sum(r['void'] for r in rs)} VOID, "
          f"{sum(r['exact'] for r in rs)}/{len(rs)} exact")
    print("cell | ask ms base, cap24 · paired | fill ms base, cap24 · paired | datagrams per sendmsg base, cap24 "
          "(strict: neither run VOID; round-paired: all)")
    for cell in sorted({r["cell"] for r in rs}):
        for name, keep in (("strict", lambda r: not r["void"]), ("round-paired", lambda r: True)):
            g = [r for r in rs if r["cell"] == cell and r["ask_ms"] is not None]
            voids = {r["round"] for r in g if r["void"]} if name == "strict" else set()
            a = [r for r in g if r["arm"] == "base" and r["round"] not in voids and keep(r)]
            b = [r for r in g if r["arm"] == "cap24" and r["round"] not in voids and keep(r)]
            if not a or not b:
                continue
            k, f = paired(a, b, lambda r: r["ask_ms"]), paired(a, b, lambda r: r["fill_ms"])
            print(f"{cell} {name} | {span([r['ask_ms'] for r in a])}, {span([r['ask_ms'] for r in b])} · ×{k[0]:.3f} "
                  f"[{k[1]}/{k[2]}] | {span([r['fill_ms'] for r in a])}, {span([r['fill_ms'] for r in b])} · ×{f[0]:.3f} "
                  f"[{f[1]}/{f[2]}] | {med([r['per_sendmsg'] for r in a]):.1f}, {med([r['per_sendmsg'] for r in b]):.1f}")


fill()
ratios(rows("rows-fill.jsonl"))
gso()
ask()
