#!/usr/bin/env python3
"""Browser round trip per frame: the TS harness cell in headless Chromium against one server binary.
Needs the static host (`server/dev-server.py --port 8765`) and `client/transport-ts/dist`.
usage: browser.py <label> <server-bin> <fixture> <cell> <n> <depth> <repeats> [server args...]
Prints one line per repeat: label cell depth n wall_ms us_per_frame delivered failed.
"""
import hashlib, json, os, signal, socket, subprocess, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
label, bin_, fixture, cell, n, depth, reps = sys.argv[1:8]
extra = sys.argv[8:]
n, depth, reps = int(n), int(depth), int(reps)
HTTP = int(os.environ.get("HTTP_PORT", "8765"))
CHROME = os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")

def free_udp():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

wt_port = free_udp()
cert = ROOT / "server/dev-cert/cert.pem"
pin = hashlib.sha256(subprocess.check_output(["openssl", "x509", "-in", str(cert), "-outform", "DER"])).hexdigest()
(ROOT / "client/dev-transport.json").write_text(json.dumps({"wt_url": f"https://127.0.0.1:{wt_port}/", "cert_sha256": pin}) + "\n")

env = dict(os.environ, NO_COLOR="1", RUST_LOG="exact_server=error")  # a WARN per refusal would be the measurement
srv = subprocess.Popen([bin_, "--port", str(wt_port), "--study", fixture, "--stream-mode", "shared", "--bind", "127.0.0.1",
                        "--cert-pem", str(cert), "--key-pem", str(ROOT / "server/dev-cert/key.pem"), *extra],
                       cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
frames = None
for line in srv.stdout:
    if line.startswith("frames="): frames = int(line.strip().split("=")[1])
    if line.startswith("telemetry="): break
# keep draining, or a WARN per refused frame fills the pipe and stalls the server
threading.Thread(target=lambda: [None for _ in srv.stdout], daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True, args=["--enable-features=WebTransport", "--no-sandbox"])
        for r in range(reps + 1):  # first is a warm-up, discarded
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            url = f"http://127.0.0.1:{HTTP}/harness/ts.html?autorun=1&cell={cell}&stream_mode=shared&d={depth}&n={n}&frames={frames}"
            page.goto(url, wait_until="networkidle", timeout=30_000)
            page.wait_for_function("() => globalThis.__wtpacsDone === true || globalThis.__wtpacsError != null", timeout=120_000)
            err = page.evaluate("() => globalThis.__wtpacsError ?? null")
            summary = page.evaluate("() => globalThis.__wtpacsShell ?? null")
            page.close()
            if err or errors:
                print("ERROR", err, errors, file=sys.stderr); sys.exit(1)
            if r == 0:
                continue
            asked = summary["asked"]
            print(f"{label}\t{cell}\t{depth}\t{asked}\t{summary['wall_ms']}\t{summary['wall_ms']*1000/asked:.1f}\t{summary['delivered']}\t{summary['failed']}", flush=True)
        browser.close()
finally:
    srv.send_signal(signal.SIGTERM)
    try: srv.wait(timeout=3)
    except subprocess.TimeoutExpired: srv.kill()
