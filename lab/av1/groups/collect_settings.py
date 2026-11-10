#!/usr/bin/env python3
"""The settings amendment's collector (docs/av1/groups.md §S6–§S7, §S9): every cell, B₁ and ν₁ with ε, the integer
points at 1.00 and 1.03, the guards, the decode table, Q1–Q12 and the verdict, as markdown, for the volumes present.

usage: collect_settings.py ROWS.jsonl ... [--checks CHECKS.json ...] [--decode DECODE.json ...]
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

import anchor
import collect
import plan
from bd import bd_rate

FILTERED = ("AT", "AD", "AF", "AW")
ORDER = ("O", "AU", "AW", "AT", "AD", "AF")


def points(S, nu, name, arm, g):
    return sorted((k[3], c["en_max"], c["bytes"], nu.get(k)) for k, c in S.items()
                  if k[:3] == (name, arm, g) and k[4] == "real" and k[3] != plan.NOISE_PROXY_Q)


def stream(S, nu, name, arm, g):
    p = points(S, nu, name, arm, g)
    r = anchor.read(p)
    r["at100"], r["at103"] = anchor.integer_point(p), anchor.integer_point(p, 1.03)
    r["points"] = p
    return r


def epsilon(R, names):
    worst, parts = 0.0, []
    for n in names:
        for g in (1, 16):
            full = R[(n, "O", g)]["b1"]
            for q, b in anchor.thinned(R[(n, "O", g)]["points"]):
                parts.append((n, g, q, None if b is None or full is None else math.log(b / full)))
                if parts[-1][3] is not None:
                    worst = max(worst, abs(parts[-1][3]))
    return worst, parts


def margins(R, S, nu, name):
    """§S7's guard margins: ν over O G 1's bracketing rungs; JOD and ≥ 2 levels over its integer point and the next."""
    o = R[(name, "O", 1)]
    pts = anchor.kept(o["points"])
    lo = max((p for p in pts if p[1] <= anchor.AT), default=None)
    hi = min((p for p in pts if p[1] > anchor.AT), default=None)
    nu_margin = abs(lo[3] - hi[3]) if lo and hi else None
    return nu_margin, collect.guard(S, name, "O", 1)


def guard(R, S, nu, name, arm, g):
    nu_margin, _ = margins(R, S, nu, name)
    ref, c = R[(name, "O", 1)], R[(name, arm, g)]
    nu_ok = None if None in (nu_margin, ref["nu1"], c["nu1"]) else c["nu1"] >= ref["nu1"] - nu_margin
    q = collect.guard(S, name, arm, g)
    return dict(nu=nu_ok, nu_margin=nu_margin, jod=q and q["holds"], detail=q)


def saving(R, name, arm, g):
    a, b = R[(name, arm, g)]["b1"], R[(name, "O", 1)]["b1"]
    return None if a is None or b is None else 1 - a / b


def bd_psnr(S, name, arm, g):
    a, r = collect.curve(S, name, arm, g), collect.curve(S, name, "O", 1)
    if not a or not r:
        return None
    lo, hi = max(min(x for x, _ in a), min(x for x, _ in r)), min(max(x for x, _ in a), max(x for x, _ in r))
    return bd_rate(a, r, lo, hi) if hi > lo else None


def cell_lines(S, nu, name):
    out = ["| arm | G | Q | bytes | e_N/σ worst · median | ν | PSNR in, median | JOD | ≥ 2 levels, worst | hidden · "
           "shown existing | q-hist entries |", "| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- |"]
    keys = sorted((k for k in S if k[0] == name), key=lambda k: (ORDER.index(k[1]) if k[1] in ORDER else 9, k[2], k[3]))
    for k in keys:
        c = S[k]
        out.append(f"| {k[1]} | {k[2]} | {k[3]} | {c['bytes']} | {c['en_max']:.3f} · {c['en_med']:.3f} | "
                   f"{collect.fmt(nu.get(k), 3)} | {c['psnr_in']:.2f} | {collect.fmt(c['jod'])} | {c['ge2']:.4f} | "
                   f"{c['hidden']} · {c['existing']} | {', '.join(f'{q}: {n}' for q, n in sorted(c['q_hist'].items(), key=lambda t: int(t[0])))} |")
    return out


def stream_lines(R, S, nu, name):
    out = ["| arm | G | kept rungs | B₁ | ν₁ | saving vs O G 1 | integer point at 1.00 | at 1.03 | in-window PSNR "
           "BD-rate vs O G 1 | guards: ν₁ · JOD and ≥ 2 |", "| --- | --: | --- | --: | --: | --: | --- | --- | --: | --- |"]
    for arm, g in plan.SETTINGS_STREAMS:
        r = R.get((name, arm, g))
        if not r:
            continue
        ip = lambda p: "—" if p is None else f"Q {p[0]}, {p[2]} B"
        gd = guard(R, S, nu, name, arm, g) if (arm, g) != ("O", 1) else None
        gtxt = "—" if not gd else f"{collect.fmt(gd['nu'])} · {collect.fmt(gd['jod'])}"
        b1 = "too few rungs" if len(r["rungs"]) < 2 else "not monotone" if not r["monotone"] else "not bracketed" if r["b1"] is None else f"{r['b1'] / 1e6:.3f} MB"
        out.append(f"| {arm} | {g} | {', '.join(map(str, r['rungs']))} | {b1} | {collect.fmt(r['nu1'], 3)} | "
                   f"{collect.pct(saving(R, name, arm, g), 2)} | {ip(r['at100'])} | {ip(r['at103'])} | "
                   f"{collect.pct(bd_psnr(S, name, arm, g), 2)} | {gtxt} |")
    return out


def slow_ratio(rows, name, unit):
    v = [max(r["ms"]) / float(np.median(r["ms"])) for r in rows if r["set"] == name and r["unit"] == unit and r["ms"]
         and not r["error"] and r["matched"] == r["frames"]]
    return float(np.median(v)) if v else None


def within(v, lo, hi):
    return v is not None and lo <= v <= hi


def predictions(R, S, nu, names, eps, checks, dec, rows):
    out = []
    say = lambda n, nums, ok: out.append(f"| {n} | {nums} | {'held' if ok else '**refuted**'} on {', '.join(names)} |")
    c = checks.get("dbts_b1", {})
    q1 = next((v for k, v in c.items() if k.startswith("Q1")), None)
    if q1:
        say("Q1", f"bytes {q1['bytes']}", q1["holds"])
    q2 = next((v for k, v in c.items() if k.startswith("Q2")), None)
    if q2:
        say("Q2", f"bytes {q2['bytes']}", q2["holds"])
    sv = {(n, a, g): saving(R, n, a, g) for n in names for a, g in plan.SETTINGS_STREAMS}
    show = lambda keys: "; ".join(f"{a} G {g} {collect.pct(sv[(n, a, g)], 2)}" for n in names for a, g in keys)
    q3 = [sv[(n, a, 16)] for n in names for a in ("AT", "AD", "AF")]
    say("Q3", f"{show([('AT', 16), ('AD', 16), ('AF', 16)])}; ε {100 * eps:.2f} %",
        all(v is not None and v <= eps for v in q3))
    bd = {(n, a): bd_psnr(S, n, a, 16) for n in names for a in ("AT", "AD", "AF")}
    say("Q4", "; ".join(f"{a} {collect.pct(v, 2)}" for (n, a), v in bd.items()), all(within(v, -0.12, -0.03) for v in bd.values()))
    q5 = []
    for n in names:
        d = None if None in (sv[(n, "AU", 16)], sv[(n, "O", 16)]) else sv[(n, "AU", 16)] - sv[(n, "O", 16)]
        x = S[(n, "AU", 16, 8, "real")]["en_max"] - S[(n, "O", 16, 8, "real")]["en_max"]
        q5.append((d, x))
    say("Q5", "; ".join(f"saving AU − O G 16 {collect.pct(d, 2)}, worst e_N/σ at Q 8 Δ {x:+.3f}" for d, x in q5),
        all(d is not None and abs(d) <= 0.03 and abs(x) <= 0.03 for d, x in q5))
    q6, nums = True, []
    for n in names:
        v = {a: nu.get((n, a, 16, 8, "real")) for a in ("AU", "AW", "AT")}
        b = {a: R[(n, a, 16)]["b1"] for a in ("AU", "AW", "AT")}
        nums.append("ν at Q 8 " + " · ".join(f"{a} {v[a]:.3f}" for a in v) + "; B₁ " +
                    " · ".join(f"{a} {collect.fmt(b[a] and b[a] / 1e6, 3)} MB" for a in b))
        q6 &= v["AW"] - v["AU"] <= 0.01 and v["AT"] - v["AW"] <= 0.01
        q6 &= None not in b.values() and b["AU"] <= b["AW"] * (1 + eps) and b["AW"] <= b["AT"] * (1 + eps)
    say("Q6", "; ".join(nums), q6)
    q7, nums = True, []
    for n in names:
        a8, o8, a16 = sv[(n, "AT", 8)], sv[(n, "O", 8)], sv[(n, "AT", 16)]
        n8, n16 = nu.get((n, "AT", 8, 8, "real")), nu.get((n, "AT", 16, 8, "real"))
        nums.append(f"AT G 8 {collect.pct(a8, 2)} between O G 8 {collect.pct(o8, 2)} and AT G 16 {collect.pct(a16, 2)}; "
                    f"ν at Q 8 AT G 8 {n8:.3f} vs G 16 {n16:.3f}")
        q7 &= None not in (a8, o8, a16) and min(o8, a16) - eps <= a8 <= max(o8, a16) + eps and n8 >= n16
    say("Q7", "; ".join(nums), q7)
    lo, hi = (-0.01, 0.06) if names == ["dbts_b1"] else (-0.02, 0.03)
    o = {g: [sv[(n, "O", g)] for n in names] for g in (8, 16, 32)}
    say("Q8", show([("O", 8), ("O", 16), ("O", 32)]), all(within(v, lo, hi) for g in o for v in o[g])
        and all(v32 is not None and v16 is not None and abs(v32 - v16) <= 0.01 for v32, v16 in zip(o[32], o[16])))
    q9, nums = True, []
    for n in names:
        rungs = [(q, S[(n, "AF", 16, q, "real")]["bytes"] / S[(n, "AD", 16, q, "real")]["bytes"] - 1)
                 for q in plan.SETTINGS_LADDER[n] if (n, "AF", 16, q, "real") in S and (n, "AD", 16, q, "real") in S]
        b = None if None in (R[(n, "AF", 16)]["b1"], R[(n, "AD", 16)]["b1"]) else R[(n, "AF", 16)]["b1"] / R[(n, "AD", 16)]["b1"] - 1
        nums.append(f"AF ÷ AD − 1 per rung {', '.join(f'Q {q} {100 * v:+.2f} %' for q, v in rungs)}; anchor {collect.pct(b, 2)}")
        q9 &= all(abs(v) <= 0.03 for _, v in rungs) and b is not None and abs(b) <= 0.03
    say("Q9", "; ".join(nums), q9)
    for label, dname, (lo, hi), (lo_o, hi_o) in (("Q11", "webcodecs", (0.85, 1.35), (0.85, 1.25)),
                                                 ("Q12", "dav1d", (0.8, 1.4), (0.8, 1.4))):
        ok, nums = True, []
        for n in names:
            for (s, d, u), v in dec.items():
                if s != n or d != dname or not isinstance(v, dict) or "ratio_mean" not in v or u.startswith(("O|G1|", "O'")):
                    continue
                r = v["ratio_mean"] and math.exp(v["ratio_mean"]["med"])
                sm = slow_ratio(rows, n, u)
                arf = not u.startswith("O|")
                rng = (lo, hi) if arf else (lo_o, hi_o)
                good = within(r, *rng) and (sm is not None and (sm >= 2 if arf else label == "Q12" or sm <= 1.6))
                nums.append(f"{u.rsplit('|', 1)[0]} {collect.fmt(r, 3)}, slowest ÷ median {collect.fmt(sm, 2)}")
                ok &= good
            o1 = next((u for (s, d, u) in dec if s == n and d == dname and u.startswith("O|G1|")), None)
            if o1 and label == "Q11":
                sm = slow_ratio(rows, n, o1)
                nums.append(f"O G 1 slowest ÷ median {collect.fmt(sm, 2)}")
                ok &= sm is not None and sm <= 1.6
        if nums:
            say(label, "; ".join(nums), ok)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rows", nargs="+")
    ap.add_argument("--checks", nargs="*", default=[])
    ap.add_argument("--decode", nargs="*", default=[])
    a = ap.parse_args()
    series, _, cells, failed = collect.load(a.rows)
    S = collect.summarise(series, cells)
    nu = {k: anchor.nu(series[k[0]], r) for k, r in cells.items() if r.get("sigma_out")}
    names = [n for n in ("dbts_a1", "dbts_b1", "dbts_c1") if n in series]
    R = {(n, arm, g): stream(S, nu, n, arm, g) for n in names for arm, g in plan.SETTINGS_STREAMS}
    eps, parts = epsilon(R, names)
    checks = {}
    for p in a.checks:
        checks["dbts_b1" if "settings-1" in p else "cut"] = json.loads(Path(p).read_text())
    rows = [r for p in a.decode for r in json.loads(Path(p).read_text())]
    out = [f"*{len(cells)} cells, {len(failed)} failed rows.*"]
    for n in names:
        s = series[n]
        out += [f"\n#### `{n}` ({s['frames']} frames from {s['first']}, {s['width']} × {s['height']}, {s['b']}-bit; "
                f"σ median {np.median(s['sigma']):.2f})\n"] + cell_lines(S, nu, n)
        out += ["\n**At the noise anchor** (worst-frame e_N/σ = 1.00):\n"] + stream_lines(R, S, nu, n)
    out.append(f"\n**ε** = {100 * eps:.2f} % (largest |ln B₁ change| over {sum(p[3] is not None for p in parts)} "
               f"thinnings of O G 1 and O G 16; unreadable: "
               f"{', '.join(f'{p[0]} G {p[1]} without Q {p[2]}' for p in parts if p[3] is None) or 'none'}).")
    dec_lines, dec = collect.decode_tables(rows, names)
    if dec_lines:
        out += ["\n**Decode in order**, ms a frame, each stream at its integer point at 1.00, 1×, one host:"] + dec_lines
    out += ["\n| # | deciding numbers | outcome |", "| --- | --- | --- |"]
    try:
        out += predictions(R, S, nu, names, eps, checks, dec, rows)
    except (KeyError, TypeError) as e:
        out.append(f"| — | predictions stopped at a missing cell: {e!r} | — |")
    print("\n".join(out))


if __name__ == "__main__":
    main()
