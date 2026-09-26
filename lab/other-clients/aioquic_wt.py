#!/usr/bin/env python3
"""One WebTransport session from aioquic: wait for the server's SETTINGS as a browser does, send the
CONNECT, ask for frame 0 on a bidirectional stream, read the frame's first byte. Prints one JSON
line of ms from the first packet: settings, ready, first_byte. lab/other-clients/README.md

usage: aioquic_wt.py https://127.0.0.1:PORT/
"""
import asyncio
import json
import ssl
import sys
import time
from urllib.parse import urlparse

from aioquic.asyncio.protocol import QuicConnectionProtocol
from aioquic.h3.connection import H3_ALPN, H3Connection
from aioquic.h3.events import HeadersReceived, WebTransportStreamDataReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.connection import QuicConnection

ASK = json.dumps({"op": "request_frame", "frame": 0}).encode()


class Client(QuicConnectionProtocol):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.h3 = H3Connection(self._quic, enable_webtransport=True)
        self.t0 = time.monotonic()
        self.at = {}
        self.settings = asyncio.get_running_loop().create_future()
        self.ready = asyncio.get_running_loop().create_future()
        self.first_byte = asyncio.get_running_loop().create_future()
        self.session = None

    def mark(self, name, fut):
        if not fut.done():
            self.at[name] = round((time.monotonic() - self.t0) * 1000, 1)
            fut.set_result(True)

    def quic_event_received(self, event):
        for e in self.h3.handle_event(event):
            if isinstance(e, HeadersReceived) and e.stream_id == self.session:
                status = dict(e.headers).get(b":status")
                if status == b"200":
                    self.mark("ready", self.ready)
                else:
                    self.ready.set_exception(RuntimeError(f"CONNECT answered {status}"))
            if isinstance(e, WebTransportStreamDataReceived) and e.data:
                self.mark("first_byte", self.first_byte)
        if self.h3.received_settings is not None:
            self.mark("settings", self.settings)

    def open_session(self, authority, path):
        self.session = self._quic.get_next_available_stream_id()
        self.h3.send_headers(self.session, [
            (b":method", b"CONNECT"), (b":protocol", b"webtransport"), (b":scheme", b"https"),
            (b":authority", authority.encode()), (b":path", path.encode()),
        ])
        self.transmit()

    def ask(self):
        stream = self.h3.create_webtransport_stream(self.session)
        self._quic.send_stream_data(stream, len(ASK).to_bytes(4, "little") + ASK)
        self.transmit()


async def main(url):
    u = urlparse(url)
    config = QuicConfiguration(is_client=True, alpn_protocols=H3_ALPN, verify_mode=ssl.CERT_NONE,
                               max_datagram_frame_size=65536)
    # aioquic's own `connect` opens an IPv6 socket, which a host without IPv6 refuses.
    _, c = await asyncio.get_running_loop().create_datagram_endpoint(
        lambda: Client(QuicConnection(configuration=config)), remote_addr=(u.hostname, u.port))
    c.connect((u.hostname, u.port))
    await asyncio.wait_for(c.settings, 10)
    c.open_session(u.netloc, u.path or "/")
    await asyncio.wait_for(c.ready, 10)
    c.ask()
    await asyncio.wait_for(c.first_byte, 10)
    print(json.dumps(c.at))
    c.close()


asyncio.run(main(sys.argv[1]))
