#!/usr/bin/env python3
"""Row METRICS' collector (README.md §Collector): the four shards' rows into per-cell summaries, the curves, the
knees and the two anchors, as markdown; refuses a missing cell unless --partial.

usage: collect.py ROWS.jsonl ... [--partial] [--tsv CURVES.tsv] [--svg DIR]
"""
import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PROVISIONAL = {"usb_cine", "usb_cine_rgb", "us_liver"}


def load(paths):
    series, cells, controls = {}, {}, defaultdict(dict)
    for p in paths:
        for line in Path(p).open():
            r = json.loads(line)
            if r["kind"] == "series":
                series[r["set"]] = r
            elif r["kind"] == "cell":
                cells[(r["set"], r["form"], r["q"], "whole" if r["whole"] else r["g"])] = r
            else:
                controls[r["set"]][r["codec"]] = sum(r["bytes"])
    return series, cells, controls


def missing(plan, series, cells, controls):
    out = []
    for shard in plan["shards"].values():
        for name in shard["sets"]:
            if name not in series:
                out.append((name, "series"))
                continue
            forms = {f for (s, f, _, _) in cells if s == name} or {"?"}
            out += [(name, c) for c in ("htj2k", "av1") if c not in controls.get(name, {})]
            out += [(name, f, q, g) for f in forms for q in plan["ladder"] for g in plan["groups"]
                    if (name, f, q, g) not in cells]
    return out


def pct(a, p):
    return float(np.percentile(np.asarray(a, float), p))


def summary(s, r):
    """One cell's frame distributions, each read as the protocol names them."""
    f = r["frames"]
    peak = (1 << s["b"]) - 1
    psnr = [10 * math.log10(peak * peak / x["mse"]) if x["mse"] else math.inf for x in f]
    sig = np.asarray(s["sigma"], float)
    e_in = np.sqrt([x["mse_in"] if x["mse_in"] is not None else np.nan for x in f])
    e_nb = np.asarray([x["err_noise_band"] for x in f])
    step = np.minimum(np.r_[s["step_band"][:1], s["step_band"]], np.r_[s["step_band"], s["step_band"][-1:]])
    step_full = np.minimum(np.r_[s["step"][:1], s["step"]], np.r_[s["step"], s["step"][-1:]])
    samples = s["frames"] * s["width"] * s["height"] * s["channels"]
    out = dict(bytes=sum(r["units"]), ratio=s["bits_stored"] * samples / (8 * sum(r["units"])),
               psnr_med=pct(psnr, 50), psnr_p5=pct(psnr, 5), psnr_p1=pct(psnr, 1), psnr_min=min(psnr),
               max_abs=max(x["max_abs"] for x in f), max_abs_p99=pct([x["max_abs"] for x in f], 99),
               ssim_med=pct([x["ssim"] for x in f], 50), ssim_min=min(x["ssim"] for x in f),
               ms_ssim_med=pct([x["ms_ssim"] for x in f], 50), ms_ssim_min=min(x["ms_ssim"] for x in f),
               e_sigma_med=pct(e_in / sig, 50), e_sigma_max=float(np.nanmax(e_in / sig)),
               nb_sigma_med=pct(e_nb / sig, 50), nb_sigma_p95=pct(e_nb / sig, 95), nb_sigma_max=float(np.max(e_nb / sig)),
               scroll_med=pct([x["err_band"] for x in f] / step, 50),
               scroll_max=float(np.max([x["err_band"] for x in f] / step)),
               scroll_full_max=float(np.max(np.sqrt([x["mse"] for x in f]) / step_full)),
               jod=(r.get("vdp") or {}).get("jod"), encode_cpu=r["encode_cpu"], mpx=r["mpx"])
    for w in range(len(f[0]["codes"])):
        share = lambda k: [x["codes"][w][k] / max(x["codes"][w]["n"], 1) for x in f]
        out[f"w{w}"] = dict(ge1_med=pct(share("ge1"), 50), ge1_max=max(share("ge1")), ge2_max=max(share("ge2")),
                            ge4_max=max(share("ge4")), max=max(x["codes"][w]["max"] for x in f))
    return out


def knee(points, key, pick=max):
    """The rung farthest from the chord joining the curve's two ends, ln bytes and the metric each scaled to 0 … 1
    (README.md §5 c): where the curve bends most, whichever way the metric saturates."""
    pts = sorted((math.log(p["bytes"]), p[key], p["q"]) for p in points if p[key] is not None and math.isfinite(p[key]))
    if len(pts) < 3:
        return None
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    unit = lambda v, lo, hi: (v - lo) / ((hi - lo) or 1)
    xy = [(unit(x, min(xs), max(xs)), unit(y, min(ys), max(ys)), q) for x, y, q in pts]
    (x0, y0, _), (x1, y1, _) = xy[0], xy[-1]
    far = lambda p: abs((y1 - y0) * p[0] - (x1 - x0) * p[1] + x1 * y0 - y1 * x0)
    best = pick(xy[1:-1], key=far)
    return best[2] if far(best) > 0 else None


def highest(points, test):
    """The largest Q whose cell, and every cell below it, passes test — the end of the run from the bottom rung."""
    out = None
    for p in sorted(points, key=lambda p: p["q"]):
        if not test(p):
            break
        out = p["q"]
    return out


def report(series, cells, controls):
    by = defaultdict(list)
    for (name, form, q, g), r in cells.items():
        by[(name, form, g)].append(dict(q=q, **summary(series[name], r)))
    lines = ["| series, form | G | Q | ratio | PSNR med / p5 / min dB | max \\|Δ\\| | SSIM med / min | MS-SSIM med / min "
             "| e ÷ σ med (noise band med / max) | window 1: ≥1 level med / max, ≥2 max, ≥4 max, max | scroll med / max "
             "| JOD |", "| --- | --: | --: | --: | --- | --: | --- | --- | --- | --- | --- | --: |"]
    knees, anchors = [], []
    for (name, form, g), pts in sorted(by.items(), key=lambda kv: (kv[0][0], kv[0][1], str(kv[0][2]))):
        tag = f"`{name}`{' (provisional)' if name in PROVISIONAL else ''} {form}"
        for p in sorted(pts, key=lambda p: p["q"]):
            w = p["w0"]
            lines.append(
                f"| {tag} | {g} | {p['q']} | {p['ratio']:.1f} | {p['psnr_med']:.2f} / {p['psnr_p5']:.2f} / "
                f"{p['psnr_min']:.2f} | {p['max_abs']} | {p['ssim_med']:.4f} / {p['ssim_min']:.4f} | "
                f"{p['ms_ssim_med']:.4f} / {p['ms_ssim_min']:.4f} | {p['e_sigma_med']:.2f} ({p['nb_sigma_med']:.2f} / "
                f"{p['nb_sigma_max']:.2f}) | {100 * w['ge1_med']:.1f} / {100 * w['ge1_max']:.1f} %, {100 * w['ge2_max']:.1f} %, "
                f"{100 * w['ge4_max']:.1f} %, {w['max']} | {p['scroll_med']:.2f} / {p['scroll_max']:.2f} | "
                f"{'—' if p['jod'] is None else round(p['jod'], 2)} |")
        for p in pts:
            p["ssim_db"] = -10 * math.log10(max(1 - p["ms_ssim_med"], 1e-12))
            p["ge1"] = 100 * p["w0"]["ge1_med"]
        knees.append(f"| {tag} | {g} | " + " | ".join(str(knee(pts, k)) for k in
                                                     ("psnr_med", "ssim_db", "nb_sigma_med", "ge1", "jod")) + " |")
        windows = [k for k in pts[0] if k.startswith("w")]
        anchors.append(
            f"| {tag} | {g} | {highest(pts, lambda p: p['nb_sigma_max'] <= 1)} | "
            f"{highest(pts, lambda p: p['e_sigma_max'] <= 1)} | "
            f"{highest(pts, lambda p: all(p[w]['max'] <= 1 for w in windows))} | "
            f"{highest(pts, lambda p: p['scroll_max'] < 1)} | {highest(pts, lambda p: p['scroll_full_max'] < 1)} |")
    out = ["#### Every cell", "", *lines, "", "#### Knees: the rung farthest from each curve's chord (metric against ln bytes, both scaled 0 … 1)", "",
           "| series, form | G | PSNR | MS-SSIM (dB of 1 − MS-SSIM) | noise-band e ÷ σ | ≥ 1 level | JOD |",
           "| --- | --: | --: | --: | --: | --: | --: |", *knees, "", "#### Anchors: the highest Q from Q 1 up at which "
           "every frame holds", "", "| series, form | G | noise-band e ≤ σ | e ≤ σ | every window ≤ 1 level | scroll, band "
           "< step | scroll, full < step |", "| --- | --: | --: | --: | --: | --: | --: |", *anchors, "",
           "#### Controls", "", "| series | HTJ2K B | lossless AV1 G 1 B | ratio HTJ2K | ratio AV1 |", "| --- | --: | --: | --: | --: |"]
    for name, c in sorted(controls.items()):
        s = series.get(name)
        bits = s["bits_stored"] * s["frames"] * s["width"] * s["height"] * s["channels"] if s else None
        out.append(f"| `{name}` | {c.get('htj2k', '—')} | {c.get('av1', '—')} | "
                   f"{bits / 8 / c['htj2k']:.2f} | {bits / 8 / c['av1']:.2f} |" if s and len(c) == 2 else
                   f"| `{name}` | {c.get('htj2k', '—')} | {c.get('av1', '—')} | — | — |")
    return "\n".join(out), by


CURVES = {"psnr_med": "median PSNR, dB", "ssim_db": "MS-SSIM, dB of 1 − MS-SSIM", "nb_sigma_med": "median e_N ÷ σ",
          "ge1": "median % moved ≥ 1 level", "jod": "JOD"}


def group(name):
    return {"dbts_a": "system A", "dbts_b": "system B", "dbts_c": "system C"}.get(name[:6], "other sets")


def svg(by, out):
    """One plot per (group, metric): ln bytes on x, the metric on y; each series' stored form, G 1 solid, G 16 dashed."""
    out.mkdir(parents=True, exist_ok=True)
    stored = {}
    for name, form, g in by:
        stored.setdefault(name, form)
    for grp in sorted({group(n) for n in stored}):
        for key, label in CURVES.items():
            lines = []
            for (name, form, g), pts in by.items():
                if group(name) != grp or form != stored[name] or g not in (1, 16):
                    continue
                xy = [(math.log(p["bytes"]), p[key]) for p in sorted(pts, key=lambda p: p["q"])
                      if p[key] is not None and math.isfinite(p[key])]
                lines.append((name, g, xy))
            xs = [x for _, _, l in lines for x, _ in l]
            ys = [y for _, _, l in lines for _, y in l]
            if not xs:
                continue
            sx = lambda x: 60 + 520 * (x - min(xs)) / ((max(xs) - min(xs)) or 1)
            sy = lambda y: 340 - 300 * (y - min(ys)) / ((max(ys) - min(ys)) or 1)
            dash = {1: "", 16: ' stroke-dasharray="5 3"'}
            body = [f'<polyline fill="none" stroke="hsl({(37 * i) % 360},60%,40%)" stroke-width="1.5"{dash[g]} points="'
                    + " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in l) + f'"><title>{n} G {g}</title></polyline>'
                    for i, (n, g, l) in enumerate(sorted(lines))]
            text = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 380" font-size="11">'
                    f'<rect width="600" height="380" fill="white"/><text x="60" y="20">{grp}: {label} against ln bytes '
                    f'({min(xs):.1f} … {max(xs):.1f}); y {min(ys):.3g} … {max(ys):.3g}; G 16 dashed</text>'
                    + "".join(body) + "</svg>")
            (out / f"{grp.replace(' ', '-')}-{key}.svg").write_text(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows", nargs="+")
    ap.add_argument("--partial", action="store_true")
    ap.add_argument("--tsv", type=Path)
    ap.add_argument("--svg", type=Path)
    a = ap.parse_args()
    series, cells, controls = load(a.rows)
    plan = json.loads((HERE / "plan.json").read_text())
    gaps = missing(plan, series, cells, controls)
    if gaps and not a.partial:
        raise SystemExit(f"{len(gaps)} missing, first {gaps[:5]}; --partial reports what is there")
    text, by = report(series, cells, controls)
    print(text)
    if a.svg:
        svg(by, a.svg)
    if a.tsv:
        keys = ["bytes", "ratio", "psnr_med", "psnr_min", "ssim_med", "ms_ssim_med", "nb_sigma_med", "scroll_max", "jod"]
        with a.tsv.open("w") as fh:
            fh.write("\t".join(["set", "form", "g", "q", *keys]) + "\n")
            for (name, form, g), pts in sorted(by.items(), key=lambda kv: (kv[0][0], kv[0][1], str(kv[0][2]))):
                for p in sorted(pts, key=lambda p: p["q"]):
                    fh.write("\t".join(map(str, [name, form, g, p["q"], *(p[k] for k in keys)])) + "\n")


if __name__ == "__main__":
    main()
