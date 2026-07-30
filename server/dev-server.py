#!/usr/bin/env python3
"""Minimal static host for harness, WASM pkg, study metadata, and dev-transport.json."""

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote
