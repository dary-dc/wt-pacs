#!/usr/bin/env python3
"""ColorVideoVDP's JOD for a lossy stack against its source, both as the window paints them, shown on a
GSDF-calibrated review display — README.md §Quality metrics protocol, pre-registered, *Visibility model*.

Runs in the torch venv of requirements-vdp.txt, one thread.
usage: vdp.py SOURCE.npy LOSSY.npy [--fps 15] [--l-min 1.2] [--l-max 420]    (uint8 codes, frames × h × w)
"""
import argparse
import json

import numpy as np

GSDF = dict(a=-1.3011877, b=-2.5840191e-2, c=8.0242636e-2, d=-1.0320229e-1, e=1.3646699e-1, f=2.8745620e-2,
            g=-2.5468404e-2, h=-3.1978977e-3, k=1.2992634e-4, m=1.3635334e-3)
GSDF_INV = (71.498068, 94.593053, 41.912053, 9.8247004, 0.28175407, -1.1878455, -0.18014349, 0.14710899,
            -0.017046845)


def luminance(j):
    """PS3.14 Equation 7-1: cd/m² at JND index j (1 … 1023)."""
    g, x = GSDF, np.log(j)
    num = g["a"] + g["c"] * x + g["e"] * x ** 2 + g["g"] * x ** 3 + g["m"] * x ** 4
    den = 1 + g["b"] * x + g["d"] * x ** 2 + g["f"] * x ** 3 + g["h"] * x ** 4 + g["k"] * x ** 5
    return 10 ** (num / den)


def jnd_index(lum):
    """PS3.14 Equation 7-2."""
    y = np.log10(lum)
    return sum(c * y ** i for i, c in enumerate(GSDF_INV))


def code_luminance(l_min, l_max):
    """cd/m² of each 8-bit code on a display calibrated to the GSDF: equal JND steps from l_min to l_max."""
    j = np.linspace(jnd_index(l_min), jnd_index(l_max), 256)
    return luminance(j).astype(np.float32)


def jod(src, lossy, fps, l_min, l_max):
    import torch
    import pycvvdp
    torch.set_num_threads(1)
    lut = code_luminance(l_min, l_max)
    rgb = lambda c: np.repeat(lut[c][..., None], 3, -1)
    metric = pycvvdp.cvvdp(display_name="standard_hdr_linear_dark", quiet=True, device=torch.device("cpu"))
    if len(src) == 1:
        q, _ = metric.predict(rgb(lossy[0]), rgb(src[0]), dim_order="HWC")
    else:
        q, _ = metric.predict(rgb(lossy), rgb(src), dim_order="FHWC", frames_per_second=fps)
    return float(q)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("lossy")
    ap.add_argument("--fps", type=float, default=15)
    ap.add_argument("--l-min", type=float, default=1.2)
    ap.add_argument("--l-max", type=float, default=420)
    a = ap.parse_args()
    src, lossy = np.load(a.source), np.load(a.lossy)
    print(json.dumps(dict(jod=jod(src, lossy, a.fps, a.l_min, a.l_max), fps=a.fps, l_min=a.l_min, l_max=a.l_max)))


if __name__ == "__main__":
    main()
