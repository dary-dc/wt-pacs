#!/usr/bin/env python3
"""Firefox's bare WebTransport dial through the relay on fixed-rate links, one server build against
another, (link × build) visits in a Williams order each round. lab/firefox-dial/README.md

    lab/firefox-dial/run.py --builds before=PATH,after=PATH [--links r5000,r10000,r20000,r50000]
                            [--rounds 30] [--cap-ms 5000] [--out rows.jsonl]
    lab/firefox-dial/run.py --summary --out rows.jsonl
"""
import argparse
import hashlib
import http.server
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "lab/scripts"))
from order import order  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--builds", default="")
ap.add_argument("--links", default="r5000,r10000,r20000,r50000")
ap.add_argument("--rounds", type=int, default=30)
ap.add_argument("--first-round", type=int, default=0)
ap.add_argument("--cap-ms", type=int, default=5000)
ap.add_argument("--out", default="rows.jsonl")
ap.add_argument("--summary", action="store_true")
ap.add_argument("--rig-core", default="3")
ap.add_argument("--browser-cores", default="0-2")
args = ap.parse_args()


def summary():
    rows = [json.loads(line) for line in open(args.out)]
    cells = {}
    for r in rows:
        cells.setdefault((r["link"], r["build"]), []).append(r)
    print("| link | build | n | settled | median ms | max ms |")
    print("| --- | --- | --: | --: | --: | --: |")
    for (link, build), rs in sorted(cells.items(), key=lambda kv: (int(kv[0][0][1:]), kv[0][1])):
        ok = sorted(r["ms"] for r in rs if r["ok"])
        med = ok[len(ok) // 2] if ok else "—"
        print(f"| {link} | {build} | {len(rs)} | {len(ok)} | {med if ok else '—'} | {ok[-1] if ok else '—'} |")


if args.summary:
    summary()
    sys.exit(0)

FIREFOX = os.environ["FIREFOX_PATH"]
builds = dict(b.split("=", 1) for b in args.builds.split(","))
links = args.links.split(",")
T = tempfile.mkdtemp(prefix="ff-dial-")
subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                "-keyout", f"{T}/key.pem", "-out", f"{T}/cert.pem", "-days", "2", "-nodes", "-subj", "/CN=localhost",
                "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], check=True, capture_output=True)
der = subprocess.run(["openssl", "x509", "-in", f"{T}/cert.pem", "-outform", "DER"], check=True, capture_output=True).stdout
HASH = hashlib.sha256(der).hexdigest()
SERIES = os.path.join(ROOT, "fixtures/us_cine_smoke/us_cine_smoke.sbnd")

result = {}
got = threading.Event()


class Page(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def do_POST(self):
        result.update(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        got.set()
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def log_message(self, *a):
        pass


page = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
threading.Thread(target=page.serve_forever, daemon=True).start()
PAGE = f"http://127.0.0.1:{page.server_address[1]}"


def visit(link, build, rnd):
    srv = 20000 + int.from_bytes(os.urandom(2), "big") % 20000
    rel = srv + 1
    server = subprocess.Popen(["taskset", "-c", args.browser_cores, builds[build], "--port", str(srv), "--bind", "127.0.0.1",
                               "--series", SERIES, "--cert-pem", f"{T}/cert.pem", "--key-pem", f"{T}/key.pem"],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    for line in server.stdout:
        if line.startswith("transport="):
            break
    relay = subprocess.Popen(["chrt", "-f", "50", "taskset", "-c", args.rig_core, "python3", "lab/scripts/link_impair.py",
                              "--udp", f"{rel}:{srv}", "--seed", str(rnd), "--delay-ms", "20", "--rate-kbit", link[1:],
                              "--queue-pkts", "200"], cwd=ROOT, stdout=subprocess.PIPE, text=True)
    relay.stdout.readline()
    profile = tempfile.mkdtemp(dir=T)
    result.clear()
    got.clear()
    url = f"{PAGE}/index.html?wt=https://127.0.0.1:{rel}/&hash={HASH}&cap={args.cap_ms}&post={PAGE}/r"
    ff = subprocess.Popen(["taskset", "-c", args.browser_cores, FIREFOX, "--headless", "--no-remote", "--profile", profile, url],
                          env={**os.environ, "MOZ_CRASHREPORTER_DISABLE": "1"}, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, start_new_session=True)
    got.wait(args.cap_ms / 1000 + 30)
    row = {"round": rnd, "link": link, "build": build, "ok": bool(result.get("ok")),
           "ms": round(result.get("ms", -1)), "error": result.get("error")}
    os.killpg(ff.pid, signal.SIGKILL)
    ff.wait()
    for p in (relay, server):
        p.kill()
        p.wait()
    shutil.rmtree(profile, ignore_errors=True)
    return row


units = [(link, build) for link in links for build in builds]
for rnd in range(args.first_round, args.first_round + args.rounds):
    for link, build in order(units, rnd):
        row = visit(link, build, rnd)
        with open(args.out, "a") as f:
            f.write(json.dumps(row) + "\n")
        print(json.dumps(row), flush=True)
shutil.rmtree(T, ignore_errors=True)
