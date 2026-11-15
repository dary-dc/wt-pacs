#!/usr/bin/env python3
"""The checks of README.md §5, each run as written and then broken on purpose: a check that passes its mutation
is reported as unable to see it.

usage: checks.py BUILD WORK SETDIR      (a fetched 12-bit DBT set; its middle 4 frames are coded)
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bytes as run  # noqa: E402
import noise  # noqa: E402
import obu  # noqa: E402
import voi  # noqa: E402

AOMENC = "aom-3.15.1/bin/aomenc"


def residual(build, work, path):
    """Every frame exact; a sample flipped in one decoded residual fails that frame alone; the offset off by one
    fails every frame."""
    out = {}
    for mutate in (None, "flip", "offset"):
        (work / f"{Path(path).name}.display.json").write_text(json.dumps(
            voi.display_windows(run.ROOT / "lab/av1/data.json", Path(path).name, Path(path).parent)))
        row = run.cell((build, str(work), path, 4, "12bit", 32, 1, False, mutate, False))
        out[mutate or "as run"] = row["exact_frames"]
    return dict(exact=out, held=out == {"as run": 4, "flip": 3, "offset": 0})


def aomdec(build, work, path):
    """aomdec against dav1d sample for sample; one sample flipped in dav1d's output must fail."""
    s = run.Middle(Path(path), 4)
    form = run.forms(s, [])[0]
    y4m, ivf, dec = work / "a.y4m", work / "a.ivf", work / "a-dec.y4m"
    run.write_y4m(s, form, y4m)
    run.child([build / AOMENC, "-o", ivf, f"--limit={s.n}", "-y", *run.aomenc_args(form, 32, 16, s.n), y4m])
    run.child([build / "dav1d/bin/dav1d", "-q", "-i", ivf, "-o", dec])
    as_run = run.aomdec_matches(build, ivf, work / "a.yuv", s, form, run.y4m_frames(dec, s, form))

    def flipped():
        for i, planes in enumerate(run.y4m_frames(dec, s, form)):
            planes = [p.copy() for p in planes]
            if i == 2:
                planes[0][7, 7] ^= 1
            yield planes
    mutated = run.aomdec_matches(build, ivf, work / "a.yuv", s, form, flipped())
    return dict(as_run=as_run, mutated=mutated, held=as_run and not mutated)


def film_grain(build, work, path):
    """The sequence header's film_grain_params_present reads 0 as run, 1 with libaom's denoiser on."""
    s = run.Middle(Path(path), 2)
    form = run.forms(s, [])[0]
    y4m = work / "f.y4m"
    run.write_y4m(s, form, y4m)
    got = {}
    for level in (0, 25):
        args = [a if not a.startswith("--denoise-noise-level") else f"--denoise-noise-level={level}"
                for a in run.aomenc_args(form, 32, 1, s.n)]
        run.child([build / AOMENC, "-o", work / "f.ivf", f"--limit={s.n}", "-y", *args, y4m])
        unit = run.ingest.ivf_units(work / "f.ivf")[0]
        got[level] = obu.film_grain_params_present(obu.sequence_header(unit))
    return dict(read=got, held=got[0]["film_grain"] == 0 and got[25]["film_grain"] == 1
                and got[0]["depth"] == 12 and got[0]["mono"] == 1)


def q_hist(build, work, path):
    """--max-q = Q + 8 must show frames off Q, or the check cannot see a quantizer that moved."""
    s = run.Middle(Path(path), 16)
    form = run.forms(s, [])[0]
    y4m = work / "q.y4m"
    run.write_y4m(s, form, y4m)
    out = {}
    for top in (32, 40):
        args = [a if not a.startswith("--max-q") else f"--max-q={top}" for a in run.aomenc_args(form, 32, 16, s.n)]
        _, _, err = run.child([build / AOMENC, "-o", work / "q.ivf", f"--limit={s.n}", "-y", "--q-hist=64", *args, y4m])
        out[top] = run.q_hist(err)
    return dict(hist={str(k): v for k, v in out.items()}, as_run_on_q=set(out[32]) == {32},
                sees_off_q=set(out[40]) != {32})


def sigma(mutate=False):
    """A ramp plus white Gaussian noise of σ 1, 4, 16 gives σ within 10 %; the ramp alone under 0.5. Run on real-valued
    frames, as written, and on the same frames rounded to integers, as every fixture's samples are."""
    y, x = np.mgrid[0:512, 0:512]
    ramp = 1000 + 1.7 * x + 0.9 * y
    est = noise.sigma if not mutate else lambda f: float(np.median(np.abs(
        (f[0::2, 0::2] - f[0::2, 1::2] + f[1::2, 0::2] - f[1::2, 1::2]).astype(float) / 2)) / 0.6745)
    out = {}
    for kind, shape in (("real", lambda f: f), ("integer", np.rint)):
        rng = np.random.default_rng(1)
        got = {sd: est(shape(ramp + rng.normal(0, sd, ramp.shape))) for sd in (1, 2, 4, 16)}
        flat = est(shape(ramp))
        out[kind] = dict(sigma={str(k): round(v, 3) for k, v in got.items()}, ramp_only=round(flat, 3),
                         held=all(abs(got[k] / k - 1) <= 0.10 for k in (1, 4, 16)) and flat < 0.5)
    return out


def display(port=voi):
    """client/paint/voi.test.mjs's cases, to the code."""
    c = lambda fn, ce, w, x: int(port.code(port.voi(fn, ce, w)(np.float64(x))))
    cases = [(("LINEAR", 100, 11, 94.5), 0), (("LINEAR", 100, 11, 95), 13), (("LINEAR", 100, 11, 104.5), 255),
             (("LINEAR", 100, 11, 104.6), 255), (("LINEAR", 10, 1, 9.5), 0), (("LINEAR", 10, 1, 9.51), 255),
             (("LINEAR_EXACT", 100, 10, 95), 0), (("LINEAR_EXACT", 100, 10, 95.5), 13),
             (("LINEAR_EXACT", 100, 10, 105), 255), (("LINEAR_EXACT", 100, 10, 105.01), 255),
             (("LINEAR_EXACT", 100, 11, 95), 12), (("LINEAR_EXACT", 0, 0.001, 0.0004), 230),
             (("LINEAR_EXACT", 0, 0.001, 0.0006), 255), (("SIGMOID", 0, 4, 0), 128), (("SIGMOID", 0, 4, 1), 186),
             (("SIGMOID", 0, 4, -1), 69), (("LINEAR", 100, 11, 99.5), 128), (("LINEAR_EXACT", 100, 10, 100), 128)]
    miss = [(a, want, c(*a)) for a, want in cases if c(*a) != want]
    t = port.window_codes(dict(center=0, width=10, function="LINEAR_EXACT"), dict(slope=1, intercept=-1024), 4095)
    table = [int(t[1024]), int(t[1018]), int(t[1030])] == [128, 0, 255]
    clamp = [int(port.code(-3)), int(port.code(300))] == [0, 255]
    return dict(cases=len(cases), missed=[str(m) for m in miss], held=not miss and table and clamp)


class NoHalf:
    """voi.py with LINEAR's − 0.5 dropped: the mutation the display check must catch."""
    code, window_codes = staticmethod(voi.code), staticmethod(voi.window_codes)

    @staticmethod
    def voi(fn, c, w):
        return voi.voi(fn, c + 0.5, w) if fn == "LINEAR" else voi.voi(fn, c, w)


def main():
    build, work, path = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), sys.argv[3]
    work.mkdir(parents=True, exist_ok=True)
    out = dict(residual=residual(build, work, path), aomdec=aomdec(build, work, path),
               film_grain=film_grain(build, work, path), q_hist=q_hist(build, work, path),
               sigma=sigma(), sigma_mutated=sigma(mutate=True), display=display(), display_mutated=display(NoHalf))
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
