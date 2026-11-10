"""A 10-bit synthetic pair, lossy_test.py's drifting pattern at 256×192, 24 frames: exact HTJ2K + Q 8 G 8."""
import hashlib, json, subprocess, sys
from pathlib import Path
import numpy as np
mix, out = Path(sys.argv[1]), Path(sys.argv[2])
N, H, W, bits = 24, 192, 256, 10
y, x = np.mgrid[:H, :W]; rng = np.random.default_rng(bits); top = (1 << bits) - 1
src = out / "src"; src.mkdir(parents=True, exist_ok=True)
frames = [np.clip(top * (0.5 + 0.3 * np.sin((x + 2 * i) / 7) * np.cos(y / 9)) + rng.normal(0, top / 400, (H, W)), 0, top).astype(np.uint16)[..., None] for i in range(N)]
for i, px in enumerate(frames):
    raw = np.ascontiguousarray(px, "<u2").tobytes()
    (src / f"{i:03d}.raw").write_bytes(raw); (src / f"{i:03d}.sha256").write_text(hashlib.sha256(raw).hexdigest() + "\n")
(src / "metadata.json").write_text(json.dumps(dict(frameCount=N, width=W, height=H, channels=1, bitsStored=bits, signed=False, min=int(min(f.min() for f in frames)), max=int(max(f.max() for f in frames)))))
py, tool, build = mix / ".venv/bin/python", mix / "lab/av1/tools/ingest_coded.py", mix / "ingest/.build"
for name, extra in (("exact", ["--codec", "htj2k"]), ("lossy", ["--lossy", "8", "8", "--exact-series", "exact"])):
    d = out / name
    subprocess.run([py, tool, build, src, d, "--jobs", "4", *extra], check=True)
    subprocess.run([mix / "target/release/pack-series", "--metadata", d / "metadata.json", "--frames", d, "--output", out / f"{name}.sbnd"], check=True)
    (out / f"{name}.json").write_bytes((d / "metadata.json").read_bytes())
print(json.dumps({k: json.loads((out / f"{k}.json").read_text()).get(k2) for k, k2 in (("lossy", "exactSeries"), ("exact", "id"))}))
