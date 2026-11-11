#!/usr/bin/env python3
"""Chrome on the phone through adb's DevTools socket: tabs, console, evaluate, trace. Diagnosis loads only, never a
counted one (docs/devices.md §7, Second amendment). Standard library only; lab/phone/README.md §DevTools.

  devtools.py [--adb PATH] tabs
  devtools.py console [--url URL] [--seconds 30]          one JSON line per console call, exception or log entry
  devtools.py eval EXPR                                   the value as JSON
  devtools.py trace --out FILE [--url URL] [--seconds 10] a Chrome trace for ui.perfetto.dev
"""
import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request

WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
TRACE_CATEGORIES = "devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,blink.user_timing,toplevel"


def encode_frame(payload: bytes, opcode: int = 1) -> bytes:
    head = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        head += bytes([0x80 | n])
    elif n < 1 << 16:
        head += bytes([0x80 | 126]) + struct.pack("!H", n)
    else:
        head += bytes([0x80 | 127]) + struct.pack("!Q", n)
    mask = os.urandom(4)
    return head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))


class WebSocket:
    def __init__(self, url: str, timeout: float = 30):
        u = urllib.parse.urlsplit(url)
        self.sock = socket.create_connection((u.hostname, u.port or 80), timeout=timeout)
        self.buf = b""
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            f"GET {u.path or '/'} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        status, *lines = self._until(b"\r\n\r\n").decode("latin-1").strip().split("\r\n")
        headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(":") for line in lines)}
        accept = base64.b64encode(hashlib.sha1((key + WEBSOCKET_GUID).encode()).digest()).decode()
        if " 101 " not in status or headers.get("sec-websocket-accept") != accept:
            raise ConnectionError(f"no WebSocket upgrade from {url}: {status!r}")

    def _exact(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError("DevTools closed the connection")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _until(self, end: bytes) -> bytes:
        while end not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError("DevTools closed the connection")
            self.buf += chunk
        i = self.buf.index(end) + len(end)
        out, self.buf = self.buf[:i], self.buf[i:]
        return out

    def send(self, text: str) -> None:
        self.sock.sendall(encode_frame(text.encode()))

    def recv(self) -> str:
        message = b""
        while True:
            b0, b1 = self._exact(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._exact(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._exact(8))[0]
            mask = self._exact(4) if b1 & 0x80 else b""
            payload = self._exact(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            opcode = b0 & 0x0F
            if opcode == 8:
                raise EOFError("DevTools closed the WebSocket")
            if opcode == 9:
                self.sock.sendall(encode_frame(payload, opcode=10))
                continue
            if opcode in (0, 1, 2):
                message += payload
                if b0 & 0x80:
                    return message.decode()

    def settimeout(self, seconds: float) -> None:
        self.sock.settimeout(seconds)


class Page:
    def __init__(self, ws_url: str, timeout: float = 30):
        self.ws = WebSocket(ws_url, timeout)
        self.last_id = 0
        self.events = []

    def call(self, method: str, **params):
        self.last_id += 1
        self.ws.send(json.dumps({"id": self.last_id, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.last_id:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m.get("result", {})
            if "method" in m:
                self.events.append(m)

    def next_event(self, until: float):
        """The next event, or None once the monotonic clock passes `until`."""
        if self.events:
            return self.events.pop(0)
        while time.monotonic() < until:
            self.ws.settimeout(max(0.01, until - time.monotonic()))
            try:
                m = json.loads(self.ws.recv())
            except (socket.timeout, TimeoutError):
                return None
            if "method" in m:
                return m
        return None


def forward(adb: str, port: int) -> None:
    subprocess.run([adb, "forward", f"tcp:{port}", "localabstract:chrome_devtools_remote"], check=True,
                   stdout=subprocess.DEVNULL)


def tabs(port: int) -> list:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=10) as r:
        return [t for t in json.load(r) if t.get("type") == "page"]


def open_tab(port: int, url: str) -> dict:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?{urllib.parse.quote(url, safe='')}",
                                 method="PUT")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def console(page: Page, seconds: float, out=sys.stdout) -> None:
    page.call("Runtime.enable")
    page.call("Log.enable")
    until = time.monotonic() + seconds
    while (m := page.next_event(until)) is not None:
        p = m["params"]
        if m["method"] == "Runtime.consoleAPICalled":
            line = {"kind": p["type"], "text": " ".join(str(a.get("value", a.get("description", "")))
                                                         for a in p.get("args", []))}
        elif m["method"] == "Runtime.exceptionThrown":
            d = p["exceptionDetails"]
            line = {"kind": "exception", "text": d.get("exception", {}).get("description", d.get("text", ""))}
        elif m["method"] == "Log.entryAdded":
            line = {"kind": p["entry"]["level"], "text": p["entry"]["text"], "source": p["entry"]["source"]}
        else:
            continue
        print(json.dumps({"t": time.time(), **line}), file=out, flush=True)


def evaluate(page: Page, expression: str):
    r = page.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
    if "exceptionDetails" in r:
        raise RuntimeError(r["exceptionDetails"].get("text", "exception"))
    return r["result"].get("value")


def trace(page: Page, out_path: str, seconds: float, url: str = None) -> int:
    page.call("Tracing.start", transferMode="ReturnAsStream", traceConfig={
        "includedCategories": TRACE_CATEGORIES.split(",")})
    if url:
        page.call("Page.navigate", url=url)
    end = time.monotonic() + seconds
    while page.next_event(end) is not None:
        pass
    page.call("Tracing.end")
    while (m := page.next_event(time.monotonic() + 60)) is not None and m["method"] != "Tracing.tracingComplete":
        pass
    if m is None:
        raise TimeoutError("no Tracing.tracingComplete within 60 s")
    stream, written = m["params"]["stream"], 0
    with open(out_path, "wb") as f:
        while True:
            chunk = page.call("IO.read", handle=stream)
            data = chunk.get("data", "")
            data = base64.b64decode(data) if chunk.get("base64Encoded") else data.encode()
            written += f.write(data)
            if chunk.get("eof"):
                break
    page.call("IO.close", handle=stream)
    return written


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--adb", default=os.path.expanduser("~/opt/platform-tools/adb"))
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--no-forward", action="store_true", help="the port is already forwarded")
    ap.add_argument("--tab", help="a tab id from `tabs`; default the first page")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tabs")
    c = sub.add_parser("console")
    c.add_argument("--url")
    c.add_argument("--seconds", type=float, default=30)
    e = sub.add_parser("eval")
    e.add_argument("expression")
    t = sub.add_parser("trace")
    t.add_argument("--out", required=True)
    t.add_argument("--url")
    t.add_argument("--seconds", type=float, default=10)
    a = ap.parse_args(argv)

    if not a.no_forward:
        forward(a.adb, a.port)
    pages = tabs(a.port)
    if a.cmd == "tabs":
        for p in pages:
            print(p["id"], p.get("url", ""))
        return 0
    if a.cmd == "console" and a.url:
        target = open_tab(a.port, "about:blank")
    else:
        target = next((p for p in pages if p["id"] == a.tab), None) if a.tab else (pages[0] if pages else None)
    if target is None:
        print("no page tab in Chrome on the phone", file=sys.stderr)
        return 1
    page = Page(target["webSocketDebuggerUrl"])
    if a.cmd == "console":
        if a.url:
            page.call("Runtime.enable")
            page.call("Log.enable")
            page.call("Page.navigate", url=a.url)
        console(page, a.seconds)
    elif a.cmd == "eval":
        print(json.dumps(evaluate(page, a.expression)))
    elif a.cmd == "trace":
        print(f"{trace(page, a.out, a.seconds, a.url)} bytes to {a.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
