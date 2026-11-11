#!/usr/bin/env python3
"""The laptop's half of the demo's network check: what the phone dials is listening and pinned right.
README.md §Demo, on arrival; the phone's half is the page itself. docs/devices.md §Demo network

    scripts/demo-network.py ORIGIN [--transport FILE]... [--until WHEN]

ORIGIN is the page the phone opens (http://ADDRESS:8765); each transport file names a series server the page
dials over UDP; WHEN (ISO 8601, default a day from now) is when the demo ends. Standard library and OPENSSL only.
"""
import argparse
import hashlib
import ipaddress
import json
import os
import shlex
import ssl
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

CERT = Path("server/dev-cert/cert.pem")
TWO_WEEKS = timedelta(days=14)
TCP_LISTEN = "0A"


def listening(proto, host, port):
    """Whether a socket of /proc/net/<proto>{,6} is bound to port on host or on every address."""
    wanted = {ipaddress.ip_address(host), ipaddress.ip_address("0.0.0.0"), ipaddress.ip_address("::")}
    for table in filter(Path.exists, (Path(f"/proc/net/{proto}"), Path(f"/proc/net/{proto}6"))):
        for line in table.read_text().splitlines()[1:]:
            local, state = line.split()[1], line.split()[3]
            raw, raw_port = local.split(":")
            if int(raw_port, 16) != port or (proto == "tcp" and state != TCP_LISTEN):
                continue
            # /proc prints each 32-bit word of the address in host (little-endian) order.
            packed = b"".join(bytes.fromhex(raw[i:i + 8])[::-1] for i in range(0, len(raw), 8))
            addr = ipaddress.ip_address(packed)
            if addr in wanted or getattr(addr, "ipv4_mapped", None) in wanted:
                return True
    return False


def validity():
    openssl = shlex.split(os.environ.get("OPENSSL", "openssl"))
    out = subprocess.run([*openssl, "x509", "-noout", "-startdate", "-enddate"], input=CERT.read_bytes(),
                         capture_output=True, check=True).stdout.decode()
    dates = dict(line.split("=", 1) for line in out.split("\n") if "=" in line)
    parse = lambda s: datetime.strptime(s.strip(), "%b %d %H:%M:%S %Y GMT").replace(tzinfo=timezone.utc)
    return parse(dates["notBefore"]), parse(dates["notAfter"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("origin")
    ap.add_argument("--transport", action="append",
                    default=None, help="default: target/phone-transport-4433.json and -4434.json")
    ap.add_argument("--until", type=datetime.fromisoformat, default=datetime.now(timezone.utc) + timedelta(days=1))
    args = ap.parse_args()
    transports = args.transport or ["target/phone-transport-4433.json", "target/phone-transport-4434.json"]
    until = args.until if args.until.tzinfo else args.until.replace(tzinfo=timezone.utc)
    failed = []

    def check(ok, what):
        print(f"{'ok' if ok else 'FAIL'}: {what}")
        ok or failed.append(what)

    page = urlsplit(args.origin)
    check(listening("tcp", page.hostname, page.port), f"tcp {page.port} on {page.hostname}, the page")

    start, end = validity()
    cert_hash = hashlib.sha256(ssl.PEM_cert_to_DER_cert(CERT.read_text())).hexdigest()
    check(end - start <= TWO_WEEKS, f"the certificate's validity, {end - start}, is at most two weeks")
    check(end > until, f"the certificate ends {end:%Y-%m-%d %H:%M} UTC, after {until:%Y-%m-%d %H:%M} UTC")
    for path in transports:
        t = json.loads(Path(path).read_text())
        url = urlsplit(t["wt_url"])
        check(listening("udp", url.hostname, url.port), f"udp {url.port} on {url.hostname}, {path}")
        check(t["cert_sha256"] == cert_hash, f"{path} pins the certificate's hash")

    if failed:
        return 1
    print(f"laptop ready; on the phone open {args.origin.rstrip('/')}/?overlay=1 and read README.md §Demo, on arrival")
    return 0


if __name__ == "__main__":
    sys.exit(main())
