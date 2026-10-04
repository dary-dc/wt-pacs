#!/usr/bin/env python3
"""python3 server/dev-server.test.py — what dev-server.py serves, and how a browser may cache it."""

import importlib.util
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location("dev_server", Path(__file__).with_name("dev-server.py"))
dev_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev_server)


class DevServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        for rel, body in {
            "server/dev-cert/key.pem": "KEY",
            ".git/config": "[core]",
            "README.md": "readme",
            "client/page.html": "<p>page",
            "client/module.js": "export {};",
            "lab/bench.html": "<p>bench",
            "fixtures/us_cine_smoke/metadata.json": '{"frameCount": 1}',
        }.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(body)
        dev_server.ROOT = root
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), dev_server.Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, b""

    def test_the_dev_key_and_git_are_refused(self):
        """Nothing outside what the pages fetch answers: not the dev key, not .git, not the checkout's root."""
        for path in ["/server/dev-cert/key.pem", "/.git/config", "/README.md", "/", "/client/../server/dev-cert/key.pem"]:
            with self.subTest(path=path):
                status, _, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"KEY", body)

    def test_what_the_pages_fetch_is_served(self):
        """The page trees and the aliased metadata still answer."""
        for path in ["/client/page.html", "/client/module.js", "/lab/bench.html", "/study/metadata"]:
            with self.subTest(path=path):
                self.assertEqual(self.get(path)[0], 200)

    def test_a_catalog_and_a_page_are_revalidated(self):
        """Metadata and pages carry `no-cache` beside their validator; a module keeps heuristic caching."""
        for path, want in [("/study/metadata", "no-cache"), ("/client/page.html", "no-cache"), ("/client/module.js", None)]:
            with self.subTest(path=path):
                _, headers, _ = self.get(path)
                self.assertEqual(headers.get("Cache-Control"), want)
                self.assertIsNotNone(headers.get("Last-Modified"))


if __name__ == "__main__":
    unittest.main()
