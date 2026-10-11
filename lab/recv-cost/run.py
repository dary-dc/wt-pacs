#!/usr/bin/env python3
"""Receive CPU per MB of a whole-series fill, per client stack: headless Chromium against the native stacks of
lab/recv-cost (wtransport, web-transport-quinn, each with UDP GRO on and off). Arms run in a Williams order
inside each (cell, round); every frame is checked by SHA-256 against the digest written when the series was
made. lab/recv-cost/README.md

    lab/recv-cost/run.py make DIR                 two series, 800 x 250 KB and 800 x 32 KB, packed, with digests
    lab/recv-cost/run.py run DIR --rounds 7 [--cells ...] [--arms ...] --out rows.jsonl
    lab/recv-cost/run.py summary rows.jsonl
"""
import argparse
import hashlib
import http.server
import json
import os
import signal
import socket
import statistics
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "lab/scripts"))
from order import order  # noqa: E402

CHROME = os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
SERVER = os.path.join(ROOT, "target/release/series-server")
PACK = os.path.join(ROOT, "target/release/pack-series")
NATIVE = os.path.join(HERE, "target/release/recv-cost")
SERIES = {"f250k": (800, 250_000), "f32k": (800, 32_000)}
CELLS = {  # name: (series, relay arguments or None for loopback)
    "loop-250k": ("f250k", None),
    "loop-32k": ("f32k", None),
    "r20-clean": ("f32k", ["--rate-kbit", "20000"]),
    "r50-clean": ("f32k", ["--rate-kbit", "50000"]),
    "r20-loss2": ("f32k", ["--rate-kbit", "20000", "--loss", "2"]),
    "r50-loss2": ("f32k", ["--rate-kbit", "50000", "--loss", "2"]),
}
RELAY_COMMON = ["--delay-ms", "20", "--queue-pkts", "200"]
ARMS = ["chromium", "wtransport", "wtransport-nogro", "wtq", "wtq-nogro"]
SERVER_CORE, CLIENT_CORES, RELAY_CORE = "0", "1-2", "3"

PAGE = """<!doctype html><meta charset="utf-8"><script type="module">
const q = new URLSearchParams(location.search);
const post = (path, r) => fetch(path, { method: "POST", body: JSON.stringify(r) });
const hash = Uint8Array.from(q.get("hash").match(/../g), (h) => parseInt(h, 16));
const count = Number(q.get("count"));
try {
  const wt = new WebTransport(q.get("wt"), { serverCertificateHashes: [{ algorithm: "sha-256", value: hash }] });
  await wt.ready;
  const control = await wt.createBidirectionalStream();
  const ask = new TextEncoder().encode(JSON.stringify({ op: "stream_frames" }));
  const message = new Uint8Array(4 + ask.length);
  new DataView(message.buffer).setUint32(0, ask.length, true);
  message.set(ask, 4);
  const writer = control.writable.getWriter();
  await post("/start", {});
  const t0 = performance.now();
  await writer.write(message);
  const { value: media } = await wt.incomingUnidirectionalStreams.getReader().read();
  const reader = media.getReader();
  const frames = new Array(count);
  let got = 0, head = new Uint8Array(8), headFill = 0, body = null, bodyFill = 0, index = -1;
  while (got < count) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended after ${got} frames`);
    let at = 0;
    while (at < value.length) {
      if (body === null) {
        const n = Math.min(8 - headFill, value.length - at);
        head.set(value.subarray(at, at + n), headFill);
        headFill += n; at += n;
        if (headFill === 8) {
          const v = new DataView(head.buffer);
          body = new Uint8Array(v.getUint32(0) - 4); index = v.getUint32(4); bodyFill = 0; headFill = 0;
        }
      } else {
        const n = Math.min(body.length - bodyFill, value.length - at);
        body.set(value.subarray(at, at + n), bodyFill);
        bodyFill += n; at += n;
        if (bodyFill === body.length) { frames[index] = body; body = null; got += 1; }
      }
    }
  }
  const fillMs = performance.now() - t0;
  await post("/end", { fill_ms: fillMs });
  const digests = [];
  for (const f of frames) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", f));
    digests.push(Array.from(d, (b) => b.toString(16).padStart(2, "0")).join(""));
  }
  wt.close();
  await post("/result", { ok: true, digests });
} catch (e) {
  await post("/result", { ok: false, error: String(e) });
}
</script>"""


def free_udp():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def make(directory):
    for name, (count, size) in SERIES.items():
        d = os.path.join(directory, name)
        os.makedirs(d, exist_ok=True)
        digests = []
        for i in range(count):
            body = os.urandom(size)
            with open(os.path.join(d, f"{i:03}.htj2k"), "wb") as f:
                f.write(body)
            digests.append(hashlib.sha256(body).hexdigest())
        with open(os.path.join(d, "digests.txt"), "w") as f:
            f.write("\n".join(digests) + "\n")
        with open(os.path.join(d, "metadata.json"), "w") as f:
            json.dump({"frameCount": count, "seriesLabel": name}, f)
        subprocess.run([PACK, "--metadata", f"{d}/metadata.json", "--frames", d, "--output", f"{d}/{name}.sbnd"],
                       check=True, capture_output=True)
        print(f"{name}: {count} x {size} B, packed")


def cpu_ns_of(pids):
    total = 0
    for pid in pids:
        try:
            tasks = os.listdir(f"/proc/{pid}/task")
        except OSError:
            continue
        for t in tasks:
            try:
                total += int(open(f"/proc/{pid}/task/{t}/schedstat").read().split()[0])
            except (OSError, ValueError, IndexError):
                pass
    return total


def chromium_processes(session):
    """pid -> kind for every process in the browser's session: browser, network, renderer, gpu, other."""
    out = {}
    for p in os.listdir("/proc"):
        if not p.isdigit():
            continue
        try:
            if os.getsid(int(p)) != session:
                continue
            line = open(f"/proc/{p}/cmdline", "rb").read().replace(b"\0", b" ")
        except OSError:
            continue
        if b"network.mojom.NetworkService" in line:
            out[int(p)] = "network"
        elif b"--type=renderer" in line:
            out[int(p)] = "renderer"
        elif b"--type=gpu-process" in line:
            out[int(p)] = "gpu"
        elif b"--type=" not in line:
            out[int(p)] = "browser"
        else:
            out[int(p)] = "other"
    return out


class Page:
    def __init__(self):
        self.events = {}
        self.got = threading.Event()
        self.session = None
        page = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = PAGE.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.path in ("/start", "/end") and page.session is not None:
                    procs = chromium_processes(page.session)
                    data["cpu"] = {kind: cpu_ns_of([p for p, k in procs.items() if k == kind])
                                   for kind in ("browser", "network", "renderer", "gpu", "other")}
                page.events[self.path] = data
                if self.path == "/result":
                    page.got.set()
                self.send_response(204)
                self.end_headers()

            def log_message(self, *a):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()


def make_cert(tmp):
    subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                    "-keyout", f"{tmp}/key.pem", "-out", f"{tmp}/cert.pem", "-days", "2", "-nodes",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
                   check=True, capture_output=True)
    der = subprocess.run(["openssl", "x509", "-in", f"{tmp}/cert.pem", "-outform", "DER"],
                         check=True, capture_output=True).stdout
    return hashlib.sha256(der).hexdigest()


def visit(arm, cell, rnd, series_dir, tmp, cert_hash, page):
    series_name, relay_args = CELLS[cell]
    d = os.path.join(series_dir, series_name)
    digests = open(os.path.join(d, "digests.txt")).read().split()
    port = free_udp()
    server = subprocess.Popen(["taskset", "-c", SERVER_CORE, SERVER, "--port", str(port), "--bind", "127.0.0.1",
                               "--series", os.path.join(d, f"{series_name}.sbnd"), "--cert-pem", f"{tmp}/cert.pem",
                               "--key-pem", f"{tmp}/key.pem"],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    banner = []
    for line in server.stdout:
        banner.append(line.strip())
        if line.startswith("transport="):
            break
    threading.Thread(target=lambda: [None for _ in server.stdout], daemon=True).start()
    relay = None
    target = port
    if relay_args is not None:
        target = free_udp()
        relay = subprocess.Popen(["chrt", "-f", "50", "taskset", "-c", RELAY_CORE, sys.executable,
                                  os.path.join(ROOT, "lab/scripts/link_impair.py"), "--udp", f"{target}:{port}",
                                  "--seed", str(rnd), *RELAY_COMMON, *relay_args],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        relay.stdout.readline()
    server_cpu0 = cpu_ns_of([server.pid])
    url = f"https://127.0.0.1:{target}/"
    row = {"round": rnd, "cell": cell, "arm": arm, "relay": relay_args and RELAY_COMMON + relay_args}
    if arm == "chromium":
        page.events.clear()
        page.got.clear()
        profile = tempfile.mkdtemp(dir=tmp)
        browser = subprocess.Popen(["taskset", "-c", CLIENT_CORES, CHROME, "--headless=new", "--no-sandbox",
                                    "--no-first-run", f"--user-data-dir={profile}",
                                    f"http://127.0.0.1:{page.httpd.server_address[1]}/?wt={url}&hash={cert_hash}"
                                    f"&count={len(digests)}"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        page.session = browser.pid
        page.got.wait(900)
        os.killpg(browser.pid, signal.SIGKILL)
        browser.wait()
        result = page.events.get("/result", {"ok": False, "error": "no result in 900 s"})
        start, end = page.events.get("/start"), page.events.get("/end")
        if result.get("ok") and start and end:
            cpu = {k: (end["cpu"][k] - start["cpu"][k]) / 1e6 for k in start["cpu"]}
            row.update(fill_ms=round(end["fill_ms"], 1), client_cpu_ms=round(sum(cpu.values()), 1),
                       cpu_by_process={k: round(v, 1) for k, v in cpu.items()}, frames=len(result["digests"]),
                       exact=sum(a == b for a, b in zip(result["digests"], digests)), gro=None)
        else:
            row["error"] = result.get("error")
    else:
        stack, _, nogro = arm.partition("-")
        cmd = ["taskset", "-c", CLIENT_CORES, NATIVE, "--url", url, "--stack", stack,
               "--digests", os.path.join(d, "digests.txt")] + (["--no-gro"] if nogro else [])
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        if out.returncode == 0:
            row.update(json.loads(out.stdout.strip().splitlines()[-1]))
        else:
            row["error"] = out.stderr.strip()[-400:]
    row["server_cpu_ms"] = round((cpu_ns_of([server.pid]) - server_cpu0) / 1e6, 1)
    for p in (relay, server):
        if p is not None:
            p.kill()
            p.wait()
    row["mb"] = round(sum(SERIES[series_name][1] for _ in digests) / 1e6, 2)
    if "client_cpu_ms" in row:
        row["client_ms_per_mb"] = round(row["client_cpu_ms"] / row["mb"], 3)
        row["client_cores"] = round(row["client_cpu_ms"] / row["fill_ms"], 3)
    return row, banner


def run(args):
    page = Page()
    tmp = tempfile.mkdtemp(prefix="recv-cost-")
    cert_hash = make_cert(tmp)
    cells, arms = args.cells.split(","), args.arms.split(",")
    printed = False
    for rnd in range(args.first_round, args.first_round + args.rounds):
        for cell in cells:
            for arm in order(arms, rnd):
                row, banner = visit(arm, cell, rnd, args.dir, tmp, cert_hash, page)
                if not printed:
                    print("server:", " ".join(banner), flush=True)
                    printed = True
                with open(args.out, "a") as f:
                    f.write(json.dumps(row) + "\n")
                print(json.dumps({k: row.get(k) for k in ("round", "cell", "arm", "fill_ms", "client_ms_per_mb",
                                                          "client_cores", "exact", "frames", "gro", "error")}),
                      flush=True)


def summary(path):
    rows = [json.loads(line) for line in open(path)]
    cells = {}
    for r in rows:
        cells.setdefault((r["cell"], r["arm"]), []).append(r)
    print("| cell | arm | n | exact | fill ms, median [min–max] | client ms per MB, median [min–max] | client cores |"
          " server ms per MB |")
    print("| --- | --- | --: | --: | --: | --: | --: | --: |")
    for cell in CELLS:
        for arm in ARMS:
            rs = cells.get((cell, arm), [])
            ok = [r for r in rs if "client_cpu_ms" in r]
            if not rs:
                continue
            exact = sum(r.get("exact", 0) for r in rs)
            frames = sum(r.get("frames", 0) for r in rs)

            def stat(key, fmt):
                v = sorted(r[key] for r in ok)
                return f"{fmt.format(statistics.median(v))} [{fmt.format(v[0])}–{fmt.format(v[-1])}]" if v else "—"

            srv = sorted(r["server_cpu_ms"] / r["mb"] for r in ok)
            print(f"| {cell} | {arm} | {len(ok)}/{len(rs)} | {exact}/{frames} | {stat('fill_ms', '{:.0f}')} |"
                  f" {stat('client_ms_per_mb', '{:.2f}')} | {stat('client_cores', '{:.2f}')} |"
                  f" {statistics.median(srv) if srv else float('nan'):.2f} |")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("make")
    m.add_argument("dir")
    r = sub.add_parser("run")
    r.add_argument("dir")
    r.add_argument("--rounds", type=int, default=7)
    r.add_argument("--first-round", type=int, default=0)
    r.add_argument("--cells", default=",".join(CELLS))
    r.add_argument("--arms", default=",".join(ARMS))
    r.add_argument("--out", default="rows.jsonl")
    s = sub.add_parser("summary")
    s.add_argument("rows")
    args = ap.parse_args()
    if args.cmd == "make":
        make(args.dir)
    elif args.cmd == "run":
        run(args)
    else:
        summary(args.rows)


if __name__ == "__main__":
    main()
