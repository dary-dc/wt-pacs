#!/usr/bin/env python3
"""Stage 1's table for the quality shapes from stage1.py's and stage0.mjs's rows: per set and shape, layer 1's bytes,
the whole's, layer 1's quality at full size and display scale, the frames at the proxy; then each set's operating points.

usage: summary1.py WORK/<set> ... [--json OUT]
"""
import json
import math
import sys
from pathlib import Path

PROXY = 0.99


def psnr(sse, n, peak):
    return math.inf if sse == 0 else 10 * math.log10(peak * peak * n / sse)


def at_proxy(m):
    return all(w["in"] == 0 or (w["in"] - w["over1"]) / w["in"] >= PROXY for w in m["windows"])


def worst_window(ms):
    """The window under which the most in-window codes differ, over the series: shares differing, by > 1, max |Δcode|."""
    k = len(ms[0]["windows"])
    best = None
    for j in range(k):
        n = sum(m["windows"][j]["in"] for m in ms)
        d = sum(m["windows"][j]["differ"] for m in ms) / max(n, 1)
        o = sum(m["windows"][j]["over1"] for m in ms) / max(n, 1)
        c = max(m["windows"][j]["maxCode"] for m in ms)
        if best is None or o > best[1]:
            best = (d, o, c)
    return best


def quality(ms, peak):
    p = [psnr(m["sse"], m["n"], peak) for m in ms]
    pin = [psnr(m["sseIn"], m["nIn"], peak) for m in ms if m["nIn"]]
    d, o, c = worst_window(ms)
    return {"psnr": psnr(sum(m["sse"] for m in ms), sum(m["n"] for m in ms), peak), "psnrWorst": min(p),
            "psnrIn": psnr(sum(m["sseIn"] for m in ms), sum(m["nIn"] for m in ms), peak) if pin else None,
            "maxAbs": max(m["maxAbs"] for m in ms), "ssim": sum(m["ssim"] for m in ms) / len(ms),
            "ssimWorst": min(m["ssim"] for m in ms),
            "ssimIn": (sum(m["ssimIn"] for m in ms if m["ssimIn"] is not None) / max(1, sum(m["ssimIn"] is not None for m in ms))),
            "differ": d, "over1": o, "maxCode": c, "atProxy": sum(at_proxy(m) for m in ms)}


def summarise(d):
    rows = [json.loads(x) for x in (d / "stage1.jsonl").read_text().splitlines()]
    checks = {json.loads(x)["file"]: json.loads(x) for x in (d / "stage0.jsonl").read_text().splitlines()} \
        if (d / "stage0.jsonl").exists() else {}
    meta = json.loads((Path("lab/av1/data") / d.name / "metadata.json").read_text()) \
        if (Path("lab/av1/data") / d.name / "metadata.json").exists() else {}
    peak = (1 << meta.get("bitsStored", 16)) - 1
    out = []
    for shape in dict.fromkeys(r["shape"] for r in rows):
        rs = [r for r in rows if r["shape"] == shape]
        today = sum(r["today"] for r in rs)
        share = [r["layer1"] / r["today"] for r in rs]
        cs = [checks.get(f"{r['frame']:03d}/{shape}.j2c") for r in rs]
        out.append({"set": d.name, "shape": shape, "frames": len(rs),
                    "layer1": sum(r["layer1"] for r in rs) / today, "layer1Min": min(share), "layer1Max": max(share),
                    "whole": sum(r["total"] for r in rs) / today,
                    "wholeMin": min(r["total"] / r["today"] for r in rs), "wholeMax": max(r["total"] / r["today"] for r in rs),
                    "opj": sum(r["opjLayer1"] for r in rs),
                    "checked": sum(bool(c and c["whole"] and c["layer1"]) for c in cs),
                    "prefixAtLayerEnd": sum(bool(c and c["smallest"] == c["layerEnd"] and c["shortFails"]) for c in cs),
                    "full": quality([r["full"] for r in rs], peak),
                    "display": quality([r["fullDisplay"] for r in rs], peak)})
    return out


def operating_points(rows):
    """Per set: the smallest and the largest p of two sets at >= 40 dB (series PSNR, full size), and the largest p
    with every frame at the proxy at full size."""
    out = {}
    for s in dict.fromkeys(r["set"] for r in rows):
        two = [r for r in rows if r["set"] == s and r["shape"].startswith("twosets")]
        at40 = [int(r["shape"][7:]) for r in two if r["full"]["psnr"] >= 40]
        prox = [int(r["shape"][7:]) for r in two if r["full"]["atProxy"] == r["frames"]]
        out[s] = {"smallestAt40": min(at40, default=None), "largestAt40": max(at40, default=None),
                  "largestAtProxy": max(prox, default=None)}
    return out


def fmt(x, nd=1):
    return "—" if x is None else ("∞" if x == math.inf else f"{x:.{nd}f}")


def main():
    args = sys.argv[1:]
    js = args[args.index("--json") + 1] if "--json" in args else None
    dirs = [Path(a) for a in args if a != "--json" and a != js]
    rows = [r for d in dirs for r in summarise(d)]
    print("| set | shape | frames | layer 1 ÷ today, % (series; frames) | whole ÷ today | checked · prefix at layer end · OpenJPEG layer 1 "
          "| full size: PSNR series; worst · PSNR in-window · max abs · SSIM; worst | full size, worst window: codes differ · by > 1 · max | "
          "display scale: PSNR · SSIM · codes by > 1 | frames at the proxy: full · display |")
    print("| --- | --- | --: | --- | --- | --- | --- | --- | --- | --- |")
    for r in rows:
        f, d = r["full"], r["display"]
        print(f"| `{r['set']}` | {r['shape']} | {r['frames']} | {100 * r['layer1']:.1f}; {100 * r['layer1Min']:.1f}–{100 * r['layer1Max']:.1f} "
              f"| ×{r['whole']:.3f} | {r['checked']} · {r['prefixAtLayerEnd']} · {r['opj']} "
              f"| {fmt(f['psnr'])}; {fmt(f['psnrWorst'])} · {fmt(f['psnrIn'])} · {f['maxAbs']:.0f} · {f['ssim']:.4f}; {f['ssimWorst']:.4f} "
              f"| {100 * f['differ']:.1f} % · {100 * f['over1']:.2f} % · {f['maxCode']:.0f} "
              f"| {fmt(d['psnr'])} · {d['ssim']:.4f} · {100 * d['over1']:.2f} % | {f['atProxy']} · {d['atProxy']} |")
    ops = operating_points(rows)
    print("\n| set | smallest p at ≥ 40 dB | largest p at ≥ 40 dB | largest p, every frame at the proxy |")
    print("| --- | --: | --: | --: |")
    for s, o in ops.items():
        print(f"| `{s}` | {fmt(o['smallestAt40'], 0)} | {fmt(o['largestAt40'], 0)} | {fmt(o['largestAtProxy'], 0)} |")
    if js:
        Path(js).write_text(json.dumps({"rows": rows, "operatingPoints": ops}, indent=1))


if __name__ == "__main__":
    main()
