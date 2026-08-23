#!/usr/bin/env python3
from pathlib import Path
import importlib.util
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ds", ROOT / "server/dev-server.py")
ds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ds)


class H(ds.Handler):
    def __init__(self):
        self.directory = str(ds.ROOT)
        self.study_name = "us_cine_smoke"


for url in [
    "/harness/",
    "/harness",
    "/harness/index.html",
    "/client/transport-wasm/pkg/transport_wasm.js",
    "/wt/dev-transport.json",
    "/client/transport-ts/dist/session.js",
]:
    p = H().translate_path(url)
    print(url, "->", p, "exists", Path(p).exists(), "endswith/", str(p).endswith("/"))

subprocess.run(["pkill", "-f", "dev-server.py"], check=False)
time.sleep(0.4)
http = subprocess.Popen(
    ["python3", str(ROOT / "server/dev-server.py"), "--port", "8765", "--study", "us_cine_smoke"],
    cwd=ROOT,
)
time.sleep(0.5)
try:
    for u in [
        "/harness/",
        "/harness/index.html",
        "/client/transport-wasm/pkg/transport_wasm.js",
        "/wt/dev-transport.json",
        "/client/transport-ts/dist/session.js",
    ]:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:8765{u}") as r:
                print(r.status, u, "len", len(r.read()))
        except Exception as e:
            print("FAIL", u, e)
finally:
    http.terminate()
    http.wait(timeout=2)
