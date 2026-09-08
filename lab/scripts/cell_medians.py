#!/usr/bin/env python3
"""Pooled medians per cell group, for the tables in the docs.

    lab/scripts/cell_medians.py FILE.tsv [--by temp,size,depth,readers] [--arms a,b,c] [--metrics ...]

Groups rows by the `--by` columns plus `arm`, prints the median of each metric over the
repeats in that group, and the group size. Latency and CPU columns are printed in µs; `MB/s`
is derived from `asks_per_s × size`. Arms print in the order given, so a table reads as the
comparison it is meant to be.
"""
import argparse, collections, csv, statistics as st

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--by", default="temp,size,depth,readers")
    ap.add_argument("--arms", default=None, help="comma-separated arm order (default: as found)")
    ap.add_argument("--metrics", default="p50_ns,p99_ns,cpu_ns_per_ask,miss_pct,threads,mbps")
    ap.add_argument("--label", default=None, help="only rows whose label starts with this")
    a = ap.parse_args()
    by = a.by.split(","); metrics = a.metrics.split(",")
    rows = list(csv.DictReader(open(a.file, newline=""), delimiter="\t"))
    if a.label:
        rows = [r for r in rows if r["label"].startswith(a.label)]
    groups = collections.defaultdict(list)
    for r in rows:
        groups[tuple(r[k] for k in by) + (r["arm"],)].append(r)
    arms = a.arms.split(",") if a.arms else sorted({r["arm"] for r in rows})
    def num(k):
        return (int(k) if k.isdigit() else k)
    keys = sorted({g[:-1] for g in groups}, key=lambda t: tuple(num(x) for x in t))
    hdr = [f"{k:>7}" for k in by] + [f"{'arm':22}", "  n"] + [f"{m.replace('_ns','_us').replace('cpu_ns_per_ask','cpu_us'):>9}" for m in metrics]
    print(" ".join(hdr))
    for key in keys:
        for arm in arms:
            rs = groups.get(key + (arm,))
            if not rs:
                continue
            out = [f"{v:>7}" for v in key] + [f"{arm:22}", f"{len(rs):>3}"]
            for m in metrics:
                if m == "mbps":
                    v = st.median(float(r["asks_per_s"]) * float(r["size"]) for r in rs) / 1e6
                    out.append(f"{v:>9.0f}")
                else:
                    v = st.median(float(r[m]) for r in rs)
                    if m.endswith("_ns") or m == "cpu_ns_per_ask":
                        v /= 1e3
                    out.append(f"{v:>9.1f}")
            print(" ".join(out))

if __name__ == "__main__":
    main()
