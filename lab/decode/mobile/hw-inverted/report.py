#!/usr/bin/env python3
"""Every row of measure.py against hw-inverted.md §8's predictions I1–I5, J1–J2; reruns from the rows.

usage: report.py DEPTH8_ROWS > rows/report.md      (DEPTH8_ROWS holds DEPTH8-MEASURE's stage-a.jsonl, stage-c.jsonl)
"""
import json
import statistics as st
import sys
from pathlib import Path

from measure import BAR, BAR_WIDE, FORM, HIGH, LOW, STAGE_A, STAGE_C, read

HERE = Path(__file__).resolve().parent
RMS = {10: 1.3628726554597828, 12: 5.401009020312778}


def ratios(row, sigma):
    return [f["err_noise_band"] / s for f, s in zip(row["frames"], sigma)]


def today(b):
    return "top10" if b > 10 else f"{b}bit"


def highest(cells, form, sigma, bar):
    """The highest Q passing the bar, and whether a failing Q above it was measured."""
    got = {c["q"]: max(ratios(c, sigma)) for c in cells if c["form"] == form}
    q = max((q for q, w in got.items() if w <= bar), default=None)
    return q, any(w > bar for p, w in got.items() if q is None or p > q)


def size(cells, form, q):
    return next((sum(c["units"]) for c in cells if c["form"] == form and c["q"] == q), None)


def fmt(x, f="{:.2f}"):
    return "—" if x is None else f.format(x)


def i1(rows, series):
    out = ["### I1 · the cut alone", "", "| volume | D | r | e_N ÷ σ, per frame | largest \\|e_N ÷ r − 1\\| | "
           "mean error | chroma ≠ 128 | I1 |", "| --- | --: | --: | --- | --: | --: | --: | --- |"]
    for r in rows:
        if r["kind"] != "cut_only":
            continue
        rms, ratio = RMS[r["b"]], ratios(r, series[r["set"]]["sigma"])
        dev = max(abs(f["err_noise_band"] / rms - 1) for f in r["frames"])
        mean = max(abs(f["mean_err"]) for f in r["frames"])
        out.append(f"| `{r['set']}` | {r['b']} | {rms:.3f} | {min(ratio):.3f}–{max(ratio):.3f} | {100 * dev:.1f} % | "
                   f"{mean:.3f} | {r['chroma_off']} | {'hit' if dev <= 0.03 else 'miss'} |")
    return out


def c1(rows, series, d8, pred):
    out = ["", "### I2 · the highest Q, I3 · bytes (G 1, each form at its highest Q)", "",
           "| volume | bar | `inv220-420` | predicted | `cut8` (DEPTH8) | I2 | bytes ÷ `cut8` | predicted, widened | I3 | "
           "bytes ÷ today's (DEPTH8) |", "| --- | --: | --: | --- | --: | --- | --: | --- | --- | --: |"]
    tally = {"I2": [], "I3": [], "I4": [], "I5": []}
    for s in STAGE_A + STAGE_C:
        if s not in series:
            continue
        sigma, b = series[s]["sigma"], series[s]["b"]
        cells = [r for r in rows if r["kind"] == "cell" and r["set"] == s]
        mine = [c for c in d8["cells"] if c["set"] == s and c["g"] == 1]
        for bar in (BAR, BAR_WIDE):
            p = pred[s][f"bar{bar:.2f}"]
            q, shut = highest(cells, FORM, sigma, bar)
            q8, _ = highest(mine, "cut8", d8["series"][s]["sigma"], bar)
            qt, _ = highest(mine, today(b), d8["series"][s]["sigma"], bar)
            lo, hi = p["inv220_independent_removal"]
            hit2 = q is not None and shut and lo <= q <= hi and q8 is not None and q <= q8
            ratio = size(cells, FORM, q) / size(mine, "cut8", q8) if q and q8 else None
            band = sorted(p["bytes_inv220_over_cut8"]) if all(p["bytes_inv220_over_cut8"]) else None
            band = band and (0.9 * band[0], band[1])
            hit3 = "—" if band is None or ratio is None else ("hit" if band[0] <= ratio <= band[1] else "miss")
            vs_today = size(cells, FORM, q) / size(mine, today(b), qt) if q and qt else None
            if bar == BAR:
                tally["I2"].append(hit2)
                tally["I3"] += [hit3 == "hit"] if hit3 != "—" else []
            out.append(f"| `{s}` | {bar:.2f} | {fmt(q, '{}')}{'' if shut else ' (no fail above)'} | {lo}–{hi} | "
                       f"{fmt(q8, '{}')} | {('hit' if hit2 else 'miss') if bar == BAR else '(reported)'} | "
                       f"{fmt(ratio)} | {'—' if not band else f'{band[0]:.2f}–{band[1]:.2f}'} | "
                       f"{hit3 if bar == BAR else '(reported)'} | {fmt(vs_today)} |")
    out += ["", "### I4 · the range, I5 · the chroma (every `inv220-420` cell)", "",
            "| volume | Q | worst e_N ÷ σ | bytes | luma outside 16…235 | share | frames | lowest | highest | "
            "chroma ≠ 128 |", "| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: |"]
    for c in sorted((r for r in rows if r["kind"] == "cell" and r["form"] == FORM), key=lambda r: r["q"]):
        s = series[c["set"]]
        share = c["luma_out"] / (s["frames"] * s["width"] * s["height"])
        beyond = max(LOW - c["luma_min"], c["luma_max"] - HIGH, 0)
        tally["I4"].append(share < 1e-4 and beyond <= 4)
        tally["I5"].append(c["chroma_off"] == 0)
        out.append(f"| `{c['set']}` | {c['q']} | {max(ratios(c, s['sigma'])):.3f} | {sum(c['units'])} | "
                   f"{c['luma_out']} | {share:.1e} | {c['frames_out']} | {c['luma_min']} | {c['luma_max']} | "
                   f"{c['chroma_off']} |")
    out += ["", "Tally at bar 1.00: " + "; ".join(f"{k} {sum(v)} of {len(v)} hit" for k, v in tally.items()), ""]
    out += ["### A/A · `cut8` re-run at DEPTH8-MEASURE's highest Q under 1.00", "",
            "| volume | Q | bytes here | bytes DEPTH8 | equal |", "| --- | --: | --: | --: | --- |"]
    for c in (r for r in rows if r["kind"] == "cell" and r["form"] == "cut8"):
        theirs = size([d for d in d8["cells"] if d["set"] == c["set"] and d["g"] == 1], "cut8", c["q"])
        out.append(f"| `{c['set']}` | {c['q']} | {sum(c['units'])} | {theirs} | "
                   f"{'yes' if theirs == sum(c['units']) else '**no: VOID**'} |")
    same = [s for s in series if s in d8["series"] and series[s]["sigma"] == d8["series"][s]["sigma"]]
    out += ["", f"σ per frame equal to DEPTH8-MEASURE's on {len(same)} of {len(series)} volumes."]
    return out


def c2(rows, series, d8):
    out = ["", "### C2 · a second picture (J1, J2)", "",
           "| volume | Q_A | bytes A | A's worst e_N ÷ σ | B: Q → worst e_N ÷ σ | B's highest Q ≤ 1.00 | ≤ 1.03 | "
           "(A + B) ÷ today's | J1 | clamped share | B chroma ≠ 128 |",
           "| --- | --: | --: | --: | --- | --: | --: | --: | --- | --: | --: |"]
    for a in (r for r in rows if r["kind"] == "picture_a"):
        s, sigma = a["set"], series[a["set"]]["sigma"]
        cells = [dict(r, form="b") for r in rows if r["kind"] == "cell" and r["set"] == s and r["qa"] == a["q"]]
        mine = [c for c in d8["cells"] if c["set"] == s and c["g"] == 1]
        q, _ = highest(cells, "b", sigma, BAR)
        q3, _ = highest(cells, "b", sigma, BAR_WIDE)
        qt, _ = highest(mine, today(series[s]["b"]), d8["series"][s]["sigma"], BAR)
        ratio = (sum(a["units"]) + size(cells, "b", q)) / size(mine, today(series[s]["b"]), qt) if q else None
        trail = ", ".join(f"{c['q']}: {max(ratios(c, sigma)):.3f}" for c in sorted(cells, key=lambda c: c["q"]))
        clamp = cells[0]["clamped"] / cells[0]["samples"] if cells else None
        out.append(f"| `{s}` | {a['q']} | {sum(a['units'])} | {max(ratios(a, sigma)):.2f} | {trail} | {fmt(q, '{}')} | "
                   f"{fmt(q3, '{}')} | {fmt(ratio)} | {'—' if ratio is None else ('hit' if 1.2 <= ratio <= 2.5 else 'miss')}"
                   f" | {fmt(clamp, '{:.1e}')} | {sum(c['chroma_off'] for c in cells)} |")
    return out


def busy(path):
    """Busy share of the host's CPUs over each minute, from /proc/stat's first line once a minute."""
    ticks = [[int(x) for x in line.split()[2:]] for line in path.open()] if path.exists() else []
    shares = []
    for a, b in zip(ticks, ticks[1:]):
        d = [y - x for x, y in zip(a, b)]
        shares.append(1 - (d[3] + d[4]) / sum(d))
    return shares


def main(d8_dir):
    pred = {v["set"]: v for v in json.loads((HERE / "predictions.json").read_text())["volumes"]}
    d8_rows = read(Path(d8_dir) / "stage-a.jsonl") + read(Path(d8_dir) / "stage-c.jsonl")
    d8 = dict(series={r["set"]: r for r in d8_rows if r["kind"] == "series"},
              cells=[r for r in d8_rows if r["kind"] == "cell"])
    rows1, rows2 = read(HERE / "rows/c1.jsonl"), read(HERE / "rows/c2.jsonl")
    series = {r["set"]: r for r in rows1 if r["kind"] == "series"}
    out = i1(rows1, series) + c1(rows1, series, d8, pred) + c2(rows2, series, d8)
    walls = [r["cell_wall"] for r in rows1 + rows2 if "cell_wall" in r]
    out += ["", "### Saturation", ""]
    for name in ("c1", "c2"):
        shares = busy(HERE / f"rows/{name}.cpu.txt")
        if shares:
            out.append(f"* {name}: busy share a minute median {st.median(shares):.2f}, lowest {min(shares):.2f}, "
                       f"over {len(shares)} minutes (`rows/{name}.cpu.txt`).")
    if walls:
        out.append(f"* Cells took {min(walls):.0f}–{max(walls):.0f} s wall each; no time is claimed.")
    print("\n".join(out))


if __name__ == "__main__":
    main(*sys.argv[1:])
