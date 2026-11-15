#!/usr/bin/env python3
"""roles_test.py against roles.py broken on purpose, one break at a time: each must fail the test; roles.py is
restored after each.

usage: mutate.py   — exits 1 if a break passes
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BREAKS = {
    "the link ignores the previous frame": ("t = max(t0 + sent * 8 / (mbps * 1e3), t) + d", "t = t0 + sent * 8 / (mbps * 1e3) + d"),
    "bytes interpolated linearly": ("return math.exp(math.log(b0) + f * (math.log(b1) - math.log(b0)))", "return b0 + f * (b1 - b0)"),
    "an ask begins one unit late": ("return sum(top[k - k % key:k + 1])", "return sum(top[k - k % key + 1:k + 1])"),
    "no A/A range": ("outside = not (min(a) <= paired <= max(a))", "outside = True"),
    "a trade read as a win": ('return f"{won.pop()} better" if len(won) == 1 else "a trade"', 'return f"{sorted(won)[0]} better"'),
    "the order effect against another centre": ("m = statistics.median(allv)", "m = statistics.mean(allv) * 1.01"),
}

path = HERE / "roles.py"
src = path.read_text()
passed = []
try:
    for name, (a, b) in BREAKS.items():
        assert src.count(a) == 1, name
        path.write_text(src.replace(a, b))
        r = subprocess.run([sys.executable, str(HERE / "roles_test.py")], capture_output=True, text=True)
        print(f"{name}: {'caught' if r.returncode else 'NOT CAUGHT'} ({r.stdout.strip().splitlines()[-1]})")
        if not r.returncode:
            passed.append(name)
finally:
    path.write_text(src)
sys.exit(1 if passed else 0)
