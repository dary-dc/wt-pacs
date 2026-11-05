#!/usr/bin/env python3
"""rule_test.py against rule.py broken on purpose, one break at a time: each must fail the test; rule.py is restored
after each, and each child imports from a fresh bytecode cache.

usage: mutate_rule.py   — exits 1 if a break passes
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BREAKS = {
    "a jump starts one unit late": ("key = lambda i: i - i % g", "key = lambda i: i - i % g + (i % g > 0)"),
    "the residual left out of exact": ("(p[0], sum(p), sum(pv), sum(pv) + sum(r))", "(p[0], sum(p), sum(pv), sum(pv))"),
    "the quarter base's low bits dropped": ("jump(lambda i: run(T, i) + lo[i]), jump(lambda i: run(T, i) + lo[i])),",
                                             "jump(lambda i: run(T, i)), jump(lambda i: run(T, i) + lo[i])),"),
    "the whole HTJ2K frame left out of sep's jump": ("je = {i: t + ctrl[i] for i, t in jv.items()}", "je = jv"),
    "one pays a preview it does not have": ('return dict(zip(STAGES, (vl[0], sum(vl), sum(vl),', 'return dict(zip(STAGES, (vl[0], sum(vl), sum(pre) + sum(vl),'),
    "a failed residual kept": ('or ("res" in x and x.get("exact") < x["frames"]))', ")"),
    "a failed lossy check kept": ('or x.get("lossy") is False\n', "\n"),
    "the A/A gate ignored": ("return b not in unread and not any(", "return not any("),
    "the control's order flag ignored": ('for a in (*ARMS_OF[c], "ctrl"))', "for a in ARMS_OF[c])"),
    "svc read from its own rung only": ("for vv in ((4, 8) if c == \"svc\" else (v,)):", "for vv in (v,):"),
    "too few rounds let bytes decide": ("    if median_interval(d)[1] is None:\n        return \"not read\"\n", ""),
    "the lower time read as the higher": ('return {"A": "x", "B": "y"}', 'return {"A": "y", "B": "x"}'),
    "an unread stage ignored": ('return got if got == "a trade" or all(r for *_, r in doms) else "not read"', "return got"),
    "a trade read as better": ('got = "a trade" if t and x else', 'got = "better" if t and x else'),
    "order effect at a fixed bar": ("out[c] = (p, p < ALPHA / n[c[:3]])", "out[c] = (p, p < 0)"),
}

path = HERE / "rule.py"
src = path.read_text()
passed = []
try:
    for name, (a, b) in BREAKS.items():
        assert src.count(a) == 1, name
        path.write_text(src.replace(a, b))
        env = dict(os.environ, PYTHONPYCACHEPREFIX=tempfile.mkdtemp())
        r = subprocess.run([sys.executable, str(HERE / "rule_test.py")], capture_output=True, text=True, env=env)
        print(f"{name}: {'caught' if r.returncode else 'NOT CAUGHT'} ({(r.stdout.strip().splitlines() or [r.stderr.strip()[-80:]])[0]})")
        if not r.returncode:
            passed.append(name)
finally:
    path.write_text(src)
sys.exit(1 if passed else 0)
