#!/usr/bin/env python3
"""One fault for one frame, per decoder path and engine, and what the check, the second decode and the page do:
a sample flipped on the first decode (`sample`) or on every decode (`sample-always`), the decoder given half the
frame's coded bytes (`truncate`), and a decode that never returns (`hang`); `none` is the control. The fault lives in
lab/faultbench/decode/, which wraps the product's codec modules and runs the product's decoder.js unchanged.
lab/faultbench/README.md

    lab/faultbench/run.py --firefox FIREFOX [--chrome CHROME] [--rounds 1] --out rows.jsonl
    lab/faultbench/run.py --summary rows.jsonl
"""
import argparse
import http.server
import json
import os
import shutil
import signal
import socket
import subprocess
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WORK = os.path.join(ROOT, "lab/.av1-work/faultbench")
FAULTS = ["none", "sample", "sample-always", "truncate", "hang"]
PATHS = {"htj2k": ("htj2k", "on"), "dav1d": ("av1", "off"), "webcodecs": ("av1", "on")}
AT = 2
HTJ2K = ["client/contract/frames/grey-16"] * 6
AV1 = [f"client/contract/av1/payloads/optimized/{n}" for n in ("g8", "g10", "s11", "s13", "c8", "g9")]


def free_udp():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def series(name, bases, codec, ext):
    d = os.path.join(WORK, name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    digests = []
    for i, base in enumerate(bases):
        os.symlink(os.path.join(ROOT, f"{base}.{'j2c' if ext == 'htj2k' else 'av1'}"), os.path.join(d, f"{i:03}.{ext}"))
        digests.append(open(os.path.join(ROOT, f"{base}.xxh3")).read().strip())
    meta = {"frameCount": len(bases), "seriesLabel": name, "digests": {"algorithm": "xxh3-64", "frames": digests}}
    if codec == "av1":
        meta["codec"] = "av1"
    with open(os.path.join(d, "metadata.json"), "w") as f:
        json.dump(meta, f)
    subprocess.run([os.path.join(ROOT, "target/release/pack-series"), "--metadata", f"{d}/metadata.json", "--frames", d,
                    "--output", f"{d}/series.sbnd"], check=True, capture_output=True)
    return d


def start_server(d, tmp):
    port = free_udp()
    srv = subprocess.Popen([os.path.join(ROOT, "target/release/series-server"), "--port", str(port), "--bind", "127.0.0.1",
                            "--series", f"{d}/series.sbnd", "--cert-pem", f"{tmp}/cert.pem", "--key-pem", f"{tmp}/key.pem"],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    banner = ""
    for line in srv.stdout:
        banner += line
        if line.startswith("transport="):
            break
    threading.Thread(target=lambda: [None for _ in srv.stdout], daemon=True).start()
    cert = banner.split("cert_sha256=")[1].split()[0]
    return srv, f"https://127.0.0.1:{port}/", cert


class Collector:
    def __init__(self):
        self.result, self.got = {}, threading.Event()
        me = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                me.result = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                me.got.set()
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

            def log_message(self, *a):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/"


def launch(engine, binary, url, profile):
    if engine == "firefox":
        with open(os.path.join(profile, "user.js"), "w") as f:
            f.write('user_pref("browser.shell.checkDefaultBrowser", false);\n')
        cmd = [binary, "--headless", "--no-remote", "--profile", profile, url]
    else:
        cmd = [binary, "--headless=new", "--no-sandbox", "--no-first-run", f"--user-data-dir={profile}", url]
    return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
                            env={**os.environ, "MOZ_CRASHREPORTER_DISABLE": "1"})


def run(args):
    tmp = tempfile.mkdtemp(prefix="faultbench-")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                    "-keyout", f"{tmp}/key.pem", "-out", f"{tmp}/cert.pem", "-days", "2", "-nodes",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
                   check=True, capture_output=True)
    dirs = {"htj2k": series("htj2k", HTJ2K, "htj2k", "htj2k"), "av1": series("av1", AV1, "av1", "av1")}
    servers = {k: start_server(d, tmp) for k, d in dirs.items()}
    static_log = open(f"{tmp}/static.log", "w+")
    static = subprocess.Popen(["python3", os.path.join(ROOT, "server/dev-server.py"), "--port", "0"], cwd=ROOT,
                              stdout=static_log, stderr=subprocess.STDOUT)
    while "port=" not in open(f"{tmp}/static.log").read():
        threading.Event().wait(0.1)
    port = open(f"{tmp}/static.log").read().split("port=")[1].split()[0]
    collector = Collector()
    engines = [("chromium", args.chrome)] + ([("firefox", args.firefox)] if args.firefox else [])
    try:
        for rnd in range(args.rounds):
            for engine, binary in engines:
                for path, (codec, webcodecs) in PATHS.items():
                    for fault in FAULTS:
                        _, wt, cert = servers[codec]
                        collector.result, _ = {}, collector.got.clear()
                        profile = tempfile.mkdtemp(dir=tmp)
                        url = (f"http://127.0.0.1:{port}/lab/faultbench/index.html?dir=/{os.path.relpath(dirs[codec], ROOT)}"
                               f"&fault={fault}&at={AT}&webcodecs={webcodecs}&wt={wt}&hash={cert}&post={collector.url}")
                        browser = launch(engine, binary, url, profile)
                        collector.got.wait(90)
                        os.killpg(browser.pid, signal.SIGKILL)
                        browser.wait()
                        row = {"round": rnd, "engine": engine, "path": path, "fault": fault, **collector.result}
                        if not collector.result:
                            row["error"] = "no result in 90 s"
                        with open(args.out, "a") as f:
                            f.write(json.dumps(row) + "\n")
                        print(line(row), flush=True)
    finally:
        static.kill()
        for srv, _, _ in servers.values():
            srv.kill()
        shutil.rmtree(tmp, ignore_errors=True)


def line(row):
    if not row.get("ok"):
        return f"{row['engine']} {row['path']} {row['fault']}: ERROR {row.get('error')}"
    frames, failed, missing = row["frames"], row["failed"], row["missing"]
    at = frames.get(str(AT))
    if at:
        what = f"delivered exact={at['exact']} path={at['path']}"
        what += f" rescued from {at['mismatchOn']}" if at["mismatchOn"] else ""
        if at["reason"]:
            what += f" ({at['reason'][:90]})"
    elif str(AT) in failed:
        what = f"failed by name: {failed[str(AT)][:90]}"
    else:
        what = "never arrived, no failure"
    others = [i for i in range(len(frames) + len(failed) + len(missing)) if i != AT]
    exact = sum(1 for i in others if frames.get(str(i), {}).get("exact") is True)
    return (f"{row['engine']} {row['path']} {row['fault']}: frame {AT} {what}; others {exact}/{len(others)} exact,"
            f" missing {[m for m in missing if m != AT]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chrome", default=os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"))
    ap.add_argument("--firefox")
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--out", default="rows.jsonl")
    ap.add_argument("--summary")
    args = ap.parse_args()
    if args.summary:
        for r in map(json.loads, open(args.summary)):
            print(line(r))
        return
    run(args)


if __name__ == "__main__":
    main()
