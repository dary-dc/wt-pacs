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
            "client/viewer/index.html": '<script src="/client/viewer/head.js" data-client="ts" data-wt-port="4433"></script>',
            "client/module.js": "export {};",
            "lab/bench.html": "<p>bench",
            "fixtures/a_series/metadata.json": '{"frameCount": 1}',
        }.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(body)
        dev_server.ROOT = root
        dev_server.Handler.series_name = "a_series"
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
        """Nothing outside what the pages fetch answers: not the dev key, not .git, not the checkout's files."""
        for path in ["/server/dev-cert/key.pem", "/.git/config", "/README.md", "/client/../server/dev-cert/key.pem"]:
            with self.subTest(path=path):
                status, _, body = self.get(path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"KEY", body)

    def test_what_the_pages_fetch_is_served(self):
        """The page trees and the aliased metadata still answer."""
        for path in ["/client/page.html", "/client/module.js", "/lab/bench.html", "/series/metadata"]:
            with self.subTest(path=path):
                self.assertEqual(self.get(path)[0], 200)

    def test_the_viewer_is_the_root_page(self):
        """`/` is the viewer, isolated and revalidated like any page."""
        status, headers, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"head.js", body)
        self.assertEqual(headers.get("Cross-Origin-Embedder-Policy"), "require-corp")
        self.assertEqual(headers.get("Cache-Control"), "no-cache")

    def test_the_page_is_rendered_for_this_host(self):
        """The dev certificate is pinned through the transport file; `--wt-port` renders the page a trusted deployment
        serves, which dials its own host and names no file; `--client` names the client."""
        self.assertIn(b'data-client="ts" data-transport-file="/wt/dev-transport.json"', self.get("/")[2])
        dev_server.Handler.client, dev_server.Handler.wt_port = "wasm", 4500
        try:
            body = self.get("/client/viewer/index.html")[2]
            self.assertIn(b'data-client="wasm" data-wt-port="4500"', body)
            self.assertNotIn(b"dev-transport", body)
        finally:
            dev_server.Handler.client, dev_server.Handler.wt_port = "ts", None

    def test_metadata_and_transport_given_by_path(self):
        """`--metadata` and `--transport` serve files from anywhere under their two names, and nothing beside them."""
        with tempfile.TemporaryDirectory() as other:
            meta, transport = Path(other) / "m.json", Path(other) / "t.json"
            meta.write_text('{"frameCount": 7}')
            transport.write_text('{"wt_url": "x"}')
            (Path(other) / "secret.txt").write_text("SECRET")
            dev_server.Handler.metadata, dev_server.Handler.transport = meta, transport
            try:
                self.assertEqual(self.get("/series/metadata")[2], b'{"frameCount": 7}')
                self.assertEqual(self.get("/wt/dev-transport.json")[2], b'{"wt_url": "x"}')
                self.assertEqual(self.get(f"/{other}/secret.txt")[0], 404)
            finally:
                dev_server.Handler.metadata = dev_server.Handler.transport = None

    def test_no_series_named_serves_none(self):
        """With neither `--series` nor `--metadata`, `/series/metadata` is a 404: no series is a default."""
        dev_server.Handler.series_name = None
        try:
            self.assertEqual(self.get("/series/metadata")[0], 404)
        finally:
            dev_server.Handler.series_name = "a_series"

    def test_a_catalog_and_a_page_are_revalidated(self):
        """Metadata and pages carry `no-cache` beside their validator; a module keeps heuristic caching."""
        for path, want in [("/series/metadata", "no-cache"), ("/client/page.html", "no-cache"), ("/client/module.js", None)]:
            with self.subTest(path=path):
                _, headers, _ = self.get(path)
                self.assertEqual(headers.get("Cache-Control"), want)
                self.assertIsNotNone(headers.get("Last-Modified"))

    def test_the_viewer_alone_carries_the_policy(self):
        """The viewer's page runs no inline script and connects on loopback alone; a lab page is left without a policy."""
        for path in ["/", "/client/viewer/index.html?wt=x"]:
            with self.subTest(path=path):
                csp = self.get(path)[1].get("Content-Security-Policy", "")
                self.assertIn("script-src 'self' 'unsafe-eval';", csp)
                self.assertIn("connect-src 'self' http://127.0.0.1:* https://127.0.0.1:*;", csp)
        self.assertIsNone(self.get("/lab/bench.html")[1].get("Content-Security-Policy"))


if __name__ == "__main__":
    unittest.main()
