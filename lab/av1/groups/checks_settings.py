#!/usr/bin/env python3
"""The settings amendment's checks and their mutations (docs/av1/groups.md §S8), on dbts_b1 and, for the cut form,
dbts_a1; they also hold Q1's and Q2's encodes. Writes CHECKS.json.

usage: checks_settings.py BUILD WORK B1_SETDIR A1_SETDIR CHECKS.json [--jobs 4]
"""
import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import anchor  # noqa: E402
import arms  # noqa: E402
import cell  # noqa: E402
import plan  # noqa: E402
from cell import Source, run_cell, series, sigma_out  # noqa: E402

CPU5 = ["--cpu-used=5"]
B1 = {
    "O16": ("O", 16), "AT16": ("AT", 16), "O16-cpu5": ("O", 16, CPU5), "AT16-cpu5": ("AT", 16, CPU5),
    "AT-s4": ("AT", 16, ["--arnr-strength=4"]), "AT-s6": ("AT", 16, ["--arnr-strength=6"]),
    "AT-s3": ("AT", 16, ["--arnr-strength=3"]),
    "O1": ("O", 1), "AT1": ("AT", 1), "AF1": ("AF", 1), "AT2": ("AT", 2),
    "AU16": ("AU", 16), "AF16": ("AF", 16), "AD16": ("AD", 16),
    "AU16-again": ("AU", 16), "AF16-again": ("AF", 16), "AU16-cpu5": ("AU", 16, CPU5), "AF16-cpu5": ("AF", 16, CPU5),
    "proxy": ("O", 1, [], plan.NOISE_PROXY_Q),
}
A1 = {
    "AT16-whole": ("AT", 16, [], 8, dict(form="cut")), "AT16-groups": ("AT", 16, [], 8, dict(form="cut", per_group=True)),
    "cut-Q0": ("O", 1, [], 0, dict(form="cut", span=True)), "cut-Q0-x2": ("O", 1, [], 0, dict(form="cut", span=True, scale=2)),
}


def job(build, work, path, tag, spec):
    arm, g, extra, q, more = _spec(spec)
    return (build, work, path, dict(kind="check", arm=arm, g=g, q=q, src="real", extra=extra, tag=tag, **more), None)


def _spec(spec):
    """(arm, G[, extra[, Q[, options]]]) with extra [], Q 8, options {} by default."""
    return (*spec, *([], 8, {})[len(spec) - 2:])


def same(a, b):
    return a["units"] == b["units"]


def flag_diff(a, b):
    return sorted(set(arms.ARMS[a]) - set(arms.ARMS[b])), sorted(set(arms.ARMS[b]) - set(arms.ARMS[a]))


def table_check(table):
    want = {("AF", "AD"): (["--deltaq-mode=1"], []), ("AU", "AT"): (["--arnr-strength=0"], []),
            ("AW", "AT"): (["--arnr-strength=2"], [])}
    saved = dict(arms.ARMS)
    arms.ARMS.update(table)
    try:
        got = {f"{a}−{b}": flag_diff(a, b) for a, b in want}
        return got, all(flag_diff(a, b) == w for (a, b), w in want.items())
    finally:
        arms.ARMS.clear()
        arms.ARMS.update(saved)


def nu_check(path, work):
    """ν of the source against itself, and of S (the noise proxy's decode) against the source; the mutation feeds the
    estimator the source in place of S."""
    s = Source(path, "real", work)
    srow = series((path, work))
    meta = json.loads((Path(work) / f"{s.name}.display.json").read_text())
    form = cell.forms(s, meta["windows"])[0]
    S = np.load(Path(work) / f"{s.name}.S.npy", mmap_mode="r")
    src = lambda: ([s.frame(i)[..., 0].astype(np.int32) + s.offset] for i in range(s.n))
    ratio = lambda frames: anchor.nu(srow, dict(sigma_out=sigma_out(s, meta, form, frames)))
    return ratio(src()), ratio([S[i][..., 0]] for i in range(s.n)), ratio(src())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("build", type=Path)
    ap.add_argument("work", type=Path)
    ap.add_argument("b1")
    ap.add_argument("a1")
    ap.add_argument("out", type=Path)
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    a.build, a.work = a.build.resolve(), a.work.resolve()
    for p in (a.b1, a.a1):
        name = Path(p).name
        meta = cell.display_windows(cell.ROOT / "lab/av1/data.json", name, Path(p).parent)
        (a.work / f"{name}.display.json").write_text(json.dumps(meta))
    js = [job(a.build, a.work, a.b1, t, s) for t, s in B1.items()] + [job(a.build, a.work, a.a1, t, s) for t, s in A1.items()]
    with ProcessPoolExecutor(a.jobs) as pool:
        enc = dict(zip([*B1, *A1], pool.map(run_cell, js)))
    proxy = enc["proxy"]
    out = {}
    got, holds = table_check({})
    mut, mut_holds = table_check({"AU": arms.AT})
    out["arms are the table: AF−AD, AU−AT, AW−AT differ by exactly §S4's flags; mutation, AU without "
        "--arnr-strength=0: fails"] = dict(got=got, holds=holds, mutation=mut, mutation_holds=not mut_holds)
    ref = {(r["arm"], r["g"]): r["units"] for r in map(json.loads, (HERE / "rows/groups-1.jsonl").open())
           if r["kind"] == "cell" and r["set"] == "dbts_b1" and r["q"] == 8 and r["src"] == "real"}
    out["reproduction: O G 16 and AT G 16, Q 8, dbts_b1 byte-identical to rows/groups-1.jsonl; mutation "
        "--cpu-used=5: differs"] = dict(
        holds=enc["O16"]["units"] == ref[("O", 16)] and enc["AT16"]["units"] == ref[("AT", 16)],
        mutation_holds=enc["O16-cpu5"]["units"] != ref[("O", 16)] and enc["AT16-cpu5"]["units"] != ref[("AT", 16)])
    out["Q1 strength: AT at --arnr-strength 4 and 6 = AT (5); mutation strength 3: differs"] = dict(
        holds=same(enc["AT-s4"], enc["AT16"]) and same(enc["AT-s6"], enc["AT16"]),
        mutation_holds=not same(enc["AT-s3"], enc["AT16"]),
        bytes={k: sum(enc[k]["units"]) for k in ("AT16", "AT-s4", "AT-s6", "AT-s3")})
    out["Q2 G 1: AT and AF at G 1 = O G 1, Q 8; mutation AT at G 2: differs"] = dict(
        holds=same(enc["AT1"], enc["O1"]) and same(enc["AF1"], enc["O1"]), mutation_holds=not same(enc["AT2"], enc["O1"]),
        bytes={k: sum(enc[k]["units"]) for k in ("O1", "AT1", "AF1", "AT2")})
    out["AU's filter off: AU ≠ AT at Q 8 G 16 (a tie voids AU)"] = dict(
        holds=not same(enc["AU16"], enc["AT16"]), bytes={k: sum(enc[k]["units"]) for k in ("AU16", "AT16")})
    out["AF's delta-q acts: AF ≠ AD at Q 8 G 16 (a tie voids AF)"] = dict(
        holds=not same(enc["AF16"], enc["AD16"]), bytes={k: sum(enc[k]["units"]) for k in ("AF16", "AD16")},
        q_hist={k: enc[k]["q_hist"] for k in ("AF16", "AD16")})
    vec = cell.depth_cut()(np.array([0, 1, 2, 5, 6, 4093, 4094, 4095]), 12).tolist()
    span, span2 = enc["cut-Q0"]["span"], enc["cut-Q0-x2"]["span"]
    within = lambda sp: sp[0] >= -2 and sp[1] <= 1
    out["the cut: depth_cut's vector; O G 1 at Q 0 on dbts_a1's cut form, back as c · 4, within [−2, +1] of the "
        "source; mutation c · 2: fails"] = dict(vector=vec, span=span, mutation=span2,
                                               holds=vec == [0, 0, 1, 1, 2, 1023, 1023, 1023] and within(span),
                                               mutation_holds=not within(span2))
    out["per-group form: AT G 16 Q 8 on dbts_a1's cut form, one encoder a group, byte-identical to the whole-volume "
        "encode (a difference is reported)"] = dict(
        holds=same(enc["AT16-groups"], enc["AT16-whole"]),
        bytes={k: sum(enc[k]["units"]) for k in ("AT16-whole", "AT16-groups")})
    err, offset = anchor.synthetic()
    _, flipped = anchor.synthetic(reverse=True)
    out["equal quality: B₁ reads a known curve to 0.1 %, ln 0.9 offset reads −10.0 %; mutation, x reversed against "
        "y: the sign flips"] = dict(err=err, offset=offset, mutation=flipped,
                                    holds=abs(err) < 0.001 and abs(offset + 0.10) < 0.001, mutation_holds=flipped > 0)
    itself, of_s, mutated = nu_check(a.b1, a.work)
    out["ν: source against itself 1.000, S < 0.3; mutation, the source fed twice: ν = 1 on S, fails"] = dict(
        itself=itself, S=of_s, mutation=mutated, holds=abs(itself - 1) < 1e-9 and of_s < 0.3,
        mutation_holds=not mutated < 0.3)
    out["determinism: AU and AF at Q 8 G 16 coded twice identical; mutation --cpu-used=5: differs"] = dict(
        holds=same(enc["AU16"], enc["AU16-again"]) and same(enc["AF16"], enc["AF16-again"]),
        mutation_holds=not same(enc["AU16"], enc["AU16-cpu5"]) and not same(enc["AF16"], enc["AF16-cpu5"]))
    out["_encodes"] = {k: dict(bytes=sum(v["units"]), cpu=v.get("encode_cpu"), rss_kb=v.get("encode_rss_kb"),
                               hidden=(v.get("headers") or {}).get("hidden"), q_hist=v.get("q_hist"))
                       for k, v in enc.items()}
    out["_proxy_units"] = proxy["units"]
    a.out.write_text(json.dumps(out, indent=1, default=str) + "\n")
    for k, v in out.items():
        if not k.startswith("_"):
            print(("ok  " if v.get("holds") and v.get("mutation_holds", True) else "MISS"), k)


if __name__ == "__main__":
    main()
