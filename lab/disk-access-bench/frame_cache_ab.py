#!/usr/bin/env python3
"""Row 209's campaign: the lab frame cache (B1) and glibc's hugetlb tunable (B2) against the server as it ships
(B0, B0′) — docs/adr/disk-access.md §Protocol for the measuring row has the arms, the rule and the numbers.

    frame_cache_ab.py make   WORK          each set's .sbnd, and the synthetic 3 MB series
    frame_cache_ab.py verify WORK          every arm's third fill checked by XXH3-64 and decoded against ingest's digests
    frame_cache_ab.py mutate WORK          B1 handing back a stale entry must fail the XXH3-64 check
    frame_cache_ab.py time   WORK ROUNDS   one JSON line a run into WORK/frame_cache.jsonl
    frame_cache_ab.py summary JSONL

WORK/coded/SET/htj2k is ingest's output (ingest/coded-frames/ingest.py); WORK/bin/b0 is the default release
build of series-server, WORK/bin/b1 the same with `--features lab-frame-cache`.
"""
import json
import os
import platform
import random
import shutil
import socket
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lab/scripts"))
from order import order  # noqa: E402

SERVER_AB = ROOT / "target/release/server_ab"
PACK_SERIES = ROOT / "target/release/pack-series"
SETS = ["pt15_cptac", "ct_lidc", "dbt12_ea1141", "synth3mb"]
SESSIONS = [1, 16]
SERVER_CPUS, CLIENT_CPUS = "0-1", "2-3"
SYNTH_FRAMES, SYNTH_BYTES = 32, 3 * 1000 * 1000
CACHE_BYTES = 4 << 30
ARMS = {
    "B0": ("b0", {}),
    "B0p": ("b0", {}),
    "B1": ("b1", {"LAB_FRAME_CACHE_BYTES": str(CACHE_BYTES)}),
    "B2": ("b0", {"GLIBC_TUNABLES": "glibc.malloc.hugetlb=1"}),
}
SETTINGS = {
    "B0": "series-server default release build, default flags (Cubic with restart, shared stream, uring miss path)",
    "B0p": "B0's binary, a second process (A/A)",
    "B1": f"B0's source with --features lab-frame-cache: lab FrameCache in front of both readers, budget {CACHE_BYTES} B, "
          "admission on a frame's second ask; every other flag as B0",
    "B2": "B0 under GLIBC_TUNABLES=glibc.malloc.hugetlb=1 (3 MB cell only)",
}


def arms_for(name):
    return ["B0", "B0p", "B1", "B2"] if name == "synth3mb" else ["B0", "B0p", "B1"]


def coded(work, name):
    return work / "coded" / name / "htj2k"


def sbnd(work, name):
    return work / "sbnd" / f"{name}.sbnd"


def make(work):
    synth = coded(work, "synth3mb")
    synth.mkdir(parents=True, exist_ok=True)
    rng = random.Random(209)
    for i in range(SYNTH_FRAMES):
        (synth / f"{i:03d}.htj2k").write_bytes(rng.randbytes(SYNTH_BYTES))
    (synth / "metadata.json").write_text(json.dumps({"frameCount": SYNTH_FRAMES, "synthetic": "random bytes, not a codestream"}))
    for name in SETS:
        out = sbnd(work, name)
        out.parent.mkdir(parents=True, exist_ok=True)
        f = coded(work, name)
        subprocess.run([PACK_SERIES, "--metadata", f / "metadata.json", "--frames", f, "--output", out], check=True)
        print(name, out.stat().st_size, flush=True)


def frame_count(work, name):
    return json.loads((coded(work, name) / "metadata.json").read_text())["frameCount"]


class Server:
    def __init__(self, work, name, arm, extra_env=None):
        binary, env = ARMS[arm]
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()
        self.log_path = work / "server.log"
        self.log = open(self.log_path, "w")
        self.proc = subprocess.Popen(
            ["taskset", "-c", SERVER_CPUS, work / "bin" / binary, "--port", str(self.port), "--series", sbnd(work, name),
             "--bind", "127.0.0.1", "--cert-pem", ROOT / "server/dev-cert/cert.pem",
             "--key-pem", ROOT / "server/dev-cert/key.pem"],
            stdout=self.log, stderr=subprocess.STDOUT,
            env={**os.environ, "NO_COLOR": "1", **env, **(extra_env or {})})
        for _ in range(400):
            text = self.log_path.read_text()
            if "telemetry=" in text:
                self.info = dict(l.split("=", 1) for l in text.splitlines() if "=" in l and " " not in l.split("=", 1)[0])
                return
            time.sleep(0.025)
        raise RuntimeError(f"server did not start: {self.log_path.read_text()[-500:]}")

    def rss_kib(self):
        for line in open(f"/proc/{self.proc.pid}/status"):
            if line.startswith("VmRSS"):
                return int(line.split()[1])

    def stop(self):
        self.proc.terminate()
        self.proc.wait()
        self.log.close()


def fill(work, name, server, sessions, label, arm, check=True, dump=None):
    n = frame_count(work, name)
    cmd = ["taskset", "-c", CLIENT_CPUS, SERVER_AB, "--url", f"https://127.0.0.1:{server.port}/",
           "--server-pid", str(server.proc.pid), "--mode", "fill", "--asks", str(n), "--frames", str(n),
           "--sessions", str(sessions), "--label", label, "--variant", arm, "--temp", "warm", "--no-header"]
    if check:
        cmd += ["--coded", coded(work, name)]
    if dump:
        cmd += ["--dump", dump]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        return None, next((l for l in r.stderr.splitlines() if l.startswith("Error")), f"exit {r.returncode}")
    c = r.stdout.split("\t")
    return dict(p50_ns=int(c[6]), wall_ns=int(c[9]), asks_per_s=float(c[10]), cpu_ns_per_frame=int(c[11]),
                rss_peak_delta_kib=int(c[12])), None


def three_fills(work, name, arm, sessions, extra_env=None, dump=None):
    s = Server(work, name, arm, extra_env)
    try:
        out = []
        for p in range(3):
            row, err = fill(work, name, s, sessions, f"pass{p + 1}", arm, dump=dump if p == 2 else None)
            out.append(err or "exact")
        return out
    finally:
        s.stop()


def verify(work):
    sys.path.insert(0, str(ROOT / "ingest/coded-frames"))
    sys.path.insert(0, str(ROOT / "lab/av1"))
    import ingest
    import size
    build = (ROOT / "lab/.av1-build").resolve()
    for name in SETS:
        for arm in arms_for(name):
            dump = work / "dump"
            shutil.rmtree(dump, ignore_errors=True)
            xxh = three_fills(work, name, arm, 1, dump=dump)
            got = sorted(dump.glob("*.bin"))
            inexact = abs(len(got) - frame_count(work, name))
            if name != "synth3mb":
                s = size.Set(work / "data" / name)
                want = json.loads((coded(work, name) / "metadata.json").read_text())["digests"]["frames"]
                for i, g in enumerate(got):
                    px, _ = ingest.decoded(build, "htj2k", g.read_bytes(), s.h * s.w * s.ch)
                    inexact += ingest.frame_digest(px.astype(s.dtype), s.stored > 8) != want[i]
            print(json.dumps(dict(set=name, arm=arm, xxh3=xxh, decoded=len(got) if name != "synth3mb" else "n/a",
                                  inexact=inexact)), flush=True)


def mutate(work):
    for name in SETS:
        for sessions in SESSIONS:
            got = three_fills(work, name, "B1", sessions, {"LAB_FRAME_CACHE_MUTATE": "stale"})
            print(json.dumps(dict(set=name, sessions=sessions, arm="B1 stale", passes=got)), flush=True)


def host(work):
    rd = lambda p: Path(p).read_text().strip() if Path(p).exists() else None
    dev = subprocess.run(["findmnt", "-n", "-o", "SOURCE,FSTYPE", "--target", str(work)], capture_output=True, text=True).stdout.split()
    blk = Path(dev[0]).name if dev else ""
    return dict(kernel=platform.release(), fs=dev[1] if len(dev) > 1 else None,
                read_ahead_kb=rd(f"/sys/block/{blk}/queue/read_ahead_kb"),
                thp=rd("/sys/kernel/mm/transparent_hugepage/enabled"),
                glibc=" ".join(platform.libc_ver()), cpus=os.cpu_count(),
                server_cpus=SERVER_CPUS, client_cpus=CLIENT_CPUS)


def time_rounds(work, rounds):
    out = work / "frame_cache.jsonl"
    with open(out, "a") as f:
        f.write(json.dumps(dict(host=host(work), settings=SETTINGS)) + "\n")
        for name in SETS:
            sbnd(work, name).read_bytes()
        for r in range(rounds):
            for name in SETS:
                for sessions in SESSIONS:
                    arms = arms_for(name)
                    for arm in order(arms, r):
                        s = Server(work, name, arm)
                        try:
                            for p in (1, 2):
                                before = s.rss_kib()
                                row, err = fill(work, name, s, sessions, f"r{r}", arm)
                                time.sleep(0.5)
                                rest = s.rss_kib()
                                rec = dict(round=r, set=name, sessions=sessions, arm=arm, pass_=p, order=order(arms, r),
                                           rss_before_kib=before, rss_rest_kib=rest, error=err, **(row or {}))
                                if row:
                                    rec["rss_peak_kib"] = before + row["rss_peak_delta_kib"]
                                f.write(json.dumps(rec) + "\n")
                                f.flush()
                        finally:
                            s.stop()
            print(f"round {r} done", time.strftime("%H:%M:%S"), flush=True)


def summary(path):
    rows = [json.loads(l) for l in open(path)]
    head = [r for r in rows if "host" in r]
    rows = [r for r in rows if "arm" in r and not r.get("error")]
    if head:
        print(json.dumps(head[-1]["host"]))
    cell = lambda r: (r["set"], r["sessions"], r["pass_"])
    by = {}
    for r in rows:
        by.setdefault(cell(r), {}).setdefault(r["arm"], {})[r["round"]] = r
    print(f"{'set':14}{'sess':>5}{'pass':>5}{'arm':>5}{'n':>4}{'cpu µs/fr':>11}{'ratio':>8}{'lower':>7}{'res':>7}"
          f"{'asks/s':>9}{'ratio':>8}{'peak MiB':>10}{'rest MiB':>10}")
    for key in sorted(by, key=lambda k: (SETS.index(k[0]), k[1], k[2])):
        arms = by[key]
        b0 = arms["B0"]
        aa = [abs(arms["B0p"][rd]["cpu_ns_per_frame"] / b0[rd]["cpu_ns_per_frame"] - 1) for rd in arms["B0p"] if rd in b0]
        res = sorted(aa)[min(len(aa) - 1, int(0.9 * len(aa)))] if aa else float("nan")
        for arm in ["B0", "B0p", "B1", "B2"]:
            if arm not in arms:
                continue
            a = arms[arm]
            common = [rd for rd in a if rd in b0]
            cpu = [a[rd]["cpu_ns_per_frame"] / b0[rd]["cpu_ns_per_frame"] for rd in common]
            aps = [a[rd]["asks_per_s"] / b0[rd]["asks_per_s"] for rd in common]
            med = lambda k: statistics.median(x[k] for x in a.values())
            print(f"{key[0]:14}{key[1]:>5}{key[2]:>5}{arm:>5}{len(a):>4}{med('cpu_ns_per_frame') / 1e3:>11.1f}"
                  f"{statistics.median(cpu):>8.3f}{sum(c < 1 for c in cpu):>4}/{len(cpu):<2}{res * 100:>6.1f}%"
                  f"{med('asks_per_s'):>9.0f}{statistics.median(aps):>8.3f}{med('rss_peak_kib') / 1024:>10.1f}"
                  f"{med('rss_rest_kib') / 1024:>10.1f}")


def main():
    cmd, arg = sys.argv[1], Path(sys.argv[2])
    if cmd == "make":
        make(arg)
    elif cmd == "verify":
        verify(arg)
    elif cmd == "mutate":
        mutate(arg)
    elif cmd == "time":
        time_rounds(arg, int(sys.argv[3]))
    elif cmd == "summary":
        summary(arg)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
