#!/usr/bin/env python3
"""The frames SPEED decodes: each set's first FRAMES frames as the served HTJ2K and as AV1 intra.

HTJ2K is the served profile (a signed series signed in SIZ, as the store holds it); AV1 is libaom
at the slowest preset, one temporal unit per frame. Every frame is decoded natively and matched
with the checksum written when the series was fetched before it is written out.

usage: make_frames.py BUILD OUT SETDIR ...   — lab/av1/decode/per-frame/README.md
"""
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[2] / "scripts"))
from size import AOM, OJPH, Set, decode_y4m, exact, ivf_units, pnm, read_pnm, timed, write_y4m  # noqa: E402

FRAMES = int(os.environ.get("FRAMES", 18))
PRESET = 0


def htj2k(s, i, work, out):
    ext = "pgm" if s.ch == 1 else "ppm"
    src, back = work / f"in.{ext}", work / f"back.{ext}"
    shift = pnm(s, i, src)
    env = {"LD_LIBRARY_PATH": str(OJPH / "lib")}
    timed([OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5", "-block_size", "{64,64}",
           "-prog_order", "RPCL", "-reversible", "true"], env=env)
    timed([OJPH / "bin/ojph_expand", "-i", out, "-o", back], env=env)
    if not exact(s, i, read_pnm(back).astype("i4") - shift + s.offset):
        sys.exit(f"{s.name} {i}: HTJ2K not exact")
    if s.signed:
        subprocess.run([sys.executable, HERE.parents[2] / "scripts/sign_htj2k.py", out, src, str(s.stored)], check=True)
        signed_truth = out.with_suffix(".sha256")
        if signed_truth.read_text().strip() != s.truth[i]:
            sys.exit(f"{s.name} {i}: signed HTJ2K's truth is not the series'")
        signed_truth.unlink()


def av1(build, s, work):
    y4m, ivf = work / "in.y4m", work / "out.ivf"
    write_y4m(s, y4m)
    profile = 2 if s.av1_bits == 12 else (1 if s.ch == 3 else 0)
    timed([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--lossless=1", f"--cpu-used={PRESET}",
           f"--limit={s.n}", f"--bit-depth={s.av1_bits}", f"--input-bit-depth={s.av1_bits}", f"--profile={profile}",
           "--monochrome" if s.ch == 1 else "--matrix-coefficients=identity", "--kf-max-dist=0", y4m])
    units = ivf_units(ivf)
    for i, unit in enumerate(units):
        (work / "u.obu").write_bytes(unit)
        if not exact(s, i, decode_y4m(build, work / "u.obu", work / "u.y4m")[0]):
            sys.exit(f"{s.name} {i}: AV1 not exact alone")
    return units, profile


def main():
    build, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    manifest = []
    for d in sys.argv[3:]:
        s = Set(Path(d))
        s.n = min(s.n, FRAMES)
        if s.offset or s.av1_bits is None:
            sys.exit(f"{s.name}: needs an offset or more than 12 bits — row DEPTH's, not SPEED's")
        dst, work = out / s.name, out / f".{s.name}-work"
        dst.mkdir(parents=True, exist_ok=True)
        work.mkdir(exist_ok=True)
        units, profile = av1(build, s, work)
        frames = []
        for i, unit in enumerate(units):
            htj2k(s, i, work, dst / f"{i:03d}.htj2k")
            (dst / f"{i:03d}.av1").write_bytes(unit)
            frames.append(dict(htj2k=(dst / f"{i:03d}.htj2k").stat().st_size, av1=len(unit), truth=s.truth[i]))
        manifest.append(dict(name=s.name, width=s.w, height=s.h, channels=s.ch, bits=s.av1_bits, frames=frames,
                             webcodecs=f"av01.{profile}.00M.{s.av1_bits:02d}" if s.av1_bits <= 10 else None))
        print(s.name, len(frames), "frames, HTJ2K", sum(f["htj2k"] for f in frames), "B, AV1",
              sum(f["av1"] for f in frames), "B", flush=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
