#!/usr/bin/env python3
"""Minimal static host for harness, WASM pkg, study metadata, and dev-transport.json."""

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    study_name: str = "us_cine_smoke"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        path = unquote(path)
        if path.startswith("/study/metadata"):
            p = ROOT / "fixtures" / self.study_name / "metadata.json"
            return str(p)
        if path.startswith("/wt/dev-transport.json"):
            p = ROOT / "client" / "dev-transport.json"
            return str(p)
        if path.startswith("/harness"):
            rel = path[len("/harness") :]
            if not rel or rel == "/":
