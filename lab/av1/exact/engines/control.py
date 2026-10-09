#!/usr/bin/env python3
"""Control streams for the WebCodecs probe: ordinary 4:2:0 keyframes, lossy and lossless, 8 and 10 bits,
so an engine that refuses the lossless shapes can be told from one that decodes no AV1 at all.

  control.py BUILD OUT     OUT/control/NAME.obu, OUT/control.json — lab/av1/exact/engines/README.md
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from size import AOM, ivf_units  # noqa: E402

W, H = 128, 96
CONTROLS = {"420-8-lossy": (8, ["--end-usage=q", "--cq-level=30"]), "420-8-lossless": (8, ["--lossless=1"]),
            "420-10-lossy": (10, ["--end-usage=q", "--cq-level=30"])}


def main():
    build, out = Path(sys.argv[1]), Path(sys.argv[2])
    (out / "control").mkdir(parents=True, exist_ok=True)
    y, x = np.mgrid[:H, :W]
    for name, (bits, flags) in CONTROLS.items():
        top = (1 << bits) - 1
        planes = [(x * top // W), (y * top // H)[::2, ::2], ((x + y) * top // (W + H))[::2, ::2]]
        y4m, ivf = out / "control" / "in.y4m", out / "control" / "out.ivf"
        tag = f"C420p{bits}" if bits > 8 else "C420"
        dtype = "<u2" if bits > 8 else "u1"
        y4m.write_bytes(f"YUV4MPEG2 W{W} H{H} F1:1 Ip A1:1 {tag}\nFRAME\n".encode()
                        + b"".join(p.astype(dtype).tobytes() for p in planes))
        subprocess.run([build / f"aom-{AOM}/bin/aomenc", "-q", "--ivf", "-o", ivf, "--cpu-used=6", "--limit=1",
                        f"--bit-depth={bits}", f"--input-bit-depth={bits}", "--kf-max-dist=0", *flags, y4m],
                       check=True, capture_output=True)
        (out / "control" / f"{name}.obu").write_bytes(ivf_units(ivf)[0])
    (out / "control.json").write_text(json.dumps(list(CONTROLS)))


if __name__ == "__main__":
    main()
