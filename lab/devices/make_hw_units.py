#!/usr/bin/env python3
"""The hardware-decode probe's units: one lossless AV1 temporal unit per stream form and size, its planes' XXH3-64.

  usage: make_hw_units.py BUILD          writes lab/devices/hw-units.json; BUILD is ingest/tools.sh's build

Each unit is coded by libaom as the ingest codes it (ingest/coded-frames/ingest.py) and decoded back by native
dav1d before it is written. The samples follow `pattern` and `ramp`, which hwdecode.js computes the same way.
"""
import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import xxhash

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
import ingest  # noqa: E402

# name: depth, ingest's stream layout, sizes, samples
FORMS = {
    "g8": (8, "400", (16, 256), "pattern"),
    "g10": (10, "400", (16, 256), "pattern"),
    "g8f": (8, "420", (16, 256), "pattern"),
    "g10f": (10, "420", (16, 256), "pattern"),
    "ramp10": (10, "420", (256,), "ramp"),
}


def pattern(w, h, depth):
    """A diagonal gradient over the whole range with a fine texture on it."""
    y, x = np.mgrid[0:h, 0:w]
    top = (1 << depth) - 1
    return np.minimum((x + 3 * y) * (top + 1) // (4 * w) + ((x * y) & 7), top)


def ramp(w, h, depth):
    """Every 10-bit level once, in raster order, each over w·h/1024 samples."""
    y, x = np.mgrid[0:h, 0:w]
    return (y * w + x) * 1024 // (w * h)


def digest(plane, depth):
    return xxhash.xxh3_64_hexdigest(np.ascontiguousarray(plane, "u1" if depth == 8 else "<u2").tobytes())


def unit(build, work, name, depth, layout, size, samples):
    px = {"pattern": pattern, "ramp": ramp}[samples](size, size, depth)
    y4m, ivf = work / f"{name}.y4m", work / f"{name}.ivf"
    ingest.write_y4m(y4m, [px[..., None]], depth, layout)
    subprocess.run([build / f"aom-{ingest.AOM}/bin/aomenc", "-q", "-o", ivf, "--limit=1",
                    *ingest.encoder_args("cpu0", "plain", depth, layout), y4m], check=True, capture_output=True)
    data = ingest.ivf_units(ivf)[0]
    got, at = ingest.decode(build, data, work)
    if at != depth or not np.array_equal(got[..., 0], px):
        sys.exit(f"{name}: dav1d does not return its samples")
    neutral = np.full(((size + 1) // 2,) * 2, 1 << (depth - 1))
    chroma = digest(neutral, depth) if layout == "420" else None
    return dict(name=f"{name}-{size}", form=name, width=size, height=size, depth=depth, layout=layout, samples=samples,
                unit=base64.b64encode(data).decode(),
                planes=dict(Y=digest(px, depth), U=chroma, V=chroma))


def main():
    build = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory() as tmp:
        units = [unit(build, Path(tmp), n, d, lay, s, smp) for n, (d, lay, sizes, smp) in FORMS.items() for s in sizes]
    out = dict(aom=ingest.AOM, decoders=ingest.DECODERS, units=units)
    (ROOT / "lab/devices/hw-units.json").write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
