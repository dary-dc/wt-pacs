#!/usr/bin/env python3
"""PROFILEDECODE's tables and D1–D3 (README.md §2, §6), computed from decode.mjs's rows, not judged.

usage: decode_report.py ROWS.json [--pilot]     ms; a cell is (series, rung, throttle, link, arm, decoder)
"""
import json
import math
import statistics as st
import sys
from collections import defaultdict

READ_N = 10
ORDER_LIMIT = 0.10
BANDS = {"D1": (0, 1.0), "D2": (5, 9), "D3": (0.9, 1.1)}


def clock(r, name):
    """A round's figure for one clock: the median frame, the mean ask over its positions, the series span."""
    c = (r.get("clocks") or {}).get(name)
    if c is None:
        return None
    if name == "frame":
        return st.median(c)
    if name == "ask":
        v = [x for x in c.values() if x is not None]
        return st.mean(v) if len(v) == len(c) and v else None
    return c


def failed(r):
    return bool(r.get("error")) or any(ok != n for ok, n in r["checks"].values())


def key(r):
    return r["set"], r["q"], r["throttle"], r["link"], r["arm"], r["dec"]


def ratios(num, den, name, den_name=None):
    """Paired by round: num's clock ÷ den's, with num's predecessor; den matched on set, throttle, link."""
    at = {r["round"]: r for r in den}
    out = []
    for r in num:
        d = at.get(r["round"])
        a, b = clock(r, name), d and clock(d, den_name or name)
        if a is not None and b:
            out.append((a / b, r["prev"], r["round"]))
    return out


def summary(v):
    x = [a for a, _, _ in v]
    m = st.median(x)
    groups = defaultdict(list)
    for a, p, _ in v:
        groups[p].append(a)
    effect = max(abs(st.median(g) / m - 1) for g in groups.values())
    return m, min(x), max(x), sum(a > 1 for a in x), len(x), effect


def main():
    rows = json.load(open(sys.argv[1]))
    pilot = "--pilot" in sys.argv
    cells = defaultdict(list)
    for r in rows:
        cells[key(r)].append(r)
    void = {k for k, rs in cells.items() if any(failed(r) for r in rs)}
    voided = {(k[0], k[1], k[2]) for k in void}

    print("checks over every round: matched / expected, by check")
    tot = defaultdict(lambda: [0, 0])
    for r in rows:
        for c, (ok, n) in r["checks"].items():
            tot[(r["arm"][0], c)][0] += ok
            tot[(r["arm"][0], c)][1] += n
    for (a, c), (ok, n) in sorted(tot.items()):
        print(f"  {a} {c}: {ok}/{n}")
    errors = [r for r in rows if r.get("error")]
    print(f"  errors: {len(errors)}" + "".join(f"\n    {r['unit']} r{r['round']} {r['throttle']}x: {r['error'][:160]}" for r in errors[:8]))
    print(f"  void (series, rung, throttle): {sorted(voided, key=str) or 'none'}")

    def H(k):
        return cells.get((k[0], None, k[2], k[3], "H", "openjph"), [])

    print("\nclock medians over rounds, ms [range] n; ÷ H paired: median [range], slower k/n, order effect, read")
    lines, verdict = [], defaultdict(list)
    for k in sorted(cells, key=lambda k: (k[0], k[2], k[3], str(k[1]), k[4], k[5])):
        rs = cells[k]
        for name in ("frame", "ask", "series"):
            v = [clock(r, name) for r in rs if clock(r, name) is not None]
            if not v:
                continue
            ref = "frame" if name == "ask" else name
            p = ratios(rs, H(k), name, ref) if k[4] != "H" else []
            m, lo, hi, slower, n, effect = summary(p) if p else (None,) * 6
            why = []
            if (k[0], k[1], k[2]) in voided or (k[0], None, k[2]) in voided:
                why.append("void")
            if len(v) < READ_N:
                why.append(f"n {len(v)} < {READ_N}")
            if effect is not None and effect > ORDER_LIMIT:
                why.append(f"order {effect:.0%}")
            read = "not read: " + ", ".join(why) if why else "read"
            ratio = f"{m:.3f} [{lo:.3f}–{hi:.3f}] {slower}/{n} {effect:.1%}" if p else "—"
            lines.append(f"  {k[0]} Q{k[1] or '-'} {k[2]}x {k[3]:>4} {k[4]:<3} {k[5]:<9} {name:<6} "
                         f"{st.median(v):9.1f} [{min(v):.1f}–{max(v):.1f}] n {len(v)}  ÷H {ratio}  {read}")
            if pilot and p:
                s = st.stdev([math.log(a) for a, _, _ in p]) if len(p) > 1 else float("nan")
                need = max(READ_N, math.ceil(((1.96 + 0.84) * s / math.log(1.05)) ** 2)) if s == s else None
                lines.append(f"      pilot σ of ln(÷H) {s:.4f} → n {need}")
            if name == "frame" and k[4][0] == "S" and k[5] == "webcodecs" and p:
                verdict["D1"].append((k, m, read))
            if name == "frame" and k[4] == "R" and p:
                verdict["D3"].append((k, m, read))
    for k in cells:
        if k[4] == "S16":
            one = cells.get((k[0], k[1], k[2], k[3], "S1", k[5]), [])
            p = ratios(cells[k], one, "ask")
            if p:
                m, lo, hi, slower, n, effect = summary(p)
                why = [] if n >= READ_N else [f"n {n} < {READ_N}"]
                if effect > ORDER_LIMIT:
                    why.append(f"order {effect:.0%}")
                if (k[0], k[1], k[2]) in voided:
                    why.append("void")
                read = "not read: " + ", ".join(why) if why else "read"
                verdict["D2"].append((k, m, read))
                lines.append(f"  {k[0]} Q{k[1]} {k[2]}x {k[3]:>4} S16÷S1 ask {k[5]:<9} {m:.2f} [{lo:.2f}–{hi:.2f}] n {n}  {read}")
    print("\n".join(lines))

    print("\nD1–D3: every cell against its band; a read cell outside refutes it there")
    for d, (lo, hi) in BANDS.items():
        v = verdict[d]
        read = [x for x in v if x[2] == "read"]
        out = [x for x in read if not lo <= x[1] <= hi]
        state = "not decided: no cell read" if not read else ("refuted" if out else "held")
        print(f"  {d} band {lo}–{hi}: {len(read)} of {len(v)} cells read; {state}")
        for k, m, r in sorted(v, key=lambda x: str(x[0])):
            flag = "outside" if not lo <= m <= hi else "inside"
            print(f"    {k[0]} Q{k[1]} {k[2]}x {k[3]} {k[4]} {k[5]}: {m:.3f} {flag} ({r})")


def table(rows):
    """Per series, rung and throttle: each arm's frame, ask and series medians (ms) and frame ÷ H, as a Markdown table."""
    cells = defaultdict(list)
    for r in rows:
        cells[key(r)].append(r)
    arms = ["H", "L", "S1", "S8", "S16", "SW", "R", "W"]
    out = ["| series · Q · throttle · link | decoder | " + " | ".join(arms) + " |", "| --- | --- |" + " --- |" * len(arms)]
    for s, q, t, link in sorted({(k[0], k[1], k[2], k[3]) for k in cells if k[1]}, key=lambda k: (k[0], k[2], k[1], k[3])):
        h = cells[(s, None, t, link, "H", "openjph")]
        for dec in ("dav1d", "webcodecs"):
            line = []
            for a in arms:
                rs = h if a == "H" else cells.get((s, None if a in ("H", "L") else q, t, link, a, dec), [])
                med = lambda n: st.median(v) if (v := [clock(r, n) for r in rs if clock(r, n) is not None]) else None
                f, k, w = med("frame"), med("ask"), med("series")
                p = ratios(rs, h, "frame") if a != "H" else []
                txt = f"{f:.0f}" + (f" ({st.median(x for x, _, _ in p):.2f})" if p else "")
                txt += f" · ask {k:.0f}" if k is not None else ""
                txt += f" · series {w / 1000:.1f} s" if w is not None else ""
                line.append(txt if f is not None else "—")
            out.append(f"| `{s}` Q{q} {t}× {link} | {dec} | " + " | ".join(line) + " |")
    return "\n".join(out)


if __name__ == "__main__":
    if "--table" in sys.argv:
        print(table(json.load(open(sys.argv[1]))))
        sys.exit()
    main()
