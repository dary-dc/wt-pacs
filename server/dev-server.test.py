#!/usr/bin/env python3
"""python3 server/dev-server.test.py — what dev-server.py serves, and how a browser may cache it."""

import importlib.util
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
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
            "client/viewer/index.html": "<p>viewer",
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
        self.assertEqual((status, body), (200, b"<p>viewer"))
        self.assertEqual(headers.get("Cross-Origin-Embedder-Policy"), "require-corp")
        self.assertEqual(headers.get("Cache-Control"), "no-cache")

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

    def test_an_exact_series_by_its_id(self):
        """An optimal-quality series' exact series answers under the id its metadata names, and no other id does."""
        with tempfile.TemporaryDirectory() as other:
            meta, transport = Path(other) / "m.json", Path(other) / "t.json"
            meta.write_text('{"frameCount": 7}')
            transport.write_text('{"wt_url": "y"}')
            dev_server.Handler.exact = {"/series/s1/metadata": meta, "/wt/s1/dev-transport.json": transport}
            try:
                self.assertEqual(self.get("/series/s1/metadata")[2], b'{"frameCount": 7}')
                self.assertEqual(self.get("/wt/s1/dev-transport.json")[2], b'{"wt_url": "y"}')
                self.assertEqual(self.get("/wt/s2/dev-transport.json")[0], 404)
            finally:
                dev_server.Handler.exact = {}

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

    def test_the_policy_connects_to_the_bound_address_too(self):
        """A page bound to a laptop's address may dial its servers there, and on loopback still."""
        self.assertIn("connect-src 'self' http://127.0.0.1:* https://127.0.0.1:* http://10.9.0.1:* https://10.9.0.1:*;",
                      dev_server.policy("10.9.0.1"))
        self.assertEqual(dev_server.policy("127.0.0.1"), dev_server.Handler.csp)


COMMAND = [sys.executable, str(Path(__file__).with_name("dev-server.py")), "--port", "0", "--transport", "/dev/null"]


@contextmanager
def started(*args):
    """dev-server.py on a free port; yields the URL it prints."""
    p = subprocess.Popen([*COMMAND, *args], stdout=subprocess.PIPE, text=True)
    try:
        yield p.stdout.readline().split()[1]
    finally:
        p.kill()
        p.wait()


class Binding(unittest.TestCase):
    def get(self, url):
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.status, r.headers.get("Content-Security-Policy", "")

    def test_loopback_alone_by_default(self):
        """With no --bind, the page answers on 127.0.0.1 and on no other address of the host."""
        with started() as url:
            self.assertTrue(url.startswith("http://127.0.0.1:"), url)
            self.assertEqual(self.get(url)[0], 200)
            with self.assertRaises(urllib.error.URLError):
                self.get(url.replace("127.0.0.1", "127.0.0.2"))

    def test_bind_serves_that_address_alone_with_its_policy(self):
        """--bind ADDR serves the page at ADDR alone, and its policy connects there."""
        with started("--bind", "127.0.0.2") as url:
            self.assertTrue(url.startswith("http://127.0.0.2:"), url)
            status, csp = self.get(url)
            self.assertEqual(status, 200)
            self.assertIn("https://127.0.0.2:*;", csp)
            with self.assertRaises(urllib.error.URLError):
                self.get(url.replace("127.0.0.2", "127.0.0.1"))

    def test_bind_refuses_every_address(self):
        """--bind 0.0.0.0 would serve the page to every network the laptop is on: refused, by name."""
        run = subprocess.run([*COMMAND, "--bind", "0.0.0.0"], capture_output=True, text=True, timeout=10)
        self.assertEqual(run.returncode, 2)
        self.assertIn("one address", run.stderr)


if __name__ == "__main__":
    unittest.main()
