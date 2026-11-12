#!/usr/bin/env python3
"""packages.py's container, differences and determinism. Run: python -I packages_test.py"""
import io
import os
import struct
import sys
import tarfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import zstandard  # noqa: E402

import packages  # noqa: E402

MEMBERS = [("PbPb/a/--.x", b"exam" * 300), ("PbPb/a/b/---.y", b"series" * 50)]


def unpacked(data: bytes) -> list:
    with tarfile.open(fileobj=io.BytesIO(data)) as t:
        return [(m.name, t.extractfile(m).read()) for m in t.getmembers()]


class Packages(unittest.TestCase):
    def test_raw_is_the_header_then_each_member_alone(self):
        """A raw package holds the header member first, then the members in order, byte for byte."""
        got = unpacked(packages.package("study", "u", MEMBERS, None))
        self.assertEqual(got[0][0], "header")
        self.assertIn(b"metadata none", got[0][1])
        self.assertEqual(got[1:], MEMBERS)

    def test_compressed_is_one_zstd_member_holding_the_same_members(self):
        """A compressed package's second member decompresses to a tar of exactly the raw package's members."""
        got = unpacked(packages.package("study", "u", MEMBERS, 3))
        self.assertEqual([n for n, _ in got], ["header", "metadata.tar.zst"])
        self.assertIn(b"metadata zstd", got[0][1])
        self.assertEqual(unpacked(zstandard.ZstdDecompressor().decompress(got[1][1])), MEMBERS)

    def test_a_package_ends_at_its_two_zero_blocks(self):
        """No 10 240-byte record: the header member 512 + 512, a 1 200-byte member 512 + 1 536, two zero blocks."""
        got = packages.package("study", "u", MEMBERS[:1], None)
        self.assertEqual(len(got), 512 + 512 + 512 + 1536 + 1024)
        self.assertEqual(got[-1024:], bytes(1024))

    def test_a_package_is_deterministic(self):
        """The same members make the same bytes twice, as #149 §4's idempotency needs."""
        for level in (None, 1):
            self.assertEqual(packages.package("k", "u", MEMBERS, level), packages.package("k", "u", MEMBERS, level))

    def test_a_changed_group_carries_level_uid_base_hash_and_ops(self):
        """A group's differences: level byte, UID behind its length, 8 bytes of the base's hash, op count, ops."""
        op = packages.set_op((0x0010, 0x0010), "PN", b"A^B")
        got = packages.changed_group("exam", "1.2.3", b"base", [op, op])
        self.assertEqual(got[:2], bytes([1, 5]))
        self.assertEqual(got[2:7], b"1.2.3")
        self.assertEqual(got[7:15], packages.measure.blake3.blake3(b"base").digest()[:8])
        self.assertEqual(struct.unpack("<I", got[15:19])[0], 2)
        self.assertEqual(got[19:], op + op)
        self.assertEqual(op, b"S" + bytes([8]) + b"\x00\x10\x00\x10PN\0\0" + struct.pack("<I", 3) + b"A^B")


if __name__ == "__main__":
    unittest.main()
