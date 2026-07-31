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
