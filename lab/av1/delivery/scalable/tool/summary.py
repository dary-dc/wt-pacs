#!/usr/bin/env python3
"""The scalable preview as a tool, read out: stage 1's shapes against the shipped payload and the pruning
(docs/av1/README.md §The scalable preview as a tool, 5), and stage 2's fills against the decision rule.

  summary.py shapes SHAPES.tsv ... --decode DECODE.json      the shapes table and the survivors
  summary.py fills ROWS.jsonl --frames DIR                    each cell's times, bytes, scroll and the rule
"""
import argparse
import csv
import json
import statistics
from pathlib import Path

VOLUMES = ["dbts_a1", "dbts_b1", "dbts_c1"]
SPEEDS = (5, 15, 30)


def shapes(args):
    rows = [r for f in args.tsv for r in csv.DictReader(open(f), delimiter="\t")]
    times = {}
    for r in json.load(open(args.decode)):
        times.setdefault((r["throttle"], r["set"], r["variant"]), []).append(r["ms"])
    ms = {k: statistics.median(v) for k, v in times.items()}
    alone_from = {r["set"]: "split" if any(x["set"] == r["set"] and x["coding"] == "split" for x in rows) else "whole" for r in rows}

    def decode(throttle, s, coding, shape):
        """d_b, d_x ms a frame; q 20 and q 60 take q 40's (shape.py's method times q 40 alone)."""
        geometry = shape.replace("-q20", "-q40").replace("-q60", "-q40")
        if coding == "alone":
            return ms[(throttle, s, f"{alone_from[s]}-{geometry}-base")], ms[(throttle, s, "shipped")] + ms[(throttle, s, "low")]
        low = ms[(throttle, s, "low")] if coding == "split" else 0
        return ms[(throttle, s, f"{coding}-{geometry}-base")], ms[(throttle, s, f"{coding}-{geometry}-all")] + low

    table = {}
    for r in rows:
        s, F = r["set"], int(r["frames"])
        assert int(r["top_exact"]) == F, f"{s} {r['coding']} {r['shape']}: {r['top_exact']}/{F} exact"
        shipped, base = int(r["shipped_bytes"]), int(r["base_bytes"])
        cell = dict(bytes=int(r["total_bytes"]) / shipped, base=base / int(r["htj2k_bytes"]), psnr=float(r["base_psnr_db"]),
                    maxd=int(r["base_max_abs_diff"]), size=r["base_size"])
        # The predicted top as stage 2 builds it: split on a 12-bit volume, whole on a 10-bit one; 12 bits unsplit apart.
        family = "predicted" if r["coding"] == alone_from[s] else "predicted-unsplit"
        table[(family, r["shape"], s)] = dict(cell, coding=r["coding"])
        if family == "predicted":
            table[("alone", r["shape"], s)] = dict(cell, coding="alone", bytes=(shipped + base) / shipped)
    for (_, shape, s), c in table.items():
        for t in (1, 4):
            c[f"db{t}"], c[f"dx{t}"] = decode(t, s, c["coding"], shape)
    names = sorted({(c, sh) for c, sh, _ in table})
    keys = ("bytes", "db1", "db4", "dx1", "dx4")

    def dominated(x):
        for y in names:
            if y == x:
                continue
            common = [s for s in VOLUMES if (*x, s) in table and (*y, s) in table]
            if common and all(all(table[(*y, s)][k] <= table[(*x, s)][k] for k in keys) and
                              table[(*y, s)]["psnr"] >= table[(*x, s)]["psnr"] for s in common):
                return y
        return None

    print("| shape | " + " | ".join(f"`{s}` bytes ÷ shipped · base % of HTJ2K · dB · d_b / d_x ms 1× · 4×" for s in VOLUMES) + " | dropped for |")
    print("|" + " --- |" * (len(VOLUMES) + 2))
    kept = []
    for x in names:
        cells = []
        for s in VOLUMES:
            c = table.get((*x, s))
            cells.append("—" if not c else f"{c['bytes']:.3f} · {100 * c['base']:.3f} % · {c['psnr']:.1f} · "
                         f"{c['db1']:.1f} / {c['dx1']:.0f} · {c['db4']:.1f} / {c['dx4']:.0f}")
        by = dominated(x)
        if not by:
            kept.append(x)
        print(f"| {x[0]} {x[1]} | " + " | ".join(cells) + f" | {'—' if not by else ' '.join(by)} |")
    worst = {x: max(table[(*x, s)]["bytes"] for s in VOLUMES if (*x, s) in table) for x in kept}
    within = [x for x in kept if worst[x] <= 1.02]
    print("\nundominated and within the rule's 1.02 of the shipped bytes on every volume:",
          ", ".join(f"{' '.join(x)} (≤ {worst[x]:.3f})" for x in within))


def ratio(xs, ref, key):
    """Median of the ratios to the reference's t_X paired by round; the ratio of medians where no round has both."""
    paired = [x[key] / ref[x["round"]]["tX"] for x in xs if x["round"] in ref]
    return statistics.median(paired) if paired else statistics.median(x[key] for x in xs) / statistics.median(r["tX"] for r in ref.values())


def fills(args):
    rows = [json.loads(l) for l in open(args.rows)]
    kept = [r for r in rows if not r["void"] and r["frames"]]
    sets = {d.name: json.loads((d / "variants.json").read_text()) for d in Path(args.frames).iterdir() if (d / "variants.json").exists()}
    med = statistics.median
    out = {}
    for r in kept:
        F = sets[r["set"]]["frames"]
        exact = r["exactMs"]
        picture = [min(t for t in (x, p) if t is not None) if x is not None or p is not None else None
                   for x, p in zip(exact, r.get("previewMs") or [None] * F)]
        scroll = {}
        for v in SPEEDS:
            reached = [1000 * i / v for i in range(F)]
            scroll[v] = (sum(x is not None and x <= t for x, t in zip(exact, reached)) / F,
                         sum(p is not None and p <= t for p, t in zip(picture, reached)) / F)
        out.setdefault((r["set"], r["link"], r["throttle"], r["variant"]), []).append(dict(
            round=r["round"], tP=max(picture), tX=r["decodedMs"], first=r["firstMs"], exact=r["exact"] == F,
            previews=r.get("previewExact", F) == F if "previews" in r else True, late=r.get("late", 0), scroll=scroll))
    variants = sorted({k[3] for k in out})
    print("ms from the fill's issue, median [min–max] of n kept; scroll at v slices/s from slice 0 at the issue: share of "
          "slices showing a picture (exact)")
    verdict = {}
    for cell in sorted({k[:3] for k in out}):
        s, link, c = cell
        ref = {x["round"]: x for x in out.get((*cell, "htj2k"), [])}
        aa = [x["tX"] / ref[x["round"]]["tX"] for x in out.get((*cell, "htj2k-aa"), []) if x["round"] in ref]
        resolution = max(abs(1 - q) for q in aa) if aa else None
        shipped = {x["round"]: x for x in out.get((*cell, "k2"), [])}
        prefix = out.get((*cell, "res"), [])
        print(f"\n{s} {link} {c}×: A/A t_X ratio {', '.join(f'{q:.3f}' for q in aa)} (resolution ±{resolution or 0:.3f})")
        for v in variants:
            xs = out.get((*cell, v), [])
            if not xs:
                continue
            span = lambda k: f"{med([x[k] for x in xs]):.0f} [{min(x[k] for x in xs):.0f}–{max(x[k] for x in xs):.0f}]"
            sc = " · ".join(f"v{sp} {100 * med([x['scroll'][sp][1] for x in xs]):.0f} % ({100 * med([x['scroll'][sp][0] for x in xs]):.0f} %)" for sp in SPEEDS)
            line = f"  {v}: first {span('first')} t_P {span('tP')} t_X {span('tX')} n={len(xs)} exact {sum(x['exact'] for x in xs)}/{len(xs)} {sc}"
            if v.startswith(("alone", "predicted")) and ref and shipped:
                tp, tx = ratio(xs, ref, "tP"), ratio(xs, shipped, "tX")
                more = med([x["scroll"][15][1] for x in xs]) > (med([x["scroll"][15][1] for x in prefix]) if prefix else 1)
                wire = sets[s]["bytes"][v] / sets[s]["bytes"]["k2"]
                ok = dict(exact=all(x["exact"] and x["previews"] and not x["late"] for x in xs), tP=tp <= 0.2, scroll=more,
                          tX=tx <= 1.10 + (resolution or 0), bytes=wire <= 1.02)
                verdict.setdefault(v, {}).setdefault(s, []).append(((link, c), ok))
                line += f"\n    t_P ÷ HTJ2K t_X {tp:.3f} · t_X ÷ shipped {tx:.3f} · bytes ÷ shipped {wire:.3f} · rule {ok}"
            print(line)
    shapes_run = [v for v in variants if v.startswith(("alone", "predicted"))]
    print("\n| volume, link, CPU | HTJ2K t_X, s | shipped t_X | prefix t_P · v 15 | " +
          " | ".join(f"`{v}` t_P s · t_X ÷ shipped · v 15" for v in shapes_run) + " |")
    print("|" + " --- |" * (4 + len(shapes_run)))
    for cell in sorted({k[:3] for k in out}):
        get = lambda v: out.get((*cell, v), [])
        m = lambda v, k: med([x[k] for x in get(v)]) if get(v) else None
        sc = lambda v: f"{100 * med([x['scroll'][15][1] for x in get(v)]):.0f} %" if get(v) else "—"
        cols = [f"{m('htj2k', 'tX') / 1000:.1f}", f"{m('k2', 'tX') / 1000:.1f}", f"{m('res', 'tP') / 1000:.1f} · {sc('res')}"]
        for v in shapes_run:
            cols.append(f"{m(v, 'tP') / 1000:.2f} · {ratio(get(v), {x['round']: x for x in get('k2')}, 'tX'):.3f} · {sc(v)}"
                        if get(v) else "—")
        n = min(len(get(v)) for v in ["htj2k", "k2", *shapes_run])
        print(f"| `{cell[0]}` {int(cell[1][1:]) // 1000} Mbit {cell[2]}× (n ≥ {n}) | " + " | ".join(cols) + " |")
    print("\nthe rule, per variant and volume (every cell run must pass):")
    for v, by in verdict.items():
        passed = [s for s, cells in by.items() if all(all(ok.values()) for _, ok in cells)]
        print(f"  {v}: passes on {passed or 'none'} of {sorted(by)}; {'INTERESTING' if len(passed) >= 2 else 'not interesting'} in the cells run")


ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest="cmd", required=True)
a = sub.add_parser("shapes")
a.add_argument("tsv", nargs="+")
a.add_argument("--decode", required=True)
b = sub.add_parser("fills")
b.add_argument("rows")
b.add_argument("--frames", required=True)
args = ap.parse_args()
shapes(args) if args.cmd == "shapes" else fills(args)
