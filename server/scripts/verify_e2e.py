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
    parser.add_argument(
        "--telemetry",
        action="store_true",
        help="load telemetry builds and harvest window.__wtpacsTelemetry",
    )
    parser.add_argument(
        "--cell",
        choices=("ondemand", "fill"),
        default="ondemand",
        help="with --telemetry: which FoD ask cell to autorun",
    )
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument(
        "--interleave",
        action="store_true",
        help="with --telemetry and harness=both: alternate arms per repeat",
    )
    parser.add_argument(
        "--wt-url",
        default=None,
        help="override WebTransport URL (e.g. shaped cloud rig). Skips local exact-server.",
    )
    parser.add_argument(
        "--cert-sha256",
        default=None,
        help="cert pin for --wt-url (hex). Required with --wt-url.",
    )
    args = parser.parse_args()

    if (args.wt_url is None) ^ (args.cert_sha256 is None):
        raise SystemExit("--wt-url and --cert-sha256 must be passed together")
    remote_wt = args.wt_url is not None

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

    if args.telemetry:
        ts_tel = ROOT / "client/transport-ts/dist/session.telemetry.js"
        if not ts_tel.is_file():
            subprocess.run(
                ["bash", str(ROOT / "client/transport-ts/build.sh")],
                check=True,
                cwd=ROOT,
            )
        # Optional separate wasm out-dir; product wasm is identical.
        env_tel = os.environ.copy()
        env_tel["WTPACS_TELEMETRY_BUILD"] = "1"
        subprocess.run(
            ["bash", str(ROOT / "client/transport-wasm/build.sh")],
            check=False,
            cwd=ROOT,
            env=env_tel,
        )

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
        from shutil import which as _which

        if _which("fuser"):
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

        if remote_wt:
            print(f"remote WebTransport: {args.wt_url} (skip local exact-server)")
            server_proc = None
        else:
            print("building exact-server…")
            build_cmd = ["cargo", "build", "--release", "-p", "exact-server"]
            if args.telemetry:
                # Existing server Tap (feature-gated). No product-path rewrite — ADR.
                build_cmd.append("--features")
                build_cmd.append("telemetry")
            subprocess.run(
                build_cmd,
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

        def start_exact_server(server_env: dict) -> subprocess.Popen:
            cmd = [
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
            proc = subprocess.Popen(
                cmd,
                cwd=ROOT,
                env=server_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            deadline = time.time() + 30
            out_buf = ""
            while time.time() < deadline:
                line = proc.stdout.readline() if proc.stdout else ""
                if line:
                    out_buf += line
                    sys.stdout.write(f"[server] {line}")
                    if "wt_url=" in line:
                        return proc
                if proc.poll() is not None:
                    raise SystemExit(f"exact-server exited early:\n{out_buf}")
                time.sleep(0.05)
            raise SystemExit(f"timeout waiting for exact-server ready:\n{out_buf}")

        def stop_proc(proc: subprocess.Popen | None) -> None:
            if proc is None or proc.poll() is not None:
                return
            proc.send_signal(signal.SIGTERM)
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()

        if not remote_wt:
            print("starting exact-server…")
            server_proc = start_exact_server(env)
            procs.append(server_proc)
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

        # Keep cert pin in sync with the cert we just loaded (or remote override).
        import json
        import hashlib

        if remote_wt:
            pin = args.cert_sha256.lower().replace(":", "")
            wt_url = args.wt_url
        else:
            der = subprocess.check_output(
                ["openssl", "x509", "-in", str(cert), "-outform", "DER"]
            )
            pin = hashlib.sha256(der).hexdigest()
            wt_url = f"https://127.0.0.1:{args.port_wt}/"
        (ROOT / "client" / "dev-transport.json").write_text(
            json.dumps(
                {"wt_url": wt_url, "cert_sha256": pin},
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"dev-transport.json wt_url={wt_url} cert_sha256={pin}")

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

        if args.telemetry and args.interleave and len(paths) > 1:
            # Alternate arms across repeats: (r0 arm0), (r0 arm1), (r1 arm0), ...
            schedule: list[tuple[str, str, int]] = []
            for rep in range(args.repeats):
                for path, label in paths:
                    schedule.append((path, label, rep))
        else:
            schedule = []
            for path, label in paths:
                for rep in range(args.repeats):
                    schedule.append((path, label, rep))

        meas_root = ROOT / ".local" / "measurements"
        if args.telemetry:
            meas_root.mkdir(parents=True, exist_ok=True)

        study_slug = study.stem.replace(".sbnd", "") if study.suffix == ".sbnd" else study.stem

        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=chrome,
                headless=True,
                args=[
                    "--enable-features=WebTransport",
                    "--no-sandbox",
                ],
            )
            for path, label, rep in schedule:
                run_dir = None
                if args.telemetry:
                    # Independent pieces in one run folder (no join file):
                    #   <stamp>-<study>-<arm>-<stream>-<cell>-rN/
                    #     telemetry-client.json
                    #     telemetry-server.json
                    from datetime import datetime, timezone
                    import json as _json

                    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                    shape = "shaped50" if remote_wt else "local"
                    run_dir = (
                        meas_root
                        / f"{stamp}-{study_slug}-{label}-{args.stream_mode}-{args.cell}-{shape}-r{rep}"
                    )
                    run_dir.mkdir(parents=True, exist_ok=True)
                    server_report = run_dir / "telemetry-server.json"
                    # Restart local server so this run gets its own server Tap report.
                    if not remote_wt:
                        if server_proc in procs:
                            procs.remove(server_proc)
                        stop_proc(server_proc)
                        time.sleep(0.4)
                        senv = env.copy()
                        senv["WTPACS_TELEMETRY"] = "1"
                        senv["WTPACS_TELEMETRY_PATH"] = str(server_report)
                        print(f"starting exact-server (telemetry → {server_report})…")
                        server_proc = start_exact_server(senv)
                        procs.insert(0, server_proc)
                    else:
                        print("remote WT: client-only harvest (cloud server Tap not in this path)")

                q = []
                if args.telemetry:
                    q.append("telemetry=1")
                    q.append("autorun=1")
                    q.append(f"cell={args.cell}")
                    q.append(f"stream_mode={args.stream_mode}")
                qs = ("?" + "&".join(q)) if q else ""
                url = f"http://127.0.0.1:{args.port_http}{path}{qs}"
                print(f"verify {label} rep={rep}: {url}")
                page = browser.new_page()
                errors: list[str] = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.on("console", lambda m: print(f"[{label}/console] {m.type}: {m.text}"))

                page.goto(url, wait_until="networkidle", timeout=30_000)
                # Wait until TransportSession.connect finished (not the pre-await "connecting" line).
                page.wait_for_function(
                    """() => {
                      const t = document.getElementById('log')?.textContent || '';
                      return /(^|\\n)connect /.test(t) || t.includes('boot error');
                    }""",
                    timeout=60_000 if remote_wt else 15_000,
                )
                log = page.locator("#log").inner_text()
                if "boot error" in log:
                    raise SystemExit(f"{label} boot failed:\n{log}\npageerrors={errors}")

                if args.telemetry:
                    # Fill autorun logs "bulk <index> …" once per frame (0..2).
                    if args.cell == "fill":
                        wait_ms = 180_000 if remote_wt else 60_000
                        page.wait_for_function(
                            """() => {
                              const t = document.getElementById('log')?.textContent || '';
                              return t.split('\\n').filter((l) => l.startsWith('bulk ')).length >= 3;
                            }""",
                            timeout=wait_ms,
                        )
                    else:
                        page.wait_for_function(
                            """() => (document.getElementById('log')?.textContent || '').includes('frame0 bytes')""",
                            timeout=60_000,
                        )
                    log = page.locator("#log").inner_text()
                    if args.cell == "fill" and log.count("bulk ") < 3:
                        raise SystemExit(f"{label}: fill incomplete before harvest:\n{log}")
                    report = page.evaluate("() => window.__wtpacsTelemetry?.() ?? null")
                    if report is None:
                        raise SystemExit(
                            f"{label}: telemetry build expected but __wtpacsTelemetry absent"
                        )
                    assert run_dir is not None
                    client_out = run_dir / "telemetry-client.json"
                    client_out.write_text(_json.dumps(report, indent=2) + "\n")
                    print(f"wrote {client_out}")
                    print(f"[{label}] after run:\n{log}")
                    if errors:
                        raise SystemExit(f"{label}: page errors: {errors}")
                    opened = report.get("summary", {}).get("integrity", {}).get("rows_opened")
                    closed = report.get("summary", {}).get("integrity", {}).get("rows_closed")
                    if opened != closed:
                        raise SystemExit(
                            f"{label}: integrity rows_opened ({opened}) != rows_closed ({closed})"
                        )
                    page.close()
                    if not remote_wt:
                        server_out = run_dir / "telemetry-server.json"
                        # Wait for Tap Drop on session end — do not SIGTERM yet.
                        deadline = time.time() + 5
                        while time.time() < deadline and not server_out.is_file():
                            time.sleep(0.1)
                        if server_proc in procs:
                            procs.remove(server_proc)
                        stop_proc(server_proc)
                        # Drain thread may finish writing on process exit as well.
                        deadline = time.time() + 3
                        while time.time() < deadline and not server_out.is_file():
                            time.sleep(0.1)
                        if server_out.is_file():
                            print(f"wrote {server_out}")
                        else:
                            print(f"WARN: missing {server_out} (server Tap did not flush)")
                        server_proc = start_exact_server(env)
                        procs.insert(0, server_proc)
                    print(f"OK {label} rep={rep}")
                    continue

                page.click("#frame0")
                page.wait_for_function(
                    """() => (document.getElementById('log')?.textContent || '').includes('frame0 bytes')""",
                    timeout=20_000,
                )
                log = page.locator("#log").inner_text()
                print(f"[{label}] after run:\n{log}")
                if "frame0 bytes" not in log:
                    raise SystemExit(f"{label}: frame0 did not complete")
                if errors:
                    raise SystemExit(f"{label}: page errors: {errors}")
                page.close()
                print(f"OK {label} rep={rep}")
            browser.close()

        print("PASS e2e")
        return 0
    finally:
        if not args.keep:
            stop_all()


if __name__ == "__main__":
    raise SystemExit(main())
