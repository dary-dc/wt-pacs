#!/usr/bin/env python3
"""MIXDEC's variants for row TOTAL's harness: beside each split variant kK whose top is over 10 bits, kKm — the
same payloads, `mixed` in the decoder config. Rewrites OUT/SET/variants.json as lab/av1/delivery/split-rule/make_frames.py
wrote it.   usage: mixed_variants.py OUT   — lab/av1/decode/mixed/README.md
"""
import json
import sys
from pathlib import Path

for f in sorted(Path(sys.argv[1]).glob("*/variants.json")):
    s = json.loads(f.read_text())
    for name in [a for a in s["variants"] if a.startswith("k") and not a.endswith("m")]:
        if s["bits"] - int(name[1:]) > 10:
            s["variants"][f"{name}m"] = dict(s["variants"][name], mixed=True)
    f.write_text(json.dumps(s, indent=1))
    print(s["name"], s["bits"], "bits:", ", ".join(s["variants"]))
