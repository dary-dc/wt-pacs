#!/usr/bin/env python3
"""amended_test.py against amended.py broken on purpose, one break at a time: each must fail the test; amended.py is
restored after each, and each child imports from a fresh bytecode cache (a same-length break can otherwise be
read back as the restored file's).

usage: mutate_amended.py   — exits 1 if a break passes
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BREAKS = {
    "the interval one rank wider": ("return statistics.median(s), (s[r - 1] if r else None)", "return statistics.median(s), (s[r - 2] if r else None)"),
    "the interval at 50 %": ("if sum(comb(n, w) for w in range(r, n - r + 1)) / 2 ** n >= level:", "if sum(comb(n, w) for w in range(r, n - r + 1)) / 2 ** n >= 0.5:"),
    "the lower time read as the higher": ('return ("A" if hi < 0 else "B" if lo > 0', 'return ("B" if hi < 0 else "A" if lo > 0'),
    "order effect blind to predecessors": ("for vs in by_prev.values() if len(vs) > 1), default=0.0)", "for vs in by_prev.values() if len(vs) > 99), default=0.0)"),
    "equal bytes never dominate": ("if xb > yb or", "if xb >= yb or"),
    "a time against ignored": ('if xb > yb or "y" in times.values() or', "if xb > yb or"),
    "a time not read lets bytes decide": (' or "not read" in times.values():', ":"),
    "the A/A gate ignored": ("if (s, b) in unread or (s, b,", "if (s, b, b) in unread or (s, b,"),
    "the frontier keeps everything": ("if not any(dominates(o, c) for o in configs if o is not c)]", "]"),
    "an ask begins one unit late": ("sum(tops[i - i % int(k):i + 1])", "sum(tops[i - i % int(k) + 1:i + 1])"),
    "a failed check kept": ('if any(x.get("error") or x.get("exact") is False or x.get("lossy") is False\n                   or ("frames" in x and (x.get("lossy", x.get("exact")) < x["frames"])) for x in rs):',
                            'if any(x.get("error") for x in rs):'),
}

path = HERE / "amended.py"
src = path.read_text()
passed = []
try:
    for name, (a, b) in BREAKS.items():
        assert src.count(a) == 1, name
        path.write_text(src.replace(a, b))
        env = dict(os.environ, PYTHONPYCACHEPREFIX=tempfile.mkdtemp())
        r = subprocess.run([sys.executable, str(HERE / "amended_test.py")], capture_output=True, text=True, env=env)
        print(f"{name}: {'caught' if r.returncode else 'NOT CAUGHT'} ({r.stdout.strip().splitlines()[-1]})")
        if not r.returncode:
            passed.append(name)
finally:
    path.write_text(src)
sys.exit(1 if passed else 0)
