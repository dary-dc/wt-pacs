#!/usr/bin/env python3
"""docs/native/README.md §6 M2 NATIVEFILL: the browser's viewer against the native core, fill and ask, one server build,
every unit twice a round (the A/A), Williams-ordered. §6 holds the predictions, the rule and the reading.

    run.py --make-series DIR                 # DIR/large.sbnd (37 × 1024², ~61 MB) and DIR/small.sbnd (102 × 512² RGB, ~4.4 MB)
    run.py --series DIR --rounds 7 --out rows.jsonl
    run.py --summary --out rows.jsonl
"""
import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import threading
import time

import xxhash

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "lab", "scripts"))
from order import order  # noqa: E402

BIN = os.path.join(ROOT, "target", "release")
SERVER_CPU, RELAY_CPU, CLIENT_CPUS = 0, 1, (2, 3)
SERVER_PORT, RELAY_PORT = 4600, 5555
DELAY_MS = 40  # one way
ASK_RATE_KBIT = 50000
SERIES = {"large": (1024, 1024, 1, 65535, "field", 37), "small": (512, 512, 3, 255, "cine", 102)}
ASKS = {"large": 12, "small": 30}
# (rate kbit or None for loopback, loss %); the ask cell is its own.
FILL_LINKS = [(None, 0), (20000, 0), (20000, 2), (50000, 0), (50000, 2)]
ARMS = ("native", "browser")
# A cell's arm whose A2/A median strays past half its prediction's band cannot decide it.
VOID_AA = {"P1": 0.20, "P2": 0.015, "P3 large": 0.05, "P3 small": 0.025}


def cells():
    fills = [f"fill/{s}/{'loopback' if r is None else f'{r // 1000}M'}/{loss}" for s in SERIES for r, loss in FILL_LINKS]
    return fills + [f"ask/{s}/{ASK_RATE_KBIT // 1000}M/0" for s in SERIES]


def units():
    return [f"{c}/{a}/{k}" for c in cells() for a in ARMS for k in ("A", "A2")]


def cpu_ticks():
    """Busy and total jiffies per CPU."""
    out = {}
    for line in open("/proc/stat"):
        m = re.match(r"cpu(\d+) (.*)", line)
        if m:
            v = [int(x) for x in m[2].split()]
            out[int(m[1])] = (sum(v) - v[3] - v[4], sum(v))
    return out


class Sampler(threading.Thread):
    """/proc/stat every 50 ms with the wall clock, so a busy fraction can be taken over any window of the visit."""

    def __init__(self):
        super().__init__(daemon=True)
        self.samples, self.stop = [], threading.Event()

    def run(self):
        while not self.stop.is_set():
            self.samples.append((time.time(), cpu_ticks()))
            time.sleep(0.05)

    def busy(self, t0, t1, cpus):
        inside = [s for s in self.samples if t0 - 0.05 <= s[0] <= t1 + 0.05] or self.samples[-2:]
        (_, a), (_, b) = inside[0], inside[-1]
        return round(sum(b[c][0] - a[c][0] for c in cpus) / max(1, sum(b[c][1] - a[c][1] for c in cpus)), 3)


def make_series(d):
    """Synthetic HTJ2K in the served profile, digests from the generated samples, never from a decoder."""
    ojph = os.path.join(ROOT, "ingest", ".build", "openjph")
    env = {**os.environ, "LD_LIBRARY_PATH": os.path.join(ojph, "lib")}
    for name, (w, h, ch, maxval, mode, n) in SERIES.items():
        frames = os.path.join(d, name)
        os.makedirs(frames, exist_ok=True)
        digests = []
        for i in range(n):
            pnm = os.path.join(frames, f"{i:03}.{'ppm' if ch == 3 else 'pgm'}")
            subprocess.run([sys.executable, f"{ROOT}/lab/scripts/gen_frame_pnm.py", pnm, str(w), str(h), str(ch), str(maxval), str(i), str(n), mode], check=True)
            subprocess.run([f"{ojph}/bin/ojph_compress", "-i", pnm, "-o", os.path.join(frames, f"{i:03}.htj2k"), "-num_decomps", "5",
                            "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"], check=True, env=env, stdout=subprocess.DEVNULL)
            raw = open(pnm, "rb").read()
            samples = raw[len(raw) - w * h * ch * (2 if maxval > 255 else 1):]
            if maxval > 255:  # PNM is big-endian; decodeFrame hands on little-endian words
                samples = b"".join(samples[j + 1:j + 2] + samples[j:j + 1] for j in range(0, len(samples), 2))
            digests.append(xxhash.xxh3_64_hexdigest(samples))
            os.remove(pnm)
            os.remove(pnm + ".sha256")
        meta = {"frameCount": n, "codec": "htj2k", "width": w, "height": h, "channels": ch, "bitsStored": 16 if maxval > 255 else 8,
                "signed": False, "photometric": "RGB" if ch == 3 else "MONOCHROME2", "seriesLabel": f"lab_native_fill_{name}",
                "digests": {"algorithm": "xxh3-64", "frames": digests}}
        json.dump(meta, open(os.path.join(d, f"{name}.json"), "w"))
        subprocess.run([f"{BIN}/pack-series", "--metadata", os.path.join(d, f"{name}.json"), "--frames", frames,
                        "--output", os.path.join(d, f"{name}.sbnd")], check=True, stdout=subprocess.DEVNULL)
        size = sum(os.path.getsize(os.path.join(frames, f)) for f in os.listdir(frames))
        print(f"{name}: {n} frames, {size / 1e6:.2f} MB coded")


def make_cert(d):
    subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", f"{d}/key.pem",
                    "-out", f"{d}/cert.pem", "-days", "2", "-nodes", "-subj", "/CN=localhost",
                    "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "keyUsage=critical,digitalSignature",
                    "-addext", "extendedKeyUsage=serverAuth", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
                   check=True, capture_output=True)
    der = subprocess.run(["openssl", "x509", "-in", f"{d}/cert.pem", "-outform", "DER"], check=True, capture_output=True).stdout
    return subprocess.run(["openssl", "dgst", "-sha256", "-r"], input=der, check=True, capture_output=True).stdout.split()[0].decode()


def start_static(a, series):
    """The viewer's static host for one series, on the client cores; idle during a timed fill."""
    transport = f"{a.work}/{series}-transport.json"
    json.dump({"wt_url": f"https://127.0.0.1:{SERVER_PORT}/", "cert_sha256": a.cert}, open(transport, "w"))
    p = subprocess.Popen(["taskset", "-c", ",".join(map(str, CLIENT_CPUS)), sys.executable, f"{ROOT}/server/dev-server.py", "--port", "0",
                          "--metadata", f"{a.series}/{series}.json", "--transport", transport], stdout=subprocess.PIPE, text=True)
    port = re.search(r"port=(\d+)", p.stdout.readline())[1]
    threading.Thread(target=lambda: [None for _ in p.stdout], daemon=True).start()
    return p, f"http://127.0.0.1:{port}/"


def start_server(a, series, log_path):
    """Fresh for each visit and warmed by one unrecorded fill, so the visit's session is its only other one."""
    server = subprocess.Popen(
        ["taskset", "-c", str(SERVER_CPU), f"{BIN}/series-server", "--port", str(SERVER_PORT), "--bind", "127.0.0.1",
         "--series", f"{a.series}/{series}.sbnd", "--cert-pem", f"{a.work}/cert.pem", "--key-pem", f"{a.work}/key.pem"],
        stdout=open(log_path, "w"), stderr=subprocess.STDOUT, env={**os.environ, "NO_COLOR": "1"})
    while "transport=" not in open(log_path).read():
        if server.poll() is not None:
            raise RuntimeError(open(log_path).read()[-400:])
        time.sleep(0.05)
    warm = subprocess.run([f"{BIN}/native-fill", "--url", f"https://127.0.0.1:{SERVER_PORT}/", "--cert-sha256", a.cert,
                           "--bundle", f"{a.series}/{series}.sbnd", "--fill", f"0-{SERIES[series][5] - 1}"], capture_output=True, text=True)
    if "total bytes=" not in warm.stdout:
        server.kill()
        raise RuntimeError(warm.stdout[-400:] + warm.stderr)
    return server


def client_cmd(arm, kind, series, url, a):
    n = SERIES[series][5]
    if arm == "native":
        work = ["--fill", f"0-{n - 1}"] if kind == "fill" else ["--ask", ",".join(map(str, range(ASKS[series] + 1))), "--in-turn"]
        return [f"{BIN}/native-fill", "--url", url, "--cert-sha256", a.cert, "--bundle", f"{a.series}/{series}.sbnd",
                *work, "--paint", a.canvas]
    return ["node", f"{ROOT}/lab/native-fill/browser.mjs", "--page", a.static[series], "--wt", url, "--hash", a.cert,
            *(["--asks", str(ASKS[series])] if kind == "ask" else [])]


def parse(arm, kind, out, end):
    if arm == "browser":
        j = json.loads(out.strip().splitlines()[-1])
        if "error" in j:
            raise RuntimeError(j["error"])
        r = {k: j[k] for k in ("frames", "exact", "from_dial_ms", "shown_ms", "canvas", "status")}
        r["window"] = (j["issued_at_ms"] / 1e3, j["issued_at_ms"] / 1e3 + j["from_dial_ms"] / 1e3)
        if kind == "ask":
            r["ask_ms"] = [x["ask_ms"] for x in j["asks"]]
            r["painted_ms"] = [x["painted_ms"] for x in j["asks"]]
        return r
    lines = out.strip().splitlines()
    m = re.search(r"from_dial_ms=([\d.]+) failed=(\d+)", lines[-1])
    rows = [l for l in lines if l.startswith("frame=")]
    r = {"frames": len(rows), "exact": sum("exact=true" in l and "identical=true" in l for l in rows), "from_dial_ms": float(m[1]),
         "settings": lines[0], "window": (end - float(m[1]) / 1e3, end)}
    shown = re.search(r"painted_from_dial_ms=([\d.]+)", out)
    r["shown_ms"] = float(shown[1]) if shown else None
    r["decode_ms"] = statistics.median(float(x) for x in re.findall(r"decode_ms=([\d.]+)", out))
    if kind == "ask":  # the first ask, frame 0, is the browser's opening one: not counted
        r["ask_ms"] = [float(x) for x in re.findall(r"ask_ms=([\d.]+)", out)][1:]
        r["painted_ms"] = [float(x) for x in re.findall(r"painted_ms=([\d.]+)", out)][1:]
    return r


def visit(unit, a):
    kind, series, link, loss, arm, _ = unit.split("/")
    relay = None
    url = f"https://127.0.0.1:{SERVER_PORT}/"
    if link != "loopback":
        rate = int(link[:-1]) * 1000
        relay = subprocess.Popen(
            ["taskset", "-c", str(RELAY_CPU), sys.executable, f"{ROOT}/lab/scripts/link_impair.py", "--udp", f"{RELAY_PORT}:{SERVER_PORT}",
             "--delay-ms", str(DELAY_MS), "--rate-kbit", str(rate), "--loss", loss, "--self-timing"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        ready = relay.stdout.readline().strip()
        url = f"https://127.0.0.1:{RELAY_PORT}/"
    sampler = Sampler()
    sampler.start()
    cmd = client_cmd(arm, kind, series, url, a)
    res = subprocess.run(["taskset", "-c", ",".join(map(str, CLIENT_CPUS))] + cmd, capture_output=True, text=True, timeout=900,
                         env={**os.environ, "NO_COLOR": "1"})
    end = time.time()
    time.sleep(0.1)
    sampler.stop.set()
    sampler.join()
    row = {"unit": unit, "kind": kind, "series": series, "link": link, "loss": int(loss), "arm": arm,
           "cmd": " ".join(cmd).replace(ROOT + "/", "").replace(a.work + "/", "")}
    if relay:
        time.sleep(0.2)
        relay.terminate()
        tally = relay.communicate(timeout=10)[0]
        m = re.search(r"late p50 ([\d.]+) p99 ([\d.]+) max ([\d.]+)", tally)
        row["relay"] = ready
        row["relay_p99_ms"] = float(m[2]) if m else None
        row["void"] = row["relay_p99_ms"] is None or row["relay_p99_ms"] > 1.0
        row["lost"] = int(re.search(r"server->client sent \d+ lost (\d+)", tally)[1])
    else:
        row["void"] = False
    try:
        if res.returncode != 0:
            raise RuntimeError((res.stdout + res.stderr).strip()[-600:])
        row.update(parse(arm, kind, res.stdout, end))
        t0, t1 = row.pop("window")
        row["busy"] = {"server": sampler.busy(t0, t1, [SERVER_CPU]), "relay": sampler.busy(t0, t1, [RELAY_CPU]),
                       "client": sampler.busy(t0, t1, list(CLIENT_CPUS))}
    except Exception as e:  # noqa: BLE001 — the row records it and the summary counts it
        row["error"] = str(e)
    return row


def run(a):
    os.makedirs(a.work, exist_ok=True)
    a.cert = make_cert(a.work)
    statics = {s: start_static(a, s) for s in SERIES}
    a.static = {s: url for s, (_, url) in statics.items()}
    log_path = f"{a.out}.server.log"
    try:
        with open(a.out, "a") as out:
            for rnd in range(a.first_round, a.first_round + a.rounds):
                for pos, unit in enumerate(u for u in order(units(), rnd) if a.only in u):
                    server = start_server(a, unit.split("/")[1], log_path)
                    try:
                        row = visit(unit, a)
                    finally:
                        server.terminate()
                        server.wait()
                    row.update(round=rnd, pos=pos)
                    if pos == 0:
                        row["server_banner"] = [l.strip() for l in open(log_path) if re.match(r"^[a-z_]+=", l)]
                    out.write(json.dumps(row) + "\n")
                    out.flush()
                    print(rnd, pos, unit, row.get("from_dial_ms"), statistics.median(row["painted_ms"]) if row.get("painted_ms") else "",
                          f"{row.get('exact')}/{row.get('frames')}", row.get("busy"), "VOID" if row["void"] else "", row.get("error", "")[:200], flush=True)
    finally:
        for p, _ in statics.values():
            p.terminate()


def med(v):
    return statistics.median(v) if v else float("nan")


def summary(a):
    rows = [json.loads(l) for l in open(a.out)]
    want = {r["unit"]: SERIES[r["series"]][5] if r["kind"] == "fill" else ASKS[r["series"]] + 1 for r in rows}
    bad = [r for r in rows if "error" in r or r["exact"] != r["frames"] or r["frames"] != want[r["unit"]]]
    print(f"{len(rows)} visits; {sum(r.get('exact', 0) for r in rows)}/{sum(r.get('frames', 0) for r in rows)} frames identical and exact; "
          f"{len(bad)} failed; {sum(r['void'] for r in rows)} visits VOID (relay p99 > 1 ms)")
    for r in bad:
        print("  failed:", r["round"], r["unit"], r.get("error", "")[:300] or f"{r.get('exact')}/{r.get('frames')}")
    at = {(r["round"], r["unit"]): r for r in rows if r not in bad and not r["void"]}
    rounds = sorted({r["round"] for r in rows})

    def metric(r, key):
        return med(r[key]) if isinstance(r[key], list) else r[key]

    for cell in cells():
        kind, series, link, loss = cell.split("/")
        pred = "P1" if link == "loopback" else "P2" if kind == "fill" else f"P3 {series}"
        print(f"\n== {cell} ({pred}) ==")
        for key in (("from_dial_ms", "shown_ms") if kind == "fill" else ("painted_ms", "ask_ms")):
            get = lambda n, arm, c: (lambda r: r and metric(r, key))(at.get((n, f"{cell}/{arm}/{c}")))  # noqa: E731
            vals = {arm: [get(n, arm, c) for n in rounds for c in ("A", "A2") if get(n, arm, c)] for arm in ARMS}
            aa = {arm: [get(n, arm, "A2") / get(n, arm, "A") for n in rounds if get(n, arm, "A") and get(n, arm, "A2")] for arm in ARMS}
            ratio = [get(n, "native", c) / get(n, "browser", c) for n in rounds for c in ("A", "A2") if get(n, "native", c) and get(n, "browser", c)]
            void = [arm for arm in ARMS if not aa[arm] or abs(med(aa[arm]) - 1) > VOID_AA[pred]]
            print(f"{key}: native {med(vals['native']):.1f} [{min(vals['native'], default=0):.1f}–{max(vals['native'], default=0):.1f}] n={len(vals['native'])}"
                  f" · browser {med(vals['browser']):.1f} [{min(vals['browser'], default=0):.1f}–{max(vals['browser'], default=0):.1f}] n={len(vals['browser'])}")
            print(f"   native ÷ browser, round-paired: {med(ratio):.4f} [{min(ratio, default=0):.4f}–{max(ratio, default=0):.4f}] n={len(ratio)}"
                  + "".join(f"; A/A {arm} {med(aa[arm]):.4f} [{min(aa[arm], default=0):.4f}–{max(aa[arm], default=0):.4f}]" for arm in ARMS)
                  + (f"  VOID ({', '.join(void)} A/A past ±{VOID_AA[pred]:.1%})" if void and key in ("from_dial_ms", "painted_ms") else ""))
        sub = [r for r in rows if r["unit"].startswith(cell + "/") and "busy" in r]
        for arm in ARMS:
            s = [r for r in sub if r["arm"] == arm]
            if s:
                print(f"   busy, {arm}: client cores median {med([r['busy']['client'] for r in s]):.2f} max {max(r['busy']['client'] for r in s):.2f} of 2; "
                      f"server core {med([r['busy']['server'] for r in s]):.2f} max {max(r['busy']['server'] for r in s):.2f}; "
                      f"relay core max {max(r['busy']['relay'] for r in s):.2f}"
                      + (f"; native decode median {med([r['decode_ms'] for r in s]):.1f} ms a frame" if arm == "native" else ""))
        if any("relay_p99_ms" in r for r in sub):
            print(f"   relay p99 max {max(r.get('relay_p99_ms') or 0 for r in sub):.2f} ms")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--series", help="the directory --make-series wrote")
    p.add_argument("--work", default="/tmp/native-fill", help="cert and transport files")
    p.add_argument("--canvas", default="1280x691", help="the native paint's size: the viewer's canvas in device pixels")
    p.add_argument("--rounds", type=int, default=7)
    p.add_argument("--first-round", type=int, default=0)
    p.add_argument("--make-series", metavar="DIR")
    p.add_argument("--summary", action="store_true")
    p.add_argument("--out")
    p.add_argument("--only", default="", help="run only the units containing this, for a check or a mutant")
    a = p.parse_args()
    make_series(a.make_series) if a.make_series else summary(a) if a.summary else run(a)
