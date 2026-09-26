#!/usr/bin/env python3
"""What a browser's WebTransport exposes: `typeof getStats`, the stats object after 40 frames,
`congestionControl`, and the user agent. Needs the static host (`server/dev-server.py --port 8765`).
usage: browser_getstats.py <server-bin> [fixture]
"""
import hashlib, json, os, signal, socket, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
bin_ = sys.argv[1]
fixture = sys.argv[2] if len(sys.argv) > 2 else str(ROOT / "lab/fixtures/frames_32k/frames_32k.sbnd")
HTTP = int(os.environ.get("HTTP_PORT", "8765"))
CHROME = os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
cert = ROOT / "server/dev-cert/cert.pem"
pin = hashlib.sha256(subprocess.check_output(["openssl", "x509", "-in", str(cert), "-outform", "DER"])).hexdigest()
srv = subprocess.Popen([bin_, "--port", str(port), "--study", fixture, "--bind", "127.0.0.1",
                        "--cert-pem", str(cert), "--key-pem", str(ROOT / "server/dev-cert/key.pem")], cwd=ROOT,
                       env=dict(os.environ, NO_COLOR="1", RUST_LOG="exact_server=error"), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for line in srv.stdout:
    if line.startswith("telemetry="): break
PROBE = """async ([url, pin]) => {
  const hash = Uint8Array.from(pin.match(/../g).map(h => parseInt(h, 16)));
  const t = new WebTransport(url, { serverCertificateHashes: [{ algorithm: "sha-256", value: hash }] });
  await t.ready;
  const w = (await t.createBidirectionalStream()).writable.getWriter();
  const enc = new TextEncoder();
  const ask = (i) => { const body = enc.encode(JSON.stringify({ op: "request_frame", frame: i })); const m = new Uint8Array(4 + body.length); new DataView(m.buffer).setUint32(0, body.length, true); m.set(body, 4); return w.write(m); };
  const r = (await t.incomingUnidirectionalStreams.getReader().read()).value.getReader();
  for (let i = 0; i < 40; i++) await ask(i);
  let got = 0;
  while (got < 40 * 4) { const { value, done } = await r.read(); if (done) break; got += value.length; }
  const st = typeof t.getStats === "function" ? await t.getStats() : null;
  const plain = st ? Object.fromEntries(Object.getOwnPropertyNames(Object.getPrototypeOf(st)).filter(k => k !== "constructor").map(k => [k, st[k]])) : null;
  return { userAgent: navigator.userAgent, getStats: typeof t.getStats, congestionControl: t.congestionControl ?? null, stats: plain };
}"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True, args=["--enable-features=WebTransport", "--no-sandbox"])
        page = b.new_page()
        page.goto(f"http://127.0.0.1:{HTTP}/harness/ts.html", wait_until="domcontentloaded")
        print(json.dumps(page.evaluate(PROBE, [f"https://127.0.0.1:{port}/", pin]), indent=1, default=str))
        b.close()
finally:
    srv.send_signal(signal.SIGTERM); srv.wait(timeout=3)
