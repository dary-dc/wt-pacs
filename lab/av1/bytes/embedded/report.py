#!/usr/bin/env python3
"""EMBED's bytes and quality tables, from encode.py's manifest and layers.mjs's prefixes.

Bytes are over the served HTJ2K series'; PSNR is the mean over frames (the minimum frame in
parentheses) against the source, peak 2^B − 1 for the B bits the series' range needs.

With time.mjs's rows, the decode table too: ms a frame as the median over rounds [range], and each
arm over OpenJPH's exact decode as the median of the rounds' paired ratios.

usage: report.py WORK [ROWS.json]   — lab/av1/bytes/embedded/README.md
"""
import json
import statistics
import sys
from pathlib import Path

ARMS = ("htj2k", "j2k layer 1", "j2k all", "jxl-prog first picture", "jxl-prog all", "jxl all")


def main():
    work = Path(sys.argv[1])
    manifest = json.loads((work / "manifest.json").read_text())
    found = {r["name"]: r for r in json.loads((work / "layers.json").read_text())}
    rates = manifest["rates"]
    print("| set | J2K 1 layer | J2K layered | JPEG XL | JPEG XL progressive | "
          + " | ".join(f"J2K layer {k + 1} (÷{r})" for k, r in enumerate(rates)) + " | JPEG XL progressive, first picture |")
    print("| --- " * (6 + len(rates)) + "|")
    for s in manifest["sets"]:
        f = found[s["name"]]
        ht = sum(s["sizes"]["htj2k"])
        whole = [sum(s["sizes"][c]) / ht for c in ("j2k", "j2k-layers", "jxl", "jxl-prog")]

        def cell(entries):
            b = sum(e["bytes"] for e in entries) / ht
            p = [e["psnr"] for e in entries]
            return f"{b:.4f} · {sum(p) / len(p):.1f} ({min(p):.1f}) · {max(e['max'] for e in entries)}"

        layers = [cell([fr[k] for fr in f["layers"]]) for k in range(len(rates))]
        first = cell([j["first"] for j in f["jxl"]["jxl-prog"]])
        drawn = [sum("none" not in j["atLayers"][k] for j in f["jxl"]["jxl-prog"]) for k in range(len(rates))]
        print(f"| `{s['name']}` | " + " | ".join(f"{w:.3f}" for w in whole) + " | " + " | ".join(layers)
              + f" | {first} |")
        if any(drawn):
            print(f"<!-- {s['name']}: JPEG XL progressive draws a picture at J2K layer budgets in {drawn} frames -->")

    if len(sys.argv) > 2:
        timing(manifest, json.loads(Path(sys.argv[2]).read_text()))


def timing(manifest, rows):
    throttles = sorted({r["throttle"] for r in rows})
    exact = sum(r["exact"] for r in rows), sum(r["frames"] for r in rows)
    print(f"\nframes exact {exact[0]}/{exact[1]}; rounds {len({r['round'] for r in rows})}")
    print("| set | arm | " + " | ".join(f"{t}× ms" for t in throttles) + " | "
          + " | ".join(f"{t}× ÷ HTJ2K" for t in throttles) + " |")
    print("| --- " * (2 + 2 * len(throttles)) + "|")
    for s in manifest["sets"]:
        for arm in ARMS:
            ms, ratio = [], []
            for t in throttles:
                mine = {r["round"]: r["ms"] / r["frames"] for r in rows
                        if r["set"] == s["name"] and r["arm"] == arm and r["throttle"] == t}
                base = {r["round"]: r["ms"] / r["frames"] for r in rows
                        if r["set"] == s["name"] and r["arm"] == "htj2k" and r["throttle"] == t}
                v = list(mine.values())
                ms.append(f"{statistics.median(v):.1f} [{min(v):.1f}–{max(v):.1f}]")
                ratio.append(f"{statistics.median(mine[k] / base[k] for k in mine):.2f}")
            print(f"| `{s['name']}` | {arm} | " + " | ".join(ms) + " | " + " | ".join(ratio) + " |")


if __name__ == "__main__":
    main()
