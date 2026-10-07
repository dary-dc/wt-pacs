#!/usr/bin/env python3
"""The client's AV1 test items and WebCodecs probes, made by the writer from synthetic sources.

  client/conformance/av1/items/{plain,optimized}/NAME.av1   one item each, through ingest.py
  client/conformance/av1/items/{plain,optimized}/NAME.sha256 the source samples' checksum
  client/conformance/av1/items/grey420/g8.av1                 8-bit grey coded 4:2:0 at full range (row GREY420)
  client/conformance/av1/items/matrix/b{B}k{K}{u,s}.av1       row 43: every (bits, split, sign) a rule could pick
  client/downloader/av1-probe.js                              a 16×16 unit per layout WebCodecs may take

Every source is written with the checksum of its samples before anything codes it; ingest.py
writes an item only if it decodes back to that. A probe's FNV-1a is of its coded planes as made
here, checked against native dav1d before it is written.

usage: make_golden.py BUILD [--matrix]   — lab/av1/item/README.md; --matrix writes only row 43's
"""
import base64
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
ITEMS = ROOT / "client/conformance/av1/items"
PROBE = ROOT / "client/downloader/av1-probe.js"
W, H = 64, 48

# name: channels, min, max, signed — each a depth or a layout the item format treats apart
SETS = {
    "g8": (1, 0, 255, False),
    "g10": (1, 0, 1023, False),
    "g12": (1, 0, 4095, False),
    "s11": (1, 0, 1765, True),
    "s13": (1, -2048, 6143, True),
    "g14": (1, 0, 16383, False),
    "c8": (3, 0, 255, False),
    "g9": (1, 0, 511, False),
}


def content(ch, lo, hi, seed, w=W, h=H):
    """A gradient under soft discs with grain, hitting lo and hi exactly."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w] / max(w, h)
    base = 0.5 + 0.3 * np.sin(6 * x + 2 * seed) * np.cos(5 * y)
    for _ in range(4):
        cx, cy, r = rng.random(3) * [1, 1, 0.3]
        base += 0.25 * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (r * r + 0.01))
    planes = [np.clip(base + rng.normal(0, 0.02, base.shape) + 0.1 * c, 0, None) for c in range(ch)]
    v = np.stack(planes, -1)
    v = lo + np.round((v - v.min()) / (v.max() - v.min()) * (hi - lo))
    return v.astype(np.int64)


def write_set(d, ch, lo, hi, signed, seed, w=W, h=H):
    d.mkdir(parents=True)
    dtype = ("i1" if signed else "u1") if hi - lo <= 255 else ("<i2" if signed else "<u2")
    px = content(ch, lo, hi, seed, w, h).astype(dtype)
    px.tofile(d / "000.raw")
    (d / "000.sha256").write_text(hashlib.sha256(px.tobytes()).hexdigest() + "\n")
    stored = 8 if dtype in ("u1", "i1") else 16
    meta = dict(frameCount=1, width=w, height=h, channels=ch, bitsStored=stored, signed=signed,
                min=int(px.min()), max=int(px.max()))
    (d / "metadata.json").write_text(json.dumps(meta) + "\n")


def items(build, work):
    for seed, (name, (ch, lo, hi, signed)) in enumerate(SETS.items()):
        src = work / name
        write_set(src, ch, lo, hi, signed, seed)
        for rep in ("plain", "optimized"):
            out = work / f"{name}.{rep}"
            subprocess.run([sys.executable, Path(__file__).parent / "ingest.py", build, src, out,
                            "--representation", rep, "--jobs", "1"], check=True)
            dst = ITEMS / rep
            dst.mkdir(parents=True, exist_ok=True)
            (dst / f"{name}.av1").write_bytes((out / "000.av1").read_bytes())
            (dst / f"{name}.sha256").write_text((out / "000.sha256").read_text())
    out, dst = work / "g8.grey420", ITEMS / "grey420"
    subprocess.run([sys.executable, Path(__file__).parent / "ingest.py", build, work / "g8", out, "--grey8", "420", "--jobs", "1"],
                   check=True)
    dst.mkdir(exist_ok=True)
    (dst / "g8.av1").write_bytes((out / "000.av1").read_bytes())
    (dst / "g8.sha256").write_text((out / "000.sha256").read_text())


def matrix(build, work):
    """32×24 grey of b = 8…16 bits after the offset, unsigned and signed, at every split k of lab/av1/splitok."""
    sys.path.insert(0, str(ROOT / "lab/av1/splitok"))
    from make_sets import splits
    dst = ITEMS / "matrix"
    dst.mkdir(parents=True, exist_ok=True)
    for b in range(8, 17):
        for signed in (False, True):
            lo = -(1 << (b - 1)) if signed else 0
            name = f"b{b}{'s' if signed else 'u'}"
            src = work / name
            write_set(src, 1, lo, lo + (1 << b) - 1, signed, b, 32, 24)
            for k in splits(b):
                out = work / f"{name}.k{k}"
                subprocess.run([sys.executable, Path(__file__).parent / "ingest.py", build, src, out, "--split", str(k),
                                "--jobs", "1"], check=True)
                (dst / f"b{b}k{k}{name[-1]}.av1").write_bytes((out / "000.av1").read_bytes())
                (dst / f"b{b}k{k}{name[-1]}.sha256").write_text((out / "000.sha256").read_text())


def fnv(planes):
    h = 0x811C9DC5
    for p in planes:
        for v in p.ravel():
            h = ((h ^ int(v)) * 0x01000193) & 0xFFFFFFFF
    return h


def probes(build, work):
    """name: (depth, ingest's stream layout); colour as 4:4:4 identity, the first plane coded as luma."""
    out = {}
    names = {"g8": (8, "400"), "g10": (10, "400"), "c8": (8, "444"), "c10": (10, "444"), "g8f": (8, "420")}
    for seed, (name, (depth, layout)) in enumerate(names.items()):
        ch = 3 if layout == "444" else 1
        px = content(ch, 0, (1 << depth) - 1, 100 + seed, 16, 16)
        y4m, ivf = work / f"{name}.y4m", work / f"{name}.ivf"
        ingest.write_y4m(y4m, [px], depth, layout)
        subprocess.run([build / f"aom-{ingest.size.AOM}/bin/aomenc", "-q", "-o", ivf, "--limit=1",
                        *ingest.encoder_args("cpu0", "plain", depth, layout), y4m], check=True, capture_output=True)
        unit = ingest.size.ivf_units(ivf)[0]
        got, bits = ingest.decode(build, unit, work)
        want = fnv([px[..., c] for c in range(ch)])
        if bits != depth or fnv([got[..., c] for c in range(ch)]) != want:
            sys.exit(f"probe {name}: dav1d does not return its samples")
        out[name] = dict(width=16, height=16, fnv=want, unit=base64.b64encode(unit).decode())
    lines = [f'  {k}: {{ width: 16, height: 16, fnv: 0x{v["fnv"]:08x}, unit: "{v["unit"]}" }},' for k, v in out.items()]
    PROBE.write_text(
        "/** A 16×16 unit per layout WebCodecs may take, and the FNV-1a of its coded planes. Made by lab/av1/item/make_golden.py. */\n"
        "export const PROBES = {\n" + "\n".join(lines) + "\n};\n")


def main():
    build = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory() as tmp:
        if "--matrix" not in sys.argv:
            items(build, Path(tmp))
            probes(build, Path(tmp))
        matrix(build, Path(tmp))


if __name__ == "__main__":
    main()
