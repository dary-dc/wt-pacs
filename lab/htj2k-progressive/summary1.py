#!/usr/bin/env python3
"""Stage 1's tables from each set's metrics.jsonl: bytes per level prefix, and quality at full size and at display
scale. A frame meets the visually lossless proxy when, under every header window (as stored where there is none), its
in-window codes are within ±1 of the exact frame's on ≥ 99 % of in-window samples. lab/htj2k-progressive/README.md

usage: summary1.py LADDER SET ... [--json OUT]
"""
import json
import math
import sys
from pathlib import Path

PROXY = 0.99


def psnr(sse, n, peak):
    return math.inf if sse == 0 else 10 * math.log10(peak * peak * n / sse)


def proxy(c):
    return all(w["in"] == 0 or (w["in"] - w["over1"]) / w["in"] >= PROXY for w in c["windows"])


def worst(c, k):
    return max((w[k] / w["in"] if w["in"] else 0.0) for w in c["windows"])


def level_rows(work, name):
    lad = json.loads((work / name / "ladder.json").read_text())
    peak = (1 << lad["bits"]) - 1
    rows = [json.loads(line) for line in open(work / name / "metrics.jsonl")]
    out = []
    for r in lad["levels"]:
        rs = [x for x in rows if x["level"] == r]
        share = [x["prefix"] / x["whole"] for x in rs]
        row = dict(set=name, level=r, fit=lad["levelFit"], frames=len(rs), bits=lad["bits"],
                   prefixBytes=sum(x["prefix"] for x in rs), wholeBytes=sum(x["whole"] for x in rs),
                   shareMin=min(share), shareMax=max(share))
        for key in ("full", "fullDisplay", "reducedDisplay"):
            cs = [x[key] for x in rs]
            n_in = sum(c["nIn"] for c in cs)
            row[key] = dict(
                psnr=psnr(sum(c["sse"] for c in cs), sum(c["n"] for c in cs), peak),
                psnrWorst=min(psnr(c["sse"], c["n"], peak) for c in cs),
                psnrIn=psnr(sum(c["sseIn"] for c in cs), n_in, peak) if n_in else None,
                maxAbs=max(c["maxAbs"] for c in cs),
                ssim=sum(c["ssim"] for c in cs) / len(cs), ssimMin=min(c["ssim"] for c in cs),
                ssimIn=(sum(c["ssimIn"] for c in cs if c["ssimIn"] is not None) / len(cs)),
                differ=max(worst(c, "differ") for c in cs), over1=max(worst(c, "over1") for c in cs),
                maxCode=max(w["maxCode"] for c in cs for w in c["windows"]),
                proxy=sum(proxy(c) for c in cs) / len(cs), windows=len(cs[0]["windows"]))
        out.append(row)
    return out


def fmt(v, d=1):
    return "∞" if v == math.inf else f"{v:.{d}f}"


def main():
    work, *names = sys.argv[1:]
    js = None
    if "--json" in names:
        js = names[names.index("--json") + 1]
        names = names[:names.index("--json")]
    rows = [r for n in names for r in level_rows(Path(work), n)]
    print("| set | level | prefix share of the frame | of the series | (r, 0) full size: PSNR series · worst · in-window dB "
          "| max \\|Δ\\| | SSIM mean · min | worst window: codes differing · > 1 · max | frames at the proxy, full size "
          "| at display scale, (r, r) · (r, 0) |")
    print("| --- | --: | --- | --: | --- | --: | --- | --- | --: | --- |")
    for r in rows:
        f, rd, fd = r["full"], r["reducedDisplay"], r["fullDisplay"]
        print(f"| `{r['set']}` | {r['level']}{' (fit)' if r['level'] == r['fit'] else ''} "
              f"| {100 * r['shareMin']:.2f}–{100 * r['shareMax']:.2f} % | {100 * r['prefixBytes'] / r['wholeBytes']:.2f} % "
              f"| {fmt(f['psnr'])} · {fmt(f['psnrWorst'])} · {fmt(f['psnrIn']) if f['psnrIn'] else '—'} | {f['maxAbs']:.0f} "
              f"| {f['ssim']:.4f} · {f['ssimMin']:.4f} | {100 * f['differ']:.1f} · {100 * f['over1']:.1f} % · {f['maxCode']:.0f} "
              f"| {100 * f['proxy']:.0f} % | {100 * rd['proxy']:.0f} · {100 * fd['proxy']:.0f} % |")
    print("\n| set | level | at display scale (r, r): PSNR · in-window dB | SSIM | worst window: differing · > 1 · max "
          "| (r, 0): PSNR · in-window dB | SSIM | worst window: differing · > 1 · max |")
    print("| --- | --: | --- | --: | --- | --- | --: | --- |")
    for r in rows:
        cells = []
        for k in ("reducedDisplay", "fullDisplay"):
            d = r[k]
            cells.append(f"{fmt(d['psnr'])} · {fmt(d['psnrIn']) if d['psnrIn'] else '—'} | {d['ssim']:.4f} "
                         f"| {100 * d['differ']:.1f} · {100 * d['over1']:.1f} % · {d['maxCode']:.0f}")
        print(f"| `{r['set']}` | {r['level']}{' (fit)' if r['level'] == r['fit'] else ''} | {' | '.join(cells)} |")
    if js:
        Path(js).write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
