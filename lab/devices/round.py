#!/usr/bin/env python3
"""The round's laptop side: the plan behind `GET /next`, the servers per block, `adb` between loads.

usage: round.py PLAN OUT [--port 8780] [--bind 0.0.0.0] [--tree .] [--no-resources] [--fresh-chrome --beacon FILE]
lab/devices/README.md §The round
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
CHROME = "com.android.chrome"
# Chrome opens a VIEW intent with this extra in the same tab each time.
SAME_TAB = ("-e", "com.android.browser.application_id", "wtpacs.round")
VERDICT_S, QUIET_S = 8, 2
RESOURCES = """echo @meminfo; grep -E "^(MemTotal|MemFree|MemAvailable|Cached|SwapTotal|SwapFree):" /proc/meminfo
echo @psi; cat /proc/pressure/memory 2>/dev/null
echo @vmstat; grep -E "^(pswpin|pswpout|pgmajfault) " /proc/vmstat
echo @thermal; dumpsys thermalservice | grep -E "Thermal Status:|mName=(SKIN|AP|BAT)," | head -4
echo @chrome; for p in $(pgrep -f chrome); do grep -hE "^(Name|VmRSS|VmSwap):" /proc/$p/status 2>/dev/null | tr "\\n" " "; echo; done
echo @top; ps -A -o RSS,NAME -k -rss | head -9"""
PAGE_KEYS = ("cell", "arm", "press", "seq", "steps", "cineS", "stall", "fault", "decoders", "bench", "exactFill")


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
    after = {"afterS": plan["afterS"]} if "afterS" in plan else {}
    hook = {"round": host, "at": k, "fillS": plan["fillS"], **after, "counted": int(load.get("counted", True)), **page}
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


def parse_resources(raw: str) -> dict:
    """`RESOURCES`'s output as one record: memory in MiB, swap and fault counters, thermal, each Chrome process, the top 8 by RSS."""
    sec, cur = {}, None
    for line in raw.splitlines():
        if line.startswith("@"):
            cur = line[1:].strip()
            sec[cur] = []
        elif cur and line.strip():
            sec[cur].append(line.strip())
    kb = {m[1]: int(m[2]) for line in sec.get("meminfo", []) if (m := re.match(r"(\w+):\s+(\d+)", line))}
    mib = lambda name: round(kb[name] / 1024) if name in kb else None
    vm = dict(line.split() for line in sec.get("vmstat", []) if len(line.split()) == 2)
    thermal = sec.get("thermal", [])

    def celsius(name):
        return next((float(m[1]) for line in thermal if (m := re.search(rf"mValue=([0-9.]+), mType=\d+, mName={name},", line))), None)

    chrome = []
    for line in sec.get("chrome", []):
        f = dict(re.findall(r"(Name|VmRSS|VmSwap):\s+(\S+)", line))
        if f:
            chrome.append({"name": f.get("Name"), "rssMiB": round(int(f.get("VmRSS", 0)) / 1024), "swapMiB": round(int(f.get("VmSwap", 0)) / 1024)})
    top = [{"rssMiB": round(int(line.split()[0]) / 1024), "name": line.split(None, 1)[1]} for line in sec.get("top", []) if line.split()[0].isdigit()]
    swap = round((kb["SwapTotal"] - kb["SwapFree"]) / 1024) if {"SwapTotal", "SwapFree"} <= kb.keys() else None
    status = next((int(line.split(":")[1]) for line in thermal if line.startswith("Thermal Status:")), None)
    return {"memTotalMiB": mib("MemTotal"), "memFreeMiB": mib("MemFree"), "memAvailableMiB": mib("MemAvailable"), "cachedMiB": mib("Cached"),
            "swapUsedMiB": swap, "psiMemory": sec.get("psi", []), **{k: int(vm.get(k, 0)) for k in ("pswpin", "pswpout", "pgmajfault")},
            "thermalStatus": status, "skinC": celsius("SKIN"), "apC": celsius("AP"), "batC": celsius("BAT"), "chrome": chrome, "top": top}


def has_verdict(beacon: Path, k: int) -> bool:
    if not beacon.exists():
        return False
    for line in beacon.read_text().splitlines():
        if '"verdict"' in line:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("kind") == "verdict" and r.get("step") == k:
                return True
    return False


class Round:
    def __init__(self, plan: dict, out: Path, host: str, resources: bool, beacon: Path | None):
        """`beacon`, the dev server's beacon file, turns on a fresh Chrome before every load after the first."""
        self.plan, self.out, self.host = plan, out, host
        self.resources, self.beacon = resources, beacon
        self.lock = threading.Lock()
        self.answers: dict[int | None, str | None] = {}
        self.opened: dict[int, float] = {}
        self.spent: dict[str, float] = {}
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
        self.snapshot("start")
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
            self.snapshot(f"after-{k}")

    def snapshot(self, label: str):
        """The phone's memory, swap, thermal and Chrome processes, one line of OUT/resources.jsonl."""
        if not self.resources:
            return
        t0 = time.time() * 1000
        raw = self.adb("shell", RESOURCES)
        if raw is None:
            return
        with (self.out / "resources.jsonl").open("a") as f:
            f.write(json.dumps({"kind": "resources", "label": label, "at": t0, "readMs": round(time.time() * 1000 - t0), **parse_resources(raw)}) + "\n")

    def relaunch(self, k: int, ended: float):
        """Once load `k`'s verdict is in the beacon and the file has been quiet `QUIET_S`, Chrome force-stopped and opened on /next?after=k."""
        verdict = quiet = None
        while time.monotonic() - ended < VERDICT_S:
            if verdict is None and has_verdict(self.beacon, k):
                verdict = time.monotonic()
            if verdict is None:
                time.sleep(0.2)
                continue
            size = self.beacon.stat().st_size
            time.sleep(QUIET_S)
            if self.beacon.stat().st_size == size:
                quiet = time.monotonic()
                break
        if quiet is None:
            why = "beacon not quiet" if verdict else "no verdict"
            return self.note("relaunch skipped", after=k, why=f"{why} within {VERDICT_S} s of load ended")
        # A blank page first closes the page's connections, so the reverse tunnels are not left flushing a dead socket.
        self.adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "about:blank", *SAME_TAB, CHROME)
        time.sleep(1.5)
        self.adb("shell", "am", "force-stop", CHROME)
        time.sleep(0.5)
        self.adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", f"{self.host}/next?after={k}", *SAME_TAB, CHROME)
        pid = None
        for _ in range(20):
            if pid := (self.adb("shell", "pidof", CHROME) or "").strip():
                break
            time.sleep(0.5)
        self.note("relaunch", after=k, verdictMs=round((verdict - ended) * 1000), quietMs=round((quiet - ended) * 1000), pid=pid or None)

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
        self.block = b
        for server in self.plan["blocks"][b]["servers"]:
            proc = subprocess.Popen(server["cmd"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            self.servers.append(proc)
            if "readyLine" in server:
                wait_line(proc, server["readyLine"], server.get("readyS", 60))
            else:
                threading.Thread(target=proc.stdout.read, daemon=True).start()
        for server in self.plan["blocks"][b]["servers"]:
            if "ready" in server:
                wait_answer(server["ready"], server.get("readyS", 60))
        self.note("block", block=b, name=self.plan["blocks"][b].get("name"))

    def next(self, after: int | None) -> str | None:
        """The URL of the load after `after` (None: the first), once its servers answer; None at the round's end; the same again, nothing redone."""
        with self.lock:
            if after in self.answers:
                return self.answers[after]
            self.answers[after] = to = self.advance(after)
            return to

    def advance(self, after: int | None) -> str | None:
        """next-round.md §3: a cell's budget sums its counted loads' open-to-end time; a block that cannot start fails its loads."""
        loads = self.plan["loads"]
        ended = time.monotonic()
        if after is not None:
            self.note("load ended", load=after)
            if loads[after].get("counted", True):
                cell = str(loads[after]["cell"])
                self.spent[cell] = self.spent.get(cell, 0) + time.monotonic() - self.opened[after]
            self.reads(after, "after")
        k = 0 if after is None else after + 1
        while k < len(loads):
            load = loads[k]
            budget = self.plan.get("budgetsS", {}).get(str(load["cell"]))
            if load.get("counted", True) and budget is not None and self.spent.get(str(load["cell"]), 0) > budget:
                self.note("not started", load=k, why="budget")
                k += 1
                continue
            try:
                self.enter(load["block"])
                break
            except Exception as e:
                self.note("host failed", block=load["block"], error=str(e))
                for j in (j for j, other in enumerate(loads) if other["block"] == load["block"] and j >= k):
                    self.note("load failed", load=j, why=f"block {load['block']} did not start: {e}")
                    k = j + 1
        if k == len(loads):
            self.note("round ended")
            self.restore()
            return None
        if after is not None:
            if self.beacon and not load.get("sameRenderer"):
                self.relaunch(after, ended)
            time.sleep(max(0, self.plan["gapS"] - (time.monotonic() - ended)))
        self.reads(k, "before")
        self.note("load opened", load=k)
        self.opened[k] = time.monotonic()
        return load_url(self.plan, k, self.host)


def wait_line(proc: subprocess.Popen, pattern: str, seconds: float = 60):
    """Until the server prints a line matching `pattern` (a QUIC server answers no HTTP); its output drained after."""
    seen, done = [], threading.Event()

    def read():
        for line in proc.stdout:
            if re.search(pattern, line):
                seen.append(line)
                done.set()
        done.set()

    threading.Thread(target=read, daemon=True).start()
    if not done.wait(seconds):
        raise RuntimeError(f"{proc.args[0]} printed no {pattern!r} in {seconds} s")
    if not seen:
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
            except Exception as e:  # a fault in round.py itself; a block that cannot start is recorded and skipped
                round_.note("host failed", error=str(e))
                return self.reply(500, f"the round stopped: {e}".encode())
            if to is None:
                return self.reply(200, b"<!DOCTYPE html><body style='font:20px system-ui'>round done")
            try:
                self.send_response(302)
                self.send_header("Location", to)
                self.end_headers()
            except OSError:  # the Chrome that asked was force-stopped; its relaunch asks again
                round_.note("reply lost", to=to)

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
    p.add_argument("--no-resources", action="store_true", help="no snapshot of the phone's memory and thermal in the gaps")
    p.add_argument("--fresh-chrome", action="store_true", help="Chrome force-stopped and relaunched before every load after the first")
    p.add_argument("--beacon", type=Path, help="the dev servers' --beacon file, whose verdict gates --fresh-chrome")
    args = p.parse_args()
    if args.fresh_chrome and not args.beacon:
        p.error("--fresh-chrome needs --beacon")
    plan = load_plan(args.plan)
    if wrong := commit_mismatches(plan, args.tree):
        print("refused: not the round's commit:\n  " + "\n  ".join(wrong), file=sys.stderr)
        sys.exit(1)
    round_ = Round(plan, args.out, args.host or f"http://{args.bind}:{args.port}", resources=not args.no_resources,
                   beacon=args.beacon.resolve() if args.fresh_chrome else None)
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
