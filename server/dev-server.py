#!/usr/bin/env python3
"""Minimal static host for harness, WASM pkg, study metadata, and dev-transport.json."""

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
# What the pages fetch; the rest of the checkout holds the dev key and .git. deploy/README.md
SERVED = {"client", "fixtures", "lab"}
# A re-packed catalog or an edited page must not be read stale from a heuristic cache.
REVALIDATED = {"text/html", "application/json"}


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

    def send_head(self):
        top = Path(self.translate_path(self.path)).relative_to(ROOT).parts[:1]
        if not top or top[0] not in SERVED:
            self.send_error(404)
            return None
        return super().send_head()

    def send_header(self, keyword, value):
        super().send_header(keyword, value)
        if keyword.lower() == "content-type" and value.split(";")[0].strip() in REVALIDATED:
            super().send_header("Cache-Control", "no-cache")

    def end_headers(self):
        # Cross-origin isolation sets the clock floor: docs/rig-limits.md §6.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

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
    print(f"port={port} http://127.0.0.1:{port}/harness/cell.html?autorun=1 study={args.study}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
