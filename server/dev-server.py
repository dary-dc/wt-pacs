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
        path = unquote(path.split("?", 1)[0])
        if path.startswith("/study/metadata"):
            p = ROOT / "fixtures" / self.study_name / "metadata.json"
            return str(p)
        if path.startswith("/wt/dev-transport.json"):
            p = ROOT / "client" / "dev-transport.json"
            return str(p)
        if path == "/harness" or path.startswith("/harness/"):
            rel = path[len("/harness") :].lstrip("/") or "index.html"
            return super().translate_path("/client/harness/" + rel)
        return super().translate_path(path)

    def end_headers(self):
        # Cross-origin isolation sets the clock floor: docs/rig-limits.md §6.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".ts"):
            return "text/typescript"
        return super().guess_type(path)

    def log_message(self, fmt, *args):
        return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765, help="0 picks a free one")
    parser.add_argument("--study", default="us_cine_smoke")
    args = parser.parse_args()
    Handler.study_name = args.study
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    port = server.server_address[1]
    print(f"port={port} http://127.0.0.1:{port}/harness/ study={args.study}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
