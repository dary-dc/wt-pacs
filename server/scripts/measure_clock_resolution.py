#!/usr/bin/env python3
"""Phase 0: measure performance.now() resolution under COOP/COEP isolation."""

from __future__ import annotations

import json
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _have(cmd: str) -> bool:
    from shutil import which

    return which(cmd) is not None


def main() -> int:
    out_dir = ROOT / ".local" / "measurements"
    out_dir.mkdir(parents=True, exist_ok=True)
    port = 8765
    if _have("fuser"):
        subprocess.run(
            ["fuser", "-k", f"{port}/tcp"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    time.sleep(0.3)

    server = subprocess.Popen(
        [sys.executable, str(ROOT / "server" / "dev-server.py"), "--port", str(port)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(0.5)
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(f"http://127.0.0.1:{port}/harness/clock-resolution.html", wait_until="load")
            page.wait_for_function("() => globalThis.__clockResolution != null", timeout=15_000)
            result = page.evaluate("() => globalThis.__clockResolution")
            browser.close()

        path = out_dir / "clock-resolution-local.json"
        path.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
        print(f"wrote {path}", file=sys.stderr)
        if result.get("crossOriginIsolated") is not True:
            return 2
        if result.get("clock_resolution_us") is None:
            return 3
        return 0
    finally:
        server.send_signal(signal.SIGTERM)
        try:
            server.wait(timeout=2)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    raise SystemExit(main())
