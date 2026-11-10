#!/usr/bin/env python3
"""The SHA-256 of each of make_series.py's distinct fields, little-endian as the page holds them: sha.py W H OUT.json"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("make_series", Path(__file__).parents[1] / "viewer-ceiling/make_series.py")
make_series = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_series)
w, h = int(sys.argv[1]), int(sys.argv[2])
Path(sys.argv[3]).write_text(json.dumps([hashlib.sha256(make_series.field(w, h, i).astype("<u2").tobytes()).hexdigest()
                                         for i in range(make_series.DISTINCT)]))
