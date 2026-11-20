#!/usr/bin/env python3
"""The tables and the decision rule of docs/av1/top-first.md §4 from run.mjs's rows: every visit's checks, each cell's
clock, latencies as medians [range] over kept visits with round-paired ratios to `k2`, the scroll at 15 slices/s, the
5 Mbit/s whole-volume times derived from the head fills, and each clause applied as written.

usage: summary.py ROWS.jsonl FRAMES [--decode decode.jsonl] [--svc ROWS.jsonl ...]   — lab/av1/delivery/top-first/README.md
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "scripts"))
from aa_rule import can_flag, flags  # noqa: E402

ARMS = ["htj2k", "k2", "k2-aa", "tf-frame", "tf-series"]
TF = ["tf-frame", "tf-series"]
VOLUMES = ["dbts_a1", "dbts_b1", "dbts_c1"]
RATE = {"r5000": 5e6, "r20000": 20e6, "r50000": 50e6}
SCROLL = 15
med = statistics.median


def span(xs, f="{:.2f}"):
    return f"{f.format(med(xs))} [{f.format(min(xs))}–{f.format(max(xs))}]" if xs else "—"


def first(r):
    return r["firstMs"] / 1000


def t_all(r):
    """t_T,all: every slice showing its top-only picture or its exact one; t_X where an arm has no preview."""
    return (r["shownMs"] if r.get("shownMs") is not None else r["decodedMs"]) / 1000


def t_x(r):
    return r["decodedMs"] / 1000


def scroll(r, n):
    """Shares of the slices reached at SCROLL slices/s from the issue that show the exact frame, the top, nothing."""
    ex, top = r.get("exactMs") or [None] * n, r.get("previewMs") or [None] * n
    reach = [1000 * i / SCROLL for i in range(n)]
    e = sum(x is not None and x <= t for x, t in zip(ex, reach))
    p = sum((x is None or x > t) and y is not None and y <= t for x, y, t in zip(ex, top, reach))
    return e / n, p / n, (n - e - p) / n


def paired(rs, ref, f):
    by = {r["round"]: r for r in ref}
    return [f(r) / f(by[r["round"]]) for r in rs if r["round"] in by]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows", type=Path)
    ap.add_argument("frames", type=Path)
    ap.add_argument("--decode", type=Path)
    ap.add_argument("--svc", type=Path, nargs="*", default=[], help="the SVC sittings' rows (f4c396c8)")
    a = ap.parse_args()
    rows = [json.loads(line) for line in a.rows.read_text().splitlines() if line.strip()]
    meta = {d.name: json.loads((d / "variants.json").read_text()) for d in a.frames.iterdir() if (d / "variants.json").exists()}
    nbytes = lambda s, arm: meta[s]["bytes"]["tf-series" if arm == "tf-series" else "htj2k" if arm == "htj2k" else "k2"]  # noqa: E731

    print("## Checks, every visit\n")
    print("| arm | visits (VOID) | exact frames | top-only pictures as (source ≫ 2) ≪ 2 | late | stray | failed visits |")
    print("| --- | --: | --- | --- | --: | --: | --- |")
    refused = {}
    for arm in ARMS:
        rs = [r for r in rows if r["variant"] == arm]
        if not rs:
            continue
        owed = sum(meta[r["set"]]["frames"] for r in rs)
        ex = sum(r.get("exact", 0) for r in rs)
        pv = sum(r.get("previewExact", 0) for r in rs) if arm in TF else None
        late = sum(r.get("late", 0) for r in rs)
        stray = sum(r.get("strays", 0) for r in rs)
        failed = [f"{r['set']} {r['link']} {r['throttle']}× r{r['round']}: {(r.get('failure') or (r['errors'] or [''])[0])[:60]}"
                  for r in rs if r.get("exact", 0) != meta[r["set"]]["frames"] or r.get("failures")]
        refused[arm] = ex != owed or (pv is not None and pv != owed) or late or stray
        print(f"| `{arm}` | {len(rs)} ({sum(r['void'] for r in rs)}) | {ex}/{owed} | {f'{pv}/{owed}' if pv is not None else '—'} | {late} | {stray} | "
              f"{'; '.join(failed) or 'none'} |")
    kept = [r for r in rows if not r["void"] and r.get("frames")]
    cells = sorted({(r["link"], r["throttle"]) for r in rows}, key=lambda c: (RATE[c[0]], c[1]))

    print("\n## Host: what the clock is, per cell (median over kept visits of every arm)\n")
    print("| volume, link, CPU | n kept a arm | VOID | wire rate ÷ R | last exact behind last byte, s | t_X 4× ÷ 1× |")
    print("| --- | --- | --: | --- | --- | --- |")
    for link, th in cells:
        for s in sorted({r["set"] for r in rows if r["link"] == link}):
            c = [r for r in kept if r["set"] == s and r["link"] == link and r["throttle"] == th]
            allc = [r for r in rows if r["set"] == s and r["link"] == link and r["throttle"] == th]
            n = ", ".join(f"{sum(r['variant'] == arm for r in c)}" for arm in ARMS)
            rate = [nbytes(s, r["variant"]) * 8 / (r["lastByteMs"] / 1000) / RATE[link] for r in c if r.get("lastByteMs")]
            lag = [(r["decodedMs"] - r["lastByteMs"]) / 1000 for r in c if r.get("lastByteMs")]
            slow = []
            for arm in ARMS:
                one = [t_x(r) for r in kept if r["set"] == s and r["link"] == link and r["throttle"] == 1 and r["variant"] == arm]
                four = [t_x(r) for r in kept if r["set"] == s and r["link"] == link and r["throttle"] == 4 and r["variant"] == arm]
                if one and four:
                    slow.append(f"{arm} {med(four) / med(one):.2f}")
            print(f"| `{s}` {link} {th}× | {n} | {sum(r['void'] for r in allc)} | {span(rate, '{:.3f}')} | {span(lag)} | "
                  f"{', '.join(slow) if th == 4 else ''} |")

    print("\n## Latencies, s from the fill's issue: median [range] · round-paired ratio to `k2`, median\n")
    print("| volume, link, CPU | arm | n | first picture | ÷ k2 | t_T,all | ÷ k2 | t_X | ÷ k2 | scroll 15/s: exact · top · nothing |")
    print("| --- | --- | --: | --- | --: | --- | --: | --- | --: | --- |")
    out = {}
    for link, th in cells:
        for s in sorted({r["set"] for r in rows if r["link"] == link}):
            ref = [r for r in kept if r["set"] == s and r["link"] == link and r["throttle"] == th and r["variant"] == "k2"]
            for arm in ARMS:
                rs = [r for r in kept if r["set"] == s and r["link"] == link and r["throttle"] == th and r["variant"] == arm]
                if not rs:
                    continue
                n = meta[s]["frames"]
                ratio = {k: paired(rs, ref, f) for k, f in (("first", first), ("all", t_all), ("x", t_x))}
                out[(s, link, th, arm)] = dict(rs=rs, ratio=ratio, first=[first(r) for r in rs], all=[t_all(r) for r in rs],
                                               x=[t_x(r) for r in rs])
                sc = [scroll(r, n) for r in rs if r.get("exactMs")]
                scs = " · ".join(f"{med(v[j] for v in sc):.0%}" for j in range(3)) if sc else "—"
                rr = lambda k: f"{med(ratio[k]):.3f}" if ratio[k] and arm != "k2" else ""  # noqa: E731
                print(f"| `{s}` {link} {th}× | `{arm}` | {len(rs)} | {span([first(r) for r in rs])} | {rr('first')} | "
                      f"{span([t_all(r) for r in rs])} | {rr('all')} | {span([t_x(r) for r in rs])} | {rr('x')} | {scs} |")

    print("\n## 5 Mbit/s, whole volumes, *derived* from the head fills' measured wire rate and the bytes\n")
    print("| volume | measured rate, Mbit/s (head fills, every arm, 1× and 4×) | HTJ2K t_X | `k2` t_X | `tf-frame` t_T,all | `tf-series` t_T,all | ÷ HTJ2K: tf-frame · tf-series |")
    print("| --- | --- | --: | --: | --: | --: | --- |")
    derived = {}
    for s in VOLUMES:
        h = [r for r in kept if r["set"] == f"{s}-head" and r["link"] == "r5000" and r.get("lastByteMs")]
        if not h:
            continue
        rate = med(nbytes(r["set"], r["variant"]) * 8 / (r["lastByteMs"] / 1000) for r in h)
        lows = [p - t for p, t in zip(per_slice(a.frames / s, "k2.av1"), per_slice(a.frames / s, "tfs.av1"))]
        tops = sum(per_slice(a.frames / s, "tfs.av1")[: meta[s]["frames"]])
        hx = meta[s]["bytes"]["htj2k"] * 8 / rate
        kx = meta[s]["bytes"]["k2"] * 8 / rate
        tf_frame = (meta[s]["bytes"]["k2"] - lows[meta[s]["frames"] - 1]) * 8 / rate
        tf_series = tops * 8 / rate
        derived[s] = dict(htj2k=hx, frame=tf_frame, series=tf_series)
        print(f"| `{s}` | {rate / 1e6:.2f} | {hx:.1f} | {kx:.1f} | {tf_frame:.1f} | {tf_series:.1f} | {tf_frame / hx:.3f} · {tf_series / hx:.3f} |")

    print("\n## The rule, as written\n")
    rule(out, cells, refused, meta, nbytes, derived)
    if a.svc:
        bridge(a.svc, out)
    if a.decode:
        decode_table(a.decode)


def per_slice(d, ext):
    """Entry sizes of a set's bundle by extension, in entry order; a tfs bundle's lows follow its tops."""
    return [p.stat().st_size for p in sorted(d.glob(f"[0-9][0-9][0-9].{ext}"))]


def rule(out, cells, refused, meta, nbytes, derived):
    get = lambda s, link, th, arm: out.get((s, link, th, arm))  # noqa: E731
    for arm in TF:
        print(f"**Clause 1, `{arm}`:** {'refused' if refused.get(arm) else 'passes'} — every visit's checks above.\n")
    for arm in TF:
        worst, ok = [], True
        for link, th in cells:
            for s in sorted({k[0] for k in out if k[1] == link and k[2] == th}):
                c = get(s, link, th, arm)
                if not c or not c["ratio"]["x"]:
                    continue
                rx = med(c["ratio"]["x"])
                rb = nbytes(s, arm) / nbytes(s, "k2")
                ok &= rx <= 1.10 and rb <= 1.02
                worst.append(f"`{s}` {link} {th}× {rx:.3f} · {rb:.5f}")
        print(f"**Clause 2, `{arm}`:** {'passes' if ok else 'fails'} — t_X ÷ k2 · bytes ÷ k2 per cell: {'; '.join(worst)}.\n")
    for arm, key in (("tf-frame", "frame"), ("tf-series", "series")):
        lines, ok = [], True
        for link, th in [(c, t) for c, t in cells if c == "r20000"] + [("r5000", 1), ("r5000", 4)]:
            passing = 0
            got = []
            for s in VOLUMES:
                if link == "r5000":
                    if s not in derived:
                        continue
                    v = derived[s][key] / derived[s]["htj2k"]
                else:
                    c, h = get(s, link, th, arm), get(s, link, th, "htj2k")
                    if not c or not h:
                        continue
                    v = med(c["all"]) / med(h["x"])
                passing += v <= 0.2
                got.append(f"{s} {v:.3f}")
            ok &= passing >= 2
            tag = " (*derived*, one value for 1× and 4×)" if link == "r5000" else ""
            lines.append(f"{link} {th}×{tag}: {', '.join(got)}")
        print(f"**Clause 3, `{arm}`:** {'passes' if ok else 'fails'} — t_T,all ÷ HTJ2K's t_X: {'; '.join(lines)}.\n")
    lines, ok = [], not refused.get("tf-frame")
    clause2 = all(med(c["ratio"]["x"]) <= 1.10 for k, c in out.items() if k[3] == "tf-frame" and c["ratio"]["x"])
    ok &= clause2
    for link, th in cells:
        passing, got = 0, []
        for s in sorted({k[0] for k in out if k[1] == link and k[2] == th}):
            c, k2, aa = get(s, link, th, "tf-frame"), get(s, link, th, "k2"), get(s, link, th, "k2-aa")
            if not (c and k2 and aa):
                continue
            arm_r, aa_r = c["ratio"]["first"], aa["ratio"]["first"]
            n = min(len(arm_r), len(aa_r))
            better = can_flag(n) and flags(aa_r, arm_r)[1]
            gain = 1 - med(arm_r)
            passing += better and gain >= 0.2
            got.append(f"{s} gain {gain:.3f}{'' if can_flag(n) else ' (n too small to flag)'}{', beyond A/A' if better else ', not beyond A/A'}")
        ok &= passing >= 2
        lines.append(f"{link} {th}×: {'; '.join(got)}")
    print(f"**Clause 4, `tf-frame`:** {'proposed' if ok else 'not proposed'} — clause 1 "
          f"{'refused' if refused.get('tf-frame') else 'passed'}, clause 2 {'passed' if clause2 else 'failed'}; "
          f"first picture's gain on k2 (1 − ratio): {' | '.join(lines)}.\n")


def bridge(paths, out):
    """Each figure ÷ its own sitting's `k2` in the same cell, round-paired: the SVC base (alone, quarter, q 20) there,
    the top-first arms here. *Across sittings.*"""
    svc = [json.loads(line) for p in paths for line in p.read_text().splitlines() if line.strip()]
    svc = [r for r in svc if not r.get("void") and r.get("frames")]
    print("\n## Against the SVC base, *across sittings*: first picture ÷ own `k2`'s · t_P or t_T,all ÷ own `k2`'s t_X\n")
    print("| volume, link, CPU | SVC base (n) | `tf-frame` | `tf-series` |")
    print("| --- | --- | --- | --- |")
    for (s, link, th, arm), c in sorted(out.items()):
        if arm != "tf-frame":
            continue
        base = [r for r in svc if r["set"] == s.removesuffix("-head") and r["link"] == link and r["throttle"] == th
                and r["variant"] in ("a2-q20", "alone-two-quarter-q20")]
        k2 = [r for r in svc if r["set"] == s.removesuffix("-head") and r["link"] == link and r["throttle"] == th and r["variant"] == "k2"]
        by = {r["round"]: r for r in k2}
        f = [r["firstMs"] / by[r["round"]]["firstMs"] for r in base if r["round"] in by]
        p = [r["shownMs"] / by[r["round"]]["decodedMs"] for r in base if r["round"] in by]
        cell = lambda k: (f"{med(k['ratio']['first']):.3f} · {med(k['ratio']['all']):.3f}" if k and k["ratio"]["first"] else "—")  # noqa: E731
        whole = not s.endswith("-head")
        svc_cell = f"{med(f):.3f} · {med(p):.3f} ({len(f)})" if f and whole else f"{med(f):.3f} · — ({len(f)})" if f else "—"
        print(f"| `{s}` {link} {th}× | {svc_cell} | {cell(c)} | {cell(out.get((s, link, th, 'tf-series')))} |")


def decode_table(path):
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    print("\n## Stage 1.5, decode through av1.js, ms a frame: median [range] over rounds × slices\n")
    print("| volume | CPU | d_T | d_X | d_T ÷ d_X (per slice and round) | exact |")
    print("| --- | --- | --- | --- | --: | --- |")
    for s in VOLUMES:
        for th in (1, 4):
            rs = [r for r in rows if r["set"] == s and r["throttle"] == th]
            if not rs:
                continue
            t = {(r["round"], r["i"]): r["ms"] for r in rs if r["which"] == "T" and r.get("ms") is not None}
            x = {(r["round"], r["i"]): r["ms"] for r in rs if r["which"] == "X" and r.get("ms") is not None}
            ratio = [t[k] / x[k] for k in t if k in x]
            print(f"| `{s}` | {th}× | {span(list(t.values()), '{:.0f}')} | {span(list(x.values()), '{:.0f}')} | "
                  f"{med(ratio):.2f} | {sum(r['exact'] for r in rs)}/{len(rs)} |")


if __name__ == "__main__":
    main()
