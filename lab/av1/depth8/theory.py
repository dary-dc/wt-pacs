"""DEPTH8-THEORY's arithmetic: the 8-bit depth cut's predictions per DBT volume (docs/av1/depth-cut-8.md).

python3 lab/av1/depth8/theory.py ROWS_DIR QUANT_COMMON_C > lab/av1/depth8/predictions.json
"""
import bisect
import json
import math
import re
import statistics as st
import sys
from pathlib import Path

SHARDS = ["shard-1", "shard-2", "shard-3", "shard-4"]
QINDEX = [4 * q for q in range(62)] + [249, 255]
BARS = (1.00, 1.03)


def ac_tables(text):
    def table(name):
        body = text[text.index(name):]
        return [int(v) for v in re.findall(r"-?\d+", body[body.index("{") + 1:body.index("}")])]
    return {8: table("ac_qlookup_QTX["), 10: table("ac_qlookup_10_QTX["), 12: table("ac_qlookup_12_QTX[")}


def load(rows):
    series, cells, htj2k = {}, [], {}
    for shard in SHARDS:
        for line in open(Path(rows) / f"{shard}.jsonl"):
            r = json.loads(line)
            if r["kind"] == "series":
                series[r["set"]] = r
            elif r["kind"] == "cell":
                cells.append(r)
            elif r["codec"] == "htj2k":
                htj2k[r["set"]] = sum(r["bytes"])
    dbt = {s: r for s, r in series.items() if s.startswith("dbt")}
    return dbt, [c for c in cells if c["set"] in dbt], htj2k


class Theory:
    def __init__(self, dbt, cells, htj2k, ac):
        self.dbt, self.cells, self.htj2k, self.ac = dbt, cells, htj2k, ac
        self.curves = {g: self.noise_curve(g) for g in (1, 16)}

    def step(self, q, depth):
        return self.ac[depth][QINDEX[q]] / 8

    @staticmethod
    def rounding(k):
        """RMS of rounding integers to multiples of 2^k, in source units."""
        return math.sqrt((4 ** k - 1) / 12)

    def stored(self, s):
        return {12: "12bit", 10: "10bit"}[self.dbt[s]["b"]]

    def noise_curve(self, g):
        """h(x): median e_N ÷ σ against x = Δ ÷ σ over every stored-form frame, log-spaced bins of 20 or more."""
        points = sorted(
            (self.step(c["q"], self.dbt[c["set"]]["b"]) / sigma, frame["err_noise_band"] / sigma)
            for c in self.cells if c["g"] == g and c["form"] == self.stored(c["set"])
            for frame, sigma in zip(c["frames"], self.dbt[c["set"]]["sigma"]))
        edges = [0.25 * 1.25 ** i for i in range(30)]
        xs, ys = [0.0], [0.0]
        for lo, hi in zip(edges, edges[1:]):
            inside = [y for x, y in points if lo <= x < hi]
            if len(inside) >= 20:
                xs.append(math.sqrt(lo * hi))
                ys.append(st.median(inside))
        return xs, ys

    def h(self, x, g):
        xs, ys = self.curves[g]
        if x >= xs[-1]:
            return ys[-1]
        i = bisect.bisect_right(xs, x) - 1
        return ys[i] + (x - xs[i]) / (xs[i + 1] - xs[i]) * (ys[i + 1] - ys[i])

    def error(self, sigma, k, depth, q, g):
        """e_N ÷ σ of a k-bit cut coded at Q: (independent, removal) stacking of rounding and coding error."""
        r = self.rounding(k)
        codes_sigma = math.hypot(sigma, r)
        coded = self.h(self.step(q, depth) * 2 ** k / codes_sigma, g)
        independent = math.hypot(r, coded * codes_sigma) / sigma
        removal = math.hypot((1 - coded) * r, coded * sigma) / sigma
        return independent, removal

    def worst(self, s, k, depth, q, g):
        errors = [self.error(sigma, k, depth, q, g) for sigma in self.dbt[s]["sigma"]]
        return max(e[0] for e in errors), max(e[1] for e in errors)

    def highest_q(self, s, k, depth, g, bar, model):
        return max((q for q in range(1, 40) if self.worst(s, k, depth, q, g)[model] <= bar), default=None)

    def bytes_ratio(self, s, k, depth, q, g):
        """Bytes ÷ HTJ2K read off the series' own stored-form curve at the same x; None without stored cells."""
        b = self.dbt[s]["b"]
        median = st.median(self.dbt[s]["sigma"])
        curve = sorted((math.log(self.step(c["q"], b) / median), math.log(sum(c["units"]) / self.htj2k[s]))
                       for c in self.cells if c["set"] == s and c["g"] == g and c["form"] == self.stored(s))
        if len(curve) < 2 or q is None:
            return None
        x = math.log(self.step(q, depth) * 2 ** k / math.hypot(median, self.rounding(k)))
        i = min(max(bisect.bisect_right([p[0] for p in curve], x) - 1, 0), len(curve) - 2)
        (x0, y0), (x1, y1) = curve[i], curve[i + 1]
        return math.exp(y0 + (x - x0) * (y1 - y0) / (x1 - x0))

    def volume(self, s):
        r = self.dbt[s]
        b, sigma = r["b"], r["sigma"]
        k8, k_today = b - 8, (2 if b == 12 else 0)
        widths = [w["width"] for w in r["windows"]]
        out = dict(set=s, b=b, frames=len(sigma), sigma_min=min(sigma), sigma_max=max(sigma),
                   cut_rms=self.rounding(k8), cut_over_sigma_min=self.rounding(k8) / min(sigma),
                   window_widths=[min(widths), max(widths)],
                   cut_rms_levels=[self.rounding(k8) * 255 / w for w in (max(widths), min(widths))],
                   cut_step_levels=[2 ** k8 * 255 / w for w in (max(widths), min(widths))], q={})
        for g in (1, 16):
            for bar in BARS:
                q8 = [self.highest_q(s, k8, 8, g, bar, m) for m in (0, 1)]
                today = self.highest_q(s, k_today, 10, g, bar, 0)
                out["q"][f"g{g}_bar{bar:.2f}"] = dict(
                    cut8_independent=q8[0], cut8_removal=q8[1], today=today,
                    bytes_cut8=[self.bytes_ratio(s, k8, 8, q, g) for q in q8],
                    bytes_today=self.bytes_ratio(s, k_today, 10, today, g))
        return out


def main(rows, quant_common):
    theory = Theory(*load(rows), ac_tables(Path(quant_common).read_text()))
    order = sorted(theory.dbt, key=lambda s: (-theory.dbt[s]["b"], s))
    json.dump(dict(curves={g: list(zip(*c)) for g, c in theory.curves.items()},
                   volumes=[theory.volume(s) for s in order]), sys.stdout, indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:3])
