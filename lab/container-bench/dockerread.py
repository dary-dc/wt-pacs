#!/usr/bin/env python3
"""Row 195 DOCKERREAD: the shipped read path on the host, in a bind mount, a named volume and a container's own layer.
The protocol is docs/adr/disk-access.md §6; README.md §In a container (row 195) runs it.

    dockerread.py data   WORK                 the cells' coded frames, made in the `data` image
    dockerread.py place  WORK                 every arm's files, containers and volume; SHA-256 against H's
    dockerread.py check  WORK                 untimed: which reader runs, and the settings and limits, per arm
    dockerread.py time   WORK ROUNDS [--asks N] [--fill-mib N] [--out NAME]   timed visits, one JSON line a cell
    dockerread.py folios WORK LABEL           as root: page-cache folios of every arm's file, into WORK/folios-LABEL.jsonl

The arms are dockerread-arms.json, one entry an arm: its name; how its series is placed (`host` and `bind` by
pack-series on the host into WORK/arms/NAME, `volume` by a container of uid 10001, `layer` inside its own container);
its container's `podman run` options, none for the host; and where its reader finds the series. The first arm is the
reference every file's SHA-256 must equal, and each round's order is the Williams row for the arms' count.
"""
import argparse
import json
import re
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lab/scripts"))
from order import order  # noqa: E402

ARMS = json.loads((Path(__file__).parent / "dockerread-arms.json").read_text())
SPEC = {a["name"]: a for a in ARMS}
REF = ARMS[0]["name"]
SETS = ["pt15_cptac", "ct_lidc", "dbt12_ea1141"]
CELLS = [(s, "pack") for s in SETS] + [("dbt12_ea1141", "willneed")]
RIG, DATA = "localhost/wt-pacs-dockerread-rig", "localhost/wt-pacs-dockerread-data"
BINARIES = ["container_bench", "writer_bench", "pack-series", "check-fastpath", "server_ab", "series-server"]
NICE = ["nice", "-n", "19", "ionice", "-c3"]
PIN = ["taskset", "-c", "2,3"]
BUILD_CPUS = ["--cpu-period", "100000", "--cpu-quota", "200000"]
OTHERS_BUSY_BAR = 0.05


def sh(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], check=True, capture_output=True, text=True, **kw).stdout


def name(set_, state):
    return f"{set_}.sbnd" if state == "pack" else f"{set_}-willneed.sbnd"


def container(arm):
    return f"wtpacs-dr-{arm}" if "run" in SPEC[arm] else None


def in_arm(arm, cmd, pin=False):
    """`cmd` as the arm runs it: on the host, or `podman exec` in the arm's container; niced, and pinned if asked,
    on both sides."""
    wrap = [*NICE, *(PIN if pin else [])]
    return [*wrap, "podman", "exec", container(arm), *wrap, *cmd] if container(arm) else [*wrap, *cmd]


def as_owner(arm, cmd):
    """`cmd` with the rights of the arm's files' owner: a volume's and a layer's belong to subuids."""
    return ["podman", "unshare", *cmd] if SPEC[arm]["place"] in ("volume", "layer") else cmd


def series_dir(work, arm):
    """Where the arm's reader finds the series."""
    return SPEC[arm].get("series", str(work / "arms" / arm))


def real_dir(work, arm):
    """The same directory on the host: the volume's `_data`, O's upper dir."""
    spec = SPEC[arm]
    if spec["place"] == "volume":
        return Path(sh(["podman", "volume", "inspect", "-f", "{{.Mountpoint}}", spec["volume"]]).strip())
    if spec["place"] == "layer":
        upper = sh(["podman", "inspect", "-f", "{{.GraphDriver.Data.UpperDir}}", container(arm)]).strip()
        return Path(upper + spec["series"])
    return work / "arms" / arm


def bench(work, arm, binary):
    return binary if container(arm) else str(work / "bin" / binary)


def coded(work, arm, set_):
    return f"/srv/coded/{set_}" if container(arm) else str(work / "coded" / set_ / "htj2k")


def data(work):
    """Tools, fetch and ingest as lab/container-bench/README.md runs them, inside the pinned `data` image."""
    (ROOT / "lab/.openjph-build").mkdir(exist_ok=True)
    (work / "openjph-build").mkdir(parents=True, exist_ok=True)
    steps = [
        "BUILD=/data/av1-build lab/av1/tools/tools.sh aom dav1d",
        "VENV=/data/venv OUT=/data/av1-data lab/av1/fetch_data.sh " + " ".join(SETS),
        "PATH=/data/venv/bin:$PATH BUILD=/src/lab/.openjph-build OUT_ROOT=/tmp/fx FRAMES=1 lab/scripts/gen_htj2k_fixtures.sh g160",
        "BUILD=/data/av1-build ingest/coded-frames/build.sh",
        *(f"/data/venv/bin/python ingest/coded-frames/ingest.py /data/av1-build /data/av1-data/{s} /data/coded/{s}/htj2k"
          " --codec htj2k --jobs 2" for s in SETS),
    ]
    subprocess.run([*NICE, "podman", "run", "--rm", *BUILD_CPUS, "--security-opt", "label=disable",
                    "-v", f"{ROOT}:/src:ro", "-v", f"{work}:/data", "-v", f"{work}/openjph-build:/src/lab/.openjph-build",
                    "-w", "/src", DATA, "bash", "-euxc", " && ".join(steps)], check=True)


def start_container(work, arm):
    """Only the entrypoint is overridden, so the container stays up; the coded frames go to its own layer."""
    run = [o.format(work=work) for o in SPEC[arm]["run"]]
    sh(["podman", "run", "-d", "--name", container(arm), *run, "--entrypoint", "sleep", RIG, "infinity"])
    for s in SETS:
        sh(["podman", "cp", work / "coded" / s / "htj2k", f"{container(arm)}:/srv/coded/{s}"])


def pack_cmd(binary, frames, out):
    return [binary, "--metadata", f"{frames}/metadata.json", "--frames", frames, "--output", out]


def place(work):
    """Every arm packed as its entry says; then its WILLNEED copy, written past the page cache from the host side and
    warmed through the arm's own path."""
    (work / "bin").mkdir(exist_ok=True)
    sh(["podman", "create", "--name", "wtpacs-dr-copy", RIG])
    for b in BINARIES:
        sh(["podman", "cp", f"wtpacs-dr-copy:/usr/local/bin/{b}", work / "bin" / b])
    sh(["podman", "rm", "wtpacs-dr-copy"])
    for a in ARMS:
        arm, how = a["name"], a["place"]
        if how in ("host", "bind"):
            (work / "arms" / arm).mkdir(parents=True, exist_ok=True)
            for s in SETS:
                sh([*NICE, *pack_cmd(work / "bin/pack-series", work / "coded" / s / "htj2k", work / "arms" / arm / name(s, "pack"))])
        if how == "volume":
            sh(["podman", "volume", "create", a["volume"]])
            packs = " && ".join(" ".join(pack_cmd("pack-series", f"/coded/{s}/htj2k", f"/out/{name(s, 'pack')}")) for s in SETS)
            sh([*NICE, "podman", "run", "--rm", "-v", f"{a['volume']}:/out", "-v", f"{work}/coded:/coded:ro,z",
                "--entrypoint", "sh", RIG, "-c", packs])
        if container(arm):
            start_container(work, arm)
        if how == "layer":
            for s in SETS:
                sh(in_arm(arm, pack_cmd("pack-series", f"/srv/coded/{s}", f"{a['series']}/{name(s, 'pack')}")))

    rows = []
    for arm in SPEC:
        real = real_dir(work, arm)
        src, out = real / name("dbt12_ea1141", "pack"), real / name("dbt12_ea1141", "willneed")
        sh([*NICE, *as_owner(arm, [work / "bin/writer_bench", "direct", "--src", src, "--out", out])])
        cached = json.loads(sh(as_owner(arm, [work / "bin/writer_bench", "resident", "--file", out])))["resident"]
        inside = f"{series_dir(work, arm)}/{out.name}"
        warm = subprocess.run([str(c) for c in in_arm(arm, [bench(work, arm, "writer_bench"), "warm", "--how", "willneed",
                                                            "--file", inside])], check=True, capture_output=True, text=True)
        for s, state in CELLS:
            f = name(s, state)
            digest = sh(in_arm(arm, ["sha256sum", f"{series_dir(work, arm)}/{f}"])).split()[0]
            rows.append(dict(arm=arm, file=f, real=str(real / f), inside=f"{series_dir(work, arm)}/{f}", sha256=digest,
                             cached_after_direct=cached if state == "willneed" else None,
                             warm=warm.stderr.strip() if state == "willneed" else None))
    void = sha_guard(rows)
    with (work / "place.jsonl").open("w") as out:
        for r in rows:
            out.write(json.dumps(r) + "\n")
    (work / "folio-paths.txt").write_text("".join(f"{r['arm']}\t{r['file']}\t{r['real']}\n" for r in rows))
    for r in rows:
        print(r["arm"], r["file"], r["sha256"][:16], "VOID" if (r["arm"], r["file"]) in void else "",
              "" if r["cached_after_direct"] is None else f"cached after direct {r['cached_after_direct']}")
    if void:
        sys.exit(f"{len(void)} file(s) differ from {REF}'s: those arms are void")


def sha_guard(rows):
    """(arm, file) of every file whose SHA-256 is not the reference arm's."""
    want = {r["file"]: r["sha256"] for r in rows if r["arm"] == REF}
    return {(r["arm"], r["file"]) for r in rows if r["sha256"] != want[r["file"]]}


def run_text(cmd):
    res = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    return f"$ {' '.join(map(str, cmd))}  (exit {res.returncode})\n{res.stdout}{res.stderr}"


def settings(work, arm):
    """What the protocol prints per arm: the container's settings, its limits and the mount under the series."""
    real = real_dir(work, arm)
    out = []
    if container(arm):
        fields = "User={{json .Config.User}} SecurityOpt={{json .HostConfig.SecurityOpt}} " \
                 "Ulimits={{json .HostConfig.Ulimits}} CapAdd={{json .HostConfig.CapAdd}} " \
                 "Cgroup={{json .HostConfig.Cgroup}} CgroupParent={{json .HostConfig.CgroupParent}} " \
                 "CgroupMode={{json .HostConfig.CgroupMode}} CgroupManager={{json .HostConfig.CgroupManager}} Mounts={{json .Mounts}}"
        out.append(run_text(["podman", "inspect", "-f", fields, container(arm)]))
    for cmd in (["cat", "/proc/self/limits"], ["grep", "-E", "^(Seccomp|CapEff):", "/proc/self/status"],
                ["cat", "/proc/self/cgroup"], ["findmnt", "-T", series_dir(work, arm)], ["ls", "-ln", series_dir(work, arm)]):
        out.append(run_text(in_arm(arm, cmd)))
    out.append(run_text(["findmnt", "-T", real]))
    out.append(run_text(["sh", "-c", "for f in /sys/class/bdi/*/read_ahead_kb; do echo \"$f $(cat $f)\"; done"]))
    return "".join(out)


def versions():
    return "".join(run_text(c) for c in (["uname", "-r"], ["podman", "--version"], ["crun", "--version"],
                                         ["rpm", "-q", "containers-common", "crun", "podman"],
                                         ["podman", "info", "-f", "seccomp {{.Host.Security.SECCOMPProfilePath}}"]))


def serve_once(work, arm, series):
    """The image's server on `series`, one tile session at depth 4 from `server_ab` beside it; the server's log."""
    inside = container(arm)
    certs = "/certs" if inside else str(work / "certs")
    log = "/tmp/dockerread-server.log" if inside else str(work / "logs" / f"check-server-{arm}.log")
    pid = "/tmp/dockerread-server.pid" if inside else str(work / "logs" / f"check-server-{arm}.pid")
    Path(work / "logs").mkdir(exist_ok=True)
    if not inside:
        Path(certs).mkdir(exist_ok=True)
    sh(in_arm(arm, ["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                    "-keyout", f"{certs}/key.pem", "-out", f"{certs}/cert.pem", "-days", "10", "-nodes",
                    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]))
    server = f"echo $$ > {pid}; exec {bench(work, arm, 'series-server')} --series {series} " \
             f"--cert-pem {certs}/cert.pem --key-pem {certs}/key.pem > {log} 2>&1"
    detach = [*NICE, "podman", "exec", "-d", inside, "sh", "-c", server] if inside else None
    proc = subprocess.Popen(detach or [*NICE, "sh", "-c", server])
    for _ in range(100):
        time.sleep(0.1)
        text = sh(in_arm(arm, ["sh", "-c", f"cat {log} 2>/dev/null || true"]))
        if "read_fast_path=" in text:
            break
    frames = int(next(ln.split("=")[1] for ln in text.splitlines() if ln.startswith("frames=")))
    session = run_text(in_arm(arm, [bench(work, arm, "server_ab"), "--url", "https://127.0.0.1:4433/", "--mode",
                                    "on-demand", "--depth", "4", "--asks", str(frames), "--frames", str(frames),
                                    "--label", f"check-{arm}"]))
    time.sleep(1)
    sh(in_arm(arm, ["sh", "-c", f"kill $(cat {pid})"]))
    proc.wait()
    return session, sh(in_arm(arm, ["cat", log]))


def reader(log):
    """`read_fast_path=`, the session's `ring=` and tile misses, and any io_uring WARN, from the server's log."""
    log = re.sub(r"\x1b\[[0-9;]*m", "", log)
    fast = next((ln.split("=", 1)[1] for ln in log.splitlines() if ln.startswith("read_fast_path=")), None)
    session = next((ln for ln in log.splitlines() if "session reads hits=" in ln), "")
    field = lambda k: next((w.split("=", 1)[1] for w in session.split() if w.startswith(k + "=")), None)  # noqa: E731
    warns = [ln for ln in log.splitlines() if "io_uring unavailable" in ln]
    return dict(read_fast_path=fast, ring=field("ring"), tile_misses=field("tile_misses"), uring_warn=warns)


def check(work):
    report = [versions()]
    rows = []
    for arm in SPEC:
        real = real_dir(work, arm)
        series = f"{series_dir(work, arm)}/{name('dbt12_ea1141', 'pack')}"
        fastpath = run_text(in_arm(arm, [bench(work, arm, "check-fastpath"), series]))
        fresh = real / "fresh.sbnd"
        sh([*NICE, *as_owner(arm, [work / "bin/writer_bench", "direct", "--src", real / name("dbt12_ea1141", "pack"),
                                  "--out", fresh])])
        cached = json.loads(sh(as_owner(arm, [work / "bin/writer_bench", "resident", "--file", fresh])))["resident"]
        session, log = serve_once(work, arm, f"{series_dir(work, arm)}/fresh.sbnd")
        sh(as_owner(arm, ["rm", "-f", fresh]))
        row = dict(arm=arm, fastpath_exit=fastpath.split("(exit ")[1].split(")")[0], fresh_cached=cached, **reader(log))
        rows.append(row)
        report += [f"\n===== {arm} =====\n", settings(work, arm), fastpath, session, log, json.dumps(row) + "\n"]
    (work / "check.txt").write_text("".join(report))
    (work / "check.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    for r in rows:
        print(json.dumps(r))


def void(row):
    """The protocol's VOID: the pinned cores busy outside the bench, or a hit pass that missed. A store whose
    `RWF_NOWAIT` is refused pools every read by construction, so only a store that has the flag can miss."""
    busy = row["others_busy_frac"] > OTHERS_BUSY_BAR
    missed = row["nowait"] and (row["tile_hit_misses"] > 0 or row["fill_hit_misses"] > 0)
    return [w for w, bad in (("busy", busy), ("miss", missed)) if bad]


def time_rounds(work, rounds, asks, fill_mib, out_name):
    out = (work / out_name).open("a")
    voids = total = 0
    for r in range(rounds):
        prev = None
        for arm in order(list(SPEC), r):
            for s, state in CELLS:
                cmd = in_arm(arm, [bench(work, arm, "container_bench"), "measure", "--container", "sbnd1",
                                   "--file", f"{series_dir(work, arm)}/{name(s, state)}", "--frames", coded(work, arm, s),
                                   "--round", r, "--asks", asks, "--fill-bytes", fill_mib << 20, "--pooled-ok"], pin=True)
                res = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
                if res.returncode:
                    sys.exit(f"{arm} {s} {state} round {r}: {res.stderr[-800:]}")
                row = json.loads(res.stdout)
                row.update(round=r, arm=arm, set=s, state=state, prev=prev, asks_set=asks, fill_mib=fill_mib,
                           void=void(row), at=time.time(), file=name(s, state), out=out_name)
                out.write(json.dumps(row) + "\n")
                out.flush()
                voids += bool(row["void"])
                total += 1
            prev = arm
        print(f"round {r} done {time.strftime('%H:%M:%S')}, {voids} of {total} visits void", flush=True)


def folio_count(wb, real, mutate=False):
    res = subprocess.run([*NICE, wb, "folios", "--file", real, *(["--mutate"] if mutate else [])],
                         capture_output=True, text=True)
    return res.returncode, res.stdout, res.stderr.strip()


def folios(work, label):
    """Every arm's file through writer_bench folios, which needs root in the initial namespace for /proc/kpageflags."""
    wb = work / "bin/writer_bench"
    lines = [ln.split("\t") for ln in (work / "folio-paths.txt").read_text().splitlines()]
    path = work / f"folios-{label}.jsonl"
    rows = []
    for arm, f, real in lines:
        code, out, err = folio_count(wb, real)
        if code:
            sys.exit(f"{arm} {f}: {err}")
        rows.append(dict(arm=arm, file=f, real=real, label=label, **json.loads(out)))
    large = next((r for r in rows if any(r["orders"][1:])), None)
    if large is None:
        print("every folio is one page: the --mutate probe has no compound head to break")
    elif folio_count(wb, large["real"], mutate=True)[0] == 0:
        sys.exit("writer_bench folios --mutate passed its layout check: the instrument is broken")
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    if "SUDO_UID" in os.environ:
        os.chown(path, int(os.environ["SUDO_UID"]), int(os.environ["SUDO_GID"]))
    h = {r["file"]: r["folios_per_frame"] for r in rows if r["arm"] == REF}
    before = {}
    if label != "before" and (work / "folios-before.jsonl").exists():
        for ln in (work / "folios-before.jsonl").read_text().splitlines():
            b = json.loads(ln)
            before[(b["arm"], b["file"])] = b["per_frame_digest"]
    for r in rows:
        ratio = r["folios_per_frame"] / h[r["file"]]
        same = before.get((r["arm"], r["file"]))
        print(f"{r['arm']:3} {r['file']:28} {r['folios_per_frame']:8.2f} folios a frame  ×{ratio:.2f} of {REF}"
              f"{'' if abs(ratio - 1) <= 0.2 else '  OUTSIDE 20 %'}"
              f"{'' if same is None else ('  unchanged' if same == r['per_frame_digest'] else '  CHANGED since before')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["data", "place", "check", "time", "folios"])
    ap.add_argument("work", type=Path)
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--asks", type=int, default=4000)
    ap.add_argument("--fill-mib", type=int, default=256)
    ap.add_argument("--out", default="time.jsonl")
    a = ap.parse_args()
    work = a.work.resolve()
    if a.cmd == "time":
        time_rounds(work, int(a.arg), a.asks, a.fill_mib, a.out)
    elif a.cmd == "folios":
        folios(work, a.arg)
    else:
        {"data": data, "place": place, "check": check}[a.cmd](work)


if __name__ == "__main__":
    main()
