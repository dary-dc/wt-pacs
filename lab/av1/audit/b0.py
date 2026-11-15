#!/usr/bin/env python3
"""Protocol B0 of docs/av1/audit-protocols.md (amendment 1): anchors, x* and rule Q re-read from committed rows.

usage: b0.py IN_DIR OUT_JSON [--mutate-8bit]
IN_DIR holds shard-{1,2,3,4}.jsonl, arms.jsonl and libaom v3.15.1 quant_common.c (commands: lab/av1/audit/README.md).
"""
import json
import re
import sys
from pathlib import Path

DBT = ["dbts_a1", "dbts_a2", "dbts_a3", "dbts_a4", "dbts_a5", "dbts_b1", "dbts_b2", "dbts_b3", "dbts_b4", "dbts_b5",
       "dbts_c1", "dbts_c2", "dbts_c3", "dbts_c4", "dbts_c5", "dbt12_c", "dbt12_ea1141", "dbt10_d", "dbt10_ea1141"]
HELD_OUT = ["dbts_a3", "dbts_a4", "dbts_a5", "dbts_b4", "dbt10_d"]
IN_SAMPLE = [n for n in DBT if n not in HELD_OUT]
LADDER = [1, 2, 4, 8, 12, 16, 24, 32, 40, 56]
X_STAR_NOISE_POINT = {1: 4.9293, 16: 4.6359}
BARS = (1.00, 1.03)
QA_F1 = {  # audit-quality.md §Notes, F1: bar → (G 1 Q, G 16 Q) on the stored form
    "dbts_a1": {1.00: (4, 4), 1.03: (8, 8)}, "dbts_a2": {1.00: (4, 4), 1.03: (8, 8)},
    "dbts_a5": {1.00: (4, 8), 1.03: (8, 8)}, "dbts_b1": {1.00: (12, 8), 1.03: (12, 12)},
    "dbts_b2": {1.00: (8, 8), 1.03: (16, 12)}, "dbts_b3": {1.00: (12, 12), 1.03: (16, 16)},
    "dbts_b4": {1.00: (12, 12), 1.03: (16, 16)}, "dbts_b5": {1.00: (8, 8), 1.03: (12, 12)},
    "dbt10_d": {1.00: (12, 12), 1.03: (16, 16)}, "dbt10_ea1141": {1.00: (12, 12), 1.03: (16, 16)},
    **{n: {1.00: (8, 8), 1.03: (8, 8)} for n in
       ["dbts_c1", "dbts_c2", "dbts_c3", "dbts_c4", "dbts_c5", "dbt12_c", "dbt12_ea1141", "dbts_a3", "dbts_a4"]},
}


def ac_tables(path):
    text = path.read_text()
    table = lambda name: [int(v) for v in re.findall(
        r"-?\d+", re.search(rf"{name}\[[^\]]*\]\s*=\s*\{{(.*?)\}};", text, re.S).group(1))]
    return {8: table("ac_qlookup_QTX"), 10: table("ac_qlookup_10_QTX"), 12: table("ac_qlookup_12_QTX")}


def load(in_dir):
    series, cells, htj2k, clashes = {}, {}, {}, []
    for k in (1, 2, 3, 4):
        for line in open(in_dir / f"shard-{k}.jsonl"):
            r = json.loads(line)
            if r["kind"] == "series":
                series[r["set"]] = r
            elif r["kind"] == "cell":
                cells[(r["set"], r["form"], r["q"], r["g"])] = dict(r, source="ladder")
            elif r["kind"] == "control" and r["codec"] == "htj2k":
                htj2k[r["set"]] = sum(r["bytes"])
    for line in open(in_dir / "arms.jsonl"):
        r = json.loads(line)
        key = (r["set"], r["form"], r["q"], r["g"])
        if key in cells:
            if sum(cells[key]["units"]) != sum(r["units"]):
                clashes.append(dict(cell=key, ladder=sum(cells[key]["units"]), arm=sum(r["units"])))
        else:
            cells[key] = dict(r, source="arm")
    return series, cells, htj2k, clashes


def stream(s, form):
    """(σ divisor, stream depth B) for a stored or top-10 form."""
    return (2 ** (s["b"] - 10), 10) if form == "top10" else (1, 10 if s["b"] in (9, 10) else s["b"])


def forms(s):
    return [f"{s['b']}bit"] + (["top10"] if s["b"] > 10 else [])


def points(series, cells, ac, names, gs, table_depth=None):
    """Every frame as (x, y, volume, form, Q, G, frame, B)."""
    out = []
    for (name, form, q, g), r in cells.items():
        if name not in names or g not in gs or form not in forms(series[name]):
            continue
        div, depth = stream(series[name], form)
        step = ac[table_depth or depth][4 * q] / 8
        for i, (f, sig) in enumerate(zip(r["frames"], series[name]["sigma"])):
            out.append((step / (sig / div), f["err_noise_band"] / sig, name, form, q, g, i, depth))
    return out


def x_star(pts):
    fail = [p for p in pts if p[1] > 1]
    if not fail:
        return None
    p = min(fail)
    return dict(x=p[0], x4=int(p[0] * 1e4) / 1e4, y=p[1], volume=p[2], form=p[3], q=p[4], g=p[5], frame=p[6],
                x_hi=max(q[0] for q in pts if q[1] <= 1))


def worst(cell, s):
    return max(f["err_noise_band"] / sig for f, sig in zip(cell["frames"], s["sigma"]))


def anchor(series, cells, htj2k, name, form, g, bar):
    best = None
    for q in LADDER:
        c = cells.get((name, form, q, g))
        if c is None or worst(c, series[name]) > bar:
            break
        best = dict(q=q, worst=worst(c, series[name]), bytes_ratio=sum(c["units"]) / htj2k[name])
    return best


def rule_q(s, form, g_x_star, ac, ladder):
    div, depth = stream(s, form)
    sig = min(s["sigma"]) / div
    ok = [q for q in (LADDER if ladder else range(1, 62)) if ac[depth][4 * q] / 8 < g_x_star * sig]
    return max(ok) if ok else None


def main():
    in_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
    ac = ac_tables(in_dir / "quant_common.c")
    table_depth = 8 if "--mutate-8bit" in sys.argv[3:] else None
    series, cells, htj2k, clashes = load(in_dir)
    pts = lambda names, gs, depth=None: [p for p in points(series, cells, ac, names, gs, table_depth)
                                         if depth is None or p[7] == depth]
    in_sample = {g: x_star(pts(IN_SAMPLE, {g})) for g in (1, 16)}
    held_g1 = x_star([p for p in pts(DBT, {1}) if p[2] in IN_SAMPLE or cells[(p[2], p[3], p[4], 1)]["source"] == "arm"])
    xs = dict(per_g={g: x_star(pts(DBT, {g})) for g in (1, 8, 16)},
              pooled=x_star(pts(DBT, {1, 16})), pooled_with_g8=x_star(pts(DBT, {1, 8, 16})),
              per_depth={d: x_star(pts(DBT, {1, 16}, d)) for d in (10, 12)})

    anchors, f1_misses = [], []
    for name in DBT:
        form = forms(series[name])[0]
        row = dict(volume=name, bits=series[name]["b"])
        for bar in BARS:
            for g in (1, 16):
                row[f"{bar:.2f}/G{g}"] = anchor(series, cells, htj2k, name, form, g, bar)
            got = tuple(row[f"{bar:.2f}/G{g}"]["q"] if row[f"{bar:.2f}/G{g}"] else None for g in (1, 16))
            if got != QA_F1[name][bar]:
                f1_misses.append(dict(volume=name, bar=bar, rows=got, qa=QA_F1[name][bar]))
        anchors.append(row)

    readings = {"noise point": {1: X_STAR_NOISE_POINT[1], 16: X_STAR_NOISE_POINT[16]},
                "pooled": {g: xs["pooled"]["x4"] for g in (1, 16)},
                "per depth": "per depth"}
    rules = []
    for name in DBT:
        s = series[name]
        for form in forms(s):
            _, depth = stream(s, form)
            for g in (1, 16):
                row = dict(volume=name, form=form, g=g, depth=depth, sigma_min=min(s["sigma"]) / stream(s, form)[0])
                for bar in BARS:
                    a = anchor(series, cells, htj2k, name, form, g, bar)
                    row[f"anchor {bar:.2f}"] = a["q"] if a else None
                for label, xr in readings.items():
                    xv = xs["per_depth"][depth]["x4"] if xr == "per depth" else xr[g]
                    lq, iq = rule_q(s, form, xv, ac, True), rule_q(s, form, xv, ac, False)
                    c = cells.get((name, form, iq, g)) if iq else None
                    row[label] = dict(x_star=xv, ladder=lq, integer=iq,
                                      integer_worst=worst(c, s) if c else None,
                                      integer_bytes_ratio=sum(c["units"]) / htj2k[name] if c else None,
                                      ladder_bytes_ratio=sum(cells[(name, form, lq, g)]["units"]) / htj2k[name]
                                      if lq else None)
                rules.append(row)

    check = dict(in_sample_g1=in_sample[1]["x"], in_sample_g16=in_sample[16]["x"], held_out_g1=held_g1["x"],
                 qa_f1_misses=f1_misses, arm_ladder_byte_clashes=clashes)
    check["held"] = (abs(in_sample[1]["x"] - 4.92935) < 5e-5 and abs(in_sample[16]["x"] - 4.63596) < 5e-5
                     and abs(held_g1["x"] - 4.802) < 5e-4 and not f1_misses and not clashes)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dict(check=check, x_star=xs, anchors=anchors, rules=rules), indent=1, default=str))
    print(json.dumps(check, default=str))
    sys.exit(0 if check["held"] else 1)


if __name__ == "__main__":
    main()
