"""Predictions for the 220-level form (docs/decode/mobile/hw-inverted.md §8), by DEPTH8-THEORY's model.

python3 predict.py DEPTH8_THEORY_PY NOISE_RATIO_ROWS_DIR QUANT_COMMON_C > predictions.json
"""
import bisect
import importlib.util
import json
import math
import statistics as st
import sys

import numpy as np

LOW, LEVELS = 16, 220


def scale(depth):
    return ((1 << depth) - 1) / (LEVELS - 1)


def code220(v, depth):
    return LOW + np.floor(v / scale(depth) + 0.5).astype(np.int64)


def back220(c, depth):
    return np.floor((c - LOW) * scale(depth) + 0.5).astype(np.int64)


def rms220(depth):
    v = np.arange(1 << depth)
    return float(np.sqrt(np.mean((back220(code220(v, depth), depth) - v) ** 2)))


def predictor(theory):
    class Inv220(theory.Theory):
        def error220(self, sigma, depth, q, g):
            r = rms220(depth)
            codes_sigma = math.hypot(sigma, r)
            coded = self.h(self.step(q, 8) * scale(depth) / codes_sigma, g)
            return (math.hypot(r, coded * codes_sigma) / sigma,
                    math.hypot((1 - coded) * r, coded * sigma) / sigma)

        def highest_q220(self, s, bar, model):
            depth = self.dbt[s]["b"]
            return max((q for q in range(1, 40)
                        if max(self.error220(sg, depth, q, 1)[model] for sg in self.dbt[s]["sigma"]) <= bar),
                       default=None)

        def bytes220(self, s, q):
            b = self.dbt[s]["b"]
            median = st.median(self.dbt[s]["sigma"])
            curve = sorted((math.log(self.step(c["q"], b) / median), math.log(sum(c["units"]) / self.htj2k[s]))
                           for c in self.cells if c["set"] == s and c["g"] == 1 and c["form"] == self.stored(s))
            if len(curve) < 2 or q is None:
                return None
            x = math.log(self.step(q, 8) * scale(b) / math.hypot(median, rms220(b)))
            i = min(max(bisect.bisect_right([p[0] for p in curve], x) - 1, 0), len(curve) - 2)
            (x0, y0), (x1, y1) = curve[i], curve[i + 1]
            return math.exp(y0 + (x - x0) * (y1 - y0) / (x1 - x0))
    return Inv220


def volume(th, s):
    b = th.dbt[s]["b"]
    out = dict(set=s, b=b, cut_rms=rms220(b), cut_over_sigma_min=rms220(b) / min(th.dbt[s]["sigma"]))
    for bar in theory_bars:
        q220 = [th.highest_q220(s, bar, m) for m in (0, 1)]
        q8 = [th.highest_q(s, b - 8, 8, 1, bar, m) for m in (0, 1)]
        ratios = [th.bytes220(s, a) / th.bytes_ratio(s, b - 8, 8, c, 1)
                  if th.bytes220(s, a) and th.bytes_ratio(s, b - 8, 8, c, 1) else None for a, c in zip(q220, q8)]
        out[f"bar{bar:.2f}"] = dict(inv220_independent_removal=q220, cut8_independent_removal=q8,
                                    bytes_inv220_over_cut8=ratios)
    return out


if __name__ == "__main__":
    spec = importlib.util.spec_from_file_location("theory", sys.argv[1])
    theory = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(theory)
    theory_bars = theory.BARS
    th = predictor(theory)(*theory.load(sys.argv[2]), theory.ac_tables(open(sys.argv[3]).read()))
    json.dump(dict(rms220={d: rms220(d) for d in (10, 12)},
                   volumes=[volume(th, s) for s in sorted(th.dbt, key=lambda s: (-th.dbt[s]["b"], s))]),
              sys.stdout, indent=1)
