#!/usr/bin/env python3
"""python3 scripts/demo-network.test.py — what scripts/demo-network.py passes and refuses, on the laptop's side."""

import json
import socket
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT = Path(__file__).with_name("demo-network.py")
HOST = "127.0.0.1"


def openssl(*args, cwd):
    subprocess.run(["openssl", *args], cwd=cwd, check=True, capture_output=True)


def cert(root, days):
    d = root / "server/dev-cert"
    d.mkdir(parents=True, exist_ok=True)
    openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", "key.pem",
            "-out", "cert.pem", "-days", str(days), "-nodes", "-subj", "/CN=localhost", cwd=d)
    der = subprocess.run(["openssl", "x509", "-in", "cert.pem", "-outform", "DER"], cwd=d, check=True,
                         capture_output=True).stdout
    return subprocess.run(["openssl", "dgst", "-sha256", "-r"], input=der, check=True,
                          capture_output=True).stdout.split()[0].decode()


class DemoNetwork(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.hash = cert(self.root, 10)
        self.socks = []
        self.page = self.listen(socket.SOCK_STREAM)
        self.series = [self.listen(socket.SOCK_DGRAM) for _ in range(2)]
        self.files = [self.transport(port, self.hash) for port in self.series]

    def tearDown(self):
        for s in self.socks:
            s.close()
        self.tmp.cleanup()

    def listen(self, kind, host=HOST):
        s = socket.socket(socket.AF_INET, kind)
        s.bind((host, 0))
        if kind == socket.SOCK_STREAM:
            s.listen()
        self.socks.append(s)
        return s.getsockname()[1]

    def transport(self, port, cert_hash, host=HOST):
        path = self.root / f"target/phone-transport-{port}.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({"wt_url": f"https://{host}:{port}/", "cert_sha256": cert_hash}))
        return str(path)

    def run_check(self, *args):
        files = [a for f in self.files for a in ("--transport", f)]
        return subprocess.run([sys.executable, str(SCRIPT), f"http://{HOST}:{self.page}", *files, *args],
                              cwd=self.root, capture_output=True, text=True)

    def assertRefused(self, result, words):
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(words, result.stdout)

    def test_ready_laptop_passes_and_names_the_phone_url(self):
        """Both series listening on UDP at the transport files' address, the page on TCP, a certificate that holds:
        exit 0, and the output names the page the phone opens."""
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f"http://{HOST}:{self.page}/?overlay=1", result.stdout)

    def test_a_series_not_listening_on_udp_is_refused_by_port(self):
        """A transport file naming a UDP port nothing listens on fails, naming that port."""
        self.socks[1].close()
        self.assertRefused(self.run_check(), f"udp {self.series[0]}")

    def test_the_page_not_listening_is_refused(self):
        """Nothing on the origin's TCP port fails, naming it."""
        self.socks[0].close()
        self.assertRefused(self.run_check(), f"tcp {self.page}")

    def test_a_listener_on_another_address_is_refused(self):
        """A series bound to another address than the one the phone dials fails: loopback is not the Wi-Fi address."""
        self.files[1] = self.transport(self.series[1], self.hash, host="127.0.0.2")
        self.assertRefused(self.run_check(), f"udp {self.series[1]}")

    def test_a_stale_hash_is_refused(self):
        """A transport file pinning another certificate's hash fails: the page would refuse the server."""
        self.files[0] = self.transport(self.series[0], "00" * 32)
        self.assertRefused(self.run_check(), "hash")

    def test_a_certificate_ending_before_the_demo_is_refused(self):
        """--until past the certificate's end fails, naming the end."""
        self.assertRefused(self.run_check("--until", (datetime.now(timezone.utc) + timedelta(days=11)).isoformat()), "ends")

    def test_a_certificate_over_two_weeks_is_refused(self):
        """A validity period over two weeks fails: WebTransport refuses it under serverCertificateHashes."""
        self.hash = cert(self.root, 15)
        self.files = [self.transport(port, self.hash) for port in self.series]
        self.assertRefused(self.run_check(), "two weeks")


if __name__ == "__main__":
    unittest.main()
