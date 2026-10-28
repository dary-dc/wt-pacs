#!/usr/bin/env python3
"""docs/native/README.md §8.5's lab check: native-fill over wt-pacs/1 against window-harness's WebTransport,
one server, behind link_impair.py, every unit twice a round (the A/A), Williams-ordered. §8.5 holds the reading.

    run.py --make-series DIR && target/release/pack-series --metadata DIR/metadata.json --frames DIR/frames --output DIR/s.sbnd
    run.py --bundle DIR/s.sbnd --frames DIR/frames --rounds 10 --out rows.jsonl
    run.py --summary --out rows.jsonl
"""
import argparse
import json
import math
import os
import random
import re
import statistics
import subprocess
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "lab", "scripts"))
from order import order  # noqa: E402

BIN = os.path.join(ROOT, "target", "release")
SERVER_CPU, RELAY_CPU, CLIENT_CPUS = "0", "1", "2,3"
SERVER_PORT, RELAY_PORT = 4600, 5555
DELAY_MS = 40  # one way
RATES_KBIT = (20000, 50000)
STREAM_WINDOW, CONNECTION_WINDOW = 6 << 20, 15 << 20
KINDS = ("fill_raw", "fill_wt", "cold_raw", "cold_wt")
# A cell whose A/A median strays past half the ±3 % band cannot decide it.
VOID_AA = 0.015
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def units():
    return [f"{r}/{k}/{c}" for r in RATES_KBIT for k in KINDS for c in ("A", "A2")]


def host_ticks():
    v = [int(x) for x in open("/proc/stat").readline().split()[1:]]
    return sum(v) - v[3] - v[4], sum(v), v[7]


def cpu_s(pid):
    f = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
    return (int(f[11]) + int(f[12])) / os.sysconf("SC_CLK_TCK")


def client_cmd(kind, url, a):
    if kind == "fill_raw":
        return [f"{BIN}/native-fill", "--url", url, "--cert-sha256", a.cert, "--bundle", a.bundle,
                "--fill", f"0-{a.n - 1}", "--stream-window", str(STREAM_WINDOW),
                "--connection-window", str(CONNECTION_WINDOW)]
    if kind == "fill_wt":
        return [f"{BIN}/fill_load", "--url", url, "--items", a.frames, "--ext", a.ext, "--server-pid", str(a.server_pid),
                "--stream-window", str(STREAM_WINDOW), "--connection-window", str(CONNECTION_WINDOW)]
    arm = "raw" if kind == "cold_raw" else "webtransport"
    return [f"{BIN}/cold_fill", "--arm", arm, "--url", url, "--cert-sha256", a.cert, "--bundle", a.bundle]


def parse_client(kind, out):
    lines = out.strip().splitlines()
    if kind == "fill_raw":
        m = re.search(r"total bytes=(\d+) ms=([\d.]+) failed=(\d+)", lines[-1])
        frames = sum(1 for l in lines if l.startswith("frame="))
        identical = sum(1 for l in lines if "identical=true" in l)
        return {"ms": float(m[2]), "bytes": int(m[1]), "frames": frames, "identical": identical,
                "settings": lines[0]}
    j = json.loads(lines[-1])
    if kind == "fill_wt":
        return {"ms": j["fill_ms"][0], "bytes": j["bytes"], "frames": j["frames"], "identical": j["exact"]}
    return {"first_ms": j["first_ms"], "ms": j["last_ms"], "frames": j["frames"], "identical": j["identical"]}


def session_paths(log_path):
    return [{k: int(v) for k, v in re.findall(r"(\w+)=(\d+)", ANSI.sub("", l))} for l in open(log_path) if "session path" in l]


def start_server(a, log_path):
    """Fresh for each visit and warmed by one unrecorded fill, so the visit's session is its only other one."""
    server = subprocess.Popen(
        ["taskset", "-c", SERVER_CPU, f"{BIN}/series-server", "--port", str(SERVER_PORT), "--bind", "127.0.0.1",
         "--series", a.bundle, "--cert-pem", f"{ROOT}/server/dev-cert/cert.pem",
         "--key-pem", f"{ROOT}/server/dev-cert/key.pem"],
        stdout=open(log_path, "w"), stderr=subprocess.STDOUT, env={**os.environ, "NO_COLOR": "1"})
    time.sleep(0.5)
    a.cert = re.search(r"cert_sha256=([0-9a-f]{64})", open(log_path).read())[1]
    a.server_pid = server.pid
    warm = subprocess.run([f"{BIN}/fill_load", "--url", f"https://127.0.0.1:{SERVER_PORT}/", "--items", a.frames,
                           "--ext", a.ext, "--server-pid", str(server.pid)], capture_output=True, text=True)
    assert warm.returncode == 0, warm.stderr
    while len(session_paths(log_path)) < 1:
        time.sleep(0.05)
    return server


def visit(unit, a):
    rate, kind, _ = unit.split("/")
    relay = subprocess.Popen(
        ["taskset", "-c", RELAY_CPU, sys.executable, f"{ROOT}/lab/scripts/link_impair.py",
         "--udp", f"{RELAY_PORT}:{SERVER_PORT}", "--delay-ms", str(DELAY_MS), "--rate-kbit", rate, "--self-timing"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    ready = relay.stdout.readline().strip()
    busy0, total0, steal0 = host_ticks()
    relay0, t0 = cpu_s(relay.pid), time.monotonic()
    cmd = client_cmd(kind, f"https://127.0.0.1:{RELAY_PORT}/", a)
    res = subprocess.run(["taskset", "-c", CLIENT_CPUS] + cmd, capture_output=True, text=True, timeout=300)
    wall = time.monotonic() - t0
    relay_cores = (cpu_s(relay.pid) - relay0) / wall
    busy1, total1, steal1 = host_ticks()
    time.sleep(0.3)
    relay.terminate()
    tally = relay.communicate(timeout=10)[0]
    row = {"unit": unit, "rate_kbit": int(rate), "kind": kind, "cmd": " ".join(cmd[1:]).replace(ROOT + "/", ""), "relay": ready, "relay_cores": round(relay_cores, 3),
           "host_busy": round((busy1 - busy0) / max(1, total1 - total0), 3),
           "steal": round((steal1 - steal0) / max(1, total1 - total0), 4)}
    m = re.search(r"late p50 ([\d.]+) p99 ([\d.]+) max ([\d.]+)", tally)
    row["relay_p99_ms"] = float(m[2]) if m else None
    row["void"] = row["relay_p99_ms"] is None or row["relay_p99_ms"] > 1.0
    row["overflowed"] = int(re.search(r"server->client sent \d+ lost \d+ overflowed (\d+)", tally)[1])
    if res.returncode == 0:
        row.update(parse_client(kind, res.stdout))
    else:
        row["error"] = (res.stdout + res.stderr).strip()[-400:]
    return row


def make_series(d):
    """24 incompressible frames of 500–630 kB: the transport sees bytes, so they need only a real series' sizes."""
    rng = random.Random(8)
    sizes = [rng.randint(500_000, 630_000) for _ in range(24)]
    os.makedirs(f"{d}/frames", exist_ok=True)
    for i, n in enumerate(sizes):
        open(f"{d}/frames/{i:03}.htj2k", "wb").write(rng.randbytes(n))
    json.dump({"frameCount": 24, "seriesLabel": "lab_native_step1", "meanFrameBytes": sum(sizes) // 24},
              open(f"{d}/metadata.json", "w"))


def run(a):
    log_path = f"{a.out}.server.log"
    with open(a.out, "a") as out:
        for rnd in range(a.first_round, a.first_round + a.rounds):
            prev = None
            for pos, unit in enumerate(order(units(), rnd)):
                server = start_server(a, log_path)
                try:
                    row = visit(unit, a)
                finally:
                    server.terminate()
                    server.wait()
                # A raw session still open at the stop is reported then: the native client's close does not reach it.
                paths = session_paths(log_path)
                row["path"] = paths[1] if len(paths) == 2 else None
                row.update(round=rnd, pos=pos, prev=prev)
                if rnd == a.first_round and pos == 0:
                    row["server_banner"] = [l.strip() for l in open(log_path) if re.match(r"^[a-z_]+=", l)]
                out.write(json.dumps(row) + "\n")
                out.flush()
                print(rnd, pos, unit, row.get("ms"), row.get("first_ms"), row.get("identical"), "/", row.get("frames"),
                      (row["path"] or {}).get("sent"), "VOID" if row["void"] else "", row.get("error", ""), flush=True)
                prev = unit


def med(v):
    return statistics.median(v) if v else float("nan")


def sign_p(diff):
    """One-sided: the chance of at least this many raw-later pairs if neither arm leads."""
    n, later = len(diff), sum(d > 0 for d in diff)
    return sum(math.comb(n, i) for i in range(later, n + 1)) / 2 ** n if n else float("nan")


def summary(a):
    rows = [json.loads(l) for l in open(a.out)]
    bad = [r for r in rows if "error" in r or r["identical"] != r["frames"] or r["frames"] != a.n]
    print(f"{len(rows)} visits, {sum(r.get('identical', 0) for r in rows)}/{sum(r.get('frames', 0) for r in rows)} "
          f"frames identical to the bundle; {len(bad)} failed; {sum(r['void'] for r in rows)} visits VOID (relay p99 > 1 ms)")
    rounds = sorted({r["round"] for r in rows})
    at = {(r["round"], r["unit"]): r for r in rows if r not in bad and not r["void"]}

    def get(rnd, rate, kind, copy, key):
        r = at.get((rnd, f"{rate}/{kind}/{copy}"))
        if r is None:
            return None
        return (r["path"] or {}).get(key) if key in ("cwnd", "sent", "lost", "congestion_events", "rtt_us") else r.get(key)

    for rate in RATES_KBIT:
        print(f"\n== {rate // 1000} Mbit, {DELAY_MS} ms one way ==")
        for kinds, key, label in ((("fill_raw", "fill_wt"), "ms", "fill, first FoD write to last byte, ms"),
                                  (("cold_raw", "cold_wt"), "first_ms", "cold, dial to first frame's last byte, ms"),
                                  (("cold_raw", "cold_wt"), "ms", "cold, dial to last frame's last byte, ms")):
            raw, wt = kinds
            aa = {}
            aams = {}
            for k in kinds:
                pairs = [(get(n, rate, k, "A", key), get(n, rate, k, "A2", key)) for n in rounds]
                aa[k] = [b / x for x, b in pairs if x and b]
                aams[k] = [b - x for x, b in pairs if x and b]
            ratio = [get(n, rate, raw, c, key) / get(n, rate, wt, c, key) for n in rounds for c in ("A", "A2")
                     if get(n, rate, raw, c, key) and get(n, rate, wt, c, key)]
            diff = [get(n, rate, raw, c, key) - get(n, rate, wt, c, key) for n in rounds for c in ("A", "A2")
                    if get(n, rate, raw, c, key) and get(n, rate, wt, c, key)]
            void = [k for k in kinds if not aa[k] or abs(med(aa[k]) - 1) > VOID_AA]
            vals = {k: [get(n, rate, k, c, key) for n in rounds for c in ("A", "A2") if get(n, rate, k, c, key)] for k in kinds}
            print(f"{label}: raw {med(vals[raw]):.1f} [{min(vals[raw], default=0):.1f}–{max(vals[raw], default=0):.1f}] n={len(vals[raw])}"
                  f" · wt {med(vals[wt]):.1f} [{min(vals[wt], default=0):.1f}–{max(vals[wt], default=0):.1f}] n={len(vals[wt])}")
            for k in kinds:
                print(f"   A/A {k}: A2/A median {med(aa[k]):.4f} [{min(aa[k], default=0):.4f}–{max(aa[k], default=0):.4f}],"
                      f" A2−A {med(aams[k]):+.1f} ms [{min(aams[k], default=0):+.1f}…{max(aams[k], default=0):+.1f}] n={len(aa[k])}")
            print(f"   raw/wt round-paired: median {med(ratio):.4f} [{min(ratio, default=0):.4f}–{max(ratio, default=0):.4f}] n={len(ratio)}; "
                  f"raw−wt median {med(diff):+.1f} ms [{min(diff, default=0):+.1f}…{max(diff, default=0):+.1f}], "
                  f"raw earlier in {sum(d < 0 for d in diff)}/{len(diff)}, sign test p(raw later) {sign_p(diff):.2f}"
                  + (f"  VOID ({', '.join(void)} A/A past ±{VOID_AA:.1%})" if void else ""))
        for key in ("cwnd", "sent", "lost", "congestion_events", "rtt_us"):
            aad = [get(n, rate, k, "A2", key) - get(n, rate, k, "A", key) for k in ("fill_raw", "fill_wt") for n in rounds
                   if get(n, rate, k, "A", key) is not None and get(n, rate, k, "A2", key) is not None]
            d = [get(n, rate, "fill_raw", c, key) - get(n, rate, "fill_wt", c, key) for n in rounds for c in ("A", "A2")
                 if get(n, rate, "fill_raw", c, key) is not None and get(n, rate, "fill_wt", c, key) is not None]
            v = {k: [get(n, rate, k, c, key) for n in rounds for c in ("A", "A2") if get(n, rate, k, c, key) is not None]
                 for k in ("fill_raw", "fill_wt")}
            inside = aad and min(aad) <= med(d) <= max(aad)
            print(f"   server path {key} (fill): raw {med(v['fill_raw']):.0f} · wt {med(v['fill_wt']):.0f}; raw−wt median {med(d):+.0f}"
                  f" against A/A A2−A [{min(aad, default=0):+.0f}…{max(aad, default=0):+.0f}] → {'within' if inside else 'OUTSIDE'}")
        sub = [r for r in rows if r["rate_kbit"] == rate]
        print(f"   host: busy median {med([r['host_busy'] for r in sub]):.2f} max {max(r['host_busy'] for r in sub):.2f} of 4 cores; "
              f"relay median {med([r['relay_cores'] for r in sub]):.2f} max {max(r['relay_cores'] for r in sub):.2f} of a core; "
              f"relay p99 max {max(r['relay_p99_ms'] or 0 for r in sub):.2f} ms; steal max {max(r['steal'] for r in sub):.4f}; "
              f"relay queue overflows median {med([r['overflowed'] for r in sub]):.0f}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--bundle")
    p.add_argument("--frames", help="NNN.<ext> as packed into --bundle, fill_load's reference")
    p.add_argument("--ext", default="htj2k")
    p.add_argument("--n", type=int, default=24, help="frames in the series")
    p.add_argument("--rounds", type=int, default=10)
    p.add_argument("--first-round", type=int, default=0)
    p.add_argument("--make-series", metavar="DIR")
    p.add_argument("--summary", action="store_true")
    p.add_argument("--out", required=True)
    a = p.parse_args()
    make_series(a.make_series) if a.make_series else summary(a) if a.summary else run(a)
