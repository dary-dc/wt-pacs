#!/usr/bin/env python3
"""The device runner's host: the page and its code, the bundles, each arm's transport, and the rows posted back.

Everything sits behind DEVICES_TOKEN, given once as `/?t=TOKEN` and then carried by a cookie. lab/devices/README.md
"""

import argparse
import hmac
import json
import os
import re
import ssl
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
BUNDLE = re.compile(r"^/bundles/([A-Za-z0-9_.-]+)\.sbnd$")
# The page's own code: the client's modules, the lab's order and this kit; nothing else of the checkout.
CODE = ("/client/", "/lab/devices/", "/lab/order.mjs")
MAX_POST = 16 << 20


def settings(banner: Path) -> dict:
    """The `key=value` lines a series-server prints at start (its settings), or {} before it has."""
    if not banner.is_file():
        return {}
    return dict(l.split("=", 1) for l in banner.read_text().splitlines() if "=" in l)


def kit(args) -> dict:
    arms = []
    for a in json.loads((HERE / "arms.json").read_text()):
        wt = args.wt / a["name"]
        t = json.loads((wt / "dev-transport.json").read_text()) if (wt / "dev-transport.json").is_file() else {}
        arms.append({**a, "wt_url": t.get("wt_url"), "cert_sha256": t.get("cert_sha256"), "settings": settings(wt / "banner.txt")})
    return {"arms": arms, "d2Set": args.d2_set, "build": args.build}


class Handler(SimpleHTTPRequestHandler):
    args = None
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                      ".wasm": "application/wasm", ".json": "application/json"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(self.args.root), **kw)

    def allowed(self) -> bool:
        want = self.args.token.encode()
        given = parse_qs(urlsplit(self.path).query).get("t", [""])[0]
        cookie = re.search(r"(?:^|;\s*)t=([^;]*)", self.headers.get("Cookie", ""))
        return any(hmac.compare_digest(want, v.encode()) for v in (given, cookie.group(1) if cookie else "") if v)

    def deny(self):
        self.send_error(403)

    def do_GET(self):
        if not self.allowed():
            return self.deny()
        path = urlsplit(self.path).path
        if path == "/":
            self.cookie = f"t={self.args.token}; Path=/; Secure; HttpOnly; SameSite=Strict"
            self.path = "/lab/devices/index.html"
        elif path == "/kit.json":
            return self.reply(200, json.dumps(kit(self.args)).encode(), "application/json")
        elif m := BUNDLE.match(path):
            f = self.args.studies / f"{m.group(1)}.sbnd"
            return self.reply(200, f.read_bytes(), "application/octet-stream") if f.is_file() else self.send_error(404)
        elif not path.startswith(CODE) or ".." in path:
            return self.send_error(404)
        super().do_GET()

    def do_HEAD(self):
        self.send_error(405)

    def do_POST(self):
        if not self.allowed():
            return self.deny()
        if urlsplit(self.path).path != "/collect":
            return self.send_error(404)
        n = int(self.headers.get("Content-Length", 0))
        if not 0 < n <= MAX_POST:
            return self.send_error(413)
        try:
            rows = json.loads(self.rfile.read(n))
            assert isinstance(rows, list) and all(isinstance(r, dict) for r in rows)
        except (ValueError, AssertionError):
            return self.send_error(400)
        with open(self.args.out / f"rows-{time.strftime('%Y-%m-%d')}.jsonl", "a") as f:
            for r in rows:
                f.write(json.dumps({**r, "collected": time.time()}) + "\n")
        self.reply(204, b"", None)

    def reply(self, code, body, ctype):
        self.send_response(code)
        if ctype:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Cross-origin isolation, as the product's host sends it: deploy/nginx/wt-pacs.conf.template.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-cache")
        if getattr(self, "cookie", None):
            self.send_header("Set-Cookie", self.cookie)
        super().end_headers()

    def log_message(self, fmt, *a):
        if self.args.log:
            sys.stderr.write(f"{self.command} {urlsplit(self.path).path} {a[1] if len(a) > 1 else ''}\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=HERE.parents[1], help="the kit: client/ (built), lab/order.mjs, lab/devices/")
    p.add_argument("--studies", type=Path, required=True, help="the bundles, NAME.sbnd")
    p.add_argument("--wt", type=Path, required=True, help="one directory an arm: its dev-transport.json and banner.txt")
    p.add_argument("--out", type=Path, required=True, help="rows-DATE.jsonl, appended")
    p.add_argument("--d2-set", default="dbt10_ea1141")
    p.add_argument("--build", default="unknown")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8443, help="0 picks a free one")
    p.add_argument("--tls", type=Path, help="a directory with cert.pem and key.pem; without it, HTTP (localhost only)")
    p.add_argument("--log", action="store_true")
    args = p.parse_args()
    args.token = os.environ.get("DEVICES_TOKEN", "")
    if len(args.token) < 16:
        sys.exit("set DEVICES_TOKEN to a secret of 16 characters or more")
    if not args.tls and args.host not in ("127.0.0.1", "localhost", "::1"):
        sys.exit("without --tls the page is no secure context off localhost: --tls DIR or --host 127.0.0.1")
    args.out.mkdir(parents=True, exist_ok=True)
    Handler.args = args
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    if args.tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(args.tls / "cert.pem", args.tls / "key.pem")
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
    print(f"port={server.server_address[1]}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
