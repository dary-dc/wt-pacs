#!/usr/bin/env python3
"""Will a browser update break the server? Each browser dials the server, asks for one frame, and the
dial's QUIC is read back from a recording relay and the browser's TLS key log: the WebTransport drafts each
side offers in its SETTINGS, the draft they share, and whether either offers reset_stream_at. Exits non-zero
when a dial or its frame fails or any of that differs from scripts/wtcompat.json.
docs/transport/transport-conclusions.md §9 Draft compatibility.

    scripts/wtcompat.py --fetch DIR                      the newest Chrome for Testing and Firefox builds, each dialled
    scripts/wtcompat.py NAME=BROWSER [NAME=BROWSER ...]  dial from each; BROWSER is a chrome or firefox binary
        [--server target/release/series-server] [--expect scripts/wtcompat.json]
        [--flags NAME=ARGS]   extra command-line arguments for that browser, e.g. a Chromium feature
        [--json OUT]          every dial's readout
        [--keep DIR]          each dial's capture and key log, for scripts/quic_peek.py

Needs Python's `cryptography` (scripts/quic_peek.py).
"""
import argparse
import hashlib
import http.server
import json
import os
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from quic_peek import peek, read_keylog  # noqa: E402

DRAFTS = {"0x2b603742": "draft-02", "0xc671706a": "draft-07", "0x2c7cf000": "draft-15"}
RESET_STREAM_AT = {"0x1d": "reset_stream_at", "0x17f7586d2cb571": "reset_stream_at (quiche's draft codepoint)"}
SETTING_NAMES = {"0x1": "QPACK_MAX_TABLE_CAPACITY", "0x6": "MAX_FIELD_SECTION_SIZE", "0x7": "QPACK_BLOCKED_STREAMS",
                 "0x8": "ENABLE_CONNECT_PROTOCOL", "0x33": "H3_DATAGRAM", "0xffd277": "H3_DATAGRAM draft-04",
                 "0x2b61": "WT_INITIAL_MAX_DATA", "0x2b64": "WT_INITIAL_MAX_STREAMS_UNI",
                 "0x2b65": "WT_INITIAL_MAX_STREAMS_BIDI", "0x4d44": "ENABLE_METADATA",
                 **{k: f"WebTransport {v}" for k, v in DRAFTS.items()}}
PAGE = """<!doctype html><meta charset="utf-8"><script type="module">
const q = new URLSearchParams(location.search);
const post = (r) => fetch("/result", { method: "POST", body: JSON.stringify(r) });
const hash = Uint8Array.from(q.get("hash").match(/../g), (h) => parseInt(h, 16));
try {
  const wt = new WebTransport(q.get("wt"), { serverCertificateHashes: [{ algorithm: "sha-256", value: hash }] });
  await wt.ready;
  const control = await wt.createBidirectionalStream();
  const ask = new TextEncoder().encode(JSON.stringify({ op: "request_frame", frame: 0 }));
  const message = new Uint8Array(4 + ask.length);
  new DataView(message.buffer).setUint32(0, ask.length, true);
  message.set(ask, 4);
  const writer = control.writable.getWriter();
  await writer.write(message);
  const { value: media } = await wt.incomingUnidirectionalStreams.getReader().read();
  const reader = media.getReader();
  let bytes = new Uint8Array(0);
  let envelope = -1;
  while (envelope < 0 || bytes.length < envelope + 4) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes = new Uint8Array([...bytes, ...value]);
    if (bytes.length >= 4) envelope = new DataView(bytes.buffer).getUint32(0);
  }
  const view = new DataView(bytes.buffer);
  const ok = envelope === bytes.length - 4 && view.getUint32(4) === 0;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.subarray(8)));
  const sha256 = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  wt.close();
  await post({ ok, sha256, error: ok ? null : `frame 0: ${bytes.length} B, envelope ${envelope}` });
} catch (e) {
  await post({ ok: false, error: String(e) });
}
</script>"""


class Relay:
    """A UDP relay to the server that keeps every datagram, one upstream socket per client address."""

    def __init__(self, server_port):
        self.down = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.down.bind(("127.0.0.1", 0))
        self.port = self.down.getsockname()[1]
        self.server = ("127.0.0.1", server_port)
        self.up = {}
        self.capture = []
        self.lock = threading.Lock()
        self.running = True
        threading.Thread(target=self._client_side, daemon=True).start()

    def _client_side(self):
        self.down.settimeout(0.2)
        while self.running:
            try:
                data, addr = self.down.recvfrom(65535)
            except socket.timeout:
                continue
            if addr not in self.up:
                up = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                up.connect(self.server)
                self.up[addr] = up
                threading.Thread(target=self._server_side, args=(addr, up), daemon=True).start()
            self._keep(addr, "c2s", data)
            self.up[addr].send(data)

    def _server_side(self, addr, up):
        up.settimeout(0.2)
        while self.running:
            try:
                data = up.recv(65535)
            except (socket.timeout, ConnectionRefusedError):
                continue
            self._keep(addr, "s2c", data)
            self.down.sendto(data, addr)

    def _keep(self, addr, direction, data):
        with self.lock:
            self.capture.append({"peer": f"{addr[0]}:{addr[1]}", "dir": direction, "hex": data.hex()})

    def close(self):
        self.running = False
        time.sleep(0.3)
        self.down.close()
        for up in self.up.values():
            up.close()


def make_cert(tmp):
    subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                    "-keyout", f"{tmp}/key.pem", "-out", f"{tmp}/cert.pem", "-days", "2", "-nodes",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
                   check=True, capture_output=True)
    der = subprocess.run(["openssl", "x509", "-in", f"{tmp}/cert.pem", "-outform", "DER"],
                         check=True, capture_output=True).stdout
    return hashlib.sha256(der).hexdigest()


def serve_page():
    result = {}
    got = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            result.update(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            got.set()
            self.send_response(204)
            self.end_headers()

        def log_message(self, *a):
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, result, got


def engine_of(binary):
    return "firefox" if "firefox" in os.path.basename(binary) else "chromium"


def launch(binary, url, profile, keylog, extra):
    if engine_of(binary) == "firefox":
        env = {**os.environ, "SSLKEYLOGFILE": keylog, "MOZ_CRASHREPORTER_DISABLE": "1"}
        cmd = [binary, "--headless", "--no-remote", "--profile", profile, *extra, url]
    else:
        env = dict(os.environ)
        cmd = [binary, "--headless=new", "--no-sandbox", "--no-first-run", f"--user-data-dir={profile}",
               f"--ssl-key-log-file={keylog}", *extra, url]
    return subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def version_of(binary):
    out = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=60).stdout
    return out.strip().splitlines()[-1] if out.strip() else "?"


def drafts(settings):
    return sorted(name for cp, name in DRAFTS.items() if settings and settings.get(cp, 0) > 0)


def summarize(readout):
    out = {}
    for who in ("client", "server"):
        side = readout.get(who) or {}
        settings = side.get("settings")
        tps = side.get("transport_parameters") or {}
        grease = lambda cp: int(cp, 16) >= 0x21 and (int(cp, 16) - 0x21) % 0x1F == 0  # noqa: E731
        out[who] = {
            "drafts": drafts(settings),
            "settings": None if settings is None else sorted(cp for cp in settings if not grease(cp)),
            "reset_stream_at": sorted(cp for cp in tps if cp in RESET_STREAM_AT),
            "reset_stream_at_frames": "0x24" in side.get("frame_types", []),
        }
    shared = set(out["client"]["drafts"]) & set(out["server"]["drafts"])
    out["negotiated"] = max(shared, key=lambda d: int(d.split("-")[1])) if shared else None
    return out


def dial(name, binary, extra, server_bin, series, frame_path, tmp, cert_hash, page, keep):
    frame_sha256 = hashlib.sha256(open(frame_path, "rb").read()).hexdigest()
    httpd, result, got = page
    result.clear()
    got.clear()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    server_port = sock.getsockname()[1]
    sock.close()
    server = subprocess.Popen([server_bin, "--port", str(server_port), "--bind", "127.0.0.1", "--series", series,
                               "--cert-pem", f"{tmp}/cert.pem", "--key-pem", f"{tmp}/key.pem"],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    for line in server.stdout:
        if line.startswith("transport="):
            break
    relay = Relay(server_port)
    profile = tempfile.mkdtemp(dir=tmp)
    keylog = f"{profile}.keys"
    url = (f"http://127.0.0.1:{httpd.server_address[1]}/?wt=https://127.0.0.1:{relay.port}/"
           f"&hash={cert_hash}")
    browser = launch(binary, url, profile, keylog, extra)
    if not got.wait(30):
        result.update({"ok": False, "error": "no result in 30 s"})
    time.sleep(0.5)
    os.killpg(browser.pid, signal.SIGKILL)
    browser.wait()
    relay.close()
    server.kill()
    server.wait()
    if result.get("ok") and result.get("sha256") != frame_sha256:
        result.update({"ok": False, "error": f"frame 0's codestream is not {os.path.basename(frame_path)}'s bytes"})
    keys = read_keylog(keylog) if os.path.exists(keylog) else {}
    readouts = []
    for peer in dict.fromkeys(c["peer"] for c in relay.capture):
        readouts.append(peek([c for c in relay.capture if c["peer"] == peer], keys))
    readout = next((r for r in readouts if (r.get("client") or {}).get("settings") is not None),
                   readouts[0] if readouts else {})
    if keep:
        os.makedirs(keep, exist_ok=True)
        with open(os.path.join(keep, f"{name}.jsonl"), "w") as f:
            f.writelines(json.dumps(c) + "\n" for c in relay.capture)
        if os.path.exists(keylog):
            shutil.copy(keylog, os.path.join(keep, f"{name}.keys"))
    shutil.rmtree(profile, ignore_errors=True)
    return {"name": name, "engine": engine_of(binary), "version": version_of(binary), "flags": extra,
            "frame_ok": bool(result.get("ok")), "error": result.get("error"), "connections": len(readouts),
            "readout": readout, **summarize(readout)}


def problems(row, expect):
    out = []
    if not row["frame_ok"]:
        out.append(f"the dial failed, or frame 0 was not byte-exact: {row['error']}")
    for who in ("client", "server"):
        if row[who]["settings"] is None:
            out.append(f"no {who} SETTINGS read from the capture (keys found: {row['readout'].get('keys_found')})")
    want = {**expect["engines"].get(row["engine"], {}), "server": expect["server"]}
    for who, exp in (("client", want), ("server", expect["server"])):
        got = row[who]
        for key in ("drafts", "settings", "reset_stream_at"):
            if key in exp and got[key] is not None and got[key] != exp[key]:
                names = lambda cps: [SETTING_NAMES.get(c, RESET_STREAM_AT.get(c, c)) for c in cps]  # noqa: E731
                extra, missing = sorted(set(got[key]) - set(exp[key])), sorted(set(exp[key]) - set(got[key]))
                out.append(f"{who} {key} changed: now {got[key]}; new {names(extra)}, gone {names(missing)}")
    if "negotiated" in want and row["negotiated"] != want["negotiated"]:
        out.append(f"negotiated {row['negotiated']}, expected {want['negotiated']}")
    return out


def fetch(directory):
    """The newest Chrome for Testing channels and Firefox release and nightly, as NAME=BINARY."""
    os.makedirs(directory, exist_ok=True)
    got = []
    cft = json.load(urllib.request.urlopen(
        "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"))
    for channel in ("Stable", "Beta", "Canary"):
        c = cft["channels"][channel]
        url = next(d["url"] for d in c["downloads"]["chrome"] if d["platform"] == "linux64")
        dest = os.path.join(directory, f"chrome-{channel.lower()}-{c['version']}")
        got.append(_download(url, dest, None, "zip") + ("chrome-linux64/chrome",))
    versions = json.load(urllib.request.urlopen("https://product-details.mozilla.org/1.0/firefox_versions.json"))
    release = versions["LATEST_FIREFOX_VERSION"]
    base = f"https://archive.mozilla.org/pub/firefox/releases/{release}"
    sums = urllib.request.urlopen(f"{base}/SHA256SUMS").read().decode()
    name = f"linux-x86_64/en-US/firefox-{release}.tar.xz"
    want = next(line.split()[0] for line in sums.splitlines() if line.endswith(" " + name))
    got.append(_download(f"{base}/{name}", os.path.join(directory, f"firefox-{release}"), want, "tar")
               + ("firefox/firefox",))
    nightly = versions["FIREFOX_NIGHTLY"]
    base = "https://archive.mozilla.org/pub/firefox/nightly/latest-mozilla-central"
    stem = f"firefox-{nightly}.en-US.linux-x86_64"
    checksums = urllib.request.urlopen(f"{base}/{stem}.checksums").read().decode()
    want = next(line.split()[0] for line in checksums.splitlines()
                if line.split()[1] == "sha256" and line.endswith(f" {stem}.tar.xz"))
    got.append(_download(f"{base}/{stem}.tar.xz", os.path.join(directory, f"firefox-{nightly}"), want, "tar")
               + ("firefox/firefox",))
    for dest, digest, binary in got:
        print(f"fetched {os.path.basename(dest)} sha256={digest}")
    return [f"{os.path.basename(dest)}={os.path.join(dest, binary)}" for dest, _, binary in got]


def _download(url, dest, want_sha256, kind):
    archive = dest + (".zip" if kind == "zip" else ".tar.xz")
    if not os.path.exists(archive):
        urllib.request.urlretrieve(url, archive)
    digest = hashlib.sha256(open(archive, "rb").read()).hexdigest()
    if want_sha256 and digest != want_sha256:
        sys.exit(f"{archive}: sha256 {digest}, published {want_sha256}")
    if not os.path.isdir(dest):
        if kind == "zip":
            with zipfile.ZipFile(archive) as z:
                z.extractall(dest)
            os.chmod(os.path.join(dest, "chrome-linux64/chrome"), 0o755)
            for f in ("chrome_crashpad_handler", "chrome_sandbox"):
                p = os.path.join(dest, "chrome-linux64", f)
                if os.path.exists(p):
                    os.chmod(p, 0o755)
        else:
            with tarfile.open(archive) as t:
                t.extractall(dest, filter="tar")
    return dest, digest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("browsers", nargs="*")
    ap.add_argument("--fetch")
    ap.add_argument("--server", default=os.path.join(ROOT, "target/release/series-server"))
    ap.add_argument("--series", default=os.path.join(ROOT, "fixtures/us_cine_smoke/us_cine_smoke.sbnd"))
    ap.add_argument("--frame0", default=os.path.join(ROOT, "fixtures/us_cine_smoke/frames/000.htj2k"))
    ap.add_argument("--expect", default=os.path.join(HERE, "wtcompat.json"))
    ap.add_argument("--flags", action="append", default=[])
    ap.add_argument("--json")
    ap.add_argument("--keep")
    args = ap.parse_args()
    if args.fetch:
        args.browsers += fetch(args.fetch)
    if not args.browsers:
        ap.error("name at least one NAME=BROWSER")
    expect = json.load(open(args.expect))
    flags = {k: shlex.split(v) for k, v in (f.split("=", 1) for f in args.flags)}
    tmp = tempfile.mkdtemp(prefix="wtcompat-")
    cert_hash = make_cert(tmp)
    page = serve_page()
    rows, failed = [], 0
    for spec in args.browsers:
        name, binary = spec.split("=", 1)
        row = dial(name, binary, flags.get(name, []), args.server, args.series, args.frame0,
                   tmp, cert_hash, page, args.keep)
        bad = problems(row, expect)
        failed += bool(bad)
        rows.append(row)
        flagged = " " + " ".join(row["flags"]) if row["flags"] else ""
        print(f"{'FAIL' if bad else 'ok  '} {name}: {row['version']}{flagged}"
              f" — offers {row['client']['drafts']} reset_stream_at {row['client']['reset_stream_at']},"
              f" server {row['server']['drafts']} reset_stream_at {row['server']['reset_stream_at']},"
              f" negotiated {row['negotiated']}, frame {'exact' if row['frame_ok'] else 'FAILED'}")
        for p in bad:
            print(f"     {p}")
    if args.json:
        with open(args.json, "w") as f:
            json.dump(rows, f, indent=1)
    page[0].shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
