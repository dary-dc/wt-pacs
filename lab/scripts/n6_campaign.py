#!/usr/bin/env python3
"""N6 — WASM vs TypeScript client on one wire (`docs/client-runtime-experiment-plan.md`).

One cell = one (study, link, stream mode, ask cell, depth, schedule). Inside a cell the two
arms are **interleaved** repeat by repeat, and the slot order alternates, so neither arm is
systematically first and drift cancels.

The harvest itself is `server/scripts/verify_e2e.py`, unchanged — this driver only owns the
server and the link, which `verify_e2e.py` hands over as soon as it is given `--wt-url`:

    exact-server (telemetry)  <--  link_shim.py (optional)  <--  Chromium (verify_e2e.py)

Each run gets its own server process and its own server telemetry file, exactly as the local
path in `verify_e2e.py` does, so no run inherits another's warm state.

Three things keep the apparatus from deciding the answer:

* **Page cache warmed, then a discarded warm-up run per arm.** The pilot's first run paid
  877 us of server `prepare_us` against the second run's 108 us — the study file was cold.
  That is the machine, not the arm, and it must not land in the numbers.
* **CPU affinity split.** Server and link on one pair of cores, Chromium on the other. The
  arms burn different amounts of client CPU; without the split, the busier arm slows the
  server it is being measured against.
* **`--arms ts,ts` runs the whole apparatus against itself** — the A/A control. Whatever gap
  that reports is the noise floor any A/B claim has to clear.

    lab/scripts/n6_campaign.py --cell-id local-250k-ondemand \\
        --study lab/fixtures/frames_250k/frames_250k.sbnd --frames 80 \\
        --ask-cell ondemand --depth 1 --n 400 --interval-ms 20 --repeats 6
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MEAS = ROOT / ".local" / "measurements"


def cert_pin(cert: Path) -> str:
    der = subprocess.check_output(["openssl", "x509", "-in", str(cert), "-outform", "DER"])
    return hashlib.sha256(der).hexdigest()


def warm_page_cache(path: Path) -> int:
    """Read the study once so no run pays the cold-page cost the others do not."""
    n = 0
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            n += len(chunk)
    return n


def start_server(args, report: Path, env: dict, log_path: Path):
    """One exact-server per run. stdout goes to a file, never a pipe, so a long run cannot
    block on a full pipe buffer."""
    senv = env.copy()
    senv["WTPACS_TELEMETRY"] = "1"
    senv["WTPACS_TELEMETRY_PATH"] = str(report)
    cmd = list(args.server_cpu_prefix) + [
        "stdbuf", "-oL", "-eL", str(args.server_bin),
        "--port", str(args.server_port),
        "--study", str(args.study),
        "--cert-pem", str(ROOT / "server/dev-cert/cert.pem"),
        "--key-pem", str(ROOT / "server/dev-cert/key.pem"),
        "--stream-mode", args.stream_mode,
        "--bind", "127.0.0.1",
    ]
    log = open(log_path, "w")
    proc = subprocess.Popen(cmd, cwd=ROOT, env=senv, stdout=log, stderr=subprocess.STDOUT)
    deadline = time.time() + 30
    while time.time() < deadline:
        text = log_path.read_text(errors="replace")
        if "\ntelemetry=" in text or text.startswith("telemetry="):
            banner = {}
            for line in text.splitlines():
                k, sep, v = line.strip().partition("=")
                if k and sep and " " not in k:
                    banner[k] = v
            return proc, banner
        if proc.poll() is not None:
            raise SystemExit(f"exact-server exited early (rc={proc.returncode}):\n{text}")
        time.sleep(0.05)
    raise SystemExit(f"timeout waiting for exact-server:\n{log_path.read_text(errors='replace')}")


def stop_proc(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=6)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=3)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--cell-id", required=True)
    p.add_argument("--study", required=True)
    p.add_argument("--frames", type=int, required=True)
    p.add_argument("--arms", default="wasm,ts",
                   help="slot order, e.g. 'wasm,ts' for A/B or 'ts,ts' for the A/A control")
    p.add_argument("--stream-mode", choices=("shared", "per-frame"), default="per-frame")
    p.add_argument("--ask-cell", choices=("ondemand", "fill"), default="ondemand")
    p.add_argument("--depth", type=int, default=1)
    p.add_argument("--n", type=int, default=None)
    p.add_argument("--interval-ms", type=int, default=None)
    p.add_argument("--trace", default=None)
    p.add_argument("--repeats", type=int, default=6)
    p.add_argument("--warmup", type=int, default=1, help="discarded runs per slot before the cell")
    p.add_argument("--link", choices=("direct", "shim"), default="direct")
    p.add_argument("--delay-ms", type=float, default=30.0)
    p.add_argument("--rate-mbit", type=float, default=10.0)
    p.add_argument("--queue-ms", type=float, default=100.0)
    p.add_argument("--server-cpus", default="0,1", help="taskset for exact-server and the link shim")
    p.add_argument("--client-cpus", default="2,3", help="taskset for Chromium")
    p.add_argument("--server-port", type=int, default=4433)
    p.add_argument("--shim-port", type=int, default=4443)
    p.add_argument("--decoy-port-wt", type=int, default=4901,
                   help="verify_e2e.py fuser-kills this UDP port; keep it off the real server")
    p.add_argument("--port-http", type=int, default=8765)
    p.add_argument("--run-timeout-s", type=int, default=900)
    p.add_argument("--python", default=str(ROOT / ".venv/bin/python"))
    p.add_argument("--chrome", default=os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium"))
    args = p.parse_args()

    args.study = (ROOT / args.study) if not Path(args.study).is_absolute() else Path(args.study)
    args.server_bin = ROOT / "target/release/exact-server"
    if not args.server_bin.is_file():
        raise SystemExit(f"missing {args.server_bin} — build with --features telemetry")
    slots = [a.strip() for a in args.arms.split(",") if a.strip()]
    if len(slots) != 2 or any(a not in ("wasm", "ts") for a in slots):
        raise SystemExit("--arms takes exactly two of wasm/ts")

    args.server_cpu_prefix = ["taskset", "-c", args.server_cpus] if args.server_cpus else []
    client_prefix = ["taskset", "-c", args.client_cpus] if args.client_cpus else []

    env = os.environ.copy()
    env.setdefault("CARGO_TARGET_DIR", str(ROOT / "target"))
    env["CHROME_PATH"] = args.chrome

    pin = cert_pin(ROOT / "server/dev-cert/cert.pem")
    client_port = args.shim_port if args.link == "shim" else args.server_port
    wt_url = f"https://127.0.0.1:{client_port}/"

    cell_dir = MEAS / "n6" / args.cell_id
    cell_dir.mkdir(parents=True, exist_ok=True)
    warmed = warm_page_cache(args.study)
    cell_meta = {
        "cell_id": args.cell_id,
        "study": str(args.study.relative_to(ROOT)),
        "frames": args.frames,
        "arms": slots,
        "stream_mode": args.stream_mode,
        "ask_cell": args.ask_cell,
        "depth": args.depth,
        "n": args.n,
        "interval_ms": args.interval_ms,
        "trace": args.trace,
        "repeats": args.repeats,
        "warmup": args.warmup,
        "link": args.link,
        "rtt_ms_nominal": (2 * args.delay_ms) if args.link == "shim" else 0.0,
        "rate_mbit": args.rate_mbit if args.link == "shim" else None,
        "queue_ms": args.queue_ms if args.link == "shim" else None,
        "server_cpus": args.server_cpus,
        "client_cpus": args.client_cpus,
        "study_bytes_prewarmed": warmed,
        "started_utc": datetime.now(timezone.utc).isoformat(),
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    }
    (cell_dir / "cell.json").write_text(json.dumps(cell_meta, indent=2) + "\n")
    print(f"== cell {args.cell_id} -> {cell_dir}  (warmed {warmed} B)")

    def one_run(arm: str, slot: int, rep: int, keep: bool) -> tuple[bool, bool]:
        tag = f"r{rep:02d}-s{slot}-{arm}" if keep else f"warmup-s{slot}-{arm}-{rep}"
        run_dir = cell_dir / tag
        run_dir.mkdir(parents=True, exist_ok=True)
        server_report = run_dir / "telemetry-server.json"
        for stale in (server_report, run_dir / "telemetry-server.rows"):
            if stale.exists():
                stale.unlink()

        server, banner = start_server(args, server_report, env, run_dir / "exact-server.log")
        shim = None
        if args.link == "shim":
            shim = subprocess.Popen(
                list(args.server_cpu_prefix) +
                [sys.executable, str(ROOT / "lab/scripts/link_shim.py"),
                 "--listen-port", str(args.shim_port),
                 "--server-port", str(args.server_port),
                 "--delay-ms", str(args.delay_ms),
                 "--rate-mbit", str(args.rate_mbit),
                 "--queue-ms", str(args.queue_ms),
                 "--stats-json", str(run_dir / "link-shim.json")],
                cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            shim.stdout.readline()
            time.sleep(0.3)

        before = {d.name for d in MEAS.iterdir() if d.is_dir()}
        cmd = client_prefix + [
            args.python, str(ROOT / "server/scripts/verify_e2e.py"),
            "--telemetry", "--harness", arm, "--repeats", "1",
            "--study", str(args.study),
            "--stream-mode", args.stream_mode,
            "--cell", args.ask_cell,
            "--depth", str(args.depth),
            "--frames", str(args.frames),
            "--wt-url", wt_url, "--cert-sha256", pin,
            "--port-wt", str(args.decoy_port_wt),
            "--port-http", str(args.port_http),
            "--run-timeout-s", str(args.run_timeout_s),
            "--chrome", args.chrome,
        ]
        if args.n is not None:
            cmd += ["--n", str(args.n)]
        if args.interval_ms is not None:
            cmd += ["--interval-ms", str(args.interval_ms)]
        if args.trace is not None:
            cmd += ["--trace", args.trace]

        print(f"-- {args.cell_id} {tag}")
        rc = subprocess.run(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True)
        (run_dir / "verify_e2e.log").write_text(rc.stdout or "")

        deadline = time.time() + 10
        while time.time() < deadline and not server_report.is_file():
            time.sleep(0.1)
        stop_proc(server)
        deadline = time.time() + 6
        while time.time() < deadline and not server_report.is_file():
            time.sleep(0.1)
        stop_proc(shim)
        server_ok = server_report.is_file()

        produced = sorted((d for d in MEAS.iterdir() if d.is_dir() and d.name not in before),
                          key=lambda d: d.stat().st_mtime)
        harvest = produced[-1] if produced else None
        if harvest is not None:
            for f in harvest.iterdir():
                f.replace(run_dir / f.name)
            harvest.rmdir()
        (run_dir / "n6.json").write_text(json.dumps({
            **cell_meta, "arm": arm, "slot": slot, "repeat": rep, "keep": keep,
            "wt_url": wt_url, "server_banner": banner,
            "verify_e2e_rc": rc.returncode, "server_report_present": server_ok,
        }, indent=2) + "\n")
        return rc.returncode == 0, server_ok

    failures: list[str] = []
    for w in range(args.warmup):
        for slot, arm in enumerate(slots):
            one_run(arm, slot, w, keep=False)
    for rep in range(args.repeats):
        # Alternate slot order so "went first" is not confounded with arm.
        order = list(enumerate(slots)) if rep % 2 == 0 else list(reversed(list(enumerate(slots))))
        for slot, arm in order:
            ok, server_ok = one_run(arm, slot, rep, keep=True)
            if not ok or not server_ok:
                failures.append(f"{args.cell_id} r{rep} s{slot} {arm} rc_ok={ok} server_ok={server_ok}")
                print(f"!! FAILED {args.cell_id} r{rep} s{slot} {arm}")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print("  " + f)
        return 1
    print(f"OK cell {args.cell_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
