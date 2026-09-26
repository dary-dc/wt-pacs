#!/usr/bin/env python3
"""What each QUIC client offered in its ClientHello, and what the server's ServerHello took, read
from a capture: a PSK (resumption) and early data (0-RTT). Initial packets are protected with keys
derived from the client's first destination connection ID (RFC 9001 §5.2), so no secret is needed.

usage: tcpdump -i lo -w dial.pcap udp port SERVER_PORT; client_hello.py dial.pcap SERVER_PORT
Prints one line per connection: `conn=N psk=resumed|offered|no early_data=yes|no zero_rtt_packets=yes|no`
docs/ARCHITECTURE.md §Resumption and 0-RTT
"""
import hashlib
import hmac
import struct
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

INITIAL_SALT_V1 = bytes.fromhex("38762cf7f55934b34d179ae6a4c80cadccbb7f0a")
PRE_SHARED_KEY, EARLY_DATA = 0x0029, 0x002A


def hkdf_label(secret, label, length):
    full = b"tls13 " + label
    info = struct.pack(">HB", length, len(full)) + full + b"\x00"
    out, block, i = b"", b"", 1
    while len(out) < length:
        block = hmac.new(secret, block + info + bytes([i]), hashlib.sha256).digest()
        out, i = out + block, i + 1
    return out[:length]


def initial_keys(dcid, side):
    initial = hmac.new(INITIAL_SALT_V1, dcid, hashlib.sha256).digest()
    secret = hkdf_label(initial, side, 32)
    return hkdf_label(secret, b"quic key", 16), hkdf_label(secret, b"quic iv", 12), hkdf_label(secret, b"quic hp", 16)


def varint(b, i):
    n = 1 << (b[i] >> 6)
    v = b[i] & 0x3F
    for k in range(1, n):
        v = (v << 8) | b[i + k]
    return v, i + n


def initial_crypto(dgram, keys_for):
    """CRYPTO frames (offset, data) of every client Initial coalesced in one datagram."""
    out, i = [], 0
    while i < len(dgram) and dgram[i] & 0x80:
        first = dgram[i]
        if (first >> 4) & 3 != 0:  # not an Initial: 0-RTT or Handshake, whose keys we lack
            return out, dgram[i:i + 1]
        dl = dgram[i + 5]
        dcid = dgram[i + 6:i + 6 + dl]
        j = i + 6 + dl
        j += 1 + dgram[j]
        tlen, j = varint(dgram, j)
        j += tlen
        length, pn_off = varint(dgram, j)
        key, iv, hp = keys_for(dcid)
        sample = dgram[pn_off + 4:pn_off + 20]
        mask = Cipher(algorithms.AES(hp), modes.ECB()).encryptor().update(sample)
        first ^= mask[0] & 0x0F
        pn_len = (first & 3) + 1
        pn = bytes(a ^ b for a, b in zip(dgram[pn_off:pn_off + pn_len], mask[1:1 + pn_len]))
        header = bytes([first]) + dgram[i + 1:pn_off] + pn
        nonce = bytes(a ^ b for a, b in zip(iv, int.from_bytes(pn, "big").to_bytes(12, "big")))
        plain = AESGCM(key).decrypt(nonce, dgram[pn_off + pn_len:pn_off + length], header)
        k = 0
        while k < len(plain):
            t = plain[k]
            if t in (0x00, 0x01):
                k += 1
            elif t in (0x02, 0x03):
                _, k = varint(plain, k + 1)
                _, k = varint(plain, k)
                n, k = varint(plain, k)
                _, k = varint(plain, k)
                for _ in range(n):
                    _, k = varint(plain, k)
                    _, k = varint(plain, k)
                if t == 0x03:
                    for _ in range(3):
                        _, k = varint(plain, k)
            elif t == 0x06:
                off, k = varint(plain, k + 1)
                n, k = varint(plain, k)
                out.append((off, plain[k:k + n]))
                k += n
            else:
                break
        i = pn_off + length
    return out, b""


def extensions(msg):
    """Extension types of a ClientHello or ServerHello handshake message."""
    i = 4 + 2 + 32
    i += 1 + msg[i]
    if msg[0] == 1:
        i += 2 + struct.unpack(">H", msg[i:i + 2])[0]
        i += 1 + msg[i]
    else:
        i += 3
    end = i + 2 + struct.unpack(">H", msg[i:i + 2])[0]
    i += 2
    types = []
    while i < end:
        t, n = struct.unpack(">HH", msg[i:i + 4])
        types.append(t)
        i += 4 + n
    return types


def datagrams(path):
    f = open(path, "rb")
    link = struct.unpack("<I", f.read(24)[20:24])[0]
    off = 14 if link == 1 else 16
    while len(h := f.read(16)) == 16:
        _, _, incl, _ = struct.unpack("<IIII", h)
        d = f.read(incl)
        ip = d[off:]
        ihl = (ip[0] & 15) * 4
        sport, dport = struct.unpack(">HH", ip[ihl:ihl + 4])
        yield sport, dport, ip[ihl + 8:]


def first_message(crypto, kind):
    stream, pos = b"", 0
    for off in sorted(crypto):
        if off <= pos:
            stream += crypto[off][pos - off:]
            pos = len(stream)
    if len(stream) < 4 or stream[0] != kind:
        return None
    return stream[:4 + int.from_bytes(stream[1:4], "big")]


def opened(payload, dcid, side):
    """The datagram's Initial CRYPTO frames, or None when these keys do not open it."""
    try:
        return initial_crypto(payload, lambda _dcid: initial_keys(dcid, side))
    except InvalidTag:
        return None


def main():
    path, server = sys.argv[1], int(sys.argv[2])
    conns, latest = [], {}
    for sport, dport, payload in datagrams(path):
        if server not in (sport, dport) or not payload or not payload[0] & 0x80:
            continue
        port = dport if sport == server else sport
        side = b"server in" if sport == server else b"client in"
        c = latest.get(port)
        got = c and opened(payload, c["dcid"], side)
        if got is None and sport != server:
            # A client Initial the current keys cannot open is a new connection that reused the port.
            c = latest[port] = {"port": port, "dcid": payload[6:6 + payload[5]], "c": {}, "s": {}, "zero_rtt": False}
            conns.append(c)
            got = opened(payload, c["dcid"], side)
        if got is None:
            continue
        frames, rest = got
        if sport != server:
            c["zero_rtt"] |= bool(rest) and (rest[0] >> 4) & 3 == 1
        for off, data in frames:
            c["s" if sport == server else "c"].setdefault(off, data)
    for n, c in enumerate(conns):
        port = c["port"]
        ch, sh = first_message(c["c"], 1), first_message(c["s"], 2)
        if ch is None:
            print(f"conn={n} port={port} no ClientHello")
            continue
        offered, taken = PRE_SHARED_KEY in extensions(ch), sh is not None and PRE_SHARED_KEY in extensions(sh)
        print(f"conn={n} port={port} psk={'resumed' if taken else 'offered' if offered else 'no'} "
              f"early_data={'yes' if EARLY_DATA in extensions(ch) else 'no'} "
              f"zero_rtt_packets={'yes' if c['zero_rtt'] else 'no'}")


main()
