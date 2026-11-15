#!/usr/bin/env python3
"""Row METRICS' per-system reading (README.md §Collector 3–5): each series' stored-form knees and anchors from
collect.py, then their median and range per system, and the bytes there as a fraction of the series' HTJ2K.

usage: systems.py ROWS.jsonl ...
"""
import statistics
import sys

import collect

FAMILIES = ["system A", "system B", "system C", "content 2 DBT", "TRUS", "controls", "provisional"]
ANCHORS = {"noise": lambda p: p["nb_sigma_max"] <= 1,
           "level": lambda p: all(p[w]["max"] <= 1 for w in p if w.startswith("w")),
           "band": lambda p: p["scroll_max"] < 1, "full": lambda p: p["scroll_full_max"] < 1}
KNEES = ("psnr_med", "ssim_db", "nb_sigma_med", "ge1", "jod")


def family(name):
    if name in collect.PROVISIONAL:
        return "provisional"
    if name.startswith("dbts_"):
        return collect.group(name)
    if name.startswith("dbt"):
        return "content 2 DBT"
    return "TRUS" if name.startswith("ustrus") else "controls"


def stored(by):
    out = {}
    for name, form, g in sorted(by, key=lambda k: (k[0], k[1] != "12bit", k[1])):
        out.setdefault(name, form)
    return out


def rung(pts, q):
    return next(p for p in pts if p["q"] == q)


def spread(qs):
    got = sorted(q for q in qs if q is not None)
    none = len(qs) - len(got)
    if not got:
        return "no rung"
    med = statistics.median_low(got)
    span = f"{got[0]}–{got[-1]}" if got[0] != got[-1] else f"{got[0]}"
    return f"{med} ({span}{f'; no rung on {none}' if none else ''})"


def frac(vals):
    v = sorted(x for x in vals if x is not None)
    if not v:
        return "—"
    return f"{statistics.median(v):.3f} ({v[0]:.3f}–{v[-1]:.3f})" if len(v) > 1 else f"{v[0]:.3f}"


def main():
    series, cells, controls = collect.load(sys.argv[1:])
    _, by = collect.report(series, cells, controls)
    for pts in by.values():
        for p in pts:
            p["ssim_db"] = -10 * collect.math.log10(max(1 - p["ms_ssim_med"], 1e-12))
            p["ge1"] = 100 * p["w0"]["ge1_med"]
    form = stored(by)
    per = {}
    for name, f in form.items():
        htj2k = controls.get(name, {}).get("htj2k")
        for g in (1, 16):
            pts = by.get((name, f, g))
            if not pts:
                continue
            row = {}
            for a, test in ANCHORS.items():
                q = collect.highest(pts, test)
                row[a] = (q, rung(pts, q)["bytes"] / htj2k if q is not None and htj2k else None)
            for k in KNEES:
                q = collect.knee(pts, k)
                row["knee_" + k] = (q, rung(pts, q)["bytes"] / htj2k if q is not None and htj2k else None)
            per[(name, g)] = row

    print("#### Per series, stored form: anchors and knees (Q, and bytes ÷ HTJ2K there)\n")
    print("| series | form | G | e_N ≤ σ | ≤ 1 level | band < step | full < step | knee PSNR · MS-SSIM · e_N ÷ σ · ≥ 1 level · JOD |")
    print("| --- | --- | --: | --- | --- | --- | --- | --- |")
    cell = lambda v: "no rung" if v[0] is None else f"{v[0]} · {v[1]:.3f}" if v[1] else f"{v[0]}"
    for (name, g), r in sorted(per.items(), key=lambda kv: (FAMILIES.index(family(kv[0][0])), kv[0])):
        print(f"| `{name}` | {form[name]} | {g} | " + " | ".join(cell(r[a]) for a in ANCHORS) + " | "
              + " · ".join(str(r['knee_' + k][0]) for k in KNEES) + " |")

    print("\n#### Per family: the highest Q holding, median (range), and bytes ÷ HTJ2K there, median (range)\n")
    print("| family | series | G | e_N ≤ σ: Q · bytes | ≤ 1 level: Q | band < step: Q · bytes | full < step: Q · bytes "
          "| knees, median Q: PSNR · MS-SSIM · e_N ÷ σ · ≥ 1 level · JOD | knee PSNR: bytes |")
    print("| --- | --: | --: | --- | --- | --- | --- | --- | --- |")
    for fam in FAMILIES:
        for g in (1, 16):
            rows = [r for (n, gg), r in per.items() if family(n) == fam and gg == g]
            if not rows:
                continue
            col = lambda a: f"{spread([r[a][0] for r in rows])} · {frac([r[a][1] for r in rows])}"
            knees = " · ".join(spread([r['knee_' + k][0] for r in rows]).split(" (")[0] for k in KNEES)
            print(f"| {fam} | {len(rows)} | {g} | {col('noise')} | {spread([r['level'][0] for r in rows])} | "
                  f"{col('band')} | {col('full')} | {knees} | {frac([r['knee_psnr_med'][1] for r in rows])} |")

    ladder = collect.json.loads((collect.HERE / "plan.json").read_text())["ladder"]
    print("\n#### More than one rung from the family's median\n")
    print("| series | G | reading | Q | family median Q |")
    print("| --- | --: | --- | --: | --: |")
    for (name, g), r in sorted(per.items(), key=lambda kv: (FAMILIES.index(family(kv[0][0])), kv[0])):
        fam = [rr for (n, gg), rr in per.items() if family(n) == family(name) and gg == g]
        for key in r:
            got = [rr[key][0] for rr in fam if rr[key][0] is not None]
            if r[key][0] is None or len(got) < 3:
                continue
            med = statistics.median_low(got)
            if abs(ladder.index(r[key][0]) - ladder.index(med)) > 1:
                print(f"| `{name}` | {g} | {key} | {r[key][0]} | {med} |")


if __name__ == "__main__":
    main()
