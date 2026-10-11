#!/usr/bin/env python3
"""IRTTMEASURE: the server's initial RTT, unset (333 ms) against `--initial-rtt-ms 100`, one binary and one
certificate per pair, on the dev certificate and on an ECDSA chain. Protocol and rule:
docs/transport/transport-conclusions.md §3 *Proposed row: IRTTMEASURE*.

    lab/irtt/run.py --phase abc|b [--rounds N] [--first-round K] --out rows.jsonl
    lab/irtt/run.py --summary --out rows.jsonl [--out more.jsonl]
    lab/irtt/run.py --tap LISTEN UPSTREAM          (internal: the server-side tap)

A visit is its own relay (`link_impair.py --self-timing`) and tap in front of a long-lived server per (arm, certificate),
and one dial: `cold_open`, headless Chromium (one browser, a fresh context a dial) or headless Firefox (a fresh profile a
dial). The tap sits between relay and server, so it sees the server's datagrams as sent; "before the first ACK" is
before the first client datagram that reaches it half a path RTT or more after the server's first.
(cell, certificate) is a block; its (client, arm) units run in a Williams order every round (lab/scripts/order.py).
Env: SERVER, COLD_OPEN, WINDOW_HARNESS, PACK_SERIES (target/release), FIREFOX_PATH, TRACES (Verizon-LTE-short.down).
"""
import argparse
import collections
import hashlib
import http.server
import json
import os
import random
import re
import select
import signal
import socket
import statistics
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SCRIPTS = os.path.join(ROOT, "lab/scripts")
sys.path.insert(0, SCRIPTS)
from order import order  # noqa: E402

ARMS = {"irtt333": [], "irtt100": ["--initial-rtt-ms", "100"]}
SWALLOW_MS = 50
LTE_LOADED_ONE_WAY_MS = 30


def tap(listen, upstream):
    """Relays both ways and prints each connection's datagrams (seconds since its first, direction, bytes) on TERM."""
    front = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    front.bind(("127.0.0.1", listen))
    conns, by_sock = {}, {}

    def dump(*_):
        print(json.dumps([c["log"] for c in conns.values()]), flush=True)
        os._exit(0)

    signal.signal(signal.SIGTERM, dump)
    print("READY", flush=True)
    while True:
        ready, _, _ = select.select([front] + list(by_sock), [], [])
        now = time.monotonic()
        for s in ready:
            if s is front:
                data, addr = front.recvfrom(65535)
                c = conns.get(addr)
                if c is None:
                    up = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    up.connect(("127.0.0.1", upstream))
                    c = conns[addr] = {"up": up, "t0": now, "log": []}
                    by_sock[up] = addr
                c["log"].append((round(now - c["t0"], 6), "c", len(data)))
                c["up"].send(data)
            else:
                addr = by_sock[s]
                data = s.recv(65535)
                c = conns[addr]
                c["log"].append((round(now - c["t0"], 6), "s", len(data)))
                front.sendto(data, addr)


def pre_ack(log, path_rtt_s):
    """The server's datagrams and bytes before the first ACK, and how many rounds they came in (a gap > 20 ms)."""
    first_s = next((t for t, d, _ in log if d == "s"), None)
    if first_s is None:
        return None
    ack = next((t for t, d, _ in log if d == "c" and t >= first_s + path_rtt_s / 2), float("inf"))
    sent = [(t, n) for t, d, n in log if d == "s" and t < ack]
    rounds = 1 + sum(1 for a, b in zip(sent, sent[1:]) if b[0] - a[0] > 0.020)
    return {"dgrams": len(sent), "bytes": sum(n for _, n in sent), "rounds": rounds}


# cell -> one-way delay ms, relay args, neighbour, swallow
def cell_spec(cell, traces):
    kind, _, rtt = cell.partition("-")
    if kind == "lte":
        trace = os.path.join(traces, "Verizon-LTE-short.down")
        r = 100 / 3.5
        m = 0.1 / 100
        return LTE_LOADED_ONE_WAY_MS, ["--trace", trace, "--loss-model", "ge", "--ge-p", "%.5f" % (m * r / (1 - m)),
                                       "--ge-r", "%.4f" % r, "--queue-ms", "1000", "--rate-up-kbit", "0"], True, False
    one_way = int(rtt) / 2
    args = {"swallow": [], "clean": [], "loss": ["--loss", "1"], "slow": []}[kind]
    return one_way, args, False, kind == "swallow"


PHASE_CELLS = {
    "a": [f"swallow-{r}" for r in (40, 80, 150)] + [f"clean-{r}" for r in (40, 80, 150)],
    "c": [f"slow-{r}" for r in (300, 400, 600, 1000)] + ["lte-loaded"],
    "b": ["loss-80"],
}


def clients_of(cell):
    return ["native", "chromium", "firefox"] if cell.startswith("swallow") else ["native", "chromium"]


CHROME_DRIVER = r"""
const { chromium } = require("playwright");
const rl = require("readline").createInterface({ input: process.stdin });
(async () => {
  const browser = await chromium.launch({ headless: true });
  console.log("READY " + browser.version());
  for await (const url of rl) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const posted = page.waitForRequest((r) => r.method() === "POST", { timeout: 60000 }).catch(() => null);
    await page.goto(url);
    await posted;
    await page.waitForTimeout(50);
    await ctx.close();
    console.log("DONE");
  }
  await browser.close();
})();
"""


class Rig:
    def __init__(self, args):
        self.a = args
        self.T = tempfile.mkdtemp(prefix="irtt-")
        self.procs = []
        self.bins = {k: os.environ.get(k.upper(), os.path.join(ROOT, "target/release", b)) for k, b in
                     (("server", "series-server"), ("cold_open", "cold_open"), ("window_harness", "window-harness"),
                      ("pack_series", "pack-series"))}
        self.make_certs()
        self.make_series()
        self.page = self.start_page()
        self.servers = {}
        for cert in self.certs:
            for arm, extra in ARMS.items():
                self.servers[(cert, arm)] = self.start_server(f"{cert}.{arm}", self.certs[cert], extra)
        self.neighbour = self.start_server("neighbour", self.certs["dev"], [], series=f"{self.T}/big.sbnd")
        self.chrome = None
        self.settings = self.describe()
        self.chromium()

    def sh(self, *cmd, **kw):
        return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw).stdout

    def make_certs(self):
        T = self.T
        self.sh("openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout",
                f"{T}/dev.key", "-out", f"{T}/dev.crt", "-days", "2", "-nodes", "-subj", "/CN=localhost",
                "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "keyUsage=critical,digitalSignature",
                "-addext", "extendedKeyUsage=serverAuth", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1")
        # The ECDSA chain as lab/scripts/cert_chain_cells.sh makes its `ec` variant: WebPKI-shaped leaf + intermediate.
        sct = os.urandom(244).hex()
        open(f"{T}/int.cnf", "w").write(
            "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,digitalSignature,keyCertSign,cRLSign\n"
            "extendedKeyUsage=serverAuth,clientAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n"
            "authorityInfoAccess=OCSP;URI:http://ocsp.test-roots.example.com,caIssuers;URI:http://crt.test-roots.example.com/WTPACSTestRoot.crt\n"
            "crlDistributionPoints=URI:http://crl.test-roots.example.com/WTPACSTestRoot.crl\n"
            "certificatePolicies=2.23.140.1.2.1,@polsect\n[polsect]\npolicyIdentifier=1.3.6.1.4.1.99999.1.2.3\n"
            "CPS.1=http://cps.test-roots.example.com/repository/cps-v1.4.3.html\n")
        open(f"{T}/leaf.cnf", "w").write(
            "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth,clientAuth\n"
            "subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n"
            "subjectAltName=DNS:pacs.example.com,DNS:www.pacs.example.com,IP:127.0.0.1,DNS:localhost\n"
            "authorityInfoAccess=OCSP;URI:http://ocsp.test-roots.example.com,caIssuers;URI:http://crt.test-roots.example.com/WTPACSTestE1.crt\n"
            "crlDistributionPoints=URI:http://crl.test-roots.example.com/WTPACSTestE1-4.crl\n"
            f"certificatePolicies=2.23.140.1.2.1,@polsect\n1.3.6.1.4.1.11129.2.4.2=DER:0481F4{sct}\n[polsect]\n"
            "policyIdentifier=1.3.6.1.4.1.99999.1.2.3\nCPS.1=http://cps.test-roots.example.com/repository/cps-v1.4.3.html\n")
        for k in ("root", "int", "leaf"):
            self.sh("openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", f"{T}/{k}.key")
        self.sh("openssl", "req", "-x509", "-new", "-key", f"{T}/root.key", "-sha256", "-days", "3", "-out", f"{T}/root.crt",
                "-subj", "/C=US/O=WT-PACS Test Roots/CN=WT-PACS Test ec Root",
                "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign")
        for k, issuer, subj, serial in (("int", "root", "/C=US/O=WT-PACS Test Roots/CN=WT-PACS Test ec Intermediate", "0x4a1f3c92b77e51d0"),
                                        ("leaf", "int", "/C=US/ST=California/L=San Francisco/O=WT-PACS Example Health Network/CN=pacs.example.com",
                                         "0x0d7f2b4e91c5a06833ee12")):
            self.sh("openssl", "req", "-new", "-key", f"{T}/{k}.key", "-out", f"{T}/{k}.csr", "-subj", subj)
            self.sh("openssl", "x509", "-req", "-in", f"{T}/{k}.csr", "-CA", f"{T}/{issuer}.crt", "-CAkey", f"{T}/{issuer}.key",
                    "-set_serial", serial, "-days", "3", "-sha256", "-extfile", f"{T}/{k}.cnf", "-out", f"{T}/{k}.crt")
        open(f"{T}/chain.crt", "w").write(open(f"{T}/leaf.crt").read() + open(f"{T}/int.crt").read())
        self.sh("openssl", "verify", "-CAfile", f"{T}/root.crt", "-untrusted", f"{T}/int.crt", f"{T}/leaf.crt")
        self.certs = {"dev": (f"{T}/dev.crt", f"{T}/dev.key"), "chain": (f"{T}/chain.crt", f"{T}/leaf.key")}
        self.hash = {}
        for name, (crt, _) in self.certs.items():
            der = subprocess.run(["openssl", "x509", "-in", crt, "-outform", "DER"], check=True, capture_output=True).stdout
            self.hash[name] = hashlib.sha256(der).hexdigest()

    def make_series(self):
        for name, frames, size in (("small", 1, 1024), ("big", 100, 256000)):
            d = f"{self.T}/{name}"
            os.makedirs(d)
            for i in range(frames):
                open(f"{d}/{i:03d}.htj2k", "wb").write(os.urandom(size) if size > 1024 else bytes(size))
            open(f"{self.T}/{name}.json", "w").write(json.dumps({"frameCount": frames}))
            self.sh(self.bins["pack_series"], "--metadata", f"{self.T}/{name}.json", "--frames", d, "--output", f"{self.T}/{name}.sbnd")

    def start_page(self):
        rig = self

        class Page(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **k):
                super().__init__(*a, directory=HERE, **k)

            def do_POST(self):
                rig.result.update(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                rig.got.set()
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

            def log_message(self, *a):
                pass

        self.result, self.got = {}, threading.Event()
        page = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
        threading.Thread(target=page.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{page.server_address[1]}"

    def free_port(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.bind(("127.0.0.1", 0))
        p = s.getsockname()[1]
        s.close()
        return p

    def start_server(self, name, cert, extra, series=None):
        port = self.free_port()
        log = open(f"{self.T}/{name}.log", "w+")
        p = subprocess.Popen(["taskset", "-c", self.a.client_cores, self.bins["server"], "--port", str(port), "--bind", "127.0.0.1",
                              "--series", series or f"{self.T}/small.sbnd", "--cert-pem", cert[0], "--key-pem", cert[1], *extra],
                             env={**os.environ, "RUST_LOG": "series_server=info", "NO_COLOR": "1"}, stdout=log, stderr=subprocess.STDOUT)
        self.procs.append(p)
        for _ in range(100):
            if "wt_url=" in open(log.name).read():
                break
            time.sleep(0.1)
        text = open(log.name).read()
        transport = re.search(r"^transport=(.*)$", text, re.M)
        return {"port": port, "log": log.name, "transport": transport.group(1) if transport else "", "name": name}

    def describe(self):
        lock = open(os.path.join(ROOT, "Cargo.lock")).read()
        ver = lambda c: re.search(r'name = "%s"\nversion = "([^"]+)"' % c, lock).group(1)
        sha = lambda f: hashlib.sha256(open(f, "rb").read()).hexdigest()[:16]
        ff = subprocess.run([os.environ["FIREFOX_PATH"], "--version"], capture_output=True, text=True).stdout.strip() \
            if os.environ.get("FIREFOX_PATH") else "absent"
        return {"servers": {f"{c}.{a}": s["transport"] for (c, a), s in self.servers.items()},
                "server_sha256": sha(self.bins["server"]), "cold_open_sha256": sha(self.bins["cold_open"]),
                "quinn": ver("quinn"), "quinn-proto": ver("quinn-proto"), "wtransport": ver("wtransport"),
                "firefox": ff, "relay": "link_impair.py --self-timing, chrt -f 50 on core %s" % self.a.rig_core,
                "swallow_ms": SWALLOW_MS, "cert_hash": self.hash,
                "chain_bytes": len(subprocess.run(["sh", "-c", f"for c in {self.T}/leaf.crt {self.T}/int.crt; do openssl x509 -in $c -outform DER; done"],
                                                  capture_output=True).stdout)}

    def chromium(self):
        if self.chrome is None:
            f = f"{self.T}/driver.cjs"
            open(f, "w").write(CHROME_DRIVER)
            npm = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
            self.chrome = subprocess.Popen(["taskset", "-c", self.a.client_cores, "node", f], stdin=subprocess.PIPE,
                                           stdout=subprocess.PIPE, text=True, env={**os.environ, "NODE_PATH": npm})
            self.settings["chromium"] = self.chrome.stdout.readline().split()[1]
        return self.chrome

    def dial(self, client, port, cert, cap_ms):
        url = f"https://127.0.0.1:{port}/"
        if client == "native":
            try:
                out = subprocess.run(["taskset", "-c", self.a.client_cores, self.bins["cold_open"], "--url", url, "--rounds", "1"],
                                     capture_output=True, text=True, timeout=cap_ms / 1000 + 10).stdout
            except subprocess.TimeoutExpired:
                return None, "timeout"
            m = re.search(r"session=([0-9.]+)ms", out)
            return (float(m.group(1)), None) if m else (None, out.strip()[-200:] or "no output")
        self.result.clear()
        self.got.clear()
        page = f"{self.page}/index.html?wt={url}&hash={self.hash[cert]}&cap={cap_ms}&post={self.page}/r"
        if client == "chromium":
            c = self.chromium()
            c.stdin.write(page + "\n")
            c.stdin.flush()
            self.got.wait(cap_ms / 1000 + 30)
            c.stdout.readline()
        else:
            profile = tempfile.mkdtemp(dir=self.T)
            ff = subprocess.Popen(["taskset", "-c", self.a.client_cores, os.environ["FIREFOX_PATH"], "--headless", "--no-remote",
                                   "--profile", profile, page], env={**os.environ, "MOZ_CRASHREPORTER_DISABLE": "1"},
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            self.got.wait(cap_ms / 1000 + 30)
            time.sleep(0.05)
            os.killpg(ff.pid, signal.SIGKILL)
            ff.wait()
            subprocess.run(["rm", "-rf", profile])
        r = dict(self.result)
        return (r["ms"], None) if r.get("ok") else (None, r.get("error", "no result"))

    def visit(self, rnd, cell, cert, client, arm):
        one_way, relay_args, neighbour, swallow = cell_spec(cell, self.a.traces)
        path_rtt = 2 * one_way / 1000
        srv = self.servers[(cert, arm)]
        tap_port, front, ctrl = self.free_port(), self.free_port(), self.free_port()
        tapper = subprocess.Popen([sys.executable, __file__, "--tap", str(tap_port), str(srv["port"])], stdout=subprocess.PIPE, text=True)
        tapper.stdout.readline()
        udp = ["--udp", f"{front}:{tap_port}"]
        nfront = None
        if neighbour:
            nfront = self.free_port()
            udp += ["--udp", f"{nfront}:{self.neighbour['port']}"]
        relay = subprocess.Popen(["chrt", "-f", "50", "taskset", "-c", self.a.rig_core, sys.executable, os.path.join(SCRIPTS, "link_impair.py"),
                                  *udp, "--delay-ms", str(one_way), *relay_args, "--seed", str(rnd), "--control-port", str(ctrl),
                                  "--self-timing"], stdout=subprocess.PIPE, text=True)
        relay.stdout.readline()
        sat = None
        if neighbour:
            sat = subprocess.Popen(["taskset", "-c", self.a.client_cores, self.bins["window_harness"], "--url", f"https://127.0.0.1:{nfront}/",
                                    "--mode", "saturate", "--fill-dwell-ms", "8000", "--frame-count", "100", "--depth", "8",
                                    "--read-bps", "0", "--stream-mode", "shared", "--timeout-ms", "60000", "--json"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(3)
        if swallow:
            socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b"swallow %d" % SWALLOW_MS, ("127.0.0.1", ctrl))
            time.sleep(0.05)
        before = len(open(srv["log"]).read())
        ready, error = self.dial(client, front, cert, self.a.cap_ms)
        path = None
        for _ in range(int(20 + 40 * path_rtt)):
            m = re.search(r"session path (.*)", open(srv["log"]).read()[before:])
            if m:
                path = {k: int(v) for k, v in re.findall(r"(\w+)=(\d+)", m.group(1))}
                break
            time.sleep(0.1)
        if sat:
            sat.kill()
            sat.wait()
        relay.send_signal(signal.SIGTERM)
        tally = relay.communicate(timeout=10)[0]
        tapper.send_signal(signal.SIGTERM)
        logs = json.loads(tapper.communicate(timeout=10)[0].strip().splitlines()[-1])
        mine = logs[0] if logs else []
        return {"round": rnd, "cell": cell, "cert": cert, "client": client, "arm": arm, "ready_ms": ready, "error": error,
                "path": path, "pre_ack": pre_ack(mine, path_rtt), "tap_s2c": sum(d == "s" for _, d, _ in mine), "void": "VOID" in tally,
                "late": (re.search(r"self-timing .*", tally) or [""])[0], "conns": len(logs)}

    def close(self):
        if self.chrome:
            self.chrome.kill()
        for p in self.procs:
            p.kill()
        subprocess.run(["rm", "-rf", self.T])


def run(args):
    rig = Rig(args)
    try:
        with open(args.out[0], "a") as out:
            out.write(json.dumps({"settings": rig.settings, "phase": args.phase, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}) + "\n")
            print(json.dumps(rig.settings), flush=True)
            cells = [c for p in args.phase for c in PHASE_CELLS[p]]
            for rnd in range(args.first_round, args.first_round + args.rounds):
                for cell in cells:
                    for cert in args.certs.split(","):
                        units = [(c, a) for c in clients_of(cell) for a in ARMS]
                        prev = None
                        for client, arm in order(units, rnd):
                            row = rig.visit(rnd, cell, cert, client, arm)
                            row["prev"] = prev
                            prev = f"{client}.{arm}"
                            out.write(json.dumps(row) + "\n")
                            out.flush()
                            if not args.quiet:
                                print(json.dumps(row), flush=True)
                print(f"round {rnd} done {time.strftime('%H:%M:%S', time.gmtime())}", flush=True)
    finally:
        rig.close()


def q(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(p * len(v)))] if v else float("nan")


def boot(v, stat, n=2000, seed=1):
    rng = random.Random(seed)
    s = sorted(stat([rng.choice(v) for _ in v]) for _ in range(n))
    return s[int(0.025 * n)], s[int(0.975 * n)]


def summary(args):
    rows = [json.loads(l) for f in args.out for l in open(f)]
    for r in rows:
        if "settings" in r:
            print("settings:", json.dumps(r["settings"]))
    rows = [r for r in rows if "cell" in r]
    by = collections.defaultdict(dict)
    for r in rows:
        by[(r["cell"], r["cert"], r["client"], r["round"])][r["arm"]] = r
    print("visits %d, VOID %d, failed %d" % (len(rows), sum(r["void"] for r in rows), sum(r["ready_ms"] is None for r in rows)))
    cells = sorted({(r["cell"], r["cert"], r["client"]) for r in rows})
    clean80 = {cert: statistics.median([r["path"]["datagrams_tx"] for r in rows if r["cell"] == "clean-80" and r["cert"] == cert
                                        and r["arm"] == "irtt333" and r["path"]] or [0]) for cert in ("dev", "chain")}
    for reading in ("strict", "round-paired"):
        print(f"\n== {reading}: per cell, 333 then 100, ready median, lead (333 − 100) median of pairs, n pairs")
        for cell, cert, client in cells:
            pairs = [p for (c, k, cl, _), p in by.items() if (c, k, cl) == (cell, cert, client) and len(p) == 2
                     and all(x["ready_ms"] is not None for x in p.values())
                     and (reading == "round-paired" or not any(x["void"] for x in p.values()))]
            if not pairs:
                print(f"{cell:11} {cert:5} {client:8} no pairs")
                continue
            a = [p["irtt333"]["ready_ms"] for p in pairs]
            b = [p["irtt100"]["ready_ms"] for p in pairs]
            lead = [x - y for x, y in zip(a, b)]
            pa = lambda arm, k: [p[arm]["pre_ack"][k] for p in pairs if p[arm]["pre_ack"]]
            pt = lambda arm, k: [p[arm]["path"][k] for p in pairs if p[arm]["path"]]
            line = (f"{cell:11} {cert:5} {client:8} n={len(pairs):4} ready {statistics.median(a):7.1f} {statistics.median(b):7.1f}"
                    f"  lead {statistics.median(lead):+7.1f} [{min(lead):+.0f},{max(lead):+.0f}]")
            line += "  pre-ACK dgrams %s/%s bytes %s/%s rounds max %s/%s" % (
                statistics.median(pa("irtt333", "dgrams")), statistics.median(pa("irtt100", "dgrams")),
                statistics.median(pa("irtt333", "bytes")), statistics.median(pa("irtt100", "bytes")),
                max(pa("irtt333", "rounds")), max(pa("irtt100", "rounds")))
            if cell.startswith(("slow", "lte", "clean")):
                line += "  cong %d/%d cwnd %s/%s rtt_us %s/%s" % (
                    sum(pt("irtt333", "congestion_events")), sum(pt("irtt100", "congestion_events")),
                    statistics.median(pt("irtt333", "cwnd")), statistics.median(pt("irtt100", "cwnd")),
                    statistics.median(pt("irtt333", "rtt_us")), statistics.median(pt("irtt100", "rtt_us")))
            print(line)
            if cell.startswith("loss"):
                for arm, v in (("irtt333", a), ("irtt100", b)):
                    ps = [p[arm] for p in pairs]
                    probed = [x for x in ps if x["pre_ack"] and x["pre_ack"]["rounds"] > 1]
                    over = [x for x in ps if x["path"] and x["path"]["datagrams_tx"] > clean80[cert]]
                    print("    %s: p50 %.1f %s p95 %.1f %s p99 %.1f %s | probe before first ACK %d/%d (%.2f %%), their ready median %s"
                          " | datagrams_tx over clean-80's %s: %d (%.1f %%)" % (
                              arm, q(v, .5), boot(v, lambda s: q(s, .5)), q(v, .95), boot(v, lambda s: q(s, .95)),
                              q(v, .99), boot(v, lambda s: q(s, .99)), len(probed), len(ps), 100 * len(probed) / len(ps),
                              statistics.median([x["ready_ms"] for x in probed]) if probed else "-", clean80[cert],
                              len(over), 100 * len(over) / len(ps)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tap", nargs=2, type=int)
    ap.add_argument("--phase", default="ac")
    ap.add_argument("--rounds", type=int, default=20)
    ap.add_argument("--first-round", type=int, default=0)
    ap.add_argument("--certs", default="dev,chain")
    ap.add_argument("--out", action="append")
    ap.add_argument("--summary", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--cap-ms", type=int, default=15000)
    ap.add_argument("--traces", default=os.environ.get("TRACES", os.path.join(ROOT, "lab/.traces")))
    ap.add_argument("--rig-core", default="3")
    ap.add_argument("--client-cores", default="0-2")
    args = ap.parse_args()
    if args.tap:
        tap(*args.tap)
    elif args.summary:
        summary(args)
    else:
        run(args)


if __name__ == "__main__":
    main()
