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
                rel = "/index.html"
            return str(ROOT / "client" / "harness" / rel.lstrip("/"))
        if path.startswith("/client/transport-wasm/pkg/"):
            rel = path[len("/client/transport-wasm/pkg/") :]
            return str(ROOT / "client" / "transport-wasm" / "pkg" / rel)
        if path.startswith("/client/transport-ts/"):
            rel = path[len("/client/transport-ts/") :]
            return str(ROOT / "client" / "transport-ts" / rel)
        return super().translate_path(path)

    def end_headers(self):
        # Allow SharedArrayBuffer later; COOP/COEP optional for now.
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".ts"):
            return "text/typescript"
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        return

