#!/usr/bin/env python3
"""ASKAHEAD's campaign: per round, per cell, today's server and `--send-window-follows-cwnd` in a Williams
order (lab/scripts/order.py), each run its own server and relay (`link_impair.py --self-timing`), one
headless Chromium (visit.mjs) for the whole campaign. One JSON row per run on stdout.

usage: cells.py SERIES_DIR ROUNDS CELL ...   CELL = RATE_MBIT/RTT_MS/QUEUE[~SERIES][@AT][#SHAPE][:ARM,...], QUEUE =
       fifoMS or codel, AT the share landed before the ask (default ASK_AT) or `none`, SERIES a name in MORE_SERIES
       (NAME=DIR,...), SHAPE one of SHAPES; the arms default to all of ARMS
       ARMS=today,follow  (a further arm is name=--server-flag ..., or name=PATH/series-server [flag ...];
       a `?key=value` token goes to the page's query) — lab/ask-ahead/README.md
"""
import json
import os
import re
import socket
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lab/scripts"))
from order import order  # noqa: E402

ARMS = {"today": [], "follow": ["--send-window-follows-cwnd"]}
SERVER = Path(os.environ.get("SERVER", ROOT / "target/release/series-server"))
# RELAY_CHRT=50 runs the relay under SCHED_FIFO: a late relay reads as link jitter (docs/rig-limits.md §3).
PRIO = ["chrt", "-f", os.environ["RELAY_CHRT"]] if os.environ.get("RELAY_CHRT") else []
ASK_AT = float(os.environ.get("ASK_AT", "0.5"))
# docs/WIRE.md §Proposed: an ask during a fill. The page's query, and how a run's asks make its `ask_ms`.
SHAPES = {"u2": ("", lambda r: r["askMs"]),
          "u1": ("&asks=8&every=100", lambda r: statistics.median(r["asksMs"]) if r["asksMs"] else None),
          "u3": ("&asks=4", lambda r: r["allMs"]),
          # docs/WIRE.md §What a scroll ahead asks: the last ten frames, a step every 500, 100 or 20 ms.
          **{f"scroll{ms}": (f"&asks=10&every={ms}", lambda r: r["staleMs"]) for ms in (500, 100, 20)}}


def free_port(kind=socket.SOCK_DGRAM):
    with socket.socket(socket.AF_INET, kind) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def parse(cell):
    """`(link, at, arms or None)` of a CELL."""
    cell, _, arms = cell.partition(":")
    cell = cell.partition("#")[0]
    link, _, at = cell.partition("@")
    return link.partition("~")[0], at, arms.split(",") if arms else None


def shape(cell):
    return cell.partition(":")[0].partition("#")[2] or "u2"


def series_of(cell):
    return cell.partition(":")[0].partition("#")[0].partition("@")[0].partition("~")[2] or None


def link(cell):
    rate, rtt, queue, *loss = parse(cell)[0].split("/")
    args = ["--delay-ms", str(int(rtt) / 2), "--rate-kbit", str(int(float(rate) * 1000)), "--self-timing"]
    if loss:
        args += ["--loss", loss[0].removeprefix("loss")]
    if queue == "codel":
        return args + ["--queue-ms", "800", "--codel", "5:100"]
    return args + ["--queue-ms", queue.removeprefix("fifo")]


def shown(args):
    return [os.path.relpath(a, ROOT) if a.endswith("series-server") else a for a in args]


def status(pid, key):
    m = re.search(rf"^{key}:\s+(\d+) kB", Path(f"/proc/{pid}/status").read_text(), re.M)
    return int(m.group(1))


def wait_for(log, pattern, proc, secs=10):
    """The first line of `log` matching `pattern`, read again until it appears."""
    deadline = time.time() + secs
    while time.time() < deadline:
        m = re.search(pattern, re.sub(r"\x1b\[[0-9;]*m", "", log.read_text(errors="replace")), re.M)
        if m:
            return m
        if proc.poll() is not None:
            break
        time.sleep(0.05)
    return None


def run(t, visit, http, cell, arm, rnd, prev):
    t = t.more[series_of(cell)] if series_of(cell) else t
    srv, inp, ctrl = free_port(), free_port(), free_port()
    slog, rlog = t / "server.log", t / "relay.log"
    query = "".join(f"&{a[1:]}" for a in ARMS[arm] if a.startswith("?"))
    server_args = [a for a in ARMS[arm] if not a.startswith("?")]
    binary, flags = (server_args[0], server_args[1:]) if server_args[:1] and server_args[0].endswith("series-server") else (SERVER, server_args)
    with open(slog, "w") as f:
        server = subprocess.Popen(env={**os.environ, "RUST_LOG": "series_server::transport::link=debug"}, args=[binary, "--port", str(srv), "--bind", "127.0.0.1", "--series", t / "series.sbnd",
                                   "--cert-pem", t / "cert.pem", "--key-pem", t / "key.pem", *flags],
                                  stdout=f, stderr=subprocess.STDOUT)
    with open(rlog, "w") as f:
        relay = subprocess.Popen([*PRIO, sys.executable, ROOT / "lab/scripts/link_impair.py", "--udp", f"{inp}:{srv}",
                                  "--control-port", str(ctrl), "--seed", str(rnd), *link(cell)],
                                 stdout=f, stderr=subprocess.STDOUT)
    if not wait_for(slog, r"series-server ready", server) or not wait_for(rlog, r"^READY", relay):
        raise RuntimeError(slog.read_text() + rlog.read_text())
    settings = wait_for(slog, r"^transport=.*$", server).group(0)
    rss0 = status(server.pid, "VmRSS")
    (t / "transport.json").write_text(json.dumps({"wt_url": f"https://127.0.0.1:{inp}/", "cert_sha256": t.cert}))
    at = parse(cell)[1]
    share = "none" if at == "none" else int(at) / 100 if at else ASK_AT
    visit.stdin.write(f"http://127.0.0.1:{http}/lab/ask-ahead/index.html?frames={t.frames}&at={share}&ask={t.ask}"
                      f"{SHAPES[shape(cell)][0]}{query}\n")
    visit.stdin.flush()
    r = json.loads(visit.stdout.readline())
    # The page's close is still in the relay's queue; the server logs the session once it lands.
    path = wait_for(slog, r"session path .*?rtt_us=(\d+) cwnd=(\d+) sent=(\d+) lost=(\d+)", server, 5)
    asked = wait_for(slog, r"ask written.*?cwnd=(\d+)(?: rtt_us=(\d+))?", server, 1)
    gso = path and wait_for(slog, r"session path .*?datagrams_tx=(\d+) sendmsg=(\d+)", server, 1)
    hwm = status(server.pid, "VmHWM")
    server.terminate()
    relay.terminate()
    server.wait()
    relay.wait()
    tally = rlog.read_text()
    late = re.findall(r"self-timing packets \d+ late p50 [\d.]+ p99 ([\d.]+)", tally)
    sha_ok = r.get("sha") and all(r["sha"].get(str(i)) == d for i, d in enumerate(t.digests))
    return {"round": rnd, "cell": cell, "arm": arm, "prev": prev, "settings": f"{settings} {' '.join(shown(ARMS[arm]))}".strip(),
            "ask_ms": round(SHAPES[shape(cell)][1](r), 1) if r.get("askMs") is not None else None,
            "asks_ms": [round(v, 1) for v in r.get("asksMs") or []],
            "rest_ms": round(r["restMs"], 1) if r.get("restMs") is not None else None,
            "fill_ms": round(r["fillMs"], 1) if "fillMs" in r else None,
            "ahead": r.get("ahead"), "ahead_bytes": sum(t.sizes[i] for i in r.get("ahead") or []),
            "exact": bool(sha_ok), "error": r.get("error") or (r.get("errors") or [None])[0],
            "gap_ms": gap(r["landedMs"], t.ask if at != "none" else None) if "landedMs" in r else None,
            "next_ms": round(r["next"]["ms"], 1) if r.get("next") else None,
            "next_bytes": t.sizes[r["next"]["index"]] if r.get("next") else None,
            "cwnd_at_ask": int(asked.group(1)) if asked else None,
            "rtt_at_ask_ms": int(asked.group(2)) / 1000 if asked and asked.group(2) else None,
            "fill_left_at_ask": sum(t.sizes[:-1]) - sum(t.sizes[i] for i in r["before"]) if "before" in r else None,
            "rss_session_kb": hwm - rss0,
            "rtt_ms": int(path.group(1)) / 1000 if path else None, "cwnd": int(path.group(2)) if path else None,
            "sent": int(path.group(3)) if path else None, "lost": int(path.group(4)) if path else None,
            "per_sendmsg": round(int(gso.group(1)) / max(int(gso.group(2)), 1), 1) if gso else None,
            "relay_p99_ms": float(late[-1]) if late else None, "void": not late or "VOID" in tally}


def gap(landed, asked):
    """The longest wait between two frames becoming usable in order, the asked frame left out."""
    usable, last = [], 0.0
    for t in (t for i, t in enumerate(landed) if i != asked):
        last = max(last, t)
        usable.append(last)
    return round(max(b - a for a, b in zip(usable, usable[1:])), 1)


class Rig(type(Path())):
    def load(self, series):
        os.symlink(series / "series.sbnd", self / "series.sbnd")
        self.digests = json.loads((series / "digests.json").read_text())
        self.frames = len(self.digests)
        self.sizes = [(series / "frames" / f"{i:03d}.htj2k").stat().st_size for i in range(self.frames)]
        # The last frame: what a deep queue has written ahead at half the fill never reaches it.
        self.ask = self.frames - 1


def main():
    series, rounds, cells = Path(sys.argv[1]).resolve(), int(sys.argv[2]), sys.argv[3:]
    for spec in os.environ.get("ARMS", "today,follow").split(","):
        name, _, flag = spec.partition("=")
        if flag or name not in ARMS:
            ARMS[name] = flag.split()
    arms = os.environ.get("ARMS", "today,follow").split(",")
    arms = [a.partition("=")[0] for a in arms]
    with tempfile.TemporaryDirectory() as d:
        t = Rig(d)
        subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                        "-keyout", t / "key.pem", "-out", t / "cert.pem", "-days", "2", "-nodes", "-subj", "/CN=localhost",
                        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], check=True, capture_output=True)
        der = subprocess.run(["openssl", "x509", "-in", t / "cert.pem", "-outform", "DER"], check=True, capture_output=True).stdout
        import hashlib
        t.cert = hashlib.sha256(der).hexdigest()
        t.load(series)
        (t / "transport.json").write_text("{}")
        t.more = {}
        for spec in filter(None, os.environ.get("MORE_SERIES", "").split(",")):
            name, _, path = spec.partition("=")
            m = t.more[name] = Rig(t / name)
            m.mkdir()
            for f in ("cert.pem", "key.pem", "transport.json"):
                os.symlink(t / f, m / f)
            m.cert = t.cert
            m.load(Path(path).resolve())
        http = free_port(socket.SOCK_STREAM)
        web = subprocess.Popen([sys.executable, ROOT / "server/dev-server.py", "--port", str(http),
                                "--transport", t / "transport.json"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        env = {**os.environ, "NODE_PATH": os.environ.get("NODE_PATH") or subprocess.run(
            ["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()}
        visit = subprocess.Popen(["node", ROOT / "lab/ask-ahead/visit.mjs"], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, text=True, env=env)
        print(json.dumps({"chromium": json.loads(visit.stdout.readline())["chromium"],
                          "server": subprocess.run(["git", "-C", ROOT, "rev-parse", "--short", "HEAD"], capture_output=True,
                                                   text=True).stdout.strip(), "arms": {a: shown(ARMS[a]) for a in arms},
                          "series": str(series.name), "relay_chrt": os.environ.get("RELAY_CHRT"), "frames": t.frames, "ask_at": ASK_AT, "bytes": sum(t.sizes),
                          "ask": t.ask, "ask_bytes": t.sizes[t.ask],
                          "more": {n: {"series": os.path.basename(os.environ["MORE_SERIES"].split(n + "=")[1].split(",")[0]),
                                       "frames": m.frames, "bytes": sum(m.sizes), "ask": m.ask, "ask_bytes": m.sizes[m.ask]}
                                   for n, m in t.more.items()}}), flush=True)
        time.sleep(0.5)
        try:
            for rnd in range(int(os.environ.get("FIRST_ROUND", 0)), rounds):
                for cell in cells:
                    prev = None
                    for arm in order(parse(cell)[2] or arms, rnd):
                        try:
                            row = run(t, visit, http, cell, arm, rnd, prev)
                        except RuntimeError:
                            # A server or relay that failed to start (a port taken between probe and bind) measured nothing.
                            row = run(t, visit, http, cell, arm, rnd, prev)
                        print(json.dumps(row), flush=True)
                        prev = arm
        finally:
            visit.stdin.close()
            visit.wait()
            web.terminate()


if __name__ == "__main__":
    main()
