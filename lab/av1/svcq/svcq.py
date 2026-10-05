#!/usr/bin/env python3
"""One scalable AV1 payload: a lossy base layer and a lossless top predicted from it.

libaom 3.15.1's svc_encoder_rtc (lab/av1/svc, patched for --layer-q), two spatial layers (its
layering mode 5: the top references the base and its own previous frame), the base at a quantizer
and half or full size, the top at quantizer 0. The top's frames are checked against the checksum
written when each input frame was made; the base, a lossy picture, is measured: PSNR and max |Δ|
against the input, or against the input's 2×2 mean when it is half size.

usage: svcq.py BUILD WORK OUT.tsv SET_DIR ...   — lab/av1/svcq/README.md has the cells.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "svc"))
import svc  # noqa: E402

BASE_Q = (20, 40, 55)  # the example's quantizer scale, 0..63
SPEED = 7


def encode(build, s, y4m, out, layers, scale=None, layer_q=None):
    cmd = [str(build / "aom-3.15.1-svc-b/svc_encoder_rtc"), "-o", str(out), "-lm", "5" if layers == 2 else "0",
           "-sl", str(layers), "-tl", "1", "-b", str(svc.KBPS * layers),
           "-bl", ",".join([str(svc.KBPS)] * layers), "--min-q=0", "--max-q=0", "-k", "100000",
           "-sp", str(SPEED), "-d", str(s.av1_bits), f"--profile={2 if s.av1_bits == 12 else s.ch // 3}"]
    cmd += ["--monochrome"] if s.ch == 1 else []
    cmd += ["-r", scale] if scale else []
    cmd += [f"--layer-q={layer_q}"] if layer_q else []
    subprocess.run(cmd + [str(y4m)], check=True, capture_output=True)
    (out.parent / f"{out.name}.cmd").write_text(" ".join(cmd + [str(y4m)]) + "\n")


def dav1d(build, stream, dec):
    subprocess.run([str(build / "dav1d/bin/dav1d"), "-q", "-i", str(stream), "-o", str(dec), "--alllayers", "0"],
                   check=True, capture_output=True, env={"LD_LIBRARY_PATH": str(build / "dav1d/lib")})
    return svc.read_y4m(dec)


def padded(s, i):
    px = s.frame(i).astype(np.float64) + s.offset
    return np.pad(px, ((0, s.h % 2), (0, s.w % 2), (0, 0)), mode="edge")


def base_quality(s, decoded, half):
    """Mean PSNR over frames (dB, peak 2^bits − 1) and max |Δ| of the base against its reference."""
    peak, psnrs, max_d = (1 << s.av1_bits) - 1, [], 0
    for i, planes in enumerate(decoded):
        px = np.stack([planes[2], planes[0], planes[1]], -1) if s.ch == 3 else planes[0][..., None]
        ref = padded(s, i)
        if half:
            h, w = min(px.shape[0], ref.shape[0] // 2), min(px.shape[1], ref.shape[1] // 2)
            px, ref = px[:h, :w], ref[:2 * h, :2 * w].reshape(h, 2, w, 2, s.ch).mean(axis=(1, 3))
        else:
            px = px[:s.h, :s.w]
            ref = ref[:s.h, :s.w]
        diff = np.abs(px.astype(np.float64) - ref)
        mse = float((diff ** 2).mean())
        psnrs.append(99.0 if mse == 0 else 10 * np.log10(peak * peak / mse))
        max_d = max(max_d, int(np.ceil(diff.max())))
    return round(float(np.mean(psnrs)), 2), max_d


def top_exact(s, decoded):
    return sum(svc.compare(s, i, planes)[0] for i, planes in enumerate(decoded))


def main():
    build, work, out, *sets = sys.argv[1:]
    build, work = Path(build), Path(work)
    keys = ["set", "coding", "base_bytes", "total_bytes", "frames", "top_exact", "base_psnr_db", "base_max_abs_diff"]
    with open(out, "w") as fh:
        fh.write("\t".join(keys) + "\n")
        for path in sets:
            s = svc.load(Path(path))
            cell = work / s.name
            cell.mkdir(parents=True, exist_ok=True)
            y4m = work / f"{s.name}.y4m"
            if not y4m.exists():
                svc.write_y4m(s, y4m)
            runs = [("single", 1, None, None)]
            runs += [(f"{size}-q{q}", 2, scale, f"{q},0") for size, scale in (("half", None), ("full", "1/1,1/1"))
                     for q in BASE_Q]
            for coding, layers, scale, layer_q in runs:
                ivf = cell / f"{coding}.ivf"
                encode(build, s, y4m, ivf, layers, scale, layer_q)
                top_stream = Path(f"{ivf}_{layers - 1}.av1")
                top = dav1d(build, top_stream, cell / "dec.y4m")
                row = dict(set=s.name, coding=coding, total_bytes=top_stream.stat().st_size, frames=len(top),
                           top_exact=top_exact(s, top) if len(top) == s.n else 0)
                if layers == 2:
                    base_stream = Path(f"{ivf}_0.av1")
                    base = dav1d(build, base_stream, cell / "dec.y4m")
                    psnr, max_d = base_quality(s, base, half=scale is None) if len(base) == s.n else ("-", "-")
                    row.update(base_bytes=base_stream.stat().st_size, base_psnr_db=psnr, base_max_abs_diff=max_d)
                line = "\t".join(str(row.get(k, "")) for k in keys)
                fh.write(line + "\n")
                fh.flush()
                print(line, flush=True)


if __name__ == "__main__":
    main()
