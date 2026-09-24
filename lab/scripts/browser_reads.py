#!/usr/bin/env python3
"""How a browser hands a frame to the page: reads per frame and bytes per read on the media
stream, with the default reader and with a BYOB reader asking for the whole frame at once.
Needs the static host (`server/dev-server.py --port 8765`). `docs/lanes/T12-browser-receive.md`.
usage: browser_reads.py <server-bin> <fixture> [frames=40]
"""
import hashlib, json, os, signal, socket, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
bin_, fixture = sys.argv[1], sys.argv[2]
frames = int(sys.argv[3]) if len(sys.argv) > 3 else 40
HTTP = int(os.environ.get("HTTP_PORT", "8765"))
CHROME = os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
cert = ROOT / "server/dev-cert/cert.pem"
pin = hashlib.sha256(subprocess.check_output(["openssl", "x509", "-in", str(cert), "-outform", "DER"])).hexdigest()
srv = subprocess.Popen([bin_, "--port", str(port), "--study", fixture, "--bind", "127.0.0.1", "--stream-mode", "shared",
                        "--cert-pem", str(cert), "--key-pem", str(ROOT / "server/dev-cert/key.pem")], cwd=ROOT,
                       env=dict(os.environ, NO_COLOR="1", RUST_LOG="exact_server=error"), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
for line in srv.stdout:
    if line.startswith("telemetry="): break
PROBE = """async ([url, pin, frames, mode]) => {
  const hash = Uint8Array.from(pin.match(/../g).map(h => parseInt(h, 16)));
  const t = new WebTransport(url, { serverCertificateHashes: [{ algorithm: "sha-256", value: hash }] });
  await t.ready;
  const w = (await t.createBidirectionalStream()).writable.getWriter();
  const enc = new TextEncoder();
  const body = enc.encode(JSON.stringify({ op: "stream_frames", from: 0, to: frames - 1 }));
  const m = new Uint8Array(4 + body.length); new DataView(m.buffer).setUint32(0, body.length, true); m.set(body, 4);
  await w.write(m);
  const stream = (await t.incomingUnidirectionalStreams.getReader().read()).value;
  const sizes = [];
  const t0 = performance.now();
  if (mode === "default") {
    const r = stream.getReader();
    let got = 0, need = null, header = [];
    // count reads until every frame's bytes are in: total = frames * (8 + frameBytes), read from the first header
    while (true) {
      const { value, done } = await r.read();
      if (done) break;
      sizes.push(value.byteLength);
      got += value.byteLength;
      if (need === null) {
        header.push(...value.subarray(0, 4));
        if (header.length >= 4) need = frames * (4 + new DataView(Uint8Array.from(header).buffer).getUint32(0, false));
      }
      if (need !== null && got >= need) break;
    }
  } else {
    const r = stream.getReader({ mode: "byob" });
    for (let i = 0; i < frames; i++) {
      let h = await r.read(new Uint8Array(8), { min: 8 });
      sizes.push(h.value.byteLength);
      const len = new DataView(h.value.buffer, h.value.byteOffset, 8).getUint32(0, false) - 4;
      let buf = new ArrayBuffer(len), filled = 0;
      while (filled < len) {
        const { value, done } = await r.read(new Uint8Array(buf, filled, len - filled), { min: len - filled });
        if (done) throw new Error("ended");
        sizes.push(value.byteLength); buf = value.buffer; filled += value.byteLength;
      }
    }
  }
  const ms = performance.now() - t0;
  t.close();
  const sorted = [...sizes].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { mode, frames, reads: sizes.length, reads_per_frame: +(sizes.length / frames).toFixed(2), ms: +ms.toFixed(1),
           bytes_per_read: { min: sorted[0], p50: q(0.5), p90: q(0.9), max: sorted[sorted.length - 1] } };
}"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True, args=["--enable-features=WebTransport", "--no-sandbox"])
        for mode in ("default", "byob-min", "default", "byob-min"):
            page = b.new_page()
            page.goto(f"http://127.0.0.1:{HTTP}/harness/ts.html", wait_until="domcontentloaded")
            print(json.dumps(page.evaluate(PROBE, [f"https://127.0.0.1:{port}/", pin, frames, mode])))
            page.close()
        b.close()
finally:
    srv.send_signal(signal.SIGTERM); srv.wait(timeout=3)
