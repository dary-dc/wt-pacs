#!/usr/bin/env python3
"""devtools.py against a stand-in DevTools endpoint on loopback: the WebSocket handshake and framing, and the CDP
calls each command makes."""
import base64
import hashlib
import io
import json
import socket
import struct
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import devtools  # noqa: E402


TIMEOUT = 5


def page_of(url):
    return devtools.Page(url, TIMEOUT)


def read_frame(conn: socket.socket) -> tuple:
    def exact(n):
        out = b""
        while len(out) < n:
            chunk = conn.recv(n - len(out))
            if not chunk:
                raise EOFError
            out += chunk
        return out
    b0, b1 = exact(2)
    n = b1 & 0x7F
    if n == 126:
        n = struct.unpack("!H", exact(2))[0]
    elif n == 127:
        n = struct.unpack("!Q", exact(8))[0]
    mask = exact(4) if b1 & 0x80 else b""
    payload = exact(n)
    return b0, bool(mask), bytes(b ^ mask[i % 4] for i, b in enumerate(payload)) if mask else payload


def server_frame(payload: bytes, opcode: int = 1, fin: bool = True) -> bytes:
    n = len(payload)
    head = bytes([(0x80 if fin else 0) | opcode])
    if n < 126:
        head += bytes([n])
    elif n < 1 << 16:
        head += bytes([126]) + struct.pack("!H", n)
    else:
        head += bytes([127]) + struct.pack("!Q", n)
    return head + payload


class StandIn:
    """One WebSocket client at a time; `handle(conn, message)` answers each CDP call."""

    def __init__(self, handle, accept_suffix=""):
        self.handle, self.accept_suffix = handle, accept_suffix
        self.listener = socket.create_server(("127.0.0.1", 0))
        self.url = f"ws://127.0.0.1:{self.listener.getsockname()[1]}/devtools/page/X"
        self.received = []
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        conn, _ = self.listener.accept()
        head = b""
        while b"\r\n\r\n" not in head:
            head += conn.recv(4096)
        key = next(line.split(":", 1)[1].strip() for line in head.decode().split("\r\n")
                   if line.lower().startswith("sec-websocket-key"))
        accept = base64.b64encode(hashlib.sha1((key + devtools.WEBSOCKET_GUID).encode()).digest()).decode()
        conn.sendall(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     f"Sec-WebSocket-Accept: {accept}{self.accept_suffix}\r\n\r\n".encode())
        try:
            while True:
                b0, masked, payload = read_frame(conn)
                self.received.append((b0, masked, payload))
                if b0 & 0x0F == 1:
                    self.handle(conn, json.loads(payload))
        except (EOFError, OSError):
            pass


def reply(conn, message, result):
    conn.sendall(server_frame(json.dumps({"id": message["id"], "result": result}).encode()))


def event(conn, method, params):
    conn.sendall(server_frame(json.dumps({"method": method, "params": params}).encode()))


class Framing(unittest.TestCase):
    def test_a_client_frame_is_masked_and_carries_any_length(self):
        """Every client frame is masked (RFC 6455 §5.3), and lengths across the 7-bit, 16-bit and 64-bit
        encodings arrive whole, so a trace chunk or a long evaluation is not cut."""
        a, b = socket.socketpair()
        b.settimeout(TIMEOUT)
        for n in (0, 125, 126, 65535, 65536, 200000):
            payload = bytes(i % 251 for i in range(n))
            a.sendall(devtools.encode_frame(payload))
            b0, masked, got = read_frame(b)
            self.assertEqual((b0, masked, got), (0x81, True, payload), n)

    def test_a_wrong_accept_key_refuses_the_connection(self):
        """A server that does not answer the handshake's key is not DevTools: the client refuses it."""
        stand_in = StandIn(lambda conn, m: None, accept_suffix="x")
        with self.assertRaises(ConnectionError):
            devtools.WebSocket(stand_in.url, TIMEOUT)

    def test_fragments_and_pings_on_the_way_to_a_reply(self):
        """A reply split in fragments is joined, and a ping met on the way is answered with a pong."""
        def handle(conn, m):
            body = json.dumps({"id": m["id"], "result": {"value": "joined"}}).encode()
            conn.sendall(server_frame(b"hi", opcode=9) + server_frame(body[:5], fin=False)
                         + server_frame(body[5:], opcode=0))
        stand_in = StandIn(handle)
        page = page_of(stand_in.url)
        self.assertEqual(page.call("Anything"), {"value": "joined"})
        time.sleep(0.1)
        self.assertIn((0x8A, True, b"hi"), stand_in.received)


class Commands(unittest.TestCase):
    def test_an_event_before_the_reply_is_kept_for_later(self):
        """An event arriving before a call's reply is not lost: the next read returns it."""
        def handle(conn, m):
            event(conn, "Runtime.consoleAPICalled", {"type": "error", "args": [{"value": "boom"}]})
            reply(conn, m, {})
        page = page_of(StandIn(handle).url)
        page.call("Runtime.enable")
        self.assertEqual(page.next_event(time.monotonic() + 1)["method"], "Runtime.consoleAPICalled")

    def test_console_prints_calls_exceptions_and_log_entries(self):
        """`console` enables Runtime and Log and prints one JSON line per console call, exception and log entry."""
        calls = []

        def handle(conn, m):
            calls.append(m["method"])
            reply(conn, m, {})
            if m["method"] == "Log.enable":
                event(conn, "Runtime.consoleAPICalled", {"type": "error", "args": [{"value": "lossless failed"}]})
                event(conn, "Runtime.exceptionThrown", {"exceptionDetails": {"exception": {"description": "E"}}})
                event(conn, "Log.entryAdded", {"entry": {"level": "warning", "text": "w", "source": "network"}})
                event(conn, "Page.frameNavigated", {})
        out = io.StringIO()
        devtools.console(page_of(StandIn(handle).url), 0.5, out)
        lines = [json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual(calls, ["Runtime.enable", "Log.enable"])
        self.assertEqual([(x["kind"], x["text"]) for x in lines],
                         [("error", "lossless failed"), ("exception", "E"), ("warning", "w")])

    def test_eval_returns_the_value_and_raises_on_an_exception(self):
        """`eval` asks for the value itself, awaits a promise, and turns a page exception into an error."""
        def handle(conn, m):
            p = m["params"]
            if p["expression"] == "bad":
                reply(conn, m, {"result": {}, "exceptionDetails": {"text": "Uncaught"}})
            else:
                self.assertTrue(p["returnByValue"] and p["awaitPromise"])
                reply(conn, m, {"result": {"value": [1, 2]}})
        page = page_of(StandIn(handle).url)
        self.assertEqual(devtools.evaluate(page, "ok"), [1, 2])
        with self.assertRaises(RuntimeError):
            devtools.evaluate(page, "bad")

    def test_trace_writes_the_whole_stream(self):
        """`trace` starts tracing to a stream, ends it, and writes every chunk to the file, base64 or not."""
        chunks = [{"data": base64.b64encode(b'{"traceEvents":[').decode(), "base64Encoded": True},
                  {"data": "1,2]}", "eof": True}]

        def handle(conn, m):
            if m["method"] == "Tracing.end":
                reply(conn, m, {})
                event(conn, "Tracing.tracingComplete", {"stream": "s1"})
            elif m["method"] == "IO.read":
                self.assertEqual(m["params"]["handle"], "s1")
                reply(conn, m, chunks.pop(0))
            else:
                if m["method"] == "Tracing.start":
                    self.assertEqual(m["params"]["transferMode"], "ReturnAsStream")
                reply(conn, m, {})
        out = Path(self.tmp) / "trace.json"
        n = devtools.trace(page_of(StandIn(handle).url), str(out), 0.1)
        self.assertEqual(out.read_bytes(), b'{"traceEvents":[1,2]}')
        self.assertEqual(n, len(out.read_bytes()))

    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()


if __name__ == "__main__":
    unittest.main()
