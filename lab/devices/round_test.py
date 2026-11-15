#!/usr/bin/env python3
"""python3 lab/devices/round_test.py — the round's laptop side against a fake `adb` on PATH and two dummy servers; no phone."""

import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "round.py"
FAKE_ADB = """#!/bin/sh
echo "$*" >> "$ADB_LOG"
case "$*" in
  "shell settings get global stay_on_while_plugged_in") cat "$ADB_STATE" 2>/dev/null || echo 0 ;;
  "shell settings put global stay_on_while_plugged_in "*) echo "$6" > "$ADB_STATE" ;;
  "shell ps -A -o PID,NAME") printf '  PID NAME\\n  101 com.android.chrome\\n  202 com.android.chrome:sandboxed_process0\\n  303 system_server\\n' ;;
  "shell cat /proc/"*) echo "101 (chrome) S 1 2 3" ;;
esac
"""


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def head() -> str:
    return subprocess.run(["git", "-C", str(HERE), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()


class Rig:
    def __init__(self, d: Path, commit: str, loads_per_block=(2, 2)):
        self.d = d
        bindir = d / "bin"
        bindir.mkdir()
        (bindir / "adb").write_text(FAKE_ADB)
        (bindir / "adb").chmod(0o755)
        self.adb_log = d / "adb.log"
        (d / "adb.state").write_text("3\n")
        self.env = {**os.environ, "PATH": f"{bindir}:{os.environ['PATH']}", "ADB_LOG": str(self.adb_log), "ADB_STATE": str(d / "adb.state")}
        blocks = []
        for b, n in enumerate(loads_per_block):
            port = free_port()
            server = {"cmd": [sys.executable, "-m", "http.server", "--bind", "127.0.0.1", str(port)], "ready": f"http://127.0.0.1:{port}/"}
            loads = [{"url": f"http://127.0.0.1:{port}/?overlay=1&view=page&beacon=cubic-restart", "cell": "2", "arm": "A", "press": "lossless"} for _ in range(n)]
            blocks.append({"name": f"b{b}", "servers": [server], "loads": loads, **({"rebootAfter": True} if b == 0 else {})})
        self.plan = d / "plan.json"
        self.plan.write_text(json.dumps({"commit": commit, "gapS": 0, "fillS": 30, "blocks": blocks}))
        self.port = free_port()
        self.out = d / "out"

    def start(self):
        self.proc = subprocess.Popen([sys.executable, str(SCRIPT), str(self.plan), str(self.out), "--bind", "127.0.0.1", "--port", str(self.port),
                                      "--tree", str(HERE)], env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        return self.proc

    def get(self, path: str):
        for _ in range(100):
            try:
                c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
                c.request("GET", path)
                r = c.getresponse()
                out = r.status, r.getheader("Location"), r.read().decode()
                c.close()
                return out
            except ConnectionRefusedError:
                time.sleep(0.1)
        raise RuntimeError("round.py never answered")

    def events(self):
        return [json.loads(line) for line in (self.out / "round.jsonl").read_text().splitlines()]

    def adb_calls(self):
        return self.adb_log.read_text().splitlines() if self.adb_log.exists() else []


class RoundHost(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)

    def tearDown(self):
        proc = getattr(getattr(self, "rig", None), "proc", None)
        if proc and proc.poll() is None:
            proc.terminate()
            proc.wait()
        if proc:
            proc.stderr.close()
        self.tmp.cleanup()

    def walk(self):
        """Start pressed, then each load's page asking for the next, as the viewer's hook does; the URLs given."""
        urls = []
        status, to, _ = self.rig.get("/next")
        while status == 302:
            urls.append(to)
            k = int(parse_qs(urlsplit(to).query)["at"][0])
            status, to, body = self.rig.get(f"/next?after={k}")
        self.assertEqual((status, "round done" in body), (200, True))
        return urls

    def test_a_commit_mismatch_stops_before_load_1(self):
        """A plan at another commit than the served tree's: the script exits 1 naming both, before any page or adb call."""
        self.rig = Rig(self.d, "0" * 40)
        proc = self.rig.start()
        _, err = proc.communicate(timeout=30)
        self.assertEqual(proc.returncode, 1)
        self.assertIn("the plan's is " + "0" * 40, err)
        self.assertEqual(self.rig.adb_calls(), [])
        self.assertFalse((self.rig.out / "round.jsonl").exists())

    def test_one_press_runs_the_plan_in_order(self):
        """From the one Start, every load of every block is handed out once, in plan order, each URL carrying the hook's fields."""
        self.rig = Rig(self.d, head())
        self.rig.start()
        self.assertIn(b'id="start"', self.rig.get("/")[2].encode())
        urls = self.walk()
        self.assertEqual([int(parse_qs(urlsplit(u).query)["at"][0]) for u in urls], [0, 1, 2, 3])
        q = parse_qs(urlsplit(urls[0]).query)
        self.assertEqual({k: q[k][0] for k in ("view", "beacon", "round", "fillS", "counted", "cell", "arm", "press")},
                         {"view": "page", "beacon": "cubic-restart", "round": f"http://127.0.0.1:{self.rig.port}", "fillS": "30", "counted": "1",
                          "cell": "2", "arm": "A", "press": "lossless"})

    def test_adb_reads_between_loads_never_during_one(self):
        """Every adb call falls outside a load's open-to-end span; each load has its Chrome processes' stat before and after, and logcat after."""
        self.rig = Rig(self.d, head())
        self.rig.start()
        self.walk()
        inside = None
        for e in self.rig.events():
            if e["event"] == "load opened":
                inside = e["load"]
            elif e["event"] == "load ended":
                self.assertEqual(e["load"], inside)
                inside = None
            elif e["event"] == "adb":
                self.assertIsNone(inside, f"adb {e['args']} during load {inside}")
        kept = sorted(p.name for p in (self.rig.out / "adb").iterdir())
        for k in range(4):
            self.assertIn(f"{k:03d}-before-101.stat", kept)
            self.assertIn(f"{k:03d}-after-202.stat", kept)
            self.assertIn(f"{k:03d}-after.logcat.txt", kept)
        self.assertFalse(any("-303." in name for name in kept), "only Chrome's processes")

    def test_stay_on_set_before_the_press_and_restored_after(self):
        """Before Start the setting is read, set to 7 and read back; after the round it is put back to what was read; one adb server start."""
        self.rig = Rig(self.d, head())
        self.rig.start()
        self.rig.get("/")
        calls = self.rig.adb_calls()
        self.assertEqual(calls[:4], ["start-server", "shell settings get global stay_on_while_plugged_in",
                                     "shell settings put global stay_on_while_plugged_in 7", "shell settings get global stay_on_while_plugged_in"])
        self.walk()
        calls = self.rig.adb_calls()
        self.assertEqual(calls.count("start-server"), 1)
        self.assertEqual(calls[-1], "shell settings put global stay_on_while_plugged_in 3")
        self.assertEqual((self.d / "adb.state").read_text().strip(), "3")
        held = next(e for e in self.rig.events() if e["event"] == "stay-on")
        self.assertEqual((held["was"], held["now"], held["holds"]), ("3", "7", True))

    def test_reboot_after_its_block_once(self):
        """A block marked rebootAfter reboots the phone once, between its last load and the next block's first."""
        self.rig = Rig(self.d, head())
        self.rig.start()
        self.walk()
        names = [(e["event"], e.get("load")) for e in self.rig.events() if e["event"] in ("reboot", "load opened", "load ended")]
        self.assertEqual(names.count(("reboot", None)), 1)
        self.assertEqual(names.index(("reboot", None)), names.index(("load ended", 1)) + 1)
        self.assertEqual(self.rig.adb_calls().count("reboot"), 1)

    def test_a_stopped_script_stops_its_servers(self):
        """SIGTERM mid-round: the block's servers stop with the script and the stay-on setting is put back, so no port is left held."""
        self.rig = Rig(self.d, head(), loads_per_block=(2,))
        proc = self.rig.start()
        to = self.rig.get("/next")[1]
        port = urlsplit(to).port
        proc.terminate()
        proc.wait(timeout=30)
        with socket.socket() as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", port))
            s.listen()
        self.assertEqual((self.d / "adb.state").read_text().strip(), "3")

    def test_a_page_asking_twice_is_not_read_twice(self):
        """A reloaded page asking again for the same next gets the same URL, and no second set of reads or gap."""
        self.rig = Rig(self.d, head(), loads_per_block=(3,))
        self.rig.start()
        first = self.rig.get("/next")[1]
        a = self.rig.get("/next?after=0")[1]
        n = len(self.rig.adb_calls())
        b = self.rig.get("/next?after=0")[1]
        self.assertEqual((a, len(self.rig.adb_calls())), (b, n))
        self.assertNotEqual(first, a)


if __name__ == "__main__":
    unittest.main()
