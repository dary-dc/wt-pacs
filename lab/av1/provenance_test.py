#!/usr/bin/env python3
"""The provenance guard refuses a known lossy source unless its set is marked lossy-sourced, refuses an
image export of unknown history unless marked unknown or lossy-sourced, and accepts every sound source
in data.json's shape (queue row 94 DATAGUARD).

usage: provenance_test.py   — exits 1 naming each wrong case
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from provenance import Refused, archive_attributes, check  # noqa: E402

UNCOMPRESSED = {"transferSyntax": "1.2.840.10008.1.2.1", "lossyImageCompression": "00"}
NO_FLAG = {"transferSyntax": "1.2.840.10008.1.2", "lossyImageCompression": None}
FLAGGED = {"transferSyntax": "1.2.840.10008.1.2", "lossyImageCompression": "01"}
JPEG_BASELINE = {"transferSyntax": "1.2.840.10008.1.2.4.50", "lossyImageCompression": None}
J2K_LOSSLESS = {"transferSyntax": "1.2.840.10008.1.2.4.90", "lossyImageCompression": "00"}

CASES = [
    ("sound", UNCOMPRESSED, True),
    ("sound", NO_FLAG, True),
    ("sound", J2K_LOSSLESS, True),
    ("lossless-but-unrepresentative", NO_FLAG, True),
    ("sound", FLAGGED, False),
    ("lossless-but-unrepresentative", FLAGGED, False),
    ("unknown", FLAGGED, False),
    ("lossy-sourced", FLAGGED, True),
    ("sound", JPEG_BASELINE, False),
    ("lossy-sourced", JPEG_BASELINE, True),
    ("sound", archive_attributes("luma"), False),
    ("unknown", archive_attributes("rgb"), False),
    ("lossy-sourced", archive_attributes("rgb"), True),
    ("sound", archive_attributes("png"), False),
    ("unknown", archive_attributes("png"), True),
    ("lossy-sourced", archive_attributes("png"), True),
    ("lossless", UNCOMPRESSED, False),
]


def accepted(klass, attributes):
    try:
        check("case", klass, attributes)
        return True
    except Refused:
        return False


def main():
    wrong = [(k, a, want) for k, a, want in CASES if accepted(k, a) != want]
    for k, a, want in wrong:
        print(f"provenance {k!r} on {a}: {'accepted' if not want else 'refused'}, want the other")
    print(f"provenance: {len(CASES) - len(wrong)}/{len(CASES)} cases")
    sys.exit(1 if wrong else 0)


if __name__ == "__main__":
    main()
