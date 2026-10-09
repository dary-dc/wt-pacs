#!/usr/bin/env python3
"""Minimal static host for the viewer at /, the harness, WASM pkg, series metadata, and dev-transport.json."""

import argparse
import json
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
# What the pages fetch; the rest of the checkout holds the dev key and .git. deploy/README.md
SERVED = {"client", "fixtures", "lab"}
# A re-packed catalog or an edited page must not be read stale from a heuristic cache.
REVALIDATED = {"text/html", "application/json"}


class Handler(SimpleHTTPRequestHandler):
    series_name: str = "us_cine_smoke"
    metadata: Path | None = None
    transport: Path | None = None
    log_requests = False

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        path = unquote(path.split("?", 1)[0])
        if path == "/":
            return super().translate_path("/client/viewer/index.html")
        if path.startswith("/series/metadata"):
            return str(self.metadata or ROOT / "fixtures" / self.series_name / "metadata.json")
        if path.startswith("/wt/dev-transport.json"):
            return str(self.transport or ROOT / "client" / "dev-transport.json")
        if path == "/harness" or path.startswith("/harness/"):
            rel = path[len("/harness") :].lstrip("/") or "index.html"
            return super().translate_path("/client/harness/" + rel)
        return super().translate_path(path)

    def send_head(self):
        if self.log_requests:
            print(f"GET {self.path}", flush=True)
        path = Path(self.translate_path(self.path))
        if path in (self.metadata, self.transport):
            return super().send_head()
        top = path.relative_to(ROOT).parts[:1] if path.is_relative_to(ROOT) else ()
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
    parser.add_argument("--series", default="us_cine_smoke")
    parser.add_argument("--metadata", type=Path, help="serve this file as /series/metadata, in place of the series'")
    parser.add_argument("--transport", type=Path, help="serve this file as /wt/dev-transport.json")
    parser.add_argument("--log-requests", action="store_true", help="print each path asked for (client/viewer/check.mjs)")
    args = parser.parse_args()
    if not args.transport:
        # The page dials the dev certificate's hash: one made, or renewed when it ends within a day.
        subprocess.run([ROOT / "server/scripts/gen_dev_cert.sh", "--if-needed"], check=True, stdout=sys.stderr)
    Handler.series_name = args.series
    Handler.metadata = args.metadata and args.metadata.resolve()
    Handler.transport = args.transport and args.transport.resolve()
    Handler.log_requests = args.log_requests
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    port = server.server_address[1]
    print(f"port={port} http://127.0.0.1:{port}/ series={args.series}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
