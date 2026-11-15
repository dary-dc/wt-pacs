#!/usr/bin/env python3
"""lab/av1/delivery/scalable/tool/shapes.py as committed at 301c5e24, run for the one shape stage 3 names: the quarter
base at q 40, two layers, a keyframe every 8. The other shapes' codings are not needed here.

usage: svc_shapes.py BUILD SHIPPED WORK OUT.tsv SET_DIR ...
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "av1/delivery/scalable/tool"))
import shapes  # noqa: E402

every = shapes.predicted
shapes.predicted = lambda: [p for p in every() if p[0] == "two-quarter-q40"]
shapes.main()
