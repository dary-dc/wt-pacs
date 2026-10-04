#!/usr/bin/env python3
"""performance.now() resolution in headless Chromium, under the static host's COOP/COEP isolation."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    out_dir = ROOT / ".local" / "measurements"
    out_dir.mkdir(parents=True, exist_ok=True)
    server = subprocess.Popen(
        [sys.executable, str(ROOT / "server" / "dev-server.py"), "--port", "0"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        port = server.stdout.readline().split()[0].removeprefix("port=")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=os.environ.get("CHROME_PATH"))
            page = browser.new_page()
            page.goto(f"http://127.0.0.1:{port}/lab/clock-resolution/clock-resolution.html", wait_until="load")
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
        server.terminate()
        server.wait(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
