#!/usr/bin/env python3
"""The verdicts of lab/scripts/workstation_run.sh, under docs/adr/disk-access.md §11's rule, beside each part's A/A.

    lab/scripts/workstation_summary.py readers readers.tsv VARIANTS   # the list read_campaign was given
    lab/scripts/workstation_summary.py server server.tsv
"""
import collections
import csv
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pair_variants import KEY, verdict  # noqa: E402

METRICS = ["p50_ns", "cpu_ns_per_ask"]


def rows(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def delta(a, b, metric):
    x, y = float(b[metric]), float(a[metric])
    return (y - x) / x * 100 if x else None


def aa_p90(vals):
    """The A/A's spread: the p90 of |A′/A − 1| over its pairs, the resolution row 195's protocol names."""
    if not vals:
        return "-"
    xs = sorted(abs(v) for v in vals)
    return f"{xs[min(len(xs) - 1, int(0.9 * len(xs)))]:.1f}%"


def line(name, pairs):
    cols = []
    for m in METRICS:
        ds = [d for d in (delta(a, b, m) for a, b in pairs) if d is not None]
        cols.append(f"{m.split('_')[0]} {verdict(ds)}")
    return f"  {name:<34} " + "  |  ".join(cols)


def relabel(path, variants):
    """read_campaign rotates `variants` by repeat; a variant listed twice is the A/A, renamed `<variant>_aa`."""
    names = [v if v not in variants[:i] else f"{v}_aa" for i, v in enumerate(variants)]
    rs = rows(path)
    if not rs:
        return rs, names
    for r in rs:
        r["variant"] = names[(int(r["repeat"]) + int(r["pos"])) % len(names)]
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rs[0]), delimiter="\t")
        w.writeheader()
        w.writerows(rs)
    return rs, names


def readers(path, variants):
    rs, names = relabel(path, variants.split(","))
    if not rs:
        print("no rows")
        return
    cells = collections.defaultdict(dict)
    for r in rs:
        cells[tuple(r[k] for k in KEY)][r["variant"]] = r
    configs = sorted({(k[0], int(k[6]), int(k[7])) for k in cells}, key=lambda c: (c[0], c[2], c[1]))
    print("each variant against the shape's own reader, paired per repeat: p50 and CPU per ask")
    for label, depth, nread in configs:
        own = "product_fill" if label.startswith("f") else "product_tile"
        mine = [v for k, v in cells.items() if (k[0], int(k[6]), int(k[7])) == (label, depth, nread)]
        pool_miss = [float(c["pool"]["miss_pct"]) for c in mine if "pool" in c]
        print(f"{label} depth {depth} readers {nread}  pool miss {st.median(pool_miss) if pool_miss else '-'}%")
        for v in names:
            base = v.removesuffix("_aa") if v.endswith("_aa") else own
            if v == base:
                continue
            pairs = [(c[v], c[base]) for c in mine if v in c and base in c]
            extra = f"  A/A p90 {aa_p90([delta(a, b, 'p50_ns') for a, b in pairs])}" if v.endswith("_aa") else ""
            print(line(f"{v} vs {base}", pairs) + extra)
    fill_rings = sum(int(r["rings_built"]) for r in rs if r["variant"] == "product_fill")
    print(f"rings built by product_fill: {fill_rings} (the claim: 0)")
    named = collections.defaultdict(list)
    for r in rs:
        if r["variant"] == "product_tile" and r["label"].startswith("t"):
            named[int(r["depth"])].append(int(r["peak_named"]))
    print("product_tile peak_named by depth (the claim: follows depth past 4): "
          + ", ".join(f"d{d} {st.median(v):.0f}" for d, v in sorted(named.items())))


def server(path):
    rs = rows(path)
    cells = collections.defaultdict(dict)
    for r in rs:
        kind, _, rnd = r["label"].rpartition("_r")
        cells[(kind, rnd)][r["variant"]] = r
    print("pool and ring_aa against ring, paired per round: p50 and CPU per ask")
    for kind in ["cold_d1", "cold_d2", "cold_d4", "warm_d1", "warm_d4", "fill"]:
        mine = [c for (k, _), c in cells.items() if k == kind]
        aa = [(c["ring_aa"], c["ring"]) for c in mine if "ring_aa" in c and "ring" in c]
        print(f"{kind}  A/A p90 {aa_p90([delta(a, b, 'p50_ns') for a, b in aa])}")
        print(line("pool vs ring", [(c["pool"], c["ring"]) for c in mine if "pool" in c and "ring" in c]))
        print(line("ring_aa vs ring", aa))
    cold = [r for r in rs if r["temp"] == "cold" and r["mode"] == "on-demand"]
    low = [r["label"] + "/" + r["variant"] for r in cold if r["miss_pct"] in ("", "-") or float(r["miss_pct"]) < 0.95]
    print(f"cold on-demand rows missing under 0.95: {len(low)} {' '.join(low[:6])}")
    for arm, want in [("ring", "true"), ("ring_aa", "true"), ("pool", "false")]:
        got = [r["ring"] for r in cold if r["variant"] == arm]
        print(f"{arm}: ring={want} in {sum(g == want for g in got)} of {len(got)} cold on-demand rows")
    resident = [r for r in rs if r["resident"] not in ("-", "0")]
    print(f"cold copies found resident: {len(resident)} (want 0)")


if __name__ == "__main__":
    mode, *rest = sys.argv[1:]
    {"readers": readers, "server": server}[mode](*rest)
