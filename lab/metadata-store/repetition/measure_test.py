#!/usr/bin/env python3
"""measure.py's split, record bytes, UID coding and repetition classes. Run: python -I measure_test.py"""
import io
import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pydicom  # noqa: E402
from pydicom.dataset import Dataset, FileMetaDataset  # noqa: E402
from pydicom.sequence import Sequence  # noqa: E402
from pydicom.uid import ExplicitVRLittleEndian  # noqa: E402

import measure  # noqa: E402


def written(ds: Dataset) -> str:
    """The dataset written to a file and read back, so its elements are raw as a fetched file's are."""
    out = io.BytesIO()
    ds.save_as(out, enforce_file_format=True)
    path = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"measure_test_{os.getpid()}.dcm")
    with open(path, "wb") as fh:
        fh.write(out.getvalue())
    return path


def sample(instance_number: int) -> Dataset:
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.file_meta.MediaStorageSOPInstanceUID = f"1.2.3.{instance_number}"
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.SOPInstanceUID = f"1.2.3.{instance_number}"
    ds.StudyDate = "20200101"
    ds.InstitutionName = "X"
    ds.Modality = "CT"
    ds.PatientName = "A^B"
    ds.StudyInstanceUID = "1.2.3"
    ds.SeriesInstanceUID = "1.2.3.9"
    ds.InstanceNumber = str(instance_number)
    ds.add_new(0x00131010, "LO", "VENDOR")
    item = Dataset()
    item.CodeValue = "113100"
    ds.DeidentificationMethodCodeSequence = Sequence([item])
    ds.add_new(0x00540016, "SQ", Sequence([Dataset()]))
    ds.add_new(0x00541210, "DS", "4.5")
    ds.Rows, ds.Columns, ds.BitsAllocated, ds.SamplesPerPixel = 2, 2, 8, 1
    ds.PixelData = b"\0\1\2\3"
    return ds


def names(groups: dict, level: str) -> list:
    return [measure.key_name(k) for k, _ in groups[level]]


class Split(unittest.TestCase):
    def setUp(self):
        self.path = written(sample(7))
        _, self.groups, self.pixels = measure.split(self.path)

    def tearDown(self):
        os.remove(self.path)

    def test_levels_follow_the_parser(self):
        """Patient and study attributes, and Institution Name, go to the exam group; series attributes to the
        series group; group 0002 and odd groups to the private group; anything else, and the four series tags
        past the parser's walk, to the instance group; (0008,0005) and the pixel data to none."""
        self.assertEqual(names(self.groups, "exam"),
                         ["StudyDate", "InstitutionName", "PatientName",
                          "DeidentificationMethodCodeSequence.CodeValue", "StudyInstanceUID"])
        self.assertEqual(names(self.groups, "series"), ["Modality", "SeriesInstanceUID"])
        self.assertIn("(0013,1010)", names(self.groups, "private"))
        self.assertIn("TransferSyntaxUID", names(self.groups, "private"))
        self.assertIn("CoincidenceWindowWidth", names(self.groups, "instance"))
        every = sum((names(self.groups, level) for level in measure.LEVELS), [])
        self.assertNotIn("SpecificCharacterSet", every)
        self.assertNotIn("PixelData", every)
        self.assertNotIn("FileMetaInformationGroupLength", every)
        self.assertEqual(self.pixels, 4)

    def test_records_carry_the_value_as_stored(self):
        """A top-level key is the tag big-endian, the VR and two charset bytes; a sequence's attribute 8 bytes
        more (its sequence's tag and item number); every value as in the file, padding included."""
        key, value = dict((measure.key_name(k), (k, v)) for k, v in self.groups["instance"])["InstanceNumber"]
        self.assertEqual(key, bytes.fromhex("00200013") + b"IS\0\0")
        self.assertEqual(value, b"7 ")
        key, value = self.groups["exam"][3]
        self.assertEqual(key, struct.pack(">HHI", 0x0012, 0x0064, 1) + bytes.fromhex("00080100") + b"SH\0\0")
        self.assertEqual(measure.record(key, value), bytes([16]) + key + struct.pack("<I", 6) + b"113100")
        meta = dict((measure.key_name(k), v) for k, v in self.groups["private"])
        self.assertEqual(meta["TransferSyntaxUID"], ExplicitVRLittleEndian.encode() + b"\0")
        self.assertEqual(meta["MediaStorageSOPClassUID"], b"1.2.840.10008.5.1.4.1.1.2\0")
        self.assertEqual(meta["FileMetaInformationVersion"], b"\0\1")


class ValueBytes(unittest.TestCase):
    def test_a_converted_element_gives_its_value_alone(self):
        """An element pydicom has already converted is written back to its value bytes, no header, long VR or short."""
        from pydicom.dataelem import DataElement
        self.assertEqual(measure.value_bytes(None, DataElement(0x00020001, "OB", b"\0\1")), b"\0\1")
        self.assertEqual(measure.value_bytes(None, DataElement(0x00020010, "UI", "1.2.840.10008.1.2.1")),
                         b"1.2.840.10008.1.2.1\0")


class UidCoding(unittest.TestCase):
    def test_contract_example(self):
        """contract.md §The layout: `1.2.3` padded is `TOMG`, and so is `1.2.3` (a remainder of two); a remainder of
        one is `alphabet[n0 << 2]` then `0`."""
        self.assertEqual(measure.coded_uid("1.2.3\0"), "TOMG")
        self.assertEqual(measure.coded_uid("1.2.3"), "TOMG")
        self.assertEqual(measure.coded_uid("1.2.3.4"), "TOMLd0")


class Repetition(unittest.TestCase):
    def test_classes_and_shared_weight(self):
        """A record in every instance with one value is constant, with two values varying, in some partial; shared +
        per-instance holds each constant record once."""
        k = [bytes([0, 0x20, 0, i]) + b"IS\0\0" for i in range(3)]
        instances = [{"groups": {"instance": [(k[0], b"1 "), (k[1], b"%d " % min(n, 1))] + ([(k[2], b"x ")] if n else [])}}
                     for n in range(3)]
        rep = measure.repetition(instances, "instance")
        self.assertEqual(rep["attributes"], {"constant": 1, "varying": 1, "partial": 1})
        size = len(measure.record(k[0], b"1 "))
        self.assertEqual(rep["bytes"], {"constant": 3 * size, "varying": 3 * size, "partial": 2 * size})
        self.assertEqual(rep["shared_plus_per_instance"], size + 3 * size + 2 * size)


if __name__ == "__main__":
    unittest.main()
