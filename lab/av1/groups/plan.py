#!/usr/bin/env python3
"""Every cell of the groups protocol per series and shard (docs/av1/groups.md §5, §Shards), and each shard re-estimated
from the pilot's CPU seconds a megapixel per arm and its peak resident memory (§9). Writes plan.json.

usage: plan.py [rows/groups-pilot.jsonl]
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
LADDER = (2, 4, 6, 8, 10, 12, 16, 24)
CLIP_LADDER = (4, 8, 12, 16, 24)
NOISE_PROXY_Q = 32
DBT = ("dbts_a1", "dbts_b1", "dbts_c1")
TRUS = ("ustrus_1", "ustrus_2")
CLIPS = ("usb_cine", "usb_cine_rgb", "us_liver")
PILOT = "dbt12_ea1141"
SHARDS = {"1": (PILOT, "dbts_b1", *CLIPS), "2": ("dbts_a1", "dbts_c1", *TRUS)}
MIDDLE = {"dbts_b1": 32}
TIMED = {("O", 1), ("O", 16), ("O", 32), ("AT", 16), ("AT", 32), ("AD", 16)}
GREY = {PILOT, *DBT, *TRUS, "usb_cine"}
MPX = {PILOT: 29 * 614 * 1359, "dbts_a1": 56 * 1142 * 1785, "dbts_b1": 32 * 2560 * 3328, "dbts_c1": 69 * 976 * 2513,
       "ustrus_1": 280 * 452 * 452, "ustrus_2": 280 * 452 * 452, "usb_cine": 64 * 512 * 512,
       "usb_cine_rgb": 64 * 512 * 512 * 1.5, "us_liver": 70 * 421 * 760 * 1.5}
FRAME_MPX = {PILOT: 614 * 1359, "dbts_b1": 2560 * 3328, "dbts_a1": 1142 * 1785, "dbts_c1": 976 * 2513,
             "ustrus_1": 452 * 452, "ustrus_2": 452 * 452, "usb_cine": 512 * 512, "usb_cine_rgb": 512 * 512 * 1.5,
             "us_liver": 421 * 760 * 1.5}
LAST = {"O3", "AT3"}
MEMORY_GB, IN_FLIGHT = 12, 4


def cell(arm, g, q, src="real"):
    return dict(arm=arm, g=g, q=q, src=src)


def cells(name):
    """(arm, G, Q, source) per §5; the noise proxy's own cell (O G 1 at Q 32 on the real source) comes first."""
    out = [cell("O", 1, NOISE_PROXY_Q)]
    if name == PILOT:
        out += [cell(a, 1 if a == "I" else 16, 8) for a in ("O", "L", "A", "AT", "AD", "AQ", "I", "R", "O3", "AT3")]
        out += [cell("O", 1, 8)] + [cell("O", 16, 8, s) for s in "SXC"]
    elif name in DBT:
        out += [cell("O", g, q) for g in (1, 8, 16, 32) for q in LADDER]
        out += [cell(a, g, q) for a, g in (("A", 16), ("AT", 16), ("AT", 32), ("AD", 16), ("AQ", 16)) for q in LADDER]
        out += [cell(a, g, q) for a, g in (("L", 16), ("R", 16), ("I", 1)) for q in (4, 8, 12)]
        out += [cell("O", g, q, s) for s in "SXC" for g in (1, 16) for q in (4, 8, 12)]
        out += [cell("O3", 1, 8), cell("O3", 16, 8), cell("AT3", 16, 8)]
    elif name in TRUS:
        out += [cell(a, g, q) for a, g in (("O", 1), ("O", 16), ("O", 32), ("AT", 16), ("AT", 32), ("AD", 16))
                for q in LADDER]
    else:
        out += [cell(a, g, q) for a, g in (("O", 1), ("O", 16), ("AT", 16)) for q in CLIP_LADDER]
    for c in out:
        c.update(bands=c["arm"] == "O" or (c["arm"], c["g"]) == ("AT", 16), keep=(c["arm"], c["g"]) in TIMED,
                 vdp=name in GREY and c["src"] == "real" and c["q"] != NOISE_PROXY_Q)
    return out


SETTINGS_LADDER = {"dbts_b1": (6, 7, 8, 9, 10, 11, 12, 14), "dbts_a1": tuple(range(4, 13)), "dbts_c1": tuple(range(4, 13))}
SETTINGS_STREAMS = [("O", 1), ("O", 8), ("O", 16), ("O", 32), ("AT", 8), ("AT", 16), ("AT", 32), ("AF", 8),
                    ("AF", 16), ("AF", 32), ("AD", 16), ("AU", 16), ("AW", 16)]
SETTINGS_TIMED = {("O", 1), ("O", 8), ("O", 16), ("AT", 16), ("AF", 16), ("AU", 16)}
SHARDS.update({"settings-1": ("dbts_b1",), "settings-2": ("dbts_a1", "dbts_c1")})
CUT_FORM = {"dbts_a1", "dbts_c1"}


def settings_cells(name, ladder=None):
    """The settings amendment's cells (docs/av1/groups.md §S4), the noise proxy first."""
    form = "cut" if name in CUT_FORM else None
    out = [cell("O", 1, NOISE_PROXY_Q)] + [cell(a, g, q) for a, g in SETTINGS_STREAMS
                                            for q in ladder or SETTINGS_LADDER[name]]
    for c in out:
        c.update(form=form, per_group=form == "cut" and c["g"] > 1, bands=False,
                 keep=(c["arm"], c["g"]) in SETTINGS_TIMED, vdp=c["q"] != NOISE_PROXY_Q)
    return out


def key(set_name, c):
    return f"{set_name}|{c['arm']}|G{c['g']}|Q{c['q']}|{c['src']}"


def main():
    pilot = [json.loads(r) for r in open(sys.argv[1])] if len(sys.argv) > 1 else []
    cost, rss = defaultdict(list), defaultdict(list)
    for r in pilot:
        if r["kind"] == "cell":
            cost[r["arm"]].append(r["cell_cpu"] / r["mpx"])
            rss[r["arm"]].append(r["encode_rss_kb"] / 1e6 / (FRAME_MPX[PILOT] / 1e6))
    plan = dict(ladder=LADDER, shards={}, rss_gb_per_frame_mpx={a: round(max(v), 3) for a, v in rss.items()})
    print("| shard | series | cells | CPU s (est.) | encode h on 4 cores (est.) | ARF cells in flight |")
    print("| --- | --- | --: | --: | --: | --- |")
    for k, names in SHARDS.items():
        cpu, flights = 0.0, {}
        for n in names:
            for c in cells(n):
                per = max(cost.get(c["arm"], [1.0]))
                cpu += per * MPX[n] / 1e6 * (0.55 if c["src"] != "real" else 1)
            gb = max(rss.get("AD", [0]) + rss.get("AQ", [0]) + rss.get("AT", [0])) * FRAME_MPX.get(n, 0.3e6) / 1e6
            flights[n] = max(1, min(IN_FLIGHT, int(MEMORY_GB // gb))) if gb else IN_FLIGHT
        plan["shards"][k] = dict(sets=list(names), cells={n: [key(n, c) for c in cells(n)] for n in names},
                                 lookahead_in_flight=flights, cpu_s=round(cpu))
        print(f"| {k} | {', '.join(names)} | {sum(len(cells(n)) for n in names)} | {cpu:.0f} | {cpu / 4 / 3600:.2f} "
              f"| {', '.join(f'{n} {v}' for n, v in flights.items())} |")
    for a in sorted(cost):
        print(f"{a}: {max(cost[a]):.2f} CPU s/Mpx, peak {max(rss[a]):.2f} GB per frame-Mpx")
    (HERE / "plan.json").write_text(json.dumps(plan, indent=1) + "\n")


if __name__ == "__main__":
    main()
