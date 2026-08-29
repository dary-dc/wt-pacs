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
    parser.add_argument(
        "--stream-mode",
        choices=("shared", "per-frame"),
        default="per-frame",
        help="exact-server --stream-mode",
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
        server_cmd = [
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
            "--stream-mode",
            args.stream_mode,
        ]
        procs.append(
            subprocess.Popen(
                server_cmd,
                cwd=ROOT,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
        )
        # Wait until server prints wt_url=
        deadline = time.time() + 30
        out_buf = ""
        while time.time() < deadline:
            line = procs[0].stdout.readline() if procs[0].stdout else ""
            if line:
                out_buf += line
                sys.stdout.write(f"[server] {line}")
                if "wt_url=" in line:
                    break
            if procs[0].poll() is not None:
                raise SystemExit(f"exact-server exited early:\n{out_buf}")
            time.sleep(0.05)
        else:
            raise SystemExit(f"timeout waiting for exact-server ready:\n{out_buf}")

        print("starting static host…")
        http_log = open("/tmp/wt-verify-http.log", "w")
        procs.append(
            subprocess.Popen(
                [
                    sys.executable,
                    str(ROOT / "server/dev-server.py"),
                    "--port",
                    str(args.port_http),
                    "--study",
                    "us_cine_smoke",
                ],
                cwd=ROOT,
                stdout=http_log,
                stderr=subprocess.STDOUT,
            )
        )
        time.sleep(0.6)
        if procs[-1].poll() is not None:
            http_log.flush()
            raise SystemExit(
                f"static host exited early:\n{Path('/tmp/wt-verify-http.log').read_text()}"
            )

        # Keep cert pin in sync with the cert we just loaded.
        import json
        import hashlib

        der = subprocess.check_output(
            ["openssl", "x509", "-in", str(cert), "-outform", "DER"]
        )
        pin = hashlib.sha256(der).hexdigest()
        (ROOT / "client" / "dev-transport.json").write_text(
            json.dumps(
                {"wt_url": f"https://127.0.0.1:{args.port_wt}/", "cert_sha256": pin},
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"dev-transport.json cert_sha256={pin}")

        # Playwright may not be installed; install into .venv if needed.
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            print("installing playwright into .venv…")
            venv = ROOT / ".venv"
            if not venv.is_dir():
                subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
            pip = venv / "bin" / "pip"
            py = venv / "bin" / "python"
            subprocess.run([str(pip), "install", "-q", "playwright"], check=True)
            # Re-exec under venv python so imports resolve.
            os.execv(
                str(py),
                [str(py), __file__, *sys.argv[1:]],
            )

        from playwright.sync_api import sync_playwright

        paths = []
        if args.harness in ("wasm", "both"):
            paths.append(("/harness/", "wasm"))
        if args.harness in ("ts", "both"):
            paths.append(("/harness/ts.html", "ts"))

        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=chrome,
                headless=True,
                args=[
                    "--enable-features=WebTransport",
                    "--no-sandbox",
                ],
            )
            for path, label in paths:
                url = f"http://127.0.0.1:{args.port_http}{path}"
                print(f"verify {label}: {url}")
                page = browser.new_page()
                errors: list[str] = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.on("console", lambda m: print(f"[{label}/console] {m.type}: {m.text}"))

                page.goto(url, wait_until="networkidle", timeout=30_000)
                # Wait for connect log
                page.wait_for_function(
                    """() => {
                      const t = document.getElementById('log')?.textContent || '';
                      return t.includes('connect') || t.includes('boot error');
                    }""",
                    timeout=15_000,
                )
                log = page.locator("#log").inner_text()
                if "boot error" in log:
                    raise SystemExit(f"{label} boot failed:\n{log}\npageerrors={errors}")

                page.click("#frame0")
                page.wait_for_function(
                    """() => (document.getElementById('log')?.textContent || '').includes('frame0 bytes')""",
                    timeout=20_000,
                )
                log = page.locator("#log").inner_text()
                print(f"[{label}] after frame0:\n{log}")
                if "frame0 bytes" not in log:
                    raise SystemExit(f"{label}: frame0 did not complete")
                if errors:
                    raise SystemExit(f"{label}: page errors: {errors}")
                page.close()
                print(f"OK {label}")

            browser.close()

        print("PASS e2e")
        return 0
    finally:
        if not args.keep:
            stop_all()


if __name__ == "__main__":
    raise SystemExit(main())
