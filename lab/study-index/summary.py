#!/usr/bin/env python3
"""README §Results' tables from results/*.jsonl.

usage: summary.py RESULTS_DIR
"""
import collections
import gzip
import json
import math
import os
import sys

ARMS = ["local", "local_aa", "hop_floor", "hop_0.5ms", "hop_2ms", "tuned_local", "tuned_hop_2ms"]


def pct(values, p):
    """Nearest rank."""
    v = sorted(values)
    return v[max(0, math.ceil(p * len(v)) - 1)] if v else float("nan")


def ms(us):
    return f"{us / 1000:.1f}" if us == us else "–"


def rows(path):
    if not os.path.exists(path):
        path += ".gz"
    with (gzip.open(path, "rt") if path.endswith(".gz") else open(path)) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def latency(d):
    data = rows(os.path.join(d, "latency.jsonl"))
    bad = [r for r in data if r["status"] != 200]
    print(f"{len(data)} requests, {len(bad)} not 200\n")
    warm = collections.defaultdict(list)
    cold = collections.defaultdict(list)
    for r in data:
        key = (r["size"], r["cell"], r["offset"])
        (warm if r["phase"] == "warm" else cold)[key + (r["arm"],)].append(r)
    for size in sorted({r["size"] for r in data}, reverse=True):
        print(f"**{size:,} studies, warm, p95 `db` / `app` in ms** (n = {len(warm[(size, 'newest', 0, 'local')])} a cell)\n")
        print("| cell | offset | " + " | ".join(ARMS) + " |")
        print("| --- | --- |" + " --- |" * len(ARMS))
        for cell, offset in sorted({(k[1], k[2]) for k in warm if k[0] == size}):
            cells = []
            for arm in ARMS:
                rs = warm[(size, cell, offset, arm)]
                db, app = pct([r["db_us"] for r in rs], 0.95), pct([r["app_us"] for r in rs], 0.95)
                flag = "**" if db > 10_000 or app > 50_000 else ""
                cells.append(f"{flag}{ms(db)} / {ms(app)}{flag}")
            print(f"| {cell} | {offset} | " + " | ".join(cells) + " |")
        print()
        print(f"**{size:,}, warm, p50 `app` in ms; `client` p95 − `app` p95 on `local`**\n")
        print("| cell | offset | " + " | ".join(ARMS) + " | client − app |")
        print("| --- | --- |" + " --- |" * (len(ARMS) + 1))
        for cell, offset in sorted({(k[1], k[2]) for k in warm if k[0] == size}):
            p50 = [ms(pct([r["app_us"] for r in warm[(size, cell, offset, a)]], 0.5)) for a in ARMS]
            loc = warm[(size, cell, offset, "local")]
            over = pct([r["client_us"] for r in loc], 0.95) - pct([r["app_us"] for r in loc], 0.95)
            print(f"| {cell} | {offset} | " + " | ".join(p50) + f" | {ms(over)} |")
        print()
        print(f"**{size:,}, cold: the first request of each cell after a restart, `app` ms over the rounds**\n")
        print("| cell | offset | n | p50 | max |")
        print("| --- | --- | --- | --- | --- |")
        for cell, offset in sorted({(k[1], k[2]) for k in cold if k[0] == size}):
            rs = [r for k, v in cold.items() if k[:3] == (size, cell, offset) for r in v]
            apps = [r["app_us"] for r in rs]
            print(f"| {cell} | {offset} | {len(rs)} | {ms(pct(apps, 0.5))} | {ms(max(apps))} |")
        print()


def sweep(d):
    path = os.path.join(d, "sweep.jsonl")
    if not os.path.exists(path):
        return
    data = rows(path)
    by = collections.defaultdict(list)
    for r in data:
        by[(r["arm"], r["concurrency"])].append(r)
    print("**Sweep, 10⁶, the mix; ms, the worse of the two repetitions; CPU busy of the 4 vCPUs**\n")
    print("| arm | concurrency | `app` p50 | `app` p95 | `client` p95 | `db` p95 | CPU busy |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for arm, c in sorted(by, key=lambda k: (k[0], k[1])):
        rs = by[(arm, c)]
        w = lambda k: max(r[k] for r in rs)  # noqa: E731
        print(f"| {arm} | {c} | {ms(w('app_p50'))} | {ms(w('app_p95'))} | {ms(w('client_p95'))} | {ms(w('db_p95'))} | "
              f"{max(r['cpu_busy'] for r in rs):.0%} |")
    print()


def sync(d):
    path = os.path.join(d, "sync.jsonl")
    if not os.path.exists(path):
        return
    data = rows(path)
    of = lambda s: [r for r in data if r["scenario"] == s]  # noqa: E731
    print("**Rebuild and rescan of the sync host's study DBs**\n")
    print("| pass | arm | scanned | published | ms |")
    print("| --- | --- | --- | --- | --- |")
    for r in of("rebuild") + of("rescan"):
        print(f"| {r['scenario']} | {r['arm']} | {r['scanned']} | {r['published']} | {r['ms']:,} |")
    print()
    arms = list(dict.fromkeys(r["arm"] for r in of("idle")))
    print("**Sync lag, ms: idle (one study at a time) and burst (200 back to back); correction**\n")
    print("| arm | idle → index p50 / p95 | idle → visible p50 / p95 | burst lag p50 / max (median round) | "
          "burst drained | correction total p50 / max (studies) |")
    print("| --- | --- | --- | --- | --- | --- |")
    for arm in arms:
        idle = [r for r in of("idle") if r["arm"] == arm]
        burst = sorted((r for r in of("burst") if r["arm"] == arm), key=lambda r: r["drained_ms"])
        mid = burst[len(burst) // 2]
        corr = [r for r in of("correction") if r["arm"] == arm]
        ix, vis = [r["index_us"] for r in idle], [r["visible_us"] for r in idle]
        tot = [r["total_us"] for r in corr]
        print(f"| {arm} | {ms(pct(ix, .5))} / {ms(pct(ix, .95))} | {ms(pct(vis, .5))} / {ms(pct(vis, .95))} | "
              f"{ms(mid['lag_p50_us'])} / {ms(mid['lag_max_us'])} | {mid['drained_ms']:.0f} | "
              f"{ms(pct(tot, .5))} / {ms(max(tot))} ({min(r['studies'] for r in corr)}–{max(r['studies'] for r in corr)}) |")
    print()
    print("**Recovery: 1 000 studies committed while the index was down; ms from the index answering**\n")
    print("| arm | publisher | n | outage p50 | first publish p50 | drained p50 / max | study DBs scanned |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    rec = collections.defaultdict(list)
    for r in of("recovery"):
        rec[(r["arm"], r["publisher"])].append(r)
    for (arm, pub), rs in sorted(rec.items()):
        firsts = [r["first_ms"] for r in rs if r.get("first_ms") is not None]
        drain = [r["drain_ms"] for r in rs]
        print(f"| {arm} | {pub} | {len(rs)} | {pct([r['outage_ms'] for r in rs], .5):,} | "
              f"{f'{pct(firsts, .5):.0f}' if firsts else '–'} | {pct(drain, .5):,.0f} / {max(drain):,.0f} | "
              f"{min(r['scanned'] for r in rs):,}–{max(r['scanned'] for r in rs):,} |")
    print()


def main():
    d = sys.argv[1]
    latency(d)
    sweep(d)
    sync(d)


if __name__ == "__main__":
    main()
