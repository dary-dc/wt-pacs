#!/usr/bin/env python3
"""End-to-end: exact-server + static host + Chromium harness (WASM and/or TS)."""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CHROME = (
    Path.home()
    / ".local/share/containers/storage/overlay"
    / "d8f9f58ac864cb2e87fb0fadfe0593525f471b66ba10507ab273c8d0ea509aff"
    / "diff/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome"
)


def find_chrome(explicit: str | None) -> str:
    candidates = [
        explicit,
        os.environ.get("CHROME_PATH"),
        str(DEFAULT_CHROME) if DEFAULT_CHROME.is_file() else None,
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
    ]
    for c in candidates:
        if c and Path(c).is_file() and os.access(c, os.X_OK):
            return c
    raise SystemExit("No Chrome/Chromium found (set CHROME_PATH)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port-http", type=int, default=8765)
    parser.add_argument("--port-wt", type=int, default=4433)
    parser.add_argument(
        "--study",
        default=str(ROOT / "fixtures/us_cine_smoke/us_cine_smoke.sbnd"),
    )
    parser.add_argument("--chrome", default=None)
    parser.add_argument(
        "--harness",
        choices=("wasm", "ts", "both"),
        default="both",
    )
    parser.add_argument("--keep", action="store_true", help="leave servers running")
    args = parser.parse_args()

    chrome = find_chrome(args.chrome)
    study = Path(args.study)
    if not study.is_file():
        raise SystemExit(f"missing study bundle: {study}")

    cert = ROOT / "server/dev-cert/cert.pem"
    key = ROOT / "server/dev-cert/key.pem"
    if not cert.is_file() or not key.is_file():
        subprocess.run([str(ROOT / "server/scripts/gen_dev_cert.sh")], check=True, cwd=ROOT)

    pkg_js = ROOT / "client/transport-wasm/pkg/transport_wasm.js"
    if not pkg_js.is_file():
        subprocess.run([str(ROOT / "client/transport-wasm/build.sh")], check=True, cwd=ROOT)

    # Prefer a local target dir inside the repo for predictability.
    env = os.environ.copy()
    env.setdefault("CARGO_TARGET_DIR", str(ROOT / "target"))

    procs: list[subprocess.Popen] = []

    def stop_all() -> None:
        for p in procs:
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
        time.sleep(0.4)
        for p in procs:
            if p.poll() is None:
                p.kill()

    try:
        # Avoid colliding with other local WebTransport demos.
        for port in (args.port_http,):
            subprocess.run(
                ["fuser", "-k", f"{port}/tcp"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        subprocess.run(
            ["fuser", "-k", f"{args.port_wt}/udp"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(0.5)

        print("building exact-server…")
        subprocess.run(
            ["cargo", "build", "--release", "-p", "exact-server"],
            cwd=ROOT,
            env=env,
            check=True,
        )
        server_bin = Path(env["CARGO_TARGET_DIR"]) / "release" / "exact-server"
        if not server_bin.is_file():
            # Fallback when cargo ignores CARGO_TARGET_DIR overrides.
            server_bin = ROOT / "target" / "release" / "exact-server"
        if not server_bin.is_file():
            raise SystemExit(f"exact-server binary not found under {env['CARGO_TARGET_DIR']}")

        print("starting exact-server…")
        procs.append(
            subprocess.Popen(
                [
                    "stdbuf",
                    "-oL",
                    "-eL",
                    str(server_bin),
                    "--port",
                    str(args.port_wt),
                    "--study",
                    str(study),
                    "--cert-pem",
                    str(cert),
                    "--key-pem",
                    str(key),
                ],
                cwd=ROOT,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
        )
