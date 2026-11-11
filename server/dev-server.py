#!/usr/bin/env python3
"""Minimal static host for the viewer at /, the harness, WASM pkg, series metadata, and dev-transport.json."""

import argparse
import ipaddress
import json
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
# What the pages fetch; the rest of the checkout holds the dev key and .git. deploy/README.md
SERVED = {"client", "fixtures", "lab"}
# A re-packed catalog or an edited page must not be read stale from a heuristic cache.
REVALIDATED = {"text/html", "application/json"}


def policy(host: str) -> str:
    """The viewer's policy as deploy/nginx sends it, but connecting anywhere on loopback, where the lab's relays
    listen, and on the address the page is served from."""
    hosts = " ".join(f"{scheme}://{h}:*" for h in dict.fromkeys(["127.0.0.1", host]) for scheme in ("http", "https"))
    return (
        "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
        f"connect-src 'self' {hosts}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    )


VIEWER = {"/", "/client/viewer/index.html"}


class Handler(SimpleHTTPRequestHandler):
    series_name: str = "us_cine_smoke"
    metadata: Path | None = None
    transport: Path | None = None
    # An optimal-quality series' exact series, by the id its metadata names: client/README.md §Optimal quality, exact on request
    exact: dict[str, Path] = {}
    log_requests = False
    csp = policy("127.0.0.1")
    # Where the lab's client beacon is appended as JSONL, None to refuse it: lab/phone/README.md
    beacon: Path | None = None
    beacon_lock = threading.Lock()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path: str) -> str:
        path = unquote(path.split("?", 1)[0])
        if path == "/":
            return super().translate_path("/client/viewer/index.html")
        if path in self.exact:
            return str(self.exact[path])
        if path.startswith("/series/metadata"):
            return str(self.metadata or ROOT / "fixtures" / self.series_name / "metadata.json")
        if path.startswith("/wt/dev-transport.json"):
            return str(self.transport or ROOT / "client" / "dev-transport.json")
        if path == "/harness" or path.startswith("/harness/"):
            rel = path[len("/harness") :].lstrip("/") or "index.html"
            return super().translate_path("/lab/harness/" + rel)
        return super().translate_path(path)

    def send_head(self):
        if self.log_requests:
            # One write per line: `print` writes the newline apart, and the threads' lines interleaved.
            print(f"GET {self.path}\n", end="", flush=True)
        path = Path(self.translate_path(self.path))
        if path in (self.metadata, self.transport, *self.exact.values()):
            return super().send_head()
        top = path.relative_to(ROOT).parts[:1] if path.is_relative_to(ROOT) else ()
        if not top or top[0] not in SERVED:
            self.send_error(404)
            return None
        return super().send_head()

    def do_POST(self):
        if not self.beacon or self.path != "/lab/beacon":
            self.send_error(404)
            return
        try:
            records = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except ValueError:
            records = None
        if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
            self.send_error(400, "a JSON list of records")
            return
        with self.beacon_lock, self.beacon.open("a") as f:
            f.write("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in records))
        self.send_response(204)
        self.end_headers()

    def send_header(self, keyword, value):
        super().send_header(keyword, value)
        if keyword.lower() == "content-type" and value.split(";")[0].strip() in REVALIDATED:
            super().send_header("Cache-Control", "no-cache")

    def end_headers(self):
        # Cross-origin isolation sets the clock floor: docs/rig-limits.md §6.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        # The viewer's page alone: the lab's pages share its workers and run inline scripts.
        if unquote(self.path.split("?", 1)[0]) in VIEWER:
            self.send_header("Content-Security-Policy", self.csp)
        super().end_headers()

    def log_message(self, fmt, *args):
        return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765, help="0 picks a free one")
    parser.add_argument("--bind", type=ipaddress.IPv4Address, default=ipaddress.IPv4Address("127.0.0.1"),
                        help="the address to serve on, the laptop's toward a phone (README.md §Demo)")
    parser.add_argument("--series", default="us_cine_smoke")
    parser.add_argument("--metadata", type=Path, help="serve this file as /series/metadata, in place of the series'")
    parser.add_argument("--transport", type=Path, help="serve this file as /wt/dev-transport.json")
    parser.add_argument("--exact-metadata", type=Path, help="a lossy --metadata's exact series: its metadata")
    parser.add_argument("--exact-transport", type=Path, help="and the transport file of the server that serves it")
    parser.add_argument("--beacon", type=Path, metavar="FILE", help="append the lab's client beacon here as JSONL (lab/phone/README.md)")
    parser.add_argument("--log-requests", action="store_true", help="print each path asked for (client/viewer/check.mjs)")
    args = parser.parse_args()
    if args.bind.is_unspecified:
        parser.error("--bind takes one address: 0.0.0.0 would serve the page on every network the host is on")
    if not args.transport:
        # The page dials the dev certificate's hash: one made, or renewed when it ends within a day.
        subprocess.run([ROOT / "server/scripts/gen_dev_cert.sh", "--if-needed"], check=True, stdout=sys.stderr)
    Handler.series_name = args.series
    Handler.metadata = args.metadata and args.metadata.resolve()
    Handler.transport = args.transport and args.transport.resolve()
    Handler.log_requests = args.log_requests
    Handler.beacon = args.beacon and args.beacon.resolve()
    Handler.csp = policy(str(args.bind))
    if args.exact_metadata or args.exact_transport:
        if not (args.metadata and args.exact_metadata and args.exact_transport):
            parser.error("--exact-metadata and --exact-transport go together, with a lossy --metadata")
        sid = json.loads(args.metadata.read_text()).get("exactSeries")
        if not sid:
            parser.error(f"{args.metadata} names no exactSeries")
        Handler.exact = {f"/series/{sid}/metadata": args.exact_metadata.resolve(), f"/wt/{sid}/dev-transport.json": args.exact_transport.resolve()}
    server = ThreadingHTTPServer((str(args.bind), args.port), Handler)
    port = server.server_address[1]
    print(f"port={port} http://{args.bind}:{port}/ series={args.series}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
