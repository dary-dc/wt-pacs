#!/usr/bin/env python3
"""Lossless encode time per preset: libaom on one thread, every usage and cpu-used, against OpenJPH.

Each arm encodes the first FRAMES frames of a set alone on the host, arms interleaved per round; its
output is decoded and compared with the checksums written when the frames were made. A series over
12 bits is coded as DEPTH's top11+low, two streams, timed together.

usage: enc.py BUILD WORK OUT.tsv FRAMES ROUNDS SETDIR ...   — lab/av1/bytes/README.md §ENC.
       enc.py summary OUT.tsv FRAMES
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import depth  # noqa: E402
import size  # noqa: E402
from order import order  # noqa: E402

# usage: the cpu-used values aomenc 3.15.1 accepts for it
USAGES = {"good": range(0, 7), "allintra": range(0, 10), "rt": range(5, 13)}


def streams(s, work):
    """[(y4m, bits, channels, put)]: the set as AV1 can take it, and how each decoded stream merges."""
    if s.av1_bits:
        y4m = work / f"{s.name}.y4m"
        size.write_y4m(s, y4m)
        return [(y4m, s.av1_bits, s.ch, lambda p: p)]
    v = [s.frame(i)[..., 0].astype(np.int32) + s.offset for i in range(s.n)]
    out = []
    for k, (bits, take, put) in enumerate(depth.SPLITS["top11+low"](max(depth.coded_bits(s), 13))):
        y4m = work / f"{s.name}.p{k}.y4m"
        depth.write_y4m([take(x) for x in v], bits, s.w, s.h, y4m)
        out.append((y4m, bits, 1, put))
    return out


def aomenc(build, y4m, ivf, n, bits, ch, usage, cpu):
    cmd = [build / f"aom-{size.AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, f"--{usage}", "--lossless=1",
           f"--cpu-used={cpu}", "--threads=1", f"--limit={n}", f"--bit-depth={bits}",
           f"--input-bit-depth={bits}", f"--profile={2 if bits == 12 else (1 if ch == 3 else 0)}"]
    cmd += ["--monochrome"] if ch == 1 else ["--matrix-coefficients=identity"]
    cmd += ["--kf-max-dist=0"] if usage != "rt" else [f"--kf-max-dist={n}"]
    return cmd + [y4m]


def run(cmd, **kw):
    """Wall and CPU seconds of one child; CPU well under wall means it shared the host."""
    t0 = time.perf_counter()
    p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **kw)
    _, status, ru = os.wait4(p.pid, 0)
    wall = time.perf_counter() - t0
    if status:
        raise subprocess.CalledProcessError(status, cmd, stderr=p.stderr.read())
    return wall, ru.ru_utime + ru.ru_stime


def busy_others():
    """Processes other than this campaign's using CPU now, from two /proc samples 0.5 s apart."""
    def ticks():
        t = {}
        for pid in filter(str.isdigit, os.listdir("/proc")):
            try:
                f = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
                t[pid] = int(f[11]) + int(f[12])
            except (OSError, IndexError):
                pass
        return t
    a = ticks()
    time.sleep(0.5)
    b = ticks()
    me = str(os.getpid())
    return sum(b[p] - a.get(p, b[p]) for p in b if p != me) / os.sysconf("SC_CLK_TCK") / 0.5


def av1_arm(build, s, work, inputs, usage, cpu):
    wall = cpu_s = 0.0
    nbytes, merged = 0, [np.zeros((s.h, s.w, s.ch), np.int32) for _ in range(s.n)]
    ok = True
    for k, (y4m, bits, ch, put) in enumerate(inputs):
        ivf = work / f"out{k}.ivf"
        w, c = run(aomenc(build, y4m, ivf, s.n, bits, ch, usage, cpu))
        wall, cpu_s = wall + w, cpu_s + c
        units = size.ivf_units(ivf)
        nbytes += sum(map(len, units))
        (work / "all.obu").write_bytes(b"".join(units))
        frames = size.decode_y4m(build, work / "all.obu", work / "dec.y4m")
        ok &= len(frames) == s.n
        for m, f in zip(merged, frames):
            m += put(f.astype(np.int32))
    ok &= all(size.exact(s, i, m) for i, m in enumerate(merged))
    return wall, cpu_s, nbytes, ok


def ojph_arm(s, work):
    env = {"LD_LIBRARY_PATH": str(size.OJPH / "lib")}
    wall = cpu_s = 0.0
    nbytes, ok = 0, True
    ext = "pgm" if s.ch == 1 else "ppm"
    for i in range(s.n):
        src, out, back = work / f"in{i}.{ext}", work / "f.j2c", work / f"back.{ext}"
        shift = size.pnm(s, i, src)
        w, c = run([size.OJPH / "bin/ojph_compress", "-i", src, "-o", out, "-num_decomps", "5",
                    "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"], env=env)
        wall, cpu_s, nbytes = wall + w, cpu_s + c, nbytes + out.stat().st_size
        subprocess.run([size.OJPH / "bin/ojph_expand", "-i", out, "-o", back], env=env, check=True,
                       capture_output=True)
        ok &= size.exact(s, i, size.read_pnm(back).astype(np.int32) - shift + s.offset)
    return wall, cpu_s, nbytes, ok


def summary(path, frames):
    """Per set and arm: ms a frame median [min-max] over rounds, frames/s a core, bytes against the
    slowest preset (good0) and OpenJPH, whether every round was exact and the host was otherwise idle."""
    lines = Path(path).read_text().splitlines()
    head = lines[0].split("\t")
    rows = [dict(zip(head, ln.split("\t"))) for ln in lines[1:]]
    for name in dict.fromkeys(r["set"] for r in rows):
        mine = [r for r in rows if r["set"] == name]
        arms = dict.fromkeys(r["arm"] for r in mine)
        nbytes = {a: {int(r["bytes"]) for r in mine if r["arm"] == a} for a in arms}
        ref, ojph = min(nbytes["good0"]), min(nbytes["ojph"])
        print(f"{name}  ({frames} frames; good0 {ref} B, ojph {ojph} B)")
        for a in arms:
            rs = [r for r in mine if r["arm"] == a]
            ms = sorted(1000 * float(r["wall_s"]) / frames for r in rs)
            busy = max(float(r["others_cpu"]) for r in rs)
            share = min(float(r["cpu_s"]) / float(r["wall_s"]) for r in rs)
            ok = all(r["exact"] == "True" for r in rs)
            b = max(nbytes[a])
            print(f"  {a:10} {np.median(ms):9.1f} [{ms[0]:.1f}-{ms[-1]:.1f}] ms  {1000 / np.median(ms):7.2f} f/s"
                  f"  bytes/good0 {b / ref:.4f}  /ojph {b / ojph:.4f}  stable {len(nbytes[a]) == 1}"
                  f"  exact {ok}  n={len(rs)}  others<={busy:.2f}  cpu/wall>={share:.2f}")


def main():
    if sys.argv[1] == "summary":
        return summary(sys.argv[2], int(sys.argv[3]))
    build, work, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), Path(sys.argv[3])
    frames, rounds = int(sys.argv[4]), int(sys.argv[5])
    work.mkdir(parents=True, exist_ok=True)
    cols = ["set", "round", "pos", "arm", "exact", "bytes", "wall_s", "cpu_s", "others_cpu"]
    with open(out, "w") as fh:
        fh.write("\t".join(cols) + "\n")
        for d in sys.argv[6:]:
            s = size.Set(Path(d))
            s.n = min(s.n, frames)
            inputs = streams(s, work)
            arms = ["ojph"] + [f"{u}{c}" for u, cs in USAGES.items() for c in cs]
            for r in range(rounds):
                for pos, arm in enumerate(order(arms, r)):
                    others = busy_others()
                    if arm == "ojph":
                        res = ojph_arm(s, work)
                    else:
                        usage = arm.rstrip("0123456789")
                        res = av1_arm(build, s, work, inputs, usage, int(arm[len(usage):]))
                    wall, cpu_s, nbytes, ok = res
                    line = [s.name, r, pos, arm, ok, nbytes, f"{wall:.3f}", f"{cpu_s:.3f}", f"{others:.2f}"]
                    fh.write("\t".join(str(v) for v in line) + "\n")
                    fh.flush()
                    print("\t".join(str(v) for v in line), flush=True)


if __name__ == "__main__":
    main()
