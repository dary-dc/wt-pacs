#!/usr/bin/env python3
"""measure_parser.py's record reader, key mask and converted-enhanced simulation. Run: python -I measure_parser_test.py"""
import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import measure_parser as mp  # noqa: E402

SHARED = struct.pack(">HHI", 0x5200, 0x9229, 1)


def per_frame(n: int) -> bytes:
    return struct.pack(">HHI", 0x5200, 0x9230, n)


def key(group: int, element: int, vr: bytes) -> bytes:
    return struct.pack(">HH", group, element) + vr + b"\0\0"


def instance(n: int, window: bytes) -> dict:
    """A CT instance group as the parser writes it, its private group apart."""
    group = [
        (key(0x0002, 0x0003, b"UI"), b"1.2.%d" % n),
        (key(0x0008, 0x0016, b"UI"), b"1.2.840.10008.5.1.4.1.1.2\0"),
        (key(0x0008, 0x0018, b"UI"), b"1.2.%d" % n),
        (key(0x0018, 0x0060, b"DS"), b"120 "),
        (key(0x0020, 0x0013, b"IS"), b"%d " % n),
        (key(0x0020, 0x0032, b"DS"), b"0\\0\\%d " % n),
        (key(0x0028, 0x0030, b"DS"), b"0.7\\0.7 "),
        (key(0x0028, 0x1050, b"DS"), window),
        (key(0x0028, 0x1051, b"DS"), b"400 "),
    ]
    private = [(key(0x0009, 0x0010, b"LO"), b"VENDOR")]
    return {"groups": {"instance": group, "private": private}}


class Records(unittest.TestCase):
    def test_reads_the_contract_record_and_refuses_a_cut_one(self):
        """A group file is [KL][key][VL little endian][value] back to back; a cut record is refused, not dropped."""
        data = bytes([8]) + key(0x0028, 0x1052, b"DS") + struct.pack("<I", 6) + b"-1024 "
        self.assertEqual(mp.records(data + data), [(key(0x0028, 0x1052, b"DS"), b"-1024 ")] * 2)
        with self.assertRaises(ValueError):
            mp.records(data + data[:-1])

    def test_mask_zeroes_only_what_the_parser_overwrites_in_a_nested_key(self):
        """A top-level key is kept; a nested key keeps its sequence, item and inner group, the rest zeroed."""
        top = key(0x0028, 0x1052, b"DS")
        nested = struct.pack(">HHI", 0x0012, 0x0064, 1) + b"\x00\x08\x00\x1c\x00\x00\x00\x76"
        self.assertEqual(mp.masked(top), top)
        self.assertEqual(mp.masked(nested), nested[:11] + bytes(5))


class ConvertedEnhanced(unittest.TestCase):
    def setUp(self):
        self.recs = mp.converted_enhanced([instance(n, b"40 " if n < 3 else b"50 ") for n in (1, 2, 3)], "CT")
        self.keys = [k for k, _ in self.recs]

    def test_a_constant_attribute_is_written_once_in_unassigned_shared(self):
        """KVP, the same in every instance, is one record under (5200,9229) > (0020,9170), none per frame."""
        kvp = [k for k in self.keys if k.endswith(key(0x0018, 0x0060, b"DS"))]
        self.assertEqual(kvp, [SHARED + struct.pack(">HHI", 0x0020, 0x9170, 1) + key(0x0018, 0x0060, b"DS")])

    def test_a_varying_attribute_goes_in_its_macro_in_every_frame(self):
        """Image Position, different per instance, is in Plane Position in each of the three Per-Frame items."""
        position = [k for k in self.keys if k.endswith(key(0x0020, 0x0032, b"DS"))]
        self.assertEqual(position, [per_frame(n) + struct.pack(">HHI", 0x0020, 0x9113, 1) + key(0x0020, 0x0032, b"DS")
                                    for n in (1, 2, 3)])

    def test_a_macro_is_shared_or_per_frame_as_a_whole(self):
        """Pixel Measures is shared once; Frame VOI LUT, whose centre varies, carries its constant width per frame."""
        spacing = [k for k in self.keys if k.endswith(key(0x0028, 0x0030, b"DS"))]
        width = [k for k in self.keys if k.endswith(key(0x0028, 0x1051, b"DS"))]
        self.assertEqual(spacing, [SHARED + struct.pack(">HHI", 0x0028, 0x9110, 1) + key(0x0028, 0x0030, b"DS")])
        self.assertEqual(len(width), 3)
        self.assertTrue(all(k.startswith(per_frame(n)) for n, k in zip((1, 2, 3), width)))

    def test_the_sources_are_referenced_per_frame_and_the_class_is_converted(self):
        """Each frame names its source instance; the top level is one SOP class, the legacy converted CT's."""
        source = [v for k, v in self.recs if k.endswith(key(0x0008, 0x1155, b"UI"))]
        self.assertEqual(source, [b"1.2.1", b"1.2.2", b"1.2.3"])
        sop_class = [v for k, v in self.recs if k == key(0x0008, 0x0016, b"UI")]
        self.assertEqual(sop_class, [b"1.2.840.10008.5.1.4.1.1.2.2\0"])
        frames = [v for k, v in self.recs if k == key(0x0028, 0x0008, b"IS")]
        self.assertEqual(frames, [b"3 "])

    def test_a_varying_top_level_attribute_keeps_every_source_value_per_frame(self):
        """Instance Number is written once at the top and each source's own value in Unassigned Per-Frame."""
        numbers = [(k, v) for k, v in self.recs if k.endswith(key(0x0020, 0x0013, b"IS"))]
        self.assertEqual(numbers[0], (key(0x0020, 0x0013, b"IS"), b"1 "))
        self.assertEqual([v for _, v in numbers[1:]], [b"1 ", b"2 ", b"3 "])

    def test_private_attributes_are_converted_too_and_the_output_is_records(self):
        """The constant private creator goes once in Unassigned Shared, and the result reads back as records."""
        private = [k for k in self.keys if k.endswith(key(0x0009, 0x0010, b"LO"))]
        self.assertEqual(len(private), 1)
        self.assertTrue(private[0].startswith(SHARED))
        raw = b"".join(bytes([len(k)]) + k + struct.pack("<I", len(v)) + v for k, v in self.recs)
        self.assertEqual(mp.records(raw), self.recs)


if __name__ == "__main__":
    unittest.main()
