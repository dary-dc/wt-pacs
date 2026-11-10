#!/usr/bin/env python3
"""The groups protocol's collector (docs/av1/groups.md §Collector): every cell, the BD-rates and ε, the OQ points
and the quality guard, the noise swap, the in-order decode, P1–P10 and §7's verdict, as markdown; refuses a cell
missing against plan.json unless --partial.

usage: collect.py ROWS.jsonl ... [--decode DECODE.json ...] [--partial] [--svg DIR]
"""
import argparse
import importlib.util
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import plan  # noqa: E402
from bd import bd_rate  # noqa: E402

_spec = importlib.util.spec_from_file_location("metrics_collect", HERE.parent / "metrics/collect.py")
metrics = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(metrics)

STUDY_ROWS = sorted((HERE.parent / "metrics/rows").glob("shard-*.jsonl"))
CURVES = [("O", 1), ("O", 8), ("O", 16), ("O", 32), ("A", 16), ("AT", 16), ("AT", 32), ("AD", 16), ("AQ", 16),
          ("L", 16), ("R", 16), ("I", 1)]
ARF_ARMS = [("A", 16), ("AT", 16), ("AT", 32), ("AD", 16), ("AQ", 16)]
AA_LIMIT = math.log(1.05)
SCROLL_MS = 1000 / 15


def load(paths):
    series, rho, cells, failed = {}, {}, {}, []
    for p in paths:
        for line in Path(p).open():
            r = json.loads(line)
            if r["kind"] == "series":
                series[r["set"]] = r
            elif r["kind"] == "rho":
                rho[r["set"]] = r
            elif r["kind"] == "cell":
                cells[(r["set"], r["arm"], r["g"], r["q"], r["src"])] = r
            elif r["kind"] == "failed":
                failed.append(r)
    return series, rho, cells, failed


def htj2k(name, first, n):
    for p in STUDY_ROWS:
        for line in p.open():
            if '"control"' in line and f'"{name}"' in line and '"htj2k"' in line:
                r = json.loads(line)
                return sum(r["bytes"][first:first + n])
    return None


def psnr_in(s, r):
    peak = (1 << s["b"]) - 1
    v = [10 * math.log10(peak * peak / f["mse_in"]) if f["mse_in"] else math.inf for f in r["frames"]]
    return float(np.median(v)), float(min(v))


def p_over_k(r):
    keys = r["headers"]["keyframes"]
    if len(keys) == len(r["units"]):
        return None
    ratio = [n / r["units"][max(k for k in keys if k <= i)] for i, n in enumerate(r["units"]) if i not in keys]
    return float(np.median(ratio))


def keyframe_noise(s, r):
    """e_N/σ on the keyframes alone, median over them."""
    keys = r["headers"]["keyframes"]
    return float(np.median([r["frames"][k]["err_noise_band"] / s["sigma"][k] for k in keys]))


def summarise(series, cells):
    out = {}
    for (name, arm, g, q, src), r in cells.items():
        s = series[name]
        m = metrics.summary(s, r)
        pin, pin_min = psnr_in(s, r)
        kap = None
        if r.get("kappa"):
            kap = [float(np.median([f[lv] for f in r["kappa"]])) for lv in range(len(r["kappa"][0]))]
        out[(name, arm, g, q, src)] = dict(
            bytes=m["bytes"], psnr_in=pin, psnr_in_min=pin_min, psnr=m["psnr_med"], psnr_min=m["psnr_min"],
            en_med=m["nb_sigma_med"], en_max=m["nb_sigma_max"], jod=m["jod"], ge1=m["w0"]["ge1_max"],
            ge2=m["w0"]["ge2_max"], kappa=kap, pk=p_over_k(r), hidden=r["headers"]["hidden"],
            existing=r["headers"]["shown_existing"], coded_max=r["headers"]["coded_per_unit_max"],
            key_en=keyframe_noise(s, r), q_hist=r["q_hist"], clipped=r.get("clipped", 0), cpu=r["cell_cpu"],
            rss=r["encode_rss_kb"] / 1e6)
    return out


def fmt(v, d=2):
    if v is None:
        return "—"
    if isinstance(v, float) and not math.isfinite(v):
        return "∞"
    return f"{v:.{d}f}" if isinstance(v, float) else str(v)


def pct(v, d=1):
    return "—" if v is None else f"{100 * v:+.{d}f} %"


def cell_table(name, S, ref):
    lines = ["| arm | G | Q | source | bytes | ÷ HTJ2K | P/K | PSNR in, med · worst | PSNR, med · worst | e_N/σ, med · max "
             "| keyframes e_N/σ | JOD | ≥ 1 · ≥ 2 levels, worst frame | κ_0 · κ_1 · κ_2 · κ_3 | hidden · shown existing |",
             "| --- | --: | --: | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- | --: |"]
    for k in sorted((k for k in S if k[0] == name), key=lambda k: (k[4] != "real", k[4], k[1], k[2], k[3])):
        c = S[k]
        kap = " · ".join(fmt(x) for x in c["kappa"]) if c["kappa"] else "—"
        lines.append(f"| {k[1]} | {k[2]} | {k[3]} | {k[4]} | {c['bytes']} | {fmt(c['bytes'] / ref, 3) if ref else '—'} "
                     f"| {fmt(c['pk'])} | {fmt(c['psnr_in'])} · {fmt(c['psnr_in_min'])} | {fmt(c['psnr'])} · "
                     f"{fmt(c['psnr_min'])} | {fmt(c['en_med'], 3)} · {fmt(c['en_max'], 3)} | {fmt(c['key_en'], 3)} "
                     f"| {fmt(c['jod'])} | {fmt(c['ge1'], 3)} · {fmt(c['ge2'], 4)} | {kap} | {c['hidden']} · {c['existing']} |")
    return lines


def curve(S, name, arm, g, src="real", key="psnr_in"):
    return [(c[key], c["bytes"]) for k, c in S.items() if k[:3] == (name, arm, g) and k[4] == src
            and k[3] != plan.NOISE_PROXY_Q and c[key] is not None]


def vl(S, name):
    a, b = S.get((name, "O", 1, 12, "real")), S.get((name, "O", 1, 4, "real"))
    return (a["psnr_in"], b["psnr_in"]) if a and b else None


def epsilon(S, names):
    worst, parts = 0.0, []
    for name in names:
        lo_hi = vl(S, name)
        if not lo_hi:
            continue
        for g in (1, 16):
            full = curve(S, name, "O", g)
            for q in (4, 6, 8, 10, 12):
                thin = [(c["psnr_in"], c["bytes"]) for k, c in S.items()
                        if k[:3] == (name, "O", g) and k[4] == "real" and k[3] not in (q, plan.NOISE_PROXY_Q)]
                v = bd_rate(thin, full, *lo_hi)
                if v is not None:
                    parts.append((name, g, q, v))
                    worst = max(worst, abs(v))
    return worst, parts


def oq_point(S, name, arm, g):
    ok = sorted(k[3] for k, c in S.items() if k[:3] == (name, arm, g) and k[4] == "real" and k[3] != plan.NOISE_PROXY_Q
                and c["en_max"] <= 1)
    return ok[-1] if ok else None


def guard(S, name, arm, g):
    """§7's quality guard at the arm's OQ point against O G 1's, each margin one rung of O G 1's own curve."""
    q0, q = oq_point(S, name, "O", 1), oq_point(S, name, arm, g)
    if q0 is None or q is None:
        return None
    rungs = sorted(k[3] for k in S if k[:3] == (name, "O", 1) and k[4] == "real" and k[3] != plan.NOISE_PROXY_Q)
    up = next((r for r in rungs if r > q0), None)
    ref, nxt, c = S[(name, "O", 1, q0, "real")], S.get((name, "O", 1, up, "real")), S[(name, arm, g, q, "real")]
    if nxt is None or ref["jod"] is None or c["jod"] is None:
        return dict(q=q, q_ref=q0, holds=None)
    jod_margin, ge2_margin = ref["jod"] - nxt["jod"], nxt["ge2"] - ref["ge2"]
    holds = c["jod"] >= ref["jod"] - jod_margin and c["ge2"] <= ref["ge2"] + ge2_margin
    return dict(q=q, q_ref=q0, bytes=c["bytes"], bytes_ref=ref["bytes"], jod=c["jod"], jod_ref=ref["jod"],
                jod_margin=jod_margin, ge2=c["ge2"], ge2_ref=ref["ge2"], ge2_margin=ge2_margin, holds=holds)


def gain(S, name, q, src="real", g=16, arm="O"):
    a, b = S.get((name, arm, 1, q, src)), S.get((name, arm, g, q, src))
    return 1 - b["bytes"] / a["bytes"] if a and b else None


def binom_interval(v):
    """The median's distribution-free 95 % interval: order statistics from the binomial(n, ½) tails."""
    v = sorted(v)
    n = len(v)
    k, tail = 0, 0.0
    while True:
        nxt = tail + math.comb(n, k) / 2 ** n
        if nxt > 0.025:
            break
        tail, k = nxt, k + 1
    return (v[k - 1], v[n - k]) if k >= 1 else (None, None)


def decode_stats(rows):
    """Per (series, unit): per-round mean, p95, slowest and median ms a frame; rounds with a missed hash void."""
    void = {(r["round"], r["set"]) for r in rows if r["error"] or r["matched"] != r["frames"]}
    per = defaultdict(dict)
    for r in rows:
        if (r["round"], r["set"]) in void or not r["ms"]:
            continue
        ms = np.asarray(r["ms"])
        per[(r["set"], r["unit"])][r["round"]] = dict(
            mean=float(ms.mean()), p95=float(np.percentile(ms, 95)), max=float(ms.max()), med=float(np.median(ms)),
            slow_at=int(np.argmax(ms)) % r["g"])
    return per, void


def ratio(per, name, unit, ref, stat):
    a, b = per.get((name, unit), {}), per.get((name, ref), {})
    v = [math.log(a[k][stat] / b[k][stat]) for k in sorted(set(a) & set(b))]
    if len(v) < 2:
        return None
    lo, hi = binom_interval(v)
    return dict(n=len(v), med=float(np.median(v)), lo=lo, hi=hi)


def decode_tables(rows, names):
    per, void = decode_stats(rows)
    out, res = [], {}
    for name in names:
        units = sorted({u for (s, u) in per if s == name})
        decs = sorted({u.split("|")[3] for u in units})
        if not units:
            continue
        rounds = len({k for u in units for k in per[(name, u)]})
        out += [f"\n**`{name}`**, {rounds} rounds kept, {len({r for r, s in void if s == name})} void.\n",
                "| stream | decoder | ms a frame: mean · median · p95 · slowest (medians over rounds) | slowest at group "
                "position | mean ÷ O G 1 (95 % interval) | p95 ÷ O G 1 (95 % interval) |",
                "| --- | --- | --- | --- | --: | --: |"]
        for dec in decs:
            anchor = next(u for u in units if u.startswith("O|G1|") and u.endswith(dec))
            aa = {s: ratio(per, name, f"O'|{anchor[2:]}", anchor, s) for s in ("mean", "p95")}
            res[(name, dec, "A/A")] = aa
            for u in [x for x in units if x.endswith(dec)]:
                d = per[(name, u)]
                med = lambda s: float(np.median([x[s] for x in d.values()]))
                pos = sorted(x["slow_at"] for x in d.values())
                rm, rp = (ratio(per, name, u, anchor, s) for s in ("mean", "p95"))
                res[(name, dec, u)] = dict(mean=med("mean"), p95=med("p95"), max=med("max"), med=med("med"),
                                           ratio_mean=rm, ratio_p95=rp)
                show = lambda x: "—" if not x else f"{math.exp(x['med']):.3f} ({math.exp(x['lo']):.3f}–{math.exp(x['hi']):.3f})"
                out.append(f"| {u.rsplit('|', 1)[0]} | {dec} | {med('mean'):.1f} · {med('med'):.1f} · {med('p95'):.1f} · "
                           f"{med('max'):.1f} | {pos[len(pos) // 2]} | {show(rm)} | {show(rp)} |")
            a = aa["mean"]
            if a:
                beyond = a["lo"] > AA_LIMIT or a["hi"] < -AA_LIMIT
                res[(name, dec, "void")] = beyond
                out.append(f"\nA/A ({dec}): O′ ÷ O mean {math.exp(a['med']):.3f} ({math.exp(a['lo']):.3f}–"
                           f"{math.exp(a['hi']):.3f}); {'**beyond ±5 %: this series’ cells are void**' if beyond else 'inside ±5 %'}.")
    return out, res


def svg(S, name, path):
    pts = {k: sorted(curve(S, name, *k)) for k in CURVES if curve(S, name, *k)}
    if not pts:
        return
    xs = [x for v in pts.values() for x, _ in v if math.isfinite(x)]
    ys = [math.log(b) for v in pts.values() for _, b in v]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    W, H, P = 720, 440, 50
    sx = lambda x: P + (x - x0) / (x1 - x0 or 1) * (W - 2 * P)
    sy = lambda y: H - P - (y - y0) / (y1 - y0 or 1) * (H - 2 * P)
    colours = ["#2a6fdb", "#7a9cd6", "#1b3f80", "#0b1f40", "#d9822b", "#c2410c", "#7c2d12", "#16a34a", "#9333ea",
               "#6b7280", "#be123c", "#0891b2"]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="sans-serif" font-size="11">',
             f'<rect width="{W}" height="{H}" fill="white"/>',
             f'<text x="{W / 2}" y="{H - 10}" text-anchor="middle">median in-window PSNR, dB</text>',
             f'<text x="12" y="{H / 2}" transform="rotate(-90 12 {H / 2})" text-anchor="middle">ln bytes</text>',
             f'<text x="{P}" y="20">{name}: every arm, real source</text>']
    for i, (k, v) in enumerate(pts.items()):
        d = " ".join(f"{sx(x):.1f},{sy(math.log(b)):.1f}" for x, b in v if math.isfinite(x))
        parts.append(f'<polyline fill="none" stroke="{colours[i % 12]}" stroke-width="1.5" points="{d}"/>')
        parts.append(f'<text x="{W - P + 4}" y="{P + 14 * i}" fill="{colours[i % 12]}">{k[0]} G {k[1]}</text>')
    path.write_text("\n".join(parts + ["</svg>"]) + "\n")


def missing(series, cells, partial_sets):
    p = json.loads((HERE / "plan.json").read_text())
    out = []
    for shard in p["shards"].values():
        for name, keys in shard["cells"].items():
            if name == plan.PILOT:
                continue
            have = {plan.key(name, dict(arm=k[1], g=k[2], q=k[3], src=k[4])) for k in cells if k[0] == name}
            out += [k for k in keys if k not in have]
    return out


def held(ok, refuted):
    return "**refuted**" if refuted else "held" if ok else "not held, not refuted"


def predictions(S, rho, names, eps, dec):
    lines = []
    dbt = [n for n in names if n in plan.DBT]
    for n in dbt:
        r, x = gain(S, n, 8), gain(S, n, 8, "X")
        sg, cg = gain(S, n, 8, "S"), gain(S, n, 8, "C")
        s_share = S[(n, "O", 1, 8, "S")]["bytes"] / S[(n, "O", 1, 8, "real")]["bytes"]
        ok = -0.02 <= r <= 0.02 and abs(x - r) <= 0.03 and sg >= 0.30 and cg >= 0.30 and s_share <= 0.35
        ref = sg < 0.15 or abs(x - r) > 0.03 or s_share > 0.50
        lines.append(f"| P1 | `{n}` | G 16 gain at Q 8: real {pct(r)}, X {pct(x)}, S {pct(sg)}, C {pct(cg)}; S ÷ real "
                     f"bytes at G 1 {100 * s_share:.1f} % | {held(ok, ref)} |")
        kq8 = S[(n, "O", 1, 8, "real")]["kappa"]
        kq16 = S[(n, "O", 1, 16, "real")]["kappa"]
        rb = [b["med"] for b in rho[n]["bands"]] if n in rho else None
        rising = rb is not None and all(b is not None for b in rb) and all(a < b for a, b in zip(rb, rb[1:]))
        ok = kq8[0] >= 0.8 and min(kq8[1:]) <= 0.5 and all(k >= 0.8 for k in kq16[:3]) and rb and rb[0] is not None \
            and 0.05 <= rb[0] <= 0.30 and rising
        kept = [lv for lv, k in enumerate(kq8) if k <= 0.5]
        ref = any(rb[lv] is not None and rb[lv] >= math.sqrt(1 - kq8[lv]) / 2 for lv in kept) and r < 0.05 or not rising
        lines.append(f"| P2 | `{n}` | κ at Q 8: {' · '.join(fmt(k) for k in kq8)}; at Q 16: "
                     f"{' · '.join(fmt(k) for k in kq16)}; ρ_ℓ (best offset, median): "
                     f"{' · '.join(fmt(b, 3) for b in rb) if rb else '—'} | {held(ok, ref)} |")
        oks, refs, parts = [], [], []
        for q in plan.LADDER:
            c, gq = S.get((n, "O", 1, q, "real")), gain(S, n, q)
            if not c or gq is None:
                continue
            kept = min(c["kappa"][:3]) <= 0.5
            parts.append(f"Q {q} {pct(gq)}{' (kept band)' if kept else ''}")
            oks.append(gq <= 0.03 if kept else gq >= 0.06)
            refs.append(gq > 0.06 if kept else gq < 0.03)
        lines.append(f"| P3 | `{n}` | {'; '.join(parts)} | {held(all(oks), any(refs))} |")
    for n in dbt:
        se = (S[(n, "O", 1, 8, "S")]["bytes"] / S[(n, "O", 1, 8, "real")]["bytes"]) * gain(S, n, 8, "S")
        lo_hi = vl(S, n)
        vals = {f"{a} G {g}": bd_rate(curve(S, n, a, g), curve(S, n, "O", 1), *lo_hi) for a, g in ARF_ARMS}
        ok = all(v is not None and -0.15 <= v <= 0.05 for v in vals.values())
        ref = any(v is not None and v < -se - eps for v in vals.values())
        lines.append(f"| P4 | `{n}` | BD-rate vs O G 1 in [{lo_hi[0]:.2f}, {lo_hi[1]:.2f}] dB: "
                     f"{'; '.join(f'{k} {pct(v)}' for k, v in vals.items())}; −(s · e) − ε = {pct(-se - eps)} | {held(ok, ref)} |")
        ad = [S[(n, "AD", 16, q, "real")]["key_en"] for q in (4, 6, 8)]
        a = [S[(n, "A", 16, q, "real")]["key_en"] for q in (4, 6, 8)]
        ok = all(x >= 1.0 for x in ad) and all(x <= 0.9 for x in a)
        ref = all(x <= y + 0.05 for x, y in zip(ad, a))
        lines.append(f"| P5 | `{n}` | keyframes' e_N/σ at Q 4 · 6 · 8: AD {' · '.join(fmt(x, 3) for x in ad)}, A "
                     f"{' · '.join(fmt(x, 3) for x in a)} | {held(ok, ref)} |")
        diffs = [(q, S[(n, "AT", 16, q, "real")]["bytes"] / S[(n, "A", 16, q, "real")]["bytes"] - 1,
                  S[(n, "AT", 16, q, "real")]["psnr_in"] - S[(n, "A", 16, q, "real")]["psnr_in"]) for q in plan.LADDER]
        ok = all(abs(b) <= 0.03 and abs(p) <= 0.1 for _, b, p in diffs)
        lines.append(f"| P6 | `{n}` | AT ÷ A − 1, ΔPSNR in: {'; '.join(f'Q {q} {pct(b)}, {p:+.2f} dB' for q, b, p in diffs)} "
                     f"| {held(ok, not ok)} |")
        low = [(q, S[(n, "O", 32, q, "real")]["bytes"] / S[(n, "O", 16, q, "real")]["bytes"] - 1,
                S[(n, "O", 16, q, "real")]["pk"]) for q in plan.LADDER if q <= 8]
        pk24 = S[(n, "O", 16, 24, "real")]["pk"]
        ok = all(abs(b) <= 0.01 and pk >= 0.95 for _, b, pk in low) and pk24 <= 0.6
        lines.append(f"| P7 | `{n}` | G 32 ÷ G 16 − 1, P/K (G 16): {'; '.join(f'Q {q} {pct(b)}, {fmt(pk, 3)}' for q, b, pk in low)}; "
                     f"P/K at Q 24 {fmt(pk24, 3)} | {held(ok, not ok)} |")
        i_bd = bd_rate(curve(S, n, "I", 1), curve(S, n, "O", 1), *lo_hi)
        r_bd = bd_rate(curve(S, n, "R", 16), curve(S, n, "O", 16), *lo_hi)
        o3 = gain(S, n, 8, arm="O3")
        at3 = S.get((n, "AT3", 16, 8, "real"))
        at3r = at3["bytes"] / S[(n, "AT", 16, 8, "real")]["bytes"] - 1 if at3 else None
        if o3 is None or at3r is None:
            lines.append(f"| P8 | `{n}` | I vs O G 1 {pct(i_bd)}; R G 16 vs O G 16 {pct(r_bd)}; O3/AT3 not run | partly not run |")
        else:
            ok = i_bd is not None and abs(i_bd) <= 0.03 and r_bd is not None and 0 <= r_bd <= 0.15 and o3 < 0.03 and abs(at3r) <= 0.05
            lines.append(f"| P8 | `{n}` | I vs O G 1 {pct(i_bd)}; R G 16 vs O G 16 {pct(r_bd)}; O3 G 16 gain at Q 8 "
                         f"{pct(o3)}; AT3 ÷ AT − 1 {pct(at3r)} | {held(ok, not ok)} |")
    for n in names:
        if n not in plan.TRUS:
            continue
        lo_hi = vl(S, n)
        v = bd_rate(curve(S, n, "AT", 16), curve(S, n, "O", 16), *lo_hi)
        lines.append(f"| P9 | `{n}` | AT G 16 vs O G 16 {pct(v)} | {held(v is not None and v <= -0.05, v is None or v > 0)} |")
    for n in names:
        if n not in plan.DBT:
            continue
        for d in ("dav1d", "webcodecs"):
            lim = (0.9, 1.3) if d == "dav1d" else (1.0, 1.25)
            got = {k: dec.get((n, d, f"{k}|Q8|{d}")) for k in ("O|G16", "O|G32", "AT|G16", "AT|G32", "AD|G16")}
            if not any(got.values()):
                continue
            r = {k: math.exp(v["ratio_mean"]["med"]) if v and v["ratio_mean"] else None for k, v in got.items()}
            same_g = {k: (got[k]["mean"] / got[f"O|G{k.split('|G')[1]}"]["mean"]) if got.get(k) and got.get(f"O|G{k.split('|G')[1]}") else None
                      for k in ("AT|G16", "AT|G32", "AD|G16")}
            slow = {k: got[k]["max"] / got[k]["med"] if got.get(k) else None for k in same_g}
            ok = all(v is None or lim[0] <= v <= lim[1] for k, v in r.items() if k.startswith("O")) and \
                all(v is None or 0.9 <= v <= 1.3 for v in same_g.values()) and all(v is None or v >= 2 for v in slow.values())
            ref = any(v is not None and v < 1.5 for v in slow.values()) or not ok
            lines.append(f"| P10 | `{n}`, {d} | ÷ O G 1 mean: {'; '.join(f'{k} {fmt(v, 3)}' for k, v in r.items())}; "
                         f"ARF ÷ O same G: {'; '.join(f'{k} {fmt(v, 3)}' for k, v in same_g.items())}; slowest ÷ median: "
                         f"{'; '.join(f'{k} {fmt(v, 2)}' for k, v in slow.items())} | {held(ok, ref)} |")
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows", nargs="+")
    ap.add_argument("--decode", nargs="*", default=[])
    ap.add_argument("--partial", action="store_true")
    ap.add_argument("--svg", type=Path)
    a = ap.parse_args()
    series, rho, cells, failed = load(a.rows)
    gone = missing(series, cells, a.partial)
    if gone and not a.partial:
        sys.exit(f"{len(gone)} cells missing, e.g. {gone[:5]}; --partial to collect what is there")
    S = summarise(series, cells)
    names = [n for n in series if n != plan.PILOT]
    eps, parts = epsilon(S, [n for n in names if n in plan.DBT])
    rows = [r for p in a.decode for r in json.loads(Path(p).read_text())]
    out = [f"*{len(cells)} cells, {len(failed)} failed rows, {len(gone)} planned cells missing.*\n"]
    if gone:
        missing_sets = defaultdict(int)
        for k in gone:
            missing_sets[k.split("|")[0]] += 1
        out.append("Missing, by series: " + ", ".join(f"`{k}` {v}" for k, v in missing_sets.items()) + ".\n")
    for f in failed:
        out.append(f"* failed: `{f['set']}` {f['arm']} G {f['g']} Q {f['q']} {f['src']}: {f['error'][:160]}")
    for n in names:
        s = series[n]
        ref = htj2k(n, s["first"], s["frames"])
        out += [f"\n#### `{n}` ({s['frames']} frames from {s['first']}, {s['width']} × {s['height']} × {s['channels']}, "
                f"{s['b']}-bit; HTJ2K reference {ref} B)\n"] + cell_table(n, S, ref)
        if n in rho:
            out.append("\nρ_ℓ of the noise proxy between neighbours, offset 0 and best offset within ±8 (median · 90th "
                       "percentile; blocks): " + "; ".join(
                           f"ℓ {lv}: {fmt(b['zero_med'], 3)} · {fmt(b['zero_p90'], 3)}, {fmt(b['med'], 3)} · {fmt(b['p90'], 3)} "
                           f"({b['blocks']})" for lv, b in enumerate(rho[n]["bands"])) +
                       f". Samples clipped in the swaps: X {rho[n]['clipped']['X']}, C {rho[n]['clipped']['C']}.")
        lo_hi = vl(S, n)
        if lo_hi:
            out += [f"\nVL interval {lo_hi[0]:.2f}–{lo_hi[1]:.2f} dB (in-window PSNR of O G 1 at Q 12 and Q 4).\n",
                    "| arm | G | BD-rate vs O G 1 (in-window) | vs O G 16 | vs O G 1, full-frame PSNR | vs O G 1, JOD | OQ point | "
                    "guard vs O G 1 |", "| --- | --: | --: | --: | --: | --: | --- | --- |"]
            for arm, g in CURVES:
                if not curve(S, n, arm, g):
                    continue
                v1 = bd_rate(curve(S, n, arm, g), curve(S, n, "O", 1), *lo_hi)
                v16 = bd_rate(curve(S, n, arm, g), curve(S, n, "O", 16), *lo_hi)
                c12, c4 = S.get((n, "O", 1, 12, "real")), S.get((n, "O", 1, 4, "real"))
                full = bd_rate(curve(S, n, arm, g, key="psnr"), curve(S, n, "O", 1, key="psnr"), c12["psnr"], c4["psnr"])
                jod = None
                if c12["jod"] is not None and c4["jod"] is not None:
                    jod = bd_rate(curve(S, n, arm, g, key="jod"), curve(S, n, "O", 1, key="jod"), c12["jod"], c4["jod"])
                oq = oq_point(S, n, arm, g)
                gd = guard(S, n, arm, g)
                gtxt = "—" if not gd else ("no JOD" if gd["holds"] is None else
                                           f"{'holds' if gd['holds'] else '**fails**'} (JOD {gd['jod']:.2f} vs {gd['jod_ref']:.2f} − "
                                           f"{gd['jod_margin']:.2f}; ≥ 2 {gd['ge2']:.4f} vs {gd['ge2_ref']:.4f} + {gd['ge2_margin']:.4f})")
                oqt = "—" if oq is None else f"Q {oq}, {S[(n, arm, g, oq, 'real')]['bytes']} B"
                out.append(f"| {arm} | {g} | {pct(v1)} | {pct(v16)} | {pct(full)} | {pct(jod)} | {oqt} | {gtxt} |")
        if n in plan.DBT:
            out += ["\n| source | G 16 gain at Q 4 · 8 · 12 | G 1 bytes ÷ real at Q 4 · 8 · 12 |", "| --- | --- | --- |"]
            for src in ("real", "S", "X", "C"):
                gs = " · ".join(pct(gain(S, n, q, src)) for q in (4, 8, 12))
                sh = " · ".join(fmt(S[(n, "O", 1, q, src)]["bytes"] / S[(n, "O", 1, q, "real")]["bytes"], 3)
                                if (n, "O", 1, q, src) in S and (n, "O", 1, q, "real") in S else "—" for q in (4, 8, 12))
                out.append(f"| {src} | {gs} | {sh} |")
            if all(k in S for k in ((n, "O", 1, 8, "S"), (n, "O", 16, 8, "S"), (n, "O", 1, 8, "real"))):
                s_ = S[(n, "O", 1, 8, "S")]["bytes"] / S[(n, "O", 1, 8, "real")]["bytes"]
                e_ = gain(S, n, 8, "S")
                out.append(f"\ns = {s_:.3f}, e = {e_:.3f}, bound s · e = {100 * s_ * e_:.1f} % of O G 1's bytes at Q 8.")
        if a.svg:
            a.svg.mkdir(parents=True, exist_ok=True)
            svg(S, n, a.svg / f"{n}.svg")
    out.append(f"\n**ε** = {100 * eps:.2f} % (largest |BD-rate| of a thinned O G 1 or O G 16 curve against its full curve, "
               f"{len(parts)} thinnings on {', '.join(sorted({p[0] for p in parts})) or 'no volume'}).")
    dec_lines, dec = decode_tables(rows, names)
    if dec_lines:
        out += ["\n**Decode in order**, ms a frame (handed in to shown frame copied out), 1×, one host:"] + dec_lines
    out += ["\n| # | series | deciding numbers | outcome |", "| --- | --- | --- | --- |"]
    try:
        out += predictions(S, rho, names, eps, dec)
    except (KeyError, TypeError) as e:
        out.append(f"| — | — | predictions stopped at a missing cell: {e!r} | — |")
    print("\n".join(out))


if __name__ == "__main__":
    main()
