#!/usr/bin/env python3
"""Minimal static host for harness, WASM pkg, study metadata, and dev-transport.json."""

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    study_name: str = "us_cine_smoke"

