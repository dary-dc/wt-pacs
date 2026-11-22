#!/usr/bin/env python3
"""VL-READS: docs/av1/vl-criterion.md §5's reads R1-R9 on the committed rows, nothing encoded.

usage: vl_reads.py SPEC.html OUT.json   (SPEC.html: https://aomediacodec.github.io/av1-spec/, fetched by the caller)
"""
import gzip
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.integrate import quad
from scipy.optimize import brentq

HERE = Path(__file__).resolve().parent
AV1 = HERE.parent
sys.path.insert(0, str(AV1 / "groups"))
sys.path.insert(0, str(HERE))
import anchor  # noqa: E402
from noise_point import spec_ac  # noqa: E402

STORED = {"12bit", "10bit"}


def jsonl(path):
    return [json.loads(line) for line in path.open()]


def load():
    b = jsonl(AV1 / "audit/rows/b.jsonl")
    series = {r["set"]: r for r in b if r["kind"] == "series"}
    cells = [dict(r, src="B") for r in b if r["kind"] == "cell"]
    htj2k = {}
    for i in (1, 2, 3, 4):
        for r in jsonl(HERE / f"rows/shard-{i}.jsonl"):
            if r["kind"] == "cell" and r["set"] in series and r["form"] in STORED:
                cells.append(dict(r, src="S"))
            elif r["kind"] == "control" and r["codec"] == "htj2k":
                htj2k[r["set"]] = sum(r["bytes"])
            elif r["kind"] == "series" and r["set"] in series:
                assert r["sigma"] == series[r["set"]]["sigma"], r["set"]
    summary = json.load((AV1 / "audit/rows/b-summary.json").open())["volumes"]
    return series, cells, htj2k, summary


def step(ac, q, depth):
    return ac[depth][4 * q] / 8


def per_frame(s, c):
    sig = np.asarray(s["sigma"], float)
    f = c["frames"]
    e = np.sqrt([x["mse_in"] for x in f])
    return dict(sig=sig, r=np.array([x["err_noise_band"] for x in f]) / sig,
                nu=np.asarray(c["sigma_out"], float) / sig if "sigma_out" in c else None,
                w_n=np.array([x["err_noise_band"] for x in f]) / e, w_4=4 * np.array([x["err_band"] for x in f]) / e,
                e4=np.array([x["err_band"] for x in f]))


def model(x, t):
    """Unit Gaussian noise through a quantizer of step x, zero bin ±t, levels at multiples of x beyond it: (r, ν)."""
    pdf = lambda n: math.exp(-n * n / 2) / math.sqrt(2 * math.pi)
    err2, out2 = quad(lambda n: n * n * pdf(n), 0, t)[0], 0.0
    k = 1
    while (k - 0.5) * x < 12:
        lo, hi = max(t, (k - 0.5) * x), (k + 0.5) * x
        if hi > lo:
            err2 += quad(lambda n: (n - k * x) ** 2 * pdf(n), lo, hi)[0]
            out2 += (k * x) ** 2 * quad(pdf, lo, hi)[0]
        k += 1
    return math.sqrt(2 * err2), math.sqrt(2 * out2)


def r1(series, cells, summary):
    out = {}
    for n, v in summary.items():
        pts = sorted((c["q"], anchor.nu(series[n], c)) for c in cells if c["src"] == "B" and c["set"] == n
                     and c["g"] == 1)
        d = v["delta"]
        hi = lambda bar: max((q for q, x in pts if x >= bar), default=None)
        a, b = hi(0.5 * (1 + d)), hi(0.5 * (1 - d))
        r_band = v["g"]["1"]["q_hi"] - v["g"]["1"]["q_lo"]
        out[n] = dict(delta=d, q_nu_hi=a, q_nu_lo=b, nu_gap=None if None in (a, b) else b - a, r_gap=r_band)
    one = sum(x["nu_gap"] == 0 for x in out.values())
    return dict(volumes=out, nu_single_q=one, nu_gap_le_1=sum(x["nu_gap"] is not None and x["nu_gap"] <= 1
                                                               for x in out.values()),
                r_single_q=sum(x["r_gap"] == 0 for x in out.values()),
                holds=one >= 17, refuted=one < 15)


def rule_cell(cells, n, q):
    return next(c for c in cells if c["src"] == "B" and c["set"] == n and c["g"] == 1 and c["q"] == q)


def r2(series, cells, summary):
    out = {}
    for n, v in summary.items():
        q = v["g"]["1"]["rule pooled"]["q"]
        f = per_frame(series[n], rule_cell(cells, n, q))
        k = (1 + f["r"] ** 2 - f["nu"] ** 2) / 2
        rq = np.sqrt(np.maximum(f["r"] ** 2 - k ** 2, 0))
        out[n] = dict(q=q, k=float(np.median(k)), r_q=float(np.median(rq)),
                      r_q_imaginary_frames=int(np.sum(f["r"] ** 2 < k ** 2)))
    ok = [n for n, x in out.items() if x["k"] >= 0.70 and 0.20 <= x["r_q"] <= 0.55]
    return dict(volumes=out, inside=len(ok), outside=[n for n in out if n not in ok], refuted=len(ok) < len(out))


def r3(series, cells, summary, ac):
    rows = []
    for c in cells:
        s = series[c["set"]]
        f = per_frame(s, c)
        rows.append(dict(set=c["set"], src=c["src"], g=c["g"], q=c["q"],
                         x_quiet=step(ac, c["q"], s["b"]) / float(f["sig"].min()),
                         w_n=float(np.median(f["w_n"])), w_4=float(np.median(f["w_4"]))))
    a = [x for x in rows if x["x_quiet"] <= 2]
    a_out = [x for x in a if not (0.93 <= x["w_n"] <= 1.07 and 0.85 <= x["w_4"] <= 1.10)]
    runs = defaultdict(list)
    for x in rows:
        if x["x_quiet"] >= 2:
            runs[(x["set"], x["src"], x["g"])].append(x)
    rises = []
    for key, xs in runs.items():
        xs.sort(key=lambda x: x["q"])
        rises += [dict(set=key[0], src=key[1], g=key[2], q=(p["q"], o["q"]), rise=o["w_n"] - p["w_n"])
                  for p, o in zip(xs, xs[1:]) if o["w_n"] - p["w_n"] > 0.02]
    at_rule = {}
    for n, v in summary.items():
        q = v["g"]["1"]["rule pooled"]["q"]
        at_rule[n] = next(x["w_n"] for x in rows if x["src"] == "B" and x["set"] == n and x["g"] == 1 and x["q"] == q)
    c_in = sum(0.65 <= w <= 0.95 for w in at_rule.values())
    return dict(cells=rows, a=dict(cells=len(a), outside=a_out, refuted=bool(a_out)),
                b=dict(rises=rises, refuted=bool(rises)),
                c=dict(w_n=at_rule, inside=c_in, above=[n for n, w in at_rule.items() if w > 0.95],
                       below=[n for n, w in at_rule.items() if w < 0.65], refuted=c_in < 15))


def r4(series, cells, summary):
    out = {}
    for n, v in summary.items():
        s = series[n]
        q = v["g"]["1"]["rule pooled"]["q"]
        f = per_frame(s, rule_cell(cells, n, q))
        sb = s["step_band"]
        band = np.minimum(np.r_[sb[:1], sb], np.r_[sb, sb[-1:]])
        L = float(np.median(math.sqrt(2) * f["e4"] / band))
        out[n] = dict(q=q, L=L, L_rho=L * math.sqrt(0.73))
    inside = sum(0.15 <= x["L"] <= 0.75 for x in out.values())
    return dict(volumes=out, inside=inside, at_or_over_1=[n for n, x in out.items() if x["L"] >= 1],
                refuted=any(x["L"] >= 1 for x in out.values()))


def r5():
    out = {}
    for line in gzip.open(HERE / "rows/noise-point/tiles.jsonl.gz", "rt"):
        c = json.loads(line)
        t = np.array([x[3:6] for x in c["tiles"]], float)
        sig, en, mean = t[:, 0], t[:, 1], t[:, 2]
        low = mean <= np.quantile(mean, 0.1)
        ratio = lambda m: math.sqrt(np.mean(en[m] ** 2)) / math.sqrt(np.mean(sig[m] ** 2))
        out[f"{c['set']} G {c['g']} Q {c['q']}"] = dict(R=ratio(low) / ratio(np.ones_like(low)), low=ratio(low),
                                                       all=ratio(np.ones_like(low)), tiles=len(t), low_tiles=int(low.sum()))
    under = ["dbts_a1 G 1 Q 4", "dbts_a1 G 16 Q 4", "dbts_b1 G 16 Q 8", "dbts_c1 G 16 Q 4"]
    at = ["dbts_b1 G 1 Q 12", "dbts_c1 G 1 Q 8"]
    flat = [k for k in under if out[k]["R"] < 1.05]
    under_out = [k for k in under if not 1.05 <= out[k]["R"] <= 1.30]
    at_out = [k for k in at if not (1.00 <= out[k]["R"] <= 1.08 and 1.00 <= out[k]["low"] <= 1.10)]
    return dict(cells=out, under_outside=under_out, window_flat_on=flat, at_outside=at_out,
                refuted=bool(flat or at_out))


def r6(series, cells, ac):
    out = {}
    for n, s in series.items():
        bins = defaultdict(lambda: defaultdict(list))
        for c in cells:
            if c["src"] == "B" and c["set"] == n and c["g"] == 1:
                f = per_frame(s, c)
                x = step(ac, c["q"], s["b"]) / f["sig"]
                for xi, ri, ni in zip(x, f["r"], f["nu"]):
                    if 3 <= xi < 6:
                        bins[math.floor(xi / 0.25) * 0.25][c["q"]].append((ri, ni))
        kept = {k: [p for ps in by.values() for p in ps] for k, by in bins.items() if len(by) >= 2}
        spread = lambda i: max((max(p[i] for p in ps) - min(p[i] for p in ps) for ps in kept.values()), default=None)
        out[n] = dict(bins=len(kept), r_spread=spread(0), nu_spread=spread(1))
    r_ok = sum(x["r_spread"] is not None and x["r_spread"] <= 0.03 for x in out.values())
    nu_ok = sum(x["nu_spread"] is not None and x["nu_spread"] <= 0.06 for x in out.values())
    return dict(volumes=out, r_ok=r_ok, nu_ok=nu_ok, refuted=r_ok < 17 or nu_ok < 15)


def r7(series, cells, ac):
    out = []
    for c in cells:
        s = series[c["set"]]
        if "sigma_out" not in c:
            continue
        f = per_frame(s, c)
        x = step(ac, c["q"], s["b"]) / float(np.median(f["sig"]))
        if not 3 <= x <= 5.5:
            continue
        r, nu = float(np.median(f["r"])), float(np.median(f["nu"]))
        nu_mid = model(x, x / 2)[1]
        if nu > nu_mid:
            out.append(dict(set=c["set"], src=c["src"], g=c["g"], q=c["q"], x=x, r=r, nu=nu, t=None, r_model=None))
            continue
        t = brentq(lambda t: model(x, t)[1] - nu, x / 2, 4 * x)
        out.append(dict(set=c["set"], src=c["src"], g=c["g"], q=c["q"], x=x, r=r, nu=nu, t=t, r_model=model(x, t)[0]))
    fit = [o for o in out if o["t"] is not None]
    within = sum(abs(o["r_model"] - o["r"]) <= 0.05 for o in fit)
    share = within / len(out) if out else None
    return dict(cells=out, n=len(out), no_t=len(out) - len(fit), within=within, share=share,
                share_of_fitted=within / len(fit) if fit else None, holds=share is not None and share >= 0.8,
                refuted=share is not None and share < 0.6)


def r8(series, cells, htj2k, ac):
    out = {}
    for n, s in series.items():
        rungs = defaultdict(dict)
        for c in cells:
            if c["set"] == n and c["g"] == 1:
                rungs[c["q"]][c["src"]] = sum(c["units"])
        quiet = min(s["sigma"])
        pick = lambda bound, srcs: max((q for q, by in rungs.items() if step(ac, q, s["b"]) / quiet <= bound
                                        and any(k in by for k in srcs)), default=None)
        row = {}
        for bound in (2, 1):
            q, q_s = pick(bound, "BS"), pick(bound, "S")
            by = rungs.get(q, {})
            units = by.get("B", by.get("S"))
            row[f"x{bound}"] = dict(q=q, q_s_only=q_s, share=None if units is None else units / htj2k[n],
                                    share_s=by.get("S") and by["S"] / htj2k[n], share_b=by.get("B") and by["B"] / htj2k[n])
        out[n] = row
    two = [n for n, x in out.items() if x["x2"]["share"] is None or not 0.22 <= x["x2"]["share"] <= 0.55]
    one = [n for n, x in out.items() if x["x1"]["share"] is None or not 0.45 <= x["x1"]["share"] <= 0.80]
    return dict(volumes=out, x2_outside=two, x1_outside=one, refuted=bool(two or one))


def r9(series, cells, summary):
    curves = defaultdict(dict)
    lines = (HERE / "rows/curves.tsv").read_text().splitlines()
    head = lines[0].split("\t")
    for line in lines[1:]:
        r = dict(zip(head, line.split("\t")))
        if r["form"] in STORED and r["g"] == "1":
            curves[r["set"]][int(r["q"])] = float(r["ratio"])
    out = {}
    for n, v in summary.items():
        s, q = series[n], v["g"]["1"]["rule pooled"]["q"]
        rule = curves[n].get(q)
        if rule is None:
            rule = s["bits_stored"] * s["frames"] * s["width"] * s["height"] * s["channels"] / (
                8 * sum(rule_cell(cells, n, q)["units"]))
        out[n] = dict(depth=s["b"], q8=curves[n][8], rule_q=q, rule=rule, rule_on_ladder=q in curves[n])
    miss = [n for n, x in out.items() if (x["depth"] == 12 and x["q8"] <= 25) or (x["depth"] == 10 and x["q8"] >= 15)]
    return dict(volumes=out, misses=miss, refuted=len(miss) >= 2)


def main():
    spec, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    ac = spec_ac(spec.read_text())
    series, cells, htj2k, summary = load()
    assert len(series) == len(summary) == 19
    out = dict(R1=r1(series, cells, summary), R2=r2(series, cells, summary), R3=r3(series, cells, summary, ac),
               R4=r4(series, cells, summary), R5=r5(), R6=r6(series, cells, ac), R7=r7(series, cells, ac),
               R8=r8(series, cells, htj2k, ac), R9=r9(series, cells, summary),
               model_check={f"{x}": model(x, x / 2) for x in (1, 2, 3, 4, 4.8, 6)})
    out_path.write_text(json.dumps(out, indent=1, default=float) + "\n")


if __name__ == "__main__":
    main()
