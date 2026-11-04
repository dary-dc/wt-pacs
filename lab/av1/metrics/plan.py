#!/usr/bin/env python3
"""The four shards of row METRICS: each series' CPU estimate from the bytes run's and this pilot's costs, the series
dealt largest first to the least-loaded shard — README.md §Shards. Writes plan.json and prints the table.

usage: plan.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LADDER = (1, 2, 4, 8, 12, 16, 24, 32, 40, 56)
GROUPS = (1, 8, 16)
ENCODE = {  # CPU s a megapixel at cpu6, one thread: the bytes run's DBT medians at 2, 8, 16, 32, 56, the pilot elsewhere
    1: {1: 1.10, 2: 1.174, 4: 0.80, 8: 0.947, 12: 0.75, 16: 0.696, 24: 0.40, 32: 0.318, 40: 0.25, 56: 0.154},
    8: {1: 0.72, 2: 0.650, 4: 0.74, 8: 0.551, 12: 0.39, 16: 0.295, 24: 0.16, 32: 0.161, 40: 0.14, 56: 0.096},
    16: {1: 0.68, 2: 0.611, 4: 0.70, 8: 0.543, 12: 0.37, 16: 0.277, 24: 0.15, 32: 0.145, 40: 0.13, 56: 0.093},
}
MEASURE, SERIES, LOSSLESS, VDP = 0.27, 0.30, 4.1, 2.0  # CPU s a megapixel: per cell, per series, controls, per VDP frame
ENCODE_MARGIN = 1.15  # the pilot coded up to 15 % over ENCODE at G 8 and 16 (README.md §8)
VDP_FRAMES = 8
SHARE_OF_BUDGET = 0.85
BUDGET = 4.5 * 3600 * 4

# name: (frames, height, width, channels, forms, sound)
SETS = {
    "dbts_a1": (56, 1142, 1785, 1, 3, True), "dbts_a2": (87, 1014, 2046, 1, 3, True),
    "dbts_a3": (43, 712, 2041, 1, 3, True), "dbts_a4": (69, 1131, 2223, 1, 3, True),
    "dbts_a5": (71, 845, 2241, 1, 3, True), "dbts_b1": (50, 2560, 3328, 1, 1, True),
    "dbts_b2": (71, 1890, 2457, 1, 1, True), "dbts_b3": (63, 1996, 2457, 1, 1, True),
    "dbts_b4": (84, 1996, 2457, 1, 1, True), "dbts_b5": (66, 1890, 2457, 1, 1, True),
    "dbts_c1": (69, 976, 2513, 1, 3, True), "dbts_c2": (56, 757, 2227, 1, 3, True),
    "dbts_c3": (70, 1147, 2585, 1, 3, True), "dbts_c4": (66, 662, 2227, 1, 3, True),
    "dbts_c5": (73, 955, 2100, 1, 3, True), "dbt10_ea1141": (24, 678, 1727, 1, 1, True),
    "dbt12_ea1141": (29, 614, 1359, 1, 3, True), "dbt12_c": (68, 931, 2124, 1, 3, True),
    "dbt10_d": (48, 757, 2336, 1, 1, True), "rf_fluoro": (18, 768, 768, 1, 3, True),
    "mr_ispy1": (58, 512, 512, 1, 3, True), "mr9_ispy2": (34, 320, 320, 1, 1, True),
    "ustrus_1": (280, 452, 452, 1, 1, True), "ustrus_2": (280, 452, 452, 1, 1, True),
    "usb_cine": (64, 512, 512, 1, 1, False), "usb_cine_rgb": (64, 512, 512, 3, 1, False),
    "us_liver": (70, 421, 760, 3, 1, False),
}


def cost(name):
    n, h, w, ch, forms, _ = SETS[name]
    mpx = n * h * w / 1e6
    coded = mpx * (1.5 if ch == 3 else 1)
    cells = sum(forms * (coded * ENCODE[g][q] * ENCODE_MARGIN + mpx * ch * MEASURE) for g in GROUPS for q in LADDER)
    seen = 0 if ch == 3 else len(GROUPS) * len(LADDER) * min(n, VDP_FRAMES) * min(h, 1024) * min(w, 1024) / 1e6 * VDP
    return cells + seen + mpx * ch * (SERIES + LOSSLESS)


def main():
    load = {k: [] for k in range(1, 5)}
    for name in sorted(SETS, key=cost, reverse=True):
        k = min(load, key=lambda s: sum(map(cost, load[s])))
        load[k].append(name)
    plan = {str(k): dict(sets=v, cpu_s=round(sum(map(cost, v))), wall_h=round(sum(map(cost, v)) / 4 / 3600, 2))
            for k, v in load.items()}
    assert all(p["cpu_s"] <= SHARE_OF_BUDGET * BUDGET for p in plan.values()), plan
    (HERE / "plan.json").write_text(json.dumps(dict(ladder=LADDER, groups=GROUPS, shards=plan), indent=1) + "\n")
    print("| shard | series | Q | G | CPU s (est.) | wall h on 4 cores (est.) |\n| --- | --- | --- | --- | --: | --: |")
    for k, p in plan.items():
        names = ", ".join(f"`{s}`" for s in p["sets"])
        print(f"| {k} | {names} | {', '.join(map(str, LADDER))} | {', '.join(map(str, GROUPS))} | {p['cpu_s']} | {p['wall_h']} |")
    for name in sorted(SETS, key=cost, reverse=True):
        print(name, round(cost(name)))


if __name__ == "__main__":
    main()
