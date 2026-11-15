#!/usr/bin/env python3
"""The round's laptop side: the plan behind `GET /next`, the servers per block, `adb` between loads.

usage: round.py PLAN OUT [--port 8780] [--bind 0.0.0.0] [--tree .]   lab/devices/README.md §The round
"""

import argparse
import atexit
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

ADB = os.environ.get("ADB", "adb")
STAY_ON = "stay_on_while_plugged_in"
# AC | USB | wireless, next-round.md §3; the dock's 8 left out.
STAY_ON_ALL = "7"
PAGE_KEYS = ("cell", "arm", "press", "seq", "steps", "cineS", "stall")


def load_plan(path: Path) -> dict:
    plan = json.loads(path.read_text())
    for key in ("commit", "gapS", "fillS", "blocks"):
        if key not in plan:
            raise SystemExit(f"refused: the plan has no {key}")
    plan["loads"] = [dict(load, block=b) for b, block in enumerate(plan["blocks"]) for load in block["loads"]]
    if not plan["loads"]:
        raise SystemExit("refused: a plan with no load")
    return plan


def load_url(plan: dict, k: int, host: str) -> str:
    """Load `k`'s viewer URL, its own query first, then what the round's hook reads."""
    load = plan["loads"][k]
    page = {key: load[key] for key in PAGE_KEYS if key in load}
    hook = {"round": host, "at": k, "fillS": plan["fillS"], "counted": int(load.get("counted", True)), **page}
    return f"{load['url']}&{urlencode(hook)}"


def commit_mismatches(plan: dict, tree: Path) -> list[str]:
    """next-round.md §1: the served tree and each server image at the plan's commit; each difference named."""
    want = plan["commit"]
    head = subprocess.run(["git", "-C", str(tree), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    out = [] if head == want else [f"the served tree is at {head or 'no commit'}, the plan's is {want}"]
    for block in plan["blocks"]:
        for server in block["servers"]:
            if image := server.get("image"):
                label = subprocess.run(["podman", "image", "inspect", "--format",
                                        '{{index .Labels "org.opencontainers.image.revision"}}', image], capture_output=True, text=True).stdout.strip()
                if label != want:
                    out.append(f"image {image} is at {label or 'no revision label'}")
    return out


class Round:
    def __init__(self, plan: dict, out: Path, host: str):
        self.plan, self.out, self.host = plan, out, host
        self.lock = threading.Lock()
        self.next_k = 0
        self.block = None
        self.servers: list[subprocess.Popen] = []
        self.stay_on_was = None
        (out / "adb").mkdir(parents=True, exist_ok=True)

    def note(self, event: str, **fields):
        with (self.out / "round.jsonl").open("a") as f:
            f.write(json.dumps({"kind": "host", "event": event, "at": time.time() * 1000, **fields}) + "\n")

    def adb(self, *args: str, keep: str | None = None) -> str | None:
        """One `adb` call, its output kept under `keep`; None, recorded, when it fails."""
        try:
            run = subprocess.run([ADB, *args], capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired) as e:
            self.note("adb", args=list(args), error=str(e))
            return None
        if keep:
            (self.out / "adb" / keep).write_text(run.stdout)
        self.note("adb", args=list(args), code=run.returncode, kept=keep)
        return run.stdout if run.returncode == 0 else None

    def prepare(self):
        """Before the press, untimed: one adb server, the stay-on setting, one logcat read."""
        self.adb("start-server")
        self.stay_on_was = (self.adb("shell", "settings", "get", "global", STAY_ON) or "").strip() or None
        self.adb("shell", "settings", "put", "global", STAY_ON, STAY_ON_ALL)
        back = (self.adb("shell", "settings", "get", "global", STAY_ON) or "").strip()
        self.note("stay-on", was=self.stay_on_was, now=back, holds=back == STAY_ON_ALL)
        self.adb("logcat", "-d", keep="before-round.logcat.txt")
        atexit.register(self.restore)

    def restore(self):
        if self.stay_on_was is not None:
            self.adb("shell", "settings", "put", "global", STAY_ON, self.stay_on_was)
            self.note("stay-on restored", to=self.stay_on_was)
            self.stay_on_was = None
        self.stop_servers()

    def reads(self, k: int, when: str):
        """next-round.md §2: each Chrome process's /proc/<pid>/stat and logcat's buffer, between loads only."""
        ps = self.adb("shell", "ps", "-A", "-o", "PID,NAME") or ""
        pids = [line.split()[0] for line in ps.splitlines() if "chrome" in line and line.split()[0].isdigit()]
        for pid in pids:
            self.adb("shell", "cat", f"/proc/{pid}/stat", keep=f"{k:03d}-{when}-{pid}.stat")
        if when == "after":
            self.adb("logcat", "-d", keep=f"{k:03d}-after.logcat.txt")
            self.adb("logcat", "-c")

    def stop_servers(self):
        for s in self.servers:
            s.terminate()
        for s in self.servers:
            s.wait()
        self.servers = []

    def enter(self, b: int):
        """Block `b`'s servers up and answering; a block before it marked `rebootAfter` reboots the phone first."""
        if self.block == b:
            return
        if self.block is not None and self.plan["blocks"][self.block].get("rebootAfter"):
            self.adb("reboot")
            self.note("reboot", after_block=self.block)
        self.stop_servers()
        for server in self.plan["blocks"][b]["servers"]:
            proc = subprocess.Popen(server["cmd"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            self.servers.append(proc)
            if "readyLine" in server:
                wait_line(proc, server["readyLine"])
            threading.Thread(target=proc.stdout.read, daemon=True).start()
        for server in self.plan["blocks"][b]["servers"]:
            if "ready" in server:
                wait_answer(server["ready"])
        self.block = b
        self.note("block", block=b, name=self.plan["blocks"][b].get("name"))

    def next(self, after: int | None) -> str | None:
        """The URL of the load after `after` (None: the first), once its servers answer; None at the round's end."""
        with self.lock:
            k = 0 if after is None else after + 1
            if k < self.next_k:
                return load_url(self.plan, k, self.host) if k < len(self.plan["loads"]) else None
            if after is not None:
                self.note("load ended", load=after)
                self.reads(after, "after")
            if k == len(self.plan["loads"]):
                self.next_k = k + 1
                self.note("round ended")
                self.restore()
                return None
            self.enter(self.plan["loads"][k]["block"])
            if after is not None:
                time.sleep(self.plan["gapS"])
            self.reads(k, "before")
            self.next_k = k + 1
            self.note("load opened", load=k)
            return load_url(self.plan, k, self.host)


def wait_line(proc: subprocess.Popen, pattern: str):
    """Until the server prints a line matching `pattern` (a QUIC server answers no HTTP)."""
    for line in proc.stdout:
        if re.search(pattern, line):
            return
    raise RuntimeError(f"{proc.args[0]} exited before printing {pattern!r}")


def wait_answer(url: str, seconds: float = 60):
    t0 = time.monotonic()
    while True:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except OSError:
            if time.monotonic() - t0 > seconds:
                raise RuntimeError(f"no answer from {url} in {seconds} s")
            time.sleep(0.2)


START = b"""<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>wt-pacs round</title><body style="font:20px system-ui;background:#111;color:#eee">
<button id="start" style="font:inherit;padding:24px 40px" onclick="location.assign('/next')">Start</button>"""


def handler(round_: Round):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urlsplit(self.path)
            if url.path == "/":
                return self.reply(200, START)
            if url.path != "/next":
                return self.reply(404, b"not found")
            after = parse_qs(url.query).get("after", [None])[0]
            try:
                to = round_.next(None if after is None else int(after))
            except Exception as e:  # a server that never answers ends the round here, said on the phone
                round_.note("host failed", error=str(e))
                return self.reply(500, f"the round stopped: {e}".encode())
            if to is None:
                return self.reply(200, b"<!DOCTYPE html><body style='font:20px system-ui'>round done")
            self.send_response(302)
            self.send_header("Location", to)
            self.end_headers()

        def reply(self, code: int, body: bytes):
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    return Handler


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("plan", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--port", type=int, default=8780)
    p.add_argument("--bind", default="0.0.0.0")
    p.add_argument("--host", help="the origin the phone reaches this script at (default http://BIND:PORT)")
    p.add_argument("--tree", type=Path, default=Path(__file__).resolve().parents[2])
    args = p.parse_args()
    plan = load_plan(args.plan)
    if wrong := commit_mismatches(plan, args.tree):
        print("refused: not the round's commit:\n  " + "\n  ".join(wrong), file=sys.stderr)
        sys.exit(1)
    round_ = Round(plan, args.out, args.host or f"http://{args.bind}:{args.port}")
    round_.prepare()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    server = ThreadingHTTPServer((args.bind, args.port), handler(round_))
    print(f"round: {len(plan['loads'])} loads; press Start at {round_.host}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        round_.restore()


if __name__ == "__main__":
    main()
