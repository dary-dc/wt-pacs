#!/usr/bin/env python3
"""page-runs.md §4's arms (claude/page-runs) as total-time variants of view_frames.py's `page`: each its hold.

usage: python3 lab/viewer/ask_variants.py WORK/SET/variants.json
"""
import json
import sys

p = sys.argv[1]
v = json.load(open(p))
page = v["variants"]["page"]
v["variants"] = {**v["variants"], **{arm: {**page, "hold": hold} for arm, hold in
                 (("behind", "behind"), ("ahead34", "ahead34"), ("centred", "centred"), ("struck", "struck"),
                  ("centredaa", "centred"), ("rule", "rule"))}}
json.dump(v, open(p, "w"))
print(p, sorted(v["variants"]))
