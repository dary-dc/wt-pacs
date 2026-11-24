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
RAW = HERE / "raw_rows.py"
FAKE_ADB = """#!/bin/sh
echo "$*" >> "$ADB_LOG"
case "$*" in
  "shell settings get global stay_on_while_plugged_in") cat "$ADB_STATE" 2>/dev/null || echo 0 ;;
  "shell settings put global stay_on_while_plugged_in "*) echo "$6" > "$ADB_STATE" ;;
  "shell ps -A -o PID,NAME") printf '  PID NAME\\n  101 com.android.chrome\\n  202 com.android.chrome:sandboxed_process0\\n  303 system_server\\n' ;;
  "shell cat /proc/"*) echo "101 (chrome) S 1 2 3" ;;
  "shell echo @meminfo"*) cat "$ADB_RESOURCES" ;;
  "shell pidof com.android.chrome") echo 4242 ;;
esac
"""
RESOURCES = """@meminfo
MemTotal:       11534336 kB
MemFree:          512000 kB
MemAvailable:    4194304 kB
Cached:          2097152 kB
SwapTotal:       8388608 kB
SwapFree:        6291456 kB
@psi
some avg10=0.50 avg60=0.20 avg300=0.10 total=12345
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
@vmstat
pswpin 100
pswpout 200
pgmajfault 300
@thermal
Thermal Status: 1
\tTemperature{mValue=31.5, mType=3, mName=SKIN, mStatus=0}
\tTemperature{mValue=40.25, mType=0, mName=AP, mStatus=0}
@chrome
Name:\tcom.android.chrome VmRSS:\t  307200 kB VmSwap:\t   10240 kB 
@top
  RSS NAME
 1572864 com.android.chrome:sandboxed_process0
"""


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def head() -> str:
    return subprocess.run(["git", "-C", str(HERE), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()


class Rig:
    def __init__(self, d: Path, commit: str, loads_per_block=(2, 2), dead=(), silent=(), exits=(), gapS=0, budgetsS=None, same=()):
        self.d = d
        bindir = d / "bin"
        bindir.mkdir()
        (bindir / "adb").write_text(FAKE_ADB)
        (bindir / "adb").chmod(0o755)
        self.adb_log = d / "adb.log"
        (d / "adb.state").write_text("3\n")
        (d / "resources.txt").write_text(RESOURCES)
        self.env = {**os.environ, "PATH": f"{bindir}:{os.environ['PATH']}", "ADB_LOG": str(self.adb_log), "ADB_STATE": str(d / "adb.state"),
                    "ADB_RESOURCES": str(d / "resources.txt")}
        blocks = []
        for b, n in enumerate(loads_per_block):
            port = free_port()
            server = {"cmd": [sys.executable, "-m", "http.server", "--bind", "127.0.0.1", str(port)], "ready": f"http://127.0.0.1:{port}/"}
            if b in dead:
                server = {"cmd": [sys.executable, "-c", "import time; time.sleep(60)"], "ready": f"http://127.0.0.1:{port}/", "readyS": 1}
            if b in silent:
                server = {"cmd": [sys.executable, "-u", "-c", "import time; print('starting'); time.sleep(60)"], "readyLine": "transport=", "readyS": 1}
            if b in exits:
                server = {"cmd": [sys.executable, "-c", "print('starting')"], "readyLine": "transport=", "readyS": 30}
            loads = [{"url": f"http://127.0.0.1:{port}/?overlay=1&view=page&beacon=cubic-restart", "cell": "2", "arm": "A", "press": "lossless"} for _ in range(n)]
            for k in same:
                loads[k]["sameRenderer"] = True
            blocks.append({"name": f"b{b}", "servers": [server], "loads": loads, **({"rebootAfter": True} if b == 0 else {})})
        self.plan = d / "plan.json"
        self.plan.write_text(json.dumps({"commit": commit, "gapS": gapS, "fillS": 30, "blocks": blocks, **({"budgetsS": budgetsS} if budgetsS else {})}))
        self.port = free_port()
        self.out = d / "out"

    def start(self, *flags: str):
        self.proc = subprocess.Popen([sys.executable, str(SCRIPT), str(self.plan), str(self.out), "--bind", "127.0.0.1", "--port", str(self.port),
                                      "--tree", str(HERE), *flags], env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
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

    def walk(self, loadS=0):
        """Start pressed, then each load's page asking for the next after `loadS`, as the viewer's hook does; the URLs given."""
        urls = []
        status, to, _ = self.rig.get("/next")
        while status == 302:
            urls.append(to)
            time.sleep(loadS)
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

    def test_a_resource_snapshot_before_the_press_and_after_each_load(self):
        """By default resources.jsonl holds one snapshot at the start and one after each load, each parsed from the phone's own counters."""
        self.rig = Rig(self.d, head())
        self.rig.start()
        self.walk()
        snaps = [json.loads(line) for line in (self.rig.out / "resources.jsonl").read_text().splitlines()]
        self.assertEqual([s["label"] for s in snaps], ["start", "after-0", "after-1", "after-2", "after-3"])
        got = {k: snaps[0][k] for k in ("memTotalMiB", "memFreeMiB", "memAvailableMiB", "cachedMiB", "swapUsedMiB", "pswpin", "pswpout",
                                        "pgmajfault", "thermalStatus", "skinC", "apC", "batC", "chrome", "top")}
        self.assertEqual(got, {"memTotalMiB": 11264, "memFreeMiB": 500, "memAvailableMiB": 4096, "cachedMiB": 2048, "swapUsedMiB": 2048,
                               "pswpin": 100, "pswpout": 200, "pgmajfault": 300, "thermalStatus": 1, "skinC": 31.5, "apC": 40.25, "batC": None,
                               "chrome": [{"name": "com.android.chrome", "rssMiB": 300, "swapMiB": 10}],
                               "top": [{"rssMiB": 1536, "name": "com.android.chrome:sandboxed_process0"}]})
        self.assertEqual(len(snaps[0]["psiMemory"]), 2)

    def test_no_resources_takes_no_snapshot(self):
        """--no-resources: no resources.jsonl and no snapshot adb call."""
        self.rig = Rig(self.d, head())
        self.rig.start("--no-resources")
        self.walk()
        self.assertFalse((self.rig.out / "resources.jsonl").exists())
        self.assertFalse(any("@meminfo" in c for c in self.rig.adb_calls()))

    def test_fresh_chrome_relaunches_once_the_verdict_is_in_and_skips_without_it(self):
        """--fresh-chrome: after a load whose verdict is in the beacon, a blank tab, a force-stop and Chrome on /next?after=k, in the gap
        before the next load opens; a load with no verdict gets no relaunch, recorded with why; none after the last load."""
        self.rig = Rig(self.d, head(), loads_per_block=(3,))
        beacon = self.d / "beacon.jsonl"
        beacon.write_text("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in
                                  [{"step": 0, "kind": "verdict", "ok": True}, {"step": 1, "kind": "fill"}, {"step": 2, "kind": "verdict"}]))
        self.rig.start("--fresh-chrome", "--beacon", str(beacon))
        self.walk()
        events = [e for e in self.rig.events() if e["event"] in ("load opened", "load ended", "relaunch", "relaunch skipped")]
        self.assertEqual([(e["event"], e.get("load", e.get("after"))) for e in events],
                         [("load opened", 0), ("load ended", 0), ("relaunch", 0), ("load opened", 1), ("load ended", 1), ("relaunch skipped", 1),
                          ("load opened", 2), ("load ended", 2)])
        self.assertEqual(events[2]["pid"], "4242")
        self.assertEqual(events[5]["why"], "no verdict within 8 s of load ended")
        am = [c for c in self.rig.adb_calls() if " am " in f" {c} " or c.startswith("shell pidof")]
        same_tab = "-e com.android.browser.application_id wtpacs.round com.android.chrome"
        self.assertEqual(am, [f"shell am start -a android.intent.action.VIEW -d about:blank {same_tab}",
                              "shell am force-stop com.android.chrome",
                              f"shell am start -a android.intent.action.VIEW -d http://127.0.0.1:{self.rig.port}/next?after=0 {same_tab}",
                              "shell pidof com.android.chrome"])

    def test_a_load_marked_same_renderer_gets_no_relaunch_before_it(self):
        """--fresh-chrome skips the relaunch before a load marked `sameRenderer` (round-2.md's cell M), and only there."""
        self.rig = Rig(self.d, head(), loads_per_block=(3,), same=(1,))
        beacon = self.d / "beacon.jsonl"
        beacon.write_text("".join(json.dumps({"step": k, "kind": "verdict", "ok": True}) + "\n" for k in range(3)))
        self.rig.start("--fresh-chrome", "--beacon", str(beacon))
        self.walk()
        events = [e for e in self.rig.events() if e["event"] in ("load opened", "relaunch", "relaunch skipped")]
        self.assertEqual([(e["event"], e.get("load", e.get("after"))) for e in events],
                         [("load opened", 0), ("load opened", 1), ("relaunch", 1), ("load opened", 2)])

    def test_fresh_chrome_without_a_beacon_is_refused(self):
        """--fresh-chrome needs the beacon its gate reads: refused before any adb call."""
        self.rig = Rig(self.d, head())
        proc = self.rig.start("--fresh-chrome")
        _, err = proc.communicate(timeout=30)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("--fresh-chrome needs --beacon", err)
        self.assertEqual(self.rig.adb_calls(), [])

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

    def test_a_block_whose_server_never_answers_fails_its_loads_and_the_round_goes_on(self):
        """Block 1's server never answers: the host failure and each of its loads are recorded as failed by name, and block 2 runs."""
        self.rig = Rig(self.d, head(), loads_per_block=(1, 2, 1), dead={1})
        self.rig.start()
        urls = self.walk()
        self.assertEqual([int(parse_qs(urlsplit(u).query)["at"][0]) for u in urls], [0, 3])
        events = self.rig.events()
        self.assertEqual([e["block"] for e in events if e["event"] == "host failed"], [1])
        failed = [e for e in events if e["event"] == "load failed"]
        self.assertEqual([e["load"] for e in failed], [1, 2])
        self.assertTrue(all("no answer from" in e["why"] for e in failed))
        self.assertEqual([e["load"] for e in events if e["event"] == "load opened"], [0, 3])

    def test_a_block_whose_server_never_prints_its_ready_line_fails_its_loads_and_the_round_goes_on(self):
        """Block 1's server prints, but never its `readyLine`, within `readyS`: its loads fail by name and block 2 runs."""
        self.rig = Rig(self.d, head(), loads_per_block=(1, 2, 1), silent={1})
        self.rig.start()
        t0 = time.monotonic()
        urls = self.walk()
        self.assertLess(time.monotonic() - t0, 20)
        self.assertEqual([int(parse_qs(urlsplit(u).query)["at"][0]) for u in urls], [0, 3])
        events = self.rig.events()
        self.assertEqual([e["block"] for e in events if e["event"] == "host failed"], [1])
        failed = [e for e in events if e["event"] == "load failed"]
        self.assertEqual([e["load"] for e in failed], [1, 2])
        self.assertTrue(all("transport=" in e["why"] for e in failed))

    def test_a_server_that_exits_before_its_ready_line_fails_its_block_at_once(self):
        """Block 1's server exits without its `readyLine`, `readyS` 30: its load fails as exited, well before the deadline."""
        self.rig = Rig(self.d, head(), loads_per_block=(1, 1, 1), exits={1})
        self.rig.start()
        t0 = time.monotonic()
        self.assertEqual(len(self.walk()), 2)
        self.assertLess(time.monotonic() - t0, 20)
        failed = [e for e in self.rig.events() if e["event"] == "load failed"]
        self.assertEqual([e["load"] for e in failed], [1])
        self.assertIn("exited before printing", failed[0]["why"])

    def test_asked_again_after_a_failed_block_reads_and_reboots_once(self):
        """The ask after a load whose next block fails, repeated: one set of after-reads, one reboot, the same answer."""
        self.rig = Rig(self.d, head(), loads_per_block=(1, 1, 1), dead={1})
        self.rig.start()
        self.rig.get("/next")
        a = self.rig.get("/next?after=0")
        b = self.rig.get("/next?after=0")
        self.assertEqual(a, b)
        calls = self.rig.adb_calls()
        self.assertEqual(calls.count("reboot"), 1)
        self.assertEqual(sum(c == "logcat -d" for c in calls), 2)
        self.assertEqual([e["event"] for e in self.rig.events()].count("load ended"), 1)

    def test_a_cell_budget_stops_only_loads_not_started(self):
        """Budget 0.5 s for cell 2, loads of 0.3 s: loads 0 and 1 run (1 past the bar, still whole), 2 and 3 are recorded not started."""
        self.rig = Rig(self.d, head(), loads_per_block=(4,), budgetsS={"2": 0.5})
        self.rig.start()
        urls = self.walk(loadS=0.3)
        self.assertEqual([int(parse_qs(urlsplit(u).query)["at"][0]) for u in urls], [0, 1])
        events = self.rig.events()
        self.assertEqual([(e["load"], e["why"]) for e in events if e["event"] == "not started"], [(2, "budget"), (3, "budget")])
        self.assertEqual([e["load"] for e in events if e["event"] == "load ended"], [0, 1])

    def test_time_between_loads_counts_toward_no_budget(self):
        """A 0.4 s gap between loads of ~0.1 s under a 0.5 s budget: every load runs, and no load's open-to-end span holds the gap."""
        self.rig = Rig(self.d, head(), loads_per_block=(4,), gapS=0.4, budgetsS={"2": 0.5})
        self.rig.start()
        self.assertEqual(len(self.walk(loadS=0.05)), 4)
        events = self.rig.events()
        opened = {e["load"]: e["at"] for e in events if e["event"] == "load opened"}
        spans = [e["at"] - opened[e["load"]] for e in events if e["event"] == "load ended"]
        self.assertTrue(all(s < 300 for s in spans), spans)


WIFI_INFO = (  # ClientModeImpl's dump of WifiInfo.toString(), AOSP Wifi 10246c5a; made-up values
    "mWifiInfo SSID: \"HomeNet-42\", BSSID: 3c:84:6a:11:22:33, MAC: 02:00:00:00:00:00, IP: /192.168.1.23, "
    "Security type: 2, Supplicant state: COMPLETED, Wi-Fi standard: 11ax, RSSI: -48, Link speed: 1201Mbps, "
    "Tx Link speed: 1201Mbps, Max Supported Tx Link speed: 2401Mbps, Rx Link speed: 960Mbps, "
    "Max Supported Rx Link speed: 2401Mbps, Frequency: 5180MHz, Net ID: 3, Metered hint: false, score: 60\n"
)
LOGCAT = (
    "11-21 19:02:11.120  4021  4090 I CCodec  : allocated component c2.exynos.av1.decoder\n"
    "11-21 19:02:11.300  1500  1600 I AccountManager: account someone@example.org signed in\n"
    "11-21 19:02:12.000  4021  4090 D MediaCodec: [OMX.google.vp9.decoder] configured, SSID HomeNet-42\n"
)


class RawRows(unittest.TestCase):
    """The commit step's copy (docs/devices.md §4): only what a cell reads, the laptop and the phone stripped, and a refusal if a MAC or an SSID is left."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.src = self.d / "target"
        (self.src / "round" / "out" / "adb").mkdir(parents=True)
        (self.src / "round-wifi-before.txt").write_text(WIFI_INFO)
        (self.src / "round" / "out" / "adb" / "003-after.logcat.txt").write_text(LOGCAT)
        (self.src / "round" / "t-4433.json").write_text('{"wt_url": "https://10.1.2.3:4433/"}')
        (self.src / "round" / "out" / "round.jsonl").write_text('{"event": "adb", "args": ["-s", "R5CT10ABCDE"]}\n')
        self.dest = self.d / "raw"

    def tearDown(self):
        self.tmp.cleanup()

    def publish(self, *extra):
        return subprocess.run([sys.executable, str(RAW), str(self.dest), str(self.src / "round"), str(self.src / "round-wifi-before.txt"),
                               "--strip", "10.1.2.3=LAPTOP", "--strip", "R5CT10ABCDE=PHONE", *extra], capture_output=True, text=True)

    def test_wifi_keeps_band_frequency_rssi_and_link_speeds_only(self):
        """The mWifiInfo line becomes its band, frequency, RSSI and link speeds; the SSID, BSSID, MAC and IP never leave."""
        self.assertEqual(self.publish().returncode, 0)
        kept = (self.dest / "round-wifi-before.txt").read_text()
        self.assertEqual(kept, "band: 5 GHz, Wi-Fi standard: 11ax, RSSI: -48, Link speed: 1201Mbps, Tx Link speed: 1201Mbps, "
                               "Rx Link speed: 960Mbps, Frequency: 5180MHz\n")

    def test_logcat_keeps_codec_components_only(self):
        """A logcat buffer becomes the codec components it names, one per line; every other line stays on the laptop."""
        self.assertEqual(self.publish().returncode, 0)
        self.assertEqual((self.dest / "round" / "out" / "adb" / "003-after.logcat.txt").read_text(),
                         "c2.exynos.av1.decoder\nOMX.google.vp9.decoder\n")

    def test_the_laptop_and_the_phone_are_stripped(self):
        """The dial address and the serial are replaced by their names in every file copied."""
        self.assertEqual(self.publish().returncode, 0)
        self.assertIn("https://LAPTOP:4433/", (self.dest / "round" / "t-4433.json").read_text())
        self.assertIn('"PHONE"', (self.dest / "round" / "out" / "round.jsonl").read_text())

    def test_a_mac_or_an_ssid_left_refuses_the_copy(self):
        """A MAC-shaped string or an SSID anywhere after the filters: exit 1 naming the file, and nothing left in DEST."""
        for leak in ("ap 3c:84:6a:11:22:33 seen", "SSID: HomeNet-42"):
            with self.subTest(leak=leak):
                (self.src / "round" / "notes.txt").write_text(leak + "\n")
                run = self.publish()
                self.assertEqual(run.returncode, 1, run.stderr)
                self.assertIn("notes.txt", run.stderr)
                self.assertFalse(self.dest.exists())

    def test_an_empty_strip_value_is_refused(self):
        """An unset LAPTOP_IP gives "--strip =LAPTOP": refused before anything is copied."""
        run = self.publish("--strip", "=LAPTOP")
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertFalse(self.dest.exists())


if __name__ == "__main__":
    unittest.main()
