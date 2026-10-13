"""Test-weighted percentiles of Ookla's open tiles (docs/transport/link-conditions.md §Ookla).

Each tile row holds per-tile means over `tests` tests, so these are percentiles of tile means
weighted by tests: narrower than the per-test spread, which the dataset does not publish.
"""
import sys

import numpy as np
import pyarrow.parquet as pq

REGIONS = {
    "world": None,
    "US (contiguous box)": (-125.0, -66.0, 24.0, 50.0),
    "Europe (box)": (-11.0, 30.0, 36.0, 71.0),
}
COLUMNS = ["avg_d_kbps", "avg_u_kbps", "avg_lat_ms", "avg_lat_down_ms", "avg_lat_up_ms"]
QUANTILES = [0.10, 0.50, 0.90]


def weighted_quantiles(values, weights, qs):
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cum = np.cumsum(w) / w.sum()
    return [v[np.searchsorted(cum, q)] for q in qs]


def summarize(path):
    t = pq.read_table(path, columns=COLUMNS + ["tests", "tile_x", "tile_y"])
    cols = {c: t.column(c).to_numpy(zero_copy_only=False) for c in t.column_names}
    for name, box in REGIONS.items():
        keep = np.ones(len(cols["tests"]), bool)
        if box:
            x0, x1, y0, y1 = box
            keep = (cols["tile_x"] >= x0) & (cols["tile_x"] <= x1) & (cols["tile_y"] >= y0) & (cols["tile_y"] <= y1)
        w = cols["tests"][keep].astype(float)
        print(f"{name}: {int(w.sum())} tests, {int(keep.sum())} tiles")
        for c in COLUMNS:
            v = cols[c][keep].astype(float)
            ok = ~np.isnan(v)
            p = weighted_quantiles(v[ok], w[ok], QUANTILES)
            scale = 1000.0 if c.endswith("kbps") else 1.0
            unit = "Mbit/s" if c.endswith("kbps") else "ms"
            print(f"  {c:16s} p10 {p[0]/scale:8.1f}  p50 {p[1]/scale:8.1f}  p90 {p[2]/scale:8.1f} {unit}")
        d = cols["avg_d_kbps"][keep] / 1000.0
        for bar in (5, 20, 50):
            print(f"  tests in tiles under {bar:2d} Mbit/s down: {w[d < bar].sum() / w.sum():.3f}")


if __name__ == "__main__":
    for path in sys.argv[1:]:
        print(path.rsplit("/", 1)[-1])
        summarize(path)
