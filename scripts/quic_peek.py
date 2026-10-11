#!/usr/bin/env python3
"""What a QUIC v1 connection's two ends offered each other, read from its datagrams and the client's TLS key log:
each side's transport parameters (TLS extension 0x39), its HTTP/3 SETTINGS, and the frame types seen.
RFC 9001 §5 (packet protection), RFC 9000 §17 and §19, RFC 9114 §7.2.4. Used by scripts/wtcompat.py.

    scripts/quic_peek.py CAPTURE.jsonl KEYLOG      prints the readout as JSON

A capture line is {"dir": "c2s" | "s2c", "hex": DATAGRAM}, in arrival order.
"""
import hashlib
import hmac
import json
import sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM, ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDFExpand

V1 = 0x00000001
V1_SALT = bytes.fromhex("38762cf7f55934b34d179ae6a4c80cadccbb7f0a")
SUITES = {  # TLS 1.3 cipher suite → (AEAD, key length, hash)
    0x1301: (AESGCM, 16, hashes.SHA256),
    0x1302: (AESGCM, 32, hashes.SHA384),
    0x1303: (ChaCha20Poly1305, 32, hashes.SHA256),
}
INITIAL, ZERO_RTT, HANDSHAKE, ONE_RTT = "initial", "0rtt", "handshake", "1rtt"


class Reader:
    def __init__(self, data, pos=0):
        self.data, self.pos = data, pos

    def take(self, n):
        if self.pos + n > len(self.data):
            raise ValueError("truncated")
        out = self.data[self.pos:self.pos + n]
        self.pos += n
        return out

    def int(self, n):
        return int.from_bytes(self.take(n), "big")

    def varint(self):
        first = self.int(1)
        n = 1 << (first >> 6)
        return int.from_bytes(bytes([first & 0x3F]) + self.take(n - 1), "big")

    def left(self):
        return len(self.data) - self.pos


def expand_label(secret, label, length, hash_cls):
    full = b"tls13 " + label.encode()
    info = length.to_bytes(2, "big") + bytes([len(full)]) + full + b"\x00"
    return HKDFExpand(hash_cls(), length, info).derive(secret)


class Keys:
    def __init__(self, secret, suite):
        self.aead, self.key_len, self.hash = SUITES[suite]
        self.suite, self.secret = suite, secret
        self.hp = expand_label(secret, "quic hp", self.key_len, self.hash)
        self._derive()

    def _derive(self):
        self.key = expand_label(self.secret, "quic key", self.key_len, self.hash)
        self.iv = expand_label(self.secret, "quic iv", 12, self.hash)

    def next_phase(self):
        """RFC 9001 §6.1: the next key phase keeps the header protection key."""
        nxt = object.__new__(Keys)
        nxt.__dict__.update(self.__dict__)
        nxt.secret = expand_label(self.secret, "quic ku", self.hash().digest_size, self.hash)
        nxt._derive()
        return nxt

    def mask(self, sample):
        if self.suite == 0x1303:
            enc = Cipher(algorithms.ChaCha20(self.hp, sample), mode=None).encryptor()
            return enc.update(bytes(5))
        enc = Cipher(algorithms.AES(self.hp), modes.ECB()).encryptor()
        return enc.update(sample)[:5]

    def open(self, pn, aad, payload):
        nonce = bytes(a ^ b for a, b in zip(self.iv, pn.to_bytes(12, "big")))
        return self.aead(self.key).decrypt(nonce, payload, aad)


def initial_keys(dcid):
    secret = hmac.new(V1_SALT, dcid, hashlib.sha256).digest()
    return {d: Keys(expand_label(secret, f"{who} in", 32, hashes.SHA256), 0x1301)
            for who, d in (("client", "c2s"), ("server", "s2c"))}


def decode_pn(truncated, pn_len, largest):
    """RFC 9000 §A.3."""
    expected = largest + 1
    win = 1 << (pn_len * 8)
    candidate = (expected & ~(win - 1)) | truncated
    if candidate <= expected - win // 2 and candidate < (1 << 62) - win:
        return candidate + win
    if candidate > expected + win // 2 and candidate >= win:
        return candidate - win
    return candidate


class Stream:
    """Bytes of one stream or CRYPTO space from offset 0, as far as they are contiguous."""

    def __init__(self):
        self.parts = {}

    def add(self, offset, data):
        if data and len(self.parts.get(offset, b"")) < len(data):
            self.parts[offset] = data

    def contiguous(self):
        out = b""
        for off in sorted(self.parts):
            if off > len(out):
                break
            out += self.parts[off][len(out) - off:]
        return out


class Side:
    def __init__(self):
        self.crypto = {INITIAL: Stream(), HANDSHAKE: Stream(), ONE_RTT: Stream()}
        self.streams = {}
        self.frame_types = set()
        self.largest = {INITIAL: -1, HANDSHAKE: -1, ONE_RTT: -1, ZERO_RTT: -1}
        self.undecrypted = 0


def parse_frames(payload, side, space):
    r = Reader(payload)
    while r.left():
        t = r.varint()
        side.frame_types.add(t)
        if t in (0x00, 0x01, 0x1E, 0x1F):  # PADDING, PING, HANDSHAKE_DONE, IMMEDIATE_ACK
            continue
        if t in (0x02, 0x03):  # ACK
            r.varint(), r.varint()
            ranges = r.varint()
            r.varint()
            for _ in range(ranges):
                r.varint(), r.varint()
            if t == 0x03:
                r.varint(), r.varint(), r.varint()
        elif t == 0x04:  # RESET_STREAM
            r.varint(), r.varint(), r.varint()
        elif t == 0x24:  # RESET_STREAM_AT
            r.varint(), r.varint(), r.varint(), r.varint()
        elif t == 0x05:  # STOP_SENDING
            r.varint(), r.varint()
        elif t == 0x06:  # CRYPTO
            off, n = r.varint(), r.varint()
            side.crypto[space].add(off, r.take(n))
        elif t == 0x07:  # NEW_TOKEN
            r.take(r.varint())
        elif 0x08 <= t <= 0x0F:  # STREAM
            sid = r.varint()
            off = r.varint() if t & 0x04 else 0
            n = r.varint() if t & 0x02 else r.left()
            side.streams.setdefault(sid, Stream()).add(off, r.take(n))
        elif t in (0x10, 0x12, 0x13, 0x14, 0x16, 0x17, 0x19):
            r.varint()
        elif t in (0x11, 0x15):
            r.varint(), r.varint()
        elif t == 0x18:  # NEW_CONNECTION_ID
            r.varint(), r.varint()
            r.take(r.int(1))
            r.take(16)
        elif t in (0x1A, 0x1B):
            r.take(8)
        elif t in (0x1C, 0x1D):  # CONNECTION_CLOSE
            r.varint()
            if t == 0x1C:
                r.varint()
            r.take(r.varint())
        elif t in (0x30, 0x31):  # DATAGRAM
            r.take(r.varint() if t == 0x31 else r.left())
        elif t == 0xAF:  # ACK_FREQUENCY
            r.varint(), r.varint(), r.varint(), r.varint()
        else:
            return  # an unknown frame's length is unknown; the rest of the packet is skipped


def tls_messages(data):
    r = Reader(data)
    while r.left() >= 4:
        t, n = r.int(1), r.int(3)
        if r.left() < n:
            return
        yield t, r.take(n)


def extensions(r):
    end = r.pos + r.int(2)
    while r.pos < end:
        t, n = r.int(2), r.int(2)
        yield t, r.take(n)


def transport_parameters(blob):
    r = Reader(blob)
    out = {}
    while r.left():
        pid, n = r.varint(), r.varint()
        value = r.take(n)
        out[hex(pid)] = value.hex()
    return out


def h3_settings(stream_bytes):
    """A control stream's SETTINGS frame, if its first bytes hold one (RFC 9114 §6.2.1, §7.2.4)."""
    r = Reader(stream_bytes)
    try:
        if r.varint() != 0x00:
            return None
        while r.left():
            t, n = r.varint(), r.varint()
            payload = r.take(n)
            if t == 0x04:
                s, out = Reader(payload), {}
                while s.left():
                    sid = s.varint()
                    out[hex(sid)] = s.varint()
                return out
    except ValueError:
        return None
    return None


class Connection:
    def __init__(self, keylog):
        self.keylog = keylog
        self.sides = {"c2s": Side(), "s2c": Side()}
        self.keys = {}
        self.cid_len = {}
        self.suite = None
        self.versions = set()
        self.client_random = None

    def _space_keys(self, d, space):
        if space == ONE_RTT and self.keys.get((d, ONE_RTT)) is None:
            self._learn_secrets()
        return self.keys.get((d, space))

    def _learn_secrets(self):
        if self.client_random is None:
            for t, body in tls_messages(self.sides["c2s"].crypto[INITIAL].contiguous()):
                if t == 1:
                    self.client_random = body[2:34].hex()
        if self.suite is None:
            for t, body in tls_messages(self.sides["s2c"].crypto[INITIAL].contiguous()):
                if t == 2:
                    r = Reader(body, 34)
                    r.take(r.int(1))
                    self.suite = r.int(2)
        secrets = self.keylog.get(self.client_random or "", {})
        if self.suite is None or not secrets:
            return
        for d, hs, app in (("c2s", "CLIENT_HANDSHAKE_TRAFFIC_SECRET", "CLIENT_TRAFFIC_SECRET_0"),
                           ("s2c", "SERVER_HANDSHAKE_TRAFFIC_SECRET", "SERVER_TRAFFIC_SECRET_0")):
            if hs in secrets and (d, HANDSHAKE) not in self.keys:
                self.keys[(d, HANDSHAKE)] = Keys(secrets[hs], self.suite)
            if app in secrets and (d, ONE_RTT) not in self.keys:
                self.keys[(d, ONE_RTT)] = Keys(secrets[app], self.suite)
                self.keys[(d, "phase")] = 0

    def datagram(self, d, data):
        pos = 0
        while pos < len(data):
            n = self._packet(d, data, pos)
            if n is None:
                return
            pos += n

    def _packet(self, d, data, pos):
        side = self.sides[d]
        first = data[pos]
        r = Reader(data, pos + 1)
        if first & 0x80:
            version = r.int(4)
            self.versions.add(version)
            if version != V1:
                return None
            dcid = r.take(r.int(1))
            scid = r.take(r.int(1))
            space = {0: INITIAL, 1: ZERO_RTT, 2: HANDSHAKE}.get((first >> 4) & 3)
            if space is None:
                return None
            self.cid_len.setdefault(d, len(scid))
            if space == INITIAL:
                r.take(r.varint())
                if d == "c2s" and ("c2s", INITIAL) not in self.keys:
                    self.keys.update({(k, INITIAL): v for k, v in initial_keys(dcid).items()})
            length = r.varint()
            end = r.pos + length
            keys = self._space_keys(d, space)
            if keys is not None:
                self._open(d, side, space, keys, data[pos:end], r.pos - pos, first_mask=0x0F)
            else:
                side.undecrypted += 1
            if space == INITIAL:
                self._learn_secrets()
            return end - pos
        other = "s2c" if d == "c2s" else "c2s"
        dcid_len = self.cid_len.get(other)
        keys = self._space_keys(d, ONE_RTT)
        if dcid_len is None or keys is None:
            side.undecrypted += 1
            return None
        self._open(d, side, ONE_RTT, keys, data[pos:], 1 + dcid_len, first_mask=0x1F)
        return None

    def _open(self, d, side, space, keys, packet, pn_offset, first_mask):
        sample = packet[pn_offset + 4:pn_offset + 20]
        if len(sample) < 16:
            side.undecrypted += 1
            return
        mask = keys.mask(sample)
        first = packet[0] ^ (mask[0] & first_mask)
        pn_len = (first & 3) + 1
        pn_bytes = bytes(b ^ m for b, m in zip(packet[pn_offset:pn_offset + pn_len], mask[1:]))
        pn = decode_pn(int.from_bytes(pn_bytes, "big"), pn_len, side.largest[space])
        aad = bytes([first]) + packet[1:pn_offset] + pn_bytes
        body = packet[pn_offset + pn_len:]
        candidates = [keys]
        if space == ONE_RTT:
            phase = (first >> 2) & 1
            if phase != self.keys[(d, "phase")]:
                candidates = [keys.next_phase()]
        for k in candidates:
            try:
                payload = k.open(pn, aad, body)
            except Exception:
                continue
            if k is not keys:
                self.keys[(d, ONE_RTT)] = k
                self.keys[(d, "phase")] ^= 1
            side.largest[space] = max(side.largest[space], pn)
            try:
                parse_frames(payload, side, space)
            except ValueError:
                pass
            return
        side.undecrypted += 1

    def readout(self):
        out = {"quic_versions": sorted(hex(v) for v in self.versions), "cipher_suite": self.suite and hex(self.suite),
               "keys_found": bool(self.keylog.get(self.client_random or ""))}
        for d, who, msg_type in (("c2s", "client", 1), ("s2c", "server", 8)):
            side = self.sides[d]
            space = INITIAL if who == "client" else HANDSHAKE
            tps = None
            for t, body in tls_messages(side.crypto[space].contiguous()):
                if t != msg_type:
                    continue
                r = Reader(body)
                if t == 1:
                    r.take(34)
                    r.take(r.int(1))
                    r.take(r.int(2))
                    r.take(r.int(1))
                for ext, value in extensions(r):
                    if ext == 0x39:
                        tps = transport_parameters(value)
            uni_parity = 2 if who == "client" else 3
            settings = None
            for sid, stream in sorted(side.streams.items()):
                if sid % 4 == uni_parity:
                    settings = h3_settings(stream.contiguous())
                    if settings is not None:
                        break
            out[who] = {"transport_parameters": tps, "settings": settings,
                        "frame_types": sorted(hex(t) for t in side.frame_types), "undecrypted": side.undecrypted}
        return out


def read_keylog(path):
    out = {}
    for line in open(path):
        parts = line.split()
        if len(parts) == 3 and not line.startswith("#"):
            out.setdefault(parts[1].lower(), {})[parts[0]] = bytes.fromhex(parts[2])
    return out


def peek(capture_lines, keylog):
    conn = Connection(keylog)
    for line in capture_lines:
        conn.datagram(line["dir"], bytes.fromhex(line["hex"]))
    return conn.readout()


if __name__ == "__main__":
    lines = [json.loads(x) for x in open(sys.argv[1])]
    print(json.dumps(peek(lines, read_keylog(sys.argv[2])), indent=1))
